import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { isAbsolute } from "node:path";

import type {
  LabProcessRequest,
  LabProcessResult,
  LabProcessRunner,
} from "./gvisor-stored-xss-lab.js";

export interface OpenNativeLabProcessRunnerOptions {
  readonly dockerExecutablePath: string;
}

const inheritedEnvironment = [
  "HOME",
  "PATH",
  "DOCKER_HOST",
  "DOCKER_CONTEXT",
  "DOCKER_CONFIG",
  "XDG_CONFIG_HOME",
  "SSL_CERT_FILE",
  "SSL_CERT_DIR",
] as const;

function minimalDockerEnvironment(): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = { CI: "1", NO_COLOR: "1" };
  for (const name of inheritedEnvironment) {
    const value = process.env[name];
    if (value !== undefined) environment[name] = value;
  }
  return environment;
}

function signalProcessTree(
  child: ChildProcessWithoutNullStreams,
  signal: NodeJS.Signals,
): void {
  if (child.pid === undefined) return;
  try {
    if (process.platform === "win32") {
      child.kill(signal);
    } else {
      process.kill(-child.pid, signal);
    }
  } catch (error: unknown) {
    if (!(
      error instanceof Error &&
      "code" in error &&
      error.code === "ESRCH"
    )) {
      throw error;
    }
  }
}

class NativeLabProcessRunner implements LabProcessRunner {
  readonly #dockerExecutablePath: string;

  constructor(options: OpenNativeLabProcessRunnerOptions) {
    if (!isAbsolute(options.dockerExecutablePath)) {
      throw new Error("Docker executable path must be absolute");
    }
    this.#dockerExecutablePath = options.dockerExecutablePath;
  }

  run(request: LabProcessRequest): Promise<LabProcessResult> {
    return new Promise((resolve) => {
      const child = spawn(this.#dockerExecutablePath, request.args, {
        detached: process.platform !== "win32",
        env: minimalDockerEnvironment(),
        shell: false,
        stdio: ["pipe", "pipe", "pipe"],
      });
      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];
      let stdoutBytes = 0;
      let stderrBytes = 0;
      let settled = false;
      let terminated = false;
      let killTimer: NodeJS.Timeout | undefined;
      const outputLimitBytes = 1024 * 1024;

      const finish = (result: LabProcessResult): void => {
        if (settled) return;
        settled = true;
        resolve(result);
      };
      const terminate = (): void => {
        if (terminated) return;
        terminated = true;
        signalProcessTree(child, "SIGTERM");
        killTimer = setTimeout(
          () => signalProcessTree(child, "SIGKILL"),
          2_000,
        );
        killTimer.unref();
      };
      const timeout = setTimeout(terminate, request.timeoutMs);
      timeout.unref();

      child.stdout.on("data", (chunk: Buffer) => {
        stdoutBytes += chunk.byteLength;
        if (stdoutBytes > outputLimitBytes) {
          terminate();
          return;
        }
        stdout.push(chunk);
      });
      child.stderr.on("data", (chunk: Buffer) => {
        const remaining = outputLimitBytes - stderrBytes;
        if (remaining <= 0) {
          terminate();
          return;
        }
        const kept = chunk.subarray(0, remaining);
        stderr.push(kept);
        stderrBytes += kept.byteLength;
      });
      child.once("error", (error) => {
        clearTimeout(timeout);
        if (killTimer !== undefined) clearTimeout(killTimer);
        finish({ exitCode: -1, stdout: "", stderr: error.message });
      });
      child.once("close", (exitCode) => {
        clearTimeout(timeout);
        if (terminated) signalProcessTree(child, "SIGKILL");
        if (killTimer !== undefined) clearTimeout(killTimer);
        finish({
          exitCode: terminated ? -1 : (exitCode ?? -1),
          stdout: Buffer.concat(stdout).toString("utf8"),
          stderr: Buffer.concat(stderr).toString("utf8"),
        });
      });
      child.stdin.end();
    });
  }
}

export function openNativeLabProcessRunner(
  options: OpenNativeLabProcessRunnerOptions,
): LabProcessRunner {
  return new NativeLabProcessRunner(options);
}
