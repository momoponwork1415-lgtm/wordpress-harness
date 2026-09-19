import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { defineAgentRuntimeProfile } from "../../src/infrastructure/agent-runtime-profile.js";
import {
  campaignInputSchema,
  type CampaignInput,
} from "../../src/research/index.js";
import type {
  NativeRunReceipt,
  ResearchCandidate,
  SealedNativeRun,
} from "../../src/research/agent-led/contracts.js";
import { openResearchCampaigns } from "../../src/research/agent-led/research-campaigns.js";
import { researchEvidenceSummaryFixture } from "./support/research-evidence-summary.js";

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

function campaignInput(
  campaignId: string,
  budget: Readonly<{ maxNativeRuns: number; maxWallTimeMs: number }> = {
    maxNativeRuns: 3,
    maxWallTimeMs: 7_200_000,
  },
): CampaignInput {
  return campaignInputSchema.parse({
    kind: "agent-led-campaign",
    schemaVersion: 2,
    campaignId,
    targetSnapshot: {
      id: "target-course-suite-fixture-1.0.0",
      pluginSlug: "course-suite-fixture",
      version: "1.0.0",
      digest: digest("a"),
      sourceTree: { digest: digest("9"), entries: 10, bytes: 1_024 },
    },
    promptSet: { id: "research-v1", digest: digest("b") },
    agentRuntimeProfile: defineAgentRuntimeProfile({
      id: "runtime-v1",
      transportKind: "scripted-native-agent/v1",
      executableVersion: "1.0.0",
      sandboxImageDigest: digest("0"),
      promptProtocol: "stdin",
      reportProtocol: "prompted-json",
      model: "scripted-model",
      effort: "high",
    }),
    permissionProfile: { id: "source-only-v1", digest: digest("e") },
    budgetEnvelope: {
      id: "budget-v1",
      ...budget,
      digest: digest("f"),
    },
  });
}

function candidate(): ResearchCandidate {
  return {
    candidateId: "candidate-resource-idor",
    attackerPremise: "An unauthenticated visitor can call the content RPC.",
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
    sourceTrace: [
      {
        role: "entrypoint",
        path: "src/api/resource-controller.ts",
        location: "load_resource:90",
        observation: "A public RPC accepts a caller-controlled resource id.",
      },
      {
        role: "effect",
        path: "src/api/resource-controller.ts",
        location: "load_resource:90",
        observation: "The independently selected resource is returned.",
      },
    ],
    controlAssessments: [
      {
        control: "Collection authorization",
        evidence: [
          {
            path: "src/api/resource-controller.ts",
            location: "load_resource:90",
            observation:
              "Authorization binds a collection id rather than the resource id.",
          },
        ],
        conclusion:
          "The collection check does not authorize the selected resource.",
      },
    ],
    unresolvedFacts: [],
  };
}

function completedReceipt(
  run: SealedNativeRun,
  ordinal: number,
  decision:
    | {
        kind: "continue";
        reason: string;
        nextActions: {
          question: string;
          sourcePointers: string[];
        }[];
      }
    | { kind: "stop"; basis: string },
  candidates: readonly ResearchCandidate[] = [],
  wallTimeMs = 50_000,
): NativeRunReceipt {
  return {
    schemaVersion: 2,
    runId: run.runId,
    runtimeProfileDigest: run.agentRuntimeProfile.digest,
    terminal: "completed",
    startedAt: `2026-09-09T03:0${ordinal}:00.000Z`,
    completedAt: `2026-09-09T03:0${ordinal}:50.000Z`,
    usage: { wallTimeMs },
    activity: { subagents: 1, tools: ["source.read"] },
    isolation: { backend: "gvisor", runtime: "runsc", fallbackUsed: false },
    checkpoint: checkpointFor(run),
    report: {
      schemaVersion: 2,
      assessments: [],
      evidenceSummary: researchEvidenceSummaryFixture(),
      candidates: [...candidates],
      decision,
    },
  };
}

