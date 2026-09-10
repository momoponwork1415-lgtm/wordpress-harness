import { z } from "zod";

import { canonicalDigest } from "../../infrastructure/canonical-json.js";

const identifierSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);

const digestSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);

const immutableRefSchema = z.strictObject({
  id: identifierSchema,
  digest: digestSchema,
});

const targetSnapshotRefSchema = z.strictObject({
  id: identifierSchema,
  pluginSlug: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
  version: z.string().min(1).max(64),
  digest: digestSchema,
  sourceTree: z.strictObject({
    digest: digestSchema,
    entries: z.number().int().positive(),
    bytes: z.number().int().nonnegative(),
  }),
});

export const dependencySnapshotRefSchema = z.strictObject({
  id: identifierSchema,
  mountName: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
  version: z.string().min(1).max(64),
  digest: digestSchema,
  sourceTree: z.strictObject({
    digest: digestSchema,
    entries: z.number().int().positive(),
    bytes: z.number().int().nonnegative(),
  }),
});

export const dependencySnapshotsSchema = z
  .array(dependencySnapshotRefSchema)
  .max(16)
  .superRefine((snapshots, context) => {
    const ids = new Set<string>();
    const mounts = new Set<string>();
    for (const [index, snapshot] of snapshots.entries()) {
      if (ids.has(snapshot.id)) {
        context.addIssue({
          code: "custom",
          message: "Dependency Snapshot ids must be unique",
          path: [index, "id"],
        });
      }
      if (mounts.has(snapshot.mountName)) {
        context.addIssue({
          code: "custom",
          message: "Dependency Snapshot mount names must be unique",
          path: [index, "mountName"],
        });
      }
      ids.add(snapshot.id);
      mounts.add(snapshot.mountName);
    }
  });

const threatContextTextSchema = z.string().min(1).max(1_200);
const threatContextListSchema = z.array(threatContextTextSchema).min(1).max(16);

export const campaignThreatContextDependencyRoleSchema = z.strictObject({
  mountName: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
  role: z.enum([
    "wordpress-core",
    "required-companion",
    "active-companion",
    "runtime-library",
    "protocol-reference",
  ]),
  relevance: threatContextTextSchema,
});

const campaignThreatContextBodySchema = z.strictObject({
  kind: z.literal("campaign-threat-context"),
  schemaVersion: z.literal(1),
  id: identifierSchema,
  whyThisTarget: threatContextTextSchema,
  ordinaryConfiguration: threatContextTextSchema,
  attackerPositions: threatContextListSchema,
  securityObjectives: threatContextListSchema,
  trustBoundaries: threatContextListSchema,
  highValueTransitions: threatContextListSchema,
  dependencyRoles: z.array(campaignThreatContextDependencyRoleSchema).max(16),
  uncertainties: z.array(threatContextTextSchema).max(16),
  explorationFreedom: z.literal("off-model-findings-allowed"),
});

export const campaignThreatContextSchema = campaignThreatContextBodySchema
  .extend({ digest: digestSchema })
  .superRefine((threatContext, context) => {
    const { digest, ...body } = threatContext;
    if (digest !== canonicalDigest(body)) {
      context.addIssue({
        code: "custom",
        path: ["digest"],
        message: "Campaign Threat Context digest must bind its exact body",
      });
    }
    const mountNames = new Set<string>();
    for (const [index, dependency] of threatContext.dependencyRoles.entries()) {
      if (mountNames.has(dependency.mountName)) {
        context.addIssue({
          code: "custom",
          path: ["dependencyRoles", index, "mountName"],
          message: "Campaign Threat Context dependency mounts must be unique",
        });
      }
      mountNames.add(dependency.mountName);
    }
  });

const programmeBoundaryTextSchema = z.string().min(1).max(1_200);
const programmeBoundaryListSchema = z
  .array(programmeBoundaryTextSchema)
  .min(1)
  .max(64);

