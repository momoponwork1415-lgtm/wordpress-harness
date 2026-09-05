import Database from "better-sqlite3";
import { z } from "zod";

import { canonicalJson, sha256Digest } from "../acquisition/canonical-json.js";
import {
  targetResearchPurposeByCampaignKind,
  targetResearchReasonByIntentionalCampaignKind,
} from "./campaign-codes.js";
import {
  legacyTargetResearchAdmissionRequestSchema,
  legacyTargetResearchHistoryArtifactSchema,
  legacyTargetResearchHistoryRecordInputSchema,
  targetResearchAdmissionRequestSchema,
  targetResearchHistoryRecordInputSchema,
  type OpenTargetResearchHistoryOptions,
  type RecordTargetResearchHistoryResult,
  type TargetResearchAdmission,
  type TargetResearchAdmissionRequest,
  type TargetResearchCampaign,
  type TargetResearchHistory,
  type TargetResearchHistoryRecord,
  type TargetResearchHistoryRecordInput,
} from "./contracts.js";

const storedSelectedEventSchema = z.strictObject({
  kind: z.literal("target-research-campaign-selected"),
  schemaVersion: z.literal(2),
  targetId: z.string(),
  campaignId: z.string(),
  campaignDigest: z.string(),
  request: targetResearchAdmissionRequestSchema,
});

const storedRecordEventSchema = z.strictObject({
  kind: z.literal("target-research-campaign-recorded"),
  schemaVersion: z.literal(2),
  input: targetResearchHistoryRecordInputSchema,
});

const legacyStoredSelectedEventSchema = z.strictObject({
  kind: z.literal("target-research-campaign-selected"),
  schemaVersion: z.literal(1),
  targetId: z.string(),
  campaignId: z.string(),
  campaignDigest: z.string(),
  request: legacyTargetResearchAdmissionRequestSchema,
});

const legacyStoredRecordEventSchema = z.strictObject({
  kind: z.literal("target-research-campaign-recorded"),
  schemaVersion: z.literal(1),
  input: legacyTargetResearchHistoryRecordInputSchema,
});

const storedEventSchema = z.union([
  storedSelectedEventSchema,
  storedRecordEventSchema,
  legacyStoredSelectedEventSchema,
  legacyStoredRecordEventSchema,
]);

type StoredEvent = z.infer<typeof storedEventSchema>;

const storedEventRowSchema = z.strictObject({
  global_sequence: z.number().int().positive(),
  event_id: z.string().min(1),
  event_digest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  occurred_at: z.string().datetime({ offset: true }),
  payload_json: z.string(),
});

type StoredEventRow = z.infer<typeof storedEventRowSchema>;

interface Projection {
  readonly campaigns: ReadonlyMap<string, TargetResearchCampaign>;
}

function shortId(prefix: string, digest: string): string {
  return `${prefix}:${digest.slice("sha256:".length, "sha256:".length + 24)}`;
}

function targetIdentityDigest(
  request:
    | TargetResearchAdmissionRequest
    | z.infer<typeof legacyTargetResearchAdmissionRequestSchema>,
): string {
  return sha256Digest({
    kind: "target-research-identity",
    schemaVersion: 1,
    ...request.target,
  });
}

function campaignIdentityDigest(
  request:
    | TargetResearchAdmissionRequest
    | z.infer<typeof legacyTargetResearchAdmissionRequestSchema>,
): string {
  return sha256Digest({
    kind: "target-research-campaign-identity",
    schemaVersion: request.schemaVersion,
    target: request.target,
    definition: request.campaign,
  });
}

function projectDefinition(
  stored:
    | z.infer<typeof legacyStoredSelectedEventSchema>
    | z.infer<typeof storedSelectedEventSchema>,
): TargetResearchCampaign["definition"] {
  if (stored.schemaVersion === 2) {
    return stored.request.campaign;
  }
  const definition = stored.request.campaign;
  const reason =
    definition.kind === "prospective"
      ? definition.runOrdinal > 1
        ? "incomplete-source-frontier-follow-up"
        : undefined
      : targetResearchReasonByIntentionalCampaignKind[definition.kind];
  return {
    kind: definition.kind,
    runOrdinal: definition.runOrdinal,
    policy: definition.policy,
    profile: definition.profile,
    purpose: targetResearchPurposeByCampaignKind[definition.kind],
    ...(reason === undefined ? {} : { reason }),
    ...(definition.followUp === undefined
      ? {}
      : { followUp: definition.followUp }),
  };
}

