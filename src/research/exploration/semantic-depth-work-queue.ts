import { z } from "zod";

import { targetSnapshotRefSchema } from "../contracts.js";
import {
  canonicalJson,
  sha256Digest,
} from "../research-record/canonical-json.js";
import { targetFileManifestRefSchema } from "../source-mapping/contracts.js";
import {
  approachFamilyRefSchema,
  approachFamilyRegistrySchema,
  referenceApproachFamily,
  type ApproachFamilyRef,
  type ApproachFamilyRegistry,
} from "./semantic-approach-family-registry.js";
import {
  approachFamilyRefV3Schema,
  approachFamilyRegistryV3Schema,
  referenceApproachFamilyV3,
  type ApproachFamilyRefV3,
  type ApproachFamilyRegistryV3,
} from "./semantic-approach-family-registry-v3.js";
import {
  explorationSubjectRefSchema,
  iterationDecisionV2Schema,
  iterationDecisionV3Schema,
  semanticWorkWaveRefSchema,
  type IterationActionV2,
  type IterationActionV3,
  type IterationDecisionV2,
  type IterationDecisionV3,
} from "./semantic-contracts.js";

const digestSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const boundedTextSchema = z.string().min(1).max(1_000);

const depthWorkDirectiveSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("depth-admission"),
    sourceId: digestSchema,
    highImpactPotential: boundedTextSchema,
    composition: boundedTextSchema,
    falsifier: boundedTextSchema,
    nextAction: boundedTextSchema,
  }),
  z.strictObject({
    kind: z.literal("next-work-request"),
    sourceId: digestSchema,
    requiredFact: boundedTextSchema,
    falsifier: boundedTextSchema,
    nextAction: boundedTextSchema,
  }),
  z.strictObject({
    kind: z.literal("frontier-gap-follow-up"),
    sourceId: digestSchema,
    requiredFact: boundedTextSchema,
    falsifier: boundedTextSchema,
    nextAction: boundedTextSchema,
  }),
]);

export const semanticDepthWorkItemSchema = z.strictObject({
  kind: z.literal("semantic-depth-work-item"),
  schemaVersion: z.literal(1),
  id: digestSchema,
  predecessorDecisionDigest: digestSchema,
  target: targetSnapshotRefSchema,
  manifest: targetFileManifestRefSchema,
  wave: semanticWorkWaveRefSchema,
  sourceAction: z.enum(["admit-depth", "schedule-work", "missing-link-result"]),
  families: z.array(approachFamilyRefSchema).max(4),
  subjects: z.array(explorationSubjectRefSchema).min(1),
  directive: depthWorkDirectiveSchema,
});

const semanticDepthWorkBatchSchema = z.strictObject({
  kind: z.literal("semantic-depth-work-batch"),
  schemaVersion: z.literal(1),
  id: digestSchema,
  ordinal: z.number().int().positive(),
  itemIds: z.array(digestSchema).min(1).max(4),
});

export const semanticDepthWorkQueueSchema = z.strictObject({
  kind: z.literal("semantic-depth-work-queue"),
  schemaVersion: z.literal(1),
  predecessorDecisionDigest: digestSchema,
  target: targetSnapshotRefSchema,
  manifest: targetFileManifestRefSchema,
  wave: semanticWorkWaveRefSchema,
  items: z.array(semanticDepthWorkItemSchema),
  batches: z.array(semanticDepthWorkBatchSchema),
});

export const semanticDepthWorkQueueRefSchema = z.strictObject({
  kind: z.literal("semantic-depth-work-queue"),
  schemaVersion: z.literal(1),
  predecessorDecisionDigest: digestSchema,
  targetSnapshotDigest: digestSchema,
  manifestDigest: digestSchema,
  digest: digestSchema,
  items: z.number().int().nonnegative(),
  batches: z.number().int().nonnegative(),
});

