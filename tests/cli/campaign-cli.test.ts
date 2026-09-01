import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { runCli } from "../../src/cli.js";
import { createCampaignInput } from "../fixtures/campaign.js";

const campaignInput = createCampaignInput("campaign-cli-brizy");

describe("campaign CLI", () => {
  it("prepares and inspects a campaign through the Research interfaces", async () => {
    const directory = await mkdtemp(join(tmpdir(), "wordpress-harness-cli-"));
    const databasePath = join(directory, "research.sqlite");
    const inputPath = join(directory, "campaign.json");
    await writeFile(inputPath, JSON.stringify(campaignInput), "utf8");
    const output: string[] = [];
    const errors: string[] = [];
    const io = {
      stdout: (text: string) => output.push(text),
      stderr: (text: string) => errors.push(text),
    };

    try {
      const prepareExit = await runCli(
        [
          "campaign",
          "prepare",
          "--database",
          databasePath,
          "--input",
          inputPath,
        ],
        io,
      );
      const inspectExit = await runCli(
        [
          "campaign",
          "inspect",
          "--database",
          databasePath,
          "--campaign",
          campaignInput.campaignId,
        ],
        io,
      );
      const prepared: unknown = JSON.parse(output[0] ?? "null");
      const inspected: unknown = JSON.parse(output[1] ?? "null");

      expect({ prepareExit, inspectExit, errors, prepared, inspected }).toMatchObject(
        {
          prepareExit: 0,
          inspectExit: 0,
          errors: [],
          prepared: {
            campaignId: "campaign-cli-brizy",
            status: "prepared",
            ledgerHead: 1,
          },
          inspected: {
            kind: "preparation",
            campaignId: "campaign-cli-brizy",
            input: {
              targetSnapshot: {
                id: "brizy-2.8.11",
                version: "2.8.11",
              },
            },
          },
        },
      );
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });
});