function parseStoredEvent(row: StoredEventRow): StoredEvent {
  const stored = storedEventSchema.parse(JSON.parse(row.payload_json));
  const expectedDigest = sha256Digest(stored);
  if (
    row.event_digest !== expectedDigest ||
    row.event_id !== shortId("history", expectedDigest)
  ) {
    throw new Error("Target Research History event integrity mismatch");
  }
  return stored;
}

function project(rows: readonly StoredEventRow[]): Projection {
  const campaigns = new Map<string, TargetResearchCampaign>();
  for (const row of rows) {
    const stored = parseStoredEvent(row);
    if (stored.kind === "target-research-campaign-selected") {
      const expectedTargetId = shortId(
        "target",
        targetIdentityDigest(stored.request),
      );
      const expectedCampaignDigest = campaignIdentityDigest(stored.request);
      if (
        stored.targetId !== expectedTargetId ||
        stored.campaignDigest !== expectedCampaignDigest ||
        stored.campaignId !== shortId("campaign", expectedCampaignDigest)
      ) {
        throw new Error("Target Research Campaign identity mismatch");
      }
      if (campaigns.has(stored.campaignId)) {
        throw new Error("Target Research Campaign selection is duplicated");
      }
      campaigns.set(stored.campaignId, {
        id: stored.campaignId,
        digest: stored.campaignDigest,
        targetId: stored.targetId,
        target: stored.request.target,
        definition: projectDefinition(stored),
        historySchemaVersion: stored.schemaVersion,
        status: "selected",
        selectedAt: row.occurred_at,
      });
      continue;
    }

    const previous = campaigns.get(stored.input.campaignId);
    if (previous === undefined) {
      throw new Error("Target Research History references an unknown Campaign");
    }
    if (stored.input.event.kind === "campaign-started") {
      if (previous.startedAt !== undefined) {
        throw new Error("Target Research Campaign start is duplicated");
      }
      campaigns.set(previous.id, {
        ...previous,
        status: "active",
        startedAt: row.occurred_at,
        lastProgressAt: row.occurred_at,
      });
      continue;
    }
    if (previous.status !== "active" || previous.startedAt === undefined) {
      throw new Error("Target Research Campaign lifecycle is out of order");
    }
    if (stored.input.event.kind === "campaign-progressed") {
      campaigns.set(previous.id, {
        ...previous,
        lastProgressAt: row.occurred_at,
      });
      continue;
    }
    if (stored.input.event.terminalStatus === "coverage-closed") {
      campaigns.set(previous.id, {
        ...previous,
        status: "coverage-closed",
        completedAt: row.occurred_at,
        terminalStatus: "coverage-closed",
      });
      continue;
    }
    campaigns.set(previous.id, {
      ...previous,
      status: "incomplete",
      completedAt: row.occurred_at,
      terminalStatus: "incomplete",
      terminalReason:
        stored.schemaVersion === 1
          ? "legacy-unclassified"
          : stored.input.event.reason,
    });
  }
  return { campaigns };
}

class SqliteTargetResearchHistory implements TargetResearchHistory {
  readonly #database: Database.Database;
  readonly #clock: () => Date;

