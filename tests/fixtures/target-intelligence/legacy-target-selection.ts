import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import {
  canonicalJson,
  sha256Digest,
} from "../../../src/target-intelligence/acquisition/canonical-json.js";

const digest = (character: string): string => `sha256:${character.repeat(64)}`;

export async function createLegacyTargetSelectionFixture(
  storageDirectory: string,
) {
  const policy = {
    kind: "target-selection-policy" as const,
    schemaVersion: 1 as const,
    id: "selection-policy-v1",
    digest: digest("a"),
    batchSize: 1,
    diversity: { maximumPerFacetValue: 2 },
  };
  const modelProfile = {
    kind: "target-selection-model-profile" as const,
    schemaVersion: 1 as const,
    id: "opus-selection-v1",
    digest: digest("b"),
    family: "opus" as const,
  };
  const candidate = {
    candidateId: "legacy-candidate",
    target: {
      pluginIdentity: "wporg:legacy-candidate",
      verifiedVersion: "1.0.0",
      canonicalFileManifestDigest: digest("c"),
    },
    targetObservation: {
      ref: { id: "target-observation:legacy", digest: digest("d") },
      retrievedAt: "2029-08-31T00:00:00.000Z",
      currentUntil: "2031-09-02T00:00:00.000Z",
      acquisition: "available" as const,
      provenance: "verified" as const,
      identity: "verified" as const,
    },
    selectionFacts: {
      activeInstallCount: 10000,
      lastUpdatedAt: "2029-08-01T00:00:00.000Z",
      integrations: ["wordpress-rest-api"],
    },
    programmes: [
      {
        programmeIdentity: "programme:patchstack",
        snapshotRef: { id: "programme-snapshot:legacy", digest: digest("e") },
        opportunityBand: "broad" as const,
        eligibility: "eligible" as const,
        currentUntil: "2031-09-02T00:00:00.000Z",
      },
    ],
    disclosureRoute: {
      observationRef: {
        id: "disclosure-route:legacy",
        digest: digest("f"),
        routeDigest: digest("1"),
      },
      kind: "delegated-vdp" as const,
      currentUntil: "2031-09-02T00:00:00.000Z",
    },
    researchHistory: {
      status: "incomplete" as const,
      campaignId: "campaign:legacy",
      followUpReason: "Continue from advisory CVE-2029-0001",
    },
    diversity: {
      vendor: "legacy-vendor",
      pluginFamily: "legacy-family",
      useCase: "legacy-use",
      sizeBand: "medium",
      authorityModel: "mixed",
      integrations: ["wordpress-rest-api"],
    },
  };
  const selectionKey = "legacy-selection";
  const revision = 1;
  const request = {
    kind: "target-selection-request" as const,
    schemaVersion: 1 as const,
    selectionKey,
    revision,
    policy,
    modelProfile,
    candidates: [candidate],
  };
  const requestDigest = sha256Digest(request);
  const receiptBody = {
    kind: "selection-receipt" as const,
    schemaVersion: 1 as const,
    candidateId: candidate.candidateId,
    candidate,
    decision: "selected" as const,
    candidateKind: "programme-eligible" as const,
    researchTreatment: "follow-up" as const,
    hardGate: { status: "passed" as const, reasons: [] },
    selectedRank: 1,
    reasonCodes: [
      "within-batch-capacity" as const,
      "reasoned-incomplete-follow-up" as const,
    ],
    selectedAt: "2029-09-01T00:00:00.000Z",
    attempt: {
      selectionKey,
      revision,
      requestDigest,
      policy: { id: policy.id, digest: policy.digest },
      modelProfile: { id: modelProfile.id, digest: modelProfile.digest },
    },
  };
  const receiptDigest = sha256Digest(receiptBody);
  const receipt = {
    ...receiptBody,
    id: `selection-receipt:${receiptDigest.slice(7, 31)}`,
    digest: receiptDigest,
  };
  const attempt = {
    kind: "target-selection-attempt" as const,
    schemaVersion: 1 as const,
    status: "selected" as const,
    requestDigest,
    input: request,
    createdAt: "2029-09-01T00:00:00.000Z",
    completedAt: "2029-09-01T00:01:00.000Z",
    receipts: [receipt],
  };
  const attemptDigest = sha256Digest(attempt);
  const attemptRef = {
    kind: "target-selection-attempt-ref" as const,
    schemaVersion: 1 as const,
    id: `selection-attempt:${attemptDigest.slice(7, 31)}`,
    digest: attemptDigest,
  };
  await mkdir(join(storageDirectory, "target-selection-attempts"), {
    recursive: true,
  });
  await writeFile(
    join(
      storageDirectory,
      "target-selection-attempts",
      `${selectionKey}.revision-${revision}.json`,
    ),
    canonicalJson(attempt),
  );
  return { attemptRef, selectionKey, revision, policy, modelProfile, receipt };
}

export async function createLegacyApprovedTargetBatchFixture(
  storageDirectory: string,
) {
  const selection = await createLegacyTargetSelectionFixture(storageDirectory);
  const decision = {
    candidateId: selection.receipt.candidateId,
    decision: "approve" as const,
    source: "autonomous-selection" as const,
    reason: "Prioritize known CVE-2029-0001 and its advisory",
  };
  const target = {
    candidateId: selection.receipt.candidateId,
    source: "autonomous-selection" as const,
    reason: decision.reason,
    selectionReceiptRef: {
      id: selection.receipt.id,
      digest: selection.receipt.digest,
    },
  };
  const body = {
    kind: "approved-target-batch" as const,
    schemaVersion: 1 as const,
    approvalInputDigest: digest("2"),
    batchKey: "legacy-batch",
    revision: 1,
    selectionAttemptRef: selection.attemptRef,
    selectionReceipts: [selection.receipt],
    selectionPolicy: selection.policy,
    modelProfile: selection.modelProfile,
    campaignPolicy: { id: "campaign-policy-v1", digest: digest("3") },
    batchBudget: {
      kind: "target-batch-budget" as const,
      schemaVersion: 1 as const,
      id: "batch-budget-v1",
      digest: digest("4"),
      maxTargets: 1,
      maxActiveCampaigns: 1,
    },
    executionWindow: {
      startsAt: "2031-09-02T00:00:00.000Z",
      endsAt: "2031-09-03T00:00:00.000Z",
    },
    operator: {
      identity: "human:legacy-operator",
      decidedAt: "2029-09-01T00:02:00.000Z",
    },
    decisions: [decision],
    approvedTargets: [target],
    excludedTargets: [],
    orderReason: "Known Finding needs immediate handling",
    approvedAt: "2029-09-01T00:03:00.000Z",
  };
  const batchDigest = sha256Digest(body);
  const batch = {
    ...body,
    id: `approved-batch:${batchDigest.slice(7, 31)}`,
    digest: batchDigest,
  };
  await mkdir(join(storageDirectory, "approved-target-batches", "artifacts"), {
    recursive: true,
  });
  await writeFile(
    join(
      storageDirectory,
      "approved-target-batches",
      "artifacts",
      `${batchDigest.slice(7)}.json`,
    ),
    canonicalJson(batch),
  );
  return {
    ref: {
      kind: "approved-target-batch-ref" as const,
      schemaVersion: 1 as const,
      id: batch.id,
      digest: batch.digest,
    },
  };
}
