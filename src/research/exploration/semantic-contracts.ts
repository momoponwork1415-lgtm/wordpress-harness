import { z } from "zod";

import { targetSnapshotRefSchema } from "../contracts.js";
import {
  routeFragmentProposalSchema,
  sourceBoundHypothesisSchema,
} from "./contracts.js";
import type {
  ModelExecution,
  StructuredModelProfile,
} from "../model-execution/contracts.js";
import {
  attemptExecutionResultV2RefSchema,
  modelAttemptResultV2Schema,
} from "../model-execution/contracts.js";
import { targetFileManifestRefSchema } from "../source-mapping/contracts.js";
import { sourceToolPolicyRefSchema } from "../source-mapping/source-evidence-contracts.js";
import {
  sourceEvidenceReceiptRefV2Schema,
  sourceEvidenceReceiptValueV2Schema,
} from "../source-mapping/source-evidence-contracts.js";

const digestSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const identifierSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
const boundedTextSchema = z.string().min(1).max(1_000);

export const oracleFreeTargetMetadataSchema = z.strictObject({
  kind: z.literal("oracle-free-target-metadata"),
  schemaVersion: z.literal(1),
  pluginIdentity: z.string().min(1).max(256),
  mainPluginFile: z.string().min(1).max(4096),
  canonicalInstallDirectory: z.string().min(1).max(256),
});

const plannerBudgetSchema = z.strictObject({
  maxWallTimeMs: z.number().int().positive(),
  maxModelTokens: z.number().int().positive(),
  maxModelTurns: z.number().int().positive(),
  maxProviderCostUsd: z.number().positive(),
  maxOutputBytes: z.number().int().positive(),
  maxSourceQueries: z.number().int().positive(),
  maxSourceScanBytes: z.number().int().positive().optional(),
  maxSourceResponseBytes: z.number().int().positive().optional(),
  sourceLimitTerminalOutput: z.literal("preserve").optional(),
  reportedUsageEnforcement: z.literal("telemetry-only").optional(),
});

const finderLeaseBudgetSchema = z.strictObject({
  maxWallTimeMs: z.number().int().positive(),
  maxModelTokens: z.number().int().positive(),
  maxModelTurns: z.number().int().positive(),
  maxProviderCostUsd: z.number().positive(),
  maxHypotheses: z.number().int().positive(),
  maxOutputBytes: z.number().int().positive(),
  maxSourceQueries: z.number().int().positive(),
  maxSourceScanBytes: z.number().int().positive().optional(),
  maxSourceResponseBytes: z.number().int().positive().optional(),
  sourceLimitTerminalOutput: z.literal("preserve").optional(),
  reportedUsageEnforcement: z.literal("telemetry-only").optional(),
});

export const semanticRootPlanningPolicySchema = z
  .strictObject({
    kind: z.literal("semantic-root-planning-policy"),
    schemaVersion: z.literal(1),
    id: identifierSchema,
    maxTargetSpecificTheses: z.number().int().min(0).max(3),
    minWildcardTheses: z.number().int().min(1).max(4),
    maxLeases: z.number().int().min(1).max(4),
    plannerBudget: plannerBudgetSchema,
    finderLeaseBudget: finderLeaseBudgetSchema,
  })
  .superRefine((policy, context) => {
    if (
      policy.maxTargetSpecificTheses + policy.minWildcardTheses >
      policy.maxLeases
    ) {
      context.addIssue({
        code: "custom",
        message: "Semantic planning thesis bounds exceed the lease limit",
        path: ["maxLeases"],
      });
    }
  });

export const researchThesisProposalSchema = z.strictObject({
  kind: z.literal("research-thesis-proposal"),
  schemaVersion: z.literal(1),
  scope: z.enum(["target-specific", "wildcard"]),
  securityAssumption: boundedTextSchema,
  question: boundedTextSchema,
  motivation: boundedTextSchema,
  startingBasis: boundedTextSchema,
  startingEvidence: z
    .array(
      z
        .strictObject({
          path: z.string().min(1).max(4096),
          fileDigest: digestSchema,
          startLine: z.number().int().positive(),
          endLine: z.number().int().positive(),
        })
        .refine((anchor) => anchor.endLine >= anchor.startLine, {
          message: "Source evidence endLine must not precede startLine",
        }),
    )
    .min(1)
    .max(16)
    .optional(),
  independence: boundedTextSchema,
});

