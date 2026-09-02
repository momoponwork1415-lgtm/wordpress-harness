import { mapDeltaReceiptSchema, surfaceMapSchema } from "./contracts.js";
export { openModelMapDeltaSynthesizer } from "./model-map-delta-synthesizer.js";
export type { OpenModelMapDeltaSynthesizerOptions } from "./model-map-delta-synthesizer.js";
import { openStaticSourceMapping } from "./static-source-mapping.js";

export { openSourceEvidenceGateway } from "./source-evidence-gateway.js";
export type { OpenSourceEvidenceGatewayOptions } from "./source-evidence-gateway.js";
export {
  sourceEvidenceQuerySchema,
  sourceEvidenceReceiptRefSchema,
  sourceEvidenceReceiptValueSchema,
  sourceEvidenceResponseSchema,
  sourceRangeResponseSchema,
  sourceSearchResponseSchema,
  sourceToolPolicyRefSchema,
  sourceToolPolicySchema,
} from "./source-evidence-contracts.js";
export type {
  SourceEvidenceGateway,
  SourceEvidenceQuery,
  SourceEvidenceReceipt,
  SourceEvidenceReceiptRef,
  SourceEvidenceReceiptValue,
  SourceEvidenceResponse,
  SourceEvidenceToolRequest,
  SourceRangeResponse,
  SourceSearchResponse,
  SourceToolPolicy,
  SourceToolPolicyRef,
} from "./source-evidence-contracts.js";

export type {
  ContextResponse,
  ContextResponseRef,
  MapDeltaProposal,
  MapDeltaReceipt,
  MapDeltaSynthesisFailure,
  MapDeltaSynthesizer,
  MappingProfileRef,
  OpenSourceMappingOptions,
  SourceMapping,
  SurfaceMap,
  SurfaceMapRef,
  SurfaceMappingInput,
  SurfaceMappingSource,
  TargetFileManifest,
  TargetFileManifestRef,
} from "./contracts.js";

export const openSourceMapping = openStaticSourceMapping;

export function decodeSurfaceMap(value: unknown) {
  return surfaceMapSchema.parse(value);
}

export function decodeMapDeltaReceipt(value: unknown) {
  return mapDeltaReceiptSchema.parse(value);
}
