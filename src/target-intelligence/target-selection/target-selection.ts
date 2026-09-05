import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { canonicalJson, sha256Digest } from "../acquisition/canonical-json.js";
import {
  TargetSelectionModelError,
  targetSelectionApprovalVerificationRequestSchema,
  targetSelectionApprovalVerificationSchema,
  targetSelectionAttemptRefSchema,
  targetSelectionAttemptSchema,
  targetSelectionReadableAttemptSchema,
  targetSelectionModelInputSchema,
  targetSelectionModelResultSchema,
  targetSelectionReceiptSchema,
  targetSelectionRequestSchema,
  type OpenTargetSelectionOptions,
  type LegacyTargetSelectionCandidate,
  type TargetSelection,
  type TargetSelectionApprovalVerification,
  type TargetSelectionApprovalVerificationRequest,
  type TargetSelectionAttempt,
  type TargetSelectionAttemptRef,
  type TargetSelectionCandidate,
  type TargetSelectionModelInput,
  type TargetSelectionPendingReason,
  type TargetSelectionReceipt,
  type TargetSelectionReadableAttempt,
  type TargetSelectionRequest,
  type TargetSelectionResult,
} from "./contracts.js";

const researchValueOrder = { high: 3, medium: 2, low: 1 } as const;
const opportunityOrder = {
  broad: 3,
  "high-impact-only": 2,
  "research-only": 1,
} as const;

function hasErrorCode(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === code
  );
}

function normalizedRequest(
  value: TargetSelectionRequest,
): TargetSelectionRequest {
  const request = targetSelectionRequestSchema.parse(value);
  return targetSelectionRequestSchema.parse({
    ...request,
    candidates: [...request.candidates]
      .sort((left, right) => left.candidateId.localeCompare(right.candidateId))
      .map((candidate) => ({
        ...candidate,
        selectionFacts: {
          ...candidate.selectionFacts,
          integrations: [...candidate.selectionFacts.integrations].sort(),
          ...(candidate.selectionFacts.sourceScale === undefined
            ? {}
            : {
                sourceScale: {
                  ...candidate.selectionFacts.sourceScale,
                  languages: [
                    ...candidate.selectionFacts.sourceScale.languages,
                  ].sort(),
                },
              }),
        },
        programmes: [...candidate.programmes].sort((left, right) =>
          left.programmeIdentity.localeCompare(right.programmeIdentity),
        ),
        diversity: {
          ...candidate.diversity,
          integrations: [...candidate.diversity.integrations].sort(),
        },
      })),
  });
}

function attemptRef(
  attempt: TargetSelectionAttempt,
): TargetSelectionAttemptRef {
  const digest = sha256Digest(attempt);
  return targetSelectionAttemptRefSchema.parse({
    kind: "target-selection-attempt-ref",
    schemaVersion: 2,
    id: `selection-attempt:${digest.slice(7, 31)}`,
    digest,
  });
}

function resultFromAttempt(
  attempt: TargetSelectionAttempt,
): TargetSelectionResult {
  const ref = attemptRef(attempt);
  if (attempt.status === "selected") {
    return { status: "selected", attemptRef: ref, receipts: attempt.receipts };
  }
  if (attempt.status === "selection-pending") {
    return {
      status: "selection-pending",
      attemptRef: ref,
      reason: attempt.reason,
      pendingCandidateIds: attempt.pendingCandidateIds,
    };
  }
  return {
    status: "selection-pending",
    attemptRef: ref,
    reason: "interrupted",
    pendingCandidateIds: attempt.input.candidates.map(
      (candidate) => candidate.candidateId,
    ),
  };
}

