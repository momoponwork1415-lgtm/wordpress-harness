import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  decideApprovedCampaignLaunches,
  normalizeClaudeStatusLineRateLimits,
  type ApprovedCampaignLaunchManifest,
} from "../../src/operations/claude-quota-approved-campaign-launcher.js";
import {
  buildApprovedCampaignCommand,
  dispatchApprovedCampaignLaunches,
} from "../../src/operations/claude-quota-approved-campaign-launcher-runtime.js";
import { runClaudeQuotaLauncherCli } from "../../src/operations/claude-quota-approved-campaign-launcher-cli.js";

const observedAt = "2026-09-17T00:00:00.000Z";

function manifest(): ApprovedCampaignLaunchManifest {
  return {
    kind: "approved-campaign-launch-manifest",
    schemaVersion: 1,
    policy: {
      fiveHourReservePercentage: 10,
      estimatedFiveHourPercentagePerLaunch: 18,
      maxActiveCampaigns: 3,
      maxObservationAgeSeconds: 600,
    },
    runtime: {
      nodeExecutablePath: "/usr/bin/node",
      harnessCliPath: "/workspace/dist/cli.js",
      dockerExecutablePath: "/usr/bin/docker",
    },
    plans: ["one", "two", "three", "four"].map((id) => ({
      id,
      campaignId: `campaign-${id}`,
      requestPath: `/private/${id}.json`,
      targetSourceDirectory: `/private/source/${id}`,
      dependencySources: [
        { mountName: "wordpress", directory: "/private/wordpress" },
      ],
      databasePath: `/private/${id}.sqlite`,
      scratchDirectory: `/private/scratch/${id}`,
      logPath: `/private/logs/${id}.log`,
      image: `research@sha256:${"a".repeat(64)}`,
      providerConfigDirectory: "/private/provider",
      researchPromptPath: "/workspace/prompts/research.md",
    })),
  };
}

