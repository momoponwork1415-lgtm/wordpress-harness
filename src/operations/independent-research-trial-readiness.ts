import { constants } from "node:fs";
import { lstat, open, type FileHandle } from "node:fs/promises";
import { join } from "node:path";

import { z } from "zod";

import { canonicalDigest } from "../infrastructure/canonical-json.js";
import { verifyCanonicalSourceTree } from "../infrastructure/canonical-source-tree.js";
import {
  runNativeModelProcess,
  type NativeModelProcessResult,
  type NativeModelProcessRunOptions,
} from "../infrastructure/native-model-process.js";
import { promptTextDigest } from "../infrastructure/prompt-text.js";
import { readPrivateProviderCredential } from "../infrastructure/provider-private-credential.js";
import {
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
  return defineIndependentResearchTrialReadiness({
    approvalId: approval.approvalId,
    approvalDigest: approval.digest,
    trialId: trial.trialId,
    campaignId: trial.campaignInput.campaignId,
    campaignInputDigest: canonicalDigest(trial.campaignInput),
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

function processEnvironment(): NodeJS.ProcessEnv {
  return {
    PATH: process.env.PATH ?? "",
    LANG: "C",
    LC_ALL: "C",
    TZ: "UTC",
  };
}

async function runDocker(
  runProcess: ProcessRunner,
  executablePath: string,
  args: readonly string[],
): Promise<NativeModelProcessResult | undefined> {
  try {
    return await runProcess({
      executablePath,
      args,
      workingDirectory: process.cwd(),
      environment: processEnvironment(),
      timeoutMs: 10_000,
      maxOutputBytes: 64 * 1024,
    });
  } catch {
    return undefined;
  }
}

function imageDigest(image: string): string {
  const marker = image.lastIndexOf("sha256:");
  return marker === -1 ? image : image.slice(marker);
}

const dockerImageInspectionSchema = z.looseObject({
  Id: z.string().optional(),
  RepoDigests: z.array(z.string()).nullable().optional(),
});

function imageMatches(output: string, image: string): boolean {
  try {
    const inspection = dockerImageInspectionSchema.parse(
      JSON.parse(output) as unknown,
    );
    const expected = imageDigest(image);
    return (
      inspection.Id === expected ||
      (inspection.RepoDigests ?? []).some(
        (candidate) => imageDigest(candidate) === expected,
      )
    );
  } catch {
    return false;
  }
}

async function sourceFailureReason(
  trial: IndependentResearchTrialPlan,
): Promise<string | undefined> {
  const target = await verifyCanonicalSourceTree(
    trial.targetSourceDirectory,
    trial.campaignInput.targetSnapshot.sourceTree,
  );
  if (!target.matches) return "target-source-mismatch";
  const sources = new Map(
    trial.dependencySources.map((source) => [
      source.mountName,
      source.directory,
    ]),
  );
  for (const snapshot of trial.campaignInput.dependencySnapshots ?? []) {
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
    promptTextDigest(prompt) !== trial.campaignInput.promptSet.digest
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
  const docker = approval.runtime.dockerExecutablePath;
  const dockerVersion = await runDocker(runProcess, docker, [
    "version",
    "--format",
    "{{.Server.Version}}",
  ]);
  if (
    dockerVersion === undefined ||
    dockerVersion.kind !== "exited" ||
    dockerVersion.exitCode !== 0 ||
    dockerVersion.stdout.trim().length === 0
  ) {
    return unknown(approval, trial, checkedAt, "docker-unavailable");
  }
  const runtimes = await runDocker(runProcess, docker, [
    "info",
    "--format",
    "{{json .Runtimes}}",
  ]);
  if (runtimes?.kind !== "exited" || runtimes.exitCode !== 0) {
    return unknown(approval, trial, checkedAt, "docker-runtime-unavailable");
  }
  try {
    const observed = z
      .record(z.string(), z.unknown())
      .parse(JSON.parse(runtimes.stdout) as unknown);
    if (!Object.hasOwn(observed, "runsc")) {
      return blocked(approval, trial, checkedAt, "runsc-unavailable");
    }
  } catch {
    return unknown(approval, trial, checkedAt, "docker-runtime-invalid");
  }
  const image = await runDocker(runProcess, docker, [
    "image",
    "inspect",
    "--format",
    "{{json .}}",
    trial.image,
  ]);
  if (
    image?.kind !== "exited" ||
    image.exitCode !== 0 ||
    !imageMatches(image.stdout, trial.image)
  ) {
    return blocked(approval, trial, checkedAt, "image-unavailable");
  }
  const uid = typeof process.getuid === "function" ? process.getuid() : 0;
  const gid = typeof process.getgid === "function" ? process.getgid() : 0;
  const user = uid > 0 && gid > 0 ? `${uid}:${gid}` : "65534:65534";
  const provider = await runDocker(runProcess, docker, [
    "run",
    "--rm",
    "--pull=never",
    "--runtime=runsc",
    "--network=none",
    "--read-only",
    "--cap-drop=ALL",
    "--security-opt=no-new-privileges",
    "--pids-limit=32",
    "--memory=256m",
    "--cpus=1",
    `--user=${user}`,
    "--tmpfs=/tmp:rw,noexec,nosuid,nodev,size=64m",
    "--entrypoint=dsh",
    trial.image,
    "--version",
  ]);
  if (
    provider?.kind !== "exited" ||
    provider.exitCode !== 0 ||
    provider.stdout.trim().split(/\s/u)[0] !==
      trial.campaignInput.agentRuntimeProfile.executableVersion
  ) {
    return blocked(approval, trial, checkedAt, "provider-version-mismatch");
  }
  return result(approval, trial, checkedAt, "ready", "preflight-ready");
}
