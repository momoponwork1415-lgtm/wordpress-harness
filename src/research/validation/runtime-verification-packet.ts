import { z } from "zod";

import { targetSnapshotRefSchema } from "../contracts.js";
import { sourceBoundHypothesisArtifactSchema } from "../exploration/semantic-contracts.js";
import {
  canonicalJson,
  sha256Digest,
} from "../research-record/canonical-json.js";
import { targetFileManifestRefSchema } from "../source-mapping/contracts.js";
import {
  currentValidationRecordRefSchema,
  currentValidationRecordSchema,
  referenceValidationCandidate,
  validationCandidateRefSchema,
  validationCandidateSchema,
  validationCriteria,
  validationCriterionSchema,
  validationSourceAnchorSchema,
  validationThreatContextSchema,
  type ValidationCandidate,
} from "./contracts.js";

const digestSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const identifierSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
const shareableResearchTextSchema = z
  .string()
  .min(1)
  .max(2_000)
  .refine(
    (value) =>
      !/[\r\n`]/u.test(value) &&
      !/^(?:GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+\//iu.test(value) &&
      !/(?:<script|<\?php|\b(?:curl|wget|powershell|bash\s+-c|sh\s+-c|nc\s+-e|reverse\s+shell)\b)/iu.test(
        value,
      ),
    {
      message:
        "Runtime Verification Packet text must not contain an exact payload or raw request",
    },
  );

const sourceScreenCriterionSchema = z.strictObject({
  criterion: validationCriterionSchema,
  status: z.enum(["pass", "fail", "unknown"]),
  reason: shareableResearchTextSchema,
  evidence: z.array(validationSourceAnchorSchema).min(1).max(32),
});

const closestControlSchema = z.strictObject({
  status: z.enum(["pass", "unknown"]),
  description: shareableResearchTextSchema,
  evidence: z.array(validationSourceAnchorSchema).min(1).max(32),
});

const runtimeCounterevidenceSchema = z.strictObject({
  status: z.enum(["pass", "unknown"]),
  description: shareableResearchTextSchema,
  evidence: z.array(validationSourceAnchorSchema).min(1).max(32),
});

const runtimeSecurityEffectSchema = z.strictObject({
  impact: sourceBoundHypothesisArtifactSchema.shape.value.shape.impact,
  claimedPropertyChange: shareableResearchTextSchema,
});

const runtimeSourceScreenSchema = z
  .strictObject({
    attempt: z.strictObject({
      attemptId: identifierSchema,
      digest: digestSchema,
    }),
    criteria: z.array(sourceScreenCriterionSchema).length(5),
  })
  .superRefine((screen, context) => {
    const observed = new Set(
      screen.criteria.map((criterion) => criterion.criterion),
    );
    if (
      observed.size !== validationCriteria.length ||
      validationCriteria.some((criterion) => !observed.has(criterion))
    ) {
      context.addIssue({
        code: "custom",
        path: ["criteria"],
        message: "Runtime Packet must include the complete source screen",
      });
    }
  });

const runtimeReproductionStepSchema = z.strictObject({
  ordinal: z.number().int().positive(),
  action: shareableResearchTextSchema,
  sourceEvidence: z.array(validationSourceAnchorSchema).min(1).max(32),
});

export const runtimeReproductionSketchSchema = z
  .strictObject({
    attackerRole: validationCandidateSchema.shape.attackerPremise,
    preconditions: z.array(shareableResearchTextSchema).min(1).max(16),
    steps: z.array(runtimeReproductionStepSchema).min(1).max(32),
    expectedSecurityEffect: shareableResearchTextSchema,
    successCriterion: shareableResearchTextSchema,
    stopConditions: z.array(shareableResearchTextSchema).min(1).max(16),
  })
  .superRefine((sketch, context) => {
    sketch.steps.forEach((step, index) => {
      if (step.ordinal !== index + 1) {
        context.addIssue({
          code: "custom",
          path: ["steps", index, "ordinal"],
          message: "Runtime reproduction steps must be contiguous",
        });
      }
    });
  });

const runtimeRiskAssessmentIdentitySchema = z.strictObject({
  kind: z.literal("risk-assessment"),
  schemaVersion: z.literal(2),
  candidate: validationCandidateRefSchema,
  validation: currentValidationRecordRefSchema,
  validationDisposition: z.literal("ready-for-runtime"),
  attackerRole: validationCandidateSchema.shape.attackerPremise,
  prerequisites: z.array(shareableResearchTextSchema).min(1).max(16),
  exposedSurface: shareableResearchTextSchema,
  securityEffect: runtimeSecurityEffectSchema,
  configuration: z.array(shareableResearchTextSchema).min(1).max(16),
  blastRadius: shareableResearchTextSchema,
  counterevidence: runtimeCounterevidenceSchema,
  runtimeUncertainties: z.array(shareableResearchTextSchema).min(1).max(32),
});

export const runtimeRiskAssessmentSchema = runtimeRiskAssessmentIdentitySchema
  .extend({ id: digestSchema })
  .superRefine((assessment, context) => {
    const { id: _id, ...identity } = assessment;
    if (assessment.id !== sha256Digest(identity)) {
      context.addIssue({
        code: "custom",
        path: ["id"],
        message: "Runtime Risk Assessment ID does not match its content",
      });
    }
  });

export const runtimeRiskAssessmentRefSchema = z.strictObject({
  kind: z.literal("risk-assessment"),
  schemaVersion: z.literal(2),
  id: digestSchema,
  digest: digestSchema,
  candidateId: digestSchema,
  validationId: digestSchema,
});

const runtimeVerificationPacketIdentitySchema = z.strictObject({
  kind: z.literal("runtime-verification-packet"),
  schemaVersion: z.literal(2),
  target: targetSnapshotRefSchema,
  manifest: targetFileManifestRefSchema,
  candidate: validationCandidateRefSchema,
  validation: currentValidationRecordRefSchema,
  threatContext: validationThreatContextSchema,
  riskAssessment: runtimeRiskAssessmentSchema,
  causalIdentity:
    sourceBoundHypothesisArtifactSchema.shape.value.shape.causalIdentity,
  attackerPremise: validationCandidateSchema.shape.attackerPremise,
  securityEffect: runtimeSecurityEffectSchema,
  sourceRoute: validationCandidateSchema.shape.causalRoute,
  sourceEvidence: z.array(validationSourceAnchorSchema).min(1).max(128),
  sourceScreen: runtimeSourceScreenSchema,
  closestControl: closestControlSchema,
  counterevidence: runtimeCounterevidenceSchema,
  runtimeUncertainties: z.array(shareableResearchTextSchema).min(1).max(32),
  runtimeReproductionSketch: runtimeReproductionSketchSchema,
  researchBoundary: z.strictObject({
    sourceOnly: z.literal(true),
    exactPayloadIncluded: z.literal(false),
    rawRequestIncluded: z.literal(false),
    findingEligible: z.literal(false),
  }),
});

export const runtimeVerificationPacketSchema =
  runtimeVerificationPacketIdentitySchema
    .extend({ id: digestSchema })
    .superRefine((packet, context) => {
      const { id: _id, ...identity } = packet;
      if (
        packet.id !== sha256Digest(identity) ||
        packet.target.digest !== packet.candidate.targetSnapshotDigest ||
        packet.manifest.digest !== packet.candidate.manifestDigest ||
        packet.candidate.id !== packet.validation.candidateId ||
        packet.validation.validationId !== packet.candidate.id ||
        packet.threatContext.candidateId !== packet.candidate.id ||
        packet.threatContext.targetSnapshotDigest !== packet.target.digest ||
        packet.riskAssessment.candidate.id !== packet.candidate.id ||
        packet.riskAssessment.validation.digest !== packet.validation.digest
      ) {
        context.addIssue({
          code: "custom",
          message: "Runtime Verification Packet contains a foreign binding",
        });
      }
    });

export const runtimeVerificationPacketRefSchema = z.strictObject({
  kind: z.literal("runtime-verification-packet"),
  schemaVersion: z.literal(2),
  id: digestSchema,
  digest: digestSchema,
  candidateId: digestSchema,
  targetSnapshotDigest: digestSchema,
  manifestDigest: digestSchema,
});

const runtimeVerificationPacketDeliveryRequestIdentitySchema = z.strictObject({
  kind: z.literal("runtime-verification-packet-delivery-request"),
  schemaVersion: z.literal(2),
  campaignId: identifierSchema,
  runId: identifierSchema,
  packet: runtimeVerificationPacketSchema,
});

export const runtimeVerificationPacketDeliveryRequestSchema =
  runtimeVerificationPacketDeliveryRequestIdentitySchema
    .extend({ digest: digestSchema })
    .superRefine((request, context) => {
      const { digest: _digest, ...identity } = request;
      if (request.digest !== sha256Digest(identity)) {
        context.addIssue({
          code: "custom",
          path: ["digest"],
          message:
            "Runtime Verification Packet Delivery Request digest mismatch",
        });
      }
    });

export const runtimeVerificationPacketDeliveryReceiptSchema = z
  .strictObject({
    kind: z.literal("runtime-verification-packet-delivery-receipt"),
    schemaVersion: z.literal(2),
    deliveryRequestDigest: digestSchema,
    packetDigest: digestSchema,
    intakeId: digestSchema,
    admission: z.literal("accepted-for-ai-reproduction"),
    receiptDigest: digestSchema,
  })
  .superRefine((receipt, context) => {
    const { receiptDigest: _receiptDigest, ...identity } = receipt;
    if (receipt.receiptDigest !== sha256Digest(identity)) {
      context.addIssue({
        code: "custom",
        path: ["receiptDigest"],
        message: "Runtime Verification Packet Delivery Receipt digest mismatch",
      });
    }
  });

export const runtimeVerificationPacketHandoffSchema = z.strictObject({
  kind: z.literal("runtime-verification-packet-handoff"),
  schemaVersion: z.literal(2),
  packet: runtimeVerificationPacketRefSchema,
  riskAssessment: runtimeRiskAssessmentRefSchema,
  delivery: z.discriminatedUnion("status", [
    z.strictObject({
      status: z.literal("delivered"),
      receipt: runtimeVerificationPacketDeliveryReceiptSchema,
    }),
    z.strictObject({
      status: z.literal("delivery-failed"),
      reason: z.enum(["human-os-intake-unavailable", "delivery-failed"]),
    }),
  ]),
});

export const runtimeVerificationPacketPreparationFailureSchema = z.strictObject(
  {
    kind: z.literal("runtime-verification-packet-preparation-failure"),
    schemaVersion: z.literal(2),
    candidate: validationCandidateRefSchema,
    validation: currentValidationRecordRefSchema,
    reason: z.enum(["invalid-binding", "unsafe-runtime-content"]),
  },
);

export type RuntimeRiskAssessment = z.infer<typeof runtimeRiskAssessmentSchema>;
export type RuntimeRiskAssessmentRef = z.infer<
  typeof runtimeRiskAssessmentRefSchema
>;
export type RuntimeVerificationPacket = z.infer<
  typeof runtimeVerificationPacketSchema
>;
export type RuntimeVerificationPacketRef = z.infer<
  typeof runtimeVerificationPacketRefSchema
>;
export type RuntimeVerificationPacketDeliveryRequest = z.infer<
  typeof runtimeVerificationPacketDeliveryRequestSchema
>;
export type RuntimeVerificationPacketDeliveryReceipt = z.infer<
  typeof runtimeVerificationPacketDeliveryReceiptSchema
>;
export type RuntimeVerificationPacketHandoff = z.infer<
  typeof runtimeVerificationPacketHandoffSchema
>;
export type RuntimeVerificationPacketPreparationFailure = z.infer<
  typeof runtimeVerificationPacketPreparationFailureSchema
>;

export interface RuntimeVerificationPacketDelivery {
  deliver(
    request: RuntimeVerificationPacketDeliveryRequest,
  ): Promise<RuntimeVerificationPacketDeliveryReceipt>;
}

export type RuntimeVerificationPacketPreparationResult =
  | {
      readonly kind: "prepared";
      readonly riskAssessment: RuntimeRiskAssessment;
      readonly packet: RuntimeVerificationPacket;
    }
  | {
      readonly kind: "incomplete";
      readonly reason: "invalid-binding" | "unsafe-runtime-content";
    };

export function referenceRuntimeRiskAssessment(
  assessmentValue: RuntimeRiskAssessment,
): RuntimeRiskAssessmentRef {
  const assessment = runtimeRiskAssessmentSchema.parse(assessmentValue);
  return runtimeRiskAssessmentRefSchema.parse({
    kind: assessment.kind,
    schemaVersion: assessment.schemaVersion,
    id: assessment.id,
    digest: sha256Digest(assessment),
    candidateId: assessment.candidate.id,
    validationId: assessment.validation.validationId,
  });
}

export function referenceRuntimeVerificationPacket(
  packetValue: RuntimeVerificationPacket,
): RuntimeVerificationPacketRef {
  const packet = runtimeVerificationPacketSchema.parse(packetValue);
  return runtimeVerificationPacketRefSchema.parse({
    kind: packet.kind,
    schemaVersion: packet.schemaVersion,
    id: packet.id,
    digest: sha256Digest(packet),
    candidateId: packet.candidate.id,
    targetSnapshotDigest: packet.target.digest,
    manifestDigest: packet.manifest.digest,
  });
}

export function defineRuntimeVerificationPacketDeliveryRequest(input: {
  readonly campaignId: string;
  readonly runId: string;
  readonly packet: RuntimeVerificationPacket;
}): RuntimeVerificationPacketDeliveryRequest {
  const identity = runtimeVerificationPacketDeliveryRequestIdentitySchema.parse(
    {
      kind: "runtime-verification-packet-delivery-request",
      schemaVersion: 2,
      ...input,
    },
  );
  return runtimeVerificationPacketDeliveryRequestSchema.parse({
    ...identity,
    digest: sha256Digest(identity),
  });
}

export function prepareRuntimeVerificationPacket(input: {
  readonly candidate: ValidationCandidate;
  readonly validation: z.infer<typeof currentValidationRecordSchema>;
  readonly hypothesis: z.infer<typeof sourceBoundHypothesisArtifactSchema>;
  readonly threatContext: z.infer<typeof validationThreatContextSchema>;
}): RuntimeVerificationPacketPreparationResult {
  const candidateResult = validationCandidateSchema.safeParse(input.candidate);
  const validationResult = currentValidationRecordSchema.safeParse(
    input.validation,
  );
  const hypothesisResult = sourceBoundHypothesisArtifactSchema.safeParse(
    input.hypothesis,
  );
  const threatContextResult = validationThreatContextSchema.safeParse(
    input.threatContext,
  );
  if (
    !candidateResult.success ||
    !validationResult.success ||
    !hypothesisResult.success ||
    !threatContextResult.success
  ) {
    return { kind: "incomplete", reason: "invalid-binding" };
  }
  const candidate = candidateResult.data;
  const validation = validationResult.data;
  const hypothesis = hypothesisResult.data;
  const threatContext = threatContextResult.data;
  if (
    validation.status !== "ready-for-runtime" ||
    validation.validatorAttempt.status !== "completed" ||
    validation.validationId !== candidate.id ||
    validation.candidateId !== candidate.id ||
    !candidate.origins.some(
      (origin) => origin.subjectDigest === sha256Digest(hypothesis),
    ) ||
    hypothesis.target.digest !== candidate.target.digest ||
    hypothesis.manifest.digest !== candidate.manifest.digest ||
    hypothesis.value.attackerPremise !== candidate.attackerPremise ||
    threatContext.candidateId !== candidate.id ||
    threatContext.targetSnapshotDigest !== candidate.target.digest ||
    threatContext.permittedAttacker !== candidate.attackerPremise ||
    hypothesis.value.causalIdentity.brokenSecurityProperty !==
      candidate.brokenSecurityProperty
  ) {
    return { kind: "incomplete", reason: "invalid-binding" };
  }

  const output = validation.validatorAttempt.output;
  const control = output.criteria.find(
    (criterion) => criterion.criterion === "broken-control",
  );
  const counterevidence = output.criteria.find(
    (criterion) => criterion.criterion === "counterevidence-and-proof-gap",
  );
  const premise = output.criteria.find(
    (criterion) => criterion.criterion === "reachability-and-premise",
  );
  if (
    control === undefined ||
    counterevidence === undefined ||
    premise === undefined ||
    control.status === "fail" ||
    counterevidence.status === "fail"
  ) {
    return { kind: "incomplete", reason: "invalid-binding" };
  }

  const runtimeUncertainties = [
    "Source-only Validation does not establish runtime exploitability or observe the Security Effect.",
    ...output.criteria
      .filter((criterion) => criterion.status === "unknown")
      .map((criterion) => criterion.reason),
    ...hypothesis.value.unknowns.map((unknown) => unknown.requiredEvidence),
  ];
  const sourceEvidence = [
    ...new Map(
      candidate.causalRoute
        .flatMap((step) => step.evidence)
        .map((anchor) => [canonicalJson(anchor), anchor] as const),
    ).values(),
  ];
  const candidateRef = referenceValidationCandidate(candidate);
  const validationRef = currentValidationRecordRefSchema.parse({
    kind: validation.kind,
    schemaVersion: validation.schemaVersion,
    validationId: validation.validationId,
    candidateId: validation.candidateId,
    digest: sha256Digest(validation),
  });
  const securityEffect = {
    impact: hypothesis.value.impact,
    claimedPropertyChange: candidate.brokenSecurityProperty,
  } as const;
  const riskIdentity = {
    kind: "risk-assessment",
    schemaVersion: 2,
    candidate: candidateRef,
    validation: validationRef,
    validationDisposition: "ready-for-runtime",
    attackerRole: candidate.attackerPremise,
    prerequisites: [premise.reason],
    exposedSurface:
      threatContext.publicSurface.join("; ") ||
      candidate.causalRoute[0]?.claim ||
      premise.reason,
    securityEffect,
    configuration: [
      `Use Target ${candidate.target.pluginSlug} ${candidate.target.version} with the Packet-bound Manifest.`,
      ...threatContext.technicalExclusions.map(
        (exclusion) => `Technical exclusion: ${exclusion}`,
      ),
    ],
    blastRadius: `Potential ${hypothesis.value.impact} within the Packet-bound Target.`,
    counterevidence: {
      status: counterevidence.status,
      description: counterevidence.reason,
      evidence: counterevidence.evidence,
    },
    runtimeUncertainties,
  } as const;
  const riskResult = runtimeRiskAssessmentSchema.safeParse({
    ...riskIdentity,
    id: sha256Digest(riskIdentity),
  });
  if (!riskResult.success) {
    return { kind: "incomplete", reason: "unsafe-runtime-content" };
  }
  const riskAssessment = riskResult.data;
  const reproductionSketch = {
    attackerRole: candidate.attackerPremise,
    preconditions: [
      `Use a fresh disposable environment for Target ${candidate.target.pluginSlug} ${candidate.target.version}.`,
      premise.reason,
    ],
    steps: candidate.causalRoute.map((step) => ({
      ordinal: step.ordinal,
      action: step.claim,
      sourceEvidence: step.evidence,
    })),
    expectedSecurityEffect: candidate.brokenSecurityProperty,
    successCriterion: `Observe the claimed ${hypothesis.value.impact} effect through the real Target interface.`,
    stopConditions: [
      "Stop if the Target, version, Snapshot, or Manifest identity differs from this Packet.",
      "Do not create a Finding from this source-only Packet or from AI output alone.",
    ],
  } as const;
  const packetIdentity = {
    kind: "runtime-verification-packet",
    schemaVersion: 2,
    target: candidate.target,
    manifest: candidate.manifest,
    candidate: candidateRef,
    validation: validationRef,
    threatContext,
    riskAssessment,
    causalIdentity: hypothesis.value.causalIdentity,
    attackerPremise: candidate.attackerPremise,
    securityEffect,
    sourceRoute: candidate.causalRoute,
    sourceEvidence,
    sourceScreen: {
      attempt: {
        attemptId: validation.validatorAttempt.execution.attemptId,
        digest: validation.validatorAttempt.execution.digest,
      },
      criteria: output.criteria,
    },
    closestControl: {
      status: control.status,
      description: control.reason,
      evidence: control.evidence,
    },
    counterevidence: riskAssessment.counterevidence,
    runtimeUncertainties,
    runtimeReproductionSketch: reproductionSketch,
    researchBoundary: {
      sourceOnly: true,
      exactPayloadIncluded: false,
      rawRequestIncluded: false,
      findingEligible: false,
    },
  } as const;
  const packetResult = runtimeVerificationPacketSchema.safeParse({
    ...packetIdentity,
    id: sha256Digest(packetIdentity),
  });
  return packetResult.success
    ? { kind: "prepared", riskAssessment, packet: packetResult.data }
    : { kind: "incomplete", reason: "unsafe-runtime-content" };
}
