import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { canonicalDigest } from "../../infrastructure/canonical-json.js";
import { canonicalJson } from "../acquisition/canonical-json.js";
import { isCurrentTargetCandidate } from "../candidate-pool/candidate-pools.js";
import {
  targetProposalRefSchema,
  targetProposalRunReceiptSchema,
  targetProposalSchema,
  targetSelectionRunInputSchema,
  targetSelectionRunSchema,
  type OpenTargetProposalsOptions,
  type SealedTargetSelectionRun,
  type TargetProposal,
  type TargetProposalOutcomeRef,
  type TargetProposalQuery,
  type TargetProposalRef,
  type TargetProposalResolution,
  type TargetProposalRunReceipt,
  type TargetProposals,
  type TargetProposalView,
  type TargetSelectionRun,
  type TargetSelectionRunInput,
} from "./contracts.js";

function hasErrorCode(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === code
  );
}

type FailedReceipt = Extract<
  TargetProposalRunReceipt,
  {
    readonly terminal: Exclude<
      TargetProposalRunReceipt["terminal"],
      "completed"
    >;
  }
>;

function failedReceipt(
  run: SealedTargetSelectionRun,
  terminal: FailedReceipt["terminal"],
  summary: string,
  startedAt: Date,
  completedAt: Date,
  observed?: TargetProposalRunReceipt,
): FailedReceipt {
  return {
    schemaVersion: 1,
    runId: run.runId,
    runtimeProfileDigest: run.agentRuntimeProfile.digest,
    terminal,
    startedAt: startedAt.toISOString(),
    completedAt: completedAt.toISOString(),
    usage:
      observed?.usage ??
      ({
        wallTimeMs: Math.max(0, completedAt.getTime() - startedAt.getTime()),
      } as const),
    activity: observed?.activity ?? { subagents: null, tools: null },
    failure: { summary },
  };
}

function proposalRef(proposal: TargetProposal) {
  return targetProposalRefSchema.parse({
    kind: "target-proposal-ref",
    schemaVersion: 1,
    id: proposal.id,
    digest: proposal.digest,
    selectionKey: proposal.selectionKey,
    revision: proposal.revision,
  });
}

export function resolveTargetProposal(
  view: TargetProposalView | undefined,
  reference: TargetProposalRef,
): TargetProposalResolution {
  if (view?.status !== "proposed" || view.proposal === undefined) {
    return { status: "unavailable" };
  }
  const parsedProposal = targetProposalSchema.safeParse(view.proposal);
  const parsedRun = targetSelectionRunSchema.safeParse(view.run);
  if (
    !parsedProposal.success ||
    !parsedRun.success ||
    parsedRun.data.status !== "proposed"
  ) {
    return { status: "conflict" };
  }
  const proposal = parsedProposal.data;
  const run = parsedRun.data;
  const { id: _id, digest: _digest, ...body } = proposal;
  if (
    proposal.id !== reference.id ||
    proposal.digest !== reference.digest ||
    proposal.digest !== canonicalDigest(body) ||
    run.inputDigest !== canonicalDigest(run.input) ||
    run.proposal.id !== proposal.id ||
    run.proposal.digest !== proposal.digest ||
    proposal.inputDigest !== run.inputDigest ||
    proposal.selectionKey !== run.input.selectionKey ||
    proposal.revision !== run.input.revision ||
    proposal.candidatePool.id !== run.input.candidatePool.id ||
    proposal.candidatePool.digest !== run.input.candidatePool.digest
  ) {
    return { status: "conflict" };
  }
  const candidates = new Map(
    run.input.candidatePool.candidates.map((candidate) => [
      candidate.candidateId,
      candidate,
    ]),
  );
  for (const proposed of proposal.targets) {
    const candidate = candidates.get(proposed.candidateId);
    if (
      candidate === undefined ||
      canonicalJson(candidate) !== canonicalJson(proposed.candidate)
    ) {
      return { status: "conflict" };
    }
  }
  return {
    status: "resolved",
    proposal,
    candidatePool: run.input.candidatePool,
  };
}

