import {
  canonicalJson,
  sha256Digest,
} from "../research-record/canonical-json.js";
import {
  currentSemanticCampaignBindingsSchema,
  isCurrentSemanticResearchBudgetPolicy,
  type DefaultSemanticCampaignRunPlanV3,
} from "./contracts.js";

type BindingSource = Pick<
  DefaultSemanticCampaignRunPlanV3,
  "semanticPolicy" | "planner" | "finder" | "evaluator" | "validation"
>;

const currentModelProfileFamilies = [
  {
    family: "claude",
    execution: {
      provider: "anthropic",
      model: "claude-opus-5",
      transport: "claude-code-process",
      executableVersion: "2.1.260",
      effort: "high",
    },
    profileIds: {
      planner: "claude-opus-5-root-planner-high-v6",
      finder: "claude-opus-5-finder-high-v6",
      evaluator: "claude-opus-5-root-evaluator-high-v6",
      validator: "claude-opus-5-validator-high-v6",
    },
  },
  {
    family: "glm",
    execution: {
      provider: "zai",
      model: "glm-5.1",
      transport: "claude-code-process",
      executableVersion: "2.1.260",
      effort: "max",
    },
    profileIds: {
      planner: "glm-5.1-root-planner-max-v1",
      finder: "glm-5.1-finder-max-v1",
      evaluator: "glm-5.1-root-evaluator-max-v1",
      validator: "glm-5.1-validator-max-v1",
    },
  },
  {
    family: "grok",
    execution: {
      provider: "xai",
      model: "grok-4.6",
      transport: "grok-build-process",
      executableVersion: "1.0.13",
      effort: "xhigh",
    },
    profileIds: {
      planner: "grok-4.6-root-planner-xhigh-v1",
      finder: "grok-4.6-finder-xhigh-v1",
      evaluator: "grok-4.6-root-evaluator-xhigh-v1",
      validator: "grok-4.6-validator-xhigh-v1",
    },
  },
] as const;

export function bindCurrentSemanticCampaignConfiguration(
  source: BindingSource,
) {
  const profileBinding = (
    profile: BindingSource["planner"]["modelProfile"],
  ) => ({
    id: profile.ref.id,
    refDigest: profile.ref.digest,
    configurationDigest: sha256Digest(profile),
  });
  return currentSemanticCampaignBindingsSchema.parse({
    kind: "current-semantic-campaign-bindings",
    schemaVersion: 1,
    semanticPolicyDigest: sha256Digest(source.semanticPolicy),
    modelProfiles: {
      planner: profileBinding(source.planner.modelProfile),
      finder: profileBinding(source.finder.modelProfile),
      evaluator: profileBinding(source.evaluator.modelProfile),
      validator: profileBinding(source.validation.validatorModelProfile),
    },
    promptSet: {
      id: source.planner.promptSet.id,
      digest: source.planner.promptSet.digest,
    },
    sourceToolPolicy: {
      id: source.planner.sourceToolPolicy.id,
      digest: source.planner.sourceToolPolicy.digest,
    },
    finderSelectedKnowledgeDigest: sha256Digest(
      source.finder.selectedKnowledge,
    ),
    validationPolicy: {
      id: source.validation.validationPolicy.id,
      digest: source.validation.validationPolicy.digest,
    },
    validationScopeDigest: sha256Digest({
      wordpressBaseline: source.validation.wordpressBaseline,
      publicSurface: source.validation.publicSurface,
      technicalExclusions: source.validation.technicalExclusions,
    }),
  });
}

