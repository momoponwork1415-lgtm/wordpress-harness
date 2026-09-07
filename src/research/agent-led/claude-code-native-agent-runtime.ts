import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { z } from "zod";

import {
  failedNativeRunReceipt,
  GvisorAgentSandbox,
  type GvisorAgentRuntimeOptions,
} from "./gvisor-agent-sandbox.js";
import {
  nativeRunReceiptSchema,
  researchReportSchema,
  validationReportSchema,
  validationRunReceiptSchema,
  type AgentCheckpointRef,
  type NativeAgentRuntime,
  type NativeAgentReceipt,
  type SealedAgentRun,
} from "./contracts.js";

const modelUsageSchema = z.record(
  z.string(),
  z.object({
    canonicalModel: z.string().min(1),
    inputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
    cacheReadInputTokens: z.number().int().nonnegative(),
    cacheCreationInputTokens: z.number().int().nonnegative(),
  }),
);
const claudeResultSchema = z.object({
  type: z.literal("result"),
  subtype: z.literal("success"),
  is_error: z.literal(false),
  terminal_reason: z.literal("completed"),
  structured_output: z.unknown(),
  total_cost_usd: z.number().finite().nonnegative().optional(),
  duration_ms: z.number().int().nonnegative(),
  num_turns: z.number().int().nonnegative(),
  permission_denials: z.array(z.unknown()),
  session_id: z.uuid(),
  usage: z.object({
    server_tool_use: z.object({
      web_search_requests: z.number().int().nonnegative(),
      web_fetch_requests: z.number().int().nonnegative(),
    }),
  }),
  subagent_stats: z
    .object({
      spawned: z.number().int().nonnegative(),
    })
    .optional(),
  modelUsage: modelUsageSchema,
});
const claudeErrorResultSchema = z.object({
  type: z.literal("result"),
  subtype: z.string().min(1),
  is_error: z.literal(true),
  terminal_reason: z.string().nullable(),
  total_cost_usd: z.number().finite().nonnegative().optional(),
  duration_ms: z.number().int().nonnegative(),
  num_turns: z.number().int().nonnegative(),
  permission_denials: z.array(z.unknown()),
  session_id: z.uuid(),
  usage: z.object({
    server_tool_use: z.object({
      web_search_requests: z.number().int().nonnegative(),
      web_fetch_requests: z.number().int().nonnegative(),
    }),
  }),
  modelUsage: modelUsageSchema,
});

const glmResultSchema = z.object({
  type: z.literal("result"),
  subtype: z.literal("success"),
  is_error: z.literal(false),
  terminal_reason: z.literal("completed"),
  result: z.string().min(1),
  total_cost_usd: z.number().finite().nonnegative().optional(),
  duration_ms: z.number().int().nonnegative(),
  num_turns: z.number().int().nonnegative(),
  permission_denials: z.array(z.unknown()),
  session_id: z.uuid(),
  usage: z.object({
    server_tool_use: z.object({
      web_search_requests: z.number().int().nonnegative(),
      web_fetch_requests: z.number().int().nonnegative(),
    }),
  }),
  subagent_stats: z
    .object({
      spawned: z.number().int().nonnegative(),
    })
    .optional(),
  modelUsage: modelUsageSchema,
});
const glmSettingsSchema = z.strictObject({
  env: z.strictObject({
    ANTHROPIC_AUTH_TOKEN: z.string().min(1).regex(/^\S+$/),
    ANTHROPIC_BASE_URL: z.literal("https://api.z.ai/api/anthropic"),
    ANTHROPIC_DEFAULT_OPUS_MODEL: z.literal("glm-5.3"),
    ANTHROPIC_DEFAULT_SONNET_MODEL: z.literal("glm-5.3"),
    ANTHROPIC_DEFAULT_HAIKU_MODEL: z.literal("glm-4.5-air"),
    API_TIMEOUT_MS: z.literal("3000000"),
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: z.literal("1"),
  }),
});

export interface OpenClaudeCodeNativeAgentRuntimeOptions extends GvisorAgentRuntimeOptions {}
export interface OpenGlmNativeAgentRuntimeOptions extends GvisorAgentRuntimeOptions {}

const claudeCodeTransportEligibility = {
  schemaVersion: 1,
  imageDigest:
    "sha256:b8bb6b8f8865dbabb70f03bb71639792fe1f5c4301a8cd874d212435e5cda355",
  executableVersion: "2.1.220",
  probedAt: "2026-09-07T05:34:00.000Z",
  root: {
    providerRead: "denied",
    targetWrite: "denied",
    scratchWrite: "allowed",
    shell: "unavailable",
    web: "unavailable",
  },
  subagent: {
    providerRead: "denied",
    targetWrite: "denied",
    shell: "unavailable",
    web: "unavailable",
  },
} as const;

