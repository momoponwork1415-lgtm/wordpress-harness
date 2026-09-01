import Database from "better-sqlite3";
import { z } from "zod";

import {
  LedgerIntegrityError,
  UnsupportedLedgerSchemaError,
  newCampaignInputSchema,
  type NewCampaignInput,
} from "../contracts.js";
import {
  CampaignRunConflictError,
  campaignRunCompletionInputSchema,
  campaignRunPlanSchema,
  campaignRunRecordSchema,
  type CampaignRunCompletionInput,
  type CampaignRunPlan,
  type CampaignRunRecordRef,
  type CampaignRunRecordView,
} from "../campaign-control/contracts.js";
import {
  VerificationConflictError,
  verificationCompletionInputSchema,
  verificationPlanSchema,
  verificationRecordSchema,
  type VerificationCompletionInput,
  type VerificationPlan,
  type VerificationRecordRef,
  type VerificationRecordView,
} from "../verification/contracts.js";
import { canonicalJson, sha256Digest } from "./canonical-json.js";
import type {
  OpenResearchRecordOptions,
  PreparationRecord,
  RecordCampaignRunStartResult,
  RecordPreparationResult,
  RecordVerificationStartResult,
  ResearchRecord,
} from "./contracts.js";

const digestSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);

const campaignPreparedPayloadSchema = z.strictObject({
  input: newCampaignInputSchema,
  inputDigest: digestSchema,
});

const verificationStartedPayloadSchema = z.strictObject({
  plan: verificationPlanSchema,
  planDigest: digestSchema,
});

const verificationCompletedPayloadSchema = z.strictObject({
  completionInputDigest: digestSchema,
  record: verificationRecordSchema,
  recordDigest: digestSchema,
});

const campaignRunStartedPayloadSchema = z.strictObject({
  plan: campaignRunPlanSchema,
  planDigest: digestSchema,
});

const campaignRunCompletedPayloadSchema = z.strictObject({
  completionInputDigest: digestSchema,
  record: campaignRunRecordSchema,
  recordDigest: digestSchema,
});

const storedEventRowSchema = z.strictObject({
  campaign_sequence: z.number().int().positive(),
  kind: z.string(),
  schema_version: z.number().int().positive(),
  occurred_at: z.string(),
  payload_json: z.string(),
});

type StoredEventRow = z.infer<typeof storedEventRowSchema>;

interface StoredVerification {
  readonly plan: VerificationPlan;
  readonly planDigest: string;
  readonly startedAt: string;
  readonly startedLedgerHead: number;
  readonly completionInputDigest?: string;
  readonly completed?: VerificationRecordView;
}

interface StoredCampaignRun {
  readonly plan: CampaignRunPlan;
  readonly planDigest: string;
  readonly startedAt: string;
  readonly startedLedgerHead: number;
  readonly completionInputDigest?: string;
  readonly completed?: CampaignRunRecordView;
}

interface LedgerProjection {
  readonly preparation: PreparationRecord;
  readonly runs: ReadonlyMap<string, StoredCampaignRun>;
  readonly verifications: ReadonlyMap<string, StoredVerification>;
}

function campaignRunRef(
  runId: string,
  recordDigest: string,
  decision: CampaignRunRecordRef["decision"],
): CampaignRunRecordRef {
  return {
    kind: "campaign-run-record",
    schemaVersion: 1,
    runId,
    digest: recordDigest,
    decision,
  };
}

function verificationRef(
  verificationId: string,
  recordDigest: string,
  outcome: VerificationRecordRef["outcome"],
): VerificationRecordRef {
  return {
    kind: "verification-record",
    schemaVersion: 1,
    verificationId,
    digest: recordDigest,
    outcome,
  };
}

class SqliteResearchRecord implements ResearchRecord {
  readonly #database: Database.Database;
  readonly #clock: () => Date;

