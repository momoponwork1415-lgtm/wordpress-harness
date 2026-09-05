import { z } from "zod";

import type { TargetSnapshotRef } from "../contracts.js";
import { targetSnapshotRefSchema } from "../contracts.js";
import {
  adversarialCritiqueRefSchema,
  chainSynthesisRefSchema,
  criticFrontierGapRefSchema,
} from "../exploration/semantic-adversarial-critique.js";
import {
  approachFamilyRegistryRefSchema,
  semanticIterationDecisionRefSchema,
} from "../exploration/semantic-approach-family-registry.js";
import {
  approachFamilyRegistryRefV3Schema,
  semanticIterationDecisionRefV3Schema,
} from "../exploration/semantic-approach-family-registry-v3.js";
import {
  explorationPolicyRefSchema,
  type FocusArea,
  type WorkLease,
  type WorkWavePlan,
} from "../exploration/contracts.js";
import {
  evaluationIncompleteDecisionSchema,
  evaluationIncompleteDecisionV3Schema,
  iterationDecisionV2Schema,
  iterationDecisionV3Schema,
  oracleFreeTargetMetadataSchema,
  planningIncompleteDecisionSchema,
  semanticRootPlanningPolicySchema,
  semanticWaveTerminalRefSchema,
  semanticWorkWaveRefSchema,
  sourceBoundHypothesisArtifactRefSchema,
} from "../exploration/semantic-contracts.js";
import {
  semanticDepthWorkQueueRefSchema,
  semanticDepthWorkQueueRefV2Schema,
} from "../exploration/semantic-depth-work-queue.js";
import { depthIterationDecisionRefSchema } from "../exploration/semantic-depth-evaluation.js";
import { currentDepthIterationDecisionRefSchema } from "../exploration/semantic-depth-evaluation-v2.js";
import { semanticMissingLinkWavePlanRefSchema } from "../exploration/semantic-missing-link-wave.js";
import {
  coverageObservationSchema,
  semanticCoverageClosureRefSchema,
  semanticCoverageClosureSchema,
} from "../exploration/semantic-coverage-closure.js";
import {
  attemptExecutionResultV2RefSchema,
  attemptPlanSchema,
  structuredModelProfileSchema,
  type ModelExecution,
} from "../model-execution/contracts.js";
import type { JsonArtifactStore } from "../research-record/contracts.js";
import {
  surfaceMapRefSchema,
  targetFileManifestRefSchema,
  type SurfaceMap,
} from "../source-mapping/contracts.js";
import { sourceToolPolicyRefSchema } from "../source-mapping/source-evidence-contracts.js";
import {
  labBaselineRefSchema,
  verificationBudgetV2Schema,
  verificationBlockReasonSchema,
  verificationRecordRefSchema,
  type IndependentVerifier,
  type LabControl,
  type VerificationRecordRef,
} from "../verification/contracts.js";
import {
  validationFrontierGapRefSchema,
  validationRecordSchema,
} from "../validation/contracts.js";
import {
  humanReviewPacketHandoffSchema,
  humanReviewPacketPreparationFailureSchema,
  type HumanReviewPacketDelivery,
} from "../validation/human-review-packet.js";
import {
  runtimeVerificationPacketHandoffSchema,
  runtimeVerificationPacketPreparationFailureSchema,
  type RuntimeVerificationPacketDelivery,
} from "../validation/runtime-verification-packet.js";

const identifierSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
const digestSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const finderAttemptsPerWaveCeiling = 4;

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

export const boundaryPairEvidenceRefSchema = z.strictObject({
  kind: z.literal("boundary-pair-evidence"),
  schemaVersion: z.literal(1),
  calibrationContextDigest: digestSchema,
  digest: digestSchema,
});

export const calibrationReviewResultSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("pending"),
    schemaVersion: z.literal(1),
  }),
  z.strictObject({
    kind: z.literal("complete"),
    schemaVersion: z.literal(1),
    evidence: boundaryPairEvidenceRefSchema,
  }),
]);

export const finderAttemptMaterializationSchema = z.strictObject({
  kind: z.literal("finder-attempt-materialization"),
  schemaVersion: z.literal(1),
  modelProfile: attemptPlanSchema.shape.modelProfile,
  prompt: attemptPlanSchema.shape.prompt,
  maxOutputBytes: z.number().int().positive(),
  sourceEvidence: z
    .strictObject({
      policy: sourceToolPolicyRefSchema,
      maxQueries: z.number().int().positive(),
    })
    .optional(),
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
    sourceEvidence: z
      .strictObject({
        policy: sourceToolPolicyRefSchema,
        maxQueries: z.number().int().positive(),
      })
      .optional(),
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
    maxFinderAttempts: z
      .number()
      .int()
      .min(1)
      .max(finderAttemptsPerWaveCeiling),
    verification: z.strictObject({
      maxVerifierAttempts: z.number().int().positive(),
      maxExperiments: z.number().int().min(2),
      maxWallTimeMs: z.number().int().positive(),
    }),
  }),
  iterationPolicy: iterationPolicyRefSchema,
  calibrationContext: calibrationContextRefSchema.optional(),
});

const blockedCapabilityReasonSchema = z.union([
  z.enum([
    "mapping-incomplete",
    "no-source-bound-hypothesis",
    "provider-unavailable",
    "unsupported-attacker-premise",
  ]),
  verificationBlockReasonSchema,
]);

export const finiteWorkSchema = z.strictObject({
  kind: z.literal("finite-work"),
  schemaVersion: z.literal(1),
  campaignId: identifierSchema,
  sourceRunId: identifierSchema,
  mapDigest: digestSchema,
  predecessorWaveDigest: digestSchema,
  remainingFinderAttempts: z
    .number()
    .int()
    .positive()
    .max(finderAttemptsPerWaveCeiling),
  objective: z.literal("source-bound-hypothesis"),
  stopWhen: z.literal("source-bound-hypothesis-or-budget-exhausted"),
});

export const finiteWorkRefSchema = z.strictObject({
  kind: z.literal("finite-work"),
  schemaVersion: z.literal(1),
  digest: digestSchema,
});

export const iterationDecisionSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("await-calibration"),
    terminalVerifications: z.array(verificationRecordRefSchema).min(1),
  }),
  z.strictObject({
    kind: z.literal("continue-unresolved-work"),
    next: finiteWorkRefSchema,
  }),
  z.strictObject({
    kind: z.literal("stop-boundary-pair-complete"),
    evidence: boundaryPairEvidenceRefSchema,
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
    "stop-boundary-pair-complete",
    "blocked-capability",
  ]),
});

