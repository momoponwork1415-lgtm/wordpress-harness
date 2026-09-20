import { createHash } from "node:crypto";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  deepSeekHarnessNativeTransport,
  defineAgentRuntimeProfile,
} from "../../src/infrastructure/agent-runtime-profile.js";
import { canonicalDigest } from "../../src/infrastructure/canonical-json.js";
import type {
  DeepSeekCredentialEgressGrantRequest,
  ProviderCredentialEgressBroker,
  ProviderCredentialEgressReceipt,
} from "../../src/infrastructure/deepseek-credential-egress-broker.js";
import { promptTextDigest } from "../../src/infrastructure/prompt-text.js";
import { sealedNativeRunSchema } from "../../src/research/agent-led/contracts.js";
import { openDeepSeekHarnessNativeAgentRuntime } from "../../src/research/agent-led/deepseek-harness-native-agent-runtime.js";
import { researchEvidenceSummaryFixture } from "./support/research-evidence-summary.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

function profile() {
  return defineAgentRuntimeProfile({
    id: "deepseek-flash-max",
    ...deepSeekHarnessNativeTransport,
    model: "deepseek-flash",
    effort: "max",
  });
}

function brokerReceipt(
  request: DeepSeekCredentialEgressGrantRequest,
): ProviderCredentialEgressReceipt {
  const body = {
    schemaVersion: 1 as const,
    grantId: "grant-1",
    runtimeProfileDigest: request.runtimeProfileDigest,
    brokerImage: `sha256:${"b".repeat(64)}`,
    upstreamOrigin: "https://api.deepseek.com" as const,
    model: request.model,
    protocol: request.protocol,
    maxRequests: request.maxRequests,
    maxRequestBytes: request.maxRequestBytes,
    maxResponseBytes: request.maxResponseBytes,
    expiresAt: request.expiresAt,
    startedAt: "2026-09-18T00:00:00.000Z",
    completedAt: "2026-09-18T00:00:01.000Z",
    setup: { status: "ready" as const },
    cleanup: { status: "completed" as const },
    isolation: {
      backend: "gvisor" as const,
      runtime: "runsc" as const,
      fallbackUsed: false as const,
      agentNetworkInternal: true as const,
    },
  };
  return { ...body, digest: canonicalDigest(body) };
}

