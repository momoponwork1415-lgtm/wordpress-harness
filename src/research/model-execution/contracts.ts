import { z } from "zod";

import {
  attemptExecutionResultRefSchema,
  finderAttemptResultSchema,
  type AttemptExecutionResultRef,
  type FinderAttemptResult,
} from "../exploration/contracts.js";
import {
  sourceEvidenceReceiptRefV2Schema,
  sourceToolPolicyRefSchema,
  type SourceEvidenceGateway,
  type SourceEvidenceReceipt,
  type SourceEvidenceReceiptV2,
  type SourceEvidenceToolRequest,
  type SourceEvidenceToolRequestV2,
} from "../source-mapping/source-evidence-contracts.js";
import { targetSnapshotRefSchema } from "../contracts.js";
import { modelAttemptUsageV2Schema } from "../model-attempt-usage-contracts.js";
import { targetFileManifestRefSchema } from "../source-mapping/contracts.js";

const digestSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const identifierSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
const maxSourceEvidenceReceipts = 513;

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

const immutableRefSchema = z.strictObject({
  id: identifierSchema,
  digest: digestSchema,
});

const attemptPlanV2Fields = {
  kind: z.literal("attempt-plan"),
  schemaVersion: z.literal(2),
  attemptId: identifierSchema,
  owner: z.literal("exploration"),
  target: targetSnapshotRefSchema,
  manifest: targetFileManifestRefSchema,
  promptSet: immutableRefSchema,
  modelProfile: structuredModelProfileSchema,
  prompt: z
    .string()
    .min(1)
    .max(4 * 1024 * 1024),
  outputJsonSchema: z.record(z.string(), z.unknown()),
} as const;

const modelAttemptBudgetV2Schema = z.strictObject({
  maxWallTimeMs: z.number().int().positive(),
  maxModelTokens: z.number().int().positive(),
  maxModelTurns: z.number().int().positive(),
  maxProviderCostUsd: z.number().positive(),
  maxOutputBytes: z.number().int().positive(),
  reportedUsageEnforcement: z.literal("telemetry-only").optional(),
});

const researchThesisRefSchema = z.strictObject({
  kind: z.literal("research-thesis"),
  schemaVersion: z.literal(1),
  id: digestSchema,
  digest: digestSchema,
  targetSnapshotDigest: digestSchema,
  manifestDigest: digestSchema,
});

const semanticWorkWaveRefSchema = z.strictObject({
  kind: z.literal("work-wave"),
  schemaVersion: z.literal(2),
  id: digestSchema,
  digest: digestSchema,
  targetSnapshotDigest: digestSchema,
  manifestDigest: digestSchema,
});

export const attemptPlanV2Schema = z.discriminatedUnion("role", [
  z.strictObject({
    ...attemptPlanV2Fields,
    role: z.literal("root-planner"),
    assignment: z.strictObject({
      kind: z.literal("initial-research-planning"),
      schemaVersion: z.literal(1),
      metadata: z.strictObject({
        kind: z.literal("oracle-free-target-metadata"),
        schemaVersion: z.literal(1),
        pluginIdentity: z.string().min(1).max(256),
        mainPluginFile: z.string().min(1).max(4096),
        canonicalInstallDirectory: z.string().min(1).max(256),
      }),
      maxTargetSpecificTheses: z.number().int().min(0).max(3),
      minWildcardTheses: z.number().int().min(0).max(4),
      maxLeases: z.number().int().min(0).max(3),
    }),
    sourceToolPolicy: sourceToolPolicyRefSchema,
    budget: modelAttemptBudgetV2Schema.extend({
      maxSourceQueries: z.number().int().positive(),
      maxSourceScanBytes: z.number().int().positive().optional(),
      maxSourceResponseBytes: z.number().int().positive().optional(),
      sourceLimitTerminalOutput: z.literal("preserve").optional(),
    }),
  }),
  z.strictObject({
    ...attemptPlanV2Fields,
    role: z.literal("finder"),
    assignment: z.discriminatedUnion("kind", [
      z.strictObject({
        kind: z.literal("research-thesis"),
        schemaVersion: z.literal(1),
        workWaveId: digestSchema,
        leaseId: digestSchema,
        thesis: researchThesisRefSchema,
      }),
      z.strictObject({
        kind: z.literal("frontier-gap"),
        schemaVersion: z.literal(1),
        workWaveId: digestSchema,
        leaseId: digestSchema,
        gapId: digestSchema,
        predecessorDecisionDigest: digestSchema,
      }),
    ]),
    sourceToolPolicy: sourceToolPolicyRefSchema,
    budget: modelAttemptBudgetV2Schema.extend({
      maxSourceQueries: z.number().int().positive(),
      maxSourceScanBytes: z.number().int().positive().optional(),
      maxSourceResponseBytes: z.number().int().positive().optional(),
      sourceLimitTerminalOutput: z.literal("preserve").optional(),
    }),
  }),
  z.strictObject({
    ...attemptPlanV2Fields,
    role: z.literal("root-evaluator"),
    assignment: z.discriminatedUnion("kind", [
      z.strictObject({
        kind: z.literal("wave-evaluation"),
        schemaVersion: z.literal(1),
        wave: semanticWorkWaveRefSchema,
        terminalDigest: digestSchema,
        subjectDigests: z.array(digestSchema).min(1),
      }),
      z.strictObject({
        kind: z.literal("depth-evaluation"),
        schemaVersion: z.literal(1),
        registryDigest: digestSchema,
        synthesisDigest: digestSchema,
        critiqueDigest: digestSchema,
        proposalIds: z.array(digestSchema).min(1).max(32),
      }),
    ]),
    budget: modelAttemptBudgetV2Schema,
  }),
  z.strictObject({
    ...attemptPlanV2Fields,
    role: z.literal("root-synthesizer"),
    assignment: z.strictObject({
      kind: z.literal("depth-synthesis"),
      schemaVersion: z.literal(1),
      queueDigest: digestSchema,
      batchId: digestSchema,
      itemIds: z.array(digestSchema).min(1).max(4),
      subjectDigests: z.array(digestSchema).min(1).max(64),
    }),
    budget: modelAttemptBudgetV2Schema,
  }),
  z.strictObject({
    ...attemptPlanV2Fields,
    role: z.literal("adversarial-critic"),
    assignment: z.strictObject({
      kind: z.literal("chain-critique"),
      schemaVersion: z.literal(1),
      synthesisDigest: digestSchema,
      proposalIds: z.array(digestSchema).min(1).max(32),
    }),
    sourceToolPolicy: sourceToolPolicyRefSchema,
    budget: modelAttemptBudgetV2Schema.extend({
      maxSourceQueries: z.number().int().positive(),
      maxSourceScanBytes: z.number().int().positive().optional(),
      maxSourceResponseBytes: z.number().int().positive().optional(),
      sourceLimitTerminalOutput: z.literal("preserve").optional(),
    }),
  }),
]);

