import { surfaceMapSchema } from "./contracts.js";
import { openStaticSourceMapping } from "./static-source-mapping.js";

export type {
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
