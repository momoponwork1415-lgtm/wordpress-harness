import { describe, expect, it } from "vitest";

import {
  codexNativeTransport,
  defineAgentRuntimeProfile,
} from "../../src/infrastructure/agent-runtime-profile.js";
import { canonicalDigest } from "../../src/infrastructure/canonical-json.js";
import { deriveCampaignExplorationVolume } from "../../src/operations/campaign-exploration-volume.js";
import type {
  AgentCheckpointRef,
  CampaignInput,
  NativeRunAttempt,
  NativeRunReceipt,
  ResearchCampaignView,
  ResearchCandidate,
  SealedNativeRun,
} from "../../src/research/agent-led/contracts.js";
import { researchEvidenceSummaryFixture } from "../research/support/research-evidence-summary.js";

function digest(character: string): string {
  return `sha256:${character.repeat(64)}`;
}

const runtimeProfile = defineAgentRuntimeProfile({
  id: "codex-daybreak-xhigh",
  ...codexNativeTransport,
  model: "gpt-daybreak-blue-latest",
  effort: "xhigh",
});

function campaignInput(
  campaignId: string,
  pluginSlug: string,
  sourceTree: { entries: number; bytes: number },
): CampaignInput {
  return {
    kind: "agent-led-campaign",
    schemaVersion: 2,
    campaignId,
    targetSnapshot: {
      id: `${pluginSlug}-1.2.0`,
      pluginSlug,
      version: "1.2.0",
      digest: digest("a"),
      sourceTree: { digest: digest("b"), ...sourceTree },
    },
    promptSet: {
      id: "wordpress-plugin-research-wp2shell-v9",
      digest: digest("c"),
    },
    agentRuntimeProfile: runtimeProfile,
    permissionProfile: { id: "source-only-v1", digest: digest("d") },
    budgetEnvelope: {
      id: "campaign-envelope-v1",
      maxNativeRuns: 8,
      maxWallTimeMs: 10_800_000,
      digest: digest("e"),
    },
  };
}

function candidate(candidateId: string): ResearchCandidate {
  return {
    candidateId,
    attackerPremise: "Unauthenticated visitor",
    brokenSecurityProperty: "Only administrators may update plugin options",
    claim: "A public request can change an administrator-only plugin option.",
    evidence: [
      {
        path: "plugin.php",
        location: "update_option:42",
        observation: "The public callback persists an attacker value.",
      },
    ],
    sourceTrace: [
      {
        path: "plugin.php",
        location: "public_callback:30",
        role: "entrypoint",
        observation: "The callback is reachable without authentication.",
      },
      {
        path: "plugin.php",
        location: "update_option:42",
        role: "effect",
        observation: "The option update uses the attacker value.",
      },
    ],
    controlAssessments: [
      {
        control: "Capability check",
        evidence: [
          {
            path: "plugin.php",
            location: "public_callback:31",
            observation: "No capability check guards the update.",
          },
        ],
        conclusion: "No source-visible authority check prevents the update.",
      },
    ],
    unresolvedFacts: [],
  };
}

function runFor(input: CampaignInput, ordinal: number): SealedNativeRun {
  return {
    kind: "sealed-native-research-run",
    schemaVersion: 2,
    runId: `${input.campaignId}:native:${ordinal}`,
    campaignId: input.campaignId,
    campaignInputDigest: canonicalDigest(input),
    targetSnapshot: input.targetSnapshot,
    promptSet: input.promptSet,
    agentRuntimeProfile: input.agentRuntimeProfile,
    permissionProfile: input.permissionProfile,
    budgetEnvelope: input.budgetEnvelope,
    budgetAllowance: { maxWallTimeMs: 3_600_000 },
  };
}

function checkpointFor(run: SealedNativeRun): AgentCheckpointRef {
  return {
    kind: "agent-checkpoint",
    schemaVersion: 1,
    checkpointId: `${run.runId}:checkpoint`,
    stateDigest: digest("1"),
    stateEntries: 1,
    stateBytes: 1,
    sessionId: `session-${run.runId.replaceAll(":", "-")}`,
    targetSnapshotDigest: run.targetSnapshot.digest,
    promptSetDigest: run.promptSet.digest,
    runtimeProfileDigest: run.agentRuntimeProfile.digest,
    permissionProfileDigest: run.permissionProfile.digest,
  };
}

