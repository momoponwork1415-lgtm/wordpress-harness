import { canonicalHumanOsJson } from "./canonical-json.js";
import type { HumanOsRecord } from "./human-os-record/contracts.js";
import {
  effectiveEnvironmentConfigurationSchema,
  humanVerificationEnvironmentDispositionSchema,
  humanVerificationEnvironmentRefSchema,
  verificationEnvironmentRequestSchema,
  isolationGateObservationSchema,
  setupReceiptSchema,
  setupStageNames,
  targetRuntimeIdentitySchema,
  type HumanVerificationEnvironmentDisposition,
  type VerificationEnvironmentRequest,
  type HumanVerificationRuntimeProfile,
  type IsolationGateObservation,
  type SetupStageObservation,
} from "./human-verification-environment-contracts.js";

export interface IsolationCapabilityInspection {
  readonly status: "available" | "unavailable";
  readonly observedBackend: string | null;
  readonly observedRuntimeName: string | null;
  readonly observedRuntimeVersion: string | null;
  readonly privileged: boolean;
  readonly hostNetwork: boolean;
  readonly engineSocketMounted: boolean;
  readonly credentialBearingHostPathMounted: boolean;
  readonly unauthorizedEgress: boolean;
  readonly hostTargetExecution: boolean;
  readonly fallbackUsed: boolean;
}

export interface ProvisionedEnvironmentHandle {
  readonly environmentId: string;
}

export interface ProvisionedSetupStageObservation {
  readonly ordinal: number;
  readonly stage: (typeof setupStageNames)[number];
  readonly status: "completed" | "failed" | "not-run";
  readonly observationDigest: string | null;
}

export interface ProvisionedEffectiveConfiguration {
  readonly pluginSlug: string;
  readonly siteMode: "single-site";
  readonly locale: "en_US";
  readonly timezone: "UTC";
  readonly isolationBackend: "gvisor";
  readonly privileged: false;
  readonly hostNetwork: false;
  readonly engineSocketMounted: false;
  readonly credentialBearingHostPathMounted: false;
  readonly egressDestinations: readonly {
    readonly hostname: string;
    readonly port: number;
  }[];
  readonly images: HumanVerificationRuntimeProfile["images"];
}

export interface ProvisionedTargetRuntimeIdentity {
  readonly targetSnapshot: VerificationEnvironmentRequest["target"]["snapshot"];
  readonly manifest: VerificationEnvironmentRequest["target"]["manifest"];
  readonly sourceArtifactDigest: string;
  readonly observedWordpressVersion: string;
  readonly observedPhpVersion: string;
  readonly observedDatabaseVersion: string;
  readonly observedWebServerVersion: string;
  readonly observedImages: HumanVerificationRuntimeProfile["images"];
}

export type EnvironmentSetupAttempt =
  | {
      readonly status: "ready";
      readonly handle: ProvisionedEnvironmentHandle;
      readonly stages: readonly ProvisionedSetupStageObservation[];
      readonly effectiveConfiguration: ProvisionedEffectiveConfiguration;
      readonly targetRuntimeIdentity: ProvisionedTargetRuntimeIdentity;
    }
  | {
      readonly status: "setup-blocked";
      readonly phase: "setup" | "activation" | "health";
      readonly reason: "setup-failed" | "activation-failed" | "health-failed";
      readonly partialEnvironment?: ProvisionedEnvironmentHandle;
      /**
       * Set only when the provisioner already tore down resources that never
       * became a handle, so the builder cannot repeat the teardown itself.
       * Absent means the builder still owns it. `completed` is deliberately
       * not in the union: a clean teardown needs no report.
       */
      readonly cleanup?: "failed" | "unverified";
      readonly stages: readonly ProvisionedSetupStageObservation[];
    };

export interface HumanVerificationEnvironmentProvisioner {
  inspectIsolation(
    request: VerificationEnvironmentRequest,
  ): Promise<IsolationCapabilityInspection>;
  setup(
    request: VerificationEnvironmentRequest,
  ): Promise<EnvironmentSetupAttempt>;
  cleanup(
    environment: ProvisionedEnvironmentHandle,
  ): Promise<"completed" | "failed" | "unverified">;
}

export interface HumanVerificationEnvironmentBuilder {
  establish(
    request: VerificationEnvironmentRequest,
  ): Promise<HumanVerificationEnvironmentDisposition>;
}

export interface OpenHumanVerificationEnvironmentBuilderOptions {
  readonly record: HumanOsRecord;
  readonly provisioner: HumanVerificationEnvironmentProvisioner;
  readonly clock?: () => Date;
}

