import { createHash, randomBytes } from "node:crypto";

import {
  findingSchema,
  referenceFinding,
  type Finding,
} from "../research/validation/finding.js";
import { canonicalHumanOsJson, humanOsDigest } from "./canonical-json.js";
import {
  defineAIVerificationRecord,
  defineFindingAIReproductionAttempt,
  aiReproductionViewSchema,
  findingAIReproductionHarnessExecutionSchema,
  findingAIReproductionPrivateSchemas,
  humanOsPrivateArtifactRefSchema,
  referenceFindingAIReproductionAttempt,
  type AIVerificationRecord,
  type AIReproductionView,
  type FindingAIReproductionAttempt,
  type FindingAIReproductionHarnessExecution,
  type FindingAIReproductionPrivateEvidenceDraft,
  type HumanOsPrivateArtifactRef,
} from "./ai-reproduction-contracts.js";
import type { FindingAIReproductionStore } from "./human-os-record/contracts.js";
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
  putPrivateBytes(value: Uint8Array): Promise<string>;
  readPrivateBytes(digest: string): Promise<Uint8Array>;
}

export interface AIReproductionHarness {
  run(input: {
    readonly attempt: FindingAIReproductionAttempt;
    readonly finding: Finding;
  }): Promise<unknown>;
}

export interface FindingAIReproductionRequest {
  readonly finding: Finding;
  readonly target: HumanVerificationTarget;
  readonly runtimeProfile: HumanVerificationRuntimeProfile;
  readonly setupPlan: HumanVerificationSetupPlan;
  readonly environmentPolicy: HumanVerificationEnvironmentPolicy;
  readonly grants: readonly ExternalDependencyGrant[];
}

export interface AIReproduction {
  run(request: FindingAIReproductionRequest): Promise<AIVerificationRecord>;
  read(findingId: string): Promise<AIReproductionView | undefined>;
}

export interface OpenAIReproductionOptions {
  readonly record: FindingAIReproductionStore;
  readonly privateArtifactStore: HumanOsPrivateArtifactStore;
  readonly harness: AIReproductionHarness;
  readonly clock?: () => Date;
}

export class FindingAIReproductionInProgressError extends Error {
  readonly attemptId: string;
  readonly startedAt: string;

  constructor(input: {
    readonly attemptId: string;
    readonly startedAt: string;
  }) {
    super(
      `Finding AI Reproduction Attempt is already in progress: ${input.attemptId} (started ${input.startedAt})`,
    );
    this.name = "FindingAIReproductionInProgressError";
    this.attemptId = input.attemptId;
    this.startedAt = input.startedAt;
  }
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

function rawBytesDigest(value: Uint8Array): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function environmentMatchesAttempt(
  execution: Extract<
    FindingAIReproductionHarnessExecution,
    { readonly status: "runtime-confirmed" | "disproved" }
  >,
  attempt: FindingAIReproductionAttempt,
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

class DefaultAIReproduction implements AIReproduction {
  readonly #record: FindingAIReproductionStore;
  readonly #privateArtifactStore: HumanOsPrivateArtifactStore;
  readonly #harness: AIReproductionHarness;
  readonly #clock: () => Date;

  constructor(options: OpenAIReproductionOptions) {
    this.#record = options.record;
    this.#privateArtifactStore = options.privateArtifactStore;
    this.#harness = options.harness;
    this.#clock = options.clock ?? (() => new Date());
  }

  async run(requestValue: FindingAIReproductionRequest) {
    const finding = findingSchema.parse(requestValue.finding);
    const attempt = defineFindingAIReproductionAttempt({
      finding,
      target: requestValue.target,
      runtimeProfile: requestValue.runtimeProfile,
      setupPlan: requestValue.setupPlan,
      environmentPolicy: requestValue.environmentPolicy,
      grants: requestValue.grants,
    });
    const claimed = await this.#record.claimFindingAIReproduction(
      finding,
      attempt,
      `sha256:${randomBytes(32).toString("hex")}`,
    );
    if (claimed.status === "completed") return claimed.view.record;
    if (claimed.status === "in-progress") {
      throw new FindingAIReproductionInProgressError(claimed.claim);
    }
    const record = await this.#execute(finding, attempt);
    const appended = await this.#record.recordFindingAIReproduction(
      claimed.claim,
      finding,
      attempt,
      record,
    );
    if (
      appended.status === "occupied" &&
      canonicalHumanOsJson(appended.view.record) !==
        canonicalHumanOsJson(record)
    ) {
      throw new Error("Finding AI Reproduction Attempt conflict");
    }
    return appended.view.record;
  }

