import { z } from "zod";

import { canonicalDigest } from "../../infrastructure/canonical-json.js";

const digestSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const identifierSchema = z
  .string()
  .min(1)
  .max(160)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
const termSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[a-z0-9][a-z0-9-]*$/);
const immutableRefSchema = z.strictObject({
  id: identifierSchema,
  digest: digestSchema,
});

export const targetIdentitySchema = z.strictObject({
  pluginIdentity: z
    .string()
    .regex(
      /^(?:wporg:[a-z0-9][a-z0-9-]*|premium:[a-z0-9][a-z0-9-]*\/[a-z0-9][a-z0-9-]*)$/,
    ),
  verifiedVersion: z.string().min(1).max(64),
  canonicalFileManifestDigest: digestSchema,
});

export const targetObservationSchema = z.strictObject({
  ref: immutableRefSchema,
  retrievedAt: z.iso.datetime(),
  currentUntil: z.iso.datetime(),
  acquisition: z.enum(["available", "unavailable"]),
  provenance: z.enum(["verified", "unverified", "conflicting"]),
  identity: z.enum(["verified", "unverified"]),
});

const selectionFactsSchema = z.strictObject({
  activeInstallCount: z.number().int().nonnegative(),
  lastUpdatedAt: z.iso.datetime(),
  integrations: z.array(termSchema),
  sourceScale: z
    .strictObject({
      fileCount: z.number().int().positive(),
      byteCount: z.number().int().positive(),
      languages: z.array(termSchema).min(1),
    })
    .optional(),
});

const programmeObservationSchema = z.strictObject({
  programmeIdentity: z.string().regex(/^programme:[a-z0-9][a-z0-9-]*$/),
  snapshotRef: immutableRefSchema,
  opportunityBand: z.enum(["broad", "high-impact-only", "research-only"]),
  eligibility: z.enum(["eligible", "ineligible", "unknown"]),
  currentUntil: z.iso.datetime(),
});

const disclosureRouteSchema = z.strictObject({
  observationRef: immutableRefSchema.extend({ routeDigest: digestSchema }),
  kind: z.enum([
    "first-party-bounty",
    "first-party-vdp",
    "delegated-vdp",
    "security-contact-only",
    "none-found",
    "conflicting",
  ]),
  currentUntil: z.iso.datetime(),
});

const researchHistorySchema = z.discriminatedUnion("status", [
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
  }),
]);

const vulnerabilityHistoryAggregateSchema = z.strictObject({
  snapshotRef: immutableRefSchema,
  publishedRecordCount: z.number().int().nonnegative(),
  densityBand: z.enum(["none", "low", "medium", "high"]),
  lastPublishedAt: z.iso.datetime().optional(),
});

export const targetCandidateSchema = z.strictObject({
  candidateId: identifierSchema,
  target: targetIdentitySchema,
  targetObservation: targetObservationSchema,
  selectionFacts: selectionFactsSchema,
  programmes: z.array(programmeObservationSchema),
  disclosureRoute: disclosureRouteSchema,
  vulnerabilityHistoryAggregate: vulnerabilityHistoryAggregateSchema.optional(),
  researchHistory: researchHistorySchema,
});

const targetCandidatePoolBodySchema = z.strictObject({
  kind: z.literal("target-candidate-pool"),
  schemaVersion: z.literal(1),
  id: identifierSchema,
  candidates: z.array(targetCandidateSchema).min(1),
});

