import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { canonicalDigest } from "../../src/infrastructure/canonical-json.js";
import type { CampaignInput } from "../../src/research/index.js";
import type {
  AgentCheckpointRef,
  NativeAgentRuntime,
  ResearchCandidate,
  ResearchCampaigns,
  SealedNativeRun,
} from "../../src/research/agent-led/contracts.js";
import { openResearchCampaigns } from "../../src/research/agent-led/research-campaigns.js";
import { researchEvidenceSummaryFixture } from "./support/research-evidence-summary.js";

const temporaryDirectories: string[] = [];
const gvisorIsolation = {
  backend: "gvisor",
  runtime: "runsc",
  fallbackUsed: false,
} as const;

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

const input: CampaignInput = {
  kind: "agent-led-campaign",
  schemaVersion: 1,
  campaignId: "campaign-agent-led-1",
  targetSnapshot: {
    id: "target-brizy-2.8.11",
    pluginSlug: "brizy",
    version: "2.8.11",
    digest:
      "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    sourceTree: {
      digest:
        "sha256:9999999999999999999999999999999999999999999999999999999999999999",
      entries: 1,
      bytes: 6,
    },
  },
  promptSet: {
    id: "prompt-agent-led-v1",
    digest:
      "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  },
  agentRuntimeProfile: {
    id: "runtime-scripted-v1",
    kind: "scripted-native-agent/v1",
    executableVersion: "1.0.0",
    model: "scripted-model",
    effort: "high",
    digest:
      "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
  },
  permissionProfile: {
    id: "source-only-v1",
    digest:
      "sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
  },
  budgetEnvelope: {
    id: "budget-agent-led-v1",
    maxNativeRuns: 1,
    maxWallTimeMs: 600_000,
    researchGrantWallTimeMs: 600_000,
    digest:
      "sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
  },
};

function checkpointFor(run: SealedNativeRun): AgentCheckpointRef {
  const dependencySnapshots = run.dependencySnapshots ?? [];
  return {
    kind: "agent-checkpoint",
    schemaVersion: 1,
    checkpointId: `${run.runId}:checkpoint`,
    stateDigest:
      "sha256:1212121212121212121212121212121212121212121212121212121212121212",
    stateEntries: 1,
    stateBytes: 1,
    sessionId: "12121212-1212-4121-8121-121212121212",
    targetSnapshotDigest: run.targetSnapshot.digest,
    promptSetDigest: run.promptSet.digest,
    runtimeProfileDigest: run.agentRuntimeProfile.digest,
    permissionProfileDigest: run.permissionProfile.digest,
    ...(dependencySnapshots.length === 0
      ? {}
      : { dependencySnapshotsDigest: canonicalDigest(dependencySnapshots) }),
  };
}

function candidateFor(claim: string): ResearchCandidate {
  return {
    candidateId: "candidate-shared-id",
    attackerPremise: "Unauthenticated visitor",
    brokenSecurityProperty: "Only administrators may update plugin options",
    claim,
    evidence: [
      {
        path: "includes/options.php",
        location: "42",
        observation: "The public callback writes an attacker-controlled value.",
      },
    ],
    sourceTrace: [
      {
        role: "entrypoint",
        path: "includes/options.php",
        location: "18",
        observation: "A public callback accepts the value.",
      },
      {
        role: "effect",
        path: "includes/options.php",
        location: "42",
        observation: "The callback persists the value as a plugin option.",
      },
    ],
    controlAssessments: [
      {
        control: "Administrator capability check",
        evidence: [
          {
            path: "includes/options.php",
            location: "24",
            observation:
              "The callback does not check an administrator capability.",
          },
        ],
        conclusion: "No source-visible authority check prevents the write.",
      },
    ],
    unresolvedFacts: [],
  };
}

async function conductWithHumanAdvance(
  campaigns: ResearchCampaigns,
  campaignInput: CampaignInput,
) {
  let outcome = await campaigns.conduct(campaignInput);
  while (
    outcome.status === "research-review-pending" ||
    outcome.status === "candidate-review-pending"
  ) {
    const view = await campaigns.inspect({
      campaignId: campaignInput.campaignId,
    });
    if (outcome.status === "research-review-pending") {
      const request = view.pendingResearchContinuationReview;
      if (request === undefined) {
        throw new Error("missing Research continuation review request");
      }
      const reviewBody = {
        kind: "human-research-continuation-review" as const,
        schemaVersion: 1 as const,
        reviewId: `research-review:${request.researchRunId}`,
        campaignId: campaignInput.campaignId,
        campaignInputDigest: request.campaignInputDigest,
        researchRunId: request.researchRunId,
        checkpointId: request.checkpoint.checkpointId,
        checkpointStateDigest: request.checkpoint.stateDigest,
        candidateSetDigest: request.candidateSetDigest,
        parkedProgrammeLeadSetDigest: request.parkedProgrammeLeadSetDigest,
        researchContinuationReviewRequestDigest: request.digest,
        operator: {
          identity: "test-human-reviewer",
          decidedAt: "2026-09-09T00:00:00.000Z",
        },
        decision: "continue-research" as const,
        reason: "The source-bound next actions warrant another Research Grant.",
      };
      outcome = await campaigns.conduct({
        ...reviewBody,
        digest: canonicalDigest(reviewBody),
      });
      continue;
    }
    const request = view.pendingCandidateReview;
    if (request === undefined)
      throw new Error("missing Candidate review request");
    const reviewBody = {
      kind: "human-candidate-review" as const,
      schemaVersion: 1 as const,
      reviewId: `review:${request.terminalResearchRunId}`,
      campaignId: campaignInput.campaignId,
      campaignInputDigest: request.campaignInputDigest,
      terminalResearchRunId: request.terminalResearchRunId,
      candidateSetDigest: request.candidateSetDigest,
      candidateReviewRequestDigest: request.digest,
      operator: {
        identity: "test-human-reviewer",
        decidedAt: "2026-09-09T00:00:00.000Z",
      },
      decisions: request.candidates.map((candidate) => ({
        candidateId: candidate.candidateId,
        disposition: "advance-to-candidate-verification" as const,
        reason: "The Candidate warrants fresh runtime verification.",
      })),
    };
    outcome = await campaigns.conduct({
      ...reviewBody,
      digest: canonicalDigest(reviewBody),
    });
  }
  return outcome;
}

