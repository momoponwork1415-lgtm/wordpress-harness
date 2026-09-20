import { describe, expect, it } from "vitest";

import { canonicalDigest } from "../../src/infrastructure/canonical-json.js";
import {
  claudeCodeNativeTransport,
  defineAgentRuntimeProfile,
} from "../../src/infrastructure/agent-runtime-profile.js";
import {
  campaignInputSchema,
  type SealedNativeRun,
} from "../../src/research/agent-led/contracts.js";
import { agentResearchPrompt } from "../../src/research/agent-led/gvisor-agent-sandbox.js";
import { canonicalResearchPromptSet } from "../../src/research/agent-led/research-prompt-set.js";

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

function programmeBoundary() {
  const body = {
    kind: "programme-research-boundary" as const,
    schemaVersion: 1 as const,
    id: "wordfence-1337-boundary-v1",
    programmeIdentity: "programme:wordfence",
    checkedAt: "2026-09-08T00:00:00.000Z",
    eligibleAttackerPositions: [
      "Unauthenticated visitor, Subscriber, or customer.",
    ],
    priorityImpacts: [
      "High-impact broken security semantics attributable to the target plugin.",
    ],
    explicitExclusions: [
      "Business logic bugs.",
      "Basic information disclosure.",
    ],
    excludedAssets: [
      "WordPress core is source closure, not the report target.",
    ],
    sourceRefs: [{ id: "wordfence-scope-snapshot", digest: digest("d") }],
    uncertainties: [
      "Privilege classification across a multisite trust boundary needs human challenge.",
    ],
    handling: {
      sourceProvenExcluded: "park" as const,
      concreteEligibleEscalation: "continue" as const,
      scopeAmbiguity: "human-challenge" as const,
    },
  };
  return { ...body, digest: canonicalDigest(body) };
}

function sealedRun(): SealedNativeRun {
  return {
    kind: "sealed-native-research-run",
    schemaVersion: 2,
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
    programmeBoundary: programmeBoundary(),
    promptSet: canonicalResearchPromptSet,
    agentRuntimeProfile: defineAgentRuntimeProfile({
      id: "runtime-v1",
      ...claudeCodeNativeTransport,
      model: "claude-opus-5",
      effort: "high",
    }),
    permissionProfile: { id: "source-only-v1", digest: digest("8") },
    budgetEnvelope: {
      id: "budget-v1",
      maxNativeRuns: 1,
      maxWallTimeMs: 300_000,
      digest: digest("9"),
    },
    budgetAllowance: { maxWallTimeMs: 300_000 },
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
    expect(prompt).toContain(
      "Programme Research Boundary (effort and Candidate constraints, not a vulnerability oracle)",
    );
    expect(prompt).toContain(
      "Do not re-emit a Candidate or parked Programme Lead returned by an earlier completed Research run",
    );
    expect(prompt).toContain(
      "Report only records first established in this run",
    );
    expect(prompt).toContain("report the revision under a new id");
    expect(prompt).toContain(
      "Do not spend a subagent or adversarial Candidate review on that lead",
    );
    expect(prompt).toContain(
      "Stop tool use and reserve at least 60 seconds to synthesize",
    );
    expect(prompt).toContain('"sourceProvenExcluded":"park"');
    expect(prompt).not.toContain("researcherTier");
    expect(prompt).not.toContain("targetEligibility");
    expect(prompt).not.toContain("programme:wordfence");
    expect(prompt).not.toContain("wordfence-scope-snapshot");
    expect(prompt).toContain(
      "Resume deep work only when a concrete source-bound edge could reach an eligible impact",
    );
    expect(prompt).toContain(
      "This Native Run is source investigation time, not a planning turn",
    );
    expect(prompt).toContain(
      "Every report must also include a run-local evidenceSummary",
    );
    expect(prompt).toContain(
      "For every Candidate, provide an ordered sourceTrace",
    );
    expect(prompt).toContain("HARNESS_RESULT JSON line");
  });

  it("tells a resumed Research Root to execute its prior next actions", () => {
    const prompt = agentResearchPrompt("Research from source.", {
      ...sealedRun(),
      researchContinuationNextActions: [
        {
          question: "Which callback consumes the stored identifier?",
          sourcePointers: ["inc/callbacks.php"],
        },
      ],
    });

    expect(prompt).toContain(
      "Prior Root Research continuation source-bound next actions",
    );
    expect(prompt).toContain(
      '"question":"Which callback consumes the stored identifier?"',
    );
    expect(prompt).toContain(
      "Investigate or supersede these next actions during this run",
    );
    expect(prompt).toContain(
      "consult the restored Checkpoint and scratch research history",
    );
    expect(prompt).toContain(
      "Do not mechanically repeat a completed route unless a prior next action, new source evidence, a Candidate validation gap, or a concrete composition requires revisiting it",
    );
    expect(prompt).toContain(
      "Do not merely repeat the prior actions in decision.nextActions",
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
        schemaVersion: 2,
        campaignId: run.campaignId,
        targetSnapshot: run.targetSnapshot,
        dependencySnapshots: run.dependencySnapshots,
        threatContext: run.threatContext,
        programmeBoundary: run.programmeBoundary,
        promptSet: run.promptSet,
        agentRuntimeProfile: run.agentRuntimeProfile,
        permissionProfile: run.permissionProfile,
        budgetEnvelope: run.budgetEnvelope,
        resumeFrom: checkpoint,
      }).success,
    ).toBe(false);
  });

  it("does not resume a Checkpoint under a different Programme Research Boundary", () => {
    const run = sealedRun();
    const checkpoint = {
      kind: "agent-checkpoint" as const,
      schemaVersion: 1 as const,
      checkpointId: "checkpoint-programme-boundary",
      stateDigest: digest("a"),
      stateEntries: 1,
      stateBytes: 10,
      sessionId: "13131313-1313-4131-8131-131313131313",
      targetSnapshotDigest: run.targetSnapshot.digest,
      promptSetDigest: run.promptSet.digest,
      runtimeProfileDigest: run.agentRuntimeProfile.digest,
      permissionProfileDigest: run.permissionProfile.digest,
      dependencySnapshotsDigest: canonicalDigest(run.dependencySnapshots ?? []),
      threatContextDigest: run.threatContext?.digest,
      programmeBoundaryDigest: digest("e"),
    };

    expect(
      campaignInputSchema.safeParse({
        kind: "agent-led-campaign",
        schemaVersion: 2,
        campaignId: run.campaignId,
        targetSnapshot: run.targetSnapshot,
        dependencySnapshots: run.dependencySnapshots,
        threatContext: run.threatContext,
        programmeBoundary: run.programmeBoundary,
        promptSet: run.promptSet,
        agentRuntimeProfile: run.agentRuntimeProfile,
        permissionProfile: run.permissionProfile,
        budgetEnvelope: run.budgetEnvelope,
        resumeFrom: checkpoint,
      }).success,
    ).toBe(false);
  });
});