function imageDigest(reference: string): string {
  const separator = reference.lastIndexOf("@sha256:");
  return separator === -1 ? reference : reference.slice(separator + 1);
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return undefined;
  }
}

function claudeJsonSchema(schema: z.ZodType): string {
  const providerSchema = { ...z.toJSONSchema(schema) };
  delete providerSchema.$schema;
  return JSON.stringify(providerSchema);
}

function terminalJson(value: string): unknown | undefined {
  const trimmed = value.trim();
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    const offsets = [trimmed.indexOf("{"), trimmed.indexOf("[")].filter(
      (offset) => offset > 0,
    );
    if (offsets.length === 0) return undefined;
    try {
      return JSON.parse(trimmed.slice(Math.min(...offsets))) as unknown;
    } catch {
      return undefined;
    }
  }
}

function resultEnvelope(
  stdout: string,
  provider: "anthropic" | "zai",
): z.infer<typeof claudeResultSchema> | undefined {
  const parsed = parseJson(stdout);
  if (provider === "anthropic") {
    const decoded = claudeResultSchema.safeParse(parsed);
    return decoded.success ? decoded.data : undefined;
  }
  const decoded = glmResultSchema.safeParse(parsed);
  if (!decoded.success) return undefined;
  const structuredOutput = terminalJson(decoded.data.result);
  if (structuredOutput === undefined) return undefined;
  const normalized = claudeResultSchema.safeParse({
    ...decoded.data,
    structured_output: structuredOutput,
  });
  return normalized.success ? normalized.data : undefined;
}

function glmPrompt(prompt: string, schema: z.ZodType): string {
  return `${prompt}\n\nReturn exactly one JSON value matching this schema. Do not use Markdown fences or add prose.\n${claudeJsonSchema(schema)}`;
}

function wallTimeMs(
  providerDurationMs: number,
  startedAt: Date,
  completedAt: Date,
): number {
  return Math.max(
    providerDurationMs,
    0,
    completedAt.getTime() - startedAt.getTime(),
  );
}

function errorReceipt(
  run: SealedAgentRun,
  envelope: z.infer<typeof claudeErrorResultSchema>,
  startedAt: Date,
  completedAt: Date,
  checkpoint: AgentCheckpointRef | undefined,
): NativeAgentReceipt {
  const usedModels = Object.values(envelope.modelUsage);
  const violatedPolicy =
    envelope.permission_denials.length > 0 ||
    envelope.usage.server_tool_use.web_search_requests !== 0 ||
    envelope.usage.server_tool_use.web_fetch_requests !== 0;
  const terminal = violatedPolicy
    ? ("policy-denied" as const)
    : envelope.terminal_reason === "budget_exhausted" ||
        envelope.subtype === "error_max_budget_usd"
      ? ("budget-exhausted" as const)
      : ("provider-failed" as const);
  const summary = violatedPolicy
    ? "Claude Code violated the sealed tool policy."
    : terminal === "budget-exhausted"
      ? "Claude Code exhausted the provider cost budget."
      : "Claude Code exited without a completed result.";
  const receipt = {
    schemaVersion: 1,
    runId: run.runId,
    runtimeProfileDigest: run.agentRuntimeProfile.digest,
    terminal,
    startedAt: startedAt.toISOString(),
    completedAt: completedAt.toISOString(),
    usage: {
      wallTimeMs: wallTimeMs(envelope.duration_ms, startedAt, completedAt),
      inputTokens: usedModels.reduce(
        (total, usage) =>
          total +
          usage.inputTokens +
          usage.cacheReadInputTokens +
          usage.cacheCreationInputTokens,
        0,
      ),
      outputTokens: usedModels.reduce(
        (total, usage) => total + usage.outputTokens,
        0,
      ),
      ...(envelope.total_cost_usd === undefined
        ? {}
        : { estimatedCostUsd: envelope.total_cost_usd }),
    },
    activity: { subagents: null, tools: null },
    isolation: {
      backend: "gvisor" as const,
      runtime: "runsc" as const,
      fallbackUsed: false as const,
    },
    ...(run.kind === "sealed-native-research-run" && checkpoint !== undefined
      ? { checkpoint }
      : {}),
    failure: { summary },
  };
  return run.kind === "sealed-native-research-run"
    ? nativeRunReceiptSchema.parse(receipt)
    : validationRunReceiptSchema.parse(receipt);
}

