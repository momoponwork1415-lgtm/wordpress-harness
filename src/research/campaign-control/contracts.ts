import { z } from "zod";

import type { TargetSnapshotRef } from "../contracts.js";
import {
  explorationPolicyRefSchema,
  type FocusArea,
  type WorkLease,
  type WorkWavePlan,
} from "../exploration/contracts.js";
import {
  attemptPlanSchema,
  type ModelExecution,
} from "../model-execution/contracts.js";
import type { JsonArtifactStore } from "../research-record/contracts.js";
import {
  surfaceMapRefSchema,
  type SurfaceMap,
} from "../source-mapping/contracts.js";
import {
  labBaselineRefSchema,
  verificationRecordRefSchema,
  type IndependentVerifier,
  type LabControl,
} from "../verification/contracts.js";

const identifierSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
const digestSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);

const immutableRef = <Kind extends string>(kind: Kind) =>
  z.strictObject({
    kind: z.literal(kind),
    schemaVersion: z.literal(1),
    id: identifierSchema,
    digest: digestSchema,
  });

const modelProfileRefSchema = immutableRef("model-profile").extend({
  family: identifierSchema,
});

const promptSetRefSchema = immutableRef("prompt-set");
const verificationPolicyRefSchema = immutableRef("verification-policy");
const experimentRegistryRefSchema = immutableRef("experiment-registry");
const iterationPolicyRefSchema = immutableRef("iteration-policy");
const calibrationContextRefSchema = immutableRef("calibration-context");

export const finderAttemptMaterializationSchema = z.strictObject({
  kind: z.literal("finder-attempt-materialization"),
  schemaVersion: z.literal(1),
  modelProfile: attemptPlanSchema.shape.modelProfile,
  prompt: attemptPlanSchema.shape.prompt,
  maxOutputBytes: z.number().int().positive(),
});

export const campaignRunPlanSchema = z.strictObject({
  kind: z.literal("campaign-run-plan"),
  schemaVersion: z.literal(1),
  runId: identifierSchema,
  campaignId: identifierSchema,
  preparationDigest: digestSchema,
  surfaceMap: surfaceMapRefSchema,
  explorationPolicy: explorationPolicyRefSchema,
  finder: z.strictObject({
    modelProfile: modelProfileRefSchema,
    promptSet: promptSetRefSchema,
  }),
  verification: z.strictObject({
    labBaseline: labBaselineRefSchema,
    verifierModelProfile: modelProfileRefSchema,
    promptSet: promptSetRefSchema,
    verificationPolicy: verificationPolicyRefSchema,
    experimentRegistry: experimentRegistryRefSchema,
  }),
  budget: z.strictObject({
    maxWallTimeMs: z.number().int().positive(),
    maxModelTokens: z.number().int().positive(),
    maxFinderAttempts: z.number().int().min(1).max(3),
    verification: z.strictObject({
      maxVerifierAttempts: z.number().int().positive(),
      maxExperiments: z.number().int().min(2),
      maxWallTimeMs: z.number().int().positive(),
    }),
  }),
  iterationPolicy: iterationPolicyRefSchema,
  calibrationContext: calibrationContextRefSchema.optional(),
});

const blockedCapabilityReasonSchema = z.enum([
  "mapping-incomplete",
  "no-source-bound-hypothesis",
  "unsupported-attacker-premise",
  "verification-blocked",
]);

export const iterationDecisionSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("await-calibration"),
    terminalVerifications: z.array(verificationRecordRefSchema).min(1),
  }),
  z.strictObject({
    kind: z.literal("continue-unresolved-work"),
    next: z.strictObject({
      kind: z.literal("finite-work"),
      schemaVersion: z.literal(1),
      digest: digestSchema,
    }),
  }),
  z.strictObject({
    kind: z.literal("blocked-capability"),
    reasons: z.array(blockedCapabilityReasonSchema).min(1),
  }),
]);

const workWaveRefSchema = z.strictObject({
  kind: z.literal("work-wave"),
  schemaVersion: z.literal(1),
  id: digestSchema,
  digest: digestSchema,
  mapDigest: digestSchema,
});

const attemptExecutionResultRefSchema = z.strictObject({
  kind: z.literal("attempt-execution-result"),
  schemaVersion: z.literal(1),
  attemptId: identifierSchema,
  leaseId: digestSchema,
  digest: digestSchema,
});

const campaignAttemptIdentityFields = {
  campaignId: identifierSchema,
  runId: identifierSchema,
  attemptId: identifierSchema,
  leaseId: digestSchema,
  ordinal: z.number().int().positive(),
  workWaveDigest: digestSchema,
};

