import { openBootstrapExploration } from "./bootstrap-exploration.js";
import { openSemanticExploration } from "./semantic-exploration.js";
export {
  openSemanticAdversarialCritique,
  referenceAdversarialCritique,
  referenceChainProposal,
  referenceChainSynthesis,
  referenceCriticFrontierGap,
} from "./semantic-adversarial-critique.js";
export { openSemanticChainSynthesis } from "./semantic-chain-synthesis.js";
export {
  closeSemanticCoverage,
  coverageObservationSchema,
  materializeCoverageReviewWave,
  projectCoverageObservation,
  semanticCoverageClosureRefSchema,
  semanticCoverageClosureSchema,
} from "./semantic-coverage-closure.js";
export {
  openSemanticDepthEvaluation,
  referenceDepthIterationDecision,
} from "./semantic-depth-evaluation.js";
export { projectSemanticDepthWorkQueue } from "./semantic-depth-work-queue.js";
export { projectMissingLinkDepthWorkQueue } from "./semantic-missing-link-depth-queue.js";
export {
  advanceApproachFamilyRegistry,
  approachFamilyEvidenceAttachmentSchema,
  approachFamilyTransitionSchema,
  approachFamilyVerificationResolutionSchema,
  attachApproachFamilyEvidence,
  resolveApproachFamilyVerifications,
} from "./semantic-approach-family-transition.js";
export {
  materializeMissingLinkWaves,
  referenceSemanticMissingLinkWavePlan,
} from "./semantic-missing-link-wave.js";
export {
  approachFamilyOpeningDecisionRefSchema,
  approachFamilyRefSchema,
  approachFamilyRegistryRefSchema,
  approachFamilyRegistrySchema,
  approachFamilySchema,
  admittedApproachFamilyId,
  depthApproachFamilyId,
  projectApproachFamilyRegistry,
  projectInitialApproachFamilies,
  referenceApproachFamily,
  referenceSemanticIterationDecision,
  semanticDepthIterationDecisionOpeningRefSchema,
  semanticIterationDecisionRefSchema,
} from "./semantic-approach-family-registry.js";
export {
  approachFamilyRefV3Schema,
  approachFamilyRegistryRefV3Schema,
  approachFamilyRegistryV3Schema,
  approachFamilyV3Schema,
  projectApproachFamilyRegistryV3,
  referenceSemanticIterationDecisionV3,
  semanticIterationDecisionRefV3Schema,
} from "./semantic-approach-family-registry-v3.js";
import type { Exploration, OpenExplorationOptions } from "./contracts.js";
import type {
  OpenSemanticExplorationOptions,
  SemanticExploration,
} from "./semantic-contracts.js";
export type {
  ApproachFamilyOpeningDecisionRef,
  ApproachFamily,
  ApproachFamilyRef,
  ApproachFamilyRegistry,
  ApproachFamilyRegistryRef,
  SemanticIterationDecisionRef,
} from "./semantic-approach-family-registry.js";
export type {
  ApproachFamilyRefV3,
  ApproachFamilyRegistryRefV3,
  ApproachFamilyRegistryV3,
  ApproachFamilyV3,
  SemanticIterationDecisionRefV3,
} from "./semantic-approach-family-registry-v3.js";
export type {
  AdversarialCriticOutput,
  AdversarialCritique,
  AdversarialCritiqueRef,
  AdversarialCritiqueIncomplete,
  ChainProposalRef,
  ChainSynthesisRef,
  CriticFrontierGap,
  CriticFrontierGapRef,
  OpenSemanticAdversarialCritiqueOptions,
  SemanticAdversarialCritique,
  SemanticAdversarialCritiqueInput,
  SemanticAdversarialCritiqueResult,
} from "./semantic-adversarial-critique.js";
export type {
  ChainProposal,
  ChainSynthesis,
  ChainSynthesisIncomplete,
  OpenSemanticChainSynthesisOptions,
  RootSynthesisOutput,
  SemanticChainSynthesis,
  SemanticChainSynthesisInput,
  SemanticChainSynthesisResult,
} from "./semantic-chain-synthesis.js";
export type {
  CoverageObservation,
  SemanticCoverageClosure,
  SemanticCoverageClosureRef,
} from "./semantic-coverage-closure.js";
export type {
  DepthEvaluationIncomplete,
  DepthIterationDecision,
  DepthIterationDecisionRef,
  DepthRootEvaluatorOutput,
  OpenSemanticDepthEvaluationOptions,
  SemanticDepthEvaluation,
  SemanticDepthEvaluationInput,
  SemanticDepthEvaluationResult,
} from "./semantic-depth-evaluation.js";
export type {
  SemanticDepthWorkItem,
  SemanticDepthWorkQueue,
  SemanticDepthWorkQueueRef,
} from "./semantic-depth-work-queue.js";
export type {
  MissingLinkWorkLease,
  SemanticMissingLinkWavePlan,
  SemanticMissingLinkWavePlanRef,
} from "./semantic-missing-link-wave.js";
export type { MissingLinkDepthQueueProjection } from "./semantic-missing-link-depth-queue.js";
export type {
  ApproachFamilyEvidenceAttachment,
  ApproachFamilyTransition,
  ApproachFamilyVerificationResolution,
} from "./semantic-approach-family-transition.js";

