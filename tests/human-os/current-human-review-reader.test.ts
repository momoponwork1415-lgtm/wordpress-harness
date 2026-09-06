import { createHash } from "node:crypto";
import { cp, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  currentHumanReviewPolicySchema,
  defineCurrentHumanReviewPolicy,
  openCurrentHumanReviewReader,
} from "../../src/human-os/index.js";
import {
  openFileHumanOsArtifactStore,
  openSqliteHumanOsRecord,
  type HumanOsRecord,
} from "../../src/human-os/human-os-record/index.js";

const fixtureRoot = fileURLToPath(
  new URL("../fixtures/human-os/current-human-review/", import.meta.url),
);
const fixtureSchema = z.object({
  databaseSha256: z.string().regex(/^[a-f0-9]{64}$/),
  policy: currentHumanReviewPolicySchema,
  // Keep the old public projection intact instead of parsing away legacy fields.
  expectedQueue: z
    .object({
      campaignId: z.string(),
      active: z.array(z.unknown()),
      deferred: z.array(z.unknown()),
      escalation: z.array(z.unknown()),
      completed: z.array(z.unknown()),
    })
    .passthrough(),
});

describe("Current Human Review read-only Interface", () => {
  it.each(["promoted", "escalation"] as const)(
    "replays the immutable %s history without execution dependencies",
    async (scenario) => {
      const source = join(fixtureRoot, scenario);
      const fixture = fixtureSchema.parse(
        JSON.parse(await readFile(join(source, "expected.json"), "utf8")),
      );
      const bytes = await readFile(join(source, "human-os.sqlite"));
      expect(createHash("sha256").update(bytes).digest("hex")).toBe(
        fixture.databaseSha256,
      );
      const directory = await mkdtemp(join(tmpdir(), "human-review-reader-"));
      const records: HumanOsRecord[] = [];
      try {
        await cp(source, directory, { recursive: true });
        const artifacts = openFileHumanOsArtifactStore(
          join(directory, "objects"),
        );
        const openReader = (policy = fixture.policy) => {
          const record = openSqliteHumanOsRecord({
            databasePath: join(directory, "human-os.sqlite"),
            artifactStore: {
              readJson: (digest) => artifacts.readJson(digest),
              putJson: async () => {
                throw new Error("Reader must not write artifacts");
              },
            },
            clock: () => {
              throw new Error("Reader must not create events");
            },
          });
          records.push(record);
          // The Interface receives only read capabilities, even at runtime.
          return openCurrentHumanReviewReader({
            policy,
            store: {
              readCurrentHumanReviewCase: (id) =>
                record.readCurrentHumanReviewCase(id),
              listCurrentHumanReviewCases: (id) =>
                record.listCurrentHumanReviewCases(id),
              listCurrentHumanReviewSchedule: (id) =>
                record.listCurrentHumanReviewSchedule(id),
              listHumanReproductionPreparations: (id) =>
                record.listHumanReproductionPreparations(id),
              listCurrentHumanReviewResults: (id) =>
                record.listCurrentHumanReviewResults(id),
            },
          });
        };
        const { digest: _digest, ...policyIdentity } = fixture.policy;
        const foreignPolicy = defineCurrentHumanReviewPolicy({
          ...policyIdentity,
          activeConcurrency: fixture.policy.activeConcurrency + 1,
        });
        const reader = openReader();
        const reopened = openReader();
        const foreignReader = openReader(foreignPolicy);
        // Ignore shared-memory lock bytes; compare the actual database and WAL
        // after all connections have opened and before any public reads.
        const snapshot = () =>
          Promise.all(
            ["", "-wal"].map(async (suffix) => {
              try {
                return await readFile(
                  join(directory, `human-os.sqlite${suffix}`),
                );
              } catch (error) {
                if (
                  error instanceof Error &&
                  "code" in error &&
                  error.code === "ENOENT"
                )
                  return null;
                throw error;
              }
            }),
          );
        const beforeReads = await snapshot();
        const queue = await reader.readQueue(fixture.expectedQueue.campaignId);
        expect(queue).toEqual(fixture.expectedQueue);
        for (const lane of [
          "active",
          "deferred",
          "escalation",
          "completed",
        ] as const) {
          for (const view of queue[lane]) {
            expect(await reader.readCase(view.reviewCase.id)).toEqual(view);
          }
        }
        if (scenario === "promoted") {
          expect(queue.active).toHaveLength(1);
          expect(queue.deferred).toHaveLength(1);
          expect(queue.completed[0]?.result?.result.finding).toMatchObject({
            schemaVersion: 2,
            externalAction: { status: "not-authorized" },
          });
        } else {
          expect(queue.escalation).toHaveLength(1);
          expect(queue.escalation[0]?.escalationSelected).toBe(true);
          expect(queue.active).toEqual([]);
        }
        expect(await reopened.readQueue(queue.campaignId)).toEqual(queue);
        expect(
          await reader.readCase(`sha256:${"0".repeat(64)}`),
        ).toBeUndefined();
        expect(await reader.readQueue("unknown-campaign")).toEqual({
          campaignId: "unknown-campaign",
          active: [],
          deferred: [],
          escalation: [],
          completed: [],
        });
        await expect(foreignReader.readQueue(queue.campaignId)).rejects.toThrow(
          "Human Review Case belongs to another Queue Policy",
        );
        expect(await snapshot()).toEqual(beforeReads);
      } finally {
        for (const record of records) record.close();
        await rm(directory, { recursive: true, force: true });
      }
    },
  );
});
