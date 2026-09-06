import type { ModelAttemptPlan } from "../model-execution/contracts.js";
import type { ModelAttemptUsageV2 } from "../model-attempt-usage-contracts.js";
import { sha256Digest } from "../research-record/canonical-json.js";
import {
  campaignAttemptBudgetReservationSchema,
  campaignAttemptBudgetSettlementSchema,
  campaignBudgetViewSchema,
  campaignRootEvaluationBudgetReservationSchema,
  isCurrentSemanticResearchBudgetPolicy,
  type CampaignAttemptBudgetReservation,
  type CampaignAttemptBudgetSettlement,
  type CampaignBudgetAmount,
  type CampaignBudgetView,
  type CampaignAttemptIntentV2,
  type CampaignRootEvaluationBudgetReservation,
  type CampaignRunPlanV3,
} from "./contracts.js";

const zeroSource = () => ({ queries: 0, scanBytes: 0, responseBytes: 0 });

export function zeroCampaignBudgetAmount(): CampaignBudgetAmount {
  return {
    modelAttempts: 0,
    modelWallTimeMs: 0,
    modelTurns: 0,
    modelTokens: 0,
    structuredOutputBytes: 0,
    estimatedCostUsd: 0,
    source: zeroSource(),
  };
}

function mapCampaignBudgetAmount(
  left: CampaignBudgetAmount,
  right: CampaignBudgetAmount,
  operation: (left: number, right: number) => number,
): CampaignBudgetAmount {
  return {
    modelAttempts: operation(left.modelAttempts, right.modelAttempts),
    modelWallTimeMs: operation(left.modelWallTimeMs, right.modelWallTimeMs),
    modelTurns: operation(left.modelTurns, right.modelTurns),
    modelTokens: operation(left.modelTokens, right.modelTokens),
    structuredOutputBytes: operation(
      left.structuredOutputBytes,
      right.structuredOutputBytes,
    ),
    estimatedCostUsd: operation(left.estimatedCostUsd, right.estimatedCostUsd),
    source: {
      queries: operation(left.source.queries, right.source.queries),
      scanBytes: operation(left.source.scanBytes, right.source.scanBytes),
      responseBytes: operation(
        left.source.responseBytes,
        right.source.responseBytes,
      ),
    },
  };
}

function addCampaignBudgetAmount(
  left: CampaignBudgetAmount,
  right: CampaignBudgetAmount,
): CampaignBudgetAmount {
  return mapCampaignBudgetAmount(left, right, (a, b) => a + b);
}

function positiveDifference(
  left: CampaignBudgetAmount,
  right: CampaignBudgetAmount,
): CampaignBudgetAmount {
  return mapCampaignBudgetAmount(left, right, (a, b) => Math.max(0, a - b));
}

export function reserveCampaignAttemptBudget(
  campaignId: string,
  runId: string,
  plan: Extract<ModelAttemptPlan, { schemaVersion: 2 }>,
): CampaignAttemptBudgetReservation {
  return campaignAttemptBudgetReservationSchema.parse({
    kind: "campaign-attempt-budget-reservation",
    schemaVersion: 1,
    campaignId,
    runId,
    attemptId: plan.attemptId,
    attemptPlanDigest: sha256Digest(plan),
    owner: plan.owner,
    role: plan.role,
    amount: {
      modelAttempts: 1,
      modelWallTimeMs: plan.budget.maxWallTimeMs,
      modelTurns: plan.budget.maxModelTurns,
      modelTokens: plan.budget.maxModelTokens,
      structuredOutputBytes: plan.budget.maxOutputBytes,
      estimatedCostUsd: plan.budget.maxProviderCostUsd,
      source: {
        queries:
          "maxSourceQueries" in plan.budget ? plan.budget.maxSourceQueries : 0,
        scanBytes:
          "maxSourceScanBytes" in plan.budget
            ? (plan.budget.maxSourceScanBytes ?? 0)
            : 0,
        responseBytes:
          "maxSourceResponseBytes" in plan.budget
            ? (plan.budget.maxSourceResponseBytes ?? 0)
            : 0,
      },
    },
  });
}