export const semanticDepthWorkItemV2Schema = z.strictObject({
  kind: z.literal("semantic-depth-work-item"),
  schemaVersion: z.literal(2),
  id: digestSchema,
  predecessorDecisionDigest: digestSchema,
  target: targetSnapshotRefSchema,
  manifest: targetFileManifestRefSchema,
  wave: semanticWorkWaveRefSchema,
  sourceAction: z.enum(["admit-depth", "schedule-work"]),
  families: z.array(approachFamilyRefV3Schema).max(4),
  subjects: z.array(explorationSubjectRefSchema).min(1),
  directive: depthWorkDirectiveSchema,
});

export const semanticDepthWorkQueueV2Schema = z.strictObject({
  kind: z.literal("semantic-depth-work-queue"),
  schemaVersion: z.literal(2),
  predecessorDecisionDigest: digestSchema,
  target: targetSnapshotRefSchema,
  manifest: targetFileManifestRefSchema,
  wave: semanticWorkWaveRefSchema,
  items: z.array(semanticDepthWorkItemV2Schema),
  batches: z.array(semanticDepthWorkBatchSchema),
});

export const semanticDepthWorkQueueRefV2Schema = z.strictObject({
  kind: z.literal("semantic-depth-work-queue"),
  schemaVersion: z.literal(2),
  predecessorDecisionDigest: digestSchema,
  targetSnapshotDigest: digestSchema,
  manifestDigest: digestSchema,
  digest: digestSchema,
  items: z.number().int().nonnegative(),
  batches: z.number().int().nonnegative(),
  familyBindings: z.number().int().nonnegative(),
});

export type SemanticDepthWorkItem = z.infer<typeof semanticDepthWorkItemSchema>;
export type SemanticDepthWorkQueue = z.infer<
  typeof semanticDepthWorkQueueSchema
>;
export type SemanticDepthWorkQueueRef = z.infer<
  typeof semanticDepthWorkQueueRefSchema
>;
export type SemanticDepthWorkItemV2 = z.infer<
  typeof semanticDepthWorkItemV2Schema
>;
export type SemanticDepthWorkQueueV2 = z.infer<
  typeof semanticDepthWorkQueueV2Schema
>;
export type SemanticDepthWorkQueueRefV2 = z.infer<
  typeof semanticDepthWorkQueueRefV2Schema
>;

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function sortedSubjects(
  subjects: readonly IterationActionV2["subjects"][number][],
) {
  return [...subjects].sort(
    (left, right) =>
      compareText(left.kind, right.kind) ||
      compareText(left.id, right.id) ||
      compareText(left.digest, right.digest),
  );
}

function validateActionBinding(
  decision: IterationDecisionV2,
  action: Extract<IterationActionV2, { kind: "admit-depth" | "schedule-work" }>,
): void {
  const provenance =
    action.kind === "admit-depth" ? action.admission : action.work;
  const evaluationSubjects = new Map(
    decision.evaluationSubjects.map((subject) => [subject.digest, subject]),
  );
  if (
    canonicalJson(provenance.target) !== canonicalJson(decision.target) ||
    canonicalJson(provenance.manifest) !== canonicalJson(decision.manifest) ||
    canonicalJson(provenance.wave) !== canonicalJson(decision.wave) ||
    action.subjects.some((subject) => {
      const expected = evaluationSubjects.get(subject.digest);
      return (
        expected === undefined ||
        canonicalJson(expected) !== canonicalJson(subject) ||
        subject.targetSnapshotDigest !== decision.target.digest ||
        subject.manifestDigest !== decision.manifest.digest ||
        ("workWaveDigest" in subject &&
          subject.workWaveDigest !== decision.wave.digest)
      );
    })
  ) {
    throw new Error("Depth work action binding mismatch");
  }
}

