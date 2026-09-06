import { z } from "zod";

import { targetSnapshotRefSchema } from "../contracts.js";
import { sourceBoundHypothesisSchema } from "../exploration/contracts.js";
import {
  attemptExecutionResultV2RefSchema,
  structuredModelProfileSchema,
  type AttemptPlanV2,
  type ModelExecution,
} from "../model-execution/contracts.js";
import { sha256Digest } from "../research-record/canonical-json.js";
import type { JsonArtifactStore } from "../research-record/contracts.js";
import { normalizedRelativePathSchema } from "../source-file-contracts.js";
import {
  targetFileManifestRefSchema,
  targetFileManifestSchema,
} from "../source-mapping/contracts.js";
import { sourceToolPolicyRefSchema } from "../source-mapping/source-evidence-contracts.js";

const digestSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const identifierSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
const boundedTextSchema = z.string().min(1).max(2_000);
const immutableRefSchema = z.strictObject({
  id: identifierSchema,
  digest: digestSchema,
});

export const validationSourceAnchorSchema = z
  .strictObject({
    path: normalizedRelativePathSchema,
    fileDigest: digestSchema,
    startLine: z.number().int().positive(),
    endLine: z.number().int().positive(),
  })
  .refine((anchor) => anchor.endLine >= anchor.startLine, {
    message: "Source evidence endLine must not precede startLine",
  });

const validationRouteStepSchema = z.strictObject({
  ordinal: z.number().int().positive(),
  claim: boundedTextSchema,
  evidence: z.array(validationSourceAnchorSchema).min(1).max(32),
});

const validationCandidateOriginSchema = z.strictObject({
  subjectDigest: digestSchema,
  rootEvaluationDigest: digestSchema,
  approachFamilyId: digestSchema,
});

const legacyValidationCandidateIdentityFields = {
  target: targetSnapshotRefSchema,
  manifest: targetFileManifestRefSchema,
  attackerPremise: z.enum([
    "unauthenticated",
    "subscriber",
    "contributor",
    "customer",
    "unresolved",
  ]),
  brokenSecurityProperty: boundedTextSchema,
  causalRoute: z.array(validationRouteStepSchema).min(1).max(32),
} as const;

const validationCandidateIdentityFields = {
  ...legacyValidationCandidateIdentityFields,
  causalIdentity: sourceBoundHypothesisSchema.shape.causalIdentity,
} as const;

const validationCandidateIdentitySchema = z.strictObject(
  validationCandidateIdentityFields,
);

const legacyValidationCandidateIdentitySchema = z.strictObject(
  legacyValidationCandidateIdentityFields,
);

type ValidationCausalRoute = z.output<
  typeof validationCandidateIdentitySchema
>["causalRoute"];

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function normalizeValidationCausalRoute(
  input: ValidationCausalRoute,
): ValidationCausalRoute {
  const route = validationCandidateIdentityFields.causalRoute.parse(input);
  return route.map((step) => ({
    ...step,
    evidence: [...step.evidence].sort(
      (left, right) =>
        compareText(left.path, right.path) ||
        left.startLine - right.startLine ||
        left.endLine - right.endLine ||
        compareText(left.fileDigest, right.fileDigest),
    ),
  }));
}

export type LegacyValidationCandidateIdentityInput = z.input<
  typeof legacyValidationCandidateIdentitySchema
> & { readonly origins?: unknown };

export function legacyValidationCandidateId(
  input: LegacyValidationCandidateIdentityInput,
): string {
  const identity = legacyValidationCandidateIdentitySchema.parse({
    target: input.target,
    manifest: input.manifest,
    attackerPremise: input.attackerPremise,
    brokenSecurityProperty: input.brokenSecurityProperty,
    causalRoute: input.causalRoute,
  });
  return sha256Digest({
    kind: "validation-candidate-identity",
    schemaVersion: 1,
    ...identity,
  });
}

export type ValidationCandidateIdentityInput = z.input<
  typeof validationCandidateIdentitySchema
> & { readonly origins?: unknown };

