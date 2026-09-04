import { z } from "zod";

import { sha256Digest } from "../research-record/canonical-json.js";
import {
  approachFamilyRefSchema,
  approachFamilyRegistrySchema,
  projectApproachFamilyRegistry,
  referenceApproachFamily,
} from "./semantic-approach-family-registry.js";
import { chainSynthesisSchema } from "./semantic-chain-synthesis.js";
import {
  depthIterationDecisionSchema,
  referenceDepthIterationDecision,
} from "./semantic-depth-evaluation.js";
import { semanticDepthWorkQueueSchema } from "./semantic-depth-work-queue.js";
import { verificationRecordRefSchema } from "../verification/contracts.js";

const digestSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);

export const approachFamilyTransitionSchema = z.strictObject({
  kind: z.literal("approach-family-transition"),
  schemaVersion: z.literal(1),
  familyId: digestSchema,
  before: approachFamilyRefSchema,
  after: approachFamilyRefSchema,
  actions: z
    .array(
      z.enum([
        "request-verification",
        "schedule-missing-link",
        "retain-route",
        "close-route",
        "block-route",
      ]),
    )
    .min(1)
    .max(32),
  evidenceAdded: z.number().int().nonnegative().max(64),
});

export type ApproachFamilyTransition = z.infer<
  typeof approachFamilyTransitionSchema
>;

export const approachFamilyEvidenceAttachmentSchema = z.strictObject({
  kind: z.literal("approach-family-evidence-attachment"),
  schemaVersion: z.literal(1),
  familyId: digestSchema,
  before: approachFamilyRefSchema,
  after: approachFamilyRefSchema,
  evidenceAdded: z.number().int().positive().max(64),
});

export type ApproachFamilyEvidenceAttachment = z.infer<
  typeof approachFamilyEvidenceAttachmentSchema
>;

export const approachFamilyVerificationResolutionSchema = z.strictObject({
  kind: z.literal("approach-family-verification-resolution"),
  schemaVersion: z.literal(1),
  familyId: digestSchema,
  before: approachFamilyRefSchema,
  after: approachFamilyRefSchema,
  verification: verificationRecordRefSchema,
});

export type ApproachFamilyVerificationResolution = z.infer<
  typeof approachFamilyVerificationResolutionSchema
