import { z } from "zod";

import {
  decodeClaudeEnvelope,
  type ClaudeEnvelopeResult,
} from "./claude-envelope.js";

const glmResultEnvelopeSchema = z.object({ result: z.string().min(1) }).loose();

function decodeTerminalJson(result: string): unknown | undefined {
  const trimmed = result.trim();
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    const objectOffset = trimmed.indexOf("{");
    const arrayOffset = trimmed.indexOf("[");
    const offsets = [objectOffset, arrayOffset].filter((offset) => offset > 0);
    if (offsets.length === 0) return undefined;
    try {
      return JSON.parse(trimmed.slice(Math.min(...offsets))) as unknown;
    } catch {
      return undefined;
    }
  }
}

function attachGlmStructuredOutput(stdout: string): string | undefined {
  try {
    const envelope = glmResultEnvelopeSchema.parse(JSON.parse(stdout));
    const structuredOutput = decodeTerminalJson(envelope.result);
    if (structuredOutput === undefined) return undefined;
    return JSON.stringify({
      ...envelope,
      structured_output: structuredOutput,
    });
  } catch {
    return undefined;
  }
}

export function decodeGlmEnvelope(
  stdout: string,
  expectedModel: string,
): ClaudeEnvelopeResult {
  const direct = decodeClaudeEnvelope(stdout, expectedModel);
  const decoded =
    direct.kind === "invalid-envelope"
      ? decodeClaudeEnvelope(
          attachGlmStructuredOutput(stdout) ?? stdout,
          expectedModel,
        )
      : direct;
  if (decoded.kind !== "accepted") return decoded;
  if (
    decoded.usage.models.some(
      (usage) => !usage.canonicalModel.startsWith("glm-"),
    )
  ) {
    return { kind: "policy-denied", reason: "model-substitution" };
  }
  return decoded;
}
