import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, it } from "vitest";

import { canonicalDigest } from "../../src/infrastructure/canonical-json.js";
import {
  defineCandidateVerificationRecord,
  defineExternalActionAuthorization,
  defineProgrammeScopeAssessment,
  defineSubmissionDraft,
  openHumanOs,
  type CandidateVerificationRuntime,
  type ProgrammeScopeEvaluator,
} from "../../src/human-os/index.js";
import { candidateVerificationRequestSchema } from "../../src/research/index.js";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

function request() {
  const body = {
    kind: "candidate-verification-request" as const,
    schemaVersion: 1 as const,
    requestId: "campaign-1:verification:candidate-1",
    campaignId: "campaign-1",
    campaignInputDigest:
      "sha256:1111111111111111111111111111111111111111111111111111111111111111",
    candidateReviewDigest:
      "sha256:2222222222222222222222222222222222222222222222222222222222222222",
    targetSnapshot: {
      id: "target-1",
      pluginSlug: "example-plugin",
      version: "1.0.0",
      digest:
        "sha256:3333333333333333333333333333333333333333333333333333333333333333",
      sourceTree: {
        digest:
          "sha256:4444444444444444444444444444444444444444444444444444444444444444",
        entries: 10,
        bytes: 1_024,
      },
    },
    candidate: {
      candidateId: "candidate-1",
      attackerPremise: "Unauthenticated visitor",
      brokenSecurityProperty: "Only administrators may install executable code",
      claim: "A public action installs attacker-controlled PHP",
      evidence: [
        {
          path: "includes/action.php",
          location: "42-70",
          observation: "The public action reaches the archive installer",
        },
      ],
      reproductionRecipe: {
        kind: "candidate-verification-recipe-ref" as const,
        schemaVersion: 1 as const,
        recipeId: "candidate-1-recipe",
        digest:
          "sha256:5555555555555555555555555555555555555555555555555555555555555555",
        bytes: 512,
      },
    },
  };
  return candidateVerificationRequestSchema.parse({
    ...body,
    digest: canonicalDigest(body),
  });
}

