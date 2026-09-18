import { z } from "zod";

import {
  candidateVerificationViewSchema,
  programmeScopeAssessmentSchema,
  type CandidateVerificationView,
} from "../human-os/index.js";
import {
  canonicalDigest,
  canonicalJson,
} from "../infrastructure/canonical-json.js";
import {
  campaignInputSchema,
  researchAssessmentSchema,
  researchCandidateSchema,
  type CampaignInput,
  type NativeRunReceipt,
  type ResearchCampaignView,
  type ResearchCandidate,
} from "../research/index.js";

const digestSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const identifierSchema = z
  .string()
  .min(1)
  .max(160)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);

const independentResearchTrialBindingBodySchema = z.strictObject({
  kind: z.literal("independent-research-trial-binding"),
  schemaVersion: z.literal(1),
  targetSnapshotRefDigest: digestSchema,
  dependencySnapshotsDigest: digestSchema,
  threatContextDigest: digestSchema.nullable(),
  programmeBoundaryDigest: digestSchema.nullable(),
  promptSetRefDigest: digestSchema,
  runtimeProfileDigest: digestSchema,
  permissionProfileRefDigest: digestSchema,
  budgetEnvelopeRefDigest: digestSchema,
  freshSession: z.literal(true),
});

export const independentResearchTrialBindingSchema =
  independentResearchTrialBindingBodySchema
    .extend({ digest: digestSchema })
    .superRefine((binding, context) => {
      const { digest, ...body } = binding;
      if (digest !== canonicalDigest(body)) {
        context.addIssue({
          code: "custom",
          path: ["digest"],
          message: "Independent Trial binding digest must bind its body",
        });
      }
    });

export type IndependentResearchTrialBinding = z.infer<
  typeof independentResearchTrialBindingSchema
>;

function bindingBody(input: CampaignInput) {
  return independentResearchTrialBindingBodySchema.parse({
    kind: "independent-research-trial-binding",
    schemaVersion: 1,
    targetSnapshotRefDigest: canonicalDigest(input.targetSnapshot),
    dependencySnapshotsDigest: canonicalDigest(input.dependencySnapshots ?? []),
    threatContextDigest: input.threatContext?.digest ?? null,
    programmeBoundaryDigest: input.programmeBoundary?.digest ?? null,
    promptSetRefDigest: canonicalDigest(input.promptSet),
    runtimeProfileDigest: input.agentRuntimeProfile.digest,
    permissionProfileRefDigest: canonicalDigest(input.permissionProfile),
    budgetEnvelopeRefDigest: canonicalDigest(input.budgetEnvelope),
    freshSession: true,
  });
}

export function defineIndependentResearchTrialBinding(
  candidateInput: CampaignInput,
): IndependentResearchTrialBinding {
  const input = campaignInputSchema.parse(candidateInput);
  if (input.resumeFrom !== undefined) {
    throw new Error(
      "Independent Research Trial binding requires a fresh Campaign",
    );
  }
  const body = bindingBody(input);
  return independentResearchTrialBindingSchema.parse({
    ...body,
    digest: canonicalDigest(body),
  });
}

const independentResearchTrialComparisonRequestBodySchema = z
  .strictObject({
    kind: z.literal("independent-research-trial-comparison-request"),
    schemaVersion: z.literal(1),
    comparisonId: identifierSchema,
    trialCampaignIds: z.array(identifierSchema).min(1).max(100),
    expectedBinding: independentResearchTrialBindingSchema,
  })
  .superRefine((request, context) => {
    if (
      new Set(request.trialCampaignIds).size !== request.trialCampaignIds.length
    ) {
      context.addIssue({
        code: "custom",
        path: ["trialCampaignIds"],
        message: "Independent Trial Campaign identities must be unique",
      });
    }
  });

export const independentResearchTrialComparisonRequestSchema =
  independentResearchTrialComparisonRequestBodySchema
    .extend({ digest: digestSchema })
    .superRefine((request, context) => {
      const { digest, ...body } = request;
      if (digest !== canonicalDigest(body)) {
        context.addIssue({
          code: "custom",
          path: ["digest"],
          message: "Independent Trial comparison request digest mismatch",
        });
      }
    });

