import {
  isCurrentSemanticResearchBudgetPolicy,
  type AnyCampaignRunRecordView,
  type CampaignRunPlan,
  type CampaignRunPlanV2,
  type CampaignRunPlanV3,
  type CampaignAttemptRecordView,
  type CampaignAttemptRecordViewV2,
} from "../campaign-control/contracts.js";
import {
  campaignProgressViewV2Schema,
  type CampaignProgressUsage,
  type CampaignProgressView,
  type CampaignProgressViewV1,
} from "../campaign-progress-contracts.js";
import { modelAttemptResultV2Schema } from "../model-execution/contracts.js";
import type { ModelAttemptUsageV2 } from "../model-attempt-usage-contracts.js";
import type { VerificationRecordView } from "../verification/contracts.js";
import type {
  JsonArtifactStore,
  SemanticFinderCheckpointRecordView,
  ValidationIntentRecordView,
  ValidationCompletionRecordView,
} from "./contracts.js";

// Validated read records only; no SQL rows, database handles, or write capability.
interface CampaignProgressRecords {
  readonly campaignId: string;
  readonly runs: readonly {
    readonly plan: CampaignRunPlan | CampaignRunPlanV2 | CampaignRunPlanV3;
    readonly completed?: AnyCampaignRunRecordView;
  }[];
  readonly attempts: readonly (
    CampaignAttemptRecordView | CampaignAttemptRecordViewV2
  )[];
  readonly checkpoints: readonly SemanticFinderCheckpointRecordView[];
  readonly verifications: readonly {
    readonly plan: { readonly verificationId: string };
    readonly startedAt: string;
    readonly startedLedgerHead: number;
    readonly completed?: VerificationRecordView;
  }[];
  readonly validationIntents: readonly ValidationIntentRecordView[];
  readonly validationCompletions: readonly ValidationCompletionRecordView[];
  readonly depthIterations: number;
  readonly lastDurableEvent: CampaignProgressView["lastDurableEvent"];
}

function aggregateProgressUsage(
  modelAttempts: number,
  usages: readonly ModelAttemptUsageV2[],
  incomplete: boolean,
): CampaignProgressUsage {
  const modelTokens = usages.reduce(
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
    measurement:
      !incomplete &&
      usages.length === modelAttempts &&
      usages.every((usage) => usage.measurement === "reported")
        ? "reported"
        : "partial",
    modelAttempts,
    reportedModelAttempts: usages.filter(
      (usage) => usage.measurement === "reported",
    ).length,
    modelTurns: usages.reduce((total, usage) => total + usage.modelTurns, 0),
    modelTokens,
    estimatedCostUsd: usages.reduce(
      (total, usage) => total + (usage.estimatedCostUsd ?? 0),
      0,
    ),
    source: usages.reduce(
      (total, usage) => ({
        queries: total.queries + usage.source.queries,
        scanBytes: total.scanBytes + usage.source.scanBytes,
        responseBytes: total.responseBytes + usage.source.responseBytes,
      }),
      { queries: 0, scanBytes: 0, responseBytes: 0 },
    ),
  };
}

