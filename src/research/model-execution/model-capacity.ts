import { z } from "zod";

import { sha256Digest } from "../research-record/canonical-json.js";
import type { AttemptPlanV1, AttemptPlanV2 } from "./contracts.js";

const digestSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const identifierSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
const percentageSchema = z.number().finite().min(0).max(100);
const timestampSchema = z.string().datetime({ offset: true });

const capacityWindowSchema = z.strictObject({
  usedPercent: percentageSchema,
  resetsAt: timestampSchema,
});

export const modelProviderCapacitySnapshotSchema = z.strictObject({
  kind: z.literal("model-provider-capacity-snapshot"),
  schemaVersion: z.literal(1),
  provider: z.literal("anthropic"),
  transport: z.literal("claude-code-process"),
  observedAt: timestampSchema,
  windows: z.strictObject({
    fiveHour: capacityWindowSchema,
    sevenDay: capacityWindowSchema,
  }),
});

const modelCapacityThresholdSchema = z.strictObject({
  stopAtFiveHourUsedPercent: percentageSchema,
  stopAtSevenDayUsedPercent: percentageSchema,
});

const modelCapacityPolicyContentSchema = z.strictObject({
  kind: z.literal("model-capacity-policy"),
  schemaVersion: z.literal(1),
  id: identifierSchema,
  provider: z.literal("anthropic"),
  thresholds: z.strictObject({
    newResearch: modelCapacityThresholdSchema,
    completion: modelCapacityThresholdSchema,
  }),
  unavailableTelemetry: z.literal("defer"),
});

export const modelCapacityPolicySchema =
  modelCapacityPolicyContentSchema.extend({ digest: digestSchema });

export const modelCapacityPolicyRefSchema = z.strictObject({
  id: identifierSchema,
  digest: digestSchema,
});

const capacityPrioritySchema = z.enum(["new-research", "completion"]);
const exceededWindowSchema = z.enum(["five-hour", "seven-day"]);

export const modelCapacityOutcomeArtifactSchema = z.discriminatedUnion(
  "outcome",
  [
    z.strictObject({
      kind: z.literal("model-capacity-outcome"),
      schemaVersion: z.literal(1),
      attemptId: identifierSchema,
      policy: modelCapacityPolicyRefSchema,
      priority: capacityPrioritySchema,
      outcome: z.literal("deferred"),
      exceededWindows: z.array(exceededWindowSchema).min(1).max(2),
      retryAt: timestampSchema,
      snapshot: modelProviderCapacitySnapshotSchema,
    }),
    z.strictObject({
      kind: z.literal("model-capacity-outcome"),
      schemaVersion: z.literal(1),
      attemptId: identifierSchema,
      policy: modelCapacityPolicyRefSchema,
      priority: capacityPrioritySchema,
      outcome: z.literal("telemetry-unavailable"),
      reason: z.string().min(1).max(256),
    }),
  ],
);

export type ModelProviderCapacitySnapshot = z.infer<
  typeof modelProviderCapacitySnapshotSchema
>;
export type ModelCapacityPolicy = z.infer<typeof modelCapacityPolicySchema>;
export type ModelCapacityPolicyRef = z.infer<
  typeof modelCapacityPolicyRefSchema
>;
export type ModelCapacityPriority = z.infer<typeof capacityPrioritySchema>;
export type ModelCapacityOutcomeArtifact = z.infer<
  typeof modelCapacityOutcomeArtifactSchema
>;
export type ModelCapacityRole = AttemptPlanV1["role"] | AttemptPlanV2["role"];

type ModelCapacityPolicyContent = z.infer<
  typeof modelCapacityPolicyContentSchema
>;

export type ModelCapacityDecision =
  | {
      readonly status: "admitted";
      readonly priority: ModelCapacityPriority;
    }
  | {
      readonly status: "deferred";
      readonly priority: ModelCapacityPriority;
      readonly exceededWindows: readonly z.infer<typeof exceededWindowSchema>[];
      readonly retryAt: string;
    };

