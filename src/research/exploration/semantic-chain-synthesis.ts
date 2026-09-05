import { z } from "zod";

import {
  attemptExecutionResultV2RefSchema,
  attemptPlanV2Schema,
  modelAttemptResultV2Schema,
  type AttemptExecutionResult,
  type AttemptExecutionResultV2,
  type AttemptPlanV2,
  type ModelExecution,
  type StructuredModelProfile,
} from "../model-execution/contracts.js";
import {
  canonicalJson,
  sha256Digest,
} from "../research-record/canonical-json.js";
import {
  targetFileManifestRefSchema,
  targetFileManifestSchema,
} from "../source-mapping/contracts.js";
import {
  explorationSubjectRefSchema,
  frontierGapArtifactRefSchema,
  frontierGapArtifactSchema,
  researchThesisRefSchema,
  researchThesisSchema,
  routeFragmentArtifactRefSchema,
  routeFragmentArtifactSchema,
  sourceBoundHypothesisArtifactRefSchema,
  sourceBoundHypothesisArtifactSchema,
  type ExplorationSubjectRef,
} from "./semantic-contracts.js";
import {
  semanticDepthWorkQueueRefSchema,
  semanticDepthWorkQueueRefV2Schema,
  semanticDepthWorkQueueSchema,
  semanticDepthWorkQueueV2Schema,
  type SemanticDepthWorkItem,
  type SemanticDepthWorkItemV2,
  type SemanticDepthWorkQueue,
  type SemanticDepthWorkQueueV2,
  type SemanticDepthWorkQueueRef,
  type SemanticDepthWorkQueueRefV2,
} from "./semantic-depth-work-queue.js";

const digestSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const boundedTextSchema = z.string().min(1).max(1_000);
const sourceEvidenceAnchorSchema = z
  .strictObject({
    path: z.string().min(1).max(4_096),
    fileDigest: digestSchema,
    startLine: z.number().int().positive(),
    endLine: z.number().int().positive(),
  })
  .refine((anchor) => anchor.endLine >= anchor.startLine, {
    message: "Source evidence endLine must not precede startLine",
  });

const itemDispositionSchema = z.strictObject({
  itemId: digestSchema,
  disposition: z.enum(["used", "retained-no-connection"]),
  reason: boundedTextSchema,
});

const chainStepSchema = z.strictObject({
  ordinal: z.number().int().positive(),
  relation: z.enum(["observed", "proposed-connection"]),
  actor: boundedTextSchema,
  request: boundedTextSchema,
  stateIdentity: boundedTextSchema,
  consumedValues: z.array(boundedTextSchema),
  producedValues: z.array(boundedTextSchema),
  evidence: z.array(sourceEvidenceAnchorSchema).min(1).max(32),
});

const chainProposalOutputSchema = z.strictObject({
  itemIds: z.array(digestSchema).min(1).max(4),
  subjectDigests: z.array(digestSchema).min(2).max(64),
  attackerPremise: z.enum([
    "unauthenticated",
    "subscriber",
    "contributor",
    "customer",
    "unresolved",
  ]),
  securityProperty: boundedTextSchema,
  steps: z.array(chainStepSchema).min(2).max(32),
  unknowns: z
    .array(
      z.strictObject({
        claim: boundedTextSchema,
        requiredEvidence: boundedTextSchema,
      }),
    )
    .min(1)
    .max(32),
  falsifier: boundedTextSchema,
  nextAction: boundedTextSchema,
});

export const rootSynthesisOutputSchema = z.strictObject({
  kind: z.literal("root-synthesis-output"),
  schemaVersion: z.literal(1),
  itemDispositions: z.array(itemDispositionSchema).min(1).max(4),
  proposals: z.array(chainProposalOutputSchema).max(32),
});

const attemptRefSchema = attemptExecutionResultV2RefSchema.extend({
  owner: z.literal("exploration"),
  role: z.literal("root-synthesizer"),
});

