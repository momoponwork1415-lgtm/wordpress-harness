import { z } from "zod";

import {
  targetCandidatePoolSchema,
  targetCandidateSchema,
  type TargetCandidatePool,
} from "../candidate-pool/contracts.js";

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

export type TargetProposalResolution =
  | { readonly status: "unavailable" | "conflict" }
  | {
      readonly status: "resolved";
      readonly proposal: TargetProposal;
      readonly candidatePool: TargetCandidatePool;
    };

export interface TargetProposals {
  propose(input: TargetSelectionRunInput): Promise<TargetProposalOutcomeRef>;
  inspect(query: TargetProposalQuery): Promise<TargetProposalView>;
}

export interface OpenTargetProposalsOptions {
  readonly storageDirectory: string;
  readonly agent: TargetProposalAgent;
  readonly clock?: () => Date;
}

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
