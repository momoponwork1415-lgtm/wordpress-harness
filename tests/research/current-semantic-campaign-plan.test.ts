import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  currentSemanticCampaignConfigurationMatches,
  CurrentSemanticCampaignPlanIntegrityError,
  prepareCurrentSemanticCampaignPlan,
  type CurrentSemanticModelFamily,
} from "../../src/research/index.js";
import { openFileJsonArtifactStore } from "../../src/research/research-record/index.js";

const digest = (character: string): string => `sha256:${character.repeat(64)}`;

const target = {
  id: "example-2.4.1",
  pluginSlug: "example",
  version: "2.4.1",
  digest: digest("1"),
};

const manifest = {
  kind: "target-file-manifest",
  schemaVersion: 1,
  targetSnapshotId: target.id,
  targetSnapshotDigest: target.digest,
  digest: digest("2"),
} as const;

const metadata = {
  kind: "oracle-free-target-metadata",
  schemaVersion: 1,
  pluginIdentity: "wporg:example",
  mainPluginFile: "example/example.php",
  canonicalInstallDirectory: "example",
} as const;

function planInput(family: CurrentSemanticModelFamily) {
  return {
    family,
    campaignId: `campaign-${family}`,
    runId: `campaign-${family}:wave-1`,
    preparationDigest: digest("3"),
    target,
    manifest,
    metadata,
  };
}

async function withStore<T>(
  body: (store: ReturnType<typeof openFileJsonArtifactStore>) => Promise<T>,
): Promise<T> {
  const directory = await mkdtemp(join(tmpdir(), "current-semantic-plan-"));
  try {
    return await body(openFileJsonArtifactStore(join(directory, "artifacts")));
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
}

describe("current Semantic Campaign plan", () => {
  it.each(["claude", "glm", "grok"] as const)(
    "builds a %s plan the current configuration admission check accepts",
    async (family) => {
      // The admission check states the budgets and identities as its own
      // literals. Passing it is therefore evidence the factory agrees with a
      // second, independent statement of the same configuration — not evidence
      // that one constant equals itself.
      await withStore(async (store) => {
        const { plan } = await prepareCurrentSemanticCampaignPlan(
          store,
          planInput(family),
        );

        expect(currentSemanticCampaignConfigurationMatches(plan)).toBe(true);
        expect(plan).toMatchObject({
          kind: "campaign-run-plan",
          schemaVersion: 3,
          campaignId: `campaign-${family}`,
          runId: `campaign-${family}:wave-1`,
          preparationDigest: digest("3"),
          target,
          manifest,
          metadata,
          budgetPolicy: {
            id: "semantic-research-recall-baseline-v7",
            maxModelTokens: 4_600_000,
            reportedUsageEnforcement: "telemetry-only",
          },
        });
        expect(plan.planner.modelProfile.ref.family).toBe(family);
      });
    },
  );

  it("stores the configuration documents under the digests the plan names", async () => {
    // Model Execution reads both documents back by digest before it launches a
    // provider. A plan whose configuration never reached the store is a plan
    // that cannot run, so the factory stores them rather than leaving a second
    // call for the caller to forget.
    await withStore(async (store) => {
      const { plan, sourceToolPolicy, sourceToolPolicyRef } =
        await prepareCurrentSemanticCampaignPlan(store, planInput("claude"));

      const receiptDigest =
        plan.planner.modelProfile.execution.eligibilityReceiptDigest;
      expect(receiptDigest).toBeDefined();
      await expect(store.readJson(receiptDigest ?? "")).resolves.toMatchObject({
        kind: "transport-eligibility-receipt",
        transport: "official-claude-code-process",
        authMethod: "claude.ai-subscription",
        model: "claude-opus-5",
      });
      await expect(
        store.readJson(plan.planner.sourceToolPolicy.digest),
      ).resolves.toEqual(sourceToolPolicy);
      expect(sourceToolPolicyRef.digest).toBe(
        plan.planner.sourceToolPolicy.digest,
      );
      // The policy is minted against one immutable source tree, so a policy
      // built for another Target cannot be replayed against this one.
      expect(sourceToolPolicy.targetSnapshotDigest).toBe(target.digest);
    });
  });

  it("binds every role of one plan to a single transport eligibility receipt", async () => {
    await withStore(async (store) => {
      const { plan } = await prepareCurrentSemanticCampaignPlan(
        store,
        planInput("grok"),
      );
      const receipts = new Set(
        [
          plan.planner.modelProfile,
          plan.finder.modelProfile,
          plan.evaluator.modelProfile,
          plan.validation.validatorModelProfile,
        ].map((profile) => profile.execution.eligibilityReceiptDigest),
      );

      expect(receipts.size).toBe(1);
      expect(plan.planner.modelProfile.execution).toMatchObject({
        provider: "xai",
        model: "grok-4.6",
        transport: "grok-build-process",
        executableVersion: "1.0.13",
        effort: "xhigh",
      });
    });
  });

  it("refuses a family outside the admitted model profile catalog", async () => {
    await withStore(async (store) => {
      await expect(
        prepareCurrentSemanticCampaignPlan(store, {
          ...planInput("claude"),
          family: "gemini" as CurrentSemanticModelFamily,
        }),
      ).rejects.toThrow(/Unknown current Semantic model family: gemini/u);
    });
  });

  it("names the reason when a stored configuration document does not match its digest", async () => {
    // A store that accepts a document and addresses it differently breaks the
    // one binding an Attempt Plan relies on. It must be refused before a run
    // starts rather than surfacing later as an Attempt-level mismatch.
    const dishonestStore = {
      putJson: async () => digest("9"),
      readJson: async () => ({}),
    };

    await expect(
      prepareCurrentSemanticCampaignPlan(dishonestStore, planInput("glm")),
    ).rejects.toMatchObject({
      name: "CurrentSemanticCampaignPlanIntegrityError",
      reason: "configuration-artifact-digest-mismatch",
      family: "glm",
    });
    await expect(
      prepareCurrentSemanticCampaignPlan(dishonestStore, planInput("glm")),
    ).rejects.toBeInstanceOf(CurrentSemanticCampaignPlanIntegrityError);
  });
});
