import type { z } from "zod";

import { canonicalDigest } from "./canonical-json.js";

/**
 * The two methods this module needs from a content-addressed store.
 *
 * Both contexts declare their own store contract — `JsonArtifactStore` in the
 * Research record, `HumanOsArtifactStore` in the Human OS record — and both
 * satisfy this shape, so neither has to be imported here and callers pass the
 * store type their own context already names.
 */
export interface ContentAddressedStore {
  putJson(value: unknown): Promise<string>;
  readJson(digest: string): Promise<unknown>;
}

/**
 * A content-addressed artifact did not match the digest it was addressed by.
 *
 * Raised for both directions: a store that reports a digest for content other
 * than what it was handed, and a store that serves content other than the
 * artifact addressed.
 */
export class ArtifactIntegrityError extends Error {
  readonly artifact: string;
  readonly digest: string;

  constructor(artifact: string, digest: string) {
    super(`${artifact} CAS mismatch: ${digest}`);
    this.name = "ArtifactIntegrityError";
    this.artifact = artifact;
    this.digest = digest;
  }
}

/**
 * Content-addressed artifact access that does not trust its adapter.
 *
 * A store seam promises nothing about integrity: an adapter may report a
 * digest for content it did not store, or serve content other than the
 * artifact addressed. Callers therefore have to verify every read and every
 * write against the canonical digest, and parse what comes back. This module
 * owns that obligation so no caller carries it.
 *
 * Reads verify the stored bytes before applying the schema. The reverse order
 * reports a shape error for content the adapter substituted, hiding the
 * integrity failure behind a validation failure.
 */
export interface VerifiedArtifacts {
  /**
   * Stores `value` and returns its digest.
   *
   * Throws `ArtifactIntegrityError` unless the store reports the canonical
   * digest of `value`. Pass `expected` to additionally require that digest to
   * equal a reference the caller already holds.
   */
  put(artifact: string, value: unknown, expected?: string): Promise<string>;

  /**
   * Reads the artifact at `digest`, verifies the stored bytes against it, and
   * parses the result with `schema`.
   *
   * Throws `ArtifactIntegrityError` when the content does not hash to
   * `digest`, and the schema's own error when the artifact is intact but does
   * not satisfy `schema`.
   */
  read<Schema extends z.ZodType>(
    artifact: string,
    schema: Schema,
    digest: string,
  ): Promise<z.output<Schema>>;
}

class StoreBackedVerifiedArtifacts implements VerifiedArtifacts {
  readonly #store: ContentAddressedStore;

  constructor(store: ContentAddressedStore) {
    this.#store = store;
  }

  async put(
    artifact: string,
    value: unknown,
    expected?: string,
  ): Promise<string> {
    const canonical = canonicalDigest(value);
    if (expected !== undefined && expected !== canonical) {
      throw new ArtifactIntegrityError(artifact, expected);
    }
    const stored = await this.#store.putJson(value);
    if (stored !== canonical) {
      throw new ArtifactIntegrityError(artifact, canonical);
    }
    return stored;
  }

  async read<Schema extends z.ZodType>(
    artifact: string,
    schema: Schema,
    digest: string,
  ): Promise<z.output<Schema>> {
    const value = await this.#store.readJson(digest);
    if (canonicalDigest(value) !== digest) {
      throw new ArtifactIntegrityError(artifact, digest);
    }
    return schema.parse(value);
  }
}

export function openVerifiedArtifacts(
  store: ContentAddressedStore,
): VerifiedArtifacts {
  return new StoreBackedVerifiedArtifacts(store);
}
