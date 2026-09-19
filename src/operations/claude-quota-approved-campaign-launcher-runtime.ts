import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import { z } from "zod";

import { canonicalDigest } from "../infrastructure/canonical-json.js";
import {
  approvedCampaignLaunchManifestSchema,
  claudeAccountReadinessObservationSchema,
  claudeRateLimitObservationSchema,
  decideApprovedCampaignLaunches,
  type ApprovedCampaignLaunchDecision,
  type ApprovedCampaignLaunchManifest,
  type ApprovedCampaignLaunchPlan,
  type ClaudeAccountReadinessObservation,
  type ClaudeRateLimitObservation,
} from "./claude-quota-approved-campaign-launcher.js";

const launchReceiptSchema = z
  .object({
    kind: z.literal("approved-campaign-launch-receipt"),
    schemaVersion: z.literal(2),
    planId: z.string().min(1),
    campaignId: z.string().min(1),
    launchedAt: z.iso.datetime(),
    pid: z.number().int().positive(),
    logPath: z.string().min(1),
    accountReadinessObservationDigest: z
      .string()
      .regex(/^sha256:[a-f0-9]{64}$/),
    quotaObservationDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
    estimatedFiveHourPercentage: z.number().positive().max(100),
    estimatedSevenDayPercentage: z.number().positive().max(100),
  })
  .strict();

type LaunchReceipt = z.infer<typeof launchReceiptSchema>;

export interface LaunchReceiptView {
  readonly claimedPlanIds: ReadonlySet<string>;
  readonly activePlanIds: ReadonlySet<string>;
  readonly quotaReservations: readonly Readonly<{
    observationDigest: string;
    estimatedFiveHourPercentage: number;
    estimatedSevenDayPercentage: number;
  }>[];
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

export async function inspectLaunchReceipts(
  receiptRoot: string,
): Promise<LaunchReceiptView> {
  const claimedPlanIds = new Set<string>();
  const activePlanIds = new Set<string>();
  const quotaReservations: Array<{
    observationDigest: string;
    estimatedFiveHourPercentage: number;
    estimatedSevenDayPercentage: number;
  }> = [];
  let entries;
  try {
    entries = await readdir(receiptRoot, { withFileTypes: true });
  } catch (error: unknown) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return { claimedPlanIds, activePlanIds, quotaReservations };
    }
    throw error;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    claimedPlanIds.add(entry.name);
    try {
      const receiptValue: unknown = JSON.parse(
        await readFile(join(receiptRoot, entry.name, "receipt.json"), "utf8"),
      );
      const receipt = launchReceiptSchema.parse(receiptValue);
      quotaReservations.push({
        observationDigest: receipt.quotaObservationDigest,
        estimatedFiveHourPercentage: receipt.estimatedFiveHourPercentage,
        estimatedSevenDayPercentage: receipt.estimatedSevenDayPercentage,
      });
      if (receipt.planId !== entry.name || processIsActive(receipt.pid)) {
        activePlanIds.add(entry.name);
      }
    } catch {
      // A claim without a valid receipt is an interrupted launch. Treat it as
      // active so a later dispatch cannot duplicate a process whose state is unknown.
      activePlanIds.add(entry.name);
    }
  }
  return { claimedPlanIds, activePlanIds, quotaReservations };
}

export async function writeRateLimitObservation(
  path: string,
  observation: ClaudeRateLimitObservation,
): Promise<void> {
  const parsed = claudeRateLimitObservationSchema.parse(observation);
  await writePrivateObservation(path, parsed);
}

async function writePrivateObservation(
  path: string,
  observation: ClaudeAccountReadinessObservation | ClaudeRateLimitObservation,
): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporaryPath, `${JSON.stringify(observation)}\n`, {
      flag: "wx",
      mode: 0o600,
    });
    await rename(temporaryPath, path);
  } finally {
    await rm(temporaryPath, { force: true });
  }
}

export async function writeAccountReadinessObservation(
  path: string,
  observation: ClaudeAccountReadinessObservation,
): Promise<void> {
  const parsed = claudeAccountReadinessObservationSchema.parse(observation);
  await writePrivateObservation(path, parsed);
}

export async function readRateLimitObservation(
  path: string,
): Promise<ClaudeRateLimitObservation | undefined> {
  try {
    const value: unknown = JSON.parse(await readFile(path, "utf8"));
    return claudeRateLimitObservationSchema.parse(value);
  } catch (error: unknown) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}

export async function readAccountReadinessObservation(
  path: string,
): Promise<ClaudeAccountReadinessObservation | undefined> {
  try {
    const value: unknown = JSON.parse(await readFile(path, "utf8"));
    return claudeAccountReadinessObservationSchema.parse(value);
  } catch (error: unknown) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}

export function buildApprovedCampaignCommand(
  manifest: ApprovedCampaignLaunchManifest,
  plan: ApprovedCampaignLaunchPlan,
): readonly string[] {
  const args = [
    manifest.runtime.harnessCliPath,
    "campaign",
    "conduct-approved",
    "--database",
    plan.databasePath,
    "--input",
    plan.requestPath,
    "--docker",
    manifest.runtime.dockerExecutablePath,
    "--image",
    plan.image,
    "--source",
    plan.targetSourceDirectory,
    "--provider-config",
    plan.providerConfigDirectory,
    "--scratch",
    plan.scratchDirectory,
    "--research-prompt",
    plan.researchPromptPath,
  ];
  for (const dependency of plan.dependencySources) {
    args.push(
      "--dependency-source",
      `${dependency.mountName}=${dependency.directory}`,
    );
  }
  return args;
}

