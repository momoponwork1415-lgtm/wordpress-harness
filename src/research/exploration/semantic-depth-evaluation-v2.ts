import { z } from "zod";

import {
  attemptExecutionResultV2RefSchema,
  attemptPlanV2Schema,
  modelAttemptResultV2Schema,
  type AttemptExecutionResult,
  type AttemptPlanV2,
  type ModelExecution,
  type StructuredModelProfile,
} from "../model-execution/contracts.js";
import {
  canonicalJson,
  sha256Digest,
} from "../research-record/canonical-json.js";
import {
  currentResearchAttackerScopePrompt,
  isWithinCurrentResearchAttackerScope,
} from "../current-research-attacker-scope.js";
import { sourceBoundHypothesisSchema } from "./contracts.js";
import {
  adversarialCritiqueRefSchema,
  adversarialCritiqueSchema,
  chainProposalRefSchema,
  chainSynthesisRefSchema,
  referenceAdversarialCritique,
  referenceChainProposal,
  referenceCriticFrontierGap,
  type AdversarialCritique,
  type ChainProposalRef,
  type ChainSynthesisRef,
} from "./semantic-adversarial-critique.js";
import {
  approachFamilyRegistryRefV3Schema,
  approachFamilyRegistryV3Schema,
} from "./semantic-approach-family-registry-v3.js";
import {
  chainSynthesisSchema,
  type ChainSynthesis,
} from "./semantic-chain-synthesis.js";
import {
  depthRootEvaluatorOutputSchema,
  type DepthRootEvaluatorOutput,
} from "./semantic-depth-evaluation.js";

const digestSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const boundedTextSchema = z.string().min(1).max(1_000);

const currentDepthIterationActionSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("admit-validation"),
    proposal: chainProposalRefSchema,
    hypothesis: sourceBoundHypothesisSchema,
    reason: boundedTextSchema,
  }),
  z.strictObject({
    kind: z.literal("schedule-missing-link"),
    proposal: chainProposalRefSchema,
    gap: z.strictObject({
      kind: z.literal("critic-frontier-gap"),
      schemaVersion: z.literal(1),
      id: digestSchema,
      digest: digestSchema,
      targetSnapshotDigest: digestSchema,
      manifestDigest: digestSchema,
      synthesisId: digestSchema,
      proposalId: digestSchema,
    }),
    reason: boundedTextSchema,
  }),
  z.strictObject({
    kind: z.literal("retain-route"),
    proposal: chainProposalRefSchema,
    reason: boundedTextSchema,
  }),
  z.strictObject({
    kind: z.literal("close-route"),
    proposal: chainProposalRefSchema,
    reason: boundedTextSchema,
  }),
  z.strictObject({
    kind: z.literal("block-route"),
    proposal: chainProposalRefSchema,
    reason: boundedTextSchema,
    reopenWhen: boundedTextSchema,
  }),
]);

const currentDepthEvaluatorAttemptRefSchema =
  attemptExecutionResultV2RefSchema.extend({
    owner: z.literal("exploration"),
    role: z.literal("root-evaluator"),
  });

export const currentDepthIterationDecisionSchema = z.strictObject({
  kind: z.literal("depth-iteration-decision"),
  schemaVersion: z.literal(2),
  id: digestSchema,
  target: chainSynthesisSchema.shape.target,
  manifest: chainSynthesisSchema.shape.manifest,
  registry: approachFamilyRegistryRefV3Schema,
  synthesis: chainSynthesisRefSchema,
  critique: adversarialCritiqueRefSchema,
  attempt: currentDepthEvaluatorAttemptRefSchema,
  actions: z.array(currentDepthIterationActionSchema).min(1).max(32),
});

export const currentDepthIterationDecisionRefSchema = z.strictObject({
  kind: z.literal("depth-iteration-decision"),
  schemaVersion: z.literal(2),
  id: digestSchema,
  digest: digestSchema,
  targetSnapshotDigest: digestSchema,
  manifestDigest: digestSchema,
  registryDigest: digestSchema,
  synthesisId: digestSchema,
  critiqueId: digestSchema,
  actions: z.number().int().positive().max(32),
});