const selectedKnowledgeRefSchema = z.strictObject({
  id: identifierSchema,
  digest: digestSchema,
});

const semanticCampaignRunPlanIdentityFields = {
  kind: z.literal("campaign-run-plan"),
  schemaVersion: z.literal(2),
  runId: identifierSchema,
  campaignId: identifierSchema,
  preparationDigest: digestSchema,
  target: targetSnapshotRefSchema,
  manifest: targetFileManifestRefSchema,
} as const;

const campaignPreparedWaveRunPlanV2Schema = z.strictObject({
  ...semanticCampaignRunPlanIdentityFields,
  workWave: z.strictObject({
    ref: semanticWorkWaveRefSchema,
    artifactDigest: digestSchema,
  }),
  finder: z.strictObject({
    modelProfile: z.strictObject({
      ref: modelProfileRefSchema,
      execution: structuredModelProfileSchema,
    }),
    promptSet: promptSetRefSchema,
    selectedKnowledge: z.array(selectedKnowledgeRefSchema),
    sourceToolPolicy: sourceToolPolicyRefSchema,
  }),
});

const semanticModelRoleConfigurationSchema = z.strictObject({
  modelProfile: z.strictObject({
    ref: modelProfileRefSchema,
    execution: structuredModelProfileSchema,
  }),
  promptSet: promptSetRefSchema,
});

const modelBudgetSchema = z.strictObject({
  maxWallTimeMs: z.number().int().positive(),
  maxModelTokens: z.number().int().positive(),
  maxModelTurns: z.number().int().positive(),
  maxProviderCostUsd: z.number().positive(),
  maxOutputBytes: z.number().int().positive(),
  reportedUsageEnforcement: z.literal("telemetry-only").optional(),
});

const validationConfigurationFields = {
  wordpressBaseline: z.strictObject({
    id: identifierSchema,
    digest: digestSchema,
  }),
  validationPolicy: z.strictObject({
    id: identifierSchema,
    digest: digestSchema,
  }),
  promptSet: promptSetRefSchema,
  validatorModelProfile:
    semanticModelRoleConfigurationSchema.shape.modelProfile,
  sourceToolPolicy: sourceToolPolicyRefSchema,
  publicSurface: z.array(z.string().min(1).max(2_000)).max(64),
  technicalExclusions: z.array(z.string().min(1).max(2_000)).max(64),
} as const;

const validatorValidationBudgetSchema = modelBudgetSchema.extend({
  maxSourceQueries: z.number().int().positive(),
  maxSourceScanBytes: z.number().int().positive().optional(),
  maxSourceResponseBytes: z.number().int().positive().optional(),
  sourceLimitTerminalOutput: z.literal("preserve").optional(),
});

const currentValidationConfigurationSchema = z.strictObject({
  ...validationConfigurationFields,
  budget: z.strictObject({ validator: validatorValidationBudgetSchema }),
});

const legacyValidationConfigurationSchema = z.strictObject({
  ...validationConfigurationFields,
  synthesisModelProfile:
    semanticModelRoleConfigurationSchema.shape.modelProfile,
  budget: z.strictObject({
    validator: validatorValidationBudgetSchema,
    synthesis: modelBudgetSchema,
  }),
});

const semanticResearchBudgetPolicyV1Schema = z.strictObject({
  kind: z.literal("semantic-research-budget"),
  schemaVersion: z.literal(1),
  id: z.literal("semantic-research-baseline-v1"),
  maxWorkWaves: z.literal(3),
  maxFinderAttempts: z.literal(12),
  maxConcurrentFinders: z.literal(4),
  maxModelAttempts: z.literal(24),
  maxModelTokens: z.literal(2_000_000),
  maxWallTimeMs: z.literal(5_400_000),
  exploration: z.strictObject({
    maxModelTokens: z.literal(1_600_000),
    maxWallTimeMs: z.literal(3_600_000),
  }),
  verificationReserve: z.strictObject({
    maxModelTokens: z.literal(400_000),
    maxWallTimeMs: z.literal(1_800_000),
    maxVerifierAttempts: z.literal(4),
    maxExperiments: z.literal(8),
  }),
});

const semanticResearchBudgetPolicyV2Schema = z.strictObject({
  kind: z.literal("semantic-research-budget"),
  schemaVersion: z.literal(1),
  id: z.literal("semantic-research-baseline-v2"),
  maxWorkWaves: z.literal(3),
  maxFinderAttempts: z.literal(12),
  maxConcurrentFinders: z.literal(4),
  maxModelAttempts: z.literal(24),
  maxModelTokens: z.literal(4_000_000),
  maxWallTimeMs: z.literal(5_400_000),
  exploration: z.strictObject({
    maxModelTokens: z.literal(3_600_000),
    maxWallTimeMs: z.literal(3_600_000),
  }),
  verificationReserve: z.strictObject({
    maxModelTokens: z.literal(400_000),
    maxWallTimeMs: z.literal(1_800_000),
    maxVerifierAttempts: z.literal(4),
    maxExperiments: z.literal(8),
  }),
});

const semanticResearchBudgetPolicyV3Schema = z.strictObject({
  kind: z.literal("semantic-research-budget"),
  schemaVersion: z.literal(1),
  id: z.literal("semantic-research-recall-baseline-v3"),
  maxWorkWaves: z.literal(3),
  maxFinderAttempts: z.literal(12),
  maxConcurrentFinders: z.literal(4),
  maxModelAttempts: z.literal(32),
  maxModelTokens: z.literal(4_000_000),
  maxProviderCostUsd: z.literal(150),
  maxWallTimeMs: z.literal(43_200_000),
  reportedUsageEnforcement: z.literal("telemetry-only"),
  exploration: z.strictObject({
    maxModelTokens: z.literal(3_600_000),
    maxProviderCostUsd: z.literal(120),
    maxWallTimeMs: z.literal(36_000_000),
  }),
  verificationReserve: z.strictObject({
    maxModelTokens: z.literal(400_000),
    maxProviderCostUsd: z.literal(30),
    maxWallTimeMs: z.literal(7_200_000),
    maxVerifierAttempts: z.literal(4),
    maxExperiments: z.literal(8),
  }),
});

