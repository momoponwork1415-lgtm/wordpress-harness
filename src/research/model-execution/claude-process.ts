import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { isAbsolute } from "node:path";

import { z } from "zod";

import { openModelExecution } from "./model-execution.js";
import type {
  ModelExecution,
  ModelProcess,
  ModelProcessResult,
  ModelProcessRequest,
} from "./contracts.js";

export interface OpenClaudeModelExecutionOptions {
  readonly artifactDirectory: string;
  readonly executablePath: string;
  readonly executableVersion: string;
  readonly workingDirectory: string;
}

type NativeProcessResult = Exclude<
  ModelProcessResult,
  { readonly kind: "auth-required" }
>;

const inheritedEnvironment = [
  "HOME",
  "PATH",
  "LANG",
  "LC_ALL",
  "USER",
  "LOGNAME",
  "SHELL",
  "TMPDIR",
  "XDG_CONFIG_HOME",
  "XDG_CACHE_HOME",
  "XDG_DATA_HOME",
  "SSL_CERT_FILE",
  "SSL_CERT_DIR",
  "NODE_EXTRA_CA_CERTS",
  "CLAUDE_CODE_OAUTH_TOKEN",
] as const;

const claudeAuthStatusSchema = z.object({ loggedIn: z.boolean() });

function minimalEnvironment(): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = { CI: "1", NO_COLOR: "1" };
  for (const name of inheritedEnvironment) {
    const value = process.env[name];
    if (value !== undefined) environment[name] = value;
  }
  if (environment.HOME === undefined || environment.PATH === undefined) {
    throw new Error("Claude process requires HOME and PATH");
  }
  return environment;
}

