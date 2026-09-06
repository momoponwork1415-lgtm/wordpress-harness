import { createHash } from "node:crypto";
import { cp, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";
import { z } from "zod";

import { openAIReproduction as openCurrentAIReproduction } from "../../src/human-os/index.js";
import { humanOsDigest } from "../../src/human-os/canonical-json.js";
import { openLegacyPacketAIReproductionReader } from "../../src/human-os/legacy-packet-ai-reproduction-reader.js";
import {
  openFileHumanOsArtifactStore,
  openSqliteHumanOsRecord,
  type HumanOsRecord,
} from "../../src/human-os/human-os-record/index.js";

const fixturesDirectory = fileURLToPath(
  new URL("../fixtures/human-os/legacy-packet-ai/", import.meta.url),
);

const digestSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const fixtureSchema = z.strictObject({
  provenance: z.strictObject({
    synthetic: z.literal(true),
    derivedTest: z.literal(
      "tests/human-os/ai-reproduction.test.ts Legacy Packet AI Reproduction",
    ),
    baselineCommit: z.literal("9bc1ee605f585f25faade34b263303718ac17d0a"),
  }),
  databaseSha256: z.string().regex(/^[a-f0-9]{64}$/),
  expected: z.strictObject({
    attemptId: digestSchema,
    resultDigest: digestSchema,
    status: z.enum([
      "runtime-confirmed",
      "runtime-inconclusive",
      "setup-blocked",
      "execution-failed",
    ]),
    reason: z.string().nullable(),
    hasTriagePacket: z.boolean(),
    findingId: digestSchema,
  }),
});

async function readStorageBytes(directory: string) {
  return Promise.all(
    ["", "-wal"].map(async (suffix) => {
      try {
        return await readFile(join(directory, `human-os.sqlite${suffix}`));
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
}

describe("Legacy Packet AI immutable replay", () => {
  it.each([
    ["confirmed", "runtime-confirmed", null, true],
    [
      "runtime-inconclusive",
      "runtime-inconclusive",
      "unsupported-mechanism",
      false,
    ],
    ["setup-blocked", "setup-blocked", "isolation-unavailable", false],
    ["provider-failed", "execution-failed", "provider-failed", false],
    ["budget-exhausted", "execution-failed", "budget-exhausted", false],
  ] as const)(
    "reads %s without a writer or execution dependency",
    async (scenario, status, reason, hasTriagePacket) => {
      const source = join(fixturesDirectory, scenario);
      const fixture = fixtureSchema.parse(
        JSON.parse(await readFile(join(source, "expected.json"), "utf8")),
      );
      expect(fixture.expected).toMatchObject({
        status,
        reason,
        hasTriagePacket,
      });
      const databaseBytes = await readFile(join(source, "human-os.sqlite"));
      expect(createHash("sha256").update(databaseBytes).digest("hex")).toBe(
        fixture.databaseSha256,
      );

      const objectDirectory = join(source, "objects");
      const objectNames = await readdir(objectDirectory);
      const publicObjects = await Promise.all(
        objectNames.map(async (name) => {
          const value: unknown = JSON.parse(
            await readFile(join(objectDirectory, name), "utf8"),
          );
          expect(name).toBe(`${humanOsDigest(value).slice(7)}.json`);
          return value;
        }),
      );
      const publicText = JSON.stringify(publicObjects);
      expect(publicText).not.toContain('"rawHttpRequests"');
      expect(publicText).not.toContain('"exactPayloads"');
      expect(publicText).not.toContain('"kind":"reproduction-recipe"');
      expect(publicText).not.toContain('"kind":"private-evidence-bundle"');
      expect(objectNames.every((name) => name.endsWith(".json"))).toBe(true);

      const directory = await mkdtemp(join(tmpdir(), "legacy-packet-ai-"));
      const records: HumanOsRecord[] = [];
      try {
        await cp(source, directory, { recursive: true });
        const artifacts = openFileHumanOsArtifactStore(
          join(directory, "objects"),
        );
        const openReader = () => {
          const record = openSqliteHumanOsRecord({
            databasePath: join(directory, "human-os.sqlite"),
            artifactStore: {
              readJson: (digest) => artifacts.readJson(digest),
              putJson: async () => {
                throw new Error("Replay must not write an artifact");
              },
            },
            clock: () => {
              throw new Error("Replay must not create an event");
            },
          });
          records.push(record);
          return {
            reader: openLegacyPacketAIReproductionReader({
              record: {
                readAIReproductionResult: (attemptId) =>
                  record.readAIReproductionResult(attemptId),
              },
            }),
            record,
          };
        };
        const first = openReader();
        const reopened = openReader();
        const beforeReads = await readStorageBytes(directory);

        const result = await first.reader.read(fixture.expected.attemptId);
        expect(result).toBeDefined();
        expect(humanOsDigest(result)).toBe(fixture.expected.resultDigest);
        expect(result).toMatchObject({
          kind: "ai-reproduction-result",
          schemaVersion: 2,
          status,
        });
        if (result?.status === "runtime-confirmed") {
          expect(result.triagePacket).not.toBeNull();
          expect(hasTriagePacket).toBe(true);
        } else {
          expect(result).toMatchObject({ reason, triagePacket: null });
          expect(hasTriagePacket).toBe(false);
          expect(JSON.stringify(result)).not.toContain("rejected");
        }
        expect(await reopened.reader.read(fixture.expected.attemptId)).toEqual(
          result,
        );
        expect(
          await first.reader.read(`sha256:${"0".repeat(64)}`),
        ).toBeUndefined();
        const forbiddenExecution = async (): Promise<never> => {
          throw new Error(
            "Read-only replay must not use execution dependencies",
          );
        };
        const current = openCurrentAIReproduction({
          record: first.record,
          privateArtifactStore: {
            putPrivateJson: forbiddenExecution,
            readPrivateJson: forbiddenExecution,
            putPrivateBytes: forbiddenExecution,
            readPrivateBytes: forbiddenExecution,
          },
          harness: { run: forbiddenExecution },
          clock: () => {
            throw new Error("Read-only replay must not use the clock");
          },
        });
        expect(await current.read(fixture.expected.findingId)).toBeUndefined();
        expect(
          await first.record.readFindingAIReproductionByAttempt(
            fixture.expected.attemptId,
          ),
        ).toBeUndefined();
        expect(
          await first.record.listFindingAIReproduction(
            fixture.expected.findingId,
          ),
        ).toEqual([]);
        expect(await readStorageBytes(directory)).toEqual(beforeReads);
      } finally {
        for (const record of records) record.close();
        await rm(directory, { recursive: true, force: true });
      }
    },
  );
});
