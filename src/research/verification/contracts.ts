import { z } from "zod";

import { targetSnapshotRefSchema } from "../contracts.js";
import { sourceBoundHypothesisSchema } from "../exploration/contracts.js";
import {
  modelAttemptUsageV2Schema,
  type ModelAttemptUsageV2,
} from "../model-attempt-usage-contracts.js";
import {
  canonicalJson,
  sha256Digest,
} from "../research-record/canonical-json.js";
import { targetFileManifestRefSchema } from "../source-mapping/contracts.js";

const identifierSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
const digestSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const relativePathSchema = z
  .string()
  .min(1)
  .refine(
    (path) =>
      !path.startsWith("/") &&
      !path.includes("\\") &&
      !path.split("/").includes(".."),
    { message: "File path must be a normalized relative path" },
  );

const immutableRef = <Kind extends string>(kind: Kind) =>
  z.strictObject({
    kind: z.literal(kind),
    schemaVersion: z.literal(1),
    id: identifierSchema,
    digest: digestSchema,
  });

export const labBaselineRefSchema = z.strictObject({
  kind: z.literal("lab-baseline"),
  schemaVersion: z.literal(1),
  id: identifierSchema,
  digest: digestSchema,
  targetSnapshotDigest: digestSchema,
  runtimeProfileDigest: digestSchema,
  setupPlanDigest: digestSchema,
  configurationDigest: digestSchema,
});

const verifierModelProfileRefSchema = immutableRef("model-profile").extend({
  family: identifierSchema,
});

const verificationBudgetV1Schema = z.strictObject({
  maxVerifierAttempts: z.number().int().positive(),
  maxExperiments: z.number().int().min(2),
  maxWallTimeMs: z.number().int().positive(),
});

export const verificationBudgetV2Schema = z.strictObject({
  schemaVersion: z.literal(2),
  maxVerifierAttempts: z.number().int().positive(),
  maxExperiments: z.number().int().min(2),
  maxWallTimeMs: z.number().int().positive(),
  maxModelTokens: z.number().int().positive(),
  maxModelTurns: z.number().int().positive(),
  maxProviderCostUsd: z.number().positive(),
  maxOutputBytes: z.number().int().positive(),
  reportedUsageEnforcement: z.literal("telemetry-only").optional(),
});

const verificationPlanBaseFields = {
  kind: z.literal("verification-plan"),
  verificationId: identifierSchema,
  campaignId: identifierSchema,
  targetSnapshot: targetSnapshotRefSchema,
  scope: z.strictObject({
    permittedAttacker: z.enum(["unauthenticated", "subscriber", "customer"]),
  }),
  hypothesis: sourceBoundHypothesisSchema,
  hypothesisDigest: digestSchema,
  labBaseline: labBaselineRefSchema,
  verifierModelProfile: verifierModelProfileRefSchema,
  promptSet: immutableRef("prompt-set"),
  verificationPolicy: immutableRef("verification-policy"),
  experimentRegistry: immutableRef("experiment-registry"),
} as const;

function refineVerificationPlan(
  plan: {
    readonly hypothesis: z.infer<typeof sourceBoundHypothesisSchema>;
    readonly hypothesisDigest: string;
    readonly labBaseline: z.infer<typeof labBaselineRefSchema>;
    readonly targetSnapshot: z.infer<typeof targetSnapshotRefSchema>;
    readonly manifest?: z.infer<typeof targetFileManifestRefSchema>;
  },
  context: z.RefinementCtx,
): void {
  if (plan.hypothesisDigest !== sha256Digest(plan.hypothesis)) {
    context.addIssue({
      code: "custom",
      path: ["hypothesisDigest"],
      message: "Hypothesis digest does not match the Hypothesis",
    });
  }
  if (plan.labBaseline.targetSnapshotDigest !== plan.targetSnapshot.digest) {
    context.addIssue({
      code: "custom",
      path: ["labBaseline", "targetSnapshotDigest"],
      message: "Lab Baseline is bound to a different Target Snapshot",
    });
  }
  if (
    plan.manifest !== undefined &&
    (plan.manifest.targetSnapshotId !== plan.targetSnapshot.id ||
      plan.manifest.targetSnapshotDigest !== plan.targetSnapshot.digest)
  ) {
    context.addIssue({
      code: "custom",
      path: ["manifest"],
      message: "Target File Manifest is bound to a different Target Snapshot",
    });
  }
}

