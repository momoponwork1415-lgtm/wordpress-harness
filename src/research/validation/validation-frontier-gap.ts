import {
  validationCandidateRefSchema,
  validationFrontierGapRefSchema,
  validationFrontierGapSchema,
  validationRecordRefSchema,
  validationRecordSchema,
  type ValidationCandidateRef,
  type ValidationFrontierGap,
  type ValidationFrontierGapRef,
  type ValidationRecord,
  type ValidationRecordRef,
} from "./contracts.js";
import { targetSnapshotRefSchema } from "../contracts.js";
import { sha256Digest } from "../research-record/canonical-json.js";
import { targetFileManifestRefSchema } from "../source-mapping/contracts.js";

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function projectValidationFrontierGap(input: {
  readonly campaignId: string;
  readonly runId: string;
  readonly target: unknown;
  readonly manifest: unknown;
  readonly validation: ValidationRecord;
  readonly validationRef: ValidationRecordRef;
  readonly candidateRef: ValidationCandidateRef;
  readonly approachFamilyIds: readonly string[];
}): {
  readonly value: ValidationFrontierGap;
  readonly ref: ValidationFrontierGapRef;
} {
  const target = targetSnapshotRefSchema.parse(input.target);
  const manifest = targetFileManifestRefSchema.parse(input.manifest);
  const validation = validationRecordSchema.parse(input.validation);
  const validationRef = validationRecordRefSchema.parse(input.validationRef);
  const candidateRef = validationCandidateRefSchema.parse(input.candidateRef);
  if (
    validation.status !== "needs-research" ||
    validation.validationId !== validationRef.validationId ||
    validation.candidateId !== validationRef.candidateId ||
    validationRef.candidateId !== candidateRef.id
  ) {
    throw new Error(
      "Validation Record does not contain Needs-research feedback",
    );
  }
  const proofGapAttemptId =
    validation.synthesisAttempt.output.proofGapAttemptId;
  const proofAttempt = validation.validatorAttempts.find(
    (attempt) =>
      attempt.status === "completed" &&
      attempt.execution.attemptId === proofGapAttemptId,
  );
  if (
    proofAttempt?.status !== "completed" ||
    proofAttempt.output.proposedDisposition !== "needs-research" ||
    proofAttempt.output.proofGap === undefined
  ) {
    throw new Error("Validation Synthesis selected no concrete proof gap");
  }
  const approachFamilyIds = [...input.approachFamilyIds].sort(compareText);
  const identity = {
    kind: "validation-frontier-gap" as const,
    schemaVersion: 1 as const,
    campaignId: input.campaignId,
    runId: input.runId,
    target,
    manifest,
    validation: validationRef,
    candidate: candidateRef,
    approachFamilyIds,
    value: proofAttempt.output.proofGap,
  };
  const value = validationFrontierGapSchema.parse({
    ...identity,
    id: sha256Digest(identity),
  });
  return {
    value,
    ref: validationFrontierGapRefSchema.parse({
      kind: value.kind,
      schemaVersion: value.schemaVersion,
      id: value.id,
      digest: sha256Digest(value),
      validationId: validation.validationId,
      candidateId: validation.candidateId,
      targetSnapshotDigest: target.digest,
      manifestDigest: manifest.digest,
      approachFamilies: approachFamilyIds.length,
    }),
  };
}
