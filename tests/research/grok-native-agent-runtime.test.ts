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

import {
  defineAgentRuntimeProfile,
  grokBuildNativeTransport,
} from "../../src/infrastructure/agent-runtime-profile.js";
import { canonicalDigest } from "../../src/infrastructure/canonical-json.js";
import { openGrokNativeAgentRuntime } from "../../src/research/agent-led/grok-native-agent-runtime.js";
import { openResearchCampaigns } from "../../src/research/agent-led/research-campaigns.js";
import {
  canonicalResearchPromptSet,
  type CampaignInput,
} from "../../src/research/index.js";
import { conductWithHumanAdvance } from "./support/candidate-review.js";
import { researchEvidenceSummaryFixture } from "./support/research-evidence-summary.js";

const temporaryDirectories: string[] = [];

function grokProfile() {
  return defineAgentRuntimeProfile({
    id: "grok-build-native-v1",
    ...grokBuildNativeTransport,
    model: "grok-4.6",
    effort: "xhigh",
  });
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("Grok Native Agent Runtime", () => {
  it("refuses prompt text that does not match its sealed digest", () => {
    expect(() =>
      openGrokNativeAgentRuntime({
        dockerExecutablePath: "/usr/bin/docker",
        image: `sha256:${"f".repeat(64)}`,
        sourceDirectory: "/source",
        targetSnapshotDigest: `sha256:${"a".repeat(64)}`,
        sourceTree: {
          digest: `sha256:${"9".repeat(64)}`,
          entries: 1,
          bytes: 1,
        },
        providerConfigDirectory: "/provider",
        scratchRootDirectory: "/scratch",
        promptSet: {
          digest: `sha256:${"b".repeat(64)}`,
          text: "This is not the sealed prompt.",
        },
        permissionProfileDigest: `sha256:${"d".repeat(64)}`,
        maxOutputBytes: 1_000_000,
      }),
    ).toThrow("Research prompt text does not match its sealed digest");
  });

  it("accepts a trailing response-text report when structured output is stale", async () => {
    const directory = await mkdtemp(join(tmpdir(), "grok-native-runtime-"));
    temporaryDirectories.push(directory);
    const sourceDirectory = join(directory, "source");
    const dependencyDirectory = join(directory, "wordpress-core");
    const providerConfigDirectory = join(directory, "provider-config");
    const scratchRootDirectory = join(directory, "scratch");
    await Promise.all([
      mkdir(sourceDirectory),
      mkdir(dependencyDirectory),
      mkdir(providerConfigDirectory),
      mkdir(scratchRootDirectory),
    ]);
    await writeFile(join(sourceDirectory, "plugin.php"), "<?php\n", "utf8");
    await writeFile(
      join(dependencyDirectory, "wp-load.php"),
      "<?php // core\n",
      "utf8",
    );
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
    const dependencyTreeDigest = canonicalDigest({
      kind: "canonical-file-manifest",
      schemaVersion: 1,
      entries: [
        {
          path: "wp-load.php",
          digest: `sha256:${createHash("sha256").update("<?php // core\n").digest("hex")}`,
          size: 14,
        },
      ],
    });
    await Promise.all([
      writeFile(join(providerConfigDirectory, "auth.json"), "{}", {
        encoding: "utf8",
        mode: 0o600,
      }),
      writeFile(join(providerConfigDirectory, "agent_id"), "agent-1", {
        encoding: "utf8",
        mode: 0o600,
      }),
    ]);
    const escapedEvidenceSummaryJson = JSON.stringify(
      researchEvidenceSummaryFixture("public/save.php"),
    ).replaceAll('"', '\\"');

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
has_host_user=0
has_outer_owned_sandbox=0
has_memory_disabled=0
has_ephemeral_provider_home=0
has_subagent_concurrency_limit=0
has_subagent_depth_limit=0
has_subagent_fail_limit=0
has_read_only_tools=0
has_json_output=0
has_dependency_mount=0
denies_provider_read=0
denies_provider_grep=0
volume_count=0
is_version_probe=0
scratch=''
provider_mount=''
managed_config=''
requirements_config=''
new_session=''
resume_session=''
previous=''
for argument in "$@"; do
  if [ "$previous" = "--session-id" ]; then new_session="$argument"; fi
  if [ "$previous" = "--resume" ]; then resume_session="$argument"; fi
  if [ "$previous" = "--output-format" ] && [ "$argument" = "json" ]; then has_json_output=1; fi
  [ "$argument" != "--runtime=runsc" ] || has_runsc=1
  [ "$argument" != "--user=$(id -u):$(id -g)" ] || has_host_user=1
  [ "$argument" != "off" ] || has_outer_owned_sandbox=1
  [ "$argument" != "--no-memory" ] || has_memory_disabled=1
  [ "$argument" != "--env=GROK_HOME=/provider" ] || has_ephemeral_provider_home=1
  [ "$argument" != "--env=GROK_MAX_CONCURRENT_SUBAGENTS=3" ] || has_subagent_concurrency_limit=1
  [ "$argument" != "--env=GROK_SUBAGENTS_MAX_DEPTH=1" ] || has_subagent_depth_limit=1
  [ "$argument" != "--env=GROK_SUBAGENT_LIMIT_BEHAVIOR=fail" ] || has_subagent_fail_limit=1
  [ "$argument" != "GrokBuild:read_file,GrokBuild:grep,GrokBuild:list_dir,GrokBuild:task,GrokBuild:get_task_output,GrokBuild:kill_task" ] || has_read_only_tools=1
  [ "$argument" != "Read(/provider/**)" ] || denies_provider_read=1
  [ "$argument" != "Grep(/provider/**)" ] || denies_provider_grep=1
  [ "$argument" != "--json-schema" ] || exit 110
  [ "$argument" != "--volume" ] || volume_count=$((volume_count + 1))
  case "$argument" in
    *:/provider:rw) provider_mount="\${argument%:/provider:rw}" ;;
    *:/workspace/dependencies/wordpress:ro) has_dependency_mount=1 ;;
    *:/etc/grok/managed_config.toml:ro) managed_config="\${argument%:/etc/grok/managed_config.toml:ro}" ;;
    *:/etc/grok/requirements.toml:ro) requirements_config="\${argument%:/etc/grok/requirements.toml:ro}" ;;
  esac
  [ "$argument" != "--version" ] || is_version_probe=1
  [ "$argument" != "--no-subagents" ] || exit 91
  case "$argument" in
    *:/workspace/research:rw) scratch="\${argument%:/workspace/research:rw}" ;;
  esac
  previous="$argument"
