import { z } from "zod";

const percentageSchema = z.number().min(0).max(100);

export const pinnedContainerImageSchema = z
  .string()
  .regex(/^(?:[^\s@]+@)?sha256:[a-f0-9]{64}$/);

const dependencySourceSchema = z
  .object({
    mountName: z.string().min(1),
    directory: z.string().min(1),
  })
  .strict();

export const approvedCampaignLaunchManifestSchema = z
  .object({
    kind: z.literal("approved-campaign-launch-manifest"),
    schemaVersion: z.literal(2),
    policy: z
      .object({
        fiveHourReservePercentage: percentageSchema,
        sevenDayReservePercentage: percentageSchema,
        estimatedFiveHourPercentagePerLaunch: z.number().positive().max(100),
        estimatedSevenDayPercentagePerLaunch: z.number().positive().max(100),
        allowQuotaExhaustion: z.boolean().optional(),
        maxActiveCampaigns: z.number().int().positive().max(3),
        maxObservationAgeSeconds: z.number().int().positive(),
      })
      .strict(),
    runtime: z
      .object({
        nodeExecutablePath: z.string().min(1),
        harnessCliPath: z.string().min(1),
        dockerExecutablePath: z.string().min(1),
      })
      .strict(),
    plans: z
      .array(
        z
          .object({
            id: z.string().regex(/^[a-z0-9][a-z0-9._-]*$/),
            campaignId: z.string().min(1),
            requestPath: z.string().min(1),
            targetSourceDirectory: z.string().min(1),
            dependencySources: z.array(dependencySourceSchema),
            databasePath: z.string().min(1),
            scratchDirectory: z.string().min(1),
            logPath: z.string().min(1),
            image: pinnedContainerImageSchema,
            providerConfigDirectory: z.string().min(1),
            researchPromptPath: z.string().min(1),
          })
          .strict(),
      )
      .min(1),
  })
  .strict()
  .superRefine((manifest, context) => {
    const ids = new Set<string>();
    const campaignIds = new Set<string>();
    for (const [index, plan] of manifest.plans.entries()) {
      if (ids.has(plan.id)) {
        context.addIssue({
          code: "custom",
          path: ["plans", index, "id"],
          message: "Launch plan ids must be unique",
        });
      }
      if (campaignIds.has(plan.campaignId)) {
        context.addIssue({
          code: "custom",
          path: ["plans", index, "campaignId"],
          message: "Campaign ids must be unique",
        });
      }
      ids.add(plan.id);
      campaignIds.add(plan.campaignId);
    }
  });

export type ApprovedCampaignLaunchManifest = z.infer<
  typeof approvedCampaignLaunchManifestSchema
>;
export type ApprovedCampaignLaunchPlan =
  ApprovedCampaignLaunchManifest["plans"][number];

export const claudeAccountReadinessObservationSchema = z
  .object({
    kind: z.literal("claude-account-readiness-observation"),
    schemaVersion: z.literal(1),
    observedAt: z.iso.datetime(),
    source: z.literal("operator"),
    status: z.enum(["ready", "unauthenticated", "unavailable"]),
  })
  .strict();

export type ClaudeAccountReadinessObservation = z.infer<
  typeof claudeAccountReadinessObservationSchema
>;

const accountReadinessInputSchema = z
  .object({
    status: z.enum(["ready", "unauthenticated", "unavailable"]),
  })
  .strict();

export function normalizeClaudeAccountReadiness(
  input: unknown,
  observedAt: string,
): ClaudeAccountReadinessObservation {
  const parsed = accountReadinessInputSchema.parse(input);
  return claudeAccountReadinessObservationSchema.parse({
    kind: "claude-account-readiness-observation",
    schemaVersion: 1,
    observedAt,
    source: "operator",
    status: parsed.status,
  });
}

export const claudeRateLimitObservationSchema = z
  .object({
    kind: z.literal("claude-rate-limit-observation"),
    schemaVersion: z.literal(2),
    observedAt: z.iso.datetime(),
    source: z.literal("status-line"),
    fiveHour: z
      .object({
        usedPercentage: percentageSchema,
        resetsAt: z.iso.datetime(),
      })
      .strict(),
    sevenDay: z
      .object({
        usedPercentage: percentageSchema,
        resetsAt: z.iso.datetime(),
      })
      .strict(),
  })
  .strict();

export type ClaudeRateLimitObservation = z.infer<
  typeof claudeRateLimitObservationSchema
>;

const statusLineInputSchema = z
  .object({
    rate_limits: z
      .object({
        five_hour: z
          .object({
            used_percentage: percentageSchema,
            resets_at: z.number().int().positive(),
          })
          .passthrough(),
        seven_day: z
          .object({
            used_percentage: percentageSchema,
            resets_at: z.number().int().positive(),
          })
          .passthrough(),
      })
      .passthrough(),
  })
  .passthrough();

function epochSecondsToIso(value: number): string {
  return new Date(value * 1_000).toISOString();
}

