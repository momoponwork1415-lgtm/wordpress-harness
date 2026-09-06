import { spawn } from "node:child_process";
import { delimiter, dirname, resolve } from "node:path";

import { z } from "zod";

import { openFileJsonArtifactStore } from "../../research-record/file-json-artifact-store.js";
import {
  openVerifiedArtifacts,
  type VerifiedArtifacts,
} from "../../../infrastructure/verified-artifacts.js";

const digestSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const identifierSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);

const sourceRangeSchema = z
  .strictObject({
    startLine: z.number().int().positive(),
    endLine: z.number().int().positive(),
    startOffset: z.number().int().nonnegative(),
    endOffset: z.number().int().nonnegative(),
  })
  .refine(
    (range) =>
      range.endLine >= range.startLine && range.endOffset >= range.startOffset,
    { message: "Source range must end at or after its start" },
  );

const relativePhpPathSchema = z
  .string()
  .min(1)
  .refine(
    (path) =>
      !path.startsWith("/") &&
      !path.includes("\\") &&
      !path.split("/").includes(".."),
    { message: "Program file path must be a normalized relative path" },
  );

const symbolSchema = z.strictObject({
  kind: z.enum(["class", "interface", "trait", "enum", "function", "method"]),
  name: z.string().min(1),
  range: sourceRangeSchema,
});

const callSchema = z.strictObject({
  kind: z.enum(["function", "method", "static", "dynamic"]),
  caller: z.string().nullable(),
  callee: z.string().nullable(),
  range: sourceRangeSchema,
});

const hookRegistrationSchema = z.strictObject({
  kind: z.literal("hook-registration"),
  hook: z.string().nullable(),
  callback: z.string().nullable(),
  range: sourceRangeSchema,
});

const routeRegistrationSchema = z.strictObject({
  kind: z.literal("route-registration"),
  namespace: z.string().nullable(),
  route: z.string().nullable(),
  callback: z.string().nullable(),
  permissionCallback: z.string().nullable(),
  range: sourceRangeSchema,
});

const guardFactSchema = z.strictObject({
  kind: z.literal("guard"),
  category: z.literal("authorization"),
  operation: z.literal("current_user_can"),
  range: sourceRangeSchema,
});

const requestParameterSourceFactSchema = z.strictObject({
  kind: z.literal("source"),
  category: z.literal("request-parameter"),
  operation: z.literal("get_param"),
  range: sourceRangeSchema,
});

const requestSuperglobalSourceFactSchema = z.strictObject({
  kind: z.literal("source"),
  category: z.literal("request-superglobal"),
  operation: z.enum(["_GET", "_POST", "_REQUEST", "_COOKIE", "_FILES"]),
  range: sourceRangeSchema,
});

const getOptionFactSchema = z.strictObject({
  kind: z.literal("storage"),
  category: z.literal("option"),
  operation: z.literal("get_option"),
  access: z.literal("read"),
  range: sourceRangeSchema,
});

const updateOptionFactSchema = z.strictObject({
  kind: z.literal("storage"),
  category: z.literal("option"),
  operation: z.literal("update_option"),
  access: z.literal("write"),
  range: sourceRangeSchema,
});

const htmlOutputSinkFactSchema = z.strictObject({
  kind: z.literal("sink"),
  category: z.literal("html-output"),
  operation: z.literal("echo"),
  range: sourceRangeSchema,
});

const databaseQuerySinkFactSchema = z.strictObject({
  kind: z.literal("sink"),
  category: z.literal("database-query"),
  operation: z.enum(["query", "get_var", "get_row", "get_col", "get_results"]),
  range: sourceRangeSchema,
});

const filesystemWriteSinkFactSchema = z.strictObject({
  kind: z.literal("sink"),
  category: z.literal("filesystem-write"),
  operation: z.literal("file_put_contents"),
  range: sourceRangeSchema,
});

const codeExecutionSinkFactSchema = z.strictObject({
  kind: z.literal("sink"),
  category: z.literal("code-execution"),
  operation: z.enum([
    "eval",
    "include",
    "include_once",
    "require",
    "require_once",
  ]),
  range: sourceRangeSchema,
});

const processExecutionSinkFactSchema = z.strictObject({
  kind: z.literal("sink"),
  category: z.literal("process-execution"),
  operation: z.enum([
    "exec",
    "system",
    "passthru",
    "shell_exec",
    "popen",
    "proc_open",
    "pcntl_exec",
  ]),
  range: sourceRangeSchema,
});

const wordpressFactSchema = z.union([
  hookRegistrationSchema,
  routeRegistrationSchema,
  guardFactSchema,
  requestParameterSourceFactSchema,
  requestSuperglobalSourceFactSchema,
  getOptionFactSchema,
  updateOptionFactSchema,
  htmlOutputSinkFactSchema,
  databaseQuerySinkFactSchema,
  filesystemWriteSinkFactSchema,
  codeExecutionSinkFactSchema,
  processExecutionSinkFactSchema,
]);

const fileDiagnosticSchema = z.strictObject({
  kind: z.enum(["parse-error", "name-resolution-error"]),
  message: z.string(),
  range: sourceRangeSchema,
});

