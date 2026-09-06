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
const identifierSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
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
  campaignId: identifierSchema,
  runId: identifierSchema,
  predecessorDecisionDigest: digestSchema,
  target: targetSnapshotRefSchema,
  manifest: targetFileManifestRefSchema,
  wave: semanticWorkWaveRefSchema,
  sourceAction: z.enum(["admit-depth", "schedule-work"]),
  families: z.array(approachFamilyRefV3Schema).min(1).max(64),
  subjects: z.array(explorationSubjectRefSchema).min(1),
  directive: depthWorkDirectiveSchema,
});

export const semanticDepthWorkQueueV2Schema = z
  .strictObject({
    kind: z.literal("semantic-depth-work-queue"),
    schemaVersion: z.literal(2),
    campaignId: identifierSchema,
    runId: identifierSchema,
    predecessorDecisionDigest: digestSchema,
    target: targetSnapshotRefSchema,
    manifest: targetFileManifestRefSchema,
    wave: semanticWorkWaveRefSchema,
    items: z.array(semanticDepthWorkItemV2Schema),
    batches: z.array(semanticDepthWorkBatchSchema),
  })
  .superRefine((queue, context) => {
    const itemIds = queue.items.map((item) => item.id);
    const expectedBatches = Array.from(
      { length: Math.ceil(itemIds.length / 4) },
      (_, index) => {
        const ordinal = index + 1;
        const batchItemIds = itemIds.slice(index * 4, index * 4 + 4);
        return {
          kind: "semantic-depth-work-batch" as const,
          schemaVersion: 1 as const,
          id: sha256Digest({
            kind: "semantic-depth-work-batch",
            predecessorDecisionDigest: queue.predecessorDecisionDigest,
            ordinal,
            itemIds: batchItemIds,
          }),
          ordinal,
          itemIds: batchItemIds,
        };
      },
    );
    const itemBindingMismatch = queue.items.some((item) => {
      const {
        id: _id,
        target: _target,
        manifest: _manifest,
        wave: _wave,
        ...identity
      } = item;
      return (
        item.campaignId !== queue.campaignId ||
        item.runId !== queue.runId ||
        item.predecessorDecisionDigest !== queue.predecessorDecisionDigest ||
        canonicalJson(item.target) !== canonicalJson(queue.target) ||
        canonicalJson(item.manifest) !== canonicalJson(queue.manifest) ||
        canonicalJson(item.wave) !== canonicalJson(queue.wave) ||
        item.id !== sha256Digest(identity) ||
        item.families.some(
          (family) =>
            family.targetSnapshotDigest !== queue.target.digest ||
            family.manifestDigest !== queue.manifest.digest ||
            family.openingDecisionDigest !== queue.predecessorDecisionDigest,
        )
      );
    });
    if (
      itemBindingMismatch ||
      new Set(itemIds).size !== itemIds.length ||
      canonicalJson([...itemIds].sort(compareText)) !==
        canonicalJson(itemIds) ||
      canonicalJson(expectedBatches) !== canonicalJson(queue.batches)
    ) {
      context.addIssue({
        code: "custom",
        message: "Depth Work Queue v2 binding mismatch",
      });
    }
  });

