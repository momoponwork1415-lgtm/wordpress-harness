import { z } from "zod";

import { findingSchema, type Finding } from "../research/validation/finding.js";
import {
  humanReviewPacketSchema,
  type HumanReviewPacket,
} from "../research/validation/human-review-packet.js";
import { humanOsDigest } from "./canonical-json.js";

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
const normalizedRelativePathSchema = z
  .string()
  .min(1)
  .max(512)
  .refine(
    (value) =>
      !value.startsWith("/") &&
      !value.includes("\\") &&
      !value
        .split("/")
        .some(
          (segment) => segment === "" || segment === "." || segment === "..",
        ),
    { message: "Path must be a normalized relative path" },
  );

const runtimeProfileIdentitySchema = z.strictObject({
  kind: z.literal("human-verification-runtime-profile"),
  schemaVersion: z.literal(1),
  wordpressVersion: versionSchema,
  phpVersion: versionSchema,
  databaseVersion: versionSchema,
  webServerVersion: versionSchema,
  isolation: z.strictObject({
    backend: z.literal("gvisor"),
    runtimeName: z.literal("runsc"),
    runtimeVersion: versionSchema,
  }),
  images: z.strictObject({
    wordpress: pinnedImageSchema,
    wordpressCli: pinnedImageSchema,
    database: pinnedImageSchema,
    browser: pinnedImageSchema,
  }),
});

export const humanVerificationRuntimeProfileSchema =
  runtimeProfileIdentitySchema
    .extend({ digest: digestSchema })
    .superRefine((profile, context) => {
      const { digest: _digest, ...identity } = profile;
      if (profile.digest !== humanOsDigest(identity)) {
        context.addIssue({
          code: "custom",
          path: ["digest"],
          message: "Runtime Profile digest does not match its identity",
        });
      }
    });

export const setupStageNames = [
  "install-wordpress",
  "install-target",
  "activate-target",
  "apply-configuration",
  "functional-smoke",
] as const;

const setupSuccessCriteria = [
  "wordpress-installed",
  "target-files-match-manifest",
  "target-reports-active",
  "canonical-configuration-observed",
  "normal-target-function-observed",
] as const;

const setupPlanIdentitySchema = z
  .strictObject({
    kind: z.literal("human-verification-setup-plan"),
    schemaVersion: z.literal(1),
    pluginSlug: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
    mainPluginFile: normalizedRelativePathSchema,
    configuration: z.strictObject({
      siteMode: z.literal("single-site"),
      locale: z.literal("en_US"),
      timezone: z.literal("UTC"),
      variantDigest: digestSchema.nullable(),
    }),
    stages: z
      .array(
        z.strictObject({
          ordinal: z.number().int().positive(),
          stage: z.enum(setupStageNames),
          successCriterion: z.enum(setupSuccessCriteria),
        }),
      )
      .length(setupStageNames.length),
  })
  .superRefine((plan, context) => {
    plan.stages.forEach((stage, index) => {
      if (
        stage.ordinal !== index + 1 ||
        stage.stage !== setupStageNames[index] ||
        stage.successCriterion !== setupSuccessCriteria[index]
      ) {
        context.addIssue({
          code: "custom",
          path: ["stages", index],
          message:
            "Setup Plan stages must use the fixed order and success criteria",
        });
      }
    });
  });

export const humanVerificationSetupPlanSchema = setupPlanIdentitySchema
  .extend({ digest: digestSchema })
  .superRefine((plan, context) => {
    const { digest: _digest, ...identity } = plan;
    if (plan.digest !== humanOsDigest(identity)) {
      context.addIssue({
        code: "custom",
        path: ["digest"],
        message: "Setup Plan digest does not match its identity",
      });
    }
  });