export const verificationPlanV1Schema = z
  .strictObject({
    ...verificationPlanBaseFields,
    schemaVersion: z.literal(1),
    budget: verificationBudgetV1Schema,
  })
  .superRefine(refineVerificationPlan);

export const verificationPlanV2Schema = z
  .strictObject({
    ...verificationPlanBaseFields,
    schemaVersion: z.literal(2),
    manifest: targetFileManifestRefSchema,
    budget: verificationBudgetV2Schema,
  })
  .superRefine(refineVerificationPlan);

export const verificationPlanSchema = z.union([
  verificationPlanV2Schema,
  verificationPlanV1Schema,
]);

const historicalNodeRouteHypothesisSchema = sourceBoundHypothesisSchema.extend({
  route: z.strictObject({
    anchorNodeId: digestSchema,
    nodeIds: z.array(digestSchema).min(1),
    relationIds: z.array(digestSchema),
  }),
});

const historicalNodeRouteVerificationPlanSchema = z
  .strictObject({
    ...verificationPlanBaseFields,
    schemaVersion: z.literal(1),
    hypothesis: historicalNodeRouteHypothesisSchema,
    budget: verificationBudgetV1Schema,
  })
  .superRefine((plan, context) => {
    if (plan.hypothesisDigest !== sha256Digest(plan.hypothesis)) {
      context.addIssue({
        code: "custom",
        path: ["hypothesisDigest"],
        message: "Hypothesis digest does not match the Hypothesis",
      });
    }
    if (plan.labBaseline.targetSnapshotDigest !== plan.targetSnapshot.digest) {
      context.addIssue({
        code: "custom",
        path: ["labBaseline", "targetSnapshotDigest"],
        message: "Lab Baseline is bound to a different Target Snapshot",
      });
    }
  });

export const verificationPlanLedgerSchema = z.union([
  verificationPlanSchema,
  historicalNodeRouteVerificationPlanSchema,
]);

export const sourceEvidenceSchema = z.strictObject({
  path: relativePathSchema,
  fileDigest: digestSchema,
  startLine: z.number().int().positive(),
  endLine: z.number().int().positive(),
});

export const sourceRouteExperimentProtocolSchema = z.strictObject({
  kind: z.literal("source-route-experiment-protocol"),
  schemaVersion: z.literal(1),
  adapterVersion: z.enum([
    "stored-xss-browser@v1",
    "browser-script-execution@v1",
    "sql-injection-database@v1",
    "sql-query-semantic-effect@v1",
    "authentication-state-transition@v1",
  ]),
  requiredSourceEvidence: z.array(sourceEvidenceSchema).min(1),
});

const storedXssExperimentMechanismSchema = z.strictObject({
  kind: z.literal("stored-xss-browser"),
  schemaVersion: z.literal(1),
  adapterVersion: z.literal("stored-xss-browser@v1"),
  causalFactor: identifierSchema,
  successCriterion: z.literal("privileged-browser-execution-canary"),
});

const browserScriptExecutionExperimentMechanismSchema = z.strictObject({
  kind: z.literal("browser-script-execution"),
  schemaVersion: z.literal(1),
  adapterVersion: z.literal("browser-script-execution@v1"),
  causalFactor: identifierSchema,
  successCriterion: z.literal("browser-execution-canary"),
  victimContext: z.enum(["unauthenticated", "authenticated", "privileged"]),
});

const sqlInjectionExperimentMechanismSchema = z.strictObject({
  kind: z.literal("sql-injection-database"),
  schemaVersion: z.literal(1),
  adapterVersion: z.literal("sql-injection-database@v1"),
  causalFactor: identifierSchema,
  successCriterion: z.literal("database-readback-canary"),
});

const sqlQueryEffectSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("database-readback-canary") }),
  z.strictObject({ kind: z.literal("database-state-change-canary") }),
  z.strictObject({ kind: z.literal("http-response-differential") }),
  z.strictObject({
    kind: z.literal("timing-differential"),
    minimumDeltaMs: z.number().finite().positive(),
    minimumSamples: z.number().int().min(3),
  }),
  z.strictObject({ kind: z.literal("target-account-authentication-canary") }),
]);

