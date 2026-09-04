import {
  canonicalJson,
  sha256Digest,
} from "../research-record/canonical-json.js";
import type { JsonArtifactStore } from "../research-record/contracts.js";
import {
  experimentObservationSchema,
  findingMechanismGroupSchema,
  findingMechanismGroupsSchema,
  sourceRederivationSchema,
  type FindingMechanismGroup,
  type FindingMechanismGroups,
  type VerificationRecordRef,
  type VerificationRecordView,
} from "./contracts.js";

interface EvidenceRange {
  readonly path: string;
  readonly fileDigest: string;
  readonly startLine: number;
  readonly endLine: number;
}

interface FindingCandidate {
  readonly discovery: VerificationRecordRef & { readonly outcome: "finding" };
  readonly targetSnapshotDigest: string;
  readonly proof: FindingMechanismGroup["proof"];
  readonly ranges: readonly EvidenceRange[];
}

export class FindingMechanismGroupingIntegrityError extends Error {
  readonly verificationId: string;

  constructor(verificationId: string, reason: string) {
    super(
      `Finding mechanism evidence is invalid: ${verificationId} (${reason})`,
    );
    this.name = "FindingMechanismGroupingIntegrityError";
    this.verificationId = verificationId;
  }
}

async function readArtifact(
  artifactStore: JsonArtifactStore,
  digest: string,
  verificationId: string,
): Promise<unknown> {
  const value = await artifactStore.readJson(digest);
  if (sha256Digest(value) !== digest) {
    throw new FindingMechanismGroupingIntegrityError(
      verificationId,
      "artifact-digest-mismatch",
    );
  }
  return value;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function compareRange(left: EvidenceRange, right: EvidenceRange): number {
  return (
    compareText(left.path, right.path) ||
    compareText(left.fileDigest, right.fileDigest) ||
    left.startLine - right.startLine ||
    left.endLine - right.endLine
  );
}

function rangesOverlap(left: EvidenceRange, right: EvidenceRange): boolean {
  return (
    left.path === right.path &&
    left.fileDigest === right.fileDigest &&
    left.startLine <= right.endLine &&
    right.startLine <= left.endLine
  );
}

function routesOverlap(
  left: readonly EvidenceRange[],
  right: readonly EvidenceRange[],
): boolean {
  return (
    left.every((range) =>
      right.some((candidate) => rangesOverlap(range, candidate)),
    ) &&
    right.every((range) =>
      left.some((candidate) => rangesOverlap(range, candidate)),
    )
  );
}

function sameMechanism(
  left: FindingCandidate,
  right: FindingCandidate,
): boolean {
  return (
    left.targetSnapshotDigest === right.targetSnapshotDigest &&
    canonicalJson(left.proof) === canonicalJson(right.proof) &&
    routesOverlap(left.ranges, right.ranges)
  );
}

async function findingCandidate(
  artifactStore: JsonArtifactStore,
  view: VerificationRecordView,
): Promise<FindingCandidate | undefined> {
  const record = view.value;
  if (record.outcome.kind !== "finding") return undefined;
  if (record.evidence.kind !== "experiment-pair") {
    throw new FindingMechanismGroupingIntegrityError(
      record.verificationId,
      "finding-without-experiment-pair",
    );
  }

  const rederivation = sourceRederivationSchema.parse(
    await readArtifact(
      artifactStore,
      record.evidence.sourceRederivation.digest,
      record.verificationId,
    ),
  );
  const witness = experimentObservationSchema.parse(
    await readArtifact(
      artifactStore,
      record.evidence.witness.digest,
      record.verificationId,
    ),
  );
  const control = experimentObservationSchema.parse(
    await readArtifact(
      artifactStore,
      record.evidence.control.digest,
      record.verificationId,
    ),
  );
  if (
    rederivation.status !== "supported" ||
    rederivation.verificationId !== record.verificationId ||
    rederivation.targetSnapshotDigest !== record.targetSnapshotDigest ||
    rederivation.hypothesisDigest !== record.hypothesisDigest ||
    witness.experimentId !== record.evidence.witness.experimentId ||
    control.experimentId !== record.evidence.control.experimentId ||
    witness.verificationId !== record.verificationId ||
    control.verificationId !== record.verificationId ||
    witness.hypothesisDigest !== record.hypothesisDigest ||
    control.hypothesisDigest !== record.hypothesisDigest ||
    witness.role !== "witness" ||
    control.role !== "control" ||
    canonicalJson(witness.bindings) !== canonicalJson(control.bindings)
  ) {
    throw new FindingMechanismGroupingIntegrityError(
      record.verificationId,
      "evidence-binding-mismatch",
    );
  }

  const ranges = [...rederivation.sourceEvidence].sort(compareRange);
  const sourceFiles = [
    ...new Map(
      ranges.map((range) => [
        `${range.path}\u0000${range.fileDigest}`,
        { path: range.path, fileDigest: range.fileDigest },
      ]),
    ).values(),
  ].sort(
    (left, right) =>
      compareText(left.path, right.path) ||
      compareText(left.fileDigest, right.fileDigest),
  );
  const experiment = {
    kind: rederivation.experiment.kind,
    adapterVersion: rederivation.experiment.adapterVersion,
    successCriterion: rederivation.experiment.successCriterion,
  };
  const proof = findingMechanismGroupSchema.shape.proof.parse({
    experiment,
    sourceFiles,
    bindings: witness.bindings,
    effect: {
      witness: {
        normalFunction: witness.normalFunction,
        result: witness.result,
      },
      control: {
        normalFunction: control.normalFunction,
        result: control.result,
      },
    },
  });
  return {
    discovery: { ...view.ref, outcome: "finding" },
    targetSnapshotDigest: record.targetSnapshotDigest,
    proof,
    ranges,
  };
}

function groupCandidates(
  campaignId: string,
  runId: string,
  candidates: readonly FindingCandidate[],
): FindingMechanismGroup[] {
  const remaining = new Set(candidates.map((_candidate, index) => index));
  const groups: FindingMechanismGroup[] = [];
  for (let seed = 0; seed < candidates.length; seed += 1) {
    if (!remaining.delete(seed)) continue;
    const component = [seed];
    for (let cursor = 0; cursor < component.length; cursor += 1) {
      const current = candidates[component[cursor] as number];
      if (current === undefined) continue;
      for (const candidateIndex of [...remaining]) {
        const candidate = candidates[candidateIndex];
        if (candidate !== undefined && sameMechanism(current, candidate)) {
          remaining.delete(candidateIndex);
          component.push(candidateIndex);
        }
      }
    }
    const members = component
      .map((index) => candidates[index])
      .filter(
        (candidate): candidate is FindingCandidate => candidate !== undefined,
      )
      .sort((left, right) =>
        compareText(
          left.discovery.verificationId,
          right.discovery.verificationId,
        ),
      );
    const first = members[0];
    if (first === undefined) continue;
    const identity = {
      kind: "finding-mechanism-group" as const,
      schemaVersion: 1 as const,
      campaignId,
      runId,
      targetSnapshotDigest: first.targetSnapshotDigest,
      proof: first.proof,
      discoveries: members.map((member) => member.discovery),
    };
    groups.push(
      findingMechanismGroupSchema.parse({
        kind: identity.kind,
        schemaVersion: identity.schemaVersion,
        id: sha256Digest(identity),
        targetSnapshotDigest: identity.targetSnapshotDigest,
        proof: identity.proof,
        discoveries: identity.discoveries,
      }),
    );
  }
  return groups.sort((left, right) => compareText(left.id, right.id));
}

export async function projectFindingMechanismGroups(input: {
  readonly campaignId: string;
  readonly runId: string;
  readonly verifications: readonly VerificationRecordView[];
  readonly artifactStore: JsonArtifactStore;
}): Promise<FindingMechanismGroups> {
  const candidates = (
    await Promise.all(
      input.verifications.map((view) =>
        findingCandidate(input.artifactStore, view),
      ),
    )
  )
    .filter(
      (candidate): candidate is FindingCandidate => candidate !== undefined,
    )
    .sort((left, right) =>
      compareText(
        left.discovery.verificationId,
        right.discovery.verificationId,
      ),
    );
  const groups = groupCandidates(input.campaignId, input.runId, candidates);
  const value = {
    kind: "finding-mechanism-groups" as const,
    schemaVersion: 1 as const,
    campaignId: input.campaignId,
    runId: input.runId,
    groups,
  };
  return findingMechanismGroupsSchema.parse({
    ...value,
    digest: sha256Digest(value),
  });
}
