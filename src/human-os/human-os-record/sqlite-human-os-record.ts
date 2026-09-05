import Database from "better-sqlite3";
import { z } from "zod";

import { humanOsDigest } from "../canonical-json.js";
import {
  humanVerificationEnvironmentDispositionSchema,
  humanVerificationEnvironmentRequestSchema,
  type HumanVerificationEnvironmentDisposition,
  type HumanVerificationEnvironmentRequest,
} from "../human-verification-environment-contracts.js";
import {
  humanReviewCaseSchema,
  humanVerificationResultSchema,
  type HumanReviewCase,
  type HumanReviewPacketDeliveryRequest,
  type HumanVerificationResult,
} from "../human-verification-contracts.js";
import { humanReviewPacketDeliveryRequestSchema } from "../../research/validation/human-review-packet.js";
import type {
  HumanOsRecord,
  HumanReviewAdmissionRecordView,
  HumanVerificationResultRecordView,
  HumanVerificationEnvironmentRecordView,
  OpenHumanOsRecordOptions,
  RecordEnvironmentDispositionResult,
  RecordHumanReviewAdmissionResult,
  RecordHumanVerificationResultResult,
} from "./contracts.js";

const digestSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);

interface StoredEnvironmentDispositionRow {
  readonly global_sequence: number;
  readonly kind: string;
  readonly schema_version: number;
  readonly request_digest: string;
  readonly occurred_at: string;
  readonly request_artifact_digest: string;
  readonly disposition_artifact_digest: string;
}

interface StoredHumanReviewAdmissionRow {
  readonly global_sequence: number;
  readonly delivery_request_digest: string;
  readonly packet_digest: string;
  readonly case_id: string;
  readonly campaign_id: string;
  readonly mechanism_digest: string;
  readonly queue_status: string;
  readonly occurred_at: string;
  readonly request_artifact_digest: string;
  readonly case_artifact_digest: string;
}

interface StoredHumanVerificationRow {
  readonly global_sequence: number;
  readonly case_id: string;
  readonly verification_id: string;
  readonly disposition: string;
  readonly occurred_at: string;
  readonly result_artifact_digest: string;
  readonly finding_artifact_digest: string | null;
  readonly evidence_request_artifact_digest: string | null;
}

function assertDispositionMatchesRequest(
  request: HumanVerificationEnvironmentRequest,
  disposition: HumanVerificationEnvironmentDisposition,
): void {
  if (
    disposition.requestDigest !== request.digest ||
    disposition.setupReceipt.setupPlanDigest !== request.setupPlan.digest
  ) {
    throw new Error(
      "Human Verification Environment Disposition binding mismatch",
    );
  }
  if (disposition.status === "ready") {
    const configuration = disposition.effectiveConfiguration;
    const identity = disposition.targetRuntimeIdentity;
    const environment = disposition.environment;
    if (
      disposition.gate.status !== "passed" ||
      disposition.gate.observedBackend !==
        request.runtimeProfile.isolation.backend ||
      disposition.gate.observedRuntimeName !==
        request.runtimeProfile.isolation.runtimeName ||
      disposition.gate.observedRuntimeVersion !==
        request.runtimeProfile.isolation.runtimeVersion ||
      disposition.setupReceipt.status !== "ready" ||
      configuration.runtimeProfileDigest !== request.runtimeProfile.digest ||
      configuration.policyDigest !== request.policy.digest ||
      identity.runtimeProfileDigest !== request.runtimeProfile.digest ||
      identity.targetSnapshot.digest !== request.target.snapshot.digest ||
      identity.manifest.digest !== request.target.manifest.digest ||
      identity.sourceArtifactDigest !== request.target.sourceArtifact.digest ||
      environment.targetSnapshotDigest !== request.target.snapshot.digest ||
      environment.runtimeProfileDigest !== request.runtimeProfile.digest
    ) {
      throw new Error("Ready Environment Disposition binding mismatch");
    }
    return;
  }
  if (disposition.setupReceipt.status !== "setup-blocked") {
    throw new Error("Setup Blocked Disposition receipt mismatch");
  }
}

