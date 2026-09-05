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
import {
  createLegacyApprovedTargetBatchFixture,
  createLegacyTargetSelectionFixture,
} from "../fixtures/target-intelligence/legacy-target-selection.js";

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

function candidate(
  id: string,
  origin: TargetSelectionCandidate["origin"] = {
    kind: "autonomous-observation",
  },
): TargetSelectionCandidate {
  return {
    candidateId: id,
    origin,
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
    readonly schemaVersion: 2;
    readonly id: string;
    readonly digest: string;
  };
  readonly receipts: readonly TargetSelectionReceipt[];
  readonly resolver: ReturnType<typeof openTargetSelection>;
  readonly selectionKey: string;
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
  const selectionKey = options.selectionKey ?? "approval-fixture-selection";
  const selected = await selection.select({
    kind: "target-selection-request",
    schemaVersion: 2,
    selectionKey,
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
  return { ...selected, resolver: selection, selectionKey };
}

describe("TargetBatchApproval", () => {
  it("inspects a legacy v1 Batch through a read-only reason-code projection", async () => {
    const directory = await mkdtemp(join(tmpdir(), "target-batch-legacy-"));
    try {
      const fixture = await createLegacyApprovedTargetBatchFixture(directory);
      const approval = openTargetBatchApproval({
        storageDirectory: directory,
        selectionResolver: {
          resolveForApproval: async () => {
            throw new Error("legacy Batch inspection must not resolve");
          },
        },
      });

      const projected = await approval.inspect(fixture.ref);
      expect(projected).toMatchObject({
        kind: "approved-target-batch-legacy-projection",
        schemaVersion: 1,
        sourceArtifact: {
          id: fixture.ref.id,
          digest: fixture.ref.digest,
        },
        approvedTargets: [
          {
            candidateId: "legacy-candidate",
            reason: "accept-autonomous-selection",
          },
        ],
        orderReason: "single-target-batch",
      });
      expect(JSON.stringify(projected)).not.toMatch(/CVE|advisory|Finding/);

      const restarted = openTargetBatchApproval({
        storageDirectory: directory,
        selectionResolver: {
          resolveForApproval: async () => {
            throw new Error("legacy Batch inspection must not resolve");
          },
        },
      });
      await expect(restarted.inspect(fixture.ref)).resolves.toEqual(projected);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("rejects a caller-supplied Attempt ref that does not bind the durable Attempt", async () => {
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
        selectionResolver: selection.resolver,
        clock: () => new Date("2030-09-01T12:00:00.000Z"),
      });

      await expect(
        approval.approve({
          kind: "target-batch-approval-request",
          schemaVersion: 2,
          batchKey: "unbound-batch",
          revision: 1,
          selectionAttempt: {
            ref: { ...selection.attemptRef, digest: digest("9") },
            selectionKey: selection.selectionKey,
            revision: 1,
          },
          operatorNominations: [],
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
              reason: "accept-autonomous-selection",
            },
          ],
          approvedOrder: ["candidate-unbound"],
          orderReason: "single-target-batch",
        }),
      ).rejects.toMatchObject({ code: "selection-attempt-unverified" });
    } finally {
      await rm(selectionDirectory, { recursive: true, force: true });
      await rm(approvalDirectory, { recursive: true, force: true });
    }
  });

  it("rejects a durable Receipt whose full Attempt binding differs from its parent Attempt", async () => {
    const directory = await mkdtemp(
      join(tmpdir(), "target-batch-receipt-binding-"),
    );
    try {
      const fixture = await createLegacyTargetSelectionFixture({
        receiptRequestDigest: digest("9"),
      });
      const selection = openTargetSelection({
        storageDirectory: directory,
        model: { rank: async () => ({}) },
      });
      const migratedRef = await selection.migrateLegacyAttempt(fixture.attempt);
      const approval = openTargetBatchApproval({
        storageDirectory: directory,
        selectionResolver: selection,
      });

      await expect(
        approval.approve({
          kind: "target-batch-approval-request",
          schemaVersion: 2,
          batchKey: "receipt-binding-batch",
          revision: 1,
          selectionAttempt: {
            ref: migratedRef,
            selectionKey: fixture.selectionKey,
            revision: fixture.revision,
          },
          operatorNominations: [],
          selectionPolicy: fixture.policy,
          modelProfile: fixture.modelProfile,
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
            startsAt: "2031-09-02T00:00:00.000Z",
            endsAt: "2031-09-03T00:00:00.000Z",
          },
          operator: {
            identity: "human:fixture-operator",
            decidedAt: "2030-09-01T00:00:00.000Z",
          },
          decisions: [
            {
              candidateId: "legacy-candidate",
              decision: "approve",
              reason: "accept-autonomous-selection",
            },
          ],
          approvedOrder: ["legacy-candidate"],
          orderReason: "single-target-batch",
        }),
      ).rejects.toMatchObject({ code: "selection-attempt-unverified" });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("records one human decision with approval, exclusion, reordering, and a gated nomination", async () => {
    const directory = await mkdtemp(join(tmpdir(), "target-batch-approval-"));
    let currentTime = "2030-09-01T12:00:00.000Z";
    try {
      const selection = await selectionReceipts(directory, {
        candidates: [candidate("candidate-one"), candidate("candidate-two")],
      });
      const { origin: _origin, ...nominatedCandidate } =
        candidate("candidate-three");
      const approval = openTargetBatchApproval({
        storageDirectory: directory,
        selectionResolver: selection.resolver,
        clock: () => new Date(currentTime),
      });
      const input: TargetBatchApprovalRequest = {
        kind: "target-batch-approval-request",
        schemaVersion: 2,
        batchKey: "september-batch",
        revision: 1,
        selectionAttempt: {
          ref: selection.attemptRef,
          selectionKey: selection.selectionKey,
          revision: 1,
        },
        operatorNominations: [
          {
            candidate: nominatedCandidate,
            nominatedBy: "human:fixture-operator",
            nominatedAt: "2030-08-31T23:55:00.000Z",
            reason: "coverage-balance",
          },
        ],
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
            reason: "accept-autonomous-selection",
          },
          {
            candidateId: "candidate-two",
            decision: "exclude",
            reason: "exclude-from-current-batch",
          },
          {
            candidateId: "candidate-three",
            decision: "approve",
            reason: "approve-operator-nomination",
          },
        ],
        approvedOrder: ["candidate-three", "candidate-one"],
        orderReason: "operator-nomination-prioritized",
      };
      const ref = await approval.approve(input);

      const approvedBatch = await approval.inspect(ref);
      if (approvedBatch.kind !== "approved-target-batch") {
        throw new Error("Expected a current Approved Target Batch");
      }
      expect(
        approvedBatch.selectionReceipts.find(
          (receipt) => receipt.candidateId === "candidate-three",
        ),
      ).toMatchObject({
        candidate: {
          origin: {
            kind: "operator-nomination",
            nominatedBy: "human:fixture-operator",
            nominatedAt: "2030-08-31T23:55:00.000Z",
            reason: "coverage-balance",
          },
        },
      });
      expect(approvedBatch).toMatchObject({
        kind: "approved-target-batch",
        schemaVersion: 2,
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
            reason: "exclude-from-current-batch",
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
        selectionResolver: selection.resolver,
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

      await expect(
        Reflect.apply(approval.approve, approval, [
          {
            ...input,
            batchKey: "relabeled-nomination-batch",
            decisions: input.decisions.map((decision) =>
              decision.candidateId === "candidate-one"
                ? { ...decision, source: "operator-nominated" }
                : decision,
            ),
          },
        ]),
      ).rejects.toThrow("source");

      await expect(
        Reflect.apply(approval.approve, approval, [
          {
            ...input,
            batchKey: "oracle-reason-batch",
            decisions: input.decisions.map((decision) =>
              decision.candidateId === "candidate-one"
                ? { ...decision, reason: "Prioritize CVE-2099-9999" }
                : decision,
            ),
          },
        ]),
      ).rejects.toThrow("reason");

      const revisedRef = await approval.approve({
        ...input,
        revision: 2,
        supersedes: ref,
        approvedOrder: ["candidate-one", "candidate-three"],
        orderReason: "autonomous-selection-prioritized",
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
        candidates: [candidate("candidate-one")],
      });
      const { origin: _origin, ...coveredNomination } = {
        ...covered,
        researchHistory: {
          status: "coverage-closed" as const,
          campaignId: "campaign-covered",
        },
      };
      const approval = openTargetBatchApproval({
        storageDirectory: directory,
        selectionResolver: selection.resolver,
        clock: () => new Date("2030-09-01T12:00:00.000Z"),
      });
      await expect(
        approval.approve({
          kind: "target-batch-approval-request",
          schemaVersion: 2,
          batchKey: "covered-batch",
          revision: 1,
          selectionAttempt: {
            ref: selection.attemptRef,
            selectionKey: selection.selectionKey,
            revision: 1,
          },
          operatorNominations: [
            {
              candidate: coveredNomination,
              nominatedBy: "human:fixture-operator",
              nominatedAt: "2030-08-31T23:55:00.000Z",
              reason: "coverage-balance",
            },
          ],
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
              candidateId: "candidate-one",
              decision: "exclude",
              reason: "exclude-from-current-batch",
            },
            {
              candidateId: "candidate-covered",
              decision: "approve",
              reason: "approve-operator-nomination",
            },
          ],
          approvedOrder: ["candidate-covered"],
          orderReason: "single-target-batch",
        }),
      ).rejects.toMatchObject({ code: "hard-gate-failed" });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
