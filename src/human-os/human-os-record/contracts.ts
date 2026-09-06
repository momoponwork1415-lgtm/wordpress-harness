import type {
  HumanVerificationEnvironmentDisposition,
  VerificationEnvironmentRequest,
} from "../human-verification-environment-contracts.js";
import type {
  AIReproductionAttempt,
  AIReproductionIntake,
  AIReproductionResult,
  TriageReproductionPacket,
} from "../ai-reproduction-contracts.js";
import type {
  AIVerificationRecord,
  FindingAIReproductionAttempt,
} from "../ai-reproduction-contracts.js";
import type { Finding } from "../../research/validation/finding.js";
import type {
  CurrentHumanReviewCase,
  CurrentHumanReviewResult,
  CurrentHumanReviewScheduleEvent,
  HumanReproductionPreparation,
} from "../current-human-review-contracts.js";
import type {
  HumanReviewCase,
  HumanReviewPacketDeliveryRequest,
  HumanVerificationResult,
} from "../human-verification-contracts.js";
import type { RuntimeVerificationPacketDeliveryRequest } from "../../research/validation/runtime-verification-packet.js";

export interface HumanOsArtifactStore {
  putJson(value: unknown): Promise<string>;
  readJson(digest: string): Promise<unknown>;
}

export interface HumanVerificationEnvironmentRecordView {
  readonly ledgerHead: number;
  readonly occurredAt: string;
  readonly requestArtifactDigest: string;
  readonly dispositionArtifactDigest: string;
  readonly request: VerificationEnvironmentRequest;
  readonly disposition: HumanVerificationEnvironmentDisposition;
}

export interface RecordEnvironmentDispositionResult {
  readonly status: "appended" | "occupied";
  readonly view: HumanVerificationEnvironmentRecordView;
}

export interface HumanReviewAdmissionRecordView {
  readonly ledgerHead: number;
  readonly occurredAt: string;
  readonly requestArtifactDigest: string;
  readonly caseArtifactDigest: string;
  readonly request: HumanReviewPacketDeliveryRequest;
  readonly reviewCase: HumanReviewCase;
}

export interface RecordHumanReviewAdmissionResult {
  readonly status: "appended" | "occupied";
  readonly view: HumanReviewAdmissionRecordView;
}

export interface HumanVerificationResultRecordView {
  readonly ledgerHead: number;
  readonly occurredAt: string;
  readonly resultArtifactDigest: string;
  readonly result: HumanVerificationResult;
}

export interface RecordHumanVerificationResultResult {
  readonly status: "appended" | "occupied";
  readonly view: HumanVerificationResultRecordView;
}

export interface AIReproductionIntakeRecordView {
  readonly ledgerHead: number;
  readonly occurredAt: string;
  readonly requestArtifactDigest: string;
  readonly intakeArtifactDigest: string;
  readonly request: RuntimeVerificationPacketDeliveryRequest;
  readonly intake: AIReproductionIntake;
}

export interface RecordAIReproductionIntakeResult {
  readonly status: "appended" | "occupied";
  readonly view: AIReproductionIntakeRecordView;
}

export interface AIReproductionResultRecordView {
  readonly ledgerHead: number;
  readonly occurredAt: string;
  readonly attemptArtifactDigest: string;
  readonly resultArtifactDigest: string;
  readonly triagePacketArtifactDigest: string | null;
  readonly attempt: AIReproductionAttempt;
  readonly result: AIReproductionResult;
  readonly triagePacket: TriageReproductionPacket | null;
}

export interface RecordAIReproductionResultResult {
  readonly status: "appended" | "occupied";
  readonly view: AIReproductionResultRecordView;
}

export interface AIReproductionRecord {
  readAIReproductionIntake(
    deliveryRequestDigest: string,
  ): Promise<AIReproductionIntakeRecordView | undefined>;
  readAIReproductionIntakeById(
    intakeId: string,
  ): Promise<AIReproductionIntakeRecordView | undefined>;
  recordAIReproductionIntake(
    request: RuntimeVerificationPacketDeliveryRequest,
    intake: AIReproductionIntake,
  ): Promise<RecordAIReproductionIntakeResult>;
  readAIReproductionResult(
    attemptId: string,
  ): Promise<AIReproductionResultRecordView | undefined>;
  recordAIReproductionResult(
    intake: AIReproductionIntake,
    attempt: AIReproductionAttempt,
    result: AIReproductionResult,
  ): Promise<RecordAIReproductionResultResult>;
}

export interface FindingAIReproductionRecordView {
  readonly ledgerHead: number;
  readonly occurredAt: string;
  readonly findingArtifactDigest: string;
  readonly attemptArtifactDigest: string;
  readonly recordArtifactDigest: string;
  readonly finding: Finding;
  readonly attempt: FindingAIReproductionAttempt;
  readonly record: AIVerificationRecord;
}

export interface FindingAIReproductionClaim {
  readonly attemptId: string;
  readonly claimId: string;
  readonly startedAt: string;
}

export interface FindingAIReproductionClaimView {
  readonly claim: FindingAIReproductionClaim;
  readonly finding: Finding;
  readonly attempt: FindingAIReproductionAttempt;
}

export type ClaimFindingAIReproductionResult =
  | {
      readonly status: "claimed";
      readonly claim: FindingAIReproductionClaim;
    }
  | {
      readonly status: "in-progress";
      readonly claim: FindingAIReproductionClaim;
    }
  | {
      readonly status: "completed";
      readonly view: FindingAIReproductionRecordView;
    };

