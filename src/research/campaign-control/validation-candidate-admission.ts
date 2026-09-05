import { z } from "zod";

import {
  admittedApproachFamilyId,
  approachFamilyAdmissionRefSchema,
  iterationDecisionV3Schema,
  sourceBoundHypothesisArtifactSchema,
} from "../exploration/index.js";
import {
  canonicalJson,
  sha256Digest,
} from "../research-record/canonical-json.js";
import { isWithinCurrentResearchAttackerScope } from "../current-research-attacker-scope.js";
import type { JsonArtifactStore } from "../research-record/contracts.js";
import {
  validationCandidateId,
  validationCandidateSchema,
  type ValidationCandidate,
  type ValidationCandidateIdentityInput,
} from "../validation/index.js";

const identifierSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);

const validationCandidateAdmissionInputSchema = z.strictObject({
  campaignId: identifierSchema,
  runId: identifierSchema,
  decision: iterationDecisionV3Schema,
});

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function referenceFamily(
  value: z.infer<typeof iterationDecisionV3Schema>["approachFamilies"][number],
) {
  return approachFamilyAdmissionRefSchema.parse({
    kind: value.kind,
    schemaVersion: value.schemaVersion,
    id: value.id,
    digest: sha256Digest(value),
    key: value.key,
    targetSnapshotDigest: value.target.digest,
    manifestDigest: value.manifest.digest,
    workWaveDigest: value.wave.digest,
  });
}

export async function materializeValidationCandidates(
  artifactStore: JsonArtifactStore,
  inputValue: {
    readonly campaignId: string;
    readonly runId: string;
    readonly decision: unknown;
  },
): Promise<readonly ValidationCandidate[]> {
  const input = validationCandidateAdmissionInputSchema.parse(inputValue);
  const decisionDigest = sha256Digest(input.decision);
  const families = new Map(
    input.decision.approachFamilies.map((family) => [family.id, family]),
  );
  const candidates = new Map<string, ValidationCandidate>();

  const actions = input.decision.actions
    .filter((action) => action.kind === "admit-validation")
    .sort(
      (left, right) =>
        compareText(left.admission.id, right.admission.id) ||
        compareText(
          left.admission.hypothesis.digest,
          right.admission.hypothesis.digest,
        ),
    );
  for (const action of actions) {
    if (action.kind !== "admit-validation") {
      throw new Error("Validation admission action narrowing failed");
    }
    const family = families.get(action.approachFamily.id);
    if (
      family === undefined ||
      canonicalJson(referenceFamily(family)) !==
        canonicalJson(action.approachFamily) ||
      !action.subjects.some(
        (subject) => subject.digest === action.admission.hypothesis.digest,
      ) ||
      action.subjects.some(
        (subject) =>
          !family.subjects.some(
            (familySubject) => familySubject.digest === subject.digest,
          ),
      )
    ) {
      throw new Error("Validation admission lost its Approach Family");
    }

    const hypothesisInput = await artifactStore.readJson(
      action.admission.hypothesis.digest,
    );
    if (sha256Digest(hypothesisInput) !== action.admission.hypothesis.digest) {
      throw new Error("Validation admission Hypothesis CAS mismatch");
    }
    const hypothesis =
      sourceBoundHypothesisArtifactSchema.parse(hypothesisInput);
    if (
      !isWithinCurrentResearchAttackerScope(hypothesis.value.attackerPremise)
    ) {
      throw new Error(
        "Validation admission exceeds the current research attacker scope",
      );
    }
    const hypothesisRef = action.admission.hypothesis;
    if (
      hypothesis.id !== hypothesisRef.id ||
      hypothesis.attemptId !== hypothesisRef.attemptId ||
      hypothesis.leaseId !== hypothesisRef.leaseId ||
      hypothesis.workWave.digest !== hypothesisRef.workWaveDigest ||
      hypothesis.target.digest !== hypothesisRef.targetSnapshotDigest ||
      hypothesis.manifest.digest !== hypothesisRef.manifestDigest ||
      canonicalJson(hypothesis.target) !==
        canonicalJson(input.decision.target) ||
      canonicalJson(hypothesis.manifest) !==
        canonicalJson(input.decision.manifest)
    ) {
      throw new Error("Validation admission Hypothesis ref mismatch");
    }

    const availableAnchors = new Set(
      hypothesis.value.route.anchors.map((anchor) => canonicalJson(anchor)),
    );
    const usedAnchors = action.admission.causalRoute.flatMap((step) =>
      step.evidence.map((anchor) => canonicalJson(anchor)),
    );
    if (
      action.admission.brokenSecurityProperty !==
        hypothesis.value.causalIdentity.brokenSecurityProperty ||
      usedAnchors.some((anchor) => !availableAnchors.has(anchor)) ||
      [...availableAnchors].some((anchor) => !usedAnchors.includes(anchor))
    ) {
      throw new Error("Validation admission route binding mismatch");
    }
    const candidateInput: ValidationCandidateIdentityInput = {
      target: input.decision.target,
      manifest: input.decision.manifest,
      attackerPremise: hypothesis.value.attackerPremise,
      brokenSecurityProperty: action.admission.brokenSecurityProperty,
      causalRoute: action.admission.causalRoute.map((step) => ({
        ...step,
        evidence: [...step.evidence].sort(
          (left, right) =>
            compareText(left.path, right.path) ||
            left.startLine - right.startLine ||
            left.endLine - right.endLine ||
            compareText(left.fileDigest, right.fileDigest),
        ),
      })),
    };
    const candidateId = validationCandidateId(candidateInput);
    const origin = {
      subjectDigest: hypothesisRef.digest,
      rootEvaluationDigest: decisionDigest,
      approachFamilyId: admittedApproachFamilyId({
        campaignId: input.campaignId,
        runId: input.runId,
        targetSnapshotDigest: input.decision.target.digest,
        manifestDigest: input.decision.manifest.digest,
        openingDecisionDigest: decisionDigest,
        admissionId: family.id,
      }),
    };
    const existing = candidates.get(candidateId);
    const origins = [...(existing?.origins ?? []), origin]
      .filter(
        (value, index, values) =>
          values.findIndex(
            (candidate) => canonicalJson(candidate) === canonicalJson(value),
          ) === index,
      )
      .sort(
        (left, right) =>
          compareText(left.subjectDigest, right.subjectDigest) ||
          compareText(left.approachFamilyId, right.approachFamilyId),
      );
    candidates.set(
      candidateId,
      validationCandidateSchema.parse({
        kind: "validation-candidate",
        schemaVersion: 1,
        id: candidateId,
        ...candidateInput,
        origins,
      }),
    );
  }

  return [...candidates.values()].sort((left, right) =>
    compareText(left.id, right.id),
  );
}
