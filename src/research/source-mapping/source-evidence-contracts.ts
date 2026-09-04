import { z } from "zod";

import {
  sourceAnchorSchema,
  targetFileManifestRefSchema,
} from "./contracts.js";

const digestSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const identifierSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
const sourceRequestPathSchema = z.string().min(1).max(4096);

export const sourceToolPolicySchema = z.strictObject({
  kind: z.literal("source-tool-policy"),
  schemaVersion: z.literal(1),
  id: identifierSchema,
  targetSnapshotDigest: digestSchema,
  operations: z.strictObject({
    read: z.strictObject({
      maxResponseBytes: z.number().int().positive(),
    }),
    inventory: z
      .strictObject({
        maxResults: z.number().int().positive(),
      })
      .optional(),
    search: z
      .strictObject({
        maxScanBytes: z.number().int().positive(),
        maxResults: z.number().int().positive(),
      })
      .optional(),
  }),
});

export const sourceToolPolicyRefSchema = z.strictObject({
  kind: z.literal("source-tool-policy"),
  schemaVersion: z.literal(1),
  id: identifierSchema,
  digest: digestSchema,
});

const sourceEvidenceQueryFields = {
  schemaVersion: z.literal(1),
  attemptId: identifierSchema,
  leaseId: digestSchema,
  targetSnapshot: z.strictObject({
    id: identifierSchema,
    digest: digestSchema,
  }),
  policy: sourceToolPolicyRefSchema,
  budget: z
    .strictObject({
      maxQueries: z.number().int().positive(),
      queryOrdinal: z.number().int().positive(),
    })
    .optional(),
  desiredRelation: z.enum([
    "definition",
    "usage",
    "caller",
    "callee",
    "wrapper",
    "guard",
    "state",
    "source-range",
    "inventory",
  ]),
  reason: z.string().min(1).max(1024),
} as const;

const readSourceRangeQuerySchema = z
  .strictObject({
    kind: z.literal("read-source-range"),
    ...sourceEvidenceQueryFields,
    subject: z.strictObject({
      path: sourceRequestPathSchema,
      fileDigest: digestSchema,
      startLine: z.number().int().positive(),
      endLine: z.number().int().positive(),
    }),
  })
  .refine((query) => query.subject.endLine >= query.subject.startLine, {
    message: "Source range end must not precede its start",
    path: ["subject", "endLine"],
  });

export const searchSnapshotQuerySchema = z.strictObject({
  kind: z.literal("search-snapshot"),
  ...sourceEvidenceQueryFields,
  subject: z.strictObject({
    literal: z
      .string()
      .min(1)
      .max(256)
      .refine((literal) => !literal.includes("\n") && !literal.includes("\r"), {
        message: "Search literal must occupy one source line",
      }),
    scope: z.discriminatedUnion("kind", [
      z.strictObject({ kind: z.literal("snapshot") }),
      z.strictObject({
        kind: z.literal("paths"),
        paths: z.array(sourceRequestPathSchema).min(1),
      }),
    ]),
  }),
});

export const listSnapshotFilesQuerySchema = z.strictObject({
  kind: z.literal("list-snapshot-files"),
  ...sourceEvidenceQueryFields,
  subject: z.strictObject({
    prefix: sourceRequestPathSchema.optional(),
  }),
});

export const sourceEvidenceQueryV1Schema = z.union([
  readSourceRangeQuerySchema,
  searchSnapshotQuerySchema,
  listSnapshotFilesQuerySchema,
]);

export const sourceRangeResponseSchema = z.strictObject({
  kind: z.literal("source-range-response"),
  schemaVersion: z.literal(1),
  anchor: sourceAnchorSchema,
  bytes: z.number().int().nonnegative(),
  content: z.string(),
});

export const sourceSearchResponseSchema = z.strictObject({
  kind: z.literal("source-search-response"),
  schemaVersion: z.literal(1),
  literal: z.string().min(1),
  scope: searchSnapshotQuerySchema.shape.subject.shape.scope,
  scanned: z.strictObject({
    files: z.number().int().nonnegative(),
    bytes: z.number().int().nonnegative(),
  }),
  matches: z.array(
    z.strictObject({
      anchor: sourceAnchorSchema,
    }),
  ),
});

