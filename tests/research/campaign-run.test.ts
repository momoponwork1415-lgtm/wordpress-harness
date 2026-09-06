import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  campaignRunPlanSchema,
  openResearch,
  type AttemptPlanMaterializer,
  type CampaignRunPlan,
} from "../../src/research/index.js";
import { openLegacyMapFirstResearchForTests } from "../../src/research/open-research.js";
import type {
  AttemptExecutionResult,
  ModelExecution,
} from "../../src/research/model-execution/index.js";
import {
  openFileJsonArtifactStore,
  type JsonArtifactStore,
} from "../../src/research/research-record/index.js";
import { sha256Digest } from "../../src/research/research-record/canonical-json.js";
import type {
  SurfaceMap,
  SurfaceMapRef,
} from "../../src/research/source-mapping/index.js";
import type {
  ExperimentObservation,
  IndependentVerifier,
  LabControl,
} from "../../src/research/verification/index.js";
import { LabControlBlockedError } from "../../src/research/verification/index.js";
import type {
  ExplorationBootstrapPolicy,
  ExplorationPolicyRef,
  SourceBoundHypothesis,
} from "../../src/research/exploration/index.js";
import { createCampaignInput } from "../fixtures/campaign.js";

const digest = (character: string): string => `sha256:${character.repeat(64)}`;
const fixedNow = "2026-09-02T06:00:00.000Z";

function surfaceMap(): SurfaceMap {
  const nodeId = sha256Digest("stored-xss-output");
  return {
    kind: "surface-map",
    schemaVersion: 1,
    revision: { kind: "initial", number: 1, predecessor: null },
    targetSnapshot: { id: "brizy-2.8.11", digest: digest("1") },
    mappingProfile: { id: "wordpress-static-v1", digest: digest("a") },
    sources: {
      manifestDigest: digest("b"),
      phpProgramIndexDigest: digest("c"),
    },
    inventory: [
      {
        path: "includes/form.php",
        digest: digest("d"),
        size: 300,
        classification: "php",
        coverage: { status: "indexed" },
      },
    ],
    nodes: [
      {
        id: nodeId,
        kind: "sink",
        subject: { kind: "html-output", operation: "echo" },
        evidence: {
          kind: "observed",
          evidence: [
            {
              kind: "source-anchor",
              targetSnapshotDigest: digest("1"),
              path: "includes/form.php",
              fileDigest: digest("d"),
              startLine: 40,
              endLine: 40,
              startOffset: 800,
              endOffset: 804,
            },
          ],
        },
      },
    ],
    relations: [],
    gaps: [],
    summary: { files: 1, nodes: 1, relations: 0, gaps: 0 },
  };
}

function explorationPolicy(): ExplorationBootstrapPolicy {
  return {
    kind: "exploration-bootstrap-policy",
    schemaVersion: 1,
    id: "closed-slice-wave-v1",
    maxFocusAreas: 1,
    maxLeases: 2,
    eligibleModelFamilies: ["claude"],
    leaseBudget: {
      maxWallTimeMs: 60_000,
      maxModelTokens: 10_000,
      maxHypotheses: 2,
    },
  };
}

function hypothesis(): SourceBoundHypothesis {
  return {
    kind: "source-bound-hypothesis",
    schemaVersion: 1,
    causalIdentity: {
      rootCause: "stored-value-output-without-context-escaping",
      attackerControlledPrimitive: "unauthenticated-persistent-form-value",
      brokenSecurityProperty: "admin-browser-script-integrity",
    },
    attackerPremise: "unauthenticated",
    impact: "stored-xss",
    route: {
      anchors: [
        {
          path: "includes/form.php",
          fileDigest: digest("d"),
          startLine: 12,
          endLine: 18,
        },
      ],
    },
    unknowns: [
      {
        claim: "the value reaches a privileged browser",
        requiredEvidence: "fresh browser witness and causal control",
      },
    ],
    falsifier: "the rendered value is context-escaped",
    nextExperiment: "compare browser canaries with the causal factor removed",
  };
}

