import type {
  NewCampaignInputV2,
  NewCampaignInputV3,
  TargetSnapshotRef,
} from "../contracts.js";
import { sha256Digest } from "../research-record/canonical-json.js";
import type { JsonArtifactStore } from "../research-record/contracts.js";
import {
  targetFileManifestSchema,
  type TargetFileManifest,
  type TargetFileManifestRef,
} from "./contracts.js";

export class TargetFileManifestIntegrityError extends Error {
  readonly reason:
    | "artifact-digest-mismatch"
    | "artifact-content-invalid"
    | "target-binding-mismatch";

  constructor(
    reason:
      | "artifact-digest-mismatch"
      | "artifact-content-invalid"
      | "target-binding-mismatch",
  ) {
    super(`Target File Manifest integrity check failed: ${reason}`);
    this.name = "TargetFileManifestIntegrityError";
    this.reason = reason;
  }
}

export function projectTargetFileManifest(
  targetSnapshot: TargetSnapshotRef,
  canonical: (NewCampaignInputV2 | NewCampaignInputV3)["canonicalFileManifest"],
): TargetFileManifest {
  return targetFileManifestSchema.parse({
    kind: "target-file-manifest",
    schemaVersion: 1,
    targetSnapshot: {
      id: targetSnapshot.id,
      digest: targetSnapshot.digest,
    },
    entries: canonical.entries,
  });
}

export async function persistTargetFileManifest(
  artifactStore: JsonArtifactStore,
  input: NewCampaignInputV2 | NewCampaignInputV3,
): Promise<TargetFileManifestRef> {
  const manifest = projectTargetFileManifest(
    input.targetSnapshot,
    input.canonicalFileManifest,
  );
  const expectedDigest = sha256Digest(manifest);
  const storedDigest = await artifactStore.putJson(manifest);
  if (storedDigest !== expectedDigest) {
    throw new TargetFileManifestIntegrityError("artifact-digest-mismatch");
  }

  let storedManifest: TargetFileManifest;
  try {
    storedManifest = targetFileManifestSchema.parse(
      await artifactStore.readJson(storedDigest),
    );
  } catch (error: unknown) {
    if (error instanceof TargetFileManifestIntegrityError) throw error;
    throw new TargetFileManifestIntegrityError("artifact-content-invalid");
  }
  if (
    storedManifest.targetSnapshot.id !== input.targetSnapshot.id ||
    storedManifest.targetSnapshot.digest !== input.targetSnapshot.digest
  ) {
    throw new TargetFileManifestIntegrityError("target-binding-mismatch");
  }
  if (sha256Digest(storedManifest) !== storedDigest) {
    throw new TargetFileManifestIntegrityError("artifact-digest-mismatch");
  }

  return {
    kind: "target-file-manifest",
    schemaVersion: 1,
    targetSnapshotId: input.targetSnapshot.id,
    targetSnapshotDigest: input.targetSnapshot.digest,
    digest: storedDigest,
  };
}
