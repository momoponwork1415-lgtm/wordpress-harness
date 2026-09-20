import { createHash } from "node:crypto";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  deepSeekHarnessNativeTransport,
  defineAgentRuntimeProfile,
} from "../../src/infrastructure/agent-runtime-profile.js";
import { canonicalDigest } from "../../src/infrastructure/canonical-json.js";
import { measureCanonicalSourceTree } from "../../src/infrastructure/canonical-source-tree.js";
import { promptTextDigest } from "../../src/infrastructure/prompt-text.js";
import {
  campaignInputForIndependentResearchTrial,
  decideIndependentResearchTrialLaunches,
  comparisonRequestForIndependentResearchTrialApproval,
  defineIndependentResearchTrialApproval,
  defineIndependentResearchTrialGateObservation,
  defineIndependentResearchTrialReadiness,
  independentResearchTrialApprovalSchema,
  type IndependentResearchTrialApprovalDefinition,
  type IndependentResearchTrialClaim,
} from "../../src/operations/independent-research-trial-launcher.js";
import {
  buildIndependentResearchTrialCommand,
  dispatchIndependentResearchTrials,
  inspectIndependentResearchTrialClaims,
} from "../../src/operations/independent-research-trial-launcher-runtime.js";
import { runIndependentResearchTrialLauncherCli } from "../../src/operations/independent-research-trial-launcher-cli.js";
import { inspectIndependentResearchTrialReadiness } from "../../src/operations/independent-research-trial-readiness.js";
import type { DeepSeekAccountReadinessObservation } from "../../src/operations/deepseek-account-readiness.js";
import {
  canonicalResearchPromptSet,
  type CampaignInput,
} from "../../src/research/index.js";
import {
  type ApprovedTargetCampaignRequest,
  type ResearchCampaignPolicy,
} from "../../src/target-intelligence/approved-target-campaign/index.js";
import { admitApprovedTargetCampaign } from "../../src/target-intelligence/approved-target-campaign/approved-target-campaigns.js";
import type { ApprovedTargetBatch } from "../../src/target-intelligence/approved-target-batch/index.js";
import type { TargetCandidate } from "../../src/target-intelligence/candidate-pool/index.js";

const digest = (character: string) => `sha256:${character.repeat(64)}`;

interface ApprovedRequestFixtureOptions {
  readonly targetManifest?: Readonly<{
    kind: "canonical-file-manifest";
    schemaVersion: 1;
    entries: readonly Readonly<{
      path: string;
      digest: string;
      size: number;
    }>[];
  }>;
  readonly dependencySourceTree?: Readonly<{
    digest: string;
    entries: number;
    bytes: number;
  }>;
  readonly promptDigest?: string;
}

function campaignPolicy(
  promptDigest: string = canonicalResearchPromptSet.digest,
): ResearchCampaignPolicy {
  const body = {
    kind: "research-campaign-policy" as const,
    schemaVersion: 2 as const,
    id: "deepseek-pass-at-three-policy-v1",
    promptSet: { id: canonicalResearchPromptSet.id, digest: promptDigest },
    agentRuntimeProfile: defineAgentRuntimeProfile({
      id: "deepseek-v4-1",
      ...deepSeekHarnessNativeTransport,
      model: "deepseek-flash",
      effort: "max",
    }),
    permissionProfile: { id: "read-only", digest: digest("f") },
    budgetEnvelope: {
      id: "budget-pass-at-three",
      maxNativeRuns: 2,
      maxWallTimeMs: 3_600_000,
      digest: digest("1"),
    },
  };
  return { ...body, digest: canonicalDigest(body) };
}

function targetCandidate(treeDigest: string): TargetCandidate {
  return {
    candidateId: "candidate-pass-at-three-1",
    target: {
      pluginIdentity: "wporg:pass-at-three",
      verifiedVersion: "1.0.0",
      canonicalFileManifestDigest: treeDigest,
    },
    targetObservation: {
      ref: { id: "observation-pass-at-three", digest: digest("2") },
      retrievedAt: "2026-09-18T07:00:00.000Z",
      currentUntil: "2026-09-18T10:00:00.000Z",
      acquisition: "available",
      provenance: "verified",
      identity: "verified",
    },
    selectionFacts: {
      activeInstallCount: 10_000,
      lastUpdatedAt: "2026-09-17T00:00:00.000Z",
      integrations: ["public-form"],
    },
    programmes: [],
    disclosureRoute: {
      observationRef: {
        id: "route-pass-at-three",
        digest: digest("3"),
        routeDigest: digest("4"),
      },
      kind: "delegated-vdp",
      currentUntil: "2026-09-18T10:00:00.000Z",
    },
    researchHistory: { status: "new" },
  };
}