export type {
  AttemptExecutionResultRef,
  Exploration,
  ExplorationBootstrapPolicy,
  ExplorationDecision,
  ExplorationDecisionInput,
  ExplorationPolicyRef,
  ExplorationStateRef,
  FinderAttemptResult,
  FocusArea,
  OpenExplorationOptions,
  RouteFragmentProposal,
  SourceBoundHypothesis,
  WorkLease,
  WorkWavePlan,
  WorkWaveRef,
} from "./contracts.js";
export type {
  ApproachFamilyAdmission,
  ApproachFamilyAdmissionRef,
  EvaluationIncompleteDecision,
  OpenSemanticExplorationOptions,
  OracleFreeTargetMetadata,
  FinderOutputV2,
  ExplorationSubjectRef,
  FrontierGapProposal,
  IterationActionV2,
  IterationActionV3,
  IterationDecisionV2,
  IterationDecisionV3,
  PlanningIncompleteDecision,
  ResearchThesis,
  ResearchThesisProposal,
  ResearchThesisRef,
  RootPlannerOutput,
  RootEvaluatorOutput,
  RootEvaluatorOutputV1,
  RootEvaluatorOutputV2,
  SemanticExploration,
  SemanticExplorationDecision,
  SemanticExplorationDecisionInput,
  SemanticFinderCheckpoint,
  SemanticFinderCheckpointRef,
  SemanticCheckpointSubjectProposal,
  SemanticWaveAttemptOutcome,
  SemanticWaveTerminal,
  SemanticWaveTerminalRef,
  SemanticWaveEvaluationInput,
  SemanticWaveEvaluationInputV2,
  SemanticWaveEvaluationInputV3,
  SemanticRootPlanningPolicy,
  SemanticWorkLease,
  SemanticWorkLeaseRef,
  SemanticWorkWavePlan,
  SemanticWorkWaveRef,
} from "./semantic-contracts.js";
export {
  adversarialCriticOutputSchema,
  adversarialCritiqueIncompleteSchema,
  adversarialCritiqueRefSchema,
  adversarialCritiqueSchema,
  chainProposalRefSchema,
  chainSynthesisRefSchema,
  criticFrontierGapSchema,
  criticFrontierGapRefSchema,
  semanticAdversarialCritiqueInputSchema,
} from "./semantic-adversarial-critique.js";
export {
  chainProposalSchema,
  chainSynthesisIncompleteSchema,
  chainSynthesisSchema,
  rootSynthesisOutputSchema,
  semanticChainSynthesisInputSchema,
} from "./semantic-chain-synthesis.js";
export {
  depthEvaluationIncompleteSchema,
  depthIterationDecisionRefSchema,
  depthIterationDecisionSchema,
  depthRootEvaluatorOutputSchema,
  semanticDepthEvaluationInputSchema,
} from "./semantic-depth-evaluation.js";
export {
  semanticDepthWorkItemSchema,
  semanticDepthWorkQueueRefSchema,
  semanticDepthWorkQueueSchema,
} from "./semantic-depth-work-queue.js";
export {
  missingLinkWorkLeaseSchema,
  semanticMissingLinkWavePlanRefSchema,
  semanticMissingLinkWavePlanSchema,
} from "./semantic-missing-link-wave.js";
export {
  approachFamilyAdmissionRefSchema,
  approachFamilyAdmissionSchema,
  evaluationIncompleteDecisionSchema,
  evaluationIncompleteDecisionV3Schema,
  oracleFreeTargetMetadataSchema,
  finderOutputV2Schema,
  explorationSubjectRefSchema,
  frontierGapProposalSchema,
  frontierGapArtifactRefSchema,
  frontierGapArtifactSchema,
  researchThesisProposalSchema,
  researchThesisRefSchema,
  researchThesisSchema,
  rootPlannerOutputSchema,
  rootEvaluatorOutputSchema,
  rootEvaluatorOutputV1Schema,
  rootEvaluatorOutputV2Schema,
  routeFragmentArtifactRefSchema,
  routeFragmentArtifactSchema,
  semanticExplorationDecisionInputSchema,
  semanticExplorationDecisionSchema,
  semanticCheckpointSubjectProposalSchema,
  semanticFinderCheckpointRefSchema,
  semanticFinderCheckpointSchema,
  semanticRootPlanningPolicySchema,
  semanticWaveEvaluationInputSchema,
  semanticWaveEvaluationInputV2Schema,
  semanticWaveEvaluationInputV3Schema,
  semanticWaveTerminalRefSchema,
  semanticWaveTerminalSchema,
  semanticWorkLeaseSchema,
  semanticWorkLeaseRefSchema,
  semanticWorkWavePlanSchema,
  semanticWorkWaveRefSchema,
  sourceBoundHypothesisArtifactRefSchema,
  sourceBoundHypothesisArtifactSchema,
  iterationActionV2Schema,
  iterationActionV3Schema,
  iterationDecisionV2Schema,
  iterationDecisionV3Schema,
  planningIncompleteDecisionSchema,
  semanticWaveAttemptOutcomeSchema,
} from "./semantic-contracts.js";

export function openExploration(
  options: OpenSemanticExplorationOptions,
): SemanticExploration;
export function openExploration(options: OpenExplorationOptions): Exploration;
export function openExploration(
  options: OpenExplorationOptions | OpenSemanticExplorationOptions,
): Exploration | SemanticExploration {
  return "surfaceMap" in options
    ? openBootstrapExploration(options)
    : openSemanticExploration(options);
}