const programmeResearchBoundaryBodySchema = z.strictObject({
  kind: z.literal("programme-research-boundary"),
  schemaVersion: z.literal(1),
  id: identifierSchema,
  programmeIdentity: identifierSchema,
  checkedAt: z.iso.datetime(),
  eligibleAttackerPositions: programmeBoundaryListSchema,
  priorityImpacts: programmeBoundaryListSchema,
  explicitExclusions: z.array(programmeBoundaryTextSchema).max(64),
  excludedAssets: z.array(programmeBoundaryTextSchema).max(64),
  sourceRefs: z.array(immutableRefSchema).min(1).max(16),
  uncertainties: z.array(programmeBoundaryTextSchema).max(16),
  handling: z.strictObject({
    sourceProvenExcluded: z.literal("park"),
    concreteEligibleEscalation: z.literal("continue"),
    scopeAmbiguity: z.literal("human-challenge"),
  }),
});

export const programmeResearchBoundarySchema =
  programmeResearchBoundaryBodySchema
    .extend({ digest: digestSchema })
    .superRefine((boundary, context) => {
      const { digest, ...body } = boundary;
      if (digest !== canonicalDigest(body)) {
        context.addIssue({
          code: "custom",
          path: ["digest"],
          message:
            "Programme Research Boundary digest must bind its exact body",
        });
      }
      const sourceIds = new Set<string>();
      for (const [index, source] of boundary.sourceRefs.entries()) {
        if (sourceIds.has(source.id)) {
          context.addIssue({
            code: "custom",
            path: ["sourceRefs", index, "id"],
            message: "Programme Research Boundary source ids must be unique",
          });
        }
        sourceIds.add(source.id);
      }
    });

const agentRuntimeProfileSchema = z.strictObject({
  id: identifierSchema,
  kind: z.string().min(1).max(128),
  executableVersion: z.string().min(1).max(128),
  model: z.string().min(1).max(128),
  effort: z.string().min(1).max(64),
  digest: digestSchema,
});

const budgetEnvelopeSchema = z
  .strictObject({
    id: identifierSchema,
    maxNativeRuns: z.number().int().positive(),
    maxWallTimeMs: z.number().int().positive(),
    researchGrantWallTimeMs: z.number().int().positive().max(3_600_000),
    digest: digestSchema,
  })
  .refine((budget) => budget.researchGrantWallTimeMs <= budget.maxWallTimeMs, {
    path: ["researchGrantWallTimeMs"],
    message: "Research Grant cannot exceed the Campaign wall-time limit",
  });

const researchCampaignPolicyBodySchema = z.strictObject({
  kind: z.literal("research-campaign-policy"),
  schemaVersion: z.literal(1),
  id: identifierSchema,
  promptSet: immutableRefSchema,
  validationPromptSet: immutableRefSchema,
  agentRuntimeProfile: agentRuntimeProfileSchema,
  permissionProfile: immutableRefSchema,
  budgetEnvelope: budgetEnvelopeSchema,
});

export const researchCampaignPolicySchema = researchCampaignPolicyBodySchema
  .extend({ digest: digestSchema })
  .superRefine((policy, context) => {
    const { digest, ...body } = policy;
    if (digest !== canonicalDigest(body)) {
      context.addIssue({
        code: "custom",
        path: ["digest"],
        message: "Research Campaign Policy digest must bind its exact body",
      });
    }
  });

const runBudgetAllowanceSchema = z.strictObject({
  maxWallTimeMs: z.number().int().positive(),
});

export const agentCheckpointRefSchema = z.strictObject({
  kind: z.literal("agent-checkpoint"),
  schemaVersion: z.literal(1),
  checkpointId: identifierSchema,
  stateDigest: digestSchema,
  stateEntries: z.number().int().positive(),
  stateBytes: z.number().int().nonnegative(),
  sessionId: z.uuid(),
  targetSnapshotDigest: digestSchema,
  promptSetDigest: digestSchema,
  runtimeProfileDigest: digestSchema,
  permissionProfileDigest: digestSchema,
  dependencySnapshotsDigest: digestSchema.optional(),
  threatContextDigest: digestSchema.optional(),
  programmeBoundaryDigest: digestSchema.optional(),
});

