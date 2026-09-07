import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  openResearchCampaigns,
  type AgentCheckpointRef,
  type CampaignInput,
  type NativeAgentRuntime,
  type SealedAgentRun,
} from "../../src/research/index.js";

const temporaryDirectories: string[] = [];

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
  validationPromptSet: {
    id: "prompt-independent-validation-v1",
    digest:
      "sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
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
    maxEstimatedCostUsd: 10,
    digest:
      "sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
  },
};

function checkpointFor(run: SealedAgentRun): AgentCheckpointRef {
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
  };
}

describe("ResearchCampaigns", () => {
  it("restores a sealed stopped Campaign through its public interface", async () => {
    const directory = await mkdtemp(join(tmpdir(), "research-campaigns-"));
    temporaryDirectories.push(directory);
    const databasePath = join(directory, "agent-led.sqlite");

    const runtime: NativeAgentRuntime = {
      async execute(run) {
        return {
          schemaVersion: 1,
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
          checkpoint: checkpointFor(run),
          report: {
            schemaVersion: 1,
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
            schemaVersion: 1,
            runId: run.runId,
            runtimeProfileDigest: run.agentRuntimeProfile.digest,
            terminal: "completed",
            startedAt: "2026-09-07T03:00:00.000Z",
            completedAt: "2026-09-07T03:01:00.000Z",
            usage: { wallTimeMs: 60_000 },
            activity: { subagents: 0, tools: ["source.read"] },
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
            schemaVersion: 1,
            runId: run.runId,
            runtimeProfileDigest: run.agentRuntimeProfile.digest,
            terminal: "completed",
            startedAt: "2026-09-07T03:10:00.000Z",
            completedAt: "2026-09-07T03:11:00.000Z",
            usage: { wallTimeMs: 60_000 },
            activity: { subagents: 0, tools: ["source.read"] },
            report: {
              schemaVersion: 1,
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

  it("continues autonomously until the agent reports no actionable frontier", async () => {
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
    const campaigns = openResearchCampaigns({
      databasePath: join(directory, "agent-led.sqlite"),
      runtime: {
        async execute(run) {
          if (run.kind !== "sealed-native-research-run") {
            throw new Error("This scenario does not produce a candidate");
          }
          const invocation = run.history.length + 1;
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
            schemaVersion: 1,
            runId: run.runId,
            runtimeProfileDigest: run.agentRuntimeProfile.digest,
            terminal: "completed",
            startedAt: `2026-09-07T04:0${invocation}:00.000Z`,
            completedAt: `2026-09-07T04:0${invocation}:30.000Z`,
            usage: { wallTimeMs: 30_000 },
            activity: { subagents: invocation, tools: ["source.read"] },
            checkpoint,
            report: {
              schemaVersion: 1,
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
      status: "coverage-closed",
    });
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
    });
    campaigns.close();
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
            schemaVersion: 1,
            runId: run.runId,
            runtimeProfileDigest: run.agentRuntimeProfile.digest,
            terminal: "completed",
            startedAt: "2026-09-07T05:00:00.000Z",
            completedAt: "2026-09-07T05:01:00.000Z",
            usage: { wallTimeMs: 60_000 },
            activity: { subagents: 1, tools: ["source.search"] },
            checkpoint: checkpointFor(run),
            report: {
              schemaVersion: 1,
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

    await expect(campaigns.conduct(budgetInput)).resolves.toMatchObject({
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
            schemaVersion: 1,
            runId: "different-campaign:native:1",
            runtimeProfileDigest: run.agentRuntimeProfile.digest,
            terminal: "completed",
            startedAt: "2026-09-07T06:00:00.000Z",
            completedAt: "2026-09-07T06:01:00.000Z",
            usage: { wallTimeMs: 60_000 },
            activity: { subagents: 0, tools: ["source.read"] },
            checkpoint: checkpointFor(run),
            report: {
              schemaVersion: 1,
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

  it("stops before another run when reported wall-time exhausts the budget", async () => {
    const directory = await mkdtemp(join(tmpdir(), "research-wall-budget-"));
    temporaryDirectories.push(directory);
    const wallBudgetInput: CampaignInput = {
      ...input,
      campaignId: "campaign-wall-budget-1",
      budgetEnvelope: {
        ...input.budgetEnvelope,
        maxNativeRuns: 2,
        maxWallTimeMs: 50_000,
      },
    };
    const campaigns = openResearchCampaigns({
      databasePath: join(directory, "agent-led.sqlite"),
      runtime: {
        async execute(run) {
          return {
            schemaVersion: 1,
            runId: run.runId,
            runtimeProfileDigest: run.agentRuntimeProfile.digest,
            terminal: "completed",
            startedAt: "2026-09-07T07:00:00.000Z",
            completedAt: "2026-09-07T07:01:00.000Z",
            usage: { wallTimeMs: 60_000 },
            activity: { subagents: 1, tools: ["source.read"] },
            checkpoint: checkpointFor(run),
            report: {
              schemaVersion: 1,
              candidates: [],
              decision: {
                kind: "continue",
                reason: "One source-bound question remains.",
                nextActions: [
                  {
                    question: "Where is the value rendered?",
                    sourcePointers: ["render.php"],
                  },
                ],
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

  it("stops before another run when reported cost exhausts the budget", async () => {
    const directory = await mkdtemp(join(tmpdir(), "research-cost-budget-"));
    temporaryDirectories.push(directory);
    const costBudgetInput: CampaignInput = {
      ...input,
      campaignId: "campaign-cost-budget-1",
      budgetEnvelope: {
        ...input.budgetEnvelope,
        maxNativeRuns: 2,
        maxEstimatedCostUsd: 1,
      },
    };
    const campaigns = openResearchCampaigns({
      databasePath: join(directory, "agent-led.sqlite"),
      runtime: {
        async execute(run) {
          return {
            schemaVersion: 1,
            runId: run.runId,
            runtimeProfileDigest: run.agentRuntimeProfile.digest,
            terminal: "completed",
            startedAt: "2026-09-07T08:00:00.000Z",
            completedAt: "2026-09-07T08:00:30.000Z",
            usage: { wallTimeMs: 30_000, estimatedCostUsd: 1.25 },
            activity: { subagents: 1, tools: ["source.read"] },
            checkpoint: checkpointFor(run),
            report: {
              schemaVersion: 1,
              candidates: [],
              decision: {
                kind: "continue",
                reason: "One source-bound question remains.",
                nextActions: [
                  {
                    question: "Which handler stores the value?",
                    sourcePointers: ["handler.php"],
                  },
                ],
              },
            },
          };
        },
      },
    });

    await expect(campaigns.conduct(costBudgetInput)).resolves.toMatchObject({
      status: "incomplete",
    });
    await expect(
      campaigns.inspect({ campaignId: "campaign-cost-budget-1" }),
    ).resolves.toMatchObject({
      interruption: { reason: "budget-exhausted" },
      nativeRuns: [{ usage: { estimatedCostUsd: 1.25 } }],
    });
    campaigns.close();
  });

  it("keeps a budget-starved Validation incomplete instead of negative", async () => {
    const directory = await mkdtemp(join(tmpdir(), "research-candidate-"));
    temporaryDirectories.push(directory);
    const candidateInput: CampaignInput = {
      ...input,
      campaignId: "campaign-validation-pending-1",
    };
    const campaigns = openResearchCampaigns({
      databasePath: join(directory, "agent-led.sqlite"),
      runtime: {
        async execute(run) {
          return {
            schemaVersion: 1,
            runId: run.runId,
            runtimeProfileDigest: run.agentRuntimeProfile.digest,
            terminal: "completed",
            startedAt: "2026-09-07T09:00:00.000Z",
            completedAt: "2026-09-07T09:01:00.000Z",
            usage: { wallTimeMs: 60_000 },
            activity: { subagents: 2, tools: ["source.read"] },
            checkpoint: checkpointFor(run),
            report: {
              schemaVersion: 1,
              candidates: [
                {
                  candidateId: "candidate-persistent-output-1",
                  attackerPremise:
                    "An unauthenticated visitor can submit the public form.",
                  brokenSecurityProperty:
                    "Persisted attacker input must be made inert at privileged output.",
                  claim:
                    "An unauthenticated value is persisted and rendered to another principal without context-appropriate escaping.",
                  evidence: [
                    {
                      path: "includes/form.php",
                      location: "submit_form:42",
                      observation: "Stores the public form value.",
                    },
                    {
                      path: "admin/render.php",
                      location: "render_entry:99",
                      observation: "Renders the stored value in an attribute.",
                    },
                  ],
                },
              ],
              decision: {
                kind: "stop",
                basis:
                  "The candidate is source-bound and no separate actionable frontier remains.",
              },
            },
          };
        },
      },
    });

    await expect(campaigns.conduct(candidateInput)).resolves.toMatchObject({
      status: "incomplete",
    });
    await expect(
      campaigns.inspect({ campaignId: "campaign-validation-pending-1" }),
    ).resolves.toMatchObject({
      status: "incomplete",
      coverage: { status: "incomplete" },
      interruption: {
        reason: "budget-exhausted",
        summary:
          "The Native Run budget ended before Independent Validation completed.",
      },
      nativeRuns: [
        {
          report: {
            candidates: [{ candidateId: "candidate-persistent-output-1" }],
          },
        },
      ],
      validationRuns: [],
      findings: [],
    });
    campaigns.close();
  });

  it("creates a Finding only after one fresh independent source Validation", async () => {
    const directory = await mkdtemp(join(tmpdir(), "research-validation-"));
    temporaryDirectories.push(directory);
    const candidateInput: CampaignInput = {
      ...input,
      campaignId: "campaign-source-validated-1",
      validationPromptSet: {
        id: "prompt-independent-validation-v1",
        digest:
          "sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
      },
      budgetEnvelope: {
        ...input.budgetEnvelope,
        maxNativeRuns: 2,
      },
    };
    const seenValidationCandidates: string[] = [];
    const runtime: NativeAgentRuntime = {
      async execute(run) {
        if (run.kind === "sealed-native-validation-run") {
          expect("history" in run).toBe(false);
          seenValidationCandidates.push(run.candidate.candidateId);
          return {
            schemaVersion: 1,
            runId: run.runId,
            runtimeProfileDigest: run.agentRuntimeProfile.digest,
            terminal: "completed",
            startedAt: "2026-09-07T10:02:00.000Z",
            completedAt: "2026-09-07T10:03:00.000Z",
            usage: { wallTimeMs: 60_000 },
            activity: { subagents: 1, tools: ["source.read"] },
            report: {
              schemaVersion: 1,
              candidateId: run.candidate.candidateId,
              disposition: "source-validated",
              reason:
                "A public request controls persisted markup which is rendered to an administrator without context-appropriate escaping.",
              evidence: [
                {
                  path: "public/submit.php",
                  location: "submit_public_form:51",
                  observation:
                    "The unauthenticated handler persists the request value without sanitizing markup.",
                },
                {
                  path: "admin/entries.php",
                  location: "render_entry:103",
                  observation:
                    "The administrator view emits the persisted value without output escaping.",
                },
              ],
            },
          };
        }
        return {
          schemaVersion: 1,
          runId: run.runId,
          runtimeProfileDigest: run.agentRuntimeProfile.digest,
          terminal: "completed",
          startedAt: "2026-09-07T10:00:00.000Z",
          completedAt: "2026-09-07T10:01:00.000Z",
          usage: { wallTimeMs: 60_000 },
          activity: { subagents: 2, tools: ["source.read"] },
          checkpoint: checkpointFor(run),
          report: {
            schemaVersion: 1,
            candidates: [
              {
                candidateId: "candidate-unauth-stored-xss-1",
                attackerPremise:
                  "An unauthenticated visitor can submit the public form.",
                brokenSecurityProperty:
                  "Persisted attacker input must be made inert at privileged output.",
                claim:
                  "An unauthenticated form value is persisted and later rendered as active markup to an administrator.",
                evidence: [
                  {
                    path: "public/submit.php",
                    location: "submit_public_form:51",
                    observation: "Persists an unauthenticated request value.",
                  },
                  {
                    path: "admin/entries.php",
                    location: "render_entry:103",
                    observation:
                      "Emits the persisted value to an administrator.",
                  },
                ],
              },
            ],
            decision: {
              kind: "stop",
              basis:
                "The candidate is source-bound and no separate actionable frontier remains.",
            },
          },
        };
      },
    };
    const campaigns = openResearchCampaigns({
      databasePath: join(directory, "agent-led.sqlite"),
      runtime,
    });

    await expect(campaigns.conduct(candidateInput)).resolves.toMatchObject({
      status: "coverage-closed",
    });
    await expect(
      campaigns.inspect({ campaignId: "campaign-source-validated-1" }),
    ).resolves.toMatchObject({
      status: "coverage-closed",
      coverage: { status: "closed" },
      validationRuns: [
        {
          candidateId: "candidate-unauth-stored-xss-1",
          receipt: {
            terminal: "completed",
            report: { disposition: "source-validated" },
          },
        },
      ],
      findings: [
        {
          candidateId: "candidate-unauth-stored-xss-1",
          targetSnapshot: candidateInput.targetSnapshot,
          attackerPremise:
            "An unauthenticated visitor can submit the public form.",
          brokenSecurityProperty:
            "Persisted attacker input must be made inert at privileged output.",
          claim:
            "An unauthenticated form value is persisted and later rendered as active markup to an administrator.",
          assurance: "source-validated",
          validation: {
            runId: "campaign-source-validated-1:validation:1",
            promptSet: candidateInput.validationPromptSet,
            runtimeProfileDigest: candidateInput.agentRuntimeProfile.digest,
            permissionProfileDigest: candidateInput.permissionProfile.digest,
          },
        },
      ],
    });
    await expect(campaigns.conduct(candidateInput)).resolves.toMatchObject({
      status: "coverage-closed",
    });
    expect(seenValidationCandidates).toEqual(["candidate-unauth-stored-xss-1"]);
    campaigns.close();
  });

  it("returns a source-bound Validation proof gap to the Research Root", async () => {
    const directory = await mkdtemp(join(tmpdir(), "research-proof-gap-"));
    temporaryDirectories.push(directory);
    const proofGapInput: CampaignInput = {
      ...input,
      campaignId: "campaign-proof-gap-1",
      budgetEnvelope: {
        ...input.budgetEnvelope,
        maxNativeRuns: 3,
      },
    };
    let researchRuns = 0;
    const campaigns = openResearchCampaigns({
      databasePath: join(directory, "agent-led.sqlite"),
      runtime: {
        async execute(run) {
          if (run.kind === "sealed-native-validation-run") {
            return {
              schemaVersion: 1,
              runId: run.runId,
              runtimeProfileDigest: run.agentRuntimeProfile.digest,
              terminal: "completed",
              startedAt: "2026-09-07T11:01:00.000Z",
              completedAt: "2026-09-07T11:02:00.000Z",
              usage: { wallTimeMs: 60_000 },
              activity: { subagents: 0, tools: ["source.read"] },
              report: {
                schemaVersion: 1,
                candidateId: run.candidate.candidateId,
                disposition: "needs-research",
                reason:
                  "The write path is established, but the privileged renderer named in the claim is only referenced indirectly.",
                evidence: [
                  {
                    path: "public/save.php",
                    location: "save_value:44",
                    observation: "Persists the public request value.",
                  },
                ],
                nextActions: [
                  {
                    question:
                      "Which registered admin callback invokes render_saved_value?",
                    sourcePointers: ["admin/bootstrap.php", "admin/view.php"],
                  },
                ],
              },
            };
          }

          researchRuns += 1;
          if (researchRuns === 2) {
            expect(run.validationFeedback).toMatchObject([
              {
                candidateId: "candidate-proof-gap-1",
                report: {
                  disposition: "needs-research",
                  nextActions: [
                    {
                      question:
                        "Which registered admin callback invokes render_saved_value?",
                    },
                  ],
                },
              },
            ]);
            return {
              schemaVersion: 1,
              runId: run.runId,
              runtimeProfileDigest: run.agentRuntimeProfile.digest,
              terminal: "completed",
              startedAt: "2026-09-07T11:02:00.000Z",
              completedAt: "2026-09-07T11:03:00.000Z",
              usage: { wallTimeMs: 60_000 },
              activity: { subagents: 1, tools: ["source.read"] },
              checkpoint: checkpointFor(run),
              report: {
                schemaVersion: 1,
                candidates: [],
                decision: {
                  kind: "stop",
                  basis:
                    "The callback registration was traced and applies output escaping; no actionable frontier remains.",
                },
              },
            };
          }

          return {
            schemaVersion: 1,
            runId: run.runId,
            runtimeProfileDigest: run.agentRuntimeProfile.digest,
            terminal: "completed",
            startedAt: "2026-09-07T11:00:00.000Z",
            completedAt: "2026-09-07T11:01:00.000Z",
            usage: { wallTimeMs: 60_000 },
            activity: { subagents: 1, tools: ["source.read"] },
            checkpoint: checkpointFor(run),
            report: {
              schemaVersion: 1,
              candidates: [
                {
                  candidateId: "candidate-proof-gap-1",
                  attackerPremise:
                    "An unauthenticated visitor can submit the public form.",
                  brokenSecurityProperty:
                    "Persisted attacker input must be inert in privileged output.",
                  claim:
                    "A public request value reaches privileged HTML output without escaping.",
                  evidence: [
                    {
                      path: "public/save.php",
                      location: "save_value:44",
                      observation: "Persists the public request value.",
                    },
                  ],
                },
              ],
              decision: {
                kind: "stop",
                basis:
                  "The candidate is source-bound and no other frontier remains.",
              },
            },
          };
        },
      },
    });

    await expect(campaigns.conduct(proofGapInput)).resolves.toMatchObject({
      status: "coverage-closed",
    });
    await expect(
      campaigns.inspect({ campaignId: "campaign-proof-gap-1" }),
    ).resolves.toMatchObject({
      coverage: { status: "closed" },
      nativeRuns: [{}, {}],
      validationRuns: [
        {
          receipt: {
            terminal: "completed",
            report: { disposition: "needs-research" },
          },
        },
      ],
      findings: [],
    });
    campaigns.close();
  });
});
