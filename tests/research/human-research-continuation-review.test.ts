import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { canonicalDigest } from "../../src/infrastructure/canonical-json.js";
import {
  campaignInputSchema,
  type CampaignInput,
} from "../../src/research/index.js";
import type { SealedNativeRun } from "../../src/research/agent-led/contracts.js";
import {
  HumanResearchContinuationReviewConflictError,
  openResearchCampaigns,
} from "../../src/research/agent-led/research-campaigns.js";

const temporaryDirectories: string[] = [];
const digest = (character: string): string => `sha256:${character.repeat(64)}`;

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

function checkpointFor(run: SealedNativeRun) {
  return {
    kind: "agent-checkpoint" as const,
    schemaVersion: 1 as const,
    checkpointId: `${run.runId}:checkpoint`,
    stateDigest: digest("1"),
    stateEntries: 2,
    stateBytes: 128,
    sessionId: "12121212-1212-4121-8121-121212121212",
    targetSnapshotDigest: run.targetSnapshot.digest,
    promptSetDigest: run.promptSet.digest,
    runtimeProfileDigest: run.agentRuntimeProfile.digest,
    permissionProfileDigest: run.permissionProfile.digest,
  };
}

function campaignInput(campaignId: string): CampaignInput {
  return {
    kind: "agent-led-campaign",
    schemaVersion: 1,
    campaignId,
    targetSnapshot: {
      id: "target-course-suite-fixture-1.0.0",
      pluginSlug: "course-suite-fixture",
      version: "1.0.0",
      digest: digest("a"),
      sourceTree: { digest: digest("9"), entries: 10, bytes: 1_024 },
    },
    promptSet: { id: "research-v1", digest: digest("b") },
    agentRuntimeProfile: {
      id: "runtime-v1",
      kind: "scripted-native-agent/v1",
      executableVersion: "1.0.0",
      model: "scripted-model",
      effort: "high",
      digest: digest("d"),
    },
    permissionProfile: { id: "source-only-v1", digest: digest("e") },
    budgetEnvelope: {
      id: "budget-v1",
      maxNativeRuns: 10,
      maxWallTimeMs: 600_000,
      researchGrantWallTimeMs: 60_000,
      digest: digest("f"),
    },
  } as CampaignInput;
}

