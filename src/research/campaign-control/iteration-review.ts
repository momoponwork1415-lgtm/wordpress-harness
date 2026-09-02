import { sha256Digest } from "../research-record/canonical-json.js";
import type { FinderAttemptResult } from "../exploration/index.js";
import type { VerificationRecordView } from "../verification/index.js";
import {
  finiteWorkSchema,
  iterationDecisionSchema,
  type CalibrationReviewResult,
  type FiniteWork,
  type IterationDecision,
} from "./contracts.js";

interface IterationReviewInput {
  readonly campaignId: string;
  readonly runId: string;
  readonly mapDigest: string;
  readonly workWaveDigest: string;
  readonly explorationKind: "verify" | "blocked";
  readonly maxFinderAttempts: number;
  readonly executedAttempts: number;
  readonly attemptStatuses: readonly FinderAttemptResult["status"][];
  readonly verifications: readonly VerificationRecordView[];
  readonly calibrationReview?: CalibrationReviewResult;
}

export type IterationReviewResult = {
  readonly decision: IterationDecision;
  readonly finiteWork: FiniteWork | null;
};

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function reviewIteration(
  input: IterationReviewInput,
): IterationReviewResult {
  const conclusive = input.verifications.filter(
    (verification) => verification.ref.outcome !== "blocked",
  );
  if (conclusive.length > 0) {
    if (input.calibrationReview?.kind === "complete") {
      return {
        decision: iterationDecisionSchema.parse({
          kind: "stop-boundary-pair-complete",
          evidence: input.calibrationReview.evidence,
        }),
        finiteWork: null,
      };
    }
    return {
      decision: iterationDecisionSchema.parse({
        kind: "await-calibration",
        terminalVerifications: conclusive.map(
          (verification) => verification.ref,
        ),
      }),
      finiteWork: null,
    };
  }

  const verificationReasons = input.verifications.flatMap((verification) =>
    verification.value.outcome.kind === "blocked"
      ? [verification.value.outcome.reason]
      : [],
  );
  if (verificationReasons.length > 0) {
    return {
      decision: iterationDecisionSchema.parse({
        kind: "blocked-capability",
        reasons: [...new Set(verificationReasons)].sort(compareText),
      }),
      finiteWork: null,
    };
  }

  if (
    input.attemptStatuses.length > 0 &&
    input.attemptStatuses.every((status) => status === "provider-failed")
  ) {
    return {
      decision: iterationDecisionSchema.parse({
        kind: "blocked-capability",
        reasons: ["provider-unavailable"],
      }),
      finiteWork: null,
    };
  }

  const remainingFinderAttempts =
    input.maxFinderAttempts - input.executedAttempts;
  if (input.explorationKind === "blocked" && remainingFinderAttempts > 0) {
    const finiteWork = finiteWorkSchema.parse({
      kind: "finite-work",
      schemaVersion: 1,
      campaignId: input.campaignId,
      sourceRunId: input.runId,
      mapDigest: input.mapDigest,
      predecessorWaveDigest: input.workWaveDigest,
      remainingFinderAttempts,
      objective: "source-bound-hypothesis",
      stopWhen: "source-bound-hypothesis-or-budget-exhausted",
    });
    return {
      decision: iterationDecisionSchema.parse({
        kind: "continue-unresolved-work",
        next: {
          kind: "finite-work",
          schemaVersion: 1,
          digest: sha256Digest(finiteWork),
        },
      }),
      finiteWork,
    };
  }

  return {
    decision: iterationDecisionSchema.parse({
      kind: "blocked-capability",
      reasons: [
        input.explorationKind === "blocked"
          ? "no-source-bound-hypothesis"
          : "unsupported-attacker-premise",
      ],
    }),
    finiteWork: null,
  };
}
