import { createHash } from "node:crypto";
import { cp, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";

import { canonicalDigest } from "../../infrastructure/canonical-json.js";
import { measureCanonicalSourceTree } from "../../infrastructure/canonical-source-tree.js";
import {
  PrivateArtifactStore,
  type PrivateArtifactStaging,
} from "../../infrastructure/private-artifact-store.js";
import type { AgentCheckpointRef, SealedNativeRun } from "./contracts.js";

const checkpointLimits = {
  maxEntries: 20_000,
  maxBytes: 128 * 1024 * 1024,
} as const;

export interface ResearchWorkingState {
  readonly root: string;
  readonly contentDirectory: string;
  readonly artifactStaging: PrivateArtifactStaging;
  readonly providerHome: string;
  readonly scratchDirectory: string;
  readonly sessionId: string;
}

function deterministicSessionId(campaignInputDigest: string): string {
  const bytes = createHash("sha256")
    .update("wordpress-harness:research-session:")
    .update(campaignInputDigest)
    .digest();
  const versionByte = bytes[6];
  const variantByte = bytes[8];
  if (versionByte === undefined || variantByte === undefined) {
    throw new Error("Unable to derive Agent session identity");
  }
  bytes[6] = (versionByte & 0x0f) | 0x40;
  bytes[8] = (variantByte & 0x3f) | 0x80;
  const hex = bytes.subarray(0, 16).toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function checkpointMatchesRun(
  checkpoint: AgentCheckpointRef,
  run: SealedNativeRun,
): boolean {
  const dependencySnapshots = run.dependencySnapshots ?? [];
  const dependencySnapshotsDigest =
    dependencySnapshots.length === 0
      ? undefined
      : canonicalDigest(dependencySnapshots);
  return (
    checkpoint.targetSnapshotDigest === run.targetSnapshot.digest &&
    checkpoint.promptSetDigest === run.promptSet.digest &&
    checkpoint.runtimeProfileDigest === run.agentRuntimeProfile.digest &&
    checkpoint.permissionProfileDigest === run.permissionProfile.digest &&
    checkpoint.dependencySnapshotsDigest === dependencySnapshotsDigest &&
    checkpoint.threatContextDigest === run.threatContext?.digest &&
    checkpoint.programmeBoundaryDigest === run.programmeBoundary?.digest
  );
}

export async function prepareResearchState(
  run: SealedNativeRun,
  scratchRootDirectory: string,
): Promise<ResearchWorkingState> {
  const checkpointRoot = join(scratchRootDirectory, "agent-checkpoints");
  const artifacts = new PrivateArtifactStore({
    rootDirectory: checkpointRoot,
    ...checkpointLimits,
  });
  const artifactStaging = await artifacts.stage();
  const root = artifactStaging.rootDirectory;
  const contentDirectory = artifactStaging.contentDirectory;
  const providerHome = join(contentDirectory, "provider");
  const scratchDirectory = join(contentDirectory, "scratch");
  try {
    const prior = run.resumeFrom;
    if (prior === undefined) {
      await Promise.all([
        mkdir(providerHome, { mode: 0o700 }),
        mkdir(scratchDirectory, { mode: 0o700 }),
      ]);
      return {
        root,
        contentDirectory,
        artifactStaging,
        providerHome,
        scratchDirectory,
        sessionId: deterministicSessionId(run.campaignInputDigest),
      };
    }
    if (!checkpointMatchesRun(prior, run)) {
      throw new Error("Agent Checkpoint binding mismatch");
    }
    const resolved = await artifacts.resolve({
      artifactId: prior.checkpointId,
      digest: prior.stateDigest,
      entries: prior.stateEntries,
      bytes: prior.stateBytes,
    });
    if (resolved.status !== "resolved") {
      throw new Error("Agent Checkpoint integrity mismatch");
    }
    await Promise.all([
      cp(join(resolved.contentDirectory, "provider"), providerHome, {
        recursive: true,
        force: false,
        errorOnExist: true,
      }),
      cp(join(resolved.contentDirectory, "scratch"), scratchDirectory, {
        recursive: true,
        force: false,
        errorOnExist: true,
      }),
    ]);
    return {
      root,
      contentDirectory,
      artifactStaging,
      providerHome,
      scratchDirectory,
      sessionId: prior.sessionId,
    };
  } catch (error: unknown) {
    await rm(root, { recursive: true, force: true });
    throw error;
  }
}

export async function finalizeResearchState(
  run: SealedNativeRun,
  state: ResearchWorkingState,
  scratchRootDirectory: string,
): Promise<AgentCheckpointRef | undefined> {
  const providerState = await measureCanonicalSourceTree(
    state.providerHome,
    checkpointLimits,
  );
  if (providerState.entries === 0) return undefined;
  const measured = await measureCanonicalSourceTree(
    state.contentDirectory,
    checkpointLimits,
  );
  const checkpointId = `checkpoint-${createHash("sha256")
    .update(measured.digest)
    .update(state.sessionId)
    .update(run.targetSnapshot.digest)
    .update(run.promptSet.digest)
    .update(run.agentRuntimeProfile.digest)
    .update(run.permissionProfile.digest)
    .update(canonicalDigest(run.dependencySnapshots ?? []))
    .update(run.threatContext?.digest ?? "")
    .update(run.programmeBoundary?.digest ?? "")
    .digest("hex")}`;
  const artifacts = new PrivateArtifactStore({
    rootDirectory: join(scratchRootDirectory, "agent-checkpoints"),
    ...checkpointLimits,
  });
  const committed = await artifacts.commit(checkpointId, state.artifactStaging);
  if (committed.status === "conflict") {
    throw new Error("Agent Checkpoint artifact conflict");
  }
  return {
    kind: "agent-checkpoint",
    schemaVersion: 1,
    checkpointId,
    stateDigest: measured.digest,
    stateEntries: measured.entries,
    stateBytes: measured.bytes,
    sessionId: state.sessionId,
    targetSnapshotDigest: run.targetSnapshot.digest,
    promptSetDigest: run.promptSet.digest,
    runtimeProfileDigest: run.agentRuntimeProfile.digest,
    permissionProfileDigest: run.permissionProfile.digest,
    ...((run.dependencySnapshots ?? []).length === 0
      ? {}
      : {
          dependencySnapshotsDigest: canonicalDigest(
            run.dependencySnapshots ?? [],
          ),
        }),
    ...(run.threatContext === undefined
      ? {}
      : { threatContextDigest: run.threatContext.digest }),
    ...(run.programmeBoundary === undefined
      ? {}
      : { programmeBoundaryDigest: run.programmeBoundary.digest }),
  };
}
