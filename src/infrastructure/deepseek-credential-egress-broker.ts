import { randomBytes, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { mkdtemp, open, realpath, rm, stat, writeFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { isIP } from "node:net";

import { z } from "zod";

import { canonicalDigest } from "./canonical-json.js";
import type { DeepSeekApiProtocol } from "./deepseek-credential-proxy.js";
import { DEEPSEEK_UPSTREAM_ORIGIN } from "./deepseek-credential-proxy.js";
import { runNativeModelProcess } from "./native-model-process.js";

const digestSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/u);
const modelSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/u);
const dockerNameSchema = z
  .string()
  .regex(/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/u);
const pinnedImageSchema = z
  .string()
  .regex(/^(?:sha256:[a-f0-9]{64}|[A-Za-z0-9][^\s@]*@sha256:[a-f0-9]{64})$/u);

export const deepSeekCredentialEgressGrantRequestSchema = z
  .object({
    schemaVersion: z.literal(1),
    runtimeProfileDigest: digestSchema,
    model: modelSchema,
    protocol: z.enum(["responses", "chat-completions"]),
    maxRequests: z.number().int().positive().max(10_000),
    maxRequestBytes: z
      .number()
      .int()
      .positive()
      .max(1024 * 1024 * 1024),
    maxResponseBytes: z
      .number()
      .int()
      .positive()
      .max(1024 * 1024 * 1024),
    expiresAt: z.iso.datetime({ offset: true }),
  })
  .strict();

export type DeepSeekCredentialEgressGrantRequest = z.infer<
  typeof deepSeekCredentialEgressGrantRequestSchema
>;

export interface ProviderCredentialEgressGrant {
  readonly baseUrl: string;
  readonly authorization: string;
  readonly dockerNetworkName: string;
  readonly model: string;
  readonly protocol: DeepSeekApiProtocol;
  readonly expiresAt: string;
}

export type ProviderCredentialEgressOperation<T> =
  | { readonly status: "not-started" }
  | { readonly status: "completed"; readonly value: T }
  | { readonly status: "failed"; readonly error: unknown };

export type ProviderCredentialEgressSetup =
  | { readonly status: "ready" }
  | {
      readonly status: "failed";
      readonly stage:
        | "credential"
        | "broker-preflight"
        | "network-create"
        | "broker-start"
        | "provider-network-connect"
        | "broker-address"
        | "broker-health";
      readonly reason:
        | "credential-unavailable"
        | "broker-bundle-unavailable"
        | "docker-network-unavailable"
        | "broker-container-unavailable"
        | "provider-network-unavailable"
        | "broker-address-unavailable"
        | "broker-not-ready";
    };

export type ProviderCredentialEgressCleanup =
  | { readonly status: "completed" }
  | { readonly status: "not-required" }
  | {
      readonly status: "failed";
      readonly failedSteps: readonly (
        "broker-remove" | "network-remove" | "credential-staging-remove"
      )[];
    };

export interface ProviderCredentialEgressReceipt {
  readonly schemaVersion: 1;
  readonly grantId: string;
  readonly runtimeProfileDigest: string;
  readonly brokerImage: string;
  readonly upstreamOrigin: typeof DEEPSEEK_UPSTREAM_ORIGIN;
  readonly model: string;
  readonly protocol: DeepSeekApiProtocol;
  readonly maxRequests: number;
  readonly maxRequestBytes: number;
  readonly maxResponseBytes: number;
  readonly expiresAt: string;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly setup: ProviderCredentialEgressSetup;
  readonly cleanup: ProviderCredentialEgressCleanup;
  readonly isolation: {
    readonly backend: "gvisor";
    readonly runtime: "runsc";
    readonly fallbackUsed: false;
    readonly agentNetworkInternal: true;
  };
  readonly digest: string;
}

export interface ProviderCredentialEgressResult<T> {
  readonly operation: ProviderCredentialEgressOperation<T>;
  readonly receipt: ProviderCredentialEgressReceipt;
}

