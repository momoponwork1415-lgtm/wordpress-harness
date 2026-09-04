import { z } from "zod";

import { targetSnapshotRefSchema } from "../contracts.js";
import {
  canonicalJson,
  sha256Digest,
} from "../research-record/canonical-json.js";
import { targetFileManifestRefSchema } from "../source-mapping/contracts.js";
import {
  explorationSubjectRefSchema,
  iterationDecisionV2Schema,
  type IterationDecisionV2,
} from "./semantic-contracts.js";

const identifierSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
const digestSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const boundedTextSchema = z.string().min(1).max(1_000);

export const semanticIterationDecisionRefSchema = z.strictObject({
  kind: z.literal("iteration-decision"),
  schemaVersion: z.literal(2),
  digest: digestSchema,
  targetSnapshotDigest: digestSchema,
  manifestDigest: digestSchema,
  workWaveDigest: digestSchema,
});

export const approachFamilySchema = z.strictObject({
  kind: z.literal("approach-family"),
  schemaVersion: z.literal(2),
  id: digestSchema,
  campaignId: identifierSchema,
  runId: identifierSchema,
  target: targetSnapshotRefSchema,
  manifest: targetFileManifestRefSchema,
  openingDecision: semanticIterationDecisionRefSchema,
  ordinal: z.number().int().positive(),
  state: z.enum(["active", "blocked", "exhausted"]),
  pendingVerifications: z.array(identifierSchema).max(32),
  verificationOutcomes: z
    .array(
      z.strictObject({
        verificationId: identifierSchema,
        digest: digestSchema,
        outcome: z.enum(["finding", "disproved", "blocked"]),
      }),
    )
    .max(32),
  round: z.number().int().positive().max(3),
  evidence: z.array(explorationSubjectRefSchema).min(1).max(64),
  thesis: boundedTextSchema,
  mechanism: boundedTextSchema,
  falsifier: boundedTextSchema,
  nextAction: boundedTextSchema,
});

export const approachFamilyRefSchema = z.strictObject({
  kind: z.literal("approach-family"),
  schemaVersion: z.literal(2),
  id: digestSchema,
  digest: digestSchema,
  targetSnapshotDigest: digestSchema,
  manifestDigest: digestSchema,
  openingDecisionDigest: digestSchema,
  state: approachFamilySchema.shape.state,
  pendingVerifications: z.number().int().nonnegative().max(32),
  verificationOutcomes: z.number().int().nonnegative().max(32),
});

export const approachFamilyRegistrySchema = z.strictObject({
  kind: z.literal("approach-family-registry"),
  schemaVersion: z.literal(2),
  campaignId: identifierSchema,
  runId: identifierSchema,
  target: targetSnapshotRefSchema,
  manifest: targetFileManifestRefSchema,
  decisions: z.array(semanticIterationDecisionRefSchema).min(1).max(3),
  depthDecisions: z.array(digestSchema).max(64),
  families: z.array(approachFamilySchema).max(64),
});

export const approachFamilyRegistryRefSchema = z.strictObject({
  kind: z.literal("approach-family-registry"),
  schemaVersion: z.literal(2),
  campaignId: identifierSchema,
  runId: identifierSchema,
  targetSnapshotDigest: digestSchema,
  manifestDigest: digestSchema,
  digest: digestSchema,
  decisions: z.number().int().positive().max(3),
  depthDecisions: z.number().int().nonnegative().max(64),
  families: z.number().int().nonnegative().max(64),
  maxRound: z.number().int().nonnegative().max(3),
  states: z.strictObject({
    active: z.number().int().nonnegative(),
    blocked: z.number().int().nonnegative(),
    exhausted: z.number().int().nonnegative(),
  }),
  pendingVerifications: z.number().int().nonnegative(),
  verificationOutcomes: z.number().int().nonnegative(),
});

export type SemanticIterationDecisionRef = z.infer<
  typeof semanticIterationDecisionRefSchema
>;
export type ApproachFamily = z.infer<typeof approachFamilySchema>;
export type ApproachFamilyRef = z.infer<typeof approachFamilyRefSchema>;
export type ApproachFamilyRegistry = z.infer<
  typeof approachFamilyRegistrySchema
>;
export type ApproachFamilyRegistryRef = z.infer<
  typeof approachFamilyRegistryRefSchema
>;

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function sortedEvidence(
  evidence: readonly IterationDecisionV2["evaluationSubjects"][number][],
) {
  return [...evidence].sort(
    (left, right) =>
      compareText(left.kind, right.kind) ||
      compareText(left.id, right.id) ||
      compareText(left.digest, right.digest),
  );
}

export function referenceSemanticIterationDecision(
  value: IterationDecisionV2,
): SemanticIterationDecisionRef {
  const decision = iterationDecisionV2Schema.parse(value);
  return semanticIterationDecisionRefSchema.parse({
    kind: "iteration-decision",
    schemaVersion: 2,
    digest: sha256Digest(decision),
    targetSnapshotDigest: decision.target.digest,
    manifestDigest: decision.manifest.digest,
    workWaveDigest: decision.wave.digest,
  });
}