const semanticResearchBudgetPolicyV4Schema = z.strictObject({
  kind: z.literal("semantic-research-budget"),
  schemaVersion: z.literal(1),
  id: z.literal("semantic-research-recall-baseline-v4"),
  maxWorkWaves: z.literal(3),
  maxFinderAttempts: z.literal(12),
  maxConcurrentFinders: z.literal(4),
  maxModelAttempts: z.literal(128),
  maxModelTokens: z.literal(4_000_000),
  maxProviderCostUsd: z.literal(150),
  maxWallTimeMs: z.literal(43_200_000),
  reportedUsageEnforcement: z.literal("telemetry-only"),
  exploration: z.strictObject({
    maxModelTokens: z.literal(3_600_000),
    maxProviderCostUsd: z.literal(120),
    maxWallTimeMs: z.literal(36_000_000),
  }),
  verificationReserve: z.strictObject({
    maxModelTokens: z.literal(400_000),
    maxProviderCostUsd: z.literal(30),
    maxWallTimeMs: z.literal(7_200_000),
    maxVerifierAttempts: z.literal(96),
    maxExperiments: z.literal(8),
  }),
});

const semanticResearchBudgetPolicyV5Schema = z.strictObject({
  kind: z.literal("semantic-research-budget"),
  schemaVersion: z.literal(1),
  id: z.literal("semantic-research-recall-baseline-v5"),
  maxWorkWaves: z.literal(12),
  maxFinderAttempts: z.literal(48),
  maxConcurrentFinders: z.literal(4),
  maxModelAttempts: z.literal(128),
  maxModelTokens: z.literal(4_000_000),
  maxProviderCostUsd: z.literal(150),
  maxWallTimeMs: z.literal(43_200_000),
  reportedUsageEnforcement: z.literal("telemetry-only"),
  exploration: z.strictObject({
    maxModelTokens: z.literal(3_600_000),
    maxProviderCostUsd: z.literal(120),
    maxWallTimeMs: z.literal(36_000_000),
  }),
  verificationReserve: z.strictObject({
    maxModelTokens: z.literal(400_000),
    maxProviderCostUsd: z.literal(30),
    maxWallTimeMs: z.literal(7_200_000),
    maxVerifierAttempts: z.literal(96),
    maxExperiments: z.literal(8),
  }),
});

export const semanticResearchBudgetPolicyV6Schema = z.strictObject({
  kind: z.literal("semantic-research-budget"),
  schemaVersion: z.literal(2),
  id: z.literal("semantic-research-recall-baseline-v6"),
  maxWorkWaves: z.literal(12),
  maxFinderAttempts: z.literal(48),
  maxConcurrentFinders: z.literal(4),
  maxModelAttempts: z.literal(128),
  maxModelTokens: z.literal(4_000_000),
  maxProviderCostUsd: z.literal(150),
  maxWallTimeMs: z.literal(43_200_000),
  reportedUsageEnforcement: z.literal("telemetry-only"),
  exploration: z.strictObject({
    maxModelTokens: z.literal(3_600_000),
    maxProviderCostUsd: z.literal(120),
    maxWallTimeMs: z.literal(36_000_000),
  }),
  validationReserve: z.strictObject({
    maxModelTokens: z.literal(400_000),
    maxProviderCostUsd: z.literal(30),
    maxWallTimeMs: z.literal(7_200_000),
  }),
});

export const semanticResearchBudgetPolicySchema = z.union([
  semanticResearchBudgetPolicyV5Schema,
  semanticResearchBudgetPolicyV4Schema,
  semanticResearchBudgetPolicyV3Schema,
  semanticResearchBudgetPolicyV2Schema,
  semanticResearchBudgetPolicyV1Schema,
]);

const currentSemanticRootPlanningPolicyId =
  "semantic-research-normal-wave-v1" as const;

const currentSemanticRootPlanningPolicySchema =
  semanticRootPlanningPolicySchema.superRefine((policy, context) => {
    if (
      policy.id === currentSemanticRootPlanningPolicyId &&
      policy.maxTargetSpecificTheses > 2
    ) {
      context.addIssue({
        code: "custom",
        path: ["maxTargetSpecificTheses"],
        message:
          "Current Semantic Research permits at most two target-specific theses",
      });
    }
  });

export type CurrentSemanticRootPlanningPolicyInput = Pick<
  z.input<typeof semanticRootPlanningPolicySchema>,
  "plannerBudget" | "finderLeaseBudget"
> & {
  readonly maxLeasesOverride?: 1 | 2 | 3 | 4;
};

export function defineCurrentSemanticRootPlanningPolicy(
  input: CurrentSemanticRootPlanningPolicyInput,
) {
  const maxLeases = input.maxLeasesOverride ?? 3;
  return currentSemanticRootPlanningPolicySchema.parse({
    kind: "semantic-root-planning-policy",
    schemaVersion: 1,
    id: currentSemanticRootPlanningPolicyId,
    maxTargetSpecificTheses: Math.min(2, maxLeases - 1),
    minWildcardTheses: 1,
    maxLeases,
    plannerBudget: input.plannerBudget,
    finderLeaseBudget: input.finderLeaseBudget,
  });
}

export const campaignDefaultSemanticRunPlanV2Schema = z.strictObject({
  ...semanticCampaignRunPlanIdentityFields,
  metadata: oracleFreeTargetMetadataSchema,
  semanticPolicy: semanticRootPlanningPolicySchema,
  planner: semanticModelRoleConfigurationSchema.extend({
    sourceToolPolicy: sourceToolPolicyRefSchema,
  }),
  finder: semanticModelRoleConfigurationSchema.extend({
    selectedKnowledge: z.array(selectedKnowledgeRefSchema),
    sourceToolPolicy: sourceToolPolicyRefSchema,
  }),
  evaluator: semanticModelRoleConfigurationSchema.extend({
    budget: z.strictObject({
      maxWallTimeMs: z.number().int().positive(),
      maxModelTokens: z.number().int().positive(),
      maxModelTurns: z.number().int().positive(),
      maxProviderCostUsd: z.number().positive(),
      maxOutputBytes: z.number().int().positive(),
      reportedUsageEnforcement: z.literal("telemetry-only").optional(),
    }),
  }),
  verification: z.strictObject({
    labBaseline: labBaselineRefSchema,
    verifierModelProfile: modelProfileRefSchema,
    promptSet: promptSetRefSchema,
    verificationPolicy: verificationPolicyRefSchema,
    experimentRegistry: experimentRegistryRefSchema,
    budget: z.union([
      verificationBudgetV2Schema,
      z.strictObject({
        maxVerifierAttempts: z.number().int().positive(),
        maxExperiments: z.number().int().min(2),
        maxWallTimeMs: z.number().int().positive(),
      }),
    ]),
  }),
  budgetPolicy: semanticResearchBudgetPolicySchema,
});

