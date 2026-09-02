import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  openToolFreeFinderAttemptMaterializer,
  type AttemptPlanMaterializationInput,
} from "../../src/research/index.js";
import { sha256Digest } from "../../src/research/research-record/canonical-json.js";
import type {
  SurfaceMap,
  SurfaceMapRef,
} from "../../src/research/source-mapping/index.js";
import type {
  PhpProgramIndex,
  PhpProgramIndexRef,
} from "../../src/research/source-mapping/php-program-index/index.js";

const digest = (character: string): string => `sha256:${character.repeat(64)}`;

function fileDigest(content: string): string {
  return `sha256:${createHash("sha256").update(content).digest("hex")}`;
}

async function fixture(options?: {
  readonly focus?: "entry" | "sink";
  readonly includeLiteralReference?: boolean;
  readonly maxFiles?: number;
  readonly strategy?: "sink-backward" | "wildcard";
}) {
  const directory = await mkdtemp(join(tmpdir(), "finder-materializer-"));
  const sourceDirectory = join(directory, "target");
  await mkdir(join(sourceDirectory, "includes"), { recursive: true });
  await mkdir(join(sourceDirectory, "views"), { recursive: true });
  const handler =
    options?.includeLiteralReference === false
      ? "<?php\nfunction route_handler() {\n  // template is resolved late\n  echo $_POST['value'];\n}\n"
      : "<?php\nfunction route_handler() {\n  $template = 'review-view';\n  echo $_POST['value'];\n}\n";
  const files = {
    "entry.php":
      "<?php\nfunction route_entry() {\n  route_handler();\n  return render('review-view');\n}\n",
    "includes/handler.php": handler,
    "includes/unrelated.php": "<?php // UNRELATED_SECRET_MARKER\n",
    "views/review-view.php":
      "<?php\n$persisted_value = get_option('persisted');\necho $persisted_value;\n",
  } as const;
  await Promise.all(
    Object.entries(files).map(([path, content]) =>
      writeFile(join(sourceDirectory, path), content),
    ),
  );
  const targetDigest = digest("1");
  const nodeId = sha256Digest("entry-node");
  const sourceNodeId = sha256Digest("source-node");
  const sinkNodeId = sha256Digest("sink-node");
  const stateNodeId = sha256Digest("state-node");
  const programIndex: PhpProgramIndex = {
    schemaVersion: 1,
    generator: {
      name: "wordpress-harness/php-program-index",
      version: "0.1.0",
      phpParserVersion: "5.7.0",
    },
    targetSnapshot: { id: "sample-1.0.0", digest: targetDigest },
    analysisProfile: { id: "php-static-8.3-v1", phpVersion: "8.3" },
    files: [
      {
        path: "entry.php",
        digest: fileDigest(files["entry.php"]),
        symbols: [
          {
            kind: "function",
            name: "route_entry",
            range: {
              startLine: 2,
              endLine: 4,
              startOffset: 6,
              endOffset: 59,
            },
          },
        ],
        calls: [
          {
            kind: "function",
            caller: "route_entry",
            callee: "route_handler",
            range: {
              startLine: 3,
              endLine: 3,
              startOffset: 40,
              endOffset: 55,
            },
          },
        ],
        wordpressFacts: [],
        diagnostics: [],
      },
      {
        path: "includes/handler.php",
        digest: fileDigest(files["includes/handler.php"]),
        symbols: [
          {
            kind: "function",
            name: "route_handler",
            range: {
              startLine: 2,
              endLine: 5,
              startOffset: 6,
              endOffset: 88,
            },
          },
        ],
        calls: [],
        wordpressFacts: [
          {
            kind: "source",
            category: "request-superglobal",
            operation: "_POST",
            range: {
              startLine: 4,
              endLine: 4,
              startOffset: 72,
              endOffset: 77,
            },
          },
          {
            kind: "sink",
            category: "html-output",
            operation: "echo",
            range: {
              startLine: 4,
              endLine: 4,
              startOffset: 67,
              endOffset: 83,
            },
          },
        ],
        diagnostics: [],
      },
      {
        path: "includes/unrelated.php",
        digest: fileDigest(files["includes/unrelated.php"]),
        symbols: [],
        calls: [],
        wordpressFacts: [],
        diagnostics: [],
      },
      {
        path: "views/review-view.php",
        digest: fileDigest(files["views/review-view.php"]),
        symbols: [],
        calls: [],
        wordpressFacts: [
          {
            kind: "storage",
            category: "option",
            operation: "get_option",
            access: "read",
            range: {
              startLine: 2,
              endLine: 2,
              startOffset: 24,
              endOffset: 34,
            },
          },
        ],
        diagnostics: [],
      },
    ],
    diagnostics: [],
  };
  const programIndexRef: PhpProgramIndexRef = {
    kind: "php-program-index",
    schemaVersion: 1,
    targetSnapshotId: programIndex.targetSnapshot.id,
    analysisProfileId: programIndex.analysisProfile.id,
    digest: sha256Digest(programIndex),
    summary: {
      files: 4,
      symbols: 2,
      calls: 1,
      wordpressFacts: 3,
      diagnostics: 0,
    },
  };
  const map: SurfaceMap = {
    kind: "surface-map",
    schemaVersion: 1,
    revision: { kind: "initial", number: 1, predecessor: null },
    targetSnapshot: { id: "sample-1.0.0", digest: targetDigest },
    mappingProfile: { id: "wordpress-static-v1", digest: digest("2") },
    sources: {
      manifestDigest: digest("3"),
      phpProgramIndexDigest: programIndexRef.digest,
    },
    inventory: Object.entries(files).map(([path, content]) => ({
      path,
      digest: fileDigest(content),
      size: Buffer.byteLength(content),
      classification: "php" as const,
      coverage: { status: "indexed" as const },
    })),
    nodes: [
      {
        id: nodeId,
        kind: "entry",
        subject: {
          kind: "hook",
          hook: "wp_ajax_nopriv_sample",
          callback: "route_entry",
        },
        evidence: {
          kind: "observed",
          evidence: [
            {
              kind: "source-anchor",
              targetSnapshotDigest: targetDigest,
              path: "entry.php",
              fileDigest: fileDigest(files["entry.php"]),
              startLine: 2,
              endLine: 2,
              startOffset: 6,
              endOffset: 20,
            },
          ],
        },
      },
      {
        id: sourceNodeId,
        kind: "source",
        subject: { kind: "request-superglobal", operation: "_POST" },
        evidence: {
          kind: "observed",
          evidence: [
            {
              kind: "source-anchor",
              targetSnapshotDigest: targetDigest,
              path: "includes/handler.php",
              fileDigest: fileDigest(files["includes/handler.php"]),
              startLine: 4,
              endLine: 4,
              startOffset: 72,
              endOffset: 77,
            },
          ],
        },
      },
      {
        id: sinkNodeId,
        kind: "sink",
        subject: { kind: "html-output", operation: "echo" },
        evidence: {
          kind: "observed",
          evidence: [
            {
              kind: "source-anchor",
              targetSnapshotDigest: targetDigest,
              path: "includes/handler.php",
              fileDigest: fileDigest(files["includes/handler.php"]),
              startLine: 4,
              endLine: 4,
              startOffset: 67,
              endOffset: 83,
            },
          ],
        },
      },
      {
        id: stateNodeId,
        kind: "state",
        subject: {
          kind: "storage",
          category: "option",
          operation: "get_option",
          access: "read",
        },
        evidence: {
          kind: "observed",
          evidence: [
            {
              kind: "source-anchor",
              targetSnapshotDigest: targetDigest,
              path: "views/review-view.php",
              fileDigest: fileDigest(files["views/review-view.php"]),
              startLine: 2,
              endLine: 2,
              startOffset: 24,
              endOffset: 34,
            },
          ],
        },
      },
    ],
    relations: [],
    gaps: [],
    summary: { files: 4, nodes: 4, relations: 0, gaps: 0 },
  };
  const mapRef: SurfaceMapRef = {
    kind: "surface-map",
    schemaVersion: 1,
    revisionKind: "initial",
    targetSnapshotId: map.targetSnapshot.id,
    mappingProfileId: map.mappingProfile.id,
    digest: sha256Digest(map),
    summary: map.summary,
  };
  const sinkFocus = options?.focus === "sink";
  const focusArea = {
    id: sha256Digest("focus"),
    owner: {
      kind: "surface-node" as const,
      nodeId: sinkFocus ? sinkNodeId : nodeId,
      nodeKind: sinkFocus ? ("sink" as const) : ("entry" as const),
    },
    lane: sinkFocus ? ("primitive" as const) : ("frontier" as const),
    brief: {
      feature: "hook" as const,
      actor: "unresolved" as const,
      requiredPrivilege: "unresolved" as const,
      stateTransition: "unresolved" as const,
      securityInvariant: "entry-authorization-and-input-handling" as const,
    },
    risk: {
      tier: "elevated" as const,
      basis: sinkFocus
        ? ("security-sensitive-sink" as const)
        : ("registered-hook" as const),
    },
  };
  const lease = {
    id: sha256Digest("lease"),
    focusAreaId: focusArea.id,
    role: "finder" as const,
    lane: sinkFocus ? ("primitive" as const) : ("frontier" as const),
    strategy: sinkFocus
      ? (options?.strategy ?? ("sink-backward" as const))
      : ("entry-forward" as const),
    modelFamilyConstraint: { kind: "require" as const, family: "claude" },
    budget: {
      maxWallTimeMs: 120_000,
      maxModelTokens: 20_000,
      maxHypotheses: 4,
    },
  };
  const mapPolicy = {
    kind: "exploration-policy" as const,
    schemaVersion: 1 as const,
    id: "policy-v1",
    digest: digest("4"),
  };
  const wave = {
    kind: "work-wave-plan" as const,
    schemaVersion: 1 as const,
    id: sha256Digest("wave"),
    ref: {
      kind: "work-wave" as const,
      schemaVersion: 1 as const,
      id: sha256Digest("wave"),
      digest: sha256Digest("wave"),
      mapDigest: mapRef.digest,
    },
    state: {
      kind: "exploration-state" as const,
      schemaVersion: 1 as const,
      digest: digest("5"),
      mapDigest: mapRef.digest,
      policyDigest: mapPolicy.digest,
    },
    map: mapRef,
    policy: mapPolicy,
    focusAreas: [focusArea],
    leases: [lease],
  };
  const modelProfileRef = {
    kind: "model-profile" as const,
    schemaVersion: 1 as const,
    id: "claude-opus-finder-high-v1",
    digest: digest("6"),
    family: "claude",
  };
  const promptSet = {
    kind: "prompt-set" as const,
    schemaVersion: 1 as const,
    id: "tool-free-finder-v1",
    digest: digest("7"),
  };
  const input: AttemptPlanMaterializationInput = {
    run: {
      runId: "run:test",
      finder: { modelProfile: modelProfileRef, promptSet },
      maxWallTimeMs: 300_000,
      maxModelTokens: 50_000,
    },
    attemptOrdinal: 1,
    targetSnapshot: {
      id: "sample-1.0.0",
      pluginSlug: "sample",
      version: "1.0.0",
      digest: targetDigest,
    },
    surfaceMap: map,
    wave,
    focusArea,
    lease,
  };
  const materializer = openToolFreeFinderAttemptMaterializer({
    sourceDirectory,
    surfaceMap: { ref: mapRef, value: map },
    phpProgramIndex: { ref: programIndexRef, value: programIndex },
    modelProfile: {
      ref: modelProfileRef,
      execution: {
        provider: "anthropic",
        model: "claude-opus-5",
        transport: "claude-code-process",
        executableVersion: "2.1.251",
        effort: "high",
        eligibilityReceiptDigest: digest("8"),
      },
    },
    promptSet,
    maxSourceBytes: 128 * 1024,
    maxFileBytes: 64 * 1024,
    maxFiles: options?.maxFiles ?? 8,
    maxOutputBytes: 256 * 1024,
  });
  return {
    cleanup: () => rm(directory, { recursive: true, force: true }),
    input,
    materializer,
    sourceDirectory,
  };
}

