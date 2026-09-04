import { openCampaignControl } from "./campaign-control/index.js";
import type { OpenResearchOptions, ResearchModule } from "./contracts.js";
import { openSqliteResearchRecord } from "./research-record/index.js";

export function openResearch(options: OpenResearchOptions): ResearchModule {
  return openResearchWithLegacyMapFirst(options, false);
}

function openResearchWithLegacyMapFirst(
  options: OpenResearchOptions,
  allowLegacyMapFirstExecution: boolean,
): ResearchModule {
  const artifactStore =
    options.artifactStore ?? options.campaignExecution?.artifactStore;
  const record = openSqliteResearchRecord({
    databasePath: options.databasePath,
    ...(options.clock === undefined ? {} : { clock: options.clock }),
    ...(artifactStore === undefined ? {} : { artifactStore }),
  });
  const campaign = openCampaignControl(
    record,
    options.campaignExecution,
    artifactStore,
    allowLegacyMapFirstExecution,
  );
  return {
    runner: campaign.runner,
    reader: campaign.reader,
    close: () => record.close(),
  };
}

/** Internal compatibility harness for behavior tests of archived v1 ledgers. */
export function openLegacyMapFirstResearchForTests(
  options: OpenResearchOptions,
): ResearchModule {
  return openResearchWithLegacyMapFirst(options, true);
}
