import { chmod, mkdir, open, type FileHandle } from "node:fs/promises";
import { dirname, isAbsolute } from "node:path";

import { canonicalJson } from "../research-record/canonical-json.js";
import type { ModelProcessResult } from "./contracts.js";

interface ModelProcessObservationBase {
  readonly schemaVersion: 1;
  readonly operationId: string;
  readonly phase: "version-probe" | "auth-probe" | "inference";
  readonly segmentOrdinal: number;
  readonly occurredAt: string;
}

export type ModelProcessObservation =
  | (ModelProcessObservationBase & {
      readonly kind: "model-process-started";
    })
  | (ModelProcessObservationBase & {
      readonly kind: "model-process-heartbeat";
      readonly elapsedMs: number;
    })
  | (ModelProcessObservationBase & {
      readonly kind: "model-process-completed";
      readonly elapsedMs: number;
      readonly result: ModelProcessResult;
    })
  | (ModelProcessObservationBase & {
      readonly kind: "model-process-failed";
      readonly elapsedMs: number;
      readonly reason: "spawn-failed" | "stdin-failed";
    })
  | (ModelProcessObservationBase & {
      readonly kind: "model-tool-started";
      readonly toolName: string;
      readonly toolOrdinal: number;
    })
  | (ModelProcessObservationBase & {
      readonly kind: "model-tool-completed";
      readonly toolName: string;
      readonly toolOrdinal: number;
      readonly resultStatus:
        | "completed"
        | "identity-mismatch"
        | "invalid-query"
        | "truncated"
        | "not-found"
        | "partial"
        | "policy-denied"
        | "budget-exhausted";
      readonly receiptDigest?: string;
    })
  | (ModelProcessObservationBase & {
      readonly kind: "model-tool-failed";
      readonly toolName: string;
      readonly toolOrdinal: number;
      readonly reason: "tool-call-threw";
    });

export interface ModelProcessObserver {
  observe(event: ModelProcessObservation): void;
}

export interface OpenPrivateModelTranscriptOptions {
  readonly filePath: string;
  readonly onDiagnostic?: (message: string) => void;
}

export interface PrivateModelTranscript {
  readonly observer: ModelProcessObserver;
  close(): Promise<void>;
}

class JsonLinesPrivateModelTranscript implements PrivateModelTranscript {
  readonly observer: ModelProcessObserver;
  readonly #options: OpenPrivateModelTranscriptOptions;
  #pending: Promise<void> = Promise.resolve();
  #file: FileHandle | undefined;
  #closed = false;
  #failed = false;
  #closePromise: Promise<void> | undefined;

  constructor(options: OpenPrivateModelTranscriptOptions) {
    if (!isAbsolute(options.filePath)) {
      throw new Error("Private model transcript path must be absolute");
    }
    this.#options = options;
    this.observer = {
      observe: (event) => this.#enqueue(event),
    };
  }

  close(): Promise<void> {
    this.#closePromise ??= this.#close();
    return this.#closePromise;
  }

  #enqueue(event: ModelProcessObservation): void {
    if (this.#closed || this.#failed) return;
    this.#pending = this.#pending
      .then(async () => {
        this.#file ??= await this.#open();
        await this.#file.appendFile(`${canonicalJson(event)}\n`, "utf8");
        await this.#file.sync();
      })
      .catch((error: unknown) => {
        this.#failed = true;
        this.#diagnose(error);
      });
  }

  async #open(): Promise<FileHandle> {
    const directory = dirname(this.#options.filePath);
    await mkdir(directory, {
      mode: 0o700,
      recursive: true,
    });
    await chmod(directory, 0o700);
    const file = await open(this.#options.filePath, "a", 0o600);
    try {
      await file.chmod(0o600);
      return file;
    } catch (error: unknown) {
      await file.close().catch(() => undefined);
      throw error;
    }
  }

  async #close(): Promise<void> {
    this.#closed = true;
    await this.#pending;
    const file = this.#file;
    this.#file = undefined;
    if (file === undefined) return;
    try {
      await file.sync();
    } catch (error: unknown) {
      this.#diagnose(error);
    }
    try {
      await file.close();
    } catch (error: unknown) {
      this.#diagnose(error);
    }
  }

  #diagnose(error: unknown): void {
    const message = `Private model transcript disabled: ${
      error instanceof Error ? error.message : String(error)
    }`;
    try {
      this.#options.onDiagnostic?.(message);
    } catch {
      // Observability must not change the research process.
    }
  }
}

export function openPrivateModelTranscript(
  options: OpenPrivateModelTranscriptOptions,
): PrivateModelTranscript {
  return new JsonLinesPrivateModelTranscript(options);
}
