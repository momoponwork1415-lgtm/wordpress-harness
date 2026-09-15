import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  openTargetResearchHistories,
  type BuildLegacyResearchHistoryRequest,
} from "../../src/target-intelligence/research-history/index.js";

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
  const storageDirectory = join(directory, "history");
  const auditLedgerPath = join(directory, "audit-ledger.json");
  const wp2shellLabsRoot = join(directory, "wp2shell-labs");
  await mkdir(wp2shellLabsRoot, { recursive: true });
  await writeFile(
    auditLedgerPath,
    JSON.stringify({
      schema_version: "wordpress-plugin-audit-ledger/v1",
      generated_at: "2026-08-31T12:33:58Z",
      plugins: [
        {
          slug: "learning-suite-a-fixture",
          attempts: [
            {
              closure: "forbidden exploration outcome",
              result_sha256:
                "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
              source_tree_sha256:
                "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
              status: "forbidden exploration status",
              version: "4.0.7",
            },
            {
              closure: "another forbidden outcome",
              result_sha256:
                "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
              source_tree_sha256:
                "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
              status: "another forbidden status",
              version: "4.0.7",
            },
          ],
        },
        {
          slug: "learning-suite-b-fixture",
          attempts: [
            {
              result_sha256:
                "dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
              source_tree_sha256:
                "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
              version: "4.4.5",
            },
          ],
        },
      ],
    }),
  );

  const wp2shellLab = join(
    wp2shellLabsRoot,
    "mail-delivery-fixture-4.9.0-codex",
  );
  await mkdir(wp2shellLab);
  await writeFile(
    join(wp2shellLab, "SOURCE_PROVENANCE.txt"),
    [
      "Target: Mail Delivery Fixture",
      "Slug: mail-delivery-fixture",
      "Version: 4.9.0",
      "Source: official WordPress.org release ZIP",
      "ZIP SHA-256: 1111111111111111111111111111111111111111111111111111111111111111",
      "Do not import this old harness method or prompt.",
    ].join("\n"),
  );

  return {
    directory,
    storageDirectory,
    auditLedgerPath,
    wp2shellLabsRoot,
  };
}

function request(
  source: Awaited<ReturnType<typeof fixture>>,
): BuildLegacyResearchHistoryRequest {
  return {
    kind: "build-legacy-research-history",
    schemaVersion: 1,
    snapshotId: "legacy-target-history-2026-09-08",
    sources: {
      whitebox: {
        auditLedgerPath: source.auditLedgerPath,
      },
      wordfence: {
        wp2shellLabsRoot: source.wp2shellLabsRoot,
      },
    },
  };
}

describe("Target Research History", () => {
  it("stores target/source history without exploration or submission results", async () => {
    const source = await fixture();
    const histories = openTargetResearchHistories({
      storageDirectory: source.storageDirectory,
      clock: () => new Date("2026-09-08T12:00:00.000Z"),
    });

    const ref = await histories.buildFromLegacyData(request(source));

    expect(ref.historyEntries).toBe(3);
    const learningSuiteA = await histories.inspect({
      snapshotId: ref.id,
      pluginIdentity: "wporg:learning-suite-a-fixture",
      version: "4.0.7",
    });
    expect(learningSuiteA.sameVersion).toEqual({ observed: true });

    const learningSuiteB = await histories.inspect({
      snapshotId: ref.id,
      pluginIdentity: "wporg:learning-suite-b-fixture",
      version: "4.4.6",
    });
    expect(learningSuiteB.sameVersion).toEqual({ observed: false });
    expect(learningSuiteB.priorVersions).toEqual(["4.4.5"]);

    const mailDelivery = await histories.inspect({
      snapshotId: ref.id,
      pluginIdentity: "wporg:mail-delivery-fixture",
      version: "4.9.0",
    });
    expect(mailDelivery.sameVersion).toEqual({ observed: true });

    const serialized = await readFile(
      join(source.storageDirectory, `${ref.id}.json`),
      "utf8",
    );
    expect(serialized).not.toContain("result_sha256");
    expect(serialized).not.toContain("exploration outcome");
    expect(serialized).not.toContain("exploration status");
    expect(serialized).not.toContain("legacyFindings");
    expect(serialized).not.toContain("submissions");
    expect(serialized).not.toContain("outcomes");
    expect(serialized).not.toContain("coverage");
    expect(serialized).not.toContain("sourceIdentity");
    expect(serialized).not.toContain("contentDigest");
    expect(serialized).not.toContain("old harness method");
  });

  it("distinguishes an unseen target from unavailable history", async () => {
    const source = await fixture();
    const histories = openTargetResearchHistories({
      storageDirectory: source.storageDirectory,
    });
    const ref = await histories.buildFromLegacyData(request(source));

    const communitySuite = await histories.inspect({
      snapshotId: ref.id,
      pluginIdentity: "wporg:community-suite-fixture",
      version: "6.0.0.2",
    });
    expect(communitySuite.sameVersion).toEqual({ observed: false });
    expect(communitySuite.priorVersions).toEqual([]);
    await expect(
      histories.inspect({
        snapshotId: "missing-snapshot",
        pluginIdentity: "wporg:community-suite-fixture",
        version: "6.0.0.2",
      }),
    ).rejects.toThrow("Target Research History Snapshot not found");
  });

  it("fails closed on malformed legacy identity data", async () => {
    const source = await fixture();
    const ledger = JSON.parse(
      await readFile(source.auditLedgerPath, "utf8"),
    ) as { plugins: Array<{ slug: string }> };
    ledger.plugins[0]!.slug = "../../escape";
    await writeFile(source.auditLedgerPath, JSON.stringify(ledger));
    const histories = openTargetResearchHistories({
      storageDirectory: source.storageDirectory,
    });

    await expect(
      histories.buildFromLegacyData(request(source)),
    ).rejects.toThrow();
    await expect(
      readFile(
        join(source.storageDirectory, "legacy-target-history-2026-09-08.json"),
        "utf8",
      ),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });
});
