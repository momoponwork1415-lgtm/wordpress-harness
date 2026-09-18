import { rm, writeFile } from "node:fs/promises";
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
import { PrivateArtifactStore } from "./private-artifact-store.js";

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

export class NativeRunReceiptStore {
  readonly #artifacts: PrivateArtifactStore;

  constructor(rootDirectory: string) {
    this.#artifacts = new PrivateArtifactStore({
      rootDirectory,
      maxEntries: 1,
      maxBytes: MAX_RECEIPT_ARTIFACT_BYTES,
    });
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
    const staging = await this.#artifacts.stage();
    try {
      await writeFile(join(staging.contentDirectory, "receipt.json"), encoded, {
        flag: "wx",
        mode: 0o600,
      });
      const committed = await this.#artifacts.commit(
        runDigest.slice("sha256:".length),
        staging,
      );
      if (committed.status === "conflict") {
        throw new Error("Native Run Receipt artifact conflict");
      }
    } catch (error: unknown) {
      await rm(staging.rootDirectory, { recursive: true, force: true }).catch(
        () => undefined,
      );
      throw error;
    }
  }

  async recover(run: SealedNativeRun): Promise<RecoveryResult> {
    const runDigest = canonicalDigest(run);
    const artifact = await this.#artifacts.readFile(
      runDigest.slice("sha256:".length),
      "receipt.json",
      MAX_RECEIPT_ARTIFACT_BYTES,
    );
    if (artifact.status === "missing") return { status: "missing" };
    if (artifact.status !== "resolved") return { status: "invalid" };
    try {
      const encoded = artifact.bytes.toString("utf8");
      const value = JSON.parse(encoded) as unknown;
      const parsed = nativeRunReceiptArtifactSchema.parse(value);
      if (
        parsed.runDigest !== runDigest ||
        parsed.receipt.runId !== run.runId ||
        parsed.receipt.runtimeProfileDigest !==
          run.agentRuntimeProfile.digest ||
        canonicalDigest(parsed.receipt) !== parsed.nativeRunReceiptDigest ||
        canonicalJson(parsed) !== encoded
      ) {
        return { status: "invalid" };
      }
      return { status: "recovered", receipt: parsed.receipt };
    } catch {
      return { status: "invalid" };
    }
  }
}
