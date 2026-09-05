import { z } from "zod";

const digestSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const identifierSchema = z
  .string()
  .min(1)
  .max(160)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
const pluginIdentitySchema = z
  .string()
  .regex(
    /^(?:wporg:[a-z0-9][a-z0-9-]*|premium:[a-z0-9][a-z0-9-]*\/[a-z0-9][a-z0-9-]*)$/,
  );
const routeTermSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[a-z0-9][a-z0-9-]*$/);
const httpsUrlSchema = z
  .url()
  .refine((value) => new URL(value).protocol === "https:");

export const disclosureRouteSourceKindSchema = z.enum([
  "vendor-official",
  "official-repository-security",
  "wordpress-org-maintainer",
  "programme-directory",
  "search-result",
]);

export const disclosureRouteClaimKindSchema = z.enum([
  "first-party-bounty",
  "first-party-vdp",
  "delegated-vdp",
  "security-contact-only",
  "none-found",
]);

export const disclosureSubmissionRouteSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("web-form"), url: httpsUrlSchema }),
  z.strictObject({
    kind: z.literal("email"),
    address: z.string().email().max(254),
  }),
  z.strictObject({ kind: z.literal("none") }),
]);

export const disclosureRouteConditionsSchema = z.strictObject({
  exclusivity: z.enum(["required", "permitted", "unspecified"]),
  disclosure: z.enum([
    "coordinated-required",
    "programme-coordinated",
    "unspecified",
  ]),
});

export const disclosureRouteSourceClaimSchema = z
  .strictObject({
    routeKind: disclosureRouteClaimKindSchema,
    checkedScopes: z.array(routeTermSchema).min(1),
    submissionRoute: disclosureSubmissionRouteSchema,
    conditions: disclosureRouteConditionsSchema,
  })
  .superRefine((claim, context) => {
    if (
      (claim.routeKind === "none-found") !==
      (claim.submissionRoute.kind === "none")
    ) {
      context.addIssue({
        code: "custom",
        path: ["submissionRoute"],
        message: "none-found and submissionRoute must agree",
      });
    }
  });

export const disclosureRouteSourceDocumentSchema = z.strictObject({
  kind: z.literal("disclosure-route-source-document"),
  schemaVersion: z.literal(1),
  claim: disclosureRouteSourceClaimSchema,
});

export const disclosureRouteObserveRequestSchema = z.strictObject({
  kind: z.literal("disclosure-route-observe"),
  schemaVersion: z.literal(1),
  pluginIdentity: pluginIdentitySchema,
  requiredFor: z.enum(["target-selection-batch", "submission-staging"]),
});

export const disclosureRouteSourceSnapshotSchema = z.strictObject({
  sourceId: identifierSchema,
  sourceKind: disclosureRouteSourceKindSchema,
  sourceUrl: httpsUrlSchema,
  finalUrl: httpsUrlSchema,
  sourceOwner: z.string().trim().min(1).max(160),
  retrievedAt: z.string().datetime({ offset: true }),
  contentDigest: digestSchema,
  parserVersion: identifierSchema,
  claim: disclosureRouteSourceClaimSchema,
});

export const disclosureRouteObservationSchema = z.strictObject({
  kind: z.literal("disclosure-route-observation"),
  schemaVersion: z.literal(1),
  pluginIdentity: pluginIdentitySchema,
  requiredFor: z.enum(["target-selection-batch", "submission-staging"]),
  retrievedAt: z.string().datetime({ offset: true }),
  route: z.strictObject({
    kind: z.enum([
      "first-party-bounty",
      "first-party-vdp",
      "delegated-vdp",
      "security-contact-only",
      "none-found",
      "conflicting",
    ]),
    checkedScopes: z.array(routeTermSchema).min(1),
    submissionRoutes: z.array(disclosureSubmissionRouteSchema),
    conditions: z.array(disclosureRouteConditionsSchema),
    strongestEvidenceSourceId: identifierSchema.optional(),
    humanReviewRequired: z.boolean(),
    residualUncertainty: z.literal("only-checked-sources").optional(),
  }),
  sources: z.array(disclosureRouteSourceSnapshotSchema).min(1),
});

export const disclosureRouteObservationRefSchema = z.strictObject({
  kind: z.literal("disclosure-route-observation-ref"),
  schemaVersion: z.literal(1),
  id: identifierSchema,
  digest: digestSchema,
  routeDigest: digestSchema,
});

export type DisclosureRouteSourceKind = z.infer<
  typeof disclosureRouteSourceKindSchema
>;
export type DisclosureRouteSourceDocument = z.infer<
  typeof disclosureRouteSourceDocumentSchema
>;
export type DisclosureRouteSourceClaim = z.infer<
  typeof disclosureRouteSourceClaimSchema
>;
export type DisclosureRouteObserveRequest = z.infer<
  typeof disclosureRouteObserveRequestSchema
>;
export type DisclosureRouteSourceSnapshot = z.infer<
  typeof disclosureRouteSourceSnapshotSchema
>;
export type DisclosureRouteObservation = z.infer<
  typeof disclosureRouteObservationSchema
>;
export type DisclosureRouteObservationRef = z.infer<
  typeof disclosureRouteObservationRefSchema
>;

export interface DisclosureRouteSourceAdapter {
  readonly sourceId: string;
  readonly sourceKind: DisclosureRouteSourceKind;
  readonly sourceUrl: string;
  readonly sourceOwner: string;
  readonly parserVersion: string;
  readonly allowedOrigins: readonly string[];
  retrieve(): Promise<{
    readonly bytes: Uint8Array;
    readonly finalUrl: string;
  }>;
  parse(bytes: Uint8Array): Promise<unknown> | unknown;
}

export type DisclosureRouteErrorCode =
  "acquisition-failed" | "parse-failed" | "untrusted-provenance";

export class DisclosureRouteError extends Error {
  readonly code: DisclosureRouteErrorCode;
  readonly sourceId: string;

  constructor(code: DisclosureRouteErrorCode, sourceId: string) {
    super(`Disclosure Route ${code}: ${sourceId}`);
    this.name = "DisclosureRouteError";
    this.code = code;
    this.sourceId = sourceId;
  }
}

export interface DisclosureRoute {
  observe(
    request: DisclosureRouteObserveRequest,
  ): Promise<DisclosureRouteObservationRef>;
  inspect(
    ref: DisclosureRouteObservationRef,
  ): Promise<DisclosureRouteObservation>;
}

export interface OpenDisclosureRouteOptions {
  readonly storageDirectory: string;
  readonly sourceAdapters: readonly DisclosureRouteSourceAdapter[];
  readonly clock?: () => Date;
}
