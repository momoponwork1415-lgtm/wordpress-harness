import { z } from "zod";

import {
  finderOutputSchema,
  finderAttemptResultSchema,
} from "../exploration/contracts.js";
import { openFileJsonArtifactStore } from "../research-record/file-json-artifact-store.js";
import {
  attemptExecutionResultRefSchema,
  attemptPlanSchema,
  type AttemptExecutionResult,
  type AttemptPlan,
  type ModelExecution,
  type OpenModelExecutionOptions,
} from "./contracts.js";

const providerEnvelopeSchema = z.object({
  type: z.literal("result"),
  subtype: z.literal("success"),
  is_error: z.literal(false),
  terminal_reason: z.literal("completed"),
  structured_output: z.unknown(),
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
  modelUsage: z.record(
    z.string(),
    z.object({ canonicalModel: z.string().min(1) }),
  ),
});

class FirstFinderModelExecution implements ModelExecution {
  readonly #artifacts;
  readonly #process;

  constructor(options: OpenModelExecutionOptions) {
    this.#artifacts = openFileJsonArtifactStore(options.artifactDirectory);
    this.#process = options.process;
  }

  async run(planInput: AttemptPlan): Promise<AttemptExecutionResult> {
    const plan = attemptPlanSchema.parse(planInput);
    const outputJsonSchema = z.toJSONSchema(finderOutputSchema);
    delete outputJsonSchema.$schema;
    let processResult;
    try {
      processResult = await this.#process.execute({
        plan,
        outputJsonSchema,
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
    if (processResult.kind === "timed-out") {
      return this.#terminal(plan, "budget-exhausted", "wall-time-exceeded");
    }
    if (processResult.kind === "output-limit-exceeded") {
      return this.#terminal(plan, "budget-exhausted", "output-limit-exceeded");
    }
    if (processResult.exitCode !== 0) {
      const errorDigest = await this.#artifacts.putJson({
        kind: "provider-error-artifact",
        schemaVersion: 1,
        attemptId: plan.attemptId,
        exitCode: processResult.exitCode,
        stderr: processResult.stderr,
      });
      return this.#terminal(
        plan,
        "provider-failed",
        `provider-exit-${processResult.exitCode}:${errorDigest}`,
      );
    }

    let envelope: z.infer<typeof providerEnvelopeSchema>;
    try {
      const parsed: unknown = JSON.parse(processResult.stdout);
      envelope = providerEnvelopeSchema.parse(parsed);
    } catch {
      return this.#terminal(
        plan,
        "invalid-output",
        "invalid-provider-envelope",
      );
    }
    if (
      envelope.permission_denials.length > 0 ||
      envelope.usage.server_tool_use.web_search_requests !== 0 ||
      envelope.usage.server_tool_use.web_fetch_requests !== 0 ||
      envelope.subagent_stats.spawned !== 0
    ) {
      return this.#terminal(plan, "policy-denied", "tool-free-policy-violated");
    }
    if (
      !Object.values(envelope.modelUsage).some(
        (usage) => usage.canonicalModel === plan.modelProfile.model,
      )
    ) {
      return this.#terminal(plan, "policy-denied", "model-substitution");
    }

    const decoded = finderOutputSchema.safeParse(envelope.structured_output);
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
    });
    return this.#store(value);
  }

  async #terminal(
    plan: AttemptPlan,
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
    const digest = await this.#artifacts.putJson(value);
    const ref = attemptExecutionResultRefSchema.parse({
      kind: "attempt-execution-result",
      schemaVersion: 1,
      attemptId: value.attemptId,
      leaseId: value.leaseId,
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
