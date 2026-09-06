import {
  canonicalJson,
  sha256Digest,
} from "../research-record/canonical-json.js";
import {
  openVerifiedArtifacts,
  type VerifiedArtifacts,
} from "../research-record/verified-artifacts.js";
import {
  IndependentVerifierBlockedError,
  LabControlBlockedError,
  experimentObservationRefSchema,
  experimentObservationSchema,
  experimentPlanSchema,
  independentVerifierResultSchema,
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
import type { ModelAttemptUsageV2 } from "../model-attempt-usage-contracts.js";

function experimentPlan(
  plan: VerificationPlan,
  planDigest: string,
  rederivation: ReturnType<typeof sourceRederivationSchema.parse>,
  rederivationDigest: string,
  role: "witness" | "control",
): ExperimentPlan {
  return experimentPlanSchema.parse({
    kind: "experiment-plan",
    schemaVersion: 1,
    experimentId: sha256Digest({
      kind: "verification-experiment",
      planDigest,
      sourceRederivationDigest: rederivationDigest,
      role,
    }),
    verificationId: plan.verificationId,
    role,
    siblingGroupId: sha256Digest({
      kind: "verification-sibling-group",
      planDigest,
      sourceRederivationDigest: rederivationDigest,
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

function requireVerifierUsage(
  usage: ModelAttemptUsageV2 | undefined,
): ModelAttemptUsageV2 {
  if (usage === undefined) {
    throw new Error("Verification v2 completed without Verifier usage");
  }
  return usage;
}

function isBoundExperimentPair(
  plan: VerificationPlan,
  witnessPlan: ExperimentPlan,
  controlPlan: ExperimentPlan,
  witness: ExperimentObservation,
  control: ExperimentObservation,
): boolean {
  const commonBinding = canonicalJson(witnessPlan.bindings);
  const mechanismMatchesImpact =
    (plan.hypothesis.impact === "stored-xss" &&
      witnessPlan.mechanism.kind === "stored-xss-browser" &&
      controlPlan.mechanism.kind === "stored-xss-browser" &&
      witness.result.kind === "stored-xss-browser" &&
      control.result.kind === "stored-xss-browser") ||
    ((plan.hypothesis.impact === "stored-xss" ||
      plan.hypothesis.impact === "reflected-xss" ||
      plan.hypothesis.impact === "dom-xss") &&
      witnessPlan.mechanism.kind === "browser-script-execution" &&
      controlPlan.mechanism.kind === "browser-script-execution" &&
      witness.result.kind === "browser-script-execution" &&
      control.result.kind === "browser-script-execution") ||
    (plan.hypothesis.impact === "sql-injection" &&
      witnessPlan.mechanism.kind === "sql-injection-database" &&
      controlPlan.mechanism.kind === "sql-injection-database" &&
      witness.result.kind === "sql-injection-database" &&
      control.result.kind === "sql-injection-database") ||
    (plan.hypothesis.impact === "sql-injection" &&
      witnessPlan.mechanism.kind === "sql-query-semantic-effect" &&
      controlPlan.mechanism.kind === "sql-query-semantic-effect" &&
      witness.result.kind === "sql-query-semantic-effect" &&
      control.result.kind === "sql-query-semantic-effect") ||
    (plan.hypothesis.impact === "account-takeover" &&
      witnessPlan.mechanism.kind === "authentication-state-transition" &&
      controlPlan.mechanism.kind === "authentication-state-transition" &&
      witness.result.kind === "authentication-state-transition" &&
      control.result.kind === "authentication-state-transition");
  return (
    mechanismMatchesImpact &&
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
    control.causalFactor.state === "removed"
  );
}

function hasCompleteExperimentEvidence(
  plan: VerificationPlan,
  witnessPlan: ExperimentPlan,
  controlPlan: ExperimentPlan,
  witness: ExperimentObservation,
  control: ExperimentObservation,
): boolean {
  return (
    isBoundExperimentPair(plan, witnessPlan, controlPlan, witness, control) &&
    witness.normalFunction === "preserved" &&
    control.normalFunction === "preserved" &&
    ("attackerSequenceExecuted" in witness.result
      ? witness.result.attackerSequenceExecuted
      : witness.result.attackerRequestAccepted) &&
    ("attackerSequenceExecuted" in control.result
      ? control.result.attackerSequenceExecuted
      : control.result.attackerRequestAccepted)
  );
}

type MechanismEvidenceState = "finding" | "disproved" | "inconclusive";

function sqlQueryEffectObserved(
  plan: Extract<
    ExperimentPlan["mechanism"],
    { kind: "sql-query-semantic-effect" }
  >,
  observation: Extract<
    ExperimentObservation["result"],
    { kind: "sql-query-semantic-effect" }
  >,
): boolean | undefined {
  if (plan.effect.kind !== observation.effect.kind) return undefined;
  switch (observation.effect.kind) {
    case "database-readback-canary":
    case "database-state-change-canary":
      return observation.effect.observed;
    case "http-response-differential":
      return observation.effect.relationObserved;
    case "timing-differential":
      if (
        plan.effect.kind !== "timing-differential" ||
        observation.effect.sampleCount < plan.effect.minimumSamples
      ) {
        return undefined;
      }
      return observation.effect.medianDeltaMs >= plan.effect.minimumDeltaMs;
    case "target-account-authentication-canary":
      return observation.effect.attackerContextInitiallyAuthenticated
        ? undefined
        : observation.effect.targetAccountAuthenticationObserved;
  }
}

function mechanismEvidenceState(
  witnessPlan: ExperimentPlan,
  witness: ExperimentObservation,
  control: ExperimentObservation,
): MechanismEvidenceState {
  if (
    witness.result.kind === "stored-xss-browser" &&
    control.result.kind === "stored-xss-browser"
  ) {
    if (
      witness.result.persistentStateObserved &&
      witness.result.browserCanaryExecuted &&
      !control.result.persistentStateObserved &&
      !control.result.browserCanaryExecuted
    ) {
      return "finding";
    }
    return !witness.result.browserCanaryExecuted &&
      !control.result.browserCanaryExecuted
      ? "disproved"
      : "inconclusive";
  }
  if (
    witnessPlan.mechanism.kind === "browser-script-execution" &&
    witness.result.kind === "browser-script-execution" &&
    control.result.kind === "browser-script-execution"
  ) {
    if (
      !witness.result.victimContextEstablished ||
      !control.result.victimContextEstablished
    ) {
      return "inconclusive";
    }
    if (
      witness.result.browserCanaryExecuted &&
      !control.result.browserCanaryExecuted
    ) {
      return "finding";
    }
    return !witness.result.browserCanaryExecuted &&
      !control.result.browserCanaryExecuted
      ? "disproved"
      : "inconclusive";
  }
  if (
    witness.result.kind === "sql-injection-database" &&
    control.result.kind === "sql-injection-database"
  ) {
    if (
      witness.result.databaseReadbackCanaryObserved &&
      !control.result.databaseReadbackCanaryObserved
    ) {
      return "finding";
    }
    return !witness.result.databaseReadbackCanaryObserved &&
      !control.result.databaseReadbackCanaryObserved
      ? "disproved"
      : "inconclusive";
  }
  if (
    witnessPlan.mechanism.kind === "sql-query-semantic-effect" &&
    witness.result.kind === "sql-query-semantic-effect" &&
    control.result.kind === "sql-query-semantic-effect"
  ) {
    const witnessEffect = sqlQueryEffectObserved(
      witnessPlan.mechanism,
      witness.result,
    );
    const controlEffect = sqlQueryEffectObserved(
      witnessPlan.mechanism,
      control.result,
    );
    if (witnessEffect === true && controlEffect === false) return "finding";
    if (witnessEffect === false && controlEffect === false) return "disproved";
    return "inconclusive";
  }
  if (
    witness.result.kind === "authentication-state-transition" &&
    control.result.kind === "authentication-state-transition"
  ) {
    if (
      !witness.result.attackerContextInitiallyAuthenticated &&
      !control.result.attackerContextInitiallyAuthenticated &&
      witness.result.targetAccountAuthenticationObserved &&
      !control.result.targetAccountAuthenticationObserved
    ) {
      return "finding";
    }
    return !witness.result.attackerContextInitiallyAuthenticated &&
      !control.result.attackerContextInitiallyAuthenticated &&
      !witness.result.targetAccountAuthenticationObserved &&
      !control.result.targetAccountAuthenticationObserved
      ? "disproved"
      : "inconclusive";
  }
  return "inconclusive";
}

function supportsFinding(
  plan: VerificationPlan,
  rederivation: ReturnType<typeof sourceRederivationSchema.parse>,
  witnessPlan: ExperimentPlan,
  controlPlan: ExperimentPlan,
  witness: ExperimentObservation,
  control: ExperimentObservation,
): boolean {
  if (
    rederivation.status !== "supported" ||
    !hasCompleteExperimentEvidence(
      plan,
      witnessPlan,
      controlPlan,
      witness,
      control,
    )
  ) {
    return false;
  }
  return mechanismEvidenceState(witnessPlan, witness, control) === "finding";
}

function supportsDisproved(
  plan: VerificationPlan,
  witnessPlan: ExperimentPlan,
  controlPlan: ExperimentPlan,
  witness: ExperimentObservation,
  control: ExperimentObservation,
): boolean {
  if (
    !hasCompleteExperimentEvidence(
      plan,
      witnessPlan,
      controlPlan,
      witness,
      control,
    )
  ) {
    return false;
  }
  return mechanismEvidenceState(witnessPlan, witness, control) === "disproved";
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
  readonly #artifacts: VerifiedArtifacts;

  constructor(options: OpenVerificationOptions) {
    this.#options = options;
    this.#artifacts = openVerifiedArtifacts(options.artifactStore);
  }

  async #recordBlocked(
    plan: VerificationPlan,
    planDigest: string,
    reason: VerificationBlockReason,
    evidence: {
      readonly sourceRederivationDigest?: string;
      readonly witness?: ExperimentObservationRef;
      readonly control?: ExperimentObservationRef;
      readonly verifierUsage?: ModelAttemptUsageV2;
    } = {},
  ): Promise<VerificationRecordRef> {
    const partialEvidence = {
      kind: "partial" as const,
      ...(evidence.sourceRederivationDigest === undefined
        ? {}
        : {
            sourceRederivation: {
              kind: "source-rederivation" as const,
              schemaVersion: 1 as const,
              digest: evidence.sourceRederivationDigest,
            },
          }),
      ...(evidence.witness === undefined ? {} : { witness: evidence.witness }),
      ...(evidence.control === undefined ? {} : { control: evidence.control }),
    };
    const identity = {
      kind: "verification-completion",
      verificationId: plan.verificationId,
      campaignId: plan.campaignId,
      planDigest,
      targetSnapshotDigest: plan.targetSnapshot.digest,
      hypothesisDigest: plan.hypothesisDigest,
      outcome: {
        kind: "blocked",
        reason,
        causalIdentity: plan.hypothesis.causalIdentity,
      },
    } as const;
    const blocked = await this.#options.record.recordVerificationCompletion(
      plan.schemaVersion === 2
        ? {
            ...identity,
            schemaVersion: 2,
            evidence: {
              ...partialEvidence,
              ...(evidence.verifierUsage === undefined
                ? {}
                : { verifierUsage: evidence.verifierUsage }),
            },
          }
        : { ...identity, schemaVersion: 1, evidence: partialEvidence },
    );
    return blocked.ref;
  }

  async verify(value: VerificationPlan): Promise<VerificationRecordRef> {
    const plan = verificationPlanSchema.parse(value);
    const start = await this.#options.record.recordVerificationStart(plan);
    if (start.disposition === "completed") {
      return start.verification.ref;
    }

    let rederivationValue: unknown;
    let verifierUsage: ModelAttemptUsageV2 | undefined;
    try {
      const verifierResult =
        await this.#options.independentVerifier.rederive(plan);
      if (plan.schemaVersion === 2) {
        const parsedResult =
          independentVerifierResultSchema.safeParse(verifierResult);
        if (!parsedResult.success) {
          return this.#recordBlocked(
            plan,
            start.planDigest,
            "verifier-usage-incomplete",
          );
        }
        const parsed = parsedResult.data;
        rederivationValue = parsed.decision;
        verifierUsage = parsed.usage;
        if (
          verifierUsage.measurement !== "reported" ||
          verifierUsage.estimatedCostUsd === undefined
        ) {
          return this.#recordBlocked(
            plan,
            start.planDigest,
            "verifier-usage-incomplete",
            { verifierUsage },
          );
        }
        if (
          (plan.budget.reportedUsageEnforcement !== "telemetry-only" &&
            (verifierUsage.modelTurns > plan.budget.maxModelTurns ||
              verifierUsage.modelTokens.total > plan.budget.maxModelTokens)) ||
          verifierUsage.estimatedCostUsd > plan.budget.maxProviderCostUsd
        ) {
          return this.#recordBlocked(
            plan,
            start.planDigest,
            "budget-exhausted",
            { verifierUsage },
          );
        }
      } else {
        rederivationValue = verifierResult;
      }
    } catch (error) {
      if (!(error instanceof IndependentVerifierBlockedError)) throw error;
      return this.#recordBlocked(plan, start.planDigest, error.reason, {
        ...(error.usage === undefined ? {} : { verifierUsage: error.usage }),
      });
    }
    const rederivation = sourceRederivationSchema.parse(rederivationValue);
    if (
      rederivation.verificationId !== plan.verificationId ||
      rederivation.targetSnapshotDigest !== plan.targetSnapshot.digest ||
      rederivation.hypothesisDigest !== plan.hypothesisDigest
    ) {
      throw new Error("Independent source re-derivation binding mismatch");
    }

    const rederivationDigest = await this.#artifacts.put(
      "Source Rederivation",
      rederivation,
    );
    const sourceRederivationRef = {
      kind: "source-rederivation" as const,
      schemaVersion: 1 as const,
      digest: rederivationDigest,
    };
    const witnessPlan = experimentPlan(
      plan,
      start.planDigest,
      rederivation,
      rederivationDigest,
      "witness",
    );
    const controlPlan = experimentPlan(
      plan,
      start.planDigest,
      rederivation,
      rederivationDigest,
      "control",
    );
    let witnessRef: ExperimentObservationRef;
    try {
      witnessRef = experimentObservationRefSchema.parse(
        await this.#options.labControl.execute({
          kind: "experiment-execution-request",
          schemaVersion: 1,
          plan: witnessPlan,
          sourceRederivation: rederivation,
          sourceRederivationDigest: rederivationDigest,
        }),
      );
    } catch (error) {
      if (!(error instanceof LabControlBlockedError)) throw error;
      return this.#recordBlocked(plan, start.planDigest, error.reason, {
        sourceRederivationDigest: rederivationDigest,
        ...(verifierUsage === undefined ? {} : { verifierUsage }),
      });
    }
    let controlRef: ExperimentObservationRef;
    try {
      controlRef = experimentObservationRefSchema.parse(
        await this.#options.labControl.execute({
          kind: "experiment-execution-request",
          schemaVersion: 1,
          plan: controlPlan,
          sourceRederivation: rederivation,
          sourceRederivationDigest: rederivationDigest,
        }),
      );
    } catch (error) {
      if (!(error instanceof LabControlBlockedError)) throw error;
      return this.#recordBlocked(plan, start.planDigest, error.reason, {
        sourceRederivationDigest: rederivationDigest,
        witness: witnessRef,
        ...(verifierUsage === undefined ? {} : { verifierUsage }),
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
          ...(verifierUsage === undefined ? {} : { verifierUsage }),
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
            ...(verifierUsage === undefined ? {} : { verifierUsage }),
          },
        );
      }
      if (
        isBoundExperimentPair(plan, witnessPlan, controlPlan, witness, control)
      ) {
        return this.#recordBlocked(
          plan,
          start.planDigest,
          "evidence-incomplete",
          {
            sourceRederivationDigest: rederivationDigest,
            witness: witnessRef,
            control: controlRef,
            ...(verifierUsage === undefined ? {} : { verifierUsage }),
          },
        );
      }
      throw new Error("Verification evidence is inconclusive");
    }
    const completionIdentity = {
      kind: "verification-completion",
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
    } as const;
    const completed =
      plan.schemaVersion === 2
        ? await this.#options.record.recordVerificationCompletion({
            ...completionIdentity,
            schemaVersion: 2,
            evidence: {
              ...completionIdentity.evidence,
              verifierUsage: requireVerifierUsage(verifierUsage),
            },
          })
        : await this.#options.record.recordVerificationCompletion({
            ...completionIdentity,
            schemaVersion: 1,
          });
    return completed.ref;
  }
}

export function openVerification(
  options: OpenVerificationOptions,
): Verification {
  return new IndependentVerification(options);
}
