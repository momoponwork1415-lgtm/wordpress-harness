import type {
  HumanReviewAdmissionRecordView,
  HumanVerificationResultRecordView,
} from "./human-os-record/contracts.js";
import type { HumanReviewCase } from "./human-verification-contracts.js";

export interface LegacyHumanReviewCaseView {
  readonly reviewCase: HumanReviewCase;
  readonly verifications: readonly HumanVerificationResultRecordView[];
}

export interface LegacyHumanVerificationQueueView {
  readonly campaignId: string;
  readonly active: readonly LegacyHumanReviewCaseView[];
  readonly humanDeferred: readonly LegacyHumanReviewCaseView[];
}

export interface LegacyHumanVerificationReplay {
  readCase(caseId: string): Promise<LegacyHumanReviewCaseView | undefined>;
  readQueue(campaignId: string): Promise<LegacyHumanVerificationQueueView>;
}

export interface OpenLegacyHumanVerificationReplayOptions {
  readonly record: {
    readHumanReviewCase(
      caseId: string,
    ): Promise<HumanReviewAdmissionRecordView | undefined>;
    listHumanReviewCases(
      campaignId: string,
    ): Promise<readonly HumanReviewAdmissionRecordView[]>;
    listHumanVerificationResults(
      caseId: string,
    ): Promise<readonly HumanVerificationResultRecordView[]>;
  };
}

class DefaultLegacyHumanVerificationReplay implements LegacyHumanVerificationReplay {
  readonly #record: OpenLegacyHumanVerificationReplayOptions["record"];

  constructor(options: OpenLegacyHumanVerificationReplayOptions) {
    this.#record = options.record;
  }

  async readCase(
    caseId: string,
  ): Promise<LegacyHumanReviewCaseView | undefined> {
    const admitted = await this.#record.readHumanReviewCase(caseId);
    return admitted === undefined ? undefined : this.#view(admitted);
  }

  async readQueue(
    campaignId: string,
  ): Promise<LegacyHumanVerificationQueueView> {
    const cases = await this.#record.listHumanReviewCases(campaignId);
    const views = await Promise.all(cases.map((item) => this.#view(item)));
    return {
      campaignId,
      active: views.filter((item) => item.reviewCase.queueStatus === "active"),
      humanDeferred: views.filter(
        (item) => item.reviewCase.queueStatus === "human-deferred",
      ),
    };
  }

  async #view(
    admitted: HumanReviewAdmissionRecordView,
  ): Promise<LegacyHumanReviewCaseView> {
    return {
      reviewCase: admitted.reviewCase,
      verifications: await this.#record.listHumanVerificationResults(
        admitted.reviewCase.id,
      ),
    };
  }
}

export function openLegacyHumanVerificationReplay(
  options: OpenLegacyHumanVerificationReplayOptions,
): LegacyHumanVerificationReplay {
  return new DefaultLegacyHumanVerificationReplay(options);
}
