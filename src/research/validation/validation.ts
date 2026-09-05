import { z } from "zod";

import {
  attemptExecutionResultV2RefSchema,
  attemptPlanV2Schema,
  modelAttemptResultV2Schema,
  type AttemptExecutionResult,
  type AttemptExecutionResultV2Ref,
} from "../model-execution/contracts.js";
import {
  canonicalJson,
  sha256Digest,
} from "../research-record/canonical-json.js";
import {
  currentResearchAttackerScopePrompt,
  isWithinCurrentResearchAttackerScope,
} from "../current-research-attacker-scope.js";
import {
  currentValidationRecordSchema,
  currentValidationRecordRefSchema,
  currentValidationPlanSchema,
  singleValidationAttemptOutputSchema,
  validationCriteria,
  type OpenValidationOptions,
  type CurrentValidationPlan,
  type CurrentValidationRecordRef,
  type Validation,
  type ValidatorAttemptPlan,
} from "./contracts.js";

type CurrentValidationRecord = z.infer<typeof currentValidationRecordSchema>;
type ValidatorAttemptRecord = CurrentValidationRecord["validatorAttempt"];

function outputJsonSchema(schema: z.ZodType): Record<string, unknown> {
  const value = z.toJSONSchema(schema);
  delete value.$schema;
  return value;
}

function validatorAttempt(
  plan: CurrentValidationPlan,
  ordinal: 1 | 2 | 3,
  options: OpenValidationOptions,
): ValidatorAttemptPlan {
  const attemptId = `validator:${ordinal}:${sha256Digest({
    validationId: plan.validationId,
    threatContextId: plan.threatContext.id,
    validationPolicy: plan.validationPolicy,
    modelProfile: plan.validatorModelProfile,
    ...(options.attemptNamespace === undefined
      ? {}
      : { namespace: options.attemptNamespace }),
  }).slice("sha256:".length)}`;
  const attempt = attemptPlanV2Schema.parse({
    kind: "attempt-plan",
    schemaVersion: 2,
    attemptId,
    owner: "validation",
    role: "validator",
    target: plan.candidate.target,
    manifest: plan.manifest.ref,
    assignment: {
      kind: "candidate-validation",
      schemaVersion: 1,
      candidateId: plan.candidate.id,
      threatContextId: plan.threatContext.id,
      attemptOrdinal: ordinal,
    },
    promptSet: plan.promptSet,
    modelProfile: plan.validatorModelProfile,
    prompt: [
      "Act as a fresh source-only security Validator.",
      currentResearchAttackerScopePrompt,
      "Independently inspect the fixed Target source; do not trust discovery wording or use Finder conversation, scratch, or verdicts.",
      "Handle every rubric criterion exactly once as pass, fail, or unknown, with source evidence.",
      "Use needs-research only for a concrete source-decidable proof gap. Runtime reproduction alone is not a source proof gap.",
      "Include proofGap only for needs-research; omit proofGap for ready-for-runtime and disproven.",
      "Use disproven only for a decisive source contradiction supported by a failed rubric criterion.",
      "If no decisive source contradiction exists and the attacker premise, Security Effect, and a concrete runtime-testable route remain, return ready-for-runtime; rubric unknowns are allowed and must be preserved.",
      "Do not return rejected. Do not execute Target code, use a shell, assign severity, vote, or create a Finding.",
      `Validation input: ${canonicalJson({
        candidate: plan.candidate,
        threatContext: plan.threatContext,
        rubric: validationCriteria,
      })}`,
    ].join("\n"),
    outputJsonSchema: outputJsonSchema(singleValidationAttemptOutputSchema),
    sourceToolPolicy: plan.sourceToolPolicy,
    budget: plan.budget.validator,
  });
  if (attempt.role !== "validator") {
    throw new Error("Validator Attempt materialized with another role");
  }
  return attempt;
}

function manifestContains(
  plan: CurrentValidationPlan,
  anchor: { readonly path: string; readonly fileDigest: string },
): boolean {
  return plan.manifest.value.entries.some(
    (entry) => entry.path === anchor.path && entry.digest === anchor.fileDigest,
  );
}

function validatedExecution(
  plan: ValidatorAttemptPlan,
  result: AttemptExecutionResult,
):
  | {
      readonly kind: "completed";
      readonly execution: AttemptExecutionResultV2Ref;
      readonly output: unknown;
    }
  | {
      readonly kind: "failed";
      readonly execution?: AttemptExecutionResultV2Ref;
      readonly terminalStatus:
        | "invalid-output"
        | "policy-denied"
        | "auth-required"
        | "provider-failed"
        | "budget-exhausted"
        | "cancelled"
        | "orphaned";
      readonly reason: string;
    } {
  if (result.ref.schemaVersion !== 2 || result.value.schemaVersion !== 2) {
    return {
      kind: "failed",
      terminalStatus: "invalid-output",
      reason: "model-result-schema-mismatch",
    };
  }
  const ref = attemptExecutionResultV2RefSchema.safeParse(result.ref);
  const value = modelAttemptResultV2Schema.safeParse(result.value);
  const planDigest = sha256Digest(plan);
  if (
    !ref.success ||
    !value.success ||
    ref.data.owner !== "validation" ||
    value.data.owner !== "validation" ||
    ref.data.role !== plan.role ||
    value.data.role !== plan.role ||
    ref.data.attemptId !== plan.attemptId ||
    value.data.attemptId !== plan.attemptId ||
    ref.data.planDigest !== planDigest ||
    value.data.planDigest !== planDigest ||
    ref.data.digest !== sha256Digest(value.data) ||
    result.status !== value.data.status
  ) {
    return {
      kind: "failed",
      terminalStatus: "invalid-output",
      reason: "model-result-binding-mismatch",
    };
  }
  if (value.data.status !== "completed") {
    return {
      kind: "failed",
      execution: ref.data,
      terminalStatus: value.data.status,
      reason: value.data.reason,
    };
  }
  return {
    kind: "completed",
    execution: ref.data,
    output: value.data.output,
  };
}

