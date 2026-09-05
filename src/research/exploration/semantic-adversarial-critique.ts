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
import { currentResearchAttackerScopePrompt } from "../current-research-attacker-scope.js";
import {
  targetFileManifestRefSchema,
  targetFileManifestSchema,
} from "../source-mapping/contracts.js";
import {
  sourceToolPolicyRefSchema,
  type SourceToolPolicyRef,
} from "../source-mapping/source-evidence-contracts.js";
import {
  chainProposalSchema,
  chainSynthesisSchema,
  type ChainProposal,
  type ChainSynthesis,
} from "./semantic-chain-synthesis.js";

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

export const chainProposalRefSchema = z.strictObject({
  kind: z.literal("chain-proposal"),
  schemaVersion: z.literal(1),
  id: digestSchema,
  targetSnapshotDigest: digestSchema,
  manifestDigest: digestSchema,
  queueDigest: digestSchema,
  batchId: digestSchema,
});

export const chainSynthesisRefSchema = z.strictObject({
  kind: z.literal("chain-synthesis"),
  schemaVersion: z.literal(1),
  id: digestSchema,
  targetSnapshotDigest: digestSchema,
  manifestDigest: digestSchema,
  queueDigest: digestSchema,
  batchId: digestSchema,
  proposals: z.number().int().nonnegative(),
});

const criticChallengeSchema = z.strictObject({
  category: z.enum([
    "attacker-premise",
    "actor",
    "state-identity",
    "request-ordering",
    "defense",
    "causal-hop",
    "source-binding",
  ]),
  claim: boundedTextSchema,
  evidence: z.array(sourceEvidenceAnchorSchema).min(1).max(32),
  reason: boundedTextSchema,
  falsifier: boundedTextSchema,
});

const criticGapOutputSchema = z.strictObject({
  requiredFact: boundedTextSchema,
  sourceEvidence: z.array(sourceEvidenceAnchorSchema).min(1).max(32),
  expectedObservation: boundedTextSchema,
  falsifier: boundedTextSchema,
  nextAction: boundedTextSchema,
});

const criticDispositionOutputBase = {
  proposalId: digestSchema,
  challenges: z.array(criticChallengeSchema).max(64),
};

const criticDispositionOutputSchema = z.discriminatedUnion("verdict", [
  z.strictObject({
    ...criticDispositionOutputBase,
    verdict: z.literal("survives"),
  }),
  z.strictObject({
    ...criticDispositionOutputBase,
    verdict: z.literal("needs-evidence"),
    gap: criticGapOutputSchema,
  }),
  z.strictObject({
    ...criticDispositionOutputBase,
    verdict: z.literal("contradicted"),
  }),
]);

export const adversarialCriticOutputSchema = z.strictObject({
  kind: z.literal("adversarial-critic-output"),
  schemaVersion: z.literal(1),
  dispositions: z.array(criticDispositionOutputSchema).max(32),
});

const criticAttemptRefSchema = attemptExecutionResultV2RefSchema.extend({
  owner: z.literal("exploration"),
  role: z.literal("adversarial-critic"),
});

export const criticFrontierGapSchema = z.strictObject({
  kind: z.literal("critic-frontier-gap"),
  schemaVersion: z.literal(1),
  id: digestSchema,
  target: chainSynthesisSchema.shape.target,
  manifest: targetFileManifestRefSchema,
  synthesis: chainSynthesisRefSchema,
  predecessorProposal: chainProposalRefSchema,
  attempt: criticAttemptRefSchema,
  requiredFact: boundedTextSchema,
  sourceEvidence: z.array(sourceEvidenceAnchorSchema).min(1).max(32),
  expectedObservation: boundedTextSchema,
  falsifier: boundedTextSchema,
  nextAction: boundedTextSchema,
});

export const criticFrontierGapRefSchema = z.strictObject({
  kind: z.literal("critic-frontier-gap"),
  schemaVersion: z.literal(1),
  id: digestSchema,
  digest: digestSchema,
  targetSnapshotDigest: digestSchema,
  manifestDigest: digestSchema,
  synthesisId: digestSchema,
  proposalId: digestSchema,
});

