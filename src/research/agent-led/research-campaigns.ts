import Database from "better-sqlite3";
import { z } from "zod";

import {
  canonicalDigest,
  canonicalJson,
  encodeCanonicalJson,
} from "../../infrastructure/canonical-json.js";
import {
  campaignInterruptionSchema,
  campaignInputSchema,
  campaignCommandSchema,
  candidateReviewRequestSchema,
  humanCandidateReviewSchema,
  humanResearchContinuationReviewSchema,
  humanValidationRetrySchema,
  nativeRunReceiptSchema,
  researchContinuationReviewRequestSchema,
  validationRunReceiptSchema,
  type CampaignInput,
  type CampaignCommand,
  type CampaignOutcomeRef,
  type CampaignQuery,
  type CampaignStatus,
  type CandidateReviewRequest,
  type HumanCandidateReview,
  type HumanResearchContinuationReview,
  type HumanValidationRetry,
  type ResearchContinuationReviewRequest,
  type NativeAgentReceipt,
  type NativeAgentRuntime,
  type NativeRunReceipt,
  type OpenResearchCampaignsOptions,
  type ParkedProgrammeLead,
  type ResearchCampaigns,
  type ResearchCampaignView,
  type SealedAgentRun,
  type SealedNativeRun,
  type SealedValidationRun,
  type ValidationCandidate,
  type ValidationRunReceipt,
  type ValidationRunRecord,
} from "./contracts.js";

const eventRowSchema = z.object({
  kind: z.enum([
    "campaign.defined",
    "native-run.recorded",
    "candidate-review.recorded",
    "research-continuation-review.recorded",
    "validation-retry.recorded",
    "validation-run.recorded",
    "campaign.interrupted",
  ]),
  occurred_at: z.string(),
  payload_json: z.string(),
  payload_digest: z.string(),
});

const campaignDefinedPayloadSchema = z.strictObject({
  input: campaignInputSchema,
  inputDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
});

const nativeRunRecordedPayloadSchema = z.strictObject({
  inputDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  receipt: nativeRunReceiptSchema,
});

const candidateReviewRecordedPayloadSchema = z.strictObject({
  inputDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  review: humanCandidateReviewSchema,
});

const researchContinuationReviewRecordedPayloadSchema = z.strictObject({
  inputDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  review: humanResearchContinuationReviewSchema,
});

const validationRunRecordedPayloadSchema = z.strictObject({
  inputDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  candidateId: z.string().min(1),
  receipt: validationRunReceiptSchema,
});

const validationRetryRecordedPayloadSchema = z.strictObject({
  inputDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  retry: humanValidationRetrySchema,
});

const campaignInterruptedPayloadSchema = z.strictObject({
  inputDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  interruption: campaignInterruptionSchema,
});

type EventRow = z.infer<typeof eventRowSchema>;

export class AgentLedCampaignConflictError extends Error {
  constructor(readonly campaignId: string) {
    super(
      `Agent-led Campaign input conflicts with stored input: ${campaignId}`,
    );
    this.name = "AgentLedCampaignConflictError";
  }
}

export class AgentLedCampaignNotFoundError extends Error {
  constructor(readonly campaignId: string) {
    super(`Agent-led Campaign not found: ${campaignId}`);
    this.name = "AgentLedCampaignNotFoundError";
  }
}

export class HumanCandidateReviewConflictError extends Error {
  constructor(readonly campaignId: string) {
    super(
      `Human Candidate Review does not match the pending request: ${campaignId}`,
    );
    this.name = "HumanCandidateReviewConflictError";
  }
}

export class HumanResearchContinuationReviewConflictError extends Error {
  constructor(readonly campaignId: string) {
    super(
      `Human Research Continuation Review does not match the pending request: ${campaignId}`,
    );
    this.name = "HumanResearchContinuationReviewConflictError";
  }
}

export class HumanValidationRetryConflictError extends Error {
  constructor(readonly campaignId: string) {
    super(
      `Human Validation Retry does not match the current failed Validation runs: ${campaignId}`,
    );
    this.name = "HumanValidationRetryConflictError";
  }
}

function decodeJson(value: string): unknown {
  return JSON.parse(value) as unknown;
}

type FailedNativeAgentReceipt = Exclude<
  NativeAgentReceipt,
  { readonly terminal: "completed" }
>;

function failedReceipt(
  run: SealedAgentRun,
  startedAt: Date,
  completedAt: Date,
  terminal: FailedNativeAgentReceipt["terminal"],
  summary: string,
): FailedNativeAgentReceipt {
  return {
    schemaVersion: 1,
    runId: run.runId,
    runtimeProfileDigest: run.agentRuntimeProfile.digest,
    terminal,
    startedAt: startedAt.toISOString(),
    completedAt: completedAt.toISOString(),
    usage: {
      wallTimeMs: Math.max(0, completedAt.getTime() - startedAt.getTime()),
    },
    activity: { subagents: null, tools: null },
    failure: { summary },
  };
}

function hasRunBudget(
  input: CampaignInput,
  receipts: readonly NativeAgentReceipt[],
): boolean {
  const usage = budgetUsage(receipts);
  return (
    receipts.length < input.budgetEnvelope.maxNativeRuns &&
    usage.wallTimeMs < input.budgetEnvelope.maxWallTimeMs
  );
}

function budgetUsage(receipts: readonly NativeAgentReceipt[]): Readonly<{
  wallTimeMs: number;
}> {
  const wallTimeMs = receipts.reduce(
    (total, receipt) => total + receipt.usage.wallTimeMs,
    0,
  );
  return { wallTimeMs };
}