const sqlQuerySemanticEffectExperimentMechanismSchema = z.strictObject({
  kind: z.literal("sql-query-semantic-effect"),
  schemaVersion: z.literal(1),
  adapterVersion: z.literal("sql-query-semantic-effect@v1"),
  causalFactor: identifierSchema,
  successCriterion: z.literal("security-effect"),
  effect: sqlQueryEffectSchema,
});

const authenticationStateTransitionExperimentMechanismSchema = z.strictObject({
  kind: z.literal("authentication-state-transition"),
  schemaVersion: z.literal(1),
  adapterVersion: z.literal("authentication-state-transition@v1"),
  causalFactor: identifierSchema,
  successCriterion: z.literal("target-account-authentication-canary"),
});

const experimentMechanismSchema = z.discriminatedUnion("kind", [
  storedXssExperimentMechanismSchema,
  browserScriptExecutionExperimentMechanismSchema,
  sqlInjectionExperimentMechanismSchema,
  sqlQuerySemanticEffectExperimentMechanismSchema,
  authenticationStateTransitionExperimentMechanismSchema,
]);

const sourceRederivationBaseShape = {
  kind: z.literal("source-rederivation"),
  schemaVersion: z.literal(1),
  verificationId: identifierSchema,
  targetSnapshotDigest: digestSchema,
  hypothesisDigest: digestSchema,
  sourceEvidence: z.array(sourceEvidenceSchema).min(1),
  experiment: experimentMechanismSchema,
};

export const sourceRederivationSchema = z.discriminatedUnion("status", [
  z.strictObject({
    ...sourceRederivationBaseShape,
    status: z.literal("supported"),
  }),
  z.strictObject({
    ...sourceRederivationBaseShape,
    status: z.literal("source-falsified"),
    falsifiedCondition: z.string().min(1),
  }),
]);

export const independentVerifierResultSchema = z.strictObject({
  kind: z.literal("independent-verifier-result"),
  schemaVersion: z.literal(1),
  decision: sourceRederivationSchema,
  usage: modelAttemptUsageV2Schema,
});

const experimentBindingsSchema = z.strictObject({
  targetSnapshotDigest: digestSchema,
  labBaselineDigest: digestSchema,
  runtimeProfileDigest: digestSchema,
  setupPlanDigest: digestSchema,
  configurationDigest: digestSchema,
  adapterVersion: z.enum([
    "stored-xss-browser@v1",
    "browser-script-execution@v1",
    "sql-injection-database@v1",
    "sql-query-semantic-effect@v1",
    "authentication-state-transition@v1",
  ]),
});

export const experimentPlanSchema = z
  .strictObject({
    kind: z.literal("experiment-plan"),
    schemaVersion: z.literal(1),
    experimentId: digestSchema,
    verificationId: identifierSchema,
    role: z.enum(["witness", "control"]),
    siblingGroupId: digestSchema,
    hypothesisDigest: digestSchema,
    bindings: experimentBindingsSchema,
    mechanism: experimentMechanismSchema.and(
      z.strictObject({
        causalFactorState: z.enum(["present", "removed"]),
      }),
    ),
  })
  .superRefine((plan, context) => {
    if (plan.bindings.adapterVersion !== plan.mechanism.adapterVersion) {
      context.addIssue({
        code: "custom",
        path: ["bindings", "adapterVersion"],
        message: "Experiment binding does not match the mechanism adapter",
      });
    }
  });

