import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, it, vi } from "vitest";

import { canonicalDigest } from "../../src/infrastructure/canonical-json.js";
import {
  campaignInputSchema,
  humanCandidateReviewSchema,
  type NativeAgentRuntime,
} from "../../src/research/agent-led/contracts.js";
import { openResearchCampaigns } from "../../src/research/agent-led/research-campaigns.js";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

function input() {
  return campaignInputSchema.parse({
    kind: "agent-led-campaign",
    schemaVersion: 1,
    campaignId: "campaign-candidate-handoff",
    targetSnapshot: {
      id: "target-1",
      pluginSlug: "example-plugin",
      version: "1.0.0",
      digest:
        "sha256:1111111111111111111111111111111111111111111111111111111111111111",
      sourceTree: {
        digest:
          "sha256:2222222222222222222222222222222222222222222222222222222222222222",
        entries: 2,
        bytes: 100,
      },
    },
    promptSet: {
      id: "research-v1",
      digest:
        "sha256:3333333333333333333333333333333333333333333333333333333333333333",
    },
    agentRuntimeProfile: {
      id: "runtime-v1",
      kind: "test-native/v1",
      executableVersion: "1.0.0",
      model: "test-model",
      effort: "high",
      digest:
        "sha256:4444444444444444444444444444444444444444444444444444444444444444",
    },
    permissionProfile: {
      id: "permission-v1",
      digest:
        "sha256:5555555555555555555555555555555555555555555555555555555555555555",
    },
    budgetEnvelope: {
      id: "budget-v1",
      maxNativeRuns: 2,
      maxWallTimeMs: 60_000,
      researchGrantWallTimeMs: 60_000,
      digest:
        "sha256:6666666666666666666666666666666666666666666666666666666666666666",
    },
  });
}

function runtime(withRecipe: boolean): NativeAgentRuntime {
  return {
    execute: vi.fn(async (run) => ({
      schemaVersion: 1 as const,
      runId: run.runId,
      runtimeProfileDigest: run.agentRuntimeProfile.digest,
      terminal: "completed" as const,
      startedAt: "2026-09-15T00:00:00.000Z",
      completedAt: "2026-09-15T00:00:01.000Z",
      usage: { wallTimeMs: 1_000 },
      activity: { subagents: 0, tools: ["read"] },
      isolation: {
        backend: "gvisor" as const,
        runtime: "runsc" as const,
        fallbackUsed: false as const,
      },
      checkpoint: {
        kind: "agent-checkpoint" as const,
        schemaVersion: 1 as const,
        checkpointId: `${run.runId}:checkpoint`,
        stateDigest:
          "sha256:7777777777777777777777777777777777777777777777777777777777777777",
        stateEntries: 1,
        stateBytes: 1,
        sessionId: "123e4567-e89b-42d3-a456-426614174000",
        targetSnapshotDigest: run.targetSnapshot.digest,
        promptSetDigest: run.promptSet.digest,
        runtimeProfileDigest: run.agentRuntimeProfile.digest,
        permissionProfileDigest: run.permissionProfile.digest,
      },
      report: {
        schemaVersion: 1 as const,
        candidates: [
          {
            candidateId: "candidate-1",
            attackerPremise: "Unauthenticated visitor",
            brokenSecurityProperty: "Only administrators may install code",
            claim: "A public action installs attacker-controlled PHP",
            evidence: [
              {
                path: "plugin.php",
                location: "10",
                observation: "No authority check",
              },
            ],
            ...(withRecipe
              ? {
                  reproductionRecipe: {
                    kind: "candidate-verification-recipe-ref" as const,
                    schemaVersion: 1 as const,
                    recipeId: "recipe-1",
                    digest:
                      "sha256:8888888888888888888888888888888888888888888888888888888888888888",
                    bytes: 512,
                  },
                }
              : {}),
          },
        ],
        decision: {
          kind: "stop" as const,
          basis: "No actionable frontier remains.",
        },
      },
    })),
  };
}

async function admitCandidate(
  campaigns: ReturnType<typeof openResearchCampaigns>,
  campaignInput: ReturnType<typeof input>,
) {
  await campaigns.conduct(campaignInput);
  const pending = (
    await campaigns.inspect({ campaignId: campaignInput.campaignId })
  ).pendingCandidateReview!;
  const body = {
    kind: "human-candidate-review" as const,
    schemaVersion: 1 as const,
    reviewId: "review-1",
    campaignId: campaignInput.campaignId,
    campaignInputDigest: pending.campaignInputDigest,
    terminalResearchRunId: pending.terminalResearchRunId,
    candidateSetDigest: pending.candidateSetDigest,
    candidateReviewRequestDigest: pending.digest,
    operator: { identity: "operator-1", decidedAt: "2026-09-15T00:01:00.000Z" },
    decisions: [
      {
        candidateId: "candidate-1",
        disposition: "advance-to-candidate-verification" as const,
        reason: "The attacker premise and impact are plausible.",
      },
    ],
  };
  await campaigns.conduct(
    humanCandidateReviewSchema.parse({
      ...body,
      digest: canonicalDigest(body),
    }),
  );
}

describe("Candidate Verification handoff", () => {
  it("emits a digest-bound request without running source validation", async () => {
    const directory = await mkdtemp(join(tmpdir(), "research-handoff-"));
    directories.push(directory);
    const nativeRuntime = runtime(true);
    const campaigns = openResearchCampaigns({
      databasePath: join(directory, "research.sqlite"),
      runtime: nativeRuntime,
    });
    const campaignInput = input();
    await admitCandidate(campaigns, campaignInput);
    const view = await campaigns.inspect({
      campaignId: campaignInput.campaignId,
    });
    expect(view.status).toBe("candidate-verification-ready");
    expect(view.candidateVerificationRequests).toMatchObject([
      {
        candidate: { candidateId: "candidate-1" },
        targetSnapshot: { digest: campaignInput.targetSnapshot.digest },
      },
    ]);
    expect(nativeRuntime.execute).toHaveBeenCalledTimes(1);
    expect(view.coverage.status).toBe("closed");
    campaigns.close();
  });

  it("does not fabricate a request when the Research Root omitted the recipe", async () => {
    const directory = await mkdtemp(join(tmpdir(), "research-preparation-"));
    directories.push(directory);
    const campaigns = openResearchCampaigns({
      databasePath: join(directory, "research.sqlite"),
      runtime: runtime(false),
    });
    const campaignInput = input();
    await admitCandidate(campaigns, campaignInput);
    const view = await campaigns.inspect({
      campaignId: campaignInput.campaignId,
    });
    expect(view.status).toBe("verification-preparation-needed");
    expect(view.candidateVerificationRequests).toEqual([]);
    expect(view.verificationPreparationNeeded).toMatchObject([
      { candidateId: "candidate-1" },
    ]);
    campaigns.close();
  });
});
