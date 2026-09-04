import { z } from "zod";

const modelTokenUsageSchema = z
  .strictObject({
    input: z.number().int().nonnegative(),
    cacheCreation: z.number().int().nonnegative(),
    cacheRead: z.number().int().nonnegative(),
    output: z.number().int().nonnegative(),
    total: z.number().int().nonnegative(),
  })
  .superRefine((usage, context) => {
    if (
      usage.total !==
      usage.input + usage.cacheCreation + usage.cacheRead + usage.output
    ) {
      context.addIssue({
        code: "custom",
        path: ["total"],
        message: "Model token total does not match its categories",
      });
    }
  });

export const modelAttemptUsageV2Schema = z
  .strictObject({
    kind: z.literal("model-attempt-usage"),
    schemaVersion: z.literal(1),
    measurement: z.enum(["reported", "partial"]),
    estimatedCostUsd: z.number().finite().nonnegative().optional(),
    wallTimeMs: z.number().int().nonnegative(),
    providerDurationMs: z.number().int().nonnegative().optional(),
    modelTurns: z.number().int().nonnegative(),
    modelTokens: modelTokenUsageSchema,
    structuredOutputBytes: z.number().int().nonnegative(),
    source: z.strictObject({
      queries: z.number().int().nonnegative(),
      scanBytes: z.number().int().nonnegative(),
      responseBytes: z.number().int().nonnegative(),
    }),
    models: z.array(
      z.strictObject({
        id: z.string().min(1).max(256),
        canonicalModel: z.string().min(1).max(256),
        tokens: modelTokenUsageSchema,
      }),
    ),
  })
  .superRefine((usage, context) => {
    const total = usage.models.reduce(
      (sum, model) => ({
        input: sum.input + model.tokens.input,
        cacheCreation: sum.cacheCreation + model.tokens.cacheCreation,
        cacheRead: sum.cacheRead + model.tokens.cacheRead,
        output: sum.output + model.tokens.output,
        total: sum.total + model.tokens.total,
      }),
      { input: 0, cacheCreation: 0, cacheRead: 0, output: 0, total: 0 },
    );
    for (const key of [
      "input",
      "cacheCreation",
      "cacheRead",
      "output",
      "total",
    ] as const) {
      if (usage.modelTokens[key] !== total[key]) {
        context.addIssue({
          code: "custom",
          path: ["modelTokens", key],
          message: "Aggregate model tokens do not match per-model usage",
        });
      }
    }
  });

export type ModelAttemptUsageV2 = z.infer<typeof modelAttemptUsageV2Schema>;
