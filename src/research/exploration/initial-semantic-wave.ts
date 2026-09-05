import type { AttemptExecutionResultV2 } from "../model-execution/contracts.js";
import { sha256Digest } from "../research-record/canonical-json.js";
import type { TargetSnapshotRef } from "../contracts.js";
import type { TargetFileManifestRef } from "../source-mapping/contracts.js";
import {
  researchThesisSchema,
  semanticRootPlanningPolicySchema,
  semanticWorkLeaseSchema,
  semanticWorkWavePlanSchema,
  type ResearchThesis,
  type RootPlannerOutput,
  type SemanticRootPlanningPolicy,
  type SemanticWorkLease,
  type SemanticWorkWavePlan,
  type SemanticWorkWaveRef,
} from "./semantic-contracts.js";

export interface InitialSemanticWaveFoundation {
  readonly ref: SemanticWorkWaveRef;
  readonly baselineThesis: ResearchThesis;
  readonly baselineLease: SemanticWorkLease;
}

function materializeThesis(
  target: TargetSnapshotRef,
  manifest: TargetFileManifestRef,
  proposal: RootPlannerOutput["theses"][number],
): ResearchThesis {
  return researchThesisSchema.parse({
    ...proposal,
    kind: "research-thesis",
    id: sha256Digest({ target, manifest, proposal }),
    target,
    manifest,
  });
}

function materializeLease(
  target: TargetSnapshotRef,
  manifest: TargetFileManifestRef,
  policy: SemanticRootPlanningPolicy,
  thesis: ResearchThesis,
): SemanticWorkLease {
  return semanticWorkLeaseSchema.parse({
    kind: "work-lease",
    schemaVersion: 2,
    id: sha256Digest({
      kind: "work-lease",
      schemaVersion: 2,
      target,
      manifest,
      thesisId: thesis.id,
      budget: policy.finderLeaseBudget,
    }),
    role: "finder",
    target,
    manifest,
    assignment: {
      kind: "research-thesis",
      schemaVersion: 1,
      thesisId: thesis.id,
    },
    budget: policy.finderLeaseBudget,
  });
}

export function materializeInitialSemanticWaveFoundation(input: {
  readonly target: TargetSnapshotRef;
  readonly manifest: TargetFileManifestRef;
  readonly policy: SemanticRootPlanningPolicy;
}): InitialSemanticWaveFoundation {
  const policy = semanticRootPlanningPolicySchema.parse(input.policy);
  const policyRef = {
    kind: "semantic-root-planning-policy" as const,
    schemaVersion: 1 as const,
    id: policy.id,
    digest: sha256Digest(policy),
  };
  const baselineThesis = materializeThesis(input.target, input.manifest, {
    kind: "research-thesis-proposal",
    schemaVersion: 1,
    scope: "wildcard",
    securityAssumption:
      "a whole-target review may reveal broken security semantics outside every Recon packet",
    question:
      "Which high-impact security property can a permitted attacker break anywhere in this Target?",
    motivation:
      "An independent baseline protects recall from Recon classification and framing errors.",
    startingBasis:
      "The entire immutable Target Snapshot, independent of Recon output.",
    independence:
      "This baseline may pivot across every manifest-bound source file and does not wait for Recon.",
  });
  const baselineLease = materializeLease(
    input.target,
    input.manifest,
    policy,
    baselineThesis,
  );
  const id = sha256Digest({
    kind: "initial-semantic-wave",
    schemaVersion: 1,
    target: input.target,
    manifest: input.manifest,
    policy: policyRef,
    baselineThesisId: baselineThesis.id,
  });
  return {
    ref: {
      kind: "work-wave",
      schemaVersion: 2,
      id,
      digest: id,
      targetSnapshotDigest: input.target.digest,
      manifestDigest: input.manifest.digest,
    },
    baselineThesis,
    baselineLease,
  };
}

export function materializeInitialSemanticWave(input: {
  readonly target: TargetSnapshotRef;
  readonly manifest: TargetFileManifestRef;
  readonly policy: SemanticRootPlanningPolicy;
  readonly plannerAttempt: AttemptExecutionResultV2["ref"];
  readonly recon: RootPlannerOutput;
}): SemanticWorkWavePlan {
  const foundation = materializeInitialSemanticWaveFoundation(input);
  const availableFocusedLeases = Math.max(0, input.policy.maxLeases - 1);
  if (input.recon.theses.length > availableFocusedLeases) {
    throw new Error("Recon produced more Focus Packets than the Wave can hold");
  }
  const focusedTheses = input.recon.theses.map((proposal) =>
    materializeThesis(input.target, input.manifest, proposal),
  );
  const theses = [foundation.baselineThesis, ...focusedTheses].sort(
    (left, right) => left.id.localeCompare(right.id),
  );
  const leases = [
    foundation.baselineLease,
    ...focusedTheses.map((thesis) =>
      materializeLease(input.target, input.manifest, input.policy, thesis),
    ),
  ].sort((left, right) => left.id.localeCompare(right.id));
  return semanticWorkWavePlanSchema.parse({
    kind: "work-wave-plan",
    schemaVersion: 2,
    id: foundation.ref.id,
    ref: foundation.ref,
    purpose: { kind: "raw-source" },
    target: input.target,
    manifest: input.manifest,
    policy: {
      kind: "semantic-root-planning-policy",
      schemaVersion: 1,
      id: input.policy.id,
      digest: sha256Digest(input.policy),
    },
    plannerAttempt: input.plannerAttempt,
    theses,
    leases,
  });
}
