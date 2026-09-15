import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { runCli } from "../../src/cli.js";
import { canonicalDigest } from "../../src/infrastructure/canonical-json.js";

const { connections } = vi.hoisted(() => {
  const connections: Array<{ readonly open: boolean; close(): unknown }> = [];
  return { connections };
});

vi.mock("better-sqlite3", async (importOriginal) => {
  const { default: Database } = await importOriginal<{
    default: typeof import("better-sqlite3");
  }>();
  return {
    default: class ObservedDatabase extends Database {
      constructor(...args: ConstructorParameters<typeof Database>) {
        super(...args);
        connections.push(this);
      }
    },
  };
});

const directories: string[] = [];

afterEach(async () => {
  for (const connection of connections.splice(0)) {
    if (connection.open) connection.close();
  }
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("CLI database lifetime", () => {
  it.each(["inspect", "retry-validation"])(
    "releases its database after %s cannot read a campaign",
    async (command) => {
      const directory = await mkdtemp(join(tmpdir(), "cli-database-lifetime-"));
      directories.push(directory);
      const retryPath = join(directory, "retry.json");
      const body = {
        kind: "human-validation-retry",
        schemaVersion: 1,
        retryId: "fixture-retry",
        campaignId: "missing-campaign",
        campaignInputDigest: `sha256:${"a".repeat(64)}`,
        failedValidationRunIds: ["fixture-run"],
        operator: {
          identity: "fixture-operator",
          decidedAt: "2030-01-01T00:00:00.000Z",
        },
        reason: "Fixture retry against a missing record.",
      };
      await writeFile(
        retryPath,
        JSON.stringify({ ...body, digest: canonicalDigest(body) }),
      );
      const output: string[] = [];
      const errors: string[] = [];
      const exit = await runCli(
        [
          "campaign",
          command,
          "--database",
          join(directory, "research.sqlite"),
          ...(command === "inspect"
            ? ["--campaign", "missing-campaign"]
            : ["--retry", retryPath]),
        ],
        {
          stdout: (text) => output.push(text),
          stderr: (text) => errors.push(text),
        },
      );
      expect(exit).toBe(1);
      expect(output).toEqual([]);
      expect(errors.join(" ")).toMatch(/campaign.*not found|unknown campaign/i);
      expect(connections.length).toBeGreaterThan(0);
      expect(connections.every((connection) => !connection.open)).toBe(true);
    },
  );
});
