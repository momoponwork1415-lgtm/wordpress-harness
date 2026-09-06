import { describe, expect, it } from "vitest";

import { modelAttemptUsageV2Schema } from "../../src/research/model-attempt-usage-contracts.js";
import { rollUpModelAttemptUsage } from "../../src/research/model-attempt-usage.js";

function usage(
  overrides: {
    readonly measurement?: "reported" | "partial";
    readonly estimatedCostUsd?: number;
    readonly wallTimeMs?: number;
    readonly modelTurns?: number;
    readonly structuredOutputBytes?: number;
    readonly tokens?: {
      readonly input: number;
      readonly cacheCreation: number;
      readonly cacheRead: number;
      readonly output: number;
    };
    readonly source?: {
      readonly queries: number;
      readonly scanBytes: number;
      readonly responseBytes: number;
    };
  } = {},
) {
  const tokens = overrides.tokens ?? {
    input: 10,
    cacheCreation: 20,
    cacheRead: 30,
    output: 40,
  };
  const modelTokens = {
    ...tokens,
    total:
      tokens.input + tokens.cacheCreation + tokens.cacheRead + tokens.output,
  };
  return modelAttemptUsageV2Schema.parse({
    kind: "model-attempt-usage",
    schemaVersion: 1,
    measurement: overrides.measurement ?? "reported",
    ...(overrides.estimatedCostUsd === undefined
      ? {}
      : { estimatedCostUsd: overrides.estimatedCostUsd }),
    wallTimeMs: overrides.wallTimeMs ?? 1_000,
    modelTurns: overrides.modelTurns ?? 2,
    modelTokens,
    structuredOutputBytes: overrides.structuredOutputBytes ?? 128,
    source: overrides.source ?? { queries: 1, scanBytes: 2, responseBytes: 3 },
    models: [{ id: "m", canonicalModel: "m", tokens: modelTokens }],
  });
}

describe("Model Attempt usage roll-up", () => {
  it("sums every dimension across the attempts", () => {
    const rolled = rollUpModelAttemptUsage([
      usage({
        wallTimeMs: 1_000,
        modelTurns: 2,
        structuredOutputBytes: 100,
        estimatedCostUsd: 1.5,
        tokens: { input: 1, cacheCreation: 2, cacheRead: 3, output: 4 },
        source: { queries: 1, scanBytes: 10, responseBytes: 100 },
      }),
      usage({
        wallTimeMs: 2_000,
        modelTurns: 3,
        structuredOutputBytes: 200,
        estimatedCostUsd: 2.25,
        tokens: { input: 10, cacheCreation: 20, cacheRead: 30, output: 40 },
        source: { queries: 2, scanBytes: 20, responseBytes: 200 },
      }),
    ]);

    expect(rolled).toMatchObject({
      attempts: 2,
      reportedAttempts: 2,
      modelWallTimeMs: 3_000,
      modelTurns: 5,
      modelTokens: {
        input: 11,
        cacheCreation: 22,
        cacheRead: 33,
        output: 44,
        total: 110,
      },
      structuredOutputBytes: 300,
      estimatedCostUsd: 3.75,
      source: { queries: 3, scanBytes: 30, responseBytes: 300 },
    });
  });

  it("rolls up nothing to an explicit zero rather than to absent", () => {
    expect(rollUpModelAttemptUsage([])).toEqual({
      attempts: 0,
      reportedAttempts: 0,
      everyAttemptReported: true,
      everyCostReported: true,
      modelWallTimeMs: 0,
      modelTurns: 0,
      modelTokens: {
        input: 0,
        cacheCreation: 0,
        cacheRead: 0,
        output: 0,
        total: 0,
      },
      structuredOutputBytes: 0,
      estimatedCostUsd: 0,
      source: { queries: 0, scanBytes: 0, responseBytes: 0 },
    });
  });

  it("derives the token total from its categories rather than summing it", () => {
    // Every parsed usage satisfies total === input + cacheCreation + cacheRead
    // + output, so summing the totals happens to agree. Deriving makes the
    // invariant structural: the roll-up cannot report a total that its own
    // categories do not add up to, whatever it was handed.
    const rolled = rollUpModelAttemptUsage([
      usage({
        tokens: { input: 1, cacheCreation: 2, cacheRead: 3, output: 4 },
      }),
      usage({
        tokens: { input: 5, cacheCreation: 6, cacheRead: 7, output: 8 },
      }),
    ]);

    const { input, cacheCreation, cacheRead, output, total } =
      rolled.modelTokens;
    expect(total).toBe(input + cacheCreation + cacheRead + output);
  });

  it("counts the attempts that reported, and whether every one did", () => {
    const rolled = rollUpModelAttemptUsage([
      usage({ measurement: "reported" }),
      usage({ measurement: "partial" }),
      usage({ measurement: "reported" }),
    ]);

    expect(rolled.attempts).toBe(3);
    expect(rolled.reportedAttempts).toBe(2);
    expect(rolled.everyAttemptReported).toBe(false);
  });

  it("reports cost coverage separately from measurement coverage", () => {
    // An attempt can report its usage and still not report a cost, so the two
    // are answered separately. A caller that conflated them would call a
    // campaign's cost "reported" on the strength of its token counts.
    const rolled = rollUpModelAttemptUsage([
      usage({ measurement: "reported", estimatedCostUsd: 1 }),
      usage({ measurement: "reported" }),
    ]);

    expect(rolled.everyAttemptReported).toBe(true);
    expect(rolled.everyCostReported).toBe(false);
    expect(rolled.estimatedCostUsd).toBe(1);
  });

  it("accepts any iterable, so callers need not build an array first", () => {
    const usages = new Set([
      usage({ modelTurns: 4 }),
      usage({ modelTurns: 6 }),
    ]);

    expect(rollUpModelAttemptUsage(usages).modelTurns).toBe(10);
  });
});
