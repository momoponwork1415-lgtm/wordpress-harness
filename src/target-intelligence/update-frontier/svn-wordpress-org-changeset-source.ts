import { spawn } from "node:child_process";

import {
  WordPressOrgChangesetSourceError,
  wordPressOrgChangesetSourceRequestSchema,
  wordPressOrgChangesetSourceResponseSchema,
  type CreateSvnWordPressOrgChangesetSourceOptions,
  type WordPressOrgChangesetSource,
  type WordPressOrgChangesetSourceRequest,
} from "./contracts.js";

const REPOSITORY_URL = "https://plugins.svn.wordpress.org" as const;
const DEFAULT_TIMEOUT_MS = 30_000;
const MAXIMUM_STDERR_BYTES = 16_384;

function diffArguments(
  request: Extract<WordPressOrgChangesetSourceRequest, { kind: "diff" }>,
): readonly string[] {
  return [
    "diff",
    "-c",
    String(request.revision),
    `${REPOSITORY_URL}/${request.pluginSlug}/trunk`,
    "--non-interactive",
  ];
}

function logArguments(
  request: Extract<WordPressOrgChangesetSourceRequest, { kind: "log" }>,
  headRevision: number,
): readonly string[] {
  return [
    "log",
    REPOSITORY_URL,
    "--xml",
    "--verbose",
    "--limit",
    String(request.maximumRevisions),
    "-r",
    `${request.fromRevisionExclusive + 1}:${headRevision}`,
    "--non-interactive",
  ];
}

async function runBoundedProcess(input: {
  readonly executablePath: string;
  readonly args: readonly string[];
  readonly maximumBytes: number;
  readonly timeoutMs: number;
  readonly operation: WordPressOrgChangesetSourceRequest["kind"];
}): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const child = spawn(input.executablePath, input.args, {
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const output: Buffer[] = [];
    let outputBytes = 0;
    let terminal: WordPressOrgChangesetSourceError["code"] | undefined =
      undefined;
    let settled = false;
    const timer = setTimeout(() => {
      terminal = "timed-out";
      child.kill("SIGKILL");
    }, input.timeoutMs);

    child.stdout.on("data", (chunk: Buffer) => {
      if (terminal !== undefined) return;
      outputBytes += chunk.byteLength;
      if (outputBytes > input.maximumBytes) {
        terminal = "quota-exceeded";
        child.kill("SIGKILL");
        return;
      }
      output.push(Buffer.from(chunk));
    });
    let stderrBytes = 0;
    child.stderr.on("data", (chunk: Buffer) => {
      stderrBytes += chunk.byteLength;
      if (stderrBytes > MAXIMUM_STDERR_BYTES && terminal === undefined) {
        terminal = "quota-exceeded";
        child.kill("SIGKILL");
      }
    });
    child.once("error", () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(
        new WordPressOrgChangesetSourceError(
          terminal ?? "source-failed",
          input.operation,
        ),
      );
    });
    child.once("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (terminal !== undefined || code !== 0) {
        reject(
          new WordPressOrgChangesetSourceError(
            terminal ?? "source-failed",
            input.operation,
          ),
        );
        return;
      }
      resolve(Buffer.concat(output, outputBytes));
    });
  });
}

class SvnWordPressOrgChangesetSource implements WordPressOrgChangesetSource {
  readonly #executablePath: string;
  readonly #timeoutMs: number;

  constructor(options: CreateSvnWordPressOrgChangesetSourceOptions) {
    this.#executablePath = options.svnExecutablePath ?? "svn";
    this.#timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    if (
      this.#executablePath.length === 0 ||
      !Number.isSafeInteger(this.#timeoutMs) ||
      this.#timeoutMs <= 0
    ) {
      throw new TypeError("SVN executable and timeout options are invalid");
    }
  }

  async retrieve(requestValue: WordPressOrgChangesetSourceRequest) {
    const request =
      wordPressOrgChangesetSourceRequestSchema.parse(requestValue);
    if (request.kind === "log") {
      const headBytes = await runBoundedProcess({
        executablePath: this.#executablePath,
        args: [
          "info",
          REPOSITORY_URL,
          "--show-item",
          "revision",
          "--non-interactive",
        ],
        maximumBytes: 128,
        timeoutMs: this.#timeoutMs,
        operation: "log",
      });
      const headRevision = Number(
        Buffer.from(headBytes).toString("utf8").trim(),
      );
      if (!Number.isSafeInteger(headRevision) || headRevision < 0) {
        throw new WordPressOrgChangesetSourceError("source-failed", "log");
      }
      if (headRevision <= request.fromRevisionExclusive) {
        return wordPressOrgChangesetSourceResponseSchema.parse({
          repositoryUrl: REPOSITORY_URL,
          bytes: Buffer.from(
            '<?xml version="1.0" encoding="UTF-8"?>\n<log>\n</log>\n',
          ),
        });
      }
      const bytes = await runBoundedProcess({
        executablePath: this.#executablePath,
        args: logArguments(request, headRevision),
        maximumBytes: request.maximumBytes,
        timeoutMs: this.#timeoutMs,
        operation: request.kind,
      });
      return wordPressOrgChangesetSourceResponseSchema.parse({
        repositoryUrl: REPOSITORY_URL,
        bytes,
      });
    }
    const bytes = await runBoundedProcess({
      executablePath: this.#executablePath,
      args: diffArguments(request),
      maximumBytes: request.maximumBytes,
      timeoutMs: this.#timeoutMs,
      operation: request.kind,
    });
    return wordPressOrgChangesetSourceResponseSchema.parse({
      repositoryUrl: REPOSITORY_URL,
      bytes,
    });
  }
}

export function createSvnWordPressOrgChangesetSource(
  options: CreateSvnWordPressOrgChangesetSourceOptions = {},
): WordPressOrgChangesetSource {
  return new SvnWordPressOrgChangesetSource(options);
}
