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
  validationAttemptOutputSchema,
  validationCriteria,
  validationPlanSchema,
  validationRecordRefSchema,
  validationRecordSchema,
  validationSynthesisOutputSchema,
  type OpenValidationOptions,
  type Validation,
  type ValidationAttemptOutput,
  type ValidationPlan,
  type ValidationRecord,
  type ValidationRecordRef,
  type ValidationSynthesisAttemptPlan,
  type ValidationSynthesisOutput,
  type ValidatorAttemptPlan,
} from "./contracts.js";

type ValidatorAttemptRecord = ValidationRecord["validatorAttempts"][number];
type CompletedValidatorAttempt = Extract<
  ValidatorAttemptRecord,
  { status: "completed" }
>;
type SynthesisAttemptRecord = NonNullable<ValidationRecord["synthesisAttempt"]>;

function outputJsonSchema(schema: z.ZodType): Record<string, unknown> {
  const value = z.toJSONSchema(schema);
  delete value.$schema;
  return value;
}

function validatorAttempt(
  plan: ValidationPlan,
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
      "Independently inspect the fixed Target source; do not trust discovery wording and do not use another Validator's result.",
      "Handle every rubric criterion exactly once as pass, fail, or unknown, with source evidence.",
      "Use needs-research only for a concrete source-decidable proof gap. Runtime reproduction alone is not a source proof gap.",
      "Do not execute Target code, use a shell, assign severity, vote, or create a Finding.",
      `Validation input: ${canonicalJson({
        candidate: plan.candidate,
        threatContext: plan.threatContext,
        rubric: validationCriteria,
      })}`,
    ].join("\n"),
    outputJsonSchema: outputJsonSchema(validationAttemptOutputSchema),
    sourceToolPolicy: plan.sourceToolPolicy,
    budget: plan.budget.validator,
  });
  if (attempt.role !== "validator") {
    throw new Error("Validator Attempt materialized with another role");
  }
  return attempt;
}

function synthesisAttempt(
  plan: ValidationPlan,
  attempts: readonly CompletedValidatorAttempt[],
  options: OpenValidationOptions,
): ValidationSynthesisAttemptPlan {
  const validatorAttemptDigests = attempts.map(
    (attempt) => attempt.execution.digest,
  );
  const attemptId = `validation-synthesizer:${sha256Digest({
    validationId: plan.validationId,
    validatorAttemptDigests,
    validationPolicy: plan.validationPolicy,
    modelProfile: plan.synthesisModelProfile,
    ...(options.attemptNamespace === undefined
      ? {}
      : { namespace: options.attemptNamespace }),
  }).slice("sha256:".length)}`;
  const attempt = attemptPlanV2Schema.parse({
    kind: "attempt-plan",
    schemaVersion: 2,
    attemptId,
    owner: "validation",
    role: "validation-synthesizer",
    target: plan.candidate.target,
    manifest: plan.manifest.ref,
    assignment: {
      kind: "validation-synthesis",
      schemaVersion: 1,
      candidateId: plan.candidate.id,
      validatorAttemptDigests,
    },
    promptSet: plan.promptSet,
    modelProfile: plan.synthesisModelProfile,
    prompt: [
      "Act as a fresh tool-free Validation Synthesizer.",
      "Use only the supplied rubric results and cite evidence by Attempt ID, criterion, and evidence index.",
      "Do not add source claims, routes, anchors, severity, or evidence. Do not decide by support count or majority vote.",
      "If material factual conflict remains, return needs-research and select an existing Attempt proof gap.",
      "Do not create a Finding.",
      `Validation Attempts: ${canonicalJson(
        attempts.map((value) => ({
          attemptId: value.execution.attemptId,
          output: value.output,
        })),
      )}`,
    ].join("\n"),
    outputJsonSchema: outputJsonSchema(validationSynthesisOutputSchema),
    budget: plan.budget.synthesis,
  });
  if (attempt.role !== "validation-synthesizer") {
    throw new Error("Validation Synthesis materialized with another role");
  }
  return attempt;
}

function manifestContains(
  plan: ValidationPlan,
  anchor: { readonly path: string; readonly fileDigest: string },
): boolean {
  return plan.manifest.value.entries.some(
    (entry) => entry.path === anchor.path && entry.digest === anchor.fileDigest,
  );
}