function completedReceipt(
  run: SealedNativeRun,
  options: {
    wallTimeMs: number;
    inputTokens?: number;
    outputTokens?: number;
    estimatedCostUsd?: number;
    tools: readonly string[] | null;
    subagents: number | null;
    candidates: readonly ResearchCandidate[];
    decision: "continue" | "stop";
  },
): NativeRunReceipt {
  return {
    schemaVersion: 2,
    runId: run.runId,
    runtimeProfileDigest: run.agentRuntimeProfile.digest,
    terminal: "completed",
    startedAt: "2026-09-18T00:00:00.000Z",
    completedAt: "2026-09-18T00:30:00.000Z",
    usage: {
      wallTimeMs: options.wallTimeMs,
      ...(options.inputTokens === undefined
        ? {}
        : { inputTokens: options.inputTokens }),
      ...(options.outputTokens === undefined
        ? {}
        : { outputTokens: options.outputTokens }),
      ...(options.estimatedCostUsd === undefined
        ? {}
        : { estimatedCostUsd: options.estimatedCostUsd }),
    },
    activity: {
      subagents: options.subagents,
      tools: options.tools === null ? null : [...options.tools],
    },
    isolation: { backend: "gvisor", runtime: "runsc", fallbackUsed: false },
    checkpoint: checkpointFor(run),
    report: {
      schemaVersion: 2,
      assessments: [],
      evidenceSummary: researchEvidenceSummaryFixture(),
      candidates: [...options.candidates],
      decision:
        options.decision === "stop"
          ? { kind: "stop", basis: "No actionable frontier remains." }
          : {
              kind: "continue",
              reason: "A source-bound route remains open.",
              nextActions: [
                {
                  question: "Does the consumer escape the stored value?",
                  sourcePointers: ["plugin.php:render:90"],
                },
              ],
            },
    },
  };
}

function failedReceipt(
  run: SealedNativeRun,
  wallTimeMs: number,
): NativeRunReceipt {
  return {
    schemaVersion: 2,
    runId: run.runId,
    runtimeProfileDigest: run.agentRuntimeProfile.digest,
    terminal: "provider-quota-exhausted",
    startedAt: "2026-09-18T01:00:00.000Z",
    completedAt: "2026-09-18T01:00:10.000Z",
    usage: { wallTimeMs },
    activity: { subagents: null, tools: null },
    failure: { summary: "Quota unavailable.", retryable: true },
  };
}

function attemptFor(
  run: SealedNativeRun,
  receipt: NativeRunReceipt | undefined,
): NativeRunAttempt {
  return {
    kind: "native-run-attempt",
    schemaVersion: 1,
    run,
    runDigest: canonicalDigest(run),
    startedAt: "2026-09-18T00:00:00.000Z",
    ...(receipt === undefined
      ? { status: "orphaned" as const }
      : {
          status: "terminal" as const,
          nativeRunReceiptDigest: canonicalDigest(receipt),
        }),
  };
}

function viewFor(
  input: CampaignInput,
  runs: readonly { run: SealedNativeRun; receipt?: NativeRunReceipt }[],
  options: {
    status: ResearchCampaignView["status"];
    parkedProgrammeLeads?: number;
  },
): ResearchCampaignView {
  return {
    kind: "agent-led-campaign-outcome",
    schemaVersion: 4,
    campaignId: input.campaignId,
    inputDigest: canonicalDigest(input),
    status: options.status,
    input,
    nativeRunAttempts: runs.map(({ run, receipt }) => attemptFor(run, receipt)),
    nativeRuns: runs.flatMap(({ receipt }) =>
      receipt === undefined ? [] : [receipt],
    ),
    candidateReviews: [],
    parkedProgrammeLeads: Array.from(
      { length: options.parkedProgrammeLeads ?? 0 },
      (_, index) => ({
        leadId: `${input.campaignId}:lead:${index + 1}`,
        attackerPremise: "Contributor",
        primitive: "Shortcode attribute reaches an unescaped sink.",
        maximumSourceSupportedEffect: "Contributor-level Stored XSS.",
        eligibleEscalationAssessment: "no-concrete-source-bound-path",
        evidence: [
          {
            path: "shortcode.php",
            location: "render:12",
            observation: "The attribute is echoed without escaping.",
          },
        ],
      }),
    ),
    candidateVerificationRequests: [],
    verificationPreparationNeeded: [],
    researchProgress: {
      completedRuns: [],
      observedSourcePaths: [],
      pendingNextActions: [],
    },
    coverage: { status: "open" },
  };
}