export const campaignInputSchema = z
  .strictObject({
    kind: z.literal("agent-led-campaign"),
    schemaVersion: z.literal(1),
    campaignId: identifierSchema,
    targetSnapshot: targetSnapshotRefSchema,
    dependencySnapshots: dependencySnapshotsSchema.optional(),
    threatContext: campaignThreatContextSchema.optional(),
    programmeBoundary: programmeResearchBoundarySchema.optional(),
    promptSet: immutableRefSchema,
    validationPromptSet: immutableRefSchema,
    agentRuntimeProfile: agentRuntimeProfileSchema,
    permissionProfile: immutableRefSchema,
    budgetEnvelope: budgetEnvelopeSchema,
    resumeFrom: agentCheckpointRefSchema.optional(),
  })
  .superRefine((input, context) => {
    if (input.threatContext !== undefined) {
      const snapshotMounts = new Set(
        (input.dependencySnapshots ?? []).map(
          (dependency) => dependency.mountName,
        ),
      );
      const contextMounts = new Set(
        input.threatContext.dependencyRoles.map(
          (dependency) => dependency.mountName,
        ),
      );
      if (
        snapshotMounts.size !== contextMounts.size ||
        [...snapshotMounts].some((mountName) => !contextMounts.has(mountName))
      ) {
        context.addIssue({
          code: "custom",
          message:
            "Campaign Threat Context must describe every Dependency Snapshot exactly once",
          path: ["threatContext", "dependencyRoles"],
        });
      }
    }
    const checkpoint = input.resumeFrom;
    if (checkpoint === undefined) return;
    const dependencySnapshots = input.dependencySnapshots ?? [];
    const dependencySnapshotsDigest =
      dependencySnapshots.length === 0
        ? undefined
        : canonicalDigest(dependencySnapshots);
    if (
      checkpoint.targetSnapshotDigest !== input.targetSnapshot.digest ||
      checkpoint.promptSetDigest !== input.promptSet.digest ||
      checkpoint.runtimeProfileDigest !== input.agentRuntimeProfile.digest ||
      checkpoint.permissionProfileDigest !== input.permissionProfile.digest ||
      checkpoint.dependencySnapshotsDigest !== dependencySnapshotsDigest ||
      checkpoint.threatContextDigest !== input.threatContext?.digest ||
      checkpoint.programmeBoundaryDigest !== input.programmeBoundary?.digest
    ) {
      context.addIssue({
        code: "custom",
        message: "Agent Checkpoint does not match the Campaign binding",
        path: ["resumeFrom"],
      });
    }
  });

const sourceEvidenceSchema = z.strictObject({
  path: z.string().min(1),
  location: z.string().min(1),
  observation: z.string().min(1),
});

export const parkedProgrammeLeadSchema = z.strictObject({
  leadId: identifierSchema,
  attackerPremise: z.string().min(1),
  primitive: z.string().min(1),
  maximumSourceSupportedEffect: z.string().min(1),
  eligibleEscalationAssessment: z.literal("no-concrete-source-bound-path"),
  evidence: z.array(sourceEvidenceSchema).min(1),
});

export const validationCandidateSchema = z.strictObject({
  candidateId: identifierSchema,
  attackerPremise: z.string().min(1),
  brokenSecurityProperty: z.string().min(1),
  claim: z.string().min(1),
  evidence: z.array(sourceEvidenceSchema).min(1),
});

