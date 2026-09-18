import { rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { z } from "zod";

import {
  canonicalDigest,
  canonicalJson,
} from "../../infrastructure/canonical-json.js";
import { PrivateArtifactStore } from "../../infrastructure/private-artifact-store.js";
import {
  candidateVerificationRecipeSchema,
  researchCandidateSchema,
  researchReportSchema,
  type ResearchReport,
  type SealedNativeRun,
} from "./contracts.js";

const MAX_CANDIDATE_RECIPE_BYTES = 256 * 1024;

const providerCandidateSchema = researchCandidateSchema
  .omit({ reproductionRecipe: true })
  .extend({
    reproductionRecipe: z
      .strictObject({
        kind: z.literal("candidate-verification-recipe"),
        schemaVersion: z.literal(1),
        recipeId: z
          .string()
          .min(1)
          .max(128)
          .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/),
        candidateId: z
          .string()
          .min(1)
          .max(128)
          .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/),
        targetSnapshotDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
        script: z
          .string()
          .min(1)
          .max(128 * 1024),
        timeoutMs: z
          .number()
          .int()
          .positive()
          .max(5 * 60_000),
      })
      .optional(),
  });

export const providerResearchReportSchema = researchReportSchema.extend({
  candidates: z.array(providerCandidateSchema),
});

async function putRecipe(
  directory: string,
  recipe: z.infer<typeof candidateVerificationRecipeSchema>,
): Promise<number> {
  const artifacts = new PrivateArtifactStore({
    rootDirectory: directory,
    maxEntries: 1,
    maxBytes: MAX_CANDIDATE_RECIPE_BYTES,
  });
  const encoded = Buffer.from(canonicalJson(recipe), "utf8");
  const staging = await artifacts.stage();
  try {
    await writeFile(join(staging.contentDirectory, "recipe.json"), encoded, {
      flag: "wx",
      mode: 0o600,
    });
    const committed = await artifacts.commit(
      recipe.digest.slice("sha256:".length),
      staging,
    );
    if (committed.status === "conflict") {
      throw new Error("Candidate Recipe artifact conflict");
    }
  } catch (error: unknown) {
    await rm(staging.rootDirectory, { recursive: true, force: true }).catch(
      () => undefined,
    );
    throw error;
  }
  return encoded.byteLength;
}

export async function materializeResearchReport(
  value: unknown,
  run: SealedNativeRun,
  candidateRecipeDirectory: string,
): Promise<ResearchReport> {
  const providerReport = providerResearchReportSchema.parse(value);
  const candidates = await Promise.all(
    providerReport.candidates.map(async (candidate) => {
      const { reproductionRecipe: body, ...claim } = candidate;
      if (body === undefined) return claim;
      if (
        body.candidateId !== candidate.candidateId ||
        body.targetSnapshotDigest !== run.targetSnapshot.digest
      ) {
        throw new Error(
          "Candidate Recipe does not match its Candidate binding",
        );
      }
      const recipe = candidateVerificationRecipeSchema.parse({
        ...body,
        digest: canonicalDigest(body),
      });
      const bytes = await putRecipe(candidateRecipeDirectory, recipe);
      return {
        ...claim,
        reproductionRecipe: {
          kind: "candidate-verification-recipe-ref" as const,
          schemaVersion: 1 as const,
          recipeId: recipe.recipeId,
          digest: recipe.digest,
          bytes,
        },
      };
    }),
  );
  return researchReportSchema.parse({ ...providerReport, candidates });
}