export const campaignAttemptIntentSchema = z.discriminatedUnion("mode", [
  z.strictObject({
    kind: z.literal("campaign-attempt-intent"),
    schemaVersion: z.literal(1),
    ...campaignAttemptIdentityFields,
    mode: z.literal("execute"),
    attemptPlanDigest: digestSchema,
  }),
  z.strictObject({
    kind: z.literal("campaign-attempt-intent"),
    schemaVersion: z.literal(1),
    ...campaignAttemptIdentityFields,
    mode: z.literal("cancel"),
    reason: z.literal("campaign-finder-attempt-limit"),
  }),
]);

export const campaignAttemptCompletionSchema = z.strictObject({
  kind: z.literal("campaign-attempt-completion"),
  schemaVersion: z.literal(1),
  ...campaignAttemptIdentityFields,
  result: attemptExecutionResultRefSchema,
});

const campaignRunIdentityFields = {
  runId: identifierSchema,
  campaignId: identifierSchema,
  planDigest: digestSchema,
};

export const campaignRunCompletionInputSchema = z.strictObject({
  kind: z.literal("campaign-run-completion"),
  schemaVersion: z.literal(1),
  ...campaignRunIdentityFields,
  workWave: workWaveRefSchema,
  attempts: z.array(attemptExecutionResultRefSchema).min(1),
  verifications: z.array(verificationRecordRefSchema),
  decision: iterationDecisionSchema,
});

export const campaignRunRecordSchema = z.strictObject({
  kind: z.literal("campaign-run-record"),
  schemaVersion: z.literal(1),
  ...campaignRunIdentityFields,
  workWave: workWaveRefSchema,
  attempts: z.array(attemptExecutionResultRefSchema).min(1),
  verifications: z.array(verificationRecordRefSchema),
  decision: iterationDecisionSchema,
  completedAt: z.string().datetime(),
});

export const campaignRunRecordRefSchema = z.strictObject({
  kind: z.literal("campaign-run-record"),
  schemaVersion: z.literal(1),
  runId: identifierSchema,
  digest: digestSchema,
  decision: z.enum([
    "await-calibration",
    "continue-unresolved-work",
    "blocked-capability",
  ]),
});

export type CampaignRunPlan = z.infer<typeof campaignRunPlanSchema>;
export type CampaignRunCompletionInput = z.infer<
  typeof campaignRunCompletionInputSchema
>;
export type CampaignRunRecord = z.infer<typeof campaignRunRecordSchema>;
export type CampaignRunRecordRef = z.infer<typeof campaignRunRecordRefSchema>;
export type IterationDecision = z.infer<typeof iterationDecisionSchema>;
export type FinderAttemptMaterialization = z.infer<
  typeof finderAttemptMaterializationSchema
>;
export type CampaignAttemptIntent = z.infer<typeof campaignAttemptIntentSchema>;
export type CampaignAttemptCompletion = z.infer<
  typeof campaignAttemptCompletionSchema
>;

export interface CampaignAttemptRecordView {
  readonly ledgerHead: number;
  readonly occurredAt: string;
  readonly intent: CampaignAttemptIntent;
  readonly completion?: {
    readonly ledgerHead: number;
    readonly occurredAt: string;
    readonly value: CampaignAttemptCompletion;
  };
}

export interface CampaignRunRecordView {
  readonly ledgerHead: number;
  readonly occurredAt: string;
  readonly ref: CampaignRunRecordRef;
  readonly value: CampaignRunRecord;
}

export interface AttemptPlanMaterializationInput {
  readonly run: {
    readonly runId: string;
    readonly finder: CampaignRunPlan["finder"];
    readonly maxWallTimeMs: number;
    readonly maxModelTokens: number;
  };
  readonly attemptOrdinal: number;
  readonly targetSnapshot: TargetSnapshotRef;
  readonly surfaceMap: SurfaceMap;
  readonly wave: WorkWavePlan;
  readonly focusArea: FocusArea;
  readonly lease: WorkLease;
}

export interface AttemptPlanMaterializer {
  materialize(
    input: AttemptPlanMaterializationInput,
  ): Promise<FinderAttemptMaterialization>;
}

export interface CampaignExecutionDependencies {
  readonly artifactStore: JsonArtifactStore;
  readonly attemptPlanMaterializer: AttemptPlanMaterializer;
  readonly modelExecution: ModelExecution;
  readonly independentVerifier: IndependentVerifier;
  readonly labControl: LabControl;
}

export class CampaignRunConflictError extends Error {
  readonly campaignId: string;
  readonly runId: string;

  constructor(campaignId: string, runId: string) {
    super(
      `Campaign run already exists with different input: ${campaignId}/${runId}`,
    );
    this.name = "CampaignRunConflictError";
    this.campaignId = campaignId;
    this.runId = runId;
  }
}
