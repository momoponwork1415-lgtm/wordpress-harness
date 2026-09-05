import { createHash, randomUUID } from "node:crypto";
import { constants as fsConstants, type Stats } from "node:fs";
import {
  link,
  lstat,
  mkdtemp,
  mkdir,
  open,
  readdir,
  realpath,
  rm,
  unlink,
  writeFile,
  type FileHandle,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  parse,
  relative,
  resolve,
  sep,
} from "node:path";

import Database from "better-sqlite3";
import { z } from "zod";

import { canonicalJson, sha256Digest } from "../acquisition/canonical-json.js";
import {
  WordfenceKnownRecordAccessError,
  currentWordfenceIntelligenceSnapshotSchema,
  staleWordfenceIntelligenceSnapshotSchema,
  knownRecordAccessAuthorizationSchema,
  vulnerabilityHistoryAggregateRequestSchema,
  vulnerabilityHistoryAggregateSchema,
  wordfenceIntelligenceInspectionRequestSchema,
  wordfenceLegacyStorageAdoptionSchema,
  wordfenceIntelligenceFailureSchema,
  wordfenceIntelligenceRefreshRequestSchema,
  wordfenceIntelligenceRefreshAttemptSchema,
  wordfenceIntelligenceResultSchema,
  wordfenceIntelligenceSnapshotRefSchema,
  wordfenceIntelligenceSnapshotSchema,
  wordfenceIntelligenceSourceResponseSchema,
  wordfenceKnownRecordInspectionRequestSchema,
  wordfenceKnownRecordProjectionSchema,
  wordfenceKnownRecordSchema,
  wordfenceRateLimitBackoffSchema,
  wordfenceSecretRefSchema,
  wordfenceSoftwareIdentifierSchema,
  wordfenceStoredPluginRecordSchema,
  type HostPrivateCredentialBroker,
  type OpenWordfenceIntelligenceRefreshOptions,
  type OpenWordfenceIntelligenceOptions,
  type KnownRecordAccessAuthorization,
  type KnownRecordAccessAuthorizationRef,
  type VulnerabilityHistoryAggregate,
  type VulnerabilityHistoryAggregateRequest,
  type WordfenceIntelligence,
  type WordfenceIntelligenceFailure,
  type WordfenceIntelligenceInspectionRequest,
  type WordfenceIntelligenceRefreshRequest,
  type WordfenceIntelligenceResult,
  type WordfenceIntelligenceRefresh,
  type WordfenceIntelligenceSnapshot,
  type WordfenceIntelligenceSnapshotRef,
  type WordfenceIntelligenceSourceResponse,
  type WordfenceIntelligenceV3Adapter,
  type WordfenceIntelligenceV3FetchAdapterOptions,
  type WordfenceKnownRecord,
  type WordfenceKnownRecordInspectionRequest,
  type WordfenceKnownRecordProjection,
  type WordfenceRateLimitBackoff,
  type WordfenceSecretRef,
  type WordfenceStoredPluginRecord,
} from "./contracts.js";
import { currentOwnerUid } from "./owner-identity.js";

const DEFAULT_MAXIMUM_FEED_BYTES = 256_000_000;
const MAXIMUM_RETRY_AFTER_SECONDS = 86_400;
const PRODUCTION_REFRESH_ATTEMPT_LEASE_SECONDS = 300;
const DEFAULT_SOURCE_URL =
  "https://www.wordfence.com/api/intelligence/v3/vulnerabilities/production";

const wordfenceIndexTableDefinitions = {
  wordfence_intelligence_snapshots:
    "CREATE TABLE wordfence_intelligence_snapshots (snapshot_digest TEXT PRIMARY KEY, snapshot_id TEXT NOT NULL UNIQUE, snapshot_json TEXT NOT NULL) STRICT",
  wordfence_intelligence_records:
    "CREATE TABLE wordfence_intelligence_records (snapshot_digest TEXT NOT NULL, plugin_slug TEXT NOT NULL, record_id TEXT NOT NULL, record_json TEXT NOT NULL, PRIMARY KEY (snapshot_digest, plugin_slug, record_id)) STRICT",
  wordfence_intelligence_current:
    "CREATE TABLE wordfence_intelligence_current (singleton INTEGER PRIMARY KEY CHECK (singleton = 1), snapshot_digest TEXT NOT NULL) STRICT",
  wordfence_intelligence_refresh_state:
    "CREATE TABLE wordfence_intelligence_refresh_state (singleton INTEGER PRIMARY KEY CHECK (singleton = 1), state_json TEXT NOT NULL) STRICT",
  wordfence_intelligence_refresh_attempts:
    "CREATE TABLE wordfence_intelligence_refresh_attempts (sequence INTEGER PRIMARY KEY AUTOINCREMENT, attempted_at TEXT NOT NULL, current_snapshot_digest TEXT) STRICT",
  wordfence_intelligence_refresh_order:
    "CREATE TABLE wordfence_intelligence_refresh_order (singleton INTEGER PRIMARY KEY CHECK (singleton = 1), publication_sequence INTEGER NOT NULL CHECK (publication_sequence >= 0), latest_completed_sequence INTEGER NOT NULL CHECK (latest_completed_sequence >= publication_sequence)) STRICT",
  wordfence_intelligence_record_set_manifests:
    "CREATE TABLE wordfence_intelligence_record_set_manifests (snapshot_digest TEXT PRIMARY KEY, manifest_json TEXT NOT NULL) STRICT",
  wordfence_intelligence_legacy_record_sets:
    "CREATE TABLE wordfence_intelligence_legacy_record_sets (snapshot_digest TEXT PRIMARY KEY, legacy_json TEXT NOT NULL) STRICT",
  wordfence_intelligence_index_metadata:
    "CREATE TABLE wordfence_intelligence_index_metadata (singleton INTEGER PRIMARY KEY CHECK (singleton = 1), schema_version INTEGER NOT NULL) STRICT",
} as const;

const fixedMainWordfenceIndexTableDefinitions = {
  wordfence_intelligence_snapshots:
    wordfenceIndexTableDefinitions.wordfence_intelligence_snapshots,
  wordfence_intelligence_records:
    wordfenceIndexTableDefinitions.wordfence_intelligence_records,
  wordfence_intelligence_current:
    wordfenceIndexTableDefinitions.wordfence_intelligence_current,
} as const;

const wordfenceImplicitIndexDefinitions = [
  {
    name: "sqlite_autoindex_wordfence_intelligence_snapshots_1",
    tableName: "wordfence_intelligence_snapshots",
  },
  {
    name: "sqlite_autoindex_wordfence_intelligence_snapshots_2",
    tableName: "wordfence_intelligence_snapshots",
  },
  {
    name: "sqlite_autoindex_wordfence_intelligence_records_1",
    tableName: "wordfence_intelligence_records",
  },
  {
    name: "sqlite_autoindex_wordfence_intelligence_record_set_manifests_1",
    tableName: "wordfence_intelligence_record_set_manifests",
  },
  {
    name: "sqlite_autoindex_wordfence_intelligence_legacy_record_sets_1",
    tableName: "wordfence_intelligence_legacy_record_sets",
  },
] as const;

const productionStorageTableDefinition =
  "CREATE TABLE wordfence_intelligence_production_storage (singleton INTEGER PRIMARY KEY CHECK (singleton = 1), format_json TEXT NOT NULL) STRICT";

const rawVersionIntervalSchema = z.object({
  from_version: z.string().min(1).max(64),
  from_inclusive: z.boolean(),
  to_version: z.string().min(1).max(64),
  to_inclusive: z.boolean(),
});

const rawSoftwareSchema = z.object({
  type: z.enum(["core", "plugin", "theme"]),
  name: z.string().min(1),
  slug: wordfenceSoftwareIdentifierSchema,
  affected_versions: z.record(z.string(), rawVersionIntervalSchema),
  patched: z.boolean(),
  patched_versions: z.array(z.string().min(1).max(64)),
  remediation: z.string(),
});

const rawCweSchema = z.object({
  id: z.number().int().nonnegative(),
  name: z.string().min(1),
  description: z.string().min(1),
});

const rawCvssSchema = z.object({
  vector: z.string().min(1),
  score: z.number().min(0).max(10),
  rating: z.enum(["None", "Low", "Medium", "High", "Critical"]),
});

const rawRecordSchema = z.object({
  id: z.uuid(),
  title: z.string().min(1),
  software: z.array(rawSoftwareSchema).min(1),
  informational: z.boolean(),
  description: z.string(),
  references: z.array(z.url()),
  cwe: rawCweSchema.nullable(),
  cvss: rawCvssSchema.nullable(),
  cve: z
    .string()
    .regex(/^CVE-[0-9]{4}-[0-9]{4,}$/)
    .nullable(),
  cve_link: z.url().nullable(),
  researchers: z.array(z.string()),
  published: z.string().nullable(),
  updated: z.string().nullable(),
  copyrights: z.unknown().optional(),
});

const rawAttributionPartySchema = z.object({
  notice: z.string().min(1),
  license: z.string().min(1),
  license_url: z.url(),
});

const rawCopyrightSchema = z.object({
  message: z.string().min(1),
  defiant: rawAttributionPartySchema,
  mitre: rawAttributionPartySchema.optional(),
});

const rawFeedSchema = z.record(z.string(), z.unknown());

const snapshotRowSchema = z.strictObject({
  snapshot_digest: z.string(),
  snapshot_id: z.string(),
  snapshot_json: z.string(),
});

const currentSnapshotRowSchema = z.strictObject({
  current_snapshot_digest: z.string(),
  snapshot_digest: z.string().nullable(),
  snapshot_id: z.string().nullable(),
});

const snapshotRecordRowSchema = z.strictObject({
  plugin_slug: z.string(),
  record_id: z.string(),
  record_json: z.string(),
});

const recordSetManifestRowSchema = z.strictObject({
  manifest_json: z.string(),
});

const legacyRecordSetRowSchema = z.strictObject({
  legacy_json: z.string(),
});

const indexMetadataRowSchema = z.strictObject({
  schema_version: z.literal(1),
});

const legacyMigrationSnapshotRowSchema = z.strictObject({
  snapshot_digest: z.string(),
  snapshot_json: z.string(),
});

const recordSetManifestSchema = z.strictObject({
  kind: z.literal("wordfence-intelligence-record-set-manifest"),
  schemaVersion: z.literal(1),
  snapshotDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  parserVersion: z.literal("wordfence-intelligence-production-v3"),
  normalizedRowCount: z.number().int().nonnegative(),
  recordSetDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
});

const legacyRecordSetSchema = z.strictObject({
  kind: z.literal("wordfence-intelligence-legacy-record-set"),
  schemaVersion: z.literal(1),
  snapshotDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  snapshotSchemaVersion: z.literal(1),
  parserVersion: z.literal("wordfence-intelligence-production-v3"),
  recordFormat: z.literal("record-only-v1"),
  integrity: z.literal("unbound-read-only"),
});

const refreshStateRowSchema = z.strictObject({ state_json: z.string() });

const refreshAttemptRowSchema = z.strictObject({
  sequence: z.number().int().positive(),
  attempted_at: z.iso.datetime({ offset: true }),
  current_snapshot_digest: z
    .string()
    .regex(/^sha256:[a-f0-9]{64}$/)
    .nullable(),
});

const refreshOrderRowSchema = z.strictObject({
  publication_sequence: z.number().int().nonnegative(),
  latest_completed_sequence: z.number().int().nonnegative(),
});

const sqliteSequenceRowSchema = z.strictObject({
  seq: z.number().int().nonnegative(),
});

const sqliteSchemaRowSchema = z.strictObject({
  type: z.enum(["index", "table", "trigger", "view"]),
  name: z.string(),
  table_name: z.string(),
  sql: z.string().nullable(),
});

const fixedMainSnapshotRecordRowSchema = snapshotRecordRowSchema.extend({
  snapshot_digest: z.string(),
});

const fixedMainCurrentRowSchema = z.strictObject({
  snapshot_digest: z.string(),
});

const productionStorageRowSchema = z.strictObject({
  format_json: z.string(),
});

const productionStorageFormatSchema = z.strictObject({
  kind: z.literal("wordfence-intelligence-production-storage-format"),
  schemaVersion: z.literal(1),
  refreshAttemptLeaseSeconds: z.literal(
    PRODUCTION_REFRESH_ATTEMPT_LEASE_SECONDS,
  ),
});

type ProductionStorageFormat = z.infer<typeof productionStorageFormatSchema>;

const productionCompletedRefreshStateSchema = z.strictObject({
  kind: z.literal("wordfence-intelligence-production-refresh-state"),
  schemaVersion: z.literal(1),
  currentSnapshotDigest: z
    .string()
    .regex(/^sha256:[a-f0-9]{64}$/)
    .optional(),
  latestRefresh: wordfenceIntelligenceRefreshAttemptSchema,
});

const productionSequencedRefreshStateSchema = z.strictObject({
  kind: z.literal("wordfence-intelligence-production-refresh-state"),
  schemaVersion: z.literal(2),
  attemptSequence: z.number().int().positive(),
  currentSnapshotDigest: z
    .string()
    .regex(/^sha256:[a-f0-9]{64}$/)
    .optional(),
  latestRefresh: wordfenceIntelligenceRefreshAttemptSchema,
});

const productionRefreshInProgressStateSchema = z.strictObject({
  kind: z.literal("wordfence-intelligence-production-refresh-in-progress"),
  schemaVersion: z.literal(1),
  currentSnapshotDigest: z
    .string()
    .regex(/^sha256:[a-f0-9]{64}$/)
    .optional(),
  attemptedAt: z.iso.datetime({ offset: true }),
});

const productionRefreshStateSchema = z.union([
  productionSequencedRefreshStateSchema,
  productionCompletedRefreshStateSchema,
  productionRefreshInProgressStateSchema,
]);

type SnapshotRow = z.infer<typeof snapshotRowSchema>;

type ProductionRefreshAttemptToken = Readonly<{
  kind: "wordfence-production-refresh-attempt-token";
  sequence: number;
  attemptedAt: string;
}>;

class AttributionMissingError extends Error {
  constructor() {
    super("Wordfence Intelligence attribution is missing");
    this.name = "AttributionMissingError";
  }
}

class ResponseTooLargeError extends Error {
  constructor() {
    super("Wordfence Intelligence response exceeded its byte ceiling");
    this.name = "ResponseTooLargeError";
  }
}

class PartialResponseError extends Error {
  constructor() {
    super("Wordfence Intelligence response was incomplete");
    this.name = "PartialResponseError";
  }
}

class CredentialUnavailableError extends Error {
  constructor() {
    super("Wordfence Intelligence credential is unavailable");
    this.name = "CredentialUnavailableError";
  }
}

class ArtifactConflictError extends Error {
  constructor() {
    super("Wordfence Intelligence artifact conflict");
    this.name = "ArtifactConflictError";
  }
}

class SnapshotConflictError extends Error {
  constructor() {
    super("Wordfence Intelligence snapshot conflict");
    this.name = "SnapshotConflictError";
  }
}

class HostPrivateStorageError extends Error {
  readonly code = "EACCES";

  constructor() {
    super("Wordfence Intelligence storage is not host-private");
    this.name = "HostPrivateStorageError";
  }
}

async function useFileHandle<T>(
  handle: FileHandle,
  operation: (selected: FileHandle) => Promise<T>,
): Promise<T> {
  let result: T;
  try {
    result = await operation(handle);
  } catch (error) {
    try {
      await handle.close();
    } catch {
      // Preserve the primary operation failure.
    }
    throw error;
  }
  await handle.close();
  return result;
}

