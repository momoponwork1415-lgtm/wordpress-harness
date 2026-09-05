import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { canonicalJson, sha256Digest } from "../acquisition/canonical-json.js";
import { type TargetSelectionReceipt } from "../target-selection/contracts.js";
import {
  TargetBatchApprovalError,
  approvedTargetBatchRefSchema,
  approvedTargetBatchSchema,
  legacyApprovedTargetBatchProjectionSchema,
  legacyApprovedTargetBatchSchema,
  readableApprovedTargetBatchRefSchema,
  targetBatchApprovalRequestSchema,
  type ApprovedTargetBatch,
  type ApprovedTargetBatchRef,
  type LegacyApprovedTargetBatch,
  type LegacyApprovedTargetBatchProjection,
  type OpenTargetBatchApprovalOptions,
  type ReadableApprovedTargetBatchRef,
  type TargetBatchApproval,
  type TargetBatchApprovalRequest,
} from "./contracts.js";

function hasErrorCode(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === code
  );
}

function batchRef(batch: ApprovedTargetBatch): ApprovedTargetBatchRef {
  return approvedTargetBatchRefSchema.parse({
    kind: "approved-target-batch-ref",
    schemaVersion: 2,
    id: batch.id,
    digest: batch.digest,
  });
}

function verifyBatch(batch: ApprovedTargetBatch): void {
  const { id, digest, ...body } = batch;
  if (
    sha256Digest(body) !== digest ||
    id !== `approved-batch:${digest.slice(7, 31)}`
  ) {
    throw new Error("Approved Target Batch integrity mismatch");
  }
}

function verifyLegacyBatch(batch: LegacyApprovedTargetBatch): void {
  const { id, digest, ...body } = batch;
  if (
    sha256Digest(body) !== digest ||
    id !== `approved-batch:${digest.slice(7, 31)}`
  ) {
    throw new Error("Legacy Approved Target Batch integrity mismatch");
  }
}

function projectLegacyBatch(
  batch: LegacyApprovedTargetBatch,
): LegacyApprovedTargetBatchProjection {
  const approvedTargets = batch.approvedTargets.map((target) => ({
    candidateId: target.candidateId,
    source: target.source,
    reason:
      target.source === "operator-nominated"
        ? ("approve-operator-nomination" as const)
        : ("accept-autonomous-selection" as const),
    selectionReceiptRef: target.selectionReceiptRef,
  }));
  const orderReason =
    approvedTargets.length === 1
      ? ("single-target-batch" as const)
      : approvedTargets[0]?.source === "operator-nominated"
        ? ("operator-nomination-prioritized" as const)
        : ("selection-order-retained" as const);
  return legacyApprovedTargetBatchProjectionSchema.parse({
    kind: "approved-target-batch-legacy-projection",
    schemaVersion: 1,
    sourceArtifact: { id: batch.id, digest: batch.digest },
    batchKey: batch.batchKey,
    revision: batch.revision,
    selectionAttemptRef: batch.selectionAttemptRef,
    selectionPolicy: batch.selectionPolicy,
    modelProfile: batch.modelProfile,
    campaignPolicy: batch.campaignPolicy,
    batchBudget: batch.batchBudget,
    executionWindow: batch.executionWindow,
    operator: batch.operator,
    approvedTargets,
    excludedTargets: batch.excludedTargets.map((target) => ({
      candidateId: target.candidateId,
      reason: "exclude-from-current-batch" as const,
      selectionReceiptRef: target.selectionReceiptRef,
    })),
    orderReason,
    approvedAt: batch.approvedAt,
  });
}

function normalizedRequest(
  value: TargetBatchApprovalRequest,
): TargetBatchApprovalRequest {
  const request = targetBatchApprovalRequestSchema.parse(value);
  return targetBatchApprovalRequestSchema.parse({
    ...request,
    operatorNominations: [...request.operatorNominations].sort((left, right) =>
      left.candidate.candidateId.localeCompare(right.candidate.candidateId),
    ),
    decisions: [...request.decisions].sort((left, right) =>
      left.candidateId.localeCompare(right.candidateId),
    ),
  });
}

