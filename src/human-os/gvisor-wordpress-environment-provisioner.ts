import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { isAbsolute, join, relative, sep } from "node:path";

import { z } from "zod";

import {
  establishGvisorWordPressSession,
  type ContainerProcessRunner,
  type GvisorWordPressPluginSource,
  type GvisorWordPressSession,
} from "../infrastructure/gvisor-wordpress-session.js";
import { humanOsDigest } from "./canonical-json.js";
import type {
  EnvironmentSetupAttempt,
  HumanVerificationEnvironmentProvisioner,
  IsolationCapabilityInspection,
  ProvisionedEnvironmentHandle,
  ProvisionedSetupStageObservation,
} from "./human-verification-environment.js";
import type { HumanVerificationEnvironmentRequest } from "./human-verification-environment-contracts.js";

const sourceDirectorySchema = z
  .string()
  .min(1)
  .refine((value) => isAbsolute(value) && !value.includes("\0"), {
    message: "Target source directory must be absolute",
  });
const pluginSlugSchema = z.string().regex(/^[a-z0-9][a-z0-9-]*$/);
const digestSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const dockerRuntimesSchema = z.record(z.string(), z.unknown());

export interface HumanVerificationTargetSourceResolver {
  resolve(input: {
    readonly sourceArtifactDigest: string;
    readonly targetSnapshotDigest: string;
  }): Promise<{ readonly sourceDirectory: string }>;
}

export interface HumanVerificationSetupDependency {
  readonly pluginSlug: string;
  readonly sourceDirectory: string;
  readonly sourceTreeDigest: string;
}

export interface GvisorWordPressSetupBroker {
  resolve(request: HumanVerificationEnvironmentRequest): Promise<{
    readonly dependencies: readonly HumanVerificationSetupDependency[];
    configure(
      session: GvisorWordPressSession,
      request: HumanVerificationEnvironmentRequest,
    ): Promise<string>;
    functionalSmoke(
      session: GvisorWordPressSession,
      request: HumanVerificationEnvironmentRequest,
    ): Promise<string>;
  }>;
}

export interface GvisorWordPressAssistantBroker<Result> {
  run(
    session: GvisorWordPressSession,
    request: HumanVerificationEnvironmentRequest,
    role: "witness" | "control",
  ): Promise<Result>;
}

export interface OpenGvisorWordPressEnvironmentProvisionerOptions<Result> {
  readonly processRunner: ContainerProcessRunner;
  readonly readRunscVersion: () => Promise<string>;
  readonly targetSourceResolver: HumanVerificationTargetSourceResolver;
  readonly setupBroker: GvisorWordPressSetupBroker;
  readonly assistantBroker?: GvisorWordPressAssistantBroker<Result>;
}

export interface GvisorWordPressEnvironmentProvisioner<
  Result,
> extends HumanVerificationEnvironmentProvisioner {
  runAssistant(
    environmentId: string,
    role: "witness" | "control",
  ): Promise<Result>;
}

export interface HumanVerificationSourceTreeEntry {
  readonly path: string;
  readonly digest: string;
  readonly size: number;
}

function rawDigest(content: Buffer): string {
  return `sha256:${createHash("sha256").update(content).digest("hex")}`;
}

