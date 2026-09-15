import { z } from "zod";

import {
  grokBuildTransportEligibility,
  grokImageDigest,
} from "../../infrastructure/grok-transport-eligibility.js";
import {
  failedNativeRunReceipt,
  GvisorAgentSandbox,
  refusedNativeRunReceipt,
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
  structuredOutput: z.unknown().optional(),
});

const grokManagedConfig = `[subagents.models]
general-purpose = "grok-4.6"
explore = "grok-4.6"
plan = "grok-4.6"
`;

const grokRequirements = `[models]
allowed_models = ["grok-4.6"]
`;

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return undefined;
  }
}

function parseJsonOrTrailingObject(value: string): unknown {
  const whole = parseJson(value);
  if (whole !== undefined) return whole;

  const text = value.trim();
  if (!text.endsWith("}")) return undefined;
  let depth = 0;
  let insideString = false;
  for (let index = text.length - 1; index >= 0; index -= 1) {
    const character = text[index];
    if (character === '"') {
      let precedingBackslashes = 0;
      for (
        let escapeIndex = index - 1;
        escapeIndex >= 0 && text[escapeIndex] === "\\";
        escapeIndex -= 1
      ) {
        precedingBackslashes += 1;
      }
      if (precedingBackslashes % 2 === 0) insideString = !insideString;
      continue;
    }
    if (insideString) continue;
    if (character === "}") {
      depth += 1;
      continue;
    }
    if (character !== "{") continue;
    depth -= 1;
    if (depth === 0) return parseJson(text.slice(index));
    if (depth < 0) return undefined;
  }
  return undefined;
}

function grokPrompt(run: SealedAgentRun, sandboxPrompt: string): string {
  const reportSchema =
    run.kind === "sealed-native-research-run"
      ? researchReportSchema
      : validationReportSchema;
  const reportName =
    run.kind === "sealed-native-research-run"
      ? "Research Report"
      : "Validation Report";
  return `${sandboxPrompt}

Grok final ${reportName} JSON Schema:
${JSON.stringify(z.toJSONSchema(reportSchema))}

Use the source tools for the investigation before producing the final answer. At the end, return exactly one JSON object matching this schema in the response text. Do not wrap it in Markdown or add prose outside the JSON object.`;
}

class GrokNativeAgentRuntime implements NativeAgentRuntime {
  readonly #sandbox: GvisorAgentSandbox;
  readonly #transportAdmitted: boolean;

  constructor(options: GvisorAgentRuntimeOptions) {
    this.#sandbox = new GvisorAgentSandbox(options);
    this.#transportAdmitted =
      grokImageDigest(options.image) ===
      grokBuildTransportEligibility.imageDigest;
  }

  async execute(run: SealedAgentRun): Promise<NativeAgentReceipt> {
    if (
      run.agentRuntimeProfile.kind !== "grok-build-native/v1" ||
      !this.#transportAdmitted ||
      run.agentRuntimeProfile.executableVersion !==
        grokBuildTransportEligibility.executableVersion ||
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
        "--env=GROK_MAX_CONCURRENT_SUBAGENTS=3",
        "--env=GROK_SUBAGENTS_MAX_DEPTH=1",
        "--env=GROK_SUBAGENT_LIMIT_BEHAVIOR=fail",
        "--env=HOME=/tmp/home",
      ],
      supportFiles: [
        {
          filename: "grok-managed-config.toml",
          text: grokManagedConfig,
          containerMountPath: "/etc/grok/managed_config.toml",
        },
        {
          filename: "grok-requirements.toml",
          text: grokRequirements,
          containerMountPath: "/etc/grok/requirements.toml",
        },
      ],
      ephemeralProviderCredentialFiles: ["auth.json", "agent_id"],
      ephemeralProviderHomeMount: { path: "/provider", mode: "rw" },
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
        "--model",
        run.agentRuntimeProfile.model,
        "--reasoning-effort",
        run.agentRuntimeProfile.effort,
        "--output-format",
        "json",
        "--cwd",
        "/workspace",
        "--sandbox",
        "off",
        "--verbatim",
        "--no-memory",
        "--disable-web-search",
        "--tools",
        "GrokBuild:read_file,GrokBuild:grep,GrokBuild:list_dir,GrokBuild:task,GrokBuild:get_task_output,GrokBuild:kill_task",
        "--deny",
        "Read(/provider/**)",
        "--deny",
        "Grep(/provider/**)",
        "--permission-mode",
        "bypassPermissions",
        "--prompt-file",
        "/workspace/research/prompt.txt",
      ],
      prompt: {
        kind: "file",
        text: grokPrompt(run, this.#sandbox.prompt(run)),
      },
    });
    if (execution.status === "failed") return execution.receipt;
    if (execution.status === "exited-nonzero") {
      return failedNativeRunReceipt(
        run,
        "provider-failed",
        "Grok Build exited without a completed result.",
        execution.startedAt,
        execution.completedAt,
        true,
        execution.checkpoint,
        execution.diagnostic,
        execution.failureStage,
      );
    }

    const decodedEnvelope = grokResultSchema.safeParse(
      parseJson(execution.stdout),
    );
    if (!decodedEnvelope.success) {
      const summary = "Grok Build returned an unsupported result envelope.";
      return refusedNativeRunReceipt(
        run,
        execution,
        "invalid-output",
        summary,
        execution.checkpoint,
      );
    }
    const envelope = decodedEnvelope.data;
    const modelUsage = envelope.modelUsage["grok-4.6-build"];
    if (
      run.kind === "sealed-native-research-run" &&
      (execution.checkpoint === undefined ||
        envelope.sessionId !== execution.checkpoint.sessionId)
    ) {
      const summary = "Grok Build returned an unbound Research session.";
      return refusedNativeRunReceipt(
        run,
        execution,
        "policy-denied",
        summary,
        undefined,
      );
    }
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
      const summary = "Grok Build violated the sealed model or usage binding.";
      return refusedNativeRunReceipt(
        run,
        execution,
        "policy-denied",
        summary,
        undefined,
      );
    }
    const reportSchema =
      run.kind === "sealed-native-research-run"
        ? researchReportSchema
        : validationReportSchema;
    const textReport = reportSchema.safeParse(
      parseJsonOrTrailingObject(envelope.text),
    );
    const report = textReport.success
      ? textReport
      : reportSchema.safeParse(envelope.structuredOutput);
    if (!report.success) {
      const summary = "Grok Build returned an unsupported Agent Report.";
      return refusedNativeRunReceipt(
        run,
        execution,
        "invalid-output",
        summary,
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

export function openGrokNativeAgentRuntime(
  options: GvisorAgentRuntimeOptions,
): NativeAgentRuntime {
  return new GrokNativeAgentRuntime(options);
}