function approvedBatch(
  selected: TargetCandidate,
  policy: ResearchCampaignPolicy,
): ApprovedTargetBatch {
  const body = {
    kind: "approved-target-batch" as const,
    schemaVersion: 3 as const,
    approvalInputDigest: digest("5"),
    batchKey: "deepseek-pass-at-three",
    revision: 1,
    proposalRef: {
      kind: "target-proposal-ref" as const,
      schemaVersion: 1 as const,
      id: "proposal-pass-at-three",
      digest: digest("6"),
      selectionKey: "prospective-targets",
      revision: 1,
    },
    campaignPolicy: { id: policy.id, digest: policy.digest },
    batchBudget: {
      id: "deepseek-pass-at-three-batch-budget",
      digest: digest("7"),
      maxTargets: 1,
      maxActiveCampaigns: 1,
    },
    executionWindow: {
      startsAt: "2026-09-18T07:00:00.000Z",
      endsAt: "2026-09-18T09:30:00.000Z",
    },
    operator: {
      identity: "operator-fortn",
      decidedAt: "2026-09-18T07:30:00.000Z",
    },
    decisions: [
      {
        candidateId: selected.candidateId,
        decision: "approve" as const,
        reason: "Approve this exact Target for the pass-at-three evaluation.",
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
        humanReason:
          "Approve this exact Target for the pass-at-three evaluation.",
      },
    ],
    excludedTargets: [],
    externalAction: "not-authorized" as const,
    approvedAt: "2026-09-18T07:40:00.000Z",
  };
  const batchDigest = canonicalDigest(body);
  return {
    ...body,
    id: `approved-target-batch:${batchDigest.slice(7, 31)}`,
    digest: batchDigest,
  };
}

