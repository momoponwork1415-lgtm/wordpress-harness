import { describe, expect, it } from "vitest";

import {
  decodeClaudeSubscriptionCapacity,
  evaluateModelCapacity,
  initialOpusSubscriptionCapacityPolicy,
  modelProviderCapacitySnapshotSchema,
} from "../../src/research/model-execution/index.js";

const snapshot = modelProviderCapacitySnapshotSchema.parse({
  kind: "model-provider-capacity-snapshot",
  schemaVersion: 1,
  provider: "anthropic",
  transport: "claude-code-process",
  observedAt: "2026-09-06T12:30:00.000Z",
  windows: {
    fiveHour: {
      usedPercent: 81,
      resetsAt: "2026-09-06T14:50:00.000Z",
    },
    sevenDay: {
      usedPercent: 40,
      resetsAt: "2026-09-09T15:00:00.000Z",
    },
  },
});

describe("Model Capacity Policy", () => {
  it("decodes only zero-inference five-hour and seven-day usage", () => {
    const result = [
      "You are currently using your subscription to power your Claude Code usage",
      "",
      "Current session: 37% used · resets Sep 6, 2:50pm (UTC)",
      "Current week (all models): 25% used · resets Sep 9, 3pm (UTC)",
      "Current week (Fable): 0% used",
      "",
      "Local diagnostics that must not become capacity telemetry",
    ].join("\n");
    const rawEnvelope = {
      type: "result",
      subtype: "success",
      is_error: false,
      duration_api_ms: 0,
      num_turns: 0,
      total_cost_usd: 0,
      result,
    };
    const envelope = JSON.stringify(rawEnvelope);

    expect(
      decodeClaudeSubscriptionCapacity(
        envelope,
        new Date("2026-09-06T12:30:00.000Z"),
      ),
    ).toEqual({
      kind: "model-provider-capacity-snapshot",
      schemaVersion: 1,
      provider: "anthropic",
      transport: "claude-code-process",
      observedAt: "2026-09-06T12:30:00.000Z",
      windows: {
        fiveHour: {
          usedPercent: 37,
          resetsAt: "2026-09-06T14:50:00.000Z",
        },
        sevenDay: {
          usedPercent: 25,
          resetsAt: "2026-09-09T15:00:00.000Z",
        },
      },
    });
    expect(
      decodeClaudeSubscriptionCapacity(
        JSON.stringify({
          ...rawEnvelope,
          num_turns: 1,
          total_cost_usd: 0.01,
        }),
        new Date("2026-09-06T12:30:00.000Z"),
      ),
    ).toBeUndefined();
  });

  it("reserves observed subscription capacity for completion work", () => {
    expect(
      evaluateModelCapacity(
        initialOpusSubscriptionCapacityPolicy,
        "finder",
        snapshot,
      ),
    ).toEqual({
      status: "deferred",
      priority: "new-research",
      exceededWindows: ["five-hour"],
      retryAt: "2026-09-06T14:50:00.000Z",
    });

    expect(
      evaluateModelCapacity(
        initialOpusSubscriptionCapacityPolicy,
        "root-evaluator",
        snapshot,
      ),
    ).toEqual({
      status: "admitted",
      priority: "completion",
    });
  });

  it("requires both observed windows and never derives a dollar budget", () => {
    const bothExceeded = modelProviderCapacitySnapshotSchema.parse({
      ...snapshot,
      windows: {
        fiveHour: snapshot.windows.fiveHour,
        sevenDay: {
          usedPercent: 82,
          resetsAt: "2026-09-09T15:00:00.000Z",
        },
      },
    });

    expect(
      evaluateModelCapacity(
        initialOpusSubscriptionCapacityPolicy,
        "root-planner",
        bothExceeded,
      ),
    ).toEqual({
      status: "deferred",
      priority: "new-research",
      exceededWindows: ["five-hour", "seven-day"],
      retryAt: "2026-09-09T15:00:00.000Z",
    });
    expect(bothExceeded).not.toHaveProperty("estimatedCostUsd");
  });
});
