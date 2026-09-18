import { isAbsolute } from "node:path";

import { z } from "zod";

import { admitAgentRuntimeProfile } from "../infrastructure/agent-runtime-profile.js";
import { canonicalDigest } from "../infrastructure/canonical-json.js";
import { campaignInputSchema } from "../research/index.js";
import { deepSeekAccountReadinessObservationSchema } from "./deepseek-account-readiness.js";
import {
  defineIndependentResearchTrialBinding,
  defineIndependentResearchTrialComparisonRequest,
  type IndependentResearchTrialComparisonRequest,
} from "./independent-research-trial-comparison.js";

const digestSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/u);
const identifierSchema = z
  .string()
  .min(1)
  .max(160)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
const absolutePathSchema = z
  .string()
  .min(1)
  .refine((value) => isAbsolute(value), "Launch paths must be absolute");
const pinnedImageSchema = z
  .string()
  .regex(/^(?:[^\s@]+@)?sha256:[a-f0-9]{64}$/u);

const dependencySourceSchema = z.strictObject({
  mountName: z.string().regex(/^[a-z0-9][a-z0-9-]*$/u),
  directory: absolutePathSchema,
});

export const independentResearchTrialPlanSchema = z
  .strictObject({
    trialId: identifierSchema,
    campaignInput: campaignInputSchema,
    targetSourceDirectory: absolutePathSchema,
    dependencySources: z.array(dependencySourceSchema).max(16),
    databasePath: absolutePathSchema,
    scratchDirectory: absolutePathSchema,
    logPath: absolutePathSchema,
    image: pinnedImageSchema,
    providerConfigDirectory: absolutePathSchema,
    researchPromptPath: absolutePathSchema,
  })
  .superRefine((plan, context) => {
    if (plan.campaignInput.resumeFrom !== undefined) {
      context.addIssue({
        code: "custom",
        path: ["campaignInput", "resumeFrom"],
        message: "Independent Research Trials must start fresh",
      });
    }
    if (
      plan.campaignInput.agentRuntimeProfile.transportKind !==
      "deepseek-harness-native/v1"
    ) {
      context.addIssue({
        code: "custom",
        path: ["campaignInput", "agentRuntimeProfile", "transportKind"],
        message: "This launcher requires DeepSeek account readiness",
      });
    }
    if (
      admitAgentRuntimeProfile(
        plan.campaignInput.agentRuntimeProfile,
        plan.image,
      ).status !== "admitted"
    ) {
      context.addIssue({
        code: "custom",
        path: ["image"],
        message: "Trial image must match an admitted runtime profile",
      });
    }
    const expectedMounts = new Set(
      (plan.campaignInput.dependencySnapshots ?? []).map(
        (dependency) => dependency.mountName,
      ),
    );
    const actualMounts = new Set(
      plan.dependencySources.map((dependency) => dependency.mountName),
    );
    if (
      actualMounts.size !== plan.dependencySources.length ||
      actualMounts.size !== expectedMounts.size ||
      [...actualMounts].some((mountName) => !expectedMounts.has(mountName))
    ) {
      context.addIssue({
        code: "custom",
        path: ["dependencySources"],
        message: "Trial dependency paths must match the Campaign input",
      });
    }
  });

export type IndependentResearchTrialPlan = z.infer<
  typeof independentResearchTrialPlanSchema
>;

const independentResearchTrialApprovalBodySchema = z
  .strictObject({
    kind: z.literal("independent-research-trial-approval"),
    schemaVersion: z.literal(1),
    approvalId: identifierSchema,
    approvedAt: z.iso.datetime(),
    expiresAt: z.iso.datetime(),
    maxReadinessAgeSeconds: z.number().int().positive().max(3_600),
    maxConcurrentTrials: z.number().int().positive().max(3),
    runtime: z.strictObject({
      nodeExecutablePath: absolutePathSchema,
      harnessCliPath: absolutePathSchema,
      dockerExecutablePath: absolutePathSchema,
    }),
    aggregateAllowance: z.strictObject({
      maxNativeRuns: z.number().int().positive(),
      maxWallTimeMs: z.number().int().positive(),
    }),
    trials: z.array(independentResearchTrialPlanSchema).min(1).max(100),
  })
  .superRefine((approval, context) => {
    if (Date.parse(approval.expiresAt) <= Date.parse(approval.approvedAt)) {
      context.addIssue({
        code: "custom",
        path: ["expiresAt"],
        message: "Independent Trial approval must expire after approval",
      });
    }
    const uniqueFields = [
      ["trialId", approval.trials.map((trial) => trial.trialId)],
      [
        "campaignInput.campaignId",
        approval.trials.map((trial) => trial.campaignInput.campaignId),
      ],
      ["databasePath", approval.trials.map((trial) => trial.databasePath)],
      [
        "scratchDirectory",
        approval.trials.map((trial) => trial.scratchDirectory),
      ],
      ["logPath", approval.trials.map((trial) => trial.logPath)],
    ] as const;
    for (const [field, values] of uniqueFields) {
      if (new Set(values).size !== values.length) {
        context.addIssue({
          code: "custom",
          path: ["trials"],
          message: `Independent Trial ${field} values must be unique`,
        });
      }
    }
    if (
      new Set(approval.trials.map((trial) => trial.providerConfigDirectory))
        .size !== 1
    ) {
      context.addIssue({
        code: "custom",
        path: ["trials"],
        message:
          "Independent Trials sharing one account observation must share one provider config",
      });
    }
    let bindingDigests: ReadonlySet<string>;
    try {
      bindingDigests = new Set(
        approval.trials.map(
          (trial) =>
            defineIndependentResearchTrialBinding(trial.campaignInput).digest,
        ),
      );
    } catch {
      context.addIssue({
        code: "custom",
        path: ["trials"],
        message: "Independent Trials require fresh comparison bindings",
      });
      return;
    }
    if (bindingDigests.size !== 1) {
      context.addIssue({
        code: "custom",
        path: ["trials"],
        message: "Independent Trials must share one exact comparison binding",
      });
    }
  });