export const rootPlannerOutputSchema = z
  .strictObject({
    kind: z.literal("root-planner-output"),
    schemaVersion: z.literal(1),
    theses: z.array(researchThesisProposalSchema).max(3),
  })
  .superRefine((output, context) => {
    output.theses.forEach((thesis, index) => {
      if (
        thesis.scope === "target-specific" &&
        thesis.startingEvidence === undefined
      ) {
        context.addIssue({
          code: "custom",
          path: ["theses", index, "startingEvidence"],
          message: "Target-specific Recon packets require source evidence",
        });
      }
    });
  });

const frontierGapSourceEvidenceSchema = z
  .strictObject({
    path: z.string().min(1).max(4096),
    fileDigest: digestSchema,
    startLine: z.number().int().positive(),
    endLine: z.number().int().positive(),
  })
  .refine((anchor) => anchor.endLine >= anchor.startLine, {
    message: "Source evidence endLine must not precede startLine",
  });

export const frontierGapProposalSchema = z.strictObject({
  kind: z.literal("frontier-gap-proposal"),
  schemaVersion: z.literal(1),
  requiredFact: boundedTextSchema,
  sourceEvidence: z.array(frontierGapSourceEvidenceSchema).min(1),
  falsifier: boundedTextSchema,
  nextAction: boundedTextSchema,
});

export const finderOutputV2Schema = z.strictObject({
  kind: z.literal("finder-output"),
  schemaVersion: z.literal(2),
  leaseId: digestSchema,
  hypotheses: z.array(sourceBoundHypothesisSchema),
  routeFragments: z.array(routeFragmentProposalSchema),
  frontierGaps: z.array(frontierGapProposalSchema),
});

export const semanticCheckpointSubjectProposalSchema = z.discriminatedUnion(
  "kind",
  [
    sourceBoundHypothesisSchema,
    routeFragmentProposalSchema,
    frontierGapProposalSchema,
  ],
);

export const semanticWorkWaveRefSchema = z.strictObject({
  kind: z.literal("work-wave"),
  schemaVersion: z.literal(2),
  id: digestSchema,
  digest: digestSchema,
  targetSnapshotDigest: digestSchema,
  manifestDigest: digestSchema,
});

const semanticCandidateProvenanceFields = {
  id: digestSchema,
  target: targetSnapshotRefSchema,
  manifest: targetFileManifestRefSchema,
  workWave: semanticWorkWaveRefSchema,
  attemptId: identifierSchema,
  leaseId: digestSchema,
} as const;

const semanticCandidateRefFields = {
  schemaVersion: z.literal(2),
  id: digestSchema,
  digest: digestSchema,
  attemptId: identifierSchema,
  leaseId: digestSchema,
  workWaveDigest: digestSchema,
  targetSnapshotDigest: digestSchema,
  manifestDigest: digestSchema,
} as const;

export const sourceBoundHypothesisArtifactSchema = z.strictObject({
  kind: z.literal("source-bound-hypothesis"),
  schemaVersion: z.literal(2),
  ...semanticCandidateProvenanceFields,
  value: sourceBoundHypothesisSchema,
});

export const routeFragmentArtifactSchema = z.strictObject({
  kind: z.literal("route-fragment"),
  schemaVersion: z.literal(2),
  ...semanticCandidateProvenanceFields,
  value: routeFragmentProposalSchema,
});

export const frontierGapArtifactSchema = z.strictObject({
  kind: z.literal("frontier-gap"),
  schemaVersion: z.literal(2),
  ...semanticCandidateProvenanceFields,
  value: frontierGapProposalSchema,
});

export const sourceBoundHypothesisArtifactRefSchema = z.strictObject({
  kind: z.literal("source-bound-hypothesis"),
  ...semanticCandidateRefFields,
});

export const routeFragmentArtifactRefSchema = z.strictObject({
  kind: z.literal("route-fragment"),
  ...semanticCandidateRefFields,
});

export const frontierGapArtifactRefSchema = z.strictObject({
  kind: z.literal("frontier-gap"),
  ...semanticCandidateRefFields,
});

const semanticCheckpointSubjectRefSchema = z.discriminatedUnion("kind", [
  sourceBoundHypothesisArtifactRefSchema,
  routeFragmentArtifactRefSchema,
  frontierGapArtifactRefSchema,
]);

export const semanticFinderCheckpointSchema = z.strictObject({
  kind: z.literal("finder-checkpoint"),
  schemaVersion: z.literal(1),
  id: digestSchema,
  campaignId: identifierSchema,
  runId: identifierSchema,
  attemptId: identifierSchema,
  leaseId: digestSchema,
  workWaveDigest: digestSchema,
  targetSnapshotDigest: digestSchema,
  manifestDigest: digestSchema,
  ordinal: z.number().int().positive(),
  subject: semanticCheckpointSubjectRefSchema,
});

