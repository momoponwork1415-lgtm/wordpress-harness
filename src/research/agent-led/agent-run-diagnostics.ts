import { createHash } from "node:crypto";
import { rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { PrivateArtifactStore } from "../../infrastructure/private-artifact-store.js";
import type { NativeModelProcessResult } from "../../infrastructure/native-model-process.js";
import type {
  AgentRunDiagnosticRef,
  AgentRunFailureStage,
  SealedNativeRun,
} from "./contracts.js";

const diagnosticLimits = {
  maxEntries: 20_000,
  maxBytes: 128 * 1024 * 1024,
} as const;

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
  const artifacts = new PrivateArtifactStore({
    rootDirectory: join(options.scratchRootDirectory, "agent-diagnostics"),
    ...diagnosticLimits,
  });
  const preservationAttempts =
    options.stateRoot === undefined ? [false] : [true, false];
  for (const preserveState of preservationAttempts) {
    let temporaryRoot: string | undefined;
    try {
      const staging = await artifacts.stage();
      temporaryRoot = staging.rootDirectory;
      let statePreserved = false;
      if (preserveState && options.stateRoot !== undefined) {
        try {
          await rename(
            options.stateRoot,
            join(staging.contentDirectory, "state"),
          );
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
      await writeFile(join(staging.contentDirectory, "diagnostic.json"), text, {
        encoding: "utf8",
        mode: 0o600,
        flag: "wx",
      });
      const committed = await artifacts.commit(diagnosticId, staging);
      if (committed.status === "conflict") {
        throw new Error("Agent Run Diagnostic artifact conflict");
      }
      temporaryRoot = undefined;
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
      if (!preserveState) return undefined;
    }
  }
  return undefined;
}
