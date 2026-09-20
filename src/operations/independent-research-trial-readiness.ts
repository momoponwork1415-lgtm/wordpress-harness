import { constants } from "node:fs";
import { lstat, open, type FileHandle } from "node:fs/promises";
import { join } from "node:path";

import { canonicalDigest } from "../infrastructure/canonical-json.js";
import { verifyCanonicalSourceTree } from "../infrastructure/canonical-source-tree.js";
import {
  runNativeModelProcess,
  type NativeModelProcessResult,
  type NativeModelProcessRunOptions,
} from "../infrastructure/native-model-process.js";
import { openGvisorRuntimePreflight } from "../infrastructure/gvisor-runtime-preflight.js";
import { promptTextDigest } from "../infrastructure/prompt-text.js";
import { readPrivateProviderCredential } from "../infrastructure/provider-private-credential.js";
import {
  campaignInputForIndependentResearchTrial,
  defineIndependentResearchTrialReadiness,
  independentResearchTrialApprovalSchema,
  independentResearchTrialPlanSchema,
  type IndependentResearchTrialApproval,
  type IndependentResearchTrialPlan,
  type IndependentResearchTrialReadiness,
} from "./independent-research-trial-launcher.js";

type ProcessRunner = (
  options: NativeModelProcessRunOptions,
) => Promise<NativeModelProcessResult>;

function result(
  approval: IndependentResearchTrialApproval,
  trial: IndependentResearchTrialPlan,
  checkedAt: string,
  status: IndependentResearchTrialReadiness["status"],
  reason: string,
): IndependentResearchTrialReadiness {
  const campaignInput = campaignInputForIndependentResearchTrial(trial);
  return defineIndependentResearchTrialReadiness({
    approvalId: approval.approvalId,
    approvalDigest: approval.digest,
    trialId: trial.trialId,
    campaignId: campaignInput.campaignId,
    campaignInputDigest: canonicalDigest(campaignInput),
    checkedAt,
    status,
    reason,
  });
}

function blocked(
  approval: IndependentResearchTrialApproval,
  trial: IndependentResearchTrialPlan,
  checkedAt: string,
  reason: string,
): IndependentResearchTrialReadiness {
  return result(approval, trial, checkedAt, "blocked", reason);
}

function unknown(
  approval: IndependentResearchTrialApproval,
  trial: IndependentResearchTrialPlan,
  checkedAt: string,
  reason: string,
): IndependentResearchTrialReadiness {
  return result(approval, trial, checkedAt, "unknown", reason);
}

function isFileSystemError(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}

async function stablePrompt(path: string): Promise<string | undefined> {
  let handle: FileHandle | undefined;
  try {
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const before = await handle.stat();
    if (
      !before.isFile() ||
      before.nlink !== 1 ||
      before.size <= 0 ||
      before.size > 2 * 1024 * 1024
    ) {
      return undefined;
    }
    const text = await handle.readFile("utf8");
    const after = await handle.stat();
    if (
      before.dev !== after.dev ||
      before.ino !== after.ino ||
      before.size !== after.size ||
      before.mtimeMs !== after.mtimeMs ||
      before.ctimeMs !== after.ctimeMs ||
      Buffer.byteLength(text) !== after.size
    ) {
      return undefined;
    }
    return text;
  } catch {
    return undefined;
  } finally {
    await handle?.close();
  }
}

async function pathIsFresh(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return false;
  } catch (error: unknown) {
    return isFileSystemError(error, "ENOENT");
  }
}

async function sourceFailureReason(
  trial: IndependentResearchTrialPlan,
): Promise<string | undefined> {
  const campaignInput = campaignInputForIndependentResearchTrial(trial);
  const target = await verifyCanonicalSourceTree(
    trial.targetSourceDirectory,
    campaignInput.targetSnapshot.sourceTree,
  );
  if (!target.matches) return "target-source-mismatch";
  const sources = new Map(
    trial.dependencySources.map((source) => [
      source.mountName,
      source.directory,
    ]),
  );
  for (const snapshot of campaignInput.dependencySnapshots ?? []) {
    const directory = sources.get(snapshot.mountName);
    if (
      directory === undefined ||
      !(await verifyCanonicalSourceTree(directory, snapshot.sourceTree)).matches
    ) {
      return "dependency-source-mismatch";
    }
  }
  return undefined;
}

export async function inspectIndependentResearchTrialReadiness(options: {
  readonly approval: IndependentResearchTrialApproval;
  readonly trial: IndependentResearchTrialPlan;
  readonly runProcess?: ProcessRunner;
  readonly clock?: () => Date;
}): Promise<IndependentResearchTrialReadiness> {
  const approval = independentResearchTrialApprovalSchema.parse(
    options.approval,
  );
  const trial = independentResearchTrialPlanSchema.parse(options.trial);
  const campaignInput = campaignInputForIndependentResearchTrial(trial);
  const checkedAt = (options.clock ?? (() => new Date()))().toISOString();
  const approvedTrial = approval.trials.find(
    (candidate) => candidate.trialId === trial.trialId,
  );
  if (
    approvedTrial === undefined ||
    canonicalDigest(approvedTrial) !== canonicalDigest(trial)
  ) {
    return blocked(approval, trial, checkedAt, "approval-binding-mismatch");
  }

  const sourceReason = await sourceFailureReason(trial);
  if (sourceReason !== undefined) {
    return blocked(approval, trial, checkedAt, sourceReason);
  }
  const prompt = await stablePrompt(trial.researchPromptPath);
  if (
    prompt === undefined ||
    promptTextDigest(prompt) !== campaignInput.promptSet.digest
  ) {
    return blocked(approval, trial, checkedAt, "prompt-mismatch");
  }
  const freshPaths = await Promise.all([
    pathIsFresh(trial.databasePath),
    pathIsFresh(trial.scratchDirectory),
    pathIsFresh(trial.logPath),
  ]);
  if (!freshPaths.every(Boolean)) {
    return blocked(approval, trial, checkedAt, "trial-path-not-fresh");
  }
  try {
    const providerDirectory = await lstat(trial.providerConfigDirectory);
    if (
      !providerDirectory.isDirectory() ||
      providerDirectory.isSymbolicLink()
    ) {
      throw new Error("provider config is unsafe");
    }
    await readPrivateProviderCredential(
      join(trial.providerConfigDirectory, "deepseek-api-key"),
    );
  } catch {
    return blocked(approval, trial, checkedAt, "credential-unavailable");
  }

  const runProcess = options.runProcess ?? runNativeModelProcess;
  const preflight = await openGvisorRuntimePreflight({ runProcess }).inspect({
    dockerExecutablePath: approval.runtime.dockerExecutablePath,
    workingDirectory: process.cwd(),
    image: trial.image,
    provider: {
      executable: "dsh",
      versionTokenIndex: 0,
      expectedVersion: campaignInput.agentRuntimeProfile.executableVersion,
    },
  });
  const failedCheck = preflight.checks.find(
    (check) => check.status !== "ready",
  );
  if (failedCheck !== undefined) {
    return failedCheck.status === "unknown"
      ? unknown(approval, trial, checkedAt, failedCheck.reason)
      : blocked(approval, trial, checkedAt, failedCheck.reason);
  }
  return result(approval, trial, checkedAt, "ready", "preflight-ready");
}
