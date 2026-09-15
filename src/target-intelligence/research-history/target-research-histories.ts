import { randomUUID } from "node:crypto";
import {
  link,
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  unlink,
  writeFile,
} from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";

import { z } from "zod";

import {
  canonicalDigest,
  encodeCanonicalJson,
} from "../../infrastructure/canonical-json.js";
import {
  buildLegacyResearchHistoryRequestSchema,
  targetResearchHistoryQuerySchema,
  targetResearchHistorySnapshotRefSchema,
  targetResearchHistorySnapshotSchema,
  targetResearchHistoryViewSchema,
  type BuildLegacyResearchHistoryRequest,
  type OpenTargetResearchHistoriesOptions,
  type TargetResearchHistories,
  type TargetResearchHistorySnapshot,
  type TargetResearchHistorySnapshotRef,
} from "./contracts.js";

const slugSchema = z.string().regex(/^[a-z0-9][a-z0-9-]*$/);
const jsonValueSchema = z.json();

const whiteboxAuditLedgerSchema = z.object({
  schema_version: z.literal("wordpress-plugin-audit-ledger/v1"),
  plugins: z.array(
    z.object({
      slug: slugSchema,
      attempts: z.array(
        z.object({
          version: z.string().min(1).max(64),
        }),
      ),
    }),
  ),
});

interface ImportedHistory {
  readonly entries: TargetResearchHistorySnapshot["historyEntries"];
}

function hasErrorCode(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === code
  );
}

function pluginIdentity(
  slug: string,
  overrides: Readonly<Record<string, string>> | undefined,
): TargetResearchHistorySnapshot["historyEntries"][number]["pluginIdentity"] {
  return (overrides?.[slug] ??
    `wporg:${slug}`) as TargetResearchHistorySnapshot["historyEntries"][number]["pluginIdentity"];
}

async function requireRealPath(path: string, kind: "file" | "directory") {
  if (!isAbsolute(path)) {
    throw new Error(`Import source ${kind} path must be absolute`);
  }
  const metadata = await lstat(path);
  if (
    (kind === "file" ? !metadata.isFile() : !metadata.isDirectory()) ||
    metadata.isSymbolicLink() ||
    (await realpath(path)) !== resolve(path)
  ) {
    throw new Error(`Import source ${kind} path must be a real ${kind}`);
  }
}

function entryKey(
  entry: TargetResearchHistorySnapshot["historyEntries"][number],
): string {
  return [entry.pluginIdentity, entry.version].join("|");
}