export interface ProviderCredentialEgressBroker {
  withGrant<T>(
    request: DeepSeekCredentialEgressGrantRequest,
    operation: (grant: ProviderCredentialEgressGrant) => Promise<T>,
  ): Promise<ProviderCredentialEgressResult<T>>;
}

export interface DockerCommandResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

export interface DeepSeekCredentialEgressBrokerOptions {
  readonly dockerExecutablePath: string;
  readonly brokerImage: string;
  readonly credentialFilePath: string;
  readonly scratchRootDirectory: string;
  readonly proxyBundleDirectory: string;
  readonly providerNetworkName?: string;
  readonly clock?: () => Date;
  readonly randomUuid?: () => string;
  readonly randomGrantToken?: () => string;
  readonly runDocker?: (
    args: readonly string[],
    timeoutMs: number,
  ) => Promise<DockerCommandResult>;
}

const BROKER_ALIAS = "deepseek-egress";
const BROKER_PORT = 8080;
const MAX_GRANT_DURATION_MS = 60 * 60 * 1_000;

function redactSecret(value: string, secret: string): string {
  return value.split(secret).join("[REDACTED]");
}

function receiptWithDigest(
  receipt: Omit<ProviderCredentialEgressReceipt, "digest">,
): ProviderCredentialEgressReceipt {
  return { ...receipt, digest: canonicalDigest(receipt) };
}

async function readPrivateCredential(path: string): Promise<string> {
  if (!isAbsolute(path) || path.includes("\0")) {
    throw new Error("credential path is unavailable");
  }
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const metadata = await handle.stat();
    const expectedUid =
      typeof process.getuid === "function" ? process.getuid() : undefined;
    if (
      !metadata.isFile() ||
      metadata.nlink !== 1 ||
      (metadata.mode & 0o077) !== 0 ||
      (expectedUid !== undefined && metadata.uid !== expectedUid) ||
      metadata.size <= 0 ||
      metadata.size > 16_384
    ) {
      throw new Error("credential file is unavailable");
    }
    const value = (await handle.readFile("utf8")).trim();
    if (value.length < 8 || value.length > 16_384 || /[\0\r\n]/u.test(value)) {
      throw new Error("credential value is unavailable");
    }
    return value;
  } finally {
    await handle.close();
  }
}

async function defaultDockerCommand(
  executablePath: string,
  args: readonly string[],
  timeoutMs: number,
  secret: string,
): Promise<DockerCommandResult> {
  const result = await runNativeModelProcess({
    executablePath,
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
    redact: (text) => redactSecret(text, secret),
  });
  if (result.kind !== "exited") {
    return {
      exitCode: -1,
      stdout: result.stdout,
      stderr: result.stderr,
    };
  }
  return result;
}

function validateBrokerOptions(
  options: DeepSeekCredentialEgressBrokerOptions,
): void {
  if (
    !isAbsolute(options.dockerExecutablePath) ||
    !isAbsolute(options.credentialFilePath) ||
    !isAbsolute(options.scratchRootDirectory) ||
    !isAbsolute(options.proxyBundleDirectory)
  ) {
    throw new Error("DeepSeek credential broker paths must be absolute");
  }
  pinnedImageSchema.parse(options.brokerImage);
  dockerNameSchema.parse(options.providerNetworkName ?? "bridge");
}

function nonRootHostUser(): string {
  if (
    typeof process.getuid !== "function" ||
    typeof process.getgid !== "function" ||
    process.getuid() <= 0 ||
    process.getgid() <= 0
  ) {
    throw new Error("DeepSeek credential broker requires a non-root host user");
  }
  return `${process.getuid()}:${process.getgid()}`;
}

