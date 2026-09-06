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
import type {
  FindingVerificationEnvironmentRequest,
  HumanVerificationEnvironmentRequest,
  VerificationEnvironmentRequest,
} from "./human-verification-environment-contracts.js";
import {
  findingVerificationEnvironmentRequestSchema,
  humanVerificationEnvironmentRequestSchema,
} from "./human-verification-environment-contracts.js";
import {
  findingAIReproductionAttemptSchema,
  type FindingAIReproductionAttempt,
} from "./ai-reproduction-contracts.js";
import type { FindingAIReproductionHarnessExecution } from "./ai-reproduction-contracts.js";

const sourceDirectorySchema = z
  .string()
  .min(1)
  .refine((value) => isAbsolute(value) && !value.includes("\0"), {
    message: "Target source directory must be absolute",
  });
const pluginSlugSchema = z.string().regex(/^[a-z0-9][a-z0-9-]*$/);
const digestSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const dockerRuntimesSchema = z.record(z.string(), z.unknown());
const boundedWordPressPathSchema = z
  .string()
  .min(1)
  .max(8_192)
  .refine(
    (value) =>
      value.startsWith("/") &&
      !value.startsWith("//") &&
      !/[\\\u0000-\u001f\u007f]/u.test(value),
    "Experiment paths must be relative to the isolated WordPress origin",
  );

export const gvisorAIReproductionHttpExchangeSchema = z
  .strictObject({
    kind: z.literal("gvisor-ai-reproduction-http-exchange"),
    schemaVersion: z.literal(1),
    method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"]),
    path: boundedWordPressPathSchema,
    mediaType: z
      .enum([
        "text/plain",
        "application/json",
        "application/x-www-form-urlencoded",
        "multipart/form-data",
      ])
      .nullable(),
    body: z.string().max(64_000).nullable(),
  })
  .superRefine((exchange, context) => {
    if (
      (exchange.method === "GET" || exchange.method === "HEAD") &&
      (exchange.mediaType !== null || exchange.body !== null)
    ) {
      context.addIssue({
        code: "custom",
        message: "GET and HEAD experiments cannot carry a request body",
      });
    }
  });

export const gvisorAIReproductionHttpObservationSchema = z.strictObject({
  kind: z.literal("gvisor-ai-reproduction-http-observation"),
  schemaVersion: z.literal(1),
  status: z.number().int().min(100).max(599),
  mediaType: z.string().min(1).max(256).nullable(),
  body: z.string().max(1_000_000),
});

export type GvisorAIReproductionHttpExchange = z.infer<
  typeof gvisorAIReproductionHttpExchangeSchema
>;
export type GvisorAIReproductionHttpObservation = z.infer<
  typeof gvisorAIReproductionHttpObservationSchema
>;

/**
 * The only live-Lab capability exposed to an AI Reproduction broker.
 * It cannot select a host, image, command, environment variable, or mount.
 */
