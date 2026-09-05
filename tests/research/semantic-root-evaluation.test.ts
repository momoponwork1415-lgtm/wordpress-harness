import { describe, expect, it } from "vitest";

import { openExploration } from "../../src/research/exploration/index.js";
import type {
  SemanticWaveEvaluationInput,
  SemanticWorkWavePlan,
} from "../../src/research/exploration/semantic-contracts.js";
import type {
  ModelAttemptPlan,
  ModelExecution,
} from "../../src/research/model-execution/index.js";
import { sha256Digest } from "../../src/research/research-record/canonical-json.js";

const digest = (character: string): string => `sha256:${character.repeat(64)}`;

const target = {
  id: "evaluation-target",
  pluginSlug: "evaluation-target",
  version: "1.0.0",
  digest: digest("1"),
};

const manifest = {
  kind: "target-file-manifest" as const,
  schemaVersion: 1 as const,
  targetSnapshotId: target.id,
  targetSnapshotDigest: target.digest,
  digest: digest("2"),
};

const thesis = {
  kind: "research-thesis" as const,
  schemaVersion: 1 as const,
  id: digest("3"),
  target,
  manifest,
  scope: "wildcard" as const,
  securityAssumption: "Persistent state may cross actor authority.",
  question: "Can a public actor influence a privileged state consumer?",
  motivation: "Cross-actor state can break authorization semantics.",
  startingBasis: "Oracle-free source review.",
  independence: "This thesis is not constrained to a sink or file.",
};

const lease = {
  kind: "work-lease" as const,
  schemaVersion: 2 as const,
  id: digest("4"),
  role: "finder" as const,
  target,
  manifest,
  assignment: {
    kind: "research-thesis" as const,
    schemaVersion: 1 as const,
    thesisId: thesis.id,
  },
  budget: {
    maxWallTimeMs: 10_000,
    maxModelTokens: 10_000,
    maxModelTurns: 10,
    maxProviderCostUsd: 0.25,
    maxHypotheses: 4,
    maxOutputBytes: 10_000,
    maxSourceQueries: 8,
  },
};

const finderAttemptValue = {
  kind: "model-attempt-result" as const,
  schemaVersion: 2 as const,
  attemptId: "finder-evaluation-1",
  owner: "exploration" as const,
  role: "finder" as const,
  planDigest: digest("5"),
  status: "completed" as const,
  output: {
    kind: "finder-output",
    schemaVersion: 2,
    leaseId: lease.id,
    hypotheses: [],
    routeFragments: [],
    frontierGaps: [],
  },
};

const finderAttemptRef = {
  kind: "attempt-execution-result" as const,
  schemaVersion: 2 as const,
  attemptId: finderAttemptValue.attemptId,
  owner: "exploration" as const,
  role: "finder" as const,
  planDigest: finderAttemptValue.planDigest,
  digest: sha256Digest(finderAttemptValue),
};

const workWave: SemanticWorkWavePlan = {
  kind: "work-wave-plan",
  schemaVersion: 2,
  id: digest("6"),
  ref: {
    kind: "work-wave",
    schemaVersion: 2,
    id: digest("6"),
    digest: digest("7"),
    targetSnapshotDigest: target.digest,
    manifestDigest: manifest.digest,
  },
  purpose: { kind: "raw-source" },
  target,
  manifest,
  policy: {
    kind: "semantic-root-planning-policy",
    schemaVersion: 1,
    id: "evaluation-policy",
    digest: digest("8"),
  },
  plannerAttempt: {
    kind: "attempt-execution-result",
    schemaVersion: 2,
    attemptId: "planner-evaluation-1",
    owner: "exploration",
    role: "root-planner",
    planDigest: digest("9"),
    digest: digest("a"),
  },
  theses: [thesis],
  leases: [lease],
};

const anchor = {
  path: "plugin.php",
  fileDigest: digest("b"),
  startLine: 20,
  endLine: 30,
};