export const sourceInventoryResponseSchema = z.strictObject({
  kind: z.literal("source-inventory-response"),
  schemaVersion: z.literal(1),
  prefix: sourceRequestPathSchema.optional(),
  files: z.array(
    z.strictObject({
      path: sourceRequestPathSchema,
      fileDigest: digestSchema,
      size: z.number().int().nonnegative(),
    }),
  ),
});

export const sourceEvidenceResponseSchema = z.union([
  sourceRangeResponseSchema,
  sourceSearchResponseSchema,
  sourceInventoryResponseSchema,
]);

const policyDecisionSchema = z.discriminatedUnion("outcome", [
  z.strictObject({
    outcome: z.literal("allowed"),
    reason: z.enum(["read-allowed", "search-allowed", "inventory-allowed"]),
  }),
  z.strictObject({
    outcome: z.literal("denied"),
    reason: z.enum([
      "snapshot-mismatch",
      "policy-mismatch",
      "operation-not-allowed",
      "path-outside-snapshot",
      "file-digest-mismatch",
      "query-budget-exhausted",
    ]),
  }),
]);

const sourceEvidenceResultSchema = z.discriminatedUnion("status", [
  z.strictObject({
    status: z.literal("completed"),
    responseDigest: digestSchema,
  }),
  z.strictObject({
    status: z.literal("truncated"),
    responseDigest: digestSchema,
  }),
  z.strictObject({
    status: z.literal("not-found"),
    reason: z.enum(["start-line-out-of-range", "literal-not-found"]),
    responseDigest: digestSchema.optional(),
  }),
  z.strictObject({
    status: z.literal("policy-denied"),
    reason: policyDecisionSchema.options[1].shape.reason,
  }),
  z.strictObject({
    status: z.literal("budget-exhausted"),
    reason: z.literal("source-query-limit-exceeded"),
  }),
]);

export const sourceEvidenceReceiptValueSchema = z.strictObject({
  kind: z.literal("source-evidence-receipt"),
  schemaVersion: z.literal(1),
  attemptId: identifierSchema,
  leaseId: digestSchema,
  targetSnapshot: z.strictObject({
    id: identifierSchema,
    digest: digestSchema,
  }),
  queryDigest: digestSchema,
  request: sourceEvidenceQueryV1Schema,
  policyDecision: policyDecisionSchema,
  result: sourceEvidenceResultSchema,
});

export const sourceEvidenceReceiptRefSchema = z.strictObject({
  kind: z.literal("source-evidence-receipt"),
  schemaVersion: z.literal(1),
  attemptId: identifierSchema,
  leaseId: digestSchema,
  queryDigest: digestSchema,
  digest: digestSchema,
});

const finderSourceEvidenceAssignmentSchema = z.strictObject({
  kind: z.literal("research-thesis"),
  schemaVersion: z.literal(1),
  workWaveId: digestSchema,
  leaseId: digestSchema,
  thesis: z.strictObject({
    kind: z.literal("research-thesis"),
    schemaVersion: z.literal(1),
    id: digestSchema,
    digest: digestSchema,
    targetSnapshotDigest: digestSchema,
    manifestDigest: digestSchema,
  }),
});

const missingLinkSourceEvidenceAssignmentSchema = z.strictObject({
  kind: z.literal("frontier-gap"),
  schemaVersion: z.literal(1),
  workWaveId: digestSchema,
  leaseId: digestSchema,
  gapId: digestSchema,
  predecessorDecisionDigest: digestSchema,
});

const reconSourceEvidenceAssignmentSchema = z.strictObject({
  kind: z.literal("initial-research-planning"),
  schemaVersion: z.literal(1),
  metadata: z.strictObject({
    kind: z.literal("oracle-free-target-metadata"),
    schemaVersion: z.literal(1),
    pluginIdentity: z.string().min(1).max(256),
    mainPluginFile: z.string().min(1).max(4096),
    canonicalInstallDirectory: z.string().min(1).max(256),
  }),
  maxTargetSpecificTheses: z.number().int().min(0).max(3),
  minWildcardTheses: z.number().int().min(0).max(4),
  maxLeases: z.number().int().min(0).max(3),
});

