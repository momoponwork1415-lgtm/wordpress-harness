import { copyFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import Database from "better-sqlite3";
import { z } from "zod";
import { describe, expect, it } from "vitest";

import {
  CampaignFindingNotFoundError,
  CampaignRunConflictError,
  campaignDefaultSemanticRunPlanV3Schema,
  bindCurrentSemanticCampaignConfiguration,
  defineCurrentSemanticRootPlanningPolicy,
  openResearch,
  type CampaignExecutionDependencies,
} from "../../src/research/index.js";
import {
  chainSynthesisIncompleteSchema,
  semanticDepthWorkQueueV2Schema,
} from "../../src/research/exploration/index.js";
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
  reported?: {
    readonly modelTokens: number;
    readonly estimatedCostUsd: number;
  },
): AttemptExecutionResultV2 {
  const planDigest = sha256Digest(plan);
  const modelTokens = reported?.modelTokens ?? 20;
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
      estimatedCostUsd: reported?.estimatedCostUsd ?? 0.25,
      wallTimeMs: 10,
      providerDurationMs: 8,
      modelTurns: 1,
      modelTokens: {
        input: modelTokens,
        cacheCreation: 0,
        cacheRead: 0,
        output: 0,
        total: modelTokens,
      },
      structuredOutputBytes: 1_000,
      source:
        plan.role === "finder" ||
        plan.role === "validator" ||
        plan.role === "adversarial-critic"
          ? { queries: 1, scanBytes: 100, responseBytes: 50 }
          : { queries: 0, scanBytes: 0, responseBytes: 0 },
      models: [
        {
          id: "claude-opus-5",
          canonicalModel: "claude-opus-5",
          tokens: {
            input: modelTokens,
            cacheCreation: 0,
            cacheRead: 0,
            output: 0,
            total: modelTokens,
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

function failedResult(
  plan: Exclude<ModelAttemptPlan, { schemaVersion: 1 }>,
  status: "budget-exhausted" | "provider-failed",
): AttemptExecutionResultV2 {
  const planDigest = sha256Digest(plan);
  const value = {
    kind: "model-attempt-result" as const,
    schemaVersion: 2 as const,
    attemptId: plan.attemptId,
    owner: plan.owner,
    role: plan.role,
    planDigest,
    status,
    reason: `Injected ${status} failure.`,
  };
  return {
    status,
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
  it("recovers lost Exploration and durable Validator results while replaying pre-result-event ledgers", async () => {
    const directory = await mkdtemp(join(tmpdir(), "campaign-validation-"));
    const databasePath = join(directory, "research.sqlite");
    const artifacts = openFileJsonArtifactStore(join(directory, "artifacts"));
    const input = {
      ...createCampaignInput("campaign-validation-run"),
      schemaVersion: 2 as const,
      promptSet: {
        id: "semantic-research-source-screen-v6r3",
        digest: digest("4"),
      },
      modelProfiles: [
        {
          id: "claude-opus-5-root-planner-high-v6",
          digest: digest("5"),
        },
        { id: "claude-opus-5-finder-high-v6", digest: digest("6") },
        {
          id: "claude-opus-5-root-evaluator-high-v6",
          digest: digest("7"),
        },
        { id: "claude-opus-5-validator-high-v6", digest: digest("8") },
      ],
      canonicalFileManifest: {
        kind: "canonical-file-manifest" as const,
        schemaVersion: 1 as const,
        entries: [{ path: "plugin.php", digest: digest("a"), size: 1_000 }],
      },
      budget: {
        maxAttempts: 128,
        maxWallTimeMs: 43_200_000,
        maxModelTokens: 4_600_000,
      },
    };
    const anchor = {
      path: "plugin.php",
      fileDigest: digest("a"),
      startLine: 10,
      endLine: 20,
    };
    const secondaryAnchor = {
      ...anchor,
      startLine: 30,
      endLine: 40,
    };
    const observedPlans: ModelAttemptPlan[] = [];
    const depthQueuesObservedBeforeValidation: string[] = [];
    const depthQueuesObservedBeforeSynthesis: string[] = [];
    const validatorProgressSnapshots: unknown[] = [];
    const dispatchBudgetSnapshots: Array<{
      readonly runId: string;
      readonly role: string;
      readonly assignmentKind: string;
      readonly reservedAttempts: number;
      readonly ownReservationDurable: boolean;
      readonly protectedRootTokens: number;
      readonly explorationSpentTokens: number;
      readonly explorationReservedTokens: number;
      readonly validationRemainingTokens: number;
      readonly overshootTokens: number;
    }> = [];
    let activeCampaignId = input.campaignId;
    let expectedValidationRunId = "";
    let validationDisposition:
      "source-validated" | "needs-research" | "disproven" = "source-validated";
    let depthFailure: "none" | "budget-exhausted" = "none";
    let candidateIdentitySuffix = "";
    let validationCandidateCount = 1;
    let validatorReportedTokens: number | undefined;
    let finderReportedTokens: readonly number[] | undefined;
    let finderReportedTokenIndex = 0;
    let reverseValidationEvidence = false;
    let injectUnknownExplorationResult = false;
    let injectUnknownValidatorResult = false;
    let firstFindingId: string | undefined;
    const modelExecution: ModelExecution = {
      run: async (plan) => {
        if (plan.schemaVersion !== 2) {
          throw new Error("Current Campaign used a legacy Attempt Plan");
        }
        const dispatchBudget = await research.reader.inspect(activeCampaignId, {
          kind: "budget",
          runId: expectedValidationRunId,
        });
        if (dispatchBudget.kind !== "budget") {
          throw new Error("Expected a durable reservation before dispatch");
        }
        dispatchBudgetSnapshots.push({
          runId: expectedValidationRunId,
          role: plan.role,
          assignmentKind: plan.assignment.kind,
          reservedAttempts: dispatchBudget.reserved.modelAttempts,
          ownReservationDurable: dispatchBudget.activeReservations.some(
            (reservation) => reservation.attemptId === plan.attemptId,
          ),
          protectedRootTokens:
            dispatchBudget.schemaVersion === 2
              ? dispatchBudget.protectedReservations.reduce(
                  (total, reservation) =>
                    total + reservation.amount.modelTokens,
                  0,
                )
              : 0,
          explorationSpentTokens:
            dispatchBudget.owners.exploration.spent.modelTokens,
          explorationReservedTokens:
            dispatchBudget.owners.exploration.reserved.modelTokens,
          validationRemainingTokens:
            dispatchBudget.owners.validation.remaining.modelTokens,
          overshootTokens: dispatchBudget.overshoot.modelTokens,
        });
        observedPlans.push(plan);
        if (plan.role === "root-planner") {
          if (injectUnknownExplorationResult) {
            injectUnknownExplorationResult = false;
            throw new Error("Injected Exploration provider result loss");
          }
          return completedResult(plan, {
            kind: "root-planner-output",
            schemaVersion: 1,
            theses: [
              {
                kind: "research-thesis-proposal",
                schemaVersion: 1,
                scope: "target-specific",
                securityAssumption:
                  "public writes preserve the originating actor boundary",
                question:
                  "Can public state cross into a more privileged consumer?",
                motivation:
                  "The Target exposes a source-backed persistent state path.",
                startingBasis: "Oracle-free Target source only.",
                startingEvidence: [anchor],
                independence:
                  "This thesis studies cross-actor state ownership.",
              },
              {
                kind: "research-thesis-proposal",
                schemaVersion: 1,
                scope: "target-specific",
                securityAssumption:
                  "producer and consumer preserve the same value meaning",
                question:
                  "Can a representation transition change the security meaning of a value?",
                motivation:
                  "The Target moves values across a source-backed processing boundary.",
                startingBasis: "Oracle-free Target source only.",
                startingEvidence: [anchor],
                independence:
                  "This thesis studies representation meaning rather than state ownership.",
              },
            ],
          });
        }
        if (plan.role === "finder") {
          const reportedModelTokens =
            finderReportedTokens?.[finderReportedTokenIndex++];
          return completedResult(
            plan,
            {
              kind: "finder-output",
              schemaVersion: 2,
              leaseId: plan.assignment.leaseId,
              hypotheses: plan.prompt.includes(
                "a whole-target review may reveal broken security semantics",
              )
                ? Array.from(
                    { length: validationCandidateCount },
                    (_, index) => {
                      const identitySuffix =
                        validationCandidateCount === 1
                          ? candidateIdentitySuffix
                          : `${candidateIdentitySuffix}-${index + 1}`;
                      return {
                        kind: "source-bound-hypothesis",
                        schemaVersion: 1,
                        causalIdentity: {
                          rootCause: `public-state-crosses-actor-boundary${identitySuffix}`,
                          attackerControlledPrimitive:
                            "unauthenticated-option-write",
                          brokenSecurityProperty:
                            validationDisposition === "needs-research"
                              ? "state-consumer-identity"
                              : `state-ownership${identitySuffix}`,
                        },
                        attackerPremise: "unauthenticated",
                        impact: "account-takeover",
                        route: {
                          anchors: reverseValidationEvidence
                            ? [anchor, secondaryAnchor]
                            : [anchor],
                        },
                        unknowns: [
                          {
                            claim:
                              "A privileged consumer reads the same state.",
                            requiredEvidence:
                              "Independently trace the exact source-bound consumer.",
                          },
                        ],
                        falsifier:
                          "Every consumer independently checks ownership.",
                        nextExperiment: "Review every source-bound consumer.",
                      };
                    },
                  )
                : [],
              routeFragments: [],
              frontierGaps: [],
            },
            reportedModelTokens === undefined
              ? undefined
              : {
                  modelTokens: reportedModelTokens,
                  estimatedCostUsd: 7.1014455 / 3,
                },
          );
        }
        if (
          plan.role === "root-evaluator" &&
          plan.assignment.kind === "depth-evaluation"
        ) {
          return completedResult(plan, {
            kind: "depth-root-evaluator-output",
            schemaVersion: 1,
            dispositions: plan.assignment.proposalIds.map((proposalId) => ({
              proposalId,
              action: "retain-route",
              reason:
                "Keep the source-bound route active for later missing-link work.",
            })),
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
          const hypotheses = context.evaluationSubjects.filter(
            (subject) => subject.ref.kind === "source-bound-hypothesis",
          );
          const hypothesis = hypotheses[0];
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
            approachFamilies: hypotheses.map((candidate, index) => ({
              key: `cross-actor-state-${index + 1}`,
              subjectDigests: [
                candidate.ref.digest,
                ...theses.map((thesis) => thesis.ref.digest),
              ],
              thesis: "Public state may cross an actor authority boundary.",
              mechanism:
                "Attacker-controlled state reaches a privileged consumer.",
              falsifier: "Every consumer checks the originating actor.",
              nextAction: "Validate the exact source-bound route.",
            })),
            actions: [
              ...hypotheses.map((candidate, index) => ({
                kind: "admit-validation",
                approachFamilyKey: `cross-actor-state-${index + 1}`,
                subjectDigests: [candidate.ref.digest],
                admission: {
                  hypothesisDigest: candidate.ref.digest,
                  brokenSecurityProperty:
                    validationDisposition === "needs-research"
                      ? "state-consumer-identity"
                      : `state-ownership${
                          validationCandidateCount === 1
                            ? candidateIdentitySuffix
                            : `${candidateIdentitySuffix}-${index + 1}`
                        }`,
                  causalRoute: [
                    {
                      ordinal: 1,
                      claim:
                        "A public write reaches a privileged consumer without ownership enforcement.",
                      evidence: reverseValidationEvidence
                        ? [secondaryAnchor, anchor]
                        : [anchor],
                    },
                  ],
                  reason: "The exact route is ready for fresh source review.",
                },
              })),
              {
                kind: "admit-depth",
                approachFamilyKey: "cross-actor-state-1",
                subjectDigests: [
                  hypothesis.ref.digest,
                  ...theses.map((thesis) => thesis.ref.digest),
                ],
                admission: {
                  highImpactPotential:
                    "The same cross-actor state may reach additional privileged consumers.",
                  composition:
                    "Trace the persisted value into other authority boundaries.",
                  falsifier:
                    "Every additional consumer independently checks ownership.",
                  nextAction:
                    "Synthesize the source-bound state transition with adjacent consumers.",
                },
              },
              ...Array.from({ length: 4 }, (_, index) => ({
                kind: "schedule-work" as const,
                subjectDigests: [
                  hypothesis.ref.digest,
                  ...theses.map((thesis) => thesis.ref.digest),
                ],
                work: {
                  requiredFact: `Resolve adjacent privileged consumer ${index + 1}.`,
                  falsifier: `Consumer ${index + 1} does not read the shared state.`,
                  nextAction: `Trace source-bound consumer ${index + 1}.`,
                },
              })),
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
        if (plan.role === "root-synthesizer") {
          const durableRecord = openSqliteResearchRecord({
            databasePath,
            artifactStore: artifacts,
          });
          try {
            const queued = await durableRecord.readSemanticDepthWorkQueueV2(
              activeCampaignId,
              expectedValidationRunId,
            );
            if (queued === undefined) {
              throw new Error(
                "Root Synthesis started before the Depth Work Queue was durable",
              );
            }
            depthQueuesObservedBeforeSynthesis.push(queued.queue.digest);
          } finally {
            durableRecord.close();
          }
          if (depthFailure !== "none") {
            return failedResult(plan, depthFailure);
          }
          return completedResult(plan, {
            kind: "root-synthesis-output",
            schemaVersion: 1,
            itemDispositions: plan.assignment.itemIds.map((itemId) => ({
              itemId,
              disposition: "used",
              reason: "The item contributes a source-bound route subject.",
            })),
            proposals: [
              {
                itemIds: plan.assignment.itemIds,
                subjectDigests: plan.assignment.subjectDigests,
                attackerPremise: "unauthenticated",
                securityProperty: "Cross-actor state ownership.",
                steps: [
                  {
                    ordinal: 1,
                    relation: "observed",
                    actor: "unauthenticated-attacker",
                    request: "Write public state.",
                    stateIdentity: "shared-option",
                    consumedValues: ["public-input"],
                    producedValues: ["persisted-state"],
                    evidence: [anchor],
                  },
                  {
                    ordinal: 2,
                    relation: "proposed-connection",
                    actor: "privileged-consumer",
                    request: "Read the persisted state.",
                    stateIdentity: "shared-option",
                    consumedValues: ["persisted-state"],
                    producedValues: ["privileged-effect"],
                    evidence: [anchor],
                  },
                ],
                unknowns: [
                  {
                    claim: "The privileged consumer reads the same state.",
                    requiredEvidence:
                      "Trace the exact persisted state identity.",
                  },
                ],
                falsifier: "The producer and consumer use distinct state.",
                nextAction: "Challenge the state identity in fresh source.",
              },
            ],
          });
        }
        if (plan.role === "adversarial-critic") {
          return completedResult(plan, {
            kind: "adversarial-critic-output",
            schemaVersion: 1,
            dispositions: plan.assignment.proposalIds.map((proposalId) => ({
              proposalId,
              verdict: "survives",
              challenges: [
                {
                  category: "state-identity",
                  claim: "Both steps refer to the same persisted state.",
                  evidence: [anchor],
                  reason: "The cited source leaves the route plausible.",
                  falsifier: "The state keys differ.",
                },
              ],
            })),
          });
        }
        if (plan.role === "validator") {
          validatorProgressSnapshots.push(
            await research.reader.inspect(activeCampaignId, {
              kind: "progress",
            }),
          );
          const durableRecord = openSqliteResearchRecord({
            databasePath,
            artifactStore: artifacts,
          });
          try {
            const queued = await durableRecord.readSemanticDepthWorkQueueV2(
              activeCampaignId,
              expectedValidationRunId,
            );
            if (queued === undefined) {
              throw new Error(
                "Validation started before the Depth Work Queue was durable",
              );
            }
            depthQueuesObservedBeforeValidation.push(queued.queue.digest);
          } finally {
            durableRecord.close();
          }
          if (injectUnknownValidatorResult) {
            throw new Error("Injected provider result loss");
          }
          const result = completedResult(plan, {
            kind: "validation-attempt-output",
            schemaVersion: 3,
            candidateId: plan.assignment.candidateId,
            criteria: criteria.map((criterion) => ({
              criterion,
              status:
                validationDisposition === "needs-research" &&
                criterion === "reachability-and-premise"
                  ? "unknown"
                  : validationDisposition === "disproven" &&
                      criterion === "broken-control"
                    ? "fail"
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
          if (validatorReportedTokens === undefined) return result;
          const usage = result.value.usage;
          if (usage === undefined) {
            throw new Error("Expected reported Validator usage");
          }
          const value = {
            ...result.value,
            usage: {
              ...usage,
              modelTokens: {
                input: validatorReportedTokens,
                cacheCreation: 0,
                cacheRead: 0,
                output: 0,
                total: validatorReportedTokens,
              },
              models: [
                {
                  ...usage.models[0]!,
                  tokens: {
                    input: validatorReportedTokens,
                    cacheCreation: 0,
                    cacheRead: 0,
                    output: 0,
                    total: validatorReportedTokens,
                  },
                },
              ],
            },
          };
          return {
            ...result,
            value,
            ref: { ...result.ref, digest: sha256Digest(value) },
          };
        }
        throw new Error("Unexpected Attempt role");
      },
    };
    const campaignExecution: CampaignExecutionDependencies = {
      artifactStore: artifacts,
      attemptPlanMaterializer: {
        materialize: async () => {
          throw new Error("Legacy Map materializer must not run");
        },
      },
      modelExecution,
      independentVerifier: {
        rederive: async () => {
          throw new Error("Legacy Independent Verification must not run");
        },
      },
      labControl: {
        execute: async () => {
          throw new Error("Lab must not run in source-only Validation");
        },
      },
      runtimeVerificationPacketDelivery: {
        deliver: async () => {
          throw new Error("Runtime Packet delivery must not run");
        },
      },
    };
    const research = openResearch({
      databasePath,
      campaignExecution,
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
          executableVersion: "2.1.260",
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
        id: "prospective-source-only-v1",
        digest: digest("c"),
      };
      const bindingSource = {
        semanticPolicy: defineCurrentSemanticRootPlanningPolicy({
          plannerBudget: {
            maxWallTimeMs: 3_600_000,
            maxModelTokens: 100_000,
            maxModelTurns: 128,
            maxProviderCostUsd: 10,
            maxOutputBytes: 2 * MEBIBYTE,
            maxSourceQueries: 256,
            maxSourceScanBytes: 16 * GIBIBYTE,
            maxSourceResponseBytes: 256 * MEBIBYTE,
            sourceLimitTerminalOutput: "preserve" as const,
            reportedUsageEnforcement: "telemetry-only" as const,
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
            sourceLimitTerminalOutput: "preserve" as const,
            reportedUsageEnforcement: "telemetry-only" as const,
          },
        }),
        planner: {
          modelProfile: profile(
            "claude-opus-5-root-planner-high-v6",
            digest("5"),
          ),
          promptSet,
          sourceToolPolicy,
        },
        finder: {
          modelProfile: profile("claude-opus-5-finder-high-v6", digest("6")),
          promptSet,
          selectedKnowledge: [],
          sourceToolPolicy,
        },
        evaluator: {
          modelProfile: profile(
            "claude-opus-5-root-evaluator-high-v6",
            digest("7"),
          ),
          promptSet,
          budget: {
            maxWallTimeMs: 3_600_000,
            maxModelTokens: 100_000,
            maxModelTurns: 128,
            maxProviderCostUsd: 10,
            maxOutputBytes: 2 * MEBIBYTE,
            reportedUsageEnforcement: "telemetry-only" as const,
          },
        },
        validation: {
          wordpressBaseline: {
            id: "wordpress-threat-baseline-v1",
            digest: digest("d"),
          },
          validationPolicy: {
            id: "single-source-validation-v2",
            digest: digest("e"),
          },
          promptSet,
          validatorModelProfile: profile(
            "claude-opus-5-validator-high-v6",
            digest("8"),
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
              sourceLimitTerminalOutput: "preserve" as const,
              reportedUsageEnforcement: "telemetry-only" as const,
            },
          },
        },
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
        ...bindingSource,
        bindings: bindCurrentSemanticCampaignConfiguration(bindingSource),
        budgetPolicy: {
          kind: "semantic-research-budget",
          schemaVersion: 3,
          id: "semantic-research-recall-baseline-v7",
          maxWorkWaves: 12,
          maxFinderAttempts: 48,
          maxConcurrentFinders: 4,
          maxModelAttempts: 128,
          maxModelTokens: 4_600_000,
          maxProviderCostUsd: 150,
          maxWallTimeMs: 43_200_000,
          reportedUsageEnforcement: "telemetry-only",
          exploration: {
            maxModelTokens: 4_200_000,
            maxProviderCostUsd: 120,
            maxWallTimeMs: 36_000_000,
            rootEvaluationReserve: {
              maxModelTokens: 100_000,
              owner: "exploration",
              role: "root-evaluator",
            },
          },
          validationReserve: {
            maxModelTokens: 400_000,
            maxProviderCostUsd: 30,
            maxWallTimeMs: 7_200_000,
          },
        },
      });

      const modelCallsBeforeBindingChecks = observedPlans.length;
      await expect(
        research.runner.run({
          ...plan,
          runId: "source-validation-profile-version-mismatch",
          evaluator: {
            ...plan.evaluator,
            modelProfile: {
              ...plan.evaluator.modelProfile,
              execution: {
                ...plan.evaluator.modelProfile.execution,
                executableVersion: "2.1.259",
              },
            },
          },
        }),
      ).rejects.toBeInstanceOf(CampaignRunConflictError);
      await expect(
        research.runner.run({
          ...plan,
          runId: "source-validation-profile-receipt-mismatch",
          finder: {
            ...plan.finder,
            modelProfile: {
              ...plan.finder.modelProfile,
              execution: {
                ...plan.finder.modelProfile.execution,
                eligibilityReceiptDigest: digest("0"),
              },
            },
          },
        }),
      ).rejects.toBeInstanceOf(CampaignRunConflictError);
      await expect(
        research.runner.run({
          ...plan,
          runId: "source-validation-source-policy-mismatch",
          finder: {
            ...plan.finder,
            sourceToolPolicy: {
              ...plan.finder.sourceToolPolicy,
              digest: digest("0"),
            },
          },
        }),
      ).rejects.toBeInstanceOf(CampaignRunConflictError);
      await expect(
        research.runner.run({
          ...plan,
          runId: "source-validation-policy-mismatch",
          validation: {
            ...plan.validation,
            validationPolicy: {
              ...plan.validation.validationPolicy,
              digest: digest("0"),
            },
          },
        }),
      ).rejects.toBeInstanceOf(CampaignRunConflictError);
      await expect(
        research.runner.run({
          ...plan,
          runId: "source-validation-finder-policy-mismatch",
          semanticPolicy: {
            ...plan.semanticPolicy,
            finderLeaseBudget: {
              ...plan.semanticPolicy.finderLeaseBudget,
              maxHypotheses: 9,
            },
          },
        }),
      ).rejects.toBeInstanceOf(CampaignRunConflictError);
      await expect(
        research.runner.run({
          ...plan,
          runId: "source-validation-knowledge-oracle-mismatch",
          finder: {
            ...plan.finder,
            selectedKnowledge: [
              { id: "unapproved-knowledge", digest: digest("0") },
            ],
          },
        }),
      ).rejects.toBeInstanceOf(CampaignRunConflictError);
      await expect(
        research.runner.run({
          ...plan,
          runId: "source-validation-scope-mismatch",
          validation: {
            ...plan.validation,
            technicalExclusions: ["Ignore filesystem authorization"],
          },
        }),
      ).rejects.toBeInstanceOf(CampaignRunConflictError);
      expect(observedPlans).toHaveLength(modelCallsBeforeBindingChecks);

      const reservationBoundaryDatabasePath = join(
        directory,
        "reservation-boundary.sqlite",
      );
      const reservationBoundaryInput = {
        ...input,
        campaignId: "campaign-reservation-boundary",
      };
      const reservationBoundaryExecution: CampaignExecutionDependencies = {
        ...campaignExecution,
        campaignRunStartFaultBoundary: {
          afterStarted: () => {
            throw new Error("Injected reservation-boundary restart");
          },
        },
      };
      const reservationBoundaryResearch = openResearch({
        databasePath: reservationBoundaryDatabasePath,
        campaignExecution: reservationBoundaryExecution,
      });
      let reservationBoundaryPlan:
        z.infer<typeof campaignDefaultSemanticRunPlanV3Schema> | undefined;
      try {
        const boundaryPreparation =
          await reservationBoundaryResearch.runner.prepare(
            reservationBoundaryInput,
          );
        if (boundaryPreparation.targetFileManifest === undefined) {
          throw new Error("Expected a reservation-boundary manifest");
        }
        reservationBoundaryPlan = campaignDefaultSemanticRunPlanV3Schema.parse({
          ...plan,
          campaignId: reservationBoundaryInput.campaignId,
          runId: "reservation-boundary-run",
          preparationDigest: boundaryPreparation.inputDigest,
          manifest: boundaryPreparation.targetFileManifest,
        });
        await expect(
          reservationBoundaryResearch.runner.run(reservationBoundaryPlan),
        ).rejects.toThrow("Injected reservation-boundary restart");
      } finally {
        reservationBoundaryResearch.close();
      }
      const reservationBoundaryReplay = openResearch({
        databasePath: reservationBoundaryDatabasePath,
        campaignExecution: reservationBoundaryExecution,
      });
      try {
        await expect(
          reservationBoundaryReplay.reader.inspect(
            reservationBoundaryInput.campaignId,
            { kind: "budget", runId: "reservation-boundary-run" },
          ),
        ).resolves.toMatchObject({
          kind: "budget",
          schemaVersion: 2,
          activeReservations: [],
          protectedReservations: [
            {
              owner: "exploration",
              role: "root-evaluator",
              amount: { modelTokens: 100_000 },
            },
          ],
          owners: {
            exploration: { reserved: { modelTokens: 100_000 } },
            validation: { remaining: { modelTokens: 400_000 } },
          },
        });
        await expect(
          reservationBoundaryReplay.reader.inspect(
            reservationBoundaryInput.campaignId,
            { kind: "progress" },
          ),
        ).resolves.toMatchObject({
          kind: "progress",
          activeAttempts: [],
        });
      } finally {
        reservationBoundaryReplay.close();
      }
      if (reservationBoundaryPlan === undefined) {
        throw new Error("Expected a reservation-boundary plan");
      }
      const missingAttemptReservationWriter = openResearch({
        databasePath: reservationBoundaryDatabasePath,
        campaignExecution: {
          ...campaignExecution,
          modelExecution: {
            run: async (attemptPlan) => {
              if (attemptPlan.schemaVersion !== 2) {
                throw new Error("Expected a current Attempt Plan");
              }
              return failedResult(attemptPlan, "provider-failed");
            },
          },
        },
      });
      try {
        await expect(
          missingAttemptReservationWriter.runner.run(reservationBoundaryPlan),
        ).resolves.toMatchObject({ schemaVersion: 4, decision: "incomplete" });
      } finally {
        missingAttemptReservationWriter.close();
      }
      const reservationTamperer = new Database(reservationBoundaryDatabasePath);
      try {
        const reservedEvent = z
          .object({ campaign_sequence: z.number().int().positive() })
          .parse(
            reservationTamperer
              .prepare(
                `SELECT campaign_sequence
                 FROM research_events
                 WHERE campaign_id = ?
                   AND kind = 'campaign.attempt-budget-reserved'
                 ORDER BY campaign_sequence ASC
                 LIMIT 1`,
              )
              .get(reservationBoundaryInput.campaignId),
          );
        reservationTamperer.transaction(() => {
          reservationTamperer
            .prepare(
              `DELETE FROM research_events
               WHERE campaign_id = ? AND campaign_sequence = ?`,
            )
            .run(
              reservationBoundaryInput.campaignId,
              reservedEvent.campaign_sequence,
            );
          reservationTamperer
            .prepare(
              `UPDATE research_events
               SET campaign_sequence = campaign_sequence + 1000000
               WHERE campaign_id = ? AND campaign_sequence > ?`,
            )
            .run(
              reservationBoundaryInput.campaignId,
              reservedEvent.campaign_sequence,
            );
          reservationTamperer
            .prepare(
              `UPDATE research_events
               SET campaign_sequence = campaign_sequence - 1000001
               WHERE campaign_id = ? AND campaign_sequence > ?`,
            )
            .run(
              reservationBoundaryInput.campaignId,
              reservedEvent.campaign_sequence + 1_000_000,
            );
        })();
      } finally {
        reservationTamperer.close();
      }
      const missingAttemptReservationReader = openResearch({
        databasePath: reservationBoundaryDatabasePath,
      });
      try {
        await expect(
          missingAttemptReservationReader.reader.inspect(
            reservationBoundaryInput.campaignId,
            { kind: "budget", runId: reservationBoundaryPlan.runId },
          ),
        ).rejects.toMatchObject({
          name: "LedgerIntegrityError",
          reason: "invalid-event-order",
        });
      } finally {
        missingAttemptReservationReader.close();
      }

      expectedValidationRunId = plan.runId;
      const ref = await research.runner.run(plan);
      const modelCallsAfterFirstRun = observedPlans.length;
      expect(dispatchBudgetSnapshots).toHaveLength(modelCallsAfterFirstRun);
      expect(
        dispatchBudgetSnapshots.every(
          (snapshot) =>
            snapshot.reservedAttempts >= 1 && snapshot.ownReservationDurable,
        ),
      ).toBe(true);
      expect(
        new Set(dispatchBudgetSnapshots.map((snapshot) => snapshot.role)),
      ).toEqual(
        new Set([
          "root-planner",
          "finder",
          "root-evaluator",
          "root-synthesizer",
          "adversarial-critic",
          "validator",
        ]),
      );
      expect(
        dispatchBudgetSnapshots.find(
          (snapshot) =>
            snapshot.runId === plan.runId && snapshot.role === "finder",
        ),
      ).toMatchObject({ protectedRootTokens: 100_000 });
      expect(
        dispatchBudgetSnapshots.find(
          (snapshot) =>
            snapshot.runId === plan.runId &&
            snapshot.role === "root-evaluator" &&
            snapshot.assignmentKind === "wave-evaluation",
        ),
      ).toMatchObject({
        ownReservationDurable: true,
        protectedRootTokens: 0,
        explorationReservedTokens: 100_000,
        validationRemainingTokens: 400_000,
      });
      expect(
        observedPlans.every((attempt) =>
          attempt.prompt.includes(
            "Current research attacker scope permits only unauthenticated attackers and subscriber-equivalent low-privilege users.",
          ),
        ),
      ).toBe(true);
      const finderPlan = observedPlans.find(
        (attempt) => attempt.role === "finder",
      );
      if (finderPlan?.schemaVersion !== 2) {
        throw new Error("Expected a current Finder Attempt");
      }
      const finderOutputSchema = JSON.stringify(finderPlan.outputJsonSchema);
      expect(finderOutputSchema).toContain('"unauthenticated"');
      expect(finderOutputSchema).toContain('"subscriber"');
      expect(finderOutputSchema).toContain('"customer"');
      expect(finderOutputSchema).not.toContain('"contributor"');
      expect(finderOutputSchema).not.toContain('"unresolved"');
      const finderPlans = observedPlans.filter(
        (
          attempt,
        ): attempt is Extract<
          ModelAttemptPlan,
          { schemaVersion: 2; role: "finder" }
        > => attempt.schemaVersion === 2 && attempt.role === "finder",
      );
      expect(finderPlans).toHaveLength(3);
      expect(
        new Set(finderPlans.map((attempt) => attempt.attemptId)).size,
      ).toBe(3);
      expect(
        new Set(finderPlans.map((attempt) => attempt.assignment.leaseId)).size,
      ).toBe(3);
      const finderThesisDigests = finderPlans.map((attempt) => {
        if (attempt.assignment.kind !== "research-thesis") {
          throw new Error("Initial normal Wave used a non-thesis assignment");
        }
        return attempt.assignment.thesis.digest;
      });
      expect(new Set(finderThesisDigests).size).toBe(3);
      const inspected = await research.reader.inspect(input.campaignId, {
        kind: "run",
        runId: plan.runId,
      });
      expect({ ref, inspected }).toMatchObject({
        ref: { schemaVersion: 4, decision: "incomplete" },
        inspected: {
          kind: "run",
          value: {
            schemaVersion: 4,
            iterationDecision: {
              schemaVersion: 3,
              actions: [
                { kind: "admit-validation" },
                { kind: "admit-depth" },
                { kind: "schedule-work" },
                { kind: "schedule-work" },
                { kind: "schedule-work" },
                { kind: "schedule-work" },
                { kind: "retain" },
              ],
            },
            depthWorkQueue: {
              schemaVersion: 2,
              items: 5,
              batches: 2,
              familyBindings: 5,
            },
            depthResearch: {
              schemaVersion: 4,
              rounds: [
                {
                  schemaVersion: 3,
                  batches: [
                    {
                      schemaVersion: 2,
                      synthesis: { ref: { proposals: 1 } },
                      critique: { ref: { dispositions: 1 } },
                      evaluation: { ref: { schemaVersion: 2, actions: 1 } },
                    },
                    {
                      schemaVersion: 2,
                      synthesis: { ref: { proposals: 1 } },
                      critique: { ref: { dispositions: 1 } },
                      evaluation: { ref: { schemaVersion: 2, actions: 1 } },
                    },
                  ],
                },
              ],
            },
            validations: [{ status: "source-validated" }],
            findings: [
              {
                kind: "finding",
                schemaVersion: 1,
                id: expect.any(String),
                digest: expect.any(String),
                validation: {
                  schemaVersion: 3,
                  candidateId: expect.any(String),
                },
              },
            ],
            coverage: {
              kind: "campaign-coverage",
              schemaVersion: 1,
              status: "incomplete",
              reason: "research-work-remains",
            },
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
      ).toHaveLength(1);
      expect(validatorProgressSnapshots).toMatchObject([
        {
          kind: "progress",
          counts: {
            attempts: { started: 12, completed: 11, active: 1 },
          },
          activeAttempts: [{ role: "validator" }],
          usage: {
            measurement: "partial",
            modelAttempts: 11,
            reportedModelAttempts: 11,
            modelTokens: { total: 220 },
            estimatedCostUsd: 2.75,
          },
        },
      ]);
      await expect(
        research.reader.inspect(input.campaignId, { kind: "progress" }),
      ).resolves.toMatchObject({
        kind: "progress",
        counts: {
          attempts: { started: 12, completed: 12, active: 0 },
        },
        activeAttempts: [],
        usage: {
          measurement: "reported",
          modelAttempts: 12,
          reportedModelAttempts: 12,
          modelTokens: { total: 240 },
          estimatedCostUsd: 3,
        },
      });
      await expect(
        research.reader.inspect(input.campaignId, {
          kind: "budget",
          runId: plan.runId,
        }),
      ).resolves.toMatchObject({
        kind: "budget",
        schemaVersion: 2,
        campaignId: input.campaignId,
        runId: plan.runId,
        policy: {
          id: "semantic-research-recall-baseline-v7",
          digest: expect.stringMatching(/^sha256:/),
        },
        enforcement: {
          modelAttempts: "hard-precondition",
          modelWallTimeMs: "hard-precondition",
          estimatedCostUsd: "hard-precondition",
          modelTokens: "reported-postcondition",
          modelTurns: "reported-postcondition",
        },
        spent: {
          modelAttempts: 12,
          modelWallTimeMs: 120,
          modelTurns: 12,
          modelTokens: 240,
          structuredOutputBytes: 12_000,
          estimatedCostUsd: 3,
          source: { queries: 6, scanBytes: 600, responseBytes: 300 },
        },
        reserved: {
          modelAttempts: 0,
          modelWallTimeMs: 0,
          modelTokens: 0,
          estimatedCostUsd: 0,
        },
        protectedReservations: [],
        remaining: {
          modelAttempts: 116,
          modelWallTimeMs: 43_199_880,
          modelTokens: 4_599_760,
          estimatedCostUsd: 147,
        },
        owners: {
          exploration: {
            spent: { modelAttempts: 11, modelTokens: 220 },
            remaining: {
              modelWallTimeMs: 35_999_890,
              modelTokens: 4_199_780,
              estimatedCostUsd: 117.25,
            },
          },
          validation: {
            spent: { modelAttempts: 1, modelTokens: 20 },
            remaining: {
              modelWallTimeMs: 7_199_990,
              modelTokens: 399_980,
              estimatedCostUsd: 29.75,
            },
          },
        },
        unknownUsageAttemptIds: [],
        overshoot: {
          modelWallTimeMs: 0,
          modelTokens: 0,
          estimatedCostUsd: 0,
        },
      });
      expect([...new Set(depthQueuesObservedBeforeSynthesis)]).toHaveLength(1);
      expect([...new Set(depthQueuesObservedBeforeValidation)]).toHaveLength(1);
      const depthPlans = observedPlans.filter(
        (attempt) =>
          attempt.role === "root-synthesizer" ||
          attempt.role === "adversarial-critic" ||
          (attempt.role === "root-evaluator" &&
            attempt.assignment.kind === "depth-evaluation"),
      );
      expect(depthPlans.map((attempt) => attempt.role)).toEqual([
        "root-synthesizer",
        "adversarial-critic",
        "root-evaluator",
        "root-synthesizer",
        "adversarial-critic",
        "root-evaluator",
      ]);
      expect(
        depthPlans.filter((attempt) => attempt.role === "root-synthesizer"),
      ).not.toContainEqual(expect.objectContaining({ sourceToolPolicy }));
      expect(
        depthPlans.filter((attempt) => attempt.role === "adversarial-critic"),
      ).toEqual([
        expect.objectContaining({ sourceToolPolicy }),
        expect.objectContaining({ sourceToolPolicy }),
      ]);
      expect(
        new Set(depthPlans.map((attempt) => attempt.attemptId)),
      ).toHaveProperty("size", 6);
      expect(
        observedPlans.filter(
          (attempt) => attempt.role === "validation-synthesizer",
        ),
      ).toEqual([]);

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
          {
            completion: {
              validation: { schemaVersion: 3 },
              disposition: "source-validated",
            },
          },
        ]);
        await expect(
          record.listSemanticCampaignAttempts(input.campaignId, plan.runId),
        ).resolves.toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              intent: expect.objectContaining({ role: "validator" }),
              completion: expect.objectContaining({
                value: expect.objectContaining({ role: "validator" }),
              }),
            }),
          ]),
        );
        await expect(
          record.listValidationFrontierGaps(input.campaignId, plan.runId),
        ).resolves.toEqual([]);
        await expect(
          record.readApproachFamilyRegistryV3(input.campaignId, plan.runId),
        ).resolves.toMatchObject({
          value: { depthDecisions: [expect.any(String), expect.any(String)] },
        });
        if (
          inspected.kind !== "run" ||
          inspected.value.schemaVersion !== 4 ||
          !("findings" in inspected.value)
        ) {
          throw new Error("Expected a source-validated Finding");
        }
        const findingRef = inspected.value.findings[0];
        if (findingRef === undefined) {
          throw new Error("Expected a source-validated Finding ref");
        }
        expect(inspected.value).not.toHaveProperty(
          "runtimeVerificationPackets",
        );
        expect(inspected.value).not.toHaveProperty(
          "runtimeVerificationPacketFailures",
        );
        firstFindingId = findingRef.id;
        await expect(
          record.readRuntimeVerificationPacket(
            input.campaignId,
            findingRef.candidateId,
          ),
        ).resolves.toBeUndefined();
        await expect(
          research.reader.inspect(input.campaignId, {
            kind: "finding",
            runId: plan.runId,
            findingId: findingRef.id,
          }),
        ).resolves.toMatchObject({
          kind: "finding",
          schemaVersion: 1,
          campaignId: input.campaignId,
          runId: plan.runId,
          finding: {
            kind: "finding",
            schemaVersion: 1,
            id: findingRef.id,
            target: input.targetSnapshot,
            manifest: prepared.targetFileManifest,
            candidate: { id: findingRef.candidateId },
            validation: { schemaVersion: 3 },
            causalIdentity: { brokenSecurityProperty: "state-ownership" },
            attackerPremise: "unauthenticated",
            brokenSecurityProperty: "state-ownership",
            sourceRoute: [{ evidence: [anchor] }],
            sourceEvidence: [anchor],
            counterevidence: {
              status: "pass",
              evidence: [anchor],
            },
          },
        });
        await expect(
          research.reader.inspect(input.campaignId, {
            kind: "finding",
            runId: plan.runId,
            findingId: digest("f"),
          }),
        ).rejects.toEqual(
          new CampaignFindingNotFoundError(
            input.campaignId,
            plan.runId,
            digest("f"),
          ),
        );
        const completion = await record.listValidationCompletions(
          input.campaignId,
          plan.runId,
        );
        expect(findingRef.validation).toEqual(
          completion[0]?.completion.validation,
        );
      } finally {
        record.close();
      }

      await expect(research.runner.run(plan)).resolves.toEqual(ref);
      expect(observedPlans).toHaveLength(modelCallsAfterFirstRun);

      validationDisposition = "needs-research";
      const needsResearchPlan = campaignDefaultSemanticRunPlanV3Schema.parse({
        ...plan,
        runId: "source-validation-needs-research",
      });
      expectedValidationRunId = needsResearchPlan.runId;
      const needsResearchRef = await research.runner.run(needsResearchPlan);
      const needsResearchInspected = await research.reader.inspect(
        input.campaignId,
        { kind: "run", runId: needsResearchPlan.runId },
      );
      expect({ needsResearchRef, needsResearchInspected }).toMatchObject({
        needsResearchRef: { schemaVersion: 4, decision: "incomplete" },
        needsResearchInspected: {
          value: {
            validations: [{ status: "needs-research" }],
            findings: [],
            coverage: { status: "incomplete" },
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

      validationDisposition = "disproven";
      candidateIdentitySuffix = "-disproven";
      const disprovenPlan = campaignDefaultSemanticRunPlanV3Schema.parse({
        ...plan,
        runId: "source-validation-disproven",
      });
      expectedValidationRunId = disprovenPlan.runId;
      await research.runner.run(disprovenPlan);
      await expect(
        research.reader.inspect(input.campaignId, {
          kind: "run",
          runId: disprovenPlan.runId,
        }),
      ).resolves.toMatchObject({
        value: {
          validations: [{ status: "disproven" }],
          findings: [],
          coverage: { status: "incomplete" },
        },
      });

      validationDisposition = "source-validated";
      candidateIdentitySuffix = "";
      depthFailure = "budget-exhausted";
      if (firstFindingId === undefined) {
        throw new Error("Expected the first Finding identity");
      }
      const failurePlan = campaignDefaultSemanticRunPlanV3Schema.parse({
        ...plan,
        runId: "source-validation-depth-budget-exhausted",
      });
      expectedValidationRunId = failurePlan.runId;
      const failureCallOffset = observedPlans.length;
      const failureRef = await research.runner.run(failurePlan);
      const failureInspected = await research.reader.inspect(input.campaignId, {
        kind: "run",
        runId: failurePlan.runId,
      });
      expect({ failureRef, failureInspected }).toMatchObject({
        failureRef: { schemaVersion: 4, decision: "incomplete" },
        failureInspected: {
          value: {
            depthResearch: {
              schemaVersion: 4,
              rounds: [
                {
                  batches: [
                    {
                      kind: "semantic-depth-batch-incomplete",
                      stage: "root-synthesis",
                      reason: "synthesizer-failed",
                    },
                    {
                      kind: "semantic-depth-batch-incomplete",
                      stage: "root-synthesis",
                      reason: "synthesizer-failed",
                    },
                  ],
                },
              ],
            },
            approachFamilyRegistry: { states: { active: 1 } },
            findings: [
              {
                kind: "finding",
                schemaVersion: 1,
                id: firstFindingId,
              },
            ],
            coverage: { status: "incomplete" },
            decision: {
              kind: "incomplete",
              reason: "research-work-remains",
            },
          },
        },
      });
      const failureCalls = observedPlans.slice(failureCallOffset);
      expect(
        failureCalls.filter((attempt) => attempt.role === "root-synthesizer"),
      ).toHaveLength(2);
      expect(
        failureCalls.filter((attempt) => attempt.role === "adversarial-critic"),
      ).toEqual([]);

      depthFailure = "none";
      candidateIdentitySuffix = "-exploration-provider-loss";
      const explorationProviderLossPlan =
        campaignDefaultSemanticRunPlanV3Schema.parse({
          ...plan,
          runId: "source-exploration-provider-loss",
        });
      expectedValidationRunId = explorationProviderLossPlan.runId;
      const explorationLossCallOffset = observedPlans.length;
      injectUnknownExplorationResult = true;
      const interruptedExploration = openResearch({
        databasePath,
        campaignExecution,
      });
      try {
        await expect(
          interruptedExploration.runner.run(explorationProviderLossPlan),
        ).rejects.toThrow("Injected Exploration provider result loss");
      } finally {
        interruptedExploration.close();
        injectUnknownExplorationResult = false;
      }
      const interruptedAttempt = observedPlans
        .slice(explorationLossCallOffset)
        .find((attempt) => attempt.role === "root-planner");
      if (interruptedAttempt === undefined) {
        throw new Error("Expected an interrupted Exploration Attempt");
      }
      await expect(
        research.reader.inspect(input.campaignId, { kind: "progress" }),
      ).resolves.toMatchObject({
        kind: "progress",
        activeAttempts: expect.arrayContaining([
          expect.objectContaining({
            attemptId: interruptedAttempt.attemptId,
            role: "root-planner",
          }),
        ]),
      });
      await expect(
        research.reader.inspect(input.campaignId, {
          kind: "budget",
          runId: explorationProviderLossPlan.runId,
        }),
      ).resolves.toMatchObject({
        kind: "budget",
        activeReservations: expect.arrayContaining([
          expect.objectContaining({
            attemptId: interruptedAttempt.attemptId,
            role: "root-planner",
          }),
        ]),
      });

      const recoveredExploration = openResearch({
        databasePath,
        campaignExecution,
      });
      try {
        await expect(
          recoveredExploration.runner.run(explorationProviderLossPlan),
        ).resolves.toMatchObject({ schemaVersion: 4 });
        await expect(
          recoveredExploration.reader.inspect(input.campaignId, {
            kind: "progress",
          }),
        ).resolves.toMatchObject({
          kind: "progress",
          activeAttempts: [],
        });
        const recoveredExplorationBudget =
          await recoveredExploration.reader.inspect(input.campaignId, {
            kind: "budget",
            runId: explorationProviderLossPlan.runId,
          });
        expect(recoveredExplorationBudget).toMatchObject({
          kind: "budget",
          activeReservations: [],
          unknownUsageAttemptIds: expect.arrayContaining([
            interruptedAttempt.attemptId,
          ]),
        });
        await expect(
          recoveredExploration.runner.run(explorationProviderLossPlan),
        ).resolves.toMatchObject({ schemaVersion: 4 });
        await expect(
          recoveredExploration.reader.inspect(input.campaignId, {
            kind: "budget",
            runId: explorationProviderLossPlan.runId,
          }),
        ).resolves.toEqual(recoveredExplorationBudget);
      } finally {
        recoveredExploration.close();
      }
      expect(
        observedPlans
          .slice(explorationLossCallOffset)
          .filter(
            (attempt) => attempt.attemptId === interruptedAttempt.attemptId,
          ),
      ).toHaveLength(1);

      candidateIdentitySuffix = "-crash-recovery";
      const crashRecoveryValidation = {
        ...plan.validation,
        validationPolicy: {
          ...plan.validation.validationPolicy,
          digest: digest("f"),
        },
      };
      const crashRecoveryPlan = campaignDefaultSemanticRunPlanV3Schema.parse({
        ...plan,
        runId: "source-validation-crash-recovery",
        validation: crashRecoveryValidation,
        bindings: bindCurrentSemanticCampaignConfiguration({
          ...plan,
          validation: crashRecoveryValidation,
        }),
      });
      expectedValidationRunId = crashRecoveryPlan.runId;
      const crashCallOffset = observedPlans.length;
      const budgetBeforeCrash = await research.reader.inspect(
        input.campaignId,
        { kind: "budget", runId: plan.runId },
      );
      if (budgetBeforeCrash.kind !== "budget") {
        throw new Error("Expected Campaign budget before injected crash");
      }
      const crashingResearch = openResearch({
        databasePath,
        campaignExecution: {
          ...campaignExecution,
          validationAttemptFaultBoundary: {
            afterResultStored: () => {
              throw new Error(
                "Injected crash after Validator result persistence",
              );
            },
          },
        },
      });
      try {
        await expect(
          crashingResearch.runner.run(crashRecoveryPlan),
        ).rejects.toThrow("Injected crash after Validator result persistence");
      } finally {
        crashingResearch.close();
      }
      const callsThroughCrash = observedPlans.slice(crashCallOffset);
      expect(
        callsThroughCrash.filter((attempt) => attempt.role === "validator"),
      ).toHaveLength(1);
      const progressAfterCrash = await research.reader.inspect(
        input.campaignId,
        { kind: "progress" },
      );
      expect(progressAfterCrash).toMatchObject({
        kind: "progress",
        activeAttempts: [{ role: "validator" }],
      });
      if (progressAfterCrash.kind !== "progress") {
        throw new Error("Expected Campaign progress after injected crash");
      }
      const budgetAfterCrash = await research.reader.inspect(input.campaignId, {
        kind: "budget",
        runId: crashRecoveryPlan.runId,
      });
      expect(budgetAfterCrash).toMatchObject({
        kind: "budget",
        owners: {
          validation: {
            spent: budgetBeforeCrash.owners.validation.spent,
            reserved: { modelAttempts: 1, modelTokens: 100_000 },
          },
        },
      });
      if (budgetAfterCrash.kind !== "budget") {
        throw new Error("Expected Campaign budget after injected crash");
      }

      const recoveringResearch = openResearch({
        databasePath,
        campaignExecution,
      });
      try {
        await expect(
          recoveringResearch.runner.run(crashRecoveryPlan),
        ).resolves.toMatchObject({ schemaVersion: 4 });
        await expect(
          recoveringResearch.reader.inspect(input.campaignId, {
            kind: "run",
            runId: crashRecoveryPlan.runId,
          }),
        ).resolves.toMatchObject({
          kind: "run",
          value: {
            validations: [{ status: "source-validated" }],
          },
        });
        const progressAfterRecovery = await recoveringResearch.reader.inspect(
          input.campaignId,
          { kind: "progress" },
        );
        expect(progressAfterRecovery).toMatchObject({
          kind: "progress",
          activeAttempts: [],
          usage: {
            modelAttempts: progressAfterCrash.usage.modelAttempts + 1,
            reportedModelAttempts:
              progressAfterCrash.usage.reportedModelAttempts + 1,
            modelTokens: {
              total: progressAfterCrash.usage.modelTokens.total + 20,
            },
            estimatedCostUsd: progressAfterCrash.usage.estimatedCostUsd + 0.25,
          },
        });
        const budgetAfterRecovery = await recoveringResearch.reader.inspect(
          input.campaignId,
          { kind: "budget", runId: crashRecoveryPlan.runId },
        );
        expect(budgetAfterRecovery).toMatchObject({
          kind: "budget",
          owners: {
            validation: {
              spent: {
                modelAttempts:
                  budgetBeforeCrash.owners.validation.spent.modelAttempts + 1,
                modelTokens:
                  budgetBeforeCrash.owners.validation.spent.modelTokens + 20,
              },
              reserved: { modelAttempts: 0, modelTokens: 0 },
            },
          },
        });
        const recoveredBudgetSnapshot = budgetAfterRecovery;
        await expect(
          recoveringResearch.runner.run(crashRecoveryPlan),
        ).resolves.toMatchObject({ schemaVersion: 4 });
        await expect(
          recoveringResearch.reader.inspect(input.campaignId, {
            kind: "budget",
            runId: crashRecoveryPlan.runId,
          }),
        ).resolves.toEqual(recoveredBudgetSnapshot);
      } finally {
        recoveringResearch.close();
      }
      expect(
        observedPlans
          .slice(crashCallOffset)
          .filter((attempt) => attempt.role === "validator"),
      ).toHaveLength(1);

      candidateIdentitySuffix = "-unknown-provider-result";
      const unknownResultPlan = campaignDefaultSemanticRunPlanV3Schema.parse({
        ...plan,
        runId: "source-validation-unknown-provider-result",
      });
      expectedValidationRunId = unknownResultPlan.runId;
      const unknownCallOffset = observedPlans.length;
      const budgetBeforeUnknownResult = await research.reader.inspect(
        input.campaignId,
        { kind: "budget", runId: plan.runId },
      );
      if (budgetBeforeUnknownResult.kind !== "budget") {
        throw new Error("Expected Campaign budget before provider result loss");
      }
      injectUnknownValidatorResult = true;
      const unknownResultResearch = openResearch({
        databasePath,
        campaignExecution,
      });
      try {
        await expect(
          unknownResultResearch.runner.run(unknownResultPlan),
        ).rejects.toThrow("Injected provider result loss");
      } finally {
        unknownResultResearch.close();
        injectUnknownValidatorResult = false;
      }
      const progressAfterUnknownResult = await research.reader.inspect(
        input.campaignId,
        { kind: "progress" },
      );
      expect(progressAfterUnknownResult).toMatchObject({
        kind: "progress",
        activeAttempts: [{ role: "validator" }],
      });
      if (progressAfterUnknownResult.kind !== "progress") {
        throw new Error("Expected progress after unknown provider result");
      }
      await expect(
        research.reader.inspect(input.campaignId, {
          kind: "budget",
          runId: unknownResultPlan.runId,
        }),
      ).resolves.toMatchObject({
        owners: {
          validation: {
            spent: budgetBeforeUnknownResult.owners.validation.spent,
            reserved: { modelAttempts: 1, modelTokens: 100_000 },
          },
        },
      });

      const unknownRecoveryResearch = openResearch({
        databasePath,
        campaignExecution,
      });
      try {
        await expect(
          unknownRecoveryResearch.runner.run(unknownResultPlan),
        ).resolves.toMatchObject({ schemaVersion: 4, decision: "incomplete" });
        await expect(
          unknownRecoveryResearch.reader.inspect(input.campaignId, {
            kind: "run",
            runId: unknownResultPlan.runId,
          }),
        ).resolves.toMatchObject({
          kind: "run",
          value: {
            validations: [
              {
                status: "validation-pending",
                reason: "validator-attempt-failed",
              },
            ],
            findings: [],
            coverage: { status: "incomplete" },
          },
        });
        const progressAfterUnknownRecovery =
          await unknownRecoveryResearch.reader.inspect(input.campaignId, {
            kind: "progress",
          });
        expect(progressAfterUnknownRecovery).toMatchObject({
          kind: "progress",
          activeAttempts: [],
          usage: {
            measurement: "partial",
            modelAttempts: progressAfterUnknownResult.usage.modelAttempts + 1,
            reportedModelAttempts:
              progressAfterUnknownResult.usage.reportedModelAttempts,
            modelTokens: {
              total: progressAfterUnknownResult.usage.modelTokens.total,
            },
            estimatedCostUsd: progressAfterUnknownResult.usage.estimatedCostUsd,
          },
        });
        const budgetAfterUnknownRecovery =
          await unknownRecoveryResearch.reader.inspect(input.campaignId, {
            kind: "budget",
            runId: unknownResultPlan.runId,
          });
        expect(budgetAfterUnknownRecovery).toMatchObject({
          kind: "budget",
          owners: {
            validation: {
              spent: {
                modelAttempts:
                  budgetBeforeUnknownResult.owners.validation.spent
                    .modelAttempts + 1,
                modelTokens:
                  budgetBeforeUnknownResult.owners.validation.spent
                    .modelTokens + 100_000,
              },
              reserved: { modelAttempts: 0, modelTokens: 0 },
            },
          },
          unknownUsageAttemptIds: expect.arrayContaining([
            expect.stringMatching(/^validator:/),
          ]),
        });
        const unknownBudgetSnapshot = budgetAfterUnknownRecovery;
        await expect(
          unknownRecoveryResearch.runner.run(unknownResultPlan),
        ).resolves.toMatchObject({ schemaVersion: 4, decision: "incomplete" });
        await expect(
          unknownRecoveryResearch.reader.inspect(input.campaignId, {
            kind: "budget",
            runId: unknownResultPlan.runId,
          }),
        ).resolves.toEqual(unknownBudgetSnapshot);
      } finally {
        unknownRecoveryResearch.close();
      }
      expect(
        observedPlans
          .slice(unknownCallOffset)
          .filter((attempt) => attempt.role === "validator"),
      ).toHaveLength(1);

      candidateIdentitySuffix = "-invalid-stored-result";
      const invalidStoredResultPlan =
        campaignDefaultSemanticRunPlanV3Schema.parse({
          ...plan,
          runId: "source-validation-invalid-stored-result",
        });
      expectedValidationRunId = invalidStoredResultPlan.runId;
      const invalidResultCallOffset = observedPlans.length;
      const invalidResultCrashResearch = openResearch({
        databasePath,
        campaignExecution: {
          ...campaignExecution,
          validationAttemptFaultBoundary: {
            afterResultStored: () => {
              throw new Error("Injected crash before invalid result recovery");
            },
          },
        },
      });
      try {
        await expect(
          invalidResultCrashResearch.runner.run(invalidStoredResultPlan),
        ).rejects.toThrow("Injected crash before invalid result recovery");
      } finally {
        invalidResultCrashResearch.close();
      }
      const invalidResultValidatorPlan = observedPlans
        .slice(invalidResultCallOffset)
        .find((attempt) => attempt.role === "validator");
      if (invalidResultValidatorPlan === undefined) {
        throw new Error("Expected a Validator plan before CAS corruption");
      }
      const invalidResultArtifactStore = {
        putJson: (value: unknown) => artifacts.putJson(value),
        readJson: async (artifactDigest: string) => {
          const value = await artifacts.readJson(artifactDigest);
          if (
            typeof value === "object" &&
            value !== null &&
            "kind" in value &&
            value.kind === "model-attempt-result" &&
            "role" in value &&
            value.role === "validator" &&
            "attemptId" in value &&
            value.attemptId === invalidResultValidatorPlan.attemptId
          ) {
            return {
              ...value,
              attemptId: "validator:identity-mismatch",
            };
          }
          return value;
        },
      };
      const invalidResultRecoveryResearch = openResearch({
        databasePath,
        campaignExecution: {
          ...campaignExecution,
          artifactStore: invalidResultArtifactStore,
        },
      });
      try {
        await expect(
          invalidResultRecoveryResearch.runner.run(invalidStoredResultPlan),
        ).rejects.toThrow("Validator Attempt result mismatch");
      } finally {
        invalidResultRecoveryResearch.close();
      }
      await expect(
        research.reader.inspect(input.campaignId, { kind: "progress" }),
      ).resolves.toMatchObject({
        kind: "progress",
        activeAttempts: [{ role: "validator" }],
      });
      expect(
        observedPlans
          .slice(invalidResultCallOffset)
          .filter((attempt) => attempt.role === "validator"),
      ).toHaveLength(1);

      const validResultRecoveryResearch = openResearch({
        databasePath,
        campaignExecution,
      });
      try {
        await expect(
          validResultRecoveryResearch.runner.run(invalidStoredResultPlan),
        ).resolves.toMatchObject({ schemaVersion: 4 });
      } finally {
        validResultRecoveryResearch.close();
      }
      expect(
        observedPlans
          .slice(invalidResultCallOffset)
          .filter((attempt) => attempt.role === "validator"),
      ).toHaveLength(1);

      candidateIdentitySuffix = "-cross-candidate-budget";
      validationCandidateCount = 2;
      validatorReportedTokens = 450_000;
      const crossCandidateBudgetPlan =
        campaignDefaultSemanticRunPlanV3Schema.parse({
          ...plan,
          runId: "source-validation-cross-candidate-budget",
        });
      expectedValidationRunId = crossCandidateBudgetPlan.runId;
      const crossCandidateCallOffset = observedPlans.length;
      await expect(
        research.runner.run(crossCandidateBudgetPlan),
      ).resolves.toMatchObject({ schemaVersion: 4, decision: "incomplete" });
      await expect(
        research.reader.inspect(input.campaignId, {
          kind: "run",
          runId: crossCandidateBudgetPlan.runId,
        }),
      ).resolves.toMatchObject({
        value: {
          validations: [{ status: "source-validated" }],
          findings: [{ kind: "finding", schemaVersion: 1 }],
          coverage: { status: "incomplete" },
          approachFamilyRegistry: {
            pendingValidations: 1,
            validationOutcomes: 1,
          },
          decision: { kind: "incomplete", reason: "validation-pending" },
        },
      });
      expect(
        observedPlans
          .slice(crossCandidateCallOffset)
          .filter((attempt) => attempt.role === "validator"),
      ).toHaveLength(1);
      await expect(
        research.reader.inspect(input.campaignId, {
          kind: "budget",
          runId: crossCandidateBudgetPlan.runId,
        }),
      ).resolves.toMatchObject({
        owners: {
          validation: {
            remaining: { modelTokens: 0 },
          },
        },
        overshoot: { modelTokens: 350_000 },
      });
      const crossCandidateCallsAfterCompletion = observedPlans.length;
      await expect(
        research.runner.run(crossCandidateBudgetPlan),
      ).resolves.toMatchObject({ schemaVersion: 4, decision: "incomplete" });
      expect(observedPlans).toHaveLength(crossCandidateCallsAfterCompletion);

      const measuredCampaignInput = {
        ...input,
        campaignId: "campaign-validation-measured-root-reserve",
      };
      const measuredPreparation = await research.runner.prepare(
        measuredCampaignInput,
      );
      if (measuredPreparation.targetFileManifest === undefined) {
        throw new Error("Expected a measured Campaign manifest");
      }
      activeCampaignId = measuredCampaignInput.campaignId;
      finderReportedTokens = [1_400_000, 1_400_000, 1_376_741];
      finderReportedTokenIndex = 0;
      validationCandidateCount = 1;
      validatorReportedTokens = undefined;
      validationDisposition = "source-validated";
      depthFailure = "none";
      reverseValidationEvidence = true;
      candidateIdentitySuffix = "-measured-root-reserve";
      const measuredPlan = campaignDefaultSemanticRunPlanV3Schema.parse({
        ...plan,
        campaignId: measuredCampaignInput.campaignId,
        runId: "source-validation-measured-root-reserve",
        preparationDigest: measuredPreparation.inputDigest,
        manifest: measuredPreparation.targetFileManifest,
      });
      expectedValidationRunId = measuredPlan.runId;
      const measuredCallOffset = observedPlans.length;
      await expect(research.runner.run(measuredPlan)).resolves.toMatchObject({
        schemaVersion: 4,
        decision: "incomplete",
      });
      const measuredInspected = await research.reader.inspect(
        measuredCampaignInput.campaignId,
        {
          kind: "run",
          runId: measuredPlan.runId,
        },
      );
      expect(measuredInspected).toMatchObject({
        value: {
          validations: [{ status: "source-validated" }],
          findings: [{ kind: "finding", schemaVersion: 1 }],
          coverage: { status: "incomplete" },
          decision: { kind: "incomplete", reason: "research-work-remains" },
        },
      });
      const incompleteDepth = z
        .object({
          value: z.object({
            depthResearch: z.object({
              rounds: z.array(
                z.object({
                  batches: z.array(
                    z.object({
                      kind: z.literal("semantic-depth-batch-incomplete"),
                      stage: z.literal("root-synthesis"),
                      artifactDigest: z.string(),
                    }),
                  ),
                }),
              ),
            }),
          }),
        })
        .parse(measuredInspected);
      const measuredCalls = observedPlans.slice(measuredCallOffset);
      const initialRootIndex = measuredCalls.findIndex(
        (attempt) =>
          attempt.role === "root-evaluator" &&
          attempt.assignment.kind === "wave-evaluation",
      );
      expect(initialRootIndex).toBeGreaterThan(0);
      expect(
        measuredCalls
          .slice(0, initialRootIndex)
          .filter((attempt) => attempt.role === "finder"),
      ).toHaveLength(3);
      expect(
        measuredCalls.filter((attempt) => attempt.role === "root-synthesizer"),
      ).toEqual([]);
      expect(
        measuredCalls.filter((attempt) => attempt.role === "validator"),
      ).toHaveLength(1);
      const measuredRootDispatch = dispatchBudgetSnapshots.find(
        (snapshot) =>
          snapshot.runId === measuredPlan.runId &&
          snapshot.role === "root-evaluator" &&
          snapshot.assignmentKind === "wave-evaluation",
      );
      expect(measuredRootDispatch).toMatchObject({
        ownReservationDurable: true,
        protectedRootTokens: 0,
        explorationReservedTokens: 100_000,
      });
      if (measuredRootDispatch === undefined) {
        throw new Error("Expected measured Root Evaluator dispatch");
      }
      expect(measuredRootDispatch.overshootTokens).toBe(1_176_741);
      const measuredBudget = await research.reader.inspect(
        measuredCampaignInput.campaignId,
        {
          kind: "budget",
          runId: measuredPlan.runId,
        },
      );
      expect(measuredBudget).toMatchObject({
        kind: "budget",
        schemaVersion: 2,
        protectedReservations: [],
        owners: {
          validation: {
            limits: { modelTokens: 400_000 },
          },
        },
      });
      if (measuredBudget.kind !== "budget") {
        throw new Error("Expected measured Campaign budget");
      }
      expect(measuredBudget.overshoot.modelTokens).toBe(1_176_741);
      const idempotencyRecord = openSqliteResearchRecord({
        databasePath,
        artifactStore: artifacts,
      });
      try {
        const queueRecord =
          await idempotencyRecord.readSemanticDepthWorkQueueV2(
            measuredCampaignInput.campaignId,
            measuredPlan.runId,
          );
        const incompleteBatch = incompleteDepth.value.depthResearch.rounds
          .flatMap((round) => round.batches)
          .at(0);
        if (queueRecord === undefined || incompleteBatch === undefined) {
          throw new Error("Expected durable incomplete Depth artifacts");
        }
        const queue = semanticDepthWorkQueueV2Schema.parse(
          await artifacts.readJson(queueRecord.queue.digest),
        );
        const incomplete = chainSynthesisIncompleteSchema.parse(
          await artifacts.readJson(incompleteBatch.artifactDigest),
        );
        const firstReplay =
          await idempotencyRecord.recordSemanticChainSynthesisV2(
            measuredCampaignInput.campaignId,
            measuredPlan.runId,
            queue,
            incomplete,
          );
        await expect(
          idempotencyRecord.recordSemanticChainSynthesisV2(
            measuredCampaignInput.campaignId,
            measuredPlan.runId,
            queue,
            incomplete,
          ),
        ).resolves.toEqual(firstReplay);
      } finally {
        idempotencyRecord.close();
      }
      const replayAfterRootCompletion = openResearch({
        databasePath,
        campaignExecution,
      });
      try {
        await expect(
          replayAfterRootCompletion.reader.inspect(
            measuredCampaignInput.campaignId,
            {
              kind: "budget",
              runId: measuredPlan.runId,
            },
          ),
        ).resolves.toEqual(measuredBudget);
      } finally {
        replayAfterRootCompletion.close();
      }
    } finally {
      research.close();
      await rm(directory, { force: true, recursive: true });
    }
  }, 30_000);

  it("replays a pre-result-stored Validator completion", async () => {
    const directory = await mkdtemp(
      join(tmpdir(), "campaign-validation-legacy-"),
    );
    const databasePath = join(directory, "research.sqlite");
    await copyFile(
      new URL(
        "../fixtures/research/validation-completion-before-result-stored-ca2d862.sqlite",
        import.meta.url,
      ),
      databasePath,
    );
    const research = openResearch({ databasePath });

    try {
      await expect(
        research.reader.inspect("campaign-validation-run", {
          kind: "run",
          runId: "source-validation-run",
        }),
      ).resolves.toMatchObject({
        kind: "run",
        value: {
          schemaVersion: 3,
          validations: [{ status: "ready-for-runtime" }],
          runtimeVerificationPackets: [{ packet: { schemaVersion: 2 } }],
        },
      });
      const legacyBudget = await research.reader.inspect(
        "campaign-validation-run",
        {
          kind: "budget",
          runId: "source-validation-run",
        },
      );
      expect(legacyBudget).toMatchObject({
        kind: "budget",
        schemaVersion: 1,
        spent: { modelAttempts: 12, modelTokens: 3_900_000 },
        reserved: { modelAttempts: 0, modelTokens: 0 },
        activeReservations: [],
        remaining: { modelAttempts: 116, modelTokens: 100_000 },
        unknownUsageAttemptIds: expect.arrayContaining([
          expect.stringMatching(/^validator:/),
        ]),
      });
      expect(legacyBudget).not.toHaveProperty("protectedReservations");
    } finally {
      research.close();
      await rm(directory, { force: true, recursive: true });
    }
  });
});