export const targetCandidatePoolSchema = targetCandidatePoolBodySchema
  .extend({ digest: digestSchema })
  .superRefine((pool, context) => {
    const body = {
      kind: pool.kind,
      schemaVersion: pool.schemaVersion,
      id: pool.id,
      candidates: pool.candidates,
    };
    if (pool.digest !== canonicalDigest(body)) {
      context.addIssue({
        code: "custom",
        path: ["digest"],
        message: "Candidate Pool digest must bind its exact candidates",
      });
    }
    const candidateIds = new Set<string>();
    const targetIds = new Set<string>();
    for (const [index, candidate] of pool.candidates.entries()) {
      if (candidateIds.has(candidate.candidateId)) {
        context.addIssue({
          code: "custom",
          path: ["candidates", index, "candidateId"],
          message: "Candidate IDs must be unique",
        });
      }
      candidateIds.add(candidate.candidateId);
      const targetId = [
        candidate.target.pluginIdentity,
        candidate.target.verifiedVersion,
        candidate.target.canonicalFileManifestDigest,
      ].join("|");
      if (targetIds.has(targetId)) {
        context.addIssue({
          code: "custom",
          path: ["candidates", index, "target"],
          message: "A Target may occur only once in a Candidate Pool",
        });
      }
      targetIds.add(targetId);
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
  maxWallTimeMs: z.number().int().positive(),
  maxEstimatedCostUsd: z.number().positive(),
  digest: digestSchema,
});

export const targetSelectionRunInputSchema = z.strictObject({
  kind: z.literal("target-selection-run-input"),
  schemaVersion: z.literal(1),
  selectionKey: identifierSchema,
  revision: z.number().int().positive(),
  candidatePool: targetCandidatePoolSchema,
  selectionGuidance: immutableRefSchema,
  agentRuntimeProfile: agentRuntimeProfileSchema,
  permissionProfile: immutableRefSchema,
  budgetEnvelope: budgetEnvelopeSchema,
});

const proposedTargetSchema = z.strictObject({
  candidateId: identifierSchema,
  reason: z.string().min(1),
  uncertainty: z.string().min(1),
});

export const targetProposalReportSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    basis: z.string().min(1),
    targets: z.array(proposedTargetSchema),
  })
  .superRefine((report, context) => {
    const ids = new Set<string>();
    for (const [index, target] of report.targets.entries()) {
      if (ids.has(target.candidateId)) {
        context.addIssue({
          code: "custom",
          path: ["targets", index, "candidateId"],
          message: "A Candidate may be proposed only once",
        });
      }
      ids.add(target.candidateId);
    }
  });

const runUsageSchema = z.strictObject({
  wallTimeMs: z.number().int().nonnegative(),
  inputTokens: z.number().int().nonnegative().optional(),
  outputTokens: z.number().int().nonnegative().optional(),
  estimatedCostUsd: z.number().nonnegative().optional(),
});

const receiptShape = {
  schemaVersion: z.literal(1),
  runId: identifierSchema,
  runtimeProfileDigest: digestSchema,
  startedAt: z.iso.datetime(),
  completedAt: z.iso.datetime(),
  usage: runUsageSchema,
  activity: z.strictObject({
    subagents: z.number().int().nonnegative().nullable(),
    tools: z.array(z.string().min(1)).nullable(),
  }),
};

export const targetProposalRunReceiptSchema = z.discriminatedUnion("terminal", [
  z.strictObject({
    ...receiptShape,
    terminal: z.literal("completed"),
    report: targetProposalReportSchema,
  }),
  z.strictObject({
    ...receiptShape,
    terminal: z.enum([
      "provider-failed",
      "budget-exhausted",
      "policy-denied",
      "invalid-output",
    ]),
    failure: z.strictObject({ summary: z.string().min(1) }),
  }),
]);

export const sealedTargetSelectionRunSchema = z.strictObject({
  kind: z.literal("sealed-target-selection-run"),
  schemaVersion: z.literal(1),
  runId: identifierSchema,
  inputDigest: digestSchema,
  candidatePool: targetCandidatePoolSchema,
  selectionGuidance: immutableRefSchema,
  agentRuntimeProfile: agentRuntimeProfileSchema,
  permissionProfile: immutableRefSchema,
  budgetEnvelope: budgetEnvelopeSchema,
});

export const targetProposalRefSchema = z.strictObject({
  kind: z.literal("target-proposal-ref"),
  schemaVersion: z.literal(1),
  id: identifierSchema,
  digest: digestSchema,
  selectionKey: identifierSchema,
  revision: z.number().int().positive(),
});