class FileTargetBatchApproval implements TargetBatchApproval {
  readonly #storageDirectory: string;
  readonly #selectionResolver: OpenTargetBatchApprovalOptions["selectionResolver"];
  readonly #clock: () => Date;

  constructor(options: OpenTargetBatchApprovalOptions) {
    this.#storageDirectory = options.storageDirectory;
    this.#selectionResolver = options.selectionResolver;
    this.#clock = options.clock ?? (() => new Date());
  }

  async approve(
    requestValue: TargetBatchApprovalRequest,
  ): Promise<ApprovedTargetBatchRef> {
    const request = normalizedRequest(requestValue);
    const approvalInputDigest = sha256Digest(request);
    const existing = await this.#readRevision(
      request.batchKey,
      request.revision,
    );
    if (existing !== undefined) {
      if (existing.approvalInputDigest !== approvalInputDigest) {
        throw new TargetBatchApprovalError("revision-conflict");
      }
      return batchRef(existing);
    }

    const approvedAt = this.#clock().toISOString();
    let selectionVerification;
    try {
      selectionVerification = await this.#selectionResolver.resolveForApproval({
        kind: "target-selection-approval-verification-request",
        schemaVersion: 1,
        attempt: request.selectionAttempt,
        selectionPolicy: request.selectionPolicy,
        modelProfile: request.modelProfile,
        operatorIdentity: request.operator.identity,
        nominations: request.operatorNominations,
        verifiedAt: approvedAt,
      });
    } catch {
      throw new TargetBatchApprovalError("selection-attempt-unverified");
    }
    if (
      canonicalJson(selectionVerification.attemptRef) !==
        canonicalJson(request.selectionAttempt.ref) ||
      canonicalJson(selectionVerification.selectionPolicy) !==
        canonicalJson(request.selectionPolicy) ||
      canonicalJson(selectionVerification.modelProfile) !==
        canonicalJson(request.modelProfile)
    ) {
      throw new TargetBatchApprovalError("binding-mismatch");
    }
    const selectionReceipts = [...selectionVerification.receipts];
    this.#validateDecisions(request, selectionReceipts);
    await this.#validateSupersedes(request);

    const receipts = new Map(
      selectionReceipts.map((receipt) => [receipt.candidateId, receipt]),
    );
    const decisions = new Map(
      request.decisions.map((decision) => [decision.candidateId, decision]),
    );
    const approvedTargets = request.approvedOrder.map((candidateId) => {
      const receipt = receipts.get(candidateId);
      const decision = decisions.get(candidateId);
      if (receipt === undefined || decision === undefined) {
        throw new TargetBatchApprovalError("approval-invalid");
      }
      return {
        candidateId,
        source:
          receipt.candidate.origin.kind === "operator-nomination"
            ? ("operator-nominated" as const)
            : ("autonomous-selection" as const),
        reason: decision.reason,
        selectionReceiptRef: { id: receipt.id, digest: receipt.digest },
      };
    });
    const excludedTargets = request.decisions
      .filter((decision) => decision.decision === "exclude")
      .map((decision) => {
        const receipt = receipts.get(decision.candidateId);
        if (receipt === undefined) {
          throw new TargetBatchApprovalError("approval-invalid");
        }
        return {
          candidateId: decision.candidateId,
          reason: decision.reason,
          selectionReceiptRef: { id: receipt.id, digest: receipt.digest },
        };
      });

    const body = {
      kind: "approved-target-batch" as const,
      schemaVersion: 2 as const,
      approvalInputDigest,
      batchKey: request.batchKey,
      revision: request.revision,
      selectionAttemptRef: request.selectionAttempt.ref,
      selectionVerificationRef: {
        kind: "target-selection-approval-verification-ref" as const,
        schemaVersion: 1 as const,
        id: selectionVerification.id,
        digest: selectionVerification.digest,
      },
      selectionReceipts,
      selectionPolicy: request.selectionPolicy,
      modelProfile: request.modelProfile,
      campaignPolicy: request.campaignPolicy,
      batchBudget: request.batchBudget,
      executionWindow: request.executionWindow,
      operator: request.operator,
      decisions: request.decisions,
      approvedTargets,
      excludedTargets,
      orderReason: request.orderReason,
      ...(request.supersedes === undefined
        ? {}
        : { supersedes: request.supersedes }),
      approvedAt,
    };
    const digest = sha256Digest(body);
    const batch = approvedTargetBatchSchema.parse({
      ...body,
      id: `approved-batch:${digest.slice(7, 31)}`,
      digest,
    });
    return this.#persist(batch);
  }

  async inspect(
    refValue: ReadableApprovedTargetBatchRef,
  ): Promise<ApprovedTargetBatch | LegacyApprovedTargetBatchProjection> {
    const ref = readableApprovedTargetBatchRefSchema.parse(refValue);
    const path = join(
      this.#storageDirectory,
      "approved-target-batches",
      "artifacts",
      `${ref.digest.slice(7)}.json`,
    );
    const raw: unknown = JSON.parse((await readFile(path)).toString("utf8"));
    if (ref.schemaVersion === 1) {
      const legacy = legacyApprovedTargetBatchSchema.parse(raw);
      verifyLegacyBatch(legacy);
      if (legacy.id !== ref.id || legacy.digest !== ref.digest) {
        throw new Error("Legacy Approved Target Batch integrity mismatch");
      }
      return projectLegacyBatch(legacy);
    }
    const batch = approvedTargetBatchSchema.parse(raw);
    verifyBatch(batch);
    if (batch.id !== ref.id || batch.digest !== ref.digest) {
      throw new Error("Approved Target Batch integrity mismatch");
    }
    return batch;
  }

  #validateDecisions(
    request: TargetBatchApprovalRequest,
    selectionReceipts: readonly TargetSelectionReceipt[],
  ): void {
    const receiptIds = selectionReceipts.map((receipt) => receipt.candidateId);
    const decisionIds = request.decisions.map(
      (decision) => decision.candidateId,
    );
    if (
      new Set(receiptIds).size !== receiptIds.length ||
      new Set(decisionIds).size !== decisionIds.length ||
      receiptIds.length !== decisionIds.length ||
      ![...receiptIds]
        .sort()
        .every((id, index) => id === [...decisionIds].sort()[index])
    ) {
      throw new TargetBatchApprovalError("approval-invalid");
    }
    const approved = request.decisions.filter(
      (decision) => decision.decision === "approve",
    );
    if (
      approved.length === 0 ||
      approved.length > request.batchBudget.maxTargets ||
      new Set(request.approvedOrder).size !== request.approvedOrder.length ||
      request.approvedOrder.length !== approved.length ||
      ![...request.approvedOrder]
        .sort()
        .every(
          (id, index) =>
            id ===
            approved.map((decision) => decision.candidateId).sort()[index],
        )
    ) {
      throw new TargetBatchApprovalError(
        approved.length > request.batchBudget.maxTargets
          ? "budget-exceeded"
          : "approval-invalid",
      );
    }
    const receipts = new Map(
      selectionReceipts.map((receipt) => [receipt.candidateId, receipt]),
    );
    for (const decision of approved) {
      const receipt = receipts.get(decision.candidateId);
      if (receipt === undefined || receipt.hardGate.status !== "passed") {
        throw new TargetBatchApprovalError("hard-gate-failed");
      }
      if (
        receipt.candidate.origin.kind === "autonomous-observation" &&
        receipt.decision !== "selected"
      ) {
        throw new TargetBatchApprovalError("approval-invalid");
      }
      if (
        (receipt.candidate.origin.kind === "operator-nomination" &&
          (receipt.receiptSource !== "approval-nomination" ||
            decision.reason !== "approve-operator-nomination" ||
            receipt.candidate.origin.nominatedBy !==
              request.operator.identity ||
            Date.parse(receipt.candidate.origin.nominatedAt) >
              Date.parse(receipt.selectedAt))) ||
        (receipt.candidate.origin.kind === "autonomous-observation" &&
          decision.reason !== "accept-autonomous-selection")
      ) {
        throw new TargetBatchApprovalError("approval-invalid");
      }
    }
    for (const decision of request.decisions) {
      if (
        decision.decision === "exclude" &&
        decision.reason !== "exclude-from-current-batch"
      ) {
        throw new TargetBatchApprovalError("approval-invalid");
      }
    }
  }

  async #validateSupersedes(
    request: TargetBatchApprovalRequest,
  ): Promise<void> {
    if (request.revision === 1) {
      if (request.supersedes !== undefined) {
        throw new TargetBatchApprovalError("supersede-invalid");
      }
      return;
    }
    if (request.supersedes === undefined) {
      throw new TargetBatchApprovalError("supersede-invalid");
    }
    let previous: ApprovedTargetBatch;
    try {
      const inspected = await this.inspect(request.supersedes);
      if (inspected.kind !== "approved-target-batch") {
        throw new Error("Legacy Batch is read-only");
      }
      previous = inspected;
    } catch {
      throw new TargetBatchApprovalError("supersede-invalid");
    }
    if (
      previous.batchKey !== request.batchKey ||
      previous.revision !== request.revision - 1
    ) {
      throw new TargetBatchApprovalError("supersede-invalid");
    }
    if (
      this.#clock().getTime() >= Date.parse(previous.executionWindow.startsAt)
    ) {
      throw new TargetBatchApprovalError("execution-started");
    }
  }

  async #persist(batch: ApprovedTargetBatch): Promise<ApprovedTargetBatchRef> {
    const artifactDirectory = join(
      this.#storageDirectory,
      "approved-target-batches",
      "artifacts",
    );
    const revisionDirectory = join(
      this.#storageDirectory,
      "approved-target-batches",
      "revisions",
    );
    await mkdir(artifactDirectory, { recursive: true });
    await mkdir(revisionDirectory, { recursive: true });
    const artifactPath = join(
      artifactDirectory,
      `${batch.digest.slice(7)}.json`,
    );
    const bytes = Buffer.from(canonicalJson(batch), "utf8");
    try {
      await writeFile(artifactPath, bytes, { flag: "wx" });
    } catch (error) {
      if (!hasErrorCode(error, "EEXIST")) throw error;
      if (!(await readFile(artifactPath)).equals(bytes)) {
        throw new Error("Approved Target Batch artifact conflict");
      }
    }
    const revisionPath = join(
      revisionDirectory,
      `${batch.batchKey}.revision-${batch.revision}.json`,
    );
    try {
      await writeFile(revisionPath, bytes, { flag: "wx" });
      return batchRef(batch);
    } catch (error) {
      if (!hasErrorCode(error, "EEXIST")) throw error;
      const existing = approvedTargetBatchSchema.parse(
        JSON.parse((await readFile(revisionPath)).toString("utf8")),
      );
      verifyBatch(existing);
      if (existing.approvalInputDigest !== batch.approvalInputDigest) {
        throw new TargetBatchApprovalError("revision-conflict");
      }
      return batchRef(existing);
    }
  }

  async #readRevision(
    batchKey: string,
    revision: number,
  ): Promise<ApprovedTargetBatch | undefined> {
    const path = join(
      this.#storageDirectory,
      "approved-target-batches",
      "revisions",
      `${batchKey}.revision-${revision}.json`,
    );
    try {
      const batch = approvedTargetBatchSchema.parse(
        JSON.parse((await readFile(path)).toString("utf8")),
      );
      verifyBatch(batch);
      return batch;
    } catch (error) {
      if (hasErrorCode(error, "ENOENT")) return undefined;
      throw error;
    }
  }
}

export function openTargetBatchApproval(
  options: OpenTargetBatchApprovalOptions,
): TargetBatchApproval {
  return new FileTargetBatchApproval(options);
}
