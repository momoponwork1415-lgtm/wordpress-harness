import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  openFileJsonArtifactStore,
  openSqliteResearchRecord,
} from "../../src/research/research-record/index.js";
import { sha256Digest } from "../../src/research/research-record/canonical-json.js";
import {
  openVerification,
  type ExperimentObservation,
  type IndependentVerifier,
  type LabControl,
  type VerificationPlan,
} from "../../src/research/verification/index.js";
import { createCampaignInput } from "../fixtures/campaign.js";

const digest = (character: string): string => `sha256:${character.repeat(64)}`;

const fixedNow = "2026-09-02T00:00:00.000Z";

function verificationPlan(): VerificationPlan {
  const hypothesis = {
    kind: "source-bound-hypothesis" as const,
    schemaVersion: 1 as const,
    causalIdentity: {
      rootCause: "stored-value-output-without-context-escaping",
      attackerControlledPrimitive: "unauthenticated-persistent-form-value",
      brokenSecurityProperty: "admin-browser-script-integrity",
    },
    attackerPremise: "unauthenticated" as const,
    impact: "stored-xss" as const,
    route: {
      anchorNodeId: digest("a"),
      nodeIds: [digest("a"), digest("b"), digest("c")],
      relationIds: [digest("d"), digest("e")],
    },
    unknowns: [
      {
        claim: "the stored value reaches an administrator browser",
        requiredEvidence: "a fresh browser execution canary observation",
      },
    ],
    falsifier: "the value is context-escaped before privileged rendering",
    nextExperiment: "submit a canary value and open the privileged view",
  };

  return {
    kind: "verification-plan",
    schemaVersion: 1,
    verificationId: "verification-stored-xss-positive",
    campaignId: "campaign-verification-positive",
    targetSnapshot: {
      id: "neutral-snapshot-a",
      pluginSlug: "fixture-plugin",
      version: "1.0.0",
      digest: digest("1"),
    },
    scope: { permittedAttacker: "unauthenticated" },
    hypothesis,
    hypothesisDigest: sha256Digest(hypothesis),
    labBaseline: {
      kind: "lab-baseline",
      schemaVersion: 1,
      id: "baseline-a",
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
      digest: digest("6"),
    },
    promptSet: {
      kind: "prompt-set",
      schemaVersion: 1,
      id: "verifier-prompts-v1",
      digest: digest("7"),
    },
    verificationPolicy: {
      kind: "verification-policy",
      schemaVersion: 1,
      id: "verification-policy-v1",
      digest: digest("8"),
    },
    experimentRegistry: {
      kind: "experiment-registry",
      schemaVersion: 1,
      id: "experiment-registry-v1",
      digest: digest("9"),
    },
    budget: {
      maxVerifierAttempts: 1,
      maxExperiments: 2,
      maxWallTimeMs: 300_000,
    },
  };
}

describe("Verification.verify", () => {
  it("durably records a Finding after a browser Witness and fresh sibling Causal Control", async () => {
    const directory = await mkdtemp(join(tmpdir(), "verification-finding-"));
    const databasePath = join(directory, "research.sqlite");
    const artifactStore = openFileJsonArtifactStore(
      join(directory, "private-artifacts"),
    );
    const plan = verificationPlan();
    const record = openSqliteResearchRecord({
      databasePath,
      clock: () => new Date(fixedNow),
    });

    const campaignInput = createCampaignInput(plan.campaignId);
    await record.recordPreparation({
      ...campaignInput,
      targetSnapshot: plan.targetSnapshot,
      runtimeProfile: {
        id: campaignInput.runtimeProfile.id,
        digest: plan.labBaseline.runtimeProfileDigest,
      },
      promptSet: {
        id: campaignInput.promptSet.id,
        digest: plan.promptSet.digest,
      },
      modelProfiles: [
        {
          id: plan.verifierModelProfile.id,
          digest: plan.verifierModelProfile.digest,
        },
      ],
      experimentRegistry: {
        id: plan.experimentRegistry.id,
        digest: plan.experimentRegistry.digest,
      },
    });

    const independentVerifier: IndependentVerifier = {
      rederive: async (input) => ({
        kind: "source-rederivation",
        schemaVersion: 1,
        verificationId: input.verificationId,
        targetSnapshotDigest: input.targetSnapshot.digest,
        hypothesisDigest: input.hypothesisDigest,
        status: "supported",
        sourceEvidence: [
          {
            path: "includes/form-handler.php",
            fileDigest: digest("a"),
            startLine: 40,
            endLine: 91,
          },
          {
            path: "assets/admin-view.js",
            fileDigest: digest("b"),
            startLine: 12,
            endLine: 31,
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

    const labControl: LabControl = {
      execute: async (experiment) => {
        const isWitness = experiment.role === "witness";
        const observation: ExperimentObservation = {
          kind: "experiment-observation",
          schemaVersion: 1,
          experimentId: experiment.experimentId,
          verificationId: experiment.verificationId,
          role: experiment.role,
          hypothesisDigest: experiment.hypothesisDigest,
          bindings: experiment.bindings,
          isolation: {
            runtime: "gvisor",
            runtimeDigest: digest("0"),
            siblingGroupId: experiment.siblingGroupId,
            labId: isWitness ? "lab-witness-a" : "lab-control-a",
            fresh: true,
            fallbackUsed: false,
          },
          causalFactor: {
            id: experiment.mechanism.causalFactor,
            state: isWitness ? "present" : "removed",
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
        const observationDigest = await artifactStore.putJson(observation);
        return {
          kind: "experiment-observation",
          schemaVersion: 1,
          experimentId: experiment.experimentId,
          digest: observationDigest,
        };
      },
    };

    const verification = openVerification({
      record,
      artifactStore,
      independentVerifier,
      labControl,
    });

    try {
      const ref = await verification.verify(plan);
      record.close();

      const reopened = openSqliteResearchRecord({ databasePath });
      try {
        const replayed = await reopened.readVerification(
          plan.campaignId,
          plan.verificationId,
        );

        expect({ ref, replayed }).toMatchObject({
          ref: {
            kind: "verification-record",
            schemaVersion: 1,
            verificationId: plan.verificationId,
            outcome: "finding",
          },
          replayed: {
            value: {
              kind: "verification-record",
              schemaVersion: 1,
              verificationId: plan.verificationId,
              campaignId: plan.campaignId,
              outcome: {
                kind: "finding",
                causalIdentity: plan.hypothesis.causalIdentity,
              },
            },
          },
        });
      } finally {
        reopened.close();
      }
    } finally {
      try {
        record.close();
      } catch {
        // The successful path closes before reopening the same database.
      }
      await rm(directory, { force: true, recursive: true });
    }
  });
});
