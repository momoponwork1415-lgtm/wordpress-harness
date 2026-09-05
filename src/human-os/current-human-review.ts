import {
  aiReproductionAttemptSchema,
  referenceAIReproductionAttempt,
  type AIReproductionAttempt,
  type AIReproductionAttemptRef,
  type AIReproductionResult,
  type TriageReproductionPacket,
} from "./ai-reproduction-contracts.js";
import { canonicalHumanOsJson, humanOsDigest } from "./canonical-json.js";
import {
  currentFindingSchema,
  currentHumanReviewCaseSchema,
  currentHumanReviewPolicySchema,
  currentHumanReviewResultSchema,
  currentVersionReviewProviderOutputSchema,
  defineCurrentHumanReviewCase,
  defineCurrentHumanReviewScheduleEvent,
  defineHumanReproductionPreparation,
  humanReproductionEnvironmentOutcomeSchema,
  humanReproductionPreparationSchema,
  humanReproductionRecordRefSchema,
  humanReproductionRecordSchema,
  type CurrentHumanReviewCase,
  type CurrentHumanReviewPolicy,
  type CurrentHumanReviewResult,
  type CurrentHumanReviewScheduleEvent,
  type CurrentVersionReview,
  type CurrentVersionReviewProviderOutput,
  type HumanReproductionEnvironmentOutcome,
  type HumanReproductionPreparation,
  type HumanReproductionRecord,
} from "./current-human-review-contracts.js";
import type {
  CurrentHumanReviewResultRecordView,
  CurrentHumanReviewStore,
  HumanReproductionPreparationRecordView,
} from "./human-os-record/contracts.js";

export interface CurrentVersionReviewer {
  review(input: {
    readonly reviewCase: CurrentHumanReviewCase;
    readonly attempt: AIReproductionAttempt;
    readonly result: AIReproductionResult;
  }): Promise<unknown>;
}

export interface HumanReproductionEnvironment {
  establish(input: {
    readonly reviewCase: CurrentHumanReviewCase;
    readonly attempt: AIReproductionAttempt;
    readonly triagePacket: TriageReproductionPacket;
  }): Promise<unknown>;
}

export interface HumanReviewAIReproductionReader {
  readAIReproductionResult(attemptId: string): Promise<
    | {
        readonly attempt: AIReproductionAttempt;
        readonly result: AIReproductionResult;
      }
    | undefined
  >;
  readAIReproductionIntakeById(intakeId: string): Promise<
    | {
        readonly intake: {
          readonly campaignId: string;
          readonly runId: string;
        };
      }
    | undefined
  >;
}

export type CurrentHumanReviewQueueStatus =
  "active" | "deferred" | "escalation" | "completed";

export interface CurrentHumanReviewCaseView {
  readonly reviewCase: CurrentHumanReviewCase;
  readonly queueStatus: CurrentHumanReviewQueueStatus;
  readonly escalationSelected: boolean;
  readonly preparations: readonly HumanReproductionPreparationRecordView[];
  readonly result: CurrentHumanReviewResultRecordView | undefined;
}

export interface CurrentHumanReviewQueueView {
  readonly campaignId: string;
  readonly active: readonly CurrentHumanReviewCaseView[];
  readonly deferred: readonly CurrentHumanReviewCaseView[];
  readonly escalation: readonly CurrentHumanReviewCaseView[];
  readonly completed: readonly CurrentHumanReviewCaseView[];
}

export type CurrentHumanReviewAdmission =
  | {
      readonly status: "admitted" | "already-admitted";
      readonly view: CurrentHumanReviewCaseView;
    }
  | {
      readonly status: "not-admitted";
      readonly reason: "not-runtime-confirmed-or-high-impact-inconclusive";
    };

