import { z } from "zod";

import { canonicalDigest } from "../../infrastructure/canonical-json.js";
import {
  targetIntakePolicySchema,
  type WordPressOrgTargetSource,
} from "../acquisition/index.js";
import {
  targetCandidatePoolSchema,
  targetCandidateSchema,
} from "../target-proposal/contracts.js";
import {
  wordPressOrgUpdateFrontierRefSchema,
  type WordPressOrgUpdateFrontiers,
} from "../update-frontier/contracts.js";

const digestSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const identifierSchema = z
  .string()
  .min(1)
  .max(160)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
const pluginIdentitySchema = z.string().regex(/^wporg:[a-z0-9][a-z0-9-]*$/);
const immutableRefSchema = z.strictObject({
  id: identifierSchema,
  digest: digestSchema,
});

const candidatePoolFreshnessPolicyBodySchema = z.strictObject({
  kind: z.literal("wordpress-org-candidate-pool-freshness-policy"),
  schemaVersion: z.literal(1),
  id: identifierSchema,
  maximumAgeMs: z.number().int().positive(),
});

export const wordPressOrgCandidatePoolFreshnessPolicySchema =
  candidatePoolFreshnessPolicyBodySchema
    .extend({ digest: digestSchema })
    .superRefine((policy, context) => {
      const { digest, ...body } = policy;
      if (digest !== canonicalDigest(body)) {
        context.addIssue({
          code: "custom",
          path: ["digest"],
          message: "Candidate Pool freshness policy digest must bind its body",
        });
      }
    });

export const wordPressOrgCandidateSelectionContextSchema = z.strictObject({
  pluginIdentity: pluginIdentitySchema,
  integrations: targetCandidateSchema.shape.selectionFacts.shape.integrations,
  programmes: targetCandidateSchema.shape.programmes,
  disclosureRoute: targetCandidateSchema.shape.disclosureRoute,
  vulnerabilityHistoryAggregate:
    targetCandidateSchema.shape.vulnerabilityHistoryAggregate,
  researchHistory: targetCandidateSchema.shape.researchHistory,
});

export const wordPressOrgUpdateCandidatePoolAssemblyRequestSchema = z
  .strictObject({
    kind: z.literal("wordpress-org-update-candidate-pool-assembly"),
    schemaVersion: z.literal(1),
    assemblyKey: identifierSchema,
    revision: z.number().int().positive(),
    candidatePoolId: identifierSchema,
    updateFrontierRef: wordPressOrgUpdateFrontierRefSchema,
    targetIntakePolicy: targetIntakePolicySchema,
    freshnessPolicy: wordPressOrgCandidatePoolFreshnessPolicySchema,
    selectionContexts: z.array(wordPressOrgCandidateSelectionContextSchema),
  })
  .superRefine((request, context) => {
    const identities = new Set<string>();
    for (const [
      index,
      selectionContext,
    ] of request.selectionContexts.entries()) {
      if (identities.has(selectionContext.pluginIdentity)) {
        context.addIssue({
          code: "custom",
          path: ["selectionContexts", index, "pluginIdentity"],
          message: "Selection Context plugin identities must be unique",
        });
      }
      identities.add(selectionContext.pluginIdentity);
    }
  });

const assemblyGapSchema = z.strictObject({
  pluginIdentity: pluginIdentitySchema,
  reason: z.enum([
    "selection-context-missing",
    "selection-observation-expired",
    "target-observation-expired",
    "target-metadata-invalid",
    "source-acquisition-failed",
    "source-binding-mismatch",
  ]),
  detail: z.string().min(1).max(256).optional(),
});

const assemblyRecordBase = {
  kind: z.literal("wordpress-org-update-candidate-pool-assembly-record"),
  schemaVersion: z.literal(1),
  inputDigest: digestSchema,
  assemblyKey: identifierSchema,
  revision: z.number().int().positive(),
  candidatePoolId: identifierSchema,
  updateFrontierRef: wordPressOrgUpdateFrontierRefSchema,
  targetIntakePolicy: immutableRefSchema,
  freshnessPolicy: immutableRefSchema,
  assembledAt: z.iso.datetime(),
  upstreamUnresolved: z.number().int().nonnegative(),
  unresolved: z.array(assemblyGapSchema),
};

