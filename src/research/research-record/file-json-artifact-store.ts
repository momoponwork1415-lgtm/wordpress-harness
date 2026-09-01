import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { z } from "zod";

import { canonicalJson, sha256Digest } from "./canonical-json.js";
import type { JsonArtifactStore } from "./contracts.js";

const digestSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);

class FileJsonArtifactStore implements JsonArtifactStore {
  readonly #directory: string;

  constructor(directory: string) {
    this.#directory = resolve(directory);
  }

  async putJson(value: unknown): Promise<string> {
    const digest = sha256Digest(value);
    const content = canonicalJson(value);
    await mkdir(this.#directory, { mode: 0o700, recursive: true });
    const destination = this.#artifactPath(digest);
    const temporary = join(
      this.#directory,
      `.${digest.slice("sha256:".length)}.${process.pid}.${randomUUID()}.tmp`,
    );
    await writeFile(temporary, `${content}\n`, { mode: 0o600 });
    await rename(temporary, destination);
    return digest;
  }

  async readJson(digest: string): Promise<unknown> {
    const parsedDigest = digestSchema.parse(digest);
    const content = await readFile(this.#artifactPath(parsedDigest), "utf8");
    const value: unknown = JSON.parse(content);
    if (sha256Digest(value) !== parsedDigest) {
      throw new Error(`Artifact digest mismatch: ${parsedDigest}`);
    }
    return value;
  }

  #artifactPath(digest: string): string {
    const parsedDigest = digestSchema.parse(digest);
    return join(
      this.#directory,
      `${parsedDigest.slice("sha256:".length)}.json`,
    );
  }
}

export function openFileJsonArtifactStore(
  directory: string,
): JsonArtifactStore {
  return new FileJsonArtifactStore(directory);
}