done
[ "$has_runsc" -eq 1 ] || exit 90
[ "$has_host_user" -eq 1 ] || exit 94
[ "$volume_count" -eq 6 ] || exit 100
[ "$has_dependency_mount" -eq 1 ] || exit 109
[ -n "$managed_config" ] || exit 115
grep -F 'general-purpose = "grok-4.6"' "$managed_config" >/dev/null
grep -F 'explore = "grok-4.6"' "$managed_config" >/dev/null
grep -F 'plan = "grok-4.6"' "$managed_config" >/dev/null
[ -n "$requirements_config" ] || exit 116
grep -F 'allowed_models = ["grok-4.6"]' "$requirements_config" >/dev/null
if [ "$is_version_probe" -eq 1 ]; then
  printf '%s\n' 'grok 1.0.13 (Grok Build)'
  exit 0
fi
[ "$has_outer_owned_sandbox" -eq 1 ] || exit 95
[ "$has_memory_disabled" -eq 1 ] || exit 96
[ "$has_ephemeral_provider_home" -eq 1 ] || exit 97
[ "$has_subagent_concurrency_limit" -eq 1 ] || exit 112
[ "$has_subagent_depth_limit" -eq 1 ] || exit 113
[ "$has_subagent_fail_limit" -eq 1 ] || exit 114
[ "$has_read_only_tools" -eq 1 ] || exit 101
[ "$has_json_output" -eq 1 ] || exit 111
[ "$denies_provider_read" -eq 1 ] || exit 102
[ "$denies_provider_grep" -eq 1 ] || exit 103
[ -n "$scratch" ] || exit 92
grep -F 'wordpress-core-7.1' "$scratch/prompt.txt" >/dev/null
grep -F 'Grok final' "$scratch/prompt.txt" >/dev/null
grep -F 'JSON Schema:' "$scratch/prompt.txt" >/dev/null
[ -n "$provider_mount" ] || exit 104
case "$provider_mount" in
  "$scratch"/*) exit 105 ;;
esac
[ -f "$provider_mount/auth.json" ] || exit 98
[ -f "$provider_mount/agent_id" ] || exit 99
if [ -n "$new_session" ] || [ -n "$resume_session" ]; then
  active_session="$new_session$resume_session"
  if [ -n "$resume_session" ]; then
    [ -f "$provider_mount/session-$resume_session.jsonl" ] || exit 106
    [ -f "$scratch/state.md" ] || exit 107
  fi
  printf '%s' '{"checkpoint":true}' > "$provider_mount/session-$active_session.jsonl"
  printf '%s' 'durable research notes' > "$scratch/state.md"
else
  active_session='11111111-1111-4111-8111-111111111111'
fi
printf '%s\n' "$scratch" >> "$0.scratch"
invocation=1
if [ -f "$0.count" ]; then
  invocation=$(( $(cat "$0.count") + 1 ))
fi
printf '%s' "$invocation" > "$0.count"
if [ "$invocation" -eq 1 ]; then
  printf '{"text":"Research complete. {\\"schemaVersion\\":2,\\"assessments\\":[],\\"evidenceSummary\\":${escapedEvidenceSummaryJson},\\"candidates\\":[{\\"candidateId\\":\\"candidate-grok-stored-xss-1\\",\\"attackerPremise\\":\\"An unauthenticated visitor can submit the public form.\\",\\"brokenSecurityProperty\\":\\"Persisted attacker input must be inert in privileged output.\\",\\"claim\\":\\"A public form value is stored and rendered to an administrator without escaping.\\",\\"evidence\\":[{\\"path\\":\\"public/save.php\\",\\"location\\":\\"save_value:44\\",\\"observation\\":\\"Persists the public value.\\"}],\\"sourceTrace\\":[{\\"role\\":\\"entrypoint\\",\\"path\\":\\"public/save.php\\",\\"location\\":\\"save_value:44\\",\\"observation\\":\\"The public form accepts attacker input.\\"},{\\"role\\":\\"effect\\",\\"path\\":\\"public/save.php\\",\\"location\\":\\"save_value:44\\",\\"observation\\":\\"The stored value reaches administrator output.\\"}],\\"controlAssessments\\":[{\\"control\\":\\"Output escaping\\",\\"evidence\\":[{\\"path\\":\\"public/save.php\\",\\"location\\":\\"save_value:44\\",\\"observation\\":\\"No escaping is applied at the output boundary.\\"}],\\"conclusion\\":\\"No source-visible control prevents the stored output effect.\\"}],\\"unresolvedFacts\\":[]}],\\"decision\\":{\\"kind\\":\\"continue\\",\\"reason\\":\\"A separate source-bound frontier remains.\\",\\"nextActions\\":[{\\"question\\":\\"Does the adjacent handler cross another trust boundary?\\",\\"sourcePointers\\":[\\"public/next.php\\"]}]}}","stopReason":"end_turn","sessionId":"%s","requestId":"request-1","usage":{"input_tokens":7000,"cache_read_input_tokens":1000,"cache_creation_input_tokens":500,"output_tokens":1250,"reasoning_tokens":400,"total_tokens":9750},"num_turns":7,"total_cost_usd":0.5,"modelUsage":{"grok-4.6-build":{"inputTokens":7000,"outputTokens":1250,"cacheReadInputTokens":1000,"cacheCreationInputTokens":500,"modelCalls":7,"costUSD":0.5}},"structuredOutput":{"schemaVersion":2}}' "$active_session"
  exit 0
fi
if [ "$invocation" -eq 2 ]; then
  [ -n "$resume_session" ] || exit 108
  printf '{"text":"{\\"schemaVersion\\":2,\\"assessments\\":[],\\"evidenceSummary\\":${escapedEvidenceSummaryJson},\\"candidates\\":[],\\"decision\\":{\\"kind\\":\\"stop\\",\\"basis\\":\\"The remaining frontier was resolved.\\"}}","stopReason":"end_turn","sessionId":"%s","requestId":"request-3","usage":{"input_tokens":3000,"cache_read_input_tokens":500,"cache_creation_input_tokens":250,"output_tokens":500,"reasoning_tokens":200,"total_tokens":4250},"num_turns":3,"total_cost_usd":0.3,"modelUsage":{"grok-4.6-build":{"inputTokens":3000,"outputTokens":500,"cacheReadInputTokens":500,"cacheCreationInputTokens":250,"modelCalls":3,"costUSD":0.3}}}' "$active_session"
  exit 0
fi
exit 75
`,
      { encoding: "utf8", mode: 0o700 },
    );
    await chmod(dockerExecutablePath, 0o700);

    const researchPrompt = await readFile(
      join(process.cwd(), "prompts", "wordpress-plugin-research-v7.md"),
      "utf8",
    );
    const wordpressDependency = {
      id: "wordpress-core-7.1",
      mountName: "wordpress",
      version: "7.1",
      digest:
        "sha256:abababababababababababababababababababababababababababababababab",
      sourceTree: {
        digest: dependencyTreeDigest,
        entries: 1,
        bytes: 14,
      },
    } as const;
    const input: CampaignInput = {
      kind: "agent-led-campaign",
      schemaVersion: 2,
      campaignId: "campaign-grok-native-1",
      targetSnapshot: {
        id: "target-plugin-1.0.0",
        pluginSlug: "target-plugin",
        version: "1.0.0",
        digest:
          "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        sourceTree: { digest: sourceTreeDigest, entries: 1, bytes: 6 },
      },
      dependencySnapshots: [wordpressDependency],
      promptSet: canonicalResearchPromptSet,
      agentRuntimeProfile: grokProfile(),
      permissionProfile: {
        id: "gvisor-source-research-v1",
        digest:
          "sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
      },
      budgetEnvelope: {
        id: "agent-led-budget-v1",
        maxNativeRuns: 3,
        maxWallTimeMs: 600_000,
        digest:
          "sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
      },
    };
    const runtimeOptions = {
      dockerExecutablePath,
      sourceDirectory,
      targetSnapshotDigest: input.targetSnapshot.digest,
      sourceTree: input.targetSnapshot.sourceTree,
      dependencySources: [
        {
          snapshot: wordpressDependency,
          sourceDirectory: dependencyDirectory,
        },
      ],
      providerConfigDirectory,
      scratchRootDirectory,
      promptSet: {
        digest: input.promptSet.digest,
        text: researchPrompt,
      },
      permissionProfileDigest: input.permissionProfile.digest,
      maxOutputBytes: 1_000_000,
    };
    const unadmittedCampaigns = openResearchCampaigns({
      databasePath: join(directory, "unadmitted.sqlite"),
      runtime: openGrokNativeAgentRuntime({
        ...runtimeOptions,
        image:
          "sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
      }),
    });
    await expect(
      unadmittedCampaigns.conduct({
        ...input,
        campaignId: "campaign-grok-unadmitted-1",
      }),
    ).resolves.toMatchObject({ status: "incomplete" });
    unadmittedCampaigns.close();
    await Promise.all([
      rm(`${dockerExecutablePath}.count`, { force: true }),
      rm(`${dockerExecutablePath}.scratch`, { force: true }),
    ]);

    const runtime = openGrokNativeAgentRuntime({
      ...runtimeOptions,
      image:
        "sha256:0390e43156357c08aab4ddc3f002ac11763789e90f0fac09f2fa2e73b8105267",
    });
    const campaigns = openResearchCampaigns({
      databasePath: join(directory, "agent-led.sqlite"),
      runtime,
    });

    await expect(
      conductWithHumanAdvance(campaigns, input),
    ).resolves.toMatchObject({
      status: "verification-preparation-needed",
    });
    await expect(
      campaigns.inspect({ campaignId: "campaign-grok-native-1" }),
    ).resolves.toMatchObject({
      nativeRuns: [
        {
          terminal: "completed",
          usage: {
            inputTokens: 8_500,
            outputTokens: 1_250,
            estimatedCostUsd: 0.5,
          },
          activity: { subagents: null, tools: null },
          isolation: {
            backend: "gvisor",
            runtime: "runsc",
            fallbackUsed: false,
          },
          report: {
            decision: {
              kind: "continue",
            },
          },
        },
        {
          terminal: "completed",
          checkpoint: { sessionId: expect.any(String) },
          report: {
            decision: {
              kind: "stop",
              basis: "The remaining frontier was resolved.",
            },
          },
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
    expect(
      await readFile(join(dependencyDirectory, "wp-load.php"), "utf8"),
    ).toBe("<?php // core\n");

    await writeFile(
      join(sourceDirectory, "plugin.php"),
      "<?php // changed\n",
      "utf8",
    );
    const changedInput: CampaignInput = {
      ...input,
      campaignId: "campaign-grok-native-source-mismatch",
    };
    await expect(campaigns.conduct(changedInput)).resolves.toMatchObject({
      status: "incomplete",
    });
    await expect(
      campaigns.inspect({ campaignId: changedInput.campaignId }),
    ).resolves.toMatchObject({
      nativeRuns: [
        {
          terminal: "policy-denied",
          failure: {
            summary:
              "The mounted Target source does not match its sealed source tree.",
          },
        },
      ],
    });
    expect(await readFile(`${dockerExecutablePath}.count`, "utf8")).toBe("2");

    await writeFile(join(sourceDirectory, "plugin.php"), "<?php\n", "utf8");
    await writeFile(
      join(dependencyDirectory, "wp-load.php"),
      "<?php // changed core\n",
      "utf8",
    );
    const changedDependencyInput: CampaignInput = {
      ...input,
      campaignId: "campaign-grok-native-dependency-mismatch",
    };
    await expect(
      campaigns.conduct(changedDependencyInput),
    ).resolves.toMatchObject({ status: "incomplete" });
    await expect(
      campaigns.inspect({ campaignId: changedDependencyInput.campaignId }),
    ).resolves.toMatchObject({
      nativeRuns: [
        {
          terminal: "policy-denied",
          failure: {
            summary:
              "A mounted Dependency source does not match its sealed source tree.",
          },
        },
      ],
    });
    campaigns.close();
  });

  it("records a broken usage binding as an auditable policy denial", async () => {
    const directory = await mkdtemp(join(tmpdir(), "grok-native-denied-"));
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
      writeFile(
        join(providerConfigDirectory, "auth.json"),
        '{"token":"grok-denied-secret"}',
        { encoding: "utf8", mode: 0o600 },
      ),
      writeFile(join(providerConfigDirectory, "agent_id"), "agent-1", {
        encoding: "utf8",
        mode: 0o600,
      }),
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
if [ "\${1:-}" = "image" ]; then exit 0; fi
is_version_probe=0
provider_mount=''
scratch=''
session=''
previous=''
for argument in "$@"; do
  if [ "$previous" = "--session-id" ]; then session="$argument"; fi
  if [ "$previous" = "--resume" ]; then session="$argument"; fi
  [ "$argument" != "--version" ] || is_version_probe=1
  case "$argument" in
    *:/provider:rw) provider_mount="\${argument%:/provider:rw}" ;;
    *:/workspace/research:rw) scratch="\${argument%:/workspace/research:rw}" ;;
  esac
  previous="$argument"
done
if [ "$is_version_probe" -eq 1 ]; then
  printf '%s\n' 'grok 1.0.13 (Grok Build)'
  exit 0
fi
[ -n "$session" ] || exit 100
printf '%s' '{"checkpoint":true}' > "$provider_mount/session-$session.jsonl"
printf '%s' 'durable research notes' > "$scratch/state.md"
printf '{"text":"{\\"schemaVersion\\":2,\\"assessments\\":[],\\"evidenceSummary\\":{\\"examinedAreas\\":[{\\"area\\":\\"Provider usage binding\\",\\"evidence\\":[{\\"path\\":\\"plugin.php\\",\\"location\\":\\"fixture\\",\\"observation\\":\\"The fixture inspected the source path relevant to this Research result.\\"}]}],\\"unexaminedAreas\\":[]},\\"candidates\\":[],\\"decision\\":{\\"kind\\":\\"stop\\",\\"basis\\":\\"No actionable frontier remains.\\"}}","stopReason":"end_turn","sessionId":"%s","requestId":"request-1","usage":{"input_tokens":3000,"cache_read_input_tokens":500,"cache_creation_input_tokens":250,"output_tokens":500,"reasoning_tokens":200,"total_tokens":99},"num_turns":3,"total_cost_usd":0.3,"modelUsage":{"grok-4.6-build":{"inputTokens":3000,"outputTokens":500,"cacheReadInputTokens":500,"cacheCreationInputTokens":250,"modelCalls":3,"costUSD":0.3}}}' "$session"
`,
      { encoding: "utf8", mode: 0o700 },
    );
    await chmod(dockerExecutablePath, 0o700);

    const researchPrompt = await readFile(
      join(process.cwd(), "prompts", "wordpress-plugin-research-v7.md"),
      "utf8",
    );
    const input: CampaignInput = {
      kind: "agent-led-campaign",
      schemaVersion: 2,
      campaignId: "campaign-grok-usage-denied-1",
      targetSnapshot: {
        id: "target-plugin-1.0.0",
        pluginSlug: "target-plugin",
        version: "1.0.0",
        digest:
          "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        sourceTree: { digest: sourceTreeDigest, entries: 1, bytes: 6 },
      },
      promptSet: canonicalResearchPromptSet,
      agentRuntimeProfile: grokProfile(),
      permissionProfile: {
        id: "gvisor-source-research-v1",
        digest:
          "sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
      },
      budgetEnvelope: {
        id: "agent-led-budget-v1",
        maxNativeRuns: 1,
        maxWallTimeMs: 600_000,
        digest:
          "sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
      },
    };
    const campaigns = openResearchCampaigns({
      databasePath: join(directory, "agent-led.sqlite"),
      runtime: openGrokNativeAgentRuntime({
        dockerExecutablePath,
        image:
          "sha256:0390e43156357c08aab4ddc3f002ac11763789e90f0fac09f2fa2e73b8105267",
        sourceDirectory,
        targetSnapshotDigest: input.targetSnapshot.digest,
        sourceTree: input.targetSnapshot.sourceTree,
        providerConfigDirectory,
        scratchRootDirectory,
        promptSet: { digest: input.promptSet.digest, text: researchPrompt },
        permissionProfileDigest: input.permissionProfile.digest,
        maxOutputBytes: 1_000_000,
      }),
    });

    await expect(campaigns.conduct(input)).resolves.toMatchObject({
      status: "incomplete",
    });
    const inspection = await campaigns.inspect({
      campaignId: input.campaignId,
    });
    expect(inspection).toMatchObject({
      nativeRuns: [
        {
          terminal: "policy-denied",
          failure: {
            summary: "Grok Build violated the sealed model or usage binding.",
            stage: "runtime-adapter",
            diagnostic: { kind: "agent-run-diagnostic" },
          },
        },
      ],
    });
    const nativeRun = inspection.nativeRuns[0];
    if (
      nativeRun === undefined ||
      nativeRun.terminal === "completed" ||
      nativeRun.failure.diagnostic === undefined
    ) {
      throw new Error("Expected a policy denial with a private diagnostic");
    }
    const diagnostic = await readFile(
      join(
        scratchRootDirectory,
        "agent-diagnostics",
        nativeRun.failure.diagnostic.diagnosticId,
        "content",
        "diagnostic.json",
      ),
      "utf8",
    );
    expect(diagnostic).not.toContain("grok-denied-secret");
    expect(JSON.parse(diagnostic)).toMatchObject({
      stage: "runtime-adapter",
      error: {
        message: "Grok Build violated the sealed model or usage binding.",
      },
    });
    campaigns.close();
  });
});
