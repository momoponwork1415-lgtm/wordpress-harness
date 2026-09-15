import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  WordPressOrgChangesetSourceError,
  createSvnWordPressOrgChangesetSource,
  defineWordPressOrgUpdateFrontierPolicy,
  openWordPressOrgUpdateFrontiers,
  type WordPressOrgChangesetSource,
} from "../../src/target-intelligence/update-frontier/index.js";
import type {
  WordPressOrgObservationResult,
  WordPressOrgTargetSource,
} from "../../src/target-intelligence/acquisition/index.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

function log(entries: readonly string[]): Uint8Array {
  return Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<log>
${entries.join("\n")}
</log>`);
}

function logEntry(input: {
  readonly revision: number;
  readonly date: string;
  readonly paths: readonly string[];
}): string {
  return `<logentry revision="${input.revision}">
<author>research-fixture</author>
<date>${input.date}</date>
<paths>
${input.paths
  .map(
    (path) =>
      `<path action="M" prop-mods="false" text-mods="true" kind="file">${path}</path>`,
  )
  .join("\n")}
</paths>
<msg>Prospective update</msg>
</logentry>`;
}

function observed(
  slug: string,
  activeInstallations: number,
): WordPressOrgObservationResult {
  const digestCharacter = slug === "metadata-fails" ? "f" : "a";
  return {
    status: "observed",
    observation: {
      kind: "wordpress-org-target-observation",
      schemaVersion: 1,
      pluginIdentity: `wporg:${slug}`,
      officialSlug: slug,
      displayName: slug,
      stableVersion: "2.4.1",
      activeInstallations,
      lastUpdated: "2026-09-14T09:00:00Z",
      observedAt: "2026-09-14T10:00:00.000Z",
      intelligenceSource: {
        kind: "wordpress-org-plugin-directory",
        sourceUrl: `https://api.wordpress.org/plugins/info/1.2/?slug=${slug}`,
        retrievedAt: "2026-09-14T10:00:00.000Z",
        contentDigest: `sha256:${digestCharacter.repeat(64)}`,
        parserVersion: "wordpress-org-plugin-information-v1",
      },
      downloadProvenance: {
        sourceUrl: `https://downloads.wordpress.org/plugin/${slug}.2.4.1.zip`,
      },
    },
    observationRef: {
      kind: "wordpress-org-target-observation-ref",
      schemaVersion: 1,
      id: `wporg-observation:${slug}`,
      digest: `sha256:${digestCharacter.repeat(64)}`,
    },
  };
}

function targetSource(
  observations: Readonly<Record<string, WordPressOrgObservationResult>>,
): WordPressOrgTargetSource {
  return {
    observe: async (request) => {
      const result = observations[request.slug];
      if (result === undefined) {
        throw new Error(`Missing observation fixture: ${request.slug}`);
      }
      return result;
    },
    acquire: async () => {
      throw new Error(
        "Update Frontier must not acquire or execute Target source",
      );
    },
  };
}

const policy = defineWordPressOrgUpdateFrontierPolicy({
  id: "wporg-update-frontier-v1",
  minimumActiveInstallations: 5_000,
  maximumRevisions: 10,
  maximumLogBytes: 100_000,
  maximumDiffBytes: 100_000,
});