export const experimentExecutionRequestSchema = z
  .strictObject({
    kind: z.literal("experiment-execution-request"),
    schemaVersion: z.literal(1),
    plan: experimentPlanSchema,
    sourceRederivation: sourceRederivationSchema,
    sourceRederivationDigest: digestSchema,
  })
  .superRefine((request, context) => {
    const { causalFactorState: _causalFactorState, ...planMechanism } =
      request.plan.mechanism;
    if (
      sha256Digest(request.sourceRederivation) !==
      request.sourceRederivationDigest
    ) {
      context.addIssue({
        code: "custom",
        path: ["sourceRederivationDigest"],
        message: "Source re-derivation digest does not match the artifact",
      });
    }
    if (
      request.sourceRederivation.verificationId !==
        request.plan.verificationId ||
      request.sourceRederivation.targetSnapshotDigest !==
        request.plan.bindings.targetSnapshotDigest ||
      request.sourceRederivation.hypothesisDigest !==
        request.plan.hypothesisDigest ||
      canonicalJson(request.sourceRederivation.experiment) !==
        canonicalJson(planMechanism)
    ) {
      context.addIssue({
        code: "custom",
        path: ["sourceRederivation"],
        message: "Source re-derivation does not match the Experiment Plan",
      });
    }
  });

const storedXssObservationSchema = z.strictObject({
  kind: z.literal("stored-xss-browser"),
  schemaVersion: z.literal(1),
  attackerRequestAccepted: z.boolean(),
  persistentStateObserved: z.boolean(),
  browserCanaryExecuted: z.boolean(),
});

const browserScriptExecutionObservationSchema = z.strictObject({
  kind: z.literal("browser-script-execution"),
  schemaVersion: z.literal(1),
  attackerSequenceExecuted: z.boolean(),
  victimContextEstablished: z.boolean(),
  browserCanaryExecuted: z.boolean(),
});

const sqlInjectionObservationSchema = z.strictObject({
  kind: z.literal("sql-injection-database"),
  schemaVersion: z.literal(1),
  attackerRequestAccepted: z.boolean(),
  databaseReadbackCanaryObserved: z.boolean(),
});

const sqlQueryEffectObservationSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("database-readback-canary"),
    observed: z.boolean(),
  }),
  z.strictObject({
    kind: z.literal("database-state-change-canary"),
    observed: z.boolean(),
  }),
  z.strictObject({
    kind: z.literal("http-response-differential"),
    relationObserved: z.boolean(),
  }),
  z.strictObject({
    kind: z.literal("timing-differential"),
    sampleCount: z.number().int().nonnegative(),
    medianDeltaMs: z.number().finite().nonnegative(),
  }),
  z.strictObject({
    kind: z.literal("target-account-authentication-canary"),
    attackerContextInitiallyAuthenticated: z.boolean(),
    targetAccountAuthenticationObserved: z.boolean(),
  }),
]);

const sqlQuerySemanticEffectObservationSchema = z.strictObject({
  kind: z.literal("sql-query-semantic-effect"),
  schemaVersion: z.literal(1),
  attackerSequenceExecuted: z.boolean(),
  effect: sqlQueryEffectObservationSchema,
});

const authenticationStateTransitionObservationSchema = z.strictObject({
  kind: z.literal("authentication-state-transition"),
  schemaVersion: z.literal(1),
  attackerContextInitiallyAuthenticated: z.boolean(),
  attackerSequenceExecuted: z.boolean(),
  targetAccountAuthenticationObserved: z.boolean(),
});

const experimentResultSchema = z.discriminatedUnion("kind", [
  storedXssObservationSchema,
  browserScriptExecutionObservationSchema,
  sqlInjectionObservationSchema,
  sqlQuerySemanticEffectObservationSchema,
  authenticationStateTransitionObservationSchema,
]);

export const experimentObservationSchema = z
  .strictObject({
    kind: z.literal("experiment-observation"),
    schemaVersion: z.literal(1),
    experimentId: digestSchema,
    verificationId: identifierSchema,
    role: z.enum(["witness", "control"]),
    hypothesisDigest: digestSchema,
    bindings: experimentBindingsSchema,
    isolation: z.strictObject({
      runtime: z.literal("gvisor"),
      runtimeDigest: digestSchema,
      siblingGroupId: digestSchema,
      labId: identifierSchema,
      fresh: z.boolean(),
      fallbackUsed: z.boolean(),
    }),
    causalFactor: z.strictObject({
      id: identifierSchema,
      state: z.enum(["present", "removed"]),
    }),
    normalFunction: z.enum(["preserved", "broken", "unknown"]),
    result: experimentResultSchema,
    artifactRefs: z.array(digestSchema),
  })
  .superRefine((observation, context) => {
    const expectedAdapter = {
      "stored-xss-browser": "stored-xss-browser@v1",
      "browser-script-execution": "browser-script-execution@v1",
      "sql-injection-database": "sql-injection-database@v1",
      "sql-query-semantic-effect": "sql-query-semantic-effect@v1",
      "authentication-state-transition": "authentication-state-transition@v1",
    }[observation.result.kind];
    if (observation.bindings.adapterVersion !== expectedAdapter) {
      context.addIssue({
        code: "custom",
        path: ["bindings", "adapterVersion"],
        message: "Experiment binding does not match the observation result",
      });
    }
  });