function expectedEgressDestinations(
  request: VerificationEnvironmentRequest,
): readonly { readonly hostname: string; readonly port: number }[] {
  return request.grants
    .flatMap((grant) => grant.destinations)
    .map((destination) => ({ ...destination }))
    .sort((left, right) =>
      left.hostname === right.hostname
        ? left.port - right.port
        : left.hostname.localeCompare(right.hostname),
    );
}

function defaultStageObservations(): readonly SetupStageObservation[] {
  return setupStageNames.map((stage, index) => ({
    ordinal: index + 1,
    stage,
    status: "not-run" as const,
    observationDigest: null,
  }));
}

function projectStageObservations(
  stages: readonly ProvisionedSetupStageObservation[],
): readonly SetupStageObservation[] {
  if (
    stages.length !== setupStageNames.length ||
    stages.some(
      (stage, index) =>
        stage.ordinal !== index + 1 || stage.stage !== setupStageNames[index],
    )
  ) {
    throw new Error(
      "Provisioner returned invalid Setup Plan stage observations",
    );
  }
  return stages.map((stage) => ({ ...stage }));
}

function inspectionPasses(
  inspection: IsolationCapabilityInspection,
  request: VerificationEnvironmentRequest,
): boolean {
  return (
    inspection.status === "available" &&
    inspection.observedBackend === request.runtimeProfile.isolation.backend &&
    inspection.observedRuntimeName ===
      request.runtimeProfile.isolation.runtimeName &&
    inspection.observedRuntimeVersion ===
      request.runtimeProfile.isolation.runtimeVersion &&
    !inspection.privileged &&
    !inspection.hostNetwork &&
    !inspection.engineSocketMounted &&
    !inspection.credentialBearingHostPathMounted &&
    !inspection.unauthorizedEgress &&
    !inspection.hostTargetExecution &&
    !inspection.fallbackUsed
  );
}

async function cleanup(
  provisioner: HumanVerificationEnvironmentProvisioner,
  handle: ProvisionedEnvironmentHandle | undefined,
): Promise<"not-required" | "completed" | "failed" | "unverified"> {
  if (handle === undefined) return "not-required";
  try {
    return await provisioner.cleanup(handle);
  } catch {
    // A provisioner that threw observed nothing. `failed` is reserved for an
    // observed leak.
    return "unverified";
  }
}

class DefaultHumanVerificationEnvironmentBuilder implements HumanVerificationEnvironmentBuilder {
  readonly #record: HumanOsRecord;
  readonly #provisioner: HumanVerificationEnvironmentProvisioner;
  readonly #clock: () => Date;

  constructor(options: OpenHumanVerificationEnvironmentBuilderOptions) {
    this.#record = options.record;
    this.#provisioner = options.provisioner;
    this.#clock = options.clock ?? (() => new Date());
  }

  async establish(
    requestValue: VerificationEnvironmentRequest,
  ): Promise<HumanVerificationEnvironmentDisposition> {
    const request = verificationEnvironmentRequestSchema.parse(requestValue);
    const existing = await this.#record.readEnvironmentDisposition(
      request.digest,
    );
    if (existing !== undefined) return existing.disposition;