export const semanticFinderCheckpointRefSchema =
  semanticFinderCheckpointSchema.extend({ digest: digestSchema });

export const semanticWaveAttemptOutcomeSchema = z.discriminatedUnion("status", [
  z.strictObject({
    attempt: attemptExecutionResultV2RefSchema.extend({
      owner: z.literal("exploration"),
      role: z.literal("finder"),
    }),
    status: z.literal("completed"),
  }),
  z.strictObject({
    attempt: attemptExecutionResultV2RefSchema.extend({
      owner: z.literal("exploration"),
      role: z.literal("finder"),
    }),
    status: z.enum([
      "invalid-output",
      "policy-denied",
      "auth-required",
      "provider-failed",
      "budget-exhausted",
      "cancelled",
      "orphaned",
    ]),
    reason: boundedTextSchema,
  }),
]);

export const semanticWaveTerminalSchema = z.strictObject({
  kind: z.literal("semantic-wave-terminal"),
  schemaVersion: z.literal(2),
  wave: semanticWorkWaveRefSchema,
  target: targetSnapshotRefSchema,
  manifest: targetFileManifestRefSchema,
  attempts: z.array(
    attemptExecutionResultV2RefSchema.extend({
      owner: z.literal("exploration"),
      role: z.literal("finder"),
    }),
  ),
  attemptOutcomes: z.array(semanticWaveAttemptOutcomeSchema),
  hypotheses: z.array(sourceBoundHypothesisArtifactRefSchema),
  routeFragments: z.array(routeFragmentArtifactRefSchema),
  frontierGaps: z.array(frontierGapArtifactRefSchema),
  issues: z.array(
    z.strictObject({
      attemptId: identifierSchema,
      reason: z.enum([
        "partial-finder-output",
        "invalid-finder-output",
        "foreign-source-anchor",
      ]),
    }),
  ),
});

export const semanticWaveTerminalRefSchema = z.strictObject({
  kind: z.literal("semantic-wave-terminal"),
  schemaVersion: z.literal(2),
  waveId: digestSchema,
  digest: digestSchema,
  targetSnapshotDigest: digestSchema,
  manifestDigest: digestSchema,
  attemptOutcomes: z.array(semanticWaveAttemptOutcomeSchema),
  hypotheses: z.array(sourceBoundHypothesisArtifactRefSchema),
  routeFragments: z.array(routeFragmentArtifactRefSchema),
  frontierGaps: z.array(frontierGapArtifactRefSchema),
  issues: semanticWaveTerminalSchema.shape.issues,
});

export const researchThesisSchema = researchThesisProposalSchema.extend({
  kind: z.literal("research-thesis"),
  id: digestSchema,
  target: targetSnapshotRefSchema,
  manifest: targetFileManifestRefSchema,
});

export const researchThesisRefSchema = z.strictObject({
  kind: z.literal("research-thesis"),
  schemaVersion: z.literal(1),
  id: digestSchema,
  digest: digestSchema,
  targetSnapshotDigest: digestSchema,
  manifestDigest: digestSchema,
});

export const semanticWorkLeaseSchema = z.strictObject({
  kind: z.literal("work-lease"),
  schemaVersion: z.literal(2),
  id: digestSchema,
  role: z.literal("finder"),
  target: targetSnapshotRefSchema,
  manifest: targetFileManifestRefSchema,
  assignment: z.strictObject({
    kind: z.literal("research-thesis"),
    schemaVersion: z.literal(1),
    thesisId: digestSchema,
  }),
  budget: finderLeaseBudgetSchema,
});

export const semanticWorkLeaseRefSchema = z.strictObject({
  kind: z.literal("work-lease"),
  schemaVersion: z.literal(2),
  id: digestSchema,
  digest: digestSchema,
  workWaveDigest: digestSchema,
  targetSnapshotDigest: digestSchema,
  manifestDigest: digestSchema,
});

const semanticPolicyRefSchema = z.strictObject({
  kind: z.literal("semantic-root-planning-policy"),
  schemaVersion: z.literal(1),
  id: identifierSchema,
  digest: digestSchema,
});