export const currentDepthEvaluationIncompleteSchema = z.strictObject({
  kind: z.literal("depth-evaluation-incomplete"),
  schemaVersion: z.literal(2),
  target: chainSynthesisSchema.shape.target,
  manifest: chainSynthesisSchema.shape.manifest,
  registry: approachFamilyRegistryRefV3Schema,
  synthesis: chainSynthesisRefSchema,
  critique: adversarialCritiqueRefSchema,
  attempts: z.array(currentDepthEvaluatorAttemptRefSchema).max(1),
  reason: z.enum([
    "evaluator-failed",
    "invalid-output",
    "result-mismatch",
    "proposal-omission",
    "foreign-proposal",
    "invalid-disposition",
  ]),
});

export const currentSemanticDepthEvaluationInputSchema = z.strictObject({
  kind: z.literal("evaluate-depth-research"),
  schemaVersion: z.literal(2),
  registry: z.strictObject({
    ref: approachFamilyRegistryRefV3Schema,
    value: approachFamilyRegistryV3Schema,
  }),
  synthesis: chainSynthesisSchema,
  critique: adversarialCritiqueSchema,
});

export type CurrentDepthIterationDecision = z.infer<
  typeof currentDepthIterationDecisionSchema
>;
export type CurrentDepthIterationDecisionRef = z.infer<
  typeof currentDepthIterationDecisionRefSchema
>;
export type CurrentDepthEvaluationIncomplete = z.infer<
  typeof currentDepthEvaluationIncompleteSchema
>;
export type CurrentSemanticDepthEvaluationInput = z.infer<
  typeof currentSemanticDepthEvaluationInputSchema
>;
export type CurrentSemanticDepthEvaluationResult =
  CurrentDepthIterationDecision | CurrentDepthEvaluationIncomplete;

export interface CurrentSemanticDepthEvaluation {
  evaluate(
    input: CurrentSemanticDepthEvaluationInput,
  ): Promise<CurrentSemanticDepthEvaluationResult>;
}

export interface OpenCurrentSemanticDepthEvaluationOptions {
  readonly modelExecution: ModelExecution;
  readonly promptSet: { readonly id: string; readonly digest: string };
  readonly modelProfile: StructuredModelProfile;
  readonly budget: Extract<AttemptPlanV2, { role: "root-evaluator" }>["budget"];
  readonly attemptNamespace?: string;
}

type FailureReason = CurrentDepthEvaluationIncomplete["reason"];

function validateInput(input: CurrentSemanticDepthEvaluationInput): {
  readonly synthesisRef: ChainSynthesisRef;
  readonly critiqueRef: ReturnType<typeof referenceAdversarialCritique>;
} {
  const synthesisRef: ChainSynthesisRef = {
    kind: "chain-synthesis",
    schemaVersion: 1,
    id: input.synthesis.id,
    targetSnapshotDigest: input.synthesis.target.digest,
    manifestDigest: input.synthesis.manifest.digest,
    queueDigest: input.synthesis.queue.digest,
    batchId: input.synthesis.batchId,
    proposals: input.synthesis.proposals.length,
  };
  const critiqueRef = referenceAdversarialCritique(input.critique);
  if (
    input.synthesis.queue.schemaVersion !== 2 ||
    input.synthesis.queue.campaignId !== input.registry.value.campaignId ||
    input.synthesis.queue.runId !== input.registry.value.runId ||
    input.registry.ref.digest !== sha256Digest(input.registry.value) ||
    input.registry.ref.campaignId !== input.registry.value.campaignId ||
    input.registry.ref.runId !== input.registry.value.runId ||
    input.registry.ref.targetSnapshotDigest !== input.synthesis.target.digest ||
    input.registry.ref.manifestDigest !== input.synthesis.manifest.digest ||
    canonicalJson(input.synthesis.manifest) !==
      canonicalJson(input.critique.manifest) ||
    canonicalJson(synthesisRef) !== canonicalJson(input.critique.synthesis)
  ) {
    throw new Error("Current Depth Evaluation input binding mismatch");
  }
  return { synthesisRef, critiqueRef };
}

