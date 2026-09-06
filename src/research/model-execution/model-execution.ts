import { z } from "zod";

import {
  finderOutputSchema,
  finderAttemptResultSchema,
} from "../exploration/contracts.js";
import {
  canonicalJson,
  sha256Digest,
} from "../research-record/canonical-json.js";
import { openFileJsonArtifactStore } from "../research-record/file-json-artifact-store.js";
import { openVerifiedArtifacts } from "../../infrastructure/verified-artifacts.js";
import {
  sourceEvidenceQueryV1Schema,
  sourceEvidenceQueryV2Schema,
  type SourceEvidenceReceiptRefV2,
  type SourceEvidenceToolRequest,
  type SourceEvidenceToolRequestV2,
} from "../source-mapping/source-evidence-contracts.js";
import {
  attemptExecutionResultRefSchema,
  attemptExecutionResultV2RefSchema,
  attemptPlanSchema,
  attemptPlanV2Schema,
  modelAttemptUsageV2Schema,
  modelAttemptResultV2Schema,
  type AttemptExecutionResult,
  type AttemptExecutionResultV2,
  type AttemptSourceEvidence,
  type AttemptPlanV1,
  type AttemptPlanV2,
  type ModelAttemptPlan,
  type ModelAttemptObserver,
  type ModelAttemptUsageV2,
  type ModelExecution,
  type OpenModelExecutionOptions,
} from "./contracts.js";
import {
  decodeClaudeEnvelope,
  decodeClaudeErrorEnvelope,
  type ClaudeProviderUsage,
} from "./claude-envelope.js";

export function normalizeClaudeModelAttemptUsage(
  usage: ClaudeProviderUsage,
  output: unknown,
  startedAt: number,
  source: {
    readonly queries: number;
    readonly scanBytes: number;
    readonly responseBytes: number;
  },
): ModelAttemptUsageV2 {
  return modelAttemptUsageV2Schema.parse({
    kind: "model-attempt-usage",
    schemaVersion: 1,
    measurement: usage.measurement,
    ...(usage.estimatedCostUsd === undefined
      ? {}
      : { estimatedCostUsd: usage.estimatedCostUsd }),
    wallTimeMs: Math.ceil(performance.now() - startedAt),
    ...(usage.providerDurationMs === undefined
      ? {}
      : { providerDurationMs: usage.providerDurationMs }),
    modelTurns: usage.modelTurns,
    modelTokens: usage.models.reduce(
      (total, model) => ({
        input: total.input + model.tokens.input,
        cacheCreation: total.cacheCreation + model.tokens.cacheCreation,
        cacheRead: total.cacheRead + model.tokens.cacheRead,
        output: total.output + model.tokens.output,
        total: total.total + model.tokens.total,
      }),
      { input: 0, cacheCreation: 0, cacheRead: 0, output: 0, total: 0 },
    ),
    structuredOutputBytes: Buffer.byteLength(canonicalJson(output), "utf8"),
    source,
    models: usage.models,
  });
}

class FirstFinderModelExecution implements ModelExecution {
  readonly #artifacts;
  readonly #process;
  readonly #sourceEvidenceGateway;

