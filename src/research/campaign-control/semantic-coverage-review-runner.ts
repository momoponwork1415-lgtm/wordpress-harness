import type { SemanticExploration } from "../exploration/semantic-contracts.js";
import {
  frontierGapArtifactSchema,
  routeFragmentArtifactSchema,
  semanticWaveTerminalSchema,
  sourceBoundHypothesisArtifactSchema,
  type SemanticFinderCheckpointRef,
} from "../exploration/semantic-contracts.js";
import {
  materializeCoverageReviewWave,
  projectCoverageObservation,
  type CoverageObservation,
} from "../exploration/semantic-coverage-closure.js";
import { referenceSemanticIterationDecision } from "../exploration/semantic-approach-family-registry.js";
import type {
  AttemptExecutionResultV2,
  AttemptPlanV2,
} from "../model-execution/contracts.js";
import { sha256Digest } from "../research-record/canonical-json.js";
import type {
  ApproachFamilyRegistryRecordView,
  JsonArtifactStore,
  ResearchRecord,
} from "../research-record/contracts.js";
import { openVerifiedArtifacts } from "../research-record/verified-artifacts.js";
import { sourceEvidenceReceiptValueV2Schema } from "../source-mapping/source-evidence-contracts.js";
import type {
  CampaignAttemptIntentV2,
  DefaultSemanticCampaignRunPlanV2,
  SemanticCoverageReviewTrace,
} from "./contracts.js";
import { materializeRawSourceFinderAttempt } from "./raw-source-finder-attempt-materializer.js";
import { closeSemanticWaveBarrier } from "./semantic-wave-barrier.js";

type FinderAttemptPlan = Extract<AttemptPlanV2, { role: "finder" }>;
type FinderAttemptIntent = Extract<CampaignAttemptIntentV2, { role: "finder" }>;

export interface SemanticCoverageReviewRunnerInput {
  readonly record: ResearchRecord;
  readonly artifactStore: JsonArtifactStore;
  readonly run: DefaultSemanticCampaignRunPlanV2;
  readonly plannerAttempt: AttemptExecutionResultV2["ref"] & {
    readonly role: "root-planner";
  };
  readonly canonicalFileEntries: readonly {
    readonly path: string;
    readonly digest: string;
    readonly size: number;
  }[];
  readonly exploration: SemanticExploration;
  readonly registry: ApproachFamilyRegistryRecordView;
  readonly reviewOrdinal: number;
  readonly observationOrdinal: number;
  readonly finderOrdinal: number;
  readonly knownSubjectIds: ReadonlySet<string>;
  readonly executeAttempt: (
    plan: FinderAttemptPlan,
    intent: FinderAttemptIntent,
    onCheckpoint: (checkpoint: SemanticFinderCheckpointRef) => void,
  ) => Promise<AttemptExecutionResultV2>;
  readonly onCheckpoint: (checkpoint: SemanticFinderCheckpointRef) => void;
  readonly onVerificationRequest: (
    hypothesis: SemanticFinderCheckpointRef["subject"],
  ) => void;
}

export type SemanticCoverageReviewRunnerResult =
  | {
      readonly kind: "completed";
      readonly observation: CoverageObservation;
      readonly trace: SemanticCoverageReviewTrace;
      readonly registry: ApproachFamilyRegistryRecordView;
    }
  | {
      readonly kind: "incomplete";
      readonly trace: SemanticCoverageReviewTrace;
      readonly registry: ApproachFamilyRegistryRecordView;
    };

