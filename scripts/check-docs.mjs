import { existsSync, readFileSync, writeSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { spawnSync } from "node:child_process";

const repositoryRoot = process.cwd();
const diagnostics = [];
const markdownByPath = new Map();

const listedFiles = spawnSync(
  "git",
  [
    "ls-files",
    "--cached",
    "--others",
    "--exclude-standard",
    "-z",
    "--",
    "*.md",
  ],
  {
    cwd: repositoryRoot,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  },
);

if (listedFiles.status !== 0) {
  const detail = listedFiles.stderr.trim();
  writeSync(
    2,
    "docs check requires a Git repository" +
      (detail ? ": " + detail : "") +
      "\n",
  );
  process.exit(1);
}

const markdownFiles = listedFiles.stdout
  .split("\0")
  .filter((path) => path.length > 0)
  .filter((path) => existsSync(resolve(repositoryRoot, path)))
  .sort((left, right) => left.localeCompare(right, "en"));

function firstLinkTarget(rawTarget) {
  const trimmed = rawTarget.trim();
  if (trimmed.startsWith("<")) {
    const closing = trimmed.indexOf(">");
    return closing === -1 ? trimmed : trimmed.slice(1, closing);
  }
  return trimmed.split(/\s+/, 1)[0] ?? "";
}

function checkRelativeLinks(markdownPath, markdown) {
  const withoutFencedCode = markdown.replace(/```[\s\S]*?```/g, "");
  const linkPattern = /!?\[[^\]]*\]\(([^)\n]+)\)/g;

  for (const match of withoutFencedCode.matchAll(linkPattern)) {
    const rawTarget = firstLinkTarget(match[1]);
    if (
      rawTarget.length === 0 ||
      rawTarget.startsWith("#") ||
      rawTarget.startsWith("/") ||
      /^[a-z][a-z0-9+.-]*:/i.test(rawTarget)
    ) {
      continue;
    }

    const pathWithoutFragment = rawTarget.split(/[?#]/, 1)[0] ?? "";
    if (pathWithoutFragment.length === 0) {
      continue;
    }

    let decodedPath;
    try {
      decodedPath = decodeURIComponent(pathWithoutFragment);
    } catch {
      diagnostics.push(
        markdownPath + ": relative link is not valid URI syntax: " + rawTarget,
      );
      continue;
    }

    const absoluteTarget = resolve(
      repositoryRoot,
      dirname(markdownPath),
      decodedPath,
    );
    const repositoryRelativeTarget = relative(repositoryRoot, absoluteTarget);
    if (
      repositoryRelativeTarget === ".." ||
      repositoryRelativeTarget.startsWith(".." + sep) ||
      isAbsolute(repositoryRelativeTarget)
    ) {
      diagnostics.push(
        markdownPath + ": relative link escapes repository: " + rawTarget,
      );
      continue;
    }

    if (!existsSync(absoluteTarget)) {
      diagnostics.push(
        markdownPath +
          ": relative link target does not exist: " +
          pathWithoutFragment,
      );
    }
  }
}

function checkPublicPaths(markdownPath, markdown) {
  const withoutFencedCode = markdown.replace(/```[\s\S]*?```/g, "");
  const localPathPattern =
    /(?:\b[A-Za-z]:\\[^\s`]+|\/(?:home|Users)\/[^/\s`]+\/[^\s`]*)/g;

  for (const match of withoutFencedCode.matchAll(localPathPattern)) {
    diagnostics.push(
      markdownPath +
        ": public documentation contains a local absolute path: " +
        match[0],
    );
  }
}

function checkSupersededAdrs() {
  const adrPaths = [...markdownByPath.keys()].filter((path) =>
    path.startsWith("docs/adr/"),
  );

  for (const adrPath of adrPaths) {
    const markdown = markdownByPath.get(adrPath);
    const supersedes = markdown?.match(/^supersedes:\s+(\d{4})\s*$/m)?.[1];
    if (supersedes === undefined) continue;

    const retained = adrPaths.find((path) =>
      path.startsWith("docs/adr/" + supersedes + "-"),
    );
    if (retained !== undefined) {
      diagnostics.push(
        adrPath +
          ": superseded ADR remains in the current documentation set: " +
          retained,
      );
    }
  }
}

function checkCliDocumentation() {
  const cliPath = resolve(repositoryRoot, "src/cli.ts");
  const guidePath = "docs/CODEBASE-GUIDE.md";
  const guide = markdownByPath.get(guidePath);
  if (!existsSync(cliPath) || guide === undefined) return;

  const cli = readFileSync(cliPath, "utf8");
  const commands = cli.match(
    /Usage: wordpress-harness campaign <([^>]+)>/,
  )?.[1];
  if (commands === undefined) {
    diagnostics.push("src/cli.ts: campaign usage command list is missing");
    return;
  }

  const documented =
    "`wordpress-harness campaign " + commands.replaceAll("|", " | ") + "`";
  if (!guide.includes(documented)) {
    diagnostics.push(
      guidePath + ": CLI command list does not match src/cli.ts: " + documented,
    );
  }
}

for (const markdownPath of markdownFiles) {
  const markdown = readFileSync(resolve(repositoryRoot, markdownPath), "utf8");
  markdownByPath.set(markdownPath, markdown);
  checkRelativeLinks(markdownPath, markdown);
  checkPublicPaths(markdownPath, markdown);
}

checkSupersededAdrs();
checkCliDocumentation();

if (diagnostics.length > 0) {
  writeSync(2, diagnostics.sort().join("\n") + "\n");
  process.exit(1);
}

writeSync(
  1,
  "docs check passed: " + markdownFiles.length + " repository Markdown files\n",
);
