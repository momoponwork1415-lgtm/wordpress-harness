import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { z } from "zod";

import type { HumanOsPrivateArtifactStore } from "../ai-reproduction.js";
import {
  privateEvidenceBundleSchema,
  reproductionRecipeSchema,
} from "../ai-reproduction-contracts.js";
import { canonicalHumanOsJson, humanOsDigest } from "../canonical-json.js";

const digestSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const privateArtifactSchema = z.union([
  reproductionRecipeSchema,
  privateEvidenceBundleSchema,
]);

class FileHumanOsPrivateArtifactStore implements HumanOsPrivateArtifactStore {
  readonly #directory: string;

  constructor(directory: string) {
    this.#directory = resolve(directory);
  }

  async putPrivateJson(value: unknown): Promise<string> {
    const artifact = privateArtifactSchema.parse(value);
    const digest = humanOsDigest(artifact);
    await mkdir(this.#directory, { mode: 0o700, recursive: true });
    const destination = this.#artifactPath(digest);
    const temporary = join(
      this.#directory,
      `.${digest.slice("sha256:".length)}.${process.pid}.${randomUUID()}.tmp`,
    );
    await writeFile(temporary, `${canonicalHumanOsJson(artifact)}\n`, {
      mode: 0o600,
    });
    await rename(temporary, destination);
    return digest;
  }

  async readPrivateJson(digestValue: string): Promise<unknown> {
    const digest = digestSchema.parse(digestValue);
    const artifact = privateArtifactSchema.parse(
      JSON.parse(await readFile(this.#artifactPath(digest), "utf8")),
    );
    if (humanOsDigest(artifact) !== digest) {
      throw new Error(`Human OS private artifact digest mismatch: ${digest}`);
    }
    return artifact;
  }

  async putPrivateBytes(value: Uint8Array): Promise<string> {
    const digest = `sha256:${createHash("sha256").update(value).digest("hex")}`;
    await mkdir(this.#directory, { mode: 0o700, recursive: true });
    const destination = this.#blobPath(digest);
    const temporary = join(
      this.#directory,
      `.${digest.slice("sha256:".length)}.${process.pid}.${randomUUID()}.tmp`,
    );
    await writeFile(temporary, value, { mode: 0o600 });
    await rename(temporary, destination);
    return digest;
  }

  async readPrivateBytes(digestValue: string): Promise<Uint8Array> {
    const digest = digestSchema.parse(digestValue);
    const value = await readFile(this.#blobPath(digest));
    const actual = `sha256:${createHash("sha256").update(value).digest("hex")}`;
    if (actual !== digest) {
      throw new Error(`Human OS private blob digest mismatch: ${digest}`);
    }
    return value;
  }

  #artifactPath(digestValue: string): string {
    const digest = digestSchema.parse(digestValue);
    return join(this.#directory, `${digest.slice("sha256:".length)}.json`);
  }

  #blobPath(digestValue: string): string {
    const digest = digestSchema.parse(digestValue);
    return join(this.#directory, `${digest.slice("sha256:".length)}.blob`);
  }
}

export function openFileHumanOsPrivateArtifactStore(
  directory: string,
): HumanOsPrivateArtifactStore {
  return new FileHumanOsPrivateArtifactStore(directory);
}
