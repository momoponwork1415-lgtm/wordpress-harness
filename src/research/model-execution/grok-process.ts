import { randomUUID } from "node:crypto";
import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";

import type { SourceEvidenceGateway } from "../source-mapping/source-evidence-contracts.js";
import { openModelExecution } from "./model-execution.js";
import {
  openClaudeSourceEvidenceBridge,
  type ClaudeSourceEvidenceBridge,
} from "./claude-source-evidence-bridge.js";
import type {
  AttemptSourceEvidence,
  ModelExecution,
  ModelProcessRequest,
  ModelProcessResult,
} from "./contracts.js";
import type { ModelProcessObserver } from "./model-process-observability.js";
import { runNativeModelProcess } from "./native-model-process.js";

export interface OpenGrokModelExecutionOptions {
  readonly artifactDirectory: string;
  readonly executablePath: string;
  readonly executableVersion: string;
  readonly grokHomeDirectory: string;
  readonly sourceEvidenceGateway?: SourceEvidenceGateway;
  readonly processObserver?: ModelProcessObserver;
  readonly processHeartbeatIntervalMs?: number;
}

interface EphemeralGrokEnvironment {
  readonly root: string;
  readonly home: string;
  readonly grokHome: string;
  readonly workspace: string;
  readonly credentialSecrets: readonly string[];
}

const maximumCredentialFileBytes = 1024 * 1024;
const inheritedEnvironment = [
  "PATH",
  "LANG",
  "LC_ALL",
  "USER",
  "LOGNAME",
  "SHELL",
  "TMPDIR",
  "SSL_CERT_FILE",
  "SSL_CERT_DIR",
  "NODE_EXTRA_CA_CERTS",
] as const;

function isFileSystemError(
  error: unknown,
  code: string,
): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === code;
}

async function copyPrivateGrokFile(
  source: string,
  destination: string,
  required: boolean,
): Promise<string | undefined> {
  let metadata;
  try {
    metadata = await lstat(source);
  } catch (error: unknown) {
    if (!required && isFileSystemError(error, "ENOENT")) return undefined;
    throw error;
  }
  if (
    !metadata.isFile() ||
    metadata.size <= 0 ||
    metadata.size > maximumCredentialFileBytes ||
    (metadata.mode & 0o777) !== 0o600
  ) {
    throw new Error(
      "Grok credential source must be a bounded 0600 regular file",
    );
  }
  const contents = await readFile(source, "utf8");
  await copyFile(source, destination);
  await chmod(destination, 0o600);
  return contents;
}

function credentialSecrets(document: string): readonly string[] {
  const collected = new Set<string>();
  const collect = (value: unknown): void => {
    if (typeof value === "string") {
      if (value.length >= 12) collected.add(value);
      return;
    }
    if (Array.isArray(value)) {
      value.forEach(collect);
      return;
    }
    if (typeof value === "object" && value !== null) {
      Object.values(value).forEach(collect);
    }
  };
  try {
    const parsed: unknown = JSON.parse(document);
    collect(parsed);
  } catch {
    const trimmed = document.trim();
    if (trimmed.length >= 12) collected.add(trimmed);
  }
  return [...collected];
}

async function openEphemeralGrokEnvironment(
  sourceHome: string,
): Promise<EphemeralGrokEnvironment> {
  const root = await mkdtemp(join(tmpdir(), "wordpress-harness-grok-"));
  const home = join(root, "home");
  const grokHome = join(root, "grok");
  const workspace = join(root, "workspace");
  await Promise.all([
    chmod(root, 0o700),
    mkdir(home, { mode: 0o700 }),
    mkdir(grokHome, { mode: 0o700 }),
    mkdir(workspace, { mode: 0o700 }),
  ]);
  try {
    const authDocument = await copyPrivateGrokFile(
      join(sourceHome, "auth.json"),
      join(grokHome, "auth.json"),
      true,
    );
    await copyPrivateGrokFile(
      join(sourceHome, "agent_id"),
      join(grokHome, "agent_id"),
      false,
    );
    return {
      root,
      home,
      grokHome,
      workspace,
      credentialSecrets: credentialSecrets(authDocument ?? ""),
    };
  } catch (error: unknown) {
    await rm(root, { recursive: true, force: true });
    throw error;
  }
}