const storageFailureCodes = new Set([
  "EACCES",
  "EBUSY",
  "EDQUOT",
  "EIO",
  "EISDIR",
  "ELOOP",
  "EEXIST",
  "EMFILE",
  "ENAMETOOLONG",
  "ENOENT",
  "ENFILE",
  "ENOMEM",
  "ENOSPC",
  "ENOTDIR",
  "EPERM",
  "EROFS",
  "SQLITE_BUSY",
  "SQLITE_CANTOPEN",
  "SQLITE_FULL",
  "SQLITE_LOCKED",
  "SQLITE_NOMEM",
  "SQLITE_PERM",
  "SQLITE_READONLY",
]);

function isStorageFailure(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return false;
  }
  const code = error.code;
  return (
    typeof code === "string" &&
    (storageFailureCodes.has(code) || code.startsWith("SQLITE_IOERR"))
  );
}

function maximumFeedBytes(value: number | undefined): number {
  const maximum = value ?? DEFAULT_MAXIMUM_FEED_BYTES;
  if (!Number.isSafeInteger(maximum) || maximum <= 0) {
    throw new Error("maximumFeedBytes must be a positive safe integer");
  }
  return maximum;
}

function rawDigest(bytes: Uint8Array): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function shortId(prefix: string, digest: string): string {
  return `${prefix}:${digest.slice(7, 31)}`;
}

function compareCanonicalIdentifiers(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function compareStoredRecords(
  left: WordfenceStoredPluginRecord,
  right: WordfenceStoredPluginRecord,
): number {
  const pluginOrder = compareCanonicalIdentifiers(
    left.pluginSlug,
    right.pluginSlug,
  );
  return pluginOrder === 0
    ? compareCanonicalIdentifiers(left.record.recordId, right.record.recordId)
    : pluginOrder;
}

function canonicalRecordOrder(
  records: readonly WordfenceStoredPluginRecord[],
): readonly WordfenceStoredPluginRecord[] {
  return [...records].sort(compareStoredRecords);
}

function recordSetDigest(
  snapshotDigest: string,
  records: readonly WordfenceStoredPluginRecord[],
): string {
  const orderedRecords = canonicalRecordOrder(records);
  const hash = createHash("sha256");
  hash.update(
    canonicalJson({
      kind: "wordfence-intelligence-normalized-record-set",
      schemaVersion: 1,
      snapshotDigest,
      normalizedRowCount: orderedRecords.length,
    }),
  );
  for (const stored of orderedRecords) {
    hash.update("\n");
    hash.update(canonicalJson(stored));
  }
  return `sha256:${hash.digest("hex")}`;
}

function recordSetManifest(
  snapshot: WordfenceIntelligenceSnapshot,
  reference: WordfenceIntelligenceSnapshotRef,
  records: readonly WordfenceStoredPluginRecord[],
) {
  return recordSetManifestSchema.parse({
    kind: "wordfence-intelligence-record-set-manifest",
    schemaVersion: 1,
    snapshotDigest: reference.digest,
    parserVersion: snapshot.source.parserVersion,
    normalizedRowCount: records.length,
    recordSetDigest: recordSetDigest(reference.digest, records),
  });
}

function legacyRecordSet(
  snapshot: WordfenceIntelligenceSnapshot,
  reference: WordfenceIntelligenceSnapshotRef,
) {
  return legacyRecordSetSchema.parse({
    kind: "wordfence-intelligence-legacy-record-set",
    schemaVersion: 1,
    snapshotDigest: reference.digest,
    snapshotSchemaVersion: snapshot.schemaVersion,
    parserVersion: snapshot.source.parserVersion,
    recordFormat: "record-only-v1",
    integrity: "unbound-read-only",
  });
}

function schemaCreationSql(includeProductionStorage: boolean): string {
  const definitions = [
    ...Object.values(wordfenceIndexTableDefinitions),
    ...(includeProductionStorage ? [productionStorageTableDefinition] : []),
  ];
  return definitions
    .map((definition) =>
      definition.replace("CREATE TABLE ", "CREATE TABLE IF NOT EXISTS "),
    )
    .join(";\n");
}

function normalizedSchemaSql(sql: string): string {
  return sql
    .replace(/\s+/gu, " ")
    .replace(/\s*([(),])\s*/gu, "$1")
    .trim();
}

function requireExactWordfenceSchema(
  database: Database.Database,
  tableDefinitions: Readonly<Record<string, string>>,
): void {
  const expected = new Map<string, z.infer<typeof sqliteSchemaRowSchema>>();
  const expectedTables = Object.entries(tableDefinitions).map(([name, sql]) =>
    sqliteSchemaRowSchema.parse({
      type: "table",
      name,
      table_name: name,
      sql: normalizedSchemaSql(sql),
    }),
  );
  const expectedIndexes = wordfenceImplicitIndexDefinitions
    .filter((index) => Object.hasOwn(tableDefinitions, index.tableName))
    .map((index) =>
      sqliteSchemaRowSchema.parse({
        type: "index",
        name: index.name,
        table_name: index.tableName,
        sql: null,
      }),
    );
  for (const row of [...expectedTables, ...expectedIndexes]) {
    expected.set(`${row.type}:${row.name}`, row);
  }
  const rows = sqliteSchemaRowSchema.array().parse(
    database
      .prepare(
        `SELECT type, name, tbl_name AS table_name, sql
           FROM sqlite_schema
          WHERE (type = 'table' AND name NOT LIKE 'sqlite_%')
             OR type IN ('index', 'trigger', 'view')
          ORDER BY type, name`,
      )
      .all(),
  );
  if (
    rows.length !== expected.size ||
    rows.some((row) => {
      const candidate = expected.get(`${row.type}:${row.name}`);
      return (
        candidate === undefined ||
        candidate.table_name !== row.table_name ||
        candidate.sql !==
          (row.sql === null ? null : normalizedSchemaSql(row.sql))
      );
    })
  ) {
    throw new SnapshotConflictError();
  }
}

function requireWordfenceSchema(
  database: Database.Database,
  includeProductionStorage: boolean,
): void {
  requireExactWordfenceSchema(database, {
    ...wordfenceIndexTableDefinitions,
    ...(includeProductionStorage
      ? {
          wordfence_intelligence_production_storage:
            productionStorageTableDefinition,
        }
      : {}),
  });
  const metadata = indexMetadataRowSchema.array().parse(
    database
      .prepare(
        `SELECT schema_version
           FROM wordfence_intelligence_index_metadata
          WHERE singleton = 1`,
      )
      .all(),
  );
  if (metadata.length !== 1 || metadata[0]?.schema_version !== 1) {
    throw new SnapshotConflictError();
  }
}

function productionStorageFormat(): ProductionStorageFormat {
  return productionStorageFormatSchema.parse({
    kind: "wordfence-intelligence-production-storage-format",
    schemaVersion: 1,
    refreshAttemptLeaseSeconds: PRODUCTION_REFRESH_ATTEMPT_LEASE_SECONDS,
  });
}

function readModernProductionStorage(
  database: Database.Database,
): ProductionStorageFormat {
  requireWordfenceSchema(database, true);
  const markerRows = productionStorageRowSchema.array().parse(
    database
      .prepare(
        `SELECT format_json
           FROM wordfence_intelligence_production_storage
          WHERE singleton = 1`,
      )
      .all(),
  );
  if (markerRows.length !== 1) {
    throw new SnapshotConflictError();
  }
  const marker = productionStorageFormatSchema.parse(
    JSON.parse(markerRows[0]?.format_json ?? ""),
  );
  if (canonicalJson(marker) !== markerRows[0]?.format_json) {
    throw new SnapshotConflictError();
  }
  const orders = refreshOrderRowSchema.array().parse(
    database
      .prepare(
        `SELECT publication_sequence, latest_completed_sequence
           FROM wordfence_intelligence_refresh_order
          WHERE singleton = 1`,
      )
      .all(),
  );
  const allocators = sqliteSequenceRowSchema.array().parse(
    database
      .prepare(
        `SELECT seq
           FROM sqlite_sequence
          WHERE name = 'wordfence_intelligence_refresh_attempts'`,
      )
      .all(),
  );
  if (orders.length !== 1 || allocators.length !== 1) {
    throw new SnapshotConflictError();
  }
  return marker;
}

function requireModernProductionStorage(
  database: Database.Database,
): ProductionStorageFormat {
  try {
    return readModernProductionStorage(database);
  } catch (error) {
    if (error instanceof SnapshotConflictError) {
      throw error;
    }
    throw new SnapshotConflictError();
  }
}

function readFixedMainLegacyProductionStorage(
  database: Database.Database,
): readonly string[] {
  if (database.pragma("journal_mode", { simple: true }) !== "wal") {
    throw new SnapshotConflictError();
  }
  requireExactWordfenceSchema(
    database,
    fixedMainWordfenceIndexTableDefinitions,
  );
  const snapshots = snapshotRowSchema.array().parse(
    database
      .prepare(
        `SELECT snapshot_digest, snapshot_id, snapshot_json
           FROM wordfence_intelligence_snapshots
          ORDER BY snapshot_digest`,
      )
      .all(),
  );
  const records = fixedMainSnapshotRecordRowSchema.array().parse(
    database
      .prepare(
        `SELECT snapshot_digest, plugin_slug, record_id, record_json
           FROM wordfence_intelligence_records
          ORDER BY snapshot_digest, plugin_slug, record_id`,
      )
      .all(),
  );
  const currentRows = fixedMainCurrentRowSchema.array().parse(
    database
      .prepare(
        `SELECT snapshot_digest
           FROM wordfence_intelligence_current
          WHERE singleton = 1`,
      )
      .all(),
  );
  const snapshotDigests = new Set(snapshots.map((row) => row.snapshot_digest));
  const recordCounts = new Map<string, number>();
  for (const row of snapshots) {
    const snapshot = wordfenceIntelligenceSnapshotSchema.parse(
      JSON.parse(row.snapshot_json),
    );
    const reference = snapshotReference(snapshot);
    if (
      reference.digest !== row.snapshot_digest ||
      reference.id !== row.snapshot_id ||
      canonicalJson(snapshot) !== row.snapshot_json
    ) {
      throw new SnapshotConflictError();
    }
  }
  for (const row of records) {
    const record = wordfenceKnownRecordSchema.parse(
      JSON.parse(row.record_json),
    );
    if (
      !snapshotDigests.has(row.snapshot_digest) ||
      record.recordId !== row.record_id ||
      canonicalJson(record) !== row.record_json
    ) {
      throw new SnapshotConflictError();
    }
    wordfenceStoredPluginRecordSchema.parse({
      pluginSlug: row.plugin_slug,
      record,
    });
    recordCounts.set(
      row.snapshot_digest,
      (recordCounts.get(row.snapshot_digest) ?? 0) + 1,
    );
  }
  if (
    snapshots.some(
      (row) => (recordCounts.get(row.snapshot_digest) ?? 0) === 0,
    ) ||
    currentRows.length !== (snapshots.length === 0 ? 0 : 1) ||
    currentRows.some((row) => !snapshotDigests.has(row.snapshot_digest))
  ) {
    throw new SnapshotConflictError();
  }
  return snapshots.map((row) => {
    const snapshot = wordfenceIntelligenceSnapshotSchema.parse(
      JSON.parse(row.snapshot_json),
    );
    return snapshot.source.contentDigest;
  });
}

function requireFixedMainLegacyProductionStorage(
  database: Database.Database,
): readonly string[] {
  try {
    return readFixedMainLegacyProductionStorage(database);
  } catch (error) {
    if (error instanceof SnapshotConflictError) {
      throw error;
    }
    throw new SnapshotConflictError();
  }
}

function initializeProductionStorage(database: Database.Database): void {
  const transaction = database.transaction(() => {
    database.exec(schemaCreationSql(true));
    initializeRecordSetStorage(database);
    database
      .prepare(
        `INSERT INTO wordfence_intelligence_refresh_order (
           singleton, publication_sequence, latest_completed_sequence
         ) VALUES (1, 0, 0)`,
      )
      .run();
    database
      .prepare(
        `INSERT INTO sqlite_sequence (name, seq)
         VALUES ('wordfence_intelligence_refresh_attempts', 0)`,
      )
      .run();
    database
      .prepare(
        `INSERT INTO wordfence_intelligence_production_storage (
           singleton, format_json
         ) VALUES (1, ?)`,
      )
      .run(canonicalJson(productionStorageFormat()));
  });
  transaction.immediate();
}

function migrateLegacyProductionStorage(database: Database.Database): void {
  const transaction = database.transaction(() => {
    requireFixedMainLegacyProductionStorage(database);
    const legacySnapshots = legacyMigrationSnapshotRowSchema.array().parse(
      database
        .prepare(
          `SELECT snapshot_digest, snapshot_json
             FROM wordfence_intelligence_snapshots
            ORDER BY snapshot_digest`,
        )
        .all(),
    );
    database.exec(schemaCreationSql(true));
    const updateRecord = database.prepare(
      `UPDATE wordfence_intelligence_records
          SET record_json = ?
        WHERE snapshot_digest = ?
          AND plugin_slug = ?
          AND record_id = ?`,
    );
    const insertManifest = database.prepare(
      `INSERT INTO wordfence_intelligence_record_set_manifests (
         snapshot_digest, manifest_json
       ) VALUES (?, ?)`,
    );
    for (const row of legacySnapshots) {
      const snapshot = wordfenceIntelligenceSnapshotSchema.parse(
        JSON.parse(row.snapshot_json),
      );
      const reference = snapshotReference(snapshot);
      const legacyRecords = snapshotRecordRowSchema.array().parse(
        database
          .prepare(
            `SELECT plugin_slug, record_id, record_json
               FROM wordfence_intelligence_records
              WHERE snapshot_digest = ?
              ORDER BY plugin_slug, record_id`,
          )
          .all(reference.digest),
      );
      const records = legacyRecords.map((recordRow) => {
        const record = wordfenceKnownRecordSchema.parse(
          JSON.parse(recordRow.record_json),
        );
        const stored = wordfenceStoredPluginRecordSchema.parse({
          pluginSlug: recordRow.plugin_slug,
          record,
        });
        const update = updateRecord.run(
          canonicalJson(stored),
          reference.digest,
          stored.pluginSlug,
          stored.record.recordId,
        );
        if (update.changes !== 1) {
          throw new SnapshotConflictError();
        }
        return stored;
      });
      insertManifest.run(
        reference.digest,
        canonicalJson(recordSetManifest(snapshot, reference, records)),
      );
    }
    database
      .prepare(
        `INSERT INTO wordfence_intelligence_index_metadata (
           singleton, schema_version
         ) VALUES (1, 1)`,
      )
      .run();
    database
      .prepare(
        `INSERT INTO wordfence_intelligence_refresh_order (
           singleton, publication_sequence, latest_completed_sequence
         ) VALUES (1, 0, 0)`,
      )
      .run();
    database
      .prepare(
        `INSERT INTO sqlite_sequence (name, seq)
         VALUES ('wordfence_intelligence_refresh_attempts', 0)`,
      )
      .run();
    database
      .prepare(
        `INSERT INTO wordfence_intelligence_production_storage (
           singleton, format_json
         ) VALUES (1, ?)`,
      )
      .run(canonicalJson(productionStorageFormat()));
  });
  transaction.immediate();
}

function initializeRecordSetStorage(database: Database.Database): void {
  const transaction = database.transaction(() => {
    const metadata = indexMetadataRowSchema.optional().parse(
      database
        .prepare(
          `SELECT schema_version
           FROM wordfence_intelligence_index_metadata
          WHERE singleton = 1`,
        )
        .get(),
    );
    if (metadata !== undefined) {
      return;
    }
    const legacySnapshots = legacyMigrationSnapshotRowSchema.array().parse(
      database
        .prepare(
          `SELECT s.snapshot_digest, s.snapshot_json
           FROM wordfence_intelligence_snapshots s
           LEFT JOIN wordfence_intelligence_record_set_manifests m
             ON m.snapshot_digest = s.snapshot_digest
          WHERE m.snapshot_digest IS NULL
          ORDER BY s.snapshot_digest`,
        )
        .all(),
    );
    const insertLegacy = database.prepare(
      `INSERT INTO wordfence_intelligence_legacy_record_sets (
         snapshot_digest, legacy_json
       ) VALUES (?, ?)`,
    );
    for (const row of legacySnapshots) {
      const snapshot = wordfenceIntelligenceSnapshotSchema.parse(
        JSON.parse(row.snapshot_json),
      );
      const reference = snapshotReference(snapshot);
      if (reference.digest !== row.snapshot_digest) {
        throw new SnapshotConflictError();
      }
      insertLegacy.run(
        reference.digest,
        canonicalJson(legacyRecordSet(snapshot, reference)),
      );
    }
    database
      .prepare(
        `INSERT INTO wordfence_intelligence_index_metadata (
           singleton, schema_version
         ) VALUES (1, 1)`,
      )
      .run();
  });
  transaction.immediate();
}

function hasErrorCode(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === code
  );
}

