import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { humanOsDigest } from "../../src/human-os/canonical-json.js";
import { openFileHumanOsArtifactStore } from "../../src/human-os/human-os-record/file-json-artifact-store.js";
import { openFileHumanOsPrivateArtifactStore } from "../../src/human-os/human-os-record/file-private-artifact-store.js";
import { openFileJsonArtifactStore } from "../../src/research/research-record/file-json-artifact-store.js";

const emptyEvidenceIdentity = {
  kind: "private-evidence-bundle",
  schemaVersion: 2,
  attemptId: `sha256:${"1".repeat(64)}`,
  targetSnapshotDigest: `sha256:${"2".repeat(64)}`,
  collectedAt: "2026-09-06T00:00:00.000Z",
  evidence: {
    exactPayloads: [],
    rawHttpRequests: [],
    screenshots: [],
    runtimeLogs: [],
    redaction: {
      credentialsIncluded: false,
      cookiesIncluded: false,
      privateTranscriptIncluded: false,
      hostInformationIncluded: false,
    },
  },
};
const emptyEvidence = {
  ...emptyEvidenceIdentity,
  id: humanOsDigest(emptyEvidenceIdentity),
};

const stores = [
  {
    name: "Research JSON",
    extension: "json",
    open(directory: string) {
      const store = openFileJsonArtifactStore(directory);
      return {
        put: () => store.putJson({ example: "synthetic artifact" }),
        read: (digest: string) => store.readJson(digest),
      };
    },
  },
  {
    name: "Human OS JSON",
    extension: "json",
    open(directory: string) {
      const store = openFileHumanOsArtifactStore(directory);
      return {
        put: () => store.putJson({ example: "synthetic artifact" }),
        read: (digest: string) => store.readJson(digest),
      };
    },
  },
  {
    name: "Human OS private JSON",
    extension: "json",
    open(directory: string) {
      const store = openFileHumanOsPrivateArtifactStore(directory);
      return {
        put: () => store.putPrivateJson(emptyEvidence),
        read: (digest: string) => store.readPrivateJson(digest),
      };
    },
  },
  {
    name: "Human OS private bytes",
    extension: "blob",
    open(directory: string) {
      const store = openFileHumanOsPrivateArtifactStore(directory);
      return {
        put: () =>
          store.putPrivateBytes(new TextEncoder().encode("synthetic bytes")),
        read: (digest: string) => store.readPrivateBytes(digest),
      };
    },
  },
];

describe.each(stores)("$name immutable publication", ({ open, extension }) => {
  it("reuses concurrent identical writes and retains content across reopen", async () => {
    const directory = await mkdtemp(join(tmpdir(), "harness-cas-integrity-"));
    try {
      const store = open(directory);
      const digest = await store.put();
      const path = join(directory, `${digest.slice(7)}.${extension}`);
      const content = await readFile(path);
      const value = await store.read(digest);
      const repeated = await Promise.all(
        Array.from({ length: 4 }, () => open(directory).put()),
      );
      expect(repeated).toEqual(Array.from({ length: 4 }, () => digest));
      expect(await open(directory).read(digest)).toEqual(value);
      expect(await readFile(path)).toEqual(content);
      expect(await readdir(directory)).toEqual([
        `${digest.slice(7)}.${extension}`,
      ]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("rejects a retry over corrupt content without replacing the evidence", async () => {
    const directory = await mkdtemp(join(tmpdir(), "harness-cas-integrity-"));
    try {
      const store = open(directory);
      const digest = await store.put();
      const path = join(directory, `${digest.slice(7)}.${extension}`);
      const corruptContent = "{}\n";
      await writeFile(path, corruptContent);
      await expect(store.read(digest)).rejects.toThrow();
      await expect(open(directory).put()).rejects.toThrow();
      expect(await readFile(path, "utf8")).toBe(corruptContent);
      expect(await readdir(directory)).toEqual([
        `${digest.slice(7)}.${extension}`,
      ]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

describe("artifact input ownership", () => {
  it("retains JSON as it was when put was called, even if the caller reuses the object", async () => {
    const directory = await mkdtemp(join(tmpdir(), "harness-cas-input-"));
    try {
      const store = openFileHumanOsArtifactStore(directory);
      const value = { entries: [{ message: "original" }] };
      const expected = structuredClone(value);
      const pending = store.putJson(value);
      value.entries.push({ message: "later" });
      const digest = await pending;

      expect(digest).toBe(humanOsDigest(expected));
      expect(
        await openFileHumanOsArtifactStore(directory).readJson(digest),
      ).toEqual(expected);
      const changedDigest = await store.putJson(value);
      expect(changedDigest).not.toBe(digest);
      expect(await store.readJson(changedDigest)).toEqual(value);
      expect(await store.readJson(digest)).toEqual(expected);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it.each([
    {
      name: "Uint8Array",
      create: () => new Uint8Array([0, 1, 2, 3, 4]).subarray(1, 4),
    },
    {
      name: "Buffer",
      create: () => Buffer.from([0, 1, 2, 3, 4]).subarray(1, 4),
    },
  ])(
    "copies the supplied $name view before asynchronous storage",
    async ({ create }) => {
      const directory = await mkdtemp(join(tmpdir(), "harness-cas-input-"));
      try {
        const store = openFileHumanOsPrivateArtifactStore(directory);
        const value = create();
        const expected = [1, 2, 3];
        const pending = store.putPrivateBytes(value);
        value.fill(9);
        const digest = await pending;

        expect(
          Array.from(
            await openFileHumanOsPrivateArtifactStore(
              directory,
            ).readPrivateBytes(digest),
          ),
        ).toEqual(expected);
        expect(await store.putPrivateBytes(new Uint8Array(expected))).toBe(
          digest,
        );
        const changedDigest = await store.putPrivateBytes(value);
        expect(changedDigest).not.toBe(digest);
        expect(Array.from(await store.readPrivateBytes(changedDigest))).toEqual(
          [9, 9, 9],
        );
        expect(Array.from(await store.readPrivateBytes(digest))).toEqual(
          expected,
        );
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    },
  );
});
