import type { NewCampaignInput } from "../contracts.js";
import type { SemanticFinderCheckpointRef } from "../exploration/semantic-contracts.js";
import type {
  ApproachFamilyRegistry,
  ApproachFamilyRegistryRef,
  SemanticIterationDecisionRef,
} from "../exploration/semantic-approach-family-registry.js";
import type {
  ApproachFamilyRegistryRefV3,
  ApproachFamilyRegistryV3,
  SemanticIterationDecisionRefV3,
} from "../exploration/semantic-approach-family-registry-v3.js";
import type {
  IterationDecisionV2,
  IterationDecisionV3,
} from "../exploration/semantic-contracts.js";
import type {
  ChainSynthesis,
  ChainSynthesisIncomplete,
} from "../exploration/semantic-chain-synthesis.js";
import type {
  AdversarialCritique,
  AdversarialCritiqueIncomplete,
  AdversarialCritiqueRef,
  ChainSynthesisRef,
} from "../exploration/semantic-adversarial-critique.js";
import type { DepthIterationDecision } from "../exploration/semantic-depth-evaluation.js";
import type {
  CurrentDepthEvaluationIncomplete,
  CurrentDepthIterationDecision,
} from "../exploration/semantic-depth-evaluation-v2.js";
import type {
  SemanticDepthWorkQueue,
  SemanticDepthWorkQueueRefV2,
  SemanticDepthWorkQueueV2,
} from "../exploration/semantic-depth-work-queue.js";
import type { TargetFileManifestRef } from "../source-mapping/contracts.js";
import type {
  CampaignAttemptCompletion,
  CampaignAttemptIntent,
  CampaignAttemptRecordView,
  CampaignAttemptCompletionV2,
  CampaignAttemptBudgetReservation,
  CampaignAttemptBudgetSettlement,
  CampaignAttemptIntentV2,
  CampaignAttemptResultStoredV2,
  CampaignAttemptRecordViewV2,
  CampaignBudgetView,
  CampaignRunCompletionInput,
  CampaignRunCompletionInputV2,
  CampaignRunCompletionInputV3,
  CampaignRunPlan,
  CampaignRunPlanV2,
  CampaignRunPlanV3,
  CampaignRunRecordView,
  CampaignRunRecordViewV2,
  CampaignRunRecordViewV3,
  AnyCampaignRunRecordView,
} from "../campaign-control/contracts.js";
import type { ModelAttemptUsageV2 } from "../model-attempt-usage-contracts.js";
import type {
  VerificationCompletionInput,
  VerificationPlan,
  VerificationRecordRef,
  VerificationRecordView,
} from "../verification/contracts.js";
import type { CampaignProgressView } from "../campaign-progress-contracts.js";
import type {
  ValidationCandidate,
  ValidationCandidateRef,
  ValidationFrontierGapRef,
  ValidationRecordRef as SourceValidationRecordRef,
} from "../validation/contracts.js";
import type {
  HumanReviewPacket,
  HumanReviewPacketHandoff,
  HumanReviewPacketRef,
  RiskAssessment,
  RiskAssessmentRef,
} from "../validation/human-review-packet.js";
import type {
  RuntimeRiskAssessment,
  RuntimeRiskAssessmentRef,
  RuntimeVerificationPacket,
  RuntimeVerificationPacketHandoff,
  RuntimeVerificationPacketRef,
} from "../validation/runtime-verification-packet.js";

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
    plan: CampaignRunPlanV2 | CampaignRunPlanV3,
  ): Promise<RecordSemanticCampaignRunStartResult>;
  recordSemanticCampaignRunCompletion(
    input: CampaignRunCompletionInputV2,
  ): Promise<CampaignRunRecordViewV2>;
  recordSemanticCampaignRunCompletionV3(
    input: CampaignRunCompletionInputV3,
  ): Promise<CampaignRunRecordViewV3>;
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
  recordSemanticCampaignAttemptResult(
    result: CampaignAttemptResultStoredV2,
  ): Promise<CampaignAttemptRecordViewV2>;
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
  recordSemanticIterationDecisionV3(
    campaignId: string,
    runId: string,
    decision: IterationDecisionV3,
  ): Promise<SemanticIterationDecisionRecordViewV3>;
  recordSemanticDepthWorkQueueV2(
    campaignId: string,
    runId: string,
    queue: SemanticDepthWorkQueueV2,
  ): Promise<SemanticDepthWorkQueueRecordViewV2>;
  readSemanticDepthWorkQueueV2(
    campaignId: string,
    runId: string,
  ): Promise<SemanticDepthWorkQueueRecordViewV2 | undefined>;
  recordSemanticChainSynthesisV2(
    campaignId: string,
    runId: string,
    queue: SemanticDepthWorkQueueV2,
    synthesis: ChainSynthesis | ChainSynthesisIncomplete,
  ): Promise<SemanticChainSynthesisRecordViewV2>;
  recordSemanticAdversarialCritiqueV2(
    campaignId: string,
    runId: string,
    synthesis: ChainSynthesis,
    critique: AdversarialCritique | AdversarialCritiqueIncomplete,
  ): Promise<SemanticAdversarialCritiqueRecordViewV2>;
  recordSemanticDepthEvaluationIncompleteV2(
    campaignId: string,
    runId: string,
    evaluation: CurrentDepthEvaluationIncomplete,
  ): Promise<SemanticDepthEvaluationIncompleteRecordViewV2>;
  recordSemanticDepthIteration(
    campaignId: string,
    runId: string,
    input: {
      readonly queue: SemanticDepthWorkQueue;
      readonly synthesis: ChainSynthesis;
      readonly decision: DepthIterationDecision;
    },
  ): Promise<ApproachFamilyRegistryRecordView>;
  recordSemanticDepthIterationV3(
    campaignId: string,
    runId: string,
    input: {
      readonly queue: SemanticDepthWorkQueueV2;
      readonly synthesis: ChainSynthesis;
      readonly decision: CurrentDepthIterationDecision;
    },
  ): Promise<ApproachFamilyRegistryRecordViewV3>;
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
  readApproachFamilyRegistryV3(
    campaignId: string,
    runId: string,
  ): Promise<ApproachFamilyRegistryRecordViewV3 | undefined>;
  recordValidationIntents(
    campaignId: string,
    runId: string,
    candidates: readonly ValidationCandidate[],
  ): Promise<readonly ValidationIntentRecordView[]>;
  listValidationIntents(
    campaignId: string,
    runId: string,
  ): Promise<readonly ValidationIntentRecordView[]>;
  recordValidationCompletion(
    campaignId: string,
    runId: string,
    validation: SourceValidationRecordRef,
  ): Promise<ValidationCompletionRecordView>;
  listValidationCompletions(
    campaignId: string,
    runId: string,
  ): Promise<readonly ValidationCompletionRecordView[]>;
  listValidationFrontierGaps(
    campaignId: string,
    runId: string,
  ): Promise<readonly ValidationFrontierGapRecordView[]>;
  recordHumanReviewPacket(
    campaignId: string,
    runId: string,
    riskAssessment: RiskAssessment,
    packet: HumanReviewPacket,
  ): Promise<HumanReviewPacketRecordView>;
  readHumanReviewPacket(
    campaignId: string,
    candidateId: string,
  ): Promise<HumanReviewPacketRecordView | undefined>;
  recordHumanReviewPacketHandoff(
    campaignId: string,
    runId: string,
    handoff: HumanReviewPacketHandoff,
  ): Promise<HumanReviewPacketRecordView>;
  recordRuntimeVerificationPacket(
    campaignId: string,
    runId: string,
    riskAssessment: RuntimeRiskAssessment,
    packet: RuntimeVerificationPacket,
  ): Promise<RuntimeVerificationPacketRecordView>;
  readRuntimeVerificationPacket(
    campaignId: string,
    candidateId: string,
  ): Promise<RuntimeVerificationPacketRecordView | undefined>;
  recordRuntimeVerificationPacketHandoff(
    campaignId: string,
    runId: string,
    handoff: RuntimeVerificationPacketHandoff,
  ): Promise<RuntimeVerificationPacketRecordView>;
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