function budgetAllowance(
  input: CampaignInput,
  receipts: readonly NativeAgentReceipt[],
  researchGrant: boolean,
): Readonly<{ maxWallTimeMs: number }> {
  const usage = budgetUsage(receipts);
  const remainingWallTimeMs =
    input.budgetEnvelope.maxWallTimeMs - usage.wallTimeMs;
  return {
    maxWallTimeMs: researchGrant
      ? Math.min(
          remainingWallTimeMs,
          input.budgetEnvelope.researchGrantWallTimeMs,
        )
      : remainingWallTimeMs,
  };
}

function exceededBudget(
  input: CampaignInput,
  receipts: readonly NativeAgentReceipt[],
): boolean {
  const usage = budgetUsage(receipts);
  return (
    receipts.length > input.budgetEnvelope.maxNativeRuns ||
    usage.wallTimeMs > input.budgetEnvelope.maxWallTimeMs
  );
}

function allReceipts(
  view: ResearchCampaignView,
): readonly NativeAgentReceipt[] {
  return [
    ...view.nativeRuns,
    ...view.validationRuns.map((record) => record.receipt),
  ];
}

function candidatesFor(
  nativeRuns: readonly NativeRunReceipt[],
): readonly ValidationCandidate[] {
  const candidates = new Map<string, ValidationCandidate>();
  for (const receipt of nativeRuns) {
    if (receipt.terminal !== "completed") continue;
    for (const candidate of receipt.report.candidates) {
      const prior = candidates.get(candidate.candidateId);
      if (
        prior !== undefined &&
        encodeCanonicalJson(prior) !== encodeCanonicalJson(candidate)
      ) {
        throw new Error(
          `Validation Candidate identity was reused with different evidence: ${candidate.candidateId}`,
        );
      }
      candidates.set(candidate.candidateId, candidate);
    }
  }
  return [...candidates.values()];
}

function parkedProgrammeLeadsFor(
  nativeRuns: readonly NativeRunReceipt[],
): readonly ParkedProgrammeLead[] {
  const leads = new Map<string, ParkedProgrammeLead>();
  for (const receipt of nativeRuns) {
    if (receipt.terminal !== "completed") continue;
    for (const lead of receipt.report.parkedProgrammeLeads ?? []) {
      const prior = leads.get(lead.leadId);
      if (
        prior !== undefined &&
        encodeCanonicalJson(prior) !== encodeCanonicalJson(lead)
      ) {
        throw new Error(
          `Parked Programme Lead identity was reused with different evidence: ${lead.leadId}`,
        );
      }
      leads.set(lead.leadId, lead);
    }
  }
  return [...leads.values()];
}

function candidateReviewRequestFor(
  campaignId: string,
  campaignInputDigest: string,
  terminalResearchRun: NativeRunReceipt | undefined,
  candidates: readonly ValidationCandidate[],
  proceedFromContinuationReview = false,
): CandidateReviewRequest | undefined {
  if (
    terminalResearchRun === undefined ||
    terminalResearchRun.terminal !== "completed" ||
    (terminalResearchRun.report.decision.kind !== "stop" &&
      !proceedFromContinuationReview) ||
    candidates.length === 0
  ) {
    return undefined;
  }
  const candidateSetDigest = canonicalDigest(candidates);
  const body = {
    kind: "candidate-review-request" as const,
    schemaVersion: 1 as const,
    campaignId,
    campaignInputDigest,
    terminalResearchRunId: terminalResearchRun.runId,
    candidateSetDigest,
    candidates: [...candidates],
  };
  return candidateReviewRequestSchema.parse({
    ...body,
    digest: canonicalDigest(body),
  });
}

function researchContinuationReviewRequestFor(
  campaignId: string,
  campaignInputDigest: string,
  researchRun: NativeRunReceipt | undefined,
  candidates: readonly ValidationCandidate[],
  parkedProgrammeLeads: readonly ParkedProgrammeLead[],
): ResearchContinuationReviewRequest | undefined {
  if (
    researchRun === undefined ||
    researchRun.terminal !== "completed" ||
    researchRun.report.decision.kind !== "continue"
  ) {
    return undefined;
  }
  const candidateSetDigest = canonicalDigest(candidates);
  const parkedProgrammeLeadSetDigest = canonicalDigest(parkedProgrammeLeads);
  const body = {
    kind: "research-continuation-review-request" as const,
    schemaVersion: 1 as const,
    campaignId,
    campaignInputDigest,
    researchRunId: researchRun.runId,
    checkpoint: researchRun.checkpoint,
    candidateSetDigest,
    candidates: [...candidates],
    parkedProgrammeLeadSetDigest,
    parkedProgrammeLeads: [...parkedProgrammeLeads],
    nextActions: researchRun.report.decision.nextActions,
  };
  return researchContinuationReviewRequestSchema.parse({
    ...body,
    digest: canonicalDigest(body),
  });
}

function outcomeFor(view: ResearchCampaignView): CampaignOutcomeRef {
  return {
    kind: view.kind,
    schemaVersion: view.schemaVersion,
    campaignId: view.campaignId,
    inputDigest: view.inputDigest,
    status: view.status,
  };
}

function activeCandidateReviewFor(
  view: ResearchCampaignView,
): HumanCandidateReview | undefined {
  const continuationReview = activeResearchContinuationReviewFor(view);
  const request = candidateReviewRequestFor(
    view.campaignId,
    view.inputDigest,
    view.nativeRuns.at(-1),
    candidatesFor(view.nativeRuns),
    continuationReview?.decision === "proceed-to-candidate-review",
  );
  return request === undefined
    ? undefined
    : view.candidateReviews.find(
        (review) => review.candidateReviewRequestDigest === request.digest,
      );
}

