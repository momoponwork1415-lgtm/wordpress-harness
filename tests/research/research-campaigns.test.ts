import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  openResearchCampaigns,
  type CampaignInput,
  type NativeAgentRuntime,
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
    maxEstimatedCostUsd: 10,
    digest:
      "sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
  },
};

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
          activity: { subagents: 0, tools: [] },
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
          const invocation = run.history.length + 1;
          return {
            schemaVersion: 1,
            runId: run.runId,
            runtimeProfileDigest: run.agentRuntimeProfile.digest,
            terminal: "completed",
            startedAt: `2026-09-07T04:0${invocation}:00.000Z`,
            completedAt: `2026-09-07T04:0${invocation}:30.000Z`,
            usage: { wallTimeMs: 30_000 },
            activity: { subagents: invocation, tools: ["source.read"] },
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
        { report: { decision: { kind: "continue" } } },
        { report: { decision: { kind: "stop" } } },
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
});
