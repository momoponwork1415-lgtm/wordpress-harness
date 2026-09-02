import { mapDeltaReceiptSchema, surfaceMapSchema } from "./contracts.js";
export { openModelMapDeltaSynthesizer } from "./model-map-delta-synthesizer.js";
export type { OpenModelMapDeltaSynthesizerOptions } from "./model-map-delta-synthesizer.js";
import { openStaticSourceMapping } from "./static-source-mapping.js";

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
