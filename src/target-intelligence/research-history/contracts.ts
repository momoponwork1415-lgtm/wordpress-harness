import { z } from "zod";

const digestSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const identifierSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
const pluginIdentitySchema = z
  .string()
  .regex(
    /^(?:wporg:[a-z0-9][a-z0-9-]*|premium:[a-z0-9][a-z0-9-]*\/[a-z0-9][a-z0-9-]*)$/,
  );

const immutableIdentitySchema = z.strictObject({
  id: identifierSchema,
  digest: digestSchema,
});

export const targetResearchPurposeSchema = z.enum([
  "prospective-security-research",
  "development-cohort-evaluation",
  "selection-calibration",
  "independent-recall-repeat",
]);

export const targetResearchCampaignReasonSchema = z.enum([
  "incomplete-source-frontier-follow-up",
  "development-cohort-evaluation",
  "selection-calibration",
  "independent-recall-repeat",
]);

export const targetResearchIncompleteReasonSchema = z.enum([
  "source-frontier-remains",
  "budget-exhausted",
  "provider-failure",
  "policy-blocked",
  "execution-interrupted",
]);

export const legacyTargetResearchCampaignDefinitionSchema = z
  .strictObject({
    kind: z.enum([
      "prospective",
      "development-cohort",
      "calibration",
      "independent-repeat",
    ]),
    runOrdinal: z.number().int().positive(),
    policy: immutableIdentitySchema,
    profile: immutableIdentitySchema,
    purpose: z.string().trim().min(1).max(512),
    reason: z.string().trim().min(1).max(512).optional(),
    followUp: z
      .strictObject({
        campaignId: identifierSchema,
      })
      .optional(),
  })
  .superRefine((definition, context) => {
    if (definition.kind !== "prospective" && definition.reason === undefined) {
      context.addIssue({
        code: "custom",
        path: ["reason"],
        message: "An intentional Campaign requires a reason",
      });
    }
    if (
      definition.kind !== "prospective" &&
      definition.followUp !== undefined
    ) {
      context.addIssue({
        code: "custom",
        path: ["followUp"],
        message: "Only a prospective Campaign can follow up Incomplete work",
      });
    }
    if (
      definition.kind === "prospective" &&
      definition.runOrdinal === 1 &&
      definition.followUp !== undefined
    ) {
      context.addIssue({
        code: "custom",
        path: ["followUp"],
        message: "The first prospective run cannot be a follow-up",
      });
    }
    if (
      definition.kind === "prospective" &&
      definition.runOrdinal > 1 &&
      (definition.reason === undefined || definition.followUp === undefined)
    ) {
      context.addIssue({
        code: "custom",
        path: ["reason"],
        message: "A later prospective run requires a reasoned follow-up",
      });
    }
  });

export const targetResearchIdentitySchema = z.strictObject({
  pluginIdentity: pluginIdentitySchema,
  verifiedVersion: z.string().min(1).max(64),
  canonicalFileManifestDigest: digestSchema,
});

export const targetResearchCampaignDefinitionSchema = z
  .strictObject({
    kind: z.enum([
      "prospective",
      "development-cohort",
      "calibration",
      "independent-repeat",
    ]),
    runOrdinal: z.number().int().positive(),
    policy: immutableIdentitySchema,
    profile: immutableIdentitySchema,
    purpose: targetResearchPurposeSchema,
    reason: targetResearchCampaignReasonSchema.optional(),
    followUp: z
      .strictObject({
        campaignId: identifierSchema,
      })
      .optional(),
  })
  .superRefine((definition, context) => {
    const expectedPurpose = {
      prospective: "prospective-security-research",
      "development-cohort": "development-cohort-evaluation",
      calibration: "selection-calibration",
      "independent-repeat": "independent-recall-repeat",
    }[definition.kind];
    if (definition.purpose !== expectedPurpose) {
      context.addIssue({
        code: "custom",
        path: ["purpose"],
        message: "Campaign kind and purpose must agree",
      });
    }
    const expectedReason = {
      prospective: undefined,
      "development-cohort": "development-cohort-evaluation",
      calibration: "selection-calibration",
      "independent-repeat": "independent-recall-repeat",
    }[definition.kind];
    if (definition.kind !== "prospective" && definition.reason === undefined) {
      context.addIssue({
        code: "custom",
        path: ["reason"],
        message: "An intentional Campaign requires a reason",
      });
    }
    if (
      definition.kind !== "prospective" &&
      definition.reason !== expectedReason
    ) {
      context.addIssue({
        code: "custom",
        path: ["reason"],
        message: "Campaign kind and reason must agree",
      });
    }
    if (
      definition.kind !== "prospective" &&
      definition.followUp !== undefined
    ) {
      context.addIssue({
        code: "custom",
        path: ["followUp"],
        message: "Only a prospective Campaign can follow up Incomplete work",
      });
    }
    if (
      definition.kind === "prospective" &&
      definition.runOrdinal === 1 &&
      definition.followUp !== undefined
    ) {
      context.addIssue({
        code: "custom",
        path: ["followUp"],
        message: "The first prospective run cannot be a follow-up",
      });
    }
    if (
      definition.kind === "prospective" &&
      definition.runOrdinal > 1 &&
      (definition.reason !== "incomplete-source-frontier-follow-up" ||
        definition.followUp === undefined)
    ) {
      context.addIssue({
        code: "custom",
        path: ["reason"],
        message: "A later prospective run requires a reasoned follow-up",
      });
    }
    if (
      definition.kind === "prospective" &&
      definition.runOrdinal === 1 &&
      definition.reason !== undefined
    ) {
      context.addIssue({
        code: "custom",
        path: ["reason"],
        message: "The first prospective run does not accept a reason",
      });
    }
  });

