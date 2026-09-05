import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  openTargetBatchApproval,
  openTargetSelection,
  type TargetBatchApprovalRequest,
  type TargetSelectionCandidate,
  type TargetSelectionModelProfile,
  type TargetSelectionPolicy,
  type TargetSelectionReceipt,
} from "../../src/target-intelligence/index.js";

const digest = (character: string): string => `sha256:${character.repeat(64)}`;
const selectionPolicy: TargetSelectionPolicy = {
  kind: "target-selection-policy",
  schemaVersion: 1,
  id: "selection-policy-v1",
  digest: digest("a"),
  batchSize: 2,
  diversity: { maximumPerFacetValue: 3 },
};
const modelProfile: TargetSelectionModelProfile = {
  kind: "target-selection-model-profile",
  schemaVersion: 1,
  id: "opus-selection-v1",
  digest: digest("b"),
  family: "opus",
};

function candidate(id: string): TargetSelectionCandidate {
  return {
    candidateId: id,
    target: {
      pluginIdentity: `wporg:${id}`,
      verifiedVersion: "1.0.0",
      canonicalFileManifestDigest: digest("c"),
    },
    targetObservation: {
      ref: { id: `target-observation:${id}`, digest: digest("d") },
      retrievedAt: "2030-08-31T00:00:00.000Z",
      currentUntil: "2030-09-03T00:00:00.000Z",
      acquisition: "available",
      provenance: "verified",
      identity: "verified",
    },
    selectionFacts: {
      activeInstallCount: 10000,
      lastUpdatedAt: "2030-08-01T00:00:00.000Z",
      integrations: ["wordpress-rest-api"],
    },
    programmes: [
      {
        programmeIdentity: "programme:patchstack",
        snapshotRef: {
          id: "programme-snapshot:patchstack",
          digest: digest("e"),
        },
        opportunityBand: "broad",
        eligibility: "eligible",
        currentUntil: "2030-09-03T00:00:00.000Z",
      },
    ],
    disclosureRoute: {
      observationRef: {
        id: `disclosure-route:${id}`,
        digest: digest("f"),
        routeDigest: digest("1"),
      },
      kind: "delegated-vdp",
      currentUntil: "2030-09-03T00:00:00.000Z",
    },
    researchHistory: { status: "new" },
    diversity: {
      vendor: `vendor-${id}`,
      pluginFamily: `family-${id}`,
      useCase: `use-${id}`,
      sizeBand: "medium",
      authorityModel: "mixed",
      integrations: ["wordpress-rest-api"],
    },
  };
}

async function selectionReceipts(
  storageDirectory: string,
  options: {
    readonly selectionKey?: string;
    readonly candidates?: readonly TargetSelectionCandidate[];
  } = {},
): Promise<{
  readonly attemptRef: {
    readonly kind: "target-selection-attempt-ref";
    readonly schemaVersion: 1;
    readonly id: string;
    readonly digest: string;
  };
  readonly receipts: readonly TargetSelectionReceipt[];
}> {
  const selection = openTargetSelection({
    storageDirectory,
    model: {
      rank: async (input) => ({
        kind: "target-selection-model-result",
        schemaVersion: 1,
        rankedCandidateIds: input.candidates.map(
          ({ candidateId }) => candidateId,
        ),
        assessments: input.candidates.map(({ candidateId }) => ({
          candidateId,
          researchValueBand: "high",
          uncertaintyBand: "medium",
          reasonCodes: ["recently-updated"],
        })),
      }),
    },
    clock: () => new Date("2030-09-01T00:00:00.000Z"),
  });
  const selected = await selection.select({
    kind: "target-selection-request",
    schemaVersion: 1,
    selectionKey: options.selectionKey ?? "approval-fixture-selection",
    revision: 1,
    policy: selectionPolicy,
    modelProfile,
    candidates: [
      ...(options.candidates ?? [
        candidate("candidate-one"),
        candidate("candidate-two"),
        candidate("candidate-three"),
      ]),
    ],
  });
  if (selected.status !== "selected") {
    throw new Error("Expected Selection Receipts for approval fixture");
  }
  return selected;
}

