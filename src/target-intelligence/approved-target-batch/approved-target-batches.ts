import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { canonicalDigest } from "../../infrastructure/canonical-json.js";
import { canonicalJson } from "../acquisition/canonical-json.js";
import {
  isCurrentTargetCandidate,
  type TargetCandidate,
} from "../candidate-pool/index.js";
import { resolveTargetProposal } from "../target-proposal/index.js";
import {
  approvedTargetBatchRefSchema,
  approvedTargetBatchRequestSchema,
  approvedTargetBatchSchema,
  targetDispatchAdmissionRequestSchema,
  targetDispatchAdmissionSchema,
  type ApprovedTargetBatch,
  type ApprovedTargetBatchRef,
  type ApprovedTargetBatchRequest,
  type ApprovedTargetBatches,
  type OpenApprovedTargetBatchesOptions,
  type TargetDispatchAdmissionRequest,
} from "./contracts.js";

function hasErrorCode(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === code
  );
}

export type ApprovedTargetBatchErrorCode =
  | "proposal-unavailable"
  | "binding-mismatch"
  | "approval-invalid"
  | "hard-gate-failed"
  | "budget-exceeded"
  | "revision-conflict";

export class ApprovedTargetBatchError extends Error {
  constructor(readonly code: ApprovedTargetBatchErrorCode) {
    super(`Approved Target Batch ${code}`);
    this.name = "ApprovedTargetBatchError";
  }
}

export function approvedTargetBatchReference(
  batch: ApprovedTargetBatch,
): ApprovedTargetBatchRef {
  return approvedTargetBatchRefSchema.parse({
    kind: "approved-target-batch-ref",
    schemaVersion: 3,
    id: batch.id,
    digest: batch.digest,
    batchKey: batch.batchKey,
    revision: batch.revision,
  });
}

export function admitTargetDispatch(
  batchValue: ApprovedTargetBatch,
  requestValue: TargetDispatchAdmissionRequest,
) {
  const batch = approvedTargetBatchSchema.parse(batchValue);
  const request = targetDispatchAdmissionRequestSchema.parse(requestValue);
  const { id: _id, digest: _digest, ...batchBody } = batch;
  if (
    batch.digest !== canonicalDigest(batchBody) ||
    request.batchRef.id !== batch.id ||
    request.batchRef.digest !== batch.digest ||
    request.batchRef.batchKey !== batch.batchKey ||
    request.batchRef.revision !== batch.revision
  ) {
    throw new ApprovedTargetBatchError("binding-mismatch");
  }
  const approved = batch.approvedTargets.find(
    (target) => target.candidateId === request.candidateId,
  );
  if (
    approved === undefined ||
    canonicalJson(approved.candidate.target) !== canonicalJson(request.target)
  ) {
    throw new ApprovedTargetBatchError("binding-mismatch");
  }
  const checkedAt = Date.parse(request.checkedAt);
  if (
    checkedAt < Date.parse(batch.executionWindow.startsAt) ||
    checkedAt > Date.parse(batch.executionWindow.endsAt) ||
    Date.parse(request.targetObservation.retrievedAt) > checkedAt ||
    request.targetObservation.acquisition !== "available" ||
    request.targetObservation.provenance !== "verified" ||
    request.targetObservation.identity !== "verified" ||
    Date.parse(request.targetObservation.currentUntil) < checkedAt
  ) {
    throw new ApprovedTargetBatchError("hard-gate-failed");
  }
  const body = {
    kind: "target-dispatch-admission" as const,
    schemaVersion: 1 as const,
    batchRef: request.batchRef,
    candidateId: request.candidateId,
    target: request.target,
    targetObservation: request.targetObservation,
    checkedAt: request.checkedAt,
  };
  const digest = canonicalDigest(body);
  return targetDispatchAdmissionSchema.parse({
    ...body,
    id: `target-dispatch:${digest.slice(7, 31)}`,
    digest,
  });
}

class FileApprovedTargetBatches implements ApprovedTargetBatches {
  readonly #options: OpenApprovedTargetBatchesOptions;
  readonly #clock: () => Date;