export type RecordSemanticCampaignAttemptAdmissionResult =
  | (RecordSemanticCampaignAttemptStartResult & {
      readonly budget: CampaignBudgetView;
    })
  | {
      readonly disposition: "budget-exhausted";
      readonly budget: CampaignBudgetView;
      readonly exhaustedDimensions: readonly string[];
    };

export interface CampaignAttemptBudgetReservationRecordView {
  readonly ledgerHead: number;
  readonly occurredAt: string;
  readonly reservation: CampaignAttemptBudgetReservation;
}

export interface CampaignAttemptBudgetSettlementRecordView {
  readonly ledgerHead: number;
  readonly occurredAt: string;
  readonly settlement: CampaignAttemptBudgetSettlement;
}

export interface CompleteSemanticCampaignAttemptWithBudgetInput {
  readonly completion: CampaignAttemptCompletionV2;
  readonly usage?: ModelAttemptUsageV2;
}

export interface CompleteSemanticCampaignAttemptWithBudgetResult {
  readonly attempt: CampaignAttemptRecordViewV2;
  readonly budget: CampaignBudgetView;
}

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
      readonly run: CampaignRunRecordViewV2 | CampaignRunRecordViewV3;
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

export interface SemanticIterationDecisionRecordViewV3 {
  readonly ledgerHead: number;
  readonly occurredAt: string;
  readonly decision: SemanticIterationDecisionRefV3;
  readonly registry: ApproachFamilyRegistryRefV3;
}

