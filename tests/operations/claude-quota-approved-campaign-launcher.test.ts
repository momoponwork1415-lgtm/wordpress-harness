import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  decideApprovedCampaignLaunches,
  normalizeClaudeAccountReadiness,
  normalizeClaudeStatusLineRateLimits,
  type ApprovedCampaignLaunchManifest,
  type ClaudeAccountReadinessObservation,
  type ClaudeRateLimitObservation,
} from "../../src/operations/claude-quota-approved-campaign-launcher.js";
import {
  buildApprovedCampaignCommand,
  dispatchApprovedCampaignLaunches,
} from "../../src/operations/claude-quota-approved-campaign-launcher-runtime.js";
import { runClaudeQuotaLauncherCli } from "../../src/operations/claude-quota-approved-campaign-launcher-cli.js";

const observedAt = "2026-09-17T00:00:00.000Z";
const fiveHourResetsAt = "2026-09-17T03:40:00.000Z";
const sevenDayResetsAt = "2026-09-23T06:20:00.000Z";

function readiness(
  status: ClaudeAccountReadinessObservation["status"] = "ready",
  at = observedAt,
): ClaudeAccountReadinessObservation {
  return {
    kind: "claude-account-readiness-observation",
    schemaVersion: 1,
    observedAt: at,
    source: "operator",
    status,
  };
}

function quotaObservation(
  input: {
    readonly at?: string;
    readonly fiveHourUsed?: number;
    readonly fiveHourReset?: string;
    readonly sevenDayUsed?: number;
    readonly sevenDayReset?: string;
  } = {},
): ClaudeRateLimitObservation {
  return {
    kind: "claude-rate-limit-observation",
    schemaVersion: 2,
    observedAt: input.at ?? observedAt,
    source: "status-line",
    fiveHour: {
      usedPercentage: input.fiveHourUsed ?? 40,
      resetsAt: input.fiveHourReset ?? fiveHourResetsAt,
    },
    sevenDay: {
      usedPercentage: input.sevenDayUsed ?? 10,
      resetsAt: input.sevenDayReset ?? sevenDayResetsAt,
    },
  };
}

