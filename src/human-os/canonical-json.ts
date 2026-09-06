import { z } from "zod";

import {
  canonicalDigest,
  encodeCanonicalJson,
} from "../infrastructure/canonical-json.js";

const jsonValueSchema = z.json();

export function canonicalHumanOsJson(value: unknown): string {
  return encodeCanonicalJson(jsonValueSchema.parse(value));
}

export function humanOsDigest(value: unknown): string {
  return canonicalDigest(value);
}
