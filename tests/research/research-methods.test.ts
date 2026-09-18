import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  deepSeekHarnessNativeTransport,
  defineAgentRuntimeProfile,
} from "../../src/infrastructure/agent-runtime-profile.js";
import { promptTextDigest } from "../../src/infrastructure/prompt-text.js";
import {
  campaignInputSchema,
  researchMethodForPromptSet,
  researchPromptSetForMethod,
} from "../../src/research/index.js";

const digest = (character: string): string => `sha256:${character.repeat(64)}`;

function campaignInput(promptSet = researchPromptSetForMethod("cloudflare")) {
  return {
    kind: "agent-led-campaign" as const,
    schemaVersion: 1 as const,
    campaignId: "research-method-campaign",
    targetSnapshot: {
      id: "target-fixture-1",
      pluginSlug: "fixture-plugin",
      version: "1.0.0",
      digest: digest("a"),
      sourceTree: { digest: digest("b"), entries: 1, bytes: 6 },
    },
    promptSet,
    agentRuntimeProfile: defineAgentRuntimeProfile({
      id: "deepseek-flash-max",
      ...deepSeekHarnessNativeTransport,
      model: "deepseek-flash",
      effort: "max",
    }),
    permissionProfile: { id: "source-only-v1", digest: digest("c") },
    budgetEnvelope: {
      id: "one-hour-v1",
      maxNativeRuns: 2,
      maxWallTimeMs: 7_200_000,
      researchGrantWallTimeMs: 3_600_000,
      digest: digest("d"),
    },
  };
}

describe("Research Method Prompt Sets", () => {
  it.each([
    {
      method: "wp2shell" as const,
      promptPath: "prompts/wordpress-plugin-research-v3.md",
      promptSetId: "wordpress-plugin-research-wp2shell-v1",
    },
    {
      method: "cloudflare" as const,
      promptPath: "prompts/wordpress-plugin-research-cloudflare-v1.md",
      promptSetId: "wordpress-plugin-research-cloudflare-v1",
    },
    {
      method: "cloudflare-upstream" as const,
      promptPath: "prompts/wordpress-plugin-research-cloudflare-upstream-v1.md",
      promptSetId: "wordpress-plugin-research-cloudflare-upstream-c1c8a8c-v1",
    },
  ])(
    "binds the $method method name to one exact versioned Prompt Set",
    async ({ method, promptPath, promptSetId }) => {
      const prompt = await readFile(join(process.cwd(), promptPath), "utf8");
      const promptSet = researchPromptSetForMethod(method);

      expect(promptSet).toEqual({
        id: promptSetId,
        digest: promptTextDigest(prompt),
      });
      expect(researchMethodForPromptSet(promptSet)).toBe(method);
    },
  );

  it("rejects a canonical method name bound to another method's Prompt", () => {
    const wp2shell = researchPromptSetForMethod("wp2shell");
    const cloudflare = researchPromptSetForMethod("cloudflare");

    const parsed = campaignInputSchema.safeParse(
      campaignInput({ id: cloudflare.id, digest: wp2shell.digest }),
    );

    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: ["promptSet", "digest"],
          message:
            "Canonical Research Method Prompt Set id requires its exact digest",
        }),
      ]),
    );
  });

  it("rejects resuming a Cloudflare Campaign from a WP2Shell Checkpoint", () => {
    const input = campaignInput();
    const parsed = campaignInputSchema.safeParse({
      ...input,
      resumeFrom: {
        kind: "agent-checkpoint",
        schemaVersion: 1,
        checkpointId: "wp2shell-checkpoint",
        stateDigest: digest("e"),
        stateEntries: 1,
        stateBytes: 1,
        sessionId: "12121212-1212-4121-8121-121212121212",
        targetSnapshotDigest: input.targetSnapshot.digest,
        promptSetDigest: researchPromptSetForMethod("wp2shell").digest,
        runtimeProfileDigest: input.agentRuntimeProfile.digest,
        permissionProfileDigest: input.permissionProfile.digest,
      },
    });

    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: ["resumeFrom"],
          message: "Agent Checkpoint does not match the Campaign binding",
        }),
      ]),
    );
  });

  it("keeps the Cloudflare workflow inside the provider-native Root loop", async () => {
    const prompt = await readFile(
      join(process.cwd(), "prompts/wordpress-plugin-research-cloudflare-v1.md"),
      "utf8",
    );

    expect(prompt).toContain("Reconnaissance");
    expect(prompt).toContain("Coverage-directed Hunt");
    expect(prompt).toContain("Adversarial Validate");
    expect(prompt).toContain("Gapfill");
    expect(prompt).toContain(
      "Do not create a deterministic coverage ledger, fixed Hunter roles, or Harness-owned waves.",
    );
    expect(prompt).toContain(
      "Only the Root emits the Research Report and Candidate records.",
    );
    expect(prompt).toContain(
      "The evidence summary is not proof that the Target is safe or complete.",
    );
  });

  it("preserves the pinned upstream Cloudflare full-audit workflow", async () => {
    const prompt = await readFile(
      join(
        process.cwd(),
        "prompts/wordpress-plugin-research-cloudflare-upstream-v1.md",
      ),
      "utf8",
    );

    expect(prompt).toContain(
      "Upstream commit: c1c8a8c1471069fb0e188eeaff69b8e8db6564a8",
    );
    expect(prompt).toContain("Deterministic coverage ledger");
    expect(prompt).toContain("Coverage-critic waves");
    expect(prompt).toContain("Independently validate every candidate");
    expect(prompt).toContain("Verify the final records with fresh eyes");
    expect(prompt).toContain(
      "Return only the Harness Research Report requested after this method bundle.",
    );
  });
});