const hypothesisValue = {
  kind: "source-bound-hypothesis" as const,
  schemaVersion: 1 as const,
  causalIdentity: {
    rootCause: "missing-authorization",
    attackerControlledPrimitive: "public-state-write",
    brokenSecurityProperty: "state-ownership",
  },
  attackerPremise: "unauthenticated" as const,
  impact: "authorization-bypass" as const,
  route: { anchors: [anchor] },
  unknowns: [
    {
      claim: "The state consumer runs with greater authority.",
      requiredEvidence: "Observe the consumer in a fresh Lab.",
    },
  ],
  falsifier: "The state is always scoped to the authenticated actor.",
  nextExperiment: "Exercise the consumer after an unauthenticated write.",
};

const hypothesisArtifact = {
  kind: "source-bound-hypothesis" as const,
  schemaVersion: 2 as const,
  id: sha256Digest({
    kind: "source-bound-hypothesis",
    targetSnapshotDigest: target.digest,
    manifestDigest: manifest.digest,
    value: hypothesisValue,
  }),
  target,
  manifest,
  workWave: workWave.ref,
  attemptId: finderAttemptRef.attemptId,
  leaseId: lease.id,
  value: hypothesisValue,
};

const hypothesisRef = {
  kind: hypothesisArtifact.kind,
  schemaVersion: 2 as const,
  id: hypothesisArtifact.id,
  digest: sha256Digest(hypothesisArtifact),
  attemptId: hypothesisArtifact.attemptId,
  leaseId: hypothesisArtifact.leaseId,
  workWaveDigest: workWave.ref.digest,
  targetSnapshotDigest: target.digest,
  manifestDigest: manifest.digest,
};

const fragmentValue = {
  kind: "route-fragment-proposal" as const,
  schemaVersion: 1 as const,
  attackerPremise: "unauthenticated" as const,
  preconditions: ["A public request can persist the state."],
  operation: "Persist an attacker-selected value for a later actor.",
  consumedValues: [
    { identity: "public-input", provenance: "attacker-controlled" as const },
  ],
  producedValues: [
    { identity: "persistent-state", capability: "write" as const },
  ],
  stateTransitions: [
    {
      stateIdentity: "shared-option",
      operation: "write" as const,
      effect: "Attacker input becomes cross-request state.",
    },
  ],
  evidence: [anchor],
  unknowns: [
    {
      claim: "A privileged consumer trusts the state.",
      requiredEvidence: "Trace all readers of the option.",
    },
  ],
  falsifier: "Every reader treats the value as untrusted public data.",
  nextInvestigation: "Connect the state to privileged consumers.",
};

const fragmentArtifact = {
  kind: "route-fragment" as const,
  schemaVersion: 2 as const,
  id: sha256Digest({
    kind: "route-fragment",
    targetSnapshotDigest: target.digest,
    manifestDigest: manifest.digest,
    value: fragmentValue,
  }),
  target,
  manifest,
  workWave: workWave.ref,
  attemptId: finderAttemptRef.attemptId,
  leaseId: lease.id,
  value: fragmentValue,
};

const fragmentRef = {
  kind: fragmentArtifact.kind,
  schemaVersion: 2 as const,
  id: fragmentArtifact.id,
  digest: sha256Digest(fragmentArtifact),
  attemptId: fragmentArtifact.attemptId,
  leaseId: fragmentArtifact.leaseId,
  workWaveDigest: workWave.ref.digest,
  targetSnapshotDigest: target.digest,
  manifestDigest: manifest.digest,
};

const waveTerminal = {
  kind: "semantic-wave-terminal" as const,
  schemaVersion: 2 as const,
  wave: workWave.ref,
  target,
  manifest,
  attempts: [finderAttemptRef],
  attemptOutcomes: [
    { attempt: finderAttemptRef, status: finderAttemptValue.status },
  ],
  hypotheses: [hypothesisRef],
  routeFragments: [fragmentRef],
  frontierGaps: [],
  issues: [],
};

