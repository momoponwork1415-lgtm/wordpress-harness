import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  openResearch,
  type PreparedCampaign,
} from "../../src/research/index.js";
import type { SemanticWorkWavePlan } from "../../src/research/exploration/index.js";
import type {
  AttemptExecutionResultV2,
  AttemptPlanV2,
} from "../../src/research/model-execution/index.js";
import { sha256Digest } from "../../src/research/research-record/canonical-json.js";
import { openFileJsonArtifactStore } from "../../src/research/research-record/index.js";
import { openLocalDirectoryTargetIntake } from "../../src/target-intelligence/index.js";
import { createCampaignInput } from "../fixtures/campaign.js";

const digest = (character: string): string => `sha256:${character.repeat(64)}`;

function completedFinderResult(
  plan: Extract<AttemptPlanV2, { role: "finder" }>,
): AttemptExecutionResultV2 {
  const planDigest = sha256Digest(plan);
  const value = {
    kind: "model-attempt-result" as const,
    schemaVersion: 2 as const,
    attemptId: plan.attemptId,
    owner: "exploration" as const,
    role: "finder" as const,
    planDigest,
    status: "completed" as const,
    output: {
      kind: "finder-output" as const,
      schemaVersion: 2 as const,
      leaseId: plan.assignment.leaseId,
      hypotheses: [],
      routeFragments: [],
      frontierGaps: [],
    },
  };
  return {
    status: value.status,
    ref: {
      kind: "attempt-execution-result",
      schemaVersion: 2,
      attemptId: plan.attemptId,
      owner: "exploration",
      role: "finder",
      planDigest,
      digest: sha256Digest(value),
    },
    value,
  };
}

function singleFinderWave(
  target: {
    readonly id: string;
    readonly pluginSlug: string;
    readonly version: string;
    readonly digest: string;
  },
  manifest: {
    readonly kind: "target-file-manifest";
    readonly schemaVersion: 1;
    readonly targetSnapshotId: string;
    readonly targetSnapshotDigest: string;
    readonly digest: string;
  },
): SemanticWorkWavePlan {
  const thesis = {
    kind: "research-thesis" as const,
    schemaVersion: 1 as const,
    id: digest("3"),
    target,
    manifest,
    scope: "wildcard" as const,
    securityAssumption: "The plugin may expose a broken security semantic.",
    question: "Which high-impact security property can be broken?",
    motivation: "Exercise the Target Intake to Research handoff.",
    startingBasis: "Oracle-free Target identity and raw source only.",
    independence: "This is the only Finder in the handoff smoke Wave.",
  };
  const lease = {
    kind: "work-lease" as const,
    schemaVersion: 2 as const,
    id: digest("4"),
    role: "finder" as const,
    target,
    manifest,
    assignment: {
      kind: "research-thesis" as const,
      schemaVersion: 1 as const,
      thesisId: thesis.id,
    },
    budget: {
      maxWallTimeMs: 900_000,
      maxModelTokens: 100_000,
      maxModelTurns: 66,
      maxProviderCostUsd: 2.5,
      maxHypotheses: 8,
      maxOutputBytes: 512 * 1_024,
      maxSourceQueries: 64,
    },
  };
  return {
    kind: "work-wave-plan",
    schemaVersion: 2,
    id: digest("5"),
    ref: {
      kind: "work-wave",
      schemaVersion: 2,
      id: digest("5"),
      digest: digest("5"),
      targetSnapshotDigest: target.digest,
      manifestDigest: manifest.digest,
    },
    purpose: { kind: "raw-source" },
    target,
    manifest,
    policy: {
      kind: "semantic-root-planning-policy",
      schemaVersion: 1,
      id: "semantic-research-baseline-v1",
      digest: digest("6"),
    },
    plannerAttempt: {
      kind: "attempt-execution-result",
      schemaVersion: 2,
      attemptId: "root-planner-attempt",
      owner: "exploration",
      role: "root-planner",
      planDigest: digest("7"),
      digest: digest("8"),
    },
    theses: [thesis],
    leases: [lease],
  };
}