async function persistExecutionResult(
  result: AttemptExecutionResult,
  execution: AttemptExecutionResultV2Ref | undefined,
  options: OpenValidationOptions,
): Promise<void> {
  if (execution === undefined) return;
  const value = modelAttemptResultV2Schema.parse(result.value);
  if (sha256Digest(value) !== execution.digest) {
    throw new Error("Validation Attempt result digest mismatch");
  }
  const storedDigest = await options.artifactStore.putJson(value);
  if (storedDigest !== execution.digest) {
    throw new Error(
      "Validation Attempt artifact store returned a foreign digest",
    );
  }
}

async function runValidator(
  plan: CurrentValidationPlan,
  options: OpenValidationOptions,
): Promise<ValidatorAttemptRecord> {
  const attempt = validatorAttempt(plan, 1, options);
  const result = await options.modelExecution.run(attempt);
  const executed = validatedExecution(attempt, result);
  await persistExecutionResult(result, executed.execution, options);
  if (executed.kind === "failed") {
    if (executed.execution === undefined) {
      throw new Error(executed.reason);
    }
    return {
      status: "failed",
      execution: {
        ...executed.execution,
        owner: "validation",
        role: "validator",
      },
      terminalStatus: executed.terminalStatus,
      reason: executed.reason,
    };
  }
  const output = singleValidationAttemptOutputSchema.safeParse(executed.output);
  if (
    !output.success ||
    output.data.candidateId !== plan.candidate.id ||
    output.data.criteria.some((criterion) =>
      criterion.evidence.some((anchor) => !manifestContains(plan, anchor)),
    ) ||
    output.data.proofGap?.currentEvidence.some(
      (anchor) => !manifestContains(plan, anchor),
    )
  ) {
    return {
      status: "failed",
      execution: {
        ...executed.execution,
        owner: "validation",
        role: "validator",
      },
      terminalStatus: "invalid-output",
      reason: "invalid-validator-output",
    };
  }
  return {
    status: "completed",
    execution: {
      ...executed.execution,
      owner: "validation",
      role: "validator",
    },
    output: output.data,
  };
}

async function storeRecord(
  record: CurrentValidationRecord,
  options: OpenValidationOptions,
): Promise<CurrentValidationRecordRef> {
  const value = currentValidationRecordSchema.parse(record);
  const digest = await options.artifactStore.putJson(value);
  if (digest !== sha256Digest(value)) {
    throw new Error(
      "Validation Record artifact store returned a foreign digest",
    );
  }
  return currentValidationRecordRefSchema.parse({
    kind: "validation-record",
    schemaVersion: 2,
    validationId: value.validationId,
    candidateId: value.candidateId,
    digest,
  });
}

class SingleSourceValidation implements Validation {
  readonly #options: OpenValidationOptions;

  constructor(options: OpenValidationOptions) {
    this.#options = options;
  }

  async validate(
    input: CurrentValidationPlan,
  ): Promise<CurrentValidationRecordRef> {
    const plan = currentValidationPlanSchema.parse(input);
    if (
      !isWithinCurrentResearchAttackerScope(plan.candidate.attackerPremise) ||
      !isWithinCurrentResearchAttackerScope(
        plan.threatContext.permittedAttacker,
      )
    ) {
      throw new Error(
        "Validation candidate exceeds the current research attacker scope",
      );
    }
    const planDigest = sha256Digest(plan);
    const validatorAttempt = await runValidator(plan, this.#options);
    if (validatorAttempt.status === "failed") {
      return storeRecord(
        {
          kind: "validation-record",
          schemaVersion: 2,
          validationId: plan.validationId,
          candidateId: plan.candidate.id,
          planDigest,
          validatorAttempt,
          status: "validation-pending",
          reason:
            validatorAttempt.reason === "invalid-validator-output"
              ? "invalid-validator-output"
              : "validator-attempt-failed",
        },
        this.#options,
      );
    }
    return storeRecord(
      {
        kind: "validation-record",
        schemaVersion: 2,
        validationId: plan.validationId,
        candidateId: plan.candidate.id,
        planDigest,
        validatorAttempt,
        status: validatorAttempt.output.proposedDisposition,
      },
      this.#options,
    );
  }
}

export function openValidation(options: OpenValidationOptions): Validation {
  return new SingleSourceValidation(options);
}