export function validationCandidateId(
  input: ValidationCandidateIdentityInput,
): string {
  const identity = validationCandidateIdentitySchema.parse({
    target: input.target,
    manifest: input.manifest,
    attackerPremise: input.attackerPremise,
    brokenSecurityProperty: input.brokenSecurityProperty,
    causalRoute: input.causalRoute,
    causalIdentity: input.causalIdentity,
  });
  return sha256Digest({
    kind: "validation-candidate-identity",
    schemaVersion: 2,
    ...identity,
  });
}

export const validationCandidateSchema = z
  .strictObject({
    kind: z.literal("validation-candidate"),
    schemaVersion: z.literal(2),
    id: digestSchema,
    ...validationCandidateIdentityFields,
    origins: z.array(validationCandidateOriginSchema).min(1).max(64),
  })
  .superRefine((candidate, context) => {
    if (
      candidate.id !== validationCandidateId(candidate) ||
      candidate.brokenSecurityProperty !==
        candidate.causalIdentity.brokenSecurityProperty
    ) {
      context.addIssue({
        code: "custom",
        path: ["id"],
        message:
          "Validation Candidate ID or Causal Identity does not match its exact identity",
      });
    }
    candidate.causalRoute.forEach((step, index) => {
      if (step.ordinal !== index + 1) {
        context.addIssue({
          code: "custom",
          path: ["causalRoute", index, "ordinal"],
          message: "Validation route ordinals must be contiguous",
        });
      }
    });
    const origins = candidate.origins.map((origin) => sha256Digest(origin));
    if (new Set(origins).size !== origins.length) {
      context.addIssue({
        code: "custom",
        path: ["origins"],
        message: "Validation Candidate origins must be unique",
      });
    }
  });

export const legacyValidationCandidateSchema = z
  .strictObject({
    kind: z.literal("validation-candidate"),
    schemaVersion: z.literal(1),
    id: digestSchema,
    ...legacyValidationCandidateIdentityFields,
    origins: z.array(validationCandidateOriginSchema).min(1).max(64),
  })
  .superRefine((candidate, context) => {
    if (candidate.id !== legacyValidationCandidateId(candidate)) {
      context.addIssue({
        code: "custom",
        path: ["id"],
        message: "Legacy Validation Candidate ID does not match its identity",
      });
    }
  });

export const validationCandidateRefSchema = z.strictObject({
  kind: z.literal("validation-candidate"),
  schemaVersion: z.literal(2),
  id: digestSchema,
  digest: digestSchema,
  targetSnapshotDigest: digestSchema,
  manifestDigest: digestSchema,
  origins: z.number().int().positive().max(64),
});

export const legacyValidationCandidateRefSchema =
  validationCandidateRefSchema.extend({ schemaVersion: z.literal(1) });

export function referenceValidationCandidate(
  input: ValidationCandidate,
): ValidationCandidateRef {
  const candidate = validationCandidateSchema.parse(input);
  return validationCandidateRefSchema.parse({
    kind: candidate.kind,
    schemaVersion: candidate.schemaVersion,
    id: candidate.id,
    digest: sha256Digest(candidate),
    targetSnapshotDigest: candidate.target.digest,
    manifestDigest: candidate.manifest.digest,
    origins: candidate.origins.length,
  });
}

export function referenceLegacyValidationCandidate(
  input: LegacyValidationCandidate,
): LegacyValidationCandidateRef {
  const candidate = legacyValidationCandidateSchema.parse(input);
  return legacyValidationCandidateRefSchema.parse({
    kind: candidate.kind,
    schemaVersion: candidate.schemaVersion,
    id: candidate.id,
    digest: sha256Digest(candidate),
    targetSnapshotDigest: candidate.target.digest,
    manifestDigest: candidate.manifest.digest,
    origins: candidate.origins.length,
  });
}