export const independentResearchTrialApprovalSchema =
  independentResearchTrialApprovalBodySchema
    .extend({ digest: digestSchema })
    .superRefine((approval, context) => {
      const { digest, ...body } = approval;
      if (digest !== canonicalDigest(body)) {
        context.addIssue({
          code: "custom",
          path: ["digest"],
          message: "Independent Trial approval digest mismatch",
        });
      }
    });

export type IndependentResearchTrialApproval = z.infer<
  typeof independentResearchTrialApprovalSchema
>;

export type IndependentResearchTrialApprovalDefinition = Omit<
  z.input<typeof independentResearchTrialApprovalBodySchema>,
  "kind" | "schemaVersion"
>;

export function defineIndependentResearchTrialApproval(
  definition: unknown,
): IndependentResearchTrialApproval {
  const fields = z.record(z.string(), z.unknown()).parse(definition);
  if (
    Object.hasOwn(fields, "kind") ||
    Object.hasOwn(fields, "schemaVersion") ||
    Object.hasOwn(fields, "digest")
  ) {
    throw new Error(
      "Independent Trial approval definition is not a sealed artifact",
    );
  }
  const body = independentResearchTrialApprovalBodySchema.parse({
    ...fields,
    kind: "independent-research-trial-approval",
    schemaVersion: 1,
  });
  return independentResearchTrialApprovalSchema.parse({
    ...body,
    digest: canonicalDigest(body),
  });
}

export function comparisonRequestForIndependentResearchTrialApproval(
  candidateApproval: IndependentResearchTrialApproval,
): IndependentResearchTrialComparisonRequest {
  const approval =
    independentResearchTrialApprovalSchema.parse(candidateApproval);
  const first = approval.trials[0];
  if (first === undefined) {
    throw new Error("Independent Trial approval has no Trials");
  }
  return defineIndependentResearchTrialComparisonRequest({
    comparisonId: approval.approvalId,
    trialCampaignIds: approval.trials.map(
      (trial) => trial.campaignInput.campaignId,
    ),
    expectedBinding: defineIndependentResearchTrialBinding(first.campaignInput),
  });
}

const independentResearchTrialReadinessBodySchema = z.strictObject({
  kind: z.literal("independent-research-trial-readiness"),
  schemaVersion: z.literal(1),
  approvalId: identifierSchema,
  approvalDigest: digestSchema,
  trialId: identifierSchema,
  campaignId: identifierSchema,
  campaignInputDigest: digestSchema,
  checkedAt: z.iso.datetime(),
  status: z.enum(["ready", "blocked", "unknown"]),
  reason: z.string().min(1).max(256),
});

export const independentResearchTrialReadinessSchema =
  independentResearchTrialReadinessBodySchema
    .extend({ digest: digestSchema })
    .superRefine((readiness, context) => {
      const { digest, ...body } = readiness;
      if (digest !== canonicalDigest(body)) {
        context.addIssue({
          code: "custom",
          path: ["digest"],
          message: "Independent Trial readiness digest mismatch",
        });
      }
    });

export type IndependentResearchTrialReadiness = z.infer<
  typeof independentResearchTrialReadinessSchema
>;

export function defineIndependentResearchTrialReadiness(
  definition: Omit<
    z.input<typeof independentResearchTrialReadinessBodySchema>,
    "kind" | "schemaVersion"
  >,
): IndependentResearchTrialReadiness {
  const body = independentResearchTrialReadinessBodySchema.parse({
    kind: "independent-research-trial-readiness",
    schemaVersion: 1,
    ...definition,
  });
  return independentResearchTrialReadinessSchema.parse({
    ...body,
    digest: canonicalDigest(body),
  });
}