describe("ResearchCampaigns", () => {
  it("restores a sealed stopped Campaign through its public interface", async () => {
    const directory = await mkdtemp(join(tmpdir(), "research-campaigns-"));
    temporaryDirectories.push(directory);
    const databasePath = join(directory, "agent-led.sqlite");

    const runtime: NativeAgentRuntime = {
      async execute(run) {
        return {
          schemaVersion: 2,
          runId: run.runId,
          runtimeProfileDigest: run.agentRuntimeProfile.digest,
          terminal: "completed",
          startedAt: "2026-09-07T01:00:00.000Z",
          completedAt: "2026-09-07T01:02:00.000Z",
          usage: {
            wallTimeMs: 120_000,
            inputTokens: 10_000,
            outputTokens: 2_000,
            estimatedCostUsd: 1.25,
          },
          activity: {
            subagents: 2,
            tools: ["source.search", "source.read"],
          },
          isolation: gvisorIsolation,
          checkpoint: checkpointFor(run),
          report: {
            schemaVersion: 2,
            assessments: [],
            evidenceSummary: researchEvidenceSummaryFixture(),
            candidates: [],
            decision: {
              kind: "stop",
              basis:
                "No source-bound actionable frontier remains after whole-target review.",
            },
          },
        };
      },
    };

    const active = openResearchCampaigns({ databasePath, runtime });
    const outcome = await active.conduct(input);
    expect(outcome).toMatchObject({
      campaignId: "campaign-agent-led-1",
      status: "coverage-closed",
    });
    active.close();

    const reopened = openResearchCampaigns({
      databasePath,
      runtime: {
        async execute() {
          throw new Error("inspect must not rerun research");
        },
      },
    });

    await expect(
      reopened.inspect({ campaignId: "campaign-agent-led-1" }),
    ).resolves.toMatchObject({
      campaignId: "campaign-agent-led-1",
      status: "coverage-closed",
      input,
      nativeRuns: [
        {
          terminal: "completed",
          runtimeProfileDigest: input.agentRuntimeProfile.digest,
          usage: {
            wallTimeMs: 120_000,
            inputTokens: 10_000,
            outputTokens: 2_000,
            estimatedCostUsd: 1.25,
          },
          activity: {
            subagents: 2,
            tools: ["source.search", "source.read"],
          },
          report: {
            candidates: [],
            decision: {
              kind: "stop",
              basis:
                "No source-bound actionable frontier remains after whole-target review.",
            },
          },
        },
      ],
    });
    reopened.close();
  });

  it("restores a provider failure as incomplete instead of a negative result", async () => {
    const directory = await mkdtemp(join(tmpdir(), "research-incomplete-"));
    temporaryDirectories.push(directory);
    const databasePath = join(directory, "agent-led.sqlite");
    const failedInput: CampaignInput = {
      ...input,
      campaignId: "campaign-provider-failed-1",
    };
    const active = openResearchCampaigns({
      databasePath,
      runtime: {
        async execute() {
          throw new Error("synthetic provider outage");
        },
      },
      clock: () => new Date("2026-09-07T02:00:00.000Z"),
    });

    await expect(active.conduct(failedInput)).resolves.toMatchObject({
      campaignId: "campaign-provider-failed-1",
      status: "incomplete",
    });
    active.close();

    const reopened = openResearchCampaigns({
      databasePath,
      runtime: {
        async execute() {
          throw new Error("inspect must not rerun research");
        },
      },
    });
    await expect(
      reopened.inspect({ campaignId: "campaign-provider-failed-1" }),
    ).resolves.toMatchObject({
      status: "incomplete",
      nativeRuns: [
        {
          terminal: "provider-failed",
          usage: { wallTimeMs: 0 },
          activity: { subagents: null, tools: null },
          failure: {
            summary: "Native Agent Runtime failed before returning a receipt.",
          },
        },
      ],
    });
    reopened.close();
  });

  it("reopens a started Native Run as one orphaned attempt without rerunning it", async () => {
    const directory = await mkdtemp(join(tmpdir(), "research-orphaned-run-"));
    temporaryDirectories.push(directory);
    const databasePath = join(directory, "agent-led.sqlite");
    const orphanedInput: CampaignInput = {
      ...input,
      campaignId: "campaign-orphaned-run-1",
    };
    let invocations = 0;
    let markExecutionStarted!: () => void;
    const executionStarted = new Promise<void>((resolve) => {
      markExecutionStarted = resolve;
    });
    const active = openResearchCampaigns({
      databasePath,
      runtime: {
        async execute() {
          invocations += 1;
          markExecutionStarted();
          return await new Promise<never>(() => undefined);
        },
      },
      clock: () => new Date("2026-09-07T01:30:00.000Z"),
    });

    void active.conduct(orphanedInput);
    await executionStarted;
    active.close();

    const reopened = openResearchCampaigns({
      databasePath,
      runtime: {
        async execute() {
          throw new Error("An orphaned attempt must not spend quota again");
        },
      },
    });
    await expect(
      reopened.inspect({ campaignId: orphanedInput.campaignId }),
    ).resolves.toMatchObject({
      schemaVersion: 3,
      status: "incomplete",
      nativeRuns: [],
      nativeRunAttempts: [
        {
          status: "orphaned",
          startedAt: "2026-09-07T01:30:00.000Z",
          run: {
            runId: "campaign-orphaned-run-1:native:1",
            campaignId: orphanedInput.campaignId,
            campaignInputDigest: canonicalDigest(orphanedInput),
          },
          runDigest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
        },
      ],
    });
    await expect(reopened.conduct(orphanedInput)).resolves.toMatchObject({
      status: "incomplete",
    });
    expect(invocations).toBe(1);
    reopened.close();
  });

  it("recovers a finalized Native Run Receipt after terminal persistence is interrupted", async () => {
    const directory = await mkdtemp(join(tmpdir(), "research-run-recovery-"));
    temporaryDirectories.push(directory);
    const databasePath = join(directory, "agent-led.sqlite");
    const recoverableInput: CampaignInput = {
      ...input,
      campaignId: "campaign-run-recovery-1",
    };
    let active!: ResearchCampaigns;
    active = openResearchCampaigns({
      databasePath,
      runtime: {
        async execute(run) {
          active.close();
          return {
            schemaVersion: 2,
            runId: run.runId,
            runtimeProfileDigest: run.agentRuntimeProfile.digest,
            terminal: "completed",
            startedAt: "2026-09-07T01:45:00.000Z",
            completedAt: "2026-09-07T01:46:00.000Z",
            usage: { wallTimeMs: 60_000 },
            activity: { subagents: 1, tools: ["source.read"] },
            isolation: gvisorIsolation,
            checkpoint: checkpointFor(run),
            report: {
              schemaVersion: 2,
              assessments: [],
              evidenceSummary: researchEvidenceSummaryFixture(),
              candidates: [],
              decision: {
                kind: "stop",
                basis: "No actionable frontier remains.",
              },
            },
          };
        },
      },
      clock: () => new Date("2026-09-07T01:45:00.000Z"),
    });

    await expect(active.conduct(recoverableInput)).rejects.toThrow();

    let recoveryRuntimeInvocations = 0;
    const reopened = openResearchCampaigns({
      databasePath,
      runtime: {
        async execute() {
          recoveryRuntimeInvocations += 1;
          throw new Error("Recovery must not execute the provider again");
        },
      },
    });
    await expect(reopened.conduct(recoverableInput)).resolves.toMatchObject({
      schemaVersion: 3,
      status: "coverage-closed",
    });
    expect(recoveryRuntimeInvocations).toBe(0);
    await expect(
      reopened.inspect({ campaignId: recoverableInput.campaignId }),
    ).resolves.toMatchObject({
      nativeRunAttempts: [
        {
          status: "terminal",
          nativeRunReceiptDigest: expect.stringMatching(
            /^sha256:[a-f0-9]{64}$/,
          ),
        },
      ],
      nativeRuns: [
        {
          runId: "campaign-run-recovery-1:native:1",
          terminal: "completed",
        },
      ],
    });
    reopened.close();
  });

  it.each(["malformed", "mismatched"] as const)(
    "does not recover a %s Native Run Receipt artifact",
    async (artifactCondition) => {
      const directory = await mkdtemp(
        join(tmpdir(), `research-run-${artifactCondition}-`),
      );
      temporaryDirectories.push(directory);
      const databasePath = join(directory, "agent-led.sqlite");
      const campaignInput: CampaignInput = {
        ...input,
        campaignId: `campaign-run-${artifactCondition}-1`,
      };
      let active!: ResearchCampaigns;
      active = openResearchCampaigns({
        databasePath,
        runtime: {
          async execute(run) {
            active.close();
            return {
              schemaVersion: 2,
              runId: run.runId,
              runtimeProfileDigest: run.agentRuntimeProfile.digest,
              terminal: "provider-failed",
              startedAt: "2026-09-07T01:50:00.000Z",
              completedAt: "2026-09-07T01:50:01.000Z",
              usage: { wallTimeMs: 1_000 },
              activity: { subagents: null, tools: null },
              failure: { summary: "Synthetic finalized failure Receipt." },
            };
          },
        },
        clock: () => new Date("2026-09-07T01:50:00.000Z"),
      });
      await expect(active.conduct(campaignInput)).rejects.toThrow();

      const receiptRoot = join(
        `${databasePath}.private`,
        "native-run-receipts",
      );
      const receiptDirectory = (
        await readdir(receiptRoot, {
          withFileTypes: true,
        })
      ).find((entry) => entry.isDirectory());
      if (receiptDirectory === undefined) {
        throw new Error("Missing finalized Receipt fixture");
      }
      const receiptPath = join(
        receiptRoot,
        receiptDirectory.name,
        "receipt.json",
      );
      if (artifactCondition === "malformed") {
        await writeFile(receiptPath, "not-json", "utf8");
      } else {
        const artifact = JSON.parse(await readFile(receiptPath, "utf8")) as {
          runDigest: string;
        };
        artifact.runDigest =
          "sha256:0000000000000000000000000000000000000000000000000000000000000000";
        await writeFile(receiptPath, JSON.stringify(artifact), "utf8");
      }

      let runtimeInvocations = 0;
      const reopened = openResearchCampaigns({
        databasePath,
        runtime: {
          async execute() {
            runtimeInvocations += 1;
            throw new Error("Invalid recovery must not execute the provider");
          },
        },
      });
      await expect(reopened.conduct(campaignInput)).resolves.toMatchObject({
        status: "incomplete",
      });
      expect(runtimeInvocations).toBe(0);
      await expect(
        reopened.inspect({ campaignId: campaignInput.campaignId }),
      ).resolves.toMatchObject({
        nativeRuns: [],
        nativeRunAttempts: [{ status: "orphaned" }],
      });
      reopened.close();
    },
  );

  it("does not retry a sandbox policy denial that the runtime did not mark retryable", async () => {
    const directory = await mkdtemp(join(tmpdir(), "research-policy-denied-"));
    temporaryDirectories.push(directory);
    const deniedInput: CampaignInput = {
      ...input,
      campaignId: "campaign-policy-denied-1",
    };
    let invocations = 0;
    const campaigns = openResearchCampaigns({
      databasePath: join(directory, "agent-led.sqlite"),
      runtime: {
        async execute(run) {
          invocations += 1;
          return {
            schemaVersion: 2,
            runId: run.runId,
            runtimeProfileDigest: run.agentRuntimeProfile.digest,
            terminal: "policy-denied",
            startedAt: "2026-09-07T02:00:00.000Z",
            completedAt: "2026-09-07T02:00:01.000Z",
            usage: { wallTimeMs: 1_000 },
            activity: { subagents: null, tools: null },
            failure: {
              summary:
                "The mounted Target source does not match its sealed source tree.",
              stage: "sandbox-preflight",
            },
          };
        },
      },
    });

    await expect(campaigns.conduct(deniedInput)).resolves.toMatchObject({
      status: "incomplete",
    });
    await expect(campaigns.conduct(deniedInput)).resolves.toMatchObject({
      status: "incomplete",
    });
    expect(invocations).toBe(1);
    campaigns.close();
  });

  it("resumes a Campaign whose provider authentication failed before any model work", async () => {
    const directory = await mkdtemp(
      join(tmpdir(), "research-unauthenticated-"),
    );
    temporaryDirectories.push(directory);
    const unauthenticatedInput: CampaignInput = {
      ...input,
      campaignId: "campaign-unauthenticated-1",
      budgetEnvelope: {
        ...input.budgetEnvelope,
        maxNativeRuns: 3,
      },
    };
    let invocations = 0;
    const campaigns = openResearchCampaigns({
      databasePath: join(directory, "agent-led.sqlite"),
      runtime: {
        async execute(run) {
          invocations += 1;
          return {
            schemaVersion: 2,
            runId: run.runId,
            runtimeProfileDigest: run.agentRuntimeProfile.digest,
            terminal: "provider-unauthenticated",
            startedAt: "2026-09-07T02:00:00.000Z",
            completedAt: "2026-09-07T02:00:01.000Z",
            usage: { wallTimeMs: 1_000 },
            activity: { subagents: null, tools: null },
            isolation: gvisorIsolation,
            failure: {
              summary: "Claude Code could not authenticate with the provider.",
              stage: "provider-execution",
              retryable: true,
            },
          };
        },
      },
    });

    await expect(
      campaigns.conduct(unauthenticatedInput),
    ).resolves.toMatchObject({ status: "incomplete" });
    await expect(
      campaigns.conduct(unauthenticatedInput),
    ).resolves.toMatchObject({ status: "incomplete" });
    await expect(
      campaigns.conduct(unauthenticatedInput),
    ).resolves.toMatchObject({ status: "incomplete" });
    expect(invocations).toBe(2);
    campaigns.close();
  });

  it("does not repeat a Research Grant into an exhausted provider quota", async () => {
    const directory = await mkdtemp(join(tmpdir(), "research-quota-"));
    temporaryDirectories.push(directory);
    const quotaInput: CampaignInput = {
      ...input,
      campaignId: "campaign-quota-exhausted-1",
      budgetEnvelope: {
        ...input.budgetEnvelope,
        maxNativeRuns: 2,
      },
    };
    let invocations = 0;
    const campaigns = openResearchCampaigns({
      databasePath: join(directory, "agent-led.sqlite"),
      runtime: {
        async execute(run) {
          invocations += 1;
          return {
            schemaVersion: 2,
            runId: run.runId,
            runtimeProfileDigest: run.agentRuntimeProfile.digest,
            terminal: "provider-quota-exhausted",
            startedAt: "2026-09-07T02:00:00.000Z",
            completedAt: "2026-09-07T02:20:00.000Z",
            usage: { wallTimeMs: 1_200_000, estimatedCostUsd: 6.5 },
            activity: { subagents: null, tools: null },
            isolation: gvisorIsolation,
            failure: {
              summary: "Claude Code reached the provider usage limit.",
              stage: "provider-execution",
            },
          };
        },
      },
    });

    await expect(campaigns.conduct(quotaInput)).resolves.toMatchObject({
      status: "incomplete",
    });
    await expect(campaigns.conduct(quotaInput)).resolves.toMatchObject({
      status: "incomplete",
    });
    expect(invocations).toBe(1);
    await expect(
      campaigns.inspect({ campaignId: "campaign-quota-exhausted-1" }),
    ).resolves.toMatchObject({
      status: "incomplete",
      nativeRuns: [
        {
          terminal: "provider-quota-exhausted",
          usage: { estimatedCostUsd: 6.5 },
        },
      ],
    });
    campaigns.close();
  });

  it("records invalid provider output as an incomplete Campaign", async () => {
    const directory = await mkdtemp(join(tmpdir(), "research-invalid-output-"));
    temporaryDirectories.push(directory);
    const invalidInput: CampaignInput = {
      ...input,
      campaignId: "campaign-invalid-output-1",
    };
    const campaigns = openResearchCampaigns({
      databasePath: join(directory, "agent-led.sqlite"),
      runtime: {
        async execute(run) {
          return {
            schemaVersion: 2,
            runId: run.runId,
            runtimeProfileDigest: run.agentRuntimeProfile.digest,
            terminal: "completed",
            startedAt: "2026-09-07T03:00:00.000Z",
            completedAt: "2026-09-07T03:01:00.000Z",
            usage: { wallTimeMs: 60_000 },
            activity: { subagents: 0, tools: ["source.read"] },
            isolation: gvisorIsolation,
            report: { decision: "not-a-research-decision" },
          } as unknown as Awaited<ReturnType<NativeAgentRuntime["execute"]>>;
        },
      },
      clock: () => new Date("2026-09-07T03:02:00.000Z"),
    });

    await expect(campaigns.conduct(invalidInput)).resolves.toMatchObject({
      campaignId: "campaign-invalid-output-1",
      status: "incomplete",
    });
    await expect(
      campaigns.inspect({ campaignId: "campaign-invalid-output-1" }),
    ).resolves.toMatchObject({
      nativeRuns: [
        {
          terminal: "invalid-output",
          failure: {
            summary:
              "Native Agent Runtime returned an unsupported output schema.",
          },
        },
      ],
    });
    campaigns.close();
  });

  it("does not claim resumable Research when the runtime omits its Checkpoint", async () => {
    const directory = await mkdtemp(join(tmpdir(), "research-no-checkpoint-"));
    temporaryDirectories.push(directory);
    const noCheckpointInput: CampaignInput = {
      ...input,
      campaignId: "campaign-no-checkpoint-1",
    };
    const campaigns = openResearchCampaigns({
      databasePath: join(directory, "agent-led.sqlite"),
      runtime: {
        async execute(run) {
          return {
            schemaVersion: 2,
            runId: run.runId,
            runtimeProfileDigest: run.agentRuntimeProfile.digest,
            terminal: "completed",
            startedAt: "2026-09-07T03:10:00.000Z",
            completedAt: "2026-09-07T03:11:00.000Z",
            usage: { wallTimeMs: 60_000 },
            activity: { subagents: 0, tools: ["source.read"] },
            isolation: gvisorIsolation,
            report: {
              schemaVersion: 2,
              assessments: [],
              evidenceSummary: researchEvidenceSummaryFixture(),
              candidates: [],
              decision: {
                kind: "stop",
                basis: "The runtime returned a conclusion without state.",
              },
            },
          } as unknown as Awaited<ReturnType<NativeAgentRuntime["execute"]>>;
        },
      },
      clock: () => new Date("2026-09-07T03:12:00.000Z"),
    });

    await expect(campaigns.conduct(noCheckpointInput)).resolves.toMatchObject({
      status: "incomplete",
    });
    await expect(
      campaigns.inspect({ campaignId: noCheckpointInput.campaignId }),
    ).resolves.toMatchObject({
      nativeRuns: [
        {
          terminal: "invalid-output",
          failure: {
            summary:
              "Native Agent Runtime returned an unsupported output schema.",
          },
        },
      ],
    });
    campaigns.close();
  });

  it("continues only after a human accepts the next Research Grant", async () => {
    const directory = await mkdtemp(join(tmpdir(), "research-continues-"));
    temporaryDirectories.push(directory);
    const continuingInput: CampaignInput = {
      ...input,
      campaignId: "campaign-continues-1",
      budgetEnvelope: {
        ...input.budgetEnvelope,
        maxNativeRuns: 2,
      },
    };
    let invocation = 0;
    const campaigns = openResearchCampaigns({
      databasePath: join(directory, "agent-led.sqlite"),
      runtime: {
        async execute(run) {
          if (run.kind !== "sealed-native-research-run") {
            throw new Error("This scenario does not produce a candidate");
          }
          invocation += 1;
          const checkpoint = {
            kind: "agent-checkpoint" as const,
            schemaVersion: 1 as const,
            checkpointId: `checkpoint-${invocation}`,
            stateDigest:
              invocation === 1
                ? "sha256:1111111111111111111111111111111111111111111111111111111111111111"
                : "sha256:2222222222222222222222222222222222222222222222222222222222222222",
            stateEntries: 2,
            stateBytes: 128,
            sessionId: "8f6d59a8-a2de-4a75-8a33-9f8065fc9a11",
            targetSnapshotDigest: run.targetSnapshot.digest,
            promptSetDigest: run.promptSet.digest,
            runtimeProfileDigest: run.agentRuntimeProfile.digest,
            permissionProfileDigest: run.permissionProfile.digest,
          };
          if (invocation === 2) {
            expect(run.resumeFrom).toMatchObject({
              checkpointId: "checkpoint-1",
              stateDigest:
                "sha256:1111111111111111111111111111111111111111111111111111111111111111",
            });
          }
          return {
            schemaVersion: 2,
            runId: run.runId,
            runtimeProfileDigest: run.agentRuntimeProfile.digest,
            terminal: "completed",
            startedAt: `2026-09-07T04:0${invocation}:00.000Z`,
            completedAt: `2026-09-07T04:0${invocation}:30.000Z`,
            usage: { wallTimeMs: 30_000 },
            activity: { subagents: invocation, tools: ["source.read"] },
            isolation: gvisorIsolation,
            checkpoint,
            report: {
              schemaVersion: 2,
              assessments: [],
              evidenceSummary: researchEvidenceSummaryFixture(),
              candidates: [],
              decision:
                invocation === 1
                  ? {
                      kind: "continue" as const,
                      reason: "A concrete persistence boundary remains open.",
                      nextActions: [
                        {
                          question:
                            "Which read path renders the persisted value?",
                          sourcePointers: ["includes/form.php"],
                        },
                      ],
                    }
                  : {
                      kind: "stop" as const,
                      basis:
                        "The remaining persistence boundary was resolved and no actionable frontier remains.",
                    },
            },
          };
        },
      },
    });

    await expect(campaigns.conduct(continuingInput)).resolves.toMatchObject({
      status: "research-review-pending",
    });
    expect(invocation).toBe(1);
    await expect(
      conductWithHumanAdvance(campaigns, continuingInput),
    ).resolves.toMatchObject({ status: "coverage-closed" });
    await expect(
      campaigns.inspect({ campaignId: "campaign-continues-1" }),
    ).resolves.toMatchObject({
      nativeRuns: [
        {
          checkpoint: { checkpointId: "checkpoint-1" },
          report: { decision: { kind: "continue" } },
        },
        {
          checkpoint: { checkpointId: "checkpoint-2" },
          report: { decision: { kind: "stop" } },
        },
      ],
      researchContinuationReviews: [
        { decision: "continue-research", researchRunId: expect.any(String) },
      ],
    });
    campaigns.close();
  });

  it("preserves a completed Native Run when its Candidate cannot be admitted", async () => {
    const directory = await mkdtemp(
      join(tmpdir(), "research-candidate-admission-conflict-"),
    );
    temporaryDirectories.push(directory);
    const databasePath = join(directory, "agent-led.sqlite");
    const conflictInput: CampaignInput = {
      ...input,
      campaignId: "campaign-candidate-admission-conflict-1",
      budgetEnvelope: {
        ...input.budgetEnvelope,
        maxNativeRuns: 2,
      },
    };
    let invocation = 0;
    const campaigns = openResearchCampaigns({
      databasePath,
      runtime: {
        async execute(run) {
          invocation += 1;
          return {
            schemaVersion: 2,
            runId: run.runId,
            runtimeProfileDigest: run.agentRuntimeProfile.digest,
            terminal: "completed",
            startedAt: `2026-09-07T04:1${invocation}:00.000Z`,
            completedAt: `2026-09-07T04:1${invocation}:30.000Z`,
            usage: {
              wallTimeMs: 30_000,
              estimatedCostUsd: invocation === 1 ? 1.25 : 2.5,
            },
            activity: { subagents: 1, tools: ["source.read"] },
            isolation: gvisorIsolation,
            checkpoint: checkpointFor(run),
            report: {
              schemaVersion: 2,
              assessments: [],
              evidenceSummary: researchEvidenceSummaryFixture(),
              candidates: [
                candidateFor(
                  invocation === 1
                    ? "The public callback updates a plugin option."
                    : "The public callback updates a different administrator option.",
                ),
              ],
              decision:
                invocation === 1
                  ? {
                      kind: "continue" as const,
                      reason: "One source-bound consumer remains unresolved.",
                      nextActions: [
                        {
                          question: "Where is the stored value consumed?",
                          sourcePointers: ["includes/render.php"],
                        },
                      ],
                    }
                  : {
                      kind: "stop" as const,
                      basis: "No actionable frontier remains.",
                    },
            },
          };
        },
      },
    });

    await expect(
      conductWithHumanAdvance(campaigns, conflictInput),
    ).resolves.toMatchObject({ status: "incomplete" });
    await expect(
      campaigns.inspect({ campaignId: conflictInput.campaignId }),
    ).resolves.toMatchObject({
      schemaVersion: 3,
      status: "incomplete",
      admissionFailure: {
        reason: "candidate-identity-conflict",
        runId: "campaign-candidate-admission-conflict-1:native:2",
      },
      candidateVerificationRequests: [],
      nativeRuns: [
        { terminal: "completed" },
        {
          terminal: "completed",
          usage: { estimatedCostUsd: 2.5 },
          checkpoint: {
            checkpointId:
              "campaign-candidate-admission-conflict-1:native:2:checkpoint",
          },
          report: {
            candidates: [
              {
                candidateId: "candidate-shared-id",
                claim:
                  "The public callback updates a different administrator option.",
              },
            ],
          },
        },
      ],
    });
    campaigns.close();

    const reopened = openResearchCampaigns({
      databasePath,
      runtime: {
        async execute() {
          throw new Error("Inspection must not execute another Native Run");
        },
      },
    });
    await expect(
      reopened.inspect({ campaignId: conflictInput.campaignId }),
    ).resolves.toMatchObject({
      status: "incomplete",
      admissionFailure: {
        reason: "candidate-identity-conflict",
        runId: "campaign-candidate-admission-conflict-1:native:2",
      },
      nativeRuns: [{ terminal: "completed" }, { terminal: "completed" }],
    });
    reopened.close();
  });

  it("records budget exhaustion as incomplete while preserving the frontier", async () => {
    const directory = await mkdtemp(join(tmpdir(), "research-budget-"));
    temporaryDirectories.push(directory);
    const budgetInput: CampaignInput = {
      ...input,
      campaignId: "campaign-budget-exhausted-1",
    };
    const campaigns = openResearchCampaigns({
      databasePath: join(directory, "agent-led.sqlite"),
      runtime: {
        async execute(run) {
          return {
            schemaVersion: 2,
            runId: run.runId,
            runtimeProfileDigest: run.agentRuntimeProfile.digest,
            terminal: "completed",
            startedAt: "2026-09-07T05:00:00.000Z",
            completedAt: "2026-09-07T05:01:00.000Z",
            usage: { wallTimeMs: 60_000 },
            activity: { subagents: 1, tools: ["source.search"] },
            isolation: gvisorIsolation,
            checkpoint: checkpointFor(run),
            report: {
              schemaVersion: 2,
              assessments: [],
              evidenceSummary: researchEvidenceSummaryFixture(),
              candidates: [],
              decision: {
                kind: "continue",
                reason: "A concrete authorization boundary remains unresolved.",
                nextActions: [
                  {
                    question: "Which callback consumes the public nonce?",
                    sourcePointers: ["plugin.php"],
                  },
                ],
              },
            },
          };
        },
      },
    });

    await expect(
      conductWithHumanAdvance(campaigns, budgetInput),
    ).resolves.toMatchObject({
      status: "incomplete",
    });
    await expect(
      campaigns.inspect({ campaignId: "campaign-budget-exhausted-1" }),
    ).resolves.toMatchObject({
      status: "incomplete",
      interruption: {
        reason: "budget-exhausted",
        summary:
          "The Native Run budget ended with an actionable frontier remaining.",
      },
      nativeRuns: [
        {
          terminal: "completed",
          report: { decision: { kind: "continue" } },
        },
      ],
    });
    campaigns.close();
  });

  it("rejects an unbound receipt without losing the Campaign record", async () => {
    const directory = await mkdtemp(join(tmpdir(), "research-binding-"));
    temporaryDirectories.push(directory);
    const bindingInput: CampaignInput = {
      ...input,
      campaignId: "campaign-unbound-receipt-1",
    };
    const campaigns = openResearchCampaigns({
      databasePath: join(directory, "agent-led.sqlite"),
      runtime: {
        async execute(run) {
          return {
            schemaVersion: 2,
            runId: "different-campaign:native:1",
            runtimeProfileDigest: run.agentRuntimeProfile.digest,
            terminal: "completed",
            startedAt: "2026-09-07T06:00:00.000Z",
            completedAt: "2026-09-07T06:01:00.000Z",
            usage: { wallTimeMs: 60_000 },
            activity: { subagents: 0, tools: ["source.read"] },
            isolation: gvisorIsolation,
            checkpoint: checkpointFor(run),
            report: {
              schemaVersion: 2,
              assessments: [],
              evidenceSummary: researchEvidenceSummaryFixture(),
              candidates: [],
              decision: {
                kind: "stop",
                basis: "This receipt is valid JSON but belongs to another run.",
              },
            },
          };
        },
      },
      clock: () => new Date("2026-09-07T06:02:00.000Z"),
    });

    await expect(campaigns.conduct(bindingInput)).resolves.toMatchObject({
      status: "incomplete",
    });
    await expect(
      campaigns.inspect({ campaignId: "campaign-unbound-receipt-1" }),
    ).resolves.toMatchObject({
      nativeRuns: [
        {
          terminal: "invalid-output",
          runId: "campaign-unbound-receipt-1:native:1",
          failure: {
            summary:
              "Native Run Receipt did not match the sealed Campaign binding.",
          },
        },
      ],
    });
    campaigns.close();
  });

  it("keeps a terminal report incomplete when it exceeds the wall-time budget", async () => {
    const directory = await mkdtemp(join(tmpdir(), "research-wall-budget-"));
    temporaryDirectories.push(directory);
    const wallBudgetInput: CampaignInput = {
      ...input,
      campaignId: "campaign-wall-budget-1",
      budgetEnvelope: {
        ...input.budgetEnvelope,
        maxNativeRuns: 2,
        maxWallTimeMs: 50_000,
        researchGrantWallTimeMs: 50_000,
      },
    };
    const campaigns = openResearchCampaigns({
      databasePath: join(directory, "agent-led.sqlite"),
      runtime: {
        async execute(run) {
          return {
            schemaVersion: 2,
            runId: run.runId,
            runtimeProfileDigest: run.agentRuntimeProfile.digest,
            terminal: "completed",
            startedAt: "2026-09-07T07:00:00.000Z",
            completedAt: "2026-09-07T07:01:00.000Z",
            usage: { wallTimeMs: 60_000 },
            activity: { subagents: 1, tools: ["source.read"] },
            isolation: gvisorIsolation,
            checkpoint: checkpointFor(run),
            report: {
              schemaVersion: 2,
              assessments: [],
              evidenceSummary: researchEvidenceSummaryFixture(),
              candidates: [],
              decision: {
                kind: "stop",
                basis: "No actionable frontier remains.",
              },
            },
          };
        },
      },
    });

    await expect(campaigns.conduct(wallBudgetInput)).resolves.toMatchObject({
      status: "incomplete",
    });
    await expect(
      campaigns.inspect({ campaignId: "campaign-wall-budget-1" }),
    ).resolves.toMatchObject({
      interruption: { reason: "budget-exhausted" },
      nativeRuns: [{ usage: { wallTimeMs: 60_000 } }],
    });
    campaigns.close();
  });

  it("records reported cost without using it as a Campaign stop condition", async () => {
    const directory = await mkdtemp(
      join(tmpdir(), "research-cost-observation-"),
    );
    temporaryDirectories.push(directory);
    const costObservationInput = {
      ...input,
      campaignId: "campaign-cost-observation-1",
      budgetEnvelope: {
        ...input.budgetEnvelope,
        maxNativeRuns: 2,
      },
    };
    const campaigns = openResearchCampaigns({
      databasePath: join(directory, "agent-led.sqlite"),
      runtime: {
        async execute(run) {
          return {
            schemaVersion: 2,
            runId: run.runId,
            runtimeProfileDigest: run.agentRuntimeProfile.digest,
            terminal: "completed",
            startedAt: "2026-09-07T08:00:00.000Z",
            completedAt: "2026-09-07T08:00:30.000Z",
            usage: { wallTimeMs: 30_000, estimatedCostUsd: 1.25 },
            activity: { subagents: 1, tools: ["source.read"] },
            isolation: gvisorIsolation,
            checkpoint: checkpointFor(run),
            report: {
              schemaVersion: 2,
              assessments: [],
              evidenceSummary: researchEvidenceSummaryFixture(),
              candidates: [],
              decision: {
                kind: "stop",
                basis: "No actionable frontier remains.",
              },
            },
          };
        },
      },
    });

    await expect(
      campaigns.conduct(costObservationInput),
    ).resolves.toMatchObject({
      status: "coverage-closed",
    });
    await expect(
      campaigns.inspect({ campaignId: "campaign-cost-observation-1" }),
    ).resolves.toMatchObject({
      nativeRuns: [{ usage: { estimatedCostUsd: 1.25 } }],
    });
    campaigns.close();
  });

  it("gives each run only the remaining wall-time allowance", async () => {
    const directory = await mkdtemp(join(tmpdir(), "research-allowance-"));
    temporaryDirectories.push(directory);
    const allowanceInput: CampaignInput = {
      ...input,
      campaignId: "campaign-allowance-1",
      budgetEnvelope: {
        ...input.budgetEnvelope,
        maxNativeRuns: 2,
        maxWallTimeMs: 100_000,
        researchGrantWallTimeMs: 100_000,
      },
    };
    const seenRuns: SealedNativeRun[] = [];
    const campaigns = openResearchCampaigns({
      databasePath: join(directory, "agent-led.sqlite"),
      runtime: {
        async execute(run) {
          seenRuns.push(run);
          const first = seenRuns.length === 1;
          return {
            schemaVersion: 2,
            runId: run.runId,
            runtimeProfileDigest: run.agentRuntimeProfile.digest,
            terminal: "completed",
            startedAt: first
              ? "2026-09-07T08:00:00.000Z"
              : "2026-09-07T08:00:40.000Z",
            completedAt: first
              ? "2026-09-07T08:00:40.000Z"
              : "2026-09-07T08:01:00.000Z",
            usage: {
              wallTimeMs: first ? 40_000 : 20_000,
              estimatedCostUsd: first ? 0.75 : 0.5,
            },
            activity: { subagents: 1, tools: ["source.read"] },
            isolation: gvisorIsolation,
            checkpoint: checkpointFor(run),
            report: {
              schemaVersion: 2,
              assessments: [],
              evidenceSummary: researchEvidenceSummaryFixture(),
              candidates: [],
              decision: first
                ? {
                    kind: "continue" as const,
                    reason: "One source-bound question remains.",
                    nextActions: [
                      {
                        question: "Where is the value rendered?",
                        sourcePointers: ["render.php"],
                      },
                    ],
                  }
                : {
                    kind: "stop" as const,
                    basis: "No actionable frontier remains.",
                  },
            },
          };
        },
      },
    });

    await expect(
      conductWithHumanAdvance(campaigns, allowanceInput),
    ).resolves.toMatchObject({
      status: "coverage-closed",
    });
    expect(seenRuns).toMatchObject([
      {
        budgetAllowance: {
          maxWallTimeMs: 100_000,
        },
      },
      {
        budgetAllowance: {
          maxWallTimeMs: 60_000,
        },
      },
    ]);
    campaigns.close();
  });
});