export interface CurrentHumanReviewRunner {
  admit(attemptId: string): Promise<CurrentHumanReviewAdmission>;
  selectEscalation(
    caseId: string,
    reviewerId: string,
  ): Promise<CurrentHumanReviewCaseView>;
  prepare(caseId: string): Promise<HumanReproductionPreparation>;
  record(
    verification: HumanReproductionRecord,
  ): Promise<CurrentHumanReviewResult>;
  readCase(caseId: string): Promise<CurrentHumanReviewCaseView | undefined>;
  readQueue(campaignId: string): Promise<CurrentHumanReviewQueueView>;
}

export interface OpenCurrentHumanReviewOptions {
  readonly store: CurrentHumanReviewStore;
  readonly aiReproductionReader: HumanReviewAIReproductionReader;
  readonly policy: CurrentHumanReviewPolicy;
  readonly versionReviewer: CurrentVersionReviewer;
  readonly environment: HumanReproductionEnvironment;
  readonly clock?: () => Date;
}

const impactOrder = [
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
] as const;

const attackerOrder = [
  "unauthenticated",
  "subscriber",
  "customer",
  "contributor",
  "unresolved",
] as const;

function rank<T extends string>(order: readonly T[], value: T): number {
  const result = order.indexOf(value);
  return result < 0 ? order.length : result;
}

function compareCases(
  left: CurrentHumanReviewCaseView,
  right: CurrentHumanReviewCaseView,
): number {
  const leftPriority = left.reviewCase.priority;
  const rightPriority = right.reviewCase.priority;
  return (
    leftPriority.impact - rightPriority.impact ||
    leftPriority.attackerPremise - rightPriority.attackerPremise ||
    leftPriority.reproductionCost - rightPriority.reproductionCost ||
    leftPriority.stableTieBreaker.localeCompare(rightPriority.stableTieBreaker)
  );
}

