import Database from "better-sqlite3";
import { z } from "zod";

import {
  LedgerIntegrityError,
  UnsupportedLedgerSchemaError,
  newCampaignInputSchema,
  newCampaignInputV1Schema,
  newCampaignInputV2Schema,
  newCampaignInputV3Schema,
  type NewCampaignInput,
} from "../contracts.js";
import {
  CampaignRunConflictError,
  RetiredSemanticBudgetPolicyError,
  campaignAttemptCompletionSchema,
  campaignAttemptCompletionV2Schema,
  campaignAttemptIntentSchema,
  campaignAttemptIntentV2Schema,
  campaignRunCompletionInputSchema,
  campaignRunCompletionInputV2Schema,
  campaignRunCompletionInputV3Schema,
  campaignRunPlanSchema,
  campaignRunPlanV2Schema,
  campaignRunPlanV3Schema,
  campaignRunRecordSchema,
  campaignRunRecordV2Schema,
  campaignRunRecordV3Schema,
  type AnyCampaignRunRecordView,
  type CampaignRunCompletionInput,
  type CampaignRunCompletionInputV2,
  type CampaignRunCompletionInputV3,
  type CampaignRunPlan,
  type CampaignRunPlanV2,
  type CampaignRunPlanV3,
  type DefaultSemanticCampaignRunPlanV2,
  type DefaultSemanticCampaignRunPlanV3,
  type CampaignRunRecordRef,
  type CampaignRunRecordRefV2,
  type CampaignRunRecordRefV3,
  type CampaignRunRecordView,
  type CampaignRunRecordViewV2,
  type CampaignRunRecordViewV3,
  type CampaignAttemptCompletion,
  type CampaignAttemptCompletionV2,
  type CampaignAttemptIntent,
  type CampaignAttemptIntentV2,
  type CampaignAttemptRecordView,
  type CampaignAttemptRecordViewV2,
} from "../campaign-control/contracts.js";
import {
  semanticFinderCheckpointRefSchema,
  iterationDecisionV2Schema,
  iterationDecisionV3Schema,
  type IterationDecisionV2,
  type IterationDecisionV3,
  type SemanticFinderCheckpointRef,
} from "../exploration/semantic-contracts.js";
import {
  approachFamilyRegistryRefSchema,
  approachFamilySchema,
  projectApproachFamilyRegistry,
  projectInitialApproachFamilies,
  referenceApproachFamily,
  referenceSemanticIterationDecision,
  semanticIterationDecisionRefSchema,
} from "../exploration/semantic-approach-family-registry.js";
import {
  approachFamilyRegistryRefV3Schema,
  approachFamilyV3Schema,
  projectApproachFamilyRegistryV3,
  projectInitialApproachFamilyRegistryV3,
  referenceApproachFamilyV3,
  referenceSemanticIterationDecisionV3,
  semanticIterationDecisionRefV3Schema,
} from "../exploration/semantic-approach-family-registry-v3.js";
import {
  attachApproachFamilyValidationIntentsV3,
  resolveApproachFamilyValidationV3,
} from "../exploration/semantic-approach-family-validation-v3.js";
import {
  advanceApproachFamilyRegistry,
  approachFamilyEvidenceAttachmentSchema,
  approachFamilyTransitionSchema,
  approachFamilyVerificationResolutionSchema,
  attachApproachFamilyEvidence,
  resolveApproachFamilyVerifications,
} from "../exploration/semantic-approach-family-transition.js";
import { chainSynthesisSchema } from "../exploration/semantic-chain-synthesis.js";
import {
  depthIterationDecisionRefSchema,
  depthIterationDecisionSchema,
  referenceDepthIterationDecision,
} from "../exploration/semantic-depth-evaluation.js";
import {
  referenceSemanticDepthWorkQueueV2,
  semanticDepthWorkQueueRefV2Schema,
  semanticDepthWorkQueueSchema,
  semanticDepthWorkQueueV2Schema,
} from "../exploration/semantic-depth-work-queue.js";
import {
  VerificationConflictError,
  verificationCompletionInputSchema,
  verificationPlanLedgerSchema,
  verificationPlanSchema,
  verificationRecordRefSchema,
  verificationRecordSchema,
  type VerificationCompletionInput,
  type VerificationPlan,
  type VerificationPlanLedgerValue,
  type VerificationRecordRef,
  type VerificationRecordView,
} from "../verification/contracts.js";
import {
  targetFileManifestRefSchema,
  type TargetFileManifestRef,
} from "../source-mapping/contracts.js";
import { projectTargetFileManifest } from "../source-mapping/target-file-manifest.js";
import type {
  CampaignProgressRole,
  CampaignProgressUsage,
  CampaignProgressView,
} from "../campaign-progress-contracts.js";
import { modelAttemptResultV2Schema } from "../model-execution/contracts.js";
import {
  referenceValidationCandidate,
  validationCandidateRefSchema,
  validationCandidateSchema,
  validationRecordRefSchema as sourceValidationRecordRefSchema,
  validationRecordSchema as sourceValidationRecordSchema,
  validationFrontierGapRefSchema,
  type ValidationCandidate,
  type ValidationRecordRef as SourceValidationRecordRef,
} from "../validation/contracts.js";
import { projectValidationFrontierGap } from "../validation/validation-frontier-gap.js";
import type { ModelAttemptUsageV2 } from "../model-attempt-usage-contracts.js";
import { canonicalJson, sha256Digest } from "./canonical-json.js";
import type {
  OpenResearchRecordOptions,
  PreparationRecord,
  RecordCampaignAttemptStartResult,
  RecordCampaignRunStartResult,
  RecordSemanticCampaignAttemptStartResult,
  RecordSemanticCampaignRunStartResult,
  RecordPreparationResult,
  RecordVerificationStartResult,
  ResearchRecord,
  ApproachFamilyRegistryRecordView,
  ApproachFamilyRegistryRecordViewV3,
  SemanticFinderCheckpointRecordView,
  SemanticIterationDecisionRecordView,
  SemanticIterationDecisionRecordViewV3,
  SemanticDepthWorkQueueRecordViewV2,
  ValidationCompletion,
  ValidationCompletionRecordView,
  ValidationFrontierGapRecordView,
  ValidationIntent,
  ValidationIntentRecordView,
  JsonArtifactStore,
} from "./contracts.js";

const digestSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

const MEBIBYTE = 1024 * 1024;
const GIBIBYTE = 1024 * MEBIBYTE;

function semanticPlanBudgetMismatch(
  plan: DefaultSemanticCampaignRunPlanV2,
  input: NewCampaignInput,
): boolean {
  const policy = plan.budgetPolicy;
  const verificationBudget = plan.verification.budget;
  const sharedMismatch =
    policy.maxModelAttempts > input.budget.maxAttempts ||
    policy.maxWallTimeMs > input.budget.maxWallTimeMs ||
    plan.semanticPolicy.maxLeases > policy.maxConcurrentFinders ||
    plan.verification.budget.maxVerifierAttempts >
      policy.verificationReserve.maxVerifierAttempts ||
    plan.verification.budget.maxExperiments >
      policy.verificationReserve.maxExperiments ||
    plan.verification.budget.maxWallTimeMs >
      policy.verificationReserve.maxWallTimeMs;
  if (
    policy.id === "semantic-research-recall-baseline-v3" ||
    policy.id === "semantic-research-recall-baseline-v4" ||
    policy.id === "semantic-research-recall-baseline-v5"
  ) {
    const expectedVerifierAttempts =
      policy.id === "semantic-research-recall-baseline-v4" ||
      policy.id === "semantic-research-recall-baseline-v5"
        ? 96
        : 4;
    return (
      sharedMismatch ||
      plan.semanticPolicy.finderLeaseBudget.maxWallTimeMs !== 10_800_000 ||
      plan.semanticPolicy.finderLeaseBudget.maxModelTurns !== 256 ||
      plan.semanticPolicy.finderLeaseBudget.maxProviderCostUsd !== 20 ||
      plan.semanticPolicy.finderLeaseBudget.maxOutputBytes !== 2 * MEBIBYTE ||
      plan.semanticPolicy.finderLeaseBudget.maxSourceQueries !== 512 ||
      plan.semanticPolicy.finderLeaseBudget.maxSourceScanBytes !==
        16 * GIBIBYTE ||
      plan.semanticPolicy.finderLeaseBudget.maxSourceResponseBytes !==
        256 * MEBIBYTE ||
      plan.semanticPolicy.finderLeaseBudget.sourceLimitTerminalOutput !==
        "preserve" ||
      plan.semanticPolicy.finderLeaseBudget.reportedUsageEnforcement !==
        "telemetry-only" ||
      plan.semanticPolicy.plannerBudget.maxWallTimeMs !== 3_600_000 ||
      plan.semanticPolicy.plannerBudget.maxModelTurns !== 128 ||
      plan.semanticPolicy.plannerBudget.maxProviderCostUsd !== 10 ||
      plan.semanticPolicy.plannerBudget.maxOutputBytes !== 2 * MEBIBYTE ||
      plan.semanticPolicy.plannerBudget.maxSourceQueries !== 256 ||
      plan.semanticPolicy.plannerBudget.maxSourceScanBytes !== 16 * GIBIBYTE ||
      plan.semanticPolicy.plannerBudget.maxSourceResponseBytes !==
        256 * MEBIBYTE ||
      plan.semanticPolicy.plannerBudget.sourceLimitTerminalOutput !==
        "preserve" ||
      plan.semanticPolicy.plannerBudget.reportedUsageEnforcement !==
        "telemetry-only" ||
      plan.evaluator.budget.maxWallTimeMs !== 3_600_000 ||
      plan.evaluator.budget.maxModelTurns !== 128 ||
      plan.evaluator.budget.maxProviderCostUsd !== 10 ||
      plan.evaluator.budget.maxOutputBytes !== 2 * MEBIBYTE ||
      plan.evaluator.budget.reportedUsageEnforcement !== "telemetry-only" ||
      !("schemaVersion" in verificationBudget) ||
      verificationBudget.maxVerifierAttempts !== expectedVerifierAttempts ||
      verificationBudget.maxExperiments !== 8 ||
      verificationBudget.maxWallTimeMs !== 7_200_000 ||
      verificationBudget.maxModelTurns !== 128 ||
      verificationBudget.maxProviderCostUsd !== 30 ||
      verificationBudget.maxOutputBytes !== 2 * MEBIBYTE ||
      verificationBudget.reportedUsageEnforcement !== "telemetry-only"
    );
  }
  return (
    sharedMismatch ||
    policy.maxModelTokens > input.budget.maxModelTokens ||
    plan.semanticPolicy.finderLeaseBudget.maxWallTimeMs > 900_000 ||
    plan.semanticPolicy.finderLeaseBudget.maxModelTokens >
      (policy.id === "semantic-research-baseline-v2" ? 1_000_000 : 100_000) ||
    plan.semanticPolicy.finderLeaseBudget.maxModelTurns >
      (policy.id === "semantic-research-baseline-v2" ? 34 : 128) ||
    plan.semanticPolicy.finderLeaseBudget.maxProviderCostUsd > 2.5 ||
    plan.semanticPolicy.finderLeaseBudget.maxOutputBytes > 512 * 1_024 ||
    plan.semanticPolicy.finderLeaseBudget.maxSourceQueries >
      (policy.id === "semantic-research-baseline-v2" ? 32 : 64) ||
    plan.semanticPolicy.plannerBudget.maxWallTimeMs > 300_000 ||
    plan.semanticPolicy.plannerBudget.maxModelTokens > 100_000 ||
    plan.semanticPolicy.plannerBudget.maxModelTurns >
      (policy.id === "semantic-research-baseline-v2" ? 8 : 128) ||
    plan.semanticPolicy.plannerBudget.maxProviderCostUsd > 2.5 ||
    plan.semanticPolicy.plannerBudget.maxOutputBytes > 512 * 1_024 ||
    plan.evaluator.budget.maxWallTimeMs > 300_000 ||
    plan.evaluator.budget.maxModelTokens >
      (policy.id === "semantic-research-baseline-v2" ? 300_000 : 100_000) ||
    plan.evaluator.budget.maxModelTurns >
      (policy.id === "semantic-research-baseline-v2" ? 8 : 128) ||
    plan.evaluator.budget.maxProviderCostUsd > 2.5 ||
    plan.evaluator.budget.maxOutputBytes > 512 * 1_024 ||
    plan.semanticPolicy.finderLeaseBudget.maxModelTokens *
      plan.semanticPolicy.maxLeases +
      plan.semanticPolicy.plannerBudget.maxModelTokens +
      plan.evaluator.budget.maxModelTokens >
      policy.exploration.maxModelTokens ||
    ("schemaVersion" in verificationBudget &&
      verificationBudget.maxModelTokens >
        policy.verificationReserve.maxModelTokens)
  );
}

function currentSemanticPlanBudgetMismatch(
  plan: DefaultSemanticCampaignRunPlanV3,
  input: NewCampaignInput,
): boolean {
  const policy = plan.budgetPolicy;
  const validator = plan.validation.budget.validator;
  const synthesis = plan.validation.budget.synthesis;
  return (
    policy.maxModelAttempts > input.budget.maxAttempts ||
    policy.maxModelTokens > input.budget.maxModelTokens ||
    policy.maxWallTimeMs > input.budget.maxWallTimeMs ||
    plan.semanticPolicy.maxLeases > policy.maxConcurrentFinders ||
    plan.semanticPolicy.finderLeaseBudget.maxWallTimeMs !== 10_800_000 ||
    plan.semanticPolicy.finderLeaseBudget.maxModelTurns !== 256 ||
    plan.semanticPolicy.finderLeaseBudget.maxProviderCostUsd !== 20 ||
    plan.semanticPolicy.finderLeaseBudget.maxOutputBytes !== 2 * MEBIBYTE ||
    plan.semanticPolicy.finderLeaseBudget.maxSourceQueries !== 512 ||
    plan.semanticPolicy.finderLeaseBudget.maxSourceScanBytes !==
      16 * GIBIBYTE ||
    plan.semanticPolicy.finderLeaseBudget.maxSourceResponseBytes !==
      256 * MEBIBYTE ||
    plan.semanticPolicy.finderLeaseBudget.sourceLimitTerminalOutput !==
      "preserve" ||
    plan.semanticPolicy.finderLeaseBudget.reportedUsageEnforcement !==
      "telemetry-only" ||
    plan.semanticPolicy.plannerBudget.maxWallTimeMs !== 3_600_000 ||
    plan.semanticPolicy.plannerBudget.maxModelTurns !== 128 ||
    plan.semanticPolicy.plannerBudget.maxProviderCostUsd !== 10 ||
    plan.semanticPolicy.plannerBudget.maxOutputBytes !== 2 * MEBIBYTE ||
    plan.semanticPolicy.plannerBudget.maxSourceQueries !== 256 ||
    plan.semanticPolicy.plannerBudget.maxSourceScanBytes !== 16 * GIBIBYTE ||
    plan.semanticPolicy.plannerBudget.maxSourceResponseBytes !==
      256 * MEBIBYTE ||
    plan.semanticPolicy.plannerBudget.sourceLimitTerminalOutput !==
      "preserve" ||
    plan.semanticPolicy.plannerBudget.reportedUsageEnforcement !==
      "telemetry-only" ||
    plan.evaluator.budget.maxWallTimeMs !== 3_600_000 ||
    plan.evaluator.budget.maxModelTurns !== 128 ||
    plan.evaluator.budget.maxProviderCostUsd !== 10 ||
    plan.evaluator.budget.maxOutputBytes !== 2 * MEBIBYTE ||
    plan.evaluator.budget.reportedUsageEnforcement !== "telemetry-only" ||
    plan.validation.validatorModelProfile.execution.model !== "claude-opus-5" ||
    plan.validation.synthesisModelProfile.execution.model !== "claude-opus-5" ||
    validator.maxModelTokens * 3 + synthesis.maxModelTokens >
      policy.validationReserve.maxModelTokens ||
    validator.maxProviderCostUsd * 3 + synthesis.maxProviderCostUsd >
      policy.validationReserve.maxProviderCostUsd ||
    validator.maxWallTimeMs * 3 + synthesis.maxWallTimeMs >
      policy.validationReserve.maxWallTimeMs
  );
}

const campaignPreparedPayloadV1Schema = z.strictObject({
  input: newCampaignInputV1Schema,
  inputDigest: digestSchema,
});

const campaignPreparedPayloadV2Schema = z.strictObject({
  input: newCampaignInputV2Schema,
  inputDigest: digestSchema,
  targetFileManifest: targetFileManifestRefSchema,
});

const campaignPreparedPayloadV3Schema = z.strictObject({
  input: newCampaignInputV3Schema,
  inputDigest: digestSchema,
  targetFileManifest: targetFileManifestRefSchema,
});

const verificationStartedPayloadSchema = z.strictObject({
  plan: verificationPlanLedgerSchema,
  planDigest: digestSchema,
});

const verificationCompletedPayloadSchema = z.strictObject({
  completionInputDigest: digestSchema,
  record: verificationRecordSchema,
  recordDigest: digestSchema,
});

const campaignRunStartedPayloadSchema = z.strictObject({
  plan: campaignRunPlanSchema,
  planDigest: digestSchema,
});

const campaignRunCompletedPayloadSchema = z.strictObject({
  completionInputDigest: digestSchema,
  record: campaignRunRecordSchema,
  recordDigest: digestSchema,
});

const campaignAttemptStartedPayloadSchema = z.strictObject({
  intent: campaignAttemptIntentSchema,
});

const campaignAttemptCompletedPayloadSchema = z.strictObject({
  completion: campaignAttemptCompletionSchema,
});

const semanticCampaignRunStartedPayloadSchema = z.strictObject({
  plan: campaignRunPlanV2Schema,
  planDigest: digestSchema,
});

const semanticCampaignRunStartedPayloadV3Schema = z.strictObject({
  plan: campaignRunPlanV3Schema,
  planDigest: digestSchema,
});

const semanticCampaignRunCompletedPayloadSchema = z.strictObject({
  completionInputDigest: digestSchema,
  record: campaignRunRecordV2Schema,
  recordDigest: digestSchema,
});

const semanticCampaignRunCompletedPayloadV3Schema = z.strictObject({
  completionInputDigest: digestSchema,
  record: campaignRunRecordV3Schema,
  recordDigest: digestSchema,
});

const semanticCampaignAttemptStartedPayloadSchema = z.strictObject({
  intent: campaignAttemptIntentV2Schema,
});

const semanticCampaignAttemptCompletedPayloadSchema = z.strictObject({
  completion: campaignAttemptCompletionV2Schema,
});