    const grantCheckTime = this.#clock().getTime();
    if (
      request.grants.some(
        (grant) => Date.parse(grant.expiresAt) <= grantCheckTime,
      )
    ) {
      const gate = this.#gate(request, undefined, "blocked");
      return this.#recordBlocked(request, gate, {
        phase: "isolation-gate",
        reason: "policy-violation",
        startedAt: gate.observedAt,
        stages: defaultStageObservations(),
        cleanup: "not-required",
      });
    }

    let inspection: IsolationCapabilityInspection;
    try {
      inspection = await this.#provisioner.inspectIsolation(request);
    } catch {
      const gate = this.#gate(request, undefined, "blocked");
      return this.#recordBlocked(request, gate, {
        phase: "isolation-gate",
        reason: "isolation-inspection-failed",
        startedAt: gate.observedAt,
        stages: defaultStageObservations(),
        cleanup: "not-required",
      });
    }

    const gatePassed = inspectionPasses(inspection, request);
    const gate = this.#gate(
      request,
      inspection,
      gatePassed ? "passed" : "blocked",
    );
    if (!gatePassed) {
      return this.#recordBlocked(request, gate, {
        phase: "isolation-gate",
        reason:
          inspection.status === "unavailable"
            ? "isolation-capability-unavailable"
            : "policy-violation",
        startedAt: gate.observedAt,
        stages: defaultStageObservations(),
        cleanup: "not-required",
      });
    }

    const startedAt = this.#clock().toISOString();
    let attempt: EnvironmentSetupAttempt;
    try {
      attempt = await this.#provisioner.setup(request);
    } catch {
      return this.#recordBlocked(request, gate, {
        phase: "setup",
        reason: "setup-failed",
        startedAt,
        stages: defaultStageObservations(),
        cleanup: "not-required",
      });
    }

    if (attempt.status === "setup-blocked") {
      const cleanupStatus =
        attempt.cleanup ??
        (await cleanup(this.#provisioner, attempt.partialEnvironment));
      let stages: readonly SetupStageObservation[];
      try {
        stages = projectStageObservations(attempt.stages);
      } catch {
        stages = defaultStageObservations();
      }
      return this.#recordBlocked(request, gate, {
        phase: attempt.phase,
        reason: attempt.reason,
        startedAt,
        stages,
        cleanup: cleanupStatus,
      });
    }

    let stages: readonly SetupStageObservation[];
    try {
      stages = projectStageObservations(attempt.stages);
      if (stages.some((stage) => stage.status !== "completed")) {
        throw new Error("Ready setup contains an incomplete stage");
      }
    } catch {
      const cleanupStatus = await cleanup(this.#provisioner, attempt.handle);
      return this.#recordBlocked(request, gate, {
        phase: "setup",
        reason: "setup-failed",
        startedAt,
        stages: defaultStageObservations(),
        cleanup: cleanupStatus,
      });
    }

    const effectiveConfigurationResult =
      effectiveEnvironmentConfigurationSchema.safeParse({
        kind: "human-verification-effective-configuration",
        schemaVersion: 1,
        requestDigest: request.digest,
        runtimeProfileDigest: request.runtimeProfile.digest,
        policyDigest: request.policy.digest,
        ...attempt.effectiveConfiguration,
        egressDestinations: [
          ...attempt.effectiveConfiguration.egressDestinations,
        ],
      });
    const expectedConfiguration = {
      pluginSlug: request.setupPlan.pluginSlug,
      siteMode: request.setupPlan.configuration.siteMode,
      locale: request.setupPlan.configuration.locale,
      timezone: request.setupPlan.configuration.timezone,
      isolationBackend: "gvisor",
      privileged: false,
      hostNetwork: false,
      engineSocketMounted: false,
      credentialBearingHostPathMounted: false,
      egressDestinations: expectedEgressDestinations(request),
      images: request.runtimeProfile.images,
    } as const;
    if (
      !effectiveConfigurationResult.success ||
      canonicalHumanOsJson(attempt.effectiveConfiguration) !==
        canonicalHumanOsJson(expectedConfiguration)
    ) {
      const cleanupStatus = await cleanup(this.#provisioner, attempt.handle);
      return this.#recordBlocked(request, gate, {
        phase: "setup",
        reason: "effective-configuration-mismatch",
        startedAt,
        stages,
        cleanup: cleanupStatus,
      });
    }
    const effectiveConfiguration = effectiveConfigurationResult.data;

    const targetRuntimeIdentityResult = targetRuntimeIdentitySchema.safeParse({
      kind: "human-verification-target-runtime-identity",
      schemaVersion: 1,
      requestDigest: request.digest,
      runtimeProfileDigest: request.runtimeProfile.digest,
      ...attempt.targetRuntimeIdentity,
    });
    const expectedIdentity: ProvisionedTargetRuntimeIdentity = {
      targetSnapshot: request.target.snapshot,
      manifest: request.target.manifest,
      sourceArtifactDigest: request.target.sourceArtifact.digest,
      observedWordpressVersion: request.runtimeProfile.wordpressVersion,
      observedPhpVersion: request.runtimeProfile.phpVersion,
      observedDatabaseVersion: request.runtimeProfile.databaseVersion,
      observedWebServerVersion: request.runtimeProfile.webServerVersion,
      observedImages: request.runtimeProfile.images,
    };
    if (
      !targetRuntimeIdentityResult.success ||
      canonicalHumanOsJson(attempt.targetRuntimeIdentity) !==
        canonicalHumanOsJson(expectedIdentity)
    ) {
      const cleanupStatus = await cleanup(this.#provisioner, attempt.handle);
      return this.#recordBlocked(request, gate, {
        phase: "setup",
        reason: "target-runtime-identity-mismatch",
        startedAt,
        stages,
        cleanup: cleanupStatus,
      });
    }
    const targetRuntimeIdentity = targetRuntimeIdentityResult.data;

    const completedAt = this.#clock().toISOString();
    const environmentResult = humanVerificationEnvironmentRefSchema.safeParse({
      kind: "human-verification-environment",
      schemaVersion: 1,
      id: attempt.handle.environmentId,
      requestDigest: request.digest,
      targetSnapshotDigest: request.target.snapshot.digest,
      runtimeProfileDigest: request.runtimeProfile.digest,
      isolationBackend: "gvisor",
      disposable: true,
    });
    if (!environmentResult.success) {
      const cleanupStatus = await cleanup(this.#provisioner, attempt.handle);
      return this.#recordBlocked(request, gate, {
        phase: "setup",
        reason: "setup-failed",
        startedAt,
        stages,
        cleanup: cleanupStatus,
      });
    }
    const setupReceipt = setupReceiptSchema.parse({
      kind: "human-verification-setup-receipt",
      schemaVersion: 1,
      requestDigest: request.digest,
      setupPlanDigest: request.setupPlan.digest,
      startedAt,
      completedAt,
      stages,
      status: "ready",
      environmentId: attempt.handle.environmentId,
      cleanup: "pending-after-verification",
    });
    const environment = environmentResult.data;
    const disposition = humanVerificationEnvironmentDispositionSchema.parse({
      kind: "human-verification-environment-disposition",
      schemaVersion: 1,
      requestDigest: request.digest,
      status: "ready",
      gate,
      setupReceipt,
      effectiveConfiguration,
      targetRuntimeIdentity,
      environment,
    });

    let recorded: Awaited<
      ReturnType<HumanOsRecord["recordEnvironmentDisposition"]>
    >;
    try {
      recorded = await this.#record.recordEnvironmentDisposition(
        request,
        disposition,
      );
    } catch (error) {
      await cleanup(this.#provisioner, attempt.handle);
      throw error;
    }
    if (recorded.status === "occupied") {
      const cleanupStatus = await cleanup(this.#provisioner, attempt.handle);
      if (cleanupStatus !== "completed") {
        throw new Error(
          "Duplicate Human Verification Environment cleanup failed",
        );
      }
    }
    return recorded.view.disposition;
  }

  #gate(
    request: VerificationEnvironmentRequest,
    inspection: IsolationCapabilityInspection | undefined,
    status: "passed" | "blocked",
  ): IsolationGateObservation {
    return isolationGateObservationSchema.parse({
      kind: "human-verification-isolation-gate-observation",
      schemaVersion: 1,
      requestDigest: request.digest,
      observedAt: this.#clock().toISOString(),
      status,
      observedBackend: inspection?.observedBackend ?? null,
      observedRuntimeName: inspection?.observedRuntimeName ?? null,
      observedRuntimeVersion: inspection?.observedRuntimeVersion ?? null,
      privileged: inspection?.privileged ?? false,
      hostNetwork: inspection?.hostNetwork ?? false,
      engineSocketMounted: inspection?.engineSocketMounted ?? false,
      credentialBearingHostPathMounted:
        inspection?.credentialBearingHostPathMounted ?? false,
      unauthorizedEgress: inspection?.unauthorizedEgress ?? false,
      hostTargetExecution: inspection?.hostTargetExecution ?? false,
      fallbackUsed: inspection?.fallbackUsed ?? false,
    });
  }

  async #recordBlocked(
    request: VerificationEnvironmentRequest,
    gate: IsolationGateObservation,
    input: {
      readonly phase: "isolation-gate" | "setup" | "activation" | "health";
      readonly reason:
        | "isolation-capability-unavailable"
        | "isolation-inspection-failed"
        | "policy-violation"
        | "setup-failed"
        | "activation-failed"
        | "health-failed"
        | "effective-configuration-mismatch"
        | "target-runtime-identity-mismatch";
      readonly startedAt: string;
      readonly stages: readonly SetupStageObservation[];
      readonly cleanup: "not-required" | "completed" | "failed" | "unverified";
    },
  ): Promise<HumanVerificationEnvironmentDisposition> {
    const setupReceipt = setupReceiptSchema.parse({
      kind: "human-verification-setup-receipt",
      schemaVersion: 1,
      requestDigest: request.digest,
      setupPlanDigest: request.setupPlan.digest,
      startedAt: input.startedAt,
      completedAt: this.#clock().toISOString(),
      stages: input.stages,
      status: "setup-blocked",
      environmentId: null,
      cleanup: input.cleanup,
    });
    const disposition = humanVerificationEnvironmentDispositionSchema.parse({
      kind: "human-verification-environment-disposition",
      schemaVersion: 1,
      requestDigest: request.digest,
      status: "setup-blocked",
      gate,
      setupReceipt,
      phase: input.phase,
      reason: input.reason,
    });
    const result = await this.#record.recordEnvironmentDisposition(
      request,
      disposition,
    );
    return result.view.disposition;
  }
}

export function openHumanVerificationEnvironmentBuilder(
  options: OpenHumanVerificationEnvironmentBuilderOptions,
): HumanVerificationEnvironmentBuilder {
  return new DefaultHumanVerificationEnvironmentBuilder(options);
}