function finder(
  artifacts: JsonArtifactStore,
  candidate: SourceBoundHypothesis,
): ModelExecution {
  return {
    run: async (plan): Promise<AttemptExecutionResult> => {
      if (plan.schemaVersion !== 1) {
        throw new Error("Legacy Finder fixture received a version 2 plan");
      }
      const value = {
        kind: "finder-attempt-result" as const,
        schemaVersion: 1 as const,
        attemptId: plan.attemptId,
        leaseId: plan.leaseId,
        status: "completed" as const,
        output: {
          kind: "finder-output" as const,
          schemaVersion: 1 as const,
          leaseId: plan.leaseId,
          hypotheses: [candidate],
        },
      };
      const resultDigest = await artifacts.putJson(value);
      return {
        status: "completed",
        value,
        ref: {
          kind: "attempt-execution-result",
          schemaVersion: 1,
          attemptId: plan.attemptId,
          leaseId: plan.leaseId,
          digest: resultDigest,
        },
      };
    },
  };
}

function emptyFinder(artifacts: JsonArtifactStore): ModelExecution {
  return {
    run: async (plan) => {
      if (plan.schemaVersion !== 1) {
        throw new Error("Legacy Finder fixture received a version 2 plan");
      }
      const value = {
        kind: "finder-attempt-result" as const,
        schemaVersion: 1 as const,
        attemptId: plan.attemptId,
        leaseId: plan.leaseId,
        status: "completed" as const,
        output: {
          kind: "finder-output" as const,
          schemaVersion: 1 as const,
          leaseId: plan.leaseId,
          hypotheses: [],
        },
      };
      const resultDigest = await artifacts.putJson(value);
      return {
        status: value.status,
        value,
        ref: {
          kind: "attempt-execution-result",
          schemaVersion: 1,
          attemptId: value.attemptId,
          leaseId: value.leaseId,
          digest: resultDigest,
        },
      };
    },
  };
}

function providerFailedFinder(artifacts: JsonArtifactStore): ModelExecution {
  return {
    run: async (plan) => {
      if (plan.schemaVersion !== 1) {
        throw new Error("Legacy Finder fixture received a version 2 plan");
      }
      const value = {
        kind: "finder-attempt-result" as const,
        schemaVersion: 1 as const,
        attemptId: plan.attemptId,
        leaseId: plan.leaseId,
        status: "provider-failed" as const,
        reason: "provider-exit-1",
      };
      const resultDigest = await artifacts.putJson(value);
      return {
        status: value.status,
        value,
        ref: {
          kind: "attempt-execution-result",
          schemaVersion: 1,
          attemptId: value.attemptId,
          leaseId: value.leaseId,
          digest: resultDigest,
        },
      };
    },
  };
}

function orderedFinder(
  artifacts: JsonArtifactStore,
  candidate: SourceBoundHypothesis,
  order: "forward" | "reverse",
): ModelExecution {
  const pending: {
    readonly plan: Parameters<ModelExecution["run"]>[0];
    readonly resolve: (result: AttemptExecutionResult) => void;
    readonly reject: (error: unknown) => void;
  }[] = [];
  return {
    run: (plan) =>
      new Promise((resolve, reject) => {
        pending.push({ plan, resolve, reject });
        if (pending.length !== 2) return;
        const scheduled =
          order === "forward" ? pending : [...pending].reverse();
        void (async () => {
          for (const item of scheduled) {
            try {
              const result = await finder(artifacts, candidate).run(item.plan);
              item.resolve(result);
            } catch (error) {
              item.reject(error);
            }
          }
        })();
      }),
  };
}

function materializer(): AttemptPlanMaterializer {
  return {
    materialize: async () => ({
      kind: "finder-attempt-materialization",
      schemaVersion: 1,
      modelProfile: {
        provider: "anthropic",
        model: "claude-opus-5",
        transport: "claude-code-process",
        executableVersion: "2.1.251",
        effort: "high",
        eligibilityReceiptDigest: digest("e"),
      },
      prompt: "Inspect the bounded source slice without external tools.",
      maxOutputBytes: 1_000_000,
    }),
  };
}

function sourceGuidedMaterializer(): AttemptPlanMaterializer {
  return {
    materialize: async (input) => {
      if (input.run.finder.sourceEvidence === undefined) {
        throw new Error("Source Evidence must be fixed by the Campaign Plan");
      }
      return {
        kind: "finder-attempt-materialization",
        schemaVersion: 1,
        modelProfile: {
          provider: "anthropic",
          model: "claude-opus-5",
          transport: "claude-code-process",
          executableVersion: "2.1.251",
          effort: "high",
          eligibilityReceiptDigest: digest("e"),
        },
        prompt:
          "Inspect the bounded source and retrieve missing route evidence.",
        maxOutputBytes: 1_000_000,
        sourceEvidence: input.run.finder.sourceEvidence,
      };
    },
  };
}