export interface GvisorAIReproductionExperiment {
  readonly environmentId: string;
  exchange(
    input: GvisorAIReproductionHttpExchange,
  ): Promise<GvisorAIReproductionHttpObservation>;
}

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
  resolve(request: VerificationEnvironmentRequest): Promise<{
    readonly dependencies: readonly HumanVerificationSetupDependency[];
    configure(
      session: GvisorWordPressSession,
      request: VerificationEnvironmentRequest,
    ): Promise<string>;
    functionalSmoke(
      session: GvisorWordPressSession,
      request: VerificationEnvironmentRequest,
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

type WithoutHarnessFields<T> = T extends unknown
  ? Omit<T, "kind" | "schemaVersion" | "completedAt" | "cleanup">
  : never;

export type GvisorAIReproductionExperimentResult = WithoutHarnessFields<
  Exclude<
    FindingAIReproductionHarnessExecution,
    { readonly status: "setup-blocked" }
  >
>;

export interface GvisorAIReproductionBroker {
  run(
    experiment: GvisorAIReproductionExperiment,
    request: FindingVerificationEnvironmentRequest,
    attempt: FindingAIReproductionAttempt,
  ): Promise<GvisorAIReproductionExperimentResult>;
}

export interface OpenGvisorWordPressEnvironmentProvisionerOptions<Result> {
  readonly processRunner: ContainerProcessRunner;
  readonly readRunscVersion: () => Promise<string>;
  readonly targetSourceResolver: HumanVerificationTargetSourceResolver;
  readonly setupBroker: GvisorWordPressSetupBroker;
  readonly assistantBroker?: GvisorWordPressAssistantBroker<Result>;
  readonly aiReproductionBroker?: GvisorAIReproductionBroker;
}

export interface GvisorWordPressEnvironmentProvisioner<
  Result,
> extends HumanVerificationEnvironmentProvisioner {
  hasActiveEnvironment(environmentId: string): boolean;
  runExperiment(
    environmentId: string,
    attempt: FindingAIReproductionAttempt,
  ): Promise<GvisorAIReproductionExperimentResult>;
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

const boundedHttpExchangeWorker = String.raw`
const exchange = JSON.parse(Buffer.from(process.argv[1], "base64url").toString("utf8"));
const target = new URL(exchange.path, "http://wordpress");
if (target.origin !== "http://wordpress") throw new Error("foreign WordPress origin");
const response = await fetch(target, {
  method: exchange.method,
  headers: exchange.mediaType === null ? undefined : { "content-type": exchange.mediaType },
  body: exchange.body === null ? undefined : exchange.body,
  redirect: "manual",
});
const body = await response.text();
if (new TextEncoder().encode(body).byteLength > 1000000) {
  throw new Error("HTTP observation is too large");
}
process.stdout.write(JSON.stringify({
  kind: "gvisor-ai-reproduction-http-observation",
  schemaVersion: 1,
  status: response.status,
  mediaType: response.headers.get("content-type"),
  body,
}));
`;

function boundedAIReproductionExperiment(input: {
  readonly session: GvisorWordPressSession;
  readonly browserImage: string;
}): GvisorAIReproductionExperiment {
  return Object.freeze({
    environmentId: input.session.labId,
    exchange: async (
      exchangeValue: GvisorAIReproductionHttpExchange,
    ): Promise<GvisorAIReproductionHttpObservation> => {
      const exchange =
        gvisorAIReproductionHttpExchangeSchema.parse(exchangeValue);
      const encoded = Buffer.from(JSON.stringify(exchange), "utf8").toString(
        "base64url",
      );
      const output = await input.session.runWorker({
        image: input.browserImage,
        mounts: [],
        environment: [],
        command: [
          "node",
          "--input-type=module",
          "--eval",
          boundedHttpExchangeWorker,
          encoded,
        ],
        timeoutMs: 30_000,
      });
      return gvisorAIReproductionHttpObservationSchema.parse(
        JSON.parse(output) as unknown,
      );
    },
  });
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
      readonly request: VerificationEnvironmentRequest;
    }
  >();

  constructor(
    options: OpenGvisorWordPressEnvironmentProvisionerOptions<Result>,
  ) {
    this.#options = options;
  }

  async inspectIsolation(
    request: VerificationEnvironmentRequest,
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
    request: VerificationEnvironmentRequest,
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
    const request = humanVerificationEnvironmentRequestSchema.parse(
      retained.request,
    );
    if (this.#options.assistantBroker === undefined) {
      throw new Error("Human Verification Assistant is unavailable");
    }
    return this.#options.assistantBroker.run(retained.session, request, role);
  }

  hasActiveEnvironment(environmentId: string): boolean {
    return this.#sessions.has(environmentId);
  }

  async runExperiment(
    environmentId: string,
    attemptValue: FindingAIReproductionAttempt,
  ): Promise<GvisorAIReproductionExperimentResult> {
    const retained = this.#sessions.get(environmentId);
    if (retained === undefined) throw new Error("Environment is not active");
    const request = findingVerificationEnvironmentRequestSchema.parse(
      retained.request,
    );
    const attempt = findingAIReproductionAttemptSchema.parse(attemptValue);
    if (
      retained.session.labId !== environmentId ||
      request.finding.id !== attempt.finding.id ||
      humanOsDigest(request.finding) !== attempt.finding.digest ||
      request.target.snapshot.digest !== attempt.target.snapshot.digest ||
      request.target.manifest.digest !== attempt.target.manifest.digest ||
      request.runtimeProfile.digest !== attempt.runtimeProfile.digest ||
      request.setupPlan.digest !== attempt.setupPlan.digest ||
      request.policy.digest !== attempt.environmentPolicy.digest ||
      humanOsDigest(request.grants) !== humanOsDigest(attempt.grants)
    ) {
      throw new Error("AI Reproduction Attempt does not own the live session");
    }
    if (this.#options.aiReproductionBroker === undefined) {
      throw new Error("AI Reproduction broker is unavailable");
    }
    return this.#options.aiReproductionBroker.run(
      boundedAIReproductionExperiment({
        session: retained.session,
        browserImage: request.runtimeProfile.images.browser,
      }),
      request,
      attempt,
    );
  }
}

export function openGvisorWordPressEnvironmentProvisioner<Result = never>(
  options: OpenGvisorWordPressEnvironmentProvisionerOptions<Result>,
): GvisorWordPressEnvironmentProvisioner<Result> {
  return new DefaultGvisorWordPressEnvironmentProvisioner(options);
}