function deduplicateEntries(
  entries: TargetResearchHistorySnapshot["historyEntries"],
): TargetResearchHistorySnapshot["historyEntries"] {
  return [
    ...new Map(entries.map((entry) => [entryKey(entry), entry])).values(),
  ].sort((left, right) => entryKey(left).localeCompare(entryKey(right)));
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

async function readWhiteboxLedger(
  path: string,
  overrides: Readonly<Record<string, string>> | undefined,
): Promise<ImportedHistory> {
  await requireRealPath(path, "file");
  const bytes = await readFile(path);
  const parsed = whiteboxAuditLedgerSchema.parse(
    JSON.parse(bytes.toString("utf8")) as unknown,
  );
  const entries: TargetResearchHistorySnapshot["historyEntries"] = [];
  for (const plugin of parsed.plugins) {
    for (const attempt of plugin.attempts) {
      entries.push({
        pluginIdentity: pluginIdentity(plugin.slug, overrides),
        version: attempt.version,
      });
    }
  }
  return {
    entries: deduplicateEntries(entries),
  };
}

function provenanceField(text: string, name: string): string | undefined {
  return text
    .split(/\r?\n/u)
    .find((line) => line.startsWith(`${name}: `))
    ?.slice(name.length + 2)
    .trim();
}

async function readWordfenceLabs(
  labsRoot: string,
  overrides: Readonly<Record<string, string>> | undefined,
): Promise<ImportedHistory> {
  await requireRealPath(labsRoot, "directory");
  const rootEntries = await readdir(labsRoot, { withFileTypes: true });
  if (rootEntries.some((entry) => entry.isSymbolicLink())) {
    throw new Error("Wordfence wp2shell Labs root must not contain symlinks");
  }
  const directories = rootEntries
    .filter((entry) => entry.isDirectory() && entry.name !== "archives")
    .map(({ name }) => name)
    .sort();
  const entries: TargetResearchHistorySnapshot["historyEntries"] = [];

  for (const directory of directories) {
    const path = join(labsRoot, directory, "SOURCE_PROVENANCE.txt");
    await requireRealPath(path, "file");
    const bytes = await readFile(path);
    const provenance = bytes.toString("utf8");
    const slug = provenanceField(provenance, "Slug");
    const version = provenanceField(provenance, "Version");
    if (
      slug === undefined ||
      !slugSchema.safeParse(slug).success ||
      version === undefined ||
      version.length > 64
    ) {
      throw new Error("Wordfence wp2shell Lab provenance is malformed");
    }
    entries.push({
      pluginIdentity: pluginIdentity(slug, overrides),
      version,
    });
  }

  return {
    entries: deduplicateEntries(entries),
  };
}

class FileTargetResearchHistories implements TargetResearchHistories {
  readonly #storageDirectory: string;
  readonly #clock: () => Date;

  constructor(options: OpenTargetResearchHistoriesOptions) {
    this.#storageDirectory = resolve(options.storageDirectory);
    this.#clock = options.clock ?? (() => new Date());
  }

  async buildFromLegacyData(requestValue: BuildLegacyResearchHistoryRequest) {
    const request = buildLegacyResearchHistoryRequestSchema.parse(requestValue);
    const overrides = request.identityOverrides;
    const [ledger, wp2shellLabs] = await Promise.all([
      readWhiteboxLedger(request.sources.whitebox.auditLedgerPath, overrides),
      readWordfenceLabs(request.sources.wordfence.wp2shellLabsRoot, overrides),
    ]);
    const historyData = {
      historyEntries: deduplicateEntries([
        ...ledger.entries,
        ...wp2shellLabs.entries,
      ]),
    };
    await mkdir(this.#storageDirectory, { recursive: true, mode: 0o700 });
    const path = this.#path(request.snapshotId);
    const existing = await this.#read(path);
    if (existing !== undefined) {
      this.#requireSameHistory(existing, historyData);
      return snapshotRef(existing);
    }
    const body = {
      kind: "target-research-history-snapshot" as const,
      schemaVersion: 1 as const,
      id: request.snapshotId,
      generatedAt: this.#clock().toISOString(),
      ...historyData,
    };
    const snapshot = targetResearchHistorySnapshotSchema.parse({
      ...body,
      digest: canonicalDigest(body),
    });
    const temporaryPath = `${path}.${randomUUID()}.tmp`;
    await writeFile(
      temporaryPath,
      `${encodeCanonicalJson(jsonValueSchema.parse(snapshot))}\n`,
      { flag: "wx", mode: 0o600 },
    );
    try {
      await link(temporaryPath, path);
    } catch (error) {
      if (!hasErrorCode(error, "EEXIST")) throw error;
      const raced = await this.#read(path);
      if (raced === undefined) throw error;
      this.#requireSameHistory(raced, historyData);
      return snapshotRef(raced);
    } finally {
      await unlink(temporaryPath).catch(() => undefined);
    }
    return snapshotRef(snapshot);
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

  #requireSameHistory(
    existing: TargetResearchHistorySnapshot,
    historyData: Pick<TargetResearchHistorySnapshot, "historyEntries">,
  ): void {
    if (
      canonicalDigest({
        historyEntries: existing.historyEntries,
      }) !== canonicalDigest(historyData)
    ) {
      throw new Error("Target Research History Snapshot input conflict");
    }
  }
}

export function openTargetResearchHistories(
  options: OpenTargetResearchHistoriesOptions,
): TargetResearchHistories {
  return new FileTargetResearchHistories(options);
}
