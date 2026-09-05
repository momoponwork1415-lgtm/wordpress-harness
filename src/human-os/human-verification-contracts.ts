import { z } from "zod";

import {
  humanReviewPacketDeliveryReceiptSchema,
  humanReviewPacketDeliveryRequestSchema,
  humanReviewPacketRefSchema,
  referenceHumanReviewPacket,
  type HumanReviewPacket,
  type HumanReviewPacketDeliveryReceipt,
  type HumanReviewPacketDeliveryRequest,
} from "../research/validation/human-review-packet.js";
import { humanOsDigest } from "./canonical-json.js";
import {
  humanVerificationEnvironmentRefSchema,
  type HumanVerificationEnvironmentRef,
} from "./human-verification-environment-contracts.js";

const digestSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const identifierSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
const safeHumanReviewTextSchema = z
  .string()
  .min(1)
  .max(4_000)
  .refine(
    (value) =>
      !/[\r\n`]/u.test(value) &&
      !/(?:<script|<\?php|authorization\s*:\s*bearer|cookie\s*:|password\s*=|\b(?:curl|wget|powershell|bash\s+-c|sh\s+-c|nc\s+-e|reverse\s+shell)\b)/iu.test(
        value,
      ),
    { message: "Human Verification text must be sanitized and non-executable" },
  );

export function humanReviewMechanismDigest(packet: HumanReviewPacket): string {
  return humanOsDigest({
    kind: "human-review-mechanism",
    schemaVersion: 1,
    causalIdentity: packet.causalIdentity,
  });
}

export function humanReviewCaseId(packet: HumanReviewPacket): string {
  return humanOsDigest({
    kind: "human-review-case-id",
    schemaVersion: 1,
    packetDigest: humanOsDigest(packet),
  });
}

export const humanReviewCaseSchema = z
  .strictObject({
    kind: z.literal("human-review-case"),
    schemaVersion: z.literal(1),
    id: digestSchema,
    campaignId: identifierSchema,
    packet: humanReviewPacketRefSchema,
    mechanismDigest: digestSchema,
    queueStatus: z.enum(["active", "human-deferred"]),
    admittedAt: z.string().datetime(),
    firstDeliveryRequestDigest: digestSchema,
  })
  .superRefine((reviewCase, context) => {
    const expectedId = humanOsDigest({
      kind: "human-review-case-id",
      schemaVersion: 1,
      packetDigest: reviewCase.packet.digest,
    });
    if (reviewCase.id !== expectedId) {
      context.addIssue({
        code: "custom",
        path: ["id"],
        message: "Human Review Case ID does not match its Packet",
      });
    }
  });

const humanReviewerSchema = z.strictObject({
  kind: z.literal("human-reviewer"),
  id: identifierSchema,
});

const unavailableEnvironmentSchema = z.strictObject({
  kind: z.literal("human-verification-environment-unavailable"),
  schemaVersion: z.literal(1),
  requestDigest: digestSchema,
});

export const humanVerificationEnvironmentBindingSchema = z.union([
  humanVerificationEnvironmentRefSchema,
  unavailableEnvironmentSchema,
]);

const targetInterfaceStepSchema = z.strictObject({
  ordinal: z.number().int().positive(),
  interface: z.enum([
    "wordpress-public-site",
    "wordpress-admin-ui",
    "wordpress-rest-api",
    "wordpress-authentication",
  ]),
  action: safeHumanReviewTextSchema,
  observation: safeHumanReviewTextSchema,
});

const securityEffectSchema = z.strictObject({
  status: z.enum(["observed", "not-observed", "uncertain"]),
  description: safeHumanReviewTextSchema,
});

const requestedEvidenceSchema = z.strictObject({
  kind: z.enum(["source", "runtime"]),
  question: safeHumanReviewTextSchema,
  acceptanceCriterion: safeHumanReviewTextSchema,
});

export const humanReviewDispositionSchema = z.discriminatedUnion("status", [
  z.strictObject({
    status: z.literal("verified-finding"),
    reason: safeHumanReviewTextSchema,
  }),
  z.strictObject({
    status: z.literal("rejected"),
    reason: safeHumanReviewTextSchema,
  }),
  z.strictObject({
    status: z.literal("more-evidence-required"),
    reason: safeHumanReviewTextSchema,
    requestedEvidence: z.array(requestedEvidenceSchema).min(1).max(16),
  }),
  z.strictObject({
    status: z.literal("blocked"),
    reason: safeHumanReviewTextSchema,
    blocker: z.enum([
      "environment-unavailable",
      "environment-failed",
      "assistant-failed",
      "target-interface-unavailable",
      "human-capacity-unavailable",
    ]),
  }),
]);

const humanVerificationRecordIdentitySchema = z
  .strictObject({
    kind: z.literal("human-verification-record"),
    schemaVersion: z.literal(1),
    caseId: digestSchema,
    packetDigest: digestSchema,
    environment: humanVerificationEnvironmentBindingSchema,
    reviewer: humanReviewerSchema,
    performedAt: z.string().datetime(),
    attackerRole: z.enum([
      "unauthenticated",
      "subscriber",
      "contributor",
      "customer",
      "unresolved",
    ]),
    targetInterfaceSteps: z.array(targetInterfaceStepSchema).max(64),
    securityEffect: securityEffectSchema,
    disposition: humanReviewDispositionSchema,
  })
  .superRefine((record, context) => {
    record.targetInterfaceSteps.forEach((step, index) => {
      if (step.ordinal !== index + 1) {
        context.addIssue({
          code: "custom",
          path: ["targetInterfaceSteps", index, "ordinal"],
          message: "Target interface steps must be contiguous",
        });
      }
    });
    const environmentReady =
      record.environment.kind === "human-verification-environment";
    const hasSteps = record.targetInterfaceSteps.length > 0;
    if (
      (record.disposition.status === "verified-finding" &&
        (!environmentReady ||
          !hasSteps ||
          record.securityEffect.status !== "observed" ||
          record.attackerRole === "unresolved")) ||
      (record.disposition.status === "rejected" &&
        (!environmentReady ||
          !hasSteps ||
          record.securityEffect.status !== "not-observed")) ||
      (record.disposition.status === "more-evidence-required" &&
        record.securityEffect.status !== "uncertain") ||
      (!environmentReady && record.disposition.status !== "blocked") ||
      (record.disposition.status === "blocked" &&
        record.securityEffect.status !== "uncertain")
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Human Review Disposition does not match environment and Security Effect evidence",
      });
    }
  });

export const humanVerificationRecordSchema =
  humanVerificationRecordIdentitySchema
    .extend({ id: digestSchema })
    .superRefine((record, context) => {
      const { id: _id, ...identity } = record;
      if (record.id !== humanOsDigest(identity)) {
        context.addIssue({
          code: "custom",
          path: ["id"],
          message: "Human Verification Record ID does not match its content",
        });
      }
    });

export const humanVerificationRecordRefSchema = z.strictObject({
  kind: z.literal("human-verification-record"),
  schemaVersion: z.literal(1),
  id: digestSchema,
  digest: digestSchema,
  caseId: digestSchema,
  disposition: z.enum([
    "verified-finding",
    "rejected",
    "more-evidence-required",
    "blocked",
  ]),
});

const findingIdentitySchema = z.strictObject({
  kind: z.literal("finding"),
  schemaVersion: z.literal(1),
  caseId: digestSchema,
  packet: humanReviewPacketRefSchema,
  verification: humanVerificationRecordRefSchema,
  target: humanReviewPacketDeliveryRequestSchema.shape.packet.shape.target,
  environment: humanVerificationEnvironmentRefSchema,
  causalIdentity:
    humanReviewPacketDeliveryRequestSchema.shape.packet.shape.causalIdentity,
  attackerRole: z.enum([
    "unauthenticated",
    "subscriber",
    "contributor",
    "customer",
  ]),
  securityEffect: safeHumanReviewTextSchema,
  reviewer: humanReviewerSchema,
  verifiedAt: z.string().datetime(),
  externalAction: z.strictObject({ status: z.literal("not-authorized") }),
});

export const findingSchema = findingIdentitySchema
  .extend({ id: digestSchema })
  .superRefine((finding, context) => {
    const { id: _id, ...identity } = finding;
    if (
      finding.id !== humanOsDigest(identity) ||
      finding.verification.disposition !== "verified-finding" ||
      finding.environment.targetSnapshotDigest !== finding.target.digest
    ) {
      context.addIssue({
        code: "custom",
        message: "Finding lacks a matching verified Human Verification",
      });
    }
  });

const evidenceRequestIdentitySchema = z.strictObject({
  kind: z.literal("evidence-request"),
  schemaVersion: z.literal(1),
  caseId: digestSchema,
  packetDigest: digestSchema,
  verification: humanVerificationRecordRefSchema,
  requestedBy: humanReviewerSchema,
  requestedAt: z.string().datetime(),
  reason: safeHumanReviewTextSchema,
  requestedEvidence: z.array(requestedEvidenceSchema).min(1).max(16),
});

export const evidenceRequestSchema = evidenceRequestIdentitySchema
  .extend({ id: digestSchema })
  .superRefine((request, context) => {
    const { id: _id, ...identity } = request;
    if (
      request.id !== humanOsDigest(identity) ||
      request.verification.disposition !== "more-evidence-required"
    ) {
      context.addIssue({
        code: "custom",
        message: "Evidence Request lacks a matching Human Verification",
      });
    }
  });

export const humanVerificationResultSchema = z
  .strictObject({
    kind: z.literal("human-verification-result"),
    schemaVersion: z.literal(1),
    verification: humanVerificationRecordSchema,
    finding: findingSchema.nullable(),
    evidenceRequest: evidenceRequestSchema.nullable(),
  })
  .superRefine((result, context) => {
    const status = result.verification.disposition.status;
    if (
      (status === "verified-finding") !== (result.finding !== null) ||
      (status === "more-evidence-required") !==
        (result.evidenceRequest !== null)
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Human Verification result artifact does not match its Disposition",
      });
    }
  });

export type HumanReviewCase = z.infer<typeof humanReviewCaseSchema>;
export type HumanReviewDisposition = z.infer<
  typeof humanReviewDispositionSchema
>;
export type HumanVerificationEnvironmentBinding = z.infer<
  typeof humanVerificationEnvironmentBindingSchema
>;
export type HumanVerificationRecord = z.infer<
  typeof humanVerificationRecordSchema
>;
export type HumanVerificationRecordRef = z.infer<
  typeof humanVerificationRecordRefSchema
>;
export type Finding = z.infer<typeof findingSchema>;
export type EvidenceRequest = z.infer<typeof evidenceRequestSchema>;
export type HumanVerificationResult = z.infer<
  typeof humanVerificationResultSchema
>;
export type HumanVerificationRecordIdentity = z.input<
  typeof humanVerificationRecordIdentitySchema
>;

export function defineHumanReviewCase(input: {
  readonly request: HumanReviewPacketDeliveryRequest;
  readonly queueStatus: "active" | "human-deferred";
  readonly admittedAt: string;
}): HumanReviewCase {
  const request = humanReviewPacketDeliveryRequestSchema.parse(input.request);
  return humanReviewCaseSchema.parse({
    kind: "human-review-case",
    schemaVersion: 1,
    id: humanReviewCaseId(request.packet),
    campaignId: request.campaignId,
    packet: referenceHumanReviewPacket(request.packet),
    mechanismDigest: humanReviewMechanismDigest(request.packet),
    queueStatus: input.queueStatus,
    admittedAt: input.admittedAt,
    firstDeliveryRequestDigest: request.digest,
  });
}

export function defineHumanReviewAdmissionReceipt(input: {
  readonly request: HumanReviewPacketDeliveryRequest;
  readonly reviewCase: HumanReviewCase;
}): HumanReviewPacketDeliveryReceipt {
  const identity = {
    kind: "human-review-packet-delivery-receipt" as const,
    schemaVersion: 1 as const,
    deliveryRequestDigest: input.request.digest,
    packetDigest: humanOsDigest(input.request.packet),
    caseId: input.reviewCase.id,
    admission: input.reviewCase.queueStatus,
  };
  return humanReviewPacketDeliveryReceiptSchema.parse({
    ...identity,
    receiptDigest: humanOsDigest(identity),
  });
}

export function defineHumanVerificationRecord(
  identityValue: HumanVerificationRecordIdentity,
): HumanVerificationRecord {
  const identity = humanVerificationRecordIdentitySchema.parse(identityValue);
  return humanVerificationRecordSchema.parse({
    ...identity,
    id: humanOsDigest(identity),
  });
}

export function referenceHumanVerificationRecord(
  recordValue: HumanVerificationRecord,
): HumanVerificationRecordRef {
  const record = humanVerificationRecordSchema.parse(recordValue);
  return humanVerificationRecordRefSchema.parse({
    kind: record.kind,
    schemaVersion: record.schemaVersion,
    id: record.id,
    digest: humanOsDigest(record),
    caseId: record.caseId,
    disposition: record.disposition.status,
  });
}

export function createFinding(input: {
  readonly packet: HumanReviewPacket;
  readonly verification: HumanVerificationRecord;
}): Finding {
  const verification = humanVerificationRecordSchema.parse(input.verification);
  if (
    verification.disposition.status !== "verified-finding" ||
    verification.environment.kind !== "human-verification-environment" ||
    verification.attackerRole === "unresolved"
  ) {
    throw new Error("Only verified Human Verification can create a Finding");
  }
  const identity = findingIdentitySchema.parse({
    kind: "finding",
    schemaVersion: 1,
    caseId: verification.caseId,
    packet: referenceHumanReviewPacket(input.packet),
    verification: referenceHumanVerificationRecord(verification),
    target: input.packet.target,
    environment: verification.environment,
    causalIdentity: input.packet.causalIdentity,
    attackerRole: verification.attackerRole,
    securityEffect: verification.securityEffect.description,
    reviewer: verification.reviewer,
    verifiedAt: verification.performedAt,
    externalAction: { status: "not-authorized" },
  });
  return findingSchema.parse({ ...identity, id: humanOsDigest(identity) });
}

export function createEvidenceRequest(input: {
  readonly verification: HumanVerificationRecord;
}): EvidenceRequest {
  const verification = humanVerificationRecordSchema.parse(input.verification);
  if (verification.disposition.status !== "more-evidence-required") {
    throw new Error(
      "Only more-evidence-required can create an Evidence Request",
    );
  }
  const identity = evidenceRequestIdentitySchema.parse({
    kind: "evidence-request",
    schemaVersion: 1,
    caseId: verification.caseId,
    packetDigest: verification.packetDigest,
    verification: referenceHumanVerificationRecord(verification),
    requestedBy: verification.reviewer,
    requestedAt: verification.performedAt,
    reason: verification.disposition.reason,
    requestedEvidence: verification.disposition.requestedEvidence,
  });
  return evidenceRequestSchema.parse({
    ...identity,
    id: humanOsDigest(identity),
  });
}

export type {
  HumanReviewPacketDeliveryReceipt,
  HumanReviewPacketDeliveryRequest,
  HumanVerificationEnvironmentRef,
};