export function reserveCampaignRootEvaluationBudget(
  plan: CampaignRunPlanV3,
): CampaignRootEvaluationBudgetReservation {
  if (!isCurrentSemanticResearchBudgetPolicy(plan.budgetPolicy)) {
    throw new Error("Root Evaluation reservation requires budget policy v7");
  }
  const identity = {
    campaignId: plan.campaignId,
    runId: plan.runId,
    budgetPolicyDigest: sha256Digest(plan.budgetPolicy),
    semanticPolicyDigest: sha256Digest(plan.semanticPolicy),
    modelProfileDigest: sha256Digest(plan.evaluator.modelProfile),
    promptSetDigest: sha256Digest(plan.evaluator.promptSet),
    evaluatorBudgetDigest: sha256Digest(plan.evaluator.budget),
  };
  return campaignRootEvaluationBudgetReservationSchema.parse({
    kind: "campaign-root-evaluation-budget-reservation",
    schemaVersion: 1,
    campaignId: plan.campaignId,
    runId: plan.runId,
    reservationId: `root-evaluation-reservation:${sha256Digest(identity).slice("sha256:".length)}`,
    owner: "exploration",
    role: "root-evaluator",
    amount: {
      ...zeroCampaignBudgetAmount(),
      modelTokens:
        plan.budgetPolicy.exploration.rootEvaluationReserve.maxModelTokens,
    },
    bindings: {
      budgetPolicy: {
        id: plan.budgetPolicy.id,
        digest: sha256Digest(plan.budgetPolicy),
      },
      semanticPolicy: {
        id: plan.semanticPolicy.id,
        digest: sha256Digest(plan.semanticPolicy),
      },
      modelProfile: {
        id: plan.evaluator.modelProfile.ref.id,
        refDigest: plan.evaluator.modelProfile.ref.digest,
        configurationDigest: sha256Digest(plan.evaluator.modelProfile),
      },
      promptSet: {
        id: plan.evaluator.promptSet.id,
        digest: plan.evaluator.promptSet.digest,
      },
      evaluatorBudgetDigest: sha256Digest(plan.evaluator.budget),
    },
  });
}

export function reserveUnrecordedCampaignAttemptBudget(
  plan: CampaignRunPlanV3,
  intent: CampaignAttemptIntentV2,
): CampaignAttemptBudgetReservation {
  const budget =
    intent.role === "root-planner"
      ? plan.semanticPolicy.plannerBudget
      : intent.role === "finder"
        ? plan.semanticPolicy.finderLeaseBudget
        : intent.role === "validator"
          ? plan.validation.budget.validator
          : plan.evaluator.budget;
  const sourceBudget =
    intent.role === "root-planner" ||
    intent.role === "finder" ||
    intent.role === "validator" ||
    intent.role === "adversarial-critic"
      ? intent.role === "finder"
        ? plan.semanticPolicy.finderLeaseBudget
        : intent.role === "validator"
          ? plan.validation.budget.validator
          : plan.semanticPolicy.plannerBudget
      : undefined;
  return campaignAttemptBudgetReservationSchema.parse({
    kind: "campaign-attempt-budget-reservation",
    schemaVersion: 1,
    campaignId: intent.campaignId,
    runId: intent.runId,
    attemptId: intent.attemptId,
    attemptPlanDigest: intent.attemptPlanDigest,
    owner: intent.role === "validator" ? "validation" : "exploration",
    role: intent.role,
    amount: {
      modelAttempts: 1,
      modelWallTimeMs: budget.maxWallTimeMs,
      modelTurns: budget.maxModelTurns,
      modelTokens: budget.maxModelTokens,
      structuredOutputBytes: budget.maxOutputBytes,
      estimatedCostUsd: budget.maxProviderCostUsd,
      source: {
        queries: sourceBudget?.maxSourceQueries ?? 0,
        scanBytes: sourceBudget?.maxSourceScanBytes ?? 0,
        responseBytes: sourceBudget?.maxSourceResponseBytes ?? 0,
      },
    },
  });
}

function usageAmount(usage: ModelAttemptUsageV2): CampaignBudgetAmount {
  return {
    modelAttempts: 1,
    modelWallTimeMs: usage.wallTimeMs,
    modelTurns: usage.modelTurns,
    modelTokens: usage.modelTokens.total,
    structuredOutputBytes: usage.structuredOutputBytes,
    estimatedCostUsd: usage.estimatedCostUsd ?? 0,
    source: usage.source,
  };
}

