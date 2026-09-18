import { z } from "zod";

import { admitAgentRuntimeProfile } from "../../infrastructure/agent-runtime-profile.js";
import type {
  DeepSeekCredentialEgressGrantRequest,
  ProviderCredentialEgressGrant,
  ProviderCredentialEgressBroker,
  ProviderCredentialEgressReceipt,
} from "../../infrastructure/deepseek-credential-egress-broker.js";
import {
  failedNativeRunReceipt,
  GvisorAgentSandbox,
  refusedNativeRunReceipt,
  type GvisorAgentRuntimeOptions,
  type SandboxedAgentCommand,
  type SandboxedAgentResult,
} from "./gvisor-agent-sandbox.js";
import {
  nativeRunReceiptSchema,
  type NativeAgentRuntime,
  type NativeRunReceipt,
  type SealedNativeRun,
} from "./contracts.js";
import {
  parsePromptedJsonResearchReport,
  promptedJsonResearchPrompt,
} from "./prompted-json-report.js";

const MAX_GRANT_REQUESTS = 10_000;
const MAX_GRANT_REQUEST_BYTES = 128 * 1024 * 1024;
const MAX_GRANT_RESPONSE_BYTES = 128 * 1024 * 1024;

const sessionEventSchema = z.object({
  type: z.literal("session"),
  sessionId: z.string().min(1),
});
const usageSchema = z.object({
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  cacheReadTokens: z.number().int().nonnegative().optional(),
  cacheWriteTokens: z.number().int().nonnegative().optional(),
});
const statusEventSchema = z.object({
  type: z.literal("status"),
  phase: z.string(),
  usage: usageSchema.optional(),
  reason: z.unknown().optional(),
});
const toolCallEventSchema = z.object({
  type: z.literal("tool_call"),
  callId: z.string().min(1),
  tool: z.string().min(1),
});
const finalEventSchema = z.object({
  type: z.literal("final"),
  text: z.string(),
});
const errorEventSchema = z.object({
  type: z.literal("error"),
  message: z.string(),
});
const eventTypeSchema = z.object({ type: z.string() });
const completedReasonSchema = z.object({ kind: z.literal("completed") });
const errorReasonSchema = z.object({
  kind: z.literal("error"),
  error: z.object({ code: z.string().min(1) }),
});

interface DeepSeekEventStream {
  readonly sessionId: string;
  readonly finalText: string | undefined;
  readonly completed: boolean;
  readonly errorCode: string | undefined;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly tools: readonly string[];
  readonly subagents: number;
}

interface DeepSeekExecutionSequence {
  readonly execution: SandboxedAgentResult;
  readonly initialStartedAt: Date | undefined;
  readonly eventStreams: readonly DeepSeekEventStream[];
}

function deepSeekResearchPatch(model: string, effort: string): string {
  return `- id: agent-default-model
  config:
    provider: deepseek-official
    model: ${JSON.stringify(model)}

- id: llm-deepseek
  config:
    protocol: chat-completions
    reasoningEffort: ${effort}

- id: subagent
  config:
    maxDepth: 1
    maxActiveSubagents: 3

- id: settings
  disabled: true

- id: credentials
  disabled: true

- id: session-title-llm
  disabled: true

- id: session-log-deepseek
  disabled: true

- id: plugin-package-inventory-deepseek
  disabled: true

- id: session-telemetry-otel
  disabled: true

- id: web-search-deepseek
  disabled: true

- id: web-fetch-http
  disabled: true

- id: tool-web
  disabled: true

- id: tool-subagent-fork
  disabled: true

- id: tool-workflow
  disabled: true

- id: tool-ralph
  disabled: true
`;
}

function deepSeekReportCorrectionPrompt(): string {
  return promptedJsonResearchPrompt(
    "Correct only the format of your previous final Research Report. Preserve its research substance exactly, do not perform new research, and return one syntactically valid JSON object matching the supplied schema.",
    "DeepSeek",
  );
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return undefined;
  }
}

function parseSessionId(stdout: string): string | undefined {
  const sessionIds: string[] = [];
  for (const line of stdout.split("\n")) {
    const value = parseJson(line);
    if (
      typeof value === "object" &&
      value !== null &&
      "type" in value &&
      value.type === "session" &&
      "sessionId" in value &&
      typeof value.sessionId === "string" &&
      value.sessionId.length > 0
    ) {
      sessionIds.push(value.sessionId);
    }
  }
  return sessionIds.length === 1 ? sessionIds[0] : undefined;
}

