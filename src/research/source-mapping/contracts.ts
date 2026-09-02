import { z } from "zod";

import { targetSnapshotRefSchema } from "../contracts.js";
import { phpProgramIndexRefSchema } from "./php-program-index/index.js";

const digestSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const identifierSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
const relativePathSchema = z
  .string()
  .min(1)
  .refine(
    (path) =>
      !path.startsWith("/") &&
      !path.includes("\\") &&
      !path.split("/").includes(".."),
    { message: "File path must be a normalized relative path" },
  );

export const targetFileManifestSchema = z.strictObject({
  kind: z.literal("target-file-manifest"),
  schemaVersion: z.literal(1),
  targetSnapshot: z.strictObject({
    id: identifierSchema,
    digest: digestSchema,
  }),
  entries: z.array(
    z.strictObject({
      path: relativePathSchema,
      digest: digestSchema,
      size: z.number().int().nonnegative(),
    }),
  ),
});

export const targetFileManifestRefSchema = z.strictObject({
  kind: z.literal("target-file-manifest"),
  schemaVersion: z.literal(1),
  targetSnapshotId: identifierSchema,
  targetSnapshotDigest: digestSchema,
  digest: digestSchema,
});

export const mappingProfileRefSchema = z.strictObject({
  kind: z.literal("mapping-profile"),
  schemaVersion: z.literal(1),
  id: identifierSchema,
  digest: digestSchema,
  phpAnalysisProfileId: identifierSchema,
  assetPolicy: z.literal("wordpress-plugin-static-v1"),
});

export const surfaceMappingSourceSchema = z.strictObject({
  target: targetSnapshotRefSchema,
  manifest: targetFileManifestRefSchema,
  phpProgramIndex: phpProgramIndexRefSchema,
});

const surfaceMapSummarySchema = z.strictObject({
  files: z.number().int().nonnegative(),
  nodes: z.number().int().nonnegative(),
  relations: z.number().int().nonnegative(),
  gaps: z.number().int().nonnegative(),
});

export const surfaceMapRefSchema = z.strictObject({
  kind: z.literal("surface-map"),
  schemaVersion: z.literal(1),
  revisionKind: z.enum(["initial", "source", "model"]),
  targetSnapshotId: identifierSchema,
  mappingProfileId: identifierSchema,
  digest: digestSchema,
  summary: surfaceMapSummarySchema,
});

export const contextResponseRefSchema = z.strictObject({
  kind: z.literal("context-response"),
  schemaVersion: z.literal(1),
  id: identifierSchema,
  digest: digestSchema,
});

export const contextResponseSchema = z.strictObject({
  kind: z.literal("context-response"),
  schemaVersion: z.literal(1),
  id: identifierSchema,
  targetSnapshot: z.strictObject({
    id: identifierSchema,
    digest: digestSchema,
  }),
  slices: z
    .array(
      z.strictObject({
        path: relativePathSchema,
        fileDigest: digestSchema,
        startOffset: z.number().int().nonnegative(),
        endOffset: z.number().int().positive(),
        content: z.string(),
      }),
    )
    .min(1),
});

export const surfaceMappingInputSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("initial"),
    target: targetSnapshotRefSchema,
    profile: mappingProfileRefSchema,
  }),
  z.strictObject({
    kind: z.literal("revision"),
    predecessor: surfaceMapRefSchema,
    acceptedContext: z.array(contextResponseRefSchema),
    profile: mappingProfileRefSchema,
  }),
]);

export const sourceAnchorSchema = z.strictObject({
  kind: z.literal("source-anchor"),
  targetSnapshotDigest: digestSchema,
  path: relativePathSchema,
  fileDigest: digestSchema,
  startLine: z.number().int().positive(),
  endLine: z.number().int().positive(),
  startOffset: z.number().int().nonnegative(),
  endOffset: z.number().int().nonnegative(),
});

const evidenceStateSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("observed"),
    evidence: z.array(sourceAnchorSchema).min(1),
  }),
  z.strictObject({
    kind: z.literal("inferred"),
    premises: z.array(digestSchema).min(1),
    derivation: z.enum(["deterministic", "knowledge", "model"]),
    proposalDigest: digestSchema.optional(),
  }),
  z.strictObject({
    kind: z.literal("unknown"),
    candidates: z.array(digestSchema),
    reason: z.string().min(1),
    requiredEvidence: z.array(z.string().min(1)).min(1),
  }),
]);

const surfaceSubjectSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("symbol"),
    symbolKind: z.enum([
      "class",
      "interface",
      "trait",
      "enum",
      "function",
      "method",
    ]),
    name: z.string().min(1),
  }),
  z.strictObject({
    kind: z.literal("hook"),
    hook: z.string().nullable(),
    callback: z.string().nullable(),
  }),
  z.strictObject({
    kind: z.literal("rest-route"),
    namespace: z.string().nullable(),
    route: z.string().nullable(),
    callback: z.string().nullable(),
    permissionCallback: z.string().nullable(),
  }),
  z.strictObject({
    kind: z.literal("guard"),
    category: z.literal("authorization"),
    operation: z.literal("current_user_can"),
  }),
  z.strictObject({
    kind: z.literal("request-parameter"),
    operation: z.literal("get_param"),
  }),
  z.strictObject({
    kind: z.literal("request-superglobal"),
    operation: z.enum(["_GET", "_POST", "_REQUEST", "_COOKIE", "_FILES"]),
  }),
  z.strictObject({
    kind: z.literal("storage"),
    category: z.literal("option"),
    operation: z.enum(["get_option", "update_option"]),
    access: z.enum(["read", "write"]),
  }),
  z.strictObject({
    kind: z.literal("html-output"),
    operation: z.literal("echo"),
  }),
  z.strictObject({
    kind: z.literal("database-query"),
    operation: z.enum([
      "query",
      "get_var",
      "get_row",
      "get_col",
      "get_results",
    ]),
  }),
  z.strictObject({
    kind: z.literal("filesystem-write"),
    operation: z.literal("file_put_contents"),
  }),
  z.strictObject({
    kind: z.literal("code-execution"),
    operation: z.enum([
      "eval",
      "include",
      "include_once",
      "require",
      "require_once",
    ]),
  }),
  z.strictObject({
    kind: z.literal("process-execution"),
    operation: z.enum([
      "exec",
      "system",
      "passthru",
      "shell_exec",
      "popen",
      "proc_open",
      "pcntl_exec",
    ]),
  }),
]);

const surfaceNodeSchema = z.strictObject({
  id: digestSchema,
  kind: z.enum(["symbol", "entry", "guard", "source", "state", "sink"]),
  subject: surfaceSubjectSchema,
  evidence: evidenceStateSchema,
});

const surfaceRelationSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    id: digestSchema,
    kind: z.literal("dispatches-to"),
    from: digestSchema,
    to: digestSchema.nullable(),
    claim: z.enum(["literal-callback", "callback-target"]),
    evidence: evidenceStateSchema,
  }),
  z.strictObject({
    id: digestSchema,
    kind: z.literal("flows-to"),
    from: digestSchema,
    to: digestSchema,
    claim: z.enum(["data-flow", "control-flow", "state-flow", "render-flow"]),
    evidence: evidenceStateSchema,
  }),
]);

const mapDeltaAnchorSchema = z.strictObject({
  path: relativePathSchema,
  fileDigest: digestSchema,
  startOffset: z.number().int().nonnegative(),
  endOffset: z.number().int().positive(),
});

export const mapDeltaProposalSchema = z.strictObject({
  kind: z.literal("map-delta-proposal"),
  schemaVersion: z.literal(1),
  predecessor: surfaceMapRefSchema,
  mappingProfile: mappingProfileRefSchema,
  contextResponseDigests: z.array(digestSchema),
  relations: z
    .array(
      z.strictObject({
        kind: z.literal("flows-to"),
        from: digestSchema,
        to: digestSchema,
        claim: z.enum([
          "data-flow",
          "control-flow",
          "state-flow",
          "render-flow",
        ]),
        premises: z.array(digestSchema).min(2).max(16),
        anchors: z.array(mapDeltaAnchorSchema).min(1).max(16),
        rationale: z.string().min(1).max(4096),
      }),
    )
    .max(128),
});

export const mapDeltaSynthesisFailureSchema = z.strictObject({
  kind: z.literal("map-delta-synthesis-failure"),
  schemaVersion: z.literal(1),
  reason: z.enum([
    "auth-required",
    "provider-failed",
    "budget-exhausted",
    "invalid-output",
    "policy-denied",
    "context-ceiling",
  ]),
});

const mapDeltaReceiptIdentitySchema = {
  kind: z.literal("map-delta-receipt"),
  schemaVersion: z.literal(1),
  predecessor: surfaceMapRefSchema,
  mappingProfile: mappingProfileRefSchema,
  contextResponseDigests: z.array(digestSchema),
};

const acceptedMapDeltaClaimSchema = z.array(
  z.strictObject({
    proposalIndex: z.number().int().nonnegative(),
    relationId: digestSchema,
  }),
);

const rejectedMapDeltaClaimSchema = z.array(
  z.strictObject({
    proposalIndex: z.number().int().nonnegative(),
    reason: z.enum([
      "endpoint-not-found",
      "premise-not-found",
      "anchor-not-in-context",
    ]),
  }),
);

export const mapDeltaReceiptSchema = z.discriminatedUnion("status", [
  z.strictObject({
    ...mapDeltaReceiptIdentitySchema,
    status: z.literal("compiled"),
    proposalDigest: digestSchema,
    accepted: acceptedMapDeltaClaimSchema,
    rejected: rejectedMapDeltaClaimSchema,
  }),
  z.strictObject({
    ...mapDeltaReceiptIdentitySchema,
    status: z.literal("failed"),
    failureReason: mapDeltaSynthesisFailureSchema.shape.reason,
    accepted: z.tuple([]),
    rejected: z.tuple([]),
  }),
]);