export type AttemptPlanV1 = z.infer<typeof attemptPlanSchema>;
export type AttemptPlanV2 = z.infer<typeof attemptPlanV2Schema>;
export type AttemptPlan = AttemptPlanV1;
export type ModelAttemptPlan = AttemptPlanV1 | AttemptPlanV2;
export type StructuredModelProfile = z.infer<
  typeof structuredModelProfileSchema
>;

export type AttemptExecutionResultV1 = {
  readonly status: FinderAttemptResult["status"];
  readonly ref: AttemptExecutionResultRef;
  readonly value: FinderAttemptResult;
};

const modelAttemptTerminalStatusSchema = z.enum([
  "invalid-output",
  "policy-denied",
  "auth-required",
  "provider-failed",
  "budget-exhausted",
  "cancelled",
  "orphaned",
]);

export const modelAttemptResultV2Schema = z.discriminatedUnion("status", [
  z.strictObject({
    kind: z.literal("model-attempt-result"),
    schemaVersion: z.literal(2),
    attemptId: identifierSchema,
    owner: z.literal("exploration"),
    role: z.enum([
      "root-planner",
      "finder",
      "root-evaluator",
      "root-synthesizer",
      "adversarial-critic",
    ]),
    planDigest: digestSchema,
    status: z.literal("completed"),
    output: z.unknown(),
    usage: modelAttemptUsageV2Schema.optional(),
    sourceEvidenceReceipts: z
      .array(sourceEvidenceReceiptRefV2Schema)
      .max(maxSourceEvidenceReceipts)
      .optional(),
  }),
  z.strictObject({
    kind: z.literal("model-attempt-result"),
    schemaVersion: z.literal(2),
    attemptId: identifierSchema,
    owner: z.literal("exploration"),
    role: z.enum([
      "root-planner",
      "finder",
      "root-evaluator",
      "root-synthesizer",
      "adversarial-critic",
    ]),
    planDigest: digestSchema,
    status: modelAttemptTerminalStatusSchema,
    reason: z.string().min(1).max(1_000),
    usage: modelAttemptUsageV2Schema.optional(),
    sourceEvidenceReceipts: z
      .array(sourceEvidenceReceiptRefV2Schema)
      .max(maxSourceEvidenceReceipts)
      .optional(),
  }),
]);

export const attemptExecutionResultV2RefSchema = z.strictObject({
  kind: z.literal("attempt-execution-result"),
  schemaVersion: z.literal(2),
  attemptId: identifierSchema,
  owner: z.literal("exploration"),
  role: z.enum([
    "root-planner",
    "finder",
    "root-evaluator",
    "root-synthesizer",
    "adversarial-critic",
  ]),
  planDigest: digestSchema,
  digest: digestSchema,
});

export type ModelAttemptResultV2 = z.infer<typeof modelAttemptResultV2Schema>;
export type { ModelAttemptUsageV2 } from "../model-attempt-usage-contracts.js";
export type AttemptExecutionResultV2Ref = z.infer<
  typeof attemptExecutionResultV2RefSchema
>;
export type AttemptExecutionResultV2 = {
  readonly status: ModelAttemptResultV2["status"];
  readonly ref: AttemptExecutionResultV2Ref;
  readonly value: ModelAttemptResultV2;
};
export type AttemptExecutionResult =
  AttemptExecutionResultV1 | AttemptExecutionResultV2;

export interface ModelAttemptObserver {
  checkpoint(subject: unknown): Promise<unknown>;
}

export interface ModelExecution {
  run(
    plan: ModelAttemptPlan,
    observer?: ModelAttemptObserver,
  ): Promise<AttemptExecutionResult>;
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
  readonly plan: ModelAttemptPlan;
  readonly outputJsonSchema: object;
  readonly sourceEvidence?: AttemptSourceEvidence;
}

export interface AttemptSourceEvidence {
  readonly schemaVersion: 1 | 2;
  query(request: SourceEvidenceToolRequest): Promise<SourceEvidenceReceipt>;
  query(request: SourceEvidenceToolRequestV2): Promise<SourceEvidenceReceiptV2>;
  checkpoint?(subject: unknown): Promise<unknown>;
}

export type ModelProcessResult =
  | {
      readonly kind: "auth-required";
      readonly reason: string;
    }
  | {
      readonly kind: "policy-denied";
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

export {
  attemptExecutionResultRefSchema,
  finderAttemptResultSchema,
  modelAttemptUsageV2Schema,
};