const environmentPolicyIdentitySchema = z.strictObject({
  kind: z.literal("human-verification-environment-policy"),
  schemaVersion: z.literal(1),
  isolation: z.strictObject({
    requiredBackend: z.literal("gvisor"),
    silentFallback: z.literal(false),
  }),
  lifecycle: z.strictObject({
    fresh: z.literal(true),
    disposable: z.literal(true),
  }),
  container: z.strictObject({
    privileged: z.literal(false),
    hostNetwork: z.literal(false),
    engineSocketMounted: z.literal(false),
  }),
  credentials: z.strictObject({
    ambientCredentials: z.literal(false),
    credentialBearingHostPaths: z.literal(false),
    brokeredSecretRefsOnly: z.literal(true),
  }),
  egress: z.discriminatedUnion("mode", [
    z.strictObject({ mode: z.literal("deny-all") }),
    z.strictObject({
      mode: z.literal("grant-only"),
      grantDigests: z.array(digestSchema).min(1).max(16),
    }),
  ]),
});

export const humanVerificationEnvironmentPolicySchema =
  environmentPolicyIdentitySchema
    .extend({ digest: digestSchema })
    .superRefine((policy, context) => {
      const { digest: _digest, ...identity } = policy;
      if (policy.digest !== humanOsDigest(identity)) {
        context.addIssue({
          code: "custom",
          path: ["digest"],
          message: "Environment Policy digest does not match its identity",
        });
      }
      if (
        policy.egress.mode === "grant-only" &&
        new Set(policy.egress.grantDigests).size !==
          policy.egress.grantDigests.length
      ) {
        context.addIssue({
          code: "custom",
          path: ["egress", "grantDigests"],
          message: "Environment Policy grant digests must be unique",
        });
      }
    });

const externalDependencyGrantIdentitySchema = z.strictObject({
  kind: z.literal("external-dependency-grant"),
  schemaVersion: z.literal(1),
  serviceId: identifierSchema,
  destinations: z
    .array(
      z.strictObject({
        hostname: z
          .string()
          .min(1)
          .max(253)
          .regex(/^[A-Za-z0-9.-]+$/),
        port: z.number().int().positive().max(65_535),
      }),
    )
    .min(1)
    .max(16),
  secretRef: z
    .strictObject({ id: identifierSchema, digest: digestSchema })
    .nullable(),
  maxRequests: z.number().int().positive(),
  expiresAt: z.string().datetime(),
});

export const externalDependencyGrantSchema =
  externalDependencyGrantIdentitySchema
    .extend({ digest: digestSchema })
    .superRefine((grant, context) => {
      const { digest: _digest, ...identity } = grant;
      if (grant.digest !== humanOsDigest(identity)) {
        context.addIssue({
          code: "custom",
          path: ["digest"],
          message:
            "External Dependency Grant digest does not match its identity",
        });
      }
    });

export const humanVerificationTargetSchema = z
  .strictObject({
    kind: z.literal("human-verification-target"),
    schemaVersion: z.literal(1),
    snapshot: humanReviewPacketSchema.shape.target,
    manifest: humanReviewPacketSchema.shape.manifest,
    sourceArtifact: z.strictObject({
      kind: z.literal("content-addressed-target-source"),
      mediaType: z.enum([
        "application/zip",
        "application/vnd.wordpress.source-tree+json",
      ]),
      digest: digestSchema,
    }),
  })
  .superRefine((target, context) => {
    if (
      target.manifest.targetSnapshotId !== target.snapshot.id ||
      target.manifest.targetSnapshotDigest !== target.snapshot.digest
    ) {
      context.addIssue({
        code: "custom",
        message: "Human Verification Target manifest does not own its snapshot",
      });
    }
  });

