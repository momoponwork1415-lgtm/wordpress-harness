import { z } from "zod";

import { targetSnapshotRefSchema } from "../contracts.js";
import {
  canonicalJson,
  sha256Digest,
} from "../research-record/canonical-json.js";
import { targetFileManifestRefSchema } from "../source-mapping/contracts.js";
import {
  approachFamilyAdmissionRefSchema,
  explorationSubjectRefSchema,
  iterationDecisionV3Schema,
  type IterationDecisionV3,
} from "./semantic-contracts.js";
import { admittedApproachFamilyId } from "./semantic-approach-family-registry.js";

const digestSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const identifierSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
const boundedTextSchema = z.string().min(1).max(1_000);

export const semanticIterationDecisionRefV3Schema = z.strictObject({
  kind: z.literal("iteration-decision"),
  schemaVersion: z.literal(3),
  digest: digestSchema,
  targetSnapshotDigest: digestSchema,
  manifestDigest: digestSchema,
  workWaveDigest: digestSchema,
});

export const approachFamilyV3Schema = z.strictObject({
  kind: z.literal("approach-family"),
  schemaVersion: z.literal(3),
  id: digestSchema,
  campaignId: identifierSchema,
  runId: identifierSchema,
  target: targetSnapshotRefSchema,
  manifest: targetFileManifestRefSchema,
  openingDecision: semanticIterationDecisionRefV3Schema,
  openingAdmission: approachFamilyAdmissionRefSchema,
  ordinal: z.number().int().positive(),
  state: z.enum(["active", "blocked", "exhausted"]),
  pendingValidations: z.array(digestSchema).max(64),
  validationOutcomes: z
    .array(
      z.strictObject({
        validationId: digestSchema,
        recordDigest: digestSchema,
        disposition: z.enum([
          "ready-for-human",
          "needs-research",
          "disproven",
          "rejected",
          "validation-pending",
        ]),
      }),
    )
    .max(64),
  round: z.number().int().positive().max(3),
  evidence: z.array(explorationSubjectRefSchema).min(1).max(64),
  thesis: boundedTextSchema,
  mechanism: boundedTextSchema,
  falsifier: boundedTextSchema,
  nextAction: boundedTextSchema,
});

export const approachFamilyRefV3Schema = z.strictObject({
  kind: z.literal("approach-family"),
  schemaVersion: z.literal(3),
  id: digestSchema,
  digest: digestSchema,
  targetSnapshotDigest: digestSchema,
  manifestDigest: digestSchema,
  openingDecisionDigest: digestSchema,
  openingAdmissionDigest: digestSchema,
  state: approachFamilyV3Schema.shape.state,
  pendingValidations: z.number().int().nonnegative().max(64),
  validationOutcomes: z.number().int().nonnegative().max(64),
});

export const approachFamilyRegistryV3Schema = z.strictObject({
  kind: z.literal("approach-family-registry"),
  schemaVersion: z.literal(3),
  campaignId: identifierSchema,
  runId: identifierSchema,
  target: targetSnapshotRefSchema,
  manifest: targetFileManifestRefSchema,
  decisions: z.array(semanticIterationDecisionRefV3Schema).min(1).max(3),
  depthDecisions: z.array(digestSchema).max(64),
  families: z.array(approachFamilyV3Schema).max(64),
});

export const approachFamilyRegistryRefV3Schema = z.strictObject({
  kind: z.literal("approach-family-registry"),
  schemaVersion: z.literal(3),
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
  pendingValidations: z.number().int().nonnegative(),
  validationOutcomes: z.number().int().nonnegative(),
});

export type ApproachFamilyV3 = z.infer<typeof approachFamilyV3Schema>;
export type ApproachFamilyRefV3 = z.infer<typeof approachFamilyRefV3Schema>;
export type ApproachFamilyRegistryV3 = z.infer<
  typeof approachFamilyRegistryV3Schema
>;
export type ApproachFamilyRegistryRefV3 = z.infer<
  typeof approachFamilyRegistryRefV3Schema
>;
export type SemanticIterationDecisionRefV3 = z.infer<
  typeof semanticIterationDecisionRefV3Schema
>;

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function referenceSemanticIterationDecisionV3(
  value: IterationDecisionV3,
): SemanticIterationDecisionRefV3 {
  const decision = iterationDecisionV3Schema.parse(value);
  return semanticIterationDecisionRefV3Schema.parse({
    kind: decision.kind,
    schemaVersion: decision.schemaVersion,
    digest: sha256Digest(decision),
    targetSnapshotDigest: decision.target.digest,
    manifestDigest: decision.manifest.digest,
    workWaveDigest: decision.wave.digest,
  });
}