export const experimentObservationRefSchema = z.strictObject({
  kind: z.literal("experiment-observation"),
  schemaVersion: z.literal(1),
  experimentId: digestSchema,
  digest: digestSchema,
});

const sourceRederivationRefSchema = z.strictObject({
  kind: z.literal("source-rederivation"),
  schemaVersion: z.literal(1),
  digest: digestSchema,
});

const findingOutcomeSchema = z.strictObject({
  kind: z.literal("finding"),
  causalIdentity: sourceBoundHypothesisSchema.shape.causalIdentity,
});

const disprovedOutcomeSchema = z.strictObject({
  kind: z.literal("disproved"),
  reason: z.literal("security-property-preserved"),
  causalIdentity: sourceBoundHypothesisSchema.shape.causalIdentity,
});

export const verificationBlockReasonSchema = z.enum([
  "unsupported-experiment",
  "verifier-unavailable",
  "verifier-usage-incomplete",
  "budget-exhausted",
  "gvisor-unavailable",
  "baseline-unavailable",
  "sibling-isolation-failed",
  "experiment-failed",
  "non-hermetic",
  "evidence-incomplete",
]);

const blockedOutcomeSchema = z.strictObject({
  kind: z.literal("blocked"),
  reason: verificationBlockReasonSchema,
  causalIdentity: sourceBoundHypothesisSchema.shape.causalIdentity,
});

const verificationOutcomeSchema = z.discriminatedUnion("kind", [
  findingOutcomeSchema,
  disprovedOutcomeSchema,
  blockedOutcomeSchema,
]);

const conclusiveEvidenceV1Schema = z.strictObject({
  kind: z.literal("experiment-pair"),
  sourceRederivation: sourceRederivationRefSchema,
  witness: experimentObservationRefSchema,
  control: experimentObservationRefSchema,
});

const partialEvidenceV1Schema = z.strictObject({
  kind: z.literal("partial"),
  sourceRederivation: sourceRederivationRefSchema.optional(),
  witness: experimentObservationRefSchema.optional(),
  control: experimentObservationRefSchema.optional(),
});

const conclusiveEvidenceV2Schema = conclusiveEvidenceV1Schema.extend({
  verifierUsage: modelAttemptUsageV2Schema,
});

const partialEvidenceV2Schema = partialEvidenceV1Schema.extend({
  verifierUsage: modelAttemptUsageV2Schema.optional(),
});

const verificationIdentityFields = {
  verificationId: identifierSchema,
  campaignId: identifierSchema,
  planDigest: digestSchema,
  targetSnapshotDigest: digestSchema,
  hypothesisDigest: digestSchema,
};

const conclusiveCompletionInputV1Schema = z.strictObject({
  kind: z.literal("verification-completion"),
  schemaVersion: z.literal(1),
  ...verificationIdentityFields,
  evidence: conclusiveEvidenceV1Schema,
  outcome: z.discriminatedUnion("kind", [
    findingOutcomeSchema,
    disprovedOutcomeSchema,
  ]),
});

const blockedCompletionInputV1Schema = z.strictObject({
  kind: z.literal("verification-completion"),
  schemaVersion: z.literal(1),
  ...verificationIdentityFields,
  evidence: partialEvidenceV1Schema,
  outcome: blockedOutcomeSchema,
});

const conclusiveCompletionInputV2Schema = z.strictObject({
  kind: z.literal("verification-completion"),
  schemaVersion: z.literal(2),
  ...verificationIdentityFields,
  evidence: conclusiveEvidenceV2Schema,
  outcome: z.discriminatedUnion("kind", [
    findingOutcomeSchema,
    disprovedOutcomeSchema,
  ]),
});

