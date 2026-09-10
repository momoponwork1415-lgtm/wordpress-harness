import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { canonicalDigest } from "../../src/infrastructure/canonical-json.js";
import type { CampaignInput } from "../../src/research/index.js";
import type {
  NativeAgentRuntime,
  SealedAgentRun,
} from "../../src/research/agent-led/contracts.js";
import { openResearchCampaigns } from "../../src/research/agent-led/research-campaigns.js";

const temporaryDirectories: string[] = [];
const digest = (character: string): string => `sha256:${character.repeat(64)}`;
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
    validationPromptSet: { id: "validation-v1", digest: digest("c") },
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
      maxNativeRuns: 3,
      maxWallTimeMs: 600_000,
      researchGrantWallTimeMs: 600_000,
      digest: digest("f"),
    },
  };
}

function checkpointFor(run: SealedAgentRun) {
  return {
    kind: "agent-checkpoint" as const,
    schemaVersion: 1 as const,
    checkpointId: `${run.runId}:checkpoint`,
    stateDigest: digest("1"),
    stateEntries: 1,
    stateBytes: 64,
    sessionId: "12121212-1212-4121-8121-121212121212",
    targetSnapshotDigest: run.targetSnapshot.digest,
    promptSetDigest: run.promptSet.digest,
    runtimeProfileDigest: run.agentRuntimeProfile.digest,
    permissionProfileDigest: run.permissionProfile.digest,
  };
}

function stoppedResearchRuntime(): NativeAgentRuntime {
  return {
    async execute(run) {
      if (run.kind === "sealed-native-validation-run") {
        throw new Error("Validation must wait for human Candidate review");
      }
      return {
        schemaVersion: 1,
        runId: run.runId,
        runtimeProfileDigest: run.agentRuntimeProfile.digest,
        terminal: "completed",
        startedAt: "2026-09-09T01:00:00.000Z",
        completedAt: "2026-09-09T01:01:00.000Z",
        usage: { wallTimeMs: 60_000 },
        activity: { subagents: 2, tools: ["source.read"] },
        isolation: gvisorIsolation,
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
                "A missing item lookup can make the endpoint archive another user's draft record.",
              evidence: [
                {
                  path: "src/api/item-controller.ts",
                  location: "complete_item:120",
                  observation:
                    "The ownership comparison normalizes the missing item and caller to the same sentinel.",
                },
              ],
            },
          ],
          decision: {
            kind: "stop",
            basis: "No separate actionable frontier remains.",
          },
        },
      };
    },
  };
}

