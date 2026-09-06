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
import {
  runNativeModelProcess,
  type NativeModelProcessResult,
} from "./native-model-process.js";

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

export interface OpenGlmModelExecutionOptions {
  readonly artifactDirectory: string;
  readonly executablePath: string;
  readonly executableVersion: string;
  readonly workingDirectory: string;
  readonly tokenFilePath: string;
  readonly sourceEvidenceGateway?: SourceEvidenceGateway;
  readonly processObserver?: ModelProcessObserver;
  readonly processHeartbeatIntervalMs?: number;
}

export interface OpenGlmStructuredProcessOptions {
  readonly executablePath: string;
  readonly executableVersion: string;
  readonly workingDirectory: string;
  readonly tokenFilePath: string;
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
const zaiAnthropicBaseUrl = "https://api.z.ai/api/anthropic";
const zaiPrimaryModel = "glm-5.1";
const zaiAuxiliaryModel = "glm-4.5-air";

type ClaudeCompatibleProvider =
  | { readonly kind: "anthropic" }
  | { readonly kind: "zai"; readonly tokenFilePath: string };

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

async function readBoundedCredentialFile(path: string): Promise<string> {
  const metadata = await lstat(path);
  if (
    !metadata.isFile() ||
    metadata.size <= 0 ||
    metadata.size > maximumCredentialFileBytes ||
    (metadata.mode & 0o777) !== 0o600
  ) {
    throw new Error(
      "Provider credential must be a non-empty 0600 regular file",
    );
  }
  const credential = (await readFile(path, "utf8")).trim();
  if (credential.length === 0) {
    throw new Error("Provider credential must not be empty");
  }
  return credential;
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
  const configured = { ...environment, ...overrides };
  for (const [name, value] of Object.entries(configured)) {
    if (value === undefined) delete configured[name];
  }
  return configured;
}

function redactProviderCredential(
  text: string,
  additionalCredentials: readonly string[] = [],
): string {
  const credentials = [
    process.env.CLAUDE_CODE_OAUTH_TOKEN,
    ...additionalCredentials,
  ].filter(
    (credential): credential is string =>
      credential !== undefined && credential.length > 0,
  );
  return credentials.reduce(
    (redacted, credential) => redacted.replaceAll(credential, "[REDACTED]"),
    text,
  );
}

function attachGlmStructuredOutput(stdout: string): string | undefined {
  try {
    const parsed: unknown = JSON.parse(stdout);
    const envelope = z
      .object({
        type: z.literal("result"),
        is_error: z.literal(false),
        terminal_reason: z.literal("completed"),
        result: z.string(),
      })
      .parse(parsed);
    const structuredOutput: unknown = JSON.parse(envelope.result);
    return JSON.stringify({
      ...(parsed as Record<string, unknown>),
      structured_output: structuredOutput,
    });
  } catch {
    return undefined;
  }
}

function glmTerminalPrompt(prompt: string, outputJsonSchema: object): string {
  return `${prompt}\n\nReturn exactly one JSON value matching this schema. Do not use Markdown fences or add prose.\n${JSON.stringify(outputJsonSchema)}`;
}

function isUsageReportedTransientError(result: NativeModelProcessResult):
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
  readonly #provider;

  constructor(
    options: OpenClaudeStructuredProcessOptions,
    provider: ClaudeCompatibleProvider = { kind: "anthropic" },
  ) {
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
    this.#provider = provider;
  }

