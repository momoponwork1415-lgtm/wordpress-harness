import { z } from "zod";

import {
  surfaceMapRefSchema,
  surfaceMapSchema,
  type SurfaceMap,
  type SurfaceMapRef,
} from "../source-mapping/contracts.js";

const digestSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const identifierSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
const relativePathSchema = z
  .string()
  .min(1)
  .refine(
    (path) =>
      !path.startsWith("/") &&
      !path.includes("\\") &&
      !path.split("/").includes(".."),
    { message: "File path must be a normalized relative path" },
  );

export const explorationPolicyRefSchema = z.strictObject({
  kind: z.literal("exploration-policy"),
  schemaVersion: z.literal(1),
  id: identifierSchema,
  digest: digestSchema,
});

const leaseBudgetSchema = z.strictObject({
  maxWallTimeMs: z.number().int().positive(),
  maxModelTokens: z.number().int().positive(),
  maxHypotheses: z.number().int().positive(),
});

export const explorationBootstrapPolicySchema = z
  .strictObject({
    kind: z.literal("exploration-bootstrap-policy"),
    schemaVersion: z.literal(1),
    id: identifierSchema,
    maxFocusAreas: z.number().int().positive(),
    maxLeases: z.number().int().min(2),
    eligibleModelFamilies: z.array(identifierSchema).min(1),
    leaseBudget: leaseBudgetSchema,
  })
  .superRefine((policy, context) => {
    if (
      new Set(policy.eligibleModelFamilies).size !==
      policy.eligibleModelFamilies.length
    ) {
      context.addIssue({
        code: "custom",
        path: ["eligibleModelFamilies"],
        message: "Model families must be unique",
      });
    }
  });

export const explorationDecisionInputSchema = z.strictObject({
  kind: z.literal("bootstrap"),
  map: surfaceMapRefSchema,
  policy: explorationPolicyRefSchema,
});

const focusOwnerSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("surface-node"),
    nodeId: digestSchema,
    nodeKind: z.enum(["entry", "guard", "source", "state", "sink"]),
  }),
  z.strictObject({
    kind: z.literal("source-file"),
    path: relativePathSchema,
    fileDigest: digestSchema,
  }),
  z.strictObject({
    kind: z.literal("coverage-gap"),
    gapId: digestSchema,
    path: relativePathSchema,
  }),
]);

const laneSchema = z.enum(["frontier", "primitive", "coverage"]);
const strategySchema = z.enum([
  "entry-forward",
  "sink-backward",
  "state-chain",
  "invariant-review",
  "wildcard",
]);

const focusAreaSchema = z.strictObject({
  id: digestSchema,
  owner: focusOwnerSchema,
  lane: laneSchema,
  brief: z.strictObject({
    feature: z.enum([
      "rest-route",
      "hook",
      "guard",
      "source",
      "state",
      "sink",
      "unregistered-php-file",
      "unmapped-asset",
    ]),
    actor: z.literal("unresolved"),
    requiredPrivilege: z.literal("unresolved"),
    stateTransition: z.enum(["read", "write", "unresolved"]),
    securityInvariant: z.enum([
      "entry-authorization-and-input-handling",
      "authorization-boundary",
      "input-integrity",
      "persistent-state-integrity",
      "output-integrity",
      "direct-request-safety",
      "coverage-completeness",
    ]),
  }),
  risk: z.strictObject({
    tier: z.enum(["elevated", "standard", "coverage"]),
    basis: z.enum([
      "external-rest-route",
      "registered-hook",
      "authorization-boundary",
      "input-source",
      "persistent-state",
      "security-sensitive-sink",
      "unregistered-php-file",
      "mapping-gap",
    ]),
  }),
});

const workLeaseSchema = z.strictObject({
  id: digestSchema,
  focusAreaId: digestSchema,
  role: z.literal("finder"),
  lane: laneSchema,
  strategy: strategySchema,
  modelFamilyConstraint: z.discriminatedUnion("kind", [
    z.strictObject({
      kind: z.literal("require"),
      family: identifierSchema,
    }),
    z.strictObject({
      kind: z.literal("reuse-with-exception"),
      family: identifierSchema,
      reason: z.literal("single-eligible-family"),
    }),
  ]),
  budget: leaseBudgetSchema,
});

const workWavePlanSchema = z.strictObject({
  kind: z.literal("work-wave-plan"),
  schemaVersion: z.literal(1),
  id: digestSchema,
  map: surfaceMapRefSchema,
  policy: explorationPolicyRefSchema,
  focusAreas: z.array(focusAreaSchema).min(1),
  leases: z.array(workLeaseSchema).min(1),
});

const mappingEvidenceRequestSchema = z.strictObject({
  kind: z.literal("mapping-evidence-request"),
  schemaVersion: z.literal(1),
  id: digestSchema,
  map: surfaceMapRefSchema,
  reason: z.literal("minimum-map-gate-failed"),
  needs: z.array(z.string().min(1)).min(1),
});

const explorationGapSchema = z.strictObject({
  kind: z.literal("exploration-gap"),
  schemaVersion: z.literal(1),
  id: digestSchema,
  reason: z.literal("empty-inventory"),
  requiredEvidence: z.array(z.string().min(1)).min(1),
});

export const explorationDecisionSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("run-wave"), plan: workWavePlanSchema }),
  z.strictObject({
    kind: z.literal("revise-map"),
    request: mappingEvidenceRequestSchema,
  }),
  z.strictObject({
    kind: z.literal("blocked"),
    gaps: z.array(explorationGapSchema).min(1),
  }),
]);

export type ExplorationBootstrapPolicy = z.infer<
  typeof explorationBootstrapPolicySchema
>;
export type ExplorationPolicyRef = z.infer<typeof explorationPolicyRefSchema>;
export type ExplorationDecisionInput = z.infer<
  typeof explorationDecisionInputSchema
>;
export type ExplorationDecision = z.infer<typeof explorationDecisionSchema>;
export type FocusArea = z.infer<typeof focusAreaSchema>;
export type WorkLease = z.infer<typeof workLeaseSchema>;

export interface Exploration {
  decide(input: ExplorationDecisionInput): ExplorationDecision;
}

export interface OpenExplorationOptions {
  readonly surfaceMap: {
    readonly ref: SurfaceMapRef;
    readonly value: SurfaceMap;
  };
  readonly policy: {
    readonly ref: ExplorationPolicyRef;
    readonly value: ExplorationBootstrapPolicy;
  };
}

export { surfaceMapRefSchema, surfaceMapSchema };