  async read(findingId: string): Promise<AIReproductionView | undefined> {
    const [events, claims] = await Promise.all([
      this.#record.listFindingAIReproduction(findingId),
      this.#record.listFindingAIReproductionClaims(findingId),
    ]);
    const first = events[0];
    const firstClaim = claims[0];
    if (first === undefined && firstClaim === undefined) return undefined;
    const finding = first?.finding ?? firstClaim?.finding;
    if (finding === undefined) return undefined;
    if (
      events.some(
        (event) =>
          event.finding.id !== finding.id ||
          humanOsDigest(event.finding) !== humanOsDigest(finding),
      )
    ) {
      throw new Error("Finding AI Reproduction replay binding mismatch");
    }
    if (
      claims.some(
        (claim) =>
          claim.finding.id !== finding.id ||
          humanOsDigest(claim.finding) !== humanOsDigest(finding),
      )
    ) {
      throw new Error("Finding AI Reproduction claim replay binding mismatch");
    }
    const completedAttemptIds = new Set(
      events.map((event) => event.attempt.id),
    );
    const incompleteClaims = claims
      .filter((claim) => !completedAttemptIds.has(claim.attempt.id))
      .map((claim) => ({
        attempt: referenceFindingAIReproductionAttempt(claim.attempt),
        startedAt: claim.claim.startedAt,
        processStatus: "unknown" as const,
        cleanupStatus: "unknown" as const,
      }));
    return aiReproductionViewSchema.parse({
      kind: "ai-reproduction-view",
      schemaVersion: 1,
      status:
        events.length === 0
          ? "result-not-recorded"
          : incompleteClaims.length === 0
            ? "completed"
            : "completed-with-result-not-recorded",
      finding,
      assurance: {
        source: "source-validated",
        runtime: events.map((event) => event.record.outcome.status),
      },
      records: events.map((event) => event.record),
      incompleteClaims,
    });
  }

