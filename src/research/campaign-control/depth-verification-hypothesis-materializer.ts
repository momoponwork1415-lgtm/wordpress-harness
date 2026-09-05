import {
  sourceBoundHypothesisArtifactRefSchema,
  sourceBoundHypothesisArtifactSchema,
} from "../exploration/semantic-contracts.js";
import {
  depthIterationDecisionSchema,
  referenceDepthIterationDecision,
} from "../exploration/semantic-depth-evaluation.js";
import { semanticDepthWorkQueueSchema } from "../exploration/semantic-depth-work-queue.js";
import type { JsonArtifactStore } from "../research-record/contracts.js";
import { sha256Digest } from "../research-record/canonical-json.js";

export async function materializeDepthVerificationHypotheses(
  artifactStore: JsonArtifactStore,
  input: {
    readonly queue: unknown;
    readonly decision: unknown;
  },
) {
  const queue = semanticDepthWorkQueueSchema.parse(input.queue);
  const decision = depthIterationDecisionSchema.parse(input.decision);
  const queueDigest = sha256Digest(queue);
  if (
    decision.target.digest !== queue.target.digest ||
    decision.manifest.digest !== queue.manifest.digest ||
    decision.actions.some(
      (action) => action.proposal.queueDigest !== queueDigest,
    )
  ) {
    throw new Error("Depth Verification Hypothesis binding mismatch");
  }
  const decisionRef = referenceDepthIterationDecision(decision);
  return Promise.all(
    decision.actions
      .filter((action) => action.kind === "request-verification")
      .sort((left, right) => left.proposal.id.localeCompare(right.proposal.id))
      .map(async (action) => {
        if (action.kind !== "request-verification") {
          throw new Error("Depth Verification action narrowing failed");
        }
        const id = sha256Digest({
          kind: "source-bound-hypothesis",
          targetSnapshotDigest: decision.target.digest,
          manifestDigest: decision.manifest.digest,
          value: action.hypothesis,
        });
        const leaseId = sha256Digest({
          kind: "depth-verification-work-identity",
          decision: decisionRef,
          proposal: action.proposal,
        });
        const artifact = sourceBoundHypothesisArtifactSchema.parse({
          kind: "source-bound-hypothesis",
          schemaVersion: 2,
          id,
          target: decision.target,
          manifest: decision.manifest,
          workWave: queue.wave,
          attemptId: decision.attempt.attemptId,
          leaseId,
          value: action.hypothesis,
        });
        const digest = await artifactStore.putJson(artifact);
        return {
          proposal: action.proposal,
          ref: sourceBoundHypothesisArtifactRefSchema.parse({
            kind: "source-bound-hypothesis",
            schemaVersion: 2,
            id,
            digest,
            attemptId: artifact.attemptId,
            leaseId,
            workWaveDigest: artifact.workWave.digest,
            targetSnapshotDigest: artifact.target.digest,
            manifestDigest: artifact.manifest.digest,
          }),
        };
      }),
  );
}