describe("autonomous Research continuation", () => {
  it("continues from the exact Checkpoint without a Human Research review", async () => {
    const directory = await mkdtemp(join(tmpdir(), "research-autonomous-"));
    temporaryDirectories.push(directory);
    const input = campaignInput("campaign-research-autonomous-1");
    const runs: SealedNativeRun[] = [];
    const campaigns = openResearchCampaigns({
      databasePath: join(directory, "research.sqlite"),
      runtime: {
        async execute(run) {
          runs.push(run);
          if (runs.length === 1) {
            expect(run.budgetAllowance).toEqual({ maxWallTimeMs: 7_200_000 });
            return completedReceipt(run, 1, {
              kind: "continue",
              reason: "A concrete source edge remains unresolved.",
              nextActions: [
                {
                  question: "Which callback consumes the stored identifier?",
                  sourcePointers: ["inc/callbacks.php"],
                },
              ],
            });
          }
          expect(run.resumeFrom).toMatchObject({
            checkpointId: `${input.campaignId}:native:1:checkpoint`,
          });
          expect(run.researchContinuationNextActions).toEqual([
            {
              question: "Which callback consumes the stored identifier?",
              sourcePointers: ["inc/callbacks.php"],
            },
          ]);
          expect(run.budgetAllowance).toEqual({ maxWallTimeMs: 7_150_000 });
          return completedReceipt(run, 2, {
            kind: "stop",
            basis: "The source-bound frontier is exhausted.",
          });
        },
      },
    });

    await expect(campaigns.conduct(input)).resolves.toMatchObject({
      status: "coverage-closed",
    });
    expect(runs).toHaveLength(2);
    await expect(
      campaigns.inspect({ campaignId: input.campaignId }),
    ).resolves.toMatchObject({
      nativeRuns: [
        { runId: `${input.campaignId}:native:1` },
        { runId: `${input.campaignId}:native:2` },
      ],
      researchProgress: { pendingNextActions: [] },
    });
    campaigns.close();
  });

  it("keeps researching after a Candidate until the Root stops", async () => {
    const directory = await mkdtemp(join(tmpdir(), "research-candidate-"));
    temporaryDirectories.push(directory);
    const input = campaignInput("campaign-research-candidate-1");
    let invocations = 0;
    const campaigns = openResearchCampaigns({
      databasePath: join(directory, "research.sqlite"),
      runtime: {
        async execute(run) {
          invocations += 1;
          return completedReceipt(
            run,
            invocations,
            invocations === 1
              ? {
                  kind: "continue",
                  reason: "A materially different route remains.",
                  nextActions: [
                    {
                      question: "Does the sibling callback share this gap?",
                      sourcePointers: ["src/api/sibling-controller.ts"],
                    },
                  ],
                }
              : {
                  kind: "stop",
                  basis: "No actionable source-bound frontier remains.",
                },
            invocations === 1 ? [candidate()] : [],
          );
        },
      },
    });

    await expect(campaigns.conduct(input)).resolves.toMatchObject({
      status: "candidate-review-pending",
    });
    expect(invocations).toBe(2);
    await expect(
      campaigns.inspect({ campaignId: input.campaignId }),
    ).resolves.toMatchObject({
      pendingCandidateReview: {
        terminalResearchRunId: `${input.campaignId}:native:2`,
        candidates: [{ candidateId: candidate().candidateId }],
      },
      nativeRuns: [
        { report: { candidates: [{ candidateId: candidate().candidateId }] } },
        { report: { candidates: [] } },
      ],
    });
    campaigns.close();
  });

  it("keeps an actionable frontier incomplete when the safety envelope ends", async () => {
    const directory = await mkdtemp(join(tmpdir(), "research-envelope-"));
    temporaryDirectories.push(directory);
    const input = campaignInput("campaign-research-envelope-1", {
      maxNativeRuns: 1,
      maxWallTimeMs: 7_200_000,
    });
    const campaigns = openResearchCampaigns({
      databasePath: join(directory, "research.sqlite"),
      runtime: {
        async execute(run) {
          return completedReceipt(run, 1, {
            kind: "continue",
            reason: "A source-bound transition remains unresolved.",
            nextActions: [
              {
                question: "Which writer commits the transition?",
                sourcePointers: ["src/domain/writer.php"],
              },
            ],
          });
        },
      },
    });

    await expect(campaigns.conduct(input)).resolves.toMatchObject({
      status: "incomplete",
    });
    await expect(
      campaigns.inspect({ campaignId: input.campaignId }),
    ).resolves.toMatchObject({
      coverage: { status: "incomplete" },
      interruption: { reason: "budget-exhausted" },
      researchProgress: {
        pendingNextActions: [
          {
            question: "Which writer commits the transition?",
            sourcePointers: ["src/domain/writer.php"],
          },
        ],
      },
    });
    campaigns.close();
  });
});
