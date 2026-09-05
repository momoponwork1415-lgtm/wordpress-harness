export {
  legacyTargetResearchHistoryArtifactSchema,
  targetResearchAdmissionRequestSchema,
  targetResearchCampaignDefinitionSchema,
  targetResearchHistoryRecordInputSchema,
  targetResearchIdentitySchema,
  targetResearchProgressRefSchema,
} from "./contracts.js";
export type {
  AlreadyCoveredTargetResearchAdmission,
  FollowUpRequiredTargetResearchAdmission,
  NewTargetResearchAdmission,
  OpenTargetResearchHistoryOptions,
  ProvenanceConflictTargetResearchAdmission,
  RecordTargetResearchHistoryResult,
  ResumeTargetResearchAdmission,
  TargetResearchAdmission,
  TargetResearchAdmissionRequest,
  TargetResearchCampaign,
  TargetResearchCampaignDefinition,
  TargetResearchHistory,
  TargetResearchHistoryRecord,
  TargetResearchHistoryRecordInput,
  TargetResearchIdentity,
  TargetResearchLegacyHistoryArtifact,
} from "./contracts.js";
export { openTargetResearchHistory } from "./sqlite-target-research-history.js";
