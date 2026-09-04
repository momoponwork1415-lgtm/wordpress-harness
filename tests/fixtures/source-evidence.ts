import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { sha256Digest } from "../../src/research/research-record/canonical-json.js";
import {
  openFileJsonArtifactStore,
  type JsonArtifactStore,
} from "../../src/research/research-record/index.js";
import {
  openSourceEvidenceGateway,
  type SourceEvidenceGateway,
  type SourceToolPolicy,
  type TargetFileManifest,
} from "../../src/research/source-mapping/index.js";

export const sourceEvidenceTargetDigest = `sha256:${"a".repeat(64)}`;

export function sourceFileDigest(content: string): string {
  return `sha256:${createHash("sha256").update(content).digest("hex")}`;
}

export interface SourceEvidenceFixture {
  readonly artifactDirectory: string;
  readonly sourceDirectory: string;
  readonly attemptArtifactDirectory: string;
  readonly artifacts: JsonArtifactStore;
  readonly gateway: SourceEvidenceGateway;
  readonly manifest: TargetFileManifest;
  readonly policy: SourceToolPolicy;
  fileDigest(path: string): string;
  close(): Promise<void>;
}

export async function openSourceEvidenceFixture(options: {
  readonly files: Readonly<Record<string, string>>;
  readonly maxReadBytes?: number;
  readonly search?: {
    readonly maxScanBytes: number;
    readonly maxResults: number;
  };
  readonly inventoryMaxResults?: number;
}): Promise<SourceEvidenceFixture> {
  const directory = await mkdtemp(join(tmpdir(), "source-evidence-fixture-"));
  const sourceDirectory = join(directory, "target");
  await Promise.all(
    Object.entries(options.files).map(async ([path, content]) => {
      const destination = join(sourceDirectory, path);
      await mkdir(dirname(destination), { recursive: true });
      await writeFile(destination, content);
    }),
  );
  const manifest: TargetFileManifest = {
    kind: "target-file-manifest",
    schemaVersion: 1,
    targetSnapshot: {
      id: "synthetic-plugin-1.0.0",
      digest: sourceEvidenceTargetDigest,
    },
    entries: Object.entries(options.files).map(([path, content]) => ({
      path,
      digest: sourceFileDigest(content),
      size: Buffer.byteLength(content),
    })),
  };
  const policy: SourceToolPolicy = {
    kind: "source-tool-policy",
    schemaVersion: 1,
    id: "finder-source-evidence-v1",
    targetSnapshotDigest: sourceEvidenceTargetDigest,
    operations: {
      read: { maxResponseBytes: options.maxReadBytes ?? 4096 },
      ...(options.inventoryMaxResults === undefined
        ? {}
        : { inventory: { maxResults: options.inventoryMaxResults } }),
      ...(options.search === undefined ? {} : { search: options.search }),
    },
  };
  const artifactDirectory = join(directory, "artifacts");
  const artifacts = openFileJsonArtifactStore(artifactDirectory);
  const gateway = openSourceEvidenceGateway({
    sourceDirectory,
    artifactStore: artifacts,
    manifest: {
      ref: {
        kind: "target-file-manifest",
        schemaVersion: 1,
        targetSnapshotId: manifest.targetSnapshot.id,
        targetSnapshotDigest: manifest.targetSnapshot.digest,
        digest: sha256Digest(manifest),
      },
      value: manifest,
    },
    policy: {
      ref: {
        kind: "source-tool-policy",
        schemaVersion: 1,
        id: policy.id,
        digest: sha256Digest(policy),
      },
      value: policy,
    },
  });
  return {
    artifactDirectory,
    sourceDirectory,
    attemptArtifactDirectory: join(directory, "attempts"),
    artifacts,
    gateway,
    manifest,
    policy,
    fileDigest: (path) => {
      const entry = manifest.entries.find(
        (candidate) => candidate.path === path,
      );
      if (entry === undefined)
        throw new Error(`Fixture path not found: ${path}`);
      return entry.digest;
    },
    close: () => rm(directory, { force: true, recursive: true }),
  };
}
