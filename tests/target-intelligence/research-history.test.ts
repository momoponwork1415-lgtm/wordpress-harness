import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { canonicalDigest } from "../../src/infrastructure/canonical-json.js";
import { openTargetResearchHistories } from "../../src/target-intelligence/research-history/index.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "target-research-history-"));
  temporaryDirectories.push(directory);
  const body = {
    kind: "target-research-history-snapshot",
    schemaVersion: 1,
    id: "fixture-history",
    generatedAt: "2026-09-08T12:00:00.000Z",
    historyEntries: [
      { pluginIdentity: "wporg:learning-suite-a-fixture", version: "4.0.7" },
      { pluginIdentity: "wporg:learning-suite-b-fixture", version: "4.4.5" },
      { pluginIdentity: "wporg:mail-delivery-fixture", version: "4.9.0" },
    ],
  };
  const snapshot = { ...body, digest: canonicalDigest(body) };
  const path = join(directory, `${body.id}.json`);
  const serialized = JSON.stringify(snapshot);
  await writeFile(path, serialized);
  return { directory, path, snapshot, serialized };
}

describe("Target Research History", () => {
  it("reads existing history without importing or rewriting its records", async () => {
    const source = await fixture();
    const histories = openTargetResearchHistories({
      storageDirectory: source.directory,
    });
    const learningSuiteA = await histories.inspect({
      snapshotId: source.snapshot.id,
      pluginIdentity: "wporg:learning-suite-a-fixture",
      version: "4.0.7",
    });
    expect(learningSuiteA.snapshotRef).toMatchObject({
      id: source.snapshot.id,
      digest: source.snapshot.digest,
      historyEntries: 3,
    });
    expect(learningSuiteA.sameVersion).toEqual({ observed: true });
    expect(learningSuiteA.priorVersions).toEqual([]);
    const learningSuiteB = await histories.inspect({
      snapshotId: source.snapshot.id,
      pluginIdentity: "wporg:learning-suite-b-fixture",
      version: "4.4.6",
    });
    expect(learningSuiteB.sameVersion).toEqual({ observed: false });
    expect(learningSuiteB.priorVersions).toEqual(["4.4.5"]);
    await expect(readFile(source.path, "utf8")).resolves.toBe(
      source.serialized,
    );
  });

  it("distinguishes an unseen target from unavailable history", async () => {
    const source = await fixture();
    const histories = openTargetResearchHistories({
      storageDirectory: source.directory,
    });
    const unseen = await histories.inspect({
      snapshotId: source.snapshot.id,
      pluginIdentity: "wporg:community-suite-fixture",
      version: "6.0.0.2",
    });
    expect(unseen.sameVersion).toEqual({ observed: false });
    expect(unseen.priorVersions).toEqual([]);
    await expect(
      histories.inspect({
        snapshotId: "missing-snapshot",
        pluginIdentity: "wporg:community-suite-fixture",
        version: "6.0.0.2",
      }),
    ).rejects.toThrow("Target Research History Snapshot not found");
  });

  it.each(["digest", "schema", "unexpected-field"])(
    "rejects %s corruption without treating the history as empty or repairing it",
    async (corruption) => {
      const source = await fixture();
      const { digest, ...body } = source.snapshot;
      const corruptedBody = {
        ...body,
        ...(corruption === "schema" ? { schemaVersion: 2 } : {}),
        ...(corruption === "unexpected-field"
          ? { claim: "fixture claim" }
          : {}),
      };
      const bytes = JSON.stringify({
        ...corruptedBody,
        digest:
          corruption === "digest"
            ? `sha256:${"0".repeat(64)}`
            : canonicalDigest(corruptedBody),
      });
      await writeFile(source.path, bytes);
      const histories = openTargetResearchHistories({
        storageDirectory: source.directory,
      });
      await expect(
        histories.inspect({
          snapshotId: source.snapshot.id,
          pluginIdentity: "wporg:learning-suite-a-fixture",
          version: "4.0.7",
        }),
      ).rejects.toThrow();
      await expect(readFile(source.path, "utf8")).resolves.toBe(bytes);
    },
  );
});
