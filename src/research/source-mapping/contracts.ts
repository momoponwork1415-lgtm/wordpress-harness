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
  revisionKind: z.enum(["initial", "source"]),
  targetSnapshotId: identifierSchema,
  mappingProfileId: identifierSchema,
  digest: digestSchema,
  summary: surfaceMapSummarySchema,
});

const contextResponseRefSchema = z.strictObject({
  kind: z.literal("context-response"),
  schemaVersion: z.literal(1),
  id: identifierSchema,
  digest: digestSchema,
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

const sourceAnchorSchema = z.strictObject({
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
    kind: z.literal("storage"),
    category: z.literal("option"),
    operation: z.enum(["get_option", "update_option"]),
    access: z.enum(["read", "write"]),
  }),
  z.strictObject({
    kind: z.literal("html-output"),
    operation: z.literal("echo"),
  }),
]);

const surfaceNodeSchema = z.strictObject({
  id: digestSchema,
  kind: z.enum(["symbol", "entry", "guard", "source", "state", "sink"]),
  subject: surfaceSubjectSchema,
  evidence: evidenceStateSchema,
});

const surfaceRelationSchema = z.strictObject({
  id: digestSchema,
  kind: z.literal("dispatches-to"),
  from: digestSchema,
  to: digestSchema.nullable(),
  claim: z.enum(["literal-callback", "callback-target"]),
  evidence: evidenceStateSchema,
});

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

const mappingGapSchema = z.strictObject({
  id: digestSchema,
  kind: z.enum(["asset-not-analyzed", "parse-diagnostic"]),
  path: relativePathSchema,
  reason: z.string().min(1),
  classification: assetClassificationSchema,
  evidence: sourceAnchorSchema.optional(),
});

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
  }),
  inventory: z.array(inventoryEntrySchema),
  nodes: z.array(surfaceNodeSchema),
  relations: z.array(surfaceRelationSchema),
  gaps: z.array(mappingGapSchema),
  summary: surfaceMapSummarySchema,
});

export type MappingProfileRef = z.infer<typeof mappingProfileRefSchema>;
export type SurfaceMap = z.infer<typeof surfaceMapSchema>;
export type SurfaceMapRef = z.infer<typeof surfaceMapRefSchema>;
export type SurfaceMappingInput = z.infer<typeof surfaceMappingInputSchema>;
export type SurfaceMappingSource = z.infer<typeof surfaceMappingSourceSchema>;
export type TargetFileManifest = z.infer<typeof targetFileManifestSchema>;
export type TargetFileManifestRef = z.infer<typeof targetFileManifestRefSchema>;

export interface SourceMapping {
  build(input: SurfaceMappingInput): Promise<SurfaceMapRef>;
}

export interface OpenSourceMappingOptions {
  readonly artifactDirectory: string;
  readonly source: SurfaceMappingSource;
}
