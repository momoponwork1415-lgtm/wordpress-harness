import { z } from "zod";

import { targetSnapshotRefSchema } from "../contracts.js";
import { sourceBoundHypothesisArtifactSchema } from "../exploration/semantic-contracts.js";
import {
  canonicalJson,
  sha256Digest,
} from "../research-record/canonical-json.js";
import { targetFileManifestRefSchema } from "../source-mapping/contracts.js";
import {
  referenceValidationCandidate,
  sourceValidationRecordRefSchema,
  sourceValidationRecordSchema,
  validationCandidateRefSchema,
  validationCandidateSchema,
  validationSourceAnchorSchema,
  type ValidationCandidate,
} from "./contracts.js";

const digestSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const boundedTextSchema = z.string().min(1).max(2_000);

const findingIdentityInputSchema = z.strictObject({
  kind: z.literal("finding-identity"),
  schemaVersion: z.literal(1),
  candidateId: digestSchema,
});

export function findingId(candidateId: string): string {
  return sha256Digest(
    findingIdentityInputSchema.parse({
      kind: "finding-identity",
      schemaVersion: 1,
      candidateId,
    }),
  );
}

const findingCounterevidenceSchema = z.strictObject({
  status: z.enum(["pass", "unknown"]),
  reason: boundedTextSchema,
  evidence: z.array(validationSourceAnchorSchema).min(1).max(32),
});

export const findingSchema = z
  .strictObject({
    kind: z.literal("finding"),
    schemaVersion: z.literal(1),
    id: digestSchema,
    target: targetSnapshotRefSchema,
    manifest: targetFileManifestRefSchema,
    candidate: validationCandidateRefSchema,
    validation: sourceValidationRecordRefSchema,
    causalIdentity:
      sourceBoundHypothesisArtifactSchema.shape.value.shape.causalIdentity,
    attackerPremise: validationCandidateSchema.shape.attackerPremise,
    brokenSecurityProperty:
      validationCandidateSchema.shape.brokenSecurityProperty,
    sourceRoute: validationCandidateSchema.shape.causalRoute,
    sourceEvidence: z.array(validationSourceAnchorSchema).min(1).max(2_048),
    counterevidence: findingCounterevidenceSchema,
  })
  .superRefine((finding, context) => {
    const routeEvidence = new Set(
      finding.sourceRoute
        .flatMap((step) => step.evidence)
        .map((anchor) => canonicalJson(anchor)),
    );
    const sourceEvidence = new Set(
      finding.sourceEvidence.map((anchor) => canonicalJson(anchor)),
    );
    if (
      finding.id !== findingId(finding.candidate.id) ||
      finding.target.digest !== finding.candidate.targetSnapshotDigest ||
      finding.manifest.digest !== finding.candidate.manifestDigest ||
      finding.validation.validationId !== finding.candidate.id ||
      finding.validation.candidateId !== finding.candidate.id ||
      finding.brokenSecurityProperty !==
        finding.causalIdentity.brokenSecurityProperty ||
      [...routeEvidence].some((anchor) => !sourceEvidence.has(anchor))
    ) {
      context.addIssue({
        code: "custom",
        message: "Finding contains a foreign identity or evidence binding",
      });
    }
  });

export const findingRefSchema = z.strictObject({
  kind: z.literal("finding"),
  schemaVersion: z.literal(1),
  id: digestSchema,
  digest: digestSchema,
  targetSnapshotDigest: digestSchema,
  manifestDigest: digestSchema,
  candidateId: digestSchema,
  validation: sourceValidationRecordRefSchema,
});

export type Finding = z.infer<typeof findingSchema>;
export type FindingRef = z.infer<typeof findingRefSchema>;

export function referenceFinding(input: Finding): FindingRef {
  const finding = findingSchema.parse(input);
  return findingRefSchema.parse({
    kind: finding.kind,
    schemaVersion: finding.schemaVersion,
    id: finding.id,
    digest: sha256Digest(finding),
    targetSnapshotDigest: finding.target.digest,
    manifestDigest: finding.manifest.digest,
    candidateId: finding.candidate.id,
    validation: finding.validation,
  });
}

export function projectFinding(input: {
  readonly candidate: ValidationCandidate;
  readonly validation: z.infer<typeof sourceValidationRecordSchema>;
  readonly hypothesis: z.infer<typeof sourceBoundHypothesisArtifactSchema>;
}): Finding {
  const candidate = validationCandidateSchema.parse(input.candidate);
  const validation = sourceValidationRecordSchema.parse(input.validation);
  const hypothesis = sourceBoundHypothesisArtifactSchema.parse(
    input.hypothesis,
  );
  const hypothesisDigest = sha256Digest(hypothesis);
  const hypothesisEvidence = new Set(
    hypothesis.value.route.anchors.map((anchor) => canonicalJson(anchor)),
  );
  const routeEvidence = new Set(
    candidate.causalRoute
      .flatMap((step) => step.evidence)
      .map((anchor) => canonicalJson(anchor)),
  );
  if (
    validation.status !== "source-validated" ||
    validation.validationId !== candidate.id ||
    validation.candidateId !== candidate.id ||
    !candidate.origins.some(
      (origin) => origin.subjectDigest === hypothesisDigest,
    ) ||
    hypothesis.target.digest !== candidate.target.digest ||
    hypothesis.manifest.digest !== candidate.manifest.digest ||
    hypothesis.value.attackerPremise !== candidate.attackerPremise ||
    hypothesis.value.causalIdentity.brokenSecurityProperty !==
      candidate.brokenSecurityProperty ||
    routeEvidence.size !== hypothesisEvidence.size ||
    [...routeEvidence].some((anchor) => !hypothesisEvidence.has(anchor))
  ) {
    throw new Error("Source-validated Finding binding mismatch");
  }
  const counterevidence = validation.validatorAttempt.output.criteria.find(
    (criterion) => criterion.criterion === "counterevidence-and-proof-gap",
  );
  if (counterevidence === undefined || counterevidence.status === "fail") {
    throw new Error("Source-validated Finding lost its counterevidence screen");
  }
  const sourceEvidence = [
    ...new Map(
      [
        ...candidate.causalRoute.flatMap((step) => step.evidence),
        ...validation.validatorAttempt.output.criteria.flatMap(
          (criterion) => criterion.evidence,
        ),
      ].map((anchor) => [canonicalJson(anchor), anchor] as const),
    ).values(),
  ];
  const validationRef = sourceValidationRecordRefSchema.parse({
    kind: validation.kind,
    schemaVersion: validation.schemaVersion,
    validationId: validation.validationId,
    candidateId: validation.candidateId,
    digest: sha256Digest(validation),
  });
  return findingSchema.parse({
    kind: "finding",
    schemaVersion: 1,
    id: findingId(candidate.id),
    target: candidate.target,
    manifest: candidate.manifest,
    candidate: referenceValidationCandidate(candidate),
    validation: validationRef,
    causalIdentity: hypothesis.value.causalIdentity,
    attackerPremise: candidate.attackerPremise,
    brokenSecurityProperty: candidate.brokenSecurityProperty,
    sourceRoute: candidate.causalRoute,
    sourceEvidence,
    counterevidence: {
      status: counterevidence.status,
      reason: counterevidence.reason,
      evidence: counterevidence.evidence,
    },
  });
}
