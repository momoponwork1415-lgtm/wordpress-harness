import {
  CampaignPreparationIntegrityError,
  CampaignPreparationConflictError,
  newCampaignInputSchema,
  type CampaignReader,
  type CampaignRunner,
  type CampaignView,
  type SubjectView,
} from "../contracts.js";
import {
  openSemanticAdversarialCritique,
  openSemanticChainSynthesis,
  openSemanticDepthEvaluation,
  openExploration,
  closeSemanticCoverage,
  materializeCoverageReviewWave,
  projectCoverageObservation,
  projectMissingLinkDepthWorkQueue,
  projectSemanticDepthWorkQueue,
  materializeMissingLinkWaves,
  referenceAdversarialCritique,
  referenceChainSynthesis,
  referenceDepthIterationDecision,
  referenceSemanticMissingLinkWavePlan,
  referenceSemanticIterationDecision,
  semanticAdversarialCritiqueInputSchema,
  semanticChainSynthesisInputSchema,
  semanticDepthEvaluationInputSchema,
  type AttemptExecutionResultRef,
  type CoverageObservation,
  type SemanticCoverageClosure,
  type SemanticCoverageClosureRef,
  type FinderAttemptResult,
  type SourceBoundHypothesis,
} from "../exploration/index.js";
import { materializeInitialSemanticWaveFoundation } from "../exploration/initial-semantic-wave.js";
import {
  frontierGapArtifactSchema,
  frontierGapArtifactRefSchema,
  researchThesisRefSchema,
  routeFragmentArtifactSchema,
  routeFragmentArtifactRefSchema,
  semanticFinderCheckpointRefSchema,
  semanticFinderCheckpointSchema,
  semanticWaveTerminalSchema,
  semanticWorkWaveRefSchema,
  semanticWorkWavePlanSchema,
  sourceBoundHypothesisArtifactSchema,
  sourceBoundHypothesisArtifactRefSchema,
  type IterationDecisionV2,
  type SemanticFinderCheckpointRef,
  type SemanticWorkWavePlan,
} from "../exploration/semantic-contracts.js";
import {
  attemptExecutionResultRefSchema,
  explorationBootstrapPolicySchema,
  finderAttemptResultSchema,
} from "../exploration/contracts.js";
import {
  attemptExecutionResultV2RefSchema,
  attemptPlanSchema,
  modelAttemptResultV2Schema,
  type AttemptExecutionResultV2,
  type AttemptPlanV2,
  type ModelAttemptPlan,
  type ModelAttemptResultV2,
  type ModelAttemptObserver,
} from "../model-execution/contracts.js";
import type { ModelAttemptUsageV2 } from "../model-attempt-usage-contracts.js";
import {
  canonicalJson,
  sha256Digest,
} from "../research-record/canonical-json.js";
import type {
  PreparationRecord,
  ResearchRecord,
} from "../research-record/index.js";
import { surfaceMapSchema } from "../source-mapping/contracts.js";
import { sourceEvidenceReceiptValueV2Schema } from "../source-mapping/source-evidence-contracts.js";
import { persistTargetFileManifest } from "../source-mapping/target-file-manifest.js";
import type { JsonArtifactStore } from "../research-record/contracts.js";
import {
  FindingMechanismGroupingIntegrityError,
  openVerification,
  projectFindingMechanismGroups,
} from "../verification/index.js";
import {
  CampaignRunConflictError,
  LegacyMapFirstExecutionDisabledError,
  campaignRunPlanSchema,
  campaignRunPlanV2Schema,
  calibrationReviewResultSchema,
  finderAttemptMaterializationSchema,
  semanticDepthResearchSchema,
  type CampaignAttemptIntent,
  type CampaignAttemptCompletionV2,
  type CampaignAttemptIntentV2,
  type CampaignExecutionDependencies,
  type CampaignRunPlan,
  type CampaignRunPlanV2,
  type DefaultSemanticCampaignRunPlanV2,
  type PreparedWaveCampaignRunPlanV2,
  type SemanticCoverageReviewTrace,
} from "./contracts.js";
import { reviewIteration } from "./iteration-review.js";
import { materializeDepthVerificationHypotheses } from "./depth-verification-hypothesis-materializer.js";
import { materializeMissingLinkFinderAttempt } from "./missing-link-finder-attempt-materializer.js";
import { materializeRawSourceFinderAttempt } from "./raw-source-finder-attempt-materializer.js";
import { closeSemanticWaveBarrier } from "./semantic-wave-barrier.js";
import { materializeSemanticSubject } from "./semantic-subject-materializer.js";
import { openSemanticVerificationQueue } from "./semantic-verification-queue.js";
import { executeSemanticCoverageReview } from "./semantic-coverage-review-runner.js";
import {
  materializeTargetIntakeCampaignInput,
  validatePreparedTargetIntake,
} from "./target-intake-campaign-handoff.js";

export interface CampaignControl {
  readonly runner: CampaignRunner;
  readonly reader: CampaignReader;
}

