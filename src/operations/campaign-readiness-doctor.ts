import { constants } from "node:fs";
import { access, lstat, open, statfs, type FileHandle } from "node:fs/promises";
import { dirname, join } from "node:path";

import { z } from "zod";

import { canonicalDigest } from "../infrastructure/canonical-json.js";
import { admitAgentRuntimeProfile } from "../infrastructure/agent-runtime-profile.js";
import { verifyCanonicalSourceTree } from "../infrastructure/canonical-source-tree.js";
import {
  runNativeModelProcess,
  type NativeModelProcessResult,
  type NativeModelProcessRunOptions,
} from "../infrastructure/native-model-process.js";
import { promptTextDigest } from "../infrastructure/prompt-text.js";
import { PrivateArtifactStore } from "../infrastructure/private-artifact-store.js";
import { campaignInputSchema } from "../research/index.js";
import {
  approvedCampaignLaunchManifestSchema,
  claudeAccountReadinessObservationSchema,
  claudeRateLimitObservationSchema,
  decideApprovedCampaignLaunches,
} from "./claude-quota-approved-campaign-launcher.js";
import { inspectLaunchReceipts } from "./claude-quota-approved-campaign-launcher-runtime.js";

export const campaignReadinessInputSchema = z
  .strictObject({
    kind: z.literal("campaign-readiness-input"),
    schemaVersion: z.literal(1),
    manifest: approvedCampaignLaunchManifestSchema,
    planId: z.string().min(1),
    campaignInput: campaignInputSchema,
    accountReadiness: claudeAccountReadinessObservationSchema.optional(),
    quotaObservation: claudeRateLimitObservationSchema.optional(),
    receiptRoot: z.string().min(1),
    minimumFreeDiskBytes: z.number().int().nonnegative(),
  })
  .superRefine((input, context) => {
    if (!input.manifest.plans.some((plan) => plan.id === input.planId)) {
      context.addIssue({
        code: "custom",
        path: ["planId"],
        message: "Campaign readiness plan must exist in the launch manifest",
      });
    }
  });

export type CampaignReadinessInput = z.infer<
  typeof campaignReadinessInputSchema
>;

const campaignReadinessCheckIds = [
  "docker",
  "runsc",
  "image",
  "provider-version",
  "account-readiness",
  "quota",
  "launch-capacity",
  "target-source",
  "dependency-sources",
  "prompt",
  "database",
  "scratch",
  "disk-headroom",
  "private-artifacts",
] as const;

const campaignReadinessStatusSchema = z.enum(["ready", "blocked", "unknown"]);

export const campaignReadinessCheckSchema = z.strictObject({
  id: z.enum(campaignReadinessCheckIds),
  status: campaignReadinessStatusSchema,
  reason: z.string().min(1),
  summary: z.string().min(1),
});

export const campaignReadinessReportSchema = z
  .strictObject({
    kind: z.literal("campaign-readiness-report"),
    schemaVersion: z.literal(1),
    campaignId: z.string().min(1),
    planId: z.string().min(1),
    checkedAt: z.iso.datetime(),
    status: campaignReadinessStatusSchema,
    checks: z.array(campaignReadinessCheckSchema),
  })
  .superRefine((report, context) => {
    for (const expectedId of campaignReadinessCheckIds) {
      if (report.checks.filter((item) => item.id === expectedId).length !== 1) {
        context.addIssue({
          code: "custom",
          path: ["checks"],
          message: `Campaign readiness report requires exactly one ${expectedId} check`,
        });
      }
    }
    const expectedStatus = report.checks.some(
      (item) => item.status === "blocked",
    )
      ? "blocked"
      : report.checks.some((item) => item.status === "unknown")
        ? "unknown"
        : "ready";
    if (report.status !== expectedStatus) {
      context.addIssue({
        code: "custom",
        path: ["status"],
        message: "Campaign readiness status must be derived from its checks",
      });
    }
  });

export type CampaignReadinessStatus = z.infer<
  typeof campaignReadinessStatusSchema