function isOwnedByCurrentUser(uid: number): boolean {
  const currentUid = currentOwnerUid();
  return currentUid !== undefined && uid === currentUid;
}

async function requireRealDirectory(path: string): Promise<void> {
  const metadata = await lstat(path);
  if (!metadata.isDirectory()) {
    throw new HostPrivateStorageError();
  }
}

async function createDirectoryPathWithoutSymlinks(path: string): Promise<void> {
  const absolutePath = resolve(path);
  const root = parse(absolutePath).root;
  const remainder = relative(root, absolutePath);
  if (remainder.length === 0) {
    throw new HostPrivateStorageError();
  }
  let current = root;
  for (const component of remainder.split(sep)) {
    current = join(current, component);
    try {
      await requireRealDirectory(current);
      continue;
    } catch (error) {
      if (!hasErrorCode(error, "ENOENT")) {
        throw error;
      }
    }
    try {
      await mkdir(current, { mode: 0o700 });
    } catch (error) {
      if (!hasErrorCode(error, "EEXIST")) {
        throw error;
      }
    }
    await requireRealDirectory(current);
  }
}

async function secureHostPrivateDirectory(path: string): Promise<void> {
  if (!isAbsolute(path)) {
    throw new HostPrivateStorageError();
  }
  await createDirectoryPathWithoutSymlinks(path);
  if ((await realpath(path)) !== resolve(path)) {
    throw new HostPrivateStorageError();
  }
  const handle = await open(
    path,
    fsConstants.O_RDONLY | fsConstants.O_DIRECTORY | fsConstants.O_NOFOLLOW,
  );
  try {
    const metadata = await handle.stat();
    if (!metadata.isDirectory() || !isOwnedByCurrentUser(metadata.uid)) {
      throw new HostPrivateStorageError();
    }
    await handle.chmod(0o700);
    const secured = await handle.stat();
    if (!secured.isDirectory() || (secured.mode & 0o077) !== 0) {
      throw new HostPrivateStorageError();
    }
  } finally {
    await handle.close();
  }
}

interface PinnedHostPrivateDirectory {
  readonly device: number;
  readonly handle: FileHandle;
  readonly inode: number;
  readonly path: string;
}

interface HostPrivateFileIdentity {
  readonly device: number;
  readonly inode: number;
}

interface PinnedSqliteInspection<T> {
  readonly identity: HostPrivateFileIdentity;
  readonly value: T;
}

interface FixedMainSqliteInspection<T> extends PinnedSqliteInspection<T> {
  readonly shm: HostPrivateFileIdentity | undefined;
  readonly wal: HostPrivateFileIdentity | undefined;
}

interface FixedMainRawArtifactInspection {
  readonly directory: HostPrivateFileIdentity;
  readonly files: readonly (HostPrivateFileIdentity & {
    readonly name: string;
  })[];
}

interface ProductionIndexIdentity {
  readonly database: HostPrivateFileIdentity;
  readonly directory: HostPrivateFileIdentity;
  readonly shm: HostPrivateFileIdentity | undefined;
  readonly wal: HostPrivateFileIdentity | undefined;
}

interface PreparedProductionStorage {
  readonly indexIdentity: ProductionIndexIdentity;
  readonly mode: "new-production" | "legacy-production" | "modern-production";
}

function requireHostPrivateDirectoryMetadata(metadata: Stats): void {
  if (
    !metadata.isDirectory() ||
    !isOwnedByCurrentUser(metadata.uid) ||
    (metadata.mode & 0o777) !== 0o700
  ) {
    throw new HostPrivateStorageError();
  }
}

async function requireHostPrivateDirectorySelection(
  path: string,
): Promise<void> {
  if (!isAbsolute(path)) {
    throw new HostPrivateStorageError();
  }
  requireHostPrivateDirectoryMetadata(await lstat(path));
  if ((await realpath(path)) !== resolve(path)) {
    throw new HostPrivateStorageError();
  }
}

async function requirePinnedHostPrivateDirectory(
  directory: PinnedHostPrivateDirectory,
): Promise<void> {
  const pinnedMetadata = await directory.handle.stat();
  requireHostPrivateDirectoryMetadata(pinnedMetadata);
  if (
    pinnedMetadata.dev !== directory.device ||
    pinnedMetadata.ino !== directory.inode ||
    (await realpath(directory.path)) !== directory.path
  ) {
    throw new HostPrivateStorageError();
  }
  const selectedHandle = await open(
    directory.path,
    fsConstants.O_RDONLY | fsConstants.O_DIRECTORY | fsConstants.O_NOFOLLOW,
  );
  try {
    const selectedMetadata = await selectedHandle.stat();
    requireHostPrivateDirectoryMetadata(selectedMetadata);
    if (
      selectedMetadata.dev !== directory.device ||
      selectedMetadata.ino !== directory.inode
    ) {
      throw new HostPrivateStorageError();
    }
  } finally {
    await selectedHandle.close();
  }
}

async function openPinnedHostPrivateDirectory(
  path: string,
): Promise<PinnedHostPrivateDirectory> {
  if (!isAbsolute(path)) {
    throw new HostPrivateStorageError();
  }
  const normalizedPath = resolve(path);
  await requireHostPrivateDirectorySelection(path);
  const handle = await open(
    path,
    fsConstants.O_RDONLY | fsConstants.O_DIRECTORY | fsConstants.O_NOFOLLOW,
  );
  try {
    const metadata = await handle.stat();
    requireHostPrivateDirectoryMetadata(metadata);
    const directory = {
      device: metadata.dev,
      handle,
      inode: metadata.ino,
      path: normalizedPath,
    };
    await requirePinnedHostPrivateDirectory(directory);
    return directory;
  } catch (error) {
    await handle.close();
    throw error;
  }
}

async function requireHostPrivateDirectory(path: string): Promise<void> {
  const directory = await openPinnedHostPrivateDirectory(path);
  await directory.handle.close();
}

async function selectedPathExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) {
      return false;
    }
    throw error;
  }
}

async function openHostPrivateRegularFile(path: string, create: boolean) {
  const existingFlags = fsConstants.O_RDWR | fsConstants.O_NOFOLLOW;
  try {
    return await open(path, existingFlags);
  } catch (error) {
    if (!create || !hasErrorCode(error, "ENOENT")) {
      throw error;
    }
  }
  try {
    return await open(
      path,
      existingFlags | fsConstants.O_CREAT | fsConstants.O_EXCL,
      0o600,
    );
  } catch (error) {
    if (!hasErrorCode(error, "EEXIST")) {
      throw error;
    }
    return open(path, existingFlags);
  }
}

async function secureHostPrivateRegularFile(
  path: string,
  create: boolean,
  expectedIdentity?: HostPrivateFileIdentity,
): Promise<void> {
  let handle: FileHandle;
  try {
    handle = await openHostPrivateRegularFile(path, create);
  } catch (error) {
    if (!create && hasErrorCode(error, "ENOENT")) {
      return;
    }
    throw error;
  }
  try {
    const metadata = await handle.stat();
    if (
      !metadata.isFile() ||
      !isOwnedByCurrentUser(metadata.uid) ||
      (expectedIdentity !== undefined &&
        (metadata.dev !== expectedIdentity.device ||
          metadata.ino !== expectedIdentity.inode))
    ) {
      throw new HostPrivateStorageError();
    }
    await handle.chmod(0o600);
    const secured = await handle.stat();
    if (!secured.isFile() || (secured.mode & 0o077) !== 0) {
      throw new HostPrivateStorageError();
    }
  } finally {
    await handle.close();
  }
}

async function requireOwnedRegularFile(path: string): Promise<void> {
  const metadata = await lstat(path);
  if (!metadata.isFile() || !isOwnedByCurrentUser(metadata.uid)) {
    throw new HostPrivateStorageError();
  }
}

async function requireOwnedRealDirectory(path: string): Promise<void> {
  if (!isAbsolute(path)) {
    throw new HostPrivateStorageError();
  }
  const metadata = await lstat(path);
  if (!metadata.isDirectory() || !isOwnedByCurrentUser(metadata.uid)) {
    throw new HostPrivateStorageError();
  }
  if ((await realpath(path)) !== resolve(path)) {
    throw new HostPrivateStorageError();
  }
}

async function inspectPinnedSqlite<T>(
  path: string,
  inspection: (database: Database.Database) => T,
): Promise<PinnedSqliteInspection<T>> {
  const handle = await open(
    path,
    fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW | fsConstants.O_NONBLOCK,
  );
  try {
    const before = await handle.stat();
    if (!before.isFile() || !isOwnedByCurrentUser(before.uid)) {
      throw new HostPrivateStorageError();
    }
    let database: Database.Database | undefined;
    try {
      database = new Database(`/proc/self/fd/${handle.fd}`, {
        fileMustExist: true,
        readonly: true,
      });
      const result = inspection(database);
      const after = await handle.stat();
      if (
        !after.isFile() ||
        !isOwnedByCurrentUser(after.uid) ||
        after.dev !== before.dev ||
        after.ino !== before.ino
      ) {
        throw new HostPrivateStorageError();
      }
      return {
        identity: { device: after.dev, inode: after.ino },
        value: result,
      };
    } catch (error) {
      if (
        error instanceof SnapshotConflictError ||
        error instanceof HostPrivateStorageError
      ) {
        throw error;
      }
      throw new SnapshotConflictError();
    } finally {
      database?.close();
    }
  } finally {
    await handle.close();
  }
}

async function ownedRegularFileIdentity(
  path: string,
  optional = false,
): Promise<HostPrivateFileIdentity | undefined> {
  let handle: FileHandle;
  try {
    handle = await open(
      path,
      fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW | fsConstants.O_NONBLOCK,
    );
  } catch (error) {
    if (optional && hasErrorCode(error, "ENOENT")) {
      return undefined;
    }
    throw error;
  }
  try {
    const metadata = await handle.stat();
    if (
      !metadata.isFile() ||
      !isOwnedByCurrentUser(metadata.uid) ||
      ![0o600, 0o644].includes(metadata.mode & 0o777)
    ) {
      throw new HostPrivateStorageError();
    }
    return { device: metadata.dev, inode: metadata.ino };
  } finally {
    await handle.close();
  }
}

async function readOwnedRegularFile(
  path: string,
  optional = false,
): Promise<
  | {
      readonly bytes: Buffer;
      readonly identity: HostPrivateFileIdentity;
    }
  | undefined
> {
  let handle: FileHandle;
  try {
    handle = await open(
      path,
      fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW | fsConstants.O_NONBLOCK,
    );
  } catch (error) {
    if (optional && hasErrorCode(error, "ENOENT")) {
      return undefined;
    }
    throw error;
  }
  try {
    const metadata = await handle.stat();
    if (
      !metadata.isFile() ||
      !isOwnedByCurrentUser(metadata.uid) ||
      ![0o600, 0o644].includes(metadata.mode & 0o777)
    ) {
      throw new HostPrivateStorageError();
    }
    return {
      bytes: await handle.readFile(),
      identity: { device: metadata.dev, inode: metadata.ino },
    };
  } finally {
    await handle.close();
  }
}

function sameOptionalFileIdentity(
  expected: HostPrivateFileIdentity | undefined,
  actual: HostPrivateFileIdentity | undefined,
): boolean {
  return (
    expected === actual ||
    (expected !== undefined &&
      actual !== undefined &&
      expected.device === actual.device &&
      expected.inode === actual.inode)
  );
}