  constructor(options: OpenResearchRecordOptions) {
    this.#database = new Database(options.databasePath);
    this.#clock = options.clock ?? (() => new Date());
    this.#database.pragma("journal_mode = WAL");
    this.#database.pragma("busy_timeout = 5000");
    this.#database.exec(`
      CREATE TABLE IF NOT EXISTS research_events (
        global_sequence INTEGER PRIMARY KEY AUTOINCREMENT,
        campaign_id TEXT NOT NULL,
        campaign_sequence INTEGER NOT NULL,
        kind TEXT NOT NULL,
        schema_version INTEGER NOT NULL,
        occurred_at TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        UNIQUE (campaign_id, campaign_sequence)
      ) STRICT;
    `);
  }

  async recordPreparation(
    input: NewCampaignInput,
  ): Promise<RecordPreparationResult> {
    const requestedInputDigest = sha256Digest(input);
    const transact = this.#database.transaction((): RecordPreparationResult => {
      const existingRows = this.#readRows(input.campaignId);
      if (existingRows.length > 0) {
        return {
          disposition: "occupied",
          requestedInputDigest,
          preparation: this.#decodeLedger(input.campaignId, existingRows)
            .preparation,
        };
      }

      const occurredAt = this.#clock().toISOString();
      this.#insertEvent(input.campaignId, 1, "campaign.prepared", occurredAt, {
        input,
        inputDigest: requestedInputDigest,
      });

      return {
        disposition: "appended",
        requestedInputDigest,
        preparation: {
          campaignId: input.campaignId,
          ledgerHead: 1,
          occurredAt,
          inputDigest: requestedInputDigest,
          input,
        },
      };
    });

    return transact();
  }

  async readPreparation(
    campaignId: string,
  ): Promise<PreparationRecord | undefined> {
    const rows = this.#readRows(campaignId);
    return rows.length === 0
      ? undefined
      : this.#decodeLedger(campaignId, rows).preparation;
  }

  async recordCampaignRunStart(
    value: CampaignRunPlan,
  ): Promise<RecordCampaignRunStartResult> {
    const plan = campaignRunPlanSchema.parse(value);
    const planDigest = sha256Digest(plan);
    const transact = this.#database.transaction(
      (): RecordCampaignRunStartResult => {
        const rows = this.#readRows(plan.campaignId);
        if (rows.length === 0) {
          throw new Error(`Campaign not found: ${plan.campaignId}`);
        }
        const ledger = this.#decodeLedger(plan.campaignId, rows);
        const preparation = ledger.preparation;
        const input = preparation.input;
        const matchesModel = (candidate: { id: string; digest: string }) =>
          input.modelProfiles.some(
            (profile) =>
              profile.id === candidate.id &&
              profile.digest === candidate.digest,
          );
        if (
          preparation.inputDigest !== plan.preparationDigest ||
          plan.surfaceMap.targetSnapshotId !== input.targetSnapshot.id ||
          plan.verification.labBaseline.targetSnapshotDigest !==
            input.targetSnapshot.digest ||
          plan.verification.labBaseline.runtimeProfileDigest !==
            input.runtimeProfile.digest ||
          !matchesModel(plan.finder.modelProfile) ||
          !matchesModel(plan.verification.verifierModelProfile) ||
          plan.finder.promptSet.id !== input.promptSet.id ||
          plan.finder.promptSet.digest !== input.promptSet.digest ||
          plan.verification.promptSet.id !== input.promptSet.id ||
          plan.verification.promptSet.digest !== input.promptSet.digest ||
          plan.verification.experimentRegistry.id !==
            input.experimentRegistry.id ||
          plan.verification.experimentRegistry.digest !==
            input.experimentRegistry.digest ||
          plan.budget.maxFinderAttempts > input.budget.maxAttempts ||
          plan.budget.maxWallTimeMs > input.budget.maxWallTimeMs ||
          plan.budget.maxModelTokens > input.budget.maxModelTokens
        ) {
          throw new CampaignRunConflictError(plan.campaignId, plan.runId);
        }

        const existing = ledger.runs.get(plan.runId);
        if (existing !== undefined) {
          if (existing.planDigest !== planDigest) {
            throw new CampaignRunConflictError(plan.campaignId, plan.runId);
          }
          return existing.completed === undefined
            ? {
                disposition: "started",
                planDigest,
                ledgerHead: existing.startedLedgerHead,
                occurredAt: existing.startedAt,
              }
            : {
                disposition: "completed",
                planDigest,
                run: existing.completed,
              };
        }

        const occurredAt = this.#clock().toISOString();
        const ledgerHead = rows.length + 1;
        this.#insertEvent(
          plan.campaignId,
          ledgerHead,
          "campaign.run-started",
          occurredAt,
          { plan, planDigest },
        );
        return {
          disposition: "started",
          planDigest,
          ledgerHead,
          occurredAt,
        };
      },
    );
    return transact();
  }

  async recordCampaignRunCompletion(
    value: CampaignRunCompletionInput,
  ): Promise<CampaignRunRecordView> {
    const input = campaignRunCompletionInputSchema.parse(value);
    const completionInputDigest = sha256Digest(input);
    const transact = this.#database.transaction((): CampaignRunRecordView => {
      const rows = this.#readRows(input.campaignId);
      if (rows.length === 0) {
        throw new Error(`Campaign not found: ${input.campaignId}`);
      }
      const ledger = this.#decodeLedger(input.campaignId, rows);
      const existing = ledger.runs.get(input.runId);
      if (existing === undefined || existing.planDigest !== input.planDigest) {
        throw new LedgerIntegrityError(
          input.campaignId,
          "campaign-run-plan-digest-mismatch",
        );
      }
      if (existing.completed !== undefined) {
        if (existing.completionInputDigest !== completionInputDigest) {
          throw new CampaignRunConflictError(input.campaignId, input.runId);
        }
        return existing.completed;
      }

      const completedAt = this.#clock().toISOString();
      const record = campaignRunRecordSchema.parse({
        ...input,
        kind: "campaign-run-record",
        completedAt,
      });
      const recordDigest = sha256Digest(record);
      const ledgerHead = rows.length + 1;
      this.#insertEvent(
        input.campaignId,
        ledgerHead,
        "campaign.run-completed",
        completedAt,
        { completionInputDigest, record, recordDigest },
      );
      return {
        ledgerHead,
        occurredAt: completedAt,
        ref: campaignRunRef(input.runId, recordDigest, record.decision.kind),
        value: record,
      };
    });
    return transact();
  }

  async readCampaignRun(
    campaignId: string,
    runId: string,
  ): Promise<CampaignRunRecordView | undefined> {
    const rows = this.#readRows(campaignId);
    if (rows.length === 0) return undefined;
    return this.#decodeLedger(campaignId, rows).runs.get(runId)?.completed;
  }

  async recordVerificationStart(
    value: VerificationPlan,
  ): Promise<RecordVerificationStartResult> {
    const plan = verificationPlanSchema.parse(value);
    const planDigest = sha256Digest(plan);
    const transact = this.#database.transaction(
      (): RecordVerificationStartResult => {
        const rows = this.#readRows(plan.campaignId);
        if (rows.length === 0) {
          throw new Error(`Campaign not found: ${plan.campaignId}`);
        }
        const ledger = this.#decodeLedger(plan.campaignId, rows);
        if (
          canonicalJson(ledger.preparation.input.targetSnapshot) !==
          canonicalJson(plan.targetSnapshot)
        ) {
          throw new VerificationConflictError(
            plan.campaignId,
            plan.verificationId,
          );
        }

        const existing = ledger.verifications.get(plan.verificationId);
        if (existing !== undefined) {
          if (existing.planDigest !== planDigest) {
            throw new VerificationConflictError(
              plan.campaignId,
              plan.verificationId,
            );
          }
          return existing.completed === undefined
            ? {
                disposition: "started",
                planDigest,
                ledgerHead: existing.startedLedgerHead,
                occurredAt: existing.startedAt,
              }
            : {
                disposition: "completed",
                planDigest,
                verification: existing.completed,
              };
        }

        const occurredAt = this.#clock().toISOString();
        const ledgerHead = rows.length + 1;
        this.#insertEvent(
          plan.campaignId,
          ledgerHead,
          "verification.started",
          occurredAt,
          { plan, planDigest },
        );
        return {
          disposition: "started",
          planDigest,
          ledgerHead,
          occurredAt,
        };
      },
    );

    return transact();
  }

  async recordVerificationCompletion(
    value: VerificationCompletionInput,
  ): Promise<VerificationRecordView> {
    const input = verificationCompletionInputSchema.parse(value);
    const completionInputDigest = sha256Digest(input);
    const transact = this.#database.transaction((): VerificationRecordView => {
      const rows = this.#readRows(input.campaignId);
      if (rows.length === 0) {
        throw new Error(`Campaign not found: ${input.campaignId}`);
      }
      const ledger = this.#decodeLedger(input.campaignId, rows);
      const existing = ledger.verifications.get(input.verificationId);
      if (existing === undefined || existing.planDigest !== input.planDigest) {
        throw new LedgerIntegrityError(
          input.campaignId,
          "verification-plan-digest-mismatch",
        );
      }
      if (existing.completed !== undefined) {
        if (existing.completionInputDigest !== completionInputDigest) {
          throw new VerificationConflictError(
            input.campaignId,
            input.verificationId,
          );
        }
        return existing.completed;
      }

      const completedAt = this.#clock().toISOString();
      const record = verificationRecordSchema.parse({
        ...input,
        kind: "verification-record",
        completedAt,
      });
      const recordDigest = sha256Digest(record);
      const ledgerHead = rows.length + 1;
      this.#insertEvent(
        input.campaignId,
        ledgerHead,
        "verification.completed",
        completedAt,
        { completionInputDigest, record, recordDigest },
      );

      return {
        ledgerHead,
        occurredAt: completedAt,
        ref: verificationRef(
          input.verificationId,
          recordDigest,
          record.outcome.kind,
        ),
        value: record,
      };
    });

    return transact();
  }

  async readVerification(
    campaignId: string,
    verificationId: string,
  ): Promise<VerificationRecordView | undefined> {
    const rows = this.#readRows(campaignId);
    if (rows.length === 0) return undefined;
    return this.#decodeLedger(campaignId, rows).verifications.get(
      verificationId,
    )?.completed;
  }

  close(): void {
    this.#database.close();
  }

  #insertEvent(
    campaignId: string,
    campaignSequence: number,
    kind: string,
    occurredAt: string,
    payload: unknown,
  ): void {
    this.#database
      .prepare(
        `INSERT INTO research_events (
          campaign_id,
          campaign_sequence,
          kind,
          schema_version,
          occurred_at,
          payload_json
        ) VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        campaignId,
        campaignSequence,
        kind,
        1,
        occurredAt,
        canonicalJson(payload),
      );
  }

  #readRows(campaignId: string): readonly StoredEventRow[] {
    const rows: unknown[] = this.#database
      .prepare(
        `SELECT campaign_sequence, kind, schema_version, occurred_at, payload_json
         FROM research_events
         WHERE campaign_id = ?
         ORDER BY campaign_sequence ASC`,
      )
      .all(campaignId);

    return rows.map((row) => storedEventRowSchema.parse(row));
  }

  #decodeLedger(
    campaignId: string,
    rows: readonly StoredEventRow[],
  ): LedgerProjection {
    for (const [index, event] of rows.entries()) {
      if (event.campaign_sequence !== index + 1) {
        throw new LedgerIntegrityError(campaignId, "non-contiguous-sequence");
      }
    }

    const first = rows[0];
    if (first === undefined) {
      throw new Error(`Campaign not found: ${campaignId}`);
    }
    if (first.kind !== "campaign.prepared" || first.schema_version !== 1) {
      throw new UnsupportedLedgerSchemaError(first.kind, first.schema_version);
    }

    const preparationPayload = campaignPreparedPayloadSchema.parse(
      this.#parsePayload(first),
    );
    if (preparationPayload.input.campaignId !== campaignId) {
      throw new LedgerIntegrityError(campaignId, "campaign-id-mismatch");
    }
    if (
      sha256Digest(preparationPayload.input) !== preparationPayload.inputDigest
    ) {
      throw new LedgerIntegrityError(campaignId, "input-digest-mismatch");
    }

    const runs = new Map<string, StoredCampaignRun>();
    const verifications = new Map<string, StoredVerification>();
    for (const event of rows.slice(1)) {
      if (event.kind === "campaign.prepared") {
        throw new LedgerIntegrityError(campaignId, "invalid-event-order");
      }
      if (event.kind === "campaign.run-started") {
        if (event.schema_version !== 1) {
          throw new UnsupportedLedgerSchemaError(
            event.kind,
            event.schema_version,
          );
        }
        const payload = campaignRunStartedPayloadSchema.parse(
          this.#parsePayload(event),
        );
        if (
          payload.plan.campaignId !== campaignId ||
          sha256Digest(payload.plan) !== payload.planDigest ||
          runs.has(payload.plan.runId)
        ) {
          throw new LedgerIntegrityError(campaignId, "invalid-event-order");
        }
        runs.set(payload.plan.runId, {
          plan: payload.plan,
          planDigest: payload.planDigest,
          startedAt: event.occurred_at,
          startedLedgerHead: event.campaign_sequence,
        });
        continue;
      }
      if (event.kind === "campaign.run-completed") {
        if (event.schema_version !== 1) {
          throw new UnsupportedLedgerSchemaError(
            event.kind,
            event.schema_version,
          );
        }
        const payload = campaignRunCompletedPayloadSchema.parse(
          this.#parsePayload(event),
        );
        const existing = runs.get(payload.record.runId);
        if (
          existing === undefined ||
          existing.completed !== undefined ||
          payload.record.campaignId !== campaignId ||
          payload.record.planDigest !== existing.planDigest ||
          payload.record.completedAt !== event.occurred_at
        ) {
          throw new LedgerIntegrityError(campaignId, "invalid-event-order");
        }
        if (sha256Digest(payload.record) !== payload.recordDigest) {
          throw new LedgerIntegrityError(
            campaignId,
            "campaign-run-record-digest-mismatch",
          );
        }
        runs.set(payload.record.runId, {
          ...existing,
          completionInputDigest: payload.completionInputDigest,
          completed: {
            ledgerHead: event.campaign_sequence,
            occurredAt: event.occurred_at,
            ref: campaignRunRef(
              payload.record.runId,
              payload.recordDigest,
              payload.record.decision.kind,
            ),
            value: payload.record,
          },
        });
        continue;
      }
      if (event.kind === "verification.started") {
        if (event.schema_version !== 1) {
          throw new UnsupportedLedgerSchemaError(
            event.kind,
            event.schema_version,
          );
        }
        const payload = verificationStartedPayloadSchema.parse(
          this.#parsePayload(event),
        );
        if (
          payload.plan.campaignId !== campaignId ||
          sha256Digest(payload.plan) !== payload.planDigest ||
          verifications.has(payload.plan.verificationId)
        ) {
          throw new LedgerIntegrityError(campaignId, "invalid-event-order");
        }
        verifications.set(payload.plan.verificationId, {
          plan: payload.plan,
          planDigest: payload.planDigest,
          startedAt: event.occurred_at,
          startedLedgerHead: event.campaign_sequence,
        });
        continue;
      }
      if (event.kind === "verification.completed") {
        if (event.schema_version !== 1) {
          throw new UnsupportedLedgerSchemaError(
            event.kind,
            event.schema_version,
          );
        }
        const payload = verificationCompletedPayloadSchema.parse(
          this.#parsePayload(event),
        );
        const existing = verifications.get(payload.record.verificationId);
        if (
          existing === undefined ||
          existing.completed !== undefined ||
          payload.record.campaignId !== campaignId ||
          payload.record.planDigest !== existing.planDigest ||
          payload.record.completedAt !== event.occurred_at
        ) {
          throw new LedgerIntegrityError(campaignId, "invalid-event-order");
        }
        if (sha256Digest(payload.record) !== payload.recordDigest) {
          throw new LedgerIntegrityError(
            campaignId,
            "verification-record-digest-mismatch",
          );
        }
        verifications.set(payload.record.verificationId, {
          ...existing,
          completionInputDigest: payload.completionInputDigest,
          completed: {
            ledgerHead: event.campaign_sequence,
            occurredAt: event.occurred_at,
            ref: verificationRef(
              payload.record.verificationId,
              payload.recordDigest,
              payload.record.outcome.kind,
            ),
            value: payload.record,
          },
        });
        continue;
      }

      throw new UnsupportedLedgerSchemaError(event.kind, event.schema_version);
    }

    return {
      preparation: {
        campaignId,
        ledgerHead: rows.length,
        occurredAt: first.occurred_at,
        inputDigest: preparationPayload.inputDigest,
        input: preparationPayload.input,
      },
      runs,
      verifications,
    };
  }

  #parsePayload(event: StoredEventRow): unknown {
    return JSON.parse(event.payload_json) as unknown;
  }
}

export function openSqliteResearchRecord(
  options: OpenResearchRecordOptions,
): ResearchRecord {
  return new SqliteResearchRecord(options);
}
