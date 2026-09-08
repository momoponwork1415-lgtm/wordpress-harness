import Database from "better-sqlite3";
import { z } from "zod";

import {
  canonicalDigest,
  encodeCanonicalJson,
} from "../infrastructure/canonical-json.js";
import {
  sourceValidatedFindingSchema,
  type SourceValidatedFinding,
} from "../research/index.js";
import {
  aiReproductionRecordSchema,
  externalActionAuthorizationSchema,
  externalActionRequestSchema,
  humanOsFindingViewSchema,
  humanVerificationRecordSchema,
  submissionDraftSchema,
  type AIReproductionRecord,
  type ExternalActionAuthorization,
  type ExternalActionRequest,
  type HumanOsFindingView,
  type HumanVerificationRecord,
  type SubmissionDraft,
} from "./contracts-v3.js";

const eventSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("finding-received"),
    finding: sourceValidatedFindingSchema,
    receivedAt: z.iso.datetime(),
  }),
  z.strictObject({
    kind: z.literal("ai-reproduction-recorded"),
    record: aiReproductionRecordSchema,
  }),
  z.strictObject({
    kind: z.literal("human-verification-recorded"),
    record: humanVerificationRecordSchema,
  }),
  z.strictObject({
    kind: z.literal("submission-draft-saved"),
    draft: submissionDraftSchema,
  }),
  z.strictObject({
    kind: z.literal("external-action-authorized"),
    authorization: externalActionAuthorizationSchema,
  }),
]);

const rowSchema = z.strictObject({
  event_json: z.string(),
  event_digest: z.string(),
});

export type ExternalActionAdmission =
  | { readonly status: "authorized"; readonly authorizationId: string }
  | {
      readonly status: "not-authorized";
      readonly reason:
        | "finding-not-found"
        | "draft-not-found"
        | "human-verification-required"
        | "exact-authorization-required";
    };

export interface HumanOs {
  receiveFinding(input: {
    readonly finding: SourceValidatedFinding;
    readonly receivedAt: string;
  }): Promise<HumanOsFindingView>;
  recordAIReproduction(record: AIReproductionRecord): Promise<void>;
  recordHumanVerification(record: HumanVerificationRecord): Promise<void>;
  saveSubmissionDraft(draft: SubmissionDraft): Promise<void>;
  authorizeExternalAction(
    authorization: ExternalActionAuthorization,
  ): Promise<void>;
  admitExternalAction(
    request: ExternalActionRequest,
  ): Promise<ExternalActionAdmission>;
  inspect(findingId: string): Promise<HumanOsFindingView>;
  close(): void;
}

export interface OpenHumanOsOptions {
  readonly databasePath: string;
}

function encode(value: unknown): string {
  return encodeCanonicalJson(z.json().parse(value));
}

class SqliteHumanOs implements HumanOs {
  readonly #database: Database.Database;

