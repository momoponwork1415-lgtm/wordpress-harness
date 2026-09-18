import { spawn } from "node:child_process";
import {
  mkdir,
  open,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import { z } from "zod";

import { canonicalDigest } from "../infrastructure/canonical-json.js";
import {
  deepSeekAccountReadinessObservationSchema,
  type DeepSeekAccountReadinessObservation,
} from "./deepseek-account-readiness.js";
import {
  campaignInputForIndependentResearchTrial,
  decideIndependentResearchTrialLaunches,
  independentResearchTrialApprovalSchema,
  independentResearchTrialClaimSchema,
  independentResearchTrialReadinessSchema,
  type IndependentResearchTrialApproval,
  type IndependentResearchTrialClaim,
  type IndependentResearchTrialClaimState,
  type IndependentResearchTrialLaunchDecision,
  type IndependentResearchTrialPlan,
  type IndependentResearchTrialReadiness,
} from "./independent-research-trial-launcher.js";
import { inspectIndependentResearchTrialReadiness } from "./independent-research-trial-readiness.js";

const digestSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/u);

const independentResearchTrialLaunchReceiptBodySchema = z.strictObject({
  kind: z.literal("independent-research-trial-launch-receipt"),
  schemaVersion: z.literal(1),
  approvalId: z.string().min(1),
  approvalDigest: digestSchema,
  trialId: z.string().min(1),
  campaignId: z.string().min(1),
  campaignInputDigest: digestSchema,
  claimDigest: digestSchema,
  accountReadinessDigest: digestSchema,
  trialReadinessDigest: digestSchema,
  launchedAt: z.iso.datetime(),
  pid: z.number().int().positive(),
  logPath: z.string().min(1),
});

export const independentResearchTrialLaunchReceiptSchema =
  independentResearchTrialLaunchReceiptBodySchema
    .extend({ digest: digestSchema })
    .superRefine((receipt, context) => {
      const { digest, ...body } = receipt;
      if (digest !== canonicalDigest(body)) {
        context.addIssue({
          code: "custom",
          path: ["digest"],
          message: "Independent Trial launch receipt digest mismatch",
        });
      }
    });

export type IndependentResearchTrialLaunchReceipt = z.infer<
  typeof independentResearchTrialLaunchReceiptSchema
>;

export interface IndependentResearchTrialClaimView {
  readonly claims: readonly IndependentResearchTrialClaimState[];
  readonly launchReceipts: readonly IndependentResearchTrialLaunchReceipt[];
}

function processIsActive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error: unknown) {
    if (error instanceof Error && "code" in error && error.code === "ESRCH") {
      return false;
    }
    return true;
  }
}

