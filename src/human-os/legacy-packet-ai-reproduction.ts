import {
  runtimeVerificationPacketDeliveryReceiptSchema,
  runtimeVerificationPacketDeliveryRequestSchema,
  type RuntimeVerificationPacket,
  type RuntimeVerificationPacketDelivery,
  type RuntimeVerificationPacketDeliveryReceipt,
  type RuntimeVerificationPacketDeliveryRequest,
} from "../research/validation/runtime-verification-packet.js";
import { canonicalHumanOsJson, humanOsDigest } from "./canonical-json.js";
import type { AIReproductionRecord } from "./human-os-record/contracts.js";
import {
  aiReproductionHarnessExecutionSchema,
  aiReproductionPrivateSchemas,
  aiReproductionResultSchema,
  aiReproductionRuntimeIdentitySchema,
  defineAIReproductionAttempt,
  defineAIReproductionIntake,
  defineRuntimePacketDeliveryReceipt,
  humanOsPrivateArtifactRefSchema,
  privateEvidenceBundleSchema,
  referenceAIReproductionAttempt,
  reproductionRecipeSchema,
  triageReproductionPacketSchema,
  type AIReproductionAttempt,
  type AIReproductionHarnessExecution,
  type AIReproductionIntake,
  type AIReproductionResult,
  type HumanOsPrivateArtifactRef,
} from "./ai-reproduction-contracts.js";
import type {
  ExternalDependencyGrant,
  HumanVerificationEnvironmentPolicy,
  HumanVerificationRuntimeProfile,
  HumanVerificationSetupPlan,
  HumanVerificationTarget,
} from "./human-verification-environment-contracts.js";

export interface HumanOsPrivateArtifactStore {
  putPrivateJson(value: unknown): Promise<string>;
  readPrivateJson(digest: string): Promise<unknown>;
}

export interface LegacyPacketAIReproductionHarness {
  run(input: {
    readonly attempt: AIReproductionAttempt;
    readonly packet: RuntimeVerificationPacket;
  }): Promise<unknown>;
}

export interface LegacyPacketAIReproductionRunRequest {
  readonly deliveryRequest: RuntimeVerificationPacketDeliveryRequest;
  readonly target: HumanVerificationTarget;
  readonly runtimeProfile: HumanVerificationRuntimeProfile;
  readonly setupPlan: HumanVerificationSetupPlan;
  readonly environmentPolicy: HumanVerificationEnvironmentPolicy;
  readonly grants: readonly ExternalDependencyGrant[];
}

export interface LegacyPacketAIReproduction extends RuntimeVerificationPacketDelivery {
  run(
    request: LegacyPacketAIReproductionRunRequest,
  ): Promise<AIReproductionResult>;
  read(attemptId: string): Promise<AIReproductionResult | undefined>;
}

export interface OpenLegacyPacketAIReproductionOptions {
  readonly record: AIReproductionRecord;
  readonly privateArtifactStore: HumanOsPrivateArtifactStore;
  readonly harness: LegacyPacketAIReproductionHarness;
  readonly clock?: () => Date;
}

function privateArtifactRef(input: {
  readonly artifactKind: "reproduction-recipe" | "private-evidence-bundle";
  readonly id: string;
  readonly digest: string;
  readonly attemptId: string;
  readonly targetSnapshotDigest: string;
}): HumanOsPrivateArtifactRef {
  return humanOsPrivateArtifactRefSchema.parse({
    kind: "human-os-private-artifact",
    schemaVersion: 2,
    ...input,
    storage: "human-os-private-store",
  });
}

