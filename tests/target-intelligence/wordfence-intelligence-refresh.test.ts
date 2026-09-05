import {
  chmod,
  lstat,
  mkdir,
  readdir,
  readFile,
  mkdtemp,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import Database from "better-sqlite3";
import { describe, expect, it, vi } from "vitest";

const filesystemFault = vi.hoisted<{
  directorySyncPath: string | undefined;
}>(() => ({ directorySyncPath: undefined }));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    open: async (...args: Parameters<typeof actual.open>) => {
      const handle = await actual.open(...args);
      if (String(args[0]) === filesystemFault.directorySyncPath) {
        Object.defineProperty(handle, "sync", {
          configurable: true,
          value: async () => {
            const error = new Error("synthetic directory sync failure");
            Object.defineProperty(error, "code", { value: "EIO" });
            throw error;
          },
        });
      }
      return handle;
    },
  };
});

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

function deferred<T>(): {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((completion) => {
    resolve = completion;
  });
  return { promise, resolve };
}

function controlledFetch(): {
  readonly fetch: typeof fetch;
  readonly started: Promise<void>;
  readonly respond: (response: Response) => void;
} {
  const started = deferred<void>();
  const response = deferred<Response>();
  return {
    fetch: vi.fn<typeof fetch>(async () => {
      started.resolve();
      return response.promise;
    }),
    started: started.promise,
    respond: response.resolve,
  };
}