export const wordPressOrgUpdateCandidatePoolAssemblyRecordSchema = z
  .discriminatedUnion("status", [
    z.strictObject({
      ...assemblyRecordBase,
      status: z.literal("assembled"),
      candidatePool: targetCandidatePoolSchema,
      id: identifierSchema,
      digest: digestSchema,
    }),
    z.strictObject({
      ...assemblyRecordBase,
      status: z.literal("assembly-pending"),
      id: identifierSchema,
      digest: digestSchema,
    }),
  ])
  .superRefine((record, context) => {
    const { id, digest, ...body } = record;
    if (digest !== canonicalDigest(body)) {
      context.addIssue({
        code: "custom",
        path: ["digest"],
        message: "Candidate Pool Assembly digest must bind its exact body",
      });
    }
    if (id !== `update-candidate-pool-assembly:${digest.slice(7, 31)}`) {
      context.addIssue({
        code: "custom",
        path: ["id"],
        message: "Candidate Pool Assembly ID must derive from its digest",
      });
    }
  });

const assemblyRefBase = {
  kind: z.literal("wordpress-org-update-candidate-pool-assembly-ref"),
  schemaVersion: z.literal(1),
  id: identifierSchema,
  digest: digestSchema,
  assemblyKey: identifierSchema,
  revision: z.number().int().positive(),
};

export const wordPressOrgUpdateCandidatePoolAssemblyRefSchema =
  z.discriminatedUnion("status", [
    z.strictObject({
      ...assemblyRefBase,
      status: z.literal("assembled"),
      candidatePoolRef: immutableRefSchema,
    }),
    z.strictObject({
      ...assemblyRefBase,
      status: z.literal("assembly-pending"),
    }),
  ]);

export type WordPressOrgCandidatePoolFreshnessPolicy = z.infer<
  typeof wordPressOrgCandidatePoolFreshnessPolicySchema
>;
export type WordPressOrgCandidateSelectionContext = z.infer<
  typeof wordPressOrgCandidateSelectionContextSchema
>;
export type WordPressOrgUpdateCandidatePoolAssemblyRequest = z.infer<
  typeof wordPressOrgUpdateCandidatePoolAssemblyRequestSchema
>;
export type WordPressOrgUpdateCandidatePoolAssemblyRecord = z.infer<
  typeof wordPressOrgUpdateCandidatePoolAssemblyRecordSchema
>;
export type WordPressOrgUpdateCandidatePoolAssemblyRef = z.infer<
  typeof wordPressOrgUpdateCandidatePoolAssemblyRefSchema
>;

export type WordPressOrgUpdateCandidatePoolAssemblyResult =
  | {
      readonly status: "assembled";
      readonly assemblyRef: Extract<
        WordPressOrgUpdateCandidatePoolAssemblyRef,
        { readonly status: "assembled" }
      >;
    }
  | {
      readonly status: "assembly-pending";
      readonly assemblyRef: Extract<
        WordPressOrgUpdateCandidatePoolAssemblyRef,
        { readonly status: "assembly-pending" }
      >;
    };

export interface WordPressOrgUpdateCandidatePools {
  assemble(
    request: WordPressOrgUpdateCandidatePoolAssemblyRequest,
  ): Promise<WordPressOrgUpdateCandidatePoolAssemblyResult>;
  inspect(
    ref: WordPressOrgUpdateCandidatePoolAssemblyRef,
  ): Promise<WordPressOrgUpdateCandidatePoolAssemblyRecord>;
}

export interface OpenWordPressOrgUpdateCandidatePoolsOptions {
  readonly storageDirectory: string;
  readonly updateFrontiers: WordPressOrgUpdateFrontiers;
  readonly targetSource: WordPressOrgTargetSource;
  readonly clock?: () => Date;
}
