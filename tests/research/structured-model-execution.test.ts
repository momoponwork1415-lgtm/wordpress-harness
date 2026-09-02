import { describe, expect, it } from "vitest";

import {
  openClaudeStructuredModelExecutionFromProcess,
  type ClaudeStructuredProcess,
  type StructuredModelRequest,
} from "../../src/research/model-execution/index.js";

const request: StructuredModelRequest = {
  modelProfile: {
    provider: "anthropic",
    model: "claude-opus-5",
    transport: "claude-code-process",
    executableVersion: "2.1.251",
    effort: "high",
    eligibilityReceiptDigest: `sha256:${"a".repeat(64)}`,
  },
  prompt: "Return a synthetic structured result.",
  budget: { maxWallTimeMs: 60_000, maxOutputBytes: 1_000_000 },
  outputJsonSchema: { type: "object" },
};

function providerEnvelope(output: unknown, webSearchRequests = 0): string {
  return JSON.stringify({
    type: "result",
    subtype: "success",
    is_error: false,
    terminal_reason: "completed",
    structured_output: output,
    permission_denials: [],
    usage: {
      server_tool_use: {
        web_search_requests: webSearchRequests,
        web_fetch_requests: 0,
      },
    },
    subagent_stats: { spawned: 0 },
    modelUsage: {
      "claude-opus-5": { canonicalModel: "claude-opus-5" },
    },
  });
}

describe("Claude structured model execution", () => {
  it("rejects a Model Profile bound to another provider before launch", async () => {
    let launched = false;
    const process: ClaudeStructuredProcess = {
      execute: async () => {
        launched = true;
        throw new Error("Unexpected launch");
      },
    };
    const execution = openClaudeStructuredModelExecutionFromProcess(process);

    await expect(
      execution.run({
        ...request,
        modelProfile: {
          ...request.modelProfile,
          provider: "test-provider",
          transport: "test-transport",
        },
      }),
    ).resolves.toMatchObject({
      status: "policy-denied",
      reason: "transport-profile-incompatible",
    });
    expect(launched).toBe(false);
  });

  it("normalizes one policy-compliant Claude envelope", async () => {
    const process: ClaudeStructuredProcess = {
      execute: async () => ({
        kind: "exited",
        exitCode: 0,
        stdout: providerEnvelope({ answer: 42 }),
        stderr: "",
      }),
    };
    const execution = openClaudeStructuredModelExecutionFromProcess(process);

    await expect(execution.run(request)).resolves.toEqual({
      status: "completed",
      output: { answer: 42 },
    });
  });

  it.each([
    {
      name: "authentication failure",
      processResult: {
        kind: "auth-required" as const,
        reason: "provider-session-unavailable",
      },
      expected: "auth-required",
    },
    {
      name: "wall-time exhaustion",
      processResult: { kind: "timed-out" as const, stderr: "" },
      expected: "budget-exhausted",
    },
    {
      name: "invalid envelope",
      processResult: {
        kind: "exited" as const,
        exitCode: 0,
        stdout: "not-json",
        stderr: "",
      },
      expected: "invalid-output",
    },
    {
      name: "forbidden web use",
      processResult: {
        kind: "exited" as const,
        exitCode: 0,
        stdout: providerEnvelope({}, 1),
        stderr: "",
      },
      expected: "policy-denied",
    },
  ])("normalizes $name", async ({ processResult, expected }) => {
    const process: ClaudeStructuredProcess = {
      execute: async () => processResult,
    };
    const execution = openClaudeStructuredModelExecutionFromProcess(process);

    await expect(execution.run(request)).resolves.toMatchObject({
      status: expected,
    });
  });
});
