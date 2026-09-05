import { z } from "zod";

const digestSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const identifierSchema = z
  .string()
  .min(1)
  .max(192)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
const pluginIdentitySchema = z.string().regex(/^wporg:[a-z0-9][a-z0-9-]*$/);
const versionSchema = z.string().min(1).max(64);

export const wordfenceSecretRefSchema = z.strictObject({
  kind: z.literal("secret-ref"),
  id: identifierSchema,
});

export const wordfenceIntelligenceSnapshotRefSchema = z.strictObject({
  kind: z.literal("wordfence-intelligence-snapshot-ref"),
  schemaVersion: z.literal(1),
  id: identifierSchema,
  digest: digestSchema,
});

export const wordfenceIntelligenceSnapshotSchema = z.strictObject({
  kind: z.literal("wordfence-intelligence-snapshot"),
  schemaVersion: z.literal(1),
  retrievedAt: z.string().datetime({ offset: true }),
  source: z.strictObject({
    sourceUrl: z.url(),
    contentDigest: digestSchema,
    parserVersion: z.literal("wordfence-intelligence-production-v3"),
    recordCount: z.number().int().nonnegative(),
    complete: z.literal(true),
  }),
});

export const wordfenceIntelligenceRefreshRequestSchema = z.strictObject({
  kind: z.literal("wordfence-intelligence-refresh"),
  schemaVersion: z.literal(1),
});

export const wordfenceIntelligenceInspectionRequestSchema = z.strictObject({
  kind: z.literal("wordfence-intelligence-inspection"),
  schemaVersion: z.literal(1),
  snapshotRef: wordfenceIntelligenceSnapshotRefSchema.optional(),
});

export const vulnerabilityHistoryAggregateRequestSchema = z.strictObject({
  kind: z.literal("wordfence-vulnerability-history-aggregate"),
  schemaVersion: z.literal(1),
  snapshotRef: wordfenceIntelligenceSnapshotRefSchema,
  pluginIdentity: pluginIdentitySchema,
});

export const vulnerabilityHistoryAggregateSchema = z.strictObject({
  kind: z.literal("vulnerability-history-aggregate"),
  schemaVersion: z.literal(1),
  pluginIdentity: pluginIdentitySchema,
  snapshotRef: wordfenceIntelligenceSnapshotRefSchema,
  recordCount: z.number().int().nonnegative(),
  disclosureDensity: z.strictObject({
    kind: z.literal("records-per-published-year"),
    publishedYears: z.number().int().nonnegative(),
    value: z.number().nonnegative(),
  }),
  lastPublishedAt: z.string().datetime({ offset: true }).optional(),
});

export const immutableFindingRefSchema = z.strictObject({
  id: identifierSchema,
  digest: digestSchema,
});

export const wordfenceKnownRecordInspectionRequestSchema = z.strictObject({
  kind: z.literal("wordfence-known-record-inspection"),
  schemaVersion: z.literal(1),
  snapshotRef: wordfenceIntelligenceSnapshotRefSchema,
  pluginIdentity: pluginIdentitySchema,
  verifiedVersion: versionSchema,
  verifiedFindingRef: immutableFindingRefSchema,
  purpose: z.literal("known-duplicate-disposition"),
});

const attributionPartySchema = z.strictObject({
  notice: z.string().min(1),
  license: z.string().min(1),
  licenseUrl: z.url(),
});

const affectedVersionIntervalSchema = z.strictObject({
  fromVersion: versionSchema.or(z.literal("*")),
  fromInclusive: z.boolean(),
  toVersion: versionSchema.or(z.literal("*")),
  toInclusive: z.boolean(),
});

export const wordfenceKnownRecordSchema = z.strictObject({
  recordId: z.uuid(),
  affectedVersionIntervals: z.array(affectedVersionIntervalSchema).min(1),
  patchedVersions: z.array(versionSchema),
  cwe: z
    .strictObject({
      id: z.number().int().nonnegative(),
      name: z.string().min(1),
      description: z.string().min(1),
    })
    .optional(),
  cvss: z
    .strictObject({
      vector: z.string().min(1),
      score: z.number().min(0).max(10),
      rating: z.enum(["None", "Low", "Medium", "High", "Critical"]),
    })
    .optional(),
  cve: z
    .string()
    .regex(/^CVE-[0-9]{4}-[0-9]{4,}$/)
    .optional(),
  publishedAt: z.string().datetime({ offset: true }).optional(),
  updatedAt: z.string().datetime({ offset: true }).optional(),
  attribution: z.strictObject({
    message: z.string().min(1),
    wordfence: attributionPartySchema,
    mitre: attributionPartySchema.optional(),
  }),
});

export const wordfenceStoredPluginRecordSchema = z.strictObject({
  pluginSlug: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
  record: wordfenceKnownRecordSchema,
});

