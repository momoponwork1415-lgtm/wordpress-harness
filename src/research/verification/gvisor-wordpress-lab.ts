import { createHash, randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { isAbsolute, relative, sep } from "node:path";

import { z } from "zod";

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
const labIpv4AddressSchema = z.string().refine((value) => {
  const octets = value.split(".");
  return (
    octets.length === 4 &&
    octets.every((octet) => {
      if (!/^\d{1,3}$/u.test(octet)) return false;
      const number = Number(octet);
      return number >= 0 && number <= 255;
    })
  );
}, "Lab container address must be an IPv4 address");

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

async function requireOutput(
  processRunner: LabProcessRunner,
  args: readonly string[],
  timeoutMs = 60_000,
): Promise<string> {
  const result = await run(processRunner, args, timeoutMs);
  if (result.exitCode !== 0) throw new LabCommandFailedError();
  return result.stdout;
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

interface WordPressCliContext {
  readonly processRunner: LabProcessRunner;
  readonly images: GvisorWordPressLabImages;
  readonly network: string;
  readonly volume: string;
  readonly databaseAddress: string;
  readonly databasePassword: string;
}

function wpCliArgs(
  context: WordPressCliContext,
  command: readonly string[],
): readonly string[] {
  const args = [
    "run",
    "--rm",
    "--runtime=runsc",
    "--network",
    context.network,
    "--env",
    `WORDPRESS_DB_HOST=${context.databaseAddress}`,
    "--env",
    "WORDPRESS_DB_NAME=wordpress",
    "--env",
    "WORDPRESS_DB_USER=root",
    "--env",
    `WORDPRESS_DB_PASSWORD=${context.databasePassword}`,
    "--volume",
    `${context.volume}:/var/www/html`,
  ];
  args.push(context.images.wordpressCli, "wp", ...command, "--allow-root");
  return args;
}

async function containerAddress(
  processRunner: LabProcessRunner,
  container: string,
): Promise<string> {
  const output = await requireOutput(
    processRunner,
    [
      "inspect",
      "--format",
      "{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}",
      container,
    ],
    10_000,
  );
  return labIpv4AddressSchema.parse(output.trim());
}

async function waitForWordPress(context: WordPressCliContext): Promise<void> {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const result = await run(
      context.processRunner,
      wpCliArgs(context, ["db", "check"]),
      15_000,
    );
    if (result.exitCode === 0) return;
    await new Promise<void>((resolve) => setTimeout(resolve, 1_000));
  }
  throw new LabCommandFailedError();
}

async function cleanup(
  processRunner: LabProcessRunner,
  databaseContainer: string,
  wordpressContainer: string,
  volume: string,
  network: string,
): Promise<boolean> {
  const containers = await run(processRunner, [
    "rm",
    "--force",
    databaseContainer,
    wordpressContainer,
  ]);
  const resources = await Promise.all([
    run(processRunner, ["volume", "rm", "--force", volume]),
    run(processRunner, ["network", "rm", network]),
  ]);
  return (
    containers.exitCode === 0 &&
    resources.every((result) => result.exitCode === 0)
  );
}

async function runFreshGvisorWordPressLabAttempt(
  options: RunFreshGvisorWordPressLabOptions,
): Promise<{ readonly labId: string; readonly stdout: string }> {
  const nonce = randomUUID();
  const labId = `lab-${nonce}`;
  const prefix = `wh-${nonce}`;
  const network = `${prefix}-net`;
  const volume = `${prefix}-wordpress`;
  const databaseContainer = `${prefix}-database`;
  const wordpressContainer = `${prefix}-wordpress`;
  const databasePassword = randomUUID();
  const adminPassword = randomUUID();
  let executionError: unknown;
  let workerStdout: string | undefined;

  try {
    await requireOutput(options.processRunner, [
      "network",
      "create",
      "--internal",
      "--label",
      "org.wordpress-harness.resource=verification-lab",
      network,
    ]);
    await requireOutput(options.processRunner, [
      "volume",
      "create",
      "--label",
      "org.wordpress-harness.resource=verification-lab",
      volume,
    ]);
    await requireOutput(options.processRunner, [
      "run",
      "--detach",
      "--name",
      databaseContainer,
      "--runtime=runsc",
      "--network",
      network,
      "--network-alias",
      "database",
      "--env",
      `MARIADB_ROOT_PASSWORD=${databasePassword}`,
      "--env",
      "MARIADB_DATABASE=wordpress",
      options.images.database,
    ]);
    const databaseAddress = await containerAddress(
      options.processRunner,
      databaseContainer,
    );
    await requireOutput(options.processRunner, [
      "run",
      "--detach",
      "--name",
      wordpressContainer,
      "--runtime=runsc",
      "--network",
      network,
      "--network-alias",
      "wordpress",
      "--volume",
      `${volume}:/var/www/html`,
      "--env",
      `WORDPRESS_DB_HOST=${databaseAddress}`,
      "--env",
      "WORDPRESS_DB_NAME=wordpress",
      "--env",
      "WORDPRESS_DB_USER=root",
      "--env",
      `WORDPRESS_DB_PASSWORD=${databasePassword}`,
      options.images.wordpress,
    ]);
    const wordpressAddress = await containerAddress(
      options.processRunner,
      wordpressContainer,
    );
    const cliContext: WordPressCliContext = {
      processRunner: options.processRunner,
      images: options.images,
      network,
      volume,
      databaseAddress,
      databasePassword,
    };
    await waitForWordPress(cliContext);
    await requireOutput(
      options.processRunner,
      wpCliArgs(cliContext, [
        "core",
        "install",
        "--url=http://wordpress",
        "--title=Verification Lab",
        "--admin_user=harness-admin",
        `--admin_password=${adminPassword}`,
        "--admin_email=harness-admin@example.invalid",
        "--skip-email",
      ]),
    );
    for (const plugin of options.plugins) {
      await requireOutput(options.processRunner, [
        "exec",
        wordpressContainer,
        "mkdir",
        "-p",
        `/var/www/html/wp-content/plugins/${plugin.pluginSlug}`,
      ]);
      await requireOutput(options.processRunner, [
        "cp",
        `${plugin.sourceDirectory}/.`,
        `${wordpressContainer}:/var/www/html/wp-content/plugins/${plugin.pluginSlug}`,
      ]);
      await requireOutput(
        options.processRunner,
        wpCliArgs(cliContext, ["plugin", "activate", plugin.pluginSlug]),
      );
    }
    const workerArgs = [
      "run",
      "--rm",
      "--runtime=runsc",
      "--network",
      network,
      "--shm-size=1g",
      "--add-host",
      `wordpress:${wordpressAddress}`,
    ];
    for (const mount of options.worker.mounts) {
      workerArgs.push(
        "--volume",
        `${mount.sourcePath}:${mount.containerPath}:ro`,
      );
    }
    for (const environment of [
      ...options.worker.environment,
      "WORDPRESS_BASE_URL=http://wordpress",
      "WORDPRESS_ADMIN_USER=harness-admin",
      `WORDPRESS_ADMIN_PASSWORD=${adminPassword}`,
    ]) {
      workerArgs.push("--env", environment);
    }
    workerArgs.push(options.images.worker, ...options.worker.command);
    workerStdout = await requireOutput(
      options.processRunner,
      workerArgs,
      options.worker.timeoutMs,
    );
  } catch (error) {
    executionError = error;
  }

  const cleaned = await cleanup(
    options.processRunner,
    databaseContainer,
    wordpressContainer,
    volume,
    network,
  );
  if (executionError !== undefined) throw executionError;
  if (!cleaned || workerStdout === undefined) throw new LabCommandFailedError();
  return { labId, stdout: workerStdout };
}

export async function runFreshGvisorWordPressLab(
  options: RunFreshGvisorWordPressLabOptions,
): Promise<{ readonly labId: string; readonly stdout: string }> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await runFreshGvisorWordPressLabAttempt(options);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}
