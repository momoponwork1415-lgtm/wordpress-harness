import { z } from "zod";

import { targetSnapshotRefSchema } from "../contracts.js";
import { sha256Digest } from "../research-record/canonical-json.js";
import { targetFileManifestRefSchema } from "../source-mapping/contracts.js";
import {
  criticFrontierGapSchema,
  referenceCriticFrontierGap,
  type AdversarialCritique,
} from "./semantic-adversarial-critique.js";
import {
  depthIterationDecisionRefSchema,
  depthIterationDecisionSchema,
  referenceDepthIterationDecision,
  type DepthIterationDecision,
} from "./semantic-depth-evaluation.js";
import {
  approachFamilyRegistrySchema,
  depthApproachFamilyId,
  referenceApproachFamily,
  type ApproachFamilyRef,
  type ApproachFamilyRegistry,
} from "./semantic-approach-family-registry.js";
import {
  chainSynthesisSchema,
  type ChainSynthesis,
} from "./semantic-chain-synthesis.js";
import {
  semanticRootPlanningPolicySchema,
  semanticWorkWaveRefSchema,
  type SemanticRootPlanningPolicy,
} from "./semantic-contracts.js";
import {
  semanticDepthWorkQueueSchema,
  type SemanticDepthWorkQueue,
} from "./semantic-depth-work-queue.js";

const digestSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);

export const missingLinkWorkLeaseSchema = z.strictObject({
  kind: z.literal("work-lease"),
  schemaVersion: z.literal(2),
  id: digestSchema,
  role: z.literal("finder"),
  target: targetSnapshotRefSchema,
  manifest: targetFileManifestRefSchema,
  assignment: z.strictObject({
    kind: z.literal("frontier-gap"),
    schemaVersion: z.literal(1),
    gapId: digestSchema,
    predecessorDecisionDigest: digestSchema,
  }),
  budget: semanticRootPlanningPolicySchema.shape.finderLeaseBudget,
});

export const semanticMissingLinkWavePlanSchema = z.strictObject({
  kind: z.literal("missing-link-wave-plan"),
  schemaVersion: z.literal(1),
  id: digestSchema,
  ref: semanticWorkWaveRefSchema,
  purpose: z.strictObject({ kind: z.literal("missing-link") }),
  target: targetSnapshotRefSchema,
  manifest: targetFileManifestRefSchema,
  predecessor: depthIterationDecisionRefSchema,
  ordinal: z.number().int().positive().max(2),
  gaps: z.array(criticFrontierGapSchema).min(1).max(4),
  leases: z.array(missingLinkWorkLeaseSchema).min(1).max(4),
});

export const semanticMissingLinkWavePlanRefSchema = z.strictObject({
  kind: z.literal("missing-link-wave-plan"),
  schemaVersion: z.literal(1),
  id: digestSchema,
  digest: digestSchema,
  targetSnapshotDigest: digestSchema,
  manifestDigest: digestSchema,
  predecessorDecisionDigest: digestSchema,
  ordinal: z.number().int().positive().max(2),
  gaps: z.number().int().positive().max(4),
});

export type MissingLinkWorkLease = z.infer<typeof missingLinkWorkLeaseSchema>;
export type SemanticMissingLinkWavePlan = z.infer<
  typeof semanticMissingLinkWavePlanSchema
>;
export type SemanticMissingLinkWavePlanRef = z.infer<
  typeof semanticMissingLinkWavePlanRefSchema
>;

export function referenceSemanticMissingLinkWavePlan(
  value: SemanticMissingLinkWavePlan,
): SemanticMissingLinkWavePlanRef {
  const plan = semanticMissingLinkWavePlanSchema.parse(value);
  return semanticMissingLinkWavePlanRefSchema.parse({
    kind: plan.kind,
    schemaVersion: plan.schemaVersion,
    id: plan.id,
    digest: sha256Digest(plan),
    targetSnapshotDigest: plan.target.digest,
    manifestDigest: plan.manifest.digest,
    predecessorDecisionDigest: plan.predecessor.digest,
    ordinal: plan.ordinal,
    gaps: plan.gaps.length,
  });
}

export function resolveEligibleMissingLinkFamilies(input: {
  readonly sourceQueue: SemanticDepthWorkQueue;
  readonly registry: ApproachFamilyRegistry;
  readonly synthesis: ChainSynthesis;
  readonly decision: DepthIterationDecision;
  readonly proposalId: string;
}): readonly ApproachFamilyRef[] {
  const sourceQueue = semanticDepthWorkQueueSchema.parse(input.sourceQueue);
  const registry = approachFamilyRegistrySchema.parse(input.registry);
  const synthesis = chainSynthesisSchema.parse(input.synthesis);
  const decision = depthIterationDecisionSchema.parse(input.decision);
  const decisionRef = referenceDepthIterationDecision(decision);
  if (
    synthesis.queue.digest !== sha256Digest(sourceQueue) ||
    decision.synthesis.id !== synthesis.id ||
    registry.target.digest !== sourceQueue.target.digest ||
    registry.manifest.digest !== sourceQueue.manifest.digest ||
    !registry.depthDecisions.includes(decisionRef.digest)
  ) {
    throw new Error("Missing-link Family capacity binding mismatch");
  }
  const proposal = synthesis.proposals.find(
    (candidate) => candidate.id === input.proposalId,
  );
  if (proposal === undefined) {
    throw new Error("Missing-link Family capacity lost its Chain Proposal");
  }
  const sourceItems = new Map(sourceQueue.items.map((item) => [item.id, item]));
  const familyIds = new Set(
    proposal.itemIds.flatMap(
      (itemId) =>
        sourceItems.get(itemId)?.families.map((family) => family.id) ?? [],
    ),
  );
  if (familyIds.size === 0) {
    const openedFamilyId = depthApproachFamilyId({
      campaignId: registry.campaignId,
      runId: registry.runId,
      targetSnapshotDigest: decision.target.digest,
      manifestDigest: decision.manifest.digest,
      openingDecisionDigest: decisionRef.digest,
      proposalId: proposal.id,
    });
    if (registry.families.some((family) => family.id === openedFamilyId)) {
      familyIds.add(openedFamilyId);
    }
  }
  if (familyIds.size === 0) {
    throw new Error("Missing-link work is not bound to an Approach Family");
  }
  return [...familyIds]
    .sort((left, right) => left.localeCompare(right))
    .map((familyId) => {
      const family = registry.families.find(
        (candidate) => candidate.id === familyId,
      );
      if (family === undefined) {
        throw new Error("Missing-link work references a foreign Family");
      }
      return family;
    })
    .filter((family) => family.round < 3)
    .map(referenceApproachFamily);
}