const materializedChallengeSchema = criticChallengeSchema;
const critiqueDispositionSchema = z.discriminatedUnion("verdict", [
  z.strictObject({
    proposal: chainProposalRefSchema,
    verdict: z.literal("survives"),
    challenges: z.array(materializedChallengeSchema).max(64),
  }),
  z.strictObject({
    proposal: chainProposalRefSchema,
    verdict: z.literal("needs-evidence"),
    challenges: z.array(materializedChallengeSchema).max(64),
    gap: criticFrontierGapSchema,
  }),
  z.strictObject({
    proposal: chainProposalRefSchema,
    verdict: z.literal("contradicted"),
    challenges: z.array(materializedChallengeSchema).max(64),
  }),
]);

export const adversarialCritiqueSchema = z.strictObject({
  kind: z.literal("adversarial-critique"),
  schemaVersion: z.literal(1),
  id: digestSchema,
  target: chainSynthesisSchema.shape.target,
  manifest: targetFileManifestRefSchema,
  synthesis: chainSynthesisRefSchema,
  attempt: criticAttemptRefSchema,
  dispositions: z.array(critiqueDispositionSchema).min(1).max(32),
});

export const adversarialCritiqueRefSchema = z.strictObject({
  kind: z.literal("adversarial-critique"),
  schemaVersion: z.literal(1),
  id: digestSchema,
  targetSnapshotDigest: digestSchema,
  manifestDigest: digestSchema,
  synthesisId: digestSchema,
  dispositions: z.number().int().positive(),
});

export const adversarialCritiqueIncompleteSchema = z.strictObject({
  kind: z.literal("adversarial-critique-incomplete"),
  schemaVersion: z.literal(1),
  target: chainSynthesisSchema.shape.target,
  manifest: targetFileManifestRefSchema,
  synthesisId: digestSchema,
  attempts: z.array(criticAttemptRefSchema).max(1),
  reason: z.enum([
    "critic-failed",
    "invalid-output",
    "result-mismatch",
    "foreign-ref",
    "proposal-omission",
    "foreign-proposal",
    "foreign-source-anchor",
    "invalid-critique",
  ]),
});

export const semanticAdversarialCritiqueInputSchema = z.strictObject({
  kind: z.literal("critique-chain-synthesis"),
  schemaVersion: z.literal(1),
  synthesis: chainSynthesisSchema,
  manifest: z.strictObject({
    ref: targetFileManifestRefSchema,
    value: targetFileManifestSchema,
  }),
});

export type AdversarialCriticOutput = z.infer<
  typeof adversarialCriticOutputSchema
>;
export type ChainProposalRef = z.infer<typeof chainProposalRefSchema>;
export type ChainSynthesisRef = z.infer<typeof chainSynthesisRefSchema>;
export type CriticFrontierGap = z.infer<typeof criticFrontierGapSchema>;
export type CriticFrontierGapRef = z.infer<typeof criticFrontierGapRefSchema>;
export type AdversarialCritique = z.infer<typeof adversarialCritiqueSchema>;
export type AdversarialCritiqueRef = z.infer<
  typeof adversarialCritiqueRefSchema
>;
export type AdversarialCritiqueIncomplete = z.infer<
  typeof adversarialCritiqueIncompleteSchema
>;
export type SemanticAdversarialCritiqueInput = z.infer<
  typeof semanticAdversarialCritiqueInputSchema
>;
export type SemanticAdversarialCritiqueResult =
  AdversarialCritique | AdversarialCritiqueIncomplete;

export interface SemanticAdversarialCritique {
  critique(
    input: SemanticAdversarialCritiqueInput,
  ): Promise<SemanticAdversarialCritiqueResult>;
}

export interface OpenSemanticAdversarialCritiqueOptions {
  readonly modelExecution: ModelExecution;
  readonly promptSet: { readonly id: string; readonly digest: string };
  readonly modelProfile: StructuredModelProfile;
  readonly sourceToolPolicy: SourceToolPolicyRef;
  readonly budget: Extract<
    AttemptPlanV2,
    { role: "adversarial-critic" }
  >["budget"];
  readonly attemptNamespace?: string;
}

type FailureReason = AdversarialCritiqueIncomplete["reason"];

interface ValidatedContext {
  readonly synthesis: ChainSynthesis;
  readonly synthesisRef: ChainSynthesisRef;
  readonly proposalRefs: ReadonlyMap<string, ChainProposalRef>;
}

