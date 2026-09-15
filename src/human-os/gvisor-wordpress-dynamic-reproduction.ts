import { createHash, randomUUID } from "node:crypto";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { isAbsolute, join } from "node:path";

import { z } from "zod";

import { verifyCanonicalSourceTree } from "../infrastructure/canonical-source-tree.js";
import {
  canonicalDigest,
  encodeCanonicalJson,
} from "../infrastructure/canonical-json.js";
import { runNativeModelProcess } from "../infrastructure/native-model-process.js";
import {
  sourceValidatedFindingSchema,
  type SourceValidatedFinding,
} from "../research/index.js";
import {
  defineAIReproductionRecord,
  externalDependencyEvidenceRequestSchema,
  type AIReproductionRecord,
} from "./contracts-v3.js";
import type { DynamicReproductionRuntime } from "./human-os-v3.js";

const pinnedImageSchema = z.string().regex(/^[^\s@]+@sha256:[a-f0-9]{64}$/);
const dockerRuntimesSchema = z.record(z.string(), z.unknown());
const ipv4AddressSchema = z.string().refine((value) => {
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
const boundedSummarySchema = z.string().min(1).max(4_000);
const dynamicReproductionLabSetupBodySchema = z.strictObject({
  kind: z.literal("dynamic-reproduction-lab-setup"),
  schemaVersion: z.literal(1),
  findingId: z.string().min(1).max(512),
  targetSnapshotDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  dependencySnapshotsDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  script: z
    .string()
    .min(1)
    .max(128 * 1024),
});

export const dynamicReproductionLabSetupSchema =
  dynamicReproductionLabSetupBodySchema
    .extend({ digest: z.string().regex(/^sha256:[a-f0-9]{64}$/) })
    .superRefine((setup, context) => {
      const { digest, ...body } = setup;
      if (digest !== canonicalDigest(body)) {
        context.addIssue({
          code: "custom",
          path: ["digest"],
          message: "Dynamic Reproduction Lab Setup digest mismatch",
        });
      }
    });

export const dynamicReproductionAgentOutcomeSchema = z.discriminatedUnion(
  "status",
  [
    z.strictObject({
      status: z.literal("runtime-confirmed"),
      summary: boundedSummarySchema,
      preconditionsMatched: z.literal(true),
      recipeCompleted: z.literal(true),
      effectObserved: z.literal(true),
    }),
    z.strictObject({
      status: z.literal("disproved"),
      summary: boundedSummarySchema,
      preconditionsMatched: z.literal(true),
      recipeCompleted: z.literal(true),
      effectObserved: z.literal(false),
    }),
    z.strictObject({
      status: z.literal("incomplete"),
      summary: boundedSummarySchema,
      preconditionsMatched: z.boolean(),
      recipeCompleted: z.boolean(),
      effectObserved: z.boolean().nullable(),
      evidenceRequest: externalDependencyEvidenceRequestSchema.optional(),
    }),
  ],
);

export interface ContainerProcessRequest {
  readonly args: readonly string[];
  readonly stdin?: string;
  readonly timeoutMs: number;
  readonly maxOutputBytes: number;
}

export interface ContainerProcessResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

export interface ContainerProcessRunner {
  run(request: ContainerProcessRequest): Promise<ContainerProcessResult>;
}

/**
 * A companion plugin the Target ordinarily runs inside, mounted from a pinned
 * Dependency Snapshot. It is installed and activated before the Target so the
 * Lab matches the Campaign's ordinary configuration.
 */
export interface DynamicReproductionDependency {
  readonly dependencySnapshotId: string;
  readonly pluginSlug: string;
  readonly sourceDirectory: string;
}

export type DynamicReproductionLabSetup = z.infer<
  typeof dynamicReproductionLabSetupSchema
>;

export interface DynamicReproductionSourceResolver {
  resolve(input: {
    readonly targetSnapshot: SourceValidatedFinding["targetSnapshot"];
    readonly dependencySnapshots: NonNullable<
      SourceValidatedFinding["dependencySnapshots"]
    >;
  }): Promise<{
    readonly sourceDirectory: string;
    readonly dependencies?: readonly DynamicReproductionDependency[];
    /** Finding-bound ordinary site-owner configuration run once after every
     * plugin is active. It must not grant the attacker authority that the
     * ordinary configuration would not.
     */
    readonly labSetup?: DynamicReproductionLabSetup;
  }>;
}

export interface DynamicReproductionExperiment {
  readonly environmentId: string;
  run(input: {
    readonly script: string;
    readonly timeoutMs: number;
  }): Promise<ContainerProcessResult>;
}

export type DynamicReproductionAgentOutcome = z.infer<
  typeof dynamicReproductionAgentOutcomeSchema
>;

export interface DynamicReproductionAgent {
  execute(input: {
    readonly finding: SourceValidatedFinding;
    readonly sourceDirectory: string;
    readonly experiment: DynamicReproductionExperiment;
  }): Promise<DynamicReproductionAgentOutcome>;
}

export interface GvisorWordPressDynamicReproductionOptions {
  readonly dockerExecutablePath: string;
  readonly images: {
    readonly database: string;
    readonly wordpress: string;
    readonly wordpressCli: string;
    readonly worker: string;
  };
  readonly sourceResolver: DynamicReproductionSourceResolver;
  readonly agent: DynamicReproductionAgent;
  readonly scratchRootDirectory: string;
  readonly privateEvidenceDirectory: string;
  readonly processRunner?: ContainerProcessRunner;
  readonly clock?: () => Date;
  readonly healthAttempts?: number;
  readonly maxExperiments?: number;
}

interface LabResources {
  readonly network: string;
  readonly volume: string;
  readonly databaseContainer: string;
  readonly wordpressContainer: string;
  networkCreated: boolean;
  volumeCreated: boolean;
  databaseCreated: boolean;
  wordpressCreated: boolean;
  databaseAddress: string | null;
  wordpressAddress: string | null;
}

interface ExperimentTranscript {
  readonly script: string;
  readonly result: ContainerProcessResult;
}

function processEnvironment(): NodeJS.ProcessEnv {
  const path = process.env.PATH;
  if (path === undefined) throw new Error("Dynamic Reproduction requires PATH");
  return { PATH: path, LANG: "C", LC_ALL: "C", TZ: "UTC" };
}

function nonRootHostUser(): string {
  if (
    typeof process.getuid !== "function" ||
    typeof process.getgid !== "function"
  ) {
    throw new Error("Dynamic Reproduction requires a POSIX host user");
  }
  const uid = process.getuid();
  const gid = process.getgid();
  if (uid <= 0 || gid <= 0) {
    throw new Error("Dynamic Reproduction requires a non-root host user");
  }
  return `${uid}:${gid}`;
}

export function openContainerProcessRunner(
  dockerExecutablePath: string,
  workingDirectory: string,
): ContainerProcessRunner {
  return {
    run: async (request) => {
      const result = await runNativeModelProcess({
        executablePath: dockerExecutablePath,
        args: request.args,
        workingDirectory,
        environment: processEnvironment(),
        ...(request.stdin === undefined ? {} : { stdin: request.stdin }),
        timeoutMs: request.timeoutMs,
        maxOutputBytes: request.maxOutputBytes,
      });
      return result.kind === "exited"
        ? result
        : { exitCode: -1, stdout: "", stderr: result.stderr };
    },
  };
}

async function absoluteDirectory(path: string, label: string): Promise<string> {
  if (!isAbsolute(path) || path.includes("\0") || path.includes(":")) {
    throw new Error(`${label} must be an absolute container-mountable path`);
  }
  const resolved = await realpath(path);
  if (!(await stat(resolved)).isDirectory()) {
    throw new Error(`${label} must be a directory`);
  }
  return resolved;
}

function rawDigest(content: Uint8Array): string {
  return `sha256:${createHash("sha256").update(content).digest("hex")}`;
}

async function putPrivateEvidence(
  directory: string,
  content: Uint8Array,
): Promise<string> {
  const digest = rawDigest(content);
  const path = join(directory, digest.slice("sha256:".length));
  try {
    await writeFile(path, content, { flag: "wx", mode: 0o600 });
  } catch (error: unknown) {
    if (!(
      error instanceof Error &&
      "code" in error &&
      error.code === "EEXIST"
    )) {
      throw error;
    }
    const existingStat = await lstat(path);
    const existing = await readFile(path);
    if (
      !existingStat.isFile() ||
      existingStat.isSymbolicLink() ||
      existingStat.nlink !== 1 ||
      rawDigest(existing) !== digest
    ) {
      throw new Error("Private evidence CAS conflict");
    }
  }
  return digest;
}

class GvisorWordPressDynamicReproductionRuntime implements DynamicReproductionRuntime {
  readonly #options: GvisorWordPressDynamicReproductionOptions;
  readonly #runner: ContainerProcessRunner;
  readonly #clock: () => Date;
  readonly #healthAttempts: number;
  readonly #maxExperiments: number;
  readonly #containerUser: string;

  constructor(options: GvisorWordPressDynamicReproductionOptions) {
    this.#options = options;
    if (!isAbsolute(options.dockerExecutablePath)) {
      throw new Error("Docker executable path must be absolute");
    }
    for (const image of Object.values(options.images)) {
      pinnedImageSchema.parse(image);
    }
    this.#runner =
      options.processRunner ??
      openContainerProcessRunner(
        options.dockerExecutablePath,
        options.scratchRootDirectory,
      );
    this.#clock = options.clock ?? (() => new Date());
    this.#containerUser = nonRootHostUser();
    this.#healthAttempts = options.healthAttempts ?? 60;
    this.#maxExperiments = options.maxExperiments ?? 32;
    if (
      !Number.isSafeInteger(this.#healthAttempts) ||
      this.#healthAttempts <= 0 ||
      !Number.isSafeInteger(this.#maxExperiments) ||
      this.#maxExperiments <= 0
    ) {
      throw new Error("Dynamic Reproduction bounds are invalid");
    }
  }

  async execute(input: {
    readonly finding: SourceValidatedFinding;
  }): Promise<AIReproductionRecord> {
    const finding = sourceValidatedFindingSchema.parse(input.finding);
    const runtimeProfileDigest = canonicalDigest({
      kind: "dynamic-reproduction-runtime-profile",
      schemaVersion: 1,
      images: this.#options.images,
    });
    const [scratchRootDirectory, privateEvidenceDirectory] = await Promise.all([
      absoluteDirectory(
        this.#options.scratchRootDirectory,
        "Dynamic Reproduction scratch root",
      ),
      absoluteDirectory(
        this.#options.privateEvidenceDirectory,
        "Private evidence directory",
      ),
    ]);
    await chmod(privateEvidenceDirectory, 0o700);
    const resolved = await this.#options.sourceResolver.resolve({
      targetSnapshot: finding.targetSnapshot,
      dependencySnapshots: finding.dependencySnapshots ?? [],
    });
    const sourceDirectory = await absoluteDirectory(
      resolved.sourceDirectory,
      "Target source",
    );
    if (
      !(
        await verifyCanonicalSourceTree(
          sourceDirectory,
          finding.targetSnapshot.sourceTree,
        )
      ).matches
    ) {
      throw new Error("Dynamic Reproduction Target source mismatch");
    }
    const dependencySnapshots = new Map(
      (finding.dependencySnapshots ?? []).map((snapshot) => [
        snapshot.id,
        snapshot,
      ]),
    );
    const resolvedDependencyIds = new Set<string>();
    const dependencies: DynamicReproductionDependency[] = [];
    for (const dependency of resolved.dependencies ?? []) {
      const snapshot = dependencySnapshots.get(dependency.dependencySnapshotId);
      if (
        snapshot === undefined ||
        resolvedDependencyIds.has(dependency.dependencySnapshotId)
      ) {
        throw new Error(
          "Dynamic Reproduction Dependency does not match the Finding",
        );
      }
      resolvedDependencyIds.add(dependency.dependencySnapshotId);
      const dependencyDirectory = await absoluteDirectory(
        dependency.sourceDirectory,
        "Dependency source",
      );
      if (
        !(
          await verifyCanonicalSourceTree(
            dependencyDirectory,
            snapshot.sourceTree,
          )
        ).matches
      ) {
        throw new Error("Dynamic Reproduction Dependency source mismatch");
      }
      dependencies.push({
        dependencySnapshotId: dependency.dependencySnapshotId,
        pluginSlug: dependency.pluginSlug,
        sourceDirectory: dependencyDirectory,
      });
    }
    const labSetup =
      resolved.labSetup === undefined
        ? undefined
        : dynamicReproductionLabSetupSchema.parse(resolved.labSetup);
    if (
      labSetup !== undefined &&
      (labSetup.findingId !== finding.findingId ||
        labSetup.targetSnapshotDigest !== finding.targetSnapshot.digest ||
        labSetup.dependencySnapshotsDigest !==
          canonicalDigest(finding.dependencySnapshots ?? []))
    ) {
      throw new Error("Dynamic Reproduction Lab Setup does not match Finding");
    }
    await this.#inspectIsolation();

    const environmentId = `dynamic-${randomUUID()}`;
    const prefix = `wh-${environmentId.slice("dynamic-".length)}`;
    const resources: LabResources = {
      network: `${prefix}-net`,
      volume: `${prefix}-wordpress`,
      databaseContainer: `${prefix}-database`,
      wordpressContainer: `${prefix}-wordpress`,
      networkCreated: false,
      volumeCreated: false,
      databaseCreated: false,
      wordpressCreated: false,
      databaseAddress: null,
      wordpressAddress: null,
    };
    const databasePassword = randomUUID();
    const adminPassword = randomUUID();
    const runDirectory = await mkdtemp(join(scratchRootDirectory, "dynamic-"));
    const evidenceDirectory = join(runDirectory, "evidence");
    await mkdir(evidenceDirectory, { mode: 0o700 });
    const transcripts: ExperimentTranscript[] = [];
    let outcome: DynamicReproductionAgentOutcome | undefined;
    let setupCompleted = false;
    let cleanupCompleted = false;

    try {
      try {
        await this.#setupLab(
          resources,
          sourceDirectory,
          finding.targetSnapshot.pluginSlug,
          databasePassword,
          adminPassword,
          dependencies,
          labSetup?.script,
        );
        setupCompleted = true;
        const experiment: DynamicReproductionExperiment = Object.freeze({
          environmentId,
          run: async (request: {
            readonly script: string;
            readonly timeoutMs: number;
          }) => {
            if (transcripts.length >= this.#maxExperiments) {
              throw new Error("Dynamic Reproduction experiment limit exceeded");
            }
            if (
              request.script.length === 0 ||
              Buffer.byteLength(request.script, "utf8") > 128 * 1024 ||
              !Number.isSafeInteger(request.timeoutMs) ||
              request.timeoutMs <= 0 ||
              request.timeoutMs > 5 * 60_000
            ) {
              throw new Error(
                "Dynamic Reproduction experiment is out of bounds",
              );
            }
            const result = await this.#runWorker(
              resources,
              sourceDirectory,
              evidenceDirectory,
              adminPassword,
              request.script,
              request.timeoutMs,
            );
            transcripts.push({ script: request.script, result });
            return result;
          },
        });
        try {
          outcome = dynamicReproductionAgentOutcomeSchema.parse(
            await this.#options.agent.execute({
              finding,
              sourceDirectory,
              experiment,
            }),
          );
        } catch {
          outcome = {
            status: "incomplete",
            summary: "The Dynamic Reproduction agent did not complete.",
            preconditionsMatched: false,
            recipeCompleted: false,
            effectObserved: null,
          };
        }
      } catch {
        outcome = {
          status: "incomplete",
          summary:
            "The fresh WordPress reproduction lab could not be prepared.",
          preconditionsMatched: false,
          recipeCompleted: false,
          effectObserved: null,
        };
      } finally {
        cleanupCompleted = await this.#cleanup(resources);
      }

      let evidence: AIReproductionRecord["privateEvidence"] = [];
      let evidenceStored = true;
      try {
        evidence = await this.#persistEvidence(
          privateEvidenceDirectory,
          evidenceDirectory,
          finding,
          environmentId,
          runtimeProfileDigest,
          transcripts,
          outcome,
        );
      } catch {
        evidenceStored = false;
      }
      const conclusive =
        setupCompleted &&
        cleanupCompleted &&
        evidenceStored &&
        evidence.length > 0 &&
        transcripts.length > 0 &&
        outcome !== undefined &&
        outcome.status !== "incomplete";
      const status = conclusive ? outcome.status : "incomplete";
      const summary =
        conclusive && outcome !== undefined
          ? outcome.summary
          : outcome?.status === "incomplete"
            ? outcome.summary
            : "Dynamic Reproduction did not complete a fully evidenced fresh-lab experiment.";
      return defineAIReproductionRecord({
        kind: "ai-reproduction-record",
        schemaVersion: 3,
        findingId: finding.findingId,
        environment:
          setupCompleted && cleanupCompleted
            ? {
                environmentId,
                targetSnapshotDigest: finding.targetSnapshot.digest,
                runtimeProfileDigest,
                backend: "gvisor",
                runtime: "runsc",
                fallbackUsed: false,
                fresh: true,
                disposable: true,
                hostTargetExecution: false,
                ambientCredentials: false,
                arbitraryNetwork: false,
              }
            : null,
        status,
        summary,
        evidenceRequest:
          outcome?.status === "incomplete"
            ? (outcome.evidenceRequest ?? null)
            : null,
        privateEvidence: evidence,
        recordedAt: this.#clock().toISOString(),
      });
    } finally {
      await rm(runDirectory, { recursive: true, force: true });
    }
  }

  async #docker(
    args: readonly string[],
    options: {
      readonly stdin?: string;
      readonly timeoutMs?: number;
      readonly maxOutputBytes?: number;
    } = {},
  ): Promise<ContainerProcessResult> {
    return this.#runner.run({
      args,
      ...(options.stdin === undefined ? {} : { stdin: options.stdin }),
      timeoutMs: options.timeoutMs ?? 60_000,
      maxOutputBytes: options.maxOutputBytes ?? 1024 * 1024,
    });
  }

  async #requireDocker(
    args: readonly string[],
    options?: {
      readonly stdin?: string;
      readonly timeoutMs?: number;
      readonly maxOutputBytes?: number;
    },
  ): Promise<ContainerProcessResult> {
    const result = await this.#docker(args, options);
    if (result.exitCode !== 0) {
      throw new Error("gVisor WordPress lab command failed");
    }
    return result;
  }

  async #inspectIsolation(): Promise<void> {
    const [runtimes, ...images] = await Promise.all([
      this.#docker(["info", "--format", "{{json .Runtimes}}"], {
        timeoutMs: 10_000,
        maxOutputBytes: 64 * 1024,
      }),
      ...Object.values(this.#options.images).map((image) =>
        this.#docker(["image", "inspect", image], {
          timeoutMs: 30_000,
          maxOutputBytes: 64 * 1024,
        }),
      ),
    ]);
    let hasRunsc = false;
    try {
      hasRunsc =
        runtimes.exitCode === 0 &&
        Object.hasOwn(
          dockerRuntimesSchema.parse(JSON.parse(runtimes.stdout) as unknown),
          "runsc",
        );
    } catch {
      hasRunsc = false;
    }
    if (!hasRunsc || images.some((image) => image.exitCode !== 0)) {
      throw new Error("gVisor Dynamic Reproduction runtime is unavailable");
    }
  }

  async #setupLab(
    resources: LabResources,
    sourceDirectory: string,
    pluginSlug: string,
    databasePassword: string,
    adminPassword: string,
    dependencies: readonly DynamicReproductionDependency[] = [],
    ordinaryConfiguration?: string,
  ): Promise<void> {
    await this.#requireDocker([
      "network",
      "create",
      "--internal",
      "--label",
      "org.wordpress-harness.resource=dynamic-reproduction",
      resources.network,
    ]);
    resources.networkCreated = true;
    await this.#requireDocker([
      "volume",
      "create",
      "--label",
      "org.wordpress-harness.resource=dynamic-reproduction",
      resources.volume,
    ]);
    resources.volumeCreated = true;
    await this.#requireDocker([
      "run",
      "--detach",
      "--name",
      resources.databaseContainer,
      "--runtime=runsc",
      "--network",
      resources.network,
      "--network-alias",
      "database",
      "--security-opt=no-new-privileges",
      "--env",
      `MARIADB_ROOT_PASSWORD=${databasePassword}`,
      "--env",
      "MARIADB_DATABASE=wordpress",
      this.#options.images.database,
    ]);
    resources.databaseCreated = true;
    resources.databaseAddress = await this.#containerAddress(
      resources.databaseContainer,
    );
    await this.#requireDocker([
      "run",
      "--detach",
      "--name",
      resources.wordpressContainer,
      "--runtime=runsc",
      "--network",
      resources.network,
      "--network-alias",
      "wordpress",
      "--security-opt=no-new-privileges",
      "--volume",
      `${resources.volume}:/var/www/html`,
      "--env",
      `WORDPRESS_DB_HOST=${resources.databaseAddress}`,
      "--env",
      "WORDPRESS_DB_NAME=wordpress",
      "--env",
      "WORDPRESS_DB_USER=root",
      "--env",
      `WORDPRESS_DB_PASSWORD=${databasePassword}`,
      this.#options.images.wordpress,
    ]);
    resources.wordpressCreated = true;
    resources.wordpressAddress = await this.#containerAddress(
      resources.wordpressContainer,
    );
    await this.#waitForWordPress(resources, databasePassword);
    await this.#wpCli(resources, databasePassword, [
      "core",
      "install",
      "--url=http://wordpress",
      "--title=Dynamic Reproduction Lab",
      "--admin_user=harness-admin",
      `--admin_password=${adminPassword}`,
      "--admin_email=harness-admin@example.invalid",
      "--skip-email",
    ]);
    // Companion plugins first: the Target is activated inside the ordinary
    // configuration it expects, never the other way round.
    for (const dependency of dependencies) {
      await this.#installPlugin(
        resources,
        databasePassword,
        dependency.sourceDirectory,
        dependency.pluginSlug,
      );
    }
    await this.#installPlugin(
      resources,
      databasePassword,
      sourceDirectory,
      pluginSlug,
    );
    if (ordinaryConfiguration !== undefined) {
      await this.#wpCli(resources, databasePassword, [
        "eval",
        ordinaryConfiguration,
      ]);
    }
  }

  async #installPlugin(
    resources: LabResources,
    databasePassword: string,
    sourceDirectory: string,
    pluginSlug: string,
  ): Promise<void> {
    await this.#requireDocker([
      "exec",
      resources.wordpressContainer,
      "mkdir",
      "-p",
      `/var/www/html/wp-content/plugins/${pluginSlug}`,
    ]);
    await this.#requireDocker([
      "cp",
      `${sourceDirectory}/.`,
      `${resources.wordpressContainer}:/var/www/html/wp-content/plugins/${pluginSlug}`,
    ]);
    await this.#requireDocker([
      "exec",
      resources.wordpressContainer,
      "chmod",
      "-R",
      "u=rwX,go=rX",
      `/var/www/html/wp-content/plugins/${pluginSlug}`,
    ]);
    await this.#activatePlugin(resources, databasePassword, pluginSlug);
  }

  async #activatePlugin(
    resources: LabResources,
    databasePassword: string,
    pluginSlug: string,
  ): Promise<void> {
    const conventional = await this.#docker(
      this.#wpCliArgs(resources, databasePassword, [
        "plugin",
        "activate",
        pluginSlug,
      ]),
    );
    if (conventional.exitCode === 0) return;
    await this.#wpCli(resources, databasePassword, [
      "plugin",
      "activate",
      `${pluginSlug}/index.php`,
    ]);
  }

  async #waitForWordPress(
    resources: LabResources,
    databasePassword: string,
  ): Promise<void> {
    for (let attempt = 0; attempt < this.#healthAttempts; attempt += 1) {
      const [database, wordpress] = await Promise.all([
        this.#docker(
          [
            "exec",
            resources.databaseContainer,
            "mariadb-admin",
            "ping",
            "--host=127.0.0.1",
            "--user=root",
            `--password=${databasePassword}`,
            "--silent",
          ],
          { timeoutMs: 10_000, maxOutputBytes: 64 * 1024 },
        ),
        this.#docker(
          [
            "exec",
            resources.wordpressContainer,
            "php",
            "-r",
            'exit(is_file("/var/www/html/wp-settings.php") ? 0 : 1);',
          ],
          { timeoutMs: 10_000, maxOutputBytes: 64 * 1024 },
        ),
      ]);
      if (database.exitCode === 0 && wordpress.exitCode === 0) return;
      if (attempt + 1 < this.#healthAttempts) {
        await new Promise<void>((resolve) => setTimeout(resolve, 1_000));
      }
    }
    throw new Error("gVisor WordPress lab did not become healthy");
  }

  #wpCliArgs(
    resources: LabResources,
    databasePassword: string,
    command: readonly string[],
  ): readonly string[] {
    if (resources.databaseAddress === null) {
      throw new Error("WordPress database address is unavailable");
    }
    return [
      "run",
      "--rm",
      "--runtime=runsc",
      "--network",
      resources.network,
      "--security-opt=no-new-privileges",
      "--env",
      `WORDPRESS_DB_HOST=${resources.databaseAddress}`,
      "--env",
      "WORDPRESS_DB_NAME=wordpress",
      "--env",
      "WORDPRESS_DB_USER=root",
      "--env",
      `WORDPRESS_DB_PASSWORD=${databasePassword}`,
      "--volume",
      `${resources.volume}:/var/www/html`,
      this.#options.images.wordpressCli,
      "wp",
      ...command,
      "--allow-root",
    ];
  }

  async #wpCli(
    resources: LabResources,
    databasePassword: string,
    command: readonly string[],
  ): Promise<void> {
    await this.#requireDocker(
      this.#wpCliArgs(resources, databasePassword, command),
    );
  }

  async #runWorker(
    resources: LabResources,
    sourceDirectory: string,
    evidenceDirectory: string,
    adminPassword: string,
    script: string,
    timeoutMs: number,
  ): Promise<ContainerProcessResult> {
    if (resources.wordpressAddress === null) {
      throw new Error("WordPress address is unavailable");
    }
    return this.#docker(
      [
        "run",
        "--rm",
        "--interactive",
        "--runtime=runsc",
        `--user=${this.#containerUser}`,
        "--network",
        resources.network,
        "--add-host",
        `wordpress:${resources.wordpressAddress}`,
        "--read-only",
        "--cap-drop=ALL",
        "--security-opt=no-new-privileges",
        "--pids-limit=512",
        "--memory=4g",
        "--cpus=2",
        "--tmpfs=/tmp:rw,noexec,nosuid,nodev,size=512m",
        "--volume",
        `${sourceDirectory}:/workspace/main:ro`,
        "--volume",
        `${evidenceDirectory}:/evidence:rw`,
        "--env=WORDPRESS_BASE_URL=http://wordpress",
        "--env=WORDPRESS_ADMIN_USER=harness-admin",
        `--env=WORDPRESS_ADMIN_PASSWORD=${adminPassword}`,
        "--workdir=/workspace",
        this.#options.images.worker,
        "node",
        "--input-type=module",
        "-",
      ],
      { stdin: script, timeoutMs, maxOutputBytes: 1024 * 1024 },
    );
  }

  async #cleanup(resources: LabResources): Promise<boolean> {
    const results: ContainerProcessResult[] = [];
    let observable = true;
    const containers = [
      ...(resources.databaseCreated ? [resources.databaseContainer] : []),
      ...(resources.wordpressCreated ? [resources.wordpressContainer] : []),
    ];
    if (containers.length > 0) {
      try {
        results.push(await this.#docker(["rm", "--force", ...containers]));
      } catch {
        observable = false;
      }
    }
    if (resources.volumeCreated) {
      try {
        results.push(
          await this.#docker(["volume", "rm", "--force", resources.volume]),
        );
      } catch {
        observable = false;
      }
    }
    if (resources.networkCreated) {
      try {
        results.push(await this.#docker(["network", "rm", resources.network]));
      } catch {
        observable = false;
      }
    }
    return observable && results.every((result) => result.exitCode === 0);
  }

  async #containerAddress(container: string): Promise<string> {
    const result = await this.#requireDocker(
      [
        "inspect",
        "--format",
        "{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}",
        container,
      ],
      { timeoutMs: 10_000, maxOutputBytes: 64 * 1024 },
    );
    return ipv4AddressSchema.parse(result.stdout.trim());
  }

  async #persistEvidence(
    privateEvidenceDirectory: string,
    evidenceDirectory: string,
    finding: SourceValidatedFinding,
    environmentId: string,
    runtimeProfileDigest: string,
    transcripts: readonly ExperimentTranscript[],
    outcome: DynamicReproductionAgentOutcome | undefined,
  ): Promise<AIReproductionRecord["privateEvidence"]> {
    const contents: Uint8Array[] = [];
    if (transcripts.length > 0) {
      contents.push(
        Buffer.from(
          encodeCanonicalJson(
            z.json().parse({
              kind: "dynamic-reproduction-transcript",
              schemaVersion: 1,
              findingId: finding.findingId,
              targetSnapshotDigest: finding.targetSnapshot.digest,
              runtimeProfileDigest,
              images: this.#options.images,
              environmentId,
              experiments: transcripts,
              outcome: outcome ?? null,
            }),
          ),
          "utf8",
        ),
      );
    }
    const entries = await readdir(evidenceDirectory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    if (entries.length > 31) {
      throw new Error("Dynamic Reproduction produced too many evidence files");
    }
    for (const entry of entries) {
      const path = join(evidenceDirectory, entry.name);
      const entryStat = await lstat(path);
      if (
        !entry.isFile() ||
        !entryStat.isFile() ||
        entryStat.isSymbolicLink() ||
        entryStat.nlink !== 1 ||
        entryStat.size > 5 * 1024 * 1024
      ) {
        throw new Error("Dynamic Reproduction evidence is not a bounded file");
      }
      contents.push(await readFile(path));
    }
    const refs = [];
    for (const [index, content] of contents.entries()) {
      const digest = await putPrivateEvidence(
        privateEvidenceDirectory,
        content,
      );
      refs.push({ id: `dynamic-evidence:${index + 1}`, digest });
    }
    return refs;
  }
}

export function openGvisorWordPressDynamicReproductionRuntime(
  options: GvisorWordPressDynamicReproductionOptions,
): DynamicReproductionRuntime {
  return new GvisorWordPressDynamicReproductionRuntime(options);
}
