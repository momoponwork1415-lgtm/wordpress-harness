import { describe, expect, it } from "vitest";

import { materializeValidationCandidates } from "../../src/research/campaign-control/validation-candidate-admission.js";
import {
  approachFamilyAdmissionRefSchema,
  approachFamilyAdmissionSchema,
  iterationDecisionV3Schema,
  sourceBoundHypothesisArtifactRefSchema,
  sourceBoundHypothesisArtifactSchema,
} from "../../src/research/exploration/index.js";
import { sha256Digest } from "../../src/research/research-record/canonical-json.js";
import type { JsonArtifactStore } from "../../src/research/research-record/index.js";

const digest = (value: string): string => sha256Digest(value);

describe("Campaign Validation Candidate admission", () => {
  it("exact-deduplicates Root-evaluated Hypotheses while retaining every Campaign-local Family origin", async () => {
    const target = {
      id: "candidate-target-1.0.0",
      pluginSlug: "candidate-target",
      version: "1.0.0",
      digest: digest("target"),
    };
    const manifest = {
      kind: "target-file-manifest" as const,
      schemaVersion: 1 as const,
      targetSnapshotId: target.id,
      targetSnapshotDigest: target.digest,
      digest: digest("manifest"),
    };
    const wave = {
      kind: "work-wave" as const,
      schemaVersion: 2 as const,
      id: digest("wave-id"),
      digest: digest("wave"),
      targetSnapshotDigest: target.digest,
      manifestDigest: manifest.digest,
    };
    const hypothesisValue = {
      kind: "source-bound-hypothesis" as const,
      schemaVersion: 1 as const,
      causalIdentity: {
        rootCause: "missing-authorization",
        attackerControlledPrimitive: "public-state-write",
        brokenSecurityProperty: "state-ownership",
      },
      attackerPremise: "unauthenticated" as const,
      impact: "account-takeover" as const,
      route: {
        anchors: [
          {
            path: "plugin.php",
            fileDigest: digest("plugin.php"),
            startLine: 20,
            endLine: 28,
          },
        ],
      },
      unknowns: [
        {
          claim: "The consumer accepts state written by another actor.",
          requiredEvidence: "Independently inspect every consumer guard.",
        },
      ],
      falsifier: "Every consumer binds the state to the originating actor.",
      nextExperiment: "Review the writer-to-consumer route independently.",
    };
    const artifacts = ["finder-a", "finder-b"].map((attemptId, index) => {
      const identity = {
        kind: "source-bound-hypothesis" as const,
        targetSnapshotDigest: target.digest,
        manifestDigest: manifest.digest,
        value: hypothesisValue,
      };
      const artifact = sourceBoundHypothesisArtifactSchema.parse({
        kind: "source-bound-hypothesis",
        schemaVersion: 2,
        id: sha256Digest(identity),
        target,
        manifest,
        workWave: wave,
        attemptId,
        leaseId: digest(`lease-${index + 1}`),
        value: hypothesisValue,
      });
      return {
        value: artifact,
        ref: sourceBoundHypothesisArtifactRefSchema.parse({
          kind: artifact.kind,
          schemaVersion: artifact.schemaVersion,
          id: artifact.id,
          digest: sha256Digest(artifact),
          attemptId: artifact.attemptId,
          leaseId: artifact.leaseId,
          workWaveDigest: wave.digest,
          targetSnapshotDigest: target.digest,
          manifestDigest: manifest.digest,
        }),
      };
    });
    const stored = new Map<string, unknown>(
      artifacts.map((artifact) => [artifact.ref.digest, artifact.value]),
    );
    const artifactStore: JsonArtifactStore = {
      putJson: async (value) => {
        const valueDigest = sha256Digest(value);
        stored.set(valueDigest, value);
        return valueDigest;
      },
      readJson: async (valueDigest) => {
        const value = stored.get(valueDigest);
        if (value === undefined) throw new Error("Artifact not found");
        return value;
      },
    };
    const familyEntries = artifacts.map((artifact, index) => {
      const identity = {
        kind: "approach-family-admission" as const,
        schemaVersion: 1 as const,
        key: `state-route-${index + 1}`,
        target,
        manifest,
        wave,
        subjects: [artifact.ref],
        thesis: `Independent state ownership route ${index + 1}.`,
        mechanism: "Cross-actor persistent state consumption.",
        falsifier: "The state remains actor-scoped at every consumer.",
        nextAction: "Validate the complete source route.",
      };
      const value = approachFamilyAdmissionSchema.parse({
        ...identity,
        id: sha256Digest(identity),
      });
      const ref = approachFamilyAdmissionRefSchema.parse({
        kind: value.kind,
        schemaVersion: value.schemaVersion,
        id: value.id,
        digest: sha256Digest(value),
        key: value.key,
        targetSnapshotDigest: target.digest,
        manifestDigest: manifest.digest,
        workWaveDigest: wave.digest,
      });
      return { value, ref };
    });
    const finderResult = {
      kind: "attempt-execution-result" as const,
      schemaVersion: 2 as const,
      attemptId: "finder-a",
      owner: "exploration" as const,
      role: "finder" as const,
      planDigest: digest("finder-plan"),
      digest: digest("finder-result"),
    };
    const evaluatorResult = {
      kind: "attempt-execution-result" as const,
      schemaVersion: 2 as const,
      attemptId: "root-evaluator",
      owner: "exploration" as const,
      role: "root-evaluator" as const,
      planDigest: digest("evaluator-plan"),
      digest: digest("evaluator-result"),
    };
    const decision = iterationDecisionV3Schema.parse({
      kind: "iteration-decision",
      schemaVersion: 3,
      target,
      manifest,
      wave,
      evaluationSubjects: artifacts.map((artifact) => artifact.ref),
      context: {
        kind: "wave-evaluation",
        terminalDigest: digest("terminal"),
        workLeases: [
          {
            kind: "work-lease",
            schemaVersion: 2,
            id: digest("lease-ref"),
            digest: digest("lease-value"),
            workWaveDigest: wave.digest,
            targetSnapshotDigest: target.digest,
            manifestDigest: manifest.digest,
          },
        ],
        attemptResults: [finderResult],
        toolReceipts: [],
        rootEvaluatorAttempts: [evaluatorResult],
      },
      approachFamilies: familyEntries.map((family) => family.value),
      actions: artifacts.map((artifact, index) => ({
        kind: "admit-validation" as const,
        approachFamily: familyEntries[index]!.ref,
        subjects: [artifact.ref],
        admission: {
          kind: "validation-admission" as const,
          schemaVersion: 1 as const,
          id: digest(`validation-admission-${index + 1}`),
          target,
          manifest,
          wave,
          hypothesis: artifact.ref,
          brokenSecurityProperty: "state-ownership",
          causalRoute: [
            {
              ordinal: 1,
              claim:
                "A public state write reaches a cross-actor consumer without an ownership check.",
              evidence: hypothesisValue.route.anchors,
            },
          ],
          reason: "The complete source route warrants independent review.",
        },
      })),
      campaignDisposition: "continue",
    });

    const first = await materializeValidationCandidates(artifactStore, {
      campaignId: "campaign-candidate-admission",
      runId: "run-candidate-admission",
      decision,
    });
    const replay = await materializeValidationCandidates(artifactStore, {
      campaignId: "campaign-candidate-admission",
      runId: "run-candidate-admission",
      decision,
    });

    expect(replay).toEqual(first);
    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({
      attackerPremise: "unauthenticated",
      brokenSecurityProperty: "state-ownership",
      causalRoute: [
        {
          ordinal: 1,
          claim:
            "A public state write reaches a cross-actor consumer without an ownership check.",
          evidence: hypothesisValue.route.anchors,
        },
      ],
    });
    expect(first[0]!.origins).toHaveLength(2);
    expect(first[0]!.origins).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ subjectDigest: artifacts[0]!.ref.digest }),
        expect.objectContaining({ subjectDigest: artifacts[1]!.ref.digest }),
      ]),
    );
    expect(
      new Set(first[0]!.origins.map((origin) => origin.approachFamilyId)).size,
    ).toBe(2);
  });
});
