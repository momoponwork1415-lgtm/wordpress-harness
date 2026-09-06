import { createHash } from "node:crypto";
import { cp, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";
import { z } from "zod";

import { openResearch, type ResearchModule } from "../../src/research/index.js";
import { sha256Digest } from "../../src/research/research-record/canonical-json.js";
import { openFileJsonArtifactStore } from "../../src/research/research-record/index.js";

const fixturesDirectory = fileURLToPath(
  new URL("../fixtures/research/legacy-campaign/", import.meta.url),
);

// Public golden views retain their original shape, without being rewritten
// through today's domain schemas when the compatibility test loads them.
const fixtureSchema = z.object({
  provenance: z.object({
    kind: z.literal("synthetic-legacy-research-fixture"),
    sourceTest: z.enum([
      "tests/research/campaign-run.test.ts",
      "tests/research/campaign-semantic-run.test.ts",
      "tests/research/campaign-semantic-e2e.test.ts",
    ]),
    sourceTestSha256: z.string().regex(/^[a-f0-9]{64}$/),
    baselineCommit: z.literal("9bc1ee605f585f25faade34b263303718ac17d0a"),
  }),
  databaseSha256: z.string().regex(/^[a-f0-9]{64}$/),
  campaignId: z.string(),
  runId: z.string(),
  publicViews: z.object({
    campaign: z.unknown(),
    preparation: z.unknown(),
    progress: z.unknown(),
    run: z.unknown(),
    findingGroups: z.unknown(),
  }),
});

async function storageSnapshot(directory: string) {
  const database = await Promise.all(
    ["", "-wal"].map(async (suffix) => {
      try {
        return await readFile(join(directory, `research.sqlite${suffix}`));
      } catch (error) {
        if (
          error instanceof Error &&
          "code" in error &&
          error.code === "ENOENT"
        ) {
          return null;
        }
        throw error;
      }
    }),
  );
  const objectNames = (await readdir(join(directory, "objects"))).sort();
  const objects = await Promise.all(
    objectNames.map(async (name) => ({
      name,
      content: await readFile(join(directory, "objects", name)),
    })),
  );
  return { database, objects };
}

describe("Legacy Research immutable replay", () => {
  it.each([
    ["await-calibration", "await-calibration", 1, 0, 1],
    ["boundary-complete", "stop-boundary-pair-complete", 1, 0, 1],
    ["gvisor-blocked", "blocked-capability", 0, 1, 1],
    ["provider-failed", "blocked-capability", 0, 0, 1],
    ["unresolved-work", "continue-unresolved-work", 0, 0, 1],
    ["interrupted", null, 0, 0, 1],
    ["semantic-wave", "finder-wave-completed", 0, 0, 2],
    ["semantic-evaluated", "incomplete", 1, 0, 2],
  ] as const)(
    "reads %s through CampaignReader without executing legacy writers",
    async (
      scenario,
      decision,
      findingCount,
      blockedCount,
      runSchemaVersion,
    ) => {
      const source = join(fixturesDirectory, scenario);
      const fixture = fixtureSchema.parse(
        JSON.parse(await readFile(join(source, "expected.json"), "utf8")),
      );
      expect(
        createHash("sha256")
          .update(await readFile(join(source, "research.sqlite")))
          .digest("hex"),
      ).toBe(fixture.databaseSha256);

      const directory = await mkdtemp(
        join(tmpdir(), "legacy-research-replay-"),
      );
      const opened: ResearchModule[] = [];
      try {
        await cp(source, directory, { recursive: true });
        const artifacts = openFileJsonArtifactStore(join(directory, "objects"));
        for (const name of await readdir(join(directory, "objects"))) {
          const value: unknown = JSON.parse(
            await readFile(join(directory, "objects", name), "utf8"),
          );
          expect(name).toBe(`${sha256Digest(value).slice(7)}.json`);
        }
        const openReader = () => {
          const research = openResearch({
            databasePath: join(directory, "research.sqlite"),
            artifactStore: {
              readJson: (digest) => artifacts.readJson(digest),
              putJson: async () => {
                throw new Error("Replay must not write an artifact");
              },
            },
            clock: () => {
              throw new Error("Replay must not append an event");
            },
          });
          opened.push(research);
          return research.reader;
        };
        const reader = openReader();
        const reopened = openReader();
        // Constructor migrations are separate from the public read behavior.
        // Compare the actual copy after all connections have opened; SHM is a lock file.
        const beforeReads = await storageSnapshot(directory);
        expect(await reader.read(fixture.campaignId)).toEqual(
          fixture.publicViews.campaign,
        );
        expect(
          await reader.inspect(fixture.campaignId, { kind: "preparation" }),
        ).toEqual(fixture.publicViews.preparation);
        const progress = await reader.inspect(fixture.campaignId, {
          kind: "progress",
        });
        expect(progress).toEqual(fixture.publicViews.progress);
        expect(progress).toMatchObject({
          schemaVersion: 1,
          status: decision === null ? "running" : "completed",
          counts: {
            runs: { started: 1, completed: decision === null ? 0 : 1 },
            verifications: { finding: findingCount, blocked: blockedCount },
          },
        });
        if (decision === null) {
          expect(progress).toMatchObject({
            counts: { attempts: { started: 2, completed: 0, active: 2 } },
          });
          await expect(
            reader.inspect(fixture.campaignId, {
              kind: "run",
              runId: fixture.runId,
            }),
          ).rejects.toThrow("Campaign run not found");
        } else {
          const run = await reader.inspect(fixture.campaignId, {
            kind: "run",
            runId: fixture.runId,
          });
          expect(run).toEqual(fixture.publicViews.run);
          expect(run).toMatchObject({
            value: {
              schemaVersion: runSchemaVersion,
              decision: { kind: decision },
            },
          });
          expect(
            await reader.inspect(fixture.campaignId, {
              kind: "finding-mechanism-groups",
              runId: fixture.runId,
            }),
          ).toEqual(fixture.publicViews.findingGroups);
          expect(
            await reopened.inspect(fixture.campaignId, {
              kind: "run",
              runId: fixture.runId,
            }),
          ).toEqual(run);
        }
        expect(
          await reopened.inspect(fixture.campaignId, { kind: "progress" }),
        ).toEqual(progress);
        await expect(reader.read("unknown-campaign")).rejects.toThrow(
          "Campaign not found",
        );
        expect(await storageSnapshot(directory)).toEqual(beforeReads);
      } finally {
        for (const research of opened) research.close();
        await rm(directory, { recursive: true, force: true });
      }
    },
  );
});
