import {
  access,
  mkdtemp,
  mkdir,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { describe, expect, it } from "vitest";

import { canonicalDigest } from "../../src/infrastructure/canonical-json.js";
import {
  claudeCodeNativeTransport,
  defineAgentRuntimeProfile,
} from "../../src/infrastructure/agent-runtime-profile.js";
import { measureCanonicalSourceTree } from "../../src/infrastructure/canonical-source-tree.js";
import { promptTextDigest } from "../../src/infrastructure/prompt-text.js";
import {
  formatCampaignReadinessReport,
  openCampaignReadinessDoctor,
  type CampaignReadinessInput,
  type CampaignReadinessReport,
} from "../../src/operations/campaign-readiness-doctor.js";
import { runCampaignReadinessDoctorCli } from "../../src/operations/campaign-readiness-doctor-cli.js";
import type { ApprovedCampaignLaunchManifest } from "../../src/operations/claude-quota-approved-campaign-launcher.js";
import type { CampaignInput } from "../../src/research/index.js";
import { PrivateArtifactStore } from "../../src/infrastructure/private-artifact-store.js";

const checkedAt = "2026-09-18T06:00:00.000Z";
const imageDigest = claudeCodeNativeTransport.sandboxImageDigest;

async function readyProcess(options: { readonly args: readonly string[] }) {
  const args = options.args;
  if (args[0] === "version") {
    return {
      kind: "exited" as const,
      exitCode: 0,
      stdout: "27.0.0\n",
      stderr: "",
    };
  }
  if (args[0] === "info") {
    return {
      kind: "exited" as const,
      exitCode: 0,
      stdout: JSON.stringify({ runc: {}, runsc: {} }),
      stderr: "",
    };
  }
  if (args[0] === "image") {
    return {
      kind: "exited" as const,
      exitCode: 0,
      stdout: JSON.stringify({
        Id: imageDigest,
        RepoDigests: [`research@${imageDigest}`],
      }),
      stderr: "",
    };
  }
  return {
    kind: "exited" as const,
    exitCode: 0,
    stdout: "2.1.220 (Claude Code)\n",
    stderr: "",
  };
}

function resultCheck(report: CampaignReadinessReport, id: string) {
  const item = report.checks.find((candidate) => candidate.id === id);
  if (item === undefined) throw new Error(`Missing Doctor check: ${id}`);
  return item;
}

async function readyFixture(
  directory: string,
): Promise<CampaignReadinessInput> {
  const sourceDirectory = join(directory, "target");
  const dependencyDirectory = join(directory, "wordpress");
  const scratchDirectory = join(directory, "scratch");
  const databasePath = join(directory, "database", "campaign.sqlite");
  const promptPath = join(directory, "research.md");
  const prompt = "Inspect broken security semantics.\n";
  await Promise.all([
    mkdir(sourceDirectory),
    mkdir(dependencyDirectory),
    mkdir(scratchDirectory),
    mkdir(join(directory, "database")),
  ]);
  await Promise.all([
    writeFile(join(sourceDirectory, "plugin.php"), "<?php // target\n"),
    writeFile(join(dependencyDirectory, "version.php"), "<?php // core\n"),
    writeFile(promptPath, prompt),
  ]);
  const [sourceTree, dependencyTree] = await Promise.all([
    measureCanonicalSourceTree(sourceDirectory, {
      maxEntries: 10,
      maxBytes: 1024,
    }),
    measureCanonicalSourceTree(dependencyDirectory, {
      maxEntries: 10,
      maxBytes: 1024,
    }),
  ]);
  const campaignInput: CampaignInput = {
    kind: "agent-led-campaign",
    schemaVersion: 1,
    campaignId: "campaign-doctor-ready-1",
    targetSnapshot: {
      id: "target-doctor-ready-1",
      pluginSlug: "doctor-target",
      version: "1.0.0",
      digest: `sha256:${"b".repeat(64)}`,
      sourceTree,
    },
    dependencySnapshots: [
      {
        id: "wordpress-6.9",
        mountName: "wordpress",
        version: "6.9",
        digest: `sha256:${"c".repeat(64)}`,
        sourceTree: dependencyTree,
      },
    ],
    promptSet: {
      id: "research-prompt-v3",
      digest: promptTextDigest(prompt),
    },
    agentRuntimeProfile: defineAgentRuntimeProfile({
      id: "claude-profile-1",
      ...claudeCodeNativeTransport,
      model: "claude-opus-5",
      effort: "high",
    }),
    permissionProfile: {
      id: "research-read-only",
      digest: `sha256:${"e".repeat(64)}`,
    },
    budgetEnvelope: {
      id: "budget-doctor-ready-1",
      maxNativeRuns: 1,
      maxWallTimeMs: 3_600_000,
      researchGrantWallTimeMs: 3_600_000,
      digest: `sha256:${"f".repeat(64)}`,
    },
  };
  const manifest: ApprovedCampaignLaunchManifest = {
    kind: "approved-campaign-launch-manifest",
    schemaVersion: 2,
    policy: {
      fiveHourReservePercentage: 10,
      sevenDayReservePercentage: 10,
      estimatedFiveHourPercentagePerLaunch: 20,
      estimatedSevenDayPercentagePerLaunch: 5,
      maxActiveCampaigns: 3,
      maxObservationAgeSeconds: 600,
    },
    runtime: {
      nodeExecutablePath: "/usr/bin/node",
      harnessCliPath: "/workspace/dist/cli.js",
      dockerExecutablePath: "/usr/bin/docker",
    },
    plans: [
      {
        id: "plan-ready",
        campaignId: campaignInput.campaignId,
        requestPath: join(directory, "approved-request.json"),
        targetSourceDirectory: sourceDirectory,
        dependencySources: [
          { mountName: "wordpress", directory: dependencyDirectory },
        ],
        databasePath,
        scratchDirectory,
        logPath: join(directory, "logs", "campaign.log"),
        image: `research@${imageDigest}`,
        providerConfigDirectory: join(directory, "provider"),
        researchPromptPath: promptPath,
      },
    ],
  };
  return {
    kind: "campaign-readiness-input",
    schemaVersion: 1,
    manifest,
    planId: "plan-ready",
    campaignInput,
    accountReadiness: {
      kind: "claude-account-readiness-observation",
      schemaVersion: 1,
      observedAt: "2026-09-18T05:59:00.000Z",
      source: "operator",
      status: "ready",
    },
    quotaObservation: {
      kind: "claude-rate-limit-observation",
      schemaVersion: 2,
      observedAt: "2026-09-18T05:59:00.000Z",
      source: "status-line",
      fiveHour: {
        usedPercentage: 20,
        resetsAt: "2026-09-18T10:00:00.000Z",
      },
      sevenDay: {
        usedPercentage: 30,
        resetsAt: "2026-09-24T10:00:00.000Z",
      },
    },
    receiptRoot: join(directory, "launch-receipts"),
    minimumFreeDiskBytes: 1,
  };
}

describe("Campaign readiness doctor", () => {
  it("renders machine and human output from the same read-only report", async () => {
    const directory = await mkdtemp(join(tmpdir(), "campaign-doctor-cli-"));
    try {
      const input = await readyFixture(directory);
      const inputPath = join(directory, "doctor-input.json");
      await writeFile(inputPath, `${JSON.stringify(input)}\n`);
      const doctor = openCampaignReadinessDoctor({
        clock: () => new Date(checkedAt),
        runProcess: readyProcess,
      });
      const jsonOutput: string[] = [];
      const humanOutput: string[] = [];
      const stderr: string[] = [];

      await expect(
        runCampaignReadinessDoctorCli(
          ["inspect", "--input", inputPath],
          {
            stdout: (text) => jsonOutput.push(text),
            stderr: (text) => stderr.push(text),
          },
          doctor,
        ),
      ).resolves.toBe(0);
      const report = JSON.parse(jsonOutput.join("")) as CampaignReadinessReport;
      await expect(
        runCampaignReadinessDoctorCli(
          ["inspect", "--input", inputPath, "--human"],
          {
            stdout: (text) => humanOutput.push(text),
            stderr: (text) => stderr.push(text),
          },
          doctor,
        ),
      ).resolves.toBe(0);

      expect(stderr).toEqual([]);
      expect(report.status).toBe("ready");
      expect(humanOutput.join("")).toBe(formatCampaignReadinessReport(report));
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("reports every ready check without mutating the inspected paths", async () => {
    const directory = await mkdtemp(join(tmpdir(), "campaign-doctor-ready-"));
    try {
      const input = await readyFixture(directory);
      const before = (await readdir(directory)).sort();
      const processCalls: string[][] = [];
      const doctor = openCampaignReadinessDoctor({
        clock: () => new Date(checkedAt),
        runProcess: async (options) => {
          processCalls.push([...options.args]);
          return readyProcess(options);
        },
      });

      const first = await doctor.inspect(input);
      const second = await doctor.inspect(input);

      expect(first).toEqual(second);
      expect(first.status).toBe("ready");
      expect(first.checks.map((check) => check.id)).toEqual([
        "docker",
        "runsc",
        "image",
        "provider-version",
        "account-readiness",
        "quota",
        "launch-capacity",
        "target-source",
        "dependency-sources",
        "prompt",
        "database",
        "scratch",
        "disk-headroom",
        "private-artifacts",
      ]);
      expect(first.checks.every((check) => check.status === "ready")).toBe(
        true,
      );
      expect((await readdir(directory)).sort()).toEqual(before);
      await expect(access(input.receiptRoot)).rejects.toMatchObject({
        code: "ENOENT",
      });
      await expect(
        access(input.manifest.plans[0]!.databasePath),
      ).rejects.toMatchObject({ code: "ENOENT" });
      expect(canonicalDigest(first)).toBe(canonicalDigest(second));
      const providerCalls = processCalls.filter((args) => args[0] === "run");
      expect(providerCalls).toHaveLength(2);
      expect(providerCalls[0]).toEqual(
        expect.arrayContaining([
          "--pull=never",
          "--runtime=runsc",
          "--network=none",
          "--read-only",
          "--entrypoint=claude",
          "--version",
        ]),
      );
      expect(providerCalls[0]).not.toContain(
        input.manifest.plans[0]!.targetSourceDirectory,
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("keeps unavailable readiness unknown and expired authentication blocked", async () => {
    const directory = await mkdtemp(join(tmpdir(), "campaign-doctor-auth-"));
    try {
      const input = await readyFixture(directory);
      const doctor = openCampaignReadinessDoctor({
        clock: () => new Date(checkedAt),
        runProcess: readyProcess,
      });
      const unavailable = await doctor.inspect({
        ...input,
        accountReadiness: {
          ...input.accountReadiness!,
          status: "unavailable",
        },
      });
      const unauthenticated = await doctor.inspect({
        ...input,
        accountReadiness: {
          ...input.accountReadiness!,
          status: "unauthenticated",
        },
      });

      expect(unavailable.status).toBe("unknown");
      expect(resultCheck(unavailable, "account-readiness")).toMatchObject({
        status: "unknown",
        reason: "account-readiness-unavailable",
      });
      expect(unauthenticated.status).toBe("blocked");
      expect(resultCheck(unauthenticated, "account-readiness")).toMatchObject({
        status: "blocked",
        reason: "account-unauthenticated",
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("reports a seven-day quota shortage independently", async () => {
    const directory = await mkdtemp(join(tmpdir(), "campaign-doctor-quota-"));
    try {
      const input = await readyFixture(directory);
      const doctor = openCampaignReadinessDoctor({
        clock: () => new Date(checkedAt),
        runProcess: readyProcess,
      });
      const report = await doctor.inspect({
        ...input,
        quotaObservation: {
          ...input.quotaObservation!,
          sevenDay: {
            ...input.quotaObservation!.sevenDay,
            usedPercentage: 89,
          },
        },
      });

      expect(report.status).toBe("blocked");
      expect(resultCheck(report, "quota")).toMatchObject({
        status: "blocked",
        reason: "seven-day-quota-reserve-reached",
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("reports an existing atomic launch claim without changing it", async () => {
    const directory = await mkdtemp(join(tmpdir(), "campaign-doctor-claim-"));
    try {
      const input = await readyFixture(directory);
      const claimDirectory = join(input.receiptRoot, input.planId);
      await mkdir(claimDirectory, { recursive: true });
      const before = await readdir(claimDirectory);
      const report = await openCampaignReadinessDoctor({
        clock: () => new Date(checkedAt),
        runProcess: readyProcess,
      }).inspect(input);

      expect(resultCheck(report, "launch-capacity")).toMatchObject({
        status: "blocked",
        reason: "plan-already-claimed",
      });
      expect(await readdir(claimDirectory)).toEqual(before);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("reports Docker failure without invoking dependent provider checks", async () => {
    const directory = await mkdtemp(
      join(tmpdir(), "campaign-doctor-infrastructure-"),
    );
    try {
      const input = await readyFixture(directory);
      const calls: string[][] = [];
      const doctor = openCampaignReadinessDoctor({
        clock: () => new Date(checkedAt),
        runProcess: async (options) => {
          calls.push([...options.args]);
          return { kind: "exited", exitCode: 1, stdout: "", stderr: "" };
        },
      });
      const report = await doctor.inspect(input);

      expect(resultCheck(report, "docker")).toMatchObject({
        status: "blocked",
        reason: "docker-unavailable",
      });
      expect(resultCheck(report, "runsc").status).toBe("unknown");
      expect(resultCheck(report, "image").status).toBe("unknown");
      expect(resultCheck(report, "provider-version").status).toBe("unknown");
      expect(calls).toHaveLength(1);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("blocks a provider executable version mismatch without invoking a model", async () => {
    const directory = await mkdtemp(
      join(tmpdir(), "campaign-doctor-provider-"),
    );
    try {
      const input = await readyFixture(directory);
      const doctor = openCampaignReadinessDoctor({
        clock: () => new Date(checkedAt),
        runProcess: async (options) =>
          options.args[0] === "run"
            ? {
                kind: "exited",
                exitCode: 0,
                stdout: "2.0.0 (Claude Code)\n",
                stderr: "",
              }
            : readyProcess(options),
      });
      const report = await doctor.inspect(input);

      expect(resultCheck(report, "provider-version")).toMatchObject({
        status: "blocked",
        reason: "provider-version-mismatch",
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("blocks an unsupported model profile before invoking its provider", async () => {
    const directory = await mkdtemp(
      join(tmpdir(), "campaign-doctor-runtime-profile-"),
    );
    try {
      const input = await readyFixture(directory);
      const calls: string[][] = [];
      const doctor = openCampaignReadinessDoctor({
        clock: () => new Date(checkedAt),
        runProcess: async (options) => {
          calls.push([...options.args]);
          return readyProcess(options);
        },
      });
      const report = await doctor.inspect({
        ...input,
        campaignInput: {
          ...input.campaignInput,
          agentRuntimeProfile: defineAgentRuntimeProfile({
            id: "claude-profile-unsupported-effort",
            ...claudeCodeNativeTransport,
            model: "claude-opus-5",
            effort: "ultra",
          }),
        },
      });

      expect(resultCheck(report, "provider-version")).toMatchObject({
        status: "blocked",
        reason: "runtime-profile-unsupported-profile",
      });
      expect(calls.some((args) => args[0] === "run")).toBe(false);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it.each([
    { name: "Target", file: "target/plugin.php", checkId: "target-source" },
    {
      name: "Dependency",
      file: "wordpress/version.php",
      checkId: "dependency-sources",
    },
    { name: "Prompt", file: "research.md", checkId: "prompt" },
  ])(
    "reports an independent $name binding failure",
    async ({ file, checkId }) => {
      const directory = await mkdtemp(
        join(tmpdir(), "campaign-doctor-binding-"),
      );
      try {
        const input = await readyFixture(directory);
        await writeFile(join(directory, file), "tampered\n");
        const report = await openCampaignReadinessDoctor({
          clock: () => new Date(checkedAt),
          runProcess: readyProcess,
        }).inspect(input);

        expect(report.status).toBe("blocked");
        expect(resultCheck(report, checkId).status).toBe("blocked");
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    },
  );

  it("reports database, scratch, and disk failures as separate checks", async () => {
    const directory = await mkdtemp(join(tmpdir(), "campaign-doctor-storage-"));
    try {
      const input = await readyFixture(directory);
      const plan = input.manifest.plans[0]!;
      await Promise.all([
        rm(dirname(plan.databasePath), { recursive: true, force: true }),
        rm(plan.scratchDirectory, { recursive: true, force: true }),
      ]);
      const inaccessible = await openCampaignReadinessDoctor({
        clock: () => new Date(checkedAt),
        runProcess: readyProcess,
      }).inspect(input);

      expect(resultCheck(inaccessible, "database").status).toBe("blocked");
      expect(resultCheck(inaccessible, "scratch").status).toBe("blocked");
      expect(resultCheck(inaccessible, "disk-headroom").status).toBe("unknown");

      await Promise.all([
        mkdir(dirname(plan.databasePath)),
        mkdir(plan.scratchDirectory),
      ]);
      const noHeadroom = await openCampaignReadinessDoctor({
        clock: () => new Date(checkedAt),
        runProcess: readyProcess,
      }).inspect({ ...input, minimumFreeDiskBytes: Number.MAX_SAFE_INTEGER });
      expect(resultCheck(noHeadroom, "disk-headroom")).toMatchObject({
        status: "blocked",
        reason: "disk-headroom-insufficient",
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("detects a tampered private resume artifact", async () => {
    const directory = await mkdtemp(
      join(tmpdir(), "campaign-doctor-artifact-"),
    );
    try {
      const input = await readyFixture(directory);
      const plan = input.manifest.plans[0]!;
      const store = new PrivateArtifactStore({
        rootDirectory: join(plan.scratchDirectory, "agent-checkpoints"),
        maxEntries: 20_000,
        maxBytes: 128 * 1024 * 1024,
      });
      const staging = await store.stage();
      await writeFile(join(staging.contentDirectory, "state.json"), "clean\n");
      const committed = await store.commit("checkpoint-doctor-1", staging);
      if (committed.status === "conflict") {
        throw new Error("Unexpected checkpoint conflict");
      }
      const dependencySnapshots = input.campaignInput.dependencySnapshots ?? [];
      const campaignInput: CampaignInput = {
        ...input.campaignInput,
        resumeFrom: {
          kind: "agent-checkpoint",
          schemaVersion: 1,
          checkpointId: committed.artifact.artifactId,
          stateDigest: committed.artifact.digest,
          stateEntries: committed.artifact.entries,
          stateBytes: committed.artifact.bytes,
          sessionId: "11111111-1111-4111-8111-111111111111",
          targetSnapshotDigest: input.campaignInput.targetSnapshot.digest,
          promptSetDigest: input.campaignInput.promptSet.digest,
          runtimeProfileDigest: input.campaignInput.agentRuntimeProfile.digest,
          permissionProfileDigest: input.campaignInput.permissionProfile.digest,
          dependencySnapshotsDigest: canonicalDigest(dependencySnapshots),
        },
      };
      await writeFile(
        join(
          plan.scratchDirectory,
          "agent-checkpoints",
          committed.artifact.artifactId,
          "content",
          "state.json",
        ),
        "tampered\n",
      );

      const report = await openCampaignReadinessDoctor({
        clock: () => new Date(checkedAt),
        runProcess: readyProcess,
      }).inspect({ ...input, campaignInput });

      expect(resultCheck(report, "private-artifacts")).toMatchObject({
        status: "blocked",
        reason: "private-artifact-integrity-mismatch",
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