const validationThreatContextIdentityFields = {
  kind: z.literal("validation-threat-context"),
  schemaVersion: z.literal(1),
  targetSnapshotDigest: digestSchema,
  candidateId: digestSchema,
  wordpressBaseline: immutableRefSchema,
  permittedAttacker: validationCandidateIdentityFields.attackerPremise,
  publicSurface: z.array(boundedTextSchema).max(64),
  technicalExclusions: z.array(boundedTextSchema).max(64),
} as const;

export const validationThreatContextSchema = z
  .strictObject({
    ...validationThreatContextIdentityFields,
    id: digestSchema,
  })
  .superRefine((value, context) => {
    const { id: _id, ...identity } = value;
    if (value.id !== sha256Digest(identity)) {
      context.addIssue({
        code: "custom",
        path: ["id"],
        message: "Validation Threat Context ID does not match its content",
      });
    }
  });

export const validationCriterionSchema = z.enum([
  "source-integrity",
  "reachability-and-premise",
  "broken-control",
  "causal-route-and-security-effect",
  "counterevidence-and-proof-gap",
]);

export const validationCriteria = validationCriterionSchema.options;

const criterionResultSchema = z.strictObject({
  criterion: validationCriterionSchema,
  status: z.enum(["pass", "fail", "unknown"]),
  reason: boundedTextSchema,
  evidence: z.array(validationSourceAnchorSchema).min(1).max(32),
});

function requireCompleteRubric(
  values: readonly { readonly criterion: string }[],
  context: z.RefinementCtx,
  path: PropertyKey[] = ["criteria"],
): void {
  const observed = new Set(values.map((value) => value.criterion));
  if (
    values.length !== validationCriteria.length ||
    validationCriteria.some((criterion) => !observed.has(criterion))
  ) {
    context.addIssue({
      code: "custom",
      path,
      message: "Every Validation Rubric criterion must be handled once",
    });
  }
}

export const validationProofGapSchema = z.strictObject({
  requiredFact: boundedTextSchema,
  currentEvidence: z.array(validationSourceAnchorSchema).min(1).max(32),
  falsifier: boundedTextSchema,
  nextAction: boundedTextSchema,
});

export const validationAttemptOutputSchema = z
  .strictObject({
    kind: z.literal("validation-attempt-output"),
    schemaVersion: z.literal(1),
    candidateId: digestSchema,
    criteria: z.array(criterionResultSchema).length(5),
    proposedDisposition: z.enum([
      "ready-for-human",
      "needs-research",
      "disproven",
      "rejected",
    ]),
    proofGap: validationProofGapSchema.optional(),
  })
  .superRefine((output, context) => {
    requireCompleteRubric(output.criteria, context);
    if (
      (output.proposedDisposition === "needs-research") !==
      (output.proofGap !== undefined)
    ) {
      context.addIssue({
        code: "custom",
        path: ["proofGap"],
        message: "Only Needs-research requires a concrete proof gap",
      });
    }
    if (
      output.proposedDisposition === "ready-for-human" &&
      output.criteria.some((criterion) => criterion.status !== "pass")
    ) {
      context.addIssue({
        code: "custom",
        path: ["proposedDisposition"],
        message: "Ready-for-human requires every rubric criterion to pass",
      });
    }
    if (
      output.proposedDisposition === "needs-research" &&
      !output.criteria.some((criterion) => criterion.status === "unknown")
    ) {
      context.addIssue({
        code: "custom",
        path: ["proposedDisposition"],
        message: "Needs-research requires an unknown rubric criterion",
      });
    }
    if (
      (output.proposedDisposition === "disproven" ||
        output.proposedDisposition === "rejected") &&
      !output.criteria.some((criterion) => criterion.status === "fail")
    ) {
      context.addIssue({
        code: "custom",
        path: ["proposedDisposition"],
        message: "A negative proposal requires a failed rubric criterion",
      });
    }
  });

