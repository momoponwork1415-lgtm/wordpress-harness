import { z } from "zod";

import { targetSnapshotRefSchema } from "../contracts.js";
import type { AttemptExecutionResultV2 } from "../model-execution/contracts.js";
import { sha256Digest } from "../research-record/canonical-json.js";
import { targetFileManifestRefSchema } from "../source-mapping/contracts.js";
import { verificationRecordRefSchema } from "../verification/contracts.js";
import {
  approachFamilyRegistryRefSchema,
  referenceSemanticIterationDecision,
} from "./semantic-approach-family-registry.js";
import {
  iterationDecisionV2Schema,
  researchThesisSchema,
  semanticRootPlanningPolicySchema,
  semanticWaveTerminalRefSchema,
  semanticWorkLeaseSchema,
  semanticWorkWavePlanSchema,
  semanticWorkWaveRefSchema,
  type IterationDecisionV2,
  type SemanticRootPlanningPolicy,
  type SemanticWaveTerminalRef,
  type SemanticWorkWavePlan,
} from "./semantic-contracts.js";

const digestSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);

export const coverageObservationSchema = z
  .strictObject({
    kind: z.literal("coverage-observation"),
    schemaVersion: z.literal(1),
    id: digestSchema,
    ordinal: z.number().int().positive().max(3),
    reviewKind: z.enum(["initial-wave", "fresh-wildcard"]),
    target: targetSnapshotRefSchema,
    manifest: targetFileManifestRefSchema,
    wave: semanticWorkWaveRefSchema,
    wavePlanDigest: digestSchema,
    terminal: semanticWaveTerminalRefSchema,
    decision: z.strictObject({
      kind: z.literal("iteration-decision"),
      schemaVersion: z.literal(2),
      digest: digestSchema,
      targetSnapshotDigest: digestSchema,
      manifestDigest: digestSchema,
      workWaveDigest: digestSchema,
    }),
    semanticSubjectIds: z.array(digestSchema).max(192),
    newSubjectIds: z.array(digestSchema).max(192),
    outcome: z.enum(["material-delta", "no-material-delta"]),
  })
  .superRefine((observation, context) => {
    const expectedOutcome =
      observation.newSubjectIds.length === 0
        ? "no-material-delta"
        : "material-delta";
    if (
      observation.outcome !== expectedOutcome ||
      observation.wave.id !== observation.terminal.waveId ||
      observation.wave.digest !== observation.decision.workWaveDigest ||
      observation.target.digest !== observation.terminal.targetSnapshotDigest ||
      observation.target.digest !== observation.decision.targetSnapshotDigest ||
      observation.manifest.digest !== observation.terminal.manifestDigest ||
      observation.manifest.digest !== observation.decision.manifestDigest ||
      observation.terminal.issues.length > 0 ||
      observation.terminal.attemptOutcomes.some(
        (attempt) => attempt.status !== "completed",
      ) ||
      observation.newSubjectIds.some(
        (id) => !observation.semanticSubjectIds.includes(id),
      )
    ) {
      context.addIssue({
        code: "custom",
        message: "Coverage Observation invariant mismatch",
      });
    }
  });

export const semanticCoverageClosureSchema = z
  .strictObject({
    kind: z.literal("semantic-coverage-closure"),
    schemaVersion: z.literal(1),
    id: digestSchema,
    target: targetSnapshotRefSchema,
    manifest: targetFileManifestRefSchema,
    observations: z.array(coverageObservationSchema).min(2).max(3),
    approachFamilyRegistry: approachFamilyRegistryRefSchema,
    verifications: z.array(verificationRecordRefSchema).max(96),
    reopenWhen: z.literal(
      "target-snapshot-changed-or-new-source-bound-evidence",
    ),
  })
  .superRefine((closure, context) => {
    const final = closure.observations.at(-1);
    const penultimate = closure.observations.at(-2);
    if (
      final === undefined ||
      penultimate === undefined ||
      final.outcome !== "no-material-delta" ||
      penultimate.outcome !== "no-material-delta" ||
      final.reviewKind !== "fresh-wildcard" ||
      closure.approachFamilyRegistry.states.active > 0 ||
      closure.approachFamilyRegistry.states.blocked > 0 ||
      closure.approachFamilyRegistry.pendingVerifications > 0 ||
      closure.verifications.some(
        (verification) => verification.outcome === "blocked",
      ) ||
      closure.observations.some(
        (observation, index) =>
          observation.ordinal !== index + 1 ||
          observation.target.digest !== closure.target.digest ||
          observation.manifest.digest !== closure.manifest.digest,
      ) ||
      closure.approachFamilyRegistry.targetSnapshotDigest !==
        closure.target.digest ||
      closure.approachFamilyRegistry.manifestDigest !== closure.manifest.digest
    ) {
      context.addIssue({
        code: "custom",
        message: "Semantic Coverage Closure invariant mismatch",
      });
    }
  });