function activeResearchContinuationReviewFor(
  view: ResearchCampaignView,
): HumanResearchContinuationReview | undefined {
  const request = researchContinuationReviewRequestFor(
    view.campaignId,
    view.inputDigest,
    view.nativeRuns.at(-1),
    candidatesFor(view.nativeRuns),
    parkedProgrammeLeadsFor(view.nativeRuns),
  );
  return request === undefined
    ? undefined
    : view.researchContinuationReviews.find(
        (review) =>
          review.researchContinuationReviewRequestDigest === request.digest,
      );
}

function researchContinuationNextActionsFor(
  view: ResearchCampaignView,
): ResearchContinuationReviewRequest["nextActions"] | undefined {
  const review = [...view.researchContinuationReviews]
    .reverse()
    .find((item) => item.decision === "continue-research");
  if (review === undefined) return undefined;

  const reviewedRunIndex = view.nativeRuns.findIndex(
    (receipt) => receipt.runId === review.researchRunId,
  );
  if (reviewedRunIndex < 0) {
    throw new Error(
      `Human Research Continuation Review run is missing: ${review.researchRunId}`,
    );
  }
  if (
    view.nativeRuns
      .slice(reviewedRunIndex + 1)
      .some((receipt) => receipt.terminal === "completed")
  ) {
    return undefined;
  }

  const reviewedRuns = view.nativeRuns.slice(0, reviewedRunIndex + 1);
  const request = researchContinuationReviewRequestFor(
    view.campaignId,
    view.inputDigest,
    reviewedRuns.at(-1),
    candidatesFor(reviewedRuns),
    parkedProgrammeLeadsFor(reviewedRuns),
  );
  if (
    request === undefined ||
    request.digest !== review.researchContinuationReviewRequestDigest
  ) {
    throw new Error(
      `Human Research Continuation Review binding mismatch: ${review.reviewId}`,
    );
  }
  return request.nextActions;
}

function latestValidationRuns(
  records: readonly ValidationRunRecord[],
): readonly ValidationRunRecord[] {
  const latest = new Map<string, ValidationRunRecord>();
  for (const record of records) latest.set(record.candidateId, record);
  return [...latest.values()];
}

function isRetryableValidationRun(record: ValidationRunRecord): boolean {
  return (
    record.receipt.terminal !== "completed" ||
    record.receipt.report.disposition === "validation-pending"
  );
}

function retryableValidationRunIds(
  records: readonly ValidationRunRecord[],
): readonly string[] {
  return latestValidationRuns(records)
    .filter(isRetryableValidationRun)
    .map((record) => record.receipt.runId);
}

function retryAuthorized(
  retries: readonly HumanValidationRetry[] | undefined,
  runId: string,
): boolean {
  return (
    retries?.some((retry) => retry.failedValidationRunIds.includes(runId)) ??
    false
  );
}

function hasRetryableResearchRun(view: ResearchCampaignView): boolean {
  const latest = view.nativeRuns.at(-1);
  const previous = view.nativeRuns.at(-2);
  const isLegacyRetryableSandboxFailure =
    latest?.terminal === "policy-denied" &&
    latest.failure.stage === "sandbox-preflight" &&
    latest.failure.summary ===
      "The pinned gVisor Agent Sandbox is unavailable.";
  return (
    view.interruption === undefined &&
    latest !== undefined &&
    latest.terminal !== "completed" &&
    (previous === undefined || previous.terminal === "completed") &&
    (((latest.terminal === "provider-failed" ||
      latest.terminal === "provider-quota-exhausted") &&
      latest.checkpoint !== undefined) ||
      latest.failure.retryable === true ||
      isLegacyRetryableSandboxFailure)
  );
}

class SqliteResearchCampaigns implements ResearchCampaigns {
  readonly #database: Database.Database;
  readonly #runtime: NativeAgentRuntime;
  readonly #clock: () => Date;