function sourceEvidenceConfiguration(): NonNullable<
  CampaignRunPlan["finder"]["sourceEvidence"]
> {
  return {
    policy: {
      kind: "source-tool-policy",
      schemaVersion: 1,
      id: "finder-source-evidence-v1",
      digest: digest("c"),
    },
    maxQueries: 12,
  };
}

function sourcePolicyBoundFinder(
  artifacts: JsonArtifactStore,
  candidate: SourceBoundHypothesis,
): ModelExecution {
  const enabled = finder(artifacts, candidate);
  const unavailable = providerFailedFinder(artifacts);
  return {
    run: (plan) => {
      if (plan.schemaVersion !== 1) {
        throw new Error("Legacy Finder fixture received a version 2 plan");
      }
      return plan.sourceToolPolicy?.id === "finder-source-evidence-v1" &&
        plan.sourceToolPolicy.digest === digest("c") &&
        plan.budget.maxSourceQueries === 12
        ? enabled.run(plan)
        : unavailable.run(plan);
    },
  };
}

function verifier(): IndependentVerifier {
  return {
    rederive: async (plan) => ({
      kind: "source-rederivation",
      schemaVersion: 1,
      verificationId: plan.verificationId,
      targetSnapshotDigest: plan.targetSnapshot.digest,
      hypothesisDigest: plan.hypothesisDigest,
      status: "supported",
      sourceEvidence: [
        {
          path: "includes/form.php",
          fileDigest: digest("d"),
          startLine: 40,
          endLine: 80,
        },
      ],
      experiment: {
        kind: "stored-xss-browser",
        schemaVersion: 1,
        adapterVersion: "stored-xss-browser@v1",
        causalFactor: "attacker-controlled-stored-value",
        successCriterion: "privileged-browser-execution-canary",
      },
    }),
  };
}

function lab(artifacts: JsonArtifactStore): LabControl {
  return {
    execute: async ({ plan }) => {
      const isWitness = plan.role === "witness";
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
          labId: isWitness ? "fresh-witness-lab" : "fresh-control-lab",
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
          persistentStateObserved: isWitness,
          browserCanaryExecuted: isWitness,
        },
        artifactRefs: [],
      };
      const observationDigest = await artifacts.putJson(observation);
      return {
        kind: "experiment-observation",
        schemaVersion: 1,
        experimentId: plan.experimentId,
        digest: observationDigest,
      };
    },
  };
}