export const runtimeHandoffValidationAttemptOutputSchema = z
  .strictObject({
    kind: z.literal("validation-attempt-output"),
    schemaVersion: z.literal(2),
    candidateId: digestSchema,
    criteria: z.array(criterionResultSchema).length(5),
    proposedDisposition: z.enum([
      "ready-for-runtime",
      "needs-research",
      "disproven",
    ]),
    proofGap: validationProofGapSchema.optional(),
  })
  .superRefine((output, context) => {
    requireCompleteRubric(output.criteria, context);
    if (
      (output.proposedDisposition === "needs-research") !==
      (output.proofGap !== undefined)
    ) {
      context.addIssue({
        code: "custom",
        path: ["proofGap"],
        message: "Only Needs-research requires a concrete proof gap",
      });
    }
    if (
      output.proposedDisposition === "ready-for-runtime" &&
      output.criteria.some((criterion) => criterion.status === "fail")
    ) {
      context.addIssue({
        code: "custom",
        path: ["proposedDisposition"],
        message: "Ready-for-runtime cannot contain a source contradiction",
      });
    }
    if (
      output.proposedDisposition === "needs-research" &&
      (!output.criteria.some((criterion) => criterion.status === "unknown") ||
        output.criteria.some((criterion) => criterion.status === "fail"))
    ) {
      context.addIssue({
        code: "custom",
        path: ["proposedDisposition"],
        message:
          "Needs-research requires an unknown and no decisive source contradiction",
      });
    }
    if (
      output.proposedDisposition === "disproven" &&
      !output.criteria.some((criterion) => criterion.status === "fail")
    ) {
      context.addIssue({
        code: "custom",
        path: ["proposedDisposition"],
        message: "Disproven requires a decisive source contradiction",
      });
    }
  });

export const singleValidationAttemptOutputSchema = z
  .strictObject({
    kind: z.literal("validation-attempt-output"),
    schemaVersion: z.literal(3),
    candidateId: digestSchema,
    criteria: z.array(criterionResultSchema).length(5),
    proposedDisposition: z.enum([
      "source-validated",
      "needs-research",
      "disproven",
    ]),
    proofGap: validationProofGapSchema.optional(),
  })
  .superRefine((output, context) => {
    requireCompleteRubric(output.criteria, context);
    if (
      (output.proposedDisposition === "needs-research") !==
      (output.proofGap !== undefined)
    ) {
      context.addIssue({
        code: "custom",
        path: ["proofGap"],
        message: "Only Needs-research requires a concrete proof gap",
      });
    }
    if (
      output.proposedDisposition === "source-validated" &&
      output.criteria.some((criterion) => criterion.status === "fail")
    ) {
      context.addIssue({
        code: "custom",
        path: ["proposedDisposition"],
        message: "Source-validated cannot contain a source contradiction",
      });
    }
    if (
      output.proposedDisposition === "needs-research" &&
      (!output.criteria.some((criterion) => criterion.status === "unknown") ||
        output.criteria.some((criterion) => criterion.status === "fail"))
    ) {
      context.addIssue({
        code: "custom",
        path: ["proposedDisposition"],
        message:
          "Needs-research requires an unknown and no decisive source contradiction",
      });
    }
    if (
      output.proposedDisposition === "disproven" &&
      !output.criteria.some((criterion) => criterion.status === "fail")
    ) {
      context.addIssue({
        code: "custom",
        path: ["proposedDisposition"],
        message: "Disproven requires a decisive source contradiction",
      });
    }
  });

const synthesisEvidenceRefSchema = z.strictObject({
  attemptId: identifierSchema,
  criterion: validationCriterionSchema,
  evidenceIndexes: z.array(z.number().int().nonnegative()).min(1).max(32),
});

const synthesisCriterionResultSchema = z.strictObject({
  criterion: validationCriterionSchema,
  status: z.enum(["pass", "fail", "unknown"]),
  reason: boundedTextSchema,
  evidence: z.array(synthesisEvidenceRefSchema).min(1).max(6),
});