export type IndependentResearchTrialComparisonRequest = z.infer<
  typeof independentResearchTrialComparisonRequestSchema
>;

export function defineIndependentResearchTrialComparisonRequest(input: {
  readonly comparisonId: string;
  readonly trialCampaignIds: readonly string[];
  readonly expectedBinding: IndependentResearchTrialBinding;
}): IndependentResearchTrialComparisonRequest {
  const body = independentResearchTrialComparisonRequestBodySchema.parse({
    kind: "independent-research-trial-comparison-request",
    schemaVersion: 1,
    comparisonId: input.comparisonId,
    trialCampaignIds: [...input.trialCampaignIds],
    expectedBinding: input.expectedBinding,
  });
  return independentResearchTrialComparisonRequestSchema.parse({
    ...body,
    digest: canonicalDigest(body),
  });
}

const compatibilityIssueSchema = z.enum([
  "target-snapshot",
  "dependency-snapshots",
  "threat-context",
  "programme-boundary",
  "prompt-set",
  "runtime-profile",
  "permission-profile",
  "budget-envelope",
  "resumed-campaign",
]);

const observedMetricSchema = z.discriminatedUnion("status", [
  z.strictObject({ status: z.literal("not-observed") }),
  z.strictObject({ status: z.literal("unknown") }),
  z.strictObject({
    status: z.literal("known"),
    value: z.number().nonnegative(),
  }),
]);

const usageSchema = z.strictObject({
  wallTimeMs: observedMetricSchema,
  inputTokens: observedMetricSchema,
  outputTokens: observedMetricSchema,
  estimatedCostUsd: observedMetricSchema,
});

const campaignStatusSchema = z.enum([
  "research-continues",
  "research-review-pending",
  "candidate-review-pending",
  "verification-preparation-needed",
  "candidate-verification-ready",
  "coverage-closed",
  "incomplete",
]);

const trialComparisonSchema = z.strictObject({
  campaignId: identifierSchema,
  state: z.enum(["planned", "model-completed", "incomplete", "incompatible"]),
  compatibilityIssues: z.array(compatibilityIssueSchema),
  campaignStatus: campaignStatusSchema.nullable(),
  coverageStatus: z.enum(["open", "closed", "incomplete"]).nullable(),
  grantCount: z.number().int().nonnegative(),
  attemptCount: z.number().int().nonnegative(),
  candidateRecordCount: z.number().int().nonnegative(),
  assessmentOccurrenceCount: z.number().int().nonnegative(),
  candidateVerificationRequestCount: z.number().int().nonnegative(),
  usage: usageSchema,
});

const candidateRecordSchema = z.strictObject({
  campaignId: identifierSchema,
  candidateId: identifierSchema,
  runIds: z.array(identifierSchema).min(1),
  candidateRecordDigest: digestSchema,
  compatible: z.boolean(),
  candidate: researchCandidateSchema,
});

const assessmentOccurrenceSchema = z.strictObject({
  campaignId: identifierSchema,
  runId: identifierSchema,
  assessmentIndex: z.number().int().nonnegative(),
  assessmentDigest: digestSchema,
  compatible: z.boolean(),
  assessment: researchAssessmentSchema,
});

const verificationOutcomeSchema = z.strictObject({
  campaignId: identifierSchema,
  requestId: identifierSchema,
  candidateId: identifierSchema,
  verificationStatus: z.enum([
    "not-observed",
    "pending",
    "runtime-confirmed",
    "contradicted",
    "incomplete",
  ]),
  verificationRecordIds: z.array(digestSchema),
  verifiedVulnerabilityId: z.string().min(1).nullable(),
  compatible: z.boolean(),
  programmeScopeStatus: z.enum([
    "not-observed",
    "not-configured",
    "pending",
    "completed",
    "incomplete",
  ]),
  scopeAssessments: z.array(programmeScopeAssessmentSchema),
});