async function inspectFixedMainSqlite<T>(
  path: string,
  inspection: (database: Database.Database) => T,
): Promise<FixedMainSqliteInspection<T>> {
  const main = await readOwnedRegularFile(path);
  if (main === undefined) {
    throw new HostPrivateStorageError();
  }
  const wal = await readOwnedRegularFile(`${path}-wal`, true);
  const shm = await ownedRegularFileIdentity(`${path}-shm`, true);
  if ((wal === undefined) !== (shm === undefined)) {
    throw new SnapshotConflictError();
  }
  const scratch = await mkdtemp(
    join(tmpdir(), "wordfence-fixed-main-inspection-"),
  );
  const scratchDatabasePath = join(scratch, "target-intelligence.sqlite");
  try {
    await writeFile(scratchDatabasePath, main.bytes, {
      flag: "wx",
      mode: 0o600,
    });
    if (wal !== undefined) {
      await writeFile(`${scratchDatabasePath}-wal`, wal.bytes, {
        flag: "wx",
        mode: 0o600,
      });
    }
    let database: Database.Database | undefined;
    let value: T;
    try {
      database = new Database(scratchDatabasePath, {
        fileMustExist: true,
        readonly: true,
      });
      value = inspection(database);
    } catch (error) {
      if (
        error instanceof SnapshotConflictError ||
        error instanceof HostPrivateStorageError
      ) {
        throw error;
      }
      throw new SnapshotConflictError();
    } finally {
      database?.close();
    }
    const selectedMain = await ownedRegularFileIdentity(path);
    const selectedWal = await ownedRegularFileIdentity(`${path}-wal`, true);
    const selectedShm = await ownedRegularFileIdentity(`${path}-shm`, true);
    if (
      !sameOptionalFileIdentity(main.identity, selectedMain) ||
      !sameOptionalFileIdentity(wal?.identity, selectedWal) ||
      !sameOptionalFileIdentity(shm, selectedShm)
    ) {
      throw new HostPrivateStorageError();
    }
    return {
      identity: main.identity,
      shm,
      value,
      wal: wal?.identity,
    };
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

async function inspectFixedMainRawArtifacts(
  path: string,
  requiredContentDigests: readonly string[],
): Promise<FixedMainRawArtifactInspection | undefined> {
  if (!(await selectedPathExists(path))) {
    if (requiredContentDigests.length > 0) {
      throw new SnapshotConflictError();
    }
    return undefined;
  }
  if ((await realpath(path)) !== resolve(path)) {
    throw new HostPrivateStorageError();
  }
  const directory = await open(
    path,
    fsConstants.O_RDONLY | fsConstants.O_DIRECTORY | fsConstants.O_NOFOLLOW,
  );
  try {
    const directoryMetadata = await directory.stat();
    if (
      !directoryMetadata.isDirectory() ||
      !isOwnedByCurrentUser(directoryMetadata.uid)
    ) {
      throw new HostPrivateStorageError();
    }
    const names = await readdir(`/proc/self/fd/${directory.fd}`);
    const files: Array<HostPrivateFileIdentity & { readonly name: string }> =
      [];
    const presentContentDigests = new Set<string>();
    for (const name of names) {
      const match = /^([a-f0-9]{64})\.json$/u.exec(name);
      if (match === null) {
        throw new SnapshotConflictError();
      }
      const handle = await open(
        join(`/proc/self/fd/${directory.fd}`, name),
        fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW | fsConstants.O_NONBLOCK,
      );
      try {
        const metadata = await handle.stat();
        if (
          !metadata.isFile() ||
          !isOwnedByCurrentUser(metadata.uid) ||
          ![0o400, 0o644].includes(metadata.mode & 0o777)
        ) {
          throw new SnapshotConflictError();
        }
        const contentDigest = rawDigest(await handle.readFile());
        if (contentDigest !== `sha256:${match[1]}`) {
          throw new SnapshotConflictError();
        }
        presentContentDigests.add(contentDigest);
        files.push({
          device: metadata.dev,
          inode: metadata.ino,
          name,
        });
      } finally {
        await handle.close();
      }
    }
    if (
      requiredContentDigests.some(
        (contentDigest) => !presentContentDigests.has(contentDigest),
      )
    ) {
      throw new SnapshotConflictError();
    }
    const after = await directory.stat();
    if (
      after.dev !== directoryMetadata.dev ||
      after.ino !== directoryMetadata.ino
    ) {
      throw new HostPrivateStorageError();
    }
    return {
      directory: { device: after.dev, inode: after.ino },
      files,
    };
  } finally {
    await directory.close();
  }
}

async function secureFixedMainRawArtifacts(
  path: string,
  inspection: FixedMainRawArtifactInspection | undefined,
): Promise<void> {
  if (inspection === undefined) {
    await secureHostPrivateDirectory(path);
    return;
  }
  const directory = await open(
    path,
    fsConstants.O_RDONLY | fsConstants.O_DIRECTORY | fsConstants.O_NOFOLLOW,
  );
  try {
    const metadata = await directory.stat();
    if (
      !metadata.isDirectory() ||
      !isOwnedByCurrentUser(metadata.uid) ||
      metadata.dev !== inspection.directory.device ||
      metadata.ino !== inspection.directory.inode
    ) {
      throw new HostPrivateStorageError();
    }
    for (const expected of inspection.files) {
      const handle = await open(
        join(`/proc/self/fd/${directory.fd}`, expected.name),
        fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW | fsConstants.O_NONBLOCK,
      );
      try {
        const file = await handle.stat();
        if (
          !file.isFile() ||
          !isOwnedByCurrentUser(file.uid) ||
          file.dev !== expected.device ||
          file.ino !== expected.inode
        ) {
          throw new HostPrivateStorageError();
        }
        await handle.chmod(0o400);
      } finally {
        await handle.close();
      }
    }
    await directory.chmod(0o700);
  } finally {
    await directory.close();
  }
}

async function prepareHostPrivateSqliteStorage(
  path: string,
  expectedIdentity?: HostPrivateFileIdentity,
): Promise<void> {
  if (!isAbsolute(path)) {
    throw new HostPrivateStorageError();
  }
  await secureHostPrivateDirectory(dirname(path));
  await secureHostPrivateRegularFile(path, true, expectedIdentity);
}

async function secureCreatedSqliteSidecars(
  path: string,
  prepared: ProductionIndexIdentity,
): Promise<void> {
  if (prepared.wal === undefined) {
    await secureHostPrivateRegularFile(`${path}-wal`, false);
  }
  if (prepared.shm === undefined) {
    await secureHostPrivateRegularFile(`${path}-shm`, false);
  }
}

async function hostPrivateRegularFileIdentity(
  path: string,
  optional = false,
): Promise<HostPrivateFileIdentity | undefined> {
  const selectedMetadata = await hostPrivateRegularFileSelection(
    path,
    optional,
  );
  if (selectedMetadata === undefined) {
    return undefined;
  }
  let handle: FileHandle;
  try {
    handle = await open(
      path,
      fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW | fsConstants.O_NONBLOCK,
    );
  } catch (error) {
    if (optional && hasErrorCode(error, "ENOENT")) {
      return undefined;
    }
    if (hasErrorCode(error, "ELOOP")) {
      throw new HostPrivateStorageError();
    }
    throw error;
  }
  try {
    const metadata = await handle.stat();
    if (
      !metadata.isFile() ||
      !isOwnedByCurrentUser(metadata.uid) ||
      (metadata.mode & 0o777) !== 0o600 ||
      metadata.dev !== selectedMetadata.dev ||
      metadata.ino !== selectedMetadata.ino
    ) {
      throw new HostPrivateStorageError();
    }
    return { device: metadata.dev, inode: metadata.ino };
  } finally {
    await handle.close();
  }
}

async function hostPrivateRegularFileSelection(
  path: string,
  optional = false,
): Promise<Stats | undefined> {
  let metadata: Stats;
  try {
    metadata = await lstat(path);
  } catch (error) {
    if (optional && hasErrorCode(error, "ENOENT")) {
      return undefined;
    }
    throw error;
  }
  if (
    !metadata.isFile() ||
    !isOwnedByCurrentUser(metadata.uid) ||
    (metadata.mode & 0o777) !== 0o600
  ) {
    throw new HostPrivateStorageError();
  }
  return metadata;
}

function sameFileIdentity(
  left: HostPrivateFileIdentity | undefined,
  right: HostPrivateFileIdentity | undefined,
): boolean {
  return (
    left !== undefined &&
    right !== undefined &&
    left.device === right.device &&
    left.inode === right.inode
  );
}

function requirePreparedIndexIdentity(
  prepared: ProductionIndexIdentity,
  opened: ProductionIndexIdentity,
): void {
  if (
    !sameFileIdentity(prepared.directory, opened.directory) ||
    !sameFileIdentity(prepared.database, opened.database) ||
    (prepared.wal !== undefined &&
      !sameFileIdentity(prepared.wal, opened.wal)) ||
    (prepared.shm !== undefined && !sameFileIdentity(prepared.shm, opened.shm))
  ) {
    throw new HostPrivateStorageError();
  }
}

function requireMatchingIndexIdentity(
  expected: ProductionIndexIdentity,
  selected: ProductionIndexIdentity,
): void {
  if (
    !sameFileIdentity(expected.directory, selected.directory) ||
    !sameFileIdentity(expected.database, selected.database) ||
    !sameFileIdentity(expected.wal, selected.wal) ||
    !sameFileIdentity(expected.shm, selected.shm)
  ) {
    throw new HostPrivateStorageError();
  }
}

async function productionIndexIdentity(
  databasePath: string,
  requireSidecars: boolean,
): Promise<ProductionIndexIdentity> {
  const indexDirectory = await openPinnedHostPrivateDirectory(
    dirname(databasePath),
  );
  try {
    const database = await hostPrivateRegularFileIdentity(databasePath);
    const wal = await hostPrivateRegularFileIdentity(
      `${databasePath}-wal`,
      !requireSidecars,
    );
    const shm = await hostPrivateRegularFileIdentity(
      `${databasePath}-shm`,
      !requireSidecars,
    );
    if (
      database === undefined ||
      (requireSidecars && (wal === undefined || shm === undefined))
    ) {
      throw new HostPrivateStorageError();
    }
    return {
      database,
      directory: {
        device: indexDirectory.device,
        inode: indexDirectory.inode,
      },
      shm,
      wal,
    };
  } finally {
    await indexDirectory.handle.close();
  }
}

async function prepareProductionStorage(
  databasePath: string,
  artifactDirectory: string,
  adoptLegacyStorage: boolean,
): Promise<PreparedProductionStorage> {
  const rawDirectory = join(artifactDirectory, "wordfence-intelligence-v3");
  const databaseExists = await selectedPathExists(databasePath);
  const walExists = await selectedPathExists(`${databasePath}-wal`);
  const shmExists = await selectedPathExists(`${databasePath}-shm`);
  const rawDirectoryExists = await selectedPathExists(rawDirectory);

  if (!databaseExists) {
    if (walExists || shmExists) {
      throw new HostPrivateStorageError();
    }
    if (rawDirectoryExists) {
      await requireHostPrivateDirectorySelection(rawDirectory);
    }
    await prepareHostPrivateSqliteStorage(databasePath);
    if (rawDirectoryExists) {
      await requireHostPrivateDirectory(rawDirectory);
    } else {
      await secureHostPrivateDirectory(rawDirectory);
    }
    return {
      indexIdentity: await productionIndexIdentity(databasePath, false),
      mode: "new-production",
    };
  }

  if (adoptLegacyStorage) {
    await requireOwnedRealDirectory(dirname(databasePath));
    await requireOwnedRegularFile(databasePath);
    const inspectedDatabase = await inspectFixedMainSqlite(
      databasePath,
      requireFixedMainLegacyProductionStorage,
    );
    const inspectedRawArtifacts = await inspectFixedMainRawArtifacts(
      rawDirectory,
      inspectedDatabase.value,
    );
    await prepareHostPrivateSqliteStorage(
      databasePath,
      inspectedDatabase.identity,
    );
    if (inspectedDatabase.wal !== undefined) {
      await secureHostPrivateRegularFile(
        `${databasePath}-wal`,
        false,
        inspectedDatabase.wal,
      );
    }
    if (inspectedDatabase.shm !== undefined) {
      await secureHostPrivateRegularFile(
        `${databasePath}-shm`,
        false,
        inspectedDatabase.shm,
      );
    }
    await secureFixedMainRawArtifacts(rawDirectory, inspectedRawArtifacts);
    return {
      indexIdentity: await productionIndexIdentity(databasePath, false),
      mode: "legacy-production",
    };
  }

  if (!rawDirectoryExists) {
    throw new HostPrivateStorageError();
  }
  await requireHostPrivateDirectorySelection(dirname(databasePath));
  await hostPrivateRegularFileSelection(databasePath);
  await hostPrivateRegularFileSelection(`${databasePath}-wal`, true);
  await hostPrivateRegularFileSelection(`${databasePath}-shm`, true);
  await requireHostPrivateDirectorySelection(rawDirectory);
  await inspectPinnedSqlite(databasePath, (database) => {
    requireModernProductionStorage(database);
  });
  return {
    indexIdentity: await productionIndexIdentity(databasePath, false),
    mode: "modern-production",
  };
}

async function requireProductionStorage(
  databasePath: string,
  artifactDirectory: string,
  expectedIndexIdentity: ProductionIndexIdentity,
): Promise<{
  readonly artifactDirectory: PinnedHostPrivateDirectory;
  readonly indexIdentity: ProductionIndexIdentity;
}> {
  const indexIdentity = await productionIndexIdentity(databasePath, true);
  requireMatchingIndexIdentity(expectedIndexIdentity, indexIdentity);
  return {
    artifactDirectory: await openPinnedHostPrivateDirectory(
      join(artifactDirectory, "wordfence-intelligence-v3"),
    ),
    indexIdentity,
  };
}

async function requireProductionIndexIdentity(
  databasePath: string,
  expectedIndexIdentity: ProductionIndexIdentity,
): Promise<void> {
  const selectedIndexIdentity = await productionIndexIdentity(
    databasePath,
    true,
  );
  requireMatchingIndexIdentity(expectedIndexIdentity, selectedIndexIdentity);
}

async function verifyHostPrivateArtifact(
  path: string,
  bytes: Uint8Array,
  requireHostPrivateMode: boolean,
): Promise<void> {
  let handle: FileHandle;
  try {
    handle = await open(
      path,
      fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW | fsConstants.O_NONBLOCK,
    );
  } catch (error) {
    if (hasErrorCode(error, "ELOOP")) {
      throw new ArtifactConflictError();
    }
    throw error;
  }
  await useFileHandle(handle, async (selected) => {
    const metadata = await selected.stat();
    if (
      !metadata.isFile() ||
      (requireHostPrivateMode &&
        (!isOwnedByCurrentUser(metadata.uid) ||
          (metadata.mode & 0o777) !== 0o400))
    ) {
      throw new ArtifactConflictError();
    }
    const existing = await selected.readFile();
    if (!existing.equals(bytes)) {
      throw new ArtifactConflictError();
    }
  });
}

async function verifyStoredArtifact(
  directory: PinnedHostPrivateDirectory,
  contentDigest: string,
): Promise<void> {
  await requirePinnedHostPrivateDirectory(directory);
  let handle: FileHandle;
  try {
    handle = await open(
      join(
        `/proc/self/fd/${directory.handle.fd}`,
        `${contentDigest.slice("sha256:".length)}.json`,
      ),
      fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW | fsConstants.O_NONBLOCK,
    );
  } catch (error) {
    if (hasErrorCode(error, "ELOOP")) {
      throw new ArtifactConflictError();
    }
    throw error;
  }
  await useFileHandle(handle, async (selected) => {
    const metadata = await selected.stat();
    if (
      !metadata.isFile() ||
      !isOwnedByCurrentUser(metadata.uid) ||
      (metadata.mode & 0o777) !== 0o400
    ) {
      throw new ArtifactConflictError();
    }
    if (rawDigest(await selected.readFile()) !== contentDigest) {
      throw new ArtifactConflictError();
    }
  });
  await requirePinnedHostPrivateDirectory(directory);
}

async function persistBytes(
  path: string,
  bytes: Uint8Array,
  pinnedDirectory?: PinnedHostPrivateDirectory,
): Promise<void> {
  const directory = dirname(path);
  if (
    pinnedDirectory !== undefined &&
    resolve(directory) !== pinnedDirectory.path
  ) {
    throw new HostPrivateStorageError();
  }
  if (pinnedDirectory !== undefined) {
    await requirePinnedHostPrivateDirectory(pinnedDirectory);
  }
  const operationDirectory =
    pinnedDirectory === undefined
      ? directory
      : `/proc/self/fd/${pinnedDirectory.handle.fd}`;
  const finalPath = join(operationDirectory, basename(path));
  const temporaryPath = join(
    operationDirectory,
    `.${basename(path)}.${process.pid}.${randomUUID()}.tmp`,
  );
  const directoryHandle =
    pinnedDirectory?.handle ??
    (await open(
      directory,
      fsConstants.O_RDONLY | fsConstants.O_DIRECTORY | fsConstants.O_NOFOLLOW,
    ));
  const ownsDirectoryHandle = pinnedDirectory === undefined;
  let ownsTemporaryPath = false;
  let operationError: unknown;
  let operationFailed = false;
  try {
    const handle = await open(temporaryPath, "wx", 0o600);
    ownsTemporaryPath = true;
    await useFileHandle(handle, async (selected) => {
      await selected.writeFile(bytes);
      await selected.sync();
      await selected.chmod(0o400);
      await selected.sync();
    });
    try {
      await link(temporaryPath, finalPath);
    } catch (error) {
      if (!hasErrorCode(error, "EEXIST")) {
        throw error;
      }
    }
    await verifyHostPrivateArtifact(
      finalPath,
      bytes,
      pinnedDirectory !== undefined,
    );
  } catch (error) {
    operationFailed = true;
    operationError = error;
  } finally {
    let finalizationError: unknown;
    if (ownsTemporaryPath) {
      try {
        await unlink(temporaryPath);
      } catch (error) {
        if (!hasErrorCode(error, "ENOENT")) {
          finalizationError = error;
        }
      }
    }
    try {
      await directoryHandle.sync();
    } catch (error) {
      finalizationError ??= error;
    }
    if (ownsDirectoryHandle) {
      try {
        await directoryHandle.close();
      } catch (error) {
        finalizationError ??= error;
      }
    }
    if (pinnedDirectory !== undefined) {
      try {
        await requirePinnedHostPrivateDirectory(pinnedDirectory);
      } catch (error) {
        finalizationError ??= error;
      }
    }
    if (operationFailed) {
      throw operationError;
    }
    if (finalizationError !== undefined) {
      throw finalizationError;
    }
  }
}

function failure(
  reason: WordfenceIntelligenceFailure["reason"],
  backoff?: WordfenceRateLimitBackoff,
): WordfenceIntelligenceFailure {
  return wordfenceIntelligenceFailureSchema.parse({
    kind: "wordfence-intelligence-result",
    schemaVersion: 1,
    status: "failed",
    reason,
    ...(backoff === undefined ? {} : { backoff }),
  });
}

function currentResult(
  snapshot: WordfenceIntelligenceSnapshot,
  snapshotRef: WordfenceIntelligenceSnapshotRef,
): WordfenceIntelligenceResult {
  return currentWordfenceIntelligenceSnapshotSchema.parse({
    kind: "wordfence-intelligence-result",
    schemaVersion: 1,
    status: "current",
    snapshot,
    snapshotRef,
  });
}

function responseFailure(
  response: WordfenceIntelligenceSourceResponse,
  clock: () => Date,
): WordfenceIntelligenceFailure | undefined {
  const { status } = response;
  if (status === 401 || status === 403) {
    return failure("authentication-failed");
  }
  if (status === 404) {
    return failure("not-found");
  }
  if (status === 429) {
    return failure(
      "rate-limited",
      response.backoff ?? unspecifiedRateLimitBackoff(clock()),
    );
  }
  if (status < 200 || status >= 300) {
    return failure("network-failure");
  }
  return undefined;
}

function unspecifiedRateLimitBackoff(now: Date): WordfenceRateLimitBackoff {
  return wordfenceRateLimitBackoffSchema.parse({
    kind: "wordfence-rate-limit-backoff",
    schemaVersion: 2,
    automaticRetries: 0,
    boundedAt: now.toISOString(),
    maximumDelaySeconds: MAXIMUM_RETRY_AFTER_SECONDS,
    retryAfter: { kind: "unspecified" },
  });
}

function normalizeDate(value: string | null): string | undefined {
  if (value === null) {
    return undefined;
  }
  const match = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/u.exec(
    value,
  );
  if (match === null) {
    throw new Error("Invalid Wordfence Intelligence date");
  }
  const [, year, month, day, hour, minute, second] = match;
  const iso = `${year}-${month}-${day}T${hour}:${minute}:${second}.000Z`;
  if (Number.isNaN(Date.parse(iso))) {
    throw new Error("Invalid Wordfence Intelligence date");
  }
  return iso;
}

function normalizeAttribution(
  value: unknown,
  requiresMitre: boolean,
): WordfenceKnownRecord["attribution"] {
  const parsed = rawCopyrightSchema.safeParse(value);
  if (!parsed.success || (requiresMitre && parsed.data.mitre === undefined)) {
    throw new AttributionMissingError();
  }
  const party = (input: z.infer<typeof rawAttributionPartySchema>) => ({
    notice: input.notice,
    license: input.license,
    licenseUrl: input.license_url,
  });
  return {
    message: parsed.data.message,
    wordfence: party(parsed.data.defiant),
    ...(parsed.data.mitre === undefined
      ? {}
      : { mitre: party(parsed.data.mitre) }),
  };
}

function normalizeFeed(bytes: Uint8Array): {
  readonly recordCount: number;
  readonly records: readonly WordfenceStoredPluginRecord[];
} {
  const decoded = JSON.parse(
    new TextDecoder("utf-8", { fatal: true }).decode(bytes),
  ) as unknown;
  const feed = rawFeedSchema.parse(decoded);
  const entries = Object.entries(feed).sort(([left], [right]) =>
    left < right ? -1 : left > right ? 1 : 0,
  );
  if (entries.length === 0) {
    throw new Error("Wordfence Intelligence feed is empty");
  }
  const recordsByIdentity = new Map<string, WordfenceStoredPluginRecord>();
  for (const [key, value] of entries) {
    const record = rawRecordSchema.parse(value);
    if (record.id !== key) {
      throw new Error("Wordfence Intelligence record identity mismatch");
    }
    const attribution = normalizeAttribution(
      record.copyrights,
      record.cve !== null,
    );
    for (const software of record.software) {
      if (software.type !== "plugin") {
        continue;
      }
      const identity = `${record.id}\0${software.slug}`;
      const affectedVersionIntervals = Object.values(
        software.affected_versions,
      ).map((interval) => ({
        fromVersion: interval.from_version,
        fromInclusive: interval.from_inclusive,
        toVersion: interval.to_version,
        toInclusive: interval.to_inclusive,
      }));
      const publishedAt = normalizeDate(record.published);
      const updatedAt = normalizeDate(record.updated);
      const normalized = wordfenceStoredPluginRecordSchema.parse({
        pluginSlug: software.slug,
        record: {
          recordId: record.id,
          affectedVersionIntervals,
          patchedVersions: [...software.patched_versions].sort(),
          ...(record.cwe === null ? {} : { cwe: record.cwe }),
          ...(record.cvss === null ? {} : { cvss: record.cvss }),
          ...(record.cve === null ? {} : { cve: record.cve }),
          ...(publishedAt === undefined ? {} : { publishedAt }),
          ...(updatedAt === undefined ? {} : { updatedAt }),
          attribution,
        },
      });
      const existing = recordsByIdentity.get(identity);
      if (existing === undefined) {
        recordsByIdentity.set(identity, normalized);
        continue;
      }
      const intervals = new Map(
        [
          ...existing.record.affectedVersionIntervals,
          ...normalized.record.affectedVersionIntervals,
        ].map((interval) => [canonicalJson(interval), interval]),
      );
      recordsByIdentity.set(
        identity,
        wordfenceStoredPluginRecordSchema.parse({
          ...existing,
          record: {
            ...existing.record,
            affectedVersionIntervals: [...intervals.entries()]
              .sort(([left], [right]) =>
                left < right ? -1 : left > right ? 1 : 0,
              )
              .map(([, interval]) => interval),
            patchedVersions: [
              ...new Set([
                ...existing.record.patchedVersions,
                ...normalized.record.patchedVersions,
              ]),
            ].sort(),
          },
        }),
      );
    }
  }
  const records = canonicalRecordOrder([...recordsByIdentity.values()]);
  return { recordCount: entries.length, records };
}

function snapshotReference(
  snapshot: WordfenceIntelligenceSnapshot,
): WordfenceIntelligenceSnapshotRef {
  const digest = sha256Digest(snapshot);
  return wordfenceIntelligenceSnapshotRefSchema.parse({
    kind: "wordfence-intelligence-snapshot-ref",
    schemaVersion: 1,
    id: shortId("wordfence-snapshot", digest),
    digest,
  });
}

function versionTokens(version: string): readonly (number | string)[] {
  return (version.toLowerCase().match(/[0-9]+|[a-z]+/gu) ?? []).map((token) =>
    /^[0-9]+$/u.test(token) ? Number(token) : token,
  );
}

function compareVersions(left: string, right: string): number {
  const leftTokens = versionTokens(left);
  const rightTokens = versionTokens(right);
  const length = Math.max(leftTokens.length, rightTokens.length);
  for (let index = 0; index < length; index += 1) {
    const leftToken = leftTokens[index];
    const rightToken = rightTokens[index];
    if (leftToken === rightToken) {
      continue;
    }
    if (leftToken === undefined) {
      const significant = rightTokens
        .slice(index)
        .find((token) => typeof token === "string" || token !== 0);
      return significant === undefined
        ? 0
        : typeof significant === "string"
          ? 1
          : -1;
    }
    if (rightToken === undefined) {
      const significant = leftTokens
        .slice(index)
        .find((token) => typeof token === "string" || token !== 0);
      return significant === undefined
        ? 0
        : typeof significant === "string"
          ? -1
          : 1;
    }
    if (typeof leftToken === "number" && typeof rightToken === "number") {
      return leftToken < rightToken ? -1 : 1;
    }
    if (typeof leftToken === "number") {
      return 1;
    }
    if (typeof rightToken === "number") {
      return -1;
    }
    return leftToken < rightToken ? -1 : 1;
  }
  return 0;
}

function intervalContains(
  interval: WordfenceKnownRecord["affectedVersionIntervals"][number],
  version: string,
): boolean {
  const afterLower =
    interval.fromVersion === "*" ||
    compareVersions(version, interval.fromVersion) > 0 ||
    (interval.fromInclusive &&
      compareVersions(version, interval.fromVersion) === 0);
  const beforeUpper =
    interval.toVersion === "*" ||
    compareVersions(version, interval.toVersion) < 0 ||
    (interval.toInclusive &&
      compareVersions(version, interval.toVersion) === 0);
  return afterLower && beforeUpper;
}

async function boundedResponseBytes(
  response: Response,
  maximumBytes: number,
): Promise<Uint8Array> {
  const declaredLength = response.headers.get("content-length");
  const contentEncoding = response.headers.get("content-encoding");
  const hasIdentityEncoding =
    contentEncoding === null ||
    contentEncoding.trim().toLowerCase() === "identity";
  const expectedLength =
    declaredLength !== null &&
    hasIdentityEncoding &&
    Number.isSafeInteger(Number(declaredLength))
      ? Number(declaredLength)
      : undefined;
  if (
    declaredLength !== null &&
    Number.isFinite(Number(declaredLength)) &&
    Number(declaredLength) > maximumBytes
  ) {
    throw new ResponseTooLargeError();
  }
  if (response.body === null) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > maximumBytes) {
      throw new ResponseTooLargeError();
    }
    if (expectedLength !== undefined && bytes.byteLength !== expectedLength) {
      throw new PartialResponseError();
    }
    return bytes;
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let bodyFailure: unknown;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) {
        break;
      }
      total += next.value.byteLength;
      if (total > maximumBytes) {
        try {
          await reader.cancel();
        } catch {
          // The byte-ceiling failure is primary; cancellation is best-effort cleanup.
        }
        throw new ResponseTooLargeError();
      }
      chunks.push(next.value);
    }
  } catch (error) {
    if (error instanceof ResponseTooLargeError) {
      bodyFailure = error;
    } else {
      try {
        await reader.cancel();
      } catch {
        // The incomplete-body failure is primary; cancellation is cleanup.
      }
      bodyFailure = new PartialResponseError();
    }
  }
  try {
    reader.releaseLock();
  } catch (error) {
    if (bodyFailure === undefined) {
      throw error;
    }
  }
  if (bodyFailure !== undefined) {
    throw bodyFailure;
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  if (expectedLength !== undefined && bytes.byteLength !== expectedLength) {
    throw new PartialResponseError();
  }
  return bytes;
}

