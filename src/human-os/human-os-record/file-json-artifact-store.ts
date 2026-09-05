import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { z } from "zod";

import { canonicalHumanOsJson, humanOsDigest } from "../canonical-json.js";
import type { HumanOsArtifactStore } from "./contracts.js";

const digestSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);

class FileHumanOsArtifactStore implements HumanOsArtifactStore {
  readonly #directory: string;

  constructor(directory: string) {
    this.#directory = resolve(directory);
  }

  async putJson(value: unknown): Promise<string> {
    const digest = humanOsDigest(value);
    await mkdir(this.#directory, { mode: 0o700, recursive: true });
    const destination = this.#artifactPath(digest);
    const temporary = join(
      this.#directory,
      `.${digest.slice("sha256:".length)}.${process.pid}.${randomUUID()}.tmp`,
    );
    await writeFile(temporary, `${canonicalHumanOsJson(value)}\n`, {
      mode: 0o600,
    });
    await rename(temporary, destination);
    return digest;
  }

  async readJson(digestValue: string): Promise<unknown> {
    const digest = digestSchema.parse(digestValue);
    const value: unknown = JSON.parse(
      await readFile(this.#artifactPath(digest), "utf8"),
    );
    if (humanOsDigest(value) !== digest) {
      throw new Error(`Human OS artifact digest mismatch: ${digest}`);
    }
    return value;
  }

  #artifactPath(digestValue: string): string {
    const digest = digestSchema.parse(digestValue);
    return join(this.#directory, `${digest.slice("sha256:".length)}.json`);
  }
}

export function openFileHumanOsArtifactStore(
  directory: string,
): HumanOsArtifactStore {
  return new FileHumanOsArtifactStore(directory);
}