export const campaignDefaultSemanticRunPlanV3Schema = z.strictObject({
  kind: z.literal("campaign-run-plan"),
  schemaVersion: z.literal(3),
  runId: identifierSchema,
  campaignId: identifierSchema,
  preparationDigest: digestSchema,
  target: targetSnapshotRefSchema,
  manifest: targetFileManifestRefSchema,
  metadata: oracleFreeTargetMetadataSchema,
  semanticPolicy: currentSemanticRootPlanningPolicySchema,
  planner: semanticModelRoleConfigurationSchema.extend({
    sourceToolPolicy: sourceToolPolicyRefSchema,
  }),
  finder: semanticModelRoleConfigurationSchema.extend({
    selectedKnowledge: z.array(selectedKnowledgeRefSchema),
    sourceToolPolicy: sourceToolPolicyRefSchema,
  }),
  evaluator: semanticModelRoleConfigurationSchema.extend({
    budget: modelBudgetSchema,
  }),
  validation: z.union([
    currentValidationConfigurationSchema,
    legacyValidationConfigurationSchema,
  ]),
  budgetPolicy: semanticResearchBudgetPolicyV6Schema,
});

export const campaignRunPlanV3Schema = campaignDefaultSemanticRunPlanV3Schema;

export const campaignRunPlanV2Schema = z.union([
  campaignDefaultSemanticRunPlanV2Schema,
  campaignPreparedWaveRunPlanV2Schema,
]);

const semanticCampaignAttemptIdentityFields = {
  campaignId: identifierSchema,
  runId: identifierSchema,
  attemptId: identifierSchema,
  ordinal: z.number().int().positive(),
  mode: z.literal("execute"),
  attemptPlanDigest: digestSchema,
};

export const campaignAttemptIntentV2Schema = z.discriminatedUnion("role", [
  z.strictObject({
    kind: z.literal("campaign-attempt-intent"),
    schemaVersion: z.literal(2),
    ...semanticCampaignAttemptIdentityFields,
    role: z.literal("root-planner"),
    preparationDigest: digestSchema,
  }),
  z.strictObject({
    kind: z.literal("campaign-attempt-intent"),
    schemaVersion: z.literal(2),
    ...semanticCampaignAttemptIdentityFields,
    role: z.literal("finder"),
    leaseId: digestSchema,
    workWaveDigest: digestSchema,
    predecessorDecisionDigest: digestSchema.optional(),
  }),
  z.strictObject({
    kind: z.literal("campaign-attempt-intent"),
    schemaVersion: z.literal(2),
    ...semanticCampaignAttemptIdentityFields,
    role: z.literal("root-evaluator"),
    workWaveDigest: digestSchema.optional(),
    terminalDigest: digestSchema.optional(),
    registryDigest: digestSchema.optional(),
    synthesisDigest: digestSchema.optional(),
    critiqueDigest: digestSchema.optional(),
  }),
  z.strictObject({
    kind: z.literal("campaign-attempt-intent"),
    schemaVersion: z.literal(2),
    ...semanticCampaignAttemptIdentityFields,
    role: z.literal("root-synthesizer"),
    queueDigest: digestSchema,
    batchId: digestSchema,
  }),
  z.strictObject({
    kind: z.literal("campaign-attempt-intent"),
    schemaVersion: z.literal(2),
    ...semanticCampaignAttemptIdentityFields,
    role: z.literal("adversarial-critic"),
    synthesisDigest: digestSchema,
  }),
  z.strictObject({
    kind: z.literal("campaign-attempt-intent"),
    schemaVersion: z.literal(2),
    ...semanticCampaignAttemptIdentityFields,
    role: z.literal("validator"),
    candidateId: digestSchema,
    validationAttemptOrdinal: z.number().int().positive().max(3),
  }),
]);

const semanticCampaignAttemptCompletionFields = {
  kind: z.literal("campaign-attempt-completion"),
  schemaVersion: z.literal(2),
  campaignId: identifierSchema,
  runId: identifierSchema,
  attemptId: identifierSchema,
  ordinal: z.number().int().positive(),
} as const;

export const campaignAttemptCompletionV2Schema = z.discriminatedUnion("role", [
  z.strictObject({
    ...semanticCampaignAttemptCompletionFields,
    role: z.literal("root-planner"),
    preparationDigest: digestSchema,
    result: attemptExecutionResultV2RefSchema.extend({
      owner: z.literal("exploration"),
      role: z.literal("root-planner"),
    }),
  }),
  z.strictObject({
    ...semanticCampaignAttemptCompletionFields,
    role: z.literal("finder"),
    leaseId: digestSchema,
    workWaveDigest: digestSchema,
    predecessorDecisionDigest: digestSchema.optional(),
    result: attemptExecutionResultV2RefSchema.extend({
      owner: z.literal("exploration"),
      role: z.literal("finder"),
    }),
  }),
  z.strictObject({
    ...semanticCampaignAttemptCompletionFields,
    role: z.literal("root-evaluator"),
    workWaveDigest: digestSchema.optional(),
    terminalDigest: digestSchema.optional(),
    registryDigest: digestSchema.optional(),
    synthesisDigest: digestSchema.optional(),
    critiqueDigest: digestSchema.optional(),
    result: attemptExecutionResultV2RefSchema.extend({
      owner: z.literal("exploration"),
      role: z.literal("root-evaluator"),
    }),
  }),
  z.strictObject({
    ...semanticCampaignAttemptCompletionFields,
    role: z.literal("root-synthesizer"),
    queueDigest: digestSchema,
    batchId: digestSchema,
    result: attemptExecutionResultV2RefSchema.extend({
      owner: z.literal("exploration"),
      role: z.literal("root-synthesizer"),
    }),
  }),
  z.strictObject({
    ...semanticCampaignAttemptCompletionFields,
    role: z.literal("adversarial-critic"),
    synthesisDigest: digestSchema,
    result: attemptExecutionResultV2RefSchema.extend({
      owner: z.literal("exploration"),
      role: z.literal("adversarial-critic"),
    }),
  }),
  z.strictObject({
    ...semanticCampaignAttemptCompletionFields,
    role: z.literal("validator"),
    candidateId: digestSchema,
    validationAttemptOrdinal: z.number().int().positive().max(3),
    result: attemptExecutionResultV2RefSchema.extend({
      owner: z.literal("validation"),
      role: z.literal("validator"),
    }),
  }),
]);

const semanticCampaignRunIdentityFields = {
  runId: identifierSchema,
  campaignId: identifierSchema,
  planDigest: digestSchema,
};

const semanticFinderWaveDecisionSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("finder-wave-completed"),
  }),
  z.strictObject({
    kind: z.literal("incomplete"),
    reason: z.enum([
      "partial-finder-output",
      "invalid-finder-output",
      "foreign-source-anchor",
    ]),
  }),
]);

