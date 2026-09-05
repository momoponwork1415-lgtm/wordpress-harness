import { z } from "zod";

import { targetSnapshotRefSchema } from "../contracts.js";
import {
  canonicalJson,
  sha256Digest,
} from "../research-record/canonical-json.js";
import { targetFileManifestRefSchema } from "../source-mapping/contracts.js";
import { sourceBoundHypothesisArtifactSchema } from "../exploration/semantic-contracts.js";
import {
  referenceValidationCandidate,
  validationCandidateRefSchema,
  validationCandidateSchema,
  validationCriterionSchema,
  validationRecordRefSchema,
  validationRecordSchema,
  validationSourceAnchorSchema,
  type ValidationCandidate,
  type ValidationRecord,
} from "./contracts.js";

const digestSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const safeReviewTextSchema = z
  .string()
  .min(1)
  .max(2_000)
  .refine(
    (value) =>
      !/[\r\n`]/u.test(value) &&
      !/(?:<script|<\?php|\b(?:curl|wget|powershell|bash\s+-c|sh\s+-c|nc\s+-e|reverse\s+shell)\b)/iu.test(
        value,
      ),
    { message: "Review Packet text must not contain executable payloads" },
  );

const causalIdentitySchema = z.strictObject({
  rootCause: safeReviewTextSchema,
  attackerControlledPrimitive: safeReviewTextSchema,
  brokenSecurityProperty: safeReviewTextSchema,
});

const reviewCounterevidenceSchema = z.strictObject({
  criterion: validationCriterionSchema,
  reason: safeReviewTextSchema,
  evidence: z.array(validationSourceAnchorSchema).min(1).max(32),
});

const humanReproductionStepSchema = z.strictObject({
  ordinal: z.number().int().positive(),
  action: safeReviewTextSchema,
  sourceEvidence: z.array(validationSourceAnchorSchema).min(1).max(32),
});

export const humanReproductionSketchSchema = z
  .strictObject({
    attackerRole: z.enum([
      "unauthenticated",
      "subscriber",
      "contributor",
      "customer",
      "unresolved",
    ]),
    preconditions: z.array(safeReviewTextSchema).min(1).max(16),
    steps: z.array(humanReproductionStepSchema).min(1).max(32),
    expectedSecurityEffect: safeReviewTextSchema,
    stopConditions: z.array(safeReviewTextSchema).min(1).max(16),
  })
  .superRefine((sketch, context) => {
    sketch.steps.forEach((step, index) => {
      if (step.ordinal !== index + 1) {
        context.addIssue({
          code: "custom",
          path: ["steps", index, "ordinal"],
          message: "Human reproduction steps must be contiguous",
        });
      }
    });
  });

const riskAssessmentIdentitySchema = z.strictObject({
  kind: z.literal("risk-assessment"),
  schemaVersion: z.literal(1),
  candidate: validationCandidateRefSchema,
  validation: validationRecordRefSchema,
  validityDisposition: z.literal("ready-for-human"),
  impact: safeReviewTextSchema,
  securityEffect: safeReviewTextSchema,
  counterevidence: z.array(reviewCounterevidenceSchema).min(1).max(16),
  runtimeUncertainties: z.array(safeReviewTextSchema).min(1).max(16),
  humanReproductionSketch: humanReproductionSketchSchema,
});

export const riskAssessmentSchema = riskAssessmentIdentitySchema
  .extend({ id: digestSchema })
  .superRefine((assessment, context) => {
    const { id: _id, ...identity } = assessment;
    if (assessment.id !== sha256Digest(identity)) {
      context.addIssue({
        code: "custom",
        path: ["id"],
        message: "Risk Assessment ID does not match its content",
      });
    }
  });

export const riskAssessmentRefSchema = z.strictObject({
  kind: z.literal("risk-assessment"),
  schemaVersion: z.literal(1),
  id: digestSchema,
  digest: digestSchema,
  candidateId: digestSchema,
  validationId: digestSchema,
});

const humanReviewPacketIdentitySchema = z.strictObject({
  kind: z.literal("human-review-packet"),
  schemaVersion: z.literal(1),
  target: targetSnapshotRefSchema,
  manifest: targetFileManifestRefSchema,
  candidate: validationCandidateRefSchema,
  riskAssessment: riskAssessmentRefSchema,
  causalIdentity: causalIdentitySchema,
  attackerPremise: validationCandidateSchema.shape.attackerPremise,
  orderedRoute: validationCandidateSchema.shape.causalRoute,
  sourceEvidence: z.array(validationSourceAnchorSchema).min(1).max(128),
  counterevidence: z.array(reviewCounterevidenceSchema).min(1).max(16),
  runtimeUncertainties: z.array(safeReviewTextSchema).min(1).max(16),
  humanReproductionSketch: humanReproductionSketchSchema,
  reviewBoundary: z.strictObject({
    validity: z.literal("source-validated-not-human-verified"),
    findingEligible: z.literal(false),
  }),
});

export const humanReviewPacketSchema = humanReviewPacketIdentitySchema
  .extend({ id: digestSchema })
  .superRefine((packet, context) => {
    const { id: _id, ...identity } = packet;
    if (
      packet.id !== sha256Digest(identity) ||
      packet.target.digest !== packet.candidate.targetSnapshotDigest ||
      packet.manifest.digest !== packet.candidate.manifestDigest ||
      packet.candidate.id !== packet.riskAssessment.candidateId
    ) {
      context.addIssue({
        code: "custom",
        message: "Human Review Packet contains a foreign identity binding",
      });
    }
  });

export const humanReviewPacketRefSchema = z.strictObject({
  kind: z.literal("human-review-packet"),
  schemaVersion: z.literal(1),
  id: digestSchema,
  digest: digestSchema,
  candidateId: digestSchema,
  targetSnapshotDigest: digestSchema,
  manifestDigest: digestSchema,
});

const humanReviewPacketDeliveryRequestIdentitySchema = z.strictObject({
  kind: z.literal("human-review-packet-delivery-request"),
  schemaVersion: z.literal(1),
  campaignId: z
    .string()
    .min(1)
    .max(128)
    .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/),
  runId: z
    .string()
    .min(1)
    .max(128)
    .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/),
  packet: humanReviewPacketSchema,
});

export const humanReviewPacketDeliveryRequestSchema =
  humanReviewPacketDeliveryRequestIdentitySchema
    .extend({ digest: digestSchema })
    .superRefine((request, context) => {
      const { digest: _digest, ...identity } = request;
      if (request.digest !== sha256Digest(identity)) {
        context.addIssue({
          code: "custom",
          path: ["digest"],
          message: "Human Review Packet Delivery Request digest mismatch",
        });
      }
    });

export const humanReviewPacketDeliveryReceiptSchema = z
  .strictObject({
    kind: z.literal("human-review-packet-delivery-receipt"),
    schemaVersion: z.literal(1),
    deliveryRequestDigest: digestSchema,
    packetDigest: digestSchema,
    caseId: digestSchema,
    admission: z.enum(["active", "human-deferred"]),
    receiptDigest: digestSchema,
  })
  .superRefine((receipt, context) => {
    const { receiptDigest: _receiptDigest, ...identity } = receipt;
    if (receipt.receiptDigest !== sha256Digest(identity)) {
      context.addIssue({
        code: "custom",
        path: ["receiptDigest"],
        message: "Human Review Packet Delivery Receipt digest mismatch",
      });
    }
  });

export const humanReviewPacketHandoffSchema = z.strictObject({
  kind: z.literal("human-review-packet-handoff"),
  schemaVersion: z.literal(1),
  packet: humanReviewPacketRefSchema,
  riskAssessment: riskAssessmentRefSchema,
  delivery: z.discriminatedUnion("status", [
    z.strictObject({
      status: z.literal("delivered"),
      receipt: humanReviewPacketDeliveryReceiptSchema,
    }),
    z.strictObject({
      status: z.literal("delivery-failed"),
      reason: z.enum(["human-os-admission-unavailable", "delivery-failed"]),
    }),
  ]),
});

export const humanReviewPacketPreparationFailureSchema = z.strictObject({
  kind: z.literal("human-review-packet-preparation-failure"),
  schemaVersion: z.literal(1),
  candidate: validationCandidateRefSchema,
  validation: validationRecordRefSchema,
  reason: z.enum(["invalid-binding", "unsafe-review-content"]),
});

export type RiskAssessment = z.infer<typeof riskAssessmentSchema>;
export type RiskAssessmentRef = z.infer<typeof riskAssessmentRefSchema>;
export type HumanReviewPacket = z.infer<typeof humanReviewPacketSchema>;
export type HumanReviewPacketRef = z.infer<typeof humanReviewPacketRefSchema>;
export type HumanReviewPacketDeliveryReceipt = z.infer<
  typeof humanReviewPacketDeliveryReceiptSchema
>;
export type HumanReviewPacketDeliveryRequest = z.infer<
  typeof humanReviewPacketDeliveryRequestSchema
>;
export type HumanReviewPacketHandoff = z.infer<
  typeof humanReviewPacketHandoffSchema
>;
export type HumanReviewPacketPreparationFailure = z.infer<
  typeof humanReviewPacketPreparationFailureSchema
>;

export interface HumanReviewPacketDelivery {
  deliver(
    request: HumanReviewPacketDeliveryRequest,
  ): Promise<HumanReviewPacketDeliveryReceipt>;
}

export type HumanReviewPacketPreparationResult =
  | {
      readonly kind: "prepared";
      readonly riskAssessment: RiskAssessment;
      readonly packet: HumanReviewPacket;
    }
  | {
      readonly kind: "incomplete";
      readonly reason: "invalid-binding" | "unsafe-review-content";
    };

function referenceValidationRecord(record: ValidationRecord) {
  return validationRecordRefSchema.parse({
    kind: record.kind,
    schemaVersion: record.schemaVersion,
    validationId: record.validationId,
    candidateId: record.candidateId,
    digest: sha256Digest(record),
  });
}

export function referenceRiskAssessment(
  assessmentValue: RiskAssessment,
): RiskAssessmentRef {
  const assessment = riskAssessmentSchema.parse(assessmentValue);
  return riskAssessmentRefSchema.parse({
    kind: assessment.kind,
    schemaVersion: assessment.schemaVersion,
    id: assessment.id,
    digest: sha256Digest(assessment),
    candidateId: assessment.candidate.id,
    validationId: assessment.validation.validationId,
  });
}

export function referenceHumanReviewPacket(
  packetValue: HumanReviewPacket,
): HumanReviewPacketRef {
  const packet = humanReviewPacketSchema.parse(packetValue);
  return humanReviewPacketRefSchema.parse({
    kind: packet.kind,
    schemaVersion: packet.schemaVersion,
    id: packet.id,
    digest: sha256Digest(packet),
    candidateId: packet.candidate.id,
    targetSnapshotDigest: packet.target.digest,
    manifestDigest: packet.manifest.digest,
  });
}

export function defineHumanReviewPacketDeliveryRequest(input: {
  readonly campaignId: string;
  readonly runId: string;
  readonly packet: HumanReviewPacket;
}): HumanReviewPacketDeliveryRequest {
  const identity = humanReviewPacketDeliveryRequestIdentitySchema.parse({
    kind: "human-review-packet-delivery-request",
    schemaVersion: 1,
    ...input,
  });
  return humanReviewPacketDeliveryRequestSchema.parse({
    ...identity,
    digest: sha256Digest(identity),
  });
}

export function prepareHumanReviewPacket(input: {
  readonly candidate: ValidationCandidate;
  readonly validation: ValidationRecord;
  readonly hypothesis: z.infer<typeof sourceBoundHypothesisArtifactSchema>;
}): HumanReviewPacketPreparationResult {
  const candidateResult = validationCandidateSchema.safeParse(input.candidate);
  const validationResult = validationRecordSchema.safeParse(input.validation);
  const hypothesisResult = sourceBoundHypothesisArtifactSchema.safeParse(
    input.hypothesis,
  );
  if (
    !candidateResult.success ||
    !validationResult.success ||
    !hypothesisResult.success
  ) {
    return { kind: "incomplete", reason: "invalid-binding" };
  }
  const candidate = candidateResult.data;
  const validation = validationResult.data;
  const hypothesis = hypothesisResult.data;
  const hypothesisDigest = sha256Digest(hypothesis);
  if (
    validation.status !== "ready-for-human" ||
    validation.validationId !== candidate.id ||
    validation.candidateId !== candidate.id ||
    !candidate.origins.some(
      (origin) => origin.subjectDigest === hypothesisDigest,
    ) ||
    hypothesis.target.digest !== candidate.target.digest ||
    hypothesis.manifest.digest !== candidate.manifest.digest ||
    hypothesis.value.causalIdentity.brokenSecurityProperty !==
      candidate.brokenSecurityProperty
  ) {
    return { kind: "incomplete", reason: "invalid-binding" };
  }
  const counterevidence = [
    ...new Map(
      validation.validatorAttempts
        .filter((attempt) => attempt.status === "completed")
        .flatMap((attempt) =>
          attempt.output.criteria
            .filter(
              (criterion) =>
                criterion.criterion === "counterevidence-and-proof-gap",
            )
            .map((criterion) => {
              const projected = {
                criterion: criterion.criterion,
                reason: criterion.reason,
                evidence: criterion.evidence,
              };
              return [canonicalJson(projected), projected] as const;
            }),
        ),
    ).values(),
  ];
  const sourceEvidence = [
    ...new Map(
      candidate.causalRoute
        .flatMap((step) => step.evidence)
        .map((anchor) => [canonicalJson(anchor), anchor] as const),
    ).values(),
  ];
  const reproduction = {
    attackerRole: candidate.attackerPremise,
    preconditions: [
      "Use only the Packet-bound Target version and a fresh disposable environment.",
      "Do not reuse discovery sessions, credentials, cookies, or private transcripts.",
    ],
    steps: candidate.causalRoute.map((step) => ({
      ordinal: step.ordinal,
      action: step.claim,
      sourceEvidence: step.evidence,
    })),
    expectedSecurityEffect: hypothesis.value.impact,
    stopConditions: [
      "Stop if the Target, version, Snapshot, or Manifest identity does not match the Packet.",
      "Stop without a Finding when the expected Security Effect is not independently observed.",
    ],
  };
  const runtimeUncertainties = [
    "Source-only Validation does not establish runtime exploitability or the observable Security Effect.",
    ...hypothesis.value.unknowns.map((unknown) => unknown.requiredEvidence),
  ];
  const candidateRef = referenceValidationCandidate(candidate);
  const validationRef = referenceValidationRecord(validation);
  const riskIdentity = {
    kind: "risk-assessment",
    schemaVersion: 1,
    candidate: candidateRef,
    validation: validationRef,
    validityDisposition: "ready-for-human",
    impact: hypothesis.value.impact,
    securityEffect: candidate.brokenSecurityProperty,
    counterevidence,
    runtimeUncertainties,
    humanReproductionSketch: reproduction,
  } as const;
  const riskResult = riskAssessmentSchema.safeParse({
    ...riskIdentity,
    id: sha256Digest(riskIdentity),
  });
  if (!riskResult.success) {
    return { kind: "incomplete", reason: "unsafe-review-content" };
  }
  const riskAssessment = riskResult.data;
  const packetIdentity = {
    kind: "human-review-packet",
    schemaVersion: 1,
    target: candidate.target,
    manifest: candidate.manifest,
    candidate: candidateRef,
    riskAssessment: referenceRiskAssessment(riskAssessment),
    causalIdentity: hypothesis.value.causalIdentity,
    attackerPremise: candidate.attackerPremise,
    orderedRoute: candidate.causalRoute,
    sourceEvidence,
    counterevidence,
    runtimeUncertainties,
    humanReproductionSketch: reproduction,
    reviewBoundary: {
      validity: "source-validated-not-human-verified",
      findingEligible: false,
    },
  } as const;
  const packetResult = humanReviewPacketSchema.safeParse({
    ...packetIdentity,
    id: sha256Digest(packetIdentity),
  });
  return packetResult.success
    ? {
        kind: "prepared",
        riskAssessment,
        packet: packetResult.data,
      }
    : { kind: "incomplete", reason: "unsafe-review-content" };
}