  constructor(options: OpenModelExecutionOptions) {
    this.#artifacts = openVerifiedArtifacts(
      openFileJsonArtifactStore(options.artifactDirectory),
    );
    this.#process = options.process;
    this.#sourceEvidenceGateway = options.sourceEvidenceGateway;
  }

  async run(
    planInput: ModelAttemptPlan,
    observer?: ModelAttemptObserver,
  ): Promise<AttemptExecutionResult> {
    const parsedPlan = z
      .union([attemptPlanV2Schema, attemptPlanSchema])
      .parse(planInput);
    if (parsedPlan.schemaVersion === 2) {
      return this.#runV2(parsedPlan, observer);
    }
    const startedAt = performance.now();
    const plan = parsedPlan;
    const boundedFinderOutputSchema = finderOutputSchema.extend({
      hypotheses: finderOutputSchema.shape.hypotheses.max(
        plan.budget.maxHypotheses,
      ),
      routeFragments: finderOutputSchema.shape.routeFragments
        .unwrap()
        .max(plan.budget.maxHypotheses)
        .optional(),
    });
    const outputJsonSchema = z.toJSONSchema(boundedFinderOutputSchema);
    delete outputJsonSchema.$schema;
    if (
      plan.sourceToolPolicy !== undefined &&
      (this.#sourceEvidenceGateway === undefined ||
        this.#sourceEvidenceGateway.policy.id !== plan.sourceToolPolicy.id ||
        this.#sourceEvidenceGateway.policy.digest !==
          plan.sourceToolPolicy.digest)
    ) {
      return this.#terminal(
        plan,
        "policy-denied",
        "source-tool-policy-mismatch",
      );
    }
    if (
      plan.sourceToolPolicy !== undefined &&
      plan.budget.maxSourceQueries === undefined
    ) {
      return this.#terminal(
        plan,
        "policy-denied",
        "source-tool-budget-missing",
      );
    }
    const sourceEvidenceGateway = this.#sourceEvidenceGateway;
    let sourceQueryCount = 0;
    let sourceScanBytes = 0;
    let sourceResponseBytes = 0;
    const sourceEvidence: AttemptSourceEvidence | undefined =
      plan.sourceToolPolicy === undefined || sourceEvidenceGateway === undefined
        ? undefined
        : {
            schemaVersion: 1,
            query: (async (request: SourceEvidenceToolRequest) => {
              const receipt = await sourceEvidenceGateway.query(
                sourceEvidenceQueryV1Schema.parse({
                  ...request,
                  attemptId: plan.attemptId,
                  leaseId: plan.leaseId,
                  targetSnapshot: plan.target,
                  policy: plan.sourceToolPolicy,
                  budget: {
                    maxQueries: plan.budget.maxSourceQueries,
                    queryOrdinal: (sourceQueryCount += 1),
                  },
                }),
              );
              if (receipt.response?.kind === "source-search-response") {
                sourceScanBytes += receipt.response.scanned.bytes;
              }
              if (receipt.response !== null) {
                sourceResponseBytes += Buffer.byteLength(
                  canonicalJson(receipt.response),
                  "utf8",
                );
              }
              return receipt;
            }) as AttemptSourceEvidence["query"],
          };
    let processResult;
    try {
      processResult = await this.#process.execute({
        plan,
        outputJsonSchema,
        ...(sourceEvidence === undefined ? {} : { sourceEvidence }),
      });
    } catch (error: unknown) {
      return this.#terminal(
        plan,
        "provider-failed",
        error instanceof Error ? error.message : "Provider process failed",
      );
    }
    if (processResult.kind === "auth-required") {
      return this.#terminal(plan, "auth-required", processResult.reason);
    }
    if (processResult.kind === "policy-denied") {
      return this.#terminal(plan, "policy-denied", processResult.reason);
    }
    if (processResult.kind === "timed-out") {
      return this.#terminal(plan, "budget-exhausted", "wall-time-exceeded");
    }
    if (processResult.kind === "output-limit-exceeded") {
      return this.#terminal(plan, "budget-exhausted", "output-limit-exceeded");
    }
    if (processResult.exitCode !== 0) {
      const providerError = decodeClaudeErrorEnvelope(processResult.stdout);
      const errorDigest = await this.#artifacts.put("Provider error artifact", {
        kind: "provider-error-artifact",
        schemaVersion: 1,
        attemptId: plan.attemptId,
        exitCode: processResult.exitCode,
        stderr: processResult.stderr,
        ...(providerError === undefined ? {} : { providerError }),
      });
      return this.#terminal(
        plan,
        "provider-failed",
        `provider-exit-${processResult.exitCode}:${errorDigest}`,
      );
    }

    const envelope = decodeClaudeEnvelope(
      processResult.stdout,
      plan.modelProfile.model,
    );
    if (envelope.kind === "invalid-envelope") {
      return this.#terminal(
        plan,
        "invalid-output",
        "invalid-provider-envelope",
      );
    }
    if (envelope.kind === "policy-denied") {
      return this.#terminal(plan, "policy-denied", envelope.reason);
    }

    const decoded = boundedFinderOutputSchema.safeParse(envelope.output);
    if (!decoded.success || decoded.data.leaseId !== plan.leaseId) {
      return this.#terminal(plan, "invalid-output", "invalid-finder-output");
    }
    const value = finderAttemptResultSchema.parse({
      kind: "finder-attempt-result",
      schemaVersion: 1,
      attemptId: plan.attemptId,
      leaseId: plan.leaseId,
      status: "completed",
      output: decoded.data,
      usage: modelAttemptUsageV2Schema.parse({
        kind: "model-attempt-usage",
        schemaVersion: 1,
        measurement: envelope.usage.measurement,
        wallTimeMs: Math.ceil(performance.now() - startedAt),
        ...(envelope.usage.providerDurationMs === undefined
          ? {}
          : { providerDurationMs: envelope.usage.providerDurationMs }),
        modelTurns: envelope.usage.modelTurns,
        modelTokens: envelope.usage.models.reduce(
          (total, model) => ({
            input: total.input + model.tokens.input,
            cacheCreation: total.cacheCreation + model.tokens.cacheCreation,
            cacheRead: total.cacheRead + model.tokens.cacheRead,
            output: total.output + model.tokens.output,
            total: total.total + model.tokens.total,
          }),
          { input: 0, cacheCreation: 0, cacheRead: 0, output: 0, total: 0 },
        ),
        structuredOutputBytes: Buffer.byteLength(
          canonicalJson(envelope.output),
          "utf8",
        ),
        source: {
          queries: sourceQueryCount,
          scanBytes: sourceScanBytes,
          responseBytes: sourceResponseBytes,
        },
        models: envelope.usage.models,
      }),
    });
    return this.#store(value);
  }

  async #runV2(
    plan: AttemptPlanV2,
    observer?: ModelAttemptObserver,
  ): Promise<AttemptExecutionResultV2> {
    const startedAt = performance.now();
    const planDigest = sha256Digest(plan);
    const sourceEnabledRole =
      plan.role === "finder" ||
      plan.role === "root-planner" ||
      plan.role === "adversarial-critic" ||
      plan.role === "validator";
    if (
      sourceEnabledRole &&
      (this.#sourceEvidenceGateway === undefined ||
        this.#sourceEvidenceGateway.policy.id !== plan.sourceToolPolicy.id ||
        this.#sourceEvidenceGateway.policy.digest !==
          plan.sourceToolPolicy.digest)
    ) {
      return this.#terminalV2(
        plan,
        planDigest,
        "policy-denied",
        "source-tool-policy-mismatch",
      );
    }

    const sourceEvidenceGateway = this.#sourceEvidenceGateway;
    const sourceEvidenceReceipts: SourceEvidenceReceiptRefV2[] = [];
    let sourceScanBytes = 0;
    let sourceResponseBytes = 0;
    let sourceQueryCount = 0;
    let sourceReadCount = 0;
    let sourceToolTerminal:
      | {
          readonly status: "policy-denied" | "budget-exhausted";
          readonly reason: string;
        }
      | undefined;
    const sourceEvidence: AttemptSourceEvidence | undefined =
      !sourceEnabledRole || sourceEvidenceGateway === undefined
        ? undefined
        : {
            schemaVersion: 2,
            query: (async (request: SourceEvidenceToolRequestV2) => {
              if (sourceToolTerminal !== undefined) {
                throw new Error(sourceToolTerminal.reason);
              }
              const receipt = await sourceEvidenceGateway.query(
                sourceEvidenceQueryV2Schema.parse({
                  ...request,
                  schemaVersion: 2,
                  attemptId: plan.attemptId,
                  assignment: plan.assignment,
                  targetSnapshot: {
                    id: plan.target.id,
                    digest: plan.target.digest,
                  },
                  manifest: plan.manifest,
                  policy: plan.sourceToolPolicy,
                  budget: {
                    maxQueries: plan.budget.maxSourceQueries,
                  },
                  queryOrdinal: (sourceQueryCount += 1),
                }),
              );
              sourceEvidenceReceipts.push(receipt.ref);
              if (receipt.value.operation === "search") {
                sourceScanBytes += receipt.value.usage.bytes;
              }
              if (receipt.response?.kind === "source-read-response") {
                sourceReadCount += 1;
              }
              if (receipt.response !== null) {
                sourceResponseBytes += Buffer.byteLength(
                  canonicalJson(receipt.response),
                  "utf8",
                );
              }
              const result = receipt.value.result;
              if (
                sourceToolTerminal === undefined &&
                result.status === "policy-denied"
              ) {
                sourceToolTerminal = {
                  status: "policy-denied",
                  reason: `source-tool-policy-denied:${result.reason}`,
                };
              } else if (
                sourceToolTerminal === undefined &&
                result.status === "budget-exhausted"
              ) {
                sourceToolTerminal = {
                  status: "budget-exhausted",
                  reason: `source-tool-budget-exhausted:${result.reason}`,
                };
              }
              if (
                sourceToolTerminal === undefined &&
                plan.budget.maxSourceScanBytes !== undefined &&
                sourceScanBytes > plan.budget.maxSourceScanBytes
              ) {
                sourceToolTerminal = {
                  status: "budget-exhausted",
                  reason:
                    "source-tool-budget-exhausted:source-scan-limit-exceeded",
                };
              }
              if (
                sourceToolTerminal === undefined &&
                plan.budget.maxSourceResponseBytes !== undefined &&
                sourceResponseBytes > plan.budget.maxSourceResponseBytes
              ) {
                sourceToolTerminal = {
                  status: "budget-exhausted",
                  reason:
                    "source-tool-budget-exhausted:source-response-limit-exceeded",
                };
              }
              return receipt;
            }) as AttemptSourceEvidence["query"],
            ...(plan.role !== "finder" || observer === undefined
              ? {}
              : {
                  checkpoint: (subject: unknown) =>
                    observer.checkpoint(subject),
                }),
          };

    let processResult;
    try {
      processResult = await this.#process.execute({
        plan,
        outputJsonSchema: plan.outputJsonSchema,
        ...(sourceEvidence === undefined ? {} : { sourceEvidence }),
      });
    } catch (error: unknown) {
      return this.#terminalV2(
        plan,
        planDigest,
        "provider-failed",
        error instanceof Error ? error.message : "Provider process failed",
        sourceEvidenceReceipts,
      );
    }
    if (processResult.kind === "auth-required") {
      return this.#terminalV2(
        plan,
        planDigest,
        "auth-required",
        processResult.reason,
        sourceEvidenceReceipts,
      );
    }
    if (processResult.kind === "policy-denied") {
      return this.#terminalV2(
        plan,
        planDigest,
        "policy-denied",
        processResult.reason,
        sourceEvidenceReceipts,
      );
    }
    if (processResult.kind === "timed-out") {
      return this.#terminalV2(
        plan,
        planDigest,
        "budget-exhausted",
        "wall-time-exceeded",
        sourceEvidenceReceipts,
      );
    }
    if (processResult.kind === "output-limit-exceeded") {
      return this.#terminalV2(
        plan,
        planDigest,
        "budget-exhausted",
        "output-limit-exceeded",
        sourceEvidenceReceipts,
      );
    }
    const sourceTerminalEnvelope = decodeClaudeEnvelope(
      processResult.stdout,
      plan.modelProfile.model,
    );
    if (
      sourceToolTerminal !== undefined &&
      !(
        sourceToolTerminal.status === "budget-exhausted" &&
        "sourceLimitTerminalOutput" in plan.budget &&
        plan.budget.sourceLimitTerminalOutput === "preserve" &&
        sourceTerminalEnvelope.kind === "accepted"
      )
    ) {
      const usage =
        sourceTerminalEnvelope.kind === "accepted"
          ? normalizeClaudeModelAttemptUsage(
              sourceTerminalEnvelope.usage,
              sourceTerminalEnvelope.output,
              startedAt,
              {
                queries: sourceEvidenceReceipts.length,
                scanBytes: sourceScanBytes,
                responseBytes: sourceResponseBytes,
              },
            )
          : undefined;
      return this.#terminalV2(
        plan,
        planDigest,
        sourceToolTerminal.status,
        sourceToolTerminal.reason,
        sourceEvidenceReceipts,
        usage,
      );
    }
    if (processResult.exitCode !== 0) {
      const providerError = decodeClaudeErrorEnvelope(processResult.stdout);
      const errorDigest = await this.#artifacts.put("Provider error artifact", {
        kind: "provider-error-artifact",
        schemaVersion: 2,
        attemptId: plan.attemptId,
        exitCode: processResult.exitCode,
        stderr: processResult.stderr,
        ...(providerError === undefined ? {} : { providerError }),
      });
      return this.#terminalV2(
        plan,
        planDigest,
        "provider-failed",
        `provider-exit-${processResult.exitCode}:${errorDigest}`,
        sourceEvidenceReceipts,
      );
    }
    if (
      (plan.role === "root-planner" ||
        plan.role === "adversarial-critic" ||
        plan.role === "validator") &&
      sourceReadCount === 0
    ) {
      return this.#terminalV2(
        plan,
        planDigest,
        "invalid-output",
        plan.role === "root-planner"
          ? "recon-source-read-required"
          : plan.role === "adversarial-critic"
            ? "critic-source-read-required"
            : "validator-source-read-required",
        sourceEvidenceReceipts,
        sourceTerminalEnvelope.kind === "accepted"
          ? normalizeClaudeModelAttemptUsage(
              sourceTerminalEnvelope.usage,
              sourceTerminalEnvelope.output,
              startedAt,
              {
                queries: sourceEvidenceReceipts.length,
                scanBytes: sourceScanBytes,
                responseBytes: sourceResponseBytes,
              },
            )
          : undefined,
      );
    }

    const envelope = decodeClaudeEnvelope(
      processResult.stdout,
      plan.modelProfile.model,
    );
    if (envelope.kind === "invalid-envelope") {
      return this.#terminalV2(
        plan,
        planDigest,
        "invalid-output",
        "invalid-provider-envelope",
        sourceEvidenceReceipts,
      );
    }
    if (envelope.kind === "policy-denied") {
      return this.#terminalV2(
        plan,
        planDigest,
        "policy-denied",
        envelope.reason,
        sourceEvidenceReceipts,
      );
    }

    const usage = normalizeClaudeModelAttemptUsage(
      envelope.usage,
      envelope.output,
      startedAt,
      {
        queries: sourceEvidenceReceipts.length,
        scanBytes: sourceScanBytes,
        responseBytes: sourceResponseBytes,
      },
    );
    if (usage.measurement !== "reported") {
      return this.#terminalV2(
        plan,
        planDigest,
        "provider-failed",
        "provider-usage-incomplete",
        sourceEvidenceReceipts,
        usage,
      );
    }
    if (
      plan.budget.reportedUsageEnforcement !== "telemetry-only" &&
      usage.modelTurns > plan.budget.maxModelTurns
    ) {
      return this.#terminalV2(
        plan,
        planDigest,
        "budget-exhausted",
        "model-turn-limit-exceeded",
        sourceEvidenceReceipts,
        usage,
      );
    }
    if (
      plan.budget.reportedUsageEnforcement !== "telemetry-only" &&
      usage.modelTokens.total > plan.budget.maxModelTokens
    ) {
      return this.#terminalV2(
        plan,
        planDigest,
        "budget-exhausted",
        "model-token-limit-exceeded",
        sourceEvidenceReceipts,
        usage,
      );
    }
    if (
      usage.estimatedCostUsd !== undefined &&
      usage.estimatedCostUsd > plan.budget.maxProviderCostUsd
    ) {
      return this.#terminalV2(
        plan,
        planDigest,
        "budget-exhausted",
        "provider-cost-limit-exceeded",
        sourceEvidenceReceipts,
        usage,
      );
    }

    return this.#storeV2(
      modelAttemptResultV2Schema.parse({
        kind: "model-attempt-result",
        schemaVersion: 2,
        attemptId: plan.attemptId,
        owner: plan.owner,
        role: plan.role,
        planDigest,
        status: "completed",
        output: envelope.output,
        usage,
        ...(sourceEvidenceReceipts.length === 0
          ? {}
          : { sourceEvidenceReceipts }),
      }),
    );
  }

  async #terminal(
    plan: AttemptPlanV1,
    status: Exclude<AttemptExecutionResult["status"], "completed">,
    reason: string,
  ): Promise<AttemptExecutionResult> {
    const value = finderAttemptResultSchema.parse({
      kind: "finder-attempt-result",
      schemaVersion: 1,
      attemptId: plan.attemptId,
      leaseId: plan.leaseId,
      status,
      reason,
    });
    return this.#store(value);
  }

  async #store(
    value: z.infer<typeof finderAttemptResultSchema>,
  ): Promise<AttemptExecutionResult> {
    const digest = await this.#artifacts.put("Finder Attempt result", value);
    const ref = attemptExecutionResultRefSchema.parse({
      kind: "attempt-execution-result",
      schemaVersion: 1,
      attemptId: value.attemptId,
      leaseId: value.leaseId,
      digest,
    });
    return { status: value.status, ref, value };
  }

  async #terminalV2(
    plan: AttemptPlanV2,
    planDigest: string,
    status: Exclude<AttemptExecutionResultV2["status"], "completed">,
    reason: string,
    sourceEvidenceReceipts: readonly SourceEvidenceReceiptRefV2[] = [],
    usage?: z.infer<typeof modelAttemptUsageV2Schema>,
  ): Promise<AttemptExecutionResultV2> {
    return this.#storeV2(
      modelAttemptResultV2Schema.parse({
        kind: "model-attempt-result",
        schemaVersion: 2,
        attemptId: plan.attemptId,
        owner: plan.owner,
        role: plan.role,
        planDigest,
        status,
        reason,
        ...(usage === undefined ? {} : { usage }),
        ...(sourceEvidenceReceipts.length === 0
          ? {}
          : { sourceEvidenceReceipts }),
      }),
    );
  }

  async #storeV2(
    value: ReturnType<typeof modelAttemptResultV2Schema.parse>,
  ): Promise<AttemptExecutionResultV2> {
    const digest = await this.#artifacts.put("Model Attempt result", value);
    const ref = attemptExecutionResultV2RefSchema.parse({
      kind: "attempt-execution-result",
      schemaVersion: 2,
      attemptId: value.attemptId,
      owner: value.owner,
      role: value.role,
      planDigest: value.planDigest,
      digest,
    });
    return { status: value.status, ref, value };
  }
}

export function openModelExecution(
  options: OpenModelExecutionOptions,
): ModelExecution {
  return new FirstFinderModelExecution(options);
}
