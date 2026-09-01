import { openCampaignControl } from "./campaign-control/index.js";
import type { OpenResearchOptions, ResearchModule } from "./contracts.js";
import { openSqliteResearchRecord } from "./research-record/index.js";

export function openResearch(options: OpenResearchOptions): ResearchModule {
  const record = openSqliteResearchRecord(options);
  const campaign = openCampaignControl(record);
  return {
    runner: campaign.runner,
    reader: campaign.reader,
    close: () => record.close(),
  };
}
