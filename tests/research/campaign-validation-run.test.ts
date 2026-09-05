import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { z } from "zod";
import { describe, expect, it } from "vitest";

import {
  campaignDefaultSemanticRunPlanV3Schema,
  openResearch,
} from "../../src/research/index.js";
import type {
  AttemptExecutionResultV2,
  ModelAttemptPlan,
  ModelExecution,
} from "../../src/research/model-execution/index.js";
import { sha256Digest } from "../../src/research/research-record/canonical-json.js";
import {
  openFileJsonArtifactStore,
  openSqliteResearchRecord,
} from "../../src/research/research-record/index.js";
import { createCampaignInput } from "../fixtures/campaign.js";

const digest = (character: string): string => `sha256:${character.repeat(64)}`;
const MEBIBYTE = 1024 * 1024;
const GIBIBYTE = 1024 * MEBIBYTE;
const criteria = [
  "source-integrity",
  "reachability-and-premise",
  "broken-control",
  "causal-route-and-security-effect",
  "counterevidence-and-proof-gap",
] as const;

const evaluationContextSchema = z.object({
  evaluationSubjects: z.array(
    z.object({
      ref: z.object({
        kind: z.string(),
        digest: z.string(),
      }),
    }),
  ),
});

function completedResult(
  plan: Exclude<ModelAttemptPlan, { schemaVersion: 1 }>,
  output: unknown,
): AttemptExecutionResultV2 {
  const planDigest = sha256Digest(plan);
  const value = {
    kind: "model-attempt-result" as const,
    schemaVersion: 2 as const,
    attemptId: plan.attemptId,
    owner: plan.owner,
    role: plan.role,
    planDigest,
    status: "completed" as const,
    output,
    usage: {
      kind: "model-attempt-usage" as const,
      schemaVersion: 1 as const,
      measurement: "reported" as const,
      estimatedCostUsd: 0.25,
      wallTimeMs: 10,
      providerDurationMs: 8,
      modelTurns: 1,
      modelTokens: {
        input: 10,
        cacheCreation: 0,
        cacheRead: 0,
        output: 10,
        total: 20,
      },
      structuredOutputBytes: 1_000,
      source:
        plan.role === "finder" || plan.role === "validator"
          ? { queries: 1, scanBytes: 100, responseBytes: 50 }
          : { queries: 0, scanBytes: 0, responseBytes: 0 },
      models: [
        {
          id: "claude-opus-5",
          canonicalModel: "claude-opus-5",
          tokens: {
            input: 10,
            cacheCreation: 0,
            cacheRead: 0,
            output: 10,
            total: 20,
          },
        },
      ],
    },
  };
  return {
    status: "completed",
    ref: {
      kind: "attempt-execution-result",
      schemaVersion: 2,
      attemptId: plan.attemptId,
      owner: plan.owner,
      role: plan.role,
      planDigest,
      digest: sha256Digest(value),
    },
    value,
  };
}

