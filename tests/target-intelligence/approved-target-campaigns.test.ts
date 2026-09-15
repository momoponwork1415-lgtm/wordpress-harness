import { describe, expect, it } from "vitest";

import { canonicalDigest } from "../../src/infrastructure/canonical-json.js";
import type { CampaignInput } from "../../src/research/index.js";
import {
  openApprovedTargetCampaigns,
  type ApprovedTargetCampaignRequest,
  type ResearchCampaignPolicy,
} from "../../src/target-intelligence/approved-target-campaign/index.js";
import type { ApprovedTargetBatch } from "../../src/target-intelligence/approved-target-batch/index.js";
import type { TargetCandidate } from "../../src/target-intelligence/candidate-pool/index.js";

const digest = (character: string): string => `sha256:${character.repeat(64)}`;

function candidate(treeDigest: string): TargetCandidate {
  return {
    candidateId: "candidate-example-1",
    target: {
      pluginIdentity: "wporg:example",
      verifiedVersion: "1.0.0",
      canonicalFileManifestDigest: treeDigest,
    },
    targetObservation: {
      ref: { id: "observation-example", digest: digest("b") },
      retrievedAt: "2026-09-08T00:00:00.000Z",
      currentUntil: "2026-09-12T00:00:00.000Z",
      acquisition: "available",
      provenance: "verified",
      identity: "verified",
    },
    selectionFacts: {
      activeInstallCount: 10_000,
      lastUpdatedAt: "2026-09-01T00:00:00.000Z",
      integrations: ["public-form"],
    },
    programmes: [],
    disclosureRoute: {
      observationRef: {
        id: "route-example",
        digest: digest("c"),
        routeDigest: digest("d"),
      },
      kind: "delegated-vdp",
      currentUntil: "2026-09-12T00:00:00.000Z",
    },
    researchHistory: { status: "new" },
  };
}

function policy(): ResearchCampaignPolicy {
  const body = {
    kind: "research-campaign-policy" as const,
    schemaVersion: 1 as const,
    id: "research-campaign-policy-v1",
    promptSet: { id: "research-prompt-v1", digest: digest("e") },
    validationPromptSet: {
      id: "validation-prompt-v1",
      digest: digest("f"),
    },
    agentRuntimeProfile: {
      id: "claude-code-research-v1",
      kind: "claude-code-native/v1",
      executableVersion: "2.1.220",
      model: "claude-opus",
      effort: "high",
      digest: digest("1"),
    },
    permissionProfile: {
      id: "source-only-gvisor-v1",
      digest: digest("2"),
    },
    budgetEnvelope: {
      id: "research-budget-v1",
      maxNativeRuns: 4,
      maxWallTimeMs: 1_800_000,
      researchGrantWallTimeMs: 1_800_000,
      digest: digest("3"),
    },
  };
  return { ...body, digest: canonicalDigest(body) };
}

function approvedBatch(
  selected: TargetCandidate,
  campaignPolicy: ResearchCampaignPolicy,
): ApprovedTargetBatch {
  const body = {
    kind: "approved-target-batch" as const,
    schemaVersion: 3 as const,
    approvalInputDigest: digest("4"),
    batchKey: "approved-targets",
    revision: 1,
    proposalRef: {
      kind: "target-proposal-ref" as const,
      schemaVersion: 1 as const,
      id: "proposal-example",
      digest: digest("5"),
      selectionKey: "prospective-targets",
      revision: 1,
    },
    campaignPolicy: {
      id: campaignPolicy.id,
      digest: campaignPolicy.digest,
    },
    batchBudget: {
      id: "approved-budget-v1",
      digest: digest("6"),
      maxTargets: 1,
      maxActiveCampaigns: 1,
    },
    executionWindow: {
      startsAt: "2026-09-08T00:00:00.000Z",
      endsAt: "2026-09-10T00:00:00.000Z",
    },
    operator: {
      identity: "operator-fortn",
      decidedAt: "2026-09-08T00:01:00.000Z",
    },
    decisions: [
      {
        candidateId: selected.candidateId,
        decision: "approve" as const,
        reason: "Approve this exact prospective Target for Research.",
      },
    ],
    approvedOrder: [selected.candidateId],
    approvedTargets: [
      {
        candidateId: selected.candidateId,
        candidate: selected,
        source: "agent-proposal" as const,
        proposalReason:
          "The public input and privileged workflow form a valuable boundary.",
        proposalUncertainty: "No vulnerability is assumed before Research.",
        humanReason: "Approve this exact prospective Target for Research.",
      },
    ],
    excludedTargets: [],
    externalAction: "not-authorized" as const,
    approvedAt: "2026-09-08T00:02:00.000Z",
  };
  const batchDigest = canonicalDigest(body);
  return {
    ...body,
    id: `approved-target-batch:${batchDigest.slice(7, 31)}`,
    digest: batchDigest,
  };
}

