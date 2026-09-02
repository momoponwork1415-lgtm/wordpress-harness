import {
  canonicalJson,
  sha256Digest,
} from "../research-record/canonical-json.js";
import {
  IndependentVerifierBlockedError,
  LabControlBlockedError,
  experimentObservationRefSchema,
  experimentObservationSchema,
  experimentPlanSchema,
  sourceRederivationSchema,
  verificationPlanSchema,
  type ExperimentObservation,
  type ExperimentObservationRef,
  type ExperimentPlan,
  type OpenVerificationOptions,
  type Verification,
  type VerificationBlockReason,
  type VerificationPlan,
  type VerificationRecordRef,
} from "./contracts.js";

function experimentPlan(
  plan: VerificationPlan,
  planDigest: string,
  rederivation: ReturnType<typeof sourceRederivationSchema.parse>,
  role: "witness" | "control",
): ExperimentPlan {
  return experimentPlanSchema.parse({
    kind: "experiment-plan",
    schemaVersion: 1,
    experimentId: sha256Digest({
      kind: "verification-experiment",
      planDigest,
      role,
    }),
    verificationId: plan.verificationId,
    role,
    siblingGroupId: sha256Digest({
      kind: "verification-sibling-group",
      planDigest,
      labBaselineDigest: plan.labBaseline.digest,
    }),
    hypothesisDigest: plan.hypothesisDigest,
    bindings: {
      targetSnapshotDigest: plan.targetSnapshot.digest,
      labBaselineDigest: plan.labBaseline.digest,
      runtimeProfileDigest: plan.labBaseline.runtimeProfileDigest,
      setupPlanDigest: plan.labBaseline.setupPlanDigest,
      configurationDigest: plan.labBaseline.configurationDigest,
      adapterVersion: rederivation.experiment.adapterVersion,
    },
    mechanism: {
      ...rederivation.experiment,
      causalFactorState: role === "witness" ? "present" : "removed",
    },
  });
}

async function readObservation(
  artifactStore: OpenVerificationOptions["artifactStore"],
  value: ExperimentObservationRef,
): Promise<ExperimentObservation> {
  const ref = experimentObservationRefSchema.parse(value);
  const artifact = await artifactStore.readJson(ref.digest);
  if (sha256Digest(artifact) !== ref.digest) {
    throw new Error(`Experiment Observation digest mismatch: ${ref.digest}`);
  }
  const observation = experimentObservationSchema.parse(artifact);
  if (observation.experimentId !== ref.experimentId) {
    throw new Error(`Experiment Observation ref mismatch: ${ref.experimentId}`);
  }
  return observation;
}

function isBoundStoredXssPair(
  plan: VerificationPlan,
  witnessPlan: ExperimentPlan,
  controlPlan: ExperimentPlan,
  witness: ExperimentObservation,
  control: ExperimentObservation,
): boolean {
  const commonBinding = canonicalJson(witnessPlan.bindings);
  return (
    plan.hypothesis.impact === "stored-xss" &&
    witness.experimentId === witnessPlan.experimentId &&
    control.experimentId === controlPlan.experimentId &&
    witness.verificationId === plan.verificationId &&
    control.verificationId === plan.verificationId &&
    witness.hypothesisDigest === plan.hypothesisDigest &&
    control.hypothesisDigest === plan.hypothesisDigest &&
    witness.role === "witness" &&
    control.role === "control" &&
    canonicalJson(witness.bindings) === commonBinding &&
    canonicalJson(control.bindings) === commonBinding &&
    witness.isolation.runtime === "gvisor" &&
    control.isolation.runtime === "gvisor" &&
    witness.isolation.runtimeDigest === control.isolation.runtimeDigest &&
    witness.isolation.runtimeDigest === plan.labBaseline.runtimeProfileDigest &&
    witness.isolation.siblingGroupId === witnessPlan.siblingGroupId &&
    control.isolation.siblingGroupId === witnessPlan.siblingGroupId &&
    witness.isolation.labId !== control.isolation.labId &&
    witness.isolation.fresh &&
    control.isolation.fresh &&
    !witness.isolation.fallbackUsed &&
    !control.isolation.fallbackUsed &&
    witness.causalFactor.id === witnessPlan.mechanism.causalFactor &&
    control.causalFactor.id === witnessPlan.mechanism.causalFactor &&
    witness.causalFactor.state === "present" &&
    control.causalFactor.state === "removed" &&
    witness.result.kind === "stored-xss-browser" &&
    control.result.kind === "stored-xss-browser"
  );
}