const environmentRequestIdentitySchema = z
  .strictObject({
    kind: z.literal("human-verification-environment-request"),
    schemaVersion: z.literal(1),
    packet: humanReviewPacketSchema,
    target: humanVerificationTargetSchema,
    runtimeProfile: humanVerificationRuntimeProfileSchema,
    setupPlan: humanVerificationSetupPlanSchema,
    policy: humanVerificationEnvironmentPolicySchema,
    grants: z.array(externalDependencyGrantSchema).max(16),
  })
  .superRefine((request, context) => {
    const packetMatchesTarget =
      request.packet.target.digest === request.target.snapshot.digest &&
      request.packet.target.id === request.target.snapshot.id &&
      request.packet.target.pluginSlug === request.target.snapshot.pluginSlug &&
      request.packet.target.version === request.target.snapshot.version &&
      request.packet.manifest.digest === request.target.manifest.digest &&
      request.packet.manifest.targetSnapshotDigest ===
        request.target.snapshot.digest &&
      request.setupPlan.pluginSlug === request.target.snapshot.pluginSlug;
    const grantDigests = request.grants.map((grant) => grant.digest).sort();
    const policyGrantDigests =
      request.policy.egress.mode === "grant-only"
        ? [...request.policy.egress.grantDigests].sort()
        : [];
    if (!packetMatchesTarget) {
      context.addIssue({
        code: "custom",
        message: "Environment Request does not match the Packet-bound Target",
      });
    }
    if (JSON.stringify(grantDigests) !== JSON.stringify(policyGrantDigests)) {
      context.addIssue({
        code: "custom",
        path: ["grants"],
        message:
          "Environment Request grants must exactly match Environment Policy",
      });
    }
  });

export const humanVerificationEnvironmentRequestSchema =
  environmentRequestIdentitySchema
    .extend({ digest: digestSchema })
    .superRefine((request, context) => {
      const { digest: _digest, ...identity } = request;
      if (request.digest !== humanOsDigest(identity)) {
        context.addIssue({
          code: "custom",
          path: ["digest"],
          message: "Environment Request digest does not match its identity",
        });
      }
    });

const findingVerificationEnvironmentRequestIdentitySchema = z
  .strictObject({
    kind: z.literal("finding-verification-environment-request"),
    schemaVersion: z.literal(1),
    finding: findingSchema,
    target: humanVerificationTargetSchema,
    runtimeProfile: humanVerificationRuntimeProfileSchema,
    setupPlan: humanVerificationSetupPlanSchema,
    policy: humanVerificationEnvironmentPolicySchema,
    grants: z.array(externalDependencyGrantSchema).max(16),
  })
  .superRefine((request, context) => {
    const grantDigests = request.grants.map((grant) => grant.digest).sort();
    const policyGrantDigests =
      request.policy.egress.mode === "grant-only"
        ? [...request.policy.egress.grantDigests].sort()
        : [];
    if (
      request.finding.target.id !== request.target.snapshot.id ||
      request.finding.target.pluginSlug !==
        request.target.snapshot.pluginSlug ||
      request.finding.target.version !== request.target.snapshot.version ||
      request.finding.target.digest !== request.target.snapshot.digest ||
      request.finding.manifest.targetSnapshotId !==
        request.target.manifest.targetSnapshotId ||
      request.finding.manifest.targetSnapshotDigest !==
        request.target.manifest.targetSnapshotDigest ||
      request.finding.manifest.digest !== request.target.manifest.digest ||
      request.setupPlan.pluginSlug !== request.target.snapshot.pluginSlug
    ) {
      context.addIssue({
        code: "custom",
        message: "Environment Request does not match the Finding-bound Target",
      });
    }
    if (JSON.stringify(grantDigests) !== JSON.stringify(policyGrantDigests)) {
      context.addIssue({
        code: "custom",
        path: ["grants"],
        message:
          "Environment Request grants must exactly match Environment Policy",
      });
    }
  });

export const findingVerificationEnvironmentRequestSchema =
  findingVerificationEnvironmentRequestIdentitySchema
    .extend({ digest: digestSchema })
    .superRefine((request, context) => {
      const { digest: _digest, ...identity } = request;
      if (request.digest !== humanOsDigest(identity)) {
        context.addIssue({
          code: "custom",
          path: ["digest"],
          message: "Finding Environment Request digest does not match identity",
        });
      }
    });

export const verificationEnvironmentRequestSchema = z.union([
  findingVerificationEnvironmentRequestSchema,
  humanVerificationEnvironmentRequestSchema,
]);