function compareText(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

async function sourceTreeEntries(
  root: string,
  directory = root,
): Promise<readonly HumanVerificationSourceTreeEntry[]> {
  const entries: HumanVerificationSourceTreeEntry[] = [];
  const children = await readdir(directory, { withFileTypes: true });
  children.sort((left, right) => compareText(left.name, right.name));
  for (const child of children) {
    const absolutePath = join(directory, child.name);
    if (child.isSymbolicLink())
      throw new Error("Target source contains a symlink");
    if (child.isDirectory()) {
      entries.push(...(await sourceTreeEntries(root, absolutePath)));
      continue;
    }
    if (!child.isFile())
      throw new Error("Target source contains a special file");
    const content = await readFile(absolutePath);
    entries.push({
      path: relative(root, absolutePath).split(sep).join("/"),
      digest: rawDigest(content),
      size: content.byteLength,
    });
  }
  return entries.sort((left, right) => compareText(left.path, right.path));
}

export function humanVerificationSourceTreeDigest(input: {
  readonly targetSnapshotDigest: string;
  readonly manifestDigest: string;
  readonly entries: readonly HumanVerificationSourceTreeEntry[];
}): string {
  return humanOsDigest({
    kind: "human-verification-target-source-tree",
    schemaVersion: 1,
    ...input,
  });
}

async function runDocker(
  runner: ContainerProcessRunner,
  args: readonly string[],
  timeoutMs = 60_000,
) {
  return runner.run({ executable: "docker", args, timeoutMs });
}

async function directoryIdentity(
  sourceDirectoryValue: string,
  input: {
    readonly targetSnapshotId: string;
    readonly targetSnapshotDigest: string;
  },
) {
  const sourceDirectory = sourceDirectorySchema.parse(sourceDirectoryValue);
  const entries = await sourceTreeEntries(sourceDirectory);
  const manifest = {
    kind: "target-file-manifest",
    schemaVersion: 1,
    targetSnapshot: {
      id: input.targetSnapshotId,
      digest: input.targetSnapshotDigest,
    },
    entries,
  } as const;
  return { sourceDirectory, entries, manifestDigest: humanOsDigest(manifest) };
}

class DefaultGvisorWordPressEnvironmentProvisioner<
  Result,
> implements GvisorWordPressEnvironmentProvisioner<Result> {
  readonly #options: OpenGvisorWordPressEnvironmentProvisionerOptions<Result>;
  readonly #sessions = new Map<
    string,
    {
      readonly session: GvisorWordPressSession;
      readonly request: HumanVerificationEnvironmentRequest;
    }
  >();

  constructor(
    options: OpenGvisorWordPressEnvironmentProvisionerOptions<Result>,
  ) {
    this.#options = options;
  }

  async inspectIsolation(
    request: HumanVerificationEnvironmentRequest,
  ): Promise<IsolationCapabilityInspection> {
    const [runtimes, runscVersion, ...images] = await Promise.all([
      runDocker(
        this.#options.processRunner,
        ["info", "--format", "{{json .Runtimes}}"],
        10_000,
      ),
      this.#options.readRunscVersion().catch(() => ""),
      ...Object.values(request.runtimeProfile.images).map((image) =>
        runDocker(this.#options.processRunner, ["image", "inspect", image]),
      ),
    ]);
    let hasRunsc = false;
    try {
      hasRunsc =
        runtimes.exitCode === 0 &&
        Object.hasOwn(
          dockerRuntimesSchema.parse(JSON.parse(runtimes.stdout)),
          "runsc",
        );
    } catch {
      hasRunsc = false;
    }
    const ready =
      hasRunsc &&
      runscVersion === request.runtimeProfile.isolation.runtimeVersion &&
      images.every((result) => result.exitCode === 0);
    return {
      status: ready ? "available" : "unavailable",
      observedBackend: hasRunsc ? "gvisor" : null,
      observedRuntimeName: hasRunsc ? "runsc" : null,
      observedRuntimeVersion: runscVersion === "" ? null : runscVersion,
      privileged: false,
      hostNetwork: false,
      engineSocketMounted: false,
      credentialBearingHostPathMounted: false,
      unauthorizedEgress: false,
      hostTargetExecution: false,
      fallbackUsed: false,
    };
  }

  async setup(
    request: HumanVerificationEnvironmentRequest,
  ): Promise<EnvironmentSetupAttempt> {
    const emptyStages: ProvisionedSetupStageObservation[] =
      request.setupPlan.stages.map((stage) => ({
        ordinal: stage.ordinal,
        stage: stage.stage,
        status: "not-run" as const,
        observationDigest: null,
      }));
    let target;
    let resolvedSetup;
    try {
      const resolvedTarget = await this.#options.targetSourceResolver.resolve({
        sourceArtifactDigest: request.target.sourceArtifact.digest,
        targetSnapshotDigest: request.target.snapshot.digest,
      });
      target = await directoryIdentity(resolvedTarget.sourceDirectory, {
        targetSnapshotId: request.target.snapshot.id,
        targetSnapshotDigest: request.target.snapshot.digest,
      });
      const sourceDigest = humanVerificationSourceTreeDigest({
        targetSnapshotDigest: request.target.snapshot.digest,
        manifestDigest: target.manifestDigest,
        entries: target.entries,
      });
      if (
        request.target.sourceArtifact.mediaType !==
          "application/vnd.wordpress.source-tree+json" ||
        target.manifestDigest !== request.target.manifest.digest ||
        sourceDigest !== request.target.sourceArtifact.digest
      ) {
        throw new Error("Target source identity mismatch");
      }
      resolvedSetup = await this.#options.setupBroker.resolve(request);
    } catch {
      return {
        status: "setup-blocked",
        phase: "setup",
        reason: "setup-failed",
        stages: emptyStages,
      };
    }

    const dependencySources: GvisorWordPressPluginSource[] = [];
    try {
      for (const dependency of resolvedSetup.dependencies) {
        const pluginSlug = pluginSlugSchema.parse(dependency.pluginSlug);
        const identity = await directoryIdentity(dependency.sourceDirectory, {
          targetSnapshotId: pluginSlug,
          targetSnapshotDigest: dependency.sourceTreeDigest,
        });
        const actualDigest = humanOsDigest({
          kind: "human-verification-dependency-source-tree",
          schemaVersion: 1,
          pluginSlug,
          entries: identity.entries,
        });
        if (actualDigest !== digestSchema.parse(dependency.sourceTreeDigest)) {
          throw new Error("Dependency source identity mismatch");
        }
        dependencySources.push({
          pluginSlug,
          sourceDirectory: identity.sourceDirectory,
        });
      }
    } catch {
      return {
        status: "setup-blocked",
        phase: "setup",
        reason: "setup-failed",
        stages: emptyStages,
      };
    }

    let session: GvisorWordPressSession;
    try {
      session = await establishGvisorWordPressSession({
        processRunner: this.#options.processRunner,
        images: {
          database: request.runtimeProfile.images.database,
          wordpress: request.runtimeProfile.images.wordpress,
          wordpressCli: request.runtimeProfile.images.wordpressCli,
        },
        plugins: [
          {
            pluginSlug: request.target.snapshot.pluginSlug,
            sourceDirectory: target.sourceDirectory,
          },
          ...dependencySources,
        ],
        canonicalConfiguration: {
          locale: request.setupPlan.configuration.locale,
          timezone: request.setupPlan.configuration.timezone,
        },
      });
    } catch {
      return {
        status: "setup-blocked",
        phase: "activation",
        reason: "activation-failed",
        stages: emptyStages,
      };
    }
    this.#sessions.set(session.labId, { session, request });
    const handle = { environmentId: session.labId };
    const stages = [...emptyStages];
    stages[0] = {
      ...stages[0]!,
      status: "completed",
      observationDigest: humanOsDigest({
        runtimeProfileDigest: request.runtimeProfile.digest,
        wordpressInstalled: true,
      }),
    };
    stages[1] = {
      ...stages[1]!,
      status: "completed",
      observationDigest: request.target.manifest.digest,
    };
    stages[2] = {
      ...stages[2]!,
      status: "completed",
      observationDigest: humanOsDigest({
        pluginSlug: request.target.snapshot.pluginSlug,
        active: true,
      }),
    };

    try {
      stages[3] = {
        ...stages[3]!,
        status: "completed",
        observationDigest: digestSchema.parse(
          await resolvedSetup.configure(session, request),
        ),
      };
    } catch {
      return {
        status: "setup-blocked",
        phase: "activation",
        reason: "activation-failed",
        partialEnvironment: handle,
        stages,
      };
    }
    try {
      stages[4] = {
        ...stages[4]!,
        status: "completed",
        observationDigest: digestSchema.parse(
          await resolvedSetup.functionalSmoke(session, request),
        ),
      };
      const runtime = await session.observeRuntime();
      const versionsMatch =
        runtime.wordpress.includes(request.runtimeProfile.wordpressVersion) &&
        runtime.php.includes(request.runtimeProfile.phpVersion) &&
        runtime.database.includes(request.runtimeProfile.databaseVersion) &&
        runtime.webServer.includes(request.runtimeProfile.webServerVersion);
      if (!versionsMatch) throw new Error("Runtime identity mismatch");
    } catch {
      return {
        status: "setup-blocked",
        phase: "health",
        reason: "health-failed",
        partialEnvironment: handle,
        stages,
      };
    }

    return {
      status: "ready",
      handle,
      stages,
      effectiveConfiguration: {
        pluginSlug: request.setupPlan.pluginSlug,
        siteMode: "single-site",
        locale: "en_US",
        timezone: "UTC",
        isolationBackend: "gvisor",
        privileged: false,
        hostNetwork: false,
        engineSocketMounted: false,
        credentialBearingHostPathMounted: false,
        egressDestinations: [],
        images: request.runtimeProfile.images,
      },
      targetRuntimeIdentity: {
        targetSnapshot: request.target.snapshot,
        manifest: request.target.manifest,
        sourceArtifactDigest: request.target.sourceArtifact.digest,
        observedWordpressVersion: request.runtimeProfile.wordpressVersion,
        observedPhpVersion: request.runtimeProfile.phpVersion,
        observedDatabaseVersion: request.runtimeProfile.databaseVersion,
        observedWebServerVersion: request.runtimeProfile.webServerVersion,
        observedImages: request.runtimeProfile.images,
      },
    };
  }

  async cleanup(
    environment: ProvisionedEnvironmentHandle,
  ): Promise<"completed" | "failed"> {
    const retained = this.#sessions.get(environment.environmentId);
    if (retained === undefined) return "completed";
    const cleaned = await retained.session.dispose().catch(() => false);
    if (cleaned) this.#sessions.delete(environment.environmentId);
    return cleaned ? "completed" : "failed";
  }

  async runAssistant(
    environmentId: string,
    role: "witness" | "control",
  ): Promise<Result> {
    const retained = this.#sessions.get(environmentId);
    if (retained === undefined) throw new Error("Environment is not active");
    if (this.#options.assistantBroker === undefined) {
      throw new Error("Human Verification Assistant is unavailable");
    }
    return this.#options.assistantBroker.run(
      retained.session,
      retained.request,
      role,
    );
  }
}

export function openGvisorWordPressEnvironmentProvisioner<Result = never>(
  options: OpenGvisorWordPressEnvironmentProvisionerOptions<Result>,
): GvisorWordPressEnvironmentProvisioner<Result> {
  return new DefaultGvisorWordPressEnvironmentProvisioner(options);
}