>;
export type CampaignReadinessCheckId =
  (typeof campaignReadinessCheckIds)[number];
export type CampaignReadinessCheck = z.infer<
  typeof campaignReadinessCheckSchema
>;
export type CampaignReadinessReport = z.infer<
  typeof campaignReadinessReportSchema
>;

type ProcessRunner = (
  options: NativeModelProcessRunOptions,
) => Promise<NativeModelProcessResult>;

export interface CampaignReadinessDoctor {
  inspect(input: CampaignReadinessInput): Promise<CampaignReadinessReport>;
}

function check(
  id: CampaignReadinessCheckId,
  status: CampaignReadinessStatus,
  reason: string,
  summary: string,
): CampaignReadinessCheck {
  return { id, status, reason, summary };
}

function ready(
  id: CampaignReadinessCheckId,
  reason: string,
  summary: string,
): CampaignReadinessCheck {
  return check(id, "ready", reason, summary);
}

function blocked(
  id: CampaignReadinessCheckId,
  reason: string,
  summary: string,
): CampaignReadinessCheck {
  return check(id, "blocked", reason, summary);
}

function unknown(
  id: CampaignReadinessCheckId,
  reason: string,
  summary: string,
): CampaignReadinessCheck {
  return check(id, "unknown", reason, summary);
}

function fileSystemError(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}

function processEnvironment(): NodeJS.ProcessEnv {
  return {
    PATH: process.env.PATH ?? "",
    LANG: "C",
    LC_ALL: "C",
    TZ: "UTC",
  };
}

function expectedImageDigest(image: string): string {
  const marker = image.lastIndexOf("sha256:");
  return marker === -1 ? image : image.slice(marker);
}

const dockerImageInspectionSchema = z.looseObject({
  Id: z.string().optional(),
  RepoDigests: z.array(z.string()).nullable().optional(),
});

function imageInspectionMatches(output: string, image: string): boolean {
  try {
    const inspection = dockerImageInspectionSchema.parse(
      JSON.parse(output) as unknown,
    );
    const digest = expectedImageDigest(image);
    return (
      inspection.Id === digest ||
      (inspection.RepoDigests ?? []).some(
        (repoDigest) => expectedImageDigest(repoDigest) === digest,
      )
    );
  } catch {
    return false;
  }
}

function runtimeExecutable(kind: string):
  | {
      readonly executable: "grok" | "claude" | "codex";
      readonly versionTokenIndex: number;
    }
  | undefined {
  if (kind === "grok-build-native/v1") {
    return { executable: "grok", versionTokenIndex: 1 };
  }
  if (
    kind === "claude-code-native/v1" ||
    kind === "glm-claude-code-native/v1"
  ) {
    return { executable: "claude", versionTokenIndex: 0 };
  }
  if (kind === "codex-native/v1") {
    return { executable: "codex", versionTokenIndex: 1 };
  }
  return undefined;
}

async function stableTextFile(path: string): Promise<string> {
  let handle: FileHandle | undefined;
  try {
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const before = await handle.stat();
    if (
      !before.isFile() ||
      before.nlink !== 1 ||
      before.size > 2 * 1024 * 1024
    ) {
      throw new Error("Prompt file is unsafe");
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
      throw new Error("Prompt file changed while it was inspected");
    }
    return text;
  } finally {
    await handle?.close();
  }
}

async function inspectDatabase(path: string): Promise<CampaignReadinessCheck> {
  try {
    const stat = await lstat(path);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) {
      return blocked(
        "database",
        "database-path-unsafe",
        "The Campaign database path is not a safe regular file.",
      );
    }
    await access(path, constants.R_OK | constants.W_OK);
    return ready(
      "database",
      "database-accessible",
      "The Campaign database is readable and writable.",
    );
  } catch (error: unknown) {
    if (!fileSystemError(error, "ENOENT")) {
      return blocked(
        "database",
        "database-inaccessible",
        "The Campaign database is not accessible.",
      );
    }
  }
  try {
    const parent = dirname(path);
    const stat = await lstat(parent);
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw new Error("Database parent is unsafe");
    }
    await access(parent, constants.W_OK | constants.X_OK);
    return ready(
      "database",
      "database-creatable",
      "The Campaign database does not exist and its parent is writable.",
    );
  } catch {
    return blocked(
      "database",
      "database-parent-inaccessible",
      "The Campaign database is absent and its parent is not writable.",
    );
  }
}

