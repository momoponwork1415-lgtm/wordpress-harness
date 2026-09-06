import {
  frontierGapArtifactRefSchema,
  frontierGapArtifactSchema,
  routeFragmentArtifactRefSchema,
  routeFragmentArtifactSchema,
  semanticCheckpointSubjectProposalSchema,
  sourceBoundHypothesisArtifactRefSchema,
  sourceBoundHypothesisArtifactSchema,
  type SemanticCheckpointSubjectProposal,
  type SemanticWorkWaveRef,
} from "../exploration/semantic-contracts.js";
import type { TargetSnapshotRef } from "../contracts.js";
import type { JsonArtifactStore } from "../research-record/contracts.js";
import { sha256Digest } from "../research-record/canonical-json.js";
import { openVerifiedArtifacts } from "../../infrastructure/verified-artifacts.js";
import type { TargetFileManifestRef } from "../source-mapping/contracts.js";

export interface SemanticSubjectMaterializationInput {
  readonly target: TargetSnapshotRef;
  readonly manifest: TargetFileManifestRef;
  readonly workWave: SemanticWorkWaveRef;
  readonly attemptId: string;
  readonly leaseId: string;
  readonly manifestEntries: readonly {
    readonly path: string;
    readonly digest: string;
    readonly size: number;
  }[];
  readonly subject: unknown;
}

function subjectAnchors(subject: SemanticCheckpointSubjectProposal) {
  if (subject.kind === "source-bound-hypothesis") {
    return subject.route.anchors;
  }
  if (subject.kind === "route-fragment-proposal") {
    return subject.evidence;
  }
  return subject.sourceEvidence;
}

export async function materializeSemanticSubject(
  artifactStore: JsonArtifactStore,
  input: SemanticSubjectMaterializationInput,
) {
  const artifacts = openVerifiedArtifacts(artifactStore);
  const subject = semanticCheckpointSubjectProposalSchema.parse(input.subject);
  const admitted = new Map(
    input.manifestEntries.map((entry) => [entry.path, entry.digest]),
  );
  if (
    subjectAnchors(subject).some(
      (anchor) => admitted.get(anchor.path) !== anchor.fileDigest,
    )
  ) {
    throw new Error("Semantic checkpoint contains a foreign source anchor");
  }
  const common = {
    target: input.target,
    manifest: input.manifest,
    workWave: input.workWave,
    attemptId: input.attemptId,
    leaseId: input.leaseId,
  };

  if (subject.kind === "source-bound-hypothesis") {
    const id = sha256Digest({
      kind: subject.kind,
      targetSnapshotDigest: input.target.digest,
      manifestDigest: input.manifest.digest,
      value: subject,
    });
    const artifact = sourceBoundHypothesisArtifactSchema.parse({
      kind: subject.kind,
      schemaVersion: 2,
      id,
      ...common,
      value: subject,
    });
    const digest = await artifacts.put("Source Bound Hypothesis", artifact);
    return sourceBoundHypothesisArtifactRefSchema.parse({
      kind: artifact.kind,
      schemaVersion: 2,
      id,
      digest,
      attemptId: input.attemptId,
      leaseId: input.leaseId,
      workWaveDigest: input.workWave.digest,
      targetSnapshotDigest: input.target.digest,
      manifestDigest: input.manifest.digest,
    });
  }

  if (subject.kind === "route-fragment-proposal") {
    const id = sha256Digest({
      kind: "route-fragment",
      targetSnapshotDigest: input.target.digest,
      manifestDigest: input.manifest.digest,
      value: subject,
    });
    const artifact = routeFragmentArtifactSchema.parse({
      kind: "route-fragment",
      schemaVersion: 2,
      id,
      ...common,
      value: subject,
    });
    const digest = await artifacts.put("Route Fragment", artifact);
    return routeFragmentArtifactRefSchema.parse({
      kind: artifact.kind,
      schemaVersion: 2,
      id,
      digest,
      attemptId: input.attemptId,
      leaseId: input.leaseId,
      workWaveDigest: input.workWave.digest,
      targetSnapshotDigest: input.target.digest,
      manifestDigest: input.manifest.digest,
    });
  }

  const id = sha256Digest({
    kind: "frontier-gap",
    targetSnapshotDigest: input.target.digest,
    manifestDigest: input.manifest.digest,
    value: subject,
  });
  const artifact = frontierGapArtifactSchema.parse({
    kind: "frontier-gap",
    schemaVersion: 2,
    id,
    ...common,
    value: subject,
  });
  const digest = await artifacts.put("Frontier Gap", artifact);
  return frontierGapArtifactRefSchema.parse({
    kind: artifact.kind,
    schemaVersion: 2,
    id,
    digest,
    attemptId: input.attemptId,
    leaseId: input.leaseId,
    workWaveDigest: input.workWave.digest,
    targetSnapshotDigest: input.target.digest,
    manifestDigest: input.manifest.digest,
  });
}
