import { z } from "zod";

import {
  canonicalDigest,
  encodeCanonicalJson,
  type JsonValue,
} from "../../infrastructure/canonical-json.js";

const jsonValueSchema = z.json();

export function canonicalJson(value: unknown): string {
  const jsonValue: JsonValue = jsonValueSchema.parse(value);
  return encodeCanonicalJson(jsonValue);
}

export function sha256Digest(value: unknown): string {
  return canonicalDigest(value);
}