export const validationSynthesisOutputSchema = z
  .strictObject({
    kind: z.literal("validation-synthesis-output"),
    schemaVersion: z.literal(1),
    candidateId: digestSchema,
    criteria: z.array(synthesisCriterionResultSchema).length(5),
    disposition: z.enum([
      "ready-for-human",
      "needs-research",
      "disproven",
      "rejected",
    ]),
    reason: boundedTextSchema,
    proofGapAttemptId: identifierSchema.optional(),
  })
  .superRefine((output, context) => {
    requireCompleteRubric(output.criteria, context);
    if (
      (output.disposition === "needs-research") !==
      (output.proofGapAttemptId !== undefined)
    ) {
      context.addIssue({
        code: "custom",
        path: ["proofGapAttemptId"],
        message: "Needs-research must select an Attempt proof gap",
      });
    }
  });

const modelBudgetSchema = z.strictObject({
  maxWallTimeMs: z.number().int().positive(),
  maxModelTokens: z.number().int().positive(),
  maxModelTurns: z.number().int().positive(),
  maxProviderCostUsd: z.number().positive(),
  maxOutputBytes: z.number().int().positive(),
  reportedUsageEnforcement: z.literal("telemetry-only").optional(),
});

const validatorBudgetSchema = modelBudgetSchema.extend({
  maxSourceQueries: z.number().int().positive(),
  maxSourceScanBytes: z.number().int().positive().optional(),
  maxSourceResponseBytes: z.number().int().positive().optional(),
  sourceLimitTerminalOutput: z.literal("preserve").optional(),
});

const validationPlanIdentityFields = {
  kind: z.literal("validation-plan"),
  validationId: digestSchema,
  campaignId: identifierSchema,
  threatContext: validationThreatContextSchema,
  manifest: z.strictObject({
    ref: targetFileManifestRefSchema,
    value: targetFileManifestSchema,
  }),
  validationPolicy: immutableRefSchema,
  promptSet: immutableRefSchema,
  validatorModelProfile: structuredModelProfileSchema,
  sourceToolPolicy: sourceToolPolicyRefSchema,
} as const;

const validationPlanIdentitySchema = z.strictObject({
  ...validationPlanIdentityFields,
  candidate: validationCandidateSchema,
});

const legacyValidationPlanIdentitySchema = z.strictObject({
  ...validationPlanIdentityFields,
  candidate: legacyValidationCandidateSchema,
});

function validatePlanBindings(
  plan:
    | z.infer<typeof validationPlanIdentitySchema>
    | z.infer<typeof legacyValidationPlanIdentitySchema>,
  context: z.RefinementCtx,
): void {
  const manifestDigest = sha256Digest(plan.manifest.value);
  const candidateAnchors = plan.candidate.causalRoute.flatMap(
    (step) => step.evidence,
  );
  const entries = new Set(
    plan.manifest.value.entries.map(
      (entry) => `${entry.path}\u0000${entry.digest}`,
    ),
  );
  if (
    plan.validationId !== plan.candidate.id ||
    plan.manifest.ref.digest !== manifestDigest ||
    plan.manifest.ref.targetSnapshotId !== plan.candidate.target.id ||
    plan.manifest.ref.targetSnapshotDigest !== plan.candidate.target.digest ||
    plan.manifest.value.targetSnapshot.id !== plan.candidate.target.id ||
    plan.manifest.value.targetSnapshot.digest !==
      plan.candidate.target.digest ||
    plan.candidate.manifest.digest !== plan.manifest.ref.digest ||
    plan.threatContext.targetSnapshotDigest !== plan.candidate.target.digest ||
    plan.threatContext.candidateId !== plan.candidate.id ||
    plan.threatContext.permittedAttacker !== plan.candidate.attackerPremise
  ) {
    context.addIssue({
      code: "custom",
      message: "Validation Plan contains a foreign identity binding",
    });
  }
  if (
    candidateAnchors.some(
      (anchor) => !entries.has(`${anchor.path}\u0000${anchor.fileDigest}`),
    )
  ) {
    context.addIssue({
      code: "custom",
      path: ["candidate", "causalRoute"],
      message: "Validation Candidate contains a foreign source anchor",
    });
  }
}