  constructor(options: OpenResearchCampaignsOptions) {
    this.#database = new Database(options.databasePath);
    this.#runtime = options.runtime;
    this.#clock = options.clock ?? (() => new Date());
    this.#database.pragma("journal_mode = WAL");
    this.#database.pragma("busy_timeout = 5000");
    this.#database.exec(`
      CREATE TABLE IF NOT EXISTS agent_led_research_events (
        global_sequence INTEGER PRIMARY KEY AUTOINCREMENT,
        campaign_id TEXT NOT NULL,
        campaign_sequence INTEGER NOT NULL,
        kind TEXT NOT NULL,
        occurred_at TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        payload_digest TEXT NOT NULL,
        UNIQUE (campaign_id, campaign_sequence)
      ) STRICT;
    `);
  }

  async conduct(
    candidateCommand: CampaignCommand,
  ): Promise<CampaignOutcomeRef> {
    const command = campaignCommandSchema.parse(candidateCommand);
    if (command.kind === "human-candidate-review") {
      return this.#recordCandidateReview(command);
    }
    if (command.kind === "human-research-continuation-review") {
      return this.#recordResearchContinuationReview(command);
    }
    if (command.kind === "human-validation-retry") {
      return this.#recordValidationRetry(command);
    }
    const input = campaignInputSchema.parse(command);
    const inputDigest = canonicalDigest(input);
    const existing = this.#readView(input.campaignId);
    if (existing !== undefined) {
      if (existing.inputDigest !== inputDigest) {
        throw new AgentLedCampaignConflictError(input.campaignId);
      }
      if (
        existing.status === "coverage-closed" ||
        (existing.status === "incomplete" && !hasRetryableResearchRun(existing))
      ) {
        return outcomeFor(existing);
      }
    } else {
      this.#append(input.campaignId, "campaign.defined", {
        input,
        inputDigest,
      });
    }

    return this.#continueCampaign(input);
  }

  #recordCandidateReview(
    review: HumanCandidateReview,
  ): Promise<CampaignOutcomeRef> {
    const view = this.#requireView(review.campaignId);
    const prior = view.candidateReviews.find(
      (candidateReview) => candidateReview.reviewId === review.reviewId,
    );
    if (prior !== undefined) {
      if (prior.digest !== review.digest) {
        throw new HumanCandidateReviewConflictError(review.campaignId);
      }
      return Promise.resolve(outcomeFor(view));
    }
    const pending = view.pendingCandidateReview;
    const reviewedIds = new Set(
      review.decisions.map((decision) => decision.candidateId),
    );
    const pendingIds = new Set(
      pending?.candidates.map((candidate) => candidate.candidateId) ?? [],
    );
    if (
      pending === undefined ||
      review.campaignInputDigest !== pending.campaignInputDigest ||
      review.terminalResearchRunId !== pending.terminalResearchRunId ||
      review.candidateSetDigest !== pending.candidateSetDigest ||
      review.candidateReviewRequestDigest !== pending.digest ||
      reviewedIds.size !== pendingIds.size ||
      [...reviewedIds].some((candidateId) => !pendingIds.has(candidateId))
    ) {
      throw new HumanCandidateReviewConflictError(review.campaignId);
    }
    this.#append(review.campaignId, "candidate-review.recorded", {
      inputDigest: view.inputDigest,
      review,
    });
    return this.#continueCampaign(view.input);
  }

  #recordResearchContinuationReview(
    review: HumanResearchContinuationReview,
  ): Promise<CampaignOutcomeRef> {
    const view = this.#requireView(review.campaignId);
    const prior = view.researchContinuationReviews.find(
      (continuationReview) => continuationReview.reviewId === review.reviewId,
    );
    if (prior !== undefined) {
      if (prior.digest !== review.digest) {
        throw new HumanResearchContinuationReviewConflictError(
          review.campaignId,
        );
      }
      return Promise.resolve(outcomeFor(view));
    }
    const pending = view.pendingResearchContinuationReview;
    if (
      pending === undefined ||
      review.campaignInputDigest !== pending.campaignInputDigest ||
      review.researchRunId !== pending.researchRunId ||
      review.checkpointId !== pending.checkpoint.checkpointId ||
      review.checkpointStateDigest !== pending.checkpoint.stateDigest ||
      review.candidateSetDigest !== pending.candidateSetDigest ||
      review.parkedProgrammeLeadSetDigest !==
        pending.parkedProgrammeLeadSetDigest ||
      review.researchContinuationReviewRequestDigest !== pending.digest ||
      (review.decision === "proceed-to-candidate-review" &&
        pending.candidates.length === 0)
    ) {
      throw new HumanResearchContinuationReviewConflictError(review.campaignId);
    }
    this.#append(review.campaignId, "research-continuation-review.recorded", {
      inputDigest: view.inputDigest,
      review,
    });
    return this.#continueCampaign(view.input);
  }

  #recordValidationRetry(
    retry: HumanValidationRetry,
  ): Promise<CampaignOutcomeRef> {
    const view = this.#requireView(retry.campaignId);
    const prior = view.validationRetries?.find(
      (validationRetry) => validationRetry.retryId === retry.retryId,
    );
    if (prior !== undefined) {
      if (prior.digest !== retry.digest) {
        throw new HumanValidationRetryConflictError(retry.campaignId);
      }
      return Promise.resolve(outcomeFor(view));
    }
    const retryableRunIds = retryableValidationRunIds(view.validationRuns);
    const suppliedRunIds = new Set(retry.failedValidationRunIds);
    if (
      view.status !== "incomplete" ||
      view.interruption !== undefined ||
      view.nativeRuns.some((receipt) => receipt.terminal !== "completed") ||
      retry.campaignInputDigest !== view.inputDigest ||
      retryableRunIds.length === 0 ||
      suppliedRunIds.size !== retryableRunIds.length ||
      retryableRunIds.some((runId) => !suppliedRunIds.has(runId))
    ) {
      throw new HumanValidationRetryConflictError(retry.campaignId);
    }
    this.#append(retry.campaignId, "validation-retry.recorded", {
      inputDigest: view.inputDigest,
      retry,
    });
    return this.#continueCampaign(view.input);
  }

  async #continueCampaign(input: CampaignInput): Promise<CampaignOutcomeRef> {
    const inputDigest = canonicalDigest(input);
    let view = this.#requireView(input.campaignId);
    for (;;) {
      if (
        view.status === "coverage-closed" ||
        (view.status === "incomplete" && !hasRetryableResearchRun(view))
      ) {
        return outcomeFor(view);
      }

      const attemptedCandidates = new Set(
        latestValidationRuns(view.validationRuns).flatMap((record) =>
          isRetryableValidationRun(record) &&
          retryAuthorized(view.validationRetries, record.receipt.runId)
            ? []
            : [record.candidateId],
        ),
      );
      const activeReview = activeCandidateReviewFor(view);
      const admittedCandidates = new Set(
        activeReview?.decisions.flatMap((decision) =>
          decision.disposition === "advance-to-independent-validation"
            ? [decision.candidateId]
            : [],
        ) ?? [],
      );
      const candidateReviewNextActions = activeReview?.decisions.flatMap(
        (decision) =>
          decision.disposition === "return-to-research"
            ? [
                {
                  candidateId: decision.candidateId,
                  nextActions: decision.nextActions,
                },
              ]
            : [],
      );
      const researchContinuationNextActions =
        researchContinuationNextActionsFor(view);
      const pendingCandidate = candidatesFor(view.nativeRuns).find(
        (candidate) =>
          admittedCandidates.has(candidate.candidateId) &&
          !attemptedCandidates.has(candidate.candidateId),
      );
      if (
        pendingCandidate !== undefined &&
        view.status === "validation-pending"
      ) {
        if (!hasRunBudget(input, allReceipts(view))) {
          this.#interruptForBudget(input, inputDigest, true);
          view = this.#requireView(input.campaignId);
          continue;
        }
        const run: SealedValidationRun = {
          kind: "sealed-native-validation-run",
          schemaVersion: 1,
          runId: `${input.campaignId}:validation:${view.validationRuns.length + 1}`,
          campaignId: input.campaignId,
          campaignInputDigest: inputDigest,
          targetSnapshot: input.targetSnapshot,
          ...(input.dependencySnapshots === undefined
            ? {}
            : { dependencySnapshots: input.dependencySnapshots }),
          promptSet: input.validationPromptSet,
          agentRuntimeProfile: input.agentRuntimeProfile,
          permissionProfile: input.permissionProfile,
          budgetEnvelope: input.budgetEnvelope,
          budgetAllowance: budgetAllowance(input, allReceipts(view), false),
          candidate: pendingCandidate,
        };
        const receipt = await this.#execute(run, this.#clock());
        this.#append(input.campaignId, "validation-run.recorded", {
          inputDigest,
          candidateId: pendingCandidate.candidateId,
          receipt,
        });
        view = this.#requireView(input.campaignId);
        if (exceededBudget(input, allReceipts(view))) {
          this.#interruptForBudget(input, inputDigest, true, true);
          view = this.#requireView(input.campaignId);
        }
        continue;
      }

      if (
        view.status !== "research-continues" &&
        !hasRetryableResearchRun(view)
      ) {
        return outcomeFor(view);
      }
      if (!hasRunBudget(input, allReceipts(view))) {
        this.#interruptForBudget(input, inputDigest, false);
        view = this.#requireView(input.campaignId);
        continue;
      }
      const ordinal = view.nativeRuns.length + 1;
      const resumeFrom =
        [...view.nativeRuns]
          .reverse()
          .find((receipt) => receipt.checkpoint !== undefined)?.checkpoint ??
        (view.nativeRuns.length === 0 ? input.resumeFrom : undefined);
      const run: SealedNativeRun = {
        kind: "sealed-native-research-run",
        schemaVersion: 1,
        runId: `${input.campaignId}:native:${ordinal}`,
        campaignId: input.campaignId,
        campaignInputDigest: inputDigest,
        targetSnapshot: input.targetSnapshot,
        ...(input.dependencySnapshots === undefined
          ? {}
          : { dependencySnapshots: input.dependencySnapshots }),
        ...(input.threatContext === undefined
          ? {}
          : { threatContext: input.threatContext }),
        ...(input.programmeBoundary === undefined
          ? {}
          : { programmeBoundary: input.programmeBoundary }),
        promptSet: input.promptSet,
        agentRuntimeProfile: input.agentRuntimeProfile,
        permissionProfile: input.permissionProfile,
        budgetEnvelope: input.budgetEnvelope,
        budgetAllowance: budgetAllowance(input, allReceipts(view), true),
        ...(resumeFrom === undefined ? {} : { resumeFrom }),
        ...(researchContinuationNextActions === undefined
          ? {}
          : { researchContinuationNextActions }),
        validationFeedback: view.validationRuns.flatMap((record) =>
          record.receipt.terminal === "completed"
            ? [
                {
                  runId: record.receipt.runId,
                  candidateId: record.candidateId,
                  report: record.receipt.report,
                },
              ]
            : [],
        ),
        ...(candidateReviewNextActions === undefined ||
        candidateReviewNextActions.length === 0
          ? {}
          : {
              candidateReviewNextActions,
            }),
      };
      const startedAt = this.#clock();
      let receipt = await this.#execute(run, startedAt);
      if (receipt.terminal === "completed") {
        try {
          candidatesFor([...view.nativeRuns, receipt]);
        } catch {
          receipt = failedReceipt(
            run,
            startedAt,
            this.#clock(),
            "invalid-output",
            "Native Agent Runtime reused a Candidate identity with different evidence.",
          );
        }
      }
      if (
        receipt.terminal === "completed" &&
        (receipt.report.parkedProgrammeLeads?.length ?? 0) > 0 &&
        run.programmeBoundary === undefined
      ) {
        receipt = failedReceipt(
          run,
          startedAt,
          this.#clock(),
          "invalid-output",
          "Native Agent Runtime returned a parked Programme Lead without a Programme Research Boundary.",
        );
      }
      if (receipt.terminal === "completed") {
        try {
          parkedProgrammeLeadsFor([...view.nativeRuns, receipt]);
        } catch {
          receipt = failedReceipt(
            run,
            startedAt,
            this.#clock(),
            "invalid-output",
            "Native Agent Runtime reused a parked Programme Lead identity with different evidence.",
          );
        }
      }
      this.#append(input.campaignId, "native-run.recorded", {
        inputDigest,
        receipt,
      });
      view = this.#requireView(input.campaignId);
      if (exceededBudget(input, allReceipts(view))) {
        this.#interruptForBudget(input, inputDigest, false, true);
        view = this.#requireView(input.campaignId);
      }
      if (receipt.terminal !== "completed") {
        return outcomeFor(view);
      }
    }
  }

  async inspect(query: CampaignQuery): Promise<ResearchCampaignView> {
    return this.#requireView(query.campaignId);
  }

  close(): void {
    this.#database.close();
  }

  async #execute(
    run: SealedNativeRun,
    startedAt: Date,
  ): Promise<NativeRunReceipt>;
  async #execute(
    run: SealedValidationRun,
    startedAt: Date,
  ): Promise<ValidationRunReceipt>;
  async #execute(
    run: SealedAgentRun,
    startedAt: Date,
  ): Promise<NativeAgentReceipt> {
    let receipt: NativeAgentReceipt;
    try {
      const returnedReceipt = await this.#runtime.execute(run);
      const decoded =
        run.kind === "sealed-native-research-run"
          ? nativeRunReceiptSchema.safeParse(returnedReceipt)
          : validationRunReceiptSchema.safeParse(returnedReceipt);
      receipt = decoded.success
        ? decoded.data
        : failedReceipt(
            run,
            startedAt,
            this.#clock(),
            "invalid-output",
            run.kind === "sealed-native-research-run"
              ? "Native Agent Runtime returned an unsupported output schema."
              : "Native Agent Runtime returned an unsupported Validation output schema.",
          );
    } catch {
      receipt = failedReceipt(
        run,
        startedAt,
        this.#clock(),
        "provider-failed",
        run.kind === "sealed-native-research-run"
          ? "Native Agent Runtime failed before returning a receipt."
          : "Native Agent Runtime failed before returning a Validation receipt.",
      );
    }
    const bindingMismatch =
      receipt.runId !== run.runId ||
      receipt.runtimeProfileDigest !== run.agentRuntimeProfile.digest ||
      (run.kind === "sealed-native-validation-run" &&
        receipt.terminal === "completed" &&
        "candidateId" in receipt.report &&
        receipt.report.candidateId !== run.candidate.candidateId);
    if (bindingMismatch) {
      return failedReceipt(
        run,
        startedAt,
        this.#clock(),
        "invalid-output",
        run.kind === "sealed-native-research-run"
          ? "Native Run Receipt did not match the sealed Campaign binding."
          : "Validation Run Receipt did not match the sealed Candidate binding.",
      );
    }
    return receipt;
  }

  #interruptForBudget(
    input: CampaignInput,
    inputDigest: string,
    validationPending: boolean,
    exceeded = false,
  ): void {
    this.#append(input.campaignId, "campaign.interrupted", {
      inputDigest,
      interruption: {
        reason: "budget-exhausted",
        summary: exceeded
          ? validationPending
            ? "Independent Validation exceeded the remaining Campaign budget."
            : "A Native Run exceeded the remaining Campaign budget."
          : validationPending
            ? "The Native Run budget ended before Independent Validation completed."
            : "The Native Run budget ended with an actionable frontier remaining.",
      },
    });
  }

  #append(campaignId: string, kind: EventRow["kind"], payload: unknown): void {
    const payloadJson = canonicalJson(payload);
    const nextSequence = this.#database
      .prepare(
        `SELECT COALESCE(MAX(campaign_sequence), 0) + 1 AS next_sequence
         FROM agent_led_research_events
         WHERE campaign_id = ?`,
      )
      .pluck()
      .get(campaignId);
    const sequence = z.number().int().positive().parse(nextSequence);
    this.#database
      .prepare(
        `INSERT INTO agent_led_research_events (
           campaign_id, campaign_sequence, kind, occurred_at,
           payload_json, payload_digest
         ) VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        campaignId,
        sequence,
        kind,
        this.#clock().toISOString(),
        payloadJson,
        canonicalDigest(payload),
      );
  }

  #readRows(campaignId: string): readonly EventRow[] {
    return z.array(eventRowSchema).parse(
      this.#database
        .prepare(
          `SELECT kind, occurred_at, payload_json, payload_digest
             FROM agent_led_research_events
             WHERE campaign_id = ?
             ORDER BY campaign_sequence ASC`,
        )
        .all(campaignId),
    );
  }

  #readView(campaignId: string): ResearchCampaignView | undefined {
    const rows = this.#readRows(campaignId);
    if (rows.length === 0) return undefined;

    const first = rows[0];
    if (first === undefined || first.kind !== "campaign.defined") {
      throw new Error(
        `Agent-led Campaign definition is missing: ${campaignId}`,
      );
    }
    const definitionValue = decodeJson(first.payload_json);
    if (canonicalDigest(definitionValue) !== first.payload_digest) {
      throw new Error(
        `Agent-led Campaign definition digest mismatch: ${campaignId}`,
      );
    }
    const definition = campaignDefinedPayloadSchema.parse(definitionValue);
    if (
      definition.input.campaignId !== campaignId ||
      canonicalDigest(definition.input) !== definition.inputDigest
    ) {
      throw new Error(
        `Agent-led Campaign definition binding mismatch: ${campaignId}`,
      );
    }

    const nativeRuns: NativeRunReceipt[] = [];
    const validationRuns: ValidationRunRecord[] = [];
    const candidateReviews: HumanCandidateReview[] = [];
    const researchContinuationReviews: HumanResearchContinuationReview[] = [];
    const validationRetries: HumanValidationRetry[] = [];
    let interruption: z.infer<typeof campaignInterruptionSchema> | undefined;
    let needsResearchAfterLatestNativeRun = false;
    for (const row of rows.slice(1)) {
      const value = decodeJson(row.payload_json);
      if (canonicalDigest(value) !== row.payload_digest) {
        throw new Error(
          `Agent-led Campaign event digest mismatch: ${campaignId}`,
        );
      }
      if (row.kind === "native-run.recorded") {
        const event = nativeRunRecordedPayloadSchema.parse(value);
        if (event.inputDigest !== definition.inputDigest) {
          throw new Error(`Native Run input binding mismatch: ${campaignId}`);
        }
        nativeRuns.push(event.receipt);
        needsResearchAfterLatestNativeRun = false;
        continue;
      }
      if (row.kind === "research-continuation-review.recorded") {
        const event =
          researchContinuationReviewRecordedPayloadSchema.parse(value);
        if (
          event.inputDigest !== definition.inputDigest ||
          event.review.campaignId !== campaignId ||
          event.review.campaignInputDigest !== definition.inputDigest
        ) {
          throw new Error(
            `Human Research Continuation Review input binding mismatch: ${campaignId}`,
          );
        }
        if (
          researchContinuationReviews.some(
            (review) => review.reviewId === event.review.reviewId,
          )
        ) {
          throw new Error(
            `Duplicate Human Research Continuation Review: ${event.review.reviewId}`,
          );
        }
        researchContinuationReviews.push(event.review);
        continue;
      }
      if (row.kind === "candidate-review.recorded") {
        const event = candidateReviewRecordedPayloadSchema.parse(value);
        if (
          event.inputDigest !== definition.inputDigest ||
          event.review.campaignId !== campaignId ||
          event.review.campaignInputDigest !== definition.inputDigest
        ) {
          throw new Error(
            `Human Candidate Review input binding mismatch: ${campaignId}`,
          );
        }
        if (
          candidateReviews.some(
            (review) => review.reviewId === event.review.reviewId,
          )
        ) {
          throw new Error(
            `Duplicate Human Candidate Review: ${event.review.reviewId}`,
          );
        }
        candidateReviews.push(event.review);
        continue;
      }
      if (row.kind === "validation-retry.recorded") {
        const event = validationRetryRecordedPayloadSchema.parse(value);
        const retryableRunIds = retryableValidationRunIds(validationRuns);
        const suppliedRunIds = new Set(event.retry.failedValidationRunIds);
        if (
          event.inputDigest !== definition.inputDigest ||
          event.retry.campaignId !== campaignId ||
          event.retry.campaignInputDigest !== definition.inputDigest ||
          retryableRunIds.length === 0 ||
          suppliedRunIds.size !== retryableRunIds.length ||
          retryableRunIds.some((runId) => !suppliedRunIds.has(runId))
        ) {
          throw new Error(
            `Human Validation Retry input binding mismatch: ${campaignId}`,
          );
        }
        if (
          validationRetries.some(
            (retry) => retry.retryId === event.retry.retryId,
          )
        ) {
          throw new Error(
            `Duplicate Human Validation Retry: ${event.retry.retryId}`,
          );
        }
        validationRetries.push(event.retry);
        continue;
      }
      if (row.kind === "validation-run.recorded") {
        const event = validationRunRecordedPayloadSchema.parse(value);
        if (event.inputDigest !== definition.inputDigest) {
          throw new Error(
            `Validation Run input binding mismatch: ${campaignId}`,
          );
        }
        const candidate = candidatesFor(nativeRuns).find(
          (item) => item.candidateId === event.candidateId,
        );
        if (candidate === undefined) {
          throw new Error(
            `Validation Run references an unknown Candidate: ${campaignId}`,
          );
        }
        const previousAttempt = [...validationRuns]
          .reverse()
          .find((record) => record.candidateId === event.candidateId);
        if (
          previousAttempt !== undefined &&
          !retryAuthorized(validationRetries, previousAttempt.receipt.runId)
        ) {
          throw new Error(
            `Validation Retry is missing for Candidate: ${event.candidateId}`,
          );
        }
        if (
          event.receipt.terminal === "completed" &&
          event.receipt.report.candidateId !== event.candidateId
        ) {
          throw new Error(
            `Validation Run Candidate binding mismatch: ${campaignId}`,
          );
        }
        validationRuns.push({
          candidateId: event.candidateId,
          receipt: event.receipt,
        });
        if (
          event.receipt.terminal === "completed" &&
          event.receipt.report.disposition === "needs-research"
        ) {
          needsResearchAfterLatestNativeRun = true;
        }
        continue;
      }
      if (row.kind === "campaign.interrupted") {
        const event = campaignInterruptedPayloadSchema.parse(value);
        if (event.inputDigest !== definition.inputDigest) {
          throw new Error(
            `Campaign interruption input binding mismatch: ${campaignId}`,
          );
        }
        if (interruption !== undefined) {
          throw new Error(`Duplicate Campaign interruption: ${campaignId}`);
        }
        interruption = event.interruption;
        continue;
      }
      throw new Error(`Unsupported agent-led Campaign event: ${row.kind}`);
    }
    const latest = nativeRuns.at(-1);
    const candidates = candidatesFor(nativeRuns);
    const parkedProgrammeLeads = parkedProgrammeLeadsFor(nativeRuns);
    const currentResearchContinuationReviewRequest =
      researchContinuationReviewRequestFor(
        campaignId,
        definition.inputDigest,
        latest,
        candidates,
        parkedProgrammeLeads,
      );
    const activeResearchContinuationReview =
      currentResearchContinuationReviewRequest === undefined
        ? undefined
        : researchContinuationReviews.find(
            (review) =>
              review.researchContinuationReviewRequestDigest ===
              currentResearchContinuationReviewRequest.digest,
          );
    const currentCandidateReviewRequest = candidateReviewRequestFor(
      campaignId,
      definition.inputDigest,
      latest,
      candidates,
      activeResearchContinuationReview?.decision ===
        "proceed-to-candidate-review",
    );
    const activeCandidateReview =
      currentCandidateReviewRequest === undefined
        ? undefined
        : candidateReviews.find(
            (review) =>
              review.candidateReviewRequestDigest ===
              currentCandidateReviewRequest.digest,
          );
    const attemptedCandidates = new Set(
      latestValidationRuns(validationRuns).flatMap((record) =>
        isRetryableValidationRun(record) &&
        retryAuthorized(validationRetries, record.receipt.runId)
          ? []
          : [record.candidateId],
      ),
    );
    const admittedCandidateIds = new Set(
      activeCandidateReview?.decisions.flatMap((decision) =>
        decision.disposition === "advance-to-independent-validation"
          ? [decision.candidateId]
          : [],
      ) ?? [],
    );
    const hasUnattemptedCandidate = candidates.some(
      (candidate) =>
        admittedCandidateIds.has(candidate.candidateId) &&
        !attemptedCandidates.has(candidate.candidateId),
    );
    const reviewReturnsToResearch = activeCandidateReview?.decisions.some(
      (decision) => decision.disposition === "return-to-research",
    );
    const hasFailedResearchRun =
      latest !== undefined && latest.terminal !== "completed";
    const hasFailedValidationRun = latestValidationRuns(validationRuns).some(
      isRetryableValidationRun,
    );
    let status: CampaignStatus;
    if (interruption !== undefined || hasFailedResearchRun) {
      status = "incomplete";
    } else if (latest === undefined) {
      status = "research-continues";
    } else if (
      needsResearchAfterLatestNativeRun ||
      reviewReturnsToResearch === true ||
      activeResearchContinuationReview?.decision === "continue-research"
    ) {
      status = "research-continues";
    } else if (
      currentResearchContinuationReviewRequest !== undefined &&
      activeResearchContinuationReview === undefined
    ) {
      status = "research-review-pending";
    } else if (
      currentCandidateReviewRequest !== undefined &&
      activeCandidateReview === undefined &&
      (validationRuns.length === 0 || candidateReviews.length > 0)
    ) {
      status = "candidate-review-pending";
    } else if (hasUnattemptedCandidate) {
      status = "validation-pending";
    } else if (hasFailedValidationRun) {
      status = "incomplete";
    } else {
      status = "coverage-closed";
    }
    const findings = validationRuns.flatMap((record) => {
      if (
        record.receipt.terminal !== "completed" ||
        record.receipt.report.disposition !== "source-validated"
      ) {
        return [];
      }
      const candidate = candidates.find(
        (item) => item.candidateId === record.candidateId,
      );
      if (candidate === undefined) return [];
      return [
        {
          kind: "source-validated-finding" as const,
          schemaVersion: 1 as const,
          findingId: `${campaignId}:finding:${candidate.candidateId}`,
          candidateId: candidate.candidateId,
          targetSnapshot: definition.input.targetSnapshot,
          ...(definition.input.dependencySnapshots === undefined
            ? {}
            : {
                dependencySnapshots: definition.input.dependencySnapshots,
              }),
          attackerPremise: candidate.attackerPremise,
          brokenSecurityProperty: candidate.brokenSecurityProperty,
          claim: candidate.claim,
          assurance: "source-validated" as const,
          validation: {
            runId: record.receipt.runId,
            promptSet: definition.input.validationPromptSet,
            runtimeProfileDigest: definition.input.agentRuntimeProfile.digest,
            permissionProfileDigest: definition.input.permissionProfile.digest,
          },
          evidence: record.receipt.report.evidence,
        },
      ];
    });

    return {
      kind: "agent-led-campaign-outcome",
      schemaVersion: 1,
      campaignId,
      inputDigest: definition.inputDigest,
      status,
      input: definition.input,
      nativeRuns,
      validationRuns,
      candidateReviews,
      researchContinuationReviews,
      ...(validationRetries.length === 0 ? {} : { validationRetries }),
      parkedProgrammeLeads,
      findings,
      ...(status === "candidate-review-pending" &&
      currentCandidateReviewRequest !== undefined
        ? {
            pendingCandidateReview: currentCandidateReviewRequest,
          }
        : {}),
      ...(status === "research-review-pending" &&
      currentResearchContinuationReviewRequest !== undefined
        ? {
            pendingResearchContinuationReview:
              currentResearchContinuationReviewRequest,
          }
        : {}),
      coverage: {
        status:
          status === "coverage-closed"
            ? "closed"
            : status === "incomplete"
              ? "incomplete"
              : "open",
      },
      ...(interruption === undefined ? {} : { interruption }),
    };
  }

  #requireView(campaignId: string): ResearchCampaignView {
    const view = this.#readView(campaignId);
    if (view === undefined) throw new AgentLedCampaignNotFoundError(campaignId);
    return view;
  }
}

export function openResearchCampaigns(
  options: OpenResearchCampaignsOptions,
): ResearchCampaigns {
  return new SqliteResearchCampaigns(options);
}
