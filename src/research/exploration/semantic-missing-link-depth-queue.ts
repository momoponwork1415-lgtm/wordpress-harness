import { z } from "zod";

import { sha256Digest } from "../research-record/canonical-json.js";
import { semanticWaveTerminalRefSchema } from "./semantic-contracts.js";
import { chainSynthesisSchema } from "./semantic-chain-synthesis.js";
import {
  depthIterationDecisionSchema,
  referenceDepthIterationDecision,
} from "./semantic-depth-evaluation.js";
import {
  approachFamilyRegistrySchema,
  type ApproachFamilyRegistry,
} from "./semantic-approach-family-registry.js";
import {
  semanticDepthWorkItemSchema,
  semanticDepthWorkQueueRefSchema,
  semanticDepthWorkQueueSchema,
  type SemanticDepthWorkQueue,
} from "./semantic-depth-work-queue.js";
import {
  resolveEligibleMissingLinkFamilies,
  semanticMissingLinkWavePlanSchema,
} from "./semantic-missing-link-wave.js";

const gapRefSchema = z.strictObject({
  kind: z.literal("critic-frontier-gap"),
  schemaVersion: z.literal(1),
  id: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  digest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  targetSnapshotDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  manifestDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  synthesisId: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  proposalId: z.string().regex(/^sha256:[a-f0-9]{64}$/),
});

export const missingLinkDepthQueueProjectionSchema = z.strictObject({
  kind: z.literal("missing-link-depth-queue-projection"),
  schemaVersion: z.literal(1),
  queue: z
    .strictObject({
      ref: semanticDepthWorkQueueRefSchema,
      value: semanticDepthWorkQueueSchema,
    })
    .optional(),
  unresolvedGaps: z.array(gapRefSchema).max(4),
});

export type MissingLinkDepthQueueProjection = z.infer<
  typeof missingLinkDepthQueueProjectionSchema
