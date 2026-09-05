import { describe, expect, it } from "vitest";

import {
  formatCampaignProgress,
  openCampaignProgressReporter,
  type CampaignProgressView,
  type CampaignReader,
} from "../../src/research/index.js";

function progress(ledgerHead: number): CampaignProgressView {
  return {
    kind: "progress",
    schemaVersion: 1,
    campaignId: "campaign-progress-test",
    status: "running",
    ledgerHead,
    counts: {
      runs: { started: 1, completed: 0, active: 1 },
      attempts: { started: 1, completed: 0, active: 1 },
      checkpoints: {
        total: 0,
        hypotheses: 0,
        routeFragments: 0,
        frontierGaps: 0,
      },
      verifications: {
        started: 0,
        completed: 0,
        active: 0,
        finding: 0,
        disproved: 0,
        blocked: 0,
      },
      depthIterations: 0,
    },
    activeAttempts: [
      {
        attemptId: "attempt-progress-test",
        role: "finder",
        startedAt: "2026-09-05T00:00:00.000Z",
      },
    ],
    activeVerifications: [],
    usage: {
      measurement: "partial",
      modelAttempts: 0,
      reportedModelAttempts: 0,
      modelTurns: 0,
      modelTokens: {
        input: 0,
        cacheCreation: 0,
        cacheRead: 0,
        output: 0,
        total: 0,
      },
      estimatedCostUsd: 0,
      source: { queries: 0, scanBytes: 0, responseBytes: 0 },
    },
    lastDurableEvent: {
      sequence: ledgerHead,
      kind: "campaign.attempt-started",
      occurredAt: "2026-09-05T00:00:00.000Z",
    },
  };
}

describe("Campaign progress reporting", () => {
  it("emits changed Ledger state and heartbeats without changing work outcome", async () => {
    let current = progress(2);
    const lines: string[] = [];
    const reader = {
      inspect: async () => current,
    } as unknown as CampaignReader;
    const reporter = openCampaignProgressReporter({
      campaignId: current.campaignId,
      reader,
      pollIntervalMs: 5,
      heartbeatIntervalMs: 10,
      write: (line) => {
        lines.push(line);
      },
    });

    const result = await reporter.run(async () => {
      await new Promise((resolve) => setTimeout(resolve, 12));
      current = progress(3);
      await new Promise((resolve) => setTimeout(resolve, 30));
      return "research-result";
    });

    expect(result).toBe("research-result");
    expect(lines.some((line) => line.includes("head=2"))).toBe(true);
    expect(lines.some((line) => line.includes("head=3"))).toBe(true);
    expect(lines.some((line) => line.includes("heartbeat"))).toBe(true);
    expect(formatCampaignProgress(progress(3))).toBe(
      formatCampaignProgress(progress(3)),
    );
  });

  it("keeps research successful when the output sink fails", async () => {
    const diagnostics: string[] = [];
    const current = progress(2);
    const reader = {
      inspect: async () => current,
    } as unknown as CampaignReader;
    const reporter = openCampaignProgressReporter({
      campaignId: current.campaignId,
      reader,
      pollIntervalMs: 5,
      heartbeatIntervalMs: 10,
      write: () => {
        throw new Error("simulated progress sink failure");
      },
      onDiagnostic: (message) => {
        diagnostics.push(message);
      },
    });

    await expect(reporter.run(async () => "research-result")).resolves.toBe(
      "research-result",
    );
    expect(diagnostics).toEqual([
      expect.stringContaining("simulated progress sink failure"),
    ]);
  });
});
