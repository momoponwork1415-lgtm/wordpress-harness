import Database from "better-sqlite3";
import { z } from "zod";

import { humanOsDigest } from "../canonical-json.js";
import {
  humanVerificationEnvironmentDispositionSchema,
  humanVerificationEnvironmentRequestSchema,
  type HumanVerificationEnvironmentDisposition,
  type HumanVerificationEnvironmentRequest,
} from "../human-verification-environment-contracts.js";
import type {
  HumanOsRecord,
  HumanVerificationEnvironmentRecordView,
  OpenHumanOsRecordOptions,
  RecordEnvironmentDispositionResult,
} from "./contracts.js";

const digestSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);

interface StoredEnvironmentDispositionRow {
  readonly global_sequence: number;
  readonly kind: string;
  readonly schema_version: number;
  readonly request_digest: string;
  readonly occurred_at: string;
  readonly request_artifact_digest: string;
  readonly disposition_artifact_digest: string;
}

function assertDispositionMatchesRequest(
  request: HumanVerificationEnvironmentRequest,
  disposition: HumanVerificationEnvironmentDisposition,
): void {
  if (
    disposition.requestDigest !== request.digest ||
    disposition.setupReceipt.setupPlanDigest !== request.setupPlan.digest
  ) {
    throw new Error(
      "Human Verification Environment Disposition binding mismatch",
    );
  }
  if (disposition.status === "ready") {
    const configuration = disposition.effectiveConfiguration;
    const identity = disposition.targetRuntimeIdentity;
    const environment = disposition.environment;
    if (
      disposition.gate.status !== "passed" ||
      disposition.gate.observedBackend !==
        request.runtimeProfile.isolation.backend ||
      disposition.gate.observedRuntimeName !==
        request.runtimeProfile.isolation.runtimeName ||
      disposition.gate.observedRuntimeVersion !==
        request.runtimeProfile.isolation.runtimeVersion ||
      disposition.setupReceipt.status !== "ready" ||
      configuration.runtimeProfileDigest !== request.runtimeProfile.digest ||
      configuration.policyDigest !== request.policy.digest ||
      identity.runtimeProfileDigest !== request.runtimeProfile.digest ||
      identity.targetSnapshot.digest !== request.target.snapshot.digest ||
      identity.manifest.digest !== request.target.manifest.digest ||
      identity.sourceArtifactDigest !== request.target.sourceArtifact.digest ||
      environment.targetSnapshotDigest !== request.target.snapshot.digest ||
      environment.runtimeProfileDigest !== request.runtimeProfile.digest
    ) {
      throw new Error("Ready Environment Disposition binding mismatch");
    }
    return;
  }
  if (disposition.setupReceipt.status !== "setup-blocked") {
    throw new Error("Setup Blocked Disposition receipt mismatch");
  }
}

class SqliteHumanOsRecord implements HumanOsRecord {
  readonly #database: Database.Database;
  readonly #artifactStore: OpenHumanOsRecordOptions["artifactStore"];
  readonly #clock: () => Date;