const waveTerminalRef = {
  kind: waveTerminal.kind,
  schemaVersion: 2 as const,
  waveId: workWave.id,
  digest: sha256Digest(waveTerminal),
  targetSnapshotDigest: target.digest,
  manifestDigest: manifest.digest,
  attemptOutcomes: waveTerminal.attemptOutcomes,
  hypotheses: waveTerminal.hypotheses,
  routeFragments: waveTerminal.routeFragments,
  frontierGaps: waveTerminal.frontierGaps,
  issues: waveTerminal.issues,
};

const toolReceipt = {
  kind: "source-evidence-receipt" as const,
  schemaVersion: 2 as const,
  attemptId: finderAttemptValue.attemptId,
  assignment: {
    kind: "research-thesis" as const,
    schemaVersion: 1 as const,
    workWaveId: workWave.id,
    leaseId: lease.id,
    thesis: {
      kind: "research-thesis" as const,
      schemaVersion: 1 as const,
      id: thesis.id,
      digest: sha256Digest(thesis),
      targetSnapshotDigest: target.digest,
      manifestDigest: manifest.digest,
    },
  },
  targetSnapshot: { id: target.id, digest: target.digest },
  manifest,
  policy: {
    kind: "source-tool-policy" as const,
    schemaVersion: 1 as const,
    id: "evaluation-source-policy",
    digest: digest("c"),
  },
  queryOrdinal: 1,
  queryDigest: digest("d"),
  operation: "read" as const,
  policyDecision: {
    outcome: "allowed" as const,
    reason: "read-allowed" as const,
  },
  usage: { files: 1, bytes: 256, matches: 1 },
  result: { status: "completed" as const, responseDigest: digest("e") },
};

function completedResult(plan: ModelAttemptPlan, output: unknown) {
  const planDigest = sha256Digest(plan);
  const value = {
    kind: "model-attempt-result" as const,
    schemaVersion: 2 as const,
    attemptId: plan.attemptId,
    owner: "exploration" as const,
    role: "root-evaluator" as const,
    planDigest,
    status: "completed" as const,
    output,
  };
  return {
    status: "completed" as const,
    ref: {
      kind: "attempt-execution-result" as const,
      schemaVersion: 2 as const,
      attemptId: plan.attemptId,
      owner: "exploration" as const,
      role: "root-evaluator" as const,
      planDigest,
      digest: sha256Digest(value),
    },
    value,
  };
}

function semanticExploration(modelExecution: ModelExecution) {
  const modelProfile = {
    provider: "anthropic",
    model: "claude-opus-5",
    transport: "claude-code-process",
    executableVersion: "2.1.258",
    effort: "high",
    eligibilityReceiptDigest: digest("f"),
  } as const;
  return openExploration({
    target,
    manifest,
    metadata: {
      kind: "oracle-free-target-metadata",
      schemaVersion: 1,
      pluginIdentity: "wporg:evaluation-target",
      mainPluginFile: "plugin.php",
      canonicalInstallDirectory: "evaluation-target",
    },
    semanticPolicy: {
      kind: "semantic-root-planning-policy",
      schemaVersion: 1,
      id: "evaluation-policy",
      maxTargetSpecificTheses: 0,
      minWildcardTheses: 1,
      maxLeases: 1,
      plannerBudget: {
        maxWallTimeMs: 10_000,
        maxModelTokens: 10_000,
        maxModelTurns: 4,
        maxProviderCostUsd: 0.25,
        maxOutputBytes: 10_000,
        maxSourceQueries: 8,
      },
      finderLeaseBudget: lease.budget,
    },
    planner: {
      modelExecution,
      promptSet: { id: "planner-prompt", digest: digest("e") },
      modelProfile,
      sourceToolPolicy: {
        kind: "source-tool-policy",
        schemaVersion: 1,
        id: "semantic-source-tools-v1",
        digest: digest("c"),
      },
    },
    evaluator: {
      modelExecution,
      promptSet: { id: "evaluator-prompt", digest: digest("0") },
      modelProfile,
      budget: {
        maxWallTimeMs: 10_000,
        maxModelTokens: 10_000,
        maxModelTurns: 4,
        maxProviderCostUsd: 0.25,
        maxOutputBytes: 10_000,
      },
    },
  });
}

