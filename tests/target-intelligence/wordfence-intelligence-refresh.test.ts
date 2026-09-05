import {
  chmod,
  mkdir,
  readdir,
  readFile,
  mkdtemp,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import Database from "better-sqlite3";
import { describe, expect, it, vi } from "vitest";

import {
  openSqliteHostPrivateCredentialBroker,
  openWordfenceIntelligenceRefresh,
  wordfenceIntelligenceResultSchema,
  type HostPrivateCredentialBroker,
  type WordfenceSecretRef,
} from "../../src/target-intelligence/index.js";

const sourceUrl =
  "https://www.wordfence.com/api/intelligence/v3/vulnerabilities/production";
const fixturePath = join(
  import.meta.dirname,
  "..",
  "fixtures",
  "target-intelligence",
  "wordfence-intelligence-v3",
  "production.json",
);

async function filesBelow(directory: string): Promise<readonly string[]> {
  const paths: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      paths.push(...(await filesBelow(path)));
    } else if (entry.isFile()) {
      paths.push(path);
    }
  }
  return paths;
}

describe("WordfenceIntelligenceRefresh", () => {
  it("refreshes through the host-private SQLite credential broker", async () => {
    const directory = await mkdtemp(join(tmpdir(), "wordfence-broker-"));
    const applicationDirectory = join(directory, "application");
    const brokerPath = join(directory, "credential-broker.sqlite");
    const credential = "synthetic-sqlite-broker-value";
    const brokerDatabase = new Database(brokerPath);
    brokerDatabase.exec(`
      CREATE TABLE secret_values (
        ref_id TEXT PRIMARY KEY NOT NULL,
        provider TEXT NOT NULL,
        purpose TEXT NOT NULL,
        secret_value TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT
    `);
    brokerDatabase
      .prepare(
        `INSERT INTO secret_values (
           ref_id, provider, purpose, secret_value, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        "wordfence-v3-api-key",
        "wordfence",
        "wordfence-intelligence-v3-production-feed",
        credential,
        "2030-01-01T00:00:00.000Z",
        "2030-01-01T00:00:00.000Z",
      );
    brokerDatabase.close();
    await chmod(brokerPath, 0o600);
    await mkdir(applicationDirectory);
    const fetchMock = vi.fn<typeof fetch>(async (_input, init) => {
      expect(new Headers(init?.headers).get("authorization")).toBe(
        `Bearer ${credential}`,
      );
      return new Response(await readFile(fixturePath), { status: 200 });
    });

    try {
      const refresh = openWordfenceIntelligenceRefresh({
        databasePath: join(applicationDirectory, "target-intelligence.sqlite"),
        artifactDirectory: join(applicationDirectory, "artifacts"),
        credentialBroker: openSqliteHostPrivateCredentialBroker({
          databasePath: brokerPath,
        }),
        fetch: fetchMock,
      });

      const result = await refresh.run({
        kind: "wordfence-intelligence-refresh",
        schemaVersion: 1,
      });
      expect(result).toMatchObject({
        kind: "wordfence-intelligence-result",
        schemaVersion: 1,
        status: "current",
        snapshot: { source: { recordCount: 2, complete: true } },
      });
      expect(JSON.stringify(result)).not.toContain(credential);
      const persisted = await Promise.all(
        (await filesBelow(applicationDirectory)).map((path) => readFile(path)),
      );
      expect(persisted.every((bytes) => !bytes.includes(credential))).toBe(
        true,
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("returns a typed failure when the local index cannot be opened", async () => {
    const directory = await mkdtemp(join(tmpdir(), "wordfence-storage-"));
    const blockingFile = join(directory, "not-a-directory");
    let resolveCalls = 0;
    const credentialBroker: HostPrivateCredentialBroker = {
      async resolve<T>(): Promise<T> {
        resolveCalls += 1;
        throw new Error("must not resolve when storage is unavailable");
      },
    };
    await writeFile(blockingFile, "blocks SQLite parent creation");
    try {
      const refresh = openWordfenceIntelligenceRefresh({
        databasePath: join(blockingFile, "target-intelligence.sqlite"),
        artifactDirectory: join(directory, "artifacts"),
        credentialBroker,
      });

      await expect(
        refresh.run({
          kind: "wordfence-intelligence-refresh",
          schemaVersion: 1,
        }),
      ).resolves.toEqual({
        kind: "wordfence-intelligence-result",
        schemaVersion: 1,
        status: "failed",
        reason: "storage-failure",
      });
      expect(resolveCalls).toBe(0);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("does not relabel an invalid request as a storage failure", async () => {
    const directory = await mkdtemp(join(tmpdir(), "wordfence-integrity-"));
    const blockingFile = join(directory, "not-a-directory");
    await writeFile(blockingFile, "blocks SQLite parent creation");
    try {
      const refresh = openWordfenceIntelligenceRefresh({
        databasePath: join(blockingFile, "target-intelligence.sqlite"),
        artifactDirectory: join(directory, "artifacts"),
        credentialBroker: {
          async resolve<T>(): Promise<T> {
            throw new Error("must not resolve for an invalid request");
          },
        },
      });
      await expect(
        Reflect.apply(refresh.run, refresh, [
          {
            kind: "wordfence-intelligence-refresh",
            schemaVersion: 2,
          },
        ]),
      ).rejects.toMatchObject({ name: "ZodError" });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("preserves local index schema conflicts as integrity failures", async () => {
    const directory = await mkdtemp(join(tmpdir(), "wordfence-integrity-"));
    const databasePath = join(directory, "target-intelligence.sqlite");
    const database = new Database(databasePath);
    database.exec(`
      CREATE VIEW wordfence_intelligence_snapshots AS
      SELECT 'invalid-existing-schema' AS snapshot_digest
    `);
    database.close();
    let resolveCalls = 0;
    try {
      const refresh = openWordfenceIntelligenceRefresh({
        databasePath,
        artifactDirectory: join(directory, "artifacts"),
        credentialBroker: {
          async resolve<T>(): Promise<T> {
            resolveCalls += 1;
            throw new Error("must not resolve for an integrity failure");
          },
        },
      });
      await expect(
        refresh.inspect({
          kind: "wordfence-intelligence-inspection",
          schemaVersion: 1,
        }),
      ).rejects.toThrow();
      expect(resolveCalls).toBe(0);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("resolves the brokered credential at final use and publishes only a fully validated production snapshot", async () => {
    const directory = await mkdtemp(join(tmpdir(), "wordfence-live-refresh-"));
    const credential = "synthetic-broker-value-not-a-real-secret";
    const resolutions: unknown[] = [];
    let credentialInUse = false;
    const credentialBroker: HostPrivateCredentialBroker = {
      async resolve<T>(
        reference: WordfenceSecretRef,
        use: (credential: string) => Promise<T>,
      ): Promise<T> {
        resolutions.push(reference);
        credentialInUse = true;
        try {
          return await use(credential);
        } finally {
          credentialInUse = false;
        }
      },
    };
    const validBytes = await readFile(fixturePath);
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock.mockImplementationOnce(async (_input, init) => {
      expect(credentialInUse).toBe(true);
      expect(new Headers(init?.headers).get("authorization")).toBe(
        `Bearer ${credential}`,
      );
      return new Response(validBytes, { status: 200 });
    });
    fetchMock.mockImplementationOnce(async (_input, init) => {
      expect(credentialInUse).toBe(true);
      expect(new Headers(init?.headers).get("authorization")).toBe(
        `Bearer ${credential}`,
      );
      return new Response(undefined, {
        status: 429,
        headers: { "retry-after": "120" },
      });
    });

    try {
      const refresh = openWordfenceIntelligenceRefresh({
        databasePath: join(directory, "target-intelligence.sqlite"),
        artifactDirectory: join(directory, "artifacts"),
        credentialBroker,
        fetch: fetchMock,
        clock: () => new Date("2030-08-01T00:00:00.000Z"),
      });

      const current = await refresh.run({
        kind: "wordfence-intelligence-refresh",
        schemaVersion: 1,
      });
      expect(current).toMatchObject({
        kind: "wordfence-intelligence-result",
        schemaVersion: 1,
        status: "current",
        snapshot: {
          retrievedAt: "2030-08-01T00:00:00.000Z",
          source: {
            sourceUrl,
            recordCount: 2,
            complete: true,
          },
        },
      });

      const rateLimited = await refresh.run({
        kind: "wordfence-intelligence-refresh",
        schemaVersion: 1,
      });
      expect(rateLimited).toEqual({
        kind: "wordfence-intelligence-result",
        schemaVersion: 1,
        status: "failed",
        reason: "rate-limited",
        backoff: {
          kind: "wordfence-rate-limit-backoff",
          schemaVersion: 1,
          automaticRetries: 0,
          retryAfter: { kind: "delay-seconds", seconds: 120 },
        },
      });
      expect(wordfenceIntelligenceResultSchema.parse(rateLimited)).toEqual(
        rateLimited,
      );
      expect(wordfenceIntelligenceResultSchema.parse(current)).toEqual(current);
      await expect(
        refresh.inspect({
          kind: "wordfence-intelligence-inspection",
          schemaVersion: 1,
        }),
      ).resolves.toEqual(current);

      const replayFetch = vi.fn<typeof fetch>(() =>
        Promise.reject(new Error("inspect must not access the network")),
      );
      const restarted = openWordfenceIntelligenceRefresh({
        databasePath: join(directory, "target-intelligence.sqlite"),
        artifactDirectory: join(directory, "artifacts"),
        credentialBroker,
        fetch: replayFetch,
      });
      await expect(
        restarted.inspect({
          kind: "wordfence-intelligence-inspection",
          schemaVersion: 1,
        }),
      ).resolves.toEqual(current);
      expect(replayFetch).not.toHaveBeenCalled();

      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(resolutions).toEqual([
        { kind: "secret-ref", id: "wordfence-v3-api-key" },
        { kind: "secret-ref", id: "wordfence-v3-api-key" },
      ]);
      const persisted = await Promise.all(
        (await filesBelow(directory)).map((path) => readFile(path)),
      );
      expect(persisted.every((bytes) => !bytes.includes(credential))).toBe(
        true,
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
