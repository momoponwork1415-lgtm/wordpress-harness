import { z } from "zod";

import {
  aiReproductionAttemptRefSchema,
  aiReproductionAttemptSchema,
  aiReproductionResultSchema,
  aiReproductionRuntimeIdentitySchema,
  triageReproductionPacketSchema,
  type AIReproductionAttempt,
  type AIReproductionResult,
} from "./ai-reproduction-contracts.js";
import { humanOsDigest } from "./canonical-json.js";

const digestSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const identifierSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
const fixedVersionSchema = z
  .string()
  .min(1)
  .max(128)
  .refine((value) => value !== "latest", {
    message: "Human Review versions must be fixed",
  });
const safeReviewTextSchema = z
  .string()
  .min(1)
  .max(4_000)
  .refine(
    (value) =>
      !/[`\r\n]/u.test(value) &&
      !/^(?:GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+\//iu.test(value) &&
      !/(?:<script|<\?php|authorization\s*:|cookie\s*:|password\s*=|\b(?:curl|wget|powershell|bash\s+-c|sh\s+-c|nc\s+-e|reverse\s+shell)\b)/iu.test(
        value,
      ),
    {
      message:
        "Human Review metadata must not contain private reproduction material",
    },
  );

const impactSchema =
  aiReproductionAttemptSchema.shape.securityEffect.shape.impact;

const currentHumanReviewPolicyIdentitySchema = z.strictObject({
  kind: z.literal("current-human-review-policy"),
  schemaVersion: z.literal(2),
  activeConcurrency: z.number().int().positive().max(64),
  highImpactEscalation: z.array(impactSchema).min(1),
});

export const currentHumanReviewPolicySchema =
  currentHumanReviewPolicyIdentitySchema
    .extend({ digest: digestSchema })
    .superRefine((policy, context) => {
      const { digest: _digest, ...identity } = policy;
      if (
        policy.digest !== humanOsDigest(identity) ||
        new Set(policy.highImpactEscalation).size !==
          policy.highImpactEscalation.length
      ) {
        context.addIssue({
          code: "custom",
          message: "Human Review Policy digest or impact set is invalid",
        });
      }
    });

const queuePrioritySchema = z.strictObject({
  impact: z.number().int().nonnegative(),
  attackerPremise: z.number().int().nonnegative(),
  reproductionCost: z.number().int().nonnegative(),
  stableTieBreaker: digestSchema,
});

const currentHumanReviewCaseIdentitySchema = z.strictObject({
  kind: z.literal("current-human-review-case"),
  schemaVersion: z.literal(2),
  campaignId: identifierSchema,
  runId: identifierSchema,
  originAttempt: aiReproductionAttemptRefSchema,
  originTarget: aiReproductionAttemptSchema.shape.target.shape.snapshot,
  causalIdentity: aiReproductionAttemptSchema.shape.causalIdentity,
  attackerPremise: aiReproductionAttemptSchema.shape.attackerPremise,
  securityEffect: aiReproductionAttemptSchema.shape.securityEffect,
  originOutcome: z.discriminatedUnion("status", [
    z.strictObject({
      status: z.literal("runtime-confirmed"),
      triagePacket: triageReproductionPacketSchema,
    }),
    z.strictObject({
      status: z.literal("runtime-inconclusive"),
      reason: z.enum([
        "unsupported-mechanism",
        "effect-not-observed",
        "effect-unclear",
        "environment-identity-mismatch",
      ]),
    }),
  ]),
  lane: z.enum(["human-verification", "escalation"]),
  initialQueueStatus: z.enum(["active", "deferred", "escalation"]),
  priority: queuePrioritySchema,
  policyDigest: digestSchema,
  admittedAt: z.string().datetime(),
});

export const currentHumanReviewCaseSchema = currentHumanReviewCaseIdentitySchema
  .extend({ id: digestSchema })
  .superRefine((reviewCase, context) => {
    const expectedId = humanOsDigest({
      kind: "current-human-review-case-id",
      schemaVersion: 2,
      originAttemptId: reviewCase.originAttempt.id,
    });
    const confirmed = reviewCase.originOutcome.status === "runtime-confirmed";
    if (
      reviewCase.id !== expectedId ||
      reviewCase.priority.stableTieBreaker !== expectedId ||
      reviewCase.originAttempt.targetSnapshotDigest !==
        reviewCase.originTarget.digest ||
      confirmed !== (reviewCase.lane === "human-verification") ||
      (reviewCase.lane === "human-verification") !==
        (reviewCase.initialQueueStatus !== "escalation")
    ) {
      context.addIssue({
        code: "custom",
        message: "Current Human Review Case contains an invalid binding",
      });
    }
  });

const scheduleEventIdentitySchema = z.discriminatedUnion("event", [
  z.strictObject({
    kind: z.literal("current-human-review-schedule-event"),
    schemaVersion: z.literal(2),
    caseId: digestSchema,
    event: z.literal("promoted"),
    occurredAt: z.string().datetime(),
  }),
  z.strictObject({
    kind: z.literal("current-human-review-schedule-event"),
    schemaVersion: z.literal(2),
    caseId: digestSchema,
    event: z.literal("escalation-selected"),
    selectedBy: z.strictObject({
      kind: z.literal("human-reviewer"),
      id: identifierSchema,
    }),
    occurredAt: z.string().datetime(),
  }),
]);

export const currentHumanReviewScheduleEventSchema = scheduleEventIdentitySchema
  .and(z.strictObject({ id: digestSchema }))
  .superRefine((event, context) => {
    const { id: _id, ...identity } = event;
    if (event.id !== humanOsDigest(identity)) {
      context.addIssue({
        code: "custom",
        path: ["id"],
        message: "Human Review Schedule Event ID does not match its content",
      });
    }
  });

export const currentVersionReviewProviderOutputSchema = z.discriminatedUnion(
  "status",
  [
    z.strictObject({ status: z.literal("current") }),
    z.strictObject({
      status: z.literal("refreshed"),
      refreshedAttemptId: digestSchema,
    }),
    z.strictObject({
      status: z.literal("blocked"),
      reason: z.enum([
        "version-lookup-failed",
        "refresh-not-runtime-confirmed",
        "causal-identity-changed",
      ]),
    }),
  ],
);

const versionReviewBase = {
  kind: z.literal("current-version-review"),
  schemaVersion: z.literal(2),
  originalAttempt: aiReproductionAttemptRefSchema,
  originalTarget: aiReproductionAttemptSchema.shape.target.shape.snapshot,
  reviewedAt: z.string().datetime(),
} as const;

export const currentVersionReviewSchema = z.discriminatedUnion("status", [
  z.strictObject({
    ...versionReviewBase,
    status: z.literal("current"),
    selectedAttempt: aiReproductionAttemptRefSchema,
    selectedTarget: aiReproductionAttemptSchema.shape.target.shape.snapshot,
  }),
  z.strictObject({
    ...versionReviewBase,
    status: z.literal("refreshed"),
    selectedAttempt: aiReproductionAttemptRefSchema,
    selectedTarget: aiReproductionAttemptSchema.shape.target.shape.snapshot,
  }),
  z.strictObject({
    ...versionReviewBase,
    status: z.literal("blocked"),
    reason: z.enum([
      "version-lookup-failed",
      "refresh-not-runtime-confirmed",
      "causal-identity-changed",
    ]),
    selectedAttempt: z.null(),
    selectedTarget: z.null(),
  }),
]);

export const humanReproductionRuntimeIdentitySchema = z.strictObject({
  kind: z.literal("human-reproduction-runtime-identity"),
  schemaVersion: z.literal(2),
  environmentId: identifierSchema,
  targetSnapshotDigest: digestSchema,
  manifestDigest: digestSchema,
  runtimeProfileDigest: digestSchema,
  setupPlanDigest: digestSchema,
  observedWordpressVersion: fixedVersionSchema,
  observedPhpVersion: fixedVersionSchema,
  observedDatabaseVersion: fixedVersionSchema,
  observedWebServerVersion: fixedVersionSchema,
  observedImages: aiReproductionRuntimeIdentitySchema.shape.observedImages,
  isolation: aiReproductionRuntimeIdentitySchema.shape.isolation,
  fresh: z.literal(true),
  disposable: z.literal(true),
  hostTargetExecution: z.literal(false),
  ambientHostShell: z.literal(false),
  ambientCredentials: z.literal(false),
  arbitraryNetwork: z.literal(false),
});

export const humanReproductionEnvironmentOutcomeSchema = z.discriminatedUnion(
  "status",
  [
    z.strictObject({
      status: z.literal("ready"),
      runtimeIdentity: humanReproductionRuntimeIdentitySchema,
    }),
    z.strictObject({
      status: z.literal("blocked"),
      reason: z.enum([
        "isolation-unavailable",
        "policy-violation",
        "setup-failed",
        "activation-failed",
        "health-failed",
      ]),
    }),
  ],
);

const preparationIdentitySchema = z.discriminatedUnion("status", [
  z.strictObject({
    kind: z.literal("human-reproduction-preparation"),
    schemaVersion: z.literal(2),
    caseId: digestSchema,
    status: z.literal("ready"),
    versionReview: currentVersionReviewSchema,
    selectedAttempt: aiReproductionAttemptRefSchema,
    triagePacket: triageReproductionPacketSchema,
    environment: humanReproductionRuntimeIdentitySchema,
    preparedAt: z.string().datetime(),
  }),
  z.strictObject({
    kind: z.literal("human-reproduction-preparation"),
    schemaVersion: z.literal(2),
    caseId: digestSchema,
    status: z.literal("blocked"),
    versionReview: currentVersionReviewSchema,
    reason: z.enum([
      "version-lookup-failed",
      "refresh-not-runtime-confirmed",
      "causal-identity-changed",
      "isolation-unavailable",
      "policy-violation",
      "setup-failed",
      "activation-failed",
      "health-failed",
      "environment-identity-mismatch",
      "environment-not-fresh",
    ]),
    selectedAttempt: aiReproductionAttemptRefSchema.nullable(),
    triagePacket: triageReproductionPacketSchema.nullable(),
    environment: z.null(),
    preparedAt: z.string().datetime(),
  }),
]);

export const humanReproductionPreparationSchema = preparationIdentitySchema
  .and(z.strictObject({ id: digestSchema }))
  .superRefine((preparation, context) => {
    const { id: _id, ...identity } = preparation;
    if (
      preparation.id !== humanOsDigest(identity) ||
      (preparation.status === "ready" &&
        (preparation.versionReview.status === "blocked" ||
          preparation.selectedAttempt.id !==
            preparation.versionReview.selectedAttempt.id ||
          preparation.triagePacket.attempt.id !==
            preparation.selectedAttempt.id))
    ) {
      context.addIssue({
        code: "custom",
        message: "Human Reproduction Preparation contains a foreign binding",
      });
    }
  });

const reviewerSchema = z.strictObject({
  kind: z.literal("human-reviewer"),
  id: identifierSchema,
});

const recipeExecutionSchema = z.strictObject({
  recipe: triageReproductionPacketSchema.shape.recipe,
  startedAt: z.string().datetime(),
  completedAt: z.string().datetime(),
  completedStepOrdinals: z.array(z.number().int().positive()).max(64),
  exactPayloadAndStepsUsed: z.boolean(),
  deviation: z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("none") }),
    z.strictObject({
      kind: z.literal("minor"),
      description: safeReviewTextSchema,
    }),
    z.strictObject({
      kind: z.literal("new-causal-route-required"),
      description: safeReviewTextSchema,
    }),
  ]),
});

const humanSecurityEffectSchema = z.strictObject({
  status: z.enum(["observed", "not-observed", "uncertain"]),
  description: safeReviewTextSchema,
});

export const currentHumanReviewDispositionSchema = z.discriminatedUnion(
  "status",
  [
    z.strictObject({
      status: z.literal("verified-finding"),
      reason: safeReviewTextSchema,
    }),
    z.strictObject({
      status: z.literal("rejected"),
      reason: safeReviewTextSchema,
    }),
    z.strictObject({
      status: z.literal("runtime-inconclusive"),
      reason: safeReviewTextSchema,
    }),
    z.strictObject({
      status: z.literal("more-evidence-required"),
      reason: safeReviewTextSchema,
      requestedEvidence: z
        .array(
          z.strictObject({
            kind: z.enum(["source", "runtime"]),
            question: safeReviewTextSchema,
            acceptanceCriterion: safeReviewTextSchema,
          }),
        )
        .min(1)
        .max(16),
    }),
    z.strictObject({
      status: z.literal("blocked"),
      reason: safeReviewTextSchema,
      blocker: z.enum([
        "version-mismatch",
        "environment-unavailable",
        "environment-mismatch",
        "role-mismatch",
        "new-recipe-required",
      ]),
    }),
  ],
);

const humanReproductionRecordIdentitySchema = z
  .strictObject({
    kind: z.literal("human-reproduction-record"),
    schemaVersion: z.literal(2),
    caseId: digestSchema,
    preparationId: digestSchema,
    attempt: aiReproductionAttemptRefSchema,
    triagePacketId: digestSchema.nullable(),
    environment: humanReproductionRuntimeIdentitySchema.nullable(),
    environmentCleanup: z.enum(["not-required", "completed", "failed"]),
    reviewer: reviewerSchema,
    performedAt: z.string().datetime(),
    attackerRole: aiReproductionAttemptSchema.shape.attackerPremise,
    recipeExecution: recipeExecutionSchema.nullable(),
    securityEffect: humanSecurityEffectSchema,
    disposition: currentHumanReviewDispositionSchema,
  })
  .superRefine((record, context) => {
    const isPositive = record.disposition.status === "verified-finding";
    const isNegative = record.disposition.status === "rejected";
    const proofComplete =
      record.environment !== null &&
      record.environmentCleanup === "completed" &&
      record.recipeExecution !== null &&
      record.recipeExecution.exactPayloadAndStepsUsed &&
      record.recipeExecution.deviation.kind !== "new-causal-route-required" &&
      record.attackerRole !== "unresolved";
    if (
      ((isPositive || isNegative) && !proofComplete) ||
      (isPositive && record.securityEffect.status !== "observed") ||
      (isNegative && record.securityEffect.status !== "not-observed") ||
      ((record.disposition.status === "runtime-inconclusive" ||
        record.disposition.status === "more-evidence-required" ||
        record.disposition.status === "blocked") &&
        record.securityEffect.status !== "uncertain") ||
      ((record.environment === null || record.recipeExecution === null) &&
        record.disposition.status !== "blocked")
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Human Reproduction evidence does not support its human Disposition",
      });
    }
  });

export const humanReproductionRecordSchema =
  humanReproductionRecordIdentitySchema
    .extend({ id: digestSchema })
    .superRefine((record, context) => {
      const { id: _id, ...identity } = record;
      if (record.id !== humanOsDigest(identity)) {
        context.addIssue({
          code: "custom",
          path: ["id"],
          message: "Human Reproduction Record ID does not match its content",
        });
      }
    });

export const humanReproductionRecordRefSchema = z.strictObject({
  kind: z.literal("human-reproduction-record"),
  schemaVersion: z.literal(2),
  id: digestSchema,
  digest: digestSchema,
  caseId: digestSchema,
  disposition: z.enum([
    "verified-finding",
    "rejected",
    "runtime-inconclusive",
    "more-evidence-required",
    "blocked",
  ]),
});

const currentFindingIdentitySchema = z.strictObject({
  kind: z.literal("finding"),
  schemaVersion: z.literal(2),
  caseId: digestSchema,
  campaignId: identifierSchema,
  originalTarget: aiReproductionAttemptSchema.shape.target.shape.snapshot,
  verifiedTarget: aiReproductionAttemptSchema.shape.target.shape.snapshot,
  runtimePacket: triageReproductionPacketSchema.shape.runtimePacket,
  aiAttempt: aiReproductionAttemptRefSchema,
  triagePacketId: digestSchema,
  recipe: triageReproductionPacketSchema.shape.recipe,
  privateEvidence: triageReproductionPacketSchema.shape.privateEvidence,
  humanVerification: humanReproductionRecordRefSchema,
  causalIdentity: aiReproductionAttemptSchema.shape.causalIdentity,
  attackerRole: z.enum([
    "unauthenticated",
    "subscriber",
    "contributor",
    "customer",
  ]),
  securityEffect: safeReviewTextSchema,
  reviewer: reviewerSchema,
  verifiedAt: z.string().datetime(),
  externalAction: z.strictObject({ status: z.literal("not-authorized") }),
});

export const currentFindingSchema = currentFindingIdentitySchema
  .extend({ id: digestSchema })
  .superRefine((finding, context) => {
    const { id: _id, ...identity } = finding;
    if (
      finding.id !== humanOsDigest(identity) ||
      finding.humanVerification.disposition !== "verified-finding" ||
      finding.aiAttempt.targetSnapshotDigest !== finding.verifiedTarget.digest
    ) {
      context.addIssue({
        code: "custom",
        message: "Current Finding lacks a matching Human Reproduction",
      });
    }
  });

export const currentHumanReviewResultSchema = z
  .strictObject({
    kind: z.literal("current-human-review-result"),
    schemaVersion: z.literal(2),
    verification: humanReproductionRecordSchema,
    finding: currentFindingSchema.nullable(),
  })
  .superRefine((result, context) => {
    if (
      (result.verification.disposition.status === "verified-finding") !==
      (result.finding !== null)
    ) {
      context.addIssue({
        code: "custom",
        message: "Human Review Result Finding gate is inconsistent",
      });
    }
    // The Finding is entitled to exist only by the fresh Human Reproduction it
    // came from, so it must name this one. Gating presence alone would let a
    // Finding minted for another Case be recorded as this Case's outcome: both
    // halves are internally valid, and each identity check passes against the
    // wrong partner. The digest is compared, not just the id, so a Finding
    // cannot cite a Human Reproduction whose content has since been rewritten.
    if (
      result.finding !== null &&
      (result.finding.humanVerification.id !== result.verification.id ||
        result.finding.humanVerification.digest !==
          humanOsDigest(result.verification) ||
        result.finding.humanVerification.caseId !==
          result.verification.caseId ||
        result.finding.caseId !== result.verification.caseId)
    ) {
      context.addIssue({
        code: "custom",
        path: ["finding"],
        message: "Human Review Result Finding cites another Human Reproduction",
      });
    }
  });

export type CurrentHumanReviewPolicy = z.infer<
  typeof currentHumanReviewPolicySchema
>;
export type CurrentHumanReviewCase = z.infer<
  typeof currentHumanReviewCaseSchema
>;
export type CurrentHumanReviewScheduleEvent = z.infer<
  typeof currentHumanReviewScheduleEventSchema
>;
export type CurrentVersionReviewProviderOutput = z.infer<
  typeof currentVersionReviewProviderOutputSchema
>;
export type CurrentVersionReview = z.infer<typeof currentVersionReviewSchema>;
export type HumanReproductionRuntimeIdentity = z.infer<
  typeof humanReproductionRuntimeIdentitySchema
>;
export type HumanReproductionEnvironmentOutcome = z.infer<
  typeof humanReproductionEnvironmentOutcomeSchema
>;
export type HumanReproductionPreparation = z.infer<
  typeof humanReproductionPreparationSchema
>;
export type CurrentHumanReviewDisposition = z.infer<
  typeof currentHumanReviewDispositionSchema
>;
export type HumanReproductionRecord = z.infer<
  typeof humanReproductionRecordSchema
>;
export type HumanReproductionRecordIdentity = z.input<
  typeof humanReproductionRecordIdentitySchema
>;
export type CurrentFinding = z.infer<typeof currentFindingSchema>;
export type CurrentHumanReviewResult = z.infer<
  typeof currentHumanReviewResultSchema
>;

export function defineCurrentHumanReviewPolicy(
  identity: z.input<typeof currentHumanReviewPolicyIdentitySchema>,
): CurrentHumanReviewPolicy {
  const parsed = currentHumanReviewPolicyIdentitySchema.parse(identity);
  return currentHumanReviewPolicySchema.parse({
    ...parsed,
    digest: humanOsDigest(parsed),
  });
}

export function currentHumanReviewCaseId(attemptId: string): string {
  return humanOsDigest({
    kind: "current-human-review-case-id",
    schemaVersion: 2,
    originAttemptId: digestSchema.parse(attemptId),
  });
}

export function defineCurrentHumanReviewCase(input: {
  readonly campaignId: string;
  readonly runId: string;
  readonly attempt: AIReproductionAttempt;
  readonly result: AIReproductionResult;
  readonly policy: CurrentHumanReviewPolicy;
  readonly initialQueueStatus: "active" | "deferred" | "escalation";
  readonly priority: Omit<
    z.infer<typeof queuePrioritySchema>,
    "stableTieBreaker"
  >;
  readonly admittedAt: string;
}): CurrentHumanReviewCase {
  const attempt = aiReproductionAttemptSchema.parse(input.attempt);
  const result = aiReproductionResultSchema.parse(input.result);
  const id = currentHumanReviewCaseId(attempt.id);
  const confirmed = result.status === "runtime-confirmed";
  if (!confirmed && result.status !== "runtime-inconclusive") {
    throw new Error("Only confirmed or inconclusive AI results form a Case");
  }
  return currentHumanReviewCaseSchema.parse({
    kind: "current-human-review-case",
    schemaVersion: 2,
    id,
    campaignId: input.campaignId,
    runId: input.runId,
    originAttempt: {
      kind: attempt.kind,
      schemaVersion: attempt.schemaVersion,
      id: attempt.id,
      digest: humanOsDigest(attempt),
      intakeId: attempt.intakeId,
      packetDigest: attempt.packet.digest,
      targetSnapshotDigest: attempt.target.snapshot.digest,
      runtimeProfileDigest: attempt.runtimeProfile.digest,
      setupPlanDigest: attempt.setupPlan.digest,
      toolPolicyDigest: humanOsDigest(attempt.toolPolicy),
    },
    originTarget: attempt.target.snapshot,
    causalIdentity: attempt.causalIdentity,
    attackerPremise: attempt.attackerPremise,
    securityEffect: attempt.securityEffect,
    originOutcome: confirmed
      ? { status: result.status, triagePacket: result.triagePacket }
      : { status: result.status, reason: result.reason },
    lane: confirmed ? "human-verification" : "escalation",
    initialQueueStatus: input.initialQueueStatus,
    priority: { ...input.priority, stableTieBreaker: id },
    policyDigest: input.policy.digest,
    admittedAt: input.admittedAt,
  });
}

export function defineCurrentHumanReviewScheduleEvent(
  identity: z.input<typeof scheduleEventIdentitySchema>,
): CurrentHumanReviewScheduleEvent {
  const parsed = scheduleEventIdentitySchema.parse(identity);
  return currentHumanReviewScheduleEventSchema.parse({
    ...parsed,
    id: humanOsDigest(parsed),
  });
}

export function defineHumanReproductionPreparation(
  identity: z.input<typeof preparationIdentitySchema>,
): HumanReproductionPreparation {
  const parsed = preparationIdentitySchema.parse(identity);
  return humanReproductionPreparationSchema.parse({
    ...parsed,
    id: humanOsDigest(parsed),
  });
}

export function defineHumanReproductionRecord(
  identity: HumanReproductionRecordIdentity,
): HumanReproductionRecord {
  const parsed = humanReproductionRecordIdentitySchema.parse(identity);
  return humanReproductionRecordSchema.parse({
    ...parsed,
    id: humanOsDigest(parsed),
  });
}