const campaignPreparedWaveCompletionInputV2Schema = z.strictObject({
  kind: z.literal("campaign-run-completion"),
  schemaVersion: z.literal(2),
  ...semanticCampaignRunIdentityFields,
  target: targetSnapshotRefSchema,
  manifest: targetFileManifestRefSchema,
  workWave: semanticWorkWaveRefSchema,
  waveTerminal: semanticWaveTerminalRefSchema,
  attempts: z
    .array(
      attemptExecutionResultV2RefSchema.extend({
        owner: z.literal("exploration"),
        role: z.literal("finder"),
      }),
    )
    .min(1)
    .max(4),
  decision: semanticFinderWaveDecisionSchema,
});

const campaignPreparedWaveRecordV2Schema = z.strictObject({
  kind: z.literal("campaign-run-record"),
  schemaVersion: z.literal(2),
  ...semanticCampaignRunIdentityFields,
  target: targetSnapshotRefSchema,
  manifest: targetFileManifestRefSchema,
  workWave: semanticWorkWaveRefSchema,
  waveTerminal: semanticWaveTerminalRefSchema,
  attempts: z
    .array(
      attemptExecutionResultV2RefSchema.extend({
        owner: z.literal("exploration"),
        role: z.literal("finder"),
      }),
    )
    .min(1)
    .max(4),
  decision: semanticFinderWaveDecisionSchema,
  completedAt: z.string().datetime(),
});

const semanticCampaignTerminalDecisionSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("complete"),
    reason: z.literal("coverage-closed"),
  }),
  z.strictObject({
    kind: z.literal("incomplete"),
    reason: z.enum([
      "planning-incomplete",
      "finder-wave-incomplete",
      "evaluation-incomplete",
      "active-research-remains",
      "verification-blocked",
      "verification-budget-exhausted",
      "depth-research-incomplete",
      "coverage-review-incomplete",
    ]),
  }),
]);

const semanticCampaignTokenUsageSchema = z.strictObject({
  input: z.number().int().nonnegative(),
  cacheCreation: z.number().int().nonnegative(),
  cacheRead: z.number().int().nonnegative(),
  output: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
});

const semanticCampaignUsageOwnerSchema = z.strictObject({
  modelAttempts: z.number().int().nonnegative(),
  reportedModelAttempts: z.number().int().nonnegative(),
  modelWallTimeMs: z.number().int().nonnegative(),
  modelTurns: z.number().int().nonnegative(),
  modelTokens: semanticCampaignTokenUsageSchema,
  structuredOutputBytes: z.number().int().nonnegative(),
  estimatedCostUsd: z.number().finite().nonnegative(),
  estimatedCostMeasurement: z.enum(["reported", "partial"]),
  source: z.strictObject({
    queries: z.number().int().nonnegative(),
    scanBytes: z.number().int().nonnegative(),
    responseBytes: z.number().int().nonnegative(),
  }),
});

const semanticCampaignUsageFields = {
  measurement: z.enum(["reported", "partial"]),
  modelAttempts: z.number().int().nonnegative(),
  reportedModelAttempts: z.number().int().nonnegative(),
  campaignWallTimeMs: z.number().int().nonnegative(),
  modelWallTimeMs: z.number().int().nonnegative(),
  modelTurns: z.number().int().nonnegative(),
  modelTokens: semanticCampaignTokenUsageSchema,
  structuredOutputBytes: z.number().int().nonnegative(),
  source: z.strictObject({
    queries: z.number().int().nonnegative(),
    scanBytes: z.number().int().nonnegative(),
    responseBytes: z.number().int().nonnegative(),
  }),
} as const;

export const semanticCampaignUsageV1Schema = z.strictObject({
  kind: z.literal("semantic-campaign-usage"),
  schemaVersion: z.literal(1),
  ...semanticCampaignUsageFields,
});

export const semanticCampaignUsageV2Schema = z.strictObject({
  kind: z.literal("semantic-campaign-usage"),
  schemaVersion: z.literal(2),
  ...semanticCampaignUsageFields,
  estimatedCostUsd: z.number().finite().nonnegative(),
  estimatedCostMeasurement: z.enum(["reported", "partial"]),
  owners: z.strictObject({
    exploration: semanticCampaignUsageOwnerSchema,
    verification: semanticCampaignUsageOwnerSchema,
  }),
});

export const semanticCampaignUsageSchema = z.union([
  semanticCampaignUsageV2Schema,
  semanticCampaignUsageV1Schema,
]);

const semanticDepthBatchResultSchema = z.strictObject({
  kind: z.literal("semantic-depth-batch-result"),
  schemaVersion: z.literal(1),
  batchId: digestSchema,
  synthesis: z.strictObject({
    ref: chainSynthesisRefSchema,
    artifactDigest: digestSchema,
  }),
  critique: z
    .strictObject({
      ref: adversarialCritiqueRefSchema,
      artifactDigest: digestSchema,
    })
    .optional(),
  evaluation: z
    .strictObject({
      ref: depthIterationDecisionRefSchema,
      artifactDigest: digestSchema,
    })
    .optional(),
  missingLinkWaves: z
    .array(
      z.strictObject({
        plan: semanticMissingLinkWavePlanRefSchema,
        terminal: semanticWaveTerminalRefSchema,
      }),
    )
    .max(2)
    .optional(),
  unscheduledGaps: z.array(criticFrontierGapRefSchema).max(32).optional(),
  registry: approachFamilyRegistryRefSchema.optional(),
  verificationHypotheses: z
    .array(sourceBoundHypothesisArtifactRefSchema)
    .max(32)
    .optional(),
});

const semanticDepthBatchIncompleteSchema = z.strictObject({
  kind: z.literal("semantic-depth-batch-incomplete"),
  schemaVersion: z.literal(1),
  batchId: digestSchema,
  stage: z.enum([
    "root-synthesis",
    "adversarial-critique",
    "depth-root-evaluation",
  ]),
  artifactDigest: digestSchema,
  reason: z.string().min(1).max(1_000),
});

const semanticDepthRoundV1Schema = z.strictObject({
  kind: z.literal("semantic-depth-round"),
  schemaVersion: z.literal(1),
  ordinal: z.number().int().positive().max(3),
  queue: semanticDepthWorkQueueRefSchema,
  batches: z
    .array(
      z.discriminatedUnion("kind", [
        semanticDepthBatchResultSchema,
        semanticDepthBatchIncompleteSchema,
      ]),
    )
    .min(1),
});

