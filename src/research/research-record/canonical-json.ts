import { createHash } from "node:crypto";

import { z } from "zod";

import {
  encodeCanonicalJson,
  type JsonValue,
} from "../../infrastructure/canonical-json.js";

const jsonValueSchema = z.json();

export function canonicalJson(value: unknown): string {
  const jsonValue: JsonValue = jsonValueSchema.parse(value);
  return encodeCanonicalJson(jsonValue);
}

export function sha256Digest(value: unknown): string {
  return `sha256:${createHash("sha256").update(canonicalJson(value)).digest("hex")}`;
}