export const chainProposalSchema = z.strictObject({
  kind: z.literal("chain-proposal"),
  schemaVersion: z.literal(1),
  id: digestSchema,
  target: semanticDepthWorkQueueSchema.shape.target,
  manifest: targetFileManifestRefSchema,
  queue: z.union([
    semanticDepthWorkQueueRefV2Schema,
    semanticDepthWorkQueueRefSchema,
  ]),
  batchId: digestSchema,
  attempt: attemptRefSchema,
  itemIds: z.array(digestSchema).min(1).max(4),
  subjects: z.array(explorationSubjectRefSchema).min(2).max(64),
  attackerPremise: chainProposalOutputSchema.shape.attackerPremise,
  securityProperty: boundedTextSchema,
  steps: z.array(chainStepSchema).min(2).max(32),
  unknowns: chainProposalOutputSchema.shape.unknowns,
  falsifier: boundedTextSchema,
  nextAction: boundedTextSchema,
});

export const chainSynthesisSchema = z.strictObject({
  kind: z.literal("chain-synthesis"),
  schemaVersion: z.literal(1),
  id: digestSchema,
  target: semanticDepthWorkQueueSchema.shape.target,
  manifest: targetFileManifestRefSchema,
  queue: z.union([
    semanticDepthWorkQueueRefV2Schema,
    semanticDepthWorkQueueRefSchema,
  ]),
  batchId: digestSchema,
  attempt: attemptRefSchema,
  itemDispositions: z.array(itemDispositionSchema).min(1).max(4),
  proposals: z.array(chainProposalSchema).max(32),
});

export const chainSynthesisIncompleteSchema = z.strictObject({
  kind: z.literal("chain-synthesis-incomplete"),
  schemaVersion: z.literal(1),
  target: semanticDepthWorkQueueSchema.shape.target,
  manifest: targetFileManifestRefSchema,
  queue: z.union([
    semanticDepthWorkQueueRefV2Schema,
    semanticDepthWorkQueueRefSchema,
  ]),
  batchId: digestSchema,
  attempts: z.array(attemptRefSchema).max(1),
  reason: z.enum([
    "synthesizer-failed",
    "invalid-output",
    "result-mismatch",
    "foreign-ref",
    "item-omission",
    "foreign-item",
    "foreign-subject",
    "foreign-source-anchor",
    "invalid-proposal",
  ]),
});

const subjectArtifactSchema = z.union([
  z.strictObject({
    ref: researchThesisRefSchema,
    value: researchThesisSchema,
  }),
  z.strictObject({
    ref: sourceBoundHypothesisArtifactRefSchema,
    value: sourceBoundHypothesisArtifactSchema,
  }),
  z.strictObject({
    ref: routeFragmentArtifactRefSchema,
    value: routeFragmentArtifactSchema,
  }),
  z.strictObject({
    ref: frontierGapArtifactRefSchema,
    value: frontierGapArtifactSchema,
  }),
]);

export const semanticChainSynthesisInputSchema = z.strictObject({
  kind: z.literal("synthesize-depth-work"),
  schemaVersion: z.literal(1),
  queue: z.union([
    z.strictObject({
      ref: semanticDepthWorkQueueRefV2Schema,
      value: semanticDepthWorkQueueV2Schema,
    }),
    z.strictObject({
      ref: semanticDepthWorkQueueRefSchema,
      value: semanticDepthWorkQueueSchema,
    }),
  ]),
  batchId: digestSchema,
  manifest: z.strictObject({
    ref: targetFileManifestRefSchema,
    value: targetFileManifestSchema,
  }),
  subjects: z.array(subjectArtifactSchema).min(1).max(64),
});

export type RootSynthesisOutput = z.infer<typeof rootSynthesisOutputSchema>;
export type ChainProposal = z.infer<typeof chainProposalSchema>;
export type ChainSynthesis = z.infer<typeof chainSynthesisSchema>;
export type ChainSynthesisIncomplete = z.infer<
  typeof chainSynthesisIncompleteSchema
>;
export type SemanticChainSynthesisInput = z.infer<
  typeof semanticChainSynthesisInputSchema
>;
export type SemanticChainSynthesisResult =
  ChainSynthesis | ChainSynthesisIncomplete;

export interface SemanticChainSynthesis {
  synthesize(
    input: SemanticChainSynthesisInput,
  ): Promise<SemanticChainSynthesisResult>;
}

export interface OpenSemanticChainSynthesisOptions {
  readonly modelExecution: ModelExecution;
  readonly promptSet: { readonly id: string; readonly digest: string };
  readonly modelProfile: StructuredModelProfile;
  readonly budget: Extract<
    AttemptPlanV2,
    { role: "root-synthesizer" }
  >["budget"];
  readonly attemptNamespace?: string;
}

