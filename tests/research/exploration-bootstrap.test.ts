import { describe, expect, it } from "vitest";

import { sha256Digest } from "../../src/research/research-record/canonical-json.js";
import {
  openExploration,
  type AttemptExecutionResultRef,
  type ExplorationBootstrapPolicy,
  type ExplorationPolicyRef,
  type FinderAttemptResult,
  type SourceBoundHypothesis,
} from "../../src/research/exploration/index.js";
import type {
  SurfaceMap,
  SurfaceMapRef,
} from "../../src/research/source-mapping/index.js";

const targetDigest = `sha256:${"a".repeat(64)}`;
const phpDigest = `sha256:${"b".repeat(64)}`;
const directPhpDigest = `sha256:${"c".repeat(64)}`;
const assetDigest = `sha256:${"d".repeat(64)}`;
const profileDigest = `sha256:${"e".repeat(64)}`;
const manifestDigest = `sha256:${"f".repeat(64)}`;
const indexDigest = `sha256:${"1".repeat(64)}`;

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function sourceAnchor(path: string, fileDigest: string, startOffset: number) {
  return {
    kind: "source-anchor" as const,
    targetSnapshotDigest: targetDigest,
    path,
    fileDigest,
    startLine: startOffset + 1,
    endLine: startOffset + 1,
    startOffset,
    endOffset: startOffset + 8,
  };
}

function initialMap(): SurfaceMap {
  const routeId = sha256Digest("route");
  const callbackId = sha256Digest("callback");
  const stateId = sha256Digest("state");
  const guardId = sha256Digest("guard");
  const sinkId = sha256Digest("sink");
  const nodes: SurfaceMap["nodes"] = [
    {
      id: routeId,
      kind: "entry",
      subject: {
        kind: "rest-route",
        namespace: "demo/v1",
        route: "/items",
        callback: "demo_update_item",
        permissionCallback: null,
      },
      evidence: {
        kind: "observed",
        evidence: [sourceAnchor("plugin.php", phpDigest, 10)],
      },
    },
    {
      id: callbackId,
      kind: "symbol",
      subject: {
        kind: "symbol",
        symbolKind: "function",
        name: "demo_update_item",
      },
      evidence: {
        kind: "observed",
        evidence: [sourceAnchor("plugin.php", phpDigest, 30)],
      },
    },
    {
      id: stateId,
      kind: "state",
      subject: {
        kind: "storage",
        category: "option",
        operation: "update_option",
        access: "write",
      },
      evidence: {
        kind: "observed",
        evidence: [sourceAnchor("plugin.php", phpDigest, 50)],
      },
    },
    {
      id: guardId,
      kind: "guard",
      subject: {
        kind: "guard",
        category: "authorization",
        operation: "current_user_can",
      },
      evidence: {
        kind: "observed",
        evidence: [sourceAnchor("plugin.php", phpDigest, 70)],
      },
    },
    {
      id: sinkId,
      kind: "sink",
      subject: { kind: "html-output", operation: "echo" },
      evidence: {
        kind: "observed",
        evidence: [sourceAnchor("direct.php", directPhpDigest, 5)],
      },
    },
  ];
  nodes.sort((left, right) => compareText(left.id, right.id));
  const relations: SurfaceMap["relations"] = [
    {
      id: sha256Digest("dispatch"),
      kind: "dispatches-to",
      from: routeId,
      to: callbackId,
      claim: "literal-callback",
      evidence: {
        kind: "inferred",
        premises: [routeId, callbackId].sort(),
        derivation: "deterministic",
      },
    },
  ];
  const gaps: SurfaceMap["gaps"] = [
    {
      id: sha256Digest("asset-gap"),
      kind: "asset-not-analyzed",
      path: "assets/admin.js",
      reason: "unsupported-initial-static-slice",
      classification: "javascript",
    },
  ];
  return {
    kind: "surface-map",
    schemaVersion: 1,
    revision: { kind: "initial", number: 1, predecessor: null },
    targetSnapshot: { id: "demo-1.0.0", digest: targetDigest },
    mappingProfile: { id: "wordpress-static-v1", digest: profileDigest },
    sources: {
      manifestDigest,
      phpProgramIndexDigest: indexDigest,
    },
    inventory: [
      {
        path: "assets/admin.js",
        digest: assetDigest,
        size: 100,
        classification: "javascript",
        coverage: {
          status: "gap",
          reason: "unsupported-initial-static-slice",
        },
      },
      {
        path: "direct.php",
        digest: directPhpDigest,
        size: 80,
        classification: "php",
        coverage: { status: "indexed" },
      },
      {
        path: "plugin.php",
        digest: phpDigest,
        size: 300,
        classification: "php",
        coverage: { status: "indexed" },
      },
    ],
    nodes,
    relations,
    gaps,
    summary: {
      files: 3,
      nodes: nodes.length,
      relations: relations.length,
      gaps: gaps.length,
    },
  };
}

function observedEvidence(
  path: string,
  fileDigest: string,
  startOffset: number,
) {
  return {
    kind: "observed" as const,
    evidence: [sourceAnchor(path, fileDigest, startOffset)],
  };
}

function inferredFlow(
  id: string,
  from: string,
  to: string,
): SurfaceMap["relations"][number] {
  return {
    id: sha256Digest(id),
    kind: "flows-to",
    from,
    to,
    claim: "data-flow",
    evidence: {
      kind: "inferred",
      premises: [from, to].sort(),
      derivation: "deterministic",
    },
  };
}

function indexedFile(
  path: string,
  digest: string,
  classification: SurfaceMap["inventory"][number]["classification"] = "php",
): SurfaceMap["inventory"][number] {
  return {
    path,
    digest,
    size: 200,
    classification,
    coverage: { status: "indexed" },
  };
}

