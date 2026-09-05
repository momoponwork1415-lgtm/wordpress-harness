import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import { chmod, copyFile, lstat, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";

import { z } from "zod";

import type { SourceEvidenceGateway } from "../source-mapping/source-evidence-contracts.js";
import { openModelExecution } from "./model-execution.js";
import {
  openClaudeSourceEvidenceBridge,
  type ClaudeSourceEvidenceBridge,
} from "./claude-source-evidence-bridge.js";
import {
  attemptPlanSchema,
  type AttemptSourceEvidence,
  type ModelExecution,
  type ModelProcess,
  type ModelProcessResult,
  type ModelProcessRequest,
  type StructuredModelExecution,
} from "./contracts.js";
import {
  decodeClaudeEnvelope,
  decodeClaudeErrorEnvelope,
  type ClaudeProviderUsage,
} from "./claude-envelope.js";
import type {
  ModelProcessObservation,
  ModelProcessObserver,
} from "./model-process-observability.js";

export interface OpenClaudeModelExecutionOptions {
  readonly artifactDirectory: string;
  readonly executablePath: string;
  readonly executableVersion: string;
  readonly workingDirectory: string;
  readonly sourceEvidenceGateway?: SourceEvidenceGateway;
  readonly maxTransientResumeAttempts?: number;
  readonly claudeConfigDirectory?: string;
  readonly processObserver?: ModelProcessObserver;
  readonly processHeartbeatIntervalMs?: number;
}

export interface OpenClaudeStructuredProcessOptions {
  readonly executablePath: string;
  readonly executableVersion: string;
  readonly workingDirectory: string;
  readonly maxTransientResumeAttempts?: number;
  readonly claudeConfigDirectory?: string;
  readonly processObserver?: ModelProcessObserver;
  readonly processHeartbeatIntervalMs?: number;
}

export interface ClaudeStructuredProcessRequest {
  readonly operationId?: string;
  readonly modelProfile: ModelProcessRequest["plan"]["modelProfile"];
  readonly prompt: string;
  readonly budget: {
    readonly maxWallTimeMs: number;
    readonly maxOutputBytes: number;
    readonly maxProviderCostUsd?: number;
  };
  readonly outputJsonSchema: object;
  readonly sourceEvidence?: AttemptSourceEvidence;
}

export interface ClaudeStructuredProcess {
  execute(request: ClaudeStructuredProcessRequest): Promise<ModelProcessResult>;
}

type NativeProcessResult = Extract<
  ModelProcessResult,
  {
    readonly kind: "exited" | "timed-out" | "output-limit-exceeded";
  }
>;

const inheritedEnvironment = [
  "HOME",
  "PATH",
  "LANG",
  "LC_ALL",
  "USER",
  "LOGNAME",
  "SHELL",
  "TMPDIR",
  "XDG_CONFIG_HOME",
  "XDG_CACHE_HOME",
  "XDG_DATA_HOME",
  "SSL_CERT_FILE",
  "SSL_CERT_DIR",
  "NODE_EXTRA_CA_CERTS",
  "CLAUDE_CODE_OAUTH_TOKEN",
] as const;

const claudeAuthStatusSchema = z.object({ loggedIn: z.boolean() });
const maximumCredentialFileBytes = 1024 * 1024;
const transientApiStatuses = new Set([408, 409, 425, 429, 500, 502, 503, 504]);

function isFileSystemError(
  error: unknown,
  code: string,
): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === code;
}

async function copyBoundedRegularFile(
  source: string,
  destination: string,
  required: boolean,
): Promise<boolean> {
  let metadata;
  try {
    metadata = await lstat(source);
  } catch (error: unknown) {
    if (!required && isFileSystemError(error, "ENOENT")) return false;
    throw error;
  }
  if (!metadata.isFile() || metadata.size > maximumCredentialFileBytes) {
    throw new Error("Claude credential source must be a bounded regular file");
  }
  await copyFile(source, destination);
  await chmod(destination, 0o600);
  return true;
}