function projectItem(
  decision: IterationDecisionV2,
  predecessorDecisionDigest: string,
  action: Extract<IterationActionV2, { kind: "admit-depth" | "schedule-work" }>,
  families: readonly ApproachFamilyRef[],
): SemanticDepthWorkItem {
  validateActionBinding(decision, action);
  const subjects = sortedSubjects(action.subjects);
  const directive =
    action.kind === "admit-depth"
      ? {
          kind: action.admission.kind,
          sourceId: action.admission.id,
          highImpactPotential: action.admission.highImpactPotential,
          composition: action.admission.composition,
          falsifier: action.admission.falsifier,
          nextAction: action.admission.nextAction,
        }
      : {
          kind: action.work.kind,
          sourceId: action.work.id,
          requiredFact: action.work.requiredFact,
          falsifier: action.work.falsifier,
          nextAction: action.work.nextAction,
        };
  const identity = {
    kind: "semantic-depth-work-item",
    predecessorDecisionDigest,
    sourceAction: action.kind,
    families,
    subjects,
    directive,
  } as const;
  return semanticDepthWorkItemSchema.parse({
    ...identity,
    schemaVersion: 1,
    id: sha256Digest(identity),
    target: decision.target,
    manifest: decision.manifest,
    wave: decision.wave,
  });
}

function projectActionFamilies(
  decision: IterationDecisionV2,
  registryValue: ApproachFamilyRegistry | undefined,
): ReadonlyMap<string, readonly ApproachFamilyRef[]> {
  if (registryValue === undefined) return new Map();
  const registry = approachFamilyRegistrySchema.parse(registryValue);
  if (
    canonicalJson(registry.target) !== canonicalJson(decision.target) ||
    canonicalJson(registry.manifest) !== canonicalJson(decision.manifest)
  ) {
    throw new Error("Depth work queue Family Registry binding mismatch");
  }
  const admissions = decision.actions
    .filter((action) => action.kind === "admit-depth")
    .sort((left, right) => compareText(left.admission.id, right.admission.id));
  const opened = registry.families
    .filter(
      (family) => family.openingDecision.digest === sha256Digest(decision),
    )
    .sort((left, right) => left.ordinal - right.ordinal);
  if (admissions.length !== opened.length) {
    throw new Error("Depth Admission and Approach Family count mismatch");
  }
  const result = new Map<string, readonly ApproachFamilyRef[]>();
  admissions.forEach((action, index) => {
    const family = opened[index];
    if (family === undefined) {
      throw new Error("Depth Admission lost its Approach Family");
    }
    result.set(action.admission.id, [referenceApproachFamily(family)]);
  });
  for (const action of decision.actions) {
    if (action.kind !== "schedule-work") continue;
    const subjectDigests = new Set(
      action.subjects.map((subject) => subject.digest),
    );
    result.set(
      action.work.id,
      registry.families
        .filter((family) =>
          family.evidence.some((subject) => subjectDigests.has(subject.digest)),
        )
        .map(referenceApproachFamily)
        .sort((left, right) => compareText(left.id, right.id)),
    );
  }
  return result;
}

export function projectSemanticDepthWorkQueue(
  value: IterationDecisionV2,
  registryValue?: ApproachFamilyRegistry,
): {
  readonly value: SemanticDepthWorkQueue;
  readonly ref: SemanticDepthWorkQueueRef;
} {
  const decision = iterationDecisionV2Schema.parse(value);
  const actionFamilies = projectActionFamilies(decision, registryValue);
  const predecessorDecisionDigest = sha256Digest(decision);
  const items = decision.actions
    .filter(
      (
        action,
      ): action is Extract<
        IterationActionV2,
        { kind: "admit-depth" | "schedule-work" }
      > => action.kind === "admit-depth" || action.kind === "schedule-work",
    )
    .map((action) => {
      const sourceId =
        action.kind === "admit-depth" ? action.admission.id : action.work.id;
      return projectItem(
        decision,
        predecessorDecisionDigest,
        action,
        actionFamilies.get(sourceId) ?? [],
      );
    })
    .sort((left, right) => compareText(left.id, right.id));
  if (new Set(items.map((item) => item.id)).size !== items.length) {
    throw new Error("Depth work queue contains duplicate work items");
  }
  const batches = Array.from(
    { length: Math.ceil(items.length / 4) },
    (_, index) => {
      const itemIds = items
        .slice(index * 4, index * 4 + 4)
        .map((item) => item.id);
      const ordinal = index + 1;
      return semanticDepthWorkBatchSchema.parse({
        kind: "semantic-depth-work-batch",
        schemaVersion: 1,
        id: sha256Digest({
          kind: "semantic-depth-work-batch",
          predecessorDecisionDigest,
          ordinal,
          itemIds,
        }),
        ordinal,
        itemIds,
      });
    },
  );
  const queue = semanticDepthWorkQueueSchema.parse({
    kind: "semantic-depth-work-queue",
    schemaVersion: 1,
    predecessorDecisionDigest,
    target: decision.target,
    manifest: decision.manifest,
    wave: decision.wave,
    items,
    batches,
  });
  const digest = sha256Digest(queue);
  return {
    value: queue,
    ref: semanticDepthWorkQueueRefSchema.parse({
      kind: "semantic-depth-work-queue",
      schemaVersion: 1,
      predecessorDecisionDigest,
      targetSnapshotDigest: decision.target.digest,
      manifestDigest: decision.manifest.digest,
      digest,
      items: items.length,
      batches: batches.length,
    }),
  };
}

