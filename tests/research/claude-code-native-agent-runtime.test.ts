import { createHash } from "node:crypto";
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

import { canonicalDigest } from "../../src/infrastructure/canonical-json.js";
import {
  openClaudeCodeNativeAgentRuntime,
  openResearchCampaigns,
  promptTextDigest,
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
    await Promise.all([
      writeFile(join(providerConfigDirectory, ".credentials.json"), "{}", {
        encoding: "utf8",
        mode: 0o600,
      }),
      writeFile(
        join(providerConfigDirectory, ".mcp.json"),
        '{"mcpServers":{"ambient":{"command":"forbidden"}}}',
        "utf8",
      ),
    ]);
    const sourceTreeDigest = canonicalDigest({
      kind: "canonical-file-manifest",
      schemaVersion: 1,
      entries: [
        {
          path: "plugin.php",
          digest: `sha256:${createHash("sha256").update("<?php\n").digest("hex")}`,
          size: 6,
        },
      ],
    });

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
has_interactive=0
has_ephemeral_provider_home=0
denies_provider_read=0
denies_provider_glob=0
denies_provider_grep=0
has_unsupported_option=0
volume_count=0
provider_mount=''
is_version_probe=0
scratch=''
previous=''
for argument in "$@"; do
  if [ "$previous" = "--json-schema" ]; then
    case "$argument" in
      *'"$schema"'*) exit 84 ;;
    esac
  fi
  [ "$argument" != "--runtime=runsc" ] || has_runsc=1
  [ "$argument" != "--interactive" ] || has_interactive=1
  [ "$argument" != "--env=CLAUDE_CONFIG_DIR=/provider" ] || has_ephemeral_provider_home=1
  [ "$argument" != 'Read(//provider/**)' ] || denies_provider_read=1
  [ "$argument" != 'Glob(//provider/**)' ] || denies_provider_glob=1
  [ "$argument" != 'Grep(//provider/**)' ] || denies_provider_grep=1
  case "$argument" in
    --restricted|--permission-prompts) has_unsupported_option=1 ;;
  esac
  [ "$argument" != "--volume" ] || volume_count=$((volume_count + 1))
  case "$argument" in
    *:/provider:ro) provider_mount="\${argument%:/provider:ro}" ;;
  esac
  [ "$argument" != "--version" ] || is_version_probe=1
  case "$argument" in
    *:/workspace/research:rw) scratch="\${argument%:/workspace/research:rw}" ;;
  esac
  previous="$argument"
done
[ "$has_runsc" -eq 1 ] || exit 90
[ "$has_interactive" -eq 1 ] || exit 89
[ "$volume_count" -eq 3 ] || exit 95
if [ "$is_version_probe" -eq 1 ]; then
  printf '%s\n' '2.1.220 (Claude Code)'
  exit 0