  async execute(
    request: ClaudeStructuredProcessRequest,
  ): Promise<ModelProcessResult> {
    const expectedProvider =
      this.#provider.kind === "anthropic" ? "anthropic" : "zai";
    if (
      request.modelProfile.provider !== expectedProvider ||
      request.modelProfile.transport !== "claude-code-process" ||
      (this.#provider.kind === "zai" &&
        (request.modelProfile.model !== zaiPrimaryModel ||
          request.modelProfile.effort !== "max"))
    ) {
      return {
        kind: "policy-denied",
        reason: "transport-profile-incompatible",
      };
    }
    if (request.modelProfile.executableVersion !== this.#executableVersion) {
      throw new Error("Attempt Plan Claude version does not match adapter");
    }
    let providerCredential: string | undefined;
    if (this.#provider.kind === "zai") {
      try {
        providerCredential = await readBoundedCredentialFile(
          this.#provider.tokenFilePath,
        );
      } catch {
        return {
          kind: "auth-required",
          reason: "provider-session-unavailable",
        };
      }
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
      providerCredential === undefined ? [] : [providerCredential],
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
    if (this.#provider.kind === "anthropic") {
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
      this.#provider.kind === "anthropic" &&
      this.#maxTransientResumeAttempts > 0 &&
      request.sourceEvidence?.checkpoint !== undefined &&
      request.budget.maxProviderCostUsd !== undefined &&
      sourceConfigDirectory !== undefined &&
      isAbsolute(sourceConfigDirectory);
    const ephemeralConfigDirectory = resumeRequested
      ? await openEphemeralClaudeConfig(sourceConfigDirectory)
      : undefined;
    const isolatedProviderRoot =
      this.#provider.kind === "zai"
        ? await mkdtemp(join(tmpdir(), "wordpress-harness-glm-"))
        : undefined;
    const isolatedProviderHome =
      isolatedProviderRoot === undefined
        ? undefined
        : join(isolatedProviderRoot, "home");
    const isolatedProviderConfigDirectory =
      isolatedProviderRoot === undefined
        ? undefined
        : join(isolatedProviderRoot, "claude");
    if (
      isolatedProviderRoot !== undefined &&
      isolatedProviderHome !== undefined &&
      isolatedProviderConfigDirectory !== undefined
    ) {
      await chmod(isolatedProviderRoot, 0o700);
      await Promise.all([
        mkdir(isolatedProviderHome, { mode: 0o700 }),
        mkdir(isolatedProviderConfigDirectory, { mode: 0o700 }),
      ]);
    }
    const sessionId =
      ephemeralConfigDirectory === undefined ? undefined : randomUUID();
    const providerEnvironment =
      this.#provider.kind === "zai" && providerCredential !== undefined
        ? {
            ANTHROPIC_BASE_URL: zaiAnthropicBaseUrl,
            ANTHROPIC_AUTH_TOKEN: providerCredential,
            ANTHROPIC_DEFAULT_OPUS_MODEL: request.modelProfile.model,
            ANTHROPIC_DEFAULT_SONNET_MODEL: request.modelProfile.model,
            ANTHROPIC_DEFAULT_HAIKU_MODEL: zaiAuxiliaryModel,
            API_TIMEOUT_MS: "3000000",
            CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
          }
        : {};
    const processEnvironment = {
      ...providerEnvironment,
      ...(isolatedProviderConfigDirectory === undefined ||
      isolatedProviderHome === undefined
        ? ephemeralConfigDirectory === undefined
          ? {}
          : { CLAUDE_CONFIG_DIR: ephemeralConfigDirectory }
        : {
            CLAUDE_CONFIG_DIR: isolatedProviderConfigDirectory,
            CLAUDE_CODE_OAUTH_TOKEN: undefined,
            HOME: isolatedProviderHome,
            USERPROFILE: isolatedProviderHome,
            APPDATA: join(isolatedProviderHome, "AppData", "Roaming"),
            LOCALAPPDATA: join(isolatedProviderHome, "AppData", "Local"),
            XDG_CONFIG_HOME: join(isolatedProviderHome, ".config"),
            XDG_CACHE_HOME: join(isolatedProviderHome, ".cache"),
            XDG_DATA_HOME: join(isolatedProviderHome, ".local", "share"),
          }),
    };
    const baseArgs = (maxProviderCostUsd: number | undefined): string[] => [
      "-p",
      "--model",
      request.modelProfile.model,
      "--effort",
      request.modelProfile.effort,
      ...(maxProviderCostUsd === undefined || this.#provider.kind === "zai"
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
      ...(this.#provider.kind === "anthropic"
        ? ["--json-schema", JSON.stringify(request.outputJsonSchema)]
        : []),
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
            ? this.#provider.kind === "zai"
              ? glmTerminalPrompt(request.prompt, request.outputJsonSchema)
              : request.prompt
            : "Continue the same Attempt from its durable checkpoints and complete the required terminal JSON.",
          remainingTime(),
          request.budget.maxOutputBytes,
          processEnvironment,
          {
            operationId,
            phase: "inference",
            segmentOrdinal: resumeOrdinal + 2,
          },
          providerCredential === undefined ? [] : [providerCredential],
          sourceBridge?.redact,
        );
        let normalizedResult: NativeModelProcessResult =
          this.#provider.kind === "zai" &&
          result.kind === "exited" &&
          result.exitCode === 0
            ? {
                ...result,
                stdout:
                  attachGlmStructuredOutput(result.stdout) ?? result.stdout,
              }
            : result;
        if (
          this.#provider.kind === "zai" &&
          normalizedResult.kind === "exited"
        ) {
          const providerError = decodeClaudeErrorEnvelope(
            normalizedResult.stdout,
          );
          if (
            providerError !== undefined &&
            (providerError.apiErrorStatus === 401 ||
              /(?:not logged in|unauthorized|invalid api key|authentication required)/iu.test(
                providerError.message,
              ))
          ) {
            return {
              kind: "auth-required",
              reason: "provider-session-unavailable",
            };
          }
          if (providerError !== undefined && normalizedResult.exitCode === 0) {
            normalizedResult = { ...normalizedResult, exitCode: 1 };
          }
        }
        if (
          sourceBridge !== undefined &&
          normalizedResult.kind === "exited" &&
          normalizedResult.exitCode === 0 &&
          !sourceBridge.observedConnection()
        ) {
          return {
            kind: "policy-denied",
            reason: "source-evidence-bridge-not-connected",
          };
        }
        if (
          normalizedResult.kind === "exited" &&
          normalizedResult.exitCode === 0
        ) {
          if (priorUsage.length === 0) return normalizedResult;
          const completed = decodeClaudeEnvelope(
            normalizedResult.stdout,
            request.modelProfile.model,
          );
          if (completed.kind !== "accepted") return normalizedResult;
          const aggregate = aggregateClaudeUsage([
            ...priorUsage,
            completed.usage,
          ]);
          const stdout =
            aggregate === undefined
              ? undefined
              : replaceClaudeEnvelopeUsage(normalizedResult.stdout, aggregate);
          return stdout === undefined
            ? normalizedResult
            : { ...normalizedResult, stdout };
        }
        const transient = isUsageReportedTransientError(normalizedResult);
        if (
          transient === undefined ||
          sessionId === undefined ||
          resumeOrdinal >= this.#maxTransientResumeAttempts ||
          remainingProviderCostUsd === undefined
        ) {
          return normalizedResult;
        }
        remainingProviderCostUsd -= transient.usage.estimatedCostUsd;
        priorUsage.push(transient.usage);
        if (remainingProviderCostUsd <= 0 || remainingTime() <= 0) {
          return normalizedResult;
        }
        resumeOrdinal += 1;
        if (!(await waitForResumeBackoff(resumeOrdinal, remainingTime()))) {
          return normalizedResult;
        }
      }
    } finally {
      await Promise.all([
        sourceBridge?.close(),
        ephemeralConfigDirectory === undefined
          ? Promise.resolve()
          : rm(ephemeralConfigDirectory, { force: true, recursive: true }),
        isolatedProviderRoot === undefined
          ? Promise.resolve()
          : rm(isolatedProviderRoot, {
              force: true,
              recursive: true,
            }),
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
    credentialsToRedact: readonly string[] = [],
    additionalRedact?: (text: string) => string,
  ): Promise<NativeModelProcessResult> {
    return runNativeModelProcess({
      executablePath: this.#executablePath,
      args,
      workingDirectory: this.#workingDirectory,
      environment: minimalEnvironment(environmentOverrides),
      ...(stdin === undefined ? {} : { stdin }),
      timeoutMs,
      maxOutputBytes,
      redact: (text) => {
        const credentialRedacted = redactProviderCredential(
          text,
          credentialsToRedact,
        );
        return additionalRedact?.(credentialRedacted) ?? credentialRedacted;
      },
      ...(this.#processObserver === undefined
        ? {}
        : { observer: this.#processObserver }),
      heartbeatIntervalMs: this.#processHeartbeatIntervalMs,
      ...(observation === undefined ? {} : { observation }),
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

export function openGlmModelExecution(
  options: OpenGlmModelExecutionOptions,
): ModelExecution {
  const process = openGlmStructuredProcess(options);
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

export function openGlmStructuredProcess(
  options: OpenGlmStructuredProcessOptions,
): ClaudeStructuredProcess {
  return new NativeClaudeStructuredProcess(options, {
    kind: "zai",
    tokenFilePath: options.tokenFilePath,
  });
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
