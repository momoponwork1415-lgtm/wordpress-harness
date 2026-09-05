import { mapDeltaReceiptSchema, surfaceMapSchema } from "./contracts.js";
export { openModelMapDeltaSynthesizer } from "./model-map-delta-synthesizer.js";
export type { OpenModelMapDeltaSynthesizerOptions } from "./model-map-delta-synthesizer.js";
import { openStaticSourceMapping } from "./static-source-mapping.js";

export { openSourceEvidenceGateway } from "./source-evidence-gateway.js";
export type { OpenSourceEvidenceGatewayOptions } from "./source-evidence-gateway.js";
export {
  sourceEvidenceQuerySchema,
  sourceEvidenceQueryV1Schema,
  sourceEvidenceQueryV2Schema,
  sourceEvidenceReceiptRefSchema,
  sourceEvidenceReceiptRefV2Schema,
  sourceEvidenceReceiptValueSchema,
  sourceEvidenceReceiptValueV2Schema,
  sourceEvidenceResultV2Schema,
  sourceEvidenceResponseSchema,
  sourceListQueryV2Schema,
  sourceListResponseV2Schema,
  sourceListSelectorSchema,
  sourceReadQueryV2Schema,
  sourceReadResponseV2Schema,
  sourceReadSelectorV2Schema,
  sourceRangeResponseSchema,
  sourceSearchQueryV2Schema,
  sourceSearchResponseV2Schema,
  sourceSearchSelectorV2Schema,
  sourceSearchResponseSchema,
  sourceToolPolicyRefSchema,
  sourceToolPolicySchema,
} from "./source-evidence-contracts.js";
export type {
  SourceEvidenceGateway,
  SourceEvidenceQuery,
  SourceEvidenceQueryV1,
  SourceEvidenceQueryV2,
  SourceEvidenceReceipt,
  SourceEvidenceReceiptV2,
  SourceEvidenceReceiptRef,
  SourceEvidenceReceiptRefV2,
  SourceEvidenceReceiptValue,
  SourceEvidenceReceiptValueV2,
  SourceEvidenceResultV2,
  SourceEvidenceResponse,
  SourceEvidenceToolRequest,
  SourceEvidenceToolRequestV2,
  SourceEvidencePolicyDecisionV2,
  SourceRangeResponse,
  SourceListResponseV2,
  SourceReadResponseV2,
  SourceSearchResponse,
  SourceSearchResponseV2,
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