function hasCompleteStoredXssEvidence(
  plan: VerificationPlan,
  witnessPlan: ExperimentPlan,
  controlPlan: ExperimentPlan,
  witness: ExperimentObservation,
  control: ExperimentObservation,
): boolean {
  return (
    isBoundStoredXssPair(plan, witnessPlan, controlPlan, witness, control) &&
    witness.normalFunction === "preserved" &&
    control.normalFunction === "preserved" &&
    witness.result.attackerRequestAccepted &&
    control.result.attackerRequestAccepted
  );
}

function supportsFinding(
  plan: VerificationPlan,
  rederivation: ReturnType<typeof sourceRederivationSchema.parse>,
  witnessPlan: ExperimentPlan,
  controlPlan: ExperimentPlan,
  witness: ExperimentObservation,
  control: ExperimentObservation,
): boolean {
  return (
    rederivation.status === "supported" &&
    hasCompleteStoredXssEvidence(
      plan,
      witnessPlan,
      controlPlan,
      witness,
      control,
    ) &&
    witness.result.persistentStateObserved &&
    witness.result.browserCanaryExecuted &&
    !control.result.persistentStateObserved &&
    !control.result.browserCanaryExecuted
  );
}

function supportsDisproved(
  plan: VerificationPlan,
  witnessPlan: ExperimentPlan,
  controlPlan: ExperimentPlan,
  witness: ExperimentObservation,
  control: ExperimentObservation,
): boolean {
  return (
    hasCompleteStoredXssEvidence(
      plan,
      witnessPlan,
      controlPlan,
      witness,
      control,
    ) &&
    !witness.result.browserCanaryExecuted &&
    !control.result.browserCanaryExecuted
  );
}

function hasSiblingIsolationFailure(
  plan: VerificationPlan,
  witnessPlan: ExperimentPlan,
  controlPlan: ExperimentPlan,
  witness: ExperimentObservation,
  control: ExperimentObservation,
): boolean {
  return (
    canonicalJson(witness.bindings) !== canonicalJson(witnessPlan.bindings) ||
    canonicalJson(control.bindings) !== canonicalJson(controlPlan.bindings) ||
    witness.isolation.runtimeDigest !== control.isolation.runtimeDigest ||
    witness.isolation.runtimeDigest !== plan.labBaseline.runtimeProfileDigest ||
    witness.isolation.siblingGroupId !== witnessPlan.siblingGroupId ||
    control.isolation.siblingGroupId !== controlPlan.siblingGroupId ||
    witness.isolation.labId === control.isolation.labId ||
    !witness.isolation.fresh ||
    !control.isolation.fresh
  );
}

function reportsNonHermeticExecution(
  witness: ExperimentObservation,
  control: ExperimentObservation,
): boolean {
  return witness.isolation.fallbackUsed || control.isolation.fallbackUsed;
}

class IndependentVerification implements Verification {
  readonly #options: OpenVerificationOptions;

  constructor(options: OpenVerificationOptions) {
    this.#options = options;
  }

