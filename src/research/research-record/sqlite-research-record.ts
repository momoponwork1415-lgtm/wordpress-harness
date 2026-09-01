import Database from "better-sqlite3";
import { z } from "zod";

import {
  LedgerIntegrityError,
  UnsupportedLedgerSchemaError,
  newCampaignInputSchema,
  type NewCampaignInput,
} from "../contracts.js";
import { canonicalJson, sha256Digest } from "./canonical-json.js";
import type {
  OpenResearchRecordOptions,
  PreparationRecord,
  RecordPreparationResult,
  ResearchRecord,
} from "./contracts.js";

const campaignPreparedPayloadSchema = z.strictObject({
  input: newCampaignInputSchema,
  inputDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
});

const storedEventRowSchema = z.strictObject({
  campaign_sequence: z.number().int().positive(),
  kind: z.string(),
  schema_version: z.number().int().positive(),
  occurred_at: z.string(),
  payload_json: z.string(),
});

type StoredEventRow = z.infer<typeof storedEventRowSchema>;
type CampaignPreparedPayload = z.infer<typeof campaignPreparedPayloadSchema>;

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
          preparation: this.#decodePreparation(input.campaignId, existingRows),
        };
      }

      const occurredAt = this.#clock().toISOString();
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
          input.campaignId,
          1,
          "campaign.prepared",
          1,
          occurredAt,
          canonicalJson({ input, inputDigest: requestedInputDigest }),
        );

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
      : this.#decodePreparation(campaignId, rows);
  }

  close(): void {
    this.#database.close();
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

  #decodePreparation(
    campaignId: string,
    rows: readonly StoredEventRow[],
  ): PreparationRecord {
    for (const [index, event] of rows.entries()) {
      if (event.campaign_sequence !== index + 1) {
        throw new LedgerIntegrityError(campaignId, "non-contiguous-sequence");
      }
      if (event.kind !== "campaign.prepared" || event.schema_version !== 1) {
        throw new UnsupportedLedgerSchemaError(
          event.kind,
          event.schema_version,
        );
      }
    }

    if (rows.length !== 1) {
      throw new LedgerIntegrityError(campaignId, "invalid-event-order");
    }

    const first = rows[0];
    if (first === undefined) {
      throw new Error(`Campaign not found: ${campaignId}`);
    }
    const payloadValue: unknown = JSON.parse(first.payload_json);
    const payload: CampaignPreparedPayload =
      campaignPreparedPayloadSchema.parse(payloadValue);
    if (payload.input.campaignId !== campaignId) {
      throw new LedgerIntegrityError(campaignId, "campaign-id-mismatch");
    }
    if (sha256Digest(payload.input) !== payload.inputDigest) {
      throw new LedgerIntegrityError(campaignId, "input-digest-mismatch");
    }

    return {
      campaignId,
      ledgerHead: rows.length,
      occurredAt: first.occurred_at,
      inputDigest: payload.inputDigest,
      input: payload.input,
    };
  }
}

export function openSqliteResearchRecord(
  options: OpenResearchRecordOptions,
): ResearchRecord {
  return new SqliteResearchRecord(options);
}