function fixtureMap(input: {
  readonly id: string;
  readonly inventory: SurfaceMap["inventory"];
  readonly nodes: SurfaceMap["nodes"];
  readonly relations?: SurfaceMap["relations"];
  readonly gaps?: SurfaceMap["gaps"];
}): SurfaceMap {
  const inventory = [...input.inventory].sort((left, right) =>
    compareText(left.path, right.path),
  );
  const nodes = [...input.nodes].sort((left, right) =>
    compareText(left.id, right.id),
  );
  const relations = [...(input.relations ?? [])];
  const gaps = [...(input.gaps ?? [])];
  return {
    kind: "surface-map",
    schemaVersion: 1,
    revision: { kind: "initial", number: 1, predecessor: null },
    targetSnapshot: { id: input.id, digest: targetDigest },
    mappingProfile: { id: "wordpress-static-v1", digest: profileDigest },
    sources: { manifestDigest, phpProgramIndexDigest: indexDigest },
    inventory,
    nodes,
    relations,
    gaps,
    summary: {
      files: inventory.length,
      nodes: nodes.length,
      relations: relations.length,
      gaps: gaps.length,
    },
  };
}

function sinkPriorityMap(): {
  readonly map: SurfaceMap;
  readonly codeExecutionSinkId: string;
} {
  const codeExecutionSinkId = sha256Digest("html-output-sink");
  const htmlOutputSinkId = sha256Digest("code-execution-sink");
  const codeDigest = `sha256:${"2".repeat(64)}`;
  const htmlDigest = `sha256:${"3".repeat(64)}`;
  const nodes: SurfaceMap["nodes"] = [
    {
      id: codeExecutionSinkId,
      kind: "sink",
      subject: { kind: "code-execution", operation: "require" },
      evidence: observedEvidence("includes/loader.php", codeDigest, 10),
    },
    {
      id: htmlOutputSinkId,
      kind: "sink",
      subject: { kind: "html-output", operation: "echo" },
      evidence: observedEvidence("views/card.php", htmlDigest, 20),
    },
  ];
  return {
    codeExecutionSinkId,
    map: fixtureMap({
      id: "sink-priority-1.0.0",
      inventory: [
        indexedFile("includes/loader.php", codeDigest),
        indexedFile("views/card.php", htmlDigest),
      ],
      nodes,
    }),
  };
}

function routePriorityMap(): {
  readonly map: SurfaceMap;
  readonly connectedSinkId: string;
  readonly isolatedVendorSinkId: string;
} {
  const base = initialMap();
  const callback = base.nodes.find((node) => node.kind === "symbol");
  if (callback === undefined) throw new Error("Missing callback fixture");
  const connectedSinkId = sha256Digest("connected-filesystem-sink");
  const isolatedVendorSinkId = sha256Digest("isolated-vendor-code-sink");
  const vendorDigest = `sha256:${"4".repeat(64)}`;
  const nodes: SurfaceMap["nodes"] = [
    ...base.nodes,
    {
      id: connectedSinkId,
      kind: "sink",
      subject: {
        kind: "filesystem-write",
        operation: "file_put_contents",
      },
      evidence: observedEvidence("plugin.php", phpDigest, 90),
    },
    {
      id: isolatedVendorSinkId,
      kind: "sink",
      subject: { kind: "code-execution", operation: "eval" },
      evidence: observedEvidence("vendor/debug.php", vendorDigest, 10),
    },
  ];
  nodes.sort((left, right) => compareText(left.id, right.id));
  const relations: SurfaceMap["relations"] = [
    ...base.relations,
    inferredFlow("callback-to-filesystem-sink", callback.id, connectedSinkId),
  ];
  const inventory: SurfaceMap["inventory"] = [
    ...base.inventory,
    indexedFile("vendor/debug.php", vendorDigest, "bundled-vendor"),
  ];
  inventory.sort((left, right) => compareText(left.path, right.path));
  return {
    connectedSinkId,
    isolatedVendorSinkId,
    map: {
      ...base,
      inventory,
      nodes,
      relations,
      summary: {
        files: base.summary.files + 1,
        nodes: nodes.length,
        relations: relations.length,
        gaps: base.summary.gaps,
      },
    },
  };
}

function externalEntryPortfolioMap(): {
  readonly map: SurfaceMap;
  readonly codeExecutionSinkId: string;
  readonly externalEntryId: string;
  readonly stateId: string;
} {
  const externalEntryId = sha256Digest("external-hook-entry");
  const codeExecutionSinkId = sha256Digest("portfolio-code-sink");
  const stateId = sha256Digest("portfolio-state");
  const entryDigest = `sha256:${"5".repeat(64)}`;
  const sinkDigest = `sha256:${"6".repeat(64)}`;
  const stateDigest = `sha256:${"7".repeat(64)}`;
  const nodes: SurfaceMap["nodes"] = [
    {
      id: externalEntryId,
      kind: "entry",
      subject: {
        kind: "hook",
        hook: "wp_ajax_nopriv_upload_asset",
        callback: "upload_asset",
      },
      evidence: observedEvidence("ajax.php", entryDigest, 10),
    },
    {
      id: codeExecutionSinkId,
      kind: "sink",
      subject: { kind: "code-execution", operation: "include" },
      evidence: observedEvidence("loader.php", sinkDigest, 20),
    },
    {
      id: stateId,
      kind: "state",
      subject: {
        kind: "storage",
        category: "option",
        operation: "update_option",
        access: "write",
      },
      evidence: observedEvidence("settings.php", stateDigest, 30),
    },
  ];
  return {
    codeExecutionSinkId,
    externalEntryId,
    stateId,
    map: fixtureMap({
      id: "portfolio-1.0.0",
      inventory: [
        indexedFile("ajax.php", entryDigest),
        indexedFile("loader.php", sinkDigest),
        indexedFile("settings.php", stateDigest),
      ],
      nodes,
    }),
  };
}

