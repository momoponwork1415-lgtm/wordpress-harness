import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  defineAIReproductionRecord,
  defineExternalActionAuthorization,
  defineHumanVerificationRecord,
  defineSubmissionDraft,
  openHumanOs,
  type IsolatedEnvironment,
} from "../../src/human-os/index.js";
import { canonicalDigest } from "../../src/infrastructure/canonical-json.js";
import type { SourceValidatedFinding } from "../../src/research/index.js";

const digest = (character: string): string => `sha256:${character.repeat(64)}`;

const finding: SourceValidatedFinding = {
  kind: "source-validated-finding",
  schemaVersion: 1,
  findingId: "campaign-1:finding:candidate-1",
  candidateId: "candidate-1",
  targetSnapshot: {
    id: "example-1.0.0",
    pluginSlug: "example",
    version: "1.0.0",
    digest: digest("a"),
    sourceTree: { digest: digest("9"), entries: 1, bytes: 6 },
  },
  attackerPremise: "An unauthenticated visitor can submit a public value.",
  brokenSecurityProperty: "Persisted public values must be inert in admin UI.",
  claim: "The public value is stored and rendered without output escaping.",
  assurance: "source-validated",
  validation: {
    runId: "campaign-1:validation:1",
    promptSet: { id: "validation-v1", digest: digest("b") },
    runtimeProfileDigest: digest("c"),
    permissionProfileDigest: digest("d"),
  },
  evidence: [
    {
      path: "public/save.php",
      location: "save:44",
      observation: "Stores the visitor-controlled value.",
    },
  ],
};

function environment(id: string): IsolatedEnvironment {
  return {
    environmentId: id,
    targetSnapshotDigest: finding.targetSnapshot.digest,
    backend: "gvisor",
    runtime: "runsc",
    fallbackUsed: false,
    fresh: true,
    disposable: true,
    hostTargetExecution: false,
    ambientCredentials: false,
    arbitraryNetwork: false,
  };
}

describe("agent-led Human OS", () => {
  it("keeps a Finding after disproval and separates AI and human environments", async () => {
    const directory = await mkdtemp(join(tmpdir(), "human-os-v3-"));
    const humanOs = openHumanOs({
      databasePath: join(directory, "human.sqlite"),
    });
    try {
      await humanOs.receiveFinding({
        finding,
        receivedAt: "2026-09-07T05:00:00.000Z",
      });
      const reproduction = defineAIReproductionRecord({
        kind: "ai-reproduction-record",
        schemaVersion: 3,
        findingId: finding.findingId,
        environment: environment("ai-environment-1"),
        status: "disproved",
        summary: "The claimed security effect was not observed.",
        privateEvidence: [{ id: "ai-evidence-1", digest: digest("e") }],
        recordedAt: "2026-09-07T05:10:00.000Z",
      });
      await humanOs.recordAIReproduction(reproduction);
      const sameEnvironment = defineHumanVerificationRecord({
        kind: "human-verification-record",
        schemaVersion: 3,
        findingId: finding.findingId,
        aiReproductionId: reproduction.id,
        environment: environment("ai-environment-1"),
        reviewer: { kind: "human-reviewer", id: "reviewer-1" },
        status: "disproved",
        summary: "Independent human reproduction also found no effect.",
        privateEvidence: [{ id: "human-evidence-1", digest: digest("f") }],
        recordedAt: "2026-09-07T05:20:00.000Z",
      });
      await expect(
        humanOs.recordHumanVerification(sameEnvironment),
      ).rejects.toThrow("separate fresh environment");

      const {
        id: _sameEnvironmentId,
        environment: _sameEnvironmentIdentity,
        ...verificationIdentity
      } = sameEnvironment;
      const verification = defineHumanVerificationRecord({
        ...verificationIdentity,
        environment: environment("human-environment-1"),
      });
      await humanOs.recordHumanVerification(verification);
      const view = await humanOs.inspect(finding.findingId);

      expect(view.finding).toEqual(finding);
      expect(view.aiReproductions).toHaveLength(1);
      expect(view.humanVerifications).toMatchObject([{ status: "disproved" }]);
    } finally {
      humanOs.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("requires human confirmation and exact Draft authorization for external action", async () => {
    const directory = await mkdtemp(join(tmpdir(), "human-os-gate-"));
    const humanOs = openHumanOs({
      databasePath: join(directory, "human.sqlite"),
    });
    try {
      await humanOs.receiveFinding({
        finding,
        receivedAt: "2026-09-07T06:00:00.000Z",
      });
      const draft = defineSubmissionDraft({
        kind: "submission-draft",
        schemaVersion: 1,
        findingId: finding.findingId,
        revision: 1,
        destination: "vendor-security-portal",
        contentDigest: digest("1"),
        preparedBy: "ai",
        createdAt: "2026-09-07T06:05:00.000Z",
      });
      await humanOs.saveSubmissionDraft(draft);
      const request = {
        findingId: finding.findingId,
        draftId: draft.id,
        draftDigest: canonicalDigest(draft),
        destination: draft.destination,
      };
      await expect(humanOs.admitExternalAction(request)).resolves.toEqual({
        status: "not-authorized",
        reason: "human-verification-required",
      });

      const reproduction = defineAIReproductionRecord({
        kind: "ai-reproduction-record",
        schemaVersion: 3,
        findingId: finding.findingId,
        environment: environment("ai-environment-2"),
        status: "runtime-confirmed",
        summary: "The browser execution canary was observed.",
        privateEvidence: [{ id: "ai-evidence-2", digest: digest("2") }],
        recordedAt: "2026-09-07T06:10:00.000Z",
      });
      await humanOs.recordAIReproduction(reproduction);
      await humanOs.recordHumanVerification(
        defineHumanVerificationRecord({
          kind: "human-verification-record",
          schemaVersion: 3,
          findingId: finding.findingId,
          aiReproductionId: reproduction.id,
          environment: environment("human-environment-2"),
          reviewer: { kind: "human-reviewer", id: "reviewer-2" },
          status: "human-confirmed",
          summary: "A human observed the same bounded browser canary.",
          privateEvidence: [{ id: "human-evidence-2", digest: digest("3") }],
          recordedAt: "2026-09-07T06:20:00.000Z",
        }),
      );
      await expect(humanOs.admitExternalAction(request)).resolves.toEqual({
        status: "not-authorized",
        reason: "exact-authorization-required",
      });
      const authorization = defineExternalActionAuthorization({
        kind: "external-action-authorization",
        schemaVersion: 1,
        findingId: finding.findingId,
        draftId: draft.id,
        draftDigest: canonicalDigest(draft),
        destination: draft.destination,
        authorizedBy: { kind: "human-reviewer", id: "reviewer-2" },
        authorizedAt: "2026-09-07T06:30:00.000Z",
      });
      await humanOs.authorizeExternalAction(authorization);

      await expect(humanOs.admitExternalAction(request)).resolves.toEqual({
        status: "authorized",
        authorizationId: authorization.id,
      });
      await expect(
        humanOs.admitExternalAction({
          ...request,
          destination: "different-destination",
        }),
      ).resolves.toEqual({
        status: "not-authorized",
        reason: "exact-authorization-required",
      });
    } finally {
      humanOs.close();
      await rm(directory, { recursive: true, force: true });
    }
  });
});
