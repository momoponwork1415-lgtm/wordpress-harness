import Database from "better-sqlite3";
import { z } from "zod";

import {
  canonicalDigest,
  canonicalJson,
} from "../infrastructure/canonical-json.js";
import {
  candidateVerificationRequestSchema,
  type CandidateVerificationRequest,
} from "../research/index.js";
import {
  candidateVerificationRecordSchema,
  candidateVerificationViewSchema,
  defineCandidateVerificationRecord,
  defineSubmissionCandidate,
  externalActionAuthorizationSchema,
  externalActionRequestSchema,
  programmeScopeAssessmentSchema,
  submissionCandidateSchema,
  submissionDraftSchema,
  verifiedVulnerabilitySchema,
  type CandidateVerificationRecord,
  type CandidateVerificationView,
  type ExternalActionAuthorization,
  type ExternalActionRequest,
  type ProgrammeScopeAssessment,
  type SubmissionDraft,
  type VerifiedVulnerability,
} from "./contracts-v3.js";

const eventSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("candidate-verification-request-received"),
    request: candidateVerificationRequestSchema,
    receivedAt: z.iso.datetime(),
  }),
  z.strictObject({
    kind: z.literal("candidate-verification-completed"),
    record: candidateVerificationRecordSchema,
    verifiedVulnerability: verifiedVulnerabilitySchema.nullable(),
  }),
  z.strictObject({
    kind: z.literal("programme-scope-assessed"),
    scopeAssessments: z.array(programmeScopeAssessmentSchema),
    submissionCandidates: z.array(submissionCandidateSchema),
  }),
  z.strictObject({
    kind: z.literal("programme-scope-assessment-incomplete"),
    reason: z.literal("scope-evaluation-failed"),
    recordedAt: z.iso.datetime(),
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
        | "vulnerability-not-found"
        | "submission-candidate-not-found"
        | "draft-not-found"
        | "exact-authorization-required";
    };

export interface CandidateVerificationRuntime {
  execute(input: {
    readonly request: CandidateVerificationRequest;
  }): Promise<CandidateVerificationRecord>;
}

export interface ProgrammeScopeEvaluator {
  readonly programmeIdentities: readonly string[];
  assess(input: {
    readonly vulnerability: VerifiedVulnerability;
    readonly verification: CandidateVerificationRecord;
  }): Promise<readonly ProgrammeScopeAssessment[]>;
}

export interface HumanOs {
  receiveCandidateVerification(input: {
    readonly request: CandidateVerificationRequest;
    readonly receivedAt: string;
  }): Promise<CandidateVerificationView>;
  verifyCandidate(requestId: string): Promise<CandidateVerificationView>;
  saveSubmissionDraft(draft: SubmissionDraft): Promise<void>;
  authorizeExternalAction(
    authorization: ExternalActionAuthorization,
  ): Promise<void>;
  admitExternalAction(
    request: ExternalActionRequest,
  ): Promise<ExternalActionAdmission>;
  inspect(requestId: string): Promise<CandidateVerificationView>;
  close(): void;
}

export interface OpenHumanOsOptions {
  readonly databasePath: string;
  readonly candidateVerificationRuntime?: CandidateVerificationRuntime;
  readonly programmeScopeEvaluator?: ProgrammeScopeEvaluator;
  readonly clock?: () => Date;
}

class SqliteHumanOs implements HumanOs {
  readonly #database: Database.Database;
  readonly #runtime: CandidateVerificationRuntime | undefined;
  readonly #scopeEvaluator: ProgrammeScopeEvaluator | undefined;
  readonly #clock: () => Date;

  constructor(options: OpenHumanOsOptions) {
    this.#runtime = options.candidateVerificationRuntime;
    this.#scopeEvaluator = options.programmeScopeEvaluator;
    if (this.#scopeEvaluator !== undefined) {
      const identities = z
        .array(z.string().min(1).max(512))
        .min(1)
        .parse([...this.#scopeEvaluator.programmeIdentities]);
      if (new Set(identities).size !== identities.length) {
        throw new Error("Configured Programme identities must be unique");
      }
    }
    this.#clock = options.clock ?? (() => new Date());
    this.#database = new Database(options.databasePath);
    this.#database.pragma("journal_mode = WAL");
    this.#database.exec(`
      CREATE TABLE IF NOT EXISTS candidate_verification_events (
        global_sequence INTEGER PRIMARY KEY AUTOINCREMENT,
        request_id TEXT NOT NULL,
        request_sequence INTEGER NOT NULL,
        event_json TEXT NOT NULL,
        event_digest TEXT NOT NULL,
        UNIQUE (request_id, request_sequence)
      ) STRICT;
    `);
  }

  async receiveCandidateVerification(input: {
    readonly request: CandidateVerificationRequest;
    readonly receivedAt: string;
  }): Promise<CandidateVerificationView> {
    const request = candidateVerificationRequestSchema.parse(input.request);
    const receivedAt = z.iso.datetime().parse(input.receivedAt);
    const existing = this.#read(request.requestId);
    if (existing !== undefined) {
      if (canonicalDigest(existing.request) !== canonicalDigest(request)) {
        throw new Error(
          `Candidate Verification Request conflict: ${request.requestId}`,
        );
      }
      return existing;
    }
    this.#append(request.requestId, {
      kind: "candidate-verification-request-received",
      request,
      receivedAt,
    });
    return this.#require(request.requestId);
  }

  async verifyCandidate(requestId: string): Promise<CandidateVerificationView> {
    let view = this.#require(requestId);

    if (view.verificationRecords.length === 0) {
      let record: CandidateVerificationRecord;
      try {
        if (this.#runtime === undefined) {
          throw new Error("Candidate Verification Runtime is unavailable");
        }
        record = candidateVerificationRecordSchema.parse(
          await this.#runtime.execute({ request: view.request }),
        );
        if (
          record.requestId !== view.request.requestId ||
          record.candidateId !== view.request.candidate.candidateId ||
          (record.environment !== null &&
            record.environment.targetSnapshotDigest !==
              view.request.targetSnapshot.digest)
        ) {
          throw new Error("Candidate Verification binding mismatch");
        }
      } catch {
        record = defineCandidateVerificationRecord({
          kind: "candidate-verification-record",
          schemaVersion: 1,
          requestId: view.request.requestId,
          candidateId: view.request.candidate.candidateId,
          environment: null,
          status: "incomplete",
          summary:
            "Dynamic verification could not produce a Candidate-bound runtime result.",
          evidenceRequest: null,
          privateEvidence: [],
          recordedAt: this.#clock().toISOString(),
        });
      }

      const verifiedVulnerability =
        record.status === "runtime-confirmed"
          ? verifiedVulnerabilitySchema.parse({
              kind: "verified-vulnerability",
              schemaVersion: 1,
              vulnerabilityId: `${view.request.campaignId}:vulnerability:${view.request.candidate.candidateId}`,
              candidateId: view.request.candidate.candidateId,
              targetSnapshot: view.request.targetSnapshot,
              ...(view.request.dependencySnapshots === undefined
                ? {}
                : { dependencySnapshots: view.request.dependencySnapshots }),
              attackerPremise: view.request.candidate.attackerPremise,
              brokenSecurityProperty:
                view.request.candidate.brokenSecurityProperty,
              claim: view.request.candidate.claim,
              assurance: "runtime-confirmed",
              candidateVerificationRef: {
                id: record.id,
                digest: canonicalDigest(record),
              },
              evidence: view.request.candidate.evidence,
            })
          : null;

      this.#append(requestId, {
        kind: "candidate-verification-completed",
        record,
        verifiedVulnerability,
      });
      view = this.#require(requestId);
    }

    if (
      view.verifiedVulnerability === null ||
      this.#scopeEvaluator === undefined ||
      view.programmeScopeStatus === "completed"
    ) {
      return view;
    }

    try {
      const scopeAssessments = await this.#assessScope(
        view.verifiedVulnerability,
        view.verificationRecords[0]!,
      );
      const submissionCandidates = scopeAssessments.flatMap((assessment) =>
        assessment.status === "in-scope"
          ? [
              defineSubmissionCandidate({
                kind: "submission-candidate",
                schemaVersion: 1,
                vulnerabilityId: view.verifiedVulnerability!.vulnerabilityId,
                programmeIdentity: assessment.programmeIdentity,
                scopeAssessmentId: assessment.id,
                destination: assessment.destination,
              }),
            ]
          : [],
      );
      this.#append(requestId, {
        kind: "programme-scope-assessed",
        scopeAssessments: [...scopeAssessments],
        submissionCandidates,
      });
    } catch {
      this.#append(requestId, {
        kind: "programme-scope-assessment-incomplete",
        reason: "scope-evaluation-failed",
        recordedAt: this.#clock().toISOString(),
      });
    }
    return this.#require(requestId);
  }

  async #assessScope(
    vulnerability: VerifiedVulnerability,
    verification: CandidateVerificationRecord,
  ): Promise<readonly ProgrammeScopeAssessment[]> {
    if (this.#scopeEvaluator === undefined) return [];
    const assessments = z
      .array(programmeScopeAssessmentSchema)
      .parse(
        await this.#scopeEvaluator.assess({ vulnerability, verification }),
      );
    const expected = new Set(this.#scopeEvaluator.programmeIdentities);
    const observed = new Set(assessments.map((item) => item.programmeIdentity));
    if (
      expected.size === 0 ||
      expected.size !== observed.size ||
      assessments.length !== observed.size ||
      [...expected].some((identity) => !observed.has(identity)) ||
      assessments.some(
        (assessment) =>
          assessment.vulnerabilityId !== vulnerability.vulnerabilityId,
      )
    ) {
      throw new Error(
        "Programme Scope Evaluator did not assess every configured programme exactly once",
      );
    }
    return assessments;
  }

  async saveSubmissionDraft(draft: SubmissionDraft): Promise<void> {
    const value = submissionDraftSchema.parse(draft);
    const located = this.#findByVulnerability(value.vulnerabilityId);
    if (
      !located.view.submissionCandidates.some(
        (candidate) =>
          candidate.id === value.submissionCandidateId &&
          candidate.destination === value.destination,
      )
    ) {
      throw new Error("Submission Draft requires an in-scope destination");
    }
    const existing = located.view.drafts.find(
      (item) =>
        item.submissionCandidateId === value.submissionCandidateId &&
        item.revision === value.revision,
    );
    if (existing !== undefined) {
      if (existing.id !== value.id) {
        throw new Error("Submission Draft revision conflict");
      }
      return;
    }
    const latestRevision = Math.max(
      0,
      ...located.view.drafts
        .filter(
          (item) => item.submissionCandidateId === value.submissionCandidateId,
        )
        .map((item) => item.revision),
    );
    if (value.revision !== latestRevision + 1) {
      throw new Error("Submission Draft revisions must be contiguous");
    }
    this.#append(located.requestId, {
      kind: "submission-draft-saved",
      draft: value,
    });
  }

  async authorizeExternalAction(
    authorization: ExternalActionAuthorization,
  ): Promise<void> {
    const value = externalActionAuthorizationSchema.parse(authorization);
    const located = this.#findByVulnerability(value.vulnerabilityId);
    const candidate = located.view.submissionCandidates.find(
      (item) => item.id === value.submissionCandidateId,
    );
    const draft = located.view.drafts.find((item) => item.id === value.draftId);
    if (
      candidate === undefined ||
      draft === undefined ||
      draft.submissionCandidateId !== candidate.id ||
      canonicalDigest(draft) !== value.draftDigest ||
      draft.destination !== value.destination ||
      candidate.destination !== value.destination
    ) {
      throw new Error(
        "External Action Authorization requires an exact in-scope Submission Candidate and Draft",
      );
    }
    if (located.view.authorizations.some((item) => item.id === value.id))
      return;
    this.#append(located.requestId, {
      kind: "external-action-authorized",
      authorization: value,
    });
  }

  async admitExternalAction(
    candidate: ExternalActionRequest,
  ): Promise<ExternalActionAdmission> {
    const request = externalActionRequestSchema.parse(candidate);
    const located = this.#tryFindByVulnerability(request.vulnerabilityId);
    if (located === undefined) {
      return { status: "not-authorized", reason: "vulnerability-not-found" };
    }
    if (
      !located.view.submissionCandidates.some(
        (item) => item.id === request.submissionCandidateId,
      )
    ) {
      return {
        status: "not-authorized",
        reason: "submission-candidate-not-found",
      };
    }
    if (!located.view.drafts.some((draft) => draft.id === request.draftId)) {
      return { status: "not-authorized", reason: "draft-not-found" };
    }
    const authorization = located.view.authorizations.find(
      (item) =>
        item.submissionCandidateId === request.submissionCandidateId &&
        item.draftId === request.draftId &&
        item.draftDigest === request.draftDigest &&
        item.destination === request.destination,
    );
    return authorization === undefined
      ? { status: "not-authorized", reason: "exact-authorization-required" }
      : { status: "authorized", authorizationId: authorization.id };
  }

  async inspect(requestId: string): Promise<CandidateVerificationView> {
    return this.#require(requestId);
  }

  close(): void {
    this.#database.close();
  }

  #append(requestId: string, event: z.infer<typeof eventSchema>): void {
    const value = eventSchema.parse(event);
    const eventJson = canonicalJson(value);
    const sequence = z
      .number()
      .int()
      .positive()
      .parse(
        this.#database
          .prepare(
            `SELECT COALESCE(MAX(request_sequence), 0) + 1
           FROM candidate_verification_events WHERE request_id = ?`,
          )
          .pluck()
          .get(requestId),
      );
    this.#database
      .prepare(
        `INSERT INTO candidate_verification_events (
           request_id, request_sequence, event_json, event_digest
         ) VALUES (?, ?, ?, ?)`,
      )
      .run(requestId, sequence, eventJson, canonicalDigest(value));
  }

  #read(requestId: string): CandidateVerificationView | undefined {
    const rows = z.array(rowSchema).parse(
      this.#database
        .prepare(
          `SELECT event_json, event_digest FROM candidate_verification_events
           WHERE request_id = ? ORDER BY request_sequence ASC`,
        )
        .all(requestId),
    );
    if (rows.length === 0) return undefined;
    const events = rows.map((row) => {
      const decoded: unknown = JSON.parse(row.event_json);
      if (canonicalDigest(decoded) !== row.event_digest) {
        throw new Error(
          `Candidate Verification event digest mismatch: ${requestId}`,
        );
      }
      return eventSchema.parse(decoded);
    });
    const first = events[0];
    if (first?.kind !== "candidate-verification-request-received") {
      throw new Error(
        `Candidate Verification handoff is missing: ${requestId}`,
      );
    }
    const completed = events.find(
      (event) => event.kind === "candidate-verification-completed",
    );
    const scopeCompleted = events.find(
      (event) => event.kind === "programme-scope-assessed",
    );
    const scopeIncomplete = events.some(
      (event) => event.kind === "programme-scope-assessment-incomplete",
    );
    return candidateVerificationViewSchema.parse({
      request: first.request,
      receivedAt: first.receivedAt,
      verificationRecords:
        completed?.kind === "candidate-verification-completed"
          ? [completed.record]
          : [],
      verifiedVulnerability:
        completed?.kind === "candidate-verification-completed"
          ? completed.verifiedVulnerability
          : null,
      programmeScopeStatus:
        completed?.kind !== "candidate-verification-completed" ||
        completed.verifiedVulnerability === null
          ? "not-configured"
          : scopeCompleted?.kind === "programme-scope-assessed"
            ? "completed"
            : scopeIncomplete
              ? "incomplete"
              : this.#scopeEvaluator === undefined
                ? "not-configured"
                : "pending",
      scopeAssessments:
        scopeCompleted?.kind === "programme-scope-assessed"
          ? scopeCompleted.scopeAssessments
          : [],
      submissionCandidates:
        scopeCompleted?.kind === "programme-scope-assessed"
          ? scopeCompleted.submissionCandidates
          : [],
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

  #require(requestId: string): CandidateVerificationView {
    const view = this.#read(requestId);
    if (view === undefined) {
      throw new Error(`Candidate Verification Request not found: ${requestId}`);
    }
    return view;
  }

  #tryFindByVulnerability(
    vulnerabilityId: string,
  ):
    | { readonly requestId: string; readonly view: CandidateVerificationView }
    | undefined {
    const requestIds = z
      .array(z.string())
      .parse(
        this.#database
          .prepare(
            "SELECT DISTINCT request_id FROM candidate_verification_events",
          )
          .pluck()
          .all(),
      );
    for (const requestId of requestIds) {
      const view = this.#require(requestId);
      if (view.verifiedVulnerability?.vulnerabilityId === vulnerabilityId) {
        return { requestId, view };
      }
    }
    return undefined;
  }

  #findByVulnerability(vulnerabilityId: string): {
    readonly requestId: string;
    readonly view: CandidateVerificationView;
  } {
    const located = this.#tryFindByVulnerability(vulnerabilityId);
    if (located === undefined) {
      throw new Error(`Verified Vulnerability not found: ${vulnerabilityId}`);
    }
    return located;
  }
}

export function openHumanOs(options: OpenHumanOsOptions): HumanOs {
  return new SqliteHumanOs(options);
}
