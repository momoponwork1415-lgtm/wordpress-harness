import type { SurfaceMap } from "../source-mapping/index.js";
import type { FocusArea } from "./contracts.js";

type SurfaceNode = SurfaceMap["nodes"][number];
type FocusFeature = FocusArea["brief"]["feature"];

export interface FocusPortfolio {
  readonly focusAreas: readonly FocusArea[];
  readonly duplicateFocus: FocusArea;
}

interface NodeRouteSignal {
  readonly rootRank: number;
  readonly surfaceKinds: number;
  readonly knownRelations: number;
  readonly unknownRelations: number;
}

const noRouteSignal: NodeRouteSignal = {
  rootRank: 2,
  surfaceKinds: 0,
  knownRelations: 0,
  unknownRelations: 0,
};

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

function sinkImpact(focus: FocusArea, map: SurfaceMap): number {
  if (focus.owner.kind !== "surface-node" || focus.owner.nodeKind !== "sink") {
    return 0;
  }
  const nodeId = focus.owner.nodeId;
  const node = map.nodes.find((candidate) => candidate.id === nodeId);
  if (node?.kind !== "sink") return 4;
  switch (node.subject.kind) {
    case "code-execution":
    case "process-execution":
      return 0;
    case "filesystem-write":
      return 1;
    case "database-query":
      return 2;
    case "html-output":
      return 3;
    default:
      return 4;
  }
}

function nodeRouteSignals(
  map: SurfaceMap,
): ReadonlyMap<string, NodeRouteSignal> {
  const adjacency = new Map<string, Set<string>>();
  for (const node of map.nodes) adjacency.set(node.id, new Set());
  for (const relation of map.relations) {
    if (relation.to === null || relation.evidence.kind === "unknown") continue;
    adjacency.get(relation.from)?.add(relation.to);
    adjacency.get(relation.to)?.add(relation.from);
  }
  const classificationByPath = new Map(
    map.inventory.map((entry) => [entry.path, entry.classification]),
  );
  const nodesById = new Map(map.nodes.map((node) => [node.id, node]));
  const signals = new Map<string, NodeRouteSignal>();
  const visited = new Set<string>();
  for (const node of map.nodes) {
    if (visited.has(node.id)) continue;
    const component: string[] = [];
    const frontier = [node.id];
    visited.add(node.id);
    for (let index = 0; index < frontier.length; index += 1) {
      const current = frontier[index];
      if (current === undefined) continue;
      component.push(current);
      for (const neighbor of adjacency.get(current) ?? []) {
        if (visited.has(neighbor)) continue;
        visited.add(neighbor);
        frontier.push(neighbor);
      }
    }
    let rootRank = 2;
    for (const nodeId of component) {
      const member = nodesById.get(nodeId);
      const path = member === undefined ? undefined : firstObservedPath(member);
      if (
        path === undefined ||
        classificationByPath.get(path) === "bundled-vendor"
      ) {
        continue;
      }
      if (member?.kind === "entry") {
        rootRank = 0;
        break;
      }
      if (member?.kind === "state") rootRank = Math.min(rootRank, 1);
    }
    const componentIds = new Set(component);
    const signal: NodeRouteSignal = {
      rootRank,
      surfaceKinds: new Set(
        component
          .map((nodeId) => nodesById.get(nodeId)?.kind)
          .filter((kind) => kind !== undefined && kind !== "symbol"),
      ).size,
      knownRelations: map.relations.filter(
        (relation) =>
          relation.to !== null &&
          relation.evidence.kind !== "unknown" &&
          componentIds.has(relation.from) &&
          componentIds.has(relation.to),
      ).length,
      unknownRelations: map.relations.filter(
        (relation) =>
          relation.evidence.kind === "unknown" &&
          (componentIds.has(relation.from) ||
            (relation.to !== null && componentIds.has(relation.to))),
      ).length,
    };
    for (const nodeId of component) signals.set(nodeId, signal);
  }
  return signals;
}

function routeSignal(
  focus: FocusArea,
  signals: ReadonlyMap<string, NodeRouteSignal>,
): NodeRouteSignal {
  return focus.owner.kind === "surface-node"
    ? (signals.get(focus.owner.nodeId) ?? noRouteSignal)
    : noRouteSignal;
}

