import { extname } from "node:path";

import { openFileJsonArtifactStore } from "../research-record/file-json-artifact-store.js";
import {
  canonicalJson,
  sha256Digest,
} from "../research-record/canonical-json.js";
import {
  phpProgramIndexSchema,
  type PhpProgramIndex,
} from "./php-program-index/index.js";
import { compileMapDelta } from "./map-delta-compiler.js";
import {
  contextResponseSchema,
  surfaceMapRefSchema,
  surfaceMapSchema,
  surfaceMappingInputSchema,
  surfaceMappingSourceSchema,
  targetFileManifestSchema,
  type ContextResponse,
  type MapDeltaSynthesizer,
  type OpenSourceMappingOptions,
  type SourceMapping,
  type SurfaceMap,
  type SurfaceMapRef,
} from "./contracts.js";

type SurfaceNode = SurfaceMap["nodes"][number];
type SurfaceSubject = SurfaceNode["subject"];
type SourceAnchor = Extract<
  SurfaceNode["evidence"],
  { kind: "observed" }
>["evidence"][number];
type AssetClassification = SurfaceMap["inventory"][number]["classification"];

function compareText(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function classifyAsset(path: string): AssetClassification {
  const segments = path.toLowerCase().split("/");
  const basename = segments.at(-1) ?? "";
  if (segments.includes("vendor") || segments.includes("node_modules")) {
    return "bundled-vendor";
  }
  if (basename.includes(".min.")) {
    return "minified";
  }
  const extension = extname(basename);
  if (extension === ".php") return "php";
  if ([".js", ".mjs", ".cjs", ".jsx"].includes(extension)) {
    return "javascript";
  }
  if ([".html", ".htm", ".twig", ".mustache"].includes(extension)) {
    return "template";
  }
  if (extension === ".sql") return "sql";
  if ([".json", ".yml", ".yaml", ".xml", ".ini"].includes(extension)) {
    return "configuration";
  }
  if ([".po", ".mo", ".pot"].includes(extension)) return "translation";
  if (
    [".png", ".jpg", ".jpeg", ".gif", ".webp", ".zip", ".pdf"].includes(
      extension,
    )
  ) {
    return "binary";
  }
  return "unsupported";
}

function summarizeProgramIndex(index: PhpProgramIndex) {
  return {
    files: index.files.length,
    symbols: index.files.reduce(
      (count, file) => count + file.symbols.length,
      0,
    ),
    calls: index.files.reduce((count, file) => count + file.calls.length, 0),
    wordpressFacts: index.files.reduce(
      (count, file) => count + file.wordpressFacts.length,
      0,
    ),
    diagnostics: index.diagnostics.length,
  };
}

function targetsMatch(
  left: OpenSourceMappingOptions["source"]["target"],
  right: OpenSourceMappingOptions["source"]["target"],
): boolean {
  return canonicalJson(left) === canonicalJson(right);
}

function anchorFor(
  targetDigest: string,
  file: PhpProgramIndex["files"][number],
  range: PhpProgramIndex["files"][number]["symbols"][number]["range"],
): SourceAnchor {
  return {
    kind: "source-anchor",
    targetSnapshotDigest: targetDigest,
    path: file.path,
    fileDigest: file.digest,
    startLine: range.startLine,
    endLine: range.endLine,
    startOffset: range.startOffset,
    endOffset: range.endOffset,
  };
}

function anchorIdentity(anchor: SourceAnchor): object {
  return {
    targetSnapshotDigest: anchor.targetSnapshotDigest,
    path: anchor.path,
    fileDigest: anchor.fileDigest,
    startOffset: anchor.startOffset,
    endOffset: anchor.endOffset,
  };
}

function nodeFor(
  kind: SurfaceNode["kind"],
  subject: SurfaceSubject,
  anchor: SourceAnchor,
): SurfaceNode {
  return {
    id: sha256Digest({
      kind,
      subject,
      anchor: anchorIdentity(anchor),
    }),
    kind,
    subject,
    evidence: { kind: "observed", evidence: [anchor] },
  };
}

function factNode(
  fact: PhpProgramIndex["files"][number]["wordpressFacts"][number],
  anchor: SourceAnchor,
): SurfaceNode {
  switch (fact.kind) {
    case "hook-registration":
      return nodeFor(
        "entry",
        { kind: "hook", hook: fact.hook, callback: fact.callback },
        anchor,
      );
    case "route-registration":
      return nodeFor(
        "entry",
        {
          kind: "rest-route",
          namespace: fact.namespace,
          route: fact.route,
          callback: fact.callback,
          permissionCallback: fact.permissionCallback,
        },
        anchor,
      );
    case "guard":
      return nodeFor(
        "guard",
        {
          kind: "guard",
          category: fact.category,
          operation: fact.operation,
        },
        anchor,
      );
    case "source":
      return nodeFor(
        "source",
        fact.category === "request-parameter"
          ? { kind: "request-parameter", operation: fact.operation }
          : { kind: "request-superglobal", operation: fact.operation },
        anchor,
      );
    case "storage":
      return nodeFor(
        "state",
        {
          kind: "storage",
          category: fact.category,
          operation: fact.operation,
          access: fact.access,
        },
        anchor,
      );
    case "sink":
      switch (fact.category) {
        case "html-output":
          return nodeFor(
            "sink",
            { kind: "html-output", operation: fact.operation },
            anchor,
          );
        case "database-query":
          return nodeFor(
            "sink",
            { kind: "database-query", operation: fact.operation },
            anchor,
          );
        case "filesystem-write":
          return nodeFor(
            "sink",
            { kind: "filesystem-write", operation: fact.operation },
            anchor,
          );
        case "code-execution":
          return nodeFor(
            "sink",
            { kind: "code-execution", operation: fact.operation },
            anchor,
          );
        case "process-execution":
          return nodeFor(
            "sink",
            { kind: "process-execution", operation: fact.operation },
            anchor,
          );
      }
  }
}

class StaticSourceMapping implements SourceMapping {
  readonly #artifacts;
  readonly #source;
  readonly #synthesizer: MapDeltaSynthesizer | undefined;

  constructor(options: OpenSourceMappingOptions) {
    this.#artifacts = openFileJsonArtifactStore(options.artifactDirectory);
    this.#source = surfaceMappingSourceSchema.parse(options.source);
    this.#synthesizer = options.synthesizer;
  }

  async build(
    input: Parameters<SourceMapping["build"]>[0],
  ): Promise<SurfaceMapRef> {
    const parsedInput = surfaceMappingInputSchema.parse(input);
    let revision: SurfaceMap["revision"];
    let predecessorMap: SurfaceMap | undefined;
    if (parsedInput.kind === "initial") {
      if (!targetsMatch(parsedInput.target, this.#source.target)) {
        throw new Error("Surface Mapping target does not match bound source");
      }
      revision = { kind: "initial", number: 1, predecessor: null };
    } else {
      const predecessor = surfaceMapRefSchema.parse(parsedInput.predecessor);
      predecessorMap = surfaceMapSchema.parse(
        await this.#artifacts.readJson(predecessor.digest),
      );
      this.#validatePredecessor(predecessor, predecessorMap);
      revision = {
        kind: "source",
        number: predecessorMap.revision.number + 1,
        predecessor,
      };
    }
    const target =
      parsedInput.kind === "initial" ? parsedInput.target : this.#source.target;

    const manifest = targetFileManifestSchema.parse(
      await this.#artifacts.readJson(this.#source.manifest.digest),
    );
    const programIndex = phpProgramIndexSchema.parse(
      await this.#artifacts.readJson(this.#source.phpProgramIndex.digest),
    );
    this.#validateSources(manifest, programIndex, parsedInput.profile);
    const acceptedContext =
      parsedInput.kind === "revision"
        ? (
            await Promise.all(
              parsedInput.acceptedContext.map(async (ref) => {
                const value = contextResponseSchema.parse(
                  await this.#artifacts.readJson(ref.digest),
                );
                this.#validateContextResponse(ref.id, value, manifest);
                return { digest: ref.digest, value };
              }),
            )
          ).sort((left, right) => compareText(left.digest, right.digest))
        : [];

    const indexedFiles = new Map(
      programIndex.files.map((file) => [file.path, file] as const),
    );
    const inventory: SurfaceMap["inventory"] = manifest.entries
      .map((entry): SurfaceMap["inventory"][number] => {
        const classification = classifyAsset(entry.path);
        if (indexedFiles.has(entry.path)) {
          return { ...entry, classification, coverage: { status: "indexed" } };
        }
        return {
          ...entry,
          classification,
          coverage: {
            status: "gap",
            reason:
              classification === "php"
                ? "php-index-missing"
                : "unsupported-initial-static-slice",
          },
        };
      })
      .sort((left, right) => compareText(left.path, right.path));

    const nodesById = new Map<string, SurfaceNode>();
    const callbackNodes = new Map<string, SurfaceNode[]>();
    const entryCallbacks: Array<{
      readonly entry: SurfaceNode;
      readonly callback: string | null;
    }> = [];
    for (const file of programIndex.files) {
      for (const symbol of file.symbols) {
        const node = nodeFor(
          "symbol",
          { kind: "symbol", symbolKind: symbol.kind, name: symbol.name },
          anchorFor(target.digest, file, symbol.range),
        );
        nodesById.set(node.id, node);
        const matchingNodes = callbackNodes.get(symbol.name) ?? [];
        matchingNodes.push(node);
        callbackNodes.set(symbol.name, matchingNodes);
      }
      for (const fact of file.wordpressFacts) {
        const node = factNode(fact, anchorFor(target.digest, file, fact.range));
        nodesById.set(node.id, node);
        if (
          fact.kind === "hook-registration" ||
          fact.kind === "route-registration"
        ) {
          entryCallbacks.push({ entry: node, callback: fact.callback });
        }
      }
    }

    const relations: SurfaceMap["relations"] = [];
    for (const candidate of entryCallbacks) {
      if (candidate.callback === null) {
        relations.push({
          id: sha256Digest({
            kind: "dispatches-to",
            from: candidate.entry.id,
            callback: null,
            claim: "callback-target",
          }),
          kind: "dispatches-to",
          from: candidate.entry.id,
          to: null,
          claim: "callback-target",
          evidence: {
            kind: "unknown",
            candidates: [],
            reason: "callback-not-literal",
            requiredEvidence: ["callback-expression"],
          },
        });
        continue;
      }
      const callbacks = (callbackNodes.get(candidate.callback) ?? []).sort(
        (left, right) => compareText(left.id, right.id),
      );
      if (callbacks.length === 1) {
        const callback = callbacks[0]!;
        relations.push({
          id: sha256Digest({
            kind: "dispatches-to",
            from: candidate.entry.id,
            to: callback.id,
            claim: "literal-callback",
          }),
          kind: "dispatches-to",
          from: candidate.entry.id,
          to: callback.id,
          claim: "literal-callback",
          evidence: {
            kind: "inferred",
            premises: [candidate.entry.id, callback.id].sort(compareText),
            derivation: "deterministic",
          },
        });
        continue;
      }
      const candidateIds = callbacks.map((callback) => callback.id);
      relations.push({
        id: sha256Digest({
          kind: "dispatches-to",
          from: candidate.entry.id,
          callback: candidate.callback,
          candidates: candidateIds,
          claim: "literal-callback",
        }),
        kind: "dispatches-to",
        from: candidate.entry.id,
        to: null,
        claim: "literal-callback",
        evidence: {
          kind: "unknown",
          candidates: candidateIds,
          reason:
            candidateIds.length === 0
              ? "callback-target-unresolved"
              : "callback-target-ambiguous",
          requiredEvidence: ["callback-target"],
        },
      });
    }

    const gaps: SurfaceMap["gaps"] = inventory.flatMap((entry) => {
      if (entry.coverage.status !== "gap") return [];
      return [
        {
          id: sha256Digest({
            kind: "asset-not-analyzed",
            path: entry.path,
            digest: entry.digest,
            classification: entry.classification,
            reason: entry.coverage.reason,
          }),
          kind: "asset-not-analyzed" as const,
          path: entry.path,
          reason: entry.coverage.reason,
          classification: entry.classification,
        },
      ];
    });
    for (const diagnostic of programIndex.diagnostics) {
      const file = indexedFiles.get(diagnostic.path);
      if (file === undefined) {
        throw new Error(
          `PHP Program Index diagnostic file mismatch: ${diagnostic.path}`,
        );
      }
      const evidence = anchorFor(target.digest, file, diagnostic.range);
      gaps.push({
        id: sha256Digest({
          kind: "parse-diagnostic",
          diagnosticKind: diagnostic.kind,
          message: diagnostic.message,
          anchor: anchorIdentity(evidence),
        }),
        kind: "parse-diagnostic",
        path: diagnostic.path,
        reason: diagnostic.message,
        classification: classifyAsset(diagnostic.path),
        evidence,
      });
    }
    if (predecessorMap !== undefined) {
      for (const node of predecessorMap.nodes) {
        if (!nodesById.has(node.id)) nodesById.set(node.id, node);
      }
      const relationIds = new Set(relations.map((relation) => relation.id));
      for (const relation of predecessorMap.relations) {
        if (!relationIds.has(relation.id)) {
          relations.push(relation);
          relationIds.add(relation.id);
        }
      }
      const gapIds = new Set(gaps.map((gap) => gap.id));
      for (const gap of predecessorMap.gaps) {
        if (!gapIds.has(gap.id)) {
          gaps.push(gap);
          gapIds.add(gap.id);
        }
      }
    }

    let mapDeltaReceiptDigest: string | undefined;
    if (acceptedContext.length > 0) {
      if (
        parsedInput.kind !== "revision" ||
        predecessorMap === undefined ||
        this.#synthesizer === undefined
      ) {
        throw new Error("Map Delta synthesis is not configured");
      }
      const compiled = await compileMapDelta({
        artifacts: this.#artifacts,
        synthesizer: this.#synthesizer,
        predecessorRef: parsedInput.predecessor,
        predecessor: predecessorMap,
        profile: parsedInput.profile,
        context: acceptedContext,
        nodeIds: new Set(nodesById.keys()),
        existingRelationIds: new Set(relations.map((relation) => relation.id)),
      });
      relations.push(...compiled.relations);
      gaps.push(...compiled.gaps);
      mapDeltaReceiptDigest = compiled.receiptDigest;
      revision = compiled.revision;
    }

    const nodes = [...nodesById.values()].sort((left, right) =>
      compareText(left.id, right.id),
    );
    relations.sort((left, right) => compareText(left.id, right.id));
    gaps.sort((left, right) => {
      const leftPath = "path" in left ? left.path : "";
      const rightPath = "path" in right ? right.path : "";
      return compareText(leftPath, rightPath) || compareText(left.id, right.id);
    });
    const summary = {
      files: inventory.length,
      nodes: nodes.length,
      relations: relations.length,
      gaps: gaps.length,
    };
    const map = surfaceMapSchema.parse({
      kind: "surface-map",
      schemaVersion: 1,
      revision,
      targetSnapshot: {
        id: target.id,
        digest: target.digest,
      },
      mappingProfile: {
        id: parsedInput.profile.id,
        digest: parsedInput.profile.digest,
      },
      sources: {
        manifestDigest: this.#source.manifest.digest,
        phpProgramIndexDigest: this.#source.phpProgramIndex.digest,
        mapDeltaReceiptDigests: [
          ...(predecessorMap?.sources.mapDeltaReceiptDigests ?? []),
          ...(mapDeltaReceiptDigest === undefined
            ? []
            : [mapDeltaReceiptDigest]),
        ],
      },
      inventory,
      nodes,
      relations,
      gaps,
      summary,
    });
    const digest = await this.#artifacts.putJson(map);
    return {
      kind: "surface-map",
      schemaVersion: 1,
      revisionKind: revision.kind,
      targetSnapshotId: target.id,
      mappingProfileId: parsedInput.profile.id,
      digest,
      summary,
    };
  }

  #validateSources(
    manifest: ReturnType<typeof targetFileManifestSchema.parse>,
    programIndex: PhpProgramIndex,
    profile: Parameters<SourceMapping["build"]>[0]["profile"],
  ): void {
    const target = this.#source.target;
    if (
      this.#source.manifest.targetSnapshotId !== target.id ||
      this.#source.manifest.targetSnapshotDigest !== target.digest ||
      manifest.targetSnapshot.id !== target.id ||
      manifest.targetSnapshot.digest !== target.digest ||
      this.#source.phpProgramIndex.targetSnapshotId !== target.id ||
      programIndex.targetSnapshot.id !== target.id ||
      programIndex.targetSnapshot.digest !== target.digest
    ) {
      throw new Error("Surface Mapping source identity mismatch");
    }
    if (
      this.#source.phpProgramIndex.analysisProfileId !==
        profile.phpAnalysisProfileId ||
      programIndex.analysisProfile.id !== profile.phpAnalysisProfileId
    ) {
      throw new Error("Surface Mapping PHP analysis profile mismatch");
    }
    if (
      canonicalJson(this.#source.phpProgramIndex.summary) !==
      canonicalJson(summarizeProgramIndex(programIndex))
    ) {
      throw new Error("PHP Program Index summary mismatch");
    }

    const entries = new Map<string, string>();
    for (const entry of manifest.entries) {
      if (entries.has(entry.path)) {
        throw new Error(`Duplicate manifest path: ${entry.path}`);
      }
      entries.set(entry.path, entry.digest);
    }
    for (const file of programIndex.files) {
      if (entries.get(file.path) !== file.digest) {
        throw new Error(`PHP Program Index file mismatch: ${file.path}`);
      }
    }
  }

  #validatePredecessor(ref: SurfaceMapRef, map: SurfaceMap): void {
    const expectedRevisionKind = map.revision.kind;
    if (
      ref.revisionKind !== expectedRevisionKind ||
      ref.targetSnapshotId !== map.targetSnapshot.id ||
      ref.mappingProfileId !== map.mappingProfile.id ||
      canonicalJson(ref.summary) !== canonicalJson(map.summary) ||
      map.targetSnapshot.id !== this.#source.target.id ||
      map.targetSnapshot.digest !== this.#source.target.digest ||
      map.sources.manifestDigest !== this.#source.manifest.digest
    ) {
      throw new Error("Surface Map predecessor identity mismatch");
    }
  }

  #validateContextResponse(
    expectedId: string,
    response: ContextResponse,
    manifest: ReturnType<typeof targetFileManifestSchema.parse>,
  ): void {
    if (
      response.id !== expectedId ||
      response.targetSnapshot.id !== this.#source.target.id ||
      response.targetSnapshot.digest !== this.#source.target.digest
    ) {
      throw new Error("Context Response identity mismatch");
    }
    const entries = new Map(
      manifest.entries.map((entry) => [entry.path, entry]),
    );
    for (const slice of response.slices) {
      const entry = entries.get(slice.path);
      if (
        entry === undefined ||
        entry.digest !== slice.fileDigest ||
        slice.endOffset <= slice.startOffset ||
        slice.endOffset > entry.size ||
        Buffer.byteLength(slice.content, "utf8") !==
          slice.endOffset - slice.startOffset
      ) {
        throw new Error(`Invalid Context Response slice: ${slice.path}`);
      }
    }
  }
}

export function openStaticSourceMapping(
  options: OpenSourceMappingOptions,
): SourceMapping {
  return new StaticSourceMapping(options);
}
