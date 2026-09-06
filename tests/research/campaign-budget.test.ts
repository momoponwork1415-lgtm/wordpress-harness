import { describe, expect, it } from "vitest";

import {
  campaignBudgetExhaustionDimensions,
  zeroCampaignBudgetAmount,
} from "../../src/research/campaign-control/campaign-budget.js";
import {
  campaignAttemptBudgetReservationSchema,
  campaignBudgetViewSchema,
} from "../../src/research/campaign-control/contracts.js";

const digest = `sha256:${"a".repeat(64)}`;

describe("Campaign budget owner reserves", () => {
  it("keeps every Validation dimension available after Exploration overshoots v7 totals", () => {
    const zero = zeroCampaignBudgetAmount();
    const reservation = campaignAttemptBudgetReservationSchema.parse({
      kind: "campaign-attempt-budget-reservation",
      schemaVersion: 1,
      campaignId: "campaign-budget-owner-reserve",
      runId: "run-budget-owner-reserve",
      attemptId: "validator-budget-owner-reserve",
      attemptPlanDigest: digest,
      owner: "validation",
      role: "validator",
      amount: {
        ...zero,
        modelAttempts: 1,
        modelWallTimeMs: 1_800_000,
        modelTokens: 100_000,
        estimatedCostUsd: 7.5,
      },
    });
    const common = {
      kind: "budget" as const,
      campaignId: reservation.campaignId,
      runId: reservation.runId,
      ledgerHead: 1,
      policy: { id: "semantic-research-recall-baseline-v7", digest },
      enforcement: {
        modelAttempts: "hard-precondition" as const,
        modelWallTimeMs: "hard-precondition" as const,
        estimatedCostUsd: "hard-precondition" as const,
        modelTokens: "reported-postcondition" as const,
        modelTurns: "reported-postcondition" as const,
      },
      limits: {
        modelAttempts: 128,
        modelWallTimeMs: 43_200_000,
        modelTokens: 4_600_000,
        estimatedCostUsd: 150,
      },
      spent: zero,
      reserved: zero,
      activeReservations: [],
      remaining: {
        modelAttempts: 32,
        modelWallTimeMs: 0,
        modelTokens: 0,
        estimatedCostUsd: 0,
      },
      owners: {
        exploration: {
          limits: {
            modelWallTimeMs: 36_000_000,
            modelTokens: 4_200_000,
            estimatedCostUsd: 120,
          },
          spent: zero,
          reserved: zero,
          remaining: {
            modelWallTimeMs: 0,
            modelTokens: 0,
            estimatedCostUsd: 0,
          },
        },
        validation: {
          limits: {
            modelWallTimeMs: 7_200_000,
            modelTokens: 400_000,
            estimatedCostUsd: 30,
          },
          spent: zero,
          reserved: zero,
          remaining: {
            modelWallTimeMs: 7_200_000,
            modelTokens: 400_000,
            estimatedCostUsd: 30,
          },
        },
      },
      unknownUsageAttemptIds: [],
      overshoot: {
        modelWallTimeMs: 7_200_000,
        modelTokens: 400_000,
        estimatedCostUsd: 30,
      },
    };
    const current = campaignBudgetViewSchema.parse({
      ...common,
      schemaVersion: 2,
      protectedReservations: [],
    });
    const legacy = campaignBudgetViewSchema.parse({
      ...common,
      schemaVersion: 1,
      policy: { id: "semantic-research-recall-baseline-v6", digest },
    });

    expect(campaignBudgetExhaustionDimensions(current, reservation)).toEqual(
      [],
    );
    expect(campaignBudgetExhaustionDimensions(legacy, reservation)).toEqual([
      "model-wall-time",
      "model-tokens",
      "provider-cost",
    ]);
  });
});
