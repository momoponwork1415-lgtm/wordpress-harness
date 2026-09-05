import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  openSemanticAdversarialCritique,
  type ChainSynthesis,
} from "../../src/research/exploration/index.js";
import type {
  AttemptPlanV2,
  ModelExecution,
} from "../../src/research/model-execution/index.js";
import { sha256Digest } from "../../src/research/research-record/canonical-json.js";

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
const subject = (character: string) => ({
  kind: "route-fragment" as const,
  schemaVersion: 2 as const,
  id: digest(character),
  digest: digest(character === "6" ? "8" : "9"),
  attemptId: `finder-${character}`,
  leaseId: digest(character === "6" ? "a" : "b"),
  workWaveDigest: wave.digest,
  targetSnapshotDigest: target.digest,
  manifestDigest: manifestRef.digest,
});
const subjects = [subject("6"), subject("7")];
const queueRef = {
  kind: "semantic-depth-work-queue" as const,
  schemaVersion: 1 as const,
  predecessorDecisionDigest: digest("c"),
  targetSnapshotDigest: target.digest,
  manifestDigest: manifestRef.digest,
  digest: digest("d"),
  items: 2,
  batches: 1,
};
const synthesisAttempt = {
  kind: "attempt-execution-result" as const,
  schemaVersion: 2 as const,
  attemptId: "root-synthesizer:fixture",
  owner: "exploration" as const,
  role: "root-synthesizer" as const,
  planDigest: digest("e"),
  digest: digest("f"),
};
const proposalIdentity = {
  kind: "chain-proposal" as const,
  schemaVersion: 1 as const,
  target,
  manifest: manifestRef,
  queue: queueRef,
  batchId: digest("0"),
  attempt: synthesisAttempt,
  itemIds: [digest("a"), digest("b")],
  subjects,
  attackerPremise: "unauthenticated" as const,
  securityProperty: "Target-account authentication integrity.",
  steps: [
    {
      ordinal: 1,
      relation: "observed" as const,
      actor: "target-system",
      request: "Generate and persist a capability.",
      stateIdentity: "shared-state",
      consumedValues: ["public-input"],
      producedValues: ["shared-capability"],
      evidence: [
        {
          path: "producer.php",
          fileDigest: digest("2"),
          startLine: 1,
          endLine: 2,
        },
      ],
    },
    {
      ordinal: 2,
      relation: "proposed-connection" as const,
      actor: "unauthenticated-attacker",
      request: "Read and redeem the capability.",
      stateIdentity: "shared-state",
      consumedValues: ["shared-capability"],
      producedValues: ["target-session"],
      evidence: [
        {
          path: "consumer.php",
          fileDigest: digest("3"),
          startLine: 1,
          endLine: 2,
        },
      ],
    },
  ],
  unknowns: [
    {
      claim: "The values use the same state identity.",
      requiredEvidence: "Trace the stored key and returned value.",
    },
  ],
  falsifier: "The producer and consumer use unrelated state.",
  nextAction: "Challenge the shared-state premise in fresh source.",
};
const proposal = {
  ...proposalIdentity,
  id: sha256Digest(proposalIdentity),
};
const synthesisIdentity = {
  kind: "chain-synthesis" as const,
  schemaVersion: 1 as const,
  target,
  manifest: manifestRef,
  queue: queueRef,
  batchId: proposal.batchId,
  attempt: synthesisAttempt,
  itemDispositions: proposal.itemIds.map((itemId) => ({
    itemId,
    disposition: "used" as const,
    reason: "The item contributes to the proposal.",
  })),
  proposals: [proposal],
};
const synthesis: ChainSynthesis = {
  ...synthesisIdentity,
  id: sha256Digest(synthesisIdentity),
};

function completedResult(
  plan: Extract<AttemptPlanV2, { role: "adversarial-critic" }>,
  output: unknown,
) {
  const planDigest = sha256Digest(plan);
  const value = {
    kind: "model-attempt-result" as const,
    schemaVersion: 2 as const,
    attemptId: plan.attemptId,
    owner: "exploration" as const,
    role: "adversarial-critic" as const,
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
      role: "adversarial-critic" as const,
      planDigest,
      digest: sha256Digest(value),
    },
    value,
  };
}

const sourceToolPolicy = {
  kind: "source-tool-policy" as const,
  schemaVersion: 1 as const,
  id: "critic-source-v1",
  digest: digest("1"),
};

function critic(modelExecution: ModelExecution) {
  return openSemanticAdversarialCritique({
    modelExecution,
    promptSet: { id: "adversarial-critic-v1", digest: digest("0") },
    modelProfile: {
      provider: "anthropic",
      model: "claude-opus-5",
      transport: "claude-code-process",
      executableVersion: "2.1.260",
      effort: "high",
      eligibilityReceiptDigest: digest("2"),
    },
    sourceToolPolicy,
    budget: {
      maxWallTimeMs: 3_600_000,
      maxModelTokens: 300_000,
      maxModelTurns: 128,
      maxProviderCostUsd: 10,
      maxOutputBytes: 2 * 1024 * 1024,
      maxSourceQueries: 256,
    },
  });
}

const input = {
  kind: "critique-chain-synthesis" as const,
  schemaVersion: 1 as const,
  synthesis,
  manifest: { ref: manifestRef, value: manifestValue },
};

