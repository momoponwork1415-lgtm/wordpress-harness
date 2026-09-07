import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { runCli } from "../../src/cli.js";
import {
  promptTextDigest,
  type CampaignInput,
} from "../../src/research/index.js";

const digest = (character: string): string => `sha256:${character.repeat(64)}`;

describe("agent-led campaign CLI", () => {
  it("conducts and inspects only the agent-led Campaign interface", async () => {
    const directory = await mkdtemp(join(tmpdir(), "agent-led-cli-"));
    const sourceDirectory = join(directory, "source");
    const providerConfigDirectory = join(directory, "provider");
    const scratchRootDirectory = join(directory, "scratch");
    await Promise.all([
      mkdir(sourceDirectory),
      mkdir(providerConfigDirectory),
      mkdir(scratchRootDirectory),
    ]);
    await writeFile(join(sourceDirectory, "plugin.php"), "<?php\n", "utf8");
    const researchPrompt = "Research broken security semantics from source.";
    const validationPrompt = "Independently validate the candidate from source.";
    const researchPromptPath = join(directory, "research-prompt.txt");
    const validationPromptPath = join(directory, "validation-prompt.txt");
    await Promise.all([
      writeFile(researchPromptPath, researchPrompt, "utf8"),
      writeFile(validationPromptPath, validationPrompt, "utf8"),
    ]);
    const input: CampaignInput = {
      kind: "agent-led-campaign",
      schemaVersion: 1,
      campaignId: "campaign-cli-agent-led",
      targetSnapshot: {
        id: "example-1.0.0",
        pluginSlug: "example",
        version: "1.0.0",
        digest: digest("a"),
      },
      promptSet: {
        id: "agent-led-research-v1",
        digest: promptTextDigest(researchPrompt),
      },
      validationPromptSet: {
        id: "independent-validation-v1",
        digest: promptTextDigest(validationPrompt),
      },
      agentRuntimeProfile: {
        id: "grok-build-native-v1",
        kind: "grok-build-native/v1",
        executableVersion: "1.0.13",
        model: "grok-4.6",
        effort: "xhigh",
        digest: digest("b"),
      },
      permissionProfile: {
        id: "gvisor-source-research-v1",
        digest: digest("c"),
      },
      budgetEnvelope: {
        id: "agent-led-budget-v1",
        maxNativeRuns: 2,
        maxWallTimeMs: 600_000,
        maxEstimatedCostUsd: 5,
        digest: digest("d"),
      },
    };
    const inputPath = join(directory, "campaign.json");
    await writeFile(inputPath, JSON.stringify(input), "utf8");
    const dockerExecutablePath = join(directory, "fake-docker");
    await writeFile(
      dockerExecutablePath,
      `#!/bin/sh
set -eu
if [ "\${1:-}" = "info" ]; then
  printf '%s' '{}'
  exit 0
fi
if [ "\${1:-}" = "image" ]; then
  exit 0
fi
exit 90
`,
      { encoding: "utf8", mode: 0o700 },
    );
    await chmod(dockerExecutablePath, 0o700);
    const databasePath = join(directory, "research.sqlite");
    const output: string[] = [];
    const errors: string[] = [];
    const io = {
      stdout: (text: string) => output.push(text),
      stderr: (text: string) => errors.push(text),
    };

    try {
      const conductExit = await runCli(
        [
          "campaign",
          "conduct",
          "--database",
          databasePath,
          "--input",
          inputPath,
          "--docker",
          dockerExecutablePath,
          "--image",
          digest("f"),
          "--source",
          sourceDirectory,
          "--provider-config",
          providerConfigDirectory,
          "--scratch",
          scratchRootDirectory,
          "--research-prompt",
          researchPromptPath,
          "--validation-prompt",
          validationPromptPath,
        ],
        io,
      );
      const inspectExit = await runCli(
        [
          "campaign",
          "inspect",
          "--database",
          databasePath,
          "--campaign",
          input.campaignId,
        ],
        io,
      );

      expect({ conductExit, inspectExit, errors }).toEqual({
        conductExit: 0,
        inspectExit: 0,
        errors: [],
      });
      expect(JSON.parse(output[0] ?? "null")).toMatchObject({
        kind: "agent-led-campaign-outcome",
        campaignId: input.campaignId,
        status: "incomplete",
      });
      expect(JSON.parse(output[1] ?? "null")).toMatchObject({
        kind: "agent-led-campaign-outcome",
        campaignId: input.campaignId,
        status: "incomplete",
        nativeRuns: [{ terminal: "policy-denied" }],
        findings: [],
        coverage: { status: "incomplete" },
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("does not retain the legacy prepare command", async () => {
    const errors: string[] = [];
    const exit = await runCli(["campaign", "prepare"], {
      stdout: () => undefined,
      stderr: (text: string) => errors.push(text),
    });

    expect(exit).toBe(1);
    expect(errors.join("")).toContain(
      "Usage: wordpress-harness campaign <conduct|inspect>",
    );
  });
});