describe("Human Research Continuation Review", () => {
  it("caps every Research Grant at one hour", () => {
    const input = campaignInput("campaign-research-grant-cap-1");
    expect(
      campaignInputSchema.safeParse({
        ...input,
        budgetEnvelope: {
          ...input.budgetEnvelope,
          maxWallTimeMs: 7_200_000,
          researchGrantWallTimeMs: 3_600_001,
        },
      }).success,
    ).toBe(false);
  });

  it("pauses after one bounded Research Grant with an exact review request", async () => {
    const directory = await mkdtemp(join(tmpdir(), "research-review-"));
    temporaryDirectories.push(directory);
    const input = campaignInput("campaign-research-review-1");
    let invocations = 0;
    const campaigns = openResearchCampaigns({
      databasePath: join(directory, "research.sqlite"),
      runtime: {
        async execute(run) {
          invocations += 1;
          expect(run.kind).toBe("sealed-native-research-run");
          expect(run.budgetAllowance).toEqual({ maxWallTimeMs: 60_000 });
          if (run.kind !== "sealed-native-research-run") {
            throw new Error(
              "A second Research run must not start during review",
            );
          }
          return {
            schemaVersion: 1,
            runId: run.runId,
            runtimeProfileDigest: run.agentRuntimeProfile.digest,
            terminal: "completed",
            startedAt: "2026-09-09T02:00:00.000Z",
            completedAt: "2026-09-09T02:00:50.000Z",
            usage: { wallTimeMs: 50_000 },
            activity: { subagents: 2, tools: ["source.read"] },
            isolation: {
              backend: "gvisor",
              runtime: "runsc",
              fallbackUsed: false,
            },
            checkpoint: checkpointFor(run),
            report: {
              schemaVersion: 1,
              candidates: [
                {
                  candidateId: "candidate-unauth-record-archive",
                  attackerPremise:
                    "An unauthenticated visitor can call the public endpoint.",
                  brokenSecurityProperty:
                    "Anonymous identity must not satisfy record ownership checks.",
                  claim:
                    "A missing item lookup can make the endpoint archive a draft record.",
                  evidence: [
                    {
                      path: "src/api/item-controller.ts",
                      location: "complete_item:120",
                      observation:
                        "The ownership comparison normalizes missing identities to zero.",
                    },
                  ],
                },
              ],
              decision: {
                kind: "continue",
                reason: "The ownership model still needs source closure.",
                nextActions: [
                  {
                    question:
                      "Which repository value supplies ownerId after a failed item lookup?",
                    sourcePointers: ["src/domain/item-repository.ts"],
                  },
                ],
              },
            },
          };
        },
      },
    });

    await expect(campaigns.conduct(input)).resolves.toMatchObject({
      status: "research-review-pending",
    });
    expect(invocations).toBe(1);
    const pendingView = await campaigns.inspect({
      campaignId: input.campaignId,
    });
    expect(pendingView).toMatchObject({
      status: "research-review-pending",
      pendingResearchContinuationReview: {
        kind: "research-continuation-review-request",
        schemaVersion: 1,
        campaignId: input.campaignId,
        researchRunId: `${input.campaignId}:native:1`,
        checkpoint: { checkpointId: `${input.campaignId}:native:1:checkpoint` },
        candidates: [{ candidateId: "candidate-unauth-record-archive" }],
        nextActions: [
          {
            question:
              "Which repository value supplies ownerId after a failed item lookup?",
          },
        ],
        digest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
      },
    });
    campaigns.close();
  });

  it("runs one additional Research Grant from the reviewed checkpoint", async () => {
    const directory = await mkdtemp(join(tmpdir(), "research-continue-"));
    temporaryDirectories.push(directory);
    const input = campaignInput("campaign-research-continue-1");
    let invocations = 0;
    const campaigns = openResearchCampaigns({
      databasePath: join(directory, "research.sqlite"),
      runtime: {
        async execute(run) {
          if (run.kind !== "sealed-native-research-run") {
            throw new Error(
              "A second Research run is not part of this scenario",
            );
          }
          invocations += 1;
          if (invocations === 2) {
            expect(run.resumeFrom).toMatchObject({
              checkpointId: `${input.campaignId}:native:1:checkpoint`,
            });
            expect(run.researchContinuationNextActions).toEqual([
              {
                question: "Which callback consumes the stored identifier?",
                sourcePointers: ["inc/callbacks.php"],
              },
            ]);
            expect(JSON.stringify(run)).not.toContain(
              "The remaining source question is worth another grant.",
            );
          }
          return {
            schemaVersion: 1,
            runId: run.runId,
            runtimeProfileDigest: run.agentRuntimeProfile.digest,
            terminal: "completed",
            startedAt: `2026-09-09T03:0${invocations}:00.000Z`,
            completedAt: `2026-09-09T03:0${invocations}:50.000Z`,
            usage: { wallTimeMs: 50_000 },
            activity: { subagents: 1, tools: ["source.read"] },
            isolation: {
              backend: "gvisor",
              runtime: "runsc",
              fallbackUsed: false,
            },
            checkpoint: checkpointFor(run),
            report: {
              schemaVersion: 1,
              candidates: [],
              decision: {
                kind: "continue",
                reason: "A concrete source edge remains unresolved.",
                nextActions: [
                  {
                    question: "Which callback consumes the stored identifier?",
                    sourcePointers: ["inc/callbacks.php"],
                  },
                ],
              },
            },
          };
        },
      },
    });

    await campaigns.conduct(input);
    const request = (await campaigns.inspect({ campaignId: input.campaignId }))
      .pendingResearchContinuationReview;
    if (request === undefined)
      throw new Error("missing Research review request");
    const reviewBody = {
      kind: "human-research-continuation-review" as const,
      schemaVersion: 1 as const,
      reviewId: "research-review-continue-1",
      campaignId: input.campaignId,
      campaignInputDigest: request.campaignInputDigest,
      researchRunId: request.researchRunId,
      checkpointId: request.checkpoint.checkpointId,
      checkpointStateDigest: request.checkpoint.stateDigest,
      candidateSetDigest: request.candidateSetDigest,
      parkedProgrammeLeadSetDigest: request.parkedProgrammeLeadSetDigest,
      researchContinuationReviewRequestDigest: request.digest,
      operator: {
        identity: "human-operator-1",
        decidedAt: "2026-09-09T03:01:55.000Z",
      },
      decision: "continue-research" as const,
      reason: "The remaining source question is worth another grant.",
    };

    await expect(
      campaigns.conduct({
        ...reviewBody,
        digest: canonicalDigest(reviewBody),
      } as never),
    ).resolves.toMatchObject({ status: "research-review-pending" });
    expect(invocations).toBe(2);
    await expect(
      campaigns.inspect({ campaignId: input.campaignId }),
    ).resolves.toMatchObject({
      researchContinuationReviews: [
        {
          reviewId: "research-review-continue-1",
          decision: "continue-research",
        },
      ],
      nativeRuns: [
        { runId: `${input.campaignId}:native:1` },
        { runId: `${input.campaignId}:native:2` },
      ],
      pendingResearchContinuationReview: {
        researchRunId: `${input.campaignId}:native:2`,
      },
    });
    campaigns.close();
  });

  it("retries a failed reviewed Research Grant from its valid checkpoint", async () => {
    const directory = await mkdtemp(join(tmpdir(), "research-retry-"));
    temporaryDirectories.push(directory);
    const input = campaignInput("campaign-research-retry-1");
    let invocations = 0;
    const campaigns = openResearchCampaigns({
      databasePath: join(directory, "research.sqlite"),
      runtime: {
        async execute(run) {
          if (run.kind !== "sealed-native-research-run") {
            throw new Error(
              "A second Research run is not part of this scenario",
            );
          }
          invocations += 1;
          if (invocations === 2) {
            expect(run.resumeFrom).toMatchObject({
              checkpointId: `${input.campaignId}:native:1:checkpoint`,
            });
            expect(run.researchContinuationNextActions).toEqual([
              {
                question: "Which writer promotes the stored row?",
                sourcePointers: ["includes/writers.php"],
              },
            ]);
            return {
              schemaVersion: 1,
              runId: run.runId,
              runtimeProfileDigest: run.agentRuntimeProfile.digest,
              terminal: "provider-failed",
              startedAt: "2026-09-09T03:02:00.000Z",
              completedAt: "2026-09-09T03:02:06.000Z",
              usage: { wallTimeMs: 6_000 },
              activity: { subagents: 0, tools: [] },
              isolation: {
                backend: "gvisor",
                runtime: "runsc",
                fallbackUsed: false,
              },
              checkpoint: checkpointFor(run),
              failure: {
                summary: "Provider authentication expired.",
                stage: "provider-execution",
              },
            };
          }
          if (invocations === 3) {
            expect(run.resumeFrom).toMatchObject({
              checkpointId: `${input.campaignId}:native:2:checkpoint`,
            });
            expect(run.researchContinuationNextActions).toEqual([
              {
                question: "Which writer promotes the stored row?",
                sourcePointers: ["includes/writers.php"],
              },
            ]);
          }
          return {
            schemaVersion: 1,
            runId: run.runId,
            runtimeProfileDigest: run.agentRuntimeProfile.digest,
            terminal: "completed",
            startedAt: `2026-09-09T03:0${invocations}:10.000Z`,
            completedAt: `2026-09-09T03:0${invocations}:50.000Z`,
            usage: { wallTimeMs: 40_000 },
            activity: { subagents: 1, tools: ["source.read"] },
            isolation: {
              backend: "gvisor",
              runtime: "runsc",
              fallbackUsed: false,
            },
            checkpoint: checkpointFor(run),
            report: {
              schemaVersion: 1,
              candidates: [],
              decision:
                invocations === 1
                  ? {
                      kind: "continue" as const,
                      reason: "A source-bound edge still needs closure.",
                      nextActions: [
                        {
                          question: "Which writer promotes the stored row?",
                          sourcePointers: ["includes/writers.php"],
                        },
                      ],
                    }
                  : {
                      kind: "stop" as const,
                      basis: "The remaining edge is source-closed.",
                    },
            },
          };
        },
      },
    });

    await campaigns.conduct(input);
    const request = (await campaigns.inspect({ campaignId: input.campaignId }))
      .pendingResearchContinuationReview;
    if (request === undefined)
      throw new Error("missing Research review request");
    const reviewBody = {
      kind: "human-research-continuation-review" as const,
      schemaVersion: 1 as const,
      reviewId: "research-review-retry-1",
      campaignId: input.campaignId,
      campaignInputDigest: request.campaignInputDigest,
      researchRunId: request.researchRunId,
      checkpointId: request.checkpoint.checkpointId,
      checkpointStateDigest: request.checkpoint.stateDigest,
      candidateSetDigest: request.candidateSetDigest,
      parkedProgrammeLeadSetDigest: request.parkedProgrammeLeadSetDigest,
      researchContinuationReviewRequestDigest: request.digest,
      operator: {
        identity: "human-operator-1",
        decidedAt: "2026-09-09T03:01:55.000Z",
      },
      decision: "continue-research" as const,
      reason: "The source-bound edge is worth another grant.",
    };

    await expect(
      campaigns.conduct({
        ...reviewBody,
        digest: canonicalDigest(reviewBody),
      } as never),
    ).resolves.toMatchObject({ status: "incomplete" });
    expect(invocations).toBe(2);

    await expect(campaigns.conduct(input)).resolves.toMatchObject({
      status: "coverage-closed",
    });
    expect(invocations).toBe(3);
    await expect(
      campaigns.inspect({ campaignId: input.campaignId }),
    ).resolves.toMatchObject({
      nativeRuns: [
        { terminal: "completed" },
        { terminal: "provider-failed" },
        { terminal: "completed" },
      ],
      researchContinuationReviews: [
        {
          reviewId: "research-review-retry-1",
          decision: "continue-research",
        },
      ],
    });
    campaigns.close();
  });

  it("retries a reviewed Research Grant that could not start because the pinned sandbox was temporarily unavailable", async () => {
    const directory = await mkdtemp(join(tmpdir(), "research-sandbox-retry-"));
    temporaryDirectories.push(directory);
    const input = campaignInput("campaign-research-sandbox-retry-1");
    let invocations = 0;
    const campaigns = openResearchCampaigns({
      databasePath: join(directory, "research.sqlite"),
      runtime: {
        async execute(run) {
          if (run.kind !== "sealed-native-research-run") {
            throw new Error(
              "A second Research run is not part of this scenario",
            );
          }
          invocations += 1;
          if (invocations === 2) {
            expect(run.resumeFrom).toMatchObject({
              checkpointId: `${input.campaignId}:native:1:checkpoint`,
            });
            return {
              schemaVersion: 1,
              runId: run.runId,
              runtimeProfileDigest: run.agentRuntimeProfile.digest,
              terminal: "policy-denied",
              startedAt: "2026-09-09T03:02:00.000Z",
              completedAt: "2026-09-09T03:02:02.000Z",
              usage: { wallTimeMs: 2_000 },
              activity: { subagents: null, tools: null },
              failure: {
                summary: "The pinned gVisor Agent Sandbox is unavailable.",
                stage: "sandbox-preflight",
              },
            };
          }
          if (invocations === 3) {
            expect(run.resumeFrom).toMatchObject({
              checkpointId: `${input.campaignId}:native:1:checkpoint`,
            });
          }
          return {
            schemaVersion: 1,
            runId: run.runId,
            runtimeProfileDigest: run.agentRuntimeProfile.digest,
            terminal: "completed",
            startedAt: `2026-09-09T03:0${invocations}:10.000Z`,
            completedAt: `2026-09-09T03:0${invocations}:50.000Z`,
            usage: { wallTimeMs: 40_000 },
            activity: { subagents: 1, tools: ["source.read"] },
            isolation: {
              backend: "gvisor",
              runtime: "runsc",
              fallbackUsed: false,
            },
            checkpoint: checkpointFor(run),
            report: {
              schemaVersion: 1,
              candidates: [],
              decision:
                invocations === 1
                  ? {
                      kind: "continue" as const,
                      reason: "A source-bound edge still needs closure.",
                      nextActions: [
                        {
                          question: "Which writer promotes the stored row?",
                          sourcePointers: ["includes/writers.php"],
                        },
                      ],
                    }
                  : {
                      kind: "stop" as const,
                      basis: "The remaining edge is source-closed.",
                    },
            },
          };
        },
      },
    });

    await campaigns.conduct(input);
    const request = (await campaigns.inspect({ campaignId: input.campaignId }))
      .pendingResearchContinuationReview;
    if (request === undefined)
      throw new Error("missing Research review request");
    const reviewBody = {
      kind: "human-research-continuation-review" as const,
      schemaVersion: 1 as const,
      reviewId: "research-review-sandbox-retry-1",
      campaignId: input.campaignId,
      campaignInputDigest: request.campaignInputDigest,
      researchRunId: request.researchRunId,
      checkpointId: request.checkpoint.checkpointId,
      checkpointStateDigest: request.checkpoint.stateDigest,
      candidateSetDigest: request.candidateSetDigest,
      parkedProgrammeLeadSetDigest: request.parkedProgrammeLeadSetDigest,
      researchContinuationReviewRequestDigest: request.digest,
      operator: {
        identity: "human-operator-1",
        decidedAt: "2026-09-09T03:01:55.000Z",
      },
      decision: "continue-research" as const,
      reason: "The source-bound edge is worth another grant.",
    };

    await expect(
      campaigns.conduct({
        ...reviewBody,
        digest: canonicalDigest(reviewBody),
      } as never),
    ).resolves.toMatchObject({ status: "incomplete" });
    expect(invocations).toBe(2);

    await expect(campaigns.conduct(input)).resolves.toMatchObject({
      status: "coverage-closed",
    });
    expect(invocations).toBe(3);
    await expect(
      campaigns.inspect({ campaignId: input.campaignId }),
    ).resolves.toMatchObject({
      nativeRuns: [
        { terminal: "completed" },
        { terminal: "policy-denied" },
        { terminal: "completed" },
      ],
      researchContinuationReviews: [
        {
          reviewId: "research-review-sandbox-retry-1",
          decision: "continue-research",
        },
      ],
    });
    campaigns.close();
  });

  it("proceeds to the full Candidate review without starting more Research", async () => {
    const directory = await mkdtemp(join(tmpdir(), "research-proceed-"));
    temporaryDirectories.push(directory);
    const input = campaignInput("campaign-research-proceed-1");
    let invocations = 0;
    const campaigns = openResearchCampaigns({
      databasePath: join(directory, "research.sqlite"),
      runtime: {
        async execute(run) {
          invocations += 1;
          if (run.kind !== "sealed-native-research-run" || invocations !== 1) {
            throw new Error("Proceed must not start another Native Run");
          }
          return {
            schemaVersion: 1,
            runId: run.runId,
            runtimeProfileDigest: run.agentRuntimeProfile.digest,
            terminal: "completed",
            startedAt: "2026-09-09T04:00:00.000Z",
            completedAt: "2026-09-09T04:00:50.000Z",
            usage: { wallTimeMs: 50_000 },
            activity: { subagents: 1, tools: ["source.read"] },
            isolation: {
              backend: "gvisor",
              runtime: "runsc",
              fallbackUsed: false,
            },
            checkpoint: checkpointFor(run),
            report: {
              schemaVersion: 1,
              candidates: [
                {
                  candidateId: "candidate-resource-idor",
                  attackerPremise:
                    "An unauthenticated visitor can call the content RPC.",
                  brokenSecurityProperty:
                    "Collection authorization must bind the requested resource item.",
                  claim:
                    "Authorization against one collection can disclose another resource item.",
                  evidence: [
                    {
                      path: "src/api/resource-controller.ts",
                      location: "load_resource:90",
                      observation:
                        "The authorized collection id and fetched resource id are independent.",
                    },
                  ],
                },
              ],
              decision: {
                kind: "continue",
                reason:
                  "Additional RPC callbacks could reuse the same boundary.",
                nextActions: [
                  {
                    question:
                      "Which other callbacks accept independent object ids?",
                    sourcePointers: ["src/api/resource-controller.ts"],
                  },
                ],
              },
            },
          };
        },
      },
    });

    await campaigns.conduct(input);
    const request = (await campaigns.inspect({ campaignId: input.campaignId }))
      .pendingResearchContinuationReview;
    if (request === undefined)
      throw new Error("missing Research review request");
    const reviewBody = {
      kind: "human-research-continuation-review" as const,
      schemaVersion: 1 as const,
      reviewId: "research-review-proceed-1",
      campaignId: input.campaignId,
      campaignInputDigest: request.campaignInputDigest,
      researchRunId: request.researchRunId,
      checkpointId: request.checkpoint.checkpointId,
      checkpointStateDigest: request.checkpoint.stateDigest,
      candidateSetDigest: request.candidateSetDigest,
      parkedProgrammeLeadSetDigest: request.parkedProgrammeLeadSetDigest,
      researchContinuationReviewRequestDigest: request.digest,
      operator: {
        identity: "human-operator-1",
        decidedAt: "2026-09-09T04:01:00.000Z",
      },
      decision: "proceed-to-candidate-review" as const,
      reason: "The current material disclosure Candidate is ready for review.",
    };

    await expect(
      campaigns.conduct({
        ...reviewBody,
        digest: canonicalDigest(reviewBody),
      } as never),
    ).resolves.toMatchObject({ status: "candidate-review-pending" });
    expect(invocations).toBe(1);
    const proceeded = await campaigns.inspect({ campaignId: input.campaignId });
    expect(proceeded).toMatchObject({
      researchContinuationReviews: [
        {
          reviewId: "research-review-proceed-1",
          decision: "proceed-to-candidate-review",
        },
      ],
      pendingCandidateReview: {
        terminalResearchRunId: `${input.campaignId}:native:1`,
        candidates: [{ candidateId: "candidate-resource-idor" }],
      },
    });
    expect(proceeded.pendingResearchContinuationReview).toBeUndefined();
    campaigns.close();
  });

  it("rejects stale, partially bound, and candidate-less proceed reviews atomically", async () => {
    const directory = await mkdtemp(
      join(tmpdir(), "research-review-conflict-"),
    );
    temporaryDirectories.push(directory);
    const input = campaignInput("campaign-research-review-conflict-1");
    let invocations = 0;
    const campaigns = openResearchCampaigns({
      databasePath: join(directory, "research.sqlite"),
      runtime: {
        async execute(run) {
          if (run.kind !== "sealed-native-research-run") {
            throw new Error("A second Research run must not start");
          }
          invocations += 1;
          return {
            schemaVersion: 1,
            runId: run.runId,
            runtimeProfileDigest: run.agentRuntimeProfile.digest,
            terminal: "completed",
            startedAt: "2026-09-09T07:00:00.000Z",
            completedAt: "2026-09-09T07:00:50.000Z",
            usage: { wallTimeMs: 50_000 },
            activity: { subagents: 1, tools: ["source.read"] },
            isolation: {
              backend: "gvisor",
              runtime: "runsc",
              fallbackUsed: false,
            },
            checkpoint: checkpointFor(run),
            report: {
              schemaVersion: 1,
              candidates: [],
              decision: {
                kind: "continue",
                reason: "A concrete eligible route remains open.",
                nextActions: [
                  {
                    question:
                      "Can the endpoint update an administrator option?",
                    sourcePointers: ["inc/options.php"],
                  },
                ],
              },
            },
          };
        },
      },
    });

    await campaigns.conduct(input);
    const request = (await campaigns.inspect({ campaignId: input.campaignId }))
      .pendingResearchContinuationReview;
    if (request === undefined)
      throw new Error("missing Research review request");
    const validBody = {
      kind: "human-research-continuation-review" as const,
      schemaVersion: 1 as const,
      reviewId: "research-review-conflict-base",
      campaignId: input.campaignId,
      campaignInputDigest: request.campaignInputDigest,
      researchRunId: request.researchRunId,
      checkpointId: request.checkpoint.checkpointId,
      checkpointStateDigest: request.checkpoint.stateDigest,
      candidateSetDigest: request.candidateSetDigest,
      parkedProgrammeLeadSetDigest: request.parkedProgrammeLeadSetDigest,
      researchContinuationReviewRequestDigest: request.digest,
      operator: {
        identity: "human-operator-1",
        decidedAt: "2026-09-09T07:01:00.000Z",
      },
      decision: "continue-research" as const,
      reason: "The exact source-bound next action warrants another grant.",
    };
    const invalidBodies = [
      {
        ...validBody,
        reviewId: "wrong-input",
        campaignInputDigest: digest("2"),
      },
      { ...validBody, reviewId: "wrong-run", researchRunId: "stale-run" },
      {
        ...validBody,
        reviewId: "wrong-checkpoint",
        checkpointId: "stale-checkpoint",
      },
      {
        ...validBody,
        reviewId: "wrong-candidates",
        candidateSetDigest: digest("3"),
      },
      {
        ...validBody,
        reviewId: "wrong-parked-leads",
        parkedProgrammeLeadSetDigest: digest("4"),
      },
      {
        ...validBody,
        reviewId: "wrong-request",
        researchContinuationReviewRequestDigest: digest("5"),
      },
      {
        ...validBody,
        reviewId: "candidate-less-proceed",
        decision: "proceed-to-candidate-review" as const,
      },
    ];
    for (const body of invalidBodies) {
      await expect(
        campaigns.conduct({ ...body, digest: canonicalDigest(body) }),
      ).rejects.toBeInstanceOf(HumanResearchContinuationReviewConflictError);
    }
    expect(invocations).toBe(1);
    await expect(
      campaigns.inspect({ campaignId: input.campaignId }),
    ).resolves.toMatchObject({
      status: "research-review-pending",
      researchContinuationReviews: [],
    });
    campaigns.close();
  });
});
