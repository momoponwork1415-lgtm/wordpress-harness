import { createHash, randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { isAbsolute, relative, sep } from "node:path";

import { z } from "zod";

import type { JsonArtifactStore } from "../research-record/contracts.js";
import {
  canonicalJson,
  sha256Digest,
} from "../research-record/canonical-json.js";
import { targetFileManifestSchema } from "../source-mapping/contracts.js";
import {
  LabControlBlockedError,
  experimentObservationRefSchema,
  experimentObservationSchema,
  experimentPlanSchema,
  type ExperimentObservationRef,
  type ExperimentPlan,
  type LabControl,
} from "./contracts.js";

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

export interface OpenGvisorStoredXssLabControlOptions {
  readonly artifactStore: JsonArtifactStore;
  readonly processRunner: LabProcessRunner;
  readonly definitionFile?: string;
}

const dockerRuntimesSchema = z.record(z.string(), z.unknown());
const absolutePathSchema = z
  .string()
  .min(1)
  .refine((path) => isAbsolute(path) && !path.includes("\0"), {
    message: "Lab private paths must be absolute",
  });
const pinnedImageSchema = z
  .string()
  .regex(/^[A-Za-z0-9._:/-]+@sha256:[a-f0-9]{64}$/);
const pluginSlugSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[a-z0-9][a-z0-9-]*$/);

const storedXssLabDefinitionSchema = z.strictObject({
  kind: z.literal("stored-xss-lab-definition"),
  schemaVersion: z.literal(1),
  bindings: experimentPlanSchema.shape.bindings,
  images: z.strictObject({
    database: pinnedImageSchema,
    wordpress: pinnedImageSchema,
    wordpressCli: pinnedImageSchema,
    browser: pinnedImageSchema,
  }),
  target: z.strictObject({
    sourceDirectory: absolutePathSchema,
    pluginSlug: pluginSlugSchema,
    manifestFile: absolutePathSchema,
  }),
  fixture: z.strictObject({
    sourceDirectory: absolutePathSchema,
    pluginSlug: pluginSlugSchema,
  }),
  browser: z.strictObject({
    workerFile: absolutePathSchema,
    inputFile: absolutePathSchema,
  }),
});

const storedXssBrowserResultSchema = z.strictObject({
  kind: z.literal("stored-xss-browser-result"),
  schemaVersion: z.literal(1),
  normalFunction: z.enum(["preserved", "broken", "unknown"]),
  attackerRequestAccepted: z.boolean(),
  persistentStateObserved: z.boolean(),
  browserCanaryExecuted: z.boolean(),
});

type StoredXssLabDefinition = z.infer<typeof storedXssLabDefinitionSchema>;

interface DirectoryManifestEntry {
  readonly path: string;
  readonly digest: string;
  readonly size: number;
}

function rawDigest(content: Buffer): string {
  return `sha256:${createHash("sha256").update(content).digest("hex")}`;
}

async function directoryManifest(
  root: string,
  directory = root,
): Promise<readonly DirectoryManifestEntry[]> {
  const entries: DirectoryManifestEntry[] = [];
  const children = await readdir(directory, { withFileTypes: true });
  children.sort((left, right) => left.name.localeCompare(right.name));
  for (const child of children) {
    const absolutePath = `${directory}/${child.name}`;
    if (child.isSymbolicLink()) {
      throw new Error("Lab fixture must not contain symbolic links");
    }
    if (child.isDirectory()) {
      entries.push(...(await directoryManifest(root, absolutePath)));
      continue;
    }
    if (!child.isFile()) {
      throw new Error("Lab fixture must contain only regular files");
    }
    const content = await readFile(absolutePath);
    entries.push({
      path: relative(root, absolutePath).split(sep).join("/"),
      digest: rawDigest(content),
      size: content.byteLength,
    });
  }
  return entries;
}