export interface SemanticDepthWorkQueueRecordViewV2 {
  readonly ledgerHead: number;
  readonly occurredAt: string;
  readonly queue: SemanticDepthWorkQueueRefV2;
}

export interface SemanticChainSynthesisRecordViewV2 {
  readonly ledgerHead: number;
  readonly occurredAt: string;
  readonly runId: string;
  readonly batchId: string;
  readonly artifactDigest: string;
  readonly outcome: "completed" | "incomplete";
  readonly synthesis?: ChainSynthesisRef;
}

export interface SemanticAdversarialCritiqueRecordViewV2 {
  readonly ledgerHead: number;
  readonly occurredAt: string;
  readonly runId: string;
  readonly synthesisId: string;
  readonly artifactDigest: string;
  readonly outcome: "completed" | "incomplete";
  readonly critique?: AdversarialCritiqueRef;
}

export interface SemanticDepthEvaluationIncompleteRecordViewV2 {
  readonly ledgerHead: number;
  readonly occurredAt: string;
  readonly runId: string;
  readonly synthesisId: string;
  readonly artifactDigest: string;
  readonly evaluation: CurrentDepthEvaluationIncomplete;
}

export interface ApproachFamilyRegistryRecordViewV3 {
  readonly ref: ApproachFamilyRegistryRefV3;
  readonly value: ApproachFamilyRegistryV3;
}

export interface ValidationIntent {
  readonly kind: "validation-intent";
  readonly schemaVersion: 1;
  readonly id: string;
  readonly campaignId: string;
  readonly runId: string;
  readonly validationId: string;
  readonly candidate: ValidationCandidateRef;
  readonly approachFamilyIds: readonly string[];
  readonly rootEvaluationDigests: readonly string[];
}

export interface ValidationIntentRecordView {
  readonly ledgerHead: number;
  readonly occurredAt: string;
  readonly intent: ValidationIntent;
  readonly registry: ApproachFamilyRegistryRefV3;
}

export interface ValidationCompletion {
  readonly kind: "validation-completion";
  readonly schemaVersion: 1;
  readonly validation: SourceValidationRecordRef;
  readonly disposition:
    | "ready-for-runtime"
    | "ready-for-human"
    | "needs-research"
    | "disproven"
    | "rejected"
    | "validation-pending";
  readonly approachFamilyIds: readonly string[];
  readonly frontierGap?: ValidationFrontierGapRef | undefined;
}

export interface HumanReviewPacketRecordView {
  readonly ledgerHead: number;
  readonly occurredAt: string;
  readonly packet: HumanReviewPacketRef;
  readonly riskAssessment: RiskAssessmentRef;
  readonly handoffs: readonly {
    readonly ledgerHead: number;
    readonly occurredAt: string;
    readonly runId: string;
    readonly handoff: HumanReviewPacketHandoff;
  }[];
}

export interface RuntimeVerificationPacketRecordView {
  readonly ledgerHead: number;
  readonly occurredAt: string;
  readonly packet: RuntimeVerificationPacketRef;
  readonly riskAssessment: RuntimeRiskAssessmentRef;
  readonly handoffs: readonly {
    readonly ledgerHead: number;
    readonly occurredAt: string;
    readonly runId: string;
    readonly handoff: RuntimeVerificationPacketHandoff;
  }[];
}

export interface ValidationCompletionRecordView {
  readonly ledgerHead: number;
  readonly occurredAt: string;
  readonly completion: ValidationCompletion;
  readonly registry: ApproachFamilyRegistryRefV3;
}

export interface ValidationFrontierGapRecordView {
  readonly ledgerHead: number;
  readonly occurredAt: string;
  readonly frontierGap: ValidationFrontierGapRef;
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