function needsEvidenceOutput() {
  return {
    kind: "adversarial-critic-output",
    schemaVersion: 1,
    dispositions: [
      {
        proposalId: proposal.id,
        verdict: "needs-evidence",
        challenges: [
          {
            category: "state-identity",
            claim: "Both steps use the same persisted value.",
            evidence: proposal.steps[1]!.evidence,
            reason:
              "The consumer key is visible, but equality is not established.",
            falsifier: "The keys or transformations differ.",
          },
        ],
        gap: {
          requiredFact: "Resolve the exact stored and returned value identity.",
          sourceEvidence: proposal.steps[1]!.evidence,
          expectedObservation:
            "Producer and consumer use the same key and value.",
          falsifier: "A transformation prevents capability reuse.",
          nextAction: "Trace writes and reads of the exact key.",
        },
      },
    ],
  };
}

describe("SemanticAdversarialCritique.critique", () => {
  it("runs a fresh source-enabled Critic and materializes every proposal disposition", async () => {
    let observedPlan: AttemptPlanV2 | undefined;
    const modelExecution: ModelExecution = {
      run: async (plan) => {
        if (plan.schemaVersion !== 2 || plan.role !== "adversarial-critic") {
          throw new Error("Expected Adversarial Critic v2");
        }
        observedPlan = plan;
        return completedResult(plan, needsEvidenceOutput());
      },
    };

    const opened = critic(modelExecution);
    const result = await opened.critique(input);
    const replay = await opened.critique(input);

    expect(observedPlan).toMatchObject({
      role: "adversarial-critic",
      target,
      manifest: manifestRef,
      sourceToolPolicy,
      assignment: {
        kind: "chain-critique",
        synthesisDigest: synthesis.id,
        proposalIds: [proposal.id],
      },
    });
    const providerSchema = z
      .object({
        properties: z.object({
          dispositions: z.object({
            items: z.object({
              oneOf: z.array(
                z.object({
                  properties: z.record(z.string(), z.unknown()),
                  required: z.array(z.string()),
                }),
              ),
            }),
          }),
        }),
      })
      .parse(observedPlan?.outputJsonSchema);
    const dispositionBranches = new Map(
      providerSchema.properties.dispositions.items.oneOf.map((branch) => {
        const verdict = z
          .object({ const: z.string() })
          .parse(branch.properties.verdict).const;
        return [verdict, branch] as const;
      }),
    );
    expect([...dispositionBranches.keys()].sort()).toEqual([
      "contradicted",
      "needs-evidence",
      "survives",
    ]);
    for (const verdict of ["survives", "contradicted"]) {
      const branch = dispositionBranches.get(verdict);
      expect(branch?.required).not.toContain("gap");
      expect(branch?.properties).not.toHaveProperty("gap");
    }
    expect(dispositionBranches.get("needs-evidence")?.required).toContain(
      "gap",
    );
    expect(
      dispositionBranches.get("needs-evidence")?.properties,
    ).toHaveProperty("gap");
    expect(result).toMatchObject({
      kind: "adversarial-critique",
      schemaVersion: 1,
      target,
      manifest: manifestRef,
      dispositions: [
        {
          proposal: {
            kind: "chain-proposal",
            id: proposal.id,
          },
          verdict: "needs-evidence",
          gap: {
            kind: "critic-frontier-gap",
            predecessorProposal: {
              kind: "chain-proposal",
              id: proposal.id,
            },
          },
        },
      ],
    });
    expect(replay).toEqual(result);
  });

  it("returns typed incomplete when the Critic omits a Chain Proposal", async () => {
    const modelExecution: ModelExecution = {
      run: async (plan) => {
        if (plan.schemaVersion !== 2 || plan.role !== "adversarial-critic") {
          throw new Error("Expected Adversarial Critic v2");
        }
        return completedResult(plan, {
          kind: "adversarial-critic-output",
          schemaVersion: 1,
          dispositions: [],
        });
      },
    };

    await expect(critic(modelExecution).critique(input)).resolves.toMatchObject(
      {
        kind: "adversarial-critique-incomplete",
        reason: "proposal-omission",
      },
    );
  });

  it("requires a concrete Frontier Gap for needs-evidence", async () => {
    const modelExecution: ModelExecution = {
      run: async (plan) => {
        if (plan.schemaVersion !== 2 || plan.role !== "adversarial-critic") {
          throw new Error("Expected Adversarial Critic v2");
        }
        const output = needsEvidenceOutput();
        const [disposition] = output.dispositions;
        if (disposition === undefined) throw new Error("Missing fixture");
        const { gap: _gap, ...withoutGap } = disposition;
        return completedResult(plan, {
          ...output,
          dispositions: [withoutGap],
        });
      },
    };

    await expect(critic(modelExecution).critique(input)).resolves.toMatchObject(
      {
        kind: "adversarial-critique-incomplete",
        reason: "invalid-output",
      },
    );
  });

  it("does not pass Critic evidence outside the bound Manifest", async () => {
    const modelExecution: ModelExecution = {
      run: async (plan) => {
        if (plan.schemaVersion !== 2 || plan.role !== "adversarial-critic") {
          throw new Error("Expected Adversarial Critic v2");
        }
        const output = needsEvidenceOutput();
        const challenge = output.dispositions[0]?.challenges[0];
        if (challenge === undefined) throw new Error("Missing fixture");
        challenge.evidence = [
          {
            path: "foreign.php",
            fileDigest: digest("9"),
            startLine: 1,
            endLine: 2,
          },
        ];
        return completedResult(plan, output);
      },
    };

    await expect(critic(modelExecution).critique(input)).resolves.toMatchObject(
      {
        kind: "adversarial-critique-incomplete",
        reason: "foreign-source-anchor",
      },
    );
  });
});