export const candidateReviewRequestSchema = z
  .strictObject({
    kind: z.literal("candidate-review-request"),
    schemaVersion: z.literal(1),
    campaignId: identifierSchema,
    campaignInputDigest: digestSchema,
    terminalResearchRunId: identifierSchema,
    candidateSetDigest: digestSchema,
    candidates: z.array(validationCandidateSchema).min(1),
    digest: digestSchema,
  })
  .superRefine((request, context) => {
    const { digest, candidateSetDigest, candidates, ...body } = request;
    if (candidateSetDigest !== canonicalDigest(candidates)) {
      context.addIssue({
        code: "custom",
        path: ["candidateSetDigest"],
        message: "Candidate review request must bind the exact Candidate set",
      });
    }
    if (
      digest !== canonicalDigest({ ...body, candidateSetDigest, candidates })
    ) {
      context.addIssue({
        code: "custom",
        path: ["digest"],
        message: "Candidate review request digest must bind its exact body",
      });
    }
  });

const nextActionSchema = z.strictObject({
  question: z.string().min(1),
  sourcePointers: z.array(z.string().min(1)),
});

export const researchContinuationReviewRequestSchema = z
  .strictObject({
    kind: z.literal("research-continuation-review-request"),
    schemaVersion: z.literal(1),
    campaignId: identifierSchema,
    campaignInputDigest: digestSchema,
    researchRunId: identifierSchema,
    checkpoint: agentCheckpointRefSchema,
    candidateSetDigest: digestSchema,
    candidates: z.array(validationCandidateSchema),
    parkedProgrammeLeadSetDigest: digestSchema,
    parkedProgrammeLeads: z.array(parkedProgrammeLeadSchema),
    nextActions: z.array(nextActionSchema).min(1),
    digest: digestSchema,
  })
  .superRefine((request, context) => {
    const {
      digest,
      candidateSetDigest,
      candidates,
      parkedProgrammeLeadSetDigest,
      parkedProgrammeLeads,
      ...body
    } = request;
    if (candidateSetDigest !== canonicalDigest(candidates)) {
      context.addIssue({
        code: "custom",
        path: ["candidateSetDigest"],
        message:
          "Research continuation review request must bind the exact Candidate set",
      });
    }
    if (
      parkedProgrammeLeadSetDigest !== canonicalDigest(parkedProgrammeLeads)
    ) {
      context.addIssue({
        code: "custom",
        path: ["parkedProgrammeLeadSetDigest"],
        message:
          "Research continuation review request must bind the exact parked Programme Lead set",
      });
    }
    if (
      digest !==
      canonicalDigest({
        ...body,
        candidateSetDigest,
        candidates,
        parkedProgrammeLeadSetDigest,
        parkedProgrammeLeads,
      })
    ) {
      context.addIssue({
        code: "custom",
        path: ["digest"],
        message:
          "Research continuation review request digest must bind its exact body",
      });
    }
  });

const humanCandidateReviewDecisionSchema = z.discriminatedUnion("disposition", [
  z.strictObject({
    candidateId: identifierSchema,
    disposition: z.literal("advance-to-independent-validation"),
    reason: z.string().min(1).max(4_000),
  }),
  z.strictObject({
    candidateId: identifierSchema,
    disposition: z.literal("return-to-research"),
    reason: z.string().min(1).max(4_000),
    nextActions: z.array(nextActionSchema).min(1).max(32),
  }),
  z.strictObject({
    candidateId: identifierSchema,
    disposition: z.literal("park-programme-oos"),
    reason: z.string().min(1).max(4_000),
  }),
  z.strictObject({
    candidateId: identifierSchema,
    disposition: z.literal("hold-scope-ambiguous"),
    reason: z.string().min(1).max(4_000),
  }),
]);

const humanCandidateReviewBodySchema = z.strictObject({
  kind: z.literal("human-candidate-review"),
  schemaVersion: z.literal(1),
  reviewId: identifierSchema,
  campaignId: identifierSchema,
  campaignInputDigest: digestSchema,
  terminalResearchRunId: identifierSchema,
  candidateSetDigest: digestSchema,
  candidateReviewRequestDigest: digestSchema,
  operator: z.strictObject({
    identity: identifierSchema,
    decidedAt: z.iso.datetime(),
  }),
  decisions: z.array(humanCandidateReviewDecisionSchema).min(1),
});