function evaluationInput(
  toolReceipts: SemanticWaveEvaluationInput["toolReceipts"] = [],
): SemanticWaveEvaluationInput {
  return {
    kind: "evaluate-semantic-wave",
    schemaVersion: 2,
    target,
    manifest,
    wave: workWave,
    terminal: { ref: waveTerminalRef, value: waveTerminal },
    artifacts: {
      hypotheses: [hypothesisArtifact],
      routeFragments: [fragmentArtifact],
      frontierGaps: [],
    },
    attemptResults: [finderAttemptValue],
    toolReceipts,
  };
}

describe("Exploration fresh Root Evaluation", () => {
  it("admits Validation only from a complete Wave evaluation and binds it to an explicit shared Approach Family", async () => {
    const modelExecution: ModelExecution = {
      run: async (plan) =>
        completedResult(plan, {
          kind: "root-evaluator-output",
          schemaVersion: 2,
          approachFamilies: [
            {
              key: "cross-actor-state",
              subjectDigests: [hypothesisRef.digest, fragmentRef.digest],
              thesis:
                "A public state writer may cross an actor authority boundary.",
              mechanism:
                "Attacker-controlled persistent state is consumed by a more privileged actor.",
              falsifier:
                "Every consumer independently binds the state to its originating actor.",
              nextAction: "Trace and challenge each privileged state consumer.",
            },
          ],
          actions: [
            {
              kind: "admit-validation",
              approachFamilyKey: "cross-actor-state",
              subjectDigests: [hypothesisRef.digest],
              admission: {
                hypothesisDigest: hypothesisRef.digest,
                brokenSecurityProperty: "state-ownership",
                causalRoute: [
                  {
                    ordinal: 1,
                    claim:
                      "A public write reaches a cross-actor consumer without an ownership check.",
                    evidence: [anchor],
                  },
                ],
                reason:
                  "The source-bound route is ready for independent source review.",
              },
            },
            {
              kind: "admit-depth",
              approachFamilyKey: "cross-actor-state",
              subjectDigests: [fragmentRef.digest],
              admission: {
                highImpactPotential:
                  "The same state mechanism may reach additional privileged consumers.",
                composition:
                  "Connect the public writer to every cross-actor reader.",
                falsifier:
                  "No privileged reader consumes the attacker-controlled state.",
                nextAction: "Run a bounded missing-link reader trace.",
              },
            },
            {
              kind: "retain",
              subjectDigests: [sha256Digest(thesis)],
              reason:
                "Keep the independent thesis active while the candidate is validated.",
            },
          ],
          campaignDisposition: "continue",
        }),
    };

    const decision = await semanticExploration(modelExecution).decide({
      ...evaluationInput(),
      schemaVersion: 3 as const,
    });

    expect(decision).toMatchObject({
      kind: "iteration-decision",
      schemaVersion: 3,
      approachFamilies: [
        {
          kind: "approach-family-admission",
          schemaVersion: 1,
          key: "cross-actor-state",
          subjects: [{ id: hypothesisRef.id }, { id: fragmentRef.id }],
        },
      ],
      actions: [
        {
          kind: "admit-validation",
          subjects: [{ id: hypothesisRef.id }],
          admission: {
            kind: "validation-admission",
            schemaVersion: 1,
            hypothesis: hypothesisRef,
            brokenSecurityProperty: "state-ownership",
            causalRoute: [{ ordinal: 1, evidence: [anchor] }],
          },
        },
        {
          kind: "admit-depth",
          subjects: [{ id: fragmentRef.id }],
        },
        { kind: "retain", subjects: [{ id: thesis.id }] },
      ],
    });
    if (
      decision.kind !== "iteration-decision" ||
      decision.schemaVersion !== 3
    ) {
      throw new Error("Expected a current Root Evaluation decision");
    }
    const validationAction = decision.actions[0];
    const depthAction = decision.actions[1];
    const family = decision.approachFamilies[0];
    if (
      validationAction?.kind !== "admit-validation" ||
      depthAction?.kind !== "admit-depth" ||
      family === undefined
    ) {
      throw new Error("Expected Validation and Depth to share one Family");
    }
    expect(validationAction.approachFamily.id).toBe(family.id);
    expect(validationAction.approachFamily.digest).toBe(sha256Digest(family));
    expect(depthAction.approachFamily).toEqual(validationAction.approachFamily);
  });

  it("returns typed incomplete when scheduled Depth work is not bound to a proposed Family", async () => {
    const modelExecution: ModelExecution = {
      run: async (plan) =>
        completedResult(plan, {
          kind: "root-evaluator-output",
          schemaVersion: 2,
          approachFamilies: [
            {
              key: "cross-actor-state",
              subjectDigests: [hypothesisRef.digest],
              thesis: "A public state writer may cross an actor boundary.",
              mechanism:
                "Attacker-controlled state reaches a privileged consumer.",
              falsifier: "Every consumer enforces actor ownership.",
              nextAction: "Trace each privileged consumer.",
            },
          ],
          actions: [
            {
              kind: "admit-depth",
              approachFamilyKey: "cross-actor-state",
              subjectDigests: [hypothesisRef.digest],
              admission: {
                highImpactPotential:
                  "Adjacent consumers may amplify the security effect.",
                composition: "Connect the writer to privileged consumers.",
                falsifier: "No consumer crosses an actor boundary.",
                nextAction: "Trace adjacent source-bound consumers.",
              },
            },
            {
              kind: "schedule-work",
              subjectDigests: [fragmentRef.digest],
              work: {
                requiredFact: "Resolve the fragment's consuming actor.",
                falsifier: "The fragment has no privileged consumer.",
                nextAction: "Inspect the source-bound fragment consumers.",
              },
            },
            {
              kind: "retain",
              subjectDigests: [sha256Digest(thesis)],
              reason: "Keep the independent thesis active.",
            },
          ],
          campaignDisposition: "continue",
        }),
    };

    await expect(
      semanticExploration(modelExecution).decide({
        ...evaluationInput(),
        schemaVersion: 3 as const,
      }),
    ).resolves.toMatchObject({
      kind: "evaluation-incomplete",
      schemaVersion: 3,
      reason: "invalid-action-binding",
      attempts: [{ role: "root-evaluator" }, { role: "root-evaluator" }],
    });
  });

  it("sends a Hypothesis to Verification and a Fragment to Depth in one complete decision", async () => {
    const observedPlans: ModelAttemptPlan[] = [];
    const modelExecution: ModelExecution = {
      run: async (plan) => {
        observedPlans.push(plan);
        return completedResult(plan, {
          kind: "root-evaluator-output",
          schemaVersion: 1,
          actions: [
            {
              kind: "request-verification",
              subjectDigests: [hypothesisRef.digest],
              request: {
                hypothesisDigest: hypothesisRef.digest,
                reason:
                  "The source-bound route plausibly crosses an authorization boundary.",
              },
            },
            {
              kind: "admit-depth",
              subjectDigests: [fragmentRef.digest],
              admission: {
                highImpactPotential:
                  "Persistent attacker-controlled state may compose with a privileged consumer.",
                composition:
                  "Connect the public state writer to cross-actor readers.",
                falsifier:
                  "Every consumer independently validates actor ownership.",
                nextAction: "Trace and challenge every privileged reader.",
              },
            },
            {
              kind: "retain",
              subjectDigests: [sha256Digest(thesis)],
              reason:
                "Keep the independent research direction active while evidence is verified.",
            },
          ],
          campaignDisposition: "continue",
        });
      },
    };
    const decision =
      await semanticExploration(modelExecution).decide(evaluationInput());

    expect(observedPlans).toHaveLength(1);
    expect(observedPlans[0]).toMatchObject({
      role: "root-evaluator",
      target,
      manifest,
      assignment: {
        kind: "wave-evaluation",
        wave: workWave.ref,
        terminalDigest: waveTerminalRef.digest,
      },
    });
    expect(observedPlans[0]).not.toHaveProperty("sourceToolPolicy");
    expect(decision).toMatchObject({
      kind: "iteration-decision",
      schemaVersion: 2,
      target,
      manifest,
      wave: workWave.ref,
      evaluationSubjects: [
        { kind: "research-thesis", id: thesis.id },
        { kind: "source-bound-hypothesis", id: hypothesisRef.id },
        { kind: "route-fragment", id: fragmentRef.id },
      ],
      actions: [
        {
          kind: "request-verification",
          subjects: [{ id: hypothesisRef.id }],
          request: { hypothesis: hypothesisRef },
        },
        {
          kind: "admit-depth",
          subjects: [{ id: fragmentRef.id }],
          admission: {
            target,
            manifest,
            wave: workWave.ref,
          },
        },
        {
          kind: "retain",
          subjects: [{ id: thesis.id }],
        },
      ],
      campaignDisposition: "continue",
    });
  });

  it("passes every Finder Source Receipt as a compact verified projection", async () => {
    const modelExecution: ModelExecution = {
      run: async (plan) => {
        const prefix = "Wave evaluation context: ";
        const contextLine = plan.prompt
          .split("\n")
          .find((line) => line.startsWith(prefix));
        expect(contextLine).toBeDefined();
        const context = JSON.parse(contextLine!.slice(prefix.length));
        expect(context.toolReceipts).toEqual([
          {
            ref: {
              kind: "source-evidence-receipt",
              schemaVersion: 2,
              attemptId: toolReceipt.attemptId,
              assignmentDigest: sha256Digest(toolReceipt.assignment),
              manifestDigest: toolReceipt.manifest.digest,
              queryDigest: toolReceipt.queryDigest,
              digest: sha256Digest(toolReceipt),
            },
            queryOrdinal: toolReceipt.queryOrdinal,
            operation: toolReceipt.operation,
            result: toolReceipt.result,
          },
        ]);
        expect(context.toolReceipts[0]).not.toHaveProperty("assignment");
        expect(context.toolReceipts[0]).not.toHaveProperty("targetSnapshot");
        expect(context.toolReceipts[0]).not.toHaveProperty("manifest");
        expect(context.toolReceipts[0]).not.toHaveProperty("policy");
        expect(JSON.stringify(context.toolReceipts).length).toBeLessThan(
          JSON.stringify([toolReceipt]).length,
        );
        expect(context.toolReceiptSummary).toEqual([
          {
            attemptId: toolReceipt.attemptId,
            queries: 1,
            operations: { list: 0, search: 0, read: 1 },
            results: { completed: 1 },
            usage: toolReceipt.usage,
          },
        ]);
        return completedResult(plan, {
          kind: "root-evaluator-output",
          schemaVersion: 1,
          actions: [
            {
              kind: "retain",
              subjectDigests: [
                sha256Digest(thesis),
                hypothesisRef.digest,
                fragmentRef.digest,
              ],
              reason: "Keep every subject active after reviewing the receipts.",
            },
          ],
          campaignDisposition: "continue",
        });
      },
    };

    const decision = await semanticExploration(modelExecution).decide(
      evaluationInput([toolReceipt]),
    );

    expect(decision).toMatchObject({
      kind: "iteration-decision",
      context: {
        toolReceipts: [
          {
            attemptId: finderAttemptValue.attemptId,
            queryDigest: toolReceipt.queryDigest,
          },
        ],
      },
    });
  });

  it("retries a silent subject omission once and returns typed incomplete", async () => {
    const attemptIds: string[] = [];
    const modelExecution: ModelExecution = {
      run: async (plan) => {
        attemptIds.push(plan.attemptId);
        return completedResult(plan, {
          kind: "root-evaluator-output",
          schemaVersion: 1,
          actions: [
            {
              kind: "retain",
              subjectDigests: [sha256Digest(thesis)],
              reason: "Keep the thesis active.",
            },
          ],
          campaignDisposition: "continue",
        });
      },
    };

    await expect(
      semanticExploration(modelExecution).decide(evaluationInput()),
    ).resolves.toMatchObject({
      kind: "evaluation-incomplete",
      reason: "subject-omission",
      attempts: [{ role: "root-evaluator" }, { role: "root-evaluator" }],
    });
    expect(attemptIds).toHaveLength(2);
    expect(new Set(attemptIds).size).toBe(2);
  });

  it("does not accept a foreign subject ref or fall back to a heuristic", async () => {
    const modelExecution: ModelExecution = {
      run: async (plan) =>
        completedResult(plan, {
          kind: "root-evaluator-output",
          schemaVersion: 1,
          actions: [
            {
              kind: "retain",
              subjectDigests: [digest("e")],
              reason: "This ref did not come from the Wave.",
            },
          ],
          campaignDisposition: "continue",
        }),
    };

    await expect(
      semanticExploration(modelExecution).decide(evaluationInput()),
    ).resolves.toMatchObject({
      kind: "evaluation-incomplete",
      reason: "foreign-subject",
    });
  });

  it("does not treat one no-new-evidence claim as Coverage Closure", async () => {
    const allSubjectDigests = [
      sha256Digest(thesis),
      hypothesisRef.digest,
      fragmentRef.digest,
    ];
    const modelExecution: ModelExecution = {
      run: async (plan) =>
        completedResult(plan, {
          kind: "root-evaluator-output",
          schemaVersion: 1,
          actions: [
            {
              kind: "close",
              subjectDigests: allSubjectDigests,
              record: {
                basis: "This single Wave reported no additional evidence.",
                reopenWhen: "More source evidence appears.",
              },
            },
          ],
          campaignDisposition: "coverage-closed",
        }),
    };

    await expect(
      semanticExploration(modelExecution).decide(evaluationInput()),
    ).resolves.toMatchObject({
      kind: "evaluation-incomplete",
      reason: "unsafe-closure",
    });
  });

  it("records an explicit complete closure observation without making it terminal by itself", async () => {
    const allSubjectDigests = [
      sha256Digest(thesis),
      hypothesisRef.digest,
      fragmentRef.digest,
    ];
    const modelExecution: ModelExecution = {
      run: async (plan) =>
        completedResult(plan, {
          kind: "root-evaluator-output",
          schemaVersion: 1,
          actions: [
            {
              kind: "close",
              subjectDigests: allSubjectDigests,
              record: {
                basis:
                  "Every current subject is explicitly closed by the available evidence.",
                reopenWhen: "A new source-bound semantic relation appears.",
              },
            },
          ],
          campaignDisposition: "coverage-closed",
        }),
    };

    await expect(
      semanticExploration(modelExecution).decide({
        ...evaluationInput(),
        closureReview: {
          kind: "coverage-closure-evaluation",
          schemaVersion: 1,
          reviewKind: "initial-wave",
          knownSubjectIds: [],
        },
      }),
    ).resolves.toMatchObject({
      kind: "iteration-decision",
      campaignDisposition: "coverage-closed",
      actions: [{ kind: "close" }],
    });
  });
});