export const targetResearchAdmissionRequestSchema = z.strictObject({
  kind: z.literal("target-research-admission"),
  schemaVersion: z.literal(2),
  target: targetResearchIdentitySchema,
  campaign: targetResearchCampaignDefinitionSchema,
});

export const targetResearchHistoryRecordInputSchema = z.strictObject({
  kind: z.literal("target-research-history-record"),
  schemaVersion: z.literal(2),
  campaignId: identifierSchema,
  event: z.union([
    z.strictObject({ kind: z.literal("campaign-started") }),
    z.strictObject({
      kind: z.literal("campaign-progressed"),
      progressRef: immutableIdentitySchema,
    }),
    z.strictObject({
      kind: z.literal("campaign-completed"),
      terminalStatus: z.literal("coverage-closed"),
    }),
    z.strictObject({
      kind: z.literal("campaign-completed"),
      terminalStatus: z.literal("incomplete"),
      reason: targetResearchIncompleteReasonSchema,
    }),
  ]),
});

export const legacyTargetResearchAdmissionRequestSchema = z.strictObject({
  kind: z.literal("target-research-admission"),
  schemaVersion: z.literal(1),
  target: targetResearchIdentitySchema,
  campaign: legacyTargetResearchCampaignDefinitionSchema,
});

export const legacyTargetResearchHistoryRecordInputSchema = z.strictObject({
  kind: z.literal("target-research-history-record"),
  schemaVersion: z.literal(1),
  campaignId: identifierSchema,
  event: z.union([
    z.strictObject({ kind: z.literal("campaign-started") }),
    z.strictObject({
      kind: z.literal("campaign-progressed"),
      progressId: identifierSchema,
    }),
    z.strictObject({
      kind: z.literal("campaign-completed"),
      terminalStatus: z.literal("coverage-closed"),
    }),
    z.strictObject({
      kind: z.literal("campaign-completed"),
      terminalStatus: z.literal("incomplete"),
      reason: z.string().trim().min(1).max(512),
    }),
  ]),
});

export type TargetResearchIdentity = z.infer<
  typeof targetResearchIdentitySchema
>;
export type TargetResearchCampaignDefinition = z.infer<
  typeof targetResearchCampaignDefinitionSchema
>;
export type TargetResearchAdmissionRequest = z.infer<
  typeof targetResearchAdmissionRequestSchema
>;
export type TargetResearchHistoryRecordInput = z.infer<
  typeof targetResearchHistoryRecordInputSchema
>;

export interface TargetResearchCampaign {
  readonly id: string;
  readonly digest: string;
  readonly targetId: string;
  readonly target: TargetResearchIdentity;
  readonly definition: TargetResearchCampaignDefinition;
  readonly historySchemaVersion: 1 | 2;
  readonly status: "active" | "coverage-closed" | "incomplete" | "selected";
  readonly selectedAt: string;
  readonly startedAt?: string;
  readonly lastProgressAt?: string;
  readonly completedAt?: string;
  readonly terminalStatus?: "coverage-closed" | "incomplete";
  readonly terminalReason?:
    | z.infer<typeof targetResearchIncompleteReasonSchema>
    | "legacy-unclassified";
}

export interface NewTargetResearchAdmission {
  readonly status: "new";
  readonly campaign: TargetResearchCampaign;
}

export interface ResumeTargetResearchAdmission {
  readonly status: "resume";
  readonly campaign: TargetResearchCampaign;
}

export interface AlreadyCoveredTargetResearchAdmission {
  readonly status: "already-covered";
  readonly campaign: TargetResearchCampaign;
}

export interface FollowUpRequiredTargetResearchAdmission {
  readonly status: "follow-up-required";
  readonly campaign: TargetResearchCampaign;
}

export interface ProvenanceConflictTargetResearchAdmission {
  readonly status: "provenance-conflict";
  readonly recordedTarget: TargetResearchIdentity;
  readonly observedTarget: TargetResearchIdentity;
}

export type TargetResearchAdmission =
  | AlreadyCoveredTargetResearchAdmission
  | FollowUpRequiredTargetResearchAdmission
  | NewTargetResearchAdmission
  | ProvenanceConflictTargetResearchAdmission
  | ResumeTargetResearchAdmission;

export interface TargetResearchHistoryRecord {
  readonly id: string;
  readonly digest: string;
  readonly campaignId: string;
  readonly occurredAt: string;
  readonly event: TargetResearchHistoryRecordInput["event"];
}

export interface RecordTargetResearchHistoryResult {
  readonly status: "appended" | "replayed";
  readonly historyRecord: TargetResearchHistoryRecord;
  readonly campaign: TargetResearchCampaign;
}

export interface TargetResearchHistory {
  admit(
    request: TargetResearchAdmissionRequest,
  ): Promise<TargetResearchAdmission>;
  record(
    input: TargetResearchHistoryRecordInput,
  ): Promise<RecordTargetResearchHistoryResult>;
}

export interface OpenTargetResearchHistoryOptions {
  readonly databasePath: string;
  readonly clock?: () => Date;
}