const assetClassificationSchema = z.enum([
  "php",
  "javascript",
  "template",
  "sql",
  "configuration",
  "translation",
  "bundled-vendor",
  "minified",
  "binary",
  "unsupported",
]);

const coverageSchema = z.discriminatedUnion("status", [
  z.strictObject({ status: z.literal("indexed") }),
  z.strictObject({
    status: z.literal("gap"),
    reason: z.enum(["php-index-missing", "unsupported-initial-static-slice"]),
  }),
]);

const inventoryEntrySchema = z.strictObject({
  path: relativePathSchema,
  digest: digestSchema,
  size: z.number().int().nonnegative(),
  classification: assetClassificationSchema,
  coverage: coverageSchema,
});

const mappingGapSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    id: digestSchema,
    kind: z.literal("asset-not-analyzed"),
    path: relativePathSchema,
    reason: z.string().min(1),
    classification: assetClassificationSchema,
    evidence: sourceAnchorSchema.optional(),
  }),
  z.strictObject({
    id: digestSchema,
    kind: z.literal("parse-diagnostic"),
    path: relativePathSchema,
    reason: z.string().min(1),
    classification: assetClassificationSchema,
    evidence: sourceAnchorSchema.optional(),
  }),
  z.strictObject({
    id: digestSchema,
    kind: z.literal("mapping-incomplete"),
    scope: z.literal("surface-map"),
    path: relativePathSchema,
    reason: mapDeltaSynthesisFailureSchema.shape.reason,
    evidence: sourceAnchorSchema.optional(),
  }),
]);

export const surfaceMapSchema = z.strictObject({
  kind: z.literal("surface-map"),
  schemaVersion: z.literal(1),
  revision: z.discriminatedUnion("kind", [
    z.strictObject({
      kind: z.literal("initial"),
      number: z.literal(1),
      predecessor: z.null(),
    }),
    z.strictObject({
      kind: z.literal("source"),
      number: z.number().int().min(2),
      predecessor: surfaceMapRefSchema,
    }),
    z.strictObject({
      kind: z.literal("model"),
      number: z.number().int().min(2),
      predecessor: surfaceMapRefSchema,
      mapDeltaReceiptDigest: digestSchema,
    }),
  ]),
  targetSnapshot: z.strictObject({
    id: identifierSchema,
    digest: digestSchema,
  }),
  mappingProfile: z.strictObject({
    id: identifierSchema,
    digest: digestSchema,
  }),
  sources: z.strictObject({
    manifestDigest: digestSchema,
    phpProgramIndexDigest: digestSchema,
    mapDeltaReceiptDigests: z.array(digestSchema).optional(),
  }),
  inventory: z.array(inventoryEntrySchema),
  nodes: z.array(surfaceNodeSchema),
  relations: z.array(surfaceRelationSchema),
  gaps: z.array(mappingGapSchema),
  summary: surfaceMapSummarySchema,
});

export type MappingProfileRef = z.infer<typeof mappingProfileRefSchema>;
export type ContextResponse = z.infer<typeof contextResponseSchema>;
export type ContextResponseRef = z.infer<typeof contextResponseRefSchema>;
export type MapDeltaProposal = z.infer<typeof mapDeltaProposalSchema>;
export type MapDeltaReceipt = z.infer<typeof mapDeltaReceiptSchema>;
export type MapDeltaSynthesisFailure = z.infer<
  typeof mapDeltaSynthesisFailureSchema
>;
export type SurfaceMap = z.infer<typeof surfaceMapSchema>;
export type SurfaceMapRef = z.infer<typeof surfaceMapRefSchema>;
export type SurfaceMappingInput = z.infer<typeof surfaceMappingInputSchema>;
export type SurfaceMappingSource = z.infer<typeof surfaceMappingSourceSchema>;
export type TargetFileManifest = z.infer<typeof targetFileManifestSchema>;
export type TargetFileManifestRef = z.infer<typeof targetFileManifestRefSchema>;

export interface SourceMapping {
  build(input: SurfaceMappingInput): Promise<SurfaceMapRef>;
}

export interface MapDeltaSynthesisRequest {
  readonly predecessorRef: SurfaceMapRef;
  readonly predecessor: SurfaceMap;
  readonly profile: MappingProfileRef;
  readonly context: readonly {
    readonly digest: string;
    readonly value: ContextResponse;
  }[];
}

export interface MapDeltaSynthesizer {
  synthesize(request: MapDeltaSynthesisRequest): Promise<unknown>;
}

export interface OpenSourceMappingOptions {
  readonly artifactDirectory: string;
  readonly source: SurfaceMappingSource;
  readonly synthesizer?: MapDeltaSynthesizer;
}
