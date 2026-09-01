import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  openResearch,
  type AttemptPlanMaterializer,
  type CampaignRunPlan,
} from "../../src/research/index.js";
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

function hypothesis(anchorNodeId: string): SourceBoundHypothesis {
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
      anchorNodeId,
      nodeIds: [anchorNodeId],
      relationIds: [],
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
    execute: async (plan) => {
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
  const candidate = hypothesis(map.nodes[0]!.id);
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
  };
  const research = openResearch({
    databasePath,
    clock: () => new Date(fixedNow),
    campaignExecution: {
      artifactStore: artifacts,
      attemptPlanMaterializer: materializer(),
      modelExecution: modelExecution(artifacts, candidate),
      independentVerifier: verifier(),
      labControl: lab(artifacts),
    },
  });
  await research.runner.prepare(input);
  return { artifacts, candidate, databasePath, input, plan, research };
}

describe("CampaignRunner.run", () => {
  it("records one finite wave through a Finding and replays the terminal run", async () => {
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

      expect({ terminalRef, terminal }).toMatchObject({
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
      });
      first.close();

      const reopened = openResearch({ databasePath });
      try {
        await expect(
          reopened.reader.inspect(input.campaignId, {
            kind: "run",
            runId: plan.runId,
          }),
        ).resolves.toEqual(terminal);
        await expect(reopened.runner.run(plan)).resolves.toEqual(terminalRef);
      } finally {
        reopened.close();
      }
    } finally {
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
      const recovered = openResearch({
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
});
