import { describe, expect, it } from "vitest";

import {
  projectApproachFamilyRegistry,
  referenceApproachFamily,
  type ApproachFamily,
  type ChainSynthesis,
  type DepthIterationDecision,
  type SemanticDepthWorkQueue,
} from "../../src/research/exploration/index.js";
import { resolveEligibleMissingLinkFamilies } from "../../src/research/exploration/semantic-missing-link-wave.js";
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

function subject(family: number, ordinal: number) {
  return {
    kind: "route-fragment" as const,
    schemaVersion: 2 as const,
    id: digest(`subject-${family}-${ordinal}-id`),
    digest: digest(`subject-${family}-${ordinal}`),
    attemptId: `finder-${family}-${ordinal}`,
    leaseId: digest(`lease-${family}-${ordinal}`),
    workWaveDigest: wave.digest,
    targetSnapshotDigest: target.digest,
    manifestDigest: manifest.digest,
  };
}

function family(
  ordinal: number,
  round: 1 | 2 | 3,
  evidence: ReturnType<typeof subject>[],
): ApproachFamily {
  return {
    kind: "approach-family",
    schemaVersion: 2,
    id: digest(`family-${ordinal}`),
    campaignId: "campaign-family-capacity",
    runId: "run-family-capacity",
    target,
    manifest,
    openingDecision,
    ordinal,
    state: "active",
    pendingVerifications: [],
    verificationOutcomes: [],
    round,
    evidence,
    thesis: `High-impact route ${ordinal}.`,
    mechanism: `Cross-request mechanism ${ordinal}.`,
    falsifier: `Route ${ordinal} does not compose.`,
    nextAction: `Trace route ${ordinal}.`,
  };
}

