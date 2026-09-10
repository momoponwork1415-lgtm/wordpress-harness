import {
  campaignThreatContextSchema,
  dependencySnapshotsSchema,
  programmeResearchBoundarySchema,
  researchCampaignPolicySchema,
  type CampaignOutcomeRef,
  type ResearchCampaignPolicy,
  type ResearchCampaigns,
} from "../../research/index.js";
import { z } from "zod";
import { targetIntakePacketSchema } from "../acquisition/contracts.js";
import { approvedTargetBatchSchema } from "../approved-target-batch/contracts.js";
import { targetObservationSchema } from "../target-proposal/contracts.js";

const identifierSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);

export const approvedTargetCampaignRequestSchema = z.strictObject({
  kind: z.literal("approved-target-campaign-request"),
  schemaVersion: z.literal(1),
  approvedBatch: approvedTargetBatchSchema,
  candidateId: identifierSchema,
  checkedAt: z.iso.datetime(),
  targetObservation: targetObservationSchema,
  targetIntake: targetIntakePacketSchema,
  campaignId: identifierSchema,
  campaignPolicy: researchCampaignPolicySchema,
  dependencySnapshots: dependencySnapshotsSchema,
  threatContext: campaignThreatContextSchema,
  programmeBoundary: programmeResearchBoundarySchema,
});

export interface ApprovedTargetCampaigns {
  conduct(request: ApprovedTargetCampaignRequest): Promise<CampaignOutcomeRef>;
}

export interface OpenApprovedTargetCampaignsOptions {
  readonly campaigns: Pick<ResearchCampaigns, "conduct">;
}

export type { ResearchCampaignPolicy };
export type ApprovedTargetCampaignRequest = z.infer<
  typeof approvedTargetCampaignRequestSchema
>;
