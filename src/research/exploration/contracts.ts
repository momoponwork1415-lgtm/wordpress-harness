import { z } from "zod";

import { modelAttemptUsageV2Schema } from "../model-attempt-usage-contracts.js";
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

export const explorationStateRefSchema = z.strictObject({
  kind: z.literal("exploration-state"),
  schemaVersion: z.literal(1),
  digest: digestSchema,
  mapDigest: digestSchema,
  policyDigest: digestSchema,
});

export const workWaveRefSchema = z.strictObject({
  kind: z.literal("work-wave"),
  schemaVersion: z.literal(1),
  id: digestSchema,
  digest: digestSchema,
  mapDigest: digestSchema,
});

export const workWavePlanSchema = z.strictObject({
  kind: z.literal("work-wave-plan"),
  schemaVersion: z.literal(1),
  id: digestSchema,
  ref: workWaveRefSchema,
  state: explorationStateRefSchema,
  map: surfaceMapRefSchema,
  policy: explorationPolicyRefSchema,
  focusAreas: z.array(focusAreaSchema).min(1),
  leases: z.array(workLeaseSchema).min(1),
});

const boundedTextSchema = z.string().min(1).max(1_000);

const causalIdentitySchema = z.strictObject({
  rootCause: identifierSchema,
  attackerControlledPrimitive: identifierSchema,
  brokenSecurityProperty: identifierSchema,
});

const unresolvedEvidenceSchema = z.strictObject({
  claim: boundedTextSchema,
  requiredEvidence: boundedTextSchema,
});

const sourceEvidenceAnchorSchema = z
  .strictObject({
    path: relativePathSchema,
    fileDigest: digestSchema,
    startLine: z.number().int().positive(),
    endLine: z.number().int().positive(),
  })
  .refine((anchor) => anchor.endLine >= anchor.startLine, {
    message: "Source evidence endLine must not precede startLine",
  });

export const routeFragmentProposalSchema = z.strictObject({
  kind: z.literal("route-fragment-proposal"),
  schemaVersion: z.literal(1),
  attackerPremise: z.enum([
    "unauthenticated",
    "subscriber",
    "contributor",
    "customer",
    "unresolved",
  ]),
  preconditions: z.array(boundedTextSchema).min(1),
  operation: boundedTextSchema,
  consumedValues: z.array(
    z.strictObject({
      identity: identifierSchema,
      provenance: z.enum([
        "attacker-controlled",
        "system-generated",
        "persisted",
        "unknown",
      ]),
    }),
  ),
  producedValues: z.array(
    z.strictObject({
      identity: identifierSchema,
      capability: z.enum([
        "read",
        "write",
        "authenticate",
        "impersonate",
        "query-control",
        "output-control",
        "file-control",
        "code-execution",
        "other",
      ]),
    }),
  ),
  stateTransitions: z
    .array(
      z.strictObject({
        stateIdentity: identifierSchema,
        operation: z.enum(["read", "write", "transition", "delete"]),
        effect: boundedTextSchema,
      }),
    )
    .min(1),
  evidence: z.array(sourceEvidenceAnchorSchema).min(1),
  unknowns: z.array(unresolvedEvidenceSchema).min(1),
  falsifier: boundedTextSchema,
  nextInvestigation: boundedTextSchema,
});

export const sourceBoundHypothesisSchema = z.strictObject({
  kind: z.literal("source-bound-hypothesis"),
  schemaVersion: z.literal(1),
  causalIdentity: causalIdentitySchema,
  attackerPremise: z.enum([
    "unauthenticated",
    "subscriber",
    "contributor",
    "customer",
    "unresolved",
  ]),
  impact: z.enum([
    "arbitrary-code-execution",
    "site-wide-compromise",
    "account-takeover",
    "sql-injection",
    "stored-xss",
    "reflected-xss",
    "dom-xss",
    "authorization-bypass",
    "file-write",
    "path-traversal",
    "other",
  ]),
  route: z.strictObject({
    anchors: z.array(sourceEvidenceAnchorSchema).min(1),
  }),
  unknowns: z.array(unresolvedEvidenceSchema).min(1),
  falsifier: boundedTextSchema,
  nextExperiment: boundedTextSchema,
});

export const finderOutputSchema = z.strictObject({
  kind: z.literal("finder-output"),
  schemaVersion: z.literal(1),
  leaseId: digestSchema,
  hypotheses: z.array(sourceBoundHypothesisSchema),
  routeFragments: z.array(routeFragmentProposalSchema).optional(),
});

export const finderAttemptResultSchema = z.discriminatedUnion("status", [
  z.strictObject({
    kind: z.literal("finder-attempt-result"),
    schemaVersion: z.literal(1),
    attemptId: identifierSchema,
    leaseId: digestSchema,
    status: z.literal("completed"),
    output: finderOutputSchema,
    usage: modelAttemptUsageV2Schema.optional(),
  }),
  z.strictObject({
    kind: z.literal("finder-attempt-result"),
    schemaVersion: z.literal(1),
    attemptId: identifierSchema,
    leaseId: digestSchema,
    status: z.enum([
      "invalid-output",
      "policy-denied",
      "auth-required",
      "provider-failed",
      "budget-exhausted",
      "cancelled",
      "orphaned",
    ]),
    reason: boundedTextSchema,
    usage: modelAttemptUsageV2Schema.optional(),
  }),
]);

export const attemptExecutionResultRefSchema = z.strictObject({
  kind: z.literal("attempt-execution-result"),
  schemaVersion: z.literal(1),
  attemptId: identifierSchema,
  leaseId: digestSchema,
  digest: digestSchema,
});

const hypothesisRefSchema = z.strictObject({
  kind: z.literal("hypothesis"),
  schemaVersion: z.literal(1),
  id: digestSchema,
  digest: digestSchema,
  mapDigest: digestSchema,
  sourceResult: attemptExecutionResultRefSchema,
});

export const explorationDecisionInputSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("bootstrap"),
    map: surfaceMapRefSchema,
    policy: explorationPolicyRefSchema,
  }),
  z.strictObject({
    kind: z.literal("wave-completed"),
    map: surfaceMapRefSchema,
    state: explorationStateRefSchema,
    wave: workWaveRefSchema,
    results: z.array(attemptExecutionResultRefSchema).min(1),
  }),
]);

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
  reason: z.enum(["empty-inventory", "no-source-bound-hypothesis"]),
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
  z.strictObject({
    kind: z.literal("verify"),
    hypotheses: z.array(hypothesisRefSchema).min(1),
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
export type WorkWavePlan = z.infer<typeof workWavePlanSchema>;
export type WorkWaveRef = z.infer<typeof workWaveRefSchema>;
export type ExplorationStateRef = z.infer<typeof explorationStateRefSchema>;
export type FinderAttemptResult = z.infer<typeof finderAttemptResultSchema>;
export type AttemptExecutionResultRef = z.infer<
  typeof attemptExecutionResultRefSchema
>;
export type SourceBoundHypothesis = z.infer<typeof sourceBoundHypothesisSchema>;
export type RouteFragmentProposal = z.infer<typeof routeFragmentProposalSchema>;

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
  readonly waveCompletion?: {
    readonly state: ExplorationStateRef;
    readonly wave: {
      readonly ref: WorkWaveRef;
      readonly value: WorkWavePlan;
    };
    readonly results: readonly {
      readonly ref: AttemptExecutionResultRef;
      readonly value: FinderAttemptResult;
    }[];
  };
}

export { surfaceMapRefSchema, surfaceMapSchema };