export const humanCandidateReviewSchema = humanCandidateReviewBodySchema
  .extend({ digest: digestSchema })
  .superRefine((review, context) => {
    const { digest, ...body } = review;
    if (digest !== canonicalDigest(body)) {
      context.addIssue({
        code: "custom",
        path: ["digest"],
        message: "Human Candidate Review digest must bind its exact body",
      });
    }
    const candidateIds = new Set<string>();
    for (const [index, decision] of review.decisions.entries()) {
      if (candidateIds.has(decision.candidateId)) {
        context.addIssue({
          code: "custom",
          path: ["decisions", index, "candidateId"],
          message: "Human Candidate Review decisions must be unique",
        });
      }
      candidateIds.add(decision.candidateId);
    }
  });

const humanResearchContinuationReviewBodySchema = z.strictObject({
  kind: z.literal("human-research-continuation-review"),
  schemaVersion: z.literal(1),
  reviewId: identifierSchema,
  campaignId: identifierSchema,
  campaignInputDigest: digestSchema,
  researchRunId: identifierSchema,
  checkpointId: identifierSchema,
  checkpointStateDigest: digestSchema,
  candidateSetDigest: digestSchema,
  parkedProgrammeLeadSetDigest: digestSchema,
  researchContinuationReviewRequestDigest: digestSchema,
  operator: z.strictObject({
    identity: identifierSchema,
    decidedAt: z.iso.datetime(),
  }),
  decision: z.enum(["continue-research", "proceed-to-candidate-review"]),
  reason: z.string().min(1).max(4_000),
});

export const humanResearchContinuationReviewSchema =
  humanResearchContinuationReviewBodySchema
    .extend({ digest: digestSchema })
    .superRefine((review, context) => {
      const { digest, ...body } = review;
      if (digest !== canonicalDigest(body)) {
        context.addIssue({
          code: "custom",
          path: ["digest"],
          message:
            "Human Research Continuation Review digest must bind its exact body",
        });
      }
    });

const humanValidationRetryBodySchema = z.strictObject({
  kind: z.literal("human-validation-retry"),
  schemaVersion: z.literal(1),
  retryId: identifierSchema,
  campaignId: identifierSchema,
  campaignInputDigest: digestSchema,
  failedValidationRunIds: z.array(identifierSchema).min(1).max(64),
  operator: z.strictObject({
    identity: identifierSchema,
    decidedAt: z.iso.datetime(),
  }),
  reason: z.string().min(1).max(4_000),
});

export const humanValidationRetrySchema = humanValidationRetryBodySchema
  .extend({ digest: digestSchema })
  .superRefine((retry, context) => {
    const { digest, ...body } = retry;
    if (digest !== canonicalDigest(body)) {
      context.addIssue({
        code: "custom",
        path: ["digest"],
        message: "Human Validation Retry digest must bind its exact body",
      });
    }
    const runIds = new Set<string>();
    for (const [index, runId] of retry.failedValidationRunIds.entries()) {
      if (runIds.has(runId)) {
        context.addIssue({
          code: "custom",
          path: ["failedValidationRunIds", index],
          message: "Human Validation Retry run ids must be unique",
        });
      }
      runIds.add(runId);
    }
  });

export const campaignCommandSchema = z.discriminatedUnion("kind", [
  campaignInputSchema,
  humanCandidateReviewSchema,
  humanResearchContinuationReviewSchema,
  humanValidationRetrySchema,
]);

const researchDecisionSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("continue"),
    reason: z.string().min(1),
    nextActions: z.array(nextActionSchema).min(1),
  }),
  z.strictObject({
    kind: z.literal("stop"),
    basis: z.string().min(1),
  }),
]);