  async #recordBlocked(
    plan: VerificationPlan,
    planDigest: string,
    reason: VerificationBlockReason,
    evidence: {
      readonly sourceRederivationDigest?: string;
      readonly witness?: ExperimentObservationRef;
      readonly control?: ExperimentObservationRef;
    } = {},
  ): Promise<VerificationRecordRef> {
    const blocked = await this.#options.record.recordVerificationCompletion({
      kind: "verification-completion",
      schemaVersion: 1,
      verificationId: plan.verificationId,
      campaignId: plan.campaignId,
      planDigest,
      targetSnapshotDigest: plan.targetSnapshot.digest,
      hypothesisDigest: plan.hypothesisDigest,
      evidence: {
        kind: "partial",
        ...(evidence.sourceRederivationDigest === undefined
          ? {}
          : {
              sourceRederivation: {
                kind: "source-rederivation" as const,
                schemaVersion: 1 as const,
                digest: evidence.sourceRederivationDigest,
              },
            }),
        ...(evidence.witness === undefined
          ? {}
          : { witness: evidence.witness }),
        ...(evidence.control === undefined
          ? {}
          : { control: evidence.control }),
      },
      outcome: {
        kind: "blocked",
        reason,
        causalIdentity: plan.hypothesis.causalIdentity,
      },
    });
    return blocked.ref;
  }

  async verify(value: VerificationPlan): Promise<VerificationRecordRef> {
    const plan = verificationPlanSchema.parse(value);
    const start = await this.#options.record.recordVerificationStart(plan);
    if (start.disposition === "completed") {
      return start.verification.ref;
    }

    let rederivationValue: unknown;
    try {
      rederivationValue =
        await this.#options.independentVerifier.rederive(plan);
    } catch (error) {
      if (!(error instanceof IndependentVerifierBlockedError)) throw error;
      return this.#recordBlocked(plan, start.planDigest, error.reason);
    }
    const rederivation = sourceRederivationSchema.parse(rederivationValue);
    if (
      rederivation.verificationId !== plan.verificationId ||
      rederivation.targetSnapshotDigest !== plan.targetSnapshot.digest ||
      rederivation.hypothesisDigest !== plan.hypothesisDigest
    ) {
      throw new Error("Independent source re-derivation binding mismatch");
    }

    const rederivationDigest =
      await this.#options.artifactStore.putJson(rederivation);
    const sourceRederivationRef = {
      kind: "source-rederivation" as const,
      schemaVersion: 1 as const,
      digest: rederivationDigest,
    };
    const witnessPlan = experimentPlan(
      plan,
      start.planDigest,
      rederivation,
      "witness",
    );
    const controlPlan = experimentPlan(
      plan,
      start.planDigest,
      rederivation,
      "control",
    );
    let witnessRef: ExperimentObservationRef;
    try {
      witnessRef = experimentObservationRefSchema.parse(
        await this.#options.labControl.execute(witnessPlan),
      );
    } catch (error) {
      if (!(error instanceof LabControlBlockedError)) throw error;
      return this.#recordBlocked(plan, start.planDigest, error.reason, {
        sourceRederivationDigest: rederivationDigest,
      });
    }
    let controlRef: ExperimentObservationRef;
    try {
      controlRef = experimentObservationRefSchema.parse(
        await this.#options.labControl.execute(controlPlan),
      );
    } catch (error) {
      if (!(error instanceof LabControlBlockedError)) throw error;
      return this.#recordBlocked(plan, start.planDigest, error.reason, {
        sourceRederivationDigest: rederivationDigest,
        witness: witnessRef,
      });
    }
    const witness = await readObservation(
      this.#options.artifactStore,
      witnessRef,
    );
    const control = await readObservation(
      this.#options.artifactStore,
      controlRef,
    );

    const outcome = supportsFinding(
      plan,
      rederivation,
      witnessPlan,
      controlPlan,
      witness,
      control,
    )
      ? {
          kind: "finding" as const,
          causalIdentity: plan.hypothesis.causalIdentity,
        }
      : supportsDisproved(plan, witnessPlan, controlPlan, witness, control)
        ? {
            kind: "disproved" as const,
            reason: "security-property-preserved" as const,
            causalIdentity: plan.hypothesis.causalIdentity,
          }
        : undefined;
    if (outcome === undefined) {
      if (reportsNonHermeticExecution(witness, control)) {
        return this.#recordBlocked(plan, start.planDigest, "non-hermetic", {
          sourceRederivationDigest: rederivationDigest,
          witness: witnessRef,
          control: controlRef,
        });
      }
      if (
        hasSiblingIsolationFailure(
          plan,
          witnessPlan,
          controlPlan,
          witness,
          control,
        )
      ) {
        return this.#recordBlocked(
          plan,
          start.planDigest,
          "sibling-isolation-failed",
          {
            sourceRederivationDigest: rederivationDigest,
            witness: witnessRef,
            control: controlRef,
          },
        );
      }
      if (
        isBoundStoredXssPair(plan, witnessPlan, controlPlan, witness, control)
      ) {
        return this.#recordBlocked(
          plan,
          start.planDigest,
          "evidence-incomplete",
          {
            sourceRederivationDigest: rederivationDigest,
            witness: witnessRef,
            control: controlRef,
          },
        );
      }
      throw new Error("Verification evidence is inconclusive");
    }

    const completed = await this.#options.record.recordVerificationCompletion({
      kind: "verification-completion",
      schemaVersion: 1,
      verificationId: plan.verificationId,
      campaignId: plan.campaignId,
      planDigest: start.planDigest,
      targetSnapshotDigest: plan.targetSnapshot.digest,
      hypothesisDigest: plan.hypothesisDigest,
      evidence: {
        kind: "experiment-pair",
        sourceRederivation: sourceRederivationRef,
        witness: witnessRef,
        control: controlRef,
      },
      outcome,
    });
    return completed.ref;
  }
}

export function openVerification(
  options: OpenVerificationOptions,
): Verification {
  return new IndependentVerification(options);
}