export const semanticWorkWavePlanSchema = z.strictObject({
  kind: z.literal("work-wave-plan"),
  schemaVersion: z.literal(2),
  id: digestSchema,
  ref: semanticWorkWaveRefSchema,
  purpose: z.strictObject({
    kind: z.enum(["raw-source", "coverage-review"]),
  }),
  target: targetSnapshotRefSchema,
  manifest: targetFileManifestRefSchema,
  policy: semanticPolicyRefSchema,
  plannerAttempt: attemptExecutionResultV2RefSchema.extend({
    owner: z.literal("exploration"),
    role: z.literal("root-planner"),
  }),
  theses: z.array(researchThesisSchema).min(1).max(4),
  leases: z.array(semanticWorkLeaseSchema).min(1).max(4),
});

export const explorationSubjectRefSchema = z.discriminatedUnion("kind", [
  researchThesisRefSchema,
  sourceBoundHypothesisArtifactRefSchema,
  routeFragmentArtifactRefSchema,
  frontierGapArtifactRefSchema,
]);

const subjectDigestListSchema = z.array(digestSchema).min(1).max(64);

export const rootEvaluatorOutputV1Schema = z.strictObject({
  kind: z.literal("root-evaluator-output"),
  schemaVersion: z.literal(1),
  actions: z
    .array(
      z.discriminatedUnion("kind", [
        z.strictObject({
          kind: z.literal("request-verification"),
          subjectDigests: subjectDigestListSchema,
          request: z.strictObject({
            hypothesisDigest: digestSchema,
            reason: boundedTextSchema,
          }),
        }),
        z.strictObject({
          kind: z.literal("admit-depth"),
          subjectDigests: subjectDigestListSchema,
          admission: z.strictObject({
            highImpactPotential: boundedTextSchema,
            composition: boundedTextSchema,
            falsifier: boundedTextSchema,
            nextAction: boundedTextSchema,
          }),
        }),
        z.strictObject({
          kind: z.literal("schedule-work"),
          subjectDigests: subjectDigestListSchema,
          work: z.strictObject({
            requiredFact: boundedTextSchema,
            falsifier: boundedTextSchema,
            nextAction: boundedTextSchema,
          }),
        }),
        z.strictObject({
          kind: z.literal("retain"),
          subjectDigests: subjectDigestListSchema,
          reason: boundedTextSchema,
        }),
        z.strictObject({
          kind: z.literal("close"),
          subjectDigests: subjectDigestListSchema,
          record: z.strictObject({
            basis: boundedTextSchema,
            reopenWhen: boundedTextSchema,
          }),
        }),
        z.strictObject({
          kind: z.literal("block"),
          subjectDigests: subjectDigestListSchema,
          blocker: z.strictObject({
            reason: boundedTextSchema,
            reopenWhen: boundedTextSchema,
          }),
        }),
      ]),
    )
    .min(1)
    .max(64),
  campaignDisposition: z.enum(["continue", "coverage-closed", "incomplete"]),
});

const approachFamilyProposalSchema = z.strictObject({
  key: identifierSchema,
  subjectDigests: subjectDigestListSchema,
  thesis: boundedTextSchema,
  mechanism: boundedTextSchema,
  falsifier: boundedTextSchema,
  nextAction: boundedTextSchema,
});

const rootValidationSourceAnchorSchema = z
  .strictObject({
    path: z.string().min(1).max(4096),
    fileDigest: digestSchema,
    startLine: z.number().int().positive(),
    endLine: z.number().int().positive(),
  })
  .refine((anchor) => anchor.endLine >= anchor.startLine, {
    message: "Source evidence endLine must not precede startLine",
  });

const rootValidationRouteStepSchema = z.strictObject({
  ordinal: z.number().int().positive(),
  claim: boundedTextSchema,
  evidence: z.array(rootValidationSourceAnchorSchema).min(1).max(32),
});

const rootValidationCausalRouteSchema = z
  .array(rootValidationRouteStepSchema)
  .min(1)
  .max(32)
  .superRefine((steps, context) => {
    steps.forEach((step, index) => {
      if (step.ordinal !== index + 1) {
        context.addIssue({
          code: "custom",
          path: [index, "ordinal"],
          message: "Validation route ordinals must be contiguous",
        });
      }
    });
  });