const semanticDepthResearchV2Schema = z.strictObject({
  kind: z.literal("semantic-depth-research"),
  schemaVersion: z.literal(2),
  rounds: z.array(semanticDepthRoundV1Schema).min(1).max(3),
});

const semanticDepthRoundV2Schema = semanticDepthRoundV1Schema.extend({
  schemaVersion: z.literal(2),
  ordinal: z.number().int().positive().max(12),
});

const semanticDepthResearchV3Schema = z.strictObject({
  kind: z.literal("semantic-depth-research"),
  schemaVersion: z.literal(3),
  rounds: z.array(semanticDepthRoundV2Schema).min(1).max(12),
});

export const semanticDepthResearchSchema = z.union([
  semanticDepthResearchV3Schema,
  semanticDepthResearchV2Schema,
]);

const currentDepthSynthesisArtifactSchema = z.strictObject({
  ref: chainSynthesisRefSchema,
  artifactDigest: digestSchema,
});

const currentDepthCritiqueArtifactSchema = z.strictObject({
  ref: adversarialCritiqueRefSchema,
  artifactDigest: digestSchema,
});

const currentSemanticDepthBatchResultSchema = z
  .strictObject({
    kind: z.literal("semantic-depth-batch-result"),
    schemaVersion: z.literal(2),
    batchId: digestSchema,
    synthesis: currentDepthSynthesisArtifactSchema,
    critique: currentDepthCritiqueArtifactSchema.optional(),
    evaluation: z
      .strictObject({
        ref: currentDepthIterationDecisionRefSchema,
        artifactDigest: digestSchema,
      })
      .optional(),
    registry: approachFamilyRegistryRefV3Schema.optional(),
  })
  .superRefine((batch, context) => {
    const evaluated = batch.evaluation !== undefined;
    if (
      (batch.critique !== undefined) !== evaluated ||
      (batch.registry !== undefined) !== evaluated
    ) {
      context.addIssue({
        code: "custom",
        message: "Completed Depth artifacts must advance together",
      });
    }
  });

const currentSemanticDepthBatchIncompleteSchema = z
  .strictObject({
    kind: z.literal("semantic-depth-batch-incomplete"),
    schemaVersion: z.literal(2),
    batchId: digestSchema,
    stage: z.enum([
      "root-synthesis",
      "adversarial-critique",
      "depth-root-evaluation",
    ]),
    synthesis: currentDepthSynthesisArtifactSchema.optional(),
    critique: currentDepthCritiqueArtifactSchema.optional(),
    artifactDigest: digestSchema,
    reason: z.string().min(1).max(1_000),
  })
  .superRefine((batch, context) => {
    if (
      (batch.stage === "root-synthesis" &&
        (batch.synthesis !== undefined || batch.critique !== undefined)) ||
      (batch.stage === "adversarial-critique" &&
        (batch.synthesis === undefined || batch.critique !== undefined)) ||
      (batch.stage === "depth-root-evaluation" &&
        (batch.synthesis === undefined || batch.critique === undefined))
    ) {
      context.addIssue({
        code: "custom",
        message: "Incomplete Depth stage has an invalid artifact chain",
      });
    }
  });

const currentSemanticDepthRoundSchema = z.strictObject({
  kind: z.literal("semantic-depth-round"),
  schemaVersion: z.literal(3),
  ordinal: z.number().int().positive().max(12),
  queue: semanticDepthWorkQueueRefV2Schema,
  batches: z
    .array(
      z.discriminatedUnion("kind", [
        currentSemanticDepthBatchResultSchema,
        currentSemanticDepthBatchIncompleteSchema,
      ]),
    )
    .min(1),
});

export const currentSemanticDepthResearchSchema = z.strictObject({
  kind: z.literal("semantic-depth-research"),
  schemaVersion: z.literal(4),
  rounds: z.array(currentSemanticDepthRoundSchema).min(1).max(12),
});

export const semanticCoverageReviewTraceSchema = z
  .strictObject({
    kind: z.literal("semantic-coverage-review-trace"),
    schemaVersion: z.literal(1),
    ordinal: z.number().int().positive().max(2),
    wave: semanticWorkWaveRefSchema,
    wavePlanDigest: digestSchema,
    terminal: semanticWaveTerminalRefSchema,
    decision: semanticIterationDecisionRefSchema.optional(),
    observation: coverageObservationSchema.optional(),
  })
  .superRefine((trace, context) => {
    if (
      trace.wave.id !== trace.terminal.waveId ||
      (trace.decision !== undefined &&
        trace.decision.workWaveDigest !== trace.wave.digest) ||
      (trace.observation !== undefined &&
        (trace.decision === undefined ||
          trace.observation.decision.digest !== trace.decision.digest ||
          trace.observation.wavePlanDigest !== trace.wavePlanDigest))
    ) {
      context.addIssue({
        code: "custom",
        message: "Coverage Review trace binding mismatch",
      });
    }
  });

const campaignDefaultSemanticCompletionInputV2Schema = z.strictObject({
  kind: z.literal("campaign-run-completion"),
  schemaVersion: z.literal(2),
  ...semanticCampaignRunIdentityFields,
  target: targetSnapshotRefSchema,
  manifest: targetFileManifestRefSchema,
  workWave: semanticWorkWaveRefSchema,
  waveTerminal: semanticWaveTerminalRefSchema,
  attempts: z.array(attemptExecutionResultV2RefSchema).min(1).max(128),
  iterationDecision: iterationDecisionV2Schema,
  iterationDecisionRef: semanticIterationDecisionRefSchema,
  approachFamilyRegistry: approachFamilyRegistryRefSchema,
  depthWorkQueue: semanticDepthWorkQueueRefSchema.optional(),
  depthResearch: semanticDepthResearchSchema.optional(),
  coverageReviews: z.array(semanticCoverageReviewTraceSchema).max(2).optional(),
  coverageClosure: semanticCoverageClosureSchema.optional(),
  coverageClosureRef: semanticCoverageClosureRefSchema.optional(),
  verifications: z.array(verificationRecordRefSchema).max(96),
  usage: semanticCampaignUsageSchema,
  decision: semanticCampaignTerminalDecisionSchema,
});