type SubjectArtifact = SemanticChainSynthesisInput["subjects"][number];
type FailureReason = ChainSynthesisIncomplete["reason"];

interface ValidatedContext {
  readonly queue: SemanticDepthWorkQueue | SemanticDepthWorkQueueV2;
  readonly queueRef: SemanticDepthWorkQueueRef | SemanticDepthWorkQueueRefV2;
  readonly batch:
    | SemanticDepthWorkQueue["batches"][number]
    | SemanticDepthWorkQueueV2["batches"][number];
  readonly items: readonly (SemanticDepthWorkItem | SemanticDepthWorkItemV2)[];
  readonly subjects: readonly SubjectArtifact[];
}

function same(left: unknown, right: unknown): boolean {
  return canonicalJson(left) === canonicalJson(right);
}

function unique(values: readonly string[]): boolean {
  return new Set(values).size === values.length;
}

function subjectAnchors(subject: SubjectArtifact) {
  switch (subject.value.kind) {
    case "research-thesis":
      return subject.value.startingEvidence ?? [];
    case "source-bound-hypothesis":
      return subject.value.value.route.anchors;
    case "route-fragment":
      return subject.value.value.evidence;
    case "frontier-gap":
      return subject.value.value.sourceEvidence;
  }
}

function manifestContains(
  manifest: SemanticChainSynthesisInput["manifest"]["value"],
  anchor: z.infer<typeof sourceEvidenceAnchorSchema>,
): boolean {
  return manifest.entries.some(
    (entry) => entry.path === anchor.path && entry.digest === anchor.fileDigest,
  );
}

function subjectRefMatchesValue(subject: SubjectArtifact): boolean {
  if (
    subject.ref.kind !== subject.value.kind ||
    subject.ref.id !== subject.value.id ||
    subject.ref.digest !== sha256Digest(subject.value)
  ) {
    return false;
  }
  if (
    subject.ref.targetSnapshotDigest !== subject.value.target.digest ||
    subject.ref.manifestDigest !== subject.value.manifest.digest
  ) {
    return false;
  }
  if (subject.ref.kind === "research-thesis") {
    return subject.value.kind === "research-thesis";
  }
  if (subject.value.kind === "research-thesis") return false;
  const expectedId = sha256Digest({
    kind: subject.value.kind,
    targetSnapshotDigest: subject.value.target.digest,
    manifestDigest: subject.value.manifest.digest,
    value: subject.value.value,
  });
  return (
    subject.value.id === expectedId &&
    subject.ref.attemptId === subject.value.attemptId &&
    subject.ref.leaseId === subject.value.leaseId &&
    subject.ref.workWaveDigest === subject.value.workWave.digest
  );
}