export const rootEvaluatorOutputV2Schema = z.strictObject({
  kind: z.literal("root-evaluator-output"),
  schemaVersion: z.literal(2),
  approachFamilies: z.array(approachFamilyProposalSchema).max(64),
  actions: z
    .array(
      z.discriminatedUnion("kind", [
        z.strictObject({
          kind: z.literal("admit-validation"),
          approachFamilyKey: identifierSchema,
          subjectDigests: subjectDigestListSchema,
          admission: z.strictObject({
            hypothesisDigest: digestSchema,
            brokenSecurityProperty: boundedTextSchema,
            causalRoute: rootValidationCausalRouteSchema,
            reason: boundedTextSchema,
          }),
        }),
        z.strictObject({
          kind: z.literal("admit-depth"),
          approachFamilyKey: identifierSchema,
          subjectDigests: subjectDigestListSchema,
          admission: z.strictObject({
            highImpactPotential: boundedTextSchema,
            composition: boundedTextSchema,
            falsifier: boundedTextSchema,
            nextAction: boundedTextSchema,
          }),
        }),
        z.strictObject({
          kind: z.literal("schedule-work"),
          subjectDigests: subjectDigestListSchema,
          work: z.strictObject({
            requiredFact: boundedTextSchema,
            falsifier: boundedTextSchema,
            nextAction: boundedTextSchema,
          }),
        }),
        z.strictObject({
          kind: z.literal("retain"),
          subjectDigests: subjectDigestListSchema,
          reason: boundedTextSchema,
        }),
        z.strictObject({
          kind: z.literal("close"),
          subjectDigests: subjectDigestListSchema,
          record: z.strictObject({
            basis: boundedTextSchema,
            reopenWhen: boundedTextSchema,
          }),
        }),
        z.strictObject({
          kind: z.literal("block"),
          subjectDigests: subjectDigestListSchema,
          blocker: z.strictObject({
            reason: boundedTextSchema,
            reopenWhen: boundedTextSchema,
          }),
        }),
      ]),
    )
    .min(1)
    .max(64),
  campaignDisposition: z.enum(["continue", "coverage-closed", "incomplete"]),
});

export const rootEvaluatorOutputSchema = z.union([
  rootEvaluatorOutputV2Schema,
  rootEvaluatorOutputV1Schema,
]);

const actionProvenanceFields = {
  id: digestSchema,
  target: targetSnapshotRefSchema,
  manifest: targetFileManifestRefSchema,
  wave: semanticWorkWaveRefSchema,
} as const;

export const iterationActionV2Schema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("request-verification"),
    subjects: z.array(explorationSubjectRefSchema).min(1),
    request: z.strictObject({
      kind: z.literal("verification-request"),
      schemaVersion: z.literal(1),
      ...actionProvenanceFields,
      hypothesis: sourceBoundHypothesisArtifactRefSchema,
      reason: boundedTextSchema,
    }),
  }),
  z.strictObject({
    kind: z.literal("admit-depth"),
    subjects: z.array(explorationSubjectRefSchema).min(1),
    admission: z.strictObject({
      kind: z.literal("depth-admission"),
      schemaVersion: z.literal(1),
      ...actionProvenanceFields,
      highImpactPotential: boundedTextSchema,
      composition: boundedTextSchema,
      falsifier: boundedTextSchema,
      nextAction: boundedTextSchema,
    }),
  }),
  z.strictObject({
    kind: z.literal("schedule-work"),
    subjects: z.array(explorationSubjectRefSchema).min(1),
    work: z.strictObject({
      kind: z.literal("next-work-request"),
      schemaVersion: z.literal(1),
      ...actionProvenanceFields,
      requiredFact: boundedTextSchema,
      falsifier: boundedTextSchema,
      nextAction: boundedTextSchema,
    }),
  }),
  z.strictObject({
    kind: z.literal("retain"),
    subjects: z.array(explorationSubjectRefSchema).min(1),
    reason: boundedTextSchema,
  }),
  z.strictObject({
    kind: z.literal("close"),
    subjects: z.array(explorationSubjectRefSchema).min(1),
    record: z.strictObject({
      kind: z.literal("closure-record"),
      schemaVersion: z.literal(1),
      ...actionProvenanceFields,
      basis: boundedTextSchema,
      reopenWhen: boundedTextSchema,
    }),
  }),
  z.strictObject({
    kind: z.literal("block"),
    subjects: z.array(explorationSubjectRefSchema).min(1),
    blocker: z.strictObject({
      kind: z.literal("exploration-blocker"),
      schemaVersion: z.literal(1),
      ...actionProvenanceFields,
      reason: boundedTextSchema,
      reopenWhen: boundedTextSchema,
    }),
  }),
]);

export const approachFamilyAdmissionSchema = z.strictObject({
  kind: z.literal("approach-family-admission"),
  schemaVersion: z.literal(1),
  key: identifierSchema,
  ...actionProvenanceFields,
  subjects: z.array(explorationSubjectRefSchema).min(1).max(64),
  thesis: boundedTextSchema,
  mechanism: boundedTextSchema,
  falsifier: boundedTextSchema,
  nextAction: boundedTextSchema,
});