export function currentSemanticCampaignConfigurationMatches(
  plan: DefaultSemanticCampaignRunPlanV3,
): boolean {
  if (
    !isCurrentSemanticResearchBudgetPolicy(plan.budgetPolicy) ||
    !("bindings" in plan)
  ) {
    return false;
  }
  const expectedBindings = bindCurrentSemanticCampaignConfiguration(plan);
  const modelProfiles = {
    planner: plan.planner.modelProfile,
    finder: plan.finder.modelProfile,
    evaluator: plan.evaluator.modelProfile,
    validator: plan.validation.validatorModelProfile,
  };
  const executions = Object.values(modelProfiles).map(
    (profile) => profile.execution,
  );
  const eligibilityReceiptDigest = executions[0]?.eligibilityReceiptDigest;
  const modelFamilyMatches = currentModelProfileFamilies.some((candidate) =>
    Object.entries(modelProfiles).every(([role, profile]) => {
      const expectedProfileId =
        candidate.profileIds[role as keyof typeof candidate.profileIds];
      const expectedExecution = candidate.execution;
      return (
        profile.ref.family === candidate.family &&
        profile.ref.id === expectedProfileId &&
        profile.execution.provider === expectedExecution.provider &&
        profile.execution.model === expectedExecution.model &&
        profile.execution.transport === expectedExecution.transport &&
        profile.execution.executableVersion ===
          expectedExecution.executableVersion &&
        profile.execution.effort === expectedExecution.effort &&
        profile.execution.eligibilityReceiptDigest === eligibilityReceiptDigest
      );
    }),
  );
  const promptMatches = [
    plan.planner.promptSet,
    plan.finder.promptSet,
    plan.evaluator.promptSet,
    plan.validation.promptSet,
  ].every(
    (prompt) =>
      prompt.id === "semantic-research-source-screen-v6r3" &&
      prompt.id === plan.bindings.promptSet.id &&
      prompt.digest === plan.bindings.promptSet.digest,
  );
  const sourceToolPolicyMatches = [
    plan.planner.sourceToolPolicy,
    plan.finder.sourceToolPolicy,
    plan.validation.sourceToolPolicy,
  ].every(
    (policy) =>
      policy.id === "prospective-source-only-v1" &&
      policy.id === plan.bindings.sourceToolPolicy.id &&
      policy.digest === plan.bindings.sourceToolPolicy.digest,
  );
  const semanticPolicy = plan.semanticPolicy;
  const finderBudget = semanticPolicy.finderLeaseBudget;
  const plannerBudget = semanticPolicy.plannerBudget;
  const evaluatorBudget = plan.evaluator.budget;
  const validatorBudget = plan.validation.budget.validator;
  return (
    canonicalJson(plan.bindings) === canonicalJson(expectedBindings) &&
    modelFamilyMatches &&
    promptMatches &&
    sourceToolPolicyMatches &&
    plan.finder.selectedKnowledge.length === 0 &&
    plan.validation.validationPolicy.id === "single-source-validation-v2" &&
    plan.validation.validationPolicy.id === plan.bindings.validationPolicy.id &&
    plan.validation.validationPolicy.digest ===
      plan.bindings.validationPolicy.digest &&
    semanticPolicy.id === "semantic-research-normal-wave-v1" &&
    semanticPolicy.maxTargetSpecificTheses === 2 &&
    semanticPolicy.minWildcardTheses === 1 &&
    semanticPolicy.maxLeases === 3 &&
    plannerBudget.maxWallTimeMs === 3_600_000 &&
    plannerBudget.maxModelTokens === 100_000 &&
    plannerBudget.maxModelTurns === 128 &&
    plannerBudget.maxProviderCostUsd === 10 &&
    plannerBudget.maxOutputBytes === 2 * 1_024 * 1_024 &&
    plannerBudget.maxSourceQueries === 256 &&
    plannerBudget.maxSourceScanBytes === 16 * 1_024 * 1_024 * 1_024 &&
    plannerBudget.maxSourceResponseBytes === 256 * 1_024 * 1_024 &&
    plannerBudget.sourceLimitTerminalOutput === "preserve" &&
    plannerBudget.reportedUsageEnforcement === "telemetry-only" &&
    finderBudget.maxWallTimeMs === 10_800_000 &&
    finderBudget.maxModelTokens === 1_000_000 &&
    finderBudget.maxModelTurns === 256 &&
    finderBudget.maxProviderCostUsd === 20 &&
    finderBudget.maxHypotheses === 8 &&
    finderBudget.maxOutputBytes === 2 * 1_024 * 1_024 &&
    finderBudget.maxSourceQueries === 512 &&
    finderBudget.maxSourceScanBytes === 16 * 1_024 * 1_024 * 1_024 &&
    finderBudget.maxSourceResponseBytes === 256 * 1_024 * 1_024 &&
    finderBudget.sourceLimitTerminalOutput === "preserve" &&
    finderBudget.reportedUsageEnforcement === "telemetry-only" &&
    evaluatorBudget.maxWallTimeMs === 3_600_000 &&
    evaluatorBudget.maxModelTokens ===
      plan.budgetPolicy.exploration.rootEvaluationReserve.maxModelTokens &&
    evaluatorBudget.maxModelTurns === 128 &&
    evaluatorBudget.maxProviderCostUsd === 10 &&
    evaluatorBudget.maxOutputBytes === 2 * 1_024 * 1_024 &&
    evaluatorBudget.reportedUsageEnforcement === "telemetry-only" &&
    validatorBudget.maxWallTimeMs === 1_800_000 &&
    validatorBudget.maxModelTokens === 100_000 &&
    validatorBudget.maxModelTurns === 64 &&
    validatorBudget.maxProviderCostUsd === 7.5 &&
    validatorBudget.maxOutputBytes === 2 * 1_024 * 1_024 &&
    validatorBudget.maxSourceQueries === 128 &&
    validatorBudget.maxSourceScanBytes === 16 * 1_024 * 1_024 * 1_024 &&
    validatorBudget.maxSourceResponseBytes === 256 * 1_024 * 1_024 &&
    validatorBudget.sourceLimitTerminalOutput === "preserve" &&
    validatorBudget.reportedUsageEnforcement === "telemetry-only"
  );
}