function minimalGrokEnvironment(
  environment: EphemeralGrokEnvironment,
): NodeJS.ProcessEnv {
  const result: NodeJS.ProcessEnv = {
    CI: "1",
    NO_COLOR: "1",
    HOME: environment.home,
    GROK_HOME: environment.grokHome,
    XDG_CONFIG_HOME: join(environment.home, ".config"),
    XDG_CACHE_HOME: join(environment.home, ".cache"),
    XDG_DATA_HOME: join(environment.home, ".local", "share"),
  };
  for (const name of inheritedEnvironment) {
    const value = process.env[name];
    if (value !== undefined) result[name] = value;
  }
  if (result.PATH === undefined) {
    throw new Error("Grok process requires PATH");
  }
  return result;
}

function redactSecrets(text: string, secrets: readonly string[]): string {
  return secrets.reduce(
    (redacted, secret) => redacted.replaceAll(secret, "[REDACTED]"),
    text,
  );
}

function isAuthenticationFailure(result: {
  readonly stdout: string;
  readonly stderr: string;
}): boolean {
  return /(?:not logged in|login required|unauthorized|authentication required)/iu.test(
    `${result.stdout}\n${result.stderr}`,
  );
}

class NativeGrokProcess {
  readonly #options;

  constructor(options: OpenGrokModelExecutionOptions) {
    if (!isAbsolute(options.executablePath)) {
      throw new Error("Grok executable path must be absolute");
    }
    if (!isAbsolute(options.grokHomeDirectory)) {
      throw new Error("Grok home directory must be absolute");
    }
    const heartbeat = options.processHeartbeatIntervalMs ?? 25_000;
    if (
      !Number.isSafeInteger(heartbeat) ||
      heartbeat <= 0 ||
      heartbeat > 30_000
    ) {
      throw new Error(
        "Grok process heartbeat interval must be an integer from 1 to 30000",
      );
    }
    this.#options = options;
  }