function environmentMatchesAttempt(
  execution: Extract<
    AIReproductionHarnessExecution,
    { readonly status: "runtime-confirmed" }
  >,
  attempt: AIReproductionAttempt,
): boolean {
  const identity = execution.runtimeIdentity;
  return (
    identity.targetSnapshotDigest === attempt.target.snapshot.digest &&
    identity.manifestDigest === attempt.target.manifest.digest &&
    identity.runtimeProfileDigest === attempt.runtimeProfile.digest &&
    identity.setupPlanDigest === attempt.setupPlan.digest &&
    identity.toolPolicyDigest === humanOsDigest(attempt.toolPolicy) &&
    identity.observedWordpressVersion ===
      attempt.runtimeProfile.wordpressVersion &&
    identity.observedPhpVersion === attempt.runtimeProfile.phpVersion &&
    identity.observedDatabaseVersion ===
      attempt.runtimeProfile.databaseVersion &&
    identity.observedWebServerVersion ===
      attempt.runtimeProfile.webServerVersion &&
    identity.isolation.runtimeVersion ===
      attempt.runtimeProfile.isolation.runtimeVersion &&
    canonicalHumanOsJson(identity.observedImages) ===
      canonicalHumanOsJson(attempt.runtimeProfile.images)
  );
}

function publicCriterion(
  attempt: AIReproductionAttempt,
  execution: Extract<
    AIReproductionHarnessExecution,
    { readonly status: "runtime-confirmed" }
  >,
) {
  switch (execution.recipe.class) {
    case "sql-injection":
      return {
        class: execution.recipe.class,
        proof: "database-security-effect" as const,
        expectedDatabaseEffect:
          "Observe the Packet-bound Security Effect in the database-facing outcome.",
      };
    case "cross-site-scripting":
      return {
        class: execution.recipe.class,
        proof: "browser-execution-canary" as const,
        expectedBrowserEffect:
          "Observe a bounded browser canary for the Packet-bound Security Effect.",
      };
    case "authorization":
      return {
        class: execution.recipe.class,
        proof: "cross-role-security-effect" as const,
        expectedOwnershipEffect:
          "Observe the Packet-bound Security Effect across the declared actor boundary.",
      };
    case "file-operation":
      return {
        class: execution.recipe.class,
        proof: "filesystem-security-effect" as const,
        expectedFilesystemEffect:
          "Observe the Packet-bound Security Effect in isolated filesystem state.",
      };
    case "code-execution":
      return {
        class: execution.recipe.class,
        proof: "execution-canary" as const,
        canaryDigest:
          execution.recipe.criterion.class === "code-execution"
            ? execution.recipe.criterion.canaryDigest
            : humanOsDigest(attempt.securityEffect),
        expectedCanaryEffect:
          "Observe a nonce execution canary only inside the disposable runtime.",
      };
    case "generic":
      return {
        class: execution.recipe.class,
        proof: "security-effect-observation" as const,
        expectedSecurityEffect: `Observe the Packet-bound ${attempt.securityEffect.claimedPropertyChange} Security Effect.`,
      };
  }
}

function publicObservation(attempt: AIReproductionAttempt) {
  return {
    securityEffect: "observed" as const,
    description: `The harness observed the Packet-bound ${attempt.securityEffect.claimedPropertyChange} Security Effect.`,
  };
}

function publicProof(
  execution: Extract<
    AIReproductionHarnessExecution,
    { readonly status: "runtime-confirmed" }
  >,
) {
  return {
    witness:
      execution.proof.witness === null
        ? null
        : {
            observationDigest: execution.proof.witness.observationDigest,
            description:
              "A bounded witness observation is retained in Human OS evidence.",
          },
    causalControl:
      execution.proof.causalControl === null
        ? null
        : {
            observationDigest: execution.proof.causalControl.observationDigest,
            description:
              "An optional causal-control observation is retained in Human OS evidence.",
          },
  };
}

function publicOutcomeDescription(
  status: "runtime-inconclusive" | "setup-blocked" | "execution-failed",
  reason: string,
): string {
  return `The AI Reproduction harness recorded ${status} with reason ${reason}.`;
}

