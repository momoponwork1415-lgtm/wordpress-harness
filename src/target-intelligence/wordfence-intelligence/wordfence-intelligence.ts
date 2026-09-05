import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

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

const DEFAULT_MAXIMUM_FEED_BYTES = 256_000_000;
const MAXIMUM_RETRY_AFTER_SECONDS = 86_400;
const DEFAULT_SOURCE_URL =
  "https://www.wordfence.com/api/intelligence/v3/vulnerabilities/production";

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

const productionRefreshStateSchema = z.strictObject({
  kind: z.literal("wordfence-intelligence-production-refresh-state"),
  schemaVersion: z.literal(1),
  currentSnapshotDigest: z
    .string()
    .regex(/^sha256:[a-f0-9]{64}$/)
    .optional(),
  latestRefresh: wordfenceIntelligenceRefreshAttemptSchema,
});

type SnapshotRow = z.infer<typeof snapshotRowSchema>;

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

const storageFailureCodes = new Set([
  "EACCES",
  "EBUSY",
  "EDQUOT",
  "EIO",
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

function recordSetDigest(
  snapshotDigest: string,
  records: readonly WordfenceStoredPluginRecord[],
): string {
  const hash = createHash("sha256");
  hash.update(
    canonicalJson({
      kind: "wordfence-intelligence-normalized-record-set",
      schemaVersion: 1,
      snapshotDigest,
      normalizedRowCount: records.length,
    }),
  );
  for (const stored of records) {
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

async function persistBytes(path: string, bytes: Uint8Array): Promise<void> {
  try {
    await writeFile(path, bytes, { flag: "wx" });
  } catch (error) {
    if (!hasErrorCode(error, "EEXIST")) {
      throw error;
    }
    const existing = await readFile(path);
    if (!existing.equals(bytes)) {
      throw new ArtifactConflictError();
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
  const decoded = JSON.parse(Buffer.from(bytes).toString("utf8")) as unknown;
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
  const records = [...recordsByIdentity.values()];
  records.sort((left, right) => {
    if (left.pluginSlug !== right.pluginSlug) {
      return left.pluginSlug < right.pluginSlug ? -1 : 1;
    }
    return left.record.recordId < right.record.recordId ? -1 : 1;
  });
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
  const expectedLength =
    declaredLength !== null &&
    (contentEncoding === null || contentEncoding === "identity") &&
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
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) {
        break;
      }
      total += next.value.byteLength;
      if (total > maximumBytes) {
        await reader.cancel();
        throw new ResponseTooLargeError();
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
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
    return {
      status: response.status,
      sourceUrl: response.url || this.sourceUrl,
      complete: true,
      redirected: response.status >= 300 && response.status < 400,
      ...(response.status === 429
        ? { backoff: rateLimitBackoff(response.headers, this.#clock()) }
        : {}),
      bytes:
        response.status >= 200 && response.status < 300
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

  constructor(
    options: OpenWordfenceIntelligenceOptions,
    productionComposition = false,
  ) {
    this.#artifactDirectory = options.artifactDirectory;
    this.#adapter = options.adapter;
    this.#credential = wordfenceSecretRefSchema.parse(options.credential);
    this.#maximumFeedBytes = maximumFeedBytes(options.maximumFeedBytes);
    this.#knownRecordAuthorizationProvider =
      options.knownRecordAuthorizationProvider;
    this.#clock = options.clock ?? (() => new Date());
    this.#productionComposition = productionComposition;
    const database = new Database(options.databasePath);
    try {
      database.pragma("journal_mode = WAL");
      database.pragma("busy_timeout = 5000");
      database.exec(`
        CREATE TABLE IF NOT EXISTS wordfence_intelligence_snapshots (
          snapshot_digest TEXT PRIMARY KEY,
          snapshot_id TEXT NOT NULL UNIQUE,
          snapshot_json TEXT NOT NULL
        ) STRICT;
        CREATE TABLE IF NOT EXISTS wordfence_intelligence_records (
          snapshot_digest TEXT NOT NULL,
          plugin_slug TEXT NOT NULL,
          record_id TEXT NOT NULL,
          record_json TEXT NOT NULL,
          PRIMARY KEY (snapshot_digest, plugin_slug, record_id)
        ) STRICT;
        CREATE TABLE IF NOT EXISTS wordfence_intelligence_current (
          singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
          snapshot_digest TEXT NOT NULL
        ) STRICT;
        CREATE TABLE IF NOT EXISTS wordfence_intelligence_refresh_state (
          singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
          state_json TEXT NOT NULL
        ) STRICT;
        CREATE TABLE IF NOT EXISTS wordfence_intelligence_record_set_manifests (
          snapshot_digest TEXT PRIMARY KEY,
          manifest_json TEXT NOT NULL
        ) STRICT;
        CREATE TABLE IF NOT EXISTS wordfence_intelligence_legacy_record_sets (
          snapshot_digest TEXT PRIMARY KEY,
          legacy_json TEXT NOT NULL
        ) STRICT;
        CREATE TABLE IF NOT EXISTS wordfence_intelligence_index_metadata (
          singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
          schema_version INTEGER NOT NULL
        ) STRICT;
      `);
      initializeRecordSetStorage(database);
    } catch (error) {
      database.close();
      throw error;
    }
    this.#database = database;
  }

  async refresh(
    requestValue: WordfenceIntelligenceRefreshRequest,
  ): Promise<WordfenceIntelligenceResult> {
    wordfenceIntelligenceRefreshRequestSchema.parse(requestValue);
    let unvalidated: unknown;
    try {
      unvalidated = await this.#adapter.retrieveProductionFeed({
        credential: this.#credential,
        maximumBytes: this.#maximumFeedBytes,
      });
    } catch (error) {
      return this.#refreshFailure(
        error instanceof ResponseTooLargeError
          ? "response-byte-ceiling-exceeded"
          : error instanceof PartialResponseError
            ? "partial-response"
            : error instanceof CredentialUnavailableError
              ? "credential-unavailable"
              : "network-failure",
      );
    }
    const parsedResponse =
      wordfenceIntelligenceSourceResponseSchema.safeParse(unvalidated);
    if (!parsedResponse.success) {
      return this.#refreshFailure("schema-drift");
    }
    const response = parsedResponse.data;
    if (
      response.redirected === true ||
      response.sourceUrl !== this.#adapter.sourceUrl
    ) {
      return this.#refreshFailure("source-mismatch");
    }
    const responseFailureResult = responseFailure(response, this.#clock);
    if (responseFailureResult !== undefined) {
      return this.#recordRefreshFailure(responseFailureResult);
    }
    if (!response.complete) {
      return this.#refreshFailure("partial-response");
    }
    if (response.bytes.byteLength > this.#maximumFeedBytes) {
      return this.#refreshFailure("response-byte-ceiling-exceeded");
    }
    let normalized: ReturnType<typeof normalizeFeed>;
    try {
      normalized = normalizeFeed(response.bytes);
    } catch (error) {
      return this.#refreshFailure(
        error instanceof AttributionMissingError
          ? "attribution-missing"
          : "schema-drift",
      );
    }
    const contentDigest = rawDigest(response.bytes);
    const artifactDirectory = join(
      this.#artifactDirectory,
      "wordfence-intelligence-v3",
    );
    try {
      await mkdir(artifactDirectory, { recursive: true });
      await persistBytes(
        join(artifactDirectory, `${contentDigest.slice(7)}.json`),
        response.bytes,
      );
    } catch (error) {
      if (isStorageFailure(error)) {
        return this.#refreshFailure("storage-failure");
      }
      throw error;
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
    try {
      this.#storeSnapshot(
        snapshot,
        snapshotRef,
        normalized.records,
        this.#productionComposition,
      );
    } catch (error) {
      if (isStorageFailure(error)) {
        return this.#refreshFailure("storage-failure");
      }
      throw error;
    }
    return currentResult(snapshot, snapshotRef);
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
      const result = this.#inspectSnapshot(request);
      const row = refreshStateRowSchema.optional().parse(
        this.#database
          .prepare(
            `SELECT state_json
             FROM wordfence_intelligence_refresh_state
            WHERE singleton = 1`,
          )
          .get(),
      );
      if (row === undefined) {
        return result;
      }
      const state = productionRefreshStateSchema.parse(
        JSON.parse(row.state_json),
      );
      if (result.status === "failed") {
        if (
          result.reason === "not-refreshed" &&
          state.currentSnapshotDigest === undefined
        ) {
          return state.latestRefresh.result;
        }
        if (result.reason === "not-refreshed") {
          throw new SnapshotConflictError();
        }
        return result;
      }
      if (result.status === "stale") {
        return result;
      }
      if (state.currentSnapshotDigest !== result.snapshotRef.digest) {
        return result;
      }
      return staleWordfenceIntelligenceSnapshotSchema.parse({
        ...result,
        status: "stale",
        latestRefresh: state.latestRefresh,
      });
    });
    return transaction.deferred();
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
    clearProductionRefreshState: boolean,
  ): void {
    const transaction = this.#database.transaction(() => {
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
      this.#database
        .prepare(
          `INSERT INTO wordfence_intelligence_current (
             singleton, snapshot_digest
           ) VALUES (1, ?)
           ON CONFLICT(singleton) DO UPDATE SET
             snapshot_digest = excluded.snapshot_digest`,
        )
        .run(reference.digest);
      if (clearProductionRefreshState) {
        this.#database
          .prepare(
            `DELETE FROM wordfence_intelligence_refresh_state
             WHERE singleton = 1`,
          )
          .run();
      }
    });
    transaction.immediate();
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
    const persisted = validated.records;
    if (
      persisted.length !== records.length ||
      persisted.some((stored, index) => {
        const candidate = records[index];
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
  ): WordfenceIntelligenceFailure {
    return this.#recordRefreshFailure(failure(reason, backoff));
  }

  #recordRefreshFailure(
    result: WordfenceIntelligenceFailure,
  ): WordfenceIntelligenceFailure {
    const parsed = wordfenceIntelligenceFailureSchema.parse(result);
    if (!this.#productionComposition) {
      return parsed;
    }
    try {
      const transaction = this.#database.transaction(() => {
        const currentSnapshotDigest = this.#currentReference()?.digest;
        const state = productionRefreshStateSchema.parse({
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
      });
      transaction.immediate();
      return parsed;
    } catch (error) {
      if (isStorageFailure(error)) {
        return failure("storage-failure");
      }
      throw error;
    }
  }

  #currentReference(): WordfenceIntelligenceSnapshotRef | undefined {
    const row = snapshotRowSchema.optional().parse(
      this.#database
        .prepare(
          `SELECT s.snapshot_digest, s.snapshot_id, s.snapshot_json
           FROM wordfence_intelligence_current c
           JOIN wordfence_intelligence_snapshots s
             ON s.snapshot_digest = c.snapshot_digest
          WHERE c.singleton = 1`,
        )
        .get(),
    );
    if (row === undefined) {
      return undefined;
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
            WHERE snapshot_digest = ?
            ORDER BY plugin_slug, record_id`,
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
        const records = rows.map((row) => {
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
        });
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
      const records = rows.map((row) => {
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
      });
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

export function openWordfenceIntelligenceRefresh(
  options: OpenWordfenceIntelligenceRefreshOptions,
): WordfenceIntelligenceRefresh {
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
  const initialize = async (): Promise<
    SqliteWordfenceIntelligence | undefined
  > => {
    if (intelligence !== undefined) {
      return intelligence;
    }
    try {
      await mkdir(dirname(intelligenceOptions.databasePath), {
        recursive: true,
      });
      intelligence ??= new SqliteWordfenceIntelligence(
        intelligenceOptions,
        true,
      );
      return intelligence;
    } catch (error) {
      if (isStorageFailure(error)) {
        return undefined;
      }
      throw error;
    }
  };
  return {
    run: async (request) => {
      wordfenceIntelligenceRefreshRequestSchema.parse(request);
      const current = await initialize();
      if (current === undefined) {
        return failure("storage-failure");
      }
      return wordfenceIntelligenceResultSchema.parse(
        await current.refresh(request),
      );
    },
    inspect: async (request) => {
      wordfenceIntelligenceInspectionRequestSchema.parse(request);
      const current = await initialize();
      if (current === undefined) {
        return failure("storage-failure");
      }
      try {
        return wordfenceIntelligenceResultSchema.parse(
          await current.inspectProduction(request),
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
