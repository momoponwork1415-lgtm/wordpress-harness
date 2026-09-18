import { readFile } from "node:fs/promises";

import { z } from "zod";

import {
  failedNativeRunReceipt,
  GvisorAgentSandbox,
  refusedNativeRunReceipt,
  type GvisorAgentRuntimeOptions,
  type SandboxedAgentCommand,
} from "./gvisor-agent-sandbox.js";
import {
  nativeRunReceiptSchema,
  type NativeRunReceipt,
  type NativeAgentRuntime,
  type SealedNativeRun,
} from "./contracts.js";
import { providerResearchReportSchema } from "./provider-research-report.js";

const codexTransportEligibility = {
  schemaVersion: 1,
  imageDigest:
    "sha256:44342fc7bc7d6e6dd6c7445ebf23d0d6f414fc22c61fab69e158ab0fa7ba5a73",
  executableVersion: "0.146.0",
  model: "gpt-daybreak-blue-latest",
  efforts: new Set<string>(["xhigh", "max"]),
  probedAt: "2026-09-08T12:44:00.000Z",
} as const;

const sourceReaderTools = new Set(["list_files", "read_text", "search_text"]);
const collabTools = new Set([
  "spawn_agent",
  "send_input",
  "wait",
  "close_agent",
]);

const threadStartedEventSchema = z.looseObject({
  type: z.literal("thread.started"),
  thread_id: z.uuid(),
});
const turnCompletedEventSchema = z.looseObject({
  type: z.literal("turn.completed"),
  usage: z.looseObject({
    input_tokens: z.number().int().nonnegative(),
    cached_input_tokens: z.number().int().nonnegative(),
    cache_write_input_tokens: z.number().int().nonnegative().default(0),
    output_tokens: z.number().int().nonnegative(),
    reasoning_output_tokens: z.number().int().nonnegative(),
  }),
});
const itemEventSchema = z.looseObject({
  type: z.enum(["item.started", "item.updated", "item.completed"]),
  item: z.looseObject({
    type: z.string().min(1),
  }),
});

interface CodexTranscript {
  readonly sessionId: string;
  readonly reportValue: unknown;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly subagents: number;
  readonly tools: readonly string[];
  readonly policyViolation: boolean;
}

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

function transcript(stdout: string): CodexTranscript | undefined {
  const events = stdout
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map(parseJson);
  if (events.length === 0 || events.some((event) => event === undefined)) {
    return undefined;
  }
  let sessionId: string | undefined;
  let reportText: string | undefined;
  let inputTokens: number | undefined;
  let outputTokens: number | undefined;
  let policyViolation = false;
  const tools: string[] = [];
  const subagentIds = new Set<string>();
  for (const event of events) {
    const started = threadStartedEventSchema.safeParse(event);
    if (started.success) {
      if (sessionId !== undefined) return undefined;
      sessionId = started.data.thread_id;
      continue;
    }
    const completed = turnCompletedEventSchema.safeParse(event);
    if (completed.success) {
      if (inputTokens !== undefined || outputTokens !== undefined) {
        return undefined;
      }
      inputTokens =
        completed.data.usage.input_tokens +
        completed.data.usage.cached_input_tokens +
        completed.data.usage.cache_write_input_tokens;
      outputTokens = completed.data.usage.output_tokens;
      continue;
    }
    const item = itemEventSchema.safeParse(event);
    if (item.success) {
      const value = item.data.item;
      if (value.type === "agent_message") {
        if (
          item.data.type === "item.completed" &&
          typeof value.text === "string"
        ) {
          reportText = value.text;
        }
        continue;
      }
      if (
        value.type === "reasoning" ||
        value.type === "todo_list" ||
        value.type === "error"
      ) {
        continue;
      }
      if (value.type === "mcp_tool_call") {
        const allowed =
          value.server === "source_reader" &&
          typeof value.tool === "string" &&
          sourceReaderTools.has(value.tool);
        if (!allowed) policyViolation = true;
        if (allowed && item.data.type === "item.completed") {
          if (value.status === "completed") {
            tools.push(`source_reader.${String(value.tool)}`);
          }
        }
        continue;
      }
      if (value.type === "collab_tool_call") {
        const allowed =
          typeof value.tool === "string" && collabTools.has(value.tool);
        if (!allowed) {
          policyViolation = true;
          continue;
        }
        if (item.data.type === "item.completed") {
          tools.push(`collab.${String(value.tool)}`);
          if (
            value.tool === "spawn_agent" &&
            value.status === "completed" &&
            Array.isArray(value.receiver_thread_ids)
          ) {
            for (const receiver of value.receiver_thread_ids) {
              if (typeof receiver === "string") subagentIds.add(receiver);
            }
          }
        }
        continue;
      }
      policyViolation = true;
      continue;
    }
    if (
      z.object({ type: z.literal("turn.started") }).safeParse(event).success
    ) {
      continue;
    }
    return undefined;
  }
  if (
    sessionId === undefined ||
    reportText === undefined ||
    inputTokens === undefined ||
    outputTokens === undefined
  ) {
    return undefined;
  }
  const reportValue = parseJson(reportText);
  if (reportValue === undefined) return undefined;
  return {
    sessionId,
    reportValue,
    inputTokens,
    outputTokens,
    subagents: subagentIds.size,
    tools,
    policyViolation,
  };
}

