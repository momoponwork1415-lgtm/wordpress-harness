import { describe, expect, it } from "vitest";
import { z } from "zod";

import { canonicalDigest } from "../../src/infrastructure/canonical-json.js";
import {
  ArtifactIntegrityError,
  openVerifiedArtifacts,
} from "../../src/infrastructure/verified-artifacts.js";
import { rehydrationReason } from "../../src/research/research-record/rehydration-reason.js";

const subjectSchema = z.strictObject({
  kind: z.literal("subject"),
  name: z.string(),
});

const subject = { kind: "subject" as const, name: "brizy" };

/** Classify whatever the accessor raises, the way a record reading back does. */
async function reasonFor(
  store: {
    putJson(value: unknown): Promise<string>;
    readJson(digest: string): Promise<unknown>;
  },
  digest: string,
): Promise<string> {
  try {
    await openVerifiedArtifacts(store).read("Finding", subjectSchema, digest);
    return "read";
  } catch (error: unknown) {
    return rehydrationReason(
      error,
      "cas-mismatch",
      "schema-unsupported",
      "missing",
    );
  }
}

describe("Rehydration reason", () => {
  it("names a store that cannot produce the artifact as missing", async () => {
    const reason = await reasonFor(
      {
        putJson: async () => canonicalDigest(subject),
        readJson: async () => {
          throw new Error("ENOENT: no such file or directory");
        },
      },
      canonicalDigest(subject),
    );

    expect(reason).toBe("missing");
  });

  it("names content the digest does not address as a CAS mismatch", async () => {
    // The file store raises a plain Error for this, so a record that caught
    // every read failure alike reported corruption as absence — and sent an
    // operator to restore a file that was there all along.
    const reason = await reasonFor(
      {
        putJson: async () => canonicalDigest(subject),
        readJson: async () => ({ kind: "subject", name: "other" }),
      },
      canonicalDigest(subject),
    );

    expect(reason).toBe("cas-mismatch");
  });

  it("names an artifact this generation cannot read as schema-unsupported", async () => {
    const stored = { kind: "subject", name: "brizy", added: "later" };
    const reason = await reasonFor(
      {
        putJson: async () => canonicalDigest(stored),
        readJson: async () => stored,
      },
      canonicalDigest(stored),
    );

    expect(reason).toBe("schema-unsupported");
  });

  it("does not call unverified content a schema move", async () => {
    // The ordering the classifier depends on: content that fails both the
    // digest and the schema must reach it as an integrity error, because the
    // accessor verifies before parsing. Were that reversed, a store serving
    // the wrong artifact would be reported as a schema move.
    const reason = await reasonFor(
      {
        putJson: async () => canonicalDigest(subject),
        readJson: async () => ({ entirely: "different" }),
      },
      canonicalDigest(subject),
    );

    expect(reason).toBe("cas-mismatch");
  });

  it("classifies each cause by what it is, not by the order it is checked", () => {
    expect(
      rehydrationReason(
        new ArtifactIntegrityError("Finding", "sha256:00"),
        "cas-mismatch",
        "schema-unsupported",
        "missing",
      ),
    ).toBe("cas-mismatch");
    expect(
      rehydrationReason(
        subjectSchema.safeParse({}).error,
        "cas-mismatch",
        "schema-unsupported",
        "missing",
      ),
    ).toBe("schema-unsupported");
    expect(
      rehydrationReason(
        undefined,
        "cas-mismatch",
        "schema-unsupported",
        "missing",
      ),
    ).toBe("missing");
  });
});
