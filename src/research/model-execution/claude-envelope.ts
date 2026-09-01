import { z } from "zod";

const providerEnvelopeSchema = z.object({
  type: z.literal("result"),
  subtype: z.literal("success"),
  is_error: z.literal(false),
  terminal_reason: z.literal("completed"),
  structured_output: z.unknown(),
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
  modelUsage: z.record(
    z.string(),
    z.object({ canonicalModel: z.string().min(1) }),
  ),
});

export type ClaudeEnvelopeResult =
  | { readonly kind: "accepted"; readonly output: unknown }
  | { readonly kind: "invalid-envelope" }
  | {
      readonly kind: "policy-denied";
      readonly reason: "tool-free-policy-violated" | "model-substitution";
    };

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
  return { kind: "accepted", output: envelope.structured_output };
}
