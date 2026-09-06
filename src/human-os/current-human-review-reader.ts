import {
  currentHumanReviewCaseSchema,
  currentHumanReviewPolicySchema,
  type CurrentHumanReviewCase,
  type CurrentHumanReviewPolicy,
} from "./current-human-review-contracts.js";
import type {
  CurrentHumanReviewResultRecordView,
  CurrentHumanReviewStore,
  HumanReproductionPreparationRecordView,
} from "./human-os-record/contracts.js";

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

export interface CurrentHumanReviewReader {
  readCase(caseId: string): Promise<CurrentHumanReviewCaseView | undefined>;
  readQueue(campaignId: string): Promise<CurrentHumanReviewQueueView>;
}

export interface OpenCurrentHumanReviewReaderOptions {
  readonly store: Pick<
    CurrentHumanReviewStore,
    | "readCurrentHumanReviewCase"
    | "listCurrentHumanReviewCases"
    | "listCurrentHumanReviewSchedule"
    | "listHumanReproductionPreparations"
    | "listCurrentHumanReviewResults"
  >;
  readonly policy: CurrentHumanReviewPolicy;
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

class DefaultCurrentHumanReviewReader implements CurrentHumanReviewReader {
  readonly #store: OpenCurrentHumanReviewReaderOptions["store"];
  readonly #policy: CurrentHumanReviewPolicy;

  constructor(options: OpenCurrentHumanReviewReaderOptions) {
    this.#store = options.store;
    this.#policy = currentHumanReviewPolicySchema.parse(options.policy);
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
}

export function openCurrentHumanReviewReader(
  options: OpenCurrentHumanReviewReaderOptions,
): CurrentHumanReviewReader {
  return new DefaultCurrentHumanReviewReader(options);
}
