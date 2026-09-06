import {
  findingAIReproductionHarnessExecutionSchema,
  type FindingAIReproductionHarnessExecution,
} from "./ai-reproduction-contracts.js";
import type { AIReproductionHarness } from "./ai-reproduction.js";
import type { GvisorWordPressEnvironmentProvisioner } from "./gvisor-wordpress-environment-provisioner.js";
import type { HumanVerificationEnvironmentBuilder } from "./human-verification-environment.js";
import { defineFindingVerificationEnvironmentRequest } from "./human-verification-environment-contracts.js";

export interface OpenGvisorAIReproductionHarnessOptions {
  readonly environmentBuilder: HumanVerificationEnvironmentBuilder;
  readonly provisioner: GvisorWordPressEnvironmentProvisioner<unknown>;
  readonly clock?: () => Date;
}

function setupReason(
  reason:
    | "isolation-capability-unavailable"
    | "isolation-inspection-failed"
    | "policy-violation"
    | "setup-failed"
    | "activation-failed"
    | "health-failed"
    | "effective-configuration-mismatch"
    | "target-runtime-identity-mismatch",
):
  | "isolation-unavailable"
  | "policy-violation"
  | "setup-failed"
  | "activation-failed"
  | "health-failed" {
  if (
    reason === "isolation-capability-unavailable" ||
    reason === "isolation-inspection-failed"
  ) {
    return "isolation-unavailable";
  }
  if (
    reason === "effective-configuration-mismatch" ||
    reason === "target-runtime-identity-mismatch"
  ) {
    return "setup-failed";
  }
  return reason;
}

class GvisorAIReproductionHarness implements AIReproductionHarness {
  readonly #options: OpenGvisorAIReproductionHarnessOptions;
  readonly #clock: () => Date;

  constructor(options: OpenGvisorAIReproductionHarnessOptions) {
    this.#options = options;
    this.#clock = options.clock ?? (() => new Date());
  }

  async run(input: Parameters<AIReproductionHarness["run"]>[0]) {
    const request = defineFindingVerificationEnvironmentRequest({
      finding: input.finding,
      target: input.attempt.target,
      runtimeProfile: input.attempt.runtimeProfile,
      setupPlan: input.attempt.setupPlan,
      policy: input.attempt.environmentPolicy,
      grants: input.attempt.grants,
    });
    let disposition;
    try {
      disposition = await this.#options.environmentBuilder.establish(request);
    } catch {
      return this.#inconclusive(
        "harness-failed",
        "The Environment Builder failed before a typed disposition.",
        "not-required",
      );
    }
    if (disposition.status === "setup-blocked") {
      return findingAIReproductionHarnessExecutionSchema.parse({
        kind: "finding-ai-reproduction-harness-execution",
        schemaVersion: 1,
        status: "setup-blocked",
        completedAt: this.#clock().toISOString(),
        reason: setupReason(disposition.reason),
        description: "The fresh gVisor environment could not be established.",
        cleanup: disposition.setupReceipt.cleanup,
      });
    }

    const environmentId = disposition.environment.id;
    if (!this.#options.provisioner.hasActiveEnvironment(environmentId)) {
      const cleanup = await this.#cleanup(environmentId);
      return this.#inconclusive(
        "environment-session-unavailable",
        "The durable ready disposition had no matching live gVisor session.",
        cleanup,
      );
    }

    let raw: unknown;
    try {
      raw = await this.#options.provisioner.runExperiment(
        environmentId,
        input.attempt,
      );
    } catch {
      const cleanup = await this.#cleanup(environmentId);
      return this.#inconclusive(
        "provider-failed",
        "The AI Reproduction provider failed during the bounded experiment.",
        cleanup,
      );
    }
    const cleanup = await this.#cleanup(environmentId);
    const parsed = findingAIReproductionHarnessExecutionSchema.safeParse({
      ...(typeof raw === "object" && raw !== null ? raw : {}),
      kind: "finding-ai-reproduction-harness-execution",
      schemaVersion: 1,
      completedAt: this.#clock().toISOString(),
      cleanup,
    });
    if (!parsed.success) {
      return this.#inconclusive(
        "harness-failed",
        "The AI Reproduction provider returned an invalid experiment outcome.",
        cleanup,
      );
    }
    if (parsed.data.status === "setup-blocked") {
      return this.#inconclusive(
        "harness-failed",
        "The experiment returned a setup outcome after the environment was ready.",
        cleanup,
      );
    }
    if (
      (parsed.data.status === "runtime-confirmed" ||
        parsed.data.status === "disproved") &&
      parsed.data.runtimeIdentity.environmentId !== environmentId
    ) {
      return this.#inconclusive(
        "environment-identity-mismatch",
        "The experiment identity did not match the live gVisor session.",
        cleanup,
      );
    }
    return findingAIReproductionHarnessExecutionSchema.parse({
      ...parsed.data,
      completedAt: this.#clock().toISOString(),
      cleanup,
    });
  }

  async #cleanup(environmentId: string): Promise<"completed" | "failed"> {
    try {
      return await this.#options.provisioner.cleanup({ environmentId });
    } catch {
      return "failed";
    }
  }

  #inconclusive(
    reason: Extract<
      FindingAIReproductionHarnessExecution,
      { readonly status: "inconclusive" }
    >["reason"],
    description: string,
    cleanup: "not-required" | "completed" | "failed",
  ): FindingAIReproductionHarnessExecution {
    return findingAIReproductionHarnessExecutionSchema.parse({
      kind: "finding-ai-reproduction-harness-execution",
      schemaVersion: 1,
      status: "inconclusive",
      completedAt: this.#clock().toISOString(),
      reason,
      description,
      cleanup,
    });
  }
}

export function openGvisorAIReproductionHarness(
  options: OpenGvisorAIReproductionHarnessOptions,
): AIReproductionHarness {
  return new GvisorAIReproductionHarness(options);
}
