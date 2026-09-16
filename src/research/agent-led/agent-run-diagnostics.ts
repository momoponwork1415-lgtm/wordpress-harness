import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";

import type { NativeModelProcessResult } from "../../infrastructure/native-model-process.js";
import type {
  AgentRunDiagnosticRef,
  AgentRunFailureStage,
  SealedNativeRun,
} from "./contracts.js";

function diagnosticError(
  error: unknown,
  redact: (text: string) => string,
): {
  readonly name: string;
  readonly message: string;
  readonly code?: string;
} {
  if (!(error instanceof Error)) {
    return { name: "UnknownError", message: "A non-Error value was thrown." };
  }
  const code =
    "code" in error && typeof error.code === "string" ? error.code : undefined;
  return {
    name: error.name,
    message: redact(error.message),
    ...(code === undefined ? {} : { code }),
  };
}

export async function preserveAgentRunDiagnostic(options: {
  readonly scratchRootDirectory: string;
  readonly run: SealedNativeRun;
  readonly stage: AgentRunFailureStage;
  readonly redact: (text: string) => string;
  readonly process?: NativeModelProcessResult;
  readonly error?: unknown;
  readonly stateRoot?: string;
}): Promise<AgentRunDiagnosticRef | undefined> {
  let temporaryRoot: string | undefined;
  try {
    const diagnosticsRoot = join(
      options.scratchRootDirectory,
      "agent-diagnostics",
    );
    await mkdir(diagnosticsRoot, { recursive: true, mode: 0o700 });
    temporaryRoot = await mkdtemp(join(diagnosticsRoot, "active-diagnostic-"));
    let statePreserved = false;
    if (options.stateRoot !== undefined) {
      try {
        await rename(options.stateRoot, join(temporaryRoot, "state"));
        statePreserved = true;
      } catch {
        statePreserved = false;
      }
    }
    const body = {
      kind: "agent-run-diagnostic",
      schemaVersion: 1,
      runId: options.run.runId,
      stage: options.stage,
      statePreserved,
      ...(options.process === undefined
        ? {}
        : {
            process: {
              kind: options.process.kind,
              ...(options.process.kind === "exited"
                ? { exitCode: options.process.exitCode }
                : {}),
              stdout: options.redact(options.process.stdout),
              stderr: options.redact(options.process.stderr),
            },
          }),
      ...(options.error === undefined
        ? {}
        : { error: diagnosticError(options.error, options.redact) }),
    };
    const text = `${JSON.stringify(body, null, 2)}\n`;
    const hash = createHash("sha256").update(text).digest("hex");
    const diagnosticId = `diagnostic-${hash}`;
    const destination = join(diagnosticsRoot, diagnosticId);
    const path = join(temporaryRoot, "diagnostic.json");
    await writeFile(path, text, {
      encoding: "utf8",
      mode: 0o600,
      flag: "wx",
    });
    try {
      await rename(temporaryRoot, destination);
      temporaryRoot = undefined;
    } catch (error: unknown) {
      if (!(
        error instanceof Error &&
        "code" in error &&
        error.code === "EEXIST"
      )) {
        throw error;
      }
      if (
        (await readFile(join(destination, "diagnostic.json"), "utf8")) !== text
      ) {
        throw error;
      }
      if (temporaryRoot === undefined) throw error;
      await rm(temporaryRoot, { recursive: true, force: true });
      temporaryRoot = undefined;
    }
    return {
      kind: "agent-run-diagnostic",
      schemaVersion: 1,
      diagnosticId,
      digest: `sha256:${hash}`,
      bytes: Buffer.byteLength(text),
    };
  } catch {
    if (temporaryRoot !== undefined) {
      await rm(temporaryRoot, { recursive: true, force: true }).catch(
        () => undefined,
      );
    }
    return undefined;
  }
}
