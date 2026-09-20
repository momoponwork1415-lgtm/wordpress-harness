import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  deepSeekHarnessNativeTransport,
  defineAgentRuntimeProfile,
} from "../../src/infrastructure/agent-runtime-profile.js";
import { canonicalDigest } from "../../src/infrastructure/canonical-json.js";
import { promptTextDigest } from "../../src/infrastructure/prompt-text.js";
import {
  campaignInputSchema,
  canonicalResearchPromptSet,
  researchCampaignPolicySchema,
} from "../../src/research/index.js";

const digest = (character: string): string => `sha256:${character.repeat(64)}`;

const runtimeProfile = defineAgentRuntimeProfile({
  id: "deepseek-flash-max",
  ...deepSeekHarnessNativeTransport,
  model: "deepseek-flash",
  effort: "max",
});

function campaignInput(
  promptSet: Readonly<{
    id: string;
    digest: string;
  }> = canonicalResearchPromptSet,
) {
  return {
    kind: "agent-led-campaign" as const,
    schemaVersion: 2 as const,
    campaignId: "research-method-campaign",
    targetSnapshot: {
      id: "target-fixture-1",
      pluginSlug: "fixture-plugin",
      version: "1.0.0",
      digest: digest("a"),
      sourceTree: { digest: digest("b"), entries: 1, bytes: 6 },
    },
    promptSet,
    agentRuntimeProfile: runtimeProfile,
    permissionProfile: { id: "source-only-v1", digest: digest("c") },
    budgetEnvelope: {
      id: "campaign-envelope-v1",
      maxNativeRuns: 2,
      maxWallTimeMs: 7_200_000,
      digest: digest("d"),
    },
  };
}

function campaignPolicy(
  promptSet: Readonly<{
    id: string;
    digest: string;
  }> = canonicalResearchPromptSet,
) {
  const body = {
    kind: "research-campaign-policy" as const,
    schemaVersion: 2 as const,
    id: "research-policy-v1",
    promptSet,
    agentRuntimeProfile: runtimeProfile,
    permissionProfile: { id: "source-only-v1", digest: digest("c") },
    budgetEnvelope: {
      id: "campaign-envelope-v1",
      maxNativeRuns: 2,
      maxWallTimeMs: 7_200_000,
      digest: digest("d"),
    },
  };
  return { ...body, digest: canonicalDigest(body) };
}

describe("Canonical Research Prompt Set", () => {
  it("binds production Research to the exact wp2shell Prompt", async () => {
    const prompt = await readFile(
      join(process.cwd(), "prompts/wordpress-plugin-research-v7.md"),
      "utf8",
    );

    expect(canonicalResearchPromptSet).toEqual({
      id: "wordpress-plugin-research-wp2shell-v7",
      digest: promptTextDigest(prompt),
    });
    expect(campaignInputSchema.safeParse(campaignInput()).success).toBe(true);
    expect(
      researchCampaignPolicySchema.safeParse(campaignPolicy()).success,
    ).toBe(true);
  });

  it("preserves every wp2shell search-management technique without the task oracle", async () => {
    const prompt = await readFile(
      join(process.cwd(), "prompts/wordpress-plugin-research-v7.md"),
      "utf8",
    );

    expect(prompt).toContain("Use native subagents aggressively");
    expect(prompt).toContain("Do not use a fixed assignment");
    expect(prompt).toContain("genuinely diverse portfolio");
    expect(prompt).toContain("explicit scratch registry of approach families");
    expect(prompt).toContain("redirect some toward underexplored families");
    expect(prompt).toContain("Do not let one route dominate");
    expect(prompt).toContain("materially new mechanism");
    expect(prompt).toContain(
      "incompatible routes alive through multiple rounds",
    );
    expect(prompt).toContain("cross-pollinating their ideas");
    expect(prompt).toContain("adversarial subagents");
    expect(prompt).toContain("root repeatedly synthesizes");
    expect(prompt).toContain(
      "Failure of the current approaches or the first wave is not a reason to stop",
    );
    expect(prompt).toContain("pinned dependency source");
    expect(prompt).toContain("chain intermediate bugs");
    expect(prompt).not.toContain("/flag");
    expect(prompt).not.toContain("at least 6 hours");
  });

  it("keeps the canonical wp2shell Prompt compact and free of v6 procedures", async () => {
    const prompt = await readFile(
      join(process.cwd(), "prompts/wordpress-plugin-research-v7.md"),
      "utf8",
    );

    expect(Buffer.byteLength(prompt, "utf8")).toBeLessThan(7_000);
    expect(prompt).not.toContain("semantic neighborhood");
    expect(prompt).not.toContain("value-transformation ledger");
    expect(prompt).not.toContain("root-mechanism source map");
    expect(prompt).not.toContain("internal sentinel or wrapper protocol");
  });

  it.each([
    {
      name: "unknown Prompt Set id",
      promptSet: { id: "another-research-method-v1", digest: digest("f") },
      path: ["promptSet", "id"],
    },
    {
      name: "canonical id with another digest",
      promptSet: { ...canonicalResearchPromptSet, digest: digest("f") },
      path: ["promptSet", "digest"],
    },
  ])(
    "rejects $name before production Research starts",
    ({ promptSet, path }) => {
      const parsedInput = campaignInputSchema.safeParse(
        campaignInput(promptSet),
      );
      const parsedPolicy = researchCampaignPolicySchema.safeParse(
        campaignPolicy(promptSet),
      );

      expect(parsedInput.success).toBe(false);
      expect(parsedInput.error?.issues).toEqual(
        expect.arrayContaining([expect.objectContaining({ path })]),
      );
      expect(parsedPolicy.success).toBe(false);
      expect(parsedPolicy.error?.issues).toEqual(
        expect.arrayContaining([expect.objectContaining({ path })]),
      );
    },
  );

  it("rejects resuming a Campaign from a differently bound Prompt Checkpoint", () => {
    const input = campaignInput();
    const parsed = campaignInputSchema.safeParse({
      ...input,
      resumeFrom: {
        kind: "agent-checkpoint",
        schemaVersion: 1,
        checkpointId: "other-prompt-checkpoint",
        stateDigest: digest("e"),
        stateEntries: 1,
        stateBytes: 1,
        sessionId: "12121212-1212-4121-8121-121212121212",
        targetSnapshotDigest: input.targetSnapshot.digest,
        promptSetDigest: digest("f"),
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
});
