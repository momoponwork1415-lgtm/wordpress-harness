import { existsSync, readdirSync, writeSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const repositoryRoot = process.cwd();
const sourceRoot = resolve(repositoryRoot, "src");
const outputRoot = resolve(repositoryRoot, "dist");
const diagnostics = [];
let outputCount = 0;

function sourcePathFor(relativeOutput) {
  if (relativeOutput.endsWith(".d.ts")) {
    return relativeOutput.slice(0, -".d.ts".length) + ".ts";
  }
  if (relativeOutput.endsWith(".js.map")) {
    return relativeOutput.slice(0, -".js.map".length) + ".ts";
  }
  if (relativeOutput.endsWith(".js")) {
    return relativeOutput.slice(0, -".js".length) + ".ts";
  }
  return undefined;
}

function inspect(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      inspect(path);
      continue;
    }
    const relativeOutput = relative(outputRoot, path);
    const sourcePath = sourcePathFor(relativeOutput);
    if (sourcePath === undefined) {
      diagnostics.push(`dist/${relativeOutput}: unexpected build artifact`);
      continue;
    }
    outputCount += 1;
    if (!existsSync(resolve(sourceRoot, sourcePath))) {
      diagnostics.push(
        `dist/${relativeOutput}: no current source at src/${sourcePath}`,
      );
    }
  }
}

if (!existsSync(outputRoot)) {
  diagnostics.push("dist: build output is missing");
} else {
  inspect(outputRoot);
}
if (outputCount === 0) {
  diagnostics.push("dist: build emitted no artifacts");
}

if (diagnostics.length > 0) {
  writeSync(2, diagnostics.sort().join("\n") + "\n");
  process.exit(1);
}

console.log(`build output check passed: ${outputCount} artifacts`);