export const semanticDepthWorkQueueRefV2Schema = z.strictObject({
  kind: z.literal("semantic-depth-work-queue"),
  schemaVersion: z.literal(2),
  campaignId: identifierSchema,
  runId: identifierSchema,
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

// Keyed by the action's own position in the Decision. A v2 admit-depth action
// carries no Family reference, so its binding is intrinsically positional, and
// keying by a derived id let two actions worded alike share one entry.
function projectActionFamilies(
  decision: IterationDecisionV2,
  registryValue: ApproachFamilyRegistry | undefined,
): ReadonlyMap<number, readonly ApproachFamilyRef[]> {
  if (registryValue === undefined) return new Map();
  const registry = approachFamilyRegistrySchema.parse(registryValue);
  if (
    canonicalJson(registry.target) !== canonicalJson(decision.target) ||
    canonicalJson(registry.manifest) !== canonicalJson(decision.manifest)
  ) {
    throw new Error("Depth work queue Family Registry binding mismatch");
  }
  const admissions = decision.actions
    .map((action, index) => ({ action, index }))
    .filter(
      (
        entry,
      ): entry is {
        readonly action: Extract<IterationActionV2, { kind: "admit-depth" }>;
        readonly index: number;
      } => entry.action.kind === "admit-depth",
    )
    .sort(
      (left, right) =>
        compareText(left.action.admission.id, right.action.admission.id) ||
        left.index - right.index,
    );
  const opened = registry.families
    .filter(
      (family) => family.openingDecision.digest === sha256Digest(decision),
    )
    .sort((left, right) => left.ordinal - right.ordinal);
  if (admissions.length !== opened.length) {
    throw new Error("Depth Admission and Approach Family count mismatch");
  }
  const result = new Map<number, readonly ApproachFamilyRef[]>();
  admissions.forEach((entry, ordinal) => {
    const family = opened[ordinal];
    if (family === undefined) {
      throw new Error("Depth Admission lost its Approach Family");
    }
    result.set(entry.index, [referenceApproachFamily(family)]);
  });
  decision.actions.forEach((action, index) => {
    if (action.kind !== "schedule-work") return;
    const subjectDigests = new Set(
      action.subjects.map((subject) => subject.digest),
    );
    result.set(
      index,
      registry.families
        .filter((family) =>
          family.evidence.some((subject) => subjectDigests.has(subject.digest)),
        )
        .map(referenceApproachFamily)
        .sort((left, right) => compareText(left.id, right.id)),
    );
  });
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
    .map((action, index) => ({ action, index }))
    .filter(
      (
        entry,
      ): entry is {
        readonly action: Extract<
          IterationActionV2,
          { kind: "admit-depth" | "schedule-work" }
        >;
        readonly index: number;
      } =>
        entry.action.kind === "admit-depth" ||
        entry.action.kind === "schedule-work",
    )
    .map((entry) => {
      const families = actionFamilies.get(entry.index);
      // An empty Family list is the documented shape only when no Registry was
      // supplied. With one supplied, a missing entry is a disagreement, not an
      // action that happens to belong to nothing.
      if (families === undefined && registryValue !== undefined) {
        throw new Error("Depth work action lost its Approach Family binding");
      }
      return projectItem(
        decision,
        predecessorDecisionDigest,
        entry.action,
        families ?? [],
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

function validateFamilyRegistryBindingV3(
  campaignId: string,
  runId: string,
  decision: IterationDecisionV3,
  predecessorDecisionDigest: string,
  registryValue: ApproachFamilyRegistryV3,
): ApproachFamilyRegistryV3 {
  const registry = approachFamilyRegistryV3Schema.parse(registryValue);
  if (
    registry.campaignId !== campaignId ||
    registry.runId !== runId ||
    canonicalJson(registry.target) !== canonicalJson(decision.target) ||
    canonicalJson(registry.manifest) !== canonicalJson(decision.manifest) ||
    !registry.decisions.some(
      (candidate) =>
        candidate.digest === predecessorDecisionDigest &&
        candidate.workWaveDigest === decision.wave.digest,
    )
  ) {
    throw new Error("Depth work queue Family Registry v3 binding mismatch");
  }
  return registry;
}

// Resolved from the action itself rather than through a lookup keyed by a
// derived id. A next-work-request id covers the work text but not the action's
// subjects, so two requests worded alike shared one key and the later one's
// Families silently replaced the earlier one's.
function resolveActionFamiliesV3(
  campaignId: string,
  runId: string,
  predecessorDecisionDigest: string,
  registry: ApproachFamilyRegistryV3,
  action: Extract<IterationActionV3, { kind: "admit-depth" | "schedule-work" }>,
): readonly ApproachFamilyRefV3[] {
  const subjectDigests = new Set(
    action.subjects.map((subject) => subject.digest),
  );
  const opened = registry.families.filter(
    (family) =>
      family.campaignId === campaignId &&
      family.runId === runId &&
      family.openingDecision.digest === predecessorDecisionDigest,
  );
  if (action.kind === "admit-depth") {
    const family = opened.find(
      (candidate) =>
        candidate.openingAdmission.id === action.approachFamily.id &&
        canonicalJson(candidate.openingAdmission) ===
          canonicalJson(action.approachFamily),
    );
    if (family === undefined) {
      throw new Error("Depth Admission lost its Approach Family v3");
    }
    // The Admission names a Family and the Family lists its own evidence. When
    // the two disagree the record states the binding twice and contradicts
    // itself, so neither copy is preferred.
    if (
      !family.evidence.some((subject) => subjectDigests.has(subject.digest))
    ) {
      throw new Error("Depth Admission left its Approach Family evidence v3");
    }
    return [referenceApproachFamilyV3(family)];
  }
  const families = opened
    .filter((family) =>
      family.evidence.some((subject) => subjectDigests.has(subject.digest)),
    )
    .map(referenceApproachFamilyV3)
    .sort((left, right) => compareText(left.id, right.id));
  if (families.length === 0) {
    throw new Error("Scheduled Depth work lost its Approach Family v3");
  }
  return families;
}

function projectItemV2(
  campaignId: string,
  runId: string,
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
    campaignId,
    runId,
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

export function projectSemanticDepthWorkQueueV2(input: {
  readonly campaignId: string;
  readonly runId: string;
  readonly decision: IterationDecisionV3;
  readonly registry: ApproachFamilyRegistryV3;
}): {
  readonly value: SemanticDepthWorkQueueV2;
  readonly ref: SemanticDepthWorkQueueRefV2;
} {
  const decision = iterationDecisionV3Schema.parse(input.decision);
  const predecessorDecisionDigest = sha256Digest(decision);
  const registry = validateFamilyRegistryBindingV3(
    input.campaignId,
    input.runId,
    decision,
    predecessorDecisionDigest,
    input.registry,
  );
  const items = decision.actions
    .filter(
      (
        action,
      ): action is Extract<
        IterationActionV3,
        { kind: "admit-depth" | "schedule-work" }
      > => action.kind === "admit-depth" || action.kind === "schedule-work",
    )
    .map((action) =>
      projectItemV2(
        input.campaignId,
        input.runId,
        decision,
        predecessorDecisionDigest,
        action,
        resolveActionFamiliesV3(
          input.campaignId,
          input.runId,
          predecessorDecisionDigest,
          registry,
          action,
        ),
      ),
    )
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
    campaignId: input.campaignId,
    runId: input.runId,
    predecessorDecisionDigest,
    target: decision.target,
    manifest: decision.manifest,
    wave: decision.wave,
    items,
    batches,
  });
  return { value: queue, ref: referenceSemanticDepthWorkQueueV2(queue) };
}

export function referenceSemanticDepthWorkQueueV2(
  value: SemanticDepthWorkQueueV2,
): SemanticDepthWorkQueueRefV2 {
  const queue = semanticDepthWorkQueueV2Schema.parse(value);
  return semanticDepthWorkQueueRefV2Schema.parse({
    kind: queue.kind,
    schemaVersion: queue.schemaVersion,
    campaignId: queue.campaignId,
    runId: queue.runId,
    predecessorDecisionDigest: queue.predecessorDecisionDigest,
    targetSnapshotDigest: queue.target.digest,
    manifestDigest: queue.manifest.digest,
    digest: sha256Digest(queue),
    items: queue.items.length,
    batches: queue.batches.length,
    familyBindings: queue.items.reduce(
      (total, item) => total + item.families.length,
      0,
    ),
  });
}