const independentResearchTrialClaimBodySchema = z.strictObject({
  kind: z.literal("independent-research-trial-claim"),
  schemaVersion: z.literal(1),
  approvalId: identifierSchema,
  approvalDigest: digestSchema,
  trialId: identifierSchema,
  campaignId: identifierSchema,
  campaignInputDigest: digestSchema,
  accountReadinessDigest: digestSchema,
  trialReadinessDigest: digestSchema,
  reservedNativeRuns: z.number().int().positive(),
  reservedWallTimeMs: z.number().int().positive(),
  claimedAt: z.iso.datetime(),
});

export const independentResearchTrialClaimSchema =
  independentResearchTrialClaimBodySchema
    .extend({ digest: digestSchema })
    .superRefine((claim, context) => {
      const { digest, ...body } = claim;
      if (digest !== canonicalDigest(body)) {
        context.addIssue({
          code: "custom",
          path: ["digest"],
          message: "Independent Trial claim digest mismatch",
        });
      }
    });

export type IndependentResearchTrialClaim = z.infer<
  typeof independentResearchTrialClaimSchema
>;

export interface IndependentResearchTrialClaimState {
  readonly claim: IndependentResearchTrialClaim;
  readonly active: boolean;
}

export type IndependentResearchTrialLaunchDecisionReason =
  | "launch-approved"
  | "all-trials-claimed"
  | "approval-not-yet-valid"
  | "approval-expired"
  | "account-readiness-missing"
  | "account-readiness-stale"
  | "account-credential-unavailable"
  | "account-unauthenticated"
  | "account-quota-exhausted"
  | "account-rate-limited"
  | "account-readiness-unavailable"
  | "trial-readiness-blocked"
  | "dispatch-lock-unavailable"
  | "concurrency-ceiling-reached"
  | "aggregate-allowance-exhausted";

export interface IndependentResearchTrialLaunchDecision {
  readonly kind: "independent-research-trial-launch-decision";
  readonly approvalId: string;
  readonly approvalDigest: string;
  readonly accountReadinessDigest: string | null;
  readonly selectedTrialIds: readonly string[];
  readonly claimedTrialIds: readonly string[];
  readonly activeClaims: number;
  readonly remainingNativeRuns: number;
  readonly remainingWallTimeMs: number;
  readonly reason: IndependentResearchTrialLaunchDecisionReason;
}

function noLaunch(
  approval: IndependentResearchTrialApproval,
  state: {
    readonly readinessDigest: string | null;
    readonly claimedTrialIds: readonly string[];
    readonly activeClaims: number;
    readonly remainingNativeRuns: number;
    readonly remainingWallTimeMs: number;
  },
  reason: IndependentResearchTrialLaunchDecisionReason,
): IndependentResearchTrialLaunchDecision {
  return {
    kind: "independent-research-trial-launch-decision",
    approvalId: approval.approvalId,
    approvalDigest: approval.digest,
    accountReadinessDigest: state.readinessDigest,
    selectedTrialIds: [],
    claimedTrialIds: state.claimedTrialIds,
    activeClaims: state.activeClaims,
    remainingNativeRuns: state.remainingNativeRuns,
    remainingWallTimeMs: state.remainingWallTimeMs,
    reason,
  };
}

function accountFailureReason(
  status: Exclude<
    z.infer<typeof deepSeekAccountReadinessObservationSchema>["status"],
    "ready"
  >,
): IndependentResearchTrialLaunchDecisionReason {
  switch (status) {
    case "credential-unavailable":
      return "account-credential-unavailable";
    case "unauthenticated":
      return "account-unauthenticated";
    case "quota-exhausted":
      return "account-quota-exhausted";
    case "rate-limited":
      return "account-rate-limited";
    case "timeout":
    case "unavailable":
    case "invalid-response":
      return "account-readiness-unavailable";
  }
}