function impactFamilyPortfolioMap(): {
  readonly map: SurfaceMap;
  readonly externalEntryId: string;
  readonly serverImpactSinkId: string;
  readonly databaseSinkId: string;
} {
  const externalEntryId = sha256Digest("impact-family-external-entry");
  const serverImpactSinkId = sha256Digest("impact-family-server-sink");
  const processSinkId = sha256Digest("impact-family-process-sink");
  const filesystemSinkId = sha256Digest("impact-family-filesystem-sink");
  const databaseSinkId = sha256Digest("impact-family-database-sink");
  const browserSinkId = sha256Digest("impact-family-browser-sink");
  const digests = ["1", "2", "3", "4", "5", "6"].map(
    (character) => `sha256:${character.repeat(64)}`,
  );
  const nodes: SurfaceMap["nodes"] = [
    {
      id: externalEntryId,
      kind: "entry",
      subject: {
        kind: "hook",
        hook: "wp_ajax_nopriv_inspect_item",
        callback: "inspect_item",
      },
      evidence: observedEvidence("entry.php", digests[0]!, 10),
    },
    {
      id: serverImpactSinkId,
      kind: "sink",
      subject: { kind: "code-execution", operation: "require" },
      evidence: observedEvidence("code.php", digests[1]!, 20),
    },
    {
      id: processSinkId,
      kind: "sink",
      subject: { kind: "process-execution", operation: "exec" },
      evidence: observedEvidence("process.php", digests[2]!, 30),
    },
    {
      id: filesystemSinkId,
      kind: "sink",
      subject: {
        kind: "filesystem-write",
        operation: "file_put_contents",
      },
      evidence: observedEvidence("filesystem.php", digests[3]!, 40),
    },
    {
      id: databaseSinkId,
      kind: "sink",
      subject: { kind: "database-query", operation: "get_results" },
      evidence: observedEvidence("database.php", digests[4]!, 50),
    },
    {
      id: browserSinkId,
      kind: "sink",
      subject: { kind: "html-output", operation: "echo" },
      evidence: observedEvidence("browser.php", digests[5]!, 60),
    },
  ];
  return {
    externalEntryId,
    serverImpactSinkId,
    databaseSinkId,
    map: fixtureMap({
      id: "impact-family-portfolio-1.0.0",
      inventory: [
        indexedFile("entry.php", digests[0]!),
        indexedFile("code.php", digests[1]!),
        indexedFile("process.php", digests[2]!),
        indexedFile("filesystem.php", digests[3]!),
        indexedFile("database.php", digests[4]!),
        indexedFile("browser.php", digests[5]!),
      ],
      nodes,
    }),
  };
}

function informationGainMap(variant: number): {
  readonly map: SurfaceMap;
  readonly richerSinkId: string;
} {
  const richerSinkId = sha256Digest("poorer-code-sink");
  const poorerSinkId = sha256Digest("richer-code-sink");
  const richStateId = sha256Digest("rich-state");
  const poorStateId = sha256Digest("poor-state");
  const sourceId = sha256Digest("rich-source");
  const digests = ["8", "9", "a", "b", "c"].map(
    (character) => `sha256:${character.repeat(64)}`,
  );
  const paths = [
    "rich-sink.php",
    "poor-sink.php",
    "rich-state.php",
    "poor-state.php",
    "source.php",
  ];
  const nodes: SurfaceMap["nodes"] = [
    {
      id: richerSinkId,
      kind: "sink",
      subject: { kind: "code-execution", operation: "require_once" },
      evidence: observedEvidence(paths[0]!, digests[0]!, 10),
    },
    {
      id: poorerSinkId,
      kind: "sink",
      subject: { kind: "code-execution", operation: "require_once" },
      evidence: observedEvidence(paths[1]!, digests[1]!, 10),
    },
    ...[
      [richStateId, paths[2]!, digests[2]!],
      [poorStateId, paths[3]!, digests[3]!],
    ].map(([id, path, fileDigest]): SurfaceMap["nodes"][number] => ({
      id: id!,
      kind: "state",
      subject: {
        kind: "storage",
        category: "option",
        operation: "get_option",
        access: "read",
      },
      evidence: observedEvidence(path!, fileDigest!, 10),
    })),
    {
      id: sourceId,
      kind: "source",
      subject: { kind: "request-superglobal", operation: "_POST" },
      evidence: observedEvidence(paths[4]!, digests[4]!, 10),
    },
  ];
  const relations: SurfaceMap["relations"] = [
    inferredFlow("rich-state-to-sink", richStateId, richerSinkId),
    inferredFlow("source-to-rich-state", sourceId, richStateId),
    inferredFlow("poor-state-to-sink", poorStateId, poorerSinkId),
  ];
  return {
    richerSinkId,
    map: fixtureMap({
      id: `information-gain-${variant}.0.0`,
      inventory: paths.map((path, index) => indexedFile(path, digests[index]!)),
      nodes,
      relations,
    }),
  };
}

