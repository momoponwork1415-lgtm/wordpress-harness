import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { defineAgentRuntimeProfile } from "../../src/infrastructure/agent-runtime-profile.js";
import { canonicalDigest } from "../../src/infrastructure/canonical-json.js";
import { openFileCandidateVerificationRecipeResolver } from "../../src/human-os/index.js";
import {
  candidateVerificationRequestSchema,
  candidateVerificationRecipeSchema,
  researchAssessmentSchema,
  sealedNativeRunSchema,
} from "../../src/research/agent-led/contracts.js";
import {
  materializeResearchReport,
  providerResearchReportSchema,
} from "../../src/research/agent-led/provider-research-report.js";
import { researchEvidenceSummaryFixture } from "./support/research-evidence-summary.js";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

function run() {
  return sealedNativeRunSchema.parse({
    kind: "sealed-native-research-run",
    schemaVersion: 2,
    runId: "run-1",
    campaignId: "campaign-1",
    campaignInputDigest: `sha256:${"1".repeat(64)}`,
    targetSnapshot: {
      id: "target-1",
      pluginSlug: "example-plugin",
      version: "1.0.0",
      digest: `sha256:${"2".repeat(64)}`,
      sourceTree: {
        digest: `sha256:${"3".repeat(64)}`,
        entries: 1,
        bytes: 6,
      },
    },
    promptSet: { id: "prompt-1", digest: `sha256:${"4".repeat(64)}` },
    agentRuntimeProfile: defineAgentRuntimeProfile({
      id: "runtime-1",
      transportKind: "test-native/v1",
      executableVersion: "1.0.0",
      sandboxImageDigest: `sha256:${"0".repeat(64)}`,
      promptProtocol: "stdin",
      reportProtocol: "prompted-json",
      model: "test-model",
      effort: "high",
    }),
    permissionProfile: {
      id: "permission-1",
      digest: `sha256:${"6".repeat(64)}`,
    },
    budgetEnvelope: {
      id: "budget-1",
      maxNativeRuns: 1,
      maxWallTimeMs: 60_000,
      digest: `sha256:${"7".repeat(64)}`,
    },
    budgetAllowance: { maxWallTimeMs: 60_000 },
  });
}

function report(targetSnapshotDigest: string) {
  return {
    schemaVersion: 1 as const,
    candidates: [
      {
        candidateId: "candidate-1",
        attackerPremise: "Unauthenticated visitor",
        brokenSecurityProperty: "Only administrators may install code",
        claim: "A public action installs attacker-controlled PHP",
        evidence: [
          {
            path: "plugin.php",
            location: "10-42",
            observation: "The public action reaches the installer.",
          },
        ],
        reproductionRecipe: {
          kind: "candidate-verification-recipe" as const,
          schemaVersion: 1 as const,
          recipeId: "candidate-1-recipe",
          candidateId: "candidate-1",
          targetSnapshotDigest,
          script:
            'printf \'%s\\n\' \'HARNESS_RESULT={"summary":"observed","preconditionsMatched":true,"recipeCompleted":true,"effectObserved":true}\'',
          timeoutMs: 30_000,
        },
      },
    ],
    decision: {
      kind: "stop" as const,
      basis: "No actionable frontier remains.",
    },
  };
}

