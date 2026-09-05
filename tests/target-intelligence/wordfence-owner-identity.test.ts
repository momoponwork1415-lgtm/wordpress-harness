import { chmod, lstat, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import Database from "better-sqlite3";
import { describe, expect, it, vi } from "vitest";

vi.mock(
  "../../src/target-intelligence/wordfence-intelligence/owner-identity.js",
  () => ({ currentOwnerUid: () => undefined }),
);

import {
  openSqliteHostPrivateCredentialBroker,
  openWordfenceIntelligenceRefresh,
  type HostPrivateCredentialBroker,
} from "../../src/target-intelligence/index.js";

describe("Wordfence owner identity", () => {
  it.each(["run", "inspect"] as const)(
    "fails production %s before changing or opening storage when owner identity is unavailable",
    async (operation) => {
      const directory = await mkdtemp(
        join(tmpdir(), "wordfence-owner-unavailable-"),
      );
      const indexDirectory = join(directory, "index");
      const databasePath = join(indexDirectory, "target-intelligence.sqlite");
      await mkdir(indexDirectory, { mode: 0o755 });
      await chmod(indexDirectory, 0o755);
      let resolveCalls = 0;
      const credentialBroker: HostPrivateCredentialBroker = {
        async resolve<T>(): Promise<T> {
          resolveCalls += 1;
          throw new Error("credential resolution must not start");
        },
      };
      const fetchMock = vi.fn<typeof fetch>(() =>
        Promise.reject(new Error("fetch must not start")),
      );
      try {
        const refresh = openWordfenceIntelligenceRefresh({
          databasePath,
          artifactDirectory: join(directory, "artifacts"),
          credentialBroker,
          fetch: fetchMock,
        });
        const result =
          operation === "run"
            ? await refresh.run({
                kind: "wordfence-intelligence-refresh",
                schemaVersion: 1,
              })
            : await refresh.inspect({
                kind: "wordfence-intelligence-inspection",
                schemaVersion: 1,
              });

        expect(result).toEqual({
          kind: "wordfence-intelligence-result",
          schemaVersion: 1,
          status: "failed",
          reason: "storage-failure",
        });
        expect(resolveCalls).toBe(0);
        expect(fetchMock).not.toHaveBeenCalled();
        expect((await lstat(indexDirectory)).mode & 0o777).toBe(0o755);
        await expect(lstat(databasePath)).rejects.toMatchObject({
          code: "ENOENT",
        });
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    },
  );

  it("does not disclose or resolve a brokered credential when owner identity is unavailable", async () => {
    const directory = await mkdtemp(
      join(tmpdir(), "wordfence-broker-owner-unavailable-"),
    );
    const databasePath = join(directory, "credential-broker.sqlite");
    const credential = "synthetic-owner-unavailable-credential";
    const database = new Database(databasePath);
    database.exec(`
      CREATE TABLE secret_values (
        ref_id TEXT PRIMARY KEY NOT NULL,
        provider TEXT NOT NULL,
        purpose TEXT NOT NULL,
        secret_value TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT
    `);
    database
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
    database.close();
    await chmod(databasePath, 0o600);
    let useCalled = false;
    try {
      const broker = openSqliteHostPrivateCredentialBroker({ databasePath });
      const resolution = broker.resolve(
        { kind: "secret-ref", id: "wordfence-v3-api-key" },
        async () => {
          useCalled = true;
          return "must-not-resolve";
        },
      );

      await expect(resolution).rejects.toThrow(
        "Host-private credential is unavailable",
      );
      await expect(resolution).rejects.not.toThrow(credential);
      expect(useCalled).toBe(false);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
