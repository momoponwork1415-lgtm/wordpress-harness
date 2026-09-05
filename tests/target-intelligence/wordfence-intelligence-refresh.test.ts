import { readdir, readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  openWordfenceIntelligenceRefresh,
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

      await expect(
        refresh.run({
          kind: "wordfence-intelligence-refresh",
          schemaVersion: 1,
        }),
      ).resolves.toEqual({
        status: "failed",
        reason: "rate-limited",
        backoff: {
          kind: "wordfence-rate-limit-backoff",
          schemaVersion: 1,
          automaticRetries: 0,
          retryAfter: { kind: "delay-seconds", seconds: 120 },
        },
      });
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