const targetProposalTargetSchema = proposedTargetSchema.extend({
  candidate: targetCandidateSchema,
});

export const targetProposalSchema = z.strictObject({
  kind: z.literal("target-proposal"),
  schemaVersion: z.literal(1),
  id: identifierSchema,
  digest: digestSchema,
  inputDigest: digestSchema,
  selectionKey: identifierSchema,
  revision: z.number().int().positive(),
  candidatePool: immutableRefSchema,
  selectionGuidance: immutableRefSchema,
  agentRuntimeProfile: agentRuntimeProfileSchema,
  permissionProfile: immutableRefSchema,
  budgetEnvelope: budgetEnvelopeSchema,
  runId: identifierSchema,
  basis: z.string().min(1),
  targets: z.array(targetProposalTargetSchema),
  proposedAt: z.iso.datetime(),
});

const targetSelectionRunningSchema = z.strictObject({
  kind: z.literal("target-selection-run"),
  schemaVersion: z.literal(1),
  status: z.literal("running"),
  inputDigest: digestSchema,
  input: targetSelectionRunInputSchema,
  createdAt: z.iso.datetime(),
});

const targetSelectionProposedSchema = targetSelectionRunningSchema.extend({
  status: z.literal("proposed"),
  completedAt: z.iso.datetime(),
  receipt: targetProposalRunReceiptSchema.and(
    z.strictObject({ terminal: z.literal("completed") }).passthrough(),
  ),
  proposal: targetProposalSchema,
});

const targetSelectionPendingSchema = targetSelectionRunningSchema.extend({
  status: z.literal("selection-pending"),
  completedAt: z.iso.datetime(),
  receipt: targetProposalRunReceiptSchema.and(
    z
      .strictObject({
        terminal: z.enum([
          "provider-failed",
          "budget-exhausted",
          "policy-denied",
          "invalid-output",
        ]),
      })
      .passthrough(),
  ),
});

export const targetSelectionRunSchema = z.discriminatedUnion("status", [
  targetSelectionRunningSchema,
  targetSelectionProposedSchema,
  targetSelectionPendingSchema,
]);

export interface TargetProposalAgent {
  execute(run: SealedTargetSelectionRun): Promise<unknown>;
}

export interface TargetProposalQuery {
  readonly selectionKey: string;
  readonly revision: number;
}

export interface TargetProposalOutcomeRef {
  readonly kind: "target-proposal-outcome-ref";
  readonly schemaVersion: 1;
  readonly status: "proposed" | "selection-pending";
  readonly selectionKey: string;
  readonly revision: number;
  readonly inputDigest: string;
  readonly proposalRef?: TargetProposalRef;
}

export interface TargetProposalView extends TargetProposalOutcomeRef {
  readonly run: TargetSelectionRun;
  readonly proposal?: TargetProposal;
}

export interface TargetProposals {
  propose(input: TargetSelectionRunInput): Promise<TargetProposalOutcomeRef>;
  inspect(query: TargetProposalQuery): Promise<TargetProposalView>;
}

export interface OpenTargetProposalsOptions {
  readonly storageDirectory: string;
  readonly agent: TargetProposalAgent;
  readonly clock?: () => Date;
}

export type TargetCandidate = z.infer<typeof targetCandidateSchema>;
export type TargetCandidatePool = z.infer<typeof targetCandidatePoolSchema>;
export type TargetSelectionRunInput = z.infer<
  typeof targetSelectionRunInputSchema
>;
export type TargetProposalRunReceipt = z.infer<
  typeof targetProposalRunReceiptSchema
>;
export type SealedTargetSelectionRun = z.infer<
  typeof sealedTargetSelectionRunSchema
>;
export type TargetProposal = z.infer<typeof targetProposalSchema>;
export type TargetProposalRef = z.infer<typeof targetProposalRefSchema>;
export type TargetSelectionRun = z.infer<typeof targetSelectionRunSchema>;
