import { z } from "zod";

export type CampaignProgressRole =
  | "finder"
  | "root-planner"
  | "root-evaluator"
  | "root-synthesizer"
  | "adversarial-critic"
  | "validator";

export interface CampaignProgressCount {
  readonly started: number;
  readonly completed: number;
  readonly active: number;
}

export interface CampaignProgressUsage {
  /** Whether the token and turn counts below are complete. Says nothing about cost. */
  readonly measurement: "reported" | "partial";
  readonly modelAttempts: number;
  readonly reportedModelAttempts: number;
  readonly modelTurns: number;
  readonly modelTokens: {
    readonly input: number;
    readonly cacheCreation: number;
    readonly cacheRead: number;
    readonly output: number;
    readonly total: number;
  };
  readonly estimatedCostUsd: number;
  /**
   * Whether `estimatedCostUsd` is the whole cost or a floor under it.
   *
   * An Attempt can report its usage and still not report a cost — the provider
   * envelope decides `measurement` without consulting the cost field — and an
   * unreported cost is summed as zero. Answered separately from `measurement`
   * so a partial cost cannot hide behind complete token counts.
   */
  readonly estimatedCostMeasurement: "reported" | "partial";
  readonly source: {
    readonly queries: number;
    readonly scanBytes: number;
    readonly responseBytes: number;
  };
}

export interface CampaignProgressViewV1 {
  readonly kind: "progress";
  readonly schemaVersion: 1;
  readonly campaignId: string;
  readonly status: "prepared" | "running" | "completed";
  readonly ledgerHead: number;
  readonly counts: {
    readonly runs: CampaignProgressCount;
    readonly attempts: CampaignProgressCount;
    readonly checkpoints: {
      readonly total: number;
      readonly hypotheses: number;
      readonly routeFragments: number;
      readonly frontierGaps: number;
    };
    readonly verifications: CampaignProgressCount & {
      readonly finding: number;
      readonly disproved: number;
      readonly blocked: number;
    };
    readonly depthIterations: number;
  };
  readonly activeAttempts: readonly {
    readonly attemptId: string;
    readonly role: CampaignProgressRole;
    readonly startedAt: string;
  }[];
  readonly activeVerifications: readonly {
    readonly verificationId: string;
    readonly startedAt: string;
  }[];
  readonly usage: CampaignProgressUsage;
  readonly lastDurableEvent: {
    readonly sequence: number;
    readonly kind: string;
    readonly occurredAt: string;
  };
}

export interface CampaignProgressSubjectRef {
  readonly kind: "progress";
}

export interface CampaignProgressViewV2 extends Omit<
  CampaignProgressViewV1,
  "schemaVersion" | "counts"
> {
  readonly schemaVersion: 2;
  readonly counts: CampaignProgressViewV1["counts"] & {
    readonly validations: CampaignProgressCount & {
      readonly sourceValidated: number;
      readonly needsResearch: number;
      readonly disproven: number;
      readonly pending: number;
    };
    readonly findings: number;
  };
  readonly activeValidations: readonly {
    readonly validationId: string;
    readonly startedAt: string;
  }[];
}

export type CampaignProgressView =
  CampaignProgressViewV1 | CampaignProgressViewV2;

const count = z.number().int().nonnegative();
const progressCountSchema = z.strictObject({
  started: count,
  completed: count,
  active: count,
});
const validationCountsSchema = progressCountSchema.extend({
  sourceValidated: count,
  needsResearch: count,
  disproven: count,
  pending: count,
});

export const campaignProgressViewV2Schema = z
  .strictObject({
    kind: z.literal("progress"),
    schemaVersion: z.literal(2),
    campaignId: z.string().min(1),
    status: z.enum(["prepared", "running", "completed"]),
    ledgerHead: count,
    counts: z.strictObject({
      runs: progressCountSchema,
      attempts: progressCountSchema,
      checkpoints: z.strictObject({
        total: count,
        hypotheses: count,
        routeFragments: count,
        frontierGaps: count,
      }),
      verifications: progressCountSchema.extend({
        finding: count,
        disproved: count,
        blocked: count,
      }),
      validations: validationCountsSchema,
      findings: count,
      depthIterations: count,
    }),
    activeAttempts: z.array(
      z.strictObject({
        attemptId: z.string().min(1),
        role: z.enum([
          "finder",
          "root-planner",
          "root-evaluator",
          "root-synthesizer",
          "adversarial-critic",
          "validator",
        ]),
        startedAt: z.string(),
      }),
    ),
    activeVerifications: z.array(
      z.strictObject({
        verificationId: z.string().min(1),
        startedAt: z.string(),
      }),
    ),
    activeValidations: z.array(
      z.strictObject({
        validationId: z.string().min(1),
        startedAt: z.string(),
      }),
    ),
    usage: z.strictObject({
      measurement: z.enum(["reported", "partial"]),
      modelAttempts: count,
      reportedModelAttempts: count,
      modelTurns: count,
      modelTokens: z.strictObject({
        input: count,
        cacheCreation: count,
        cacheRead: count,
        output: count,
        total: count,
      }),
      estimatedCostUsd: z.number().nonnegative(),
      estimatedCostMeasurement: z.enum(["reported", "partial"]),
      source: z.strictObject({
        queries: count,
        scanBytes: count,
        responseBytes: count,
      }),
    }),
    lastDurableEvent: z.strictObject({
      sequence: count,
      kind: z.string().min(1),
      occurredAt: z.string(),
    }),
  })
  .superRefine((view, context) => {
    const groups = [
      view.counts.runs,
      view.counts.attempts,
      view.counts.verifications,
      view.counts.validations,
    ];
    const validation = view.counts.validations;
    if (
      groups.some(
        (group) => group.started !== group.completed + group.active,
      ) ||
      validation.completed !==
        validation.sourceValidated +
          validation.needsResearch +
          validation.disproven +
          validation.pending ||
      validation.active !== view.activeValidations.length ||
      view.counts.attempts.active !== view.activeAttempts.length ||
      view.counts.verifications.active !== view.activeVerifications.length ||
      view.ledgerHead !== view.lastDurableEvent.sequence
    ) {
      context.addIssue({
        code: "custom",
        message: "Campaign progress counters do not match durable state",
      });
    }
  });