function same(left: unknown, right: unknown): boolean {
  return canonicalJson(left) === canonicalJson(right);
}

function unique(values: readonly string[]): boolean {
  return new Set(values).size === values.length;
}

function manifestContains(
  manifest: SemanticAdversarialCritiqueInput["manifest"]["value"],
  anchor: z.infer<typeof sourceEvidenceAnchorSchema>,
): boolean {
  return manifest.entries.some(
    (entry) => entry.path === anchor.path && entry.digest === anchor.fileDigest,
  );
}

export function referenceChainProposal(
  proposal: ChainProposal,
): ChainProposalRef {
  return chainProposalRefSchema.parse({
    kind: "chain-proposal",
    schemaVersion: 1,
    id: proposal.id,
    targetSnapshotDigest: proposal.target.digest,
    manifestDigest: proposal.manifest.digest,
    queueDigest: proposal.queue.digest,
    batchId: proposal.batchId,
  });
}

export function referenceChainSynthesis(
  synthesis: ChainSynthesis,
): ChainSynthesisRef {
  return chainSynthesisRefSchema.parse({
    kind: "chain-synthesis",
    schemaVersion: 1,
    id: synthesis.id,
    targetSnapshotDigest: synthesis.target.digest,
    manifestDigest: synthesis.manifest.digest,
    queueDigest: synthesis.queue.digest,
    batchId: synthesis.batchId,
    proposals: synthesis.proposals.length,
  });
}

export function referenceAdversarialCritique(
  critique: AdversarialCritique,
): AdversarialCritiqueRef {
  return adversarialCritiqueRefSchema.parse({
    kind: "adversarial-critique",
    schemaVersion: 1,
    id: critique.id,
    targetSnapshotDigest: critique.target.digest,
    manifestDigest: critique.manifest.digest,
    synthesisId: critique.synthesis.id,
    dispositions: critique.dispositions.length,
  });
}

export function referenceCriticFrontierGap(
  gap: CriticFrontierGap,
): CriticFrontierGapRef {
  const value = criticFrontierGapSchema.parse(gap);
  return criticFrontierGapRefSchema.parse({
    kind: "critic-frontier-gap",
    schemaVersion: 1,
    id: value.id,
    digest: sha256Digest(value),
    targetSnapshotDigest: value.target.digest,
    manifestDigest: value.manifest.digest,
    synthesisId: value.synthesis.id,
    proposalId: value.predecessorProposal.id,
  });
}

function validateContext(
  input: SemanticAdversarialCritiqueInput,
):
  | { readonly kind: "valid"; readonly context: ValidatedContext }
  | { readonly kind: "invalid"; readonly reason: FailureReason } {
  const { synthesis, manifest } = input;
  const { id: synthesisId, ...synthesisIdentity } = synthesis;
  if (
    synthesis.proposals.length === 0 ||
    synthesisId !== sha256Digest(synthesisIdentity) ||
    manifest.ref.digest !== sha256Digest(manifest.value) ||
    manifest.ref.targetSnapshotId !== manifest.value.targetSnapshot.id ||
    manifest.ref.targetSnapshotDigest !==
      manifest.value.targetSnapshot.digest ||
    !same(synthesis.manifest, manifest.ref) ||
    synthesis.target.id !== manifest.value.targetSnapshot.id ||
    synthesis.target.digest !== manifest.value.targetSnapshot.digest ||
    !unique(synthesis.proposals.map((proposal) => proposal.id))
  ) {
    return { kind: "invalid", reason: "foreign-ref" };
  }
  const proposalRefs = new Map<string, ChainProposalRef>();
  for (const proposal of synthesis.proposals) {
    const { id, ...identity } = proposal;
    if (
      id !== sha256Digest(identity) ||
      !same(proposal.target, synthesis.target) ||
      !same(proposal.manifest, synthesis.manifest) ||
      !same(proposal.queue, synthesis.queue) ||
      proposal.batchId !== synthesis.batchId ||
      !same(proposal.attempt, synthesis.attempt) ||
      proposal.subjects.some(
        (subject) =>
          subject.targetSnapshotDigest !== synthesis.target.digest ||
          subject.manifestDigest !== synthesis.manifest.digest,
      )
    ) {
      return { kind: "invalid", reason: "foreign-ref" };
    }
    if (
      proposal.steps.some((step) =>
        step.evidence.some(
          (anchor) => !manifestContains(manifest.value, anchor),
        ),
      )
    ) {
      return { kind: "invalid", reason: "foreign-source-anchor" };
    }
    proposalRefs.set(proposal.id, referenceChainProposal(proposal));
  }
  return {
    kind: "valid",
    context: {
      synthesis,
      synthesisRef: referenceChainSynthesis(synthesis),
      proposalRefs,
    },
  };
}