  constructor(options: OpenApprovedTargetBatchesOptions) {
    this.#options = options;
    this.#clock = options.clock ?? (() => new Date());
  }

  async approve(
    requestValue: ApprovedTargetBatchRequest,
  ): Promise<ApprovedTargetBatchRef> {
    const request = approvedTargetBatchRequestSchema.parse(
      JSON.parse(canonicalJson(requestValue)),
    );
    const approvalInputDigest = canonicalDigest(request);
    const path = this.#path(request);
    const existing = await this.#read(path);
    if (existing !== undefined) {
      if (existing.approvalInputDigest !== approvalInputDigest) {
        throw new ApprovedTargetBatchError("revision-conflict");
      }
      return approvedTargetBatchReference(existing);
    }

    const resolution = resolveTargetProposal(
      await this.#options.proposals
        .inspect({
          selectionKey: request.proposalRef.selectionKey,
          revision: request.proposalRef.revision,
        })
        .catch(() => undefined),
      request.proposalRef,
    );
    if (resolution.status !== "resolved") {
      throw new ApprovedTargetBatchError(
        resolution.status === "unavailable"
          ? "proposal-unavailable"
          : "binding-mismatch",
      );
    }
    const { proposal, candidatePool } = resolution;
    if (
      Date.parse(request.operator.decidedAt) < Date.parse(proposal.proposedAt)
    ) {
      throw new ApprovedTargetBatchError("binding-mismatch");
    }

    const poolCandidates = new Map(
      candidatePool.candidates.map((candidate) => [
        candidate.candidateId,
        candidate,
      ]),
    );
    const selectable = new Map<
      string,
      | {
          readonly source: "agent-proposal";
          readonly candidate: TargetCandidate;
          readonly proposalReason: string;
          readonly proposalUncertainty: string;
        }
      | {
          readonly source: "operator-nomination";
          readonly candidate: TargetCandidate;
          readonly nominationReason: string;
        }
    >();
    for (const proposed of proposal.targets) {
      selectable.set(proposed.candidateId, {
        source: "agent-proposal",
        candidate: proposed.candidate,
        proposalReason: proposed.reason,
        proposalUncertainty: proposed.uncertainty,
      });
    }
    for (const nomination of request.nominations) {
      const candidate = poolCandidates.get(nomination.candidateId);
      if (candidate === undefined || selectable.has(nomination.candidateId)) {
        throw new ApprovedTargetBatchError("approval-invalid");
      }
      selectable.set(nomination.candidateId, {
        source: "operator-nomination",
        candidate,
        nominationReason: nomination.reason,
      });
    }

    const decisions = new Map(
      request.decisions.map((decision) => [decision.candidateId, decision]),
    );
    if (
      decisions.size !== request.decisions.length ||
      decisions.size !== selectable.size ||
      [...decisions.keys()].some((candidateId) => !selectable.has(candidateId))
    ) {
      throw new ApprovedTargetBatchError("approval-invalid");
    }
    const approvedIds = request.decisions
      .filter((decision) => decision.decision === "approve")
      .map((decision) => decision.candidateId);
    if (
      approvedIds.length === 0 ||
      approvedIds.length > request.batchBudget.maxTargets ||
      request.approvedOrder.length !== approvedIds.length ||
      new Set(request.approvedOrder).size !== request.approvedOrder.length ||
      request.approvedOrder.some(
        (candidateId) => !approvedIds.includes(candidateId),
      )
    ) {
      throw new ApprovedTargetBatchError(
        approvedIds.length > request.batchBudget.maxTargets
          ? "budget-exceeded"
          : "approval-invalid",
      );
    }

    const decidedAt = Date.parse(request.operator.decidedAt);
    if (
      request.approvedOrder.some((candidateId) => {
        const selected = selectable.get(candidateId);
        return (
          selected === undefined ||
          !isCurrentTargetCandidate(selected.candidate, decidedAt)
        );
      })
    ) {
      throw new ApprovedTargetBatchError("hard-gate-failed");
    }

    const approvedTargets = request.approvedOrder.map((candidateId) => {
      const selected = selectable.get(candidateId);
      const decision = decisions.get(candidateId);
      if (selected === undefined || decision === undefined) {
        throw new ApprovedTargetBatchError("approval-invalid");
      }
      return selected.source === "agent-proposal"
        ? {
            candidateId,
            candidate: selected.candidate,
            source: selected.source,
            proposalReason: selected.proposalReason,
            proposalUncertainty: selected.proposalUncertainty,
            humanReason: decision.reason,
          }
        : {
            candidateId,
            candidate: selected.candidate,
            source: selected.source,
            nominationReason: selected.nominationReason,
            humanReason: decision.reason,
          };
    });
    const excludedTargets = request.decisions
      .filter((decision) => decision.decision === "exclude")
      .map((decision) => ({
        candidateId: decision.candidateId,
        humanReason: decision.reason,
      }));
    const approvedAt = this.#clock().toISOString();
    const body = {
      kind: "approved-target-batch" as const,
      schemaVersion: 3 as const,
      approvalInputDigest,
      batchKey: request.batchKey,
      revision: request.revision,
      proposalRef: request.proposalRef,
      campaignPolicy: request.campaignPolicy,
      batchBudget: request.batchBudget,
      executionWindow: request.executionWindow,
      operator: request.operator,
      decisions: request.decisions,
      approvedOrder: request.approvedOrder,
      approvedTargets,
      excludedTargets,
      externalAction: "not-authorized" as const,
      approvedAt,
    };
    const digest = canonicalDigest(body);
    const batch = approvedTargetBatchSchema.parse({
      ...body,
      id: `approved-target-batch:${digest.slice(7, 31)}`,
      digest,
    });

    await mkdir(
      join(this.#options.storageDirectory, "approved-target-batches-v3"),
      {
        recursive: true,
      },
    );
    try {
      await writeFile(path, canonicalJson(batch), { flag: "wx" });
    } catch (error) {
      if (!hasErrorCode(error, "EEXIST")) throw error;
      const raced = await this.#read(path);
      if (
        raced === undefined ||
        raced.approvalInputDigest !== approvalInputDigest
      ) {
        throw new ApprovedTargetBatchError("revision-conflict");
      }
      return approvedTargetBatchReference(raced);
    }
    return approvedTargetBatchReference(batch);
  }

  async inspect(refValue: ApprovedTargetBatchRef) {
    const ref = approvedTargetBatchRefSchema.parse(refValue);
    const batch = await this.#read(this.#path(ref));
    if (
      batch === undefined ||
      batch.id !== ref.id ||
      batch.digest !== ref.digest
    ) {
      throw new ApprovedTargetBatchError("binding-mismatch");
    }
    const { id: _id, digest: _digest, ...body } = batch;
    if (batch.digest !== canonicalDigest(body)) {
      throw new ApprovedTargetBatchError("binding-mismatch");
    }
    return batch;
  }

  async admitDispatch(requestValue: TargetDispatchAdmissionRequest) {
    const request = targetDispatchAdmissionRequestSchema.parse(requestValue);
    const batch = await this.inspect(request.batchRef);
    return admitTargetDispatch(batch, request);
  }

  #path(input: { readonly batchKey: string; readonly revision: number }) {
    return join(
      this.#options.storageDirectory,
      "approved-target-batches-v3",
      `${input.batchKey}.revision-${input.revision}.json`,
    );
  }

  async #read(path: string): Promise<ApprovedTargetBatch | undefined> {
    try {
      return approvedTargetBatchSchema.parse(
        JSON.parse(await readFile(path, "utf8")),
      );
    } catch (error) {
      if (hasErrorCode(error, "ENOENT")) return undefined;
      throw error;
    }
  }
}

export function openApprovedTargetBatches(
  options: OpenApprovedTargetBatchesOptions,
): ApprovedTargetBatches {
  return new FileApprovedTargetBatches(options);
}