  async #execute(finding: Finding, attempt: FindingAIReproductionAttempt) {
    const execution = findingAIReproductionHarnessExecutionSchema.parse(
      await this.#harness.run({ finding, attempt }),
    );
    if (execution.status === "setup-blocked") {
      return this.#withoutExperiment(finding, attempt, {
        status: "setup-blocked",
        reasonCode: execution.reason,
        reason:
          execution.cleanup === "failed"
            ? `${execution.description} Cleanup also failed.`
            : execution.description,
        performedAt: execution.completedAt,
      });
    }
    if (execution.status === "inconclusive") {
      return this.#withoutExperiment(finding, attempt, {
        status: "inconclusive",
        reasonCode: execution.reason,
        reason:
          execution.cleanup === "failed"
            ? `${execution.description} Cleanup also failed.`
            : execution.description,
        performedAt: execution.completedAt,
      });
    }
    if (!environmentMatchesAttempt(execution, attempt)) {
      return this.#withoutExperiment(finding, attempt, {
        status: "inconclusive",
        reasonCode: "environment-identity-mismatch",
        reason: "The runtime identity did not match the Finding-bound Attempt.",
        performedAt: execution.completedAt,
      });
    }
    if (
      execution.recipe.actors.attackerRole !== attempt.attackerPremise ||
      canonicalHumanOsJson(execution.recipe.payloads) !==
        canonicalHumanOsJson(execution.privateEvidence.exactPayloads)
    ) {
      return this.#withoutExperiment(finding, attempt, {
        status: "inconclusive",
        reasonCode: "private-evidence-mismatch",
        reason: "The private Recipe or evidence did not match the Attempt.",
        performedAt: execution.completedAt,
      });
    }
    if (!(await this.#privateBytesExist(execution.privateEvidence))) {
      return this.#withoutExperiment(finding, attempt, {
        status: "inconclusive",
        reasonCode: "private-evidence-unavailable",
        reason: "Referenced screenshot or runtime log bytes were unavailable.",
        performedAt: execution.completedAt,
      });
    }
    const privateArtifacts = await this.#persistExperiment(
      finding,
      attempt,
      execution,
    );
    if (privateArtifacts === undefined) {
      return this.#withoutExperiment(finding, attempt, {
        status: "inconclusive",
        reasonCode: "private-evidence-store-failed",
        reason: "Private AI Reproduction evidence could not be stored.",
        performedAt: execution.completedAt,
      });
    }
    const outcome =
      execution.cleanup === "failed"
        ? {
            status: "inconclusive" as const,
            reasonCode: "cleanup-failed" as const,
            reason:
              "The Finding-bound experiment completed, but the disposable AI environment could not be cleaned up.",
            securityEffect: "uncertain" as const,
            preconditionsMatched: true,
            recipeCompleted: true,
          }
        : execution.status === "runtime-confirmed"
          ? {
              status: "runtime-confirmed" as const,
              reason:
                "AI Reproduction observed the Finding-bound Security Effect.",
              securityEffect: "observed" as const,
              preconditionsMatched: true as const,
              recipeCompleted: true as const,
            }
          : {
              status: "disproved" as const,
              reason:
                "AI Reproduction completed the Recipe with matching preconditions and did not observe the Security Effect.",
              securityEffect: "not-observed" as const,
              preconditionsMatched: true as const,
              recipeCompleted: true as const,
            };
    return defineAIVerificationRecord({
      kind: "ai-verification-record",
      schemaVersion: 1,
      finding: referenceFinding(finding),
      attempt: referenceFindingAIReproductionAttempt(attempt),
      performedAt: execution.completedAt,
      environment: execution.runtimeIdentity,
      outcome,
      ...privateArtifacts,
    });
  }

  #withoutExperiment(
    finding: Finding,
    attempt: FindingAIReproductionAttempt,
    input:
      | {
          readonly status: "inconclusive";
          readonly reasonCode: NonNullable<
            Extract<
              AIVerificationRecord["outcome"],
              { readonly status: "inconclusive" }
            >["reasonCode"]
          >;
          readonly reason: string;
          readonly performedAt?: string;
        }
      | {
          readonly status: "setup-blocked";
          readonly reasonCode: NonNullable<
            Extract<
              AIVerificationRecord["outcome"],
              { readonly status: "setup-blocked" }
            >["reasonCode"]
          >;
          readonly reason: string;
          readonly performedAt?: string;
        },
  ): AIVerificationRecord {
    const outcome =
      input.status === "inconclusive"
        ? {
            status: input.status,
            reasonCode: input.reasonCode,
            reason: input.reason,
            securityEffect: "uncertain" as const,
            preconditionsMatched: false as const,
            recipeCompleted: false as const,
          }
        : {
            status: input.status,
            reasonCode: input.reasonCode,
            reason: input.reason,
            securityEffect: "uncertain" as const,
            preconditionsMatched: false as const,
            recipeCompleted: false as const,
          };
    return defineAIVerificationRecord({
      kind: "ai-verification-record",
      schemaVersion: 1,
      finding: referenceFinding(finding),
      attempt: referenceFindingAIReproductionAttempt(attempt),
      performedAt: input.performedAt ?? this.#clock().toISOString(),
      environment: null,
      outcome,
      recipe: null,
      privateEvidence: null,
    });
  }

  async #privateBytesExist(
    evidence: FindingAIReproductionPrivateEvidenceDraft,
  ): Promise<boolean> {
    try {
      for (const pointer of [
        ...evidence.screenshots,
        ...evidence.runtimeLogs,
      ]) {
        const bytes = await this.#privateArtifactStore.readPrivateBytes(
          pointer.digest,
        );
        if (rawBytesDigest(bytes) !== pointer.digest) return false;
      }
      return true;
    } catch {
      return false;
    }
  }

  async #persistExperiment(
    finding: Finding,
    attempt: FindingAIReproductionAttempt,
    execution: Extract<
      FindingAIReproductionHarnessExecution,
      { readonly status: "runtime-confirmed" | "disproved" }
    >,
  ): Promise<
    | {
        readonly recipe: HumanOsPrivateArtifactRef;
        readonly privateEvidence: HumanOsPrivateArtifactRef;
      }
    | undefined
  > {
    const recipeIdentity = {
      kind: "reproduction-recipe" as const,
      schemaVersion: 2 as const,
      attemptId: attempt.id,
      targetSnapshotDigest: attempt.target.snapshot.digest,
      runtimeIdentity: execution.runtimeIdentity,
      recordedAt: execution.completedAt,
      recipe: execution.recipe,
    };
    const evidenceIdentity = {
      kind: "private-evidence-bundle" as const,
      schemaVersion: 2 as const,
      attemptId: attempt.id,
      targetSnapshotDigest: attempt.target.snapshot.digest,
      collectedAt: execution.completedAt,
      evidence: execution.privateEvidence,
    };
    const recipe = findingAIReproductionPrivateSchemas.recipe.parse({
      ...recipeIdentity,
      id: humanOsDigest(recipeIdentity),
    });
    const evidence = findingAIReproductionPrivateSchemas.evidence.parse({
      ...evidenceIdentity,
      id: humanOsDigest(evidenceIdentity),
    });
    try {
      const [recipeDigest, evidenceDigest] = await Promise.all([
        this.#privateArtifactStore.putPrivateJson(recipe),
        this.#privateArtifactStore.putPrivateJson(evidence),
      ]);
      if (
        recipeDigest !== humanOsDigest(recipe) ||
        evidenceDigest !== humanOsDigest(evidence)
      ) {
        return undefined;
      }
      return {
        recipe: privateArtifactRef({
          artifactKind: "reproduction-recipe",
          id: recipe.id,
          digest: recipeDigest,
          attemptId: attempt.id,
          targetSnapshotDigest: finding.target.digest,
        }),
        privateEvidence: privateArtifactRef({
          artifactKind: "private-evidence-bundle",
          id: evidence.id,
          digest: evidenceDigest,
          attemptId: attempt.id,
          targetSnapshotDigest: finding.target.digest,
        }),
      };
    } catch {
      return undefined;
    }
  }
}

export function openAIReproduction(
  options: OpenAIReproductionOptions,
): AIReproduction {
  return new DefaultAIReproduction(options);
}