function validateActionBindingV3(
  decision: IterationDecisionV3,
  action: Extract<IterationActionV3, { kind: "admit-depth" | "schedule-work" }>,
): void {
  const provenance =
    action.kind === "admit-depth" ? action.admission : action.work;
  const evaluationSubjects = new Map(
    decision.evaluationSubjects.map((subject) => [subject.digest, subject]),
  );
  if (
    canonicalJson(provenance.target) !== canonicalJson(decision.target) ||
    canonicalJson(provenance.manifest) !== canonicalJson(decision.manifest) ||
    canonicalJson(provenance.wave) !== canonicalJson(decision.wave) ||
    action.subjects.some((subject) => {
      const expected = evaluationSubjects.get(subject.digest);
      return (
        expected === undefined ||
        canonicalJson(expected) !== canonicalJson(subject) ||
        subject.targetSnapshotDigest !== decision.target.digest ||
        subject.manifestDigest !== decision.manifest.digest ||
        ("workWaveDigest" in subject &&
          subject.workWaveDigest !== decision.wave.digest)
      );
    })
  ) {
    throw new Error("Depth work action v3 binding mismatch");
  }
}

function projectActionFamiliesV3(
  decision: IterationDecisionV3,
  registryValue: ApproachFamilyRegistryV3,
): ReadonlyMap<string, readonly ApproachFamilyRefV3[]> {
  const registry = approachFamilyRegistryV3Schema.parse(registryValue);
  if (
    canonicalJson(registry.target) !== canonicalJson(decision.target) ||
    canonicalJson(registry.manifest) !== canonicalJson(decision.manifest)
  ) {
    throw new Error("Depth work queue Family Registry v3 binding mismatch");
  }
  const result = new Map<string, readonly ApproachFamilyRefV3[]>();
  for (const action of decision.actions) {
    if (action.kind === "admit-depth") {
      const family = registry.families.find(
        (candidate) =>
          candidate.openingAdmission.id === action.approachFamily.id &&
          canonicalJson(candidate.openingAdmission) ===
            canonicalJson(action.approachFamily),
      );
      if (family === undefined) {
        throw new Error("Depth Admission lost its Approach Family v3");
      }
      result.set(action.admission.id, [referenceApproachFamilyV3(family)]);
      continue;
    }
    if (action.kind !== "schedule-work") continue;
    const subjectDigests = new Set(
      action.subjects.map((subject) => subject.digest),
    );
    result.set(
      action.work.id,
      registry.families
        .filter((family) =>
          family.evidence.some((subject) => subjectDigests.has(subject.digest)),
        )
        .map(referenceApproachFamilyV3)
        .sort((left, right) => compareText(left.id, right.id)),
    );
  }
  return result;
}

