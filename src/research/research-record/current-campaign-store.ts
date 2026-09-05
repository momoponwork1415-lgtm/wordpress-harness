import type { NewCampaignInput } from "../contracts.js";
import type { IterationDecisionV3 } from "../exploration/index.js";
import type {
  AdversarialCritique,
  AdversarialCritiqueIncomplete,
  ChainSynthesis,
  ChainSynthesisIncomplete,
  CurrentDepthEvaluationIncomplete,
  CurrentDepthIterationDecision,
  SemanticDepthWorkQueueV2,
  SemanticFinderCheckpointRef,
} from "../exploration/index.js";
import type { TargetFileManifestRef } from "../source-mapping/contracts.js";
import type {
  CampaignAttemptCompletionV2,
  CampaignAttemptBudgetReservation,
  CampaignAttemptIntentV2,
  CampaignAttemptResultStoredV2,
  CampaignAttemptRecordViewV2,
  CampaignRunCompletionInputV3,
  CampaignRunPlanV3,
  CampaignRunRecordViewV3,
  CampaignBudgetView,
} from "../campaign-control/contracts.js";
import type {
  RuntimeRiskAssessment,
  RuntimeVerificationPacket,
  RuntimeVerificationPacketHandoff,
} from "../validation/runtime-verification-packet.js";
import type {
  ValidationCandidate,
  CurrentValidationRecordRef,
} from "../validation/contracts.js";
import type {
  ApproachFamilyRegistryRecordViewV3,
  CompleteSemanticCampaignAttemptWithBudgetInput,
  CompleteSemanticCampaignAttemptWithBudgetResult,
  RuntimeVerificationPacketRecordView,
  PreparationRecord,
  RecordPreparationResult,
  RecordSemanticCampaignAttemptStartResult,
  RecordSemanticCampaignAttemptAdmissionResult,
  RecordSemanticCampaignRunStartResult,
  SemanticAdversarialCritiqueRecordViewV2,
  SemanticChainSynthesisRecordViewV2,
  SemanticDepthEvaluationIncompleteRecordViewV2,
  SemanticDepthWorkQueueRecordViewV2,
  SemanticFinderCheckpointRecordView,
  SemanticIterationDecisionRecordViewV3,
  ValidationCompletionRecordView,
  ValidationFrontierGapRecordView,
  ValidationIntentRecordView,
} from "./contracts.js";

/**
 * Private persistence seam for the current Campaign write path.
 *
 * It deliberately excludes archived run writers, automated Verification writes,
 * and the broad legacy ResearchRecord contract. Contract schema versions remain
 * explicit because they are part of the durable Ledger/CAS representation.
 */
export interface CurrentCampaignStore {
  recordPreparation(
    input: NewCampaignInput,
    targetFileManifest?: TargetFileManifestRef,
  ): Promise<RecordPreparationResult>;
  readPreparation(campaignId: string): Promise<PreparationRecord | undefined>;
  recordSemanticCampaignRunStart(
    plan: CampaignRunPlanV3,
  ): Promise<RecordSemanticCampaignRunStartResult>;
  recordSemanticCampaignRunCompletionV3(
    input: CampaignRunCompletionInputV3,
  ): Promise<CampaignRunRecordViewV3>;
  recordSemanticCampaignAttemptStart(
    intent: CampaignAttemptIntentV2,
  ): Promise<RecordSemanticCampaignAttemptStartResult>;
  recordSemanticCampaignAttemptAdmission(
    reservation: CampaignAttemptBudgetReservation,
    intent: CampaignAttemptIntentV2,
  ): Promise<RecordSemanticCampaignAttemptAdmissionResult>;
  recordSemanticCampaignAttemptResult(
    result: CampaignAttemptResultStoredV2,
  ): Promise<CampaignAttemptRecordViewV2>;
  recordSemanticCampaignAttemptCompletion(
    completion: CampaignAttemptCompletionV2,
  ): Promise<CampaignAttemptRecordViewV2>;
  completeSemanticCampaignAttemptWithBudget(
    input: CompleteSemanticCampaignAttemptWithBudgetInput,
  ): Promise<CompleteSemanticCampaignAttemptWithBudgetResult>;
  readSemanticCampaignBudget(
    campaignId: string,
    runId: string,
  ): Promise<CampaignBudgetView | undefined>;
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
  recordSemanticDepthIterationV3(
    campaignId: string,
    runId: string,
    input: {
      readonly queue: SemanticDepthWorkQueueV2;
      readonly synthesis: ChainSynthesis;
      readonly decision: CurrentDepthIterationDecision;
    },
  ): Promise<ApproachFamilyRegistryRecordViewV3>;
  readApproachFamilyRegistryV3(
    campaignId: string,
    runId: string,
  ): Promise<ApproachFamilyRegistryRecordViewV3 | undefined>;
  recordValidationIntents(
    campaignId: string,
    runId: string,
    candidates: readonly ValidationCandidate[],
  ): Promise<readonly ValidationIntentRecordView[]>;
  listValidationCompletions(
    campaignId: string,
    runId: string,
  ): Promise<readonly ValidationCompletionRecordView[]>;
  recordValidationCompletion(
    campaignId: string,
    runId: string,
    validation: CurrentValidationRecordRef,
  ): Promise<ValidationCompletionRecordView>;
  listValidationFrontierGaps(
    campaignId: string,
    runId: string,
  ): Promise<readonly ValidationFrontierGapRecordView[]>;
  readRuntimeVerificationPacket(
    campaignId: string,
    candidateId: string,
  ): Promise<RuntimeVerificationPacketRecordView | undefined>;
  recordRuntimeVerificationPacket(
    campaignId: string,
    runId: string,
    riskAssessment: RuntimeRiskAssessment,
    packet: RuntimeVerificationPacket,
  ): Promise<RuntimeVerificationPacketRecordView>;
  recordRuntimeVerificationPacketHandoff(
    campaignId: string,
    runId: string,
    handoff: RuntimeVerificationPacketHandoff,
  ): Promise<RuntimeVerificationPacketRecordView>;
}
