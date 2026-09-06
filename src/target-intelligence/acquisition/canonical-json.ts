import { createHash } from "node:crypto";

import {
  encodeCanonicalJson,
  type JsonValue,
} from "../../infrastructure/canonical-json.js";

function isJsonValue(value: unknown): value is JsonValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return true;
  }
  if (typeof value === "number") {
    return Number.isFinite(value);
  }
  if (Array.isArray(value)) {
    return value.every(isJsonValue);
  }
  if (typeof value !== "object") {
    return false;
  }
  return Object.values(value).every(isJsonValue);
}

export function canonicalJson(value: unknown): string {
  if (!isJsonValue(value)) {
    throw new TypeError("Value is not JSON encodable");
  }
  return encodeCanonicalJson(value);
}

export function sha256Digest(value: unknown): string {
  return `sha256:${createHash("sha256").update(canonicalJson(value)).digest("hex")}`;
}
