import { z } from "zod";

import {
  attemptExecutionResultRefSchema,
  finderAttemptResultSchema,
  type AttemptExecutionResultRef,
  type FinderAttemptResult,
} from "../exploration/contracts.js";
import {
  sourceToolPolicyRefSchema,
  type SourceEvidenceGateway,
  type SourceEvidenceReceipt,
  type SourceEvidenceToolRequest,
} from "../source-mapping/source-evidence-contracts.js";

const digestSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const identifierSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);

export const structuredModelProfileSchema = z.strictObject({
  provider: identifierSchema,
  model: z.string().min(1).max(256),
  transport: identifierSchema,
  executableVersion: z.string().min(1).max(64),
  effort: z.string().min(1).max(64),
  eligibilityReceiptDigest: digestSchema,
});

export const attemptPlanSchema = z.strictObject({
  kind: z.literal("attempt-plan"),
  schemaVersion: z.literal(1),
  attemptId: identifierSchema,
  leaseId: digestSchema,
  role: z.literal("finder"),
  target: z.strictObject({
    id: identifierSchema,
    digest: digestSchema,
  }),
  modelProfile: structuredModelProfileSchema.extend({
    provider: z.literal("anthropic"),
    model: z.string().min(1).max(256),
    transport: z.literal("claude-code-process"),
    effort: z.enum(["low", "medium", "high", "xhigh", "max"]),
  }),
  prompt: z
    .string()
    .min(1)
    .max(4 * 1024 * 1024),
  sourceToolPolicy: sourceToolPolicyRefSchema.optional(),
  budget: z.strictObject({
    maxWallTimeMs: z.number().int().positive(),
    maxOutputBytes: z.number().int().positive(),
    maxHypotheses: z.number().int().positive().max(32),
    maxSourceQueries: z.number().int().positive().optional(),
  }),
});

export type AttemptPlan = z.infer<typeof attemptPlanSchema>;
export type StructuredModelProfile = z.infer<
  typeof structuredModelProfileSchema
>;

export type AttemptExecutionResult = {
  readonly status: FinderAttemptResult["status"];
  readonly ref: AttemptExecutionResultRef;
  readonly value: FinderAttemptResult;
};

export interface ModelExecution {
  run(plan: AttemptPlan): Promise<AttemptExecutionResult>;
}

export interface StructuredModelRequest {
  readonly modelProfile: StructuredModelProfile;
  readonly prompt: string;
  readonly budget: {
    readonly maxWallTimeMs: number;
    readonly maxOutputBytes: number;
  };
  readonly outputJsonSchema: object;
}

export type StructuredModelResult =
  | { readonly status: "completed"; readonly output: unknown }
  | {
      readonly status:
        | "auth-required"
        | "provider-failed"
        | "budget-exhausted"
        | "invalid-output"
        | "policy-denied";
      readonly reason: string;
    };

export interface StructuredModelExecution {
  run(request: StructuredModelRequest): Promise<StructuredModelResult>;
}

export interface ModelProcessRequest {
  readonly plan: AttemptPlan;
  readonly outputJsonSchema: object;
  readonly sourceEvidence?: AttemptSourceEvidence;
}

export interface AttemptSourceEvidence {
  query(request: SourceEvidenceToolRequest): Promise<SourceEvidenceReceipt>;
}

export type ModelProcessResult =
  | {
      readonly kind: "auth-required";
      readonly reason: string;
    }
  | {
      readonly kind: "exited";
      readonly exitCode: number;
      readonly stdout: string;
      readonly stderr: string;
    }
  | {
      readonly kind: "timed-out";
      readonly stderr: string;
    }
  | {
      readonly kind: "output-limit-exceeded";
      readonly stderr: string;
    };

export interface ModelProcess {
  execute(request: ModelProcessRequest): Promise<ModelProcessResult>;
}

export interface OpenModelExecutionOptions {
  readonly artifactDirectory: string;
  readonly process: ModelProcess;
  readonly sourceEvidenceGateway?: SourceEvidenceGateway;
}

export { attemptExecutionResultRefSchema, finderAttemptResultSchema };
