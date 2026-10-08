import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  codexNativeTransport,
  defineAgentRuntimeProfile,
} from "../../src/infrastructure/agent-runtime-profile.js";
import { runCampaignExplorationVolumeCli } from "../../src/operations/campaign-exploration-volume-cli.js";
import type { CampaignInput } from "../../src/research/index.js";
import type { NativeAgentRuntime } from "../../src/research/agent-led/contracts.js";
import { openResearchCampaigns } from "../../src/research/agent-led/research-campaigns.js";
import { researchPromptSetForMethod } from "../../src/research/agent-led/research-methods.js";
import { openLocalDirectoryTargetIntake } from "../../src/target-intelligence/acquisition/index.js";
import { researchEvidenceSummaryFixture } from "../research/support/research-evidence-summary.js";

const temporaryDirectories: string[] = [];
const digest = (character: string): string => `sha256:${character.repeat(64)}`;

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

const runtime: NativeAgentRuntime = {
  async execute(run) {
    return {
      schemaVersion: 2,
      runId: run.runId,
      runtimeProfileDigest: run.agentRuntimeProfile.digest,
      terminal: "completed",
      startedAt: "2026-09-07T01:00:00.000Z",
      completedAt: "2026-09-07T01:02:00.000Z",
      usage: {
        wallTimeMs: 120_000,
        inputTokens: 10_000,
        outputTokens: 2_000,
        estimatedCostUsd: 1.25,
      },
      activity: { subagents: 2, tools: ["source.search", "source.read"] },
      isolation: { backend: "gvisor", runtime: "runsc", fallbackUsed: false },
      checkpoint: {
        kind: "agent-checkpoint",
        schemaVersion: 1,
        checkpointId: `${run.runId}:checkpoint`,
        stateDigest: digest("1"),
        stateEntries: 1,
        stateBytes: 1,
        sessionId: "12121212-1212-4121-8121-121212121212",
        targetSnapshotDigest: run.targetSnapshot.digest,
        promptSetDigest: run.promptSet.digest,
        runtimeProfileDigest: run.agentRuntimeProfile.digest,
        permissionProfileDigest: run.permissionProfile.digest,
      },
      report: {
        schemaVersion: 2,
        assessments: [],
        evidenceSummary: researchEvidenceSummaryFixture(),
        candidates: [],
        decision: { kind: "stop", basis: "No actionable frontier remains." },
      },
    };
  },
};