function coverageDebtMap(variant: number): {
  readonly map: SurfaceMap;
  readonly parseGapId: string;
} {
  const parseGapId = sha256Digest("php-parse-gap");
  const assetGapId = sha256Digest("javascript-asset-gap");
  const brokenDigest = `sha256:${"d".repeat(64)}`;
  const javascriptDigest = `sha256:${"e".repeat(64)}`;
  const gaps: SurfaceMap["gaps"] = [
    {
      id: parseGapId,
      kind: "parse-diagnostic",
      path: "broken.php",
      reason: "parser could not recover the executable PHP file",
      classification: "php",
    },
    {
      id: assetGapId,
      kind: "asset-not-analyzed",
      path: "assets/admin.js",
      reason: "unsupported initial static slice",
      classification: "javascript",
    },
  ];
  return {
    parseGapId,
    map: fixtureMap({
      id: `coverage-debt-${variant}.0.0`,
      inventory: [
        {
          path: "assets/admin.js",
          digest: javascriptDigest,
          size: 300,
          classification: "javascript",
          coverage: {
            status: "gap",
            reason: "unsupported-initial-static-slice",
          },
        },
        {
          path: "broken.php",
          digest: brokenDigest,
          size: 300,
          classification: "php",
          coverage: { status: "gap", reason: "php-index-missing" },
        },
      ],
      nodes: [],
      gaps,
    }),
  };
}

function policy(
  overrides: Partial<ExplorationBootstrapPolicy> = {},
): ExplorationBootstrapPolicy {
  return {
    kind: "exploration-bootstrap-policy",
    schemaVersion: 1,
    id: "first-wave-v1",
    maxFocusAreas: 6,
    maxLeases: 7,
    eligibleModelFamilies: ["claude", "gpt"],
    leaseBudget: {
      maxWallTimeMs: 900_000,
      maxModelTokens: 100_000,
      maxHypotheses: 8,
    },
    ...overrides,
  };
}

function stage(map: SurfaceMap, policyValue = policy()) {
  const mapRef: SurfaceMapRef = {
    kind: "surface-map",
    schemaVersion: 1,
    revisionKind: map.revision.kind,
    targetSnapshotId: map.targetSnapshot.id,
    mappingProfileId: map.mappingProfile.id,
    digest: sha256Digest(map),
    summary: map.summary,
  };
  const policyRef: ExplorationPolicyRef = {
    kind: "exploration-policy",
    schemaVersion: 1,
    id: policyValue.id,
    digest: sha256Digest(policyValue),
  };
  return {
    exploration: openExploration({
      surfaceMap: { ref: mapRef, value: map },
      policy: { ref: policyRef, value: policyValue },
    }),
    mapRef,
    policyRef,
  };
}

function routeAnchor(
  path: string,
  fileDigest: string,
  startLine: number,
): SourceBoundHypothesis["route"]["anchors"][number] {
  return { path, fileDigest, startLine, endLine: startLine + 4 };
}

function hypothesisFor(
  anchors: readonly SourceBoundHypothesis["route"]["anchors"][number][],
  rootCause = "missing-rest-authorization",
): SourceBoundHypothesis {
  return {
    kind: "source-bound-hypothesis",
    schemaVersion: 1,
    causalIdentity: {
      rootCause,
      attackerControlledPrimitive: "unauthenticated-rest-request",
      brokenSecurityProperty: "authorization",
    },
    attackerPremise: "unauthenticated",
    impact: "account-takeover",
    route: { anchors: [...anchors] },
    unknowns: [
      {
        claim: "callback permits a password-reset-link disclosure",
        requiredEvidence: "trace the callback response and stored identity",
      },
    ],
    falsifier: "the route requires an administrator-only capability",
    nextExperiment: "verify the route as an unauthenticated principal",
  };
}

function finderResult(
  attemptId: string,
  leaseId: string,
  hypotheses: readonly SourceBoundHypothesis[],
): { value: FinderAttemptResult; ref: AttemptExecutionResultRef } {
  const value: FinderAttemptResult = {
    kind: "finder-attempt-result",
    schemaVersion: 1,
    attemptId,
    leaseId,
    status: "completed",
    output: {
      kind: "finder-output",
      schemaVersion: 1,
      leaseId,
      hypotheses: [...hypotheses],
    },
  };
  return {
    value,
    ref: {
      kind: "attempt-execution-result",
      schemaVersion: 1,
      attemptId,
      leaseId,
      digest: sha256Digest(value),
    },
  };
}

type BoundFinderResult = ReturnType<typeof finderResult>;

function terminalResult(attemptId: string, leaseId: string): BoundFinderResult {
  const value: FinderAttemptResult = {
    kind: "finder-attempt-result",
    schemaVersion: 1,
    attemptId,
    leaseId,
    status: "cancelled",
    reason: "development-fixture-not-run",
  };
  return {
    value,
    ref: {
      kind: "attempt-execution-result",
      schemaVersion: 1,
      attemptId,
      leaseId,
      digest: sha256Digest(value),
    },
  };
}

function completeWaveResults(
  leaseIds: readonly string[],
  selected: readonly BoundFinderResult[],
): BoundFinderResult[] {
  const selectedByLease = new Map(
    selected.map((result) => [result.value.leaseId, result]),
  );
  return leaseIds.map(
    (leaseId, index) =>
      selectedByLease.get(leaseId) ??
      terminalResult(`attempt-cancelled-${index}`, leaseId),
  );
}