function failedResult(input: {
  readonly attempt: AIReproductionAttempt;
  readonly packet: RuntimeVerificationPacket;
  readonly completedAt: string;
  readonly reason:
    | "provider-failed"
    | "budget-exhausted"
    | "policy-denied"
    | "harness-failed"
    | "invalid-harness-output"
    | "private-evidence-store-failed"
    | "cleanup-failed";
  readonly description: string;
  readonly cleanup?: "not-required" | "completed" | "failed";
}): AIReproductionResult {
  return aiReproductionResultSchema.parse({
    kind: "ai-reproduction-result",
    schemaVersion: 2,
    attempt: referenceAIReproductionAttempt(input.attempt),
    runtimePacket: input.attempt.packet,
    completedAt: input.completedAt,
    cleanup: input.cleanup ?? "not-required",
    status: "execution-failed",
    reason: input.reason,
    description: input.description,
    triagePacket: null,
  });
}

class DefaultLegacyPacketAIReproduction implements LegacyPacketAIReproduction {
  readonly #record: AIReproductionRecord;
  readonly #privateArtifactStore: HumanOsPrivateArtifactStore;
  readonly #harness: LegacyPacketAIReproductionHarness;
  readonly #clock: () => Date;

  constructor(options: OpenLegacyPacketAIReproductionOptions) {
    this.#record = options.record;
    this.#privateArtifactStore = options.privateArtifactStore;
    this.#harness = options.harness;
    this.#clock = options.clock ?? (() => new Date());
  }

  async deliver(
    requestValue: RuntimeVerificationPacketDeliveryRequest,
  ): Promise<RuntimeVerificationPacketDeliveryReceipt> {
    const request =
      runtimeVerificationPacketDeliveryRequestSchema.parse(requestValue);
    const existing = await this.#record.readAIReproductionIntake(
      request.digest,
    );
    const intake =
      existing?.intake ??
      defineAIReproductionIntake({
        request,
        admittedAt: this.#clock().toISOString(),
      });
    const persisted =
      existing?.intake ??
      (await this.#record.recordAIReproductionIntake(request, intake)).view
        .intake;
    return runtimeVerificationPacketDeliveryReceiptSchema.parse(
      defineRuntimePacketDeliveryReceipt({ request, intake: persisted }),
    );
  }

  async run(
    requestValue: LegacyPacketAIReproductionRunRequest,
  ): Promise<AIReproductionResult> {
    const deliveryRequest =
      runtimeVerificationPacketDeliveryRequestSchema.parse(
        requestValue.deliveryRequest,
      );
    await this.deliver(deliveryRequest);
    const intakeView = await this.#record.readAIReproductionIntake(
      deliveryRequest.digest,
    );
    if (intakeView === undefined) {
      throw new Error("AI Reproduction Intake was not persisted");
    }
    const intake = intakeView.intake;
    const attempt = defineAIReproductionAttempt({
      intake,
      packet: deliveryRequest.packet,
      target: requestValue.target,
      runtimeProfile: requestValue.runtimeProfile,
      setupPlan: requestValue.setupPlan,
      environmentPolicy: requestValue.environmentPolicy,
      grants: requestValue.grants,
    });
    const existing = await this.#record.readAIReproductionResult(attempt.id);
    if (existing !== undefined) return existing.result;

