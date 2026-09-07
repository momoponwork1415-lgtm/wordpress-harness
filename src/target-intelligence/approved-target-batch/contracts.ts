import { z } from "zod";

import {
  targetCandidateSchema,
  targetIdentitySchema,
  targetObservationSchema,
  targetProposalRefSchema,
  type TargetProposalView,
} from "../target-proposal/contracts.js";

const digestSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const identifierSchema = z
  .string()
  .min(1)
  .max(160)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
const immutableRefSchema = z.strictObject({
  id: identifierSchema,
  digest: digestSchema,
});

export const approvedTargetBatchBudgetSchema = z
  .strictObject({
    id: identifierSchema,
    digest: digestSchema,
    maxTargets: z.number().int().positive().max(1000),
    maxActiveCampaigns: z.number().int().positive().max(1000),
  })
  .refine((budget) => budget.maxActiveCampaigns <= budget.maxTargets, {
    path: ["maxActiveCampaigns"],
    message: "Active Campaign capacity cannot exceed approved Targets",
  });

const executionWindowSchema = z
  .strictObject({
    startsAt: z.iso.datetime(),
    endsAt: z.iso.datetime(),
  })
  .refine((window) => Date.parse(window.startsAt) < Date.parse(window.endsAt), {
    path: ["endsAt"],
    message: "Execution window must end after it starts",
  });

const nominationSchema = z.strictObject({
  candidateId: identifierSchema,
  reason: z.string().min(1),
});

const decisionSchema = z.strictObject({
  candidateId: identifierSchema,
  decision: z.enum(["approve", "exclude"]),
  reason: z.string().min(1),
});

export const approvedTargetBatchRequestSchema = z.strictObject({
  kind: z.literal("approved-target-batch-request"),
  schemaVersion: z.literal(3),
  batchKey: identifierSchema,
  revision: z.number().int().positive(),
  proposalRef: targetProposalRefSchema,
  campaignPolicy: immutableRefSchema,
  batchBudget: approvedTargetBatchBudgetSchema,
  executionWindow: executionWindowSchema,
  operator: z.strictObject({
    identity: identifierSchema,
    decidedAt: z.iso.datetime(),
  }),
  nominations: z.array(nominationSchema),
  decisions: z.array(decisionSchema).min(1),
  approvedOrder: z.array(identifierSchema).min(1),
});

export const approvedTargetBatchRefSchema = z.strictObject({
  kind: z.literal("approved-target-batch-ref"),
  schemaVersion: z.literal(3),
  id: identifierSchema,
  digest: digestSchema,
  batchKey: identifierSchema,
  revision: z.number().int().positive(),
});

const approvedTargetSchema = z.discriminatedUnion("source", [
  z.strictObject({
    candidateId: identifierSchema,
    candidate: targetCandidateSchema,
    source: z.literal("agent-proposal"),
    proposalReason: z.string().min(1),
    proposalUncertainty: z.string().min(1),
    humanReason: z.string().min(1),
  }),
  z.strictObject({
    candidateId: identifierSchema,
    candidate: targetCandidateSchema,
    source: z.literal("operator-nomination"),
    nominationReason: z.string().min(1),
    humanReason: z.string().min(1),
  }),
]);

const excludedTargetSchema = z.strictObject({
  candidateId: identifierSchema,
  humanReason: z.string().min(1),
});

export const approvedTargetBatchSchema = z.strictObject({
  kind: z.literal("approved-target-batch"),
  schemaVersion: z.literal(3),
  id: identifierSchema,
  digest: digestSchema,
  approvalInputDigest: digestSchema,
  batchKey: identifierSchema,
  revision: z.number().int().positive(),
  proposalRef: targetProposalRefSchema,
  campaignPolicy: immutableRefSchema,
  batchBudget: approvedTargetBatchBudgetSchema,
  executionWindow: executionWindowSchema,
  operator: z.strictObject({
    identity: identifierSchema,
    decidedAt: z.iso.datetime(),
  }),
  decisions: z.array(decisionSchema).min(1),
  approvedOrder: z.array(identifierSchema).min(1),
  approvedTargets: z.array(approvedTargetSchema).min(1),
  excludedTargets: z.array(excludedTargetSchema),
  externalAction: z.literal("not-authorized"),
  approvedAt: z.iso.datetime(),
});

export const targetDispatchAdmissionRequestSchema = z.strictObject({
  kind: z.literal("target-dispatch-admission-request"),
  schemaVersion: z.literal(1),
  batchRef: approvedTargetBatchRefSchema,
  candidateId: identifierSchema,
  target: targetIdentitySchema,
  targetObservation: targetObservationSchema,
  checkedAt: z.iso.datetime(),
});

export const targetDispatchAdmissionSchema = z.strictObject({
  kind: z.literal("target-dispatch-admission"),
  schemaVersion: z.literal(1),
  id: identifierSchema,
  digest: digestSchema,
  batchRef: approvedTargetBatchRefSchema,
  candidateId: identifierSchema,
  target: targetIdentitySchema,
  targetObservation: targetObservationSchema,
  checkedAt: z.iso.datetime(),
});

export interface TargetProposalSource {
  inspect(query: {
    readonly selectionKey: string;
    readonly revision: number;
  }): Promise<TargetProposalView>;
}

export interface ApprovedTargetBatches {
  approve(request: ApprovedTargetBatchRequest): Promise<ApprovedTargetBatchRef>;
  inspect(ref: ApprovedTargetBatchRef): Promise<ApprovedTargetBatch>;
  admitDispatch(
    request: TargetDispatchAdmissionRequest,
  ): Promise<TargetDispatchAdmission>;
}

export interface OpenApprovedTargetBatchesOptions {
  readonly storageDirectory: string;
  readonly proposals: TargetProposalSource;
  readonly clock?: () => Date;
}

export type ApprovedTargetBatchRequest = z.infer<
  typeof approvedTargetBatchRequestSchema
>;
export type ApprovedTargetBatch = z.infer<typeof approvedTargetBatchSchema>;
export type ApprovedTargetBatchRef = z.infer<
  typeof approvedTargetBatchRefSchema
>;
export type TargetDispatchAdmissionRequest = z.infer<
  typeof targetDispatchAdmissionRequestSchema
>;
export type TargetDispatchAdmission = z.infer<
  typeof targetDispatchAdmissionSchema
>;