export const semanticCoverageClosureRefSchema = z.strictObject({
  kind: z.literal("semantic-coverage-closure"),
  schemaVersion: z.literal(1),
  id: digestSchema,
  digest: digestSchema,
  targetSnapshotDigest: digestSchema,
  manifestDigest: digestSchema,
  observations: z.number().int().min(2).max(3),
});

export type CoverageObservation = z.infer<typeof coverageObservationSchema>;
export type SemanticCoverageClosure = z.infer<
  typeof semanticCoverageClosureSchema
>;
export type SemanticCoverageClosureRef = z.infer<
  typeof semanticCoverageClosureRefSchema
>;

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function materializeCoverageReviewWave(input: {
  readonly target: z.infer<typeof targetSnapshotRefSchema>;
  readonly manifest: z.infer<typeof targetFileManifestRefSchema>;
  readonly policy: SemanticRootPlanningPolicy;
  readonly plannerAttempt: AttemptExecutionResultV2["ref"] & {
    readonly role: "root-planner";
  };
  readonly ordinal: number;
}): { readonly value: SemanticWorkWavePlan; readonly digest: string } {
  const policy = semanticRootPlanningPolicySchema.parse(input.policy);
  const ordinal = z.number().int().positive().max(2).parse(input.ordinal);
  const thesis = researchThesisSchema.parse({
    kind: "research-thesis",
    schemaVersion: 1,
    id: sha256Digest({
      kind: "coverage-review-thesis",
      target: input.target,
      manifest: input.manifest,
      ordinal,
    }),
    target: input.target,
    manifest: input.manifest,
    scope: "wildcard",
    securityAssumption:
      "a fresh whole-target review may falsify an earlier no-material-delta observation",
    question:
      "Which high-impact broken security semantic, route, or unresolved relation did every prior Wave miss?",
    motivation:
      "Coverage Closure requires an independent attempt to discover material semantic evidence.",
    startingBasis:
      "The entire immutable Target Snapshot without prior closure reasoning or candidate hints.",
    independence:
      "Review the whole Target from fresh source reads and do not defer to prior no-delta claims.",
  });
  const waveId = sha256Digest({
    kind: "coverage-review-wave",
    schemaVersion: 1,
    target: input.target,
    manifest: input.manifest,
    ordinal,
    thesisId: thesis.id,
    policy,
  });
  const wave = semanticWorkWaveRefSchema.parse({
    kind: "work-wave",
    schemaVersion: 2,
    id: waveId,
    digest: waveId,
    targetSnapshotDigest: input.target.digest,
    manifestDigest: input.manifest.digest,
  });
  const lease = semanticWorkLeaseSchema.parse({
    kind: "work-lease",
    schemaVersion: 2,
    id: sha256Digest({
      kind: "coverage-review-lease",
      wave,
      thesisId: thesis.id,
      budget: policy.finderLeaseBudget,
    }),
    role: "finder",
    target: input.target,
    manifest: input.manifest,
    assignment: {
      kind: "research-thesis",
      schemaVersion: 1,
      thesisId: thesis.id,
    },
    budget: policy.finderLeaseBudget,
  });
  const value = semanticWorkWavePlanSchema.parse({
    kind: "work-wave-plan",
    schemaVersion: 2,
    id: waveId,
    ref: wave,
    purpose: { kind: "coverage-review" },
    target: input.target,
    manifest: input.manifest,
    policy: {
      kind: "semantic-root-planning-policy",
      schemaVersion: 1,
      id: policy.id,
      digest: sha256Digest(policy),
    },
    plannerAttempt: input.plannerAttempt,
    theses: [thesis],
    leases: [lease],
  });
  return { value, digest: sha256Digest(value) };
}