async function requireDirectory(path: string): Promise<string> {
  if (!isAbsolute(path) || path.includes("\0") || path.includes(":")) {
    throw new Error("DeepSeek credential broker directory is unavailable");
  }
  const resolved = await realpath(path);
  if (!(await stat(resolved)).isDirectory()) {
    throw new Error("DeepSeek credential broker directory is unavailable");
  }
  return resolved;
}

function validateGrantDeadline(
  request: DeepSeekCredentialEgressGrantRequest,
  now: Date,
): void {
  const deadline = new Date(request.expiresAt).getTime();
  const duration = deadline - now.getTime();
  if (duration <= 0 || duration > MAX_GRANT_DURATION_MS) {
    throw new Error("DeepSeek credential grant must expire within one hour");
  }
}

function dockerSucceeded(result: DockerCommandResult): boolean {
  return result.exitCode === 0;
}

async function waitForBrokerHealth(
  runDocker: (
    args: readonly string[],
    timeoutMs: number,
  ) => Promise<DockerCommandResult>,
  containerName: string,
): Promise<boolean> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const result = await runDocker(
      [
        "exec",
        containerName,
        "node",
        "--input-type=module",
        "-e",
        `const r=await fetch('http://127.0.0.1:${BROKER_PORT}/healthz');if(!r.ok)process.exit(1)`,
      ],
      5_000,
    );
    if (dockerSucceeded(result)) return true;
    if (
      result.stderr.includes("is not running") ||
      result.stderr.includes("No such container")
    ) {
      return false;
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 100));
  }
  return false;
}

/**
 * Owns one short-lived DeepSeek egress grant. The raw provider credential is
 * mounted only into the gVisor broker sidecar; the operation receives a
 * network-scoped bearer token instead.
 */
