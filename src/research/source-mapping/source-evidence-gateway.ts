import { createHash } from "node:crypto";
import { lstat, readFile, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { TextDecoder } from "node:util";

import type { JsonArtifactStore } from "../research-record/contracts.js";
import {
  canonicalJson,
  sha256Digest,
} from "../research-record/canonical-json.js";
import {
  targetFileManifestRefSchema,
  targetFileManifestSchema,
  type TargetFileManifest,
  type TargetFileManifestRef,
} from "./contracts.js";
import {
  sourceEvidenceQuerySchema,
  sourceEvidenceReceiptRefSchema,
  sourceEvidenceReceiptValueSchema,
  sourceRangeResponseSchema,
  sourceSearchResponseSchema,
  sourceToolPolicyRefSchema,
  sourceToolPolicySchema,
  type SearchSnapshotQuery,
  type SourceEvidenceGateway,
  type SourceEvidencePolicyDecision,
  type SourceEvidenceQuery,
  type SourceEvidenceReceipt,
  type SourceEvidenceResponse,
  type SourceEvidenceResult,
  type SourceRangeResponse,
  type SourceSearchResponse,
  type SourceToolPolicy,
  type SourceToolPolicyRef,
} from "./source-evidence-contracts.js";

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
  readonly #artifactStore: JsonArtifactStore;
  readonly #manifestRef: TargetFileManifestRef;
  readonly #manifest: TargetFileManifest;
  readonly #policyValue: SourceToolPolicy;

  constructor(options: OpenSourceEvidenceGatewayOptions) {
    if (!isAbsolute(options.sourceDirectory)) {
      throw new Error("Source Evidence root must be absolute");
    }
    this.#sourceDirectory = resolve(options.sourceDirectory);
    this.#artifactStore = options.artifactStore;
    this.#manifestRef = targetFileManifestRefSchema.parse(options.manifest.ref);
    this.#manifest = targetFileManifestSchema.parse(options.manifest.value);
    this.policy = sourceToolPolicyRefSchema.parse(options.policy.ref);
    this.#policyValue = sourceToolPolicySchema.parse(options.policy.value);
    this.#validateBindings();
  }

  async query(
    requestInput: SourceEvidenceQuery,
  ): Promise<SourceEvidenceReceipt> {
    const request = sourceEvidenceQuerySchema.parse(requestInput);
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
    return request.kind === "search-snapshot"
      ? this.#search(request)
      : this.#readRange(request);
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
      const responseDigest = await this.#artifactStore.putJson(response);
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

  #deniedReason(
    request: SourceEvidenceQuery,
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
    return undefined;
  }

  #policyDenied(
    request: SourceEvidenceQuery,
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
    request: SourceEvidenceQuery,
    policyDecision: SourceEvidencePolicyDecision,
    status: "completed" | "truncated",
    response: SourceRangeResponse | SourceSearchResponse,
  ): Promise<SourceEvidenceReceipt> {
    const responseDigest = await this.#artifactStore.putJson(response);
    return this.#storeReceipt(
      request,
      policyDecision,
      { status, responseDigest },
      response,
    );
  }

  async #storeReceipt(
    request: SourceEvidenceQuery,
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
    const digest = await this.#artifactStore.putJson(value);
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
