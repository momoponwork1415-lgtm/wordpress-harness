import Database from "better-sqlite3";
import { z } from "zod";

import { canonicalJson, sha256Digest } from "./canonical-json.js";
import {
  CampaignPreparationConflictError,
  LedgerIntegrityError,
  UnsupportedLedgerSchemaError,
  newCampaignInputSchema,
  type CampaignView,
  type NewCampaignInput,
  type OpenResearchOptions,
  type SubjectRef,
  type SubjectView,
  type ResearchModule,
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

class SqliteResearch {
  readonly #database: Database.Database;
  readonly #clock: () => Date;

  constructor(options: OpenResearchOptions) {
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

  async prepare(input: NewCampaignInput): Promise<CampaignView> {
    const parsedInput = newCampaignInputSchema.parse(input);
    const inputDigest = sha256Digest(parsedInput);

    const transact = this.#database.transaction((): CampaignView => {
      const existing = this.#readRows(parsedInput.campaignId);
      if (existing.length > 0) {
        const current = this.#project(parsedInput.campaignId, existing);
        if (current.inputDigest !== inputDigest) {
          throw new CampaignPreparationConflictError(parsedInput.campaignId);
        }
        return current;
      }

      const occurredAt = this.#clock().toISOString();
      const payload = {
        input: parsedInput,
        inputDigest,
      };

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
          parsedInput.campaignId,
          1,
          "campaign.prepared",
          1,
          occurredAt,
          canonicalJson(payload),
        );

      return {
        campaignId: parsedInput.campaignId,
        status: "prepared",
        ledgerHead: 1,
        preparedAt: occurredAt,
        inputDigest,
        targetSnapshot: parsedInput.targetSnapshot,
      };
    });

    return transact();
  }

  async read(campaignId: string): Promise<CampaignView> {
    const rows = this.#readRows(campaignId);
    if (rows.length === 0) {
      throw new Error(`Campaign not found: ${campaignId}`);
    }
    return this.#project(campaignId, rows);
  }

  async inspect(
    campaignId: string,
    subject: SubjectRef,
  ): Promise<SubjectView> {
    const rows = this.#readRows(campaignId);
    if (rows.length === 0) {
      throw new Error(`Campaign not found: ${campaignId}`);
    }
    const preparation = this.#decodePreparation(campaignId, rows);

    return {
      kind: subject.kind,
      campaignId,
      preparedAt: preparation.event.occurred_at,
      inputDigest: preparation.payload.inputDigest,
      input: preparation.payload.input,
    };
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

  #project(campaignId: string, rows: readonly StoredEventRow[]): CampaignView {
    const preparation = this.#decodePreparation(campaignId, rows);

    return {
      campaignId,
      status: "prepared",
      ledgerHead: rows.length,
      preparedAt: preparation.event.occurred_at,
      inputDigest: preparation.payload.inputDigest,
      targetSnapshot: preparation.payload.input.targetSnapshot,
    };
  }

  #decodePreparation(
    campaignId: string,
    rows: readonly StoredEventRow[],
  ): {
    readonly event: StoredEventRow;
    readonly payload: CampaignPreparedPayload;
  } {
    for (const [index, event] of rows.entries()) {
      if (event.campaign_sequence !== index + 1) {
        throw new LedgerIntegrityError(
          campaignId,
          "non-contiguous-sequence",
        );
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
    const payload = campaignPreparedPayloadSchema.parse(payloadValue);
    if (payload.input.campaignId !== campaignId) {
      throw new LedgerIntegrityError(campaignId, "campaign-id-mismatch");
    }
    if (sha256Digest(payload.input) !== payload.inputDigest) {
      throw new LedgerIntegrityError(campaignId, "input-digest-mismatch");
    }

    return {
      event: first,
      payload,
    };
  }
}

export function openSqliteResearch(
  options: OpenResearchOptions,
): ResearchModule {
  const implementation = new SqliteResearch(options);

  return {
    runner: {
      prepare: (input) => implementation.prepare(input),
    },
    reader: {
      read: (campaignId) => implementation.read(campaignId),
      inspect: (campaignId, subject) =>
        implementation.inspect(campaignId, subject),
    },
    close: () => implementation.close(),
  };
}
