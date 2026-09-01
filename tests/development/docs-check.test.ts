import { execFile, spawn } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

const docsCheckPath = fileURLToPath(
  new URL("../../scripts/check-docs.mjs", import.meta.url),
);
const execFileAsync = promisify(execFile);

interface CommandResult {
  readonly exitCode: number | null;
  readonly stderr: string;
  readonly stdout: string;
}

async function runDocsCheck(cwd: string): Promise<CommandResult> {
  return await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [docsCheckPath], {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = "";
    let stdout = "";

    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.once("error", reject);
    child.once("close", (exitCode) => {
      resolve({ exitCode, stderr, stdout });
    });
  });
}

async function createDocsFixture(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "wordpress-docs-check-"));
  await execFileAsync("git", ["init", "--quiet"], { cwd: directory });
  await mkdir(join(directory, "docs"), { recursive: true });
  await writeFile(join(directory, "CONTEXT.md"), "# Test Context\n", "utf8");
  await writeFile(
    join(directory, "docs", "JAPANESE-GLOSSARY.md"),
    "# Glossary\n\n| Canonical term | Meaning |\n| --- | --- |\n",
    "utf8",
  );
  return directory;
}

describe("repository documentation check", () => {
  it("reports a repository-owned relative link whose target is missing", async () => {
    const directory = await createDocsFixture();

    try {
      await writeFile(
        join(directory, "README.md"),
        "Read the [missing design](docs/missing.md).\n",
        "utf8",
      );

      const result = await runDocsCheck(directory);

      expect(result.exitCode).toBe(1);
      expect(result.stderr + result.stdout).toContain(
        "README.md: relative link target does not exist: docs/missing.md",
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("reports a Context term missing from the Japanese glossary", async () => {
    const directory = await createDocsFixture();

    try {
      await writeFile(
        join(directory, "CONTEXT.md"),
        "# Test Context\n\n**Unmapped Term**:\nA durable definition.\n",
        "utf8",
      );

      const result = await runDocsCheck(directory);

      expect(result.exitCode).toBe(1);
      expect(result.stderr + result.stdout).toContain(
        "CONTEXT.md: canonical term is missing from docs/JAPANESE-GLOSSARY.md: Unmapped Term",
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
