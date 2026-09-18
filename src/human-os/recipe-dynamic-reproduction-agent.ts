import { z } from "zod";

import {
  candidateVerificationRecipeSchema,
  type CandidateVerificationRecipe,
  type CandidateVerificationRequest,
} from "../research/index.js";
import { PrivateArtifactStore } from "../research/agent-led/private-artifact-store.js";
import { externalDependencyEvidenceRequestSchema } from "./contracts-v3.js";
import type {
  DynamicReproductionAgent,
  DynamicReproductionAgentOutcome,
} from "./gvisor-wordpress-dynamic-reproduction.js";

export const dynamicReproductionRecipeSchema =
  candidateVerificationRecipeSchema;

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

export type DynamicReproductionRecipe = CandidateVerificationRecipe;
export type DynamicReproductionRecipeResolution = z.infer<
  typeof dynamicReproductionRecipeResolutionSchema
>;

export interface DynamicReproductionRecipeResolver {
  resolve(input: {
    readonly request: CandidateVerificationRequest;
  }): Promise<DynamicReproductionRecipeResolution>;
}

export interface RecipeDynamicReproductionAgentOptions {
  readonly recipeResolver: DynamicReproductionRecipeResolver;
}

export interface FileCandidateVerificationRecipeResolverOptions {
  readonly candidateRecipeDirectory: string;
}

class FileCandidateVerificationRecipeResolver implements DynamicReproductionRecipeResolver {
  readonly #artifacts: PrivateArtifactStore;

  constructor(options: FileCandidateVerificationRecipeResolverOptions) {
    this.#artifacts = new PrivateArtifactStore({
      rootDirectory: options.candidateRecipeDirectory,
      maxEntries: 1,
      maxBytes: 256 * 1024,
    });
  }

  async resolve(input: {
    readonly request: CandidateVerificationRequest;
  }): Promise<DynamicReproductionRecipeResolution> {
    const reference = input.request.candidate.reproductionRecipe;
    const artifact = await this.#artifacts.readFile(
      reference.digest.slice("sha256:".length),
      "recipe.json",
      reference.bytes,
    );
    if (
      artifact.status !== "resolved" ||
      artifact.bytes.byteLength !== reference.bytes
    ) {
      throw new Error("Candidate Recipe artifact is unsafe or unbound");
    }
    const recipe = candidateVerificationRecipeSchema.parse(
      JSON.parse(artifact.bytes.toString("utf8")) as unknown,
    );
    if (
      recipe.digest !== reference.digest ||
      recipe.recipeId !== reference.recipeId ||
      recipe.candidateId !== input.request.candidate.candidateId ||
      recipe.targetSnapshotDigest !== input.request.targetSnapshot.digest
    ) {
      throw new Error("Candidate Recipe artifact does not match the Request");
    }
    return { kind: "recipe-ready", recipe };
  }
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
        await this.#recipeResolver.resolve({ request: input.request }),
      );
    } catch {
      return incomplete(
        "No valid Candidate-bound reproduction recipe is available.",
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
      recipe.candidateId !== input.request.candidate.candidateId ||
      recipe.recipeId !== input.request.candidate.reproductionRecipe.recipeId ||
      recipe.digest !== input.request.candidate.reproductionRecipe.digest ||
      recipe.targetSnapshotDigest !== input.request.targetSnapshot.digest
    ) {
      return incomplete(
        "The reproduction recipe does not match the Candidate.",
      );
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
    if (
      result.preconditionsMatched &&
      result.recipeCompleted &&
      !result.effectObserved
    ) {
      return {
        status: "contradicted" as const,
        summary: result.summary,
        preconditionsMatched: true as const,
        recipeCompleted: true as const,
        effectObserved: false as const,
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

export function openFileCandidateVerificationRecipeResolver(
  options: FileCandidateVerificationRecipeResolverOptions,
): DynamicReproductionRecipeResolver {
  return new FileCandidateVerificationRecipeResolver(options);
}