describe("WordPressOrgUpdateFrontiers", () => {
  it("turns every qualifying trunk PHP change into an oracle-free lead while annotations remain non-gating", async () => {
    const directory = await mkdtemp(join(tmpdir(), "wporg-update-frontier-"));
    temporaryDirectories.push(directory);
    const requests: unknown[] = [];
    const source: WordPressOrgChangesetSource = {
      retrieve: async (request) => {
        requests.push(request);
        if (request.kind === "log") {
          return {
            repositoryUrl: "https://plugins.svn.wordpress.org",
            bytes: log([
              logEntry({
                revision: 5001,
                date: "2026-09-14T09:01:00.000000Z",
                paths: [
                  "/semantic-change/trunk/includes/private-route.php",
                  "/semantic-change/tags/2.4.1/includes/private-route.php",
                  "/semantic-change/trunk/assets/admin.js",
                ],
              }),
              logEntry({
                revision: 5002,
                date: "2026-09-14T09:02:00.000000Z",
                paths: ["/benign-change/trunk/formatting.php"],
              }),
              logEntry({
                revision: 5003,
                date: "2026-09-14T09:03:00.000000Z",
                paths: ["/small-plugin/trunk/feature.php"],
              }),
              logEntry({
                revision: 5004,
                date: "2026-09-14T09:04:00.000000Z",
                paths: ["/asset-only/trunk/admin.js"],
              }),
            ]),
          };
        }
        const diffs: Readonly<Record<string, string>> = {
          "semantic-change": `Index: includes/private-route.php
===================================================================
--- includes/private-route.php (revision 5000)
+++ includes/private-route.php (revision 5001)
@@ -1,2 +1,5 @@
+$value = $_POST['private_value'];
+if ( current_user_can('manage_options') ) {
+    file_put_contents($path, $value);
+}
`,
          "benign-change": `Index: formatting.php
===================================================================
--- formatting.php (revision 5001)
+++ formatting.php (revision 5002)
@@ -1 +1,2 @@
+$label = trim($label);
`,
          "small-plugin": `Index: feature.php
===================================================================
--- feature.php (revision 5002)
+++ feature.php (revision 5003)
@@ -1 +1,2 @@
+echo 'small';
`,
        };
        return {
          repositoryUrl: "https://plugins.svn.wordpress.org",
          bytes: Buffer.from(diffs[request.pluginSlug] ?? ""),
        };
      },
    };
    const frontiers = openWordPressOrgUpdateFrontiers({
      storageDirectory: directory,
      changesetSource: source,
      targetSource: targetSource({
        "semantic-change": observed("semantic-change", 20_000),
        "benign-change": observed("benign-change", 8_000),
        "small-plugin": observed("small-plugin", 200),
      }),
      clock: () => new Date("2026-09-14T10:00:00.000Z"),
    });

    const refreshed = await frontiers.refresh({
      kind: "wordpress-org-update-frontier-refresh",
      schemaVersion: 1,
      frontierKey: "hourly-wordpress-org-updates",
      revision: 1,
      fromRevisionExclusive: 5_000,
      policy,
    });

    expect(refreshed).toMatchObject({ status: "current" });
    if (refreshed.status !== "current") {
      throw new Error("Expected a current Update Frontier");
    }
    const frontier = await frontiers.inspect(refreshed.frontierRef);
    expect(frontier).toMatchObject({
      cursor: { fromRevisionExclusive: 5_000, toRevisionInclusive: 5_004 },
      policy: { id: policy.id, digest: policy.digest },
      leads: [
        {
          pluginIdentity: "wporg:benign-change",
          activeInstallations: 8_000,
          changesets: [
            {
              revision: 5_002,
              changedPhpFiles: 1,
              addedPhpLines: 1,
              navigationSignals: [],
            },
          ],
        },
        {
          pluginIdentity: "wporg:semantic-change",
          activeInstallations: 20_000,
          changesets: [
            {
              revision: 5_001,
              changedPhpFiles: 1,
              addedPhpLines: 4,
              navigationSignals: [
                "authorization-boundary",
                "filesystem-effect",
                "request-input",
              ],
            },
          ],
        },
      ],
      unresolved: [],
      filtered: {
        belowMinimumActiveInstallations: 1,
        revisionsWithoutTrunkPhpChanges: 1,
      },
    });
    const serialized = JSON.stringify(frontier);
    expect(serialized).not.toContain("private-route.php");
    expect(serialized).not.toContain("private_value");
    expect(serialized).not.toContain("file_put_contents");
    expect(requests).toEqual([
      {
        kind: "log",
        fromRevisionExclusive: 5_000,
        maximumRevisions: 10,
        maximumBytes: 100_000,
      },
      {
        kind: "diff",
        revision: 5_001,
        pluginSlug: "semantic-change",
        maximumBytes: 100_000,
      },
      {
        kind: "diff",
        revision: 5_002,
        pluginSlug: "benign-change",
        maximumBytes: 100_000,
      },
    ]);
  });

  it("records metadata failures instead of silently dropping changed plugins", async () => {
    const directory = await mkdtemp(join(tmpdir(), "wporg-update-unresolved-"));
    temporaryDirectories.push(directory);
    const source: WordPressOrgChangesetSource = {
      retrieve: async (request) => ({
        repositoryUrl: "https://plugins.svn.wordpress.org",
        bytes:
          request.kind === "log"
            ? log([
                logEntry({
                  revision: 6001,
                  date: "2026-09-14T09:01:00.000000Z",
                  paths: ["/metadata-fails/trunk/route.php"],
                }),
              ])
            : Buffer.from(
                "Index: route.php\n--- route.php (revision 6000)\n+++ route.php (revision 6001)\n@@ -1 +1,2 @@\n+$value = trim($value);\n",
              ),
      }),
    };
    const frontiers = openWordPressOrgUpdateFrontiers({
      storageDirectory: directory,
      changesetSource: source,
      targetSource: targetSource({
        "metadata-fails": {
          status: "failed",
          operation: "observe",
          pluginIdentity: "wporg:metadata-fails",
          reason: "rate-limited",
        },
      }),
    });

    const result = await frontiers.refresh({
      kind: "wordpress-org-update-frontier-refresh",
      schemaVersion: 1,
      frontierKey: "unresolved-updates",
      revision: 1,
      fromRevisionExclusive: 6_000,
      policy,
    });
    if (result.status !== "current") {
      throw new Error("Expected unresolved observations to remain inspectable");
    }
    await expect(frontiers.inspect(result.frontierRef)).resolves.toMatchObject({
      leads: [],
      unresolved: [
        {
          pluginIdentity: "wporg:metadata-fails",
          revisions: [6_001],
          reason: "rate-limited",
        },
      ],
    });
  });

  it("persists a digest-bound frontier, replays identical input, and rejects revision reuse", async () => {
    const directory = await mkdtemp(join(tmpdir(), "wporg-update-replay-"));
    temporaryDirectories.push(directory);
    let retrievals = 0;
    const changesetSource: WordPressOrgChangesetSource = {
      retrieve: async (request) => {
        retrievals += 1;
        return {
          repositoryUrl: "https://plugins.svn.wordpress.org",
          bytes:
            request.kind === "log"
              ? log([
                  logEntry({
                    revision: 7001,
                    date: "2026-09-14T09:01:00.000000Z",
                    paths: ["/replay-plugin/trunk/replay.php"],
                  }),
                ])
              : Buffer.from(
                  "Index: replay.php\n--- replay.php (revision 7000)\n+++ replay.php (revision 7001)\n@@ -1 +1,2 @@\n+$value = trim($value);\n",
                ),
        };
      },
    };
    const options = {
      storageDirectory: directory,
      changesetSource,
      targetSource: targetSource({
        "replay-plugin": observed("replay-plugin", 9_000),
      }),
      clock: () => new Date("2026-09-14T10:00:00.000Z"),
    };
    const request = {
      kind: "wordpress-org-update-frontier-refresh" as const,
      schemaVersion: 1 as const,
      frontierKey: "replay-updates",
      revision: 1,
      fromRevisionExclusive: 7_000,
      policy,
    };
    const first =
      await openWordPressOrgUpdateFrontiers(options).refresh(request);
    const second =
      await openWordPressOrgUpdateFrontiers(options).refresh(request);
    expect(second).toEqual(first);
    expect(retrievals).toBe(2);

    await expect(
      openWordPressOrgUpdateFrontiers(options).refresh({
        ...request,
        fromRevisionExclusive: 6_999,
      }),
    ).rejects.toThrow("Update Frontier revision input conflict");

    if (first.status !== "current") {
      throw new Error("Expected persisted frontier");
    }
    const artifactPath = join(
      directory,
      "wordpress-org-update-frontiers-v1",
      "replay-updates.revision-1.json",
    );
    const tampered = JSON.parse(await readFile(artifactPath, "utf8")) as {
      digest: string;
    };
    tampered.digest = `sha256:${"0".repeat(64)}`;
    await writeFile(artifactPath, JSON.stringify(tampered));
    await expect(
      openWordPressOrgUpdateFrontiers(options).inspect(first.frontierRef),
    ).rejects.toThrow("Update Frontier digest mismatch");
  });

  it.each([
    {
      name: "malformed log",
      source: {
        retrieve: async () => ({
          repositoryUrl: "https://plugins.svn.wordpress.org" as const,
          bytes: Buffer.from("not svn xml"),
        }),
      },
      reason: "invalid-log",
    },
    {
      name: "bounded source failure",
      source: {
        retrieve: async () => {
          throw new WordPressOrgChangesetSourceError("quota-exceeded", "log");
        },
      },
      reason: "source-quota-exceeded",
    },
    {
      name: "revision-mismatched diff",
      source: {
        retrieve: async (
          request: Parameters<WordPressOrgChangesetSource["retrieve"]>[0],
        ) => ({
          repositoryUrl: "https://plugins.svn.wordpress.org" as const,
          bytes:
            request.kind === "log"
              ? log([
                  logEntry({
                    revision: 8_001,
                    date: "2026-09-14T09:01:00.000000Z",
                    paths: ["/mismatched-diff/trunk/route.php"],
                  }),
                ])
              : Buffer.from(
                  "Index: route.php\n--- route.php (revision 7999)\n+++ route.php (revision 8000)\n@@ -1 +1,2 @@\n+$value = trim($value);\n",
                ),
        }),
      },
      reason: "invalid-diff",
      observations: {
        "mismatched-diff": observed("mismatched-diff", 9_000),
      },
    },
  ] as const)(
    "returns an explicit failure for $name",
    async ({ source, reason, ...fixture }) => {
      const directory = await mkdtemp(join(tmpdir(), "wporg-update-failure-"));
      temporaryDirectories.push(directory);
      const frontiers = openWordPressOrgUpdateFrontiers({
        storageDirectory: directory,
        changesetSource: source,
        targetSource: targetSource(
          "observations" in fixture ? fixture.observations : {},
        ),
      });

      await expect(
        frontiers.refresh({
          kind: "wordpress-org-update-frontier-refresh",
          schemaVersion: 1,
          frontierKey: "failed-updates",
          revision: 1,
          fromRevisionExclusive: 8_000,
          policy,
        }),
      ).resolves.toMatchObject({ status: "failed", reason });
    },
  );
});

