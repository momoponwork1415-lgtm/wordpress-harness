import { z } from "zod";

import { ArtifactIntegrityError } from "../../infrastructure/verified-artifacts.js";

/**
 * Names why rehydrating a stored artifact failed, keeping the three causes apart.
 *
 * A record that reads an artifact back can fail three ways, and each one names
 * a different repair. The store could not produce the artifact; it produced
 * content the digest does not address; or it produced the addressed content
 * and this generation cannot read it. Collapsing any two sends an operator to
 * repair something that is not broken — restoring a file that is present, or
 * rebuilding a store that is intact.
 *
 * The accessor already separates the first two: it raises
 * `ArtifactIntegrityError` for content that does not hash to the digest it was
 * addressed by, including content that is not JSON at all, and lets the
 * schema's own error through only for an artifact that verified. So a schema
 * error here always means the bytes were right and the shape was not, and
 * anything else came from the store before either check could run.
 *
 * Ordering matters: a `ZodError` is only ever `unreadable` because the
 * accessor cannot raise one for content it failed to verify. Reading an
 * artifact without that guarantee and reusing this classifier would report
 * substituted content as a schema move.
 */
export function rehydrationReason<Reason>(
  error: unknown,
  corrupt: Reason,
  unreadable: Reason,
  absent: Reason,
): Reason {
  if (error instanceof ArtifactIntegrityError) return corrupt;
  if (error instanceof z.ZodError) return unreadable;
  return absent;
}