export function normalizeClaudeStatusLineRateLimits(
  input: unknown,
  observedAt: string,
): ClaudeRateLimitObservation {
  const parsed = statusLineInputSchema.parse(input);
  const result: ClaudeRateLimitObservation = {
    kind: "claude-rate-limit-observation",
    schemaVersion: 2,
    observedAt,
    source: "status-line",
    fiveHour: {
      usedPercentage: parsed.rate_limits.five_hour.used_percentage,
      resetsAt: epochSecondsToIso(parsed.rate_limits.five_hour.resets_at),
    },
    sevenDay: {
      usedPercentage: parsed.rate_limits.seven_day.used_percentage,
      resetsAt: epochSecondsToIso(parsed.rate_limits.seven_day.resets_at),
    },
  };
  return claudeRateLimitObservationSchema.parse(result);
}

export type ApprovedCampaignLaunchDecisionReason =
  | "launch-approved"
  | "all-plans-claimed"
  | "process-ceiling-reached"
  | "account-readiness-observation-missing"
  | "account-readiness-observation-stale"
  | "account-unauthenticated"
  | "account-readiness-unavailable"
  | "five-hour-quota-reserve-reached"
  | "seven-day-quota-reserve-reached"
  | "quota-observation-missing"
  | "quota-observation-stale"
  | "five-hour-quota-window-reset"
  | "seven-day-quota-window-reset";

export interface QuotaWindowLaunchDecision {
  readonly usedPercentage: number | null;
  readonly usablePercentage: number;
  readonly quotaSlots: number;
}

export interface ApprovedCampaignLaunchDecision {
  readonly kind: "approved-campaign-launch-decision";
  readonly accountStatus: ClaudeAccountReadinessObservation["status"] | null;
  readonly fiveHour: QuotaWindowLaunchDecision;
  readonly sevenDay: QuotaWindowLaunchDecision;
  readonly quotaSlots: number;
  readonly processSlots: number;
  readonly selectedPlanIds: readonly string[];
  readonly reason: ApprovedCampaignLaunchDecisionReason;
}

function noLaunch(
  reason: ApprovedCampaignLaunchDecisionReason,
  input: Readonly<{
    accountStatus?: ClaudeAccountReadinessObservation["status"] | null;
    fiveHourUsedPercentage?: number | null;
    sevenDayUsedPercentage?: number | null;
    processSlots?: number;
  }> = {},
): ApprovedCampaignLaunchDecision {
  return {
    kind: "approved-campaign-launch-decision",
    accountStatus: input.accountStatus ?? null,
    fiveHour: {
      usedPercentage: input.fiveHourUsedPercentage ?? null,
      usablePercentage: 0,
      quotaSlots: 0,
    },
    sevenDay: {
      usedPercentage: input.sevenDayUsedPercentage ?? null,
      usablePercentage: 0,
      quotaSlots: 0,
    },
    quotaSlots: 0,
    processSlots: input.processSlots ?? 0,
    selectedPlanIds: [],
    reason,
  };
}

function observationIsStale(
  observedAt: string,
  nowMs: number,
  maxAgeSeconds: number,
): boolean {
  const ageMs = nowMs - Date.parse(observedAt);
  return !Number.isFinite(nowMs) || ageMs < 0 || ageMs > maxAgeSeconds * 1_000;
}

function quotaSlotsForWindow(input: {
  readonly usablePercentage: number;
  readonly estimatedPercentagePerLaunch: number;
  readonly unclaimedPlans: number;
  readonly allowQuotaExhaustion: boolean;
}): number {
  if (input.allowQuotaExhaustion && input.usablePercentage > 0) {
    return input.unclaimedPlans;
  }
  return Math.floor(
    input.usablePercentage / input.estimatedPercentagePerLaunch,
  );
}