    const result = await this.#execute(intake, attempt, deliveryRequest.packet);
    const recorded = await this.#record.recordAIReproductionResult(
      intake,
      attempt,
      result,
    );
    return recorded.view.result;
  }

  async read(attemptId: string): Promise<AIReproductionResult | undefined> {
    return (await this.#record.readAIReproductionResult(attemptId))?.result;
  }

  async #execute(
    intake: AIReproductionIntake,
    attempt: AIReproductionAttempt,
    packet: RuntimeVerificationPacket,
  ): Promise<AIReproductionResult> {
    let rawExecution: unknown;
    try {
      rawExecution = await this.#harness.run({ attempt, packet });
    } catch {
      return failedResult({
        attempt,
        packet,
        completedAt: this.#clock().toISOString(),
        reason: "harness-failed",
        description:
          "The harness failed before it produced a typed runtime outcome.",
        cleanup: "not-required",
      });
    }
    const parsedExecution =
      aiReproductionHarnessExecutionSchema.safeParse(rawExecution);
    if (!parsedExecution.success) {
      return failedResult({
        attempt,
        packet,
        completedAt: this.#clock().toISOString(),
        reason: "invalid-harness-output",
        description:
          "The harness output did not satisfy the AI Reproduction contract.",
        cleanup: "not-required",
      });
    }
    const execution = parsedExecution.data;
    if (execution.cleanup === "failed") {
      return failedResult({
        attempt,
        packet,
        completedAt: execution.completedAt,
        reason: "cleanup-failed",
        description: "The disposable runtime could not be fully cleaned up.",
        cleanup: "failed",
      });
    }
    if (execution.status === "runtime-confirmed") {
      return this.#confirmedResult(attempt, packet, execution);
    }
    const attemptRef = referenceAIReproductionAttempt(attempt);
    if (execution.status === "runtime-inconclusive") {
      return aiReproductionResultSchema.parse({
        kind: "ai-reproduction-result",
        schemaVersion: 2,
        attempt: attemptRef,
        runtimePacket: attempt.packet,
        completedAt: execution.completedAt,
        cleanup: execution.cleanup,
        status: execution.status,
        reason: execution.reason,
        description: publicOutcomeDescription(
          execution.status,
          execution.reason,
        ),
        triagePacket: null,
      });
    }
    if (execution.status === "setup-blocked") {
      return aiReproductionResultSchema.parse({
        kind: "ai-reproduction-result",
        schemaVersion: 2,
        attempt: attemptRef,
        runtimePacket: attempt.packet,
        completedAt: execution.completedAt,
        cleanup: execution.cleanup,
        status: execution.status,
        reason: execution.reason,
        description: publicOutcomeDescription(
          execution.status,
          execution.reason,
        ),
        triagePacket: null,
      });
    }
    return failedResult({
      attempt,
      packet,
      completedAt: execution.completedAt,
      reason: execution.reason,
      description: publicOutcomeDescription(execution.status, execution.reason),
      cleanup: execution.cleanup,
    });
  }

  async #confirmedResult(
    attempt: AIReproductionAttempt,
    packet: RuntimeVerificationPacket,
    execution: Extract<
      AIReproductionHarnessExecution,
      { readonly status: "runtime-confirmed" }
    >,
  ): Promise<AIReproductionResult> {
    if (
      !environmentMatchesAttempt(execution, attempt) ||
      execution.recipe.actors.attackerRole !== attempt.attackerPremise ||
      canonicalHumanOsJson(execution.recipe.payloads) !==
        canonicalHumanOsJson(execution.privateEvidence.exactPayloads)
    ) {
      return aiReproductionResultSchema.parse({
        kind: "ai-reproduction-result",
        schemaVersion: 2,
        attempt: referenceAIReproductionAttempt(attempt),
        runtimePacket: attempt.packet,
        completedAt: execution.completedAt,
        cleanup: execution.cleanup,
        status: "runtime-inconclusive",
        reason: "environment-identity-mismatch",
        description:
          "The observed runtime or private evidence did not match the Packet-bound attempt.",
        triagePacket: null,
      });
    }

    const recipeIdentity = aiReproductionPrivateSchemas.recipeIdentity.parse({
      kind: "reproduction-recipe",
      schemaVersion: 2,
      attemptId: attempt.id,
      targetSnapshotDigest: attempt.target.snapshot.digest,
      runtimeIdentity: aiReproductionRuntimeIdentitySchema.parse(
        execution.runtimeIdentity,
      ),
      recordedAt: execution.completedAt,
      recipe: execution.recipe,
    });
    const recipe = reproductionRecipeSchema.parse({
      ...recipeIdentity,
      id: humanOsDigest(recipeIdentity),
    });
    const evidenceIdentity =
      aiReproductionPrivateSchemas.evidenceIdentity.parse({
        kind: "private-evidence-bundle",
        schemaVersion: 2,
        attemptId: attempt.id,
        targetSnapshotDigest: attempt.target.snapshot.digest,
        collectedAt: execution.completedAt,
        evidence: execution.privateEvidence,
      });
    const evidence = privateEvidenceBundleSchema.parse({
      ...evidenceIdentity,
      id: humanOsDigest(evidenceIdentity),
    });

    let recipeDigest: string;
    let evidenceDigest: string;
    try {
      [recipeDigest, evidenceDigest] = await Promise.all([
        this.#privateArtifactStore.putPrivateJson(recipe),
        this.#privateArtifactStore.putPrivateJson(evidence),
      ]);
    } catch {
      return failedResult({
        attempt,
        packet,
        completedAt: execution.completedAt,
        reason: "private-evidence-store-failed",
        description:
          "The private Recipe or evidence could not be stored durably.",
        cleanup: "completed",
      });
    }
    if (
      recipeDigest !== humanOsDigest(recipe) ||
      evidenceDigest !== humanOsDigest(evidence)
    ) {
      return failedResult({
        attempt,
        packet,
        completedAt: execution.completedAt,
        reason: "private-evidence-store-failed",
        description:
          "The private store returned a digest for foreign artifact content.",
        cleanup: "completed",
      });
    }

    const recipeRef = privateArtifactRef({
      artifactKind: "reproduction-recipe",
      id: recipe.id,
      digest: recipeDigest,
      attemptId: attempt.id,
      targetSnapshotDigest: attempt.target.snapshot.digest,
    });
    const evidenceRef = privateArtifactRef({
      artifactKind: "private-evidence-bundle",
      id: evidence.id,
      digest: evidenceDigest,
      attemptId: attempt.id,
      targetSnapshotDigest: attempt.target.snapshot.digest,
    });
    const attemptRef = referenceAIReproductionAttempt(attempt);
    const observation = publicObservation(attempt);
    const proof = publicProof(execution);
    const triageIdentity = aiReproductionPrivateSchemas.triageIdentity.parse({
      kind: "triage-reproduction-packet",
      schemaVersion: 2,
      runtimePacket: attempt.packet,
      attempt: attemptRef,
      runtimeIdentity: execution.runtimeIdentity,
      recipe: recipeRef,
      privateEvidence: evidenceRef,
      recipeMetadata: {
        class: execution.recipe.class,
        criterion: publicCriterion(attempt, execution),
        stepCount: execution.recipe.steps.length,
        expectedSecurityEffect: attempt.securityEffect.claimedPropertyChange,
      },
      observation,
      proof,
      confirmedAt: execution.completedAt,
      boundary: {
        runtimeConfirmed: true,
        humanVerified: false,
        findingEligible: false,
        humanDisposition: false,
        programmeEligibility: false,
      },
    });
    const triagePacket = triageReproductionPacketSchema.parse({
      ...triageIdentity,
      id: humanOsDigest(triageIdentity),
    });
    return aiReproductionResultSchema.parse({
      kind: "ai-reproduction-result",
      schemaVersion: 2,
      attempt: attemptRef,
      runtimePacket: attempt.packet,
      completedAt: execution.completedAt,
      cleanup: "completed",
      status: "runtime-confirmed",
      runtimeIdentity: execution.runtimeIdentity,
      observation,
      recipe: recipeRef,
      privateEvidence: evidenceRef,
      triagePacket,
    });
  }
}

export function openLegacyPacketAIReproduction(
  options: OpenLegacyPacketAIReproductionOptions,
): LegacyPacketAIReproduction {
  return new DefaultLegacyPacketAIReproduction(options);
}
