import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { openFileJsonArtifactStore } from "../../src/research/research-record/index.js";
import {
  decodeMapDeltaReceipt,
  decodeSurfaceMap,
  openSourceMapping,
  type ContextResponse,
  type MapDeltaSynthesizer,
  type MappingProfileRef,
  type TargetFileManifest,
} from "../../src/research/source-mapping/index.js";
import type {
  PhpProgramIndex,
  PhpProgramIndexRef,
} from "../../src/research/source-mapping/php-program-index/index.js";

const target = {
  id: "synthetic-plugin-1.0.0",
  pluginSlug: "synthetic-plugin",
  version: "1.0.0",
  digest: `sha256:${"a".repeat(64)}`,
} as const;

const profile: MappingProfileRef = {
  kind: "mapping-profile",
  schemaVersion: 1,
  id: "wordpress-static-v1",
  digest: `sha256:${"e".repeat(64)}`,
  phpAnalysisProfileId: "wordpress-php-8.3-v1",
  assetPolicy: "wordpress-plugin-static-v1",
};

const manifest: TargetFileManifest = {
  kind: "target-file-manifest",
  schemaVersion: 1,
  targetSnapshot: {
    id: target.id,
    digest: target.digest,
  },
  entries: [
    {
      path: "assets/admin.js",
      digest: `sha256:${"c".repeat(64)}`,
      size: 91,
    },
    {
      path: "plugin.php",
      digest: `sha256:${"b".repeat(64)}`,
      size: 524,
    },
    {
      path: "views/panel.twig",
      digest: `sha256:${"d".repeat(64)}`,
      size: 67,
    },
  ],
};

const programIndex: PhpProgramIndex = {
  schemaVersion: 1,
  generator: {
    name: "wordpress-harness/php-program-index",
    version: "0.1.0",
    phpParserVersion: "5.8.0",
  },
  targetSnapshot: {
    id: target.id,
    digest: target.digest,
  },
  analysisProfile: {
    id: profile.phpAnalysisProfileId,
    phpVersion: "8.3",
  },
  files: [
    {
      path: "plugin.php",
      digest: `sha256:${"b".repeat(64)}`,
      symbols: [
        {
          kind: "function",
          name: "demo_register_routes",
          range: {
            startLine: 4,
            endLine: 18,
            startOffset: 40,
            endOffset: 310,
          },
        },
        {
          kind: "function",
          name: "demo_update_item",
          range: {
            startLine: 20,
            endLine: 30,
            startOffset: 312,
            endOffset: 520,
          },
        },
      ],
      calls: [],
      wordpressFacts: [
        {
          kind: "route-registration",
          namespace: "demo/v1",
          route: "/items",
          callback: "demo_update_item",
          permissionCallback: "closure",
          range: {
            startLine: 6,
            endLine: 13,
            startOffset: 80,
            endOffset: 250,
          },
        },
        {
          kind: "source",
          category: "request-parameter",
          operation: "get_param",
          range: {
            startLine: 23,
            endLine: 23,
            startOffset: 380,
            endOffset: 405,
          },
        },
        {
          kind: "storage",
          category: "option",
          operation: "update_option",
          access: "write",
          range: {
            startLine: 24,
            endLine: 24,
            startOffset: 410,
            endOffset: 455,
          },
        },
      ],
      diagnostics: [],
    },
  ],
  diagnostics: [],
};

const baseProgramSummary: PhpProgramIndexRef["summary"] = {
  files: 1,
  symbols: 2,
  calls: 0,
  wordpressFacts: 3,
  diagnostics: 0,
};

