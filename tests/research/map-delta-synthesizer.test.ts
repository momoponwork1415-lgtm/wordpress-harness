import { describe, expect, it } from "vitest";

import type {
  StructuredModelExecution,
  StructuredModelProfile,
} from "../../src/research/model-execution/index.js";
import {
  openModelMapDeltaSynthesizer,
  type ContextResponse,
  type MapDeltaProposal,
  type MappingProfileRef,
  type SurfaceMap,
  type SurfaceMapRef,
} from "../../src/research/source-mapping/index.js";

const targetDigest = `sha256:${"a".repeat(64)}` as const;
const mapDigest = `sha256:${"b".repeat(64)}` as const;
const profileDigest = `sha256:${"c".repeat(64)}` as const;
const contextDigest = `sha256:${"d".repeat(64)}` as const;
const selectedNodeId = `sha256:${"3".repeat(64)}` as const;
const unrelatedNodeId = `sha256:${"4".repeat(64)}` as const;

const profile: MappingProfileRef = {
  kind: "mapping-profile",
  schemaVersion: 1,
  id: "wordpress-static-v1",
  digest: profileDigest,
  phpAnalysisProfileId: "wordpress-php-8.3-v1",
  assetPolicy: "wordpress-plugin-static-v1",
};

const predecessorRef: SurfaceMapRef = {
  kind: "surface-map",
  schemaVersion: 1,
  revisionKind: "initial",
  targetSnapshotId: "synthetic-plugin-1.0.0",
  mappingProfileId: profile.id,
  digest: mapDigest,
  summary: { files: 0, nodes: 2, relations: 0, gaps: 0 },
};

const predecessor: SurfaceMap = {
  kind: "surface-map",
  schemaVersion: 1,
  revision: { kind: "initial", number: 1, predecessor: null },
  targetSnapshot: {
    id: predecessorRef.targetSnapshotId,
    digest: targetDigest,
  },
  mappingProfile: { id: profile.id, digest: profile.digest },
  sources: {
    manifestDigest: `sha256:${"e".repeat(64)}`,
    phpProgramIndexDigest: `sha256:${"f".repeat(64)}`,
    mapDeltaReceiptDigests: [],
  },
  inventory: [],
  nodes: [
    {
      id: selectedNodeId,
      kind: "symbol",
      subject: { kind: "symbol", symbolKind: "function", name: "selected" },
      evidence: {
        kind: "observed",
        evidence: [
          {
            kind: "source-anchor",
            targetSnapshotDigest: targetDigest,
            path: "plugin.php",
            fileDigest: `sha256:${"1".repeat(64)}`,
            startLine: 1,
            endLine: 1,
            startOffset: 0,
            endOffset: 5,
          },
        ],
      },
    },
    {
      id: unrelatedNodeId,
      kind: "symbol",
      subject: { kind: "symbol", symbolKind: "function", name: "unrelated" },
      evidence: {
        kind: "observed",
        evidence: [
          {
            kind: "source-anchor",
            targetSnapshotDigest: targetDigest,
            path: "unrelated.php",
            fileDigest: `sha256:${"5".repeat(64)}`,
            startLine: 1,
            endLine: 1,
            startOffset: 0,
            endOffset: 5,
          },
        ],
      },
    },
  ],
  relations: [],
  gaps: [],
  summary: predecessorRef.summary,
};

const context: ContextResponse = {
  kind: "context-response",
  schemaVersion: 1,
  id: "context-1",
  targetSnapshot: predecessor.targetSnapshot,
  slices: [
    {
      path: "plugin.php",
      fileDigest: `sha256:${"1".repeat(64)}`,
      startOffset: 0,
      endOffset: 5,
      content: "<?php",
    },
  ],
};

const modelProfile: StructuredModelProfile = {
  provider: "test-provider",
  model: "test-model",
  transport: "test-structured-transport",
  executableVersion: "2.1.251",
  effort: "high",
  eligibilityReceiptDigest: `sha256:${"2".repeat(64)}`,
};

describe("Model Map Delta Synthesizer", () => {
  it("requests schema-constrained synthesis and returns the provider-independent proposal", async () => {
    const proposal: MapDeltaProposal = {
      kind: "map-delta-proposal",
      schemaVersion: 1,
      predecessor: predecessorRef,
      mappingProfile: profile,
      contextResponseDigests: [contextDigest],
      relations: [],
    };
    const execution: StructuredModelExecution = {
      run: async (request) => {
        expect(request).toMatchObject({
          modelProfile,
          budget: { maxWallTimeMs: 60_000, maxOutputBytes: 1_000_000 },
        });
        expect(request.outputJsonSchema).toEqual(expect.any(Object));
        expect(request.prompt).toContain("map-delta-proposal");
        expect(request.prompt).toContain(selectedNodeId);
        expect(request.prompt).not.toContain(unrelatedNodeId);
        return { status: "completed", output: proposal };
      },
    };
    const synthesizer = openModelMapDeltaSynthesizer({
      execution,
      mappingProfileDigest: profile.digest,
      modelProfile,
      budget: { maxWallTimeMs: 60_000, maxOutputBytes: 1_000_000 },
      maxPromptBytes: 1_000_000,
    });

    await expect(
      synthesizer.synthesize({
        predecessorRef,
        predecessor,
        profile,
        context: [{ digest: contextDigest, value: context }],
      }),
    ).resolves.toEqual(proposal);
  });

  it.each([
    {
      name: "provider terminal result",
      result: { status: "auth-required" as const, reason: "session-expired" },
      expectedReason: "auth-required",
    },
    {
      name: "schema-invalid output",
      result: { status: "completed" as const, output: { answer: 42 } },
      expectedReason: "invalid-output",
    },
  ])("turns $name into a bounded synthesis failure", async (testCase) => {
    const execution: StructuredModelExecution = {
      run: async () => testCase.result,
    };
    const synthesizer = openModelMapDeltaSynthesizer({
      execution,
      mappingProfileDigest: profile.digest,
      modelProfile,
      budget: { maxWallTimeMs: 60_000, maxOutputBytes: 1_000_000 },
      maxPromptBytes: 1_000_000,
    });

    await expect(
      synthesizer.synthesize({
        predecessorRef,
        predecessor,
        profile,
        context: [{ digest: contextDigest, value: context }],
      }),
    ).resolves.toEqual({
      kind: "map-delta-synthesis-failure",
      schemaVersion: 1,
      reason: testCase.expectedReason,
    });
  });

  it("stops before provider launch when the projected prompt exceeds its ceiling", async () => {
    let launched = false;
    const execution: StructuredModelExecution = {
      run: async () => {
        launched = true;
        return { status: "completed", output: {} };
      },
    };
    const synthesizer = openModelMapDeltaSynthesizer({
      execution,
      mappingProfileDigest: profile.digest,
      modelProfile,
      budget: { maxWallTimeMs: 60_000, maxOutputBytes: 1_000_000 },
      maxPromptBytes: 1,
    });

    await expect(
      synthesizer.synthesize({
        predecessorRef,
        predecessor,
        profile,
        context: [{ digest: contextDigest, value: context }],
      }),
    ).resolves.toEqual({
      kind: "map-delta-synthesis-failure",
      schemaVersion: 1,
      reason: "context-ceiling",
    });
    expect(launched).toBe(false);
  });
});
