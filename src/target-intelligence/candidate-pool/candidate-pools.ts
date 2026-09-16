import { canonicalDigest } from "../../infrastructure/canonical-json.js";
import {
  targetCandidatePoolSchema,
  type TargetCandidate,
  type TargetCandidatePool,
} from "./contracts.js";

export function defineTargetCandidatePool(input: {
  readonly id: string;
  readonly candidates: readonly TargetCandidate[];
}): TargetCandidatePool {
  const body = {
    kind: "target-candidate-pool" as const,
    schemaVersion: 1 as const,
    id: input.id,
    candidates: input.candidates,
  };
  return targetCandidatePoolSchema.parse({
    ...body,
    digest: canonicalDigest(body),
  });
}

export function isCurrentTargetCandidate(
  candidate: TargetCandidate,
  at: number,
): boolean {
  return (
    candidate.targetObservation.acquisition === "available" &&
    candidate.targetObservation.provenance === "verified" &&
    candidate.targetObservation.identity === "verified" &&
    Date.parse(candidate.targetObservation.currentUntil) >= at
  );
}