function missingFile(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

export async function inspectIndependentResearchTrialClaims(
  receiptRoot: string,
): Promise<IndependentResearchTrialClaimView> {
  const claimRoot = join(resolve(receiptRoot), "claims");
  let entries;
  try {
    entries = await readdir(claimRoot, { withFileTypes: true });
  } catch (error: unknown) {
    if (missingFile(error)) return { claims: [], launchReceipts: [] };
    throw error;
  }
  const claims: IndependentResearchTrialClaimState[] = [];
  const launchReceipts: IndependentResearchTrialLaunchReceipt[] = [];
  for (const entry of entries.sort((left, right) =>
    left.name.localeCompare(right.name),
  )) {
    if (!entry.isDirectory()) continue;
    const directory = join(claimRoot, entry.name);
    const claimValue: unknown = JSON.parse(
      await readFile(join(directory, "claim.json"), "utf8"),
    );
    const claim = independentResearchTrialClaimSchema.parse(claimValue);
    if (claim.trialId !== entry.name) {
      throw new Error("Independent Trial claim directory mismatch");
    }
    let receipt: IndependentResearchTrialLaunchReceipt | undefined;
    try {
      const receiptValue: unknown = JSON.parse(
        await readFile(join(directory, "launch.json"), "utf8"),
      );
      receipt = independentResearchTrialLaunchReceiptSchema.parse(receiptValue);
      if (
        receipt.trialId !== claim.trialId ||
        receipt.claimDigest !== claim.digest ||
        receipt.approvalDigest !== claim.approvalDigest ||
        receipt.campaignInputDigest !== claim.campaignInputDigest ||
        receipt.accountReadinessDigest !== claim.accountReadinessDigest ||
        receipt.trialReadinessDigest !== claim.trialReadinessDigest
      ) {
        throw new Error("Independent Trial launch receipt binding mismatch");
      }
      launchReceipts.push(receipt);
    } catch (error: unknown) {
      if (!missingFile(error)) throw error;
    }
    claims.push({
      claim,
      active: receipt === undefined || processIsActive(receipt.pid),
    });
  }
  return { claims, launchReceipts };
}

export function buildIndependentResearchTrialCommand(
  approval: IndependentResearchTrialApproval,
  trial: IndependentResearchTrialPlan,
  inputPath: string,
): readonly string[] {
  const args = [
    approval.runtime.harnessCliPath,
    "campaign",
    "conduct-approved",
    "--database",
    trial.databasePath,
    "--input",
    inputPath,
    "--docker",
    approval.runtime.dockerExecutablePath,
    "--image",
    trial.image,
    "--source",
    trial.targetSourceDirectory,
    "--provider-config",
    trial.providerConfigDirectory,
    "--scratch",
    trial.scratchDirectory,
    "--research-prompt",
    trial.researchPromptPath,
  ];
  for (const dependency of trial.dependencySources) {
    args.push(
      "--dependency-source",
      `${dependency.mountName}=${dependency.directory}`,
    );
  }
  return args;
}

function readinessMatches(
  approval: IndependentResearchTrialApproval,
  trial: IndependentResearchTrialPlan,
  readiness: IndependentResearchTrialReadiness,
  now: string,
): boolean {
  const ageMs = Date.parse(now) - Date.parse(readiness.checkedAt);
  const campaignInput = campaignInputForIndependentResearchTrial(trial);
  return (
    readiness.approvalId === approval.approvalId &&
    readiness.approvalDigest === approval.digest &&
    readiness.trialId === trial.trialId &&
    readiness.campaignId === campaignInput.campaignId &&
    readiness.campaignInputDigest === canonicalDigest(campaignInput) &&
    readiness.status === "ready" &&
    ageMs >= 0 &&
    ageMs <= approval.maxReadinessAgeSeconds * 1_000
  );
}

function claimFor(input: {
  readonly approval: IndependentResearchTrialApproval;
  readonly trial: IndependentResearchTrialPlan;
  readonly accountReadiness: DeepSeekAccountReadinessObservation;
  readonly trialReadiness: IndependentResearchTrialReadiness;
  readonly claimedAt: string;
}): IndependentResearchTrialClaim {
  const campaignInput = campaignInputForIndependentResearchTrial(input.trial);
  const body = {
    kind: "independent-research-trial-claim" as const,
    schemaVersion: 1 as const,
    approvalId: input.approval.approvalId,
    approvalDigest: input.approval.digest,
    trialId: input.trial.trialId,
    campaignId: campaignInput.campaignId,
    campaignInputDigest: canonicalDigest(campaignInput),
    accountReadinessDigest: input.accountReadiness.digest,
    trialReadinessDigest: input.trialReadiness.digest,
    reservedNativeRuns: campaignInput.budgetEnvelope.maxNativeRuns,
    reservedWallTimeMs: campaignInput.budgetEnvelope.maxWallTimeMs,
    claimedAt: input.claimedAt,
  };
  return independentResearchTrialClaimSchema.parse({
    ...body,
    digest: canonicalDigest(body),
  });
}

async function acquireDispatchLock(receiptRoot: string): Promise<boolean> {
  try {
    await mkdir(join(receiptRoot, ".dispatch-lock"), { mode: 0o700 });
    return true;
  } catch (error: unknown) {
    if (error instanceof Error && "code" in error && error.code === "EEXIST") {
      return false;
    }
    throw error;
  }
}

async function persistClaim(input: {
  readonly receiptRoot: string;
  readonly trial: IndependentResearchTrialPlan;
  readonly claim: IndependentResearchTrialClaim;
}): Promise<{ readonly claimDirectory: string; readonly inputPath: string }> {
  const claimDirectory = join(input.receiptRoot, "claims", input.trial.trialId);
  await mkdir(claimDirectory, { mode: 0o700 });
  const inputPath = join(
    claimDirectory,
    "approved-target-campaign-request.json",
  );
  await writeFile(
    join(claimDirectory, "claim.json"),
    `${JSON.stringify(input.claim)}\n`,
    { flag: "wx", mode: 0o600 },
  );
  await writeFile(
    inputPath,
    `${JSON.stringify(input.trial.approvedTargetCampaignRequest)}\n`,
    { flag: "wx", mode: 0o600 },
  );
  await mkdir(dirname(input.trial.databasePath), {
    recursive: true,
    mode: 0o700,
  });
  const database = await open(input.trial.databasePath, "wx", 0o600);
  await database.close();
  await mkdir(dirname(input.trial.scratchDirectory), {
    recursive: true,
    mode: 0o700,
  });
  await mkdir(input.trial.scratchDirectory, { mode: 0o700 });
  await mkdir(dirname(input.trial.logPath), { recursive: true, mode: 0o700 });
  const log = await open(input.trial.logPath, "wx", 0o600);
  await log.close();
  return { claimDirectory, inputPath };
}

async function launchClaim(input: {
  readonly approval: IndependentResearchTrialApproval;
  readonly trial: IndependentResearchTrialPlan;
  readonly claim: IndependentResearchTrialClaim;
  readonly trialReadiness: IndependentResearchTrialReadiness;
  readonly claimDirectory: string;
  readonly inputPath: string;
  readonly workingDirectory: string;
  readonly launchedAt: string;
}): Promise<IndependentResearchTrialLaunchReceipt> {
  const campaignInput = campaignInputForIndependentResearchTrial(input.trial);
  const log = await open(input.trial.logPath, "a", 0o600);
  try {
    const child = spawn(
      input.approval.runtime.nodeExecutablePath,
      buildIndependentResearchTrialCommand(
        input.approval,
        input.trial,
        input.inputPath,
      ),
      {
        cwd: input.workingDirectory,
        detached: true,
        env: process.env,
        stdio: ["ignore", log.fd, log.fd],
      },
    );
    await new Promise<void>((resolvePromise, reject) => {
      child.once("spawn", resolvePromise);
      child.once("error", reject);
    });
    if (child.pid === undefined) {
      throw new Error("Independent Trial started without a process id");
    }
    child.unref();
    const body = independentResearchTrialLaunchReceiptBodySchema.parse({
      kind: "independent-research-trial-launch-receipt",
      schemaVersion: 1,
      approvalId: input.approval.approvalId,
      approvalDigest: input.approval.digest,
      trialId: input.trial.trialId,
      campaignId: campaignInput.campaignId,
      campaignInputDigest: canonicalDigest(campaignInput),
      claimDigest: input.claim.digest,
      accountReadinessDigest: input.claim.accountReadinessDigest,
      trialReadinessDigest: input.trialReadiness.digest,
      launchedAt: input.launchedAt,
      pid: child.pid,
      logPath: input.trial.logPath,
    });
    const receipt = independentResearchTrialLaunchReceiptSchema.parse({
      ...body,
      digest: canonicalDigest(body),
    });
    await writeFile(
      join(input.claimDirectory, "launch.json"),
      `${JSON.stringify(receipt)}\n`,
      { flag: "wx", mode: 0o600 },
    );
    return receipt;
  } finally {
    await log.close();
  }
}

export interface IndependentResearchTrialDispatchResult {
  readonly decision: IndependentResearchTrialLaunchDecision;
  readonly readiness: readonly IndependentResearchTrialReadiness[];
  readonly claimed: readonly IndependentResearchTrialClaim[];
  readonly launched: readonly IndependentResearchTrialLaunchReceipt[];
  readonly launchFailures: readonly Readonly<{
    trialId: string;
    reason: "launch-state-unknown";
  }>[];
}

export async function dispatchIndependentResearchTrials(options: {
  readonly approval: IndependentResearchTrialApproval;
  readonly accountReadiness: DeepSeekAccountReadinessObservation | undefined;
  readonly receiptRoot: string;
  readonly workingDirectory: string;
  readonly now?: string;
  readonly dryRun: boolean;
  readonly inspectTrial?: (
    trial: IndependentResearchTrialPlan,
  ) => Promise<IndependentResearchTrialReadiness>;
}): Promise<IndependentResearchTrialDispatchResult> {
  const approval = independentResearchTrialApprovalSchema.parse(
    options.approval,
  );
  const receiptRoot = resolve(options.receiptRoot);
  const accountReadiness =
    options.accountReadiness === undefined
      ? undefined
      : deepSeekAccountReadinessObservationSchema.parse(
          options.accountReadiness,
        );
  const before = await inspectIndependentResearchTrialClaims(receiptRoot);
  const claimedBefore = new Set(
    before.claims.map((state) => state.claim.trialId),
  );
  const readiness = await Promise.all(
    approval.trials
      .filter((trial) => !claimedBefore.has(trial.trialId))
      .map(async (trial) => {
        const inspected =
          options.inspectTrial === undefined
            ? await inspectIndependentResearchTrialReadiness({
                approval,
                trial,
              })
            : await options.inspectTrial(trial);
        return independentResearchTrialReadinessSchema.parse(inspected);
      }),
  );
  const readinessByTrial = new Map(
    readiness.map((item) => [item.trialId, item]),
  );
  const decisionNow = options.now ?? new Date().toISOString();
  const unlaunchableTrialIds = new Set(
    approval.trials
      .filter((trial) => {
        if (claimedBefore.has(trial.trialId)) return false;
        const item = readinessByTrial.get(trial.trialId);
        return (
          item === undefined ||
          !readinessMatches(approval, trial, item, decisionNow)
        );
      })
      .map((trial) => trial.trialId),
  );
  const preliminaryDecision = decideIndependentResearchTrialLaunches({
    approval,
    accountReadiness,
    claims: before.claims,
    unlaunchableTrialIds,
    now: decisionNow,
  });
  if (options.dryRun || preliminaryDecision.selectedTrialIds.length === 0) {
    return {
      decision: preliminaryDecision,
      readiness,
      claimed: [],
      launched: [],
      launchFailures: [],
    };
  }
  await mkdir(join(receiptRoot, "claims"), { recursive: true, mode: 0o700 });
  if (!(await acquireDispatchLock(receiptRoot))) {
    return {
      decision: {
        ...preliminaryDecision,
        selectedTrialIds: [],
        reason: "dispatch-lock-unavailable",
      },
      readiness,
      claimed: [],
      launched: [],
      launchFailures: [],
    };
  }

  const reserved: Array<{
    trial: IndependentResearchTrialPlan;
    claim: IndependentResearchTrialClaim;
    trialReadiness: IndependentResearchTrialReadiness;
    claimDirectory: string;
    inputPath: string;
  }> = [];
  let decision: IndependentResearchTrialLaunchDecision;
  try {
    const current = await inspectIndependentResearchTrialClaims(receiptRoot);
    decision = decideIndependentResearchTrialLaunches({
      approval,
      accountReadiness,
      claims: current.claims,
      unlaunchableTrialIds,
      now: decisionNow,
    });
    if (
      accountReadiness !== undefined &&
      decision.selectedTrialIds.length > 0
    ) {
      const trialsById = new Map(
        approval.trials.map((trial) => [trial.trialId, trial]),
      );
      for (const trialId of decision.selectedTrialIds) {
        const trial = trialsById.get(trialId);
        const trialReadiness = readinessByTrial.get(trialId);
        if (trial === undefined || trialReadiness === undefined) {
          throw new Error("Selected Independent Trial is unavailable");
        }
        const claim = claimFor({
          approval,
          trial,
          accountReadiness,
          trialReadiness,
          claimedAt: decisionNow,
        });
        const persisted = await persistClaim({
          receiptRoot,
          trial,
          claim,
        });
        reserved.push({
          trial,
          claim,
          trialReadiness,
          ...persisted,
        });
      }
    }
  } finally {
    await rm(join(receiptRoot, ".dispatch-lock"), {
      recursive: true,
      force: true,
    });
  }

  const launched: IndependentResearchTrialLaunchReceipt[] = [];
  const launchFailures: Array<{
    trialId: string;
    reason: "launch-state-unknown";
  }> = [];
  for (const item of reserved) {
    try {
      launched.push(
        await launchClaim({
          approval,
          ...item,
          workingDirectory: resolve(options.workingDirectory),
          launchedAt: decisionNow,
        }),
      );
    } catch {
      launchFailures.push({
        trialId: item.trial.trialId,
        reason: "launch-state-unknown",
      });
    }
  }
  return {
    decision,
    readiness,
    claimed: reserved.map((item) => item.claim),
    launched,
    launchFailures,
  };
}