function projectCampaign(preparation: PreparationRecord): CampaignView {
  return {
    campaignId: preparation.campaignId,
    status: "prepared",
    ledgerHead: preparation.ledgerHead,
    preparedAt: preparation.occurredAt,
    inputDigest: preparation.inputDigest,
    targetSnapshot: preparation.input.targetSnapshot,
    ...(preparation.targetFileManifest === undefined
      ? {}
      : { targetFileManifest: preparation.targetFileManifest }),
  };
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function finderResultRef(
  value: FinderAttemptResult,
): AttemptExecutionResultRef {
  return {
    kind: "attempt-execution-result",
    schemaVersion: 1,
    attemptId: value.attemptId,
    leaseId: value.leaseId,
    digest: sha256Digest(value),
  };
}

function campaignAttemptId(
  runId: string,
  leaseId: string,
  ordinal: number,
): string {
  return `attempt:${sha256Digest({ runId, leaseId, ordinal }).slice("sha256:".length)}`;
}

async function readFinderResult(
  dependencies: CampaignExecutionDependencies,
  refValue: AttemptExecutionResultRef,
): Promise<FinderAttemptResult> {
  const ref = attemptExecutionResultRefSchema.parse(refValue);
  const artifact = await dependencies.artifactStore.readJson(ref.digest);
  if (sha256Digest(artifact) !== ref.digest) {
    throw new Error(`Finder Attempt artifact digest mismatch: ${ref.digest}`);
  }
  const value = finderAttemptResultSchema.parse(artifact);
  if (value.attemptId !== ref.attemptId || value.leaseId !== ref.leaseId) {
    throw new Error(`Finder Attempt artifact ref mismatch: ${ref.attemptId}`);
  }
  return value;
}

async function completeCampaignAttempt(
  record: ResearchRecord,
  intent: CampaignAttemptIntent,
  ref: AttemptExecutionResultRef,
): Promise<void> {
  await record.recordCampaignAttemptCompletion({
    kind: "campaign-attempt-completion",
    schemaVersion: 1,
    campaignId: intent.campaignId,
    runId: intent.runId,
    attemptId: intent.attemptId,
    leaseId: intent.leaseId,
    ordinal: intent.ordinal,
    workWaveDigest: intent.workWaveDigest,
    result: ref,
  });
}

function semanticRunConflict(plan: CampaignRunPlanV2): never {
  throw new CampaignRunConflictError(plan.campaignId, plan.runId);
}

async function preflightSemanticFinderWave(
  record: ResearchRecord,
  dependencies: CampaignExecutionDependencies,
  plan: PreparedWaveCampaignRunPlanV2,
): Promise<{
  readonly wave: SemanticWorkWavePlan;
  readonly manifestEntries: readonly {
    readonly path: string;
    readonly digest: string;
    readonly size: number;
  }[];
  readonly attempts: readonly {
    readonly ordinal: number;
    readonly plan: Extract<AttemptPlanV2, { role: "finder" }>;
    readonly planDigest: string;
    readonly maxCandidates: number;
  }[];
}> {
  const preparation = await record.readPreparation(plan.campaignId);
  if (
    preparation === undefined ||
    !("schemaVersion" in preparation.input) ||
    (preparation.input.schemaVersion !== 2 &&
      preparation.input.schemaVersion !== 3) ||
    preparation.targetFileManifest === undefined ||
    preparation.inputDigest !== plan.preparationDigest ||
    canonicalJson(preparation.input.targetSnapshot) !==
      canonicalJson(plan.target) ||
    canonicalJson(preparation.targetFileManifest) !==
      canonicalJson(plan.manifest)
  ) {
    semanticRunConflict(plan);
  }
  const artifact = await dependencies.artifactStore.readJson(
    plan.workWave.artifactDigest,
  );
  if (sha256Digest(artifact) !== plan.workWave.artifactDigest) {
    semanticRunConflict(plan);
  }
  const parsedWave = semanticWorkWavePlanSchema.safeParse(artifact);
  if (!parsedWave.success) semanticRunConflict(plan);
  const wave = parsedWave.data;
  if (
    canonicalJson(wave.ref) !== canonicalJson(plan.workWave.ref) ||
    canonicalJson(wave.target) !== canonicalJson(plan.target) ||
    canonicalJson(wave.manifest) !== canonicalJson(plan.manifest) ||
    wave.purpose.kind !== "raw-source" ||
    wave.leases.length > preparation.input.budget.maxAttempts ||
    wave.leases.some(
      (lease) =>
        lease.budget.maxWallTimeMs > preparation.input.budget.maxWallTimeMs ||
        lease.budget.maxModelTokens > preparation.input.budget.maxModelTokens,
    )
  ) {
    semanticRunConflict(plan);
  }

  const theses = new Map(wave.theses.map((thesis) => [thesis.id, thesis]));
  if (
    theses.size !== wave.theses.length ||
    new Set(wave.leases.map((lease) => lease.id)).size !== wave.leases.length ||
    new Set(wave.leases.map((lease) => lease.assignment.thesisId)).size !==
      wave.leases.length ||
    wave.leases.length !== wave.theses.length
  ) {
    semanticRunConflict(plan);
  }

  const materialized = [...wave.leases]
    .sort((left, right) => compareText(left.id, right.id))
    .map((lease, index) => {
      const thesis = theses.get(lease.assignment.thesisId);
      if (thesis === undefined) semanticRunConflict(plan);
      let attemptPlan: Extract<AttemptPlanV2, { role: "finder" }>;
      try {
        attemptPlan = materializeRawSourceFinderAttempt({
          run: plan,
          wave,
          lease,
          thesis,
          attemptId: campaignAttemptId(plan.runId, lease.id, 1),
        });
      } catch {
        semanticRunConflict(plan);
      }
      return {
        ordinal: index + 1,
        plan: attemptPlan,
        planDigest: sha256Digest(attemptPlan),
        maxCandidates: lease.budget.maxHypotheses,
      };
    });
  return {
    wave,
    manifestEntries: preparation.input.canonicalFileManifest.entries,
    attempts: materialized,
  };
}

async function readSemanticFinderResult(
  dependencies: CampaignExecutionDependencies,
  refValue: unknown,
): Promise<{
  readonly ref: ReturnType<typeof attemptExecutionResultV2RefSchema.parse> & {
    readonly role: "finder";
  };
  readonly value: ModelAttemptResultV2 & { readonly role: "finder" };
}> {
  const ref = attemptExecutionResultV2RefSchema.parse(refValue);
  const artifact = await dependencies.artifactStore.readJson(ref.digest);
  if (sha256Digest(artifact) !== ref.digest) {
    throw new Error(`Semantic Finder artifact digest mismatch: ${ref.digest}`);
  }
  const value = modelAttemptResultV2Schema.parse(artifact);
  if (
    ref.role !== "finder" ||
    value.role !== "finder" ||
    value.attemptId !== ref.attemptId ||
    value.planDigest !== ref.planDigest
  ) {
    throw new Error(`Semantic Finder artifact ref mismatch: ${ref.attemptId}`);
  }
  return {
    ref: { ...ref, role: "finder" },
    value: { ...value, role: "finder" },
  };
}

async function readSemanticAttemptResult(
  dependencies: CampaignExecutionDependencies,
  refValue: unknown,
): Promise<AttemptExecutionResultV2> {
  const ref = attemptExecutionResultV2RefSchema.parse(refValue);
  const artifact = await dependencies.artifactStore.readJson(ref.digest);
  if (sha256Digest(artifact) !== ref.digest) {
    throw new Error(`Semantic Attempt artifact digest mismatch: ${ref.digest}`);
  }
  const value = modelAttemptResultV2Schema.parse(artifact);
  if (
    value.attemptId !== ref.attemptId ||
    value.planDigest !== ref.planDigest ||
    value.role !== ref.role
  ) {
    throw new Error(`Semantic Attempt artifact ref mismatch: ${ref.attemptId}`);
  }
  return { status: value.status, ref, value };
}

function semanticAttemptCompletion(
  intent: CampaignAttemptIntentV2,
  result: AttemptExecutionResultV2["ref"],
): CampaignAttemptCompletionV2 {
  const common = {
    kind: "campaign-attempt-completion" as const,
    schemaVersion: 2 as const,
    campaignId: intent.campaignId,
    runId: intent.runId,
    attemptId: intent.attemptId,
    ordinal: intent.ordinal,
  };
  if (intent.role === "root-planner") {
    if (result.role !== "root-planner") {
      throw new Error("Root Planner completion contains another role");
    }
    return {
      ...common,
      role: intent.role,
      preparationDigest: intent.preparationDigest,
      result: { ...result, role: "root-planner" },
    };
  }
  if (intent.role === "finder") {
    if (result.role !== "finder") {
      throw new Error("Finder completion contains another role");
    }
    return {
      ...common,
      role: intent.role,
      leaseId: intent.leaseId,
      workWaveDigest: intent.workWaveDigest,
      ...(intent.predecessorDecisionDigest === undefined
        ? {}
        : { predecessorDecisionDigest: intent.predecessorDecisionDigest }),
      result: { ...result, role: "finder" },
    };
  }
  if (intent.role === "root-evaluator") {
    if (result.role !== "root-evaluator") {
      throw new Error("Root Evaluator completion contains another role");
    }
    return {
      ...common,
      role: intent.role,
      ...(intent.workWaveDigest === undefined
        ? {}
        : { workWaveDigest: intent.workWaveDigest }),
      ...(intent.terminalDigest === undefined
        ? {}
        : { terminalDigest: intent.terminalDigest }),
      ...(intent.registryDigest === undefined
        ? {}
        : { registryDigest: intent.registryDigest }),
      ...(intent.synthesisDigest === undefined
        ? {}
        : { synthesisDigest: intent.synthesisDigest }),
      ...(intent.critiqueDigest === undefined
        ? {}
        : { critiqueDigest: intent.critiqueDigest }),
      result: { ...result, role: "root-evaluator" },
    };
  }
  if (intent.role === "root-synthesizer") {
    if (result.role !== "root-synthesizer") {
      throw new Error("Root Synthesizer completion contains another role");
    }
    return {
      ...common,
      role: intent.role,
      queueDigest: intent.queueDigest,
      batchId: intent.batchId,
      result: { ...result, role: "root-synthesizer" },
    };
  }
  if (result.role !== "adversarial-critic") {
    throw new Error("Adversarial Critic completion contains another role");
  }
  return {
    ...common,
    role: intent.role,
    synthesisDigest: intent.synthesisDigest,
    result: { ...result, role: "adversarial-critic" },
  };
}

async function executeRecordedSemanticAttempt(
  record: ResearchRecord,
  dependencies: CampaignExecutionDependencies,
  plan: Extract<ModelAttemptPlan, { schemaVersion: 2 }>,
  intent: CampaignAttemptIntentV2,
  onFinderCheckpoint?: (checkpoint: SemanticFinderCheckpointRef) => void,
): Promise<AttemptExecutionResultV2> {
  const planDigest = sha256Digest(plan);
  if (
    plan.attemptId !== intent.attemptId ||
    plan.role !== intent.role ||
    planDigest !== intent.attemptPlanDigest
  ) {
    throw new Error(`Semantic Attempt intent mismatch: ${plan.attemptId}`);
  }
  const storedPlanDigest = await dependencies.artifactStore.putJson(plan);
  if (storedPlanDigest !== planDigest) {
    throw new Error(`Semantic Attempt Plan CAS mismatch: ${plan.attemptId}`);
  }
  const started = await record.recordSemanticCampaignAttemptStart(intent);
  if (started.disposition === "completed") {
    return readSemanticAttemptResult(
      dependencies,
      started.attempt.completion.value.result,
    );
  }
  let result: AttemptExecutionResultV2;
  if (started.disposition === "in-progress") {
    const value = modelAttemptResultV2Schema.parse({
      kind: "model-attempt-result",
      schemaVersion: 2,
      attemptId: plan.attemptId,
      owner: "exploration",
      role: plan.role,
      planDigest,
      status: "orphaned",
      reason: "orphaned-execution-requires-fresh-attempt",
    });
    const digest = await dependencies.artifactStore.putJson(value);
    result = {
      status: value.status,
      value,
      ref: attemptExecutionResultV2RefSchema.parse({
        kind: "attempt-execution-result",
        schemaVersion: 2,
        attemptId: plan.attemptId,
        owner: "exploration",
        role: plan.role,
        planDigest,
        digest,
      }),
    };
  } else {
    const observer =
      plan.role === "finder" && intent.role === "finder"
        ? await openSemanticFinderCheckpointObserver(
            record,
            dependencies,
            plan,
            intent,
            onFinderCheckpoint,
          )
        : undefined;
    const executed = await dependencies.modelExecution.run(plan, observer);
    if (
      executed.ref.schemaVersion !== 2 ||
      executed.value.schemaVersion !== 2
    ) {
      throw new Error(
        `Semantic Attempt returned a legacy result: ${plan.attemptId}`,
      );
    }
    const ref = attemptExecutionResultV2RefSchema.parse(executed.ref);
    const value = modelAttemptResultV2Schema.parse(executed.value);
    if (
      ref.attemptId !== plan.attemptId ||
      value.attemptId !== plan.attemptId ||
      ref.role !== plan.role ||
      value.role !== plan.role ||
      ref.planDigest !== planDigest ||
      value.planDigest !== planDigest ||
      ref.digest !== sha256Digest(value) ||
      executed.status !== value.status
    ) {
      throw new Error(`Semantic Attempt result mismatch: ${plan.attemptId}`);
    }
    const storedResultDigest = await dependencies.artifactStore.putJson(value);
    if (storedResultDigest !== ref.digest) {
      throw new Error(
        `Semantic Attempt result CAS mismatch: ${plan.attemptId}`,
      );
    }
    result = { status: value.status, ref, value };
  }
  await record.recordSemanticCampaignAttemptCompletion(
    semanticAttemptCompletion(intent, result.ref),
  );
  return result;
}

async function openSemanticFinderCheckpointObserver(
  record: ResearchRecord,
  dependencies: CampaignExecutionDependencies,
  plan: Extract<AttemptPlanV2, { role: "finder" }>,
  intent: Extract<CampaignAttemptIntentV2, { role: "finder" }>,
  onCheckpoint?: (checkpoint: SemanticFinderCheckpointRef) => void,
): Promise<ModelAttemptObserver> {
  const preparation = await record.readPreparation(intent.campaignId);
  if (
    preparation === undefined ||
    preparation.targetFileManifest === undefined ||
    !("schemaVersion" in preparation.input) ||
    (preparation.input.schemaVersion !== 2 &&
      preparation.input.schemaVersion !== 3) ||
    !sameCampaignValue(preparation.input.targetSnapshot, plan.target) ||
    !sameCampaignValue(preparation.targetFileManifest, plan.manifest)
  ) {
    throw new CampaignRunConflictError(intent.campaignId, intent.runId);
  }
  const workWave = semanticWorkWaveRefSchema.parse({
    kind: "work-wave",
    schemaVersion: 2,
    id: plan.assignment.workWaveId,
    digest: intent.workWaveDigest,
    targetSnapshotDigest: plan.target.digest,
    manifestDigest: plan.manifest.digest,
  });
  const manifestEntries = preparation.input.canonicalFileManifest.entries;
  const observed = (
    await record.listSemanticFinderCheckpoints(intent.campaignId, intent.runId)
  ).filter((entry) => entry.checkpoint.attemptId === intent.attemptId);
  let nextOrdinal =
    observed.reduce(
      (maximum, entry) => Math.max(maximum, entry.checkpoint.ordinal),
      0,
    ) + 1;
  let pending = Promise.resolve();

  const persist = async (subject: unknown) => {
    const subjectRef = await materializeSemanticSubject(
      dependencies.artifactStore,
      {
        target: plan.target,
        manifest: plan.manifest,
        workWave,
        attemptId: plan.attemptId,
        leaseId: plan.assignment.leaseId,
        manifestEntries,
        subject,
      },
    );
    const duplicate = observed.find(
      (entry) =>
        entry.checkpoint.subject.kind === subjectRef.kind &&
        entry.checkpoint.subject.id === subjectRef.id,
    );
    if (duplicate !== undefined) {
      if (duplicate.checkpoint.subject.digest !== subjectRef.digest) {
        throw new CampaignRunConflictError(intent.campaignId, intent.runId);
      }
      onCheckpoint?.(duplicate.checkpoint);
      return duplicate.checkpoint;
    }
    const ordinal = nextOrdinal;
    const id = sha256Digest({
      kind: "finder-checkpoint",
      campaignId: intent.campaignId,
      runId: intent.runId,
      attemptId: intent.attemptId,
      ordinal,
      subject: subjectRef,
    });
    const checkpoint = semanticFinderCheckpointSchema.parse({
      kind: "finder-checkpoint",
      schemaVersion: 1,
      id,
      campaignId: intent.campaignId,
      runId: intent.runId,
      attemptId: intent.attemptId,
      leaseId: intent.leaseId,
      workWaveDigest: intent.workWaveDigest,
      targetSnapshotDigest: plan.target.digest,
      manifestDigest: plan.manifest.digest,
      ordinal,
      subject: subjectRef,
    });
    const digest = await dependencies.artifactStore.putJson(checkpoint);
    const checkpointRef = semanticFinderCheckpointRefSchema.parse({
      ...checkpoint,
      digest,
    });
    const stored = await record.recordSemanticFinderCheckpoint(checkpointRef);
    observed.push(stored);
    nextOrdinal += 1;
    onCheckpoint?.(stored.checkpoint);
    return stored.checkpoint;
  };

  return {
    checkpoint: (subject: unknown) => {
      const result = pending.then(() => persist(subject));
      pending = result.then(
        () => undefined,
        () => undefined,
      );
      return result;
    },
  };
}

async function executeSemanticFinderWave(
  record: ResearchRecord,
  dependencies: CampaignExecutionDependencies,
  plan: PreparedWaveCampaignRunPlanV2,
) {
  const preflight = await preflightSemanticFinderWave(
    record,
    dependencies,
    plan,
  );
  const start = await record.recordSemanticCampaignRunStart(plan);
  if (start.disposition === "completed") return start.run;

  const scheduled = [];
  for (const materialized of preflight.attempts) {
    const storedPlanDigest = await dependencies.artifactStore.putJson(
      materialized.plan,
    );
    if (storedPlanDigest !== materialized.planDigest) semanticRunConflict(plan);
    const intent = {
      kind: "campaign-attempt-intent" as const,
      schemaVersion: 2 as const,
      role: "finder" as const,
      campaignId: plan.campaignId,
      runId: plan.runId,
      attemptId: materialized.plan.attemptId,
      leaseId: materialized.plan.assignment.leaseId,
      ordinal: materialized.ordinal,
      workWaveDigest: preflight.wave.ref.digest,
      mode: "execute" as const,
      attemptPlanDigest: materialized.planDigest,
    };
    const attemptStart =
      await record.recordSemanticCampaignAttemptStart(intent);
    if (attemptStart.disposition === "completed") {
      scheduled.push({
        ...materialized,
        intent,
        priorResult: attemptStart.attempt.completion.value.result,
      });
      continue;
    }
    if (attemptStart.disposition === "in-progress") {
      throw new Error(
        `Semantic Finder Attempt is still in progress: ${intent.attemptId}`,
      );
    }
    scheduled.push({ ...materialized, intent });
  }

  const terminalAttempts = await Promise.all(
    scheduled.map(async (item) => {
      if ("priorResult" in item) {
        const prior = await readSemanticFinderResult(
          dependencies,
          item.priorResult,
        );
        return {
          ...prior,
          expectedLeaseId: item.plan.assignment.leaseId,
          maxCandidates: item.maxCandidates,
        };
      }
      const observer = await openSemanticFinderCheckpointObserver(
        record,
        dependencies,
        item.plan,
        item.intent,
      );
      const executed = await dependencies.modelExecution.run(
        item.plan,
        observer,
      );
      if (
        executed.ref.schemaVersion !== 2 ||
        executed.value.schemaVersion !== 2
      ) {
        semanticRunConflict(plan);
      }
      const ref = attemptExecutionResultV2RefSchema.safeParse(executed.ref);
      const value = modelAttemptResultV2Schema.safeParse(executed.value);
      if (
        !ref.success ||
        !value.success ||
        ref.data.role !== "finder" ||
        value.data.role !== "finder" ||
        ref.data.attemptId !== item.plan.attemptId ||
        value.data.attemptId !== item.plan.attemptId ||
        ref.data.planDigest !== item.planDigest ||
        value.data.planDigest !== item.planDigest ||
        ref.data.digest !== sha256Digest(value.data) ||
        executed.status !== value.data.status
      ) {
        semanticRunConflict(plan);
      }
      const storedResultDigest = await dependencies.artifactStore.putJson(
        value.data,
      );
      if (storedResultDigest !== ref.data.digest) semanticRunConflict(plan);
      await record.recordSemanticCampaignAttemptCompletion({
        kind: "campaign-attempt-completion",
        schemaVersion: 2,
        role: "finder",
        campaignId: plan.campaignId,
        runId: plan.runId,
        attemptId: item.plan.attemptId,
        leaseId: item.plan.assignment.leaseId,
        ordinal: item.ordinal,
        workWaveDigest: preflight.wave.ref.digest,
        result: { ...ref.data, role: "finder" },
      });
      return {
        ref: { ...ref.data, role: "finder" as const },
        value: { ...value.data, role: "finder" as const },
        expectedLeaseId: item.plan.assignment.leaseId,
        maxCandidates: item.maxCandidates,
      };
    }),
  );
  const waveTerminal = await closeSemanticWaveBarrier(
    dependencies.artifactStore,
    preflight.wave,
    preflight.manifestEntries,
    terminalAttempts,
  );
  const refs = terminalAttempts.map((attempt) => attempt.ref);
  refs.sort((left, right) => compareText(left.attemptId, right.attemptId));
  const firstIssue = waveTerminal.issues[0];
  return record.recordSemanticCampaignRunCompletion({
    kind: "campaign-run-completion",
    schemaVersion: 2,
    runId: plan.runId,
    campaignId: plan.campaignId,
    planDigest: start.planDigest,
    target: plan.target,
    manifest: plan.manifest,
    workWave: preflight.wave.ref,
    waveTerminal,
    attempts: refs,
    decision:
      firstIssue === undefined
        ? { kind: "finder-wave-completed" }
        : { kind: "incomplete", reason: firstIssue.reason },
  });
}

async function executeDefaultSemanticCampaign(
  record: ResearchRecord,
  dependencies: CampaignExecutionDependencies,
  plan: DefaultSemanticCampaignRunPlanV2,
) {
  const campaignStartedAt = performance.now();
  const preparation = await record.readPreparation(plan.campaignId);
  if (
    preparation === undefined ||
    preparation.targetFileManifest === undefined ||
    !("schemaVersion" in preparation.input) ||
    (preparation.input.schemaVersion !== 2 &&
      preparation.input.schemaVersion !== 3) ||
    preparation.inputDigest !== plan.preparationDigest ||
    !sameCampaignValue(preparation.input.targetSnapshot, plan.target) ||
    !sameCampaignValue(preparation.targetFileManifest, plan.manifest)
  ) {
    semanticRunConflict(plan);
  }
  const canonicalFileEntries = preparation.input.canonicalFileManifest.entries;
  const start = await record.recordSemanticCampaignRunStart(plan);
  if (start.disposition === "completed") return start.run;

  const verificationQueue = openSemanticVerificationQueue(
    record,
    dependencies,
    plan,
  );
  for (const checkpoint of await record.listSemanticFinderCheckpoints(
    plan.campaignId,
    plan.runId,
  )) {
    verificationQueue.enqueue(checkpoint.checkpoint.subject);
  }
  const initialWave = materializeInitialSemanticWaveFoundation({
    target: plan.target,
    manifest: plan.manifest,
    policy: plan.semanticPolicy,
  });
  const baselineAttemptPlan = materializeRawSourceFinderAttempt({
    run: plan,
    wave: {
      id: initialWave.ref.id,
      ref: initialWave.ref,
      purpose: { kind: "raw-source" },
      target: plan.target,
      manifest: plan.manifest,
    },
    lease: initialWave.baselineLease,
    thesis: initialWave.baselineThesis,
    attemptId: campaignAttemptId(plan.runId, initialWave.baselineLease.id, 1),
  });
  const baselineResultPromise = executeRecordedSemanticAttempt(
    record,
    dependencies,
    baselineAttemptPlan,
    {
      kind: "campaign-attempt-intent",
      schemaVersion: 2,
      campaignId: plan.campaignId,
      runId: plan.runId,
      attemptId: baselineAttemptPlan.attemptId,
      ordinal: 1,
      mode: "execute",
      attemptPlanDigest: sha256Digest(baselineAttemptPlan),
      role: "finder",
      leaseId: initialWave.baselineLease.id,
      workWaveDigest: initialWave.ref.digest,
    },
    (checkpoint) => verificationQueue.enqueue(checkpoint.subject),
  );

  let plannerOrdinal = 0;
  const plannerExecution = {
    run: async (attemptPlan: ModelAttemptPlan) => {
      if (
        attemptPlan.schemaVersion !== 2 ||
        attemptPlan.role !== "root-planner"
      ) {
        throw new Error("Semantic planner requested another Attempt role");
      }
      plannerOrdinal += 1;
      return executeRecordedSemanticAttempt(record, dependencies, attemptPlan, {
        kind: "campaign-attempt-intent",
        schemaVersion: 2,
        campaignId: plan.campaignId,
        runId: plan.runId,
        attemptId: attemptPlan.attemptId,
        ordinal: plannerOrdinal,
        mode: "execute",
        attemptPlanDigest: sha256Digest(attemptPlan),
        role: "root-planner",
        preparationDigest: plan.preparationDigest,
      });
    },
  };
  const planning = await openExploration({
    target: plan.target,
    manifest: plan.manifest,
    attemptNamespace: `${plan.campaignId}:${plan.runId}`,
    metadata: plan.metadata,
    semanticPolicy: plan.semanticPolicy,
    planner: {
      modelExecution: plannerExecution,
      promptSet: {
        id: plan.planner.promptSet.id,
        digest: plan.planner.promptSet.digest,
      },
      modelProfile: plan.planner.modelProfile.execution,
      sourceToolPolicy: plan.planner.sourceToolPolicy,
    },
  })
    .decide({
      kind: "start-semantic-research",
      schemaVersion: 2,
      target: plan.target,
      manifest: plan.manifest,
    })
    .catch(async (error: unknown) => {
      await baselineResultPromise;
      throw error;
    });
  if (planning.kind !== "run-wave") {
    if (planning.kind !== "planning-incomplete") {
      throw new Error(`Semantic Root Planning returned ${planning.kind}`);
    }
    await baselineResultPromise;
    await verificationQueue.drain();
    const verificationState = verificationQueue.snapshot();
    const attemptRecords = await record.listSemanticCampaignAttempts(
      plan.campaignId,
      plan.runId,
    );
    return record.recordSemanticCampaignRunCompletion({
      kind: "campaign-run-completion",
      schemaVersion: 2,
      runId: plan.runId,
      campaignId: plan.campaignId,
      planDigest: start.planDigest,
      target: plan.target,
      manifest: plan.manifest,
      attempts: attemptRecords.flatMap((attempt) =>
        attempt.completion === undefined
          ? []
          : [attempt.completion.value.result],
      ),
      stage: planning,
      verifications: [...verificationState.refs],
      decision: { kind: "incomplete", reason: "planning-incomplete" },
    });
  }
  const wave = planning.plan;
  if (
    wave.ref.digest !== initialWave.ref.digest ||
    !wave.leases.some((lease) => lease.id === initialWave.baselineLease.id) ||
    wave.leases.length > plan.budgetPolicy.maxConcurrentFinders ||
    wave.leases.length > plan.budgetPolicy.maxFinderAttempts
  ) {
    semanticRunConflict(plan);
  }
  const initialWavePlanDigest = await dependencies.artifactStore.putJson(wave);
  if (initialWavePlanDigest !== sha256Digest(wave)) {
    throw new Error("Initial Semantic Wave Plan CAS mismatch");
  }

  const theses = new Map(wave.theses.map((thesis) => [thesis.id, thesis]));
  const materialized = [...wave.leases]
    .sort((left, right) =>
      left.id === initialWave.baselineLease.id
        ? -1
        : right.id === initialWave.baselineLease.id
          ? 1
          : compareText(left.id, right.id),
    )
    .map((lease, index) => {
      const thesis = theses.get(lease.assignment.thesisId);
      if (thesis === undefined) semanticRunConflict(plan);
      const attemptPlan = materializeRawSourceFinderAttempt({
        run: plan,
        wave,
        lease,
        thesis,
        attemptId: campaignAttemptId(plan.runId, lease.id, 1),
      });
      return { attemptPlan, lease, ordinal: index + 1 };
    });
  const terminalAttempts = await Promise.all(
    materialized.map(async ({ attemptPlan, lease, ordinal }) => {
      const result =
        lease.id === initialWave.baselineLease.id
          ? await baselineResultPromise
          : await executeRecordedSemanticAttempt(
              record,
              dependencies,
              attemptPlan,
              {
                kind: "campaign-attempt-intent",
                schemaVersion: 2,
                campaignId: plan.campaignId,
                runId: plan.runId,
                attemptId: attemptPlan.attemptId,
                ordinal,
                mode: "execute",
                attemptPlanDigest: sha256Digest(attemptPlan),
                role: "finder",
                leaseId: lease.id,
                workWaveDigest: wave.ref.digest,
              },
              (checkpoint) => verificationQueue.enqueue(checkpoint.subject),
            );
      if (result.ref.role !== "finder" || result.value.role !== "finder") {
        throw new Error("Semantic Finder returned another Attempt role");
      }
      return {
        ref: { ...result.ref, role: "finder" as const },
        value: { ...result.value, role: "finder" as const },
        expectedLeaseId: lease.id,
        maxCandidates: lease.budget.maxHypotheses,
      };
    }),
  );
  const waveTerminalRef = await closeSemanticWaveBarrier(
    dependencies.artifactStore,
    wave,
    preparation.input.canonicalFileManifest.entries,
    terminalAttempts,
  );
  const waveTerminal = semanticWaveTerminalSchema.parse(
    await dependencies.artifactStore.readJson(waveTerminalRef.digest),
  );
  if (sha256Digest(waveTerminal) !== waveTerminalRef.digest) {
    throw new Error("Semantic Wave terminal CAS mismatch");
  }
  const hypotheses = await Promise.all(
    waveTerminalRef.hypotheses.map(async (ref) =>
      sourceBoundHypothesisArtifactSchema.parse(
        await dependencies.artifactStore.readJson(ref.digest),
      ),
    ),
  );
  const routeFragments = await Promise.all(
    waveTerminalRef.routeFragments.map(async (ref) =>
      routeFragmentArtifactSchema.parse(
        await dependencies.artifactStore.readJson(ref.digest),
      ),
    ),
  );
  const frontierGaps = await Promise.all(
    waveTerminalRef.frontierGaps.map(async (ref) =>
      frontierGapArtifactSchema.parse(
        await dependencies.artifactStore.readJson(ref.digest),
      ),
    ),
  );
  const toolReceiptRefs = terminalAttempts
    .flatMap((attempt) => attempt.value.sourceEvidenceReceipts ?? [])
    .sort((left, right) => compareText(left.digest, right.digest));
  if (
    new Set(toolReceiptRefs.map((ref) => ref.digest)).size !==
    toolReceiptRefs.length
  ) {
    throw new Error("Semantic Wave contains duplicate Tool Receipt refs");
  }
  const toolReceipts = await Promise.all(
    toolReceiptRefs.map(async (ref) => {
      const artifact = await dependencies.artifactStore.readJson(ref.digest);
      if (sha256Digest(artifact) !== ref.digest) {
        throw new Error(`Tool Receipt CAS mismatch: ${ref.digest}`);
      }
      return sourceEvidenceReceiptValueV2Schema.parse(artifact);
    }),
  );

  let evaluatorOrdinal = 0;
  const evaluatorExecution = {
    run: async (attemptPlan: ModelAttemptPlan) => {
      if (
        attemptPlan.schemaVersion !== 2 ||
        attemptPlan.role !== "root-evaluator"
      ) {
        throw new Error("Semantic evaluator requested another Attempt role");
      }
      evaluatorOrdinal += 1;
      const commonIntent = {
        kind: "campaign-attempt-intent",
        schemaVersion: 2,
        campaignId: plan.campaignId,
        runId: plan.runId,
        attemptId: attemptPlan.attemptId,
        ordinal: evaluatorOrdinal,
        mode: "execute",
        attemptPlanDigest: sha256Digest(attemptPlan),
        role: "root-evaluator",
      } as const;
      return executeRecordedSemanticAttempt(
        record,
        dependencies,
        attemptPlan,
        attemptPlan.assignment.kind === "wave-evaluation"
          ? {
              ...commonIntent,
              workWaveDigest: attemptPlan.assignment.wave.digest,
              terminalDigest: attemptPlan.assignment.terminalDigest,
            }
          : {
              ...commonIntent,
              registryDigest: attemptPlan.assignment.registryDigest,
              synthesisDigest: attemptPlan.assignment.synthesisDigest,
              critiqueDigest: attemptPlan.assignment.critiqueDigest,
            },
      );
    },
  };
  const semanticExploration = openExploration({
    target: plan.target,
    manifest: plan.manifest,
    attemptNamespace: `${plan.campaignId}:${plan.runId}`,
    metadata: plan.metadata,
    semanticPolicy: plan.semanticPolicy,
    planner: {
      modelExecution: plannerExecution,
      promptSet: {
        id: plan.planner.promptSet.id,
        digest: plan.planner.promptSet.digest,
      },
      modelProfile: plan.planner.modelProfile.execution,
      sourceToolPolicy: plan.planner.sourceToolPolicy,
    },
    evaluator: {
      modelExecution: evaluatorExecution,
      promptSet: {
        id: plan.evaluator.promptSet.id,
        digest: plan.evaluator.promptSet.digest,
      },
      modelProfile: plan.evaluator.modelProfile.execution,
      budget: plan.evaluator.budget,
    },
  });
  const evaluated = await semanticExploration.decide({
    kind: "evaluate-semantic-wave",
    schemaVersion: 2,
    target: plan.target,
    manifest: plan.manifest,
    wave,
    terminal: { ref: waveTerminalRef, value: waveTerminal },
    artifacts: { hypotheses, routeFragments, frontierGaps },
    attemptResults: terminalAttempts.map((attempt) => attempt.value),
    toolReceipts,
    closureReview: {
      kind: "coverage-closure-evaluation",
      schemaVersion: 1,
      reviewKind: "initial-wave",
      knownSubjectIds: [],
    },
  });
  if (evaluated.kind !== "iteration-decision") {
    if (evaluated.kind !== "evaluation-incomplete") {
      throw new Error(`Semantic Root Evaluation returned ${evaluated.kind}`);
    }
    await verificationQueue.drain();
    const verificationState = verificationQueue.snapshot();
    const attemptRecords = await record.listSemanticCampaignAttempts(
      plan.campaignId,
      plan.runId,
    );
    return record.recordSemanticCampaignRunCompletion({
      kind: "campaign-run-completion",
      schemaVersion: 2,
      runId: plan.runId,
      campaignId: plan.campaignId,
      planDigest: start.planDigest,
      target: plan.target,
      manifest: plan.manifest,
      attempts: attemptRecords.flatMap((attempt) =>
        attempt.completion === undefined
          ? []
          : [attempt.completion.value.result],
      ),
      stage: evaluated,
      verifications: [...verificationState.refs],
      decision: { kind: "incomplete", reason: "evaluation-incomplete" },
    });
  }
  const iterationDecision: IterationDecisionV2 = evaluated;
  const iterationDecisionArtifactDigest =
    await dependencies.artifactStore.putJson(iterationDecision);
  const expectedIterationDecisionRef =
    referenceSemanticIterationDecision(iterationDecision);
  if (iterationDecisionArtifactDigest !== expectedIterationDecisionRef.digest) {
    throw new Error("Semantic Iteration Decision CAS mismatch");
  }
  const recordedIterationDecision =
    await record.recordSemanticIterationDecision(
      plan.campaignId,
      plan.runId,
      iterationDecision,
    );
  if (
    expectedIterationDecisionRef.digest !==
    recordedIterationDecision.decision.digest
  ) {
    throw new Error("Semantic Iteration Decision CAS mismatch");
  }
  const initialFamilyRegistry = await record.readApproachFamilyRegistry(
    plan.campaignId,
    plan.runId,
  );
  if (initialFamilyRegistry === undefined) {
    throw new Error("Semantic Approach Family Registry is missing");
  }
  let currentFamilyRegistry = initialFamilyRegistry;
  let storedRegistryDigest = await dependencies.artifactStore.putJson(
    currentFamilyRegistry.value,
  );
  if (storedRegistryDigest !== currentFamilyRegistry.ref.digest) {
    throw new Error("Approach Family Registry CAS mismatch");
  }
  const coverageObservations: CoverageObservation[] = [];
  const coverageReviews: SemanticCoverageReviewTrace[] = [];
  let coverageReviewIncomplete = false;
  let coverageClosure: SemanticCoverageClosure | undefined;
  let coverageClosureRef: SemanticCoverageClosureRef | undefined;
  let nextFinderOrdinal = materialized.length + 1;
  let coverageReviewOrdinal = 0;
  const executeCoverageReview = async (
    knownSubjectIds: ReadonlySet<string>,
    observationOrdinal: number,
  ) => {
    coverageReviewOrdinal += 1;
    const result = await executeSemanticCoverageReview({
      record,
      artifactStore: dependencies.artifactStore,
      run: plan,
      plannerAttempt: wave.plannerAttempt,
      canonicalFileEntries,
      exploration: semanticExploration,
      registry: currentFamilyRegistry,
      reviewOrdinal: coverageReviewOrdinal,
      observationOrdinal,
      finderOrdinal: nextFinderOrdinal,
      knownSubjectIds,
      executeAttempt: (attemptPlan, intent, onCheckpoint) =>
        executeRecordedSemanticAttempt(
          record,
          dependencies,
          attemptPlan,
          intent,
          onCheckpoint,
        ),
      onCheckpoint: (checkpoint) =>
        verificationQueue.enqueue(checkpoint.subject),
      onVerificationRequest: (hypothesis) =>
        verificationQueue.enqueue(hypothesis),
    });
    nextFinderOrdinal += 1;
    currentFamilyRegistry = result.registry;
    return result;
  };

  if (iterationDecision.campaignDisposition === "coverage-closed") {
    const firstObservation = projectCoverageObservation({
      ordinal: 1,
      reviewKind: "initial-wave",
      decision: iterationDecision,
      wavePlanDigest: initialWavePlanDigest,
      terminal: waveTerminalRef,
      knownSubjectIds: [],
    });
    coverageObservations.push(firstObservation);
    const knownSubjectIds = new Set(firstObservation.semanticSubjectIds);
    let consecutiveNoMaterialDelta =
      firstObservation.outcome === "no-material-delta" ? 1 : 0;
    while (
      consecutiveNoMaterialDelta < 2 &&
      coverageObservations.length < plan.budgetPolicy.maxWorkWaves
    ) {
      const review = await executeCoverageReview(
        knownSubjectIds,
        coverageObservations.length + 1,
      );
      coverageReviews.push(review.trace);
      if (review.kind === "incomplete") {
        coverageReviewIncomplete = true;
        break;
      }
      coverageObservations.push(review.observation);
      for (const subjectId of review.observation.semanticSubjectIds) {
        knownSubjectIds.add(subjectId);
      }
      consecutiveNoMaterialDelta =
        review.observation.outcome === "no-material-delta"
          ? consecutiveNoMaterialDelta + 1
          : 0;
    }
    if (consecutiveNoMaterialDelta < 2) coverageReviewIncomplete = true;
  }
  const depthWorkQueue = projectSemanticDepthWorkQueue(
    iterationDecision,
    currentFamilyRegistry.value,
  );
  const storedDepthWorkQueueDigest = await dependencies.artifactStore.putJson(
    depthWorkQueue.value,
  );
  if (storedDepthWorkQueueDigest !== depthWorkQueue.ref.digest) {
    throw new Error("Semantic Depth Work Queue CAS mismatch");
  }

  const subjectArtifacts = new Map<
    string,
    ReturnType<
      typeof semanticChainSynthesisInputSchema.parse
    >["subjects"][number]
  >();
  for (const thesis of wave.theses) {
    const ref = researchThesisRefSchema.parse({
      kind: "research-thesis",
      schemaVersion: 1,
      id: thesis.id,
      digest: sha256Digest(thesis),
      targetSnapshotDigest: plan.target.digest,
      manifestDigest: plan.manifest.digest,
    });
    subjectArtifacts.set(ref.digest, { ref, value: thesis });
  }
  for (const [index, artifact] of hypotheses.entries()) {
    const ref = sourceBoundHypothesisArtifactRefSchema.parse(
      waveTerminalRef.hypotheses[index],
    );
    subjectArtifacts.set(ref.digest, { ref, value: artifact });
  }
  for (const [index, artifact] of routeFragments.entries()) {
    const ref = routeFragmentArtifactRefSchema.parse(
      waveTerminalRef.routeFragments[index],
    );
    subjectArtifacts.set(ref.digest, { ref, value: artifact });
  }
  for (const [index, artifact] of frontierGaps.entries()) {
    const ref = frontierGapArtifactRefSchema.parse(
      waveTerminalRef.frontierGaps[index],
    );
    subjectArtifacts.set(ref.digest, { ref, value: artifact });
  }

  let synthesisOrdinal = 0;
  const synthesisExecution = {
    run: async (attemptPlan: ModelAttemptPlan) => {
      if (
        attemptPlan.schemaVersion !== 2 ||
        attemptPlan.role !== "root-synthesizer"
      ) {
        throw new Error("Semantic Depth requested another Synthesis role");
      }
      synthesisOrdinal += 1;
      return executeRecordedSemanticAttempt(record, dependencies, attemptPlan, {
        kind: "campaign-attempt-intent",
        schemaVersion: 2,
        campaignId: plan.campaignId,
        runId: plan.runId,
        attemptId: attemptPlan.attemptId,
        ordinal: synthesisOrdinal,
        mode: "execute",
        attemptPlanDigest: sha256Digest(attemptPlan),
        role: "root-synthesizer",
        queueDigest: attemptPlan.assignment.queueDigest,
        batchId: attemptPlan.assignment.batchId,
      });
    },
  };
  let criticOrdinal = 0;
  const criticExecution = {
    run: async (attemptPlan: ModelAttemptPlan) => {
      if (
        attemptPlan.schemaVersion !== 2 ||
        attemptPlan.role !== "adversarial-critic"
      ) {
        throw new Error("Semantic Depth requested another Critic role");
      }
      criticOrdinal += 1;
      return executeRecordedSemanticAttempt(record, dependencies, attemptPlan, {
        kind: "campaign-attempt-intent",
        schemaVersion: 2,
        campaignId: plan.campaignId,
        runId: plan.runId,
        attemptId: attemptPlan.attemptId,
        ordinal: criticOrdinal,
        mode: "execute",
        attemptPlanDigest: sha256Digest(attemptPlan),
        role: "adversarial-critic",
        synthesisDigest: attemptPlan.assignment.synthesisDigest,
      });
    },
  };
  const synthesisPromptSet = {
    id: "semantic-depth-synthesis-v1",
    digest: sha256Digest({
      kind: "semantic-depth-synthesis-prompt-set",
      schemaVersion: 1,
      base: plan.evaluator.promptSet,
    }),
  };
  const criticPromptSet = {
    id: "semantic-adversarial-critic-v1",
    digest: sha256Digest({
      kind: "semantic-adversarial-critic-prompt-set",
      schemaVersion: 1,
      base: plan.evaluator.promptSet,
    }),
  };
  const depthEvaluationPromptSet = {
    id: "semantic-depth-evaluation-v1",
    digest: sha256Digest({
      kind: "semantic-depth-evaluation-prompt-set",
      schemaVersion: 1,
      base: plan.evaluator.promptSet,
    }),
  };
  const synthesizer = openSemanticChainSynthesis({
    modelExecution: synthesisExecution,
    promptSet: synthesisPromptSet,
    modelProfile: plan.evaluator.modelProfile.execution,
    budget: plan.evaluator.budget,
    attemptNamespace: `${plan.campaignId}:${plan.runId}`,
  });
  const critic = openSemanticAdversarialCritique({
    modelExecution: criticExecution,
    promptSet: criticPromptSet,
    modelProfile: plan.evaluator.modelProfile.execution,
    sourceToolPolicy: plan.finder.sourceToolPolicy,
    budget: {
      ...plan.evaluator.budget,
      maxSourceQueries: plan.semanticPolicy.plannerBudget.maxSourceQueries,
      ...(plan.semanticPolicy.plannerBudget.maxSourceScanBytes === undefined
        ? {}
        : {
            maxSourceScanBytes:
              plan.semanticPolicy.plannerBudget.maxSourceScanBytes,
          }),
      ...(plan.semanticPolicy.plannerBudget.maxSourceResponseBytes === undefined
        ? {}
        : {
            maxSourceResponseBytes:
              plan.semanticPolicy.plannerBudget.maxSourceResponseBytes,
          }),
      ...(plan.semanticPolicy.plannerBudget.sourceLimitTerminalOutput ===
      undefined
        ? {}
        : {
            sourceLimitTerminalOutput:
              plan.semanticPolicy.plannerBudget.sourceLimitTerminalOutput,
          }),
    },
    attemptNamespace: `${plan.campaignId}:${plan.runId}`,
  });
  const depthEvaluator = openSemanticDepthEvaluation({
    modelExecution: evaluatorExecution,
    promptSet: depthEvaluationPromptSet,
    modelProfile: plan.evaluator.modelProfile.execution,
    budget: plan.evaluator.budget,
    attemptNamespace: `${plan.campaignId}:${plan.runId}`,
  });
  let depthIncomplete = false;
  let usedMissingLinkWaves = 0;
  const pendingDepthQueues = [depthWorkQueue];
  const depthRounds: unknown[] = [];
  const depthVerificationFamilies = new Map<string, Set<string>>();
  while (pendingDepthQueues.length > 0 && !depthIncomplete) {
    const currentQueue = pendingDepthQueues.shift();
    if (currentQueue === undefined) break;
    const roundBatches: unknown[] = [];
    for (const batch of [...currentQueue.value.batches].sort(
      (left, right) => left.ordinal - right.ordinal,
    )) {
      const items = currentQueue.value.items.filter((item) =>
        batch.itemIds.includes(item.id),
      );
      const subjectDigests = [
        ...new Set(
          items.flatMap((item) =>
            item.subjects.map((subject) => subject.digest),
          ),
        ),
      ];
      const subjects = subjectDigests.map((digest) => {
        const artifact = subjectArtifacts.get(digest);
        if (artifact === undefined) {
          throw new Error(
            `Semantic Depth subject artifact is missing: ${digest}`,
          );
        }
        return artifact;
      });
      const synthesis = await synthesizer.synthesize(
        semanticChainSynthesisInputSchema.parse({
          kind: "synthesize-depth-work",
          schemaVersion: 1,
          queue: currentQueue,
          batchId: batch.id,
          manifest: {
            ref: plan.manifest,
            value: {
              kind: "target-file-manifest",
              schemaVersion: 1,
              targetSnapshot: {
                id: plan.target.id,
                digest: plan.target.digest,
              },
              entries: preparation.input.canonicalFileManifest.entries,
            },
          },
          subjects,
        }),
      );
      const synthesisArtifactDigest =
        await dependencies.artifactStore.putJson(synthesis);
      if (synthesis.kind === "chain-synthesis-incomplete") {
        roundBatches.push({
          kind: "semantic-depth-batch-incomplete",
          schemaVersion: 1,
          batchId: batch.id,
          stage: "root-synthesis",
          artifactDigest: synthesisArtifactDigest,
          reason: synthesis.reason,
        });
        depthIncomplete = true;
        break;
      }
      const synthesisRecord = {
        ref: referenceChainSynthesis(synthesis),
        artifactDigest: synthesisArtifactDigest,
      };
      if (synthesis.proposals.length === 0) {
        roundBatches.push({
          kind: "semantic-depth-batch-result",
          schemaVersion: 1,
          batchId: batch.id,
          synthesis: synthesisRecord,
        });
        continue;
      }
      const critique = await critic.critique(
        semanticAdversarialCritiqueInputSchema.parse({
          kind: "critique-chain-synthesis",
          schemaVersion: 1,
          synthesis,
          manifest: {
            ref: plan.manifest,
            value: {
              kind: "target-file-manifest",
              schemaVersion: 1,
              targetSnapshot: {
                id: plan.target.id,
                digest: plan.target.digest,
              },
              entries: preparation.input.canonicalFileManifest.entries,
            },
          },
        }),
      );
      const critiqueArtifactDigest =
        await dependencies.artifactStore.putJson(critique);
      if (critique.kind === "adversarial-critique-incomplete") {
        roundBatches.push({
          kind: "semantic-depth-batch-incomplete",
          schemaVersion: 1,
          batchId: batch.id,
          stage: "adversarial-critique",
          artifactDigest: critiqueArtifactDigest,
          reason: critique.reason,
        });
        depthIncomplete = true;
        break;
      }
      const evaluation = await depthEvaluator.evaluate(
        semanticDepthEvaluationInputSchema.parse({
          kind: "evaluate-depth-research",
          schemaVersion: 1,
          registry: currentFamilyRegistry,
          synthesis,
          critique,
        }),
      );
      const evaluationArtifactDigest =
        await dependencies.artifactStore.putJson(evaluation);
      if (evaluation.kind === "depth-evaluation-incomplete") {
        roundBatches.push({
          kind: "semantic-depth-batch-incomplete",
          schemaVersion: 1,
          batchId: batch.id,
          stage: "depth-root-evaluation",
          artifactDigest: evaluationArtifactDigest,
          reason: evaluation.reason,
        });
        depthIncomplete = true;
        break;
      }
      const evaluationRef = referenceDepthIterationDecision(evaluation);
      if (evaluationArtifactDigest !== evaluationRef.digest) {
        throw new Error("Semantic Depth Iteration Decision CAS mismatch");
      }
      currentFamilyRegistry = await record.recordSemanticDepthIteration(
        plan.campaignId,
        plan.runId,
        {
          queue: currentQueue.value,
          synthesis,
          decision: evaluation,
        },
      );
      let storedRegistryDigest = await dependencies.artifactStore.putJson(
        currentFamilyRegistry.value,
      );
      if (storedRegistryDigest !== currentFamilyRegistry.ref.digest) {
        throw new Error("Approach Family Registry CAS mismatch");
      }
      const depthVerificationHypotheses =
        await materializeDepthVerificationHypotheses(
          dependencies.artifactStore,
          { queue: currentQueue.value, decision: evaluation },
        );
      for (const hypothesis of depthVerificationHypotheses) {
        const proposal = synthesis.proposals.find(
          (candidate) => candidate.id === hypothesis.proposal.id,
        );
        if (proposal === undefined) {
          throw new Error("Depth Verification lost its Chain Proposal");
        }
        const familyIds = new Set(
          proposal.itemIds.flatMap(
            (itemId) =>
              currentQueue.value.items
                .find((item) => item.id === itemId)
                ?.families.map((family) => family.id) ?? [],
          ),
        );
        if (familyIds.size === 0) {
          throw new Error("Depth Verification is not bound to a Family");
        }
        const verificationId = `verification:${hypothesis.ref.id.slice("sha256:".length)}`;
        const existingFamilies =
          depthVerificationFamilies.get(verificationId) ?? new Set();
        for (const familyId of familyIds) existingFamilies.add(familyId);
        depthVerificationFamilies.set(verificationId, existingFamilies);
        verificationQueue.enqueue(hypothesis.ref);
      }
      const missingLinkWaves = materializeMissingLinkWaves({
        target: plan.target,
        manifest: plan.manifest,
        policy: plan.semanticPolicy,
        decision: evaluation,
        critique,
        maximumAdditionalWaves:
          plan.budgetPolicy.maxWorkWaves - 1 - usedMissingLinkWaves,
      });
      const scheduledGapIds = new Set(
        missingLinkWaves.flatMap((missingLinkWave) =>
          missingLinkWave.gaps.map((gap) => gap.id),
        ),
      );
      const unscheduledGaps = evaluation.actions
        .filter(
          (action) =>
            action.kind === "schedule-missing-link" &&
            !scheduledGapIds.has(action.gap.id),
        )
        .map((action) => {
          if (action.kind !== "schedule-missing-link") {
            throw new Error("Missing-link Gap narrowing failed");
          }
          return action.gap;
        });
      const missingLinkWaveRecords = [];
      const followUpQueues = [];
      for (const missingLinkWave of missingLinkWaves) {
        const planRef = referenceSemanticMissingLinkWavePlan(missingLinkWave);
        const storedPlanDigest =
          await dependencies.artifactStore.putJson(missingLinkWave);
        if (storedPlanDigest !== planRef.digest) {
          throw new Error("Semantic Missing-link Wave Plan CAS mismatch");
        }
        const gaps = new Map(missingLinkWave.gaps.map((gap) => [gap.id, gap]));
        const scheduled = [...missingLinkWave.leases]
          .sort((left, right) => compareText(left.id, right.id))
          .map((lease) => {
            const gap = gaps.get(lease.assignment.gapId);
            if (gap === undefined) {
              throw new Error("Missing-link Work Lease lost its Critic Gap");
            }
            const ordinal = nextFinderOrdinal;
            nextFinderOrdinal += 1;
            return {
              lease,
              gap,
              ordinal,
              attemptPlan: materializeMissingLinkFinderAttempt({
                run: plan,
                wave: missingLinkWave,
                lease,
                gap,
                attemptId: campaignAttemptId(plan.runId, lease.id, 1),
              }),
            };
          });
        const missingLinkAttempts = await Promise.all(
          scheduled.map(async ({ attemptPlan, lease, ordinal }) => {
            const result = await executeRecordedSemanticAttempt(
              record,
              dependencies,
              attemptPlan,
              {
                kind: "campaign-attempt-intent",
                schemaVersion: 2,
                campaignId: plan.campaignId,
                runId: plan.runId,
                attemptId: attemptPlan.attemptId,
                ordinal,
                mode: "execute",
                attemptPlanDigest: sha256Digest(attemptPlan),
                role: "finder",
                leaseId: lease.id,
                workWaveDigest: missingLinkWave.ref.digest,
                predecessorDecisionDigest: missingLinkWave.predecessor.digest,
              },
              (checkpoint) => verificationQueue.enqueue(checkpoint.subject),
            );
            if (
              result.ref.role !== "finder" ||
              result.value.role !== "finder"
            ) {
              throw new Error("Missing-link Finder returned another role");
            }
            return {
              ref: { ...result.ref, role: "finder" as const },
              value: { ...result.value, role: "finder" as const },
              expectedLeaseId: lease.id,
              maxCandidates: lease.budget.maxHypotheses,
            };
          }),
        );
        const terminal = await closeSemanticWaveBarrier(
          dependencies.artifactStore,
          missingLinkWave,
          preparation.input.canonicalFileManifest.entries,
          missingLinkAttempts,
        );
        missingLinkWaveRecords.push({ plan: planRef, terminal });
        usedMissingLinkWaves += 1;
        for (const ref of terminal.hypotheses) {
          const value = sourceBoundHypothesisArtifactSchema.parse(
            await dependencies.artifactStore.readJson(ref.digest),
          );
          subjectArtifacts.set(ref.digest, { ref, value });
        }
        for (const ref of terminal.routeFragments) {
          const value = routeFragmentArtifactSchema.parse(
            await dependencies.artifactStore.readJson(ref.digest),
          );
          subjectArtifacts.set(ref.digest, { ref, value });
        }
        for (const ref of terminal.frontierGaps) {
          const value = frontierGapArtifactSchema.parse(
            await dependencies.artifactStore.readJson(ref.digest),
          );
          subjectArtifacts.set(ref.digest, { ref, value });
        }
        const projected = projectMissingLinkDepthWorkQueue({
          sourceQueue: currentQueue.value,
          synthesis,
          decision: evaluation,
          wave: missingLinkWave,
          terminal,
        });
        unscheduledGaps.push(...projected.unresolvedGaps);
        if (projected.queue !== undefined) {
          const storedQueueDigest = await dependencies.artifactStore.putJson(
            projected.queue.value,
          );
          if (storedQueueDigest !== projected.queue.ref.digest) {
            throw new Error("Missing-link Depth Work Queue CAS mismatch");
          }
          followUpQueues.push(projected.queue);
        }
        if (terminal.issues.length > 0) depthIncomplete = true;
      }
      if (followUpQueues.length > 0) {
        currentFamilyRegistry = await record.recordSemanticMissingLinkEvidence(
          plan.campaignId,
          plan.runId,
          evaluationRef.digest,
          followUpQueues.map((queue) => queue.value),
        );
        storedRegistryDigest = await dependencies.artifactStore.putJson(
          currentFamilyRegistry.value,
        );
        if (storedRegistryDigest !== currentFamilyRegistry.ref.digest) {
          throw new Error("Approach Family Registry CAS mismatch");
        }
      }
      roundBatches.push({
        kind: "semantic-depth-batch-result",
        schemaVersion: 1,
        batchId: batch.id,
        synthesis: synthesisRecord,
        critique: {
          ref: referenceAdversarialCritique(critique),
          artifactDigest: critiqueArtifactDigest,
        },
        evaluation: {
          ref: evaluationRef,
          artifactDigest: evaluationArtifactDigest,
        },
        ...(missingLinkWaveRecords.length === 0
          ? {}
          : { missingLinkWaves: missingLinkWaveRecords }),
        ...(unscheduledGaps.length === 0 ? {} : { unscheduledGaps }),
        registry: currentFamilyRegistry.ref,
        ...(depthVerificationHypotheses.length === 0
          ? {}
          : {
              verificationHypotheses: depthVerificationHypotheses.map(
                (hypothesis) => hypothesis.ref,
              ),
            }),
      });
      if (unscheduledGaps.length > 0) depthIncomplete = true;
      if (!depthIncomplete) pendingDepthQueues.push(...followUpQueues);
      if (depthIncomplete) break;
    }
    if (roundBatches.length > 0) {
      depthRounds.push({
        kind: "semantic-depth-round",
        schemaVersion: 1,
        ordinal: depthRounds.length + 1,
        queue: currentQueue.ref,
        batches: roundBatches,
      });
    }
  }
  const depthResearch =
    depthRounds.length === 0
      ? undefined
      : semanticDepthResearchSchema.parse({
          kind: "semantic-depth-research",
          schemaVersion: 2,
          rounds: depthRounds,
        });

  const requestedVerifications = iterationDecision.actions
    .filter((action) => action.kind === "request-verification")
    .sort((left, right) => compareText(left.request.id, right.request.id));
  for (const action of requestedVerifications) {
    verificationQueue.enqueue(action.request.hypothesis);
  }
  await verificationQueue.drain();
  let verificationState = verificationQueue.snapshot();
  let verificationRefs = [...verificationState.refs];
  const familyVerificationResolutions = verificationRefs.flatMap(
    (verification) =>
      [...(depthVerificationFamilies.get(verification.verificationId) ?? [])]
        .sort(compareText)
        .map((familyId) => ({ familyId, verification })),
  );
  if (familyVerificationResolutions.length > 0) {
    currentFamilyRegistry =
      await record.recordSemanticFamilyVerificationOutcomes(
        plan.campaignId,
        plan.runId,
        familyVerificationResolutions,
      );
    const storedRegistryDigest = await dependencies.artifactStore.putJson(
      currentFamilyRegistry.value,
    );
    if (storedRegistryDigest !== currentFamilyRegistry.ref.digest) {
      throw new Error("Approach Family Registry CAS mismatch");
    }
  }
  const initialActionsPermitTerminalReview = iterationDecision.actions.every(
    (action) =>
      action.kind === "close" ||
      action.kind === "request-verification" ||
      action.kind === "admit-depth",
  );
  if (
    coverageObservations.length === 0 &&
    !depthIncomplete &&
    !verificationState.budgetExhausted &&
    !verificationState.unsupportedHypothesis &&
    !verificationRefs.some(
      (verification) => verification.outcome === "blocked",
    ) &&
    initialActionsPermitTerminalReview &&
    currentFamilyRegistry.ref.states.active === 0 &&
    currentFamilyRegistry.ref.states.blocked === 0 &&
    currentFamilyRegistry.ref.pendingVerifications === 0
  ) {
    const knownSubjectIds = new Set(
      [...subjectArtifacts.values()].map((subject) => subject.ref.id),
    );
    let consecutiveNoMaterialDelta = 0;
    while (
      consecutiveNoMaterialDelta < 2 &&
      1 + usedMissingLinkWaves + coverageReviews.length <
        plan.budgetPolicy.maxWorkWaves
    ) {
      const review = await executeCoverageReview(
        knownSubjectIds,
        coverageObservations.length + 1,
      );
      coverageReviews.push(review.trace);
      if (review.kind === "incomplete") {
        coverageReviewIncomplete = true;
        break;
      }
      coverageObservations.push(review.observation);
      for (const subjectId of review.observation.semanticSubjectIds) {
        knownSubjectIds.add(subjectId);
      }
      consecutiveNoMaterialDelta =
        review.observation.outcome === "no-material-delta"
          ? consecutiveNoMaterialDelta + 1
          : 0;
    }
    if (consecutiveNoMaterialDelta < 2) coverageReviewIncomplete = true;
    await verificationQueue.drain();
    verificationState = verificationQueue.snapshot();
    verificationRefs = [...verificationState.refs];
  }
  if (coverageObservations.length > 0 && !coverageReviewIncomplete) {
    const closure = closeSemanticCoverage({
      observations: coverageObservations,
      approachFamilyRegistry: currentFamilyRegistry.ref,
      verifications: verificationRefs,
    });
    if (closure.kind === "closed") {
      const storedClosureDigest = await dependencies.artifactStore.putJson(
        closure.value,
      );
      if (storedClosureDigest !== closure.ref.digest) {
        throw new Error("Semantic Coverage Closure CAS mismatch");
      }
      coverageClosure = closure.value;
      coverageClosureRef = closure.ref;
    } else {
      coverageReviewIncomplete = true;
    }
  }

  const attemptRecords = await record.listSemanticCampaignAttempts(
    plan.campaignId,
    plan.runId,
  );
  const attemptRefs = attemptRecords.flatMap((attempt) =>
    attempt.completion === undefined ? [] : [attempt.completion.value.result],
  );
  const attemptResults = await Promise.all(
    attemptRefs.map((ref) => readSemanticAttemptResult(dependencies, ref)),
  );
  const verificationViews = await Promise.all(
    verificationRefs.map(async (ref) => {
      const view = await record.readVerification(
        plan.campaignId,
        ref.verificationId,
      );
      if (view === undefined) {
        throw new Error(
          `Verification record is missing: ${ref.verificationId}`,
        );
      }
      return view;
    }),
  );
  const verifierUsages = verificationViews.flatMap((view) =>
    view.value.schemaVersion === 2 &&
    view.value.evidence.verifierUsage !== undefined
      ? [view.value.evidence.verifierUsage]
      : [],
  );
  const usage = aggregateSemanticCampaignUsage(
    attemptResults.map((result) => result.value),
    verifierUsages,
    verificationRefs.length,
    Math.ceil(performance.now() - campaignStartedAt),
  );
  const decision = depthIncomplete
    ? {
        kind: "incomplete" as const,
        reason: "depth-research-incomplete" as const,
      }
    : verificationState.budgetExhausted
      ? {
          kind: "incomplete" as const,
          reason: "verification-budget-exhausted" as const,
        }
      : verificationState.unsupportedHypothesis ||
          verificationRefs.some((ref) => ref.outcome === "blocked")
        ? {
            kind: "incomplete" as const,
            reason: "verification-blocked" as const,
          }
        : coverageReviewIncomplete
          ? {
              kind: "incomplete" as const,
              reason: "coverage-review-incomplete" as const,
            }
          : coverageClosure !== undefined
            ? { kind: "complete" as const, reason: "coverage-closed" as const }
            : {
                kind: "incomplete" as const,
                reason: "active-research-remains" as const,
              };
  return record.recordSemanticCampaignRunCompletion({
    kind: "campaign-run-completion",
    schemaVersion: 2,
    runId: plan.runId,
    campaignId: plan.campaignId,
    planDigest: start.planDigest,
    target: plan.target,
    manifest: plan.manifest,
    workWave: wave.ref,
    waveTerminal: waveTerminalRef,
    attempts: attemptRefs,
    iterationDecision,
    iterationDecisionRef: recordedIterationDecision.decision,
    approachFamilyRegistry: currentFamilyRegistry.ref,
    depthWorkQueue: depthWorkQueue.ref,
    ...(depthResearch === undefined ? {} : { depthResearch }),
    ...(coverageReviews.length === 0 ? {} : { coverageReviews }),
    ...(coverageClosure === undefined || coverageClosureRef === undefined
      ? {}
      : { coverageClosure, coverageClosureRef }),
    verifications: verificationRefs,
    usage,
    decision,
  });
}

function aggregateSemanticCampaignUsage(
  attempts: readonly ModelAttemptResultV2[],
  verifierUsages: readonly ModelAttemptUsageV2[],
  verifierAttempts: number,
  campaignWallTimeMs: number,
) {
  const explorationUsages = attempts.flatMap((attempt) =>
    attempt.usage === undefined ? [] : [attempt.usage],
  );
  const ownerUsage = (
    usages: readonly ModelAttemptUsageV2[],
    modelAttempts: number,
  ) => ({
    modelAttempts,
    reportedModelAttempts: usages.filter(
      (usage) => usage.measurement === "reported",
    ).length,
    modelWallTimeMs: usages.reduce(
      (total, usage) => total + usage.wallTimeMs,
      0,
    ),
    modelTurns: usages.reduce((total, usage) => total + usage.modelTurns, 0),
    modelTokens: usages.reduce(
      (total, usage) => ({
        input: total.input + usage.modelTokens.input,
        cacheCreation: total.cacheCreation + usage.modelTokens.cacheCreation,
        cacheRead: total.cacheRead + usage.modelTokens.cacheRead,
        output: total.output + usage.modelTokens.output,
        total: total.total + usage.modelTokens.total,
      }),
      { input: 0, cacheCreation: 0, cacheRead: 0, output: 0, total: 0 },
    ),
    structuredOutputBytes: usages.reduce(
      (total, usage) => total + usage.structuredOutputBytes,
      0,
    ),
    estimatedCostUsd: usages.reduce(
      (total, usage) => total + (usage.estimatedCostUsd ?? 0),
      0,
    ),
    estimatedCostMeasurement:
      usages.length === modelAttempts &&
      usages.every((usage) => usage.estimatedCostUsd !== undefined)
        ? ("reported" as const)
        : ("partial" as const),
    source: usages.reduce(
      (total, usage) => ({
        queries: total.queries + usage.source.queries,
        scanBytes: total.scanBytes + usage.source.scanBytes,
        responseBytes: total.responseBytes + usage.source.responseBytes,
      }),
      { queries: 0, scanBytes: 0, responseBytes: 0 },
    ),
  });
  const owners = {
    exploration: ownerUsage(explorationUsages, attempts.length),
    verification: ownerUsage(verifierUsages, verifierAttempts),
  };
  const allUsages = [...explorationUsages, ...verifierUsages];
  const modelTokens = allUsages.reduce(
    (total, usage) => ({
      input: total.input + usage.modelTokens.input,
      cacheCreation: total.cacheCreation + usage.modelTokens.cacheCreation,
      cacheRead: total.cacheRead + usage.modelTokens.cacheRead,
      output: total.output + usage.modelTokens.output,
      total: total.total + usage.modelTokens.total,
    }),
    { input: 0, cacheCreation: 0, cacheRead: 0, output: 0, total: 0 },
  );
  return {
    kind: "semantic-campaign-usage" as const,
    schemaVersion: 2 as const,
    measurement:
      allUsages.length === attempts.length + verifierAttempts &&
      allUsages.every((usage) => usage.measurement === "reported")
        ? ("reported" as const)
        : ("partial" as const),
    modelAttempts: attempts.length + verifierAttempts,
    reportedModelAttempts: allUsages.filter(
      (usage) => usage.measurement === "reported",
    ).length,
    campaignWallTimeMs,
    modelWallTimeMs: allUsages.reduce(
      (total, usage) => total + usage.wallTimeMs,
      0,
    ),
    modelTurns: allUsages.reduce((total, usage) => total + usage.modelTurns, 0),
    modelTokens,
    structuredOutputBytes: allUsages.reduce(
      (total, usage) => total + usage.structuredOutputBytes,
      0,
    ),
    estimatedCostUsd: allUsages.reduce(
      (total, usage) => total + (usage.estimatedCostUsd ?? 0),
      0,
    ),
    estimatedCostMeasurement:
      allUsages.length === attempts.length + verifierAttempts &&
      allUsages.every((usage) => usage.estimatedCostUsd !== undefined)
        ? ("reported" as const)
        : ("partial" as const),
    source: allUsages.reduce(
      (total, usage) => ({
        queries: total.queries + usage.source.queries,
        scanBytes: total.scanBytes + usage.source.scanBytes,
        responseBytes: total.responseBytes + usage.source.responseBytes,
      }),
      { queries: 0, scanBytes: 0, responseBytes: 0 },
    ),
    owners,
  };
}

function sameCampaignValue(left: unknown, right: unknown): boolean {
  return canonicalJson(left) === canonicalJson(right);
}

async function executeRun(
  record: ResearchRecord,
  dependencies: CampaignExecutionDependencies,
  plan: CampaignRunPlan,
  planDigest: string,
) {
  const preparation = await record.readPreparation(plan.campaignId);
  if (preparation === undefined) {
    throw new Error(`Campaign not found: ${plan.campaignId}`);
  }
  const mapArtifact = await dependencies.artifactStore.readJson(
    plan.surfaceMap.digest,
  );
  if (sha256Digest(mapArtifact) !== plan.surfaceMap.digest) {
    throw new Error("Campaign Surface Map artifact digest mismatch");
  }
  const surfaceMap = surfaceMapSchema.parse(mapArtifact);
  const policyArtifact = await dependencies.artifactStore.readJson(
    plan.explorationPolicy.digest,
  );
  if (sha256Digest(policyArtifact) !== plan.explorationPolicy.digest) {
    throw new Error("Campaign Exploration Policy artifact digest mismatch");
  }
  const policy = explorationBootstrapPolicySchema.parse(policyArtifact);
  if (
    surfaceMap.targetSnapshot.id !== preparation.input.targetSnapshot.id ||
    surfaceMap.targetSnapshot.digest !== preparation.input.targetSnapshot.digest
  ) {
    throw new Error("Campaign Surface Map targets a different Snapshot");
  }
  if (
    policy.eligibleModelFamilies.length !== 1 ||
    policy.eligibleModelFamilies[0] !== plan.finder.modelProfile.family
  ) {
    throw new Error("Campaign Finder profile does not satisfy its Work Wave");
  }

  const bootstrap = openExploration({
    surfaceMap: { ref: plan.surfaceMap, value: surfaceMap },
    policy: { ref: plan.explorationPolicy, value: policy },
  }).decide({
    kind: "bootstrap",
    map: plan.surfaceMap,
    policy: plan.explorationPolicy,
  });
  if (bootstrap.kind !== "run-wave") {
    throw new Error(`Campaign cannot execute Surface Map: ${bootstrap.kind}`);
  }
  const wave = bootstrap.plan;
  const focusAreas = new Map(
    wave.focusAreas.map((focusArea) => [focusArea.id, focusArea]),
  );
  let recordedAttempts = await record.listCampaignAttempts(
    plan.campaignId,
    plan.runId,
  );
  for (const attempt of recordedAttempts) {
    if (attempt.completion !== undefined) continue;
    const value = finderAttemptResultSchema.parse({
      kind: "finder-attempt-result",
      schemaVersion: 1,
      attemptId: attempt.intent.attemptId,
      leaseId: attempt.intent.leaseId,
      status: "orphaned",
      reason: "orphaned-execution-requires-fresh-attempt",
    });
    const digest = await dependencies.artifactStore.putJson(value);
    await completeCampaignAttempt(record, attempt.intent, {
      ...finderResultRef(value),
      digest,
    });
  }
  recordedAttempts = await record.listCampaignAttempts(
    plan.campaignId,
    plan.runId,
  );
  let usedExecutions = recordedAttempts.filter(
    (attempt) => attempt.intent.mode === "execute",
  ).length;
  const scheduled: {
    readonly intent: Extract<CampaignAttemptIntent, { mode: "execute" }>;
    readonly attemptPlan: ReturnType<typeof attemptPlanSchema.parse>;
  }[] = [];

  for (const lease of wave.leases) {
    const prior = recordedAttempts.filter(
      (attempt) => attempt.intent.leaseId === lease.id,
    );
    const latest = prior.at(-1);
    const latestValue =
      latest?.completion === undefined
        ? undefined
        : await readFinderResult(dependencies, latest.completion.value.result);
    if (latestValue !== undefined && latestValue.status !== "orphaned") {
      continue;
    }
    const ordinal = (latest?.intent.ordinal ?? 0) + 1;
    const attemptId = campaignAttemptId(plan.runId, lease.id, ordinal);
    if (usedExecutions >= plan.budget.maxFinderAttempts) {
      if (latestValue?.status === "orphaned") continue;
      const intent: CampaignAttemptIntent = {
        kind: "campaign-attempt-intent",
        schemaVersion: 1,
        campaignId: plan.campaignId,
        runId: plan.runId,
        attemptId,
        leaseId: lease.id,
        ordinal,
        workWaveDigest: wave.ref.digest,
        mode: "cancel",
        reason: "campaign-finder-attempt-limit",
      };
      await record.recordCampaignAttemptStart(intent);
      const value = finderAttemptResultSchema.parse({
        kind: "finder-attempt-result",
        schemaVersion: 1,
        attemptId,
        leaseId: lease.id,
        status: "cancelled",
        reason: "campaign-finder-attempt-limit",
      });
      const digest = await dependencies.artifactStore.putJson(value);
      await completeCampaignAttempt(record, intent, {
        ...finderResultRef(value),
        digest,
      });
      continue;
    }

    const focusArea = focusAreas.get(lease.focusAreaId);
    if (focusArea === undefined) {
      throw new Error(`Work Lease has no Focus Area: ${lease.id}`);
    }
    const materialized = finderAttemptMaterializationSchema.parse(
      await dependencies.attemptPlanMaterializer.materialize({
        run: {
          runId: plan.runId,
          finder: plan.finder,
          maxWallTimeMs: plan.budget.maxWallTimeMs,
          maxModelTokens: plan.budget.maxModelTokens,
        },
        attemptOrdinal: ordinal,
        targetSnapshot: preparation.input.targetSnapshot,
        surfaceMap,
        wave,
        focusArea,
        lease,
      }),
    );
    const attemptPlan = attemptPlanSchema.parse({
      kind: "attempt-plan",
      schemaVersion: 1,
      attemptId,
      leaseId: lease.id,
      role: "finder",
      target: {
        id: preparation.input.targetSnapshot.id,
        digest: preparation.input.targetSnapshot.digest,
      },
      modelProfile: materialized.modelProfile,
      prompt: materialized.prompt,
      ...(materialized.sourceEvidence === undefined
        ? {}
        : { sourceToolPolicy: materialized.sourceEvidence.policy }),
      budget: {
        maxWallTimeMs: lease.budget.maxWallTimeMs,
        maxOutputBytes: materialized.maxOutputBytes,
        maxHypotheses: lease.budget.maxHypotheses,
        ...(materialized.sourceEvidence === undefined
          ? {}
          : { maxSourceQueries: materialized.sourceEvidence.maxQueries }),
      },
    });
    const attemptPlanDigest =
      await dependencies.artifactStore.putJson(attemptPlan);
    const intent = {
      kind: "campaign-attempt-intent" as const,
      schemaVersion: 1 as const,
      campaignId: plan.campaignId,
      runId: plan.runId,
      attemptId,
      leaseId: lease.id,
      ordinal,
      workWaveDigest: wave.ref.digest,
      mode: "execute" as const,
      attemptPlanDigest,
    };
    const started = await record.recordCampaignAttemptStart(intent);
    if (started.disposition !== "started") {
      throw new Error(`Fresh Attempt intent is already occupied: ${attemptId}`);
    }
    scheduled.push({ intent, attemptPlan });
    usedExecutions += 1;
  }

  const settled = await Promise.allSettled(
    scheduled.map(async ({ intent, attemptPlan }) => {
      const executed = await dependencies.modelExecution.run(attemptPlan);
      const value = finderAttemptResultSchema.parse(executed.value);
      const ref = attemptExecutionResultRefSchema.parse(executed.ref);
      const storedDigest = await dependencies.artifactStore.putJson(value);
      if (
        executed.status !== value.status ||
        ref.digest !== storedDigest ||
        ref.attemptId !== value.attemptId ||
        ref.leaseId !== value.leaseId ||
        value.attemptId !== attemptPlan.attemptId ||
        value.leaseId !== attemptPlan.leaseId
      ) {
        throw new Error(
          `Finder result is not bound to Work Lease: ${attemptPlan.leaseId}`,
        );
      }
      await completeCampaignAttempt(record, intent, ref);
    }),
  );
  const rejected = settled.find(
    (result): result is PromiseRejectedResult => result.status === "rejected",
  );
  if (rejected !== undefined) throw rejected.reason;

  recordedAttempts = await record.listCampaignAttempts(
    plan.campaignId,
    plan.runId,
  );
  const allAttemptRefs: AttemptExecutionResultRef[] = [];
  const latestByLease = new Map<
    string,
    { value: FinderAttemptResult; ref: AttemptExecutionResultRef }
  >();
  for (const attempt of recordedAttempts) {
    if (attempt.completion === undefined) {
      throw new Error(
        `Attempt is still in progress: ${attempt.intent.attemptId}`,
      );
    }
    const ref = attempt.completion.value.result;
    const value = await readFinderResult(dependencies, ref);
    allAttemptRefs.push(ref);
    latestByLease.set(attempt.intent.leaseId, { value, ref });
  }
  const terminalResults = wave.leases.map((lease) => {
    const result = latestByLease.get(lease.id);
    if (result === undefined) {
      throw new Error(`Work Lease has no terminal Attempt: ${lease.id}`);
    }
    return result;
  });
  terminalResults.sort((left, right) =>
    compareText(left.ref.leaseId, right.ref.leaseId),
  );

  const completedExploration = openExploration({
    surfaceMap: { ref: plan.surfaceMap, value: surfaceMap },
    policy: { ref: plan.explorationPolicy, value: policy },
    waveCompletion: {
      state: wave.state,
      wave: { ref: wave.ref, value: wave },
      results: terminalResults,
    },
  }).decide({
    kind: "wave-completed",
    map: plan.surfaceMap,
    state: wave.state,
    wave: wave.ref,
    results: terminalResults.map((result) => result.ref),
  });
  if (
    completedExploration.kind !== "verify" &&
    completedExploration.kind !== "blocked"
  ) {
    throw new Error(
      `Campaign Work Wave produced an invalid next phase: ${completedExploration.kind}`,
    );
  }

  const hypotheses = new Map<string, SourceBoundHypothesis>();
  for (const result of terminalResults) {
    if (result.value.status !== "completed") continue;
    for (const candidate of result.value.output.hypotheses) {
      hypotheses.set(sha256Digest(candidate), candidate);
    }
  }
  const verification = openVerification({
    record,
    artifactStore: dependencies.artifactStore,
    independentVerifier: dependencies.independentVerifier,
    labControl: dependencies.labControl,
  });
  const verificationRefs = [];
  if (completedExploration.kind === "verify") {
    for (const hypothesisRef of completedExploration.hypotheses) {
      const hypothesis = hypotheses.get(hypothesisRef.digest);
      if (hypothesis === undefined) {
        throw new Error(
          `Accepted Hypothesis artifact is missing: ${hypothesisRef.id}`,
        );
      }
      if (hypothesis.attackerPremise === "unresolved") continue;
      const verificationId = `verification:${hypothesisRef.id.slice("sha256:".length)}`;
      verificationRefs.push(
        await verification.verify({
          kind: "verification-plan",
          schemaVersion: 1,
          verificationId,
          campaignId: plan.campaignId,
          targetSnapshot: preparation.input.targetSnapshot,
          scope: { permittedAttacker: hypothesis.attackerPremise },
          hypothesis,
          hypothesisDigest: hypothesisRef.digest,
          labBaseline: plan.verification.labBaseline,
          verifierModelProfile: plan.verification.verifierModelProfile,
          promptSet: plan.verification.promptSet,
          verificationPolicy: plan.verification.verificationPolicy,
          experimentRegistry: plan.verification.experimentRegistry,
          budget: plan.budget.verification,
        }),
      );
    }
  }
  verificationRefs.sort((left, right) =>
    compareText(left.verificationId, right.verificationId),
  );
  const verificationViews = await Promise.all(
    verificationRefs.map(async (ref) => {
      const view = await record.readVerification(
        plan.campaignId,
        ref.verificationId,
      );
      if (view === undefined) {
        throw new Error(
          `Verification record is missing: ${ref.verificationId}`,
        );
      }
      return view;
    }),
  );
  const conclusiveVerificationRefs = verificationViews
    .filter((view) => view.ref.outcome !== "blocked")
    .map((view) => view.ref);
  const calibrationReview =
    plan.calibrationContext !== undefined &&
    dependencies.calibrationReview !== undefined &&
    conclusiveVerificationRefs.length > 0
      ? calibrationReviewResultSchema.parse(
          await dependencies.calibrationReview.review({
            calibrationContext: plan.calibrationContext,
            campaign: {
              campaignId: plan.campaignId,
              runId: plan.runId,
            },
            terminalVerifications: conclusiveVerificationRefs,
          }),
        )
      : undefined;
  if (
    calibrationReview?.kind === "complete" &&
    calibrationReview.evidence.calibrationContextDigest !==
      plan.calibrationContext?.digest
  ) {
    throw new Error("Calibration Review targets a different context");
  }
  const iteration = reviewIteration({
    campaignId: plan.campaignId,
    runId: plan.runId,
    mapDigest: plan.surfaceMap.digest,
    workWaveDigest: wave.ref.digest,
    explorationKind: completedExploration.kind,
    maxFinderAttempts: plan.budget.maxFinderAttempts,
    executedAttempts: usedExecutions,
    attemptStatuses: terminalResults.map((result) => result.value.status),
    verifications: verificationViews,
    ...(calibrationReview === undefined ? {} : { calibrationReview }),
  });
  if (iteration.finiteWork !== null) {
    const stored = await dependencies.artifactStore.putJson(
      iteration.finiteWork,
    );
    if (
      iteration.decision.kind !== "continue-unresolved-work" ||
      stored !== iteration.decision.next.digest
    ) {
      throw new Error("Iteration Review finite work digest mismatch");
    }
  }
  return record.recordCampaignRunCompletion({
    kind: "campaign-run-completion",
    schemaVersion: 1,
    runId: plan.runId,
    campaignId: plan.campaignId,
    planDigest,
    workWave: wave.ref,
    attempts: allAttemptRefs,
    verifications: verificationRefs,
    decision: iteration.decision,
  });
}

export function openCampaignControl(
  record: ResearchRecord,
  dependencies?: CampaignExecutionDependencies,
  preparationArtifactStore?: JsonArtifactStore,
  allowLegacyMapFirstExecution = false,
): CampaignControl {
  const validatePreparationHandoff = async (
    preparation: PreparationRecord,
  ): Promise<void> => {
    if (
      !("schemaVersion" in preparation.input) ||
      preparation.input.schemaVersion !== 3
    ) {
      return;
    }
    if (preparationArtifactStore === undefined) {
      throw new CampaignPreparationIntegrityError("artifact-store-unavailable");
    }
    await validatePreparedTargetIntake(
      preparation.input,
      preparationArtifactStore,
    );
  };

  const prepareCampaign: CampaignRunner["prepare"] = async (input) => {
    const parsedInput = newCampaignInputSchema.parse(input);
    let targetFileManifest;
    if (
      "schemaVersion" in parsedInput &&
      (parsedInput.schemaVersion === 2 || parsedInput.schemaVersion === 3)
    ) {
      if (preparationArtifactStore === undefined) {
        throw new CampaignPreparationIntegrityError(
          "artifact-store-unavailable",
        );
      }
      if (parsedInput.schemaVersion === 3) {
        await validatePreparedTargetIntake(
          parsedInput,
          preparationArtifactStore,
        );
      }
      targetFileManifest = await persistTargetFileManifest(
        preparationArtifactStore,
        parsedInput,
      );
    }
    const result = await record.recordPreparation(
      parsedInput,
      targetFileManifest,
    );
    if (
      result.disposition === "occupied" &&
      result.preparation.inputDigest !== result.requestedInputDigest
    ) {
      throw new CampaignPreparationConflictError(parsedInput.campaignId);
    }
    return projectCampaign(result.preparation);
  };

  return {
    runner: {
      prepare: prepareCampaign,
      prepareFromTargetIntake: async (input) => {
        if (preparationArtifactStore === undefined) {
          throw new CampaignPreparationIntegrityError(
            "artifact-store-unavailable",
          );
        }
        const campaignInput = await materializeTargetIntakeCampaignInput(
          input,
          preparationArtifactStore,
        );
        return prepareCampaign(campaignInput);
      },
      run: async (value) => {
        if (
          typeof value === "object" &&
          value !== null &&
          "schemaVersion" in value &&
          value.schemaVersion === 2
        ) {
          const plan = campaignRunPlanV2Schema.parse(value);
          if (dependencies === undefined) {
            throw new Error("Campaign execution dependencies are unavailable");
          }
          const preparation = await record.readPreparation(plan.campaignId);
          if (preparation === undefined) {
            throw new Error(`Campaign not found: ${plan.campaignId}`);
          }
          await validatePreparationHandoff(preparation);
          return (
            await ("workWave" in plan
              ? executeSemanticFinderWave(record, dependencies, plan)
              : executeDefaultSemanticCampaign(record, dependencies, plan))
          ).ref;
        }
        const plan = campaignRunPlanSchema.parse(value);
        const completed = await record.readCampaignRun(
          plan.campaignId,
          plan.runId,
        );
        if (completed !== undefined) {
          if (
            completed.value.schemaVersion !== 1 ||
            completed.value.planDigest !== sha256Digest(plan)
          ) {
            throw new CampaignRunConflictError(plan.campaignId, plan.runId);
          }
          return completed.ref;
        }
        if (!allowLegacyMapFirstExecution) {
          throw new LegacyMapFirstExecutionDisabledError();
        }
        const start = await record.recordCampaignRunStart(plan);
        if (start.disposition === "completed") return start.run.ref;
        if (dependencies === undefined) {
          throw new Error("Campaign execution dependencies are unavailable");
        }
        return (await executeRun(record, dependencies, plan, start.planDigest))
          .ref;
      },
    },
    reader: {
      read: async (campaignId) => {
        const preparation = await record.readPreparation(campaignId);
        if (preparation === undefined) {
          throw new Error(`Campaign not found: ${campaignId}`);
        }
        await validatePreparationHandoff(preparation);
        return projectCampaign(preparation);
      },
      inspect: async (campaignId, subject): Promise<SubjectView> => {
        if (subject.kind === "progress") {
          const progress = await record.readCampaignProgress(campaignId);
          if (progress === undefined) {
            throw new Error(`Campaign not found: ${campaignId}`);
          }
          return progress;
        }
        if (subject.kind === "finding-mechanism-groups") {
          const run = await record.readCampaignRun(campaignId, subject.runId);
          if (run === undefined) {
            throw new Error(
              `Campaign run not found: ${campaignId}/${subject.runId}`,
            );
          }
          if (preparationArtifactStore === undefined) {
            throw new FindingMechanismGroupingIntegrityError(
              `${campaignId}:${subject.runId}`,
              "artifact-store-unavailable",
            );
          }
          const verificationRefs =
            "verifications" in run.value &&
            run.value.verifications !== undefined
              ? run.value.verifications
              : [];
          const verifications = await Promise.all(
            verificationRefs.map(async (ref) => {
              const view = await record.readVerification(
                campaignId,
                ref.verificationId,
              );
              if (
                view === undefined ||
                canonicalJson(view.ref) !== canonicalJson(ref)
              ) {
                throw new FindingMechanismGroupingIntegrityError(
                  ref.verificationId,
                  "run-verification-ref-mismatch",
                );
              }
              return view;
            }),
          );
          return projectFindingMechanismGroups({
            campaignId,
            runId: subject.runId,
            verifications,
            artifactStore: preparationArtifactStore,
          });
        }
        if (subject.kind === "run") {
          const run = await record.readCampaignRun(campaignId, subject.runId);
          if (run === undefined) {
            throw new Error(
              `Campaign run not found: ${campaignId}/${subject.runId}`,
            );
          }
          return {
            kind: "run",
            campaignId,
            runId: subject.runId,
            occurredAt: run.occurredAt,
            value: run.value,
          };
        }
        const preparation = await record.readPreparation(campaignId);
        if (preparation === undefined) {
          throw new Error(`Campaign not found: ${campaignId}`);
        }
        await validatePreparationHandoff(preparation);
        return {
          kind: subject.kind,
          campaignId,
          preparedAt: preparation.occurredAt,
          inputDigest: preparation.inputDigest,
          input: preparation.input,
          ...(preparation.targetFileManifest === undefined
            ? {}
            : { targetFileManifest: preparation.targetFileManifest }),
        };
      },
    },
  };
}