function manifest(): ApprovedCampaignLaunchManifest {
  return {
    kind: "approved-campaign-launch-manifest",
    schemaVersion: 2,
    policy: {
      fiveHourReservePercentage: 10,
      sevenDayReservePercentage: 5,
      estimatedFiveHourPercentagePerLaunch: 18,
      estimatedSevenDayPercentagePerLaunch: 25,
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
  it("normalizes account readiness separately from quota", () => {
    expect(
      normalizeClaudeAccountReadiness({ status: "ready" }, observedAt),
    ).toEqual({
      kind: "claude-account-readiness-observation",
      schemaVersion: 1,
      observedAt,
      source: "operator",
      status: "ready",
    });
    expect(() =>
      normalizeClaudeAccountReadiness(
        { status: "ready", token: "must-not-be-persisted" },
        observedAt,
      ),
    ).toThrow();
  });

  it("records account readiness through the operator CLI", async () => {
    const directory = await mkdtemp(join(tmpdir(), "readiness-cli-status-"));
    const readinessPath = join(directory, "readiness.json");
    const stdout: string[] = [];
    const stderr: string[] = [];

    try {
      const exitCode = await runClaudeQuotaLauncherCli(
        ["record-account-readiness", "--readiness-observation", readinessPath],
        {
          stdin: async () => JSON.stringify({ status: "unauthenticated" }),
          stdout: (text) => stdout.push(text),
          stderr: (text) => stderr.push(text),
        },
      );

      expect(exitCode).toBe(0);
      expect(stderr).toEqual([]);
      expect(JSON.parse(stdout.join(""))).toMatchObject({
        source: "operator",
        status: "unauthenticated",
      });
      expect(JSON.parse(await readFile(readinessPath, "utf8"))).toMatchObject({
        source: "operator",
        status: "unauthenticated",
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("records a status-line observation through the operator CLI", async () => {
    const directory = await mkdtemp(join(tmpdir(), "quota-cli-status-"));
    const observationPath = join(directory, "observation.json");
    const stdout: string[] = [];
    const stderr: string[] = [];

    try {
      const exitCode = await runClaudeQuotaLauncherCli(
        ["record-status-line", "--quota-observation", observationPath],
        {
          stdin: async () =>
            JSON.stringify({
              rate_limits: {
                five_hour: {
                  used_percentage: 35,
                  resets_at: 1_789_616_400,
                },
                seven_day: {
                  used_percentage: 4,
                  resets_at: 1_790_144_400,
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
        sevenDay: { usedPercentage: 4 },
      });
      expect(JSON.parse(await readFile(observationPath, "utf8"))).toMatchObject(
        {
          source: "status-line",
          fiveHour: { usedPercentage: 35 },
          sevenDay: { usedPercentage: 4 },
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
    const readinessPath = join(directory, "readiness.json");
    const input = manifest();
    input.plans = input.plans.slice(0, 1);
    await writeFile(manifestPath, `${JSON.stringify(input)}\n`, {
      mode: 0o600,
    });
    const now = new Date();
    const currentObservedAt = now.toISOString();
    await Promise.all([
      writeFile(
        observationPath,
        `${JSON.stringify(
          quotaObservation({
            at: currentObservedAt,
            fiveHourReset: new Date(
              now.getTime() + 60 * 60 * 1_000,
            ).toISOString(),
            sevenDayReset: new Date(
              now.getTime() + 7 * 24 * 60 * 60 * 1_000,
            ).toISOString(),
          }),
        )}\n`,
        { mode: 0o600 },
      ),
      writeFile(
        readinessPath,
        `${JSON.stringify(readiness("ready", currentObservedAt))}\n`,
        { mode: 0o600 },
      ),
    ]);
    const stdout: string[] = [];
    const stderr: string[] = [];

    try {
      const exitCode = await runClaudeQuotaLauncherCli(
        [
          "dispatch",
          "--quota-observation",
          observationPath,
          "--readiness-observation",
          readinessPath,
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
      schemaVersion: 2,
      observedAt,
      source: "status-line",
      fiveHour: {
        usedPercentage: 78,
        resetsAt: fiveHourResetsAt,
      },
      sevenDay: {
        usedPercentage: 4,
        resetsAt: sevenDayResetsAt,
      },
    });
    expect(() =>
      normalizeClaudeStatusLineRateLimits(
        {
          rate_limits: {
            five_hour: {
              used_percentage: 78,
              resets_at: 1_789_616_400,
            },
          },
        },
        observedAt,
      ),
    ).toThrow();
  });

  it("preserves the reserve and both quota and process ceilings", () => {
    const decision = decideApprovedCampaignLaunches({
      manifest: manifest(),
      readiness: readiness(),
      observation: quotaObservation(),
      claimedPlanIds: new Set(["one"]),
      activePlanIds: new Set(["one"]),
      reservedFiveHourPercentage: 0,
      reservedSevenDayPercentage: 0,
      now: "2026-09-17T00:05:00.000Z",
    });

    expect(decision).toEqual({
      kind: "approved-campaign-launch-decision",
      accountStatus: "ready",
      fiveHour: {
        usedPercentage: 40,
        usablePercentage: 50,
        quotaSlots: 2,
      },
      sevenDay: {
        usedPercentage: 10,
        usablePercentage: 85,
        quotaSlots: 3,
      },
      quotaSlots: 2,
      processSlots: 2,
      selectedPlanIds: ["two", "three"],
      reason: "launch-approved",
    });
  });

  it.each([
    {
      name: "missing",
      readinessObservation: undefined,
      now: "2026-09-17T00:05:00.000Z",
      reason: "account-readiness-observation-missing",
    },
    {
      name: "expired authentication",
      readinessObservation: readiness("unauthenticated"),
      now: "2026-09-17T00:05:00.000Z",
      reason: "account-unauthenticated",
    },
    {
      name: "unavailable",
      readinessObservation: readiness("unavailable"),
      now: "2026-09-17T00:05:00.000Z",
      reason: "account-readiness-unavailable",
    },
    {
      name: "stale",
      readinessObservation: readiness(),
      now: "2026-09-17T00:11:00.000Z",
      reason: "account-readiness-observation-stale",
    },
  ])(
    "fails closed when account readiness is $name",
    ({ readinessObservation, now, reason }) => {
      const decision = decideApprovedCampaignLaunches({
        manifest: manifest(),
        readiness: readinessObservation,
        observation: quotaObservation(),
        claimedPlanIds: new Set(),
        activePlanIds: new Set(),
        reservedFiveHourPercentage: 0,
        reservedSevenDayPercentage: 0,
        now,
      });

      expect(decision.selectedPlanIds).toEqual([]);
      expect(decision.reason).toBe(reason);
    },
  );

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
        ...quotaObservation(),
      },
      now: "2026-09-17T00:11:00.000Z",
      reason: "quota-observation-stale",
    },
    {
      name: "reset-crossed",
      observation: {
        ...quotaObservation({
          fiveHourReset: "2026-09-17T00:04:00.000Z",
        }),
      },
      now: "2026-09-17T00:05:00.000Z",
      reason: "five-hour-quota-window-reset",
    },
    {
      name: "seven-day-reset-crossed",
      observation: {
        ...quotaObservation({
          sevenDayReset: "2026-09-17T00:04:00.000Z",
        }),
      },
      now: "2026-09-17T00:05:00.000Z",
      reason: "seven-day-quota-window-reset",
    },
  ])(
    "fails closed when the quota observation is $name",
    ({ observation, now, reason }) => {
      const decision = decideApprovedCampaignLaunches({
        manifest: manifest(),
        readiness: readiness("ready", now),
        observation,
        claimedPlanIds: new Set(),
        activePlanIds: new Set(),
        reservedFiveHourPercentage: 0,
        reservedSevenDayPercentage: 0,
        now,
      });

      expect(decision.selectedPlanIds).toEqual([]);
      expect(decision.reason).toBe(reason);
    },
  );

  it("launches nothing when doing so would consume the five-hour reserve", () => {
    const decision = decideApprovedCampaignLaunches({
      manifest: manifest(),
      readiness: readiness(),
      observation: quotaObservation({ fiveHourUsed: 78 }),
      claimedPlanIds: new Set(),
      activePlanIds: new Set(),
      reservedFiveHourPercentage: 0,
      reservedSevenDayPercentage: 0,
      now: "2026-09-17T00:05:00.000Z",
    });

    expect(decision).toMatchObject({
      fiveHour: { usablePercentage: 12, quotaSlots: 0 },
      quotaSlots: 0,
      selectedPlanIds: [],
      reason: "five-hour-quota-reserve-reached",
    });
  });

  it("launches nothing when doing so would consume the seven-day reserve", () => {
    const decision = decideApprovedCampaignLaunches({
      manifest: manifest(),
      readiness: readiness(),
      observation: quotaObservation({ sevenDayUsed: 80 }),
      claimedPlanIds: new Set(),
      activePlanIds: new Set(),
      reservedFiveHourPercentage: 0,
      reservedSevenDayPercentage: 0,
      now: "2026-09-17T00:05:00.000Z",
    });

    expect(decision).toMatchObject({
      sevenDay: { usablePercentage: 15, quotaSlots: 0 },
      quotaSlots: 0,
      selectedPlanIds: [],
      reason: "seven-day-quota-reserve-reached",
    });
  });

  it("preserves the maximum-active process ceiling", () => {
    const decision = decideApprovedCampaignLaunches({
      manifest: manifest(),
      readiness: readiness(),
      observation: quotaObservation(),
      claimedPlanIds: new Set(["one", "two", "three"]),
      activePlanIds: new Set(["one", "two", "three"]),
      reservedFiveHourPercentage: 0,
      reservedSevenDayPercentage: 0,
      now: "2026-09-17T00:05:00.000Z",
    });

    expect(decision).toMatchObject({
      processSlots: 0,
      selectedPlanIds: [],
      reason: "process-ceiling-reached",
    });
  });

  it("can spend the final quota percentage for resumable Campaigns", () => {
    const input = manifest();
    input.policy.fiveHourReservePercentage = 0;
    input.policy.sevenDayReservePercentage = 0;
    input.policy.allowQuotaExhaustion = true;
    const decision = decideApprovedCampaignLaunches({
      manifest: input,
      readiness: readiness(),
      observation: quotaObservation({
        fiveHourUsed: 99,
        sevenDayUsed: 99,
      }),
      claimedPlanIds: new Set(),
      activePlanIds: new Set(),
      reservedFiveHourPercentage: 0,
      reservedSevenDayPercentage: 0,
      now: "2026-09-17T00:05:00.000Z",
    });

    expect(decision).toMatchObject({
      fiveHour: { usablePercentage: 1 },
      sevenDay: { usablePercentage: 1 },
      quotaSlots: 4,
      selectedPlanIds: ["one", "two", "three"],
      reason: "launch-approved",
    });
  });

  it("does not require a quota observation after every plan is claimed", () => {
    const input = manifest();
    const decision = decideApprovedCampaignLaunches({
      manifest: input,
      readiness: undefined,
      observation: undefined,
      claimedPlanIds: new Set(input.plans.map((plan) => plan.id)),
      activePlanIds: new Set(),
      reservedFiveHourPercentage: 0,
      reservedSevenDayPercentage: 0,
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
          databasePath: join(directory, "database", `${plan.id}.sqlite`),
          scratchDirectory: join(directory, "scratch"),
          logPath: join(directory, "campaign.log"),
        },
      ],
    };
    const options = {
      manifest: input,
      readiness: readiness(),
      observation: quotaObservation(),
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
      expect([...first.launched, ...concurrent.launched][0]).toMatchObject({
        schemaVersion: 2,
        accountReadinessObservationDigest: expect.stringMatching(/^sha256:/),
        quotaObservationDigest: expect.stringMatching(/^sha256:/),
        estimatedFiveHourPercentage: 18,
        estimatedSevenDayPercentage: 25,
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("creates the database parent before claiming and launching", async () => {
    const directory = await mkdtemp(join(tmpdir(), "quota-database-parent-"));
    const base = manifest();
    const plan = base.plans[0]!;
    const databasePath = join(
      directory,
      "campaign-state",
      "nested",
      "campaign.sqlite",
    );
    const input: ApprovedCampaignLaunchManifest = {
      ...base,
      runtime: {
        ...base.runtime,
        nodeExecutablePath: "/bin/true",
      },
      plans: [
        {
          ...plan,
          databasePath,
          scratchDirectory: join(directory, "scratch"),
          logPath: join(directory, "logs", "campaign.log"),
        },
      ],
    };

    try {
      const result = await dispatchApprovedCampaignLaunches({
        manifest: input,
        readiness: readiness(),
        observation: quotaObservation(),
        receiptRoot: join(directory, "receipts"),
        workingDirectory: directory,
        now: "2026-09-17T00:05:00.000Z",
        dryRun: false,
      });

      expect(result.launched).toHaveLength(1);
      expect((await stat(dirname(databasePath))).isDirectory()).toBe(true);
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
        estimatedSevenDayPercentagePerLaunch: 70,
        maxActiveCampaigns: 1,
      },
      runtime: {
        ...base.runtime,
        nodeExecutablePath: "/bin/true",
      },
      plans: base.plans.slice(0, 2).map((plan) => ({
        ...plan,
        databasePath: join(directory, "database", `${plan.id}.sqlite`),
        scratchDirectory: join(directory, "scratch", plan.id),
        logPath: join(directory, "logs", `${plan.id}.log`),
      })),
    };
    const options = {
      manifest: input,
      readiness: readiness(),
      observation: quotaObservation(),
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
          fiveHour: { usablePercentage: 20, quotaSlots: 0 },
          sevenDay: { usablePercentage: 15, quotaSlots: 0 },
          quotaSlots: 0,
          selectedPlanIds: [],
          reason: "five-hour-quota-reserve-reached",
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
    expect(stderr.join("")).toContain(
      "<record-account-readiness|record-status-line|dispatch>",
    );
  });
});