export const researchReportSchema = z.strictObject({
  schemaVersion: z.literal(1),
  candidates: z.array(validationCandidateSchema),
  parkedProgrammeLeads: z.array(parkedProgrammeLeadSchema).optional(),
  decision: researchDecisionSchema,
});

export const validationReportSchema = z.discriminatedUnion("disposition", [
  z.strictObject({
    schemaVersion: z.literal(1),
    candidateId: identifierSchema,
    disposition: z.literal("source-validated"),
    reason: z.string().min(1),
    evidence: z.array(sourceEvidenceSchema).min(1),
  }),
  z.strictObject({
    schemaVersion: z.literal(1),
    candidateId: identifierSchema,
    disposition: z.literal("needs-research"),
    reason: z.string().min(1),
    evidence: z.array(sourceEvidenceSchema),
    nextActions: z.array(nextActionSchema).min(1),
  }),
  z.strictObject({
    schemaVersion: z.literal(1),
    candidateId: identifierSchema,
    disposition: z.literal("disproven"),
    reason: z.string().min(1),
    evidence: z.array(sourceEvidenceSchema).min(1),
  }),
  z.strictObject({
    schemaVersion: z.literal(1),
    candidateId: identifierSchema,
    disposition: z.literal("validation-pending"),
    reason: z.string().min(1),
    evidence: z.array(sourceEvidenceSchema),
  }),
]);

const nativeRunUsageSchema = z.strictObject({
  wallTimeMs: z.number().int().nonnegative(),
  inputTokens: z.number().int().nonnegative().optional(),
  outputTokens: z.number().int().nonnegative().optional(),
  estimatedCostUsd: z.number().nonnegative().optional(),
});

const nativeRunActivitySchema = z.strictObject({
  subagents: z.number().int().nonnegative().nullable(),
  tools: z.array(z.string().min(1)).nullable(),
});

const agentRunIsolationSchema = z.strictObject({
  backend: z.literal("gvisor"),
  runtime: z.literal("runsc"),
  fallbackUsed: z.literal(false),
});

const agentRunFailureStageSchema = z.enum([
  "sandbox-preflight",
  "provider-version",
  "provider-execution",
  "checkpoint-finalization",
  "sandbox-cleanup",
  "runtime-adapter",
]);

export const agentRunDiagnosticRefSchema = z.strictObject({
  kind: z.literal("agent-run-diagnostic"),
  schemaVersion: z.literal(1),
  diagnosticId: identifierSchema,
  digest: digestSchema,
  bytes: z.number().int().nonnegative(),
});

const agentRunFailureSchema = z.strictObject({
  summary: z.string().min(1),
  stage: agentRunFailureStageSchema.optional(),
  retryable: z.literal(true).optional(),
  diagnostic: agentRunDiagnosticRefSchema.optional(),
});

const agentRunReceiptShape = {
  schemaVersion: z.literal(1),
  runId: identifierSchema,
  runtimeProfileDigest: digestSchema,
  startedAt: z.iso.datetime(),
  completedAt: z.iso.datetime(),
  usage: nativeRunUsageSchema,
  activity: nativeRunActivitySchema,
};

export const nativeRunReceiptSchema = z.discriminatedUnion("terminal", [
  z.strictObject({
    ...agentRunReceiptShape,
    terminal: z.literal("completed"),
    isolation: agentRunIsolationSchema,
    checkpoint: agentCheckpointRefSchema,
    report: researchReportSchema,
  }),
  z.strictObject({
    ...agentRunReceiptShape,
    terminal: z.enum([
      "provider-failed",
      "budget-exhausted",
      "policy-denied",
      "invalid-output",
    ]),
    isolation: agentRunIsolationSchema.optional(),
    checkpoint: agentCheckpointRefSchema.optional(),
    failure: agentRunFailureSchema,
  }),
]);

