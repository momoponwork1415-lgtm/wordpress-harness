import Database from "better-sqlite3";
import { z } from "zod";

import {
  canonicalDigest,
  canonicalJson,
} from "../../infrastructure/canonical-json.js";
import {
  campaignInterruptionSchema,
  campaignInputSchema,
  campaignCommandSchema,
  candidateVerificationRequestSchema,
  candidateReviewRequestSchema,
  humanCandidateReviewSchema,
  humanResearchContinuationReviewSchema,
  nativeRunReceiptSchema,
  researchAdmissionFailureSchema,
  researchContinuationReviewRequestSchema,
  type CampaignInput,
  type CampaignCommand,
  type CampaignOutcomeRef,
  type CampaignQuery,
  type CampaignStatus,
  type CandidateReviewRequest,
  type HumanCandidateReview,
  type HumanResearchContinuationReview,
  type CandidateVerificationRequest,
  type ResearchContinuationReviewRequest,
  type NativeAgentRuntime,
  type NativeRunReceipt,
  type OpenResearchCampaignsOptions,
  type ParkedProgrammeLead,
  type ResearchCampaigns,
  type ResearchCampaignView,
  type SealedNativeRun,
  type ResearchCandidate,
  type ResearchAdmissionFailure,
} from "./contracts.js";

