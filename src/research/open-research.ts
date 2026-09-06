import type { CampaignExecutionDependencies } from "./campaign-control/contracts.js";
import {
  openCampaignControl,
  openLegacyCampaignControlForTests,
} from "./campaign-control/index.js";
import type { OpenResearchOptions, ResearchModule } from "./contracts.js";
import {
  openSqliteResearchRecord,
  openSqliteResearchStores,
} from "./research-record/index.js";

export function openResearch(options: OpenResearchOptions): ResearchModule {
  const artifactStore =
    options.artifactStore ?? options.campaignExecution?.artifactStore;
  const stores = openSqliteResearchStores({
    databasePath: options.databasePath,
    ...(options.clock === undefined ? {} : { clock: options.clock }),
    ...(artifactStore === undefined ? {} : { artifactStore }),
  });
  const campaign = openCampaignControl(
    stores.current,
    stores.replay,
    options.campaignExecution,
    artifactStore,
  );
  return {
    runner: campaign.runner,
    reader: campaign.reader,
    close: stores.close,
  };
}

interface OpenLegacyResearchOptions extends Omit<
  OpenResearchOptions,
  "campaignExecution"
> {
  readonly campaignExecution?: CampaignExecutionDependencies;
}

/** Internal compatibility harness for behavior tests that create legacy ledgers. */
export function openLegacyResearchForTests(
  options: OpenLegacyResearchOptions,
): ResearchModule {
  const artifactStore =
    options.artifactStore ?? options.campaignExecution?.artifactStore;
  const record = openSqliteResearchRecord({
    databasePath: options.databasePath,
    ...(options.clock === undefined ? {} : { clock: options.clock }),
    ...(artifactStore === undefined ? {} : { artifactStore }),
  });
  const campaign = openLegacyCampaignControlForTests(
    record,
    options.campaignExecution,
    artifactStore,
  );
  return {
    runner: campaign.runner,
    reader: campaign.reader,
    close: () => record.close(),
  };
}

/** Backward-compatible name for archived Map-first test fixtures. */
export function openLegacyMapFirstResearchForTests(
  options: OpenLegacyResearchOptions,
): ResearchModule {
  return openLegacyResearchForTests(options);
}
