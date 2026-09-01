import { z } from "zod";

import { targetSnapshotRefSchema } from "../contracts.js";
import { sourceBoundHypothesisSchema } from "../exploration/contracts.js";
import { sha256Digest } from "../research-record/canonical-json.js";

const identifierSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
const digestSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
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

const immutableRef = <Kind extends string>(kind: Kind) =>
  z.strictObject({
    kind: z.literal(kind),
    schemaVersion: z.literal(1),
    id: identifierSchema,
    digest: digestSchema,
  });

export const labBaselineRefSchema = z.strictObject({
  kind: z.literal("lab-baseline"),
  schemaVersion: z.literal(1),
  id: identifierSchema,
  digest: digestSchema,
  targetSnapshotDigest: digestSchema,
  runtimeProfileDigest: digestSchema,
  setupPlanDigest: digestSchema,
  configurationDigest: digestSchema,
});

const verifierModelProfileRefSchema = immutableRef("model-profile").extend({
  family: identifierSchema,
});

export const verificationPlanSchema = z
  .strictObject({
    kind: z.literal("verification-plan"),
    schemaVersion: z.literal(1),
    verificationId: identifierSchema,
    campaignId: identifierSchema,
    targetSnapshot: targetSnapshotRefSchema,
    scope: z.strictObject({
      permittedAttacker: z.enum(["unauthenticated", "subscriber", "customer"]),
    }),
    hypothesis: sourceBoundHypothesisSchema,
    hypothesisDigest: digestSchema,
    labBaseline: labBaselineRefSchema,
    verifierModelProfile: verifierModelProfileRefSchema,
    promptSet: immutableRef("prompt-set"),
    verificationPolicy: immutableRef("verification-policy"),
    experimentRegistry: immutableRef("experiment-registry"),
    budget: z.strictObject({
      maxVerifierAttempts: z.number().int().positive(),
      maxExperiments: z.number().int().min(2),
      maxWallTimeMs: z.number().int().positive(),
    }),
  })
  .superRefine((plan, context) => {
    if (plan.hypothesisDigest !== sha256Digest(plan.hypothesis)) {
      context.addIssue({
        code: "custom",
        path: ["hypothesisDigest"],
        message: "Hypothesis digest does not match the Hypothesis",
      });
    }
    if (plan.labBaseline.targetSnapshotDigest !== plan.targetSnapshot.digest) {
      context.addIssue({
        code: "custom",
        path: ["labBaseline", "targetSnapshotDigest"],
        message: "Lab Baseline is bound to a different Target Snapshot",
      });
    }
  });

const sourceEvidenceSchema = z.strictObject({
  path: relativePathSchema,
  fileDigest: digestSchema,
  startLine: z.number().int().positive(),
  endLine: z.number().int().positive(),
});

const storedXssExperimentMechanismSchema = z.strictObject({
  kind: z.literal("stored-xss-browser"),
  schemaVersion: z.literal(1),
  adapterVersion: z.literal("stored-xss-browser@v1"),
  causalFactor: identifierSchema,
  successCriterion: z.literal("privileged-browser-execution-canary"),
});

export const sourceRederivationSchema = z.strictObject({
  kind: z.literal("source-rederivation"),
  schemaVersion: z.literal(1),
  verificationId: identifierSchema,
  targetSnapshotDigest: digestSchema,
  hypothesisDigest: digestSchema,
  status: z.literal("supported"),
  sourceEvidence: z.array(sourceEvidenceSchema).min(1),
  experiment: storedXssExperimentMechanismSchema,
});

const experimentBindingsSchema = z.strictObject({
  targetSnapshotDigest: digestSchema,
  labBaselineDigest: digestSchema,
  runtimeProfileDigest: digestSchema,
  setupPlanDigest: digestSchema,
  configurationDigest: digestSchema,
  adapterVersion: z.literal("stored-xss-browser@v1"),
});

export const experimentPlanSchema = z.strictObject({
  kind: z.literal("experiment-plan"),
  schemaVersion: z.literal(1),
  experimentId: digestSchema,
  verificationId: identifierSchema,
  role: z.enum(["witness", "control"]),
  siblingGroupId: digestSchema,
  hypothesisDigest: digestSchema,
  bindings: experimentBindingsSchema,
  mechanism: storedXssExperimentMechanismSchema.extend({
    causalFactorState: z.enum(["present", "removed"]),
  }),
});

const storedXssObservationSchema = z.strictObject({
  kind: z.literal("stored-xss-browser"),
  schemaVersion: z.literal(1),
  attackerRequestAccepted: z.boolean(),
  persistentStateObserved: z.boolean(),
  browserCanaryExecuted: z.boolean(),
});

