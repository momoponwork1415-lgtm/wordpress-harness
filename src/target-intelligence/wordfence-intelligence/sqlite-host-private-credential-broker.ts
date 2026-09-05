import { lstat } from "node:fs/promises";
import { isAbsolute } from "node:path";

import Database from "better-sqlite3";
import { z } from "zod";

import {
  wordfenceSecretRefSchema,
  type HostPrivateCredentialBroker,
  type OpenSqliteHostPrivateCredentialBrokerOptions,
  type WordfenceSecretRef,
} from "./contracts.js";

const expectedSecretRef = "wordfence-v3-api-key";
const expectedProvider = "wordfence";
const expectedPurpose = "wordfence-intelligence-v3-production-feed";

const credentialRowSchema = z.strictObject({
  ref_id: z.literal(expectedSecretRef),
  provider: z.literal(expectedProvider),
  purpose: z.literal(expectedPurpose),
  secret_value: z.string().min(1),
});

class SqliteHostPrivateCredentialBroker implements HostPrivateCredentialBroker {
  readonly #databasePath: string;

  constructor(options: OpenSqliteHostPrivateCredentialBrokerOptions) {
    if (!isAbsolute(options.databasePath)) {
      throw new Error("Credential broker database path must be absolute");
    }
    this.#databasePath = options.databasePath;
  }

  async resolve<T>(
    referenceValue: WordfenceSecretRef,
    use: (credential: string) => Promise<T>,
  ): Promise<T> {
    const reference = wordfenceSecretRefSchema.parse(referenceValue);
    if (reference.id !== expectedSecretRef) {
      throw new Error("Host-private credential is unavailable");
    }
    let credential: string;
    let database: Database.Database | undefined;
    try {
      const metadata = await lstat(this.#databasePath);
      const currentUid = process.getuid?.();
      if (
        !metadata.isFile() ||
        (currentUid !== undefined &&
          (metadata.uid !== currentUid || (metadata.mode & 0o077) !== 0))
      ) {
        throw new Error("Credential broker storage is not host-private");
      }
      database = new Database(this.#databasePath, {
        readonly: true,
        fileMustExist: true,
      });
      const parsed = credentialRowSchema.safeParse(
        database
          .prepare(
            `SELECT ref_id, provider, purpose, secret_value
               FROM secret_values
              WHERE ref_id = ?`,
          )
          .get(reference.id),
      );
      if (!parsed.success) {
        throw new Error("Credential broker row is invalid");
      }
      credential = parsed.data.secret_value;
    } catch {
      throw new Error("Host-private credential is unavailable");
    } finally {
      database?.close();
    }
    return use(credential);
  }
}

export function openSqliteHostPrivateCredentialBroker(
  options: OpenSqliteHostPrivateCredentialBrokerOptions,
): HostPrivateCredentialBroker {
  return new SqliteHostPrivateCredentialBroker(options);
}