function request(): ApprovedTargetCampaignRequest {
  const manifest = {
    kind: "canonical-file-manifest" as const,
    schemaVersion: 1 as const,
    entries: [{ path: "example.php", digest: digest("7"), size: 17 }],
  };
  const treeDigest = canonicalDigest(manifest);
  const selected = candidate(treeDigest);
  const campaignPolicy = policy();
  const targetSnapshotDigest = canonicalDigest({
    kind: "target-snapshot",
    schemaVersion: 1,
    pluginIdentity: selected.target.pluginIdentity,
    version: selected.target.verifiedVersion,
    treeDigest,
  });
  const threatContextBody = {
    kind: "campaign-threat-context" as const,
    schemaVersion: 1 as const,
    id: "threat-context-example-v1",
    whyThisTarget:
      "A public input surface reaches a workflow with privileged site effects.",
    ordinaryConfiguration:
      "The plugin is active with its public form and default administration UI.",
    attackerPositions: ["Unauthenticated public form submitter."],
    securityObjectives: [
      "Public input must not gain privileged site authority.",
    ],
    trustBoundaries: ["Public request to privileged WordPress workflow."],
    highValueTransitions: [
      "Attacker-controlled form state is later consumed by an administrator.",
    ],
    dependencyRoles: [
      {
        mountName: "wordpress",
        role: "wordpress-core" as const,
        relevance:
          "Core defines authorization, nonce, escaping, and plugin lifecycle semantics.",
      },
    ],
    uncertainties: [
      "The exact reachable effect remains for Research to derive.",
    ],
    explorationFreedom: "off-model-findings-allowed" as const,
  };
  const programmeBoundaryBody = {
    kind: "programme-research-boundary" as const,
    schemaVersion: 1 as const,
    id: "wordfence-1337-example-v1",
    programmeIdentity: "programme:wordfence",
    checkedAt: "2026-09-08T00:58:00.000Z",
    eligibleAttackerPositions: [
      "Unauthenticated visitor, Subscriber, or customer.",
    ],
    priorityImpacts: ["High-impact broken security semantics."],
    explicitExclusions: ["Business logic bugs."],
    excludedAssets: ["WordPress core."],
    sourceRefs: [{ id: "wordfence-scope-snapshot", digest: digest("d") }],
    uncertainties: [],
    handling: {
      sourceProvenExcluded: "park" as const,
      concreteEligibleEscalation: "continue" as const,
      scopeAmbiguity: "human-challenge" as const,
    },
  };
  return {
    kind: "approved-target-campaign-request",
    schemaVersion: 1,
    approvedBatch: approvedBatch(selected, campaignPolicy),
    candidateId: selected.candidateId,
    checkedAt: "2026-09-08T01:00:00.000Z",
    targetObservation: {
      ...selected.targetObservation,
      ref: { id: "fresh-observation-example", digest: digest("8") },
      retrievedAt: "2026-09-08T00:59:00.000Z",
    },
    targetIntake: {
      kind: "target-intake-packet",
      schemaVersion: 1,
      id: "packet-example",
      pluginIdentity: selected.target.pluginIdentity,
      version: selected.target.verifiedVersion,
      canonicalInstallDirectory: "example",
      mainPluginFile: "example.php",
      pluginBasename: "example/example.php",
      targetSnapshot: {
        id: "target-example-1.0.0",
        pluginSlug: "example",
        version: selected.target.verifiedVersion,
        digest: targetSnapshotDigest,
      },
      sourceTree: { digest: treeDigest, entries: 1, manifest },
      sourceCapture: {
        kind: "captured-wordpress-org-archive",
        digest: treeDigest,
        files: manifest.entries,
      },
      versionEvidence: {
        requestedVersion: selected.target.verifiedVersion,
        mainHeaderVersion: selected.target.verifiedVersion,
        mainFileDigest: digest("7"),
      },
      provenance: {
        kind: "wordpress-org",
        sourceUrl: "https://downloads.wordpress.org/plugin/example.1.0.0.zip",
        acquisitionRef: { id: "archive-example", digest: digest("9") },
      },
      policy: { id: "target-intake-policy-v1", digest: digest("a") },
    },
    campaignId: "campaign-approved-example-1",
    campaignPolicy,
    dependencySnapshots: [
      {
        id: "wordpress-core-7.1",
        mountName: "wordpress",
        version: "7.1",
        digest: digest("b"),
        sourceTree: { digest: digest("c"), entries: 2_000, bytes: 20_000_000 },
      },
    ],
    threatContext: {
      ...threatContextBody,
      digest: canonicalDigest(threatContextBody),
    },
    programmeBoundary: {
      ...programmeBoundaryBody,
      digest: canonicalDigest(programmeBoundaryBody),
    },
  };
}

