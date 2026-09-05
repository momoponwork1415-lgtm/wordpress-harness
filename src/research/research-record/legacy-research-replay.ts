import type { CampaignProgressView } from "../campaign-progress-contracts.js";
import type { AnyCampaignRunRecordView } from "../campaign-control/contracts.js";
import type { VerificationRecordView } from "../verification/contracts.js";
import type { PreparationRecord } from "./contracts.js";

/** Read-only projection seam for current and archived Ledger generations. */
export interface LegacyResearchReplay {
  readPreparation(campaignId: string): Promise<PreparationRecord | undefined>;
  readCampaignRun(
    campaignId: string,
    runId: string,
  ): Promise<AnyCampaignRunRecordView | undefined>;
  readVerification(
    campaignId: string,
    verificationId: string,
  ): Promise<VerificationRecordView | undefined>;
  readCampaignProgress(
    campaignId: string,
  ): Promise<CampaignProgressView | undefined>;
}