function challengedReport(targetSnapshotDigest: string) {
  const value = report(targetSnapshotDigest);
  return {
    ...value,
    schemaVersion: 2 as const,
    evidenceSummary: researchEvidenceSummaryFixture(),
    assessments: [
      {
        assessmentId: "assessment-refuted-nonce-bypass",
        attackerPremise: "Unauthenticated visitor",
        securityProperty: "State changes require an authorized request",
        question: "Can the public action bypass the nonce check?",
        disposition: "refuted" as const,
        evidence: [
          {
            path: "plugin.php",
            location: "8",
            observation: "The public action verifies a request-bound nonce.",
          },
        ],
        controlAssessments: [
          {
            control: "Request-bound nonce verification",
            evidence: [
              {
                path: "plugin.php",
                location: "8",
                observation: "The handler rejects a missing or invalid nonce.",
              },
            ],
            conclusion: "The visible control refutes this bypass route.",
          },
        ],
        basis: "The unauthenticated request cannot pass the nonce check.",
      },
    ],
    candidates: value.candidates.map((candidate) => ({
      ...candidate,
      sourceTrace: [
        {
          role: "entrypoint" as const,
          path: "plugin.php",
          location: "10",
          observation: "The public action accepts the uploaded archive.",
        },
        {
          role: "effect" as const,
          path: "plugin.php",
          location: "42",
          observation: "The archive is installed as executable plugin code.",
        },
      ],
      controlAssessments: [
        {
          control: "Administrator capability check",
          evidence: [
            {
              path: "plugin.php",
              location: "10-42",
              observation:
                "The public action reaches installation without a capability check.",
            },
          ],
          conclusion:
            "No source-visible control prevents the public request from reaching installation.",
        },
      ],
      unresolvedFacts: [],
    })),
  };
}

