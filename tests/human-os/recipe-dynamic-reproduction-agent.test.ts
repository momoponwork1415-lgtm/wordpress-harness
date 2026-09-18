import { describe, expect, it, vi } from "vitest";

import { canonicalDigest } from "../../src/infrastructure/canonical-json.js";
import {
  openRecipeDynamicReproductionAgent,
  type DynamicReproductionRecipe,
} from "../../src/human-os/index.js";
import { candidateVerificationRequestSchema } from "../../src/research/index.js";

const recipeBody = {
  kind: "candidate-verification-recipe" as const,
  schemaVersion: 1 as const,
  recipeId: "recipe-1",
  candidateId: "candidate-1",
  targetSnapshotDigest:
    "sha256:1111111111111111111111111111111111111111111111111111111111111111",
  script: "printf test",
  timeoutMs: 10_000,
};
const recipe: DynamicReproductionRecipe = {
  ...recipeBody,
  digest: canonicalDigest(recipeBody),
};
const requestBody = {
  kind: "candidate-verification-request" as const,
  schemaVersion: 2 as const,
  requestId: "campaign:verification:candidate-1",
  campaignId: "campaign",
  campaignInputDigest:
    "sha256:2222222222222222222222222222222222222222222222222222222222222222",
  candidateReviewDigest:
    "sha256:3333333333333333333333333333333333333333333333333333333333333333",
  targetSnapshot: {
    id: "target",
    pluginSlug: "example-plugin",
    version: "1.0.0",
    digest: recipe.targetSnapshotDigest,
    sourceTree: {
      digest:
        "sha256:4444444444444444444444444444444444444444444444444444444444444444",
      entries: 1,
      bytes: 10,
    },
  },
  candidate: {
    candidateId: recipe.candidateId,
    attackerPremise: "Unauthenticated visitor",
    brokenSecurityProperty: "Only administrators may mutate settings",
    claim: "A public action changes settings",
    evidence: [{ path: "plugin.php", location: "10", observation: "No gate" }],
    sourceTrace: [
      {
        role: "entrypoint" as const,
        path: "plugin.php",
        location: "10",
        observation: "The public action accepts attacker-controlled settings.",
      },
      {
        role: "effect" as const,
        path: "plugin.php",
        location: "10",
        observation: "The action mutates protected settings.",
      },
    ],
    controlAssessments: [
      {
        control: "Administrator capability check",
        evidence: [
          {
            path: "plugin.php",
            location: "10",
            observation: "No gate is present.",
          },
        ],
        conclusion:
          "No source-visible control prevents the public settings mutation.",
      },
    ],
    unresolvedFacts: [],
    reproductionRecipe: {
      kind: "candidate-verification-recipe-ref" as const,
      schemaVersion: 1 as const,
      recipeId: recipe.recipeId,
      digest: recipe.digest,
      bytes: 128,
    },
  },
};
const request = candidateVerificationRequestSchema.parse({
  ...requestBody,
  digest: canonicalDigest(requestBody),
});

describe("Recipe Dynamic Reproduction Agent", () => {
  it("promotes only a fully matched and observed Candidate recipe", async () => {
    const run = vi.fn().mockResolvedValue({
      exitCode: 0,
      stdout:
        'HARNESS_RESULT={"summary":"effect observed","preconditionsMatched":true,"recipeCompleted":true,"effectObserved":true}\n',
      stderr: "",
    });
    const agent = openRecipeDynamicReproductionAgent({
      recipeResolver: {
        resolve: async () => ({ kind: "recipe-ready", recipe }),
      },
    });
    await expect(
      agent.execute({
        request,
        sourceDirectory: "/source",
        experiment: { environmentId: "lab-1", run },
      }),
    ).resolves.toMatchObject({ status: "runtime-confirmed" });
    expect(run).toHaveBeenCalledWith({
      script: recipe.script,
      timeoutMs: 10_000,
    });
  });

  it("records a fully executed negative observation as contradicted", async () => {
    const agent = openRecipeDynamicReproductionAgent({
      recipeResolver: {
        resolve: async () => ({ kind: "recipe-ready", recipe }),
      },
    });
    await expect(
      agent.execute({
        request,
        sourceDirectory: "/source",
        experiment: {
          environmentId: "lab-2",
          run: async () => ({
            exitCode: 0,
            stdout:
              'HARNESS_RESULT={"summary":"effect absent","preconditionsMatched":true,"recipeCompleted":true,"effectObserved":false}\n',
            stderr: "",
          }),
        },
      }),
    ).resolves.toMatchObject({ status: "contradicted" });
  });

  it("does not execute a recipe bound to another Candidate", async () => {
    const run = vi.fn();
    const otherBody = { ...recipeBody, candidateId: "candidate-2" };
    const agent = openRecipeDynamicReproductionAgent({
      recipeResolver: {
        resolve: async () => ({
          kind: "recipe-ready",
          recipe: { ...otherBody, digest: canonicalDigest(otherBody) },
        }),
      },
    });
    await expect(
      agent.execute({
        request,
        sourceDirectory: "/source",
        experiment: { environmentId: "lab-3", run },
      }),
    ).resolves.toMatchObject({ status: "incomplete" });
    expect(run).not.toHaveBeenCalled();
  });
});