function validatedExecution(
  plan: ValidatorAttemptPlan | ValidationSynthesisAttemptPlan,
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
  plan: ValidationPlan,
  ordinal: 1 | 2 | 3,
  options: OpenValidationOptions,
): Promise<ValidatorAttemptRecord> {
  const attempt = validatorAttempt(plan, ordinal, options);
  const result = await options.modelExecution.run(attempt);
  const executed = validatedExecution(attempt, result);
  await persistExecutionResult(result, executed.execution, options);
  if (executed.kind === "failed") {
    if (executed.execution === undefined) {
      throw new Error(executed.reason);
    }
    return {
      status: "failed",
      ordinal,
      execution: {
        ...executed.execution,
        owner: "validation",
        role: "validator",
      },
      terminalStatus: executed.terminalStatus,
      reason: executed.reason,
    };
  }
  const output = validationAttemptOutputSchema.safeParse(executed.output);
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
      ordinal,
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
    ordinal,
    execution: {
      ...executed.execution,
      owner: "validation",
      role: "validator",
    },
    output: output.data,
  };
}

function hasMaterialConflict(
  left: ValidationAttemptOutput,
  right: ValidationAttemptOutput,
): boolean {
  if (left.proposedDisposition !== right.proposedDisposition) return true;
  const rightCriteria = new Map(
    right.criteria.map((criterion) => [criterion.criterion, criterion.status]),
  );
  return left.criteria.some(
    (criterion) => rightCriteria.get(criterion.criterion) !== criterion.status,
  );
}

function validateSynthesis(
  plan: ValidationPlan,
  attempts: readonly CompletedValidatorAttempt[],
  value: unknown,
): ValidationSynthesisOutput | undefined {
  const parsed = validationSynthesisOutputSchema.safeParse(value);
  if (!parsed.success || parsed.data.candidateId !== plan.candidate.id) {
    return undefined;
  }
  const attemptsById = new Map(
    attempts.map((attempt) => [attempt.execution.attemptId, attempt]),
  );
  for (const criterion of parsed.data.criteria) {
    let selectedStatusIsCited = false;
    for (const evidence of criterion.evidence) {
      const attempt = attemptsById.get(evidence.attemptId);
      const sourceCriterion = attempt?.output.criteria.find(
        (value) => value.criterion === evidence.criterion,
      );
      if (
        evidence.criterion !== criterion.criterion ||
        sourceCriterion === undefined ||
        new Set(evidence.evidenceIndexes).size !==
          evidence.evidenceIndexes.length ||
        evidence.evidenceIndexes.some(
          (index) => sourceCriterion.evidence[index] === undefined,
        )
      ) {
        return undefined;
      }
      if (sourceCriterion.status === criterion.status) {
        selectedStatusIsCited = true;
      }
    }
    if (!selectedStatusIsCited) {
      return undefined;
    }
  }
  if (parsed.data.disposition === "ready-for-human") {
    if (parsed.data.criteria.some((criterion) => criterion.status !== "pass")) {
      return undefined;
    }
  } else if (parsed.data.disposition === "needs-research") {
    const proofAttempt = attemptsById.get(parsed.data.proofGapAttemptId ?? "");
    if (
      !parsed.data.criteria.some(
        (criterion) => criterion.status === "unknown",
      ) ||
      proofAttempt?.output.proofGap === undefined
    ) {
      return undefined;
    }
  } else if (
    !parsed.data.criteria.some((criterion) => criterion.status === "fail")
  ) {
    return undefined;
  }
  return parsed.data;
}

async function runSynthesis(
  plan: ValidationPlan,
  attempts: readonly CompletedValidatorAttempt[],
  options: OpenValidationOptions,
): Promise<SynthesisAttemptRecord> {
  const attempt = synthesisAttempt(plan, attempts, options);
  const result = await options.modelExecution.run(attempt);
  const executed = validatedExecution(attempt, result);
  await persistExecutionResult(result, executed.execution, options);
  if (executed.kind === "failed") {
    if (executed.execution === undefined) throw new Error(executed.reason);
    return {
      status: "failed",
      execution: {
        ...executed.execution,
        owner: "validation",
        role: "validation-synthesizer",
      },
      terminalStatus: executed.terminalStatus,
      reason: executed.reason,
    };
  }
  const output = validateSynthesis(plan, attempts, executed.output);
  if (output === undefined) {
    return {
      status: "failed",
      execution: {
        ...executed.execution,
        owner: "validation",
        role: "validation-synthesizer",
      },
      terminalStatus: "invalid-output",
      reason: "invalid-synthesis",
    };
  }
  return {
    status: "completed",
    execution: {
      ...executed.execution,
      owner: "validation",
      role: "validation-synthesizer",
    },
    output,
  };
}

