import { z } from "zod";

import {
  referenceRuntimeVerificationPacket,
  runtimeVerificationPacketDeliveryRequestSchema,
  runtimeVerificationPacketRefSchema,
  runtimeVerificationPacketSchema,
} from "../research/validation/runtime-verification-packet.js";
import {
  findingRefSchema,
  findingSchema,
  referenceFinding,
  type Finding,
} from "../research/validation/finding.js";
import { humanOsDigest } from "./canonical-json.js";
import {
  externalDependencyGrantSchema,
  humanVerificationEnvironmentPolicySchema,
  humanVerificationRuntimeProfileSchema,
  humanVerificationSetupPlanSchema,
  humanVerificationTargetSchema,
} from "./human-verification-environment-contracts.js";

const digestSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const identifierSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
const versionSchema = z
  .string()
  .min(1)
  .max(128)
  .refine((value) => value !== "latest", {
    message: "Runtime versions must be fixed",
  });
const pinnedImageSchema = z
  .string()
  .regex(/^[A-Za-z0-9._:/-]+@sha256:[a-f0-9]{64}$/);
const shareableTextSchema = z
  .string()
  .min(1)
  .max(4_000)
  .refine(
    (value) =>
      !/[`\r\n]/u.test(value) &&
      !/^(?:GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+\//iu.test(value) &&
      !/(?:<script|<\?php|authorization\s*:|cookie\s*:|password\s*=|\b(?:curl|wget|powershell|bash\s+-c|sh\s+-c|nc\s+-e|reverse\s+shell)\b)/iu.test(
        value,
      ),
    {
      message:
        "Shareable AI Reproduction text must not contain private evidence or executable material",
    },
  );
const privateExactTextSchema = z
  .string()
  .min(1)
  .max(64_000)
  .refine(
    (value) =>
      !/(?:^|\r?\n)(?:authorization|proxy-authorization|cookie|set-cookie)\s*:/imu.test(
        value,
      ) &&
      !/(?:password|passwd|secret|access[_-]?token|api[_-]?key)\s*[=:]\s*\S+/iu.test(
        value,
      ) &&
      !/(?:\/home\/[^\s/]+|\/Users\/[^\s/]+|[A-Za-z]:\\Users\\[^\s\\]+)/u.test(
        value,
      ) &&
      !/(?:reverse\s+shell|\bnc\s+-e\b)/iu.test(value),
    {
      message:
        "Private reproduction material must exclude credentials, cookies, host identity, and interactive access",
    },
  );

export const aiReproductionClassSchema = z.enum([
  "sql-injection",
  "cross-site-scripting",
  "authorization",
  "file-operation",
  "code-execution",
  "generic",
]);

export const aiReproductionToolPolicySchema = z.strictObject({
  kind: z.literal("ai-reproduction-tool-policy"),
  schemaVersion: z.literal(2),
  browser: z.literal("harness-mediated"),
  http: z.literal("harness-mediated"),
  runtimeObservation: z.literal("harness-mediated"),
  ambientHostShell: z.literal(false),
  ambientCredentials: z.literal(false),
  arbitraryNetwork: z.literal(false),
});

export const aiReproductionIntakeSchema = z
  .strictObject({
    kind: z.literal("ai-reproduction-intake"),
    schemaVersion: z.literal(2),
    id: digestSchema,
    campaignId: identifierSchema,
    runId: identifierSchema,
    deliveryRequestDigest: digestSchema,
    packet: runtimeVerificationPacketRefSchema,
    admittedAt: z.string().datetime(),
  })
  .superRefine((intake, context) => {
    const expectedId = humanOsDigest({
      kind: "ai-reproduction-intake-id",
      schemaVersion: 2,
      packetDigest: intake.packet.digest,
    });
    if (intake.id !== expectedId) {
      context.addIssue({
        code: "custom",
        path: ["id"],
        message: "AI Reproduction Intake ID does not match its Packet",
      });
    }
  });

const aiReproductionAttemptIdentitySchema = z
  .strictObject({
    kind: z.literal("ai-reproduction-attempt"),
    schemaVersion: z.literal(2),
    intakeId: digestSchema,
    packet: runtimeVerificationPacketRefSchema,
    target: humanVerificationTargetSchema,
    attackerPremise: runtimeVerificationPacketSchema.shape.attackerPremise,
    causalIdentity: runtimeVerificationPacketSchema.shape.causalIdentity,
    securityEffect: runtimeVerificationPacketSchema.shape.securityEffect,
    sourceRoute: runtimeVerificationPacketSchema.shape.sourceRoute,
    runtimeProfile: humanVerificationRuntimeProfileSchema,
    setupPlan: humanVerificationSetupPlanSchema,
    environmentPolicy: humanVerificationEnvironmentPolicySchema,
    grants: z.array(externalDependencyGrantSchema).max(16),
    toolPolicy: aiReproductionToolPolicySchema,
  })
  .superRefine((attempt, context) => {
    const grantDigests = attempt.grants.map((grant) => grant.digest).sort();
    const policyGrantDigests =
      attempt.environmentPolicy.egress.mode === "grant-only"
        ? [...attempt.environmentPolicy.egress.grantDigests].sort()
        : [];
    if (
      attempt.packet.targetSnapshotDigest !== attempt.target.snapshot.digest ||
      attempt.packet.manifestDigest !== attempt.target.manifest.digest ||
      attempt.setupPlan.pluginSlug !== attempt.target.snapshot.pluginSlug ||
      JSON.stringify(grantDigests) !== JSON.stringify(policyGrantDigests)
    ) {
      context.addIssue({
        code: "custom",
        message:
          "AI Reproduction Attempt contains a foreign Target, Setup Plan, or grant binding",
      });
    }
  });

export const aiReproductionAttemptSchema = aiReproductionAttemptIdentitySchema
  .extend({ id: digestSchema })
  .superRefine((attempt, context) => {
    const { id: _id, ...identity } = attempt;
    if (attempt.id !== humanOsDigest(identity)) {
      context.addIssue({
        code: "custom",
        path: ["id"],
        message: "AI Reproduction Attempt ID does not match its content",
      });
    }
  });

export const aiReproductionAttemptRefSchema = z.strictObject({
  kind: z.literal("ai-reproduction-attempt"),
  schemaVersion: z.literal(2),
  id: digestSchema,
  digest: digestSchema,
  intakeId: digestSchema,
  packetDigest: digestSchema,
  targetSnapshotDigest: digestSchema,
  runtimeProfileDigest: digestSchema,
  setupPlanDigest: digestSchema,
  toolPolicyDigest: digestSchema,
});

export const aiReproductionRuntimeIdentitySchema = z.strictObject({
  kind: z.literal("ai-reproduction-runtime-identity"),
  schemaVersion: z.literal(2),
  environmentId: identifierSchema,
  targetSnapshotDigest: digestSchema,
  manifestDigest: digestSchema,
  runtimeProfileDigest: digestSchema,
  setupPlanDigest: digestSchema,
  toolPolicyDigest: digestSchema,
  observedWordpressVersion: versionSchema,
  observedPhpVersion: versionSchema,
  observedDatabaseVersion: versionSchema,
  observedWebServerVersion: versionSchema,
  observedImages: z.strictObject({
    wordpress: pinnedImageSchema,
    wordpressCli: pinnedImageSchema,
    database: pinnedImageSchema,
    browser: pinnedImageSchema,
  }),
  isolation: z.strictObject({
    backend: z.literal("gvisor"),
    runtimeName: z.literal("runsc"),
    runtimeVersion: versionSchema,
    fallbackUsed: z.literal(false),
  }),
  fresh: z.literal(true),
  disposable: z.literal(true),
  hostTargetExecution: z.literal(false),
  ambientHostShell: z.literal(false),
  ambientCredentials: z.literal(false),
  arbitraryNetwork: z.literal(false),
});

const recipeCriterionSchema = z.discriminatedUnion("class", [
  z.strictObject({
    class: z.literal("sql-injection"),
    proof: z.literal("database-security-effect"),
    expectedDatabaseEffect: shareableTextSchema,
  }),
  z.strictObject({
    class: z.literal("cross-site-scripting"),
    proof: z.literal("browser-execution-canary"),
    expectedBrowserEffect: shareableTextSchema,
  }),
  z.strictObject({
    class: z.literal("authorization"),
    proof: z.literal("cross-role-security-effect"),
    expectedOwnershipEffect: shareableTextSchema,
  }),
  z.strictObject({
    class: z.literal("file-operation"),
    proof: z.literal("filesystem-security-effect"),
    expectedFilesystemEffect: shareableTextSchema,
  }),
  z.strictObject({
    class: z.literal("code-execution"),
    proof: z.literal("execution-canary"),
    canaryDigest: digestSchema,
    expectedCanaryEffect: shareableTextSchema,
  }),
  z.strictObject({
    class: z.literal("generic"),
    proof: z.literal("security-effect-observation"),
    expectedSecurityEffect: shareableTextSchema,
  }),
]);

const reproductionPayloadSchema = z.strictObject({
  id: identifierSchema,
  mediaType: z.enum([
    "text/plain",
    "application/json",
    "application/x-www-form-urlencoded",
    "multipart/form-data",
  ]),
  exactValue: privateExactTextSchema,
});

const reproductionStepSchema = z.strictObject({
  ordinal: z.number().int().positive(),
  interface: z.enum([
    "wordpress-public-site",
    "wordpress-admin-ui",
    "wordpress-rest-api",
    "wordpress-authentication",
  ]),
  actor: z.enum(["attacker", "victim", "observer"]),
  action: privateExactTextSchema,
  payloadId: identifierSchema.nullable(),
  expectedObservation: privateExactTextSchema,
});

const reproductionRecipeDraftSchema = z
  .strictObject({
    class: aiReproductionClassSchema,
    initialState: z.array(privateExactTextSchema).min(1).max(32),
    actors: z.strictObject({
      attackerRole: runtimeVerificationPacketSchema.shape.attackerPremise,
      victimRole: privateExactTextSchema.nullable(),
    }),
    surface: privateExactTextSchema,
    payloads: z.array(reproductionPayloadSchema).max(32),
    steps: z.array(reproductionStepSchema).min(1).max(64),
    criterion: recipeCriterionSchema,
  })
  .superRefine((recipe, context) => {
    const payloadIds = new Set(recipe.payloads.map((payload) => payload.id));
    if (
      recipe.criterion.class !== recipe.class ||
      recipe.steps.some(
        (step, index) =>
          step.ordinal !== index + 1 ||
          (step.payloadId !== null && !payloadIds.has(step.payloadId)),
      )
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Reproduction Recipe class, step order, or payload binding is invalid",
      });
    }
  });

const privateArtifactPointerSchema = z.strictObject({
  id: identifierSchema,
  digest: digestSchema,
  mediaType: z.enum(["image/png", "image/jpeg", "text/plain"]),
});

const privateEvidenceDraftSchema = z.strictObject({
  exactPayloads: z.array(reproductionPayloadSchema).max(32),
  rawHttpRequests: z.array(privateExactTextSchema).max(64),
  screenshots: z.array(privateArtifactPointerSchema).max(64),
  runtimeLogs: z.array(privateArtifactPointerSchema).max(64),
  redaction: z.strictObject({
    credentialsIncluded: z.literal(false),
    cookiesIncluded: z.literal(false),
    privateTranscriptIncluded: z.literal(false),
    hostInformationIncluded: z.literal(false),
  }),
});

const reproductionRecipeIdentitySchema = z.strictObject({
  kind: z.literal("reproduction-recipe"),
  schemaVersion: z.literal(2),
  attemptId: digestSchema,
  targetSnapshotDigest: digestSchema,
  runtimeIdentity: aiReproductionRuntimeIdentitySchema,
  recordedAt: z.string().datetime(),
  recipe: reproductionRecipeDraftSchema,
});

export const reproductionRecipeSchema = reproductionRecipeIdentitySchema
  .extend({ id: digestSchema })
  .superRefine((recipe, context) => {
    const { id: _id, ...identity } = recipe;
    if (recipe.id !== humanOsDigest(identity)) {
      context.addIssue({
        code: "custom",
        path: ["id"],
        message: "Reproduction Recipe ID does not match its content",
      });
    }
  });

const privateEvidenceBundleIdentitySchema = z.strictObject({
  kind: z.literal("private-evidence-bundle"),
  schemaVersion: z.literal(2),
  attemptId: digestSchema,
  targetSnapshotDigest: digestSchema,
  collectedAt: z.string().datetime(),
  evidence: privateEvidenceDraftSchema,
});

export const privateEvidenceBundleSchema = privateEvidenceBundleIdentitySchema
  .extend({ id: digestSchema })
  .superRefine((bundle, context) => {
    const { id: _id, ...identity } = bundle;
    if (bundle.id !== humanOsDigest(identity)) {
      context.addIssue({
        code: "custom",
        path: ["id"],
        message: "Private Evidence Bundle ID does not match its content",
      });
    }
  });

export const humanOsPrivateArtifactRefSchema = z.strictObject({
  kind: z.literal("human-os-private-artifact"),
  schemaVersion: z.literal(2),
  artifactKind: z.enum(["reproduction-recipe", "private-evidence-bundle"]),
  id: digestSchema,
  digest: digestSchema,
  attemptId: digestSchema,
  targetSnapshotDigest: digestSchema,
  storage: z.literal("human-os-private-store"),
});

const runtimeObservationSchema = z.strictObject({
  securityEffect: z.literal("observed"),
  description: shareableTextSchema,
});

const optionalProofSchema = z.strictObject({
  witness: z
    .strictObject({
      observationDigest: digestSchema,
      description: shareableTextSchema,
    })
    .nullable(),
  causalControl: z
    .strictObject({
      observationDigest: digestSchema,
      description: shareableTextSchema,
    })
    .nullable(),
});

const triageReproductionPacketIdentitySchema = z.strictObject({
  kind: z.literal("triage-reproduction-packet"),
  schemaVersion: z.literal(2),
  runtimePacket: runtimeVerificationPacketRefSchema,
  attempt: aiReproductionAttemptRefSchema,
  runtimeIdentity: aiReproductionRuntimeIdentitySchema,
  recipe: humanOsPrivateArtifactRefSchema,
  privateEvidence: humanOsPrivateArtifactRefSchema,
  recipeMetadata: z.strictObject({
    class: aiReproductionClassSchema,
    criterion: recipeCriterionSchema,
    stepCount: z.number().int().positive(),
    expectedSecurityEffect: shareableTextSchema,
  }),
  observation: runtimeObservationSchema,
  proof: optionalProofSchema,
  confirmedAt: z.string().datetime(),
  boundary: z.strictObject({
    runtimeConfirmed: z.literal(true),
    humanVerified: z.literal(false),
    findingEligible: z.literal(false),
    humanDisposition: z.literal(false),
    programmeEligibility: z.literal(false),
  }),
});

export const triageReproductionPacketSchema =
  triageReproductionPacketIdentitySchema
    .extend({ id: digestSchema })
    .superRefine((packet, context) => {
      const { id: _id, ...identity } = packet;
      if (
        packet.id !== humanOsDigest(identity) ||
        packet.attempt.packetDigest !== packet.runtimePacket.digest ||
        packet.recipe.attemptId !== packet.attempt.id ||
        packet.privateEvidence.attemptId !== packet.attempt.id ||
        packet.recipe.targetSnapshotDigest !==
          packet.attempt.targetSnapshotDigest ||
        packet.privateEvidence.targetSnapshotDigest !==
          packet.attempt.targetSnapshotDigest ||
        packet.recipe.artifactKind !== "reproduction-recipe" ||
        packet.privateEvidence.artifactKind !== "private-evidence-bundle"
      ) {
        context.addIssue({
          code: "custom",
          message: "Triage Reproduction Packet contains a foreign binding",
        });
      }
    });

const harnessExecutionBase = {
  kind: z.literal("ai-reproduction-harness-execution"),
  schemaVersion: z.literal(2),
  completedAt: z.string().datetime(),
} as const;

export const aiReproductionHarnessExecutionSchema = z.discriminatedUnion(
  "status",
  [
    z.strictObject({
      ...harnessExecutionBase,
      status: z.literal("runtime-confirmed"),
      runtimeIdentity: aiReproductionRuntimeIdentitySchema,
      observation: runtimeObservationSchema,
      recipe: reproductionRecipeDraftSchema,
      privateEvidence: privateEvidenceDraftSchema,
      proof: optionalProofSchema,
      cleanup: z.enum(["completed", "failed"]),
    }),
    z.strictObject({
      ...harnessExecutionBase,
      status: z.literal("runtime-inconclusive"),
      reason: z.enum([
        "unsupported-mechanism",
        "effect-not-observed",
        "effect-unclear",
        "environment-identity-mismatch",
      ]),
      description: shareableTextSchema,
      runtimeIdentity: aiReproductionRuntimeIdentitySchema.nullable(),
      cleanup: z.enum(["not-required", "completed", "failed"]),
    }),
    z.strictObject({
      ...harnessExecutionBase,
      status: z.literal("setup-blocked"),
      reason: z.enum([
        "isolation-unavailable",
        "policy-violation",
        "setup-failed",
        "activation-failed",
        "health-failed",
      ]),
      description: shareableTextSchema,
      cleanup: z.enum(["not-required", "completed", "failed"]),
    }),
    z.strictObject({
      ...harnessExecutionBase,
      status: z.literal("execution-failed"),
      reason: z.enum([
        "provider-failed",
        "budget-exhausted",
        "policy-denied",
        "harness-failed",
      ]),
      description: shareableTextSchema,
      cleanup: z.enum(["not-required", "completed", "failed"]),
    }),
  ],
);

const aiReproductionResultBase = {
  kind: z.literal("ai-reproduction-result"),
  schemaVersion: z.literal(2),
  attempt: aiReproductionAttemptRefSchema,
  runtimePacket: runtimeVerificationPacketRefSchema,
  completedAt: z.string().datetime(),
  cleanup: z.enum(["not-required", "completed", "failed"]),
} as const;

export const aiReproductionResultSchema = z
  .discriminatedUnion("status", [
    z.strictObject({
      ...aiReproductionResultBase,
      status: z.literal("runtime-confirmed"),
      runtimeIdentity: aiReproductionRuntimeIdentitySchema,
      observation: runtimeObservationSchema,
      recipe: humanOsPrivateArtifactRefSchema,
      privateEvidence: humanOsPrivateArtifactRefSchema,
      triagePacket: triageReproductionPacketSchema,
    }),
    z.strictObject({
      ...aiReproductionResultBase,
      status: z.literal("runtime-inconclusive"),
      reason: z.enum([
        "unsupported-mechanism",
        "effect-not-observed",
        "effect-unclear",
        "environment-identity-mismatch",
      ]),
      description: shareableTextSchema,
      triagePacket: z.null(),
    }),
    z.strictObject({
      ...aiReproductionResultBase,
      status: z.literal("setup-blocked"),
      reason: z.enum([
        "isolation-unavailable",
        "policy-violation",
        "setup-failed",
        "activation-failed",
        "health-failed",
      ]),
      description: shareableTextSchema,
      triagePacket: z.null(),
    }),
    z.strictObject({
      ...aiReproductionResultBase,
      status: z.literal("execution-failed"),
      reason: z.enum([
        "provider-failed",
        "budget-exhausted",
        "policy-denied",
        "harness-failed",
        "invalid-harness-output",
        "private-evidence-store-failed",
        "cleanup-failed",
      ]),
      description: shareableTextSchema,
      triagePacket: z.null(),
    }),
  ])
  .superRefine((result, context) => {
    if (
      result.attempt.packetDigest !== result.runtimePacket.digest ||
      (result.status === "runtime-confirmed" &&
        result.triagePacket.attempt.id !== result.attempt.id)
    ) {
      context.addIssue({
        code: "custom",
        message: "AI Reproduction Result contains a foreign binding",
      });
    }
  });

export type AIReproductionClass = z.infer<typeof aiReproductionClassSchema>;
export type AIReproductionIntake = z.infer<typeof aiReproductionIntakeSchema>;
export type AIReproductionAttempt = z.infer<typeof aiReproductionAttemptSchema>;
export type AIReproductionAttemptRef = z.infer<
  typeof aiReproductionAttemptRefSchema
>;
export type AIReproductionRuntimeIdentity = z.infer<
  typeof aiReproductionRuntimeIdentitySchema
>;
export type AIReproductionHarnessExecution = z.infer<
  typeof aiReproductionHarnessExecutionSchema
>;
export type ReproductionRecipe = z.infer<typeof reproductionRecipeSchema>;
export type PrivateEvidenceBundle = z.infer<typeof privateEvidenceBundleSchema>;
export type HumanOsPrivateArtifactRef = z.infer<
  typeof humanOsPrivateArtifactRefSchema
>;
export type TriageReproductionPacket = z.infer<
  typeof triageReproductionPacketSchema
>;
export type AIReproductionResult = z.infer<typeof aiReproductionResultSchema>;
export type ReproductionRecipeDraft = z.infer<
  typeof reproductionRecipeDraftSchema
>;
export type PrivateEvidenceDraft = z.infer<typeof privateEvidenceDraftSchema>;

export function defineAIReproductionIntake(input: {
  readonly request: z.infer<
    typeof runtimeVerificationPacketDeliveryRequestSchema
  >;
  readonly admittedAt: string;
}): AIReproductionIntake {
  const request = runtimeVerificationPacketDeliveryRequestSchema.parse(
    input.request,
  );
  return aiReproductionIntakeSchema.parse({
    kind: "ai-reproduction-intake",
    schemaVersion: 2,
    id: humanOsDigest({
      kind: "ai-reproduction-intake-id",
      schemaVersion: 2,
      packetDigest: humanOsDigest(request.packet),
    }),
    campaignId: request.campaignId,
    runId: request.runId,
    deliveryRequestDigest: request.digest,
    packet: referenceRuntimeVerificationPacket(request.packet),
    admittedAt: input.admittedAt,
  });
}

export function defineAIReproductionAttempt(input: {
  readonly intake: AIReproductionIntake;
  readonly packet: z.infer<typeof runtimeVerificationPacketSchema>;
  readonly target: z.infer<typeof humanVerificationTargetSchema>;
  readonly runtimeProfile: z.infer<
    typeof humanVerificationRuntimeProfileSchema
  >;
  readonly setupPlan: z.infer<typeof humanVerificationSetupPlanSchema>;
  readonly environmentPolicy: z.infer<
    typeof humanVerificationEnvironmentPolicySchema
  >;
  readonly grants: readonly z.infer<typeof externalDependencyGrantSchema>[];
}): AIReproductionAttempt {
  const packet = runtimeVerificationPacketSchema.parse(input.packet);
  const identity = aiReproductionAttemptIdentitySchema.parse({
    kind: "ai-reproduction-attempt",
    schemaVersion: 2,
    intakeId: input.intake.id,
    packet: referenceRuntimeVerificationPacket(packet),
    target: input.target,
    attackerPremise: packet.attackerPremise,
    causalIdentity: packet.causalIdentity,
    securityEffect: packet.securityEffect,
    sourceRoute: packet.sourceRoute,
    runtimeProfile: input.runtimeProfile,
    setupPlan: input.setupPlan,
    environmentPolicy: input.environmentPolicy,
    grants: input.grants,
    toolPolicy: {
      kind: "ai-reproduction-tool-policy",
      schemaVersion: 2,
      browser: "harness-mediated",
      http: "harness-mediated",
      runtimeObservation: "harness-mediated",
      ambientHostShell: false,
      ambientCredentials: false,
      arbitraryNetwork: false,
    },
  });
  return aiReproductionAttemptSchema.parse({
    ...identity,
    id: humanOsDigest(identity),
  });
}

export function referenceAIReproductionAttempt(
  attemptValue: AIReproductionAttempt,
): AIReproductionAttemptRef {
  const attempt = aiReproductionAttemptSchema.parse(attemptValue);
  return aiReproductionAttemptRefSchema.parse({
    kind: attempt.kind,
    schemaVersion: attempt.schemaVersion,
    id: attempt.id,
    digest: humanOsDigest(attempt),
    intakeId: attempt.intakeId,
    packetDigest: attempt.packet.digest,
    targetSnapshotDigest: attempt.target.snapshot.digest,
    runtimeProfileDigest: attempt.runtimeProfile.digest,
    setupPlanDigest: attempt.setupPlan.digest,
    toolPolicyDigest: humanOsDigest(attempt.toolPolicy),
  });
}

export function defineRuntimePacketDeliveryReceipt(input: {
  readonly request: z.infer<
    typeof runtimeVerificationPacketDeliveryRequestSchema
  >;
  readonly intake: AIReproductionIntake;
}) {
  const identity = {
    kind: "runtime-verification-packet-delivery-receipt" as const,
    schemaVersion: 2 as const,
    deliveryRequestDigest: input.request.digest,
    packetDigest: humanOsDigest(input.request.packet),
    intakeId: input.intake.id,
    admission: "accepted-for-ai-reproduction" as const,
  };
  return {
    ...identity,
    receiptDigest: humanOsDigest(identity),
  };
}

export const aiReproductionPrivateSchemas = {
  recipeDraft: reproductionRecipeDraftSchema,
  evidenceDraft: privateEvidenceDraftSchema,
  recipeIdentity: reproductionRecipeIdentitySchema,
  evidenceIdentity: privateEvidenceBundleIdentitySchema,
  triageIdentity: triageReproductionPacketIdentitySchema,
} as const;

// Current Finding-bound lifecycle. Packet-bound contracts above remain decoder
// input for legacy replay until #129 removes their writers.
const findingAIReproductionAttemptIdentitySchema = z
  .strictObject({
    kind: z.literal("finding-ai-reproduction-attempt"),
    schemaVersion: z.literal(1),
    finding: findingRefSchema,
    target: humanVerificationTargetSchema,
    attackerPremise: findingSchema.shape.attackerPremise,
    brokenSecurityProperty: findingSchema.shape.brokenSecurityProperty,
    sourceRoute: findingSchema.shape.sourceRoute,
    runtimeProfile: humanVerificationRuntimeProfileSchema,
    setupPlan: humanVerificationSetupPlanSchema,
    environmentPolicy: humanVerificationEnvironmentPolicySchema,
    grants: z.array(externalDependencyGrantSchema).max(16),
    toolPolicy: aiReproductionToolPolicySchema,
  })
  .superRefine((attempt, context) => {
    const grantDigests = attempt.grants.map((grant) => grant.digest).sort();
    const policyGrantDigests =
      attempt.environmentPolicy.egress.mode === "grant-only"
        ? [...attempt.environmentPolicy.egress.grantDigests].sort()
        : [];
    if (
      attempt.finding.targetSnapshotDigest !== attempt.target.snapshot.digest ||
      attempt.finding.manifestDigest !== attempt.target.manifest.digest ||
      attempt.setupPlan.pluginSlug !== attempt.target.snapshot.pluginSlug ||
      JSON.stringify(grantDigests) !== JSON.stringify(policyGrantDigests)
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Finding AI Reproduction Attempt contains a foreign Target, Setup Plan, or grant binding",
      });
    }
  });

export const findingAIReproductionAttemptSchema =
  findingAIReproductionAttemptIdentitySchema
    .extend({ id: digestSchema })
    .superRefine((attempt, context) => {
      const { id: _id, ...identity } = attempt;
      if (attempt.id !== humanOsDigest(identity)) {
        context.addIssue({
          code: "custom",
          path: ["id"],
          message: "Finding AI Reproduction Attempt ID does not match content",
        });
      }
    });

export const findingAIReproductionAttemptRefSchema = z.strictObject({
  kind: z.literal("finding-ai-reproduction-attempt"),
  schemaVersion: z.literal(1),
  id: digestSchema,
  digest: digestSchema,
  findingId: digestSchema,
  findingDigest: digestSchema,
  targetSnapshotDigest: digestSchema,
  manifestDigest: digestSchema,
  runtimeProfileDigest: digestSchema,
  setupPlanDigest: digestSchema,
  toolPolicyDigest: digestSchema,
});

export const findingAIReproductionRecipeDraftSchema =
  reproductionRecipeDraftSchema;
export const findingAIReproductionPrivateEvidenceDraftSchema =
  privateEvidenceDraftSchema;

const findingAIReproductionExperimentSchema = z.strictObject({
  runtimeIdentity: aiReproductionRuntimeIdentitySchema,
  recipe: findingAIReproductionRecipeDraftSchema,
  privateEvidence: findingAIReproductionPrivateEvidenceDraftSchema,
});

const findingHarnessBase = {
  kind: z.literal("finding-ai-reproduction-harness-execution"),
  schemaVersion: z.literal(1),
  completedAt: z.string().datetime(),
} as const;

export const findingAIReproductionInconclusiveReasonSchema = z.enum([
  "unsupported-mechanism",
  "effect-unclear",
  "environment-identity-mismatch",
  "environment-session-unavailable",
  "provider-failed",
  "budget-exhausted",
  "policy-denied",
  "harness-failed",
  "private-evidence-unavailable",
]);

export const findingAIReproductionSetupBlockedReasonSchema = z.enum([
  "isolation-unavailable",
  "policy-violation",
  "setup-failed",
  "activation-failed",
  "health-failed",
]);

const aiVerificationInconclusiveReasonSchema = z.enum([
  ...findingAIReproductionInconclusiveReasonSchema.options,
  "cleanup-failed",
  "cleanup-unverified",
  "private-evidence-mismatch",
  "private-evidence-store-failed",
]);

export const findingAIReproductionHarnessExecutionSchema = z.discriminatedUnion(
  "status",
  [
    z.strictObject({
      ...findingHarnessBase,
      ...findingAIReproductionExperimentSchema.shape,
      status: z.literal("runtime-confirmed"),
      observation: z.strictObject({
        securityEffect: z.literal("observed"),
        description: shareableTextSchema,
      }),
      cleanup: z.enum(["completed", "failed", "unverified"]),
    }),
    z.strictObject({
      ...findingHarnessBase,
      ...findingAIReproductionExperimentSchema.shape,
      status: z.literal("disproved"),
      observation: z.strictObject({
        securityEffect: z.literal("not-observed"),
        description: shareableTextSchema,
      }),
      preconditionsMatched: z.literal(true),
      recipeCompleted: z.literal(true),
      cleanup: z.enum(["completed", "failed", "unverified"]),
    }),
    z.strictObject({
      ...findingHarnessBase,
      status: z.literal("inconclusive"),
      reason: findingAIReproductionInconclusiveReasonSchema,
      description: shareableTextSchema,
      cleanup: z.enum(["not-required", "completed", "failed", "unverified"]),
    }),
    z.strictObject({
      ...findingHarnessBase,
      status: z.literal("setup-blocked"),
      reason: findingAIReproductionSetupBlockedReasonSchema,
      description: shareableTextSchema,
      cleanup: z.enum(["not-required", "completed", "failed", "unverified"]),
    }),
  ],
);

export const aiVerificationOutcomeSchema = z.discriminatedUnion("status", [
  z.strictObject({
    status: z.literal("runtime-confirmed"),
    reason: shareableTextSchema,
    securityEffect: z.literal("observed"),
    preconditionsMatched: z.literal(true),
    recipeCompleted: z.literal(true),
  }),
  z.strictObject({
    status: z.literal("disproved"),
    reason: shareableTextSchema,
    securityEffect: z.literal("not-observed"),
    preconditionsMatched: z.literal(true),
    recipeCompleted: z.literal(true),
  }),
  z.strictObject({
    status: z.literal("inconclusive"),
    reasonCode: aiVerificationInconclusiveReasonSchema.optional(),
    reason: shareableTextSchema,
    securityEffect: z.literal("uncertain"),
    preconditionsMatched: z.boolean(),
    recipeCompleted: z.boolean(),
  }),
  z.strictObject({
    status: z.literal("setup-blocked"),
    reasonCode: findingAIReproductionSetupBlockedReasonSchema.optional(),
    reason: shareableTextSchema,
    securityEffect: z.literal("uncertain"),
    preconditionsMatched: z.literal(false),
    recipeCompleted: z.literal(false),
  }),
]);

const aiVerificationRecordIdentitySchema = z
  .strictObject({
    kind: z.literal("ai-verification-record"),
    schemaVersion: z.literal(1),
    finding: findingRefSchema,
    attempt: findingAIReproductionAttemptRefSchema,
    performedAt: z.string().datetime(),
    environment: aiReproductionRuntimeIdentitySchema.nullable(),
    outcome: aiVerificationOutcomeSchema,
    recipe: humanOsPrivateArtifactRefSchema.nullable(),
    privateEvidence: humanOsPrivateArtifactRefSchema.nullable(),
  })
  .superRefine((record, context) => {
    if (
      record.finding.id !== record.attempt.findingId ||
      record.finding.digest !== record.attempt.findingDigest ||
      (record.recipe === null) !== (record.privateEvidence === null) ||
      (record.recipe !== null &&
        (record.recipe.attemptId !== record.attempt.id ||
          record.privateEvidence?.attemptId !== record.attempt.id ||
          record.recipe.targetSnapshotDigest !==
            record.attempt.targetSnapshotDigest ||
          record.privateEvidence?.targetSnapshotDigest !==
            record.attempt.targetSnapshotDigest)) ||
      ((record.outcome.status === "runtime-confirmed" ||
        record.outcome.status === "disproved") &&
        (record.environment === null || record.recipe === null)) ||
      (record.outcome.status === "setup-blocked" &&
        (record.environment !== null || record.recipe !== null)) ||
      (record.outcome.status === "inconclusive" &&
        (record.environment === null) !== (record.recipe === null)) ||
      (record.environment === null &&
        (record.outcome.preconditionsMatched ||
          record.outcome.recipeCompleted)) ||
      (record.environment !== null &&
        (record.environment.targetSnapshotDigest !==
          record.attempt.targetSnapshotDigest ||
          record.environment.manifestDigest !== record.attempt.manifestDigest ||
          record.environment.runtimeProfileDigest !==
            record.attempt.runtimeProfileDigest ||
          record.environment.setupPlanDigest !==
            record.attempt.setupPlanDigest ||
          record.environment.toolPolicyDigest !==
            record.attempt.toolPolicyDigest))
    ) {
      context.addIssue({
        code: "custom",
        message: "AI Verification Record binding mismatch",
      });
    }
  });

export const aiVerificationRecordSchema = aiVerificationRecordIdentitySchema
  .extend({ id: digestSchema })
  .superRefine((record, context) => {
    const { id: _id, ...identity } = record;
    if (record.id !== humanOsDigest(identity)) {
      context.addIssue({
        code: "custom",
        path: ["id"],
        message: "AI Verification Record ID mismatch",
      });
    }
  });

export const aiReproductionViewSchema = z
  .strictObject({
    kind: z.literal("ai-reproduction-view"),
    schemaVersion: z.literal(1),
    status: z.enum([
      "completed",
      "result-not-recorded",
      "completed-with-result-not-recorded",
    ]),
    finding: findingSchema,
    assurance: z.strictObject({
      source: z.literal("source-validated"),
      runtime: z.array(
        z.enum([
          "runtime-confirmed",
          "disproved",
          "inconclusive",
          "setup-blocked",
        ]),
      ),
    }),
    records: z.array(aiVerificationRecordSchema),
    incompleteClaims: z.array(
      z.strictObject({
        attempt: findingAIReproductionAttemptRefSchema,
        startedAt: z.string().datetime(),
        processStatus: z.literal("unknown"),
        cleanupStatus: z.literal("unknown"),
      }),
    ),
  })
  .superRefine((view, context) => {
    const runtimeStatuses = view.records.map((record) => record.outcome.status);
    const incompleteAttemptIds = view.incompleteClaims.map(
      (claim) => claim.attempt.id,
    );
    const completedAttemptIds = new Set(
      view.records.map((record) => record.attempt.id),
    );
    const expectedStatus =
      view.records.length === 0
        ? "result-not-recorded"
        : view.incompleteClaims.length === 0
          ? "completed"
          : "completed-with-result-not-recorded";
    if (
      view.status !== expectedStatus ||
      JSON.stringify(view.assurance.runtime) !==
        JSON.stringify(runtimeStatuses) ||
      (view.records.length === 0 && view.incompleteClaims.length === 0) ||
      view.records.some(
        (record) =>
          record.finding.id !== view.finding.id ||
          record.finding.digest !== referenceFinding(view.finding).digest,
      ) ||
      view.incompleteClaims.some(
        (claim) =>
          claim.attempt.findingId !== view.finding.id ||
          claim.attempt.findingDigest !== referenceFinding(view.finding).digest,
      ) ||
      new Set(incompleteAttemptIds).size !== incompleteAttemptIds.length ||
      incompleteAttemptIds.some((attemptId) =>
        completedAttemptIds.has(attemptId),
      )
    ) {
      context.addIssue({
        code: "custom",
        message: "AI Reproduction View status does not match stored records",
      });
    }
  });

export type FindingAIReproductionAttempt = z.infer<
  typeof findingAIReproductionAttemptSchema
>;
export type FindingAIReproductionAttemptRef = z.infer<
  typeof findingAIReproductionAttemptRefSchema
>;
export type FindingAIReproductionRuntimeIdentity = z.infer<
  typeof aiReproductionRuntimeIdentitySchema
>;
export type FindingAIReproductionHarnessExecution = z.infer<
  typeof findingAIReproductionHarnessExecutionSchema
>;
export type FindingAIReproductionRecipeDraft = z.infer<
  typeof findingAIReproductionRecipeDraftSchema
>;
export type FindingAIReproductionPrivateEvidenceDraft = z.infer<
  typeof findingAIReproductionPrivateEvidenceDraftSchema
>;
export type FindingAIReproductionPrivateArtifactRef = z.infer<
  typeof humanOsPrivateArtifactRefSchema
>;
export type AIVerificationOutcome = z.infer<typeof aiVerificationOutcomeSchema>;
export type AIVerificationRecord = z.infer<typeof aiVerificationRecordSchema>;
export type AIReproductionView = z.infer<typeof aiReproductionViewSchema>;

export function defineFindingAIReproductionAttempt(input: {
  readonly finding: Finding;
  readonly target: z.infer<typeof humanVerificationTargetSchema>;
  readonly runtimeProfile: z.infer<
    typeof humanVerificationRuntimeProfileSchema
  >;
  readonly setupPlan: z.infer<typeof humanVerificationSetupPlanSchema>;
  readonly environmentPolicy: z.infer<
    typeof humanVerificationEnvironmentPolicySchema
  >;
  readonly grants: readonly z.infer<typeof externalDependencyGrantSchema>[];
}): FindingAIReproductionAttempt {
  const finding = findingSchema.parse(input.finding);
  if (
    humanOsDigest(finding.target) !== humanOsDigest(input.target.snapshot) ||
    humanOsDigest(finding.manifest) !== humanOsDigest(input.target.manifest)
  ) {
    throw new Error("Finding AI Reproduction Target identity mismatch");
  }
  const identity = findingAIReproductionAttemptIdentitySchema.parse({
    kind: "finding-ai-reproduction-attempt",
    schemaVersion: 1,
    finding: referenceFinding(finding),
    target: input.target,
    attackerPremise: finding.attackerPremise,
    brokenSecurityProperty: finding.brokenSecurityProperty,
    sourceRoute: finding.sourceRoute,
    runtimeProfile: input.runtimeProfile,
    setupPlan: input.setupPlan,
    environmentPolicy: input.environmentPolicy,
    grants: input.grants,
    toolPolicy: {
      kind: "ai-reproduction-tool-policy",
      schemaVersion: 2,
      browser: "harness-mediated",
      http: "harness-mediated",
      runtimeObservation: "harness-mediated",
      ambientHostShell: false,
      ambientCredentials: false,
      arbitraryNetwork: false,
    },
  });
  return findingAIReproductionAttemptSchema.parse({
    ...identity,
    id: humanOsDigest(identity),
  });
}

export function referenceFindingAIReproductionAttempt(
  attemptValue: FindingAIReproductionAttempt,
): FindingAIReproductionAttemptRef {
  const attempt = findingAIReproductionAttemptSchema.parse(attemptValue);
  return findingAIReproductionAttemptRefSchema.parse({
    kind: attempt.kind,
    schemaVersion: attempt.schemaVersion,
    id: attempt.id,
    digest: humanOsDigest(attempt),
    findingId: attempt.finding.id,
    findingDigest: attempt.finding.digest,
    targetSnapshotDigest: attempt.target.snapshot.digest,
    manifestDigest: attempt.target.manifest.digest,
    runtimeProfileDigest: attempt.runtimeProfile.digest,
    setupPlanDigest: attempt.setupPlan.digest,
    toolPolicyDigest: humanOsDigest(attempt.toolPolicy),
  });
}

export function defineAIVerificationRecord(
  input: z.input<typeof aiVerificationRecordIdentitySchema>,
): AIVerificationRecord {
  const identity = aiVerificationRecordIdentitySchema.parse(input);
  return aiVerificationRecordSchema.parse({
    ...identity,
    id: humanOsDigest(identity),
  });
}

export const findingAIReproductionPrivateSchemas = {
  recipe: reproductionRecipeSchema,
  evidence: privateEvidenceBundleSchema,
} as const;