function currentDepthAttempt(
  input: CurrentSemanticDepthEvaluationInput,
  refs: ReturnType<typeof validateInput>,
  options: OpenCurrentSemanticDepthEvaluationOptions,
): Extract<AttemptPlanV2, { role: "root-evaluator" }> {
  const attemptId = `depth-root-evaluator-v2:${sha256Digest({
    registry: input.registry.ref,
    synthesis: refs.synthesisRef,
    critique: refs.critiqueRef,
    ...(options.attemptNamespace === undefined
      ? {}
      : { namespace: options.attemptNamespace }),
  }).slice("sha256:".length)}`;
  const plan = attemptPlanV2Schema.parse({
    kind: "attempt-plan",
    schemaVersion: 2,
    attemptId,
    owner: "exploration",
    role: "root-evaluator",
    target: input.synthesis.target,
    manifest: input.synthesis.manifest,
    assignment: {
      kind: "depth-evaluation",
      schemaVersion: 1,
      registryDigest: input.registry.ref.digest,
      synthesisDigest: sha256Digest(input.synthesis),
      critiqueDigest: sha256Digest(input.critique),
      proposalIds: input.synthesis.proposals.map((proposal) => proposal.id),
    },
    promptSet: options.promptSet,
    modelProfile: options.modelProfile,
    prompt: [
      "Evaluate every critiqued Chain Proposal exactly once.",
      currentResearchAttackerScopePrompt,
      "A surviving source-bound route may be admitted to fresh source-only Validation. State its causal identity, exact attacker premise, impact, unresolved evidence, falsifier, and next experiment; the Harness derives route anchors from the Chain Proposal.",
      "A needs-evidence route may schedule only its concrete Critic Frontier Gap.",
      "A contradicted route must be closed and must not become a Finding.",
      `Depth evaluation context: ${canonicalJson({
        registry: input.registry,
        synthesis: input.synthesis,
        critique: input.critique,
      })}`,
    ].join("\n"),
    outputJsonSchema: (() => {
      const schema = z.toJSONSchema(depthRootEvaluatorOutputSchema);
      delete schema.$schema;
      return schema;
    })(),
    budget: options.budget,
  });
  if (plan.role !== "root-evaluator") {
    throw new Error("Current Depth evaluator materialized with another role");
  }
  return plan;
}

function resolveOutput(
  input: CurrentSemanticDepthEvaluationInput,
  refs: ReturnType<typeof validateInput>,
  output: DepthRootEvaluatorOutput,
  attempt: z.infer<typeof currentDepthEvaluatorAttemptRefSchema>,
):
  | {
      readonly kind: "completed";
      readonly value: CurrentDepthIterationDecision;
    }
  | { readonly kind: "failed"; readonly reason: FailureReason } {
  const proposals = new Map(
    input.synthesis.proposals.map((proposal) => [proposal.id, proposal]),
  );
  const critiques = new Map(
    input.critique.dispositions.map((disposition) => [
      disposition.proposal.id,
      disposition,
    ]),
  );
  const seen = new Set<string>();
  const actions: z.infer<typeof currentDepthIterationActionSchema>[] = [];
  for (const disposition of output.dispositions) {
    const proposal = proposals.get(disposition.proposalId);
    const critique = critiques.get(disposition.proposalId);
    if (proposal === undefined || critique === undefined) {
      return { kind: "failed", reason: "foreign-proposal" };
    }
    if (seen.has(disposition.proposalId)) {
      return { kind: "failed", reason: "invalid-disposition" };
    }
    seen.add(disposition.proposalId);
    const proposalRef: ChainProposalRef = referenceChainProposal(proposal);
    if (disposition.action === "request-verification") {
      if (
        critique.verdict !== "survives" ||
        !isWithinCurrentResearchAttackerScope(
          disposition.hypothesis.attackerPremise,
        )
      ) {
        return { kind: "failed", reason: "invalid-disposition" };
      }
      const anchors = [
        ...new Map(
          proposal.steps
            .flatMap((step) => step.evidence)
            .map((anchor) => [canonicalJson(anchor), anchor]),
        ).values(),
      ].sort(
        (left, right) =>
          left.path.localeCompare(right.path) ||
          left.startLine - right.startLine ||
          left.endLine - right.endLine ||
          left.fileDigest.localeCompare(right.fileDigest),
      );
      actions.push({
        kind: "admit-validation",
        proposal: proposalRef,
        hypothesis: sourceBoundHypothesisSchema.parse({
          kind: "source-bound-hypothesis",
          schemaVersion: 1,
          ...disposition.hypothesis,
          route: { anchors },
        }),
        reason: disposition.reason,
      });
      continue;
    }
    if (disposition.action === "schedule-missing-link") {
      if (
        critique.verdict !== "needs-evidence" ||
        disposition.gapId !== critique.gap.id
      ) {
        return { kind: "failed", reason: "invalid-disposition" };
      }
      actions.push({
        kind: disposition.action,
        proposal: proposalRef,
        gap: referenceCriticFrontierGap(critique.gap),
        reason: disposition.reason,
      });
      continue;
    }
    if (disposition.action === "close-route") {
      if (critique.verdict !== "contradicted") {
        return { kind: "failed", reason: "invalid-disposition" };
      }
      actions.push({
        kind: disposition.action,
        proposal: proposalRef,
        reason: disposition.reason,
      });
      continue;
    }
    if (disposition.action === "retain-route") {
      if (critique.verdict !== "survives") {
        return { kind: "failed", reason: "invalid-disposition" };
      }
      actions.push({
        kind: disposition.action,
        proposal: proposalRef,
        reason: disposition.reason,
      });
      continue;
    }
    actions.push({
      kind: disposition.action,
      proposal: proposalRef,
      reason: disposition.reason,
      reopenWhen: disposition.reopenWhen,
    });
  }
  if (seen.size !== proposals.size) {
    return { kind: "failed", reason: "proposal-omission" };
  }
  actions.sort((left, right) =>
    left.proposal.id.localeCompare(right.proposal.id),
  );
  const identity = {
    kind: "depth-iteration-decision",
    schemaVersion: 2,
    target: input.synthesis.target,
    manifest: input.synthesis.manifest,
    registry: input.registry.ref,
    synthesis: refs.synthesisRef,
    critique: refs.critiqueRef,
    attempt,
    actions,
  } as const;
  return {
    kind: "completed",
    value: currentDepthIterationDecisionSchema.parse({
      ...identity,
      id: sha256Digest(identity),
    }),
  };
}