const independentResearchTrialComparisonBodySchema = z.strictObject({
  kind: z.literal("independent-research-trial-comparison"),
  schemaVersion: z.literal(1),
  comparisonId: identifierSchema,
  requestDigest: digestSchema,
  expectedBindingDigest: digestSchema,
  summary: z.strictObject({
    plannedTrials: z.number().int().positive(),
    modelCompletedTrials: z.number().int().nonnegative(),
    incompleteTrials: z.number().int().nonnegative(),
    incompatibleTrials: z.number().int().nonnegative(),
    compatibleCandidateRecords: z.number().int().nonnegative(),
    compatibleAssessmentOccurrences: z.number().int().nonnegative(),
  }),
  compatibleUsage: usageSchema,
  trials: z.array(trialComparisonSchema).min(1),
  candidateRecords: z.array(candidateRecordSchema),
  assessmentOccurrences: z.array(assessmentOccurrenceSchema),
  verificationOutcomes: z.array(verificationOutcomeSchema),
});

export const independentResearchTrialComparisonSchema =
  independentResearchTrialComparisonBodySchema
    .extend({ digest: digestSchema })
    .superRefine((comparison, context) => {
      const { digest, ...body } = comparison;
      if (digest !== canonicalDigest(body)) {
        context.addIssue({
          code: "custom",
          path: ["digest"],
          message: "Independent Trial comparison digest mismatch",
        });
      }
    });

export type IndependentResearchTrialComparison = z.infer<
  typeof independentResearchTrialComparisonSchema
>;

type CompatibilityIssue = z.infer<typeof compatibilityIssueSchema>;
type ObservedMetric = z.infer<typeof observedMetricSchema>;

function compatibilityIssues(
  input: CampaignInput,
  expected: IndependentResearchTrialBinding,
): readonly CompatibilityIssue[] {
  const actual = bindingBody(input);
  const issues: CompatibilityIssue[] = [];
  if (actual.targetSnapshotRefDigest !== expected.targetSnapshotRefDigest) {
    issues.push("target-snapshot");
  }
  if (actual.dependencySnapshotsDigest !== expected.dependencySnapshotsDigest) {
    issues.push("dependency-snapshots");
  }
  if (actual.threatContextDigest !== expected.threatContextDigest) {
    issues.push("threat-context");
  }
  if (actual.programmeBoundaryDigest !== expected.programmeBoundaryDigest) {
    issues.push("programme-boundary");
  }
  if (actual.promptSetRefDigest !== expected.promptSetRefDigest) {
    issues.push("prompt-set");
  }
  if (actual.runtimeProfileDigest !== expected.runtimeProfileDigest) {
    issues.push("runtime-profile");
  }
  if (
    actual.permissionProfileRefDigest !== expected.permissionProfileRefDigest
  ) {
    issues.push("permission-profile");
  }
  if (actual.budgetEnvelopeRefDigest !== expected.budgetEnvelopeRefDigest) {
    issues.push("budget-envelope");
  }
  if (input.resumeFrom !== undefined) issues.push("resumed-campaign");
  return issues;
}

function metric(
  receipts: readonly NativeRunReceipt[],
  read: (receipt: NativeRunReceipt) => number | undefined,
): ObservedMetric {
  if (receipts.length === 0) return { status: "not-observed" };
  const values = receipts.map(read);
  let total = 0;
  for (const value of values) {
    if (value === undefined) return { status: "unknown" };
    total += value;
  }
  return {
    status: "known",
    value: total,
  };
}

function usage(receipts: readonly NativeRunReceipt[]) {
  return usageSchema.parse({
    wallTimeMs: metric(receipts, (receipt) => receipt.usage.wallTimeMs),
    inputTokens: metric(receipts, (receipt) => receipt.usage.inputTokens),
    outputTokens: metric(receipts, (receipt) => receipt.usage.outputTokens),
    estimatedCostUsd: metric(
      receipts,
      (receipt) => receipt.usage.estimatedCostUsd,
    ),
  });
}

function modelCompleted(view: ResearchCampaignView): boolean {
  return (
    view.status !== "incomplete" &&
    view.nativeRuns.length > 0 &&
    view.nativeRuns.every((receipt) => receipt.terminal === "completed") &&
    view.nativeRunAttempts.every((attempt) => attempt.status === "terminal")
  );
}