export function materializeMissingLinkWaves(input: {
  readonly target: z.infer<typeof targetSnapshotRefSchema>;
  readonly manifest: z.infer<typeof targetFileManifestRefSchema>;
  readonly policy: SemanticRootPlanningPolicy;
  readonly decision: DepthIterationDecision;
  readonly critique: AdversarialCritique;
  readonly sourceQueue: SemanticDepthWorkQueue;
  readonly synthesis: ChainSynthesis;
  readonly registry: ApproachFamilyRegistry;
  readonly maximumAdditionalWaves: number;
}): readonly SemanticMissingLinkWavePlan[] {
  const policy = semanticRootPlanningPolicySchema.parse(input.policy);
  const decision = depthIterationDecisionSchema.parse(input.decision);
  const predecessor = {
    kind: "depth-iteration-decision" as const,
    schemaVersion: 1 as const,
    id: decision.id,
    digest: sha256Digest(decision),
    targetSnapshotDigest: decision.target.digest,
    manifestDigest: decision.manifest.digest,
    registryDigest: decision.registry.digest,
    synthesisId: decision.synthesis.id,
    critiqueId: decision.critique.id,
    actions: decision.actions.length,
  };
  const gapsById = new Map(
    input.critique.dispositions.flatMap((disposition) =>
      disposition.verdict === "needs-evidence"
        ? [[disposition.gap.id, disposition.gap] as const]
        : [],
    ),
  );
  const resolvedGaps = decision.actions
    .filter((action) => action.kind === "schedule-missing-link")
    .map((action) => {
      const gap = gapsById.get(action.gap.id);
      if (
        gap === undefined ||
        referenceCriticFrontierGap(gap).digest !== action.gap.digest
      ) {
        throw new Error("Missing-link action references a foreign Critic Gap");
      }
      return {
        gap,
        families: resolveEligibleMissingLinkFamilies({
          sourceQueue: input.sourceQueue,
          registry: input.registry,
          synthesis: input.synthesis,
          decision,
          proposalId: action.proposal.id,
        }),
      };
    })
    .sort((left, right) => left.gap.id.localeCompare(right.gap.id));
  if (
    new Set(resolvedGaps.map(({ gap }) => gap.id)).size !== resolvedGaps.length
  ) {
    throw new Error("Missing-link decision contains duplicate gaps");
  }
  const gaps = resolvedGaps
    .filter(({ families }) => families.length > 0)
    .map(({ gap }) => gap);
  const waveLimit = Math.max(
    0,
    Math.min(2, Math.floor(input.maximumAdditionalWaves)),
  );
  const perWave = Math.min(4, policy.maxLeases);
  return Array.from(
    { length: Math.min(waveLimit, Math.ceil(gaps.length / perWave)) },
    (_, index) => {
      const waveGaps = gaps.slice(index * perWave, index * perWave + perWave);
      const ordinal = index + 1;
      const id = sha256Digest({
        kind: "missing-link-wave",
        target: input.target,
        manifest: input.manifest,
        predecessor,
        ordinal,
        gapIds: waveGaps.map((gap) => gap.id),
      });
      const ref = {
        kind: "work-wave" as const,
        schemaVersion: 2 as const,
        id,
        digest: id,
        targetSnapshotDigest: input.target.digest,
        manifestDigest: input.manifest.digest,
      };
      const leases = waveGaps.map((gap) =>
        missingLinkWorkLeaseSchema.parse({
          kind: "work-lease",
          schemaVersion: 2,
          id: sha256Digest({
            kind: "missing-link-work-lease",
            waveId: id,
            gapId: gap.id,
            budget: policy.finderLeaseBudget,
          }),
          role: "finder",
          target: input.target,
          manifest: input.manifest,
          assignment: {
            kind: "frontier-gap",
            schemaVersion: 1,
            gapId: gap.id,
            predecessorDecisionDigest: predecessor.digest,
          },
          budget: policy.finderLeaseBudget,
        }),
      );
      return semanticMissingLinkWavePlanSchema.parse({
        kind: "missing-link-wave-plan",
        schemaVersion: 1,
        id,
        ref,
        purpose: { kind: "missing-link" },
        target: input.target,
        manifest: input.manifest,
        predecessor,
        ordinal,
        gaps: waveGaps,
        leases,
      });
    },
  );
}