export interface FindingAIReproductionStore {
  claimFindingAIReproduction(
    finding: Finding,
    attempt: FindingAIReproductionAttempt,
    claimId: string,
  ): Promise<ClaimFindingAIReproductionResult>;
  readFindingAIReproductionByAttempt(
    attemptId: string,
  ): Promise<FindingAIReproductionRecordView | undefined>;
  listFindingAIReproductionClaims(
    findingId: string,
  ): Promise<readonly FindingAIReproductionClaimView[]>;
  listFindingAIReproduction(
    findingId: string,
  ): Promise<readonly FindingAIReproductionRecordView[]>;
  recordFindingAIReproduction(
    claim: FindingAIReproductionClaim,
    finding: Finding,
    attempt: FindingAIReproductionAttempt,
    record: AIVerificationRecord,
  ): Promise<{
    readonly status: "appended" | "occupied";
    readonly view: FindingAIReproductionRecordView;
  }>;
}

export interface CurrentHumanReviewCaseRecordView {
  readonly ledgerHead: number;
  readonly occurredAt: string;
  readonly artifactDigest: string;
  readonly reviewCase: CurrentHumanReviewCase;
}

export interface CurrentHumanReviewScheduleRecordView {
  readonly ledgerHead: number;
  readonly occurredAt: string;
  readonly artifactDigest: string;
  readonly event: CurrentHumanReviewScheduleEvent;
}

export interface HumanReproductionPreparationRecordView {
  readonly ledgerHead: number;
  readonly occurredAt: string;
  readonly artifactDigest: string;
  readonly preparation: HumanReproductionPreparation;
}

export interface CurrentHumanReviewResultRecordView {
  readonly ledgerHead: number;
  readonly occurredAt: string;
  readonly artifactDigest: string;
  readonly result: CurrentHumanReviewResult;
}

export interface CurrentHumanReviewStore {
  readCurrentHumanReviewCase(
    caseId: string,
  ): Promise<CurrentHumanReviewCaseRecordView | undefined>;
  readCurrentHumanReviewCaseByAttempt(
    attemptId: string,
  ): Promise<CurrentHumanReviewCaseRecordView | undefined>;
  listCurrentHumanReviewCases(
    campaignId: string,
  ): Promise<readonly CurrentHumanReviewCaseRecordView[]>;
  recordCurrentHumanReviewCase(reviewCase: CurrentHumanReviewCase): Promise<{
    readonly status: "appended" | "occupied";
    readonly view: CurrentHumanReviewCaseRecordView;
  }>;
  listCurrentHumanReviewSchedule(
    caseId: string,
  ): Promise<readonly CurrentHumanReviewScheduleRecordView[]>;
  recordCurrentHumanReviewScheduleEvent(
    reviewCase: CurrentHumanReviewCase,
    event: CurrentHumanReviewScheduleEvent,
  ): Promise<{
    readonly status: "appended" | "occupied";
    readonly view: CurrentHumanReviewScheduleRecordView;
  }>;
  listHumanReproductionPreparations(
    caseId: string,
  ): Promise<readonly HumanReproductionPreparationRecordView[]>;
  recordHumanReproductionPreparation(
    reviewCase: CurrentHumanReviewCase,
    preparation: HumanReproductionPreparation,
  ): Promise<{
    readonly status: "appended" | "occupied";
    readonly view: HumanReproductionPreparationRecordView;
  }>;
  listCurrentHumanReviewResults(
    caseId: string,
  ): Promise<readonly CurrentHumanReviewResultRecordView[]>;
  recordCurrentHumanReviewResult(
    reviewCase: CurrentHumanReviewCase,
    result: CurrentHumanReviewResult,
  ): Promise<{
    readonly status: "appended" | "occupied";
    readonly view: CurrentHumanReviewResultRecordView;
  }>;
}

export interface HumanOsRecord
  extends
    AIReproductionRecord,
    FindingAIReproductionStore,
    CurrentHumanReviewStore {
  close(): void;
  readEnvironmentDisposition(
    requestDigest: string,
  ): Promise<HumanVerificationEnvironmentRecordView | undefined>;
  recordEnvironmentDisposition(
    request: VerificationEnvironmentRequest,
    disposition: HumanVerificationEnvironmentDisposition,
  ): Promise<RecordEnvironmentDispositionResult>;
  readHumanReviewAdmission(
    deliveryRequestDigest: string,
  ): Promise<HumanReviewAdmissionRecordView | undefined>;
  readHumanReviewCaseByPacket(
    packetDigest: string,
  ): Promise<HumanReviewAdmissionRecordView | undefined>;
  readHumanReviewCase(
    caseId: string,
  ): Promise<HumanReviewAdmissionRecordView | undefined>;
  listHumanReviewCases(
    campaignId: string,
  ): Promise<readonly HumanReviewAdmissionRecordView[]>;
  recordHumanReviewAdmission(
    request: HumanReviewPacketDeliveryRequest,
    reviewCase: HumanReviewCase,
  ): Promise<RecordHumanReviewAdmissionResult>;
  listHumanVerificationResults(
    caseId: string,
  ): Promise<readonly HumanVerificationResultRecordView[]>;
  recordHumanVerificationResult(
    reviewCase: HumanReviewCase,
    result: HumanVerificationResult,
  ): Promise<RecordHumanVerificationResultResult>;
}

export interface OpenHumanOsRecordOptions {
  readonly databasePath: string;
  readonly artifactStore: HumanOsArtifactStore;
  readonly clock?: () => Date;
}