function campaignAttemptId(
  runId: string,
  leaseId: string,
  ordinal: number,
): string {
  return `attempt:${sha256Digest({ runId, leaseId, ordinal }).slice("sha256:".length)}`;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export async function executeSemanticCoverageReview(
  input: SemanticCoverageReviewRunnerInput,
): Promise<SemanticCoverageReviewRunnerResult> {
  const artifacts = openVerifiedArtifacts(input.artifactStore);
  const review = materializeCoverageReviewWave({
    target: input.run.target,
    manifest: input.run.manifest,
    policy: input.run.semanticPolicy,
    plannerAttempt: input.plannerAttempt,
    ordinal: input.reviewOrdinal,
  });
  await artifacts.put("Coverage Review Wave Plan", review.value, review.digest);
  const reviewLease = review.value.leases[0];
  const reviewThesis = review.value.theses[0];
  if (reviewLease === undefined || reviewThesis === undefined) {
    throw new Error("Coverage Review Wave lost its Wildcard lease");
  }
  const attemptPlan = materializeRawSourceFinderAttempt({
    run: input.run,
    wave: review.value,
    lease: reviewLease,
    thesis: reviewThesis,
    attemptId: campaignAttemptId(input.run.runId, reviewLease.id, 1),
  });
  const attemptResult = await input.executeAttempt(
    attemptPlan,
    {
      kind: "campaign-attempt-intent",
      schemaVersion: 2,
      campaignId: input.run.campaignId,
      runId: input.run.runId,
      attemptId: attemptPlan.attemptId,
      ordinal: input.finderOrdinal,
      mode: "execute",
      attemptPlanDigest: sha256Digest(attemptPlan),
      role: "finder",
      leaseId: reviewLease.id,
      workWaveDigest: review.value.ref.digest,
    },
    input.onCheckpoint,
  );
  if (
    attemptResult.ref.role !== "finder" ||
    attemptResult.value.role !== "finder"
  ) {
    throw new Error("Coverage Review returned another Attempt role");
  }
  const terminalRef = await closeSemanticWaveBarrier(
    input.artifactStore,
    review.value,
    input.canonicalFileEntries,
    [
      {
        ref: { ...attemptResult.ref, role: "finder" },
        value: { ...attemptResult.value, role: "finder" },
        expectedLeaseId: reviewLease.id,
        maxCandidates: reviewLease.budget.maxHypotheses,
      },
    ],
  );
  const traceBase = {
    kind: "semantic-coverage-review-trace" as const,
    schemaVersion: 1 as const,
    ordinal: input.reviewOrdinal,
    wave: review.value.ref,
    wavePlanDigest: review.digest,
    terminal: terminalRef,
  };
  const terminal = await artifacts.read(
    "Coverage Review terminal",
    semanticWaveTerminalSchema,
    terminalRef.digest,
  );
  const hypotheses = await Promise.all(
    terminalRef.hypotheses.map((ref) =>
      artifacts.read(
        "Source Bound Hypothesis",
        sourceBoundHypothesisArtifactSchema,
        ref.digest,
      ),
    ),
  );
  const routeFragments = await Promise.all(
    terminalRef.routeFragments.map((ref) =>
      artifacts.read("Route Fragment", routeFragmentArtifactSchema, ref.digest),
    ),
  );
  const frontierGaps = await Promise.all(
    terminalRef.frontierGaps.map((ref) =>
      artifacts.read("Frontier Gap", frontierGapArtifactSchema, ref.digest),
    ),
  );
  const receiptRefs = [
    ...(attemptResult.value.sourceEvidenceReceipts ?? []),
  ].sort((left, right) => compareText(left.digest, right.digest));
  const receipts = await Promise.all(
    receiptRefs.map((ref) =>
      artifacts.read(
        "Tool Receipt",
        sourceEvidenceReceiptValueV2Schema,
        ref.digest,
      ),
    ),
  );
  const decision = await input.exploration.decide({
    kind: "evaluate-semantic-wave",
    schemaVersion: 2,
    target: input.run.target,
    manifest: input.run.manifest,
    wave: review.value,
    terminal: { ref: terminalRef, value: terminal },
    artifacts: { hypotheses, routeFragments, frontierGaps },
    attemptResults: [attemptResult.value],
    toolReceipts: receipts,
    closureReview: {
      kind: "coverage-closure-evaluation",
      schemaVersion: 1,
      reviewKind: "fresh-wildcard",
      knownSubjectIds: [...input.knownSubjectIds].sort(compareText),
    },
  });
  if (decision.kind !== "iteration-decision" || decision.schemaVersion !== 2) {
    return { kind: "incomplete", trace: traceBase, registry: input.registry };
  }
  const decisionRef = referenceSemanticIterationDecision(decision);
  await artifacts.put("Coverage Review Decision", decision, decisionRef.digest);
  const recorded = await input.record.recordSemanticIterationDecision(
    input.run.campaignId,
    input.run.runId,
    decision,
  );
  if (recorded.decision.digest !== decisionRef.digest) {
    throw new Error("Coverage Review Decision Ledger mismatch");
  }
  const registry = await input.record.readApproachFamilyRegistry(
    input.run.campaignId,
    input.run.runId,
  );
  if (registry === undefined) {
    throw new Error("Coverage Review lost the Approach Family Registry");
  }
  await artifacts.put(
    "Approach Family Registry",
    registry.value,
    registry.ref.digest,
  );
  for (const action of decision.actions) {
    if (action.kind === "request-verification") {
      input.onVerificationRequest(action.request.hypothesis);
    }
  }
  if (decision.campaignDisposition !== "coverage-closed") {
    return {
      kind: "incomplete",
      trace: { ...traceBase, decision: decisionRef },
      registry,
    };
  }
  const observation = projectCoverageObservation({
    ordinal: input.observationOrdinal,
    reviewKind: "fresh-wildcard",
    decision,
    wavePlanDigest: review.digest,
    terminal: terminalRef,
    knownSubjectIds: [...input.knownSubjectIds],
  });
  return {
    kind: "completed",
    observation,
    trace: { ...traceBase, decision: decisionRef, observation },
    registry,
  };
}
