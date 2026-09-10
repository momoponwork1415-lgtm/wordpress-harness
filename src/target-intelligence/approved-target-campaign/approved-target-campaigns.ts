import { canonicalDigest } from "../../infrastructure/canonical-json.js";
import {
  campaignInputSchema,
  researchCampaignPolicySchema,
  type CampaignInput,
} from "../../research/index.js";
import { canonicalJson } from "../acquisition/canonical-json.js";
import { admitTargetDispatch } from "../approved-target-batch/approved-target-batches.js";
import {
  approvedTargetBatchRefSchema,
  type ApprovedTargetBatch,
} from "../approved-target-batch/contracts.js";
import {
  approvedTargetCampaignRequestSchema,
  type ApprovedTargetCampaignRequest,
  type ApprovedTargetCampaigns,
  type OpenApprovedTargetCampaignsOptions,
} from "./contracts.js";

export type ApprovedTargetCampaignErrorCode =
  | "campaign-policy-mismatch"
  | "target-intake-mismatch"
  | "source-closure-invalid";

export class ApprovedTargetCampaignError extends Error {
  constructor(readonly code: ApprovedTargetCampaignErrorCode) {
    super(`Approved Target Campaign ${code}`);
    this.name = "ApprovedTargetCampaignError";
  }
}

function batchRef(batch: ApprovedTargetBatch) {
  return approvedTargetBatchRefSchema.parse({
    kind: "approved-target-batch-ref",
    schemaVersion: 3,
    id: batch.id,
    digest: batch.digest,
    batchKey: batch.batchKey,
    revision: batch.revision,
  });
}

function expectedPluginSlug(pluginIdentity: string): string {
  const separator = Math.max(
    pluginIdentity.lastIndexOf(":"),
    pluginIdentity.lastIndexOf("/"),
  );
  return pluginIdentity.slice(separator + 1);
}

function targetSourceBytes(request: ApprovedTargetCampaignRequest): number {
  return request.targetIntake.sourceTree.manifest.entries.reduce(
    (total, entry) => total + entry.size,
    0,
  );
}

function targetIntakeMatchesApproval(
  request: ApprovedTargetCampaignRequest,
  target: ApprovedTargetBatch["approvedTargets"][number]["candidate"]["target"],
): boolean {
  const intake = request.targetIntake;
  const manifest = intake.sourceTree.manifest;
  const mainPluginFile = manifest.entries.find(
    (entry) => entry.path === intake.mainPluginFile,
  );
  const expectedTargetSnapshotDigest = canonicalDigest({
    kind: "target-snapshot",
    schemaVersion: 1,
    pluginIdentity: intake.pluginIdentity,
    version: intake.version,
    treeDigest: intake.sourceTree.digest,
  });
  return (
    intake.pluginIdentity === target.pluginIdentity &&
    intake.version === target.verifiedVersion &&
    intake.targetSnapshot.pluginSlug ===
      expectedPluginSlug(target.pluginIdentity) &&
    intake.targetSnapshot.version === target.verifiedVersion &&
    intake.targetSnapshot.digest === expectedTargetSnapshotDigest &&
    intake.pluginBasename ===
      `${intake.canonicalInstallDirectory}/${intake.mainPluginFile}` &&
    intake.sourceTree.digest === target.canonicalFileManifestDigest &&
    intake.sourceTree.digest === canonicalDigest(manifest) &&
    intake.sourceTree.entries === manifest.entries.length &&
    intake.sourceCapture.digest === intake.sourceTree.digest &&
    canonicalJson(intake.sourceCapture.files) ===
      canonicalJson(manifest.entries) &&
    mainPluginFile?.digest === intake.versionEvidence.mainFileDigest &&
    intake.versionEvidence.requestedVersion === target.verifiedVersion &&
    intake.versionEvidence.mainHeaderVersion === target.verifiedVersion &&
    Number.isSafeInteger(targetSourceBytes(request))
  );
}

function hasWordPressCore(request: ApprovedTargetCampaignRequest): boolean {
  return (
    request.threatContext.dependencyRoles.filter(
      (dependency) =>
        dependency.role === "wordpress-core" &&
        dependency.mountName === "wordpress",
    ).length === 1
  );
}

export function admitApprovedTargetCampaign(
  requestValue: ApprovedTargetCampaignRequest,
): CampaignInput {
  const request = approvedTargetCampaignRequestSchema.parse(requestValue);
  const batch = request.approvedBatch;
  const approved = batch.approvedTargets.find(
    (target) => target.candidateId === request.candidateId,
  );
  if (approved === undefined) {
    throw new ApprovedTargetCampaignError("target-intake-mismatch");
  }

  const policy = researchCampaignPolicySchema.parse(request.campaignPolicy);
  if (
    policy.id !== batch.campaignPolicy.id ||
    policy.digest !== batch.campaignPolicy.digest
  ) {
    throw new ApprovedTargetCampaignError("campaign-policy-mismatch");
  }

  admitTargetDispatch(batch, {
    kind: "target-dispatch-admission-request",
    schemaVersion: 1,
    batchRef: batchRef(batch),
    candidateId: request.candidateId,
    target: approved.candidate.target,
    targetObservation: request.targetObservation,
    checkedAt: request.checkedAt,
  });

  if (!targetIntakeMatchesApproval(request, approved.candidate.target)) {
    throw new ApprovedTargetCampaignError("target-intake-mismatch");
  }
  if (request.dependencySnapshots.length === 0 || !hasWordPressCore(request)) {
    throw new ApprovedTargetCampaignError("source-closure-invalid");
  }

  return campaignInputSchema.parse({
    kind: "agent-led-campaign",
    schemaVersion: 1,
    campaignId: request.campaignId,
    targetSnapshot: {
      ...request.targetIntake.targetSnapshot,
      sourceTree: {
        digest: request.targetIntake.sourceTree.digest,
        entries: request.targetIntake.sourceTree.entries,
        bytes: targetSourceBytes(request),
      },
    },
    dependencySnapshots: request.dependencySnapshots,
    threatContext: request.threatContext,
    programmeBoundary: request.programmeBoundary,
    promptSet: policy.promptSet,
    validationPromptSet: policy.validationPromptSet,
    agentRuntimeProfile: policy.agentRuntimeProfile,
    permissionProfile: policy.permissionProfile,
    budgetEnvelope: policy.budgetEnvelope,
  });
}

class DirectApprovedTargetCampaigns implements ApprovedTargetCampaigns {
  readonly #campaigns: OpenApprovedTargetCampaignsOptions["campaigns"];

  constructor(options: OpenApprovedTargetCampaignsOptions) {
    this.#campaigns = options.campaigns;
  }

  async conduct(request: ApprovedTargetCampaignRequest) {
    return this.#campaigns.conduct(admitApprovedTargetCampaign(request));
  }
}

export function openApprovedTargetCampaigns(
  options: OpenApprovedTargetCampaignsOptions,
): ApprovedTargetCampaigns {
  return new DirectApprovedTargetCampaigns(options);
}