describe("TargetBatchApproval", () => {
  it("rejects Selection Receipts that are not bound to a durable Attempt", async () => {
    const selectionDirectory = await mkdtemp(
      join(tmpdir(), "target-batch-unbound-selection-"),
    );
    const approvalDirectory = await mkdtemp(
      join(tmpdir(), "target-batch-unbound-approval-"),
    );
    try {
      const selection = await selectionReceipts(selectionDirectory, {
        selectionKey: "unbound-selection",
        candidates: [candidate("candidate-unbound")],
      });
      const approval = openTargetBatchApproval({
        storageDirectory: approvalDirectory,
        clock: () => new Date("2030-09-01T12:00:00.000Z"),
      });

      await expect(
        approval.approve({
          kind: "target-batch-approval-request",
          schemaVersion: 1,
          batchKey: "unbound-batch",
          revision: 1,
          selectionAttemptRef: selection.attemptRef,
          selectionReceipts: [...selection.receipts],
          selectionPolicy,
          modelProfile,
          campaignPolicy: { id: "campaign-policy-v1", digest: digest("2") },
          batchBudget: {
            kind: "target-batch-budget",
            schemaVersion: 1,
            id: "batch-budget-v1",
            digest: digest("3"),
            maxTargets: 1,
            maxActiveCampaigns: 1,
          },
          executionWindow: {
            startsAt: "2030-09-02T00:00:00.000Z",
            endsAt: "2030-09-03T00:00:00.000Z",
          },
          operator: {
            identity: "human:fixture-operator",
            decidedAt: "2030-09-01T11:55:00.000Z",
          },
          decisions: [
            {
              candidateId: "candidate-unbound",
              decision: "approve",
              source: "autonomous-selection",
              reason: "accept the oracle-free selection rationale",
            },
          ],
          approvedOrder: ["candidate-unbound"],
          orderReason: "single Target batch",
        }),
      ).rejects.toMatchObject({ code: "selection-attempt-unverified" });
    } finally {
      await rm(selectionDirectory, { recursive: true, force: true });
      await rm(approvalDirectory, { recursive: true, force: true });
    }
  });

  it("records one human decision with approval, exclusion, reordering, and a gated nomination", async () => {
    const directory = await mkdtemp(join(tmpdir(), "target-batch-approval-"));
    let currentTime = "2030-09-01T12:00:00.000Z";
    try {
      const selection = await selectionReceipts(directory);
      const approval = openTargetBatchApproval({
        storageDirectory: directory,
        clock: () => new Date(currentTime),
      });
      const input: TargetBatchApprovalRequest = {
        kind: "target-batch-approval-request",
        schemaVersion: 1,
        batchKey: "september-batch",
        revision: 1,
        selectionAttemptRef: selection.attemptRef,
        selectionReceipts: [...selection.receipts],
        selectionPolicy,
        modelProfile,
        campaignPolicy: { id: "campaign-policy-v1", digest: digest("2") },
        batchBudget: {
          kind: "target-batch-budget",
          schemaVersion: 1,
          id: "batch-budget-v1",
          digest: digest("3"),
          maxTargets: 3,
          maxActiveCampaigns: 2,
        },
        executionWindow: {
          startsAt: "2030-09-02T00:00:00.000Z",
          endsAt: "2030-09-03T00:00:00.000Z",
        },
        operator: {
          identity: "human:fixture-operator",
          decidedAt: "2030-09-01T11:55:00.000Z",
        },
        decisions: [
          {
            candidateId: "candidate-one",
            decision: "approve",
            source: "autonomous-selection",
            reason: "accept the oracle-free selection rationale",
          },
          {
            candidateId: "candidate-two",
            decision: "exclude",
            source: "autonomous-selection",
            reason: "defer this candidate to a later batch",
          },
          {
            candidateId: "candidate-three",
            decision: "approve",
            source: "operator-nominated",
            reason: "restore a hard-gate-passing candidate outside capacity",
          },
        ],
        approvedOrder: ["candidate-three", "candidate-one"],
        orderReason: "run the operator-nominated Target first",
      };
      const ref = await approval.approve(input);

      await expect(approval.inspect(ref)).resolves.toMatchObject({
        kind: "approved-target-batch",
        schemaVersion: 1,
        batchKey: "september-batch",
        revision: 1,
        approvedTargets: [
          {
            candidateId: "candidate-three",
            source: "operator-nominated",
          },
          {
            candidateId: "candidate-one",
            source: "autonomous-selection",
          },
        ],
        excludedTargets: [
          {
            candidateId: "candidate-two",
            reason: "defer this candidate to a later batch",
          },
        ],
        operator: {
          identity: "human:fixture-operator",
          decidedAt: "2030-09-01T11:55:00.000Z",
        },
        selectionPolicy,
        modelProfile,
        campaignPolicy: { id: "campaign-policy-v1", digest: digest("2") },
        batchBudget: { maxTargets: 3, maxActiveCampaigns: 2 },
        executionWindow: {
          startsAt: "2030-09-02T00:00:00.000Z",
          endsAt: "2030-09-03T00:00:00.000Z",
        },
      });
      await expect(approval.approve(input)).resolves.toEqual(ref);

      const restarted = openTargetBatchApproval({
        storageDirectory: directory,
        clock: () => new Date(currentTime),
      });
      await expect(restarted.inspect(ref)).resolves.toEqual(
        await approval.inspect(ref),
      );
      await expect(restarted.approve(input)).resolves.toEqual(ref);

      await expect(
        approval.approve({
          ...input,
          batchKey: "oracle-tainted-batch",
          knownCve: "CVE-2099-9999",
          credential: "must-not-cross-approval",
        } as TargetBatchApprovalRequest),
      ).rejects.toThrow();

      const revisedRef = await approval.approve({
        ...input,
        revision: 2,
        supersedes: ref,
        approvedOrder: ["candidate-one", "candidate-three"],
        orderReason: "move the autonomous selection back to the front",
      });
      await expect(approval.inspect(revisedRef)).resolves.toMatchObject({
        revision: 2,
        supersedes: ref,
        approvedTargets: [
          { candidateId: "candidate-one" },
          { candidateId: "candidate-three" },
        ],
      });

      currentTime = "2030-09-02T00:00:00.000Z";
      await expect(
        approval.approve({
          ...input,
          revision: 3,
          supersedes: revisedRef,
        }),
      ).rejects.toMatchObject({ code: "execution-started" });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("does not let an operator nomination bypass a failed Selection hard gate", async () => {
    const directory = await mkdtemp(join(tmpdir(), "target-batch-gate-"));
    const covered = candidate("candidate-covered");
    try {
      const selection = await selectionReceipts(directory, {
        selectionKey: "covered-selection",
        candidates: [
          {
            ...covered,
            researchHistory: {
              status: "coverage-closed",
              campaignId: "campaign-covered",
            },
          },
        ],
      });
      const approval = openTargetBatchApproval({
        storageDirectory: directory,
        clock: () => new Date("2030-09-01T12:00:00.000Z"),
      });
      await expect(
        approval.approve({
          kind: "target-batch-approval-request",
          schemaVersion: 1,
          batchKey: "covered-batch",
          revision: 1,
          selectionAttemptRef: selection.attemptRef,
          selectionReceipts: [...selection.receipts],
          selectionPolicy,
          modelProfile,
          campaignPolicy: { id: "campaign-policy-v1", digest: digest("2") },
          batchBudget: {
            kind: "target-batch-budget",
            schemaVersion: 1,
            id: "batch-budget-v1",
            digest: digest("3"),
            maxTargets: 1,
            maxActiveCampaigns: 1,
          },
          executionWindow: {
            startsAt: "2030-09-02T00:00:00.000Z",
            endsAt: "2030-09-03T00:00:00.000Z",
          },
          operator: {
            identity: "human:fixture-operator",
            decidedAt: "2030-09-01T11:55:00.000Z",
          },
          decisions: [
            {
              candidateId: "candidate-covered",
              decision: "approve",
              source: "operator-nominated",
              reason: "attempt to override already-covered history",
            },
          ],
          approvedOrder: ["candidate-covered"],
          orderReason: "single nominated candidate",
        }),
      ).rejects.toMatchObject({ code: "hard-gate-failed" });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