class LabCommandFailedError extends Error {
  constructor() {
    super("A required Lab command failed");
    this.name = "LabCommandFailedError";
  }
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

class GvisorStoredXssLabControl implements LabControl {
  readonly #options: OpenGvisorStoredXssLabControlOptions;

  constructor(options: OpenGvisorStoredXssLabControlOptions) {
    this.#options = options;
  }

  async #run(
    args: readonly string[],
    timeoutMs = 60_000,
  ): Promise<LabProcessResult> {
    return this.#options.processRunner.run({
      executable: "docker",
      args,
      timeoutMs,
    });
  }

  async #require(args: readonly string[], timeoutMs = 60_000): Promise<string> {
    const result = await this.#run(args, timeoutMs);
    if (result.exitCode !== 0) throw new LabCommandFailedError();
    return result.stdout;
  }

  async #loadDefinition(
    plan: ExperimentPlan,
  ): Promise<{ value: StoredXssLabDefinition; path: string }> {
    const path = this.#options.definitionFile;
    if (path === undefined) {
      throw new LabControlBlockedError("unsupported-experiment");
    }
    const value = storedXssLabDefinitionSchema.parse(
      JSON.parse(await readFile(path, "utf8")),
    );
    if (canonicalJson(value.bindings) !== canonicalJson(plan.bindings)) {
      throw new Error("Stored XSS Lab definition binding mismatch");
    }
    const runtimeProfileDigest = sha256Digest({
      kind: "gvisor-wordpress-runtime-profile",
      schemaVersion: 1,
      runtime: "runsc-systrap",
      images: value.images,
    });
    if (runtimeProfileDigest !== plan.bindings.runtimeProfileDigest) {
      throw new Error("Stored XSS Lab runtime profile binding mismatch");
    }
    const setupPlanDigest = sha256Digest({
      kind: "stored-xss-setup-plan",
      schemaVersion: 1,
      operations: [
        "install-wordpress",
        "activate-target",
        "activate-reviewed-fixture",
      ],
    });
    if (setupPlanDigest !== plan.bindings.setupPlanDigest) {
      throw new Error("Stored XSS Lab setup plan binding mismatch");
    }
    const fixtureManifestDigest = sha256Digest({
      kind: "trusted-fixture-manifest",
      schemaVersion: 1,
      entries: await directoryManifest(value.fixture.sourceDirectory),
    });
    const targetManifest = targetFileManifestSchema.parse(
      JSON.parse(await readFile(value.target.manifestFile, "utf8")),
    );
    const actualTargetEntries = await directoryManifest(
      value.target.sourceDirectory,
    );
    if (
      targetManifest.targetSnapshot.digest !==
        plan.bindings.targetSnapshotDigest ||
      canonicalJson(targetManifest.entries) !==
        canonicalJson(actualTargetEntries)
    ) {
      throw new Error("Stored XSS Lab Target source binding mismatch");
    }
    const targetManifestDigest = sha256Digest(targetManifest);
    const configurationDigest = sha256Digest({
      kind: "stored-xss-lab-configuration",
      schemaVersion: 1,
      targetPluginSlug: value.target.pluginSlug,
      targetManifestDigest,
      fixturePluginSlug: value.fixture.pluginSlug,
      fixtureManifestDigest,
      browserWorkerDigest: rawDigest(await readFile(value.browser.workerFile)),
      browserInputDigest: rawDigest(await readFile(value.browser.inputFile)),
    });
    if (configurationDigest !== plan.bindings.configurationDigest) {
      throw new Error("Stored XSS Lab configuration binding mismatch");
    }
    const labBaselineDigest = sha256Digest({
      kind: "lab-baseline-definition",
      schemaVersion: 1,
      targetSnapshotDigest: plan.bindings.targetSnapshotDigest,
      runtimeProfileDigest,
      setupPlanDigest,
      configurationDigest,
    });
    if (labBaselineDigest !== plan.bindings.labBaselineDigest) {
      throw new Error("Stored XSS Lab baseline binding mismatch");
    }
    return { value, path };
  }

  #wpCliArgs(
    definition: StoredXssLabDefinition,
    network: string,
    volume: string,
    command: readonly string[],
  ): readonly string[] {
    return [
      "run",
      "--rm",
      "--runtime=runsc",
      "--network",
      network,
      "--volume",
      `${volume}:/var/www/html`,
      definition.images.wordpressCli,
      ...command,
      "--allow-root",
    ];
  }

  async #waitForWordPress(
    definition: StoredXssLabDefinition,
    network: string,
    volume: string,
  ): Promise<void> {
    for (let attempt = 0; attempt < 60; attempt += 1) {
      const result = await this.#run(
        this.#wpCliArgs(definition, network, volume, ["db", "check"]),
        15_000,
      );
      if (result.exitCode === 0) return;
      await new Promise<void>((resolve) => setTimeout(resolve, 1_000));
    }
    throw new LabCommandFailedError();
  }

  async #cleanup(
    databaseContainer: string,
    wordpressContainer: string,
    volume: string,
    network: string,
  ): Promise<boolean> {
    const containers = await this.#run([
      "rm",
      "--force",
      databaseContainer,
      wordpressContainer,
    ]);
    const resources = await Promise.all([
      this.#run(["volume", "rm", "--force", volume]),
      this.#run(["network", "rm", network]),
    ]);
    return (
      containers.exitCode === 0 &&
      resources.every((result) => result.exitCode === 0)
    );
  }

  async #hasAllPinnedImages(
    definition: StoredXssLabDefinition,
  ): Promise<boolean> {
    const results = await Promise.all(
      Object.values(definition.images).map((image) =>
        this.#run(["image", "inspect", image]),
      ),
    );
    return results.every((result) => result.exitCode === 0);
  }

  async #executeFreshLab(
    plan: ExperimentPlan,
    definition: StoredXssLabDefinition,
    definitionFile: string,
  ): Promise<{
    readonly labId: string;
    readonly result: z.infer<typeof storedXssBrowserResultSchema>;
  }> {
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
    let browserResult: z.infer<typeof storedXssBrowserResultSchema> | undefined;

    try {
      await this.#require([
        "network",
        "create",
        "--internal",
        "--label",
        "org.wordpress-harness.resource=verification-lab",
        network,
      ]);
      await this.#require([
        "volume",
        "create",
        "--label",
        "org.wordpress-harness.resource=verification-lab",
        volume,
      ]);
      await this.#require([
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
        definition.images.database,
      ]);
      await this.#require([
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
        "WORDPRESS_DB_HOST=database",
        "--env",
        "WORDPRESS_DB_NAME=wordpress",
        "--env",
        "WORDPRESS_DB_USER=root",
        "--env",
        `WORDPRESS_DB_PASSWORD=${databasePassword}`,
        definition.images.wordpress,
      ]);
      await this.#waitForWordPress(definition, network, volume);
      await this.#require(
        this.#wpCliArgs(definition, network, volume, [
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
      await this.#require([
        "exec",
        wordpressContainer,
        "mkdir",
        "-p",
        `/var/www/html/wp-content/plugins/${definition.target.pluginSlug}`,
        `/var/www/html/wp-content/plugins/${definition.fixture.pluginSlug}`,
      ]);
      await this.#require([
        "cp",
        `${definition.target.sourceDirectory}/.`,
        `${wordpressContainer}:/var/www/html/wp-content/plugins/${definition.target.pluginSlug}`,
      ]);
      await this.#require([
        "cp",
        `${definition.fixture.sourceDirectory}/.`,
        `${wordpressContainer}:/var/www/html/wp-content/plugins/${definition.fixture.pluginSlug}`,
      ]);
      await this.#require(
        this.#wpCliArgs(definition, network, volume, [
          "plugin",
          "activate",
          definition.target.pluginSlug,
        ]),
      );
      await this.#require(
        this.#wpCliArgs(definition, network, volume, [
          "plugin",
          "activate",
          definition.fixture.pluginSlug,
        ]),
      );
      const stdout = await this.#require(
        [
          "run",
          "--rm",
          "--runtime=runsc",
          "--network",
          network,
          "--shm-size=1g",
          "--volume",
          `${definition.browser.workerFile}:/harness/browser-worker.mjs:ro`,
          "--volume",
          `${definitionFile}:/harness/experiment.private.json:ro`,
          "--volume",
          `${definition.browser.inputFile}:/harness/browser-input.private.json:ro`,
          "--env",
          `HARNESS_ROLE=${plan.role}`,
          "--env",
          `HARNESS_CAUSAL_FACTOR_STATE=${plan.mechanism.causalFactorState}`,
          "--env",
          "WORDPRESS_BASE_URL=http://wordpress",
          "--env",
          "WORDPRESS_ADMIN_USER=harness-admin",
          "--env",
          `WORDPRESS_ADMIN_PASSWORD=${adminPassword}`,
          definition.images.browser,
          "node",
          "/harness/browser-worker.mjs",
        ],
        120_000,
      );
      browserResult = storedXssBrowserResultSchema.parse(JSON.parse(stdout));
    } catch (error) {
      executionError = error;
    }

    const cleaned = await this.#cleanup(
      databaseContainer,
      wordpressContainer,
      volume,
      network,
    );
    if (executionError !== undefined) throw executionError;
    if (!cleaned || browserResult === undefined) {
      throw new LabCommandFailedError();
    }
    return { labId, result: browserResult };
  }

  async execute(value: ExperimentPlan): Promise<ExperimentObservationRef> {
    const plan = experimentPlanSchema.parse(value);
    const runtimes = await this.#options.processRunner.run({
      executable: "docker",
      args: ["info", "--format", "{{json .Runtimes}}"],
      timeoutMs: 10_000,
    });
    if (!reportsRunscRuntime(runtimes)) {
      throw new LabControlBlockedError("gvisor-unavailable");
    }

    const definition = await this.#loadDefinition(plan);
    if (!(await this.#hasAllPinnedImages(definition.value))) {
      throw new LabControlBlockedError("baseline-unavailable");
    }
    let execution;
    try {
      execution = await this.#executeFreshLab(
        plan,
        definition.value,
        definition.path,
      );
    } catch (error) {
      if (error instanceof LabControlBlockedError) throw error;
      throw new LabControlBlockedError("experiment-failed");
    }

    const observation = experimentObservationSchema.parse({
      kind: "experiment-observation",
      schemaVersion: 1,
      experimentId: plan.experimentId,
      verificationId: plan.verificationId,
      role: plan.role,
      hypothesisDigest: plan.hypothesisDigest,
      bindings: plan.bindings,
      isolation: {
        runtime: "gvisor",
        runtimeDigest: plan.bindings.runtimeProfileDigest,
        siblingGroupId: plan.siblingGroupId,
        labId: execution.labId,
        fresh: true,
        fallbackUsed: false,
      },
      causalFactor: {
        id: plan.mechanism.causalFactor,
        state: plan.mechanism.causalFactorState,
      },
      normalFunction: execution.result.normalFunction,
      result: {
        kind: "stored-xss-browser",
        schemaVersion: 1,
        attackerRequestAccepted: execution.result.attackerRequestAccepted,
        persistentStateObserved: execution.result.persistentStateObserved,
        browserCanaryExecuted: execution.result.browserCanaryExecuted,
      },
      artifactRefs: [],
    });
    const observationDigest =
      await this.#options.artifactStore.putJson(observation);
    return experimentObservationRefSchema.parse({
      kind: "experiment-observation",
      schemaVersion: 1,
      experimentId: plan.experimentId,
      digest: observationDigest,
    });
  }
}

export function openGvisorStoredXssLabControl(
  options: OpenGvisorStoredXssLabControlOptions,
): LabControl {
  return new GvisorStoredXssLabControl(options);
}
