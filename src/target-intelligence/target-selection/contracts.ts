import { z } from "zod";

const digestSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const identifierSchema = z
  .string()
  .min(1)
  .max(160)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
const policyTermSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[a-z0-9][a-z0-9-]*$/);
const pluginIdentitySchema = z
  .string()
  .regex(
    /^(?:wporg:[a-z0-9][a-z0-9-]*|premium:[a-z0-9][a-z0-9-]*\/[a-z0-9][a-z0-9-]*)$/,
  );

const immutableRefSchema = z.strictObject({
  id: identifierSchema,
  digest: digestSchema,
});

export const targetSelectionPolicySchema = z.strictObject({
  kind: z.literal("target-selection-policy"),
  schemaVersion: z.literal(1),
  id: identifierSchema,
  digest: digestSchema,
  batchSize: z.number().int().positive().max(1000),
  diversity: z.strictObject({
    maximumPerFacetValue: z.number().int().positive(),
  }),
});

export const targetSelectionModelProfileSchema = z.strictObject({
  kind: z.literal("target-selection-model-profile"),
  schemaVersion: z.literal(1),
  id: identifierSchema,
  digest: digestSchema,
  family: z.literal("opus"),
});

const targetIdentitySchema = z.strictObject({
  pluginIdentity: pluginIdentitySchema,
  verifiedVersion: z.string().min(1).max(64),
  canonicalFileManifestDigest: digestSchema,
});

const targetObservationProjectionSchema = z.strictObject({
  ref: immutableRefSchema,
  retrievedAt: z.string().datetime({ offset: true }),
  currentUntil: z.string().datetime({ offset: true }),
  acquisition: z.enum(["available", "unavailable"]),
  provenance: z.enum(["verified", "unverified", "conflicting"]),
  identity: z.enum(["verified", "unverified"]),
});

export const targetSelectionFactsSchema = z.strictObject({
  activeInstallCount: z.number().int().nonnegative(),
  lastUpdatedAt: z.string().datetime({ offset: true }),
  integrations: z.array(policyTermSchema),
  sourceScale: z
    .strictObject({
      fileCount: z.number().int().positive(),
      byteCount: z.number().int().positive(),
      languages: z.array(policyTermSchema).min(1),
    })
    .optional(),
});

const programmeEligibilityProjectionSchema = z.strictObject({
  programmeIdentity: z.string().regex(/^programme:[a-z0-9][a-z0-9-]*$/),
  snapshotRef: immutableRefSchema,
  opportunityBand: z.enum(["broad", "high-impact-only", "research-only"]),
  eligibility: z.enum(["eligible", "ineligible", "unknown"]),
  currentUntil: z.string().datetime({ offset: true }),
});

const disclosureRouteProjectionSchema = z.strictObject({
  observationRef: immutableRefSchema.extend({ routeDigest: digestSchema }),
  kind: z.enum([
    "first-party-bounty",
    "first-party-vdp",
    "delegated-vdp",
    "security-contact-only",
    "none-found",
    "conflicting",
  ]),
  currentUntil: z.string().datetime({ offset: true }),
});

const vulnerabilityHistoryAggregateProjectionSchema = z.strictObject({
  snapshotRef: immutableRefSchema,
  publishedRecordCount: z.number().int().nonnegative(),
  densityBand: z.enum(["none", "low", "medium", "high"]),
  lastPublishedAt: z.string().datetime({ offset: true }).optional(),
});

export const targetSelectionResearchHistorySchema = z.discriminatedUnion(
  "status",
  [
    z.strictObject({ status: z.literal("new") }),
    z.strictObject({
      status: z.literal("active"),
      campaignId: identifierSchema,
    }),
    z.strictObject({
      status: z.literal("coverage-closed"),
      campaignId: identifierSchema,
    }),
    z.strictObject({
      status: z.literal("incomplete"),
      campaignId: identifierSchema,
      followUpReason: z.string().trim().min(1).max(512).optional(),
    }),
  ],
);

const targetDiversitySchema = z.strictObject({
  vendor: policyTermSchema,
  pluginFamily: policyTermSchema,
  useCase: policyTermSchema,
  sizeBand: policyTermSchema,
  authorityModel: policyTermSchema,
  integrations: z.array(policyTermSchema),
});

export const targetSelectionCandidateSchema = z.strictObject({
  candidateId: identifierSchema,
  target: targetIdentitySchema,
  targetObservation: targetObservationProjectionSchema,
  selectionFacts: targetSelectionFactsSchema,
  programmes: z.array(programmeEligibilityProjectionSchema).min(1),
  disclosureRoute: disclosureRouteProjectionSchema,
  vulnerabilityHistoryAggregate:
    vulnerabilityHistoryAggregateProjectionSchema.optional(),
  researchHistory: targetSelectionResearchHistorySchema,
  diversity: targetDiversitySchema,
});

