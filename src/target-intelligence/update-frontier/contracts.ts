import { z } from "zod";

import { canonicalDigest } from "../../infrastructure/canonical-json.js";
import type { WordPressOrgTargetSource } from "../acquisition/index.js";

const digestSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const identifierSchema = z
  .string()
  .min(1)
  .max(160)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
const slugSchema = z.string().regex(/^[a-z0-9][a-z0-9-]*$/);
const repositoryUrlSchema = z.literal("https://plugins.svn.wordpress.org");

const immutableEvidenceRefSchema = z.strictObject({
  id: identifierSchema,
  digest: digestSchema,
  byteLength: z.number().int().nonnegative(),
});

const wordPressOrgUpdateFrontierPolicyBodySchema = z.strictObject({
  kind: z.literal("wordpress-org-update-frontier-policy"),
  schemaVersion: z.literal(1),
  id: identifierSchema,
  minimumActiveInstallations: z.number().int().nonnegative(),
  maximumRevisions: z.number().int().positive().max(1_000),
  maximumLogBytes: z.number().int().positive(),
  maximumDiffBytes: z.number().int().positive(),
});

export const wordPressOrgUpdateFrontierPolicySchema =
  wordPressOrgUpdateFrontierPolicyBodySchema
    .extend({ digest: digestSchema })
    .superRefine((policy, context) => {
      const { digest, ...body } = policy;
      if (digest !== canonicalDigest(body)) {
        context.addIssue({
          code: "custom",
          path: ["digest"],
          message: "Update Frontier policy digest must bind its exact body",
        });
      }
    });

export const wordPressOrgUpdateFrontierRefreshRequestSchema = z.strictObject({
  kind: z.literal("wordpress-org-update-frontier-refresh"),
  schemaVersion: z.literal(1),
  frontierKey: identifierSchema,
  revision: z.number().int().positive(),
  fromRevisionExclusive: z.number().int().nonnegative(),
  policy: wordPressOrgUpdateFrontierPolicySchema,
});

export const wordPressOrgChangesetSourceRequestSchema = z.discriminatedUnion(
  "kind",
  [
    z.strictObject({
      kind: z.literal("log"),
      fromRevisionExclusive: z.number().int().nonnegative(),
      maximumRevisions: z.number().int().positive().max(1_000),
      maximumBytes: z.number().int().positive(),
    }),
    z.strictObject({
      kind: z.literal("diff"),
      revision: z.number().int().positive(),
      pluginSlug: slugSchema,
      maximumBytes: z.number().int().positive(),
    }),
  ],
);

export const wordPressOrgChangesetSourceResponseSchema = z.strictObject({
  repositoryUrl: repositoryUrlSchema,
  bytes: z.custom<Uint8Array<ArrayBufferLike>>(
    (value) => value instanceof Uint8Array,
  ),
});

export const wordPressOrgUpdateNavigationSignalSchema = z.enum([
  "authorization-boundary",
  "database-effect",
  "dynamic-execution",
  "filesystem-effect",
  "object-deserialization",
  "output-boundary",
  "request-input",
]);

const changesetSummarySchema = z.strictObject({
  revision: z.number().int().positive(),
  committedAt: z.iso.datetime(),
  changedPhpFiles: z.number().int().positive(),
  addedPhpLines: z.number().int().nonnegative(),
  navigationSignals: z.array(wordPressOrgUpdateNavigationSignalSchema),
  evidenceRef: immutableEvidenceRefSchema,
});

const updateLeadSchema = z.strictObject({
  pluginIdentity: z.string().regex(/^wporg:[a-z0-9][a-z0-9-]*$/),
  officialSlug: slugSchema,
  stableVersion: z.string().min(1).max(64),
  activeInstallations: z.number().int().nonnegative(),
  lastUpdated: z.string().min(1).max(128),
  observedAt: z.iso.datetime(),
  observationRef: z.strictObject({
    kind: z.literal("wordpress-org-target-observation-ref"),
    schemaVersion: z.literal(1),
    id: identifierSchema,
    digest: digestSchema,
  }),
  changesets: z.array(changesetSummarySchema).min(1),
});

const unresolvedObservationSchema = z.strictObject({
  pluginIdentity: z.string().regex(/^wporg:[a-z0-9][a-z0-9-]*$/),
  revisions: z.array(z.number().int().positive()).min(1),
  reason: z.enum([
    "not-found",
    "rate-limited",
    "network-failure",
    "quota-exceeded",
    "invalid-metadata",
  ]),
});