export const approachFamilyAdmissionRefSchema = z.strictObject({
  kind: z.literal("approach-family-admission"),
  schemaVersion: z.literal(1),
  id: digestSchema,
  digest: digestSchema,
  key: identifierSchema,
  targetSnapshotDigest: digestSchema,
  manifestDigest: digestSchema,
  workWaveDigest: digestSchema,
});

export const iterationActionV3Schema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("admit-validation"),
    approachFamily: approachFamilyAdmissionRefSchema,
    subjects: z.array(explorationSubjectRefSchema).min(1),
    admission: z.strictObject({
      kind: z.literal("validation-admission"),
      schemaVersion: z.literal(1),
      ...actionProvenanceFields,
      hypothesis: sourceBoundHypothesisArtifactRefSchema,
      brokenSecurityProperty: boundedTextSchema,
      causalRoute: rootValidationCausalRouteSchema,
      reason: boundedTextSchema,
    }),
  }),
  z.strictObject({
    kind: z.literal("admit-depth"),
    approachFamily: approachFamilyAdmissionRefSchema,
    subjects: z.array(explorationSubjectRefSchema).min(1),
    admission: z.strictObject({
      kind: z.literal("depth-admission"),
      schemaVersion: z.literal(2),
      ...actionProvenanceFields,
      highImpactPotential: boundedTextSchema,
      composition: boundedTextSchema,
      falsifier: boundedTextSchema,
      nextAction: boundedTextSchema,
    }),
  }),
  z.strictObject({
    kind: z.literal("schedule-work"),
    subjects: z.array(explorationSubjectRefSchema).min(1),
    work: z.strictObject({
      kind: z.literal("next-work-request"),
      schemaVersion: z.literal(1),
      ...actionProvenanceFields,
      requiredFact: boundedTextSchema,
      falsifier: boundedTextSchema,
      nextAction: boundedTextSchema,
    }),
  }),
  z.strictObject({
    kind: z.literal("retain"),
    subjects: z.array(explorationSubjectRefSchema).min(1),
    reason: boundedTextSchema,
  }),
  z.strictObject({
    kind: z.literal("close"),
    subjects: z.array(explorationSubjectRefSchema).min(1),
    record: z.strictObject({
      kind: z.literal("closure-record"),
      schemaVersion: z.literal(1),
      ...actionProvenanceFields,
      basis: boundedTextSchema,
      reopenWhen: boundedTextSchema,
    }),
  }),
  z.strictObject({
    kind: z.literal("block"),
    subjects: z.array(explorationSubjectRefSchema).min(1),
    blocker: z.strictObject({
      kind: z.literal("exploration-blocker"),
      schemaVersion: z.literal(1),
      ...actionProvenanceFields,
      reason: boundedTextSchema,
      reopenWhen: boundedTextSchema,
    }),
  }),
]);

export const iterationDecisionV2Schema = z.strictObject({
  kind: z.literal("iteration-decision"),
  schemaVersion: z.literal(2),
  target: targetSnapshotRefSchema,
  manifest: targetFileManifestRefSchema,
  wave: semanticWorkWaveRefSchema,
  evaluationSubjects: z.array(explorationSubjectRefSchema).min(1),
  context: z.strictObject({
    kind: z.literal("wave-evaluation"),
    terminalDigest: digestSchema,
    workLeases: z.array(semanticWorkLeaseRefSchema).min(1).max(4),
    attemptResults: z.array(
      attemptExecutionResultV2RefSchema.extend({
        owner: z.literal("exploration"),
        role: z.literal("finder"),
      }),
    ),
    toolReceipts: z.array(sourceEvidenceReceiptRefV2Schema),
    rootEvaluatorAttempts: z
      .array(
        attemptExecutionResultV2RefSchema.extend({
          owner: z.literal("exploration"),
          role: z.literal("root-evaluator"),
        }),
      )
      .min(1)
      .max(2),
  }),
  actions: z.array(iterationActionV2Schema).min(1).max(64),
  campaignDisposition: z.enum(["continue", "coverage-closed", "incomplete"]),
});

export const iterationDecisionV3Schema = z.strictObject({
  kind: z.literal("iteration-decision"),
  schemaVersion: z.literal(3),
  target: targetSnapshotRefSchema,
  manifest: targetFileManifestRefSchema,
  wave: semanticWorkWaveRefSchema,
  evaluationSubjects: z.array(explorationSubjectRefSchema).min(1),
  context: iterationDecisionV2Schema.shape.context,
  approachFamilies: z.array(approachFamilyAdmissionSchema).max(64),
  actions: z.array(iterationActionV3Schema).min(1).max(64),
  campaignDisposition: z.enum(["continue", "coverage-closed", "incomplete"]),
});

