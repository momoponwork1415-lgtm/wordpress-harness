import { z } from "zod";

import { canonicalDigest } from "../infrastructure/canonical-json.js";
import {
  candidateVerificationRequestSchema,
  dependencySnapshotsSchema,
  sourceEvidenceSchema,
  targetSnapshotRefSchema,
} from "../research/index.js";

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

const immutableRefSchema = z.strictObject({
  id: idSchema,
  digest: digestSchema,
});

export const verifiedVulnerabilitySchema = z.strictObject({
  kind: z.literal("verified-vulnerability"),
  schemaVersion: z.literal(1),
  vulnerabilityId: idSchema,
  candidateId: idSchema,
  targetSnapshot: targetSnapshotRefSchema,
  dependencySnapshots: dependencySnapshotsSchema.optional(),
  attackerPremise: boundedTextSchema,
  brokenSecurityProperty: boundedTextSchema,
  claim: boundedTextSchema,
  assurance: z.literal("runtime-confirmed"),
  candidateVerificationRef: immutableRefSchema,
  evidence: z.array(sourceEvidenceSchema).min(1),
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

const candidateVerificationRecordIdentitySchema = z.strictObject({
  kind: z.literal("candidate-verification-record"),
  schemaVersion: z.literal(1),
  requestId: idSchema,
  candidateId: idSchema,
  environment: isolatedEnvironmentSchema.nullable(),
  status: z.enum(["runtime-confirmed", "contradicted", "incomplete"]),
  summary: boundedTextSchema,
  evidenceRequest: externalDependencyEvidenceRequestSchema
    .nullable()
    .optional(),
  privateEvidence: z.array(privateEvidenceRefSchema).max(32),
  recordedAt: timestampSchema,
});

export const candidateVerificationRecordSchema =
  candidateVerificationRecordIdentitySchema
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
          message: "Candidate Verification Record lacks bound runtime evidence",
        });
      }
    });

const programmeScopeAssessmentIdentitySchema = z.strictObject({
  kind: z.literal("programme-scope-assessment"),
  schemaVersion: z.literal(1),
  vulnerabilityId: idSchema,
  programmeIdentity: idSchema,
  programmeSnapshot: immutableRefSchema,
  status: z.enum(["in-scope", "out-of-scope", "ambiguous", "stale"]),
  destination: boundedTextSchema,
  reason: boundedTextSchema,
  assessedAt: timestampSchema,
});

export const programmeScopeAssessmentSchema =
  programmeScopeAssessmentIdentitySchema
    .extend({ id: digestSchema })
    .superRefine((assessment, context) => {
      const { id: _id, ...identity } = assessment;
      if (assessment.id !== canonicalDigest(identity)) {
        context.addIssue({ code: "custom", message: "Scope digest mismatch" });
      }
    });

const submissionCandidateIdentitySchema = z.strictObject({
  kind: z.literal("submission-candidate"),
  schemaVersion: z.literal(1),
  vulnerabilityId: idSchema,
  programmeIdentity: idSchema,
  scopeAssessmentId: digestSchema,
  destination: boundedTextSchema,
});

export const submissionCandidateSchema = submissionCandidateIdentitySchema
  .extend({ id: digestSchema })
  .superRefine((candidate, context) => {
    const { id: _id, ...identity } = candidate;
    if (candidate.id !== canonicalDigest(identity)) {
      context.addIssue({
        code: "custom",
        message: "Submission Candidate digest mismatch",
      });
    }
  });

const submissionDraftIdentitySchema = z.strictObject({
  kind: z.literal("submission-draft"),
  schemaVersion: z.literal(1),
  vulnerabilityId: idSchema,
  submissionCandidateId: digestSchema,
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
  vulnerabilityId: idSchema,
  submissionCandidateId: digestSchema,
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
  vulnerabilityId: idSchema,
  submissionCandidateId: digestSchema,
  draftId: digestSchema,
  draftDigest: digestSchema,
  destination: boundedTextSchema,
});

export const candidateVerificationViewSchema = z.strictObject({
  request: candidateVerificationRequestSchema,
  receivedAt: timestampSchema,
  verificationRecords: z.array(candidateVerificationRecordSchema),
  verifiedVulnerability: verifiedVulnerabilitySchema.nullable(),
  programmeScopeStatus: z.enum([
    "not-configured",
    "pending",
    "completed",
    "incomplete",
  ]),
  scopeAssessments: z.array(programmeScopeAssessmentSchema),
  submissionCandidates: z.array(submissionCandidateSchema),
  drafts: z.array(submissionDraftSchema),
  authorizations: z.array(externalActionAuthorizationSchema),
});

export type IsolatedEnvironment = z.infer<typeof isolatedEnvironmentSchema>;
export type VerifiedVulnerability = z.infer<typeof verifiedVulnerabilitySchema>;
export type ExternalDependencyEvidenceRequest = z.infer<
  typeof externalDependencyEvidenceRequestSchema
>;
export type CandidateVerificationRecord = z.infer<
  typeof candidateVerificationRecordSchema
>;
export type ProgrammeScopeAssessment = z.infer<
  typeof programmeScopeAssessmentSchema
>;
export type SubmissionCandidate = z.infer<typeof submissionCandidateSchema>;
export type SubmissionDraft = z.infer<typeof submissionDraftSchema>;
export type ExternalActionAuthorization = z.infer<
  typeof externalActionAuthorizationSchema
>;
export type ExternalActionRequest = z.infer<typeof externalActionRequestSchema>;
export type CandidateVerificationView = z.infer<
  typeof candidateVerificationViewSchema
>;

function withDigest<T extends object>(
  identity: T,
): T & { readonly id: string } {
  return { ...identity, id: canonicalDigest(identity) };
}

export function defineCandidateVerificationRecord(
  identity: z.input<typeof candidateVerificationRecordIdentitySchema>,
): CandidateVerificationRecord {
  const value = candidateVerificationRecordIdentitySchema.parse(identity);
  return candidateVerificationRecordSchema.parse(withDigest(value));
}

export function defineProgrammeScopeAssessment(
  identity: z.input<typeof programmeScopeAssessmentIdentitySchema>,
): ProgrammeScopeAssessment {
  const value = programmeScopeAssessmentIdentitySchema.parse(identity);
  return programmeScopeAssessmentSchema.parse(withDigest(value));
}

export function defineSubmissionCandidate(
  identity: z.input<typeof submissionCandidateIdentitySchema>,
): SubmissionCandidate {
  const value = submissionCandidateIdentitySchema.parse(identity);
  return submissionCandidateSchema.parse(withDigest(value));
}

export function defineSubmissionDraft(
  identity: z.input<typeof submissionDraftIdentitySchema>,
): SubmissionDraft {
  const value = submissionDraftIdentitySchema.parse(identity);
  return submissionDraftSchema.parse(withDigest(value));
}

export function defineExternalActionAuthorization(
  identity: z.input<typeof externalActionAuthorizationIdentitySchema>,
): ExternalActionAuthorization {
  const value = externalActionAuthorizationIdentitySchema.parse(identity);
  return externalActionAuthorizationSchema.parse(withDigest(value));
}
