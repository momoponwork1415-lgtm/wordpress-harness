import { describe, expect, it } from "vitest";

import {
  deepSeekHarnessNativeTransport,
  defineAgentRuntimeProfile,
} from "../../src/infrastructure/agent-runtime-profile.js";
import { canonicalDigest } from "../../src/infrastructure/canonical-json.js";
import {
  defineCandidateVerificationRecord,
  defineProgrammeScopeAssessment,
  type CandidateVerificationView,
} from "../../src/human-os/index.js";
import {
  defineIndependentResearchTrialHumanCandidateReview,
  defineIndependentResearchTrialBinding,
  defineIndependentResearchTrialComparisonRequest,
  deriveHumanCandidateReviewsForIndependentResearchTrials,
  deriveIndependentResearchTrialComparison,
  prepareIndependentResearchTrialCandidateReview,
} from "../../src/operations/independent-research-trial-comparison.js";
import type {
  AgentCheckpointRef,
  CandidateReviewRequest,
  CandidateVerificationRequest,
  CampaignInput,
  NativeRunAttempt,
  NativeRunReceipt,
  ResearchAssessment,
  ResearchCampaignView,
  ResearchCandidate,
  SealedNativeRun,
} from "../../src/research/agent-led/contracts.js";
import { canonicalResearchPromptSet } from "../../src/research/agent-led/research-prompt-set.js";
import { researchEvidenceSummaryFixture } from "../research/support/research-evidence-summary.js";

function digest(character: string): string {
  return `sha256:${character.repeat(64)}`;
}

const runtimeProfile = defineAgentRuntimeProfile({
  id: "deepseek-flash-max",
  ...deepSeekHarnessNativeTransport,
  model: "deepseek-flash",
  effort: "max",
});

function campaignInput(campaignId: string): CampaignInput {
  return {
    kind: "agent-led-campaign",
    schemaVersion: 2,
    campaignId,
    targetSnapshot: {
      id: "target-fixture-1",
      pluginSlug: "fixture-plugin",
      version: "1.0.0",
      digest: digest("a"),
      sourceTree: { digest: digest("b"), entries: 1, bytes: 6 },
    },
    promptSet: canonicalResearchPromptSet,
    agentRuntimeProfile: runtimeProfile,
    permissionProfile: { id: "source-only-v1", digest: digest("d") },
    budgetEnvelope: {
      id: "campaign-envelope-v1",
      maxNativeRuns: 3,
      maxWallTimeMs: 3_600_000,
      digest: digest("e"),
    },
  };
}

const sharedCandidate: ResearchCandidate = {
  candidateId: "candidate-shared",
  attackerPremise: "Unauthenticated visitor",
  brokenSecurityProperty: "Only administrators may update plugin options",
  claim: "A public request can change an administrator-only plugin option.",
  evidence: [
    {
      path: "plugin.php",
      location: "update_option:42",
      observation: "The public callback persists an attacker value.",
    },
  ],
  sourceTrace: [
    {
      role: "entrypoint",
      path: "plugin.php",
      location: "route:18",
      observation: "The route accepts an unauthenticated request.",
    },
    {
      role: "effect",
      path: "plugin.php",
      location: "update_option:42",
      observation: "The route updates a protected option.",
    },
  ],
  controlAssessments: [
    {
      control: "Administrator capability check",
      evidence: [
        {
          path: "plugin.php",
          location: "route:18-42",
          observation: "No capability check guards the update.",
        },
      ],
      conclusion: "No source-visible authority check prevents the update.",
    },
  ],
  unresolvedFacts: [],
  reproductionRecipe: {
    kind: "candidate-verification-recipe-ref",
    schemaVersion: 1,
    recipeId: "recipe-shared",
    digest: digest("f"),
    bytes: 120,
  },
};

