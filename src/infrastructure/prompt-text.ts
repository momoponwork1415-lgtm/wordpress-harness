import { createHash } from "node:crypto";

export function promptTextDigest(text: string): string {
  return `sha256:${createHash("sha256").update(text, "utf8").digest("hex")}`;
}
