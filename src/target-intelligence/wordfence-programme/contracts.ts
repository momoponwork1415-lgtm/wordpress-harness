import { z } from "zod";

import {
  policyTermSchema,
  programmeEligibilitySchema,
  programmeMonthlyAggregateSchema,
  programmeRewardRouteSchema,
} from "../programme-intelligence/contracts.js";

export const wordfenceProgrammeSourceKindSchema = z.enum([
  "programme",
  "terms",
  "report-form",
  "payout",
  "promotion",
  "monthly-report",
]);

export const wordfenceProgrammePageDocumentSchema = z.strictObject({
  kind: z.literal("wordfence-programme-page"),
  schemaVersion: z.literal(1),
  sourceKind: wordfenceProgrammeSourceKindSchema,
  assertions: z.strictObject({
    eligibility: programmeEligibilitySchema.partial().optional(),
    programmeOpportunityBand: z
      .enum(["broad", "high-impact-only", "research-only"])
      .optional(),
    rewardFactors: z.array(policyTermSchema).min(1).optional(),
    rewardRoutes: z.array(programmeRewardRouteSchema).optional(),
    monthlyAggregates: z
      .array(programmeMonthlyAggregateSchema)
      .min(1)
      .optional(),
  }),
});

export type WordfenceProgrammeSourceKind = z.infer<
  typeof wordfenceProgrammeSourceKindSchema
>;
export type WordfenceProgrammePageDocument = z.infer<
  typeof wordfenceProgrammePageDocumentSchema
>;

export interface WordfenceProgrammePageAdapter {
  readonly sourceKind: WordfenceProgrammeSourceKind;
  readonly sourceUrl: string;
  readonly parserVersion: string;
  retrieve(): Promise<Uint8Array>;
  parse(bytes: Uint8Array): Promise<unknown> | unknown;
}

export interface CreateWordfenceProgrammeAdaptersOptions {
  readonly pages: readonly WordfenceProgrammePageAdapter[];
}