export const legacyValidationPlanSchema = legacyValidationPlanIdentitySchema
  .extend({
    schemaVersion: z.literal(1),
    synthesisModelProfile: structuredModelProfileSchema,
    budget: z.strictObject({
      validator: validatorBudgetSchema,
      synthesis: modelBudgetSchema,
    }),
  })
  .superRefine(validatePlanBindings);

export const currentValidationPlanSchema = validationPlanIdentitySchema
  .extend({
    schemaVersion: z.literal(2),
    budget: z.strictObject({ validator: validatorBudgetSchema }),
  })
  .superRefine(validatePlanBindings);

export const validationPlanSchema = z.union([
  currentValidationPlanSchema,
  legacyValidationPlanSchema,
]);

const validatorAttemptRefSchema = attemptExecutionResultV2RefSchema.extend({
  owner: z.literal("validation"),
  role: z.literal("validator"),
});
const synthesisAttemptRefSchema = attemptExecutionResultV2RefSchema.extend({
  owner: z.literal("validation"),
  role: z.literal("validation-synthesizer"),
});

const validatorAttemptRecordSchema = z.discriminatedUnion("status", [
  z.strictObject({
    status: z.literal("completed"),
    ordinal: z.union([z.literal(1), z.literal(2), z.literal(3)]),
    execution: validatorAttemptRefSchema,
    output: validationAttemptOutputSchema,
  }),
  z.strictObject({
    status: z.literal("failed"),
    ordinal: z.union([z.literal(1), z.literal(2), z.literal(3)]),
    execution: validatorAttemptRefSchema,
    terminalStatus: z.enum([
      "invalid-output",
      "policy-denied",
      "auth-required",
      "provider-failed",
      "budget-exhausted",
      "cancelled",
      "orphaned",
    ]),
    reason: boundedTextSchema,
  }),
]);

const completedSynthesisAttemptRecordSchema = z.strictObject({
  status: z.literal("completed"),
  execution: synthesisAttemptRefSchema,
  output: validationSynthesisOutputSchema,
});

const synthesisAttemptRecordSchema = z.discriminatedUnion("status", [
  completedSynthesisAttemptRecordSchema,
  z.strictObject({
    status: z.literal("failed"),
    execution: synthesisAttemptRefSchema,
    terminalStatus: z.enum([
      "invalid-output",
      "policy-denied",
      "auth-required",
      "provider-failed",
      "budget-exhausted",
      "cancelled",
      "orphaned",
    ]),
    reason: boundedTextSchema,
  }),
]);

const validationRecordBase = {
  kind: z.literal("validation-record"),
  schemaVersion: z.literal(1),
  validationId: digestSchema,
  candidateId: digestSchema,
  planDigest: digestSchema,
  materialConflictAfterTwo: z.boolean(),
  validatorAttempts: z.array(validatorAttemptRecordSchema).min(1).max(3),
} as const;

export const legacyValidationRecordSchema = z
  .discriminatedUnion("status", [
    z.strictObject({
      ...validationRecordBase,
      status: z.enum([
        "ready-for-human",
        "needs-research",
        "disproven",
        "rejected",
      ]),
      synthesisAttempt: completedSynthesisAttemptRecordSchema,
    }),
    z.strictObject({
      ...validationRecordBase,
      status: z.literal("validation-pending"),
      reason: z.enum([
        "validator-attempt-failed",
        "invalid-validator-output",
        "synthesis-attempt-failed",
        "invalid-synthesis",
      ]),
      synthesisAttempt: synthesisAttemptRecordSchema.optional(),
    }),
  ])
  .superRefine((record, context) => {
    const ordinals = record.validatorAttempts.map((attempt) => attempt.ordinal);
    if (
      new Set(ordinals).size !== ordinals.length ||
      ordinals.some((ordinal, index) => ordinal !== index + 1) ||
      (record.validatorAttempts.length === 3) !==
        record.materialConflictAfterTwo
    ) {
      context.addIssue({
        code: "custom",
        path: ["validatorAttempts"],
        message:
          "Validation Attempts must be contiguous and use a third only after conflict",
      });
    }
    if (
      record.status !== "validation-pending" &&
      (record.validatorAttempts.some(
        (attempt) => attempt.status !== "completed",
      ) ||
        record.synthesisAttempt.output.disposition !== record.status)
    ) {
      context.addIssue({
        code: "custom",
        path: ["status"],
        message: "Validation terminal status must match completed Synthesis",
      });
    }
  });

