import {
  intakeReceiptSchema,
  targetIntakePacketSchema,
  type IntakeReceipt,
  type TargetIntakePacket,
} from "../../target-intelligence/acquisition/contracts.js";
import {
  newCampaignInputV3Schema,
  targetIntakeCampaignPreparationInputSchema,
  type NewCampaignInputV3,
  type TargetIntakeCampaignPreparationInput,
} from "../contracts.js";
import {
  canonicalJson,
  sha256Digest,
} from "../research-record/canonical-json.js";
import type { JsonArtifactStore } from "../research-record/contracts.js";
import { rehydrationReason } from "../research-record/rehydration-reason.js";
import {
  ArtifactIntegrityError,
  openVerifiedArtifacts,
  type VerifiedArtifacts,
} from "../../infrastructure/verified-artifacts.js";

/**
 * Why the handoff refused.
 *
 * The three Research CAS reasons name three different repairs and must not be
 * substituted for one another: `-digest-mismatch` says the store holds content
 * the digest does not address, `-artifact-invalid` says it holds the addressed
 * content and this generation cannot read it, and `-artifact-missing` says it
 * could not produce the artifact at all.
 */
type HandoffIntegrityReason =
  | "packet-digest-mismatch"
  | "receipt-digest-mismatch"
  | "receipt-packet-binding-mismatch"
  | "packet-content-binding-mismatch"
  | "research-cas-digest-mismatch"
  | "research-cas-artifact-invalid"
  | "research-cas-artifact-missing";

export class TargetIntakeHandoffIntegrityError extends Error {
  readonly reason: HandoffIntegrityReason;

  constructor(reason: HandoffIntegrityReason) {
    super(`Target Intake handoff integrity check failed: ${reason}`);
    this.name = "TargetIntakeHandoffIntegrityError";
    this.reason = reason;
  }
}

function sameValue(left: unknown, right: unknown): boolean {
  return canonicalJson(left) === canonicalJson(right);
}

function validatePacketAndReceipt(
  packet: TargetIntakePacket,
  packetRef: { readonly id: string; readonly digest: string },
  receipt: IntakeReceipt,
  receiptRef: { readonly id: string; readonly digest: string },
): void {
  if (sha256Digest(packet) !== packetRef.digest) {
    throw new TargetIntakeHandoffIntegrityError("packet-digest-mismatch");
  }
  if (sha256Digest(receipt) !== receiptRef.digest) {
    throw new TargetIntakeHandoffIntegrityError("receipt-digest-mismatch");
  }
  if (
    receipt.status !== "ready" ||
    receipt.reasons.length !== 0 ||
    receipt.packetRef === undefined ||
    !sameValue(receipt.packetRef, packetRef)
  ) {
    throw new TargetIntakeHandoffIntegrityError(
      "receipt-packet-binding-mismatch",
    );
  }

  const mainFile = packet.sourceTree.manifest.entries.find(
    (entry) => entry.path === packet.mainPluginFile,
  );
  const expectedSnapshotDigest = sha256Digest({
    kind: "target-snapshot",
    schemaVersion: 1,
    pluginIdentity: packet.pluginIdentity,
    version: packet.version,
    treeDigest: packet.sourceTree.digest,
  });
  if (
    packet.sourceTree.digest !== sha256Digest(packet.sourceTree.manifest) ||
    packet.sourceCapture.digest !== packet.sourceTree.digest ||
    !sameValue(
      packet.sourceCapture.files,
      packet.sourceTree.manifest.entries,
    ) ||
    packet.sourceTree.entries !== packet.sourceTree.manifest.entries.length ||
    packet.pluginBasename !==
      `${packet.canonicalInstallDirectory}/${packet.mainPluginFile}` ||
    packet.versionEvidence.requestedVersion !== packet.version ||
    packet.versionEvidence.mainHeaderVersion !== packet.version ||
    mainFile?.digest !== packet.versionEvidence.mainFileDigest ||
    packet.targetSnapshot.version !== packet.version ||
    packet.targetSnapshot.digest !== expectedSnapshotDigest ||
    !sameValue(receipt.policy, packet.policy)
  ) {
    throw new TargetIntakeHandoffIntegrityError(
      "packet-content-binding-mismatch",
    );
  }
}

