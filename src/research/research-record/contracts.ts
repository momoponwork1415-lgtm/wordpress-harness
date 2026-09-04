import type { NewCampaignInput } from "../contracts.js";
import type { SemanticFinderCheckpointRef } from "../exploration/semantic-contracts.js";
import type {
  ApproachFamilyRegistry,
  ApproachFamilyRegistryRef,
  SemanticIterationDecisionRef,
} from "../exploration/semantic-approach-family-registry.js";
import type { IterationDecisionV2 } from "../exploration/semantic-contracts.js";
import type { ChainSynthesis } from "../exploration/semantic-chain-synthesis.js";
import type { DepthIterationDecision } from "../exploration/semantic-depth-evaluation.js";
import type { SemanticDepthWorkQueue } from "../exploration/semantic-depth-work-queue.js";
import type { TargetFileManifestRef } from "../source-mapping/contracts.js";
import type {
  CampaignAttemptCompletion,
  CampaignAttemptIntent,
  CampaignAttemptRecordView,
  CampaignAttemptCompletionV2,
  CampaignAttemptIntentV2,
  CampaignAttemptRecordViewV2,
  CampaignRunCompletionInput,
  CampaignRunCompletionInputV2,
  CampaignRunPlan,
  CampaignRunPlanV2,
  CampaignRunRecordView,
  CampaignRunRecordViewV2,
  AnyCampaignRunRecordView,
} from "../campaign-control/contracts.js";
import type {
  VerificationCompletionInput,
  VerificationPlan,
  VerificationRecordRef,
  VerificationRecordView,
} from "../verification/contracts.js";
import type { CampaignProgressView } from "../campaign-progress-contracts.js";

export interface PreparationRecord {
  readonly campaignId: string;
  readonly ledgerHead: number;
  readonly occurredAt: string;
  readonly inputDigest: string;
  readonly input: NewCampaignInput;
  readonly targetFileManifest?: TargetFileManifestRef;
}

export interface RecordPreparationResult {
  readonly disposition: "appended" | "occupied";
  readonly requestedInputDigest: string;
  readonly preparation: PreparationRecord;
}

export interface ResearchRecord {
  recordPreparation(
    input: NewCampaignInput,
    targetFileManifest?: TargetFileManifestRef,
  ): Promise<RecordPreparationResult>;
  readPreparation(campaignId: string): Promise<PreparationRecord | undefined>;
  recordCampaignRunStart(
    plan: CampaignRunPlan,
  ): Promise<RecordCampaignRunStartResult>;
  recordCampaignRunCompletion(
    input: CampaignRunCompletionInput,
  ): Promise<CampaignRunRecordView>;
  recordSemanticCampaignRunStart(
    plan: CampaignRunPlanV2,
  ): Promise<RecordSemanticCampaignRunStartResult>;
  recordSemanticCampaignRunCompletion(
    input: CampaignRunCompletionInputV2,
  ): Promise<CampaignRunRecordViewV2>;
  readCampaignRun(
    campaignId: string,
    runId: string,
  ): Promise<AnyCampaignRunRecordView | undefined>;
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
  recordSemanticCampaignAttemptStart(
    intent: CampaignAttemptIntentV2,
  ): Promise<RecordSemanticCampaignAttemptStartResult>;
  recordSemanticCampaignAttemptCompletion(
    completion: CampaignAttemptCompletionV2,
  ): Promise<CampaignAttemptRecordViewV2>;
  listSemanticCampaignAttempts(
    campaignId: string,
    runId: string,
  ): Promise<readonly CampaignAttemptRecordViewV2[]>;
  recordSemanticFinderCheckpoint(
    checkpoint: SemanticFinderCheckpointRef,
  ): Promise<SemanticFinderCheckpointRecordView>;
  listSemanticFinderCheckpoints(
    campaignId: string,
    runId: string,
  ): Promise<readonly SemanticFinderCheckpointRecordView[]>;
  recordSemanticIterationDecision(
    campaignId: string,
    runId: string,
    decision: IterationDecisionV2,
  ): Promise<SemanticIterationDecisionRecordView>;
  recordSemanticDepthIteration(
    campaignId: string,
    runId: string,
    input: {
      readonly queue: SemanticDepthWorkQueue;
      readonly synthesis: ChainSynthesis;
      readonly decision: DepthIterationDecision;
    },
  ): Promise<ApproachFamilyRegistryRecordView>;
  recordSemanticMissingLinkEvidence(
    campaignId: string,
    runId: string,
    decisionDigest: string,
    followUpQueues: readonly SemanticDepthWorkQueue[],
  ): Promise<ApproachFamilyRegistryRecordView>;
  recordSemanticFamilyVerificationOutcomes(
    campaignId: string,
    runId: string,
    resolutions: readonly {
      readonly familyId: string;
      readonly verification: VerificationRecordRef;
    }[],
  ): Promise<ApproachFamilyRegistryRecordView>;
  readApproachFamilyRegistry(
    campaignId: string,
    runId: string,
  ): Promise<ApproachFamilyRegistryRecordView | undefined>;
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
  readCampaignProgress(
    campaignId: string,
  ): Promise<CampaignProgressView | undefined>;
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

export type RecordSemanticCampaignAttemptStartResult =
  | {
      readonly disposition: "started" | "in-progress";
      readonly attempt: CampaignAttemptRecordViewV2;
    }
  | {
      readonly disposition: "completed";
      readonly attempt: CampaignAttemptRecordViewV2 & {
        readonly completion: NonNullable<
          CampaignAttemptRecordViewV2["completion"]
        >;
      };
    };

export type RecordSemanticCampaignRunStartResult =
  | {
      readonly disposition: "started";
      readonly planDigest: string;
      readonly ledgerHead: number;
      readonly occurredAt: string;
    }
  | {
      readonly disposition: "completed";
      readonly planDigest: string;
      readonly run: CampaignRunRecordViewV2;
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

export interface SemanticFinderCheckpointRecordView {
  readonly ledgerHead: number;
  readonly occurredAt: string;
  readonly checkpoint: SemanticFinderCheckpointRef;
}

export interface SemanticIterationDecisionRecordView {
  readonly ledgerHead: number;
  readonly occurredAt: string;
  readonly decision: SemanticIterationDecisionRef;
  readonly registry: ApproachFamilyRegistryRef;
}

export interface ApproachFamilyRegistryRecordView {
  readonly ref: ApproachFamilyRegistryRef;
  readonly value: ApproachFamilyRegistry;
}

export interface OpenResearchRecordOptions {
  readonly databasePath: string;
  readonly clock?: () => Date;
  readonly artifactStore?: JsonArtifactStore;
}

export interface JsonArtifactStore {
  putJson(value: unknown): Promise<string>;
  readJson(digest: string): Promise<unknown>;
}
