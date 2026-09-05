import { z } from "zod";

import {
  attemptExecutionResultV2RefSchema,
  attemptPlanV2Schema,
  modelAttemptResultV2Schema,
  type AttemptExecutionResult,
  type AttemptExecutionResultV2,
  type AttemptPlanV2,
} from "../model-execution/contracts.js";
import {
  canonicalJson,
  sha256Digest,
} from "../research-record/canonical-json.js";
import {
  oracleFreeTargetMetadataSchema,
  rootPlannerOutputSchema,
  semanticExplorationDecisionInputSchema,
  semanticExplorationDecisionSchema,
  semanticRootPlanningPolicySchema,
  type OpenSemanticExplorationOptions,
  type RootPlannerOutput,
  type SemanticExploration,
  type SemanticExplorationDecision,
} from "./semantic-contracts.js";
import { materializeInitialSemanticWave } from "./initial-semantic-wave.js";
import { targetSnapshotRefSchema } from "../contracts.js";
import { targetFileManifestRefSchema } from "../source-mapping/contracts.js";
import { evaluateSemanticWave } from "./semantic-wave-evaluation.js";
import { currentResearchAttackerScopePrompt } from "../current-research-attacker-scope.js";

type PlanningFailureReason = Extract<
  SemanticExplorationDecision,
  { kind: "planning-incomplete" }
>["reason"];

function normalizeSemanticIdentity(value: string): string {
  return value.normalize("NFKC").trim().toLowerCase().replace(/\s+/gu, " ");
}

function rootPlannerJsonSchema(): Record<string, unknown> {
  const schema = z.toJSONSchema(rootPlannerOutputSchema);
  delete schema.$schema;
  return schema;
}

class FirstSemanticExploration implements SemanticExploration {
  readonly #target;
  readonly #manifest;
  readonly #metadata;
  readonly #policy;
  readonly #modelExecution;
  readonly #promptSet;
  readonly #modelProfile;
  readonly #sourceToolPolicy;
  readonly #evaluator;
  readonly #attemptNamespace;