class SqliteHumanOsRecord implements HumanOsRecord {
  readonly #database: Database.Database;
  readonly #artifactStore: OpenHumanOsRecordOptions["artifactStore"];
  readonly #clock: () => Date;

  constructor(options: OpenHumanOsRecordOptions) {
    this.#database = new Database(options.databasePath);
    this.#artifactStore = options.artifactStore;
    this.#clock = options.clock ?? (() => new Date());
    this.#database.pragma("journal_mode = WAL");
    this.#database.pragma("busy_timeout = 5000");
    this.#database.exec(`
      CREATE TABLE IF NOT EXISTS human_os_events (
        global_sequence INTEGER PRIMARY KEY AUTOINCREMENT,
        kind TEXT NOT NULL,
        schema_version INTEGER NOT NULL,
        request_digest TEXT NOT NULL UNIQUE,
        occurred_at TEXT NOT NULL,
        request_artifact_digest TEXT NOT NULL,
        disposition_artifact_digest TEXT NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS human_review_admissions (
        global_sequence INTEGER PRIMARY KEY AUTOINCREMENT,
        delivery_request_digest TEXT NOT NULL UNIQUE,
        packet_digest TEXT NOT NULL,
        case_id TEXT NOT NULL,
        campaign_id TEXT NOT NULL,
        mechanism_digest TEXT NOT NULL,
        queue_status TEXT NOT NULL,
        occurred_at TEXT NOT NULL,
        request_artifact_digest TEXT NOT NULL,
        case_artifact_digest TEXT NOT NULL
      ) STRICT;
      CREATE INDEX IF NOT EXISTS human_review_admissions_packet
        ON human_review_admissions (packet_digest, global_sequence);
      CREATE INDEX IF NOT EXISTS human_review_admissions_campaign
        ON human_review_admissions (campaign_id, global_sequence);
      CREATE TABLE IF NOT EXISTS human_verification_events (
        global_sequence INTEGER PRIMARY KEY AUTOINCREMENT,
        case_id TEXT NOT NULL,
        verification_id TEXT NOT NULL UNIQUE,
        disposition TEXT NOT NULL,
        occurred_at TEXT NOT NULL,
        result_artifact_digest TEXT NOT NULL,
        finding_artifact_digest TEXT,
        evidence_request_artifact_digest TEXT
      ) STRICT;
      CREATE INDEX IF NOT EXISTS human_verification_events_case
        ON human_verification_events (case_id, global_sequence);
    `);
  }

  async readEnvironmentDisposition(
    requestDigestValue: string,
  ): Promise<HumanVerificationEnvironmentRecordView | undefined> {
    const requestDigest = digestSchema.parse(requestDigestValue);
    const row = this.#database
      .prepare(
        `SELECT global_sequence, kind, schema_version, request_digest,
                occurred_at, request_artifact_digest,
                disposition_artifact_digest
           FROM human_os_events
          WHERE request_digest = ?`,
      )
      .get(requestDigest) as StoredEnvironmentDispositionRow | undefined;
    return row === undefined ? undefined : this.#decodeEnvironment(row);
  }

  async recordEnvironmentDisposition(
    requestValue: HumanVerificationEnvironmentRequest,
    dispositionValue: HumanVerificationEnvironmentDisposition,
  ): Promise<RecordEnvironmentDispositionResult> {
    const request =
      humanVerificationEnvironmentRequestSchema.parse(requestValue);
    const disposition =
      humanVerificationEnvironmentDispositionSchema.parse(dispositionValue);
    assertDispositionMatchesRequest(request, disposition);

    const requestArtifactDigest = await this.#artifactStore.putJson(request);
    const dispositionArtifactDigest =
      await this.#artifactStore.putJson(disposition);
    if (
      requestArtifactDigest !== humanOsDigest(request) ||
      dispositionArtifactDigest !== humanOsDigest(disposition)
    ) {
      throw new Error("Human OS Artifact Store returned a foreign digest");
    }

    const transact = this.#database.transaction(() => {
      const existing = this.#selectRow(request.digest);
      if (existing !== undefined)
        return { status: "occupied" as const, row: existing };
      const occurredAt = this.#clock().toISOString();
      this.#database
        .prepare(
          `INSERT INTO human_os_events (
             kind, schema_version, request_digest, occurred_at,
             request_artifact_digest, disposition_artifact_digest
           ) VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(
          "environment.disposition-recorded",
          1,
          request.digest,
          occurredAt,
          requestArtifactDigest,
          dispositionArtifactDigest,
        );
      const row = this.#selectRow(request.digest);
      if (row === undefined) throw new Error("Human OS event append failed");
      return { status: "appended" as const, row };
    });
    const result = transact();
    return {
      status: result.status,
      view: await this.#decodeEnvironment(result.row),
    };
  }

  async readHumanReviewAdmission(
    deliveryRequestDigestValue: string,
  ): Promise<HumanReviewAdmissionRecordView | undefined> {
    const deliveryRequestDigest = digestSchema.parse(
      deliveryRequestDigestValue,
    );
    const row = this.#selectAdmission(
      "delivery_request_digest = ?",
      deliveryRequestDigest,
    );
    return row === undefined ? undefined : this.#decodeAdmission(row);
  }

  async readHumanReviewCaseByPacket(
    packetDigestValue: string,
  ): Promise<HumanReviewAdmissionRecordView | undefined> {
    const packetDigest = digestSchema.parse(packetDigestValue);
    const row = this.#selectAdmission("packet_digest = ?", packetDigest);
    return row === undefined ? undefined : this.#decodeAdmission(row);
  }

  async readHumanReviewCase(
    caseIdValue: string,
  ): Promise<HumanReviewAdmissionRecordView | undefined> {
    const caseId = digestSchema.parse(caseIdValue);
    const row = this.#selectAdmission("case_id = ?", caseId);
    return row === undefined ? undefined : this.#decodeAdmission(row);
  }

  async listHumanReviewCases(
    campaignId: string,
  ): Promise<readonly HumanReviewAdmissionRecordView[]> {
    const rows = this.#database
      .prepare(
        `SELECT global_sequence, delivery_request_digest, packet_digest,
                case_id, campaign_id, mechanism_digest, queue_status,
                occurred_at, request_artifact_digest, case_artifact_digest
           FROM human_review_admissions AS admission
          WHERE campaign_id = ?
            AND global_sequence = (
              SELECT MIN(first_admission.global_sequence)
                FROM human_review_admissions AS first_admission
               WHERE first_admission.packet_digest = admission.packet_digest
            )
          ORDER BY global_sequence`,
      )
      .all(campaignId) as StoredHumanReviewAdmissionRow[];
    return Promise.all(rows.map((row) => this.#decodeAdmission(row)));
  }

  async recordHumanReviewAdmission(
    requestValue: HumanReviewPacketDeliveryRequest,
    reviewCaseValue: HumanReviewCase,
  ): Promise<RecordHumanReviewAdmissionResult> {
    const request = humanReviewPacketDeliveryRequestSchema.parse(requestValue);
    const reviewCase = humanReviewCaseSchema.parse(reviewCaseValue);
    const packetDigest = humanOsDigest(request.packet);
    if (
      reviewCase.campaignId !== request.campaignId ||
      reviewCase.packet.digest !== packetDigest ||
      reviewCase.firstDeliveryRequestDigest !== request.digest
    ) {
      throw new Error("Human Review admission binding mismatch");
    }

    const requestArtifactDigest = await this.#artifactStore.putJson(request);
    const proposedCaseArtifactDigest =
      await this.#artifactStore.putJson(reviewCase);
    if (
      requestArtifactDigest !== humanOsDigest(request) ||
      proposedCaseArtifactDigest !== humanOsDigest(reviewCase)
    ) {
      throw new Error("Human OS Artifact Store returned a foreign digest");
    }

    const transact = this.#database.transaction(() => {
      const existingAdmission = this.#selectAdmission(
        "delivery_request_digest = ?",
        request.digest,
      );
      if (existingAdmission !== undefined) {
        return { status: "occupied" as const, row: existingAdmission };
      }

      const existingCase = this.#selectAdmission(
        "packet_digest = ?",
        packetDigest,
      );
      let caseArtifactDigest = proposedCaseArtifactDigest;
      let persistedCase = reviewCase;
      if (existingCase !== undefined) {
        if (
          existingCase.case_id !== reviewCase.id ||
          existingCase.campaign_id !== request.campaignId ||
          existingCase.mechanism_digest !== reviewCase.mechanismDigest
        ) {
          throw new Error(
            "Human Review Packet is already bound to another Case",
          );
        }
        caseArtifactDigest = existingCase.case_artifact_digest;
        persistedCase = {
          ...reviewCase,
          queueStatus: humanReviewCaseSchema.shape.queueStatus.parse(
            existingCase.queue_status,
          ),
          admittedAt: existingCase.occurred_at,
          firstDeliveryRequestDigest: existingCase.delivery_request_digest,
        };
      } else {
        const rows = this.#database
          .prepare(
            `SELECT DISTINCT mechanism_digest
               FROM human_review_admissions
              WHERE campaign_id = ? AND queue_status = 'active'`,
          )
          .all(request.campaignId) as { readonly mechanism_digest: string }[];
        const activeMechanisms = new Set(
          rows.map((row) => row.mechanism_digest),
        );
        const expectedQueueStatus =
          activeMechanisms.has(reviewCase.mechanismDigest) ||
          activeMechanisms.size < 3
            ? "active"
            : "human-deferred";
        if (reviewCase.queueStatus !== expectedQueueStatus) {
          throw new Error("Human Review admission queue policy conflict");
        }
      }

      const occurredAt = this.#clock().toISOString();
      this.#database
        .prepare(
          `INSERT INTO human_review_admissions (
             delivery_request_digest, packet_digest, case_id, campaign_id,
             mechanism_digest, queue_status, occurred_at,
             request_artifact_digest, case_artifact_digest
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          request.digest,
          packetDigest,
          persistedCase.id,
          request.campaignId,
          persistedCase.mechanismDigest,
          persistedCase.queueStatus,
          occurredAt,
          requestArtifactDigest,
          caseArtifactDigest,
        );
      const row = this.#selectAdmission(
        "delivery_request_digest = ?",
        request.digest,
      );
      if (row === undefined)
        throw new Error("Human Review admission append failed");
      return { status: "appended" as const, row };
    });
    const result = transact();
    return {
      status: result.status,
      view: await this.#decodeAdmission(result.row),
    };
  }

  async listHumanVerificationResults(
    caseIdValue: string,
  ): Promise<readonly HumanVerificationResultRecordView[]> {
    const caseId = digestSchema.parse(caseIdValue);
    const rows = this.#database
      .prepare(
        `SELECT global_sequence, case_id, verification_id, disposition,
                occurred_at, result_artifact_digest, finding_artifact_digest,
                evidence_request_artifact_digest
           FROM human_verification_events
          WHERE case_id = ?
          ORDER BY global_sequence`,
      )
      .all(caseId) as StoredHumanVerificationRow[];
    return Promise.all(rows.map((row) => this.#decodeVerification(row)));
  }

  async recordHumanVerificationResult(
    reviewCaseValue: HumanReviewCase,
    resultValue: HumanVerificationResult,
  ): Promise<RecordHumanVerificationResultResult> {
    const reviewCase = humanReviewCaseSchema.parse(reviewCaseValue);
    const result = humanVerificationResultSchema.parse(resultValue);
    if (
      result.verification.caseId !== reviewCase.id ||
      result.verification.packetDigest !== reviewCase.packet.digest
    ) {
      throw new Error("Human Verification result binding mismatch");
    }
    const resultArtifactDigest = await this.#artifactStore.putJson(result);
    const findingArtifactDigest =
      result.finding === null
        ? null
        : await this.#artifactStore.putJson(result.finding);
    const evidenceRequestArtifactDigest =
      result.evidenceRequest === null
        ? null
        : await this.#artifactStore.putJson(result.evidenceRequest);
    if (
      resultArtifactDigest !== humanOsDigest(result) ||
      (result.finding !== null &&
        findingArtifactDigest !== humanOsDigest(result.finding)) ||
      (result.evidenceRequest !== null &&
        evidenceRequestArtifactDigest !== humanOsDigest(result.evidenceRequest))
    ) {
      throw new Error("Human OS Artifact Store returned a foreign digest");
    }

    const transact = this.#database.transaction(() => {
      const existing = this.#selectVerification(result.verification.id);
      if (existing !== undefined) {
        return { status: "occupied" as const, row: existing };
      }
      const recordedCase = this.#selectAdmission("case_id = ?", reviewCase.id);
      if (recordedCase === undefined) {
        throw new Error("Human Verification requires an admitted Case");
      }
      const terminal = this.#database
        .prepare(
          `SELECT verification_id
             FROM human_verification_events
            WHERE case_id = ?
              AND disposition IN ('verified-finding', 'rejected')
            LIMIT 1`,
        )
        .get(reviewCase.id) as { readonly verification_id: string } | undefined;
      if (terminal !== undefined) {
        throw new Error("Human Review Case already has a terminal Disposition");
      }
      const occurredAt = this.#clock().toISOString();
      this.#database
        .prepare(
          `INSERT INTO human_verification_events (
             case_id, verification_id, disposition, occurred_at,
             result_artifact_digest, finding_artifact_digest,
             evidence_request_artifact_digest
           ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          reviewCase.id,
          result.verification.id,
          result.verification.disposition.status,
          occurredAt,
          resultArtifactDigest,
          findingArtifactDigest,
          evidenceRequestArtifactDigest,
        );
      const row = this.#selectVerification(result.verification.id);
      if (row === undefined)
        throw new Error("Human Verification append failed");
      return { status: "appended" as const, row };
    });
    const recorded = transact();
    return {
      status: recorded.status,
      view: await this.#decodeVerification(recorded.row),
    };
  }

  #selectAdmission(
    predicate:
      "delivery_request_digest = ?" | "packet_digest = ?" | "case_id = ?",
    value: string,
  ): StoredHumanReviewAdmissionRow | undefined {
    return this.#database
      .prepare(
        `SELECT global_sequence, delivery_request_digest, packet_digest,
                case_id, campaign_id, mechanism_digest, queue_status,
                occurred_at, request_artifact_digest, case_artifact_digest
           FROM human_review_admissions
          WHERE ${predicate}
          ORDER BY global_sequence
          LIMIT 1`,
      )
      .get(value) as StoredHumanReviewAdmissionRow | undefined;
  }

  #selectVerification(
    verificationId: string,
  ): StoredHumanVerificationRow | undefined {
    return this.#database
      .prepare(
        `SELECT global_sequence, case_id, verification_id, disposition,
                occurred_at, result_artifact_digest, finding_artifact_digest,
                evidence_request_artifact_digest
           FROM human_verification_events
          WHERE verification_id = ?`,
      )
      .get(verificationId) as StoredHumanVerificationRow | undefined;
  }

  async #decodeAdmission(
    row: StoredHumanReviewAdmissionRow,
  ): Promise<HumanReviewAdmissionRecordView> {
    const requestValue = await this.#artifactStore.readJson(
      row.request_artifact_digest,
    );
    const caseValue = await this.#artifactStore.readJson(
      row.case_artifact_digest,
    );
    const request = humanReviewPacketDeliveryRequestSchema.parse(requestValue);
    const reviewCase = humanReviewCaseSchema.parse(caseValue);
    if (
      humanOsDigest(request) !== row.request_artifact_digest ||
      humanOsDigest(reviewCase) !== row.case_artifact_digest ||
      request.digest !== row.delivery_request_digest ||
      humanOsDigest(request.packet) !== row.packet_digest ||
      reviewCase.id !== row.case_id ||
      reviewCase.campaignId !== row.campaign_id ||
      reviewCase.mechanismDigest !== row.mechanism_digest ||
      reviewCase.queueStatus !== row.queue_status ||
      reviewCase.packet.digest !== row.packet_digest
    ) {
      throw new Error("Human Review admission artifact integrity mismatch");
    }
    return {
      ledgerHead: row.global_sequence,
      occurredAt: row.occurred_at,
      requestArtifactDigest: row.request_artifact_digest,
      caseArtifactDigest: row.case_artifact_digest,
      request,
      reviewCase,
    };
  }

  async #decodeVerification(
    row: StoredHumanVerificationRow,
  ): Promise<HumanVerificationResultRecordView> {
    const resultValue = await this.#artifactStore.readJson(
      row.result_artifact_digest,
    );
    const result = humanVerificationResultSchema.parse(resultValue);
    if (
      humanOsDigest(result) !== row.result_artifact_digest ||
      result.verification.id !== row.verification_id ||
      result.verification.caseId !== row.case_id ||
      result.verification.disposition.status !== row.disposition
    ) {
      throw new Error("Human Verification artifact integrity mismatch");
    }
    if (row.finding_artifact_digest !== null) {
      const findingValue = await this.#artifactStore.readJson(
        row.finding_artifact_digest,
      );
      if (
        result.finding === null ||
        humanOsDigest(findingValue) !== row.finding_artifact_digest ||
        humanOsDigest(result.finding) !== row.finding_artifact_digest
      ) {
        throw new Error("Finding artifact integrity mismatch");
      }
    } else if (result.finding !== null) {
      throw new Error("Finding event reference is missing");
    }
    if (row.evidence_request_artifact_digest !== null) {
      const evidenceRequestValue = await this.#artifactStore.readJson(
        row.evidence_request_artifact_digest,
      );
      if (
        result.evidenceRequest === null ||
        humanOsDigest(evidenceRequestValue) !==
          row.evidence_request_artifact_digest ||
        humanOsDigest(result.evidenceRequest) !==
          row.evidence_request_artifact_digest
      ) {
        throw new Error("Evidence Request artifact integrity mismatch");
      }
    } else if (result.evidenceRequest !== null) {
      throw new Error("Evidence Request event reference is missing");
    }
    return {
      ledgerHead: row.global_sequence,
      occurredAt: row.occurred_at,
      resultArtifactDigest: row.result_artifact_digest,
      result,
    };
  }

  #selectRow(
    requestDigest: string,
  ): StoredEnvironmentDispositionRow | undefined {
    return this.#database
      .prepare(
        `SELECT global_sequence, kind, schema_version, request_digest,
                occurred_at, request_artifact_digest,
                disposition_artifact_digest
           FROM human_os_events
          WHERE request_digest = ?`,
      )
      .get(requestDigest) as StoredEnvironmentDispositionRow | undefined;
  }

  async #decodeEnvironment(
    row: StoredEnvironmentDispositionRow,
  ): Promise<HumanVerificationEnvironmentRecordView> {
    if (
      row.kind !== "environment.disposition-recorded" ||
      row.schema_version !== 1
    ) {
      throw new Error("Unsupported Human OS event schema");
    }
    const requestValue = await this.#artifactStore.readJson(
      row.request_artifact_digest,
    );
    const dispositionValue = await this.#artifactStore.readJson(
      row.disposition_artifact_digest,
    );
    const request =
      humanVerificationEnvironmentRequestSchema.parse(requestValue);
    const disposition =
      humanVerificationEnvironmentDispositionSchema.parse(dispositionValue);
    if (
      humanOsDigest(request) !== row.request_artifact_digest ||
      humanOsDigest(disposition) !== row.disposition_artifact_digest ||
      request.digest !== row.request_digest
    ) {
      throw new Error("Human OS event artifact integrity mismatch");
    }
    assertDispositionMatchesRequest(request, disposition);
    return {
      ledgerHead: row.global_sequence,
      occurredAt: row.occurred_at,
      requestArtifactDigest: row.request_artifact_digest,
      dispositionArtifactDigest: row.disposition_artifact_digest,
      request,
      disposition,
    };
  }
}

export function openSqliteHumanOsRecord(
  options: OpenHumanOsRecordOptions,
): HumanOsRecord {
  return new SqliteHumanOsRecord(options);
}