async function inspectScratch(path: string): Promise<CampaignReadinessCheck> {
  try {
    const stat = await lstat(path);
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw new Error("Scratch path is unsafe");
    }
    await access(path, constants.R_OK | constants.W_OK | constants.X_OK);
    return ready(
      "scratch",
      "scratch-accessible",
      "The Research scratch directory is accessible.",
    );
  } catch {
    return blocked(
      "scratch",
      "scratch-inaccessible",
      "The Research scratch directory is missing or inaccessible.",
    );
  }
}

async function inspectDiskHeadroom(
  path: string,
  minimumFreeDiskBytes: number,
): Promise<CampaignReadinessCheck> {
  try {
    const statistics = await statfs(path, { bigint: true });
    const available = statistics.bavail * statistics.bsize;
    if (available < BigInt(minimumFreeDiskBytes)) {
      return blocked(
        "disk-headroom",
        "disk-headroom-insufficient",
        "The Research scratch filesystem does not have the required free space.",
      );
    }
    return ready(
      "disk-headroom",
      "disk-headroom-sufficient",
      "The Research scratch filesystem has the required free space.",
    );
  } catch {
    return unknown(
      "disk-headroom",
      "disk-headroom-unavailable",
      "Free space for the Research scratch filesystem could not be observed.",
    );
  }
}

async function inspectPrivateArtifacts(
  input: CampaignReadinessInput,
  scratchDirectory: string,
): Promise<CampaignReadinessCheck> {
  const checkpoint = input.campaignInput.resumeFrom;
  if (checkpoint === undefined) {
    return ready(
      "private-artifacts",
      "private-artifacts-not-required",
      "This Campaign does not require a private resume artifact.",
    );
  }
  try {
    const store = new PrivateArtifactStore({
      rootDirectory: join(scratchDirectory, "agent-checkpoints"),
      maxEntries: 20_000,
      maxBytes: 128 * 1024 * 1024,
    });
    const resolution = await store.resolve({
      artifactId: checkpoint.checkpointId,
      digest: checkpoint.stateDigest,
      entries: checkpoint.stateEntries,
      bytes: checkpoint.stateBytes,
    });
    return resolution.status === "resolved"
      ? ready(
          "private-artifacts",
          "private-artifact-integrity-confirmed",
          "The bound private resume artifact passed integrity checks.",
        )
      : blocked(
          "private-artifacts",
          `private-artifact-${resolution.status}`,
          `The bound private resume artifact is ${resolution.status}.`,
        );
  } catch {
    return blocked(
      "private-artifacts",
      "private-artifact-unsafe",
      "The bound private resume artifact could not be inspected safely.",
    );
  }
}

async function inspectTargetSource(
  sourceDirectory: string,
  input: CampaignReadinessInput,
): Promise<CampaignReadinessCheck> {
  const verification = await verifyCanonicalSourceTree(
    sourceDirectory,
    input.campaignInput.targetSnapshot.sourceTree,
  );
  return verification.matches
    ? ready(
        "target-source",
        "target-source-matches",
        "The Target source matches its sealed snapshot.",
      )
    : blocked(
        "target-source",
        "target-source-mismatch",
        "The Target source does not match its sealed snapshot.",
      );
}