  constructor(options: OpenSemanticExplorationOptions) {
    this.#target = targetSnapshotRefSchema.parse(options.target);
    this.#manifest = targetFileManifestRefSchema.parse(options.manifest);
    this.#metadata = oracleFreeTargetMetadataSchema.parse(options.metadata);
    this.#policy = semanticRootPlanningPolicySchema.parse(
      options.semanticPolicy,
    );
    this.#modelExecution = options.planner.modelExecution;
    this.#promptSet = options.planner.promptSet;
    this.#modelProfile = options.planner.modelProfile;
    this.#sourceToolPolicy = options.planner.sourceToolPolicy;
    this.#evaluator = options.evaluator;
    this.#attemptNamespace = options.attemptNamespace;
    if (
      this.#manifest.targetSnapshotId !== this.#target.id ||
      this.#manifest.targetSnapshotDigest !== this.#target.digest
    ) {
      throw new Error("Semantic Exploration Manifest targets another Snapshot");
    }
  }

  async decide(
    inputValue: Parameters<SemanticExploration["decide"]>[0],
  ): Promise<SemanticExplorationDecision> {
    const input = semanticExplorationDecisionInputSchema.parse(inputValue);
    if (
      canonicalJson(input.target) !== canonicalJson(this.#target) ||
      canonicalJson(input.manifest) !== canonicalJson(this.#manifest)
    ) {
      throw new Error("Semantic Exploration input binding mismatch");
    }
    if (input.kind === "evaluate-semantic-wave") {
      if (this.#evaluator === undefined) {
        throw new Error("Semantic Exploration evaluator is not configured");
      }
      return evaluateSemanticWave(
        input,
        this.#evaluator,
        this.#attemptNamespace,
      );
    }

    const attempts: AttemptExecutionResultV2["ref"][] = [];
    let failure: PlanningFailureReason = "invalid-root-planner-output";
    for (let ordinal = 1; ordinal <= 2; ordinal += 1) {
      const plan = this.#plannerAttempt(input, ordinal);
      const result = await this.#modelExecution.run(plan);
      const validated = this.#validatePlannerResult(plan, result);
      if (validated.kind === "failed") {
        failure = validated.reason;
        if (validated.ref !== undefined) attempts.push(validated.ref);
        if (
          ordinal === 1 &&
          (failure === "invalid-root-planner-output" ||
            failure === "duplicate-research-thesis" ||
            failure === "root-planner-result-mismatch")
        ) {
          continue;
        }
        break;
      }
      attempts.push(validated.ref);
      return this.#wave(validated.output, validated.ref);
    }

    return semanticExplorationDecisionSchema.parse({
      kind: "planning-incomplete",
      schemaVersion: 2,
      target: this.#target,
      manifest: this.#manifest,
      attempts,
      reason: failure,
    });
  }

  #plannerAttempt(
    input: Parameters<SemanticExploration["decide"]>[0],
    ordinal: number,
  ): Extract<AttemptPlanV2, { role: "root-planner" }> {
    const attemptId = `root-planner:${sha256Digest({
      input,
      ordinal,
      ...(this.#attemptNamespace === undefined
        ? {}
        : { namespace: this.#attemptNamespace }),
    }).slice("sha256:".length)}`;
    const assignment = {
      kind: "initial-research-planning" as const,
      schemaVersion: 1 as const,
      metadata: this.#metadata,
      maxTargetSpecificTheses: Math.min(
        this.#policy.maxTargetSpecificTheses,
        Math.max(0, this.#policy.maxLeases - 1),
      ),
      minWildcardTheses: 0,
      maxLeases: Math.max(0, this.#policy.maxLeases - 1),
    };
    const plan = attemptPlanV2Schema.parse({
      kind: "attempt-plan",
      schemaVersion: 2,
      attemptId,
      owner: "exploration",
      role: "root-planner",
      target: this.#target,
      manifest: this.#manifest,
      assignment,
      promptSet: this.#promptSet,
      modelProfile: this.#modelProfile,
      prompt: [
        "Act as source-aware Recon for an oracle-free security review.",
        currentResearchAttackerScopePrompt,
        `Target: ${canonicalJson(this.#target)}`,
        `Source identity: ${canonicalJson(this.#manifest)}`,
        `Metadata: ${canonicalJson(this.#metadata)}`,
        `Bounds: ${canonicalJson({
          maxTargetSpecificTheses: assignment.maxTargetSpecificTheses,
          minWildcardTheses: assignment.minWildcardTheses,
          maxLeases: assignment.maxLeases,
        })}`,
        "Use the manifest-bound source tools and read actual source before proposing any target-specific Focus Packet.",
        "Inventory roughly 5-15 source-backed input-processing subsystems, security assumptions, trust transitions, or cross-feature interactions, then return only the strongest independent packets within the supplied bounds.",
        "Every target-specific packet must include exact startingEvidence anchors from source you read.",
        "Packets are starting points only: do not prescribe file allowlists, vulnerability classes, sinks, or fixed investigation steps.",
        "Do not wait for or coordinate with the independent whole-target Baseline Finder.",
      ].join("\n"),
      outputJsonSchema: rootPlannerJsonSchema(),
      sourceToolPolicy: this.#sourceToolPolicy,
      budget: this.#policy.plannerBudget,
    });
    if (plan.role !== "root-planner") {
      throw new Error("Root Planner attempt materialized with another role");
    }
    return plan;
  }

  #validatePlannerResult(
    plan: Extract<AttemptPlanV2, { role: "root-planner" }>,
    result: AttemptExecutionResult,
  ):
    | {
        readonly kind: "completed";
        readonly ref: AttemptExecutionResultV2["ref"];
        readonly output: RootPlannerOutput;
      }
    | {
        readonly kind: "failed";
        readonly reason: PlanningFailureReason;
        readonly ref?: AttemptExecutionResultV2["ref"];
      } {
    if (result.ref.schemaVersion !== 2 || result.value.schemaVersion !== 2) {
      return { kind: "failed", reason: "root-planner-result-mismatch" };
    }
    const ref = attemptExecutionResultV2RefSchema.safeParse(result.ref);
    const value = modelAttemptResultV2Schema.safeParse(result.value);
    const planDigest = sha256Digest(plan);
    if (
      !ref.success ||
      !value.success ||
      ref.data.attemptId !== plan.attemptId ||
      ref.data.owner !== plan.owner ||
      ref.data.role !== plan.role ||
      ref.data.planDigest !== planDigest ||
      value.data.attemptId !== plan.attemptId ||
      value.data.owner !== plan.owner ||
      value.data.role !== plan.role ||
      value.data.planDigest !== planDigest ||
      sha256Digest(value.data) !== ref.data.digest
    ) {
      return {
        kind: "failed",
        reason: "root-planner-result-mismatch",
        ...(ref.success ? { ref: ref.data } : {}),
      };
    }
    if (value.data.status !== "completed") {
      return { kind: "failed", reason: "planner-failed", ref: ref.data };
    }
    const output = rootPlannerOutputSchema.safeParse(value.data.output);
    if (!output.success || !this.#withinPlanningBounds(output.data)) {
      return {
        kind: "failed",
        reason: "invalid-root-planner-output",
        ref: ref.data,
      };
    }
    const identities = output.data.theses.map((thesis) =>
      normalizeSemanticIdentity(thesis.securityAssumption),
    );
    if (new Set(identities).size !== identities.length) {
      return {
        kind: "failed",
        reason: "duplicate-research-thesis",
        ref: ref.data,
      };
    }
    return { kind: "completed", ref: ref.data, output: output.data };
  }

  #withinPlanningBounds(output: RootPlannerOutput): boolean {
    const targetSpecific = output.theses.filter(
      (thesis) => thesis.scope === "target-specific",
    ).length;
    return (
      targetSpecific <=
        Math.min(
          this.#policy.maxTargetSpecificTheses,
          Math.max(0, this.#policy.maxLeases - 1),
        ) && output.theses.length <= Math.max(0, this.#policy.maxLeases - 1)
    );
  }

  #wave(
    output: RootPlannerOutput,
    plannerAttempt: AttemptExecutionResultV2["ref"],
  ): SemanticExplorationDecision {
    const plan = materializeInitialSemanticWave({
      target: this.#target,
      manifest: this.#manifest,
      policy: this.#policy,
      plannerAttempt,
      recon: output,
    });
    return semanticExplorationDecisionSchema.parse({ kind: "run-wave", plan });
  }
}

export function openSemanticExploration(
  options: OpenSemanticExplorationOptions,
): SemanticExploration {
  return new FirstSemanticExploration(options);
}
