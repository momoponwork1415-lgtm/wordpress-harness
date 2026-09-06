import { describe, expect, it } from "vitest";

import {
  canonicalHumanOsJson,
  humanOsDigest,
} from "../../src/human-os/canonical-json.js";
import {
  canonicalJson as researchJson,
  sha256Digest as researchDigest,
} from "../../src/research/research-record/canonical-json.js";
import {
  canonicalJson as targetJson,
  sha256Digest as targetDigest,
} from "../../src/target-intelligence/acquisition/canonical-json.js";

describe.each([
  { context: "Research", encode: researchJson, digest: researchDigest },
  { context: "Human OS", encode: canonicalHumanOsJson, digest: humanOsDigest },
  { context: "Target Intelligence", encode: targetJson, digest: targetDigest },
])("$context canonical JSON compatibility", ({ encode, digest }) => {
  it("preserves the stored encoding and digest across object insertion order", () => {
    const first = {
      z: [3, true, "line\n文", -0],
      a: { a: null, "2": "two", "10": "ten" },
    };
    const reordered = {
      a: { "10": "ten", "2": "two", a: null },
      z: [3, true, "line\n文", 0],
    };
    const encoded =
      '{"a":{"10":"ten","2":"two","a":null},"z":[3,true,"line\\n文",0]}';
    const storedDigest =
      "sha256:0d202d0c773e590852f7af1a9fa36dacca2f394f0f1fef11757e4c605f34400d";

    expect(encode(first)).toBe(encoded);
    expect(encode(reordered)).toBe(encoded);
    expect(digest(first)).toBe(storedDigest);
    expect(digest(reordered)).toBe(storedDigest);
    expect(digest([1, 2])).not.toBe(digest([2, 1]));
  });

  it("continues rejecting unsupported JSON members", () => {
    for (const value of [undefined, NaN, Infinity, 1n, { a: undefined }]) {
      expect(() => encode(value)).toThrow();
      expect(() => digest(value)).toThrow();
    }
  });
});

it("preserves each context's existing input validation semantics", () => {
  expect(() => researchJson(undefined)).toThrowError(
    expect.objectContaining({ name: "ZodError" }),
  );
  expect(() => canonicalHumanOsJson(undefined)).toThrowError(
    expect.objectContaining({ name: "ZodError" }),
  );
  expect(() => targetJson(undefined)).toThrow(TypeError);
});
