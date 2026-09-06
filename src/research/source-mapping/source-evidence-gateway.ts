import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { lstat, readFile, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { TextDecoder } from "node:util";
import { z } from "zod";

import type { JsonArtifactStore } from "../research-record/contracts.js";
import {
  canonicalJson,
  sha256Digest,
} from "../research-record/canonical-json.js";
import {
  openVerifiedArtifacts,
  type VerifiedArtifacts,
} from "../research-record/verified-artifacts.js";
import {
  targetFileManifestRefSchema,
  targetFileManifestSchema,
  type TargetFileManifest,
  type TargetFileManifestRef,
} from "./contracts.js";
import {
  sourceEvidenceQuerySchema,
  sourceListSelectorSchema,
  sourceListResponseV2Schema,
  sourceSearchSelectorV2Schema,
  sourceSearchResponseV2Schema,
  sourceReadSelectorV2Schema,
  sourceReadResponseV2Schema,
  sourceEvidenceReceiptRefSchema,
  sourceEvidenceReceiptRefV2Schema,
  sourceEvidenceReceiptValueSchema,
  sourceEvidenceReceiptValueV2Schema,
  sourceInventoryResponseSchema,
  sourceRangeResponseSchema,
  sourceSearchResponseSchema,
  sourceToolPolicyRefSchema,
  sourceToolPolicySchema,
  type SearchSnapshotQuery,
  type ListSnapshotFilesQuery,
  type SourceEvidenceGateway,
  type SourceEvidencePolicyDecision,
  type SourceEvidenceQuery,
  type SourceEvidenceQueryV1,
  type SourceEvidenceQueryV2,
  type SourceEvidencePolicyDecisionV2,
  type SourceEvidenceReceipt,
  type SourceEvidenceReceiptV2,
  type SourceEvidenceResponse,
  type SourceEvidenceResult,
  type SourceEvidenceResultV2,
  type SourceInventoryResponse,
  type SourceRangeResponse,
  type SourceSearchResponse,
  type SourceToolPolicy,
  type SourceToolPolicyRef,
} from "./source-evidence-contracts.js";

const digestSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const listCursorPayloadSchema = z.strictObject({
  schemaVersion: z.literal(2),
  operation: z.literal("list"),
  targetSnapshotDigest: digestSchema,
  manifestDigest: digestSchema,
  policyDigest: digestSchema,
  assignmentDigest: digestSchema,
  selector: sourceListSelectorSchema,
  nextIndex: z.number().int().nonnegative(),
});

type ListCursorPayload = z.infer<typeof listCursorPayloadSchema>;
const searchCursorPayloadSchema = z.strictObject({
  schemaVersion: z.literal(2),
  operation: z.literal("search"),
  targetSnapshotDigest: digestSchema,
  manifestDigest: digestSchema,
  policyDigest: digestSchema,
  assignmentDigest: digestSchema,
  selector: sourceSearchSelectorV2Schema,
  entryIndex: z.number().int().nonnegative(),
  offset: z.number().int().nonnegative(),
  matchesSeen: z.number().int().nonnegative(),
});

type SearchCursorPayload = z.infer<typeof searchCursorPayloadSchema>;
const readCursorPayloadSchema = z.strictObject({
  schemaVersion: z.literal(2),
  operation: z.literal("read"),
  targetSnapshotDigest: digestSchema,
  manifestDigest: digestSchema,
  policyDigest: digestSchema,
  assignmentDigest: digestSchema,
  selector: sourceReadSelectorV2Schema,
  rangeStartOffset: z.number().int().nonnegative(),
  rangeEndOffset: z.number().int().nonnegative(),
  nextOffset: z.number().int().nonnegative(),
});

type ReadCursorPayload = z.infer<typeof readCursorPayloadSchema>;

export interface OpenSourceEvidenceGatewayOptions {
  readonly sourceDirectory: string;
  readonly artifactStore: JsonArtifactStore;
  readonly manifest: {
    readonly ref: TargetFileManifestRef;
    readonly value: TargetFileManifest;
  };
  readonly policy: {
    readonly ref: SourceToolPolicyRef;
    readonly value: SourceToolPolicy;
  };
}

interface SourceLine {
  readonly startOffset: number;
  readonly endOffset: number;
}

type SourceEntryFailureReason =
  "path-outside-snapshot" | "file-digest-mismatch";

class SourceEntryFailure extends Error {
  readonly reason: SourceEntryFailureReason;

  constructor(reason: SourceEntryFailureReason) {
    super(reason);
    this.name = "SourceEntryFailure";
    this.reason = reason;
  }
}

function rawDigest(content: Buffer): string {
  return `sha256:${createHash("sha256").update(content).digest("hex")}`;
}

function isNormalizedRelativePath(path: string): boolean {
  return (
    !isAbsolute(path) &&
    !path.includes("\\") &&
    path
      .split("/")
      .every((segment) => segment !== "" && segment !== "." && segment !== "..")
  );
}

function isNormalizedDirectoryPrefix(prefix: string): boolean {
  return prefix.endsWith("/") && isNormalizedRelativePath(prefix.slice(0, -1));
}

function escapesSourceRoot(path: string): boolean {
  return isAbsolute(path) || path.split("/").includes("..");
}

function sourceLines(content: Buffer): readonly SourceLine[] {
  const lines: SourceLine[] = [];
  let startOffset = 0;
  for (let index = 0; index < content.byteLength; index += 1) {
    if (content[index] !== 0x0a) continue;
    const endOffset =
      index > startOffset && content[index - 1] === 0x0d ? index - 1 : index;
    lines.push({ startOffset, endOffset });
    startOffset = index + 1;
  }
  lines.push({ startOffset, endOffset: content.byteLength });
  return lines;
}

function decodeUtf8Prefix(content: Buffer, maxBytes: number): Buffer {
  let end = Math.min(content.byteLength, maxBytes);
  const decoder = new TextDecoder("utf-8", { fatal: true });
  while (end >= 0) {
    const prefix = content.subarray(0, end);
    try {
      decoder.decode(prefix);
      return prefix;
    } catch {
      end -= 1;
    }
  }
  return Buffer.alloc(0);
}

class SnapshotSourceEvidenceGateway implements SourceEvidenceGateway {
  readonly policy: SourceToolPolicyRef;
  readonly #sourceDirectory: string;
  readonly #artifacts: VerifiedArtifacts;
  readonly #manifestRef: TargetFileManifestRef;
  readonly #manifest: TargetFileManifest;
  readonly #policyValue: SourceToolPolicy;
  readonly #cursorKey = randomBytes(32);

  constructor(options: OpenSourceEvidenceGatewayOptions) {
    if (!isAbsolute(options.sourceDirectory)) {
      throw new Error("Source Evidence root must be absolute");
    }
    this.#sourceDirectory = resolve(options.sourceDirectory);
    this.#artifacts = openVerifiedArtifacts(options.artifactStore);
    this.#manifestRef = targetFileManifestRefSchema.parse(options.manifest.ref);
    this.#manifest = targetFileManifestSchema.parse(options.manifest.value);
    this.policy = sourceToolPolicyRefSchema.parse(options.policy.ref);
    this.#policyValue = sourceToolPolicySchema.parse(options.policy.value);
    this.#validateBindings();
  }

  async query(
    requestInput: SourceEvidenceQueryV1,
  ): Promise<SourceEvidenceReceipt>;
  async query(
    requestInput: SourceEvidenceQueryV2,
  ): Promise<SourceEvidenceReceiptV2>;
  async query(
    requestInput: SourceEvidenceQuery,
  ): Promise<SourceEvidenceReceipt | SourceEvidenceReceiptV2> {
    const request = sourceEvidenceQuerySchema.parse(requestInput);
    if (request.schemaVersion === 2) return this.#queryV2(request);
    if (
      request.budget !== undefined &&
      request.budget.queryOrdinal > request.budget.maxQueries
    ) {
      return this.#storeReceipt(
        request,
        {
          outcome: "denied",
          reason: "query-budget-exhausted",
        },
        {
          status: "budget-exhausted",
          reason: "source-query-limit-exceeded",
        },
        null,
      );
    }
    const deniedReason = this.#deniedReason(request);
    if (deniedReason !== undefined) {
      return this.#policyDenied(request, deniedReason);
    }
    if (request.kind === "search-snapshot") return this.#search(request);
    if (request.kind === "list-snapshot-files") {
      return this.#listFiles(request);
    }
    return this.#readRange(request);
  }

  async #queryV2(
    request: SourceEvidenceQueryV2,
  ): Promise<SourceEvidenceReceiptV2> {
    const operation = this.#operationV2(request);
    if (
      request.assignment.kind === "research-thesis" &&
      (request.assignment.thesis.targetSnapshotDigest !==
        request.targetSnapshot.digest ||
        request.assignment.thesis.manifestDigest !== request.manifest.digest)
    ) {
      return this.#invalidQueryV2(request, "assignment-mismatch");
    }
    if (request.queryOrdinal > request.budget.maxQueries) {
      return this.#storeReceiptV2(
        request,
        operation,
        { outcome: "denied", reason: "query-budget-exhausted" },
        {
          status: "budget-exhausted",
          reason: "source-query-limit-exceeded",
        },
        { files: 0, bytes: 0, matches: 0 },
        null,
      );
    }
    const deniedReason = this.#deniedReasonV2(request);
    if (deniedReason !== undefined) {
      return this.#storeReceiptV2(
        request,
        operation,
        { outcome: "denied", reason: deniedReason },
        { status: "policy-denied", reason: deniedReason },
        { files: 0, bytes: 0, matches: 0 },
        null,
      );
    }
    const operationAllowed =
      request.kind === "source-list"
        ? this.#policyValue.operations.inventory !== undefined
        : request.kind === "source-search"
          ? this.#policyValue.operations.search !== undefined
          : this.#policyValue.operations.read !== undefined;
    if (!operationAllowed) {
      return this.#storeReceiptV2(
        request,
        operation,
        { outcome: "denied", reason: "operation-not-allowed" },
        { status: "policy-denied", reason: "operation-not-allowed" },
        { files: 0, bytes: 0, matches: 0 },
        null,
      );
    }
    if (request.kind === "source-list") return this.#listV2(request);
    if (request.kind === "source-search") return this.#searchV2(request);
    return this.#readV2(request);
  }

  async #listV2(
    request: Extract<SourceEvidenceQueryV2, { kind: "source-list" }>,
  ): Promise<SourceEvidenceReceiptV2> {
    if (request.selector !== undefined && request.cursor !== undefined) {
      return this.#invalidQueryV2(request, "selector-cursor-conflict");
    }
    if (request.selector === undefined && request.cursor === undefined) {
      return this.#invalidQueryV2(request, "selector-or-cursor-required");
    }

    let selector = request.selector;
    let startIndex = 0;
    if (request.cursor !== undefined) {
      const decoded = this.#decodeListCursor(request.cursor);
      if (
        decoded === undefined ||
        decoded.targetSnapshotDigest !== request.targetSnapshot.digest ||
        decoded.manifestDigest !== request.manifest.digest ||
        decoded.policyDigest !== request.policy.digest ||
        decoded.assignmentDigest !== sha256Digest(request.assignment)
      ) {
        return this.#invalidQueryV2(request, "invalid-cursor");
      }
      selector = decoded.selector;
      startIndex = decoded.nextIndex;
    }
    if (selector === undefined) {
      return this.#invalidQueryV2(request, "invalid-cursor");
    }
    if (
      selector.scope.kind === "directory" &&
      escapesSourceRoot(selector.scope.path)
    ) {
      return this.#policyDeniedV2(request, "path-outside-snapshot");
    }
    if (
      selector.scope.kind === "directory" &&
      !isNormalizedRelativePath(selector.scope.path)
    ) {
      return this.#invalidQueryV2(request, "invalid-path");
    }

    const entries = this.#listEntries(selector);
    if (entries === undefined) {
      return this.#storeReceiptV2(
        request,
        "list",
        { outcome: "allowed", reason: "list-allowed" },
        { status: "not-found", reason: "directory-not-found" },
        { files: 0, bytes: 0, matches: 0 },
        null,
      );
    }
    if (startIndex >= entries.length && entries.length > 0) {
      return this.#invalidQueryV2(request, "invalid-cursor");
    }
    const pageSize = this.#policyValue.operations.inventory?.maxResults ?? 0;
    const page = entries.slice(startIndex, startIndex + pageSize);
    const nextIndex = startIndex + page.length;
    const hasNext = nextIndex < entries.length;
    const nextCursor = hasNext
      ? this.#encodeListCursor({
          schemaVersion: 2,
          operation: "list",
          targetSnapshotDigest: request.targetSnapshot.digest,
          manifestDigest: request.manifest.digest,
          policyDigest: request.policy.digest,
          assignmentDigest: sha256Digest(request.assignment),
          selector,
          nextIndex,
        })
      : undefined;
    const response = sourceListResponseV2Schema.parse({
      kind: "source-list-response",
      schemaVersion: 2,
      scope: selector.scope,
      traversal: selector.traversal,
      entries: page,
      ...(nextCursor === undefined ? {} : { nextCursor }),
    });
    const responseDigest = await this.#artifacts.put(
      "Source List response",
      response,
    );
    return this.#storeReceiptV2(
      request,
      "list",
      { outcome: "allowed", reason: "list-allowed" },
      nextCursor === undefined
        ? { status: "completed", responseDigest }
        : {
            status: "partial",
            reason: "page-limit",
            responseDigest,
            continuationDigest: sha256Digest({ nextCursor }),
          },
      {
        files: page.filter((entry) => entry.kind === "file").length,
        bytes: 0,
        matches: 0,
      },
      response,
    );
  }

  #operationV2(request: SourceEvidenceQueryV2): "list" | "search" | "read" {
    return request.kind === "source-list"
      ? "list"
      : request.kind === "source-search"
        ? "search"
        : "read";
  }

  #listEntries(selector: z.infer<typeof sourceListSelectorSchema>):
    | readonly (
        | { readonly kind: "directory"; readonly path: string }
        | {
            readonly kind: "file";
            readonly path: string;
            readonly fileDigest: string;
            readonly size: number;
          }
      )[]
    | undefined {
    const directory =
      selector.scope.kind === "root" ? undefined : selector.scope.path;
    const prefix = directory === undefined ? "" : `${directory}/`;
    const files = this.#manifest.entries
      .filter((entry) => entry.path.startsWith(prefix))
      .sort((left, right) => compareText(left.path, right.path));
    if (directory !== undefined && files.length === 0) return undefined;
    if (selector.traversal === "recursive") {
      return files.map((entry) => ({
        kind: "file" as const,
        path: entry.path,
        fileDigest: entry.digest,
        size: entry.size,
      }));
    }

    const children = new Map<
      string,
      | { readonly kind: "directory"; readonly path: string }
      | {
          readonly kind: "file";
          readonly path: string;
          readonly fileDigest: string;
          readonly size: number;
        }
    >();
    for (const entry of files) {
      const remainder = entry.path.slice(prefix.length);
      const slash = remainder.indexOf("/");
      if (slash >= 0) {
        const childPath = `${prefix}${remainder.slice(0, slash)}`;
        children.set(childPath, { kind: "directory", path: childPath });
      } else {
        children.set(entry.path, {
          kind: "file",
          path: entry.path,
          fileDigest: entry.digest,
          size: entry.size,
        });
      }
    }
    return [...children.values()].sort((left, right) =>
      compareText(left.path, right.path),
    );
  }

  async #searchV2(
    request: Extract<SourceEvidenceQueryV2, { kind: "source-search" }>,
  ): Promise<SourceEvidenceReceiptV2> {
    if (request.selector !== undefined && request.cursor !== undefined) {
      return this.#invalidQueryV2(request, "selector-cursor-conflict");
    }
    if (request.selector === undefined && request.cursor === undefined) {
      return this.#invalidQueryV2(request, "selector-or-cursor-required");
    }

    let selector = request.selector;
    let entryIndex = 0;
    let offset = 0;
    let matchesSeen = 0;
    if (request.cursor !== undefined) {
      const decoded = this.#decodeSearchCursor(request.cursor);
      if (
        decoded === undefined ||
        decoded.targetSnapshotDigest !== request.targetSnapshot.digest ||
        decoded.manifestDigest !== request.manifest.digest ||
        decoded.policyDigest !== request.policy.digest ||
        decoded.assignmentDigest !== sha256Digest(request.assignment)
      ) {
        return this.#invalidQueryV2(request, "invalid-cursor");
      }
      selector = decoded.selector;
      entryIndex = decoded.entryIndex;
      offset = decoded.offset;
      matchesSeen = decoded.matchesSeen;
    }
    if (selector === undefined) {
      return this.#invalidQueryV2(request, "invalid-cursor");
    }
    const searchPaths =
      selector.scope.kind === "root"
        ? []
        : selector.scope.kind === "directory"
          ? [selector.scope.path]
          : selector.scope.paths;
    if (searchPaths.some(escapesSourceRoot)) {
      return this.#policyDeniedV2(request, "path-outside-snapshot");
    }
    if (searchPaths.some((path) => !isNormalizedRelativePath(path))) {
      return this.#invalidQueryV2(request, "invalid-path");
    }
    const selected = this.#searchEntries(selector);
    if (selected.kind === "invalid") {
      return this.#invalidQueryV2(request, "invalid-path");
    }
    if (selected.kind === "not-found") {
      return this.#storeReceiptV2(
        request,
        "search",
        { outcome: "allowed", reason: "search-allowed" },
        { status: "not-found", reason: selected.reason },
        { files: 0, bytes: 0, matches: 0 },
        null,
      );
    }
    const entries = selected.entries;
    if (entryIndex >= entries.length && entries.length > 0) {
      return this.#invalidQueryV2(request, "invalid-cursor");
    }

    const policy = this.#policyValue.operations.search;
    if (policy === undefined) {
      throw new Error("Search policy disappeared after admission");
    }
    const literal = Buffer.from(selector.literal, "utf8");
    const matches: z.infer<typeof sourceSearchResponseV2Schema>["matches"] = [];
    let scannedFiles = 0;
    let scannedBytes = 0;
    let next: { readonly entryIndex: number; readonly offset: number } | null =
      null;

    while (entryIndex < entries.length) {
      const entry = entries[entryIndex];
      if (entry === undefined) break;
      const remaining = policy.maxScanBytes - scannedBytes;
      if (remaining <= 0) {
        next = { entryIndex, offset };
        break;
      }
      let content: Buffer;
      try {
        content = await this.#loadEntry(entry);
      } catch (error: unknown) {
        if (error instanceof SourceEntryFailure) {
          return this.#sourceEntryFailureV2(request, "search", error.reason);
        }
        throw error;
      }
      if (offset > content.byteLength) {
        return this.#invalidQueryV2(request, "invalid-cursor");
      }
      scannedFiles += 1;
      const scanEnd = Math.min(content.byteLength, offset + remaining);
      let position = offset;
      while (position < scanEnd) {
        const found = content.indexOf(literal, position);
        if (found < 0 || found + literal.byteLength > scanEnd) break;
        matches.push({
          anchor: {
            kind: "source-anchor",
            targetSnapshotDigest: this.#manifest.targetSnapshot.digest,
            path: entry.path,
            fileDigest: entry.digest,
            startLine: 1 + countNewlines(content.subarray(0, found)),
            endLine: 1 + countNewlines(content.subarray(0, found)),
            startOffset: found,
            endOffset: found + literal.byteLength,
          },
        });
        position = found + literal.byteLength;
        if (matches.length >= policy.maxResults) {
          scannedBytes += position - offset;
          next =
            position < content.byteLength
              ? { entryIndex, offset: position }
              : entryIndex + 1 < entries.length
                ? { entryIndex: entryIndex + 1, offset: 0 }
                : null;
          break;
        }
      }
      if (matches.length >= policy.maxResults) break;
      scannedBytes += scanEnd - offset;
      if (scanEnd < content.byteLength) {
        next = {
          entryIndex,
          offset: Math.max(
            offset + 1,
            scanEnd - Math.max(0, literal.byteLength - 1),
          ),
        };
        break;
      }
      entryIndex += 1;
      offset = 0;
    }

    const hasNext = next !== null;
    const nextCursor =
      next === null
        ? undefined
        : this.#encodeSearchCursor({
            schemaVersion: 2,
            operation: "search",
            targetSnapshotDigest: request.targetSnapshot.digest,
            manifestDigest: request.manifest.digest,
            policyDigest: request.policy.digest,
            assignmentDigest: sha256Digest(request.assignment),
            selector,
            entryIndex: next.entryIndex,
            offset: next.offset,
            matchesSeen: matchesSeen + matches.length,
          });
    const response = sourceSearchResponseV2Schema.parse({
      kind: "source-search-response",
      schemaVersion: 2,
      literal: selector.literal,
      scope: selector.scope,
      scanned: { files: scannedFiles, bytes: scannedBytes },
      matches,
      ...(nextCursor === undefined ? {} : { nextCursor }),
    });
    const responseDigest = await this.#artifacts.put(
      "Source Search response",
      response,
    );
    const result: SourceEvidenceResultV2 = hasNext
      ? {
          status: "partial",
          reason:
            matches.length >= policy.maxResults ? "page-limit" : "scan-limit",
          responseDigest,
          continuationDigest: sha256Digest({ nextCursor }),
        }
      : matchesSeen + matches.length === 0
        ? {
            status: "not-found",
            reason: "literal-not-found",
            responseDigest,
          }
        : { status: "completed", responseDigest };
    return this.#storeReceiptV2(
      request,
      "search",
      { outcome: "allowed", reason: "search-allowed" },
      result,
      { files: scannedFiles, bytes: scannedBytes, matches: matches.length },
      response,
    );
  }

  #searchEntries(selector: z.infer<typeof sourceSearchSelectorV2Schema>):
    | {
        readonly kind: "ok";
        readonly entries: readonly TargetFileManifest["entries"][number][];
      }
    | {
        readonly kind: "not-found";
        readonly reason: "directory-not-found" | "file-not-found";
      }
    | { readonly kind: "invalid" } {
    if (selector.scope.kind === "root") {
      return {
        kind: "ok",
        entries: [...this.#manifest.entries].sort((left, right) =>
          compareText(left.path, right.path),
        ),
      };
    }
    if (selector.scope.kind === "directory") {
      if (!isNormalizedRelativePath(selector.scope.path)) {
        return { kind: "invalid" };
      }
      const prefix = `${selector.scope.path}/`;
      const entries = this.#manifest.entries
        .filter((entry) => entry.path.startsWith(prefix))
        .sort((left, right) => compareText(left.path, right.path));
      return entries.length === 0
        ? { kind: "not-found", reason: "directory-not-found" }
        : { kind: "ok", entries };
    }
    if (selector.scope.paths.some((path) => !isNormalizedRelativePath(path))) {
      return { kind: "invalid" };
    }
    const selectedPaths = new Set(selector.scope.paths);
    const entries = this.#manifest.entries
      .filter((entry) => selectedPaths.has(entry.path))
      .sort((left, right) => compareText(left.path, right.path));
    return entries.length !== selectedPaths.size
      ? { kind: "not-found", reason: "file-not-found" }
      : { kind: "ok", entries };
  }

  async #readV2(
    request: Extract<SourceEvidenceQueryV2, { kind: "source-read" }>,
  ): Promise<SourceEvidenceReceiptV2> {
    if (request.selector !== undefined && request.cursor !== undefined) {
      return this.#invalidQueryV2(request, "selector-cursor-conflict");
    }
    if (request.selector === undefined && request.cursor === undefined) {
      return this.#invalidQueryV2(request, "selector-or-cursor-required");
    }

    let selector = request.selector;
    let rangeStartOffset: number | undefined;
    let rangeEndOffset: number | undefined;
    let nextOffset: number | undefined;
    if (request.cursor !== undefined) {
      const decoded = this.#decodeReadCursor(request.cursor);
      if (
        decoded === undefined ||
        decoded.targetSnapshotDigest !== request.targetSnapshot.digest ||
        decoded.manifestDigest !== request.manifest.digest ||
        decoded.policyDigest !== request.policy.digest ||
        decoded.assignmentDigest !== sha256Digest(request.assignment)
      ) {
        return this.#invalidQueryV2(request, "invalid-cursor");
      }
      selector = decoded.selector;
      rangeStartOffset = decoded.rangeStartOffset;
      rangeEndOffset = decoded.rangeEndOffset;
      nextOffset = decoded.nextOffset;
    }
    if (selector === undefined) {
      return this.#invalidQueryV2(request, "invalid-cursor");
    }
    if (escapesSourceRoot(selector.path)) {
      return this.#policyDeniedV2(request, "path-outside-snapshot");
    }
    if (!isNormalizedRelativePath(selector.path)) {
      return this.#invalidQueryV2(request, "invalid-path");
    }
    const entry = this.#manifest.entries.find(
      (candidate) => candidate.path === selector.path,
    );
    if (entry === undefined) {
      return this.#storeReceiptV2(
        request,
        "read",
        { outcome: "allowed", reason: "read-allowed" },
        { status: "not-found", reason: "file-not-found" },
        { files: 0, bytes: 0, matches: 0 },
        null,
      );
    }
    if (entry.digest !== selector.fileDigest) {
      return this.#storeReceiptV2(
        request,
        "read",
        { outcome: "allowed", reason: "read-allowed" },
        { status: "identity-mismatch", reason: "file-digest-mismatch" },
        { files: 0, bytes: 0, matches: 0 },
        null,
      );
    }
    let content: Buffer;
    try {
      content = await this.#loadEntry(entry);
    } catch (error: unknown) {
      if (error instanceof SourceEntryFailure) {
        return this.#sourceEntryFailureV2(request, "read", error.reason);
      }
      throw error;
    }

    if (
      rangeStartOffset === undefined ||
      rangeEndOffset === undefined ||
      nextOffset === undefined
    ) {
      const lines = sourceLines(content);
      const start = lines[selector.startLine - 1];
      if (start === undefined) {
        return this.#storeReceiptV2(
          request,
          "read",
          { outcome: "allowed", reason: "read-allowed" },
          { status: "not-found", reason: "range-not-found" },
          { files: 1, bytes: 0, matches: 0 },
          null,
        );
      }
      const requestedEndLine = Math.min(selector.endLine, lines.length);
      const end = lines[requestedEndLine - 1];
      if (end === undefined) {
        throw new Error("Source range end could not be resolved");
      }
      rangeStartOffset = start.startOffset;
      rangeEndOffset = end.endOffset;
      nextOffset = rangeStartOffset;
    }
    if (
      rangeStartOffset > nextOffset ||
      nextOffset > rangeEndOffset ||
      rangeEndOffset > content.byteLength
    ) {
      return this.#invalidQueryV2(request, "invalid-cursor");
    }

    const requested = content.subarray(nextOffset, rangeEndOffset);
    const selected = decodeUtf8Prefix(
      requested,
      this.#policyValue.operations.read.maxResponseBytes,
    );
    if (selected.byteLength === 0 && requested.byteLength > 0) {
      throw new Error("Source read policy cannot return one UTF-8 code point");
    }
    const endOffset = nextOffset + selected.byteLength;
    const hasNext = endOffset < rangeEndOffset;
    const nextCursor = hasNext
      ? this.#encodeReadCursor({
          schemaVersion: 2,
          operation: "read",
          targetSnapshotDigest: request.targetSnapshot.digest,
          manifestDigest: request.manifest.digest,
          policyDigest: request.policy.digest,
          assignmentDigest: sha256Digest(request.assignment),
          selector,
          rangeStartOffset,
          rangeEndOffset,
          nextOffset: endOffset,
        })
      : undefined;
    const startLine = 1 + countNewlines(content.subarray(0, nextOffset));
    const response = sourceReadResponseV2Schema.parse({
      kind: "source-read-response",
      schemaVersion: 2,
      anchor: {
        kind: "source-anchor",
        targetSnapshotDigest: this.#manifest.targetSnapshot.digest,
        path: entry.path,
        fileDigest: entry.digest,
        startLine,
        endLine: startLine + countNewlines(selected),
        startOffset: nextOffset,
        endOffset,
      },
      bytes: selected.byteLength,
      content: selected.toString("utf8"),
      ...(nextCursor === undefined ? {} : { nextCursor }),
    });
    const responseDigest = await this.#artifacts.put(
      "Source Read response",
      response,
    );
    return this.#storeReceiptV2(
      request,
      "read",
      { outcome: "allowed", reason: "read-allowed" },
      nextCursor === undefined
        ? { status: "completed", responseDigest }
        : {
            status: "partial",
            reason: "response-limit",
            responseDigest,
            continuationDigest: sha256Digest({ nextCursor }),
          },
      { files: 1, bytes: selected.byteLength, matches: 0 },
      response,
    );
  }

  async #listFiles(
    request: ListSnapshotFilesQuery,
  ): Promise<SourceEvidenceReceipt> {
    const inventoryPolicy = this.#policyValue.operations.inventory;
    if (inventoryPolicy === undefined) {
      return this.#policyDenied(request, "operation-not-allowed");
    }
    const prefix = request.subject.prefix;
    const matching = this.#manifest.entries
      .filter((entry) => prefix === undefined || entry.path.startsWith(prefix))
      .sort((left, right) => compareText(left.path, right.path));
    const truncated = matching.length > inventoryPolicy.maxResults;
    const files: SourceInventoryResponse["files"] = matching
      .slice(0, inventoryPolicy.maxResults)
      .map((entry) => ({
        path: entry.path,
        fileDigest: entry.digest,
        size: entry.size,
      }));
    const response = sourceInventoryResponseSchema.parse({
      kind: "source-inventory-response",
      schemaVersion: 1,
      ...(prefix === undefined ? {} : { prefix }),
      files,
    });
    return this.#respond(
      request,
      { outcome: "allowed", reason: "inventory-allowed" },
      truncated ? "truncated" : "completed",
      response,
    );
  }

  async #readRange(
    request: Extract<SourceEvidenceQuery, { kind: "read-source-range" }>,
  ): Promise<SourceEvidenceReceipt> {
    const entry = this.#manifest.entries.find(
      (candidate) => candidate.path === request.subject.path,
    );
    if (entry === undefined) {
      return this.#policyDenied(request, "path-outside-snapshot");
    }
    if (entry.digest !== request.subject.fileDigest) {
      return this.#policyDenied(request, "file-digest-mismatch");
    }
    let content: Buffer;
    try {
      content = await this.#loadEntry(entry);
    } catch (error: unknown) {
      if (error instanceof SourceEntryFailure) {
        return this.#policyDenied(request, error.reason);
      }
      throw error;
    }

    const lines = sourceLines(content);
    const start = lines[request.subject.startLine - 1];
    if (start === undefined) {
      return this.#storeReceipt(
        request,
        { outcome: "allowed", reason: "read-allowed" },
        { status: "not-found", reason: "start-line-out-of-range" },
        null,
      );
    }
    const requestedEndLine = Math.min(request.subject.endLine, lines.length);
    const end = lines[requestedEndLine - 1];
    if (end === undefined) {
      throw new Error("Source range end could not be resolved");
    }
    const requestedContent = content.subarray(start.startOffset, end.endOffset);
    const selectedContent = decodeUtf8Prefix(
      requestedContent,
      this.#policyValue.operations.read.maxResponseBytes,
    );
    const truncated = selectedContent.byteLength < requestedContent.byteLength;
    const response = sourceRangeResponseSchema.parse({
      kind: "source-range-response",
      schemaVersion: 1,
      anchor: {
        kind: "source-anchor",
        targetSnapshotDigest: this.#manifest.targetSnapshot.digest,
        path: entry.path,
        fileDigest: entry.digest,
        startLine: request.subject.startLine,
        endLine: truncated
          ? request.subject.startLine + countNewlines(selectedContent)
          : requestedEndLine,
        startOffset: start.startOffset,
        endOffset: start.startOffset + selectedContent.byteLength,
      },
      bytes: selectedContent.byteLength,
      content: selectedContent.toString("utf8"),
    });
    return this.#respond(
      request,
      { outcome: "allowed", reason: "read-allowed" },
      truncated ? "truncated" : "completed",
      response,
    );
  }

  async #search(request: SearchSnapshotQuery): Promise<SourceEvidenceReceipt> {
    const searchPolicy = this.#policyValue.operations.search;
    if (searchPolicy === undefined) {
      return this.#policyDenied(request, "operation-not-allowed");
    }
    const selectedPaths =
      request.subject.scope.kind === "snapshot"
        ? undefined
        : new Set(request.subject.scope.paths);
    const entries = this.#manifest.entries
      .filter(
        (entry) => selectedPaths === undefined || selectedPaths.has(entry.path),
      )
      .sort((left, right) => compareText(left.path, right.path));
    const literal = Buffer.from(request.subject.literal, "utf8");
    const matches: SourceSearchResponse["matches"][number][] = [];
    let scannedFiles = 0;
    let scannedBytes = 0;
    let truncated = false;

    for (const entry of entries) {
      const remaining = searchPolicy.maxScanBytes - scannedBytes;
      if (remaining <= 0) {
        truncated = true;
        break;
      }
      let content: Buffer;
      try {
        content = await this.#loadEntry(entry);
      } catch (error: unknown) {
        if (error instanceof SourceEntryFailure) {
          return this.#policyDenied(request, error.reason);
        }
        throw error;
      }
      const inspected = content.subarray(
        0,
        Math.min(content.byteLength, remaining),
      );
      scannedFiles += 1;
      scannedBytes += inspected.byteLength;
      if (inspected.byteLength < content.byteLength) truncated = true;
      let offset = inspected.indexOf(literal);
      while (offset >= 0) {
        const line = 1 + countNewlines(inspected.subarray(0, offset));
        matches.push({
          anchor: {
            kind: "source-anchor",
            targetSnapshotDigest: this.#manifest.targetSnapshot.digest,
            path: entry.path,
            fileDigest: entry.digest,
            startLine: line,
            endLine: line,
            startOffset: offset,
            endOffset: offset + literal.byteLength,
          },
        });
        if (matches.length >= searchPolicy.maxResults) {
          truncated = true;
          break;
        }
        offset = inspected.indexOf(literal, offset + literal.byteLength);
      }
      if (truncated) break;
    }

    const response = sourceSearchResponseSchema.parse({
      kind: "source-search-response",
      schemaVersion: 1,
      literal: request.subject.literal,
      scope: request.subject.scope,
      scanned: { files: scannedFiles, bytes: scannedBytes },
      matches,
    });
    if (matches.length === 0 && !truncated) {
      const responseDigest = await this.#artifacts.put(
        "Source Search response",
        response,
      );
      return this.#storeReceipt(
        request,
        { outcome: "allowed", reason: "search-allowed" },
        {
          status: "not-found",
          reason: "literal-not-found",
          responseDigest,
        },
        response,
      );
    }
    return this.#respond(
      request,
      { outcome: "allowed", reason: "search-allowed" },
      truncated ? "truncated" : "completed",
      response,
    );
  }

  async #loadEntry(
    entry: TargetFileManifest["entries"][number],
  ): Promise<Buffer> {
    try {
      const canonicalRoot = await realpath(this.#sourceDirectory);
      const candidate = resolve(canonicalRoot, entry.path);
      const canonicalFile = await realpath(candidate);
      const pathFromRoot = relative(canonicalRoot, canonicalFile);
      if (
        pathFromRoot === "" ||
        pathFromRoot === ".." ||
        pathFromRoot.startsWith(`..${sep}`) ||
        isAbsolute(pathFromRoot)
      ) {
        throw new SourceEntryFailure("path-outside-snapshot");
      }
      const metadata = await lstat(candidate);
      if (!metadata.isFile() || metadata.isSymbolicLink()) {
        throw new SourceEntryFailure("path-outside-snapshot");
      }
      const content = await readFile(canonicalFile);
      if (
        content.byteLength !== entry.size ||
        rawDigest(content) !== entry.digest
      ) {
        throw new SourceEntryFailure("file-digest-mismatch");
      }
      return content;
    } catch (error: unknown) {
      if (error instanceof SourceEntryFailure) throw error;
      throw new SourceEntryFailure("file-digest-mismatch");
    }
  }

  #validateBindings(): void {
    if (
      sha256Digest(this.#manifest) !== this.#manifestRef.digest ||
      this.#manifest.targetSnapshot.id !== this.#manifestRef.targetSnapshotId ||
      this.#manifest.targetSnapshot.digest !==
        this.#manifestRef.targetSnapshotDigest
    ) {
      throw new Error("Source Evidence manifest reference mismatch");
    }
    if (
      sha256Digest(this.#policyValue) !== this.policy.digest ||
      this.#policyValue.id !== this.policy.id ||
      this.#policyValue.targetSnapshotDigest !==
        this.#manifest.targetSnapshot.digest
    ) {
      throw new Error("Source Evidence policy reference mismatch");
    }
    const paths = this.#manifest.entries.map((entry) => entry.path);
    if (new Set(paths).size !== paths.length) {
      throw new Error("Source Evidence manifest contains duplicate paths");
    }
  }

  #deniedReasonV2(
    request: SourceEvidenceQueryV2,
  ): "snapshot-mismatch" | "manifest-mismatch" | "policy-mismatch" | undefined {
    if (
      canonicalJson(request.targetSnapshot) !==
      canonicalJson(this.#manifest.targetSnapshot)
    ) {
      return "snapshot-mismatch";
    }
    if (canonicalJson(request.manifest) !== canonicalJson(this.#manifestRef)) {
      return "manifest-mismatch";
    }
    if (canonicalJson(request.policy) !== canonicalJson(this.policy)) {
      return "policy-mismatch";
    }
    return undefined;
  }

  #deniedReason(
    request: SourceEvidenceQueryV1,
  ):
    | "snapshot-mismatch"
    | "policy-mismatch"
    | "path-outside-snapshot"
    | undefined {
    if (
      canonicalJson(request.targetSnapshot) !==
      canonicalJson(this.#manifest.targetSnapshot)
    ) {
      return "snapshot-mismatch";
    }
    if (canonicalJson(request.policy) !== canonicalJson(this.policy)) {
      return "policy-mismatch";
    }
    if (
      request.kind === "read-source-range" &&
      !isNormalizedRelativePath(request.subject.path)
    ) {
      return "path-outside-snapshot";
    }
    if (
      request.kind === "search-snapshot" &&
      request.subject.scope.kind === "paths" &&
      request.subject.scope.paths.some(
        (path) =>
          !isNormalizedRelativePath(path) ||
          !this.#manifest.entries.some((entry) => entry.path === path),
      )
    ) {
      return "path-outside-snapshot";
    }
    if (
      request.kind === "list-snapshot-files" &&
      request.subject.prefix !== undefined &&
      !isNormalizedDirectoryPrefix(request.subject.prefix)
    ) {
      return "path-outside-snapshot";
    }
    return undefined;
  }

  #policyDenied(
    request: SourceEvidenceQueryV1,
    reason: Extract<
      SourceEvidencePolicyDecision,
      { outcome: "denied" }
    >["reason"],
  ): Promise<SourceEvidenceReceipt> {
    return this.#storeReceipt(
      request,
      { outcome: "denied", reason },
      { status: "policy-denied", reason },
      null,
    );
  }

  async #respond(
    request: SourceEvidenceQueryV1,
    policyDecision: SourceEvidencePolicyDecision,
    status: "completed" | "truncated",
    response:
      SourceRangeResponse | SourceSearchResponse | SourceInventoryResponse,
  ): Promise<SourceEvidenceReceipt> {
    const responseDigest = await this.#artifacts.put(
      "Source Evidence response",
      response,
    );
    return this.#storeReceipt(
      request,
      policyDecision,
      { status, responseDigest },
      response,
    );
  }

  async #storeReceipt(
    request: SourceEvidenceQueryV1,
    policyDecision: SourceEvidencePolicyDecision,
    result: SourceEvidenceResult,
    response: SourceEvidenceResponse | null,
  ): Promise<SourceEvidenceReceipt> {
    const queryDigest = sha256Digest(request);
    const value = sourceEvidenceReceiptValueSchema.parse({
      kind: "source-evidence-receipt",
      schemaVersion: 1,
      attemptId: request.attemptId,
      leaseId: request.leaseId,
      targetSnapshot: request.targetSnapshot,
      queryDigest,
      request,
      policyDecision,
      result,
    });
    const digest = await this.#artifacts.put("Source Evidence receipt", value);
    const ref = sourceEvidenceReceiptRefSchema.parse({
      kind: "source-evidence-receipt",
      schemaVersion: 1,
      attemptId: request.attemptId,
      leaseId: request.leaseId,
      queryDigest,
      digest,
    });
    return { ref, value, response };
  }

  #invalidQueryV2(
    request: SourceEvidenceQueryV2,
    reason: Extract<
      SourceEvidenceResultV2,
      { status: "invalid-query" }
    >["reason"],
  ): Promise<SourceEvidenceReceiptV2> {
    return this.#storeReceiptV2(
      request,
      this.#operationV2(request),
      { outcome: "not-evaluated", reason: "invalid-query" },
      { status: "invalid-query", reason },
      { files: 0, bytes: 0, matches: 0 },
      null,
    );
  }

  #policyDeniedV2(
    request: SourceEvidenceQueryV2,
    reason:
      | "snapshot-mismatch"
      | "manifest-mismatch"
      | "policy-mismatch"
      | "operation-not-allowed"
      | "path-outside-snapshot"
      | "query-budget-exhausted",
  ): Promise<SourceEvidenceReceiptV2> {
    return this.#storeReceiptV2(
      request,
      this.#operationV2(request),
      { outcome: "denied", reason },
      { status: "policy-denied", reason },
      { files: 0, bytes: 0, matches: 0 },
      null,
    );
  }

  #sourceEntryFailureV2(
    request: SourceEvidenceQueryV2,
    operation: "search" | "read",
    reason: SourceEntryFailureReason,
  ): Promise<SourceEvidenceReceiptV2> {
    return reason === "path-outside-snapshot"
      ? this.#storeReceiptV2(
          request,
          operation,
          { outcome: "denied", reason },
          { status: "policy-denied", reason },
          { files: 0, bytes: 0, matches: 0 },
          null,
        )
      : this.#storeReceiptV2(
          request,
          operation,
          {
            outcome: "allowed",
            reason: operation === "search" ? "search-allowed" : "read-allowed",
          },
          { status: "identity-mismatch", reason: "source-bytes-mismatch" },
          { files: 0, bytes: 0, matches: 0 },
          null,
        );
  }

  async #storeReceiptV2(
    request: SourceEvidenceQueryV2,
    operation: "list" | "search" | "read",
    policyDecision: SourceEvidencePolicyDecisionV2,
    result: SourceEvidenceResultV2,
    usage: {
      readonly files: number;
      readonly bytes: number;
      readonly matches: number;
    },
    response: SourceEvidenceReceiptV2["response"],
  ): Promise<SourceEvidenceReceiptV2> {
    const queryDigest = sha256Digest(request);
    const value = sourceEvidenceReceiptValueV2Schema.parse({
      kind: "source-evidence-receipt",
      schemaVersion: 2,
      attemptId: request.attemptId,
      assignment: request.assignment,
      targetSnapshot: request.targetSnapshot,
      manifest: request.manifest,
      policy: request.policy,
      queryOrdinal: request.queryOrdinal,
      queryDigest,
      operation,
      policyDecision,
      usage,
      result,
    });
    const digest = await this.#artifacts.put("Source Evidence receipt", value);
    const ref = sourceEvidenceReceiptRefV2Schema.parse({
      kind: "source-evidence-receipt",
      schemaVersion: 2,
      attemptId: request.attemptId,
      assignmentDigest: sha256Digest(request.assignment),
      manifestDigest: request.manifest.digest,
      queryDigest,
      digest,
    });
    return { ref, value, response };
  }

  #encodeListCursor(payload: ListCursorPayload): string {
    const encoded = Buffer.from(canonicalJson(payload), "utf8").toString(
      "base64url",
    );
    const signature = createHmac("sha256", this.#cursorKey)
      .update(encoded)
      .digest("base64url");
    return `${encoded}.${signature}`;
  }

  #decodeListCursor(cursor: string): ListCursorPayload | undefined {
    const parts = cursor.split(".");
    if (parts.length !== 2) return undefined;
    const [encoded, signature] = parts;
    if (encoded === undefined || signature === undefined) return undefined;
    const expected = createHmac("sha256", this.#cursorKey)
      .update(encoded)
      .digest();
    let observed: Buffer;
    try {
      observed = Buffer.from(signature, "base64url");
    } catch {
      return undefined;
    }
    if (
      observed.byteLength !== expected.byteLength ||
      !timingSafeEqual(observed, expected)
    ) {
      return undefined;
    }
    try {
      return listCursorPayloadSchema.parse(
        JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")),
      );
    } catch {
      return undefined;
    }
  }

  #encodeSearchCursor(payload: SearchCursorPayload): string {
    const encoded = Buffer.from(canonicalJson(payload), "utf8").toString(
      "base64url",
    );
    const signature = createHmac("sha256", this.#cursorKey)
      .update(encoded)
      .digest("base64url");
    return `${encoded}.${signature}`;
  }

  #decodeSearchCursor(cursor: string): SearchCursorPayload | undefined {
    const parts = cursor.split(".");
    if (parts.length !== 2) return undefined;
    const [encoded, signature] = parts;
    if (encoded === undefined || signature === undefined) return undefined;
    const expected = createHmac("sha256", this.#cursorKey)
      .update(encoded)
      .digest();
    let observed: Buffer;
    try {
      observed = Buffer.from(signature, "base64url");
    } catch {
      return undefined;
    }
    if (
      observed.byteLength !== expected.byteLength ||
      !timingSafeEqual(observed, expected)
    ) {
      return undefined;
    }
    try {
      return searchCursorPayloadSchema.parse(
        JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")),
      );
    } catch {
      return undefined;
    }
  }

  #encodeReadCursor(payload: ReadCursorPayload): string {
    const encoded = Buffer.from(canonicalJson(payload), "utf8").toString(
      "base64url",
    );
    const signature = createHmac("sha256", this.#cursorKey)
      .update(encoded)
      .digest("base64url");
    return `${encoded}.${signature}`;
  }

  #decodeReadCursor(cursor: string): ReadCursorPayload | undefined {
    const parts = cursor.split(".");
    if (parts.length !== 2) return undefined;
    const [encoded, signature] = parts;
    if (encoded === undefined || signature === undefined) return undefined;
    const expected = createHmac("sha256", this.#cursorKey)
      .update(encoded)
      .digest();
    let observed: Buffer;
    try {
      observed = Buffer.from(signature, "base64url");
    } catch {
      return undefined;
    }
    if (
      observed.byteLength !== expected.byteLength ||
      !timingSafeEqual(observed, expected)
    ) {
      return undefined;
    }
    try {
      return readCursorPayloadSchema.parse(
        JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")),
      );
    } catch {
      return undefined;
    }
  }
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function countNewlines(content: Buffer): number {
  return content.reduce((count, byte) => count + (byte === 0x0a ? 1 : 0), 0);
}

export function openSourceEvidenceGateway(
  options: OpenSourceEvidenceGatewayOptions,
): SourceEvidenceGateway {
  return new SnapshotSourceEvidenceGateway(options);
}