describe("DeepSeek Harness Native Agent Runtime", () => {
  it("reports an unavailable host-private key as unauthenticated", async () => {
    const researchPrompt = "Audit broken security semantics from source.";
    const runtimeProfile = profile();
    const run = sealedNativeRunSchema.parse({
      kind: "sealed-native-research-run",
      schemaVersion: 2,
      runId: "run-deepseek-no-key",
      campaignId: "campaign-deepseek-no-key",
      campaignInputDigest: `sha256:${"1".repeat(64)}`,
      targetSnapshot: {
        id: "target-1",
        pluginSlug: "example-plugin",
        version: "1.0.0",
        digest: `sha256:${"2".repeat(64)}`,
        sourceTree: {
          digest: `sha256:${"3".repeat(64)}`,
          entries: 1,
          bytes: 1,
        },
      },
      promptSet: { id: "prompt-1", digest: promptTextDigest(researchPrompt) },
      agentRuntimeProfile: runtimeProfile,
      permissionProfile: {
        id: "permission-1",
        digest: `sha256:${"6".repeat(64)}`,
      },
      budgetEnvelope: {
        id: "budget-1",
        maxNativeRuns: 1,
        maxWallTimeMs: 60_000,
        digest: `sha256:${"7".repeat(64)}`,
      },
      budgetAllowance: { maxWallTimeMs: 60_000 },
    });
    const broker: ProviderCredentialEgressBroker = {
      async withGrant(request) {
        const ready = brokerReceipt(request);
        const { digest: _digest, ...readyBody } = ready;
        const body = {
          ...readyBody,
          setup: {
            status: "failed" as const,
            stage: "credential" as const,
            reason: "credential-unavailable" as const,
          },
          cleanup: { status: "not-required" as const },
        };
        return {
          operation: { status: "not-started" as const },
          receipt: { ...body, digest: canonicalDigest(body) },
        };
      },
    };
    const runtime = openDeepSeekHarnessNativeAgentRuntime({
      sandbox: {
        dockerExecutablePath: "/usr/bin/docker",
        image: runtimeProfile.sandboxImageDigest,
        sourceDirectory: "/source",
        targetSnapshotDigest: run.targetSnapshot.digest,
        sourceTree: run.targetSnapshot.sourceTree,
        providerConfigDirectory: "/provider",
        scratchRootDirectory: "/scratch",
        promptSet: { digest: run.promptSet.digest, text: researchPrompt },
        permissionProfileDigest: run.permissionProfile.digest,
        maxOutputBytes: 1_000_000,
      },
      credentialEgressBroker: broker,
    });

    await expect(runtime.execute(run)).resolves.toMatchObject({
      terminal: "provider-unauthenticated",
      credentialEgress: {
        setup: { status: "failed", stage: "credential" },
        cleanup: { status: "not-required" },
      },
      failure: {
        summary: "The host-private DeepSeek credential is unavailable.",
      },
    });
  });

  it("runs one bound headless DSH session through a scoped egress grant", async () => {
    const directory = await mkdtemp(join(tmpdir(), "deepseek-native-runtime-"));
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
    const dockerExecutablePath = join(directory, "fake-docker");
    const finalEvent = JSON.stringify({
      type: "final",
      text: JSON.stringify({
        schemaVersion: 2,
        assessments: [],
        evidenceSummary: researchEvidenceSummaryFixture("plugin.php"),
        candidates: [],
        decision: {
          kind: "stop",
          basis: "No actionable frontier remains.",
        },
      }),
    }).replaceAll("'", "'\\''");
    const malformedReportEvent = JSON.stringify({
      type: "final",
      text: '{"schemaVersion":2,"assessments":[',
    }).replaceAll("'", "'\\''");
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
is_resume=0
has_network=0
has_key=0
has_base_url=0
has_dsh_home=0
has_native_cache_disabled=0
patch_file=''
provider_home=''
previous=''
for argument in "$@"; do
  if [ "$previous" = "--network" ] && [ "$argument" = "deepseek-internal" ]; then has_network=1; fi
  if [ "$previous" = "--session-id" ]; then is_resume=1; fi
  [ "$argument" != "--env=DEEPSEEK_API_KEY=scoped-token" ] || has_key=1
  [ "$argument" != "--env=DEEPSEEK_BASE_URL=http://10.0.0.2:8080" ] || has_base_url=1
  [ "$argument" != "--env=DSH_HOME=/provider" ] || has_dsh_home=1
  [ "$argument" != "--env=NARB_DISABLE_NATIVE_CACHE=1" ] || has_native_cache_disabled=1
  [ "$argument" != "--version" ] || is_version_probe=1
  case "$argument" in
    *:/etc/dsh/research.patch.yml:ro) patch_file="\${argument%:/etc/dsh/research.patch.yml:ro}" ;;
    *:/provider:rw) provider_home="\${argument%:/provider:rw}" ;;
  esac
  previous="$argument"
done
[ "$has_network" -eq 1 ] || exit 91
[ "$has_key" -eq 1 ] || exit 92
[ "$has_base_url" -eq 1 ] || exit 93
[ "$has_dsh_home" -eq 1 ] || exit 94
[ "$has_native_cache_disabled" -eq 1 ] || exit 97
if [ "$is_version_probe" -eq 1 ]; then
  printf '%s\n' '0.1.6-alpha.2'
  exit 0
fi
[ -n "$patch_file" ] || exit 95
grep -F 'protocol: chat-completions' "$patch_file" >/dev/null
grep -F 'reasoningEffort: max' "$patch_file" >/dev/null
grep -F 'maxActiveSubagents: 3' "$patch_file" >/dev/null
grep -F -- '- id: tool-subagent-fork' "$patch_file" >/dev/null
[ -n "$provider_home" ] || exit 96
prompt=$(cat)
printf '%s' "$prompt" | grep -F 'DeepSeek final Research Report JSON Schema:' >/dev/null
mode='success'
if [ -f "$0.mode" ]; then mode=$(cat "$0.mode"); fi
if [ "$mode" = "auth" ] || [ "$mode" = "quota" ] || [ "$mode" = "timeout" ] || [ "$mode" = "malformed-provider" ]; then
  case "$mode" in
    auth) code='AUTH'; session='22222222-2222-4222-8222-222222222222' ;;
    quota) code='QUOTA'; session='33333333-3333-4333-8333-333333333333' ;;
    timeout) code='TIMEOUT'; session='44444444-4444-4444-8444-444444444444' ;;
    malformed-provider) code='MALFORMED_RESPONSE'; session='66666666-6666-4666-8666-666666666666' ;;
  esac
  printf '%s' '{"persisted":true}' > "$provider_home/session-$session.jsonl"
  printf '{"type":"session","sessionId":"session-%s","cwd":"/workspace"}\n' "$session"
  printf '{"type":"status","phase":"turn_end","turn":1,"reason":{"kind":"error","error":{"code":"%s","message":"provider failure"}}}\n' "$code"
  printf '%s\n' '{"type":"final","text":""}'
  exit 1
