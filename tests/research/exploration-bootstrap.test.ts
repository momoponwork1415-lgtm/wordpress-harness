import { describe, expect, it } from "vitest";

import { sha256Digest } from "../../src/research/research-record/canonical-json.js";
import {
  openExploration,
  type ExplorationBootstrapPolicy,
  type ExplorationPolicyRef,
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

describe("Exploration bootstrap", () => {
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
      (focus) => focus.risk.tier === "elevated",
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

  it("obeys policy ceilings while preserving a Wildcard lease", () => {
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
      (focus) => focus.risk.tier === "elevated",
    );
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
