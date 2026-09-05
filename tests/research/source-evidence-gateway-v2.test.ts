import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { sha256Digest } from "../../src/research/research-record/canonical-json.js";
import { openSourceEvidenceFixture } from "../fixtures/source-evidence.js";

const digest = (character: string): string => `sha256:${character.repeat(64)}`;

const assignment = {
  kind: "research-thesis" as const,
  schemaVersion: 1 as const,
  workWaveId: digest("1"),
  leaseId: digest("2"),
  thesis: {
    kind: "research-thesis" as const,
    schemaVersion: 1 as const,
    id: digest("3"),
    digest: digest("4"),
    targetSnapshotDigest: digest("a"),
    manifestDigest: digest("5"),
  },
};

describe("SourceEvidenceGateway.query v2", () => {
  it("paginates root recursive List in stable Manifest order without gaps or duplicates", async () => {
    const fixture = await openSourceEvidenceFixture({
      files: {
        "z-last.php": "z",
        "includes/z.php": "iz",
        "admin/a.php": "aa",
        "root.php": "r",
        "includes/a.php": "ia",
      },
      inventoryMaxResults: 2,
    });

    try {
      const manifest = {
        kind: "target-file-manifest" as const,
        schemaVersion: 1 as const,
        targetSnapshotId: fixture.manifest.targetSnapshot.id,
        targetSnapshotDigest: fixture.manifest.targetSnapshot.digest,
        digest: sha256Digest(fixture.manifest),
      };
      const files: unknown[] = [];
      let cursor: string | undefined;
      let queryOrdinal = 0;
      do {
        queryOrdinal += 1;
        const receipt = await fixture.gateway.query({
          kind: "source-list",
          schemaVersion: 2,
          attemptId: "attempt-v2-list",
          assignment: {
            ...assignment,
            thesis: { ...assignment.thesis, manifestDigest: manifest.digest },
          },
          targetSnapshot: fixture.manifest.targetSnapshot,
          manifest,
          policy: fixture.gateway.policy,
          queryOrdinal,
          budget: { maxQueries: 8 },
          ...(cursor === undefined
            ? {
                selector: {
                  scope: { kind: "root" },
                  traversal: "recursive",
                },
              }
            : { cursor }),
          reason: "Traverse the complete immutable source identity.",
        });
        expect(receipt.ref).toMatchObject({
          kind: "source-evidence-receipt",
          schemaVersion: 2,
          attemptId: "attempt-v2-list",
        });
        expect(receipt.value).toMatchObject({
          schemaVersion: 2,
          assignment: {
            leaseId: assignment.leaseId,
            thesis: { manifestDigest: manifest.digest },
          },
          targetSnapshot: fixture.manifest.targetSnapshot,
          manifest,
          policy: fixture.gateway.policy,
          queryOrdinal,
        });
        if (receipt.response?.kind !== "source-list-response") {
          throw new Error("Expected a v2 List response");
        }
        files.push(...receipt.response.entries);
        if (receipt.value.result.status === "partial") {
          cursor = receipt.response.nextCursor;
          expect(cursor).toEqual(expect.any(String));
        } else {
          expect(receipt.value.result.status).toBe("completed");
          cursor = undefined;
        }
      } while (cursor !== undefined);

      expect(files).toEqual(
        [
          "admin/a.php",
          "includes/a.php",
          "includes/z.php",
          "root.php",
          "z-last.php",
        ].map((path) => ({
          kind: "file",
          path,
          fileDigest: fixture.fileDigest(path),
          size: Buffer.byteLength(
            path === "admin/a.php"
              ? "aa"
              : path === "includes/a.php"
                ? "ia"
                : path === "includes/z.php"
                  ? "iz"
                  : path === "root.php"
                    ? "r"
                    : "z",
          ),
        })),
      );
      expect(new Set(files.map((entry) => JSON.stringify(entry))).size).toBe(
        files.length,
      );
    } finally {
      await fixture.close();
    }
  });

  it("continues exact-literal Search with multiple stable matches", async () => {
    const fixture = await openSourceEvidenceFixture({
      files: {
        "includes/second.php": "<?php\nneedle();\n",
        "admin/first.php": "<?php\nneedle();\nneedle();\n",
        "unrelated.php": "<?php\nclean();\n",
      },
      search: { maxScanBytes: 4096, maxResults: 1 },
    });

    try {
      const manifest = {
        kind: "target-file-manifest" as const,
        schemaVersion: 1 as const,
        targetSnapshotId: fixture.manifest.targetSnapshot.id,
        targetSnapshotDigest: fixture.manifest.targetSnapshot.digest,
        digest: sha256Digest(fixture.manifest),
      };
      const boundAssignment = {
        ...assignment,
        thesis: { ...assignment.thesis, manifestDigest: manifest.digest },
      };
      const matches: unknown[] = [];
      let cursor: string | undefined;
      let queryOrdinal = 0;
      do {
        queryOrdinal += 1;
        const receipt = await fixture.gateway.query({
          kind: "source-search",
          schemaVersion: 2,
          attemptId: "attempt-v2-search",
          assignment: boundAssignment,
          targetSnapshot: fixture.manifest.targetSnapshot,
          manifest,
          policy: fixture.gateway.policy,
          queryOrdinal,
          budget: { maxQueries: 8 },
          ...(cursor === undefined
            ? {
                selector: {
                  literal: "needle",
                  scope: { kind: "root" },
                },
              }
            : { cursor }),
          reason: "Find every exact use of the security-relevant operation.",
        });
        if (receipt.response?.kind !== "source-search-response") {
          throw new Error("Expected a v2 Search response");
        }
        matches.push(...receipt.response.matches);
        if (receipt.value.result.status === "partial") {
          cursor = receipt.response.nextCursor;
        } else {
          expect(receipt.value.result.status).toBe("completed");
          cursor = undefined;
        }
      } while (cursor !== undefined);

      expect(matches).toMatchObject([
        { anchor: { path: "admin/first.php", startLine: 2, startOffset: 6 } },
        { anchor: { path: "admin/first.php", startLine: 3, startOffset: 16 } },
        {
          anchor: {
            path: "includes/second.php",
            startLine: 2,
            startOffset: 6,
          },
        },
      ]);
    } finally {
      await fixture.close();
    }
  });

  it("reassembles the exact requested Read range from UTF-8-safe continuations", async () => {
    const source = [
      "<?php",
      "function 認証境界() {",
      "  return '安全ではない';",
      "}",
      "ignored();",
      "",
    ].join("\n");
    const fixture = await openSourceEvidenceFixture({
      files: { "includes/unicode.php": source },
      maxReadBytes: 9,
    });

    try {
      const manifest = {
        kind: "target-file-manifest" as const,
        schemaVersion: 1 as const,
        targetSnapshotId: fixture.manifest.targetSnapshot.id,
        targetSnapshotDigest: fixture.manifest.targetSnapshot.digest,
        digest: sha256Digest(fixture.manifest),
      };
      const boundAssignment = {
        ...assignment,
        thesis: { ...assignment.thesis, manifestDigest: manifest.digest },
      };
      const chunks: string[] = [];
      let cursor: string | undefined;
      let queryOrdinal = 0;
      do {
        queryOrdinal += 1;
        const receipt = await fixture.gateway.query({
          kind: "source-read",
          schemaVersion: 2,
          attemptId: "attempt-v2-read",
          assignment: boundAssignment,
          targetSnapshot: fixture.manifest.targetSnapshot,
          manifest,
          policy: fixture.gateway.policy,
          queryOrdinal,
          budget: { maxQueries: 16 },
          ...(cursor === undefined
            ? {
                selector: {
                  path: "includes/unicode.php",
                  fileDigest: fixture.fileDigest("includes/unicode.php"),
                  startLine: 2,
                  endLine: 4,
                },
              }
            : { cursor }),
          reason: "Read the complete implementation of the selected range.",
        });
        if (receipt.response?.kind !== "source-read-response") {
          throw new Error("Expected a v2 Read response");
        }
        chunks.push(receipt.response.content);
        expect(Buffer.byteLength(receipt.response.content)).toBeLessThanOrEqual(
          9,
        );
        if (receipt.value.result.status === "partial") {
          cursor = receipt.response.nextCursor;
        } else {
          expect(receipt.value.result.status).toBe("completed");
          cursor = undefined;
        }
      } while (cursor !== undefined);

      expect(chunks.join("")).toBe(
        ["function 認証境界() {", "  return '安全ではない';", "}"].join("\n"),
      );
    } finally {
      await fixture.close();
    }
  });

  it("distinguishes root and directory children from recursive files", async () => {
    const fixture = await openSourceEvidenceFixture({
      files: {
        "root.php": "root",
        "admin/a.php": "a",
        "admin/nested/b.php": "b",
        "includes/c.php": "c",
      },
      inventoryMaxResults: 20,
    });

    try {
      const manifest = {
        kind: "target-file-manifest" as const,
        schemaVersion: 1 as const,
        targetSnapshotId: fixture.manifest.targetSnapshot.id,
        targetSnapshotDigest: fixture.manifest.targetSnapshot.digest,
        digest: sha256Digest(fixture.manifest),
      };
      const boundAssignment = {
        ...assignment,
        thesis: { ...assignment.thesis, manifestDigest: manifest.digest },
      };
      const common = {
        schemaVersion: 2 as const,
        attemptId: "attempt-v2-list-scope",
        assignment: boundAssignment,
        targetSnapshot: fixture.manifest.targetSnapshot,
        manifest,
        policy: fixture.gateway.policy,
        budget: { maxQueries: 8 },
        reason: "Navigate derived directories without a free-form prefix.",
      };
      const root = await fixture.gateway.query({
        ...common,
        kind: "source-list",
        queryOrdinal: 1,
        selector: { scope: { kind: "root" }, traversal: "children" },
      });
      const directory = await fixture.gateway.query({
        ...common,
        kind: "source-list",
        queryOrdinal: 2,
        selector: {
          scope: { kind: "directory", path: "admin" },
          traversal: "children",
        },
      });
      const recursive = await fixture.gateway.query({
        ...common,
        kind: "source-list",
        queryOrdinal: 3,
        selector: {
          scope: { kind: "directory", path: "admin" },
          traversal: "recursive",
        },
      });

      expect(root.response).toMatchObject({
        entries: [
          { kind: "directory", path: "admin" },
          { kind: "directory", path: "includes" },
          { kind: "file", path: "root.php" },
        ],
      });
      expect(directory.response).toMatchObject({
        entries: [
          { kind: "file", path: "admin/a.php" },
          { kind: "directory", path: "admin/nested" },
        ],
      });
      expect(recursive.response).toMatchObject({
        entries: [
          { kind: "file", path: "admin/a.php" },
          { kind: "file", path: "admin/nested/b.php" },
        ],
      });
    } finally {
      await fixture.close();
    }
  });

  it("keeps a zero-match partial Search distinct from not-found", async () => {
    const fixture = await openSourceEvidenceFixture({
      files: { "late.php": `${"x".repeat(64)}needle` },
      search: { maxScanBytes: 8, maxResults: 8 },
    });

    try {
      const manifest = {
        kind: "target-file-manifest" as const,
        schemaVersion: 1 as const,
        targetSnapshotId: fixture.manifest.targetSnapshot.id,
        targetSnapshotDigest: fixture.manifest.targetSnapshot.digest,
        digest: sha256Digest(fixture.manifest),
      };
      const receipt = await fixture.gateway.query({
        kind: "source-search",
        schemaVersion: 2,
        attemptId: "attempt-v2-partial-search",
        assignment: {
          ...assignment,
          thesis: { ...assignment.thesis, manifestDigest: manifest.digest },
        },
        targetSnapshot: fixture.manifest.targetSnapshot,
        manifest,
        policy: fixture.gateway.policy,
        queryOrdinal: 1,
        budget: { maxQueries: 8 },
        selector: { literal: "needle", scope: { kind: "root" } },
        reason: "Search beyond the first bounded scan page.",
      });

      expect(receipt.value.result).toMatchObject({
        status: "partial",
        reason: "scan-limit",
      });
      expect(receipt.response).toMatchObject({ matches: [] });
    } finally {
      await fixture.close();
    }
  });

  it("keeps not-found, escape, identity, cursor, and budget failures distinct", async () => {
    const fixture = await openSourceEvidenceFixture({
      files: { "inside.php": "<?php\ninside();\n" },
      inventoryMaxResults: 2,
    });

    try {
      const manifest = {
        kind: "target-file-manifest" as const,
        schemaVersion: 1 as const,
        targetSnapshotId: fixture.manifest.targetSnapshot.id,
        targetSnapshotDigest: fixture.manifest.targetSnapshot.digest,
        digest: sha256Digest(fixture.manifest),
      };
      const common = {
        schemaVersion: 2 as const,
        attemptId: "attempt-v2-failures",
        assignment: {
          ...assignment,
          thesis: { ...assignment.thesis, manifestDigest: manifest.digest },
        },
        targetSnapshot: fixture.manifest.targetSnapshot,
        manifest,
        policy: fixture.gateway.policy,
        budget: { maxQueries: 8 },
        reason: "Classify the source query result without semantic collapse.",
      };
      const absent = await fixture.gateway.query({
        ...common,
        kind: "source-list",
        queryOrdinal: 1,
        selector: {
          scope: { kind: "directory", path: "missing" },
          traversal: "recursive",
        },
      });
      const escape = await fixture.gateway.query({
        ...common,
        kind: "source-list",
        queryOrdinal: 2,
        selector: {
          scope: { kind: "directory", path: "../private" },
          traversal: "recursive",
        },
      });
      const identity = await fixture.gateway.query({
        ...common,
        kind: "source-read",
        queryOrdinal: 3,
        selector: {
          path: "inside.php",
          fileDigest: digest("f"),
          startLine: 1,
          endLine: 1,
        },
      });
      const invalidCursor = await fixture.gateway.query({
        ...common,
        kind: "source-list",
        queryOrdinal: 4,
        cursor: "tampered-cursor",
      });
      const exhausted = await fixture.gateway.query({
        ...common,
        kind: "source-list",
        queryOrdinal: 2,
        budget: { maxQueries: 1 },
        selector: { scope: { kind: "root" }, traversal: "recursive" },
      });

      expect(absent.value.result).toEqual({
        status: "not-found",
        reason: "directory-not-found",
      });
      expect(escape.value.result).toEqual({
        status: "policy-denied",
        reason: "path-outside-snapshot",
      });
      expect(identity.value.result).toEqual({
        status: "identity-mismatch",
        reason: "file-digest-mismatch",
      });
      expect(invalidCursor.value.result).toEqual({
        status: "invalid-query",
        reason: "invalid-cursor",
      });
      expect(exhausted.value.result).toEqual({
        status: "budget-exhausted",
        reason: "source-query-limit-exceeded",
      });
      for (const receipt of [
        absent,
        escape,
        identity,
        invalidCursor,
        exhausted,
      ]) {
        expect(receipt.ref.schemaVersion).toBe(2);
        await expect(
          fixture.artifacts.readJson(receipt.ref.digest),
        ).resolves.toEqual(receipt.value);
      }
    } finally {
      await fixture.close();
    }
  });

  it("applies exact-literal Search to directory and explicit file scopes", async () => {
    const fixture = await openSourceEvidenceFixture({
      files: {
        "admin/a.php": "needle admin",
        "includes/b.php": "needle includes",
        "root.php": "needle root",
      },
      search: { maxScanBytes: 4096, maxResults: 8 },
    });

    try {
      const manifest = {
        kind: "target-file-manifest" as const,
        schemaVersion: 1 as const,
        targetSnapshotId: fixture.manifest.targetSnapshot.id,
        targetSnapshotDigest: fixture.manifest.targetSnapshot.digest,
        digest: sha256Digest(fixture.manifest),
      };
      const common = {
        kind: "source-search" as const,
        schemaVersion: 2 as const,
        attemptId: "attempt-v2-search-scope",
        assignment: {
          ...assignment,
          thesis: { ...assignment.thesis, manifestDigest: manifest.digest },
        },
        targetSnapshot: fixture.manifest.targetSnapshot,
        manifest,
        policy: fixture.gateway.policy,
        budget: { maxQueries: 8 },
        reason: "Search an exact literal inside the selected source scope.",
      };
      const directory = await fixture.gateway.query({
        ...common,
        queryOrdinal: 1,
        selector: {
          literal: "needle",
          scope: { kind: "directory", path: "admin" },
        },
      });
      const files = await fixture.gateway.query({
        ...common,
        queryOrdinal: 2,
        selector: {
          literal: "needle",
          scope: {
            kind: "files",
            paths: ["root.php", "includes/b.php"],
          },
        },
      });

      expect(directory.response).toMatchObject({
        matches: [{ anchor: { path: "admin/a.php" } }],
      });
      expect(files.response).toMatchObject({
        matches: [
          { anchor: { path: "includes/b.php" } },
          { anchor: { path: "root.php" } },
        ],
      });
    } finally {
      await fixture.close();
    }
  });

  it("separates canonical absence and changed source bytes from invalid paths", async () => {
    const fixture = await openSourceEvidenceFixture({
      files: { "inside.php": "original" },
      inventoryMaxResults: 8,
    });

    try {
      const manifest = {
        kind: "target-file-manifest" as const,
        schemaVersion: 1 as const,
        targetSnapshotId: fixture.manifest.targetSnapshot.id,
        targetSnapshotDigest: fixture.manifest.targetSnapshot.digest,
        digest: sha256Digest(fixture.manifest),
      };
      const common = {
        schemaVersion: 2 as const,
        attemptId: "attempt-v2-path-results",
        assignment: {
          ...assignment,
          thesis: { ...assignment.thesis, manifestDigest: manifest.digest },
        },
        targetSnapshot: fixture.manifest.targetSnapshot,
        manifest,
        policy: fixture.gateway.policy,
        budget: { maxQueries: 8 },
        reason: "Keep path and immutable source identity failures distinct.",
      };
      const absent = await fixture.gateway.query({
        ...common,
        kind: "source-read",
        queryOrdinal: 1,
        selector: {
          path: "missing.php",
          fileDigest: digest("e"),
          startLine: 1,
          endLine: 1,
        },
      });
      const trailingSlash = await fixture.gateway.query({
        ...common,
        kind: "source-list",
        queryOrdinal: 2,
        selector: {
          scope: { kind: "directory", path: "admin/" },
          traversal: "recursive",
        },
      });
      await writeFile(join(fixture.sourceDirectory, "inside.php"), "changed!");
      const changed = await fixture.gateway.query({
        ...common,
        kind: "source-read",
        queryOrdinal: 3,
        selector: {
          path: "inside.php",
          fileDigest: fixture.fileDigest("inside.php"),
          startLine: 1,
          endLine: 1,
        },
      });

      expect(absent.value.result).toEqual({
        status: "not-found",
        reason: "file-not-found",
      });
      expect(trailingSlash.value.result).toEqual({
        status: "invalid-query",
        reason: "invalid-path",
      });
      expect(changed.value.result).toEqual({
        status: "identity-mismatch",
        reason: "source-bytes-mismatch",
      });
    } finally {
      await fixture.close();
    }
  });
});
