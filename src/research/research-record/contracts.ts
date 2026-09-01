import type { NewCampaignInput } from "../contracts.js";

export interface PreparationRecord {
  readonly campaignId: string;
  readonly ledgerHead: number;
  readonly occurredAt: string;
  readonly inputDigest: string;
  readonly input: NewCampaignInput;
}

export interface RecordPreparationResult {
  readonly disposition: "appended" | "occupied";
  readonly requestedInputDigest: string;
  readonly preparation: PreparationRecord;
}

export interface ResearchRecord {
  recordPreparation(input: NewCampaignInput): Promise<RecordPreparationResult>;
  readPreparation(campaignId: string): Promise<PreparationRecord | undefined>;
  close(): void;
}

export interface OpenResearchRecordOptions {
  readonly databasePath: string;
  readonly clock?: () => Date;
}

export interface JsonArtifactStore {
  putJson(value: unknown): Promise<string>;
  readJson(digest: string): Promise<unknown>;
}
