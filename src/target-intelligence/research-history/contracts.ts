import { z } from "zod";

const digestSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const identifierSchema = z
  .string()
  .min(1)
  .max(160)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
const pluginIdentitySchema = z
  .string()
  .regex(
    /^(?:wporg:[a-z0-9][a-z0-9-]*|premium:[a-z0-9][a-z0-9-]*\/[a-z0-9][a-z0-9-]*)$/,
  );
const versionSchema = z.string().min(1).max(64);

const historyEntrySchema = z.strictObject({
  pluginIdentity: pluginIdentitySchema,
  version: versionSchema,
});

const targetResearchHistorySnapshotBodySchema = z.strictObject({
  kind: z.literal("target-research-history-snapshot"),
  schemaVersion: z.literal(1),
  id: identifierSchema,
  generatedAt: z.iso.datetime(),
  historyEntries: z.array(historyEntrySchema),
});

export const targetResearchHistorySnapshotSchema =
  targetResearchHistorySnapshotBodySchema.extend({ digest: digestSchema });

export const targetResearchHistorySnapshotRefSchema = z.strictObject({
  kind: z.literal("target-research-history-snapshot-ref"),
  schemaVersion: z.literal(1),
  id: identifierSchema,
  digest: digestSchema,
  historyEntries: z.number().int().nonnegative(),
});

export const targetResearchHistoryQuerySchema = z.strictObject({
  snapshotId: identifierSchema,
  pluginIdentity: pluginIdentitySchema,
  version: versionSchema,
});

const historySummarySchema = z.strictObject({
  observed: z.boolean(),
});

export const targetResearchHistoryViewSchema = z.strictObject({
  kind: z.literal("target-research-history-view"),
  schemaVersion: z.literal(1),
  snapshotRef: targetResearchHistorySnapshotRefSchema,
  pluginIdentity: pluginIdentitySchema,
  version: versionSchema,
  sameVersion: historySummarySchema,
  priorVersions: z.array(versionSchema),
});

export interface TargetResearchHistories {
  inspect(
    query: TargetResearchHistoryQuery,
  ): Promise<TargetResearchHistoryView>;
}

export interface OpenTargetResearchHistoriesOptions {
  readonly storageDirectory: string;
}

export type TargetResearchHistoryQuery = z.infer<
  typeof targetResearchHistoryQuerySchema
>;
export type TargetResearchHistorySnapshot = z.infer<
  typeof targetResearchHistorySnapshotSchema
>;
export type TargetResearchHistorySnapshotRef = z.infer<
  typeof targetResearchHistorySnapshotRefSchema
>;
export type TargetResearchHistoryView = z.infer<
  typeof targetResearchHistoryViewSchema
>;
