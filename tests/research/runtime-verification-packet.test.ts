import { describe, expect, it } from "vitest";

import { sha256Digest } from "../../src/research/research-record/canonical-json.js";
import {
  prepareRuntimeVerificationPacket,
  referenceRuntimeRiskAssessment,
  referenceRuntimeVerificationPacket,
} from "../../src/research/validation/runtime-verification-packet.js";
import {
  currentValidationRecordSchema,
  legacyValidationCandidateId,
  legacyValidationCandidateSchema,
  validationCriteria,
} from "../../src/research/validation/contracts.js";

const digest = (character: string): string => `sha256:${character.repeat(64)}`;
const target = {
  id: "runtime-plugin-1.2.3",
  pluginSlug: "runtime-plugin",
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
  disposition: "ready-for-runtime" | "needs-research" = "ready-for-runtime",
  routeClaim = "Public state reaches a privileged consumer.",
  attackerPremise:
    | "unauthenticated"
    | "subscriber"
    | "customer"
    | "contributor" = "unauthenticated",
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
      attackerPremise,
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
    attemptId: "finder-runtime-packet",
    leaseId: digest("6"),
    value: hypothesisIdentity.value,
  };
  const candidateIdentity = {
    target,
    manifest,
    attackerPremise,
    brokenSecurityProperty: "state-ownership",
    causalRoute: [{ ordinal: 1, claim: routeClaim, evidence: [anchor] }],
  };
  const candidate = legacyValidationCandidateSchema.parse({
    kind: "validation-candidate",
    schemaVersion: 1,
    id: legacyValidationCandidateId(candidateIdentity),
    ...candidateIdentity,
    origins: [
      {
        subjectDigest: sha256Digest(hypothesis),
        rootEvaluationDigest: digest("7"),
        approachFamilyId: digest("8"),
      },
    ],
  });
  const criteria = validationCriteria.map((criterion) => ({
    criterion,
    status:
      criterion === "counterevidence-and-proof-gap"
        ? ("unknown" as const)
        : ("pass" as const),
    reason: `Independent source review resolved ${criterion}.`,
    evidence: [anchor],
  }));
  const validation = currentValidationRecordSchema.parse({
    kind: "validation-record",
    schemaVersion: 2,
    validationId: candidate.id,
    candidateId: candidate.id,
    planDigest: digest("9"),
    validatorAttempt: {
      status: "completed",
      execution: {
        kind: "attempt-execution-result",
        schemaVersion: 2,
        attemptId: "validator-runtime-1",
        owner: "validation",
        role: "validator",
        planDigest: digest("a"),
        digest: digest("b"),
      },
      output: {
        kind: "validation-attempt-output",
        schemaVersion: 2,
        candidateId: candidate.id,
        criteria,
        proposedDisposition: disposition,
        ...(disposition === "needs-research"
          ? {
              proofGap: {
                requiredFact: "Resolve a source-decidable ownership check.",
                currentEvidence: [anchor],
                falsifier: "The state is independently owned.",
                nextAction: "Inspect the ownership helper.",
              },
            }
          : {}),
      },
    },
    status: disposition,
  });
  const threatContextIdentity = {
    kind: "validation-threat-context" as const,
    schemaVersion: 1 as const,
    targetSnapshotDigest: target.digest,
    candidateId: candidate.id,
    wordpressBaseline: {
      id: "wordpress-threat-baseline-v1",
      digest: digest("c"),
    },
    permittedAttacker: attackerPremise,
    publicSurface: ["Public WordPress request handler"],
    technicalExclusions: [],
  };
  const threatContext = {
    ...threatContextIdentity,
    id: sha256Digest(threatContextIdentity),
  };
  return { candidate, hypothesis, validation, threatContext };
}

describe("prepareRuntimeVerificationPacket", () => {
  it("projects a self-contained source-only handoff deterministically", () => {
    const input = fixture();
    const first = prepareRuntimeVerificationPacket(input);
    expect(prepareRuntimeVerificationPacket(input)).toEqual(first);
    expect(first).toMatchObject({
      kind: "prepared",
      riskAssessment: {
        schemaVersion: 2,
        validationDisposition: "ready-for-runtime",
        attackerRole: "unauthenticated",
        securityEffect: {
          impact: "account-takeover",
          claimedPropertyChange: "state-ownership",
        },
      },
      packet: {
        kind: "runtime-verification-packet",
        schemaVersion: 2,
        target,
        manifest,
        threatContext: {
          permittedAttacker: "unauthenticated",
          publicSurface: ["Public WordPress request handler"],
        },
        attackerPremise: "unauthenticated",
        securityEffect: {
          impact: "account-takeover",
          claimedPropertyChange: "state-ownership",
        },
        sourceRoute: [{ ordinal: 1, evidence: [anchor] }],
        sourceScreen: {
          attempt: { attemptId: "validator-runtime-1" },
          criteria: expect.arrayContaining([
            expect.objectContaining({
              criterion: "counterevidence-and-proof-gap",
              status: "unknown",
            }),
          ]),
        },
        closestControl: { status: "pass", evidence: [anchor] },
        researchBoundary: {
          sourceOnly: true,
          exactPayloadIncluded: false,
          rawRequestIncluded: false,
          findingEligible: false,
        },
      },
    });
    if (first.kind !== "prepared") throw new Error("Expected Packet");
    expect(referenceRuntimeRiskAssessment(first.riskAssessment).digest).toBe(
      sha256Digest(first.riskAssessment),
    );
    expect(referenceRuntimeVerificationPacket(first.packet).digest).toBe(
      sha256Digest(first.packet),
    );
  });

  it("does not create a Packet from non-ready source work", () => {
    expect(prepareRuntimeVerificationPacket(fixture("needs-research"))).toEqual(
      { kind: "incomplete", reason: "invalid-binding" },
    );
  });

  it("does not hand a Contributor-or-higher candidate to runtime", () => {
    expect(
      prepareRuntimeVerificationPacket(
        fixture(
          "ready-for-runtime",
          "A Contributor-only route reaches a privileged consumer.",
          "contributor",
        ),
      ),
    ).toEqual({ kind: "incomplete", reason: "attacker-out-of-scope" });
  });

  it("keeps exact payload-shaped material out of the Research handoff", () => {
    expect(
      prepareRuntimeVerificationPacket(
        fixture("ready-for-runtime", "curl an attacker endpoint."),
      ),
    ).toEqual({ kind: "incomplete", reason: "unsafe-runtime-content" });
  });
});