const runtimeHandoffCompletedValidatorAttemptRecordSchema = z.strictObject({
  status: z.literal("completed"),
  execution: validatorAttemptRefSchema,
  output: runtimeHandoffValidationAttemptOutputSchema,
});

const currentFailedValidatorAttemptRecordSchema = z.strictObject({
  status: z.literal("failed"),
  execution: validatorAttemptRefSchema,
  terminalStatus: z.enum([
    "invalid-output",
    "policy-denied",
    "auth-required",
    "provider-failed",
    "budget-exhausted",
    "cancelled",
    "orphaned",
  ]),
  reason: boundedTextSchema,
});

export const currentValidationRecordSchema = z
  .discriminatedUnion("status", [
    z.strictObject({
      kind: z.literal("validation-record"),
      schemaVersion: z.literal(2),
      validationId: digestSchema,
      candidateId: digestSchema,
      planDigest: digestSchema,
      validatorAttempt: runtimeHandoffCompletedValidatorAttemptRecordSchema,
      status: z.enum(["ready-for-runtime", "needs-research", "disproven"]),
    }),
    z.strictObject({
      kind: z.literal("validation-record"),
      schemaVersion: z.literal(2),
      validationId: digestSchema,
      candidateId: digestSchema,
      planDigest: digestSchema,
      validatorAttempt: currentFailedValidatorAttemptRecordSchema,
      status: z.literal("validation-pending"),
      reason: z.enum(["validator-attempt-failed", "invalid-validator-output"]),
    }),
  ])
  .superRefine((record, context) => {
    if (
      record.status !== "validation-pending" &&
      record.validatorAttempt.output.proposedDisposition !== record.status
    ) {
      context.addIssue({
        code: "custom",
        path: ["status"],
        message: "Validation status must match its single Validator output",
      });
    }
  });

const sourceValidatedCompletedValidatorAttemptRecordSchema = z.strictObject({
  status: z.literal("completed"),
  execution: validatorAttemptRefSchema,
  output: singleValidationAttemptOutputSchema,
});

export const sourceValidationRecordSchema = z
  .discriminatedUnion("status", [
    z.strictObject({
      kind: z.literal("validation-record"),
      schemaVersion: z.literal(3),
      validationId: digestSchema,
      candidateId: digestSchema,
      planDigest: digestSchema,
      validatorAttempt: sourceValidatedCompletedValidatorAttemptRecordSchema,
      status: z.enum(["source-validated", "needs-research", "disproven"]),
    }),
    z.strictObject({
      kind: z.literal("validation-record"),
      schemaVersion: z.literal(3),
      validationId: digestSchema,
      candidateId: digestSchema,
      planDigest: digestSchema,
      validatorAttempt: currentFailedValidatorAttemptRecordSchema,
      status: z.literal("validation-pending"),
      reason: z.enum(["validator-attempt-failed", "invalid-validator-output"]),
    }),
  ])
  .superRefine((record, context) => {
    if (
      record.status !== "validation-pending" &&
      record.validatorAttempt.output.proposedDisposition !== record.status
    ) {
      context.addIssue({
        code: "custom",
        path: ["status"],
        message: "Validation status must match its single Validator output",
      });
    }
  });

export const validationRecordSchema = z.union([
  sourceValidationRecordSchema,
  currentValidationRecordSchema,
  legacyValidationRecordSchema,
]);

export const legacyValidationRecordRefSchema = z.strictObject({
  kind: z.literal("validation-record"),
  schemaVersion: z.literal(1),
  validationId: digestSchema,
  candidateId: digestSchema,
  digest: digestSchema,
});

export const currentValidationRecordRefSchema =
  legacyValidationRecordRefSchema.extend({ schemaVersion: z.literal(2) });