async function openEphemeralClaudeConfig(
  sourceDirectory: string,
): Promise<string | undefined> {
  const directory = await mkdtemp(join(tmpdir(), "wordpress-harness-claude-"));
  await chmod(directory, 0o700);
  try {
    await copyBoundedRegularFile(
      join(sourceDirectory, ".credentials.json"),
      join(directory, ".credentials.json"),
      true,
    );
    await copyBoundedRegularFile(
      join(sourceDirectory, ".claude.json"),
      join(directory, ".claude.json"),
      false,
    );
    return directory;
  } catch {
    await rm(directory, { force: true, recursive: true });
    return undefined;
  }
}

function minimalEnvironment(
  overrides: Readonly<NodeJS.ProcessEnv> = {},
): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {
    CI: "1",
    NO_COLOR: "1",
    CLAUDE_CODE_SUBPROCESS_ENV_SCRUB: "1",
    ENABLE_CLAUDEAI_MCP_SERVERS: "false",
  };
  for (const name of inheritedEnvironment) {
    const value = process.env[name];
    if (value !== undefined) environment[name] = value;
  }
  if (environment.HOME === undefined || environment.PATH === undefined) {
    throw new Error("Claude process requires HOME and PATH");
  }
  return { ...environment, ...overrides };
}

function redactProviderCredential(text: string): string {
  const credential = process.env.CLAUDE_CODE_OAUTH_TOKEN;
  return credential === undefined || credential.length === 0
    ? text
    : text.replaceAll(credential, "[REDACTED]");
}

function signalProcessTree(
  child: ChildProcessWithoutNullStreams,
  signal: NodeJS.Signals,
): void {
  if (child.pid === undefined) return;
  try {
    if (process.platform === "win32") {
      child.kill(signal);
    } else {
      process.kill(-child.pid, signal);
    }
  } catch (error: unknown) {
    if (!(
      error instanceof Error &&
      "code" in error &&
      error.code === "ESRCH"
    )) {
      throw error;
    }
  }
}

function isUsageReportedTransientError(result: NativeProcessResult):
  | {
      readonly usage: ClaudeProviderUsage & {
        readonly estimatedCostUsd: number;
      };
    }
  | undefined {
  if (result.kind !== "exited" || result.exitCode === 0) return undefined;
  const envelope = decodeClaudeErrorEnvelope(result.stdout);
  if (
    envelope?.usage?.measurement !== "reported" ||
    envelope.usage.estimatedCostUsd === undefined
  ) {
    return undefined;
  }
  const numericStatus =
    typeof envelope.apiErrorStatus === "number"
      ? envelope.apiErrorStatus
      : typeof envelope.apiErrorStatus === "string" &&
          /^\d{3}$/u.test(envelope.apiErrorStatus)
        ? Number(envelope.apiErrorStatus)
        : undefined;
  if (numericStatus === undefined || !transientApiStatuses.has(numericStatus)) {
    return undefined;
  }
  return {
    usage: {
      ...envelope.usage,
      estimatedCostUsd: envelope.usage.estimatedCostUsd,
    },
  };
}

function aggregateClaudeUsage(
  usages: readonly ClaudeProviderUsage[],
): ClaudeProviderUsage | undefined {
  if (usages.length === 0) return undefined;
  const models = new Map<
    string,
    {
      canonicalModel: string;
      input: number;
      cacheCreation: number;
      cacheRead: number;
      output: number;
      total: number;
    }
  >();
  for (const usage of usages) {
    for (const model of usage.models) {
      const prior = models.get(model.id);
      if (
        prior !== undefined &&
        prior.canonicalModel !== model.canonicalModel
      ) {
        return undefined;
      }
      models.set(model.id, {
        canonicalModel: model.canonicalModel,
        input: (prior?.input ?? 0) + model.tokens.input,
        cacheCreation: (prior?.cacheCreation ?? 0) + model.tokens.cacheCreation,
        cacheRead: (prior?.cacheRead ?? 0) + model.tokens.cacheRead,
        output: (prior?.output ?? 0) + model.tokens.output,
        total: (prior?.total ?? 0) + model.tokens.total,
      });
    }
  }
  const allCostsReported = usages.every(
    (usage) => usage.estimatedCostUsd !== undefined,
  );
  const allDurationsReported = usages.every(
    (usage) => usage.providerDurationMs !== undefined,
  );
  return {
    measurement: usages.every((usage) => usage.measurement === "reported")
      ? "reported"
      : "partial",
    ...(allCostsReported
      ? {
          estimatedCostUsd: usages.reduce(
            (total, usage) => total + (usage.estimatedCostUsd ?? 0),
            0,
          ),
        }
      : {}),
    ...(allDurationsReported
      ? {
          providerDurationMs: usages.reduce(
            (total, usage) => total + (usage.providerDurationMs ?? 0),
            0,
          ),
        }
      : {}),
    modelTurns: usages.reduce((total, usage) => total + usage.modelTurns, 0),
    models: [...models.entries()]
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([id, model]) => ({
        id,
        canonicalModel: model.canonicalModel,
        tokens: {
          input: model.input,
          cacheCreation: model.cacheCreation,
          cacheRead: model.cacheRead,
          output: model.output,
          total: model.total,
        },
      })),
  };
}

