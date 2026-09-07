import { z } from "zod";

import {
  failedNativeRunReceipt,
  GvisorAgentSandbox,
  type GvisorAgentRuntimeOptions,
} from "./gvisor-agent-sandbox.js";
import {
  nativeRunReceiptSchema,
  researchReportSchema,
  type NativeAgentRuntime,
  type NativeRunReceipt,
  type SealedNativeRun,
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
  subagent_stats: z.object({
    spawned: z.number().int().nonnegative(),
  }),
  modelUsage: modelUsageSchema,
});

export interface OpenClaudeCodeNativeAgentRuntimeOptions extends GvisorAgentRuntimeOptions {}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return undefined;
  }
}

class ClaudeCodeNativeAgentRuntime implements NativeAgentRuntime {
  readonly #sandbox: GvisorAgentSandbox;

  constructor(options: OpenClaudeCodeNativeAgentRuntimeOptions) {
    this.#sandbox = new GvisorAgentSandbox(options);
  }

  async execute(run: SealedNativeRun): Promise<NativeRunReceipt> {
    if (
      run.agentRuntimeProfile.kind !== "claude-code-native/v1" ||
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
      providerEnvironment: ["--env=CLAUDE_CONFIG_DIR=/provider"],
      args: [
        "-p",
        "--model",
        run.agentRuntimeProfile.model,
        "--effort",
        run.agentRuntimeProfile.effort,
        "--max-budget-usd",
        String(run.budgetEnvelope.maxEstimatedCostUsd),
        "--restricted",
        "--strict-mcp-config",
        "--safe-mode",
        "--disable-slash-commands",
        "--tools",
        "Agent,Read,Glob,Grep,Write,Edit",
        "--allowedTools",
        "Agent,Read,Glob,Grep,Write,Edit",
        "--disallowedTools",
        "Bash,WebFetch,WebSearch",
        "--permission-mode",
        "dontAsk",
        "--permission-prompts",
        "none",
        "--no-chrome",
        "--prompt-suggestions",
        "false",
        "--no-session-persistence",
        "--output-format",
        "json",
        "--json-schema",
        JSON.stringify(z.toJSONSchema(researchReportSchema)),
      ],
      prompt: { kind: "stdin", text: this.#sandbox.prompt(run) },
    });
    if (execution.status === "failed") return execution.receipt;

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
    const report = researchReportSchema.safeParse(envelope.structured_output);
    if (!report.success) {
      return failedNativeRunReceipt(
        run,
        "invalid-output",
        "Claude Code returned an unsupported Research Report.",
        execution.startedAt,
        execution.completedAt,
        true,
      );
    }
    return nativeRunReceiptSchema.parse({
      schemaVersion: 1,
      runId: run.runId,
      runtimeProfileDigest: run.agentRuntimeProfile.digest,
      terminal: "completed",
      startedAt: execution.startedAt.toISOString(),
      completedAt: execution.completedAt.toISOString(),
      usage: {
        wallTimeMs: envelope.duration_ms,
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
        subagents: envelope.subagent_stats.spawned,
        tools: null,
      },
      isolation: {
        backend: "gvisor",
        runtime: "runsc",
        fallbackUsed: false,
      },
      report: report.data,
    });
  }
}

export function openClaudeCodeNativeAgentRuntime(
  options: OpenClaudeCodeNativeAgentRuntimeOptions,
): NativeAgentRuntime {
  return new ClaudeCodeNativeAgentRuntime(options);
}
