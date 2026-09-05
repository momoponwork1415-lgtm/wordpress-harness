import { z } from "zod";

import {
  targetSelectionAttemptRefSchema,
  targetSelectionModelProfileSchema,
  targetSelectionPolicySchema,
  targetSelectionReceiptSchema,
} from "../target-selection/contracts.js";

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

export const approvedTargetBatchRefSchema = z.strictObject({
  kind: z.literal("approved-target-batch-ref"),
  schemaVersion: z.literal(1),
  id: identifierSchema,
  digest: digestSchema,
});

export const targetBatchBudgetSchema = z
  .strictObject({
    kind: z.literal("target-batch-budget"),
    schemaVersion: z.literal(1),
    id: identifierSchema,
    digest: digestSchema,
    maxTargets: z.number().int().positive().max(1000),
    maxActiveCampaigns: z.number().int().positive().max(1000),
  })
  .refine((budget) => budget.maxActiveCampaigns <= budget.maxTargets, {
    path: ["maxActiveCampaigns"],
    message: "Active Campaign limit cannot exceed the Target budget",
  });

export const targetBatchExecutionWindowSchema = z
  .strictObject({
    startsAt: z.string().datetime({ offset: true }),
    endsAt: z.string().datetime({ offset: true }),
  })
  .refine((window) => Date.parse(window.startsAt) < Date.parse(window.endsAt), {
    path: ["endsAt"],
    message: "Execution window must end after it starts",
  });

export const targetBatchOperatorDecisionSchema = z.strictObject({
  candidateId: identifierSchema,
  decision: z.enum(["approve", "exclude"]),
  source: z.enum(["autonomous-selection", "operator-nominated"]),
  reason: z.string().trim().min(1).max(512),
});

export const targetBatchApprovalRequestSchema = z.strictObject({
  kind: z.literal("target-batch-approval-request"),
  schemaVersion: z.literal(1),
  batchKey: identifierSchema,
  revision: z.number().int().positive(),
  selectionAttemptRef: targetSelectionAttemptRefSchema,
  selectionReceipts: z.array(targetSelectionReceiptSchema).min(1),
  selectionPolicy: targetSelectionPolicySchema,
  modelProfile: targetSelectionModelProfileSchema,
  campaignPolicy: immutableRefSchema,
  batchBudget: targetBatchBudgetSchema,
  executionWindow: targetBatchExecutionWindowSchema,
  operator: z.strictObject({
    identity: identifierSchema,
    decidedAt: z.string().datetime({ offset: true }),
  }),
  decisions: z.array(targetBatchOperatorDecisionSchema).min(1),
  approvedOrder: z.array(identifierSchema).min(1),
  orderReason: z.string().trim().min(1).max(512),
  supersedes: approvedTargetBatchRefSchema.optional(),
});

const approvedTargetSchema = z.strictObject({
  candidateId: identifierSchema,
  source: z.enum(["autonomous-selection", "operator-nominated"]),
  reason: z.string().trim().min(1).max(512),
  selectionReceiptRef: immutableRefSchema,
});

const excludedTargetSchema = z.strictObject({
  candidateId: identifierSchema,
  reason: z.string().trim().min(1).max(512),
  selectionReceiptRef: immutableRefSchema,
});

export const approvedTargetBatchSchema = z.strictObject({
  kind: z.literal("approved-target-batch"),
  schemaVersion: z.literal(1),
  id: identifierSchema,
  digest: digestSchema,
  approvalInputDigest: digestSchema,
  batchKey: identifierSchema,
  revision: z.number().int().positive(),
  selectionAttemptRef: targetSelectionAttemptRefSchema,
  selectionReceipts: z.array(targetSelectionReceiptSchema).min(1),
  selectionPolicy: targetSelectionPolicySchema,
  modelProfile: targetSelectionModelProfileSchema,
  campaignPolicy: immutableRefSchema,
  batchBudget: targetBatchBudgetSchema,
  executionWindow: targetBatchExecutionWindowSchema,
  operator: z.strictObject({
    identity: identifierSchema,
    decidedAt: z.string().datetime({ offset: true }),
  }),
  decisions: z.array(targetBatchOperatorDecisionSchema).min(1),
  approvedTargets: z.array(approvedTargetSchema).min(1),
  excludedTargets: z.array(excludedTargetSchema),
  orderReason: z.string().trim().min(1).max(512),
  supersedes: approvedTargetBatchRefSchema.optional(),
  approvedAt: z.string().datetime({ offset: true }),
});

export type TargetBatchBudget = z.infer<typeof targetBatchBudgetSchema>;
export type TargetBatchExecutionWindow = z.infer<
  typeof targetBatchExecutionWindowSchema
>;
export type TargetBatchOperatorDecision = z.infer<
  typeof targetBatchOperatorDecisionSchema
>;
export type TargetBatchApprovalRequest = z.infer<
  typeof targetBatchApprovalRequestSchema
>;
export type ApprovedTargetBatch = z.infer<typeof approvedTargetBatchSchema>;
export type ApprovedTargetBatchRef = z.infer<
  typeof approvedTargetBatchRefSchema
>;

export type TargetBatchApprovalErrorCode =
  | "approval-invalid"
  | "binding-mismatch"
  | "budget-exceeded"
  | "hard-gate-failed"
  | "receipt-integrity-failed"
  | "revision-conflict"
  | "supersede-invalid"
  | "execution-started";

export class TargetBatchApprovalError extends Error {
  readonly code: TargetBatchApprovalErrorCode;

  constructor(code: TargetBatchApprovalErrorCode) {
    super(`Target Batch Approval ${code}`);
    this.name = "TargetBatchApprovalError";
    this.code = code;
  }
}

export interface TargetBatchApproval {
  approve(request: TargetBatchApprovalRequest): Promise<ApprovedTargetBatchRef>;
  inspect(ref: ApprovedTargetBatchRef): Promise<ApprovedTargetBatch>;
}

export interface OpenTargetBatchApprovalOptions {
  readonly storageDirectory: string;
  readonly clock?: () => Date;
}