function replaceClaudeEnvelopeUsage(
  stdout: string,
  usage: ClaudeProviderUsage,
): string | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return undefined;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return undefined;
  }
  const envelope = parsed as Record<string, unknown>;
  if (usage.estimatedCostUsd === undefined) {
    delete envelope.total_cost_usd;
  } else {
    envelope.total_cost_usd = usage.estimatedCostUsd;
  }
  if (usage.providerDurationMs === undefined) {
    delete envelope.duration_ms;
  } else {
    envelope.duration_ms = usage.providerDurationMs;
  }
  envelope.num_turns = usage.modelTurns;
  envelope.modelUsage = Object.fromEntries(
    usage.models.map((model) => [
      model.id,
      {
        canonicalModel: model.canonicalModel,
        inputTokens: model.tokens.input,
        outputTokens: model.tokens.output,
        cacheReadInputTokens: model.tokens.cacheRead,
        cacheCreationInputTokens: model.tokens.cacheCreation,
      },
    ]),
  );
  return JSON.stringify(envelope);
}

async function waitForResumeBackoff(
  resumeOrdinal: number,
  remainingTimeMs: number,
): Promise<boolean> {
  const delayMs = Math.min(250 * 2 ** resumeOrdinal, 2_000);
  if (remainingTimeMs <= delayMs) return false;
  await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
  return true;
}

class NativeClaudeStructuredProcess implements ClaudeStructuredProcess {
  readonly #executablePath;
  readonly #executableVersion;
  readonly #workingDirectory;
  readonly #maxTransientResumeAttempts;
  readonly #claudeConfigDirectory;
  readonly #processObserver;
  readonly #processHeartbeatIntervalMs;

  constructor(options: OpenClaudeStructuredProcessOptions) {
    if (!isAbsolute(options.executablePath)) {
      throw new Error("Claude executable path must be absolute");
    }
    if (!isAbsolute(options.workingDirectory)) {
      throw new Error("Claude working directory must be absolute");
    }
    const maxTransientResumeAttempts = options.maxTransientResumeAttempts ?? 0;
    if (
      !Number.isSafeInteger(maxTransientResumeAttempts) ||
      maxTransientResumeAttempts < 0 ||
      maxTransientResumeAttempts > 3
    ) {
      throw new Error(
        "Claude transient resume attempts must be an integer from 0 to 3",
      );
    }
    if (
      options.claudeConfigDirectory !== undefined &&
      !isAbsolute(options.claudeConfigDirectory)
    ) {
      throw new Error("Claude config directory must be absolute");
    }
    this.#executablePath = options.executablePath;
    this.#executableVersion = options.executableVersion;
    this.#workingDirectory = options.workingDirectory;
    this.#maxTransientResumeAttempts = maxTransientResumeAttempts;
    this.#claudeConfigDirectory = options.claudeConfigDirectory;
    const processHeartbeatIntervalMs =
      options.processHeartbeatIntervalMs ?? 25_000;
    if (
      !Number.isSafeInteger(processHeartbeatIntervalMs) ||
      processHeartbeatIntervalMs <= 0 ||
      processHeartbeatIntervalMs > 30_000
    ) {
      throw new Error(
        "Claude process heartbeat interval must be an integer from 1 to 30000",
      );
    }
    this.#processObserver = options.processObserver;
    this.#processHeartbeatIntervalMs = processHeartbeatIntervalMs;
  }