const criticSourceEvidenceAssignmentSchema = z.strictObject({
  kind: z.literal("chain-critique"),
  schemaVersion: z.literal(1),
  synthesisDigest: digestSchema,
  proposalIds: z.array(digestSchema).min(1).max(32),
});

export const sourceEvidenceAssignmentSchema = z.discriminatedUnion("kind", [
  finderSourceEvidenceAssignmentSchema,
  missingLinkSourceEvidenceAssignmentSchema,
  reconSourceEvidenceAssignmentSchema,
  criticSourceEvidenceAssignmentSchema,
]);

const sourceEvidenceQueryV2Fields = {
  schemaVersion: z.literal(2),
  attemptId: identifierSchema,
  assignment: sourceEvidenceAssignmentSchema,
  targetSnapshot: z.strictObject({
    id: identifierSchema,
    digest: digestSchema,
  }),
  manifest: targetFileManifestRefSchema,
  policy: sourceToolPolicyRefSchema,
  queryOrdinal: z.number().int().positive(),
  budget: z.strictObject({
    maxQueries: z.number().int().positive(),
  }),
  reason: z.string().min(1).max(1024),
} as const;

export const sourceListSelectorSchema = z.strictObject({
  scope: z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("root") }),
    z.strictObject({
      kind: z.literal("directory"),
      path: z.string().min(1).max(4096),
    }),
  ]),
  traversal: z.enum(["children", "recursive"]),
});

export const sourceListQueryV2Schema = z.strictObject({
  kind: z.literal("source-list"),
  ...sourceEvidenceQueryV2Fields,
  selector: sourceListSelectorSchema.optional(),
  cursor: z.string().min(1).max(16_384).optional(),
});

const sourceSearchScopeV2Schema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("root") }),
  z.strictObject({
    kind: z.literal("directory"),
    path: z.string().min(1).max(4096),
  }),
  z.strictObject({
    kind: z.literal("files"),
    paths: z.array(z.string().min(1).max(4096)).min(1),
  }),
]);

export const sourceSearchSelectorV2Schema = z.strictObject({
  literal: z
    .string()
    .min(1)
    .max(256)
    .refine((literal) => !literal.includes("\n") && !literal.includes("\r"), {
      message: "Search literal must occupy one source line",
    }),
  scope: sourceSearchScopeV2Schema,
});

export const sourceSearchQueryV2Schema = z.strictObject({
  kind: z.literal("source-search"),
  ...sourceEvidenceQueryV2Fields,
  selector: sourceSearchSelectorV2Schema.optional(),
  cursor: z.string().min(1).max(16_384).optional(),
});

export const sourceReadSelectorV2Schema = z
  .strictObject({
    path: z.string().min(1).max(4096),
    fileDigest: digestSchema,
    startLine: z.number().int().positive(),
    endLine: z.number().int().positive(),
  })
  .refine((selector) => selector.endLine >= selector.startLine, {
    message: "Source range end must not precede its start",
    path: ["endLine"],
  });

export const sourceReadQueryV2Schema = z.strictObject({
  kind: z.literal("source-read"),
  ...sourceEvidenceQueryV2Fields,
  selector: sourceReadSelectorV2Schema.optional(),
  cursor: z.string().min(1).max(16_384).optional(),
});

export const sourceEvidenceQueryV2Schema = z.discriminatedUnion("kind", [
  sourceListQueryV2Schema,
  sourceSearchQueryV2Schema,
  sourceReadQueryV2Schema,
]);

export const sourceEvidenceQuerySchema = z.union([
  sourceEvidenceQueryV2Schema,
  sourceEvidenceQueryV1Schema,
]);

const sourceListEntrySchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("directory"),
    path: sourceRequestPathSchema,
  }),
  z.strictObject({
    kind: z.literal("file"),
    path: sourceRequestPathSchema,
    fileDigest: digestSchema,
    size: z.number().int().nonnegative(),
  }),
]);