async function inspectDependencySources(
  input: CampaignReadinessInput,
  sources: readonly {
    readonly mountName: string;
    readonly directory: string;
  }[],
): Promise<CampaignReadinessCheck> {
  const snapshots = input.campaignInput.dependencySnapshots ?? [];
  const sourcesByMount = new Map(
    sources.map((source) => [source.mountName, source.directory]),
  );
  if (
    sourcesByMount.size !== sources.length ||
    sources.length !== snapshots.length ||
    snapshots.some((snapshot) => !sourcesByMount.has(snapshot.mountName))
  ) {
    return blocked(
      "dependency-sources",
      "dependency-binding-mismatch",
      "Dependency source mounts do not match the sealed Campaign.",
    );
  }
  const matches = await Promise.all(
    snapshots.map(async (snapshot) => {
      const directory = sourcesByMount.get(snapshot.mountName);
      return (
        directory !== undefined &&
        (await verifyCanonicalSourceTree(directory, snapshot.sourceTree))
          .matches
      );
    }),
  );
  return matches.every(Boolean)
    ? ready(
        "dependency-sources",
        "dependency-sources-match",
        "Every Dependency source matches its sealed snapshot.",
      )
    : blocked(
        "dependency-sources",
        "dependency-source-mismatch",
        "A Dependency source does not match its sealed snapshot.",
      );
}

async function inspectPrompt(
  path: string,
  input: CampaignReadinessInput,
): Promise<CampaignReadinessCheck> {
  try {
    const prompt = await stableTextFile(path);
    if (promptTextDigest(prompt) !== input.campaignInput.promptSet.digest) {
      return blocked(
        "prompt",
        "prompt-digest-mismatch",
        "The Research prompt does not match its sealed digest.",
      );
    }
    return ready(
      "prompt",
      "prompt-matches",
      "The Research prompt matches its sealed digest.",
    );
  } catch {
    return blocked(
      "prompt",
      "prompt-unavailable",
      "The sealed Research prompt is unavailable or unsafe.",
    );
  }
}

function accountCheck(reason: string): CampaignReadinessCheck {
  if (reason === "account-unauthenticated") {
    return blocked(
      "account-readiness",
      reason,
      "Claude requires a manual login before launch.",
    );
  }
  if (
    reason === "account-readiness-observation-missing" ||
    reason === "account-readiness-observation-stale" ||
    reason === "account-readiness-unavailable"
  ) {
    return unknown(
      "account-readiness",
      reason,
      "Current Claude account readiness is unknown.",
    );
  }
  return ready(
    "account-readiness",
    "account-ready",
    "Claude account readiness is fresh and ready.",
  );
}

function quotaCheck(
  subscriptionReason: string,
  account: CampaignReadinessCheck,
): CampaignReadinessCheck {
  if (account.status !== "ready") {
    return unknown(
      "quota",
      "account-readiness-required",
      "Quota cannot be admitted until account readiness is fresh.",
    );
  }
  if (
    subscriptionReason === "quota-observation-missing" ||
    subscriptionReason === "quota-observation-stale" ||
    subscriptionReason === "five-hour-quota-window-reset" ||
    subscriptionReason === "seven-day-quota-window-reset"
  ) {
    return unknown(
      "quota",
      subscriptionReason,
      "Current Claude quota is unknown until a fresh status-line observation is recorded.",
    );
  }
  if (
    subscriptionReason === "five-hour-quota-reserve-reached" ||
    subscriptionReason === "seven-day-quota-reserve-reached"
  ) {
    return blocked(
      "quota",
      subscriptionReason,
      "A required Claude subscription window has insufficient launch capacity.",
    );
  }
  return ready(
    "quota",
    "quota-capacity-sufficient",
    "Both Claude subscription windows have fresh launch capacity.",
  );
}

