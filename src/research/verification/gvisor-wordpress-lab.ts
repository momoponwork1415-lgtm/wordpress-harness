import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { isAbsolute, relative, sep } from "node:path";

import { z } from "zod";

import { establishGvisorWordPressSession } from "../../infrastructure/gvisor-wordpress-session.js";

export interface LabProcessRequest {
  readonly executable: "docker";
  readonly args: readonly string[];
  readonly timeoutMs: number;
}

export interface LabProcessResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

export interface LabProcessRunner {
  run(request: LabProcessRequest): Promise<LabProcessResult>;
}

export interface GvisorWordPressLabImages {
  readonly database: string;
  readonly wordpress: string;
  readonly wordpressCli: string;
  readonly worker: string;
}

export interface GvisorWordPressLabPlugin {
  readonly sourceDirectory: string;
  readonly pluginSlug: string;
}

export interface GvisorWordPressWorkerMount {
  readonly sourcePath: string;
  readonly containerPath: string;
}

export interface RunFreshGvisorWordPressLabOptions {
  readonly processRunner: LabProcessRunner;
  readonly images: GvisorWordPressLabImages;
  readonly plugins: readonly GvisorWordPressLabPlugin[];
  readonly worker: {
    readonly mounts: readonly GvisorWordPressWorkerMount[];
    readonly environment: readonly string[];
    readonly command: readonly string[];
    readonly timeoutMs: number;
  };
}

export type GvisorWordPressLabPreflight =
  "ready" | "gvisor-unavailable" | "baseline-unavailable";

export const labAbsolutePathSchema = z
  .string()
  .min(1)
  .refine((path) => isAbsolute(path) && !path.includes("\0"), {
    message: "Lab private paths must be absolute",
  });
export const pinnedLabImageSchema = z
  .string()
  .regex(/^(?:[A-Za-z0-9._:/-]+@)?sha256:[a-f0-9]{64}$/);
export const labPluginSlugSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[a-z0-9][a-z0-9-]*$/);

export interface LabDirectoryManifestEntry {
  readonly path: string;
  readonly digest: string;
  readonly size: number;
}

const dockerRuntimesSchema = z.record(z.string(), z.unknown());

export function rawLabFileDigest(content: Buffer): string {
  return `sha256:${createHash("sha256").update(content).digest("hex")}`;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export async function labDirectoryManifest(
  root: string,
  directory = root,
): Promise<readonly LabDirectoryManifestEntry[]> {
  const entries: LabDirectoryManifestEntry[] = [];
  const children = await readdir(directory, { withFileTypes: true });
  children.sort((left, right) => compareText(left.name, right.name));
  for (const child of children) {
    const absolutePath = `${directory}/${child.name}`;
    if (child.isSymbolicLink()) {
      throw new Error("Lab source must not contain symbolic links");
    }
    if (child.isDirectory()) {
      entries.push(...(await labDirectoryManifest(root, absolutePath)));
      continue;
    }
    if (!child.isFile()) {
      throw new Error("Lab source must contain only regular files");
    }
    const content = await readFile(absolutePath);
    entries.push({
      path: relative(root, absolutePath).split(sep).join("/"),
      digest: rawLabFileDigest(content),
      size: content.byteLength,
    });
  }
  return entries.sort((left, right) => compareText(left.path, right.path));
}

class LabCommandFailedError extends Error {
  constructor() {
    super("A required Lab command failed");
    this.name = "LabCommandFailedError";
  }
}

async function run(
  processRunner: LabProcessRunner,
  args: readonly string[],
  timeoutMs = 60_000,
): Promise<LabProcessResult> {
  return processRunner.run({ executable: "docker", args, timeoutMs });
}

function reportsRunscRuntime(result: LabProcessResult): boolean {
  if (result.exitCode !== 0) return false;
  try {
    const runtimes = dockerRuntimesSchema.parse(JSON.parse(result.stdout));
    return Object.hasOwn(runtimes, "runsc");
  } catch {
    return false;
  }
}

export async function preflightGvisorWordPressLab(
  processRunner: LabProcessRunner,
  images: GvisorWordPressLabImages,
): Promise<GvisorWordPressLabPreflight> {
  if (!(await isGvisorRuntimeAvailable(processRunner))) {
    return "gvisor-unavailable";
  }
  return (await arePinnedLabImagesAvailable(processRunner, images))
    ? "ready"
    : "baseline-unavailable";
}

export async function isGvisorRuntimeAvailable(
  processRunner: LabProcessRunner,
): Promise<boolean> {
  const runtimes = await run(
    processRunner,
    ["info", "--format", "{{json .Runtimes}}"],
    10_000,
  );
  return reportsRunscRuntime(runtimes);
}

export async function arePinnedLabImagesAvailable(
  processRunner: LabProcessRunner,
  images: GvisorWordPressLabImages,
): Promise<boolean> {
  const imageResults = await Promise.all(
    Object.values(images).map((image) =>
      run(processRunner, ["image", "inspect", image]),
    ),
  );
  return imageResults.every((result) => result.exitCode === 0);
}

export async function runFreshGvisorWordPressLab(
  options: RunFreshGvisorWordPressLabOptions,
): Promise<{ readonly labId: string; readonly stdout: string }> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let session;
    try {
      session = await establishGvisorWordPressSession({
        processRunner: options.processRunner,
        images: options.images,
        plugins: options.plugins,
      });
      const stdout = await session.runWorker({
        image: options.images.worker,
        ...options.worker,
      });
      const cleaned = await session.dispose();
      if (!cleaned) throw new LabCommandFailedError();
      return { labId: session.labId, stdout };
    } catch (error) {
      if (session !== undefined) await session.dispose();
      lastError = error;
    }
  }
  throw lastError;
}
