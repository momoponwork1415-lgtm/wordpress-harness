import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { canonicalDigest } from "../../infrastructure/canonical-json.js";
import {
  targetResearchHistoryQuerySchema,
  targetResearchHistorySnapshotRefSchema,
  targetResearchHistorySnapshotSchema,
  targetResearchHistoryViewSchema,
  type OpenTargetResearchHistoriesOptions,
  type TargetResearchHistories,
  type TargetResearchHistorySnapshot,
  type TargetResearchHistorySnapshotRef,
} from "./contracts.js";

function hasErrorCode(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === code
  );
}

function snapshotRef(
  snapshot: TargetResearchHistorySnapshot,
): TargetResearchHistorySnapshotRef {
  return targetResearchHistorySnapshotRefSchema.parse({
    kind: "target-research-history-snapshot-ref",
    schemaVersion: 1,
    id: snapshot.id,
    digest: snapshot.digest,
    historyEntries: snapshot.historyEntries.length,
  });
}

function summarize(entries: TargetResearchHistorySnapshot["historyEntries"]) {
  return { observed: entries.length > 0 };
}

class FileTargetResearchHistories implements TargetResearchHistories {
  readonly #storageDirectory: string;

  constructor(options: OpenTargetResearchHistoriesOptions) {
    this.#storageDirectory = resolve(options.storageDirectory);
  }

  async inspect(queryValue: Parameters<TargetResearchHistories["inspect"]>[0]) {
    const query = targetResearchHistoryQuerySchema.parse(queryValue);
    const snapshot = await this.#read(this.#path(query.snapshotId));
    if (snapshot === undefined) {
      throw new Error(
        `Target Research History Snapshot not found: ${query.snapshotId}`,
      );
    }
    const pluginEntries = snapshot.historyEntries.filter(
      ({ pluginIdentity }) => pluginIdentity === query.pluginIdentity,
    );
    const sameVersionEntries = pluginEntries.filter(
      ({ version }) => version === query.version,
    );
    const priorVersions = new Set(
      pluginEntries
        .map(({ version }) => version)
        .filter((version) => version !== query.version),
    );
    return targetResearchHistoryViewSchema.parse({
      kind: "target-research-history-view",
      schemaVersion: 1,
      snapshotRef: snapshotRef(snapshot),
      pluginIdentity: query.pluginIdentity,
      version: query.version,
      sameVersion: summarize(sameVersionEntries),
      priorVersions: [...priorVersions].sort(),
    });
  }

  #path(snapshotId: string): string {
    return join(this.#storageDirectory, `${snapshotId}.json`);
  }

  async #read(
    path: string,
  ): Promise<TargetResearchHistorySnapshot | undefined> {
    try {
      const snapshot = targetResearchHistorySnapshotSchema.parse(
        JSON.parse(await readFile(path, "utf8")) as unknown,
      );
      const { digest, ...body } = snapshot;
      if (digest !== canonicalDigest(body)) {
        throw new Error("Target Research History Snapshot digest mismatch");
      }
      return snapshot;
    } catch (error) {
      if (hasErrorCode(error, "ENOENT")) return undefined;
      throw error;
    }
  }
}

export function openTargetResearchHistories(
  options: OpenTargetResearchHistoriesOptions,
): TargetResearchHistories {
  return new FileTargetResearchHistories(options);
}
