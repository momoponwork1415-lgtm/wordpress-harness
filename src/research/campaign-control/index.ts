import {
  CampaignPreparationConflictError,
  newCampaignInputSchema,
  type CampaignReader,
  type CampaignRunner,
  type CampaignView,
  type SubjectView,
} from "../contracts.js";
import {
  openExploration,
  type AttemptExecutionResultRef,
  type FinderAttemptResult,
  type SourceBoundHypothesis,
} from "../exploration/index.js";
import {
  attemptExecutionResultRefSchema,
  explorationBootstrapPolicySchema,
  finderAttemptResultSchema,
} from "../exploration/contracts.js";
import { attemptPlanSchema } from "../model-execution/contracts.js";
import { sha256Digest } from "../research-record/canonical-json.js";
import type {
  PreparationRecord,
  ResearchRecord,
} from "../research-record/index.js";
import { surfaceMapSchema } from "../source-mapping/contracts.js";
import {
  openVerification,
  type VerificationRecordView,
} from "../verification/index.js";
import {
  campaignRunPlanSchema,
  finderAttemptMaterializationSchema,
  type CampaignAttemptIntent,
  type CampaignExecutionDependencies,
  type CampaignRunPlan,
  type IterationDecision,
} from "./contracts.js";

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

function iterationDecision(
  verifications: readonly VerificationRecordView[],
  explorationKind: "verify" | "blocked",
): IterationDecision {
  const conclusive = verifications.filter(
    (verification) => verification.ref.outcome !== "blocked",
  );
  if (conclusive.length > 0) {
    return {
      kind: "await-calibration",
      terminalVerifications: conclusive.map((verification) => verification.ref),
    };
  }
  const verificationReasons = verifications.flatMap((verification) =>
    verification.value.outcome.kind === "blocked"
      ? [verification.value.outcome.reason]
      : [],
  );
  return {
    kind: "blocked-capability",
    reasons:
      verificationReasons.length > 0
        ? [...new Set(verificationReasons)].sort(compareText)
        : [
            explorationKind === "blocked"
              ? "no-source-bound-hypothesis"
              : "unsupported-attacker-premise",
          ],
  };
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
      budget: {
        maxWallTimeMs: lease.budget.maxWallTimeMs,
        maxOutputBytes: materialized.maxOutputBytes,
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
  const decision = iterationDecision(
    verificationViews,
    completedExploration.kind,
  );
  return record.recordCampaignRunCompletion({
    kind: "campaign-run-completion",
    schemaVersion: 1,
    runId: plan.runId,
    campaignId: plan.campaignId,
    planDigest,
    workWave: wave.ref,
    attempts: allAttemptRefs,
    verifications: verificationRefs,
    decision,
  });
}

export function openCampaignControl(
  record: ResearchRecord,
  dependencies?: CampaignExecutionDependencies,
): CampaignControl {
  return {
    runner: {
      prepare: async (input) => {
        const parsedInput = newCampaignInputSchema.parse(input);
        const result = await record.recordPreparation(parsedInput);
        if (
          result.disposition === "occupied" &&
          result.preparation.inputDigest !== result.requestedInputDigest
        ) {
          throw new CampaignPreparationConflictError(parsedInput.campaignId);
        }
        return projectCampaign(result.preparation);
      },
      run: async (value) => {
        const plan = campaignRunPlanSchema.parse(value);
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
        return projectCampaign(preparation);
      },
      inspect: async (campaignId, subject): Promise<SubjectView> => {
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
        return {
          kind: subject.kind,
          campaignId,
          preparedAt: preparation.occurredAt,
          inputDigest: preparation.inputDigest,
          input: preparation.input,
        };
      },
    },
  };
}