export function settleCampaignAttemptBudget(
  reservation: CampaignAttemptBudgetReservation,
  usage: ModelAttemptUsageV2 | undefined,
): CampaignAttemptBudgetSettlement {
  const unknownDimensions: Array<
    CampaignAttemptBudgetSettlement["unknownDimensions"][number]
  > = [];
  let spent: CampaignBudgetAmount;
  if (usage === undefined) {
    spent = reservation.amount;
    unknownDimensions.push(
      "model-wall-time",
      "model-turns",
      "model-tokens",
      "structured-output",
      "provider-cost",
      "source-usage",
    );
  } else {
    const actual = usageAmount(usage);
    const tokensReported = usage.measurement === "reported";
    const costReported = usage.estimatedCostUsd !== undefined;
    if (!tokensReported) {
      unknownDimensions.push("model-turns", "model-tokens");
    }
    if (!costReported) unknownDimensions.push("provider-cost");
    spent = {
      ...actual,
      modelTurns: tokensReported
        ? actual.modelTurns
        : Math.max(actual.modelTurns, reservation.amount.modelTurns),
      modelTokens: tokensReported
        ? actual.modelTokens
        : Math.max(actual.modelTokens, reservation.amount.modelTokens),
      estimatedCostUsd: costReported
        ? actual.estimatedCostUsd
        : reservation.amount.estimatedCostUsd,
    };
  }
  return campaignAttemptBudgetSettlementSchema.parse({
    kind: "campaign-attempt-budget-settlement",
    schemaVersion: 1,
    campaignId: reservation.campaignId,
    runId: reservation.runId,
    attemptId: reservation.attemptId,
    attemptPlanDigest: reservation.attemptPlanDigest,
    owner: reservation.owner,
    role: reservation.role,
    ...(usage === undefined ? {} : { usage }),
    spent,
    released: positiveDifference(reservation.amount, spent),
    overshoot: positiveDifference(spent, reservation.amount),
    unknownDimensions,
  });
}

export function projectCampaignBudget(input: {
  readonly plan: CampaignRunPlanV3;
  readonly ledgerHead: number;
  readonly reservations: readonly CampaignAttemptBudgetReservation[];
  readonly settlements: readonly CampaignAttemptBudgetSettlement[];
  readonly protectedReservations?: readonly CampaignRootEvaluationBudgetReservation[];
}): CampaignBudgetView {
  const settlements = new Map(
    input.settlements.map((settlement) => [settlement.attemptId, settlement]),
  );
  const activeReservations = input.reservations.filter(
    (reservation) => !settlements.has(reservation.attemptId),
  );
  const protectedReservations = input.protectedReservations ?? [];
  const sum = (amounts: readonly CampaignBudgetAmount[]) =>
    amounts.reduce(addCampaignBudgetAmount, zeroCampaignBudgetAmount());
  const spent = sum(input.settlements.map((settlement) => settlement.spent));
  const reserved = sum(
    [...activeReservations, ...protectedReservations].map(
      (reservation) => reservation.amount,
    ),
  );
  const owner = (ownerName: "exploration" | "validation") => {
    const ownerSpent = sum(
      input.settlements
        .filter((settlement) => settlement.owner === ownerName)
        .map((settlement) => settlement.spent),
    );
    const ownerReserved = sum(
      [...activeReservations, ...protectedReservations]
        .filter((reservation) => reservation.owner === ownerName)
        .map((reservation) => reservation.amount),
    );
    const limits =
      ownerName === "exploration"
        ? input.plan.budgetPolicy.exploration
        : input.plan.budgetPolicy.validationReserve;
    return {
      limits: {
        modelWallTimeMs: limits.maxWallTimeMs,
        modelTokens: limits.maxModelTokens,
        estimatedCostUsd: limits.maxProviderCostUsd,
      },
      spent: ownerSpent,
      reserved: ownerReserved,
      remaining: {
        modelWallTimeMs: Math.max(
          0,
          limits.maxWallTimeMs -
            ownerSpent.modelWallTimeMs -
            ownerReserved.modelWallTimeMs,
        ),
        modelTokens: Math.max(
          0,
          limits.maxModelTokens -
            ownerSpent.modelTokens -
            ownerReserved.modelTokens,
        ),
        estimatedCostUsd: Math.max(
          0,
          limits.maxProviderCostUsd -
            ownerSpent.estimatedCostUsd -
            ownerReserved.estimatedCostUsd,
        ),
      },
    };
  };
  const limits = {
    modelAttempts: input.plan.budgetPolicy.maxModelAttempts,
    modelWallTimeMs: input.plan.budgetPolicy.maxWallTimeMs,
    modelTokens: input.plan.budgetPolicy.maxModelTokens,
    estimatedCostUsd: input.plan.budgetPolicy.maxProviderCostUsd,
  };
  return campaignBudgetViewSchema.parse({
    kind: "budget",
    schemaVersion: isCurrentSemanticResearchBudgetPolicy(
      input.plan.budgetPolicy,
    )
      ? 2
      : 1,
    campaignId: input.plan.campaignId,
    runId: input.plan.runId,
    ledgerHead: input.ledgerHead,
    policy: {
      id: input.plan.budgetPolicy.id,
      digest: sha256Digest(input.plan.budgetPolicy),
    },
    enforcement: {
      modelAttempts: "hard-precondition",
      modelWallTimeMs: "hard-precondition",
      estimatedCostUsd: "hard-precondition",
      modelTokens: "reported-postcondition",
      modelTurns: "reported-postcondition",
    },
    limits,
    spent,
    reserved,
    activeReservations: [...activeReservations].sort((left, right) =>
      left.attemptId.localeCompare(right.attemptId),
    ),
    ...(isCurrentSemanticResearchBudgetPolicy(input.plan.budgetPolicy)
      ? {
          protectedReservations: [...protectedReservations].sort(
            (left, right) =>
              left.reservationId.localeCompare(right.reservationId),
          ),
        }
      : {}),
    remaining: {
      modelAttempts: Math.max(
        0,
        limits.modelAttempts - spent.modelAttempts - reserved.modelAttempts,
      ),
      modelWallTimeMs: Math.max(
        0,
        limits.modelWallTimeMs -
          spent.modelWallTimeMs -
          reserved.modelWallTimeMs,
      ),
      modelTokens: Math.max(
        0,
        limits.modelTokens - spent.modelTokens - reserved.modelTokens,
      ),
      estimatedCostUsd: Math.max(
        0,
        limits.estimatedCostUsd -
          spent.estimatedCostUsd -
          reserved.estimatedCostUsd,
      ),
    },
    owners: {
      exploration: owner("exploration"),
      validation: owner("validation"),
    },
    unknownUsageAttemptIds: input.settlements
      .filter((settlement) => settlement.unknownDimensions.length > 0)
      .map((settlement) => settlement.attemptId)
      .sort(),
    overshoot: {
      modelWallTimeMs: input.settlements.reduce(
        (total, settlement) => total + settlement.overshoot.modelWallTimeMs,
        0,
      ),
      modelTokens: input.settlements.reduce(
        (total, settlement) => total + settlement.overshoot.modelTokens,
        0,
      ),
      estimatedCostUsd: input.settlements.reduce(
        (total, settlement) => total + settlement.overshoot.estimatedCostUsd,
        0,
      ),
    },
  });
}

