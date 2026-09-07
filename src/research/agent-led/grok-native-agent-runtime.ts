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

const grokUsageSchema = z.strictObject({
  input_tokens: z.number().int().nonnegative(),
  cache_read_input_tokens: z.number().int().nonnegative(),
  cache_creation_input_tokens: z.number().int().nonnegative(),
  output_tokens: z.number().int().nonnegative(),
  reasoning_tokens: z.number().int().nonnegative(),
  total_tokens: z.number().int().nonnegative(),
});
const grokResultSchema = z.object({
  text: z.string(),
  stopReason: z.literal("end_turn"),
  sessionId: z.string().min(1),
  requestId: z.string().min(1),
  usage: grokUsageSchema,
  num_turns: z.number().int().nonnegative(),
  total_cost_usd: z.number().finite().nonnegative().optional(),
  modelUsage: z.record(
    z.string(),
    z.object({
      inputTokens: z.number().int().nonnegative(),
      outputTokens: z.number().int().nonnegative(),
      cacheReadInputTokens: z.number().int().nonnegative(),
      cacheCreationInputTokens: z.number().int().nonnegative(),
      modelCalls: z.number().int().nonnegative(),
      costUSD: z.number().finite().nonnegative().optional(),
    }),
  ),
  structuredOutput: z.unknown(),
});

export interface OpenGrokNativeAgentRuntimeOptions extends GvisorAgentRuntimeOptions {}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return undefined;
  }
}

class GrokNativeAgentRuntime implements NativeAgentRuntime {
  readonly #sandbox: GvisorAgentSandbox;

  constructor(options: OpenGrokNativeAgentRuntimeOptions) {
    this.#sandbox = new GvisorAgentSandbox(options);
  }

  async execute(run: SealedAgentRun): Promise<NativeAgentReceipt> {
    if (
      run.agentRuntimeProfile.kind !== "grok-build-native/v1" ||
      run.agentRuntimeProfile.model !== "grok-4.6" ||
      run.agentRuntimeProfile.effort !== "xhigh" ||
      !this.#sandbox.bindingMatches(run)
    ) {
      const now = this.#sandbox.now();
      return failedNativeRunReceipt(
        run,
        "policy-denied",
        "The sealed run does not match this Grok Agent Runtime binding.",
        now,
        now,
        false,
      );
    }

    const execution = await this.#sandbox.execute(run, {
      executable: "grok",
      versionTokenIndex: 1,
      providerEnvironment: [
        "--env=GROK_HOME=/provider",
        "--env=HOME=/tmp/home",
      ],
      args: [
        "--model",
        run.agentRuntimeProfile.model,
        "--reasoning-effort",
        run.agentRuntimeProfile.effort,
        "--cwd",
        "/workspace",
        "--sandbox",
        "off",
        "--verbatim",
        "--no-memory",
        "--disable-web-search",
        "--disallowed-tools",
        "Bash,WebFetch,WebSearch",
        "--permission-mode",
        "bypassPermissions",
        "--json-schema",
        JSON.stringify(
          z.toJSONSchema(
            run.kind === "sealed-native-research-run"
              ? researchReportSchema
              : validationReportSchema,
          ),
        ),
        "--prompt-file",
        "/workspace/research/prompt.txt",
      ],
      prompt: { kind: "file", text: this.#sandbox.prompt(run) },
    });
    if (execution.status === "failed") return execution.receipt;

    const decodedEnvelope = grokResultSchema.safeParse(
      parseJson(execution.stdout),
    );
    if (!decodedEnvelope.success) {
      return failedNativeRunReceipt(
        run,
        "invalid-output",
        "Grok Build returned an unsupported result envelope.",
        execution.startedAt,
        execution.completedAt,
        true,
      );
    }
    const envelope = decodedEnvelope.data;
    const modelUsage = envelope.modelUsage["grok-4.6-build"];
    if (
      Object.keys(envelope.modelUsage).length !== 1 ||
      modelUsage === undefined ||
      modelUsage.inputTokens !== envelope.usage.input_tokens ||
      modelUsage.outputTokens !== envelope.usage.output_tokens ||
      modelUsage.cacheReadInputTokens !==
        envelope.usage.cache_read_input_tokens ||
      modelUsage.cacheCreationInputTokens !==
        envelope.usage.cache_creation_input_tokens ||
      envelope.usage.total_tokens !==
        modelUsage.inputTokens +
          modelUsage.cacheReadInputTokens +
          modelUsage.cacheCreationInputTokens +
          modelUsage.outputTokens
    ) {
      return failedNativeRunReceipt(
        run,
        "policy-denied",
        "Grok Build violated the sealed model or usage binding.",
        execution.startedAt,
        execution.completedAt,
        true,
      );
    }
    const report = (
      run.kind === "sealed-native-research-run"
        ? researchReportSchema
        : validationReportSchema
    ).safeParse(envelope.structuredOutput);
    if (!report.success) {
      return failedNativeRunReceipt(
        run,
        "invalid-output",
        "Grok Build returned an unsupported Agent Report.",
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
        wallTimeMs: Math.max(
          0,
          execution.completedAt.getTime() - execution.startedAt.getTime(),
        ),
        inputTokens:
          modelUsage.inputTokens +
          modelUsage.cacheReadInputTokens +
          modelUsage.cacheCreationInputTokens,
        outputTokens: modelUsage.outputTokens,
        ...(envelope.total_cost_usd === undefined
          ? {}
          : { estimatedCostUsd: envelope.total_cost_usd }),
      },
      activity: { subagents: null, tools: null },
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

export function openGrokNativeAgentRuntime(
  options: OpenGrokNativeAgentRuntimeOptions,
): NativeAgentRuntime {
  return new GrokNativeAgentRuntime(options);
}