export const sourceListResponseV2Schema = z.strictObject({
  kind: z.literal("source-list-response"),
  schemaVersion: z.literal(2),
  scope: sourceListSelectorSchema.shape.scope,
  traversal: sourceListSelectorSchema.shape.traversal,
  entries: z.array(sourceListEntrySchema),
  nextCursor: z.string().min(1).max(16_384).optional(),
});

export const sourceSearchResponseV2Schema = z.strictObject({
  kind: z.literal("source-search-response"),
  schemaVersion: z.literal(2),
  literal: sourceSearchSelectorV2Schema.shape.literal,
  scope: sourceSearchScopeV2Schema,
  scanned: z.strictObject({
    files: z.number().int().nonnegative(),
    bytes: z.number().int().nonnegative(),
  }),
  matches: z.array(z.strictObject({ anchor: sourceAnchorSchema })),
  nextCursor: z.string().min(1).max(16_384).optional(),
});

export const sourceReadResponseV2Schema = z.strictObject({
  kind: z.literal("source-read-response"),
  schemaVersion: z.literal(2),
  anchor: sourceAnchorSchema,
  bytes: z.number().int().nonnegative(),
  content: z.string(),
  nextCursor: z.string().min(1).max(16_384).optional(),
});

const sourceEvidencePolicyDecisionV2Schema = z.discriminatedUnion("outcome", [
  z.strictObject({
    outcome: z.literal("allowed"),
    reason: z.enum(["list-allowed", "search-allowed", "read-allowed"]),
  }),
  z.strictObject({
    outcome: z.literal("denied"),
    reason: z.enum([
      "snapshot-mismatch",
      "manifest-mismatch",
      "policy-mismatch",
      "operation-not-allowed",
      "path-outside-snapshot",
      "query-budget-exhausted",
    ]),
  }),
  z.strictObject({
    outcome: z.literal("not-evaluated"),
    reason: z.literal("invalid-query"),
  }),
]);

export const sourceEvidenceResultV2Schema = z.discriminatedUnion("status", [
  z.strictObject({
    status: z.literal("completed"),
    responseDigest: digestSchema,
  }),
  z.strictObject({
    status: z.literal("partial"),
    reason: z.enum(["page-limit", "scan-limit", "response-limit"]),
    responseDigest: digestSchema,
    continuationDigest: digestSchema,
  }),
  z.strictObject({
    status: z.literal("not-found"),
    reason: z.enum([
      "directory-not-found",
      "file-not-found",
      "range-not-found",
      "literal-not-found",
    ]),
    responseDigest: digestSchema.optional(),
  }),
  z.strictObject({
    status: z.literal("invalid-query"),
    reason: z.enum([
      "invalid-path",
      "selector-cursor-conflict",
      "selector-or-cursor-required",
      "invalid-cursor",
      "assignment-mismatch",
    ]),
  }),
  z.strictObject({
    status: z.literal("policy-denied"),
    reason: sourceEvidencePolicyDecisionV2Schema.options[1].shape.reason,
  }),
  z.strictObject({
    status: z.literal("identity-mismatch"),
    reason: z.enum(["file-digest-mismatch", "source-bytes-mismatch"]),
  }),
  z.strictObject({
    status: z.literal("budget-exhausted"),
    reason: z.literal("source-query-limit-exceeded"),
  }),
]);

export const sourceEvidenceReceiptValueV2Schema = z.strictObject({
  kind: z.literal("source-evidence-receipt"),
  schemaVersion: z.literal(2),
  attemptId: identifierSchema,
  assignment: sourceEvidenceAssignmentSchema,
  targetSnapshot: sourceEvidenceQueryV2Fields.targetSnapshot,
  manifest: targetFileManifestRefSchema,
  policy: sourceToolPolicyRefSchema,
  queryOrdinal: z.number().int().positive(),
  queryDigest: digestSchema,
  operation: z.enum(["list", "search", "read"]),
  policyDecision: sourceEvidencePolicyDecisionV2Schema,
  usage: z.strictObject({
    files: z.number().int().nonnegative(),
    bytes: z.number().int().nonnegative(),
    matches: z.number().int().nonnegative(),
  }),
  result: sourceEvidenceResultV2Schema,
});