function fixture(proposalItemGroups: readonly (readonly number[])[]): {
  sourceQueue: SemanticDepthWorkQueue;
  registry: ReturnType<typeof projectApproachFamilyRegistry>["value"];
  synthesis: ChainSynthesis;
  decision: DepthIterationDecision;
  families: readonly ApproachFamily[];
} {
  const subjectGroups = [
    [subject(1, 1), subject(1, 2)],
    [subject(2, 1), subject(2, 2)],
  ] as const;
  const families = [
    family(1, 3, [...subjectGroups[0]]),
    family(2, 1, [...subjectGroups[1]]),
  ];
  const registryBefore = projectApproachFamilyRegistry({
    campaignId: "campaign-family-capacity",
    runId: "run-family-capacity",
    target,
    manifest,
    decisions: [openingDecision],
    families,
  });
  const predecessorDecisionDigest = openingDecision.digest;
  const items = families.map((value, index) => {
    const identity = {
      kind: "semantic-depth-work-item" as const,
      predecessorDecisionDigest,
      sourceAction: "schedule-work" as const,
      families: [referenceApproachFamily(value)],
      subjects: [...subjectGroups[index]!],
      directive: {
        kind: "next-work-request" as const,
        sourceId: digest(`work-${index}`),
        requiredFact: `Resolve route ${index + 1}.`,
        falsifier: `Route ${index + 1} is disconnected.`,
        nextAction: `Trace route ${index + 1}.`,
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
  const sourceQueue: SemanticDepthWorkQueue = {
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
    digest: sha256Digest(sourceQueue),
    items: items.length,
    batches: 1,
  };
  const synthesisAttempt = {
    kind: "attempt-execution-result" as const,
    schemaVersion: 2 as const,
    attemptId: "root-synthesis-family-capacity",
    owner: "exploration" as const,
    role: "root-synthesizer" as const,
    planDigest: digest("synthesis-plan"),
    digest: digest("synthesis-attempt"),
  };
  const proposals = proposalItemGroups.map((indexes, proposalIndex) => {
    const proposalItems = indexes.map((index) => items[index]!);
    const proposalIdentity = {
      kind: "chain-proposal" as const,
      schemaVersion: 1 as const,
      target,
      manifest,
      queue: queueRef,
      batchId: batch.id,
      attempt: synthesisAttempt,
      itemIds: proposalItems.map((item) => item.id),
      subjects: proposalItems.flatMap((item) => item.subjects),
      attackerPremise: "unauthenticated" as const,
      securityProperty: `Privileged integrity route ${proposalIndex + 1}.`,
      steps: [
        {
          ordinal: 1,
          relation: "observed" as const,
          actor: "unauthenticated-attacker",
          request: "Persist an attacker-controlled value.",
          stateIdentity: "shared-state",
          consumedValues: ["public-input"],
          producedValues: ["stored-value"],
          evidence: [
            {
              path: "producer.php",
              fileDigest: digest("producer"),
              startLine: 1,
              endLine: 2,
            },
          ],
        },
        {
          ordinal: 2,
          relation: "proposed-connection" as const,
          actor: "privileged-browser",
          request: "Consume the stored value.",
          stateIdentity: "shared-state",
          consumedValues: ["stored-value"],
          producedValues: ["security-effect"],
          evidence: [
            {
              path: "consumer.php",
              fileDigest: digest("consumer"),
              startLine: 3,
              endLine: 4,
            },
          ],
        },
      ],
      unknowns: [
        {
          claim: "Both requests use the same state identity.",
          requiredEvidence: "Trace the exact state key.",
        },
      ],
      falsifier: "The requests use unrelated state.",
      nextAction: "Trace the missing state link.",
    };
    return { ...proposalIdentity, id: sha256Digest(proposalIdentity) };
  });
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
      reason: "The item contributes to a proposed route.",
    })),
    proposals,
  };
  const synthesis: ChainSynthesis = {
    ...synthesisIdentity,
    id: sha256Digest(synthesisIdentity),
  };
  const decisionAttempt = {
    kind: "attempt-execution-result" as const,
    schemaVersion: 2 as const,
    attemptId: "depth-evaluator-family-capacity",
    owner: "exploration" as const,
    role: "root-evaluator" as const,
    planDigest: digest("decision-plan"),
    digest: digest("decision-attempt"),
  };
  const decisionIdentity = {
    kind: "depth-iteration-decision" as const,
    schemaVersion: 1 as const,
    target,
    manifest,
    registry: registryBefore.ref,
    synthesis: {
      kind: "chain-synthesis" as const,
      schemaVersion: 1 as const,
      id: synthesis.id,
      targetSnapshotDigest: target.digest,
      manifestDigest: manifest.digest,
      queueDigest: queueRef.digest,
      batchId: batch.id,
      proposals: proposals.length,
    },
    critique: {
      kind: "adversarial-critique" as const,
      schemaVersion: 1 as const,
      id: digest("critique"),
      targetSnapshotDigest: target.digest,
      manifestDigest: manifest.digest,
      synthesisId: synthesis.id,
      dispositions: proposals.length,
    },
    attempt: decisionAttempt,
    actions: proposals.map((proposal, index) => ({
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
        id: digest(`gap-${index}-id`),
        digest: digest(`gap-${index}`),
        targetSnapshotDigest: target.digest,
        manifestDigest: manifest.digest,
        synthesisId: synthesis.id,
        proposalId: proposal.id,
      },
      reason: "The exact state identity needs fresh evidence.",
    })),
  };
  const decision: DepthIterationDecision = {
    ...decisionIdentity,
    id: sha256Digest(decisionIdentity),
  };
  const registry = projectApproachFamilyRegistry({
    campaignId: registryBefore.value.campaignId,
    runId: registryBefore.value.runId,
    target,
    manifest,
    decisions: registryBefore.value.decisions,
    depthDecisions: [sha256Digest(decision)],
    families,
  });
  return {
    sourceQueue,
    registry: registry.value,
    synthesis,
    decision,
    families,
  };
}

describe("missing-link Approach Family capacity", () => {
  it("suppresses a round-three Family without starving an eligible sibling action", () => {
    const input = fixture([[0], [1]]);
    const saturated = resolveEligibleMissingLinkFamilies({
      ...input,
      proposalId: input.synthesis.proposals[0]!.id,
    });
    const eligible = resolveEligibleMissingLinkFamilies({
      ...input,
      proposalId: input.synthesis.proposals[1]!.id,
    });

    expect(saturated).toEqual([]);
    expect(eligible.map((familyRef) => familyRef.id)).toEqual([
      input.families[1]!.id,
    ]);
  });

  it("keeps only eligible Families on a mixed-Family proposal", () => {
    const input = fixture([[0, 1]]);

    expect(
      resolveEligibleMissingLinkFamilies({
        ...input,
        proposalId: input.synthesis.proposals[0]!.id,
      }).map((familyRef) => familyRef.id),
    ).toEqual([input.families[1]!.id]);
  });
});