function hardGateReasons(candidate: TargetSelectionCandidate, now: number) {
  const reasons: (
    | "acquisition-unavailable"
    | "provenance-unverified"
    | "identity-unverified"
    | "target-observation-stale"
    | "programme-eligibility-stale"
    | "disclosure-route-stale"
    | "already-covered"
    | "follow-up-reason-required"
  )[] = [];
  if (candidate.targetObservation.acquisition !== "available") {
    reasons.push("acquisition-unavailable");
  }
  if (candidate.targetObservation.provenance !== "verified") {
    reasons.push("provenance-unverified");
  }
  if (candidate.targetObservation.identity !== "verified") {
    reasons.push("identity-unverified");
  }
  if (Date.parse(candidate.targetObservation.currentUntil) < now) {
    reasons.push("target-observation-stale");
  }
  if (
    candidate.programmes.some(
      (programme) => Date.parse(programme.currentUntil) < now,
    )
  ) {
    reasons.push("programme-eligibility-stale");
  }
  if (Date.parse(candidate.disclosureRoute.currentUntil) < now) {
    reasons.push("disclosure-route-stale");
  }
  if (candidate.researchHistory.status === "coverage-closed") {
    reasons.push("already-covered");
  }
  if (
    candidate.researchHistory.status === "incomplete" &&
    candidate.researchHistory.followUpReason === undefined
  ) {
    reasons.push("follow-up-reason-required");
  }
  return reasons;
}

function researchTreatment(candidate: TargetSelectionCandidate) {
  switch (candidate.researchHistory.status) {
    case "new":
      return "new" as const;
    case "active":
      return "resume" as const;
    case "coverage-closed":
      return "already-covered" as const;
    case "incomplete":
      return candidate.researchHistory.followUpReason === undefined
        ? ("follow-up-required" as const)
        : ("follow-up" as const);
  }
}

function candidateKind(candidate: TargetSelectionCandidate) {
  const hasEligibleProgramme = candidate.programmes.some(
    (programme) => programme.eligibility === "eligible",
  );
  const hasUsableRoute = !["none-found", "conflicting"].includes(
    candidate.disclosureRoute.kind,
  );
  return hasEligibleProgramme && hasUsableRoute
    ? ("programme-eligible" as const)
    : ("research-only" as const);
}

function opportunity(candidate: TargetSelectionCandidate): number {
  return Math.max(
    ...candidate.programmes
      .filter((programme) => programme.eligibility === "eligible")
      .map((programme) => opportunityOrder[programme.opportunityBand]),
    0,
  );
}

function modelInput(
  request: TargetSelectionRequest,
  candidates: readonly TargetSelectionCandidate[],
): TargetSelectionModelInput {
  return targetSelectionModelInputSchema.parse({
    kind: "target-selection-model-input",
    schemaVersion: 1,
    modelProfile: request.modelProfile,
    candidates: candidates.map((candidate) => ({
      candidateId: candidate.candidateId,
      selectionFacts: candidate.selectionFacts,
      disclosureRouteKind: candidate.disclosureRoute.kind,
      researchHistoryStatus: candidate.researchHistory.status,
      diversity: candidate.diversity,
    })),
  });
}

function validateModelCoverage(
  candidateIds: readonly string[],
  rankedCandidateIds: readonly string[],
  assessmentIds: readonly string[],
): boolean {
  const expected = [...candidateIds].sort();
  return (
    rankedCandidateIds.length === expected.length &&
    assessmentIds.length === expected.length &&
    new Set(rankedCandidateIds).size === expected.length &&
    new Set(assessmentIds).size === expected.length &&
    [...rankedCandidateIds]
      .sort()
      .every((id, index) => id === expected[index]) &&
    [...assessmentIds].sort().every((id, index) => id === expected[index])
  );
}

function facetValues(candidate: TargetSelectionCandidate): readonly string[] {
  return [
    `vendor:${candidate.diversity.vendor}`,
    `family:${candidate.diversity.pluginFamily}`,
    `use:${candidate.diversity.useCase}`,
    `size:${candidate.diversity.sizeBand}`,
    `authority:${candidate.diversity.authorityModel}`,
    ...candidate.diversity.integrations.map(
      (integration) => `integration:${integration}`,
    ),
  ];
}

function wouldExceedDiversity(
  candidate: TargetSelectionCandidate,
  selected: readonly TargetSelectionCandidate[],
  maximum: number,
): boolean {
  const counts = new Map<string, number>();
  for (const selectedCandidate of selected) {
    for (const facet of facetValues(selectedCandidate)) {
      counts.set(facet, (counts.get(facet) ?? 0) + 1);
    }
  }
  return facetValues(candidate).some(
    (facet) => (counts.get(facet) ?? 0) >= maximum,
  );
}

function novelty(
  candidate: TargetSelectionCandidate,
  selected: readonly TargetSelectionCandidate[],
): number {
  const used = new Set(selected.flatMap(facetValues));
  return facetValues(candidate).filter((facet) => !used.has(facet)).length;
}