export function projectCoverageObservation(input: {
  readonly ordinal: number;
  readonly reviewKind: CoverageObservation["reviewKind"];
  readonly decision: IterationDecisionV2;
  readonly wavePlanDigest: string;
  readonly terminal: SemanticWaveTerminalRef;
  readonly knownSubjectIds: readonly string[];
}): CoverageObservation {
  const decision = iterationDecisionV2Schema.parse(input.decision);
  const terminal = semanticWaveTerminalRefSchema.parse(input.terminal);
  const knownSubjectIds = new Set(input.knownSubjectIds);
  if (
    decision.campaignDisposition !== "coverage-closed" ||
    decision.actions.some((action) => action.kind !== "close") ||
    decision.target.digest !== terminal.targetSnapshotDigest ||
    decision.manifest.digest !== terminal.manifestDigest ||
    terminal.issues.length > 0 ||
    terminal.attemptOutcomes.some((attempt) => attempt.status !== "completed")
  ) {
    throw new Error("Coverage observation is not a complete closure pass");
  }
  if (decision.wave.id !== terminal.waveId) {
    throw new Error("Coverage observation Wave binding mismatch");
  }
  const semanticSubjectIds = [
    ...new Set(
      [
        ...terminal.hypotheses,
        ...terminal.routeFragments,
        ...terminal.frontierGaps,
      ].map((subject) => subject.id),
    ),
  ].sort(compareText);
  const newSubjectIds = semanticSubjectIds
    .filter((id) => !knownSubjectIds.has(id))
    .sort(compareText);
  const identity = {
    kind: "coverage-observation" as const,
    schemaVersion: 1 as const,
    ordinal: input.ordinal,
    reviewKind: input.reviewKind,
    target: decision.target,
    manifest: decision.manifest,
    wave: decision.wave,
    wavePlanDigest: input.wavePlanDigest,
    terminal,
    decision: referenceSemanticIterationDecision(decision),
    semanticSubjectIds,
    newSubjectIds,
    outcome:
      newSubjectIds.length === 0
        ? ("no-material-delta" as const)
        : ("material-delta" as const),
  };
  return coverageObservationSchema.parse({
    ...identity,
    id: sha256Digest(identity),
  });
}

export function closeSemanticCoverage(input: {
  readonly observations: readonly CoverageObservation[];
  readonly approachFamilyRegistry: z.infer<
    typeof approachFamilyRegistryRefSchema
  >;
  readonly verifications: readonly z.infer<
    typeof verificationRecordRefSchema
  >[];
}):
  | {
      readonly kind: "closed";
      readonly value: SemanticCoverageClosure;
      readonly ref: SemanticCoverageClosureRef;
    }
  | {
      readonly kind: "incomplete";
      readonly reason:
        | "two-consecutive-no-material-delta-missing"
        | "fresh-wildcard-review-missing"
        | "active-family"
        | "blocked-family"
        | "pending-verification"
        | "verification-blocked";
    } {
  const observations = input.observations.map((value) =>
    coverageObservationSchema.parse(value),
  );
  const registry = approachFamilyRegistryRefSchema.parse(
    input.approachFamilyRegistry,
  );
  const verifications = input.verifications.map((value) =>
    verificationRecordRefSchema.parse(value),
  );
  const final = observations.at(-1);
  const penultimate = observations.at(-2);
  if (
    final === undefined ||
    penultimate === undefined ||
    final.outcome !== "no-material-delta" ||
    penultimate.outcome !== "no-material-delta"
  ) {
    return {
      kind: "incomplete",
      reason: "two-consecutive-no-material-delta-missing",
    };
  }
  if (final.reviewKind !== "fresh-wildcard") {
    return { kind: "incomplete", reason: "fresh-wildcard-review-missing" };
  }
  if (registry.states.active > 0) {
    return { kind: "incomplete", reason: "active-family" };
  }
  if (registry.states.blocked > 0) {
    return { kind: "incomplete", reason: "blocked-family" };
  }
  if (registry.pendingVerifications > 0) {
    return { kind: "incomplete", reason: "pending-verification" };
  }
  if (
    verifications.some((verification) => verification.outcome === "blocked")
  ) {
    return { kind: "incomplete", reason: "verification-blocked" };
  }
  if (
    observations.some(
      (observation, index) =>
        observation.ordinal !== index + 1 ||
        observation.target.digest !== final.target.digest ||
        observation.manifest.digest !== final.manifest.digest,
    )
  ) {
    throw new Error("Coverage observations are not one bound sequence");
  }
  const identity = {
    kind: "semantic-coverage-closure" as const,
    schemaVersion: 1 as const,
    target: final.target,
    manifest: final.manifest,
    observations,
    approachFamilyRegistry: registry,
    verifications: [...verifications].sort((left, right) =>
      compareText(left.verificationId, right.verificationId),
    ),
    reopenWhen: "target-snapshot-changed-or-new-source-bound-evidence" as const,
  };
  const value = semanticCoverageClosureSchema.parse({
    ...identity,
    id: sha256Digest(identity),
  });
  return {
    kind: "closed",
    value,
    ref: semanticCoverageClosureRefSchema.parse({
      kind: value.kind,
      schemaVersion: value.schemaVersion,
      id: value.id,
      digest: sha256Digest(value),
      targetSnapshotDigest: value.target.digest,
      manifestDigest: value.manifest.digest,
      observations: value.observations.length,
    }),
  };
}