describe("Human Candidate Review", () => {
  it("waits on the exact stopped Candidate set before Independent Validation", async () => {
    const directory = await mkdtemp(join(tmpdir(), "candidate-review-"));
    temporaryDirectories.push(directory);
    const input = campaignInput("campaign-candidate-review-1");
    const campaigns = openResearchCampaigns({
      databasePath: join(directory, "research.sqlite"),
      runtime: stoppedResearchRuntime(),
    });

    await expect(campaigns.conduct(input)).resolves.toMatchObject({
      status: "candidate-review-pending",
    });
    const pendingView = await campaigns.inspect({
      campaignId: input.campaignId,
    });
    expect(pendingView).toMatchObject({
      status: "candidate-review-pending",
      validationRuns: [],
      findings: [],
      pendingCandidateReview: {
        kind: "candidate-review-request",
        schemaVersion: 1,
        campaignId: input.campaignId,
        terminalResearchRunId: `${input.campaignId}:native:1`,
        candidates: [{ candidateId: "candidate-unauth-record-archive" }],
        digest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
      },
    });
    campaigns.close();
  });

  it("validates an advanced Candidate only after recording a complete review", async () => {
    const directory = await mkdtemp(join(tmpdir(), "candidate-advance-"));
    temporaryDirectories.push(directory);
    const input = campaignInput("campaign-candidate-advance-1");
    const validationCandidates: unknown[] = [];
    const researchRuntime = stoppedResearchRuntime();
    const campaigns = openResearchCampaigns({
      databasePath: join(directory, "research.sqlite"),
      runtime: {
        async execute(run) {
          if (run.kind === "sealed-native-research-run") {
            return researchRuntime.execute(run);
          }
          validationCandidates.push(run.candidate);
          expect(run).not.toHaveProperty("candidateReview");
          return {
            schemaVersion: 1,
            runId: run.runId,
            runtimeProfileDigest: run.agentRuntimeProfile.digest,
            terminal: "completed",
            startedAt: "2026-09-09T01:02:00.000Z",
            completedAt: "2026-09-09T01:03:00.000Z",
            usage: { wallTimeMs: 60_000 },
            activity: { subagents: 0, tools: ["source.read"] },
            isolation: gvisorIsolation,
            report: {
              schemaVersion: 1,
              candidateId: run.candidate.candidateId,
              disposition: "disproven",
              reason: "The final sink applies an ownership check.",
              evidence: [
                {
                  path: "src/api/item-controller.ts",
                  location: "complete_item:130",
                  observation:
                    "The resolved record owner is checked before archiving.",
                },
              ],
            },
          };
        },
      },
    });

    await campaigns.conduct(input);
    const pending = (await campaigns.inspect({ campaignId: input.campaignId }))
      .pendingCandidateReview;
    if (pending === undefined)
      throw new Error("missing Candidate review request");
    const reviewBody = {
      kind: "human-candidate-review" as const,
      schemaVersion: 1 as const,
      reviewId: "review-candidate-advance-1",
      campaignId: input.campaignId,
      campaignInputDigest: pending.campaignInputDigest,
      terminalResearchRunId: pending.terminalResearchRunId,
      candidateSetDigest: pending.candidateSetDigest,
      candidateReviewRequestDigest: pending.digest,
      operator: {
        identity: "human-operator-1",
        decidedAt: "2026-09-09T01:01:30.000Z",
      },
      decisions: [
        {
          candidateId: "candidate-unauth-record-archive",
          disposition: "advance-to-independent-validation" as const,
          reason:
            "The attacker is unauthenticated and the claimed effect can archive content.",
        },
      ],
    };
    const review = { ...reviewBody, digest: canonicalDigest(reviewBody) };

    await expect(campaigns.conduct(review as never)).resolves.toMatchObject({
      status: "coverage-closed",
    });
    const completed = await campaigns.inspect({ campaignId: input.campaignId });
    expect(completed).toMatchObject({
      candidateReviews: [
        {
          reviewId: "review-candidate-advance-1",
          decisions: [
            {
              candidateId: "candidate-unauth-record-archive",
              disposition: "advance-to-independent-validation",
            },
          ],
        },
      ],
      validationRuns: [{ candidateId: "candidate-unauth-record-archive" }],
      findings: [],
    });
    expect(completed.pendingCandidateReview).toBeUndefined();
    expect(validationCandidates).toEqual([
      expect.objectContaining({
        candidateId: "candidate-unauth-record-archive",
      }),
    ]);
    campaigns.close();
  });

  it("returns only concrete source questions to Research before requesting a fresh full review", async () => {
    const directory = await mkdtemp(join(tmpdir(), "candidate-return-"));
    temporaryDirectories.push(directory);
    const input = campaignInput("campaign-candidate-return-1");
    const baseResearchRuntime = stoppedResearchRuntime();
    let researchRuns = 0;
    const campaigns = openResearchCampaigns({
      databasePath: join(directory, "research.sqlite"),
      runtime: {
        async execute(run) {
          if (run.kind === "sealed-native-validation-run") {
            throw new Error("Validation must wait for the next full review");
          }
          researchRuns += 1;
          if (researchRuns === 2) {
            expect(run.candidateReviewNextActions).toEqual([
              {
                candidateId: "candidate-unauth-record-archive",
                nextActions: [
                  {
                    question:
                      "Which repository result supplies ownerId when the item lookup fails?",
                    sourcePointers: ["src/domain/item-repository.ts"],
                  },
                ],
              },
            ]);
            expect(JSON.stringify(run)).not.toContain(
              "Impact looks plausible, but ownership normalization needs closure.",
            );
          }
          return baseResearchRuntime.execute(run);
        },
      },
    });

    await campaigns.conduct(input);
    const firstRequest = (
      await campaigns.inspect({ campaignId: input.campaignId })
    ).pendingCandidateReview;
    if (firstRequest === undefined)
      throw new Error("missing first review request");
    const reviewBody = {
      kind: "human-candidate-review" as const,
      schemaVersion: 1 as const,
      reviewId: "review-candidate-return-1",
      campaignId: input.campaignId,
      campaignInputDigest: firstRequest.campaignInputDigest,
      terminalResearchRunId: firstRequest.terminalResearchRunId,
      candidateSetDigest: firstRequest.candidateSetDigest,
      candidateReviewRequestDigest: firstRequest.digest,
      operator: {
        identity: "human-operator-1",
        decidedAt: "2026-09-09T01:01:30.000Z",
      },
      decisions: [
        {
          candidateId: "candidate-unauth-record-archive",
          disposition: "return-to-research" as const,
          reason:
            "Impact looks plausible, but ownership normalization needs closure.",
          nextActions: [
            {
              question:
                "Which repository result supplies ownerId when the item lookup fails?",
              sourcePointers: ["src/domain/item-repository.ts"],
            },
          ],
        },
      ],
    };

    await expect(
      campaigns.conduct({
        ...reviewBody,
        digest: canonicalDigest(reviewBody),
      } as never),
    ).resolves.toMatchObject({ status: "candidate-review-pending" });
    const resumed = await campaigns.inspect({ campaignId: input.campaignId });
    expect(resumed).toMatchObject({
      status: "candidate-review-pending",
      nativeRuns: [
        { runId: `${input.campaignId}:native:1` },
        { runId: `${input.campaignId}:native:2` },
      ],
      validationRuns: [],
      candidateReviews: [{ reviewId: "review-candidate-return-1" }],
      pendingCandidateReview: {
        terminalResearchRunId: `${input.campaignId}:native:2`,
      },
    });
    expect(resumed.pendingCandidateReview?.digest).not.toBe(
      firstRequest.digest,
    );
    campaigns.close();
  });

  it.each([
    {
      disposition: "park-programme-oos" as const,
      campaignId: "campaign-candidate-park-1",
    },
    {
      disposition: "hold-scope-ambiguous" as const,
      campaignId: "campaign-candidate-hold-1",
    },
  ])(
    "preserves a $disposition Candidate without running Validation",
    async ({ disposition, campaignId }) => {
      const directory = await mkdtemp(join(tmpdir(), "candidate-preserve-"));
      temporaryDirectories.push(directory);
      const input = campaignInput(campaignId);
      const campaigns = openResearchCampaigns({
        databasePath: join(directory, "research.sqlite"),
        runtime: stoppedResearchRuntime(),
      });

      await campaigns.conduct(input);
      const request = (
        await campaigns.inspect({ campaignId: input.campaignId })
      ).pendingCandidateReview;
      if (request === undefined) throw new Error("missing review request");
      const reviewBody = {
        kind: "human-candidate-review" as const,
        schemaVersion: 1 as const,
        reviewId: `review-${disposition}`,
        campaignId: input.campaignId,
        campaignInputDigest: request.campaignInputDigest,
        terminalResearchRunId: request.terminalResearchRunId,
        candidateSetDigest: request.candidateSetDigest,
        candidateReviewRequestDigest: request.digest,
        operator: {
          identity: "human-operator-1",
          decidedAt: "2026-09-09T01:01:30.000Z",
        },
        decisions: [
          {
            candidateId: "candidate-unauth-record-archive",
            disposition,
            reason: "The Candidate requires a programme or scope decision.",
          },
        ],
      };

      await expect(
        campaigns.conduct({
          ...reviewBody,
          digest: canonicalDigest(reviewBody),
        } as never),
      ).resolves.toMatchObject({ status: "coverage-closed" });
      await expect(
        campaigns.inspect({ campaignId: input.campaignId }),
      ).resolves.toMatchObject({
        validationRuns: [],
        findings: [],
        nativeRuns: [
          {
            report: {
              candidates: [{ candidateId: "candidate-unauth-record-archive" }],
            },
          },
        ],
        candidateReviews: [{ decisions: [{ disposition }] }],
      });
      campaigns.close();
    },
  );

  it("rejects stale, unknown, duplicate, or wrong-digest reviews atomically", async () => {
    const directory = await mkdtemp(join(tmpdir(), "candidate-reject-"));
    temporaryDirectories.push(directory);
    const input = campaignInput("campaign-candidate-reject-1");
    const campaigns = openResearchCampaigns({
      databasePath: join(directory, "research.sqlite"),
      runtime: stoppedResearchRuntime(),
    });

    await campaigns.conduct(input);
    const request = (await campaigns.inspect({ campaignId: input.campaignId }))
      .pendingCandidateReview;
    if (request === undefined) throw new Error("missing review request");
    const validBody = {
      kind: "human-candidate-review" as const,
      schemaVersion: 1 as const,
      reviewId: "review-candidate-reject-1",
      campaignId: input.campaignId,
      campaignInputDigest: request.campaignInputDigest,
      terminalResearchRunId: request.terminalResearchRunId,
      candidateSetDigest: request.candidateSetDigest,
      candidateReviewRequestDigest: request.digest,
      operator: {
        identity: "human-operator-1",
        decidedAt: "2026-09-09T01:01:30.000Z",
      },
      decisions: [
        {
          candidateId: "candidate-unauth-record-archive",
          disposition: "advance-to-independent-validation" as const,
          reason: "The impact warrants independent source validation.",
        },
      ],
    };
    const invalidReviews = [
      {
        ...validBody,
        campaignInputDigest: digest("2"),
      },
      {
        ...validBody,
        terminalResearchRunId: `${input.campaignId}:native:stale`,
      },
      {
        ...validBody,
        candidateSetDigest: digest("3"),
      },
      {
        ...validBody,
        decisions: [],
      },
      {
        ...validBody,
        decisions: [
          {
            ...validBody.decisions[0],
            candidateId: "candidate-unknown",
          },
        ],
      },
      {
        ...validBody,
        decisions: [validBody.decisions[0], validBody.decisions[0]],
      },
    ].map((body, index) => ({
      ...body,
      reviewId: `review-candidate-reject-${index + 1}`,
      digest: canonicalDigest({
        ...body,
        reviewId: `review-candidate-reject-${index + 1}`,
      }),
    }));
    invalidReviews.push({
      ...validBody,
      reviewId: "review-candidate-reject-wrong-digest",
      digest: digest("0"),
    });

    for (const review of invalidReviews) {
      await expect(campaigns.conduct(review as never)).rejects.toThrow();
    }
    await expect(
      campaigns.inspect({ campaignId: input.campaignId }),
    ).resolves.toMatchObject({
      status: "candidate-review-pending",
      candidateReviews: [],
      validationRuns: [],
      pendingCandidateReview: { digest: request.digest },
    });
    campaigns.close();
  });
});