export function projectInitialApproachFamilies(
  campaignId: string,
  runId: string,
  value: IterationDecisionV2,
): readonly ApproachFamily[] {
  const decision = iterationDecisionV2Schema.parse(value);
  const decisionRef = referenceSemanticIterationDecision(decision);
  return decision.actions
    .filter((action) => action.kind === "admit-depth")
    .sort((left, right) => compareText(left.admission.id, right.admission.id))
    .map((action, index) => {
      const evidence = sortedEvidence(action.subjects);
      const ordinal = index + 1;
      const identity = {
        kind: "approach-family",
        campaignId,
        runId,
        targetSnapshotDigest: decision.target.digest,
        manifestDigest: decision.manifest.digest,
        openingDecisionDigest: decisionRef.digest,
        ordinal,
      } as const;
      return approachFamilySchema.parse({
        kind: "approach-family",
        schemaVersion: 2,
        id: sha256Digest(identity),
        campaignId,
        runId,
        target: decision.target,
        manifest: decision.manifest,
        openingDecision: decisionRef,
        ordinal,
        state: "active",
        pendingVerifications: [],
        verificationOutcomes: [],
        round: 1,
        evidence,
        thesis: action.admission.highImpactPotential,
        mechanism: action.admission.composition,
        falsifier: action.admission.falsifier,
        nextAction: action.admission.nextAction,
      });
    });
}

export function referenceApproachFamily(
  value: ApproachFamily,
): ApproachFamilyRef {
  const family = approachFamilySchema.parse(value);
  return approachFamilyRefSchema.parse({
    kind: "approach-family",
    schemaVersion: 2,
    id: family.id,
    digest: sha256Digest(family),
    targetSnapshotDigest: family.target.digest,
    manifestDigest: family.manifest.digest,
    openingDecisionDigest: family.openingDecision.digest,
    state: family.state,
    pendingVerifications: family.pendingVerifications.length,
    verificationOutcomes: family.verificationOutcomes.length,
  });
}

export function projectApproachFamilyRegistry(input: {
  readonly campaignId: string;
  readonly runId: string;
  readonly target: ApproachFamilyRegistry["target"];
  readonly manifest: ApproachFamilyRegistry["manifest"];
  readonly decisions: readonly SemanticIterationDecisionRef[];
  readonly depthDecisions?: readonly string[];
  readonly families: readonly ApproachFamily[];
}): {
  readonly value: ApproachFamilyRegistry;
  readonly ref: ApproachFamilyRegistryRef;
} {
  const decisions = [...input.decisions].sort((left, right) =>
    compareText(left.digest, right.digest),
  );
  const families = [...input.families].sort((left, right) =>
    compareText(left.id, right.id),
  );
  const depthDecisions = [...(input.depthDecisions ?? [])];
  if (
    decisions.some(
      (decision) =>
        decision.targetSnapshotDigest !== input.target.digest ||
        decision.manifestDigest !== input.manifest.digest,
    ) ||
    families.some(
      (family) =>
        family.campaignId !== input.campaignId ||
        family.runId !== input.runId ||
        canonicalJson(family.target) !== canonicalJson(input.target) ||
        canonicalJson(family.manifest) !== canonicalJson(input.manifest) ||
        !decisions.some(
          (decision) => decision.digest === family.openingDecision.digest,
        ),
    )
  ) {
    throw new Error("Approach Family Registry binding mismatch");
  }
  if (
    new Set(decisions.map((decision) => decision.digest)).size !==
      decisions.length ||
    new Set(depthDecisions).size !== depthDecisions.length ||
    new Set(families.map((family) => family.id)).size !== families.length
  ) {
    throw new Error("Approach Family Registry contains duplicate entries");
  }
  const registry = approachFamilyRegistrySchema.parse({
    kind: "approach-family-registry",
    schemaVersion: 2,
    campaignId: input.campaignId,
    runId: input.runId,
    target: input.target,
    manifest: input.manifest,
    decisions,
    depthDecisions,
    families,
  });
  return {
    value: registry,
    ref: approachFamilyRegistryRefSchema.parse({
      kind: "approach-family-registry",
      schemaVersion: 2,
      campaignId: input.campaignId,
      runId: input.runId,
      targetSnapshotDigest: input.target.digest,
      manifestDigest: input.manifest.digest,
      digest: sha256Digest(registry),
      decisions: decisions.length,
      depthDecisions: depthDecisions.length,
      families: families.length,
      maxRound: families.reduce(
        (maximum, family) => Math.max(maximum, family.round),
        0,
      ),
      states: {
        active: families.filter((family) => family.state === "active").length,
        blocked: families.filter((family) => family.state === "blocked").length,
        exhausted: families.filter((family) => family.state === "exhausted")
          .length,
      },
      pendingVerifications: families
        .filter((family) => family.pendingVerifications.length > 0)
        .reduce(
          (total, family) => total + family.pendingVerifications.length,
          0,
        ),
      verificationOutcomes: families.reduce(
        (total, family) => total + family.verificationOutcomes.length,
        0,
      ),
    }),
  };
}
