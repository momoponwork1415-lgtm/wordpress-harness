import { createHash } from "node:crypto";

import {
  findingSchema,
  referenceFinding,
  type Finding,
} from "../research/validation/finding.js";
import { canonicalHumanOsJson, humanOsDigest } from "./canonical-json.js";
import {
  defineAIVerificationRecord,
  defineFindingAIReproductionAttempt,
  findingAIReproductionHarnessExecutionSchema,
  findingAIReproductionPrivateSchemas,
  humanOsPrivateArtifactRefSchema,
  referenceFindingAIReproductionAttempt,
  type AIVerificationRecord,
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

export interface AIReproductionView {
  readonly finding: Finding;
  readonly assurance: {
    readonly source: "source-validated";
    readonly runtime: readonly (
      "runtime-confirmed" | "disproved" | "inconclusive" | "setup-blocked"
    )[];
  };
  readonly records: readonly AIVerificationRecord[];
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
    const existing = await this.#record.readFindingAIReproductionByAttempt(
      attempt.id,
    );
    if (existing !== undefined) return existing.record;
    const record = await this.#execute(finding, attempt);
    const appended = await this.#record.recordFindingAIReproduction(
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
    const events = await this.#record.listFindingAIReproduction(findingId);
    const first = events[0];
    if (first === undefined) return undefined;
    if (
      events.some(
        (event) =>
          event.finding.id !== first.finding.id ||
          humanOsDigest(event.finding) !== humanOsDigest(first.finding),
      )
    ) {
      throw new Error("Finding AI Reproduction replay binding mismatch");
    }
    return {
      finding: first.finding,
      assurance: {
        source: "source-validated",
        runtime: events.map((event) => event.record.outcome.status),
      },
      records: events.map((event) => event.record),
    };
  }

  async #execute(finding: Finding, attempt: FindingAIReproductionAttempt) {
    let rawExecution: unknown;
    try {
      rawExecution = await this.#harness.run({ finding, attempt });
    } catch {
      return this.#withoutExperiment(finding, attempt, {
        status: "inconclusive",
        reason: "The AI Reproduction harness failed before a typed outcome.",
      });
    }
    const parsed =
      findingAIReproductionHarnessExecutionSchema.safeParse(rawExecution);
    if (!parsed.success) {
      return this.#withoutExperiment(finding, attempt, {
        status: "inconclusive",
        reason: "The AI Reproduction harness returned an invalid outcome.",
      });
    }
    const execution = parsed.data;
    if (execution.cleanup === "failed") {
      return this.#withoutExperiment(finding, attempt, {
        status: "inconclusive",
        reason: "The disposable AI environment could not be cleaned up.",
        performedAt: execution.completedAt,
      });
    }
    if (execution.status === "setup-blocked") {
      return this.#withoutExperiment(finding, attempt, {
        status: "setup-blocked",
        reason: execution.description,
        performedAt: execution.completedAt,
      });
    }
    if (execution.status === "inconclusive") {
      return this.#withoutExperiment(finding, attempt, {
        status: "inconclusive",
        reason: execution.description,
        performedAt: execution.completedAt,
      });
    }
    if (!environmentMatchesAttempt(execution, attempt)) {
      return this.#withoutExperiment(finding, attempt, {
        status: "inconclusive",
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
        reason: "The private Recipe or evidence did not match the Attempt.",
        performedAt: execution.completedAt,
      });
    }
    if (!(await this.#privateBytesExist(execution.privateEvidence))) {
      return this.#withoutExperiment(finding, attempt, {
        status: "inconclusive",
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
        reason: "Private AI Reproduction evidence could not be stored.",
        performedAt: execution.completedAt,
      });
    }
    const outcome =
      execution.status === "runtime-confirmed"
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
    input: {
      readonly status: "inconclusive" | "setup-blocked";
      readonly reason: string;
      readonly performedAt?: string;
    },
  ): AIVerificationRecord {
    return defineAIVerificationRecord({
      kind: "ai-verification-record",
      schemaVersion: 1,
      finding: referenceFinding(finding),
      attempt: referenceFindingAIReproductionAttempt(attempt),
      performedAt: input.performedAt ?? this.#clock().toISOString(),
      environment: null,
      outcome: {
        status: input.status,
        reason: input.reason,
        securityEffect: "uncertain",
        preconditionsMatched: false,
        recipeCompleted: false,
      },
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