export const sourceEvidenceReceiptRefV2Schema = z.strictObject({
  kind: z.literal("source-evidence-receipt"),
  schemaVersion: z.literal(2),
  attemptId: identifierSchema,
  assignmentDigest: digestSchema,
  manifestDigest: digestSchema,
  queryDigest: digestSchema,
  digest: digestSchema,
});

export type SourceToolPolicy = z.infer<typeof sourceToolPolicySchema>;
export type SourceToolPolicyRef = z.infer<typeof sourceToolPolicyRefSchema>;
export type SourceEvidenceQueryV1 = z.infer<typeof sourceEvidenceQueryV1Schema>;
export type SourceEvidenceQueryV2 = z.infer<typeof sourceEvidenceQueryV2Schema>;
export type SourceEvidenceQuery = z.infer<typeof sourceEvidenceQuerySchema>;
export type SearchSnapshotQuery = z.infer<typeof searchSnapshotQuerySchema>;
export type ListSnapshotFilesQuery = z.infer<
  typeof listSnapshotFilesQuerySchema
>;
export type SourceEvidenceToolRequest =
  SourceEvidenceQueryV1 extends infer Query
    ? Query extends SourceEvidenceQueryV1
      ? Omit<
          Query,
          "attemptId" | "leaseId" | "targetSnapshot" | "policy" | "budget"
        >
      : never
    : never;
export type SourceEvidenceToolRequestV2 =
  SourceEvidenceQueryV2 extends infer Query
    ? Query extends SourceEvidenceQueryV2
      ? Omit<
          Query,
          | "schemaVersion"
          | "attemptId"
          | "assignment"
          | "targetSnapshot"
          | "manifest"
          | "policy"
          | "queryOrdinal"
          | "budget"
        >
      : never
    : never;
export type SourceRangeResponse = z.infer<typeof sourceRangeResponseSchema>;
export type SourceSearchResponse = z.infer<typeof sourceSearchResponseSchema>;
export type SourceInventoryResponse = z.infer<
  typeof sourceInventoryResponseSchema
>;
export type SourceEvidenceResponse = z.infer<
  typeof sourceEvidenceResponseSchema
>;
export type SourceEvidencePolicyDecision = z.infer<typeof policyDecisionSchema>;
export type SourceEvidenceResult = z.infer<typeof sourceEvidenceResultSchema>;
export type SourceEvidenceReceiptValue = z.infer<
  typeof sourceEvidenceReceiptValueSchema
>;
export type SourceEvidenceReceiptRef = z.infer<
  typeof sourceEvidenceReceiptRefSchema
>;
export type SourceEvidenceReceiptValueV2 = z.infer<
  typeof sourceEvidenceReceiptValueV2Schema
>;
export type SourceEvidenceReceiptRefV2 = z.infer<
  typeof sourceEvidenceReceiptRefV2Schema
>;
export type SourceEvidenceResultV2 = z.infer<
  typeof sourceEvidenceResultV2Schema
>;
export type SourceEvidencePolicyDecisionV2 = z.infer<
  typeof sourceEvidencePolicyDecisionV2Schema
>;
export type SourceListResponseV2 = z.infer<typeof sourceListResponseV2Schema>;
export type SourceSearchResponseV2 = z.infer<
  typeof sourceSearchResponseV2Schema
>;
export type SourceReadResponseV2 = z.infer<typeof sourceReadResponseV2Schema>;

export interface SourceEvidenceReceiptV2 {
  readonly ref: SourceEvidenceReceiptRefV2;
  readonly value: SourceEvidenceReceiptValueV2;
  readonly response:
    SourceListResponseV2 | SourceSearchResponseV2 | SourceReadResponseV2 | null;
}

export interface SourceEvidenceReceipt {
  readonly ref: SourceEvidenceReceiptRef;
  readonly value: SourceEvidenceReceiptValue;
  readonly response: SourceEvidenceResponse | null;
}

export interface SourceEvidenceGateway {
  readonly policy: SourceToolPolicyRef;
  query(request: SourceEvidenceQueryV1): Promise<SourceEvidenceReceipt>;
  query(request: SourceEvidenceQueryV2): Promise<SourceEvidenceReceiptV2>;
}