async function persistHandoffArtifact(
  artifacts: VerifiedArtifacts,
  artifact: string,
  value: unknown,
  expectedDigest: string,
): Promise<void> {
  try {
    await artifacts.put(artifact, value, expectedDigest);
  } catch (error: unknown) {
    if (!(error instanceof ArtifactIntegrityError)) throw error;
    throw new TargetIntakeHandoffIntegrityError("research-cas-digest-mismatch");
  }
}

export async function materializeTargetIntakeCampaignInput(
  value: TargetIntakeCampaignPreparationInput,
  artifactStore: JsonArtifactStore,
): Promise<NewCampaignInputV3> {
  const input = targetIntakeCampaignPreparationInputSchema.parse(value);
  const { packet, packetRef, receipt, receiptRef } = input.intake;
  const artifacts = openVerifiedArtifacts(artifactStore);
  validatePacketAndReceipt(packet, packetRef, receipt, receiptRef);
  await persistHandoffArtifact(
    artifacts,
    "Target Intake Packet",
    packet,
    packetRef.digest,
  );
  await persistHandoffArtifact(
    artifacts,
    "Target Intake Receipt",
    receipt,
    receiptRef.digest,
  );

  return newCampaignInputV3Schema.parse({
    schemaVersion: 3,
    campaignId: input.campaignId,
    targetSnapshot: packet.targetSnapshot,
    campaignPolicy: input.campaignPolicy,
    runtimeProfile: input.runtimeProfile,
    promptSet: input.promptSet,
    modelProfiles: input.modelProfiles,
    knowledgeCapsules: input.knowledgeCapsules,
    experimentRegistry: input.experimentRegistry,
    budget: input.budget,
    canonicalFileManifest: packet.sourceTree.manifest,
    targetIntake: {
      packet: packetRef,
      receipt: receiptRef,
      pluginIdentity: packet.pluginIdentity,
      canonicalInstallDirectory: packet.canonicalInstallDirectory,
      mainPluginFile: packet.mainPluginFile,
      pluginBasename: packet.pluginBasename,
      sourceTreeDigest: packet.sourceTree.digest,
    },
  });
}

export async function validatePreparedTargetIntake(
  input: NewCampaignInputV3,
  artifactStore: JsonArtifactStore,
): Promise<void> {
  const artifacts = openVerifiedArtifacts(artifactStore);
  let packet: TargetIntakePacket;
  let receipt: IntakeReceipt;
  try {
    packet = await artifacts.read(
      "Target Intake Packet",
      targetIntakePacketSchema,
      input.targetIntake.packet.digest,
    );
    receipt = await artifacts.read(
      "Target Intake Receipt",
      intakeReceiptSchema,
      input.targetIntake.receipt.digest,
    );
  } catch (error: unknown) {
    if (error instanceof TargetIntakeHandoffIntegrityError) throw error;
    throw new TargetIntakeHandoffIntegrityError(
      rehydrationReason(
        error,
        "research-cas-digest-mismatch",
        "research-cas-artifact-invalid",
        "research-cas-artifact-missing",
      ),
    );
  }
  validatePacketAndReceipt(
    packet,
    input.targetIntake.packet,
    receipt,
    input.targetIntake.receipt,
  );
  if (
    !sameValue(packet.targetSnapshot, input.targetSnapshot) ||
    !sameValue(packet.sourceTree.manifest, input.canonicalFileManifest) ||
    input.targetIntake.sourceTreeDigest !== packet.sourceTree.digest ||
    input.targetIntake.pluginIdentity !== packet.pluginIdentity ||
    input.targetIntake.canonicalInstallDirectory !==
      packet.canonicalInstallDirectory ||
    input.targetIntake.mainPluginFile !== packet.mainPluginFile ||
    input.targetIntake.pluginBasename !== packet.pluginBasename
  ) {
    throw new TargetIntakeHandoffIntegrityError(
      "packet-content-binding-mismatch",
    );
  }
}