function launchCapacityCheck(input: {
  readonly planId: string;
  readonly subscriptionReady: boolean;
  readonly claimedPlanIds: ReadonlySet<string> | undefined;
  readonly selectedPlanIds: readonly string[] | undefined;
  readonly reason: string | undefined;
}): CampaignReadinessCheck {
  if (!input.subscriptionReady) {
    return unknown(
      "launch-capacity",
      "subscription-readiness-required",
      "Launch capacity cannot be admitted until account and quota checks pass.",
    );
  }
  if (
    input.claimedPlanIds === undefined ||
    input.selectedPlanIds === undefined
  ) {
    return unknown(
      "launch-capacity",
      "launch-receipts-unavailable",
      "Launch claims and active process capacity could not be inspected.",
    );
  }
  if (input.claimedPlanIds.has(input.planId)) {
    return blocked(
      "launch-capacity",
      "plan-already-claimed",
      "The approved launch plan has already been claimed.",
    );
  }
  if (input.selectedPlanIds.includes(input.planId)) {
    return ready(
      "launch-capacity",
      "launch-slot-available",
      "The approved plan has an atomic launch slot.",
    );
  }
  return blocked(
    "launch-capacity",
    input.reason ?? "plan-not-selected",
    "The approved plan is not selectable under the current process and batch limits.",
  );
}

class DefaultCampaignReadinessDoctor implements CampaignReadinessDoctor {
  readonly #runProcess: ProcessRunner;
  readonly #clock: () => Date;

  constructor(options: {
    readonly runProcess: ProcessRunner;
    readonly clock: () => Date;
  }) {
    this.#runProcess = options.runProcess;
    this.#clock = options.clock;
  }

