import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { canonicalDigest } from "../../src/infrastructure/canonical-json.js";
import {
  defineAgentRuntimeProfile,
  grokBuildNativeTransport,
} from "../../src/infrastructure/agent-runtime-profile.js";
import {
  defineTargetCandidatePool,
  type TargetCandidate,
} from "../../src/target-intelligence/candidate-pool/index.js";
import {
  openTargetProposals,
  resolveTargetProposal,
  type SealedTargetSelectionRun,
  type TargetProposalAgent,
  type TargetProposalRunReceipt,
  type TargetProposalView,
  type TargetSelectionRunInput,
} from "../../src/target-intelligence/target-proposal/index.js";
import {
  openApprovedTargetBatches,
  type ApprovedTargetBatchRequest,
  type TargetDispatchAdmissionRequest,
} from "../../src/target-intelligence/approved-target-batch/index.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

function candidate(
  candidateId: string,
  pluginIdentity: string,
  eligibility: "eligible" | "ineligible" | "unknown" = "eligible",
): TargetCandidate {
  return {
    candidateId,
    target: {
      pluginIdentity,
      verifiedVersion: "1.0.0",
      canonicalFileManifestDigest:
        "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    },
    targetObservation: {
      ref: {
        id: `observation-${candidateId}`,
        digest:
          "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      },
      retrievedAt: "2026-09-01T00:00:00.000Z",
      currentUntil: "2026-09-14T00:00:00.000Z",
      acquisition: "available",
      provenance: "verified",
      identity: "verified",
    },
    selectionFacts: {
      activeInstallCount: 10_000,
      lastUpdatedAt: "2026-08-20T00:00:00.000Z",
      integrations: ["contact-form"],
    },
    programmes: [
      {
        programmeIdentity: "programme:example",
        snapshotRef: {
          id: `programme-${candidateId}`,
          digest:
            "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
        },
        opportunityBand: "research-only",
        eligibility,
        currentUntil: "2026-09-14T00:00:00.000Z",
      },
    ],
    disclosureRoute: {
      observationRef: {
        id: `route-${candidateId}`,
        digest:
          "sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
        routeDigest:
          "sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
      },
      kind: "none-found",
      currentUntil: "2026-09-14T00:00:00.000Z",
    },
    researchHistory: { status: "new" },
  };
}

function input(
  candidates: readonly TargetCandidate[],
): TargetSelectionRunInput {
  return {
    kind: "target-selection-run-input",
    schemaVersion: 1,
    selectionKey: "prospective-wordpress-plugins",
    revision: 1,
    candidatePool: defineTargetCandidatePool({
      id: "candidate-pool-2026-09-07",
      candidates,
    }),
    selectionGuidance: {
      id: "selection-guidance-v1",
      digest:
        "sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
    },
    agentRuntimeProfile: defineAgentRuntimeProfile({
      id: "grok-target-proposal-v1",
      ...grokBuildNativeTransport,
      model: "grok-4.6",
      effort: "xhigh",
    }),
    permissionProfile: {
      id: "oracle-free-selection-v1",
      digest:
        "sha256:2222222222222222222222222222222222222222222222222222222222222222",
    },
    budgetEnvelope: {
      id: "target-proposal-budget-v1",
      maxWallTimeMs: 300_000,
      digest:
        "sha256:3333333333333333333333333333333333333333333333333333333333333333",
    },
  };
}

function completedReceipt(
  run: SealedTargetSelectionRun,
  candidateId: string,
  usage: { readonly wallTimeMs: number; readonly estimatedCostUsd?: number } = {
    wallTimeMs: 60_000,
  },
): TargetProposalRunReceipt {
  return {
    schemaVersion: 1,
    runId: run.runId,
    runtimeProfileDigest: run.agentRuntimeProfile.digest,
    terminal: "completed",
    startedAt: "2026-09-07T03:00:00.000Z",
    completedAt: "2026-09-07T03:01:00.000Z",
    usage,
    activity: { subagents: 0, tools: null },
    report: {
      schemaVersion: 1,
      basis: "One Target is worth prospective semantic Research.",
      targets: [
        {
          candidateId,
          reason: "The source-backed integration boundary warrants review.",
          uncertainty: "No vulnerability is known before Research.",
        },
      ],
    },
  };
}

describe("TargetProposals", () => {
  it("lets the agent propose an arbitrary pool subset without ranking unselected Targets", async () => {
    const directory = await mkdtemp(join(tmpdir(), "target-proposals-"));
    temporaryDirectories.push(directory);
    const eligible = candidate("candidate-eligible-1", "wporg:eligible-plugin");
    const researchOnly = candidate(
      "candidate-research-only-1",
      "wporg:research-only-plugin",
      "ineligible",
    );
    const request = input([eligible, researchOnly]);
    let executions = 0;
    const agent: TargetProposalAgent = {
      async execute(run) {
        executions += 1;
        expect(run.candidatePool.candidates).toHaveLength(2);
        expect("batchSize" in run).toBe(false);
        expect("diversity" in run).toBe(false);
        return {
          schemaVersion: 1,
          runId: run.runId,
          runtimeProfileDigest: run.agentRuntimeProfile.digest,
          terminal: "completed",
          startedAt: "2026-09-07T00:00:00.000Z",
          completedAt: "2026-09-07T00:01:00.000Z",
          usage: {
            wallTimeMs: 60_000,
            inputTokens: 2_000,
            outputTokens: 300,
            estimatedCostUsd: 0.2,
          },
          activity: { subagents: 1, tools: null },
          report: {
            schemaVersion: 1,
            basis:
              "The research-only plugin has a broad public integration surface and a fresh obtainable source tree.",
            targets: [
              {
                candidateId: "candidate-research-only-1",
                reason:
                  "Its public form integration creates high-value broken-semantics research opportunities.",
                uncertainty:
                  "No current disclosure route was found and technical vulnerability remains unknown.",
              },
            ],
          },
        };
      },
    };
    const proposals = openTargetProposals({
      storageDirectory: directory,
      agent,
      clock: () => new Date("2026-09-07T00:02:00.000Z"),
    });

    await expect(proposals.propose(request)).resolves.toMatchObject({
      status: "proposed",
    });
    const view = await proposals.inspect({
      selectionKey: request.selectionKey,
      revision: request.revision,
    });
    expect(view).toMatchObject({
      status: "proposed",
      proposal: {
        targets: [
          {
            candidateId: "candidate-research-only-1",
            candidate: researchOnly,
            reason:
              "Its public form integration creates high-value broken-semantics research opportunities.",
            uncertainty:
              "No current disclosure route was found and technical vulnerability remains unknown.",
          },
        ],
      },
    });
    expect("receipts" in view).toBe(false);

    await proposals.propose(request);
    expect(executions).toBe(1);
  });

  it("resolves a bound proposal with its full original candidate pool", async () => {
    const directory = await mkdtemp(join(tmpdir(), "proposal-binding-"));
    temporaryDirectories.push(directory);
    const selected = candidate("candidate-selected", "wporg:selected");
    const unselected = candidate("candidate-unselected", "wporg:unselected");
    const request = input([selected, unselected]);
    const proposals = openTargetProposals({
      storageDirectory: directory,
      agent: {
        execute: async (run) => completedReceipt(run, selected.candidateId),
      },
      clock: () => new Date("2026-09-07T03:02:00.000Z"),
    });
    const outcome = await proposals.propose(request);
    if (outcome.proposalRef === undefined)
      throw new Error("Expected a proposal");
    const view = await proposals.inspect(request);

    expect(resolveTargetProposal(view, outcome.proposalRef)).toEqual({
      status: "resolved",
      proposal: view.proposal,
      candidatePool: request.candidatePool,
    });
    expect(resolveTargetProposal(undefined, outcome.proposalRef)).toEqual({
      status: "unavailable",
    });
    expect(
      resolveTargetProposal(
        { ...view, status: "selection-pending" },
        outcome.proposalRef,
      ),
    ).toEqual({ status: "unavailable" });
    expect(
      resolveTargetProposal(view, {
        ...outcome.proposalRef,
        id: "different-proposal",
      }),
    ).toEqual({ status: "conflict" });
  });

  it("rejects changed proposal records even when the candidate copy is rehashed", async () => {
    const directory = await mkdtemp(
      join(tmpdir(), "proposal-record-conflict-"),
    );
    temporaryDirectories.push(directory);
    const selected = candidate("candidate-record", "wporg:record");
    const request = input([selected]);
    const proposals = openTargetProposals({
      storageDirectory: directory,
      agent: {
        execute: async (run) => completedReceipt(run, selected.candidateId),
      },
      clock: () => new Date("2026-09-07T03:02:00.000Z"),
    });
    const outcome = await proposals.propose(request);
    const view = await proposals.inspect(request);
    if (
      outcome.proposalRef === undefined ||
      view.proposal === undefined ||
      view.run.status !== "proposed"
    ) {
      throw new Error("Expected a completed proposal record");
    }
    const changes: readonly TargetProposalView[] = [
      {
        ...view,
        proposal: {
          ...view.proposal,
          basis: "changed without updating its digest",
        },
      },
      {
        ...view,
        run: { ...view.run, input: { ...view.run.input, revision: 2 } },
      },
      {
        ...view,
        run: {
          ...view.run,
          proposal: { ...view.run.proposal, id: "different-proposal" },
        },
      },
    ];
    for (const changed of changes) {
      expect(resolveTargetProposal(changed, outcome.proposalRef)).toEqual({
        status: "conflict",
      });
    }

    const { id, digest: _digest, ...body } = view.proposal;
    const changedBody = {
      ...body,
      targets: body.targets.map((target) => ({
        ...target,
        candidate: {
          ...target.candidate,
          selectionFacts: {
            ...target.candidate.selectionFacts,
            activeInstallCount: 1,
          },
        },
      })),
    };
    const changedProposal = {
      ...changedBody,
      id,
      digest: canonicalDigest(changedBody),
    };
    expect(
      resolveTargetProposal(
        {
          ...view,
          proposal: changedProposal,
          run: { ...view.run, proposal: changedProposal },
        },
        { ...outcome.proposalRef, digest: changedProposal.digest },
      ),
    ).toEqual({ status: "conflict" });
  });

  it("requires a human decision before a Target Proposal becomes an Approved Target Batch", async () => {
    const directory = await mkdtemp(join(tmpdir(), "approved-target-batch-"));
    temporaryDirectories.push(directory);
    const proposedCandidate = candidate(
      "candidate-proposed-1",
      "wporg:proposed-plugin",
      "ineligible",
    );
    const request = input([proposedCandidate]);
    const proposals = openTargetProposals({
      storageDirectory: directory,
      agent: {
        async execute(run) {
          return {
            schemaVersion: 1,
            runId: run.runId,
            runtimeProfileDigest: run.agentRuntimeProfile.digest,
            terminal: "completed",
            startedAt: "2026-09-07T01:00:00.000Z",
            completedAt: "2026-09-07T01:01:00.000Z",
            usage: { wallTimeMs: 60_000 },
            activity: { subagents: 0, tools: null },
            report: {
              schemaVersion: 1,
              basis:
                "This source-obtainable public integration warrants prospective Research.",
              targets: [
                {
                  candidateId: proposedCandidate.candidateId,
                  reason:
                    "The public integration boundary is worth semantic review.",
                  uncertainty:
                    "Programme eligibility is absent and vulnerability remains unknown.",
                },
              ],
            },
          };
        },
      },
      clock: () => new Date("2026-09-07T01:02:00.000Z"),
    });
    const proposalOutcome = await proposals.propose(request);
    if (proposalOutcome.proposalRef === undefined) {
      throw new Error("Expected a Target Proposal");
    }
    const approvalRequest: ApprovedTargetBatchRequest = {
      kind: "approved-target-batch-request",
      schemaVersion: 3,
      batchKey: "approved-prospective-plugins",
      revision: 1,
      proposalRef: proposalOutcome.proposalRef,
      campaignPolicy: {
        id: "prospective-campaign-v1",
        digest:
          "sha256:4444444444444444444444444444444444444444444444444444444444444444",
      },
      batchBudget: {
        id: "approved-batch-budget-v1",
        digest:
          "sha256:5555555555555555555555555555555555555555555555555555555555555555",
        maxTargets: 1,
        maxActiveCampaigns: 1,
      },
      executionWindow: {
        startsAt: "2026-09-07T02:00:00.000Z",
        endsAt: "2026-09-10T02:00:00.000Z",
      },
      operator: {
        identity: "operator-fortn",
        decidedAt: "2026-09-07T01:05:00.000Z",
      },
      nominations: [],
      decisions: [
        {
          candidateId: proposedCandidate.candidateId,
          decision: "approve",
          reason:
            "Approve Research despite absent programme eligibility; no submission is authorized.",
        },
      ],
      approvedOrder: [proposedCandidate.candidateId],
    };
    const batches = openApprovedTargetBatches({
      storageDirectory: directory,
      proposals,
      clock: () => new Date("2026-09-07T01:06:00.000Z"),
    });

    const ref = await batches.approve(approvalRequest);
    await expect(batches.inspect(ref)).resolves.toMatchObject({
      proposalRef: proposalOutcome.proposalRef,
      operator: { identity: "operator-fortn" },
      approvedTargets: [
        {
          candidateId: proposedCandidate.candidateId,
          candidate: proposedCandidate,
          source: "agent-proposal",
          humanReason:
            "Approve Research despite absent programme eligibility; no submission is authorized.",
          proposalReason:
            "The public integration boundary is worth semantic review.",
        },
      ],
      externalAction: "not-authorized",
    });
    await expect(batches.approve(approvalRequest)).resolves.toEqual(ref);
    const dispatchRequest: TargetDispatchAdmissionRequest = {
      kind: "target-dispatch-admission-request",
      schemaVersion: 1,
      batchRef: ref,
      candidateId: proposedCandidate.candidateId,
      target: proposedCandidate.target,
      targetObservation: proposedCandidate.targetObservation,
      checkedAt: "2026-09-08T01:05:00.000Z",
    };
    await expect(batches.admitDispatch(dispatchRequest)).resolves.toMatchObject(
      {
        candidateId: proposedCandidate.candidateId,
        batchRef: ref,
        target: proposedCandidate.target,
      },
    );
    await expect(
      batches.admitDispatch({
        ...dispatchRequest,
        checkedAt: "2026-09-15T01:05:00.000Z",
      }),
    ).rejects.toMatchObject({ code: "hard-gate-failed" });
  });

  it("keeps provider, output, and Budget failures selection-pending", async () => {
    const failureCases = [
      {
        key: "provider-failure",
        terminal: "provider-failed",
        execute: async () => {
          throw new Error("synthetic provider outage");
        },
      },
      {
        key: "invalid-output",
        terminal: "invalid-output",
        execute: async () => ({ unsupported: true }),
      },
      {
        key: "budget-exhausted",
        terminal: "budget-exhausted",
        execute: async (run: SealedTargetSelectionRun) =>
          completedReceipt(run, "candidate-failure-1", {
            wallTimeMs: 300_001,
            estimatedCostUsd: 0.1,
          }),
      },
    ] as const;

    for (const failureCase of failureCases) {
      const directory = await mkdtemp(
        join(tmpdir(), `target-proposal-${failureCase.key}-`),
      );
      temporaryDirectories.push(directory);
      const request = {
        ...input([candidate("candidate-failure-1", "wporg:failure-plugin")]),
        selectionKey: `selection-${failureCase.key}`,
      };
      const proposals = openTargetProposals({
        storageDirectory: directory,
        agent: { execute: failureCase.execute },
        clock: () => new Date("2026-09-07T03:02:00.000Z"),
      });

      await expect(proposals.propose(request)).resolves.toMatchObject({
        status: "selection-pending",
      });
      await expect(
        proposals.inspect({
          selectionKey: request.selectionKey,
          revision: request.revision,
        }),
      ).resolves.toMatchObject({
        status: "selection-pending",
        run: { receipt: { terminal: failureCase.terminal } },
      });
    }
  });

  it("rejects pool-external, unavailable, unverified, and stale selected Targets", async () => {
    const base = candidate("candidate-hard-gate-1", "wporg:hard-gate-plugin");
    const cases: readonly {
      readonly key: string;
      readonly candidate: TargetCandidate;
      readonly selectedId: string;
    }[] = [
      {
        key: "outside-pool",
        candidate: base,
        selectedId: "candidate-not-in-pool",
      },
      {
        key: "unavailable",
        candidate: {
          ...base,
          targetObservation: {
            ...base.targetObservation,
            acquisition: "unavailable",
          },
        },
        selectedId: base.candidateId,
      },
      {
        key: "unverified-provenance",
        candidate: {
          ...base,
          targetObservation: {
            ...base.targetObservation,
            provenance: "unverified",
          },
        },
        selectedId: base.candidateId,
      },
      {
        key: "unverified-identity",
        candidate: {
          ...base,
          targetObservation: {
            ...base.targetObservation,
            identity: "unverified",
          },
        },
        selectedId: base.candidateId,
      },
      {
        key: "stale-source",
        candidate: {
          ...base,
          targetObservation: {
            ...base.targetObservation,
            currentUntil: "2026-09-06T23:59:59.000Z",
          },
        },
        selectedId: base.candidateId,
      },
    ];

    for (const testCase of cases) {
      const directory = await mkdtemp(
        join(tmpdir(), `target-proposal-${testCase.key}-`),
      );
      temporaryDirectories.push(directory);
      const request = {
        ...input([testCase.candidate]),
        selectionKey: `selection-${testCase.key}`,
      };
      const proposals = openTargetProposals({
        storageDirectory: directory,
        agent: {
          async execute(run) {
            return completedReceipt(run, testCase.selectedId);
          },
        },
        clock: () => new Date("2026-09-07T03:02:00.000Z"),
      });

      await expect(proposals.propose(request)).resolves.toMatchObject({
        status: "selection-pending",
      });
      await expect(
        proposals.inspect({
          selectionKey: request.selectionKey,
          revision: request.revision,
        }),
      ).resolves.toMatchObject({
        run: {
          receipt: {
            terminal: "invalid-output",
            failure: {
              summary:
                "Target Proposal selected a Candidate outside the admitted source pool.",
            },
          },
        },
      });
    }
  });
});