async function stageMapping(
  artifactDirectory: string,
  index: PhpProgramIndex,
  summary: PhpProgramIndexRef["summary"],
  synthesizer?: MapDeltaSynthesizer,
) {
  const artifacts = openFileJsonArtifactStore(artifactDirectory);
  const manifestDigest = await artifacts.putJson(manifest);
  const programIndexDigest = await artifacts.putJson(index);
  const mapping = openSourceMapping({
    artifactDirectory,
    source: {
      target,
      manifest: {
        kind: "target-file-manifest",
        schemaVersion: 1,
        targetSnapshotId: target.id,
        targetSnapshotDigest: target.digest,
        digest: manifestDigest,
      },
      phpProgramIndex: {
        kind: "php-program-index",
        schemaVersion: 1,
        targetSnapshotId: target.id,
        analysisProfileId: profile.phpAnalysisProfileId,
        digest: programIndexDigest,
        summary,
      },
    },
    ...(synthesizer === undefined ? {} : { synthesizer }),
  });
  return { artifacts, manifestDigest, programIndexDigest, mapping };
}

describe("Source Mapping", () => {
  it("builds a deterministic evidence-graded initial Surface Map", async () => {
    const directory = await mkdtemp(join(tmpdir(), "wordpress-surface-map-"));
    const artifactDirectory = join(directory, "artifacts");

    try {
      const { artifacts, manifestDigest, programIndexDigest, mapping } =
        await stageMapping(artifactDirectory, programIndex, baseProgramSummary);
      const input = { kind: "initial", target, profile } as const;

      const firstRef = await mapping.build(input);
      const secondRef = await mapping.build(input);
      const map = decodeSurfaceMap(await artifacts.readJson(firstRef.digest));

      expect(secondRef).toEqual(firstRef);
      expect(map).toMatchObject({
        kind: "surface-map",
        schemaVersion: 1,
        revision: { kind: "initial", number: 1, predecessor: null },
        targetSnapshot: { id: target.id, digest: target.digest },
        mappingProfile: { id: profile.id, digest: profile.digest },
        sources: {
          manifestDigest,
          phpProgramIndexDigest: programIndexDigest,
        },
      });
      expect(map.inventory).toEqual([
        {
          path: "assets/admin.js",
          digest: `sha256:${"c".repeat(64)}`,
          size: 91,
          classification: "javascript",
          coverage: {
            status: "gap",
            reason: "unsupported-initial-static-slice",
          },
        },
        {
          path: "plugin.php",
          digest: `sha256:${"b".repeat(64)}`,
          size: 524,
          classification: "php",
          coverage: { status: "indexed" },
        },
        {
          path: "views/panel.twig",
          digest: `sha256:${"d".repeat(64)}`,
          size: 67,
          classification: "template",
          coverage: {
            status: "gap",
            reason: "unsupported-initial-static-slice",
          },
        },
      ]);

      const route = map.nodes.find(
        (node) => node.subject.kind === "rest-route",
      );
      const callback = map.nodes.find(
        (node) =>
          node.subject.kind === "symbol" &&
          node.subject.name === "demo_update_item",
      );
      expect(route).toMatchObject({
        kind: "entry",
        subject: {
          kind: "rest-route",
          namespace: "demo/v1",
          route: "/items",
          callback: "demo_update_item",
        },
        evidence: {
          kind: "observed",
          evidence: [
            {
              kind: "source-anchor",
              targetSnapshotDigest: target.digest,
              path: "plugin.php",
              fileDigest: `sha256:${"b".repeat(64)}`,
              startOffset: 80,
              endOffset: 250,
            },
          ],
        },
      });
      expect(callback).toBeDefined();
      expect(map.relations).toContainEqual(
        expect.objectContaining({
          kind: "dispatches-to",
          from: route?.id,
          to: callback?.id,
          evidence: {
            kind: "inferred",
            premises: [route?.id, callback?.id].sort(),
            derivation: "deterministic",
          },
        }),
      );
      expect(map.nodes.map((node) => node.id)).toEqual(
        [...map.nodes.map((node) => node.id)].sort(),
      );
      expect(map.relations.map((relation) => relation.id)).toEqual(
        [...map.relations.map((relation) => relation.id)].sort(),
      );
      expect(
        map.gaps.map((gap) => ({
          kind: gap.kind,
          path: gap.path,
          reason: gap.reason,
        })),
      ).toEqual([
        {
          kind: "asset-not-analyzed",
          path: "assets/admin.js",
          reason: "unsupported-initial-static-slice",
        },
        {
          kind: "asset-not-analyzed",
          path: "views/panel.twig",
          reason: "unsupported-initial-static-slice",
        },
      ]);
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it("preserves observed facts while recording a parse diagnostic gap", async () => {
    const directory = await mkdtemp(join(tmpdir(), "wordpress-surface-gap-"));
    const artifactDirectory = join(directory, "artifacts");
    const diagnostic = {
      kind: "parse-error" as const,
      message: "Unexpected token near line 29",
      range: {
        startLine: 29,
        endLine: 29,
        startOffset: 490,
        endOffset: 491,
      },
    };
    const indexWithDiagnostic: PhpProgramIndex = {
      ...programIndex,
      files: [{ ...programIndex.files[0]!, diagnostics: [diagnostic] }],
      diagnostics: [{ ...diagnostic, path: "plugin.php" }],
    };

    try {
      const { artifacts, mapping } = await stageMapping(
        artifactDirectory,
        indexWithDiagnostic,
        { ...baseProgramSummary, diagnostics: 1 },
      );

      const ref = await mapping.build({ kind: "initial", target, profile });
      const map = decodeSurfaceMap(await artifacts.readJson(ref.digest));
      const diagnosticGap = map.gaps.find(
        (gap) => gap.kind === "parse-diagnostic",
      );

      expect(map.nodes.some((node) => node.subject.kind === "rest-route")).toBe(
        true,
      );
      expect(diagnosticGap).toMatchObject({
        kind: "parse-diagnostic",
        path: "plugin.php",
        classification: "php",
        reason: "Unexpected token near line 29",
        evidence: {
          kind: "source-anchor",
          targetSnapshotDigest: target.digest,
          path: "plugin.php",
          fileDigest: `sha256:${"b".repeat(64)}`,
          startOffset: 490,
          endOffset: 491,
        },
      });
      expect(ref.summary.gaps).toBe(3);
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it("creates an immutable source-only revision without a Lab", async () => {
    const directory = await mkdtemp(
      join(tmpdir(), "wordpress-surface-revision-"),
    );
    const artifactDirectory = join(directory, "artifacts");

    try {
      const { artifacts, mapping } = await stageMapping(
        artifactDirectory,
        programIndex,
        baseProgramSummary,
      );
      const initialRef = await mapping.build({
        kind: "initial",
        target,
        profile,
      });
      const initialBeforeRevision = await artifacts.readJson(initialRef.digest);
      const revisedProfile: MappingProfileRef = {
        ...profile,
        id: "wordpress-static-v2",
        digest: `sha256:${"f".repeat(64)}`,
      };

      const revisionRef = await mapping.build({
        kind: "revision",
        predecessor: initialRef,
        acceptedContext: [],
        profile: revisedProfile,
      });
      const revision = decodeSurfaceMap(
        await artifacts.readJson(revisionRef.digest),
      );

      expect(revisionRef.digest).not.toBe(initialRef.digest);
      expect(revision).toMatchObject({
        revision: {
          kind: "source",
          number: 2,
          predecessor: initialRef,
        },
        targetSnapshot: { id: target.id, digest: target.digest },
        mappingProfile: {
          id: revisedProfile.id,
          digest: revisedProfile.digest,
        },
      });
      expect(revision.inventory).toEqual(
        decodeSurfaceMap(initialBeforeRevision).inventory,
      );
      expect(await artifacts.readJson(initialRef.digest)).toEqual(
        initialBeforeRevision,
      );
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it("compiles accepted model relations into an immutable revision and records rejected claims", async () => {
    const directory = await mkdtemp(
      join(tmpdir(), "wordpress-surface-model-revision-"),
    );
    const artifactDirectory = join(directory, "artifacts");
    const synthesizer: MapDeltaSynthesizer = {
      synthesize: async (request) => {
        const source = request.predecessor.nodes.find(
          (node) => node.kind === "source",
        );
        const state = request.predecessor.nodes.find(
          (node) => node.kind === "state",
        );
        if (source === undefined || state === undefined) {
          throw new Error("Expected source and state nodes in predecessor");
        }
        return {
          kind: "map-delta-proposal",
          schemaVersion: 1,
          predecessor: request.predecessorRef,
          mappingProfile: request.profile,
          contextResponseDigests: request.context.map(
            (response) => response.digest,
          ),
          relations: [
            {
              kind: "flows-to",
              from: source.id,
              to: state.id,
              claim: "data-flow",
              premises: [source.id, state.id],
              anchors: request.context[0]!.value.slices.map(
                ({ content: _content, ...anchor }) => anchor,
              ),
              rationale: "The request value is written to persistent state.",
            },
            {
              kind: "flows-to",
              from: source.id,
              to: `sha256:${"9".repeat(64)}`,
              claim: "data-flow",
              premises: [source.id, `sha256:${"9".repeat(64)}`],
              anchors: request.context[0]!.value.slices.map(
                ({ content: _content, ...anchor }) => anchor,
              ),
              rationale: "This endpoint does not exist in the predecessor.",
            },
            {
              kind: "flows-to",
              from: source.id,
              to: state.id,
              claim: "control-flow",
              premises: [source.id, state.id],
              anchors: request.context[0]!.value.slices.map(
                ({ content: _content, ...anchor }) => ({
                  ...anchor,
                  endOffset: anchor.endOffset + 1,
                }),
              ),
              rationale: "This anchor extends beyond the accepted context.",
            },
            {
              kind: "flows-to",
              from: source.id,
              to: state.id,
              claim: "state-flow",
              premises: [source.id, `sha256:${"8".repeat(64)}`],
              anchors: request.context[0]!.value.slices.map(
                ({ content: _content, ...anchor }) => anchor,
              ),
              rationale: "This premise does not exist in the predecessor.",
            },
          ],
        };
      },
    };

    try {
      const staged = await stageMapping(
        artifactDirectory,
        programIndex,
        baseProgramSummary,
        synthesizer,
      );
      const initialRef = await staged.mapping.build({
        kind: "initial",
        target,
        profile,
      });
      const initialBeforeRevision = await staged.artifacts.readJson(
        initialRef.digest,
      );
      const context: ContextResponse = {
        kind: "context-response",
        schemaVersion: 1,
        id: "context-plugin-request-to-state",
        targetSnapshot: { id: target.id, digest: target.digest },
        slices: [
          {
            path: "plugin.php",
            fileDigest: `sha256:${"b".repeat(64)}`,
            startOffset: 380,
            endOffset: 455,
            content: "x".repeat(75),
          },
        ],
      };
      const contextDigest = await staged.artifacts.putJson(context);

      const revisionRef = await staged.mapping.build({
        kind: "revision",
        predecessor: initialRef,
        acceptedContext: [
          {
            kind: "context-response",
            schemaVersion: 1,
            id: context.id,
            digest: contextDigest,
          },
        ],
        profile,
      });
      const revision = decodeSurfaceMap(
        await staged.artifacts.readJson(revisionRef.digest),
      );
      const receiptDigest = revision.sources.mapDeltaReceiptDigests?.[0];
      if (receiptDigest === undefined) {
        throw new Error("Expected Map Delta Receipt digest");
      }
      const receipt = decodeMapDeltaReceipt(
        await staged.artifacts.readJson(receiptDigest),
      );

      expect(revision.revision).toMatchObject({
        kind: "model",
        number: 2,
        predecessor: initialRef,
      });
      expect(
        revision.relations.filter((relation) => relation.kind === "flows-to"),
      ).toEqual([
        expect.objectContaining({
          kind: "flows-to",
          claim: "data-flow",
          evidence: expect.objectContaining({
            kind: "inferred",
            derivation: "model",
          }),
        }),
      ]);
      expect(receipt).toMatchObject({
        kind: "map-delta-receipt",
        schemaVersion: 1,
        predecessor: initialRef,
        accepted: [{ proposalIndex: 0 }],
        rejected: [
          { proposalIndex: 1, reason: "endpoint-not-found" },
          { proposalIndex: 2, reason: "anchor-not-in-context" },
          { proposalIndex: 3, reason: "premise-not-found" },
        ],
      });
      expect(await staged.artifacts.readJson(initialRef.digest)).toEqual(
        initialBeforeRevision,
      );
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it("preserves the deterministic map and records a gap when model synthesis fails", async () => {
    const directory = await mkdtemp(
      join(tmpdir(), "wordpress-surface-model-failure-"),
    );
    const artifactDirectory = join(directory, "artifacts");
    const synthesizer: MapDeltaSynthesizer = {
      synthesize: async () => ({
        kind: "map-delta-synthesis-failure",
        schemaVersion: 1,
        reason: "provider-failed",
      }),
    };

    try {
      const staged = await stageMapping(
        artifactDirectory,
        programIndex,
        baseProgramSummary,
        synthesizer,
      );
      const initialRef = await staged.mapping.build({
        kind: "initial",
        target,
        profile,
      });
      const context: ContextResponse = {
        kind: "context-response",
        schemaVersion: 1,
        id: "context-model-failure",
        targetSnapshot: { id: target.id, digest: target.digest },
        slices: [
          {
            path: "plugin.php",
            fileDigest: `sha256:${"b".repeat(64)}`,
            startOffset: 380,
            endOffset: 455,
            content: "x".repeat(75),
          },
        ],
      };
      const contextDigest = await staged.artifacts.putJson(context);

      const revisionRef = await staged.mapping.build({
        kind: "revision",
        predecessor: initialRef,
        acceptedContext: [
          {
            kind: "context-response",
            schemaVersion: 1,
            id: context.id,
            digest: contextDigest,
          },
        ],
        profile,
      });
      const revision = decodeSurfaceMap(
        await staged.artifacts.readJson(revisionRef.digest),
      );
      const receiptDigest = revision.sources.mapDeltaReceiptDigests?.[0];
      if (receiptDigest === undefined) {
        throw new Error("Expected failed Map Delta Receipt digest");
      }
      const receipt = decodeMapDeltaReceipt(
        await staged.artifacts.readJson(receiptDigest),
      );

      expect(revision.revision.kind).toBe("model");
      expect(
        revision.relations.filter((relation) => relation.kind === "flows-to"),
      ).toEqual([]);
      expect(revision.gaps).toContainEqual(
        expect.objectContaining({
          kind: "mapping-incomplete",
          reason: "provider-failed",
        }),
      );
      expect(receipt).toMatchObject({
        kind: "map-delta-receipt",
        status: "failed",
        failureReason: "provider-failed",
        accepted: [],
        rejected: [],
      });
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it("produces the same model revision regardless of Context Response arrival order", async () => {
    const directory = await mkdtemp(
      join(tmpdir(), "wordpress-surface-context-order-"),
    );
    const artifactDirectory = join(directory, "artifacts");
    const synthesizer: MapDeltaSynthesizer = {
      synthesize: async (request) => ({
        kind: "map-delta-proposal",
        schemaVersion: 1,
        predecessor: request.predecessorRef,
        mappingProfile: request.profile,
        contextResponseDigests: request.context.map((item) => item.digest),
        relations: [],
      }),
    };

    try {
      const staged = await stageMapping(
        artifactDirectory,
        programIndex,
        baseProgramSummary,
        synthesizer,
      );
      const initialRef = await staged.mapping.build({
        kind: "initial",
        target,
        profile,
      });
      const contexts: ContextResponse[] = [
        {
          kind: "context-response",
          schemaVersion: 1,
          id: "context-a",
          targetSnapshot: { id: target.id, digest: target.digest },
          slices: [
            {
              path: "plugin.php",
              fileDigest: `sha256:${"b".repeat(64)}`,
              startOffset: 0,
              endOffset: 10,
              content: "a".repeat(10),
            },
          ],
        },
        {
          kind: "context-response",
          schemaVersion: 1,
          id: "context-b",
          targetSnapshot: { id: target.id, digest: target.digest },
          slices: [
            {
              path: "plugin.php",
              fileDigest: `sha256:${"b".repeat(64)}`,
              startOffset: 10,
              endOffset: 20,
              content: "b".repeat(10),
            },
          ],
        },
      ];
      const refs = await Promise.all(
        contexts.map(async (context) => ({
          kind: "context-response" as const,
          schemaVersion: 1 as const,
          id: context.id,
          digest: await staged.artifacts.putJson(context),
        })),
      );

      const reversed = await staged.mapping.build({
        kind: "revision",
        predecessor: initialRef,
        acceptedContext: [...refs].reverse(),
        profile,
      });
      const ordered = await staged.mapping.build({
        kind: "revision",
        predecessor: initialRef,
        acceptedContext: refs,
        profile,
      });

      expect(reversed).toEqual(ordered);
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it("keeps an unresolved callback relation unknown", async () => {
    const directory = await mkdtemp(
      join(tmpdir(), "wordpress-surface-unknown-"),
    );
    const artifactDirectory = join(directory, "artifacts");
    const route = programIndex.files[0]!.wordpressFacts[0]!;
    if (route.kind !== "route-registration") {
      throw new Error("Expected the synthetic route registration fixture");
    }
    const indexWithUnknownCallback: PhpProgramIndex = {
      ...programIndex,
      files: [
        {
          ...programIndex.files[0]!,
          wordpressFacts: [
            { ...route, callback: "runtime_selected_callback" },
            ...programIndex.files[0]!.wordpressFacts.slice(1),
          ],
        },
      ],
    };

    try {
      const { artifacts, mapping } = await stageMapping(
        artifactDirectory,
        indexWithUnknownCallback,
        baseProgramSummary,
      );

      const ref = await mapping.build({ kind: "initial", target, profile });
      const map = decodeSurfaceMap(await artifacts.readJson(ref.digest));
      const entry = map.nodes.find(
        (node) => node.subject.kind === "rest-route",
      );
      const relation = map.relations.find(
        (candidate) => candidate.from === entry?.id,
      );

      expect(entry?.evidence.kind).toBe("observed");
      expect(relation).toMatchObject({
        kind: "dispatches-to",
        from: entry?.id,
        to: null,
        claim: "literal-callback",
        evidence: {
          kind: "unknown",
          candidates: [],
          reason: "callback-target-unresolved",
          requiredEvidence: ["callback-target"],
        },
      });
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it("records a non-literal callback instead of silently dropping its relation", async () => {
    const directory = await mkdtemp(
      join(tmpdir(), "wordpress-surface-dynamic-callback-"),
    );
    const artifactDirectory = join(directory, "artifacts");
    const route = programIndex.files[0]!.wordpressFacts[0]!;
    if (route.kind !== "route-registration") {
      throw new Error("Expected the synthetic route registration fixture");
    }
    const indexWithDynamicCallback: PhpProgramIndex = {
      ...programIndex,
      files: [
        {
          ...programIndex.files[0]!,
          wordpressFacts: [
            { ...route, callback: null },
            ...programIndex.files[0]!.wordpressFacts.slice(1),
          ],
        },
      ],
    };

    try {
      const { artifacts, mapping } = await stageMapping(
        artifactDirectory,
        indexWithDynamicCallback,
        baseProgramSummary,
      );

      const ref = await mapping.build({ kind: "initial", target, profile });
      const map = decodeSurfaceMap(await artifacts.readJson(ref.digest));
      const entry = map.nodes.find(
        (node) => node.subject.kind === "rest-route",
      );

      expect(map.relations).toContainEqual(
        expect.objectContaining({
          kind: "dispatches-to",
          from: entry?.id,
          to: null,
          claim: "callback-target",
          evidence: {
            kind: "unknown",
            candidates: [],
            reason: "callback-not-literal",
            requiredEvidence: ["callback-expression"],
          },
        }),
      );
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it("rejects mismatched PHP Program Index reference metadata", async () => {
    const directory = await mkdtemp(
      join(tmpdir(), "wordpress-surface-identity-"),
    );
    const artifactDirectory = join(directory, "artifacts");

    try {
      const { mapping } = await stageMapping(artifactDirectory, programIndex, {
        ...baseProgramSummary,
        files: 2,
      });

      await expect(
        mapping.build({ kind: "initial", target, profile }),
      ).rejects.toThrow("PHP Program Index summary mismatch");
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it("retains predecessor claims in a source-only revision", async () => {
    const directory = await mkdtemp(
      join(tmpdir(), "wordpress-surface-claims-"),
    );
    const artifactDirectory = join(directory, "artifacts");

    try {
      const initial = await stageMapping(
        artifactDirectory,
        programIndex,
        baseProgramSummary,
      );
      const initialRef = await initial.mapping.build({
        kind: "initial",
        target,
        profile,
      });
      const reducedIndex: PhpProgramIndex = {
        ...programIndex,
        files: [
          {
            ...programIndex.files[0]!,
            wordpressFacts: programIndex.files[0]!.wordpressFacts.slice(1),
          },
        ],
      };
      const revised = await stageMapping(artifactDirectory, reducedIndex, {
        ...baseProgramSummary,
        wordpressFacts: 2,
      });

      const revisionRef = await revised.mapping.build({
        kind: "revision",
        predecessor: initialRef,
        acceptedContext: [],
        profile: { ...profile, digest: `sha256:${"f".repeat(64)}` },
      });
      const revision = decodeSurfaceMap(
        await revised.artifacts.readJson(revisionRef.digest),
      );

      expect(
        revision.nodes.some((node) => node.subject.kind === "rest-route"),
      ).toBe(true);
      expect(
        revision.relations.some(
          (relation) => relation.kind === "dispatches-to",
        ),
      ).toBe(true);
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it("keeps claim identities stable across PHP fact arrival order", async () => {
    const directory = await mkdtemp(join(tmpdir(), "wordpress-surface-order-"));
    const firstArtifactDirectory = join(directory, "first");
    const secondArtifactDirectory = join(directory, "second");
    const reorderedIndex: PhpProgramIndex = {
      ...programIndex,
      files: [
        {
          ...programIndex.files[0]!,
          symbols: [...programIndex.files[0]!.symbols].reverse(),
          wordpressFacts: [...programIndex.files[0]!.wordpressFacts].reverse(),
        },
      ],
    };

    try {
      const first = await stageMapping(
        firstArtifactDirectory,
        programIndex,
        baseProgramSummary,
      );
      const second = await stageMapping(
        secondArtifactDirectory,
        reorderedIndex,
        baseProgramSummary,
      );
      const firstRef = await first.mapping.build({
        kind: "initial",
        target,
        profile,
      });
      const secondRef = await second.mapping.build({
        kind: "initial",
        target,
        profile,
      });
      const firstMap = decodeSurfaceMap(
        await first.artifacts.readJson(firstRef.digest),
      );
      const secondMap = decodeSurfaceMap(
        await second.artifacts.readJson(secondRef.digest),
      );

      expect(secondRef.digest).not.toBe(firstRef.digest);
      expect(secondMap.inventory).toEqual(firstMap.inventory);
      expect(secondMap.nodes).toEqual(firstMap.nodes);
      expect(secondMap.relations).toEqual(firstMap.relations);
      expect(secondMap.gaps).toEqual(firstMap.gaps);
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });
});