function validateCampaignViews(
  views: readonly ResearchCampaignView[],
  planned: ReadonlySet<string>,
): ReadonlyMap<string, ResearchCampaignView> {
  const byCampaign = new Map<string, ResearchCampaignView>();
  for (const view of views) {
    if (!planned.has(view.campaignId)) {
      throw new Error(
        `Independent Trial comparison received an unplanned Campaign: ${view.campaignId}`,
      );
    }
    if (
      byCampaign.has(view.campaignId) ||
      view.input.campaignId !== view.campaignId ||
      view.inputDigest !== canonicalDigest(view.input)
    ) {
      throw new Error(
        `Independent Trial Campaign view binding is invalid: ${view.campaignId}`,
      );
    }
    byCampaign.set(view.campaignId, view);
  }
  return byCampaign;
}

function validateVerificationViews(
  views: readonly CandidateVerificationView[],
): ReadonlyMap<string, CandidateVerificationView> {
  const byRequest = new Map<string, CandidateVerificationView>();
  for (const candidateView of views) {
    const view = candidateVerificationViewSchema.parse(candidateView);
    if (byRequest.has(view.request.requestId)) {
      throw new Error(
        `Duplicate Candidate Verification view: ${view.request.requestId}`,
      );
    }
    byRequest.set(view.request.requestId, view);
  }
  return byRequest;
}