  async #docker(
    executablePath: string,
    args: readonly string[],
  ): Promise<NativeModelProcessResult | undefined> {
    try {
      return await this.#runProcess({
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

  async #infrastructureChecks(
    input: CampaignReadinessInput,
    image: string,
  ): Promise<readonly CampaignReadinessCheck[]> {
    const profileAdmission = admitAgentRuntimeProfile(
      input.campaignInput.agentRuntimeProfile,
      image,
    );
    const dockerPath = input.manifest.runtime.dockerExecutablePath;
    const dockerProbe = await this.#docker(dockerPath, [
      "version",
      "--format",
      "{{.Server.Version}}",
    ]);
    const docker =
      dockerProbe?.kind === "exited" &&
      dockerProbe.exitCode === 0 &&
      dockerProbe.stdout.trim().length > 0
        ? ready("docker", "docker-available", "Docker is available.")
        : dockerProbe?.kind === "timed-out" ||
            dockerProbe?.kind === "output-limit-exceeded"
          ? unknown(
              "docker",
              "docker-probe-incomplete",
              "Docker availability could not be determined.",
            )
          : blocked("docker", "docker-unavailable", "Docker is unavailable.");

    let runsc: CampaignReadinessCheck;
    let runscAvailable = false;
    if (docker.status !== "ready") {
      runsc = unknown(
        "runsc",
        "docker-required",
        "runsc availability cannot be determined without Docker.",
      );
    } else {
      const runtimeProbe = await this.#docker(dockerPath, [
        "info",
        "--format",
        "{{json .Runtimes}}",
      ]);
      if (runtimeProbe?.kind === "exited" && runtimeProbe.exitCode === 0) {
        try {
          const runtimes = z
            .record(z.string(), z.unknown())
            .parse(JSON.parse(runtimeProbe.stdout) as unknown);
          runscAvailable = Object.hasOwn(runtimes, "runsc");
          runsc = runscAvailable
            ? ready(
                "runsc",
                "runsc-available",
                "Docker exposes the required runsc runtime.",
              )
            : blocked(
                "runsc",
                "runsc-unavailable",
                "Docker does not expose the required runsc runtime.",
              );
        } catch {
          runsc = unknown(
            "runsc",
            "runsc-observation-invalid",
            "Docker returned an invalid runtime observation.",
          );
        }
      } else {
        runsc = blocked(
          "runsc",
          "runsc-unavailable",
          "Docker runtime availability could not be confirmed.",
        );
      }
    }

    let imageCheck: CampaignReadinessCheck;
    let imageAvailable = false;
    if (docker.status !== "ready") {
      imageCheck = unknown(
        "image",
        "docker-required",
        "The pinned image cannot be inspected without Docker.",
      );
    } else {
      const imageProbe = await this.#docker(dockerPath, [
        "image",
        "inspect",
        "--format",
        "{{json .}}",
        image,
      ]);
      if (imageProbe?.kind === "exited" && imageProbe.exitCode === 0) {
        imageAvailable = imageInspectionMatches(imageProbe.stdout, image);
        if (imageAvailable && profileAdmission.status === "image-mismatch") {
          imageAvailable = false;
          imageCheck = blocked(
            "image",
            "runtime-profile-image-mismatch",
            "The launch image does not match the image bound by the Agent Runtime profile.",
          );
        } else {
          imageCheck = imageAvailable
            ? ready(
                "image",
                "image-digest-available",
                "The exact pinned Agent image is available.",
              )
            : blocked(
                "image",
                "image-digest-mismatch",
                "Docker did not return the required Agent image digest.",
              );
        }
      } else {
        imageCheck = blocked(
          "image",
          "image-unavailable",
          "The exact pinned Agent image is unavailable.",
        );
      }
    }

    let provider: CampaignReadinessCheck;
    const command =
      profileAdmission.status === "admitted"
        ? runtimeExecutable(profileAdmission.profile.transportKind)
        : undefined;
    if (profileAdmission.status !== "admitted") {
      provider = blocked(
        "provider-version",
        `runtime-profile-${profileAdmission.status}`,
        "The Agent Runtime profile is not admitted for this launch image.",
      );
    } else if (command === undefined) {
      provider = blocked(
        "provider-version",
        "runtime-profile-unsupported",
        "The Agent Runtime profile has no admitted provider executable.",
      );
    } else if (!runscAvailable || !imageAvailable) {
      provider = unknown(
        "provider-version",
        "sandbox-required",
        "The provider executable cannot be inspected without runsc and the pinned image.",
      );
    } else {
      const uid = typeof process.getuid === "function" ? process.getuid() : 0;
      const gid = typeof process.getgid === "function" ? process.getgid() : 0;
      const user = uid > 0 && gid > 0 ? `${uid}:${gid}` : "65534:65534";
      const providerProbe = await this.#docker(dockerPath, [
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
        `--entrypoint=${command.executable}`,
        image,
        "--version",
      ]);
      const tokens =
        providerProbe?.kind === "exited"
          ? providerProbe.stdout.trim().split(/[\s(]/u)
          : [];
      const observed = tokens[command.versionTokenIndex];
      provider =
        providerProbe?.kind === "exited" &&
        providerProbe.exitCode === 0 &&
        observed === input.campaignInput.agentRuntimeProfile.executableVersion
          ? ready(
              "provider-version",
              "provider-version-matches",
              "The sandboxed provider executable version matches the sealed profile.",
            )
          : blocked(
              "provider-version",
              "provider-version-mismatch",
              "The sandboxed provider executable version does not match the sealed profile.",
            );
    }
    return [docker, runsc, imageCheck, provider];
  }

  async inspect(
    inputValue: CampaignReadinessInput,
  ): Promise<CampaignReadinessReport> {
    const input = campaignReadinessInputSchema.parse(inputValue);
    const plan = input.manifest.plans.find((item) => item.id === input.planId);
    if (plan === undefined) {
      throw new Error(`Unknown approved launch plan: ${input.planId}`);
    }
    const checkedAt = this.#clock().toISOString();
    const [
      infrastructure,
      targetSource,
      dependencies,
      prompt,
      database,
      scratch,
    ] = await Promise.all([
      this.#infrastructureChecks(input, plan.image),
      inspectTargetSource(plan.targetSourceDirectory, input),
      inspectDependencySources(input, plan.dependencySources),
      inspectPrompt(plan.researchPromptPath, input),
      inspectDatabase(plan.databasePath),
      inspectScratch(plan.scratchDirectory),
    ]);
    const [diskHeadroom, privateArtifacts] = await Promise.all([
      inspectDiskHeadroom(plan.scratchDirectory, input.minimumFreeDiskBytes),
      inspectPrivateArtifacts(input, plan.scratchDirectory),
    ]);

    let claimedPlanIds: ReadonlySet<string> | undefined;
    let selectedPlanIds: readonly string[] | undefined;
    let launchReason: string | undefined;
    let reservedFiveHourPercentage = 0;
    let reservedSevenDayPercentage = 0;
    try {
      const view = await inspectLaunchReceipts(input.receiptRoot);
      claimedPlanIds = view.claimedPlanIds;
      const observationDigest =
        input.quotaObservation === undefined
          ? undefined
          : canonicalDigest(input.quotaObservation);
      for (const reservation of view.quotaReservations) {
        if (reservation.observationDigest !== observationDigest) continue;
        reservedFiveHourPercentage += reservation.estimatedFiveHourPercentage;
        reservedSevenDayPercentage += reservation.estimatedSevenDayPercentage;
      }
      const launchDecision = decideApprovedCampaignLaunches({
        manifest: input.manifest,
        readiness: input.accountReadiness,
        observation: input.quotaObservation,
        claimedPlanIds: view.claimedPlanIds,
        activePlanIds: view.activePlanIds,
        reservedFiveHourPercentage,
        reservedSevenDayPercentage,
        now: checkedAt,
      });
      selectedPlanIds = launchDecision.selectedPlanIds;
      launchReason = launchDecision.reason;
    } catch {
      claimedPlanIds = undefined;
    }

    const subscriptionDecision = decideApprovedCampaignLaunches({
      manifest: input.manifest,
      readiness: input.accountReadiness,
      observation: input.quotaObservation,
      claimedPlanIds: new Set(),
      activePlanIds: new Set(),
      reservedFiveHourPercentage,
      reservedSevenDayPercentage,
      now: checkedAt,
    });
    const account = accountCheck(subscriptionDecision.reason);
    const quota = quotaCheck(subscriptionDecision.reason, account);
    const launchCapacity = launchCapacityCheck({
      planId: input.planId,
      subscriptionReady: account.status === "ready" && quota.status === "ready",
      claimedPlanIds,
      selectedPlanIds,
      reason: launchReason,
    });

    const campaignBinding = plan.campaignId === input.campaignInput.campaignId;
    const targetCheck = campaignBinding
      ? targetSource
      : blocked(
          "target-source",
          "campaign-binding-mismatch",
          "The launch plan Campaign does not match the sealed Campaign input.",
        );
    const checks = [
      ...infrastructure,
      account,
      quota,
      launchCapacity,
      targetCheck,
      dependencies,
      prompt,
      database,
      scratch,
      diskHeadroom,
      privateArtifacts,
    ] as const;
    const status = checks.some((item) => item.status === "blocked")
      ? "blocked"
      : checks.some((item) => item.status === "unknown")
        ? "unknown"
        : "ready";
    return campaignReadinessReportSchema.parse({
      kind: "campaign-readiness-report",
      schemaVersion: 1,
      campaignId: input.campaignInput.campaignId,
      planId: input.planId,
      checkedAt,
      status,
      checks,
    });
  }
}

export function openCampaignReadinessDoctor(
  options: {
    readonly runProcess?: ProcessRunner;
    readonly clock?: () => Date;
  } = {},
): CampaignReadinessDoctor {
  return new DefaultCampaignReadinessDoctor({
    runProcess: options.runProcess ?? runNativeModelProcess,
    clock: options.clock ?? (() => new Date()),
  });
}

export function formatCampaignReadinessReport(
  report: CampaignReadinessReport,
): string {
  const lines = [
    `${report.status.toUpperCase()} ${report.campaignId} (${report.planId})`,
  ];
  for (const item of report.checks) {
    lines.push(
      `[${item.status.toUpperCase()}] ${item.id}: ${item.summary} (${item.reason})`,
    );
  }
  return `${lines.join("\n")}\n`;
}
