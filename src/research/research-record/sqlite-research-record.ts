import Database from "better-sqlite3";
import { z } from "zod";

import {
  LedgerIntegrityError,
  UnsupportedLedgerSchemaError,
  newCampaignInputSchema,
  type NewCampaignInput,
} from "../contracts.js";
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

interface LedgerProjection {
  readonly preparation: PreparationRecord;
  readonly verifications: ReadonlyMap<string, StoredVerification>;
}

function verificationRef(
  verificationId: string,
  recordDigest: string,
): VerificationRecordRef {
  return {
    kind: "verification-record",
    schemaVersion: 1,
    verificationId,
    digest: recordDigest,
    outcome: "finding",
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
        kind: "verification-record",
        schemaVersion: 1,
        verificationId: input.verificationId,
        campaignId: input.campaignId,
        planDigest: input.planDigest,
        targetSnapshotDigest: input.targetSnapshotDigest,
        hypothesisDigest: input.hypothesisDigest,
        sourceRederivation: input.sourceRederivation,
        witness: input.witness,
        control: input.control,
        outcome: input.outcome,
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
        ref: verificationRef(input.verificationId, recordDigest),
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

    const verifications = new Map<string, StoredVerification>();
    for (const event of rows.slice(1)) {
      if (event.kind === "campaign.prepared") {
        throw new LedgerIntegrityError(campaignId, "invalid-event-order");
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
