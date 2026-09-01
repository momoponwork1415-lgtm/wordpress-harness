import { existsSync, readFileSync, writeSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { spawnSync } from "node:child_process";

const repositoryRoot = process.cwd();
const diagnostics = [];

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

function readGlossaryTerms(markdown) {
  const terms = new Set();
  for (const line of markdown.split("\n")) {
    if (!line.startsWith("|")) {
      continue;
    }
    const firstCell = line.split("|")[1]?.trim() ?? "";
    const term = firstCell.replace(/^`|`$/g, "");
    if (
      term.length === 0 ||
      term === "正式語" ||
      term === "Canonical term" ||
      /^:?-+:?$/.test(term)
    ) {
      continue;
    }
    terms.add(term);
  }
  return terms;
}

const glossaryPath = "docs/JAPANESE-GLOSSARY.md";
const glossaryTerms = markdownFiles.includes(glossaryPath)
  ? readGlossaryTerms(
      readFileSync(resolve(repositoryRoot, glossaryPath), "utf8"),
    )
  : new Set();
let contextTermCount = 0;

for (const markdownPath of markdownFiles) {
  const markdown = readFileSync(resolve(repositoryRoot, markdownPath), "utf8");
  checkRelativeLinks(markdownPath, markdown);

  if (markdownPath === "CONTEXT.md" || markdownPath.endsWith("/CONTEXT.md")) {
    const contextTermPattern = /^\*\*([^*\n]+)\*\*:/gm;
    for (const match of markdown.matchAll(contextTermPattern)) {
      const term = match[1]?.trim() ?? "";
      if (term.length === 0) {
        continue;
      }
      contextTermCount += 1;
      if (!glossaryTerms.has(term)) {
        diagnostics.push(
          markdownPath +
            ": canonical term is missing from " +
            glossaryPath +
            ": " +
            term,
        );
      }
    }
  }
}

if (diagnostics.length > 0) {
  writeSync(2, diagnostics.sort().join("\n") + "\n");
  process.exit(1);
}

console.log(
  "docs check passed: " +
    markdownFiles.length +
    " repository Markdown files, " +
    contextTermCount +
    " Context terms",
);