function validateContext(
  input: SemanticChainSynthesisInput,
):
  | { readonly kind: "valid"; readonly context: ValidatedContext }
  | { readonly kind: "invalid"; readonly reason: FailureReason } {
  const { queue, manifest } = input;
  if (
    queue.ref.schemaVersion !== queue.value.schemaVersion ||
    queue.ref.digest !== sha256Digest(queue.value) ||
    queue.ref.predecessorDecisionDigest !==
      queue.value.predecessorDecisionDigest ||
    queue.ref.targetSnapshotDigest !== queue.value.target.digest ||
    queue.ref.manifestDigest !== queue.value.manifest.digest ||
    queue.ref.items !== queue.value.items.length ||
    queue.ref.batches !== queue.value.batches.length ||
    (queue.ref.schemaVersion === 2 &&
      (queue.value.schemaVersion !== 2 ||
        queue.ref.campaignId !== queue.value.campaignId ||
        queue.ref.runId !== queue.value.runId ||
        queue.ref.familyBindings !==
          queue.value.items.reduce(
            (total, item) => total + item.families.length,
            0,
          ))) ||
    manifest.ref.digest !== sha256Digest(manifest.value) ||
    manifest.ref.targetSnapshotId !== manifest.value.targetSnapshot.id ||
    manifest.ref.targetSnapshotDigest !==
      manifest.value.targetSnapshot.digest ||
    !same(queue.value.manifest, manifest.ref) ||
    queue.value.target.id !== manifest.value.targetSnapshot.id ||
    queue.value.target.digest !== manifest.value.targetSnapshot.digest
  ) {
    return { kind: "invalid", reason: "foreign-ref" };
  }
  const batch = queue.value.batches.find((value) => value.id === input.batchId);
  if (batch === undefined || !unique(batch.itemIds)) {
    return { kind: "invalid", reason: "foreign-ref" };
  }
  const itemsById = new Map(queue.value.items.map((item) => [item.id, item]));
  const items: (SemanticDepthWorkItem | SemanticDepthWorkItemV2)[] = [];
  for (const itemId of batch.itemIds) {
    const item = itemsById.get(itemId);
    if (
      item === undefined ||
      !same(item.target, queue.value.target) ||
      !same(item.manifest, queue.value.manifest) ||
      !same(item.wave, queue.value.wave)
    ) {
      return { kind: "invalid", reason: "foreign-ref" };
    }
    items.push(item);
  }
  const requiredSubjects = new Map<string, ExplorationSubjectRef>();
  for (const item of items) {
    for (const subject of item.subjects) {
      const existing = requiredSubjects.get(subject.digest);
      if (existing !== undefined && !same(existing, subject)) {
        return { kind: "invalid", reason: "foreign-ref" };
      }
      requiredSubjects.set(subject.digest, subject);
    }
  }
  if (
    !unique(input.subjects.map((subject) => subject.ref.digest)) ||
    input.subjects.length !== requiredSubjects.size
  ) {
    return { kind: "invalid", reason: "foreign-subject" };
  }
  for (const subject of input.subjects) {
    const required = requiredSubjects.get(subject.ref.digest);
    if (
      required === undefined ||
      !same(required, subject.ref) ||
      !subjectRefMatchesValue(subject) ||
      !same(subject.value.target, queue.value.target) ||
      !same(subject.value.manifest, queue.value.manifest) ||
      (subject.value.kind !== "research-thesis" &&
        !same(subject.value.workWave, queue.value.wave))
    ) {
      return { kind: "invalid", reason: "foreign-subject" };
    }
    if (
      subjectAnchors(subject).some(
        (anchor) => !manifestContains(manifest.value, anchor),
      )
    ) {
      return { kind: "invalid", reason: "foreign-source-anchor" };
    }
  }
  return {
    kind: "valid",
    context: {
      queue: queue.value,
      queueRef: queue.ref,
      batch,
      items,
      subjects: input.subjects,
    },
  };
}

function outputJsonSchema(): Record<string, unknown> {
  const schema = z.toJSONSchema(rootSynthesisOutputSchema);
  delete schema.$schema;
  return schema;
}

function rootSynthesisAttempt(
  context: ValidatedContext,
  options: OpenSemanticChainSynthesisOptions,
): Extract<AttemptPlanV2, { role: "root-synthesizer" }> {
  const subjectDigests = context.subjects.map((subject) => subject.ref.digest);
  const attemptId = `root-synthesizer:${sha256Digest({
    queue: context.queueRef,
    batchId: context.batch.id,
    promptSet: options.promptSet,
    modelProfile: options.modelProfile,
    ...(options.attemptNamespace === undefined
      ? {}
      : { namespace: options.attemptNamespace }),
  }).slice("sha256:".length)}`;
  const plan = attemptPlanV2Schema.parse({
    kind: "attempt-plan",
    schemaVersion: 2,
    attemptId,
    owner: "exploration",
    role: "root-synthesizer",
    target: context.queue.target,
    manifest: context.queue.manifest,
    assignment: {
      kind: "depth-synthesis",
      schemaVersion: 1,
      queueDigest: context.queueRef.digest,
      batchId: context.batch.id,
      itemIds: context.batch.itemIds,
      subjectDigests,
    },
    promptSet: options.promptSet,
    modelProfile: options.modelProfile,
    prompt: [
      "Act as a fresh Root Synthesizer over immutable semantic research artifacts.",
      "Use every Depth Work Item exactly once as used or retained-no-connection.",
      "Propose a chain only when at least two supplied subjects can be ordered by actor, request, state identity, and value flow.",
      "Distinguish source-observed relations from proposed connections. Preserve explicit unknowns, a falsifier, and the next action.",
      "Do not use support count, impact labels, vulnerability classes, or sink names as acceptance filters.",
      "Do not produce a Finding, run an attack, or claim that an unobserved connection is established.",
      `Depth synthesis context: ${canonicalJson({
        queue: context.queueRef,
        batch: context.batch,
        items: context.items,
        subjects: context.subjects,
      })}`,
    ].join("\n"),
    outputJsonSchema: outputJsonSchema(),
    budget: options.budget,
  });
  if (plan.role !== "root-synthesizer") {
    throw new Error("Root Synthesis attempt materialized with another role");
  }
  return plan;
}

