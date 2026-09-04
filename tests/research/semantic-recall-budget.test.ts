import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { campaignDefaultSemanticRunPlanV2Schema } from "../../src/research/campaign-control/contracts.js";
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

describe("semantic-research-recall-baseline-v4", () => {
  it.each(targets)(
    "dry-checks $slug without starting a model or Lab",
    async ({ slug, version }) => {
      const directory = await mkdtemp(join(tmpdir(), "semantic-v4-dry-"));
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
          { id: "opus-planner-v4", digest: digest("5") },
          { id: "opus-finder-v4", digest: digest("6") },
          { id: "opus-evaluator-v4", digest: digest("7") },
          { id: "opus-verifier-v4", digest: digest("8") },
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
      const plan = campaignDefaultSemanticRunPlanV2Schema.parse({
        kind: "campaign-run-plan",
        schemaVersion: 2,
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
          id: "semantic-research-recall-baseline-v4",
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
          modelProfile: profile("opus-planner-v4", digest("5")),
          promptSet,
          sourceToolPolicy,
        },
        finder: {
          modelProfile: profile("opus-finder-v4", digest("6")),
          promptSet,
          selectedKnowledge: [],
          sourceToolPolicy,
        },
        evaluator: {
          modelProfile: profile("opus-evaluator-v4", digest("7")),
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
        verification: {
          labBaseline: {
            kind: "lab-baseline",
            schemaVersion: 1,
            id: `${slug}-baseline`,
            digest: digest("d"),
            targetSnapshotDigest: targetSnapshot.digest,
            runtimeProfileDigest: input.runtimeProfile.digest,
            setupPlanDigest: digest("e"),
            configurationDigest: digest("f"),
          },
          verifierModelProfile: profile("opus-verifier-v4", digest("8")).ref,
          promptSet,
          verificationPolicy: {
            kind: "verification-policy",
            schemaVersion: 1,
            id: "independent-pair-v1",
            digest: digest("0"),
          },
          experimentRegistry: {
            kind: "experiment-registry",
            schemaVersion: 1,
            id: input.experimentRegistry.id,
            digest: input.experimentRegistry.digest,
          },
          budget: {
            schemaVersion: 2,
            maxVerifierAttempts: 96,
            maxExperiments: 8,
            maxWallTimeMs: 7_200_000,
            maxModelTokens: 400_000,
            maxModelTurns: 128,
            maxProviderCostUsd: 30,
            maxOutputBytes: 2 * MEBIBYTE,
            reportedUsageEnforcement: "telemetry-only",
          },
        },
        budgetPolicy: {
          kind: "semantic-research-budget",
          schemaVersion: 1,
          id: "semantic-research-recall-baseline-v4",
          maxWorkWaves: 3,
          maxFinderAttempts: 12,
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
          verificationReserve: {
            maxModelTokens: 400_000,
            maxProviderCostUsd: 30,
            maxWallTimeMs: 7_200_000,
            maxVerifierAttempts: 96,
            maxExperiments: 8,
          },
        },
      });

      try {
        await expect(
          record.recordSemanticCampaignRunStart(plan),
        ).resolves.toMatchObject({ disposition: "started" });
      } finally {
        record.close();
        await rm(directory, { force: true, recursive: true });
      }
    },
  );
});