function outputJsonSchema(): Record<string, unknown> {
  const schema = z.toJSONSchema(adversarialCriticOutputSchema);
  delete schema.$schema;
  return schema;
}

function criticAttempt(
  context: ValidatedContext,
  options: OpenSemanticAdversarialCritiqueOptions,
): Extract<AttemptPlanV2, { role: "adversarial-critic" }> {
  const proposalIds = context.synthesis.proposals.map(
    (proposal) => proposal.id,
  );
  const attemptId = `adversarial-critic:${sha256Digest({
    synthesis: context.synthesisRef,
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
    role: "adversarial-critic",
    target: context.synthesis.target,
    manifest: context.synthesis.manifest,
    assignment: {
      kind: "chain-critique",
      schemaVersion: 1,
      synthesisDigest: context.synthesis.id,
      proposalIds,
    },
    promptSet: options.promptSet,
    modelProfile: options.modelProfile,
    prompt: [
      "Act as a fresh Adversarial Critic over an immutable Chain Synthesis artifact.",
      currentResearchAttackerScopePrompt,
      "Use the Manifest-bound source tools to independently challenge attacker premise, actor, state identity, request ordering, defenses, causal hops, and source binding.",
      "Disposition every proposal exactly once as survives, needs-evidence, or contradicted.",
      "A needs-evidence disposition must name one concrete Frontier Gap with a falsifier and next source action.",
      "Do not add semantic edges, produce a Finding or Verification verdict, schedule work, or change Family state.",
      `Chain synthesis context: ${canonicalJson(context.synthesis)}`,
    ].join("\n"),
    outputJsonSchema: outputJsonSchema(),
    sourceToolPolicy: options.sourceToolPolicy,
    budget: options.budget,
  });
  if (plan.role !== "adversarial-critic") {
    throw new Error("Critic attempt materialized with another role");
  }
  return plan;
}

function validateAttemptResult(
  plan: Extract<AttemptPlanV2, { role: "adversarial-critic" }>,
  result: AttemptExecutionResult,
):
  | {
      readonly kind: "completed";
      readonly attempt: AttemptExecutionResultV2["ref"] & {
        readonly role: "adversarial-critic";
      };
      readonly output: AdversarialCriticOutput;
    }
  | {
      readonly kind: "failed";
      readonly reason: FailureReason;
      readonly attempt?: AttemptExecutionResultV2["ref"] & {
        readonly role: "adversarial-critic";
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
    ref.data.role !== "adversarial-critic" ||
    value.data.role !== "adversarial-critic" ||
    ref.data.attemptId !== plan.attemptId ||
    value.data.attemptId !== plan.attemptId ||
    ref.data.planDigest !== planDigest ||
    value.data.planDigest !== planDigest ||
    ref.data.digest !== sha256Digest(value.data) ||
    result.status !== value.data.status
  ) {
    return { kind: "failed", reason: "result-mismatch" };
  }
  const attempt = { ...ref.data, role: "adversarial-critic" as const };
  if (value.data.status !== "completed") {
    return { kind: "failed", reason: "critic-failed", attempt };
  }
  const output = adversarialCriticOutputSchema.safeParse(value.data.output);
  return output.success
    ? { kind: "completed", attempt, output: output.data }
    : { kind: "failed", reason: "invalid-output", attempt };
}

function materialize(
  input: SemanticAdversarialCritiqueInput,
  context: ValidatedContext,
  attempt: AttemptExecutionResultV2["ref"] & {
    readonly role: "adversarial-critic";
  },
  output: AdversarialCriticOutput,
):
  | { readonly kind: "completed"; readonly value: AdversarialCritique }
  | { readonly kind: "failed"; readonly reason: FailureReason } {
  const dispositions = new Map<
    string,
    AdversarialCriticOutput["dispositions"][number]
  >();
  for (const disposition of output.dispositions) {
    if (!context.proposalRefs.has(disposition.proposalId)) {
      return { kind: "failed", reason: "foreign-proposal" };
    }
    if (dispositions.has(disposition.proposalId)) {
      return { kind: "failed", reason: "invalid-critique" };
    }
    const anchors = [
      ...disposition.challenges.flatMap((challenge) => challenge.evidence),
      ...(disposition.verdict === "needs-evidence"
        ? disposition.gap.sourceEvidence
        : []),
    ];
    if (
      anchors.some((anchor) => !manifestContains(input.manifest.value, anchor))
    ) {
      return { kind: "failed", reason: "foreign-source-anchor" };
    }
    dispositions.set(disposition.proposalId, disposition);
  }
  if (dispositions.size !== context.synthesis.proposals.length) {
    return { kind: "failed", reason: "proposal-omission" };
  }

  const materialized = context.synthesis.proposals.map((proposal) => {
    const disposition = dispositions.get(proposal.id);
    const proposalRef = context.proposalRefs.get(proposal.id);
    if (disposition === undefined || proposalRef === undefined) {
      throw new Error("Critique disposition lookup lost a validated proposal");
    }
    if (disposition.verdict !== "needs-evidence") {
      return critiqueDispositionSchema.parse({
        proposal: proposalRef,
        verdict: disposition.verdict,
        challenges: disposition.challenges,
      });
    }
    const gapIdentity = {
      kind: "critic-frontier-gap",
      schemaVersion: 1,
      target: context.synthesis.target,
      manifest: context.synthesis.manifest,
      synthesis: context.synthesisRef,
      predecessorProposal: proposalRef,
      attempt,
      ...disposition.gap,
    } as const;
    return critiqueDispositionSchema.parse({
      proposal: proposalRef,
      verdict: disposition.verdict,
      challenges: disposition.challenges,
      gap: criticFrontierGapSchema.parse({
        ...gapIdentity,
        id: sha256Digest(gapIdentity),
      }),
    });
  });
  const identity = {
    kind: "adversarial-critique",
    schemaVersion: 1,
    target: context.synthesis.target,
    manifest: context.synthesis.manifest,
    synthesis: context.synthesisRef,
    attempt,
    dispositions: materialized,
  } as const;
  return {
    kind: "completed",
    value: adversarialCritiqueSchema.parse({
      ...identity,
      id: sha256Digest(identity),
    }),
  };
}

class FirstSemanticAdversarialCritique implements SemanticAdversarialCritique {
  readonly #options: OpenSemanticAdversarialCritiqueOptions;

  constructor(options: OpenSemanticAdversarialCritiqueOptions) {
    this.#options = {
      ...options,
      sourceToolPolicy: sourceToolPolicyRefSchema.parse(
        options.sourceToolPolicy,
      ),
    };
  }

  async critique(
    inputValue: SemanticAdversarialCritiqueInput,
  ): Promise<SemanticAdversarialCritiqueResult> {
    const input = semanticAdversarialCritiqueInputSchema.parse(inputValue);
    const validated = validateContext(input);
    if (validated.kind === "invalid") {
      return this.#incomplete(input, validated.reason, []);
    }
    const plan = criticAttempt(validated.context, this.#options);
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
    input: SemanticAdversarialCritiqueInput,
    reason: FailureReason,
    attempts: readonly (AttemptExecutionResultV2["ref"] & {
      readonly role: "adversarial-critic";
    })[],
  ): AdversarialCritiqueIncomplete {
    return adversarialCritiqueIncompleteSchema.parse({
      kind: "adversarial-critique-incomplete",
      schemaVersion: 1,
      target: input.synthesis.target,
      manifest: input.synthesis.manifest,
      synthesisId: input.synthesis.id,
      attempts,
      reason,
    });
  }
}

export function openSemanticAdversarialCritique(
  options: OpenSemanticAdversarialCritiqueOptions,
): SemanticAdversarialCritique {
  return new FirstSemanticAdversarialCritique(options);
}