describe("Exploration bootstrap", () => {
  it("prioritizes a code-execution sink over lower-impact output", () => {
    const fixture = sinkPriorityMap();
    const { exploration, mapRef, policyRef } = stage(
      fixture.map,
      policy({ maxFocusAreas: 1, maxLeases: 2 }),
    );

    const decision = exploration.decide({
      kind: "bootstrap",
      map: mapRef,
      policy: policyRef,
    });

    expect(decision.kind).toBe("run-wave");
    if (decision.kind !== "run-wave") return;
    expect(decision.plan.focusAreas).toEqual([
      expect.objectContaining({
        owner: {
          kind: "surface-node",
          nodeId: fixture.codeExecutionSinkId,
          nodeKind: "sink",
        },
      }),
    ]);
  });

  it("prioritizes a target route over a stronger isolated vendor sink", () => {
    const fixture = routePriorityMap();
    const { exploration, mapRef, policyRef } = stage(
      fixture.map,
      policy({ maxFocusAreas: 2, maxLeases: 3 }),
    );

    const decision = exploration.decide({
      kind: "bootstrap",
      map: mapRef,
      policy: policyRef,
    });

    expect(decision.kind).toBe("run-wave");
    if (decision.kind !== "run-wave") return;
    const selectedNodeIds = decision.plan.focusAreas.flatMap((focus) =>
      focus.owner.kind === "surface-node" ? [focus.owner.nodeId] : [],
    );
    expect(selectedNodeIds).toContain(fixture.connectedSinkId);
    expect(selectedNodeIds).not.toContain(fixture.isolatedVendorSinkId);
  });

  it("keeps an external entry and a dangerous sink in the first three leases", () => {
    const fixture = externalEntryPortfolioMap();
    const { exploration, mapRef, policyRef } = stage(
      fixture.map,
      policy({
        eligibleModelFamilies: ["claude"],
        maxFocusAreas: 2,
        maxLeases: 3,
      }),
    );

    const decision = exploration.decide({
      kind: "bootstrap",
      map: mapRef,
      policy: policyRef,
    });

    expect(decision.kind).toBe("run-wave");
    if (decision.kind !== "run-wave") return;
    const selectedNodeIds = decision.plan.focusAreas.flatMap((focus) =>
      focus.owner.kind === "surface-node" ? [focus.owner.nodeId] : [],
    );
    expect(selectedNodeIds).toEqual(
      expect.arrayContaining([
        fixture.externalEntryId,
        fixture.codeExecutionSinkId,
      ]),
    );
    expect(selectedNodeIds).not.toContain(fixture.stateId);
    const externalFocus = decision.plan.focusAreas.find(
      (focus) =>
        focus.owner.kind === "surface-node" &&
        focus.owner.nodeId === fixture.externalEntryId,
    );
    expect(externalFocus?.risk.tier).toBe("elevated");
    expect(
      decision.plan.leases.filter(
        (lease) => lease.focusAreaId === externalFocus?.id,
      ),
    ).toHaveLength(2);
  });

  it("uses three leases for distinct ingress, server-impact, and database focus", () => {
    const fixture = impactFamilyPortfolioMap();
    const { exploration, mapRef, policyRef } = stage(
      fixture.map,
      policy({
        eligibleModelFamilies: ["claude"],
        maxFocusAreas: 3,
        maxLeases: 3,
      }),
    );

    const decision = exploration.decide({
      kind: "bootstrap",
      map: mapRef,
      policy: policyRef,
    });

    expect(decision.kind).toBe("run-wave");
    if (decision.kind !== "run-wave") return;
    const selectedNodeIds = decision.plan.focusAreas.flatMap((focus) =>
      focus.owner.kind === "surface-node" ? [focus.owner.nodeId] : [],
    );
    expect(selectedNodeIds).toEqual(
      expect.arrayContaining([
        fixture.externalEntryId,
        fixture.serverImpactSinkId,
        fixture.databaseSinkId,
      ]),
    );
    expect(decision.plan.focusAreas).toHaveLength(3);
    expect(
      new Set(decision.plan.leases.map((lease) => lease.focusAreaId)),
    ).toEqual(new Set(decision.plan.focusAreas.map((focus) => focus.id)));
  });

  it("prefers the sink whose route can resolve more security surfaces", () => {
    for (let variant = 1; variant <= 8; variant += 1) {
      const fixture = informationGainMap(variant);
      const { exploration, mapRef, policyRef } = stage(
        fixture.map,
        policy({ maxFocusAreas: 1, maxLeases: 2 }),
      );

      const decision = exploration.decide({
        kind: "bootstrap",
        map: mapRef,
        policy: policyRef,
      });

      expect(decision.kind).toBe("run-wave");
      if (decision.kind !== "run-wave") return;
      expect(decision.plan.focusAreas[0]?.owner).toEqual({
        kind: "surface-node",
        nodeId: fixture.richerSinkId,
        nodeKind: "sink",
      });
    }
  });

  it("prioritizes an executable PHP parse gap over an unsupported asset", () => {
    for (let variant = 1; variant <= 8; variant += 1) {
      const fixture = coverageDebtMap(variant);
      const { exploration, mapRef, policyRef } = stage(
        fixture.map,
        policy({ maxFocusAreas: 1, maxLeases: 2 }),
      );

      const decision = exploration.decide({
        kind: "bootstrap",
        map: mapRef,
        policy: policyRef,
      });

      expect(decision.kind).toBe("run-wave");
      if (decision.kind !== "run-wave") return;
      expect(decision.plan.focusAreas[0]?.owner).toEqual({
        kind: "coverage-gap",
        gapId: fixture.parseGapId,
        path: "broken.php",
      });
    }
  });

  it("plans a finite deterministic Work Wave with non-overlapping Focus Areas", () => {
    const { exploration, mapRef, policyRef } = stage(initialMap());
    const input = {
      kind: "bootstrap",
      map: mapRef,
      policy: policyRef,
    } as const;

    const first = exploration.decide(input);
    const second = exploration.decide(input);

    expect(second).toEqual(first);
    expect(first.kind).toBe("run-wave");
    if (first.kind !== "run-wave") return;

    expect(first.plan.focusAreas).toHaveLength(6);
    expect(first.plan.leases).toHaveLength(7);
    expect(first.plan.focusAreas.map((focus) => focus.id)).toEqual(
      [...first.plan.focusAreas.map((focus) => focus.id)].sort(),
    );
    expect(first.plan.leases.map((lease) => lease.id)).toEqual(
      [...first.plan.leases.map((lease) => lease.id)].sort(),
    );
    expect(
      new Set(first.plan.focusAreas.map((focus) => JSON.stringify(focus.owner)))
        .size,
    ).toBe(first.plan.focusAreas.length);
    expect(first.plan.focusAreas).toContainEqual(
      expect.objectContaining({
        owner: {
          kind: "source-file",
          path: "direct.php",
          fileDigest: directPhpDigest,
        },
        lane: "coverage",
      }),
    );
    expect(first.plan.leases.every((lease) => lease.role === "finder")).toBe(
      true,
    );
    expect(
      first.plan.leases.some((lease) => lease.strategy === "wildcard"),
    ).toBe(true);

    const elevated = first.plan.focusAreas.find(
      (focus) =>
        focus.risk.tier === "elevated" &&
        first.plan.leases.filter((lease) => lease.focusAreaId === focus.id)
          .length === 2,
    );
    expect(elevated).toBeDefined();
    const independentLeases = first.plan.leases.filter(
      (lease) => lease.focusAreaId === elevated?.id,
    );
    expect(new Set(independentLeases.map((lease) => lease.strategy)).size).toBe(
      independentLeases.length,
    );
    expect(
      new Set(
        independentLeases.map((lease) => lease.modelFamilyConstraint.family),
      ).size,
    ).toBe(independentLeases.length);
    expect(first.plan).toMatchObject({ map: mapRef, policy: policyRef });
  });

  it("plans four Finder leases while preserving a Wildcard lease", () => {
    const { exploration, mapRef, policyRef } = stage(
      initialMap(),
      policy({ maxFocusAreas: 3, maxLeases: 4 }),
    );

    const decision = exploration.decide({
      kind: "bootstrap",
      map: mapRef,
      policy: policyRef,
    });

    expect(decision.kind).toBe("run-wave");
    if (decision.kind !== "run-wave") return;
    expect(decision.plan.focusAreas).toHaveLength(3);
    expect(decision.plan.leases).toHaveLength(4);
    expect(
      decision.plan.leases.filter((lease) => lease.strategy === "wildcard"),
    ).toHaveLength(1);
  });

  it("records a model-separation exception when only one family is eligible", () => {
    const { exploration, mapRef, policyRef } = stage(
      initialMap(),
      policy({ eligibleModelFamilies: ["claude"] }),
    );

    const decision = exploration.decide({
      kind: "bootstrap",
      map: mapRef,
      policy: policyRef,
    });

    expect(decision.kind).toBe("run-wave");
    if (decision.kind !== "run-wave") return;
    const elevated = decision.plan.focusAreas.find(
      (focus) =>
        focus.risk.tier === "elevated" &&
        decision.plan.leases.filter((lease) => lease.focusAreaId === focus.id)
          .length === 2,
    );
    expect(elevated).toBeDefined();
    const independentLeases = decision.plan.leases.filter(
      (lease) => lease.focusAreaId === elevated?.id,
    );
    expect(independentLeases).toHaveLength(2);
    expect(new Set(independentLeases.map((lease) => lease.strategy)).size).toBe(
      2,
    );
    expect(independentLeases).toContainEqual(
      expect.objectContaining({
        modelFamilyConstraint: {
          kind: "reuse-with-exception",
          family: "claude",
          reason: "single-eligible-family",
        },
      }),
    );
  });

  it("uses an explicit asset gap as a Coverage Focus Area", () => {
    const map = initialMap();
    const gapOnlyMap: SurfaceMap = {
      ...map,
      inventory: [map.inventory[0]!],
      nodes: [],
      relations: [],
      gaps: [map.gaps[0]!],
      summary: { files: 1, nodes: 0, relations: 0, gaps: 1 },
    };
    const { exploration, mapRef, policyRef } = stage(gapOnlyMap);

    const decision = exploration.decide({
      kind: "bootstrap",
      map: mapRef,
      policy: policyRef,
    });

    expect(decision.kind).toBe("run-wave");
    if (decision.kind !== "run-wave") return;
    expect(decision.plan.focusAreas).toEqual([
      expect.objectContaining({
        owner: {
          kind: "coverage-gap",
          gapId: map.gaps[0]!.id,
          path: "assets/admin.js",
        },
        lane: "coverage",
      }),
    ]);
  });

  it("blocks an empty manifest inventory instead of inventing work", () => {
    const map = initialMap();
    const emptyMap: SurfaceMap = {
      ...map,
      inventory: [],
      nodes: [],
      relations: [],
      gaps: [],
      summary: { files: 0, nodes: 0, relations: 0, gaps: 0 },
    };
    const { exploration, mapRef, policyRef } = stage(emptyMap);

    expect(
      exploration.decide({
        kind: "bootstrap",
        map: mapRef,
        policy: policyRef,
      }),
    ).toMatchObject({
      kind: "blocked",
      gaps: [
        {
          reason: "empty-inventory",
          requiredEvidence: ["target-file-inventory"],
        },
      ],
    });
  });

  it("requests a map revision when observed evidence is outside the inventory", () => {
    const map = initialMap();
    const routeIndex = map.nodes.findIndex((node) => node.kind === "entry");
    const route = map.nodes[routeIndex]!;
    if (route.evidence.kind !== "observed") {
      throw new Error("Expected observed route fixture");
    }
    const invalidMap: SurfaceMap = {
      ...map,
      nodes: map.nodes.map((node, index) =>
        index === routeIndex
          ? {
              ...route,
              evidence: {
                kind: "observed" as const,
                evidence: [sourceAnchor("missing.php", phpDigest, 10)],
              },
            }
          : node,
      ),
    };
    const { exploration, mapRef, policyRef } = stage(invalidMap);

    expect(
      exploration.decide({
        kind: "bootstrap",
        map: mapRef,
        policy: policyRef,
      }),
    ).toMatchObject({
      kind: "revise-map",
      request: {
        reason: "minimum-map-gate-failed",
        needs: ["source-anchor-inventory-binding"],
      },
    });
  });

  it("requests a map revision for a dangling relation", () => {
    const map = initialMap();
    const invalidMap: SurfaceMap = {
      ...map,
      relations: [
        {
          ...map.relations[0]!,
          from: sha256Digest("missing-node"),
        },
      ],
    };
    const { exploration, mapRef, policyRef } = stage(invalidMap);

    expect(
      exploration.decide({
        kind: "bootstrap",
        map: mapRef,
        policy: policyRef,
      }),
    ).toMatchObject({
      kind: "revise-map",
      request: {
        reason: "minimum-map-gate-failed",
        needs: ["relation-endpoint"],
      },
    });
  });
});