function focusClassRank(
  focus: FocusArea,
  map: SurfaceMap,
  routeSignals: ReadonlyMap<string, NodeRouteSignal>,
): number {
  if (focus.owner.kind !== "surface-node") {
    return focus.owner.kind === "coverage-gap" ? 8 : 9;
  }
  const nodeId = focus.owner.nodeId;
  const node = map.nodes.find((candidate) => candidate.id === nodeId);
  if (node === undefined) return 10;
  const path = firstObservedPath(node);
  const classification = map.inventory.find(
    (entry) => entry.path === path,
  )?.classification;
  const route = routeSignal(focus, routeSignals).rootRank;
  if (classification === "bundled-vendor" && route === 2) return 10;
  if (node.kind === "entry") {
    if (node.subject.kind === "rest-route") {
      return node.subject.permissionCallback === null ? 0 : 1;
    }
    if (node.subject.kind === "hook") {
      const hook = node.subject.hook?.toLowerCase() ?? "";
      if (hook.includes("nopriv")) return 0;
      if (hook.startsWith("wp_ajax_") || hook.startsWith("admin_post_")) {
        return 1;
      }
    }
    return 6;
  }
  if (route === 0 && ["source", "guard", "state", "sink"].includes(node.kind)) {
    return 1;
  }
  if (node.kind === "sink") {
    const impact = sinkImpact(focus, map);
    return impact <= 1 ? 2 : impact === 2 ? 3 : 7;
  }
  if (node.kind === "state") return 4;
  if (node.kind === "source" || node.kind === "guard") return 5;
  return 6;
}

function coverageDebtRank(focus: FocusArea, map: SurfaceMap): number {
  if (focus.owner.kind === "coverage-gap") {
    const gapId = focus.owner.gapId;
    const gap = map.gaps.find((candidate) => candidate.id === gapId);
    if (gap?.kind === "parse-diagnostic") return 0;
    if (gap?.kind === "mapping-incomplete") return 1;
    return 2;
  }
  if (focus.owner.kind === "source-file") {
    return focus.owner.path.includes("/") ? 1 : 0;
  }
  return 3;
}

function compareFocusPriority(
  left: FocusArea,
  right: FocusArea,
  map: SurfaceMap,
  routeSignals: ReadonlyMap<string, NodeRouteSignal>,
): number {
  const leftRoute = routeSignal(left, routeSignals);
  const rightRoute = routeSignal(right, routeSignals);
  return (
    focusClassRank(left, map, routeSignals) -
      focusClassRank(right, map, routeSignals) ||
    leftRoute.rootRank - rightRoute.rootRank ||
    sinkImpact(left, map) - sinkImpact(right, map) ||
    rightRoute.surfaceKinds - leftRoute.surfaceKinds ||
    rightRoute.unknownRelations - leftRoute.unknownRelations ||
    rightRoute.knownRelations - leftRoute.knownRelations ||
    coverageDebtRank(left, map) - coverageDebtRank(right, map) ||
    compareText(left.id, right.id)
  );
}

export function selectFocusPortfolio(
  candidates: readonly FocusArea[],
  limit: number,
  map: SurfaceMap,
): FocusPortfolio {
  const routeSignals = nodeRouteSignals(map);
  const buckets = new Map<FocusFeature, FocusArea[]>();
  for (const candidate of candidates) {
    const feature = candidate.brief.feature;
    const bucket = buckets.get(feature) ?? [];
    bucket.push(candidate);
    buckets.set(feature, bucket);
  }
  for (const bucket of buckets.values()) {
    bucket.sort((left, right) =>
      compareFocusPriority(left, right, map, routeSignals),
    );
  }
  const selected: FocusArea[] = [];
  while (selected.length < limit) {
    const round = [...buckets.values()]
      .flatMap((bucket) => bucket.slice(0, 1))
      .sort((left, right) =>
        compareFocusPriority(left, right, map, routeSignals),
      );
    if (round.length === 0) break;
    for (const candidate of round) {
      selected.push(candidate);
      buckets.get(candidate.brief.feature)?.shift();
      if (selected.length === limit) break;
    }
  }
  const focusAreas = selected.sort((left, right) =>
    compareText(left.id, right.id),
  );
  const elevated = focusAreas.filter((focus) => focus.risk.tier === "elevated");
  const duplicateFocus = [
    ...(elevated.length > 0 ? elevated : focusAreas),
  ].sort((left, right) =>
    compareFocusPriority(left, right, map, routeSignals),
  )[0];
  if (duplicateFocus === undefined) {
    throw new Error("Focus portfolio requires at least one candidate");
  }
  return { focusAreas, duplicateFocus };
}
