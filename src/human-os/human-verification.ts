import type {
  HumanReviewPacketDelivery,
  HumanReviewPacketDeliveryReceipt,
  HumanReviewPacketDeliveryRequest,
} from "../research/validation/human-review-packet.js";
import { humanReviewPacketDeliveryRequestSchema } from "../research/validation/human-review-packet.js";
import { canonicalHumanOsJson, humanOsDigest } from "./canonical-json.js";
import type {
  HumanOsRecord,
  HumanReviewAdmissionRecordView,
  HumanVerificationResultRecordView,
} from "./human-os-record/contracts.js";
import {
  createEvidenceRequest,
  createFinding,
  defineHumanReviewAdmissionReceipt,
  defineHumanReviewCase,
  humanVerificationRecordSchema,
  humanVerificationResultSchema,
  type HumanReviewCase,
  type HumanVerificationRecord,
  type HumanVerificationResult,
} from "./human-verification-contracts.js";

export interface HumanReviewCaseView {
  readonly reviewCase: HumanReviewCase;
  readonly verifications: readonly HumanVerificationResultRecordView[];
}

export interface HumanVerificationQueueView {
  readonly campaignId: string;
  readonly active: readonly HumanReviewCaseView[];
  readonly humanDeferred: readonly HumanReviewCaseView[];
}

export interface HumanVerification extends HumanReviewPacketDelivery {
  admit(
    request: HumanReviewPacketDeliveryRequest,
  ): Promise<HumanReviewPacketDeliveryReceipt>;
  record(
    verification: HumanVerificationRecord,
  ): Promise<HumanVerificationResult>;
  readCase(caseId: string): Promise<HumanReviewCaseView | undefined>;
  readQueue(campaignId: string): Promise<HumanVerificationQueueView>;
}

export interface OpenHumanVerificationOptions {
  readonly record: HumanOsRecord;
  readonly clock?: () => Date;
}

function queueStatusFor(
  cases: readonly HumanReviewAdmissionRecordView[],
  mechanismDigest: string,
): "active" | "human-deferred" {
  const activeMechanisms = new Set(
    cases
      .filter((item) => item.reviewCase.queueStatus === "active")
      .map((item) => item.reviewCase.mechanismDigest),
  );
  return activeMechanisms.has(mechanismDigest) || activeMechanisms.size < 3
    ? "active"
    : "human-deferred";
}

class DefaultHumanVerification implements HumanVerification {
  readonly #record: HumanOsRecord;
  readonly #clock: () => Date;

  constructor(options: OpenHumanVerificationOptions) {
    this.#record = options.record;
    this.#clock = options.clock ?? (() => new Date());
  }

  async deliver(
    request: HumanReviewPacketDeliveryRequest,
  ): Promise<HumanReviewPacketDeliveryReceipt> {
    return this.admit(request);
  }

  async admit(
    requestValue: HumanReviewPacketDeliveryRequest,
  ): Promise<HumanReviewPacketDeliveryReceipt> {
    const request = humanReviewPacketDeliveryRequestSchema.parse(requestValue);
    const existingAdmission = await this.#record.readHumanReviewAdmission(
      request.digest,
    );
    if (existingAdmission !== undefined) {
      return defineHumanReviewAdmissionReceipt({
        request,
        reviewCase: existingAdmission.reviewCase,
      });
    }

