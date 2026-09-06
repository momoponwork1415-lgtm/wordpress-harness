import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  openResearch,
  type CampaignExecutionDependencies,
} from "../../src/research/index.js";
import { createCampaignInput } from "../fixtures/campaign.js";

describe("Campaign composition compatibility", () => {
  it("accepts the legacy dependency shape without accessing legacy capabilities", async () => {
    const directory = await mkdtemp(join(tmpdir(), "campaign-composition-"));
    const databasePath = join(directory, "research.sqlite");
    const campaignInput = createCampaignInput("campaign-composition-legacy");
    const legacyComposition: CampaignExecutionDependencies = {
      artifactStore: {
        putJson: async () => {
          throw new Error("Preparation must not write execution artifacts");
        },
        readJson: async () => {
          throw new Error("Preparation must not read execution artifacts");
        },
      },
      modelExecution: {
        run: async () => {
          throw new Error("Preparation must not execute a model");
        },
      },
      get attemptPlanMaterializer(): never {
        throw new Error("Current composition read a legacy materializer");
      },
      get independentVerifier(): never {
        throw new Error("Current composition read a legacy verifier");
      },
      get labControl(): never {
        throw new Error("Current composition read legacy Lab Control");
      },
      get calibrationReview(): never {
        throw new Error("Current composition read legacy calibration review");
      },
      get humanReviewPacketDelivery(): never {
        throw new Error(
          "Current composition read legacy Human Review delivery",
        );
      },
      get runtimeVerificationPacketDelivery(): never {
        throw new Error(
          "Current composition read legacy Runtime Verification delivery",
        );
      },
    };

    try {
      const research = openResearch({
        databasePath,
        campaignExecution: legacyComposition,
      });
      const prepared = await (async () => {
        try {
          const view = await research.runner.prepare(campaignInput);
          await expect(
            research.reader.read(campaignInput.campaignId),
          ).resolves.toEqual(view);
          return view;
        } finally {
          research.close();
        }
      })();

      const reopened = openResearch({ databasePath });
      try {
        await expect(
          reopened.reader.read(campaignInput.campaignId),
        ).resolves.toEqual(prepared);
      } finally {
        reopened.close();
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