export const validationRunReceiptSchema = z.discriminatedUnion("terminal", [
  z.strictObject({
    ...agentRunReceiptShape,
    terminal: z.literal("completed"),
    isolation: agentRunIsolationSchema,
    report: validationReportSchema,
  }),
  z.strictObject({
    ...agentRunReceiptShape,
    terminal: z.enum([
      "provider-failed",
      "budget-exhausted",
      "policy-denied",
      "invalid-output",
    ]),
    isolation: agentRunIsolationSchema.optional(),
    failure: agentRunFailureSchema,
  }),
]);

export const sealedNativeRunSchema = z.strictObject({
  kind: z.literal("sealed-native-research-run"),
  schemaVersion: z.literal(1),
  runId: identifierSchema,
  campaignId: identifierSchema,
  campaignInputDigest: digestSchema,
  targetSnapshot: targetSnapshotRefSchema,
  dependencySnapshots: dependencySnapshotsSchema.optional(),
  threatContext: campaignThreatContextSchema.optional(),
  programmeBoundary: programmeResearchBoundarySchema.optional(),
  promptSet: immutableRefSchema,
  agentRuntimeProfile: agentRuntimeProfileSchema,
  permissionProfile: immutableRefSchema,
  budgetEnvelope: budgetEnvelopeSchema,
  budgetAllowance: runBudgetAllowanceSchema,
  resumeFrom: agentCheckpointRefSchema.optional(),
  researchContinuationNextActions: z
    .array(nextActionSchema)
    .min(1)
    .max(32)
    .optional(),
  validationFeedback: z.array(
    z.strictObject({
      runId: identifierSchema,
      candidateId: identifierSchema,
      report: validationReportSchema,
    }),
  ),
  candidateReviewNextActions: z
    .array(
      z.strictObject({
        candidateId: identifierSchema,
        nextActions: z.array(nextActionSchema).min(1).max(32),
      }),
    )
    .min(1)
    .optional(),
});

export const sealedValidationRunSchema = z.strictObject({
  kind: z.literal("sealed-native-validation-run"),
  schemaVersion: z.literal(1),
  runId: identifierSchema,
  campaignId: identifierSchema,
  campaignInputDigest: digestSchema,
  targetSnapshot: targetSnapshotRefSchema,
  dependencySnapshots: dependencySnapshotsSchema.optional(),
  promptSet: immutableRefSchema,
  agentRuntimeProfile: agentRuntimeProfileSchema,
  permissionProfile: immutableRefSchema,
  budgetEnvelope: budgetEnvelopeSchema,
  budgetAllowance: runBudgetAllowanceSchema,
  candidate: validationCandidateSchema,
});

export const campaignInterruptionSchema = z.strictObject({
  reason: z.literal("budget-exhausted"),
  summary: z.string().min(1),
});

export const sourceValidatedFindingSchema = z.strictObject({
  kind: z.literal("source-validated-finding"),
  schemaVersion: z.literal(1),
  findingId: z.string().min(1).max(512),
  candidateId: identifierSchema,
  targetSnapshot: targetSnapshotRefSchema,
  dependencySnapshots: dependencySnapshotsSchema.optional(),
  attackerPremise: z.string().min(1),
  brokenSecurityProperty: z.string().min(1),
  claim: z.string().min(1),
  assurance: z.literal("source-validated"),
  validation: z.strictObject({
    runId: identifierSchema,
    promptSet: immutableRefSchema,
    runtimeProfileDigest: digestSchema,
    permissionProfileDigest: digestSchema,
  }),
  evidence: z.array(sourceEvidenceSchema).min(1),
});

export interface ValidationRunRecord {
  readonly candidateId: string;
  readonly receipt: ValidationRunReceipt;
}

export type CampaignStatus =
  | "research-continues"
  | "research-review-pending"
  | "candidate-review-pending"
  | "validation-pending"
  | "coverage-closed"
  | "incomplete";

