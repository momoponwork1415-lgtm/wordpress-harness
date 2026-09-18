import { mkdtemp, realpath, rm, stat, writeFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";

import { z } from "zod";

import { verifyCanonicalSourceTree } from "../../infrastructure/canonical-source-tree.js";
import { canonicalDigest } from "../../infrastructure/canonical-json.js";
import {
  runNativeModelProcess,
  type NativeModelProcessResult,
} from "../../infrastructure/native-model-process.js";
import { promptTextDigest } from "../../infrastructure/prompt-text.js";
import {
  dependencySnapshotRefSchema,
  type AgentCheckpointRef,
  type AgentRunDiagnosticRef,
  type AgentRunFailureStage,
  type DependencySnapshotRef,
  type NativeRunReceipt,
  type ResearchReport,
  type SealedNativeRun,
} from "./contracts.js";
import { materializeResearchReport } from "./provider-research-report.js";
import {
  ProviderCredentialFiles,
  providerFileNameSchema,
} from "./provider-files.js";
import { preserveAgentRunDiagnostic } from "./agent-run-diagnostics.js";
import { agentResearchPrompt } from "./agent-prompts.js";
import {
  prepareResearchState,
  finalizeResearchState,
  type ResearchWorkingState,
} from "./research-checkpoints.js";

export { agentResearchPrompt } from "./agent-prompts.js";

const digestSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const pinnedImageSchema = z
  .string()
  .regex(/^(?:sha256:[a-f0-9]{64}|[^\s@]+@sha256:[a-f0-9]{64})$/);
const dockerRuntimesSchema = z.record(z.string(), z.unknown());
export interface GvisorAgentRuntimeOptions {
  readonly dockerExecutablePath: string;
  readonly image: string;
  readonly sourceDirectory: string;
  readonly targetSnapshotDigest: string;
  readonly sourceTree: {
    readonly digest: string;
    readonly entries: number;
    readonly bytes: number;
  };
  readonly dependencySources?: readonly {
    readonly snapshot: DependencySnapshotRef;
    readonly sourceDirectory: string;
  }[];
  readonly providerConfigDirectory: string;
  readonly scratchRootDirectory: string;
  readonly candidateRecipeDirectory?: string;
  readonly promptSet: {
    readonly digest: string;
    readonly text: string;
  };
  readonly permissionProfileDigest: string;
  readonly maxOutputBytes: number;
  readonly clock?: () => Date;
}

export interface SandboxedAgentCommand {
  readonly executable: string;
  readonly versionTokenIndex: number;
  readonly providerEnvironment: readonly string[];
  readonly supportFiles?: readonly {
    readonly filename: string;
    readonly text: string;
    readonly containerMountPath?: string;
  }[];
  readonly ephemeralProviderCredentialFiles?: readonly string[];
  readonly ephemeralProviderHomeMount?: {
    readonly path: string;
    readonly mode: "ro" | "rw";
  };
  readonly args: readonly string[];
  readonly researchSession?: {
    readonly newSessionArguments: (sessionId: string) => readonly string[];
    readonly resumeSessionArguments: (sessionId: string) => readonly string[];
    readonly generatedSessionIdFromOutput?: (
      stdout: string,
    ) => string | undefined;
  };
  readonly prompt:
    | { readonly kind: "stdin"; readonly text: string }
    | { readonly kind: "file"; readonly text: string };
}

type FailedReceipt = Exclude<
  NativeRunReceipt,
  { readonly terminal: "completed" }
>;

export type SandboxedAgentResult =
  | {
      readonly status: "completed";
      readonly stdout: string;
      readonly startedAt: Date;
      readonly completedAt: Date;
      readonly checkpoint?: AgentCheckpointRef;
      readonly diagnostic?: AgentRunDiagnosticRef;
      readonly preserveDiagnostic: PreserveAdapterDiagnostic;
    }
  | {
      readonly status: "exited-nonzero";
      readonly stdout: string;
      readonly startedAt: Date;
      readonly completedAt: Date;
      readonly checkpoint?: AgentCheckpointRef;
      readonly diagnostic?: AgentRunDiagnosticRef;
      readonly failureStage: AgentRunFailureStage;
      readonly preserveDiagnostic: PreserveAdapterDiagnostic;
    }
  | { readonly status: "failed"; readonly receipt: FailedReceipt };

/**
 * Preserves the credential-redacted provider output of an otherwise clean run
 * that the Runtime Adapter refused, so a policy denial or an unsupported
 * output keeps private evidence instead of discarding it.
 */
export type PreserveAdapterDiagnostic = (
  reason: string,
) => Promise<AgentRunDiagnosticRef | undefined>;

function processEnvironment(): NodeJS.ProcessEnv {
  const path = process.env.PATH;
  if (path === undefined) throw new Error("Agent Runtime requires PATH");
  return { PATH: path, LANG: "C", LC_ALL: "C", TZ: "UTC" };
}

function nonRootHostUser(): string {
  if (
    typeof process.getuid !== "function" ||
    typeof process.getgid !== "function"
  ) {
    throw new Error("Agent Runtime requires a POSIX host user");
  }
  const uid = process.getuid();
  const gid = process.getgid();
  if (uid <= 0 || gid <= 0) {
    throw new Error("Agent Runtime requires a non-root host user");
  }
  return `${uid}:${gid}`;
}

async function directory(path: string, name: string): Promise<string> {
  if (!isAbsolute(path) || path.includes("\0") || path.includes(":")) {
    throw new Error(`${name} must be an absolute container-mountable path`);
  }
  const resolved = await realpath(path);
  if (!(await stat(resolved)).isDirectory()) {
    throw new Error(`${name} must be a directory`);
  }
  return resolved;
}

export function failedNativeRunReceipt(
  run: SealedNativeRun,
  terminal: FailedReceipt["terminal"],
  summary: string,
  startedAt: Date,
  completedAt: Date,
  isolated: boolean,
  checkpoint?: AgentCheckpointRef,
  diagnostic?: AgentRunDiagnosticRef,
  stage: AgentRunFailureStage = "runtime-adapter",
  retryable = false,
): FailedReceipt {
  return {
    schemaVersion: 2,
    runId: run.runId,
    runtimeProfileDigest: run.agentRuntimeProfile.digest,
    terminal,
    startedAt: startedAt.toISOString(),
    completedAt: completedAt.toISOString(),
    usage: {
      wallTimeMs: Math.max(0, completedAt.getTime() - startedAt.getTime()),
    },
    activity: { subagents: null, tools: null },
    ...(isolated
      ? {
          isolation: {
            backend: "gvisor" as const,
            runtime: "runsc" as const,
            fallbackUsed: false as const,
          },
        }
      : {}),
    ...(checkpoint === undefined ? {} : { checkpoint }),
    failure: {
      summary,
      stage,
      ...(retryable ? { retryable: true as const } : {}),
      ...(diagnostic === undefined ? {} : { diagnostic }),
    },
  };
}

export async function refusedNativeRunReceipt(
  run: SealedNativeRun,
  execution: Extract<SandboxedAgentResult, { status: "completed" }>,
  terminal: "policy-denied" | "invalid-output",
  summary: string,
  checkpoint: AgentCheckpointRef | undefined,
  startedAt: Date = execution.startedAt,
): Promise<FailedReceipt> {
  const diagnostic = await execution.preserveDiagnostic(summary);
  if (diagnostic === undefined) {
    return failedNativeRunReceipt(
      run,
      "provider-failed",
      "The Runtime Adapter refused provider output, but its private diagnostic could not be preserved.",
      startedAt,
      execution.completedAt,
      true,
      checkpoint,
    );
  }
  return failedNativeRunReceipt(
    run,
    terminal,
    summary,
    startedAt,
    execution.completedAt,
    true,
    checkpoint,
    diagnostic,
  );
}

export class GvisorAgentSandbox {
  readonly #options: GvisorAgentRuntimeOptions;
  readonly #clock: () => Date;
  readonly #containerUser: string;

  constructor(options: GvisorAgentRuntimeOptions) {
    if (!isAbsolute(options.dockerExecutablePath)) {
      throw new Error("Docker executable path must be absolute");
    }
    pinnedImageSchema.parse(options.image);
    digestSchema.parse(options.targetSnapshotDigest);
    digestSchema.parse(options.sourceTree.digest);
    for (const dependency of options.dependencySources ?? []) {
      dependencySnapshotRefSchema.parse(dependency.snapshot);
    }
    const dependencyMounts = new Set(
      (options.dependencySources ?? []).map(
        (dependency) => dependency.snapshot.mountName,
      ),
    );
    if (dependencyMounts.size !== (options.dependencySources ?? []).length) {
      throw new Error("Dependency source mount names must be unique");
    }
    if (
      !Number.isSafeInteger(options.sourceTree.entries) ||
      options.sourceTree.entries <= 0
    ) {
      throw new Error("Source tree entry count must be a positive integer");
    }
    if (
      !Number.isSafeInteger(options.sourceTree.bytes) ||
      options.sourceTree.bytes < 0
    ) {
      throw new Error("Source tree byte count must be a non-negative integer");
    }
    digestSchema.parse(options.promptSet.digest);
    digestSchema.parse(options.permissionProfileDigest);
    if (options.promptSet.text.length === 0) {
      throw new Error("Agent Runtime prompt must not be empty");
    }
    if (promptTextDigest(options.promptSet.text) !== options.promptSet.digest) {
      throw new Error("Research prompt text does not match its sealed digest");
    }
    if (
      !Number.isSafeInteger(options.maxOutputBytes) ||
      options.maxOutputBytes <= 0
    ) {
      throw new Error("Agent Runtime output limit must be a positive integer");
    }
    if (
      options.candidateRecipeDirectory !== undefined &&
      !isAbsolute(options.candidateRecipeDirectory)
    ) {
      throw new Error("Candidate Recipe directory must be absolute");
    }
    this.#options = options;
    this.#clock = options.clock ?? (() => new Date());
    this.#containerUser = nonRootHostUser();
  }

  bindingMatches(run: SealedNativeRun): boolean {
    return (
      run.targetSnapshot.digest === this.#options.targetSnapshotDigest &&
      run.targetSnapshot.sourceTree.digest ===
        this.#options.sourceTree.digest &&
      run.targetSnapshot.sourceTree.entries ===
        this.#options.sourceTree.entries &&
      run.targetSnapshot.sourceTree.bytes === this.#options.sourceTree.bytes &&
      canonicalDigest(run.dependencySnapshots ?? []) ===
        canonicalDigest(
          (this.#options.dependencySources ?? []).map(
            (dependency) => dependency.snapshot,
          ),
        ) &&
      run.promptSet.digest === this.#options.promptSet.digest &&
      run.permissionProfile.digest === this.#options.permissionProfileDigest
    );
  }

  prompt(run: SealedNativeRun): string {
    return agentResearchPrompt(this.#options.promptSet.text, run);
  }

  materializeReport(
    run: SealedNativeRun,
    value: unknown,
  ): Promise<ResearchReport> {
    return materializeResearchReport(
      value,
      run,
      this.#options.candidateRecipeDirectory ??
        join(this.#options.scratchRootDirectory, "candidate-recipes"),
    );
  }

  now(): Date {
    return this.#clock();
  }

  async execute(
    run: SealedNativeRun,
    command: SandboxedAgentCommand,
  ): Promise<SandboxedAgentResult> {
    const startedAt = this.#clock();
    let sourceDirectory: string;
    let dependencySources: readonly {
      readonly snapshot: DependencySnapshotRef;
      readonly sourceDirectory: string;
    }[];
    let providerConfigDirectory: string;
    let scratchRootDirectory: string;
    try {
      [
        sourceDirectory,
        providerConfigDirectory,
        scratchRootDirectory,
        dependencySources,
      ] = await Promise.all([
        directory(this.#options.sourceDirectory, "Target source"),
        directory(
          this.#options.providerConfigDirectory,
          "Provider config directory",
        ),
        directory(this.#options.scratchRootDirectory, "Scratch root"),
        Promise.all(
          (this.#options.dependencySources ?? []).map(async (dependency) => ({
            snapshot: dependency.snapshot,
            sourceDirectory: await directory(
              dependency.sourceDirectory,
              `Dependency source ${dependency.snapshot.mountName}`,
            ),
          })),
        ),
      ]);
    } catch {
      return {
        status: "failed",
        receipt: failedNativeRunReceipt(
          run,
          "policy-denied",
          "A bound Agent Runtime directory is unavailable.",
          startedAt,
          this.#clock(),
          false,
          undefined,
          undefined,
          "sandbox-preflight",
        ),
      };
    }

    const docker = async (
      args: readonly string[],
      stdin: string | undefined,
      timeoutMs: number,
      maxOutputBytes: number,
    ) =>
      runNativeModelProcess({
        executablePath: this.#options.dockerExecutablePath,
        args,
        workingDirectory: scratchRootDirectory,
        environment: processEnvironment(),
        ...(stdin === undefined ? {} : { stdin }),
        timeoutMs,
        maxOutputBytes,
      });

    const sourceIntegrity = await verifyCanonicalSourceTree(
      sourceDirectory,
      this.#options.sourceTree,
    ).catch(() => ({ matches: false as const }));
    if (!sourceIntegrity.matches) {
      return {
        status: "failed",
        receipt: failedNativeRunReceipt(
          run,
          "policy-denied",
          "The mounted Target source does not match its sealed source tree.",
          startedAt,
          this.#clock(),
          false,
          undefined,
          undefined,
          "sandbox-preflight",
        ),
      };
    }

    const dependencyIntegrity = await Promise.all(
      dependencySources.map(async (dependency) => ({
        snapshot: dependency.snapshot,
        matches: (
          await verifyCanonicalSourceTree(
            dependency.sourceDirectory,
            dependency.snapshot.sourceTree,
          ).catch(() => ({ matches: false as const }))
        ).matches,
      })),
    );
    if (dependencyIntegrity.some((dependency) => !dependency.matches)) {
      return {
        status: "failed",
        receipt: failedNativeRunReceipt(
          run,
          "policy-denied",
          "A mounted Dependency source does not match its sealed source tree.",
          startedAt,
          this.#clock(),
          false,
          undefined,
          undefined,
          "sandbox-preflight",
        ),
      };
    }

    const runtimes = await docker(
      ["info", "--format", "{{json .Runtimes}}"],
      undefined,
      10_000,
      64 * 1024,
    ).catch(() => undefined);
    let hasRunsc = false;
    if (runtimes?.kind === "exited" && runtimes.exitCode === 0) {
      try {
        hasRunsc = Object.hasOwn(
          dockerRuntimesSchema.parse(JSON.parse(runtimes.stdout)),
          "runsc",
        );
      } catch {
        hasRunsc = false;
      }
    }
    const image = await docker(
      ["image", "inspect", this.#options.image],
      undefined,
      10_000,
      64 * 1024,
    ).catch(() => undefined);
    if (!hasRunsc || image?.kind !== "exited" || image.exitCode !== 0) {
      return {
        status: "failed",
        receipt: failedNativeRunReceipt(
          run,
          "policy-denied",
          "The pinned gVisor Agent Sandbox is unavailable.",
          startedAt,
          this.#clock(),
          false,
          undefined,
          undefined,
          "sandbox-preflight",
          true,
        ),
      };
    }

    let researchState: ResearchWorkingState | undefined;
    let scratchDirectory: string | undefined;
    let providerHome: string | undefined;
    const credentials = new ProviderCredentialFiles(
      command.ephemeralProviderCredentialFiles ?? [],
    );
    let failureStage: AgentRunFailureStage = "sandbox-preflight";
    let providerProcess: NativeModelProcessResult | undefined;

    try {
      if (command.researchSession !== undefined) {
        try {
          researchState = await prepareResearchState(run, scratchRootDirectory);
        } catch {
          return {
            status: "failed",
            receipt: failedNativeRunReceipt(
              run,
              "policy-denied",
              "The bound Agent Checkpoint is unavailable or invalid.",
              startedAt,
              this.#clock(),
              false,
              undefined,
              undefined,
              "sandbox-preflight",
            ),
          };
        }
        scratchDirectory = researchState.scratchDirectory;
        providerHome = researchState.providerHome;
      } else {
        if (run.resumeFrom !== undefined) {
          throw new Error(
            "Research resume requires a provider session binding",
          );
        }
        scratchDirectory = await mkdtemp(join(scratchRootDirectory, "run-"));
      }
      if (command.ephemeralProviderCredentialFiles !== undefined) {
        if (command.ephemeralProviderHomeMount === undefined) {
          throw new Error("Provider credentials require an isolated mount");
        }
        providerHome ??= await mkdtemp(join(scratchRootDirectory, "provider-"));
        await credentials.copyTo(providerConfigDirectory, providerHome);
      } else if (command.ephemeralProviderHomeMount !== undefined) {
        throw new Error("Provider mount requires credential files");
      }
      if (scratchDirectory === undefined) {
        throw new Error("Agent scratch directory is unavailable");
      }
      const runScratchDirectory = scratchDirectory;
      const providerMount = command.ephemeralProviderHomeMount;
      const supportFilePaths = await Promise.all(
        (command.supportFiles ?? []).map(async (supportFile) => {
          const filename = providerFileNameSchema.parse(supportFile.filename);
          const path = join(runScratchDirectory, filename);
          await writeFile(path, supportFile.text, {
            encoding: "utf8",
            mode: 0o600,
            flag:
              researchState !== undefined && run.resumeFrom !== undefined
                ? "w"
                : "wx",
          });
          return { ...supportFile, path };
        }),
      );
      const containerArgs = [
        "run",
        "--rm",
        "--interactive",
        "--runtime=runsc",
        `--user=${this.#containerUser}`,
        "--read-only",
        "--cap-drop=ALL",
        "--security-opt=no-new-privileges",
        "--pids-limit=512",
        "--memory=8g",
        "--cpus=4",
        "--tmpfs=/tmp:rw,noexec,nosuid,nodev,size=512m",
        "--volume",
        `${sourceDirectory}:/workspace/main:ro`,
        ...dependencySources.flatMap((dependency) => [
          "--volume",
          `${dependency.sourceDirectory}:/workspace/dependencies/${dependency.snapshot.mountName}:ro`,
        ]),
        "--volume",
        `${scratchDirectory}:/workspace/research:rw`,
        ...supportFilePaths.flatMap((supportFile) =>
          supportFile.containerMountPath === undefined
            ? []
            : [
                "--volume",
                `${supportFile.path}:${supportFile.containerMountPath}:ro`,
              ],
        ),
        ...(providerHome === undefined || providerMount === undefined
          ? []
          : [
              "--volume",
              `${providerHome}:${providerMount.path}:${providerMount.mode}`,
            ]),
        "--workdir=/workspace",
        ...command.providerEnvironment,
        this.#options.image,
        command.executable,
      ];
      if (command.prompt.kind === "file") {
        await writeFile(
          join(scratchDirectory, "prompt.txt"),
          command.prompt.text,
          {
            encoding: "utf8",
            mode: 0o600,
            flag: "w",
          },
        );
      }
      failureStage = "provider-version";
      const version = await docker(
        [...containerArgs, "--version"],
        undefined,
        20_000,
        64 * 1024,
      );
      const versionTokens =
        version.kind === "exited" ? version.stdout.trim().split(/[\s(]/u) : [];
      if (
        version.kind !== "exited" ||
        version.exitCode !== 0 ||
        versionTokens[command.versionTokenIndex] !==
          run.agentRuntimeProfile.executableVersion
      ) {
        const observedVersion =
          version.kind === "exited" && version.exitCode === 0
            ? (versionTokens[command.versionTokenIndex] ?? "unavailable")
            : "unavailable";
        const processState =
          version.kind === "exited" ? `exit-${version.exitCode}` : version.kind;
        return {
          status: "failed",
          receipt: failedNativeRunReceipt(
            run,
            "policy-denied",
            `The sandboxed Agent Runtime version is not admitted (expected ${run.agentRuntimeProfile.executableVersion}, observed ${observedVersion}, process ${processState}).`,
            startedAt,
            this.#clock(),
            true,
            undefined,
            undefined,
            "provider-version",
          ),
        };
      }

      const sessionArguments =
        researchState === undefined || command.researchSession === undefined
          ? []
          : run.resumeFrom !== undefined
            ? command.researchSession.resumeSessionArguments(
                researchState.sessionId,
              )
            : command.researchSession.newSessionArguments(
                researchState.sessionId,
              );
      const finalizeCheckpoint = async (
        stdout?: string,
      ): Promise<AgentCheckpointRef | undefined> => {
        if (researchState === undefined) {
          return undefined;
        }
        await removeProviderCredentials();
        const generatedSessionId =
          stdout === undefined
            ? undefined
            : command.researchSession?.generatedSessionIdFromOutput?.(stdout);
        if (
          command.researchSession?.generatedSessionIdFromOutput !== undefined &&
          generatedSessionId === undefined
        ) {
          return undefined;
        }
        return finalizeResearchState(
          run,
          generatedSessionId === undefined
            ? researchState
            : { ...researchState, sessionId: generatedSessionId },
          scratchRootDirectory,
        );
      };
      const removeProviderCredentials = async (): Promise<void> => {
        if (researchState === undefined) return;
        await credentials.removeFrom(researchState.providerHome);
      };

      failureStage = "provider-execution";
      const result = await docker(
        [...containerArgs, ...command.args, ...sessionArguments],
        command.prompt.kind === "stdin" ? command.prompt.text : undefined,
        run.budgetAllowance.maxWallTimeMs,
        this.#options.maxOutputBytes,
      );
      providerProcess = result;
      failureStage = "checkpoint-finalization";
      let checkpoint: AgentCheckpointRef | undefined;
      let checkpointError: unknown;
      try {
        checkpoint = await finalizeCheckpoint(result.stdout);
      } catch (error: unknown) {
        checkpointError = error;
      }
      const adapterDiagnostic: PreserveAdapterDiagnostic = (reason) =>
        preserveAgentRunDiagnostic({
          scratchRootDirectory,
          run,
          stage: "runtime-adapter",
          redact: credentials.redact,
          process: result,
          error: new Error(reason),
        });
      const failureDiagnostic = async (
        stage: AgentRunFailureStage,
        error?: unknown,
      ): Promise<AgentRunDiagnosticRef | undefined> => {
        let stateRoot: string | undefined;
        if (researchState !== undefined && checkpoint === undefined) {
          try {
            await removeProviderCredentials();
            stateRoot = researchState.root;
          } catch {
            stateRoot = undefined;
          }
        }
        return preserveAgentRunDiagnostic({
          scratchRootDirectory,
          run,
          stage,
          redact: credentials.redact,
          process: result,
          ...(error === undefined ? {} : { error }),
          ...(stateRoot === undefined ? {} : { stateRoot }),
        });
      };
      if (result.kind === "timed-out") {
        const completedAt = this.#clock();
        const diagnostic = await failureDiagnostic(
          checkpointError === undefined
            ? "provider-execution"
            : "checkpoint-finalization",
          checkpointError,
        );
        return {
          status: "failed",
          receipt: failedNativeRunReceipt(
            run,
            "budget-exhausted",
            checkpointError === undefined
              ? "The sandboxed Agent Runtime exhausted its wall-time budget."
              : "The sandboxed Agent Runtime exhausted its wall-time budget and its checkpoint could not be finalized.",
            startedAt,
            completedAt,
            true,
            checkpoint,
            diagnostic,
            checkpointError === undefined
              ? "provider-execution"
              : "checkpoint-finalization",
          ),
        };
      }
      if (result.kind === "exited" && result.exitCode !== 0) {
        const completedAt = this.#clock();
        const diagnostic = await failureDiagnostic(
          checkpointError === undefined
            ? "provider-execution"
            : "checkpoint-finalization",
          checkpointError,
        );
        return {
          status: "exited-nonzero",
          stdout: result.stdout,
          startedAt,
          completedAt,
          failureStage:
            checkpointError === undefined
              ? "provider-execution"
              : "checkpoint-finalization",
          preserveDiagnostic: adapterDiagnostic,
          ...(checkpoint === undefined ? {} : { checkpoint }),
          ...(diagnostic === undefined ? {} : { diagnostic }),
        };
      }
      if (result.kind !== "exited") {
        const completedAt = this.#clock();
        const diagnostic = await failureDiagnostic(
          checkpointError === undefined
            ? "provider-execution"
            : "checkpoint-finalization",
          checkpointError,
        );
        return {
          status: "failed",
          receipt: failedNativeRunReceipt(
            run,
            "provider-failed",
            checkpointError === undefined
              ? "The sandboxed Agent Runtime exceeded its output limit."
              : "The sandboxed Agent Runtime exceeded its output limit and its checkpoint could not be finalized.",
            startedAt,
            completedAt,
            true,
            checkpoint,
            diagnostic,
            checkpointError === undefined
              ? "provider-execution"
              : "checkpoint-finalization",
          ),
        };
      }
      const completedAt = this.#clock();
      if (checkpointError !== undefined) {
        const missingCheckpointError = checkpointError;
        const diagnostic = await failureDiagnostic(
          "checkpoint-finalization",
          missingCheckpointError,
        );
        return {
          status: "failed",
          receipt: failedNativeRunReceipt(
            run,
            "provider-failed",
            "The sandboxed Agent Runtime completed, but its checkpoint could not be finalized.",
            startedAt,
            completedAt,
            true,
            undefined,
            diagnostic,
            "checkpoint-finalization",
          ),
        };
      }
      if (
        run.kind === "sealed-native-research-run" &&
        checkpoint === undefined
      ) {
        const summary =
          "The sandboxed Agent Runtime returned an unbound Research session.";
        const diagnostic = await failureDiagnostic(
          "checkpoint-finalization",
          new Error(summary),
        );
        return {
          status: "failed",
          receipt: failedNativeRunReceipt(
            run,
            "policy-denied",
            summary,
            startedAt,
            completedAt,
            true,
            undefined,
            diagnostic,
            "checkpoint-finalization",
          ),
        };
      }
      return {
        status: "completed",
        stdout: result.stdout,
        startedAt,
        completedAt,
        preserveDiagnostic: adapterDiagnostic,
        ...(checkpoint === undefined ? {} : { checkpoint }),
      };
    } catch (error: unknown) {
      let stateRoot: string | undefined;
      if (researchState !== undefined) {
        const state = researchState;
        try {
          await credentials.removeFrom(state.providerHome);
          stateRoot = state.root;
        } catch {
          stateRoot = undefined;
        }
      }
      const diagnostic = await preserveAgentRunDiagnostic({
        scratchRootDirectory,
        run,
        stage: failureStage,
        redact: credentials.redact,
        ...(providerProcess === undefined ? {} : { process: providerProcess }),
        error,
        ...(stateRoot === undefined ? {} : { stateRoot }),
      });
      const terminal =
        providerProcess?.kind === "timed-out"
          ? ("budget-exhausted" as const)
          : ("provider-failed" as const);
      return {
        status: "failed",
        receipt: failedNativeRunReceipt(
          run,
          terminal,
          terminal === "budget-exhausted"
            ? "The sandboxed Agent Runtime exhausted its wall-time budget and diagnostic handling failed."
            : "The sandboxed Agent Runtime failed unexpectedly.",
          startedAt,
          this.#clock(),
          true,
          undefined,
          diagnostic,
          failureStage,
        ),
      };
    } finally {
      const cleanup = new Set<string>();
      if (researchState !== undefined) cleanup.add(researchState.root);
      if (scratchDirectory !== undefined && researchState === undefined) {
        cleanup.add(scratchDirectory);
      }
      if (providerHome !== undefined && researchState === undefined) {
        cleanup.add(providerHome);
      }
      await Promise.all(
        [...cleanup].map((path) => rm(path, { recursive: true, force: true })),
      ).catch(async (error: unknown) => {
        await preserveAgentRunDiagnostic({
          scratchRootDirectory,
          run,
          stage: "sandbox-cleanup",
          redact: credentials.redact,
          ...(providerProcess === undefined
            ? {}
            : { process: providerProcess }),
          error,
        });
      });
    }
  }
}
