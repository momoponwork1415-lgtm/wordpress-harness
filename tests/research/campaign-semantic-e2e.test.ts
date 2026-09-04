import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { z } from "zod";
import { describe, expect, it } from "vitest";

import {
  CampaignRunConflictError,
  campaignDefaultSemanticRunPlanV2Schema,
  openResearch,
} from "../../src/research/index.js";
import type {
  AttemptExecutionResultV2,
  ModelAttemptPlan,
  ModelExecution,
} from "../../src/research/model-execution/index.js";
import { sha256Digest } from "../../src/research/research-record/canonical-json.js";
import { openFileJsonArtifactStore } from "../../src/research/research-record/index.js";
import { IndependentVerifierBlockedError } from "../../src/research/verification/index.js";
import type {
  ExperimentObservation,
  IndependentVerifier,
  LabControl,
  VerificationPlan,
} from "../../src/research/verification/index.js";
import { createCampaignInput } from "../fixtures/campaign.js";

const digest = (character: string): string => `sha256:${character.repeat(64)}`;

function completedResult(
  plan: ModelAttemptPlan,
  output: unknown,
): AttemptExecutionResultV2 {
  if (plan.schemaVersion !== 2) {
    throw new Error("Semantic E2E received a legacy Attempt Plan");
  }
  const planDigest = sha256Digest(plan);
  const value = {
    kind: "model-attempt-result" as const,
    schemaVersion: 2 as const,
    attemptId: plan.attemptId,
    owner: "exploration" as const,
    role: plan.role,
    planDigest,
    status: "completed" as const,
    output,
    usage: {
      kind: "model-attempt-usage" as const,
      schemaVersion: 1 as const,
      measurement: "reported" as const,
      wallTimeMs: 10,
      providerDurationMs: 8,
      modelTurns: 2,
      modelTokens: {
        input: 10,
        cacheCreation: 20,
        cacheRead: 30,
        output: 40,
        total: 100,
      },
      structuredOutputBytes: 1_000,
      source:
        plan.role === "finder"
          ? { queries: 3, scanBytes: 100, responseBytes: 50 }
          : plan.role === "adversarial-critic"
            ? { queries: 1, scanBytes: 0, responseBytes: 25 }
            : { queries: 0, scanBytes: 0, responseBytes: 0 },
      models: [
        {
          id: "claude-opus-5",
          canonicalModel: "claude-opus-5",
          tokens: {
            input: 10,
            cacheCreation: 20,
            cacheRead: 30,
            output: 40,
            total: 100,
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
      owner: "exploration",
      role: plan.role,
      planDigest,
      digest: sha256Digest(value),
    },
    value,
  };
}

function failedResult(
  plan: ModelAttemptPlan,
  reason: string,
): AttemptExecutionResultV2 {
  if (plan.schemaVersion !== 2) {
    throw new Error("Semantic E2E received a legacy Attempt Plan");
  }
  const planDigest = sha256Digest(plan);
  const value = {
    kind: "model-attempt-result" as const,
    schemaVersion: 2 as const,
    attemptId: plan.attemptId,
    owner: "exploration" as const,
    role: plan.role,
    planDigest,
    status: "provider-failed" as const,
    reason,
  };
  return {
    status: value.status,
    ref: {
      kind: "attempt-execution-result",
      schemaVersion: 2,
      attemptId: plan.attemptId,
      owner: "exploration",
      role: plan.role,
      planDigest,
      digest: sha256Digest(value),
    },
    value,
  };
}

function budgetExhaustedResult(
  plan: ModelAttemptPlan,
  reason: string,
): AttemptExecutionResultV2 {
  if (plan.schemaVersion !== 2) {
    throw new Error("Semantic E2E received a legacy Attempt Plan");
  }
  const planDigest = sha256Digest(plan);
  const value = {
    kind: "model-attempt-result" as const,
    schemaVersion: 2 as const,
    attemptId: plan.attemptId,
    owner: "exploration" as const,
    role: plan.role,
    planDigest,
    status: "budget-exhausted" as const,
    reason,
  };
  return {
    status: value.status,
    ref: {
      kind: "attempt-execution-result",
      schemaVersion: 2,
      attemptId: plan.attemptId,
      owner: "exploration",
      role: plan.role,
      planDigest,
      digest: sha256Digest(value),
    },
    value,
  };
}

function verifier(
  onRederive?: (plan: VerificationPlan) => void,
  shouldBlock?: (plan: VerificationPlan) => boolean,
): IndependentVerifier {
  return {
    rederive: async (plan) => {
      onRederive?.(plan);
      if (shouldBlock?.(plan) === true) {
        throw new IndependentVerifierBlockedError("unsupported-experiment");
      }
      const decision = {
        kind: "source-rederivation" as const,
        schemaVersion: 1 as const,
        verificationId: plan.verificationId,
        targetSnapshotDigest: plan.targetSnapshot.digest,
        hypothesisDigest: plan.hypothesisDigest,
        status: "supported" as const,
        sourceEvidence: plan.hypothesis.route.anchors,
        experiment: {
          kind: "stored-xss-browser" as const,
          schemaVersion: 1 as const,
          adapterVersion: "stored-xss-browser@v1" as const,
          causalFactor: "attacker-controlled-stored-value",
          successCriterion: "privileged-browser-execution-canary" as const,
        },
      };
      return plan.schemaVersion === 2
        ? {
            kind: "independent-verifier-result",
            schemaVersion: 1,
            decision,
            usage: {
              kind: "model-attempt-usage",
              schemaVersion: 1,
              measurement: "reported",
              estimatedCostUsd: 0.75,
              wallTimeMs: 5,
              providerDurationMs: 4,
              modelTurns: 1,
              modelTokens: {
                input: 5,
                cacheCreation: 10,
                cacheRead: 15,
                output: 20,
                total: 50,
              },
              structuredOutputBytes: 500,
              source: { queries: 0, scanBytes: 0, responseBytes: 0 },
              models: [
                {
                  id: "claude-opus-5",
                  canonicalModel: "claude-opus-5",
                  tokens: {
                    input: 5,
                    cacheCreation: 10,
                    cacheRead: 15,
                    output: 20,
                    total: 50,
                  },
                },
              ],
            },
          }
        : decision;
    },
  };
}

function lab(
  putObservation: (value: unknown) => Promise<string>,
  shouldDisprove?: () => boolean,
): LabControl {
  return {
    execute: async ({ plan }) => {
      const isWitness = plan.role === "witness";
      const disproved = shouldDisprove?.() === true;
      const observation: ExperimentObservation = {
        kind: "experiment-observation",
        schemaVersion: 1,
        experimentId: plan.experimentId,
        verificationId: plan.verificationId,
        role: plan.role,
        hypothesisDigest: plan.hypothesisDigest,
        bindings: plan.bindings,
        isolation: {
          runtime: "gvisor",
          runtimeDigest: plan.bindings.runtimeProfileDigest,
          siblingGroupId: plan.siblingGroupId,
          labId: isWitness ? "semantic-witness" : "semantic-control",
          fresh: true,
          fallbackUsed: false,
        },
        causalFactor: {
          id: plan.mechanism.causalFactor,
          state: plan.mechanism.causalFactorState,
        },
        normalFunction: "preserved",
        result: {
          kind: "stored-xss-browser",
          schemaVersion: 1,
          attackerRequestAccepted: true,
          persistentStateObserved: isWitness && !disproved,
          browserCanaryExecuted: isWitness && !disproved,
        },
        artifactRefs: [],
      };
      return {
        kind: "experiment-observation",
        schemaVersion: 1,
        experimentId: plan.experimentId,
        digest: await putObservation(observation),
      };
    },
  };
}

const evaluationPromptContextSchema = z.object({
  evaluationSubjects: z.array(
    z.object({
      ref: z.object({
        kind: z.string(),
        id: z.string(),
        digest: z.string(),
      }),
    }),
  ),
});

describe("CampaignRunner.run Default Map-free Semantic Wave", () => {
  it("durably connects fresh planning, finding, evaluation, and Verification without a Map", async () => {
    const directory = await mkdtemp(join(tmpdir(), "semantic-e2e-"));
    const artifacts = openFileJsonArtifactStore(join(directory, "artifacts"));
    const input = {
      ...createCampaignInput("semantic-e2e"),
      schemaVersion: 2 as const,
      modelProfiles: [
        { id: "opus-planner-v1", digest: digest("5") },
        { id: "opus-finder-v1", digest: digest("6") },
        { id: "opus-evaluator-v1", digest: digest("7") },
        { id: "opus-verifier-v1", digest: digest("8") },
      ],
      knowledgeCapsules: [{ id: "wordpress-security-v1", digest: digest("9") }],
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
    const observedRoles: string[] = [];
    let resolveVerificationStarted: (() => void) | undefined;
    const verificationStarted = new Promise<void>((resolve) => {
      resolveVerificationStarted = resolve;
    });
    let happyFinderTerminalReturned = false;
    let happyBaselineTerminalReturned = false;
    let resolveBaselineStarted: (() => void) | undefined;
    const baselineStarted = new Promise<void>((resolve) => {
      resolveBaselineStarted = resolve;
    });
    let reconStartedWhileBaselinePending = false;
    let focusedFinderCanPivotOutsidePacket = false;
    let verifierStartedBeforeFinderTerminal = false;
    let verifierCalls = 0;
    let missingLinkCriticCalls = 0;
    const observedVerificationManifests: unknown[] = [];
    let scenario:
      | "happy"
      | "planning-failure"
      | "finder-failure"
      | "finder-budget"
      | "invalid-evaluation"
      | "critic-failure"
      | "multiple-depth-batches"
      | "no-chain-depth"
      | "missing-link-depth"
      | "missing-link-overflow"
      | "depth-verification"
      | "depth-blocked"
      | "depth-disproved"
      | "coverage-closure"
      | "coverage-after-material-delta"
      | "depth-closed-then-coverage"
      | "unsupported-verification"
      | "verification-volume"
      | "mechanism-grouping"
      | "crashed-planner" = "happy";
    const modelExecution: ModelExecution = {
      run: async (plan, observer) => {
        if (plan.schemaVersion !== 2) {
          throw new Error("Map-first Attempt must not run");
        }
        observedRoles.push(plan.role);
        if (plan.role === "root-planner") {
          if (scenario === "happy") {
            await baselineStarted;
            reconStartedWhileBaselinePending = !happyBaselineTerminalReturned;
          }
          if (scenario === "crashed-planner") {
            throw new Error("simulated-semantic-planner-loss");
          }
          if (scenario === "planning-failure") {
            return failedResult(plan, "planner-provider-exit-1");
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
                  "Persistent state may cross actor authority.",
                question:
                  "Can public state influence a privileged browser context?",
                motivation: "Cross-actor state can break browser integrity.",
                startingBasis:
                  "A manifest-bound cross-request state transition.",
                startingEvidence: [
                  {
                    path: "plugin.php",
                    fileDigest: digest("a"),
                    startLine: 10,
                    endLine: 20,
                  },
                ],
                independence:
                  "This packet starts from cross-actor state but can pivot across the whole Target.",
              },
            ],
          });
        }
        if (plan.role === "finder") {
          if (scenario === "finder-failure") {
            return failedResult(plan, "finder-provider-exit-1");
          }
          if (scenario === "finder-budget") {
            return budgetExhaustedResult(plan, "wall-time-exceeded");
          }
          if (
            scenario === "coverage-closure" ||
            (scenario === "coverage-after-material-delta" &&
              plan.prompt.includes("Coverage Closure review")) ||
            (scenario === "depth-closed-then-coverage" &&
              plan.prompt.includes("Coverage Closure review"))
          ) {
            return completedResult(plan, {
              kind: "finder-output",
              schemaVersion: 2,
              leaseId: plan.assignment.leaseId,
              hypotheses: [],
              routeFragments: [],
              frontierGaps: [],
            });
          }
          const isWholeTargetBaseline = plan.prompt.includes(
            "whole-target review may reveal broken security semantics",
          );
          if (isWholeTargetBaseline) {
            resolveBaselineStarted?.();
            if (scenario === "happy") {
              await verificationStarted;
              happyBaselineTerminalReturned = true;
            }
            return completedResult(plan, {
              kind: "finder-output",
              schemaVersion: 2,
              leaseId: plan.assignment.leaseId,
              hypotheses: [],
              routeFragments: [],
              frontierGaps: [],
            });
          }
          focusedFinderCanPivotOutsidePacket =
            plan.prompt.includes('"startingEvidence"') &&
            plan.prompt.includes(
              "Pivot anywhere in the immutable Target Snapshot when evidence warrants it.",
            );
          const hypothesis = {
            kind: "source-bound-hypothesis" as const,
            schemaVersion: 1 as const,
            causalIdentity: {
              rootCause: "stored-value-output-without-context-escaping",
              attackerControlledPrimitive: "unauthenticated-persistent-value",
              brokenSecurityProperty: "privileged-browser-integrity",
            },
            attackerPremise:
              scenario === "unsupported-verification"
                ? ("unresolved" as const)
                : ("unauthenticated" as const),
            impact: "stored-xss" as const,
            route: {
              anchors: [
                {
                  path: "plugin.php",
                  fileDigest: digest("a"),
                  startLine: 10,
                  endLine: 20,
                },
              ],
            },
            unknowns: [
              {
                claim: "A privileged browser renders the stored value.",
                requiredEvidence: "Fresh witness and causal control.",
              },
            ],
            falsifier: "The value is context-escaped before rendering.",
            nextExperiment:
              "Compare browser canaries with the stored value removed.",
          };
          const hypotheses =
            scenario === "verification-volume"
              ? Array.from({ length: 5 }, (_, index) => ({
                  ...hypothesis,
                  causalIdentity: {
                    ...hypothesis.causalIdentity,
                    rootCause: `${hypothesis.causalIdentity.rootCause}-${index + 1}`,
                  },
                }))
              : scenario === "mechanism-grouping"
                ? [
                    {
                      ...hypothesis,
                      causalIdentity: {
                        ...hypothesis.causalIdentity,
                        rootCause: "same-route-wording-one",
                      },
                    },
                    {
                      ...hypothesis,
                      causalIdentity: {
                        ...hypothesis.causalIdentity,
                        rootCause: "same-route-wording-two",
                      },
                    },
                    {
                      ...hypothesis,
                      causalIdentity: {
                        ...hypothesis.causalIdentity,
                        rootCause: "different-source-route",
                      },
                      route: {
                        anchors: hypothesis.route.anchors.map((anchor) => ({
                          ...anchor,
                          startLine: 30,
                          endLine: 40,
                        })),
                      },
                    },
                    {
                      ...hypothesis,
                      causalIdentity: {
                        ...hypothesis.causalIdentity,
                        rootCause: "same-route-but-blocked",
                      },
                    },
                  ]
                : [hypothesis];
          for (const candidate of hypotheses) {
            await observer?.checkpoint(candidate);
          }
          if (scenario === "happy") {
            await verificationStarted;
            happyFinderTerminalReturned = true;
          }
          return completedResult(plan, {
            kind: "finder-output",
            schemaVersion: 2,
            leaseId: plan.assignment.leaseId,
            hypotheses,
            routeFragments: [
              {
                kind: "route-fragment-proposal",
                schemaVersion: 1,
                attackerPremise: "unauthenticated",
                preconditions: ["A public request persists the value."],
                operation: "Persist data consumed by another actor.",
                consumedValues: [
                  {
                    identity: "public-input",
                    provenance: "attacker-controlled",
                  },
                ],
                producedValues: [
                  { identity: "stored-value", capability: "write" },
                ],
                stateTransitions: [
                  {
                    stateIdentity: "shared-option",
                    operation: "write",
                    effect: "Input becomes cross-request state.",
                  },
                ],
                evidence: [
                  {
                    path: "plugin.php",
                    fileDigest: digest("a"),
                    startLine: 10,
                    endLine: 20,
                  },
                ],
                unknowns: [
                  {
                    claim: "Other privileged consumers may trust the value.",
                    requiredEvidence: "Trace every reader.",
                  },
                ],
                falsifier: "No privileged consumer reads the state.",
                nextInvestigation: "Trace all privileged readers.",
              },
            ],
            frontierGaps: [],
          });
        }
        if (plan.role === "root-synthesizer") {
          if (scenario === "no-chain-depth") {
            return completedResult(plan, {
              kind: "root-synthesis-output",
              schemaVersion: 1,
              itemDispositions: plan.assignment.itemIds.map((itemId) => ({
                itemId,
                disposition: "retained-no-connection",
                reason: "No defensible connection was found.",
              })),
              proposals: [],
            });
          }
          const proposalCount = scenario === "missing-link-overflow" ? 9 : 1;
          return completedResult(plan, {
            kind: "root-synthesis-output",
            schemaVersion: 1,
            itemDispositions: plan.assignment.itemIds.map((itemId) => ({
              itemId,
              disposition: "used",
              reason: "The hypothesis and fragment form a composable route.",
            })),
            proposals: Array.from({ length: proposalCount }, (_, index) => ({
              itemIds: plan.assignment.itemIds,
              subjectDigests: plan.assignment.subjectDigests,
              attackerPremise: "unauthenticated",
              securityProperty: `Privileged browser integrity route ${index + 1}.`,
              steps: [
                {
                  ordinal: 1,
                  relation: "observed",
                  actor: "unauthenticated-attacker",
                  request: "Persist a cross-request value.",
                  stateIdentity: "shared-option",
                  consumedValues: ["public-input"],
                  producedValues: ["stored-value"],
                  evidence: [
                    {
                      path: "plugin.php",
                      fileDigest: digest("a"),
                      startLine: 10,
                      endLine: 20,
                    },
                  ],
                },
                {
                  ordinal: 2,
                  relation: "proposed-connection",
                  actor: "privileged-browser",
                  request: "Render the stored value.",
                  stateIdentity: "shared-option",
                  consumedValues: ["stored-value"],
                  producedValues: ["browser-script-execution"],
                  evidence: [
                    {
                      path: "plugin.php",
                      fileDigest: digest("a"),
                      startLine: 10,
                      endLine: 20,
                    },
                  ],
                },
              ],
              unknowns: [
                {
                  claim: "The reader uses the same option value.",
                  requiredEvidence: "Freshly trace the exact state identity.",
                },
              ],
              falsifier: "The producer and consumer use unrelated state.",
              nextAction: `Challenge proposed state connection ${index + 1}.`,
            })),
          });
        }
        if (plan.role === "adversarial-critic") {
          if (scenario === "critic-failure") {
            return failedResult(plan, "critic-provider-exit-1");
          }
          if (scenario === "missing-link-depth") {
            missingLinkCriticCalls += 1;
          }
          return completedResult(plan, {
            kind: "adversarial-critic-output",
            schemaVersion: 1,
            dispositions: plan.assignment.proposalIds.map((proposalId) =>
              scenario === "depth-closed-then-coverage"
                ? {
                    proposalId,
                    verdict: "contradicted" as const,
                    challenges: [],
                  }
                : (scenario === "missing-link-depth" &&
                      missingLinkCriticCalls === 1) ||
                    scenario === "missing-link-overflow"
                  ? {
                      proposalId,
                      verdict: "needs-evidence" as const,
                      challenges: [],
                      gap: {
                        requiredFact:
                          "Determine whether the privileged reader consumes the same state identity.",
                        sourceEvidence: [
                          {
                            path: "plugin.php",
                            fileDigest: digest("a"),
                            startLine: 10,
                            endLine: 20,
                          },
                        ],
                        expectedObservation:
                          "A source-bound reader of the attacker-controlled state.",
                        falsifier:
                          "Every privileged reader uses unrelated or sanitized state.",
                        nextAction:
                          "Trace the exact state identity through every privileged reader.",
                      },
                    }
                  : {
                      proposalId,
                      verdict: "survives" as const,
                      challenges: [],
                    },
            ),
          });
        }
        if (
          plan.role === "root-evaluator" &&
          plan.assignment.kind === "depth-evaluation"
        ) {
          const depthHypothesis = {
            causalIdentity: {
              rootCause:
                scenario === "depth-verification"
                  ? "composed-cross-request-reader-chain"
                  : scenario === "depth-blocked"
                    ? "composed-cross-request-reader-chain-blocked"
                    : scenario === "depth-disproved"
                      ? "composed-cross-request-reader-chain-disproved"
                      : "stored-value-output-without-context-escaping",
              attackerControlledPrimitive: "unauthenticated-persistent-value",
              brokenSecurityProperty: "privileged-browser-integrity",
            },
            attackerPremise: "unauthenticated" as const,
            impact: "stored-xss" as const,
            unknowns: [
              {
                claim: "A privileged browser renders the stored value.",
                requiredEvidence: "Fresh witness and causal control.",
              },
            ],
            falsifier: "The value is context-escaped before rendering.",
            nextExperiment:
              "Compare browser canaries with the stored value removed.",
          };
          if (
            scenario === "missing-link-depth" ||
            scenario === "missing-link-overflow"
          ) {
            const prefix = "Depth evaluation context: ";
            const contextLine = plan.prompt
              .split("\n")
              .find((line) => line.startsWith(prefix));
            if (contextLine === undefined) {
              throw new Error("Depth evaluation context is missing");
            }
            const context = z
              .object({
                critique: z.object({
                  dispositions: z.array(
                    z.object({
                      proposal: z.object({ id: z.string() }),
                      gap: z.object({ id: z.string() }).optional(),
                    }),
                  ),
                }),
              })
              .parse(JSON.parse(contextLine.slice(prefix.length)));
            const gaps = context.critique.dispositions.filter(
              (disposition) => disposition.gap !== undefined,
            );
            return completedResult(plan, {
              kind: "depth-root-evaluator-output",
              schemaVersion: 1,
              dispositions:
                gaps.length > 0
                  ? gaps.map((disposition) => ({
                      proposalId: disposition.proposal.id,
                      action: "schedule-missing-link" as const,
                      gapId: disposition.gap!.id,
                      reason:
                        "The exact cross-request state identity is the decisive missing link.",
                    }))
                  : context.critique.dispositions.map((disposition) => ({
                      proposalId: disposition.proposal.id,
                      action: "request-verification" as const,
                      hypothesis: depthHypothesis,
                      reason:
                        "The missing-link evidence survived fresh criticism.",
                    })),
            });
          }
          if (scenario === "depth-closed-then-coverage") {
            return completedResult(plan, {
              kind: "depth-root-evaluator-output",
              schemaVersion: 1,
              dispositions: plan.assignment.proposalIds.map((proposalId) => ({
                proposalId,
                action: "close-route" as const,
                reason:
                  "Fresh source criticism contradicted the proposed causal connection.",
              })),
            });
          }
          return completedResult(plan, {
            kind: "depth-root-evaluator-output",
            schemaVersion: 1,
            dispositions: plan.assignment.proposalIds.map((proposalId) => ({
              proposalId,
              action: "request-verification" as const,
              hypothesis: depthHypothesis,
              reason:
                "The independently criticized route remains suitable for fresh Verification.",
            })),
          });
        }
        if (scenario === "invalid-evaluation") {
          return completedResult(plan, {
            kind: "root-evaluator-output",
            schemaVersion: 1,
            actions: [],
            campaignDisposition: "continue",
          });
        }
        const prefix = "Wave evaluation context: ";
        const contextLine = plan.prompt
          .split("\n")
          .find((line) => line.startsWith(prefix));
        if (contextLine === undefined) {
          throw new Error("Root Evaluator context is missing");
        }
        const context = evaluationPromptContextSchema.parse(
          JSON.parse(contextLine.slice(prefix.length)),
        );
        if (
          scenario === "coverage-closure" ||
          scenario === "coverage-after-material-delta"
        ) {
          return completedResult(plan, {
            kind: "root-evaluator-output",
            schemaVersion: 1,
            actions: [
              {
                kind: "close",
                subjectDigests: context.evaluationSubjects.map(
                  (subject) => subject.ref.digest,
                ),
                record: {
                  basis:
                    "The complete independent Wave produced no unresolved semantic subject.",
                  reopenWhen:
                    "A changed Target Snapshot or new source-bound relation appears.",
                },
              },
            ],
            campaignDisposition: "coverage-closed",
          });
        }
        const hypotheses = context.evaluationSubjects.filter(
          (subject) => subject.ref.kind === "source-bound-hypothesis",
        );
        const hypothesis = hypotheses[0];
        const fragment = context.evaluationSubjects.find(
          (subject) => subject.ref.kind === "route-fragment",
        );
        const theses = context.evaluationSubjects.filter(
          (subject) => subject.ref.kind === "research-thesis",
        );
        if (scenario === "depth-closed-then-coverage") {
          if (hypothesis === undefined || fragment === undefined) {
            return completedResult(plan, {
              kind: "root-evaluator-output",
              schemaVersion: 1,
              actions: [
                {
                  kind: "close",
                  subjectDigests: theses.map((subject) => subject.ref.digest),
                  record: {
                    basis:
                      "The fresh Wildcard review found no unresolved semantic route.",
                    reopenWhen: "New source-bound evidence appears.",
                  },
                },
              ],
              campaignDisposition: "coverage-closed",
            });
          }
          return completedResult(plan, {
            kind: "root-evaluator-output",
            schemaVersion: 1,
            actions: [
              {
                kind: "admit-depth",
                subjectDigests: [hypothesis.ref.digest, fragment.ref.digest],
                admission: {
                  highImpactPotential:
                    "The cross-actor state may reach a privileged consumer.",
                  composition: "Challenge the proposed writer-reader chain.",
                  falsifier: "Fresh criticism disproves the shared state.",
                  nextAction: "Run bounded Synthesis and Critic work.",
                },
              },
              {
                kind: "close",
                subjectDigests: theses.map((subject) => subject.ref.digest),
                record: {
                  basis: "The initial research directions are fully handled.",
                  reopenWhen: "A new source-backed direction appears.",
                },
              },
            ],
            campaignDisposition: "continue",
          });
        }
        if (scenario === "finder-failure" || scenario === "finder-budget") {
          return completedResult(plan, {
            kind: "root-evaluator-output",
            schemaVersion: 1,
            actions: [
              {
                kind: "retain",
                subjectDigests: theses.map((subject) => subject.ref.digest),
                reason:
                  "The Finder failed, so the active thesis must remain unresolved.",
              },
            ],
            campaignDisposition: "incomplete",
          });
        }
        if (hypothesis === undefined || fragment === undefined) {
          throw new Error("Expected semantic subjects were not supplied");
        }
        return completedResult(plan, {
          kind: "root-evaluator-output",
          schemaVersion: 1,
          actions: [
            ...hypotheses.map((candidate) => ({
              kind: "request-verification",
              subjectDigests: [candidate.ref.digest],
              request: {
                hypothesisDigest: candidate.ref.digest,
                reason: "The source-bound route can break browser integrity.",
              },
            })),
            {
              kind: "admit-depth",
              subjectDigests: [hypothesis.ref.digest, fragment.ref.digest],
              admission: {
                highImpactPotential:
                  "The cross-actor state may reach additional privileged consumers.",
                composition: "Connect the writer to all privileged readers.",
                falsifier: "No privileged reader consumes the state.",
                nextAction: "Run a bounded missing-link reader trace.",
              },
            },
            ...(scenario === "multiple-depth-batches"
              ? Array.from({ length: 5 }, (_, index) => ({
                  kind: "schedule-work" as const,
                  subjectDigests: [hypothesis.ref.digest, fragment.ref.digest],
                  work: {
                    requiredFact: `Resolve independent missing fact ${index + 1}.`,
                    falsifier: `Missing fact ${index + 1} does not affect the route.`,
                    nextAction: `Trace missing fact ${index + 1} in fresh source.`,
                  },
                }))
              : []),
            {
              kind: "retain",
              subjectDigests: theses.map((subject) => subject.ref.digest),
              reason: "Keep the research direction active after one Finding.",
            },
          ],
          campaignDisposition: "continue",
        });
      },
    };
    let legacyMaterializerCalls = 0;
    const research = openResearch({
      databasePath: join(directory, "research.sqlite"),
      artifactStore: artifacts,
      campaignExecution: {
        artifactStore: artifacts,
        attemptPlanMaterializer: {
          materialize: async () => {
            legacyMaterializerCalls += 1;
            throw new Error("Map-first materializer must not run");
          },
        },
        modelExecution,
        independentVerifier: verifier(
          (verificationPlan) => {
            verifierCalls += 1;
            observedVerificationManifests.push(
              verificationPlan.schemaVersion === 2
                ? verificationPlan.manifest
                : undefined,
            );
            if (
              !happyFinderTerminalReturned &&
              !happyBaselineTerminalReturned &&
              scenario === "happy"
            ) {
              verifierStartedBeforeFinderTerminal = true;
            }
            resolveVerificationStarted?.();
          },
          (verificationPlan) =>
            verificationPlan.hypothesis.causalIdentity.rootCause.endsWith(
              "-blocked",
            ),
        ),
        labControl: lab(
          (value) => artifacts.putJson(value),
          () => scenario === "depth-disproved",
        ),
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
          family: "claude",
          digest: profileDigest,
        },
        execution: {
          provider: "anthropic",
          model: "claude-opus-5",
          transport: "claude-code-process",
          executableVersion: "2.1.258",
          effort: "high",
          eligibilityReceiptDigest: digest("b"),
        },
      });
      const plan = campaignDefaultSemanticRunPlanV2Schema.parse({
        kind: "campaign-run-plan" as const,
        schemaVersion: 2 as const,
        runId: "semantic-e2e-run",
        campaignId: input.campaignId,
        preparationDigest: prepared.inputDigest,
        target: input.targetSnapshot,
        manifest: prepared.targetFileManifest,
        metadata: {
          kind: "oracle-free-target-metadata" as const,
          schemaVersion: 1 as const,
          pluginIdentity: "wporg:semantic-e2e",
          mainPluginFile: "plugin.php",
          canonicalInstallDirectory: "semantic-e2e",
        },
        semanticPolicy: {
          kind: "semantic-root-planning-policy" as const,
          schemaVersion: 1 as const,
          id: "semantic-research-recall-baseline-v4",
          maxTargetSpecificTheses: 1,
          minWildcardTheses: 1,
          maxLeases: 2,
          plannerBudget: {
            maxWallTimeMs: 3_600_000,
            maxModelTokens: 100_000,
            maxModelTurns: 128,
            maxProviderCostUsd: 10,
            maxOutputBytes: 2 * 1024 * 1_024,
            maxSourceQueries: 256,
            maxSourceScanBytes: 16 * 1024 * 1024 * 1024,
            maxSourceResponseBytes: 256 * 1024 * 1024,
            sourceLimitTerminalOutput: "preserve",
            reportedUsageEnforcement: "telemetry-only",
          },
          finderLeaseBudget: {
            maxWallTimeMs: 10_800_000,
            maxModelTokens: 1_000_000,
            maxModelTurns: 256,
            maxProviderCostUsd: 20,
            maxHypotheses: 8,
            maxOutputBytes: 2 * 1024 * 1_024,
            maxSourceQueries: 512,
            maxSourceScanBytes: 16 * 1024 * 1024 * 1024,
            maxSourceResponseBytes: 256 * 1024 * 1024,
            sourceLimitTerminalOutput: "preserve",
            reportedUsageEnforcement: "telemetry-only",
          },
        },
        planner: {
          modelProfile: profile("opus-planner-v1", digest("5")),
          promptSet: {
            kind: "prompt-set" as const,
            schemaVersion: 1 as const,
            id: input.promptSet.id,
            digest: input.promptSet.digest,
          },
          sourceToolPolicy: {
            kind: "source-tool-policy" as const,
            schemaVersion: 1 as const,
            id: "semantic-source-tools-v1",
            digest: digest("c"),
          },
        },
        finder: {
          modelProfile: profile("opus-finder-v1", digest("6")),
          promptSet: {
            kind: "prompt-set" as const,
            schemaVersion: 1 as const,
            id: input.promptSet.id,
            digest: input.promptSet.digest,
          },
          selectedKnowledge: input.knowledgeCapsules,
          sourceToolPolicy: {
            kind: "source-tool-policy" as const,
            schemaVersion: 1 as const,
            id: "semantic-source-tools-v1",
            digest: digest("c"),
          },
        },
        evaluator: {
          modelProfile: profile("opus-evaluator-v1", digest("7")),
          promptSet: {
            kind: "prompt-set" as const,
            schemaVersion: 1 as const,
            id: input.promptSet.id,
            digest: input.promptSet.digest,
          },
          budget: {
            maxWallTimeMs: 3_600_000,
            maxModelTokens: 300_000,
            maxModelTurns: 128,
            maxProviderCostUsd: 10,
            maxOutputBytes: 2 * 1024 * 1_024,
            reportedUsageEnforcement: "telemetry-only",
          },
        },
        verification: {
          labBaseline: {
            kind: "lab-baseline" as const,
            schemaVersion: 1 as const,
            id: "semantic-e2e-baseline",
            digest: digest("d"),
            targetSnapshotDigest: input.targetSnapshot.digest,
            runtimeProfileDigest: input.runtimeProfile.digest,
            setupPlanDigest: digest("e"),
            configurationDigest: digest("f"),
          },
          verifierModelProfile: {
            kind: "model-profile" as const,
            schemaVersion: 1 as const,
            id: "opus-verifier-v1",
            family: "claude",
            digest: digest("8"),
          },
          promptSet: {
            kind: "prompt-set" as const,
            schemaVersion: 1 as const,
            id: input.promptSet.id,
            digest: input.promptSet.digest,
          },
          verificationPolicy: {
            kind: "verification-policy" as const,
            schemaVersion: 1 as const,
            id: "independent-pair-v1",
            digest: digest("0"),
          },
          experimentRegistry: {
            kind: "experiment-registry" as const,
            schemaVersion: 1 as const,
            id: input.experimentRegistry.id,
            digest: input.experimentRegistry.digest,
          },
          budget: {
            schemaVersion: 2,
            maxVerifierAttempts: 96,
            maxExperiments: 8,
            maxWallTimeMs: 7_200_000,
            maxModelTokens: 400_000,
            maxModelTurns: 128,
            maxProviderCostUsd: 30,
            maxOutputBytes: 2 * 1024 * 1_024,
            reportedUsageEnforcement: "telemetry-only",
          },
        },
        budgetPolicy: {
          kind: "semantic-research-budget" as const,
          schemaVersion: 1 as const,
          id: "semantic-research-recall-baseline-v4",
          maxWorkWaves: 3,
          maxFinderAttempts: 12,
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
          verificationReserve: {
            maxModelTokens: 400_000,
            maxProviderCostUsd: 30,
            maxWallTimeMs: 7_200_000,
            maxVerifierAttempts: 96,
            maxExperiments: 8,
          },
        },
      });

      const ref = await research.runner.run(plan);
      const inspected = await research.reader.inspect(input.campaignId, {
        kind: "run",
        runId: plan.runId,
      });

      expect({ ref, inspected }).toMatchObject({
        ref: { schemaVersion: 2, decision: "incomplete" },
        inspected: {
          kind: "run",
          value: {
            schemaVersion: 2,
            target: input.targetSnapshot,
            manifest: prepared.targetFileManifest,
            attempts: [
              { role: "root-planner" },
              { role: "finder" },
              { role: "finder" },
              { role: "root-evaluator" },
              { role: "root-evaluator" },
              { role: "root-synthesizer" },
              { role: "adversarial-critic" },
            ],
            waveTerminal: {
              hypotheses: [{ kind: "source-bound-hypothesis" }],
              routeFragments: [{ kind: "route-fragment" }],
            },
            iterationDecision: {
              kind: "iteration-decision",
              actions: [
                { kind: "request-verification" },
                { kind: "admit-depth" },
                { kind: "retain" },
              ],
            },
            iterationDecisionRef: {
              kind: "iteration-decision",
              schemaVersion: 2,
            },
            approachFamilyRegistry: {
              kind: "approach-family-registry",
              schemaVersion: 2,
              families: 1,
            },
            depthWorkQueue: {
              kind: "semantic-depth-work-queue",
              schemaVersion: 1,
              items: 1,
              batches: 1,
            },
            depthResearch: {
              kind: "semantic-depth-research",
              schemaVersion: 2,
              rounds: [
                {
                  ordinal: 1,
                  batches: [
                    {
                      kind: "semantic-depth-batch-result",
                      synthesis: {
                        ref: { kind: "chain-synthesis", proposals: 1 },
                      },
                      critique: {
                        ref: { kind: "adversarial-critique", dispositions: 1 },
                      },
                      evaluation: {
                        ref: {
                          kind: "depth-iteration-decision",
                          actions: 1,
                        },
                      },
                    },
                  ],
                },
              ],
            },
            verifications: [{ outcome: "finding" }],
            usage: {
              kind: "semantic-campaign-usage",
              schemaVersion: 2,
              measurement: "reported",
              modelAttempts: 8,
              modelTurns: 15,
              modelTokens: {
                input: 75,
                cacheCreation: 150,
                cacheRead: 225,
                output: 300,
                total: 750,
              },
              modelWallTimeMs: 75,
              structuredOutputBytes: 7_500,
              estimatedCostUsd: 0.75,
              estimatedCostMeasurement: "partial",
              source: {
                queries: 7,
                scanBytes: 200,
                responseBytes: 125,
              },
              owners: {
                exploration: {
                  modelAttempts: 7,
                  modelTokens: { total: 700 },
                },
                verification: {
                  modelAttempts: 1,
                  modelTokens: { total: 50 },
                  estimatedCostUsd: 0.75,
                  estimatedCostMeasurement: "reported",
                },
              },
            },
            decision: {
              kind: "incomplete",
              reason: "active-research-remains",
            },
          },
        },
      });
      expect([...observedRoles].sort()).toEqual(
        [
          "adversarial-critic",
          "finder",
          "finder",
          "root-evaluator",
          "root-evaluator",
          "root-planner",
          "root-synthesizer",
        ].sort(),
      );
      expect(verifierStartedBeforeFinderTerminal).toBe(true);
      expect(reconStartedWhileBaselinePending).toBe(true);
      expect(focusedFinderCanPivotOutsidePacket).toBe(true);
      expect(verifierCalls).toBe(1);
      expect(observedVerificationManifests).toEqual([
        prepared.targetFileManifest,
      ]);
      expect(legacyMaterializerCalls).toBe(0);

      const replayed = await research.runner.run(plan);
      expect(replayed).toEqual(ref);
      expect(observedRoles).toHaveLength(7);
      expect(verifierCalls).toBe(1);

      scenario = "coverage-closure";
      const rolesBeforeCoverageClosure = observedRoles.length;
      const coverageClosurePlan = campaignDefaultSemanticRunPlanV2Schema.parse({
        ...plan,
        runId: "semantic-e2e-coverage-closure",
      });
      const coverageClosureRef = await research.runner.run(coverageClosurePlan);
      const coverageClosureRun = await research.reader.inspect(
        input.campaignId,
        { kind: "run", runId: coverageClosurePlan.runId },
      );
      expect({ coverageClosureRef, coverageClosureRun }).toMatchObject({
        coverageClosureRef: { decision: "complete" },
        coverageClosureRun: {
          kind: "run",
          value: {
            coverageClosure: {
              kind: "semantic-coverage-closure",
              schemaVersion: 1,
              observations: [
                {
                  reviewKind: "initial-wave",
                  outcome: "no-material-delta",
                },
                {
                  reviewKind: "fresh-wildcard",
                  outcome: "no-material-delta",
                },
              ],
            },
            approachFamilyRegistry: {
              decisions: 2,
              families: 0,
              pendingVerifications: 0,
            },
            decision: { kind: "complete", reason: "coverage-closed" },
          },
        },
      });
      expect(observedRoles.slice(rolesBeforeCoverageClosure).sort()).toEqual(
        [
          "finder",
          "finder",
          "finder",
          "root-evaluator",
          "root-evaluator",
          "root-planner",
        ].sort(),
      );
      await expect(research.runner.run(coverageClosurePlan)).resolves.toEqual(
        coverageClosureRef,
      );

      scenario = "coverage-after-material-delta";
      const materialDeltaPlan = campaignDefaultSemanticRunPlanV2Schema.parse({
        ...plan,
        runId: "semantic-e2e-coverage-after-material-delta",
      });
      const materialDeltaRef = await research.runner.run(materialDeltaPlan);
      const materialDeltaRun = await research.reader.inspect(input.campaignId, {
        kind: "run",
        runId: materialDeltaPlan.runId,
      });
      expect({ materialDeltaRef, materialDeltaRun }).toMatchObject({
        materialDeltaRef: { decision: "complete" },
        materialDeltaRun: {
          kind: "run",
          value: {
            coverageClosure: {
              observations: [
                { reviewKind: "initial-wave", outcome: "material-delta" },
                {
                  reviewKind: "fresh-wildcard",
                  outcome: "no-material-delta",
                },
                {
                  reviewKind: "fresh-wildcard",
                  outcome: "no-material-delta",
                },
              ],
            },
            approachFamilyRegistry: { decisions: 3, families: 0 },
            verifications: [{ outcome: "finding" }],
            decision: { kind: "complete", reason: "coverage-closed" },
          },
        },
      });

      scenario = "depth-closed-then-coverage";
      const depthClosedPlan = campaignDefaultSemanticRunPlanV2Schema.parse({
        ...plan,
        runId: "semantic-e2e-depth-closed-then-coverage",
      });
      const depthClosedRef = await research.runner.run(depthClosedPlan);
      const depthClosedRun = await research.reader.inspect(input.campaignId, {
        kind: "run",
        runId: depthClosedPlan.runId,
      });
      expect({ depthClosedRef, depthClosedRun }).toMatchObject({
        depthClosedRef: { decision: "complete" },
        depthClosedRun: {
          kind: "run",
          value: {
            depthResearch: {
              rounds: [
                {
                  batches: [
                    {
                      evaluation: {
                        ref: { kind: "depth-iteration-decision", actions: 1 },
                      },
                    },
                  ],
                },
              ],
            },
            coverageReviews: [
              { kind: "semantic-coverage-review-trace" },
              { kind: "semantic-coverage-review-trace" },
            ],
            coverageClosure: {
              observations: [
                {
                  reviewKind: "fresh-wildcard",
                  outcome: "no-material-delta",
                },
                {
                  reviewKind: "fresh-wildcard",
                  outcome: "no-material-delta",
                },
              ],
            },
            approachFamilyRegistry: {
              states: { active: 0, blocked: 0, exhausted: 1 },
              pendingVerifications: 0,
            },
            decision: { kind: "complete", reason: "coverage-closed" },
          },
        },
      });

      scenario = "depth-verification";
      const verifierCallsBeforeDepth = verifierCalls;
      const depthVerificationPlan =
        campaignDefaultSemanticRunPlanV2Schema.parse({
          ...plan,
          runId: "semantic-e2e-depth-verification",
        });
      await research.runner.run(depthVerificationPlan);
      const depthVerificationRun = await research.reader.inspect(
        input.campaignId,
        { kind: "run", runId: depthVerificationPlan.runId },
      );
      expect(depthVerificationRun).toMatchObject({
        kind: "run",
        value: {
          depthResearch: {
            rounds: [
              {
                batches: [
                  {
                    verificationHypotheses: [
                      { kind: "source-bound-hypothesis" },
                    ],
                  },
                ],
              },
            ],
          },
          verifications: [{ outcome: "finding" }, { outcome: "finding" }],
          approachFamilyRegistry: {
            pendingVerifications: 0,
            verificationOutcomes: 1,
            states: { active: 1 },
          },
        },
      });
      expect(verifierCalls - verifierCallsBeforeDepth).toBe(1);

      scenario = "depth-blocked";
      const depthBlockedPlan = campaignDefaultSemanticRunPlanV2Schema.parse({
        ...plan,
        runId: "semantic-e2e-depth-blocked",
      });
      await research.runner.run(depthBlockedPlan);
      const depthBlockedRun = await research.reader.inspect(input.campaignId, {
        kind: "run",
        runId: depthBlockedPlan.runId,
      });
      expect(depthBlockedRun).toMatchObject({
        kind: "run",
        value: {
          approachFamilyRegistry: {
            pendingVerifications: 0,
            verificationOutcomes: 1,
            states: { active: 1, blocked: 0, exhausted: 0 },
          },
          decision: { kind: "incomplete", reason: "verification-blocked" },
        },
      });

      scenario = "depth-disproved";
      const depthDisprovedPlan = campaignDefaultSemanticRunPlanV2Schema.parse({
        ...plan,
        runId: "semantic-e2e-depth-disproved",
      });
      await research.runner.run(depthDisprovedPlan);
      const depthDisprovedRun = await research.reader.inspect(
        input.campaignId,
        { kind: "run", runId: depthDisprovedPlan.runId },
      );
      expect(depthDisprovedRun).toMatchObject({
        kind: "run",
        value: {
          approachFamilyRegistry: {
            pendingVerifications: 0,
            verificationOutcomes: 1,
            states: { active: 1, blocked: 0, exhausted: 0 },
          },
          decision: { kind: "incomplete", reason: "active-research-remains" },
        },
      });
      const depthDisprovedState = z
        .object({
          value: z.object({
            verifications: z.array(z.object({ outcome: z.string() })),
          }),
        })
        .parse(depthDisprovedRun);
      expect(
        depthDisprovedState.value.verifications
          .map((verification) => verification.outcome)
          .sort(),
      ).toEqual(["disproved", "finding"]);

      scenario = "critic-failure";
      const criticFailurePlan = campaignDefaultSemanticRunPlanV2Schema.parse({
        ...plan,
        runId: "semantic-e2e-critic-failure",
      });
      await research.runner.run(criticFailurePlan);
      const criticFailure = await research.reader.inspect(input.campaignId, {
        kind: "run",
        runId: criticFailurePlan.runId,
      });
      expect(criticFailure).toMatchObject({
        kind: "run",
        value: {
          depthResearch: {
            rounds: [
              {
                batches: [
                  {
                    kind: "semantic-depth-batch-incomplete",
                    stage: "adversarial-critique",
                    reason: "critic-failed",
                  },
                ],
              },
            ],
          },
          verifications: [{ outcome: "finding" }],
          decision: {
            kind: "incomplete",
            reason: "depth-research-incomplete",
          },
        },
      });

      scenario = "no-chain-depth";
      const criticCallsBeforeNoChain = observedRoles.filter(
        (role) => role === "adversarial-critic",
      ).length;
      const noChainPlan = campaignDefaultSemanticRunPlanV2Schema.parse({
        ...plan,
        runId: "semantic-e2e-no-chain-depth",
      });
      await research.runner.run(noChainPlan);
      const noChainRun = await research.reader.inspect(input.campaignId, {
        kind: "run",
        runId: noChainPlan.runId,
      });
      expect(noChainRun).toMatchObject({
        kind: "run",
        value: {
          depthResearch: {
            rounds: [
              {
                batches: [
                  {
                    kind: "semantic-depth-batch-result",
                    synthesis: { ref: { proposals: 0 } },
                  },
                ],
              },
            ],
          },
        },
      });
      expect(
        observedRoles.filter((role) => role === "adversarial-critic"),
      ).toHaveLength(criticCallsBeforeNoChain);

      scenario = "missing-link-depth";
      missingLinkCriticCalls = 0;
      const rolesBeforeMissingLink = observedRoles.length;
      const missingLinkPlan = campaignDefaultSemanticRunPlanV2Schema.parse({
        ...plan,
        runId: "semantic-e2e-missing-link-depth",
      });
      await research.runner.run(missingLinkPlan);
      const missingLinkRun = await research.reader.inspect(input.campaignId, {
        kind: "run",
        runId: missingLinkPlan.runId,
      });
      expect(missingLinkRun).toMatchObject({
        kind: "run",
        value: {
          depthResearch: {
            schemaVersion: 2,
            rounds: [
              {
                ordinal: 1,
                batches: [
                  {
                    kind: "semantic-depth-batch-result",
                    evaluation: {
                      ref: { kind: "depth-iteration-decision", actions: 1 },
                    },
                    missingLinkWaves: [
                      {
                        plan: { kind: "missing-link-wave-plan" },
                        terminal: { kind: "semantic-wave-terminal" },
                      },
                    ],
                  },
                ],
              },
              {
                ordinal: 2,
                queue: { kind: "semantic-depth-work-queue", items: 1 },
                batches: [
                  {
                    kind: "semantic-depth-batch-result",
                    evaluation: {
                      ref: { kind: "depth-iteration-decision", actions: 1 },
                    },
                  },
                ],
              },
            ],
          },
          approachFamilyRegistry: {
            kind: "approach-family-registry",
            schemaVersion: 2,
            depthDecisions: 2,
            maxRound: 2,
            states: { active: 1 },
            pendingVerifications: 0,
            verificationOutcomes: 1,
          },
        },
      });
      expect(observedRoles.slice(rolesBeforeMissingLink).sort()).toEqual(
        [
          "adversarial-critic",
          "adversarial-critic",
          "finder",
          "finder",
          "finder",
          "root-evaluator",
          "root-evaluator",
          "root-evaluator",
          "root-planner",
          "root-synthesizer",
          "root-synthesizer",
        ].sort(),
      );

      scenario = "missing-link-overflow";
      const overflowPlan = campaignDefaultSemanticRunPlanV2Schema.parse({
        ...plan,
        runId: "semantic-e2e-missing-link-overflow",
      });
      await research.runner.run(overflowPlan);
      const overflowRun = await research.reader.inspect(input.campaignId, {
        kind: "run",
        runId: overflowPlan.runId,
      });
      expect(overflowRun).toMatchObject({
        kind: "run",
        value: {
          depthResearch: {
            rounds: [
              {
                batches: [
                  {
                    kind: "semantic-depth-batch-result",
                    missingLinkWaves: [
                      { plan: { gaps: 2 } },
                      { plan: { gaps: 2 } },
                    ],
                  },
                ],
              },
            ],
          },
          decision: {
            kind: "incomplete",
            reason: "depth-research-incomplete",
          },
        },
      });
      const overflowState = z
        .object({
          value: z.object({
            depthResearch: z.object({
              rounds: z.array(
                z.object({
                  batches: z.array(
                    z.object({
                      unscheduledGaps: z.array(z.unknown()).optional(),
                    }),
                  ),
                }),
              ),
            }),
          }),
        })
        .parse(overflowRun);
      expect(
        overflowState.value.depthResearch.rounds[0]?.batches[0]
          ?.unscheduledGaps,
      ).toHaveLength(5);

      scenario = "multiple-depth-batches";
      const multipleDepthPlan = campaignDefaultSemanticRunPlanV2Schema.parse({
        ...plan,
        runId: "semantic-e2e-multiple-depth-batches",
      });
      const multipleDepthRef = await research.runner.run(multipleDepthPlan);
      const multipleDepthRun = await research.reader.inspect(input.campaignId, {
        kind: "run",
        runId: multipleDepthPlan.runId,
      });
      expect(multipleDepthRun).toMatchObject({
        kind: "run",
        value: {
          depthWorkQueue: { items: 6, batches: 2 },
          depthResearch: {
            rounds: [
              {
                batches: [
                  { kind: "semantic-depth-batch-result" },
                  { kind: "semantic-depth-batch-result" },
                ],
              },
            ],
          },
        },
      });
      await expect(research.runner.run(multipleDepthPlan)).resolves.toEqual(
        multipleDepthRef,
      );

      scenario = "verification-volume";
      const verifierCallsBeforeVolume = verifierCalls;
      const verificationVolumePlan =
        campaignDefaultSemanticRunPlanV2Schema.parse({
          ...plan,
          runId: "semantic-e2e-verification-volume",
        });
      await research.runner.run(verificationVolumePlan);
      const verificationVolume = await research.reader.inspect(
        input.campaignId,
        { kind: "run", runId: verificationVolumePlan.runId },
      );
      expect(verificationVolume).toMatchObject({
        kind: "run",
        value: {
          verifications: [
            { outcome: "finding" },
            { outcome: "finding" },
            { outcome: "finding" },
            { outcome: "finding" },
            { outcome: "finding" },
            { outcome: "finding" },
          ],
          decision: {
            kind: "incomplete",
            reason: "active-research-remains",
          },
        },
      });
      expect(verifierCalls - verifierCallsBeforeVolume).toBe(5);

      scenario = "mechanism-grouping";
      const mechanismGroupingPlan =
        campaignDefaultSemanticRunPlanV2Schema.parse({
          ...plan,
          runId: "semantic-e2e-mechanism-grouping",
        });
      await research.runner.run(mechanismGroupingPlan);
      const mechanismGroups = await research.reader.inspect(input.campaignId, {
        kind: "finding-mechanism-groups",
        runId: mechanismGroupingPlan.runId,
      });
      expect(mechanismGroups).toMatchObject({
        kind: "finding-mechanism-groups",
        schemaVersion: 1,
        campaignId: input.campaignId,
        runId: mechanismGroupingPlan.runId,
        groups: [
          { kind: "finding-mechanism-group", schemaVersion: 1 },
          { kind: "finding-mechanism-group", schemaVersion: 1 },
        ],
      });
      if (!("groups" in mechanismGroups)) {
        throw new Error("Expected Finding mechanism groups");
      }
      expect(
        mechanismGroups.groups
          .map((group) => group.discoveries.length)
          .sort((left, right) => left - right),
      ).toEqual([1, 3]);
      expect(
        mechanismGroups.groups.flatMap((group) =>
          group.discoveries.map((discovery) => discovery.outcome),
        ),
      ).toEqual(["finding", "finding", "finding", "finding"]);
      expect(
        await research.reader.inspect(input.campaignId, {
          kind: "finding-mechanism-groups",
          runId: mechanismGroupingPlan.runId,
        }),
      ).toEqual(mechanismGroups);

      scenario = "planning-failure";
      const planningFailurePlan = campaignDefaultSemanticRunPlanV2Schema.parse({
        ...plan,
        runId: "semantic-e2e-planning-failure",
      });
      const planningFailureRef = await research.runner.run(planningFailurePlan);
      const planningFailure = await research.reader.inspect(input.campaignId, {
        kind: "run",
        runId: planningFailurePlan.runId,
      });
      expect({ planningFailureRef, planningFailure }).toMatchObject({
        planningFailureRef: { decision: "incomplete" },
        planningFailure: {
          kind: "run",
          value: {
            stage: {
              kind: "planning-incomplete",
              reason: "planner-failed",
            },
            attempts: [{ role: "root-planner" }, { role: "finder" }],
            decision: { kind: "incomplete", reason: "planning-incomplete" },
          },
        },
      });

      scenario = "invalid-evaluation";
      const invalidEvaluationPlan =
        campaignDefaultSemanticRunPlanV2Schema.parse({
          ...plan,
          runId: "semantic-e2e-invalid-evaluation",
        });
      const invalidEvaluationRef = await research.runner.run(
        invalidEvaluationPlan,
      );
      const invalidEvaluation = await research.reader.inspect(
        input.campaignId,
        { kind: "run", runId: invalidEvaluationPlan.runId },
      );
      expect({ invalidEvaluationRef, invalidEvaluation }).toMatchObject({
        invalidEvaluationRef: { decision: "incomplete" },
        invalidEvaluation: {
          kind: "run",
          value: {
            stage: {
              kind: "evaluation-incomplete",
              reason: "invalid-root-evaluator-output",
              attempts: [
                { role: "root-evaluator" },
                { role: "root-evaluator" },
              ],
            },
            verifications: [{ outcome: "finding" }],
            decision: {
              kind: "incomplete",
              reason: "evaluation-incomplete",
            },
          },
        },
      });

      scenario = "finder-failure";
      const finderFailurePlan = campaignDefaultSemanticRunPlanV2Schema.parse({
        ...plan,
        runId: "semantic-e2e-finder-failure",
      });
      const finderFailureRef = await research.runner.run(finderFailurePlan);
      const finderFailure = await research.reader.inspect(input.campaignId, {
        kind: "run",
        runId: finderFailurePlan.runId,
      });
      expect({ finderFailureRef, finderFailure }).toMatchObject({
        finderFailureRef: { decision: "incomplete" },
        finderFailure: {
          kind: "run",
          value: {
            waveTerminal: {
              hypotheses: [],
              routeFragments: [],
              issues: [
                { reason: "partial-finder-output" },
                { reason: "partial-finder-output" },
              ],
              attemptOutcomes: [
                {
                  status: "provider-failed",
                  reason: "finder-provider-exit-1",
                },
                {
                  status: "provider-failed",
                  reason: "finder-provider-exit-1",
                },
              ],
            },
            iterationDecision: { campaignDisposition: "incomplete" },
            decision: {
              kind: "incomplete",
              reason: "active-research-remains",
            },
          },
        },
      });

      scenario = "finder-budget";
      const finderBudgetPlan = campaignDefaultSemanticRunPlanV2Schema.parse({
        ...plan,
        runId: "semantic-e2e-finder-budget",
      });
      const finderBudget = await research.runner.run(finderBudgetPlan);
      const finderBudgetView = await research.reader.inspect(input.campaignId, {
        kind: "run",
        runId: finderBudgetPlan.runId,
      });
      expect({ finderBudget, finderBudgetView }).toMatchObject({
        finderBudget: { decision: "incomplete" },
        finderBudgetView: {
          kind: "run",
          value: {
            waveTerminal: {
              attemptOutcomes: [
                {
                  status: "budget-exhausted",
                  reason: "wall-time-exceeded",
                },
                {
                  status: "budget-exhausted",
                  reason: "wall-time-exceeded",
                },
              ],
            },
            decision: {
              kind: "incomplete",
              reason: "active-research-remains",
            },
          },
        },
      });

      scenario = "unsupported-verification";
      const unsupportedVerificationPlan =
        campaignDefaultSemanticRunPlanV2Schema.parse({
          ...plan,
          runId: "semantic-e2e-unsupported-verification",
        });
      const unsupportedVerificationRef = await research.runner.run(
        unsupportedVerificationPlan,
      );
      const unsupportedVerification = await research.reader.inspect(
        input.campaignId,
        { kind: "run", runId: unsupportedVerificationPlan.runId },
      );
      expect({
        unsupportedVerificationRef,
        unsupportedVerification,
      }).toMatchObject({
        unsupportedVerificationRef: { decision: "incomplete" },
        unsupportedVerification: {
          kind: "run",
          value: {
            verifications: [{ outcome: "finding" }],
            decision: {
              kind: "incomplete",
              reason: "verification-blocked",
            },
          },
        },
      });

      scenario = "crashed-planner";
      const crashedPlannerPlan = campaignDefaultSemanticRunPlanV2Schema.parse({
        ...plan,
        runId: "semantic-e2e-crashed-planner",
      });
      await expect(research.runner.run(crashedPlannerPlan)).rejects.toThrow(
        "simulated-semantic-planner-loss",
      );
      const providerCallsBeforeCrashReplay = observedRoles.length;
      const recoveredCrashRef = await research.runner.run(crashedPlannerPlan);
      const recoveredCrash = await research.reader.inspect(input.campaignId, {
        kind: "run",
        runId: crashedPlannerPlan.runId,
      });
      expect(observedRoles).toHaveLength(providerCallsBeforeCrashReplay);
      expect({ recoveredCrashRef, recoveredCrash }).toMatchObject({
        recoveredCrashRef: { decision: "incomplete" },
        recoveredCrash: {
          kind: "run",
          value: {
            stage: {
              kind: "planning-incomplete",
              attempts: [
                {
                  role: "root-planner",
                },
              ],
              reason: "planner-failed",
            },
            decision: { kind: "incomplete", reason: "planning-incomplete" },
          },
        },
      });

      const providerCallsBeforeBudgetRejection = observedRoles.length;
      const excessiveVerificationBudgetPlan =
        campaignDefaultSemanticRunPlanV2Schema.parse({
          ...plan,
          runId: "semantic-e2e-excessive-verification-budget",
          verification: {
            ...plan.verification,
            budget: {
              ...plan.verification.budget,
              maxVerifierAttempts: 5,
            },
          },
        });
      await expect(
        research.runner.run(excessiveVerificationBudgetPlan),
      ).rejects.toBeInstanceOf(CampaignRunConflictError);
      const excessiveVerificationCostPlan =
        campaignDefaultSemanticRunPlanV2Schema.parse({
          ...plan,
          runId: "semantic-e2e-excessive-verification-cost-budget",
          verification: {
            ...plan.verification,
            budget: {
              ...plan.verification.budget,
              maxProviderCostUsd: 30.01,
            },
          },
        });
      await expect(
        research.runner.run(excessiveVerificationCostPlan),
      ).rejects.toBeInstanceOf(CampaignRunConflictError);
      for (const [runId, finderLeaseBudget] of [
        [
          "semantic-e2e-excessive-finder-turn-budget",
          { ...plan.semanticPolicy.finderLeaseBudget, maxModelTurns: 257 },
        ],
        [
          "semantic-e2e-excessive-finder-cost-budget",
          {
            ...plan.semanticPolicy.finderLeaseBudget,
            maxProviderCostUsd: 20.01,
          },
        ],
      ] as const) {
        const excessiveFinderBudgetPlan =
          campaignDefaultSemanticRunPlanV2Schema.parse({
            ...plan,
            runId,
            semanticPolicy: {
              ...plan.semanticPolicy,
              finderLeaseBudget,
            },
          });
        await expect(
          research.runner.run(excessiveFinderBudgetPlan),
        ).rejects.toBeInstanceOf(CampaignRunConflictError);
      }
      const excessivePlannerTurnPlan =
        campaignDefaultSemanticRunPlanV2Schema.parse({
          ...plan,
          runId: "semantic-e2e-excessive-planner-turn-budget",
          semanticPolicy: {
            ...plan.semanticPolicy,
            plannerBudget: {
              ...plan.semanticPolicy.plannerBudget,
              maxModelTurns: 129,
            },
          },
        });
      await expect(
        research.runner.run(excessivePlannerTurnPlan),
      ).rejects.toBeInstanceOf(CampaignRunConflictError);
      const retiredBudgetPlan = campaignDefaultSemanticRunPlanV2Schema.parse({
        ...plan,
        runId: "semantic-e2e-retired-budget",
        semanticPolicy: {
          ...plan.semanticPolicy,
          id: "semantic-research-baseline-v2",
          finderLeaseBudget: {
            maxWallTimeMs: 900_000,
            maxModelTokens: 1_000_000,
            maxModelTurns: 34,
            maxProviderCostUsd: 2.5,
            maxHypotheses: 8,
            maxOutputBytes: 512 * 1_024,
            maxSourceQueries: 32,
          },
          plannerBudget: {
            maxWallTimeMs: 300_000,
            maxModelTokens: 100_000,
            maxModelTurns: 8,
            maxProviderCostUsd: 2.5,
            maxOutputBytes: 512 * 1_024,
            maxSourceQueries: 128,
          },
        },
        evaluator: {
          ...plan.evaluator,
          budget: {
            maxWallTimeMs: 300_000,
            maxModelTokens: 300_000,
            maxModelTurns: 8,
            maxProviderCostUsd: 2.5,
            maxOutputBytes: 512 * 1_024,
          },
        },
        verification: {
          ...plan.verification,
          budget: {
            schemaVersion: 2,
            maxVerifierAttempts: 4,
            maxExperiments: 8,
            maxWallTimeMs: 1_800_000,
            maxModelTokens: 400_000,
            maxModelTurns: 8,
            maxProviderCostUsd: 2.5,
            maxOutputBytes: 512 * 1_024,
          },
        },
        budgetPolicy: {
          kind: "semantic-research-budget",
          schemaVersion: 1,
          id: "semantic-research-baseline-v2",
          maxWorkWaves: 3,
          maxFinderAttempts: 12,
          maxConcurrentFinders: 4,
          maxModelAttempts: 24,
          maxModelTokens: 4_000_000,
          maxWallTimeMs: 5_400_000,
          exploration: {
            maxModelTokens: 3_600_000,
            maxWallTimeMs: 3_600_000,
          },
          verificationReserve: {
            maxModelTokens: 400_000,
            maxWallTimeMs: 1_800_000,
            maxVerifierAttempts: 4,
            maxExperiments: 8,
          },
        },
      });
      await expect(research.runner.run(retiredBudgetPlan)).rejects.toThrow(
        "Semantic Research budget policy is retired",
      );
      const retiredRecallV3Plan = campaignDefaultSemanticRunPlanV2Schema.parse({
        ...plan,
        runId: "semantic-e2e-retired-recall-v3",
        semanticPolicy: {
          ...plan.semanticPolicy,
          id: "semantic-research-recall-baseline-v3",
        },
        verification: {
          ...plan.verification,
          budget: {
            ...plan.verification.budget,
            maxVerifierAttempts: 4,
          },
        },
        budgetPolicy: {
          ...plan.budgetPolicy,
          id: "semantic-research-recall-baseline-v3",
          maxModelAttempts: 32,
          verificationReserve: {
            ...plan.budgetPolicy.verificationReserve,
            maxVerifierAttempts: 4,
          },
        },
      });
      await expect(research.runner.run(retiredRecallV3Plan)).rejects.toThrow(
        "Semantic Research budget policy is retired",
      );
      expect(observedRoles).toHaveLength(providerCallsBeforeBudgetRejection);
    } finally {
      research.close();
      await rm(directory, { force: true, recursive: true });
    }
  }, 15_000);
});
