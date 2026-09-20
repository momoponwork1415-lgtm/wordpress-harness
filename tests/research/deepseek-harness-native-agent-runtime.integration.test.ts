import { createHash, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { isIP } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  deepSeekHarnessNativeTransport,
  defineAgentRuntimeProfile,
} from "../../src/infrastructure/agent-runtime-profile.js";
import { canonicalDigest } from "../../src/infrastructure/canonical-json.js";
import type {
  ProviderCredentialEgressBroker,
  ProviderCredentialEgressReceipt,
} from "../../src/infrastructure/deepseek-credential-egress-broker.js";
import { runNativeModelProcess } from "../../src/infrastructure/native-model-process.js";
import {
  canonicalResearchPromptSet,
  type CampaignInput,
} from "../../src/research/index.js";
import { openDeepSeekHarnessNativeAgentRuntime } from "../../src/research/agent-led/deepseek-harness-native-agent-runtime.js";
import { openResearchCampaigns } from "../../src/research/agent-led/research-campaigns.js";
import { researchEvidenceSummaryFixture } from "./support/research-evidence-summary.js";

const roots: string[] = [];
const nodeImage =
  "node@sha256:235600a8101ab264e117b1768e925532262668dc9b581ef1dd7d96ced463b8e7";

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function docker(args: readonly string[], timeoutMs = 20_000) {
  const result = await runNativeModelProcess({
    executablePath: "/usr/bin/docker",
    args,
    workingDirectory: process.cwd(),
    environment: {
      PATH: process.env.PATH,
      LANG: "C",
      LC_ALL: "C",
      TZ: "UTC",
    },
    timeoutMs,
    maxOutputBytes: 1024 * 1024,
  });
  return {
    exitCode: result.kind === "exited" ? result.exitCode : -1,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

function receipt(
  request: Parameters<ProviderCredentialEgressBroker["withGrant"]>[0],
  grantId: string,
  startedAt: string,
  completedAt: string,
): ProviderCredentialEgressReceipt {
  const body = {
    schemaVersion: 1 as const,
    grantId,
    runtimeProfileDigest: request.runtimeProfileDigest,
    brokerImage: nodeImage,
    upstreamOrigin: "https://api.deepseek.com" as const,
    model: request.model,
    protocol: request.protocol,
    maxRequests: request.maxRequests,
    maxRequestBytes: request.maxRequestBytes,
    maxResponseBytes: request.maxResponseBytes,
    expiresAt: request.expiresAt,
    startedAt,
    completedAt,
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

function mockProviderScript(): string {
  return `
const http = await import("node:http");
const report = process.argv[1];
http.createServer((request, response) => {
  if (request.method === "GET" && request.url === "/healthz") {
    response.writeHead(200).end("ok");
    return;
  }
  const chunks = [];
  request.on("data", (chunk) => chunks.push(chunk));
  request.on("end", () => {
    let body;
    try { body = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
    catch { response.writeHead(400).end(); return; }
    if (
      request.method !== "POST" ||
      request.url !== "/chat/completions" ||
      request.headers.authorization !== "Bearer scoped-integration-token" ||
      body.model !== "deepseek-flash" ||
      body.stream !== true ||
      !JSON.stringify(body.messages).includes("Maintain an explicit scratch registry of approach families")
    ) {
      response.writeHead(400).end();
      return;
    }
    const content = {
      id: "chatcmpl-integration",
      object: "chat.completion.chunk",
      created: 1,
      model: "deepseek-flash",
      choices: [{ index: 0, delta: { role: "assistant", content: report }, finish_reason: null }],
    };
    const finish = {
      id: "chatcmpl-integration",
      object: "chat.completion.chunk",
      created: 1,
      model: "deepseek-flash",
      choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
      usage: { prompt_tokens: 100, completion_tokens: 40, total_tokens: 140 },
    };
    response.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    });
    response.end(
      "data: " + JSON.stringify(content) + "\\n\\n" +
      "data: " + JSON.stringify(finish) + "\\n\\n" +
      "data: [DONE]\\n\\n"
    );
  });
}).listen(8080, "0.0.0.0");
`;
}

describe("DeepSeek Harness Native Agent Runtime host integration", () => {
  it.skipIf(process.env.HARNESS_RUN_DOCKER_INTEGRATION !== "1")(
    "conducts one sealed Campaign through the official DSH transport",
    async () => {
      const root = await mkdtemp(join(tmpdir(), "deepseek-dsh-host-"));
      roots.push(root);
      const sourceDirectory = join(root, "source");
      const providerConfigDirectory = join(root, "provider-config");
      const scratchRootDirectory = join(root, "scratch");
      await Promise.all([
        mkdir(sourceDirectory),
        mkdir(providerConfigDirectory),
        mkdir(scratchRootDirectory),
      ]);
      const source = "<?php\n";
      await writeFile(join(sourceDirectory, "plugin.php"), source, "utf8");
      const sourceTreeDigest = canonicalDigest({
        kind: "canonical-file-manifest",
        schemaVersion: 1,
        entries: [
          {
            path: "plugin.php",
            digest: `sha256:${createHash("sha256").update(source).digest("hex")}`,
            size: Buffer.byteLength(source),
          },
        ],
      });
      const researchPrompt = await readFile(
        resolve("prompts/wordpress-plugin-research-v7.md"),
        "utf8",
      );
      const runtimeProfile = defineAgentRuntimeProfile({
        id: "deepseek-flash-max",
        ...deepSeekHarnessNativeTransport,
        model: "deepseek-flash",
        effort: "max",
      });
      const campaignInput: CampaignInput = {
        kind: "agent-led-campaign",
        schemaVersion: 2,
        campaignId: "campaign-deepseek-dsh-integration",
        targetSnapshot: {
          id: "target-deepseek-dsh-integration",
          pluginSlug: "fixture-plugin",
          version: "1.0.0",
          digest: `sha256:${"2".repeat(64)}`,
          sourceTree: {
            digest: sourceTreeDigest,
            entries: 1,
            bytes: Buffer.byteLength(source),
          },
        },
        promptSet: canonicalResearchPromptSet,
        agentRuntimeProfile: runtimeProfile,
        permissionProfile: {
          id: "source-only-deepseek-dsh-integration",
          digest: `sha256:${"6".repeat(64)}`,
        },
        budgetEnvelope: {
          id: "budget-deepseek-dsh-integration",
          maxNativeRuns: 1,
          maxWallTimeMs: 60_000,
          digest: `sha256:${"7".repeat(64)}`,
        },
      };
      const providerReport = JSON.stringify({
        schemaVersion: 2,
        assessments: [],
        evidenceSummary: researchEvidenceSummaryFixture("plugin.php"),
        candidates: [],
        decision: {
          kind: "stop",
          basis: "No actionable frontier remains in the sealed fixture.",
        },
      });
      const broker: ProviderCredentialEgressBroker = {
        async withGrant(request, operation) {
          const grantId = randomUUID();
          const networkName = `deepseek-dsh-integration-${grantId}`;
          const containerName = `deepseek-dsh-provider-${grantId}`;
          const startedAt = new Date().toISOString();
          let operationResult:
            | {
                readonly status: "completed";
                readonly value: Awaited<ReturnType<typeof operation>>;
              }
            | { readonly status: "failed"; readonly error: unknown }
            | { readonly status: "not-started" } = { status: "not-started" };
          try {
            const network = await docker([
              "network",
              "create",
              "--internal",
              networkName,
            ]);
            if (network.exitCode !== 0) throw new Error(network.stderr);
            const server = await docker([
              "run",
              "--detach",
              "--pull=never",
              "--runtime=runsc",
              `--user=${process.getuid?.()}:${process.getgid?.()}`,
              "--name",
              containerName,
              "--network",
              networkName,
              "--network-alias=mock-deepseek",
              "--read-only",
              "--cap-drop=ALL",
              "--security-opt=no-new-privileges",
              "--pids-limit=64",
              "--memory=512m",
              "--cpus=1",
              "--tmpfs=/tmp:rw,noexec,nosuid,nodev,size=32m",
              nodeImage,
              "node",
              "--input-type=module",
              "-e",
              mockProviderScript(),
              providerReport,
            ]);
            if (server.exitCode !== 0) throw new Error(server.stderr);
            const address = await docker([
              "inspect",
              "--format",
              `{{with index .NetworkSettings.Networks "${networkName}"}}{{.IPAddress}}{{end}}`,
              containerName,
            ]);
            const providerAddress = address.stdout.trim();
            if (address.exitCode !== 0 || isIP(providerAddress) !== 4) {
              throw new Error("mock provider address is unavailable");
            }
            let healthy = false;
            for (let attempt = 0; attempt < 20; attempt += 1) {
              const health = await docker([
                "exec",
                containerName,
                "node",
                "--input-type=module",
                "-e",
                "const r=await fetch('http://127.0.0.1:8080/healthz');if(!r.ok)process.exit(1)",
              ]);
              if (health.exitCode === 0) {
                healthy = true;
                break;
              }
              await new Promise<void>((resolve) => setTimeout(resolve, 100));
            }
            if (!healthy) throw new Error("mock provider did not become ready");
            try {
              operationResult = {
                status: "completed",
                value: await operation({
                  baseUrl: `http://${providerAddress}:8080`,
                  authorization: "Bearer scoped-integration-token",
                  dockerNetworkName: networkName,
                  model: request.model,
                  protocol: request.protocol,
                  expiresAt: request.expiresAt,
                }),
              };
            } catch (error: unknown) {
              operationResult = { status: "failed", error };
            }
          } finally {
            await docker(["rm", "--force", containerName]).catch(
              () => undefined,
            );
            await docker(["network", "rm", networkName]).catch(() => undefined);
          }
          return {
            operation: operationResult,
            receipt: receipt(
              request,
              grantId,
              startedAt,
              new Date().toISOString(),
            ),
          };
        },
      };
      const runtime = openDeepSeekHarnessNativeAgentRuntime({
        sandbox: {
          dockerExecutablePath: "/usr/bin/docker",
          image: runtimeProfile.sandboxImageDigest,
          sourceDirectory,
          targetSnapshotDigest: campaignInput.targetSnapshot.digest,
          sourceTree: campaignInput.targetSnapshot.sourceTree,
          providerConfigDirectory,
          scratchRootDirectory,
          promptSet: {
            digest: campaignInput.promptSet.digest,
            text: researchPrompt,
          },
          permissionProfileDigest: campaignInput.permissionProfile.digest,
          maxOutputBytes: 1024 * 1024,
        },
        credentialEgressBroker: broker,
      });
      const campaigns = openResearchCampaigns({
        databasePath: join(root, "research.sqlite"),
        runtime,
      });

      const outcome = await campaigns.conduct(campaignInput);
      const view = await campaigns.inspect({
        campaignId: campaignInput.campaignId,
      });
      campaigns.close();

      expect(view.nativeRuns).toHaveLength(1);
      const nativeRun = view.nativeRuns[0]!;
      const diagnostic =
        nativeRun.terminal === "completed" ||
        nativeRun.failure.diagnostic === undefined
          ? undefined
          : await readFile(
              join(
                scratchRootDirectory,
                "agent-diagnostics",
                nativeRun.failure.diagnostic.diagnosticId,
                "content",
                "diagnostic.json",
              ),
              "utf8",
            );
      expect(
        nativeRun,
        diagnostic ?? JSON.stringify(nativeRun, null, 2),
      ).toMatchObject({
        terminal: "completed",
        runtimeProfileDigest: runtimeProfile.digest,
        usage: { inputTokens: 100, outputTokens: 40 },
        credentialEgress: {
          setup: { status: "ready" },
          cleanup: { status: "completed" },
          isolation: { agentNetworkInternal: true },
        },
        isolation: {
          backend: "gvisor",
          runtime: "runsc",
          fallbackUsed: false,
        },
        checkpoint: {
          sessionId: expect.stringMatching(/^session-[0-9a-f-]+$/u),
        },
        report: {
          candidates: [],
          decision: {
            kind: "stop",
            basis: "No actionable frontier remains in the sealed fixture.",
          },
        },
      });
      expect(outcome).toMatchObject({ status: "coverage-closed" });
    },
    120_000,
  );
});
