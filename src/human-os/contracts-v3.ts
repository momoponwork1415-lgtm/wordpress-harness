import { z } from "zod";

import { canonicalDigest } from "../infrastructure/canonical-json.js";
import { sourceValidatedFindingSchema } from "../research/index.js";

const digestSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const idSchema = z.string().min(1).max(512);
const timestampSchema = z.iso.datetime();
const boundedTextSchema = z.string().min(1).max(4_000);

export const isolatedEnvironmentSchema = z.strictObject({
  environmentId: idSchema,
  targetSnapshotDigest: digestSchema,
  runtimeProfileDigest: digestSchema,
  backend: z.literal("gvisor"),
  runtime: z.literal("runsc"),
  fallbackUsed: z.literal(false),
  fresh: z.literal(true),
  disposable: z.literal(true),
  hostTargetExecution: z.literal(false),
  ambientCredentials: z.literal(false),
  arbitraryNetwork: z.literal(false),
});

const privateEvidenceRefSchema = z.strictObject({
  id: idSchema,
  digest: digestSchema,
});

export const externalDependencyEvidenceRequestSchema = z.strictObject({
  kind: z.literal("external-dependency-evidence-request"),
  schemaVersion: z.literal(1),
  reason: z.literal("external-dependency-required"),
  service: z.string().min(1).max(256),
  humanAction: boundedTextSchema,
  minimumAccess: boundedTextSchema,
  verificationGoal: boundedTextSchema,
});

const aiReproductionIdentitySchema = z.strictObject({
  kind: z.literal("ai-reproduction-record"),
  schemaVersion: z.literal(3),
  findingId: idSchema,
  environment: isolatedEnvironmentSchema.nullable(),
  status: z.enum(["runtime-confirmed", "disproved", "incomplete"]),
  summary: boundedTextSchema,
  evidenceRequest: externalDependencyEvidenceRequestSchema
    .nullable()
    .optional(),
  privateEvidence: z.array(privateEvidenceRefSchema).max(32),
  recordedAt: timestampSchema,
});

export const aiReproductionRecordSchema = aiReproductionIdentitySchema
  .extend({ id: digestSchema })
  .superRefine((record, context) => {
    const { id: _id, ...identity } = record;
    if (
      record.id !== canonicalDigest(identity) ||
      (record.status !== "incomplete" &&
        (record.environment === null ||
          record.privateEvidence.length === 0 ||
          (record.evidenceRequest !== undefined &&
            record.evidenceRequest !== null)))
    ) {
      context.addIssue({
        code: "custom",
        message: "AI Reproduction Record lacks its bound runtime evidence",
      });
    }
  });

const humanVerificationIdentitySchema = z.strictObject({
  kind: z.literal("human-verification-record"),
  schemaVersion: z.literal(3),
  findingId: idSchema,
  aiReproductionId: digestSchema,
  environment: isolatedEnvironmentSchema,
  reviewer: z.strictObject({
    kind: z.literal("human-reviewer"),
    id: idSchema,
  }),
  status: z.enum(["human-confirmed", "disproved", "incomplete"]),
  summary: boundedTextSchema,
  privateEvidence: z.array(privateEvidenceRefSchema).max(32),
  recordedAt: timestampSchema,
});

export const humanVerificationRecordSchema = humanVerificationIdentitySchema
  .extend({ id: digestSchema })
  .superRefine((record, context) => {
    const { id: _id, ...identity } = record;
    if (
      record.id !== canonicalDigest(identity) ||
      (record.status !== "incomplete" && record.privateEvidence.length === 0)
    ) {
      context.addIssue({
        code: "custom",
        message: "Human Verification Record lacks its bound runtime evidence",
      });
    }
  });

const submissionDraftIdentitySchema = z.strictObject({
  kind: z.literal("submission-draft"),
  schemaVersion: z.literal(1),
  findingId: idSchema,
  revision: z.number().int().positive(),
  destination: boundedTextSchema,
  contentDigest: digestSchema,
  preparedBy: z.enum(["ai", "human"]),
  createdAt: timestampSchema,
});

