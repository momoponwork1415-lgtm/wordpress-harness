import { z } from "zod";

import { canonicalDigest } from "../../infrastructure/canonical-json.js";
import {
  targetIntakePolicySchema,
  type WordPressOrgTargetSource,
} from "../acquisition/index.js";
import {
  wordPressOrgUpdateFrontierRefSchema,
  wordPressOrgUpdateNavigationSignalSchema,
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

const termSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[a-z0-9][a-z0-9-]*$/);
export const targetIdentitySchema = z.strictObject({
  pluginIdentity: z
    .string()
    .regex(
      /^(?:wporg:[a-z0-9][a-z0-9-]*|premium:[a-z0-9][a-z0-9-]*\/[a-z0-9][a-z0-9-]*)$/,
    ),
  verifiedVersion: z.string().min(1).max(64),
  canonicalFileManifestDigest: digestSchema,
});

export const targetObservationSchema = z.strictObject({
  ref: immutableRefSchema,
  retrievedAt: z.iso.datetime(),
  currentUntil: z.iso.datetime(),
  acquisition: z.enum(["available", "unavailable"]),
  provenance: z.enum(["verified", "unverified", "conflicting"]),
  identity: z.enum(["verified", "unverified"]),
});

const selectionFactsSchema = z.strictObject({
  activeInstallCount: z.number().int().nonnegative(),
  lastUpdatedAt: z.iso.datetime(),
  integrations: z.array(termSchema),
  sourceScale: z
    .strictObject({
      fileCount: z.number().int().positive(),
      byteCount: z.number().int().positive(),
      languages: z.array(termSchema).min(1),
    })
    .optional(),
  updateActivity: z
    .strictObject({
      frontierRef: immutableRefSchema,
      fromRevisionExclusive: z.number().int().nonnegative(),
      toRevisionInclusive: z.number().int().nonnegative(),
      changesetCount: z.number().int().positive(),
      changedPhpFileOccurrences: z.number().int().positive(),
      addedPhpLines: z.number().int().nonnegative(),
      navigationSignals: z.array(wordPressOrgUpdateNavigationSignalSchema),
    })
    .optional(),
});

const programmeObservationSchema = z.strictObject({
  programmeIdentity: z.string().regex(/^programme:[a-z0-9][a-z0-9-]*$/),
  snapshotRef: immutableRefSchema,
  opportunityBand: z.enum(["broad", "high-impact-only", "research-only"]),
  eligibility: z.enum(["eligible", "ineligible", "unknown"]),
  currentUntil: z.iso.datetime(),
});

const disclosureRouteSchema = z.strictObject({
  observationRef: immutableRefSchema.extend({ routeDigest: digestSchema }),
  kind: z.enum([
    "first-party-bounty",
    "first-party-vdp",
    "delegated-vdp",
    "security-contact-only",
    "none-found",
    "conflicting",
  ]),
  currentUntil: z.iso.datetime(),
});

const researchHistorySchema = z.discriminatedUnion("status", [
  z.strictObject({ status: z.literal("new") }),
  z.strictObject({
    status: z.literal("active"),
    campaignId: identifierSchema,
  }),
  z.strictObject({
    status: z.literal("coverage-closed"),
    campaignId: identifierSchema,
  }),
  z.strictObject({
    status: z.literal("incomplete"),
    campaignId: identifierSchema,
  }),
]);

const vulnerabilityHistoryAggregateSchema = z.strictObject({
  snapshotRef: immutableRefSchema,
  publishedRecordCount: z.number().int().nonnegative(),
  densityBand: z.enum(["none", "low", "medium", "high"]),
  lastPublishedAt: z.iso.datetime().optional(),
});

export const targetCandidateSchema = z.strictObject({
  candidateId: identifierSchema,
  target: targetIdentitySchema,
  targetObservation: targetObservationSchema,
  selectionFacts: selectionFactsSchema,
  programmes: z.array(programmeObservationSchema),
  disclosureRoute: disclosureRouteSchema,
  vulnerabilityHistoryAggregate: vulnerabilityHistoryAggregateSchema.optional(),
  researchHistory: researchHistorySchema,
});

const targetCandidatePoolBodySchema = z.strictObject({
  kind: z.literal("target-candidate-pool"),
  schemaVersion: z.literal(1),
  id: identifierSchema,
  candidates: z.array(targetCandidateSchema).min(1),
});

export const targetCandidatePoolSchema = targetCandidatePoolBodySchema
  .extend({ digest: digestSchema })
  .superRefine((pool, context) => {
    const body = {
      kind: pool.kind,
      schemaVersion: pool.schemaVersion,
      id: pool.id,
      candidates: pool.candidates,
    };
    if (pool.digest !== canonicalDigest(body)) {
      context.addIssue({
        code: "custom",
        path: ["digest"],
        message: "Candidate Pool digest must bind its exact candidates",
      });
    }
    const candidateIds = new Set<string>();
    const targetIds = new Set<string>();
    for (const [index, candidate] of pool.candidates.entries()) {
      if (candidateIds.has(candidate.candidateId)) {
        context.addIssue({
          code: "custom",
          path: ["candidates", index, "candidateId"],
          message: "Candidate IDs must be unique",
        });
      }
      candidateIds.add(candidate.candidateId);
      const targetId = [
        candidate.target.pluginIdentity,
        candidate.target.verifiedVersion,
        candidate.target.canonicalFileManifestDigest,
      ].join("|");
      if (targetIds.has(targetId)) {
        context.addIssue({
          code: "custom",
          path: ["candidates", index, "target"],
          message: "A Target may occur only once in a Candidate Pool",
        });
      }
      targetIds.add(targetId);
    }
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

export type TargetCandidate = z.infer<typeof targetCandidateSchema>;
export type TargetCandidatePool = z.infer<typeof targetCandidatePoolSchema>;
