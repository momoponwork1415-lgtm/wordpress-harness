import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { runCli } from "../../src/cli.js";
import { openResearch } from "../../src/research/index.js";
import { openFileJsonArtifactStore } from "../../src/research/research-record/index.js";
import { openLocalDirectoryTargetIntake } from "../../src/target-intelligence/index.js";
import { createCampaignInput } from "../fixtures/campaign.js";

const campaignInput = createCampaignInput("campaign-cli-brizy");
const digest = (character: string): string => `sha256:${character.repeat(64)}`;

describe("campaign CLI", () => {
  it("prepares and inspects a campaign through the Research interfaces", async () => {
    const directory = await mkdtemp(join(tmpdir(), "wordpress-harness-cli-"));
    const databasePath = join(directory, "research.sqlite");
    const inputPath = join(directory, "campaign.json");
    await writeFile(inputPath, JSON.stringify(campaignInput), "utf8");
    const output: string[] = [];
    const errors: string[] = [];
    const io = {
      stdout: (text: string) => output.push(text),
      stderr: (text: string) => errors.push(text),
    };

    try {
      const artifactDirectory = join(directory, "artifacts");
      const prepareExit = await runCli(
        [
          "campaign",
          "prepare",
          "--database",
          databasePath,
          "--artifacts",
          artifactDirectory,
          "--input",
          inputPath,
        ],
        io,
      );
      const inspectExit = await runCli(
        [
          "campaign",
          "inspect",
          "--database",
          databasePath,
          "--artifacts",
          artifactDirectory,
          "--campaign",
          campaignInput.campaignId,
        ],
        io,
      );
      const prepared: unknown = JSON.parse(output[0] ?? "null");
      const inspected: unknown = JSON.parse(output[1] ?? "null");

      expect({
        prepareExit,
        inspectExit,
        errors,
        prepared,
        inspected,
      }).toMatchObject({
        prepareExit: 0,
        inspectExit: 0,
        errors: [],
        prepared: {
          campaignId: "campaign-cli-brizy",
          status: "prepared",
          ledgerHead: 1,
        },
        inspected: {
          kind: "preparation",
          campaignId: "campaign-cli-brizy",
          input: {
            targetSnapshot: {
              id: "brizy-2.8.11",
              version: "2.8.11",
            },
          },
        },
      });
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it("prepares a Target Intake bound campaign, the current generation", async () => {
    // The retired v1 input carries no manifest and no intake, so it prepares
    // without a store. Every generation since needs one — v2 to persist the
    // Target File Manifest, v3 to also read back the Intake Packet and Receipt
    // its input names. A CLI that cannot supply one cannot prepare a campaign
    // anyone would run.
    const directory = await mkdtemp(
      join(tmpdir(), "wordpress-harness-cli-v3-"),
    );
    const source = join(directory, "source");
    const artifactDirectory = join(directory, "artifacts");
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

      // Mint a v3 input and its artifacts through the public interface, then
      // hand the CLI the same artifact directory and a database it has never
      // seen — exactly what an operator has after a Target Intake.
      const seed = createCampaignInput("campaign-cli-intake");
      const minting = openResearch({
        databasePath: join(directory, "minting.sqlite"),
        artifactStore: openFileJsonArtifactStore(artifactDirectory),
      });
      let campaignInputV3: unknown;
      try {
        await minting.runner.prepareFromTargetIntake({
          kind: "target-intake-campaign-preparation",
          schemaVersion: 1,
          campaignId: seed.campaignId,
          intake: disposition,
          campaignPolicy: seed.campaignPolicy,
          runtimeProfile: seed.runtimeProfile,
          promptSet: seed.promptSet,
          modelProfiles: seed.modelProfiles,
          knowledgeCapsules: seed.knowledgeCapsules,
          experimentRegistry: seed.experimentRegistry,
          budget: seed.budget,
        });
        const inspected = await minting.reader.inspect(seed.campaignId, {
          kind: "preparation",
        });
        if (inspected.kind !== "preparation") {
          throw new Error("Expected a preparation view");
        }
        campaignInputV3 = inspected.input;
      } finally {
        minting.close();
      }

      const inputPath = join(directory, "campaign-v3.json");
      await writeFile(inputPath, JSON.stringify(campaignInputV3), "utf8");
      const output: string[] = [];
      const errors: string[] = [];
      const io = {
        stdout: (text: string) => output.push(text),
        stderr: (text: string) => errors.push(text),
      };

      const exit = await runCli(
        [
          "campaign",
          "prepare",
          "--database",
          join(directory, "research.sqlite"),
          "--input",
          inputPath,
          "--artifacts",
          artifactDirectory,
        ],
        io,
      );

      expect({
        exit,
        errors,
        prepared: JSON.parse(output[0] ?? "null"),
      }).toMatchObject({
        exit: 0,
        errors: [],
        prepared: {
          campaignId: "campaign-cli-intake",
          status: "prepared",
          ledgerHead: 1,
        },
      });
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it("refuses to run a campaign prepared without a Target Intake", async () => {
    // The retired v1 input carries no intake binding and no canonical file
    // manifest, so the Target identity a current plan binds cannot be read
    // back from it. Refused by name here rather than half-built and rejected
    // later by plan validation.
    const directory = await mkdtemp(join(tmpdir(), "wordpress-harness-run-"));
    const databasePath = join(directory, "research.sqlite");
    const inputPath = join(directory, "campaign.json");
    await writeFile(inputPath, JSON.stringify(campaignInput), "utf8");
    const output: string[] = [];
    const errors: string[] = [];
    const io = {
      stdout: (text: string) => output.push(text),
      stderr: (text: string) => errors.push(text),
    };

    try {
      const artifactDirectory = join(directory, "artifacts");
      await runCli(
        [
          "campaign",
          "prepare",
          "--database",
          databasePath,
          "--artifacts",
          artifactDirectory,
          "--input",
          inputPath,
        ],
        io,
      );
      const exit = await runCli(
        [
          "campaign",
          "run",
          "--database",
          databasePath,
          "--artifacts",
          artifactDirectory,
          "--campaign",
          campaignInput.campaignId,
          "--run",
          `${campaignInput.campaignId}:wave-1`,
          "--family",
          "claude",
          "--source",
          join(directory, "source"),
          "--executable",
          "/nonexistent/claude",
          "--work",
          join(directory, "work"),
        ],
        io,
      );

      expect({ exit, errors }).toMatchObject({
        exit: 1,
        errors: [
          "Current Semantic Research requires a v3 Target Intake preparation\n",
        ],
      });
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it("refuses a model family outside the admitted catalog", async () => {
    // An unadmitted family has no profile ids, no transport and no eligibility
    // receipt, so there is no plan to build. Naming the admitted families in
    // the refusal keeps the operator from guessing.
    const directory = await mkdtemp(join(tmpdir(), "wordpress-harness-fam-"));
    const errors: string[] = [];
    const io = {
      stdout: () => undefined,
      stderr: (text: string) => errors.push(text),
    };

    try {
      const exit = await runCli(
        [
          "campaign",
          "run",
          "--database",
          join(directory, "research.sqlite"),
          "--artifacts",
          join(directory, "artifacts"),
          "--campaign",
          "campaign-cli-family",
          "--run",
          "campaign-cli-family:wave-1",
          "--family",
          "gemini",
          "--source",
          join(directory, "source"),
          "--executable",
          "/nonexistent/claude",
        ],
        io,
      );

      expect({ exit, errors }).toMatchObject({
        exit: 1,
        errors: ["Unknown model family: gemini. Admitted: claude, glm, grok\n"],
      });
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });
});
