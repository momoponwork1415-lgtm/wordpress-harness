import { z } from "zod";

import { readyIntakeDispositionSchema } from "../target-intelligence/acquisition/contracts.js";
import type {
  CampaignExecutionDependencies,
  AnyCampaignRunPlan,
  AnyCampaignRunRecord,
  AnyCampaignRunRecordRef,
} from "./campaign-control/contracts.js";
import {
  canonicalFileManifestSchema,
  normalizedRelativePathSchema,
  type CanonicalFileManifest,
} from "./source-file-contracts.js";
import type { TargetFileManifestRef } from "./source-mapping/contracts.js";
import type { JsonArtifactStore } from "./research-record/contracts.js";
import type { FindingMechanismGroups } from "./verification/contracts.js";

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

export const targetSnapshotRefSchema = z.strictObject({
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

const campaignConfigurationShape = {
  campaignId: identifierSchema,
  campaignPolicy: immutableRefSchema,
  runtimeProfile: immutableRefSchema,
  promptSet: immutableRefSchema,
  modelProfiles: z.array(immutableRefSchema).min(1),
  knowledgeCapsules: z.array(immutableRefSchema),
  experimentRegistry: immutableRefSchema,
  budget: campaignBudgetSchema,
};

const newCampaignInputShape = {
  ...campaignConfigurationShape,
  targetSnapshot: targetSnapshotRefSchema,
};

export const newCampaignInputV1Schema = z.strictObject(newCampaignInputShape);

export const newCampaignInputV2Schema = z.strictObject({
  schemaVersion: z.literal(2),
  ...newCampaignInputShape,
  canonicalFileManifest: canonicalFileManifestSchema,
});

export const targetIntakeBindingSchema = z.strictObject({
  packet: immutableRefSchema,
  receipt: immutableRefSchema,
  pluginIdentity: z.string().min(1),
  canonicalInstallDirectory: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
  mainPluginFile: normalizedRelativePathSchema,
  pluginBasename: normalizedRelativePathSchema,
  sourceTreeDigest: digestSchema,
});

export const newCampaignInputV3Schema = z.strictObject({
  schemaVersion: z.literal(3),
  ...newCampaignInputShape,
  canonicalFileManifest: canonicalFileManifestSchema,
  targetIntake: targetIntakeBindingSchema,
});

export const targetIntakeCampaignPreparationInputSchema = z.strictObject({
  kind: z.literal("target-intake-campaign-preparation"),
  schemaVersion: z.literal(1),
  ...campaignConfigurationShape,
  intake: readyIntakeDispositionSchema,
});

export const newCampaignInputSchema = z.union([
  newCampaignInputV3Schema,
  newCampaignInputV2Schema,
  newCampaignInputV1Schema,
]);

export function decodeNewCampaignInput(value: unknown): NewCampaignInput {
  return newCampaignInputSchema.parse(value);
}

export type NewCampaignInput = z.infer<typeof newCampaignInputSchema>;
export type NewCampaignInputV1 = z.infer<typeof newCampaignInputV1Schema>;
export type NewCampaignInputV2 = z.infer<typeof newCampaignInputV2Schema>;
export type NewCampaignInputV3 = z.infer<typeof newCampaignInputV3Schema>;
export type TargetIntakeBinding = z.infer<typeof targetIntakeBindingSchema>;
export type TargetIntakeCampaignPreparationInput = z.infer<
  typeof targetIntakeCampaignPreparationInputSchema
>;
export type { CanonicalFileManifest };
export type TargetSnapshotRef = z.infer<typeof targetSnapshotRefSchema>;

export interface CampaignView {
  readonly campaignId: string;
  readonly status: "prepared";
  readonly ledgerHead: number;
  readonly preparedAt: string;
  readonly inputDigest: string;
  readonly targetSnapshot: TargetSnapshotRef;
  readonly targetFileManifest?: TargetFileManifestRef;
}

export type PreparedCampaign = CampaignView;

export interface CampaignRunner {
  prepare(input: NewCampaignInput): Promise<PreparedCampaign>;
  prepareFromTargetIntake(
    input: TargetIntakeCampaignPreparationInput,
  ): Promise<PreparedCampaign>;
  run(plan: AnyCampaignRunPlan): Promise<AnyCampaignRunRecordRef>;
}

export interface CampaignReader {
  read(campaignId: string): Promise<CampaignView>;
  inspect(campaignId: string, subject: SubjectRef): Promise<SubjectView>;
}

export interface PreparationSubjectRef {
  readonly kind: "preparation";
}

export interface CampaignRunSubjectRef {
  readonly kind: "run";
  readonly runId: string;
}

export interface FindingMechanismGroupsSubjectRef {
  readonly kind: "finding-mechanism-groups";
  readonly runId: string;
}

export type SubjectRef =
  | PreparationSubjectRef
  | CampaignRunSubjectRef
  | FindingMechanismGroupsSubjectRef;

export interface PreparationSubjectView {
  readonly kind: "preparation";
  readonly campaignId: string;
  readonly preparedAt: string;
  readonly inputDigest: string;
  readonly input: NewCampaignInput;
  readonly targetFileManifest?: TargetFileManifestRef;
}

export interface CampaignRunSubjectView {
  readonly kind: "run";
  readonly campaignId: string;
  readonly runId: string;
  readonly occurredAt: string;
  readonly value: AnyCampaignRunRecord;
}

export type FindingMechanismGroupsSubjectView = FindingMechanismGroups;

export type SubjectView =
  | PreparationSubjectView
  | CampaignRunSubjectView
  | FindingMechanismGroupsSubjectView;

export interface ResearchModule {
  readonly runner: CampaignRunner;
  readonly reader: CampaignReader;
  close(): void;
}

export interface OpenResearchOptions {
  readonly databasePath: string;
  readonly clock?: () => Date;
  readonly artifactStore?: JsonArtifactStore;
  readonly campaignExecution?: CampaignExecutionDependencies;
}

export class CampaignPreparationIntegrityError extends Error {
  readonly reason: "artifact-store-unavailable";

  constructor(reason: "artifact-store-unavailable") {
    super(`Campaign preparation integrity check failed: ${reason}`);
    this.name = "CampaignPreparationIntegrityError";
    this.reason = reason;
  }
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
    | "invalid-event-order"
    | "verification-plan-digest-mismatch"
    | "verification-record-digest-mismatch"
    | "campaign-run-plan-digest-mismatch"
    | "campaign-run-record-digest-mismatch"
    | "target-file-manifest-binding-mismatch";

  constructor(
    campaignId: string,
    reason:
      | "input-digest-mismatch"
      | "campaign-id-mismatch"
      | "non-contiguous-sequence"
      | "invalid-event-order"
      | "verification-plan-digest-mismatch"
      | "verification-record-digest-mismatch"
      | "campaign-run-plan-digest-mismatch"
      | "campaign-run-record-digest-mismatch"
      | "target-file-manifest-binding-mismatch",
  ) {
    super(`Ledger integrity check failed: ${campaignId} (${reason})`);
    this.name = "LedgerIntegrityError";
    this.campaignId = campaignId;
    this.reason = reason;
  }
}
