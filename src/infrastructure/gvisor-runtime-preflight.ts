import { z } from "zod";

import {
  runNativeModelProcess,
  type NativeModelProcessResult,
  type NativeModelProcessRunOptions,
} from "./native-model-process.js";

export type GvisorRuntimePreflightStatus = "ready" | "blocked" | "unknown";

export type GvisorRuntimePreflightCheckId =
  "docker" | "runsc" | "image" | "provider-version";

export interface GvisorRuntimePreflightCheck {
  readonly id: GvisorRuntimePreflightCheckId;
  readonly status: GvisorRuntimePreflightStatus;
  readonly reason: string;
  readonly summary: string;
}

export interface GvisorRuntimePreflightReport {
  readonly status: GvisorRuntimePreflightStatus;
  readonly checks: readonly GvisorRuntimePreflightCheck[];
}

export interface GvisorRuntimePreflightInput {
  readonly dockerExecutablePath: string;
  readonly workingDirectory: string;
  readonly image: string;
  readonly provider?: {
    readonly executable: string;
    readonly versionTokenIndex: number;
    readonly expectedVersion: string;
  };
}

export interface GvisorRuntimePreflight {
  inspect(
    input: GvisorRuntimePreflightInput,
  ): Promise<GvisorRuntimePreflightReport>;
}

type ProcessRunner = (
  options: NativeModelProcessRunOptions,
) => Promise<NativeModelProcessResult>;

const dockerRuntimesSchema = z.record(z.string(), z.unknown());
const dockerImageInspectionSchema = z.looseObject({
  Id: z.string().optional(),
  RepoDigests: z.array(z.string()).nullable().optional(),
});

function check(
  id: GvisorRuntimePreflightCheckId,
  status: GvisorRuntimePreflightStatus,
  reason: string,
  summary: string,
): GvisorRuntimePreflightCheck {
  return { id, status, reason, summary };
}

function ready(
  id: GvisorRuntimePreflightCheckId,
  reason: string,
  summary: string,
): GvisorRuntimePreflightCheck {
  return check(id, "ready", reason, summary);
}

function blocked(
  id: GvisorRuntimePreflightCheckId,
  reason: string,
  summary: string,
): GvisorRuntimePreflightCheck {
  return check(id, "blocked", reason, summary);
}

function unknown(
  id: GvisorRuntimePreflightCheckId,
  reason: string,
  summary: string,
): GvisorRuntimePreflightCheck {
  return check(id, "unknown", reason, summary);
}

function processEnvironment(): NodeJS.ProcessEnv {
  return {
    PATH: process.env.PATH ?? "",
    LANG: "C",
    LC_ALL: "C",
    TZ: "UTC",
  };
}

function referenceDigest(reference: string): string | undefined {
  const match = /sha256:[a-f0-9]{64}$/u.exec(reference);
  return match?.[0];
}

function imageInspectionMatches(output: string, image: string): boolean {
  const expected = referenceDigest(image);
  if (expected === undefined) return false;
  try {
    const inspection = dockerImageInspectionSchema.parse(
      JSON.parse(output) as unknown,
    );
    return (
      referenceDigest(inspection.Id ?? "") === expected ||
      (inspection.RepoDigests ?? []).some(
        (candidate) => referenceDigest(candidate) === expected,
      )
    );
  } catch {
    return false;
  }
}

function containerUser(): string {
  const uid = typeof process.getuid === "function" ? process.getuid() : 0;
  const gid = typeof process.getgid === "function" ? process.getgid() : 0;
  return uid > 0 && gid > 0 ? `${uid}:${gid}` : "65534:65534";
}

function report(
  checks: readonly GvisorRuntimePreflightCheck[],
): GvisorRuntimePreflightReport {
  return {
    status: checks.some((item) => item.status === "blocked")
      ? "blocked"
      : checks.some((item) => item.status === "unknown")
        ? "unknown"
        : "ready",
    checks,
  };
}

class NativeGvisorRuntimePreflight implements GvisorRuntimePreflight {
  readonly #runProcess: ProcessRunner;

  constructor(runProcess: ProcessRunner) {
    this.#runProcess = runProcess;
  }

