import Database from "better-sqlite3";
import { z } from "zod";

import {
  canonicalDigest,
  encodeCanonicalJson,
} from "../../infrastructure/canonical-json.js";
import {
  campaignInterruptionSchema,
  campaignInputSchema,
  nativeRunReceiptSchema,
  validationRunReceiptSchema,
  type CampaignInput,
  type CampaignOutcomeRef,
  type CampaignQuery,
  type CampaignStatus,
  type NativeAgentReceipt,
  type NativeAgentRuntime,
  type NativeRunReceipt,
  type OpenResearchCampaignsOptions,
  type ResearchCampaigns,
  type ResearchCampaignView,
  type SealedAgentRun,
  type SealedNativeRun,
  type SealedValidationRun,
  type ValidationCandidate,
  type ValidationRunReceipt,
  type ValidationRunRecord,
} from "./contracts.js";

const jsonValueSchema = z.json();

const eventRowSchema = z.object({
  kind: z.enum([
    "campaign.defined",
    "native-run.recorded",
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

const validationRunRecordedPayloadSchema = z.strictObject({
  inputDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  candidateId: z.string().min(1),
  receipt: validationRunReceiptSchema,
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

function encode(value: unknown): string {
  return encodeCanonicalJson(jsonValueSchema.parse(value));
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
    usage.wallTimeMs < input.budgetEnvelope.maxWallTimeMs &&
    usage.estimatedCostUsd < input.budgetEnvelope.maxEstimatedCostUsd
  );
}

function budgetUsage(receipts: readonly NativeAgentReceipt[]): Readonly<{
  wallTimeMs: number;
  estimatedCostUsd: number;
}> {
  const wallTimeMs = receipts.reduce(
    (total, receipt) => total + receipt.usage.wallTimeMs,
    0,
  );
  const estimatedCostUsd = receipts.reduce(
    (total, receipt) => total + (receipt.usage.estimatedCostUsd ?? 0),
    0,
  );
  return { wallTimeMs, estimatedCostUsd };
}

function budgetAllowance(
  input: CampaignInput,
  receipts: readonly NativeAgentReceipt[],
): Readonly<{ maxWallTimeMs: number; maxEstimatedCostUsd: number }> {
  const usage = budgetUsage(receipts);
  return {
    maxWallTimeMs: input.budgetEnvelope.maxWallTimeMs - usage.wallTimeMs,
    maxEstimatedCostUsd:
      input.budgetEnvelope.maxEstimatedCostUsd - usage.estimatedCostUsd,
  };
}

function exceededBudget(
  input: CampaignInput,
  receipts: readonly NativeAgentReceipt[],
): boolean {
  const usage = budgetUsage(receipts);
  return (
    receipts.length > input.budgetEnvelope.maxNativeRuns ||
    usage.wallTimeMs > input.budgetEnvelope.maxWallTimeMs ||
    usage.estimatedCostUsd > input.budgetEnvelope.maxEstimatedCostUsd
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

function outcomeFor(view: ResearchCampaignView): CampaignOutcomeRef {
  return {
    kind: view.kind,
    schemaVersion: view.schemaVersion,
    campaignId: view.campaignId,
    inputDigest: view.inputDigest,
    status: view.status,
  };
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

  async conduct(candidateInput: CampaignInput): Promise<CampaignOutcomeRef> {
    const input = campaignInputSchema.parse(candidateInput);
    const inputDigest = canonicalDigest(input);
    const existing = this.#readView(input.campaignId);
    if (existing !== undefined) {
      if (existing.inputDigest !== inputDigest) {
        throw new AgentLedCampaignConflictError(input.campaignId);
      }
      if (
        existing.status === "coverage-closed" ||
        existing.status === "incomplete"
      ) {
        return outcomeFor(existing);
      }
    } else {
      this.#append(input.campaignId, "campaign.defined", {
        input,
        inputDigest,
      });
    }

    let view = this.#requireView(input.campaignId);
    for (;;) {
      if (view.status === "coverage-closed" || view.status === "incomplete") {
        return outcomeFor(view);
      }

      const attemptedCandidates = new Set(
        view.validationRuns.map((record) => record.candidateId),
      );
      const pendingCandidate = candidatesFor(view.nativeRuns).find(
        (candidate) => !attemptedCandidates.has(candidate.candidateId),
      );
      if (
        pendingCandidate !== undefined &&
        view.status !== "research-continues"
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
          budgetAllowance: budgetAllowance(input, allReceipts(view)),
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

      if (view.status !== "research-continues") {
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
        promptSet: input.promptSet,
        agentRuntimeProfile: input.agentRuntimeProfile,
        permissionProfile: input.permissionProfile,
        budgetEnvelope: input.budgetEnvelope,
        budgetAllowance: budgetAllowance(input, allReceipts(view)),
        ...(resumeFrom === undefined ? {} : { resumeFrom }),
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
      this.#append(input.campaignId, "native-run.recorded", {
        inputDigest,
        receipt,
      });
      view = this.#requireView(input.campaignId);
      if (exceededBudget(input, allReceipts(view))) {
        this.#interruptForBudget(input, inputDigest, false, true);
        view = this.#requireView(input.campaignId);
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
    const payloadJson = encode(payload);
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
        if (
          validationRuns.some(
            (record) => record.candidateId === event.candidateId,
          )
        ) {
          throw new Error(
            `Duplicate Validation Run for Candidate: ${event.candidateId}`,
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
    const attemptedCandidates = new Set(
      validationRuns.map((record) => record.candidateId),
    );
    const hasUnattemptedCandidate = candidatesFor(nativeRuns).some(
      (candidate) => !attemptedCandidates.has(candidate.candidateId),
    );
    const hasFailedResearchRun = nativeRuns.some(
      (receipt) => receipt.terminal !== "completed",
    );
    const hasFailedValidationRun = validationRuns.some(
      (record) =>
        record.receipt.terminal !== "completed" ||
        record.receipt.report.disposition === "validation-pending",
    );
    let status: CampaignStatus;
    if (interruption !== undefined || hasFailedResearchRun) {
      status = "incomplete";
    } else if (latest === undefined) {
      status = "research-continues";
    } else if (
      needsResearchAfterLatestNativeRun ||
      (latest.terminal === "completed" &&
        latest.report.decision.kind === "continue")
    ) {
      status = "research-continues";
    } else if (hasUnattemptedCandidate) {
      status = "validation-pending";
    } else if (hasFailedValidationRun) {
      status = "incomplete";
    } else {
      status = "coverage-closed";
    }
    const candidates = candidatesFor(nativeRuns);
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
      findings,
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