const stageObservationSchema = z.strictObject({
  ordinal: z.number().int().positive(),
  stage: z.enum(setupStageNames),
  status: z.enum(["completed", "failed", "not-run"]),
  observationDigest: digestSchema.nullable(),
});

export const isolationGateObservationSchema = z
  .strictObject({
    kind: z.literal("human-verification-isolation-gate-observation"),
    schemaVersion: z.literal(1),
    requestDigest: digestSchema,
    observedAt: z.string().datetime(),
    status: z.enum(["passed", "blocked"]),
    observedBackend: z.string().min(1).max(128).nullable(),
    observedRuntimeName: z.string().min(1).max(128).nullable(),
    observedRuntimeVersion: z.string().min(1).max(128).nullable(),
    privileged: z.boolean(),
    hostNetwork: z.boolean(),
    engineSocketMounted: z.boolean(),
    credentialBearingHostPathMounted: z.boolean(),
    unauthorizedEgress: z.boolean(),
    hostTargetExecution: z.boolean(),
    fallbackUsed: z.boolean(),
  })
  .superRefine((observation, context) => {
    if (
      observation.status === "passed" &&
      (observation.observedBackend !== "gvisor" ||
        observation.observedRuntimeName !== "runsc" ||
        observation.observedRuntimeVersion === null ||
        observation.privileged ||
        observation.hostNetwork ||
        observation.engineSocketMounted ||
        observation.credentialBearingHostPathMounted ||
        observation.unauthorizedEgress ||
        observation.hostTargetExecution ||
        observation.fallbackUsed)
    ) {
      context.addIssue({
        code: "custom",
        message:
          "A passed isolation gate must preserve every no-fallback policy",
      });
    }
  });

const setupReceiptBase = {
  kind: z.literal("human-verification-setup-receipt"),
  schemaVersion: z.literal(1),
  requestDigest: digestSchema,
  setupPlanDigest: digestSchema,
  startedAt: z.string().datetime(),
  completedAt: z.string().datetime(),
  stages: z.array(stageObservationSchema).length(setupStageNames.length),
} as const;

export const setupReceiptSchema = z
  .discriminatedUnion("status", [
    z.strictObject({
      ...setupReceiptBase,
      status: z.literal("ready"),
      environmentId: identifierSchema,
      cleanup: z.literal("pending-after-verification"),
    }),
    z.strictObject({
      ...setupReceiptBase,
      status: z.literal("setup-blocked"),
      environmentId: z.null(),
      cleanup: z.enum(["not-required", "completed", "failed"]),
    }),
  ])
  .superRefine((receipt, context) => {
    receipt.stages.forEach((stage, index) => {
      if (
        stage.ordinal !== index + 1 ||
        stage.stage !== setupStageNames[index]
      ) {
        context.addIssue({
          code: "custom",
          path: ["stages", index],
          message: "Setup Receipt stages must match the Setup Plan order",
        });
      }
    });
    if (
      receipt.status === "ready" &&
      receipt.stages.some(
        (stage) =>
          stage.status !== "completed" || stage.observationDigest === null,
      )
    ) {
      context.addIssue({
        code: "custom",
        path: ["stages"],
        message:
          "A ready Setup Receipt requires objective evidence for every stage",
      });
    }
  });

export const effectiveEnvironmentConfigurationSchema = z.strictObject({
  kind: z.literal("human-verification-effective-configuration"),
  schemaVersion: z.literal(1),
  requestDigest: digestSchema,
  runtimeProfileDigest: digestSchema,
  policyDigest: digestSchema,
  pluginSlug: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
  siteMode: z.literal("single-site"),
  locale: z.literal("en_US"),
  timezone: z.literal("UTC"),
  isolationBackend: z.literal("gvisor"),
  privileged: z.literal(false),
  hostNetwork: z.literal(false),
  engineSocketMounted: z.literal(false),
  credentialBearingHostPathMounted: z.literal(false),
  egressDestinations: z.array(
    z.strictObject({
      hostname: z.string().min(1),
      port: z.number().int().positive(),
    }),
  ),
  images: runtimeProfileIdentitySchema.shape.images,
});

