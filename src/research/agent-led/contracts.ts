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

const agentRuntimeProfileSchema = z.strictObject({
  id: identifierSchema,
  kind: z.string().min(1).max(128),
  executableVersion: z.string().min(1).max(128),
  model: z.string().min(1).max(128),
  effort: z.string().min(1).max(64),
  digest: digestSchema,
});

const budgetEnvelopeSchema = z.strictObject({
  id: identifierSchema,
  maxNativeRuns: z.number().int().positive(),
  maxWallTimeMs: z.number().int().positive(),
  maxEstimatedCostUsd: z.number().positive(),
  digest: digestSchema,
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
  maxEstimatedCostUsd: z.number().positive(),
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
});

export const campaignInputSchema = z
  .strictObject({
    kind: z.literal("agent-led-campaign"),
    schemaVersion: z.literal(1),
    campaignId: identifierSchema,
    targetSnapshot: targetSnapshotRefSchema,
    dependencySnapshots: dependencySnapshotsSchema.optional(),
    threatContext: campaignThreatContextSchema.optional(),
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
      checkpoint.threatContextDigest !== input.threatContext?.digest
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

export const validationCandidateSchema = z.strictObject({
  candidateId: identifierSchema,
  attackerPremise: z.string().min(1),
  brokenSecurityProperty: z.string().min(1),
  claim: z.string().min(1),
  evidence: z.array(sourceEvidenceSchema).min(1),
});

const nextActionSchema = z.strictObject({
  question: z.string().min(1),
  sourcePointers: z.array(z.string().min(1)),
});

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
    failure: z.strictObject({ summary: z.string().min(1) }),
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
    failure: z.strictObject({ summary: z.string().min(1) }),
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
  promptSet: immutableRefSchema,
  agentRuntimeProfile: agentRuntimeProfileSchema,
  permissionProfile: immutableRefSchema,
  budgetEnvelope: budgetEnvelopeSchema,
  budgetAllowance: runBudgetAllowanceSchema,
  resumeFrom: agentCheckpointRefSchema.optional(),
  validationFeedback: z.array(
    z.strictObject({
      runId: identifierSchema,
      candidateId: identifierSchema,
      report: validationReportSchema,
    }),
  ),
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
  conduct(input: CampaignInput): Promise<CampaignOutcomeRef>;
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
  readonly findings: readonly SourceValidatedFinding[];
  readonly coverage: CampaignCoverage;
  readonly interruption?: CampaignInterruption;
}

export interface OpenResearchCampaignsOptions {
  readonly databasePath: string;
  readonly runtime: NativeAgentRuntime;
  readonly clock?: () => Date;
}

export type CampaignInput = z.infer<typeof campaignInputSchema>;
export type CampaignThreatContext = z.infer<typeof campaignThreatContextSchema>;
export type ResearchCampaignPolicy = z.infer<
  typeof researchCampaignPolicySchema
>;
export type DependencySnapshotRef = z.infer<typeof dependencySnapshotRefSchema>;
export type AgentCheckpointRef = z.infer<typeof agentCheckpointRefSchema>;
export type CampaignInterruption = z.infer<typeof campaignInterruptionSchema>;
export type NativeRunReceipt = z.infer<typeof nativeRunReceiptSchema>;
export type SealedNativeRun = z.infer<typeof sealedNativeRunSchema>;
export type SealedValidationRun = z.infer<typeof sealedValidationRunSchema>;
export type SealedAgentRun = SealedNativeRun | SealedValidationRun;
export type ValidationCandidate = z.infer<typeof validationCandidateSchema>;
export type ValidationRunReceipt = z.infer<typeof validationRunReceiptSchema>;
export type NativeAgentReceipt = NativeRunReceipt | ValidationRunReceipt;
export type SourceValidatedFinding = z.infer<
  typeof sourceValidatedFindingSchema
>;