function redactProviderCredential(text: string): string {
  const credential = process.env.CLAUDE_CODE_OAUTH_TOKEN;
  return credential === undefined || credential.length === 0
    ? text
    : text.replaceAll(credential, "[REDACTED]");
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

class NativeClaudeProcess implements ModelProcess {
  readonly #executablePath;
  readonly #executableVersion;
  readonly #workingDirectory;

  constructor(options: OpenClaudeModelExecutionOptions) {
    if (!isAbsolute(options.executablePath)) {
      throw new Error("Claude executable path must be absolute");
    }
    if (!isAbsolute(options.workingDirectory)) {
      throw new Error("Claude working directory must be absolute");
    }
    this.#executablePath = options.executablePath;
    this.#executableVersion = options.executableVersion;
    this.#workingDirectory = options.workingDirectory;
  }

  async execute(request: ModelProcessRequest): Promise<ModelProcessResult> {
    if (
      request.plan.modelProfile.executableVersion !== this.#executableVersion
    ) {
      throw new Error("Attempt Plan Claude version does not match adapter");
    }
    const startedAt = performance.now();
    const remainingTime = (): number =>
      Math.max(
        0,
        request.plan.budget.maxWallTimeMs - (performance.now() - startedAt),
      );
    const version = await this.#run(
      ["--version"],
      undefined,
      Math.min(remainingTime(), 10_000),
      64 * 1024,
    );
    if (
      version.kind !== "exited" ||
      version.exitCode !== 0 ||
      version.stdout.split(/\s/u, 1)[0] !== this.#executableVersion
    ) {
      const observed =
        version.kind === "exited"
          ? `${version.exitCode}:${version.stdout.trim().slice(0, 64)}`
          : version.kind;
      throw new Error(`Claude executable version probe failed (${observed})`);
    }
    if (remainingTime() === 0) {
      return { kind: "timed-out", stderr: "" };
    }
    const auth = await this.#run(
      ["auth", "status"],
      undefined,
      Math.min(remainingTime(), 10_000),
      64 * 1024,
    );
    if (auth.kind === "timed-out") return auth;
    if (auth.kind === "output-limit-exceeded") {
      throw new Error("Claude auth status probe exceeded its output limit");
    }
    if (auth.exitCode !== 0) {
      return {
        kind: "auth-required",
        reason: "provider-session-unavailable",
      };
    }
    let authStatus: z.infer<typeof claudeAuthStatusSchema>;
    try {
      const parsed: unknown = JSON.parse(auth.stdout);
      authStatus = claudeAuthStatusSchema.parse(parsed);
    } catch {
      throw new Error("Claude auth status probe returned invalid output");
    }
    if (!authStatus.loggedIn) {
      return {
        kind: "auth-required",
        reason: "provider-session-unavailable",
      };
    }
    if (remainingTime() === 0) {
      return { kind: "timed-out", stderr: "" };
    }

    const args = [
      "-p",
      "--model",
      request.plan.modelProfile.model,
      "--effort",
      request.plan.modelProfile.effort,
      "--restricted",
      "--safe-mode",
      "--strict-mcp-config",
      "--disable-slash-commands",
      "--tools",
      "",
      "--no-session-persistence",
      "--no-chrome",
      "--prompt-suggestions",
      "false",
      "--output-format",
      "json",
      "--json-schema",
      JSON.stringify(request.outputJsonSchema),
    ];
    return this.#run(
      args,
      request.plan.prompt,
      remainingTime(),
      request.plan.budget.maxOutputBytes,
    );
  }

  #run(
    args: readonly string[],
    stdin: string | undefined,
    timeoutMs: number,
    maxOutputBytes: number,
  ): Promise<NativeProcessResult> {
    return new Promise((resolve, reject) => {
      const child = spawn(this.#executablePath, args, {
        cwd: this.#workingDirectory,
        detached: process.platform !== "win32",
        env: minimalEnvironment(),
        stdio: ["pipe", "pipe", "pipe"],
      });
      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];
      let stdoutBytes = 0;
      let stderrBytes = 0;
      let terminalKind: "timed-out" | "output-limit-exceeded" | undefined;
      let killTimer: NodeJS.Timeout | undefined;

      const terminate = (kind: "timed-out" | "output-limit-exceeded"): void => {
        if (terminalKind !== undefined) return;
        terminalKind = kind;
        signalProcessTree(child, "SIGTERM");
        killTimer = setTimeout(() => {
          signalProcessTree(child, "SIGKILL");
        }, 2_000);
        killTimer.unref();
      };
      const timeout = setTimeout(() => terminate("timed-out"), timeoutMs);
      timeout.unref();

      child.stdout.on("data", (chunk: Buffer) => {
        stdoutBytes += chunk.byteLength;
        if (stdoutBytes > maxOutputBytes) {
          terminate("output-limit-exceeded");
          return;
        }
        stdout.push(chunk);
      });
      child.stderr.on("data", (chunk: Buffer) => {
        const remaining = 64 * 1024 - stderrBytes;
        if (remaining <= 0) return;
        const kept = chunk.subarray(0, remaining);
        stderr.push(kept);
        stderrBytes += kept.byteLength;
      });
      child.once("error", (error) => {
        clearTimeout(timeout);
        if (killTimer !== undefined) clearTimeout(killTimer);
        reject(error);
      });
      child.once("close", (exitCode) => {
        clearTimeout(timeout);
        const stderrText = redactProviderCredential(
          Buffer.concat(stderr).toString("utf8"),
        );
        if (terminalKind !== undefined) {
          signalProcessTree(child, "SIGKILL");
          if (killTimer !== undefined) clearTimeout(killTimer);
          resolve({ kind: terminalKind, stderr: stderrText });
          return;
        }
        if (killTimer !== undefined) clearTimeout(killTimer);
        resolve({
          kind: "exited",
          exitCode: exitCode ?? -1,
          stdout: redactProviderCredential(
            Buffer.concat(stdout).toString("utf8"),
          ),
          stderr: stderrText,
        });
      });

      if (stdin === undefined) {
        child.stdin.end();
      } else {
        child.stdin.end(stdin, "utf8");
      }
    });
  }
}

export function openClaudeModelExecution(
  options: OpenClaudeModelExecutionOptions,
): ModelExecution {
  return openModelExecution({
    artifactDirectory: options.artifactDirectory,
    process: new NativeClaudeProcess(options),
  });
}