const blockedCompletionInputV2Schema = z.strictObject({
  kind: z.literal("verification-completion"),
  schemaVersion: z.literal(2),
  ...verificationIdentityFields,
  evidence: partialEvidenceV2Schema,
  outcome: blockedOutcomeSchema,
});

export const verificationCompletionInputSchema = z.union([
  conclusiveCompletionInputV2Schema,
  blockedCompletionInputV2Schema,
  conclusiveCompletionInputV1Schema,
  blockedCompletionInputV1Schema,
]);

const conclusiveVerificationRecordV1Schema = z.strictObject({
  kind: z.literal("verification-record"),
  schemaVersion: z.literal(1),
  ...verificationIdentityFields,
  evidence: conclusiveEvidenceV1Schema,
  outcome: z.discriminatedUnion("kind", [
    findingOutcomeSchema,
    disprovedOutcomeSchema,
  ]),
  completedAt: z.string().datetime(),
});

const blockedVerificationRecordV1Schema = z.strictObject({
  kind: z.literal("verification-record"),
  schemaVersion: z.literal(1),
  ...verificationIdentityFields,
  evidence: partialEvidenceV1Schema,
  outcome: blockedOutcomeSchema,
  completedAt: z.string().datetime(),
});

const conclusiveVerificationRecordV2Schema = z.strictObject({
  kind: z.literal("verification-record"),
  schemaVersion: z.literal(2),
  ...verificationIdentityFields,
  evidence: conclusiveEvidenceV2Schema,
  outcome: z.discriminatedUnion("kind", [
    findingOutcomeSchema,
    disprovedOutcomeSchema,
  ]),
  completedAt: z.string().datetime(),
});

const blockedVerificationRecordV2Schema = z.strictObject({
  kind: z.literal("verification-record"),
  schemaVersion: z.literal(2),
  ...verificationIdentityFields,
  evidence: partialEvidenceV2Schema,
  outcome: blockedOutcomeSchema,
  completedAt: z.string().datetime(),
});

export const verificationRecordSchema = z.union([
  conclusiveVerificationRecordV2Schema,
  blockedVerificationRecordV2Schema,
  conclusiveVerificationRecordV1Schema,
  blockedVerificationRecordV1Schema,
]);

const verificationRecordRefFields = {
  kind: z.literal("verification-record"),
  verificationId: identifierSchema,
  digest: digestSchema,
  outcome: z.enum(["finding", "disproved", "blocked"]),
} as const;

export const verificationRecordRefSchema = z.union([
  z.strictObject({
    ...verificationRecordRefFields,
    schemaVersion: z.literal(2),
  }),
  z.strictObject({
    ...verificationRecordRefFields,
    schemaVersion: z.literal(1),
  }),
]);

const findingVerificationRecordRefSchema = z.union([
  z.strictObject({
    ...verificationRecordRefFields,
    schemaVersion: z.literal(2),
    outcome: z.literal("finding"),
  }),
  z.strictObject({
    ...verificationRecordRefFields,
    schemaVersion: z.literal(1),
    outcome: z.literal("finding"),
  }),
]);

const findingMechanismExperimentSchema = z.discriminatedUnion("kind", [
  storedXssExperimentMechanismSchema.omit({
    schemaVersion: true,
    causalFactor: true,
  }),
  browserScriptExecutionExperimentMechanismSchema.omit({
    schemaVersion: true,
    causalFactor: true,
  }),
  sqlInjectionExperimentMechanismSchema.omit({
    schemaVersion: true,
    causalFactor: true,
  }),
  sqlQuerySemanticEffectExperimentMechanismSchema.omit({
    schemaVersion: true,
    causalFactor: true,
  }),
  authenticationStateTransitionExperimentMechanismSchema.omit({
    schemaVersion: true,
    causalFactor: true,
  }),
]);

const findingMechanismProofSchema = z.strictObject({
  experiment: findingMechanismExperimentSchema,
  sourceFiles: z
    .array(sourceEvidenceSchema.pick({ path: true, fileDigest: true }))
    .min(1),
  bindings: experimentBindingsSchema,
  effect: z.strictObject({
    witness: z.strictObject({
      normalFunction: z.enum(["preserved", "broken", "unknown"]),
      result: experimentResultSchema,
    }),
    control: z.strictObject({
      normalFunction: z.enum(["preserved", "broken", "unknown"]),
      result: experimentResultSchema,
    }),
  }),
});

