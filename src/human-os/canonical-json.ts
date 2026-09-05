import { createHash } from "node:crypto";

import { z } from "zod";

type JsonPrimitive = boolean | null | number | string;
type JsonValue =
  JsonPrimitive | JsonValue[] | { readonly [key: string]: JsonValue };

const jsonValueSchema = z.json();

function encodeCanonical(value: JsonValue): string {
  if (value === null || typeof value !== "object") {
    const encoded = JSON.stringify(value);
    if (encoded === undefined)
      throw new TypeError("Value is not JSON encodable");
    return encoded;
  }
  if (Array.isArray(value)) {
    return `[${value.map(encodeCanonical).join(",")}]`;
  }
  return `{${Object.keys(value)
    .sort()
    .map((key) => {
      const member = value[key];
      if (member === undefined)
        throw new TypeError(`Missing JSON member: ${key}`);
      return `${JSON.stringify(key)}:${encodeCanonical(member)}`;
    })
    .join(",")}}`;
}

export function canonicalHumanOsJson(value: unknown): string {
  return encodeCanonical(jsonValueSchema.parse(value));
}

export function humanOsDigest(value: unknown): string {
  return `sha256:${createHash("sha256")
    .update(canonicalHumanOsJson(value))
    .digest("hex")}`;
}