fi
if [ "$mode" = "malformed" ]; then
  printf '%s' '{"persisted":true}' > "$provider_home/session-55555555-5555-4555-8555-555555555555.jsonl"
  printf '%s\n' '{"type":"session","sessionId":"session-55555555-5555-4555-8555-555555555555","cwd":"/workspace"}'
  printf '%s\n' 'not-json'
  exit 0
fi
if [ "$mode" = "malformed-report" ] || [ "$mode" = "malformed-report-twice" ]; then
  printf '%s' '{"persisted":true}' > "$provider_home/session-77777777-7777-4777-8777-777777777777.jsonl"
  printf '%s\n' '{"type":"session","sessionId":"session-77777777-7777-4777-8777-777777777777","cwd":"/workspace"}'
  printf '%s\n' '{"type":"status","phase":"step_end","turn":1,"step":1,"usage":{"inputTokens":1200,"outputTokens":300,"cacheReadTokens":50,"cacheWriteTokens":25,"reasoningTokens":100,"totalTokens":1675}}'
  printf '%s\n' '{"type":"status","phase":"turn_end","turn":1,"reason":{"kind":"completed"}}'
  if [ "$is_resume" -eq 1 ] && [ "$mode" = "malformed-report" ]; then
    printf '%s' "$prompt" | grep -F 'Correct only the format of your previous final Research Report' >/dev/null
    printf '%s\n' '${finalEvent}'
  else
    printf '%s\n' '${malformedReportEvent}'
  fi
  exit 0