describe("campaign exploration volume", () => {
  it("derives plugin size and exploration volume per Campaign from stored views", () => {
    const alpha = campaignInput("campaign-alpha", "alpha", {
      entries: 120,
      bytes: 3_400_000,
    });
    const alphaRun1 = runFor(alpha, 1);
    const alphaRun2 = runFor(alpha, 2);
    const alphaRun3 = runFor(alpha, 3);
    const alphaRun4 = runFor(alpha, 4);
    const alphaView = viewFor(
      alpha,
      [
        {
          run: alphaRun1,
          receipt: completedReceipt(alphaRun1, {
            wallTimeMs: 1_800_000,
            inputTokens: 500_000,
            outputTokens: 40_000,
            estimatedCostUsd: 1.25,
            tools: [
              "source_reader.read",
              "source_reader.read",
              "source_reader.search",
            ],
            subagents: 2,
            candidates: [candidate("candidate-alpha-1")],
            decision: "continue",
          }),
        },
        {
          run: alphaRun2,
          receipt: completedReceipt(alphaRun2, {
            wallTimeMs: 900_000,
            inputTokens: 200_000,
            outputTokens: 10_000,
            estimatedCostUsd: 0.5,
            tools: ["source_reader.read"],
            subagents: 0,
            candidates: [candidate("candidate-alpha-2")],
            decision: "stop",
          }),
        },
        { run: alphaRun3, receipt: failedReceipt(alphaRun3, 10_000) },
        { run: alphaRun4 },
      ],
      { status: "candidate-review-pending", parkedProgrammeLeads: 1 },
    );

    const beta = campaignInput("campaign-beta", "beta", {
      entries: 8,
      bytes: 40_000,
    });
    const betaRun1 = runFor(beta, 1);
    const betaView = viewFor(
      beta,
      [
        {
          run: betaRun1,
          receipt: completedReceipt(betaRun1, {
            wallTimeMs: 300_000,
            tools: null,
            subagents: null,
            candidates: [],
            decision: "stop",
          }),
        },
      ],
      { status: "coverage-closed" },
    );

    const report = deriveCampaignExplorationVolume([alphaView, betaView]);

    expect(report).toStrictEqual({
      kind: "campaign-exploration-volume",
      schemaVersion: 1,
      rows: [
        {
          campaignId: "campaign-alpha",
          status: "candidate-review-pending",
          pluginSlug: "alpha",
          version: "1.2.0",
          sourceTree: { entries: 120, bytes: 3_400_000 },
          phpSource: "unknown",
          runtime: {
            transportKind: "codex-native/v1",
            model: "gpt-daybreak-blue-latest",
            effort: "xhigh",
          },
          promptSetId: "wordpress-plugin-research-wp2shell-v9",
          nativeRuns: { attempted: 4, completed: 2, failed: 1, orphaned: 1 },
          wallTimeMs: 2_710_000,
          inputTokens: 700_000,
          outputTokens: 50_000,
          estimatedCostUsd: 1.75,
          toolCalls: 4,
          subagentsMax: 2,
          candidates: 2,
          parkedProgrammeLeads: 1,
          finalDecision: "stop",
        },
        {
          campaignId: "campaign-beta",
          status: "coverage-closed",
          pluginSlug: "beta",
          version: "1.2.0",
          sourceTree: { entries: 8, bytes: 40_000 },
          phpSource: "unknown",
          runtime: {
            transportKind: "codex-native/v1",
            model: "gpt-daybreak-blue-latest",
            effort: "xhigh",
          },
          promptSetId: "wordpress-plugin-research-wp2shell-v9",
          nativeRuns: { attempted: 1, completed: 1, failed: 0, orphaned: 0 },
          wallTimeMs: 300_000,
          inputTokens: "unknown",
          outputTokens: "unknown",
          estimatedCostUsd: "unknown",
          toolCalls: "unknown",
          subagentsMax: "unknown",
          candidates: 0,
          parkedProgrammeLeads: 0,
          finalDecision: "stop",
        },
      ],
    });
  });

  it("counts PHP files and bytes when the Target source manifest is supplied", () => {
    const alpha = campaignInput("campaign-alpha", "alpha", {
      entries: 3,
      bytes: 1_300,
    });
    const alphaRun1 = runFor(alpha, 1);
    const alphaView = viewFor(
      alpha,
      [
        {
          run: alphaRun1,
          receipt: completedReceipt(alphaRun1, {
            wallTimeMs: 1_000,
            tools: [],
            subagents: 0,
            candidates: [],
            decision: "stop",
          }),
        },
      ],
      { status: "coverage-closed" },
    );

    const report = deriveCampaignExplorationVolume([alphaView], {
      sourceManifests: [
        {
          digest: digest("b"),
          entries: [
            { path: "alpha.php", size: 1_000 },
            { path: "includes/Admin.PHP", size: 200 },
            { path: "assets/app.js", size: 100 },
          ],
        },
        {
          digest: digest("f"),
          entries: [{ path: "other.php", size: 999 }],
        },
      ],
    });

    expect(report.rows[0]?.phpSource).toStrictEqual({ files: 2, bytes: 1_200 });
  });
});
