import { createHash } from "node:crypto";

import { z } from "zod";

import { encodeCanonicalJson } from "../infrastructure/canonical-json.js";

const jsonValueSchema = z.json();

export function canonicalHumanOsJson(value: unknown): string {
  return encodeCanonicalJson(jsonValueSchema.parse(value));
}

export function humanOsDigest(value: unknown): string {
  return `sha256:${createHash("sha256")
    .update(canonicalHumanOsJson(value))
    .digest("hex")}`;
}
