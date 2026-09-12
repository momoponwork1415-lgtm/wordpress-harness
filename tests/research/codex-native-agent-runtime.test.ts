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
import { promptTextDigest } from "../../src/infrastructure/prompt-text.js";
import { openCodexNativeAgentRuntime } from "../../src/research/agent-led/codex-native-agent-runtime.js";
import { openResearchCampaigns } from "../../src/research/agent-led/research-campaigns.js";
import type { CampaignInput } from "../../src/research/index.js";
import { conductWithHumanAdvance } from "./support/candidate-review.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("Codex Native Agent Runtime", () => {
  it("admits only Daybreak with a managed source-reader in runsc", async () => {
    const directory = await mkdtemp(join(tmpdir(), "codex-native-runtime-"));
    temporaryDirectories.push(directory);
    const sourceDirectory = join(directory, "source");
    const providerConfigDirectory = join(directory, "provider-config");
    const scratchRootDirectory = join(directory, "scratch");
    await Promise.all([
      mkdir(sourceDirectory),
      mkdir(providerConfigDirectory),
      mkdir(scratchRootDirectory),
    ]);
    await Promise.all([
      writeFile(join(sourceDirectory, "plugin.php"), "<?php\n", "utf8"),
      writeFile(join(providerConfigDirectory, "auth.json"), "{}", {
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
is_version=0
has_runsc=0
has_shell_disabled=0
has_schema=0
has_requirements=0
has_multi_agent_enabled=0
has_agent_runtime_enabled=0
has_subagent_concurrency_limit=0
has_xhigh=0
provider=''
scratch=''
previous=''
for argument in "$@"; do
  [ "$argument" != "--runtime=runsc" ] || has_runsc=1
  if [ "$previous" = "--disable" ] && [ "$argument" = "shell_tool" ]; then has_shell_disabled=1; fi
  [ "$argument" != "/workspace/research/report-schema.json" ] || has_schema=1
  [ "$argument" != 'model_reasoning_effort="xhigh"' ] || has_xhigh=1
  [ "$argument" != "features.multi_agent=true" ] || has_multi_agent_enabled=1
  [ "$argument" != "agents.enabled=true" ] || has_agent_runtime_enabled=1
  [ "$argument" != "agents.max_concurrent_threads_per_session=3" ] || has_subagent_concurrency_limit=1
  case "$argument" in
    *:/provider:rw) provider="\${argument%:/provider:rw}" ;;
    *:/workspace/research:rw) scratch="\${argument%:/workspace/research:rw}" ;;
    *:/etc/codex/requirements.toml:ro) has_requirements=1 ;;
  esac
  [ "$argument" != "--version" ] || is_version=1
  previous="$argument"
done
[ "$has_runsc" -eq 1 ] || exit 90
if [ "$is_version" -eq 1 ]; then
  printf '%s\n' 'codex-cli 0.146.0'
  exit 0
fi
[ "$has_shell_disabled" -eq 1 ] || exit 91
[ "$has_schema" -eq 1 ] || exit 92
[ "$has_requirements" -eq 1 ] || exit 93
[ "$has_multi_agent_enabled" -eq 1 ] || exit 86
[ "$has_agent_runtime_enabled" -eq 1 ] || exit 85
[ "$has_subagent_concurrency_limit" -eq 1 ] || exit 84
[ "$has_xhigh" -eq 1 ] || exit 89
[ -f "$scratch/source-reader.js" ] || exit 94
[ -f "$scratch/report-schema.json" ] || exit 95
[ -f "$provider/auth.json" ] || exit 96
grep -Fq 'multi_agent = true' "$scratch/requirements.toml" || exit 83
! grep -q '"oneOf"' "$scratch/report-schema.json" || exit 97
grep -q '"basis"' "$scratch/report-schema.json" || exit 98
grep -Fq '"required":["schemaVersion","candidates","decision","parkedProgrammeLeads"]' "$scratch/report-schema.json" || exit 99
is_resume=0
[ ! -f "$provider/thread.jsonl" ] || is_resume=1
printf '%s' 'session state' > "$provider/thread.jsonl"
printf '%s\n' '{"type":"thread.started","thread_id":"11111111-1111-4111-8111-111111111111"}'
printf '%s\n' '{"type":"turn.started"}'
printf '%s\n' '{"type":"item.updated","item":{"id":"item-0","type":"todo_list","items":[]}}'
printf '%s\n' '{"type":"item.started","item":{"id":"item-1","type":"mcp_tool_call","server":"source_reader","tool":"read_text","arguments":{"path":"/workspace/main/plugin.php"},"status":"in_progress"}}'
printf '%s\n' '{"type":"item.completed","item":{"id":"item-1","type":"mcp_tool_call","server":"source_reader","tool":"read_text","arguments":{"path":"/workspace/main/plugin.php"},"result":{"content":[]},"error":null,"status":"completed"}}'
printf '%s\n' '{"type":"item.completed","item":{"id":"item-reader-error","type":"mcp_tool_call","server":"source_reader","tool":"search_text","arguments":{"query":"missing"},"result":null,"error":{"message":"No match"},"status":"failed"}}'
printf '%s\n' '{"type":"item.started","item":{"id":"item-collab","type":"collab_tool_call","tool":"spawn_agent","sender_thread_id":"11111111-1111-4111-8111-111111111111","receiver_thread_ids":["22222222-2222-4222-8222-222222222222"],"prompt":"Review one route.","agents_states":{},"status":"in_progress"}}'
printf '%s\n' '{"type":"item.completed","item":{"id":"item-collab","type":"collab_tool_call","tool":"spawn_agent","sender_thread_id":"11111111-1111-4111-8111-111111111111","receiver_thread_ids":["22222222-2222-4222-8222-222222222222"],"prompt":"Review one route.","agents_states":{"22222222-2222-4222-8222-222222222222":{"status":"running","message":null}},"status":"completed"}}'
if [ "$is_resume" -eq 0 ]; then
  printf '%s\n' '{"type":"item.completed","item":{"id":"item-2","type":"agent_message","text":"{\\"schemaVersion\\":1,\\"candidates\\":[],\\"decision\\":{\\"kind\\":\\"continue\\",\\"reason\\":\\"One source-bound question remains.\\",\\"nextActions\\":[{\\"question\\":\\"Trace the final route.\\",\\"sourcePointers\\":[\\"plugin.php\\"]}]}}"}}'
else
  printf '%s\n' '{"type":"item.completed","item":{"id":"item-2","type":"agent_message","text":"{\\"schemaVersion\\":1,\\"candidates\\":[],\\"decision\\":{\\"kind\\":\\"stop\\",\\"basis\\":\\"No actionable frontier remains.\\"}}"}}'
fi
printf '%s\n' '{"type":"turn.completed","usage":{"input_tokens":1000,"cached_input_tokens":200,"cache_write_input_tokens":300,"output_tokens":100,"reasoning_output_tokens":50}}'
`,
      { encoding: "utf8", mode: 0o700 },
    );
    await chmod(dockerExecutablePath, 0o700);

    const researchPrompt = "Research broken security semantics from source.";
    const validationPrompt = "Independently validate from source.";
    const input: CampaignInput = {
      kind: "agent-led-campaign",
      schemaVersion: 1,
      campaignId: "campaign-codex-daybreak-native",
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
        id: "codex-daybreak-blue-native-v1",
        kind: "codex-native/v1",
        executableVersion: "0.146.0",
        model: "gpt-daybreak-blue-latest",
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
        researchGrantWallTimeMs: 600_000,
        digest:
          "sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
      },
    };
    const campaigns = openResearchCampaigns({
      databasePath: join(directory, "campaign.sqlite"),
      runtime: openCodexNativeAgentRuntime({
        dockerExecutablePath,
        image:
          "wp-discovery-codex:0.146.0@sha256:44342fc7bc7d6e6dd6c7445ebf23d0d6f414fc22c61fab69e158ab0fa7ba5a73",
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
        sourceReaderScript: "process.exit(0);\n",
      }),
    });

    const outcome = await conductWithHumanAdvance(campaigns, input);
    expect(
      outcome,
      JSON.stringify(await campaigns.inspect({ campaignId: input.campaignId })),
    ).toMatchObject({
      status: "coverage-closed",
    });
    const inspection = await campaigns.inspect({
      campaignId: input.campaignId,
    });
    expect(inspection).toMatchObject({
      nativeRuns: [
        {
          terminal: "completed",
          usage: { inputTokens: 1_500, outputTokens: 100 },
          activity: {
            subagents: 1,
            tools: ["source_reader.read_text", "collab.spawn_agent"],
          },
          isolation: {
            backend: "gvisor",
            runtime: "runsc",
            fallbackUsed: false,
          },
          checkpoint: {
            sessionId: "11111111-1111-4111-8111-111111111111",
          },
        },
        {
          terminal: "completed",
          usage: { inputTokens: 1_500, outputTokens: 100 },
          activity: {
            subagents: 1,
            tools: ["source_reader.read_text", "collab.spawn_agent"],
          },
          checkpoint: {
            sessionId: "11111111-1111-4111-8111-111111111111",
          },
        },
      ],
    });
    campaigns.close();
  });

  it("keeps timeout semantics and private diagnostics when checkpoint finalization fails", async () => {
    const directory = await mkdtemp(join(tmpdir(), "codex-native-diagnostic-"));
    temporaryDirectories.push(directory);
    const sourceDirectory = join(directory, "source");
    const providerConfigDirectory = join(directory, "provider-config");
    const scratchRootDirectory = join(directory, "scratch");
    await Promise.all([
      mkdir(sourceDirectory),
      mkdir(providerConfigDirectory),
      mkdir(scratchRootDirectory),
    ]);
    await Promise.all([
      writeFile(join(sourceDirectory, "plugin.php"), "<?php\n", "utf8"),
      writeFile(
        join(providerConfigDirectory, "auth.json"),
        '{"access_token":"diagnostic-secret-token"}',
        { encoding: "utf8", mode: 0o600 },
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
if [ "\${1:-}" = "image" ]; then exit 0; fi
is_version=0
provider=''
for argument in "$@"; do
  case "$argument" in
    *:/provider:rw) provider="\${argument%:/provider:rw}" ;;
  esac
  [ "$argument" != "--version" ] || is_version=1
done
if [ "$is_version" -eq 1 ]; then
  printf '%s\n' 'codex-cli 0.146.0'
  exit 0
fi
printf '%s' 'partial provider state' > "$provider/thread.jsonl"
ln "$provider/thread.jsonl" "$provider/invalid-link"
printf '%s\n' '{"type":"thread.started","thread_id":"33333333-3333-4333-8333-333333333333"}'
printf '%s\n' 'diagnostic-secret-token' >&2
sleep 60
`,
      { encoding: "utf8", mode: 0o700 },
    );
    await chmod(dockerExecutablePath, 0o700);

    const researchPrompt = "Research broken security semantics from source.";
    const validationPrompt = "Independently validate from source.";
    const input: CampaignInput = {
      kind: "agent-led-campaign",
      schemaVersion: 1,
      campaignId: "campaign-codex-timeout-diagnostic",
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
        id: "codex-daybreak-blue-native-v1",
        kind: "codex-native/v1",
        executableVersion: "0.146.0",
        model: "gpt-daybreak-blue-latest",
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
        maxNativeRuns: 1,
        maxWallTimeMs: 250,
        researchGrantWallTimeMs: 250,
        digest:
          "sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
      },
    };
    const campaigns = openResearchCampaigns({
      databasePath: join(directory, "campaign.sqlite"),
      runtime: openCodexNativeAgentRuntime({
        dockerExecutablePath,
        image:
          "wp-discovery-codex:0.146.0@sha256:44342fc7bc7d6e6dd6c7445ebf23d0d6f414fc22c61fab69e158ab0fa7ba5a73",
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
        sourceReaderScript: "process.exit(0);\n",
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
          terminal: "budget-exhausted",
          failure: {
            stage: "checkpoint-finalization",
            diagnostic: {
              kind: "agent-run-diagnostic",
              schemaVersion: 1,
              diagnosticId: expect.stringMatching(/^diagnostic-[a-f0-9]{64}$/),
              digest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
              bytes: expect.any(Number),
            },
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
      throw new Error("Expected a failed run with a private diagnostic");
    }
    const diagnosticRef = nativeRun.failure.diagnostic;
    const diagnosticFiles = await readdir(
      join(scratchRootDirectory, "agent-diagnostics"),
    );
    expect(diagnosticFiles).toHaveLength(1);
    expect(diagnosticFiles[0]).toBe(diagnosticRef.diagnosticId);
    const diagnosticRoot = join(
      scratchRootDirectory,
      "agent-diagnostics",
      diagnosticFiles[0] ?? "",
    );
    const diagnostic = await readFile(
      join(diagnosticRoot, "diagnostic.json"),
      "utf8",
    );
    expect(diagnosticRef.digest).toBe(
      `sha256:${createHash("sha256").update(diagnostic).digest("hex")}`,
    );
    expect(diagnosticRef.bytes).toBe(Buffer.byteLength(diagnostic));
    expect(diagnostic).not.toContain("diagnostic-secret-token");
    expect(diagnostic).toContain("[REDACTED]");
    expect(JSON.parse(diagnostic)).toMatchObject({
      stage: "checkpoint-finalization",
      process: { kind: "timed-out" },
      error: { name: "Error" },
      statePreserved: true,
    });
    expect(
      await readFile(
        join(diagnosticRoot, "state", "provider", "thread.jsonl"),
        "utf8",
      ),
    ).toBe("partial provider state");
    expect(
      await readdir(join(diagnosticRoot, "state", "provider")),
    ).not.toContain("auth.json");
    campaigns.close();
  });

  it("records a refused tool call as an auditable policy denial", async () => {
    const directory = await mkdtemp(join(tmpdir(), "codex-native-denied-"));
    temporaryDirectories.push(directory);
    const sourceDirectory = join(directory, "source");
    const providerConfigDirectory = join(directory, "provider-config");
    const scratchRootDirectory = join(directory, "scratch");
    await Promise.all([
      mkdir(sourceDirectory),
      mkdir(providerConfigDirectory),
      mkdir(scratchRootDirectory),
    ]);
    await Promise.all([
      writeFile(join(sourceDirectory, "plugin.php"), "<?php\n", "utf8"),
      writeFile(
        join(providerConfigDirectory, "auth.json"),
        '{"access_token":"denied-secret-token"}',
        { encoding: "utf8", mode: 0o600 },
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
    const omitSessionPath = join(directory, "omit-session");
    await writeFile(
      dockerExecutablePath,
      `#!/bin/sh
set -eu
if [ "\${1:-}" = "info" ]; then
  printf '%s' '{"runsc":{"path":"/usr/bin/runsc"}}'
  exit 0
fi
if [ "\${1:-}" = "image" ]; then exit 0; fi
is_version=0
provider=''
for argument in "$@"; do
  case "$argument" in
    *:/provider:rw) provider="\${argument%:/provider:rw}" ;;
  esac
  [ "$argument" != "--version" ] || is_version=1
done
if [ "$is_version" -eq 1 ]; then
  printf '%s\n' 'codex-cli 0.146.0'
  exit 0
fi
printf '%s' 'session state' > "$provider/thread.jsonl"
if [ ! -f '${omitSessionPath}' ]; then
  printf '%s\n' '{"type":"thread.started","thread_id":"11111111-1111-4111-8111-111111111111"}'
fi
printf '%s\n' '{"type":"turn.started"}'
printf '%s\n' '{"type":"item.completed","item":{"id":"item-1","type":"mcp_tool_call","server":"ambient_shell","tool":"run","arguments":{},"result":null,"error":null,"status":"completed"}}'
printf '%s\n' '{"type":"item.completed","item":{"id":"item-2","type":"agent_message","text":"{\\"schemaVersion\\":1,\\"candidates\\":[],\\"decision\\":{\\"kind\\":\\"stop\\",\\"basis\\":\\"No actionable frontier remains.\\"}}"}}'
printf '%s\n' '{"type":"turn.completed","usage":{"input_tokens":1000,"cached_input_tokens":200,"cache_write_input_tokens":300,"output_tokens":100,"reasoning_output_tokens":50}}'
`,
      { encoding: "utf8", mode: 0o700 },
    );
    await chmod(dockerExecutablePath, 0o700);

    const researchPrompt = "Research broken security semantics from source.";
    const validationPrompt = "Independently validate from source.";
    const input: CampaignInput = {
      kind: "agent-led-campaign",
      schemaVersion: 1,
      campaignId: "campaign-codex-policy-denied",
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
        id: "codex-daybreak-blue-native-v1",
        kind: "codex-native/v1",
        executableVersion: "0.146.0",
        model: "gpt-daybreak-blue-latest",
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
        maxNativeRuns: 1,
        maxWallTimeMs: 600_000,
        researchGrantWallTimeMs: 600_000,
        digest:
          "sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
      },
    };
    const campaigns = openResearchCampaigns({
      databasePath: join(directory, "campaign.sqlite"),
      runtime: openCodexNativeAgentRuntime({
        dockerExecutablePath,
        image:
          "wp-discovery-codex:0.146.0@sha256:44342fc7bc7d6e6dd6c7445ebf23d0d6f414fc22c61fab69e158ab0fa7ba5a73",
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
        sourceReaderScript: "process.exit(0);\n",
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
            summary: "Codex violated the sealed model or tool policy.",
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
        "diagnostic.json",
      ),
      "utf8",
    );
    expect(diagnostic).not.toContain("denied-secret-token");
    expect(JSON.parse(diagnostic)).toMatchObject({
      stage: "runtime-adapter",
      statePreserved: false,
      error: {
        message: "Codex violated the sealed model or tool policy.",
      },
    });
    expect(diagnostic).toContain("ambient_shell");

    await writeFile(omitSessionPath, "omit", "utf8");
    const unboundInput: CampaignInput = {
      ...input,
      campaignId: "campaign-codex-unbound-session",
    };
    await expect(campaigns.conduct(unboundInput)).resolves.toMatchObject({
      status: "incomplete",
    });
    await expect(
      campaigns.inspect({ campaignId: unboundInput.campaignId }),
    ).resolves.toMatchObject({
      nativeRuns: [
        {
          terminal: "policy-denied",
          failure: {
            summary:
              "The sandboxed Agent Runtime returned an unbound Research session.",
            stage: "checkpoint-finalization",
            diagnostic: { kind: "agent-run-diagnostic" },
          },
        },
      ],
    });

    await rm(omitSessionPath);
    const diagnosticDirectory = join(scratchRootDirectory, "agent-diagnostics");
    await rm(diagnosticDirectory, { recursive: true });
    await writeFile(diagnosticDirectory, "blocked", "utf8");
    const unavailableDiagnosticInput: CampaignInput = {
      ...input,
      campaignId: "campaign-codex-diagnostic-unavailable",
    };
    await expect(
      campaigns.conduct(unavailableDiagnosticInput),
    ).resolves.toMatchObject({ status: "incomplete" });
    await expect(
      campaigns.inspect({ campaignId: unavailableDiagnosticInput.campaignId }),
    ).resolves.toMatchObject({
      nativeRuns: [
        {
          terminal: "provider-failed",
          failure: {
            summary:
              "The Runtime Adapter refused provider output, but its private diagnostic could not be preserved.",
            stage: "runtime-adapter",
          },
        },
      ],
    });
    campaigns.close();
  });
});