export function campaignBudgetExhaustionDimensions(
  budget: CampaignBudgetView,
  reservation: CampaignAttemptBudgetReservation,
  protectedCredit: CampaignBudgetAmount = zeroCampaignBudgetAmount(),
): readonly string[] {
  const owner = budget.owners[reservation.owner];
  const exhausted = new Set<string>();
  if (reservation.amount.modelAttempts > budget.remaining.modelAttempts) {
    exhausted.add("model-attempts");
  }
  for (const [dimension, amount, totalRemaining, ownerRemaining] of [
    [
      "model-wall-time",
      reservation.amount.modelWallTimeMs,
      budget.remaining.modelWallTimeMs + protectedCredit.modelWallTimeMs,
      owner.remaining.modelWallTimeMs + protectedCredit.modelWallTimeMs,
    ],
    [
      "model-tokens",
      reservation.amount.modelTokens,
      budget.remaining.modelTokens + protectedCredit.modelTokens,
      owner.remaining.modelTokens + protectedCredit.modelTokens,
    ],
    [
      "provider-cost",
      reservation.amount.estimatedCostUsd,
      budget.remaining.estimatedCostUsd + protectedCredit.estimatedCostUsd,
      owner.remaining.estimatedCostUsd + protectedCredit.estimatedCostUsd,
    ],
  ] as const) {
    const ownerPartitionedAdmission = budget.schemaVersion === 2;
    if (
      amount > ownerRemaining ||
      (!ownerPartitionedAdmission && amount > totalRemaining)
    ) {
      exhausted.add(dimension);
    }
  }
  return [...exhausted];
}

export class CampaignBudgetExhaustedError extends Error {
  readonly reservation: CampaignAttemptBudgetReservation;
  readonly budget: CampaignBudgetView;
  readonly exhaustedDimensions: readonly string[];

  constructor(
    reservation: CampaignAttemptBudgetReservation,
    budget: CampaignBudgetView,
    exhaustedDimensions: readonly string[],
  ) {
    super(
      `Campaign budget exhausted before Attempt ${reservation.attemptId}: ${exhaustedDimensions.join(", ")}`,
    );
    this.name = "CampaignBudgetExhaustedError";
    this.reservation = reservation;
    this.budget = budget;
    this.exhaustedDimensions = exhaustedDimensions;
  }
}
