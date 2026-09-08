import { rm } from "node:fs/promises";
import { relative, resolve } from "node:path";

const repositoryRoot = process.cwd();
const outputRoot = resolve(repositoryRoot, "dist");
if (relative(repositoryRoot, outputRoot) !== "dist") {
  throw new Error("Refusing to clean an unexpected build output path");
}

await rm(outputRoot, { recursive: true, force: true });
