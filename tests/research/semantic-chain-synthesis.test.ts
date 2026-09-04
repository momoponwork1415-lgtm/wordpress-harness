import { describe, expect, it } from "vitest";

import type {
  AttemptPlanV2,
  ModelExecution,
} from "../../src/research/model-execution/index.js";
import { sha256Digest } from "../../src/research/research-record/canonical-json.js";
import { openSemanticChainSynthesis } from "../../src/research/exploration/index.js";

const digest = (character: string): string => `sha256:${character.repeat(64)}`;
const target = {
  id: "plugin-1.0.0",
  pluginSlug: "plugin",
  version: "1.0.0",
  digest: digest("1"),
};
const manifestValue = {
  kind: "target-file-manifest" as const,
  schemaVersion: 1 as const,
  targetSnapshot: { id: target.id, digest: target.digest },
  entries: [
    { path: "producer.php", digest: digest("2"), size: 100 },
    { path: "consumer.php", digest: digest("3"), size: 100 },
  ],
};
const manifestRef = {
  kind: "target-file-manifest" as const,
  schemaVersion: 1 as const,
  targetSnapshotId: target.id,
  targetSnapshotDigest: target.digest,
  digest: sha256Digest(manifestValue),
};
const wave = {
  kind: "work-wave" as const,
  schemaVersion: 2 as const,
  id: digest("4"),
  digest: digest("5"),
  targetSnapshotDigest: target.digest,
  manifestDigest: manifestRef.digest,
};

function fragment(
  idCharacter: string,
  path: string,
  fileDigest: string,
  operation: string,
) {
  const proposal = {
    kind: "route-fragment-proposal" as const,
    schemaVersion: 1 as const,
    attackerPremise: "unauthenticated" as const,
    preconditions: ["The public request reaches the operation."],
    operation,
    consumedValues: [
      {
        identity: "public-input",
        provenance: "attacker-controlled" as const,
      },
    ],
    producedValues: [
      { identity: "shared-capability", capability: "read" as const },
    ],
    stateTransitions: [
      {
        stateIdentity: "shared-state",
        operation: "read" as const,
        effect: operation,
      },
    ],
    evidence: [{ path, fileDigest, startLine: 1, endLine: 2 }],
    unknowns: [
      {
        claim: "The two operations share the same capability.",
        requiredEvidence: "Trace the state identity across both operations.",
      },
    ],
    falsifier: "The state identities are distinct.",
    nextInvestigation: "Compare producer and consumer state identities.",
  };
  const value = {
    kind: "route-fragment" as const,
    schemaVersion: 2 as const,
    id: sha256Digest({
      kind: "route-fragment",
      targetSnapshotDigest: target.digest,
      manifestDigest: manifestRef.digest,
      value: proposal,
    }),
    target,
    manifest: manifestRef,
    workWave: wave,
    attemptId: `finder-${idCharacter}`,
    leaseId: digest(idCharacter === "6" ? "8" : "9"),
    value: proposal,
  };
  return {
    value,
    ref: {
      kind: "route-fragment" as const,
      schemaVersion: 2 as const,
      id: value.id,
      digest: sha256Digest(value),
      attemptId: value.attemptId,
      leaseId: value.leaseId,
      workWaveDigest: wave.digest,
      targetSnapshotDigest: target.digest,
      manifestDigest: manifestRef.digest,
    },
  };
}