describe("CampaignRunner.run source-only Validation", () => {
  it("records Decision v3 before Validation and keeps a ready candidate in its active Family", async () => {
    const directory = await mkdtemp(join(tmpdir(), "campaign-validation-"));
    const databasePath = join(directory, "research.sqlite");
    const artifacts = openFileJsonArtifactStore(join(directory, "artifacts"));
    const input = {
      ...createCampaignInput("campaign-validation-run"),
      schemaVersion: 2 as const,
      modelProfiles: [
        { id: "opus-planner-v6", digest: digest("5") },
        { id: "opus-finder-v6", digest: digest("6") },
        { id: "opus-evaluator-v6", digest: digest("7") },
        { id: "opus-validator-v6", digest: digest("8") },
        { id: "opus-validation-synthesis-v6", digest: digest("9") },
      ],
      canonicalFileManifest: {
        kind: "canonical-file-manifest" as const,
        schemaVersion: 1 as const,
        entries: [{ path: "plugin.php", digest: digest("a"), size: 1_000 }],
      },
      budget: {
        maxAttempts: 128,
        maxWallTimeMs: 43_200_000,
        maxModelTokens: 4_000_000,
      },
    };
    const anchor = {
      path: "plugin.php",
      fileDigest: digest("a"),
      startLine: 10,
      endLine: 20,
    };
    const observedPlans: ModelAttemptPlan[] = [];
    const validatorAttemptIds: string[] = [];
    let validationDisposition: "ready-for-human" | "needs-research" =
      "ready-for-human";
    const modelExecution: ModelExecution = {
      run: async (plan) => {
        if (plan.schemaVersion !== 2) {
          throw new Error("Current Campaign used a legacy Attempt Plan");
        }
        observedPlans.push(plan);
        if (plan.role === "root-planner") {
          return completedResult(plan, {
            kind: "root-planner-output",
            schemaVersion: 1,
            theses: [],
          });
        }
        if (plan.role === "finder") {
          return completedResult(plan, {
            kind: "finder-output",
            schemaVersion: 2,
            leaseId: plan.assignment.leaseId,
            hypotheses: [
              {
                kind: "source-bound-hypothesis",
                schemaVersion: 1,
                causalIdentity: {
                  rootCause: "public-state-crosses-actor-boundary",
                  attackerControlledPrimitive: "unauthenticated-option-write",
                  brokenSecurityProperty:
                    validationDisposition === "needs-research"
                      ? "state-consumer-identity"
                      : "state-ownership",
                },
                attackerPremise: "unauthenticated",
                impact: "account-takeover",
                route: { anchors: [anchor] },
                unknowns: [
                  {
                    claim: "A privileged consumer reads the same state.",
                    requiredEvidence:
                      "Independently trace the exact source-bound consumer.",
                  },
                ],
                falsifier: "Every consumer independently checks ownership.",
                nextExperiment: "Review every source-bound consumer.",
              },
            ],
            routeFragments: [],
            frontierGaps: [],
          });
        }
        if (plan.role === "root-evaluator") {
          const prefix = "Wave evaluation context: ";
          const line = plan.prompt
            .split("\n")
            .find((value) => value.startsWith(prefix));
          if (line === undefined) throw new Error("Evaluation context missing");
          const context = evaluationContextSchema.parse(
            JSON.parse(line.slice(prefix.length)),
          );
          const hypothesis = context.evaluationSubjects.find(
            (subject) => subject.ref.kind === "source-bound-hypothesis",
          );
          const theses = context.evaluationSubjects.filter(
            (subject) => subject.ref.kind === "research-thesis",
          );
          if (hypothesis === undefined || theses.length === 0) {
            throw new Error(
              `Expected baseline thesis and Hypothesis: ${context.evaluationSubjects
                .map((subject) => subject.ref.kind)
                .join(",")}`,
            );
          }
          return completedResult(plan, {
            kind: "root-evaluator-output",
            schemaVersion: 2,
            approachFamilies: [
              {
                key: "cross-actor-state",
                subjectDigests: [hypothesis.ref.digest],
                thesis: "Public state may cross an actor authority boundary.",
                mechanism:
                  "Attacker-controlled state reaches a privileged consumer.",
                falsifier: "Every consumer checks the originating actor.",
                nextAction: "Validate the exact source-bound route.",
              },
            ],
            actions: [
              {
                kind: "admit-validation",
                approachFamilyKey: "cross-actor-state",
                subjectDigests: [hypothesis.ref.digest],
                admission: {
                  hypothesisDigest: hypothesis.ref.digest,
                  brokenSecurityProperty:
                    validationDisposition === "needs-research"
                      ? "state-consumer-identity"
                      : "state-ownership",
                  causalRoute: [
                    {
                      ordinal: 1,
                      claim:
                        "A public write reaches a privileged consumer without ownership enforcement.",
                      evidence: [anchor],
                    },
                  ],
                  reason: "The exact route is ready for fresh source review.",
                },
              },
              {
                kind: "retain",
                subjectDigests: theses.map((thesis) => thesis.ref.digest),
                reason:
                  "Keep whole-target research active after this candidate is reviewed.",
              },
            ],
            campaignDisposition: "continue",
          });
        }
        if (plan.role === "validator") {
          validatorAttemptIds.push(plan.attemptId);
          return completedResult(plan, {
            kind: "validation-attempt-output",
            schemaVersion: 1,
            candidateId: plan.assignment.candidateId,
            criteria: criteria.map((criterion) => ({
              criterion,
              status:
                validationDisposition === "needs-research" &&
                criterion === "reachability-and-premise"
                  ? "unknown"
                  : "pass",
              reason: `${plan.attemptId} independently resolved ${criterion}.`,
              evidence: [anchor],
            })),
            proposedDisposition: validationDisposition,
            ...(validationDisposition === "needs-research"
              ? {
                  proofGap: {
                    requiredFact:
                      "Confirm the privileged consumer reads the same state.",
                    currentEvidence: [anchor],
                    falsifier:
                      "The consumer reads an independently owned state value.",
                    nextAction:
                      "Trace every source-bound reader of the persisted state.",
                  },
                }
              : {}),
          });
        }
        if (plan.role === "validation-synthesizer") {
          const firstValidator = validatorAttemptIds[0];
          if (firstValidator === undefined) {
            throw new Error("Validation Synthesis ran without a Validator");
          }
          return completedResult(plan, {
            kind: "validation-synthesis-output",
            schemaVersion: 1,
            candidateId: plan.assignment.candidateId,
            criteria: criteria.map((criterion) => ({
              criterion,
              status:
                validationDisposition === "needs-research" &&
                criterion === "reachability-and-premise"
                  ? "unknown"
                  : "pass",
              reason: `The cited attempts resolve ${criterion}.`,
              evidence: [
                {
                  attemptId: firstValidator,
                  criterion,
                  evidenceIndexes: [0],
                },
              ],
            })),
            disposition: validationDisposition,
            reason: "The disposition follows only from both source reviews.",
            ...(validationDisposition === "needs-research"
              ? { proofGapAttemptId: firstValidator }
              : {}),
          });
        }
        throw new Error(`Unexpected Attempt role: ${plan.role}`);
      },
    };
    let legacyVerifierCalls = 0;
    let labCalls = 0;
    const research = openResearch({
      databasePath,
      campaignExecution: {
        artifactStore: artifacts,
        attemptPlanMaterializer: {
          materialize: async () => {
            throw new Error("Legacy Map materializer must not run");
          },
        },
        modelExecution,
        independentVerifier: {
          rederive: async () => {
            legacyVerifierCalls += 1;
            throw new Error("Legacy Independent Verification must not run");
          },
        },
        labControl: {
          execute: async () => {
            labCalls += 1;
            throw new Error("Lab must not run in source-only Validation");
          },
        },
      },
    });

    try {
      const prepared = await research.runner.prepare(input);
      if (prepared.targetFileManifest === undefined) {
        throw new Error("Expected a Target File Manifest");
      }
      const profile = (id: string, profileDigest: string) => ({
        ref: {
          kind: "model-profile" as const,
          schemaVersion: 1 as const,
          id,
          family: "claude" as const,
          digest: profileDigest,
        },
        execution: {
          provider: "anthropic" as const,
          model: "claude-opus-5",
          transport: "claude-code-process" as const,
          executableVersion: "2.1.258",
          effort: "high" as const,
          eligibilityReceiptDigest: digest("b"),
        },
      });
      const promptSet = {
        kind: "prompt-set" as const,
        schemaVersion: 1 as const,
        id: input.promptSet.id,
        digest: input.promptSet.digest,
      };
      const sourceToolPolicy = {
        kind: "source-tool-policy" as const,
        schemaVersion: 1 as const,
        id: "semantic-source-tools-v3",
        digest: digest("c"),
      };
      const plan = campaignDefaultSemanticRunPlanV3Schema.parse({
        kind: "campaign-run-plan",
        schemaVersion: 3,
        runId: "source-validation-run",
        campaignId: input.campaignId,
        preparationDigest: prepared.inputDigest,
        target: input.targetSnapshot,
        manifest: prepared.targetFileManifest,
        metadata: {
          kind: "oracle-free-target-metadata",
          schemaVersion: 1,
          pluginIdentity: "wporg:campaign-validation-run",
          mainPluginFile: "plugin.php",
          canonicalInstallDirectory: "campaign-validation-run",
        },
        semanticPolicy: {
          kind: "semantic-root-planning-policy",
          schemaVersion: 1,
          id: "semantic-research-recall-baseline-v6",
          maxTargetSpecificTheses: 0,
          minWildcardTheses: 1,
          maxLeases: 1,
          plannerBudget: {
            maxWallTimeMs: 3_600_000,
            maxModelTokens: 100_000,
            maxModelTurns: 128,
            maxProviderCostUsd: 10,
            maxOutputBytes: 2 * MEBIBYTE,
            maxSourceQueries: 256,
            maxSourceScanBytes: 16 * GIBIBYTE,
            maxSourceResponseBytes: 256 * MEBIBYTE,
            sourceLimitTerminalOutput: "preserve",
            reportedUsageEnforcement: "telemetry-only",
          },
          finderLeaseBudget: {
            maxWallTimeMs: 10_800_000,
            maxModelTokens: 1_000_000,
            maxModelTurns: 256,
            maxProviderCostUsd: 20,
            maxHypotheses: 8,
            maxOutputBytes: 2 * MEBIBYTE,
            maxSourceQueries: 512,
            maxSourceScanBytes: 16 * GIBIBYTE,
            maxSourceResponseBytes: 256 * MEBIBYTE,
            sourceLimitTerminalOutput: "preserve",
            reportedUsageEnforcement: "telemetry-only",
          },
        },
        planner: {
          modelProfile: profile("opus-planner-v6", digest("5")),
          promptSet,
          sourceToolPolicy,
        },
        finder: {
          modelProfile: profile("opus-finder-v6", digest("6")),
          promptSet,
          selectedKnowledge: [],
          sourceToolPolicy,
        },
        evaluator: {
          modelProfile: profile("opus-evaluator-v6", digest("7")),
          promptSet,
          budget: {
            maxWallTimeMs: 3_600_000,
            maxModelTokens: 100_000,
            maxModelTurns: 128,
            maxProviderCostUsd: 10,
            maxOutputBytes: 2 * MEBIBYTE,
            reportedUsageEnforcement: "telemetry-only",
          },
        },
        validation: {
          wordpressBaseline: {
            id: "wordpress-threat-baseline-v1",
            digest: digest("d"),
          },
          validationPolicy: {
            id: "source-validation-v1",
            digest: digest("e"),
          },
          promptSet,
          validatorModelProfile: profile("opus-validator-v6", digest("8")),
          synthesisModelProfile: profile(
            "opus-validation-synthesis-v6",
            digest("9"),
          ),
          sourceToolPolicy,
          publicSurface: ["Public WordPress request handlers"],
          technicalExclusions: [],
          budget: {
            validator: {
              maxWallTimeMs: 1_800_000,
              maxModelTokens: 100_000,
              maxModelTurns: 64,
              maxProviderCostUsd: 7.5,
              maxOutputBytes: 2 * MEBIBYTE,
              maxSourceQueries: 128,
              maxSourceScanBytes: 16 * GIBIBYTE,
              maxSourceResponseBytes: 256 * MEBIBYTE,
              sourceLimitTerminalOutput: "preserve",
              reportedUsageEnforcement: "telemetry-only",
            },
            synthesis: {
              maxWallTimeMs: 1_800_000,
              maxModelTokens: 100_000,
              maxModelTurns: 64,
              maxProviderCostUsd: 7.5,
              maxOutputBytes: 2 * MEBIBYTE,
              reportedUsageEnforcement: "telemetry-only",
            },
          },
        },
        budgetPolicy: {
          kind: "semantic-research-budget",
          schemaVersion: 2,
          id: "semantic-research-recall-baseline-v6",
          maxWorkWaves: 12,
          maxFinderAttempts: 48,
          maxConcurrentFinders: 4,
          maxModelAttempts: 128,
          maxModelTokens: 4_000_000,
          maxProviderCostUsd: 150,
          maxWallTimeMs: 43_200_000,
          reportedUsageEnforcement: "telemetry-only",
          exploration: {
            maxModelTokens: 3_600_000,
            maxProviderCostUsd: 120,
            maxWallTimeMs: 36_000_000,
          },
          validationReserve: {
            maxModelTokens: 400_000,
            maxProviderCostUsd: 30,
            maxWallTimeMs: 7_200_000,
          },
        },
      });

      const ref = await research.runner.run(plan);
      const modelCallsAfterFirstRun = observedPlans.length;
      const inspected = await research.reader.inspect(input.campaignId, {
        kind: "run",
        runId: plan.runId,
      });
      expect({ ref, inspected }).toMatchObject({
        ref: { schemaVersion: 3, decision: "incomplete" },
        inspected: {
          kind: "run",
          value: {
            schemaVersion: 3,
            iterationDecision: {
              schemaVersion: 3,
              actions: [{ kind: "admit-validation" }, { kind: "retain" }],
            },
            validations: [{ status: "ready-for-human" }],
            approachFamilyRegistry: {
              schemaVersion: 3,
              states: { active: 1 },
              pendingValidations: 0,
              validationOutcomes: 1,
            },
            decision: {
              kind: "incomplete",
              reason: "research-work-remains",
            },
          },
        },
      });
      expect(
        observedPlans.filter((attempt) => attempt.role === "validator"),
      ).toHaveLength(2);
      expect(
        observedPlans.find(
          (attempt) => attempt.role === "validation-synthesizer",
        ),
      ).not.toHaveProperty("sourceToolPolicy");
      expect({ legacyVerifierCalls, labCalls }).toEqual({
        legacyVerifierCalls: 0,
        labCalls: 0,
      });

      const record = openSqliteResearchRecord({
        databasePath,
        artifactStore: artifacts,
      });
      try {
        await expect(
          record.listValidationIntents(input.campaignId, plan.runId),
        ).resolves.toHaveLength(1);
        await expect(
          record.listValidationCompletions(input.campaignId, plan.runId),
        ).resolves.toMatchObject([
          { completion: { disposition: "ready-for-human" } },
        ]);
        await expect(
          record.listValidationFrontierGaps(input.campaignId, plan.runId),
        ).resolves.toEqual([]);
      } finally {
        record.close();
      }

      await expect(research.runner.run(plan)).resolves.toEqual(ref);
      expect(observedPlans).toHaveLength(modelCallsAfterFirstRun);

      validationDisposition = "needs-research";
      validatorAttemptIds.length = 0;
      const needsResearchPlan = campaignDefaultSemanticRunPlanV3Schema.parse({
        ...plan,
        runId: "source-validation-needs-research",
      });
      const needsResearchRef = await research.runner.run(needsResearchPlan);
      const needsResearchInspected = await research.reader.inspect(
        input.campaignId,
        { kind: "run", runId: needsResearchPlan.runId },
      );
      expect({ needsResearchRef, needsResearchInspected }).toMatchObject({
        needsResearchRef: { schemaVersion: 3, decision: "incomplete" },
        needsResearchInspected: {
          value: {
            validations: [{ status: "needs-research" }],
            validationFrontierGaps: [
              {
                kind: "validation-frontier-gap",
                schemaVersion: 1,
                approachFamilies: 1,
              },
            ],
            approachFamilyRegistry: {
              states: { active: 1 },
              pendingValidations: 0,
              validationOutcomes: 1,
            },
            decision: {
              kind: "incomplete",
              reason: "research-work-remains",
            },
          },
        },
      });
      const needsResearchRecord = openSqliteResearchRecord({
        databasePath,
        artifactStore: artifacts,
      });
      try {
        const gaps = await needsResearchRecord.listValidationFrontierGaps(
          input.campaignId,
          needsResearchPlan.runId,
        );
        expect(gaps).toHaveLength(1);
        const gap = gaps[0];
        if (gap === undefined) throw new Error("Expected a Validation gap");
        await expect(
          artifacts.readJson(gap.frontierGap.digest),
        ).resolves.toMatchObject({
          campaignId: input.campaignId,
          runId: needsResearchPlan.runId,
          approachFamilyIds: [expect.any(String)],
          value: {
            requiredFact:
              "Confirm the privileged consumer reads the same state.",
          },
        });
      } finally {
        needsResearchRecord.close();
      }
    } finally {
      research.close();
      await rm(directory, { force: true, recursive: true });
    }
  });
});
