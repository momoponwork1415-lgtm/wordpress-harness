import { z } from "zod";

const providerModelUsageSchema = z.record(
  z.string(),
  z.object({
    canonicalModel: z.string().min(1),
    inputTokens: z.number().int().nonnegative().optional(),
    outputTokens: z.number().int().nonnegative().optional(),
    cacheReadInputTokens: z.number().int().nonnegative().optional(),
    cacheCreationInputTokens: z.number().int().nonnegative().optional(),
  }),
);

const providerEnvelopeSchema = z.object({
  type: z.literal("result"),
  subtype: z.literal("success"),
  is_error: z.literal(false),
  terminal_reason: z.literal("completed"),
  structured_output: z.unknown(),
  total_cost_usd: z.number().finite().nonnegative().optional(),
  duration_ms: z.number().int().nonnegative().optional(),
  num_turns: z.number().int().nonnegative().optional(),
  permission_denials: z.array(z.unknown()),
  usage: z.object({
    server_tool_use: z.object({
      web_search_requests: z.number().int().nonnegative(),
      web_fetch_requests: z.number().int().nonnegative(),
    }),
  }),
  subagent_stats: z.object({
    spawned: z.number().int().nonnegative(),
  }),
  modelUsage: providerModelUsageSchema,
});

const providerErrorEnvelopeSchema = z.object({
  type: z.literal("result"),
  is_error: z.literal(true),
  terminal_reason: z.string().min(1).max(64),
  api_error_status: z.union([
    z.number().int(),
    z.string().min(1).max(64),
    z.null(),
  ]),
  result: z
    .string()
    .min(1)
    .max(4 * 1024),
  duration_ms: z.number().int().nonnegative().optional(),
  num_turns: z.number().int().nonnegative().optional(),
  total_cost_usd: z.number().finite().nonnegative().optional(),
  modelUsage: providerModelUsageSchema.optional(),
});

export interface ClaudeProviderUsage {
  readonly measurement: "reported" | "partial";
  readonly estimatedCostUsd?: number;
  readonly providerDurationMs?: number;
  readonly modelTurns: number;
  readonly models: readonly {
    readonly id: string;
    readonly canonicalModel: string;
    readonly tokens: {
      readonly input: number;
      readonly cacheCreation: number;
      readonly cacheRead: number;
      readonly output: number;
      readonly total: number;
    };
  }[];
}

export type ClaudeEnvelopeResult =
  | {
      readonly kind: "accepted";
      readonly output: unknown;
      readonly usage: ClaudeProviderUsage;
    }
  | { readonly kind: "invalid-envelope" }
  | {
      readonly kind: "policy-denied";
      readonly reason: "tool-free-policy-violated" | "model-substitution";
    };

function decodeProviderUsage(input: {
  readonly duration_ms: number | undefined;
  readonly num_turns: number | undefined;
  readonly total_cost_usd: number | undefined;
  readonly modelUsage: z.infer<typeof providerModelUsageSchema>;
}): ClaudeProviderUsage {
  const usageEntries = Object.entries(input.modelUsage).sort(
    ([left], [right]) => (left < right ? -1 : left > right ? 1 : 0),
  );
  const fullyReported =
    input.duration_ms !== undefined &&
    input.num_turns !== undefined &&
    usageEntries.every(
      ([, usage]) =>
        usage.inputTokens !== undefined &&
        usage.outputTokens !== undefined &&
        usage.cacheReadInputTokens !== undefined &&
        usage.cacheCreationInputTokens !== undefined,
    );
  const models = usageEntries.map(([id, usage]) => {
    const inputTokens = usage.inputTokens ?? 0;
    const cacheCreation = usage.cacheCreationInputTokens ?? 0;
    const cacheRead = usage.cacheReadInputTokens ?? 0;
    const output = usage.outputTokens ?? 0;
    return {
      id,
      canonicalModel: usage.canonicalModel,
      tokens: {
        input: inputTokens,
        cacheCreation,
        cacheRead,
        output,
        total: inputTokens + cacheCreation + cacheRead + output,
      },
    };
  });
  return {
    measurement: fullyReported ? "reported" : "partial",
    ...(input.total_cost_usd === undefined
      ? {}
      : { estimatedCostUsd: input.total_cost_usd }),
    ...(input.duration_ms === undefined
      ? {}
      : { providerDurationMs: input.duration_ms }),
    modelTurns: input.num_turns ?? 0,
    models,
  };
}

export function decodeClaudeEnvelope(
  stdout: string,
  expectedModel: string,
): ClaudeEnvelopeResult {
  let envelope: z.infer<typeof providerEnvelopeSchema>;
  try {
    const parsed: unknown = JSON.parse(stdout);
    envelope = providerEnvelopeSchema.parse(parsed);
  } catch {
    return { kind: "invalid-envelope" };
  }
  if (
    envelope.permission_denials.length > 0 ||
    envelope.usage.server_tool_use.web_search_requests !== 0 ||
    envelope.usage.server_tool_use.web_fetch_requests !== 0 ||
    envelope.subagent_stats.spawned !== 0
  ) {
    return { kind: "policy-denied", reason: "tool-free-policy-violated" };
  }
  if (
    !Object.values(envelope.modelUsage).some(
      (usage) => usage.canonicalModel === expectedModel,
    )
  ) {
    return { kind: "policy-denied", reason: "model-substitution" };
  }
  return {
    kind: "accepted",
    output: envelope.structured_output,
    usage: decodeProviderUsage({
      duration_ms: envelope.duration_ms,
      num_turns: envelope.num_turns,
      total_cost_usd: envelope.total_cost_usd,
      modelUsage: envelope.modelUsage,
    }),
  };
}

export function decodeClaudeErrorEnvelope(stdout: string):
  | {
      readonly terminalReason: string;
      readonly message: string;
      readonly apiErrorStatus: number | string | null;
      readonly usage?: ClaudeProviderUsage;
    }
  | undefined {
  try {
    const parsed: unknown = JSON.parse(stdout);
    const envelope = providerErrorEnvelopeSchema.parse(parsed);
    return {
      terminalReason: envelope.terminal_reason,
      message: envelope.result,
      apiErrorStatus: envelope.api_error_status,
      ...(envelope.modelUsage === undefined
        ? {}
        : {
            usage: decodeProviderUsage({
              duration_ms: envelope.duration_ms,
              num_turns: envelope.num_turns,
              total_cost_usd: envelope.total_cost_usd,
              modelUsage: envelope.modelUsage,
            }),
          }),
    };
  } catch {
    return undefined;
  }
}
