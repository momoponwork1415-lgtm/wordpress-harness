import type { NewCampaignInput } from "../contracts.js";
import type {
  CampaignAttemptCompletion,
  CampaignAttemptIntent,
  CampaignAttemptRecordView,
  CampaignRunCompletionInput,
  CampaignRunPlan,
  CampaignRunRecordView,
} from "../campaign-control/contracts.js";
import type {
  VerificationCompletionInput,
  VerificationPlan,
  VerificationRecordView,
} from "../verification/contracts.js";

export interface PreparationRecord {
  readonly campaignId: string;
  readonly ledgerHead: number;
  readonly occurredAt: string;
  readonly inputDigest: string;
  readonly input: NewCampaignInput;
}

export interface RecordPreparationResult {
  readonly disposition: "appended" | "occupied";
  readonly requestedInputDigest: string;
  readonly preparation: PreparationRecord;
}

export interface ResearchRecord {
  recordPreparation(input: NewCampaignInput): Promise<RecordPreparationResult>;
  readPreparation(campaignId: string): Promise<PreparationRecord | undefined>;
  recordCampaignRunStart(
    plan: CampaignRunPlan,
  ): Promise<RecordCampaignRunStartResult>;
  recordCampaignRunCompletion(
    input: CampaignRunCompletionInput,
  ): Promise<CampaignRunRecordView>;
  readCampaignRun(
    campaignId: string,
    runId: string,
  ): Promise<CampaignRunRecordView | undefined>;
  recordCampaignAttemptStart(
    intent: CampaignAttemptIntent,
  ): Promise<RecordCampaignAttemptStartResult>;
  recordCampaignAttemptCompletion(
    completion: CampaignAttemptCompletion,
  ): Promise<CampaignAttemptRecordView>;
  listCampaignAttempts(
    campaignId: string,
    runId: string,
  ): Promise<readonly CampaignAttemptRecordView[]>;
  recordVerificationStart(
    plan: VerificationPlan,
  ): Promise<RecordVerificationStartResult>;
  recordVerificationCompletion(
    input: VerificationCompletionInput,
  ): Promise<VerificationRecordView>;
  readVerification(
    campaignId: string,
    verificationId: string,
  ): Promise<VerificationRecordView | undefined>;
  close(): void;
}

export type RecordCampaignAttemptStartResult =
  | {
      readonly disposition: "started" | "in-progress";
      readonly attempt: CampaignAttemptRecordView;
    }
  | {
      readonly disposition: "completed";
      readonly attempt: CampaignAttemptRecordView & {
        readonly completion: NonNullable<
          CampaignAttemptRecordView["completion"]
        >;
      };
    };

export type RecordCampaignRunStartResult =
  | {
      readonly disposition: "started";
      readonly planDigest: string;
      readonly ledgerHead: number;
      readonly occurredAt: string;
    }
  | {
      readonly disposition: "completed";
      readonly planDigest: string;
      readonly run: CampaignRunRecordView;
    };

export type RecordVerificationStartResult =
  | {
      readonly disposition: "started";
      readonly planDigest: string;
      readonly ledgerHead: number;
      readonly occurredAt: string;
    }
  | {
      readonly disposition: "completed";
      readonly planDigest: string;
      readonly verification: VerificationRecordView;
    };

export interface OpenResearchRecordOptions {
  readonly databasePath: string;
  readonly clock?: () => Date;
}

export interface JsonArtifactStore {
  putJson(value: unknown): Promise<string>;
  readJson(digest: string): Promise<unknown>;
}