export function createDeepSeekCredentialEgressBroker(
  options: DeepSeekCredentialEgressBrokerOptions,
): ProviderCredentialEgressBroker {
  validateBrokerOptions(options);
  const clock = options.clock ?? (() => new Date());
  const nextUuid = options.randomUuid ?? randomUUID;
  const nextToken =
    options.randomGrantToken ?? (() => randomBytes(32).toString("base64url"));
  const providerNetworkName = options.providerNetworkName ?? "bridge";
  const containerUser = nonRootHostUser();

  return {
    async withGrant<T>(
      requestValue: DeepSeekCredentialEgressGrantRequest,
      operation: (grant: ProviderCredentialEgressGrant) => Promise<T>,
    ) {
      const request =
        deepSeekCredentialEgressGrantRequestSchema.parse(requestValue);
      const startedAt = clock();
      validateGrantDeadline(request, startedAt);
      const grantId = nextUuid();
      dockerNameSchema.parse(grantId);
      const networkName = `deepseek-egress-${grantId}`;
      const containerName = `deepseek-egress-broker-${grantId}`;
      dockerNameSchema.parse(networkName);
      dockerNameSchema.parse(containerName);
      const grantToken = nextToken();
      if (grantToken.length < 32 || /[\s\0]/u.test(grantToken)) {
        throw new Error("DeepSeek credential grant token is invalid");
      }

      let setup: ProviderCredentialEgressSetup;
      let cleanup: ProviderCredentialEgressCleanup = {
        status: "not-required",
      };
      let operationResult: ProviderCredentialEgressOperation<T> = {
        status: "not-started",
      };
      let networkCreated = false;
      let brokerStarted = false;
      let stagingDirectory: string | undefined;
      let rawApiKey: string | undefined;
      let pendingSetupFailure: Extract<
        ProviderCredentialEgressSetup,
        { readonly status: "failed" }
      > = {
        status: "failed",
        stage: "credential",
        reason: "credential-unavailable",
      };

      const complete = (): ProviderCredentialEgressResult<T> => ({
        operation: operationResult,
        receipt: receiptWithDigest({
          schemaVersion: 1,
          grantId,
          runtimeProfileDigest: request.runtimeProfileDigest,
          brokerImage: options.brokerImage,
          upstreamOrigin: DEEPSEEK_UPSTREAM_ORIGIN,
          model: request.model,
          protocol: request.protocol,
          maxRequests: request.maxRequests,
          maxRequestBytes: request.maxRequestBytes,
          maxResponseBytes: request.maxResponseBytes,
          expiresAt: request.expiresAt,
          startedAt: startedAt.toISOString(),
          completedAt: clock().toISOString(),
          setup,
          cleanup,
          isolation: {
            backend: "gvisor",
            runtime: "runsc",
            fallbackUsed: false,
            agentNetworkInternal: true,
          },
        }),
      });

      let runDocker:
        | ((
            args: readonly string[],
            timeoutMs: number,
          ) => Promise<DockerCommandResult>)
        | undefined;
      try {
        rawApiKey = await readPrivateCredential(options.credentialFilePath);
        const secret = rawApiKey;
        runDocker = async (args, timeoutMs) => {
          const result =
            options.runDocker === undefined
              ? await defaultDockerCommand(
                  options.dockerExecutablePath,
                  args,
                  timeoutMs,
                  secret,
                )
              : await options.runDocker(args, timeoutMs);
          return {
            exitCode: result.exitCode,
            stdout: redactSecret(result.stdout, secret),
            stderr: redactSecret(result.stderr, secret),
          };
        };
        pendingSetupFailure = {
          status: "failed",
          stage: "broker-preflight",
          reason: "broker-bundle-unavailable",
        };
        const scratchRoot = await requireDirectory(
          options.scratchRootDirectory,
        );
        const proxyBundle = await requireDirectory(
          options.proxyBundleDirectory,
        );
        const proxyCli = join(proxyBundle, "deepseek-credential-proxy-cli.js");
        if (!(await stat(proxyCli)).isFile()) {
          throw new Error("DeepSeek credential proxy bundle is unavailable");
        }
        stagingDirectory = await mkdtemp(join(scratchRoot, "deepseek-egress-"));
        const stagedCredential = join(stagingDirectory, "deepseek-api-key");
        await writeFile(stagedCredential, `${rawApiKey}\n`, {
          encoding: "utf8",
          mode: 0o600,
          flag: "wx",
        });

        pendingSetupFailure = {
          status: "failed",
          stage: "network-create",
          reason: "docker-network-unavailable",
        };
        const executeDocker = runDocker;
        const network = await executeDocker(
          ["network", "create", "--internal", networkName],
          20_000,
        );
        if (!dockerSucceeded(network)) {
          setup = {
            status: "failed",
            stage: "network-create",
            reason: "docker-network-unavailable",
          };
        } else {
          networkCreated = true;
          pendingSetupFailure = {
            status: "failed",
            stage: "broker-start",
            reason: "broker-container-unavailable",
          };
          const broker = await executeDocker(
            [
              "run",
              "--detach",
              "--pull=never",
              "--runtime=runsc",
              `--user=${containerUser}`,
              "--name",
              containerName,
              "--network",
              networkName,
              `--network-alias=${BROKER_ALIAS}`,
              "--read-only",
              "--cap-drop=ALL",
              "--security-opt=no-new-privileges",
              "--pids-limit=64",
              "--memory=512m",
              "--cpus=1",
              "--tmpfs=/tmp:rw,noexec,nosuid,nodev,size=32m",
              "--volume",
              `${proxyBundle}:/opt/deepseek-egress:ro`,
              "--volume",
              `${stagedCredential}:/run/secrets/deepseek-api-key:ro`,
              "--env",
              `DEEPSEEK_GRANT_TOKEN=${grantToken}`,
              "--env",
              `DEEPSEEK_MODEL=${request.model}`,
              "--env",
              `DEEPSEEK_PROTOCOL=${request.protocol}`,
              "--env",
              `DEEPSEEK_MAX_REQUESTS=${request.maxRequests}`,
              "--env",
              `DEEPSEEK_MAX_REQUEST_BYTES=${request.maxRequestBytes}`,
              "--env",
              `DEEPSEEK_MAX_RESPONSE_BYTES=${request.maxResponseBytes}`,
              "--env",
              `DEEPSEEK_GRANT_EXPIRES_AT=${request.expiresAt}`,
              options.brokerImage,
              "node",
              "/opt/deepseek-egress/deepseek-credential-proxy-cli.js",
            ],
            20_000,
          );
          if (!dockerSucceeded(broker)) {
            setup = {
              status: "failed",
              stage: "broker-start",
              reason: "broker-container-unavailable",
            };
          } else {
            brokerStarted = true;
            pendingSetupFailure = {
              status: "failed",
              stage: "provider-network-connect",
              reason: "provider-network-unavailable",
            };
            const providerNetwork = await executeDocker(
              ["network", "connect", providerNetworkName, containerName],
              20_000,
            );
            if (!dockerSucceeded(providerNetwork)) {
              setup = {
                status: "failed",
                stage: "provider-network-connect",
                reason: "provider-network-unavailable",
              };
            } else {
              pendingSetupFailure = {
                status: "failed",
                stage: "broker-address",
                reason: "broker-address-unavailable",
              };
              const address = await executeDocker(
                [
                  "inspect",
                  "--format",
                  `{{with index .NetworkSettings.Networks "${networkName}"}}{{.IPAddress}}{{end}}`,
                  containerName,
                ],
                20_000,
              );
              const brokerAddress = address.stdout.trim();
              if (!dockerSucceeded(address) || isIP(brokerAddress) !== 4) {
                setup = {
                  status: "failed",
                  stage: "broker-address",
                  reason: "broker-address-unavailable",
                };
              } else {
                pendingSetupFailure = {
                  status: "failed",
                  stage: "broker-health",
                  reason: "broker-not-ready",
                };
                const healthy = await waitForBrokerHealth(
                  executeDocker,
                  containerName,
                );
                if (!healthy) {
                  setup = {
                    status: "failed",
                    stage: "broker-health",
                    reason: "broker-not-ready",
                  };
                } else {
                  setup = { status: "ready" };
                  try {
                    const value = await operation({
                      baseUrl: `http://${brokerAddress}:${BROKER_PORT}`,
                      authorization: `Bearer ${grantToken}`,
                      dockerNetworkName: networkName,
                      model: request.model,
                      protocol: request.protocol,
                      expiresAt: request.expiresAt,
                    });
                    operationResult = { status: "completed", value };
                  } catch (error: unknown) {
                    operationResult = { status: "failed", error };
                  }
                }
              }
            }
          }
        }
      } catch {
        setup = pendingSetupFailure;
      } finally {
        const failedSteps: (
          "broker-remove" | "network-remove" | "credential-staging-remove"
        )[] = [];
        if (brokerStarted && runDocker !== undefined) {
          try {
            const stopped = await runDocker(
              ["rm", "--force", containerName],
              20_000,
            );
            if (!dockerSucceeded(stopped)) failedSteps.push("broker-remove");
          } catch {
            failedSteps.push("broker-remove");
          }
        }
        if (networkCreated && runDocker !== undefined) {
          try {
            const removed = await runDocker(
              ["network", "rm", networkName],
              20_000,
            );
            if (!dockerSucceeded(removed)) failedSteps.push("network-remove");
          } catch {
            failedSteps.push("network-remove");
          }
        }
        if (stagingDirectory !== undefined) {
          try {
            await rm(stagingDirectory, { recursive: true, force: true });
          } catch {
            failedSteps.push("credential-staging-remove");
          }
        }
        if (brokerStarted || networkCreated || stagingDirectory !== undefined) {
          cleanup =
            failedSteps.length === 0
              ? { status: "completed" }
              : { status: "failed", failedSteps };
        }
        rawApiKey = undefined;
      }

      return complete();
    },
  };
}