describe("Candidate Verification", () => {
  it("keeps technical truth separate from every programme scope outcome", async () => {
    const directory = await mkdtemp(join(tmpdir(), "candidate-verification-"));
    directories.push(directory);
    const input = request();
    const runtime: CandidateVerificationRuntime = {
      execute: async ({ request: candidateRequest }) =>
        defineCandidateVerificationRecord({
          kind: "candidate-verification-record",
          schemaVersion: 1,
          requestId: candidateRequest.requestId,
          candidateId: candidateRequest.candidate.candidateId,
          environment: {
            environmentId: "fresh-lab-1",
            targetSnapshotDigest: candidateRequest.targetSnapshot.digest,
            runtimeProfileDigest:
              "sha256:6666666666666666666666666666666666666666666666666666666666666666",
            backend: "gvisor",
            runtime: "runsc",
            fallbackUsed: false,
            fresh: true,
            disposable: true,
            hostTargetExecution: false,
            ambientCredentials: false,
            arbitraryNetwork: false,
          },
          status: "runtime-confirmed",
          summary: "The disposable site executed the nonce canary.",
          evidenceRequest: null,
          privateEvidence: [
            {
              id: "runtime-transcript",
              digest:
                "sha256:7777777777777777777777777777777777777777777777777777777777777777",
            },
          ],
          recordedAt: "2026-09-15T01:00:00.000Z",
        }),
    };
    const evaluator: ProgrammeScopeEvaluator = {
      programmeIdentities: ["patchstack", "wordfence", "private-programme"],
      assess: async ({ vulnerability }) =>
        [
          [
            "patchstack",
            "in-scope",
            "Patchstack",
            "Eligible plugin and impact",
          ],
          ["wordfence", "out-of-scope", "Wordfence", "Asset is not enrolled"],
          ["private-programme", "ambiguous", "Private", "Rule text is unclear"],
        ].map(([programmeIdentity, status, destination, reason], index) =>
          defineProgrammeScopeAssessment({
            kind: "programme-scope-assessment",
            schemaVersion: 1,
            vulnerabilityId: vulnerability.vulnerabilityId,
            programmeIdentity: programmeIdentity!,
            programmeSnapshot: {
              id: `scope-${index + 1}`,
              digest: `sha256:${["8", "9", "a"][index]!.repeat(64)}`,
            },
            status: status as "in-scope" | "out-of-scope" | "ambiguous",
            destination: destination!,
            reason: reason!,
            assessedAt: "2026-09-15T01:01:00.000Z",
          }),
        ),
    };
    const humanOs = openHumanOs({
      databasePath: join(directory, "human-os.sqlite"),
      candidateVerificationRuntime: runtime,
      programmeScopeEvaluator: evaluator,
      clock: () => new Date("2026-09-15T01:00:00.000Z"),
    });

    await humanOs.receiveCandidateVerification({
      request: input,
      receivedAt: "2026-09-15T00:59:00.000Z",
    });
    const verified = await humanOs.verifyCandidate(input.requestId);

    expect(verified.verifiedVulnerability).toMatchObject({
      assurance: "runtime-confirmed",
      candidateId: "candidate-1",
    });
    expect(
      verified.scopeAssessments.map(({ programmeIdentity, status }) => ({
        programmeIdentity,
        status,
      })),
    ).toEqual([
      { programmeIdentity: "patchstack", status: "in-scope" },
      { programmeIdentity: "wordfence", status: "out-of-scope" },
      { programmeIdentity: "private-programme", status: "ambiguous" },
    ]);
    expect(verified.submissionCandidates).toHaveLength(1);

    const vulnerability = verified.verifiedVulnerability!;
    const submissionCandidate = verified.submissionCandidates[0]!;
    const draft = defineSubmissionDraft({
      kind: "submission-draft",
      schemaVersion: 1,
      vulnerabilityId: vulnerability.vulnerabilityId,
      submissionCandidateId: submissionCandidate.id,
      revision: 1,
      destination: submissionCandidate.destination,
      contentDigest:
        "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      preparedBy: "ai",
      createdAt: "2026-09-15T01:02:00.000Z",
    });
    await humanOs.saveSubmissionDraft(draft);
    const requestAction = {
      vulnerabilityId: vulnerability.vulnerabilityId,
      submissionCandidateId: submissionCandidate.id,
      draftId: draft.id,
      draftDigest: canonicalDigest(draft),
      destination: submissionCandidate.destination,
    };
    await expect(humanOs.admitExternalAction(requestAction)).resolves.toEqual({
      status: "not-authorized",
      reason: "exact-authorization-required",
    });
    await humanOs.authorizeExternalAction(
      defineExternalActionAuthorization({
        kind: "external-action-authorization",
        schemaVersion: 1,
        ...requestAction,
        authorizedBy: { kind: "human-reviewer", id: "operator-1" },
        authorizedAt: "2026-09-15T01:03:00.000Z",
      }),
    );
    await expect(
      humanOs.admitExternalAction(requestAction),
    ).resolves.toMatchObject({
      status: "authorized",
    });
    humanOs.close();
  });

  it("keeps a runtime-confirmed vulnerability when every programme is OOS", async () => {
    const directory = await mkdtemp(join(tmpdir(), "candidate-oos-"));
    directories.push(directory);
    const input = request();
    const humanOs = openHumanOs({
      databasePath: join(directory, "human-os.sqlite"),
      candidateVerificationRuntime: {
        execute: async ({ request: candidateRequest }) =>
          defineCandidateVerificationRecord({
            kind: "candidate-verification-record",
            schemaVersion: 1,
            requestId: candidateRequest.requestId,
            candidateId: candidateRequest.candidate.candidateId,
            environment: {
              environmentId: "fresh-lab-oos",
              targetSnapshotDigest: candidateRequest.targetSnapshot.digest,
              runtimeProfileDigest:
                "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
              backend: "gvisor",
              runtime: "runsc",
              fallbackUsed: false,
              fresh: true,
              disposable: true,
              hostTargetExecution: false,
              ambientCredentials: false,
              arbitraryNetwork: false,
            },
            status: "runtime-confirmed",
            summary: "Observed.",
            evidenceRequest: null,
            privateEvidence: [
              {
                id: "evidence",
                digest:
                  "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
              },
            ],
            recordedAt: "2026-09-15T02:00:00.000Z",
          }),
      },
      programmeScopeEvaluator: {
        programmeIdentities: ["patchstack"],
        assess: async ({ vulnerability }) => [
          defineProgrammeScopeAssessment({
            kind: "programme-scope-assessment",
            schemaVersion: 1,
            vulnerabilityId: vulnerability.vulnerabilityId,
            programmeIdentity: "patchstack",
            programmeSnapshot: {
              id: "patchstack-scope",
              digest:
                "sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
            },
            status: "out-of-scope",
            destination: "Patchstack",
            reason: "The asset is excluded.",
            assessedAt: "2026-09-15T02:01:00.000Z",
          }),
        ],
      },
    });
    await humanOs.receiveCandidateVerification({
      request: input,
      receivedAt: "2026-09-15T01:59:00.000Z",
    });
    const view = await humanOs.verifyCandidate(input.requestId);
    expect(view.verifiedVulnerability?.assurance).toBe("runtime-confirmed");
    expect(view.submissionCandidates).toEqual([]);
    humanOs.close();
  });

  it("retains technical truth when programme scope evaluation fails", async () => {
    const directory = await mkdtemp(join(tmpdir(), "candidate-scope-failure-"));
    directories.push(directory);
    const input = request();
    let scopeAttempts = 0;
    const humanOs = openHumanOs({
      databasePath: join(directory, "human-os.sqlite"),
      candidateVerificationRuntime: {
        execute: async ({ request: candidateRequest }) =>
          defineCandidateVerificationRecord({
            kind: "candidate-verification-record",
            schemaVersion: 1,
            requestId: candidateRequest.requestId,
            candidateId: candidateRequest.candidate.candidateId,
            environment: {
              environmentId: "fresh-lab-scope-failure",
              targetSnapshotDigest: candidateRequest.targetSnapshot.digest,
              runtimeProfileDigest:
                "sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
              backend: "gvisor",
              runtime: "runsc",
              fallbackUsed: false,
              fresh: true,
              disposable: true,
              hostTargetExecution: false,
              ambientCredentials: false,
              arbitraryNetwork: false,
            },
            status: "runtime-confirmed",
            summary: "Observed.",
            evidenceRequest: null,
            privateEvidence: [
              {
                id: "evidence",
                digest:
                  "sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
              },
            ],
            recordedAt: "2026-09-16T00:00:00.000Z",
          }),
      },
      programmeScopeEvaluator: {
        programmeIdentities: ["patchstack"],
        assess: async () => {
          scopeAttempts += 1;
          throw new Error("programme feed unavailable");
        },
      },
      clock: () => new Date("2026-09-16T00:01:00.000Z"),
    });

    await humanOs.receiveCandidateVerification({
      request: input,
      receivedAt: "2026-09-15T23:59:00.000Z",
    });
    const first = await humanOs.verifyCandidate(input.requestId);

    expect(first.verifiedVulnerability).toMatchObject({
      assurance: "runtime-confirmed",
    });
    expect(first.programmeScopeStatus).toBe("incomplete");
    expect(first.scopeAssessments).toEqual([]);
    expect(first.submissionCandidates).toEqual([]);

    const second = await humanOs.verifyCandidate(input.requestId);
    expect(second.verifiedVulnerability?.vulnerabilityId).toBe(
      first.verifiedVulnerability?.vulnerabilityId,
    );
    expect(scopeAttempts).toBe(2);
    humanOs.close();
  });
});
