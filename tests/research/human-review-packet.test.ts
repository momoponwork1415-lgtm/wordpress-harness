import { describe, expect, it } from "vitest";

import {
  prepareHumanReviewPacket,
  referenceHumanReviewPacket,
  referenceRiskAssessment,
} from "../../src/research/validation/human-review-packet.js";
import {
  validationCandidateId,
  validationCandidateSchema,
  validationCriteria,
  validationRecordSchema,
} from "../../src/research/validation/index.js";
import { sha256Digest } from "../../src/research/research-record/canonical-json.js";

const digest = (character: string): string => `sha256:${character.repeat(64)}`;
const target = {
  id: "review-plugin-1.2.3",
  pluginSlug: "review-plugin",
  version: "1.2.3",
  digest: digest("1"),
};
const manifest = {
  kind: "target-file-manifest" as const,
  schemaVersion: 1 as const,
  targetSnapshotId: target.id,
  targetSnapshotDigest: target.digest,
  digest: digest("2"),
};
const wave = {
  kind: "work-wave" as const,
  schemaVersion: 2 as const,
  id: digest("3"),
  digest: digest("4"),
  targetSnapshotDigest: target.digest,
  manifestDigest: manifest.digest,
};
const anchor = {
  path: "plugin.php",
  fileDigest: digest("5"),
  startLine: 10,
  endLine: 20,
};

function fixture(
  disposition: "ready-for-human" | "rejected" = "ready-for-human",
  routeClaim = "Public state reaches a privileged consumer.",
) {
  const hypothesisIdentity = {
    kind: "source-bound-hypothesis" as const,
    targetSnapshotDigest: target.digest,
    manifestDigest: manifest.digest,
    value: {
      kind: "source-bound-hypothesis" as const,
      schemaVersion: 1 as const,
      causalIdentity: {
        rootCause: "cross-actor-state",
        attackerControlledPrimitive: "public-state-write",
        brokenSecurityProperty: "state-ownership",
      },
      attackerPremise: "unauthenticated" as const,
      impact: "account-takeover" as const,
      route: { anchors: [anchor] },
      unknowns: [
        {
          claim: "Runtime state identity remains unobserved.",
          requiredEvidence: "Observe the state identity in a disposable lab.",
        },
      ],
      falsifier: "The consumer uses independently owned state.",
      nextExperiment: "Inspect the real Target interface.",
    },
  };
  const hypothesis = {
    kind: "source-bound-hypothesis" as const,
    schemaVersion: 2 as const,
    id: sha256Digest(hypothesisIdentity),
    target,
    manifest,
    workWave: wave,
    attemptId: "finder-review-packet",
    leaseId: digest("6"),
    value: hypothesisIdentity.value,
  };
  const candidateIdentity = {
    target,
    manifest,
    attackerPremise: "unauthenticated" as const,
    brokenSecurityProperty: "state-ownership",
    causalRoute: [{ ordinal: 1, claim: routeClaim, evidence: [anchor] }],
  };
  const candidate = validationCandidateSchema.parse({
    kind: "validation-candidate",
    schemaVersion: 1,
    id: validationCandidateId(candidateIdentity),
    ...candidateIdentity,
    origins: [
      {
        subjectDigest: sha256Digest(hypothesis),
        rootEvaluationDigest: digest("7"),
        approachFamilyId: digest("8"),
      },
    ],
  });
  const criterionStatus = (criterion: (typeof validationCriteria)[number]) =>
    disposition === "rejected" && criterion === "broken-control"
      ? ("fail" as const)
      : ("pass" as const);
  const validatorOutput = {
    kind: "validation-attempt-output" as const,
    schemaVersion: 1 as const,
    candidateId: candidate.id,
    criteria: validationCriteria.map((criterion) => ({
      criterion,
      status: criterionStatus(criterion),
      reason: `Independent source review resolved ${criterion}.`,
      evidence: [anchor],
    })),
    proposedDisposition: disposition,
  };
  const validatorExecution = (ordinal: 1 | 2) => ({
    kind: "attempt-execution-result" as const,
    schemaVersion: 2 as const,
    attemptId: `validator-review-${ordinal}`,
    owner: "validation" as const,
    role: "validator" as const,
    planDigest: digest(ordinal === 1 ? "9" : "a"),
    digest: digest(ordinal === 1 ? "b" : "c"),
  });
  const validatorAttempts = ([1, 2] as const).map((ordinal) => ({
    status: "completed" as const,
    ordinal,
    execution: validatorExecution(ordinal),
    output: validatorOutput,
  }));
  const synthesisExecution = {
    kind: "attempt-execution-result" as const,
    schemaVersion: 2 as const,
    attemptId: "validation-synthesis-review",
    owner: "validation" as const,
    role: "validation-synthesizer" as const,
    planDigest: digest("d"),
    digest: digest("e"),
  };
  const validation = validationRecordSchema.parse({
    kind: "validation-record",
    schemaVersion: 1,
    validationId: candidate.id,
    candidateId: candidate.id,
    planDigest: digest("f"),
    materialConflictAfterTwo: false,
    validatorAttempts,
    status: disposition,
    synthesisAttempt: {
      status: "completed",
      execution: synthesisExecution,
      output: {
        kind: "validation-synthesis-output",
        schemaVersion: 1,
        candidateId: candidate.id,
        criteria: validationCriteria.map((criterion) => ({
          criterion,
          status: criterionStatus(criterion),
          reason: `Both reviews resolve ${criterion}.`,
          evidence: [
            {
              attemptId: validatorExecution(1).attemptId,
              criterion,
              evidenceIndexes: [0],
            },
          ],
        })),
        disposition,
        reason: "The source-only evidence determines this disposition.",
      },
    },
  });
  return { candidate, hypothesis, validation };
}

describe("prepareHumanReviewPacket", () => {
  it("deterministically projects a source-only Risk Assessment and safe handoff", () => {
    const input = fixture();
    const first = prepareHumanReviewPacket(input);
    const replay = prepareHumanReviewPacket(input);

    expect(replay).toEqual(first);
    expect(first).toMatchObject({
      kind: "prepared",
      riskAssessment: {
        validityDisposition: "ready-for-human",
        impact: "account-takeover",
      },
      packet: {
        target,
        manifest,
        causalIdentity: { brokenSecurityProperty: "state-ownership" },
        attackerPremise: "unauthenticated",
        orderedRoute: [{ ordinal: 1, evidence: [anchor] }],
        sourceEvidence: [anchor],
        reviewBoundary: {
          validity: "source-validated-not-human-verified",
          findingEligible: false,
        },
      },
    });
    if (first.kind !== "prepared") throw new Error("Expected Packet");
    expect(referenceRiskAssessment(first.riskAssessment).digest).toBe(
      sha256Digest(first.riskAssessment),
    );
    expect(referenceHumanReviewPacket(first.packet).digest).toBe(
      sha256Digest(first.packet),
    );
    expect(JSON.stringify(first.packet)).not.toContain("finder transcript");
  });

  it("does not create a Packet from a non-ready Validation", () => {
    expect(prepareHumanReviewPacket(fixture("rejected"))).toEqual({
      kind: "incomplete",
      reason: "invalid-binding",
    });
  });

  it("rejects executable payload-shaped review text", () => {
    expect(
      prepareHumanReviewPacket(
        fixture(
          "ready-for-human",
          "curl an attacker endpoint to prove impact.",
        ),
      ),
    ).toEqual({ kind: "incomplete", reason: "unsafe-review-content" });
  });
});