function rateLimitBackoff(headers: Headers, now: Date) {
  const value = headers.get("retry-after");
  const boundedAt = now.toISOString();
  const earliestTimestamp = now.getTime();
  const latestTimestamp =
    earliestTimestamp + MAXIMUM_RETRY_AFTER_SECONDS * 1_000;
  let retryAfter:
    | { readonly kind: "unspecified" }
    | {
        readonly kind: "delay-seconds";
        readonly seconds: number;
        readonly capped: boolean;
      }
    | {
        readonly kind: "absolute-time";
        readonly at: string;
        readonly capped: boolean;
      } = { kind: "unspecified" };
  if (value !== null && /^\d+$/u.test(value)) {
    const normalizedSeconds = value.replace(/^0+(?=\d)/u, "");
    const maximumSeconds = String(MAXIMUM_RETRY_AFTER_SECONDS);
    const capped =
      normalizedSeconds.length > maximumSeconds.length ||
      (normalizedSeconds.length === maximumSeconds.length &&
        normalizedSeconds > maximumSeconds);
    retryAfter = {
      kind: "delay-seconds",
      seconds: capped ? MAXIMUM_RETRY_AFTER_SECONDS : Number(normalizedSeconds),
      capped,
    };
  } else if (value !== null) {
    const timestamp = Date.parse(value);
    if (!Number.isNaN(timestamp)) {
      const boundedTimestamp = Math.max(
        earliestTimestamp,
        Math.min(timestamp, latestTimestamp),
      );
      retryAfter = {
        kind: "absolute-time",
        at: new Date(boundedTimestamp).toISOString(),
        capped: boundedTimestamp !== timestamp,
      };
    }
  }
  return wordfenceRateLimitBackoffSchema.parse({
    kind: "wordfence-rate-limit-backoff",
    schemaVersion: 2,
    automaticRetries: 0,
    boundedAt,
    maximumDelaySeconds: MAXIMUM_RETRY_AFTER_SECONDS,
    retryAfter,
  });
}

class FetchWordfenceIntelligenceV3Adapter implements WordfenceIntelligenceV3Adapter {
  readonly sourceUrl: string;
  readonly #credentialResolver:
    ((reference: WordfenceSecretRef) => Promise<string> | string) | undefined;
  readonly #credentialBroker: HostPrivateCredentialBroker | undefined;
  readonly #fetch: typeof fetch;
  readonly #clock: () => Date;

  constructor(options: WordfenceIntelligenceV3FetchAdapterOptions) {
    this.sourceUrl = options.sourceUrl ?? DEFAULT_SOURCE_URL;
    this.#credentialResolver = options.credentialResolver;
    this.#credentialBroker = options.credentialBroker;
    this.#fetch = options.fetch ?? globalThis.fetch;
    this.#clock = options.clock ?? (() => new Date());
    if (
      (this.#credentialResolver === undefined) ===
      (this.#credentialBroker === undefined)
    ) {
      throw new Error(
        "Wordfence Intelligence requires exactly one credential source",
      );
    }
  }

  async retrieveProductionFeed(request: {
    readonly credential: WordfenceSecretRef;
    readonly maximumBytes: number;
  }): Promise<WordfenceIntelligenceSourceResponse> {
    if (this.#credentialBroker !== undefined) {
      let credentialWasProvided = false;
      try {
        return await this.#credentialBroker.resolve(
          request.credential,
          async (credential) => {
            credentialWasProvided = true;
            return this.#retrieveWithCredential(
              credential,
              request.maximumBytes,
            );
          },
        );
      } catch (error) {
        if (!credentialWasProvided) {
          throw new CredentialUnavailableError();
        }
        throw error;
      }
    }
    const credential = await this.#credentialResolver?.(request.credential);
    if (credential === undefined) {
      throw new CredentialUnavailableError();
    }
    return this.#retrieveWithCredential(credential, request.maximumBytes);
  }

