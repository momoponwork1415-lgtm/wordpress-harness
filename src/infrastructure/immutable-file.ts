import { randomUUID } from "node:crypto";
import { link, open, unlink } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

function hasCode(value: unknown, code: string): boolean {
  return value instanceof Error && "code" in value && value.code === code;
}

/** Publish without replacing existing content; its owner verifies reuse. */
export async function publishImmutableFile(
  destination: string,
  content: string | Uint8Array,
  verifyExisting: () => Promise<unknown>,
): Promise<void> {
  const temporary = join(
    dirname(destination),
    `.${basename(destination)}.${process.pid}.${randomUUID()}.tmp`,
  );
  const handle = await open(temporary, "wx", 0o600);
  let completed = false;
  try {
    await handle.writeFile(content);
    await handle.close();
    try {
      await link(temporary, destination);
    } catch (error) {
      if (!hasCode(error, "EEXIST")) throw error;
      await verifyExisting();
    }
    completed = true;
  } finally {
    const cleanupErrors: unknown[] = [];
    try {
      await handle.close();
    } catch (error) {
      cleanupErrors.push(error);
    }
    try {
      await unlink(temporary);
    } catch (error) {
      if (!hasCode(error, "ENOENT")) cleanupErrors.push(error);
    }
    if (completed && cleanupErrors.length > 0) throw cleanupErrors[0];
  }
}