export const targetRuntimeIdentitySchema = z.strictObject({
  kind: z.literal("human-verification-target-runtime-identity"),
  schemaVersion: z.literal(1),
  requestDigest: digestSchema,
  targetSnapshot: humanReviewPacketSchema.shape.target,
  manifest: humanReviewPacketSchema.shape.manifest,
  sourceArtifactDigest: digestSchema,
  runtimeProfileDigest: digestSchema,
  observedWordpressVersion: versionSchema,
  observedPhpVersion: versionSchema,
  observedDatabaseVersion: versionSchema,
  observedWebServerVersion: versionSchema,
  observedImages: runtimeProfileIdentitySchema.shape.images,
});

export const humanVerificationEnvironmentRefSchema = z.strictObject({
  kind: z.literal("human-verification-environment"),
  schemaVersion: z.literal(1),
  id: identifierSchema,
  requestDigest: digestSchema,
  targetSnapshotDigest: digestSchema,
  runtimeProfileDigest: digestSchema,
  isolationBackend: z.literal("gvisor"),
  disposable: z.literal(true),
});

const dispositionBase = {
  kind: z.literal("human-verification-environment-disposition"),
  schemaVersion: z.literal(1),
  requestDigest: digestSchema,
  gate: isolationGateObservationSchema,
  setupReceipt: setupReceiptSchema,
} as const;

export const humanVerificationEnvironmentDispositionSchema = z
  .discriminatedUnion("status", [
    z.strictObject({
      ...dispositionBase,
      status: z.literal("ready"),
      effectiveConfiguration: effectiveEnvironmentConfigurationSchema,
      targetRuntimeIdentity: targetRuntimeIdentitySchema,
      environment: humanVerificationEnvironmentRefSchema,
    }),
    z.strictObject({
      ...dispositionBase,
      status: z.literal("setup-blocked"),
      phase: z.enum(["isolation-gate", "setup", "activation", "health"]),
      reason: z.enum([
        "isolation-capability-unavailable",
        "isolation-inspection-failed",
        "policy-violation",
        "setup-failed",
        "activation-failed",
        "health-failed",
        "effective-configuration-mismatch",
        "target-runtime-identity-mismatch",
      ]),
    }),
  ])
  .superRefine((disposition, context) => {
    if (
      disposition.gate.requestDigest !== disposition.requestDigest ||
      disposition.setupReceipt.requestDigest !== disposition.requestDigest
    ) {
      context.addIssue({
        code: "custom",
        message: "Disposition contains a foreign request binding",
      });
    }
    if (disposition.status === "ready") {
      const values = [
        disposition.effectiveConfiguration.requestDigest,
        disposition.targetRuntimeIdentity.requestDigest,
        disposition.environment.requestDigest,
      ];
      if (
        disposition.gate.status !== "passed" ||
        disposition.setupReceipt.status !== "ready" ||
        values.some((value) => value !== disposition.requestDigest)
      ) {
        context.addIssue({
          code: "custom",
          message: "Ready Disposition contains a foreign request binding",
        });
      }
    } else if (disposition.setupReceipt.status !== "setup-blocked") {
      context.addIssue({
        code: "custom",
        message: "Setup Blocked Disposition requires a Setup Blocked receipt",
      });
    }
  });

export type HumanVerificationRuntimeProfile = z.infer<
  typeof humanVerificationRuntimeProfileSchema
>;
export type HumanVerificationSetupPlan = z.infer<
  typeof humanVerificationSetupPlanSchema
>;
export type HumanVerificationEnvironmentPolicy = z.infer<
  typeof humanVerificationEnvironmentPolicySchema
>;
export type ExternalDependencyGrant = z.infer<
  typeof externalDependencyGrantSchema
>;
export type HumanVerificationTarget = z.infer<
  typeof humanVerificationTargetSchema
>;
export type HumanVerificationEnvironmentRequest = z.infer<
  typeof humanVerificationEnvironmentRequestSchema
>;
export type FindingVerificationEnvironmentRequest = z.infer<
  typeof findingVerificationEnvironmentRequestSchema
