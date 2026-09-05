import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { canonicalJson, sha256Digest } from "../acquisition/canonical-json.js";
import {
  targetSelectionAttemptSchema,
  type TargetSelectionReceipt,
} from "../target-selection/contracts.js";
import {
  TargetBatchApprovalError,
  approvedTargetBatchRefSchema,
  approvedTargetBatchSchema,
  targetBatchApprovalRequestSchema,
  type ApprovedTargetBatch,
  type ApprovedTargetBatchRef,
  type OpenTargetBatchApprovalOptions,
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
    schemaVersion: 1,
    id: batch.id,
    digest: batch.digest,
  });
}

function verifyReceipt(receipt: TargetSelectionReceipt): boolean {
  const { id, digest, ...body } = receipt;
  const actualDigest = sha256Digest(body);
  return (
    digest === actualDigest && id === `selection-receipt:${digest.slice(7, 31)}`
  );
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

function normalizedRequest(
  value: TargetBatchApprovalRequest,
): TargetBatchApprovalRequest {
  const request = targetBatchApprovalRequestSchema.parse(value);
  return targetBatchApprovalRequestSchema.parse({
    ...request,
    selectionReceipts: [...request.selectionReceipts].sort((left, right) =>
      left.candidateId.localeCompare(right.candidateId),
    ),
    decisions: [...request.decisions].sort((left, right) =>
      left.candidateId.localeCompare(right.candidateId),
    ),
  });
}

class FileTargetBatchApproval implements TargetBatchApproval {
  readonly #storageDirectory: string;
  readonly #clock: () => Date;

  constructor(options: OpenTargetBatchApprovalOptions) {
    this.#storageDirectory = options.storageDirectory;
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

    await this.#validateBindings(request);
    this.#validateDecisions(request);
    await this.#validateSupersedes(request);

    const receipts = new Map(
      request.selectionReceipts.map((receipt) => [
        receipt.candidateId,
        receipt,
      ]),
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
        source: decision.source,
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
      schemaVersion: 1 as const,
      approvalInputDigest,
      batchKey: request.batchKey,
      revision: request.revision,
      selectionAttemptRef: request.selectionAttemptRef,
      selectionReceipts: request.selectionReceipts,
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
      approvedAt: this.#clock().toISOString(),
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
    refValue: ApprovedTargetBatchRef,
  ): Promise<ApprovedTargetBatch> {
    const ref = approvedTargetBatchRefSchema.parse(refValue);
    const path = join(
      this.#storageDirectory,
      "approved-target-batches",
      "artifacts",
      `${ref.digest.slice(7)}.json`,
    );
    const batch = approvedTargetBatchSchema.parse(
      JSON.parse((await readFile(path)).toString("utf8")),
    );
    verifyBatch(batch);
    if (batch.id !== ref.id || batch.digest !== ref.digest) {
      throw new Error("Approved Target Batch integrity mismatch");
    }
    return batch;
  }

  async #validateBindings(request: TargetBatchApprovalRequest): Promise<void> {
    const attempts = new Set<string>();
    for (const receipt of request.selectionReceipts) {
      if (!verifyReceipt(receipt)) {
        throw new TargetBatchApprovalError("receipt-integrity-failed");
      }
      attempts.add(
        canonicalJson({
          selectionKey: receipt.attempt.selectionKey,
          revision: receipt.attempt.revision,
          requestDigest: receipt.attempt.requestDigest,
        }),
      );
      if (
        receipt.attempt.policy.id !== request.selectionPolicy.id ||
        receipt.attempt.policy.digest !== request.selectionPolicy.digest ||
        receipt.attempt.modelProfile.id !== request.modelProfile.id ||
        receipt.attempt.modelProfile.digest !== request.modelProfile.digest
      ) {
        throw new TargetBatchApprovalError("binding-mismatch");
      }
    }
    if (attempts.size !== 1 || request.modelProfile.family !== "opus") {
      throw new TargetBatchApprovalError("binding-mismatch");
    }

    const firstReceipt = request.selectionReceipts[0];
    if (firstReceipt === undefined) {
      throw new TargetBatchApprovalError("selection-attempt-unverified");
    }
    const attemptPath = join(
      this.#storageDirectory,
      "target-selection-attempts",
      `${firstReceipt.attempt.selectionKey}.revision-${firstReceipt.attempt.revision}.json`,
    );
    let attempt;
    try {
      attempt = targetSelectionAttemptSchema.parse(
        JSON.parse((await readFile(attemptPath)).toString("utf8")),
      );
    } catch {
      throw new TargetBatchApprovalError("selection-attempt-unverified");
    }
    if (attempt.status !== "selected") {
      throw new TargetBatchApprovalError("selection-attempt-unverified");
    }
    const actualAttemptDigest = sha256Digest(attempt);
    if (
      request.selectionAttemptRef.digest !== actualAttemptDigest ||
      request.selectionAttemptRef.id !==
        `selection-attempt:${actualAttemptDigest.slice(7, 31)}` ||
      attempt.requestDigest !== sha256Digest(attempt.input) ||
      canonicalJson(attempt.input.policy) !==
        canonicalJson(request.selectionPolicy) ||
      canonicalJson(attempt.input.modelProfile) !==
        canonicalJson(request.modelProfile)
    ) {
      throw new TargetBatchApprovalError("selection-attempt-unverified");
    }
    const durableReceipts = new Map(
      attempt.receipts.map((receipt) => [receipt.candidateId, receipt]),
    );
    if (
      durableReceipts.size !== request.selectionReceipts.length ||
      request.selectionReceipts.some((receipt) => {
        const durable = durableReceipts.get(receipt.candidateId);
        return (
          durable === undefined ||
          canonicalJson(durable) !== canonicalJson(receipt)
        );
      })
    ) {
      throw new TargetBatchApprovalError("selection-attempt-unverified");
    }
  }

  #validateDecisions(request: TargetBatchApprovalRequest): void {
    const receiptIds = request.selectionReceipts.map(
      (receipt) => receipt.candidateId,
    );
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
      request.selectionReceipts.map((receipt) => [
        receipt.candidateId,
        receipt,
      ]),
    );
    for (const decision of approved) {
      const receipt = receipts.get(decision.candidateId);
      if (receipt === undefined || receipt.hardGate.status !== "passed") {
        throw new TargetBatchApprovalError("hard-gate-failed");
      }
      if (
        decision.source === "autonomous-selection" &&
        receipt.decision !== "selected"
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
      previous = await this.inspect(request.supersedes);
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