const eventRowSchema = z.object({
  kind: z.enum([
    "campaign.defined",
    "native-run.recorded",
    "native-run.admission-failed",
    "candidate-review.recorded",
    "research-continuation-review.recorded",
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

const nativeRunAdmissionFailedPayloadSchema = z.strictObject({
  inputDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  failure: researchAdmissionFailureSchema,
});

const candidateReviewRecordedPayloadSchema = z.strictObject({
  inputDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  review: humanCandidateReviewSchema,
});

const researchContinuationReviewRecordedPayloadSchema = z.strictObject({
  inputDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  review: humanResearchContinuationReviewSchema,
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

function decodeJson(value: string): unknown {
  return JSON.parse(value) as unknown;
}

type FailedNativeAgentReceipt = Exclude<
  NativeRunReceipt,
  { readonly terminal: "completed" }
>;

function failedReceipt(
  run: SealedNativeRun,
  startedAt: Date,
  completedAt: Date,
  terminal: FailedNativeAgentReceipt["terminal"],
  summary: string,
): FailedNativeAgentReceipt {
  return {
    schemaVersion: 2,
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
  receipts: readonly NativeRunReceipt[],
): boolean {
  const usage = budgetUsage(receipts);
  return (
    receipts.length < input.budgetEnvelope.maxNativeRuns &&
    usage.wallTimeMs < input.budgetEnvelope.maxWallTimeMs
  );
}

function budgetUsage(receipts: readonly NativeRunReceipt[]): Readonly<{
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
  receipts: readonly NativeRunReceipt[],
): Readonly<{ maxWallTimeMs: number }> {
  const usage = budgetUsage(receipts);
  const remainingWallTimeMs =
    input.budgetEnvelope.maxWallTimeMs - usage.wallTimeMs;
  return {
    maxWallTimeMs: Math.min(
      remainingWallTimeMs,
      input.budgetEnvelope.researchGrantWallTimeMs,
    ),
  };
}

function exceededBudget(
  input: CampaignInput,
  receipts: readonly NativeRunReceipt[],
): boolean {
  const usage = budgetUsage(receipts);
  return (
    receipts.length > input.budgetEnvelope.maxNativeRuns ||
    usage.wallTimeMs > input.budgetEnvelope.maxWallTimeMs
  );
}

function candidatesFor(
  nativeRuns: readonly NativeRunReceipt[],
): readonly ResearchCandidate[] {
  const candidates = new Map<string, ResearchCandidate>();
  for (const receipt of nativeRuns) {
    if (receipt.terminal !== "completed") continue;
    for (const candidate of receipt.report.candidates) {
      const prior = candidates.get(candidate.candidateId);
      if (
        prior !== undefined &&
        canonicalJson(prior) !== canonicalJson(candidate)
      ) {
        throw new Error(
          `Research Candidate identity was reused with different evidence: ${candidate.candidateId}`,
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
      if (prior !== undefined && canonicalJson(prior) !== canonicalJson(lead)) {
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
  candidates: readonly ResearchCandidate[],
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
    schemaVersion: 2 as const,
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
  candidates: readonly ResearchCandidate[],
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
    schemaVersion: 2 as const,
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

function candidateVerificationRequestsFor(
  input: CampaignInput,
  inputDigest: string,
  candidates: readonly ResearchCandidate[],
  review: HumanCandidateReview | undefined,
): readonly CandidateVerificationRequest[] {
  if (review === undefined) return [];
  const candidatesById = new Map(
    candidates.map((candidate) => [candidate.candidateId, candidate]),
  );
  return review.decisions.flatMap((decision) => {
    if (decision.disposition !== "advance-to-candidate-verification") {
      return [];
    }
    const candidate = candidatesById.get(decision.candidateId);
    if (candidate === undefined) {
      throw new Error(
        `Candidate Verification Request references an unknown Candidate: ${decision.candidateId}`,
      );
    }
    if (candidate.reproductionRecipe === undefined) return [];
    const body = {
      kind: "candidate-verification-request" as const,
      schemaVersion: 2 as const,
      requestId: `${input.campaignId}:verification:${candidate.candidateId}`,
      campaignId: input.campaignId,
      campaignInputDigest: inputDigest,
      candidateReviewDigest: review.digest,
      targetSnapshot: input.targetSnapshot,
      ...(input.dependencySnapshots === undefined
        ? {}
        : { dependencySnapshots: input.dependencySnapshots }),
      candidate,
    };
    return [
      candidateVerificationRequestSchema.parse({
        ...body,
        digest: canonicalDigest(body),
      }),
    ];
  });
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

      const activeReview = activeCandidateReviewFor(view);
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
      if (
        view.status !== "research-continues" &&
        !hasRetryableResearchRun(view)
      ) {
        return outcomeFor(view);
      }
      if (!hasRunBudget(input, view.nativeRuns)) {
        this.#interruptForBudget(input, inputDigest);
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
        budgetAllowance: budgetAllowance(input, view.nativeRuns),
        ...(resumeFrom === undefined ? {} : { resumeFrom }),
        ...(researchContinuationNextActions === undefined
          ? {}
          : { researchContinuationNextActions }),
        ...(candidateReviewNextActions === undefined ||
        candidateReviewNextActions.length === 0
          ? {}
          : {
              candidateReviewNextActions,
            }),
      };
      const startedAt = this.#clock();
      const receipt = await this.#execute(run, startedAt);
      let admissionFailure: ResearchAdmissionFailure | undefined;
      if (receipt.terminal === "completed") {
        try {
          candidatesFor([...view.nativeRuns, receipt]);
        } catch {
          admissionFailure = {
            reason: "candidate-identity-conflict",
            runId: receipt.runId,
            nativeRunReceiptDigest: canonicalDigest(receipt),
            summary:
              "Native Agent Runtime reused a Candidate identity with different evidence.",
          };
        }
      }
      if (
        receipt.terminal === "completed" &&
        admissionFailure === undefined &&
        (receipt.report.parkedProgrammeLeads?.length ?? 0) > 0 &&
        run.programmeBoundary === undefined
      ) {
        admissionFailure = {
          reason: "parked-programme-lead-without-boundary",
          runId: receipt.runId,
          nativeRunReceiptDigest: canonicalDigest(receipt),
          summary:
            "Native Agent Runtime returned a parked Programme Lead without a Programme Research Boundary.",
        };
      }
      if (receipt.terminal === "completed" && admissionFailure === undefined) {
        try {
          parkedProgrammeLeadsFor([...view.nativeRuns, receipt]);
        } catch {
          admissionFailure = {
            reason: "parked-programme-lead-identity-conflict",
            runId: receipt.runId,
            nativeRunReceiptDigest: canonicalDigest(receipt),
            summary:
              "Native Agent Runtime reused a parked Programme Lead identity with different evidence.",
          };
        }
      }
      this.#database.transaction(() => {
        this.#append(input.campaignId, "native-run.recorded", {
          inputDigest,
          receipt,
        });
        if (admissionFailure !== undefined) {
          this.#append(input.campaignId, "native-run.admission-failed", {
            inputDigest,
            failure: admissionFailure,
          });
        }
      })();
      view = this.#requireView(input.campaignId);
      if (exceededBudget(input, view.nativeRuns)) {
        this.#interruptForBudget(input, inputDigest, true);
        view = this.#requireView(input.campaignId);
      }
      if (receipt.terminal !== "completed") {
        return outcomeFor(view);
      }
      if (admissionFailure !== undefined) {
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
  ): Promise<NativeRunReceipt> {
    let receipt: NativeRunReceipt;
    try {
      const returnedReceipt = await this.#runtime.execute(run);
      const decoded = nativeRunReceiptSchema.safeParse(returnedReceipt);
      receipt = decoded.success
        ? decoded.data
        : failedReceipt(
            run,
            startedAt,
            this.#clock(),
            "invalid-output",
            "Native Agent Runtime returned an unsupported output schema.",
          );
    } catch {
      receipt = failedReceipt(
        run,
        startedAt,
        this.#clock(),
        "provider-failed",
        "Native Agent Runtime failed before returning a receipt.",
      );
    }
    const bindingMismatch =
      receipt.runId !== run.runId ||
      receipt.runtimeProfileDigest !== run.agentRuntimeProfile.digest;
    if (bindingMismatch) {
      return failedReceipt(
        run,
        startedAt,
        this.#clock(),
        "invalid-output",
        "Native Run Receipt did not match the sealed Campaign binding.",
      );
    }
    return receipt;
  }

  #interruptForBudget(
    input: CampaignInput,
    inputDigest: string,
    exceeded = false,
  ): void {
    this.#append(input.campaignId, "campaign.interrupted", {
      inputDigest,
      interruption: {
        reason: "budget-exhausted",
        summary: exceeded
          ? "A Native Run exceeded the remaining Campaign budget."
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
    const candidateReviews: HumanCandidateReview[] = [];
    const researchContinuationReviews: HumanResearchContinuationReview[] = [];
    let interruption: z.infer<typeof campaignInterruptionSchema> | undefined;
    let admissionFailure: ResearchAdmissionFailure | undefined;
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
        continue;
      }
      if (row.kind === "native-run.admission-failed") {
        const event = nativeRunAdmissionFailedPayloadSchema.parse(value);
        const receipt = nativeRuns.find(
          (nativeRun) => nativeRun.runId === event.failure.runId,
        );
        if (
          event.inputDigest !== definition.inputDigest ||
          receipt?.terminal !== "completed" ||
          canonicalDigest(receipt) !== event.failure.nativeRunReceiptDigest
        ) {
          throw new Error(
            `Native Run admission failure binding mismatch: ${campaignId}`,
          );
        }
        if (admissionFailure !== undefined) {
          throw new Error(
            `Duplicate Native Run admission failure: ${campaignId}`,
          );
        }
        admissionFailure = event.failure;
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
    const admittedNativeRuns =
      admissionFailure === undefined
        ? nativeRuns
        : nativeRuns.filter(
            (nativeRun) => nativeRun.runId !== admissionFailure.runId,
          );
    const latest = admittedNativeRuns.at(-1);
    const candidates = candidatesFor(admittedNativeRuns);
    const parkedProgrammeLeads = parkedProgrammeLeadsFor(admittedNativeRuns);
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
    const candidateVerificationRequests = candidateVerificationRequestsFor(
      definition.input,
      definition.inputDigest,
      candidates,
      activeCandidateReview,
    );
    const verificationPreparationNeeded = candidates.filter((candidate) =>
      activeCandidateReview?.decisions.some(
        (decision) =>
          decision.candidateId === candidate.candidateId &&
          decision.disposition === "advance-to-candidate-verification" &&
          candidate.reproductionRecipe === undefined,
      ),
    );
    const reviewReturnsToResearch = activeCandidateReview?.decisions.some(
      (decision) => decision.disposition === "return-to-research",
    );
    const hasFailedResearchRun =
      latest !== undefined && latest.terminal !== "completed";
    let status: CampaignStatus;
    if (
      interruption !== undefined ||
      admissionFailure !== undefined ||
      hasFailedResearchRun
    ) {
      status = "incomplete";
    } else if (latest === undefined) {
      status = "research-continues";
    } else if (
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
      activeCandidateReview === undefined
    ) {
      status = "candidate-review-pending";
    } else if (verificationPreparationNeeded.length > 0) {
      status = "verification-preparation-needed";
    } else if (candidateVerificationRequests.length > 0) {
      status = "candidate-verification-ready";
    } else {
      status = "coverage-closed";
    }

    return {
      kind: "agent-led-campaign-outcome",
      schemaVersion: 2,
      campaignId,
      inputDigest: definition.inputDigest,
      status,
      input: definition.input,
      nativeRuns,
      candidateReviews,
      researchContinuationReviews,
      parkedProgrammeLeads,
      candidateVerificationRequests,
      verificationPreparationNeeded,
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
          status === "coverage-closed" ||
          status === "candidate-verification-ready" ||
          status === "verification-preparation-needed"
            ? "closed"
            : status === "incomplete"
              ? "incomplete"
              : "open",
      },
      ...(interruption === undefined ? {} : { interruption }),
      ...(admissionFailure === undefined ? {} : { admissionFailure }),
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