const campaignDefaultSemanticRecordV2Schema = z.strictObject({
  kind: z.literal("campaign-run-record"),
  schemaVersion: z.literal(2),
  ...semanticCampaignRunIdentityFields,
  target: targetSnapshotRefSchema,
  manifest: targetFileManifestRefSchema,
  workWave: semanticWorkWaveRefSchema,
  waveTerminal: semanticWaveTerminalRefSchema,
  attempts: z.array(attemptExecutionResultV2RefSchema).min(1).max(128),
  iterationDecision: iterationDecisionV2Schema,
  iterationDecisionRef: semanticIterationDecisionRefSchema,
  approachFamilyRegistry: approachFamilyRegistryRefSchema,
  depthWorkQueue: semanticDepthWorkQueueRefSchema.optional(),
  depthResearch: semanticDepthResearchSchema.optional(),
  coverageReviews: z.array(semanticCoverageReviewTraceSchema).max(2).optional(),
  coverageClosure: semanticCoverageClosureSchema.optional(),
  coverageClosureRef: semanticCoverageClosureRefSchema.optional(),
  verifications: z.array(verificationRecordRefSchema).max(96),
  usage: semanticCampaignUsageSchema,
  decision: semanticCampaignTerminalDecisionSchema,
  completedAt: z.string().datetime(),
});

const campaignDefaultSemanticEarlyCompletionInputV2Schema = z.strictObject({
  kind: z.literal("campaign-run-completion"),
  schemaVersion: z.literal(2),
  ...semanticCampaignRunIdentityFields,
  target: targetSnapshotRefSchema,
  manifest: targetFileManifestRefSchema,
  attempts: z.array(attemptExecutionResultV2RefSchema).max(24),
  stage: z.union([
    planningIncompleteDecisionSchema,
    evaluationIncompleteDecisionSchema,
  ]),
  verifications: z.array(verificationRecordRefSchema).max(96).optional(),
  decision: z.strictObject({
    kind: z.literal("incomplete"),
    reason: z.enum(["planning-incomplete", "evaluation-incomplete"]),
  }),
});

const campaignDefaultSemanticEarlyRecordV2Schema = z.strictObject({
  kind: z.literal("campaign-run-record"),
  schemaVersion: z.literal(2),
  ...semanticCampaignRunIdentityFields,
  target: targetSnapshotRefSchema,
  manifest: targetFileManifestRefSchema,
  attempts: z.array(attemptExecutionResultV2RefSchema).max(24),
  stage: z.union([
    planningIncompleteDecisionSchema,
    evaluationIncompleteDecisionSchema,
  ]),
  verifications: z.array(verificationRecordRefSchema).max(96).optional(),
  decision: z.strictObject({
    kind: z.literal("incomplete"),
    reason: z.enum(["planning-incomplete", "evaluation-incomplete"]),
  }),
  completedAt: z.string().datetime(),
});

export const campaignRunCompletionInputV2Schema = z.union([
  campaignDefaultSemanticCompletionInputV2Schema,
  campaignDefaultSemanticEarlyCompletionInputV2Schema,
  campaignPreparedWaveCompletionInputV2Schema,
]);

export const campaignRunRecordV2Schema = z.union([
  campaignDefaultSemanticRecordV2Schema,
  campaignDefaultSemanticEarlyRecordV2Schema,
  campaignPreparedWaveRecordV2Schema,
]);

export const campaignRunRecordRefV2Schema = z.strictObject({
  kind: z.literal("campaign-run-record"),
  schemaVersion: z.literal(2),
  runId: identifierSchema,
  digest: digestSchema,
  decision: z.enum(["finder-wave-completed", "complete", "incomplete"]),
});

const currentSemanticTerminalDecisionSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("complete") }),
  z.strictObject({
    kind: z.literal("incomplete"),
    reason: z.enum([
      "planning-incomplete",
      "evaluation-incomplete",
      "validation-pending",
      "research-work-remains",
      "review-packet-pending",
      "runtime-packet-pending",
    ]),
  }),
]);

const campaignDefaultSemanticCompletionInputV3Schema = z.strictObject({
  kind: z.literal("campaign-run-completion"),
  schemaVersion: z.literal(3),
  ...semanticCampaignRunIdentityFields,
  target: targetSnapshotRefSchema,
  manifest: targetFileManifestRefSchema,
  workWave: semanticWorkWaveRefSchema,
  waveTerminal: semanticWaveTerminalRefSchema,
  attempts: z.array(attemptExecutionResultV2RefSchema).min(1).max(128),
  iterationDecision: iterationDecisionV3Schema,
  iterationDecisionRef: semanticIterationDecisionRefV3Schema,
  approachFamilyRegistry: approachFamilyRegistryRefV3Schema,
  depthWorkQueue: semanticDepthWorkQueueRefV2Schema.optional(),
  depthResearch: currentSemanticDepthResearchSchema.optional(),
  validations: z.array(validationRecordSchema).max(64),
  validationFrontierGaps: z.array(validationFrontierGapRefSchema).max(64),
  humanReviewPackets: z
    .array(humanReviewPacketHandoffSchema)
    .max(64)
    .optional(),
  humanReviewPacketFailures: z
    .array(humanReviewPacketPreparationFailureSchema)
    .max(64)
    .optional(),
  runtimeVerificationPackets: z
    .array(runtimeVerificationPacketHandoffSchema)
    .max(64)
    .optional(),
  runtimeVerificationPacketFailures: z
    .array(runtimeVerificationPacketPreparationFailureSchema)
    .max(64)
    .optional(),
  decision: currentSemanticTerminalDecisionSchema,
});

const campaignDefaultSemanticRecordV3Schema =
  campaignDefaultSemanticCompletionInputV3Schema.extend({
    kind: z.literal("campaign-run-record"),
    completedAt: z.string().datetime(),
  });

const campaignDefaultSemanticEarlyCompletionInputV3Schema = z.strictObject({
  kind: z.literal("campaign-run-completion"),
  schemaVersion: z.literal(3),
  ...semanticCampaignRunIdentityFields,
  target: targetSnapshotRefSchema,
  manifest: targetFileManifestRefSchema,
  attempts: z.array(attemptExecutionResultV2RefSchema).max(24),
  stage: z.union([
    planningIncompleteDecisionSchema,
    evaluationIncompleteDecisionV3Schema,
  ]),
  decision: z.strictObject({
    kind: z.literal("incomplete"),
    reason: z.enum(["planning-incomplete", "evaluation-incomplete"]),
  }),
});

const campaignDefaultSemanticEarlyRecordV3Schema =
  campaignDefaultSemanticEarlyCompletionInputV3Schema.extend({
    kind: z.literal("campaign-run-record"),
    completedAt: z.string().datetime(),
  });

export const campaignRunCompletionInputV3Schema = z.union([
  campaignDefaultSemanticCompletionInputV3Schema,
  campaignDefaultSemanticEarlyCompletionInputV3Schema,
]);

