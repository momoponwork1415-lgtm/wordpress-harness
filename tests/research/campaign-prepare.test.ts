import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";

import {
  openResearch,
  type NewCampaignInput,
  type NewCampaignInputV2,
} from "../../src/research/index.js";
import {
  openFileJsonArtifactStore,
  type JsonArtifactStore,
} from "../../src/research/research-record/index.js";
import { createCampaignInput } from "../fixtures/campaign.js";

const fixedNow = "2026-09-01T12:00:00.000Z";

const campaignInput = createCampaignInput();

function createCampaignInputV2(
  campaignId = "campaign-brizy-2-8-11",
): NewCampaignInputV2 {
  return {
    ...createCampaignInput(campaignId),
    schemaVersion: 2,
    canonicalFileManifest: {
      kind: "canonical-file-manifest",
      schemaVersion: 1,
      entries: [
        {
          path: "brizy.php",
          digest: `sha256:${"8".repeat(64)}`,
          size: 1_024,
        },
        {
          path: "includes/authorization.php",
          digest: `sha256:${"9".repeat(64)}`,
          size: 4_096,
        },
      ],
    },
  };
}

describe("CampaignRunner.prepare", () => {
  it("binds the Canonical File Manifest to the prepared Target without a Surface Map", async () => {
    const directory = await mkdtemp(join(tmpdir(), "wordpress-harness-"));
    const artifacts = openFileJsonArtifactStore(join(directory, "artifacts"));
    const input = createCampaignInputV2();
    const research = openResearch({
      databasePath: join(directory, "research.sqlite"),
      clock: () => new Date(fixedNow),
      artifactStore: artifacts,
    });

    try {
      const prepared = await research.runner.prepare(input);
      const inspected = await research.reader.inspect(input.campaignId, {
        kind: "preparation",
      });

      if (inspected.kind !== "preparation") {
        throw new Error("Expected a preparation view");
      }
      if (inspected.targetFileManifest === undefined) {
        throw new Error("Expected a Target File Manifest ref");
      }
      const manifest = await artifacts.readJson(
        inspected.targetFileManifest.digest,
      );

      expect({ prepared, inspected, manifest }).toMatchObject({
        prepared: {
          campaignId: input.campaignId,
          targetFileManifest: {
            kind: "target-file-manifest",
            schemaVersion: 1,
            targetSnapshotId: input.targetSnapshot.id,
            targetSnapshotDigest: input.targetSnapshot.digest,
            digest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
          },
        },
        inspected: {
          kind: "preparation",
          campaignId: input.campaignId,
          input,
          targetFileManifest: {
            kind: "target-file-manifest",
            schemaVersion: 1,
            targetSnapshotId: input.targetSnapshot.id,
            targetSnapshotDigest: input.targetSnapshot.digest,
            digest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
          },
        },
        manifest: {
          kind: "target-file-manifest",
          schemaVersion: 1,
          targetSnapshot: {
            id: input.targetSnapshot.id,
            digest: input.targetSnapshot.digest,
          },
          entries: input.canonicalFileManifest.entries,
        },
      });
    } finally {
      research.close();
      await rm(directory, { force: true, recursive: true });
    }
  });

  it("rejects a modified Target File Manifest ref during replay", async () => {
    const directory = await mkdtemp(join(tmpdir(), "wordpress-harness-"));
    const databasePath = join(directory, "research.sqlite");
    const artifacts = openFileJsonArtifactStore(join(directory, "artifacts"));
    const input = createCampaignInputV2("campaign-modified-manifest-ref");
    const writer = openResearch({ databasePath, artifactStore: artifacts });
    let writerOpen = true;

    try {
      await writer.runner.prepare(input);
      writer.close();
      writerOpen = false;

      const tamperer = new Database(databasePath);
      try {
        tamperer
          .prepare(
            `UPDATE research_events
             SET payload_json = json_set(
               payload_json,
               '$.targetFileManifest.targetSnapshotId',
               'different-target'
             )
             WHERE campaign_id = ?`,
          )
          .run(input.campaignId);
      } finally {
        tamperer.close();
      }

      const reader = openResearch({ databasePath, artifactStore: artifacts });
      try {
        let rejection: unknown;
        try {
          await reader.reader.read(input.campaignId);
        } catch (error: unknown) {
          rejection = error;
        }

        expect(rejection).toMatchObject({
          name: "LedgerIntegrityError",
          campaignId: input.campaignId,
          reason: "target-file-manifest-binding-mismatch",
        });
      } finally {
        reader.close();
      }
    } finally {
      if (writerOpen) writer.close();
      await rm(directory, { force: true, recursive: true });
    }
  });

  it("derives the same Manifest digest from the same Target and canonical entries", async () => {
    const directory = await mkdtemp(join(tmpdir(), "wordpress-harness-"));
    const artifacts = openFileJsonArtifactStore(join(directory, "artifacts"));
    const research = openResearch({
      databasePath: join(directory, "research.sqlite"),
      artifactStore: artifacts,
    });

    try {
      const first = await research.runner.prepare(
        createCampaignInputV2("campaign-manifest-digest-a"),
      );
      const second = await research.runner.prepare(
        createCampaignInputV2("campaign-manifest-digest-b"),
      );

      expect(first.targetFileManifest?.digest).toBe(
        second.targetFileManifest?.digest,
      );
    } finally {
      research.close();
      await rm(directory, { force: true, recursive: true });
    }
  });

  it.each([
    {
      id: "path",
      label: "a noncanonical path",
      entry: {
        path: "includes/../authorization.php",
        digest: `sha256:${"a".repeat(64)}`,
        size: 1,
      },
    },
    {
      id: "digest",
      label: "an invalid digest",
      entry: {
        path: "invalid-digest.php",
        digest: "sha256:not-a-digest",
        size: 1,
      },
    },
    {
      id: "size",
      label: "an invalid size",
      entry: {
        path: "invalid-size.php",
        digest: `sha256:${"b".repeat(64)}`,
        size: -1,
      },
    },
  ])("rejects $label before writing CAS", async ({ id, entry }) => {
    const directory = await mkdtemp(join(tmpdir(), "wordpress-harness-"));
    const delegate = openFileJsonArtifactStore(join(directory, "artifacts"));
    let writes = 0;
    const artifacts: JsonArtifactStore = {
      putJson: async (value) => {
        writes += 1;
        return delegate.putJson(value);
      },
      readJson: (digest) => delegate.readJson(digest),
    };
    const research = openResearch({
      databasePath: join(directory, "research.sqlite"),
      artifactStore: artifacts,
    });
    const valid = createCampaignInputV2(`campaign-invalid-${id}`);
    const input = {
      ...valid,
      canonicalFileManifest: {
        ...valid.canonicalFileManifest,
        entries: [entry],
      },
    };

    try {
      await expect(research.runner.prepare(input)).rejects.toMatchObject({
        name: "ZodError",
      });
      expect(writes).toBe(0);
    } finally {
      research.close();
      await rm(directory, { force: true, recursive: true });
    }
  });

  it("rejects duplicate paths before writing CAS", async () => {
    const directory = await mkdtemp(join(tmpdir(), "wordpress-harness-"));
    const delegate = openFileJsonArtifactStore(join(directory, "artifacts"));
    let writes = 0;
    const artifacts: JsonArtifactStore = {
      putJson: async (value) => {
        writes += 1;
        return delegate.putJson(value);
      },
      readJson: (digest) => delegate.readJson(digest),
    };
    const research = openResearch({
      databasePath: join(directory, "research.sqlite"),
      artifactStore: artifacts,
    });
    const valid = createCampaignInputV2("campaign-duplicate-path");
    const duplicate = valid.canonicalFileManifest.entries[0];
    if (duplicate === undefined) throw new Error("Expected a manifest entry");
    const input = {
      ...valid,
      canonicalFileManifest: {
        ...valid.canonicalFileManifest,
        entries: [duplicate, duplicate],
      },
    };

    try {
      await expect(research.runner.prepare(input)).rejects.toMatchObject({
        name: "ZodError",
      });
      expect(writes).toBe(0);
    } finally {
      research.close();
      await rm(directory, { force: true, recursive: true });
    }
  });

  it("does not append preparation when CAS returns a different digest", async () => {
    const directory = await mkdtemp(join(tmpdir(), "wordpress-harness-"));
    let reads = 0;
    const artifacts: JsonArtifactStore = {
      putJson: async () => `sha256:${"0".repeat(64)}`,
      readJson: async () => {
        reads += 1;
        return {};
      },
    };
    const research = openResearch({
      databasePath: join(directory, "research.sqlite"),
      artifactStore: artifacts,
    });
    const input = createCampaignInputV2("campaign-cas-mismatch");

    try {
      await expect(research.runner.prepare(input)).rejects.toMatchObject({
        name: "TargetFileManifestIntegrityError",
        reason: "artifact-digest-mismatch",
      });
      await expect(research.reader.read(input.campaignId)).rejects.toThrow(
        `Campaign not found: ${input.campaignId}`,
      );
      expect(reads).toBe(0);
    } finally {
      research.close();
      await rm(directory, { force: true, recursive: true });
    }
  });

  it("makes a valid campaign readable without starting Research", async () => {
    const directory = await mkdtemp(join(tmpdir(), "wordpress-harness-"));
    const research = openResearch({
      databasePath: join(directory, "research.sqlite"),
      clock: () => new Date(fixedNow),
    });

    try {
      const prepared = await research.runner.prepare(campaignInput);
      const view = await research.reader.read(campaignInput.campaignId);

      expect({ prepared, view }).toEqual({
        prepared: {
          campaignId: "campaign-brizy-2-8-11",
          status: "prepared",
          ledgerHead: 1,
          preparedAt: fixedNow,
          inputDigest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
          targetSnapshot: {
            id: "brizy-2.8.11",
            pluginSlug: "brizy",
            version: "2.8.11",
            digest: `sha256:${"1".repeat(64)}`,
          },
        },
        view: {
          campaignId: "campaign-brizy-2-8-11",
          status: "prepared",
          ledgerHead: 1,
          preparedAt: fixedNow,
          inputDigest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
          targetSnapshot: {
            id: "brizy-2.8.11",
            pluginSlug: "brizy",
            version: "2.8.11",
            digest: `sha256:${"1".repeat(64)}`,
          },
        },
      });
    } finally {
      research.close();
      await rm(directory, { force: true, recursive: true });
    }
  });

  it("replays the prepared campaign after the Research module is reopened", async () => {
    const directory = await mkdtemp(join(tmpdir(), "wordpress-harness-"));
    const databasePath = join(directory, "research.sqlite");
    const firstResearch = openResearch({
      databasePath,
      clock: () => new Date(fixedNow),
    });

    try {
      const prepared = await firstResearch.runner.prepare(campaignInput);
      firstResearch.close();

      const reopenedResearch = openResearch({
        databasePath,
        clock: () => new Date("2030-01-01T00:00:00.000Z"),
      });

      try {
        const replayed = await reopenedResearch.reader.read(
          campaignInput.campaignId,
        );

        expect(replayed).toEqual(prepared);
      } finally {
        reopenedResearch.close();
      }
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it("rejects different input for an already prepared CampaignId", async () => {
    const directory = await mkdtemp(join(tmpdir(), "wordpress-harness-"));
    const research = openResearch({
      databasePath: join(directory, "research.sqlite"),
      clock: () => new Date(fixedNow),
    });
    const conflictingInput: NewCampaignInput = {
      ...campaignInput,
      targetSnapshot: {
        id: "brizy-2.8.12",
        pluginSlug: "brizy",
        version: "2.8.12",
        digest: `sha256:${"7".repeat(64)}`,
      },
    };

    try {
      await research.runner.prepare(campaignInput);

      let conflict: unknown;
      try {
        await research.runner.prepare(conflictingInput);
      } catch (error: unknown) {
        conflict = error;
      }

      const unchanged = await research.reader.read(campaignInput.campaignId);

      expect({ conflict, unchanged }).toMatchObject({
        conflict: {
          name: "CampaignPreparationConflictError",
          message:
            "Campaign already prepared with different input: campaign-brizy-2-8-11",
        },
        unchanged: {
          campaignId: "campaign-brizy-2-8-11",
          ledgerHead: 1,
          targetSnapshot: {
            id: "brizy-2.8.11",
            version: "2.8.11",
          },
        },
      });
    } finally {
      research.close();
      await rm(directory, { force: true, recursive: true });
    }
  });

  it("retries identical preparation without appending another event", async () => {
    const directory = await mkdtemp(join(tmpdir(), "wordpress-harness-"));
    let currentTime = fixedNow;
    const research = openResearch({
      databasePath: join(directory, "research.sqlite"),
      clock: () => new Date(currentTime),
    });

    try {
      const first = await research.runner.prepare(campaignInput);
      currentTime = "2030-01-01T00:00:00.000Z";
      const retried = await research.runner.prepare(campaignInput);

      expect(retried).toEqual({
        ...first,
        ledgerHead: 1,
        preparedAt: fixedNow,
      });
    } finally {
      research.close();
      await rm(directory, { force: true, recursive: true });
    }
  });

  it("inspects the frozen preparation without changing Campaign state", async () => {
    const directory = await mkdtemp(join(tmpdir(), "wordpress-harness-"));
    const research = openResearch({
      databasePath: join(directory, "research.sqlite"),
      clock: () => new Date(fixedNow),
    });

    try {
      const prepared = await research.runner.prepare(campaignInput);
      const inspected = await research.reader.inspect(
        campaignInput.campaignId,
        { kind: "preparation" },
      );
      const afterInspection = await research.reader.read(
        campaignInput.campaignId,
      );

      expect({ inspected, afterInspection }).toEqual({
        inspected: {
          kind: "preparation",
          campaignId: campaignInput.campaignId,
          preparedAt: fixedNow,
          inputDigest: prepared.inputDigest,
          input: campaignInput,
        },
        afterInspection: prepared,
      });
    } finally {
      research.close();
      await rm(directory, { force: true, recursive: true });
    }
  });
});