async function openScenario(
  directory: string,
  modelExecution: (
    artifacts: JsonArtifactStore,
    candidate: SourceBoundHypothesis,
  ) => ModelExecution,
  maxFinderAttempts = 2,
  labControl: (artifacts: JsonArtifactStore) => LabControl = lab,
  calibrationReview?: {
    review(input: unknown): Promise<unknown>;
  },
  attemptPlanMaterializer: AttemptPlanMaterializer = materializer(),
  finderSourceEvidence?: NonNullable<
    CampaignRunPlan["finder"]["sourceEvidence"]
  >,
) {
  const databasePath = join(directory, "research.sqlite");
  const artifacts = openFileJsonArtifactStore(join(directory, "artifacts"));
  const map = surfaceMap();
  const policy = explorationPolicy();
  const mapRef: SurfaceMapRef = {
    kind: "surface-map",
    schemaVersion: 1,
    revisionKind: "initial",
    targetSnapshotId: map.targetSnapshot.id,
    mappingProfileId: map.mappingProfile.id,
    digest: await artifacts.putJson(map),
    summary: map.summary,
  };
  const policyRef: ExplorationPolicyRef = {
    kind: "exploration-policy",
    schemaVersion: 1,
    id: policy.id,
    digest: await artifacts.putJson(policy),
  };
  const candidate = hypothesis();
  const input = {
    ...createCampaignInput(),
    targetSnapshot: {
      id: "brizy-2.8.11",
      pluginSlug: "brizy",
      version: "2.8.11",
      digest: digest("1"),
    },
    runtimeProfile: {
      id: "gvisor-wordpress-v1",
      digest: digest("3"),
    },
    promptSet: { id: "research-prompts-v1", digest: digest("7") },
    modelProfiles: [
      { id: "opus-finder-v1", digest: digest("6") },
      { id: "opus-verifier-v1", digest: digest("8") },
    ],
    experimentRegistry: {
      id: "stored-xss-browser-v1",
      digest: digest("9"),
    },
  };
  const plan: CampaignRunPlan = {
    kind: "campaign-run-plan",
    schemaVersion: 1,
    runId: "run-brizy-2-8-11-a",
    campaignId: input.campaignId,
    preparationDigest: sha256Digest(input),
    surfaceMap: mapRef,
    explorationPolicy: policyRef,
    finder: {
      modelProfile: {
        kind: "model-profile",
        schemaVersion: 1,
        id: "opus-finder-v1",
        family: "claude",
        digest: digest("6"),
      },
      promptSet: {
        kind: "prompt-set",
        schemaVersion: 1,
        id: "research-prompts-v1",
        digest: digest("7"),
      },
      ...(finderSourceEvidence === undefined
        ? {}
        : { sourceEvidence: finderSourceEvidence }),
    },
    verification: {
      labBaseline: {
        kind: "lab-baseline",
        schemaVersion: 1,
        id: "brizy-2-8-11-baseline",
        digest: digest("2"),
        targetSnapshotDigest: digest("1"),
        runtimeProfileDigest: digest("3"),
        setupPlanDigest: digest("4"),
        configurationDigest: digest("5"),
      },
      verifierModelProfile: {
        kind: "model-profile",
        schemaVersion: 1,
        id: "opus-verifier-v1",
        family: "claude",
        digest: digest("8"),
      },
      promptSet: {
        kind: "prompt-set",
        schemaVersion: 1,
        id: "research-prompts-v1",
        digest: digest("7"),
      },
      verificationPolicy: {
        kind: "verification-policy",
        schemaVersion: 1,
        id: "stored-xss-independent-v1",
        digest: digest("f"),
      },
      experimentRegistry: {
        kind: "experiment-registry",
        schemaVersion: 1,
        id: "stored-xss-browser-v1",
        digest: digest("9"),
      },
    },
    budget: {
      maxWallTimeMs: 300_000,
      maxModelTokens: 30_000,
      maxFinderAttempts,
      verification: {
        maxVerifierAttempts: 1,
        maxExperiments: 2,
        maxWallTimeMs: 120_000,
      },
    },
    iterationPolicy: {
      kind: "iteration-policy",
      schemaVersion: 1,
      id: "first-closed-slice-v1",
      digest: digest("0"),
    },
    ...(calibrationReview === undefined
      ? {}
      : {
          calibrationContext: {
            kind: "calibration-context" as const,
            schemaVersion: 1 as const,
            id: "private-brizy-boundary-pair-v1",
            digest: digest("a"),
          },
        }),
  };
  const research = openLegacyMapFirstResearchForTests({
    databasePath,
    clock: () => new Date(fixedNow),
    campaignExecution: {
      artifactStore: artifacts,
      attemptPlanMaterializer,
      modelExecution: modelExecution(artifacts, candidate),
      independentVerifier: verifier(),
      labControl: labControl(artifacts),
      ...(calibrationReview === undefined ? {} : { calibrationReview }),
    },
  });
  await research.runner.prepare(input);
  return { artifacts, candidate, databasePath, input, plan, research };
}