  async execute(
    request: ClaudeStructuredProcessRequest,
  ): Promise<ModelProcessResult> {
    if (request.modelProfile.executableVersion !== this.#executableVersion) {
      throw new Error("Attempt Plan Claude version does not match adapter");
    }
    const startedAt = performance.now();
    const operationId =
      request.operationId ?? `structured-model:${randomUUID()}`;
    const remainingTime = (): number =>
      Math.max(
        0,
        request.budget.maxWallTimeMs - (performance.now() - startedAt),
      );
    const version = await this.#run(
      ["--version"],
      undefined,
      Math.min(remainingTime(), 10_000),
      64 * 1024,
      undefined,
      { operationId, phase: "version-probe", segmentOrdinal: 0 },
    );
    if (
      version.kind !== "exited" ||
      version.exitCode !== 0 ||
      version.stdout.split(/\s/u, 1)[0] !== this.#executableVersion
    ) {
      const observed =
        version.kind === "exited"
          ? `${version.exitCode}:${version.stdout.trim().slice(0, 64)}`
          : version.kind;
      throw new Error(`Claude executable version probe failed (${observed})`);
    }
    if (remainingTime() === 0) {
      return { kind: "timed-out", stderr: "" };
    }
    const auth = await this.#run(
      ["auth", "status"],
      undefined,
      Math.min(remainingTime(), 10_000),
      64 * 1024,
      undefined,
      { operationId, phase: "auth-probe", segmentOrdinal: 1 },
    );
    if (auth.kind === "timed-out") return auth;
    if (auth.kind === "output-limit-exceeded") {
      throw new Error("Claude auth status probe exceeded its output limit");
    }
    if (auth.exitCode !== 0) {
      return {
        kind: "auth-required",
        reason: "provider-session-unavailable",
      };
    }
    let authStatus: z.infer<typeof claudeAuthStatusSchema>;
    try {
      const parsed: unknown = JSON.parse(auth.stdout);
      authStatus = claudeAuthStatusSchema.parse(parsed);
    } catch {
      throw new Error("Claude auth status probe returned invalid output");
    }
    if (!authStatus.loggedIn) {
      return {
        kind: "auth-required",
        reason: "provider-session-unavailable",
      };
    }
    if (remainingTime() === 0) {
      return { kind: "timed-out", stderr: "" };
    }

    let inferenceSegmentOrdinal = 2;
    let sourceBridge: ClaudeSourceEvidenceBridge | undefined;
    if (request.sourceEvidence !== undefined) {
      try {
        sourceBridge = await openClaudeSourceEvidenceBridge(
          request.sourceEvidence,
          {
            observe: (event) =>
              this.#observe({
                ...event,
                schemaVersion: 1,
                operationId,
                phase: "inference",
                segmentOrdinal: inferenceSegmentOrdinal,
                occurredAt: new Date().toISOString(),
              }),
          },
        );
      } catch {
        return {
          kind: "policy-denied",
          reason: "source-evidence-bridge-unavailable",
        };
      }
    }
    if (remainingTime() === 0) {
      await sourceBridge?.close();
      return { kind: "timed-out", stderr: "" };
    }

    const sourceConfigDirectory =
      this.#claudeConfigDirectory ??
      process.env.CLAUDE_CONFIG_DIR ??
      (process.env.HOME === undefined
        ? undefined
        : join(process.env.HOME, ".claude"));
    const resumeRequested =
      this.#maxTransientResumeAttempts > 0 &&
      request.sourceEvidence?.checkpoint !== undefined &&
      request.budget.maxProviderCostUsd !== undefined &&
      sourceConfigDirectory !== undefined &&
      isAbsolute(sourceConfigDirectory);
    const ephemeralConfigDirectory = resumeRequested
      ? await openEphemeralClaudeConfig(sourceConfigDirectory)
      : undefined;
    const sessionId =
      ephemeralConfigDirectory === undefined ? undefined : randomUUID();
    const processEnvironment =
      ephemeralConfigDirectory === undefined
        ? undefined
        : { CLAUDE_CONFIG_DIR: ephemeralConfigDirectory };
    const baseArgs = (maxProviderCostUsd: number | undefined): string[] => [
      "-p",
      "--model",
      request.modelProfile.model,
      "--effort",
      request.modelProfile.effort,
      ...(maxProviderCostUsd === undefined
        ? []
        : ["--max-budget-usd", String(maxProviderCostUsd)]),
      "--restricted",
      "--strict-mcp-config",
      "--disable-slash-commands",
      "--tools",
      "",
      ...(sourceBridge === undefined
        ? ["--safe-mode"]
        : [
            "--mcp-config",
            sourceBridge.mcpConfigPath,
            "--permission-mode",
            "dontAsk",
            "--allowedTools",
            sourceBridge.allowedToolNames.join(","),
          ]),
      "--no-chrome",
      "--prompt-suggestions",
      "false",
      "--output-format",
      "json",
      "--json-schema",
      JSON.stringify(request.outputJsonSchema),
    ];
    try {
      let resumeOrdinal = 0;
      let remainingProviderCostUsd = request.budget.maxProviderCostUsd;
      const priorUsage: ClaudeProviderUsage[] = [];
      while (true) {
        inferenceSegmentOrdinal = resumeOrdinal + 2;
        const sessionArgs =
          sessionId === undefined
            ? ["--no-session-persistence"]
            : resumeOrdinal === 0
              ? ["--session-id", sessionId]
              : ["--resume", sessionId];
        const result = await this.#run(
          [...baseArgs(remainingProviderCostUsd), ...sessionArgs],
          resumeOrdinal === 0
            ? request.prompt
            : "Continue the same Attempt from its durable checkpoints and complete the required terminal JSON.",
          remainingTime(),
          request.budget.maxOutputBytes,
          processEnvironment,
          {
            operationId,
            phase: "inference",
            segmentOrdinal: resumeOrdinal + 2,
          },
        );
        if (
          sourceBridge !== undefined &&
          result.kind === "exited" &&
          !sourceBridge.observedConnection()
        ) {
          return {
            kind: "policy-denied",
            reason: "source-evidence-bridge-not-connected",
          };
        }
        if (result.kind === "exited" && result.exitCode === 0) {
          if (priorUsage.length === 0) return result;
          const completed = decodeClaudeEnvelope(
            result.stdout,
            request.modelProfile.model,
          );
          if (completed.kind !== "accepted") return result;
          const aggregate = aggregateClaudeUsage([
            ...priorUsage,
            completed.usage,
          ]);
          const stdout =
            aggregate === undefined
              ? undefined
              : replaceClaudeEnvelopeUsage(result.stdout, aggregate);
          return stdout === undefined ? result : { ...result, stdout };
        }
        const transient = isUsageReportedTransientError(result);
        if (
          transient === undefined ||
          sessionId === undefined ||
          resumeOrdinal >= this.#maxTransientResumeAttempts ||
          remainingProviderCostUsd === undefined
        ) {
          return result;
        }
        remainingProviderCostUsd -= transient.usage.estimatedCostUsd;
        priorUsage.push(transient.usage);
        if (remainingProviderCostUsd <= 0 || remainingTime() <= 0) {
          return result;
        }
        resumeOrdinal += 1;
        if (!(await waitForResumeBackoff(resumeOrdinal, remainingTime()))) {
          return result;
        }
      }
    } finally {
      await Promise.all([
        sourceBridge?.close(),
        ephemeralConfigDirectory === undefined
          ? Promise.resolve()
          : rm(ephemeralConfigDirectory, { force: true, recursive: true }),
      ]);
    }
  }

  #run(
    args: readonly string[],
    stdin: string | undefined,
    timeoutMs: number,
    maxOutputBytes: number,
    environmentOverrides?: Readonly<NodeJS.ProcessEnv>,
    observation?: {
      readonly operationId: string;
      readonly phase: ModelProcessObservation["phase"];
      readonly segmentOrdinal: number;
    },
  ): Promise<NativeProcessResult> {
    return new Promise((resolve, reject) => {
      const processStartedAt = performance.now();
      if (observation !== undefined) {
        this.#observe({
          kind: "model-process-started",
          schemaVersion: 1,
          ...observation,
          occurredAt: new Date().toISOString(),
        });
      }
      const child = spawn(this.#executablePath, args, {
        cwd: this.#workingDirectory,
        detached: process.platform !== "win32",
        env: minimalEnvironment(environmentOverrides),
        stdio: ["pipe", "pipe", "pipe"],
      });
      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];
      let stdoutBytes = 0;
      let stderrBytes = 0;
      let terminalKind: "timed-out" | "output-limit-exceeded" | undefined;
      let killTimer: NodeJS.Timeout | undefined;
      const heartbeat =
        observation === undefined
          ? undefined
          : setInterval(() => {
              this.#observe({
                kind: "model-process-heartbeat",
                schemaVersion: 1,
                ...observation,
                occurredAt: new Date().toISOString(),
                elapsedMs: Math.ceil(performance.now() - processStartedAt),
              });
            }, this.#processHeartbeatIntervalMs);
      heartbeat?.unref();

      const terminate = (kind: "timed-out" | "output-limit-exceeded"): void => {
        if (terminalKind !== undefined) return;
        terminalKind = kind;
        signalProcessTree(child, "SIGTERM");
        killTimer = setTimeout(() => {
          signalProcessTree(child, "SIGKILL");
        }, 2_000);
        killTimer.unref();
      };
      const timeout = setTimeout(() => terminate("timed-out"), timeoutMs);
      timeout.unref();

      child.stdout.on("data", (chunk: Buffer) => {
        stdoutBytes += chunk.byteLength;
        if (stdoutBytes > maxOutputBytes) {
          terminate("output-limit-exceeded");
          return;
        }
        stdout.push(chunk);
      });
      child.stderr.on("data", (chunk: Buffer) => {
        const remaining = 64 * 1024 - stderrBytes;
        if (remaining <= 0) return;
        const kept = chunk.subarray(0, remaining);
        stderr.push(kept);
        stderrBytes += kept.byteLength;
      });
      child.once("error", (error) => {
        clearTimeout(timeout);
        if (heartbeat !== undefined) clearInterval(heartbeat);
        if (killTimer !== undefined) clearTimeout(killTimer);
        if (observation !== undefined) {
          this.#observe({
            kind: "model-process-failed",
            schemaVersion: 1,
            ...observation,
            occurredAt: new Date().toISOString(),
            elapsedMs: Math.ceil(performance.now() - processStartedAt),
            reason: "spawn-failed",
          });
        }
        reject(error);
      });
      child.stdin.once("error", (error: NodeJS.ErrnoException) => {
        if (error.code === "EPIPE") return;
        clearTimeout(timeout);
        if (heartbeat !== undefined) clearInterval(heartbeat);
        if (killTimer !== undefined) clearTimeout(killTimer);
        signalProcessTree(child, "SIGKILL");
        if (observation !== undefined) {
          this.#observe({
            kind: "model-process-failed",
            schemaVersion: 1,
            ...observation,
            occurredAt: new Date().toISOString(),
            elapsedMs: Math.ceil(performance.now() - processStartedAt),
            reason: "stdin-failed",
          });
        }
        reject(error);
      });
      child.once("close", (exitCode) => {
        clearTimeout(timeout);
        if (heartbeat !== undefined) clearInterval(heartbeat);
        const stderrText = redactProviderCredential(
          Buffer.concat(stderr).toString("utf8"),
        );
        if (terminalKind !== undefined) {
          signalProcessTree(child, "SIGKILL");
          if (killTimer !== undefined) clearTimeout(killTimer);
          const result = { kind: terminalKind, stderr: stderrText } as const;
          if (observation !== undefined) {
            this.#observe({
              kind: "model-process-completed",
              schemaVersion: 1,
              ...observation,
              occurredAt: new Date().toISOString(),
              elapsedMs: Math.ceil(performance.now() - processStartedAt),
              result,
            });
          }
          resolve(result);
          return;
        }
        if (killTimer !== undefined) clearTimeout(killTimer);
        const result = {
          kind: "exited",
          exitCode: exitCode ?? -1,
          stdout: redactProviderCredential(
            Buffer.concat(stdout).toString("utf8"),
          ),
          stderr: stderrText,
        } as const;
        if (observation !== undefined) {
          this.#observe({
            kind: "model-process-completed",
            schemaVersion: 1,
            ...observation,
            occurredAt: new Date().toISOString(),
            elapsedMs: Math.ceil(performance.now() - processStartedAt),
            result,
          });
        }
        resolve(result);
      });

      if (stdin === undefined) {
        child.stdin.end();
      } else {
        child.stdin.end(stdin, "utf8");
      }
    });
  }

  #observe(event: ModelProcessObservation): void {
    try {
      this.#processObserver?.observe(event);
    } catch {
      // Observability must not change provider execution.
    }
  }
}