fi
printf '%s' '{"persisted":true}' > "$provider_home/session-11111111-1111-4111-8111-111111111111.jsonl"
printf '%s\n' '{"type":"session","sessionId":"session-11111111-1111-4111-8111-111111111111","cwd":"/workspace"}'
printf '%s\n' '{"type":"status","phase":"step_end","turn":1,"step":1,"usage":{"inputTokens":1200,"outputTokens":300,"cacheReadTokens":50,"cacheWriteTokens":25,"reasoningTokens":100,"totalTokens":1675}}'
printf '%s\n' '{"type":"tool_call","callId":"call-1","tool":"read_file","input":{"path":"main/plugin.php"}}'
printf '%s\n' '{"type":"status","phase":"turn_end","turn":1,"reason":{"kind":"completed"}}'
printf '%s\n' '${finalEvent}'
`,
      { encoding: "utf8", mode: 0o700 },
    );
    await chmod(dockerExecutablePath, 0o700);

    let grantRequest: DeepSeekCredentialEgressGrantRequest | undefined;
    const broker: ProviderCredentialEgressBroker = {
      async withGrant(request, operation) {
        grantRequest = request;
        const value = await operation({
          baseUrl: "http://10.0.0.2:8080",
          authorization: "Bearer scoped-token",
          dockerNetworkName: "deepseek-internal",
          model: request.model,
          protocol: request.protocol,
          expiresAt: request.expiresAt,
        });
        return {
          operation: { status: "completed", value },
          receipt: brokerReceipt(request),
        };
      },
    };
    const researchPrompt = "Audit broken security semantics from source.";
    const runtimeProfile = profile();
    const run = sealedNativeRunSchema.parse({
      kind: "sealed-native-research-run",
      schemaVersion: 2,
      runId: "run-deepseek-1",
      campaignId: "campaign-deepseek-1",
      campaignInputDigest: `sha256:${"1".repeat(64)}`,
      targetSnapshot: {
        id: "target-1",
        pluginSlug: "example-plugin",
        version: "1.0.0",
        digest: `sha256:${"2".repeat(64)}`,
        sourceTree: { digest: sourceTreeDigest, entries: 1, bytes: 6 },
      },
      promptSet: { id: "prompt-1", digest: promptTextDigest(researchPrompt) },
      agentRuntimeProfile: runtimeProfile,
      permissionProfile: {
        id: "permission-1",
        digest: `sha256:${"6".repeat(64)}`,
      },
      budgetEnvelope: {
        id: "budget-1",
        maxNativeRuns: 1,
        maxWallTimeMs: 60_000,
        digest: `sha256:${"7".repeat(64)}`,
      },
      budgetAllowance: { maxWallTimeMs: 60_000 },
    });
    const runtime = openDeepSeekHarnessNativeAgentRuntime({
      sandbox: {
        dockerExecutablePath,
        image: runtimeProfile.sandboxImageDigest,
        sourceDirectory,
        targetSnapshotDigest: run.targetSnapshot.digest,
        sourceTree: run.targetSnapshot.sourceTree,
        providerConfigDirectory,
        scratchRootDirectory,
        promptSet: { digest: run.promptSet.digest, text: researchPrompt },
        permissionProfileDigest: run.permissionProfile.digest,
        maxOutputBytes: 1_000_000,
      },
      credentialEgressBroker: broker,
    });

    const receipt = await runtime.execute(run);
    expect(receipt, JSON.stringify(receipt, null, 2)).toMatchObject({
      terminal: "completed",
      usage: { inputTokens: 1275, outputTokens: 300 },
      activity: { subagents: 0, tools: ["read_file"] },
      credentialEgress: {
        runtimeProfileDigest: runtimeProfile.digest,
        model: "deepseek-flash",
        protocol: "chat-completions",
        setup: { status: "ready" },
        cleanup: { status: "completed" },
        isolation: { agentNetworkInternal: true },
        digest: expect.stringMatching(/^sha256:/u),
      },
      checkpoint: {
        sessionId: "session-11111111-1111-4111-8111-111111111111",
      },
      report: {
        decision: {
          kind: "stop",
          basis: "No actionable frontier remains.",
        },
      },
    });
    expect(grantRequest).toMatchObject({
      schemaVersion: 1,
      runtimeProfileDigest: runtimeProfile.digest,
      model: "deepseek-flash",
      protocol: "chat-completions",
      expiresAt: expect.any(String),
    });

    await writeFile(`${dockerExecutablePath}.mode`, "malformed-report", "utf8");
    const correctionRun = sealedNativeRunSchema.parse({
      ...run,
      runId: "run-deepseek-format-correction",
      campaignId: "campaign-deepseek-format-correction",
      campaignInputDigest: `sha256:${"d".repeat(64)}`,
    });
    await expect(runtime.execute(correctionRun)).resolves.toMatchObject({
      terminal: "completed",
      usage: { inputTokens: 2550, outputTokens: 600 },
      activity: { subagents: 0, tools: [] },
      checkpoint: {
        sessionId: "session-77777777-7777-4777-8777-777777777777",
      },
      report: {
        decision: {
          kind: "stop",
          basis: "No actionable frontier remains.",
        },
      },
    });

    const failures = [
      {
        mode: "auth",
        character: "8",
        terminal: "provider-unauthenticated",
      },
      {
        mode: "quota",
        character: "9",
        terminal: "provider-quota-exhausted",
      },
      { mode: "timeout", character: "a", terminal: "provider-failed" },
      { mode: "malformed", character: "b", terminal: "invalid-output" },
      {
        mode: "malformed-provider",
        character: "c",
        terminal: "invalid-output",
      },
      {
        mode: "malformed-report-twice",
        character: "e",
        terminal: "invalid-output",
        summary:
          "DeepSeek Harness returned an unsupported Agent Report (invalid_type@$).",
      },
    ] as const;
    for (const failure of failures) {
      await writeFile(`${dockerExecutablePath}.mode`, failure.mode, "utf8");
      const failedRun = sealedNativeRunSchema.parse({
        ...run,
        runId: `run-deepseek-${failure.mode}`,
        campaignId: `campaign-deepseek-${failure.mode}`,
        campaignInputDigest: `sha256:${failure.character.repeat(64)}`,
      });
      await expect(runtime.execute(failedRun)).resolves.toMatchObject({
        terminal: failure.terminal,
        ...("summary" in failure
          ? { failure: { summary: failure.summary } }
          : {}),
      });
    }
  });
});
