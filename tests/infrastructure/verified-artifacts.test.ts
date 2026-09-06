import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  ArtifactIntegrityError,
  openVerifiedArtifacts,
  type ContentAddressedStore,
} from "../../src/infrastructure/verified-artifacts.js";
import { canonicalDigest } from "../../src/infrastructure/canonical-json.js";

const subjectSchema = z.strictObject({
  kind: z.literal("subject"),
  name: z.string(),
});

const subject = { kind: "subject" as const, name: "brizy" };

function memoryStore(): ContentAddressedStore {
  const entries = new Map<string, unknown>();
  return {
    putJson: async (value) => {
      const digest = canonicalDigest(value);
      entries.set(digest, value);
      return digest;
    },
    readJson: async (digest) => {
      if (!entries.has(digest)) {
        throw new Error(`Unknown artifact: ${digest}`);
      }
      return entries.get(digest);
    },
  };
}

/** An adapter that lies about what it stored, as an untrusted adapter may. */
function foreignDigestStore(digest: string): ContentAddressedStore {
  return {
    putJson: async () => digest,
    readJson: async () => {
      throw new Error("not reached");
    },
  };
}

/** An adapter that returns content other than the artifact addressed. */
function substitutingStore(value: unknown): ContentAddressedStore {
  return {
    putJson: async () => canonicalDigest(value),
    readJson: async () => value,
  };
}

describe("Verified Artifacts", () => {
  it("stores a value and returns its canonical digest", async () => {
    const artifacts = openVerifiedArtifacts(memoryStore());

    await expect(artifacts.put("Research Thesis", subject)).resolves.toBe(
      canonicalDigest(subject),
    );
  });

  it("rejects a store that returns a digest for other content", async () => {
    const artifacts = openVerifiedArtifacts(
      foreignDigestStore(canonicalDigest({ kind: "subject", name: "other" })),
    );

    await expect(artifacts.put("Research Thesis", subject)).rejects.toThrow(
      "Research Thesis CAS mismatch",
    );
  });

  it("rejects a value whose digest differs from the expected reference", async () => {
    const artifacts = openVerifiedArtifacts(memoryStore());

    await expect(
      artifacts.put(
        "Research Thesis",
        subject,
        canonicalDigest({ other: true }),
      ),
    ).rejects.toThrow(ArtifactIntegrityError);
  });

  it("reads, verifies, and parses a stored artifact", async () => {
    const artifacts = openVerifiedArtifacts(memoryStore());
    const digest = await artifacts.put("Research Thesis", subject);

    await expect(
      artifacts.read("Research Thesis", subjectSchema, digest),
    ).resolves.toEqual(subject);
  });

  it("rejects content the adapter substituted for the addressed artifact", async () => {
    const substituted = { kind: "subject" as const, name: "other" };
    const artifacts = openVerifiedArtifacts(substitutingStore(substituted));

    await expect(
      artifacts.read(
        "Research Thesis",
        subjectSchema,
        canonicalDigest(subject),
      ),
    ).rejects.toThrow("Research Thesis CAS mismatch");
  });

  it("verifies the stored bytes before applying the schema", async () => {
    // Content that fails BOTH the digest check and the schema. The integrity
    // failure must win: a caller that parses first would report a shape error
    // and hide the fact that the adapter served the wrong artifact.
    const artifacts = openVerifiedArtifacts(substitutingStore({ junk: true }));

    await expect(
      artifacts.read(
        "Research Thesis",
        subjectSchema,
        canonicalDigest(subject),
      ),
    ).rejects.toThrow(ArtifactIntegrityError);
  });

  it("rejects content that is not an artifact at all as an integrity failure", async () => {
    // A store that answers with something outside JSON did not serve the
    // artifact addressed. Reported as a shape failure it would read as "the
    // artifact is the wrong version", sending a caller after the schema.
    const artifacts = openVerifiedArtifacts({
      putJson: async () => canonicalDigest(subject),
      readJson: async () => undefined,
    });

    await expect(
      artifacts.read(
        "Research Thesis",
        subjectSchema,
        canonicalDigest(subject),
      ),
    ).rejects.toThrow(ArtifactIntegrityError);
  });

  it("reports the schema failure when the artifact is intact but the wrong shape", async () => {
    const store = memoryStore();
    const artifacts = openVerifiedArtifacts(store);
    const digest = await store.putJson({ kind: "subject", extra: 1 });

    await expect(
      artifacts.read("Research Thesis", subjectSchema, digest),
    ).rejects.toThrow(z.ZodError);
  });

  it("names the artifact and digest on the integrity error", async () => {
    const artifacts = openVerifiedArtifacts(substitutingStore({ junk: true }));
    const digest = canonicalDigest(subject);

    await expect(
      artifacts.read("Research Thesis", subjectSchema, digest),
    ).rejects.toMatchObject({ artifact: "Research Thesis", digest });
  });
});