const semanticFinderCheckpointedPayloadSchema = z.strictObject({
  checkpoint: semanticFinderCheckpointRefSchema,
});

const semanticIterationDecidedPayloadSchema = z.strictObject({
  runId: z.string().min(1).max(128),
  decision: semanticIterationDecisionRefSchema,
  openedFamilies: z.array(approachFamilySchema).max(64),
  registry: approachFamilyRegistryRefSchema,
});

const semanticIterationDecidedPayloadV3Schema = z.strictObject({
  runId: z.string().min(1).max(128),
  decision: semanticIterationDecisionRefV3Schema,
  openedFamilies: z.array(approachFamilyV3Schema).max(64),
  registry: approachFamilyRegistryRefV3Schema,
});

const semanticDepthWorkQueuedPayloadV2Schema = z.strictObject({
  runId: z.string().min(1).max(128),
  decision: semanticIterationDecisionRefV3Schema,
  queue: semanticDepthWorkQueueRefV2Schema,
});

const validationIntentSchema = z.strictObject({
  kind: z.literal("validation-intent"),
  schemaVersion: z.literal(1),
  id: digestSchema,
  campaignId: z.string().min(1).max(128),
  runId: z.string().min(1).max(128),
  validationId: digestSchema,
  candidate: validationCandidateRefSchema,
  approachFamilyIds: z.array(digestSchema).min(1).max(64),
  rootEvaluationDigests: z.array(digestSchema).min(1).max(64),
});

const validationIntendedPayloadSchema = z.strictObject({
  runId: z.string().min(1).max(128),
  predecessorRegistryDigest: digestSchema,
  intents: z.array(validationIntentSchema).min(1).max(64),
  registry: approachFamilyRegistryRefV3Schema,
});

const validationCompletionSchema = z
  .strictObject({
    kind: z.literal("validation-completion"),
    schemaVersion: z.literal(1),
    validation: sourceValidationRecordRefSchema,
    disposition: z.enum([
      "ready-for-human",
      "needs-research",
      "disproven",
      "rejected",
      "validation-pending",
    ]),
    approachFamilyIds: z.array(digestSchema).min(1).max(64),
    frontierGap: validationFrontierGapRefSchema.optional(),
  })
  .superRefine((completion, context) => {
    if (
      (completion.disposition === "needs-research") !==
      (completion.frontierGap !== undefined)
    ) {
      context.addIssue({
        code: "custom",
        path: ["frontierGap"],
        message: "Only Needs-research completion requires a Frontier Gap",
      });
    }
  });

const validationCompletedPayloadSchema = z.strictObject({
  runId: z.string().min(1).max(128),
  predecessorRegistryDigest: digestSchema,
  completion: validationCompletionSchema,
  registry: approachFamilyRegistryRefV3Schema,
});

const semanticDepthIterationDecidedPayloadV1Schema = z.strictObject({
  runId: z.string().min(1).max(128),
  predecessorRegistryDigest: digestSchema,
  decision: depthIterationDecisionRefSchema,
  transitions: z.array(approachFamilyTransitionSchema).min(1).max(64),
  updatedFamilies: z.array(approachFamilySchema).min(1).max(64),
  registry: approachFamilyRegistryRefSchema,
});

const semanticDepthIterationDecidedPayloadV2Schema = z.strictObject({
  runId: z.string().min(1).max(128),
  predecessorRegistryDigest: digestSchema,
  decision: depthIterationDecisionRefSchema,
  transitions: z.array(approachFamilyTransitionSchema).max(64),
  openedFamilies: z.array(approachFamilySchema).max(64),
  updatedFamilies: z.array(approachFamilySchema).max(64),
  registry: approachFamilyRegistryRefSchema,
});

const semanticFamilyEvidenceAttachedPayloadSchema = z.strictObject({
  runId: z.string().min(1).max(128),
  predecessorRegistryDigest: digestSchema,
  decisionDigest: digestSchema,
  attachments: z.array(approachFamilyEvidenceAttachmentSchema).min(1).max(64),
  updatedFamilies: z.array(approachFamilySchema).min(1).max(64),
  registry: approachFamilyRegistryRefSchema,
});

const semanticFamilyVerificationResolvedPayloadSchema = z.strictObject({
  runId: z.string().min(1).max(128),
  predecessorRegistryDigest: digestSchema,
  resolutions: z
    .array(approachFamilyVerificationResolutionSchema)
    .min(1)
    .max(64),
  updatedFamilies: z.array(approachFamilySchema).min(1).max(64),
  registry: approachFamilyRegistryRefSchema,
});

const storedEventRowSchema = z.strictObject({
  campaign_sequence: z.number().int().positive(),
  kind: z.string(),
  schema_version: z.number().int().positive(),
  occurred_at: z.string(),
  payload_json: z.string(),
});

type StoredEventRow = z.infer<typeof storedEventRowSchema>;

interface StoredVerification {
  readonly plan: VerificationPlanLedgerValue;
  readonly planDigest: string;
  readonly startedAt: string;
  readonly startedLedgerHead: number;
  readonly completionInputDigest?: string;
  readonly completed?: VerificationRecordView;
}

interface StoredCampaignRun {
  readonly plan: CampaignRunPlan;
  readonly planDigest: string;
  readonly startedAt: string;
  readonly startedLedgerHead: number;
  readonly completionInputDigest?: string;
  readonly completed?: CampaignRunRecordView;
}

interface StoredSemanticCampaignRun {
  readonly plan: CampaignRunPlanV2 | CampaignRunPlanV3;
  readonly planDigest: string;
  readonly startedAt: string;
  readonly startedLedgerHead: number;
  readonly completionInputDigest?: string;
  readonly completed?: CampaignRunRecordViewV2 | CampaignRunRecordViewV3;
}

interface LedgerProjection {
  readonly preparation: PreparationRecord;
  readonly runs: ReadonlyMap<string, StoredCampaignRun>;
  readonly attempts: ReadonlyMap<string, CampaignAttemptRecordView>;
  readonly semanticRuns: ReadonlyMap<string, StoredSemanticCampaignRun>;
  readonly semanticAttempts: ReadonlyMap<string, CampaignAttemptRecordViewV2>;
  readonly semanticFinderCheckpoints: ReadonlyMap<
    string,
    SemanticFinderCheckpointRecordView
  >;
  readonly semanticIterationDecisions: ReadonlyMap<
    string,
    SemanticIterationDecisionRecordView
  >;
  readonly semanticIterationDecisionsV3: ReadonlyMap<
    string,
    SemanticIterationDecisionRecordViewV3
  >;
  readonly semanticDepthWorkQueuesV2: ReadonlyMap<
    string,
    SemanticDepthWorkQueueRecordViewV2
  >;
  readonly approachFamilyRegistries: ReadonlyMap<
    string,
    ApproachFamilyRegistryRecordView
  >;
  readonly approachFamilyRegistriesV3: ReadonlyMap<
    string,
    ApproachFamilyRegistryRecordViewV3
  >;
  readonly validationIntents: ReadonlyMap<string, ValidationIntentRecordView>;
  readonly validationCompletions: ReadonlyMap<
    string,
    ValidationCompletionRecordView
  >;
  readonly validationFrontierGaps: ReadonlyMap<
    string,
    ValidationFrontierGapRecordView
  >;
  readonly verifications: ReadonlyMap<string, StoredVerification>;
}

function aggregateProgressUsage(
  modelAttempts: number,
  usages: readonly ModelAttemptUsageV2[],
  incomplete: boolean,
): CampaignProgressUsage {
  const modelTokens = usages.reduce(
    (total, usage) => ({
      input: total.input + usage.modelTokens.input,
      cacheCreation: total.cacheCreation + usage.modelTokens.cacheCreation,
      cacheRead: total.cacheRead + usage.modelTokens.cacheRead,
      output: total.output + usage.modelTokens.output,
      total: total.total + usage.modelTokens.total,
    }),
    { input: 0, cacheCreation: 0, cacheRead: 0, output: 0, total: 0 },
  );
  return {
    measurement:
      !incomplete &&
      usages.length === modelAttempts &&
      usages.every((usage) => usage.measurement === "reported")
        ? "reported"
        : "partial",
    modelAttempts,
    reportedModelAttempts: usages.filter(
      (usage) => usage.measurement === "reported",
    ).length,
    modelTurns: usages.reduce((total, usage) => total + usage.modelTurns, 0),
    modelTokens,
    estimatedCostUsd: usages.reduce(
      (total, usage) => total + (usage.estimatedCostUsd ?? 0),
      0,
    ),
    source: usages.reduce(
      (total, usage) => ({
        queries: total.queries + usage.source.queries,
        scanBytes: total.scanBytes + usage.source.scanBytes,
        responseBytes: total.responseBytes + usage.source.responseBytes,
      }),
      { queries: 0, scanBytes: 0, responseBytes: 0 },
    ),
  };
}

async function projectCampaignProgress(
  campaignId: string,
  rows: readonly StoredEventRow[],
  ledger: LedgerProjection,
  artifactStore: JsonArtifactStore | undefined,
): Promise<CampaignProgressView> {
  const runs = [...ledger.runs.values(), ...ledger.semanticRuns.values()];
  const completedRuns = runs.filter((run) => run.completed !== undefined);
  const activeRuns = runs.length - completedRuns.length;
  const attempts = [
    ...[...ledger.attempts.values()].map((attempt) => ({
      attempt,
      role: "finder" as const,
    })),
    ...[...ledger.semanticAttempts.values()].map((attempt) => ({
      attempt,
      role: attempt.intent.role,
    })),
  ];
  const completedAttempts = attempts.filter(
    ({ attempt }) => attempt.completion !== undefined,
  );
  const activeAttempts = attempts
    .filter(({ attempt }) => attempt.completion === undefined)
    .map(({ attempt, role }) => ({
      attemptId: attempt.intent.attemptId,
      role: role as CampaignProgressRole,
      startedAt: attempt.occurredAt,
      ledgerHead: attempt.ledgerHead,
    }))
    .sort((left, right) => left.ledgerHead - right.ledgerHead)
    .map(({ ledgerHead: _ledgerHead, ...attempt }) => attempt);
  const verifications = [...ledger.verifications.values()];
  const completedVerifications = verifications.filter(
    (verification) => verification.completed !== undefined,
  );
  const activeVerifications = verifications
    .filter((verification) => verification.completed === undefined)
    .sort((left, right) => left.startedLedgerHead - right.startedLedgerHead)
    .map((verification) => ({
      verificationId: verification.plan.verificationId,
      startedAt: verification.startedAt,
    }));
  const outcomes = completedVerifications.map(
    (verification) => verification.completed!.ref.outcome,
  );
  const checkpoints = [...ledger.semanticFinderCheckpoints.values()];
  const usages: ModelAttemptUsageV2[] = [];
  let usageIncomplete =
    activeAttempts.length > 0 || activeVerifications.length > 0;
  for (const { attempt } of attempts) {
    const completion = attempt.completion;
    if (completion === undefined || !("role" in completion.value)) continue;
    if (artifactStore === undefined) {
      usageIncomplete = true;
      continue;
    }
    try {
      const artifact = modelAttemptResultV2Schema.parse(
        await artifactStore.readJson(completion.value.result.digest),
      );
      if (artifact.usage === undefined) usageIncomplete = true;
      else usages.push(artifact.usage);
    } catch {
      usageIncomplete = true;
    }
  }
  for (const verification of completedVerifications) {
    const value = verification.completed!.value;
    if (
      value.schemaVersion === 2 &&
      value.evidence.verifierUsage !== undefined
    ) {
      usages.push(value.evidence.verifierUsage);
    }
  }
  const lastEvent = rows.at(-1);
  if (lastEvent === undefined) {
    throw new Error(`Campaign progress has no events: ${campaignId}`);
  }
  return {
    kind: "progress",
    schemaVersion: 1,
    campaignId,
    status:
      activeRuns > 0
        ? "running"
        : completedRuns.length > 0
          ? "completed"
          : "prepared",
    ledgerHead: lastEvent.campaign_sequence,
    counts: {
      runs: {
        started: runs.length,
        completed: completedRuns.length,
        active: activeRuns,
      },
      attempts: {
        started: attempts.length,
        completed: completedAttempts.length,
        active: activeAttempts.length,
      },
      checkpoints: {
        total: checkpoints.length,
        hypotheses: checkpoints.filter(
          (checkpoint) =>
            checkpoint.checkpoint.subject.kind === "source-bound-hypothesis",
        ).length,
        routeFragments: checkpoints.filter(
          (checkpoint) =>
            checkpoint.checkpoint.subject.kind === "route-fragment",
        ).length,
        frontierGaps: checkpoints.filter(
          (checkpoint) => checkpoint.checkpoint.subject.kind === "frontier-gap",
        ).length,
      },
      verifications: {
        started: verifications.length,
        completed: completedVerifications.length,
        active: activeVerifications.length,
        finding: outcomes.filter((outcome) => outcome === "finding").length,
        disproved: outcomes.filter((outcome) => outcome === "disproved").length,
        blocked: outcomes.filter((outcome) => outcome === "blocked").length,
      },
      depthIterations: rows.filter(
        (row) => row.kind === "exploration.depth-iteration-decided",
      ).length,
    },
    activeAttempts,
    activeVerifications,
    usage: aggregateProgressUsage(
      completedAttempts.length +
        completedVerifications.filter(
          (verification) =>
            verification.completed!.value.schemaVersion === 2 &&
            verification.completed!.value.evidence.verifierUsage !== undefined,
        ).length,
      usages,
      usageIncomplete,
    ),
    lastDurableEvent: {
      sequence: lastEvent.campaign_sequence,
      kind: lastEvent.kind,
      occurredAt: lastEvent.occurred_at,
    },
  };
}

function campaignRunRef(
  runId: string,
  recordDigest: string,
  decision: CampaignRunRecordRef["decision"],
): CampaignRunRecordRef {
  return {
    kind: "campaign-run-record",
    schemaVersion: 1,
    runId,
    digest: recordDigest,
    decision,
  };
}

function semanticCampaignRunRef(
  runId: string,
  recordDigest: string,
  decision: CampaignRunRecordRefV2["decision"],
): CampaignRunRecordRefV2 {
  return {
    kind: "campaign-run-record",
    schemaVersion: 2,
    runId,
    digest: recordDigest,
    decision,
  };
}

function currentSemanticCampaignRunRef(
  runId: string,
  recordDigest: string,
  decision: CampaignRunRecordRefV3["decision"],
): CampaignRunRecordRefV3 {
  return {
    kind: "campaign-run-record",
    schemaVersion: 3,
    runId,
    digest: recordDigest,
    decision,
  };
}

function isSemanticCampaignRunViewV2(
  value: CampaignRunRecordViewV2 | CampaignRunRecordViewV3,
): value is CampaignRunRecordViewV2 {
  return value.ref.schemaVersion === 2;
}

function isSemanticCampaignRunViewV3(
  value: CampaignRunRecordViewV2 | CampaignRunRecordViewV3,
): value is CampaignRunRecordViewV3 {
  return value.ref.schemaVersion === 3;
}

function semanticAttemptIdentityMatches(
  intent: CampaignAttemptIntentV2,
  completion: CampaignAttemptCompletionV2,
): boolean {
  if (
    intent.role !== completion.role ||
    intent.campaignId !== completion.campaignId ||
    intent.runId !== completion.runId ||
    intent.attemptId !== completion.attemptId ||
    intent.ordinal !== completion.ordinal ||
    intent.attemptPlanDigest !== completion.result.planDigest ||
    completion.result.attemptId !== completion.attemptId
  ) {
    return false;
  }
  if (intent.role === "root-planner" && completion.role === "root-planner") {
    return intent.preparationDigest === completion.preparationDigest;
  }
  if (intent.role === "finder" && completion.role === "finder") {
    return (
      intent.leaseId === completion.leaseId &&
      intent.workWaveDigest === completion.workWaveDigest &&
      intent.predecessorDecisionDigest === completion.predecessorDecisionDigest
    );
  }
  if (
    intent.role === "root-evaluator" &&
    completion.role === "root-evaluator"
  ) {
    return (
      intent.workWaveDigest === completion.workWaveDigest &&
      intent.terminalDigest === completion.terminalDigest &&
      intent.registryDigest === completion.registryDigest &&
      intent.synthesisDigest === completion.synthesisDigest &&
      intent.critiqueDigest === completion.critiqueDigest
    );
  }
  if (
    intent.role === "root-synthesizer" &&
    completion.role === "root-synthesizer"
  ) {
    return (
      intent.queueDigest === completion.queueDigest &&
      intent.batchId === completion.batchId
    );
  }
  if (
    intent.role === "adversarial-critic" &&
    completion.role === "adversarial-critic"
  ) {
    return intent.synthesisDigest === completion.synthesisDigest;
  }
  return false;
}

function validRootEvaluatorIdentity(
  value:
    | Extract<CampaignAttemptIntentV2, { role: "root-evaluator" }>
    | Extract<CampaignAttemptCompletionV2, { role: "root-evaluator" }>,
): boolean {
  const wave =
    value.workWaveDigest !== undefined &&
    value.terminalDigest !== undefined &&
    value.registryDigest === undefined &&
    value.synthesisDigest === undefined &&
    value.critiqueDigest === undefined;
  const depth =
    value.workWaveDigest === undefined &&
    value.terminalDigest === undefined &&
    value.registryDigest !== undefined &&
    value.synthesisDigest !== undefined &&
    value.critiqueDigest !== undefined;
  return wave || depth;
}

function semanticAttemptRoleRank(
  role: CampaignAttemptIntentV2["role"],
): number {
  switch (role) {
    case "root-planner":
      return 0;
    case "finder":
      return 1;
    case "root-evaluator":
      return 2;
    case "root-synthesizer":
      return 3;
    case "adversarial-critic":
      return 4;
  }
}

function semanticCheckpointMatchesAttempt(
  checkpoint: SemanticFinderCheckpointRef,
  intent: CampaignAttemptIntentV2,
): boolean {
  return (
    intent.role === "finder" &&
    checkpoint.campaignId === intent.campaignId &&
    checkpoint.runId === intent.runId &&
    checkpoint.attemptId === intent.attemptId &&
    checkpoint.leaseId === intent.leaseId &&
    checkpoint.workWaveDigest === intent.workWaveDigest &&
    checkpoint.subject.attemptId === intent.attemptId &&
    checkpoint.subject.leaseId === intent.leaseId &&
    checkpoint.subject.workWaveDigest === intent.workWaveDigest &&
    checkpoint.subject.targetSnapshotDigest ===
      checkpoint.targetSnapshotDigest &&
    checkpoint.subject.manifestDigest === checkpoint.manifestDigest &&
    checkpoint.id ===
      sha256Digest({
        kind: checkpoint.kind,
        campaignId: checkpoint.campaignId,
        runId: checkpoint.runId,
        attemptId: checkpoint.attemptId,
        ordinal: checkpoint.ordinal,
        subject: checkpoint.subject,
      })
  );
}