function parseEventStream(stdout: string): DeepSeekEventStream | undefined {
  const sessions: string[] = [];
  let finalText: string | undefined;
  let completed = false;
  let errorCode: string | undefined;
  let inputTokens = 0;
  let outputTokens = 0;
  const tools = new Set<string>();
  const subagentCalls = new Set<string>();
  const lines = stdout.split("\n").filter((line) => line.trim().length > 0);
  if (lines.length === 0) return undefined;

  for (const line of lines) {
    const value = parseJson(line);
    const type = eventTypeSchema.safeParse(value);
    if (!type.success) return undefined;
    if (type.data.type === "session") {
      const event = sessionEventSchema.safeParse(value);
      if (!event.success) return undefined;
      sessions.push(event.data.sessionId);
      continue;
    }
    if (type.data.type === "status") {
      const event = statusEventSchema.safeParse(value);
      if (!event.success) return undefined;
      if (event.data.phase === "step_end" && event.data.usage !== undefined) {
        inputTokens +=
          event.data.usage.inputTokens +
          (event.data.usage.cacheReadTokens ?? 0) +
          (event.data.usage.cacheWriteTokens ?? 0);
        outputTokens += event.data.usage.outputTokens;
      }
      if (event.data.phase === "turn_end") {
        if (completedReasonSchema.safeParse(event.data.reason).success) {
          completed = true;
        }
        const failed = errorReasonSchema.safeParse(event.data.reason);
        if (failed.success) errorCode = failed.data.error.code;
      }
      continue;
    }
    if (type.data.type === "tool_call") {
      const event = toolCallEventSchema.safeParse(value);
      if (!event.success) return undefined;
      tools.add(event.data.tool);
      if (
        event.data.tool === "subagent" ||
        event.data.tool === "subagent_fork" ||
        event.data.tool === "workflow"
      ) {
        subagentCalls.add(event.data.callId);
      }
      continue;
    }
    if (type.data.type === "final") {
      const event = finalEventSchema.safeParse(value);
      if (!event.success || finalText !== undefined) return undefined;
      finalText = event.data.text;
      continue;
    }
    if (type.data.type === "error") {
      const event = errorEventSchema.safeParse(value);
      if (!event.success) return undefined;
    }
  }
  if (sessions.length !== 1) return undefined;
  return {
    sessionId: sessions[0]!,
    finalText,
    completed,
    errorCode,
    inputTokens,
    outputTokens,
    tools: [...tools],
    subagents: subagentCalls.size,
  };
}

function tokenFromAuthorization(authorization: string): string {
  const prefix = "Bearer ";
  if (!authorization.startsWith(prefix)) {
    throw new Error("DeepSeek egress grant authorization is invalid");
  }
  const token = authorization.slice(prefix.length);
  if (token.length < 8 || /[\s\0]/u.test(token)) {
    throw new Error("DeepSeek egress grant authorization is invalid");
  }
  return token;
}

function brokerFailureReceipt(
  run: SealedNativeRun,
  receipt: ProviderCredentialEgressReceipt,
): NativeRunReceipt {
  const startedAt = new Date(receipt.startedAt);
  const completedAt = new Date(receipt.completedAt);
  if (receipt.setup.status === "failed") {
    if (receipt.setup.stage === "credential") {
      return failedNativeRunReceipt(
        run,
        "provider-unauthenticated",
        "The host-private DeepSeek credential is unavailable.",
        startedAt,
        completedAt,
        false,
      );
    }
    return failedNativeRunReceipt(
      run,
      "policy-denied",
      "The isolated DeepSeek credential egress broker is unavailable.",
      startedAt,
      completedAt,
      false,
      undefined,
      undefined,
      "sandbox-preflight",
      true,
    );
  }
  return failedNativeRunReceipt(
    run,
    "provider-failed",
    "The DeepSeek credential egress grant did not start the Agent Runtime.",
    startedAt,
    completedAt,
    true,
  );
}

