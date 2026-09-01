import {
  canonicalJson,
  sha256Digest,
} from "../research-record/canonical-json.js";
import {
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

function supportsFinding(
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
    witness.normalFunction === "preserved" &&
    control.normalFunction === "preserved" &&
    witness.result.kind === "stored-xss-browser" &&
    control.result.kind === "stored-xss-browser" &&
    witness.result.attackerRequestAccepted &&
    witness.result.persistentStateObserved &&
    witness.result.browserCanaryExecuted &&
    control.result.attackerRequestAccepted &&
    !control.result.persistentStateObserved &&
    !control.result.browserCanaryExecuted
  );
}

class IndependentVerification implements Verification {
  readonly #options: OpenVerificationOptions;

  constructor(options: OpenVerificationOptions) {
    this.#options = options;
  }

  async verify(value: VerificationPlan): Promise<VerificationRecordRef> {
    const plan = verificationPlanSchema.parse(value);
    const start = await this.#options.record.recordVerificationStart(plan);
    if (start.disposition === "completed") {
      return start.verification.ref;
    }

    const rederivation = sourceRederivationSchema.parse(
      await this.#options.independentVerifier.rederive(plan),
    );
    if (
      rederivation.verificationId !== plan.verificationId ||
      rederivation.targetSnapshotDigest !== plan.targetSnapshot.digest ||
      rederivation.hypothesisDigest !== plan.hypothesisDigest
    ) {
      throw new Error("Independent source re-derivation binding mismatch");
    }

    const rederivationDigest =
      await this.#options.artifactStore.putJson(rederivation);
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
    const witnessRef = experimentObservationRefSchema.parse(
      await this.#options.labControl.execute(witnessPlan),
    );
    const controlRef = experimentObservationRefSchema.parse(
      await this.#options.labControl.execute(controlPlan),
    );
    const witness = await readObservation(
      this.#options.artifactStore,
      witnessRef,
    );
    const control = await readObservation(
      this.#options.artifactStore,
      controlRef,
    );

    if (!supportsFinding(plan, witnessPlan, controlPlan, witness, control)) {
      throw new Error("Verification evidence does not satisfy Finding gates");
    }

    const completed = await this.#options.record.recordVerificationCompletion({
      kind: "verification-completion",
      schemaVersion: 1,
      verificationId: plan.verificationId,
      campaignId: plan.campaignId,
      planDigest: start.planDigest,
      targetSnapshotDigest: plan.targetSnapshot.digest,
      hypothesisDigest: plan.hypothesisDigest,
      sourceRederivation: {
        kind: "source-rederivation",
        schemaVersion: 1,
        digest: rederivationDigest,
      },
      witness: witnessRef,
      control: controlRef,
      outcome: {
        kind: "finding",
        causalIdentity: plan.hypothesis.causalIdentity,
      },
    });
    return completed.ref;
  }
}

export function openVerification(
  options: OpenVerificationOptions,
): Verification {
  return new IndependentVerification(options);
}