function validateAttemptResult(
  plan: Extract<AttemptPlanV2, { role: "root-synthesizer" }>,
  result: AttemptExecutionResult,
):
  | {
      readonly kind: "completed";
      readonly attempt: AttemptExecutionResultV2["ref"] & {
        readonly role: "root-synthesizer";
      };
      readonly output: RootSynthesisOutput;
    }
  | {
      readonly kind: "failed";
      readonly reason: FailureReason;
      readonly attempt?: AttemptExecutionResultV2["ref"] & {
        readonly role: "root-synthesizer";
      };
    } {
  if (result.ref.schemaVersion !== 2 || result.value.schemaVersion !== 2) {
    return { kind: "failed", reason: "result-mismatch" };
  }
  const ref = attemptExecutionResultV2RefSchema.safeParse(result.ref);
  const value = modelAttemptResultV2Schema.safeParse(result.value);
  const planDigest = sha256Digest(plan);
  if (
    !ref.success ||
    !value.success ||
    ref.data.owner !== "exploration" ||
    value.data.owner !== "exploration" ||
    ref.data.role !== "root-synthesizer" ||
    value.data.role !== "root-synthesizer" ||
    ref.data.attemptId !== plan.attemptId ||
    value.data.attemptId !== plan.attemptId ||
    ref.data.planDigest !== planDigest ||
    value.data.planDigest !== planDigest ||
    ref.data.digest !== sha256Digest(value.data) ||
    result.status !== value.data.status
  ) {
    return { kind: "failed", reason: "result-mismatch" };
  }
  const attempt = { ...ref.data, role: "root-synthesizer" as const };
  if (value.data.status !== "completed") {
    return { kind: "failed", reason: "synthesizer-failed", attempt };
  }
  const output = rootSynthesisOutputSchema.safeParse(value.data.output);
  return output.success
    ? { kind: "completed", attempt, output: output.data }
    : { kind: "failed", reason: "invalid-output", attempt };
}