  constructor(options: OpenHumanOsRecordOptions) {
    this.#database = new Database(options.databasePath);
    this.#artifactStore = options.artifactStore;
    this.#clock = options.clock ?? (() => new Date());
    this.#database.pragma("journal_mode = WAL");
    this.#database.pragma("busy_timeout = 5000");
    this.#database.exec(`
      CREATE TABLE IF NOT EXISTS human_os_events (
        global_sequence INTEGER PRIMARY KEY AUTOINCREMENT,
        kind TEXT NOT NULL,
        schema_version INTEGER NOT NULL,
        request_digest TEXT NOT NULL UNIQUE,
        occurred_at TEXT NOT NULL,
        request_artifact_digest TEXT NOT NULL,
        disposition_artifact_digest TEXT NOT NULL
      ) STRICT;
    `);
  }

  async readEnvironmentDisposition(
    requestDigestValue: string,
  ): Promise<HumanVerificationEnvironmentRecordView | undefined> {
    const requestDigest = digestSchema.parse(requestDigestValue);
    const row = this.#database
      .prepare(
        `SELECT global_sequence, kind, schema_version, request_digest,
                occurred_at, request_artifact_digest,
                disposition_artifact_digest
           FROM human_os_events
          WHERE request_digest = ?`,
      )
      .get(requestDigest) as StoredEnvironmentDispositionRow | undefined;
    return row === undefined ? undefined : this.#decode(row);
  }

  async recordEnvironmentDisposition(
    requestValue: HumanVerificationEnvironmentRequest,
    dispositionValue: HumanVerificationEnvironmentDisposition,
  ): Promise<RecordEnvironmentDispositionResult> {
    const request =
      humanVerificationEnvironmentRequestSchema.parse(requestValue);
    const disposition =
      humanVerificationEnvironmentDispositionSchema.parse(dispositionValue);
    assertDispositionMatchesRequest(request, disposition);

    const requestArtifactDigest = await this.#artifactStore.putJson(request);
    const dispositionArtifactDigest =
      await this.#artifactStore.putJson(disposition);
    if (
      requestArtifactDigest !== humanOsDigest(request) ||
      dispositionArtifactDigest !== humanOsDigest(disposition)
    ) {
      throw new Error("Human OS Artifact Store returned a foreign digest");
    }

    const transact = this.#database.transaction(() => {
      const existing = this.#selectRow(request.digest);
      if (existing !== undefined)
        return { status: "occupied" as const, row: existing };
      const occurredAt = this.#clock().toISOString();
      this.#database
        .prepare(
          `INSERT INTO human_os_events (
             kind, schema_version, request_digest, occurred_at,
             request_artifact_digest, disposition_artifact_digest
           ) VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(
          "environment.disposition-recorded",
          1,
          request.digest,
          occurredAt,
          requestArtifactDigest,
          dispositionArtifactDigest,
        );
      const row = this.#selectRow(request.digest);
      if (row === undefined) throw new Error("Human OS event append failed");
      return { status: "appended" as const, row };
    });
    const result = transact();
    return { status: result.status, view: await this.#decode(result.row) };
  }

  #selectRow(
    requestDigest: string,
  ): StoredEnvironmentDispositionRow | undefined {
    return this.#database
      .prepare(
        `SELECT global_sequence, kind, schema_version, request_digest,
                occurred_at, request_artifact_digest,
                disposition_artifact_digest
           FROM human_os_events
          WHERE request_digest = ?`,
      )
      .get(requestDigest) as StoredEnvironmentDispositionRow | undefined;
  }

  async #decode(
    row: StoredEnvironmentDispositionRow,
  ): Promise<HumanVerificationEnvironmentRecordView> {
    if (
      row.kind !== "environment.disposition-recorded" ||
      row.schema_version !== 1
    ) {
      throw new Error("Unsupported Human OS event schema");
    }
    const requestValue = await this.#artifactStore.readJson(
      row.request_artifact_digest,
    );
    const dispositionValue = await this.#artifactStore.readJson(
      row.disposition_artifact_digest,
    );
    const request =
      humanVerificationEnvironmentRequestSchema.parse(requestValue);
    const disposition =
      humanVerificationEnvironmentDispositionSchema.parse(dispositionValue);
    if (
      humanOsDigest(request) !== row.request_artifact_digest ||
      humanOsDigest(disposition) !== row.disposition_artifact_digest ||
      request.digest !== row.request_digest
    ) {
      throw new Error("Human OS event artifact integrity mismatch");
    }
    assertDispositionMatchesRequest(request, disposition);
    return {
      ledgerHead: row.global_sequence,
      occurredAt: row.occurred_at,
      requestArtifactDigest: row.request_artifact_digest,
      dispositionArtifactDigest: row.disposition_artifact_digest,
      request,
      disposition,
    };
  }
}

export function openSqliteHumanOsRecord(
  options: OpenHumanOsRecordOptions,
): HumanOsRecord {
  return new SqliteHumanOsRecord(options);
}