async function claimAndLaunch(
  manifest: ApprovedCampaignLaunchManifest,
  plan: ApprovedCampaignLaunchPlan,
  receiptRoot: string,
  workingDirectory: string,
  launchedAt: string,
  accountReadinessObservationDigest: string,
  quotaObservationDigest: string,
): Promise<LaunchReceipt | undefined> {
  await mkdir(dirname(plan.databasePath), { recursive: true, mode: 0o700 });
  await mkdir(dirname(plan.scratchDirectory), {
    recursive: true,
    mode: 0o700,
  });
  await mkdir(dirname(plan.logPath), { recursive: true, mode: 0o700 });

  const claimDirectory = join(receiptRoot, plan.id);
  try {
    await mkdir(claimDirectory, { mode: 0o700 });
  } catch (error: unknown) {
    if (error instanceof Error && "code" in error && error.code === "EEXIST") {
      return undefined;
    }
    throw error;
  }
  let processStarted = false;
  try {
    await mkdir(plan.scratchDirectory, { recursive: true, mode: 0o700 });
    const log = await open(plan.logPath, "a", 0o600);
    try {
      const child = spawn(
        manifest.runtime.nodeExecutablePath,
        buildApprovedCampaignCommand(manifest, plan),
        {
          cwd: workingDirectory,
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
        throw new Error(`Campaign ${plan.campaignId} started without a pid`);
      }
      processStarted = true;
      child.unref();
      const receipt = launchReceiptSchema.parse({
        kind: "approved-campaign-launch-receipt",
        schemaVersion: 2,
        planId: plan.id,
        campaignId: plan.campaignId,
        launchedAt,
        pid: child.pid,
        logPath: plan.logPath,
        accountReadinessObservationDigest,
        quotaObservationDigest,
        estimatedFiveHourPercentage:
          manifest.policy.estimatedFiveHourPercentagePerLaunch,
        estimatedSevenDayPercentage:
          manifest.policy.estimatedSevenDayPercentagePerLaunch,
      });
      await writeFile(
        join(claimDirectory, "receipt.json"),
        `${JSON.stringify(receipt)}\n`,
        { flag: "wx", mode: 0o600 },
      );
      return receipt;
    } finally {
      await log.close();
    }
  } catch (error: unknown) {
    if (!processStarted) {
      await rm(claimDirectory, { recursive: true, force: true });
    }
    throw error;
  }
}

export interface ApprovedCampaignDispatchResult {
  readonly decision: ApprovedCampaignLaunchDecision;
  readonly launched: readonly LaunchReceipt[];
}

export async function dispatchApprovedCampaignLaunches(options: {
  readonly manifest: ApprovedCampaignLaunchManifest;
  readonly readiness: ClaudeAccountReadinessObservation | undefined;
  readonly observation: ClaudeRateLimitObservation | undefined;
  readonly receiptRoot: string;
  readonly workingDirectory: string;
  readonly now: string;
  readonly dryRun: boolean;
}): Promise<ApprovedCampaignDispatchResult> {
  const manifest = approvedCampaignLaunchManifestSchema.parse(options.manifest);
  const readiness =
    options.readiness === undefined
      ? undefined
      : claudeAccountReadinessObservationSchema.parse(options.readiness);
  const observation =
    options.observation === undefined
      ? undefined
      : claudeRateLimitObservationSchema.parse(options.observation);
  const view = await inspectLaunchReceipts(options.receiptRoot);
  const readinessDigest =
    readiness === undefined ? undefined : canonicalDigest(readiness);
  const observationDigest =
    observation === undefined ? undefined : canonicalDigest(observation);
  const reservedFiveHourPercentage = view.quotaReservations
    .filter(
      (reservation) => reservation.observationDigest === observationDigest,
    )
    .reduce(
      (total, reservation) => total + reservation.estimatedFiveHourPercentage,
      0,
    );
  const reservedSevenDayPercentage = view.quotaReservations
    .filter(
      (reservation) => reservation.observationDigest === observationDigest,
    )
    .reduce(
      (total, reservation) => total + reservation.estimatedSevenDayPercentage,
      0,
    );
  const decision = decideApprovedCampaignLaunches({
    manifest,
    readiness,
    observation,
    claimedPlanIds: view.claimedPlanIds,
    activePlanIds: view.activePlanIds,
    reservedFiveHourPercentage,
    reservedSevenDayPercentage,
    now: options.now,
  });
  if (options.dryRun) return { decision, launched: [] };
  const plansById = new Map(manifest.plans.map((plan) => [plan.id, plan]));
  const launched: LaunchReceipt[] = [];
  if (
    (readinessDigest === undefined || observationDigest === undefined) &&
    decision.selectedPlanIds.length > 0
  ) {
    throw new Error(
      "A launch decision requires account readiness and quota observation bindings",
    );
  }
  if (decision.selectedPlanIds.length > 0) {
    await mkdir(options.receiptRoot, { recursive: true, mode: 0o700 });
  }
  for (const planId of decision.selectedPlanIds) {
    const plan = plansById.get(planId);
    if (plan === undefined) throw new Error(`Unknown launch plan: ${planId}`);
    const receipt = await claimAndLaunch(
      manifest,
      plan,
      resolve(options.receiptRoot),
      options.workingDirectory,
      options.now,
      readinessDigest!,
      observationDigest!,
    );
    if (receipt !== undefined) launched.push(receipt);
  }
  return { decision, launched };
}