function sessionIdFromOutput(stdout: string): string | undefined {
  let sessionId: string | undefined;
  for (const line of stdout.split("\n")) {
    if (line.trim().length === 0) continue;
    const event = parseJson(line);
    const started = threadStartedEventSchema.safeParse(event);
    if (!started.success) continue;
    if (sessionId !== undefined && sessionId !== started.data.thread_id) {
      return undefined;
    }
    sessionId = started.data.thread_id;
  }
  return sessionId;
}

function jsonObject(value: unknown): Record<string, unknown> {
  return z.record(z.string(), z.unknown()).parse(value);
}

function nullableJsonSchema(value: unknown): Record<string, unknown> {
  return { anyOf: [value, { type: "null" }] };
}

function researchTransportSchema(): Record<string, unknown> {
  const schema = jsonObject(z.toJSONSchema(providerResearchReportSchema));
  delete schema.$schema;
  const properties = jsonObject(schema.properties);
  const required = z.array(z.string()).parse(schema.required);
  const candidates = jsonObject(properties.candidates);
  const candidate = jsonObject(candidates.items);
  const candidateProperties = jsonObject(candidate.properties);
  const candidateRequired = z.array(z.string()).parse(candidate.required);
  candidateProperties.reproductionRecipe = nullableJsonSchema(
    candidateProperties.reproductionRecipe,
  );
  candidate.properties = candidateProperties;
  candidate.required = [...candidateRequired, "reproductionRecipe"];
  candidates.items = candidate;
  properties.candidates = candidates;
  const assessments = jsonObject(properties.assessments);
  const assessment = jsonObject(assessments.items);
  const assessmentBranches = z
    .array(z.unknown())
    .min(2)
    .parse(assessment.oneOf);
  const refutedAssessment = jsonObject(assessmentBranches[0]);
  const blockedAssessment = jsonObject(assessmentBranches[1]);
  const assessmentProperties = jsonObject(refutedAssessment.properties);
  const blockedAssessmentProperties = jsonObject(blockedAssessment.properties);
  const assessmentRequired = z
    .array(z.string())
    .parse(refutedAssessment.required);
  assessmentProperties.disposition = {
    type: "string",
    enum: ["refuted", "blocked"],
  };
  assessmentProperties.unresolvedFacts = nullableJsonSchema(
    blockedAssessmentProperties.unresolvedFacts,
  );
  assessments.items = {
    type: "object",
    properties: assessmentProperties,
    required: [...assessmentRequired, "unresolvedFacts"],
    additionalProperties: false,
  };
  properties.assessments = assessments;
  const decision = jsonObject(properties.decision);
  const branches = z.array(z.unknown()).min(2).parse(decision.oneOf);
  const continueProperties = jsonObject(jsonObject(branches[0]).properties);
  const stopProperties = jsonObject(jsonObject(branches[1]).properties);
  properties.decision = {
    type: "object",
    properties: {
      kind: { type: "string", enum: ["continue", "stop"] },
      reason: nullableJsonSchema(continueProperties.reason),
      nextActions: nullableJsonSchema(continueProperties.nextActions),
      basis: nullableJsonSchema(stopProperties.basis),
    },
    required: ["kind", "reason", "nextActions", "basis"],
    additionalProperties: false,
  };
  schema.properties = properties;
  schema.required = [...required, "parkedProgrammeLeads"];
  return schema;
}

function codexSchema(): string {
  return JSON.stringify(researchTransportSchema());
}

