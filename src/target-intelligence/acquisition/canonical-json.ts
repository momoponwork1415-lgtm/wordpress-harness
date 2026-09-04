import { createHash } from "node:crypto";

type JsonPrimitive = boolean | null | number | string;
type JsonValue =
  JsonPrimitive | JsonValue[] | { readonly [key: string]: JsonValue };

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

function encodeCanonical(value: JsonValue): string {
  if (value === null || typeof value !== "object") {
    const encoded = JSON.stringify(value);
    if (encoded === undefined) {
      throw new TypeError("Value is not JSON encodable");
    }
    return encoded;
  }
  if (Array.isArray(value)) {
    return `[${value.map(encodeCanonical).join(",")}]`;
  }
  return `{${Object.keys(value)
    .sort()
    .map((key) => {
      const member = value[key];
      if (member === undefined) {
        throw new TypeError(`Missing JSON member: ${key}`);
      }
      return `${JSON.stringify(key)}:${encodeCanonical(member)}`;
    })
    .join(",")}}`;
}

export function canonicalJson(value: unknown): string {
  if (!isJsonValue(value)) {
    throw new TypeError("Value is not JSON encodable");
  }
  return encodeCanonical(value);
}

export function sha256Digest(value: unknown): string {
  return `sha256:${createHash("sha256").update(canonicalJson(value)).digest("hex")}`;
}