describe("ApprovedTargetCampaigns", () => {
  it("conducts one approved fresh Campaign with exact source closure and threat context", async () => {
    const approvedRequest = request();
    let received: CampaignInput | undefined;
    const campaigns = openApprovedTargetCampaigns({
      campaigns: {
        async conduct(input) {
          if (input.kind !== "agent-led-campaign") {
            throw new Error(
              "Approved Target dispatch must conduct a Campaign input",
            );
          }
          received = input;
          return {
            kind: "agent-led-campaign-outcome",
            schemaVersion: 1,
            campaignId: input.campaignId,
            inputDigest: canonicalDigest(input),
            status: "research-continues",
          };
        },
      },
    });

    await expect(campaigns.conduct(approvedRequest)).resolves.toMatchObject({
      campaignId: approvedRequest.campaignId,
      status: "research-continues",
    });
    expect(received).toMatchObject({
      campaignId: approvedRequest.campaignId,
      targetSnapshot: {
        pluginSlug: "example",
        version: "1.0.0",
        sourceTree: { entries: 1, bytes: 17 },
      },
      dependencySnapshots: approvedRequest.dependencySnapshots,
      threatContext: approvedRequest.threatContext,
      programmeBoundary: approvedRequest.programmeBoundary,
      promptSet: approvedRequest.campaignPolicy.promptSet,
      agentRuntimeProfile: approvedRequest.campaignPolicy.agentRuntimeProfile,
    });
  });

  it("rejects a mismatched Target Intake before Research starts", async () => {
    const approvedRequest = request();
    let conducted = false;
    const campaigns = openApprovedTargetCampaigns({
      campaigns: {
        async conduct(input) {
          conducted = true;
          return {
            kind: "agent-led-campaign-outcome",
            schemaVersion: 1,
            campaignId: input.campaignId,
            inputDigest: canonicalDigest(input),
            status: "research-continues",
          };
        },
      },
    });

    await expect(
      campaigns.conduct({
        ...approvedRequest,
        targetIntake: {
          ...approvedRequest.targetIntake,
          version: "1.0.1",
        },
      }),
    ).rejects.toMatchObject({ code: "target-intake-mismatch" });
    expect(conducted).toBe(false);
  });

  it("requires one pinned WordPress core source in the Campaign closure", async () => {
    const approvedRequest = request();
    const threatContextBody = {
      ...approvedRequest.threatContext,
      dependencyRoles: approvedRequest.threatContext.dependencyRoles.map(
        (dependency) => ({ ...dependency, role: "runtime-library" as const }),
      ),
    };
    const { digest: _digest, ...body } = threatContextBody;
    const campaigns = openApprovedTargetCampaigns({
      campaigns: {
        conduct: () => {
          throw new Error("Research must not start");
        },
      },
    });

    await expect(
      campaigns.conduct({
        ...approvedRequest,
        threatContext: { ...body, digest: canonicalDigest(body) },
      }),
    ).rejects.toMatchObject({ code: "source-closure-invalid" });
  });
});