>;

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function projectMissingLinkDepthWorkQueue(input: {
  readonly sourceQueue: SemanticDepthWorkQueue;
  readonly registry: ApproachFamilyRegistry;
  readonly synthesis: z.infer<typeof chainSynthesisSchema>;
  readonly decision: z.infer<typeof depthIterationDecisionSchema>;
  readonly wave: z.infer<typeof semanticMissingLinkWavePlanSchema>;
  readonly terminal: z.infer<typeof semanticWaveTerminalRefSchema>;
}): MissingLinkDepthQueueProjection {
  const sourceQueue = semanticDepthWorkQueueSchema.parse(input.sourceQueue);
  const registry = approachFamilyRegistrySchema.parse(input.registry);
  const synthesis = chainSynthesisSchema.parse(input.synthesis);
  const decision = depthIterationDecisionSchema.parse(input.decision);
  const wave = semanticMissingLinkWavePlanSchema.parse(input.wave);
  const terminal = semanticWaveTerminalRefSchema.parse(input.terminal);
  const decisionRef = referenceDepthIterationDecision(decision);
  if (
    synthesis.queue.digest !== sha256Digest(sourceQueue) ||
    decision.synthesis.id !== synthesis.id ||
    wave.predecessor.digest !== decisionRef.digest ||
    terminal.waveId !== wave.id ||
    terminal.targetSnapshotDigest !== sourceQueue.target.digest ||
    terminal.manifestDigest !== sourceQueue.manifest.digest ||
    registry.target.digest !== sourceQueue.target.digest ||
    registry.manifest.digest !== sourceQueue.manifest.digest ||
    !registry.depthDecisions.includes(decisionRef.digest)
  ) {
    throw new Error("Missing-link Depth Queue binding mismatch");
  }

  const proposals = new Map(
    synthesis.proposals.map((proposal) => [proposal.id, proposal]),
  );
  const leases = new Map(
    wave.leases.map((lease) => [lease.assignment.gapId, lease]),
  );
  const terminalSubjects = [
    ...terminal.hypotheses,
    ...terminal.routeFragments,
    ...terminal.frontierGaps,
  ];
  const items: z.infer<typeof semanticDepthWorkItemSchema>[] = [];
  const unresolvedGaps: z.infer<typeof gapRefSchema>[] = [];
  const waveGapIds = new Set(wave.gaps.map((gap) => gap.id));

  const missingLinkActions = decision.actions.filter(
    (
      candidate,
    ): candidate is Extract<
      (typeof decision.actions)[number],
      { kind: "schedule-missing-link" }
    > => candidate.kind === "schedule-missing-link",
  );
  for (const action of missingLinkActions
    .filter((candidate) => waveGapIds.has(candidate.gap.id))
    .sort((left, right) => compareText(left.gap.id, right.gap.id))) {
    const gap = wave.gaps.find((candidate) => candidate.id === action.gap.id);
    const lease = leases.get(action.gap.id);
    const proposal = proposals.get(action.proposal.id);
    if (gap === undefined || lease === undefined || proposal === undefined) {
      throw new Error("Missing-link Depth Queue lost its predecessor");
    }
    const subjects = terminalSubjects
      .filter((subject) => subject.leaseId === lease.id)
      .sort(
        (left, right) =>
          compareText(left.kind, right.kind) ||
          compareText(left.id, right.id) ||
          compareText(left.digest, right.digest),
      );
    const families = resolveEligibleMissingLinkFamilies({
      sourceQueue,
      registry,
      synthesis,
      decision,
      proposalId: proposal.id,
    });
    if (subjects.length === 0 || families.length === 0) {
      unresolvedGaps.push(action.gap);
      continue;
    }
    const directive = {
      kind: "frontier-gap-follow-up" as const,
      sourceId: gap.id,
      requiredFact: gap.requiredFact,
      falsifier: gap.falsifier,
      nextAction: gap.nextAction,
    };
    const identity = {
      kind: "semantic-depth-work-item" as const,
      predecessorDecisionDigest: decisionRef.digest,
      sourceAction: "missing-link-result" as const,
      families,
      subjects,
      directive,
    };
    items.push(
      semanticDepthWorkItemSchema.parse({
        ...identity,
        schemaVersion: 1,
        id: sha256Digest(identity),
        target: sourceQueue.target,
        manifest: sourceQueue.manifest,
        wave: wave.ref,
      }),
    );
  }
  if (items.length === 0) {
    return missingLinkDepthQueueProjectionSchema.parse({
      kind: "missing-link-depth-queue-projection",
      schemaVersion: 1,
      unresolvedGaps,
    });
  }
  items.sort((left, right) => compareText(left.id, right.id));
  const batches = Array.from(
    { length: Math.ceil(items.length / 4) },
    (_, index) => {
      const ordinal = index + 1;
      const itemIds = items
        .slice(index * 4, index * 4 + 4)
        .map((item) => item.id);
      return {
        kind: "semantic-depth-work-batch" as const,
        schemaVersion: 1 as const,
        id: sha256Digest({
          kind: "semantic-depth-work-batch",
          predecessorDecisionDigest: decisionRef.digest,
          ordinal,
          itemIds,
        }),
        ordinal,
        itemIds,
      };
    },
  );
  const queue = semanticDepthWorkQueueSchema.parse({
    kind: "semantic-depth-work-queue",
    schemaVersion: 1,
    predecessorDecisionDigest: decisionRef.digest,
    target: sourceQueue.target,
    manifest: sourceQueue.manifest,
    wave: wave.ref,
    items,
    batches,
  });
  return missingLinkDepthQueueProjectionSchema.parse({
    kind: "missing-link-depth-queue-projection",
    schemaVersion: 1,
    queue: {
      value: queue,
      ref: {
        kind: "semantic-depth-work-queue",
        schemaVersion: 1,
        predecessorDecisionDigest: queue.predecessorDecisionDigest,
        targetSnapshotDigest: queue.target.digest,
        manifestDigest: queue.manifest.digest,
        digest: sha256Digest(queue),
        items: queue.items.length,
        batches: queue.batches.length,
      },
    },
    unresolvedGaps,
  });
}
