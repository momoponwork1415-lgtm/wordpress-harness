import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { runCli } from "../../src/cli.js";
import {
  currentSemanticCampaignPreparationConfiguration,
  openResearch,
} from "../../src/research/index.js";
import { openFileJsonArtifactStore } from "../../src/research/research-record/index.js";
import { openLocalDirectoryTargetIntake } from "../../src/target-intelligence/index.js";
import { createCampaignInput } from "../fixtures/campaign.js";

const digest = (character: string): string => `sha256:${character.repeat(64)}`;

describe("campaign run wiring", () => {
  it("builds the plan from the recorded preparation and keeps a provider failure typed", async () => {
    // The whole point of moving the run out of an operator script: the Target
    // identity, manifest and intake binding come from the Campaign
    // Preparation, not from the command line. Pointing --executable at
    // nothing exercises that wiring end to end without a provider, and pins
    // the failure semantics that matter most here — an unreachable provider
    // must stay an Attempt-level failure with a reason, never a campaign that
    // quietly reports no findings.
    const directory = await mkdtemp(join(tmpdir(), "wordpress-harness-wire-"));
    const source = join(directory, "source");
    const artifactDirectory = join(directory, "artifacts");
    const databasePath = join(directory, "research.sqlite");
    await mkdir(source, { recursive: true });
    await writeFile(
      join(source, "plugin.php"),
      "<?php\n/*\nPlugin Name: Example\nVersion: 2.4.1\n*/\n",
    );

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

      // Prepare with the same configuration the plan factory will later
      // build from. A Preparation that records a different prompt set,
      // profile or budget makes every plan for it a run conflict, so the two
      // halves are taken from one place rather than typed twice.
      const seed = createCampaignInput("campaign-run-wiring");
      const configuration =
        currentSemanticCampaignPreparationConfiguration("claude");
      const preparing = openResearch({
        databasePath,
        artifactStore: openFileJsonArtifactStore(artifactDirectory),
      });
      try {
        await preparing.runner.prepareFromTargetIntake({
          kind: "target-intake-campaign-preparation",
          schemaVersion: 1,
          campaignId: seed.campaignId,
          intake: disposition,
          campaignPolicy: seed.campaignPolicy,
          runtimeProfile: configuration.runtimeProfile,
          promptSet: configuration.promptSet,
          modelProfiles: configuration.modelProfiles,
          knowledgeCapsules: configuration.knowledgeCapsules,
          experimentRegistry: configuration.experimentRegistry,
          budget: configuration.budget,
        });
      } finally {
        preparing.close();
      }

      const output: string[] = [];
      const errors: string[] = [];
      const exit = await runCli(
        [
          "campaign",
          "run",
          "--database",
          databasePath,
          "--artifacts",
          artifactDirectory,
          "--campaign",
          seed.campaignId,
          "--run",
          `${seed.campaignId}:wave-1`,
          "--family",
          "claude",
          "--source",
          source,
          "--executable",
          join(directory, "no-such-claude"),
          "--work",
          join(directory, "work"),
        ],
        {
          stdout: (text: string) => output.push(text),
          stderr: (text: string) => errors.push(text),
        },
      );

      expect({ exit, errors }).toMatchObject({ exit: 0, errors: [] });
      const record: unknown = JSON.parse(output[0] ?? "null");
      expect(record).toMatchObject({
        kind: "campaign-run-record",
        runId: `${seed.campaignId}:wave-1`,
      });

      // The provider was never reachable, so the campaign must end typed and
      // incomplete. A run that reported a clean "no findings" here would be
      // the one failure this whole record exists to prevent.
      const reading = openResearch({
        databasePath,
        artifactStore: openFileJsonArtifactStore(artifactDirectory),
      });
      try {
        const view = await reading.reader.inspect(seed.campaignId, {
          kind: "run",
          runId: `${seed.campaignId}:wave-1`,
        });
        if (view.kind !== "run") throw new Error("Expected a run view");
        expect(view.value).toMatchObject({
          coverage: { status: "incomplete", reason: "planning-incomplete" },
        });
        expect("findings" in view.value ? view.value.findings : []).toEqual([]);
      } finally {
        reading.close();
      }
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  }, 120_000);
});
