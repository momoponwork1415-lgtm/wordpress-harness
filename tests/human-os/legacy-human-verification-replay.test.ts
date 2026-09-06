import { createHash } from "node:crypto";
import { cp, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";
import { z } from "zod";

import { openLegacyHumanVerificationReplay } from "../../src/human-os/index.js";
import {
  openFileHumanOsArtifactStore,
  openSqliteHumanOsRecord,
  type HumanOsRecord,
} from "../../src/human-os/human-os-record/index.js";

const fixturesDirectory = fileURLToPath(
  new URL("../fixtures/human-os/legacy-human-verification/", import.meta.url),
);

// These saved public projections are intentionally not parsed with today's
// domain schema: replay must preserve the original fields and meanings.
const fixtureSchema = z.object({
  databaseSha256: z.string().regex(/^[a-f0-9]{64}$/),
  expectedQueue: z
    .object({
      campaignId: z.string(),
      active: z.array(z.unknown()),
      humanDeferred: z.array(z.unknown()),
    })
    .passthrough(),
});

describe("Legacy Human Verification immutable replay", () => {
  it.each([
    ["queue", 4, 1, []],
    ["verified-finding", 1, 0, ["verified-finding"]],
    [
      "more-evidence-required-rejected",
      2,
      0,
      ["more-evidence-required", "rejected"],
    ],
    ["blocked", 1, 0, ["blocked"]],
  ] as const)(
    "reads %s without regenerating legacy records",
    async (scenario, activeCount, deferredCount, dispositions) => {
      const source = join(fixturesDirectory, scenario);
      const fixture = fixtureSchema.parse(
        JSON.parse(await readFile(join(source, "expected.json"), "utf8")),
      );
      const databaseBytes = await readFile(join(source, "human-os.sqlite"));
      expect(createHash("sha256").update(databaseBytes).digest("hex")).toBe(
        fixture.databaseSha256,
      );

      // The store may migrate its private SQLite schema on open. Always use a
      // disposable copy, while the checked-in history remains unchanged.
      const directory = await mkdtemp(join(tmpdir(), "legacy-human-replay-"));
      const records: HumanOsRecord[] = [];
      try {
        await cp(source, directory, { recursive: true });
        const artifactStore = openFileHumanOsArtifactStore(
          join(directory, "objects"),
        );
        const openReplay = () => {
          const record = openSqliteHumanOsRecord({
            databasePath: join(directory, "human-os.sqlite"),
            artifactStore: {
              readJson: (digest) => artifactStore.readJson(digest),
              putJson: async () => {
                throw new Error("Replay must not write an artifact");
              },
            },
            clock: () => {
              throw new Error("Replay must not create a new event");
            },
          });
          records.push(record);
          return openLegacyHumanVerificationReplay({ record });
        };

        const reader = openReplay();
        const reopened = openReplay();
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
        expect(queue.active).toHaveLength(activeCount);
        expect(queue.humanDeferred).toHaveLength(deferredCount);
        expect(
          queue.active.flatMap((item) =>
            item.verifications.map(
              (event) => event.result.verification.disposition.status,
            ),
          ),
        ).toEqual(dispositions);

        for (const view of [...queue.active, ...queue.humanDeferred]) {
          expect(await reader.readCase(view.reviewCase.id)).toEqual(view);
          for (const event of view.verifications) {
            if (event.result.finding !== null) {
              expect(event.result.finding).toMatchObject({
                kind: "finding",
                schemaVersion: 1,
                externalAction: { status: "not-authorized" },
              });
            } else {
              expect(event.result.verification.disposition.status).not.toBe(
                "verified-finding",
              );
            }
          }
        }
        expect(await reopened.readQueue(queue.campaignId)).toEqual(queue);
        expect(
          await reader.readCase(`sha256:${"0".repeat(64)}`),
        ).toBeUndefined();
        expect(await reader.readQueue("unknown-campaign")).toEqual({
          campaignId: "unknown-campaign",
          active: [],
          humanDeferred: [],
        });
        expect(await snapshot()).toEqual(beforeReads);
      } finally {
        for (const record of records) record.close();
        await rm(directory, { recursive: true, force: true });
      }
    },
  );
});
