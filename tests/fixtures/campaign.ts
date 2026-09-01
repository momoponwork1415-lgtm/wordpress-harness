import type { NewCampaignInput } from "../../src/research/index.js";

export function createCampaignInput(
  campaignId = "campaign-brizy-2-8-11",
): NewCampaignInput {
  return {
    campaignId,
    targetSnapshot: {
      id: "brizy-2.8.11",
      pluginSlug: "brizy",
      version: "2.8.11",
      digest: `sha256:${"1".repeat(64)}`,
    },
    campaignPolicy: {
      id: "public-boundary-pair-v1",
      digest: `sha256:${"2".repeat(64)}`,
    },
    runtimeProfile: {
      id: "wordpress-test-runtime-v1",
      digest: `sha256:${"3".repeat(64)}`,
    },
    promptSet: {
      id: "research-prompts-v1",
      digest: `sha256:${"4".repeat(64)}`,
    },
    modelProfiles: [
      {
        id: "opus-finder-v1",
        digest: `sha256:${"5".repeat(64)}`,
      },
    ],
    knowledgeCapsules: [],
    experimentRegistry: {
      id: "experiment-registry-v1",
      digest: `sha256:${"6".repeat(64)}`,
    },
    budget: {
      maxAttempts: 8,
      maxWallTimeMs: 3_600_000,
      maxModelTokens: 100_000,
    },
  };
}