describe("ToolFreeFinderAttemptMaterializer.materialize", () => {
  it("uses a broad mapped surface sample when wildcard has no direct context", async () => {
    const wildcard = await fixture({
      focus: "sink",
      includeLiteralReference: false,
      maxFiles: 2,
      strategy: "wildcard",
    });
    try {
      const materialization = await wildcard.materializer.materialize(
        wildcard.input,
      );

      expect(materialization.prompt).toContain("views/review-view.php");
      expect(materialization.prompt).not.toContain("entry.php");
      expect(materialization.prompt).toContain('"reason":"surface-sample"');
    } finally {
      await wildcard.cleanup();
    }
  });

  it("gives wildcard and sink-backward distinct context for the same sink", async () => {
    const wildcard = await fixture({
      focus: "sink",
      maxFiles: 2,
      strategy: "wildcard",
    });
    try {
      const materialization = await wildcard.materializer.materialize(
        wildcard.input,
      );

      expect(materialization.prompt).toContain("includes/handler.php");
      expect(materialization.prompt).toContain("views/review-view.php");
      expect(materialization.prompt).not.toContain("entry.php");
      expect(materialization.prompt).toContain('"reason":"surface-sample"');
    } finally {
      await wildcard.cleanup();
    }
  });

  it("prioritizes a sink caller over a weak literal-reference candidate", async () => {
    const test = await fixture({ focus: "sink", maxFiles: 2 });
    try {
      const materialization = await test.materializer.materialize(test.input);

      expect(materialization.prompt).toContain('"kind":"analysis-unit"');
      expect(materialization.prompt).toContain('"reason":"call-neighbor"');
      expect(materialization.prompt).toContain(
        "Selection reasons describe context retrieval, not reachability evidence.",
      );
      expect(materialization.prompt).toContain("includes/handler.php");
      expect(materialization.prompt).toContain("entry.php");
      expect(materialization.prompt).not.toContain("views/review-view.php");
    } finally {
      await test.cleanup();
    }
  });

  it("renders a deterministic oracle-free slice from the Focus Area and call neighbors", async () => {
    const test = await fixture();
    try {
      const first = await test.materializer.materialize(test.input);
      const second = await test.materializer.materialize(test.input);

      expect(second).toEqual(first);
      expect(first.prompt).toContain("entry.php");
      expect(first.prompt).toContain("route_entry");
      expect(first.prompt).toContain("includes/handler.php");
      expect(first.prompt).toContain("route_handler");
      expect(first.prompt).toContain("views/review-view.php");
      expect(first.prompt).toContain("persisted_value");
      expect(first.prompt).not.toContain("UNRELATED_SECRET_MARKER");
      expect(first.modelProfile.model).toBe("claude-opus-5");
    } finally {
      await test.cleanup();
    }
  });

  it("rejects source changed after indexing", async () => {
    const test = await fixture();
    await writeFile(
      join(test.sourceDirectory, "entry.php"),
      "<?php // changed after indexing\n",
    );
    try {
      await expect(test.materializer.materialize(test.input)).rejects.toThrow(
        "Finder source digest mismatch",
      );
    } finally {
      await test.cleanup();
    }
  });
});