describe("CampaignRunner.prepareFromTargetIntake", () => {
  it("prepares and replays the exact ready Target Intake Packet without caller-supplied target identity", async () => {
    const directory = await mkdtemp(join(tmpdir(), "intake-campaign-"));
    const source = join(directory, "source");
    const databasePath = join(directory, "research.sqlite");
    const artifacts = openFileJsonArtifactStore(
      join(directory, "research-artifacts"),
    );
    await mkdir(join(source, "includes"), { recursive: true });
    await writeFile(
      join(source, "example.php"),
      "<?php\n/*\nPlugin Name: Example\nVersion: 2.4.1\n*/\n",
    );
    await writeFile(join(source, "includes", "feature.php"), "<?php\n");

    try {
      const intake = openLocalDirectoryTargetIntake({
        storageDirectory: join(directory, "intake-storage"),
      });
      const disposition = await intake.intake({
        kind: "manual-target-intake",
        schemaVersion: 1,
        source: { kind: "local-directory", path: source },
        pluginIdentity: { kind: "wporg", slug: "example" },
        requestedVersion: "2.4.1",
        provenance: {
          kind: "operator-provided",
          acquisitionRef: { id: "manual-copy", digest: digest("1") },
        },
        policy: {
          kind: "target-intake-policy",
          schemaVersion: 1,
          id: "manual-local-v1",
          digest: digest("2"),
          limits: {
            maxEntries: 100,
            maxFileBytes: 1_000_000,
            maxTotalBytes: 10_000_000,
            maxPathBytes: 512,
            maxDepth: 16,
          },
        },
      });
      if (disposition.status !== "ready") {
        throw new Error("Expected a ready Target Intake Packet");
      }
      const campaign = createCampaignInput("campaign-from-intake");
      let preparedForRun: PreparedCampaign | undefined;
      const research = openResearch({ databasePath, artifactStore: artifacts });
      try {
        const prepared = await research.runner.prepareFromTargetIntake({
          kind: "target-intake-campaign-preparation",
          schemaVersion: 1,
          campaignId: campaign.campaignId,
          intake: disposition,
          campaignPolicy: campaign.campaignPolicy,
          runtimeProfile: campaign.runtimeProfile,
          promptSet: campaign.promptSet,
          modelProfiles: campaign.modelProfiles,
          knowledgeCapsules: campaign.knowledgeCapsules,
          experimentRegistry: campaign.experimentRegistry,
          budget: campaign.budget,
        });
        preparedForRun = prepared;
        const inspected = await research.reader.inspect(campaign.campaignId, {
          kind: "preparation",
        });
        if (inspected.kind !== "preparation") {
          throw new Error("Expected a preparation view");
        }

        expect(prepared.targetSnapshot).toEqual(
          disposition.packet.targetSnapshot,
        );
        expect(inspected.input).toMatchObject({
          schemaVersion: 3,
          targetSnapshot: disposition.packet.targetSnapshot,
          canonicalFileManifest: disposition.packet.sourceTree.manifest,
          targetIntake: {
            packet: disposition.packetRef,
            receipt: disposition.receiptRef,
            sourceTreeDigest: disposition.packet.sourceTree.digest,
            pluginIdentity: disposition.packet.pluginIdentity,
            pluginBasename: disposition.packet.pluginBasename,
          },
        });
        await expect(
          artifacts.readJson(disposition.packetRef.digest),
        ).resolves.toEqual(disposition.packet);
        await expect(
          artifacts.readJson(disposition.receiptRef.digest),
        ).resolves.toEqual(disposition.receipt);
      } finally {
        research.close();
      }

      if (preparedForRun?.targetFileManifest === undefined) {
        throw new Error("Expected a Target File Manifest");
      }
      let finderRuns = 0;
      const reopened = openResearch({
        databasePath,
        artifactStore: artifacts,
        campaignExecution: {
          artifactStore: artifacts,
          attemptPlanMaterializer: {
            materialize: async () => {
              throw new Error("Legacy Map-first materializer must not run");
            },
          },
          modelExecution: {
            run: async (plan) => {
              if (plan.schemaVersion !== 2 || plan.role !== "finder") {
                throw new Error("Expected one Map-free Finder Attempt");
              }
              finderRuns += 1;
              return completedFinderResult(plan);
            },
          },
          independentVerifier: {
            rederive: async () => {
              throw new Error("Verifier must not run without a Hypothesis");
            },
          },
          labControl: {
            execute: async () => {
              throw new Error("Lab must not run without a Hypothesis");
            },
          },
        },
      });
      try {
        const replayed = await reopened.reader.inspect(campaign.campaignId, {
          kind: "preparation",
        });
        expect(replayed).toMatchObject({
          kind: "preparation",
          campaignId: campaign.campaignId,
          input: {
            schemaVersion: 3,
            targetIntake: {
              packet: disposition.packetRef,
              receipt: disposition.receiptRef,
            },
          },
        });
        const wave = singleFinderWave(
          disposition.packet.targetSnapshot,
          preparedForRun.targetFileManifest,
        );
        const waveArtifactDigest = await artifacts.putJson(wave);
        const runPlan = {
          kind: "campaign-run-plan" as const,
          schemaVersion: 2 as const,
          runId: "intake-handoff-wave",
          campaignId: campaign.campaignId,
          preparationDigest: preparedForRun.inputDigest,
          target: disposition.packet.targetSnapshot,
          manifest: preparedForRun.targetFileManifest,
          workWave: {
            ref: wave.ref,
            artifactDigest: waveArtifactDigest,
          },
          finder: {
            modelProfile: {
              ref: {
                kind: "model-profile" as const,
                schemaVersion: 1 as const,
                id: campaign.modelProfiles[0]!.id,
                family: "claude" as const,
                digest: campaign.modelProfiles[0]!.digest,
              },
              execution: {
                provider: "anthropic" as const,
                model: "claude-opus-5",
                transport: "claude-code-process" as const,
                executableVersion: "2.1.258",
                effort: "high" as const,
                eligibilityReceiptDigest: digest("9"),
              },
            },
            promptSet: {
              kind: "prompt-set" as const,
              schemaVersion: 1 as const,
              id: campaign.promptSet.id,
              digest: campaign.promptSet.digest,
            },
            selectedKnowledge: [],
            sourceToolPolicy: {
              kind: "source-tool-policy" as const,
              schemaVersion: 1 as const,
              id: "semantic-source-tools-v1",
              digest: digest("a"),
            },
          },
        };
        const runRef = await reopened.runner.run(runPlan);
        expect({ runRef, finderRuns }).toMatchObject({
          runRef: {
            kind: "campaign-run-record",
            schemaVersion: 2,
            decision: "finder-wave-completed",
          },
          finderRuns: 1,
        });
      } finally {
        reopened.close();
      }

      const corruptedReplay = openResearch({
        databasePath,
        artifactStore: {
          putJson: (value) => artifacts.putJson(value),
          readJson: (artifactDigest) =>
            artifactDigest === disposition.packetRef.digest
              ? Promise.resolve({})
              : artifacts.readJson(artifactDigest),
        },
      });
      try {
        await expect(
          corruptedReplay.reader.inspect(campaign.campaignId, {
            kind: "preparation",
          }),
        ).rejects.toMatchObject({
          name: "TargetIntakeHandoffIntegrityError",
          reason: "research-cas-artifact-invalid",
        });
      } finally {
        corruptedReplay.close();
      }
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it("rejects a modified Packet ref before creating a Campaign Ledger", async () => {
    const directory = await mkdtemp(join(tmpdir(), "intake-campaign-tamper-"));
    const source = join(directory, "source");
    await mkdir(source, { recursive: true });
    await writeFile(
      join(source, "plugin.php"),
      "<?php\n/*\nPlugin Name: Plugin\nVersion: 1.0.0\n*/\n",
    );

    try {
      const intake = openLocalDirectoryTargetIntake({
        storageDirectory: join(directory, "intake-storage"),
      });
      const disposition = await intake.intake({
        kind: "manual-target-intake",
        schemaVersion: 1,
        source: { kind: "local-directory", path: source },
        pluginIdentity: { kind: "wporg", slug: "plugin" },
        requestedVersion: "1.0.0",
        provenance: {
          kind: "operator-provided",
          acquisitionRef: { id: "manual-copy", digest: digest("1") },
        },
        policy: {
          kind: "target-intake-policy",
          schemaVersion: 1,
          id: "manual-local-v1",
          digest: digest("2"),
          limits: {
            maxEntries: 100,
            maxFileBytes: 1_000_000,
            maxTotalBytes: 10_000_000,
            maxPathBytes: 512,
            maxDepth: 16,
          },
        },
      });
      if (disposition.status !== "ready") {
        throw new Error("Expected a ready Target Intake Packet");
      }
      const campaign = createCampaignInput("campaign-tampered-intake");
      const research = openResearch({
        databasePath: join(directory, "research.sqlite"),
        artifactStore: openFileJsonArtifactStore(
          join(directory, "research-artifacts"),
        ),
      });
      try {
        await expect(
          research.runner.prepareFromTargetIntake({
            kind: "target-intake-campaign-preparation",
            schemaVersion: 1,
            campaignId: campaign.campaignId,
            intake: {
              ...disposition,
              packetRef: { ...disposition.packetRef, digest: digest("f") },
            },
            campaignPolicy: campaign.campaignPolicy,
            runtimeProfile: campaign.runtimeProfile,
            promptSet: campaign.promptSet,
            modelProfiles: campaign.modelProfiles,
            knowledgeCapsules: campaign.knowledgeCapsules,
            experimentRegistry: campaign.experimentRegistry,
            budget: campaign.budget,
          }),
        ).rejects.toMatchObject({
          name: "TargetIntakeHandoffIntegrityError",
          reason: "packet-digest-mismatch",
        });
        await expect(research.reader.read(campaign.campaignId)).rejects.toThrow(
          `Campaign not found: ${campaign.campaignId}`,
        );
      } finally {
        research.close();
      }
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });
});
