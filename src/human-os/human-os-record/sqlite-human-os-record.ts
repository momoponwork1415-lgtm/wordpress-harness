import Database from "better-sqlite3";
import { z } from "zod";

import { humanOsDigest } from "../canonical-json.js";
import {
  aiVerificationRecordSchema,
  aiReproductionAttemptSchema,
  aiReproductionIntakeSchema,
  aiReproductionResultSchema,
  triageReproductionPacketSchema,
  findingAIReproductionAttemptSchema,
  referenceFindingAIReproductionAttempt,
  type AIVerificationRecord,
  type AIReproductionAttempt,
  type AIReproductionIntake,
  type AIReproductionResult,
  type FindingAIReproductionAttempt,
} from "../ai-reproduction-contracts.js";
import {
  currentHumanReviewCaseSchema,
  currentHumanReviewResultSchema,
  currentHumanReviewScheduleEventSchema,
  humanReproductionPreparationSchema,
  type CurrentHumanReviewCase,
  type CurrentHumanReviewResult,
  type CurrentHumanReviewScheduleEvent,
  type HumanReproductionPreparation,
} from "../current-human-review-contracts.js";
import {
  humanVerificationEnvironmentDispositionSchema,
  verificationEnvironmentRequestSchema,
  type HumanVerificationEnvironmentDisposition,
  type VerificationEnvironmentRequest,
} from "../human-verification-environment-contracts.js";
import {
  humanReviewCaseSchema,
  humanVerificationResultSchema,
  type HumanReviewCase,
  type HumanReviewPacketDeliveryRequest,
  type HumanVerificationResult,
} from "../human-verification-contracts.js";
import { humanReviewPacketDeliveryRequestSchema } from "../../research/validation/human-review-packet.js";
import {
  findingSchema as researchFindingSchema,
  referenceFinding,
  type Finding as ResearchFinding,
} from "../../research/validation/finding.js";
import {
  runtimeVerificationPacketDeliveryRequestSchema,
  type RuntimeVerificationPacketDeliveryRequest,
} from "../../research/validation/runtime-verification-packet.js";
import type {
  AIReproductionIntakeRecordView,
  AIReproductionResultRecordView,
  CurrentHumanReviewCaseRecordView,
  CurrentHumanReviewResultRecordView,
  CurrentHumanReviewScheduleRecordView,
  ClaimFindingAIReproductionResult,
  FindingAIReproductionClaim,
  FindingAIReproductionRecordView,
  HumanOsRecord,
  HumanReviewAdmissionRecordView,
  HumanReproductionPreparationRecordView,
  HumanVerificationResultRecordView,
  HumanVerificationEnvironmentRecordView,
  OpenHumanOsRecordOptions,
  RecordEnvironmentDispositionResult,
  RecordAIReproductionIntakeResult,
  RecordAIReproductionResultResult,
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

interface StoredAIReproductionIntakeRow {
  readonly global_sequence: number;
  readonly delivery_request_digest: string;
  readonly packet_digest: string;
  readonly intake_id: string;
  readonly campaign_id: string;
  readonly run_id: string;
  readonly occurred_at: string;
  readonly request_artifact_digest: string;
  readonly intake_artifact_digest: string;
}

interface StoredAIReproductionResultRow {
  readonly global_sequence: number;
  readonly intake_id: string;
  readonly attempt_id: string;
  readonly status: string;
  readonly occurred_at: string;
  readonly attempt_artifact_digest: string;
  readonly result_artifact_digest: string;
  readonly triage_packet_artifact_digest: string | null;
}

interface StoredFindingAIReproductionRow {
  readonly global_sequence: number;
  readonly finding_id: string;
  readonly finding_digest: string;
  readonly attempt_id: string;
  readonly outcome: string;
  readonly occurred_at: string;
  readonly finding_artifact_digest: string;
  readonly attempt_artifact_digest: string;
  readonly record_artifact_digest: string;
}

interface StoredFindingAIReproductionClaimRow {
  readonly attempt_id: string;
  readonly claim_id: string;
  readonly started_at: string;
  readonly finding_id: string;
  readonly finding_digest: string;
  readonly finding_artifact_digest: string;
  readonly attempt_artifact_digest: string;
}

interface StoredCurrentHumanReviewEventRow {
  readonly global_sequence: number;
  readonly event_id: string;
  readonly kind: string;
  readonly case_id: string;
  readonly campaign_id: string;
  readonly attempt_id: string;
  readonly status: string;
  readonly occurred_at: string;
  readonly artifact_digest: string;
}

function assertDispositionMatchesRequest(
  request: VerificationEnvironmentRequest,
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
      CREATE TABLE IF NOT EXISTS ai_reproduction_intakes (
        global_sequence INTEGER PRIMARY KEY AUTOINCREMENT,
        delivery_request_digest TEXT NOT NULL UNIQUE,
        packet_digest TEXT NOT NULL,
        intake_id TEXT NOT NULL,
        campaign_id TEXT NOT NULL,
        run_id TEXT NOT NULL,
        occurred_at TEXT NOT NULL,
        request_artifact_digest TEXT NOT NULL,
        intake_artifact_digest TEXT NOT NULL
      ) STRICT;
      CREATE INDEX IF NOT EXISTS ai_reproduction_intakes_packet
        ON ai_reproduction_intakes (packet_digest, global_sequence);
      CREATE TABLE IF NOT EXISTS ai_reproduction_events (
        global_sequence INTEGER PRIMARY KEY AUTOINCREMENT,
        intake_id TEXT NOT NULL,
        attempt_id TEXT NOT NULL UNIQUE,
        status TEXT NOT NULL,
        occurred_at TEXT NOT NULL,
        attempt_artifact_digest TEXT NOT NULL,
        result_artifact_digest TEXT NOT NULL,
        triage_packet_artifact_digest TEXT
      ) STRICT;
      CREATE INDEX IF NOT EXISTS ai_reproduction_events_intake
        ON ai_reproduction_events (intake_id, global_sequence);
      CREATE TABLE IF NOT EXISTS finding_ai_reproduction_events (
        global_sequence INTEGER PRIMARY KEY AUTOINCREMENT,
        finding_id TEXT NOT NULL,
        finding_digest TEXT NOT NULL,
        attempt_id TEXT NOT NULL UNIQUE,
        outcome TEXT NOT NULL,
        occurred_at TEXT NOT NULL,
        finding_artifact_digest TEXT NOT NULL,
        attempt_artifact_digest TEXT NOT NULL,
        record_artifact_digest TEXT NOT NULL
      ) STRICT;
      CREATE INDEX IF NOT EXISTS finding_ai_reproduction_finding
        ON finding_ai_reproduction_events (finding_id, global_sequence);
      CREATE TABLE IF NOT EXISTS finding_ai_reproduction_claims (
        attempt_id TEXT PRIMARY KEY,
        claim_id TEXT NOT NULL UNIQUE,
        started_at TEXT NOT NULL,
        finding_id TEXT NOT NULL,
        finding_digest TEXT NOT NULL,
        finding_artifact_digest TEXT NOT NULL,
        attempt_artifact_digest TEXT NOT NULL
      ) STRICT;
      CREATE INDEX IF NOT EXISTS finding_ai_reproduction_claims_finding
        ON finding_ai_reproduction_claims (finding_id, started_at);
      CREATE TABLE IF NOT EXISTS human_review_v2_events (
        global_sequence INTEGER PRIMARY KEY AUTOINCREMENT,
        event_id TEXT NOT NULL UNIQUE,
        kind TEXT NOT NULL,
        case_id TEXT NOT NULL,
        campaign_id TEXT NOT NULL,
        attempt_id TEXT NOT NULL,
        status TEXT NOT NULL,
        occurred_at TEXT NOT NULL,
        artifact_digest TEXT NOT NULL
      ) STRICT;
      CREATE INDEX IF NOT EXISTS human_review_v2_case
        ON human_review_v2_events (case_id, global_sequence);
      CREATE INDEX IF NOT EXISTS human_review_v2_campaign
        ON human_review_v2_events (campaign_id, global_sequence);
    `);
  }

  async readAIReproductionIntake(
    deliveryRequestDigestValue: string,
  ): Promise<AIReproductionIntakeRecordView | undefined> {
    const deliveryRequestDigest = digestSchema.parse(
      deliveryRequestDigestValue,
    );
    const row = this.#selectAIIntake(
      "delivery_request_digest = ?",
      deliveryRequestDigest,
    );
    return row === undefined ? undefined : this.#decodeAIIntake(row);
  }

  async readAIReproductionIntakeById(
    intakeIdValue: string,
  ): Promise<AIReproductionIntakeRecordView | undefined> {
    const intakeId = digestSchema.parse(intakeIdValue);
    const row = this.#selectAIIntake("intake_id = ?", intakeId);
    return row === undefined ? undefined : this.#decodeAIIntake(row);
  }

  async recordAIReproductionIntake(
    requestValue: RuntimeVerificationPacketDeliveryRequest,
    intakeValue: AIReproductionIntake,
  ): Promise<RecordAIReproductionIntakeResult> {
    const request =
      runtimeVerificationPacketDeliveryRequestSchema.parse(requestValue);
    const intake = aiReproductionIntakeSchema.parse(intakeValue);
    const packetDigest = humanOsDigest(request.packet);
    if (
      intake.deliveryRequestDigest !== request.digest ||
      intake.packet.digest !== packetDigest ||
      intake.campaignId !== request.campaignId ||
      intake.runId !== request.runId
    ) {
      throw new Error("AI Reproduction Intake binding mismatch");
    }

    const requestArtifactDigest = await this.#artifactStore.putJson(request);
    const intakeArtifactDigest = await this.#artifactStore.putJson(intake);
    if (
      requestArtifactDigest !== humanOsDigest(request) ||
      intakeArtifactDigest !== humanOsDigest(intake)
    ) {
      throw new Error("Human OS Artifact Store returned a foreign digest");
    }

    const transact = this.#database.transaction(() => {
      const existing = this.#selectAIIntake(
        "delivery_request_digest = ?",
        request.digest,
      );
      if (existing !== undefined)
        return { status: "occupied" as const, row: existing };
      const occurredAt = this.#clock().toISOString();
      this.#database
        .prepare(
          `INSERT INTO ai_reproduction_intakes (
             delivery_request_digest, packet_digest, intake_id, campaign_id,
             run_id, occurred_at, request_artifact_digest,
             intake_artifact_digest
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          request.digest,
          packetDigest,
          intake.id,
          request.campaignId,
          request.runId,
          occurredAt,
          requestArtifactDigest,
          intakeArtifactDigest,
        );
      const row = this.#selectAIIntake(
        "delivery_request_digest = ?",
        request.digest,
      );
      if (row === undefined)
        throw new Error("AI Reproduction Intake append failed");
      return { status: "appended" as const, row };
    });
    const recorded = transact();
    return {
      status: recorded.status,
      view: await this.#decodeAIIntake(recorded.row),
    };
  }

  async readAIReproductionResult(
    attemptIdValue: string,
  ): Promise<AIReproductionResultRecordView | undefined> {
    const attemptId = digestSchema.parse(attemptIdValue);
    const row = this.#selectAIResult(attemptId);
    return row === undefined ? undefined : this.#decodeAIResult(row);
  }

  async recordAIReproductionResult(
    intakeValue: AIReproductionIntake,
    attemptValue: AIReproductionAttempt,
    resultValue: AIReproductionResult,
  ): Promise<RecordAIReproductionResultResult> {
    const intake = aiReproductionIntakeSchema.parse(intakeValue);
    const attempt = aiReproductionAttemptSchema.parse(attemptValue);
    const result = aiReproductionResultSchema.parse(resultValue);
    if (
      attempt.intakeId !== intake.id ||
      attempt.packet.digest !== intake.packet.digest ||
      result.attempt.id !== attempt.id ||
      result.attempt.digest !== humanOsDigest(attempt) ||
      result.runtimePacket.digest !== intake.packet.digest
    ) {
      throw new Error("AI Reproduction Result binding mismatch");
    }

    const attemptArtifactDigest = await this.#artifactStore.putJson(attempt);
    const resultArtifactDigest = await this.#artifactStore.putJson(result);
    const triagePacketArtifactDigest =
      result.triagePacket === null
        ? null
        : await this.#artifactStore.putJson(result.triagePacket);
    if (
      attemptArtifactDigest !== humanOsDigest(attempt) ||
      resultArtifactDigest !== humanOsDigest(result) ||
      (result.triagePacket !== null &&
        triagePacketArtifactDigest !== humanOsDigest(result.triagePacket))
    ) {
      throw new Error("Human OS Artifact Store returned a foreign digest");
    }

    const transact = this.#database.transaction(() => {
      const existing = this.#selectAIResult(attempt.id);
      if (existing !== undefined)
        return { status: "occupied" as const, row: existing };
      const recordedIntake = this.#selectAIIntake("intake_id = ?", intake.id);
      if (
        recordedIntake === undefined ||
        recordedIntake.packet_digest !== intake.packet.digest
      ) {
        throw new Error(
          "AI Reproduction Result requires a matching persisted Intake",
        );
      }
      const occurredAt = this.#clock().toISOString();
      this.#database
        .prepare(
          `INSERT INTO ai_reproduction_events (
             intake_id, attempt_id, status, occurred_at,
             attempt_artifact_digest, result_artifact_digest,
             triage_packet_artifact_digest
           ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          intake.id,
          attempt.id,
          result.status,
          occurredAt,
          attemptArtifactDigest,
          resultArtifactDigest,
          triagePacketArtifactDigest,
        );
      const row = this.#selectAIResult(attempt.id);
      if (row === undefined)
        throw new Error("AI Reproduction Result append failed");
      return { status: "appended" as const, row };
    });
    const recorded = transact();
    return {
      status: recorded.status,
      view: await this.#decodeAIResult(recorded.row),
    };
  }

  async readFindingAIReproductionByAttempt(
    attemptIdValue: string,
  ): Promise<FindingAIReproductionRecordView | undefined> {
    const attemptId = digestSchema.parse(attemptIdValue);
    const row = this.#selectFindingAIReproduction("attempt_id = ?", attemptId);
    return row === undefined
      ? undefined
      : this.#decodeFindingAIReproduction(row);
  }

  async claimFindingAIReproduction(
    findingValue: ResearchFinding,
    attemptValue: FindingAIReproductionAttempt,
    claimIdValue: string,
  ): Promise<ClaimFindingAIReproductionResult> {
    const finding = researchFindingSchema.parse(findingValue);
    const attempt = findingAIReproductionAttemptSchema.parse(attemptValue);
    const claimId = digestSchema.parse(claimIdValue);
    const findingRef = referenceFinding(finding);
    if (
      attempt.finding.id !== finding.id ||
      attempt.finding.digest !== findingRef.digest ||
      humanOsDigest(attempt.target.snapshot) !==
        humanOsDigest(finding.target) ||
      humanOsDigest(attempt.target.manifest) !== humanOsDigest(finding.manifest)
    ) {
      throw new Error("AI Reproduction Claim belongs to another Finding");
    }
    const [findingArtifactDigest, attemptArtifactDigest] = await Promise.all([
      this.#artifactStore.putJson(finding),
      this.#artifactStore.putJson(attempt),
    ]);
    if (
      findingArtifactDigest !== findingRef.digest ||
      attemptArtifactDigest !== humanOsDigest(attempt)
    ) {
      throw new Error("Human OS Artifact Store returned a foreign digest");
    }
    const transact = this.#database.transaction(() => {
      const completed = this.#selectFindingAIReproduction(
        "attempt_id = ?",
        attempt.id,
      );
      if (completed !== undefined) {
        if (
          completed.finding_artifact_digest !== findingArtifactDigest ||
          completed.attempt_artifact_digest !== attemptArtifactDigest
        ) {
          throw new Error("Finding AI Reproduction Attempt conflict");
        }
        return { status: "completed" as const, row: completed };
      }
      const existing = this.#selectFindingAIReproductionClaim(
        "attempt_id = ?",
        attempt.id,
      );
      if (existing !== undefined) {
        if (
          existing.finding_id !== finding.id ||
          existing.finding_digest !== findingRef.digest ||
          existing.finding_artifact_digest !== findingArtifactDigest ||
          existing.attempt_artifact_digest !== attemptArtifactDigest
        ) {
          throw new Error("Finding AI Reproduction Claim conflict");
        }
        return { status: "in-progress" as const, row: existing };
      }
      const prior = this.#selectFindingAIReproduction(
        "finding_id = ?",
        finding.id,
      );
      if (
        prior !== undefined &&
        prior.finding_digest !== findingArtifactDigest
      ) {
        throw new Error("AI Reproduction cannot overwrite its Finding");
      }
      const priorClaim = this.#selectFindingAIReproductionClaim(
        "finding_id = ?",
        finding.id,
      );
      if (
        priorClaim !== undefined &&
        (priorClaim.finding_digest !== findingArtifactDigest ||
          priorClaim.finding_artifact_digest !== findingArtifactDigest)
      ) {
        throw new Error("AI Reproduction cannot rebind its Finding Claim");
      }
      const startedAt = this.#clock().toISOString();
      this.#database
        .prepare(
          `INSERT INTO finding_ai_reproduction_claims (
             attempt_id, claim_id, started_at, finding_id,
             finding_digest, finding_artifact_digest, attempt_artifact_digest
           ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          attempt.id,
          claimId,
          startedAt,
          finding.id,
          findingRef.digest,
          findingArtifactDigest,
          attemptArtifactDigest,
        );
      const row = this.#selectFindingAIReproductionClaim(
        "attempt_id = ?",
        attempt.id,
      );
      if (row === undefined) {
        throw new Error("Finding AI Reproduction Claim append failed");
      }
      return { status: "claimed" as const, row };
    });
    const result = transact();
    if (result.status === "completed") {
      return {
        status: "completed",
        view: await this.#decodeFindingAIReproduction(result.row),
      };
    }
    return {
      status: result.status,
      claim: this.#projectFindingAIReproductionClaim(result.row),
    };
  }

  async listFindingAIReproduction(
    findingIdValue: string,
  ): Promise<readonly FindingAIReproductionRecordView[]> {
    const findingId = digestSchema.parse(findingIdValue);
    const rows = this.#database
      .prepare(
        `SELECT global_sequence, finding_id, finding_digest, attempt_id,
                outcome, occurred_at, finding_artifact_digest,
                attempt_artifact_digest, record_artifact_digest
           FROM finding_ai_reproduction_events
          WHERE finding_id = ?
          ORDER BY global_sequence`,
      )
      .all(findingId) as StoredFindingAIReproductionRow[];
    return Promise.all(
      rows.map((row) => this.#decodeFindingAIReproduction(row)),
    );
  }

  async recordFindingAIReproduction(
    claimValue: FindingAIReproductionClaim,
    findingValue: ResearchFinding,
    attemptValue: FindingAIReproductionAttempt,
    recordValue: AIVerificationRecord,
  ): Promise<{
    readonly status: "appended" | "occupied";
    readonly view: FindingAIReproductionRecordView;
  }> {
    const claim = {
      attemptId: digestSchema.parse(claimValue.attemptId),
      claimId: digestSchema.parse(claimValue.claimId),
      startedAt: z.string().datetime().parse(claimValue.startedAt),
    };
    const finding = researchFindingSchema.parse(findingValue);
    const attempt = findingAIReproductionAttemptSchema.parse(attemptValue);
    const record = aiVerificationRecordSchema.parse(recordValue);
    const findingRef = referenceFinding(finding);
    if (
      attempt.finding.id !== finding.id ||
      attempt.finding.digest !== findingRef.digest ||
      humanOsDigest(attempt.target.snapshot) !==
        humanOsDigest(finding.target) ||
      humanOsDigest(attempt.target.manifest) !==
        humanOsDigest(finding.manifest) ||
      record.finding.id !== finding.id ||
      record.finding.digest !== findingRef.digest ||
      humanOsDigest(record.attempt) !==
        humanOsDigest(referenceFindingAIReproductionAttempt(attempt))
    ) {
      throw new Error("AI Verification Record belongs to another Finding");
    }
    const [findingArtifactDigest, attemptArtifactDigest, recordArtifactDigest] =
      await Promise.all([
        this.#artifactStore.putJson(finding),
        this.#artifactStore.putJson(attempt),
        this.#artifactStore.putJson(record),
      ]);
    if (
      findingArtifactDigest !== findingRef.digest ||
      attemptArtifactDigest !== humanOsDigest(attempt) ||
      recordArtifactDigest !== humanOsDigest(record)
    ) {
      throw new Error("Human OS Artifact Store returned a foreign digest");
    }
    const transact = this.#database.transaction(() => {
      const existing = this.#selectFindingAIReproduction(
        "attempt_id = ?",
        attempt.id,
      );
      if (existing !== undefined) {
        if (
          existing.finding_artifact_digest !== findingArtifactDigest ||
          existing.attempt_artifact_digest !== attemptArtifactDigest ||
          existing.record_artifact_digest !== recordArtifactDigest
        ) {
          throw new Error("Finding AI Reproduction Attempt conflict");
        }
        return { status: "occupied" as const, row: existing };
      }
      const reserved = this.#selectFindingAIReproductionClaim(
        "attempt_id = ?",
        attempt.id,
      );
      if (
        reserved === undefined ||
        reserved.attempt_id !== claim.attemptId ||
        reserved.claim_id !== claim.claimId ||
        reserved.started_at !== claim.startedAt ||
        reserved.finding_id !== finding.id ||
        reserved.finding_digest !== findingArtifactDigest ||
        reserved.finding_artifact_digest !== findingArtifactDigest ||
        reserved.attempt_artifact_digest !== attemptArtifactDigest
      ) {
        throw new Error("Finding AI Reproduction Claim is not owned");
      }
      const prior = this.#selectFindingAIReproduction(
        "finding_id = ?",
        finding.id,
      );
      if (
        prior !== undefined &&
        prior.finding_digest !== findingArtifactDigest
      ) {
        throw new Error("AI Reproduction cannot overwrite its Finding");
      }
      const occurredAt = this.#clock().toISOString();
      this.#database
        .prepare(
          `INSERT INTO finding_ai_reproduction_events (
             finding_id, finding_digest, attempt_id, outcome, occurred_at,
             finding_artifact_digest, attempt_artifact_digest,
             record_artifact_digest
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          finding.id,
          findingArtifactDigest,
          attempt.id,
          record.outcome.status,
          occurredAt,
          findingArtifactDigest,
          attemptArtifactDigest,
          recordArtifactDigest,
        );
      const row = this.#selectFindingAIReproduction(
        "attempt_id = ?",
        attempt.id,
      );
      if (row === undefined) {
        throw new Error("Finding AI Reproduction append failed");
      }
      return { status: "appended" as const, row };
    });
    const recorded = transact();
    return {
      status: recorded.status,
      view: await this.#decodeFindingAIReproduction(recorded.row),
    };
  }

  async readCurrentHumanReviewCase(
    caseIdValue: string,
  ): Promise<CurrentHumanReviewCaseRecordView | undefined> {
    const caseId = digestSchema.parse(caseIdValue);
    const row = this.#selectCurrentHumanReviewEvent(
      "case_id = ? AND kind = 'case-admitted'",
      caseId,
    );
    return row === undefined ? undefined : this.#decodeCurrentCase(row);
  }

  async readCurrentHumanReviewCaseByAttempt(
    attemptIdValue: string,
  ): Promise<CurrentHumanReviewCaseRecordView | undefined> {
    const attemptId = digestSchema.parse(attemptIdValue);
    const row = this.#selectCurrentHumanReviewEvent(
      "attempt_id = ? AND kind = 'case-admitted'",
      attemptId,
    );
    return row === undefined ? undefined : this.#decodeCurrentCase(row);
  }

  async listCurrentHumanReviewCases(
    campaignId: string,
  ): Promise<readonly CurrentHumanReviewCaseRecordView[]> {
    const rows = this.#database
      .prepare(
        `SELECT global_sequence, event_id, kind, case_id, campaign_id,
                attempt_id, status, occurred_at, artifact_digest
           FROM human_review_v2_events
          WHERE campaign_id = ? AND kind = 'case-admitted'
          ORDER BY global_sequence`,
      )
      .all(campaignId) as StoredCurrentHumanReviewEventRow[];
    return Promise.all(rows.map((row) => this.#decodeCurrentCase(row)));
  }

  async recordCurrentHumanReviewCase(
    reviewCaseValue: CurrentHumanReviewCase,
  ): Promise<{
    readonly status: "appended" | "occupied";
    readonly view: CurrentHumanReviewCaseRecordView;
  }> {
    const reviewCase = currentHumanReviewCaseSchema.parse(reviewCaseValue);
    const existing = this.#selectCurrentHumanReviewEvent(
      "attempt_id = ? AND kind = 'case-admitted'",
      reviewCase.originAttempt.id,
    );
    if (existing !== undefined) {
      const view = await this.#decodeCurrentCase(existing);
      if (view.reviewCase.id !== reviewCase.id) {
        throw new Error("AI Attempt is already bound to another Review Case");
      }
      return { status: "occupied", view };
    }
    const row = await this.#appendCurrentHumanReviewEvent({
      eventId: reviewCase.id,
      kind: "case-admitted",
      reviewCase,
      attemptId: reviewCase.originAttempt.id,
      status: reviewCase.initialQueueStatus,
      artifact: reviewCase,
    });
    return {
      status: row.status,
      view: await this.#decodeCurrentCase(row.row),
    };
  }

  async listCurrentHumanReviewSchedule(
    caseIdValue: string,
  ): Promise<readonly CurrentHumanReviewScheduleRecordView[]> {
    const caseId = digestSchema.parse(caseIdValue);
    const rows = this.#listCurrentHumanReviewEvents(
      caseId,
      "schedule-recorded",
    );
    return Promise.all(rows.map((row) => this.#decodeCurrentSchedule(row)));
  }

  async recordCurrentHumanReviewScheduleEvent(
    reviewCaseValue: CurrentHumanReviewCase,
    eventValue: CurrentHumanReviewScheduleEvent,
  ): Promise<{
    readonly status: "appended" | "occupied";
    readonly view: CurrentHumanReviewScheduleRecordView;
  }> {
    const reviewCase = currentHumanReviewCaseSchema.parse(reviewCaseValue);
    const event = currentHumanReviewScheduleEventSchema.parse(eventValue);
    if (event.caseId !== reviewCase.id) {
      throw new Error("Human Review Schedule Event binding mismatch");
    }
    const existingKind = this.#database
      .prepare(
        `SELECT global_sequence, event_id, kind, case_id, campaign_id,
                attempt_id, status, occurred_at, artifact_digest
           FROM human_review_v2_events
          WHERE case_id = ? AND kind = 'schedule-recorded' AND status = ?
          ORDER BY global_sequence
          LIMIT 1`,
      )
      .get(reviewCase.id, event.event) as
      StoredCurrentHumanReviewEventRow | undefined;
    if (existingKind !== undefined) {
      return {
        status: "occupied",
        view: await this.#decodeCurrentSchedule(existingKind),
      };
    }
    const row = await this.#appendCurrentHumanReviewEvent({
      eventId: event.id,
      kind: "schedule-recorded",
      reviewCase,
      attemptId: reviewCase.originAttempt.id,
      status: event.event,
      artifact: event,
    });
    return {
      status: row.status,
      view: await this.#decodeCurrentSchedule(row.row),
    };
  }

  async listHumanReproductionPreparations(
    caseIdValue: string,
  ): Promise<readonly HumanReproductionPreparationRecordView[]> {
    const caseId = digestSchema.parse(caseIdValue);
    const rows = this.#listCurrentHumanReviewEvents(
      caseId,
      "preparation-recorded",
    );
    return Promise.all(
      rows.map((row) => this.#decodeHumanReproductionPreparation(row)),
    );
  }

  async recordHumanReproductionPreparation(
    reviewCaseValue: CurrentHumanReviewCase,
    preparationValue: HumanReproductionPreparation,
  ): Promise<{
    readonly status: "appended" | "occupied";
    readonly view: HumanReproductionPreparationRecordView;
  }> {
    const reviewCase = currentHumanReviewCaseSchema.parse(reviewCaseValue);
    const preparation =
      humanReproductionPreparationSchema.parse(preparationValue);
    if (preparation.caseId !== reviewCase.id) {
      throw new Error("Human Reproduction Preparation binding mismatch");
    }
    const row = await this.#appendCurrentHumanReviewEvent({
      eventId: preparation.id,
      kind: "preparation-recorded",
      reviewCase,
      attemptId: preparation.selectedAttempt?.id ?? reviewCase.originAttempt.id,
      status: preparation.status,
      artifact: preparation,
    });
    return {
      status: row.status,
      view: await this.#decodeHumanReproductionPreparation(row.row),
    };
  }

  async listCurrentHumanReviewResults(
    caseIdValue: string,
  ): Promise<readonly CurrentHumanReviewResultRecordView[]> {
    const caseId = digestSchema.parse(caseIdValue);
    const rows = this.#listCurrentHumanReviewEvents(caseId, "result-recorded");
    return Promise.all(rows.map((row) => this.#decodeCurrentResult(row)));
  }

  async recordCurrentHumanReviewResult(
    reviewCaseValue: CurrentHumanReviewCase,
    resultValue: CurrentHumanReviewResult,
  ): Promise<{
    readonly status: "appended" | "occupied";
    readonly view: CurrentHumanReviewResultRecordView;
  }> {
    const reviewCase = currentHumanReviewCaseSchema.parse(reviewCaseValue);
    const result = currentHumanReviewResultSchema.parse(resultValue);
    if (result.verification.caseId !== reviewCase.id) {
      throw new Error("Current Human Review Result binding mismatch");
    }
    const existing = this.#selectCurrentHumanReviewEvent(
      "case_id = ? AND kind = 'result-recorded'",
      reviewCase.id,
    );
    if (existing !== undefined) {
      const view = await this.#decodeCurrentResult(existing);
      if (view.result.verification.id !== result.verification.id) {
        throw new Error("Current Human Review Case is already complete");
      }
      return { status: "occupied", view };
    }
    const row = await this.#appendCurrentHumanReviewEvent({
      eventId: result.verification.id,
      kind: "result-recorded",
      reviewCase,
      attemptId: result.verification.attempt.id,
      status: result.verification.disposition.status,
      artifact: result,
    });
    return {
      status: row.status,
      view: await this.#decodeCurrentResult(row.row),
    };
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
    requestValue: VerificationEnvironmentRequest,
    dispositionValue: HumanVerificationEnvironmentDisposition,
  ): Promise<RecordEnvironmentDispositionResult> {
    const request = verificationEnvironmentRequestSchema.parse(requestValue);
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

  async #appendCurrentHumanReviewEvent(input: {
    readonly eventId: string;
    readonly kind:
      | "case-admitted"
      | "schedule-recorded"
      | "preparation-recorded"
      | "result-recorded";
    readonly reviewCase: CurrentHumanReviewCase;
    readonly attemptId: string;
    readonly status: string;
    readonly artifact: unknown;
  }): Promise<{
    readonly status: "appended" | "occupied";
    readonly row: StoredCurrentHumanReviewEventRow;
  }> {
    const artifactDigest = await this.#artifactStore.putJson(input.artifact);
    if (artifactDigest !== humanOsDigest(input.artifact)) {
      throw new Error("Human OS Artifact Store returned a foreign digest");
    }
    const transact = this.#database.transaction(() => {
      const existing = this.#selectCurrentHumanReviewEvent(
        "event_id = ?",
        input.eventId,
      );
      if (existing !== undefined)
        return { status: "occupied" as const, row: existing };
      const recordedCase = this.#selectCurrentHumanReviewEvent(
        "case_id = ? AND kind = 'case-admitted'",
        input.reviewCase.id,
      );
      if (input.kind !== "case-admitted" && recordedCase === undefined) {
        throw new Error("Current Human Review event requires an admitted Case");
      }
      const occurredAt = this.#clock().toISOString();
      this.#database
        .prepare(
          `INSERT INTO human_review_v2_events (
             event_id, kind, case_id, campaign_id, attempt_id, status,
             occurred_at, artifact_digest
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          input.eventId,
          input.kind,
          input.reviewCase.id,
          input.reviewCase.campaignId,
          input.attemptId,
          input.status,
          occurredAt,
          artifactDigest,
        );
      const row = this.#selectCurrentHumanReviewEvent(
        "event_id = ?",
        input.eventId,
      );
      if (row === undefined) throw new Error("Human Review v2 append failed");
      return { status: "appended" as const, row };
    });
    return transact();
  }

  #selectCurrentHumanReviewEvent(
    predicate:
      | "event_id = ?"
      | "case_id = ? AND kind = 'case-admitted'"
      | "attempt_id = ? AND kind = 'case-admitted'"
      | "case_id = ? AND kind = 'result-recorded'",
    value: string,
  ): StoredCurrentHumanReviewEventRow | undefined {
    return this.#database
      .prepare(
        `SELECT global_sequence, event_id, kind, case_id, campaign_id,
                attempt_id, status, occurred_at, artifact_digest
           FROM human_review_v2_events
          WHERE ${predicate}
          ORDER BY global_sequence
          LIMIT 1`,
      )
      .get(value) as StoredCurrentHumanReviewEventRow | undefined;
  }

  #listCurrentHumanReviewEvents(
    caseId: string,
    kind: "schedule-recorded" | "preparation-recorded" | "result-recorded",
  ): readonly StoredCurrentHumanReviewEventRow[] {
    return this.#database
      .prepare(
        `SELECT global_sequence, event_id, kind, case_id, campaign_id,
                attempt_id, status, occurred_at, artifact_digest
           FROM human_review_v2_events
          WHERE case_id = ? AND kind = ?
          ORDER BY global_sequence`,
      )
      .all(caseId, kind) as StoredCurrentHumanReviewEventRow[];
  }

  async #decodeCurrentCase(
    row: StoredCurrentHumanReviewEventRow,
  ): Promise<CurrentHumanReviewCaseRecordView> {
    const value = await this.#artifactStore.readJson(row.artifact_digest);
    const reviewCase = currentHumanReviewCaseSchema.parse(value);
    if (
      row.kind !== "case-admitted" ||
      humanOsDigest(reviewCase) !== row.artifact_digest ||
      reviewCase.id !== row.event_id ||
      reviewCase.id !== row.case_id ||
      reviewCase.campaignId !== row.campaign_id ||
      reviewCase.originAttempt.id !== row.attempt_id ||
      reviewCase.initialQueueStatus !== row.status
    ) {
      throw new Error("Current Human Review Case artifact integrity mismatch");
    }
    return {
      ledgerHead: row.global_sequence,
      occurredAt: row.occurred_at,
      artifactDigest: row.artifact_digest,
      reviewCase,
    };
  }

  async #decodeCurrentSchedule(
    row: StoredCurrentHumanReviewEventRow,
  ): Promise<CurrentHumanReviewScheduleRecordView> {
    const value = await this.#artifactStore.readJson(row.artifact_digest);
    const event = currentHumanReviewScheduleEventSchema.parse(value);
    if (
      row.kind !== "schedule-recorded" ||
      humanOsDigest(event) !== row.artifact_digest ||
      event.id !== row.event_id ||
      event.caseId !== row.case_id ||
      event.event !== row.status
    ) {
      throw new Error("Human Review Schedule artifact integrity mismatch");
    }
    return {
      ledgerHead: row.global_sequence,
      occurredAt: row.occurred_at,
      artifactDigest: row.artifact_digest,
      event,
    };
  }

  async #decodeHumanReproductionPreparation(
    row: StoredCurrentHumanReviewEventRow,
  ): Promise<HumanReproductionPreparationRecordView> {
    const value = await this.#artifactStore.readJson(row.artifact_digest);
    const preparation = humanReproductionPreparationSchema.parse(value);
    if (
      row.kind !== "preparation-recorded" ||
      humanOsDigest(preparation) !== row.artifact_digest ||
      preparation.id !== row.event_id ||
      preparation.caseId !== row.case_id ||
      preparation.status !== row.status
    ) {
      throw new Error("Human Reproduction Preparation integrity mismatch");
    }
    return {
      ledgerHead: row.global_sequence,
      occurredAt: row.occurred_at,
      artifactDigest: row.artifact_digest,
      preparation,
    };
  }

  async #decodeCurrentResult(
    row: StoredCurrentHumanReviewEventRow,
  ): Promise<CurrentHumanReviewResultRecordView> {
    const value = await this.#artifactStore.readJson(row.artifact_digest);
    const result = currentHumanReviewResultSchema.parse(value);
    if (
      row.kind !== "result-recorded" ||
      humanOsDigest(result) !== row.artifact_digest ||
      result.verification.id !== row.event_id ||
      result.verification.caseId !== row.case_id ||
      result.verification.attempt.id !== row.attempt_id ||
      result.verification.disposition.status !== row.status
    ) {
      throw new Error("Current Human Review Result integrity mismatch");
    }
    return {
      ledgerHead: row.global_sequence,
      occurredAt: row.occurred_at,
      artifactDigest: row.artifact_digest,
      result,
    };
  }

  #selectAIIntake(
    predicate: "delivery_request_digest = ?" | "intake_id = ?",
    value: string,
  ): StoredAIReproductionIntakeRow | undefined {
    return this.#database
      .prepare(
        `SELECT global_sequence, delivery_request_digest, packet_digest,
                intake_id, campaign_id, run_id, occurred_at,
                request_artifact_digest, intake_artifact_digest
           FROM ai_reproduction_intakes
          WHERE ${predicate}
          ORDER BY global_sequence
          LIMIT 1`,
      )
      .get(value) as StoredAIReproductionIntakeRow | undefined;
  }

  #selectAIResult(
    attemptId: string,
  ): StoredAIReproductionResultRow | undefined {
    return this.#database
      .prepare(
        `SELECT global_sequence, intake_id, attempt_id, status, occurred_at,
                attempt_artifact_digest, result_artifact_digest,
                triage_packet_artifact_digest
           FROM ai_reproduction_events
          WHERE attempt_id = ?`,
      )
      .get(attemptId) as StoredAIReproductionResultRow | undefined;
  }

  async #decodeAIIntake(
    row: StoredAIReproductionIntakeRow,
  ): Promise<AIReproductionIntakeRecordView> {
    const requestValue = await this.#artifactStore.readJson(
      row.request_artifact_digest,
    );
    const intakeValue = await this.#artifactStore.readJson(
      row.intake_artifact_digest,
    );
    const request =
      runtimeVerificationPacketDeliveryRequestSchema.parse(requestValue);
    const intake = aiReproductionIntakeSchema.parse(intakeValue);
    if (
      humanOsDigest(request) !== row.request_artifact_digest ||
      humanOsDigest(intake) !== row.intake_artifact_digest ||
      request.digest !== row.delivery_request_digest ||
      humanOsDigest(request.packet) !== row.packet_digest ||
      intake.id !== row.intake_id ||
      intake.deliveryRequestDigest !== row.delivery_request_digest ||
      intake.packet.digest !== row.packet_digest ||
      intake.campaignId !== row.campaign_id ||
      intake.runId !== row.run_id
    ) {
      throw new Error("AI Reproduction Intake artifact integrity mismatch");
    }
    return {
      ledgerHead: row.global_sequence,
      occurredAt: row.occurred_at,
      requestArtifactDigest: row.request_artifact_digest,
      intakeArtifactDigest: row.intake_artifact_digest,
      request,
      intake,
    };
  }

  async #decodeAIResult(
    row: StoredAIReproductionResultRow,
  ): Promise<AIReproductionResultRecordView> {
    const attemptValue = await this.#artifactStore.readJson(
      row.attempt_artifact_digest,
    );
    const resultValue = await this.#artifactStore.readJson(
      row.result_artifact_digest,
    );
    const attempt = aiReproductionAttemptSchema.parse(attemptValue);
    const result = aiReproductionResultSchema.parse(resultValue);
    const triagePacket =
      row.triage_packet_artifact_digest === null
        ? null
        : triageReproductionPacketSchema.parse(
            await this.#artifactStore.readJson(
              row.triage_packet_artifact_digest,
            ),
          );
    if (
      humanOsDigest(attempt) !== row.attempt_artifact_digest ||
      humanOsDigest(result) !== row.result_artifact_digest ||
      attempt.id !== row.attempt_id ||
      attempt.intakeId !== row.intake_id ||
      result.attempt.id !== row.attempt_id ||
      result.status !== row.status ||
      (triagePacket === null) !== (result.triagePacket === null) ||
      (triagePacket !== null &&
        (humanOsDigest(triagePacket) !== row.triage_packet_artifact_digest ||
          humanOsDigest(result.triagePacket) !==
            row.triage_packet_artifact_digest))
    ) {
      throw new Error("AI Reproduction Result artifact integrity mismatch");
    }
    return {
      ledgerHead: row.global_sequence,
      occurredAt: row.occurred_at,
      attemptArtifactDigest: row.attempt_artifact_digest,
      resultArtifactDigest: row.result_artifact_digest,
      triagePacketArtifactDigest: row.triage_packet_artifact_digest,
      attempt,
      result,
      triagePacket,
    };
  }

  #selectFindingAIReproduction(
    predicate: "attempt_id = ?" | "finding_id = ?",
    value: string,
  ): StoredFindingAIReproductionRow | undefined {
    return this.#database
      .prepare(
        `SELECT global_sequence, finding_id, finding_digest, attempt_id,
                outcome, occurred_at, finding_artifact_digest,
                attempt_artifact_digest, record_artifact_digest
           FROM finding_ai_reproduction_events
          WHERE ${predicate}
          ORDER BY global_sequence
          LIMIT 1`,
      )
      .get(value) as StoredFindingAIReproductionRow | undefined;
  }

  #selectFindingAIReproductionClaim(
    predicate: "attempt_id = ?" | "finding_id = ?",
    value: string,
  ): StoredFindingAIReproductionClaimRow | undefined {
    return this.#database
      .prepare(
        `SELECT attempt_id, claim_id, started_at, finding_id,
                finding_digest, finding_artifact_digest, attempt_artifact_digest
           FROM finding_ai_reproduction_claims
          WHERE ${predicate}
          ORDER BY started_at
          LIMIT 1`,
      )
      .get(value) as StoredFindingAIReproductionClaimRow | undefined;
  }

  #projectFindingAIReproductionClaim(
    row: StoredFindingAIReproductionClaimRow,
  ): FindingAIReproductionClaim {
    return {
      attemptId: digestSchema.parse(row.attempt_id),
      claimId: digestSchema.parse(row.claim_id),
      startedAt: z.string().datetime().parse(row.started_at),
    };
  }

  async #decodeFindingAIReproduction(
    row: StoredFindingAIReproductionRow,
  ): Promise<FindingAIReproductionRecordView> {
    const [findingValue, attemptValue, recordValue] = await Promise.all([
      this.#artifactStore.readJson(row.finding_artifact_digest),
      this.#artifactStore.readJson(row.attempt_artifact_digest),
      this.#artifactStore.readJson(row.record_artifact_digest),
    ]);
    const finding = researchFindingSchema.parse(findingValue);
    const attempt = findingAIReproductionAttemptSchema.parse(attemptValue);
    const record = aiVerificationRecordSchema.parse(recordValue);
    if (
      humanOsDigest(finding) !== row.finding_artifact_digest ||
      humanOsDigest(attempt) !== row.attempt_artifact_digest ||
      humanOsDigest(record) !== row.record_artifact_digest ||
      finding.id !== row.finding_id ||
      row.finding_digest !== row.finding_artifact_digest ||
      attempt.id !== row.attempt_id ||
      attempt.finding.id !== finding.id ||
      attempt.finding.digest !== row.finding_digest ||
      record.finding.id !== finding.id ||
      record.finding.digest !== row.finding_digest ||
      record.attempt.id !== attempt.id ||
      humanOsDigest(record.attempt) !==
        humanOsDigest(referenceFindingAIReproductionAttempt(attempt)) ||
      record.outcome.status !== row.outcome
    ) {
      throw new Error("Finding AI Reproduction artifact integrity mismatch");
    }
    return {
      ledgerHead: row.global_sequence,
      occurredAt: row.occurred_at,
      findingArtifactDigest: row.finding_artifact_digest,
      attemptArtifactDigest: row.attempt_artifact_digest,
      recordArtifactDigest: row.record_artifact_digest,
      finding,
      attempt,
      record,
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
    const request = verificationEnvironmentRequestSchema.parse(requestValue);
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
