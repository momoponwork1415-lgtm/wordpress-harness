import { describe, expect, it, vi } from "vitest";

import {
  dynamicReproductionRecipeSchema,
  openRecipeDynamicReproductionAgent,
  type DynamicReproductionExperiment,
} from "../../src/human-os/index.js";
import { canonicalDigest } from "../../src/infrastructure/canonical-json.js";
import type { SourceValidatedFinding } from "../../src/research/index.js";

const digest = (character: string): string => `sha256:${character.repeat(64)}`;

const finding: SourceValidatedFinding = {
  kind: "source-validated-finding",
  schemaVersion: 1,
  findingId: "campaign-recipe:finding:candidate-1",
  candidateId: "candidate-1",
  targetSnapshot: {
    id: "example-1.0.0",
    pluginSlug: "example",
    version: "1.0.0",
    digest: digest("a"),
    sourceTree: { digest: digest("9"), entries: 1, bytes: 6 },
  },
  attackerPremise: "An unauthenticated visitor controls a public value.",
  brokenSecurityProperty: "The public value must remain inert.",
  claim: "The public value reaches an executable browser context.",
  assurance: "source-validated",
  validation: {
    runId: "campaign-recipe:validation:1",
    promptSet: { id: "validation-v1", digest: digest("b") },
    runtimeProfileDigest: digest("c"),
    permissionProfileDigest: digest("d"),
  },
  evidence: [
    {
      path: "example.php",
      location: "save:44",
      observation: "Stores the visitor-controlled value.",
    },
  ],
};

function recipe(overrides: Record<string, unknown> = {}) {
  const body = {
    kind: "dynamic-reproduction-recipe" as const,
    schemaVersion: 1 as const,
    recipeId: "recipe-1",
    findingId: finding.findingId,
    targetSnapshotDigest: finding.targetSnapshot.digest,
    script: 'console.log("attack")',
    timeoutMs: 30_000,
    ...overrides,
  };
  return dynamicReproductionRecipeSchema.parse({
    ...body,
    digest: canonicalDigest(body),
  });
}

describe("Recipe Dynamic Reproduction Agent", () => {
  it("runs one Finding-bound recipe and promotes only an observed effect", async () => {
    const run = vi.fn(async () => ({
      exitCode: 0,
      stdout:
        'diagnostic\nHARNESS_RESULT={"summary":"The attack effect was observed.","preconditionsMatched":true,"recipeCompleted":true,"effectObserved":true}\n',
      stderr: "",
    }));
    const experiment: DynamicReproductionExperiment = {
      environmentId: "environment-1",
      run,
    };
    const agent = openRecipeDynamicReproductionAgent({
      recipeResolver: {
        resolve: async () => ({ kind: "recipe-ready", recipe: recipe() }),
      },
    });

    await expect(
      agent.execute({ finding, sourceDirectory: "/unused", experiment }),
    ).resolves.toEqual({
      status: "runtime-confirmed",
      summary: "The attack effect was observed.",
      preconditionsMatched: true,
      recipeCompleted: true,
      effectObserved: true,
    });
    expect(run).toHaveBeenCalledOnce();
    expect(run).toHaveBeenCalledWith({
      script: 'console.log("attack")',
      timeoutMs: 30_000,
    });
  });

  it("keeps a completed attempt without an observed effect incomplete", async () => {
    const experiment: DynamicReproductionExperiment = {
      environmentId: "environment-2",
      run: async () => ({
        exitCode: 0,
        stdout:
          'HARNESS_RESULT={"summary":"The effect was not observed.","preconditionsMatched":true,"recipeCompleted":true,"effectObserved":false}\n',
        stderr: "",
      }),
    };
    const agent = openRecipeDynamicReproductionAgent({
      recipeResolver: {
        resolve: async () => ({ kind: "recipe-ready", recipe: recipe() }),
      },
    });

    await expect(
      agent.execute({ finding, sourceDirectory: "/unused", experiment }),
    ).resolves.toEqual({
      status: "incomplete",
      summary: "The effect was not observed.",
      preconditionsMatched: true,
      recipeCompleted: true,
      effectObserved: false,
    });
  });

  it("does not execute a recipe bound to another Finding snapshot", async () => {
    const run = vi.fn();
    const experiment: DynamicReproductionExperiment = {
      environmentId: "environment-3",
      run,
    };
    const agent = openRecipeDynamicReproductionAgent({
      recipeResolver: {
        resolve: async () => ({
          kind: "recipe-ready",
          recipe: recipe({ targetSnapshotDigest: digest("f") }),
        }),
      },
    });

    await expect(
      agent.execute({ finding, sourceDirectory: "/unused", experiment }),
    ).resolves.toMatchObject({
      status: "incomplete",
      summary: "The reproduction recipe does not match the Finding.",
    });
    expect(run).not.toHaveBeenCalled();
  });

  it("preserves a human setup request instead of executing", async () => {
    const run = vi.fn();
    const experiment: DynamicReproductionExperiment = {
      environmentId: "environment-4",
      run,
    };
    const evidenceRequest = {
      kind: "external-dependency-evidence-request" as const,
      schemaVersion: 1 as const,
      reason: "external-dependency-required" as const,
      service: "PayPal Sandbox",
      humanAction: "Create a disposable sandbox merchant.",
      minimumAccess: "One sandbox-only API credential.",
      verificationGoal:
        "Observe the authorized callback in the disposable lab.",
    };
    const agent = openRecipeDynamicReproductionAgent({
      recipeResolver: {
        resolve: async () => ({
          kind: "setup-required",
          summary: "A sandbox identity is required.",
          evidenceRequest,
        }),
      },
    });

    await expect(
      agent.execute({ finding, sourceDirectory: "/unused", experiment }),
    ).resolves.toMatchObject({
      status: "incomplete",
      evidenceRequest,
    });
    expect(run).not.toHaveBeenCalled();
  });
});
