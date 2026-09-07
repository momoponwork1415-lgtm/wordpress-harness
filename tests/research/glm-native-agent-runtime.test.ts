import { createHash } from "node:crypto";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { canonicalDigest } from "../../src/infrastructure/canonical-json.js";
import {
  openGlmNativeAgentRuntime,
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

describe("GLM Native Agent Runtime", () => {
  it("uses GLM through the admitted Claude Code process in runsc", async () => {
    const directory = await mkdtemp(join(tmpdir(), "glm-native-runtime-"));
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
    const missingClosuresResult =
      '{"schemaVersion":1,"candidates":[{"candidateId":"candidate-1","attackerPremise":"anonymous actor","brokenSecurityProperty":"untrusted state reaches another actor","claim":"candidate claim","evidence":[{"path":"plugin.php","location":"1","observation":"source observation"]}],"decision":{"kind":"stop","basis":"No actionable frontier remains.","}';
    const validCandidateResult =
      '{"schemaVersion":1,"candidates":[{"candidateId":"candidate-1","attackerPremise":"anonymous actor","brokenSecurityProperty":"untrusted state reaches another actor","claim":"candidate claim","evidence":[{"path":"plugin.php","location":"1","observation":"source observation"}]}],"decision":{"kind":"stop","basis":"No actionable frontier remains."}}';
    const malformedStop =
      '{"schemaVersion":1,"candidates":[],"decision":{"kind":"stop","basis":"No actionable frontier remains.","nextActions":[]}]}';
    const validStop =
      '{"schemaVersion":1,"candidates":[],"decision":{"kind":"stop","basis":"No actionable frontier remains."}}';
    const ambiguousStop =
      '{"schemaVersion":1,"candidates":[],"decision":{"kind":"stop","basis":"Ambiguous stop.","nextActions":[{"question":"Continue?","sourcePointers":["plugin.php"]}]}}';
    const malformedValidation =
      '{"schemaVersion":1,"candidateId":"candidate-1","disposition":"source-validated","reason":"The source supports the claim.","evidence":[{"path":"plugin.php","location":"1","observation":"source observation"}],"}';
    const validValidation =
      '{"schemaVersion":1,"candidateId":"candidate-1","disposition":"source-validated","reason":"The source supports the claim.","evidence":[{"path":"plugin.php","location":"1","observation":"source observation"}]}';
    const providerResultPath = join(directory, "provider-result.txt");
    const correctedProviderResultPath = join(
      directory,
      "corrected-provider-result.txt",
    );
    const validationResultPath = join(directory, "validation-result.txt");
    const correctedValidationResultPath = join(
      directory,
      "corrected-validation-result.txt",
    );
    await writeFile(providerResultPath, missingClosuresResult, "utf8");
    await writeFile(correctedProviderResultPath, validCandidateResult, "utf8");
    await writeFile(validationResultPath, malformedValidation, "utf8");
    await writeFile(correctedValidationResultPath, validValidation, "utf8");
    const providerSettings = {
      env: {
        ANTHROPIC_AUTH_TOKEN: "test-zai-token",
        ANTHROPIC_BASE_URL: "https://api.z.ai/api/anthropic",
        ANTHROPIC_DEFAULT_OPUS_MODEL: "glm-5.3",
        ANTHROPIC_DEFAULT_SONNET_MODEL: "glm-5.3",
        ANTHROPIC_DEFAULT_HAIKU_MODEL: "glm-4.5-air",
        API_TIMEOUT_MS: "3000000",
        CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
      },
    };
    await Promise.all([
      writeFile(
        join(providerConfigDirectory, "settings.json"),
        JSON.stringify({ ...providerSettings, hooks: {} }),
        { encoding: "utf8", mode: 0o600 },
      ),
      writeFile(join(providerConfigDirectory, ".mcp.json"), "forbidden", {
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
has_runsc=0
has_interactive=0
has_provider_env=0
has_json_schema=0
has_cost_cap=0
has_alias=0
has_effort=0
provider_mount=''
scratch=''
session=''
is_version_probe=0
is_validation=0
previous=''
for argument in "$@"; do
  if [ "$previous" = "--model" ] && [ "$argument" = "opus" ]; then has_alias=1; fi
  if [ "$previous" = "--effort" ] && [ "$argument" = "max" ]; then has_effort=1; fi
  if [ "$previous" = "--session-id" ]; then session="$argument"; fi
  if [ "$previous" = "--resume" ]; then session="$argument"; fi
  [ "$argument" != "--runtime=runsc" ] || has_runsc=1
  [ "$argument" != "--interactive" ] || has_interactive=1
  [ "$argument" != "--env=CLAUDE_CONFIG_DIR=/provider" ] || has_provider_env=1
  [ "$argument" != "--json-schema" ] || has_json_schema=1
  [ "$argument" != "--max-budget-usd" ] || has_cost_cap=1
  [ "$argument" != "--version" ] || is_version_probe=1
  [ "$argument" != "--no-session-persistence" ] || is_validation=1
  case "$argument" in
    *:/provider:rw) provider_mount="\${argument%:/provider:rw}" ;;
    *:/provider:ro) provider_mount="\${argument%:/provider:ro}" ;;
    *:/workspace/research:rw) scratch="\${argument%:/workspace/research:rw}" ;;
  esac
  previous="$argument"
done
[ "$has_runsc" -eq 1 ] || exit 90
[ "$has_interactive" -eq 1 ] || exit 91
if [ "$is_version_probe" -eq 1 ]; then
  printf '%s\n' '2.1.220 (Claude Code)'
  exit 0
fi
[ "$has_provider_env" -eq 1 ] || exit 92
[ "$has_json_schema" -eq 0 ] || exit 93
[ "$has_cost_cap" -eq 0 ] || exit 94
[ "$has_alias" -eq 1 ] || exit 95
[ "$has_effort" -eq 1 ] || exit 96
[ -f "$provider_mount/settings.json" ] || exit 97
[ ! -e "$provider_mount/.mcp.json" ] || exit 98
[ -n "$scratch" ] || exit 99
[ "$is_validation" -eq 0 ] || session='11111111-1111-4111-8111-111111111111'
[ -n "$session" ] || exit 100
prompt=$(cat)
printf '%s' "$prompt" | grep -F 'Return exactly one JSON value matching this schema.' >/dev/null
printf '%s' "$prompt" | grep -F '"schemaVersion"' >/dev/null
printf '%s' '{"checkpoint":true}' > "$provider_mount/session-$session.jsonl"
printf '%s' 'durable GLM research notes' > "$scratch/state.md"
result_path='${providerResultPath}'
subagents=2
if [ "$is_validation" -eq 1 ]; then
  result_path='${validationResultPath}'
  subagents=0
fi
case "$prompt:$is_validation" in
  *'The prior response was invalid'*:0)
    result_path='${correctedProviderResultPath}'
    subagents=0
    ;;
  *'The prior response was invalid'*:1)
    result_path='${correctedValidationResultPath}'
    subagents=0
    ;;
esac
node -e 'const fs=require("node:fs");const result=fs.readFileSync(process.argv[1],"utf8");process.stdout.write(JSON.stringify({type:"result",subtype:"success",is_error:false,terminal_reason:"completed",session_id:process.argv[2],result,duration_ms:30000,num_turns:3,permission_denials:[],usage:{server_tool_use:{web_search_requests:0,web_fetch_requests:0}},subagent_stats:{spawned:Number(process.argv[3])},modelUsage:{"glm-5.3":{canonicalModel:"glm-5.3",inputTokens:3000,outputTokens:500,cacheReadInputTokens:1000,cacheCreationInputTokens:250}}}));' "$result_path" "$session" "$subagents"
`,
      { encoding: "utf8", mode: 0o700 },
    );
    await chmod(dockerExecutablePath, 0o700);

    const researchPrompt = "Audit this immutable plugin from first principles.";
    const validationPrompt = "Independently validate the source claim.";
    const input: CampaignInput = {
      kind: "agent-led-campaign",
      schemaVersion: 1,
      campaignId: "campaign-glm-native-1",
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
        id: "glm-5.3-claude-code-native-v1",
        kind: "glm-claude-code-native/v1",
        executableVersion: "2.1.220",
        model: "glm-5.3",
        effort: "max",
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
      image:
        "sha256:b8bb6b8f8865dbabb70f03bb71639792fe1f5c4301a8cd874d212435e5cda355",
      sourceDirectory,
      targetSnapshotDigest: input.targetSnapshot.digest,
      sourceTree: input.targetSnapshot.sourceTree,
      providerConfigDirectory,
      scratchRootDirectory,
      promptSet: { digest: input.promptSet.digest, text: researchPrompt },
      validationPromptSet: {
        digest: input.validationPromptSet.digest,
        text: validationPrompt,
      },
      permissionProfileDigest: input.permissionProfile.digest,
      maxOutputBytes: 1_000_000,
    };
    const unsafeCampaigns = openResearchCampaigns({
      databasePath: join(directory, "unsafe-settings.sqlite"),
      runtime: openGlmNativeAgentRuntime(runtimeOptions),
    });
    await expect(
      unsafeCampaigns.conduct({
        ...input,
        campaignId: "campaign-glm-unsafe-settings-1",
      }),
    ).resolves.toMatchObject({ status: "incomplete" });
    await expect(
      unsafeCampaigns.inspect({
        campaignId: "campaign-glm-unsafe-settings-1",
      }),
    ).resolves.toMatchObject({
      nativeRuns: [{ terminal: "policy-denied" }],
    });
    unsafeCampaigns.close();
    await writeFile(
      join(providerConfigDirectory, "settings.json"),
      JSON.stringify(providerSettings),
      { encoding: "utf8", mode: 0o600 },
    );

    const runtime = openGlmNativeAgentRuntime(runtimeOptions);
    const campaigns = openResearchCampaigns({
      databasePath: join(directory, "agent-led.sqlite"),
      runtime,
    });

    await expect(campaigns.conduct(input)).resolves.toMatchObject({
      status: "coverage-closed",
    });
    await expect(
      campaigns.inspect({ campaignId: input.campaignId }),
    ).resolves.toMatchObject({
      nativeRuns: [
        {
          terminal: "completed",
          usage: {
            wallTimeMs: 60_000,
            inputTokens: 8_500,
            outputTokens: 1_000,
          },
          activity: { subagents: 2 },
          isolation: {
            backend: "gvisor",
            runtime: "runsc",
            fallbackUsed: false,
          },
          checkpoint: { sessionId: expect.any(String) },
          report: { decision: { kind: "stop" } },
        },
      ],
      validationRuns: [
        {
          receipt: {
            terminal: "completed",
            usage: {
              wallTimeMs: 60_000,
              inputTokens: 8_500,
              outputTokens: 1_000,
            },
            report: { disposition: "source-validated" },
          },
        },
      ],
      findings: [{ candidateId: "candidate-1" }],
    });
    const checkpointEntries = await readdir(
      join(scratchRootDirectory, "agent-checkpoints"),
      { recursive: true },
    );
    expect(
      checkpointEntries.some((path) => path.endsWith("settings.json")),
    ).toBe(false);
    expect(await readFile(join(sourceDirectory, "plugin.php"), "utf8")).toBe(
      "<?php\n",
    );
    await writeFile(providerResultPath, malformedStop, "utf8");
    await writeFile(correctedProviderResultPath, validStop, "utf8");
    await expect(
      campaigns.conduct({
        ...input,
        campaignId: "campaign-glm-format-correction-stop-1",
      }),
    ).resolves.toMatchObject({ status: "coverage-closed" });
    await expect(
      campaigns.inspect({
        campaignId: "campaign-glm-format-correction-stop-1",
      }),
    ).resolves.toMatchObject({
      nativeRuns: [{ terminal: "completed" }],
    });
    await writeFile(providerResultPath, missingClosuresResult, "utf8");
    await writeFile(correctedProviderResultPath, missingClosuresResult, "utf8");
    await expect(
      campaigns.conduct({
        ...input,
        campaignId: "campaign-glm-bounded-correction-1",
      }),
    ).resolves.toMatchObject({ status: "incomplete" });
    await expect(
      campaigns.inspect({ campaignId: "campaign-glm-bounded-correction-1" }),
    ).resolves.toMatchObject({
      nativeRuns: [{ terminal: "invalid-output" }],
    });
    await writeFile(providerResultPath, ambiguousStop, "utf8");
    await writeFile(correctedProviderResultPath, validStop, "utf8");
    await expect(
      campaigns.conduct({
        ...input,
        campaignId: "campaign-glm-ambiguous-stop-1",
      }),
    ).resolves.toMatchObject({ status: "coverage-closed" });
    await expect(
      campaigns.inspect({ campaignId: "campaign-glm-ambiguous-stop-1" }),
    ).resolves.toMatchObject({
      nativeRuns: [{ terminal: "completed" }],
    });
    campaigns.close();
  });
});
