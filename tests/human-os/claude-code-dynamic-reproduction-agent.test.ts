import {
  chmod,
  mkdir,
  mkdtemp,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  openClaudeCodeDynamicReproductionAgent,
  type ContainerProcessRequest,
  type ContainerProcessResult,
  type DynamicReproductionExperiment,
} from "../../src/human-os/index.js";
import type { SourceValidatedFinding } from "../../src/research/index.js";

const digest = (character: string): string => `sha256:${character.repeat(64)}`;

const finding: SourceValidatedFinding = {
  kind: "source-validated-finding",
  schemaVersion: 1,
  findingId: "campaign-claude:finding:candidate-1",
  candidateId: "candidate-1",
  targetSnapshot: {
    id: "example-1.0.0",
    pluginSlug: "example",
    version: "1.0.0",
    digest: digest("a"),
    sourceTree: { digest: digest("9"), entries: 1, bytes: 6 },
  },
  attackerPremise: "An unauthenticated visitor controls a public value.",
  brokenSecurityProperty: "The public value must remain inert.",
  claim: "The public value reaches an executable browser context.",
  assurance: "source-validated",
  validation: {
    runId: "campaign-claude:validation:1",
    promptSet: { id: "validation-v1", digest: digest("b") },
    runtimeProfileDigest: digest("c"),
    permissionProfileDigest: digest("d"),
  },
  evidence: [
    {
      path: "example.php",
      location: "save:44",
      observation: "Stores the visitor-controlled value.",
    },
  ],
};

function claudeEnvelope(structuredOutput: unknown, sequence: number): string {
  return JSON.stringify({
    type: "result",
    subtype: "success",
    is_error: false,
    terminal_reason: "completed",
    structured_output: structuredOutput,
    total_cost_usd: 0.05,
    duration_ms: 1_000,
    num_turns: 2,
    permission_denials: [],
    session_id:
      sequence === 1
        ? "11111111-1111-4111-8111-111111111111"
        : "22222222-2222-4222-8222-222222222222",
    usage: {
      server_tool_use: { web_search_requests: 0, web_fetch_requests: 0 },
    },
    subagent_stats: { spawned: 1 },
    modelUsage: {
      "claude-opus-4-1": {
        canonicalModel: "claude-opus-4-1",
        inputTokens: 100,
        outputTokens: 50,
        cacheReadInputTokens: 0,
        cacheCreationInputTokens: 0,
      },
    },
  });
}

