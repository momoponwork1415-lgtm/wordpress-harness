import { z } from "zod";

const identifierSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);

const digestSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);

const immutableRefSchema = z.strictObject({
  id: identifierSchema,
  digest: digestSchema,
});

const targetSnapshotRefSchema = z.strictObject({
  id: identifierSchema,
  pluginSlug: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
  version: z.string().min(1).max(64),
  digest: digestSchema,
});

const campaignBudgetSchema = z.strictObject({
  maxAttempts: z.number().int().positive(),
  maxWallTimeMs: z.number().int().positive(),
  maxModelTokens: z.number().int().positive(),
});

export const newCampaignInputSchema = z.strictObject({
  campaignId: identifierSchema,
  targetSnapshot: targetSnapshotRefSchema,
  campaignPolicy: immutableRefSchema,
  runtimeProfile: immutableRefSchema,
  promptSet: immutableRefSchema,
  modelProfiles: z.array(immutableRefSchema).min(1),
  knowledgeCapsules: z.array(immutableRefSchema),
  experimentRegistry: immutableRefSchema,
  budget: campaignBudgetSchema,
});

export function decodeNewCampaignInput(value: unknown): NewCampaignInput {
  return newCampaignInputSchema.parse(value);
}

export type NewCampaignInput = z.infer<typeof newCampaignInputSchema>;
export type TargetSnapshotRef = z.infer<typeof targetSnapshotRefSchema>;

export interface CampaignView {
  readonly campaignId: string;
  readonly status: "prepared";
  readonly ledgerHead: number;
  readonly preparedAt: string;
  readonly inputDigest: string;
  readonly targetSnapshot: TargetSnapshotRef;
}

export type PreparedCampaign = CampaignView;

export interface CampaignRunner {
  prepare(input: NewCampaignInput): Promise<PreparedCampaign>;
}

export interface CampaignReader {
  read(campaignId: string): Promise<CampaignView>;
  inspect(
    campaignId: string,
    subject: SubjectRef,
  ): Promise<SubjectView>;
}

export interface PreparationSubjectRef {
  readonly kind: "preparation";
}

export type SubjectRef = PreparationSubjectRef;

export interface PreparationSubjectView {
  readonly kind: "preparation";
  readonly campaignId: string;
  readonly preparedAt: string;
  readonly inputDigest: string;
  readonly input: NewCampaignInput;
}

export type SubjectView = PreparationSubjectView;

export interface ResearchModule {
  readonly runner: CampaignRunner;
  readonly reader: CampaignReader;
  close(): void;
}

export interface OpenResearchOptions {
  readonly databasePath: string;
  readonly clock?: () => Date;
}

export class CampaignPreparationConflictError extends Error {
  readonly campaignId: string;

  constructor(campaignId: string) {
    super(`Campaign already prepared with different input: ${campaignId}`);
    this.name = "CampaignPreparationConflictError";
    this.campaignId = campaignId;
  }
}

export class UnsupportedLedgerSchemaError extends Error {
  readonly eventKind: string;
  readonly schemaVersion: number;

  constructor(eventKind: string, schemaVersion: number) {
    super(`Unsupported Ledger schema: ${eventKind}@${schemaVersion}`);
    this.name = "UnsupportedLedgerSchemaError";
    this.eventKind = eventKind;
    this.schemaVersion = schemaVersion;
  }
}

export class LedgerIntegrityError extends Error {
  readonly campaignId: string;
  readonly reason:
    | "input-digest-mismatch"
    | "campaign-id-mismatch"
    | "non-contiguous-sequence"
    | "invalid-event-order";

  constructor(
    campaignId: string,
    reason:
      | "input-digest-mismatch"
      | "campaign-id-mismatch"
      | "non-contiguous-sequence"
      | "invalid-event-order",
  ) {
    super(`Ledger integrity check failed: ${campaignId} (${reason})`);
    this.name = "LedgerIntegrityError";
    this.campaignId = campaignId;
    this.reason = reason;
  }
}