export type ModelCapacityProcessResult =
  | {
      readonly kind: "capacity-deferred";
      readonly policy: ModelCapacityPolicyRef;
      readonly decision: Extract<ModelCapacityDecision, { status: "deferred" }>;
      readonly snapshot: ModelProviderCapacitySnapshot;
    }
  | {
      readonly kind: "capacity-telemetry-unavailable";
      readonly policy: ModelCapacityPolicyRef;
      readonly priority: ModelCapacityPriority;
      readonly reason: string;
    };

export function defineModelCapacityPolicy(
  input: ModelCapacityPolicyContent,
): ModelCapacityPolicy {
  const content = modelCapacityPolicyContentSchema.parse(input);
  return modelCapacityPolicySchema.parse({
    ...content,
    digest: sha256Digest(content),
  });
}

export function parseModelCapacityPolicy(
  input: ModelCapacityPolicy,
): ModelCapacityPolicy {
  const policy = modelCapacityPolicySchema.parse(input);
  const { digest, ...content } = policy;
  if (digest !== sha256Digest(content)) {
    throw new Error("Model Capacity Policy digest mismatch");
  }
  return policy;
}

export const initialOpusSubscriptionCapacityPolicy = defineModelCapacityPolicy({
  kind: "model-capacity-policy",
  schemaVersion: 1,
  id: "opus-subscription-capacity-v1",
  provider: "anthropic",
  thresholds: {
    newResearch: {
      stopAtFiveHourUsedPercent: 80,
      stopAtSevenDayUsedPercent: 80,
    },
    completion: {
      stopAtFiveHourUsedPercent: 95,
      stopAtSevenDayUsedPercent: 95,
    },
  },
  unavailableTelemetry: "defer",
});

export function modelCapacityPriorityForRole(
  role: ModelCapacityRole,
): ModelCapacityPriority {
  return role === "finder" || role === "root-planner"
    ? "new-research"
    : "completion";
}

export function evaluateModelCapacity(
  policyInput: ModelCapacityPolicy,
  role: ModelCapacityRole,
  snapshotInput: ModelProviderCapacitySnapshot,
): ModelCapacityDecision {
  const policy = parseModelCapacityPolicy(policyInput);
  const snapshot = modelProviderCapacitySnapshotSchema.parse(snapshotInput);
  if (snapshot.provider !== policy.provider) {
    throw new Error("Model Capacity Policy provider mismatch");
  }
  const priority = modelCapacityPriorityForRole(role);
  const thresholds =
    priority === "new-research"
      ? policy.thresholds.newResearch
      : policy.thresholds.completion;
  const exceededWindows: z.infer<typeof exceededWindowSchema>[] = [];
  if (
    snapshot.windows.fiveHour.usedPercent >=
    thresholds.stopAtFiveHourUsedPercent
  ) {
    exceededWindows.push("five-hour");
  }
  if (
    snapshot.windows.sevenDay.usedPercent >=
    thresholds.stopAtSevenDayUsedPercent
  ) {
    exceededWindows.push("seven-day");
  }
  if (exceededWindows.length === 0) {
    return { status: "admitted", priority };
  }
  const retryAt = new Date(
    Math.max(
      ...exceededWindows.map((window) =>
        Date.parse(
          window === "five-hour"
            ? snapshot.windows.fiveHour.resetsAt
            : snapshot.windows.sevenDay.resetsAt,
        ),
      ),
    ),
  ).toISOString();
  return {
    status: "deferred",
    priority,
    exceededWindows,
    retryAt,
  };
}

const claudeUsageEnvelopeSchema = z.object({
  is_error: z.literal(false),
  duration_api_ms: z.literal(0),
  num_turns: z.literal(0),
  total_cost_usd: z.literal(0),
  result: z.string(),
});

const resetPattern =
  /^(?<month>[A-Z][a-z]{2}) (?<day>\d{1,2}), (?<hour>\d{1,2})(?::(?<minute>\d{2}))?(?<period>am|pm) \(UTC\)$/u;
const months = new Map(
  [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ].map((month, index) => [month, index]),
);