const programFileSchema = z.strictObject({
  path: relativePhpPathSchema,
  digest: digestSchema,
  symbols: z.array(symbolSchema),
  calls: z.array(callSchema),
  wordpressFacts: z.array(wordpressFactSchema),
  diagnostics: z.array(fileDiagnosticSchema),
});

const programDiagnosticSchema = fileDiagnosticSchema.extend({
  path: relativePhpPathSchema,
});

export const phpProgramIndexSchema = z.strictObject({
  schemaVersion: z.literal(1),
  generator: z.strictObject({
    name: z.literal("wordpress-harness/php-program-index"),
    version: z.enum(["0.1.0", "0.2.0", "0.3.0"]),
    phpParserVersion: z.string().min(1),
  }),
  targetSnapshot: z.strictObject({
    id: identifierSchema,
    digest: digestSchema,
  }),
  analysisProfile: z.strictObject({
    id: identifierSchema,
    phpVersion: z.string().regex(/^\d+\.\d+$/),
  }),
  files: z.array(programFileSchema),
  diagnostics: z.array(programDiagnosticSchema),
});

const analyzePhpSourceInputSchema = z.strictObject({
  targetSnapshot: z.strictObject({
    id: identifierSchema,
    pluginSlug: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
    version: z.string().min(1).max(64),
    digest: digestSchema,
  }),
  sourceDirectory: z.string().min(1),
  profile: z.strictObject({
    id: identifierSchema,
    phpVersion: z.string().regex(/^\d+\.\d+$/),
  }),
});

const programIndexSummarySchema = z.strictObject({
  files: z.number().int().nonnegative(),
  symbols: z.number().int().nonnegative(),
  calls: z.number().int().nonnegative(),
  wordpressFacts: z.number().int().nonnegative(),
  diagnostics: z.number().int().nonnegative(),
});

export const phpProgramIndexRefSchema = z.strictObject({
  kind: z.literal("php-program-index"),
  schemaVersion: z.literal(1),
  targetSnapshotId: identifierSchema,
  analysisProfileId: identifierSchema,
  digest: digestSchema,
  summary: programIndexSummarySchema,
});

export type PhpProgramIndex = z.infer<typeof phpProgramIndexSchema>;
export type AnalyzePhpSourceInput = z.infer<typeof analyzePhpSourceInputSchema>;
export type PhpProgramIndexRef = z.infer<typeof phpProgramIndexRefSchema>;

export interface PhpSourceAnalysis {
  analyze(input: AnalyzePhpSourceInput): Promise<PhpProgramIndexRef>;
  read(ref: PhpProgramIndexRef): Promise<PhpProgramIndex>;
}

export interface OpenPhpSourceAnalysisOptions {
  readonly artifactDirectory: string;
  readonly helperPath: string;
  readonly phpBinary?: string;
  readonly timeoutMs?: number;
  readonly maxOutputBytes?: number;
}

interface ChildResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

function summarizeIndex(index: PhpProgramIndex): PhpProgramIndexRef["summary"] {
  return {
    files: index.files.length,
    symbols: index.files.reduce(
      (count, file) => count + file.symbols.length,
      0,
    ),
    calls: index.files.reduce((count, file) => count + file.calls.length, 0),
    wordpressFacts: index.files.reduce(
      (count, file) => count + file.wordpressFacts.length,
      0,
    ),
    diagnostics: index.diagnostics.length,
  };
}

function summariesMatch(
  left: PhpProgramIndexRef["summary"],
  right: PhpProgramIndexRef["summary"],
): boolean {
  return (
    left.files === right.files &&
    left.symbols === right.symbols &&
    left.calls === right.calls &&
    left.wordpressFacts === right.wordpressFacts &&
    left.diagnostics === right.diagnostics
  );
}

class PhpSourceAnalysisImplementation implements PhpSourceAnalysis {
  readonly #artifacts: VerifiedArtifacts;
  readonly #helperPath: string;
  readonly #phpBinary: string;
  readonly #timeoutMs: number;
  readonly #maxOutputBytes: number;