  constructor(options: OpenHumanOsOptions) {
    this.#database = new Database(options.databasePath);
    this.#database.pragma("journal_mode = WAL");
    this.#database.exec(`
      CREATE TABLE IF NOT EXISTS human_os_events_v3 (
        global_sequence INTEGER PRIMARY KEY AUTOINCREMENT,
        finding_id TEXT NOT NULL,
        finding_sequence INTEGER NOT NULL,
        event_json TEXT NOT NULL,
        event_digest TEXT NOT NULL,
        UNIQUE (finding_id, finding_sequence)
      ) STRICT;
    `);
  }

  async receiveFinding(input: {
    readonly finding: SourceValidatedFinding;
    readonly receivedAt: string;
  }): Promise<HumanOsFindingView> {
    const finding = sourceValidatedFindingSchema.parse(input.finding);
    const receivedAt = z.iso.datetime().parse(input.receivedAt);
    const existing = this.#read(finding.findingId);
    if (existing !== undefined) {
      if (canonicalDigest(existing.finding) !== canonicalDigest(finding)) {
        throw new Error(`Human OS Finding conflict: ${finding.findingId}`);
      }
      return existing;
    }
    this.#append(finding.findingId, {
      kind: "finding-received",
      finding,
      receivedAt,
    });
    return this.#require(finding.findingId);
  }

  async recordAIReproduction(record: AIReproductionRecord): Promise<void> {
    const value = aiReproductionRecordSchema.parse(record);
    const view = this.#require(value.findingId);
    if (
      value.environment.targetSnapshotDigest !==
      view.finding.targetSnapshot.digest
    ) {
      throw new Error("AI Reproduction Target binding mismatch");
    }
    if (view.aiReproductions.some((item) => item.id === value.id)) return;
    this.#append(value.findingId, {
      kind: "ai-reproduction-recorded",
      record: value,
    });
  }

  async recordHumanVerification(
    record: HumanVerificationRecord,
  ): Promise<void> {
    const value = humanVerificationRecordSchema.parse(record);
    const view = this.#require(value.findingId);
    const reproduction = view.aiReproductions.find(
      (item) => item.id === value.aiReproductionId,
    );
    if (
      reproduction === undefined ||
      value.environment.targetSnapshotDigest !==
        view.finding.targetSnapshot.digest ||
      value.environment.environmentId === reproduction.environment.environmentId
    ) {
      throw new Error(
        "Human Verification requires its bound AI Reproduction and a separate fresh environment",
      );
    }
    if (view.humanVerifications.some((item) => item.id === value.id)) return;
    this.#append(value.findingId, {
      kind: "human-verification-recorded",
      record: value,
    });
  }

  async saveSubmissionDraft(draft: SubmissionDraft): Promise<void> {
    const value = submissionDraftSchema.parse(draft);
    const view = this.#require(value.findingId);
    const existingRevision = view.drafts.find(
      (item) => item.revision === value.revision,
    );
    if (existingRevision !== undefined) {
      if (existingRevision.id !== value.id) {
        throw new Error("Submission Draft revision conflict");
      }
      return;
    }
    const latestRevision = Math.max(
      0,
      ...view.drafts.map((item) => item.revision),
    );
    if (value.revision !== latestRevision + 1) {
      throw new Error("Submission Draft revisions must be contiguous");
    }
    this.#append(value.findingId, {
      kind: "submission-draft-saved",
      draft: value,
    });
  }

  async authorizeExternalAction(
    authorization: ExternalActionAuthorization,
  ): Promise<void> {
    const value = externalActionAuthorizationSchema.parse(authorization);
    const view = this.#require(value.findingId);
    const draft = view.drafts.find((item) => item.id === value.draftId);
    const humanConfirmed = view.humanVerifications.some(
      (item) => item.status === "human-confirmed",
    );
    if (
      draft === undefined ||
      canonicalDigest(draft) !== value.draftDigest ||
      draft.destination !== value.destination ||
      !humanConfirmed
    ) {
      throw new Error(
        "External Action Authorization requires an exact Draft and human-confirmed verification",
      );
    }
    if (view.authorizations.some((item) => item.id === value.id)) return;
    this.#append(value.findingId, {
      kind: "external-action-authorized",
      authorization: value,
    });
  }

  async admitExternalAction(
    candidate: ExternalActionRequest,
  ): Promise<ExternalActionAdmission> {
    const request = externalActionRequestSchema.parse(candidate);
    const view = this.#read(request.findingId);
    if (view === undefined) {
      return { status: "not-authorized", reason: "finding-not-found" };
    }
    if (!view.drafts.some((draft) => draft.id === request.draftId)) {
      return { status: "not-authorized", reason: "draft-not-found" };
    }
    if (
      !view.humanVerifications.some(
        (verification) => verification.status === "human-confirmed",
      )
    ) {
      return {
        status: "not-authorized",
        reason: "human-verification-required",
      };
    }
    const authorization = view.authorizations.find(
      (item) =>
        item.draftId === request.draftId &&
        item.draftDigest === request.draftDigest &&
        item.destination === request.destination,
    );
    return authorization === undefined
      ? { status: "not-authorized", reason: "exact-authorization-required" }
      : { status: "authorized", authorizationId: authorization.id };
  }

  async inspect(findingId: string): Promise<HumanOsFindingView> {
    return this.#require(findingId);
  }

  close(): void {
    this.#database.close();
  }

  #append(findingId: string, event: z.infer<typeof eventSchema>): void {
    const value = eventSchema.parse(event);
    const eventJson = encode(value);
    const sequence = z
      .number()
      .int()
      .positive()
      .parse(
        this.#database
          .prepare(
            `SELECT COALESCE(MAX(finding_sequence), 0) + 1
             FROM human_os_events_v3 WHERE finding_id = ?`,
          )
          .pluck()
          .get(findingId),
      );
    this.#database
      .prepare(
        `INSERT INTO human_os_events_v3 (
           finding_id, finding_sequence, event_json, event_digest
         ) VALUES (?, ?, ?, ?)`,
      )
      .run(findingId, sequence, eventJson, canonicalDigest(value));
  }

  #read(findingId: string): HumanOsFindingView | undefined {
    const rows = z.array(rowSchema).parse(
      this.#database
        .prepare(
          `SELECT event_json, event_digest FROM human_os_events_v3
             WHERE finding_id = ? ORDER BY finding_sequence ASC`,
        )
        .all(findingId),
    );
    if (rows.length === 0) return undefined;
    const events = rows.map((row) => {
      const decoded: unknown = JSON.parse(row.event_json);
      if (canonicalDigest(decoded) !== row.event_digest) {
        throw new Error(`Human OS event digest mismatch: ${findingId}`);
      }
      return eventSchema.parse(decoded);
    });
    const first = events[0];
    if (first?.kind !== "finding-received") {
      throw new Error(`Human OS Finding handoff is missing: ${findingId}`);
    }
    return humanOsFindingViewSchema.parse({
      finding: first.finding,
      receivedAt: first.receivedAt,
      aiReproductions: events.flatMap((event) =>
        event.kind === "ai-reproduction-recorded" ? [event.record] : [],
      ),
      humanVerifications: events.flatMap((event) =>
        event.kind === "human-verification-recorded" ? [event.record] : [],
      ),
      drafts: events.flatMap((event) =>
        event.kind === "submission-draft-saved" ? [event.draft] : [],
      ),
      authorizations: events.flatMap((event) =>
        event.kind === "external-action-authorized"
          ? [event.authorization]
          : [],
      ),
    });
  }

  #require(findingId: string): HumanOsFindingView {
    const view = this.#read(findingId);
    if (view === undefined) {
      throw new Error(`Human OS Finding not found: ${findingId}`);
    }
    return view;
  }
}

export function openHumanOs(options: OpenHumanOsOptions): HumanOs {
  return new SqliteHumanOs(options);
}
