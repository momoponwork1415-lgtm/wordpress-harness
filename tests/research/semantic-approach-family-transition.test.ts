import { describe, expect, it } from "vitest";

import {
  advanceApproachFamilyRegistry,
  projectApproachFamilyRegistry,
  type DepthIterationDecision,
  type SemanticDepthWorkQueue,
  type ChainSynthesis,
} from "../../src/research/exploration/index.js";
import { sha256Digest } from "../../src/research/research-record/canonical-json.js";

const digest = (label: string): string => sha256Digest(label);

const target = {
  id: "plugin-1.0.0",
  pluginSlug: "plugin",
  version: "1.0.0",
  digest: digest("target"),
};
const manifest = {
  kind: "target-file-manifest" as const,
  schemaVersion: 1 as const,
  targetSnapshotId: target.id,
  targetSnapshotDigest: target.digest,
  digest: digest("manifest"),
};
const wave = {
  kind: "work-wave" as const,
  schemaVersion: 2 as const,
  id: digest("wave-id"),
  digest: digest("wave"),
  targetSnapshotDigest: target.digest,
  manifestDigest: manifest.digest,
};
const openingDecision = {
  kind: "iteration-decision" as const,
  schemaVersion: 2 as const,
  digest: digest("opening-decision"),
  targetSnapshotDigest: target.digest,
  manifestDigest: manifest.digest,
  workWaveDigest: wave.digest,
};

function subject(label: string) {
  return {
    kind: "route-fragment" as const,
    schemaVersion: 2 as const,
    id: digest(`${label}-id`),
    digest: digest(label),
    attemptId: `finder-${label}`,
    leaseId: digest(`${label}-lease`),
    workWaveDigest: wave.digest,
    targetSnapshotDigest: target.digest,
    manifestDigest: manifest.digest,
  };
}