const wordPressOrgUpdateFrontierBodySchema = z.strictObject({
  kind: z.literal("wordpress-org-update-frontier"),
  schemaVersion: z.literal(1),
  inputDigest: digestSchema,
  frontierKey: identifierSchema,
  revision: z.number().int().positive(),
  generatedAt: z.iso.datetime(),
  source: z.strictObject({
    kind: z.literal("wordpress-org-svn"),
    repositoryUrl: repositoryUrlSchema,
    parserVersion: z.literal("wordpress-org-svn-update-frontier-v1"),
    logEvidenceRef: immutableEvidenceRefSchema,
  }),
  cursor: z.strictObject({
    fromRevisionExclusive: z.number().int().nonnegative(),
    toRevisionInclusive: z.number().int().nonnegative(),
  }),
  policy: z.strictObject({ id: identifierSchema, digest: digestSchema }),
  leads: z.array(updateLeadSchema),
  unresolved: z.array(unresolvedObservationSchema),
  filtered: z.strictObject({
    belowMinimumActiveInstallations: z.number().int().nonnegative(),
    revisionsWithoutTrunkPhpChanges: z.number().int().nonnegative(),
  }),
});

export const wordPressOrgUpdateFrontierSchema =
  wordPressOrgUpdateFrontierBodySchema
    .extend({ id: identifierSchema, digest: digestSchema })
    .superRefine((frontier, context) => {
      const { id, digest, ...body } = frontier;
      if (digest !== canonicalDigest(body)) {
        context.addIssue({
          code: "custom",
          path: ["digest"],
          message: "Update Frontier digest must bind its exact body",
        });
      }
      if (id !== `wporg-update-frontier:${digest.slice(7, 31)}`) {
        context.addIssue({
          code: "custom",
          path: ["id"],
          message: "Update Frontier ID must derive from its digest",
        });
      }
      if (
        frontier.cursor.toRevisionInclusive <
        frontier.cursor.fromRevisionExclusive
      ) {
        context.addIssue({
          code: "custom",
          path: ["cursor", "toRevisionInclusive"],
          message: "Update Frontier cursor must not move backwards",
        });
      }
    });

export const wordPressOrgUpdateFrontierRefSchema = z.strictObject({
  kind: z.literal("wordpress-org-update-frontier-ref"),
  schemaVersion: z.literal(1),
  id: identifierSchema,
  digest: digestSchema,
  frontierKey: identifierSchema,
  revision: z.number().int().positive(),
  toRevisionInclusive: z.number().int().nonnegative(),
});

export type WordPressOrgUpdateFrontierPolicy = z.infer<
  typeof wordPressOrgUpdateFrontierPolicySchema
>;
export type WordPressOrgUpdateFrontierRefreshRequest = z.infer<
  typeof wordPressOrgUpdateFrontierRefreshRequestSchema
>;
export type WordPressOrgChangesetSourceRequest = z.infer<
  typeof wordPressOrgChangesetSourceRequestSchema
>;
export type WordPressOrgChangesetSourceResponse = z.infer<
  typeof wordPressOrgChangesetSourceResponseSchema
>;
export type WordPressOrgUpdateNavigationSignal = z.infer<
  typeof wordPressOrgUpdateNavigationSignalSchema
>;
export type WordPressOrgUpdateFrontier = z.infer<
  typeof wordPressOrgUpdateFrontierSchema
>;
export type WordPressOrgUpdateFrontierRef = z.infer<
  typeof wordPressOrgUpdateFrontierRefSchema
>;

export interface WordPressOrgChangesetSource {
  retrieve(
    request: WordPressOrgChangesetSourceRequest,
  ): Promise<WordPressOrgChangesetSourceResponse>;
}

export type WordPressOrgChangesetSourceErrorCode =
  "source-failed" | "timed-out" | "quota-exceeded";

export class WordPressOrgChangesetSourceError extends Error {
  constructor(
    readonly code: WordPressOrgChangesetSourceErrorCode,
    readonly operation: WordPressOrgChangesetSourceRequest["kind"],
  ) {
    super(`WordPress.org changeset ${operation} ${code}`);
    this.name = "WordPressOrgChangesetSourceError";
  }
}

export type WordPressOrgUpdateFrontierFailureReason =
  | "source-failed"
  | "source-timeout"
  | "source-quota-exceeded"
  | "invalid-log"
  | "invalid-diff";

export type WordPressOrgUpdateFrontierRefreshResult =
  | {
      readonly status: "current";
      readonly frontierRef: WordPressOrgUpdateFrontierRef;
    }
  | {
      readonly status: "failed";
      readonly frontierKey: string;
      readonly revision: number;
      readonly inputDigest: string;
      readonly reason: WordPressOrgUpdateFrontierFailureReason;
    };

export interface WordPressOrgUpdateFrontiers {
  refresh(
    request: WordPressOrgUpdateFrontierRefreshRequest,
  ): Promise<WordPressOrgUpdateFrontierRefreshResult>;
  inspect(
    ref: WordPressOrgUpdateFrontierRef,
  ): Promise<WordPressOrgUpdateFrontier>;
}

export interface OpenWordPressOrgUpdateFrontiersOptions {
  readonly storageDirectory: string;
  readonly changesetSource: WordPressOrgChangesetSource;
  readonly targetSource: WordPressOrgTargetSource;
  readonly clock?: () => Date;
}

export interface CreateSvnWordPressOrgChangesetSourceOptions {
  readonly svnExecutablePath?: string;
  readonly timeoutMs?: number;
}