function normalizeTransportReport(value: unknown): unknown {
  const report = jsonObject(value);
  const candidates = z
    .array(z.unknown())
    .parse(report.candidates)
    .map((value) => {
      const candidate = jsonObject(value);
      if (candidate.reproductionRecipe !== null) return candidate;
      const { reproductionRecipe: _recipe, ...normalizedCandidate } = candidate;
      return normalizedCandidate;
    });
  const assessments = z
    .array(z.unknown())
    .parse(report.assessments)
    .map((value) => {
      const assessment = jsonObject(value);
      if (
        assessment.disposition !== "refuted" ||
        assessment.unresolvedFacts !== null
      ) {
        return assessment;
      }
      const { unresolvedFacts: _unresolvedFacts, ...normalizedAssessment } =
        assessment;
      return normalizedAssessment;
    });
  const decision = jsonObject(report.decision);
  if (decision.kind === "continue") {
    const { basis: _basis, ...normalizedDecision } = decision;
    return {
      ...report,
      candidates,
      assessments,
      decision: normalizedDecision,
    };
  }
  if (decision.kind === "stop") {
    const {
      reason: _reason,
      nextActions: _nextActions,
      ...normalizedDecision
    } = decision;
    return {
      ...report,
      candidates,
      assessments,
      decision: normalizedDecision,
    };
  }
  return { ...report, candidates, assessments };
}

function transportPrompt(prompt: string): string {
  return `${prompt}\n\nTransport requirement: always include parkedProgrammeLeads; use an empty array when there are none. Every candidate must include reproductionRecipe; set it to null when no private reproduction recipe is available. Every Research Assessment must include unresolvedFacts; set it to null for refuted and use a non-empty array for blocked. Decision must include kind, reason, nextActions, and basis. For continue, set basis to null. For stop, set reason and nextActions to null. These null placeholders are transport-only.`;
}

const managedRequirements = `allowed_web_search_modes = []
allow_browser_and_computer_use = false
allow_managed_hooks_only = true

[features]
apps = false
browser_use = false
computer_use = false
memories = false
multi_agent = true
plugins = false
remote_plugin = false
workspace_dependencies = false

[mcp_servers.source_reader.identity.command]
executable = "/usr/local/bin/node"

[[mcp_servers.source_reader.identity.command.args]]
match = "exact"
value = "/workspace/research/source-reader.js"
`;

export interface CodexNativeAgentRuntimeOptions extends GvisorAgentRuntimeOptions {
  readonly sourceReaderScript?: string;
}

class CodexNativeAgentRuntime implements NativeAgentRuntime {
  readonly #sandbox: GvisorAgentSandbox;
  readonly #transportAdmitted: boolean;
  readonly #sourceReaderScript: string | undefined;

  constructor(options: CodexNativeAgentRuntimeOptions) {
    this.#sandbox = new GvisorAgentSandbox(options);
    this.#transportAdmitted =
      imageDigest(options.image) === codexTransportEligibility.imageDigest;
    this.#sourceReaderScript = options.sourceReaderScript;
  }

