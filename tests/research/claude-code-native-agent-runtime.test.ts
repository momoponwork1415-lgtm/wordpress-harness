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

import {
  claudeCodeNativeTransport,
  defineAgentRuntimeProfile,
} from "../../src/infrastructure/agent-runtime-profile.js";
import { canonicalDigest } from "../../src/infrastructure/canonical-json.js";
import { openClaudeCodeNativeAgentRuntime } from "../../src/research/agent-led/claude-code-native-agent-runtime.js";
import { openResearchCampaigns } from "../../src/research/agent-led/research-campaigns.js";
import {
  canonicalResearchPromptSet,
  type CampaignInput,
} from "../../src/research/index.js";
import { conductWithHumanAdvance } from "./support/candidate-review.js";
import { researchEvidenceSummaryFixture } from "./support/research-evidence-summary.js";

const temporaryDirectories: string[] = [];
const syntheticClaudeOauthToken = "synthetic-claude-oauth-token";

function claudeProfile() {
  return defineAgentRuntimeProfile({
    id: "claude-code-opus-native-v1",
    ...claudeCodeNativeTransport,
    model: "claude-opus-5",
    effort: "high",
  });
}

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
    const oauthTokenPath = join(providerConfigDirectory, "claude-oauth-token");
    const scratchRootDirectory = join(directory, "scratch");
    const evidenceSummaryJson = JSON.stringify(
      researchEvidenceSummaryFixture("public/save.php"),
    );
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
      writeFile(oauthTokenPath, `${syntheticClaudeOauthToken}\n`, {
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
has_subagent_concurrency_limit=0
has_subagent_depth_limit=0
denies_provider_read=0
denies_provider_glob=0
denies_provider_grep=0
has_unsupported_option=0
volume_count=0
provider_mount=''
provider_mount_mode=''
new_session=''
resume_session=''
has_no_session_persistence=0
selected_model=''
is_version_probe=0
scratch=''
previous=''
for argument in "$@"; do
  case "$argument" in
    *'${syntheticClaudeOauthToken}'*) exit 68 ;;
  esac
  if [ "$previous" = "--json-schema" ]; then
    case "$argument" in
      *'"$schema"'*) exit 84 ;;
    esac
    case "$argument" in
      *'"type":"object"'*) ;;
      *) exit 75 ;;
    esac
    case "$argument" in
      '{"oneOf":'*) exit 74 ;;
    esac
  fi
  if [ "$previous" = "--session-id" ]; then new_session="$argument"; fi
  if [ "$previous" = "--resume" ]; then resume_session="$argument"; fi
  if [ "$previous" = "--model" ]; then selected_model="$argument"; fi
  [ "$argument" != "--runtime=runsc" ] || has_runsc=1
  [ "$argument" != "--interactive" ] || has_interactive=1
  [ "$argument" != "--env=CLAUDE_CONFIG_DIR=/provider" ] || has_ephemeral_provider_home=1
  [ "$argument" != "--env=CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS=3" ] || has_subagent_concurrency_limit=1
  [ "$argument" != "--env=CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH=1" ] || has_subagent_depth_limit=1
  [ "$argument" != 'Read(//provider/**)' ] || denies_provider_read=1
  [ "$argument" != 'Glob(//provider/**)' ] || denies_provider_glob=1
  [ "$argument" != 'Grep(//provider/**)' ] || denies_provider_grep=1
  case "$argument" in
    --restricted|--permission-prompts) has_unsupported_option=1 ;;
  esac
  [ "$argument" != "--volume" ] || volume_count=$((volume_count + 1))
  case "$argument" in
    *:/provider:ro) provider_mount="\${argument%:/provider:ro}"; provider_mount_mode='ro' ;;
    *:/provider:rw) provider_mount="\${argument%:/provider:rw}"; provider_mount_mode='rw' ;;
  esac
  [ "$argument" != "--version" ] || is_version_probe=1
  [ "$argument" != "--no-session-persistence" ] || has_no_session_persistence=1
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
[ "$selected_model" = "claude-opus-5" ] || exit 69
[ "$has_unsupported_option" -eq 0 ] || exit 88
[ "$denies_provider_read" -eq 1 ] || exit 87
[ "$denies_provider_glob" -eq 1 ] || exit 86
[ "$denies_provider_grep" -eq 1 ] || exit 85
[ "$has_ephemeral_provider_home" -eq 1 ] || exit 96
[ "$has_subagent_concurrency_limit" -eq 1 ] || exit 72
[ "$has_subagent_depth_limit" -eq 1 ] || exit 71
case "$provider_mount" in
  "$scratch"/*) exit 94 ;;
esac
[ ! -e "$provider_mount/.credentials.json" ] || exit 97
[ -f "$provider_mount/settings.json" ] || exit 70
node -e 'const fs=require("node:fs");const value=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));if(value.env.CLAUDE_CODE_OAUTH_TOKEN!==process.argv[2]||value.env.CLAUDE_CODE_SUBPROCESS_ENV_SCRUB!=="1")process.exit(1)' "$provider_mount/settings.json" '${syntheticClaudeOauthToken}'
[ ! -e "$provider_mount/.mcp.json" ] || exit 98
if [ -n "$new_session" ] || [ -n "$resume_session" ]; then
  [ "$provider_mount_mode" = 'rw' ] || exit 83
  [ "$has_no_session_persistence" -eq 0 ] || exit 82
  active_session="$new_session$resume_session"
  if [ -n "$resume_session" ]; then
    [ -f "$provider_mount/session-$resume_session.jsonl" ] || exit 81
    [ -f "$scratch/state.md" ] || exit 80
  fi
  printf '%s' '{"checkpoint":true}' > "$provider_mount/session-$active_session.jsonl"
  printf '%s' 'durable research notes' > "$scratch/state.md"
else
  [ "$provider_mount_mode" = 'ro' ] || exit 79
  [ "$has_no_session_persistence" -eq 1 ] || exit 78
  active_session='11111111-1111-4111-8111-111111111111'
fi
printf '%s\n' "$scratch" >> "$0.scratch"
prompt=$(cat)
invocation=1
if [ -f "$0.count" ]; then
  invocation=$(( $(cat "$0.count") + 1 ))
fi
printf '%s' "$invocation" > "$0.count"
if [ "$invocation" -eq 1 ]; then
  printf '{"type":"result","subtype":"success","is_error":false,"terminal_reason":"completed","session_id":"%s","structured_output":{"schemaVersion":2,"assessments":[],"evidenceSummary":${evidenceSummaryJson},"candidates":[{"candidateId":"candidate-claude-stored-xss-1","attackerPremise":"An unauthenticated visitor can submit the public form.","brokenSecurityProperty":"Persisted attacker input must be inert in privileged output.","claim":"A public form value is stored and rendered to an administrator without escaping.","evidence":[{"path":"public/save.php","location":"save_value:44","observation":"Persists the public value."}],"sourceTrace":[{"role":"entrypoint","path":"public/save.php","location":"save_value:44","observation":"The public form accepts attacker input."},{"role":"effect","path":"public/save.php","location":"save_value:44","observation":"The stored value reaches administrator output."}],"controlAssessments":[{"control":"Output escaping","evidence":[{"path":"public/save.php","location":"save_value:44","observation":"No escaping is applied at the output boundary."}],"conclusion":"No source-visible control prevents the stored output effect."}],"unresolvedFacts":[]}],"decision":{"kind":"continue","reason":"A separate source-bound frontier remains.","nextActions":[{"question":"Does the adjacent public handler cross another trust boundary?","sourcePointers":["public/next.php"]}]}},"total_cost_usd":0.75,"duration_ms":90000,"num_turns":8,"permission_denials":[],"usage":{"server_tool_use":{"web_search_requests":0,"web_fetch_requests":0}},"modelUsage":{"claude-opus-5":{"canonicalModel":"claude-opus-5","inputTokens":8000,"outputTokens":1500,"cacheReadInputTokens":2000,"cacheCreationInputTokens":500}}}' "$active_session"
  exit 0
fi
if [ "$invocation" -eq 2 ]; then
  [ -n "$resume_session" ] || exit 77
  printf '{"type":"result","subtype":"success","is_error":false,"terminal_reason":"completed","session_id":"%s","structured_output":{"schemaVersion":2,"assessments":[],"evidenceSummary":${evidenceSummaryJson},"candidates":[],"decision":{"kind":"stop","basis":"The remaining frontier was resolved."}},"total_cost_usd":0.3,"duration_ms":45000,"num_turns":3,"permission_denials":[],"usage":{"server_tool_use":{"web_search_requests":0,"web_fetch_requests":0}},"modelUsage":{"claude-opus-5":{"canonicalModel":"claude-opus-5","inputTokens":3000,"outputTokens":500,"cacheReadInputTokens":1000,"cacheCreationInputTokens":250}}}' "$active_session"
  exit 0
fi
if [ "$invocation" -eq 3 ]; then
  printf '{"is_error":true,"duration_api_ms":754,"num_turns":1,"stop_reason":null,"session_id":"%s","total_cost_usd":0.25,"usage":{"input_tokens":0,"cache_creation_input_tokens":0,"cache_read_input_tokens":0,"output_tokens":0,"server_tool_use":{"web_search_requests":0,"web_fetch_requests":0}},"modelUsage":{"claude-haiku-4-5":{"inputTokens":532,"outputTokens":13,"cacheReadInputTokens":0,"cacheCreationInputTokens":0,"canonicalModel":"claude-haiku-4-5"}},"permission_denials":[],"terminal_reason":"budget_exhausted","subtype":"error_max_budget_usd","errors":["Reached maximum budget"],"type":"result","duration_ms":1}' "$active_session"
  exit 1
fi
if [ "$invocation" -eq 4 ]; then
  [ -n "$resume_session" ] || exit 76
  printf '{"type":"result","subtype":"success","is_error":false,"terminal_reason":"completed","session_id":"%s","structured_output":{"schemaVersion":2,"assessments":[],"evidenceSummary":${evidenceSummaryJson},"candidates":[],"decision":{"kind":"stop","basis":"The explicitly resumed frontier was resolved."}},"total_cost_usd":0.2,"duration_ms":30000,"num_turns":2,"permission_denials":[],"usage":{"server_tool_use":{"web_search_requests":0,"web_fetch_requests":0}},"modelUsage":{"claude-opus-5":{"canonicalModel":"claude-opus-5","inputTokens":2000,"outputTokens":300,"cacheReadInputTokens":500,"cacheCreationInputTokens":100}}}' "$active_session"
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
    const input: CampaignInput = {
      kind: "agent-led-campaign",
      schemaVersion: 2,
      campaignId: "campaign-claude-native-1",
      targetSnapshot: {
        id: "target-plugin-1.0.0",
        pluginSlug: "target-plugin",
        version: "1.0.0",
        digest:
          "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        sourceTree: { digest: sourceTreeDigest, entries: 1, bytes: 6 },
      },
      promptSet: canonicalResearchPromptSet,
      agentRuntimeProfile: claudeProfile(),
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
    let clockTick = 0;
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
      permissionProfileDigest: input.permissionProfile.digest,
      maxOutputBytes: 1_000_000,
      clock: () => new Date(clockTick++ * 10_000),
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

    await chmod(oauthTokenPath, 0o644);
    const unsafeCredentialCampaigns = openResearchCampaigns({
      databasePath: join(directory, "unsafe-credential.sqlite"),
      runtime: openClaudeCodeNativeAgentRuntime({
        ...runtimeOptions,
        image:
          "sha256:b8bb6b8f8865dbabb70f03bb71639792fe1f5c4301a8cd874d212435e5cda355",
      }),
    });
    const unsafeCredentialInput = {
      ...input,
      campaignId: "campaign-claude-unsafe-credential-1",
    };
    await expect(
      unsafeCredentialCampaigns.conduct(unsafeCredentialInput),
    ).resolves.toMatchObject({ status: "incomplete" });
    await expect(
      unsafeCredentialCampaigns.inspect({
        campaignId: unsafeCredentialInput.campaignId,
      }),
    ).resolves.toMatchObject({
      nativeRuns: [
        {
          terminal: "policy-denied",
          failure: {
            summary:
              "The operator-owned Claude OAuth token is unavailable or unsafe.",
          },
        },
      ],
    });
    unsafeCredentialCampaigns.close();
    await chmod(oauthTokenPath, 0o600);

    const runtime = openClaudeCodeNativeAgentRuntime({
      ...runtimeOptions,
      image:
        "sha256:b8bb6b8f8865dbabb70f03bb71639792fe1f5c4301a8cd874d212435e5cda355",
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
      campaigns.inspect({ campaignId: "campaign-claude-native-1" }),
    ).resolves.toMatchObject({
      nativeRuns: [
        {
          terminal: "completed",
          providerAuthentication: {
            kind: "provider-authentication",
            schemaVersion: 1,
            provider: "anthropic",
            method: "operator-oauth-token",
            setup: "staged",
            cleanup: "removed",
            digest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/u),
          },
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
              kind: "continue",
            },
          },
        },
        {
          terminal: "completed",
          providerAuthentication: {
            method: "operator-oauth-token",
            cleanup: "removed",
          },
          usage: {
            wallTimeMs: 45_000,
            inputTokens: 4_250,
            outputTokens: 500,
            estimatedCostUsd: 0.3,
          },
          checkpoint: {
            sessionId: expect.any(String),
          },
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
    const checkpointEntries = await readdir(
      join(scratchRootDirectory, "agent-checkpoints"),
      { recursive: true },
    );
    expect(
      checkpointEntries.some((path) => path.endsWith(".credentials.json")),
    ).toBe(false);
    expect(
      checkpointEntries.some((path) => path.endsWith("settings.json")),
    ).toBe(false);
    expect(
      JSON.stringify(await campaigns.inspect({ campaignId: input.campaignId })),
    ).not.toContain(syntheticClaudeOauthToken);
    expect(await readFile(join(sourceDirectory, "plugin.php"), "utf8")).toBe(
      "<?php\n",
    );
    const budgetInput: CampaignInput = {
      ...input,
      campaignId: "campaign-claude-provider-budget-1",
      budgetEnvelope: {
        ...input.budgetEnvelope,
        digest:
          "sha256:abababababababababababababababababababababababababababababababab",
      },
    };
    await expect(campaigns.conduct(budgetInput)).resolves.toMatchObject({
      status: "incomplete",
    });
    const budgetView = await campaigns.inspect({
      campaignId: budgetInput.campaignId,
    });
    expect(budgetView).toMatchObject({
      nativeRuns: [
        {
          terminal: "budget-exhausted",
          checkpoint: {
            stateEntries: 2,
            sessionId: expect.any(String),
          },
          usage: {
            wallTimeMs: 10_000,
            inputTokens: 532,
            outputTokens: 13,
            estimatedCostUsd: 0.25,
          },
        },
      ],
    });
    const interruptedCheckpoint = budgetView.nativeRuns[0]?.checkpoint;
    if (interruptedCheckpoint === undefined) {
      throw new Error("Budget interruption did not preserve a checkpoint");
    }
    const resumedInput: CampaignInput = {
      ...input,
      campaignId: "campaign-claude-explicit-resume-1",
      resumeFrom: interruptedCheckpoint,
      budgetEnvelope: {
        ...input.budgetEnvelope,
        digest:
          "sha256:bcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbc",
      },
    };
    await expect(campaigns.conduct(resumedInput)).resolves.toMatchObject({
      status: "coverage-closed",
    });
    await expect(
      campaigns.inspect({ campaignId: resumedInput.campaignId }),
    ).resolves.toMatchObject({
      nativeRuns: [
        {
          terminal: "completed",
          checkpoint: { sessionId: interruptedCheckpoint.sessionId },
          report: {
            decision: {
              kind: "stop",
              basis: "The explicitly resumed frontier was resolved.",
            },
          },
        },
      ],
    });
    await writeFile(
      join(
        scratchRootDirectory,
        "agent-checkpoints",
        interruptedCheckpoint.checkpointId,
        "content",
        "scratch",
        "state.md",
      ),
      "tampered",
      "utf8",
    );
    const tamperedResumeInput: CampaignInput = {
      ...resumedInput,
      campaignId: "campaign-claude-tampered-resume-1",
    };
    await expect(campaigns.conduct(tamperedResumeInput)).resolves.toMatchObject(
      { status: "incomplete" },
    );
    await expect(
      campaigns.inspect({ campaignId: tamperedResumeInput.campaignId }),
    ).resolves.toMatchObject({
      nativeRuns: [
        {
          terminal: "policy-denied",
          failure: {
            summary: "The bound Agent Checkpoint is unavailable or invalid.",
          },
        },
      ],
    });
    campaigns.close();
  });

  it("separates provider account failures from provider defects and preserves refused output", async () => {
    const directory = await mkdtemp(join(tmpdir(), "claude-account-failure-"));
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
    await writeFile(join(providerConfigDirectory, ".credentials.json"), "{}", {
      encoding: "utf8",
      mode: 0o600,
    });
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
    const providerResultPath = join(directory, "provider-result.json");
    const providerExitPath = join(directory, "provider-exit.txt");
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
provider_mount=''
scratch=''
session=''
is_version_probe=0
previous=''
for argument in "$@"; do
  if [ "$previous" = "--session-id" ]; then session="$argument"; fi
  if [ "$previous" = "--resume" ]; then session="$argument"; fi
  [ "$argument" != "--version" ] || is_version_probe=1
  case "$argument" in
    *:/provider:rw) provider_mount="\${argument%:/provider:rw}" ;;
    *:/provider:ro) provider_mount="\${argument%:/provider:ro}" ;;
    *:/workspace/research:rw) scratch="\${argument%:/workspace/research:rw}" ;;
  esac
  previous="$argument"
done
if [ "$is_version_probe" -eq 1 ]; then
  printf '%s\\n' '2.1.220 (Claude Code)'
  exit 0
fi
[ -n "$session" ] || exit 100
[ -n "$scratch" ] || exit 99
printf '%s' '{"checkpoint":true}' > "$provider_mount/session-$session.jsonl"
printf '%s' 'durable research notes' > "$scratch/state.md"
cat > /dev/null
node -e 'const fs=require("node:fs");const body=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));body.session_id=process.argv[2];fs.writeSync(1,JSON.stringify(body));' '${providerResultPath}' "$session"
exit "$(cat '${providerExitPath}')"
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
      campaignId: "campaign-claude-quota-1",
      targetSnapshot: {
        id: "target-plugin-1.0.0",
        pluginSlug: "target-plugin",
        version: "1.0.0",
        digest:
          "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        sourceTree: { digest: sourceTreeDigest, entries: 1, bytes: 6 },
      },
      promptSet: canonicalResearchPromptSet,
      agentRuntimeProfile: claudeProfile(),
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
    let clockTick = 0;
    const campaigns = openResearchCampaigns({
      databasePath: join(directory, "agent-led.sqlite"),
      runtime: openClaudeCodeNativeAgentRuntime({
        dockerExecutablePath,
        sourceDirectory,
        targetSnapshotDigest: input.targetSnapshot.digest,
        sourceTree: input.targetSnapshot.sourceTree,
        providerConfigDirectory,
        scratchRootDirectory,
        promptSet: { digest: input.promptSet.digest, text: researchPrompt },
        permissionProfileDigest: input.permissionProfile.digest,
        maxOutputBytes: 1_000_000,
        clock: () => new Date(clockTick++ * 10_000),
        image:
          "sha256:b8bb6b8f8865dbabb70f03bb71639792fe1f5c4301a8cd874d212435e5cda355",
      }),
    });

    const errorEnvelope = {
      type: "result",
      subtype: "success",
      is_error: true,
      terminal_reason: "api_error",
      session_id: "11111111-1111-4111-8111-111111111111",
      duration_ms: 120_000,
      num_turns: 16,
      permission_denials: [],
      usage: {
        server_tool_use: { web_search_requests: 0, web_fetch_requests: 0 },
      },
      modelUsage: {},
    };
    await writeFile(providerExitPath, "1", "utf8");
    await writeFile(
      providerResultPath,
      JSON.stringify({
        ...errorEnvelope,
        api_error_status: 429,
        total_cost_usd: 6.5,
        result:
          "API Error: Request rejected (429) · Usage limit reached for 5 hour.",
        modelUsage: {
          "claude-opus-5": {
            canonicalModel: "claude-opus-5",
            inputTokens: 4_000,
            outputTokens: 700,
            cacheReadInputTokens: 1_000,
            cacheCreationInputTokens: 0,
          },
        },
      }),
      "utf8",
    );
    await expect(campaigns.conduct(input)).resolves.toMatchObject({
      status: "incomplete",
    });
    await expect(
      campaigns.inspect({ campaignId: input.campaignId }),
    ).resolves.toMatchObject({
      nativeRuns: [
        {
          terminal: "provider-quota-exhausted",
          usage: { estimatedCostUsd: 6.5 },
          checkpoint: { sessionId: expect.any(String) },
          failure: {
            summary: "Claude Code reached the provider usage limit.",
            stage: "provider-execution",
            diagnostic: { kind: "agent-run-diagnostic" },
          },
        },
      ],
    });
    const quotaRun = (await campaigns.inspect({ campaignId: input.campaignId }))
      .nativeRuns[0];
    expect(
      quotaRun?.terminal === "completed"
        ? undefined
        : quotaRun?.failure.retryable,
    ).toBeUndefined();

    const rateLimitedInput: CampaignInput = {
      ...input,
      campaignId: "campaign-claude-rate-limited-1",
    };
    await writeFile(
      providerResultPath,
      JSON.stringify({
        ...errorEnvelope,
        api_error_status: 429,
        result: "API Error: Too many requests. Retry after 30 seconds.",
      }),
      "utf8",
    );
    await expect(campaigns.conduct(rateLimitedInput)).resolves.toMatchObject({
      status: "incomplete",
    });
    await expect(
      campaigns.inspect({ campaignId: rateLimitedInput.campaignId }),
    ).resolves.toMatchObject({
      nativeRuns: [
        {
          terminal: "provider-failed",
          failure: {
            summary: "Claude Code exited without a completed result.",
          },
        },
      ],
    });

    const unauthenticatedInput: CampaignInput = {
      ...input,
      campaignId: "campaign-claude-unauthenticated-1",
    };
    await writeFile(
      providerResultPath,
      JSON.stringify({
        ...errorEnvelope,
        api_error_status: null,
        num_turns: 1,
        total_cost_usd: 0,
        result:
          "Failed to authenticate: OAuth session expired and could not be refreshed",
      }),
      "utf8",
    );
    await expect(
      campaigns.conduct(unauthenticatedInput),
    ).resolves.toMatchObject({ status: "incomplete" });
    await expect(
      campaigns.inspect({ campaignId: unauthenticatedInput.campaignId }),
    ).resolves.toMatchObject({
      nativeRuns: [
        {
          terminal: "provider-unauthenticated",
          failure: {
            summary: "Claude Code could not authenticate with the provider.",
            retryable: true,
            diagnostic: { kind: "agent-run-diagnostic" },
          },
        },
      ],
    });

    const deniedInput: CampaignInput = {
      ...input,
      campaignId: "campaign-claude-model-denied-1",
    };
    await writeFile(providerExitPath, "0", "utf8");
    await writeFile(
      providerResultPath,
      JSON.stringify({
        type: "result",
        subtype: "success",
        is_error: false,
        terminal_reason: "completed",
        session_id: "11111111-1111-4111-8111-111111111111",
        structured_output: {
          schemaVersion: 2,
          assessments: [],
          evidenceSummary: researchEvidenceSummaryFixture(),
          candidates: [],
          decision: {
            kind: "stop",
            basis: "No source-bound actionable frontier remains.",
          },
        },
        total_cost_usd: 0.4,
        duration_ms: 30_000,
        num_turns: 3,
        permission_denials: [],
        usage: {
          server_tool_use: { web_search_requests: 0, web_fetch_requests: 0 },
        },
        modelUsage: {
          "claude-haiku-4-5": {
            canonicalModel: "claude-haiku-4-5",
            inputTokens: 900,
            outputTokens: 100,
            cacheReadInputTokens: 0,
            cacheCreationInputTokens: 0,
          },
        },
      }),
      "utf8",
    );
    await expect(campaigns.conduct(deniedInput)).resolves.toMatchObject({
      status: "incomplete",
    });
    const deniedView = await campaigns.inspect({
      campaignId: deniedInput.campaignId,
    });
    expect(deniedView).toMatchObject({
      nativeRuns: [
        {
          terminal: "policy-denied",
          failure: {
            summary: "Claude Code violated the sealed model or tool policy.",
            stage: "runtime-adapter",
            diagnostic: { kind: "agent-run-diagnostic" },
          },
        },
      ],
    });
    const deniedRun = deniedView.nativeRuns[0];
    const deniedDiagnostic =
      deniedRun?.terminal === "completed"
        ? undefined
        : deniedRun?.failure.diagnostic;
    if (deniedDiagnostic === undefined) {
      throw new Error("An adapter policy denial did not preserve a diagnostic");
    }
    const capsule = JSON.parse(
      await readFile(
        join(
          scratchRootDirectory,
          "agent-diagnostics",
          deniedDiagnostic.diagnosticId,
          "content",
          "diagnostic.json",
        ),
        "utf8",
      ),
    ) as {
      stage: string;
      error?: { message?: string };
      process?: { stdout?: string };
    };
    expect(capsule.stage).toBe("runtime-adapter");
    expect(capsule.error?.message).toBe(
      "Claude Code violated the sealed model or tool policy.",
    );
    expect(capsule.process?.stdout).toContain("claude-haiku-4-5");
    campaigns.close();
  });
});