async function storeRecord(
  record: ValidationRecord,
  options: OpenValidationOptions,
): Promise<ValidationRecordRef> {
  const value = validationRecordSchema.parse(record);
  const digest = await options.artifactStore.putJson(value);
  if (digest !== sha256Digest(value)) {
    throw new Error(
      "Validation Record artifact store returned a foreign digest",
    );
  }
  return validationRecordRefSchema.parse({
    kind: "validation-record",
    schemaVersion: 1,
    validationId: value.validationId,
    candidateId: value.candidateId,
    digest,
  });
}

class FirstValidation implements Validation {
  readonly #options: OpenValidationOptions;

  constructor(options: OpenValidationOptions) {
    this.#options = options;
  }

  async validate(input: ValidationPlan): Promise<ValidationRecordRef> {
    const plan = validationPlanSchema.parse(input);
    const planDigest = sha256Digest(plan);
    const firstTwo = await Promise.all([
      runValidator(plan, 1, this.#options),
      runValidator(plan, 2, this.#options),
    ]);
    const completed = firstTwo.filter(
      (attempt): attempt is CompletedValidatorAttempt =>
        attempt.status === "completed",
    );
    if (completed.length !== 2) {
      return storeRecord(
        {
          kind: "validation-record",
          schemaVersion: 1,
          validationId: plan.validationId,
          candidateId: plan.candidate.id,
          planDigest,
          materialConflictAfterTwo: false,
          validatorAttempts: firstTwo,
          status: "validation-pending",
          reason: firstTwo.some(
            (attempt) =>
              attempt.status === "failed" &&
              attempt.reason === "invalid-validator-output",
          )
            ? "invalid-validator-output"
            : "validator-attempt-failed",
        },
        this.#options,
      );
    }

    const first = completed[0];
    const second = completed[1];
    if (first === undefined || second === undefined) {
      throw new Error(
        "Validation completed Attempt accounting is inconsistent",
      );
    }
    const materialConflictAfterTwo = hasMaterialConflict(
      first.output,
      second.output,
    );
    const validatorAttempts: ValidatorAttemptRecord[] = [...firstTwo];
    if (materialConflictAfterTwo) {
      const third = await runValidator(plan, 3, this.#options);
      validatorAttempts.push(third);
      if (third.status !== "completed") {
        return storeRecord(
          {
            kind: "validation-record",
            schemaVersion: 1,
            validationId: plan.validationId,
            candidateId: plan.candidate.id,
            planDigest,
            materialConflictAfterTwo,
            validatorAttempts,
            status: "validation-pending",
            reason:
              third.reason === "invalid-validator-output"
                ? "invalid-validator-output"
                : "validator-attempt-failed",
          },
          this.#options,
        );
      }
      completed.push(third);
    }

    const synthesis = await runSynthesis(plan, completed, this.#options);
    if (synthesis.status === "failed") {
      return storeRecord(
        {
          kind: "validation-record",
          schemaVersion: 1,
          validationId: plan.validationId,
          candidateId: plan.candidate.id,
          planDigest,
          materialConflictAfterTwo,
          validatorAttempts,
          status: "validation-pending",
          reason:
            synthesis.reason === "invalid-synthesis"
              ? "invalid-synthesis"
              : "synthesis-attempt-failed",
          synthesisAttempt: synthesis,
        },
        this.#options,
      );
    }
    return storeRecord(
      {
        kind: "validation-record",
        schemaVersion: 1,
        validationId: plan.validationId,
        candidateId: plan.candidate.id,
        planDigest,
        materialConflictAfterTwo,
        validatorAttempts,
        status: synthesis.output.disposition,
        synthesisAttempt: synthesis,
      },
      this.#options,
    );
  }
}

export function openValidation(options: OpenValidationOptions): Validation {
  return new FirstValidation(options);
}
