import {
  finderOutputV2Schema,
  frontierGapArtifactRefSchema,
  frontierGapArtifactSchema,
  routeFragmentArtifactRefSchema,
  routeFragmentArtifactSchema,
  semanticWaveTerminalRefSchema,
  semanticWaveTerminalSchema,
  sourceBoundHypothesisArtifactRefSchema,
  sourceBoundHypothesisArtifactSchema,
  type FinderOutputV2,
  type SemanticWaveTerminalRef,
} from "../exploration/semantic-contracts.js";
import type {
  AttemptExecutionResultV2Ref,
  ModelAttemptResultV2,
} from "../model-execution/contracts.js";
import type { JsonArtifactStore } from "../research-record/contracts.js";
import { sha256Digest } from "../research-record/canonical-json.js";
import { openVerifiedArtifacts } from "../../infrastructure/verified-artifacts.js";

export interface SemanticWaveTerminalAttempt {
  readonly ref: AttemptExecutionResultV2Ref & { readonly role: "finder" };
  readonly value: ModelAttemptResultV2 & { readonly role: "finder" };
  readonly expectedLeaseId: string;
  readonly maxCandidates: number;
}

function compareRef(
  left: { readonly id: string; readonly digest: string },
  right: { readonly id: string; readonly digest: string },
): number {
  return (
    left.id.localeCompare(right.id) || left.digest.localeCompare(right.digest)
  );
}

function allAnchors(output: FinderOutputV2) {
  return [
    ...output.hypotheses.flatMap((candidate) => candidate.route.anchors),
    ...output.routeFragments.flatMap((candidate) => candidate.evidence),
    ...output.frontierGaps.flatMap((candidate) => candidate.sourceEvidence),
  ];
}

