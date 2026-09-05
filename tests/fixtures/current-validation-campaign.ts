import {
  campaignDefaultSemanticRunPlanV3Schema,
  defineCurrentSemanticRootPlanningPolicy,
  type DefaultSemanticCampaignRunPlanV3,
  type NewCampaignInputV2,
  type PreparedCampaign,
} from "../../src/research/index.js";

const MEBIBYTE = 1024 * 1024;
const GIBIBYTE = 1024 * MEBIBYTE;
const digest = (character: string): string => `sha256:${character.repeat(64)}`;

function modelProfile(input: NewCampaignInputV2, id: string) {
  const configured = input.modelProfiles.find((profile) => profile.id === id);
  if (configured === undefined) {
    throw new Error(`Missing fixture Model Profile: ${id}`);
  }
  return {
    ref: {
      kind: "model-profile" as const,
      schemaVersion: 1 as const,
      id,
      family: "claude" as const,
      digest: configured.digest,
    },
    execution: {
      provider: "anthropic" as const,
      model: "claude-opus-5",
      transport: "claude-code-process" as const,
      executableVersion: "2.1.258",
      effort: "high" as const,
      eligibilityReceiptDigest: digest("b"),
    },
  };
}

export function createCurrentValidationCampaignPlan(input: {
  readonly preparation: PreparedCampaign;
  readonly campaign: NewCampaignInputV2;
  readonly runId: string;
  readonly pluginSlug: string;
  readonly mainPluginFile?: string;
}): DefaultSemanticCampaignRunPlanV3 {
  const manifest = input.preparation.targetFileManifest;
  if (manifest === undefined) {
    throw new Error("Current Validation fixture requires a Target Manifest");
  }
  const promptSet = {
    kind: "prompt-set" as const,
    schemaVersion: 1 as const,
    id: input.campaign.promptSet.id,
    digest: input.campaign.promptSet.digest,
  };
  const sourceToolPolicy = {
    kind: "source-tool-policy" as const,
    schemaVersion: 1 as const,
    id: "semantic-source-tools-v3",
    digest: digest("c"),
  };
  return campaignDefaultSemanticRunPlanV3Schema.parse({
    kind: "campaign-run-plan",
    schemaVersion: 3,
    runId: input.runId,
    campaignId: input.campaign.campaignId,
    preparationDigest: input.preparation.inputDigest,
    target: input.campaign.targetSnapshot,
    manifest,
    metadata: {
      kind: "oracle-free-target-metadata",
      schemaVersion: 1,
      pluginIdentity: `wporg:${input.pluginSlug}`,
      mainPluginFile: input.mainPluginFile ?? "plugin.php",
      canonicalInstallDirectory: input.pluginSlug,
    },
    semanticPolicy: defineCurrentSemanticRootPlanningPolicy({
      plannerBudget: {
        maxWallTimeMs: 3_600_000,
        maxModelTokens: 100_000,
        maxModelTurns: 128,
        maxProviderCostUsd: 10,
        maxOutputBytes: 2 * MEBIBYTE,
        maxSourceQueries: 256,
        maxSourceScanBytes: 16 * GIBIBYTE,
        maxSourceResponseBytes: 256 * MEBIBYTE,
        sourceLimitTerminalOutput: "preserve",
        reportedUsageEnforcement: "telemetry-only",
      },
      finderLeaseBudget: {
        maxWallTimeMs: 10_800_000,
        maxModelTokens: 1_000_000,
        maxModelTurns: 256,
        maxProviderCostUsd: 20,
        maxHypotheses: 8,
        maxOutputBytes: 2 * MEBIBYTE,
        maxSourceQueries: 512,
        maxSourceScanBytes: 16 * GIBIBYTE,
        maxSourceResponseBytes: 256 * MEBIBYTE,
        sourceLimitTerminalOutput: "preserve",
        reportedUsageEnforcement: "telemetry-only",
      },
    }),
    planner: {
      modelProfile: modelProfile(input.campaign, "opus-planner-v6"),
      promptSet,
      sourceToolPolicy,
    },
    finder: {
      modelProfile: modelProfile(input.campaign, "opus-finder-v6"),
      promptSet,
      selectedKnowledge: [],
      sourceToolPolicy,
    },
    evaluator: {
      modelProfile: modelProfile(input.campaign, "opus-evaluator-v6"),
      promptSet,
      budget: {
        maxWallTimeMs: 3_600_000,
        maxModelTokens: 100_000,
        maxModelTurns: 128,
        maxProviderCostUsd: 10,
        maxOutputBytes: 2 * MEBIBYTE,
        reportedUsageEnforcement: "telemetry-only",
      },
    },
    validation: {
      wordpressBaseline: {
        id: "wordpress-threat-baseline-v1",
        digest: digest("d"),
      },
      validationPolicy: {
        id: "source-validation-v2",
        digest: digest("e"),
      },
      promptSet,
      validatorModelProfile: modelProfile(input.campaign, "opus-validator-v6"),
      sourceToolPolicy,
      publicSurface: ["Public WordPress request handlers"],
      technicalExclusions: [],
      budget: {
        validator: {
          maxWallTimeMs: 1_800_000,
          maxModelTokens: 100_000,
          maxModelTurns: 64,
          maxProviderCostUsd: 7.5,
          maxOutputBytes: 2 * MEBIBYTE,
          maxSourceQueries: 128,
          maxSourceScanBytes: 16 * GIBIBYTE,
          maxSourceResponseBytes: 256 * MEBIBYTE,
          sourceLimitTerminalOutput: "preserve",
          reportedUsageEnforcement: "telemetry-only",
        },
      },
    },
    budgetPolicy: {
      kind: "semantic-research-budget",
      schemaVersion: 2,
      id: "semantic-research-recall-baseline-v6",
      maxWorkWaves: 12,
      maxFinderAttempts: 48,
      maxConcurrentFinders: 4,
      maxModelAttempts: 128,
      maxModelTokens: 4_000_000,
      maxProviderCostUsd: 150,
      maxWallTimeMs: 43_200_000,
      reportedUsageEnforcement: "telemetry-only",
      exploration: {
        maxModelTokens: 3_600_000,
        maxProviderCostUsd: 120,
        maxWallTimeMs: 36_000_000,
      },
      validationReserve: {
        maxModelTokens: 400_000,
        maxProviderCostUsd: 30,
        maxWallTimeMs: 7_200_000,
      },
    },
  });
}
