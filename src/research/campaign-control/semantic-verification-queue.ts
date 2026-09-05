import {
  sourceBoundHypothesisArtifactSchema,
  type SemanticFinderCheckpointRef,
} from "../exploration/semantic-contracts.js";
import {
  canonicalJson,
  sha256Digest,
} from "../research-record/canonical-json.js";
import type { ResearchRecord } from "../research-record/index.js";
import {
  openVerification,
  type VerificationRecordRef,
} from "../verification/index.js";
import type {
  CampaignExecutionDependencies,
  DefaultSemanticCampaignRunPlanV2,
} from "./contracts.js";

type SemanticCheckpointSubject = SemanticFinderCheckpointRef["subject"];

export interface SemanticVerificationQueueSnapshot {
  readonly refs: readonly VerificationRecordRef[];
  readonly unsupportedHypothesis: boolean;
  readonly budgetExhausted: boolean;
  readonly verifierModelTokens: number;
  readonly verifierEstimatedCostUsd: number;
  readonly verificationWallTimeMs: number;
}

export interface SemanticVerificationQueue {
  enqueue(subject: SemanticCheckpointSubject): void;
  drain(): Promise<void>;
  snapshot(): SemanticVerificationQueueSnapshot;
}

export function openSemanticVerificationQueue(
  record: ResearchRecord,
  dependencies: CampaignExecutionDependencies,
  plan: DefaultSemanticCampaignRunPlanV2,
): SemanticVerificationQueue {
  const verification = openVerification({
    record,
    artifactStore: dependencies.artifactStore,
    independentVerifier: dependencies.independentVerifier,
    labControl: dependencies.labControl,
  });
  const maximumVerifierAttempts = Math.min(
    plan.verification.budget.maxVerifierAttempts,
    plan.budgetPolicy.verificationReserve.maxVerifierAttempts,
  );
  const tasks = new Map<string, Promise<void>>();
  const refs: VerificationRecordRef[] = [];
  let pending = Promise.resolve();
  let unsupportedHypothesis = false;
  let budgetExhausted = false;
  let verifierModelTokens = 0;
  let verifierEstimatedCostUsd = 0;
  let verificationWallTimeMs = 0;
  let verifierAttempts = 0;

  const execute = async (
    subject: Extract<
      SemanticCheckpointSubject,
      { kind: "source-bound-hypothesis" }
    >,
  ): Promise<void> => {
    if (verifierAttempts >= maximumVerifierAttempts) {
      budgetExhausted = true;
      return;
    }
    const artifactInput = await dependencies.artifactStore.readJson(
      subject.digest,
    );
    if (sha256Digest(artifactInput) !== subject.digest) {
      throw new Error(`Verification Hypothesis CAS mismatch: ${subject.id}`);
    }
    const artifact = sourceBoundHypothesisArtifactSchema.parse(artifactInput);
    if (
      artifact.id !== subject.id ||
      artifact.attemptId !== subject.attemptId ||
      artifact.leaseId !== subject.leaseId ||
      artifact.workWave.digest !== subject.workWaveDigest ||
      artifact.target.digest !== subject.targetSnapshotDigest ||
      artifact.manifest.digest !== subject.manifestDigest ||
      canonicalJson(artifact.target) !== canonicalJson(plan.target) ||
      canonicalJson(artifact.manifest) !== canonicalJson(plan.manifest)
    ) {
      throw new Error(`Verification Hypothesis ref mismatch: ${subject.id}`);
    }
    if (artifact.value.attackerPremise === "unresolved") {
      unsupportedHypothesis = true;
      return;
    }
    const verificationId = `verification:${subject.id.slice("sha256:".length)}`;
    const hypothesisDigest = sha256Digest(artifact.value);
    const existingVerification = await record.readVerification(
      plan.campaignId,
      verificationId,
    );
    if (existingVerification !== undefined) {
      if (
        existingVerification.value.targetSnapshotDigest !==
          plan.target.digest ||
        existingVerification.value.hypothesisDigest !== hypothesisDigest
      ) {
        throw new Error(
          `Verification semantic identity mismatch: ${verificationId}`,
        );
      }
      refs.push(existingVerification.ref);
      return;
    }

    const configuredBudget = plan.verification.budget;
    const remainingVerificationWallTimeMs =
      plan.budgetPolicy.verificationReserve.maxWallTimeMs -
      verificationWallTimeMs;
    const remainingVerificationCostUsd =
      "maxProviderCostUsd" in plan.budgetPolicy.verificationReserve
        ? plan.budgetPolicy.verificationReserve.maxProviderCostUsd -
          verifierEstimatedCostUsd
        : undefined;
    const verificationBudget =
      "schemaVersion" in configuredBudget
        ? {
            ...configuredBudget,
            maxWallTimeMs: Math.min(
              configuredBudget.maxWallTimeMs,
              remainingVerificationWallTimeMs,
            ),
            maxModelTokens:
              configuredBudget.reportedUsageEnforcement === "telemetry-only"
                ? configuredBudget.maxModelTokens
                : Math.min(
                    configuredBudget.maxModelTokens,
                    plan.budgetPolicy.verificationReserve.maxModelTokens -
                      verifierModelTokens,
                  ),
            ...(remainingVerificationCostUsd === undefined
              ? {}
              : {
                  maxProviderCostUsd: Math.min(
                    configuredBudget.maxProviderCostUsd,
                    remainingVerificationCostUsd,
                  ),
                }),
          }
        : configuredBudget;
    if (
      "schemaVersion" in verificationBudget &&
      (verificationBudget.maxWallTimeMs <= 0 ||
        (verificationBudget.reportedUsageEnforcement !== "telemetry-only" &&
          verificationBudget.maxModelTokens <= 0) ||
        verificationBudget.maxProviderCostUsd <= 0)
    ) {
      budgetExhausted = true;
      return;
    }

    verifierAttempts += 1;
    const verificationPlan = {
      kind: "verification-plan",
      verificationId,
      campaignId: plan.campaignId,
      targetSnapshot: plan.target,
      scope: { permittedAttacker: artifact.value.attackerPremise },
      hypothesis: artifact.value,
      hypothesisDigest,
      labBaseline: plan.verification.labBaseline,
      verifierModelProfile: plan.verification.verifierModelProfile,
      promptSet: plan.verification.promptSet,
      verificationPolicy: plan.verification.verificationPolicy,
      experimentRegistry: plan.verification.experimentRegistry,
    } as const;
    const verificationStartedAt = performance.now();
    const ref = await verification.verify(
      "schemaVersion" in verificationBudget
        ? {
            ...verificationPlan,
            schemaVersion: 2,
            manifest: plan.manifest,
            budget: verificationBudget,
          }
        : {
            ...verificationPlan,
            schemaVersion: 1,
            budget: verificationBudget,
          },
    );
    verificationWallTimeMs += Math.ceil(
      performance.now() - verificationStartedAt,
    );
    refs.push(ref);
    const recorded = await record.readVerification(
      plan.campaignId,
      verificationId,
    );
    if (recorded === undefined) {
      throw new Error(`Verification record is missing: ${verificationId}`);
    }
    if (
      recorded.value.schemaVersion === 2 &&
      recorded.value.evidence.verifierUsage !== undefined
    ) {
      verifierModelTokens +=
        recorded.value.evidence.verifierUsage.modelTokens.total;
      verifierEstimatedCostUsd +=
        recorded.value.evidence.verifierUsage.estimatedCostUsd ?? 0;
    }
    if (
      recorded.value.outcome.kind === "blocked" &&
      recorded.value.outcome.reason === "budget-exhausted"
    ) {
      budgetExhausted = true;
    }
  };

  return {
    enqueue: (subject) => {
      if (subject.kind !== "source-bound-hypothesis" || tasks.has(subject.id)) {
        return;
      }
      const task = pending.then(() => execute(subject));
      tasks.set(subject.id, task);
      pending = task.then(
        () => undefined,
        () => undefined,
      );
    },
    drain: async () => {
      await Promise.all(tasks.values());
    },
    snapshot: () => ({
      refs: [...refs].sort((left, right) =>
        left.verificationId.localeCompare(right.verificationId),
      ),
      unsupportedHypothesis,
      budgetExhausted,
      verifierModelTokens,
      verifierEstimatedCostUsd,
      verificationWallTimeMs,
    }),
  };
}