  async #docker(
    input: GvisorRuntimePreflightInput,
    args: readonly string[],
  ): Promise<NativeModelProcessResult | undefined> {
    try {
      return await this.#runProcess({
        executablePath: input.dockerExecutablePath,
        args,
        workingDirectory: input.workingDirectory,
        environment: processEnvironment(),
        timeoutMs: 10_000,
        maxOutputBytes: 64 * 1024,
      });
    } catch {
      return undefined;
    }
  }

  async inspect(
    input: GvisorRuntimePreflightInput,
  ): Promise<GvisorRuntimePreflightReport> {
    const dockerProbe = await this.#docker(input, [
      "version",
      "--format",
      "{{.Server.Version}}",
    ]);
    const docker =
      dockerProbe?.kind === "exited" &&
      dockerProbe.exitCode === 0 &&
      dockerProbe.stdout.trim().length > 0
        ? ready("docker", "docker-available", "Docker is available.")
        : dockerProbe?.kind === "timed-out" ||
            dockerProbe?.kind === "output-limit-exceeded"
          ? unknown(
              "docker",
              "docker-probe-incomplete",
              "Docker availability could not be determined.",
            )
          : blocked("docker", "docker-unavailable", "Docker is unavailable.");

    if (docker.status !== "ready") {
      return report([
        docker,
        unknown(
          "runsc",
          "docker-required",
          "runsc availability cannot be determined without Docker.",
        ),
        unknown(
          "image",
          "docker-required",
          "The pinned image cannot be inspected without Docker.",
        ),
        unknown(
          "provider-version",
          "sandbox-required",
          "The provider executable cannot be inspected without runsc and the pinned image.",
        ),
      ]);
    }

    const runtimeProbe = await this.#docker(input, [
      "info",
      "--format",
      "{{json .Runtimes}}",
    ]);
    let runscAvailable = false;
    let runsc: GvisorRuntimePreflightCheck;
    if (runtimeProbe?.kind === "exited" && runtimeProbe.exitCode === 0) {
      try {
        const runtimes = dockerRuntimesSchema.parse(
          JSON.parse(runtimeProbe.stdout) as unknown,
        );
        runscAvailable = Object.hasOwn(runtimes, "runsc");
        runsc = runscAvailable
          ? ready(
              "runsc",
              "runsc-available",
              "Docker exposes the required runsc runtime.",
            )
          : blocked(
              "runsc",
              "runsc-unavailable",
              "Docker does not expose the required runsc runtime.",
            );
      } catch {
        runsc = unknown(
          "runsc",
          "runsc-observation-invalid",
          "Docker returned an invalid runtime observation.",
        );
      }
    } else {
      runsc = blocked(
        "runsc",
        "runsc-unavailable",
        "Docker runtime availability could not be confirmed.",
      );
    }

    const imageProbe = await this.#docker(input, [
      "image",
      "inspect",
      "--format",
      "{{json .}}",
      input.image,
    ]);
    const imageAvailable =
      imageProbe?.kind === "exited" &&
      imageProbe.exitCode === 0 &&
      imageInspectionMatches(imageProbe.stdout, input.image);
    const image =
      imageProbe?.kind === "exited" && imageProbe.exitCode === 0
        ? imageAvailable
          ? ready(
              "image",
              "image-digest-available",
              "The exact pinned Agent image is available.",
            )
          : blocked(
              "image",
              "image-digest-mismatch",
              "Docker did not return the required Agent image digest.",
            )
        : blocked(
            "image",
            "image-unavailable",
            "The exact pinned Agent image is unavailable.",
          );

    let provider: GvisorRuntimePreflightCheck;
    if (input.provider === undefined) {
      provider = unknown(
        "provider-version",
        "provider-requirement-missing",
        "The provider executable requirement was not supplied.",
      );
    } else if (!runscAvailable || !imageAvailable) {
      provider = unknown(
        "provider-version",
        "sandbox-required",
        "The provider executable cannot be inspected without runsc and the pinned image.",
      );
    } else {
      const providerProbe = await this.#docker(input, [
        "run",
        "--rm",
        "--pull=never",
        "--runtime=runsc",
        "--network=none",
        "--read-only",
        "--cap-drop=ALL",
        "--security-opt=no-new-privileges",
        "--pids-limit=32",
        "--memory=256m",
        "--cpus=1",
        `--user=${containerUser()}`,
        "--tmpfs=/tmp:rw,noexec,nosuid,nodev,size=64m",
        `--entrypoint=${input.provider.executable}`,
        input.image,
        "--version",
      ]);
      const tokens =
        providerProbe?.kind === "exited"
          ? providerProbe.stdout.trim().split(/[\s(]/u)
          : [];
      const observed = tokens[input.provider.versionTokenIndex];
      provider =
        providerProbe?.kind === "exited" &&
        providerProbe.exitCode === 0 &&
        observed === input.provider.expectedVersion
          ? ready(
              "provider-version",
              "provider-version-matches",
              "The sandboxed provider executable version matches the sealed profile.",
            )
          : blocked(
              "provider-version",
              "provider-version-mismatch",
              "The sandboxed provider executable version does not match the sealed profile.",
            );
    }

    return report([docker, runsc, image, provider]);
  }
}

export function openGvisorRuntimePreflight(
  options: { readonly runProcess?: ProcessRunner } = {},
): GvisorRuntimePreflight {
  return new NativeGvisorRuntimePreflight(
    options.runProcess ?? runNativeModelProcess,
  );
}