  constructor(options: OpenTargetResearchHistoryOptions) {
    this.#database = new Database(options.databasePath);
    this.#clock = options.clock ?? (() => new Date());
    this.#database.pragma("journal_mode = WAL");
    this.#database.pragma("busy_timeout = 5000");
    this.#database.exec(`
      CREATE TABLE IF NOT EXISTS target_research_history_events (
        global_sequence INTEGER PRIMARY KEY AUTOINCREMENT,
        event_id TEXT NOT NULL UNIQUE,
        event_digest TEXT NOT NULL UNIQUE,
        occurred_at TEXT NOT NULL,
        payload_json TEXT NOT NULL
      ) STRICT;
    `);
  }

  async migrateLegacyArtifact(artifactValue: unknown): Promise<void> {
    const artifact =
      legacyTargetResearchHistoryArtifactSchema.parse(artifactValue);
    const transact = this.#database.transaction(() => {
      const current = project(this.#selectEvents());
      if (
        [...current.campaigns.values()].some(
          (campaign) => campaign.historySchemaVersion !== 1,
        )
      ) {
        throw new Error(
          "Legacy Target Research History cannot be mixed with the v2 writer",
        );
      }
      const campaignIds = new Map<string, string>();
      for (const entry of artifact.entries) {
        let stored: StoredEvent;
        if (entry.kind === "campaign-selected") {
          if (campaignIds.has(entry.campaignKey)) {
            throw new Error(
              "Legacy Target Research campaign key is duplicated",
            );
          }
          const targetId = shortId(
            "target",
            targetIdentityDigest(entry.request),
          );
          const campaignDigest = campaignIdentityDigest(entry.request);
          const campaignId = shortId("campaign", campaignDigest);
          campaignIds.set(entry.campaignKey, campaignId);
          stored = {
            kind: "target-research-campaign-selected",
            schemaVersion: 1,
            targetId,
            campaignId,
            campaignDigest,
            request: entry.request,
          };
        } else {
          const campaignId = campaignIds.get(entry.campaignKey);
          if (campaignId === undefined) {
            throw new Error(
              "Legacy Target Research record precedes its Campaign selection",
            );
          }
          stored = {
            kind: "target-research-campaign-recorded",
            schemaVersion: 1,
            input: {
              kind: "target-research-history-record",
              schemaVersion: 1,
              campaignId,
              event: entry.event,
            },
          };
        }
        const eventDigest = sha256Digest(stored);
        const existing = this.#selectEvent(eventDigest);
        if (existing === undefined) {
          this.#append(stored, entry.occurredAt);
        } else if (existing.occurred_at !== entry.occurredAt) {
          throw new Error("Legacy Target Research event time conflicts");
        }
      }
      project(this.#selectEvents());
    });
    transact();
  }

  async admit(
    requestValue: TargetResearchAdmissionRequest,
  ): Promise<TargetResearchAdmission> {
    const request = targetResearchAdmissionRequestSchema.parse(requestValue);
    const transact = this.#database.transaction((): TargetResearchAdmission => {
      const current = project(this.#selectEvents());
      const conflict = [...current.campaigns.values()].find(
        (campaign) =>
          campaign.target.pluginIdentity === request.target.pluginIdentity &&
          campaign.target.verifiedVersion === request.target.verifiedVersion &&
          campaign.target.canonicalFileManifestDigest !==
            request.target.canonicalFileManifestDigest,
      );
      if (conflict !== undefined) {
        return {
          status: "provenance-conflict",
          recordedTarget: conflict.target,
          observedTarget: request.target,
        };
      }
      const targetDigest = targetIdentityDigest(request);
      const targetId = shortId("target", targetDigest);
      const campaignDigest = campaignIdentityDigest(request);
      const campaignId = shortId("campaign", campaignDigest);
      const matching = [...current.campaigns.values()].filter(
        (campaign) => campaign.targetId === targetId,
      );
      const exact = current.campaigns.get(campaignId);
      const active = matching.find(
        (campaign) =>
          campaign.status === "selected" || campaign.status === "active",
      );
      if (active !== undefined) {
        return { status: "resume", campaign: active };
      }
      if (request.campaign.kind === "prospective") {
        const covered = [...matching]
          .reverse()
          .find((campaign) => campaign.status === "coverage-closed");
        if (covered !== undefined) {
          return { status: "already-covered", campaign: covered };
        }
        if (request.campaign.followUp !== undefined) {
          const followed = matching.find(
            (campaign) => campaign.id === request.campaign.followUp?.campaignId,
          );
          if (followed?.status !== "incomplete") {
            throw new Error(
              "Target Research follow-up does not reference an Incomplete Campaign",
            );
          }
          if (exact?.status === "incomplete") {
            return { status: "follow-up-required", campaign: exact };
          }
        } else {
          const incomplete = [...matching]
            .reverse()
            .find((campaign) => campaign.status === "incomplete");
          if (incomplete !== undefined) {
            return { status: "follow-up-required", campaign: incomplete };
          }
        }
      } else {
        if (exact?.status === "coverage-closed") {
          return { status: "already-covered", campaign: exact };
        }
        if (exact?.status === "incomplete") {
          return { status: "follow-up-required", campaign: exact };
        }
      }

      const stored: StoredEvent = {
        kind: "target-research-campaign-selected",
        schemaVersion: 2,
        targetId,
        campaignId,
        campaignDigest,
        request,
      };
      this.#append(stored, this.#clock().toISOString());
      const campaign = project(this.#selectEvents()).campaigns.get(campaignId);
      if (campaign === undefined) {
        throw new Error("Target Research Campaign selection append failed");
      }
      return { status: "new", campaign };
    });
    return transact();
  }

  async record(
    inputValue: TargetResearchHistoryRecordInput,
  ): Promise<RecordTargetResearchHistoryResult> {
    const input = targetResearchHistoryRecordInputSchema.parse(inputValue);
    const stored: StoredEvent = {
      kind: "target-research-campaign-recorded",
      schemaVersion: 2,
      input,
    };
    const eventDigest = sha256Digest(stored);
    const transact = this.#database.transaction(
      (): RecordTargetResearchHistoryResult => {
        const existing = this.#selectEvent(eventDigest);
        if (existing !== undefined) {
          return this.#recordResult("replayed", existing);
        }

        const current = project(this.#selectEvents());
        const campaign = current.campaigns.get(input.campaignId);
        if (campaign === undefined) {
          throw new Error(
            "Target Research History record has unknown Campaign",
          );
        }
        if (campaign.historySchemaVersion !== 2) {
          throw new Error(
            "Legacy Target Research Campaign is read-only; v1 and v2 writers cannot mix",
          );
        }
        if (input.event.kind === "campaign-started") {
          if (campaign.status !== "selected") {
            throw new Error("Target Research Campaign cannot be started");
          }
        } else if (campaign.status !== "active") {
          throw new Error("Target Research Campaign is not active");
        }
        const appended = this.#append(stored, this.#clock().toISOString());
        return this.#recordResult("appended", appended);
      },
    );
    return transact();
  }

  #append(stored: StoredEvent, occurredAt: string): StoredEventRow {
    const payloadJson = canonicalJson(stored);
    const eventDigest = sha256Digest(stored);
    const eventId = shortId("history", eventDigest);
    this.#database
      .prepare(
        `INSERT INTO target_research_history_events (
           event_id, event_digest, occurred_at, payload_json
         ) VALUES (?, ?, ?, ?)`,
      )
      .run(eventId, eventDigest, occurredAt, payloadJson);
    const row = this.#selectEvent(eventDigest);
    if (row === undefined) {
      throw new Error("Target Research History event append failed");
    }
    return row;
  }

  #recordResult(
    status: RecordTargetResearchHistoryResult["status"],
    row: StoredEventRow,
  ): RecordTargetResearchHistoryResult {
    const stored = parseStoredEvent(row);
    if (stored.kind !== "target-research-campaign-recorded") {
      throw new Error("Target Research History record identity is occupied");
    }
    if (stored.schemaVersion !== 2) {
      throw new Error(
        "Legacy Target Research History event cannot be returned through the v2 writer",
      );
    }
    const campaign = project(this.#selectEvents()).campaigns.get(
      stored.input.campaignId,
    );
    if (campaign === undefined) {
      throw new Error("Target Research History record lost its Campaign");
    }
    const historyRecord: TargetResearchHistoryRecord = {
      id: row.event_id,
      digest: row.event_digest,
      campaignId: stored.input.campaignId,
      occurredAt: row.occurred_at,
      event: stored.input.event,
    };
    return { status, historyRecord, campaign };
  }

  #selectEvents(): readonly StoredEventRow[] {
    return storedEventRowSchema.array().parse(
      this.#database
        .prepare(
          `SELECT global_sequence, event_id, event_digest, occurred_at,
                payload_json
           FROM target_research_history_events
          ORDER BY global_sequence`,
        )
        .all(),
    );
  }

  #selectEvent(eventDigest: string): StoredEventRow | undefined {
    return storedEventRowSchema.optional().parse(
      this.#database
        .prepare(
          `SELECT global_sequence, event_id, event_digest, occurred_at,
                payload_json
           FROM target_research_history_events
          WHERE event_digest = ?`,
        )
        .get(eventDigest),
    );
  }
}

export function openTargetResearchHistory(
  options: OpenTargetResearchHistoryOptions,
): TargetResearchHistory {
  return new SqliteTargetResearchHistory(options);
}