describe("CampaignRunner.run", () => {
  it("rejects a new Map-first v1 run through the public CampaignRunner", async () => {
    const directory = await mkdtemp(join(tmpdir(), "campaign-map-first-off-"));
    const scenario = await openScenario(directory, finder);
    const publicResearch = openResearch({
      databasePath: scenario.databasePath,
    });

    try {
      await expect(publicResearch.runner.run(scenario.plan)).rejects.toThrow(
        "Map-first Campaign execution is retired",
      );
    } finally {
      publicResearch.close();
      scenario.research.close();
      await rm(directory, { force: true, recursive: true });
    }
  });

  it("admits four Finder attempts per Wave and rejects a fifth", async () => {
    const directory = await mkdtemp(join(tmpdir(), "campaign-finder-cap-"));
    const scenario = await openScenario(directory, finder, 4);

    try {
      expect(
        campaignRunPlanSchema.parse(scenario.plan).budget.maxFinderAttempts,
      ).toBe(4);
      expect(() =>
        campaignRunPlanSchema.parse({
          ...scenario.plan,
          budget: { ...scenario.plan.budget, maxFinderAttempts: 5 },
        }),
      ).toThrow();
    } finally {
      scenario.research.close();
      await rm(directory, { force: true, recursive: true });
    }
  });

  it("carries the materialized Source Tool Policy into every Finder Attempt", async () => {
    const directory = await mkdtemp(
      join(tmpdir(), "campaign-source-evidence-"),
    );
    const scenario = await openScenario(
      directory,
      sourcePolicyBoundFinder,
      2,
      lab,
      undefined,
      sourceGuidedMaterializer(),
      sourceEvidenceConfiguration(),
    );

    try {
      const ref = await scenario.research.runner.run(scenario.plan);
      const view = await scenario.research.reader.inspect(
        scenario.input.campaignId,
        { kind: "run", runId: scenario.plan.runId },
      );

      expect({ ref, view }).toMatchObject({
        ref: { decision: "await-calibration" },
        view: {
          value: {
            attempts: [{}, {}],
            verifications: [{ outcome: "finding" }],
            decision: { kind: "await-calibration" },
          },
        },
      });
    } finally {
      scenario.research.close();
      await rm(directory, { force: true, recursive: true });
    }
  });

  it("records one finite wave through a Finding and preserves terminal run idempotency", async () => {
    const directory = await mkdtemp(join(tmpdir(), "campaign-run-"));
    const {
      databasePath,
      input,
      plan,
      research: first,
    } = await openScenario(directory, finder);

    try {
      const terminalRef = await first.runner.run(plan);
      const terminal = await first.reader.inspect(input.campaignId, {
        kind: "run",
        runId: plan.runId,
      });
      const progress = await first.reader.inspect(input.campaignId, {
        kind: "progress",
      });

      expect({ terminalRef, terminal, progress }).toMatchObject({
        terminalRef: {
          kind: "campaign-run-record",
          schemaVersion: 1,
          runId: plan.runId,
          decision: "await-calibration",
        },
        terminal: {
          kind: "run",
          campaignId: input.campaignId,
          runId: plan.runId,
          value: {
            attempts: [{}, {}],
            verifications: [{ outcome: "finding" }],
            decision: {
              kind: "await-calibration",
              terminalVerifications: [{ outcome: "finding" }],
            },
          },
        },
        progress: {
          kind: "progress",
          schemaVersion: 1,
          campaignId: input.campaignId,
          status: "completed",
          counts: {
            runs: { started: 1, completed: 1, active: 0 },
            attempts: { started: 2, completed: 2, active: 0 },
            verifications: {
              started: 1,
              completed: 1,
              active: 0,
              finding: 1,
              disproved: 0,
              blocked: 0,
            },
          },
          activeAttempts: [],
          activeVerifications: [],
          lastDurableEvent: { kind: "campaign.run-completed" },
        },
      });
      first.close();

      const reopened = openResearch({ databasePath });
      try {
        await expect(reopened.runner.run(plan)).resolves.toEqual(terminalRef);
      } finally {
        reopened.close();
      }
    } finally {
      first.close();
      await rm(directory, { force: true, recursive: true });
    }
  });

  it("records Boundary Pair completion from an opaque private Calibration Review", async () => {
    const directory = await mkdtemp(join(tmpdir(), "campaign-calibration-"));
    let reviewInput: unknown;
    const scenario = await openScenario(directory, finder, 2, lab, {
      review: async (input) => {
        reviewInput = input;
        return {
          kind: "complete",
          schemaVersion: 1,
          evidence: {
            kind: "boundary-pair-evidence",
            schemaVersion: 1,
            calibrationContextDigest: digest("a"),
            digest: digest("b"),
          },
        };
      },
    });

    try {
      const ref = await scenario.research.runner.run(scenario.plan);
      const view = await scenario.research.reader.inspect(
        scenario.input.campaignId,
        { kind: "run", runId: scenario.plan.runId },
      );

      expect({ ref, view }).toMatchObject({
        ref: { decision: "stop-boundary-pair-complete" },
        view: {
          value: {
            decision: {
              kind: "stop-boundary-pair-complete",
              evidence: {
                kind: "boundary-pair-evidence",
                schemaVersion: 1,
                calibrationContextDigest: digest("a"),
                digest: digest("b"),
              },
            },
          },
        },
      });
      expect(reviewInput).toEqual({
        calibrationContext: {
          kind: "calibration-context",
          schemaVersion: 1,
          id: "private-brizy-boundary-pair-v1",
          digest: digest("a"),
        },
        campaign: {
          campaignId: scenario.input.campaignId,
          runId: scenario.plan.runId,
        },
        terminalVerifications: [
          expect.objectContaining({
            kind: "verification-record",
            schemaVersion: 1,
            outcome: "finding",
          }),
        ],
      });
    } finally {
      scenario.research.close();
      await rm(directory, { force: true, recursive: true });
    }
  });

  it("rejects Calibration Review evidence bound to another private context", async () => {
    const directory = await mkdtemp(join(tmpdir(), "campaign-calibration-"));
    const scenario = await openScenario(directory, finder, 2, lab, {
      review: async () => ({
        kind: "complete",
        schemaVersion: 1,
        evidence: {
          kind: "boundary-pair-evidence",
          schemaVersion: 1,
          calibrationContextDigest: digest("c"),
          digest: digest("b"),
        },
      }),
    });

    try {
      await expect(scenario.research.runner.run(scenario.plan)).rejects.toThrow(
        "Calibration Review targets a different context",
      );
      await expect(
        scenario.research.reader.inspect(scenario.input.campaignId, {
          kind: "run",
          runId: scenario.plan.runId,
        }),
      ).rejects.toThrow("Campaign run not found");
    } finally {
      scenario.research.close();
      await rm(directory, { force: true, recursive: true });
    }
  });

  it("does not close a Boundary Pair without a conclusive current Verification", async () => {
    const directory = await mkdtemp(join(tmpdir(), "campaign-calibration-"));
    let reviewCalls = 0;
    const scenario = await openScenario(
      directory,
      (artifacts) => emptyFinder(artifacts),
      3,
      lab,
      {
        review: async () => {
          reviewCalls += 1;
          return {
            kind: "complete",
            schemaVersion: 1,
            evidence: {
              kind: "boundary-pair-evidence",
              schemaVersion: 1,
              calibrationContextDigest: digest("a"),
              digest: digest("b"),
            },
          };
        },
      },
    );

    try {
      await expect(
        scenario.research.runner.run(scenario.plan),
      ).resolves.toMatchObject({ decision: "continue-unresolved-work" });
      expect(reviewCalls).toBe(0);
    } finally {
      scenario.research.close();
      await rm(directory, { force: true, recursive: true });
    }
  });

  it("records orphaned processes and spends only remaining budget on a fresh Attempt", async () => {
    const directory = await mkdtemp(join(tmpdir(), "campaign-recovery-"));
    const scenario = await openScenario(
      directory,
      () => ({
        run: async () => {
          throw new Error("simulated-process-loss");
        },
      }),
      3,
    );

    try {
      await expect(scenario.research.runner.run(scenario.plan)).rejects.toThrow(
        "simulated-process-loss",
      );
      scenario.research.close();

      let freshExecutions = 0;
      const recoveredFinder = finder(scenario.artifacts, scenario.candidate);
      const recovered = openLegacyMapFirstResearchForTests({
        databasePath: scenario.databasePath,
        clock: () => new Date(fixedNow),
        campaignExecution: {
          artifactStore: scenario.artifacts,
          attemptPlanMaterializer: materializer(),
          modelExecution: {
            run: async (plan) => {
              freshExecutions += 1;
              return recoveredFinder.run(plan);
            },
          },
          independentVerifier: verifier(),
          labControl: lab(scenario.artifacts),
        },
      });

      try {
        const ref = await recovered.runner.run(scenario.plan);
        const view = await recovered.reader.inspect(scenario.input.campaignId, {
          kind: "run",
          runId: scenario.plan.runId,
        });

        expect({ freshExecutions, ref, view }).toMatchObject({
          freshExecutions: 1,
          ref: { decision: "await-calibration" },
          view: {
            value: {
              attempts: [{}, {}, {}],
              verifications: [{ outcome: "finding" }],
            },
          },
        });
      } finally {
        recovered.close();
      }
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it("preserves gVisor unavailability as the Campaign stop reason", async () => {
    const directory = await mkdtemp(join(tmpdir(), "campaign-gvisor-blocked-"));
    const scenario = await openScenario(directory, finder, 2, () => ({
      execute: async () => {
        throw new LabControlBlockedError("gvisor-unavailable");
      },
    }));

    try {
      const ref = await scenario.research.runner.run(scenario.plan);
      const view = await scenario.research.reader.inspect(
        scenario.input.campaignId,
        { kind: "run", runId: scenario.plan.runId },
      );

      expect({ ref, view }).toMatchObject({
        ref: { decision: "blocked-capability" },
        view: {
          value: {
            verifications: [{ outcome: "blocked" }],
            decision: {
              kind: "blocked-capability",
              reasons: ["gvisor-unavailable"],
            },
          },
        },
      });
    } finally {
      scenario.research.close();
      await rm(directory, { force: true, recursive: true });
    }
  });

  it("produces the same terminal digest when Finder completion order reverses", async () => {
    const firstDirectory = await mkdtemp(join(tmpdir(), "campaign-order-a-"));
    const secondDirectory = await mkdtemp(join(tmpdir(), "campaign-order-b-"));
    const first = await openScenario(firstDirectory, (artifacts, candidate) =>
      orderedFinder(artifacts, candidate, "forward"),
    );
    const second = await openScenario(secondDirectory, (artifacts, candidate) =>
      orderedFinder(artifacts, candidate, "reverse"),
    );

    try {
      const firstRef = await first.research.runner.run(first.plan);
      const secondRef = await second.research.runner.run(second.plan);
      const firstView = await first.research.reader.inspect(
        first.input.campaignId,
        { kind: "run", runId: first.plan.runId },
      );
      const secondView = await second.research.reader.inspect(
        second.input.campaignId,
        { kind: "run", runId: second.plan.runId },
      );

      expect({ secondRef, secondView }).toEqual({
        secondRef: firstRef,
        secondView: firstView,
      });
    } finally {
      first.research.close();
      second.research.close();
      await rm(firstDirectory, { force: true, recursive: true });
      await rm(secondDirectory, { force: true, recursive: true });
    }
  });

  it("records finite next work when unresolved exploration still has budget", async () => {
    const directory = await mkdtemp(join(tmpdir(), "campaign-continue-"));
    const scenario = await openScenario(
      directory,
      (artifacts) => emptyFinder(artifacts),
      3,
    );

    try {
      const ref = await scenario.research.runner.run(scenario.plan);
      const view = await scenario.research.reader.inspect(
        scenario.input.campaignId,
        { kind: "run", runId: scenario.plan.runId },
      );
      expect({ ref, view }).toMatchObject({
        ref: { decision: "continue-unresolved-work" },
        view: {
          value: {
            verifications: [],
            decision: {
              kind: "continue-unresolved-work",
              next: {
                kind: "finite-work",
                schemaVersion: 1,
                digest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
              },
            },
          },
        },
      });
      if (view.kind !== "run") throw new Error("expected Campaign run view");
      if (view.value.decision.kind !== "continue-unresolved-work") {
        throw new Error("expected finite next work");
      }
      await expect(
        scenario.artifacts.readJson(view.value.decision.next.digest),
      ).resolves.toMatchObject({
        kind: "finite-work",
        schemaVersion: 1,
        campaignId: scenario.input.campaignId,
        sourceRunId: scenario.plan.runId,
        remainingFinderAttempts: 1,
        stopWhen: "source-bound-hypothesis-or-budget-exhausted",
      });
    } finally {
      scenario.research.close();
      await rm(directory, { force: true, recursive: true });
    }
  });

  it("preserves total Finder provider failure as the Campaign stop reason", async () => {
    const directory = await mkdtemp(
      join(tmpdir(), "campaign-provider-blocked-"),
    );
    const scenario = await openScenario(
      directory,
      (artifacts) => providerFailedFinder(artifacts),
      2,
    );

    try {
      const ref = await scenario.research.runner.run(scenario.plan);
      const view = await scenario.research.reader.inspect(
        scenario.input.campaignId,
        { kind: "run", runId: scenario.plan.runId },
      );

      expect({ ref, view }).toMatchObject({
        ref: { decision: "blocked-capability" },
        view: {
          value: {
            attempts: [{}, {}],
            verifications: [],
            decision: {
              kind: "blocked-capability",
              reasons: ["provider-unavailable"],
            },
          },
        },
      });
      if (view.kind !== "run") throw new Error("expected Campaign run view");
      await expect(
        Promise.all(
          view.value.attempts.map((attempt) =>
            scenario.artifacts.readJson(attempt.digest),
          ),
        ),
      ).resolves.toMatchObject([
        { status: "provider-failed" },
        { status: "provider-failed" },
      ]);
    } finally {
      scenario.research.close();
      await rm(directory, { force: true, recursive: true });
    }
  });
});