function verificationRef(
  schemaVersion: VerificationRecordRef["schemaVersion"],
  verificationId: string,
  recordDigest: string,
  outcome: VerificationRecordRef["outcome"],
): VerificationRecordRef {
  return {
    kind: "verification-record",
    schemaVersion,
    verificationId,
    digest: recordDigest,
    outcome,
  };
}

class SqliteResearchRecord implements ResearchRecord {
  readonly #database: Database.Database;
  readonly #clock: () => Date;
  readonly #artifactStore: JsonArtifactStore | undefined;

  constructor(options: OpenResearchRecordOptions) {
    this.#database = new Database(options.databasePath);
    this.#clock = options.clock ?? (() => new Date());
    this.#artifactStore = options.artifactStore;
    this.#database.pragma("journal_mode = WAL");
    this.#database.pragma("busy_timeout = 5000");
    this.#database.exec(`
      CREATE TABLE IF NOT EXISTS research_events (
        global_sequence INTEGER PRIMARY KEY AUTOINCREMENT,
        campaign_id TEXT NOT NULL,
        campaign_sequence INTEGER NOT NULL,
        kind TEXT NOT NULL,
        schema_version INTEGER NOT NULL,
        occurred_at TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        UNIQUE (campaign_id, campaign_sequence)
      ) STRICT;
    `);
  }

  async recordPreparation(
    input: NewCampaignInput,
    targetFileManifest?: TargetFileManifestRef,
  ): Promise<RecordPreparationResult> {
    const requestedInputDigest = sha256Digest(input);
    const transact = this.#database.transaction((): RecordPreparationResult => {
      const existingRows = this.#readRows(input.campaignId);
      if (existingRows.length > 0) {
        return {
          disposition: "occupied",
          requestedInputDigest,
          preparation: this.#decodeLedger(input.campaignId, existingRows)
            .preparation,
        };
      }

      const occurredAt = this.#clock().toISOString();
      const schemaVersion =
        "schemaVersion" in input ? input.schemaVersion : (1 as const);
      const hasManifest = schemaVersion === 2 || schemaVersion === 3;
      if (hasManifest !== (targetFileManifest !== undefined)) {
        throw new Error("Campaign preparation manifest version mismatch");
      }
      this.#insertEvent(
        input.campaignId,
        1,
        "campaign.prepared",
        occurredAt,
        targetFileManifest === undefined
          ? { input, inputDigest: requestedInputDigest }
          : { input, inputDigest: requestedInputDigest, targetFileManifest },
        schemaVersion,
      );

      return {
        disposition: "appended",
        requestedInputDigest,
        preparation: {
          campaignId: input.campaignId,
          ledgerHead: 1,
          occurredAt,
          inputDigest: requestedInputDigest,
          input,
          ...(targetFileManifest === undefined ? {} : { targetFileManifest }),
        },
      };
    });

    return transact();
  }

  async readPreparation(
    campaignId: string,
  ): Promise<PreparationRecord | undefined> {
    const rows = this.#readRows(campaignId);
    return rows.length === 0
      ? undefined
      : this.#decodeLedger(campaignId, rows).preparation;
  }

  async recordCampaignRunStart(
    value: CampaignRunPlan,
  ): Promise<RecordCampaignRunStartResult> {
    const plan = campaignRunPlanSchema.parse(value);
    const planDigest = sha256Digest(plan);
    const transact = this.#database.transaction(
      (): RecordCampaignRunStartResult => {
        const rows = this.#readRows(plan.campaignId);
        if (rows.length === 0) {
          throw new Error(`Campaign not found: ${plan.campaignId}`);
        }
        const ledger = this.#decodeLedger(plan.campaignId, rows);
        const preparation = ledger.preparation;
        const input = preparation.input;
        const matchesModel = (candidate: { id: string; digest: string }) =>
          input.modelProfiles.some(
            (profile) =>
              profile.id === candidate.id &&
              profile.digest === candidate.digest,
          );
        if (
          preparation.inputDigest !== plan.preparationDigest ||
          plan.surfaceMap.targetSnapshotId !== input.targetSnapshot.id ||
          plan.verification.labBaseline.targetSnapshotDigest !==
            input.targetSnapshot.digest ||
          plan.verification.labBaseline.runtimeProfileDigest !==
            input.runtimeProfile.digest ||
          !matchesModel(plan.finder.modelProfile) ||
          !matchesModel(plan.verification.verifierModelProfile) ||
          plan.finder.promptSet.id !== input.promptSet.id ||
          plan.finder.promptSet.digest !== input.promptSet.digest ||
          plan.verification.promptSet.id !== input.promptSet.id ||
          plan.verification.promptSet.digest !== input.promptSet.digest ||
          plan.verification.experimentRegistry.id !==
            input.experimentRegistry.id ||
          plan.verification.experimentRegistry.digest !==
            input.experimentRegistry.digest ||
          plan.budget.maxFinderAttempts > input.budget.maxAttempts ||
          plan.budget.maxWallTimeMs > input.budget.maxWallTimeMs ||
          plan.budget.maxModelTokens > input.budget.maxModelTokens
        ) {
          throw new CampaignRunConflictError(plan.campaignId, plan.runId);
        }

        const existing = ledger.runs.get(plan.runId);
        if (existing !== undefined) {
          if (existing.planDigest !== planDigest) {
            throw new CampaignRunConflictError(plan.campaignId, plan.runId);
          }
          return existing.completed === undefined
            ? {
                disposition: "started",
                planDigest,
                ledgerHead: existing.startedLedgerHead,
                occurredAt: existing.startedAt,
              }
            : {
                disposition: "completed",
                planDigest,
                run: existing.completed,
              };
        }
        const occurredAt = this.#clock().toISOString();
        const ledgerHead = rows.length + 1;
        this.#insertEvent(
          plan.campaignId,
          ledgerHead,
          "campaign.run-started",
          occurredAt,
          { plan, planDigest },
          plan.schemaVersion,
        );
        return {
          disposition: "started",
          planDigest,
          ledgerHead,
          occurredAt,
        };
      },
    );
    return transact();
  }

  async recordCampaignRunCompletion(
    value: CampaignRunCompletionInput,
  ): Promise<CampaignRunRecordView> {
    const input = campaignRunCompletionInputSchema.parse(value);
    const completionInputDigest = sha256Digest(input);
    const transact = this.#database.transaction((): CampaignRunRecordView => {
      const rows = this.#readRows(input.campaignId);
      if (rows.length === 0) {
        throw new Error(`Campaign not found: ${input.campaignId}`);
      }
      const ledger = this.#decodeLedger(input.campaignId, rows);
      const existing = ledger.runs.get(input.runId);
      if (
        existing === undefined ||
        existing.planDigest !== input.planDigest ||
        existing.plan.schemaVersion !== input.schemaVersion
      ) {
        throw new LedgerIntegrityError(
          input.campaignId,
          "campaign-run-plan-digest-mismatch",
        );
      }
      if (existing.completed !== undefined) {
        if (existing.completionInputDigest !== completionInputDigest) {
          throw new CampaignRunConflictError(input.campaignId, input.runId);
        }
        return existing.completed;
      }

      const completedAttemptRefs = [...ledger.attempts.values()]
        .filter((attempt) => attempt.intent.runId === input.runId)
        .flatMap((attempt) =>
          attempt.completion === undefined
            ? []
            : [attempt.completion.value.result],
        )
        .sort((left, right) => left.digest.localeCompare(right.digest));
      const requestedAttemptRefs = [...input.attempts].sort((left, right) =>
        left.digest.localeCompare(right.digest),
      );
      if (
        canonicalJson(completedAttemptRefs) !==
        canonicalJson(requestedAttemptRefs)
      ) {
        throw new LedgerIntegrityError(input.campaignId, "invalid-event-order");
      }

      const completedAt = this.#clock().toISOString();
      const record = campaignRunRecordSchema.parse({
        ...input,
        kind: "campaign-run-record",
        completedAt,
      });
      const recordDigest = sha256Digest(record);
      const ledgerHead = rows.length + 1;
      this.#insertEvent(
        input.campaignId,
        ledgerHead,
        "campaign.run-completed",
        completedAt,
        { completionInputDigest, record, recordDigest },
        input.schemaVersion,
      );
      return {
        ledgerHead,
        occurredAt: completedAt,
        ref: campaignRunRef(input.runId, recordDigest, record.decision.kind),
        value: record,
      };
    });
    return transact();
  }

  async recordSemanticCampaignRunStart(
    value: CampaignRunPlanV2 | CampaignRunPlanV3,
  ): Promise<RecordSemanticCampaignRunStartResult> {
    const plan =
      value.schemaVersion === 3
        ? campaignRunPlanV3Schema.parse(value)
        : campaignRunPlanV2Schema.parse(value);
    const planDigest = sha256Digest(plan);
    const transact = this.#database.transaction(
      (): RecordSemanticCampaignRunStartResult => {
        const rows = this.#readRows(plan.campaignId);
        if (rows.length === 0) {
          throw new Error(`Campaign not found: ${plan.campaignId}`);
        }
        const ledger = this.#decodeLedger(plan.campaignId, rows);
        const preparation = ledger.preparation;
        const input = preparation.input;
        const manifest = preparation.targetFileManifest;
        const modelRefs =
          plan.schemaVersion === 3
            ? [
                plan.planner.modelProfile.ref,
                plan.finder.modelProfile.ref,
                plan.evaluator.modelProfile.ref,
                plan.validation.validatorModelProfile.ref,
                plan.validation.synthesisModelProfile.ref,
              ]
            : "workWave" in plan
              ? [plan.finder.modelProfile.ref]
              : [
                  plan.planner.modelProfile.ref,
                  plan.finder.modelProfile.ref,
                  plan.evaluator.modelProfile.ref,
                  plan.verification.verifierModelProfile,
                ];
        const modelMatches = modelRefs.every((modelRef) =>
          input.modelProfiles.some(
            (profile) =>
              profile.id === modelRef.id && profile.digest === modelRef.digest,
          ),
        );
        const knowledgeIds = new Set<string>();
        const knowledgeMatches = plan.finder.selectedKnowledge.every(
          (selected) => {
            if (knowledgeIds.has(selected.id)) return false;
            knowledgeIds.add(selected.id);
            return input.knowledgeCapsules.some(
              (capsule) =>
                capsule.id === selected.id &&
                capsule.digest === selected.digest,
            );
          },
        );
        const currentPlanMismatch =
          plan.schemaVersion === 3 &&
          (plan.planner.promptSet.id !== input.promptSet.id ||
            plan.planner.promptSet.digest !== input.promptSet.digest ||
            plan.evaluator.promptSet.id !== input.promptSet.id ||
            plan.evaluator.promptSet.digest !== input.promptSet.digest ||
            plan.validation.promptSet.id !== input.promptSet.id ||
            plan.validation.promptSet.digest !== input.promptSet.digest ||
            currentSemanticPlanBudgetMismatch(plan, input));
        const legacyDefaultPlanMismatch =
          plan.schemaVersion === 2 &&
          !("workWave" in plan) &&
          (plan.planner.promptSet.id !== input.promptSet.id ||
            plan.planner.promptSet.digest !== input.promptSet.digest ||
            plan.evaluator.promptSet.id !== input.promptSet.id ||
            plan.evaluator.promptSet.digest !== input.promptSet.digest ||
            plan.verification.promptSet.id !== input.promptSet.id ||
            plan.verification.promptSet.digest !== input.promptSet.digest ||
            plan.verification.experimentRegistry.id !==
              input.experimentRegistry.id ||
            plan.verification.experimentRegistry.digest !==
              input.experimentRegistry.digest ||
            plan.verification.labBaseline.targetSnapshotDigest !==
              plan.target.digest ||
            plan.verification.labBaseline.runtimeProfileDigest !==
              input.runtimeProfile.digest ||
            semanticPlanBudgetMismatch(plan, input));
        if (
          !("schemaVersion" in input) ||
          (input.schemaVersion !== 2 && input.schemaVersion !== 3) ||
          manifest === undefined ||
          preparation.inputDigest !== plan.preparationDigest ||
          canonicalJson(plan.target) !== canonicalJson(input.targetSnapshot) ||
          canonicalJson(plan.manifest) !== canonicalJson(manifest) ||
          ("workWave" in plan &&
            (plan.workWave.ref.targetSnapshotDigest !== plan.target.digest ||
              plan.workWave.ref.manifestDigest !== plan.manifest.digest)) ||
          !modelMatches ||
          plan.finder.promptSet.id !== input.promptSet.id ||
          plan.finder.promptSet.digest !== input.promptSet.digest ||
          currentPlanMismatch ||
          legacyDefaultPlanMismatch ||
          !knowledgeMatches
        ) {
          throw new CampaignRunConflictError(plan.campaignId, plan.runId);
        }

        if (ledger.runs.has(plan.runId)) {
          throw new CampaignRunConflictError(plan.campaignId, plan.runId);
        }
        const existing = ledger.semanticRuns.get(plan.runId);
        if (existing !== undefined) {
          if (existing.planDigest !== planDigest) {
            throw new CampaignRunConflictError(plan.campaignId, plan.runId);
          }
          return existing.completed === undefined
            ? {
                disposition: "started",
                planDigest,
                ledgerHead: existing.startedLedgerHead,
                occurredAt: existing.startedAt,
              }
            : {
                disposition: "completed",
                planDigest,
                run: existing.completed,
              };
        }
        if (
          (plan.schemaVersion === 3 &&
            plan.budgetPolicy.id !== "semantic-research-recall-baseline-v6") ||
          (plan.schemaVersion === 2 &&
            !("workWave" in plan) &&
            plan.budgetPolicy.id !== "semantic-research-recall-baseline-v5")
        ) {
          throw new RetiredSemanticBudgetPolicyError();
        }

        const occurredAt = this.#clock().toISOString();
        const ledgerHead = rows.length + 1;
        this.#insertEvent(
          plan.campaignId,
          ledgerHead,
          "campaign.run-started",
          occurredAt,
          { plan, planDigest },
          plan.schemaVersion,
        );
        return {
          disposition: "started",
          planDigest,
          ledgerHead,
          occurredAt,
        };
      },
    );
    return transact();
  }

  async recordSemanticCampaignRunCompletion(
    value: CampaignRunCompletionInputV2,
  ): Promise<CampaignRunRecordViewV2> {
    const input = campaignRunCompletionInputV2Schema.parse(value);
    const completionInputDigest = sha256Digest(input);
    const transact = this.#database.transaction((): CampaignRunRecordViewV2 => {
      const rows = this.#readRows(input.campaignId);
      if (rows.length === 0) {
        throw new Error(`Campaign not found: ${input.campaignId}`);
      }
      const ledger = this.#decodeLedger(input.campaignId, rows);
      const existing = ledger.semanticRuns.get(input.runId);
      if (
        existing === undefined ||
        existing.plan.schemaVersion !== 2 ||
        existing.planDigest !== input.planDigest
      ) {
        throw new LedgerIntegrityError(
          input.campaignId,
          "campaign-run-plan-digest-mismatch",
        );
      }
      if ("iterationDecision" in input) {
        const expectedDecisionRef = referenceSemanticIterationDecision(
          input.iterationDecision,
        );
        const recordedDecision = ledger.semanticIterationDecisions.get(
          expectedDecisionRef.digest,
        );
        const registry = ledger.approachFamilyRegistries.get(input.runId);
        if (
          recordedDecision === undefined ||
          registry === undefined ||
          canonicalJson(recordedDecision.decision) !==
            canonicalJson(input.iterationDecisionRef) ||
          canonicalJson(registry.ref) !==
            canonicalJson(input.approachFamilyRegistry)
        ) {
          throw new LedgerIntegrityError(
            input.campaignId,
            "invalid-event-order",
          );
        }
      }
      const completed = existing.completed;
      if (completed !== undefined) {
        if (existing.completionInputDigest !== completionInputDigest) {
          throw new CampaignRunConflictError(input.campaignId, input.runId);
        }
        if (!isSemanticCampaignRunViewV2(completed)) {
          throw new CampaignRunConflictError(input.campaignId, input.runId);
        }
        return completed;
      }

      const completedAttemptRefs = [...ledger.semanticAttempts.values()]
        .filter((attempt) => attempt.intent.runId === input.runId)
        .flatMap((attempt) =>
          attempt.completion === undefined
            ? []
            : [attempt.completion.value.result],
        )
        .sort((left, right) => left.digest.localeCompare(right.digest));
      const requestedAttemptRefs = [...input.attempts].sort((left, right) =>
        left.digest.localeCompare(right.digest),
      );
      if (
        canonicalJson(completedAttemptRefs) !==
        canonicalJson(requestedAttemptRefs)
      ) {
        throw new LedgerIntegrityError(input.campaignId, "invalid-event-order");
      }

      const completedAt = this.#clock().toISOString();
      const record = campaignRunRecordV2Schema.parse({
        ...input,
        kind: "campaign-run-record",
        completedAt,
      });
      const recordDigest = sha256Digest(record);
      const ledgerHead = rows.length + 1;
      this.#insertEvent(
        input.campaignId,
        ledgerHead,
        "campaign.run-completed",
        completedAt,
        { completionInputDigest, record, recordDigest },
        2,
      );
      return {
        ledgerHead,
        occurredAt: completedAt,
        ref: semanticCampaignRunRef(
          input.runId,
          recordDigest,
          record.decision.kind,
        ),
        value: record,
      };
    });
    return transact();
  }

  async recordSemanticCampaignRunCompletionV3(
    value: CampaignRunCompletionInputV3,
  ): Promise<CampaignRunRecordViewV3> {
    const input = campaignRunCompletionInputV3Schema.parse(value);
    const completionInputDigest = sha256Digest(input);
    const transact = this.#database.transaction((): CampaignRunRecordViewV3 => {
      const rows = this.#readRows(input.campaignId);
      if (rows.length === 0) {
        throw new Error(`Campaign not found: ${input.campaignId}`);
      }
      const ledger = this.#decodeLedger(input.campaignId, rows);
      const existing = ledger.semanticRuns.get(input.runId);
      if (
        existing === undefined ||
        existing.plan.schemaVersion !== 3 ||
        existing.planDigest !== input.planDigest
      ) {
        throw new LedgerIntegrityError(
          input.campaignId,
          "campaign-run-plan-digest-mismatch",
        );
      }
      const completed = existing.completed;
      if (completed !== undefined) {
        if (
          !isSemanticCampaignRunViewV3(completed) ||
          existing.completionInputDigest !== completionInputDigest
        ) {
          throw new CampaignRunConflictError(input.campaignId, input.runId);
        }
        return completed;
      }

      const completedAttemptRefs = [...ledger.semanticAttempts.values()]
        .filter((attempt) => attempt.intent.runId === input.runId)
        .flatMap((attempt) =>
          attempt.completion === undefined
            ? []
            : [attempt.completion.value.result],
        )
        .sort((left, right) => compareText(left.digest, right.digest));
      const requestedAttemptRefs = [...input.attempts].sort((left, right) =>
        compareText(left.digest, right.digest),
      );
      if (
        canonicalJson(completedAttemptRefs) !==
        canonicalJson(requestedAttemptRefs)
      ) {
        throw new LedgerIntegrityError(input.campaignId, "invalid-event-order");
      }

      if ("iterationDecision" in input) {
        const expectedDecisionRef = referenceSemanticIterationDecisionV3(
          input.iterationDecision,
        );
        const recordedDecision = ledger.semanticIterationDecisionsV3.get(
          expectedDecisionRef.digest,
        );
        const registry = ledger.approachFamilyRegistriesV3.get(input.runId);
        if (
          recordedDecision === undefined ||
          registry === undefined ||
          canonicalJson(recordedDecision.decision) !==
            canonicalJson(input.iterationDecisionRef) ||
          canonicalJson(registry.ref) !==
            canonicalJson(input.approachFamilyRegistry)
        ) {
          throw new LedgerIntegrityError(
            input.campaignId,
            "invalid-event-order",
          );
        }

        const runIntentIds = new Set(
          [...ledger.validationIntents.values()]
            .filter((record) => record.intent.runId === input.runId)
            .map((record) => record.intent.validationId),
        );
        const recordedCompletions = [...ledger.validationCompletions.values()]
          .filter((record) =>
            runIntentIds.has(record.completion.validation.validationId),
          )
          .sort((left, right) =>
            compareText(
              left.completion.validation.validationId,
              right.completion.validation.validationId,
            ),
          );
        const requestedValidations = [...input.validations]
          .map((validation) => ({
            ref: {
              kind: validation.kind,
              schemaVersion: validation.schemaVersion,
              validationId: validation.validationId,
              candidateId: validation.candidateId,
              digest: sha256Digest(validation),
            },
            disposition: validation.status,
          }))
          .sort((left, right) =>
            compareText(left.ref.validationId, right.ref.validationId),
          );
        if (
          canonicalJson(
            recordedCompletions.map((record) => ({
              ref: record.completion.validation,
              disposition: record.completion.disposition,
            })),
          ) !== canonicalJson(requestedValidations)
        ) {
          throw new LedgerIntegrityError(
            input.campaignId,
            "invalid-event-order",
          );
        }
        const recordedFrontierGaps = recordedCompletions
          .flatMap((record) =>
            record.completion.frontierGap === undefined
              ? []
              : [record.completion.frontierGap],
          )
          .sort((left, right) => compareText(left.digest, right.digest));
        const requestedFrontierGaps = [...input.validationFrontierGaps].sort(
          (left, right) => compareText(left.digest, right.digest),
        );
        if (
          canonicalJson(recordedFrontierGaps) !==
          canonicalJson(requestedFrontierGaps)
        ) {
          throw new LedgerIntegrityError(
            input.campaignId,
            "invalid-event-order",
          );
        }
      }

      const completedAt = this.#clock().toISOString();
      const runRecord = campaignRunRecordV3Schema.parse({
        ...input,
        kind: "campaign-run-record",
        completedAt,
      });
      const recordDigest = sha256Digest(runRecord);
      const ledgerHead = rows.length + 1;
      this.#insertEvent(
        input.campaignId,
        ledgerHead,
        "campaign.run-completed",
        completedAt,
        { completionInputDigest, record: runRecord, recordDigest },
        3,
      );
      return {
        ledgerHead,
        occurredAt: completedAt,
        ref: currentSemanticCampaignRunRef(
          input.runId,
          recordDigest,
          runRecord.decision.kind,
        ),
        value: runRecord,
      };
    });
    return transact();
  }

  async readCampaignRun(
    campaignId: string,
    runId: string,
  ): Promise<AnyCampaignRunRecordView | undefined> {
    const rows = this.#readRows(campaignId);
    if (rows.length === 0) return undefined;
    const ledger = this.#decodeLedger(campaignId, rows);
    return (
      ledger.runs.get(runId)?.completed ??
      ledger.semanticRuns.get(runId)?.completed
    );
  }

  async recordCampaignAttemptStart(
    value: CampaignAttemptIntent,
  ): Promise<RecordCampaignAttemptStartResult> {
    const intent = campaignAttemptIntentSchema.parse(value);
    const transact = this.#database.transaction(
      (): RecordCampaignAttemptStartResult => {
        const rows = this.#readRows(intent.campaignId);
        if (rows.length === 0) {
          throw new Error(`Campaign not found: ${intent.campaignId}`);
        }
        const ledger = this.#decodeLedger(intent.campaignId, rows);
        const run = ledger.runs.get(intent.runId);
        if (run === undefined || run.completed !== undefined) {
          throw new CampaignRunConflictError(intent.campaignId, intent.runId);
        }
        const existing = ledger.attempts.get(intent.attemptId);
        if (existing !== undefined) {
          if (canonicalJson(existing.intent) !== canonicalJson(intent)) {
            throw new CampaignRunConflictError(intent.campaignId, intent.runId);
          }
          return existing.completion === undefined
            ? { disposition: "in-progress", attempt: existing }
            : {
                disposition: "completed",
                attempt: { ...existing, completion: existing.completion },
              };
        }
        if (
          [...ledger.attempts.values()].some(
            (attempt) =>
              attempt.intent.runId === intent.runId &&
              attempt.intent.leaseId === intent.leaseId &&
              attempt.intent.ordinal === intent.ordinal,
          )
        ) {
          throw new CampaignRunConflictError(intent.campaignId, intent.runId);
        }
        const occurredAt = this.#clock().toISOString();
        const ledgerHead = rows.length + 1;
        this.#insertEvent(
          intent.campaignId,
          ledgerHead,
          "campaign.attempt-started",
          occurredAt,
          { intent },
        );
        return {
          disposition: "started",
          attempt: { ledgerHead, occurredAt, intent },
        };
      },
    );
    return transact();
  }

  async recordCampaignAttemptCompletion(
    value: CampaignAttemptCompletion,
  ): Promise<CampaignAttemptRecordView> {
    const completion = campaignAttemptCompletionSchema.parse(value);
    const transact = this.#database.transaction(
      (): CampaignAttemptRecordView => {
        const rows = this.#readRows(completion.campaignId);
        if (rows.length === 0) {
          throw new Error(`Campaign not found: ${completion.campaignId}`);
        }
        const ledger = this.#decodeLedger(completion.campaignId, rows);
        const existing = ledger.attempts.get(completion.attemptId);
        if (
          existing === undefined ||
          existing.intent.runId !== completion.runId ||
          existing.intent.leaseId !== completion.leaseId ||
          existing.intent.ordinal !== completion.ordinal ||
          existing.intent.workWaveDigest !== completion.workWaveDigest ||
          completion.result.attemptId !== completion.attemptId ||
          completion.result.leaseId !== completion.leaseId
        ) {
          throw new CampaignRunConflictError(
            completion.campaignId,
            completion.runId,
          );
        }
        if (existing.completion !== undefined) {
          if (
            canonicalJson(existing.completion.value) !==
            canonicalJson(completion)
          ) {
            throw new CampaignRunConflictError(
              completion.campaignId,
              completion.runId,
            );
          }
          return existing;
        }
        const occurredAt = this.#clock().toISOString();
        const ledgerHead = rows.length + 1;
        this.#insertEvent(
          completion.campaignId,
          ledgerHead,
          "campaign.attempt-completed",
          occurredAt,
          { completion },
        );
        return {
          ...existing,
          completion: { ledgerHead, occurredAt, value: completion },
        };
      },
    );
    return transact();
  }

  async listCampaignAttempts(
    campaignId: string,
    runId: string,
  ): Promise<readonly CampaignAttemptRecordView[]> {
    const rows = this.#readRows(campaignId);
    if (rows.length === 0) return [];
    return [...this.#decodeLedger(campaignId, rows).attempts.values()]
      .filter((attempt) => attempt.intent.runId === runId)
      .sort(
        (left, right) =>
          left.intent.leaseId.localeCompare(right.intent.leaseId) ||
          left.intent.ordinal - right.intent.ordinal,
      );
  }

  async recordSemanticCampaignAttemptStart(
    value: CampaignAttemptIntentV2,
  ): Promise<RecordSemanticCampaignAttemptStartResult> {
    const intent = campaignAttemptIntentV2Schema.parse(value);
    const transact = this.#database.transaction(
      (): RecordSemanticCampaignAttemptStartResult => {
        const rows = this.#readRows(intent.campaignId);
        if (rows.length === 0) {
          throw new Error(`Campaign not found: ${intent.campaignId}`);
        }
        const ledger = this.#decodeLedger(intent.campaignId, rows);
        const run = ledger.semanticRuns.get(intent.runId);
        if (
          run === undefined ||
          run.completed !== undefined ||
          (intent.role === "root-evaluator" &&
            !validRootEvaluatorIdentity(intent)) ||
          (intent.role === "root-evaluator" &&
            intent.registryDigest !== undefined &&
            ledger.approachFamilyRegistries.get(intent.runId)?.ref.digest !==
              intent.registryDigest) ||
          (intent.role === "finder" &&
            intent.predecessorDecisionDigest !== undefined &&
            !(
              ledger.approachFamilyRegistries
                .get(intent.runId)
                ?.value.depthDecisions.includes(
                  intent.predecessorDecisionDigest,
                ) ?? false
            )) ||
          ((intent.role === "root-synthesizer" ||
            intent.role === "adversarial-critic") &&
            !ledger.approachFamilyRegistries.has(intent.runId))
        ) {
          throw new CampaignRunConflictError(intent.campaignId, intent.runId);
        }
        const existing = ledger.semanticAttempts.get(intent.attemptId);
        if (existing !== undefined) {
          if (canonicalJson(existing.intent) !== canonicalJson(intent)) {
            throw new CampaignRunConflictError(intent.campaignId, intent.runId);
          }
          return existing.completion === undefined
            ? { disposition: "in-progress", attempt: existing }
            : {
                disposition: "completed",
                attempt: { ...existing, completion: existing.completion },
              };
        }
        if (
          [...ledger.semanticAttempts.values()].some(
            (attempt) =>
              attempt.intent.runId === intent.runId &&
              attempt.intent.role === intent.role &&
              attempt.intent.ordinal === intent.ordinal,
          )
        ) {
          throw new CampaignRunConflictError(intent.campaignId, intent.runId);
        }
        const occurredAt = this.#clock().toISOString();
        const ledgerHead = rows.length + 1;
        this.#insertEvent(
          intent.campaignId,
          ledgerHead,
          "campaign.attempt-started",
          occurredAt,
          { intent },
          2,
        );
        return {
          disposition: "started",
          attempt: { ledgerHead, occurredAt, intent },
        };
      },
    );
    return transact();
  }

  async recordSemanticCampaignAttemptCompletion(
    value: CampaignAttemptCompletionV2,
  ): Promise<CampaignAttemptRecordViewV2> {
    const completion = campaignAttemptCompletionV2Schema.parse(value);
    const transact = this.#database.transaction(
      (): CampaignAttemptRecordViewV2 => {
        const rows = this.#readRows(completion.campaignId);
        if (rows.length === 0) {
          throw new Error(`Campaign not found: ${completion.campaignId}`);
        }
        const ledger = this.#decodeLedger(completion.campaignId, rows);
        const existing = ledger.semanticAttempts.get(completion.attemptId);
        if (
          existing === undefined ||
          (completion.role === "root-evaluator" &&
            !validRootEvaluatorIdentity(completion)) ||
          !semanticAttemptIdentityMatches(existing.intent, completion)
        ) {
          throw new CampaignRunConflictError(
            completion.campaignId,
            completion.runId,
          );
        }
        if (existing.completion !== undefined) {
          if (
            canonicalJson(existing.completion.value) !==
            canonicalJson(completion)
          ) {
            throw new CampaignRunConflictError(
              completion.campaignId,
              completion.runId,
            );
          }
          return existing;
        }
        const occurredAt = this.#clock().toISOString();
        const ledgerHead = rows.length + 1;
        this.#insertEvent(
          completion.campaignId,
          ledgerHead,
          "campaign.attempt-completed",
          occurredAt,
          { completion },
          2,
        );
        return {
          ...existing,
          completion: { ledgerHead, occurredAt, value: completion },
        };
      },
    );
    return transact();
  }

  async listSemanticCampaignAttempts(
    campaignId: string,
    runId: string,
  ): Promise<readonly CampaignAttemptRecordViewV2[]> {
    const rows = this.#readRows(campaignId);
    if (rows.length === 0) return [];
    return [...this.#decodeLedger(campaignId, rows).semanticAttempts.values()]
      .filter((attempt) => attempt.intent.runId === runId)
      .sort(
        (left, right) =>
          semanticAttemptRoleRank(left.intent.role) -
            semanticAttemptRoleRank(right.intent.role) ||
          left.intent.ordinal - right.intent.ordinal ||
          left.intent.attemptId.localeCompare(right.intent.attemptId),
      );
  }

  async recordSemanticFinderCheckpoint(
    value: SemanticFinderCheckpointRef,
  ): Promise<SemanticFinderCheckpointRecordView> {
    const checkpoint = semanticFinderCheckpointRefSchema.parse(value);
    const transact = this.#database.transaction(
      (): SemanticFinderCheckpointRecordView => {
        const rows = this.#readRows(checkpoint.campaignId);
        if (rows.length === 0) {
          throw new Error(`Campaign not found: ${checkpoint.campaignId}`);
        }
        const ledger = this.#decodeLedger(checkpoint.campaignId, rows);
        const run = ledger.semanticRuns.get(checkpoint.runId);
        const attempt = ledger.semanticAttempts.get(checkpoint.attemptId);
        if (
          run === undefined ||
          run.completed !== undefined ||
          attempt === undefined ||
          attempt.completion !== undefined ||
          !semanticCheckpointMatchesAttempt(checkpoint, attempt.intent) ||
          run.plan.target.digest !== checkpoint.targetSnapshotDigest ||
          run.plan.manifest.digest !== checkpoint.manifestDigest
        ) {
          throw new CampaignRunConflictError(
            checkpoint.campaignId,
            checkpoint.runId,
          );
        }
        const existing = ledger.semanticFinderCheckpoints.get(checkpoint.id);
        if (existing !== undefined) {
          if (
            canonicalJson(existing.checkpoint) !== canonicalJson(checkpoint)
          ) {
            throw new CampaignRunConflictError(
              checkpoint.campaignId,
              checkpoint.runId,
            );
          }
          return existing;
        }
        if (
          [...ledger.semanticFinderCheckpoints.values()].some(
            (candidate) =>
              candidate.checkpoint.attemptId === checkpoint.attemptId &&
              candidate.checkpoint.ordinal === checkpoint.ordinal,
          )
        ) {
          throw new CampaignRunConflictError(
            checkpoint.campaignId,
            checkpoint.runId,
          );
        }
        const occurredAt = this.#clock().toISOString();
        const ledgerHead = rows.length + 1;
        this.#insertEvent(
          checkpoint.campaignId,
          ledgerHead,
          "campaign.finder-checkpointed",
          occurredAt,
          { checkpoint },
        );
        return { ledgerHead, occurredAt, checkpoint };
      },
    );
    return transact();
  }

  async listSemanticFinderCheckpoints(
    campaignId: string,
    runId: string,
  ): Promise<readonly SemanticFinderCheckpointRecordView[]> {
    const rows = this.#readRows(campaignId);
    if (rows.length === 0) return [];
    return [
      ...this.#decodeLedger(
        campaignId,
        rows,
      ).semanticFinderCheckpoints.values(),
    ]
      .filter((entry) => entry.checkpoint.runId === runId)
      .sort(
        (left, right) =>
          left.checkpoint.attemptId.localeCompare(right.checkpoint.attemptId) ||
          left.checkpoint.ordinal - right.checkpoint.ordinal ||
          left.checkpoint.id.localeCompare(right.checkpoint.id),
      );
  }

  async recordSemanticIterationDecision(
    campaignId: string,
    runId: string,
    value: IterationDecisionV2,
  ): Promise<SemanticIterationDecisionRecordView> {
    const decision = iterationDecisionV2Schema.parse(value);
    const decisionRef = referenceSemanticIterationDecision(decision);
    const openedFamilies = projectInitialApproachFamilies(
      campaignId,
      runId,
      decision,
    );
    const transact = this.#database.transaction(
      (): SemanticIterationDecisionRecordView => {
        const rows = this.#readRows(campaignId);
        if (rows.length === 0) {
          throw new Error(`Campaign not found: ${campaignId}`);
        }
        const ledger = this.#decodeLedger(campaignId, rows);
        const run = ledger.semanticRuns.get(runId);
        if (
          run === undefined ||
          run.completed !== undefined ||
          canonicalJson(run.plan.target) !== canonicalJson(decision.target) ||
          canonicalJson(run.plan.manifest) !==
            canonicalJson(decision.manifest) ||
          run.plan.target.digest !== decisionRef.targetSnapshotDigest ||
          run.plan.manifest.digest !== decisionRef.manifestDigest
        ) {
          throw new CampaignRunConflictError(campaignId, runId);
        }
        const existing = ledger.semanticIterationDecisions.get(
          decisionRef.digest,
        );
        if (existing !== undefined) return existing;
        const previousRegistry =
          ledger.approachFamilyRegistries.get(runId)?.value;
        if (
          [...ledger.semanticAttempts.values()].some(
            (attempt) =>
              attempt.intent.runId === runId &&
              (attempt.intent.role === "root-synthesizer" ||
                attempt.intent.role === "adversarial-critic"),
          ) &&
          previousRegistry === undefined
        ) {
          throw new CampaignRunConflictError(campaignId, runId);
        }
        const completedEvaluatorRefs = new Set(
          [...ledger.semanticAttempts.values()]
            .filter(
              (attempt) =>
                attempt.intent.runId === runId &&
                attempt.intent.role === "root-evaluator" &&
                attempt.completion !== undefined,
            )
            .map((attempt) => attempt.completion!.value.result.digest),
        );
        if (
          decision.context.rootEvaluatorAttempts.some(
            (attempt) => !completedEvaluatorRefs.has(attempt.digest),
          )
        ) {
          throw new CampaignRunConflictError(campaignId, runId);
        }
        const registry = projectApproachFamilyRegistry({
          campaignId,
          runId,
          target: decision.target,
          manifest: decision.manifest,
          decisions: [...(previousRegistry?.decisions ?? []), decisionRef],
          families: [...(previousRegistry?.families ?? []), ...openedFamilies],
        });
        const occurredAt = this.#clock().toISOString();
        const ledgerHead = rows.length + 1;
        this.#insertEvent(
          campaignId,
          ledgerHead,
          "exploration.iteration-decided",
          occurredAt,
          {
            runId,
            decision: decisionRef,
            openedFamilies,
            registry: registry.ref,
          },
          2,
        );
        return {
          ledgerHead,
          occurredAt,
          decision: decisionRef,
          registry: registry.ref,
        };
      },
    );
    return transact();
  }

  async recordSemanticIterationDecisionV3(
    campaignId: string,
    runId: string,
    value: IterationDecisionV3,
  ): Promise<SemanticIterationDecisionRecordViewV3> {
    const decision = iterationDecisionV3Schema.parse(value);
    const decisionRef = referenceSemanticIterationDecisionV3(decision);
    const registry = projectInitialApproachFamilyRegistryV3(
      campaignId,
      runId,
      decision,
    );
    if (this.#artifactStore === undefined) {
      throw new Error("Iteration Decision v3 requires an Artifact Store");
    }
    const decisionArtifactDigest = await this.#artifactStore.putJson(decision);
    const registryArtifactDigest = await this.#artifactStore.putJson(
      registry.value,
    );
    if (
      decisionArtifactDigest !== decisionRef.digest ||
      registryArtifactDigest !== registry.ref.digest
    ) {
      throw new Error("Iteration Decision v3 CAS mismatch");
    }

    const transact = this.#database.transaction(
      (): SemanticIterationDecisionRecordViewV3 => {
        const rows = this.#readRows(campaignId);
        if (rows.length === 0) {
          throw new Error(`Campaign not found: ${campaignId}`);
        }
        const ledger = this.#decodeLedger(campaignId, rows);
        const run = ledger.semanticRuns.get(runId);
        if (
          run === undefined ||
          run.completed !== undefined ||
          canonicalJson(run.plan.target) !== canonicalJson(decision.target) ||
          canonicalJson(run.plan.manifest) !==
            canonicalJson(decision.manifest) ||
          ledger.semanticIterationDecisions.has(decisionRef.digest) ||
          ledger.approachFamilyRegistries.has(runId)
        ) {
          throw new CampaignRunConflictError(campaignId, runId);
        }
        const existing = ledger.semanticIterationDecisionsV3.get(
          decisionRef.digest,
        );
        if (existing !== undefined) return existing;
        if (ledger.approachFamilyRegistriesV3.has(runId)) {
          throw new CampaignRunConflictError(campaignId, runId);
        }
        const completedEvaluatorRefs = new Set(
          [...ledger.semanticAttempts.values()]
            .filter(
              (attempt) =>
                attempt.intent.runId === runId &&
                attempt.intent.role === "root-evaluator" &&
                attempt.completion !== undefined,
            )
            .map((attempt) => attempt.completion!.value.result.digest),
        );
        if (
          decision.context.rootEvaluatorAttempts.some(
            (attempt) => !completedEvaluatorRefs.has(attempt.digest),
          )
        ) {
          throw new CampaignRunConflictError(campaignId, runId);
        }

        const occurredAt = this.#clock().toISOString();
        const ledgerHead = rows.length + 1;
        this.#insertEvent(
          campaignId,
          ledgerHead,
          "exploration.iteration-decided",
          occurredAt,
          {
            runId,
            decision: decisionRef,
            openedFamilies: registry.value.families,
            registry: registry.ref,
          },
          3,
        );
        return {
          ledgerHead,
          occurredAt,
          decision: decisionRef,
          registry: registry.ref,
        };
      },
    );
    return transact();
  }

  async recordSemanticDepthWorkQueueV2(
    campaignId: string,
    runId: string,
    value: z.infer<typeof semanticDepthWorkQueueV2Schema>,
  ): Promise<SemanticDepthWorkQueueRecordViewV2> {
    const queue = semanticDepthWorkQueueV2Schema.parse(value);
    const queueRef = referenceSemanticDepthWorkQueueV2(queue);
    if (queue.items.length === 0) {
      throw new Error("Semantic Depth Work Queue v2 must contain work");
    }
    if (this.#artifactStore === undefined) {
      throw new Error(
        "Semantic Depth Work Queue v2 requires an Artifact Store",
      );
    }
    const queueArtifactDigest = await this.#artifactStore.putJson(queue);
    if (queueArtifactDigest !== queueRef.digest) {
      throw new Error("Semantic Depth Work Queue v2 CAS mismatch");
    }

    const transact = this.#database.transaction(
      (): SemanticDepthWorkQueueRecordViewV2 => {
        const rows = this.#readRows(campaignId);
        if (rows.length === 0) {
          throw new Error(`Campaign not found: ${campaignId}`);
        }
        const ledger = this.#decodeLedger(campaignId, rows);
        const existing = ledger.semanticDepthWorkQueuesV2.get(runId);
        if (existing !== undefined) {
          if (canonicalJson(existing.queue) !== canonicalJson(queueRef)) {
            throw new CampaignRunConflictError(campaignId, runId);
          }
          return existing;
        }
        const run = ledger.semanticRuns.get(runId);
        const decision = ledger.semanticIterationDecisionsV3.get(
          queue.predecessorDecisionDigest,
        );
        const registry = ledger.approachFamilyRegistriesV3.get(runId);
        const familyRefs = new Map(
          (registry?.value.families ?? []).map((family) => {
            const ref = referenceApproachFamilyV3(family);
            return [ref.id, ref] as const;
          }),
        );
        if (
          run === undefined ||
          run.completed !== undefined ||
          run.plan.schemaVersion !== 3 ||
          queue.campaignId !== campaignId ||
          queue.runId !== runId ||
          canonicalJson(queue.target) !== canonicalJson(run.plan.target) ||
          canonicalJson(queue.manifest) !== canonicalJson(run.plan.manifest) ||
          decision === undefined ||
          decision.decision.workWaveDigest !== queue.wave.digest ||
          registry === undefined ||
          !registry.value.decisions.some(
            (candidate) => candidate.digest === queue.predecessorDecisionDigest,
          ) ||
          queue.items.some((item) =>
            item.families.some((family) => {
              const expected = familyRefs.get(family.id);
              return (
                expected === undefined ||
                canonicalJson(expected) !== canonicalJson(family)
              );
            }),
          )
        ) {
          throw new CampaignRunConflictError(campaignId, runId);
        }

        const occurredAt = this.#clock().toISOString();
        const ledgerHead = rows.length + 1;
        this.#insertEvent(
          campaignId,
          ledgerHead,
          "exploration.depth-work-queued",
          occurredAt,
          {
            runId,
            decision: decision.decision,
            queue: queueRef,
          },
          2,
        );
        return { ledgerHead, occurredAt, queue: queueRef };
      },
    );
    return transact();
  }

  async readSemanticDepthWorkQueueV2(
    campaignId: string,
    runId: string,
  ): Promise<SemanticDepthWorkQueueRecordViewV2 | undefined> {
    const rows = this.#readRows(campaignId);
    if (rows.length === 0) return undefined;
    return this.#decodeLedger(campaignId, rows).semanticDepthWorkQueuesV2.get(
      runId,
    );
  }

  async readApproachFamilyRegistry(
    campaignId: string,
    runId: string,
  ): Promise<ApproachFamilyRegistryRecordView | undefined> {
    const rows = this.#readRows(campaignId);
    if (rows.length === 0) return undefined;
    return this.#decodeLedger(campaignId, rows).approachFamilyRegistries.get(
      runId,
    );
  }

  async readApproachFamilyRegistryV3(
    campaignId: string,
    runId: string,
  ): Promise<ApproachFamilyRegistryRecordViewV3 | undefined> {
    const rows = this.#readRows(campaignId);
    if (rows.length === 0) return undefined;
    return this.#decodeLedger(campaignId, rows).approachFamilyRegistriesV3.get(
      runId,
    );
  }

  async recordValidationIntents(
    campaignId: string,
    runId: string,
    values: readonly ValidationCandidate[],
  ): Promise<readonly ValidationIntentRecordView[]> {
    const candidates = z
      .array(validationCandidateSchema)
      .min(1)
      .max(64)
      .parse(values);
    if (
      new Set(candidates.map((candidate) => candidate.id)).size !==
      candidates.length
    ) {
      throw new Error(
        "Validation intent candidates must be exact-deduplicated",
      );
    }
    if (this.#artifactStore === undefined) {
      throw new Error("Validation intent requires an Artifact Store");
    }
    const rows = this.#readRows(campaignId);
    if (rows.length === 0) {
      throw new Error(`Campaign not found: ${campaignId}`);
    }
    const ledger = this.#decodeLedger(campaignId, rows);
    const run = ledger.semanticRuns.get(runId);
    const registry = ledger.approachFamilyRegistriesV3.get(runId);
    if (
      run === undefined ||
      run.completed !== undefined ||
      registry === undefined ||
      ledger.approachFamilyRegistries.has(runId) ||
      candidates.some(
        (candidate) =>
          canonicalJson(candidate.target) !== canonicalJson(run.plan.target) ||
          canonicalJson(candidate.manifest) !==
            canonicalJson(run.plan.manifest),
      )
    ) {
      throw new CampaignRunConflictError(campaignId, runId);
    }

    const decisions = new Map<string, IterationDecisionV3>();
    for (const decisionDigest of new Set(
      candidates.flatMap((candidate) =>
        candidate.origins.map((origin) => origin.rootEvaluationDigest),
      ),
    )) {
      if (
        !ledger.semanticIterationDecisionsV3.has(decisionDigest) ||
        !registry.value.decisions.some(
          (decision) => decision.digest === decisionDigest,
        )
      ) {
        throw new CampaignRunConflictError(campaignId, runId);
      }
      const rawDecision = await this.#artifactStore.readJson(decisionDigest);
      if (sha256Digest(rawDecision) !== decisionDigest) {
        throw new Error("Validation intent Decision CAS mismatch");
      }
      decisions.set(
        decisionDigest,
        iterationDecisionV3Schema.parse(rawDecision),
      );
    }

    const families = new Map(
      registry.value.families.map((family) => [family.id, family]),
    );
    const intents: ValidationIntent[] = [];
    for (const candidate of [...candidates].sort((left, right) =>
      compareText(left.id, right.id),
    )) {
      for (const origin of candidate.origins) {
        const decision = decisions.get(origin.rootEvaluationDigest);
        const family = families.get(origin.approachFamilyId);
        if (
          decision === undefined ||
          family === undefined ||
          !decision.actions.some(
            (action) =>
              action.kind === "admit-validation" &&
              action.approachFamily.id === family.openingAdmission.id &&
              action.admission.hypothesis.digest === origin.subjectDigest &&
              action.admission.brokenSecurityProperty ===
                candidate.brokenSecurityProperty &&
              canonicalJson(action.admission.causalRoute) ===
                canonicalJson(candidate.causalRoute),
          )
        ) {
          throw new Error("Validation intent is not admitted by its Decision");
        }
      }
      const candidateRef = referenceValidationCandidate(candidate);
      const storedCandidateDigest =
        await this.#artifactStore.putJson(candidate);
      if (storedCandidateDigest !== candidateRef.digest) {
        throw new Error("Validation Candidate CAS mismatch");
      }
      const approachFamilyIds = [
        ...new Set(candidate.origins.map((origin) => origin.approachFamilyId)),
      ].sort(compareText);
      const rootEvaluationDigests = [
        ...new Set(
          candidate.origins.map((origin) => origin.rootEvaluationDigest),
        ),
      ].sort(compareText);
      const identity = {
        kind: "validation-intent" as const,
        schemaVersion: 1 as const,
        campaignId,
        runId,
        validationId: candidate.id,
      };
      intents.push(
        validationIntentSchema.parse({
          ...identity,
          id: sha256Digest(identity),
          candidate: candidateRef,
          approachFamilyIds,
          rootEvaluationDigests,
        }),
      );
    }
    const projected = attachApproachFamilyValidationIntentsV3({
      registry: registry.value,
      intents,
    });
    const storedRegistryDigest = await this.#artifactStore.putJson(
      projected.value,
    );
    if (storedRegistryDigest !== projected.ref.digest) {
      throw new Error("Validation intent Registry CAS mismatch");
    }

    const transact = this.#database.transaction(
      (): readonly ValidationIntentRecordView[] => {
        const currentRows = this.#readRows(campaignId);
        const current = this.#decodeLedger(campaignId, currentRows);
        const existing = intents.map((intent) =>
          current.validationIntents.get(intent.id),
        );
        if (existing.some((record) => record !== undefined)) {
          if (
            existing.some(
              (record, index) =>
                record === undefined ||
                canonicalJson(record.intent) !== canonicalJson(intents[index]),
            )
          ) {
            throw new CampaignRunConflictError(campaignId, runId);
          }
          return existing.flatMap((record) =>
            record === undefined ? [] : [record],
          );
        }
        const currentRun = current.semanticRuns.get(runId);
        const currentRegistry = current.approachFamilyRegistriesV3.get(runId);
        if (
          currentRun === undefined ||
          currentRun.completed !== undefined ||
          currentRegistry?.ref.digest !== registry.ref.digest
        ) {
          throw new CampaignRunConflictError(campaignId, runId);
        }
        const occurredAt = this.#clock().toISOString();
        const ledgerHead = currentRows.length + 1;
        this.#insertEvent(
          campaignId,
          ledgerHead,
          "validation.intended",
          occurredAt,
          {
            runId,
            predecessorRegistryDigest: registry.ref.digest,
            intents,
            registry: projected.ref,
          },
          1,
        );
        return intents.map((intent) => ({
          ledgerHead,
          occurredAt,
          intent,
          registry: projected.ref,
        }));
      },
    );
    return transact();
  }

  async listValidationIntents(
    campaignId: string,
    runId: string,
  ): Promise<readonly ValidationIntentRecordView[]> {
    const rows = this.#readRows(campaignId);
    if (rows.length === 0) return [];
    return [...this.#decodeLedger(campaignId, rows).validationIntents.values()]
      .filter((record) => record.intent.runId === runId)
      .sort((left, right) =>
        compareText(left.intent.validationId, right.intent.validationId),
      );
  }

  async recordValidationCompletion(
    campaignId: string,
    runId: string,
    value: SourceValidationRecordRef,
  ): Promise<ValidationCompletionRecordView> {
    const validationRef = sourceValidationRecordRefSchema.parse(value);
    if (this.#artifactStore === undefined) {
      throw new Error("Validation completion requires an Artifact Store");
    }
    const rawValidation = await this.#artifactStore.readJson(
      validationRef.digest,
    );
    if (sha256Digest(rawValidation) !== validationRef.digest) {
      throw new Error("Validation Record CAS mismatch");
    }
    const validation = sourceValidationRecordSchema.parse(rawValidation);
    if (
      validation.validationId !== validationRef.validationId ||
      validation.candidateId !== validationRef.candidateId
    ) {
      throw new Error("Validation Record ref mismatch");
    }

    const rows = this.#readRows(campaignId);
    if (rows.length === 0) {
      throw new Error(`Campaign not found: ${campaignId}`);
    }
    const ledger = this.#decodeLedger(campaignId, rows);
    const existing = ledger.validationCompletions.get(validation.validationId);
    if (existing !== undefined) {
      if (
        canonicalJson(existing.completion.validation) !==
          canonicalJson(validationRef) ||
        existing.completion.disposition !== validation.status
      ) {
        throw new CampaignRunConflictError(campaignId, runId);
      }
      return existing;
    }
    const run = ledger.semanticRuns.get(runId);
    const registry = ledger.approachFamilyRegistriesV3.get(runId);
    const intent = [...ledger.validationIntents.values()].find(
      (candidate) =>
        candidate.intent.runId === runId &&
        candidate.intent.validationId === validation.validationId,
    );
    if (
      run === undefined ||
      run.completed !== undefined ||
      registry === undefined ||
      intent === undefined ||
      intent.intent.candidate.id !== validation.candidateId
    ) {
      throw new CampaignRunConflictError(campaignId, runId);
    }
    const frontierGap =
      validation.status === "needs-research"
        ? projectValidationFrontierGap({
            campaignId,
            runId,
            target: run.plan.target,
            manifest: run.plan.manifest,
            validation,
            validationRef,
            candidateRef: intent.intent.candidate,
            approachFamilyIds: intent.intent.approachFamilyIds,
          })
        : undefined;
    if (frontierGap !== undefined) {
      const storedFrontierGapDigest = await this.#artifactStore.putJson(
        frontierGap.value,
      );
      if (storedFrontierGapDigest !== frontierGap.ref.digest) {
        throw new Error("Validation Frontier Gap CAS mismatch");
      }
    }
    const completion = validationCompletionSchema.parse({
      kind: "validation-completion",
      schemaVersion: 1,
      validation: validationRef,
      disposition: validation.status,
      approachFamilyIds: intent.intent.approachFamilyIds,
      ...(frontierGap === undefined ? {} : { frontierGap: frontierGap.ref }),
    });
    const projected = resolveApproachFamilyValidationV3({
      registry: registry.value,
      resolution: {
        validationId: validation.validationId,
        recordDigest: validationRef.digest,
        disposition: validation.status,
        approachFamilyIds: completion.approachFamilyIds,
      },
    });
    const storedRegistryDigest = await this.#artifactStore.putJson(
      projected.value,
    );
    if (storedRegistryDigest !== projected.ref.digest) {
      throw new Error("Validation completion Registry CAS mismatch");
    }

    const transact = this.#database.transaction(
      (): ValidationCompletionRecordView => {
        const currentRows = this.#readRows(campaignId);
        const current = this.#decodeLedger(campaignId, currentRows);
        const currentExisting = current.validationCompletions.get(
          validation.validationId,
        );
        if (currentExisting !== undefined) {
          if (
            canonicalJson(currentExisting.completion) !==
            canonicalJson(completion)
          ) {
            throw new CampaignRunConflictError(campaignId, runId);
          }
          return currentExisting;
        }
        const currentRun = current.semanticRuns.get(runId);
        const currentRegistry = current.approachFamilyRegistriesV3.get(runId);
        if (
          currentRun === undefined ||
          currentRun.completed !== undefined ||
          currentRegistry?.ref.digest !== registry.ref.digest
        ) {
          throw new CampaignRunConflictError(campaignId, runId);
        }
        const occurredAt = this.#clock().toISOString();
        const ledgerHead = currentRows.length + 1;
        this.#insertEvent(
          campaignId,
          ledgerHead,
          "validation.completed",
          occurredAt,
          {
            runId,
            predecessorRegistryDigest: registry.ref.digest,
            completion,
            registry: projected.ref,
          },
          1,
        );
        return {
          ledgerHead,
          occurredAt,
          completion,
          registry: projected.ref,
        };
      },
    );
    return transact();
  }

  async listValidationCompletions(
    campaignId: string,
    runId: string,
  ): Promise<readonly ValidationCompletionRecordView[]> {
    const rows = this.#readRows(campaignId);
    if (rows.length === 0) return [];
    const ledger = this.#decodeLedger(campaignId, rows);
    return [...ledger.validationCompletions.values()]
      .filter((record) => {
        const intent = ledger.validationIntents.get(
          sha256Digest({
            kind: "validation-intent",
            schemaVersion: 1,
            campaignId,
            runId,
            validationId: record.completion.validation.validationId,
          }),
        );
        return intent?.intent.runId === runId;
      })
      .sort((left, right) =>
        compareText(
          left.completion.validation.validationId,
          right.completion.validation.validationId,
        ),
      );
  }

  async listValidationFrontierGaps(
    campaignId: string,
    runId: string,
  ): Promise<readonly ValidationFrontierGapRecordView[]> {
    const rows = this.#readRows(campaignId);
    if (rows.length === 0) return [];
    const ledger = this.#decodeLedger(campaignId, rows);
    return [...ledger.validationFrontierGaps.values()]
      .filter((record) => {
        const intent = ledger.validationIntents.get(
          sha256Digest({
            kind: "validation-intent",
            schemaVersion: 1,
            campaignId,
            runId,
            validationId: record.frontierGap.validationId,
          }),
        );
        return intent?.intent.runId === runId;
      })
      .sort((left, right) =>
        compareText(
          left.frontierGap.validationId,
          right.frontierGap.validationId,
        ),
      );
  }

  async recordSemanticDepthIteration(
    campaignId: string,
    runId: string,
    input: {
      readonly queue: z.infer<typeof semanticDepthWorkQueueSchema>;
      readonly synthesis: z.infer<typeof chainSynthesisSchema>;
      readonly decision: z.infer<typeof depthIterationDecisionSchema>;
    },
  ): Promise<ApproachFamilyRegistryRecordView> {
    const queue = semanticDepthWorkQueueSchema.parse(input.queue);
    const synthesis = chainSynthesisSchema.parse(input.synthesis);
    const decision = depthIterationDecisionSchema.parse(input.decision);
    const decisionRef = referenceDepthIterationDecision(decision);
    const transact = this.#database.transaction(
      (): ApproachFamilyRegistryRecordView => {
        const rows = this.#readRows(campaignId);
        if (rows.length === 0) {
          throw new Error(`Campaign not found: ${campaignId}`);
        }
        const ledger = this.#decodeLedger(campaignId, rows);
        const run = ledger.semanticRuns.get(runId);
        const current = ledger.approachFamilyRegistries.get(runId);
        if (
          run === undefined ||
          run.completed !== undefined ||
          current === undefined ||
          decision.registry.digest !== current.ref.digest ||
          decision.target.digest !== run.plan.target.digest ||
          decision.manifest.digest !== run.plan.manifest.digest
        ) {
          throw new CampaignRunConflictError(campaignId, runId);
        }
        const evaluator = ledger.semanticAttempts.get(
          decision.attempt.attemptId,
        );
        if (
          evaluator?.completion === undefined ||
          evaluator.intent.role !== "root-evaluator" ||
          evaluator.completion.value.result.digest !== decision.attempt.digest
        ) {
          throw new CampaignRunConflictError(campaignId, runId);
        }
        const advanced = advanceApproachFamilyRegistry({
          registry: current.value,
          queue,
          synthesis,
          decision,
        });
        const updatedIds = new Set(
          advanced.transitions.map((transition) => transition.familyId),
        );
        const updatedFamilies = advanced.value.families.filter((family) =>
          updatedIds.has(family.id),
        );
        const occurredAt = this.#clock().toISOString();
        const ledgerHead = rows.length + 1;
        this.#insertEvent(
          campaignId,
          ledgerHead,
          "exploration.depth-iteration-decided",
          occurredAt,
          {
            runId,
            predecessorRegistryDigest: current.ref.digest,
            decision: decisionRef,
            transitions: advanced.transitions,
            openedFamilies: advanced.openedFamilies,
            updatedFamilies,
            registry: advanced.ref,
          },
          2,
        );
        return { ref: advanced.ref, value: advanced.value };
      },
    );
    return transact();
  }

  async recordSemanticMissingLinkEvidence(
    campaignId: string,
    runId: string,
    decisionDigest: string,
    values: readonly z.infer<typeof semanticDepthWorkQueueSchema>[],
  ): Promise<ApproachFamilyRegistryRecordView> {
    const followUpQueues = values.map((value) =>
      semanticDepthWorkQueueSchema.parse(value),
    );
    const transact = this.#database.transaction(
      (): ApproachFamilyRegistryRecordView => {
        const rows = this.#readRows(campaignId);
        if (rows.length === 0) {
          throw new Error(`Campaign not found: ${campaignId}`);
        }
        const ledger = this.#decodeLedger(campaignId, rows);
        const run = ledger.semanticRuns.get(runId);
        const current = ledger.approachFamilyRegistries.get(runId);
        if (
          run === undefined ||
          run.completed !== undefined ||
          current === undefined ||
          !current.value.depthDecisions.includes(decisionDigest)
        ) {
          throw new CampaignRunConflictError(campaignId, runId);
        }
        const attached = attachApproachFamilyEvidence({
          registry: current.value,
          decisionDigest,
          followUpQueues,
        });
        if (attached.attachments.length === 0) return current;
        const updatedIds = new Set(
          attached.attachments.map((attachment) => attachment.familyId),
        );
        const updatedFamilies = attached.value.families.filter((family) =>
          updatedIds.has(family.id),
        );
        const occurredAt = this.#clock().toISOString();
        const ledgerHead = rows.length + 1;
        this.#insertEvent(
          campaignId,
          ledgerHead,
          "exploration.family-evidence-attached",
          occurredAt,
          {
            runId,
            predecessorRegistryDigest: current.ref.digest,
            decisionDigest,
            attachments: attached.attachments,
            updatedFamilies,
            registry: attached.ref,
          },
          1,
        );
        return { ref: attached.ref, value: attached.value };
      },
    );
    return transact();
  }

  async recordSemanticFamilyVerificationOutcomes(
    campaignId: string,
    runId: string,
    values: readonly {
      readonly familyId: string;
      readonly verification: VerificationRecordRef;
    }[],
  ): Promise<ApproachFamilyRegistryRecordView> {
    const resolutions = values.map((value) => ({
      familyId: digestSchema.parse(value.familyId),
      verification: verificationRecordRefSchema.parse(value.verification),
    }));
    const transact = this.#database.transaction(
      (): ApproachFamilyRegistryRecordView => {
        const rows = this.#readRows(campaignId);
        if (rows.length === 0) {
          throw new Error(`Campaign not found: ${campaignId}`);
        }
        const ledger = this.#decodeLedger(campaignId, rows);
        const run = ledger.semanticRuns.get(runId);
        const current = ledger.approachFamilyRegistries.get(runId);
        if (
          run === undefined ||
          run.completed !== undefined ||
          current === undefined ||
          resolutions.some((resolution) => {
            const verification = ledger.verifications.get(
              resolution.verification.verificationId,
            )?.completed;
            return (
              verification === undefined ||
              canonicalJson(verification.ref) !==
                canonicalJson(resolution.verification) ||
              verification.value.targetSnapshotDigest !== run.plan.target.digest
            );
          })
        ) {
          throw new CampaignRunConflictError(campaignId, runId);
        }
        const resolved = resolveApproachFamilyVerifications({
          registry: current.value,
          resolutions,
        });
        if (resolved.resolutions.length === 0) return current;
        const updatedIds = new Set(
          resolved.resolutions.map((resolution) => resolution.familyId),
        );
        const updatedFamilies = resolved.value.families.filter((family) =>
          updatedIds.has(family.id),
        );
        const occurredAt = this.#clock().toISOString();
        const ledgerHead = rows.length + 1;
        this.#insertEvent(
          campaignId,
          ledgerHead,
          "exploration.family-verification-resolved",
          occurredAt,
          {
            runId,
            predecessorRegistryDigest: current.ref.digest,
            resolutions: resolved.resolutions,
            updatedFamilies,
            registry: resolved.ref,
          },
          1,
        );
        return { ref: resolved.ref, value: resolved.value };
      },
    );
    return transact();
  }

  async recordVerificationStart(
    value: VerificationPlan,
  ): Promise<RecordVerificationStartResult> {
    const plan = verificationPlanSchema.parse(value);
    const planDigest = sha256Digest(plan);
    const transact = this.#database.transaction(
      (): RecordVerificationStartResult => {
        const rows = this.#readRows(plan.campaignId);
        if (rows.length === 0) {
          throw new Error(`Campaign not found: ${plan.campaignId}`);
        }
        const ledger = this.#decodeLedger(plan.campaignId, rows);
        if (
          canonicalJson(ledger.preparation.input.targetSnapshot) !==
          canonicalJson(plan.targetSnapshot)
        ) {
          throw new VerificationConflictError(
            plan.campaignId,
            plan.verificationId,
          );
        }

        const existing = ledger.verifications.get(plan.verificationId);
        if (existing !== undefined) {
          if (existing.planDigest !== planDigest) {
            throw new VerificationConflictError(
              plan.campaignId,
              plan.verificationId,
            );
          }
          return existing.completed === undefined
            ? {
                disposition: "started",
                planDigest,
                ledgerHead: existing.startedLedgerHead,
                occurredAt: existing.startedAt,
              }
            : {
                disposition: "completed",
                planDigest,
                verification: existing.completed,
              };
        }

        const occurredAt = this.#clock().toISOString();
        const ledgerHead = rows.length + 1;
        this.#insertEvent(
          plan.campaignId,
          ledgerHead,
          "verification.started",
          occurredAt,
          { plan, planDigest },
          plan.schemaVersion,
        );
        return {
          disposition: "started",
          planDigest,
          ledgerHead,
          occurredAt,
        };
      },
    );

    return transact();
  }

  async recordVerificationCompletion(
    value: VerificationCompletionInput,
  ): Promise<VerificationRecordView> {
    const input = verificationCompletionInputSchema.parse(value);
    const completionInputDigest = sha256Digest(input);
    const transact = this.#database.transaction((): VerificationRecordView => {
      const rows = this.#readRows(input.campaignId);
      if (rows.length === 0) {
        throw new Error(`Campaign not found: ${input.campaignId}`);
      }
      const ledger = this.#decodeLedger(input.campaignId, rows);
      const existing = ledger.verifications.get(input.verificationId);
      if (existing === undefined || existing.planDigest !== input.planDigest) {
        throw new LedgerIntegrityError(
          input.campaignId,
          "verification-plan-digest-mismatch",
        );
      }
      if (existing.completed !== undefined) {
        if (existing.completionInputDigest !== completionInputDigest) {
          throw new VerificationConflictError(
            input.campaignId,
            input.verificationId,
          );
        }
        return existing.completed;
      }

      const completedAt = this.#clock().toISOString();
      const record = verificationRecordSchema.parse({
        ...input,
        kind: "verification-record",
        completedAt,
      });
      const recordDigest = sha256Digest(record);
      const ledgerHead = rows.length + 1;
      this.#insertEvent(
        input.campaignId,
        ledgerHead,
        "verification.completed",
        completedAt,
        { completionInputDigest, record, recordDigest },
        input.schemaVersion,
      );

      return {
        ledgerHead,
        occurredAt: completedAt,
        ref: verificationRef(
          record.schemaVersion,
          input.verificationId,
          recordDigest,
          record.outcome.kind,
        ),
        value: record,
      };
    });

    return transact();
  }

  async readVerification(
    campaignId: string,
    verificationId: string,
  ): Promise<VerificationRecordView | undefined> {
    const rows = this.#readRows(campaignId);
    if (rows.length === 0) return undefined;
    return this.#decodeLedger(campaignId, rows).verifications.get(
      verificationId,
    )?.completed;
  }

  async readCampaignProgress(
    campaignId: string,
  ): Promise<CampaignProgressView | undefined> {
    const rows = this.#readRows(campaignId);
    if (rows.length === 0) return undefined;
    return projectCampaignProgress(
      campaignId,
      rows,
      this.#decodeLedger(campaignId, rows),
      this.#artifactStore,
    );
  }

  close(): void {
    this.#database.close();
  }

  #insertEvent(
    campaignId: string,
    campaignSequence: number,
    kind: string,
    occurredAt: string,
    payload: unknown,
    schemaVersion = 1,
  ): void {
    this.#database
      .prepare(
        `INSERT INTO research_events (
          campaign_id,
          campaign_sequence,
          kind,
          schema_version,
          occurred_at,
          payload_json
        ) VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        campaignId,
        campaignSequence,
        kind,
        schemaVersion,
        occurredAt,
        canonicalJson(payload),
      );
  }

  #readRows(campaignId: string): readonly StoredEventRow[] {
    const rows: unknown[] = this.#database
      .prepare(
        `SELECT campaign_sequence, kind, schema_version, occurred_at, payload_json
         FROM research_events
         WHERE campaign_id = ?
         ORDER BY campaign_sequence ASC`,
      )
      .all(campaignId);

    return rows.map((row) => storedEventRowSchema.parse(row));
  }

  #decodeLedger(
    campaignId: string,
    rows: readonly StoredEventRow[],
  ): LedgerProjection {
    for (const [index, event] of rows.entries()) {
      if (event.campaign_sequence !== index + 1) {
        throw new LedgerIntegrityError(campaignId, "non-contiguous-sequence");
      }
    }

    const first = rows[0];
    if (first === undefined) {
      throw new Error(`Campaign not found: ${campaignId}`);
    }
    if (
      first.kind !== "campaign.prepared" ||
      (first.schema_version !== 1 &&
        first.schema_version !== 2 &&
        first.schema_version !== 3)
    ) {
      throw new UnsupportedLedgerSchemaError(first.kind, first.schema_version);
    }

    const rawPreparationPayload = this.#parsePayload(first);
    let preparationInput: NewCampaignInput;
    let preparationInputDigest: string;
    let targetFileManifest: TargetFileManifestRef | undefined;
    if (first.schema_version === 1) {
      const payload = campaignPreparedPayloadV1Schema.parse(
        rawPreparationPayload,
      );
      preparationInput = payload.input;
      preparationInputDigest = payload.inputDigest;
    } else {
      const payload =
        first.schema_version === 2
          ? campaignPreparedPayloadV2Schema.parse(rawPreparationPayload)
          : campaignPreparedPayloadV3Schema.parse(rawPreparationPayload);
      preparationInput = payload.input;
      preparationInputDigest = payload.inputDigest;
      targetFileManifest = payload.targetFileManifest;
      const input = payload.input;
      const expectedManifest = projectTargetFileManifest(
        input.targetSnapshot,
        input.canonicalFileManifest,
      );
      if (
        targetFileManifest === undefined ||
        targetFileManifest.targetSnapshotId !== input.targetSnapshot.id ||
        targetFileManifest.targetSnapshotDigest !==
          input.targetSnapshot.digest ||
        targetFileManifest.digest !== sha256Digest(expectedManifest)
      ) {
        throw new LedgerIntegrityError(
          campaignId,
          "target-file-manifest-binding-mismatch",
        );
      }
    }
    if (preparationInput.campaignId !== campaignId) {
      throw new LedgerIntegrityError(campaignId, "campaign-id-mismatch");
    }
    if (sha256Digest(preparationInput) !== preparationInputDigest) {
      throw new LedgerIntegrityError(campaignId, "input-digest-mismatch");
    }

    const runs = new Map<string, StoredCampaignRun>();
    const attempts = new Map<string, CampaignAttemptRecordView>();
    const semanticRuns = new Map<string, StoredSemanticCampaignRun>();
    const semanticAttempts = new Map<string, CampaignAttemptRecordViewV2>();
    const semanticFinderCheckpoints = new Map<
      string,
      SemanticFinderCheckpointRecordView
    >();
    const semanticIterationDecisions = new Map<
      string,
      SemanticIterationDecisionRecordView
    >();
    const semanticIterationDecisionsV3 = new Map<
      string,
      SemanticIterationDecisionRecordViewV3
    >();
    const semanticDepthWorkQueuesV2 = new Map<
      string,
      SemanticDepthWorkQueueRecordViewV2
    >();
    const approachFamilyRegistries = new Map<
      string,
      ApproachFamilyRegistryRecordView
    >();
    const approachFamilyRegistriesV3 = new Map<
      string,
      ApproachFamilyRegistryRecordViewV3
    >();
    const validationIntents = new Map<string, ValidationIntentRecordView>();
    const validationCompletions = new Map<
      string,
      ValidationCompletionRecordView
    >();
    const validationFrontierGaps = new Map<
      string,
      ValidationFrontierGapRecordView
    >();
    const verifications = new Map<string, StoredVerification>();
    for (const event of rows.slice(1)) {
      if (event.kind === "campaign.prepared") {
        throw new LedgerIntegrityError(campaignId, "invalid-event-order");
      }
      if (event.kind === "campaign.run-started") {
        if (event.schema_version === 2 || event.schema_version === 3) {
          const payload =
            event.schema_version === 3
              ? semanticCampaignRunStartedPayloadV3Schema.parse(
                  this.#parsePayload(event),
                )
              : semanticCampaignRunStartedPayloadSchema.parse(
                  this.#parsePayload(event),
                );
          if (
            payload.plan.campaignId !== campaignId ||
            sha256Digest(payload.plan) !== payload.planDigest ||
            runs.has(payload.plan.runId) ||
            semanticRuns.has(payload.plan.runId)
          ) {
            throw new LedgerIntegrityError(campaignId, "invalid-event-order");
          }
          semanticRuns.set(payload.plan.runId, {
            plan: payload.plan,
            planDigest: payload.planDigest,
            startedAt: event.occurred_at,
            startedLedgerHead: event.campaign_sequence,
          });
          continue;
        }
        if (event.schema_version !== 1) {
          throw new UnsupportedLedgerSchemaError(
            event.kind,
            event.schema_version,
          );
        }
        const payload = campaignRunStartedPayloadSchema.parse(
          this.#parsePayload(event),
        );
        if (
          payload.plan.campaignId !== campaignId ||
          sha256Digest(payload.plan) !== payload.planDigest ||
          runs.has(payload.plan.runId)
        ) {
          throw new LedgerIntegrityError(campaignId, "invalid-event-order");
        }
        runs.set(payload.plan.runId, {
          plan: payload.plan,
          planDigest: payload.planDigest,
          startedAt: event.occurred_at,
          startedLedgerHead: event.campaign_sequence,
        });
        continue;
      }
      if (event.kind === "campaign.attempt-started") {
        if (event.schema_version === 2) {
          const payload = semanticCampaignAttemptStartedPayloadSchema.parse(
            this.#parsePayload(event),
          );
          const intent = payload.intent;
          const run = semanticRuns.get(intent.runId);
          if (
            intent.campaignId !== campaignId ||
            run === undefined ||
            run.completed !== undefined ||
            semanticAttempts.has(intent.attemptId) ||
            (intent.role === "root-evaluator" &&
              !validRootEvaluatorIdentity(intent)) ||
            (intent.role === "root-evaluator" &&
              intent.registryDigest !== undefined &&
              approachFamilyRegistries.get(intent.runId)?.ref.digest !==
                intent.registryDigest) ||
            (intent.role === "finder" &&
              intent.predecessorDecisionDigest !== undefined &&
              !(
                approachFamilyRegistries
                  .get(intent.runId)
                  ?.value.depthDecisions.includes(
                    intent.predecessorDecisionDigest,
                  ) ?? false
              )) ||
            ((intent.role === "root-synthesizer" ||
              intent.role === "adversarial-critic") &&
              !approachFamilyRegistries.has(intent.runId)) ||
            [...semanticAttempts.values()].some(
              (attempt) =>
                attempt.intent.runId === intent.runId &&
                attempt.intent.role === intent.role &&
                attempt.intent.ordinal === intent.ordinal,
            )
          ) {
            throw new LedgerIntegrityError(campaignId, "invalid-event-order");
          }
          semanticAttempts.set(intent.attemptId, {
            ledgerHead: event.campaign_sequence,
            occurredAt: event.occurred_at,
            intent,
          });
          continue;
        }
        if (event.schema_version !== 1) {
          throw new UnsupportedLedgerSchemaError(
            event.kind,
            event.schema_version,
          );
        }
        const payload = campaignAttemptStartedPayloadSchema.parse(
          this.#parsePayload(event),
        );
        const intent = payload.intent;
        const run = runs.get(intent.runId);
        if (
          intent.campaignId !== campaignId ||
          run === undefined ||
          run.completed !== undefined ||
          attempts.has(intent.attemptId) ||
          [...attempts.values()].some(
            (attempt) =>
              attempt.intent.runId === intent.runId &&
              attempt.intent.leaseId === intent.leaseId &&
              attempt.intent.ordinal === intent.ordinal,
          )
        ) {
          throw new LedgerIntegrityError(campaignId, "invalid-event-order");
        }
        attempts.set(intent.attemptId, {
          ledgerHead: event.campaign_sequence,
          occurredAt: event.occurred_at,
          intent,
        });
        continue;
      }
      if (event.kind === "campaign.attempt-completed") {
        if (event.schema_version === 2) {
          const payload = semanticCampaignAttemptCompletedPayloadSchema.parse(
            this.#parsePayload(event),
          );
          const completion = payload.completion;
          const existing = semanticAttempts.get(completion.attemptId);
          if (
            completion.campaignId !== campaignId ||
            existing === undefined ||
            existing.completion !== undefined ||
            (completion.role === "root-evaluator" &&
              !validRootEvaluatorIdentity(completion)) ||
            !semanticAttemptIdentityMatches(existing.intent, completion)
          ) {
            throw new LedgerIntegrityError(campaignId, "invalid-event-order");
          }
          semanticAttempts.set(completion.attemptId, {
            ...existing,
            completion: {
              ledgerHead: event.campaign_sequence,
              occurredAt: event.occurred_at,
              value: completion,
            },
          });
          continue;
        }
        if (event.schema_version !== 1) {
          throw new UnsupportedLedgerSchemaError(
            event.kind,
            event.schema_version,
          );
        }
        const payload = campaignAttemptCompletedPayloadSchema.parse(
          this.#parsePayload(event),
        );
        const completion = payload.completion;
        const existing = attempts.get(completion.attemptId);
        if (
          completion.campaignId !== campaignId ||
          existing === undefined ||
          existing.completion !== undefined ||
          existing.intent.runId !== completion.runId ||
          existing.intent.leaseId !== completion.leaseId ||
          existing.intent.ordinal !== completion.ordinal ||
          existing.intent.workWaveDigest !== completion.workWaveDigest ||
          completion.result.attemptId !== completion.attemptId ||
          completion.result.leaseId !== completion.leaseId
        ) {
          throw new LedgerIntegrityError(campaignId, "invalid-event-order");
        }
        attempts.set(completion.attemptId, {
          ...existing,
          completion: {
            ledgerHead: event.campaign_sequence,
            occurredAt: event.occurred_at,
            value: completion,
          },
        });
        continue;
      }
      if (event.kind === "campaign.finder-checkpointed") {
        if (event.schema_version !== 1) {
          throw new UnsupportedLedgerSchemaError(
            event.kind,
            event.schema_version,
          );
        }
        const { checkpoint } = semanticFinderCheckpointedPayloadSchema.parse(
          this.#parsePayload(event),
        );
        const run = semanticRuns.get(checkpoint.runId);
        const attempt = semanticAttempts.get(checkpoint.attemptId);
        if (
          checkpoint.campaignId !== campaignId ||
          run === undefined ||
          run.completed !== undefined ||
          attempt === undefined ||
          attempt.completion !== undefined ||
          !semanticCheckpointMatchesAttempt(checkpoint, attempt.intent) ||
          run.plan.target.digest !== checkpoint.targetSnapshotDigest ||
          run.plan.manifest.digest !== checkpoint.manifestDigest ||
          semanticFinderCheckpoints.has(checkpoint.id) ||
          [...semanticFinderCheckpoints.values()].some(
            (candidate) =>
              candidate.checkpoint.attemptId === checkpoint.attemptId &&
              candidate.checkpoint.ordinal === checkpoint.ordinal,
          )
        ) {
          throw new LedgerIntegrityError(campaignId, "invalid-event-order");
        }
        semanticFinderCheckpoints.set(checkpoint.id, {
          ledgerHead: event.campaign_sequence,
          occurredAt: event.occurred_at,
          checkpoint,
        });
        continue;
      }
      if (event.kind === "exploration.iteration-decided") {
        if (event.schema_version === 3) {
          const payload = semanticIterationDecidedPayloadV3Schema.parse(
            this.#parsePayload(event),
          );
          const run = semanticRuns.get(payload.runId);
          if (
            run === undefined ||
            run.completed !== undefined ||
            payload.decision.targetSnapshotDigest !== run.plan.target.digest ||
            payload.decision.manifestDigest !== run.plan.manifest.digest ||
            semanticIterationDecisions.has(payload.decision.digest) ||
            semanticIterationDecisionsV3.has(payload.decision.digest) ||
            approachFamilyRegistries.has(payload.runId) ||
            approachFamilyRegistriesV3.has(payload.runId)
          ) {
            throw new LedgerIntegrityError(campaignId, "invalid-event-order");
          }
          const registry = projectApproachFamilyRegistryV3({
            campaignId,
            runId: payload.runId,
            target: run.plan.target,
            manifest: run.plan.manifest,
            decisions: [payload.decision],
            families: payload.openedFamilies,
          });
          if (canonicalJson(registry.ref) !== canonicalJson(payload.registry)) {
            throw new LedgerIntegrityError(campaignId, "invalid-event-order");
          }
          semanticIterationDecisionsV3.set(payload.decision.digest, {
            ledgerHead: event.campaign_sequence,
            occurredAt: event.occurred_at,
            decision: payload.decision,
            registry: payload.registry,
          });
          approachFamilyRegistriesV3.set(payload.runId, registry);
          continue;
        }
        if (event.schema_version !== 2) {
          throw new UnsupportedLedgerSchemaError(
            event.kind,
            event.schema_version,
          );
        }
        const payload = semanticIterationDecidedPayloadSchema.parse(
          this.#parsePayload(event),
        );
        const run = semanticRuns.get(payload.runId);
        const previousRegistry = approachFamilyRegistries.get(
          payload.runId,
        )?.value;
        if (
          run === undefined ||
          run.completed !== undefined ||
          payload.decision.targetSnapshotDigest !== run.plan.target.digest ||
          payload.decision.manifestDigest !== run.plan.manifest.digest ||
          semanticIterationDecisions.has(payload.decision.digest) ||
          (previousRegistry === undefined &&
            [...semanticAttempts.values()].some(
              (attempt) =>
                attempt.intent.runId === payload.runId &&
                (attempt.intent.role === "root-synthesizer" ||
                  attempt.intent.role === "adversarial-critic"),
            ))
        ) {
          throw new LedgerIntegrityError(campaignId, "invalid-event-order");
        }
        const registry = projectApproachFamilyRegistry({
          campaignId,
          runId: payload.runId,
          target: run.plan.target,
          manifest: run.plan.manifest,
          decisions: [...(previousRegistry?.decisions ?? []), payload.decision],
          families: [
            ...(previousRegistry?.families ?? []),
            ...payload.openedFamilies,
          ],
        });
        if (canonicalJson(registry.ref) !== canonicalJson(payload.registry)) {
          throw new LedgerIntegrityError(campaignId, "invalid-event-order");
        }
        semanticIterationDecisions.set(payload.decision.digest, {
          ledgerHead: event.campaign_sequence,
          occurredAt: event.occurred_at,
          decision: payload.decision,
          registry: payload.registry,
        });
        approachFamilyRegistries.set(payload.runId, registry);
        continue;
      }
      if (event.kind === "exploration.depth-work-queued") {
        if (event.schema_version !== 2) {
          throw new UnsupportedLedgerSchemaError(
            event.kind,
            event.schema_version,
          );
        }
        const payload = semanticDepthWorkQueuedPayloadV2Schema.parse(
          this.#parsePayload(event),
        );
        const run = semanticRuns.get(payload.runId);
        const decision = semanticIterationDecisionsV3.get(
          payload.decision.digest,
        );
        const registry = approachFamilyRegistriesV3.get(payload.runId);
        if (
          run === undefined ||
          run.completed !== undefined ||
          run.plan.schemaVersion !== 3 ||
          decision === undefined ||
          registry === undefined ||
          semanticDepthWorkQueuesV2.has(payload.runId) ||
          payload.queue.campaignId !== campaignId ||
          payload.queue.runId !== payload.runId ||
          payload.queue.predecessorDecisionDigest !== payload.decision.digest ||
          payload.queue.targetSnapshotDigest !== run.plan.target.digest ||
          payload.queue.manifestDigest !== run.plan.manifest.digest ||
          payload.decision.workWaveDigest !==
            decision.decision.workWaveDigest ||
          canonicalJson(payload.decision) !==
            canonicalJson(decision.decision) ||
          !registry.value.decisions.some(
            (candidate) => candidate.digest === payload.decision.digest,
          )
        ) {
          throw new LedgerIntegrityError(campaignId, "invalid-event-order");
        }
        semanticDepthWorkQueuesV2.set(payload.runId, {
          ledgerHead: event.campaign_sequence,
          occurredAt: event.occurred_at,
          queue: payload.queue,
        });
        continue;
      }
      if (event.kind === "validation.intended") {
        if (event.schema_version !== 1) {
          throw new UnsupportedLedgerSchemaError(
            event.kind,
            event.schema_version,
          );
        }
        const payload = validationIntendedPayloadSchema.parse(
          this.#parsePayload(event),
        );
        const run = semanticRuns.get(payload.runId);
        const previous = approachFamilyRegistriesV3.get(payload.runId);
        if (
          run === undefined ||
          run.completed !== undefined ||
          previous === undefined ||
          previous.ref.digest !== payload.predecessorRegistryDigest ||
          new Set(payload.intents.map((intent) => intent.id)).size !==
            payload.intents.length ||
          payload.intents.some((intent) => {
            const identity = {
              kind: intent.kind,
              schemaVersion: intent.schemaVersion,
              campaignId: intent.campaignId,
              runId: intent.runId,
              validationId: intent.validationId,
            };
            return (
              intent.id !== sha256Digest(identity) ||
              intent.campaignId !== campaignId ||
              intent.runId !== payload.runId ||
              intent.validationId !== intent.candidate.id ||
              intent.candidate.targetSnapshotDigest !==
                run.plan.target.digest ||
              intent.candidate.manifestDigest !== run.plan.manifest.digest ||
              new Set(intent.rootEvaluationDigests).size !==
                intent.rootEvaluationDigests.length ||
              intent.rootEvaluationDigests.some(
                (digest) =>
                  !semanticIterationDecisionsV3.has(digest) ||
                  !previous.value.decisions.some(
                    (decision) => decision.digest === digest,
                  ),
              ) ||
              validationIntents.has(intent.id)
            );
          })
        ) {
          throw new LedgerIntegrityError(campaignId, "invalid-event-order");
        }
        const projected = attachApproachFamilyValidationIntentsV3({
          registry: previous.value,
          intents: payload.intents,
        });
        if (canonicalJson(projected.ref) !== canonicalJson(payload.registry)) {
          throw new LedgerIntegrityError(campaignId, "invalid-event-order");
        }
        for (const intent of payload.intents) {
          validationIntents.set(intent.id, {
            ledgerHead: event.campaign_sequence,
            occurredAt: event.occurred_at,
            intent,
            registry: payload.registry,
          });
        }
        approachFamilyRegistriesV3.set(payload.runId, projected);
        continue;
      }
      if (event.kind === "validation.completed") {
        if (event.schema_version !== 1) {
          throw new UnsupportedLedgerSchemaError(
            event.kind,
            event.schema_version,
          );
        }
        const payload = validationCompletedPayloadSchema.parse(
          this.#parsePayload(event),
        );
        const run = semanticRuns.get(payload.runId);
        const previous = approachFamilyRegistriesV3.get(payload.runId);
        const intentId = sha256Digest({
          kind: "validation-intent",
          schemaVersion: 1,
          campaignId,
          runId: payload.runId,
          validationId: payload.completion.validation.validationId,
        });
        const intent = validationIntents.get(intentId);
        if (
          run === undefined ||
          run.completed !== undefined ||
          previous === undefined ||
          previous.ref.digest !== payload.predecessorRegistryDigest ||
          intent === undefined ||
          intent.intent.candidate.id !==
            payload.completion.validation.candidateId ||
          canonicalJson(intent.intent.approachFamilyIds) !==
            canonicalJson(payload.completion.approachFamilyIds) ||
          validationCompletions.has(
            payload.completion.validation.validationId,
          ) ||
          (payload.completion.frontierGap !== undefined &&
            (payload.completion.frontierGap.validationId !==
              payload.completion.validation.validationId ||
              payload.completion.frontierGap.candidateId !==
                payload.completion.validation.candidateId ||
              payload.completion.frontierGap.targetSnapshotDigest !==
                run.plan.target.digest ||
              payload.completion.frontierGap.manifestDigest !==
                run.plan.manifest.digest ||
              payload.completion.frontierGap.approachFamilies !==
                payload.completion.approachFamilyIds.length ||
              validationFrontierGaps.has(
                payload.completion.validation.validationId,
              )))
        ) {
          throw new LedgerIntegrityError(campaignId, "invalid-event-order");
        }
        const projected = resolveApproachFamilyValidationV3({
          registry: previous.value,
          resolution: {
            validationId: payload.completion.validation.validationId,
            recordDigest: payload.completion.validation.digest,
            disposition: payload.completion.disposition,
            approachFamilyIds: payload.completion.approachFamilyIds,
          },
        });
        if (canonicalJson(projected.ref) !== canonicalJson(payload.registry)) {
          throw new LedgerIntegrityError(campaignId, "invalid-event-order");
        }
        validationCompletions.set(payload.completion.validation.validationId, {
          ledgerHead: event.campaign_sequence,
          occurredAt: event.occurred_at,
          completion: payload.completion,
          registry: payload.registry,
        });
        if (payload.completion.frontierGap !== undefined) {
          validationFrontierGaps.set(
            payload.completion.validation.validationId,
            {
              ledgerHead: event.campaign_sequence,
              occurredAt: event.occurred_at,
              frontierGap: payload.completion.frontierGap,
            },
          );
        }
        approachFamilyRegistriesV3.set(payload.runId, projected);
        continue;
      }
      if (event.kind === "exploration.depth-iteration-decided") {
        if (event.schema_version !== 1 && event.schema_version !== 2) {
          throw new UnsupportedLedgerSchemaError(
            event.kind,
            event.schema_version,
          );
        }
        const rawPayload = this.#parsePayload(event);
        let payload: z.infer<
          typeof semanticDepthIterationDecidedPayloadV1Schema
        >;
        let openedFamilies: z.infer<typeof approachFamilySchema>[];
        if (event.schema_version === 1) {
          payload =
            semanticDepthIterationDecidedPayloadV1Schema.parse(rawPayload);
          openedFamilies = [];
        } else {
          const current =
            semanticDepthIterationDecidedPayloadV2Schema.parse(rawPayload);
          payload = current;
          openedFamilies = current.openedFamilies;
        }
        const run = semanticRuns.get(payload.runId);
        const previous = approachFamilyRegistries.get(payload.runId);
        if (
          run === undefined ||
          run.completed !== undefined ||
          previous === undefined ||
          previous.ref.digest !== payload.predecessorRegistryDigest ||
          payload.decision.registryDigest !== previous.ref.digest ||
          payload.decision.targetSnapshotDigest !== run.plan.target.digest ||
          payload.decision.manifestDigest !== run.plan.manifest.digest ||
          previous.value.depthDecisions.includes(payload.decision.digest)
        ) {
          throw new LedgerIntegrityError(campaignId, "invalid-event-order");
        }
        const updated = new Map(
          payload.updatedFamilies.map((family) => [family.id, family]),
        );
        const transitions = new Map(
          payload.transitions.map((transition) => [
            transition.familyId,
            transition,
          ]),
        );
        if (
          updated.size !== payload.updatedFamilies.length ||
          transitions.size !== payload.transitions.length ||
          updated.size !== transitions.size
        ) {
          throw new LedgerIntegrityError(campaignId, "invalid-event-order");
        }
        const families = previous.value.families.map((family) => {
          const next = updated.get(family.id);
          if (next === undefined) return family;
          const transition = transitions.get(family.id);
          if (
            transition === undefined ||
            canonicalJson(transition.before) !==
              canonicalJson(referenceApproachFamily(family)) ||
            canonicalJson(transition.after) !==
              canonicalJson(referenceApproachFamily(next))
          ) {
            throw new LedgerIntegrityError(campaignId, "invalid-event-order");
          }
          updated.delete(family.id);
          transitions.delete(family.id);
          return next;
        });
        if (updated.size > 0 || transitions.size > 0) {
          throw new LedgerIntegrityError(campaignId, "invalid-event-order");
        }
        const opened = new Map(
          openedFamilies.map((family) => [family.id, family]),
        );
        if (
          opened.size !== openedFamilies.length ||
          openedFamilies.some(
            (family) =>
              previous.value.families.some(
                (existing) => existing.id === family.id,
              ) ||
              family.campaignId !== campaignId ||
              family.runId !== payload.runId ||
              family.openingDecision.kind !== "depth-iteration-decision" ||
              canonicalJson(family.openingDecision) !==
                canonicalJson(payload.decision),
          )
        ) {
          throw new LedgerIntegrityError(campaignId, "invalid-event-order");
        }
        const registry = projectApproachFamilyRegistry({
          campaignId,
          runId: payload.runId,
          target: previous.value.target,
          manifest: previous.value.manifest,
          decisions: previous.value.decisions,
          depthDecisions: [
            ...previous.value.depthDecisions,
            payload.decision.digest,
          ],
          families: [...families, ...openedFamilies],
        });
        if (canonicalJson(registry.ref) !== canonicalJson(payload.registry)) {
          throw new LedgerIntegrityError(campaignId, "invalid-event-order");
        }
        approachFamilyRegistries.set(payload.runId, registry);
        continue;
      }
      if (event.kind === "exploration.family-evidence-attached") {
        if (event.schema_version !== 1) {
          throw new UnsupportedLedgerSchemaError(
            event.kind,
            event.schema_version,
          );
        }
        const payload = semanticFamilyEvidenceAttachedPayloadSchema.parse(
          this.#parsePayload(event),
        );
        const run = semanticRuns.get(payload.runId);
        const previous = approachFamilyRegistries.get(payload.runId);
        if (
          run === undefined ||
          run.completed !== undefined ||
          previous === undefined ||
          previous.ref.digest !== payload.predecessorRegistryDigest ||
          !previous.value.depthDecisions.includes(payload.decisionDigest)
        ) {
          throw new LedgerIntegrityError(campaignId, "invalid-event-order");
        }
        const updated = new Map(
          payload.updatedFamilies.map((family) => [family.id, family]),
        );
        const attachments = new Map(
          payload.attachments.map((attachment) => [
            attachment.familyId,
            attachment,
          ]),
        );
        if (
          updated.size !== payload.updatedFamilies.length ||
          attachments.size !== payload.attachments.length ||
          updated.size !== attachments.size
        ) {
          throw new LedgerIntegrityError(campaignId, "invalid-event-order");
        }
        const families = previous.value.families.map((family) => {
          const next = updated.get(family.id);
          if (next === undefined) return family;
          const attachment = attachments.get(family.id);
          if (
            attachment === undefined ||
            attachment.evidenceAdded <= 0 ||
            next.round !== family.round + 1 ||
            canonicalJson(attachment.before) !==
              canonicalJson(referenceApproachFamily(family)) ||
            canonicalJson(attachment.after) !==
              canonicalJson(referenceApproachFamily(next))
          ) {
            throw new LedgerIntegrityError(campaignId, "invalid-event-order");
          }
          updated.delete(family.id);
          attachments.delete(family.id);
          return next;
        });
        if (updated.size > 0 || attachments.size > 0) {
          throw new LedgerIntegrityError(campaignId, "invalid-event-order");
        }
        const registry = projectApproachFamilyRegistry({
          campaignId,
          runId: payload.runId,
          target: previous.value.target,
          manifest: previous.value.manifest,
          decisions: previous.value.decisions,
          depthDecisions: previous.value.depthDecisions,
          families,
        });
        if (canonicalJson(registry.ref) !== canonicalJson(payload.registry)) {
          throw new LedgerIntegrityError(campaignId, "invalid-event-order");
        }
        approachFamilyRegistries.set(payload.runId, registry);
        continue;
      }
      if (event.kind === "exploration.family-verification-resolved") {
        if (event.schema_version !== 1) {
          throw new UnsupportedLedgerSchemaError(
            event.kind,
            event.schema_version,
          );
        }
        const payload = semanticFamilyVerificationResolvedPayloadSchema.parse(
          this.#parsePayload(event),
        );
        const run = semanticRuns.get(payload.runId);
        const previous = approachFamilyRegistries.get(payload.runId);
        if (
          run === undefined ||
          run.completed !== undefined ||
          previous === undefined ||
          previous.ref.digest !== payload.predecessorRegistryDigest
        ) {
          throw new LedgerIntegrityError(campaignId, "invalid-event-order");
        }
        const updated = new Map(
          payload.updatedFamilies.map((family) => [family.id, family]),
        );
        const resolutionsByFamily = new Map<
          string,
          (typeof payload.resolutions)[number][]
        >();
        for (const resolution of payload.resolutions) {
          const values = resolutionsByFamily.get(resolution.familyId) ?? [];
          values.push(resolution);
          resolutionsByFamily.set(resolution.familyId, values);
        }
        const families = previous.value.families.map((family) => {
          const next = updated.get(family.id);
          if (next === undefined) return family;
          const resolutions = resolutionsByFamily.get(family.id);
          if (
            resolutions === undefined ||
            resolutions.some((resolution) => {
              const verification = verifications.get(
                resolution.verification.verificationId,
              )?.completed;
              return (
                canonicalJson(resolution.before) !==
                  canonicalJson(referenceApproachFamily(family)) ||
                canonicalJson(resolution.after) !==
                  canonicalJson(referenceApproachFamily(next)) ||
                verification === undefined ||
                canonicalJson(verification.ref) !==
                  canonicalJson(resolution.verification) ||
                !family.pendingVerifications.includes(
                  resolution.verification.verificationId,
                )
              );
            })
          ) {
            throw new LedgerIntegrityError(campaignId, "invalid-event-order");
          }
          updated.delete(family.id);
          resolutionsByFamily.delete(family.id);
          return next;
        });
        if (updated.size > 0 || resolutionsByFamily.size > 0) {
          throw new LedgerIntegrityError(campaignId, "invalid-event-order");
        }
        const registry = projectApproachFamilyRegistry({
          campaignId,
          runId: payload.runId,
          target: previous.value.target,
          manifest: previous.value.manifest,
          decisions: previous.value.decisions,
          depthDecisions: previous.value.depthDecisions,
          families,
        });
        if (canonicalJson(registry.ref) !== canonicalJson(payload.registry)) {
          throw new LedgerIntegrityError(campaignId, "invalid-event-order");
        }
        approachFamilyRegistries.set(payload.runId, registry);
        continue;
      }
      if (event.kind === "campaign.run-completed") {
        if (event.schema_version === 3) {
          const payload = semanticCampaignRunCompletedPayloadV3Schema.parse(
            this.#parsePayload(event),
          );
          const existing = semanticRuns.get(payload.record.runId);
          if (
            existing === undefined ||
            existing.plan.schemaVersion !== 3 ||
            existing.completed !== undefined ||
            payload.record.campaignId !== campaignId ||
            payload.record.planDigest !== existing.planDigest ||
            payload.record.completedAt !== event.occurred_at ||
            sha256Digest(payload.record) !== payload.recordDigest
          ) {
            throw new LedgerIntegrityError(campaignId, "invalid-event-order");
          }
          const completedAttemptRefs = [...semanticAttempts.values()]
            .filter((attempt) => attempt.intent.runId === payload.record.runId)
            .flatMap((attempt) =>
              attempt.completion === undefined
                ? []
                : [attempt.completion.value.result],
            )
            .sort((left, right) => compareText(left.digest, right.digest));
          const recordedAttemptRefs = [...payload.record.attempts].sort(
            (left, right) => compareText(left.digest, right.digest),
          );
          if (
            canonicalJson(completedAttemptRefs) !==
            canonicalJson(recordedAttemptRefs)
          ) {
            throw new LedgerIntegrityError(campaignId, "invalid-event-order");
          }
          if ("iterationDecision" in payload.record) {
            const decision = semanticIterationDecisionsV3.get(
              payload.record.iterationDecisionRef.digest,
            );
            const registry = approachFamilyRegistriesV3.get(
              payload.record.runId,
            );
            const queuedDepthWork = semanticDepthWorkQueuesV2.get(
              payload.record.runId,
            );
            if (
              decision === undefined ||
              registry === undefined ||
              canonicalJson(decision.decision) !==
                canonicalJson(payload.record.iterationDecisionRef) ||
              canonicalJson(registry.ref) !==
                canonicalJson(payload.record.approachFamilyRegistry) ||
              (queuedDepthWork === undefined) !==
                (payload.record.depthWorkQueue === undefined) ||
              (queuedDepthWork !== undefined &&
                payload.record.depthWorkQueue !== undefined &&
                canonicalJson(queuedDepthWork.queue) !==
                  canonicalJson(payload.record.depthWorkQueue))
            ) {
              throw new LedgerIntegrityError(campaignId, "invalid-event-order");
            }
            const runIntentIds = new Set(
              [...validationIntents.values()]
                .filter(
                  (record) => record.intent.runId === payload.record.runId,
                )
                .map((record) => record.intent.validationId),
            );
            const recordedCompletions = [...validationCompletions.values()]
              .filter((record) =>
                runIntentIds.has(record.completion.validation.validationId),
              )
              .sort((left, right) =>
                compareText(
                  left.completion.validation.validationId,
                  right.completion.validation.validationId,
                ),
              );
            const embeddedValidations = [...payload.record.validations]
              .map((validation) => ({
                ref: {
                  kind: validation.kind,
                  schemaVersion: validation.schemaVersion,
                  validationId: validation.validationId,
                  candidateId: validation.candidateId,
                  digest: sha256Digest(validation),
                },
                disposition: validation.status,
              }))
              .sort((left, right) =>
                compareText(left.ref.validationId, right.ref.validationId),
              );
            if (
              canonicalJson(
                recordedCompletions.map((record) => ({
                  ref: record.completion.validation,
                  disposition: record.completion.disposition,
                })),
              ) !== canonicalJson(embeddedValidations)
            ) {
              throw new LedgerIntegrityError(campaignId, "invalid-event-order");
            }
            const recordedFrontierGaps = recordedCompletions
              .flatMap((record) =>
                record.completion.frontierGap === undefined
                  ? []
                  : [record.completion.frontierGap],
              )
              .sort((left, right) => compareText(left.digest, right.digest));
            const embeddedFrontierGaps = [
              ...payload.record.validationFrontierGaps,
            ].sort((left, right) => compareText(left.digest, right.digest));
            if (
              canonicalJson(recordedFrontierGaps) !==
              canonicalJson(embeddedFrontierGaps)
            ) {
              throw new LedgerIntegrityError(campaignId, "invalid-event-order");
            }
          }
          semanticRuns.set(payload.record.runId, {
            ...existing,
            completionInputDigest: payload.completionInputDigest,
            completed: {
              ledgerHead: event.campaign_sequence,
              occurredAt: event.occurred_at,
              ref: currentSemanticCampaignRunRef(
                payload.record.runId,
                payload.recordDigest,
                payload.record.decision.kind,
              ),
              value: payload.record,
            },
          });
          continue;
        }
        if (event.schema_version === 2) {
          const payload = semanticCampaignRunCompletedPayloadSchema.parse(
            this.#parsePayload(event),
          );
          const existing = semanticRuns.get(payload.record.runId);
          if (
            existing === undefined ||
            existing.completed !== undefined ||
            payload.record.campaignId !== campaignId ||
            payload.record.planDigest !== existing.planDigest ||
            payload.record.completedAt !== event.occurred_at ||
            sha256Digest(payload.record) !== payload.recordDigest
          ) {
            throw new LedgerIntegrityError(campaignId, "invalid-event-order");
          }
          if ("iterationDecision" in payload.record) {
            const decision = semanticIterationDecisions.get(
              payload.record.iterationDecisionRef.digest,
            );
            const registry = approachFamilyRegistries.get(payload.record.runId);
            if (
              decision === undefined ||
              registry === undefined ||
              canonicalJson(decision.decision) !==
                canonicalJson(payload.record.iterationDecisionRef) ||
              canonicalJson(registry.ref) !==
                canonicalJson(payload.record.approachFamilyRegistry)
            ) {
              throw new LedgerIntegrityError(campaignId, "invalid-event-order");
            }
          }
          const completedAttemptRefs = [...semanticAttempts.values()]
            .filter((attempt) => attempt.intent.runId === payload.record.runId)
            .flatMap((attempt) =>
              attempt.completion === undefined
                ? []
                : [attempt.completion.value.result],
            )
            .sort((left, right) => left.digest.localeCompare(right.digest));
          const recordedAttemptRefs = [...payload.record.attempts].sort(
            (left, right) => left.digest.localeCompare(right.digest),
          );
          if (
            canonicalJson(completedAttemptRefs) !==
            canonicalJson(recordedAttemptRefs)
          ) {
            throw new LedgerIntegrityError(campaignId, "invalid-event-order");
          }
          semanticRuns.set(payload.record.runId, {
            ...existing,
            completionInputDigest: payload.completionInputDigest,
            completed: {
              ledgerHead: event.campaign_sequence,
              occurredAt: event.occurred_at,
              ref: semanticCampaignRunRef(
                payload.record.runId,
                payload.recordDigest,
                payload.record.decision.kind,
              ),
              value: payload.record,
            },
          });
          continue;
        }
        if (event.schema_version !== 1) {
          throw new UnsupportedLedgerSchemaError(
            event.kind,
            event.schema_version,
          );
        }
        const payload = campaignRunCompletedPayloadSchema.parse(
          this.#parsePayload(event),
        );
        const existing = runs.get(payload.record.runId);
        if (
          existing === undefined ||
          existing.completed !== undefined ||
          payload.record.campaignId !== campaignId ||
          payload.record.planDigest !== existing.planDigest ||
          payload.record.completedAt !== event.occurred_at
        ) {
          throw new LedgerIntegrityError(campaignId, "invalid-event-order");
        }
        if (sha256Digest(payload.record) !== payload.recordDigest) {
          throw new LedgerIntegrityError(
            campaignId,
            "campaign-run-record-digest-mismatch",
          );
        }
        const completedAttemptRefs = [...attempts.values()]
          .filter((attempt) => attempt.intent.runId === payload.record.runId)
          .flatMap((attempt) =>
            attempt.completion === undefined
              ? []
              : [attempt.completion.value.result],
          )
          .sort((left, right) => left.digest.localeCompare(right.digest));
        const recordedAttemptRefs = [...payload.record.attempts].sort(
          (left, right) => left.digest.localeCompare(right.digest),
        );
        if (
          canonicalJson(completedAttemptRefs) !==
          canonicalJson(recordedAttemptRefs)
        ) {
          throw new LedgerIntegrityError(campaignId, "invalid-event-order");
        }
        runs.set(payload.record.runId, {
          ...existing,
          completionInputDigest: payload.completionInputDigest,
          completed: {
            ledgerHead: event.campaign_sequence,
            occurredAt: event.occurred_at,
            ref: campaignRunRef(
              payload.record.runId,
              payload.recordDigest,
              payload.record.decision.kind,
            ),
            value: payload.record,
          },
        });
        continue;
      }
      if (event.kind === "verification.started") {
        if (event.schema_version !== 1 && event.schema_version !== 2) {
          throw new UnsupportedLedgerSchemaError(
            event.kind,
            event.schema_version,
          );
        }
        const payload = verificationStartedPayloadSchema.parse(
          this.#parsePayload(event),
        );
        if (
          payload.plan.schemaVersion !== event.schema_version ||
          payload.plan.campaignId !== campaignId ||
          sha256Digest(payload.plan) !== payload.planDigest ||
          verifications.has(payload.plan.verificationId)
        ) {
          throw new LedgerIntegrityError(campaignId, "invalid-event-order");
        }
        verifications.set(payload.plan.verificationId, {
          plan: payload.plan,
          planDigest: payload.planDigest,
          startedAt: event.occurred_at,
          startedLedgerHead: event.campaign_sequence,
        });
        continue;
      }
      if (event.kind === "verification.completed") {
        if (event.schema_version !== 1 && event.schema_version !== 2) {
          throw new UnsupportedLedgerSchemaError(
            event.kind,
            event.schema_version,
          );
        }
        const payload = verificationCompletedPayloadSchema.parse(
          this.#parsePayload(event),
        );
        const existing = verifications.get(payload.record.verificationId);
        if (
          existing === undefined ||
          existing.completed !== undefined ||
          payload.record.schemaVersion !== event.schema_version ||
          payload.record.schemaVersion !== existing.plan.schemaVersion ||
          payload.record.campaignId !== campaignId ||
          payload.record.planDigest !== existing.planDigest ||
          payload.record.completedAt !== event.occurred_at
        ) {
          throw new LedgerIntegrityError(campaignId, "invalid-event-order");
        }
        if (sha256Digest(payload.record) !== payload.recordDigest) {
          throw new LedgerIntegrityError(
            campaignId,
            "verification-record-digest-mismatch",
          );
        }
        verifications.set(payload.record.verificationId, {
          ...existing,
          completionInputDigest: payload.completionInputDigest,
          completed: {
            ledgerHead: event.campaign_sequence,
            occurredAt: event.occurred_at,
            ref: verificationRef(
              payload.record.schemaVersion,
              payload.record.verificationId,
              payload.recordDigest,
              payload.record.outcome.kind,
            ),
            value: payload.record,
          },
        });
        continue;
      }

      throw new UnsupportedLedgerSchemaError(event.kind, event.schema_version);
    }

    return {
      preparation: {
        campaignId,
        ledgerHead: rows.length,
        occurredAt: first.occurred_at,
        inputDigest: preparationInputDigest,
        input: preparationInput,
        ...(targetFileManifest === undefined ? {} : { targetFileManifest }),
      },
      runs,
      attempts,
      semanticRuns,
      semanticAttempts,
      semanticFinderCheckpoints,
      semanticIterationDecisions,
      semanticIterationDecisionsV3,
      semanticDepthWorkQueuesV2,
      approachFamilyRegistries,
      approachFamilyRegistriesV3,
      validationIntents,
      validationCompletions,
      validationFrontierGaps,
      verifications,
    };
  }

  #parsePayload(event: StoredEventRow): unknown {
    return JSON.parse(event.payload_json) as unknown;
  }
}

export function openSqliteResearchRecord(
  options: OpenResearchRecordOptions,
): ResearchRecord {
  return new SqliteResearchRecord(options);
}
