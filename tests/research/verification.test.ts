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
  type SourceRederivation,
  type VerificationPlan,
} from "../../src/research/verification/index.js";
import { createCampaignInput } from "../fixtures/campaign.js";

const digest = (character: string): string => `sha256:${character.repeat(64)}`;

const fixedNow = "2026-09-02T00:00:00.000Z";

type LabScenario =
  | "broken"
  | "preserved"
  | "gvisor-unavailable"
  | "control-gvisor-unavailable"
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

function sqlInjectionVerificationPlan(): VerificationPlan {
  const base = verificationPlan({
    campaignId: "campaign-verification-sqli-positive",
    verificationId: "verification-sqli-positive",
  });
  const hypothesis = {
    ...base.hypothesis,
    causalIdentity: {
      rootCause: "request-controlled-identifiers-enter-query-structure",
      attackerControlledPrimitive: "unauthenticated-fields-array",
      brokenSecurityProperty: "sql-query-structure-integrity",
    },
    impact: "sql-injection" as const,
    unknowns: [
      {
        claim: "the database-only canary is returned to the attacker",
        requiredEvidence: "a fresh database readback observation",
      },
    ],
    falsifier: "the requested identifiers are restricted to known fields",
    nextExperiment:
      "compare database canary readback with the structure-changing value removed",
  };
  return {
    ...base,
    hypothesis,
    hypothesisDigest: sha256Digest(hypothesis),
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

function sourceFalsifiedStoredXssVerifier(): IndependentVerifier {
  return {
    rederive: async (input) => ({
      kind: "source-rederivation",
      schemaVersion: 1,
      verificationId: input.verificationId,
      targetSnapshotDigest: input.targetSnapshot.digest,
      hypothesisDigest: input.hypothesisDigest,
      status: "source-falsified",
      falsifiedCondition: input.hypothesis.falsifier,
      sourceEvidence: [
        {
          path: "includes/form-handler.php",
          fileDigest: digest("a"),
          startLine: 40,
          endLine: 91,
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

function supportedSqlInjectionVerifier(): IndependentVerifier {
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
          path: "includes/database.php",
          fileDigest: digest("c"),
          startLine: 80,
          endLine: 140,
        },
      ],
      experiment: {
        kind: "sql-injection-database",
        schemaVersion: 1,
        adapterVersion: "sql-injection-database@v1",
        causalFactor: "request-controlled-query-structure",
        successCriterion: "database-readback-canary",
      },
    }),
  };
}

function sourceFalsifiedSqlInjectionVerifier(): IndependentVerifier {
  return {
    rederive: async (input) => {
      const supported = (await supportedSqlInjectionVerifier().rederive(
        input,
      )) as SourceRederivation;
      return {
        ...supported,
        status: "source-falsified",
        falsifiedCondition: input.hypothesis.falsifier,
      };
    },
  };
}

function sqlInjectionLabControl(
  artifactStore: JsonArtifactStore,
  databaseCanaryObserved = true,
): LabControl {
  return {
    execute: async (experiment) => {
      const isWitness = experiment.role === "witness";
      const observation = {
        kind: "experiment-observation",
        schemaVersion: 1,
        experimentId: experiment.experimentId,
        verificationId: experiment.verificationId,
        role: experiment.role,
        hypothesisDigest: experiment.hypothesisDigest,
        bindings: experiment.bindings,
        isolation: {
          runtime: "gvisor",
          runtimeDigest: experiment.bindings.runtimeProfileDigest,
          siblingGroupId: experiment.siblingGroupId,
          labId: isWitness ? "lab-sqli-witness-a" : "lab-sqli-control-a",
          fresh: true,
          fallbackUsed: false,
        },
        causalFactor: {
          id: experiment.mechanism.causalFactor,
          state: isWitness ? "present" : "removed",
        },
        normalFunction: "preserved",
        result: {
          kind: "sql-injection-database",
          schemaVersion: 1,
          attackerRequestAccepted: true,
          databaseReadbackCanaryObserved: isWitness && databaseCanaryObserved,
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

async function verifySqlInjectionAndReplay(
  plan: VerificationPlan,
  options: {
    readonly independentVerifier: IndependentVerifier;
    readonly databaseCanaryObserved: boolean;
  },
) {
  const directory = await mkdtemp(join(tmpdir(), "verification-sqli-"));
  const databasePath = join(directory, "research.sqlite");
  const artifactStore = openFileJsonArtifactStore(
    join(directory, "private-artifacts"),
  );
  const record = openSqliteResearchRecord({
    databasePath,
    clock: () => new Date(fixedNow),
  });
  await prepareCampaign(record, plan);
  const verification = openVerification({
    record,
    artifactStore,
    independentVerifier: options.independentVerifier,
    labControl: sqlInjectionLabControl(
      artifactStore,
      options.databaseCanaryObserved,
    ),
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
      return { ref, replayed };
    } finally {
      reopened.close();
    }
  } finally {
    try {
      record.close();
    } catch {
      // The successful path closes before replaying the same database.
    }
    await rm(directory, { force: true, recursive: true });
  }
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
      if (scenario === "control-gvisor-unavailable" && !isWitness) {
        throw new LabControlBlockedError("gvisor-unavailable");
      }
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
  independentVerifier?: IndependentVerifier,
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
        : (independentVerifier ?? supportedStoredXssVerifier()),
    labControl: storedXssLabControl(artifactStore, scenario),
  });
  return { databasePath, record, verification };
}

async function verifyAndReplay(
  plan: VerificationPlan,
  scenario: LabScenario,
  independentVerifier?: IndependentVerifier,
) {
  const directory = await mkdtemp(join(tmpdir(), "verification-outcome-"));
  const { databasePath, record, verification } = await openVerificationFixture(
    directory,
    plan,
    scenario,
    independentVerifier,
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
  it("durably records a Finding after a database readback Witness and fresh sibling Causal Control", async () => {
    const plan = sqlInjectionVerificationPlan();
    await expect(
      verifySqlInjectionAndReplay(plan, {
        databaseCanaryObserved: true,
        independentVerifier: supportedSqlInjectionVerifier(),
      }),
    ).resolves.toMatchObject({
      ref: { outcome: "finding" },
      replayed: {
        value: {
          outcome: {
            kind: "finding",
            causalIdentity: plan.hypothesis.causalIdentity,
          },
          evidence: { kind: "experiment-pair" },
        },
      },
    });
  });

  it("durably records Disproved for the same SQLi Causal Identity when the patched source and fresh sibling labs preserve query integrity", async () => {
    const plan = sqlInjectionVerificationPlan();
    await expect(
      verifySqlInjectionAndReplay(plan, {
        databaseCanaryObserved: false,
        independentVerifier: sourceFalsifiedSqlInjectionVerifier(),
      }),
    ).resolves.toMatchObject({
      ref: { outcome: "disproved" },
      replayed: {
        value: {
          outcome: {
            kind: "disproved",
            reason: "security-property-preserved",
            causalIdentity: plan.hypothesis.causalIdentity,
          },
          evidence: { kind: "experiment-pair" },
        },
      },
    });
  });

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

  it("restarts source re-derivation and the sibling pair after a crash before Witness", async () => {
    const directory = await mkdtemp(join(tmpdir(), "verification-recovery-"));
    const databasePath = join(directory, "research.sqlite");
    const artifactStore = openFileJsonArtifactStore(
      join(directory, "private-artifacts"),
    );
    const plan = verificationPlan({
      campaignId: "campaign-recovery-before-witness",
      verificationId: "verification-recovery-before-witness",
    });
    const firstRecord = openSqliteResearchRecord({ databasePath });
    await prepareCampaign(firstRecord, plan);
    let firstRederivations = 0;
    const firstVerification = openVerification({
      record: firstRecord,
      artifactStore,
      independentVerifier: {
        rederive: async (input) => {
          firstRederivations += 1;
          return supportedStoredXssVerifier().rederive(input);
        },
      },
      labControl: {
        execute: async () => {
          throw new Error("simulated process crash before Witness");
        },
      },
    });

    try {
      await expect(firstVerification.verify(plan)).rejects.toThrow(
        "simulated process crash before Witness",
      );
    } finally {
      firstRecord.close();
    }

    const resumedRecord = openSqliteResearchRecord({ databasePath });
    let resumedRederivations = 0;
    const resumedRoles: string[] = [];
    const resumedLab = storedXssLabControl(artifactStore, "broken");
    const resumedVerification = openVerification({
      record: resumedRecord,
      artifactStore,
      independentVerifier: {
        rederive: async (input) => {
          resumedRederivations += 1;
          return supportedStoredXssVerifier().rederive(input);
        },
      },
      labControl: {
        execute: async (experiment) => {
          resumedRoles.push(experiment.role);
          return resumedLab.execute(experiment);
        },
      },
    });

    try {
      await expect(resumedVerification.verify(plan)).resolves.toMatchObject({
        outcome: "finding",
      });
      await expect(
        resumedRecord.readVerification(plan.campaignId, plan.verificationId),
      ).resolves.toMatchObject({ value: { outcome: { kind: "finding" } } });
      expect({
        firstRederivations,
        resumedRederivations,
        resumedRoles,
      }).toEqual({
        firstRederivations: 1,
        resumedRederivations: 1,
        resumedRoles: ["witness", "control"],
      });
    } finally {
      resumedRecord.close();
      await rm(directory, { force: true, recursive: true });
    }
  });

  it("discards a partial Witness and runs a fresh sibling pair after recovery", async () => {
    const directory = await mkdtemp(join(tmpdir(), "verification-recovery-"));
    const databasePath = join(directory, "research.sqlite");
    const artifactStore = openFileJsonArtifactStore(
      join(directory, "private-artifacts"),
    );
    const plan = verificationPlan({
      campaignId: "campaign-recovery-after-witness",
      verificationId: "verification-recovery-after-witness",
    });
    const firstRecord = openSqliteResearchRecord({ databasePath });
    await prepareCampaign(firstRecord, plan);
    const firstLab = storedXssLabControl(artifactStore, "broken");
    const firstRoles: string[] = [];
    const firstVerification = openVerification({
      record: firstRecord,
      artifactStore,
      independentVerifier: supportedStoredXssVerifier(),
      labControl: {
        execute: async (experiment) => {
          firstRoles.push(experiment.role);
          if (experiment.role === "control") {
            throw new Error("simulated process crash before Control");
          }
          return firstLab.execute(experiment);
        },
      },
    });

    try {
      await expect(firstVerification.verify(plan)).rejects.toThrow(
        "simulated process crash before Control",
      );
    } finally {
      firstRecord.close();
    }

    const resumedRecord = openSqliteResearchRecord({ databasePath });
    const resumedLab = storedXssLabControl(artifactStore, "broken");
    const resumedRoles: string[] = [];
    const resumedVerification = openVerification({
      record: resumedRecord,
      artifactStore,
      independentVerifier: supportedStoredXssVerifier(),
      labControl: {
        execute: async (experiment) => {
          resumedRoles.push(experiment.role);
          return resumedLab.execute(experiment);
        },
      },
    });

    try {
      await expect(resumedVerification.verify(plan)).resolves.toMatchObject({
        outcome: "finding",
      });
      expect({ firstRoles, resumedRoles }).toEqual({
        firstRoles: ["witness", "control"],
        resumedRoles: ["witness", "control"],
      });
    } finally {
      resumedRecord.close();
      await rm(directory, { force: true, recursive: true });
    }
  });

  it("replays a completed Verification without calling external adapters", async () => {
    const directory = await mkdtemp(join(tmpdir(), "verification-replay-"));
    const databasePath = join(directory, "research.sqlite");
    const artifactStore = openFileJsonArtifactStore(
      join(directory, "private-artifacts"),
    );
    const plan = verificationPlan({
      campaignId: "campaign-completed-replay",
      verificationId: "verification-completed-replay",
    });
    const firstRecord = openSqliteResearchRecord({ databasePath });
    await prepareCampaign(firstRecord, plan);
    const firstVerification = openVerification({
      record: firstRecord,
      artifactStore,
      independentVerifier: supportedStoredXssVerifier(),
      labControl: storedXssLabControl(artifactStore, "broken"),
    });
    const firstRef = await firstVerification.verify(plan);
    firstRecord.close();

    const replayRecord = openSqliteResearchRecord({ databasePath });
    const replayVerification = openVerification({
      record: replayRecord,
      artifactStore,
      independentVerifier: {
        rederive: async () => {
          throw new Error("completed Verification called the Verifier");
        },
      },
      labControl: {
        execute: async () => {
          throw new Error("completed Verification called the Lab");
        },
      },
    });

    try {
      await expect(replayVerification.verify(plan)).resolves.toEqual(firstRef);
    } finally {
      replayRecord.close();
      await rm(directory, { force: true, recursive: true });
    }
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

  it("confirms an evidence-bearing source falsifier with a preserved browser pair", async () => {
    const plan = verificationPlan({
      campaignId: "campaign-source-falsified-disproved",
      verificationId: "verification-source-falsified-disproved",
    });
    await expect(
      verifyAndReplay(plan, "preserved", sourceFalsifiedStoredXssVerifier()),
    ).resolves.toMatchObject({
      ref: { outcome: "disproved" },
      replayed: {
        value: {
          outcome: {
            kind: "disproved",
            reason: "security-property-preserved",
          },
          evidence: { kind: "experiment-pair" },
        },
      },
    });
  });

  it("does not promote a Finding when source and browser evidence conflict", async () => {
    const plan = verificationPlan({
      campaignId: "campaign-source-falsified-conflict",
      verificationId: "verification-source-falsified-conflict",
    });
    await expect(
      verifyAndReplay(plan, "broken", sourceFalsifiedStoredXssVerifier()),
    ).resolves.toMatchObject({
      ref: { outcome: "blocked" },
      replayed: {
        value: {
          outcome: { kind: "blocked", reason: "evidence-incomplete" },
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

  it("preserves the completed Witness when the sibling Control is blocked", async () => {
    const plan = verificationPlan({
      campaignId: "campaign-verification-control-blocked",
      verificationId: "verification-stored-xss-control-blocked",
    });
    const result = await verifyAndReplay(plan, "control-gvisor-unavailable");
    expect(result).toMatchObject({
      ref: { outcome: "blocked" },
      replayed: {
        value: {
          evidence: {
            kind: "partial",
            sourceRederivation: {},
            witness: {
              kind: "experiment-observation",
              schemaVersion: 1,
            },
          },
          outcome: { kind: "blocked", reason: "gvisor-unavailable" },
        },
      },
    });
    expect(result.replayed?.value.evidence).not.toHaveProperty("control");
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
