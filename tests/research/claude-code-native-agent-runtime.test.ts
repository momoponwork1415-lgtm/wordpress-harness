import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
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
scratch=''
for argument in "$@"; do
  [ "$argument" != "--runtime=runsc" ] || has_runsc=1
  [ "$argument" != "--version" ] || is_version_probe=1
  case "$argument" in
    *:/workspace/research:rw) scratch="\${argument%:/workspace/research:rw}" ;;
  esac
done
[ "$has_runsc" -eq 1 ] || exit 90
if [ "$is_version_probe" -eq 1 ]; then
  printf '%s\n' '2.1.263 (Claude Code)'
  exit 0
fi
[ -n "$scratch" ] || exit 92
printf '%s\n' "$scratch" >> "$0.scratch"
prompt=$(cat)
invocation=1
if [ -f "$0.count" ]; then
  invocation=$(( $(cat "$0.count") + 1 ))
fi
printf '%s' "$invocation" > "$0.count"
if [ "$invocation" -eq 1 ]; then
  printf '%s' '{"type":"result","subtype":"success","is_error":false,"terminal_reason":"completed","structured_output":{"schemaVersion":1,"candidates":[{"candidateId":"candidate-claude-stored-xss-1","attackerPremise":"An unauthenticated visitor can submit the public form.","brokenSecurityProperty":"Persisted attacker input must be inert in privileged output.","claim":"A public form value is stored and rendered to an administrator without escaping.","evidence":[{"path":"public/save.php","location":"save_value:44","observation":"Persists the public value."}]}],"decision":{"kind":"stop","basis":"No separate actionable source-bound frontier remains."}},"total_cost_usd":0.75,"duration_ms":90000,"num_turns":8,"permission_denials":[],"usage":{"server_tool_use":{"web_search_requests":0,"web_fetch_requests":0}},"subagent_stats":{"spawned":3},"modelUsage":{"claude-opus-4-1":{"canonicalModel":"claude-opus-4-1","inputTokens":8000,"outputTokens":1500,"cacheReadInputTokens":2000,"cacheCreationInputTokens":500}}}'
  exit 0
fi
printf '%s' "$prompt" | grep -F 'This is one fresh Independent Validation.' >/dev/null
printf '%s' "$prompt" | grep -F 'Candidate:' >/dev/null
if printf '%s' "$prompt" | grep -F 'Prior source-bound reports:' >/dev/null; then
  exit 93
fi
printf '%s' '{"type":"result","subtype":"success","is_error":false,"terminal_reason":"completed","structured_output":{"schemaVersion":1,"candidateId":"candidate-claude-stored-xss-1","disposition":"source-validated","reason":"The public write and privileged unescaped output are independently supported.","evidence":[{"path":"admin/view.php","location":"render_value:88","observation":"Emits the persisted value without escaping."}]},"total_cost_usd":0.5,"duration_ms":60000,"num_turns":5,"permission_denials":[],"usage":{"server_tool_use":{"web_search_requests":0,"web_fetch_requests":0}},"subagent_stats":{"spawned":1},"modelUsage":{"claude-opus-4-1":{"canonicalModel":"claude-opus-4-1","inputTokens":6000,"outputTokens":900,"cacheReadInputTokens":500,"cacheCreationInputTokens":250}}}'
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
      validationPromptSet: {
        id: "independent-validation-v1",
        digest:
          "sha256:1111111111111111111111111111111111111111111111111111111111111111",
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
        maxNativeRuns: 2,
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
      validationPromptSet: {
        digest: input.validationPromptSet.digest,
        text: "Independently validate one source-bound candidate.",
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
              basis: "No separate actionable source-bound frontier remains.",
            },
          },
        },
      ],
      validationRuns: [
        {
          candidateId: "candidate-claude-stored-xss-1",
          receipt: {
            terminal: "completed",
            usage: {
              wallTimeMs: 60_000,
              inputTokens: 6_750,
              outputTokens: 900,
              estimatedCostUsd: 0.5,
            },
            activity: { subagents: 1 },
            isolation: {
              backend: "gvisor",
              runtime: "runsc",
              fallbackUsed: false,
            },
            report: { disposition: "source-validated" },
          },
        },
      ],
      findings: [
        {
          candidateId: "candidate-claude-stored-xss-1",
          assurance: "source-validated",
        },
      ],
    });
    const scratchPaths = (
      await readFile(`${dockerExecutablePath}.scratch`, "utf8")
    )
      .trim()
      .split("\n");
    expect(scratchPaths).toHaveLength(2);
    expect(new Set(scratchPaths).size).toBe(2);
    campaigns.close();
  });
});