function materialize(
  input: SemanticChainSynthesisInput,
  context: ValidatedContext,
  attempt: AttemptExecutionResultV2["ref"] & {
    readonly role: "root-synthesizer";
  },
  output: RootSynthesisOutput,
):
  | { readonly kind: "completed"; readonly value: ChainSynthesis }
  | { readonly kind: "failed"; readonly reason: FailureReason } {
  const batchItems = new Map(context.items.map((item) => [item.id, item]));
  const dispositions = new Map<
    string,
    RootSynthesisOutput["itemDispositions"][number]
  >();
  for (const disposition of output.itemDispositions) {
    if (!batchItems.has(disposition.itemId)) {
      return { kind: "failed", reason: "foreign-item" };
    }
    if (dispositions.has(disposition.itemId)) {
      return { kind: "failed", reason: "invalid-proposal" };
    }
    dispositions.set(disposition.itemId, disposition);
  }
  if (dispositions.size !== context.items.length) {
    return { kind: "failed", reason: "item-omission" };
  }

  const subjectsByDigest = new Map(
    context.subjects.map((subject) => [subject.ref.digest, subject.ref]),
  );
  const proposals: ChainProposal[] = [];
  const usedItems = new Set<string>();
  for (const proposal of output.proposals) {
    if (!unique(proposal.itemIds) || !unique(proposal.subjectDigests)) {
      return { kind: "failed", reason: "invalid-proposal" };
    }
    const itemSubjects = new Set<string>();
    for (const itemId of proposal.itemIds) {
      const item = batchItems.get(itemId);
      if (item === undefined) {
        return { kind: "failed", reason: "foreign-item" };
      }
      if (dispositions.get(itemId)?.disposition !== "used") {
        return { kind: "failed", reason: "invalid-proposal" };
      }
      usedItems.add(itemId);
      for (const subject of item.subjects) itemSubjects.add(subject.digest);
    }
    const subjects: ExplorationSubjectRef[] = [];
    for (const digest of proposal.subjectDigests) {
      const subject = subjectsByDigest.get(digest);
      if (subject === undefined || !itemSubjects.has(digest)) {
        return { kind: "failed", reason: "foreign-subject" };
      }
      subjects.push(subject);
    }
    if (
      proposal.steps.some((step, index) => step.ordinal !== index + 1) ||
      !proposal.steps.some((step) => step.relation === "observed") ||
      !proposal.steps.some((step) => step.relation === "proposed-connection")
    ) {
      return { kind: "failed", reason: "invalid-proposal" };
    }
    if (
      proposal.steps.some((step) =>
        step.evidence.some(
          (anchor) => !manifestContains(input.manifest.value, anchor),
        ),
      )
    ) {
      return { kind: "failed", reason: "foreign-source-anchor" };
    }
    const identity = {
      kind: "chain-proposal",
      schemaVersion: 1,
      target: context.queue.target,
      manifest: context.queue.manifest,
      queue: context.queueRef,
      batchId: context.batch.id,
      attempt,
      itemIds: proposal.itemIds,
      subjects,
      attackerPremise: proposal.attackerPremise,
      securityProperty: proposal.securityProperty,
      steps: proposal.steps,
      unknowns: proposal.unknowns,
      falsifier: proposal.falsifier,
      nextAction: proposal.nextAction,
    } as const;
    proposals.push(
      chainProposalSchema.parse({ ...identity, id: sha256Digest(identity) }),
    );
  }
  for (const [itemId, disposition] of dispositions) {
    if (
      (disposition.disposition === "used" && !usedItems.has(itemId)) ||
      (disposition.disposition === "retained-no-connection" &&
        usedItems.has(itemId))
    ) {
      return { kind: "failed", reason: "invalid-proposal" };
    }
  }
  const itemDispositions = context.batch.itemIds.map((itemId) =>
    itemDispositionSchema.parse(dispositions.get(itemId)),
  );
  proposals.sort((left, right) => left.id.localeCompare(right.id));
  const identity = {
    kind: "chain-synthesis",
    schemaVersion: 1,
    target: context.queue.target,
    manifest: context.queue.manifest,
    queue: context.queueRef,
    batchId: context.batch.id,
    attempt,
    itemDispositions,
    proposals,
  } as const;
  return {
    kind: "completed",
    value: chainSynthesisSchema.parse({
      ...identity,
      id: sha256Digest(identity),
    }),
  };
}

class FirstSemanticChainSynthesis implements SemanticChainSynthesis {
  readonly #options: OpenSemanticChainSynthesisOptions;

  constructor(options: OpenSemanticChainSynthesisOptions) {
    this.#options = options;
  }

  async synthesize(
    inputValue: SemanticChainSynthesisInput,
  ): Promise<SemanticChainSynthesisResult> {
    const input = semanticChainSynthesisInputSchema.parse(inputValue);
    const validated = validateContext(input);
    if (validated.kind === "invalid") {
      return this.#incomplete(input, validated.reason, []);
    }
    const plan = rootSynthesisAttempt(validated.context, this.#options);
    const result = await this.#options.modelExecution.run(plan);
    const attemptResult = validateAttemptResult(plan, result);
    if (attemptResult.kind === "failed") {
      return this.#incomplete(
        input,
        attemptResult.reason,
        attemptResult.attempt === undefined ? [] : [attemptResult.attempt],
      );
    }
    const materialized = materialize(
      input,
      validated.context,
      attemptResult.attempt,
      attemptResult.output,
    );
    return materialized.kind === "completed"
      ? materialized.value
      : this.#incomplete(input, materialized.reason, [attemptResult.attempt]);
  }

  #incomplete(
    input: SemanticChainSynthesisInput,
    reason: FailureReason,
    attempts: readonly (AttemptExecutionResultV2["ref"] & {
      readonly role: "root-synthesizer";
    })[],
  ): ChainSynthesisIncomplete {
    return chainSynthesisIncompleteSchema.parse({
      kind: "chain-synthesis-incomplete",
      schemaVersion: 1,
      target: input.queue.value.target,
      manifest: input.queue.value.manifest,
      queue: input.queue.ref,
      batchId: input.batchId,
      attempts,
      reason,
    });
  }
}

export function openSemanticChainSynthesis(
  options: OpenSemanticChainSynthesisOptions,
): SemanticChainSynthesis {
  return new FirstSemanticChainSynthesis(options);
}