function outcome(run: TargetSelectionRun): TargetProposalOutcomeRef {
  return {
    kind: "target-proposal-outcome-ref",
    schemaVersion: 1,
    status: run.status === "proposed" ? "proposed" : "selection-pending",
    selectionKey: run.input.selectionKey,
    revision: run.input.revision,
    inputDigest: run.inputDigest,
    ...(run.status === "proposed"
      ? { proposalRef: proposalRef(run.proposal) }
      : {}),
  };
}

export class TargetProposalNotFoundError extends Error {
  constructor(
    readonly selectionKey: string,
    readonly revision: number,
  ) {
    super(
      `Target Selection Run not found: ${selectionKey} revision ${revision}`,
    );
    this.name = "TargetProposalNotFoundError";
  }
}

class FileTargetProposals implements TargetProposals {
  readonly #options: OpenTargetProposalsOptions;
  readonly #clock: () => Date;

  constructor(options: OpenTargetProposalsOptions) {
    this.#options = options;
    this.#clock = options.clock ?? (() => new Date());
  }

  async propose(inputValue: TargetSelectionRunInput) {
    const input = targetSelectionRunInputSchema.parse(
      JSON.parse(canonicalJson(inputValue)),
    );
    const inputDigest = canonicalDigest(input);
    const path = this.#path(input);
    const existing = await this.#read(path);
    if (existing !== undefined) {
      if (existing.inputDigest !== inputDigest) {
        throw new Error("Target Selection Run revision input conflict");
      }
      return outcome(existing);
    }

    const running = targetSelectionRunSchema.parse({
      kind: "target-selection-run",
      schemaVersion: 1,
      status: "running",
      inputDigest,
      input,
      createdAt: this.#clock().toISOString(),
    });
    if (!(await this.#create(path, running))) {
      const raced = await this.#read(path);
      if (raced === undefined || raced.inputDigest !== inputDigest) {
        throw new Error("Target Selection Run creation conflict");
      }
      return outcome(raced);
    }

    const sealedRun: SealedTargetSelectionRun = {
      kind: "sealed-target-selection-run",
      schemaVersion: 1,
      runId: `target-selection:${inputDigest.slice(7, 31)}`,
      inputDigest,
      candidatePool: input.candidatePool,
      selectionGuidance: input.selectionGuidance,
      agentRuntimeProfile: input.agentRuntimeProfile,
      permissionProfile: input.permissionProfile,
      budgetEnvelope: input.budgetEnvelope,
    };
    const startedAt = this.#clock();
    let receipt: TargetProposalRunReceipt;
    try {
      const returned = await this.#options.agent.execute(sealedRun);
      const decoded = targetProposalRunReceiptSchema.safeParse(returned);
      receipt = decoded.success
        ? decoded.data
        : failedReceipt(
            sealedRun,
            "invalid-output",
            "Target Proposal Agent returned an unsupported output schema.",
            startedAt,
            this.#clock(),
          );
    } catch {
      receipt = failedReceipt(
        sealedRun,
        "provider-failed",
        "Target Proposal Agent failed before returning a receipt.",
        startedAt,
        this.#clock(),
      );
    }

    if (
      receipt.runId !== sealedRun.runId ||
      receipt.runtimeProfileDigest !== input.agentRuntimeProfile.digest
    ) {
      receipt = failedReceipt(
        sealedRun,
        "invalid-output",
        "Target Proposal receipt did not match the sealed Run binding.",
        startedAt,
        this.#clock(),
        receipt,
      );
    }
    if (receipt.usage.wallTimeMs > input.budgetEnvelope.maxWallTimeMs) {
      receipt = failedReceipt(
        sealedRun,
        "budget-exhausted",
        "Target Proposal Agent exceeded the sealed Budget Envelope.",
        startedAt,
        this.#clock(),
        receipt,
      );
    }

    if (receipt.terminal === "completed") {
      const candidates = new Map(
        input.candidatePool.candidates.map((candidate) => [
          candidate.candidateId,
          candidate,
        ]),
      );
      const now = this.#clock();
      const selectedCandidates = receipt.report.targets.map((target) =>
        candidates.get(target.candidateId),
      );
      if (
        selectedCandidates.some(
          (candidate) =>
            candidate === undefined ||
            !isCurrentTargetCandidate(candidate, now.getTime()),
        )
      ) {
        receipt = failedReceipt(
          sealedRun,
          "invalid-output",
          "Target Proposal selected a Candidate outside the admitted source pool.",
          startedAt,
          now,
          receipt,
        );
      }
    }

    if (receipt.terminal !== "completed") {
      const pending = targetSelectionRunSchema.parse({
        ...running,
        status: "selection-pending",
        completedAt: this.#clock().toISOString(),
        receipt,
      });
      await this.#replace(path, pending);
      return outcome(pending);
    }

    const candidates = new Map(
      input.candidatePool.candidates.map((candidate) => [
        candidate.candidateId,
        candidate,
      ]),
    );
    const proposedAt = this.#clock().toISOString();
    const body = {
      kind: "target-proposal" as const,
      schemaVersion: 1 as const,
      inputDigest,
      selectionKey: input.selectionKey,
      revision: input.revision,
      candidatePool: {
        id: input.candidatePool.id,
        digest: input.candidatePool.digest,
      },
      selectionGuidance: input.selectionGuidance,
      agentRuntimeProfile: input.agentRuntimeProfile,
      permissionProfile: input.permissionProfile,
      budgetEnvelope: input.budgetEnvelope,
      runId: receipt.runId,
      basis: receipt.report.basis,
      targets: receipt.report.targets.map((target) => ({
        ...target,
        candidate: candidates.get(target.candidateId),
      })),
      proposedAt,
    };
    const digest = canonicalDigest(body);
    const proposal = targetProposalSchema.parse({
      ...body,
      id: `target-proposal:${digest.slice(7, 31)}`,
      digest,
    });
    const proposed = targetSelectionRunSchema.parse({
      ...running,
      status: "proposed",
      completedAt: proposedAt,
      receipt,
      proposal,
    });
    await this.#replace(path, proposed);
    return outcome(proposed);
  }

  async inspect(query: TargetProposalQuery): Promise<TargetProposalView> {
    const run = await this.#read(this.#path(query));
    if (run === undefined) {
      throw new TargetProposalNotFoundError(query.selectionKey, query.revision);
    }
    if (run.inputDigest !== canonicalDigest(run.input)) {
      throw new Error("Target Selection Run input digest mismatch");
    }
    if (run.status === "proposed") {
      const { id: _id, digest: _digest, ...body } = run.proposal;
      if (run.proposal.digest !== canonicalDigest(body)) {
        throw new Error("Target Proposal digest mismatch");
      }
    }
    return {
      ...outcome(run),
      run,
      ...(run.status === "proposed" ? { proposal: run.proposal } : {}),
    };
  }

  #path(query: TargetProposalQuery): string {
    return join(
      this.#options.storageDirectory,
      "target-selection-runs-v1",
      `${query.selectionKey}.revision-${query.revision}.json`,
    );
  }

  async #read(path: string): Promise<TargetSelectionRun | undefined> {
    try {
      return targetSelectionRunSchema.parse(
        JSON.parse(await readFile(path, "utf8")),
      );
    } catch (error) {
      if (hasErrorCode(error, "ENOENT")) return undefined;
      throw error;
    }
  }

  async #create(path: string, run: TargetSelectionRun): Promise<boolean> {
    await mkdir(
      join(this.#options.storageDirectory, "target-selection-runs-v1"),
      {
        recursive: true,
      },
    );
    try {
      await writeFile(path, canonicalJson(run), { flag: "wx" });
      return true;
    } catch (error) {
      if (hasErrorCode(error, "EEXIST")) return false;
      throw error;
    }
  }

  async #replace(path: string, run: TargetSelectionRun): Promise<void> {
    const temporaryPath = `${path}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(temporaryPath, canonicalJson(run), { flag: "wx" });
    await rename(temporaryPath, path);
  }
}

export function openTargetProposals(
  options: OpenTargetProposalsOptions,
): TargetProposals {
  return new FileTargetProposals(options);
}
