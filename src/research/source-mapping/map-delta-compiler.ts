import type { JsonArtifactStore } from "../research-record/index.js";
import {
  canonicalJson,
  sha256Digest,
} from "../research-record/canonical-json.js";
import { openVerifiedArtifacts } from "../research-record/verified-artifacts.js";
import {
  mapDeltaProposalSchema,
  mapDeltaReceiptSchema,
  mapDeltaSynthesisFailureSchema,
  type MapDeltaProposal,
  type MapDeltaSynthesisRequest,
  type MapDeltaSynthesizer,
  type MappingProfileRef,
  type SurfaceMap,
  type SurfaceMapRef,
} from "./contracts.js";

type ModelRevision = Extract<SurfaceMap["revision"], { kind: "model" }>;
type SurfaceRelation = SurfaceMap["relations"][number];

export interface CompileMapDeltaOptions {
  readonly artifacts: JsonArtifactStore;
  readonly synthesizer: MapDeltaSynthesizer;
  readonly predecessorRef: SurfaceMapRef;
  readonly predecessor: SurfaceMap;
  readonly profile: MappingProfileRef;
  readonly context: MapDeltaSynthesisRequest["context"];
  readonly nodeIds: ReadonlySet<string>;
  readonly existingRelationIds: ReadonlySet<string>;
}

export interface CompiledMapDelta {
  readonly revision: ModelRevision;
  readonly receiptDigest: string;
  readonly relations: readonly SurfaceRelation[];
  readonly gaps: readonly SurfaceMap["gaps"][number][];
}

function compareText(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function validateProposalIdentity(
  proposal: MapDeltaProposal,
  options: CompileMapDeltaOptions,
): void {
  const sortDigests = (digests: readonly string[]) =>
    [...digests].sort(compareText);
  if (
    canonicalJson(proposal.predecessor) !==
      canonicalJson(options.predecessorRef) ||
    canonicalJson(proposal.mappingProfile) !== canonicalJson(options.profile) ||
    canonicalJson(sortDigests(proposal.contextResponseDigests)) !==
      canonicalJson(sortDigests(options.context.map((item) => item.digest)))
  ) {
    throw new Error("Map Delta Proposal identity mismatch");
  }
}

function anchorIsInContext(
  anchor: MapDeltaProposal["relations"][number]["anchors"][number],
  context: MapDeltaSynthesisRequest["context"],
): boolean {
  return context.some((response) =>
    response.value.slices.some(
      (slice) =>
        slice.path === anchor.path &&
        slice.fileDigest === anchor.fileDigest &&
        anchor.startOffset >= slice.startOffset &&
        anchor.endOffset <= slice.endOffset &&
        anchor.endOffset > anchor.startOffset,
    ),
  );
}

function revisionFor(
  options: CompileMapDeltaOptions,
  receiptDigest: string,
): ModelRevision {
  return {
    kind: "model",
    number: options.predecessor.revision.number + 1,
    predecessor: options.predecessorRef,
    mapDeltaReceiptDigest: receiptDigest,
  };
}

export async function compileMapDelta(
  options: CompileMapDeltaOptions,
): Promise<CompiledMapDelta> {
  const artifacts = openVerifiedArtifacts(options.artifacts);
  const synthesis = await options.synthesizer.synthesize({
    predecessorRef: options.predecessorRef,
    predecessor: options.predecessor,
    profile: options.profile,
    context: options.context,
  });
  const failure = mapDeltaSynthesisFailureSchema.safeParse(synthesis);
  const contextResponseDigests = options.context.map((item) => item.digest);
  if (failure.success) {
    const path = options.context
      .flatMap((item) => item.value.slices.map((slice) => slice.path))
      .sort(compareText)[0]!;
    const receipt = mapDeltaReceiptSchema.parse({
      kind: "map-delta-receipt",
      schemaVersion: 1,
      status: "failed",
      predecessor: options.predecessorRef,
      mappingProfile: options.profile,
      contextResponseDigests,
      failureReason: failure.data.reason,
      accepted: [],
      rejected: [],
    });
    const receiptDigest = await artifacts.put("Map Delta Receipt", receipt);
    return {
      revision: revisionFor(options, receiptDigest),
      receiptDigest,
      relations: [],
      gaps: [
        {
          id: sha256Digest({
            kind: "mapping-incomplete",
            predecessorDigest: options.predecessorRef.digest,
            contextResponseDigests,
            path,
            reason: failure.data.reason,
          }),
          kind: "mapping-incomplete",
          scope: "surface-map",
          path,
          reason: failure.data.reason,
        },
      ],
    };
  }

  const proposal = mapDeltaProposalSchema.parse(synthesis);
  validateProposalIdentity(proposal, options);
  const proposalDigest = await artifacts.put("Map Delta Proposal", proposal);
  const relations: SurfaceRelation[] = [];
  const accepted: Array<{ proposalIndex: number; relationId: string }> = [];
  const rejected: Array<{
    proposalIndex: number;
    reason:
      "endpoint-not-found" | "premise-not-found" | "anchor-not-in-context";
  }> = [];
  const relationIds = new Set(options.existingRelationIds);
  proposal.relations.forEach((candidate, proposalIndex) => {
    if (
      !options.nodeIds.has(candidate.from) ||
      !options.nodeIds.has(candidate.to)
    ) {
      rejected.push({ proposalIndex, reason: "endpoint-not-found" });
      return;
    }
    if (candidate.premises.some((premise) => !options.nodeIds.has(premise))) {
      rejected.push({ proposalIndex, reason: "premise-not-found" });
      return;
    }
    if (
      candidate.anchors.some(
        (anchor) => !anchorIsInContext(anchor, options.context),
      )
    ) {
      rejected.push({ proposalIndex, reason: "anchor-not-in-context" });
      return;
    }
    const premises = [...new Set(candidate.premises)].sort(compareText);
    const relation: SurfaceRelation = {
      id: sha256Digest({
        kind: candidate.kind,
        from: candidate.from,
        to: candidate.to,
        claim: candidate.claim,
        premises,
      }),
      kind: candidate.kind,
      from: candidate.from,
      to: candidate.to,
      claim: candidate.claim,
      evidence: {
        kind: "inferred",
        premises,
        derivation: "model",
        proposalDigest,
      },
    };
    if (!relationIds.has(relation.id)) {
      relations.push(relation);
      relationIds.add(relation.id);
    }
    accepted.push({ proposalIndex, relationId: relation.id });
  });
  const receipt = mapDeltaReceiptSchema.parse({
    kind: "map-delta-receipt",
    schemaVersion: 1,
    status: "compiled",
    predecessor: options.predecessorRef,
    mappingProfile: options.profile,
    proposalDigest,
    contextResponseDigests,
    accepted,
    rejected,
  });
  const receiptDigest = await artifacts.put("Map Delta Receipt", receipt);
  return {
    revision: revisionFor(options, receiptDigest),
    receiptDigest,
    relations,
    gaps: [],
  };
}