export function decideApprovedCampaignLaunches(input: {
  readonly manifest: ApprovedCampaignLaunchManifest;
  readonly readiness: ClaudeAccountReadinessObservation | undefined;
  readonly observation: ClaudeRateLimitObservation | undefined;
  readonly claimedPlanIds: ReadonlySet<string>;
  readonly activePlanIds: ReadonlySet<string>;
  readonly reservedFiveHourPercentage: number;
  readonly reservedSevenDayPercentage: number;
  readonly now: string;
}): ApprovedCampaignLaunchDecision {
  const manifest = approvedCampaignLaunchManifestSchema.parse(input.manifest);
  const unclaimed = manifest.plans.filter(
    (plan) => !input.claimedPlanIds.has(plan.id),
  );
  if (unclaimed.length === 0) {
    return noLaunch("all-plans-claimed", {
      accountStatus: input.readiness?.status ?? null,
      fiveHourUsedPercentage:
        input.observation?.fiveHour.usedPercentage ?? null,
      sevenDayUsedPercentage:
        input.observation?.sevenDay.usedPercentage ?? null,
    });
  }
  if (input.readiness === undefined) {
    return noLaunch("account-readiness-observation-missing");
  }
  const readiness = claudeAccountReadinessObservationSchema.parse(
    input.readiness,
  );
  const nowMs = Date.parse(input.now);
  if (
    observationIsStale(
      readiness.observedAt,
      nowMs,
      manifest.policy.maxObservationAgeSeconds,
    )
  ) {
    return noLaunch("account-readiness-observation-stale", {
      accountStatus: readiness.status,
    });
  }
  if (readiness.status === "unauthenticated") {
    return noLaunch("account-unauthenticated", {
      accountStatus: readiness.status,
    });
  }
  if (readiness.status === "unavailable") {
    return noLaunch("account-readiness-unavailable", {
      accountStatus: readiness.status,
    });
  }
  if (input.observation === undefined) {
    return noLaunch("quota-observation-missing", {
      accountStatus: readiness.status,
    });
  }
  const observation = claudeRateLimitObservationSchema.parse(input.observation);
  if (
    observationIsStale(
      observation.observedAt,
      nowMs,
      manifest.policy.maxObservationAgeSeconds,
    )
  ) {
    return noLaunch("quota-observation-stale", {
      accountStatus: readiness.status,
      fiveHourUsedPercentage: observation.fiveHour.usedPercentage,
      sevenDayUsedPercentage: observation.sevenDay.usedPercentage,
    });
  }
  if (nowMs >= Date.parse(observation.fiveHour.resetsAt)) {
    return noLaunch("five-hour-quota-window-reset", {
      accountStatus: readiness.status,
      fiveHourUsedPercentage: observation.fiveHour.usedPercentage,
      sevenDayUsedPercentage: observation.sevenDay.usedPercentage,
    });
  }
  if (nowMs >= Date.parse(observation.sevenDay.resetsAt)) {
    return noLaunch("seven-day-quota-window-reset", {
      accountStatus: readiness.status,
      fiveHourUsedPercentage: observation.fiveHour.usedPercentage,
      sevenDayUsedPercentage: observation.sevenDay.usedPercentage,
    });
  }
  const processSlots = Math.max(
    0,
    manifest.policy.maxActiveCampaigns - input.activePlanIds.size,
  );
  if (processSlots === 0) {
    return noLaunch("process-ceiling-reached", {
      accountStatus: readiness.status,
      fiveHourUsedPercentage: observation.fiveHour.usedPercentage,
      sevenDayUsedPercentage: observation.sevenDay.usedPercentage,
      processSlots,
    });
  }
  const fiveHourUsablePercentage = Math.max(
    0,
    100 -
      observation.fiveHour.usedPercentage -
      manifest.policy.fiveHourReservePercentage -
      input.reservedFiveHourPercentage,
  );
  const sevenDayUsablePercentage = Math.max(
    0,
    100 -
      observation.sevenDay.usedPercentage -
      manifest.policy.sevenDayReservePercentage -
      input.reservedSevenDayPercentage,
  );
  const allowQuotaExhaustion = manifest.policy.allowQuotaExhaustion === true;
  const fiveHourQuotaSlots = quotaSlotsForWindow({
    usablePercentage: fiveHourUsablePercentage,
    estimatedPercentagePerLaunch:
      manifest.policy.estimatedFiveHourPercentagePerLaunch,
    unclaimedPlans: unclaimed.length,
    allowQuotaExhaustion,
  });
  const sevenDayQuotaSlots = quotaSlotsForWindow({
    usablePercentage: sevenDayUsablePercentage,
    estimatedPercentagePerLaunch:
      manifest.policy.estimatedSevenDayPercentagePerLaunch,
    unclaimedPlans: unclaimed.length,
    allowQuotaExhaustion,
  });
  const quotaSlots = Math.min(fiveHourQuotaSlots, sevenDayQuotaSlots);
  const quotaDecision = {
    accountStatus: readiness.status,
    fiveHour: {
      usedPercentage: observation.fiveHour.usedPercentage,
      usablePercentage: fiveHourUsablePercentage,
      quotaSlots: fiveHourQuotaSlots,
    },
    sevenDay: {
      usedPercentage: observation.sevenDay.usedPercentage,
      usablePercentage: sevenDayUsablePercentage,
      quotaSlots: sevenDayQuotaSlots,
    },
    quotaSlots,
    processSlots,
  } as const;
  if (fiveHourQuotaSlots === 0) {
    return {
      kind: "approved-campaign-launch-decision",
      ...quotaDecision,
      selectedPlanIds: [],
      reason: "five-hour-quota-reserve-reached",
    };
  }
  if (sevenDayQuotaSlots === 0) {
    return {
      kind: "approved-campaign-launch-decision",
      ...quotaDecision,
      selectedPlanIds: [],
      reason: "seven-day-quota-reserve-reached",
    };
  }
  const selectedPlanIds = unclaimed
    .slice(0, Math.min(processSlots, quotaSlots))
    .map((plan) => plan.id);
  return {
    kind: "approved-campaign-launch-decision",
    ...quotaDecision,
    selectedPlanIds,
    reason: "launch-approved",
  };
}