const blockedAssessment: ResearchAssessment = {
  assessmentId: "assessment-legacy-batch",
  attackerPremise: "Subscriber",
  securityProperty:
    "Subscriber requests must not reach administrator-only batch actions.",
  question: "Can a Subscriber reach the legacy batch route?",
  evidence: [
    {
      path: "plugin.php",
      location: "legacy_batch:80",
      observation: "The route is registered conditionally.",
    },
  ],
  controlAssessments: [
    {
      control: "Feature flag",
      evidence: [
        {
          path: "plugin.php",
          location: "legacy_batch:76",
          observation: "Source does not establish the deployed flag value.",
        },
      ],
      conclusion: "Deployment state is decisive.",
    },
  ],
  basis: "The source leaves the ordinary deployment flag unresolved.",
  disposition: "blocked",
  unresolvedFacts: ["Whether the legacy batch feature is enabled."],
};

function runFor(input: CampaignInput, ordinal: number): SealedNativeRun {
  return {
    kind: "sealed-native-research-run",
    schemaVersion: 2,
    runId: `${input.campaignId}:native:${ordinal}`,
    campaignId: input.campaignId,
    campaignInputDigest: canonicalDigest(input),
    targetSnapshot: input.targetSnapshot,
    promptSet: input.promptSet,
    agentRuntimeProfile: input.agentRuntimeProfile,
    permissionProfile: input.permissionProfile,
    budgetEnvelope: input.budgetEnvelope,
    budgetAllowance: { maxWallTimeMs: 60_000 },
  };
}

function checkpointFor(run: SealedNativeRun): AgentCheckpointRef {
  return {
    kind: "agent-checkpoint",
    schemaVersion: 1,
    checkpointId: `${run.runId}:checkpoint`,
    stateDigest: digest("1"),
    stateEntries: 1,
    stateBytes: 1,
    sessionId: `session-${run.runId.replaceAll(":", "-")}`,
    targetSnapshotDigest: run.targetSnapshot.digest,
    promptSetDigest: run.promptSet.digest,
    runtimeProfileDigest: run.agentRuntimeProfile.digest,
    permissionProfileDigest: run.permissionProfile.digest,
  };
}

function completedReceipt(
  run: SealedNativeRun,
  options: {
    candidate?: ResearchCandidate;
    assessment?: ResearchAssessment;
    estimatedCostUsd?: number;
  } = {},
): NativeRunReceipt {
  return {
    schemaVersion: 2,
    runId: run.runId,
    runtimeProfileDigest: run.agentRuntimeProfile.digest,
    terminal: "completed",
    startedAt: "2026-09-18T00:00:00.000Z",
    completedAt: "2026-09-18T00:01:00.000Z",
    usage: {
      wallTimeMs: 60_000,
      inputTokens: 1_000,
      outputTokens: 200,
      ...(options.estimatedCostUsd === undefined
        ? {}
        : { estimatedCostUsd: options.estimatedCostUsd }),
    },
    activity: { subagents: 1, tools: ["read_file"] },
    isolation: { backend: "gvisor", runtime: "runsc", fallbackUsed: false },
    checkpoint: checkpointFor(run),
    report: {
      schemaVersion: 2,
      assessments: options.assessment === undefined ? [] : [options.assessment],
      evidenceSummary: researchEvidenceSummaryFixture(),
      candidates: options.candidate === undefined ? [] : [options.candidate],
      decision: {
        kind: "stop",
        basis: "The fixture has no remaining actionable frontier.",
      },
    },
  };
}

function failedReceipt(run: SealedNativeRun): NativeRunReceipt {
  return {
    schemaVersion: 2,
    runId: run.runId,
    runtimeProfileDigest: run.agentRuntimeProfile.digest,
    terminal: "provider-quota-exhausted",
    startedAt: "2026-09-18T00:00:00.000Z",
    completedAt: "2026-09-18T00:00:10.000Z",
    usage: { wallTimeMs: 10_000 },
    activity: { subagents: null, tools: null },
    failure: { summary: "Quota unavailable.", retryable: true },
  };
}

function attemptFor(
  run: SealedNativeRun,
  receipt: NativeRunReceipt,
): NativeRunAttempt {
  return {
    kind: "native-run-attempt",
    schemaVersion: 1,
    run,
    runDigest: canonicalDigest(run),
    startedAt: receipt.startedAt,
    status: "terminal",
    nativeRunReceiptDigest: canonicalDigest(receipt),
  };
}

