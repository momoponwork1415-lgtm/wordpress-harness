import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  createWordfenceIntelligenceV3FetchAdapter,
  openWordfenceIntelligence,
  type WordfenceIntelligenceV3Adapter,
} from "../../src/target-intelligence/index.js";

const fixturePath = join(
  import.meta.dirname,
  "..",
  "fixtures",
  "target-intelligence",
  "wordfence-intelligence-v3",
  "production.json",
);
const digest = (character: string): string => `sha256:${character.repeat(64)}`;

function fixtureAdapter(): WordfenceIntelligenceV3Adapter {
  return {
    sourceUrl:
      "https://www.wordfence.com/api/intelligence/v3/vulnerabilities/production",
    retrieveProductionFeed: async () => ({
      status: 200,
      sourceUrl:
        "https://www.wordfence.com/api/intelligence/v3/vulnerabilities/production",
      complete: true,
      bytes: await readFile(fixturePath),
    }),
  };
}

describe("WordfenceIntelligence", () => {
  it("atomically refreshes the v3 feed while separating selection aggregate from verified-Finding records", async () => {
    const directory = await mkdtemp(join(tmpdir(), "wordfence-intelligence-"));
    try {
      const intelligence = openWordfenceIntelligence({
        databasePath: join(directory, "target-intelligence.sqlite"),
        artifactDirectory: join(directory, "artifacts"),
        adapter: fixtureAdapter(),
        credential: { kind: "secret-ref", id: "wordfence-v3-api-key" },
        clock: () => new Date("2030-08-01T00:00:00.000Z"),
      });

      const refreshed = await intelligence.refresh({
        kind: "wordfence-intelligence-refresh",
        schemaVersion: 1,
      });
      expect(refreshed).toMatchObject({
        status: "current",
        snapshot: {
          kind: "wordfence-intelligence-snapshot",
          schemaVersion: 1,
          retrievedAt: "2030-08-01T00:00:00.000Z",
          source: {
            sourceUrl:
              "https://www.wordfence.com/api/intelligence/v3/vulnerabilities/production",
            contentDigest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
            parserVersion: "wordfence-intelligence-production-v3",
            recordCount: 2,
            complete: true,
          },
        },
        snapshotRef: {
          id: expect.stringMatching(/^wordfence-snapshot:/),
          digest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
        },
      });
      if (refreshed.status !== "current") {
        throw new Error("Expected a current Wordfence snapshot");
      }

      const aggregate = await intelligence.aggregate({
        kind: "wordfence-vulnerability-history-aggregate",
        schemaVersion: 1,
        snapshotRef: refreshed.snapshotRef,
        pluginIdentity: "wporg:fixture-plugin",
      });
      expect(aggregate).toEqual({
        kind: "vulnerability-history-aggregate",
        schemaVersion: 1,
        pluginIdentity: "wporg:fixture-plugin",
        snapshotRef: refreshed.snapshotRef,
        recordCount: 2,
        disclosureDensity: {
          kind: "records-per-published-year",
          publishedYears: 2,
          value: 1,
        },
        lastPublishedAt: "2029-02-20T08:30:00.000Z",
      });
      expect(JSON.stringify(aggregate)).not.toMatch(
        /CVE-|cwe|cvss|affected|patched|route/i,
      );

      const known = await intelligence.inspectKnownRecords({
        kind: "wordfence-known-record-inspection",
        schemaVersion: 1,
        snapshotRef: refreshed.snapshotRef,
        pluginIdentity: "wporg:fixture-plugin",
        verifiedVersion: "1.2.0",
        verifiedFindingRef: {
          id: "verified-finding:fixture",
          digest: digest("f"),
        },
        purpose: "known-duplicate-disposition",
      });
      expect(known).toMatchObject({
        kind: "wordfence-known-record-projection",
        schemaVersion: 1,
        pluginIdentity: "wporg:fixture-plugin",
        verifiedVersion: "1.2.0",
        records: [
          {
            recordId: "11111111-1111-4111-8111-111111111111",
            cve: "CVE-2099-0001",
            affectedVersionIntervals: [
              {
                fromVersion: "1.0.0",
                fromInclusive: true,
                toVersion: "1.4.0",
                toInclusive: true,
              },
            ],
            patchedVersions: ["1.4.1"],
            cwe: { id: 79 },
            cvss: { score: 6.1 },
            attribution: {
              wordfence: {
                notice: "Sanitized Wordfence notice",
                license: "Sanitized Wordfence license",
              },
              mitre: {
                notice: "Sanitized MITRE notice",
                license: "Sanitized MITRE license",
              },
            },
          },
          {
            recordId: "22222222-2222-4222-8222-222222222222",
            affectedVersionIntervals: [
              {
                fromVersion: "*",
                toVersion: "2.0.0",
                toInclusive: false,
              },
            ],
            patchedVersions: ["2.0.0"],
          },
        ],
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("replays the current snapshot after restart without retrieving the feed again", async () => {
    const directory = await mkdtemp(join(tmpdir(), "wordfence-replay-"));
    const databasePath = join(directory, "target-intelligence.sqlite");
    const artifactDirectory = join(directory, "artifacts");
    try {
      const first = openWordfenceIntelligence({
        databasePath,
        artifactDirectory,
        adapter: fixtureAdapter(),
        credential: { kind: "secret-ref", id: "wordfence-v3-api-key" },
        clock: () => new Date("2030-08-01T00:00:00.000Z"),
      });
      const refreshed = await first.refresh({
        kind: "wordfence-intelligence-refresh",
        schemaVersion: 1,
      });
      if (refreshed.status !== "current") {
        throw new Error("Expected a current snapshot");
      }
      const expectedAggregate = await first.aggregate({
        kind: "wordfence-vulnerability-history-aggregate",
        schemaVersion: 1,
        snapshotRef: refreshed.snapshotRef,
        pluginIdentity: "wporg:fixture-plugin",
      });

      const restarted = openWordfenceIntelligence({
        databasePath,
        artifactDirectory,
        adapter: {
          ...fixtureAdapter(),
          retrieveProductionFeed: () =>
            Promise.reject(new Error("must not retrieve during replay")),
        },
        credential: { kind: "secret-ref", id: "wordfence-v3-api-key" },
      });
      await expect(
        restarted.inspect({
          kind: "wordfence-intelligence-inspection",
          schemaVersion: 1,
        }),
      ).resolves.toEqual(refreshed);
      await expect(
        restarted.aggregate({
          kind: "wordfence-vulnerability-history-aggregate",
          schemaVersion: 1,
          snapshotRef: refreshed.snapshotRef,
          pluginIdentity: "wporg:fixture-plugin",
        }),
      ).resolves.toEqual(expectedAggregate);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("keeps the prior current pointer when a later feed fails validation", async () => {
    const directory = await mkdtemp(join(tmpdir(), "wordfence-atomic-"));
    let bytes = await readFile(fixturePath);
    const adapter: WordfenceIntelligenceV3Adapter = {
      sourceUrl: fixtureAdapter().sourceUrl,
      retrieveProductionFeed: async () => ({
        status: 200,
        sourceUrl: fixtureAdapter().sourceUrl,
        complete: true,
        bytes,
      }),
    };
    try {
      const intelligence = openWordfenceIntelligence({
        databasePath: join(directory, "target-intelligence.sqlite"),
        artifactDirectory: join(directory, "artifacts"),
        adapter,
        credential: { kind: "secret-ref", id: "wordfence-v3-api-key" },
        clock: () => new Date("2030-08-01T00:00:00.000Z"),
      });
      const current = await intelligence.refresh({
        kind: "wordfence-intelligence-refresh",
        schemaVersion: 1,
      });
      if (current.status !== "current") {
        throw new Error("Expected the valid fixture to become current");
      }
      bytes = Buffer.from('{"not-a-uuid":{"id":"schema drift"}}');

      await expect(
        intelligence.refresh({
          kind: "wordfence-intelligence-refresh",
          schemaVersion: 1,
        }),
      ).resolves.toEqual({ status: "failed", reason: "schema-drift" });
      await expect(
        intelligence.inspect({
          kind: "wordfence-intelligence-inspection",
          schemaVersion: 1,
        }),
      ).resolves.toEqual(current);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it.each([
    { status: 401, complete: true, reason: "authentication-failed" },
    { status: 404, complete: true, reason: "not-found" },
    { status: 429, complete: true, reason: "rate-limited" },
    { status: 503, complete: true, reason: "network-failure" },
    { status: 200, complete: false, reason: "partial-response" },
  ] as const)(
    "returns $reason without publishing an invalid current snapshot",
    async ({ status, complete, reason }) => {
      const directory = await mkdtemp(join(tmpdir(), "wordfence-failure-"));
      try {
        const base = fixtureAdapter();
        const intelligence = openWordfenceIntelligence({
          databasePath: join(directory, "target-intelligence.sqlite"),
          artifactDirectory: join(directory, "artifacts"),
          adapter: {
            ...base,
            retrieveProductionFeed: async () => ({
              status,
              sourceUrl: base.sourceUrl,
              complete,
              bytes: await readFile(fixturePath),
            }),
          },
          credential: { kind: "secret-ref", id: "wordfence-v3-api-key" },
        });
        await expect(
          intelligence.refresh({
            kind: "wordfence-intelligence-refresh",
            schemaVersion: 1,
          }),
        ).resolves.toEqual({ status: "failed", reason });
        await expect(
          intelligence.inspect({
            kind: "wordfence-intelligence-inspection",
            schemaVersion: 1,
          }),
        ).resolves.toEqual({ status: "failed", reason: "not-refreshed" });
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    },
  );

  it("rejects missing copyright metadata separately from schema drift", async () => {
    const directory = await mkdtemp(join(tmpdir(), "wordfence-license-"));
    const feed = JSON.parse(await readFile(fixturePath, "utf8")) as Record<
      string,
      Record<string, unknown>
    >;
    const first = feed["11111111-1111-4111-8111-111111111111"];
    if (first === undefined) {
      throw new Error("Fixture lost its first record");
    }
    delete first.copyrights;
    try {
      const base = fixtureAdapter();
      const intelligence = openWordfenceIntelligence({
        databasePath: join(directory, "target-intelligence.sqlite"),
        artifactDirectory: join(directory, "artifacts"),
        adapter: {
          ...base,
          retrieveProductionFeed: async () => ({
            status: 200,
            sourceUrl: base.sourceUrl,
            complete: true,
            bytes: Buffer.from(JSON.stringify(feed)),
          }),
        },
        credential: { kind: "secret-ref", id: "wordfence-v3-api-key" },
      });
      await expect(
        intelligence.refresh({
          kind: "wordfence-intelligence-refresh",
          schemaVersion: 1,
        }),
      ).resolves.toEqual({ status: "failed", reason: "attribution-missing" });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("requires verified Finding identity and applies affected-version interval boundaries", async () => {
    const directory = await mkdtemp(join(tmpdir(), "wordfence-interval-"));
    try {
      const intelligence = openWordfenceIntelligence({
        databasePath: join(directory, "target-intelligence.sqlite"),
        artifactDirectory: join(directory, "artifacts"),
        adapter: fixtureAdapter(),
        credential: { kind: "secret-ref", id: "wordfence-v3-api-key" },
      });
      const refreshed = await intelligence.refresh({
        kind: "wordfence-intelligence-refresh",
        schemaVersion: 1,
      });
      if (refreshed.status !== "current") {
        throw new Error("Expected a current snapshot");
      }
      const base = {
        kind: "wordfence-known-record-inspection" as const,
        schemaVersion: 1 as const,
        snapshotRef: refreshed.snapshotRef,
        pluginIdentity: "wporg:fixture-plugin",
        verifiedFindingRef: {
          id: "verified-finding:fixture",
          digest: digest("f"),
        },
        purpose: "known-duplicate-disposition" as const,
      };
      await expect(
        intelligence.inspectKnownRecords({
          ...base,
          verifiedVersion: "1.4.1",
        }),
      ).resolves.toMatchObject({
        records: [{ recordId: "22222222-2222-4222-8222-222222222222" }],
      });
      await expect(
        intelligence.inspectKnownRecords({ ...base, verifiedVersion: "2.0.0" }),
      ).resolves.toMatchObject({ records: [] });
      await expect(
        intelligence.inspectKnownRecords({ ...base, verifiedVersion: "2.0" }),
      ).resolves.toMatchObject({ records: [] });

      const withoutFinding = {
        ...base,
        verifiedVersion: "1.2.0",
      } as Record<string, unknown>;
      delete withoutFinding.verifiedFindingRef;
      await expect(
        Reflect.apply(intelligence.inspectKnownRecords, intelligence, [
          withoutFinding,
        ]),
      ).rejects.toThrow("verifiedFindingRef");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("resolves the Bearer credential only inside the production Adapter", async () => {
    const bytes = await readFile(fixturePath);
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock.mockResolvedValue(new Response(bytes, { status: 200 }));
    const adapter = createWordfenceIntelligenceV3FetchAdapter({
      credentialResolver: () => "test-only-secret",
      fetch: fetchMock,
    });
    const response = await adapter.retrieveProductionFeed({
      credential: { kind: "secret-ref", id: "wordfence-v3-api-key" },
      maximumBytes: 1_000_000,
    });

    expect(response).toMatchObject({ status: 200, complete: true });
    expect(JSON.stringify(response)).not.toContain("test-only-secret");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://www.wordfence.com/api/intelligence/v3/vulnerabilities/production",
      expect.objectContaining({
        headers: {
          accept: "application/json",
          authorization: "Bearer test-only-secret",
        },
      }),
    );
  });
});