export const campaignRunRecordV3Schema = z.union([
  campaignDefaultSemanticRecordV3Schema,
  campaignDefaultSemanticEarlyRecordV3Schema,
]);

export const campaignRunRecordRefV3Schema = z.strictObject({
  kind: z.literal("campaign-run-record"),
  schemaVersion: z.literal(3),
  runId: identifierSchema,
  digest: digestSchema,
  decision: z.enum(["complete", "incomplete"]),
});

export type CampaignRunPlan = z.infer<typeof campaignRunPlanSchema>;
export type CampaignRunPlanV2 = z.infer<typeof campaignRunPlanV2Schema>;
export type PreparedWaveCampaignRunPlanV2 = z.infer<
  typeof campaignPreparedWaveRunPlanV2Schema
>;
export type DefaultSemanticCampaignRunPlanV2 = z.infer<
  typeof campaignDefaultSemanticRunPlanV2Schema
>;
export type DefaultSemanticCampaignRunPlanV3 = z.infer<
  typeof campaignDefaultSemanticRunPlanV3Schema
>;
export type CampaignRunPlanV3 = z.infer<typeof campaignRunPlanV3Schema>;
export type AnyCampaignRunPlan =
  CampaignRunPlan | CampaignRunPlanV2 | CampaignRunPlanV3;
export type CampaignRunCompletionInput = z.infer<
  typeof campaignRunCompletionInputSchema
>;
export type CampaignRunRecord = z.infer<typeof campaignRunRecordSchema>;
export type CampaignRunRecordRef = z.infer<typeof campaignRunRecordRefSchema>;
export type CampaignRunCompletionInputV2 = z.infer<
  typeof campaignRunCompletionInputV2Schema
>;
export type CampaignRunRecordV2 = z.infer<typeof campaignRunRecordV2Schema>;
export type CampaignRunCompletionInputV3 = z.infer<
  typeof campaignRunCompletionInputV3Schema
>;
export type CampaignRunRecordV3 = z.infer<typeof campaignRunRecordV3Schema>;
export type SemanticCampaignUsage = z.infer<typeof semanticCampaignUsageSchema>;
export type SemanticDepthResearch = z.infer<typeof semanticDepthResearchSchema>;
export type CurrentSemanticDepthResearch = z.infer<
  typeof currentSemanticDepthResearchSchema
>;
export type SemanticCoverageReviewTrace = z.infer<
  typeof semanticCoverageReviewTraceSchema
>;
export type CampaignRunRecordRefV2 = z.infer<
  typeof campaignRunRecordRefV2Schema
>;
export type CampaignRunRecordRefV3 = z.infer<
  typeof campaignRunRecordRefV3Schema
>;
export type AnyCampaignRunRecord =
  CampaignRunRecord | CampaignRunRecordV2 | CampaignRunRecordV3;
export type AnyCampaignRunRecordRef =
  CampaignRunRecordRef | CampaignRunRecordRefV2 | CampaignRunRecordRefV3;
export type IterationDecision = z.infer<typeof iterationDecisionSchema>;
export type BoundaryPairEvidenceRef = z.infer<
  typeof boundaryPairEvidenceRefSchema
>;
export type CalibrationReviewResult = z.infer<
  typeof calibrationReviewResultSchema
>;
export type FinderAttemptMaterialization = z.infer<
  typeof finderAttemptMaterializationSchema
>;
export type FiniteWork = z.infer<typeof finiteWorkSchema>;
export type FiniteWorkRef = z.infer<typeof finiteWorkRefSchema>;
export type CampaignAttemptIntent = z.infer<typeof campaignAttemptIntentSchema>;
export type CampaignAttemptCompletion = z.infer<
  typeof campaignAttemptCompletionSchema
>;
export type CampaignAttemptIntentV2 = z.infer<
  typeof campaignAttemptIntentV2Schema
>;
export type CampaignAttemptCompletionV2 = z.infer<
  typeof campaignAttemptCompletionV2Schema
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

export interface CampaignAttemptRecordViewV2 {
  readonly ledgerHead: number;
  readonly occurredAt: string;
  readonly intent: CampaignAttemptIntentV2;
  readonly completion?: {
    readonly ledgerHead: number;
    readonly occurredAt: string;
    readonly value: CampaignAttemptCompletionV2;
  };
}

export interface CampaignRunRecordViewV2 {
  readonly ledgerHead: number;
  readonly occurredAt: string;
  readonly ref: CampaignRunRecordRefV2;
  readonly value: CampaignRunRecordV2;
}

export interface CampaignRunRecordViewV3 {
  readonly ledgerHead: number;
  readonly occurredAt: string;
  readonly ref: CampaignRunRecordRefV3;
  readonly value: CampaignRunRecordV3;
}

export type AnyCampaignRunRecordView =
  CampaignRunRecordView | CampaignRunRecordViewV2 | CampaignRunRecordViewV3;

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

export interface CalibrationReviewInput {
  readonly calibrationContext: NonNullable<
    CampaignRunPlan["calibrationContext"]
  >;
  readonly campaign: {
    readonly campaignId: string;
    readonly runId: string;
  };
  readonly terminalVerifications: readonly VerificationRecordRef[];
}

export interface CalibrationReview {
  review(input: CalibrationReviewInput): Promise<unknown>;
}

export interface CampaignExecutionDependencies {
  readonly artifactStore: JsonArtifactStore;
  readonly attemptPlanMaterializer: AttemptPlanMaterializer;
  readonly modelExecution: ModelExecution;
  readonly independentVerifier: IndependentVerifier;
  readonly labControl: LabControl;
  readonly calibrationReview?: CalibrationReview;
  readonly humanReviewPacketDelivery?: HumanReviewPacketDelivery;
  readonly runtimeVerificationPacketDelivery?: RuntimeVerificationPacketDelivery;
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

export class LegacyMapFirstExecutionDisabledError extends Error {
  constructor() {
    super(
      "Map-first Campaign execution is retired; only completed v1 ledger replay remains available",
    );
    this.name = "LegacyMapFirstExecutionDisabledError";
  }
}

export class LegacySemanticExecutionDisabledError extends Error {
  constructor() {
    super(
      "Semantic Campaign v2 execution is retired; only completed legacy ledger replay remains available",
    );
    this.name = "LegacySemanticExecutionDisabledError";
  }
}

export class RetiredSemanticBudgetPolicyError extends Error {
  constructor() {
    super(
      "Semantic Research budget policy is retired; use semantic-research-recall-baseline-v5 for new Campaigns",
    );
    this.name = "RetiredSemanticBudgetPolicyError";
  }
}