function fixture(): {
  registry: ReturnType<typeof projectApproachFamilyRegistry>["value"];
  queue: SemanticDepthWorkQueue;
  synthesis: ChainSynthesis;
  decision: DepthIterationDecision;
} {
  const registry = projectApproachFamilyRegistry({
    campaignId: "campaign-family-genesis",
    runId: "run-family-genesis",
    target,
    manifest,
    decisions: [openingDecision],
    families: [],
  });
  const subjects = [subject("producer"), subject("consumer")];
  const predecessorDecisionDigest = openingDecision.digest;
  const items = subjects.map((value, index) => {
    const identity = {
      kind: "semantic-depth-work-item" as const,
      predecessorDecisionDigest,
      sourceAction: "schedule-work" as const,
      families: [],
      subjects: [value],
      directive: {
        kind: "next-work-request" as const,
        sourceId: digest(`work-${index}`),
        requiredFact: `Resolve cross-feature fact ${index + 1}.`,
        falsifier: "The producer and consumer do not share state.",
        nextAction: "Trace the shared state identity.",
      },
    };
    return {
      ...identity,
      schemaVersion: 1 as const,
      id: sha256Digest(identity),
      target,
      manifest,
      wave,
    };
  });
  const batch = {
    kind: "semantic-depth-work-batch" as const,
    schemaVersion: 1 as const,
    id: digest("batch"),
    ordinal: 1,
    itemIds: items.map((item) => item.id),
  };
  const queue: SemanticDepthWorkQueue = {
    kind: "semantic-depth-work-queue",
    schemaVersion: 1,
    predecessorDecisionDigest,
    target,
    manifest,
    wave,
    items,
    batches: [batch],
  };
  const queueRef = {
    kind: "semantic-depth-work-queue" as const,
    schemaVersion: 1 as const,
    predecessorDecisionDigest,
    targetSnapshotDigest: target.digest,
    manifestDigest: manifest.digest,
    digest: sha256Digest(queue),
    items: items.length,
    batches: 1,
  };
  const synthesisAttempt = {
    kind: "attempt-execution-result" as const,
    schemaVersion: 2 as const,
    attemptId: "root-synthesis-family-genesis",
    owner: "exploration" as const,
    role: "root-synthesizer" as const,
    planDigest: digest("synthesis-plan"),
    digest: digest("synthesis-attempt"),
  };
  const proposalIdentity = {
    kind: "chain-proposal" as const,
    schemaVersion: 1 as const,
    target,
    manifest,
    queue: queueRef,
    batchId: batch.id,
    attempt: synthesisAttempt,
    itemIds: items.map((item) => item.id),
    subjects,
    attackerPremise: "unauthenticated" as const,
    securityProperty: "Target-account authentication integrity.",
    steps: [
      {
        ordinal: 1,
        relation: "observed" as const,
        actor: "target-system",
        request: "Persist a capability.",
        stateIdentity: "shared-capability-state",
        consumedValues: ["public-input"],
        producedValues: ["shared-capability"],
        evidence: [
          {
            path: "producer.php",
            fileDigest: digest("producer-file"),
            startLine: 1,
            endLine: 2,
          },
        ],
      },
      {
        ordinal: 2,
        relation: "proposed-connection" as const,
        actor: "unauthenticated-attacker",
        request: "Redeem the capability.",
        stateIdentity: "shared-capability-state",
        consumedValues: ["shared-capability"],
        producedValues: ["target-session"],
        evidence: [
          {
            path: "consumer.php",
            fileDigest: digest("consumer-file"),
            startLine: 3,
            endLine: 4,
          },
        ],
      },
    ],
    unknowns: [
      {
        claim: "Both requests address the same capability.",
        requiredEvidence: "Trace the exact storage key and value.",
      },
    ],
    falsifier: "The requests use distinct state identities.",
    nextAction: "Trace the missing state-identity link.",
  };
  const proposal = {
    ...proposalIdentity,
    id: sha256Digest(proposalIdentity),
  };
  const synthesisIdentity = {
    kind: "chain-synthesis" as const,
    schemaVersion: 1 as const,
    target,
    manifest,
    queue: queueRef,
    batchId: batch.id,
    attempt: synthesisAttempt,
    itemDispositions: items.map((item) => ({
      itemId: item.id,
      disposition: "used" as const,
      reason: "The item supplies one side of the proposed connection.",
    })),
    proposals: [proposal],
  };
  const synthesis: ChainSynthesis = {
    ...synthesisIdentity,
    id: sha256Digest(synthesisIdentity),
  };
  const decisionAttempt = {
    kind: "attempt-execution-result" as const,
    schemaVersion: 2 as const,
    attemptId: "depth-evaluator-family-genesis",
    owner: "exploration" as const,
    role: "root-evaluator" as const,
    planDigest: digest("decision-plan"),
    digest: digest("decision-attempt"),
  };
  const action = {
    kind: "schedule-missing-link" as const,
    proposal: {
      kind: "chain-proposal" as const,
      schemaVersion: 1 as const,
      id: proposal.id,
      targetSnapshotDigest: target.digest,
      manifestDigest: manifest.digest,
      queueDigest: queueRef.digest,
      batchId: batch.id,
    },
    gap: {
      kind: "critic-frontier-gap" as const,
      schemaVersion: 1 as const,
      id: digest("gap-id"),
      digest: digest("gap"),
      targetSnapshotDigest: target.digest,
      manifestDigest: manifest.digest,
      synthesisId: synthesis.id,
      proposalId: proposal.id,
    },
    reason: "The proposed state identity needs one fresh source trace.",
  };
  const decisionIdentity = {
    kind: "depth-iteration-decision" as const,
    schemaVersion: 1 as const,
    target,
    manifest,
    registry: registry.ref,
    synthesis: {
      kind: "chain-synthesis" as const,
      schemaVersion: 1 as const,
      id: synthesis.id,
      targetSnapshotDigest: target.digest,
      manifestDigest: manifest.digest,
      queueDigest: queueRef.digest,
      batchId: batch.id,
      proposals: 1,
    },
    critique: {
      kind: "adversarial-critique" as const,
      schemaVersion: 1 as const,
      id: digest("critique-id"),
      targetSnapshotDigest: target.digest,
      manifestDigest: manifest.digest,
      synthesisId: synthesis.id,
      dispositions: 1,
    },
    attempt: decisionAttempt,
    actions: [action],
  };
  const decision: DepthIterationDecision = {
    ...decisionIdentity,
    id: sha256Digest(decisionIdentity),
  };
  return { registry: registry.value, queue, synthesis, decision };
}

describe("advanceApproachFamilyRegistry", () => {
  it("opens a deterministic Family when continued Depth work has no prior Family", () => {
    const input = fixture();
    const first = advanceApproachFamilyRegistry(input);
    const replay = advanceApproachFamilyRegistry(input);

    expect(replay).toEqual(first);
    expect(first.transitions).toEqual([]);
    expect(first.openedFamilies).toHaveLength(1);
    expect(first.value.families).toEqual(first.openedFamilies);
    expect(first.value.families[0]).toMatchObject({
      state: "active",
      thesis: "Target-account authentication integrity.",
      mechanism: "shared-capability-state",
      falsifier: "The requests use distinct state identities.",
      nextAction: "Trace the missing state-identity link.",
      evidence: input.synthesis.proposals[0]?.subjects,
      openingDecision: {
        kind: "depth-iteration-decision",
        digest: sha256Digest(input.decision),
      },
    });
  });
});