describe("WordfenceIntelligenceRefresh", () => {
  it("does not commit a current snapshot before the raw CAS directory is durable", async () => {
    const directory = await mkdtemp(
      join(tmpdir(), "wordfence-cas-durability-"),
    );
    const rawDirectory = join(
      directory,
      "artifacts",
      "wordfence-intelligence-v3",
    );
    filesystemFault.directorySyncPath = rawDirectory;
    try {
      const refresh = openWordfenceIntelligenceRefresh({
        databasePath: join(directory, "index", "target-intelligence.sqlite"),
        artifactDirectory: join(directory, "artifacts"),
        credentialBroker: {
          async resolve<T>(
            _reference: WordfenceSecretRef,
            use: (credential: string) => Promise<T>,
          ): Promise<T> {
            return use("synthetic-cas-durability-credential");
          },
        },
        fetch: vi.fn<typeof fetch>(async () =>
          Promise.resolve(
            new Response(await readFile(fixturePath), { status: 200 }),
          ),
        ),
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
      await expect(
        refresh.inspect({
          kind: "wordfence-intelligence-inspection",
          schemaVersion: 1,
        }),
      ).resolves.toEqual({
        kind: "wordfence-intelligence-result",
        schemaVersion: 1,
        status: "failed",
        reason: "storage-failure",
      });

      filesystemFault.directorySyncPath = undefined;
      await expect(
        refresh.run({
          kind: "wordfence-intelligence-refresh",
          schemaVersion: 1,
        }),
      ).resolves.toMatchObject({ status: "current" });
    } finally {
      filesystemFault.directorySyncPath = undefined;
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("creates the production SQLite index and sidecars as owner-only storage", async () => {
    const directory = await mkdtemp(join(tmpdir(), "wordfence-private-index-"));
    const indexDirectory = join(directory, "index");
    const databasePath = join(indexDirectory, "target-intelligence.sqlite");
    try {
      const refresh = openWordfenceIntelligenceRefresh({
        databasePath,
        artifactDirectory: join(directory, "artifacts"),
        credentialBroker: {
          async resolve<T>(
            _reference: WordfenceSecretRef,
            use: (credential: string) => Promise<T>,
          ): Promise<T> {
            return use("synthetic-private-index-credential");
          },
        },
        fetch: vi.fn<typeof fetch>(async () =>
          Promise.resolve(
            new Response(await readFile(fixturePath), { status: 200 }),
          ),
        ),
      });

      await expect(
        refresh.run({
          kind: "wordfence-intelligence-refresh",
          schemaVersion: 1,
        }),
      ).resolves.toMatchObject({ status: "current" });

      const indexMetadata = await lstat(indexDirectory);
      expect(indexMetadata.isDirectory()).toBe(true);
      expect(indexMetadata.mode & 0o777).toBe(0o700);
      for (const path of [
        databasePath,
        `${databasePath}-wal`,
        `${databasePath}-shm`,
      ]) {
        const metadata = await lstat(path);
        expect(metadata.isFile()).toBe(true);
        expect(metadata.mode & 0o777).toBe(0o600);
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("secures an existing owner-controlled production SQLite index before use", async () => {
    const directory = await mkdtemp(
      join(tmpdir(), "wordfence-existing-private-index-"),
    );
    const indexDirectory = join(directory, "index");
    const databasePath = join(indexDirectory, "target-intelligence.sqlite");
    await mkdir(indexDirectory, { mode: 0o755 });
    await chmod(indexDirectory, 0o755);
    await writeFile(databasePath, new Uint8Array(), { mode: 0o644 });
    await chmod(databasePath, 0o644);
    try {
      const refresh = openWordfenceIntelligenceRefresh({
        databasePath,
        artifactDirectory: join(directory, "artifacts"),
        credentialBroker: {
          async resolve<T>(): Promise<T> {
            throw new Error("inspection must not resolve a credential");
          },
        },
      });
      await expect(
        refresh.inspect({
          kind: "wordfence-intelligence-inspection",
          schemaVersion: 1,
        }),
      ).resolves.toMatchObject({ status: "failed", reason: "not-refreshed" });

      expect((await lstat(indexDirectory)).mode & 0o777).toBe(0o700);
      for (const path of [
        databasePath,
        `${databasePath}-wal`,
        `${databasePath}-shm`,
      ]) {
        const metadata = await lstat(path);
        expect(metadata.isFile()).toBe(true);
        expect(metadata.mode & 0o777).toBe(0o600);
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it.each(["ancestor directory", "directory", "database"] as const)(
    "rejects an existing production SQLite %s symlink before credential resolution",
    async (target) => {
      const directory = await mkdtemp(
        join(tmpdir(), "wordfence-private-index-symlink-"),
      );
      const realIndexDirectory = join(directory, "real-index");
      const selectedIndexDirectory = join(directory, "selected-index");
      const databasePath = join(
        target === "database" ? realIndexDirectory : selectedIndexDirectory,
        ...(target === "ancestor directory" ? ["nested"] : []),
        "target-intelligence.sqlite",
      );
      let resolveCalls = 0;
      await mkdir(realIndexDirectory, { mode: 0o700 });
      if (target !== "database") {
        await symlink(realIndexDirectory, selectedIndexDirectory, "dir");
      } else {
        const backingPath = join(directory, "backing.sqlite");
        await writeFile(backingPath, new Uint8Array(), { mode: 0o600 });
        await symlink(backingPath, databasePath, "file");
      }
      try {
        const refresh = openWordfenceIntelligenceRefresh({
          databasePath,
          artifactDirectory: join(directory, "artifacts"),
          credentialBroker: {
            async resolve<T>(): Promise<T> {
              resolveCalls += 1;
              throw new Error("must not resolve for unsafe storage");
            },
          },
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
        if (target === "ancestor directory") {
          await expect(
            lstat(join(realIndexDirectory, "nested")),
          ).rejects.toMatchObject({ code: "ENOENT" });
        }
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    },
  );

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
      expect(result).toEqual({
        kind: "wordfence-intelligence-result",
        schemaVersion: 1,
        status: "current",
        snapshot: {
          kind: "wordfence-intelligence-snapshot",
          schemaVersion: 1,
          retrievedAt: expect.stringMatching(
            /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u,
          ),
          source: {
            sourceUrl,
            contentDigest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/u),
            parserVersion: "wordfence-intelligence-production-v3",
            recordCount: 2,
            complete: true,
          },
        },
        snapshotRef: {
          kind: "wordfence-intelligence-snapshot-ref",
          schemaVersion: 1,
          id: expect.stringMatching(/^wordfence-snapshot:[a-f0-9]{24}$/u),
          digest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/u),
        },
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

  it("returns a typed failure when the host cannot allocate the index path", async () => {
    const directory = await mkdtemp(join(tmpdir(), "wordfence-storage-"));
    const overlongPathComponent = "x".repeat(300);
    let resolveCalls = 0;
    try {
      const refresh = openWordfenceIntelligenceRefresh({
        databasePath: join(
          directory,
          overlongPathComponent,
          "target-intelligence.sqlite",
        ),
        artifactDirectory: join(directory, "artifacts"),
        credentialBroker: {
          async resolve<T>(): Promise<T> {
            resolveCalls += 1;
            throw new Error("must not resolve when storage is unavailable");
          },
        },
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
      expect(current).toEqual({
        kind: "wordfence-intelligence-result",
        schemaVersion: 1,
        status: "current",
        snapshot: {
          kind: "wordfence-intelligence-snapshot",
          schemaVersion: 1,
          retrievedAt: "2030-08-01T00:00:00.000Z",
          source: {
            sourceUrl,
            contentDigest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/u),
            parserVersion: "wordfence-intelligence-production-v3",
            recordCount: 2,
            complete: true,
          },
        },
        snapshotRef: {
          kind: "wordfence-intelligence-snapshot-ref",
          schemaVersion: 1,
          id: expect.stringMatching(/^wordfence-snapshot:[a-f0-9]{24}$/u),
          digest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/u),
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
          schemaVersion: 2,
          automaticRetries: 0,
          boundedAt: "2030-08-01T00:00:00.000Z",
          maximumDelaySeconds: 86_400,
          retryAfter: {
            kind: "delay-seconds",
            seconds: 120,
            capped: false,
          },
        },
      });
      expect(wordfenceIntelligenceResultSchema.parse(rateLimited)).toEqual(
        rateLimited,
      );
      expect(wordfenceIntelligenceResultSchema.parse(current)).toEqual(current);
      const latestRefresh = {
        kind: "wordfence-intelligence-refresh-attempt",
        schemaVersion: 1,
        attemptedAt: "2030-08-01T00:00:00.000Z",
        result: rateLimited,
      } as const;
      const stale = await refresh.inspect({
        kind: "wordfence-intelligence-inspection",
        schemaVersion: 1,
      });
      expect(stale).toEqual({
        ...current,
        status: "stale",
        latestRefresh,
      });
      expect(wordfenceIntelligenceResultSchema.parse(stale)).toEqual(stale);

      const replayFetch = vi.fn<typeof fetch>(() =>
        Promise.reject(new Error("inspect must not access the network")),
      );
      const restarted = openWordfenceIntelligenceRefresh({
        databasePath: join(directory, "target-intelligence.sqlite"),
        artifactDirectory: join(directory, "artifacts"),
        credentialBroker,
        fetch: replayFetch,
      });
      const replayed = await restarted.inspect({
        kind: "wordfence-intelligence-inspection",
        schemaVersion: 1,
      });
      expect(replayed).toEqual(stale);
      expect(replayFetch).not.toHaveBeenCalled();

      expect(
        JSON.stringify([current, rateLimited, stale, replayed]),
      ).not.toContain(credential);

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

  it.each([
    { signal: "HTTP 206", status: 206, headers: {} },
    {
      signal: "Content-Range",
      status: 200,
      headers: { "content-range": "bytes 0-1023/2048" },
    },
  ] as const)(
    "treats $signal as a partial response and preserves the prior current snapshot",
    async ({ status, headers }) => {
      const directory = await mkdtemp(
        join(tmpdir(), "wordfence-http-partial-"),
      );
      const bytes = await readFile(fixturePath);
      const fetchMock = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(new Response(bytes, { status: 200 }))
        .mockResolvedValueOnce(new Response(bytes, { status, headers }));
      let now = new Date("2030-08-01T00:00:00.000Z");
      try {
        const refresh = openWordfenceIntelligenceRefresh({
          databasePath: join(directory, "index", "target-intelligence.sqlite"),
          artifactDirectory: join(directory, "artifacts"),
          credentialBroker: {
            async resolve<T>(
              _reference: WordfenceSecretRef,
              use: (credential: string) => Promise<T>,
            ): Promise<T> {
              return use("synthetic-partial-response-credential");
            },
          },
          fetch: fetchMock,
          clock: () => now,
        });
        const current = await refresh.run({
          kind: "wordfence-intelligence-refresh",
          schemaVersion: 1,
        });
        if (current.status !== "current") {
          throw new Error("Expected an initial current snapshot");
        }

        now = new Date("2030-08-02T00:00:00.000Z");
        const partial = await refresh.run({
          kind: "wordfence-intelligence-refresh",
          schemaVersion: 1,
        });
        expect(partial).toEqual({
          kind: "wordfence-intelligence-result",
          schemaVersion: 1,
          status: "failed",
          reason: "partial-response",
        });
        await expect(
          refresh.inspect({
            kind: "wordfence-intelligence-inspection",
            schemaVersion: 1,
          }),
        ).resolves.toEqual({
          ...current,
          status: "stale",
          latestRefresh: {
            kind: "wordfence-intelligence-refresh-attempt",
            schemaVersion: 1,
            attemptedAt: "2030-08-02T00:00:00.000Z",
            result: partial,
          },
        });
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    },
  );

  it.each([
    {
      status: 429,
      headers: { "retry-after": "120" },
      expected: {
        kind: "wordfence-intelligence-result",
        schemaVersion: 1,
        status: "failed",
        reason: "rate-limited",
        backoff: {
          kind: "wordfence-rate-limit-backoff",
          schemaVersion: 2,
          automaticRetries: 0,
          boundedAt: "2030-08-01T00:00:00.000Z",
          maximumDelaySeconds: 86_400,
          retryAfter: {
            kind: "delay-seconds",
            seconds: 120,
            capped: false,
          },
        },
      },
    },
    {
      status: 401,
      headers: {},
      expected: {
        kind: "wordfence-intelligence-result",
        schemaVersion: 1,
        status: "failed",
        reason: "authentication-failed",
      },
    },
  ] as const)(
    "replays an initial $expected.reason failure after restart",
    async ({ status, headers, expected }) => {
      const directory = await mkdtemp(
        join(tmpdir(), "wordfence-initial-failure-"),
      );
      const databasePath = join(directory, "target-intelligence.sqlite");
      const credentialBroker: HostPrivateCredentialBroker = {
        async resolve<T>(
          _reference: WordfenceSecretRef,
          use: (credential: string) => Promise<T>,
        ): Promise<T> {
          return use("synthetic-initial-failure-credential");
        },
      };
      try {
        const initial = openWordfenceIntelligenceRefresh({
          databasePath,
          artifactDirectory: join(directory, "artifacts"),
          credentialBroker,
          fetch: vi.fn<typeof fetch>(async () =>
            Promise.resolve(new Response(undefined, { status, headers })),
          ),
          clock: () => new Date("2030-08-01T00:00:00.000Z"),
        });
        await expect(
          initial.run({
            kind: "wordfence-intelligence-refresh",
            schemaVersion: 1,
          }),
        ).resolves.toEqual(expected);

        const replayFetch = vi.fn<typeof fetch>(() =>
          Promise.reject(new Error("inspection must not retrieve the feed")),
        );
        const restarted = openWordfenceIntelligenceRefresh({
          databasePath,
          artifactDirectory: join(directory, "artifacts"),
          credentialBroker,
          fetch: replayFetch,
        });
        await expect(
          restarted.inspect({
            kind: "wordfence-intelligence-inspection",
            schemaVersion: 1,
          }),
        ).resolves.toEqual(expected);
        expect(replayFetch).not.toHaveBeenCalled();
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    },
  );

  it("does not publish a successful snapshot when freshness-state commit fails", async () => {
    const directory = await mkdtemp(
      join(tmpdir(), "wordfence-atomic-refresh-"),
    );
    const databasePath = join(directory, "target-intelligence.sqlite");
    const validBytes = await readFile(fixturePath);
    const seedFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(validBytes, { status: 200 }))
      .mockResolvedValueOnce(
        new Response(undefined, {
          status: 429,
          headers: { "retry-after": "120" },
        }),
      );
    const credentialBroker: HostPrivateCredentialBroker = {
      async resolve<T>(
        _reference: WordfenceSecretRef,
        use: (credential: string) => Promise<T>,
      ): Promise<T> {
        return use("synthetic-atomic-refresh-credential");
      },
    };
    try {
      const seed = openWordfenceIntelligenceRefresh({
        databasePath,
        artifactDirectory: join(directory, "artifacts"),
        credentialBroker,
        fetch: seedFetch,
        clock: () => new Date("2030-08-01T00:00:00.000Z"),
      });
      await seed.run({
        kind: "wordfence-intelligence-refresh",
        schemaVersion: 1,
      });
      await seed.run({
        kind: "wordfence-intelligence-refresh",
        schemaVersion: 1,
      });
      const before = await seed.inspect({
        kind: "wordfence-intelligence-inspection",
        schemaVersion: 1,
      });
      expect(before.status).toBe("stale");

      const failureInjection = new Database(databasePath);
      failureInjection.exec(`
        CREATE TRIGGER reject_refresh_state_cleanup
        BEFORE DELETE ON wordfence_intelligence_refresh_state
        BEGIN
          SELECT RAISE(ABORT, 'synthetic freshness-state commit failure');
        END
      `);
      failureInjection.close();

      const attempted = openWordfenceIntelligenceRefresh({
        databasePath,
        artifactDirectory: join(directory, "artifacts"),
        credentialBroker,
        fetch: vi.fn<typeof fetch>(async () =>
          Promise.resolve(new Response(validBytes, { status: 200 })),
        ),
        clock: () => new Date("2030-08-02T00:00:00.000Z"),
      });
      await expect(
        attempted.run({
          kind: "wordfence-intelligence-refresh",
          schemaVersion: 1,
        }),
      ).rejects.toThrow("synthetic freshness-state commit failure");
      await expect(
        attempted.inspect({
          kind: "wordfence-intelligence-inspection",
          schemaVersion: 1,
        }),
      ).resolves.toEqual(before);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("projects concurrent refreshes in their serialized commit order", async () => {
    const directory = await mkdtemp(
      join(tmpdir(), "wordfence-serialized-refresh-"),
    );
    const databasePath = join(directory, "target-intelligence.sqlite");
    const validBytes = await readFile(fixturePath);
    const credentialBroker: HostPrivateCredentialBroker = {
      async resolve<T>(
        _reference: WordfenceSecretRef,
        use: (credential: string) => Promise<T>,
      ): Promise<T> {
        return use("synthetic-serialized-refresh-credential");
      },
    };
    const openRefresh = (fetchImplementation: typeof fetch, at: string) =>
      openWordfenceIntelligenceRefresh({
        databasePath,
        artifactDirectory: join(directory, "artifacts"),
        credentialBroker,
        fetch: fetchImplementation,
        clock: () => new Date(at),
      });
    try {
      const seed = openRefresh(
        vi.fn<typeof fetch>(async () =>
          Promise.resolve(new Response(validBytes, { status: 200 })),
        ),
        "2030-08-01T00:00:00.000Z",
      );
      await seed.run({
        kind: "wordfence-intelligence-refresh",
        schemaVersion: 1,
      });

      const failureFirstFetch = controlledFetch();
      const successLastFetch = controlledFetch();
      const failureFirst = openRefresh(
        failureFirstFetch.fetch,
        "2030-08-02T00:00:00.000Z",
      );
      const successLast = openRefresh(
        successLastFetch.fetch,
        "2030-08-03T00:00:00.000Z",
      );
      await failureFirst.inspect({
        kind: "wordfence-intelligence-inspection",
        schemaVersion: 1,
      });
      await successLast.inspect({
        kind: "wordfence-intelligence-inspection",
        schemaVersion: 1,
      });
      const failedFirstRun = failureFirst.run({
        kind: "wordfence-intelligence-refresh",
        schemaVersion: 1,
      });
      const successfulLastRun = successLast.run({
        kind: "wordfence-intelligence-refresh",
        schemaVersion: 1,
      });
      await Promise.all([failureFirstFetch.started, successLastFetch.started]);
      failureFirstFetch.respond(
        new Response(undefined, {
          status: 429,
          headers: { "retry-after": "120" },
        }),
      );
      await failedFirstRun;
      successLastFetch.respond(new Response(validBytes, { status: 200 }));
      const successfulLastResult = await successfulLastRun;
      await expect(
        successLast.inspect({
          kind: "wordfence-intelligence-inspection",
          schemaVersion: 1,
        }),
      ).resolves.toEqual(successfulLastResult);

      const successFirstFetch = controlledFetch();
      const failureLastFetch = controlledFetch();
      const successFirst = openRefresh(
        successFirstFetch.fetch,
        "2030-08-04T00:00:00.000Z",
      );
      const failureLast = openRefresh(
        failureLastFetch.fetch,
        "2030-08-05T00:00:00.000Z",
      );
      await successFirst.inspect({
        kind: "wordfence-intelligence-inspection",
        schemaVersion: 1,
      });
      await failureLast.inspect({
        kind: "wordfence-intelligence-inspection",
        schemaVersion: 1,
      });
      const successfulFirstRun = successFirst.run({
        kind: "wordfence-intelligence-refresh",
        schemaVersion: 1,
      });
      const failedLastRun = failureLast.run({
        kind: "wordfence-intelligence-refresh",
        schemaVersion: 1,
      });
      await Promise.all([successFirstFetch.started, failureLastFetch.started]);
      successFirstFetch.respond(new Response(validBytes, { status: 200 }));
      const successfulFirstResult = await successfulFirstRun;
      failureLastFetch.respond(
        new Response(undefined, {
          status: 429,
          headers: { "retry-after": "120" },
        }),
      );
      const failedLastResult = await failedLastRun;
      await expect(
        failureLast.inspect({
          kind: "wordfence-intelligence-inspection",
          schemaVersion: 1,
        }),
      ).resolves.toEqual({
        ...successfulFirstResult,
        status: "stale",
        latestRefresh: {
          kind: "wordfence-intelligence-refresh-attempt",
          schemaVersion: 1,
          attemptedAt: "2030-08-05T00:00:00.000Z",
          result: failedLastResult,
        },
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("inspects the snapshot and freshness marker from one committed state", async () => {
    const directory = await mkdtemp(
      join(tmpdir(), "wordfence-consistent-inspection-"),
    );
    const databasePath = join(directory, "target-intelligence.sqlite");
    const validBytes = await readFile(fixturePath);
    let now = "2030-08-02T00:00:00.000Z";
    const credentialBroker: HostPrivateCredentialBroker = {
      async resolve<T>(
        _reference: WordfenceSecretRef,
        use: (credential: string) => Promise<T>,
      ): Promise<T> {
        return use("synthetic-consistent-inspection-credential");
      },
    };
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(validBytes, { status: 200 }))
      .mockResolvedValueOnce(new Response(validBytes, { status: 200 }))
      .mockResolvedValueOnce(
        new Response(undefined, {
          status: 429,
          headers: { "retry-after": "120" },
        }),
      );
    try {
      const writer = openWordfenceIntelligenceRefresh({
        databasePath,
        artifactDirectory: join(directory, "artifacts"),
        credentialBroker,
        fetch: fetchMock,
        clock: () => new Date(now),
      });
      const replacement = await writer.run({
        kind: "wordfence-intelligence-refresh",
        schemaVersion: 1,
      });
      expect(replacement.status).toBe("current");
      if (replacement.status !== "current") {
        throw new Error("Expected a replacement snapshot");
      }
      now = "2030-08-01T00:00:00.000Z";
      await writer.run({
        kind: "wordfence-intelligence-refresh",
        schemaVersion: 1,
      });
      now = "2030-08-03T00:00:00.000Z";
      await writer.run({
        kind: "wordfence-intelligence-refresh",
        schemaVersion: 1,
      });

      const reader = openWordfenceIntelligenceRefresh({
        databasePath,
        artifactDirectory: join(directory, "artifacts"),
        credentialBroker,
        fetch: vi.fn<typeof fetch>(() =>
          Promise.reject(new Error("inspection must not retrieve the feed")),
        ),
      });
      const stale = await reader.inspect({
        kind: "wordfence-intelligence-inspection",
        schemaVersion: 1,
      });
      expect(stale.status).toBe("stale");

      const concurrentPublication = new Database(databasePath);
      let observed: Awaited<ReturnType<typeof reader.inspect>>;
      try {
        const publishReplacement = concurrentPublication.transaction(() => {
          concurrentPublication
            .prepare(
              `UPDATE wordfence_intelligence_current
                  SET snapshot_digest = ?
                WHERE singleton = 1`,
            )
            .run(replacement.snapshotRef.digest);
          concurrentPublication
            .prepare(
              `DELETE FROM wordfence_intelligence_refresh_state
               WHERE singleton = 1`,
            )
            .run();
        });
        const inspection = reader.inspect({
          kind: "wordfence-intelligence-inspection",
          schemaVersion: 1,
        });
        const publication = Promise.resolve().then(() => {
          publishReplacement.immediate();
        });
        [observed] = await Promise.all([inspection, publication]);
      } finally {
        concurrentPublication.close();
      }

      expect([stale, replacement]).toContainEqual(observed);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it.each([
    {
      retryAfter: "999999999999999999999999999999",
      expected: {
        kind: "delay-seconds",
        seconds: 86_400,
        capped: true,
      },
    },
    {
      retryAfter: "Thu, 01 Jan 2099 00:00:00 GMT",
      expected: {
        kind: "absolute-time",
        at: "2030-08-02T00:00:00.000Z",
        capped: true,
      },
    },
  ] as const)(
    "bounds Retry-After $retryAfter without an automatic retry",
    async ({ retryAfter, expected }) => {
      const directory = await mkdtemp(join(tmpdir(), "wordfence-backoff-"));
      const fetchMock = vi.fn<typeof fetch>(async () =>
        Promise.resolve(
          new Response(undefined, {
            status: 429,
            headers: { "retry-after": retryAfter },
          }),
        ),
      );
      try {
        const refresh = openWordfenceIntelligenceRefresh({
          databasePath: join(directory, "target-intelligence.sqlite"),
          artifactDirectory: join(directory, "artifacts"),
          credentialBroker: {
            async resolve<T>(
              _reference: WordfenceSecretRef,
              use: (credential: string) => Promise<T>,
            ): Promise<T> {
              return use("synthetic-bounded-backoff-credential");
            },
          },
          fetch: fetchMock,
          clock: () => new Date("2030-08-01T00:00:00.000Z"),
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
          reason: "rate-limited",
          backoff: {
            kind: "wordfence-rate-limit-backoff",
            schemaVersion: 2,
            automaticRetries: 0,
            boundedAt: "2030-08-01T00:00:00.000Z",
            maximumDelaySeconds: 86_400,
            retryAfter: expected,
          },
        });
        expect(fetchMock).toHaveBeenCalledTimes(1);
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    },
  );

  it("reports the response byte ceiling separately from a partial response", async () => {
    const directory = await mkdtemp(join(tmpdir(), "wordfence-byte-ceiling-"));
    const fetchMock = vi.fn<typeof fetch>(async () =>
      Promise.resolve(
        new Response(await readFile(fixturePath), { status: 200 }),
      ),
    );
    try {
      const refresh = openWordfenceIntelligenceRefresh({
        databasePath: join(directory, "target-intelligence.sqlite"),
        artifactDirectory: join(directory, "artifacts"),
        credentialBroker: {
          async resolve<T>(
            _reference: WordfenceSecretRef,
            use: (credential: string) => Promise<T>,
          ): Promise<T> {
            return use("synthetic-byte-ceiling-credential");
          },
        },
        maximumFeedBytes: 1,
        fetch: fetchMock,
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
        reason: "response-byte-ceiling-exceeded",
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("sanitizes credential-broker errors from public results, logs, and storage", async () => {
    const directory = await mkdtemp(join(tmpdir(), "wordfence-secret-error-"));
    const credential = "synthetic-secret-only-present-in-broker-error";
    const logged: unknown[][] = [];
    const consoleSpies = [
      vi.spyOn(console, "debug").mockImplementation((...values) => {
        logged.push(values);
      }),
      vi.spyOn(console, "info").mockImplementation((...values) => {
        logged.push(values);
      }),
      vi.spyOn(console, "log").mockImplementation((...values) => {
        logged.push(values);
      }),
      vi.spyOn(console, "warn").mockImplementation((...values) => {
        logged.push(values);
      }),
      vi.spyOn(console, "error").mockImplementation((...values) => {
        logged.push(values);
      }),
    ];
    try {
      const refresh = openWordfenceIntelligenceRefresh({
        databasePath: join(directory, "target-intelligence.sqlite"),
        artifactDirectory: join(directory, "artifacts"),
        credentialBroker: {
          async resolve<T>(): Promise<T> {
            throw new Error(`broker failed while handling ${credential}`);
          },
        },
      });

      const result = await refresh.run({
        kind: "wordfence-intelligence-refresh",
        schemaVersion: 1,
      });
      expect(result).toEqual({
        kind: "wordfence-intelligence-result",
        schemaVersion: 1,
        status: "failed",
        reason: "credential-unavailable",
      });
      expect(JSON.stringify(result)).not.toContain(credential);
      expect(logged.flat().map(String).join("\n")).not.toContain(credential);
      const persisted = await Promise.all(
        (await filesBelow(directory)).map((path) => readFile(path)),
      );
      expect(persisted.every((bytes) => !bytes.includes(credential))).toBe(
        true,
      );
    } finally {
      for (const spy of consoleSpies) {
        spy.mockRestore();
      }
      await rm(directory, { recursive: true, force: true });
    }
  });
});
