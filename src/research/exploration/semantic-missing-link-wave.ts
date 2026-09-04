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
  type DepthIterationDecision,
} from "./semantic-depth-evaluation.js";
import {
  semanticRootPlanningPolicySchema,
  semanticWorkWaveRefSchema,
  type SemanticRootPlanningPolicy,
} from "./semantic-contracts.js";

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

export function materializeMissingLinkWaves(input: {
  readonly target: z.infer<typeof targetSnapshotRefSchema>;
  readonly manifest: z.infer<typeof targetFileManifestRefSchema>;
  readonly policy: SemanticRootPlanningPolicy;
  readonly decision: DepthIterationDecision;
  readonly critique: AdversarialCritique;
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
  const gaps = decision.actions
    .filter((action) => action.kind === "schedule-missing-link")
    .map((action) => {
      const gap = gapsById.get(action.gap.id);
      if (
        gap === undefined ||
        referenceCriticFrontierGap(gap).digest !== action.gap.digest
      ) {
        throw new Error("Missing-link action references a foreign Critic Gap");
      }
      return gap;
    })
    .sort((left, right) => left.id.localeCompare(right.id));
  if (new Set(gaps.map((gap) => gap.id)).size !== gaps.length) {
    throw new Error("Missing-link decision contains duplicate gaps");
  }
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