export const experimentObservationSchema = z.strictObject({
  kind: z.literal("experiment-observation"),
  schemaVersion: z.literal(1),
  experimentId: digestSchema,
  verificationId: identifierSchema,
  role: z.enum(["witness", "control"]),
  hypothesisDigest: digestSchema,
  bindings: experimentBindingsSchema,
  isolation: z.strictObject({
    runtime: z.literal("gvisor"),
    runtimeDigest: digestSchema,
    siblingGroupId: digestSchema,
    labId: identifierSchema,
    fresh: z.boolean(),
    fallbackUsed: z.boolean(),
  }),
  causalFactor: z.strictObject({
    id: identifierSchema,
    state: z.enum(["present", "removed"]),
  }),
  normalFunction: z.enum(["preserved", "broken", "unknown"]),
  result: storedXssObservationSchema,
  artifactRefs: z.array(digestSchema),
});

export const experimentObservationRefSchema = z.strictObject({
  kind: z.literal("experiment-observation"),
  schemaVersion: z.literal(1),
  experimentId: digestSchema,
  digest: digestSchema,
});

const sourceRederivationRefSchema = z.strictObject({
  kind: z.literal("source-rederivation"),
  schemaVersion: z.literal(1),
  digest: digestSchema,
});

const findingOutcomeSchema = z.strictObject({
  kind: z.literal("finding"),
  causalIdentity: sourceBoundHypothesisSchema.shape.causalIdentity,
});

const disprovedOutcomeSchema = z.strictObject({
  kind: z.literal("disproved"),
  reason: z.literal("security-property-preserved"),
  causalIdentity: sourceBoundHypothesisSchema.shape.causalIdentity,
});

const verificationOutcomeSchema = z.discriminatedUnion("kind", [
  findingOutcomeSchema,
  disprovedOutcomeSchema,
]);

export const verificationCompletionInputSchema = z.strictObject({
  kind: z.literal("verification-completion"),
  schemaVersion: z.literal(1),
  verificationId: identifierSchema,
  campaignId: identifierSchema,
  planDigest: digestSchema,
  targetSnapshotDigest: digestSchema,
  hypothesisDigest: digestSchema,
  sourceRederivation: sourceRederivationRefSchema,
  witness: experimentObservationRefSchema,
  control: experimentObservationRefSchema,
  outcome: verificationOutcomeSchema,
});

export const verificationRecordSchema = z.strictObject({
  kind: z.literal("verification-record"),
  schemaVersion: z.literal(1),
  verificationId: identifierSchema,
  campaignId: identifierSchema,
  planDigest: digestSchema,
  targetSnapshotDigest: digestSchema,
  hypothesisDigest: digestSchema,
  sourceRederivation: sourceRederivationRefSchema,
  witness: experimentObservationRefSchema,
  control: experimentObservationRefSchema,
  outcome: verificationOutcomeSchema,
  completedAt: z.string().datetime(),
});

export const verificationRecordRefSchema = z.strictObject({
  kind: z.literal("verification-record"),
  schemaVersion: z.literal(1),
  verificationId: identifierSchema,
  digest: digestSchema,
  outcome: z.enum(["finding", "disproved"]),
});

export type VerificationPlan = z.infer<typeof verificationPlanSchema>;
export type SourceRederivation = z.infer<typeof sourceRederivationSchema>;
export type ExperimentPlan = z.infer<typeof experimentPlanSchema>;
export type ExperimentObservation = z.infer<typeof experimentObservationSchema>;
export type ExperimentObservationRef = z.infer<
  typeof experimentObservationRefSchema
>;
export type VerificationCompletionInput = z.infer<
  typeof verificationCompletionInputSchema
>;
export type VerificationRecord = z.infer<typeof verificationRecordSchema>;
export type VerificationRecordRef = z.infer<typeof verificationRecordRefSchema>;

export interface VerificationRecordView {
  readonly ledgerHead: number;
  readonly occurredAt: string;
  readonly ref: VerificationRecordRef;
  readonly value: VerificationRecord;
}

export interface IndependentVerifier {
  rederive(plan: VerificationPlan): Promise<unknown>;
}

export interface LabControl {
  execute(plan: ExperimentPlan): Promise<ExperimentObservationRef>;
}

export interface Verification {
  verify(plan: VerificationPlan): Promise<VerificationRecordRef>;
}

export interface OpenVerificationOptions {
  readonly record: import("../research-record/contracts.js").ResearchRecord;
  readonly artifactStore: import("../research-record/contracts.js").JsonArtifactStore;
  readonly independentVerifier: IndependentVerifier;
  readonly labControl: LabControl;
}

export class VerificationConflictError extends Error {
  readonly campaignId: string;
  readonly verificationId: string;

  constructor(campaignId: string, verificationId: string) {
    super(
      `Verification already exists with different input: ${campaignId}/${verificationId}`,
    );
    this.name = "VerificationConflictError";
    this.campaignId = campaignId;
    this.verificationId = verificationId;
  }
}