export const targetSelectionRequestSchema = z
  .strictObject({
    kind: z.literal("target-selection-request"),
    schemaVersion: z.literal(1),
    selectionKey: identifierSchema,
    revision: z.number().int().positive(),
    policy: targetSelectionPolicySchema,
    modelProfile: targetSelectionModelProfileSchema,
    candidates: z.array(targetSelectionCandidateSchema).min(1),
  })
  .superRefine((request, context) => {
    const candidateIds = new Set<string>();
    const targetIdentities = new Set<string>();
    for (const [index, candidate] of request.candidates.entries()) {
      if (candidateIds.has(candidate.candidateId)) {
        context.addIssue({
          code: "custom",
          path: ["candidates", index, "candidateId"],
          message: "Candidate IDs must be unique",
        });
      }
      candidateIds.add(candidate.candidateId);
      const targetIdentity = [
        candidate.target.pluginIdentity,
        candidate.target.verifiedVersion,
        candidate.target.canonicalFileManifestDigest,
      ].join("|");
      if (targetIdentities.has(targetIdentity)) {
        context.addIssue({
          code: "custom",
          path: ["candidates", index, "target"],
          message: "A Target may occur only once in the Candidate Pool",
        });
      }
      targetIdentities.add(targetIdentity);
      const programmeIdentities = new Set<string>();
      for (const programme of candidate.programmes) {
        if (programmeIdentities.has(programme.programmeIdentity)) {
          context.addIssue({
            code: "custom",
            path: ["candidates", index, "programmes"],
            message: "A programme may occur only once for a Target",
          });
        }
        programmeIdentities.add(programme.programmeIdentity);
      }
    }
  });

export const targetSelectionModelInputSchema = z.strictObject({
  kind: z.literal("target-selection-model-input"),
  schemaVersion: z.literal(1),
  modelProfile: targetSelectionModelProfileSchema,
  candidates: z
    .array(
      z.strictObject({
        candidateId: identifierSchema,
        selectionFacts: targetSelectionFactsSchema,
        disclosureRouteKind: disclosureRouteProjectionSchema.shape.kind,
        researchHistoryStatus: z.enum(["new", "active", "incomplete"]),
        diversity: targetDiversitySchema,
      }),
    )
    .min(1),
});

export const targetSelectionModelReasonSchema = z.enum([
  "large-active-install-base",
  "recently-updated",
  "public-integrations",
  "source-scale",
  "uncertain-surface",
  "sparse-history",
]);

const targetSelectionModelAssessmentSchema = z.strictObject({
  candidateId: identifierSchema,
  researchValueBand: z.enum(["high", "medium", "low"]),
  uncertaintyBand: z.enum(["high", "medium", "low"]),
  reasonCodes: z.array(targetSelectionModelReasonSchema),
});

export const targetSelectionModelResultSchema = z.strictObject({
  kind: z.literal("target-selection-model-result"),
  schemaVersion: z.literal(1),
  rankedCandidateIds: z.array(identifierSchema).min(1),
  assessments: z.array(targetSelectionModelAssessmentSchema).min(1),
});

export const targetSelectionHardGateReasonSchema = z.enum([
  "acquisition-unavailable",
  "provenance-unverified",
  "identity-unverified",
  "target-observation-stale",
  "programme-eligibility-stale",
  "disclosure-route-stale",
  "already-covered",
  "follow-up-reason-required",
]);

export const targetSelectionReceiptReasonSchema = z.enum([
  "within-batch-capacity",
  "batch-capacity-reached",
  "diversity-cap-reached",
  "hard-gate-failed",
  "resume-active-campaign",
  "reasoned-incomplete-follow-up",
  "research-only-candidate",
]);

const targetSelectionAttemptBindingSchema = z.strictObject({
  selectionKey: identifierSchema,
  revision: z.number().int().positive(),
  requestDigest: digestSchema,
  policy: immutableRefSchema,
  modelProfile: immutableRefSchema,
});

const targetSelectionReceiptBodySchema = z.strictObject({
  kind: z.literal("selection-receipt"),
  schemaVersion: z.literal(1),
  candidateId: identifierSchema,
  candidate: targetSelectionCandidateSchema,
  decision: z.enum(["selected", "not-selected"]),
  candidateKind: z.enum(["programme-eligible", "research-only"]),
  researchTreatment: z.enum([
    "new",
    "resume",
    "already-covered",
    "follow-up",
    "follow-up-required",
  ]),
  hardGate: z.strictObject({
    status: z.enum(["passed", "failed"]),
    reasons: z.array(targetSelectionHardGateReasonSchema),
  }),
  modelAssessment: targetSelectionModelAssessmentSchema.optional(),
  selectedRank: z.number().int().positive().optional(),
  reasonCodes: z.array(targetSelectionReceiptReasonSchema).min(1),
  selectedAt: z.string().datetime({ offset: true }),
  attempt: targetSelectionAttemptBindingSchema,
});

