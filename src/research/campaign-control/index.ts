import {
  CampaignPreparationConflictError,
  newCampaignInputSchema,
  type CampaignReader,
  type CampaignRunner,
  type CampaignView,
  type SubjectView,
} from "../contracts.js";
import type {
  PreparationRecord,
  ResearchRecord,
} from "../research-record/index.js";

export interface CampaignControl {
  readonly runner: CampaignRunner;
  readonly reader: CampaignReader;
}

function projectCampaign(preparation: PreparationRecord): CampaignView {
  return {
    campaignId: preparation.campaignId,
    status: "prepared",
    ledgerHead: preparation.ledgerHead,
    preparedAt: preparation.occurredAt,
    inputDigest: preparation.inputDigest,
    targetSnapshot: preparation.input.targetSnapshot,
  };
}

export function openCampaignControl(record: ResearchRecord): CampaignControl {
  return {
    runner: {
      prepare: async (input) => {
        const parsedInput = newCampaignInputSchema.parse(input);
        const result = await record.recordPreparation(parsedInput);
        if (
          result.disposition === "occupied" &&
          result.preparation.inputDigest !== result.requestedInputDigest
        ) {
          throw new CampaignPreparationConflictError(parsedInput.campaignId);
        }
        return projectCampaign(result.preparation);
      },
    },
    reader: {
      read: async (campaignId) => {
        const preparation = await record.readPreparation(campaignId);
        if (preparation === undefined) {
          throw new Error(`Campaign not found: ${campaignId}`);
        }
        return projectCampaign(preparation);
      },
      inspect: async (campaignId, subject): Promise<SubjectView> => {
        const preparation = await record.readPreparation(campaignId);
        if (preparation === undefined) {
          throw new Error(`Campaign not found: ${campaignId}`);
        }
        return {
          kind: subject.kind,
          campaignId,
          preparedAt: preparation.occurredAt,
          inputDigest: preparation.inputDigest,
          input: preparation.input,
        };
      },
    },
  };
}