const producer = fragment(
  "6",
  "producer.php",
  digest("2"),
  "Persist a system-generated capability in shared state.",
);
const consumer = fragment(
  "7",
  "consumer.php",
  digest("3"),
  "Read the shared capability through a public interface.",
);
const predecessorDecisionDigest = digest("a");
const items = [producer, consumer].map((subject, index) => ({
  kind: "semantic-depth-work-item" as const,
  schemaVersion: 1 as const,
  id: digest(index === 0 ? "b" : "c"),
  predecessorDecisionDigest,
  target,
  manifest: manifestRef,
  wave,
  sourceAction: "schedule-work" as const,
  families: [],
  subjects: [subject.ref],
  directive: {
    kind: "next-work-request" as const,
    sourceId: digest(index === 0 ? "d" : "e"),
    requiredFact: `Resolve cross-feature fact ${index + 1}.`,
    falsifier: "The producer and consumer do not share state.",
    nextAction: "Connect or falsify the producer/consumer transition.",
  },
}));
const batch = {
  kind: "semantic-depth-work-batch" as const,
  schemaVersion: 1 as const,
  id: digest("f"),
  ordinal: 1,
  itemIds: items.map((item) => item.id),
};
const queueValue = {
  kind: "semantic-depth-work-queue" as const,
  schemaVersion: 1 as const,
  predecessorDecisionDigest,
  target,
  manifest: manifestRef,
  wave,
  items,
  batches: [batch],
};
const queueRef = {
  kind: "semantic-depth-work-queue" as const,
  schemaVersion: 1 as const,
  predecessorDecisionDigest,
  targetSnapshotDigest: target.digest,
  manifestDigest: manifestRef.digest,
  digest: sha256Digest(queueValue),
  items: 2,
  batches: 1,
};

function completedResult(
  plan: Extract<AttemptPlanV2, { role: "root-synthesizer" }>,
  output: unknown,
) {
  const planDigest = sha256Digest(plan);
  const value = {
    kind: "model-attempt-result" as const,
    schemaVersion: 2 as const,
    attemptId: plan.attemptId,
    owner: "exploration" as const,
    role: "root-synthesizer" as const,
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
      role: "root-synthesizer" as const,
      planDigest,
      digest: sha256Digest(value),
    },
    value,
  };
}

function synthesis(modelExecution: ModelExecution) {
  return openSemanticChainSynthesis({
    modelExecution,
    promptSet: { id: "depth-synthesis-v1", digest: digest("0") },
    modelProfile: {
      provider: "anthropic" as const,
      model: "claude-opus-5",
      transport: "claude-code-process" as const,
      executableVersion: "2.1.260",
      effort: "high" as const,
      eligibilityReceiptDigest: digest("1"),
    },
    budget: {
      maxWallTimeMs: 3_600_000,
      maxModelTokens: 300_000,
      maxModelTurns: 128,
      maxProviderCostUsd: 10,
      maxOutputBytes: 2 * 1024 * 1024,
    },
  });
}

const input = {
  kind: "synthesize-depth-work" as const,
  schemaVersion: 1 as const,
  queue: { ref: queueRef, value: queueValue },
  batchId: batch.id,
  manifest: { ref: manifestRef, value: manifestValue },
  subjects: [producer, consumer],
};

