import { COPYFILE_EXCL } from "node:constants";
import {
  chmod,
  copyFile,
  readFile,
  realpath,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";

import { z } from "zod";

export const providerFileNameSchema = z
  .string()
  .regex(/^[A-Za-z0-9.][A-Za-z0-9._-]*$/)
  .refine((value) => value !== "." && value !== "..");

const providerEnvironmentNameSchema = z.string().regex(/^[A-Z][A-Z0-9_]*$/);

function credentialSecrets(text: string): readonly string[] {
  const secrets = new Set<string>();
  const add = (value: string): void => {
    if (value.length >= 8 && value.length <= 16_384 && secrets.size < 256) {
      secrets.add(value);
    }
  };
  const visit = (value: unknown): void => {
    if (typeof value === "string") {
      add(value);
      return;
    }
    if (Array.isArray(value)) {
      for (const entry of value) visit(entry);
      return;
    }
    if (typeof value === "object" && value !== null) {
      for (const entry of Object.values(value)) visit(entry);
    }
  };
  const trimmed = text.trim();
  if (trimmed.length > 0) add(trimmed);
  for (const line of text.split(/\r?\n/u)) add(line.trim());
  try {
    visit(JSON.parse(text));
  } catch {
    // Non-JSON credential files are covered by exact file and line values.
  }
  return [...secrets].sort((left, right) => right.length - left.length);
}

/** Owns copied credential files and the values to redact from diagnostics. */
export class ProviderCredentialFiles {
  readonly #filenames: readonly string[];
  readonly #generatedFilenames = new Set<string>();
  readonly #secrets: string[] = [];

  constructor(filenames: readonly string[]) {
    this.#filenames = filenames;
  }

  async copyTo(
    sourceDirectory: string,
    destinationDirectory: string,
  ): Promise<void> {
    for (const candidate of this.#filenames) {
      const filename = providerFileNameSchema.parse(candidate);
      const source = await realpath(join(sourceDirectory, filename));
      if (
        !source.startsWith(`${sourceDirectory}/`) ||
        !(await stat(source)).isFile()
      ) {
        throw new Error("Provider credential is outside the bound directory");
      }
      const destination = join(destinationDirectory, filename);
      this.#secrets.push(...credentialSecrets(await readFile(source, "utf8")));
      await copyFile(source, destination, COPYFILE_EXCL);
      await chmod(destination, 0o600);
    }
  }

  async removeFrom(directory: string): Promise<void> {
    for (const candidate of [...this.#filenames, ...this.#generatedFilenames]) {
      const filename = providerFileNameSchema.parse(candidate);
      await rm(join(directory, filename), { force: true });
    }
  }

  async stageEnvironmentSettings(
    destinationDirectory: string,
    environment: readonly { readonly name: string; readonly value: string }[],
  ): Promise<void> {
    if (environment.length === 0) {
      throw new Error("Provider environment credentials are empty");
    }
    const values: Record<string, string> = {};
    for (const entry of environment) {
      const name = providerEnvironmentNameSchema.parse(entry.name);
      if (Object.hasOwn(values, name)) {
        throw new Error(`Duplicate provider environment credential: ${name}`);
      }
      if (
        entry.value.length === 0 ||
        entry.value.length > 16_384 ||
        /[\0\r\n]/u.test(entry.value)
      ) {
        throw new Error("Provider environment credential is invalid");
      }
      values[name] = entry.value;
      this.#secrets.push(...credentialSecrets(entry.value));
    }
    const filename = "settings.json";
    await writeFile(
      join(destinationDirectory, filename),
      `${JSON.stringify({ env: values })}\n`,
      { encoding: "utf8", mode: 0o600, flag: "wx" },
    );
    this.#generatedFilenames.add(filename);
  }

  readonly redact = (text: string): string => {
    let redacted = text;
    for (const secret of this.#secrets) {
      redacted = redacted.split(secret).join("[REDACTED]");
    }
    return redacted;
  };
}