export function referenceCurrentDepthIterationDecision(
  value: CurrentDepthIterationDecision,
): CurrentDepthIterationDecisionRef {
  const decision = currentDepthIterationDecisionSchema.parse(value);
  return currentDepthIterationDecisionRefSchema.parse({
    kind: decision.kind,
    schemaVersion: decision.schemaVersion,
    id: decision.id,
    digest: sha256Digest(decision),
    targetSnapshotDigest: decision.target.digest,
    manifestDigest: decision.manifest.digest,
    registryDigest: decision.registry.digest,
    synthesisId: decision.synthesis.id,
    critiqueId: decision.critique.id,
    actions: decision.actions.length,
  });
}

class CurrentDepthEvaluation implements CurrentSemanticDepthEvaluation {
  readonly #options: OpenCurrentSemanticDepthEvaluationOptions;

  constructor(options: OpenCurrentSemanticDepthEvaluationOptions) {
    this.#options = options;
  }

  async evaluate(
    inputValue: CurrentSemanticDepthEvaluationInput,
  ): Promise<CurrentSemanticDepthEvaluationResult> {
    const input = currentSemanticDepthEvaluationInputSchema.parse(inputValue);
    const refs = validateInput(input);
    const plan = currentDepthAttempt(input, refs, this.#options);
    const result: AttemptExecutionResult =
      await this.#options.modelExecution.run(plan);
    const attempts: z.infer<typeof currentDepthEvaluatorAttemptRefSchema>[] =
      [];
    let reason: FailureReason = "evaluator-failed";
    if (result.value.schemaVersion === 2) {
      const parsedResult = modelAttemptResultV2Schema.safeParse(result.value);
      if (
        parsedResult.success &&
        parsedResult.data.role === "root-evaluator" &&
        parsedResult.data.attemptId === plan.attemptId &&
        parsedResult.data.planDigest === sha256Digest(plan)
      ) {
        const attempt = currentDepthEvaluatorAttemptRefSchema.parse(result.ref);
        attempts.push(attempt);
        if (parsedResult.data.status === "completed") {
          const output = depthRootEvaluatorOutputSchema.safeParse(
            parsedResult.data.output,
          );
          if (output.success) {
            const resolved = resolveOutput(input, refs, output.data, attempt);
            if (resolved.kind === "completed") return resolved.value;
            reason = resolved.reason;
          } else {
            reason = "invalid-output";
          }
        }
      } else {
        reason = "result-mismatch";
      }
    } else {
      reason = "result-mismatch";
    }
    return currentDepthEvaluationIncompleteSchema.parse({
      kind: "depth-evaluation-incomplete",
      schemaVersion: 2,
      target: input.synthesis.target,
      manifest: input.synthesis.manifest,
      registry: input.registry.ref,
      synthesis: refs.synthesisRef,
      critique: refs.critiqueRef,
      attempts,
      reason,
    });
  }
}

export function openCurrentSemanticDepthEvaluation(
  options: OpenCurrentSemanticDepthEvaluationOptions,
): CurrentSemanticDepthEvaluation {
  return new CurrentDepthEvaluation(options);
}