export function openClaudeModelExecution(
  options: OpenClaudeModelExecutionOptions,
): ModelExecution {
  const process = openClaudeStructuredProcess(options);
  return openModelExecution({
    artifactDirectory: options.artifactDirectory,
    process: {
      execute: (request: ModelProcessRequest) =>
        process.execute({
          operationId: request.plan.attemptId,
          modelProfile: request.plan.modelProfile,
          prompt: request.plan.prompt,
          budget: request.plan.budget,
          outputJsonSchema: request.outputJsonSchema,
          ...(request.sourceEvidence === undefined
            ? {}
            : { sourceEvidence: request.sourceEvidence }),
        }),
    },
    ...(options.sourceEvidenceGateway === undefined
      ? {}
      : { sourceEvidenceGateway: options.sourceEvidenceGateway }),
  });
}

export function openClaudeStructuredProcess(
  options: OpenClaudeStructuredProcessOptions,
): ClaudeStructuredProcess {
  return new NativeClaudeStructuredProcess(options);
}

export function openClaudeStructuredModelExecutionFromProcess(
  process: ClaudeStructuredProcess,
): StructuredModelExecution {
  return {
    run: async (request) => {
      const modelProfile = attemptPlanSchema.shape.modelProfile.safeParse(
        request.modelProfile,
      );
      if (!modelProfile.success) {
        return {
          status: "policy-denied",
          reason: "transport-profile-incompatible",
        };
      }
      let result: ModelProcessResult;
      try {
        result = await process.execute({
          ...request,
          modelProfile: modelProfile.data,
        });
      } catch (error: unknown) {
        return {
          status: "provider-failed",
          reason:
            error instanceof Error ? error.message : "Provider process failed",
        };
      }
      if (result.kind === "auth-required") {
        return { status: "auth-required", reason: result.reason };
      }
      if (result.kind === "policy-denied") {
        return { status: "policy-denied", reason: result.reason };
      }
      if (result.kind === "timed-out") {
        return { status: "budget-exhausted", reason: "wall-time-exceeded" };
      }
      if (result.kind === "output-limit-exceeded") {
        return { status: "budget-exhausted", reason: "output-limit-exceeded" };
      }
      if (result.exitCode !== 0) {
        return {
          status: "provider-failed",
          reason: `provider-exit-${result.exitCode}`,
        };
      }
      const envelope = decodeClaudeEnvelope(
        result.stdout,
        request.modelProfile.model,
      );
      if (envelope.kind === "invalid-envelope") {
        return {
          status: "invalid-output",
          reason: "invalid-provider-envelope",
        };
      }
      if (envelope.kind === "policy-denied") {
        return { status: "policy-denied", reason: envelope.reason };
      }
      return { status: "completed", output: envelope.output };
    },
  };
}

export function openClaudeStructuredModelExecution(
  options: OpenClaudeStructuredProcessOptions,
): StructuredModelExecution {
  return openClaudeStructuredModelExecutionFromProcess(
    openClaudeStructuredProcess(options),
  );
}