describe("Claude quota-aware approved Campaign launcher", () => {
  it("records a status-line observation through the operator CLI", async () => {
    const directory = await mkdtemp(join(tmpdir(), "quota-cli-status-"));
    const observationPath = join(directory, "observation.json");
    const stdout: string[] = [];
    const stderr: string[] = [];

    try {
      const exitCode = await runClaudeQuotaLauncherCli(
        ["record-status-line", "--observation", observationPath],
        {
          stdin: async () =>
            JSON.stringify({
              rate_limits: {
                five_hour: {
                  used_percentage: 35,
                  resets_at: 1_789_616_400,
                },
              },
            }),
          stdout: (text) => stdout.push(text),
          stderr: (text) => stderr.push(text),
        },
      );

      expect(exitCode).toBe(0);
      expect(stderr).toEqual([]);
      expect(JSON.parse(stdout.join(""))).toMatchObject({
        source: "status-line",
        fiveHour: { usedPercentage: 35 },
      });
      expect(JSON.parse(await readFile(observationPath, "utf8"))).toMatchObject(
        {
          source: "status-line",
          fiveHour: { usedPercentage: 35 },
        },
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("dispatches from a persisted observation through the operator CLI", async () => {
    const directory = await mkdtemp(join(tmpdir(), "quota-cli-dispatch-"));
    const manifestPath = join(directory, "manifest.json");
    const observationPath = join(directory, "observation.json");
    const input = manifest();
    input.plans = input.plans.slice(0, 1);
    await writeFile(manifestPath, `${JSON.stringify(input)}\n`, {
      mode: 0o600,
    });
    await writeFile(
      observationPath,
      `${JSON.stringify({
        kind: "claude-rate-limit-observation",
        schemaVersion: 1,
        observedAt: new Date().toISOString(),
        source: "status-line",
        fiveHour: { usedPercentage: 40 },
      })}\n`,
      { mode: 0o600 },
    );
    const stdout: string[] = [];
    const stderr: string[] = [];

    try {
      const exitCode = await runClaudeQuotaLauncherCli(
        [
          "dispatch",
          "--observation",
          observationPath,
          "--manifest",
          manifestPath,
          "--receipts",
          join(directory, "receipts"),
          "--working-directory",
          directory,
          "--dry-run",
        ],
        {
          stdin: async () => "",
          stdout: (text) => stdout.push(text),
          stderr: (text) => stderr.push(text),
        },
      );

      expect(exitCode).toBe(0);
      expect(stderr).toEqual([]);
      expect(JSON.parse(stdout.join(""))).toMatchObject({
        decision: {
          selectedPlanIds: ["one"],
          reason: "launch-approved",
        },
        launched: [],
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("normalizes the supported Claude status-line rate-limit fields", () => {
    expect(
      normalizeClaudeStatusLineRateLimits(
        {
          rate_limits: {
            five_hour: {
              used_percentage: 78,
              resets_at: 1_789_616_400,
            },
            seven_day: {
              used_percentage: 4,
              resets_at: 1_790_144_400,
            },
          },
        },
        observedAt,
      ),
    ).toEqual({
      kind: "claude-rate-limit-observation",
      schemaVersion: 1,
      observedAt,
      source: "status-line",
      fiveHour: {
        usedPercentage: 78,
        resetsAt: "2026-09-17T03:40:00.000Z",
      },
      sevenDay: {
        usedPercentage: 4,
        resetsAt: "2026-09-23T06:20:00.000Z",
      },
    });
  });

  it("preserves the reserve and both quota and process ceilings", () => {
    const decision = decideApprovedCampaignLaunches({
      manifest: manifest(),
      observation: {
        kind: "claude-rate-limit-observation",
        schemaVersion: 1,
        observedAt,
        source: "status-line",
        fiveHour: { usedPercentage: 40 },
      },
      claimedPlanIds: new Set(["one"]),
      activePlanIds: new Set(["one"]),
      reservedFiveHourPercentage: 0,
      now: "2026-09-17T00:05:00.000Z",
    });

    expect(decision).toEqual({
      kind: "approved-campaign-launch-decision",
      usedPercentage: 40,
      usablePercentage: 50,
      quotaSlots: 2,
      processSlots: 2,
      selectedPlanIds: ["two", "three"],
      reason: "launch-approved",
    });
  });

  it.each([
    {
      name: "missing",
      observation: undefined,
      now: "2026-09-17T00:05:00.000Z",
      reason: "quota-observation-missing",
    },
    {
      name: "stale",
      observation: {
        kind: "claude-rate-limit-observation" as const,
        schemaVersion: 1 as const,
        observedAt,
        source: "status-line" as const,
        fiveHour: { usedPercentage: 40 },
      },
      now: "2026-09-17T00:11:00.000Z",
      reason: "quota-observation-stale",
    },
    {
      name: "reset-crossed",
      observation: {
        kind: "claude-rate-limit-observation" as const,
        schemaVersion: 1 as const,
        observedAt,
        source: "status-line" as const,
        fiveHour: {
          usedPercentage: 40,
          resetsAt: "2026-09-17T00:04:00.000Z",
        },
      },
      now: "2026-09-17T00:05:00.000Z",
      reason: "quota-window-reset",
    },
  ])(
    "fails closed when the quota observation is $name",
    ({ observation, now, reason }) => {
      const decision = decideApprovedCampaignLaunches({
        manifest: manifest(),
        observation,
        claimedPlanIds: new Set(),
        activePlanIds: new Set(),
        reservedFiveHourPercentage: 0,
        now,
      });

      expect(decision.selectedPlanIds).toEqual([]);
      expect(decision.reason).toBe(reason);
    },
  );

  it("launches nothing when doing so would consume the reserve", () => {
    const decision = decideApprovedCampaignLaunches({
      manifest: manifest(),
      observation: {
        kind: "claude-rate-limit-observation",
        schemaVersion: 1,
        observedAt,
        source: "status-line",
        fiveHour: { usedPercentage: 78 },
      },
      claimedPlanIds: new Set(),
      activePlanIds: new Set(),
      reservedFiveHourPercentage: 0,
      now: "2026-09-17T00:05:00.000Z",
    });

    expect(decision).toMatchObject({
      usablePercentage: 12,
      quotaSlots: 0,
      selectedPlanIds: [],
      reason: "quota-reserve-reached",
    });
  });

  it("can spend the final quota percentage for resumable Campaigns", () => {
    const input = manifest();
    input.policy.fiveHourReservePercentage = 0;
    input.policy.allowQuotaExhaustion = true;
    const decision = decideApprovedCampaignLaunches({
      manifest: input,
      observation: {
        kind: "claude-rate-limit-observation",
        schemaVersion: 1,
        observedAt,
        source: "status-line",
        fiveHour: { usedPercentage: 99 },
      },
      claimedPlanIds: new Set(),
      activePlanIds: new Set(),
      reservedFiveHourPercentage: 0,
      now: "2026-09-17T00:05:00.000Z",
    });

    expect(decision).toMatchObject({
      usablePercentage: 1,
      quotaSlots: 4,
      selectedPlanIds: ["one", "two", "three"],
      reason: "launch-approved",
    });
  });

  it("does not require a quota observation after every plan is claimed", () => {
    const input = manifest();
    const decision = decideApprovedCampaignLaunches({
      manifest: input,
      observation: undefined,
      claimedPlanIds: new Set(input.plans.map((plan) => plan.id)),
      activePlanIds: new Set(),
      reservedFiveHourPercentage: 0,
      now: "2026-09-17T00:05:00.000Z",
    });

    expect(decision).toMatchObject({
      selectedPlanIds: [],
      reason: "all-plans-claimed",
    });
  });

  it("assembles only the approved initial Research command", () => {
    const input = manifest();
    const command = buildApprovedCampaignCommand(input, input.plans[0]!);

    expect(command.slice(0, 3)).toEqual([
      "/workspace/dist/cli.js",
      "campaign",
      "conduct-approved",
    ]);
    expect(command).not.toContain("review-research");
    expect(command).not.toContain("review-candidates");
    expect(command).not.toContain("inspect");
  });

  it("uses an atomic private claim to prevent duplicate cron launches", async () => {
    const directory = await mkdtemp(join(tmpdir(), "quota-launcher-"));
    const base = manifest();
    const plan = base.plans[0]!;
    const input: ApprovedCampaignLaunchManifest = {
      ...base,
      runtime: {
        ...base.runtime,
        nodeExecutablePath: "/bin/true",
      },
      plans: [
        {
          ...plan,
          scratchDirectory: join(directory, "scratch"),
          logPath: join(directory, "campaign.log"),
        },
      ],
    };
    const options = {
      manifest: input,
      observation: {
        kind: "claude-rate-limit-observation" as const,
        schemaVersion: 1 as const,
        observedAt,
        source: "status-line" as const,
        fiveHour: { usedPercentage: 40 },
      },
      receiptRoot: join(directory, "receipts"),
      workingDirectory: directory,
      now: "2026-09-17T00:05:00.000Z",
      dryRun: false,
    };

    try {
      const [first, concurrent] = await Promise.all([
        dispatchApprovedCampaignLaunches(options),
        dispatchApprovedCampaignLaunches(options),
      ]);

      expect(first.launched.length + concurrent.launched.length).toBe(1);
      expect([first.decision.reason, concurrent.decision.reason]).toContain(
        "launch-approved",
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("does not reuse one quota observation after a launched process exits", async () => {
    const directory = await mkdtemp(join(tmpdir(), "quota-reservation-"));
    const base = manifest();
    const input: ApprovedCampaignLaunchManifest = {
      ...base,
      policy: {
        ...base.policy,
        estimatedFiveHourPercentagePerLaunch: 30,
        maxActiveCampaigns: 1,
      },
      runtime: {
        ...base.runtime,
        nodeExecutablePath: "/bin/true",
      },
      plans: base.plans.slice(0, 2).map((plan) => ({
        ...plan,
        scratchDirectory: join(directory, "scratch", plan.id),
        logPath: join(directory, "logs", `${plan.id}.log`),
      })),
    };
    const options = {
      manifest: input,
      observation: {
        kind: "claude-rate-limit-observation" as const,
        schemaVersion: 1 as const,
        observedAt,
        source: "status-line" as const,
        fiveHour: { usedPercentage: 40 },
      },
      receiptRoot: join(directory, "receipts"),
      workingDirectory: directory,
      now: "2026-09-17T00:05:00.000Z",
      dryRun: false,
    };

    try {
      const first = await dispatchApprovedCampaignLaunches(options);
      const pid = first.launched[0]?.pid;
      if (pid === undefined) throw new Error("missing launched process pid");
      for (let attempt = 0; attempt < 100; attempt += 1) {
        try {
          process.kill(pid, 0);
          await new Promise((resolvePromise) => setTimeout(resolvePromise, 5));
        } catch (error: unknown) {
          if (
            error instanceof Error &&
            "code" in error &&
            error.code === "ESRCH"
          )
            break;
          throw error;
        }
      }

      const second = await dispatchApprovedCampaignLaunches(options);
      expect(first.launched).toHaveLength(1);
      expect(second).toMatchObject({
        decision: {
          usablePercentage: 20,
          quotaSlots: 0,
          selectedPlanIds: [],
          reason: "quota-reserve-reached",
        },
        launched: [],
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("does not expose a credential-bearing automatic usage probe", async () => {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const exitCode = await runClaudeQuotaLauncherCli(["tick"], {
      stdin: async () => "",
      stdout: (text) => stdout.push(text),
      stderr: (text) => stderr.push(text),
    });

    expect(exitCode).toBe(1);
    expect(stdout).toEqual([]);
    expect(stderr.join("")).toContain("<record-status-line|dispatch>");
  });
});