export async function closeSemanticWaveBarrier(
  artifactStore: JsonArtifactStore,
  wave: {
    readonly id: string;
    readonly ref: {
      readonly kind: "work-wave";
      readonly schemaVersion: 2;
      readonly id: string;
      readonly digest: string;
      readonly targetSnapshotDigest: string;
      readonly manifestDigest: string;
    };
    readonly target: {
      readonly id: string;
      readonly pluginSlug: string;
      readonly version: string;
      readonly digest: string;
    };
    readonly manifest: {
      readonly kind: "target-file-manifest";
      readonly schemaVersion: 1;
      readonly targetSnapshotId: string;
      readonly targetSnapshotDigest: string;
      readonly digest: string;
    };
  },
  manifestEntries: readonly {
    readonly path: string;
    readonly digest: string;
    readonly size: number;
  }[],
  terminalAttempts: readonly SemanticWaveTerminalAttempt[],
): Promise<SemanticWaveTerminalRef> {
  const artifacts = openVerifiedArtifacts(artifactStore);
  const admitted = new Map(
    manifestEntries.map((entry) => [entry.path, entry.digest]),
  );
  const hypotheses: ReturnType<
    typeof sourceBoundHypothesisArtifactRefSchema.parse
  >[] = [];
  const routeFragments: ReturnType<
    typeof routeFragmentArtifactRefSchema.parse
  >[] = [];
  const frontierGaps: ReturnType<typeof frontierGapArtifactRefSchema.parse>[] =
    [];
  const issues: {
    readonly attemptId: string;
    readonly reason:
      | "partial-finder-output"
      | "invalid-finder-output"
      | "foreign-source-anchor";
  }[] = [];

  for (const attempt of [...terminalAttempts].sort((left, right) =>
    left.ref.attemptId.localeCompare(right.ref.attemptId),
  )) {
    if (attempt.value.status !== "completed") {
      issues.push({
        attemptId: attempt.ref.attemptId,
        reason: "partial-finder-output",
      });
      continue;
    }
    const decoded = finderOutputV2Schema
      .extend({
        hypotheses: finderOutputV2Schema.shape.hypotheses.max(
          attempt.maxCandidates,
        ),
        routeFragments: finderOutputV2Schema.shape.routeFragments.max(
          attempt.maxCandidates,
        ),
        frontierGaps: finderOutputV2Schema.shape.frontierGaps.max(
          attempt.maxCandidates,
        ),
      })
      .safeParse(attempt.value.output);
    if (!decoded.success || decoded.data.leaseId !== attempt.expectedLeaseId) {
      issues.push({
        attemptId: attempt.ref.attemptId,
        reason: "invalid-finder-output",
      });
      continue;
    }
    const leaseId = decoded.data.leaseId;
    if (
      allAnchors(decoded.data).some(
        (anchor) => admitted.get(anchor.path) !== anchor.fileDigest,
      )
    ) {
      issues.push({
        attemptId: attempt.ref.attemptId,
        reason: "foreign-source-anchor",
      });
      continue;
    }

    const common = {
      target: wave.target,
      manifest: wave.manifest,
      workWave: wave.ref,
      attemptId: attempt.ref.attemptId,
      leaseId,
    };
    for (const value of decoded.data.hypotheses) {
      const id = sha256Digest({
        kind: "source-bound-hypothesis",
        targetSnapshotDigest: wave.target.digest,
        manifestDigest: wave.manifest.digest,
        value,
      });
      const artifact = sourceBoundHypothesisArtifactSchema.parse({
        kind: "source-bound-hypothesis",
        schemaVersion: 2,
        id,
        ...common,
        value,
      });
      const digest = await artifacts.put("Source Bound Hypothesis", artifact);
      hypotheses.push(
        sourceBoundHypothesisArtifactRefSchema.parse({
          kind: artifact.kind,
          schemaVersion: 2,
          id,
          digest,
          attemptId: artifact.attemptId,
          leaseId,
          workWaveDigest: wave.ref.digest,
          targetSnapshotDigest: wave.target.digest,
          manifestDigest: wave.manifest.digest,
        }),
      );
    }
    for (const value of decoded.data.routeFragments) {
      const id = sha256Digest({
        kind: "route-fragment",
        targetSnapshotDigest: wave.target.digest,
        manifestDigest: wave.manifest.digest,
        value,
      });
      const artifact = routeFragmentArtifactSchema.parse({
        kind: "route-fragment",
        schemaVersion: 2,
        id,
        ...common,
        value,
      });
      const digest = await artifacts.put("Route Fragment", artifact);
      routeFragments.push(
        routeFragmentArtifactRefSchema.parse({
          kind: artifact.kind,
          schemaVersion: 2,
          id,
          digest,
          attemptId: artifact.attemptId,
          leaseId,
          workWaveDigest: wave.ref.digest,
          targetSnapshotDigest: wave.target.digest,
          manifestDigest: wave.manifest.digest,
        }),
      );
    }
    for (const value of decoded.data.frontierGaps) {
      const id = sha256Digest({
        kind: "frontier-gap",
        targetSnapshotDigest: wave.target.digest,
        manifestDigest: wave.manifest.digest,
        value,
      });
      const artifact = frontierGapArtifactSchema.parse({
        kind: "frontier-gap",
        schemaVersion: 2,
        id,
        ...common,
        value,
      });
      const digest = await artifacts.put("Frontier Gap", artifact);
      frontierGaps.push(
        frontierGapArtifactRefSchema.parse({
          kind: artifact.kind,
          schemaVersion: 2,
          id,
          digest,
          attemptId: artifact.attemptId,
          leaseId,
          workWaveDigest: wave.ref.digest,
          targetSnapshotDigest: wave.target.digest,
          manifestDigest: wave.manifest.digest,
        }),
      );
    }
  }

  hypotheses.sort(compareRef);
  routeFragments.sort(compareRef);
  frontierGaps.sort(compareRef);
  issues.sort(
    (left, right) =>
      left.attemptId.localeCompare(right.attemptId) ||
      left.reason.localeCompare(right.reason),
  );
  const terminal = semanticWaveTerminalSchema.parse({
    kind: "semantic-wave-terminal",
    schemaVersion: 2,
    wave: wave.ref,
    target: wave.target,
    manifest: wave.manifest,
    attempts: terminalAttempts
      .map((attempt) => attempt.ref)
      .sort((left, right) => left.attemptId.localeCompare(right.attemptId)),
    attemptOutcomes: terminalAttempts
      .map((attempt) =>
        attempt.value.status === "completed"
          ? { attempt: attempt.ref, status: attempt.value.status }
          : {
              attempt: attempt.ref,
              status: attempt.value.status,
              reason: attempt.value.reason,
            },
      )
      .sort((left, right) =>
        left.attempt.attemptId.localeCompare(right.attempt.attemptId),
      ),
    hypotheses,
    routeFragments,
    frontierGaps,
    issues,
  });
  const digest = await artifacts.put("Semantic Wave terminal", terminal);
  return semanticWaveTerminalRefSchema.parse({
    kind: "semantic-wave-terminal",
    schemaVersion: 2,
    waveId: wave.id,
    digest,
    targetSnapshotDigest: wave.target.digest,
    manifestDigest: wave.manifest.digest,
    attemptOutcomes: terminal.attemptOutcomes,
    hypotheses,
    routeFragments,
    frontierGaps,
    issues,
  });
}
