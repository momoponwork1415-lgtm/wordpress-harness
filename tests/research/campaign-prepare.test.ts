import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  openResearch,
  type NewCampaignInput,
} from "../../src/research/index.js";
import { createCampaignInput } from "../fixtures/campaign.js";

const fixedNow = "2026-09-01T12:00:00.000Z";

const campaignInput = createCampaignInput();

describe("CampaignRunner.prepare", () => {
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