export interface CampaignCoverage {
  readonly status: "open" | "closed" | "incomplete";
}

export interface NativeAgentRuntime {
  execute(run: SealedAgentRun): Promise<NativeAgentReceipt>;
}

export interface ResearchCampaigns {
  conduct(command: CampaignCommand): Promise<CampaignOutcomeRef>;
  inspect(query: CampaignQuery): Promise<ResearchCampaignView>;
  close(): void;
}

export interface CampaignQuery {
  readonly campaignId: string;
}

export interface CampaignOutcomeRef {
  readonly kind: "agent-led-campaign-outcome";
  readonly schemaVersion: 1;
  readonly campaignId: string;
  readonly inputDigest: string;
  readonly status: CampaignStatus;
}

export interface ResearchCampaignView extends CampaignOutcomeRef {
  readonly input: CampaignInput;
  readonly nativeRuns: readonly NativeRunReceipt[];
  readonly validationRuns: readonly ValidationRunRecord[];
  readonly candidateReviews: readonly HumanCandidateReview[];
  readonly researchContinuationReviews: readonly HumanResearchContinuationReview[];
  readonly validationRetries?: readonly HumanValidationRetry[];
  readonly parkedProgrammeLeads: readonly ParkedProgrammeLead[];
  readonly findings: readonly SourceValidatedFinding[];
  readonly coverage: CampaignCoverage;
  readonly pendingCandidateReview?: CandidateReviewRequest;
  readonly pendingResearchContinuationReview?: ResearchContinuationReviewRequest;
  readonly interruption?: CampaignInterruption;
}

export interface OpenResearchCampaignsOptions {
  readonly databasePath: string;
  readonly runtime: NativeAgentRuntime;
  readonly clock?: () => Date;
}

export type CampaignInput = z.infer<typeof campaignInputSchema>;
export type CampaignCommand = z.infer<typeof campaignCommandSchema>;
export type CampaignThreatContext = z.infer<typeof campaignThreatContextSchema>;
export type ProgrammeResearchBoundary = z.infer<
  typeof programmeResearchBoundarySchema
>;
export type ResearchCampaignPolicy = z.infer<
  typeof researchCampaignPolicySchema
>;
export type DependencySnapshotRef = z.infer<typeof dependencySnapshotRefSchema>;
export type AgentCheckpointRef = z.infer<typeof agentCheckpointRefSchema>;
export type AgentRunDiagnosticRef = z.infer<typeof agentRunDiagnosticRefSchema>;
export type AgentRunFailureStage = z.infer<typeof agentRunFailureStageSchema>;
export type CampaignInterruption = z.infer<typeof campaignInterruptionSchema>;
export type NativeRunReceipt = z.infer<typeof nativeRunReceiptSchema>;
export type ParkedProgrammeLead = z.infer<typeof parkedProgrammeLeadSchema>;
export type SealedNativeRun = z.infer<typeof sealedNativeRunSchema>;
export type SealedValidationRun = z.infer<typeof sealedValidationRunSchema>;
export type SealedAgentRun = SealedNativeRun | SealedValidationRun;
export type ValidationCandidate = z.infer<typeof validationCandidateSchema>;
export type CandidateReviewRequest = z.infer<
  typeof candidateReviewRequestSchema
>;
export type HumanCandidateReview = z.infer<typeof humanCandidateReviewSchema>;
export type HumanResearchContinuationReview = z.infer<
  typeof humanResearchContinuationReviewSchema
>;
export type HumanValidationRetry = z.infer<typeof humanValidationRetrySchema>;
export type ResearchContinuationReviewRequest = z.infer<
  typeof researchContinuationReviewRequestSchema
>;
export type ValidationRunReceipt = z.infer<typeof validationRunReceiptSchema>;
export type NativeAgentReceipt = NativeRunReceipt | ValidationRunReceipt;
export type SourceValidatedFinding = z.infer<
  typeof sourceValidatedFindingSchema
>;
