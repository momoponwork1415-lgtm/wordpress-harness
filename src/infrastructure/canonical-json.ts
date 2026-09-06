type JsonPrimitive = boolean | null | number | string;

export type JsonValue =
  JsonPrimitive | JsonValue[] | { readonly [key: string]: JsonValue };

/** Encode already-validated JSON without changing persisted byte ordering. */
export function encodeCanonicalJson(value: JsonValue): string {
  if (value === null || typeof value !== "object") {
    const encoded = JSON.stringify(value);
    if (encoded === undefined) {
      throw new TypeError("Value is not JSON encodable");
    }
    return encoded;
  }

  if (Array.isArray(value)) {
    return `[${value.map(encodeCanonicalJson).join(",")}]`;
  }

  const members = Object.keys(value)
    .sort()
    .map((key) => {
      const member = value[key];
      if (member === undefined) {
        throw new TypeError(`Missing JSON member: ${key}`);
      }
      return `${JSON.stringify(key)}:${encodeCanonicalJson(member)}`;
    });

  return `{${members.join(",")}}`;
}
