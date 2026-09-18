import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
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
  decideIndependentResearchTrialLaunches,
  comparisonRequestForIndependentResearchTrialApproval,
  defineIndependentResearchTrialApproval,
  defineIndependentResearchTrialReadiness,
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
import type { CampaignInput } from "../../src/research/index.js";

const digest = (character: string) => `sha256:${character.repeat(64)}`;

function campaignInput(id: string): CampaignInput {
  return {
    kind: "agent-led-campaign",
    schemaVersion: 1,
    campaignId: `campaign-${id}`,
    targetSnapshot: {
      id: "target-pass-at-three",
      pluginSlug: "pass-at-three",
      version: "1.0.0",
      digest: digest("a"),
      sourceTree: { digest: digest("b"), entries: 2, bytes: 200 },
    },
    dependencySnapshots: [
      {
        id: "wordpress-6.9",
        mountName: "wordpress",
        version: "6.9",
        digest: digest("c"),
        sourceTree: { digest: digest("d"), entries: 3, bytes: 300 },
      },
    ],
    promptSet: { id: "research-v3", digest: digest("e") },
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
      researchGrantWallTimeMs: 3_600_000,
      digest: digest("1"),
    },
  };
}

function approvalDefinition(): IndependentResearchTrialApprovalDefinition {
  return {
    approvalId: "deepseek-pass-at-three-1",
    approvedAt: "2026-09-18T08:00:00.000Z",
    expiresAt: "2026-09-18T09:00:00.000Z",
    maxReadinessAgeSeconds: 300,
    maxConcurrentTrials: 2,
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
      campaignInput: campaignInput(id),
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
      schemaVersion: 1,
      approvalId: "deepseek-pass-at-three-1",
      trials: [
        { trialId: "one", campaignInput: { campaignId: "campaign-one" } },
        { trialId: "two", campaignInput: { campaignId: "campaign-two" } },
        { trialId: "three", campaignInput: { campaignId: "campaign-three" } },
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
      schemaVersion: 1,
      approvalId: approval.approvalId,
      approvalDigest: approval.digest,
      trialId: "one",
      campaignId: "campaign-one",
      campaignInputDigest: canonicalDigest(campaignInput("one")),
      accountReadinessDigest: readiness().digest,
      trialReadinessDigest: digest("8"),
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

  it("rejects altered approvals and resumed Campaigns", () => {
    const approval =
      defineIndependentResearchTrialApproval(approvalDefinition());
    expect(() =>
      decideIndependentResearchTrialLaunches({
        approval: { ...approval, maxConcurrentTrials: 1 },
        accountReadiness: readiness(),
        claims: [],
        now: "2026-09-18T08:05:00.000Z",
      }),
    ).toThrow(/digest mismatch/u);

    const definition = approvalDefinition();
    const input = definition.trials[0]!.campaignInput;
    input.resumeFrom = {
      kind: "agent-checkpoint",
      schemaVersion: 1,
      checkpointId: "prior-session",
      stateDigest: digest("7"),
      stateEntries: 1,
      stateBytes: 100,
      sessionId: "prior-session",
      targetSnapshotDigest: input.targetSnapshot.digest,
      promptSetDigest: input.promptSet.digest,
      runtimeProfileDigest: input.agentRuntimeProfile.digest,
      permissionProfileDigest: input.permissionProfile.digest,
      dependencySnapshotsDigest: canonicalDigest(input.dependencySnapshots),
    };
    expect(() => defineIndependentResearchTrialApproval(definition)).toThrow(
      /fresh/u,
    );
  });

  it("seals the human approval and builds only a fresh conduct command", async () => {
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
        "/private/claims/one/campaign-input.json",
      );

      expect(exitCode).toBe(0);
      expect(stderr).toEqual([]);
      expect(JSON.parse(stdout.join(""))).toEqual(approval);
      expect(command.slice(0, 3)).toEqual([
        "/workspace/dist/cli.js",
        "campaign",
        "conduct",
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
    const inspectTrial = async (trial: (typeof approval.trials)[number]) =>
      defineIndependentResearchTrialReadiness({
        approvalId: approval.approvalId,
        approvalDigest: approval.digest,
        trialId: trial.trialId,
        campaignId: trial.campaignInput.campaignId,
        campaignInputDigest: canonicalDigest(trial.campaignInput),
        checkedAt: "2026-09-18T08:04:30.000Z",
        status: "ready",
        reason: "preflight-ready",
      });
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
    const inspectTrial = async (trial: (typeof approval.trials)[number]) =>
      defineIndependentResearchTrialReadiness({
        approvalId: approval.approvalId,
        approvalDigest: approval.digest,
        trialId: trial.trialId,
        campaignId: trial.campaignInput.campaignId,
        campaignInputDigest: canonicalDigest(trial.campaignInput),
        checkedAt: "2026-09-18T08:04:30.000Z",
        status: "ready",
        reason: "preflight-ready",
      });
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
    const prompt = "Inspect broken security semantics.\n";
    await Promise.all([
      mkdir(targetDirectory),
      mkdir(wordpressDirectory),
      mkdir(providerDirectory),
    ]);
    await Promise.all([
      writeFile(join(targetDirectory, "plugin.php"), "<?php // target\n"),
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
    const input = campaignInput("preflight");
    input.targetSnapshot.sourceTree = sourceTree;
    input.dependencySnapshots![0]!.sourceTree = dependencyTree;
    input.promptSet.digest = promptTextDigest(prompt);
    const approval = defineIndependentResearchTrialApproval({
      ...base,
      trials: [
        {
          ...baseTrial,
          trialId: "preflight",
          campaignInput: input,
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