export async function projectCampaignProgress(
  records: CampaignProgressRecords,
  artifactStore: Pick<JsonArtifactStore, "readJson"> | undefined,
): Promise<CampaignProgressView> {
  const { campaignId, runs } = records;
  const completedRuns = runs.filter((run) => run.completed !== undefined);
  const activeRuns = runs.length - completedRuns.length;
  const attempts = records.attempts.map((attempt) => ({
    attempt,
    role: "role" in attempt.intent ? attempt.intent.role : ("finder" as const),
  }));
  const completedAttempts = attempts.filter(
    ({ attempt }) => attempt.completion !== undefined,
  );
  const activeAttempts = attempts
    .filter(({ attempt }) => attempt.completion === undefined)
    .map(({ attempt, role }) => ({
      attemptId: attempt.intent.attemptId,
      role,
      startedAt: attempt.occurredAt,
      ledgerHead: attempt.ledgerHead,
    }))
    .sort((left, right) => left.ledgerHead - right.ledgerHead)
    .map(({ ledgerHead: _ledgerHead, ...attempt }) => attempt);
  const verifications = records.verifications;
  const completedVerifications = verifications.flatMap((verification) =>
    verification.completed === undefined ? [] : [verification.completed],
  );
  const activeVerifications = verifications
    .filter((verification) => verification.completed === undefined)
    .sort((left, right) => left.startedLedgerHead - right.startedLedgerHead)
    .map((verification) => ({
      verificationId: verification.plan.verificationId,
      startedAt: verification.startedAt,
    }));
  const outcomes = completedVerifications.map(
    (verification) => verification.ref.outcome,
  );
  const checkpoints = records.checkpoints;
  const usages: ModelAttemptUsageV2[] = [];
  let usageIncomplete =
    activeAttempts.length > 0 || activeVerifications.length > 0;
  for (const { attempt } of attempts) {
    const completion = attempt.completion;
    if (completion === undefined || !("role" in completion.value)) continue;
    if (artifactStore === undefined) {
      usageIncomplete = true;
      continue;
    }
    try {
      const artifact = modelAttemptResultV2Schema.parse(
        await artifactStore.readJson(completion.value.result.digest),
      );
      if (artifact.usage === undefined) usageIncomplete = true;
      else usages.push(artifact.usage);
    } catch {
      usageIncomplete = true;
    }
  }
  for (const verification of completedVerifications) {
    const value = verification.value;
    if (
      value.schemaVersion === 2 &&
      value.evidence.verifierUsage !== undefined
    ) {
      usages.push(value.evidence.verifierUsage);
    }
  }
  const lastEvent = records.lastDurableEvent;
  const legacy: CampaignProgressViewV1 = {
    kind: "progress",
    schemaVersion: 1,
    campaignId,
    status:
      activeRuns > 0
        ? "running"
        : completedRuns.length > 0
          ? "completed"
          : "prepared",
    ledgerHead: lastEvent.sequence,
    counts: {
      runs: {
        started: runs.length,
        completed: completedRuns.length,
        active: activeRuns,
      },
      attempts: {
        started: attempts.length,
        completed: completedAttempts.length,
        active: activeAttempts.length,
      },
      checkpoints: {
        total: checkpoints.length,
        hypotheses: checkpoints.filter(
          (checkpoint) =>
            checkpoint.checkpoint.subject.kind === "source-bound-hypothesis",
        ).length,
        routeFragments: checkpoints.filter(
          (checkpoint) =>
            checkpoint.checkpoint.subject.kind === "route-fragment",
        ).length,
        frontierGaps: checkpoints.filter(
          (checkpoint) => checkpoint.checkpoint.subject.kind === "frontier-gap",
        ).length,
      },
      verifications: {
        started: verifications.length,
        completed: completedVerifications.length,
        active: activeVerifications.length,
        finding: outcomes.filter((outcome) => outcome === "finding").length,
        disproved: outcomes.filter((outcome) => outcome === "disproved").length,
        blocked: outcomes.filter((outcome) => outcome === "blocked").length,
      },
      depthIterations: records.depthIterations,
    },
    activeAttempts,
    activeVerifications,
    usage: aggregateProgressUsage(
      completedAttempts.length +
        completedVerifications.filter(
          (verification) =>
            verification.value.schemaVersion === 2 &&
            verification.value.evidence.verifierUsage !== undefined,
        ).length,
      usages,
      usageIncomplete,
    ),
    lastDurableEvent: lastEvent,
  };

  const currentRuns = runs.filter(
    (run) =>
      run.completed?.value.schemaVersion === 4 ||
      (run.plan.schemaVersion === 3 &&
        isCurrentSemanticResearchBudgetPolicy(run.plan.budgetPolicy)),
  );
  if (currentRuns.length === 0) return legacy;

  const runIds = new Set(currentRuns.map((run) => run.plan.runId));
  const firstIntents = new Map<string, ValidationIntentRecordView>();
  for (const record of records.validationIntents) {
    if (!runIds.has(record.intent.runId)) continue;
    const previous = firstIntents.get(record.intent.validationId);
    if (previous === undefined || record.ledgerHead < previous.ledgerHead) {
      firstIntents.set(record.intent.validationId, record);
    }
  }
  const intents = [...firstIntents.values()];
  const validationIds = new Set(
    intents.map((record) => record.intent.validationId),
  );
  const completions = records.validationCompletions.filter((record) =>
    validationIds.has(record.completion.validation.validationId),
  );
  const completedIds = new Set(
    completions.map((record) => record.completion.validation.validationId),
  );
  const activeValidations = intents
    .filter((record) => !completedIds.has(record.intent.validationId))
    .sort((left, right) => left.ledgerHead - right.ledgerHead)
    .map((record) => ({
      validationId: record.intent.validationId,
      startedAt: record.occurredAt,
    }));
  const dispositions = completions.map(
    (record) => record.completion.disposition,
  );
  const findings = new Set(
    currentRuns.flatMap((run) =>
      run.completed?.value.schemaVersion === 4
        ? run.completed.value.findings.map((finding) => finding.id)
        : [],
    ),
  );

  return campaignProgressViewV2Schema.parse({
    ...legacy,
    schemaVersion: 2,
    counts: {
      ...legacy.counts,
      validations: {
        started: intents.length,
        completed: completions.length,
        active: activeValidations.length,
        sourceValidated: dispositions.filter(
          (value) => value === "source-validated",
        ).length,
        needsResearch: dispositions.filter(
          (value) => value === "needs-research",
        ).length,
        disproven: dispositions.filter((value) => value === "disproven").length,
        pending: dispositions.filter((value) => value === "validation-pending")
          .length,
      },
      findings: findings.size,
    },
    activeValidations,
  });
}