function parseResetAt(value: string, observedAt: Date): string | undefined {
  const matched = resetPattern.exec(value);
  if (matched?.groups === undefined) return undefined;
  const month = months.get(matched.groups.month ?? "");
  const day = Number(matched.groups.day);
  const inputHour = Number(matched.groups.hour);
  const minute = Number(matched.groups.minute ?? "0");
  const period = matched.groups.period;
  if (
    month === undefined ||
    !Number.isInteger(day) ||
    day < 1 ||
    day > 31 ||
    !Number.isInteger(inputHour) ||
    inputHour < 1 ||
    inputHour > 12 ||
    !Number.isInteger(minute) ||
    minute < 0 ||
    minute > 59 ||
    (period !== "am" && period !== "pm")
  ) {
    return undefined;
  }
  const hour = (inputHour % 12) + (period === "pm" ? 12 : 0);
  let resetAt = new Date(
    Date.UTC(observedAt.getUTCFullYear(), month, day, hour, minute),
  );
  if (
    resetAt.getUTCMonth() !== month ||
    resetAt.getUTCDate() !== day ||
    resetAt.getUTCHours() !== hour ||
    resetAt.getUTCMinutes() !== minute
  ) {
    return undefined;
  }
  if (resetAt.getTime() < observedAt.getTime() - 60_000) {
    resetAt = new Date(
      Date.UTC(observedAt.getUTCFullYear() + 1, month, day, hour, minute),
    );
  } else if (resetAt.getTime() < observedAt.getTime()) {
    resetAt = new Date(observedAt);
  }
  const delayMs = resetAt.getTime() - observedAt.getTime();
  if (delayMs < 0 || delayMs > 8 * 24 * 60 * 60 * 1_000) return undefined;
  return resetAt.toISOString();
}

function usageLine(
  result: string,
  label: string,
): { readonly usedPercent: number; readonly resetText: string } | undefined {
  const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const pattern = new RegExp(
    `^${escapedLabel}: (?<percent>\\d+(?:\\.\\d+)?)% used · resets (?<reset>.+)$`,
    "mu",
  );
  const matched = pattern.exec(result);
  const usedPercent = Number(matched?.groups?.percent);
  const resetText = matched?.groups?.reset;
  if (
    resetText === undefined ||
    !Number.isFinite(usedPercent) ||
    usedPercent < 0 ||
    usedPercent > 100
  ) {
    return undefined;
  }
  return { usedPercent, resetText };
}

export function decodeClaudeSubscriptionCapacity(
  stdout: string,
  observedAtInput: Date,
): ModelProviderCapacitySnapshot | undefined {
  const observedAt = new Date(observedAtInput);
  if (!Number.isFinite(observedAt.getTime())) return undefined;
  let envelope: z.infer<typeof claudeUsageEnvelopeSchema>;
  try {
    const parsed: unknown = JSON.parse(stdout);
    envelope = claudeUsageEnvelopeSchema.parse(parsed);
  } catch {
    return undefined;
  }
  const fiveHour = usageLine(envelope.result, "Current session");
  const sevenDay = usageLine(envelope.result, "Current week (all models)");
  if (fiveHour === undefined || sevenDay === undefined) return undefined;
  const fiveHourResetsAt = parseResetAt(fiveHour.resetText, observedAt);
  const sevenDayResetsAt = parseResetAt(sevenDay.resetText, observedAt);
  if (fiveHourResetsAt === undefined || sevenDayResetsAt === undefined) {
    return undefined;
  }
  return modelProviderCapacitySnapshotSchema.parse({
    kind: "model-provider-capacity-snapshot",
    schemaVersion: 1,
    provider: "anthropic",
    transport: "claude-code-process",
    observedAt: observedAt.toISOString(),
    windows: {
      fiveHour: {
        usedPercent: fiveHour.usedPercent,
        resetsAt: fiveHourResetsAt,
      },
      sevenDay: {
        usedPercent: sevenDay.usedPercent,
        resetsAt: sevenDayResetsAt,
      },
    },
  });
}