>;

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function advanceApproachFamilyRegistry(input: {
  readonly registry: z.infer<typeof approachFamilyRegistrySchema>;
  readonly queue: z.infer<typeof semanticDepthWorkQueueSchema>;
  readonly synthesis: z.infer<typeof chainSynthesisSchema>;
  readonly decision: z.infer<typeof depthIterationDecisionSchema>;
}): ReturnType<typeof projectApproachFamilyRegistry> & {
  readonly transitions: readonly ApproachFamilyTransition[];
} {
  const registry = approachFamilyRegistrySchema.parse(input.registry);
  const queue = semanticDepthWorkQueueSchema.parse(input.queue);
  const synthesis = chainSynthesisSchema.parse(input.synthesis);
  const decision = depthIterationDecisionSchema.parse(input.decision);
  const decisionRef = referenceDepthIterationDecision(decision);
  if (
    decision.registry.digest !== sha256Digest(registry) ||
    synthesis.queue.digest !== sha256Digest(queue) ||
    decision.synthesis.id !== synthesis.id
  ) {
    throw new Error("Approach Family transition binding mismatch");
  }
  const items = new Map(queue.items.map((item) => [item.id, item]));
  const proposals = new Map(
    synthesis.proposals.map((proposal) => [proposal.id, proposal]),
  );
  const actionKinds = new Map<
    string,
    Set<(typeof decision.actions)[number]["kind"]>
  >();
  const reasons = new Map<string, string>();
  const requestedVerificationIds = new Map<string, Set<string>>();
  for (const action of decision.actions) {
    const proposal = proposals.get(action.proposal.id);
    if (proposal === undefined) {
      throw new Error("Approach Family transition lost its Chain Proposal");
    }
    const families = new Set(
      proposal.itemIds.flatMap(
        (itemId) =>
          items.get(itemId)?.families.map((family) => family.id) ?? [],
      ),
    );
    if (families.size === 0) {
      throw new Error("Depth action is not bound to an Approach Family");
    }
    for (const familyId of families) {
      const kinds = actionKinds.get(familyId) ?? new Set();
      kinds.add(action.kind);
      actionKinds.set(familyId, kinds);
      reasons.set(familyId, action.reason);
      if (action.kind === "request-verification") {
        const ids = requestedVerificationIds.get(familyId) ?? new Set();
        const hypothesisId = sha256Digest({
          kind: "source-bound-hypothesis",
          targetSnapshotDigest: decision.target.digest,
          manifestDigest: decision.manifest.digest,
          value: action.hypothesis,
        });
        ids.add(`verification:${hypothesisId.slice("sha256:".length)}`);
        requestedVerificationIds.set(familyId, ids);
      }
    }
  }
  const transitions: ApproachFamilyTransition[] = [];
  const families = registry.families.map((family) => {
    const kinds = actionKinds.get(family.id);
    if (kinds === undefined) return family;
    const state =
      kinds.has("schedule-missing-link") || kinds.has("retain-route")
        ? "active"
        : kinds.has("block-route")
          ? "blocked"
          : kinds.has("close-route")
            ? "exhausted"
            : "active";
    const updated = approachFamilyRegistrySchema.shape.families.element.parse({
      ...family,
      state,
      pendingVerifications: [
        ...new Set([
          ...family.pendingVerifications,
          ...(requestedVerificationIds.get(family.id) ?? []),
        ]),
      ].sort(compareText),
      nextAction: reasons.get(family.id) ?? family.nextAction,
    });
    transitions.push(
      approachFamilyTransitionSchema.parse({
        kind: "approach-family-transition",
        schemaVersion: 1,
        familyId: family.id,
        before: referenceApproachFamily(family),
        after: referenceApproachFamily(updated),
        actions: [...kinds].sort(compareText),
        evidenceAdded: 0,
      }),
    );
    return updated;
  });
  const projected = projectApproachFamilyRegistry({
    campaignId: registry.campaignId,
    runId: registry.runId,
    target: registry.target,
    manifest: registry.manifest,
    decisions: registry.decisions,
    depthDecisions: [...registry.depthDecisions, decisionRef.digest],
    families,
  });
  return {
    ...projected,
    transitions: transitions.sort((left, right) =>
      compareText(left.familyId, right.familyId),
    ),
  };
}

export function attachApproachFamilyEvidence(input: {
  readonly registry: z.infer<typeof approachFamilyRegistrySchema>;
  readonly decisionDigest: string;
  readonly followUpQueues: readonly z.infer<
    typeof semanticDepthWorkQueueSchema
  >[];
}): ReturnType<typeof projectApproachFamilyRegistry> & {
  readonly attachments: readonly ApproachFamilyEvidenceAttachment[];
} {
  const registry = approachFamilyRegistrySchema.parse(input.registry);
  if (!registry.depthDecisions.includes(input.decisionDigest)) {
    throw new Error("Approach Family evidence precedes its Depth Decision");
  }
  const evidenceByFamily = new Map<
    string,
    Map<string, (typeof registry.families)[number]["evidence"][number]>
  >();
  for (const queue of input.followUpQueues.map((value) =>
    semanticDepthWorkQueueSchema.parse(value),
  )) {
    if (queue.predecessorDecisionDigest !== input.decisionDigest) {
      throw new Error("Approach Family evidence Queue binding mismatch");
    }
    for (const item of queue.items) {
      for (const family of item.families) {
        const evidence = evidenceByFamily.get(family.id) ?? new Map();
        for (const subject of item.subjects)
          evidence.set(subject.digest, subject);
        evidenceByFamily.set(family.id, evidence);
      }
    }
  }
  const attachments: ApproachFamilyEvidenceAttachment[] = [];
  const families = registry.families.map((family) => {
    const evidenceAdded = [...(evidenceByFamily.get(family.id)?.values() ?? [])]
      .filter(
        (subject) =>
          !family.evidence.some(
            (existing) => existing.digest === subject.digest,
          ),
      )
      .sort(
        (left, right) =>
          compareText(left.kind, right.kind) ||
          compareText(left.id, right.id) ||
          compareText(left.digest, right.digest),
      );
    if (evidenceAdded.length === 0) return family;
    if (family.round >= 3) {
      throw new Error("Approach Family exceeded the three-Wave envelope");
    }
    const updated = approachFamilyRegistrySchema.shape.families.element.parse({
      ...family,
      round: family.round + 1,
      evidence: [...family.evidence, ...evidenceAdded],
    });
    attachments.push(
      approachFamilyEvidenceAttachmentSchema.parse({
        kind: "approach-family-evidence-attachment",
        schemaVersion: 1,
        familyId: family.id,
        before: referenceApproachFamily(family),
        after: referenceApproachFamily(updated),
        evidenceAdded: evidenceAdded.length,
      }),
    );
    return updated;
  });
  for (const familyId of evidenceByFamily.keys()) {
    if (!registry.families.some((family) => family.id === familyId)) {
      throw new Error("Approach Family evidence references a foreign Family");
    }
  }
  const projected = projectApproachFamilyRegistry({
    campaignId: registry.campaignId,
    runId: registry.runId,
    target: registry.target,
    manifest: registry.manifest,
    decisions: registry.decisions,
    depthDecisions: registry.depthDecisions,
    families,
  });
  return {
    ...projected,
    attachments: attachments.sort((left, right) =>
      compareText(left.familyId, right.familyId),
    ),
  };
}

