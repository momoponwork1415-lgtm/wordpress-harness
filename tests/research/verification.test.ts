import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  openFileJsonArtifactStore,
  openSqliteResearchRecord,
  type JsonArtifactStore,
  type ResearchRecord,
} from "../../src/research/research-record/index.js";
import { sha256Digest } from "../../src/research/research-record/canonical-json.js";
import {
  IndependentVerifierBlockedError,
  LabControlBlockedError,
  openVerification,
  type ExperimentObservation,
  type IndependentVerifier,
  type LabControl,
  type VerificationPlan,
} from "../../src/research/verification/index.js";
import { createCampaignInput } from "../fixtures/campaign.js";

const digest = (character: string): string => `sha256:${character.repeat(64)}`;

const fixedNow = "2026-09-02T00:00:00.000Z";

type LabScenario =
  | "broken"
  | "preserved"
  | "gvisor-unavailable"
  | "sibling-mismatch"
  | "artifact-mismatch"
  | "verifier-unavailable"
  | "verifier-budget-exhausted"
  | "evidence-incomplete"
  | "fallback-observed"
  | "same-lab";

interface VerificationIdentity {
  readonly campaignId: string;
  readonly verificationId: string;
}

function verificationPlan(
  identity: VerificationIdentity = {
    campaignId: "campaign-verification-positive",
    verificationId: "verification-stored-xss-positive",
  },
): VerificationPlan {
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
    verificationId: identity.verificationId,
    campaignId: identity.campaignId,
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

async function prepareCampaign(
  record: ResearchRecord,
  plan: VerificationPlan,
): Promise<void> {
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
}

function supportedStoredXssVerifier(): IndependentVerifier {
  return {
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
}

function storedXssLabControl(
  artifactStore: JsonArtifactStore,
  scenario: LabScenario,
): LabControl {
  return {
    execute: async (experiment) => {
      if (scenario === "gvisor-unavailable") {
        throw new LabControlBlockedError("gvisor-unavailable");
      }
      const isWitness = experiment.role === "witness";
      const observation: ExperimentObservation = {
        kind: "experiment-observation",
        schemaVersion: 1,
        experimentId: experiment.experimentId,
        verificationId: experiment.verificationId,
        role: experiment.role,
        hypothesisDigest: experiment.hypothesisDigest,
        bindings:
          scenario === "sibling-mismatch" && !isWitness
            ? {
                ...experiment.bindings,
                configurationDigest: digest("f"),
              }
            : experiment.bindings,
        isolation: {
          runtime: "gvisor",
          runtimeDigest: experiment.bindings.runtimeProfileDigest,
          siblingGroupId: experiment.siblingGroupId,
          labId:
            scenario === "same-lab"
              ? "lab-shared-a"
              : isWitness
                ? "lab-witness-a"
                : "lab-control-a",
          fresh: true,
          fallbackUsed: scenario === "fallback-observed",
        },
        causalFactor: {
          id: experiment.mechanism.causalFactor,
          state: isWitness ? "present" : "removed",
        },
        normalFunction:
          scenario === "evidence-incomplete" && isWitness
            ? "unknown"
            : "preserved",
        result: {
          kind: "stored-xss-browser",
          schemaVersion: 1,
          attackerRequestAccepted: true,
          persistentStateObserved: isWitness,
          browserCanaryExecuted:
            isWitness &&
            (scenario === "broken" || scenario === "sibling-mismatch"),
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
}

async function openVerificationFixture(
  directory: string,
  plan: VerificationPlan,
  scenario: LabScenario,
) {
  const databasePath = join(directory, "research.sqlite");
  const fileArtifactStore = openFileJsonArtifactStore(
    join(directory, "private-artifacts"),
  );
  const artifactStore: JsonArtifactStore =
    scenario === "artifact-mismatch"
      ? {
          putJson: (value) => fileArtifactStore.putJson(value),
          readJson: async () => ({ corrupted: true }),
        }
      : fileArtifactStore;
  const record = openSqliteResearchRecord({
    databasePath,
    clock: () => new Date(fixedNow),
  });
  await prepareCampaign(record, plan);
  const verification = openVerification({
    record,
    artifactStore,
    independentVerifier:
      scenario === "verifier-unavailable" ||
      scenario === "verifier-budget-exhausted"
        ? {
            rederive: async () => {
              throw new IndependentVerifierBlockedError(
                scenario === "verifier-unavailable"
                  ? "verifier-unavailable"
                  : "budget-exhausted",
              );
            },
          }
        : supportedStoredXssVerifier(),
    labControl: storedXssLabControl(artifactStore, scenario),
  });
  return { databasePath, record, verification };
}

async function verifyAndReplay(plan: VerificationPlan, scenario: LabScenario) {
  const directory = await mkdtemp(join(tmpdir(), "verification-outcome-"));
  const { databasePath, record, verification } = await openVerificationFixture(
    directory,
    plan,
    scenario,
  );

  try {
    const ref = await verification.verify(plan);
    record.close();
    const reopened = openSqliteResearchRecord({ databasePath });
    try {
      const replayed = await reopened.readVerification(
        plan.campaignId,
        plan.verificationId,
      );
      return { ref, replayed };
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
}

describe("Verification.verify", () => {
  it("durably records a Finding after a browser Witness and fresh sibling Causal Control", async () => {
    const plan = verificationPlan();
    await expect(verifyAndReplay(plan, "broken")).resolves.toMatchObject({
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
  });

  it("durably records Disproved when the same Causal Identity preserves browser integrity", async () => {
    const plan = verificationPlan({
      campaignId: "campaign-verification-disproved",
      verificationId: "verification-stored-xss-disproved",
    });
    await expect(verifyAndReplay(plan, "preserved")).resolves.toMatchObject({
      ref: {
        kind: "verification-record",
        schemaVersion: 1,
        verificationId: plan.verificationId,
        outcome: "disproved",
      },
      replayed: {
        value: {
          kind: "verification-record",
          schemaVersion: 1,
          verificationId: plan.verificationId,
          campaignId: plan.campaignId,
          outcome: {
            kind: "disproved",
            reason: "security-property-preserved",
            causalIdentity: plan.hypothesis.causalIdentity,
          },
        },
      },
    });
  });

  it("durably records Blocked when gVisor is unavailable", async () => {
    const plan = verificationPlan({
      campaignId: "campaign-verification-blocked",
      verificationId: "verification-stored-xss-blocked",
    });
    await expect(
      verifyAndReplay(plan, "gvisor-unavailable"),
    ).resolves.toMatchObject({
      ref: {
        kind: "verification-record",
        schemaVersion: 1,
        verificationId: plan.verificationId,
        outcome: "blocked",
      },
      replayed: {
        value: {
          kind: "verification-record",
          schemaVersion: 1,
          verificationId: plan.verificationId,
          campaignId: plan.campaignId,
          evidence: {
            kind: "partial",
          },
          outcome: {
            kind: "blocked",
            reason: "gvisor-unavailable",
            causalIdentity: plan.hypothesis.causalIdentity,
          },
        },
      },
    });
  });

  it("durably records Blocked when sibling Lab configurations differ", async () => {
    const plan = verificationPlan({
      campaignId: "campaign-verification-sibling-mismatch",
      verificationId: "verification-stored-xss-sibling-mismatch",
    });
    await expect(
      verifyAndReplay(plan, "sibling-mismatch"),
    ).resolves.toMatchObject({
      ref: {
        kind: "verification-record",
        schemaVersion: 1,
        verificationId: plan.verificationId,
        outcome: "blocked",
      },
      replayed: {
        value: {
          kind: "verification-record",
          schemaVersion: 1,
          verificationId: plan.verificationId,
          campaignId: plan.campaignId,
          outcome: {
            kind: "blocked",
            reason: "sibling-isolation-failed",
            causalIdentity: plan.hypothesis.causalIdentity,
          },
        },
      },
    });
  });

  it("rejects an Experiment artifact digest mismatch instead of recording Blocked", async () => {
    const directory = await mkdtemp(join(tmpdir(), "verification-tampered-"));
    const plan = verificationPlan({
      campaignId: "campaign-verification-tampered",
      verificationId: "verification-stored-xss-tampered",
    });
    const { record, verification } = await openVerificationFixture(
      directory,
      plan,
      "artifact-mismatch",
    );

    try {
      await expect(verification.verify(plan)).rejects.toThrow(
        "Experiment Observation digest mismatch",
      );
    } finally {
      record.close();
      await rm(directory, { force: true, recursive: true });
    }
  });

  it("durably records Blocked when the independent Verifier is unavailable", async () => {
    const plan = verificationPlan({
      campaignId: "campaign-verifier-unavailable",
      verificationId: "verification-verifier-unavailable",
    });
    await expect(
      verifyAndReplay(plan, "verifier-unavailable"),
    ).resolves.toMatchObject({
      ref: {
        kind: "verification-record",
        schemaVersion: 1,
        verificationId: plan.verificationId,
        outcome: "blocked",
      },
      replayed: {
        value: {
          kind: "verification-record",
          schemaVersion: 1,
          verificationId: plan.verificationId,
          campaignId: plan.campaignId,
          evidence: {
            kind: "partial",
          },
          outcome: {
            kind: "blocked",
            reason: "verifier-unavailable",
            causalIdentity: plan.hypothesis.causalIdentity,
          },
        },
      },
    });
  });

  it("durably records Blocked when browser evidence is inconclusive", async () => {
    const plan = verificationPlan({
      campaignId: "campaign-evidence-incomplete",
      verificationId: "verification-evidence-incomplete",
    });
    await expect(
      verifyAndReplay(plan, "evidence-incomplete"),
    ).resolves.toMatchObject({
      ref: {
        kind: "verification-record",
        schemaVersion: 1,
        verificationId: plan.verificationId,
        outcome: "blocked",
      },
      replayed: {
        value: {
          kind: "verification-record",
          schemaVersion: 1,
          verificationId: plan.verificationId,
          campaignId: plan.campaignId,
          outcome: {
            kind: "blocked",
            reason: "evidence-incomplete",
            causalIdentity: plan.hypothesis.causalIdentity,
          },
        },
      },
    });
  });

  it("durably records Blocked when the independent Verifier exhausts its reserved budget", async () => {
    const plan = verificationPlan({
      campaignId: "campaign-verifier-budget-exhausted",
      verificationId: "verification-verifier-budget-exhausted",
    });
    await expect(
      verifyAndReplay(plan, "verifier-budget-exhausted"),
    ).resolves.toMatchObject({
      ref: {
        kind: "verification-record",
        schemaVersion: 1,
        verificationId: plan.verificationId,
        outcome: "blocked",
      },
      replayed: {
        value: {
          kind: "verification-record",
          schemaVersion: 1,
          verificationId: plan.verificationId,
          campaignId: plan.campaignId,
          outcome: {
            kind: "blocked",
            reason: "budget-exhausted",
            causalIdentity: plan.hypothesis.causalIdentity,
          },
        },
      },
    });
  });

  it("durably records non-hermetic Blocked when a Lab reports fallback use", async () => {
    const plan = verificationPlan({
      campaignId: "campaign-fallback-observed",
      verificationId: "verification-fallback-observed",
    });
    await expect(
      verifyAndReplay(plan, "fallback-observed"),
    ).resolves.toMatchObject({
      ref: {
        kind: "verification-record",
        schemaVersion: 1,
        verificationId: plan.verificationId,
        outcome: "blocked",
      },
      replayed: {
        value: {
          kind: "verification-record",
          schemaVersion: 1,
          verificationId: plan.verificationId,
          campaignId: plan.campaignId,
          outcome: {
            kind: "blocked",
            reason: "non-hermetic",
            causalIdentity: plan.hypothesis.causalIdentity,
          },
        },
      },
    });
  });

  it("durably records sibling isolation Blocked when Witness and Control share a Lab", async () => {
    const plan = verificationPlan({
      campaignId: "campaign-shared-lab",
      verificationId: "verification-shared-lab",
    });
    await expect(verifyAndReplay(plan, "same-lab")).resolves.toMatchObject({
      ref: {
        kind: "verification-record",
        schemaVersion: 1,
        verificationId: plan.verificationId,
        outcome: "blocked",
      },
      replayed: {
        value: {
          kind: "verification-record",
          schemaVersion: 1,
          verificationId: plan.verificationId,
          campaignId: plan.campaignId,
          outcome: {
            kind: "blocked",
            reason: "sibling-isolation-failed",
            causalIdentity: plan.hypothesis.causalIdentity,
          },
        },
      },
    });
  });
});
