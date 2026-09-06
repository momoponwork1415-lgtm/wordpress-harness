import { z } from "zod";

import type {
  ClaudeEnvelopeResult,
  ClaudeProviderUsage,
} from "./claude-envelope.js";

const grokModelUsageSchema = z.record(
  z.string(),
  z.object({
    inputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
    cacheReadInputTokens: z.number().int().nonnegative(),
    cacheCreationInputTokens: z.number().int().nonnegative(),
    modelCalls: z.number().int().nonnegative(),
    costUSD: z.number().finite().nonnegative().optional(),
  }),
);

const grokEnvelopeSchema = z
  .object({
    text: z.string(),
    stopReason: z.literal("end_turn"),
    sessionId: z.string().min(1),
    requestId: z.string().min(1),
    usage: z.object({
      input_tokens: z.number().int().nonnegative(),
      cache_read_input_tokens: z.number().int().nonnegative(),
      cache_creation_input_tokens: z.number().int().nonnegative(),
      output_tokens: z.number().int().nonnegative(),
      reasoning_tokens: z.number().int().nonnegative(),
      total_tokens: z.number().int().nonnegative(),
    }),
    num_turns: z.number().int().nonnegative(),
    total_cost_usd: z.number().finite().nonnegative().optional(),
    modelUsage: grokModelUsageSchema,
    structuredOutput: z.unknown(),
  })
  .refine((envelope) => Object.hasOwn(envelope, "structuredOutput"));

function expectedReportedModel(expectedModel: string): string | undefined {
  if (expectedModel === "grok-4.6") return "grok-4.6-build";
  return undefined;
}

export function decodeGrokEnvelope(
  stdout: string,
  expectedModel: string,
): ClaudeEnvelopeResult {
  let envelope: z.infer<typeof grokEnvelopeSchema>;
  try {
    const parsed: unknown = JSON.parse(stdout);
    envelope = grokEnvelopeSchema.parse(parsed);
  } catch {
    return { kind: "invalid-envelope" };
  }
  const reportedModel = expectedReportedModel(expectedModel);
  const reportedModelIds = Object.keys(envelope.modelUsage);
  if (
    reportedModel === undefined ||
    reportedModelIds.length !== 1 ||
    reportedModelIds[0] !== reportedModel
  ) {
    return { kind: "policy-denied", reason: "model-substitution" };
  }
  const reportedUsage = envelope.modelUsage[reportedModel];
  if (
    reportedUsage === undefined ||
    reportedUsage.inputTokens !== envelope.usage.input_tokens ||
    reportedUsage.outputTokens !== envelope.usage.output_tokens ||
    reportedUsage.cacheReadInputTokens !==
      envelope.usage.cache_read_input_tokens ||
    reportedUsage.cacheCreationInputTokens !==
      envelope.usage.cache_creation_input_tokens ||
    envelope.usage.total_tokens !==
      reportedUsage.inputTokens +
        reportedUsage.cacheReadInputTokens +
        reportedUsage.cacheCreationInputTokens +
        reportedUsage.outputTokens
  ) {
    return { kind: "invalid-envelope" };
  }
  const models: ClaudeProviderUsage["models"] = Object.entries(
    envelope.modelUsage,
  )
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([id, usage]) => ({
      id,
      canonicalModel: expectedModel,
      tokens: {
        input: usage.inputTokens,
        cacheCreation: usage.cacheCreationInputTokens,
        cacheRead: usage.cacheReadInputTokens,
        output: usage.outputTokens,
        total:
          usage.inputTokens +
          usage.cacheCreationInputTokens +
          usage.cacheReadInputTokens +
          usage.outputTokens,
      },
    }));
  return {
    kind: "accepted",
    output: envelope.structuredOutput,
    usage: {
      measurement: "reported",
      ...(envelope.total_cost_usd === undefined
        ? {}
        : { estimatedCostUsd: envelope.total_cost_usd }),
      modelTurns: envelope.num_turns,
      models,
    },
  };
}
