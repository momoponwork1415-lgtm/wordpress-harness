import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  openClaudeCodeNativeAgentRuntime,
  openResearchCampaigns,
  type CampaignInput,
} from "../../src/research/index.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("Claude Code Native Agent Runtime", () => {
  it("returns a native-subagent report from a pinned runsc sandbox", async () => {
    const directory = await mkdtemp(join(tmpdir(), "claude-native-runtime-"));
    temporaryDirectories.push(directory);
    const sourceDirectory = join(directory, "source");
    const providerConfigDirectory = join(directory, "provider-config");
    const scratchRootDirectory = join(directory, "scratch");
    await Promise.all([
      mkdir(sourceDirectory),
      mkdir(providerConfigDirectory),
      mkdir(scratchRootDirectory),
    ]);
    await writeFile(join(sourceDirectory, "plugin.php"), "<?php\n", "utf8");

    const dockerExecutablePath = join(directory, "fake-docker");
    await writeFile(
      dockerExecutablePath,
      `#!/bin/sh
set -eu
if [ "\${1:-}" = "info" ]; then
  printf '%s' '{"runsc":{"path":"/usr/bin/runsc"}}'
  exit 0
fi
if [ "\${1:-}" = "image" ]; then
  exit 0
fi
has_runsc=0
is_version_probe=0
for argument in "$@"; do
  [ "$argument" != "--runtime=runsc" ] || has_runsc=1
  [ "$argument" != "--version" ] || is_version_probe=1
done
[ "$has_runsc" -eq 1 ] || exit 90
if [ "$is_version_probe" -eq 1 ]; then
  printf '%s\n' '2.1.263 (Claude Code)'
  exit 0
fi
printf '%s' '{"type":"result","subtype":"success","is_error":false,"terminal_reason":"completed","structured_output":{"schemaVersion":1,"candidates":[],"decision":{"kind":"stop","basis":"No actionable source-bound frontier remains."}},"total_cost_usd":0.75,"duration_ms":90000,"num_turns":8,"permission_denials":[],"usage":{"server_tool_use":{"web_search_requests":0,"web_fetch_requests":0}},"subagent_stats":{"spawned":3},"modelUsage":{"claude-opus-4-1":{"canonicalModel":"claude-opus-4-1","inputTokens":8000,"outputTokens":1500,"cacheReadInputTokens":2000,"cacheCreationInputTokens":500}}}'
`,
      { encoding: "utf8", mode: 0o700 },
    );
    await chmod(dockerExecutablePath, 0o700);

    const input: CampaignInput = {
      kind: "agent-led-campaign",
      schemaVersion: 1,
      campaignId: "campaign-claude-native-1",
      targetSnapshot: {
        id: "target-plugin-1.0.0",
        pluginSlug: "target-plugin",
        version: "1.0.0",
        digest:
          "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      },
      promptSet: {
        id: "agent-led-research-v1",
        digest:
          "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      },
      agentRuntimeProfile: {
        id: "claude-code-opus-native-v1",
        kind: "claude-code-native/v1",
        executableVersion: "2.1.263",
        model: "claude-opus-4-1",
        effort: "high",
        digest:
          "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
      },
      permissionProfile: {
        id: "gvisor-source-research-v1",
        digest:
          "sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
      },
      budgetEnvelope: {
        id: "agent-led-budget-v1",
        maxNativeRuns: 1,
        maxWallTimeMs: 600_000,
        maxEstimatedCostUsd: 5,
        digest:
          "sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
      },
    };
    const runtime = openClaudeCodeNativeAgentRuntime({
      dockerExecutablePath,
      image:
        "example.invalid/claude-agent@sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
      sourceDirectory,
      targetSnapshotDigest: input.targetSnapshot.digest,
      providerConfigDirectory,
      scratchRootDirectory,
      promptSet: {
        digest: input.promptSet.digest,
        text: "Audit the immutable WordPress plugin source from first principles.",
      },
      permissionProfileDigest: input.permissionProfile.digest,
      maxOutputBytes: 1_000_000,
    });
    const campaigns = openResearchCampaigns({
      databasePath: join(directory, "agent-led.sqlite"),
      runtime,
    });

    await expect(campaigns.conduct(input)).resolves.toMatchObject({
      status: "coverage-closed",
    });
    await expect(
      campaigns.inspect({ campaignId: "campaign-claude-native-1" }),
    ).resolves.toMatchObject({
      nativeRuns: [
        {
          terminal: "completed",
          usage: {
            wallTimeMs: 90_000,
            inputTokens: 10_500,
            outputTokens: 1_500,
            estimatedCostUsd: 0.75,
          },
          activity: { subagents: 3 },
          isolation: {
            backend: "gvisor",
            runtime: "runsc",
            fallbackUsed: false,
          },
          report: {
            decision: {
              kind: "stop",
              basis: "No actionable source-bound frontier remains.",
            },
          },
        },
      ],
    });
    campaigns.close();
  });
});
