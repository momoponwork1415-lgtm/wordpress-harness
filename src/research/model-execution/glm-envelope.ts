import {
  decodeClaudeEnvelope,
  type ClaudeEnvelopeResult,
} from "./claude-envelope.js";

export function decodeGlmEnvelope(
  stdout: string,
  expectedModel: string,
): ClaudeEnvelopeResult {
  const decoded = decodeClaudeEnvelope(stdout, expectedModel);
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
