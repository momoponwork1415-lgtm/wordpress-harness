import { describe, expect, it } from "vitest";

import { openExploration } from "../../src/research/exploration/index.js";
import type {
  ModelAttemptPlan,
  ModelExecution,
} from "../../src/research/model-execution/index.js";
import { sha256Digest } from "../../src/research/research-record/canonical-json.js";

const target = {
  id: "demo-1.0.0",
  pluginSlug: "demo",
  version: "1.0.0",
  digest: `sha256:${"a".repeat(64)}`,
} as const;

const manifest = {
  kind: "target-file-manifest",
  schemaVersion: 1,
  targetSnapshotId: target.id,
  targetSnapshotDigest: target.digest,
  digest: `sha256:${"b".repeat(64)}`,
} as const;

const plannerOutput = {
  kind: "root-planner-output",
  schemaVersion: 1,
  theses: [
    {
      kind: "research-thesis-proposal",
      schemaVersion: 1,
      scope: "target-specific",
      securityAssumption:
        "cross-request option state preserves actor authority",
      question:
        "Can one actor persist option state that a more privileged flow later trusts?",
      motivation: "The plugin exposes stateful configuration behavior.",
      startingBasis: "Oracle-free plugin identity and version metadata only.",
      startingEvidence: [
        {
          path: "demo.php",
          fileDigest: `sha256:${"f".repeat(64)}`,
          startLine: 1,
          endLine: 10,
        },
      ],
      independence:
        "This studies cross-actor state ownership rather than parser or request boundaries.",
    },
    {
      kind: "research-thesis-proposal",
      schemaVersion: 1,
      scope: "target-specific",
      securityAssumption: "producer and consumer disagree about value encoding",
      question:
        "Can a value cross a decode or render boundary with different security meaning?",
      motivation:
        "WordPress plugins commonly bridge PHP, HTML, and browser contexts.",
      startingBasis: "Oracle-free platform and plugin metadata only.",
      startingEvidence: [
        {
          path: "demo.php",
          fileDigest: `sha256:${"f".repeat(64)}`,
          startLine: 11,
          endLine: 20,
        },
      ],
      independence:
        "This studies representation changes rather than persistent authority.",
    },
    {
      kind: "research-thesis-proposal",
      schemaVersion: 1,
      scope: "target-specific",
      securityAssumption:
        "feature composition bypasses a local authorization invariant",
      question:
        "Can two individually intended features compose into an unauthorized capability?",
      motivation: "Cross-feature semantics are not captured by a single sink.",
      startingBasis: "Oracle-free product boundary only.",
      startingEvidence: [
        {
          path: "demo.php",
          fileDigest: `sha256:${"f".repeat(64)}`,
          startLine: 21,
          endLine: 30,
        },
      ],
      independence:
        "This studies feature composition rather than state ownership or encoding.",
    },
  ],
} as const;

const semanticPolicy = {
  kind: "semantic-root-planning-policy",
  schemaVersion: 1,
  id: "semantic-research-baseline-v1",
  maxTargetSpecificTheses: 3,
  minWildcardTheses: 1,
  maxLeases: 4,
  plannerBudget: {
    maxWallTimeMs: 300_000,
    maxModelTokens: 100_000,
    maxModelTurns: 4,
    maxProviderCostUsd: 2.5,
    maxOutputBytes: 512 * 1_024,
    maxSourceQueries: 32,
  },
  finderLeaseBudget: {
    maxWallTimeMs: 900_000,
    maxModelTokens: 100_000,
    maxModelTurns: 66,
    maxProviderCostUsd: 2.5,
    maxHypotheses: 8,
    maxOutputBytes: 512 * 1_024,
    maxSourceQueries: 64,
  },
} as const;

function completedResult(
  plan: ModelAttemptPlan,
  output: unknown,
  role: "root-planner" | "finder" = "root-planner",
) {
  const planDigest = sha256Digest(plan);
  const value = {
    kind: "model-attempt-result" as const,
    schemaVersion: 2 as const,
    attemptId: plan.attemptId,
    owner: "exploration" as const,
    role,
    planDigest,
    status: "completed" as const,
    output,
  };
  return {
    status: "completed" as const,
    ref: {
      kind: "attempt-execution-result" as const,
      schemaVersion: 2 as const,
      attemptId: plan.attemptId,
      owner: "exploration" as const,
      role,
      planDigest,
      digest: sha256Digest(value),
    },
    value,
  };
}

function semanticExploration(modelExecution: ModelExecution) {
  return openExploration({
    target,
    manifest,
    metadata: {
      kind: "oracle-free-target-metadata",
      schemaVersion: 1,
      pluginIdentity: "wporg:demo",
      mainPluginFile: "demo.php",
      canonicalInstallDirectory: "demo",
    },
    semanticPolicy,
    planner: {
      modelExecution,
      promptSet: {
        id: "semantic-root-planner-v1",
        digest: `sha256:${"c".repeat(64)}`,
      },
      modelProfile: {
        provider: "anthropic",
        model: "claude-opus-5",
        transport: "claude-code-process",
        executableVersion: "2.1.258",
        effort: "high",
        eligibilityReceiptDigest: `sha256:${"d".repeat(64)}`,
      },
      sourceToolPolicy: {
        kind: "source-tool-policy",
        schemaVersion: 1,
        id: "semantic-source-tools-v1",
        digest: `sha256:${"e".repeat(64)}`,
      },
    },
  });
}