export function projectApproachFamilyRegistryV3(
  campaignId: string,
  runId: string,
  value: IterationDecisionV3,
): {
  readonly value: ApproachFamilyRegistryV3;
  readonly ref: ApproachFamilyRegistryRefV3;
} {
  const decision = iterationDecisionV3Schema.parse(value);
  const decisionRef = referenceSemanticIterationDecisionV3(decision);
  const admissions = new Map(
    decision.approachFamilies.map((admission) => [admission.id, admission]),
  );
  const admissionKeys = new Set(
    decision.approachFamilies.map((admission) => admission.key),
  );
  const decisionSubjects = new Set(
    decision.evaluationSubjects.map((subject) => canonicalJson(subject)),
  );
  if (
    admissions.size !== decision.approachFamilies.length ||
    admissionKeys.size !== decision.approachFamilies.length ||
    decision.approachFamilies.some((admission) => {
      const { id: _id, ...identity } = admission;
      return (
        admission.id !== sha256Digest(identity) ||
        canonicalJson(admission.target) !== canonicalJson(decision.target) ||
        canonicalJson(admission.manifest) !==
          canonicalJson(decision.manifest) ||
        canonicalJson(admission.wave) !== canonicalJson(decision.wave) ||
        admission.subjects.some(
          (subject) => !decisionSubjects.has(canonicalJson(subject)),
        )
      );
    })
  ) {
    throw new Error("Approach Family Admission v3 binding mismatch");
  }
  const referenced = new Set<string>();
  for (const action of decision.actions) {
    if (action.kind !== "admit-validation" && action.kind !== "admit-depth") {
      continue;
    }
    const admission = admissions.get(action.approachFamily.id);
    if (
      admission === undefined ||
      canonicalJson(action.approachFamily) !==
        canonicalJson({
          kind: admission.kind,
          schemaVersion: admission.schemaVersion,
          id: admission.id,
          digest: sha256Digest(admission),
          key: admission.key,
          targetSnapshotDigest: admission.target.digest,
          manifestDigest: admission.manifest.digest,
          workWaveDigest: admission.wave.digest,
        }) ||
      action.subjects.some(
        (subject) =>
          !admission.subjects.some(
            (evidence) => canonicalJson(evidence) === canonicalJson(subject),
          ),
      )
    ) {
      throw new Error("Approach Family v3 action binding mismatch");
    }
    referenced.add(admission.id);
  }
  if (referenced.size !== admissions.size) {
    throw new Error("Approach Family Admission v3 is unused");
  }

  const families = [...decision.approachFamilies]
    .sort(
      (left, right) =>
        compareText(left.key, right.key) || compareText(left.id, right.id),
    )
    .map((admission, index) => {
      const openingAdmission = {
        kind: admission.kind,
        schemaVersion: admission.schemaVersion,
        id: admission.id,
        digest: sha256Digest(admission),
        key: admission.key,
        targetSnapshotDigest: admission.target.digest,
        manifestDigest: admission.manifest.digest,
        workWaveDigest: admission.wave.digest,
      } as const;
      return approachFamilyV3Schema.parse({
        kind: "approach-family",
        schemaVersion: 3,
        id: admittedApproachFamilyId({
          campaignId,
          runId,
          targetSnapshotDigest: decision.target.digest,
          manifestDigest: decision.manifest.digest,
          openingDecisionDigest: decisionRef.digest,
          admissionId: admission.id,
        }),
        campaignId,
        runId,
        target: decision.target,
        manifest: decision.manifest,
        openingDecision: decisionRef,
        openingAdmission,
        ordinal: index + 1,
        state: "active",
        pendingValidations: [],
        validationOutcomes: [],
        round: 1,
        evidence: admission.subjects,
        thesis: admission.thesis,
        mechanism: admission.mechanism,
        falsifier: admission.falsifier,
        nextAction: admission.nextAction,
      });
    });
  const registry = approachFamilyRegistryV3Schema.parse({
    kind: "approach-family-registry",
    schemaVersion: 3,
    campaignId,
    runId,
    target: decision.target,
    manifest: decision.manifest,
    decisions: [decisionRef],
    depthDecisions: [],
    families,
  });
  return {
    value: registry,
    ref: approachFamilyRegistryRefV3Schema.parse({
      kind: registry.kind,
      schemaVersion: registry.schemaVersion,
      campaignId,
      runId,
      targetSnapshotDigest: decision.target.digest,
      manifestDigest: decision.manifest.digest,
      digest: sha256Digest(registry),
      decisions: 1,
      depthDecisions: 0,
      families: families.length,
      maxRound: families.length === 0 ? 0 : 1,
      states: {
        active: families.length,
        blocked: 0,
        exhausted: 0,
      },
      pendingValidations: 0,
      validationOutcomes: 0,
    }),
  };
}
