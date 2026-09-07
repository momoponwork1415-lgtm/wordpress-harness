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
  openGrokNativeAgentRuntime,
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
        validationPromptSet: {
          digest: promptTextDigest("validation"),
          text: "validation",
        },
        permissionProfileDigest: `sha256:${"d".repeat(64)}`,
        maxOutputBytes: 1_000_000,
      }),
    ).toThrow("Research prompt text does not match its sealed digest");
  });

  it("returns an agent-led report from Grok Build in a pinned runsc sandbox", async () => {
    const directory = await mkdtemp(join(tmpdir(), "grok-native-runtime-"));
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
has_read_only_tools=0
denies_provider_read=0
denies_provider_grep=0
volume_count=0
is_version_probe=0
scratch=''
provider_mount=''
for argument in "$@"; do
  [ "$argument" != "--runtime=runsc" ] || has_runsc=1
  [ "$argument" != "--user=$(id -u):$(id -g)" ] || has_host_user=1
  [ "$argument" != "off" ] || has_outer_owned_sandbox=1
  [ "$argument" != "--no-memory" ] || has_memory_disabled=1
  [ "$argument" != "--env=GROK_HOME=/provider" ] || has_ephemeral_provider_home=1
  [ "$argument" != "read_file,grep,list_dir,task" ] || has_read_only_tools=1
  [ "$argument" != "Read(/provider/**)" ] || denies_provider_read=1
  [ "$argument" != "Grep(/provider/**)" ] || denies_provider_grep=1
  [ "$argument" != "--volume" ] || volume_count=$((volume_count + 1))
  case "$argument" in
    *:/provider:rw) provider_mount="\${argument%:/provider:rw}" ;;
  esac
  [ "$argument" != "--version" ] || is_version_probe=1
  [ "$argument" != "--no-subagents" ] || exit 91
  case "$argument" in
    *:/workspace/research:rw) scratch="\${argument%:/workspace/research:rw}" ;;
  esac
done
[ "$has_runsc" -eq 1 ] || exit 90
[ "$has_host_user" -eq 1 ] || exit 94
[ "$volume_count" -eq 3 ] || exit 100
if [ "$is_version_probe" -eq 1 ]; then
  printf '%s\n' 'grok 1.0.13 (Grok Build)'
  exit 0
fi
[ "$has_outer_owned_sandbox" -eq 1 ] || exit 95
[ "$has_memory_disabled" -eq 1 ] || exit 96
[ "$has_ephemeral_provider_home" -eq 1 ] || exit 97
[ "$has_read_only_tools" -eq 1 ] || exit 101
[ "$denies_provider_read" -eq 1 ] || exit 102
[ "$denies_provider_grep" -eq 1 ] || exit 103
[ -n "$scratch" ] || exit 92
[ -n "$provider_mount" ] || exit 104
case "$provider_mount" in
  "$scratch"/*) exit 105 ;;
esac
[ -f "$provider_mount/auth.json" ] || exit 98
[ -f "$provider_mount/agent_id" ] || exit 99
printf '%s\n' "$scratch" >> "$0.scratch"
invocation=1
if [ -f "$0.count" ]; then
  invocation=$(( $(cat "$0.count") + 1 ))
fi
printf '%s' "$invocation" > "$0.count"
if [ "$invocation" -eq 1 ]; then
  printf '%s' '{"text":"","stopReason":"end_turn","sessionId":"session-1","requestId":"request-1","usage":{"input_tokens":7000,"cache_read_input_tokens":1000,"cache_creation_input_tokens":500,"output_tokens":1250,"reasoning_tokens":400,"total_tokens":9750},"num_turns":7,"total_cost_usd":0.5,"modelUsage":{"grok-4.6-build":{"inputTokens":7000,"outputTokens":1250,"cacheReadInputTokens":1000,"cacheCreationInputTokens":500,"modelCalls":7,"costUSD":0.5}},"structuredOutput":{"schemaVersion":1,"candidates":[{"candidateId":"candidate-grok-stored-xss-1","attackerPremise":"An unauthenticated visitor can submit the public form.","brokenSecurityProperty":"Persisted attacker input must be inert in privileged output.","claim":"A public form value is stored and rendered to an administrator without escaping.","evidence":[{"path":"public/save.php","location":"save_value:44","observation":"Persists the public value."}]}],"decision":{"kind":"stop","basis":"No separate actionable source-bound frontier remains."}}}'
  exit 0
fi
grep -F 'This is one fresh Independent Validation.' "$scratch/prompt.txt" >/dev/null
grep -F 'Candidate:' "$scratch/prompt.txt" >/dev/null
if grep -F 'Prior source-bound reports:' "$scratch/prompt.txt" >/dev/null; then
  exit 93
fi
printf '%s' '{"text":"","stopReason":"end_turn","sessionId":"session-2","requestId":"request-2","usage":{"input_tokens":6000,"cache_read_input_tokens":500,"cache_creation_input_tokens":250,"output_tokens":900,"reasoning_tokens":300,"total_tokens":7650},"num_turns":5,"total_cost_usd":0.4,"modelUsage":{"grok-4.6-build":{"inputTokens":6000,"outputTokens":900,"cacheReadInputTokens":500,"cacheCreationInputTokens":250,"modelCalls":5,"costUSD":0.4}},"structuredOutput":{"schemaVersion":1,"candidateId":"candidate-grok-stored-xss-1","disposition":"source-validated","reason":"The public write and privileged unescaped output are independently supported.","evidence":[{"path":"admin/view.php","location":"render_value:88","observation":"Emits the persisted value without escaping."}]}}'
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
      campaignId: "campaign-grok-native-1",
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
        id: "grok-build-native-v1",
        kind: "grok-build-native/v1",
        executableVersion: "1.0.13",
        model: "grok-4.6",
        effort: "xhigh",
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
    const runtime = openGrokNativeAgentRuntime({
      dockerExecutablePath,
      image:
        "sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
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
    });
    const campaigns = openResearchCampaigns({
      databasePath: join(directory, "agent-led.sqlite"),
      runtime,
    });

    await expect(campaigns.conduct(input)).resolves.toMatchObject({
      status: "coverage-closed",
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
              kind: "stop",
              basis: "No separate actionable source-bound frontier remains.",
            },
          },
        },
      ],
      validationRuns: [
        {
          candidateId: "candidate-grok-stored-xss-1",
          receipt: {
            terminal: "completed",
            usage: {
              inputTokens: 6_750,
              outputTokens: 900,
              estimatedCostUsd: 0.4,
            },
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
          candidateId: "candidate-grok-stored-xss-1",
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
    campaigns.close();
  });
});
