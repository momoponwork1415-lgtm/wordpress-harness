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
import { decodeClaudeEnvelope } from "./claude-envelope.js";

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

    const decoded = finderOutputSchema.safeParse(envelope.output);
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