export const wordfenceKnownRecordProjectionSchema = z.strictObject({
  kind: z.literal("wordfence-known-record-projection"),
  schemaVersion: z.literal(1),
  pluginIdentity: pluginIdentitySchema,
  verifiedVersion: versionSchema,
  snapshotRef: wordfenceIntelligenceSnapshotRefSchema,
  verifiedFindingRef: immutableFindingRefSchema,
  purpose: z.literal("known-duplicate-disposition"),
  records: z.array(wordfenceKnownRecordSchema),
});

export const wordfenceIntelligenceSourceResponseSchema = z.strictObject({
  status: z.number().int().min(100).max(599),
  sourceUrl: z.url(),
  complete: z.boolean(),
  bytes: z.custom<Uint8Array<ArrayBufferLike>>(
    (value) => value instanceof Uint8Array,
  ),
});

export type WordfenceSecretRef = z.infer<typeof wordfenceSecretRefSchema>;
export type WordfenceIntelligenceSnapshotRef = z.infer<
  typeof wordfenceIntelligenceSnapshotRefSchema
>;
export type WordfenceIntelligenceSnapshot = z.infer<
  typeof wordfenceIntelligenceSnapshotSchema
>;
export type WordfenceIntelligenceRefreshRequest = z.infer<
  typeof wordfenceIntelligenceRefreshRequestSchema
>;
export type WordfenceIntelligenceInspectionRequest = z.infer<
  typeof wordfenceIntelligenceInspectionRequestSchema
>;
export type VulnerabilityHistoryAggregateRequest = z.infer<
  typeof vulnerabilityHistoryAggregateRequestSchema
>;
export type VulnerabilityHistoryAggregate = z.infer<
  typeof vulnerabilityHistoryAggregateSchema
>;
export type WordfenceKnownRecordInspectionRequest = z.infer<
  typeof wordfenceKnownRecordInspectionRequestSchema
>;
export type WordfenceKnownRecord = z.infer<typeof wordfenceKnownRecordSchema>;
export type WordfenceStoredPluginRecord = z.infer<
  typeof wordfenceStoredPluginRecordSchema
>;
export type WordfenceKnownRecordProjection = z.infer<
  typeof wordfenceKnownRecordProjectionSchema
>;
export type WordfenceIntelligenceSourceResponse = z.infer<
  typeof wordfenceIntelligenceSourceResponseSchema
>;

export interface WordfenceIntelligenceSourceRequest {
  readonly credential: WordfenceSecretRef;
  readonly maximumBytes: number;
}

export interface WordfenceIntelligenceV3Adapter {
  readonly sourceUrl: string;
  retrieveProductionFeed(
    request: WordfenceIntelligenceSourceRequest,
  ): Promise<WordfenceIntelligenceSourceResponse>;
}

export type WordfenceIntelligenceFailureReason =
  | "not-refreshed"
  | "not-found"
  | "authentication-failed"
  | "rate-limited"
  | "network-failure"
  | "partial-response"
  | "schema-drift"
  | "attribution-missing";

export interface WordfenceIntelligenceFailure {
  readonly status: "failed";
  readonly reason: WordfenceIntelligenceFailureReason;
}

export interface CurrentWordfenceIntelligenceSnapshot {
  readonly status: "current";
  readonly snapshot: WordfenceIntelligenceSnapshot;
  readonly snapshotRef: WordfenceIntelligenceSnapshotRef;
}

export type WordfenceIntelligenceResult =
  CurrentWordfenceIntelligenceSnapshot | WordfenceIntelligenceFailure;

export interface WordfenceIntelligence {
  refresh(
    request: WordfenceIntelligenceRefreshRequest,
  ): Promise<WordfenceIntelligenceResult>;
  inspect(
    request: WordfenceIntelligenceInspectionRequest,
  ): Promise<WordfenceIntelligenceResult>;
  aggregate(
    request: VulnerabilityHistoryAggregateRequest,
  ): Promise<VulnerabilityHistoryAggregate>;
  inspectKnownRecords(
    request: WordfenceKnownRecordInspectionRequest,
  ): Promise<WordfenceKnownRecordProjection>;
}

export interface OpenWordfenceIntelligenceOptions {
  readonly databasePath: string;
  readonly artifactDirectory: string;
  readonly adapter: WordfenceIntelligenceV3Adapter;
  readonly credential: WordfenceSecretRef;
  readonly maximumFeedBytes?: number;
  readonly clock?: () => Date;
}

export interface WordfenceIntelligenceV3FetchAdapterOptions {
  readonly credentialResolver: (
    reference: WordfenceSecretRef,
  ) => Promise<string> | string;
  readonly fetch?: typeof fetch;
  readonly sourceUrl?: string;
}
