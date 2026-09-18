import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";

import { z } from "zod";

import {
  canonicalDigest,
  canonicalJson,
} from "../../infrastructure/canonical-json.js";
import {
  nativeRunReceiptSchema,
  type NativeRunReceipt,
  type SealedNativeRun,
} from "./contracts.js";

const MAX_RECEIPT_ARTIFACT_BYTES = 8 * 1024 * 1024;
const digestSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const nativeRunReceiptArtifactSchema = z.strictObject({
  kind: z.literal("native-run-receipt-artifact"),
  schemaVersion: z.literal(1),
  runDigest: digestSchema,
  nativeRunReceiptDigest: digestSchema,
  receipt: nativeRunReceiptSchema,
});

type RecoveryResult =
  | { readonly status: "recovered"; readonly receipt: NativeRunReceipt }
  | { readonly status: "missing" | "invalid" };

function isFileSystemError(
  error: unknown,
  code: string,
): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === code;
}

export class NativeRunReceiptStore {
  readonly #rootDirectory: string;

  constructor(rootDirectory: string) {
    this.#rootDirectory = rootDirectory;
  }

  async finalize(
    run: SealedNativeRun,
    receipt: NativeRunReceipt,
  ): Promise<void> {
    const runDigest = canonicalDigest(run);
    const body = nativeRunReceiptArtifactSchema.parse({
      kind: "native-run-receipt-artifact",
      schemaVersion: 1,
      runDigest,
      nativeRunReceiptDigest: canonicalDigest(receipt),
      receipt,
    });
    const encoded = Buffer.from(canonicalJson(body), "utf8");
    if (encoded.byteLength > MAX_RECEIPT_ARTIFACT_BYTES) {
      throw new Error("Native Run Receipt artifact exceeds its byte limit");
    }
    await this.#prepareRoot();
    const destination = this.#destination(runDigest);
    const temporaryDirectory = await mkdtemp(
      join(this.#rootDirectory, "active-receipt-"),
    );
    try {
      await writeFile(join(temporaryDirectory, "receipt.json"), encoded, {
        flag: "wx",
        mode: 0o600,
      });
      try {
        await rename(temporaryDirectory, destination);
      } catch (error: unknown) {
        if (!isFileSystemError(error, "EEXIST")) throw error;
        const existing = await this.#read(destination);
        if (existing === undefined || !existing.equals(encoded)) {
          throw new Error("Native Run Receipt artifact conflict");
        }
        await rm(temporaryDirectory, { recursive: true, force: true });
      }
    } catch (error: unknown) {
      await rm(temporaryDirectory, { recursive: true, force: true }).catch(
        () => undefined,
      );
      throw error;
    }
  }

  async recover(run: SealedNativeRun): Promise<RecoveryResult> {
    const runDigest = canonicalDigest(run);
    let encoded: Buffer | undefined;
    try {
      encoded = await this.#read(this.#destination(runDigest));
    } catch {
      return { status: "invalid" };
    }
    if (encoded === undefined) return { status: "missing" };
    try {
      const value = JSON.parse(encoded.toString("utf8")) as unknown;
      const artifact = nativeRunReceiptArtifactSchema.parse(value);
      if (
        artifact.runDigest !== runDigest ||
        artifact.receipt.runId !== run.runId ||
        artifact.receipt.runtimeProfileDigest !==
          run.agentRuntimeProfile.digest ||
        canonicalDigest(artifact.receipt) !== artifact.nativeRunReceiptDigest ||
        canonicalJson(artifact) !== encoded.toString("utf8")
      ) {
        return { status: "invalid" };
      }
      return { status: "recovered", receipt: artifact.receipt };
    } catch {
      return { status: "invalid" };
    }
  }

  async #prepareRoot(): Promise<void> {
    await mkdir(this.#rootDirectory, { recursive: true, mode: 0o700 });
    const stat = await lstat(this.#rootDirectory);
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw new Error("Native Run Receipt artifact root is unsafe");
    }
    await chmod(this.#rootDirectory, 0o700);
  }

  #destination(runDigest: string): string {
    return join(this.#rootDirectory, runDigest.slice("sha256:".length));
  }

  async #read(destination: string): Promise<Buffer | undefined> {
    try {
      const directoryStat = await lstat(destination);
      if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) {
        throw new Error("Native Run Receipt artifact directory is unsafe");
      }
      const path = join(destination, "receipt.json");
      const fileStat = await lstat(path);
      if (
        !fileStat.isFile() ||
        fileStat.isSymbolicLink() ||
        fileStat.nlink !== 1 ||
        fileStat.size > MAX_RECEIPT_ARTIFACT_BYTES
      ) {
        throw new Error("Native Run Receipt artifact is unsafe");
      }
      return await readFile(path);
    } catch (error: unknown) {
      if (isFileSystemError(error, "ENOENT")) return undefined;
      throw error;
    }
  }
}