const startSemanticResearchInputSchema = z.strictObject({
  kind: z.literal("start-semantic-research"),
  schemaVersion: z.literal(2),
  target: targetSnapshotRefSchema,
  manifest: targetFileManifestRefSchema,
});

const semanticWaveEvaluationInputFields = {
  kind: z.literal("evaluate-semantic-wave"),
  target: targetSnapshotRefSchema,
  manifest: targetFileManifestRefSchema,
  wave: semanticWorkWavePlanSchema,
  terminal: z.strictObject({
    ref: semanticWaveTerminalRefSchema,
    value: semanticWaveTerminalSchema,
  }),
  artifacts: z.strictObject({
    hypotheses: z.array(sourceBoundHypothesisArtifactSchema),
    routeFragments: z.array(routeFragmentArtifactSchema),
    frontierGaps: z.array(frontierGapArtifactSchema),
  }),
  attemptResults: z.array(
    modelAttemptResultV2Schema.refine((result) => result.role === "finder", {
      message: "Wave evaluation only accepts Finder Attempt results",
    }),
  ),
  toolReceipts: z.array(sourceEvidenceReceiptValueV2Schema),
  closureReview: z
    .strictObject({
      kind: z.literal("coverage-closure-evaluation"),
      schemaVersion: z.literal(1),
      reviewKind: z.enum(["initial-wave", "fresh-wildcard"]),
      knownSubjectIds: z.array(digestSchema).max(192),
    })
    .optional(),
} as const;

export const semanticWaveEvaluationInputV2Schema = z.strictObject({
  ...semanticWaveEvaluationInputFields,
  schemaVersion: z.literal(2),
});

export const semanticWaveEvaluationInputV3Schema = z.strictObject({
  ...semanticWaveEvaluationInputFields,
  schemaVersion: z.literal(3),
});

export const semanticWaveEvaluationInputSchema = z.union([
  semanticWaveEvaluationInputV3Schema,
  semanticWaveEvaluationInputV2Schema,
]);

export const semanticExplorationDecisionInputSchema = z.union([
  startSemanticResearchInputSchema,
  semanticWaveEvaluationInputV3Schema,
  semanticWaveEvaluationInputV2Schema,
]);

export const planningIncompleteDecisionSchema = z.strictObject({
  kind: z.literal("planning-incomplete"),
  schemaVersion: z.literal(2),
  target: targetSnapshotRefSchema,
  manifest: targetFileManifestRefSchema,
  attempts: z.array(attemptExecutionResultV2RefSchema).min(1).max(2),
  reason: z.enum([
    "planner-failed",
    "invalid-root-planner-output",
    "duplicate-research-thesis",
    "root-planner-result-mismatch",
  ]),
});

export const evaluationIncompleteDecisionSchema = z.strictObject({
  kind: z.literal("evaluation-incomplete"),
  schemaVersion: z.literal(2),
  target: targetSnapshotRefSchema,
  manifest: targetFileManifestRefSchema,
  wave: semanticWorkWaveRefSchema,
  terminalDigest: digestSchema,
  evaluationSubjects: z.array(explorationSubjectRefSchema).min(1),
  attempts: z
    .array(
      attemptExecutionResultV2RefSchema.extend({
        owner: z.literal("exploration"),
        role: z.literal("root-evaluator"),
      }),
    )
    .max(2),
  reason: z.enum([
    "evaluator-failed",
    "invalid-root-evaluator-output",
    "root-evaluator-result-mismatch",
    "subject-omission",
    "foreign-subject",
    "invalid-action-binding",
    "unsafe-closure",
  ]),
});

export const evaluationIncompleteDecisionV3Schema =
  evaluationIncompleteDecisionSchema.extend({ schemaVersion: z.literal(3) });

export const semanticExplorationDecisionSchema = z.union([
  z.strictObject({
    kind: z.literal("run-wave"),
    plan: semanticWorkWavePlanSchema,
  }),
  planningIncompleteDecisionSchema,
  iterationDecisionV3Schema,
  iterationDecisionV2Schema,
  evaluationIncompleteDecisionV3Schema,
  evaluationIncompleteDecisionSchema,
]);

export type OracleFreeTargetMetadata = z.infer<
  typeof oracleFreeTargetMetadataSchema
>;
export type SemanticRootPlanningPolicy = z.infer<
  typeof semanticRootPlanningPolicySchema
>;
export type ResearchThesisProposal = z.infer<
  typeof researchThesisProposalSchema