describe("Exploration Finder result ingestion", () => {
  it("preserves one source-bound Hypothesis without majority support", () => {
    const map = initialMap();
    const policyValue = policy({ eligibleModelFamilies: ["claude"] });
    const staged = stage(map, policyValue);
    const bootstrap = staged.exploration.decide({
      kind: "bootstrap",
      map: staged.mapRef,
      policy: staged.policyRef,
    });
    expect(bootstrap.kind).toBe("run-wave");
    if (bootstrap.kind !== "run-wave") return;

    const lease = bootstrap.plan.leases[0];
    if (lease === undefined) {
      throw new Error("Incomplete minority Hypothesis fixture");
    }
    const hypothesis = hypothesisFor([
      routeAnchor("plugin.php", phpDigest, 11),
    ]);
    const result = finderResult("attempt-1", lease.id, [hypothesis]);
    const results = completeWaveResults(
      bootstrap.plan.leases.map((candidate) => candidate.id),
      [result],
    );
    const exploration = openExploration({
      surfaceMap: { ref: staged.mapRef, value: map },
      policy: { ref: staged.policyRef, value: policyValue },
      waveCompletion: {
        state: bootstrap.plan.state,
        wave: { ref: bootstrap.plan.ref, value: bootstrap.plan },
        results,
      },
    });

    const decision = exploration.decide({
      kind: "wave-completed",
      map: staged.mapRef,
      state: bootstrap.plan.state,
      wave: bootstrap.plan.ref,
      results: results.map((candidate) => candidate.ref),
    });

    expect(decision).toMatchObject({
      kind: "verify",
      hypotheses: [
        {
          id: sha256Digest({
            causalIdentity: hypothesis.causalIdentity,
            routeShape: { anchors: hypothesis.route.anchors },
          }),
          sourceResult: result.ref,
        },
      ],
    });
  });

  it("preserves conflicting routes with stable ordering across result arrival", () => {
    const map = initialMap();
    const policyValue = policy({ eligibleModelFamilies: ["claude"] });
    const staged = stage(map, policyValue);
    const bootstrap = staged.exploration.decide({
      kind: "bootstrap",
      map: staged.mapRef,
      policy: staged.policyRef,
    });
    if (bootstrap.kind !== "run-wave") {
      throw new Error("Expected a Work Wave fixture");
    }
    const firstLease = bootstrap.plan.leases[0];
    const secondLease = bootstrap.plan.leases[1];
    if (firstLease === undefined || secondLease === undefined) {
      throw new Error("Incomplete conflicting-route fixture");
    }
    const first = finderResult("attempt-a", firstLease.id, [
      hypothesisFor(
        [routeAnchor("plugin.php", phpDigest, 11)],
        "shared-root-cause",
      ),
    ]);
    const second = finderResult("attempt-b", secondLease.id, [
      hypothesisFor(
        [routeAnchor("direct.php", directPhpDigest, 6)],
        "shared-root-cause",
      ),
    ]);
    const allResults = completeWaveResults(
      bootstrap.plan.leases.map((candidate) => candidate.id),
      [first, second],
    );
    const decide = (results: readonly BoundFinderResult[]) =>
      openExploration({
        surfaceMap: { ref: staged.mapRef, value: map },
        policy: { ref: staged.policyRef, value: policyValue },
        waveCompletion: {
          state: bootstrap.plan.state,
          wave: { ref: bootstrap.plan.ref, value: bootstrap.plan },
          results,
        },
      }).decide({
        kind: "wave-completed",
        map: staged.mapRef,
        state: bootstrap.plan.state,
        wave: bootstrap.plan.ref,
        results: results.map((result) => result.ref),
      });

    const forward = decide(allResults);
    const reverse = decide([...allResults].reverse());

    expect(reverse).toEqual(forward);
    expect(forward).toMatchObject({ kind: "verify" });
    if (forward.kind !== "verify") return;
    expect(forward.hypotheses).toHaveLength(2);
  });

  it("admits a Hypothesis anchored to a file that owns no Surface Map node", () => {
    const map = initialMap();
    const unmappedDigest = `sha256:${"9".repeat(64)}`;
    map.inventory = [
      ...map.inventory,
      {
        path: "unmapped.php",
        digest: unmappedDigest,
        size: 120,
        classification: "php" as const,
        coverage: { status: "indexed" as const },
      },
    ].sort((left, right) => compareText(left.path, right.path));
    map.summary = { ...map.summary, files: map.inventory.length };
    expect(
      map.nodes.some(
        (node) =>
          node.evidence.kind === "observed" &&
          node.evidence.evidence.some(
            (anchor) => anchor.path === "unmapped.php",
          ),
      ),
    ).toBe(false);

    const policyValue = policy({ eligibleModelFamilies: ["claude"] });
    const staged = stage(map, policyValue);
    const bootstrap = staged.exploration.decide({
      kind: "bootstrap",
      map: staged.mapRef,
      policy: staged.policyRef,
    });
    if (bootstrap.kind !== "run-wave") {
      throw new Error("Expected a Work Wave fixture");
    }
    const lease = bootstrap.plan.leases[0];
    if (lease === undefined) throw new Error("Missing Work Lease fixture");
    const hypothesis = hypothesisFor([
      routeAnchor("unmapped.php", unmappedDigest, 12),
    ]);
    const result = finderResult("attempt-unmapped", lease.id, [hypothesis]);
    const results = completeWaveResults(
      bootstrap.plan.leases.map((candidate) => candidate.id),
      [result],
    );
    const exploration = openExploration({
      surfaceMap: { ref: staged.mapRef, value: map },
      policy: { ref: staged.policyRef, value: policyValue },
      waveCompletion: {
        state: bootstrap.plan.state,
        wave: { ref: bootstrap.plan.ref, value: bootstrap.plan },
        results,
      },
    });

    expect(
      exploration.decide({
        kind: "wave-completed",
        map: staged.mapRef,
        state: bootstrap.plan.state,
        wave: bootstrap.plan.ref,
        results: results.map((candidate) => candidate.ref),
      }),
    ).toMatchObject({
      kind: "verify",
      hypotheses: [{ digest: sha256Digest(hypothesis) }],
    });
  });

  it("rejects a Hypothesis whose source anchor is absent from the Target Snapshot", () => {
    const map = initialMap();
    const policyValue = policy({ eligibleModelFamilies: ["claude"] });
    const staged = stage(map, policyValue);
    const bootstrap = staged.exploration.decide({
      kind: "bootstrap",
      map: staged.mapRef,
      policy: staged.policyRef,
    });
    if (bootstrap.kind !== "run-wave") {
      throw new Error("Expected a Work Wave fixture");
    }
    const lease = bootstrap.plan.leases[0];
    if (lease === undefined) throw new Error("Missing Work Lease fixture");
    const result = finderResult("attempt-invalid-anchor", lease.id, [
      hypothesisFor([routeAnchor("absent.php", phpDigest, 11)]),
    ]);
    const results = completeWaveResults(
      bootstrap.plan.leases.map((candidate) => candidate.id),
      [result],
    );
    const exploration = openExploration({
      surfaceMap: { ref: staged.mapRef, value: map },
      policy: { ref: staged.policyRef, value: policyValue },
      waveCompletion: {
        state: bootstrap.plan.state,
        wave: { ref: bootstrap.plan.ref, value: bootstrap.plan },
        results,
      },
    });

    expect(
      exploration.decide({
        kind: "wave-completed",
        map: staged.mapRef,
        state: bootstrap.plan.state,
        wave: bootstrap.plan.ref,
        results: results.map((candidate) => candidate.ref),
      }),
    ).toMatchObject({
      kind: "blocked",
      gaps: [{ reason: "no-source-bound-hypothesis" }],
    });
  });

  it("rejects wave completion until every Work Lease is terminal", () => {
    const map = initialMap();
    const policyValue = policy({ eligibleModelFamilies: ["claude"] });
    const staged = stage(map, policyValue);
    const bootstrap = staged.exploration.decide({
      kind: "bootstrap",
      map: staged.mapRef,
      policy: staged.policyRef,
    });
    if (bootstrap.kind !== "run-wave") {
      throw new Error("Expected a Work Wave fixture");
    }
    const lease = bootstrap.plan.leases[0];
    if (lease === undefined) throw new Error("Missing Work Lease fixture");
    const partial = terminalResult("attempt-only-one", lease.id);

    expect(() =>
      openExploration({
        surfaceMap: { ref: staged.mapRef, value: map },
        policy: { ref: staged.policyRef, value: policyValue },
        waveCompletion: {
          state: bootstrap.plan.state,
          wave: { ref: bootstrap.plan.ref, value: bootstrap.plan },
          results: [partial],
        },
      }),
    ).toThrow("Work Wave completion requires one terminal result per Lease");
  });

  it("rejects a Work Wave whose content no longer matches its identity", () => {
    const map = initialMap();
    const policyValue = policy({ eligibleModelFamilies: ["claude"] });
    const staged = stage(map, policyValue);
    const bootstrap = staged.exploration.decide({
      kind: "bootstrap",
      map: staged.mapRef,
      policy: staged.policyRef,
    });
    if (bootstrap.kind !== "run-wave") {
      throw new Error("Expected a Work Wave fixture");
    }
    const firstLease = bootstrap.plan.leases[0];
    if (firstLease === undefined) throw new Error("Missing Work Lease fixture");
    const alteredStrategy: typeof firstLease.strategy =
      firstLease.strategy === "wildcard" ? "invariant-review" : "wildcard";
    const alteredPlan = {
      ...bootstrap.plan,
      leases: bootstrap.plan.leases.map((lease, index) =>
        index === 0 ? { ...lease, strategy: alteredStrategy } : lease,
      ),
    };
    const results = completeWaveResults(
      bootstrap.plan.leases.map((lease) => lease.id),
      [],
    );

    expect(() =>
      openExploration({
        surfaceMap: { ref: staged.mapRef, value: map },
        policy: { ref: staged.policyRef, value: policyValue },
        waveCompletion: {
          state: bootstrap.plan.state,
          wave: { ref: bootstrap.plan.ref, value: alteredPlan },
          results,
        },
      }),
    ).toThrow("Exploration Work Wave reference mismatch");
  });
});