function campaignView(
  input: CampaignInput,
  status: ResearchCampaignView["status"],
  runs: readonly { run: SealedNativeRun; receipt: NativeRunReceipt }[],
  candidateVerificationRequests: readonly CandidateVerificationRequest[] = [],
): ResearchCampaignView {
  const completedRuns = runs.flatMap(({ receipt }) =>
    receipt.terminal === "completed"
      ? [
          {
            runId: receipt.runId,
            evidenceSummary: receipt.report.evidenceSummary,
          },
        ]
      : [],
  );
  const observedPaths = [
    ...new Set(
      completedRuns.flatMap((run) =>
        run.evidenceSummary.examinedAreas.flatMap((area) =>
          area.evidence.map((evidence) => evidence.path),
        ),
      ),
    ),
  ];
  return {
    kind: "agent-led-campaign-outcome",
    schemaVersion: 4,
    campaignId: input.campaignId,
    inputDigest: canonicalDigest(input),
    status,
    input,
    nativeRunAttempts: runs.map(({ run, receipt }) => attemptFor(run, receipt)),
    nativeRuns: runs.map(({ receipt }) => receipt),
    candidateReviews: [],
    parkedProgrammeLeads: [],
    candidateVerificationRequests,
    verificationPreparationNeeded: [],
    researchProgress: {
      completedRuns,
      observedSourcePaths: observedPaths.map((path) => ({
        path,
        runIds: completedRuns
          .filter((run) =>
            run.evidenceSummary.examinedAreas.some((area) =>
              area.evidence.some((evidence) => evidence.path === path),
            ),
          )
          .map((run) => run.runId),
      })),
      pendingNextActions: [],
    },
    coverage: {
      status:
        status === "incomplete"
          ? "incomplete"
          : status === "coverage-closed" ||
              status === "candidate-verification-ready"
            ? "closed"
            : "open",
    },
  };
}

function verificationRequest(
  input: CampaignInput,
): CandidateVerificationRequest {
  const reproductionRecipe = sharedCandidate.reproductionRecipe;
  if (reproductionRecipe === undefined) {
    throw new Error("fixture Candidate recipe is missing");
  }
  const body = {
    kind: "candidate-verification-request" as const,
    schemaVersion: 2 as const,
    requestId: `${input.campaignId}:verification:candidate-shared`,
    campaignId: input.campaignId,
    campaignInputDigest: canonicalDigest(input),
    candidateReviewDigest: digest("2"),
    targetSnapshot: input.targetSnapshot,
    candidate: { ...sharedCandidate, reproductionRecipe },
  };
  return { ...body, digest: canonicalDigest(body) };
}

function candidateReviewRequest(
  input: CampaignInput,
  run: SealedNativeRun,
  candidates: readonly ResearchCandidate[],
): CandidateReviewRequest {
  const candidateSetDigest = canonicalDigest(candidates);
  const body = {
    kind: "candidate-review-request" as const,
    schemaVersion: 2 as const,
    campaignId: input.campaignId,
    campaignInputDigest: canonicalDigest(input),
    terminalResearchRunId: run.runId,
    candidateSetDigest,
    candidates: [...candidates],
  };
  return { ...body, digest: canonicalDigest(body) };
}

function candidateReviewComparisonFixture() {
  const inputs = [
    campaignInput("trial-review-one"),
    campaignInput("trial-review-two"),
    campaignInput("trial-review-no-candidate"),
  ];
  const runs = inputs.map((input) => runFor(input, 1));
  const views = inputs.map((input, index) => {
    const run = runs[index]!;
    const candidates = index === 2 ? [] : [sharedCandidate];
    const view = campaignView(
      input,
      candidates.length === 0 ? "coverage-closed" : "candidate-review-pending",
      [
        {
          run,
          receipt: completedReceipt(run, {
            ...(candidates.length === 0 ? {} : { candidate: sharedCandidate }),
          }),
        },
      ],
    );
    return candidates.length === 0
      ? view
      : {
          ...view,
          pendingCandidateReview: candidateReviewRequest(
            input,
            run,
            candidates,
          ),
        };
  });
  const comparisonRequest = defineIndependentResearchTrialComparisonRequest({
    comparisonId: "comparison-candidate-review",
    trialCampaignIds: inputs.map((input) => input.campaignId),
    expectedBinding: defineIndependentResearchTrialBinding(inputs[0]!),
  });
  const comparison = deriveIndependentResearchTrialComparison(
    comparisonRequest,
    { campaignViews: views },
  );
  return { inputs, runs, views, comparison };
}

