import { z } from "zod";

import {
  policyTermSchema,
  programmeEligibilitySchema,
  programmeRewardRouteSchema,
} from "../programme-intelligence/contracts.js";

export const patchstackProgrammeSourceKindSchema = z.enum([
  "rules",
  "report-form",
  "leaderboard",
  "marketing",
]);

export const patchstackProgrammePageDocumentSchema = z.strictObject({
  kind: z.literal("patchstack-programme-page"),
  schemaVersion: z.literal(1),
  sourceKind: patchstackProgrammeSourceKindSchema,
  precedence: z.number().int().min(1).max(4),
  assertions: z.strictObject({
    eligibility: programmeEligibilitySchema.partial().optional(),
    programmeOpportunityBand: z
      .enum(["broad", "high-impact-only", "research-only"])
      .optional(),
    rewardFactors: z.array(policyTermSchema).min(1).optional(),
    rewardRoutes: z.array(programmeRewardRouteSchema).optional(),
  }),
});

export type PatchstackProgrammeSourceKind = z.infer<
  typeof patchstackProgrammeSourceKindSchema
>;
export type PatchstackProgrammePageDocument = z.infer<
  typeof patchstackProgrammePageDocumentSchema
>;

export interface PatchstackProgrammePageAdapter {
  readonly sourceKind: PatchstackProgrammeSourceKind;
  readonly sourceUrl: string;
  readonly parserVersion: string;
  retrieve(): Promise<Uint8Array>;
  parse(bytes: Uint8Array): Promise<unknown> | unknown;
}

export interface CreatePatchstackProgrammeAdaptersOptions {
  readonly pages: readonly PatchstackProgrammePageAdapter[];
}
