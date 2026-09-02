import { z } from "zod";

import { sourceAnchorSchema } from "./contracts.js";

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

export const sourceEvidenceQuerySchema = z.union([
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
  request: sourceEvidenceQuerySchema,
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

export type SourceToolPolicy = z.infer<typeof sourceToolPolicySchema>;
export type SourceToolPolicyRef = z.infer<typeof sourceToolPolicyRefSchema>;
export type SourceEvidenceQuery = z.infer<typeof sourceEvidenceQuerySchema>;
export type SearchSnapshotQuery = z.infer<typeof searchSnapshotQuerySchema>;
export type ListSnapshotFilesQuery = z.infer<
  typeof listSnapshotFilesQuerySchema
>;
export type SourceEvidenceToolRequest = SourceEvidenceQuery extends infer Query
  ? Query extends SourceEvidenceQuery
    ? Omit<
        Query,
        "attemptId" | "leaseId" | "targetSnapshot" | "policy" | "budget"
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

export interface SourceEvidenceReceipt {
  readonly ref: SourceEvidenceReceiptRef;
  readonly value: SourceEvidenceReceiptValue;
  readonly response: SourceEvidenceResponse | null;
}

export interface SourceEvidenceGateway {
  readonly policy: SourceToolPolicyRef;
  query(request: SourceEvidenceQuery): Promise<SourceEvidenceReceipt>;
}