function withCredentialEgress(
  receipt: NativeRunReceipt,
  credentialEgress: ProviderCredentialEgressReceipt,
): NativeRunReceipt {
  return nativeRunReceiptSchema.parse({ ...receipt, credentialEgress });
}

function nonzeroTerminal(code: string | undefined): {
  readonly terminal:
    | "provider-failed"
    | "provider-unauthenticated"
    | "provider-quota-exhausted"
    | "policy-denied"
    | "invalid-output";
  readonly summary: string;
  readonly retryable: boolean;
} {
  switch (code?.toUpperCase()) {
    case "AUTH":
    case "MISSING_CREDENTIAL":
    case "INVALID_CREDENTIAL":
      return {
        terminal: "provider-unauthenticated",
        summary:
          "DeepSeek rejected or could not resolve the scoped credential.",
        retryable: false,
      };
    case "QUOTA":
    case "RATE_LIMIT":
      return {
        terminal: "provider-quota-exhausted",
        summary: "DeepSeek quota or rate capacity is unavailable.",
        retryable: true,
      };
    case "UNSUPPORTED_REASONING_EFFORT":
      return {
        terminal: "policy-denied",
        summary: "DeepSeek rejected the sealed model or reasoning effort.",
        retryable: false,
      };
    case "MALFORMED_RESPONSE":
    case "STREAM_CLOSED":
    case "EMPTY_RESPONSE":
      return {
        terminal: "invalid-output",
        summary: "DeepSeek returned a malformed or empty provider response.",
        retryable: false,
      };
    case "TIMEOUT":
      return {
        terminal: "provider-failed",
        summary: "DeepSeek timed out before completing the Research turn.",
        retryable: true,
      };
    default:
      return {
        terminal: "provider-failed",
        summary: "DeepSeek Harness exited without a completed Research turn.",
        retryable: false,
      };
  }
}

export interface DeepSeekHarnessNativeAgentRuntimeOptions {
  readonly sandbox: GvisorAgentRuntimeOptions;
  readonly credentialEgressBroker: ProviderCredentialEgressBroker;
}

class DeepSeekHarnessNativeAgentRuntime implements NativeAgentRuntime {
  readonly #sandbox: GvisorAgentSandbox;
  readonly #image: string;
  readonly #credentialEgressBroker: ProviderCredentialEgressBroker;

  constructor(options: DeepSeekHarnessNativeAgentRuntimeOptions) {
    this.#sandbox = new GvisorAgentSandbox(options.sandbox);
    this.#image = options.sandbox.image;
    this.#credentialEgressBroker = options.credentialEgressBroker;
  }