describe("provider Research Report materialization", () => {
  it("rejects a Report without source-grounded evidence of examined scope", () => {
    const { evidenceSummary: _evidenceSummary, ...withoutEvidenceSummary } =
      challengedReport(run().targetSnapshot.digest);
    expect(
      providerResearchReportSchema.safeParse(withoutEvidenceSummary).success,
    ).toBe(false);
  });

  it("moves a Candidate recipe body into the private content-addressed store", async () => {
    const directory = await mkdtemp(join(tmpdir(), "candidate-recipe-cas-"));
    directories.push(directory);
    const candidateRecipeDirectory = join(directory, "recipes");
    const sealedRun = run();

    const materialized = await materializeResearchReport(
      challengedReport(sealedRun.targetSnapshot.digest),
      sealedRun,
      candidateRecipeDirectory,
    );

    const reference = materialized.candidates[0]!.reproductionRecipe!;
    expect(reference).toMatchObject({
      kind: "candidate-verification-recipe-ref",
      recipeId: "candidate-1-recipe",
    });
    const encoded = await readFile(
      join(
        candidateRecipeDirectory,
        reference.digest.slice("sha256:".length),
        "content",
        "recipe.json",
      ),
      "utf8",
    );
    const stored = candidateVerificationRecipeSchema.parse(
      JSON.parse(encoded) as unknown,
    );
    const { digest: _digest, ...identity } = stored;
    expect(canonicalDigest(identity)).toBe(reference.digest);
    expect(stored).toMatchObject({
      candidateId: "candidate-1",
      targetSnapshotDigest: sealedRun.targetSnapshot.digest,
      script: expect.stringContaining("HARNESS_RESULT="),
    });
    expect(JSON.stringify(materialized)).not.toContain("HARNESS_RESULT=");

    const requestBody = {
      kind: "candidate-verification-request" as const,
      schemaVersion: 2 as const,
      requestId: "campaign-1:verification:candidate-1",
      campaignId: sealedRun.campaignId,
      campaignInputDigest: sealedRun.campaignInputDigest,
      candidateReviewDigest: `sha256:${"8".repeat(64)}`,
      targetSnapshot: sealedRun.targetSnapshot,
      candidate: materialized.candidates[0]!,
    };
    const resolver = openFileCandidateVerificationRecipeResolver({
      candidateRecipeDirectory,
    });
    await expect(
      resolver.resolve({
        request: candidateVerificationRequestSchema.parse({
          ...requestBody,
          digest: canonicalDigest(requestBody),
        }),
      }),
    ).resolves.toMatchObject({
      kind: "recipe-ready",
      recipe: { recipeId: "candidate-1-recipe" },
    });
  });

  it("canonicalizes provider source-trace roles from their ordered positions", async () => {
    const directory = await mkdtemp(join(tmpdir(), "provider-source-trace-"));
    directories.push(directory);
    const sealedRun = run();
    const value = challengedReport(sealedRun.targetSnapshot.digest);
    const candidate = value.candidates[0]!;
    const first = candidate.sourceTrace[0]!;
    const last = candidate.sourceTrace.at(-1)!;
    const providerReport = {
      ...value,
      candidates: [
        {
          ...candidate,
          sourceTrace: [
            first,
            {
              ...first,
              role: "persistence of forged privileged state" as const,
              location: "20",
              observation: "A second input joins the ordered route.",
            },
            {
              ...last,
              role: "effect" as const,
              location: "30",
              observation: "An intermediate security-relevant effect occurs.",
            },
            {
              ...last,
              role: "sink" as const,
            },
          ],
        },
      ],
    };

    expect(providerResearchReportSchema.safeParse(providerReport).success).toBe(
      true,
    );
    const materialized = await materializeResearchReport(
      providerReport,
      sealedRun,
      join(directory, "recipes"),
    );

    expect(
      materialized.candidates[0]!.sourceTrace.map((step) => step.role),
    ).toEqual(["entrypoint", "propagation", "propagation", "effect"]);
    expect(
      materialized.candidates[0]!.sourceTrace.map((step) => step.observation),
    ).toEqual(
      providerReport.candidates[0]!.sourceTrace.map((step) => step.observation),
    );
  });

  it("inherits a control conclusion for provider evidence pointers without an observation", async () => {
    const directory = await mkdtemp(
      join(tmpdir(), "provider-control-evidence-"),
    );
    directories.push(directory);
    const sealedRun = run();
    const value = challengedReport(sealedRun.targetSnapshot.digest);
    const candidate = value.candidates[0]!;
    const assessment = value.assessments[0]!;
    const candidateControl = candidate.controlAssessments[0]!;
    const assessmentControl = assessment.controlAssessments[0]!;
    const providerReport = {
      ...value,
      candidates: [
        {
          ...candidate,
          controlAssessments: [
            {
              ...candidateControl,
              evidence: candidateControl.evidence.map(
                ({ observation: _observation, ...pointer }) => pointer,
              ),
            },
          ],
        },
      ],
      assessments: [
        {
          ...assessment,
          controlAssessments: [
            {
              ...assessmentControl,
              evidence: assessmentControl.evidence.map(
                ({ observation: _observation, ...pointer }) => pointer,
              ),
            },
          ],
        },
      ],
    };

    const materialized = await materializeResearchReport(
      providerReport,
      sealedRun,
      join(directory, "recipes"),
    );

    expect(
      materialized.candidates[0]!.controlAssessments[0]!.evidence[0]!
        .observation,
    ).toBe(candidateControl.conclusion);
    expect(
      materialized.assessments[0]!.controlAssessments[0]!.evidence[0]!
        .observation,
    ).toBe(assessmentControl.conclusion);
  });

  it("rejects a Candidate without a challenged source trace", async () => {
    const directory = await mkdtemp(join(tmpdir(), "candidate-source-trace-"));
    directories.push(directory);

    await expect(
      materializeResearchReport(
        report(run().targetSnapshot.digest),
        run(),
        join(directory, "recipes"),
      ),
    ).rejects.toThrow();
  });

  it("requires an exact unresolved fact for a blocked Assessment", () => {
    const value = challengedReport(run().targetSnapshot.digest);
    const refuted = value.assessments[0]!;
    const blocked = {
      ...refuted,
      disposition: "blocked" as const,
      unresolvedFacts: [
        "The pinned source does not establish the ordinary deployment setting.",
      ],
    };

    expect(researchAssessmentSchema.safeParse(blocked).success).toBe(true);
    const { unresolvedFacts: _unresolvedFacts, ...missingBlocker } = blocked;
    expect(researchAssessmentSchema.safeParse(missingBlocker).success).toBe(
      false,
    );
  });

  it("rejects a recipe bound to another Target Snapshot", async () => {
    const directory = await mkdtemp(
      join(tmpdir(), "candidate-recipe-binding-"),
    );
    directories.push(directory);

    await expect(
      materializeResearchReport(
        challengedReport(`sha256:${"f".repeat(64)}`),
        run(),
        join(directory, "recipes"),
      ),
    ).rejects.toThrow(/does not match/i);
  });
});
