import {
  canonicalJson,
  sha256Digest,
} from "../research-record/canonical-json.js";
import type { SurfaceMap } from "../source-mapping/index.js";
import {
  explorationBootstrapPolicySchema,
  explorationDecisionInputSchema,
  explorationDecisionSchema,
  explorationPolicyRefSchema,
  surfaceMapRefSchema,
  surfaceMapSchema,
  type Exploration,
  type ExplorationBootstrapPolicy,
  type ExplorationDecision,
  type FocusArea,
  type OpenExplorationOptions,
  type WorkLease,
} from "./contracts.js";

type SurfaceNode = SurfaceMap["nodes"][number];
type FocusFeature = FocusArea["brief"]["feature"];

function compareText(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function firstObservedPath(node: SurfaceNode): string | undefined {
  return node.evidence.kind === "observed"
    ? node.evidence.evidence[0]?.path
    : undefined;
}

function featureFor(node: SurfaceNode): FocusFeature {
  if (node.kind === "entry") {
    return node.subject.kind === "rest-route" ? "rest-route" : "hook";
  }
  if (node.kind === "symbol") {
    throw new Error("Symbol nodes cannot own bootstrap Focus Areas");
  }
  return node.kind;
}

function focusForNode(mapDigest: string, node: SurfaceNode): FocusArea {
  if (node.kind === "symbol") {
    throw new Error("Symbol nodes cannot own bootstrap Focus Areas");
  }
  const owner: FocusArea["owner"] = {
    kind: "surface-node",
    nodeId: node.id,
    nodeKind: node.kind,
  };
  const feature = featureFor(node);
  const stateTransition =
    node.subject.kind === "storage" ? node.subject.access : "unresolved";
  const properties: Record<
    FocusFeature,
    {
      lane: FocusArea["lane"];
      invariant: FocusArea["brief"]["securityInvariant"];
      tier: FocusArea["risk"]["tier"];
      basis: FocusArea["risk"]["basis"];
    }
  > = {
    "rest-route": {
      lane: "primitive",
      invariant: "entry-authorization-and-input-handling",
      tier: "elevated",
      basis: "external-rest-route",
    },
    hook: {
      lane: "primitive",
      invariant: "entry-authorization-and-input-handling",
      tier: "standard",
      basis: "registered-hook",
    },
    guard: {
      lane: "primitive",
      invariant: "authorization-boundary",
      tier: "standard",
      basis: "authorization-boundary",
    },
    source: {
      lane: "primitive",
      invariant: "input-integrity",
      tier: "standard",
      basis: "input-source",
    },
    state: {
      lane: "frontier",
      invariant: "persistent-state-integrity",
      tier: "standard",
      basis: "persistent-state",
    },
    sink: {
      lane: "primitive",
      invariant: "output-integrity",
      tier: "elevated",
      basis: "security-sensitive-sink",
    },
    "unregistered-php-file": {
      lane: "coverage",
      invariant: "direct-request-safety",
      tier: "coverage",
      basis: "unregistered-php-file",
    },
    "unmapped-asset": {
      lane: "coverage",
      invariant: "coverage-completeness",
      tier: "coverage",
      basis: "mapping-gap",
    },
  };
  const property = properties[feature];
  return {
    id: sha256Digest({ kind: "focus-area", mapDigest, owner }),
    owner,
    lane: property.lane,
    brief: {
      feature,
      actor: "unresolved",
      requiredPrivilege: "unresolved",
      stateTransition,
      securityInvariant: property.invariant,
    },
    risk: { tier: property.tier, basis: property.basis },
  };
}

function sourceFileFocus(
  mapDigest: string,
  path: string,
  fileDigest: string,
): FocusArea {
  const owner: FocusArea["owner"] = {
    kind: "source-file",
    path,
    fileDigest,
  };
  return {
    id: sha256Digest({ kind: "focus-area", mapDigest, owner }),
    owner,
    lane: "coverage",
    brief: {
      feature: "unregistered-php-file",
      actor: "unresolved",
      requiredPrivilege: "unresolved",
      stateTransition: "unresolved",
      securityInvariant: "direct-request-safety",
    },
    risk: { tier: "coverage", basis: "unregistered-php-file" },
  };
}

function gapFocus(
  mapDigest: string,
  gap: SurfaceMap["gaps"][number],
): FocusArea {
  const owner: FocusArea["owner"] = {
    kind: "coverage-gap",
    gapId: gap.id,
    path: gap.path,
  };
  return {
    id: sha256Digest({ kind: "focus-area", mapDigest, owner }),
    owner,
    lane: "coverage",
    brief: {
      feature: "unmapped-asset",
      actor: "unresolved",
      requiredPrivilege: "unresolved",
      stateTransition: "unresolved",
      securityInvariant: "coverage-completeness",
    },
    risk: { tier: "coverage", basis: "mapping-gap" },
  };
}

function category(focus: FocusArea): number {
  const ranks: Record<FocusFeature, number> = {
    "rest-route": 0,
    sink: 1,
    state: 2,
    source: 3,
    "unregistered-php-file": 4,
    "unmapped-asset": 5,
    guard: 6,
    hook: 7,
  };
  return ranks[focus.brief.feature];
}

function selectFocusAreas(
  candidates: readonly FocusArea[],
  limit: number,
): FocusArea[] {
  const buckets = new Map<number, FocusArea[]>();
  for (const candidate of candidates) {
    const rank = category(candidate);
    const bucket = buckets.get(rank) ?? [];
    bucket.push(candidate);
    buckets.set(rank, bucket);
  }
  for (const bucket of buckets.values()) {
    bucket.sort((left, right) => compareText(left.id, right.id));
  }
  const selected: FocusArea[] = [];
  const ranks = [...buckets.keys()].sort((left, right) => left - right);
  while (selected.length < limit) {
    let added = false;
    for (const rank of ranks) {
      const candidate = buckets.get(rank)?.shift();
      if (candidate === undefined) continue;
      selected.push(candidate);
      added = true;
      if (selected.length === limit) break;
    }
    if (!added) break;
  }
  return selected.sort((left, right) => compareText(left.id, right.id));
}

function primaryStrategy(focus: FocusArea): WorkLease["strategy"] {
  switch (focus.brief.feature) {
    case "rest-route":
    case "hook":
    case "source":
    case "unregistered-php-file":
      return "entry-forward";
    case "sink":
      return "sink-backward";
    case "state":
      return "state-chain";
    case "guard":
      return "invariant-review";
    case "unmapped-asset":
      return "wildcard";
  }
}

function lease(
  focus: FocusArea,
  strategy: WorkLease["strategy"],
  modelFamilyConstraint: WorkLease["modelFamilyConstraint"],
  policy: ExplorationBootstrapPolicy,
): WorkLease {
  const identity = {
    kind: "work-lease",
    focusAreaId: focus.id,
    lane: focus.lane,
    strategy,
    modelFamilyConstraint,
    budget: policy.leaseBudget,
  };
  return {
    id: sha256Digest(identity),
    focusAreaId: focus.id,
    role: "finder",
    lane: focus.lane,
    strategy,
    modelFamilyConstraint,
    budget: policy.leaseBudget,
  };
}

function mapGateNeeds(map: SurfaceMap): string[] {
  const needs = new Set<string>();
  if (
    map.summary.files !== map.inventory.length ||
    map.summary.nodes !== map.nodes.length ||
    map.summary.relations !== map.relations.length ||
    map.summary.gaps !== map.gaps.length
  ) {
    needs.add("map-summary");
  }
  const inventory = new Map<string, string>();
  for (const entry of map.inventory) {
    if (inventory.has(entry.path)) needs.add("unique-inventory-path");
    inventory.set(entry.path, entry.digest);
  }
  const nodes = new Set(map.nodes.map((node) => node.id));
  for (const claim of [...map.nodes, ...map.relations]) {
    if (claim.evidence.kind !== "observed") continue;
    for (const anchor of claim.evidence.evidence) {
      if (
        anchor.targetSnapshotDigest !== map.targetSnapshot.digest ||
        inventory.get(anchor.path) !== anchor.fileDigest
      ) {
        needs.add("source-anchor-inventory-binding");
      }
    }
  }
  for (const relation of map.relations) {
    if (
      !nodes.has(relation.from) ||
      (relation.to !== null && !nodes.has(relation.to))
    ) {
      needs.add("relation-endpoint");
    }
  }
  for (const gap of map.gaps) {
    if (!inventory.has(gap.path)) needs.add("gap-inventory-binding");
    if (
      gap.evidence !== undefined &&
      (gap.evidence.targetSnapshotDigest !== map.targetSnapshot.digest ||
        inventory.get(gap.evidence.path) !== gap.evidence.fileDigest)
    ) {
      needs.add("source-anchor-inventory-binding");
    }
  }
  return [...needs].sort(compareText);
}

class BootstrapExploration implements Exploration {
  readonly #mapRef;
  readonly #map;
  readonly #policyRef;
  readonly #policy;

  constructor(options: OpenExplorationOptions) {
    this.#mapRef = surfaceMapRefSchema.parse(options.surfaceMap.ref);
    this.#map = surfaceMapSchema.parse(options.surfaceMap.value);
    this.#policyRef = explorationPolicyRefSchema.parse(options.policy.ref);
    this.#policy = explorationBootstrapPolicySchema.parse(options.policy.value);
    if (
      sha256Digest(this.#map) !== this.#mapRef.digest ||
      this.#mapRef.revisionKind !== this.#map.revision.kind ||
      this.#mapRef.targetSnapshotId !== this.#map.targetSnapshot.id ||
      this.#mapRef.mappingProfileId !== this.#map.mappingProfile.id ||
      canonicalJson(this.#mapRef.summary) !== canonicalJson(this.#map.summary)
    ) {
      throw new Error("Exploration Surface Map reference mismatch");
    }
    if (
      sha256Digest(this.#policy) !== this.#policyRef.digest ||
      this.#policy.id !== this.#policyRef.id
    ) {
      throw new Error("Exploration Policy reference mismatch");
    }
  }

  decide(input: Parameters<Exploration["decide"]>[0]): ExplorationDecision {
    const parsedInput = explorationDecisionInputSchema.parse(input);
    if (
      canonicalJson(parsedInput.map) !== canonicalJson(this.#mapRef) ||
      canonicalJson(parsedInput.policy) !== canonicalJson(this.#policyRef)
    ) {
      throw new Error(
        "Exploration input is not bound to the configured source",
      );
    }
    if (this.#map.inventory.length === 0) {
      const gap = {
        kind: "exploration-gap" as const,
        schemaVersion: 1 as const,
        id: sha256Digest({
          kind: "exploration-gap",
          mapDigest: this.#mapRef.digest,
          reason: "empty-inventory",
        }),
        reason: "empty-inventory" as const,
        requiredEvidence: ["target-file-inventory"],
      };
      return explorationDecisionSchema.parse({ kind: "blocked", gaps: [gap] });
    }
    const needs = mapGateNeeds(this.#map);
    if (needs.length > 0) {
      const request = {
        kind: "mapping-evidence-request" as const,
        schemaVersion: 1 as const,
        id: sha256Digest({
          kind: "mapping-evidence-request",
          mapDigest: this.#mapRef.digest,
          needs,
        }),
        map: this.#mapRef,
        reason: "minimum-map-gate-failed" as const,
        needs,
      };
      return explorationDecisionSchema.parse({ kind: "revise-map", request });
    }

    const candidates = this.#focusCandidates();
    if (candidates.length === 0) {
      const needs = ["focusable-surface-anchor"];
      const request = {
        kind: "mapping-evidence-request" as const,
        schemaVersion: 1 as const,
        id: sha256Digest({
          kind: "mapping-evidence-request",
          mapDigest: this.#mapRef.digest,
          needs,
        }),
        map: this.#mapRef,
        reason: "minimum-map-gate-failed" as const,
        needs,
      };
      return explorationDecisionSchema.parse({ kind: "revise-map", request });
    }

    const focusLimit = Math.min(
      this.#policy.maxFocusAreas,
      this.#policy.maxLeases - 1,
    );
    const focusAreas = selectFocusAreas(candidates, focusLimit);
    const families = [...this.#policy.eligibleModelFamilies].sort(compareText);
    const leases = focusAreas.map((focus, index) =>
      lease(
        focus,
        primaryStrategy(focus),
        { kind: "require", family: families[index % families.length]! },
        this.#policy,
      ),
    );
    const duplicateFocus =
      focusAreas.find((focus) => focus.risk.tier === "elevated") ??
      focusAreas[0]!;
    const primary = leases.find(
      (candidate) => candidate.focusAreaId === duplicateFocus.id,
    )!;
    const duplicateStrategy = leases.some(
      (candidate) => candidate.strategy === "wildcard",
    )
      ? "invariant-review"
      : "wildcard";
    const differentFamily = families.find(
      (family) => family !== primary.modelFamilyConstraint.family,
    );
    const duplicateConstraint: WorkLease["modelFamilyConstraint"] =
      differentFamily === undefined
        ? {
            kind: "reuse-with-exception",
            family: primary.modelFamilyConstraint.family,
            reason: "single-eligible-family",
          }
        : { kind: "require", family: differentFamily };
    leases.push(
      lease(
        duplicateFocus,
        duplicateStrategy === primary.strategy ? "wildcard" : duplicateStrategy,
        duplicateConstraint,
        this.#policy,
      ),
    );
    leases.sort((left, right) => compareText(left.id, right.id));
    const plan = {
      kind: "work-wave-plan" as const,
      schemaVersion: 1 as const,
      id: sha256Digest({
        kind: "work-wave-plan",
        map: this.#mapRef,
        policy: this.#policyRef,
        focusAreaIds: focusAreas.map((focus) => focus.id),
        leaseIds: leases.map((work) => work.id),
      }),
      map: this.#mapRef,
      policy: this.#policyRef,
      focusAreas,
      leases,
    };
    return explorationDecisionSchema.parse({ kind: "run-wave", plan });
  }

  #focusCandidates(): FocusArea[] {
    const mapDigest = this.#mapRef.digest;
    const entryPaths = new Set(
      this.#map.nodes
        .filter((node) => node.kind === "entry")
        .map(firstObservedPath)
        .filter((path): path is string => path !== undefined),
    );
    const candidates = this.#map.nodes
      .filter((node) => node.kind !== "symbol")
      .map((node) => focusForNode(mapDigest, node));
    for (const entry of this.#map.inventory) {
      if (entry.classification === "php" && !entryPaths.has(entry.path)) {
        candidates.push(sourceFileFocus(mapDigest, entry.path, entry.digest));
      }
    }
    for (const gap of this.#map.gaps) {
      candidates.push(gapFocus(mapDigest, gap));
    }
    const byId = new Map(candidates.map((focus) => [focus.id, focus]));
    return [...byId.values()].sort((left, right) =>
      compareText(left.id, right.id),
    );
  }
}

export function openBootstrapExploration(
  options: OpenExplorationOptions,
): Exploration {
  return new BootstrapExploration(options);
}
