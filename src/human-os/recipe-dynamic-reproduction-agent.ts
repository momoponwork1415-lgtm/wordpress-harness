import { z } from "zod";

import { canonicalDigest } from "../infrastructure/canonical-json.js";
import type { SourceValidatedFinding } from "../research/index.js";
import { externalDependencyEvidenceRequestSchema } from "./contracts-v3.js";
import type {
  DynamicReproductionAgent,
  DynamicReproductionAgentOutcome,
} from "./gvisor-wordpress-dynamic-reproduction.js";

const digestSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const recipeBodySchema = z.strictObject({
  kind: z.literal("dynamic-reproduction-recipe"),
  schemaVersion: z.literal(1),
  recipeId: z.string().min(1).max(512),
  findingId: z.string().min(1).max(512),
  targetSnapshotDigest: digestSchema,
  script: z
    .string()
    .min(1)
    .max(128 * 1024),
  timeoutMs: z
    .number()
    .int()
    .min(1)
    .max(5 * 60_000),
});

export const dynamicReproductionRecipeSchema = recipeBodySchema
  .extend({ digest: digestSchema })
  .superRefine((recipe, context) => {
    const { digest, ...body } = recipe;
    if (digest !== canonicalDigest(body)) {
      context.addIssue({
        code: "custom",
        path: ["digest"],
        message: "Dynamic Reproduction Recipe digest must bind its exact body",
      });
    }
  });

export const dynamicReproductionRecipeResolutionSchema = z.discriminatedUnion(
  "kind",
  [
    z.strictObject({
      kind: z.literal("recipe-ready"),
      recipe: dynamicReproductionRecipeSchema,
    }),
    z.strictObject({
      kind: z.literal("setup-required"),
      summary: z.string().min(1).max(4_000),
      evidenceRequest: externalDependencyEvidenceRequestSchema,
    }),
  ],
);

const experimentResultSchema = z.strictObject({
  summary: z.string().min(1).max(4_000),
  preconditionsMatched: z.boolean(),
  recipeCompleted: z.boolean(),
  effectObserved: z.boolean(),
});
const experimentResultPrefix = "HARNESS_RESULT=";

export type DynamicReproductionRecipe = z.infer<
  typeof dynamicReproductionRecipeSchema
>;
export type DynamicReproductionRecipeResolution = z.infer<
  typeof dynamicReproductionRecipeResolutionSchema
>;

export interface DynamicReproductionRecipeResolver {
  resolve(input: {
    readonly finding: SourceValidatedFinding;
  }): Promise<DynamicReproductionRecipeResolution>;
}

export interface RecipeDynamicReproductionAgentOptions {
  readonly recipeResolver: DynamicReproductionRecipeResolver;
}

function incomplete(
  summary: string,
  values?: {
    readonly preconditionsMatched: boolean;
    readonly recipeCompleted: boolean;
    readonly effectObserved: boolean | null;
  },
): DynamicReproductionAgentOutcome {
  return {
    status: "incomplete",
    summary,
    preconditionsMatched: values?.preconditionsMatched ?? false,
    recipeCompleted: values?.recipeCompleted ?? false,
    effectObserved: values?.effectObserved ?? null,
  };
}

function decodeExperimentResult(stdout: string) {
  const terminalLine = stdout.trimEnd().split(/\r?\n/u).at(-1);
  if (terminalLine?.startsWith(experimentResultPrefix) !== true) {
    return undefined;
  }
  try {
    const decoded = experimentResultSchema.safeParse(
      JSON.parse(terminalLine.slice(experimentResultPrefix.length)) as unknown,
    );
    return decoded.success ? decoded.data : undefined;
  } catch {
    return undefined;
  }
}

class RecipeDynamicReproductionAgent implements DynamicReproductionAgent {
  readonly #recipeResolver: DynamicReproductionRecipeResolver;

  constructor(options: RecipeDynamicReproductionAgentOptions) {
    this.#recipeResolver = options.recipeResolver;
  }

  async execute(input: Parameters<DynamicReproductionAgent["execute"]>[0]) {
    let resolution: DynamicReproductionRecipeResolution;
    try {
      resolution = dynamicReproductionRecipeResolutionSchema.parse(
        await this.#recipeResolver.resolve({ finding: input.finding }),
      );
    } catch {
      return incomplete(
        "No valid Finding-bound reproduction recipe is available.",
      );
    }
    if (resolution.kind === "setup-required") {
      return {
        status: "incomplete" as const,
        summary: resolution.summary,
        preconditionsMatched: false,
        recipeCompleted: false,
        effectObserved: null,
        evidenceRequest: resolution.evidenceRequest,
      };
    }
    const { recipe } = resolution;
    if (
      recipe.findingId !== input.finding.findingId ||
      recipe.targetSnapshotDigest !== input.finding.targetSnapshot.digest
    ) {
      return incomplete("The reproduction recipe does not match the Finding.");
    }
    const observation = await input.experiment.run({
      script: recipe.script,
      timeoutMs: recipe.timeoutMs,
    });
    if (observation.exitCode !== 0) {
      return incomplete("The runtime attack did not complete.");
    }
    const result = decodeExperimentResult(observation.stdout);
    if (result === undefined) {
      return incomplete(
        "The runtime attack returned no valid effect observation.",
      );
    }
    if (
      result.preconditionsMatched &&
      result.recipeCompleted &&
      result.effectObserved
    ) {
      return {
        status: "runtime-confirmed" as const,
        summary: result.summary,
        preconditionsMatched: true as const,
        recipeCompleted: true as const,
        effectObserved: true as const,
      };
    }
    return incomplete(result.summary, result);
  }
}

export function openRecipeDynamicReproductionAgent(
  options: RecipeDynamicReproductionAgentOptions,
): DynamicReproductionAgent {
  return new RecipeDynamicReproductionAgent(options);
}