export function resolveApproachFamilyVerifications(input: {
  readonly registry: z.infer<typeof approachFamilyRegistrySchema>;
  readonly resolutions: readonly {
    readonly familyId: string;
    readonly verification: z.infer<typeof verificationRecordRefSchema>;
  }[];
}): ReturnType<typeof projectApproachFamilyRegistry> & {
  readonly resolutions: readonly ApproachFamilyVerificationResolution[];
} {
  const registry = approachFamilyRegistrySchema.parse(input.registry);
  const byFamily = new Map<
    string,
    Map<string, z.infer<typeof verificationRecordRefSchema>>
  >();
  for (const rawResolution of input.resolutions) {
    const verification = verificationRecordRefSchema.parse(
      rawResolution.verification,
    );
    const verifications = byFamily.get(rawResolution.familyId) ?? new Map();
    if (verifications.has(verification.verificationId)) {
      throw new Error("Approach Family Verification resolution is duplicated");
    }
    verifications.set(verification.verificationId, verification);
    byFamily.set(rawResolution.familyId, verifications);
  }
  const resolutions: ApproachFamilyVerificationResolution[] = [];
  const families = registry.families.map((family) => {
    const verifications = byFamily.get(family.id);
    if (verifications === undefined) return family;
    if (
      [...verifications.keys()].some(
        (verificationId) =>
          !family.pendingVerifications.includes(verificationId),
      )
    ) {
      throw new Error(
        "Approach Family Verification was not pending on the Family",
      );
    }
    const nextOutcomes = [...family.verificationOutcomes];
    for (const verification of verifications.values()) {
      const existing = nextOutcomes.find(
        (outcome) => outcome.verificationId === verification.verificationId,
      );
      if (existing !== undefined) {
        if (
          existing.digest !== verification.digest ||
          existing.outcome !== verification.outcome
        ) {
          throw new Error("Approach Family Verification outcome conflict");
        }
        continue;
      }
      nextOutcomes.push({
        verificationId: verification.verificationId,
        digest: verification.digest,
        outcome: verification.outcome,
      });
    }
    nextOutcomes.sort((left, right) =>
      compareText(left.verificationId, right.verificationId),
    );
    const updated = approachFamilyRegistrySchema.shape.families.element.parse({
      ...family,
      pendingVerifications: family.pendingVerifications.filter(
        (verificationId) => !verifications.has(verificationId),
      ),
      verificationOutcomes: nextOutcomes,
    });
    for (const verification of verifications.values()) {
      resolutions.push(
        approachFamilyVerificationResolutionSchema.parse({
          kind: "approach-family-verification-resolution",
          schemaVersion: 1,
          familyId: family.id,
          before: referenceApproachFamily(family),
          after: referenceApproachFamily(updated),
          verification,
        }),
      );
    }
    byFamily.delete(family.id);
    return updated;
  });
  if (byFamily.size > 0) {
    throw new Error("Verification resolution references a foreign Family");
  }
  const projected = projectApproachFamilyRegistry({
    campaignId: registry.campaignId,
    runId: registry.runId,
    target: registry.target,
    manifest: registry.manifest,
    decisions: registry.decisions,
    depthDecisions: registry.depthDecisions,
    families,
  });
  return {
    ...projected,
    resolutions: resolutions.sort(
      (left, right) =>
        compareText(left.familyId, right.familyId) ||
        compareText(
          left.verification.verificationId,
          right.verification.verificationId,
        ),
    ),
  };
}