export function deriveIndependentResearchTrialComparison(
  candidateRequest: IndependentResearchTrialComparisonRequest,
  input: {
    readonly campaignViews: readonly ResearchCampaignView[];
    readonly candidateVerificationViews?: readonly CandidateVerificationView[];
  },
): IndependentResearchTrialComparison {
  const request =
    independentResearchTrialComparisonRequestSchema.parse(candidateRequest);
  const planned = new Set(request.trialCampaignIds);
  const campaigns = validateCampaignViews(input.campaignViews, planned);
  const verificationViews = validateVerificationViews(
    input.candidateVerificationViews ?? [],
  );
  const consumedVerificationRequests = new Set<string>();
  const trials: z.infer<typeof trialComparisonSchema>[] = [];
  const candidateRecords: z.infer<typeof candidateRecordSchema>[] = [];
  const assessmentOccurrences: z.infer<typeof assessmentOccurrenceSchema>[] =
    [];
  const verificationOutcomes: z.infer<typeof verificationOutcomeSchema>[] = [];
  const compatibleReceipts: NativeRunReceipt[] = [];

  for (const campaignId of request.trialCampaignIds) {
    const view = campaigns.get(campaignId);
    if (view === undefined) {
      trials.push({
        campaignId,
        state: "planned",
        compatibilityIssues: [],
        campaignStatus: null,
        coverageStatus: null,
        grantCount: 0,
        attemptCount: 0,
        candidateRecordCount: 0,
        assessmentOccurrenceCount: 0,
        candidateVerificationRequestCount: 0,
        usage: usage([]),
      });
      continue;
    }

    const issues = [
      ...compatibilityIssues(view.input, request.expectedBinding),
    ];
    const compatible = issues.length === 0;
    if (compatible) compatibleReceipts.push(...view.nativeRuns);
    const recordsForCampaign = new Map<
      string,
      {
        candidate: ResearchCandidate;
        runIds: string[];
      }
    >();
    let assessmentCount = 0;
    for (const receipt of view.nativeRuns) {
      if (receipt.terminal !== "completed") continue;
      for (const candidate of receipt.report.candidates) {
        const prior = recordsForCampaign.get(candidate.candidateId);
        if (
          prior !== undefined &&
          canonicalJson(prior.candidate) !== canonicalJson(candidate)
        ) {
          throw new Error(
            `Research Candidate identity conflict in comparison: ${campaignId}/${candidate.candidateId}`,
          );
        }
        if (prior === undefined) {
          recordsForCampaign.set(candidate.candidateId, {
            candidate,
            runIds: [receipt.runId],
          });
        } else {
          prior.runIds.push(receipt.runId);
        }
      }
      for (const [
        assessmentIndex,
        assessment,
      ] of receipt.report.assessments.entries()) {
        assessmentOccurrences.push({
          campaignId,
          runId: receipt.runId,
          assessmentIndex,
          assessmentDigest: canonicalDigest(assessment),
          compatible,
          assessment,
        });
        assessmentCount += 1;
      }
    }
    for (const [candidateId, record] of recordsForCampaign) {
      candidateRecords.push({
        campaignId,
        candidateId,
        runIds: record.runIds,
        candidateRecordDigest: canonicalDigest(record.candidate),
        compatible,
        candidate: record.candidate,
      });
    }

    const requests = [...view.candidateVerificationRequests].sort(
      (left, right) => left.requestId.localeCompare(right.requestId),
    );
    for (const verificationRequest of requests) {
      const verification = verificationViews.get(verificationRequest.requestId);
      if (
        verification !== undefined &&
        canonicalJson(verification.request) !==
          canonicalJson(verificationRequest)
      ) {
        throw new Error(
          `Candidate Verification view binding mismatch: ${verificationRequest.requestId}`,
        );
      }
      if (verification !== undefined) {
        consumedVerificationRequests.add(verificationRequest.requestId);
      }
      const latest = verification?.verificationRecords.at(-1);
      verificationOutcomes.push({
        campaignId,
        requestId: verificationRequest.requestId,
        candidateId: verificationRequest.candidate.candidateId,
        verificationStatus:
          verification === undefined
            ? "not-observed"
            : latest === undefined
              ? "pending"
              : latest.status,
        verificationRecordIds:
          verification?.verificationRecords.map((record) => record.id) ?? [],
        verifiedVulnerabilityId:
          verification?.verifiedVulnerability?.vulnerabilityId ?? null,
        compatible,
        programmeScopeStatus:
          verification?.programmeScopeStatus ?? "not-observed",
        scopeAssessments: verification?.scopeAssessments ?? [],
      });
    }

    trials.push({
      campaignId,
      state: !compatible
        ? "incompatible"
        : modelCompleted(view)
          ? "model-completed"
          : "incomplete",
      compatibilityIssues: issues,
      campaignStatus: view.status,
      coverageStatus: view.coverage.status,
      grantCount: view.nativeRuns.length,
      attemptCount: view.nativeRunAttempts.length,
      candidateRecordCount: recordsForCampaign.size,
      assessmentOccurrenceCount: assessmentCount,
      candidateVerificationRequestCount: requests.length,
      usage: usage(view.nativeRuns),
    });
  }

  const unboundVerification = [...verificationViews.keys()].find(
    (requestId) => !consumedVerificationRequests.has(requestId),
  );
  if (unboundVerification !== undefined) {
    throw new Error(
      `Independent Trial comparison received an unbound Candidate Verification view: ${unboundVerification}`,
    );
  }

  const body = independentResearchTrialComparisonBodySchema.parse({
    kind: "independent-research-trial-comparison",
    schemaVersion: 1,
    comparisonId: request.comparisonId,
    requestDigest: request.digest,
    expectedBindingDigest: request.expectedBinding.digest,
    summary: {
      plannedTrials: request.trialCampaignIds.length,
      modelCompletedTrials: trials.filter(
        (trial) => trial.state === "model-completed",
      ).length,
      incompleteTrials: trials.filter((trial) => trial.state === "incomplete")
        .length,
      incompatibleTrials: trials.filter(
        (trial) => trial.state === "incompatible",
      ).length,
      compatibleCandidateRecords: candidateRecords.filter(
        (record) => record.compatible,
      ).length,
      compatibleAssessmentOccurrences: assessmentOccurrences.filter(
        (occurrence) => occurrence.compatible,
      ).length,
    },
    compatibleUsage: usage(compatibleReceipts),
    trials,
    candidateRecords,
    assessmentOccurrences,
    verificationOutcomes,
  });
  return independentResearchTrialComparisonSchema.parse({
    ...body,
    digest: canonicalDigest(body),
  });
}
