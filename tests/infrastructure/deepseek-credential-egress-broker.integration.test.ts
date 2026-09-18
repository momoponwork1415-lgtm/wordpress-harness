import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createDeepSeekCredentialEgressBroker } from "../../src/infrastructure/deepseek-credential-egress-broker.js";
import { runNativeModelProcess } from "../../src/infrastructure/native-model-process.js";

const roots: string[] = [];
const nodeImage =
  "node@sha256:235600a8101ab264e117b1768e925532262668dc9b581ef1dd7d96ced463b8e7";

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("DeepSeek credential egress broker host integration", () => {
  it.skipIf(process.env.HARNESS_RUN_DOCKER_INTEGRATION !== "1")(
    "starts the runsc sidecar and denies direct Agent egress",
    async () => {
      const root = await mkdtemp(join(tmpdir(), "deepseek-egress-host-"));
      roots.push(root);
      const credentialFilePath = join(root, "deepseek-api-key");
      await writeFile(credentialFilePath, "sk-non-production-host-test-key\n", {
        mode: 0o600,
      });
      const dockerEvidence: {
        args: readonly string[];
        exitCode: number;
        stdout: string;
        stderr: string;
      }[] = [];
      let capturedBrokerLogs = false;
      const broker = createDeepSeekCredentialEgressBroker({
        dockerExecutablePath: "/usr/bin/docker",
        brokerImage: nodeImage,
        credentialFilePath,
        scratchRootDirectory: root,
        proxyBundleDirectory: resolve("dist/infrastructure"),
        runDocker: async (args, timeoutMs) => {
          const processResult = await runNativeModelProcess({
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
            maxOutputBytes: 64 * 1024,
          });
          const result = {
            exitCode:
              processResult.kind === "exited" ? processResult.exitCode : -1,
            stdout: processResult.stdout,
            stderr: processResult.stderr,
          };
          dockerEvidence.push({ args, ...result });
          if (
            args[0] === "exec" &&
            result.exitCode !== 0 &&
            !capturedBrokerLogs
          ) {
            capturedBrokerLogs = true;
            const containerName = args[1];
            if (containerName !== undefined) {
              const logs = await runNativeModelProcess({
                executablePath: "/usr/bin/docker",
                args: ["logs", containerName],
                workingDirectory: process.cwd(),
                environment: {
                  PATH: process.env.PATH,
                  LANG: "C",
                  LC_ALL: "C",
                  TZ: "UTC",
                },
                timeoutMs: 5_000,
                maxOutputBytes: 64 * 1024,
              });
              dockerEvidence.push({
                args: ["logs", containerName],
                exitCode: logs.kind === "exited" ? logs.exitCode : -1,
                stdout: logs.stdout,
                stderr: logs.stderr,
              });
            }
          }
          return result;
        },
      });

      const result = await broker.withGrant(
        {
          schemaVersion: 1,
          runtimeProfileDigest:
            "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
          model: "deepseek-flash",
          protocol: "responses",
          maxRequests: 1,
          maxRequestBytes: 4_096,
          maxResponseBytes: 4_096,
          expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
        },
        async (grant) => {
          const probe = await runNativeModelProcess({
            executablePath: "/usr/bin/docker",
            args: [
              "run",
              "--rm",
              "--pull=never",
              "--runtime=runsc",
              "--network",
              grant.dockerNetworkName,
              "--read-only",
              "--cap-drop=ALL",
              "--security-opt=no-new-privileges",
              nodeImage,
              "node",
              "--input-type=module",
              "-e",
              "const health=await fetch(process.argv[1]+'/healthz');if(!health.ok)process.exit(2);try{await fetch('https://api.deepseek.com',{signal:AbortSignal.timeout(1000)});process.exit(3)}catch{}",
              grant.baseUrl,
            ],
            workingDirectory: process.cwd(),
            environment: {
              PATH: process.env.PATH,
              LANG: "C",
              LC_ALL: "C",
              TZ: "UTC",
            },
            timeoutMs: 20_000,
            maxOutputBytes: 64 * 1024,
          });
          if (probe.kind !== "exited" || probe.exitCode !== 0) {
            throw new Error(
              `Agent network isolation probe failed: ${JSON.stringify(probe)}`,
            );
          }
          return "isolated";
        },
      );

      if (result.receipt.setup.status !== "ready") {
        throw new Error(JSON.stringify({ result, dockerEvidence }, null, 2));
      }
      expect(result.receipt.setup).toEqual({ status: "ready" });
      expect(result.operation).toEqual({
        status: "completed",
        value: "isolated",
      });
      expect(result.receipt.cleanup).toEqual({ status: "completed" });
    },
    60_000,
  );
});