  async execute(request: ModelProcessRequest): Promise<ModelProcessResult> {
    const profile = request.plan.modelProfile;
    if (
      profile.provider !== "xai" ||
      profile.model !== "grok-4.6" ||
      profile.transport !== "grok-build-process" ||
      profile.effort !== "xhigh"
    ) {
      return {
        kind: "policy-denied",
        reason: "transport-profile-incompatible",
      };
    }
    if (profile.executableVersion !== this.#options.executableVersion) {
      throw new Error("Attempt Plan Grok version does not match adapter");
    }
    let isolated: EphemeralGrokEnvironment;
    try {
      isolated = await openEphemeralGrokEnvironment(
        this.#options.grokHomeDirectory,
      );
    } catch {
      return {
        kind: "auth-required",
        reason: "provider-session-unavailable",
      };
    }
    const operationId = request.plan.attemptId || `grok:${randomUUID()}`;
    const startedAt = performance.now();
    const remainingTime = (): number =>
      Math.max(
        0,
        request.plan.budget.maxWallTimeMs - (performance.now() - startedAt),
      );
    const environment = minimalGrokEnvironment(isolated);
    let sourceBridge: ClaudeSourceEvidenceBridge | undefined;
    const redact = (text: string): string => {
      const credentialRedacted = redactSecrets(
        text,
        isolated.credentialSecrets,
      );
      return sourceBridge?.redact(credentialRedacted) ?? credentialRedacted;
    };
    try {
      const version = await runNativeModelProcess({
        executablePath: this.#options.executablePath,
        args: ["--version"],
        workingDirectory: isolated.workspace,
        environment,
        timeoutMs: Math.min(remainingTime(), 10_000),
        maxOutputBytes: 64 * 1024,
        redact,
        ...(this.#options.processObserver === undefined
          ? {}
          : { observer: this.#options.processObserver }),
        heartbeatIntervalMs: this.#options.processHeartbeatIntervalMs ?? 25_000,
        observation: {
          operationId,
          phase: "version-probe",
          segmentOrdinal: 0,
        },
      });
      const versionParts =
        version.kind === "exited" ? version.stdout.trim().split(/\s+/u) : [];
      if (
        version.kind !== "exited" ||
        version.exitCode !== 0 ||
        versionParts[0] !== "grok" ||
        versionParts[1] !== this.#options.executableVersion
      ) {
        const observed =
          version.kind === "exited"
            ? `${version.exitCode}:${version.stdout.trim().slice(0, 64)}`
            : version.kind;
        throw new Error(`Grok executable version probe failed (${observed})`);
      }
      if (remainingTime() === 0) {
        return { kind: "timed-out", stderr: "" };
      }
      if (request.sourceEvidence !== undefined) {
        try {
          sourceBridge = await openClaudeSourceEvidenceBridge(
            request.sourceEvidence,
            {
              observe: (event) => {
                try {
                  this.#options.processObserver?.observe({
                    ...event,
                    schemaVersion: 1,
                    operationId,
                    phase: "inference",
                    segmentOrdinal: 1,
                    occurredAt: new Date().toISOString(),
                  });
                } catch {
                  // Observability must not change provider execution.
                }
              },
            },
          );
          await copyFile(
            sourceBridge.mcpConfigPath,
            join(isolated.workspace, ".mcp.json"),
          );
          await chmod(join(isolated.workspace, ".mcp.json"), 0o600);
        } catch {
          return {
            kind: "policy-denied",
            reason: "source-evidence-bridge-unavailable",
          };
        }
      }
      const args = [
        "--model",
        profile.model,
        "--reasoning-effort",
        profile.effort,
        "--cwd",
        isolated.workspace,
        "--sandbox",
        "workspace",
        "--verbatim",
        "--no-subagents",
        "--disable-web-search",
        "--tools",
        "",
        "--permission-mode",
        "bypassPermissions",
        "--json-schema",
        JSON.stringify(request.outputJsonSchema),
        "--single",
        request.plan.prompt,
      ];
      const result = await runNativeModelProcess({
        executablePath: this.#options.executablePath,
        args,
        workingDirectory: isolated.workspace,
        environment,
        timeoutMs: remainingTime(),
        maxOutputBytes: request.plan.budget.maxOutputBytes,
        redact,
        ...(this.#options.processObserver === undefined
          ? {}
          : { observer: this.#options.processObserver }),
        heartbeatIntervalMs: this.#options.processHeartbeatIntervalMs ?? 25_000,
        observation: {
          operationId,
          phase: "inference",
          segmentOrdinal: 1,
        },
      });
      if (
        sourceBridge !== undefined &&
        result.kind === "exited" &&
        result.exitCode === 0 &&
        !sourceBridge.observedConnection()
      ) {
        return {
          kind: "policy-denied",
          reason: "source-evidence-bridge-not-connected",
        };
      }
      if (
        result.kind === "exited" &&
        result.exitCode !== 0 &&
        isAuthenticationFailure(result)
      ) {
        return {
          kind: "auth-required",
          reason: "provider-session-unavailable",
        };
      }
      return result;
    } finally {
      await Promise.all([
        sourceBridge?.close(),
        rm(isolated.root, { recursive: true, force: true }),
      ]);
    }
  }
}

export function openGrokModelExecution(
  options: OpenGrokModelExecutionOptions,
): ModelExecution {
  const process = new NativeGrokProcess(options);
  return openModelExecution({
    artifactDirectory: options.artifactDirectory,
    process,
    ...(options.sourceEvidenceGateway === undefined
      ? {}
      : { sourceEvidenceGateway: options.sourceEvidenceGateway }),
  });
}