describe("SvnWordPressOrgChangesetSource", () => {
  it("invokes the official read-only SVN interface with exact bounded arguments", async () => {
    const directory = await mkdtemp(join(tmpdir(), "svn-source-adapter-"));
    temporaryDirectories.push(directory);
    const executablePath = join(directory, "svn-fixture.sh");
    const argumentsPath = join(directory, "arguments.txt");
    await writeFile(
      executablePath,
      `#!/bin/sh
printf '%s\\n' "$@" >> '${argumentsPath}'
if [ "$1" = "info" ]; then
  printf '%s' '9025'
elif [ "$1" = "log" ]; then
  printf '%s' '<?xml version="1.0"?><log></log>'
else
  printf '%s' '@@ -1 +1,2 @@\\n+$value = trim($value);\\n'
fi
`,
    );
    await chmod(executablePath, 0o700);
    const source = createSvnWordPressOrgChangesetSource({
      svnExecutablePath: executablePath,
      timeoutMs: 5_000,
    });

    await source.retrieve({
      kind: "log",
      fromRevisionExclusive: 9_000,
      maximumRevisions: 25,
      maximumBytes: 20_000,
    });
    await expect(readFile(argumentsPath, "utf8")).resolves.toBe(
      [
        "info",
        "https://plugins.svn.wordpress.org",
        "--show-item",
        "revision",
        "--non-interactive",
        "log",
        "https://plugins.svn.wordpress.org",
        "--xml",
        "--verbose",
        "--limit",
        "25",
        "-r",
        "9001:9025",
        "--non-interactive",
        "",
      ].join("\n"),
    );

    await source.retrieve({
      kind: "diff",
      revision: 9_001,
      pluginSlug: "example-plugin",
      maximumBytes: 20_000,
    });
    await expect(readFile(argumentsPath, "utf8")).resolves.toBe(
      [
        "info",
        "https://plugins.svn.wordpress.org",
        "--show-item",
        "revision",
        "--non-interactive",
        "log",
        "https://plugins.svn.wordpress.org",
        "--xml",
        "--verbose",
        "--limit",
        "25",
        "-r",
        "9001:9025",
        "--non-interactive",
        "diff",
        "-c",
        "9001",
        "https://plugins.svn.wordpress.org/example-plugin/trunk",
        "--non-interactive",
        "",
      ].join("\n"),
    );

    const unchanged = await source.retrieve({
      kind: "log",
      fromRevisionExclusive: 9_025,
      maximumRevisions: 25,
      maximumBytes: 20_000,
    });
    expect(Buffer.from(unchanged.bytes).toString("utf8")).toContain(
      "<log>\n</log>",
    );

    await expect(
      source.retrieve({
        kind: "log",
        fromRevisionExclusive: 9_000,
        maximumRevisions: 25,
        maximumBytes: 10,
      }),
    ).rejects.toMatchObject({ code: "quota-exceeded", operation: "log" });
  });
});