export function decideIndependentResearchTrialLaunches(input: {
  readonly approval: IndependentResearchTrialApproval;
  readonly accountReadiness:
    z.infer<typeof deepSeekAccountReadinessObservationSchema> | undefined;
  readonly claims: readonly IndependentResearchTrialClaimState[];
  readonly unlaunchableTrialIds?: ReadonlySet<string>;
  readonly now: string;
}): IndependentResearchTrialLaunchDecision {
  const approval = independentResearchTrialApprovalSchema.parse(input.approval);
  const now = z.iso.datetime().parse(input.now);
  const trialsById = new Map(
    approval.trials.map((trial) => [trial.trialId, trial]),
  );
  const claims = input.claims.map((state) => ({
    claim: independentResearchTrialClaimSchema.parse(state.claim),
    active: state.active,
  }));
  const claimedIds = new Set<string>();
  let reservedNativeRuns = 0;
  let reservedWallTimeMs = 0;
  for (const state of claims) {
    const claim = state.claim;
    const trial = trialsById.get(claim.trialId);
    if (
      claimedIds.has(claim.trialId) ||
      claim.approvalId !== approval.approvalId ||
      claim.approvalDigest !== approval.digest ||
      trial === undefined ||
      claim.campaignId !== trial.campaignInput.campaignId ||
      claim.campaignInputDigest !== canonicalDigest(trial.campaignInput) ||
      claim.reservedNativeRuns !==
        trial.campaignInput.budgetEnvelope.maxNativeRuns ||
      claim.reservedWallTimeMs !==
        trial.campaignInput.budgetEnvelope.maxWallTimeMs
    ) {
      throw new Error("Independent Trial claim does not match approval");
    }
    claimedIds.add(claim.trialId);
    reservedNativeRuns += claim.reservedNativeRuns;
    reservedWallTimeMs += claim.reservedWallTimeMs;
  }
  const claimedTrialIds = approval.trials
    .filter((trial) => claimedIds.has(trial.trialId))
    .map((trial) => trial.trialId);
  const activeClaims = claims.filter((state) => state.active).length;
  const remainingNativeRuns =
    approval.aggregateAllowance.maxNativeRuns - reservedNativeRuns;
  const remainingWallTimeMs =
    approval.aggregateAllowance.maxWallTimeMs - reservedWallTimeMs;
  if (remainingNativeRuns < 0 || remainingWallTimeMs < 0) {
    throw new Error("Independent Trial claims exceed aggregate allowance");
  }
  const readiness =
    input.accountReadiness === undefined
      ? undefined
      : deepSeekAccountReadinessObservationSchema.parse(input.accountReadiness);
  const state = {
    readinessDigest: readiness?.digest ?? null,
    claimedTrialIds,
    activeClaims,
    remainingNativeRuns,
    remainingWallTimeMs,
  };
  if (claimedIds.size === approval.trials.length) {
    return noLaunch(approval, state, "all-trials-claimed");
  }
  const nowMs = Date.parse(now);
  if (nowMs < Date.parse(approval.approvedAt)) {
    return noLaunch(approval, state, "approval-not-yet-valid");
  }
  if (nowMs >= Date.parse(approval.expiresAt)) {
    return noLaunch(approval, state, "approval-expired");
  }
  if (readiness === undefined) {
    return noLaunch(approval, state, "account-readiness-missing");
  }
  const readinessAgeMs = nowMs - Date.parse(readiness.observedAt);
  if (
    readinessAgeMs < 0 ||
    readinessAgeMs > approval.maxReadinessAgeSeconds * 1_000
  ) {
    return noLaunch(approval, state, "account-readiness-stale");
  }
  if (readiness.status !== "ready") {
    return noLaunch(approval, state, accountFailureReason(readiness.status));
  }
  const processSlots = approval.maxConcurrentTrials - activeClaims;
  if (processSlots <= 0) {
    return noLaunch(approval, state, "concurrency-ceiling-reached");
  }
  let availableNativeRuns = remainingNativeRuns;
  let availableWallTimeMs = remainingWallTimeMs;
  const selectedTrialIds: string[] = [];
  for (const trial of approval.trials) {
    if (
      claimedIds.has(trial.trialId) ||
      input.unlaunchableTrialIds?.has(trial.trialId) === true
    ) {
      continue;
    }
    const budget = trial.campaignInput.budgetEnvelope;
    if (
      budget.maxNativeRuns > availableNativeRuns ||
      budget.maxWallTimeMs > availableWallTimeMs
    ) {
      continue;
    }
    selectedTrialIds.push(trial.trialId);
    availableNativeRuns -= budget.maxNativeRuns;
    availableWallTimeMs -= budget.maxWallTimeMs;
    if (selectedTrialIds.length === processSlots) break;
  }
  if (selectedTrialIds.length === 0) {
    const hasReadinessEligibleTrial = approval.trials.some(
      (trial) =>
        !claimedIds.has(trial.trialId) &&
        input.unlaunchableTrialIds?.has(trial.trialId) !== true,
    );
    if (!hasReadinessEligibleTrial) {
      return noLaunch(approval, state, "trial-readiness-blocked");
    }
    return noLaunch(approval, state, "aggregate-allowance-exhausted");
  }
  return {
    kind: "independent-research-trial-launch-decision",
    approvalId: approval.approvalId,
    approvalDigest: approval.digest,
    accountReadinessDigest: readiness.digest,
    selectedTrialIds,
    claimedTrialIds,
    activeClaims,
    remainingNativeRuns,
    remainingWallTimeMs,
    reason: "launch-approved",
  };
}
