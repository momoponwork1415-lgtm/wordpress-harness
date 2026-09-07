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
  usage: z.object({
    server_tool_use: z.object({
      web_search_requests: z.number().int().nonnegative(),
      web_fetch_requests: z.number().int().nonnegative(),
    }),
  }),
  modelUsage: modelUsageSchema,
});

export interface OpenClaudeCodeNativeAgentRuntimeOptions extends GvisorAgentRuntimeOptions {}

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
    failure: { summary },
  };
  return run.kind === "sealed-native-research-run"
    ? nativeRunReceiptSchema.parse(receipt)
    : validationRunReceiptSchema.parse(receipt);
}

class ClaudeCodeNativeAgentRuntime implements NativeAgentRuntime {
  readonly #sandbox: GvisorAgentSandbox;
  readonly #transportAdmitted: boolean;

  constructor(options: OpenClaudeCodeNativeAgentRuntimeOptions) {
    this.#sandbox = new GvisorAgentSandbox(options);
    this.#transportAdmitted =
      imageDigest(options.image) === claudeCodeTransportEligibility.imageDigest;
  }

  async execute(run: SealedAgentRun): Promise<NativeAgentReceipt> {
    if (
      run.agentRuntimeProfile.kind !== "claude-code-native/v1" ||
      !this.#transportAdmitted ||
      run.agentRuntimeProfile.executableVersion !==
        claudeCodeTransportEligibility.executableVersion ||
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

    const execution = await this.#sandbox.execute(run, {
      executable: "claude",
      versionTokenIndex: 0,
      providerEnvironment: [
        "--env=CLAUDE_CONFIG_DIR=/provider",
        "--env=HOME=/tmp/home",
      ],
      ephemeralProviderCredentialFiles: [".credentials.json"],
      ephemeralProviderHomeMount: { path: "/provider", mode: "ro" },
      args: [
        "-p",
        "--model",
        run.agentRuntimeProfile.model,
        "--effort",
        run.agentRuntimeProfile.effort,
        "--max-budget-usd",
        String(run.budgetEnvelope.maxEstimatedCostUsd),
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
        "--no-session-persistence",
        "--output-format",
        "json",
        "--json-schema",
        claudeJsonSchema(
          run.kind === "sealed-native-research-run"
            ? researchReportSchema
            : validationReportSchema,
        ),
      ],
      prompt: { kind: "stdin", text: this.#sandbox.prompt(run) },
    });
    if (execution.status === "failed") return execution.receipt;
    if (execution.status === "exited-nonzero") {
      const decodedError = claudeErrorResultSchema.safeParse(
        parseJson(execution.stdout),
      );
      return decodedError.success
        ? errorReceipt(
            run,
            decodedError.data,
            execution.startedAt,
            execution.completedAt,
          )
        : failedNativeRunReceipt(
            run,
            "provider-failed",
            "Claude Code exited without a supported failure envelope.",
            execution.startedAt,
            execution.completedAt,
            true,
          );
    }

    const decodedEnvelope = claudeResultSchema.safeParse(
      parseJson(execution.stdout),
    );
    if (!decodedEnvelope.success) {
      return failedNativeRunReceipt(
        run,
        "invalid-output",
        "Claude Code returned an unsupported result envelope.",
        execution.startedAt,
        execution.completedAt,
        true,
      );
    }
    const envelope = decodedEnvelope.data;
    const usedModels = Object.values(envelope.modelUsage);
    if (
      envelope.permission_denials.length > 0 ||
      envelope.usage.server_tool_use.web_search_requests !== 0 ||
      envelope.usage.server_tool_use.web_fetch_requests !== 0 ||
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
  return new ClaudeCodeNativeAgentRuntime(options);
}