class ClaudeCodeNativeAgentRuntime implements NativeAgentRuntime {
  readonly #sandbox: GvisorAgentSandbox;
  readonly #transportAdmitted: boolean;
  readonly #provider: "anthropic" | "zai";
  readonly #providerConfigDirectory: string;

  constructor(
    options: OpenClaudeCodeNativeAgentRuntimeOptions,
    provider: "anthropic" | "zai",
  ) {
    this.#sandbox = new GvisorAgentSandbox(options);
    this.#provider = provider;
    this.#providerConfigDirectory = options.providerConfigDirectory;
    this.#transportAdmitted =
      imageDigest(options.image) === claudeCodeTransportEligibility.imageDigest;
  }

  async execute(run: SealedAgentRun): Promise<NativeAgentReceipt> {
    const glm = this.#provider === "zai";
    if (
      run.agentRuntimeProfile.kind !==
        (glm ? "glm-claude-code-native/v1" : "claude-code-native/v1") ||
      !this.#transportAdmitted ||
      run.agentRuntimeProfile.executableVersion !==
        claudeCodeTransportEligibility.executableVersion ||
      (glm &&
        (run.agentRuntimeProfile.model !== "glm-5.3" ||
          run.agentRuntimeProfile.effort !== "max")) ||
      !this.#sandbox.bindingMatches(run)
    ) {
      const now = this.#sandbox.now();
      return failedNativeRunReceipt(
        run,
        "policy-denied",
        "The sealed run does not match this Agent Runtime binding.",
        now,
        now,
        false,
      );
    }

    if (glm) {
      try {
        const settings = JSON.parse(
          await readFile(
            join(this.#providerConfigDirectory, "settings.json"),
            "utf8",
          ),
        ) as unknown;
        if (!glmSettingsSchema.safeParse(settings).success) {
          throw new Error("unsupported GLM settings");
        }
      } catch {
        const now = this.#sandbox.now();
        return failedNativeRunReceipt(
          run,
          "policy-denied",
          "The GLM provider settings do not match the sealed Z.AI binding.",
          now,
          now,
          false,
        );
      }
    }

    const execution = await this.#sandbox.execute(run, {
      executable: "claude",
      versionTokenIndex: 0,
      providerEnvironment: [
        "--env=CLAUDE_CONFIG_DIR=/provider",
        "--env=HOME=/tmp/home",
      ],
      ephemeralProviderCredentialFiles: [
        glm ? "settings.json" : ".credentials.json",
      ],
      ephemeralProviderHomeMount: {
        path: "/provider",
        mode: run.kind === "sealed-native-research-run" ? "rw" : "ro",
      },
      ...(run.kind === "sealed-native-research-run"
        ? {
            researchSession: {
              newSessionArguments: (sessionId: string) => [
                "--session-id",
                sessionId,
              ],
              resumeSessionArguments: (sessionId: string) => [
                "--resume",
                sessionId,
              ],
            },
          }
        : {}),
      args: [
        "-p",
        "--model",
        glm ? "opus" : run.agentRuntimeProfile.model,
        "--effort",
        run.agentRuntimeProfile.effort,
        ...(glm
          ? []
          : [
              "--max-budget-usd",
              String(run.budgetAllowance.maxEstimatedCostUsd),
            ]),
        "--strict-mcp-config",
        "--safe-mode",
        "--disable-slash-commands",
        "--tools",
        "Agent,Read,Glob,Grep,Write,Edit",
        "--allowedTools",
        "Agent,Read,Glob,Grep,Write,Edit",
        "--disallowedTools",
        "Bash",
        "WebFetch",
        "WebSearch",
        "Read(//provider/**)",
        "Glob(//provider/**)",
        "Grep(//provider/**)",
        "Write(//provider/**)",
        "Edit(//provider/**)",
        "Read(//proc/**)",
        "Glob(//proc/**)",
        "Grep(//proc/**)",
        "--permission-mode",
        "dontAsk",
        "--no-chrome",
        "--prompt-suggestions",
        "false",
        ...(run.kind === "sealed-native-validation-run"
          ? ["--no-session-persistence"]
          : []),
        "--output-format",
        "json",
        ...(glm
          ? []
          : [
              "--json-schema",
              claudeJsonSchema(
                run.kind === "sealed-native-research-run"
                  ? researchReportSchema
                  : validationReportSchema,
              ),
            ]),
      ],
      prompt: {
        kind: "stdin",
        text: glm
          ? glmPrompt(
              this.#sandbox.prompt(run),
              run.kind === "sealed-native-research-run"
                ? researchReportSchema
                : validationReportSchema,
            )
          : this.#sandbox.prompt(run),
      },
    });
    if (execution.status === "failed") return execution.receipt;
    if (execution.status === "exited-nonzero") {
      const decodedError = claudeErrorResultSchema.safeParse(
        parseJson(execution.stdout),
      );
      if (
        decodedError.success &&
        run.kind === "sealed-native-research-run" &&
        (execution.checkpoint === undefined ||
          decodedError.data.session_id !== execution.checkpoint.sessionId)
      ) {
        return failedNativeRunReceipt(
          run,
          "policy-denied",
          "Claude Code returned an unbound Research session.",
          execution.startedAt,
          execution.completedAt,
          true,
        );
      }
      return decodedError.success
        ? errorReceipt(
            run,
            decodedError.data,
            execution.startedAt,
            execution.completedAt,
            execution.checkpoint,
          )
        : failedNativeRunReceipt(
            run,
            "provider-failed",
            "Claude Code exited without a supported failure envelope.",
            execution.startedAt,
            execution.completedAt,
            true,
            execution.checkpoint,
          );
    }