describe("campaign exploration volume CLI", () => {
  it("summarizes listed Campaign databases with Target manifests as CSV and JSON", async () => {
    const directory = await mkdtemp(join(tmpdir(), "exploration-volume-"));
    temporaryDirectories.push(directory);

    const source = join(directory, "source");
    await mkdir(join(source, "assets"), { recursive: true });
    await writeFile(
      join(source, "plugin.php"),
      "<?php\n/*\nPlugin Name: Volume Plugin\nVersion: 1.0.0\n*/\n",
    );
    await writeFile(join(source, "assets", "app.js"), "console.log(1);\n");
    const intake = openLocalDirectoryTargetIntake({
      storageDirectory: join(directory, "intake-storage"),
    });
    const disposition = await intake.intake({
      kind: "manual-target-intake",
      schemaVersion: 1,
      source: { kind: "local-directory", path: source },
      pluginIdentity: { kind: "wporg", slug: "volume-plugin" },
      requestedVersion: "1.0.0",
      mainPluginFile: "plugin.php",
      provenance: {
        kind: "operator-provided",
        acquisitionRef: { id: "volume-source", digest: digest("6") },
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
    const packetPath = join(directory, "intake-packet.json");
    await writeFile(packetPath, JSON.stringify(disposition.packet), "utf8");
    const notAPacketPath = join(directory, "other.json");
    await writeFile(notAPacketPath, JSON.stringify({ kind: "other" }), "utf8");

    const input: CampaignInput = {
      kind: "agent-led-campaign",
      schemaVersion: 2,
      campaignId: "campaign-volume-1",
      targetSnapshot: {
        id: "volume-plugin-1.0.0",
        pluginSlug: "volume-plugin",
        version: "1.0.0",
        digest: disposition.packet.targetSnapshot.digest,
        sourceTree: {
          digest: disposition.packet.sourceTree.digest,
          entries: disposition.packet.sourceTree.entries,
          bytes: disposition.packet.sourceTree.manifest.entries.reduce(
            (total, entry) => total + entry.size,
            0,
          ),
        },
      },
      promptSet: researchPromptSetForMethod("wp2shell"),
      agentRuntimeProfile: defineAgentRuntimeProfile({
        id: "codex-daybreak-xhigh",
        ...codexNativeTransport,
        model: "gpt-daybreak-blue-latest",
        effort: "xhigh",
      }),
      permissionProfile: { id: "source-only-v1", digest: digest("d") },
      budgetEnvelope: {
        id: "campaign-envelope-v1",
        maxNativeRuns: 1,
        maxWallTimeMs: 600_000,
        digest: digest("e"),
      },
    };
    const databasePath = join(directory, "research.sqlite");
    const campaigns = openResearchCampaigns({ databasePath, runtime });
    await campaigns.conduct(input);
    campaigns.close();

    const databaseListPath = join(directory, "databases.txt");
    await writeFile(
      databaseListPath,
      `# one database per line\n${databasePath}\n\n`,
      "utf8",
    );
    const intakeListPath = join(directory, "intakes.txt");
    await writeFile(
      intakeListPath,
      `${packetPath}\n${notAPacketPath}\n`,
      "utf8",
    );

    const csvOut: string[] = [];
    const csvErr: string[] = [];
    await expect(
      runCampaignExplorationVolumeCli(
        [
          "--database-list",
          databaseListPath,
          "--intake-list",
          intakeListPath,
          "--format",
          "csv",
        ],
        {
          stdout: (text) => csvOut.push(text),
          stderr: (text) => csvErr.push(text),
        },
      ),
    ).resolves.toBe(0);
    expect(csvOut.join("")).toBe(
      [
        "campaignId,status,pluginSlug,version,sourceEntries,sourceBytes,phpFiles,phpBytes,transportKind,model,effort,promptSetId,runsAttempted,runsCompleted,runsFailed,runsOrphaned,wallTimeMs,inputTokens,outputTokens,estimatedCostUsd,toolCalls,subagentsMax,candidates,parkedProgrammeLeads,finalDecision",
        "campaign-volume-1,coverage-closed,volume-plugin,1.0.0,2,70,1,54,codex-native/v1,gpt-daybreak-blue-latest,xhigh,wordpress-plugin-research-wp2shell-v9,1,1,0,0,120000,10000,2000,1.25,2,2,0,0,stop",
        "",
      ].join("\n"),
    );
    expect(csvErr.join("")).toBe(
      "campaign databases: 1, campaigns: 1, intake packets: 1, skipped intake files: 1, missing databases: 0, unreadable databases: 0\n",
    );

    const jsonOut: string[] = [];
    await expect(
      runCampaignExplorationVolumeCli(
        ["--database-list", databaseListPath, "--format", "json"],
        { stdout: (text) => jsonOut.push(text), stderr: () => {} },
      ),
    ).resolves.toBe(0);
    expect(JSON.parse(jsonOut.join(""))).toMatchObject({
      kind: "campaign-exploration-volume",
      schemaVersion: 1,
      rows: [
        {
          campaignId: "campaign-volume-1",
          sourceTree: { entries: 2, bytes: 70 },
          phpSource: "unknown",
          finalDecision: "stop",
        },
      ],
    });
  });

  it("rejects a missing database list without writing output", async () => {
    const out: string[] = [];
    const err: string[] = [];
    await expect(
      runCampaignExplorationVolumeCli(["--format", "csv"], {
        stdout: (text) => out.push(text),
        stderr: (text) => err.push(text),
      }),
    ).resolves.toBe(1);
    expect(out).toStrictEqual([]);
    expect(err.join("")).toContain("--database-list");
  });

  it("skips missing and unreadable databases without creating files", async () => {
    const directory = await mkdtemp(join(tmpdir(), "exploration-volume-"));
    temporaryDirectories.push(directory);
    const missingPath = join(directory, "missing.sqlite");
    const corruptPath = join(directory, "corrupt.sqlite");
    await writeFile(corruptPath, "not a database\n", "utf8");
    const databaseListPath = join(directory, "databases.txt");
    await writeFile(
      databaseListPath,
      `${missingPath}\n${corruptPath}\n`,
      "utf8",
    );

    const out: string[] = [];
    const err: string[] = [];
    await expect(
      runCampaignExplorationVolumeCli(
        ["--database-list", databaseListPath, "--format", "csv"],
        { stdout: (text) => out.push(text), stderr: (text) => err.push(text) },
      ),
    ).resolves.toBe(0);
    expect(out.join("").split("\n")).toHaveLength(2);
    expect(err.join("")).toBe(
      "campaign databases: 2, campaigns: 0, intake packets: 0, skipped intake files: 0, missing databases: 1, unreadable databases: 1\n",
    );
    await expect(stat(missingPath)).rejects.toThrow();
  });
});
