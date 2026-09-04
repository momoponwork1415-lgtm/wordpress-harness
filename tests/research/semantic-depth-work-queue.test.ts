import { describe, expect, it } from "vitest";

import { sha256Digest } from "../../src/research/research-record/canonical-json.js";
import {
  projectSemanticDepthWorkQueue,
  type IterationDecisionV2,
} from "../../src/research/exploration/index.js";

const digest = (character: string): string => `sha256:${character.repeat(64)}`;

const target = {
  id: "plugin-1.0.0",
  pluginSlug: "plugin",
  version: "1.0.0",
  digest: digest("1"),
};
const manifest = {
  kind: "target-file-manifest" as const,
  schemaVersion: 1 as const,
  targetSnapshotId: target.id,
  targetSnapshotDigest: target.digest,
  digest: digest("2"),
};
const wave = {
  kind: "work-wave" as const,
  schemaVersion: 2 as const,
  id: digest("3"),
  digest: digest("4"),
  targetSnapshotDigest: target.digest,
  manifestDigest: manifest.digest,
};
const subject = {
  kind: "frontier-gap" as const,
  schemaVersion: 2 as const,
  id: digest("5"),
  digest: digest("6"),
  attemptId: "finder-attempt-1",
  leaseId: digest("7"),
  workWaveDigest: wave.digest,
  targetSnapshotDigest: target.digest,
  manifestDigest: manifest.digest,
};

function decision(): IterationDecisionV2 {
  const actions: IterationDecisionV2["actions"] = [
    {
      kind: "admit-depth",
      subjects: [subject],
      admission: {
        kind: "depth-admission",
        schemaVersion: 1,
        id: digest("8"),
        target,
        manifest,
        wave,
        highImpactPotential: "A cross-actor state capability may compose.",
        composition: "Connect the producer and consumer across requests.",
        falsifier: "The state is scoped to the same actor.",
        nextAction: "Trace every consumer of the produced capability.",
      },
    },
    ...Array.from({ length: 5 }, (_, index) => ({
      kind: "schedule-work" as const,
      subjects: [subject],
      work: {
        kind: "next-work-request" as const,
        schemaVersion: 1 as const,
        id: digest(String.fromCharCode("a".charCodeAt(0) + index)),
        target,
        manifest,
        wave,
        requiredFact: `Resolve missing cross-feature fact ${index + 1}.`,
        falsifier: `The proposed connection ${index + 1} does not exist.`,
        nextAction: `Inspect the producer and consumer for fact ${index + 1}.`,
      },
    })),
    {
      kind: "retain",
      subjects: [subject],
      reason: "Keep the frontier active while next work runs.",
    },
  ];
  return {
    kind: "iteration-decision",
    schemaVersion: 2,
    target,
    manifest,
    wave,
    evaluationSubjects: [subject],
    context: {
      kind: "wave-evaluation",
      terminalDigest: digest("d"),
      workLeases: [
        {
          kind: "work-lease",
          schemaVersion: 2,
          id: digest("e"),
          digest: digest("f"),
          workWaveDigest: wave.digest,
          targetSnapshotDigest: target.digest,
          manifestDigest: manifest.digest,
        },
      ],
      attemptResults: [
        {
          kind: "attempt-execution-result",
          schemaVersion: 2,
          attemptId: "finder-attempt-1",
          owner: "exploration",
          role: "finder",
          planDigest: digest("0"),
          digest: digest("a"),
        },
      ],
      toolReceipts: [],
      rootEvaluatorAttempts: [
        {
          kind: "attempt-execution-result",
          schemaVersion: 2,
          attemptId: "root-evaluator-1",
          owner: "exploration",
          role: "root-evaluator",
          planDigest: digest("b"),
          digest: digest("c"),
        },
      ],
    },
    actions,
    campaignDisposition: "continue",
  };
}

describe("projectSemanticDepthWorkQueue", () => {
  it("retains every depth and scheduled-work action in stable batches of at most four", () => {
    const input = decision();
    const first = projectSemanticDepthWorkQueue(input);
    const replayed = projectSemanticDepthWorkQueue(input);

    expect(replayed).toEqual(first);
    expect(first.ref.digest).toBe(sha256Digest(first.value));
    expect(first.value.predecessorDecisionDigest).toBe(sha256Digest(input));
    expect(first.value.items).toHaveLength(6);
    expect(first.value.items.map((item) => item.sourceAction).sort()).toEqual([
      "admit-depth",
      "schedule-work",
      "schedule-work",
      "schedule-work",
      "schedule-work",
      "schedule-work",
    ]);
    expect(first.value.batches.map((batch) => batch.itemIds.length)).toEqual([
      4, 2,
    ]);
    expect(
      first.value.batches.flatMap((batch) => batch.itemIds).sort(),
    ).toEqual(first.value.items.map((item) => item.id).sort());
    expect(JSON.stringify(first.value)).not.toContain("retain");
  });

  it("rejects a foreign Target binding inside a depth action", () => {
    const input = decision();
    const firstAction = input.actions[0];
    if (firstAction?.kind !== "admit-depth") {
      throw new Error("Expected the first action to admit Depth");
    }
    const tampered = {
      ...input,
      actions: [
        {
          ...firstAction,
          admission: {
            ...firstAction.admission,
            target: { ...target, digest: digest("9") },
          },
        },
        ...input.actions.slice(1),
      ],
    } as IterationDecisionV2;

    expect(() => projectSemanticDepthWorkQueue(tampered)).toThrow(
      "Depth work action binding mismatch",
    );
  });
});