  async #retrieveWithCredential(
    credential: string,
    maximumBytes: number,
  ): Promise<WordfenceIntelligenceSourceResponse> {
    if (credential.length === 0) {
      throw new CredentialUnavailableError();
    }
    const response = await this.#fetch(this.sourceUrl, {
      method: "GET",
      redirect: "manual",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${credential}`,
      },
    });
    const complete =
      response.status === 200 && !response.headers.has("content-range");
    return {
      status: response.status,
      sourceUrl: response.url || this.sourceUrl,
      complete,
      redirected: response.status >= 300 && response.status < 400,
      ...(response.status === 429
        ? { backoff: rateLimitBackoff(response.headers, this.#clock()) }
        : {}),
      bytes: complete
        ? await boundedResponseBytes(response, maximumBytes)
        : new Uint8Array(),
    };
  }
}

export function createWordfenceIntelligenceV3FetchAdapter(
  options: WordfenceIntelligenceV3FetchAdapterOptions,
): WordfenceIntelligenceV3Adapter {
  return new FetchWordfenceIntelligenceV3Adapter(options);
}

type WordfenceStorageOpenMode =
  "local" | "new-production" | "legacy-production" | "modern-production";

class SqliteWordfenceIntelligence implements WordfenceIntelligence {
  readonly #database: Database.Database;
  readonly #artifactDirectory: string;
  readonly #adapter: WordfenceIntelligenceV3Adapter;
  readonly #credential: WordfenceSecretRef;
  readonly #maximumFeedBytes: number;
  readonly #knownRecordAuthorizationProvider:
    | OpenWordfenceIntelligenceOptions["knownRecordAuthorizationProvider"]
    | undefined;
  readonly #clock: () => Date;
  readonly #productionComposition: boolean;
  readonly #productionStorageFormat: ProductionStorageFormat | undefined;

  constructor(
    options: OpenWordfenceIntelligenceOptions,
    storageOpenMode: WordfenceStorageOpenMode = "local",
  ) {
    this.#artifactDirectory = options.artifactDirectory;
    this.#adapter = options.adapter;
    this.#credential = wordfenceSecretRefSchema.parse(options.credential);
    this.#maximumFeedBytes = maximumFeedBytes(options.maximumFeedBytes);
    this.#knownRecordAuthorizationProvider =
      options.knownRecordAuthorizationProvider;
    this.#clock = options.clock ?? (() => new Date());
    this.#productionComposition = storageOpenMode !== "local";
    const database = new Database(options.databasePath);
    let productionFormat: ProductionStorageFormat | undefined;
    try {
      database.pragma("busy_timeout = 5000");
      if (storageOpenMode === "local") {
        database.pragma("journal_mode = WAL");
        database.exec(schemaCreationSql(false));
        initializeRecordSetStorage(database);
      } else if (storageOpenMode === "new-production") {
        initializeProductionStorage(database);
        productionFormat = productionStorageFormat();
      } else if (storageOpenMode === "legacy-production") {
        migrateLegacyProductionStorage(database);
        productionFormat = productionStorageFormat();
      } else {
        productionFormat = requireModernProductionStorage(database);
      }
      if (storageOpenMode !== "local") {
        database.pragma("journal_mode = WAL");
        database.exec("BEGIN IMMEDIATE; COMMIT");
      }
    } catch (error) {
      database.close();
      throw error;
    }
    this.#database = database;
    this.#productionStorageFormat = productionFormat;
  }

  close(): void {
    this.#database.close();
  }

  async refresh(
    requestValue: WordfenceIntelligenceRefreshRequest,
    productionArtifactDirectory?: PinnedHostPrivateDirectory,
    requireCurrentIndexIdentity?: () => Promise<void>,
  ): Promise<WordfenceIntelligenceResult> {
    wordfenceIntelligenceRefreshRequestSchema.parse(requestValue);
    this.#requireCurrentProductionStorageFormat();
    const startingIndexFailure = await this.#productionIndexFailure(
      requireCurrentIndexIdentity,
    );
    if (startingIndexFailure !== undefined) {
      return startingIndexFailure;
    }
    const refreshStart = this.#recordRefreshStart();
    if (refreshStart?.kind === "wordfence-intelligence-result") {
      return refreshStart;
    }
    const productionAttempt = refreshStart;
    let retrieval:
      | { readonly status: "succeeded"; readonly value: unknown }
      | { readonly error: unknown; readonly status: "failed" };
    try {
      retrieval = {
        status: "succeeded",
        value: await this.#adapter.retrieveProductionFeed({
          credential: this.#credential,
          maximumBytes: this.#maximumFeedBytes,
        }),
      };
    } catch (error) {
      retrieval = { error, status: "failed" };
    }
    const indexFailure = await this.#productionIndexFailure(
      requireCurrentIndexIdentity,
    );
    if (indexFailure !== undefined) {
      return indexFailure;
    }
    if (retrieval.status === "failed") {
      const { error } = retrieval;
      return this.#refreshFailure(
        error instanceof ResponseTooLargeError
          ? "response-byte-ceiling-exceeded"
          : error instanceof PartialResponseError
            ? "partial-response"
            : error instanceof CredentialUnavailableError
              ? "credential-unavailable"
              : "network-failure",
        undefined,
        productionAttempt,
      );
    }
    const parsedResponse = wordfenceIntelligenceSourceResponseSchema.safeParse(
      retrieval.value,
    );
    if (!parsedResponse.success) {
      return this.#refreshFailure("schema-drift", undefined, productionAttempt);
    }
    const response = parsedResponse.data;
    if (
      response.redirected === true ||
      response.sourceUrl !== this.#adapter.sourceUrl
    ) {
      return this.#refreshFailure(
        "source-mismatch",
        undefined,
        productionAttempt,
      );
    }
    const responseFailureResult = responseFailure(response, this.#clock);
    if (responseFailureResult !== undefined) {
      return this.#recordRefreshFailure(
        responseFailureResult,
        productionAttempt,
      );
    }
    if (!response.complete) {
      return this.#refreshFailure(
        "partial-response",
        undefined,
        productionAttempt,
      );
    }
    if (response.bytes.byteLength > this.#maximumFeedBytes) {
      return this.#refreshFailure(
        "response-byte-ceiling-exceeded",
        undefined,
        productionAttempt,
      );
    }
    let normalized: ReturnType<typeof normalizeFeed>;
    try {
      normalized = normalizeFeed(response.bytes);
    } catch (error) {
      return this.#refreshFailure(
        error instanceof AttributionMissingError
          ? "attribution-missing"
          : "schema-drift",
        undefined,
        productionAttempt,
      );
    }
    const contentDigest = rawDigest(response.bytes);
    const artifactDirectory = join(
      this.#artifactDirectory,
      "wordfence-intelligence-v3",
    );
    try {
      if (this.#productionComposition) {
        if (productionArtifactDirectory === undefined) {
          throw new HostPrivateStorageError();
        }
      } else {
        await mkdir(artifactDirectory, { recursive: true });
      }
      await persistBytes(
        join(artifactDirectory, `${contentDigest.slice(7)}.json`),
        response.bytes,
        productionArtifactDirectory,
      );
    } catch (error) {
      if (isStorageFailure(error)) {
        const persistenceIndexFailure = await this.#productionIndexFailure(
          requireCurrentIndexIdentity,
        );
        if (persistenceIndexFailure !== undefined) {
          return persistenceIndexFailure;
        }
        return this.#refreshFailure(
          "storage-failure",
          undefined,
          productionAttempt,
        );
      }
      throw error;
    }
    const publicationIndexFailure = await this.#productionIndexFailure(
      requireCurrentIndexIdentity,
    );
    if (publicationIndexFailure !== undefined) {
      return publicationIndexFailure;
    }
    const snapshot = wordfenceIntelligenceSnapshotSchema.parse({
      kind: "wordfence-intelligence-snapshot",
      schemaVersion: 1,
      retrievedAt: this.#clock().toISOString(),
      source: {
        sourceUrl: response.sourceUrl,
        contentDigest,
        parserVersion: "wordfence-intelligence-production-v3",
        recordCount: normalized.recordCount,
        complete: true,
      },
    });
    const snapshotRef = snapshotReference(snapshot);
    let durableProjection: WordfenceIntelligenceResult;
    try {
      durableProjection = this.#storeSnapshot(
        snapshot,
        snapshotRef,
        normalized.records,
        productionAttempt,
      );
    } catch (error) {
      if (isStorageFailure(error)) {
        const failureIndexFailure = await this.#productionIndexFailure(
          requireCurrentIndexIdentity,
        );
        if (failureIndexFailure !== undefined) {
          return failureIndexFailure;
        }
        return this.#refreshFailure(
          "storage-failure",
          undefined,
          productionAttempt,
        );
      }
      throw error;
    }
    return durableProjection;
  }

  async #productionIndexFailure(
    requireCurrentIndexIdentity: (() => Promise<void>) | undefined,
  ): Promise<WordfenceIntelligenceFailure | undefined> {
    if (!this.#productionComposition) {
      return undefined;
    }
    if (requireCurrentIndexIdentity === undefined) {
      throw new HostPrivateStorageError();
    }
    try {
      await requireCurrentIndexIdentity();
      return undefined;
    } catch (error) {
      if (isStorageFailure(error)) {
        return failure("storage-failure");
      }
      throw error;
    }
  }

  async inspect(
    requestValue: WordfenceIntelligenceInspectionRequest,
  ): Promise<WordfenceIntelligenceResult> {
    const request =
      wordfenceIntelligenceInspectionRequestSchema.parse(requestValue);
    return this.#inspectSnapshot(request);
  }

  #inspectSnapshot(
    request: WordfenceIntelligenceInspectionRequest,
  ): WordfenceIntelligenceResult {
    const ref = request.snapshotRef ?? this.#currentReference();
    if (ref === undefined) {
      return failure("not-refreshed");
    }
    const snapshot = this.#readSnapshot(ref);
    return currentResult(snapshot, ref);
  }

  async inspectProduction(
    requestValue: WordfenceIntelligenceInspectionRequest,
  ): Promise<WordfenceIntelligenceResult> {
    const request =
      wordfenceIntelligenceInspectionRequestSchema.parse(requestValue);
    const transaction = this.#database.transaction(() => {
      this.#requireCurrentProductionStorageFormat();
      return this.#productionProjection(request);
    });
    return transaction.deferred();
  }

  #requireCurrentProductionStorageFormat(): void {
    if (!this.#productionComposition) {
      return;
    }
    const expected = this.#productionStorageFormat;
    if (expected === undefined) {
      throw new SnapshotConflictError();
    }
    const current = requireModernProductionStorage(this.#database);
    if (canonicalJson(current) !== canonicalJson(expected)) {
      throw new SnapshotConflictError();
    }
  }

  #productionProjection(
    request: WordfenceIntelligenceInspectionRequest,
  ): WordfenceIntelligenceResult {
    const result = this.#inspectSnapshot(request);
    if (result.status === "current" || result.status === "stale") {
      if (
        this.#validatedRecordSet(result.snapshot, result.snapshotRef).kind !==
        "manifest-v1"
      ) {
        throw new SnapshotConflictError();
      }
    }
    const currentReference = this.#currentReference();
    if (
      request.snapshotRef !== undefined &&
      (currentReference === undefined ||
        request.snapshotRef.id !== currentReference.id ||
        request.snapshotRef.digest !== currentReference.digest)
    ) {
      return result;
    }
    this.#requireProductionRefreshBindings(currentReference?.digest);
    const activeAttempt = refreshAttemptRowSchema.optional().parse(
      this.#database
        .prepare(
          `SELECT sequence, attempted_at, current_snapshot_digest
               FROM wordfence_intelligence_refresh_attempts
              ORDER BY sequence DESC
              LIMIT 1`,
        )
        .get(),
    );
    const row = refreshStateRowSchema.optional().parse(
      this.#database
        .prepare(
          `SELECT state_json
             FROM wordfence_intelligence_refresh_state
            WHERE singleton = 1`,
        )
        .get(),
    );
    if (activeAttempt !== undefined) {
      if (result.status === "failed") {
        if (
          result.reason === "not-refreshed" &&
          activeAttempt.current_snapshot_digest === null
        ) {
          return failure("storage-failure");
        }
        if (result.reason === "not-refreshed") {
          throw new SnapshotConflictError();
        }
        return result;
      }
      if (activeAttempt.current_snapshot_digest !== result.snapshotRef.digest) {
        throw new SnapshotConflictError();
      }
      return staleWordfenceIntelligenceSnapshotSchema.parse({
        ...result,
        status: "stale",
        latestRefresh: {
          kind: "wordfence-intelligence-refresh-attempt",
          schemaVersion: 1,
          attemptedAt: activeAttempt.attempted_at,
          result: failure("storage-failure"),
        },
      });
    }
    if (row === undefined) {
      return result;
    }
    const state = productionRefreshStateSchema.parse(
      JSON.parse(row.state_json),
    );
    const currentSnapshotDigest = state.currentSnapshotDigest;
    const latestRefresh =
      state.kind === "wordfence-intelligence-production-refresh-in-progress"
        ? wordfenceIntelligenceRefreshAttemptSchema.parse({
            kind: "wordfence-intelligence-refresh-attempt",
            schemaVersion: 1,
            attemptedAt: state.attemptedAt,
            result: failure("storage-failure"),
          })
        : state.latestRefresh;
    if (result.status === "failed") {
      if (
        result.reason === "not-refreshed" &&
        currentSnapshotDigest === undefined
      ) {
        return latestRefresh.result;
      }
      if (result.reason === "not-refreshed") {
        throw new SnapshotConflictError();
      }
      return result;
    }
    if (result.status === "stale") {
      return result;
    }
    if (currentSnapshotDigest !== result.snapshotRef.digest) {
      throw new SnapshotConflictError();
    }
    return staleWordfenceIntelligenceSnapshotSchema.parse({
      ...result,
      status: "stale",
      latestRefresh,
    });
  }

  async requireCurrentProductionArtifact(
    directory: PinnedHostPrivateDirectory,
  ): Promise<void> {
    this.#requireCurrentProductionStorageFormat();
    const reference = this.#currentReference();
    if (reference === undefined) {
      return;
    }
    const snapshot = this.#readSnapshot(reference);
    if (this.#validatedRecordSet(snapshot, reference).kind !== "manifest-v1") {
      throw new SnapshotConflictError();
    }
    await verifyStoredArtifact(directory, snapshot.source.contentDigest);
  }

  async aggregate(
    requestValue: VulnerabilityHistoryAggregateRequest,
  ): Promise<VulnerabilityHistoryAggregate> {
    const request =
      vulnerabilityHistoryAggregateRequestSchema.parse(requestValue);
    const snapshot = this.#readSnapshot(request.snapshotRef);
    const records = this.#records(
      snapshot,
      request.snapshotRef,
      request.pluginIdentity.slice("wporg:".length),
    );
    const published = records.flatMap((record) =>
      record.publishedAt === undefined ? [] : [record.publishedAt],
    );
    const years = new Set(published.map((value) => value.slice(0, 4))).size;
    const lastPublishedAt = [...published].sort().at(-1);
    return vulnerabilityHistoryAggregateSchema.parse({
      kind: "vulnerability-history-aggregate",
      schemaVersion: 1,
      pluginIdentity: request.pluginIdentity,
      snapshotRef: request.snapshotRef,
      recordCount: records.length,
      disclosureDensity: {
        kind: "records-per-published-year",
        publishedYears: years,
        value: years === 0 ? 0 : Number((published.length / years).toFixed(6)),
      },
      ...(lastPublishedAt === undefined ? {} : { lastPublishedAt }),
    });
  }

  async inspectKnownRecords(
    requestValue: WordfenceKnownRecordInspectionRequest,
  ): Promise<WordfenceKnownRecordProjection> {
    const parsedRequest =
      wordfenceKnownRecordInspectionRequestSchema.safeParse(requestValue);
    if (!parsedRequest.success) {
      throw new WordfenceKnownRecordAccessError();
    }
    const request = parsedRequest.data;
    const authorization = await this.#verifyKnownRecordAuthorization(
      request.authorizationRef,
    );
    if (
      authorization.subject.pluginIdentity !== request.pluginIdentity ||
      authorization.subject.verifiedVersion !== request.verifiedVersion ||
      authorization.subject.canonicalFileManifestDigest !==
        request.canonicalFileManifestDigest
    ) {
      throw new WordfenceKnownRecordAccessError();
    }
    const snapshot = this.#readSnapshot(request.snapshotRef);
    const records = this.#records(
      snapshot,
      request.snapshotRef,
      request.pluginIdentity.slice("wporg:".length),
    ).filter((record) =>
      record.affectedVersionIntervals.some((interval) =>
        intervalContains(interval, request.verifiedVersion),
      ),
    );
    return wordfenceKnownRecordProjectionSchema.parse({
      kind: "wordfence-known-record-projection",
      schemaVersion: 2,
      pluginIdentity: request.pluginIdentity,
      verifiedVersion: request.verifiedVersion,
      canonicalFileManifestDigest: request.canonicalFileManifestDigest,
      snapshotRef: request.snapshotRef,
      authorizationRef: request.authorizationRef,
      verifiedFindingRef: authorization.verifiedFindingRef,
      purpose: authorization.purpose,
      records,
    });
  }

  async #verifyKnownRecordAuthorization(
    reference: KnownRecordAccessAuthorizationRef,
  ): Promise<KnownRecordAccessAuthorization> {
    if (this.#knownRecordAuthorizationProvider === undefined) {
      throw new WordfenceKnownRecordAccessError();
    }
    let unvalidated: unknown;
    try {
      const resolution =
        await this.#knownRecordAuthorizationProvider.resolve(reference);
      if (resolution.status !== "authorized") {
        throw new Error("Known-record access was denied");
      }
      unvalidated = resolution.authorization;
    } catch {
      throw new WordfenceKnownRecordAccessError();
    }
    const result = knownRecordAccessAuthorizationSchema.safeParse(unvalidated);
    if (!result.success) {
      throw new WordfenceKnownRecordAccessError();
    }
    const authorization = result.data;
    const { id, digest, ...body } = authorization;
    if (
      id !== reference.id ||
      digest !== reference.digest ||
      digest !== sha256Digest(body) ||
      id !== `known-record-access:${digest.slice(7, 31)}`
    ) {
      throw new WordfenceKnownRecordAccessError();
    }
    return authorization;
  }

  #storeSnapshot(
    snapshot: WordfenceIntelligenceSnapshot,
    reference: WordfenceIntelligenceSnapshotRef,
    records: readonly WordfenceStoredPluginRecord[],
    productionAttempt: ProductionRefreshAttemptToken | undefined,
  ): WordfenceIntelligenceResult {
    const transaction = this.#database.transaction(() => {
      this.#requireCurrentProductionStorageFormat();
      let refreshOrder: z.infer<typeof refreshOrderRowSchema> | undefined;
      if (productionAttempt !== undefined) {
        const currentSnapshotDigest = this.#currentReference()?.digest;
        this.#requireProductionRefreshBindings(currentSnapshotDigest);
        this.#requireActiveAttempt(productionAttempt);
        refreshOrder = this.#refreshOrder();
        if (refreshOrder === undefined) {
          throw new SnapshotConflictError();
        }
      }
      const snapshotJson = canonicalJson(snapshot);
      const existing = this.#snapshotRow(reference.digest);
      if (existing === undefined) {
        this.#database
          .prepare(
            `INSERT INTO wordfence_intelligence_snapshots (
               snapshot_digest, snapshot_id, snapshot_json
             ) VALUES (?, ?, ?)`,
          )
          .run(reference.digest, reference.id, snapshotJson);
        const insertRecord = this.#database.prepare(
          `INSERT INTO wordfence_intelligence_records (
             snapshot_digest, plugin_slug, record_id, record_json
           ) VALUES (?, ?, ?, ?)`,
        );
        for (const stored of records) {
          insertRecord.run(
            reference.digest,
            stored.pluginSlug,
            stored.record.recordId,
            canonicalJson(stored),
          );
        }
        this.#database
          .prepare(
            `INSERT INTO wordfence_intelligence_record_set_manifests (
               snapshot_digest, manifest_json
             ) VALUES (?, ?)`,
          )
          .run(
            reference.digest,
            canonicalJson(recordSetManifest(snapshot, reference, records)),
          );
      } else {
        if (
          existing.snapshot_id !== reference.id ||
          existing.snapshot_json !== snapshotJson
        ) {
          throw new SnapshotConflictError();
        }
        this.#assertStoredRecords(snapshot, reference, records);
      }
      if (productionAttempt === undefined) {
        this.#database
          .prepare(
            `INSERT INTO wordfence_intelligence_current (
               singleton, snapshot_digest
             ) VALUES (1, ?)
             ON CONFLICT(singleton) DO UPDATE SET
               snapshot_digest = excluded.snapshot_digest`,
          )
          .run(reference.digest);
        return currentResult(snapshot, reference);
      }
      if (refreshOrder === undefined) {
        throw new SnapshotConflictError();
      }
      const deletion = this.#database
        .prepare(
          `DELETE FROM wordfence_intelligence_refresh_attempts
                WHERE sequence = ?`,
        )
        .run(productionAttempt.sequence);
      if (deletion.changes !== 1) {
        throw new SnapshotConflictError();
      }
      const publishes =
        productionAttempt.sequence >= refreshOrder.publication_sequence;
      const publicationSequence = publishes
        ? productionAttempt.sequence
        : refreshOrder.publication_sequence;
      if (publishes) {
        this.#database
          .prepare(
            `INSERT INTO wordfence_intelligence_current (
               singleton, snapshot_digest
             ) VALUES (1, ?)
             ON CONFLICT(singleton) DO UPDATE SET
               snapshot_digest = excluded.snapshot_digest`,
          )
          .run(reference.digest);
        this.#database
          .prepare(
            `UPDATE wordfence_intelligence_refresh_attempts
                SET current_snapshot_digest = ?`,
          )
          .run(reference.digest);
        const state = this.#refreshState();
        if (
          state?.schemaVersion === 2 &&
          state.attemptSequence > productionAttempt.sequence
        ) {
          this.#database
            .prepare(
              `UPDATE wordfence_intelligence_refresh_state
                  SET state_json = ?
                WHERE singleton = 1`,
            )
            .run(
              canonicalJson({
                ...state,
                currentSnapshotDigest: reference.digest,
              }),
            );
        } else {
          this.#database
            .prepare(
              `DELETE FROM wordfence_intelligence_refresh_state
               WHERE singleton = 1`,
            )
            .run();
        }
      }
      this.#database
        .prepare(
          `UPDATE wordfence_intelligence_refresh_order
              SET publication_sequence = ?,
                  latest_completed_sequence = ?
            WHERE singleton = 1`,
        )
        .run(
          publicationSequence,
          Math.max(
            refreshOrder.latest_completed_sequence,
            productionAttempt.sequence,
          ),
        );
      return this.#productionProjection({
        kind: "wordfence-intelligence-inspection",
        schemaVersion: 1,
      });
    });
    return transaction.immediate();
  }

  #assertStoredRecords(
    snapshot: WordfenceIntelligenceSnapshot,
    reference: WordfenceIntelligenceSnapshotRef,
    records: readonly WordfenceStoredPluginRecord[],
  ): void {
    const validated = this.#validatedRecordSet(snapshot, reference);
    if (validated.kind === "legacy-record-only-v1") {
      throw new SnapshotConflictError();
    }
    const persisted = canonicalRecordOrder(validated.records);
    const expected = canonicalRecordOrder(records);
    if (
      persisted.length !== expected.length ||
      persisted.some((stored, index) => {
        const candidate = expected[index];
        return (
          candidate === undefined ||
          canonicalJson(stored) !== canonicalJson(candidate)
        );
      })
    ) {
      throw new SnapshotConflictError();
    }
  }

  #refreshFailure(
    reason: WordfenceIntelligenceFailure["reason"],
    backoff?: WordfenceRateLimitBackoff,
    productionAttempt?: ProductionRefreshAttemptToken,
  ): WordfenceIntelligenceResult {
    return this.#recordRefreshFailure(
      failure(reason, backoff),
      productionAttempt,
    );
  }

  #recordRefreshStart():
    ProductionRefreshAttemptToken | WordfenceIntelligenceResult | undefined {
    if (!this.#productionComposition) {
      return undefined;
    }
    try {
      const transaction = this.#database.transaction(() => {
        this.#requireCurrentProductionStorageFormat();
        const currentSnapshotDigest = this.#currentReference()?.digest;
        this.#requireProductionRefreshBindings(currentSnapshotDigest);
        const attemptedAt = this.#clock().toISOString();
        const format = this.#productionStorageFormat;
        if (format === undefined) {
          throw new SnapshotConflictError();
        }
        const order = this.#requireRefreshOrder();
        const activeAttempts = refreshAttemptRowSchema.array().parse(
          this.#database
            .prepare(
              `SELECT sequence, attempted_at, current_snapshot_digest
                 FROM wordfence_intelligence_refresh_attempts
                ORDER BY sequence`,
            )
            .all(),
        );
        const attemptedAtMillis = Date.parse(attemptedAt);
        const leaseMillis = format.refreshAttemptLeaseSeconds * 1_000;
        if (
          activeAttempts.some(
            (attempt) =>
              Date.parse(attempt.attempted_at) + leaseMillis >
              attemptedAtMillis,
          )
        ) {
          return this.#productionProjection({
            kind: "wordfence-intelligence-inspection",
            schemaVersion: 1,
          });
        }
        const recoveredAttempt = activeAttempts.at(-1);
        if (recoveredAttempt !== undefined) {
          const deletion = this.#database
            .prepare("DELETE FROM wordfence_intelligence_refresh_attempts")
            .run();
          if (deletion.changes !== activeAttempts.length) {
            throw new SnapshotConflictError();
          }
          if (recoveredAttempt.sequence > order.publication_sequence) {
            const state = productionSequencedRefreshStateSchema.parse({
              kind: "wordfence-intelligence-production-refresh-state",
              schemaVersion: 2,
              attemptSequence: recoveredAttempt.sequence,
              ...(currentSnapshotDigest === undefined
                ? {}
                : { currentSnapshotDigest }),
              latestRefresh: {
                kind: "wordfence-intelligence-refresh-attempt",
                schemaVersion: 1,
                attemptedAt: recoveredAttempt.attempted_at,
                result: failure("storage-failure"),
              },
            });
            this.#database
              .prepare(
                `INSERT INTO wordfence_intelligence_refresh_state (
                   singleton, state_json
                 ) VALUES (1, ?)
                 ON CONFLICT(singleton) DO UPDATE SET
                   state_json = excluded.state_json`,
              )
              .run(canonicalJson(state));
          }
          this.#database
            .prepare(
              `UPDATE wordfence_intelligence_refresh_order
                  SET latest_completed_sequence = ?
                WHERE singleton = 1`,
            )
            .run(
              Math.max(
                order.latest_completed_sequence,
                recoveredAttempt.sequence,
              ),
            );
        }
        const insertion = this.#database
          .prepare(
            `INSERT INTO wordfence_intelligence_refresh_attempts (
               attempted_at, current_snapshot_digest
             ) VALUES (?, ?)`,
          )
          .run(attemptedAt, currentSnapshotDigest ?? null);
        return {
          kind: "wordfence-production-refresh-attempt-token",
          sequence: refreshAttemptRowSchema.shape.sequence.parse(
            Number(insertion.lastInsertRowid),
          ),
          attemptedAt,
        } satisfies ProductionRefreshAttemptToken;
      });
      return transaction.immediate();
    } catch (error) {
      if (isStorageFailure(error)) {
        return failure("storage-failure");
      }
      throw error;
    }
  }

  #recordRefreshFailure(
    result: WordfenceIntelligenceFailure,
    productionAttempt?: ProductionRefreshAttemptToken,
  ): WordfenceIntelligenceResult {
    const parsed = wordfenceIntelligenceFailureSchema.parse(result);
    if (!this.#productionComposition) {
      return parsed;
    }
    try {
      const transaction = this.#database.transaction(() => {
        this.#requireCurrentProductionStorageFormat();
        const currentSnapshotDigest = this.#currentReference()?.digest;
        if (productionAttempt === undefined) {
          const state = productionCompletedRefreshStateSchema.parse({
            kind: "wordfence-intelligence-production-refresh-state",
            schemaVersion: 1,
            ...(currentSnapshotDigest === undefined
              ? {}
              : { currentSnapshotDigest }),
            latestRefresh: {
              kind: "wordfence-intelligence-refresh-attempt",
              schemaVersion: 1,
              attemptedAt: this.#clock().toISOString(),
              result: parsed,
            },
          });
          this.#database
            .prepare(
              `INSERT INTO wordfence_intelligence_refresh_state (
                 singleton, state_json
               ) VALUES (1, ?)
               ON CONFLICT(singleton) DO UPDATE SET
                 state_json = excluded.state_json`,
            )
            .run(canonicalJson(state));
          return this.#productionProjection({
            kind: "wordfence-intelligence-inspection",
            schemaVersion: 1,
          });
        }
        this.#requireProductionRefreshBindings(currentSnapshotDigest);
        this.#requireActiveAttempt(productionAttempt);
        const order = this.#refreshOrder();
        if (order === undefined) {
          throw new SnapshotConflictError();
        }
        const deletion = this.#database
          .prepare(
            `DELETE FROM wordfence_intelligence_refresh_attempts
                  WHERE sequence = ?`,
          )
          .run(productionAttempt.sequence);
        if (deletion.changes !== 1) {
          throw new SnapshotConflictError();
        }
        const existingState = this.#refreshState();
        if (
          productionAttempt.sequence > order.publication_sequence &&
          (existingState?.schemaVersion !== 2 ||
            productionAttempt.sequence >= existingState.attemptSequence)
        ) {
          const state = productionSequencedRefreshStateSchema.parse({
            kind: "wordfence-intelligence-production-refresh-state",
            schemaVersion: 2,
            attemptSequence: productionAttempt.sequence,
            ...(currentSnapshotDigest === undefined
              ? {}
              : { currentSnapshotDigest }),
            latestRefresh: {
              kind: "wordfence-intelligence-refresh-attempt",
              schemaVersion: 1,
              attemptedAt: productionAttempt.attemptedAt,
              result: parsed,
            },
          });
          this.#database
            .prepare(
              `INSERT INTO wordfence_intelligence_refresh_state (
                 singleton, state_json
               ) VALUES (1, ?)
               ON CONFLICT(singleton) DO UPDATE SET
                 state_json = excluded.state_json`,
            )
            .run(canonicalJson(state));
        }
        this.#database
          .prepare(
            `UPDATE wordfence_intelligence_refresh_order
                SET latest_completed_sequence = ?
              WHERE singleton = 1`,
          )
          .run(
            Math.max(
              order.latest_completed_sequence,
              productionAttempt.sequence,
            ),
          );
        return this.#productionProjection({
          kind: "wordfence-intelligence-inspection",
          schemaVersion: 1,
        });
      });
      return transaction.immediate();
    } catch (error) {
      if (isStorageFailure(error)) {
        return failure("storage-failure");
      }
      throw error;
    }
  }

  #refreshState(): z.infer<typeof productionRefreshStateSchema> | undefined {
    const row = refreshStateRowSchema.optional().parse(
      this.#database
        .prepare(
          `SELECT state_json
             FROM wordfence_intelligence_refresh_state
            WHERE singleton = 1`,
        )
        .get(),
    );
    return row === undefined
      ? undefined
      : productionRefreshStateSchema.parse(JSON.parse(row.state_json));
  }

  #refreshOrder(): z.infer<typeof refreshOrderRowSchema> | undefined {
    return refreshOrderRowSchema.optional().parse(
      this.#database
        .prepare(
          `SELECT publication_sequence, latest_completed_sequence
             FROM wordfence_intelligence_refresh_order
            WHERE singleton = 1`,
        )
        .get(),
    );
  }

  #requireRefreshOrder(): z.infer<typeof refreshOrderRowSchema> {
    const order = this.#refreshOrder();
    if (order === undefined) {
      throw new SnapshotConflictError();
    }
    return order;
  }

  #allocatedRefreshSequence(): number {
    const allocator = sqliteSequenceRowSchema.optional().parse(
      this.#database
        .prepare(
          `SELECT seq
             FROM sqlite_sequence
            WHERE name = 'wordfence_intelligence_refresh_attempts'`,
        )
        .get(),
    );
    if (allocator === undefined) {
      throw new SnapshotConflictError();
    }
    return allocator.seq;
  }

  #requireActiveAttempt(attempt: ProductionRefreshAttemptToken): void {
    const row = refreshAttemptRowSchema.optional().parse(
      this.#database
        .prepare(
          `SELECT sequence, attempted_at, current_snapshot_digest
             FROM wordfence_intelligence_refresh_attempts
            WHERE sequence = ?`,
        )
        .get(attempt.sequence),
    );
    if (row === undefined || row.attempted_at !== attempt.attemptedAt) {
      throw new SnapshotConflictError();
    }
  }

  #requireProductionRefreshBindings(
    currentSnapshotDigest: string | undefined,
  ): void {
    const state = this.#refreshState();
    if (state !== undefined) {
      if (state.currentSnapshotDigest !== currentSnapshotDigest) {
        throw new SnapshotConflictError();
      }
    }
    const attempts = refreshAttemptRowSchema.array().parse(
      this.#database
        .prepare(
          `SELECT sequence, attempted_at, current_snapshot_digest
             FROM wordfence_intelligence_refresh_attempts
            ORDER BY sequence`,
        )
        .all(),
    );
    if (
      attempts.some(
        (attempt) =>
          (attempt.current_snapshot_digest ?? undefined) !==
          currentSnapshotDigest,
      )
    ) {
      throw new SnapshotConflictError();
    }
    const allocatedSequence = this.#allocatedRefreshSequence();
    const order = this.#refreshOrder();
    if (order === undefined) {
      throw new SnapshotConflictError();
    }
    const activeSequence = attempts.at(-1)?.sequence ?? 0;
    const newerAttempts = attempts.filter(
      (attempt) => attempt.sequence > order.latest_completed_sequence,
    );
    if (
      order.publication_sequence > order.latest_completed_sequence ||
      order.publication_sequence > allocatedSequence ||
      order.latest_completed_sequence > allocatedSequence ||
      allocatedSequence !==
        Math.max(order.latest_completed_sequence, activeSequence) ||
      attempts.some(
        (attempt) => attempt.sequence === order.latest_completed_sequence,
      ) ||
      newerAttempts.length !==
        allocatedSequence - order.latest_completed_sequence ||
      newerAttempts.some(
        (attempt, index) =>
          attempt.sequence !== order.latest_completed_sequence + index + 1,
      )
    ) {
      throw new SnapshotConflictError();
    }
    if (order.publication_sequence > 0 && currentSnapshotDigest === undefined) {
      throw new SnapshotConflictError();
    }
    if (
      order.latest_completed_sequence > order.publication_sequence &&
      state?.schemaVersion !== 2
    ) {
      throw new SnapshotConflictError();
    }
    if (state?.schemaVersion === 2) {
      if (
        state.attemptSequence !== order.latest_completed_sequence ||
        state.attemptSequence <= order.publication_sequence
      ) {
        throw new SnapshotConflictError();
      }
    } else if (
      attempts.length === 0 &&
      state === undefined &&
      order.latest_completed_sequence !== order.publication_sequence
    ) {
      throw new SnapshotConflictError();
    }
  }

  #currentReference(): WordfenceIntelligenceSnapshotRef | undefined {
    const row = currentSnapshotRowSchema.optional().parse(
      this.#database
        .prepare(
          `SELECT c.snapshot_digest AS current_snapshot_digest,
                  s.snapshot_digest,
                  s.snapshot_id
           FROM wordfence_intelligence_current c
           LEFT JOIN wordfence_intelligence_snapshots s
             ON s.snapshot_digest = c.snapshot_digest
          WHERE c.singleton = 1`,
        )
        .get(),
    );
    if (row === undefined) {
      return undefined;
    }
    if (
      row.snapshot_digest === null ||
      row.snapshot_id === null ||
      row.current_snapshot_digest !== row.snapshot_digest
    ) {
      throw new SnapshotConflictError();
    }
    return wordfenceIntelligenceSnapshotRefSchema.parse({
      kind: "wordfence-intelligence-snapshot-ref",
      schemaVersion: 1,
      id: row.snapshot_id,
      digest: row.snapshot_digest,
    });
  }

  #readSnapshot(
    referenceValue: WordfenceIntelligenceSnapshotRef,
  ): WordfenceIntelligenceSnapshot {
    const reference =
      wordfenceIntelligenceSnapshotRefSchema.parse(referenceValue);
    const row = this.#snapshotRow(reference.digest);
    if (row === undefined) {
      throw new Error("Unknown Wordfence Intelligence snapshot");
    }
    const snapshot = wordfenceIntelligenceSnapshotSchema.parse(
      JSON.parse(row.snapshot_json),
    );
    const expected = snapshotReference(snapshot);
    if (
      row.snapshot_id !== reference.id ||
      expected.id !== reference.id ||
      expected.digest !== reference.digest
    ) {
      throw new Error("Wordfence Intelligence snapshot integrity mismatch");
    }
    return snapshot;
  }

  #snapshotRow(digest: string): SnapshotRow | undefined {
    return snapshotRowSchema.optional().parse(
      this.#database
        .prepare(
          `SELECT snapshot_digest, snapshot_id, snapshot_json
           FROM wordfence_intelligence_snapshots
          WHERE snapshot_digest = ?`,
        )
        .get(digest),
    );
  }

  #records(
    snapshot: WordfenceIntelligenceSnapshot,
    reference: WordfenceIntelligenceSnapshotRef,
    pluginSlug: string,
  ): readonly WordfenceKnownRecord[] {
    return this.#validatedRecordSet(snapshot, reference)
      .records.filter((stored) => stored.pluginSlug === pluginSlug)
      .map((stored) => stored.record);
  }

  #validatedRecordSet(
    snapshot: WordfenceIntelligenceSnapshot,
    reference: WordfenceIntelligenceSnapshotRef,
  ):
    | {
        readonly kind: "manifest-v1";
        readonly records: readonly WordfenceStoredPluginRecord[];
      }
    | {
        readonly kind: "legacy-record-only-v1";
        readonly records: readonly WordfenceStoredPluginRecord[];
      } {
    try {
      const manifestRow = recordSetManifestRowSchema.optional().parse(
        this.#database
          .prepare(
            `SELECT manifest_json
             FROM wordfence_intelligence_record_set_manifests
            WHERE snapshot_digest = ?`,
          )
          .get(reference.digest),
      );
      const legacyRow = legacyRecordSetRowSchema.optional().parse(
        this.#database
          .prepare(
            `SELECT legacy_json
             FROM wordfence_intelligence_legacy_record_sets
            WHERE snapshot_digest = ?`,
          )
          .get(reference.digest),
      );
      const rows = snapshotRecordRowSchema.array().parse(
        this.#database
          .prepare(
            `SELECT plugin_slug, record_id, record_json
             FROM wordfence_intelligence_records
            WHERE snapshot_digest = ?`,
          )
          .all(reference.digest),
      );
      if ((manifestRow === undefined) === (legacyRow === undefined)) {
        throw new SnapshotConflictError();
      }
      if (manifestRow !== undefined) {
        const manifest = recordSetManifestSchema.parse(
          JSON.parse(manifestRow.manifest_json),
        );
        const records = canonicalRecordOrder(
          rows.map((row) => {
            const stored = wordfenceStoredPluginRecordSchema.parse(
              JSON.parse(row.record_json),
            );
            if (
              stored.pluginSlug !== row.plugin_slug ||
              stored.record.recordId !== row.record_id
            ) {
              throw new SnapshotConflictError();
            }
            return stored;
          }),
        );
        const expectedManifest = recordSetManifest(
          snapshot,
          reference,
          records,
        );
        if (canonicalJson(manifest) !== canonicalJson(expectedManifest)) {
          throw new SnapshotConflictError();
        }
        return { kind: "manifest-v1", records };
      }
      if (legacyRow === undefined) {
        throw new SnapshotConflictError();
      }
      const legacy = legacyRecordSetSchema.parse(
        JSON.parse(legacyRow.legacy_json),
      );
      if (
        canonicalJson(legacy) !==
        canonicalJson(legacyRecordSet(snapshot, reference))
      ) {
        throw new SnapshotConflictError();
      }
      const records = canonicalRecordOrder(
        rows.map((row) => {
          const record = wordfenceKnownRecordSchema.parse(
            JSON.parse(row.record_json),
          );
          if (record.recordId !== row.record_id) {
            throw new SnapshotConflictError();
          }
          return wordfenceStoredPluginRecordSchema.parse({
            pluginSlug: row.plugin_slug,
            record,
          });
        }),
      );
      return { kind: "legacy-record-only-v1", records };
    } catch (error) {
      if (error instanceof SnapshotConflictError) {
        throw error;
      }
      throw new SnapshotConflictError();
    }
  }
}

export function openWordfenceIntelligence(
  options: OpenWordfenceIntelligenceOptions,
): WordfenceIntelligence {
  return new SqliteWordfenceIntelligence(options);
}

async function usePinnedProductionDirectory(
  directory: PinnedHostPrivateDirectory,
  operation: () => Promise<WordfenceIntelligenceResult>,
): Promise<WordfenceIntelligenceResult> {
  let result: WordfenceIntelligenceResult;
  try {
    result = await operation();
  } catch (error) {
    try {
      await directory.handle.close();
    } catch {
      // Preserve the primary operation failure.
    }
    throw error;
  }
  try {
    await directory.handle.close();
  } catch {
    return result.status === "current" ? failure("storage-failure") : result;
  }
  return result;
}

export function openWordfenceIntelligenceRefresh(
  options: OpenWordfenceIntelligenceRefreshOptions,
): WordfenceIntelligenceRefresh {
  const legacyStorageAdoption =
    options.legacyStorageAdoption === undefined
      ? undefined
      : wordfenceLegacyStorageAdoptionSchema.parse(
          options.legacyStorageAdoption,
        );
  const configuredMaximumFeedBytes = maximumFeedBytes(options.maximumFeedBytes);
  const adapter = createWordfenceIntelligenceV3FetchAdapter({
    credentialBroker: options.credentialBroker,
    ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
    ...(options.clock === undefined ? {} : { clock: options.clock }),
  });
  const intelligenceOptions: OpenWordfenceIntelligenceOptions = {
    databasePath: options.databasePath,
    artifactDirectory: options.artifactDirectory,
    adapter,
    credential: { kind: "secret-ref", id: "wordfence-v3-api-key" },
    maximumFeedBytes: configuredMaximumFeedBytes,
    ...(options.knownRecordAuthorizationProvider === undefined
      ? {}
      : {
          knownRecordAuthorizationProvider:
            options.knownRecordAuthorizationProvider,
        }),
    ...(options.clock === undefined ? {} : { clock: options.clock }),
  };
  let intelligence: SqliteWordfenceIntelligence | undefined;
  let indexIdentity: ProductionIndexIdentity | undefined;
  let initializationPromise: Promise<void> | undefined;
  const ensureInitialized = (): Promise<void> => {
    if (intelligence !== undefined) {
      return Promise.resolve();
    }
    if (initializationPromise !== undefined) {
      return initializationPromise;
    }
    const pending = (async () => {
      if (currentOwnerUid() === undefined) {
        throw new HostPrivateStorageError();
      }
      const preparedStorage = await prepareProductionStorage(
        intelligenceOptions.databasePath,
        intelligenceOptions.artifactDirectory,
        legacyStorageAdoption !== undefined,
      );
      const candidate = new SqliteWordfenceIntelligence(
        intelligenceOptions,
        preparedStorage.mode,
      );
      let openedIndexIdentity: ProductionIndexIdentity;
      try {
        await secureCreatedSqliteSidecars(
          intelligenceOptions.databasePath,
          preparedStorage.indexIdentity,
        );
        openedIndexIdentity = await productionIndexIdentity(
          intelligenceOptions.databasePath,
          true,
        );
        requirePreparedIndexIdentity(
          preparedStorage.indexIdentity,
          openedIndexIdentity,
        );
      } catch (error) {
        candidate.close();
        throw error;
      }
      intelligence = candidate;
      indexIdentity = openedIndexIdentity;
    })();
    initializationPromise = pending;
    void pending.then(undefined, () => {
      if (initializationPromise === pending) {
        initializationPromise = undefined;
      }
    });
    return pending;
  };
  const initialize = async (): Promise<
    | {
        readonly artifactDirectory: PinnedHostPrivateDirectory;
        readonly intelligence: SqliteWordfenceIntelligence;
      }
    | undefined
  > => {
    try {
      await ensureInitialized();
      const expectedIndexIdentity = indexIdentity;
      if (expectedIndexIdentity === undefined) {
        throw new HostPrivateStorageError();
      }
      const storage = await requireProductionStorage(
        intelligenceOptions.databasePath,
        intelligenceOptions.artifactDirectory,
        expectedIndexIdentity,
      );
      const current = intelligence;
      if (current === undefined) {
        await storage.artifactDirectory.handle.close();
        throw new HostPrivateStorageError();
      }
      return {
        artifactDirectory: storage.artifactDirectory,
        intelligence: current,
      };
    } catch (error) {
      if (isStorageFailure(error)) {
        return undefined;
      }
      throw error;
    }
  };
  const requireCurrentIndexIdentity = async (): Promise<void> => {
    const expectedIndexIdentity = indexIdentity;
    if (expectedIndexIdentity === undefined) {
      throw new HostPrivateStorageError();
    }
    await requireProductionIndexIdentity(
      intelligenceOptions.databasePath,
      expectedIndexIdentity,
    );
  };
  return {
    run: async (request) => {
      wordfenceIntelligenceRefreshRequestSchema.parse(request);
      const current = await initialize();
      if (current === undefined) {
        return failure("storage-failure");
      }
      try {
        return await usePinnedProductionDirectory(
          current.artifactDirectory,
          async () => {
            await current.intelligence.requireCurrentProductionArtifact(
              current.artifactDirectory,
            );
            const result = wordfenceIntelligenceResultSchema.parse(
              await current.intelligence.refresh(
                request,
                current.artifactDirectory,
                requireCurrentIndexIdentity,
              ),
            );
            if (result.status === "current" || result.status === "stale") {
              await verifyStoredArtifact(
                current.artifactDirectory,
                result.snapshot.source.contentDigest,
              );
              await requireCurrentIndexIdentity();
            }
            return result;
          },
        );
      } catch (error) {
        if (isStorageFailure(error)) {
          return failure("storage-failure");
        }
        throw error;
      }
    },
    inspect: async (request) => {
      wordfenceIntelligenceInspectionRequestSchema.parse(request);
      const current = await initialize();
      if (current === undefined) {
        return failure("storage-failure");
      }
      try {
        return await usePinnedProductionDirectory(
          current.artifactDirectory,
          async () => {
            const result = wordfenceIntelligenceResultSchema.parse(
              await current.intelligence.inspectProduction(request),
            );
            if (result.status === "current" || result.status === "stale") {
              await verifyStoredArtifact(
                current.artifactDirectory,
                result.snapshot.source.contentDigest,
              );
              await requireCurrentIndexIdentity();
            }
            return result;
          },
        );
      } catch (error) {
        if (isStorageFailure(error)) {
          return failure("storage-failure");
        }
        throw error;
      }
    },
  };
}
