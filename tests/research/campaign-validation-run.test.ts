import { copyFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { z } from "zod";
import { describe, expect, it } from "vitest";

import {
  campaignDefaultSemanticRunPlanV3Schema,
  defineCurrentSemanticRootPlanningPolicy,
  openResearch,
  type CampaignExecutionDependencies,
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

function failedResult(
  plan: Exclude<ModelAttemptPlan, { schemaVersion: 1 }>,
  status: "budget-exhausted" | "provider-failed" | "policy-denied",
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
  it("recovers durable Validator results and replays pre-result-event ledgers", async () => {
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
    const depthQueuesObservedBeforeValidation: string[] = [];
    const depthQueuesObservedBeforeSynthesis: string[] = [];
    const validatorProgressSnapshots: unknown[] = [];
    let expectedValidationRunId = "";
    let validationDisposition: "ready-for-runtime" | "needs-research" =
      "ready-for-runtime";
    let depthFailure: "none" | "budget-exhausted" = "none";
    let packetDelivery: "success" | "failure" = "failure";
    let candidateIdentitySuffix = "";
    let injectUnknownValidatorResult = false;
    const deliveredPacketDigests: string[] = [];
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
          return completedResult(plan, {
            kind: "finder-output",
            schemaVersion: 2,
            leaseId: plan.assignment.leaseId,
            hypotheses: plan.prompt.includes(
              "a whole-target review may reveal broken security semantics",
            )
              ? [
                  {
                    kind: "source-bound-hypothesis",
                    schemaVersion: 1,
                    causalIdentity: {
                      rootCause: `public-state-crosses-actor-boundary${candidateIdentitySuffix}`,
                      attackerControlledPrimitive:
                        "unauthenticated-option-write",
                      brokenSecurityProperty:
                        validationDisposition === "needs-research"
                          ? "state-consumer-identity"
                          : `state-ownership${candidateIdentitySuffix}`,
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
                ]
              : [],
            routeFragments: [],
            frontierGaps: [],
          });
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
                subjectDigests: [
                  hypothesis.ref.digest,
                  ...theses.map((thesis) => thesis.ref.digest),
                ],
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
                      : `state-ownership${candidateIdentitySuffix}`,
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
                kind: "admit-depth",
                approachFamilyKey: "cross-actor-state",
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
              input.campaignId,
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
            await research.reader.inspect(input.campaignId, {
              kind: "progress",
            }),
          );
          const durableRecord = openSqliteResearchRecord({
            databasePath,
            artifactStore: artifacts,
          });
          try {
            const queued = await durableRecord.readSemanticDepthWorkQueueV2(
              input.campaignId,
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
            schemaVersion: 2,
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
          return result;
        }
        throw new Error("Unexpected Attempt role");
      },
    };
    let legacyVerifierCalls = 0;
    let labCalls = 0;
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
      runtimeVerificationPacketDelivery: {
        deliver: async (request) => {
          const packet = request.packet;
          deliveredPacketDigests.push(sha256Digest(packet));
          if (packetDelivery === "failure") {
            throw new Error("Injected Human OS delivery failure");
          }
          const identity = {
            kind: "runtime-verification-packet-delivery-receipt" as const,
            schemaVersion: 2 as const,
            deliveryRequestDigest: request.digest,
            packetDigest: sha256Digest(packet),
            intakeId: sha256Digest({
              kind: "ai-reproduction-intake",
              packetId: packet.id,
            }),
            admission: "accepted-for-ai-reproduction" as const,
          };
          return { ...identity, receiptDigest: sha256Digest(identity) };
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
        }),
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
            id: "source-validation-v2",
            digest: digest("e"),
          },
          promptSet,
          validatorModelProfile: profile("opus-validator-v6", digest("8")),
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

      expectedValidationRunId = plan.runId;
      const ref = await research.runner.run(plan);
      const modelCallsAfterFirstRun = observedPlans.length;
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
        ref: { schemaVersion: 3, decision: "incomplete" },
        inspected: {
          kind: "run",
          value: {
            schemaVersion: 3,
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
            validations: [{ status: "ready-for-runtime" }],
            runtimeVerificationPacketFailures: [],
            runtimeVerificationPackets: [
              {
                packet: {
                  schemaVersion: 2,
                  candidateId: expect.any(String),
                },
                riskAssessment: {
                  schemaVersion: 2,
                  candidateId: expect.any(String),
                },
                delivery: {
                  status: "delivery-failed",
                  reason: "delivery-failed",
                },
              },
            ],
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
          {
            completion: {
              validation: { schemaVersion: 2 },
              disposition: "ready-for-runtime",
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
          inspected.value.schemaVersion !== 3 ||
          !("runtimeVerificationPackets" in inspected.value)
        ) {
          throw new Error(
            "Expected a current Runtime Verification Packet handoff",
          );
        }
        const candidateId =
          inspected.value.runtimeVerificationPackets?.[0]?.packet.candidateId;
        if (candidateId === undefined) {
          throw new Error("Expected a Runtime Verification Packet candidate");
        }
        const packet = await record.readRuntimeVerificationPacket(
          input.campaignId,
          candidateId,
        );
        expect(packet).toMatchObject({
          packet: {
            targetSnapshotDigest: input.targetSnapshot.digest,
            manifestDigest: prepared.targetFileManifest.digest,
          },
          riskAssessment: { validationId: candidateId },
          handoffs: [
            {
              runId: plan.runId,
              handoff: { delivery: { status: "delivery-failed" } },
            },
          ],
        });
        if (packet === undefined) throw new Error("Expected Runtime Packet");
        await expect(
          artifacts.readJson(packet.packet.digest),
        ).resolves.toMatchObject({
          target: input.targetSnapshot,
          causalIdentity: { brokenSecurityProperty: "state-ownership" },
          attackerPremise: "unauthenticated",
          researchBoundary: {
            sourceOnly: true,
            exactPayloadIncluded: false,
            rawRequestIncluded: false,
            findingEligible: false,
          },
        });
        await expect(
          artifacts.readJson(packet.riskAssessment.digest),
        ).resolves.toMatchObject({
          validationDisposition: "ready-for-runtime",
          validation: { schemaVersion: 2 },
        });
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
        needsResearchRef: { schemaVersion: 3, decision: "incomplete" },
        needsResearchInspected: {
          value: {
            validations: [{ status: "needs-research" }],
            runtimeVerificationPackets: [],
            runtimeVerificationPacketFailures: [],
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

      validationDisposition = "ready-for-runtime";
      depthFailure = "budget-exhausted";
      packetDelivery = "success";
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
        failureRef: { schemaVersion: 3, decision: "incomplete" },
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
            runtimeVerificationPacketFailures: [],
            runtimeVerificationPackets: [
              {
                delivery: {
                  status: "delivered",
                  receipt: { packetDigest: expect.any(String) },
                },
              },
            ],
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
      expect(deliveredPacketDigests).toHaveLength(2);
      expect(new Set(deliveredPacketDigests)).toHaveProperty("size", 1);

      expect(deliveredPacketDigests.at(-1)).toEqual(expect.any(String));

      depthFailure = "none";
      packetDelivery = "success";
      candidateIdentitySuffix = "-crash-recovery";
      const crashRecoveryPlan = campaignDefaultSemanticRunPlanV3Schema.parse({
        ...plan,
        runId: "source-validation-crash-recovery",
        validation: {
          ...plan.validation,
          validationPolicy: {
            ...plan.validation.validationPolicy,
            digest: digest("f"),
          },
        },
      });
      expectedValidationRunId = crashRecoveryPlan.runId;
      const crashCallOffset = observedPlans.length;
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

      const recoveringResearch = openResearch({
        databasePath,
        campaignExecution,
      });
      try {
        await expect(
          recoveringResearch.runner.run(crashRecoveryPlan),
        ).resolves.toMatchObject({ schemaVersion: 3 });
        await expect(
          recoveringResearch.reader.inspect(input.campaignId, {
            kind: "run",
            runId: crashRecoveryPlan.runId,
          }),
        ).resolves.toMatchObject({
          kind: "run",
          value: {
            validations: [{ status: "ready-for-runtime" }],
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

      const unknownRecoveryResearch = openResearch({
        databasePath,
        campaignExecution,
      });
      try {
        await expect(
          unknownRecoveryResearch.runner.run(unknownResultPlan),
        ).resolves.toMatchObject({ schemaVersion: 3, decision: "incomplete" });
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
        ).resolves.toMatchObject({ schemaVersion: 3 });
      } finally {
        validResultRecoveryResearch.close();
      }
      expect(
        observedPlans
          .slice(invalidResultCallOffset)
          .filter((attempt) => attempt.role === "validator"),
      ).toHaveLength(1);
    } finally {
      research.close();
      await rm(directory, { force: true, recursive: true });
    }
  }, 15_000);

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
        },
      });
    } finally {
      research.close();
      await rm(directory, { force: true, recursive: true });
    }
  });
});
