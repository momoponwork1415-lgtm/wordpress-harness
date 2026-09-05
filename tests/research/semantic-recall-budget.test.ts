import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  CampaignRunConflictError,
  campaignDefaultSemanticRunPlanV3Schema,
} from "../../src/research/campaign-control/contracts.js";
import { sha256Digest } from "../../src/research/research-record/canonical-json.js";
import { openSqliteResearchRecord } from "../../src/research/research-record/index.js";
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

describe("semantic-research-recall-baseline-v6", () => {
  it.each(targets)(
    "dry-checks $slug without starting a model or Lab",
    async ({ slug, version }) => {
      const directory = await mkdtemp(join(tmpdir(), "semantic-v6-dry-"));
      const record = openSqliteResearchRecord({
        databasePath: join(directory, "research.sqlite"),
      });
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
          { id: "opus-planner-v5", digest: digest("5") },
          { id: "opus-finder-v5", digest: digest("6") },
          { id: "opus-evaluator-v5", digest: digest("7") },
          { id: "opus-validator-v6", digest: digest("8") },
          { id: "opus-validation-synthesis-v6", digest: digest("9") },
        ],
        canonicalFileManifest: {
          kind: "canonical-file-manifest" as const,
          schemaVersion: 1 as const,
          entries: [{ path: `${slug}.php`, digest: digest("a"), size: 1_000 }],
        },
        budget: {
          maxAttempts: 128,
          maxWallTimeMs: 43_200_000,
          maxModelTokens: 4_000_000,
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
      const preparation = await record.recordPreparation(input, manifest);
      const profile = (id: string, profileDigest: string) => ({
        ref: {
          kind: "model-profile" as const,
          schemaVersion: 1 as const,
          id,
          family: "claude",
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
      const plan = campaignDefaultSemanticRunPlanV3Schema.parse({
        kind: "campaign-run-plan",
        schemaVersion: 3,
        runId: `dry-${slug}-run`,
        campaignId: input.campaignId,
        preparationDigest: preparation.requestedInputDigest,
        target: targetSnapshot,
        manifest,
        metadata: {
          kind: "oracle-free-target-metadata",
          schemaVersion: 1,
          pluginIdentity: `wporg:${slug}`,
          mainPluginFile: `${slug}.php`,
          canonicalInstallDirectory: slug,
        },
        semanticPolicy: {
          kind: "semantic-root-planning-policy",
          schemaVersion: 1,
          id: "semantic-research-recall-baseline-v5",
          maxTargetSpecificTheses: 3,
          minWildcardTheses: 1,
          maxLeases: 4,
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
        },
        planner: {
          modelProfile: profile("opus-planner-v5", digest("5")),
          promptSet,
          sourceToolPolicy,
        },
        finder: {
          modelProfile: profile("opus-finder-v5", digest("6")),
          promptSet,
          selectedKnowledge: [],
          sourceToolPolicy,
        },
        evaluator: {
          modelProfile: profile("opus-evaluator-v5", digest("7")),
          promptSet,
          budget: {
            maxWallTimeMs: 3_600_000,
            maxModelTokens: 300_000,
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
            id: "source-validation-v1",
            digest: digest("e"),
          },
          promptSet,
          validatorModelProfile: profile("opus-validator-v6", digest("8")),
          synthesisModelProfile: profile(
            "opus-validation-synthesis-v6",
            digest("9"),
          ),
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
              sourceLimitTerminalOutput: "preserve",
              reportedUsageEnforcement: "telemetry-only",
            },
            synthesis: {
              maxWallTimeMs: 1_800_000,
              maxModelTokens: 100_000,
              maxModelTurns: 64,
              maxProviderCostUsd: 7.5,
              maxOutputBytes: 2 * MEBIBYTE,
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
      expect(plan).not.toHaveProperty("verification");

      try {
        const started = await record.recordSemanticCampaignRunStart(plan);
        expect(started).toMatchObject({ disposition: "started" });
        await expect(
          record.recordSemanticCampaignRunStart(plan),
        ).resolves.toEqual(started);
        await expect(
          record.recordSemanticCampaignRunStart({
            ...plan,
            runId: `${plan.runId}-non-opus-validation`,
            validation: {
              ...plan.validation,
              validatorModelProfile: {
                ...plan.validation.validatorModelProfile,
                execution: {
                  ...plan.validation.validatorModelProfile.execution,
                  model: "claude-sonnet-5",
                },
              },
            },
          }),
        ).rejects.toBeInstanceOf(CampaignRunConflictError);
        await expect(
          record.recordSemanticCampaignRunStart({
            ...plan,
            runId: `${plan.runId}-non-opus-synthesis`,
            validation: {
              ...plan.validation,
              synthesisModelProfile: {
                ...plan.validation.synthesisModelProfile,
                execution: {
                  ...plan.validation.synthesisModelProfile.execution,
                  model: "claude-sonnet-5",
                },
              },
            },
          }),
        ).rejects.toBeInstanceOf(CampaignRunConflictError);
      } finally {
        record.close();
        await rm(directory, { force: true, recursive: true });
      }
    },
  );
});
