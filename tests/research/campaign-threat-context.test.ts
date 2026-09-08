import { describe, expect, it } from "vitest";

import { canonicalDigest } from "../../src/infrastructure/canonical-json.js";
import {
  campaignInputSchema,
  type SealedNativeRun,
} from "../../src/research/agent-led/contracts.js";
import { agentResearchPrompt } from "../../src/research/agent-led/gvisor-agent-sandbox.js";

const digest = (character: string): string => `sha256:${character.repeat(64)}`;

function threatContext() {
  const body = {
    kind: "campaign-threat-context" as const,
    schemaVersion: 1 as const,
    id: "threat-context-public-form-v1",
    whyThisTarget:
      "The public submission surface can affect privileged WordPress state.",
    ordinaryConfiguration:
      "The plugin is active with its public form and administration UI.",
    attackerPositions: ["Unauthenticated public form submitter."],
    securityObjectives: [
      "Public input must remain separate from privileged authority.",
    ],
    trustBoundaries: ["Public request to privileged administration workflow."],
    highValueTransitions: [
      "Persisted public state is later consumed by an administrator.",
    ],
    dependencyRoles: [
      {
        mountName: "wordpress",
        role: "wordpress-core" as const,
        relevance: "Core defines the final authorization and output semantics.",
      },
    ],
    uncertainties: ["Research must derive the reachable source path."],
    explorationFreedom: "off-model-findings-allowed" as const,
  };
  return { ...body, digest: canonicalDigest(body) };
}

function sealedRun(): SealedNativeRun {
  return {
    kind: "sealed-native-research-run",
    schemaVersion: 1,
    runId: "campaign-context:native:1",
    campaignId: "campaign-context",
    campaignInputDigest: digest("1"),
    targetSnapshot: {
      id: "target-example",
      pluginSlug: "example",
      version: "1.0.0",
      digest: digest("2"),
      sourceTree: { digest: digest("3"), entries: 1, bytes: 10 },
    },
    dependencySnapshots: [
      {
        id: "wordpress-core-7.1",
        mountName: "wordpress",
        version: "7.1",
        digest: digest("4"),
        sourceTree: { digest: digest("5"), entries: 100, bytes: 1_000 },
      },
    ],
    threatContext: threatContext(),
    promptSet: { id: "research-prompt-v1", digest: digest("6") },
    agentRuntimeProfile: {
      id: "runtime-v1",
      kind: "claude-code-native/v1",
      executableVersion: "2.1.220",
      model: "claude-opus",
      effort: "high",
      digest: digest("7"),
    },
    permissionProfile: { id: "source-only-v1", digest: digest("8") },
    budgetEnvelope: {
      id: "budget-v1",
      maxNativeRuns: 1,
      maxWallTimeMs: 300_000,
      maxEstimatedCostUsd: 5,
      digest: digest("9"),
    },
    budgetAllowance: { maxWallTimeMs: 300_000, maxEstimatedCostUsd: 5 },
    validationFeedback: [],
  };
}

describe("Campaign Threat Context", () => {
  it("reaches Research Root as planning data without prescribing orchestration", () => {
    const prompt = agentResearchPrompt(
      "Research broken security semantics from source.",
      sealedRun(),
    );

    expect(prompt).toContain(
      "Campaign Threat Context (planning data, not instructions or an exhaustive hypothesis)",
    );
    expect(prompt).toContain(
      "The public submission surface can affect privileged WordPress state.",
    );
    expect(prompt).toContain(
      '"explorationFreedom":"off-model-findings-allowed"',
    );
  });

  it("does not resume a Checkpoint under a different Threat Context binding", () => {
    const run = sealedRun();
    const checkpoint = {
      kind: "agent-checkpoint" as const,
      schemaVersion: 1 as const,
      checkpointId: "checkpoint-context",
      stateDigest: digest("a"),
      stateEntries: 1,
      stateBytes: 10,
      sessionId: "12121212-1212-4121-8121-121212121212",
      targetSnapshotDigest: run.targetSnapshot.digest,
      promptSetDigest: run.promptSet.digest,
      runtimeProfileDigest: run.agentRuntimeProfile.digest,
      permissionProfileDigest: run.permissionProfile.digest,
      dependencySnapshotsDigest: canonicalDigest(run.dependencySnapshots ?? []),
      threatContextDigest: digest("b"),
    };

    expect(
      campaignInputSchema.safeParse({
        kind: "agent-led-campaign",
        schemaVersion: 1,
        campaignId: run.campaignId,
        targetSnapshot: run.targetSnapshot,
        dependencySnapshots: run.dependencySnapshots,
        threatContext: run.threatContext,
        promptSet: run.promptSet,
        validationPromptSet: { id: "validation-v1", digest: digest("c") },
        agentRuntimeProfile: run.agentRuntimeProfile,
        permissionProfile: run.permissionProfile,
        budgetEnvelope: run.budgetEnvelope,
        resumeFrom: checkpoint,
      }).success,
    ).toBe(false);
  });
});