  constructor(options: OpenPhpSourceAnalysisOptions) {
    this.#artifacts = openVerifiedArtifacts(
      openFileJsonArtifactStore(options.artifactDirectory),
    );
    this.#helperPath = resolve(options.helperPath);
    this.#phpBinary = options.phpBinary ?? "php";
    this.#timeoutMs = options.timeoutMs ?? 30_000;
    this.#maxOutputBytes = options.maxOutputBytes ?? 32 * 1024 * 1024;
    if (!Number.isSafeInteger(this.#timeoutMs) || this.#timeoutMs <= 0) {
      throw new RangeError("timeoutMs must be a positive safe integer");
    }
    if (
      !Number.isSafeInteger(this.#maxOutputBytes) ||
      this.#maxOutputBytes <= 0
    ) {
      throw new RangeError("maxOutputBytes must be a positive safe integer");
    }
  }

  async analyze(input: AnalyzePhpSourceInput): Promise<PhpProgramIndexRef> {
    const parsedInput = analyzePhpSourceInputSchema.parse(input);
    const sourceDirectory = resolve(parsedInput.sourceDirectory);
    if (sourceDirectory.includes(delimiter)) {
      throw new Error(
        `sourceDirectory cannot contain path delimiter ${delimiter}`,
      );
    }
    const request = {
      schemaVersion: 1,
      targetSnapshot: {
        id: parsedInput.targetSnapshot.id,
        digest: parsedInput.targetSnapshot.digest,
      },
      analysisProfile: parsedInput.profile,
      sourceDirectory,
    };
    const result = await this.#runHelper(request, sourceDirectory);
    if (result.exitCode !== 0) {
      throw new Error(
        `PHP Program Index helper failed: ${result.stderr.trim()}`,
      );
    }

    const responseValue: unknown = JSON.parse(result.stdout);
    const index = phpProgramIndexSchema.parse(responseValue);
    if (
      index.targetSnapshot.id !== parsedInput.targetSnapshot.id ||
      index.targetSnapshot.digest !== parsedInput.targetSnapshot.digest ||
      index.analysisProfile.id !== parsedInput.profile.id ||
      index.analysisProfile.phpVersion !== parsedInput.profile.phpVersion
    ) {
      throw new Error("PHP Program Index helper returned mismatched identity");
    }

    const digest = await this.#artifacts.put("PHP Program Index", index);

    return {
      kind: "php-program-index",
      schemaVersion: 1,
      targetSnapshotId: index.targetSnapshot.id,
      analysisProfileId: index.analysisProfile.id,
      digest,
      summary: summarizeIndex(index),
    };
  }

  async read(ref: PhpProgramIndexRef): Promise<PhpProgramIndex> {
    const parsedRef = phpProgramIndexRefSchema.parse(ref);
    const index = await this.#artifacts.read(
      "PHP Program Index",
      phpProgramIndexSchema,
      parsedRef.digest,
    );
    if (
      index.targetSnapshot.id !== parsedRef.targetSnapshotId ||
      index.analysisProfile.id !== parsedRef.analysisProfileId ||
      !summariesMatch(summarizeIndex(index), parsedRef.summary)
    ) {
      throw new Error(
        "PHP Program Index reference identity does not match artifact",
      );
    }
    return index;
  }

  async #runHelper(
    request: unknown,
    sourceDirectory: string,
  ): Promise<ChildResult> {
    const helperDirectory = dirname(this.#helperPath);
    const helperRoot = dirname(helperDirectory);
    if (helperRoot.includes(delimiter)) {
      throw new Error(`helper path cannot contain path delimiter ${delimiter}`);
    }
    const args = [
      "-d",
      "memory_limit=256M",
      "-d",
      "allow_url_fopen=0",
      "-d",
      "display_errors=stderr",
      "-d",
      "log_errors=0",
      "-d",
      `open_basedir=${sourceDirectory}${delimiter}${helperRoot}`,
      this.#helperPath,
    ];
    const environment: NodeJS.ProcessEnv = {
      LANG: "C",
      LC_ALL: "C",
      TZ: "UTC",
    };
    if (process.env.PATH !== undefined) {
      environment.PATH = process.env.PATH;
    }

    return new Promise<ChildResult>((resolve, reject) => {
      const child = spawn(this.#phpBinary, args, {
        cwd: helperDirectory,
        env: environment,
        stdio: ["pipe", "pipe", "pipe"],
      });
      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];
      let stdoutBytes = 0;
      let stderrBytes = 0;
      let exceededOutput = false;
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        reject(
          new Error(
            `PHP Program Index helper timed out after ${this.#timeoutMs}ms`,
          ),
        );
      }, this.#timeoutMs);

      child.on("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.stdout.on("data", (chunk: Buffer) => {
        stdoutBytes += chunk.length;
        if (stdoutBytes > this.#maxOutputBytes) {
          exceededOutput = true;
          child.kill("SIGKILL");
          return;
        }
        stdout.push(chunk);
      });
      child.stderr.on("data", (chunk: Buffer) => {
        const remainingBytes = Math.max(0, 1024 * 1024 - stderrBytes);
        stderrBytes += chunk.length;
        if (remainingBytes > 0) {
          stderr.push(chunk.subarray(0, remainingBytes));
        }
      });
      child.on("close", (exitCode) => {
        clearTimeout(timer);
        if (exceededOutput) {
          reject(new Error("PHP Program Index helper exceeded output ceiling"));
          return;
        }
        resolve({
          stdout: Buffer.concat(stdout).toString("utf8"),
          stderr: Buffer.concat(stderr).toString("utf8"),
          exitCode: exitCode ?? 1,
        });
      });
      child.stdin.on("error", (error) => {
        if (!(
          error instanceof Error &&
          "code" in error &&
          error.code === "EPIPE"
        )) {
          reject(error);
        }
      });
      child.stdin.end(`${JSON.stringify(request)}\n`);
    });
  }
}

export function openPhpSourceAnalysis(
  options: OpenPhpSourceAnalysisOptions,
): PhpSourceAnalysis {
  return new PhpSourceAnalysisImplementation(options);
}
