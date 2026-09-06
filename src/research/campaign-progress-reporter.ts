import type { CampaignProgressView } from "./campaign-progress-contracts.js";
import type { CampaignReader } from "./contracts.js";

export interface OpenCampaignProgressReporterOptions {
  readonly campaignId: string;
  readonly reader: CampaignReader;
  readonly write: (line: string) => void | Promise<void>;
  readonly onDiagnostic?: (message: string) => void;
  readonly pollIntervalMs?: number;
  readonly heartbeatIntervalMs?: number;
}

export interface CampaignProgressReporter {
  run<T>(work: () => Promise<T>): Promise<T>;
}

function requirePositiveInterval(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0 || value > 60_000) {
    throw new Error(`${label} must be an integer from 1 to 60000`);
  }
  return value;
}

export function formatCampaignProgress(progress: CampaignProgressView): string {
  const roles = new Map<string, number>();
  for (const attempt of progress.activeAttempts) {
    roles.set(attempt.role, (roles.get(attempt.role) ?? 0) + 1);
  }
  const activeRoles = [...roles]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([role, count]) => `${role}:${count}`)
    .join(",");
  const attempts = progress.counts.attempts;
  const checkpoints = progress.counts.checkpoints;
  const verifications = progress.counts.verifications;
  if (progress.schemaVersion === 2) {
    const validations = progress.counts.validations;
    return [
      "[research]",
      `status=${progress.status}`,
      `head=${progress.ledgerHead}`,
      `last=${progress.lastDurableEvent.kind}`,
      `attempts=${attempts.completed}/${attempts.started}`,
      `active=${activeRoles.length === 0 ? "none" : activeRoles}`,
      `checkpoints=${checkpoints.total}`,
      `hypotheses=${checkpoints.hypotheses}`,
      `validations=${validations.completed}/${validations.started}`,
      `validation-active=${validations.active}`,
      `findings=${progress.counts.findings}`,
      `source-validated=${validations.sourceValidated}`,
      `needs-research=${validations.needsResearch}`,
      `disproven=${validations.disproven}`,
      `pending=${validations.pending}`,
      `legacy-verifications=${verifications.completed}/${verifications.started}`,
      `legacy-findings=${verifications.finding}`,
      `legacy-blocked=${verifications.blocked}`,
      `depth=${progress.counts.depthIterations}`,
      `tokens=${progress.usage.modelTokens.total}`,
      `cost-usd=${progress.usage.estimatedCostUsd.toFixed(6)}`,
    ].join(" ");
  }
  return [
    "[research]",
    `status=${progress.status}`,
    `head=${progress.ledgerHead}`,
    `last=${progress.lastDurableEvent.kind}`,
    `attempts=${attempts.completed}/${attempts.started}`,
    `active=${activeRoles.length === 0 ? "none" : activeRoles}`,
    `checkpoints=${checkpoints.total}`,
    `hypotheses=${checkpoints.hypotheses}`,
    `verifications=${verifications.completed}/${verifications.started}`,
    `findings=${verifications.finding}`,
    `blocked=${verifications.blocked}`,
    `depth=${progress.counts.depthIterations}`,
    `tokens=${progress.usage.modelTokens.total}`,
    `cost-usd=${progress.usage.estimatedCostUsd.toFixed(6)}`,
  ].join(" ");
}

class PollingCampaignProgressReporter implements CampaignProgressReporter {
  readonly #options: OpenCampaignProgressReporterOptions;
  readonly #pollIntervalMs: number;
  readonly #heartbeatIntervalMs: number;
  #sinkAvailable = true;
  #diagnosticEmitted = false;
  #lastLedgerHead: number | undefined;
  #lastWriteAt = 0;

  constructor(options: OpenCampaignProgressReporterOptions) {
    this.#options = options;
    this.#pollIntervalMs = requirePositiveInterval(
      options.pollIntervalMs ?? 1_000,
      "Progress poll interval",
    );
    this.#heartbeatIntervalMs = requirePositiveInterval(
      options.heartbeatIntervalMs ?? 25_000,
      "Progress heartbeat interval",
    );
    if (this.#pollIntervalMs > this.#heartbeatIntervalMs) {
      throw new Error(
        "Progress poll interval must not exceed heartbeat interval",
      );
    }
  }

  async run<T>(work: () => Promise<T>): Promise<T> {
    await this.#poll("update", true);
    let pending = Promise.resolve();
    const interval = setInterval(() => {
      pending = pending.then(() => this.#poll("heartbeat", false));
    }, this.#pollIntervalMs);
    interval.unref();
    try {
      return await work();
    } finally {
      clearInterval(interval);
      await pending;
      await this.#poll("final", true);
    }
  }

  async #poll(
    reason: "update" | "heartbeat" | "final",
    force: boolean,
  ): Promise<void> {
    if (!this.#sinkAvailable) return;
    try {
      const subject = await this.#options.reader.inspect(
        this.#options.campaignId,
        { kind: "progress" },
      );
      if (subject.kind !== "progress") {
        throw new Error("Campaign Reader returned a non-progress view");
      }
      const now = Date.now();
      const changed = subject.ledgerHead !== this.#lastLedgerHead;
      const heartbeatDue = now - this.#lastWriteAt >= this.#heartbeatIntervalMs;
      if (!force && !changed && !heartbeatDue) return;
      const label = changed ? "update" : reason;
      await this.#options.write(
        `${formatCampaignProgress(subject)} ${label}\n`,
      );
      this.#lastLedgerHead = subject.ledgerHead;
      this.#lastWriteAt = now;
    } catch (error: unknown) {
      this.#sinkAvailable = false;
      this.#diagnose(error);
    }
  }

  #diagnose(error: unknown): void {
    if (this.#diagnosticEmitted) return;
    this.#diagnosticEmitted = true;
    const message = `Campaign progress reporting disabled: ${
      error instanceof Error ? error.message : String(error)
    }`;
    try {
      this.#options.onDiagnostic?.(message);
    } catch {
      // Observability must not change the research process.
    }
  }
}

export function openCampaignProgressReporter(
  options: OpenCampaignProgressReporterOptions,
): CampaignProgressReporter {
  return new PollingCampaignProgressReporter(options);
}