describe("Exploration semantic root planning", () => {
  it("creates a Manifest-bound raw-source Wave from a fresh planner without a Surface Map", async () => {
    const observedPlans: unknown[] = [];
    const modelExecution: ModelExecution = {
      run: async (plan) => {
        observedPlans.push(plan);
        return completedResult(plan, plannerOutput);
      },
    };
    const exploration = semanticExploration(modelExecution);

    const decision = await exploration.decide({
      kind: "start-semantic-research",
      schemaVersion: 2,
      target,
      manifest,
    });

    expect(observedPlans).toHaveLength(1);
    expect(observedPlans[0]).toMatchObject({
      kind: "attempt-plan",
      schemaVersion: 2,
      owner: "exploration",
      role: "root-planner",
      target,
      manifest,
      prompt: expect.stringContaining(
        "Current research attacker scope permits only unauthenticated attackers and subscriber-equivalent low-privilege users.",
      ),
      assignment: {
        kind: "initial-research-planning",
        maxTargetSpecificTheses: 3,
        minWildcardTheses: 0,
        maxLeases: 3,
        metadata: {
          pluginIdentity: "wporg:demo",
          mainPluginFile: "demo.php",
        },
      },
      sourceToolPolicy: {
        kind: "source-tool-policy",
        id: "semantic-source-tools-v1",
      },
      budget: {
        maxSourceQueries: 32,
      },
    });
    expect(observedPlans[0]).not.toHaveProperty("map");
    expect(observedPlans[0]).not.toHaveProperty("surfaceMap");

    expect(decision).toMatchObject({
      kind: "run-wave",
      plan: {
        kind: "work-wave-plan",
        schemaVersion: 2,
        purpose: { kind: "raw-source" },
        target,
        manifest,
      },
    });
    if (decision.kind !== "run-wave") return;
    expect(decision.plan).not.toHaveProperty("map");
    expect(decision.plan).not.toHaveProperty("focusAreas");
    expect(decision.plan.theses).toHaveLength(4);
    expect(decision.plan.leases).toHaveLength(4);
    expect(
      decision.plan.theses.filter(
        (thesis: { readonly scope: string }) => thesis.scope === "wildcard",
      ),
    ).toHaveLength(1);
    expect(
      new Set(
        decision.plan.leases.map(
          (lease: { readonly assignment: { readonly thesisId: string } }) =>
            lease.assignment.thesisId,
        ),
      ),
    ).toEqual(new Set(decision.plan.theses.map((thesis) => thesis.id)));
  });

  it("retries semantic duplicate theses once and returns typed incomplete", async () => {
    const duplicateOutput = {
      ...plannerOutput,
      theses: plannerOutput.theses.map((thesis, index) =>
        index === 1
          ? {
              ...thesis,
              securityAssumption:
                "  CROSS-REQUEST OPTION STATE PRESERVES ACTOR AUTHORITY  ",
            }
          : thesis,
      ),
    };
    const attemptIds: string[] = [];
    const modelExecution: ModelExecution = {
      run: async (plan) => {
        attemptIds.push(plan.attemptId);
        return completedResult(plan, duplicateOutput);
      },
    };

    await expect(
      semanticExploration(modelExecution).decide({
        kind: "start-semantic-research",
        schemaVersion: 2,
        target,
        manifest,
      }),
    ).resolves.toMatchObject({
      kind: "planning-incomplete",
      reason: "duplicate-research-thesis",
      attempts: [{ role: "root-planner" }, { role: "root-planner" }],
    });
    expect(attemptIds).toHaveLength(2);
    expect(new Set(attemptIds).size).toBe(2);
  });

  it("rejects a target-specific Recon packet without source evidence", async () => {
    const first = plannerOutput.theses[0];
    const { startingEvidence: _startingEvidence, ...sourceBlind } = first;
    const modelExecution: ModelExecution = {
      run: async (plan) =>
        completedResult(plan, {
          kind: "root-planner-output",
          schemaVersion: 1,
          theses: [sourceBlind],
        }),
    };

    await expect(
      semanticExploration(modelExecution).decide({
        kind: "start-semantic-research",
        schemaVersion: 2,
        target,
        manifest,
      }),
    ).resolves.toMatchObject({
      kind: "planning-incomplete",
      reason: "invalid-root-planner-output",
      attempts: [{ role: "root-planner" }, { role: "root-planner" }],
    });
  });

  it("rejects a Finder result mixed into Root Planner completion", async () => {
    const modelExecution: ModelExecution = {
      run: async (plan) => completedResult(plan, plannerOutput, "finder"),
    };

    await expect(
      semanticExploration(modelExecution).decide({
        kind: "start-semantic-research",
        schemaVersion: 2,
        target,
        manifest,
      }),
    ).resolves.toMatchObject({
      kind: "planning-incomplete",
      reason: "root-planner-result-mismatch",
    });
  });
});
