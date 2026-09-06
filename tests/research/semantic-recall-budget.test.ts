import { describe, expect, it } from "vitest";

import {
  bindCurrentSemanticCampaignConfiguration,
  campaignDefaultSemanticRunPlanV3Schema,
  defineCurrentSemanticRootPlanningPolicy,
} from "../../src/research/index.js";
import { sha256Digest } from "../../src/research/research-record/canonical-json.js";
import { projectTargetFileManifest } from "../../src/research/source-mapping/target-file-manifest.js";
import { createCampaignInput } from "../fixtures/campaign.js";

const digest = (character: string): string => `sha256:${character.repeat(64)}`;
const MEBIBYTE = 1024 * 1024;
const GIBIBYTE = 1024 * MEBIBYTE;

const targets = [
  { slug: "brizy", version: "2.8.11" },
  { slug: "simply-schedule-appointments", version: "1.6.9.29" },
  { slug: "translatepress-multilingual", version: "3.2.5" },
] as const;

describe("semantic-research-recall-baseline-v7", () => {
  it.each(targets)(
    "dry-checks $slug without starting a model or Lab",
    ({ slug, version }) => {
      const targetSnapshot = {
        id: `${slug}-${version}`,
        pluginSlug: slug,
        version,
        digest: digest("1"),
      };
      const input = {
        ...createCampaignInput(`dry-${slug}`),
        schemaVersion: 2 as const,
        targetSnapshot,
        modelProfiles: [
          { id: "opus-planner-v6", digest: digest("5") },
          { id: "opus-finder-v6", digest: digest("6") },
          { id: "opus-evaluator-v6", digest: digest("7") },
          { id: "opus-validator-v6", digest: digest("8") },
        ],
        canonicalFileManifest: {
          kind: "canonical-file-manifest" as const,
          schemaVersion: 1 as const,
          entries: [{ path: `${slug}.php`, digest: digest("a"), size: 1_000 }],
        },
        budget: {
          maxAttempts: 128,
          maxWallTimeMs: 43_200_000,
          maxModelTokens: 4_600_000,
        },
      };
      const manifestValue = projectTargetFileManifest(
        targetSnapshot,
        input.canonicalFileManifest,
      );
      const manifest = {
        kind: "target-file-manifest" as const,
        schemaVersion: 1 as const,
        targetSnapshotId: targetSnapshot.id,
        targetSnapshotDigest: targetSnapshot.digest,
        digest: sha256Digest(manifestValue),
      };
      const profile = (id: string, profileDigest: string) => ({
        ref: {
          kind: "model-profile" as const,
          schemaVersion: 1 as const,
          id,
          family: "claude" as const,
          digest: profileDigest,
        },
        execution: {
          provider: "anthropic" as const,
          model: "claude-opus-5",
          transport: "claude-code-process" as const,
          executableVersion: "2.1.258",
          effort: "high" as const,
          eligibilityReceiptDigest: digest("b"),
        },
      });
      const promptSet = {
        kind: "prompt-set" as const,
        schemaVersion: 1 as const,
        id: input.promptSet.id,
        digest: input.promptSet.digest,
      };
      const sourceToolPolicy = {
        kind: "source-tool-policy" as const,
        schemaVersion: 1 as const,
        id: "semantic-source-tools-v3",
        digest: digest("c"),
      };
      const bindingSource = {
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
          modelProfile: profile("opus-planner-v6", digest("5")),
          promptSet,
          sourceToolPolicy,
        },
        finder: {
          modelProfile: profile("opus-finder-v6", digest("6")),
          promptSet,
          selectedKnowledge: [],
          sourceToolPolicy,
        },
        evaluator: {
          modelProfile: profile("opus-evaluator-v6", digest("7")),
          promptSet,
          budget: {
            maxWallTimeMs: 3_600_000,
            maxModelTokens: 100_000,
            maxModelTurns: 128,
            maxProviderCostUsd: 10,
            maxOutputBytes: 2 * MEBIBYTE,
            reportedUsageEnforcement: "telemetry-only" as const,
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
          validatorModelProfile: profile("opus-validator-v6", digest("8")),
          sourceToolPolicy,
          publicSurface: [],
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
              sourceLimitTerminalOutput: "preserve" as const,
              reportedUsageEnforcement: "telemetry-only" as const,
            },
          },
        },
      };
      const plan = campaignDefaultSemanticRunPlanV3Schema.parse({
        kind: "campaign-run-plan",
        schemaVersion: 3,
        runId: `dry-${slug}-run`,
        campaignId: input.campaignId,
        preparationDigest: digest("f"),
        target: targetSnapshot,
        manifest,
        metadata: {
          kind: "oracle-free-target-metadata",
          schemaVersion: 1,
          pluginIdentity: `wporg:${slug}`,
          mainPluginFile: `${slug}.php`,
          canonicalInstallDirectory: slug,
        },
        ...bindingSource,
        bindings: bindCurrentSemanticCampaignConfiguration(bindingSource),
        budgetPolicy: {
          kind: "semantic-research-budget",
          schemaVersion: 3,
          id: "semantic-research-recall-baseline-v7",
          maxWorkWaves: 12,
          maxFinderAttempts: 48,
          maxConcurrentFinders: 4,
          maxModelAttempts: 128,
          maxModelTokens: 4_600_000,
          maxProviderCostUsd: 150,
          maxWallTimeMs: 43_200_000,
          reportedUsageEnforcement: "telemetry-only",
          exploration: {
            maxModelTokens: 4_200_000,
            maxProviderCostUsd: 120,
            maxWallTimeMs: 36_000_000,
            rootEvaluationReserve: {
              maxModelTokens: 100_000,
              owner: "exploration",
              role: "root-evaluator",
            },
          },
          validationReserve: {
            maxModelTokens: 400_000,
            maxProviderCostUsd: 30,
            maxWallTimeMs: 7_200_000,
          },
        },
      });

      expect(plan).not.toHaveProperty("verification");
      expect(plan.semanticPolicy).toMatchObject({
        maxTargetSpecificTheses: 2,
        minWildcardTheses: 1,
        maxLeases: 3,
      });
      expect(plan.budgetPolicy).toMatchObject({
        id: "semantic-research-recall-baseline-v7",
        maxModelTokens: 4_600_000,
        exploration: {
          maxModelTokens: 4_200_000,
          rootEvaluationReserve: { maxModelTokens: 100_000 },
        },
        validationReserve: { maxModelTokens: 400_000 },
      });
      if (!("bindings" in plan)) {
        throw new Error("Expected current Campaign bindings");
      }
      expect(plan.bindings).toEqual(
        bindCurrentSemanticCampaignConfiguration(plan),
      );
    },
  );
});