describe("SemanticChainSynthesis.synthesize", () => {
  it("runs a fresh tool-free Root Synthesis and materializes a Manifest-bound Chain Proposal", async () => {
    let observedPlan: AttemptPlanV2 | undefined;
    const modelExecution: ModelExecution = {
      run: async (plan) => {
        if (plan.schemaVersion !== 2 || plan.role !== "root-synthesizer") {
          throw new Error("Expected Root Synthesis v2");
        }
        observedPlan = plan;
        return completedResult(plan, {
          kind: "root-synthesis-output",
          schemaVersion: 1,
          itemDispositions: items.map((item) => ({
            itemId: item.id,
            disposition: "used",
            reason: "The item contributes a distinct route step.",
          })),
          proposals: [
            {
              itemIds: items.map((item) => item.id),
              subjectDigests: [producer.ref.digest, consumer.ref.digest],
              attackerPremise: "unauthenticated",
              securityProperty: "Target-account authentication integrity.",
              steps: [
                {
                  ordinal: 1,
                  relation: "observed",
                  actor: "target-system",
                  request: "Generate and persist the capability.",
                  stateIdentity: "shared-state",
                  consumedValues: ["public-input"],
                  producedValues: ["shared-capability"],
                  evidence: producer.value.value.evidence,
                },
                {
                  ordinal: 2,
                  relation: "proposed-connection",
                  actor: "unauthenticated-attacker",
                  request: "Read and redeem the shared capability.",
                  stateIdentity: "shared-state",
                  consumedValues: ["shared-capability"],
                  producedValues: ["target-session"],
                  evidence: consumer.value.value.evidence,
                },
              ],
              unknowns: [
                {
                  claim: "The persisted and public values are identical.",
                  requiredEvidence: "Trace the exact state identity.",
                },
              ],
              falsifier: "The values use unrelated state identities.",
              nextAction: "Challenge the proposed connection in fresh source.",
            },
          ],
        });
      },
    };

    const firstSynthesis = synthesis(modelExecution);
    const result = await firstSynthesis.synthesize(input);
    const replay = await firstSynthesis.synthesize(input);

    expect(observedPlan).toMatchObject({
      role: "root-synthesizer",
      target,
      manifest: manifestRef,
      assignment: {
        kind: "depth-synthesis",
        queueDigest: queueRef.digest,
        batchId: batch.id,
        itemIds: batch.itemIds,
      },
    });
    expect(observedPlan).not.toHaveProperty("sourceToolPolicy");
    expect(result).toMatchObject({
      kind: "chain-synthesis",
      schemaVersion: 1,
      target,
      manifest: manifestRef,
      proposals: [
        {
          kind: "chain-proposal",
          schemaVersion: 1,
          subjects: [producer.ref, consumer.ref],
          steps: [
            { ordinal: 1, relation: "observed" },
            { ordinal: 2, relation: "proposed-connection" },
          ],
        },
      ],
    });
    expect(replay).toEqual(result);
  });

  it("returns typed incomplete when the model omits a Depth Work Item", async () => {
    const modelExecution: ModelExecution = {
      run: async (plan) => {
        if (plan.schemaVersion !== 2 || plan.role !== "root-synthesizer") {
          throw new Error("Expected Root Synthesis v2");
        }
        return completedResult(plan, {
          kind: "root-synthesis-output",
          schemaVersion: 1,
          itemDispositions: [
            {
              itemId: items[0]!.id,
              disposition: "retained-no-connection",
              reason: "No connection was proposed.",
            },
          ],
          proposals: [],
        });
      },
    };

    await expect(
      synthesis(modelExecution).synthesize(input),
    ).resolves.toMatchObject({
      kind: "chain-synthesis-incomplete",
      reason: "item-omission",
    });
  });

  it("does not pass a proposal with a source anchor outside the bound Manifest", async () => {
    const modelExecution: ModelExecution = {
      run: async (plan) => {
        if (plan.schemaVersion !== 2 || plan.role !== "root-synthesizer") {
          throw new Error("Expected Root Synthesis v2");
        }
        return completedResult(plan, {
          kind: "root-synthesis-output",
          schemaVersion: 1,
          itemDispositions: items.map((item) => ({
            itemId: item.id,
            disposition: "used",
            reason: "The item contributes a distinct route step.",
          })),
          proposals: [
            {
              itemIds: items.map((item) => item.id),
              subjectDigests: [producer.ref.digest, consumer.ref.digest],
              attackerPremise: "unauthenticated",
              securityProperty: "Target-account authentication integrity.",
              steps: [
                {
                  ordinal: 1,
                  relation: "observed",
                  actor: "target-system",
                  request: "Generate and persist the capability.",
                  stateIdentity: "shared-state",
                  consumedValues: ["public-input"],
                  producedValues: ["shared-capability"],
                  evidence: producer.value.value.evidence,
                },
                {
                  ordinal: 2,
                  relation: "proposed-connection",
                  actor: "unauthenticated-attacker",
                  request: "Read and redeem the shared capability.",
                  stateIdentity: "shared-state",
                  consumedValues: ["shared-capability"],
                  producedValues: ["target-session"],
                  evidence: [
                    {
                      path: "unbound.php",
                      fileDigest: digest("9"),
                      startLine: 1,
                      endLine: 2,
                    },
                  ],
                },
              ],
              unknowns: [
                {
                  claim: "The persisted and public values are identical.",
                  requiredEvidence: "Trace the exact state identity.",
                },
              ],
              falsifier: "The values use unrelated state identities.",
              nextAction: "Challenge the proposed connection in fresh source.",
            },
          ],
        });
      },
    };

    await expect(
      synthesis(modelExecution).synthesize(input),
    ).resolves.toMatchObject({
      kind: "chain-synthesis-incomplete",
      reason: "foreign-source-anchor",
    });
  });
});
