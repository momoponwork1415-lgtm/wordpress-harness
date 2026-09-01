import { z } from "zod";

import {
  attemptExecutionResultRefSchema,
  finderAttemptResultSchema,
  type AttemptExecutionResultRef,
  type FinderAttemptResult,
} from "../exploration/contracts.js";

const digestSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const identifierSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);

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
  modelProfile: z.strictObject({
    provider: z.literal("anthropic"),
    model: z.literal("claude-opus-5"),
    transport: z.literal("claude-code-process"),
    executableVersion: z.string().min(1).max(64),
    effort: z.enum(["low", "medium", "high", "xhigh", "max"]),
    eligibilityReceiptDigest: digestSchema,
  }),
  prompt: z
    .string()
    .min(1)
    .max(4 * 1024 * 1024),
  budget: z.strictObject({
    maxWallTimeMs: z.number().int().positive(),
    maxOutputBytes: z.number().int().positive(),
  }),
});

export type AttemptPlan = z.infer<typeof attemptPlanSchema>;

export type AttemptExecutionResult = {
  readonly status: FinderAttemptResult["status"];
  readonly ref: AttemptExecutionResultRef;
  readonly value: FinderAttemptResult;
};

export interface ModelExecution {
  run(plan: AttemptPlan): Promise<AttemptExecutionResult>;
}

export interface ModelProcessRequest {
  readonly plan: AttemptPlan;
  readonly outputJsonSchema: object;
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
}

export { attemptExecutionResultRefSchema, finderAttemptResultSchema };