export const findingMechanismGroupSchema = z.strictObject({
  kind: z.literal("finding-mechanism-group"),
  schemaVersion: z.literal(1),
  id: digestSchema,
  targetSnapshotDigest: digestSchema,
  proof: findingMechanismProofSchema,
  discoveries: z.array(findingVerificationRecordRefSchema).min(1).max(96),
});

export const findingMechanismGroupsSchema = z.strictObject({
  kind: z.literal("finding-mechanism-groups"),
  schemaVersion: z.literal(1),
  campaignId: identifierSchema,
  runId: identifierSchema,
  groups: z.array(findingMechanismGroupSchema).max(96),
  digest: digestSchema,
});

export type VerificationPlan = z.infer<typeof verificationPlanSchema>;
export type VerificationPlanLedgerValue = z.infer<
  typeof verificationPlanLedgerSchema
>;
export type SourceRederivation = z.infer<typeof sourceRederivationSchema>;
export type IndependentVerifierResult = z.infer<
  typeof independentVerifierResultSchema
>;
export type SourceRouteExperimentProtocol = z.infer<
  typeof sourceRouteExperimentProtocolSchema
>;
export type ExperimentPlan = z.infer<typeof experimentPlanSchema>;
export type ExperimentExecutionRequest = z.infer<
  typeof experimentExecutionRequestSchema
>;
export type ExperimentObservation = z.infer<typeof experimentObservationSchema>;
export type ExperimentObservationRef = z.infer<
  typeof experimentObservationRefSchema
>;
export type VerificationCompletionInput = z.infer<
  typeof verificationCompletionInputSchema
>;
export type VerificationRecord = z.infer<typeof verificationRecordSchema>;
export type VerificationRecordRef = z.infer<typeof verificationRecordRefSchema>;
export type FindingMechanismGroup = z.infer<typeof findingMechanismGroupSchema>;
export type FindingMechanismGroups = z.infer<
  typeof findingMechanismGroupsSchema
>;
export type VerificationBlockReason = z.infer<
  typeof verificationBlockReasonSchema
>;

export interface VerificationRecordView {
  readonly ledgerHead: number;
  readonly occurredAt: string;
  readonly ref: VerificationRecordRef;
  readonly value: VerificationRecord;
}

export interface IndependentVerifier {
  rederive(plan: VerificationPlan): Promise<unknown>;
}

export interface LabControl {
  execute(
    request: ExperimentExecutionRequest,
  ): Promise<ExperimentObservationRef>;
}

export interface Verification {
  verify(plan: VerificationPlan): Promise<VerificationRecordRef>;
}

export interface OpenVerificationOptions {
  readonly record: import("../research-record/contracts.js").ResearchRecord;
  readonly artifactStore: import("../research-record/contracts.js").JsonArtifactStore;
  readonly independentVerifier: IndependentVerifier;
  readonly labControl: LabControl;
}

export class VerificationConflictError extends Error {
  readonly campaignId: string;
  readonly verificationId: string;

  constructor(campaignId: string, verificationId: string) {
    super(
      `Verification already exists with different input: ${campaignId}/${verificationId}`,
    );
    this.name = "VerificationConflictError";
    this.campaignId = campaignId;
    this.verificationId = verificationId;
  }
}

export class LabControlBlockedError extends Error {
  readonly reason: VerificationBlockReason;

  constructor(reason: VerificationBlockReason) {
    super(`Lab Control blocked Verification: ${reason}`);
    this.name = "LabControlBlockedError";
    this.reason = reason;
  }
}

export class IndependentVerifierBlockedError extends Error {
  readonly reason: VerificationBlockReason;
  readonly usage: ModelAttemptUsageV2 | undefined;

  constructor(reason: VerificationBlockReason, usage?: ModelAttemptUsageV2) {
    super(`Independent Verifier blocked Verification: ${reason}`);
    this.name = "IndependentVerifierBlockedError";
    this.reason = reason;
    this.usage = usage;
  }
}