export const sourceValidationRecordRefSchema =
  legacyValidationRecordRefSchema.extend({ schemaVersion: z.literal(3) });

export const validationRecordRefSchema = z.union([
  sourceValidationRecordRefSchema,
  currentValidationRecordRefSchema,
  legacyValidationRecordRefSchema,
]);

const validationFrontierGapIdentityFields = {
  kind: z.literal("validation-frontier-gap"),
  schemaVersion: z.literal(1),
  campaignId: identifierSchema,
  runId: identifierSchema,
  target: targetSnapshotRefSchema,
  manifest: targetFileManifestRefSchema,
  validation: validationRecordRefSchema,
  candidate: validationCandidateRefSchema,
  approachFamilyIds: z.array(digestSchema).min(1).max(64),
  value: validationProofGapSchema,
} as const;

export const validationFrontierGapSchema = z
  .strictObject({
    ...validationFrontierGapIdentityFields,
    id: digestSchema,
  })
  .superRefine((gap, context) => {
    const { id: _id, ...identity } = gap;
    if (
      gap.id !== sha256Digest(identity) ||
      gap.validation.validationId !== gap.candidate.id ||
      gap.validation.candidateId !== gap.candidate.id ||
      gap.target.digest !== gap.candidate.targetSnapshotDigest ||
      gap.manifest.digest !== gap.candidate.manifestDigest ||
      new Set(gap.approachFamilyIds).size !== gap.approachFamilyIds.length
    ) {
      context.addIssue({
        code: "custom",
        message: "Validation Frontier Gap contains a foreign identity binding",
      });
    }
  });

export const validationFrontierGapRefSchema = z.strictObject({
  kind: z.literal("validation-frontier-gap"),
  schemaVersion: z.literal(1),
  id: digestSchema,
  digest: digestSchema,
  validationId: digestSchema,
  candidateId: digestSchema,
  targetSnapshotDigest: digestSchema,
  manifestDigest: digestSchema,
  approachFamilies: z.number().int().positive().max(64),
});

export type ValidationCandidate = z.infer<typeof validationCandidateSchema>;
export type LegacyValidationCandidate = z.infer<
  typeof legacyValidationCandidateSchema
>;
export type ValidationCandidateRef = z.infer<
  typeof validationCandidateRefSchema
>;
export type LegacyValidationCandidateRef = z.infer<
  typeof legacyValidationCandidateRefSchema
>;
export type ValidationThreatContext = z.infer<
  typeof validationThreatContextSchema
>;
export type ValidationAttemptOutput = z.infer<
  typeof validationAttemptOutputSchema
>;
export type SingleValidationAttemptOutput = z.infer<
  typeof singleValidationAttemptOutputSchema
>;
export type ValidationSynthesisOutput = z.infer<
  typeof validationSynthesisOutputSchema
>;
export type ValidationPlan = z.infer<typeof validationPlanSchema>;
export type CurrentValidationPlan = z.infer<typeof currentValidationPlanSchema>;
export type ValidationRecord = z.infer<typeof validationRecordSchema>;
export type ValidationRecordRef = z.infer<typeof validationRecordRefSchema>;
export type CurrentValidationRecordRef = z.infer<
  typeof sourceValidationRecordRefSchema
>;
export type ValidationFrontierGap = z.infer<typeof validationFrontierGapSchema>;
export type ValidationFrontierGapRef = z.infer<
  typeof validationFrontierGapRefSchema
>;
export type ValidatorAttemptPlan = Extract<
  AttemptPlanV2,
  { role: "validator" }
>;
export type ValidationSynthesisAttemptPlan = Extract<
  AttemptPlanV2,
  { role: "validation-synthesizer" }
>;

export interface Validation {
  validate(plan: CurrentValidationPlan): Promise<CurrentValidationRecordRef>;
}

export interface OpenValidationOptions {
  readonly modelExecution: ModelExecution;
  readonly artifactStore: JsonArtifactStore;
  readonly attemptNamespace?: string;
}
