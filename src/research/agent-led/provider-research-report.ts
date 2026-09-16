import { chmod, lstat, mkdir, readFile, writeFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";

import { z } from "zod";

import {
  canonicalDigest,
  canonicalJson,
} from "../../infrastructure/canonical-json.js";
import {
  candidateVerificationRecipeSchema,
  researchCandidateSchema,
  researchReportSchema,
  type ResearchReport,
  type SealedNativeRun,
} from "./contracts.js";

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
  if (!isAbsolute(directory) || directory.includes("\0")) {
    throw new Error("Candidate Recipe directory must be absolute");
  }
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const directoryStat = await lstat(directory);
  if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) {
    throw new Error("Candidate Recipe directory is unsafe");
  }
  await chmod(directory, 0o700);
  const encoded = Buffer.from(canonicalJson(recipe), "utf8");
  const path = join(directory, `${recipe.digest.slice("sha256:".length)}.json`);
  try {
    await writeFile(path, encoded, { flag: "wx", mode: 0o600 });
  } catch (error: unknown) {
    if (
      !(error instanceof Error) ||
      !("code" in error) ||
      error.code !== "EEXIST"
    ) {
      throw error;
    }
    const existing = await readFile(path);
    if (!existing.equals(encoded)) {
      throw new Error("Candidate Recipe CAS conflict");
    }
  }
  const fileStat = await lstat(path);
  if (!fileStat.isFile() || fileStat.isSymbolicLink() || fileStat.nlink !== 1) {
    throw new Error("Candidate Recipe artifact is unsafe");
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
