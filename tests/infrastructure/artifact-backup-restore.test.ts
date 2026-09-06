import { createHash } from "node:crypto";
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";

import {
  currentHumanReviewPolicySchema,
  openCurrentHumanReviewReader,
} from "../../src/human-os/index.js";
import { humanOsDigest } from "../../src/human-os/canonical-json.js";
import {
  openFileHumanOsArtifactStore,
  openFileHumanOsPrivateArtifactStore,
  openSqliteHumanOsRecord,
  type HumanOsRecord,
} from "../../src/human-os/human-os-record/index.js";
import { openResearch, type ResearchModule } from "../../src/research/index.js";
import { openFileJsonArtifactStore } from "../../src/research/research-record/index.js";

const fixtureRoot = join(import.meta.dirname, "../fixtures");
const scratchDirectories: string[] = [];
const researchFixtureSchema = z.object({
  campaignId: z.string(),
  runId: z.string(),
  publicViews: z.object({ run: z.unknown(), progress: z.unknown() }),
});
const humanFixtureSchema = z.object({
  policy: currentHumanReviewPolicySchema,
  expectedQueue: z.object({ campaignId: z.string() }).passthrough(),
});

async function scratch(prefix: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  scratchDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(
    scratchDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("stopped artifact set backup and restore", () => {
  it("replays the saved Research and Human OS views and rejects an absent or corrupt public CAS object", async () => {
    const backup = await scratch("artifact-backup-");
    const restored = await scratch("artifact-restore-");
    const researchSource = join(
      fixtureRoot,
      "research/legacy-campaign/boundary-complete",
    );
    const humanSource = join(
      fixtureRoot,
      "human-os/current-human-review/promoted",
    );
    await cp(researchSource, join(backup, "research"), { recursive: true });
    await cp(humanSource, join(backup, "human-os"), { recursive: true });
    await cp(backup, restored, { recursive: true });

    const researchExpected = researchFixtureSchema.parse(
      JSON.parse(await readFile(join(researchSource, "expected.json"), "utf8")),
    );
    const researchDirectory = join(restored, "research");
    const researchArtifacts = openFileJsonArtifactStore(
      join(researchDirectory, "objects"),
    );
    const openRestoredResearch = (): ResearchModule =>
      openResearch({
        databasePath: join(researchDirectory, "research.sqlite"),
        artifactStore: {
          readJson: (digest) => researchArtifacts.readJson(digest),
          putJson: async () => {
            throw new Error("Restore verification must not write artifacts");
          },
        },
        clock: () => {
          throw new Error("Restore verification must not append events");
        },
      });
    const research = openRestoredResearch();
    try {
      expect(
        await research.reader.inspect(researchExpected.campaignId, {
          kind: "run",
          runId: researchExpected.runId,
        }),
      ).toEqual(researchExpected.publicViews.run);
      expect(
        await research.reader.inspect(researchExpected.campaignId, {
          kind: "progress",
        }),
      ).toEqual(researchExpected.publicViews.progress);
    } finally {
      research.close();
    }

    const humanExpected = humanFixtureSchema.parse(
      JSON.parse(await readFile(join(humanSource, "expected.json"), "utf8")),
    );
    const humanDirectory = join(restored, "human-os");
    const humanArtifacts = openFileHumanOsArtifactStore(
      join(humanDirectory, "objects"),
    );
    const records: HumanOsRecord[] = [];
    const openRestoredHuman = () => {
      const record = openSqliteHumanOsRecord({
        databasePath: join(humanDirectory, "human-os.sqlite"),
        artifactStore: {
          readJson: (digest) => humanArtifacts.readJson(digest),
          putJson: async () => {
            throw new Error("Restore verification must not write artifacts");
          },
        },
        clock: () => {
          throw new Error("Restore verification must not append events");
        },
      });
      records.push(record);
      return openCurrentHumanReviewReader({
        policy: humanExpected.policy,
        store: record,
      });
    };
    try {
      expect(
        await openRestoredHuman().readQueue(
          humanExpected.expectedQueue.campaignId,
        ),
      ).toEqual(humanExpected.expectedQueue);
    } finally {
      for (const record of records) record.close();
    }

    const absentDigest =
      "b0b70ab4098fc9084c0bd37d258f45d76dd207897bd6d3b5bd8294fec8b8eb3c";
    const absentPath = join(humanDirectory, "objects", `${absentDigest}.json`);
    await rename(absentPath, `${absentPath}.missing`);
    const missingRecord = openSqliteHumanOsRecord({
      databasePath: join(humanDirectory, "human-os.sqlite"),
      artifactStore: humanArtifacts,
    });
    try {
      await expect(
        openCurrentHumanReviewReader({
          policy: humanExpected.policy,
          store: missingRecord,
        }).readQueue(humanExpected.expectedQueue.campaignId),
      ).rejects.toThrow();
    } finally {
      missingRecord.close();
    }

    const corruptDigest =
      "0bedc99b1f0a65180f74fb8c3bef03e4611b9d77b5eb690d9106f581128aa89a";
    await writeFile(
      join(researchDirectory, "objects", `${corruptDigest}.json`),
      '{"corrupt":true}\n',
    );
    await expect(
      researchArtifacts.readJson(`sha256:${corruptDigest}`),
    ).rejects.toThrow(`Artifact digest mismatch: sha256:${corruptDigest}`);
  });

  it("restores sanitized private JSON and bytes and rejects missing or corrupt content by digest", async () => {
    const source = await scratch("private-evidence-source-");
    const backup = await scratch("private-evidence-backup-");
    const restored = await scratch("private-evidence-restore-");
    const sourceStore = openFileHumanOsPrivateArtifactStore(source);
    const bytes = new TextEncoder().encode("synthetic screenshot bytes");
    const blobDigest = await sourceStore.putPrivateBytes(bytes);
    const payload = {
      id: "synthetic-payload",
      mediaType: "application/x-www-form-urlencoded" as const,
      exactValue: "synthetic=value",
    };
    const recipe = {
      class: "sql-injection" as const,
      initialState: ["Use a synthetic initial state."],
      actors: { attackerRole: "unauthenticated" as const, victimRole: null },
      surface: "Use the synthetic request interface.",
      payloads: [payload],
      steps: [
        {
          ordinal: 1,
          interface: "wordpress-rest-api" as const,
          actor: "attacker" as const,
          action: "Submit synthetic-payload.",
          payloadId: payload.id,
          expectedObservation: "Observe the synthetic bounded effect.",
        },
      ],
      criterion: {
        class: "sql-injection" as const,
        proof: "database-security-effect" as const,
        expectedDatabaseEffect: "A synthetic bounded effect is observed.",
      },
    };
    const evidence = {
      exactPayloads: [payload],
      rawHttpRequests: ["POST /synthetic HTTP/1.1\n\nsynthetic=value"],
      screenshots: [
        {
          id: "synthetic-shot",
          digest: blobDigest,
          mediaType: "image/png" as const,
        },
      ],
      runtimeLogs: [],
      redaction: {
        credentialsIncluded: false as const,
        cookiesIncluded: false as const,
        privateTranscriptIncluded: false as const,
        hostInformationIncluded: false as const,
      },
    };
    const attemptId = `sha256:${"a".repeat(64)}`;
    const targetSnapshotDigest = `sha256:${"b".repeat(64)}`;
    const recipeIdentity = {
      kind: "reproduction-recipe" as const,
      schemaVersion: 2 as const,
      attemptId,
      targetSnapshotDigest,
      runtimeIdentity: {
        kind: "ai-reproduction-runtime-identity" as const,
        schemaVersion: 2 as const,
        environmentId: "synthetic-restored-environment",
        targetSnapshotDigest,
        manifestDigest: `sha256:${"c".repeat(64)}`,
        runtimeProfileDigest: `sha256:${"d".repeat(64)}`,
        setupPlanDigest: `sha256:${"e".repeat(64)}`,
        toolPolicyDigest: `sha256:${"f".repeat(64)}`,
        observedWordpressVersion: "6.8.2",
        observedPhpVersion: "8.3.24",
        observedDatabaseVersion: "11.8.3",
        observedWebServerVersion: "2.4.65",
        observedImages: {
          wordpress: `registry.invalid/wordpress@sha256:${"1".repeat(64)}`,
          wordpressCli: `registry.invalid/wordpress-cli@sha256:${"2".repeat(64)}`,
          database: `registry.invalid/database@sha256:${"3".repeat(64)}`,
          browser: `registry.invalid/browser@sha256:${"4".repeat(64)}`,
        },
        isolation: {
          backend: "gvisor" as const,
          runtimeName: "runsc" as const,
          runtimeVersion: "synthetic-1",
          fallbackUsed: false as const,
        },
        fresh: true as const,
        disposable: true as const,
        hostTargetExecution: false as const,
        ambientHostShell: false as const,
        ambientCredentials: false as const,
        arbitraryNetwork: false as const,
      },
      recordedAt: "2026-09-06T04:00:00.000Z",
      recipe,
    };
    const savedRecipe = {
      ...recipeIdentity,
      id: humanOsDigest(recipeIdentity),
    };
    const evidenceIdentity = {
      kind: "private-evidence-bundle" as const,
      schemaVersion: 2 as const,
      attemptId,
      targetSnapshotDigest,
      collectedAt: "2026-09-06T04:00:00.000Z",
      evidence,
    };
    const savedEvidence = {
      ...evidenceIdentity,
      id: humanOsDigest(evidenceIdentity),
    };
    const recipeDigest = await sourceStore.putPrivateJson(savedRecipe);
    const evidenceDigest = await sourceStore.putPrivateJson(savedEvidence);

    await cp(source, backup, { recursive: true });
    await mkdir(restored, { recursive: true });
    await cp(backup, restored, { recursive: true });
    const restoredStore = openFileHumanOsPrivateArtifactStore(restored);
    expect(await restoredStore.readPrivateJson(recipeDigest)).toEqual(
      savedRecipe,
    );
    expect(await restoredStore.readPrivateJson(evidenceDigest)).toEqual(
      savedEvidence,
    );
    expect([...(await restoredStore.readPrivateBytes(blobDigest))]).toEqual([
      ...bytes,
    ]);

    const recipeName = `${recipeDigest.slice("sha256:".length)}.json`;
    await rename(
      join(restored, recipeName),
      join(restored, `${recipeName}.missing`),
    );
    await expect(restoredStore.readPrivateJson(recipeDigest)).rejects.toThrow();

    const blobPath = join(
      restored,
      `${blobDigest.slice("sha256:".length)}.blob`,
    );
    await writeFile(blobPath, "corrupt synthetic bytes");
    await expect(restoredStore.readPrivateBytes(blobDigest)).rejects.toThrow(
      `Human OS private blob digest mismatch: ${blobDigest}`,
    );

    expect(createHash("sha256").update(bytes).digest("hex")).toBe(
      blobDigest.slice("sha256:".length),
    );
  });
});