function receipt(
  candidate: TargetSelectionCandidate,
  values: Omit<
    TargetSelectionReceipt,
    | "id"
    | "digest"
    | "kind"
    | "schemaVersion"
    | "receiptSource"
    | "candidateId"
    | "candidate"
  >,
  receiptSource: TargetSelectionReceipt["receiptSource"] = "selection-attempt",
): TargetSelectionReceipt {
  const body = {
    kind: "selection-receipt" as const,
    schemaVersion: 2 as const,
    receiptSource,
    candidateId: candidate.candidateId,
    candidate,
    ...values,
  };
  const digest = sha256Digest(body);
  return targetSelectionReceiptSchema.parse({
    ...body,
    id: `selection-receipt:${digest.slice(7, 31)}`,
    digest,
  });
}

function verifyStoredReceipt(storedReceipt: {
  readonly id: string;
  readonly digest: string;
}): boolean {
  const { id, digest, ...body } = storedReceipt;
  return (
    sha256Digest(body) === digest &&
    id === `selection-receipt:${digest.slice(7, 31)}`
  );
}

function targetSelectionCandidateForLegacyReceipt(
  candidate: LegacyTargetSelectionCandidate,
): TargetSelectionCandidate {
  const history = candidate.researchHistory;
  const researchHistory =
    history.status === "incomplete"
      ? {
          status: history.status,
          campaignId: history.campaignId,
          ...(history.followUpReason === undefined
            ? {}
            : {
                followUpReason: "incomplete-source-frontier-follow-up" as const,
              }),
        }
      : history;
  return {
    ...candidate,
    origin: { kind: "autonomous-observation" },
    researchHistory,
  };
}

class FileTargetSelection implements TargetSelection {
  readonly #storageDirectory: string;
  readonly #model: OpenTargetSelectionOptions["model"];
  readonly #clock: () => Date;

  constructor(options: OpenTargetSelectionOptions) {
    this.#storageDirectory = options.storageDirectory;
    this.#model = options.model;
    this.#clock = options.clock ?? (() => new Date());
  }