    const packetDigest = humanOsDigest(request.packet);
    const existingCase =
      await this.#record.readHumanReviewCaseByPacket(packetDigest);
    if (
      existingCase !== undefined &&
      existingCase.reviewCase.campaignId !== request.campaignId
    ) {
      throw new Error(
        "Human Review Packet is already owned by another Campaign",
      );
    }
    const cases = await this.#record.listHumanReviewCases(request.campaignId);
    const mechanismDigest = humanOsDigest({
      kind: "human-review-mechanism",
      schemaVersion: 1,
      causalIdentity: request.packet.causalIdentity,
    });
    const queueStatus =
      existingCase?.reviewCase.queueStatus ??
      queueStatusFor(cases, mechanismDigest);
    const proposedCase = defineHumanReviewCase({
      request,
      queueStatus,
      admittedAt: this.#clock().toISOString(),
    });
    const recorded = await this.#record.recordHumanReviewAdmission(
      request,
      proposedCase,
    );
    return defineHumanReviewAdmissionReceipt({
      request,
      reviewCase: recorded.view.reviewCase,
    });
  }

  async record(
    verificationValue: HumanVerificationRecord,
  ): Promise<HumanVerificationResult> {
    const verification = humanVerificationRecordSchema.parse(verificationValue);
    const admitted = await this.#record.readHumanReviewCase(
      verification.caseId,
    );
    if (admitted === undefined) {
      throw new Error("Human Verification requires an admitted Case");
    }
    const reviewCase = admitted.reviewCase;
    if (reviewCase.queueStatus !== "active") {
      throw new Error("Human Deferred Case cannot start Human Verification");
    }
    const packet = admitted.request.packet;
    if (
      verification.packetDigest !== reviewCase.packet.digest ||
      (packet.attackerPremise !== "unresolved" &&
        verification.attackerRole !== packet.attackerPremise)
    ) {
      throw new Error("Human Verification does not match its Packet premise");
    }

    const environmentRecord = await this.#record.readEnvironmentDisposition(
      verification.environment.requestDigest,
    );
    if (
      environmentRecord === undefined ||
      environmentRecord.request.kind !==
        "human-verification-environment-request" ||
      humanOsDigest(environmentRecord.request.packet) !==
        reviewCase.packet.digest
    ) {
      throw new Error("Human Verification lacks a Packet-bound Environment");
    }
    if (verification.environment.kind === "human-verification-environment") {
      if (
        environmentRecord.disposition.status !== "ready" ||
        canonicalHumanOsJson(environmentRecord.disposition.environment) !==
          canonicalHumanOsJson(verification.environment)
      ) {
        throw new Error("Human Verification Environment is not ready");
      }
    } else if (environmentRecord.disposition.status !== "setup-blocked") {
      throw new Error("Unavailable Environment binding is not Setup Blocked");
    }

    const result = humanVerificationResultSchema.parse({
      kind: "human-verification-result",
      schemaVersion: 1,
      verification,
      finding:
        verification.disposition.status === "verified-finding"
          ? createFinding({ packet, verification })
          : null,
      evidenceRequest:
        verification.disposition.status === "more-evidence-required"
          ? createEvidenceRequest({ verification })
          : null,
    });
    const recorded = await this.#record.recordHumanVerificationResult(
      reviewCase,
      result,
    );
    return recorded.view.result;
  }

  async readCase(caseId: string): Promise<HumanReviewCaseView | undefined> {
    const admitted = await this.#record.readHumanReviewCase(caseId);
    return admitted === undefined ? undefined : this.#caseView(admitted);
  }

  async readQueue(campaignId: string): Promise<HumanVerificationQueueView> {
    const cases = await this.#record.listHumanReviewCases(campaignId);
    const views = await Promise.all(cases.map((item) => this.#caseView(item)));
    return {
      campaignId,
      active: views.filter((item) => item.reviewCase.queueStatus === "active"),
      humanDeferred: views.filter(
        (item) => item.reviewCase.queueStatus === "human-deferred",
      ),
    };
  }

  async #caseView(
    admitted: HumanReviewAdmissionRecordView,
  ): Promise<HumanReviewCaseView> {
    return {
      reviewCase: admitted.reviewCase,
      verifications: await this.#record.listHumanVerificationResults(
        admitted.reviewCase.id,
      ),
    };
  }
}

export function openHumanVerification(
  options: OpenHumanVerificationOptions,
): HumanVerification {
  return new DefaultHumanVerification(options);
}
