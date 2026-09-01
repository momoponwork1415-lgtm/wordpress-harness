import {
  mkdtemp,
  mkdir,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { openPhpSourceAnalysis } from "../../src/research/index.js";

const fixtureDirectory = fileURLToPath(
  new URL("../fixtures/php-plugin", import.meta.url),
);
const syntaxErrorFixtureDirectory = fileURLToPath(
  new URL("../fixtures/php-plugin-with-syntax-error", import.meta.url),
);
const helperPath = fileURLToPath(
  new URL("../../tools/php-program-index/bin/index.php", import.meta.url),
);

describe("PHP Source Analysis", () => {
  it("builds a deterministic WordPress-aware Program Index", async () => {
    const directory = await mkdtemp(join(tmpdir(), "wordpress-php-index-"));
    const analysis = openPhpSourceAnalysis({
      artifactDirectory: join(directory, "artifacts"),
      helperPath,
      phpBinary: "/usr/bin/php",
    });

    try {
      const ref = await analysis.analyze({
        targetSnapshot: {
          id: "synthetic-plugin-1.0.0",
          pluginSlug: "synthetic-plugin",
          version: "1.0.0",
          digest: `sha256:${"a".repeat(64)}`,
        },
        sourceDirectory: fixtureDirectory,
        profile: {
          id: "wordpress-php-8.3-v1",
          phpVersion: "8.3",
        },
      });
      const repeatedRef = await analysis.analyze({
        targetSnapshot: {
          id: "synthetic-plugin-1.0.0",
          pluginSlug: "synthetic-plugin",
          version: "1.0.0",
          digest: `sha256:${"a".repeat(64)}`,
        },
        sourceDirectory: fixtureDirectory,
        profile: {
          id: "wordpress-php-8.3-v1",
          phpVersion: "8.3",
        },
      });
      const index = await analysis.read(ref);
      const pluginFile = index.files.find((file) => file.path === "plugin.php");
      const adminFile = index.files.find(
        (file) => file.path === "includes/admin.php",
      );
      const pluginSymbols = pluginFile?.symbols.map((symbol) => ({
        kind: symbol.kind,
        name: symbol.name,
        startLine: symbol.range.startLine,
        endLine: symbol.range.endLine,
      }));
      const registrationCalls = pluginFile?.calls
        .filter(
          (call) =>
            call.callee === "add_action" ||
            call.callee === "register_rest_route",
        )
        .map((call) => ({
          kind: call.kind,
          caller: call.caller,
          callee: call.callee,
          startLine: call.range.startLine,
          endLine: call.range.endLine,
        }));
      const registrationFacts = pluginFile?.wordpressFacts
        .filter(
          (fact) =>
            fact.kind === "hook-registration" ||
            fact.kind === "route-registration",
        )
        .map((fact) => ({
          ...fact,
          range: {
            startLine: fact.range.startLine,
            endLine: fact.range.endLine,
          },
        }));
      const securityFacts = pluginFile?.wordpressFacts
        .filter(
          (fact) =>
            fact.kind === "guard" ||
            fact.kind === "source" ||
            fact.kind === "storage",
        )
        .map((fact) => ({
          ...fact,
          range: {
            startLine: fact.range.startLine,
            endLine: fact.range.endLine,
          },
        }));
      const adminSecurityFacts = adminFile?.wordpressFacts.map((fact) => ({
        ...fact,
        range: {
          startLine: fact.range.startLine,
          endLine: fact.range.endLine,
        },
      }));

      expect({
        ref,
        generator: index.generator,
        targetSnapshot: index.targetSnapshot,
        analysisProfile: index.analysisProfile,
        filePaths: index.files.map((file) => file.path),
        pluginFile:
          pluginFile === undefined
            ? undefined
            : {
                symbols: pluginSymbols,
                registrationCalls,
                registrationFacts,
                diagnostics: pluginFile.diagnostics,
              },
        diagnostics: index.diagnostics,
      }).toMatchObject({
        ref: {
          kind: "php-program-index",
          schemaVersion: 1,
          targetSnapshotId: "synthetic-plugin-1.0.0",
          analysisProfileId: "wordpress-php-8.3-v1",
          digest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
          summary: {
            files: 2,
            diagnostics: 0,
          },
        },
        generator: {
          name: "wordpress-harness/php-program-index",
          version: "0.1.0",
          phpParserVersion: "5.8.0",
        },
        targetSnapshot: {
          id: "synthetic-plugin-1.0.0",
          digest: `sha256:${"a".repeat(64)}`,
        },
        analysisProfile: {
          id: "wordpress-php-8.3-v1",
          phpVersion: "8.3",
        },
        filePaths: ["includes/admin.php", "plugin.php"],
        pluginFile: {
          symbols: [
            {
              kind: "function",
              name: "demo_register_routes",
              startLine: 5,
              endLine: 14,
            },
            {
              kind: "function",
              name: "demo_update_item",
              startLine: 16,
              endLine: 21,
            },
          ],
          registrationCalls: [
            {
              kind: "function",
              caller: null,
              callee: "add_action",
              startLine: 3,
              endLine: 3,
            },
            {
              kind: "function",
              caller: "demo_register_routes",
              callee: "register_rest_route",
              startLine: 7,
              endLine: 13,
            },
          ],
          registrationFacts: [
            {
              kind: "hook-registration",
              hook: "rest_api_init",
              callback: "demo_register_routes",
              range: { startLine: 3, endLine: 3 },
            },
            {
              kind: "route-registration",
              namespace: "demo/v1",
              route: "/items",
              callback: "demo_update_item",
              permissionCallback: "closure",
              range: { startLine: 7, endLine: 13 },
            },
          ],
          diagnostics: [],
        },
        diagnostics: [],
      });

      expect(pluginFile?.wordpressFacts.map((fact) => fact.kind)).toEqual([
        "hook-registration",
        "route-registration",
        "guard",
        "source",
        "storage",
      ]);
      expect(adminFile?.wordpressFacts.map((fact) => fact.kind)).toEqual([
        "sink",
        "storage",
      ]);
      expect(securityFacts).toEqual([
        {
          kind: "guard",
          category: "authorization",
          operation: "current_user_can",
          range: { startLine: 11, endLine: 11 },
        },
        {
          kind: "source",
          category: "request-parameter",
          operation: "get_param",
          range: { startLine: 18, endLine: 18 },
        },
        {
          kind: "storage",
          category: "option",
          operation: "update_option",
          access: "write",
          range: { startLine: 19, endLine: 19 },
        },
      ]);
      expect(adminSecurityFacts).toEqual([
        {
          kind: "sink",
          category: "html-output",
          operation: "echo",
          range: { startLine: 9, endLine: 9 },
        },
        {
          kind: "storage",
          category: "option",
          operation: "get_option",
          access: "read",
          range: { startLine: 9, endLine: 9 },
        },
      ]);
      expect(repeatedRef).toEqual(ref);
      await expect(
        analysis.read({
          ...ref,
          targetSnapshotId: "different-snapshot-1.0.0",
        }),
      ).rejects.toThrow("identity");
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it("records syntax diagnostics while preserving recoverable facts", async () => {
    const directory = await mkdtemp(
      join(tmpdir(), "wordpress-php-index-error-"),
    );
    const analysis = openPhpSourceAnalysis({
      artifactDirectory: join(directory, "artifacts"),
      helperPath,
      phpBinary: "/usr/bin/php",
    });

    try {
      const ref = await analysis.analyze({
        targetSnapshot: {
          id: "syntax-error-plugin-1.0.0",
          pluginSlug: "syntax-error-plugin",
          version: "1.0.0",
          digest: `sha256:${"b".repeat(64)}`,
        },
        sourceDirectory: syntaxErrorFixtureDirectory,
        profile: {
          id: "wordpress-php-8.3-v1",
          phpVersion: "8.3",
        },
      });
      const index = await analysis.read(ref);
      const file = index.files[0];

      expect(ref.summary.diagnostics).toBe(1);
      expect(file).toMatchObject({
        path: "broken.php",
        symbols: [{ kind: "function", name: "demo_with_error" }],
        calls: [
          { kind: "function", callee: "get_option" },
          { kind: "function", callee: "esc_html" },
        ],
        wordpressFacts: [
          {
            kind: "storage",
            category: "option",
            operation: "get_option",
            access: "read",
          },
          { kind: "sink", category: "html-output", operation: "echo" },
        ],
        diagnostics: [{ kind: "parse-error" }],
      });
      expect(index.diagnostics).toEqual([
        expect.objectContaining({ path: "broken.php", kind: "parse-error" }),
      ]);
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it("does not follow PHP symlinks outside the target root", async () => {
    const directory = await mkdtemp(
      join(tmpdir(), "wordpress-php-index-link-"),
    );
    const sourceDirectory = join(directory, "source");
    await mkdir(sourceDirectory);
    await writeFile(
      join(sourceDirectory, "inside.php"),
      "<?php function inside(): void {}\n",
    );
    await writeFile(
      join(directory, "outside.php"),
      "<?php function outside(): void {}\n",
    );
    await symlink(
      join(directory, "outside.php"),
      join(sourceDirectory, "linked.php"),
    );
    const analysis = openPhpSourceAnalysis({
      artifactDirectory: join(directory, "artifacts"),
      helperPath,
      phpBinary: "/usr/bin/php",
    });

    try {
      const ref = await analysis.analyze({
        targetSnapshot: {
          id: "symlink-plugin-1.0.0",
          pluginSlug: "symlink-plugin",
          version: "1.0.0",
          digest: `sha256:${"c".repeat(64)}`,
        },
        sourceDirectory,
        profile: {
          id: "wordpress-php-8.3-v1",
          phpVersion: "8.3",
        },
      });
      const index = await analysis.read(ref);

      expect(index.files.map((file) => file.path)).toEqual(["inside.php"]);
      expect(index.files[0]?.symbols.map((symbol) => symbol.name)).toEqual([
        "inside",
      ]);
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it("rejects malformed helper output without publishing an artifact", async () => {
    const directory = await mkdtemp(
      join(tmpdir(), "wordpress-php-index-output-"),
    );
    const malformedHelperPath = join(directory, "malformed-helper.php");
    await writeFile(malformedHelperPath, "<?php echo 'not-json';\n");
    const analysis = openPhpSourceAnalysis({
      artifactDirectory: join(directory, "artifacts"),
      helperPath: malformedHelperPath,
      phpBinary: "/usr/bin/php",
    });

    try {
      await expect(
        analysis.analyze({
          targetSnapshot: {
            id: "malformed-helper-plugin-1.0.0",
            pluginSlug: "malformed-helper-plugin",
            version: "1.0.0",
            digest: `sha256:${"d".repeat(64)}`,
          },
          sourceDirectory: fixtureDirectory,
          profile: {
            id: "wordpress-php-8.3-v1",
            phpVersion: "8.3",
          },
        }),
      ).rejects.toBeInstanceOf(SyntaxError);
      await expect(readdir(join(directory, "artifacts"))).rejects.toMatchObject(
        {
          code: "ENOENT",
        },
      );
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it("terminates helper output above the configured ceiling", async () => {
    const directory = await mkdtemp(
      join(tmpdir(), "wordpress-php-index-limit-"),
    );
    const noisyHelperPath = join(directory, "noisy-helper.php");
    await writeFile(noisyHelperPath, "<?php echo str_repeat('x', 1024);\n");
    const analysis = openPhpSourceAnalysis({
      artifactDirectory: join(directory, "artifacts"),
      helperPath: noisyHelperPath,
      phpBinary: "/usr/bin/php",
      maxOutputBytes: 16,
    });

    try {
      await expect(
        analysis.analyze({
          targetSnapshot: {
            id: "noisy-helper-plugin-1.0.0",
            pluginSlug: "noisy-helper-plugin",
            version: "1.0.0",
            digest: `sha256:${"e".repeat(64)}`,
          },
          sourceDirectory: fixtureDirectory,
          profile: {
            id: "wordpress-php-8.3-v1",
            phpVersion: "8.3",
          },
        }),
      ).rejects.toThrow("exceeded output ceiling");
      await expect(readdir(join(directory, "artifacts"))).rejects.toMatchObject(
        {
          code: "ENOENT",
        },
      );
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });
});