>;
export type RootPlannerOutput = z.infer<typeof rootPlannerOutputSchema>;
export type FinderOutputV2 = z.infer<typeof finderOutputV2Schema>;
export type FrontierGapProposal = z.infer<typeof frontierGapProposalSchema>;
export type SemanticCheckpointSubjectProposal = z.infer<
  typeof semanticCheckpointSubjectProposalSchema
>;
export type SemanticFinderCheckpoint = z.infer<
  typeof semanticFinderCheckpointSchema
>;
export type SemanticFinderCheckpointRef = z.infer<
  typeof semanticFinderCheckpointRefSchema
>;
export type ExplorationSubjectRef = z.infer<typeof explorationSubjectRefSchema>;
export type RootEvaluatorOutput = z.infer<typeof rootEvaluatorOutputSchema>;
export type RootEvaluatorOutputV1 = z.infer<typeof rootEvaluatorOutputV1Schema>;
export type RootEvaluatorOutputV2 = z.infer<typeof rootEvaluatorOutputV2Schema>;
export type IterationActionV2 = z.infer<typeof iterationActionV2Schema>;
export type IterationActionV3 = z.infer<typeof iterationActionV3Schema>;
export type ApproachFamilyAdmission = z.infer<
  typeof approachFamilyAdmissionSchema
>;
export type ApproachFamilyAdmissionRef = z.infer<
  typeof approachFamilyAdmissionRefSchema
>;
export type IterationDecisionV2 = z.infer<typeof iterationDecisionV2Schema>;
export type IterationDecisionV3 = z.infer<typeof iterationDecisionV3Schema>;
export type SemanticWaveTerminal = z.infer<typeof semanticWaveTerminalSchema>;
export type SemanticWaveAttemptOutcome = z.infer<
  typeof semanticWaveAttemptOutcomeSchema
>;
export type SemanticWaveTerminalRef = z.infer<
  typeof semanticWaveTerminalRefSchema
>;
export type ResearchThesis = z.infer<typeof researchThesisSchema>;
export type ResearchThesisRef = z.infer<typeof researchThesisRefSchema>;
export type SemanticWorkLease = z.infer<typeof semanticWorkLeaseSchema>;
export type SemanticWorkLeaseRef = z.infer<typeof semanticWorkLeaseRefSchema>;
export type SemanticWorkWaveRef = z.infer<typeof semanticWorkWaveRefSchema>;
export type SemanticWorkWavePlan = z.infer<typeof semanticWorkWavePlanSchema>;
export type SemanticExplorationDecisionInput = z.infer<
  typeof semanticExplorationDecisionInputSchema
>;
export type SemanticWaveEvaluationInput = z.infer<
  typeof semanticWaveEvaluationInputSchema
>;
export type SemanticWaveEvaluationInputV2 = z.infer<
  typeof semanticWaveEvaluationInputV2Schema
>;
export type SemanticWaveEvaluationInputV3 = z.infer<
  typeof semanticWaveEvaluationInputV3Schema
>;
export type SemanticExplorationDecision = z.infer<
  typeof semanticExplorationDecisionSchema
>;
export type PlanningIncompleteDecision = z.infer<
  typeof planningIncompleteDecisionSchema
>;
export type EvaluationIncompleteDecision = z.infer<
  typeof evaluationIncompleteDecisionSchema
>;

export interface SemanticExploration {
  decide(
    input: SemanticExplorationDecisionInput,
  ): Promise<SemanticExplorationDecision>;
}

export interface OpenSemanticExplorationOptions {
  readonly target: z.infer<typeof targetSnapshotRefSchema>;
  readonly manifest: z.infer<typeof targetFileManifestRefSchema>;
  readonly attemptNamespace?: string;
  readonly metadata: OracleFreeTargetMetadata;
  readonly semanticPolicy: SemanticRootPlanningPolicy;
  readonly planner: {
    readonly modelExecution: ModelExecution;
    readonly promptSet: {
      readonly id: string;
      readonly digest: string;
    };
    readonly modelProfile: StructuredModelProfile;
    readonly sourceToolPolicy: z.infer<typeof sourceToolPolicyRefSchema>;
  };
  readonly evaluator?: {
    readonly modelExecution: ModelExecution;
    readonly promptSet: {
      readonly id: string;
      readonly digest: string;
    };
    readonly modelProfile: StructuredModelProfile;
    readonly budget: {
      readonly maxWallTimeMs: number;
      readonly maxModelTokens: number;
      readonly maxModelTurns: number;
      readonly maxProviderCostUsd: number;
      readonly maxOutputBytes: number;
    };
  };
}