  #command(
    run: SealedNativeRun,
    grant: ProviderCredentialEgressGrant,
    prompt: string,
  ): SandboxedAgentCommand {
    const token = tokenFromAuthorization(grant.authorization);
    return {
      executable: "dsh",
      versionTokenIndex: 0,
      dockerNetworkName: grant.dockerNetworkName,
      providerEnvironment: [
        "--env=DSH_HOME=/provider",
        "--env=HOME=/tmp/home",
        "--env=DSH_PERMISSION_MODE=read-only",
        "--env=DSH_TELEMETRY_DISABLED=1",
        "--env=NARB_DISABLE_NATIVE_CACHE=1",
        "--env=NO_COLOR=1",
        `--env=DEEPSEEK_API_KEY=${token}`,
        `--env=DEEPSEEK_BASE_URL=${grant.baseUrl}`,
      ],
      supportFiles: [
        {
          filename: "deepseek-research.patch.yml",
          text: deepSeekResearchPatch(
            run.agentRuntimeProfile.model,
            run.agentRuntimeProfile.effort,
          ),
          containerMountPath: "/etc/dsh/research.patch.yml",
        },
      ],
      ephemeralProviderHomeMount: { path: "/provider", mode: "rw" },
      researchSession: {
        newSessionArguments: () => [],
        resumeSessionArguments: (sessionId) => ["--session-id", sessionId],
        generatedSessionIdFromOutput: parseSessionId,
      },
      args: [
        "--profile",
        "headless",
        "--patch",
        "/etc/dsh/research.patch.yml",
        "--json",
      ],
      prompt: { kind: "stdin", text: prompt },
    };
  }

  async #executeWithBoundedCorrection(
    run: SealedNativeRun,
    grant: ProviderCredentialEgressGrant,
  ): Promise<DeepSeekExecutionSequence> {
    let execution = await this.#sandbox.execute(
      run,
      this.#command(
        run,
        grant,
        promptedJsonResearchPrompt(this.#sandbox.prompt(run), "DeepSeek"),
      ),
    );
    if (execution.status === "failed") {
      return {
        execution,
        initialStartedAt: undefined,
        eventStreams: [],
      };
    }

    const initialStartedAt = execution.startedAt;
    const initialEventStream =
      execution.status === "completed"
        ? parseEventStream(execution.stdout)
        : undefined;
    const eventStreams =
      initialEventStream === undefined ? [] : [initialEventStream];
    const checkpoint = execution.checkpoint;
    const usedWallTimeMs = Math.max(
      0,
      execution.completedAt.getTime() - execution.startedAt.getTime(),
    );
    const remainingWallTimeMs =
      run.budgetAllowance.maxWallTimeMs - usedWallTimeMs;
    const canCorrect =
      execution.status === "completed" &&
      initialEventStream !== undefined &&
      initialEventStream.completed &&
      initialEventStream.finalText !== undefined &&
      checkpoint !== undefined &&
      checkpoint.sessionId === initialEventStream.sessionId &&
      parsePromptedJsonResearchReport(initialEventStream.finalText) ===
        undefined &&
      remainingWallTimeMs > 0;

    if (canCorrect) {
      const correctionRun: SealedNativeRun = {
        ...run,
        budgetAllowance: { maxWallTimeMs: remainingWallTimeMs },
        resumeFrom: checkpoint,
      };
      execution = await this.#sandbox.execute(
        correctionRun,
        this.#command(correctionRun, grant, deepSeekReportCorrectionPrompt()),
      );
      if (execution.status === "completed") {
        const correctionEventStream = parseEventStream(execution.stdout);
        if (correctionEventStream !== undefined) {
          eventStreams.push(correctionEventStream);
        }
      }
    }

    return { execution, initialStartedAt, eventStreams };
  }

  async execute(run: SealedNativeRun): Promise<NativeRunReceipt> {
    if (
      run.agentRuntimeProfile.transportKind !== "deepseek-harness-native/v1" ||
      admitAgentRuntimeProfile(run.agentRuntimeProfile, this.#image).status !==
        "admitted" ||
      !this.#sandbox.bindingMatches(run)
    ) {
      const now = this.#sandbox.now();
      return failedNativeRunReceipt(
        run,
        "policy-denied",
        "The sealed run does not match this DeepSeek Harness Runtime binding.",
        now,
        now,
        false,
      );
    }

    const grantRequest: DeepSeekCredentialEgressGrantRequest = {
      schemaVersion: 1,
      runtimeProfileDigest: run.agentRuntimeProfile.digest,
      model: run.agentRuntimeProfile.model,
      protocol: "chat-completions",
      maxRequests: MAX_GRANT_REQUESTS,
      maxRequestBytes: MAX_GRANT_REQUEST_BYTES,
      maxResponseBytes: MAX_GRANT_RESPONSE_BYTES,
      expiresAt: new Date(
        this.#sandbox.now().getTime() + run.budgetAllowance.maxWallTimeMs,
      ).toISOString(),
    };
    const brokerResult = await this.#credentialEgressBroker.withGrant(
      grantRequest,
      (grant) => this.#executeWithBoundedCorrection(run, grant),
    );

    if (brokerResult.operation.status === "not-started") {
      return withCredentialEgress(
        brokerFailureReceipt(run, brokerResult.receipt),
        brokerResult.receipt,
      );
    }
    if (brokerResult.operation.status === "failed") {
      const startedAt = new Date(brokerResult.receipt.startedAt);
      const completedAt = new Date(brokerResult.receipt.completedAt);
      return withCredentialEgress(
        failedNativeRunReceipt(
          run,
          "provider-failed",
          "The DeepSeek Agent Runtime could not use its scoped egress grant.",
          startedAt,
          completedAt,
          true,
        ),
        brokerResult.receipt,
      );
    }
    const sequence = brokerResult.operation.value;
    const execution = sequence.execution;
    if (execution.status === "failed") {
      return withCredentialEgress(execution.receipt, brokerResult.receipt);
    }
    if (brokerResult.receipt.cleanup.status === "failed") {
      return withCredentialEgress(
        failedNativeRunReceipt(
          run,
          "provider-failed",
          "The DeepSeek Agent Runtime completed, but isolated egress cleanup failed.",
          sequence.initialStartedAt ?? execution.startedAt,
          execution.completedAt,
          true,
          execution.checkpoint,
          execution.diagnostic,
          "sandbox-cleanup",
        ),
        brokerResult.receipt,
      );
    }

    const eventStream = parseEventStream(execution.stdout);
    const initialStartedAt = sequence.initialStartedAt ?? execution.startedAt;
    if (execution.status === "exited-nonzero") {
      const failure = nonzeroTerminal(eventStream?.errorCode);
      return withCredentialEgress(
        failedNativeRunReceipt(
          run,
          failure.terminal,
          failure.summary,
          initialStartedAt,
          execution.completedAt,
          true,
          execution.checkpoint,
          execution.diagnostic,
          execution.failureStage,
          failure.retryable,
        ),
        brokerResult.receipt,
      );
    }
    if (
      eventStream === undefined ||
      !eventStream.completed ||
      eventStream.finalText === undefined
    ) {
      return withCredentialEgress(
        await refusedNativeRunReceipt(
          run,
          execution,
          "invalid-output",
          "DeepSeek Harness returned a malformed or incomplete NDJSON stream.",
          execution.checkpoint,
          initialStartedAt,
        ),
        brokerResult.receipt,
      );
    }
    if (
      execution.checkpoint === undefined ||
      execution.checkpoint.sessionId !== eventStream.sessionId
    ) {
      return withCredentialEgress(
        await refusedNativeRunReceipt(
          run,
          execution,
          "policy-denied",
          "DeepSeek Harness returned an unbound Research session.",
          undefined,
          initialStartedAt,
        ),
        brokerResult.receipt,
      );
    }
    const providerReport = parsePromptedJsonResearchReport(
      eventStream.finalText,
    );
    if (providerReport === undefined) {
      return withCredentialEgress(
        await refusedNativeRunReceipt(
          run,
          execution,
          "invalid-output",
          "DeepSeek Harness returned an unsupported Agent Report.",
          execution.checkpoint,
          initialStartedAt,
        ),
        brokerResult.receipt,
      );
    }
    let report;
    try {
      report = await this.#sandbox.materializeReport(run, providerReport);
    } catch {
      return withCredentialEgress(
        await refusedNativeRunReceipt(
          run,
          execution,
          "invalid-output",
          "DeepSeek Harness returned an invalid Candidate Recipe.",
          execution.checkpoint,
          initialStartedAt,
        ),
        brokerResult.receipt,
      );
    }
    return nativeRunReceiptSchema.parse({
      schemaVersion: 2,
      runId: run.runId,
      runtimeProfileDigest: run.agentRuntimeProfile.digest,
      terminal: "completed",
      startedAt: initialStartedAt.toISOString(),
      completedAt: execution.completedAt.toISOString(),
      usage: {
        wallTimeMs: Math.max(
          0,
          execution.completedAt.getTime() - initialStartedAt.getTime(),
        ),
        inputTokens: sequence.eventStreams.reduce(
          (total, stream) => total + stream.inputTokens,
          0,
        ),
        outputTokens: sequence.eventStreams.reduce(
          (total, stream) => total + stream.outputTokens,
          0,
        ),
      },
      activity: {
        subagents: sequence.eventStreams.reduce(
          (total, stream) => total + stream.subagents,
          0,
        ),
        tools: [
          ...new Set(sequence.eventStreams.flatMap((stream) => stream.tools)),
        ],
      },
      credentialEgress: brokerResult.receipt,
      isolation: {
        backend: "gvisor",
        runtime: "runsc",
        fallbackUsed: false,
      },
      checkpoint: execution.checkpoint,
      report,
    });
  }
}

export function openDeepSeekHarnessNativeAgentRuntime(
  options: DeepSeekHarnessNativeAgentRuntimeOptions,
): NativeAgentRuntime {
  return new DeepSeekHarnessNativeAgentRuntime(options);
}