    const envelope = resultEnvelope(execution.stdout, this.#provider);
    if (envelope === undefined) {
      return failedNativeRunReceipt(
        run,
        "invalid-output",
        "Claude Code returned an unsupported result envelope.",
        execution.startedAt,
        execution.completedAt,
        true,
        execution.checkpoint,
      );
    }
    const usedModels = Object.values(envelope.modelUsage);
    if (
      envelope.permission_denials.length > 0 ||
      envelope.usage.server_tool_use.web_search_requests !== 0 ||
      envelope.usage.server_tool_use.web_fetch_requests !== 0 ||
      (run.kind === "sealed-native-research-run" &&
        (execution.checkpoint === undefined ||
          envelope.session_id !== execution.checkpoint.sessionId)) ||
      !usedModels.some(
        (usage) => usage.canonicalModel === run.agentRuntimeProfile.model,
      )
    ) {
      return failedNativeRunReceipt(
        run,
        "policy-denied",
        "Claude Code violated the sealed model or tool policy.",
        execution.startedAt,
        execution.completedAt,
        true,
      );
    }
    const report = (
      run.kind === "sealed-native-research-run"
        ? researchReportSchema
        : validationReportSchema
    ).safeParse(envelope.structured_output);
    if (!report.success) {
      return failedNativeRunReceipt(
        run,
        "invalid-output",
        "Claude Code returned an unsupported Agent Report.",
        execution.startedAt,
        execution.completedAt,
        true,
        execution.checkpoint,
      );
    }
    const receipt = {
      schemaVersion: 1,
      runId: run.runId,
      runtimeProfileDigest: run.agentRuntimeProfile.digest,
      terminal: "completed",
      startedAt: execution.startedAt.toISOString(),
      completedAt: execution.completedAt.toISOString(),
      usage: {
        wallTimeMs: wallTimeMs(
          envelope.duration_ms,
          execution.startedAt,
          execution.completedAt,
        ),
        inputTokens: usedModels.reduce(
          (total, usage) =>
            total +
            usage.inputTokens +
            usage.cacheReadInputTokens +
            usage.cacheCreationInputTokens,
          0,
        ),
        outputTokens: usedModels.reduce(
          (total, usage) => total + usage.outputTokens,
          0,
        ),
        ...(envelope.total_cost_usd === undefined
          ? {}
          : { estimatedCostUsd: envelope.total_cost_usd }),
      },
      activity: {
        subagents: envelope.subagent_stats?.spawned ?? null,
        tools: null,
      },
      isolation: {
        backend: "gvisor",
        runtime: "runsc",
        fallbackUsed: false,
      },
      ...(run.kind === "sealed-native-research-run" &&
      execution.checkpoint !== undefined
        ? { checkpoint: execution.checkpoint }
        : {}),
      report: report.data,
    };
    return run.kind === "sealed-native-research-run"
      ? nativeRunReceiptSchema.parse(receipt)
      : validationRunReceiptSchema.parse(receipt);
  }
}

export function openClaudeCodeNativeAgentRuntime(
  options: OpenClaudeCodeNativeAgentRuntimeOptions,
): NativeAgentRuntime {
  return new ClaudeCodeNativeAgentRuntime(options, "anthropic");
}

export function openGlmNativeAgentRuntime(
  options: OpenGlmNativeAgentRuntimeOptions,
): NativeAgentRuntime {
  return new ClaudeCodeNativeAgentRuntime(options, "zai");
}