export const targetSelectionReceiptSchema =
  targetSelectionReceiptBodySchema.extend({
    id: identifierSchema,
    digest: digestSchema,
  });

export const targetSelectionAttemptRefSchema = z.strictObject({
  kind: z.literal("target-selection-attempt-ref"),
  schemaVersion: z.literal(1),
  id: identifierSchema,
  digest: digestSchema,
});

const targetSelectionPendingReasonSchema = z.enum([
  "provider-failure",
  "budget-exhausted",
  "model-invalid",
  "interrupted",
]);

export const targetSelectionAttemptSchema = z.discriminatedUnion("status", [
  z.strictObject({
    kind: z.literal("target-selection-attempt"),
    schemaVersion: z.literal(1),
    status: z.literal("running"),
    requestDigest: digestSchema,
    input: targetSelectionRequestSchema,
    createdAt: z.string().datetime({ offset: true }),
  }),
  z.strictObject({
    kind: z.literal("target-selection-attempt"),
    schemaVersion: z.literal(1),
    status: z.literal("selected"),
    requestDigest: digestSchema,
    input: targetSelectionRequestSchema,
    createdAt: z.string().datetime({ offset: true }),
    completedAt: z.string().datetime({ offset: true }),
    modelResult: targetSelectionModelResultSchema.optional(),
    receipts: z.array(targetSelectionReceiptSchema).min(1),
  }),
  z.strictObject({
    kind: z.literal("target-selection-attempt"),
    schemaVersion: z.literal(1),
    status: z.literal("selection-pending"),
    requestDigest: digestSchema,
    input: targetSelectionRequestSchema,
    createdAt: z.string().datetime({ offset: true }),
    completedAt: z.string().datetime({ offset: true }),
    reason: targetSelectionPendingReasonSchema,
    pendingCandidateIds: z.array(identifierSchema).min(1),
  }),
]);

export type TargetSelectionPolicy = z.infer<typeof targetSelectionPolicySchema>;
export type TargetSelectionModelProfile = z.infer<
  typeof targetSelectionModelProfileSchema
>;
export type TargetSelectionFacts = z.infer<typeof targetSelectionFactsSchema>;
export type TargetSelectionResearchHistory = z.infer<
  typeof targetSelectionResearchHistorySchema
>;
export type TargetSelectionCandidate = z.infer<
  typeof targetSelectionCandidateSchema
>;
export type TargetSelectionRequest = z.infer<
  typeof targetSelectionRequestSchema
>;
export type TargetSelectionModelInput = z.infer<
  typeof targetSelectionModelInputSchema
>;
export type TargetSelectionModelResult = z.infer<
  typeof targetSelectionModelResultSchema
>;
export type TargetSelectionReceipt = z.infer<
  typeof targetSelectionReceiptSchema
>;
export type TargetSelectionAttempt = z.infer<
  typeof targetSelectionAttemptSchema
>;
export type TargetSelectionAttemptRef = z.infer<
  typeof targetSelectionAttemptRefSchema
>;
export type TargetSelectionPendingReason = z.infer<
  typeof targetSelectionPendingReasonSchema
>;

export interface TargetSelectionModel {
  rank(input: TargetSelectionModelInput): Promise<unknown>;
}

export type TargetSelectionModelErrorCode =
  "provider-failure" | "budget-exhausted";

export class TargetSelectionModelError extends Error {
  readonly code: TargetSelectionModelErrorCode;

  constructor(code: TargetSelectionModelErrorCode) {
    super(`Target Selection model ${code}`);
    this.name = "TargetSelectionModelError";
    this.code = code;
  }
}

export interface SelectedTargets {
  readonly status: "selected";
  readonly attemptRef: TargetSelectionAttemptRef;
  readonly receipts: readonly TargetSelectionReceipt[];
}

export interface TargetSelectionPending {
  readonly status: "selection-pending";
  readonly attemptRef: TargetSelectionAttemptRef;
  readonly reason: TargetSelectionPendingReason;
  readonly pendingCandidateIds: readonly string[];
}

export type TargetSelectionResult = SelectedTargets | TargetSelectionPending;

export interface TargetSelection {
  select(request: TargetSelectionRequest): Promise<TargetSelectionResult>;
}

export interface OpenTargetSelectionOptions {
  readonly storageDirectory: string;
  readonly model: TargetSelectionModel;
  readonly clock?: () => Date;
}