function aggregateCandidateReviewFixture() {
  const fixture = candidateReviewComparisonFixture();
  return {
    ...fixture,
    request: prepareIndependentResearchTrialCandidateReview(
      fixture.comparison,
      { campaignViews: fixture.views },
    ),
  };
}

describe("Independent Research Trial comparison", () => {
  it("prepares one provenance-preserving Human Candidate Review across terminal Trials", () => {
    const { inputs, request } = aggregateCandidateReviewFixture();

    expect(request.trialCampaignIds).toEqual(
      inputs.map((input) => input.campaignId),
    );
    expect(request.candidateRecords).toMatchObject([
      {
        campaignId: "trial-review-one",
        candidateId: "candidate-shared",
        runIds: ["trial-review-one:native:1"],
      },
      {
        campaignId: "trial-review-two",
        candidateId: "candidate-shared",
        runIds: ["trial-review-two:native:1"],
      },
    ]);
    expect(request.originCandidateReviewRequests).toHaveLength(2);

    const review = defineIndependentResearchTrialHumanCandidateReview(request, {
      reviewId: "review-three-terminal-trials",
      operator: {
        identity: "human-reviewer",
        decidedAt: "2026-09-20T10:00:00.000Z",
      },
      decisions: [
        {
          campaignId: "trial-review-one",
          candidateId: "candidate-shared",
          disposition: "advance-to-candidate-verification",
          reason: "The Candidate warrants fresh runtime verification.",
        },
        {
          campaignId: "trial-review-two",
          candidateId: "candidate-shared",
          disposition: "return-to-research",
          reason: "The second Trial leaves one decisive source question.",
          nextActions: [
            {
              question: "Does the normal save path preserve this value?",
              sourcePointers: ["plugin.php:42"],
            },
          ],
        },
      ],
    });
    const originReviews =
      deriveHumanCandidateReviewsForIndependentResearchTrials(request, review);

    expect(originReviews).toHaveLength(2);
    expect(originReviews).toMatchObject([
      {
        reviewId: "review-three-terminal-trials",
        campaignId: "trial-review-one",
        candidateReviewRequestDigest:
          request.originCandidateReviewRequests[0]?.digest,
        decisions: [{ disposition: "advance-to-candidate-verification" }],
      },
      {
        reviewId: "review-three-terminal-trials",
        campaignId: "trial-review-two",
        candidateReviewRequestDigest:
          request.originCandidateReviewRequests[1]?.digest,
        decisions: [{ disposition: "return-to-research" }],
      },
    ]);
  });

  it.each(["incomplete", "incompatible"] as const)(
    "refuses aggregate review while any Trial is %s",
    (terminalFailure) => {
      const firstInput = campaignInput(`trial-${terminalFailure}-one`);
      const secondInput = campaignInput(`trial-${terminalFailure}-two`);
      const failingInput =
        terminalFailure === "incompatible"
          ? {
              ...secondInput,
              budgetEnvelope: {
                ...secondInput.budgetEnvelope,
                digest: digest("9"),
              },
            }
          : secondInput;
      const firstRun = runFor(firstInput, 1);
      const secondRun = runFor(failingInput, 1);
      const views = [
        campaignView(firstInput, "coverage-closed", [
          { run: firstRun, receipt: completedReceipt(firstRun) },
        ]),
        campaignView(
          failingInput,
          terminalFailure === "incomplete" ? "incomplete" : "coverage-closed",
          [
            {
              run: secondRun,
              receipt:
                terminalFailure === "incomplete"
                  ? failedReceipt(secondRun)
                  : completedReceipt(secondRun),
            },
          ],
        ),
      ];
      const comparisonRequest = defineIndependentResearchTrialComparisonRequest(
        {
          comparisonId: `comparison-${terminalFailure}`,
          trialCampaignIds: [firstInput.campaignId, failingInput.campaignId],
          expectedBinding: defineIndependentResearchTrialBinding(firstInput),
        },
      );
      const comparison = deriveIndependentResearchTrialComparison(
        comparisonRequest,
        { campaignViews: views },
      );

      expect(() =>
        prepareIndependentResearchTrialCandidateReview(comparison, {
          campaignViews: views,
        }),
      ).toThrow(/every planned Trial to be model-completed/);
    },
  );

  it("requires one human decision for every provenance-distinct Candidate", () => {
    const { request } = aggregateCandidateReviewFixture();

    expect(() =>
      defineIndependentResearchTrialHumanCandidateReview(request, {
        reviewId: "review-with-missing-decision",
        operator: {
          identity: "human-reviewer",
          decidedAt: "2026-09-20T10:00:00.000Z",
        },
        decisions: [
          {
            campaignId: "trial-review-one",
            candidateId: "candidate-shared",
            disposition: "advance-to-candidate-verification",
            reason: "The first Trial Candidate is ready.",
          },
        ],
      }),
    ).toThrow(/must decide every exact origin Candidate once/);
  });

  it("rejects a pending Candidate Review Request that differs from comparison provenance", () => {
    const { inputs, runs, views, comparison } =
      candidateReviewComparisonFixture();
    const changedCandidate = {
      ...sharedCandidate,
      claim: "A different claim was substituted after comparison.",
    };
    const mismatchedViews = [
      {
        ...views[0]!,
        pendingCandidateReview: candidateReviewRequest(inputs[0]!, runs[0]!, [
          changedCandidate,
        ]),
      },
      ...views.slice(1),
    ];

    expect(() =>
      prepareIndependentResearchTrialCandidateReview(comparison, {
        campaignViews: mismatchedViews,
      }),
    ).toThrow(/Candidate provenance mismatch/);
  });

  it("rejects duplicate aggregate decisions for one origin Candidate", () => {
    const { request } = aggregateCandidateReviewFixture();
    const repeatedDecision = {
      campaignId: "trial-review-one",
      candidateId: "candidate-shared",
      disposition: "advance-to-candidate-verification" as const,
      reason: "The Candidate is ready.",
    };

    expect(() =>
      defineIndependentResearchTrialHumanCandidateReview(request, {
        reviewId: "review-with-duplicate-decision",
        operator: {
          identity: "human-reviewer",
          decidedAt: "2026-09-20T10:00:00.000Z",
        },
        decisions: [
          repeatedDecision,
          repeatedDecision,
          {
            campaignId: "trial-review-two",
            candidateId: "candidate-shared",
            disposition: "advance-to-candidate-verification",
            reason: "The second Candidate is ready.",
          },
        ],
      }),
    ).toThrow(/decisions must be unique/);
  });

  it("counts Campaigns as trials while retaining run-local provenance and unknown cost", () => {
    const inputs = [
      campaignInput("trial-one"),
      campaignInput("trial-two"),
      campaignInput("trial-three"),
    ];
    const firstRun = runFor(inputs[0]!, 1);
    const continuationRun = {
      ...runFor(inputs[0]!, 2),
      resumeFrom: checkpointFor(firstRun),
    };
    const secondRun = runFor(inputs[1]!, 1);
    const failedRun = runFor(inputs[2]!, 1);
    const views = [
      campaignView(inputs[1]!, "coverage-closed", [
        {
          run: secondRun,
          receipt: completedReceipt(secondRun, {
            candidate: sharedCandidate,
            estimatedCostUsd: 0.4,
          }),
        },
      ]),
      campaignView(inputs[2]!, "incomplete", [
        { run: failedRun, receipt: failedReceipt(failedRun) },
      ]),
      campaignView(inputs[0]!, "coverage-closed", [
        {
          run: firstRun,
          receipt: completedReceipt(firstRun, {
            candidate: sharedCandidate,
            assessment: blockedAssessment,
          }),
        },
        {
          run: continuationRun,
          receipt: completedReceipt(continuationRun, {
            candidate: sharedCandidate,
            estimatedCostUsd: 0.25,
          }),
        },
      ]),
    ];
    const request = defineIndependentResearchTrialComparisonRequest({
      comparisonId: "comparison-three-trials",
      trialCampaignIds: inputs.map((input) => input.campaignId),
      expectedBinding: defineIndependentResearchTrialBinding(inputs[0]!),
    });

    const comparison = deriveIndependentResearchTrialComparison(request, {
      campaignViews: views,
      candidateVerificationViews: [],
    });
    const reordered = deriveIndependentResearchTrialComparison(request, {
      campaignViews: [...views].reverse(),
      candidateVerificationViews: [],
    });

    expect(comparison).toEqual(reordered);
    expect(comparison.summary).toEqual({
      plannedTrials: 3,
      modelCompletedTrials: 2,
      incompleteTrials: 1,
      incompatibleTrials: 0,
      compatibleCandidateRecords: 2,
      compatibleAssessmentOccurrences: 1,
    });
    expect(comparison.trials).toMatchObject([
      {
        campaignId: "trial-one",
        state: "model-completed",
        grantCount: 2,
        attemptCount: 2,
        candidateRecordCount: 1,
      },
      {
        campaignId: "trial-two",
        state: "model-completed",
        grantCount: 1,
        candidateRecordCount: 1,
      },
      {
        campaignId: "trial-three",
        state: "incomplete",
        grantCount: 1,
      },
    ]);
    expect(comparison.candidateRecords).toHaveLength(2);
    expect(comparison.candidateRecords).toMatchObject([
      {
        campaignId: "trial-one",
        candidateId: "candidate-shared",
        runIds: ["trial-one:native:1", "trial-one:native:2"],
      },
      {
        campaignId: "trial-two",
        candidateId: "candidate-shared",
        runIds: ["trial-two:native:1"],
      },
    ]);
    expect(comparison.candidateRecords[0]?.candidateRecordDigest).toBe(
      comparison.candidateRecords[1]?.candidateRecordDigest,
    );
    expect(comparison.assessmentOccurrences).toMatchObject([
      {
        campaignId: "trial-one",
        runId: "trial-one:native:1",
        assessmentIndex: 0,
        assessment: { disposition: "blocked" },
      },
    ]);
    expect(comparison.compatibleUsage).toMatchObject({
      wallTimeMs: { status: "known", value: 190_000 },
      inputTokens: { status: "unknown" },
      outputTokens: { status: "unknown" },
      estimatedCostUsd: { status: "unknown" },
    });
  });

  it("makes missing and incompatible trials explicit", () => {
    const baseline = campaignInput("trial-baseline");
    const permissionMismatch = {
      ...campaignInput("trial-permission-mismatch"),
      targetSnapshot: {
        ...baseline.targetSnapshot,
        id: "target-alias-with-same-source",
      },
      permissionProfile: {
        id: "different-source-only-profile-v1",
        digest: digest("f"),
      },
    };
    const resumedInput = {
      ...campaignInput("trial-resumed"),
      resumeFrom: checkpointFor(runFor(baseline, 1)),
    };
    const permissionRun = runFor(permissionMismatch, 1);
    const resumedRun = runFor(resumedInput, 1);
    const request = defineIndependentResearchTrialComparisonRequest({
      comparisonId: "comparison-incompatible",
      trialCampaignIds: [
        permissionMismatch.campaignId,
        resumedInput.campaignId,
        "trial-missing",
      ],
      expectedBinding: defineIndependentResearchTrialBinding(baseline),
    });

    const comparison = deriveIndependentResearchTrialComparison(request, {
      campaignViews: [
        campaignView(permissionMismatch, "coverage-closed", [
          {
            run: permissionRun,
            receipt: completedReceipt(permissionRun, {
              estimatedCostUsd: 0.1,
            }),
          },
        ]),
        campaignView(resumedInput, "coverage-closed", [
          {
            run: resumedRun,
            receipt: completedReceipt(resumedRun, { estimatedCostUsd: 0.1 }),
          },
        ]),
      ],
      candidateVerificationViews: [],
    });

    expect(comparison.trials).toMatchObject([
      {
        campaignId: "trial-permission-mismatch",
        state: "incompatible",
        compatibilityIssues: ["target-snapshot", "permission-profile"],
      },
      {
        campaignId: "trial-resumed",
        state: "incompatible",
        compatibilityIssues: ["resumed-campaign"],
      },
      {
        campaignId: "trial-missing",
        state: "planned",
        campaignStatus: null,
        coverageStatus: null,
      },
    ]);
    expect(comparison.summary).toMatchObject({
      plannedTrials: 3,
      modelCompletedTrials: 0,
      incompleteTrials: 0,
      incompatibleTrials: 2,
    });

    const unplannedInput = campaignInput("trial-unplanned");
    const unplannedRun = runFor(unplannedInput, 1);
    expect(() =>
      deriveIndependentResearchTrialComparison(request, {
        campaignViews: [
          campaignView(unplannedInput, "coverage-closed", [
            {
              run: unplannedRun,
              receipt: completedReceipt(unplannedRun, {
                estimatedCostUsd: 0,
              }),
            },
          ]),
        ],
      }),
    ).toThrow(/unplanned Campaign/u);
  });

  it("keeps runtime confirmation separate from programme scope", () => {
    const input = campaignInput("trial-verified");
    const run = runFor(input, 1);
    const request = verificationRequest(input);
    const record = defineCandidateVerificationRecord({
      kind: "candidate-verification-record",
      schemaVersion: 1,
      requestId: request.requestId,
      candidateId: sharedCandidate.candidateId,
      environment: {
        environmentId: "environment-verified",
        targetSnapshotDigest: input.targetSnapshot.digest,
        runtimeProfileDigest: digest("3"),
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
      summary: "The protected option changed under the attacker premise.",
      privateEvidence: [{ id: "evidence-1", digest: digest("4") }],
      recordedAt: "2026-09-18T01:00:00.000Z",
    });
    const vulnerabilityId = "vulnerability-verified";
    const scope = defineProgrammeScopeAssessment({
      kind: "programme-scope-assessment",
      schemaVersion: 1,
      vulnerabilityId,
      programmeIdentity: "programme-one",
      programmeSnapshot: { id: "scope-v1", digest: digest("5") },
      status: "out-of-scope",
      destination: "Programme One",
      reason: "This impact is excluded by the current programme scope.",
      assessedAt: "2026-09-18T01:01:00.000Z",
    });
    const verificationView: CandidateVerificationView = {
      request,
      receivedAt: "2026-09-18T00:59:00.000Z",
      verificationRecords: [record],
      verifiedVulnerability: {
        kind: "verified-vulnerability",
        schemaVersion: 1,
        vulnerabilityId,
        candidateId: sharedCandidate.candidateId,
        targetSnapshot: input.targetSnapshot,
        attackerPremise: sharedCandidate.attackerPremise,
        brokenSecurityProperty: sharedCandidate.brokenSecurityProperty,
        claim: sharedCandidate.claim,
        assurance: "runtime-confirmed",
        candidateVerificationRef: { id: record.id, digest: record.id },
        evidence: sharedCandidate.evidence,
      },
      programmeScopeStatus: "completed",
      scopeAssessments: [scope],
      submissionCandidates: [],
      drafts: [],
      authorizations: [],
    };
    const comparisonRequest = defineIndependentResearchTrialComparisonRequest({
      comparisonId: "comparison-verification",
      trialCampaignIds: [input.campaignId],
      expectedBinding: defineIndependentResearchTrialBinding(input),
    });

    const comparison = deriveIndependentResearchTrialComparison(
      comparisonRequest,
      {
        campaignViews: [
          campaignView(
            input,
            "candidate-verification-ready",
            [
              {
                run,
                receipt: completedReceipt(run, {
                  candidate: sharedCandidate,
                  estimatedCostUsd: 0.2,
                }),
              },
            ],
            [request],
          ),
        ],
        candidateVerificationViews: [verificationView],
      },
    );

    expect(comparison.verificationOutcomes).toMatchObject([
      {
        campaignId: input.campaignId,
        requestId: request.requestId,
        candidateId: sharedCandidate.candidateId,
        verificationStatus: "runtime-confirmed",
        verifiedVulnerabilityId: vulnerabilityId,
        programmeScopeStatus: "completed",
        scopeAssessments: [{ status: "out-of-scope" }],
      },
    ]);
    expect(comparison.trials[0]).toMatchObject({
      campaignStatus: "candidate-verification-ready",
      coverageStatus: "closed",
    });
  });
});