function approvedTargetCampaignRequest(
  id: string,
  options: ApprovedRequestFixtureOptions = {},
): ApprovedTargetCampaignRequest {
  const manifest =
    options.targetManifest ??
    ({
      kind: "canonical-file-manifest",
      schemaVersion: 1,
      entries: [{ path: "pass-at-three.php", digest: digest("8"), size: 200 }],
    } as const);
  const treeDigest = canonicalDigest(manifest);
  const selected = targetCandidate(treeDigest);
  const policy = campaignPolicy(options.promptDigest);
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
    id: "threat-context-pass-at-three-v1",
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
      "Attacker-controlled state is consumed by a privileged workflow.",
    ],
    dependencyRoles: [
      {
        mountName: "wordpress",
        role: "wordpress-core" as const,
        relevance: "Core defines the final framework security semantics.",
      },
    ],
    uncertainties: ["The exact reachable effect remains for Research."],
    explorationFreedom: "off-model-findings-allowed" as const,
  };
  const programmeBoundaryBody = {
    kind: "programme-research-boundary" as const,
    schemaVersion: 1 as const,
    id: "research-only-pass-at-three-v1",
    programmeIdentity: "programme:research-only",
    checkedAt: "2026-09-18T07:58:00.000Z",
    eligibleAttackerPositions: [
      "Unauthenticated visitor or low-privilege user.",
    ],
    priorityImpacts: ["High-impact broken security semantics."],
    explicitExclusions: ["No external action is authorized."],
    excludedAssets: ["WordPress core."],
    sourceRefs: [{ id: "research-boundary", digest: digest("9") }],
    uncertainties: [],
    handling: {
      sourceProvenExcluded: "park" as const,
      concreteEligibleEscalation: "continue" as const,
      scopeAmbiguity: "human-challenge" as const,
    },
  };
  const mainEntry = manifest.entries[0]!;
  return {
    kind: "approved-target-campaign-request",
    schemaVersion: 1,
    approvedBatch: approvedBatch(selected, policy),
    candidateId: selected.candidateId,
    checkedAt: "2026-09-18T08:00:00.000Z",
    targetObservation: {
      ...selected.targetObservation,
      ref: { id: "fresh-observation-pass-at-three", digest: digest("a") },
      retrievedAt: "2026-09-18T07:59:00.000Z",
    },
    targetIntake: {
      kind: "target-intake-packet",
      schemaVersion: 1,
      id: "packet-pass-at-three",
      pluginIdentity: selected.target.pluginIdentity,
      version: selected.target.verifiedVersion,
      canonicalInstallDirectory: "pass-at-three",
      mainPluginFile: mainEntry.path,
      pluginBasename: `pass-at-three/${mainEntry.path}`,
      targetSnapshot: {
        id: "target-pass-at-three",
        pluginSlug: "pass-at-three",
        version: selected.target.verifiedVersion,
        digest: targetSnapshotDigest,
      },
      sourceTree: {
        digest: treeDigest,
        entries: manifest.entries.length,
        manifest: {
          ...manifest,
          entries: [...manifest.entries],
        },
      },
      sourceCapture: {
        kind: "captured-wordpress-org-archive",
        digest: treeDigest,
        files: [...manifest.entries],
      },
      versionEvidence: {
        requestedVersion: selected.target.verifiedVersion,
        mainHeaderVersion: selected.target.verifiedVersion,
        mainFileDigest: mainEntry.digest,
      },
      provenance: {
        kind: "wordpress-org",
        sourceUrl:
          "https://downloads.wordpress.org/plugin/pass-at-three.1.0.0.zip",
        acquisitionRef: { id: "archive-pass-at-three", digest: digest("b") },
      },
      policy: { id: "target-intake-policy-v1", digest: digest("c") },
    },
    campaignId: `campaign-${id}`,
    campaignPolicy: policy,
    dependencySnapshots: [
      {
        id: "wordpress-6.9",
        mountName: "wordpress",
        version: "6.9",
        digest: digest("d"),
        sourceTree:
          options.dependencySourceTree ??
          ({ digest: digest("0"), entries: 3, bytes: 300 } as const),
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

function campaignInput(
  id: string,
  options: ApprovedRequestFixtureOptions = {},
): CampaignInput {
  return admitApprovedTargetCampaign(
    approvedTargetCampaignRequest(id, options),
  );
}

function approvalDefinition(): IndependentResearchTrialApprovalDefinition {
  return {
    approvalId: "deepseek-pass-at-three-1",
    approvedAt: "2026-09-18T08:00:00.000Z",
    expiresAt: "2026-09-18T09:00:00.000Z",
    maxReadinessAgeSeconds: 300,
    maxConcurrentTrials: 2,
    launchPolicy: { kind: "all-approved" },
    runtime: {
      nodeExecutablePath: "/usr/bin/node",
      harnessCliPath: "/workspace/dist/cli.js",
      dockerExecutablePath: "/usr/bin/docker",
    },
    aggregateAllowance: {
      maxNativeRuns: 6,
      maxWallTimeMs: 10_800_000,
    },
    trials: ["one", "two", "three"].map((id) => ({
      trialId: id,
      approvedTargetCampaignRequest: approvedTargetCampaignRequest(id),
      targetSourceDirectory: `/private/source/${id}`,
      dependencySources: [
        { mountName: "wordpress", directory: "/private/wordpress" },
      ],
      databasePath: `/private/database/${id}.sqlite`,
      scratchDirectory: `/private/scratch/${id}`,
      logPath: `/private/logs/${id}.log`,
      image: `research@${deepSeekHarnessNativeTransport.sandboxImageDigest}`,
      providerConfigDirectory: "/private/provider",
      researchPromptPath: "/workspace/prompts/research-v3.md",
    })),
  };
}

function readiness(
  status: DeepSeekAccountReadinessObservation["status"] = "ready",
): DeepSeekAccountReadinessObservation {
  const failureHttpStatus =
    status === "unauthenticated"
      ? 401
      : status === "quota-exhausted"
        ? 402
        : status === "rate-limited"
          ? 429
          : status === "unavailable"
            ? 503
            : status === "invalid-response"
              ? 200
              : null;
  const body = {
    kind: "deepseek-account-readiness-observation" as const,
    schemaVersion: 1 as const,
    observedAt: "2026-09-18T08:04:00.000Z",
    providerOrigin: "https://api.deepseek.com" as const,
    status,
    httpStatus: status === "ready" ? 200 : failureHttpStatus,
    isAvailable: status === "ready" ? true : null,
    balances:
      status === "ready"
        ? [
            {
              currency: "USD",
              totalBalance: "10.00000000",
              grantedBalance: "0.00000000",
              toppedUpBalance: "10.00000000",
            },
          ]
        : [],
  };
  return { ...body, digest: canonicalDigest(body) };
}

describe("Independent Research Trial launcher", () => {
  it("rejects a raw Campaign Input that bypasses Target Intelligence approval", () => {
    const definition = approvalDefinition();
    const rawInputDefinition = {
      ...definition,
      trials: definition.trials.map((trial) => {
        const {
          approvedTargetCampaignRequest: approvedRequest,
          ...launchBinding
        } = trial;
        return {
          ...launchBinding,
          campaignInput: admitApprovedTargetCampaign(approvedRequest),
        };
      }),
    };

    expect(() =>
      defineIndependentResearchTrialApproval(rawInputDefinition),
    ).toThrow(/approvedTargetCampaignRequest/u);
  });

  it("binds an exact fresh trial set and selects only aggregate concurrent allowance", () => {
    const approval =
      defineIndependentResearchTrialApproval(approvalDefinition());
    const accountReadiness = readiness();

    const decision = decideIndependentResearchTrialLaunches({
      approval,
      accountReadiness,
      claims: [],
      now: "2026-09-18T08:05:00.000Z",
    });

    expect(approval).toMatchObject({
      kind: "independent-research-trial-approval",
      schemaVersion: 3,
      approvalId: "deepseek-pass-at-three-1",
      trials: [
        {
          trialId: "one",
          approvedTargetCampaignRequest: { campaignId: "campaign-one" },
        },
        {
          trialId: "two",
          approvedTargetCampaignRequest: { campaignId: "campaign-two" },
        },
        {
          trialId: "three",
          approvedTargetCampaignRequest: { campaignId: "campaign-three" },
        },
      ],
      digest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/u),
    });
    expect(
      comparisonRequestForIndependentResearchTrialApproval(approval),
    ).toMatchObject({
      comparisonId: approval.approvalId,
      trialCampaignIds: ["campaign-one", "campaign-two", "campaign-three"],
      expectedBinding: { freshSession: true },
    });
    expect(decision).toEqual({
      kind: "independent-research-trial-launch-decision",
      approvalId: approval.approvalId,
      approvalDigest: approval.digest,
      accountReadinessDigest: accountReadiness.digest,
      gateObservationDigest: null,
      selectedTrialIds: ["one", "two"],
      claimedTrialIds: [],
      activeClaims: 0,
      remainingNativeRuns: 6,
      remainingWallTimeMs: 10_800_000,
      reason: "launch-approved",
    });
  });

  it("counts immutable claims against both aggregate allowance and active slots", () => {
    const approval =
      defineIndependentResearchTrialApproval(approvalDefinition());
    const claimBody = {
      kind: "independent-research-trial-claim",
      schemaVersion: 2,
      approvalId: approval.approvalId,
      approvalDigest: approval.digest,
      trialId: "one",
      campaignId: "campaign-one",
      campaignInputDigest: canonicalDigest(campaignInput("one")),
      accountReadinessDigest: readiness().digest,
      trialReadinessDigest: digest("8"),
      gateObservationDigest: null,
      reservedNativeRuns: 2,
      reservedWallTimeMs: 3_600_000,
      claimedAt: "2026-09-18T08:04:30.000Z",
    } as const;
    const claim: IndependentResearchTrialClaim = {
      ...claimBody,
      digest: canonicalDigest(claimBody),
    };

    const decision = decideIndependentResearchTrialLaunches({
      approval,
      accountReadiness: readiness(),
      claims: [{ claim, active: true }],
      now: "2026-09-18T08:05:00.000Z",
    });

    expect(decision).toMatchObject({
      selectedTrialIds: ["two"],
      claimedTrialIds: ["one"],
      activeClaims: 1,
      remainingNativeRuns: 4,
      remainingWallTimeMs: 7_200_000,
      reason: "launch-approved",
    });
  });

  it("launches one production Trial first and releases two fresh follow-ups only after a Candidate signal", () => {
    const base = approvalDefinition();
    const approval = defineIndependentResearchTrialApproval({
      ...base,
      launchPolicy: {
        kind: "candidate-gated-followups",
        initialTrialId: "one",
      },
    });

    const first = decideIndependentResearchTrialLaunches({
      approval,
      accountReadiness: readiness(),
      claims: [],
      now: "2026-09-18T08:05:00.000Z",
    });
    expect(first).toMatchObject({
      selectedTrialIds: ["one"],
      gateObservationDigest: null,
      reason: "launch-approved",
    });

    const initialClaimBody = {
      kind: "independent-research-trial-claim" as const,
      schemaVersion: 2 as const,
      approvalId: approval.approvalId,
      approvalDigest: approval.digest,
      trialId: "one",
      campaignId: "campaign-one",
      campaignInputDigest: canonicalDigest(campaignInput("one")),
      accountReadinessDigest: readiness().digest,
      trialReadinessDigest: digest("8"),
      gateObservationDigest: null,
      reservedNativeRuns: 2,
      reservedWallTimeMs: 3_600_000,
      claimedAt: "2026-09-18T08:04:30.000Z",
    };
    const initialClaim: IndependentResearchTrialClaim = {
      ...initialClaimBody,
      digest: canonicalDigest(initialClaimBody),
    };
    const gateObservation = defineIndependentResearchTrialGateObservation({
      approvalId: approval.approvalId,
      approvalDigest: approval.digest,
      initialTrialId: "one",
      campaignId: "campaign-one",
      campaignInputDigest: canonicalDigest(campaignInput("one")),
      state: "model-completed-with-candidates",
      candidateRecordCount: 1,
      campaignViewDigest: digest("a"),
    });

    const followUps = decideIndependentResearchTrialLaunches({
      approval,
      accountReadiness: readiness(),
      claims: [{ claim: initialClaim, active: false }],
      gateObservation,
      now: "2026-09-18T08:05:00.000Z",
    });
    expect(followUps).toMatchObject({
      selectedTrialIds: ["two", "three"],
      gateObservationDigest: gateObservation.digest,
      reason: "launch-approved",
    });
  });

  it("does not spend follow-up Trials when the initial production Trial has no Candidate", () => {
    const base = approvalDefinition();
    const approval = defineIndependentResearchTrialApproval({
      ...base,
      launchPolicy: {
        kind: "candidate-gated-followups",
        initialTrialId: "one",
      },
    });
    const claimBody = {
      kind: "independent-research-trial-claim" as const,
      schemaVersion: 2 as const,
      approvalId: approval.approvalId,
      approvalDigest: approval.digest,
      trialId: "one",
      campaignId: "campaign-one",
      campaignInputDigest: canonicalDigest(campaignInput("one")),
      accountReadinessDigest: readiness().digest,
      trialReadinessDigest: digest("8"),
      gateObservationDigest: null,
      reservedNativeRuns: 2,
      reservedWallTimeMs: 3_600_000,
      claimedAt: "2026-09-18T08:04:30.000Z",
    };
    const claim: IndependentResearchTrialClaim = {
      ...claimBody,
      digest: canonicalDigest(claimBody),
    };
    const gateObservation = defineIndependentResearchTrialGateObservation({
      approvalId: approval.approvalId,
      approvalDigest: approval.digest,
      initialTrialId: "one",
      campaignId: "campaign-one",
      campaignInputDigest: canonicalDigest(campaignInput("one")),
      state: "model-completed-without-candidates",
      candidateRecordCount: 0,
      campaignViewDigest: digest("b"),
    });

    expect(
      decideIndependentResearchTrialLaunches({
        approval,
        accountReadiness: readiness(),
        claims: [{ claim, active: false }],
        gateObservation,
        now: "2026-09-18T08:05:00.000Z",
      }),
    ).toMatchObject({
      selectedTrialIds: [],
      gateObservationDigest: gateObservation.digest,
      reason: "initial-trial-no-candidates",
    });
  });

  it.each([
    {
      name: "expired approval",
      status: "ready" as const,
      now: "2026-09-18T09:00:00.000Z",
      reason: "approval-expired",
    },
    {
      name: "stale readiness",
      status: "ready" as const,
      now: "2026-09-18T08:10:00.000Z",
      reason: "account-readiness-stale",
    },
    {
      name: "expired authentication",
      status: "unauthenticated" as const,
      now: "2026-09-18T08:05:00.000Z",
      reason: "account-unauthenticated",
    },
    {
      name: "exhausted API balance",
      status: "quota-exhausted" as const,
      now: "2026-09-18T08:05:00.000Z",
      reason: "account-quota-exhausted",
    },
    {
      name: "rate limit",
      status: "rate-limited" as const,
      now: "2026-09-18T08:05:00.000Z",
      reason: "account-rate-limited",
    },
  ])("fails closed for $name", ({ status, now, reason }) => {
    const decision = decideIndependentResearchTrialLaunches({
      approval: defineIndependentResearchTrialApproval(approvalDefinition()),
      accountReadiness: readiness(status),
      claims: [],
      now,
    });

    expect(decision).toMatchObject({
      selectedTrialIds: [],
      reason,
    });
  });

  it("rejects altered approvals", () => {
    const approval =
      defineIndependentResearchTrialApproval(approvalDefinition());
    expect(() =>
      independentResearchTrialApprovalSchema.parse({
        ...approval,
        schemaVersion: 1,
      }),
    ).toThrow();
    expect(() =>
      decideIndependentResearchTrialLaunches({
        approval: { ...approval, maxConcurrentTrials: 1 },
        accountReadiness: readiness(),
        claims: [],
        now: "2026-09-18T08:05:00.000Z",
      }),
    ).toThrow(/digest mismatch/u);
  });

  it("seals the human approval and builds only an approved fresh conduct command", async () => {
    const directory = await mkdtemp(join(tmpdir(), "trial-approval-cli-"));
    const definition = approvalDefinition();
    const definitionPath = join(directory, "definition.json");
    await writeFile(definitionPath, `${JSON.stringify(definition)}\n`, {
      mode: 0o600,
    });
    const stdout: string[] = [];
    const stderr: string[] = [];

    try {
      const exitCode = await runIndependentResearchTrialLauncherCli(
        ["seal-approval", "--definition", definitionPath],
        {
          stdout: (text) => stdout.push(text),
          stderr: (text) => stderr.push(text),
        },
      );
      const approval = defineIndependentResearchTrialApproval(definition);
      const command = buildIndependentResearchTrialCommand(
        approval,
        approval.trials[0]!,
        "/private/claims/one/approved-target-campaign-request.json",
      );

      expect(exitCode).toBe(0);
      expect(stderr).toEqual([]);
      expect(JSON.parse(stdout.join(""))).toEqual(approval);
      expect(command.slice(0, 3)).toEqual([
        "/workspace/dist/cli.js",
        "campaign",
        "conduct-approved",
      ]);
      expect(command).not.toContain("review-research");
      expect(command).not.toContain("review-candidates");
      expect(command).not.toContain("inspect");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("atomically caps concurrent workers by aggregate allowance", async () => {
    const directory = await mkdtemp(join(tmpdir(), "independent-trials-"));
    const base = approvalDefinition();
    const approval = defineIndependentResearchTrialApproval({
      ...base,
      runtime: {
        ...base.runtime,
        nodeExecutablePath: "/bin/true",
      },
      aggregateAllowance: {
        maxNativeRuns: 4,
        maxWallTimeMs: 7_200_000,
      },
      trials: base.trials.map((trial) => ({
        ...trial,
        databasePath: join(directory, "database", `${trial.trialId}.sqlite`),
        scratchDirectory: join(directory, "scratch", trial.trialId),
        logPath: join(directory, "logs", `${trial.trialId}.log`),
      })),
    });
    const accountReadiness = readiness();
    const receiptRoot = join(directory, "receipts");
    const inspectTrial = async (trial: (typeof approval.trials)[number]) => {
      const input = campaignInputForIndependentResearchTrial(trial);
      return defineIndependentResearchTrialReadiness({
        approvalId: approval.approvalId,
        approvalDigest: approval.digest,
        trialId: trial.trialId,
        campaignId: input.campaignId,
        campaignInputDigest: canonicalDigest(input),
        checkedAt: "2026-09-18T08:04:30.000Z",
        status: "ready",
        reason: "preflight-ready",
      });
    };
    const options = {
      approval,
      accountReadiness,
      receiptRoot,
      workingDirectory: directory,
      now: "2026-09-18T08:05:00.000Z",
      dryRun: false,
      inspectTrial,
    } as const;

    try {
      const [first, concurrent] = await Promise.all([
        dispatchIndependentResearchTrials(options),
        dispatchIndependentResearchTrials(options),
      ]);
      const view = await inspectIndependentResearchTrialClaims(receiptRoot);

      expect(first.launched.length + concurrent.launched.length).toBe(2);
      expect(view.claims).toHaveLength(2);
      expect(
        view.claims.reduce(
          (total, state) => total + state.claim.reservedNativeRuns,
          0,
        ),
      ).toBe(4);
      expect(
        new Set(view.claims.map((state) => state.claim.trialId)).size,
      ).toBe(2);
      expect(
        [...first.launched, ...concurrent.launched].every(
          (receipt) =>
            receipt.approvalDigest === approval.digest &&
            receipt.accountReadinessDigest === accountReadiness.digest,
        ),
      ).toBe(true);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("dispatches only the initial production Trial before a gate observation exists", async () => {
    const directory = await mkdtemp(join(tmpdir(), "staged-trials-"));
    const base = approvalDefinition();
    const approval = defineIndependentResearchTrialApproval({
      ...base,
      launchPolicy: {
        kind: "candidate-gated-followups",
        initialTrialId: "one",
      },
      runtime: {
        ...base.runtime,
        nodeExecutablePath: "/bin/true",
      },
      trials: base.trials.map((trial) => ({
        ...trial,
        databasePath: join(directory, "database", `${trial.trialId}.sqlite`),
        scratchDirectory: join(directory, "scratch", trial.trialId),
        logPath: join(directory, "logs", `${trial.trialId}.log`),
      })),
    });
    const inspectTrial = async (trial: (typeof approval.trials)[number]) => {
      const input = campaignInputForIndependentResearchTrial(trial);
      return defineIndependentResearchTrialReadiness({
        approvalId: approval.approvalId,
        approvalDigest: approval.digest,
        trialId: trial.trialId,
        campaignId: input.campaignId,
        campaignInputDigest: canonicalDigest(input),
        checkedAt: "2026-09-18T08:04:30.000Z",
        status: "ready",
        reason: "preflight-ready",
      });
    };

    try {
      const result = await dispatchIndependentResearchTrials({
        approval,
        accountReadiness: readiness(),
        receiptRoot: join(directory, "receipts"),
        workingDirectory: directory,
        now: "2026-09-18T08:05:00.000Z",
        dryRun: false,
        inspectTrial,
      });

      expect(result).toMatchObject({
        decision: {
          selectedTrialIds: ["one"],
          gateObservationDigest: null,
          reason: "launch-approved",
        },
        claimed: [{ trialId: "one", gateObservationDigest: null }],
        launched: [{ trialId: "one", gateObservationDigest: null }],
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("keeps an interrupted launch claimed until a new human approval", async () => {
    const directory = await mkdtemp(join(tmpdir(), "interrupted-trial-"));
    const base = approvalDefinition();
    const original = base.trials[0]!;
    const approval = defineIndependentResearchTrialApproval({
      ...base,
      maxConcurrentTrials: 1,
      aggregateAllowance: {
        maxNativeRuns: 2,
        maxWallTimeMs: 3_600_000,
      },
      runtime: {
        ...base.runtime,
        nodeExecutablePath: "/does/not/exist",
      },
      trials: [
        {
          ...original,
          databasePath: join(directory, "database", "one.sqlite"),
          scratchDirectory: join(directory, "scratch", "one"),
          logPath: join(directory, "logs", "one.log"),
        },
      ],
    });
    const inspectTrial = async (trial: (typeof approval.trials)[number]) => {
      const input = campaignInputForIndependentResearchTrial(trial);
      return defineIndependentResearchTrialReadiness({
        approvalId: approval.approvalId,
        approvalDigest: approval.digest,
        trialId: trial.trialId,
        campaignId: input.campaignId,
        campaignInputDigest: canonicalDigest(input),
        checkedAt: "2026-09-18T08:04:30.000Z",
        status: "ready",
        reason: "preflight-ready",
      });
    };
    const options = {
      approval,
      accountReadiness: readiness(),
      receiptRoot: join(directory, "receipts"),
      workingDirectory: directory,
      now: "2026-09-18T08:05:00.000Z",
      dryRun: false,
      inspectTrial,
    } as const;

    try {
      const interrupted = await dispatchIndependentResearchTrials(options);
      const repeated = await dispatchIndependentResearchTrials(options);
      const view = await inspectIndependentResearchTrialClaims(
        options.receiptRoot,
      );

      expect(interrupted).toMatchObject({
        claimed: [{ trialId: "one" }],
        launched: [],
        launchFailures: [{ trialId: "one", reason: "launch-state-unknown" }],
      });
      expect(repeated).toMatchObject({
        decision: { reason: "all-trials-claimed" },
        claimed: [],
        launched: [],
      });
      expect(view.claims).toHaveLength(1);
      expect(view.claims[0]?.active).toBe(true);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("admits only a fresh source-bound sandbox preflight", async () => {
    const directory = await mkdtemp(join(tmpdir(), "trial-readiness-"));
    const targetDirectory = join(directory, "target");
    const wordpressDirectory = join(directory, "wordpress");
    const providerDirectory = join(directory, "provider");
    const promptPath = join(directory, "research.md");
    const prompt = await readFile(
      join(process.cwd(), "prompts", "wordpress-plugin-research-v8.md"),
      "utf8",
    );
    const targetContents = "<?php // target\n";
    await Promise.all([
      mkdir(targetDirectory),
      mkdir(wordpressDirectory),
      mkdir(providerDirectory),
    ]);
    await Promise.all([
      writeFile(join(targetDirectory, "plugin.php"), targetContents),
      writeFile(join(wordpressDirectory, "version.php"), "<?php // core\n"),
      writeFile(promptPath, prompt),
      writeFile(
        join(providerDirectory, "deepseek-api-key"),
        "sk-private-preflight-key\n",
        { mode: 0o600 },
      ),
    ]);
    await chmod(join(providerDirectory, "deepseek-api-key"), 0o600);
    const [sourceTree, dependencyTree] = await Promise.all([
      measureCanonicalSourceTree(targetDirectory, {
        maxEntries: 10,
        maxBytes: 1024,
      }),
      measureCanonicalSourceTree(wordpressDirectory, {
        maxEntries: 10,
        maxBytes: 1024,
      }),
    ]);
    const base = approvalDefinition();
    const baseTrial = base.trials[0]!;
    const targetManifest = {
      kind: "canonical-file-manifest" as const,
      schemaVersion: 1 as const,
      entries: [
        {
          path: "plugin.php",
          digest: `sha256:${createHash("sha256")
            .update(targetContents)
            .digest("hex")}`,
          size: Buffer.byteLength(targetContents),
        },
      ],
    };
    expect(canonicalDigest(targetManifest)).toBe(sourceTree.digest);
    const approval = defineIndependentResearchTrialApproval({
      ...base,
      trials: [
        {
          ...baseTrial,
          trialId: "preflight",
          approvedTargetCampaignRequest: approvedTargetCampaignRequest(
            "preflight",
            {
              targetManifest,
              dependencySourceTree: dependencyTree,
              promptDigest: promptTextDigest(prompt),
            },
          ),
          targetSourceDirectory: targetDirectory,
          dependencySources: [
            { mountName: "wordpress", directory: wordpressDirectory },
          ],
          databasePath: join(directory, "database", "campaign.sqlite"),
          scratchDirectory: join(directory, "scratch", "preflight"),
          logPath: join(directory, "logs", "preflight.log"),
          providerConfigDirectory: providerDirectory,
          researchPromptPath: promptPath,
        },
      ],
    });
    const processCalls: string[][] = [];
    const runProcess = async (options: {
      readonly args: readonly string[];
    }) => {
      processCalls.push([...options.args]);
      if (options.args[0] === "version") {
        return {
          kind: "exited" as const,
          exitCode: 0,
          stdout: "27.0.0\n",
          stderr: "",
        };
      }
      if (options.args[0] === "info") {
        return {
          kind: "exited" as const,
          exitCode: 0,
          stdout: JSON.stringify({ runc: {}, runsc: {} }),
          stderr: "",
        };
      }
      if (options.args[0] === "image") {
        return {
          kind: "exited" as const,
          exitCode: 0,
          stdout: JSON.stringify({
            Id: deepSeekHarnessNativeTransport.sandboxImageDigest,
            RepoDigests: [
              `research@${deepSeekHarnessNativeTransport.sandboxImageDigest}`,
            ],
          }),
          stderr: "",
        };
      }
      return {
        kind: "exited" as const,
        exitCode: 0,
        stdout: "0.1.6-alpha.2\n",
        stderr: "",
      };
    };

    try {
      const ready = await inspectIndependentResearchTrialReadiness({
        approval,
        trial: approval.trials[0]!,
        clock: () => new Date("2026-09-18T08:04:30.000Z"),
        runProcess,
      });
      await writeFile(promptPath, "changed after human approval\n");
      const changed = await inspectIndependentResearchTrialReadiness({
        approval,
        trial: approval.trials[0]!,
        clock: () => new Date("2026-09-18T08:04:40.000Z"),
        runProcess,
      });

      expect(ready).toMatchObject({
        status: "ready",
        reason: "preflight-ready",
        digest: expect.stringMatching(/^sha256:/u),
      });
      expect(changed).toMatchObject({
        status: "blocked",
        reason: "prompt-mismatch",
      });
      const providerProbe = processCalls.find((args) => args[0] === "run");
      expect(providerProbe).toEqual(
        expect.arrayContaining([
          "--runtime=runsc",
          "--network=none",
          "--read-only",
          "--entrypoint=dsh",
          "--version",
        ]),
      );
      expect(providerProbe).not.toContain(targetDirectory);
      expect(providerProbe).not.toContain(providerDirectory);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