  async select(
    requestValue: TargetSelectionRequest,
  ): Promise<TargetSelectionResult> {
    const request = normalizedRequest(requestValue);
    const requestDigest = sha256Digest(request);
    const path = this.#attemptPath(request);
    const existing = await this.#read(path);
    if (existing !== undefined) {
      if (existing.schemaVersion !== 2) {
        throw new Error(
          "Legacy Target Selection Attempt is read-only; v1 and v2 writers cannot mix",
        );
      }
      if (existing.requestDigest !== requestDigest) {
        throw new Error("Target Selection revision input conflict");
      }
      return resultFromAttempt(existing);
    }

    const createdAt = this.#clock().toISOString();
    const runningValue = targetSelectionAttemptSchema.parse({
      kind: "target-selection-attempt",
      schemaVersion: 2,
      status: "running",
      requestDigest,
      input: request,
      createdAt,
    });
    if (runningValue.status !== "running") {
      throw new Error("Target Selection failed to create a running attempt");
    }
    const running = runningValue;
    const created = await this.#create(path, running);
    if (!created) {
      const raced = await this.#read(path);
      if (raced === undefined) {
        throw new Error("Target Selection attempt disappeared");
      }
      if (raced.schemaVersion !== 2) {
        throw new Error(
          "Legacy Target Selection Attempt is read-only; v1 and v2 writers cannot mix",
        );
      }
      if (raced.requestDigest !== requestDigest) {
        throw new Error("Target Selection revision input conflict");
      }
      return resultFromAttempt(raced);
    }

    const now = this.#clock().getTime();
    const eligible = request.candidates.filter(
      (candidate) => hardGateReasons(candidate, now).length === 0,
    );
    let modelResult;
    if (eligible.length > 0) {
      let rawModelResult: unknown;
      try {
        rawModelResult = await this.#model.rank(modelInput(request, eligible));
      } catch (error) {
        const reason: TargetSelectionPendingReason =
          error instanceof TargetSelectionModelError
            ? error.code
            : "provider-failure";
        return this.#finishPending(
          path,
          running,
          reason,
          eligible.map((candidate) => candidate.candidateId),
        );
      }
      const parsedModelResult =
        targetSelectionModelResultSchema.safeParse(rawModelResult);
      if (!parsedModelResult.success) {
        return this.#finishPending(
          path,
          running,
          "model-invalid",
          eligible.map((candidate) => candidate.candidateId),
        );
      }
      modelResult = parsedModelResult.data;
      if (
        !validateModelCoverage(
          eligible.map((candidate) => candidate.candidateId),
          modelResult.rankedCandidateIds,
          modelResult.assessments.map((assessment) => assessment.candidateId),
        )
      ) {
        return this.#finishPending(
          path,
          running,
          "model-invalid",
          eligible.map((candidate) => candidate.candidateId),
        );
      }
    }

    const modelOrder = new Map(
      (modelResult?.rankedCandidateIds ?? []).map((id, index) => [id, index]),
    );
    const assessments = new Map(
      (modelResult?.assessments ?? []).map((assessment) => [
        assessment.candidateId,
        assessment,
      ]),
    );
    const remaining = [...eligible];
    const selected: TargetSelectionCandidate[] = [];
    while (selected.length < request.policy.batchSize) {
      const selectable = remaining.filter(
        (candidate) =>
          !wouldExceedDiversity(
            candidate,
            selected,
            request.policy.diversity.maximumPerFacetValue,
          ),
      );
      if (selectable.length === 0) {
        break;
      }
      selectable.sort((left, right) => {
        const leftAssessment = assessments.get(left.candidateId);
        const rightAssessment = assessments.get(right.candidateId);
        const valueDifference =
          researchValueOrder[rightAssessment?.researchValueBand ?? "low"] -
          researchValueOrder[leftAssessment?.researchValueBand ?? "low"];
        if (valueDifference !== 0) return valueDifference;
        const opportunityDifference = opportunity(right) - opportunity(left);
        if (opportunityDifference !== 0) return opportunityDifference;
        const noveltyDifference =
          novelty(right, selected) - novelty(left, selected);
        if (noveltyDifference !== 0) return noveltyDifference;
        const modelDifference =
          (modelOrder.get(left.candidateId) ?? Number.MAX_SAFE_INTEGER) -
          (modelOrder.get(right.candidateId) ?? Number.MAX_SAFE_INTEGER);
        if (modelDifference !== 0) return modelDifference;
        return left.candidateId.localeCompare(right.candidateId);
      });
      const next = selectable[0];
      if (next === undefined) break;
      selected.push(next);
      remaining.splice(
        remaining.findIndex(
          (candidate) => candidate.candidateId === next.candidateId,
        ),
        1,
      );
    }

    const attemptBinding = {
      selectionKey: request.selectionKey,
      revision: request.revision,
      requestDigest,
      policy: { id: request.policy.id, digest: request.policy.digest },
      modelProfile: {
        id: request.modelProfile.id,
        digest: request.modelProfile.digest,
      },
    };
    const receipts = request.candidates.map((candidate) => {
      const gateReasons = hardGateReasons(candidate, now);
      const selectedIndex = selected.findIndex(
        (value) => value.candidateId === candidate.candidateId,
      );
      const isSelected = selectedIndex >= 0;
      const kind = candidateKind(candidate);
      const treatment = researchTreatment(candidate);
      let reasonCodes: TargetSelectionReceipt["reasonCodes"];
      if (gateReasons.length > 0) {
        reasonCodes = ["hard-gate-failed"];
      } else if (isSelected) {
        reasonCodes = ["within-batch-capacity"];
        if (treatment === "resume") {
          reasonCodes.push("resume-active-campaign");
        }
        if (treatment === "follow-up") {
          reasonCodes.push("reasoned-incomplete-follow-up");
        }
        if (kind === "research-only") {
          reasonCodes.push("research-only-candidate");
        }
      } else {
        reasonCodes = [
          wouldExceedDiversity(
            candidate,
            selected,
            request.policy.diversity.maximumPerFacetValue,
          )
            ? "diversity-cap-reached"
            : "batch-capacity-reached",
        ];
      }
      return receipt(candidate, {
        decision: isSelected ? "selected" : "not-selected",
        candidateKind: kind,
        researchTreatment: treatment,
        hardGate: {
          status: gateReasons.length === 0 ? "passed" : "failed",
          reasons: gateReasons,
        },
        ...(assessments.get(candidate.candidateId) === undefined
          ? {}
          : { modelAssessment: assessments.get(candidate.candidateId) }),
        ...(isSelected ? { selectedRank: selectedIndex + 1 } : {}),
        reasonCodes,
        selectedAt: createdAt,
        attempt: attemptBinding,
      });
    });
    receipts.sort((left, right) => {
      if (left.selectedRank !== undefined || right.selectedRank !== undefined) {
        return (
          (left.selectedRank ?? Number.MAX_SAFE_INTEGER) -
          (right.selectedRank ?? Number.MAX_SAFE_INTEGER)
        );
      }
      return left.candidateId.localeCompare(right.candidateId);
    });
    const completed = targetSelectionAttemptSchema.parse({
      ...running,
      status: "selected",
      completedAt: this.#clock().toISOString(),
      ...(modelResult === undefined ? {} : { modelResult }),
      receipts,
    });
    await this.#replace(path, completed);
    return resultFromAttempt(completed);
  }

  async resolveForApproval(
    requestValue: TargetSelectionApprovalVerificationRequest,
  ): Promise<TargetSelectionApprovalVerification> {
    const request =
      targetSelectionApprovalVerificationRequestSchema.parse(requestValue);
    const attempt = await this.#read(
      this.#attemptPath({
        selectionKey: request.attempt.selectionKey,
        revision: request.attempt.revision,
      }),
    );
    if (attempt === undefined || attempt.status !== "selected") {
      throw new Error("Target Selection Attempt is not durably selected");
    }
    const actualAttemptDigest = sha256Digest(attempt);
    if (
      request.attempt.ref.digest !== actualAttemptDigest ||
      request.attempt.ref.id !==
        `selection-attempt:${actualAttemptDigest.slice(7, 31)}` ||
      request.attempt.ref.schemaVersion !== attempt.schemaVersion ||
      attempt.requestDigest !== sha256Digest(attempt.input) ||
      canonicalJson(attempt.input.policy) !==
        canonicalJson(request.selectionPolicy) ||
      canonicalJson(attempt.input.modelProfile) !==
        canonicalJson(request.modelProfile)
    ) {
      throw new Error("Target Selection Attempt binding mismatch");
    }

    const receipts = attempt.receipts.map((storedReceipt) => {
      if (!verifyStoredReceipt(storedReceipt)) {
        throw new Error("Target Selection Receipt integrity mismatch");
      }
      if (storedReceipt.schemaVersion === 2) {
        return storedReceipt;
      }
      const candidate = targetSelectionCandidateForLegacyReceipt(
        storedReceipt.candidate,
      );
      return receipt(candidate, {
        decision: storedReceipt.decision,
        candidateKind: storedReceipt.candidateKind,
        researchTreatment: storedReceipt.researchTreatment,
        hardGate: storedReceipt.hardGate,
        ...(storedReceipt.modelAssessment === undefined
          ? {}
          : { modelAssessment: storedReceipt.modelAssessment }),
        ...(storedReceipt.selectedRank === undefined
          ? {}
          : { selectedRank: storedReceipt.selectedRank }),
        reasonCodes: storedReceipt.reasonCodes,
        selectedAt: storedReceipt.selectedAt,
        attempt: storedReceipt.attempt,
      });
    });

    const usedCandidateIds = new Set(
      receipts.map((value) => value.candidateId),
    );
    const verifiedAt = Date.parse(request.verifiedAt);
    for (const nomination of request.nominations) {
      if (
        nomination.nominatedBy !== request.operatorIdentity ||
        Date.parse(nomination.nominatedAt) > verifiedAt ||
        usedCandidateIds.has(nomination.candidate.candidateId)
      ) {
        throw new Error("Target Selection nomination binding mismatch");
      }
      const candidate: TargetSelectionCandidate = {
        ...nomination.candidate,
        origin: {
          kind: "operator-nomination",
          nominatedBy: nomination.nominatedBy,
          nominatedAt: nomination.nominatedAt,
          reason: nomination.reason,
        },
      };
      const gateReasons = hardGateReasons(candidate, verifiedAt);
      receipts.push(
        receipt(
          candidate,
          {
            decision: "selected",
            candidateKind: candidateKind(candidate),
            researchTreatment: researchTreatment(candidate),
            hardGate: {
              status: gateReasons.length === 0 ? "passed" : "failed",
              reasons: gateReasons,
            },
            reasonCodes:
              gateReasons.length === 0
                ? ["within-batch-capacity"]
                : ["hard-gate-failed"],
            selectedAt: request.verifiedAt,
            attempt: {
              selectionKey: attempt.input.selectionKey,
              revision: attempt.input.revision,
              requestDigest: attempt.requestDigest,
              policy: {
                id: attempt.input.policy.id,
                digest: attempt.input.policy.digest,
              },
              modelProfile: {
                id: attempt.input.modelProfile.id,
                digest: attempt.input.modelProfile.digest,
              },
            },
          },
          "approval-nomination",
        ),
      );
      usedCandidateIds.add(candidate.candidateId);
    }
    receipts.sort((left, right) =>
      left.candidateId.localeCompare(right.candidateId),
    );

    const inputDigest = sha256Digest(request);
    const body = {
      kind: "target-selection-approval-verification" as const,
      schemaVersion: 1 as const,
      inputDigest,
      attemptRef: request.attempt.ref,
      selectionPolicy: request.selectionPolicy,
      modelProfile: request.modelProfile,
      receipts,
      verifiedAt: request.verifiedAt,
    };
    const digest = sha256Digest(body);
    const verification = targetSelectionApprovalVerificationSchema.parse({
      ...body,
      id: `selection-approval:${digest.slice(7, 31)}`,
      digest,
    });
    await this.#persistApprovalVerification(verification);
    return verification;
  }

  async #finishPending(
    path: string,
    running: Extract<TargetSelectionAttempt, { status: "running" }>,
    reason: TargetSelectionPendingReason,
    pendingCandidateIds: readonly string[],
  ): Promise<TargetSelectionResult> {
    const pending = targetSelectionAttemptSchema.parse({
      ...running,
      status: "selection-pending",
      completedAt: this.#clock().toISOString(),
      reason,
      pendingCandidateIds,
    });
    await this.#replace(path, pending);
    return resultFromAttempt(pending);
  }

  #attemptPath(request: {
    readonly selectionKey: string;
    readonly revision: number;
  }): string {
    return join(
      this.#storageDirectory,
      "target-selection-attempts",
      `${request.selectionKey}.revision-${request.revision}.json`,
    );
  }

  async #read(
    path: string,
  ): Promise<TargetSelectionReadableAttempt | undefined> {
    try {
      return targetSelectionReadableAttemptSchema.parse(
        JSON.parse((await readFile(path)).toString("utf8")),
      );
    } catch (error) {
      if (hasErrorCode(error, "ENOENT")) {
        return undefined;
      }
      throw error;
    }
  }

  async #persistApprovalVerification(
    verification: TargetSelectionApprovalVerification,
  ): Promise<void> {
    const directory = join(
      this.#storageDirectory,
      "target-selection-approval-verifications",
    );
    await mkdir(directory, { recursive: true });
    const path = join(directory, `${verification.digest.slice(7)}.json`);
    const bytes = Buffer.from(canonicalJson(verification), "utf8");
    try {
      await writeFile(path, bytes, { flag: "wx" });
    } catch (error) {
      if (!hasErrorCode(error, "EEXIST")) throw error;
      if (!(await readFile(path)).equals(bytes)) {
        throw new Error("Target Selection approval verification conflict");
      }
    }
  }

  async #create(
    path: string,
    attempt: TargetSelectionAttempt,
  ): Promise<boolean> {
    await mkdir(join(this.#storageDirectory, "target-selection-attempts"), {
      recursive: true,
    });
    try {
      await writeFile(path, canonicalJson(attempt), { flag: "wx" });
      return true;
    } catch (error) {
      if (hasErrorCode(error, "EEXIST")) {
        return false;
      }
      throw error;
    }
  }

  async #replace(path: string, attempt: TargetSelectionAttempt): Promise<void> {
    const temporaryPath = `${path}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(temporaryPath, canonicalJson(attempt), { flag: "wx" });
    await rename(temporaryPath, path);
  }
}

export function openTargetSelection(
  options: OpenTargetSelectionOptions,
): TargetSelection {
  return new FileTargetSelection(options);
}