export const submissionDraftSchema = submissionDraftIdentitySchema
  .extend({ id: digestSchema })
  .superRefine((draft, context) => {
    const { id: _id, ...identity } = draft;
    if (draft.id !== canonicalDigest(identity)) {
      context.addIssue({ code: "custom", message: "Draft digest mismatch" });
    }
  });

const externalActionAuthorizationIdentitySchema = z.strictObject({
  kind: z.literal("external-action-authorization"),
  schemaVersion: z.literal(1),
  findingId: idSchema,
  draftId: digestSchema,
  draftDigest: digestSchema,
  destination: boundedTextSchema,
  authorizedBy: z.strictObject({
    kind: z.literal("human-reviewer"),
    id: idSchema,
  }),
  authorizedAt: timestampSchema,
});

export const externalActionAuthorizationSchema =
  externalActionAuthorizationIdentitySchema
    .extend({ id: digestSchema })
    .superRefine((authorization, context) => {
      const { id: _id, ...identity } = authorization;
      if (authorization.id !== canonicalDigest(identity)) {
        context.addIssue({
          code: "custom",
          message: "External Action Authorization digest mismatch",
        });
      }
    });

export const externalActionRequestSchema = z.strictObject({
  findingId: idSchema,
  draftId: digestSchema,
  draftDigest: digestSchema,
  destination: boundedTextSchema,
});

export const humanOsFindingViewSchema = z.strictObject({
  finding: sourceValidatedFindingSchema,
  receivedAt: timestampSchema,
  aiReproductions: z.array(aiReproductionRecordSchema),
  humanVerifications: z.array(humanVerificationRecordSchema),
  drafts: z.array(submissionDraftSchema),
  authorizations: z.array(externalActionAuthorizationSchema),
});

export type IsolatedEnvironment = z.infer<typeof isolatedEnvironmentSchema>;
export type ExternalDependencyEvidenceRequest = z.infer<
  typeof externalDependencyEvidenceRequestSchema
>;
export type AIReproductionRecord = z.infer<typeof aiReproductionRecordSchema>;
export type HumanVerificationRecord = z.infer<
  typeof humanVerificationRecordSchema
>;
export type SubmissionDraft = z.infer<typeof submissionDraftSchema>;
export type ExternalActionAuthorization = z.infer<
  typeof externalActionAuthorizationSchema
>;
export type ExternalActionRequest = z.infer<typeof externalActionRequestSchema>;
export type HumanOsFindingView = z.infer<typeof humanOsFindingViewSchema>;

export function defineAIReproductionRecord(
  identity: z.input<typeof aiReproductionIdentitySchema>,
): AIReproductionRecord {
  const value = aiReproductionIdentitySchema.parse(identity);
  return aiReproductionRecordSchema.parse({
    ...value,
    id: canonicalDigest(value),
  });
}

export function defineHumanVerificationRecord(
  identity: z.input<typeof humanVerificationIdentitySchema>,
): HumanVerificationRecord {
  const value = humanVerificationIdentitySchema.parse(identity);
  return humanVerificationRecordSchema.parse({
    ...value,
    id: canonicalDigest(value),
  });
}

export function defineSubmissionDraft(
  identity: z.input<typeof submissionDraftIdentitySchema>,
): SubmissionDraft {
  const value = submissionDraftIdentitySchema.parse(identity);
  return submissionDraftSchema.parse({
    ...value,
    id: canonicalDigest(value),
  });
}

export function defineExternalActionAuthorization(
  identity: z.input<typeof externalActionAuthorizationIdentitySchema>,
): ExternalActionAuthorization {
  const value = externalActionAuthorizationIdentitySchema.parse(identity);
  return externalActionAuthorizationSchema.parse({
    ...value,
    id: canonicalDigest(value),
  });
}