function environmentMatches(
  attempt: AIReproductionAttempt,
  triagePacket: TriageReproductionPacket,
  outcome: Extract<
    HumanReproductionEnvironmentOutcome,
    { readonly status: "ready" }
  >,
): boolean {
  const identity = outcome.runtimeIdentity;
  return (
    identity.environmentId !== triagePacket.runtimeIdentity.environmentId &&
    identity.targetSnapshotDigest === attempt.target.snapshot.digest &&
    identity.manifestDigest === attempt.target.manifest.digest &&
    identity.runtimeProfileDigest === attempt.runtimeProfile.digest &&
    identity.setupPlanDigest === attempt.setupPlan.digest &&
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

function sameClaim(
  original: AIReproductionAttempt,
  refreshed: AIReproductionAttempt,
): boolean {
  return (
    original.target.snapshot.pluginSlug ===
      refreshed.target.snapshot.pluginSlug &&
    canonicalHumanOsJson(original.causalIdentity) ===
      canonicalHumanOsJson(refreshed.causalIdentity) &&
    canonicalHumanOsJson(original.securityEffect) ===
      canonicalHumanOsJson(refreshed.securityEffect) &&
    original.attackerPremise === refreshed.attackerPremise
  );
}

function completedAllSteps(
  verification: HumanReproductionRecord,
  triage: TriageReproductionPacket,
): boolean {
  if (verification.recipeExecution === null) return false;
  return (
    verification.recipeExecution.completedStepOrdinals.length ===
      triage.recipeMetadata.stepCount &&
    verification.recipeExecution.completedStepOrdinals.every(
      (ordinal, index) => ordinal === index + 1,
    )
  );
}

class DefaultCurrentHumanReview implements CurrentHumanReviewRunner {
  readonly #store: CurrentHumanReviewStore;
  readonly #aiReproductionReader: OpenCurrentHumanReviewOptions["aiReproductionReader"];
  readonly #policy: CurrentHumanReviewPolicy;
  readonly #versionReviewer: CurrentVersionReviewer;
  readonly #environment: HumanReproductionEnvironment;
  readonly #clock: () => Date;

  constructor(options: OpenCurrentHumanReviewOptions) {
    this.#store = options.store;
    this.#aiReproductionReader = options.aiReproductionReader;
    this.#policy = currentHumanReviewPolicySchema.parse(options.policy);
    this.#versionReviewer = options.versionReviewer;
    this.#environment = options.environment;
    this.#clock = options.clock ?? (() => new Date());
  }

  async admit(attemptId: string): Promise<CurrentHumanReviewAdmission> {
    const existing =
      await this.#store.readCurrentHumanReviewCaseByAttempt(attemptId);
    if (existing !== undefined) {
      return {
        status: "already-admitted",
        view: await this.#view(existing.reviewCase),
      };
    }
    const aiView =
      await this.#aiReproductionReader.readAIReproductionResult(attemptId);
    if (aiView === undefined) {
      throw new Error(
        "Human Review admission requires an AI Reproduction result",
      );
    }
    const intakeView =
      await this.#aiReproductionReader.readAIReproductionIntakeById(
        aiView.attempt.intakeId,
      );
    if (intakeView === undefined) {
      throw new Error("AI Reproduction result lacks its Intake");
    }
    const result = aiView.result;
    const confirmed = result.status === "runtime-confirmed";
    const escalated =
      result.status === "runtime-inconclusive" &&
      this.#policy.highImpactEscalation.includes(
        aiView.attempt.securityEffect.impact,
      );
    if (!confirmed && !escalated) {
      return {
        status: "not-admitted",
        reason: "not-runtime-confirmed-or-high-impact-inconclusive",
      };
    }
    const queue = await this.readQueue(intakeView.intake.campaignId);
    const initialQueueStatus = escalated
      ? ("escalation" as const)
      : queue.active.length < this.#policy.activeConcurrency
        ? ("active" as const)
        : ("deferred" as const);
    const reviewCase = defineCurrentHumanReviewCase({
      campaignId: intakeView.intake.campaignId,
      runId: intakeView.intake.runId,
      attempt: aiView.attempt,
      result,
      policy: this.#policy,
      initialQueueStatus,
      priority: {
        impact: rank(impactOrder, aiView.attempt.securityEffect.impact),
        attackerPremise: rank(attackerOrder, aiView.attempt.attackerPremise),
        reproductionCost:
          result.status === "runtime-confirmed"
            ? result.triagePacket.recipeMetadata.stepCount
            : 65,
      },
      admittedAt: this.#clock().toISOString(),
    });
    const recorded = await this.#store.recordCurrentHumanReviewCase(reviewCase);
    return {
      status: recorded.status === "appended" ? "admitted" : "already-admitted",
      view: await this.#view(recorded.view.reviewCase),
    };
  }

  async selectEscalation(
    caseId: string,
    reviewerId: string,
  ): Promise<CurrentHumanReviewCaseView> {
    const view = await this.#requireCase(caseId);
    if (view.queueStatus !== "escalation") {
      throw new Error("Only an Escalation Queue Case can be selected");
    }
    const event = defineCurrentHumanReviewScheduleEvent({
      kind: "current-human-review-schedule-event",
      schemaVersion: 2,
      caseId: view.reviewCase.id,
      event: "escalation-selected",
      selectedBy: { kind: "human-reviewer", id: reviewerId },
      occurredAt: this.#clock().toISOString(),
    });
    await this.#store.recordCurrentHumanReviewScheduleEvent(
      view.reviewCase,
      event,
    );
    return this.#view(view.reviewCase);
  }

  async prepare(caseId: string): Promise<HumanReproductionPreparation> {
    const view = await this.#requireCase(caseId);
    if (view.queueStatus !== "active") {
      throw new Error("Only an active Case can prepare Human Reproduction");
    }
    const priorReady = [...view.preparations]
      .reverse()
      .find((item) => item.preparation.status === "ready");
    if (priorReady !== undefined) return priorReady.preparation;

    const originalView =
      await this.#aiReproductionReader.readAIReproductionResult(
        view.reviewCase.originAttempt.id,
      );
    if (originalView === undefined) {
      throw new Error("Human Review Case lacks its AI Reproduction result");
    }
    const providerResult = await this.#reviewVersion(
      view.reviewCase,
      originalView.attempt,
      originalView.result,
    );
    const selected = await this.#selectVersion(
      view.reviewCase,
      originalView.attempt,
      originalView.result,
      providerResult,
    );
    if (selected.status === "blocked") {
      return this.#recordBlockedPreparation(
        view.reviewCase,
        selected.versionReview,
        selected.reason,
      );
    }

    let environmentValue: unknown;
    try {
      environmentValue = await this.#environment.establish({
        reviewCase: view.reviewCase,
        attempt: selected.attempt,
        triagePacket: selected.triagePacket,
      });
    } catch {
      environmentValue = {
        status: "blocked",
        reason: "setup-failed",
      };
    }
    const environmentResult =
      humanReproductionEnvironmentOutcomeSchema.safeParse(environmentValue);
    if (!environmentResult.success) {
      return this.#recordBlockedPreparation(
        view.reviewCase,
        selected.versionReview,
        "environment-identity-mismatch",
        selected.attempt,
        selected.triagePacket,
      );
    }
    const environment = environmentResult.data;
    if (environment.status === "blocked") {
      return this.#recordBlockedPreparation(
        view.reviewCase,
        selected.versionReview,
        environment.reason,
        selected.attempt,
        selected.triagePacket,
      );
    }
    if (
      !environmentMatches(selected.attempt, selected.triagePacket, environment)
    ) {
      return this.#recordBlockedPreparation(
        view.reviewCase,
        selected.versionReview,
        environment.runtimeIdentity.environmentId ===
          selected.triagePacket.runtimeIdentity.environmentId
          ? "environment-not-fresh"
          : "environment-identity-mismatch",
        selected.attempt,
        selected.triagePacket,
      );
    }
    const preparation = defineHumanReproductionPreparation({
      kind: "human-reproduction-preparation",
      schemaVersion: 2,
      caseId: view.reviewCase.id,
      status: "ready",
      versionReview: selected.versionReview,
      selectedAttempt: selected.attemptRef,
      triagePacket: selected.triagePacket,
      environment: environment.runtimeIdentity,
      preparedAt: this.#clock().toISOString(),
    });
    return (
      await this.#store.recordHumanReproductionPreparation(
        view.reviewCase,
        preparation,
      )
    ).view.preparation;
  }

  async record(
    verificationValue: HumanReproductionRecord,
  ): Promise<CurrentHumanReviewResult> {
    const verification = humanReproductionRecordSchema.parse(verificationValue);
    const view = await this.#requireCase(verification.caseId);
    if (view.queueStatus !== "active") {
      throw new Error("Only an active Case can record Human Reproduction");
    }
    const preparationRecord = view.preparations.find(
      (item) => item.preparation.id === verification.preparationId,
    );
    if (preparationRecord === undefined) {
      throw new Error("Human Reproduction requires a persisted Preparation");
    }
    const preparation = humanReproductionPreparationSchema.parse(
      preparationRecord.preparation,
    );
    await this.#assertVerificationMatchesPreparation(
      view.reviewCase,
      preparation,
      verification,
    );
    const finding =
      verification.disposition.status === "verified-finding"
        ? await this.#createFinding(view.reviewCase, preparation, verification)
        : null;
    const result = currentHumanReviewResultSchema.parse({
      kind: "current-human-review-result",
      schemaVersion: 2,
      verification,
      finding,
    });
    const recorded = await this.#store.recordCurrentHumanReviewResult(
      view.reviewCase,
      result,
    );
    await this.#promote(view.reviewCase.campaignId);
    return recorded.view.result;
  }

  async readCase(
    caseId: string,
  ): Promise<CurrentHumanReviewCaseView | undefined> {
    const record = await this.#store.readCurrentHumanReviewCase(caseId);
    return record === undefined ? undefined : this.#view(record.reviewCase);
  }

  async readQueue(campaignId: string): Promise<CurrentHumanReviewQueueView> {
    const records = await this.#store.listCurrentHumanReviewCases(campaignId);
    const views = await Promise.all(
      records.map((record) => this.#view(record.reviewCase)),
    );
    const sorted = [...views].sort(compareCases);
    return {
      campaignId,
      active: sorted.filter((view) => view.queueStatus === "active"),
      deferred: sorted.filter((view) => view.queueStatus === "deferred"),
      escalation: sorted.filter((view) => view.queueStatus === "escalation"),
      completed: sorted.filter((view) => view.queueStatus === "completed"),
    };
  }

  async #view(
    reviewCaseValue: CurrentHumanReviewCase,
  ): Promise<CurrentHumanReviewCaseView> {
    const reviewCase = currentHumanReviewCaseSchema.parse(reviewCaseValue);
    if (reviewCase.policyDigest !== this.#policy.digest) {
      throw new Error("Human Review Case belongs to another Queue Policy");
    }
    const [schedule, preparations, results] = await Promise.all([
      this.#store.listCurrentHumanReviewSchedule(reviewCase.id),
      this.#store.listHumanReproductionPreparations(reviewCase.id),
      this.#store.listCurrentHumanReviewResults(reviewCase.id),
    ]);
    const result = results[0];
    const queueStatus: CurrentHumanReviewQueueStatus =
      result !== undefined
        ? "completed"
        : reviewCase.lane === "escalation"
          ? "escalation"
          : reviewCase.initialQueueStatus === "active" ||
              schedule.some((item) => item.event.event === "promoted")
            ? "active"
            : "deferred";
    return {
      reviewCase,
      queueStatus,
      escalationSelected: schedule.some(
        (item) => item.event.event === "escalation-selected",
      ),
      preparations,
      result,
    };
  }

  async #requireCase(caseId: string): Promise<CurrentHumanReviewCaseView> {
    const view = await this.readCase(caseId);
    if (view === undefined) throw new Error("Human Review Case does not exist");
    return view;
  }

  async #reviewVersion(
    reviewCase: CurrentHumanReviewCase,
    attempt: AIReproductionAttempt,
    result: AIReproductionResult,
  ) {
    try {
      return currentVersionReviewProviderOutputSchema.parse(
        await this.#versionReviewer.review({ reviewCase, attempt, result }),
      );
    } catch {
      return currentVersionReviewProviderOutputSchema.parse({
        status: "blocked",
        reason: "version-lookup-failed",
      });
    }
  }

  async #selectVersion(
    reviewCase: CurrentHumanReviewCase,
    originalAttempt: AIReproductionAttempt,
    originalResult: AIReproductionResult,
    provider: CurrentVersionReviewProviderOutput,
  ): Promise<
    | {
        readonly status: "ready";
        readonly versionReview: CurrentVersionReview;
        readonly attempt: AIReproductionAttempt;
        readonly attemptRef: AIReproductionAttemptRef;
        readonly triagePacket: TriageReproductionPacket;
      }
    | {
        readonly status: "blocked";
        readonly versionReview: CurrentVersionReview;
        readonly reason:
          | "version-lookup-failed"
          | "refresh-not-runtime-confirmed"
          | "causal-identity-changed";
      }
  > {
    const reviewedAt = this.#clock().toISOString();
    if (provider.status === "blocked") {
      return {
        status: "blocked",
        reason: provider.reason,
        versionReview: {
          kind: "current-version-review",
          schemaVersion: 2,
          status: "blocked",
          originalAttempt: reviewCase.originAttempt,
          originalTarget: reviewCase.originTarget,
          reviewedAt,
          reason: provider.reason,
          selectedAttempt: null,
          selectedTarget: null,
        },
      };
    }
    let selectedAttempt = originalAttempt;
    let selectedResult = originalResult;
    if (provider.status === "refreshed") {
      const refreshed =
        await this.#aiReproductionReader.readAIReproductionResult(
          provider.refreshedAttemptId,
        );
      if (
        refreshed === undefined ||
        refreshed.result.status !== "runtime-confirmed"
      ) {
        return this.#blockedVersionSelection(
          reviewCase,
          reviewedAt,
          "refresh-not-runtime-confirmed",
        );
      }
      const refreshedIntake =
        await this.#aiReproductionReader.readAIReproductionIntakeById(
          refreshed.attempt.intakeId,
        );
      if (
        refreshedIntake === undefined ||
        refreshedIntake.intake.campaignId !== reviewCase.campaignId
      ) {
        return this.#blockedVersionSelection(
          reviewCase,
          reviewedAt,
          "refresh-not-runtime-confirmed",
        );
      }
      if (!sameClaim(originalAttempt, refreshed.attempt)) {
        return this.#blockedVersionSelection(
          reviewCase,
          reviewedAt,
          "causal-identity-changed",
        );
      }
      selectedAttempt = refreshed.attempt;
      selectedResult = refreshed.result;
    }
    if (selectedResult.status !== "runtime-confirmed") {
      return this.#blockedVersionSelection(
        reviewCase,
        reviewedAt,
        "refresh-not-runtime-confirmed",
      );
    }
    const attemptRef = selectedResult.attempt;
    return {
      status: "ready",
      attempt: selectedAttempt,
      attemptRef,
      triagePacket: selectedResult.triagePacket,
      versionReview: {
        kind: "current-version-review",
        schemaVersion: 2,
        status: provider.status,
        originalAttempt: reviewCase.originAttempt,
        originalTarget: reviewCase.originTarget,
        reviewedAt,
        selectedAttempt: attemptRef,
        selectedTarget: selectedAttempt.target.snapshot,
      },
    };
  }

  #blockedVersionSelection(
    reviewCase: CurrentHumanReviewCase,
    reviewedAt: string,
    reason:
      | "version-lookup-failed"
      | "refresh-not-runtime-confirmed"
      | "causal-identity-changed",
  ) {
    return {
      status: "blocked" as const,
      reason,
      versionReview: {
        kind: "current-version-review" as const,
        schemaVersion: 2 as const,
        status: "blocked" as const,
        originalAttempt: reviewCase.originAttempt,
        originalTarget: reviewCase.originTarget,
        reviewedAt,
        reason,
        selectedAttempt: null,
        selectedTarget: null,
      },
    };
  }

  async #recordBlockedPreparation(
    reviewCase: CurrentHumanReviewCase,
    versionReview: CurrentVersionReview,
    reason: Extract<
      HumanReproductionPreparation,
      { readonly status: "blocked" }
    >["reason"],
    selectedAttempt?: AIReproductionAttempt,
    triagePacket?: TriageReproductionPacket,
  ): Promise<HumanReproductionPreparation> {
    const preparation = defineHumanReproductionPreparation({
      kind: "human-reproduction-preparation",
      schemaVersion: 2,
      caseId: reviewCase.id,
      status: "blocked",
      versionReview,
      reason,
      selectedAttempt:
        selectedAttempt === undefined
          ? null
          : referenceAIReproductionAttempt(selectedAttempt),
      triagePacket: triagePacket ?? null,
      environment: null,
      preparedAt: this.#clock().toISOString(),
    });
    return (
      await this.#store.recordHumanReproductionPreparation(
        reviewCase,
        preparation,
      )
    ).view.preparation;
  }

  async #assertVerificationMatchesPreparation(
    reviewCase: CurrentHumanReviewCase,
    preparation: HumanReproductionPreparation,
    verification: HumanReproductionRecord,
  ): Promise<void> {
    if (preparation.status === "blocked") {
      if (
        verification.disposition.status !== "blocked" ||
        verification.environment !== null ||
        verification.recipeExecution !== null
      ) {
        throw new Error(
          "Blocked Preparation only accepts a blocked Disposition",
        );
      }
      return;
    }
    const selectedView =
      await this.#aiReproductionReader.readAIReproductionResult(
        preparation.selectedAttempt.id,
      );
    if (
      selectedView === undefined ||
      verification.attempt.id !== preparation.selectedAttempt.id ||
      verification.triagePacketId !== preparation.triagePacket.id ||
      canonicalHumanOsJson(verification.environment) !==
        canonicalHumanOsJson(preparation.environment) ||
      (verification.recipeExecution !== null &&
        verification.recipeExecution.recipe.digest !==
          preparation.triagePacket.recipe.digest)
    ) {
      throw new Error("Human Reproduction does not match its Preparation");
    }
    const roleMatches =
      verification.attackerRole === selectedView.attempt.attackerPremise;
    if (
      !roleMatches &&
      !(
        verification.disposition.status === "blocked" &&
        verification.disposition.blocker === "role-mismatch"
      )
    ) {
      throw new Error("Human Reproduction attacker role mismatch");
    }
    const terminal =
      verification.disposition.status === "verified-finding" ||
      verification.disposition.status === "rejected";
    if (
      terminal &&
      (!completedAllSteps(verification, preparation.triagePacket) ||
        verification.recipeExecution?.exactPayloadAndStepsUsed !== true)
    ) {
      throw new Error(
        "Human Finding or rejection requires the complete exact Recipe",
      );
    }
    if (
      verification.recipeExecution?.deviation.kind ===
        "new-causal-route-required" &&
      !(
        verification.disposition.status === "blocked" &&
        verification.disposition.blocker === "new-recipe-required"
      )
    ) {
      throw new Error("A new causal route requires a new Recipe");
    }
  }

  async #createFinding(
    reviewCase: CurrentHumanReviewCase,
    preparation: HumanReproductionPreparation,
    verification: HumanReproductionRecord,
  ) {
    if (preparation.status !== "ready") {
      throw new Error("Finding requires a ready Human Reproduction");
    }
    const selected = await this.#aiReproductionReader.readAIReproductionResult(
      preparation.selectedAttempt.id,
    );
    if (selected === undefined)
      throw new Error("Finding lacks selected AI result");
    const verificationRef = humanReproductionRecordRefSchema.parse({
      kind: verification.kind,
      schemaVersion: verification.schemaVersion,
      id: verification.id,
      digest: humanOsDigest(verification),
      caseId: verification.caseId,
      disposition: verification.disposition.status,
    });
    const identity = {
      kind: "finding" as const,
      schemaVersion: 2 as const,
      caseId: reviewCase.id,
      campaignId: reviewCase.campaignId,
      originalTarget: reviewCase.originTarget,
      verifiedTarget: selected.attempt.target.snapshot,
      runtimePacket: preparation.triagePacket.runtimePacket,
      aiAttempt: preparation.selectedAttempt,
      triagePacketId: preparation.triagePacket.id,
      recipe: preparation.triagePacket.recipe,
      privateEvidence: preparation.triagePacket.privateEvidence,
      humanVerification: verificationRef,
      causalIdentity: selected.attempt.causalIdentity,
      attackerRole: verification.attackerRole,
      securityEffect: selected.attempt.securityEffect.claimedPropertyChange,
      reviewer: verification.reviewer,
      verifiedAt: verification.performedAt,
      externalAction: { status: "not-authorized" as const },
    };
    return currentFindingSchema.parse({
      ...identity,
      id: humanOsDigest(identity),
    });
  }

  async #promote(campaignId: string): Promise<void> {
    let queue = await this.readQueue(campaignId);
    while (
      queue.active.length < this.#policy.activeConcurrency &&
      queue.deferred.length > 0
    ) {
      const next = queue.deferred[0]!;
      const event: CurrentHumanReviewScheduleEvent =
        defineCurrentHumanReviewScheduleEvent({
          kind: "current-human-review-schedule-event",
          schemaVersion: 2,
          caseId: next.reviewCase.id,
          event: "promoted",
          occurredAt: this.#clock().toISOString(),
        });
      await this.#store.recordCurrentHumanReviewScheduleEvent(
        next.reviewCase,
        event,
      );
      queue = await this.readQueue(campaignId);
    }
  }
}

export function openCurrentHumanReview(
  options: OpenCurrentHumanReviewOptions,
): CurrentHumanReviewRunner {
  return new DefaultCurrentHumanReview(options);
}
