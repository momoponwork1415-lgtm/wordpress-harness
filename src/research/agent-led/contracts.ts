import { createHash } from "node:crypto";

import { z } from "zod";

const identifierSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);

const digestSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);

export function promptTextDigest(text: string): string {
  return `sha256:${createHash("sha256").update(text, "utf8").digest("hex")}`;
}

const immutableRefSchema = z.strictObject({
  id: identifierSchema,
  digest: digestSchema,
});

const targetSnapshotRefSchema = z.strictObject({
  id: identifierSchema,
  pluginSlug: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
  version: z.string().min(1).max(64),
  digest: digestSchema,
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

export const campaignInputSchema = z.strictObject({
  kind: z.literal("agent-led-campaign"),
  schemaVersion: z.literal(1),
  campaignId: identifierSchema,
  targetSnapshot: targetSnapshotRefSchema,
  promptSet: immutableRefSchema,
  validationPromptSet: immutableRefSchema,
  agentRuntimeProfile: agentRuntimeProfileSchema,
  permissionProfile: immutableRefSchema,
  budgetEnvelope: budgetEnvelopeSchema,
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

const nativeRunReceiptShape = {
  schemaVersion: z.literal(1),
  runId: identifierSchema,
  runtimeProfileDigest: digestSchema,
  startedAt: z.iso.datetime(),
  completedAt: z.iso.datetime(),
  usage: nativeRunUsageSchema,
  activity: nativeRunActivitySchema,
  isolation: z
    .strictObject({
      backend: z.literal("gvisor"),
      runtime: z.literal("runsc"),
      fallbackUsed: z.literal(false),
    })
    .optional(),
};

export const nativeRunReceiptSchema = z.discriminatedUnion("terminal", [
  z.strictObject({
    ...nativeRunReceiptShape,
    terminal: z.literal("completed"),
    report: researchReportSchema,
  }),
  z.strictObject({
    ...nativeRunReceiptShape,
    terminal: z.enum([
      "provider-failed",
      "budget-exhausted",
      "policy-denied",
      "invalid-output",
    ]),
    failure: z.strictObject({ summary: z.string().min(1) }),
  }),
]);

export const validationRunReceiptSchema = z.discriminatedUnion("terminal", [
  z.strictObject({
    ...nativeRunReceiptShape,
    terminal: z.literal("completed"),
    report: validationReportSchema,
  }),
  z.strictObject({
    ...nativeRunReceiptShape,
    terminal: z.enum([
      "provider-failed",
      "budget-exhausted",
      "policy-denied",
      "invalid-output",
    ]),
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
  promptSet: immutableRefSchema,
  agentRuntimeProfile: agentRuntimeProfileSchema,
  permissionProfile: immutableRefSchema,
  budgetEnvelope: budgetEnvelopeSchema,
  history: z.array(
    z.strictObject({
      runId: identifierSchema,
      report: researchReportSchema,
    }),
  ),
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
  promptSet: immutableRefSchema,
  agentRuntimeProfile: agentRuntimeProfileSchema,
  permissionProfile: immutableRefSchema,
  budgetEnvelope: budgetEnvelopeSchema,
  candidate: validationCandidateSchema,
});

export const sealedAgentRunSchema = z.discriminatedUnion("kind", [
  sealedNativeRunSchema,
  sealedValidationRunSchema,
]);

export const campaignStatusSchema = z.enum([
  "research-continues",
  "validation-pending",
  "coverage-closed",
  "incomplete",
]);

export const campaignInterruptionSchema = z.strictObject({
  reason: z.enum([
    "budget-exhausted",
    "provider-failed",
    "policy-denied",
    "invalid-output",
  ]),
  summary: z.string().min(1),
});

export const sourceValidatedFindingSchema = z.strictObject({
  kind: z.literal("source-validated-finding"),
  schemaVersion: z.literal(1),
  findingId: z.string().min(1).max(512),
  candidateId: identifierSchema,
  targetSnapshot: targetSnapshotRefSchema,
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

export const campaignCoverageSchema = z.strictObject({
  status: z.enum(["open", "closed", "incomplete"]),
});

export interface ValidationRunRecord {
  readonly candidateId: string;
  readonly receipt: ValidationRunReceipt;
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
export type CampaignInterruption = z.infer<typeof campaignInterruptionSchema>;
export type CampaignStatus = z.infer<typeof campaignStatusSchema>;
export type NativeRunReceipt = z.infer<typeof nativeRunReceiptSchema>;
export type ResearchReport = z.infer<typeof researchReportSchema>;
export type SealedNativeRun = z.infer<typeof sealedNativeRunSchema>;
export type SealedValidationRun = z.infer<typeof sealedValidationRunSchema>;
export type SealedAgentRun = z.infer<typeof sealedAgentRunSchema>;
export type ValidationCandidate = z.infer<typeof validationCandidateSchema>;
export type ValidationReport = z.infer<typeof validationReportSchema>;
export type ValidationRunReceipt = z.infer<typeof validationRunReceiptSchema>;
export type NativeAgentReceipt = NativeRunReceipt | ValidationRunReceipt;
export type SourceValidatedFinding = z.infer<
  typeof sourceValidatedFindingSchema
>;
export type CampaignCoverage = z.infer<typeof campaignCoverageSchema>;