  async #readerScript(): Promise<string> {
    return (
      this.#sourceReaderScript ??
      (await readFile(
        new URL("./codex-source-reader.js", import.meta.url),
        "utf8",
      ))
    );
  }

  async #command(run: SealedNativeRun): Promise<SandboxedAgentCommand> {
    return {
      executable: "codex",
      versionTokenIndex: 1,
      providerEnvironment: [
        "--env=CODEX_HOME=/provider",
        "--env=HOME=/tmp/home",
      ],
      supportFiles: [
        {
          filename: "source-reader.js",
          text: await this.#readerScript(),
        },
        {
          filename: "report-schema.json",
          text: codexSchema(),
        },
        {
          filename: "requirements.toml",
          text: managedRequirements,
          containerMountPath: "/etc/codex/requirements.toml",
        },
      ],
      ephemeralProviderCredentialFiles: ["auth.json"],
      ephemeralProviderHomeMount: { path: "/provider", mode: "rw" },
      researchSession: {
        newSessionArguments: () => ["-"],
        resumeSessionArguments: (sessionId: string) => [
          "resume",
          sessionId,
          "-",
        ],
        generatedSessionIdFromOutput: (stdout: string) =>
          sessionIdFromOutput(stdout),
      },
      args: [
        "exec",
        "--model",
        run.agentRuntimeProfile.model,
        "--sandbox",
        "read-only",
        "--skip-git-repo-check",
        "--ignore-user-config",
        "--ignore-rules",
        "--disable",
        "shell_tool",
        "--disable",
        "unified_exec",
        "--disable",
        "skill_mcp_dependency_install",
        "-c",
        'web_search="disabled"',
        "-c",
        "apps._default.enabled=false",
        "-c",
        "features.multi_agent=true",
        "-c",
        "agents.enabled=true",
        "-c",
        "agents.max_concurrent_threads_per_session=3",
        "-c",
        `model_reasoning_effort="${run.agentRuntimeProfile.effort}"`,
        "-c",
        "check_for_update_on_startup=false",
        "-c",
        "feedback.enabled=false",
        "-c",
        'history.persistence="none"',
        "-c",
        'mcp_servers.source_reader.command="/usr/local/bin/node"',
        "-c",
        'mcp_servers.source_reader.args=["/workspace/research/source-reader.js"]',
        "-c",
        "mcp_servers.source_reader.required=true",
        "-c",
        'mcp_servers.source_reader.default_tools_approval_mode="approve"',
        "--output-schema",
        "/workspace/research/report-schema.json",
        "--color",
        "never",
        "--json",
      ],
      prompt: {
        kind: "stdin",
        text: transportPrompt(this.#sandbox.prompt(run)),
      },
    };
  }

  async execute(run: SealedNativeRun): Promise<NativeRunReceipt> {
    if (
      run.agentRuntimeProfile.kind !== "codex-native/v1" ||
      !this.#transportAdmitted ||
      run.agentRuntimeProfile.executableVersion !==
        codexTransportEligibility.executableVersion ||
      run.agentRuntimeProfile.model !== codexTransportEligibility.model ||
      !codexTransportEligibility.efforts.has(run.agentRuntimeProfile.effort) ||
      !this.#sandbox.bindingMatches(run)
    ) {
      const now = this.#sandbox.now();
      return failedNativeRunReceipt(
        run,
        "policy-denied",
        "The sealed run does not match this Codex Agent Runtime binding.",
        now,
        now,
        false,
      );
    }

    let command: SandboxedAgentCommand;
    try {
      command = await this.#command(run);
    } catch {
      const now = this.#sandbox.now();
      return failedNativeRunReceipt(
        run,
        "policy-denied",
        "The sealed Codex source-reader runtime is unavailable.",
        now,
        now,
        false,
      );
    }
    const execution = await this.#sandbox.execute(run, command);
    if (execution.status === "failed") return execution.receipt;
    if (execution.status === "exited-nonzero") {
      return failedNativeRunReceipt(
        run,
        "provider-failed",
        "Codex exited without a completed result.",
        execution.startedAt,
        execution.completedAt,
        true,
        execution.checkpoint,
        execution.diagnostic,
        execution.failureStage,
      );
    }
    const decoded = transcript(execution.stdout);
    if (decoded === undefined) {
      const summary = "Codex returned an unsupported event transcript.";
      return refusedNativeRunReceipt(
        run,
        execution,
        "invalid-output",
        summary,
        execution.checkpoint,
      );
    }
    if (
      execution.checkpoint === undefined ||
      execution.checkpoint.sessionId !== decoded.sessionId
    ) {
      const summary = "Codex returned an unbound Research session.";
      return refusedNativeRunReceipt(
        run,
        execution,
        "policy-denied",
        summary,
        undefined,
      );
    }
    if (decoded.policyViolation) {
      const summary = "Codex violated the sealed model or tool policy.";
      return refusedNativeRunReceipt(
        run,
        execution,
        "policy-denied",
        summary,
        undefined,
      );
    }
    let normalizedReport: unknown;
    try {
      normalizedReport = normalizeTransportReport(decoded.reportValue);
    } catch {
      normalizedReport = decoded.reportValue;
    }
    let report;
    try {
      report = await this.#sandbox.materializeReport(run, normalizedReport);
    } catch {
      const summary = "Codex returned an unsupported Agent Report.";
      return refusedNativeRunReceipt(
        run,
        execution,
        "invalid-output",
        summary,
        execution.checkpoint,
      );
    }
    const receipt = {
      schemaVersion: 2,
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
        inputTokens: decoded.inputTokens,
        outputTokens: decoded.outputTokens,
      },
      activity: {
        subagents: decoded.subagents,
        tools: decoded.tools,
      },
      isolation: {
        backend: "gvisor",
        runtime: "runsc",
        fallbackUsed: false,
      },
      checkpoint: execution.checkpoint,
      report,
    };
    return nativeRunReceiptSchema.parse(receipt);
  }
}

export function openCodexNativeAgentRuntime(
  options: CodexNativeAgentRuntimeOptions,
): NativeAgentRuntime {
  return new CodexNativeAgentRuntime(options);
}