function projectItemV2(
  decision: IterationDecisionV3,
  predecessorDecisionDigest: string,
  action: Extract<IterationActionV3, { kind: "admit-depth" | "schedule-work" }>,
  families: readonly ApproachFamilyRefV3[],
): SemanticDepthWorkItemV2 {
  validateActionBindingV3(decision, action);
  const subjects = [...action.subjects].sort(
    (left, right) =>
      compareText(left.kind, right.kind) ||
      compareText(left.id, right.id) ||
      compareText(left.digest, right.digest),
  );
  const directive =
    action.kind === "admit-depth"
      ? {
          kind: action.admission.kind,
          sourceId: action.admission.id,
          highImpactPotential: action.admission.highImpactPotential,
          composition: action.admission.composition,
          falsifier: action.admission.falsifier,
          nextAction: action.admission.nextAction,
        }
      : {
          kind: action.work.kind,
          sourceId: action.work.id,
          requiredFact: action.work.requiredFact,
          falsifier: action.work.falsifier,
          nextAction: action.work.nextAction,
        };
  const identity = {
    kind: "semantic-depth-work-item",
    schemaVersion: 2,
    predecessorDecisionDigest,
    sourceAction: action.kind,
    families,
    subjects,
    directive,
  } as const;
  return semanticDepthWorkItemV2Schema.parse({
    ...identity,
    id: sha256Digest(identity),
    target: decision.target,
    manifest: decision.manifest,
    wave: decision.wave,
  });
}

export function projectSemanticDepthWorkQueueV2(
  value: IterationDecisionV3,
  registryValue: ApproachFamilyRegistryV3,
): {
  readonly value: SemanticDepthWorkQueueV2;
  readonly ref: SemanticDepthWorkQueueRefV2;
} {
  const decision = iterationDecisionV3Schema.parse(value);
  const actionFamilies = projectActionFamiliesV3(decision, registryValue);
  const predecessorDecisionDigest = sha256Digest(decision);
  const items = decision.actions
    .filter(
      (
        action,
      ): action is Extract<
        IterationActionV3,
        { kind: "admit-depth" | "schedule-work" }
      > => action.kind === "admit-depth" || action.kind === "schedule-work",
    )
    .map((action) => {
      const sourceId =
        action.kind === "admit-depth" ? action.admission.id : action.work.id;
      return projectItemV2(
        decision,
        predecessorDecisionDigest,
        action,
        actionFamilies.get(sourceId) ?? [],
      );
    })
    .sort((left, right) => compareText(left.id, right.id));
  if (new Set(items.map((item) => item.id)).size !== items.length) {
    throw new Error("Depth work queue v2 contains duplicate work items");
  }
  const batches = Array.from(
    { length: Math.ceil(items.length / 4) },
    (_, index) => {
      const itemIds = items
        .slice(index * 4, index * 4 + 4)
        .map((item) => item.id);
      const ordinal = index + 1;
      return semanticDepthWorkBatchSchema.parse({
        kind: "semantic-depth-work-batch",
        schemaVersion: 1,
        id: sha256Digest({
          kind: "semantic-depth-work-batch",
          predecessorDecisionDigest,
          ordinal,
          itemIds,
        }),
        ordinal,
        itemIds,
      });
    },
  );
  const queue = semanticDepthWorkQueueV2Schema.parse({
    kind: "semantic-depth-work-queue",
    schemaVersion: 2,
    predecessorDecisionDigest,
    target: decision.target,
    manifest: decision.manifest,
    wave: decision.wave,
    items,
    batches,
  });
  return {
    value: queue,
    ref: semanticDepthWorkQueueRefV2Schema.parse({
      kind: queue.kind,
      schemaVersion: queue.schemaVersion,
      predecessorDecisionDigest,
      targetSnapshotDigest: decision.target.digest,
      manifestDigest: decision.manifest.digest,
      digest: sha256Digest(queue),
      items: items.length,
      batches: batches.length,
      familyBindings: items.reduce(
        (total, item) => total + item.families.length,
        0,
      ),
    }),
  };
}