>;
export type VerificationEnvironmentRequest = z.infer<
  typeof verificationEnvironmentRequestSchema
>;
export type IsolationGateObservation = z.infer<
  typeof isolationGateObservationSchema
>;
export type SetupStageObservation = z.infer<typeof stageObservationSchema>;
export type SetupReceipt = z.infer<typeof setupReceiptSchema>;
export type EffectiveEnvironmentConfiguration = z.infer<
  typeof effectiveEnvironmentConfigurationSchema
>;
export type TargetRuntimeIdentity = z.infer<typeof targetRuntimeIdentitySchema>;
export type HumanVerificationEnvironmentRef = z.infer<
  typeof humanVerificationEnvironmentRefSchema
>;
export type HumanVerificationEnvironmentDisposition = z.infer<
  typeof humanVerificationEnvironmentDispositionSchema
>;

export type EnvironmentRequestIdentity = z.input<
  typeof environmentRequestIdentitySchema
>;
export type RuntimeProfileIdentity = z.input<
  typeof runtimeProfileIdentitySchema
>;
export type SetupPlanIdentity = z.input<typeof setupPlanIdentitySchema>;
export type EnvironmentPolicyIdentity = z.input<
  typeof environmentPolicyIdentitySchema
>;
export type ExternalDependencyGrantIdentity = z.input<
  typeof externalDependencyGrantIdentitySchema
>;

export function defineHumanVerificationRuntimeProfile(
  identity: RuntimeProfileIdentity,
): HumanVerificationRuntimeProfile {
  return humanVerificationRuntimeProfileSchema.parse({
    ...identity,
    digest: humanOsDigest(identity),
  });
}

export function defineHumanVerificationSetupPlan(
  identity: SetupPlanIdentity,
): HumanVerificationSetupPlan {
  return humanVerificationSetupPlanSchema.parse({
    ...identity,
    digest: humanOsDigest(identity),
  });
}

export function defineHumanVerificationEnvironmentPolicy(
  identity: EnvironmentPolicyIdentity,
): HumanVerificationEnvironmentPolicy {
  return humanVerificationEnvironmentPolicySchema.parse({
    ...identity,
    digest: humanOsDigest(identity),
  });
}

export function defineExternalDependencyGrant(
  identity: ExternalDependencyGrantIdentity,
): ExternalDependencyGrant {
  return externalDependencyGrantSchema.parse({
    ...identity,
    digest: humanOsDigest(identity),
  });
}

export function defineHumanVerificationEnvironmentRequest(input: {
  readonly packet: HumanReviewPacket;
  readonly target: HumanVerificationTarget;
  readonly runtimeProfile: HumanVerificationRuntimeProfile;
  readonly setupPlan: HumanVerificationSetupPlan;
  readonly policy: HumanVerificationEnvironmentPolicy;
  readonly grants: readonly ExternalDependencyGrant[];
}): HumanVerificationEnvironmentRequest {
  const identity = environmentRequestIdentitySchema.parse({
    kind: "human-verification-environment-request",
    schemaVersion: 1,
    ...input,
  });
  return humanVerificationEnvironmentRequestSchema.parse({
    ...identity,
    digest: humanOsDigest(identity),
  });
}

export function defineFindingVerificationEnvironmentRequest(input: {
  readonly finding: Finding;
  readonly target: HumanVerificationTarget;
  readonly runtimeProfile: HumanVerificationRuntimeProfile;
  readonly setupPlan: HumanVerificationSetupPlan;
  readonly policy: HumanVerificationEnvironmentPolicy;
  readonly grants: readonly ExternalDependencyGrant[];
}): FindingVerificationEnvironmentRequest {
  const identity = findingVerificationEnvironmentRequestIdentitySchema.parse({
    kind: "finding-verification-environment-request",
    schemaVersion: 1,
    ...input,
  });
  return findingVerificationEnvironmentRequestSchema.parse({
    ...identity,
    digest: humanOsDigest(identity),
  });
}
