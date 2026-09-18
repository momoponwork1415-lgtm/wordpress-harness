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
    schemaVersion: z.literal(1),
    policy: z
      .object({
        fiveHourReservePercentage: percentageSchema,
        estimatedFiveHourPercentagePerLaunch: z.number().positive().max(100),
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

export const claudeRateLimitObservationSchema = z
  .object({
    kind: z.literal("claude-rate-limit-observation"),
    schemaVersion: z.literal(1),
    observedAt: z.iso.datetime(),
    source: z.literal("status-line"),
    fiveHour: z
      .object({
        usedPercentage: percentageSchema,
        resetsAt: z.iso.datetime().optional(),
      })
      .strict(),
    sevenDay: z
      .object({
        usedPercentage: percentageSchema,
        resetsAt: z.iso.datetime(),
      })
      .strict()
      .optional(),
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
          .passthrough()
          .optional(),
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
    schemaVersion: 1,
    observedAt,
    source: "status-line",
    fiveHour: {
      usedPercentage: parsed.rate_limits.five_hour.used_percentage,
      resetsAt: epochSecondsToIso(parsed.rate_limits.five_hour.resets_at),
    },
    ...(parsed.rate_limits.seven_day === undefined
      ? {}
      : {
          sevenDay: {
            usedPercentage: parsed.rate_limits.seven_day.used_percentage,
            resetsAt: epochSecondsToIso(parsed.rate_limits.seven_day.resets_at),
          },
        }),
  };
  return claudeRateLimitObservationSchema.parse(result);
}

export type ApprovedCampaignLaunchDecisionReason =
  | "launch-approved"
  | "all-plans-claimed"
  | "process-ceiling-reached"
  | "quota-reserve-reached"
  | "quota-observation-missing"
  | "quota-observation-stale"
  | "quota-window-reset";

export interface ApprovedCampaignLaunchDecision {
  readonly kind: "approved-campaign-launch-decision";
  readonly usedPercentage: number | null;
  readonly usablePercentage: number;
  readonly quotaSlots: number;
  readonly processSlots: number;
  readonly selectedPlanIds: readonly string[];
  readonly reason: ApprovedCampaignLaunchDecisionReason;
}

function noLaunch(
  reason: ApprovedCampaignLaunchDecisionReason,
  usedPercentage: number | null = null,
): ApprovedCampaignLaunchDecision {
  return {
    kind: "approved-campaign-launch-decision",
    usedPercentage,
    usablePercentage: 0,
    quotaSlots: 0,
    processSlots: 0,
    selectedPlanIds: [],
    reason,
  };
}

export function decideApprovedCampaignLaunches(input: {
  readonly manifest: ApprovedCampaignLaunchManifest;
  readonly observation: ClaudeRateLimitObservation | undefined;
  readonly claimedPlanIds: ReadonlySet<string>;
  readonly activePlanIds: ReadonlySet<string>;
  readonly reservedFiveHourPercentage: number;
  readonly now: string;
}): ApprovedCampaignLaunchDecision {
  const manifest = approvedCampaignLaunchManifestSchema.parse(input.manifest);
  const unclaimed = manifest.plans.filter(
    (plan) => !input.claimedPlanIds.has(plan.id),
  );
  if (unclaimed.length === 0) {
    return noLaunch(
      "all-plans-claimed",
      input.observation?.fiveHour.usedPercentage ?? null,
    );
  }
  if (input.observation === undefined) {
    return noLaunch("quota-observation-missing");
  }
  const observation = claudeRateLimitObservationSchema.parse(input.observation);
  const nowMs = Date.parse(input.now);
  const observedAtMs = Date.parse(observation.observedAt);
  const ageMs = nowMs - observedAtMs;
  if (
    !Number.isFinite(nowMs) ||
    ageMs < 0 ||
    ageMs > manifest.policy.maxObservationAgeSeconds * 1_000
  ) {
    return noLaunch(
      "quota-observation-stale",
      observation.fiveHour.usedPercentage,
    );
  }
  if (
    observation.fiveHour.resetsAt !== undefined &&
    nowMs >= Date.parse(observation.fiveHour.resetsAt)
  ) {
    return noLaunch("quota-window-reset", observation.fiveHour.usedPercentage);
  }
  const processSlots = Math.max(
    0,
    manifest.policy.maxActiveCampaigns - input.activePlanIds.size,
  );
  if (processSlots === 0) {
    return {
      ...noLaunch(
        "process-ceiling-reached",
        observation.fiveHour.usedPercentage,
      ),
      processSlots,
    };
  }
  const usablePercentage = Math.max(
    0,
    100 -
      observation.fiveHour.usedPercentage -
      manifest.policy.fiveHourReservePercentage -
      input.reservedFiveHourPercentage,
  );
  const quotaSlots =
    manifest.policy.allowQuotaExhaustion === true && usablePercentage > 0
      ? unclaimed.length
      : Math.floor(
          usablePercentage /
            manifest.policy.estimatedFiveHourPercentagePerLaunch,
        );
  if (quotaSlots === 0) {
    return {
      kind: "approved-campaign-launch-decision",
      usedPercentage: observation.fiveHour.usedPercentage,
      usablePercentage,
      quotaSlots,
      processSlots,
      selectedPlanIds: [],
      reason: "quota-reserve-reached",
    };
  }
  const selectedPlanIds = unclaimed
    .slice(0, Math.min(processSlots, quotaSlots))
    .map((plan) => plan.id);
  return {
    kind: "approved-campaign-launch-decision",
    usedPercentage: observation.fiveHour.usedPercentage,
    usablePercentage,
    quotaSlots,
    processSlots,
    selectedPlanIds,
    reason: "launch-approved",
  };
}
