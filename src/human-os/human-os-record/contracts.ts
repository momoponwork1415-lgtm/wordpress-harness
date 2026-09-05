import type {
  HumanVerificationEnvironmentDisposition,
  HumanVerificationEnvironmentRequest,
} from "../human-verification-environment-contracts.js";
import type {
  AIReproductionAttempt,
  AIReproductionIntake,
  AIReproductionResult,
  TriageReproductionPacket,
} from "../ai-reproduction-contracts.js";
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
  readonly request: HumanVerificationEnvironmentRequest;
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

export interface HumanOsRecord extends AIReproductionRecord {
  readEnvironmentDisposition(
    requestDigest: string,
  ): Promise<HumanVerificationEnvironmentRecordView | undefined>;
  recordEnvironmentDisposition(
    request: HumanVerificationEnvironmentRequest,
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