describe("Claude Code Dynamic Reproduction Agent", () => {
  it("lets Claude choose experiments until it returns an adversarially checked outcome", async () => {
    const directory = await mkdtemp(join(tmpdir(), "claude-dynamic-"));
    const sourceDirectory = join(directory, "source");
    const providerConfigDirectory = join(directory, "provider");
    const scratchRootDirectory = join(directory, "scratch");
    await Promise.all([
      mkdir(sourceDirectory),
      mkdir(providerConfigDirectory),
      mkdir(scratchRootDirectory),
    ]);
    await writeFile(join(sourceDirectory, "example.php"), "<?php\n", "utf8");
    await writeFile(
      join(providerConfigDirectory, ".credentials.json"),
      '{"token":"private"}',
      { mode: 0o600 },
    );
    await chmod(providerConfigDirectory, 0o700);
    const requests: ContainerProcessRequest[] = [];
    let claudeRuns = 0;
    const processRunner = {
      run: async (
        request: ContainerProcessRequest,
      ): Promise<ContainerProcessResult> => {
        requests.push(request);
        if (request.args.at(-1) === "--version") {
          return { exitCode: 0, stdout: "2.1.220 (Claude Code)", stderr: "" };
        }
        claudeRuns += 1;
        return claudeRuns === 1
          ? {
              exitCode: 0,
              stdout: claudeEnvelope(
                {
                  decision: "execute",
                  purpose: "Test the public value with a browser canary.",
                  script:
                    'console.log(await (await fetch("http://wordpress/")).text())',
                  timeoutMs: 30_000,
                },
                1,
              ),
              stderr: "",
            }
          : {
              exitCode: 0,
              stdout: claudeEnvelope(
                {
                  decision: "complete",
                  outcome: {
                    status: "runtime-confirmed",
                    summary:
                      "The browser canary executed after the adversarial check.",
                    preconditionsMatched: true,
                    recipeCompleted: true,
                    effectObserved: true,
                  },
                },
                2,
              ),
              stderr: "",
            };
      },
    };
    const run = vi.fn(async () => ({
      exitCode: 0,
      stdout: "browser-canary-executed",
      stderr: "",
    }));
    const experiment: DynamicReproductionExperiment = {
      environmentId: "dynamic-environment-1",
      run,
    };
    const agent = openClaudeCodeDynamicReproductionAgent({
      dockerExecutablePath: "/usr/bin/docker",
      image:
        "agent.invalid/claude@sha256:b8bb6b8f8865dbabb70f03bb71639792fe1f5c4301a8cd874d212435e5cda355",
      executableVersion: "2.1.220",
      model: "claude-opus-4-1",
      effort: "high",
      providerConfigDirectory,
      scratchRootDirectory,
      budget: {
        maxNativeRuns: 4,
        maxWallTimeMs: 120_000,
        maxEstimatedCostUsd: 1,
      },
      processRunner,
      clock: (() => {
        let tick = 0;
        return () => new Date(Date.UTC(2026, 8, 8, 11, 0, tick++));
      })(),
    });

    try {
      await expect(
        agent.execute({ finding, sourceDirectory, experiment }),
      ).resolves.toEqual({
        status: "runtime-confirmed",
        summary: "The browser canary executed after the adversarial check.",
        preconditionsMatched: true,
        recipeCompleted: true,
        effectObserved: true,
      });
      expect(run).toHaveBeenCalledTimes(1);
      expect(run).toHaveBeenCalledWith({
        script: 'console.log(await (await fetch("http://wordpress/")).text())',
        timeoutMs: 30_000,
      });
      expect(claudeRuns).toBe(2);
      const containerRuns = requests.filter(
        (request) => request.args[0] === "run",
      );
      expect(containerRuns).toHaveLength(3);
      expect(
        containerRuns.every((request) =>
          request.args.includes("--runtime=runsc"),
        ),
      ).toBe(true);
      const invocation = containerRuns.at(-1)?.args.join(" ") ?? "";
      expect(invocation).toContain("Agent,Read,Glob,Grep");
      expect(invocation).not.toContain("Bash,");
      expect(invocation).toContain("WebFetch");
      expect(invocation).toContain("WebSearch");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("does not leave an ephemeral provider home when credentials are unavailable", async () => {
    const directory = await mkdtemp(join(tmpdir(), "claude-no-credential-"));
    const sourceDirectory = join(directory, "source");
    const providerConfigDirectory = join(directory, "provider");
    const scratchRootDirectory = join(directory, "scratch");
    await Promise.all([
      mkdir(sourceDirectory),
      mkdir(providerConfigDirectory),
      mkdir(scratchRootDirectory),
    ]);
    await writeFile(join(sourceDirectory, "example.php"), "<?php\n", "utf8");
    const agent = openClaudeCodeDynamicReproductionAgent({
      dockerExecutablePath: "/usr/bin/docker",
      image:
        "agent.invalid/claude@sha256:b8bb6b8f8865dbabb70f03bb71639792fe1f5c4301a8cd874d212435e5cda355",
      executableVersion: "2.1.220",
      model: "claude-opus-4-1",
      effort: "high",
      providerConfigDirectory,
      scratchRootDirectory,
      budget: {
        maxNativeRuns: 1,
        maxWallTimeMs: 10_000,
        maxEstimatedCostUsd: 1,
      },
      processRunner: {
        run: async () => ({ exitCode: 0, stdout: "", stderr: "" }),
      },
    });
    const experiment: DynamicReproductionExperiment = {
      environmentId: "unused",
      run: async () => ({ exitCode: 0, stdout: "", stderr: "" }),
    };

    try {
      await expect(
        agent.execute({ finding, sourceDirectory, experiment }),
      ).rejects.toThrow();
      expect(await readdir(scratchRootDirectory)).toEqual([]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