fi
[ -n "$scratch" ] || exit 92
[ "$has_unsupported_option" -eq 0 ] || exit 88
[ "$denies_provider_read" -eq 1 ] || exit 87
[ "$denies_provider_glob" -eq 1 ] || exit 86
[ "$denies_provider_grep" -eq 1 ] || exit 85
[ "$has_ephemeral_provider_home" -eq 1 ] || exit 96
case "$provider_mount" in
  "$scratch"/*) exit 94 ;;
esac
[ -f "$provider_mount/.credentials.json" ] || exit 97
[ ! -e "$provider_mount/.mcp.json" ] || exit 98
printf '%s\n' "$scratch" >> "$0.scratch"
prompt=$(cat)
invocation=1
if [ -f "$0.count" ]; then
  invocation=$(( $(cat "$0.count") + 1 ))
fi
printf '%s' "$invocation" > "$0.count"
if [ "$invocation" -eq 1 ]; then
  printf '%s' '{"type":"result","subtype":"success","is_error":false,"terminal_reason":"completed","structured_output":{"schemaVersion":1,"candidates":[{"candidateId":"candidate-claude-stored-xss-1","attackerPremise":"An unauthenticated visitor can submit the public form.","brokenSecurityProperty":"Persisted attacker input must be inert in privileged output.","claim":"A public form value is stored and rendered to an administrator without escaping.","evidence":[{"path":"public/save.php","location":"save_value:44","observation":"Persists the public value."}]}],"decision":{"kind":"stop","basis":"No separate actionable source-bound frontier remains."}},"total_cost_usd":0.75,"duration_ms":90000,"num_turns":8,"permission_denials":[],"usage":{"server_tool_use":{"web_search_requests":0,"web_fetch_requests":0}},"modelUsage":{"claude-opus-4-1":{"canonicalModel":"claude-opus-4-1","inputTokens":8000,"outputTokens":1500,"cacheReadInputTokens":2000,"cacheCreationInputTokens":500}}}'
  exit 0
fi
printf '%s' "$prompt" | grep -F 'This is one fresh Independent Validation.' >/dev/null
printf '%s' "$prompt" | grep -F 'Candidate:' >/dev/null
if printf '%s' "$prompt" | grep -F 'Prior source-bound reports:' >/dev/null; then
  exit 93
fi
printf '%s' '{"type":"result","subtype":"success","is_error":false,"terminal_reason":"completed","structured_output":{"schemaVersion":1,"candidateId":"candidate-claude-stored-xss-1","disposition":"source-validated","reason":"The public write and privileged unescaped output are independently supported.","evidence":[{"path":"admin/view.php","location":"render_value:88","observation":"Emits the persisted value without escaping."}]},"total_cost_usd":0.5,"duration_ms":60000,"num_turns":5,"permission_denials":[],"usage":{"server_tool_use":{"web_search_requests":0,"web_fetch_requests":0}},"modelUsage":{"claude-opus-4-1":{"canonicalModel":"claude-opus-4-1","inputTokens":6000,"outputTokens":900,"cacheReadInputTokens":500,"cacheCreationInputTokens":250}}}'
`,
      { encoding: "utf8", mode: 0o700 },
    );
    await chmod(dockerExecutablePath, 0o700);

    const researchPrompt =
      "Audit the immutable WordPress plugin source from first principles.";
    const validationPrompt =
      "Independently validate one source-bound candidate.";
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
        sourceTree: { digest: sourceTreeDigest, entries: 1, bytes: 6 },
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
        id: "claude-code-opus-native-v1",
        kind: "claude-code-native/v1",
        executableVersion: "2.1.220",
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
    const runtimeOptions = {
      dockerExecutablePath,
      sourceDirectory,
      targetSnapshotDigest: input.targetSnapshot.digest,
      sourceTree: input.targetSnapshot.sourceTree,
      providerConfigDirectory,
      scratchRootDirectory,
      promptSet: {
        digest: input.promptSet.digest,
        text: researchPrompt,
      },
      validationPromptSet: {
        digest: input.validationPromptSet.digest,
        text: validationPrompt,
      },
      permissionProfileDigest: input.permissionProfile.digest,
      maxOutputBytes: 1_000_000,
    };
    const unadmittedCampaigns = openResearchCampaigns({
      databasePath: join(directory, "unadmitted.sqlite"),
      runtime: openClaudeCodeNativeAgentRuntime({
        ...runtimeOptions,
        image:
          "example.invalid/claude-agent@sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
      }),
    });
    const unadmittedOutcome = await unadmittedCampaigns.conduct({
      ...input,
      campaignId: "campaign-claude-unadmitted-1",
    });
    unadmittedCampaigns.close();
    await Promise.all([
      rm(`${dockerExecutablePath}.count`, { force: true }),
      rm(`${dockerExecutablePath}.scratch`, { force: true }),
    ]);
    expect(unadmittedOutcome).toMatchObject({ status: "incomplete" });

    const runtime = openClaudeCodeNativeAgentRuntime({
      ...runtimeOptions,
      image:
        "sha256:b8bb6b8f8865dbabb70f03bb71639792fe1f5c4301a8cd874d212435e5cda355",
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
          activity: { subagents: null },
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
            activity: { subagents: null },
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
    expect(await readFile(join(sourceDirectory, "plugin.php"), "utf8")).toBe(
      "<?php\n",
    );
    campaigns.close();
  });
});
