import { describe, expect, it } from "vitest";

import {
  campaignProgressViewV2Schema,
  formatCampaignProgress,
  openCampaignProgressReporter,
  type CampaignProgressView,
  type CampaignProgressViewV1,
  type CampaignProgressViewV2,
  type CampaignReader,
} from "../../src/research/index.js";

function progress(ledgerHead: number): CampaignProgressViewV1 {
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

function currentProgress(ledgerHead: number): CampaignProgressViewV2 {
  return {
    ...progress(ledgerHead),
    schemaVersion: 2,
    counts: {
      runs: { started: 1, completed: 1, active: 0 },
      attempts: { started: 1, completed: 1, active: 0 },
      checkpoints: {
        total: 2,
        hypotheses: 1,
        routeFragments: 1,
        frontierGaps: 0,
      },
      verifications: {
        started: 4,
        completed: 4,
        active: 0,
        finding: 3,
        disproved: 1,
        blocked: 0,
      },
      validations: {
        started: 5,
        completed: 4,
        active: 1,
        sourceValidated: 1,
        needsResearch: 1,
        disproven: 0,
        pending: 2,
      },
      findings: 1,
      depthIterations: 1,
    },
    activeAttempts: [],
    activeValidations: [
      {
        validationId: "validation-progress-test",
        startedAt: "2026-09-05T00:00:01.000Z",
      },
    ],
  };
}

function readerFor(readProgress: () => CampaignProgressView): CampaignReader {
  return {
    read: async () => {
      throw new Error("Campaign view is not used by the progress reporter");
    },
    inspect: async () => readProgress(),
  };
}

describe("Campaign progress reporting", () => {
  it("preserves the exact V1 progress line", () => {
    expect(formatCampaignProgress(progress(3))).toBe(
      "[research] status=running head=3 last=campaign.attempt-started attempts=0/1 active=finder:1 checkpoints=0 hypotheses=0 verifications=0/0 findings=0 blocked=0 depth=0 tokens=0 cost-usd=0.000000",
    );
  });

  it("separates current V2 findings and dispositions from legacy counters", () => {
    expect(formatCampaignProgress(currentProgress(3))).toBe(
      "[research] status=running head=3 last=campaign.attempt-started attempts=1/1 active=none checkpoints=2 hypotheses=1 validations=4/5 validation-active=1 findings=1 source-validated=1 needs-research=1 disproven=0 pending=2 legacy-verifications=4/4 legacy-findings=3 legacy-blocked=0 depth=1 tokens=0 cost-usd=0.000000",
    );
  });

  it("emits changed Ledger state and heartbeats without changing work outcome", async () => {
    let current = progress(2);
    const lines: string[] = [];
    const reader = readerFor(() => current);
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
  });

  it("includes current source validation and Finding counts in the final line", async () => {
    const lines: string[] = [];
    const initial = currentProgress(3);
    const current: CampaignProgressViewV2 = {
      ...initial,
      counts: {
        ...initial.counts,
        validations: {
          started: 1,
          completed: 1,
          active: 0,
          sourceValidated: 1,
          needsResearch: 0,
          disproven: 0,
          pending: 0,
        },
      },
      activeValidations: [],
    };
    const reporter = openCampaignProgressReporter({
      campaignId: current.campaignId,
      reader: readerFor(() => current),
      pollIntervalMs: 60_000,
      heartbeatIntervalMs: 60_000,
      write: (line) => {
        lines.push(line);
      },
    });

    await reporter.run(async () => undefined);

    expect(lines.at(-1)).toContain(
      "validations=1/1 validation-active=0 findings=1 source-validated=1 needs-research=0 disproven=0 pending=0",
    );
    expect(lines.at(-1)).toMatch(/ final\n$/);
  });

  it("keeps research successful when the output sink fails", async () => {
    const diagnostics: string[] = [];
    const current = progress(2);
    const reporter = openCampaignProgressReporter({
      campaignId: current.campaignId,
      reader: readerFor(() => current),
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

  it("rejects inconsistent V2 counters and private validation fields", () => {
    const valid = currentProgress(3);
    const inconsistentCounts: unknown = {
      ...valid,
      counts: {
        ...valid.counts,
        validations: { ...valid.counts.validations, pending: 1 },
      },
    };
    const privateValidationField: unknown = {
      ...valid,
      activeValidations: [
        {
          validationId: "validation-progress-test",
          startedAt: "2026-09-05T00:00:01.000Z",
          privateEvidence: "must not cross the progress contract",
        },
      ],
    };

    expect(campaignProgressViewV2Schema.safeParse(valid).success).toBe(true);
    expect(
      campaignProgressViewV2Schema.safeParse(inconsistentCounts).success,
    ).toBe(false);
    expect(
      campaignProgressViewV2Schema.safeParse(privateValidationField).success,
    ).toBe(false);
  });
});
