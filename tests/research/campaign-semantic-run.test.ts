import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  CampaignRunConflictError,
  openResearch,
} from "../../src/research/index.js";
import type { SemanticWorkWavePlan } from "../../src/research/exploration/index.js";
import type {
  AttemptExecutionResultV2,
  AttemptPlanV2,
  ModelExecution,
} from "../../src/research/model-execution/index.js";
import { sha256Digest } from "../../src/research/research-record/canonical-json.js";
import {
  openFileJsonArtifactStore,
  openSqliteResearchRecord,
} from "../../src/research/research-record/index.js";
import { createCampaignInput } from "../fixtures/campaign.js";

const digest = (character: string): string => `sha256:${character.repeat(64)}`;

function completedFinderResult(
  plan: Extract<AttemptPlanV2, { role: "finder" }>,
  output: unknown = {
    kind: "finder-output",
    schemaVersion: 2,
    leaseId: plan.assignment.leaseId,
    hypotheses: [],
    routeFragments: [],
    frontierGaps: [],
  },
): AttemptExecutionResultV2 {
  const planDigest = sha256Digest(plan);
  const value = {
    kind: "model-attempt-result" as const,
    schemaVersion: 2 as const,
    attemptId: plan.attemptId,
    owner: "exploration" as const,
    role: "finder" as const,
    planDigest,
    status: "completed" as const,
    output,
  };
  return {
    status: "completed",
    ref: {
      kind: "attempt-execution-result",
      schemaVersion: 2,
      attemptId: plan.attemptId,
      owner: "exploration",
      role: "finder",
      planDigest,
      digest: sha256Digest(value),
    },
    value,
  };
}

function failedFinderResult(
  plan: Extract<AttemptPlanV2, { role: "finder" }>,
): AttemptExecutionResultV2 {
  const planDigest = sha256Digest(plan);
  const value = {
    kind: "model-attempt-result" as const,
    schemaVersion: 2 as const,
    attemptId: plan.attemptId,
    owner: "exploration" as const,
    role: "finder" as const,
    planDigest,
    status: "provider-failed" as const,
    reason: "simulated-transport-loss-after-checkpoint",
  };
  return {
    status: value.status,
    ref: {
      kind: "attempt-execution-result",
      schemaVersion: 2,
      attemptId: plan.attemptId,
      owner: "exploration",
      role: "finder",
      planDigest,
      digest: sha256Digest(value),
    },
    value,
  };
}

function workWave(
  target: {
    readonly id: string;
    readonly pluginSlug: string;
    readonly version: string;
    readonly digest: string;
  },
  manifest: {
    readonly kind: "target-file-manifest";
    readonly schemaVersion: 1;
    readonly targetSnapshotId: string;
    readonly targetSnapshotDigest: string;
    readonly digest: string;
  },
): SemanticWorkWavePlan {
  const scopes = [
    "target-specific",
    "target-specific",
    "target-specific",
    "wildcard",
  ] as const;
  const theses = scopes.map((scope, index) => ({
    kind: "research-thesis" as const,
    schemaVersion: 1 as const,
    id: digest(String(index + 1)),
    target,
    manifest,
    scope,
    securityAssumption: `independent-security-assumption-${index + 1}`,
    question: `Which broken semantic follows from assumption ${index + 1}?`,
    motivation: `Investigate independent security meaning ${index + 1}.`,
    startingBasis: "Oracle-free Target metadata only.",
    independence: `This thesis uses an independent assumption ${index + 1}.`,
  }));
  const leases = theses.map((thesis, index) => ({
    kind: "work-lease" as const,
    schemaVersion: 2 as const,
    id: digest(String(index + 5)),
    role: "finder" as const,
    target,
    manifest,
    assignment: {
      kind: "research-thesis" as const,
      schemaVersion: 1 as const,
      thesisId: thesis.id,
    },
    budget: {
      maxWallTimeMs: 900_000,
      maxModelTokens: 100_000,
      maxModelTurns: 66,
      maxProviderCostUsd: 2.5,
      maxHypotheses: 8,
      maxOutputBytes: 512 * 1_024,
      maxSourceQueries: 64,
    },
  }));
  return {
    kind: "work-wave-plan",
    schemaVersion: 2,
    id: digest("9"),
    ref: {
      kind: "work-wave",
      schemaVersion: 2,
      id: digest("9"),
      digest: digest("9"),
      targetSnapshotDigest: target.digest,
      manifestDigest: manifest.digest,
    },
    purpose: { kind: "raw-source" },
    target,
    manifest,
    policy: {
      kind: "semantic-root-planning-policy",
      schemaVersion: 1,
      id: "semantic-research-baseline-v1",
      digest: digest("a"),
    },
    plannerAttempt: {
      kind: "attempt-execution-result",
      schemaVersion: 2,
      attemptId: "root-planner-attempt",
      owner: "exploration",
      role: "root-planner",
      planDigest: digest("b"),
      digest: digest("c"),
    },
    theses,
    leases,
  };
}

describe("CampaignRunner.run semantic Finder wave", () => {
  it("materializes only each Finder's Thesis into a Map-free AttemptPlanV2", async () => {
    const directory = await mkdtemp(join(tmpdir(), "campaign-semantic-run-"));
    const artifacts = openFileJsonArtifactStore(join(directory, "artifacts"));
    const input = {
      ...createCampaignInput("campaign-semantic-run"),
      schemaVersion: 2 as const,
      canonicalFileManifest: {
        kind: "canonical-file-manifest" as const,
        schemaVersion: 1 as const,
        entries: [
          { path: "demo.php", digest: digest("d"), size: 100 },
          { path: "includes/state.php", digest: digest("e"), size: 200 },
        ],
      },
      knowledgeCapsules: [{ id: "wordpress-security-v1", digest: digest("f") }],
    };
    const observedPlans: Extract<AttemptPlanV2, { role: "finder" }>[] = [];
    const fragmentProposal = {
      kind: "route-fragment-proposal" as const,
      schemaVersion: 1 as const,
      attackerPremise: "unauthenticated" as const,
      preconditions: ["A public request reaches the callback."],
      operation: "Read attacker-selected persistent state.",
      consumedValues: [
        {
          identity: "state-key",
          provenance: "attacker-controlled" as const,
        },
      ],
      producedValues: [
        { identity: "state-value", capability: "read" as const },
      ],
      stateTransitions: [
        {
          stateIdentity: "plugin-state",
          operation: "read" as const,
          effect: "The response reveals the persisted value.",
        },
      ],
      evidence: [
        {
          path: "demo.php",
          fileDigest: digest("d"),
          startLine: 1,
          endLine: 1,
        },
      ],
      unknowns: [
        {
          claim: "Sensitive values may share this state.",
          requiredEvidence: "Trace all writers of the state.",
        },
      ],
      falsifier: "The callback only returns public constants.",
      nextInvestigation: "Trace writers and authorization guards.",
    };
    let forcedFinderOutput:
      | ((plan: Extract<AttemptPlanV2, { role: "finder" }>) => unknown)
      | undefined;
    let checkpointBeforeFailure = false;
    const firstCheckpointAcks: unknown[] = [];
    const modelExecution: ModelExecution = {
      run: async (plan, observer) => {
        if (plan.schemaVersion !== 2 || plan.role !== "finder") {
          throw new Error("Expected a semantic Finder plan");
        }
        observedPlans.push(plan);
        const finderOrdinal = observedPlans.length;
        if (finderOrdinal === 1 || checkpointBeforeFailure) {
          const firstAck = await observer?.checkpoint(fragmentProposal);
          if (finderOrdinal === 1) {
            const duplicateAck = await observer?.checkpoint(fragmentProposal);
            firstCheckpointAcks.push(firstAck, duplicateAck);
          }
        }
        if (checkpointBeforeFailure) return failedFinderResult(plan);
        if (forcedFinderOutput !== undefined) {
          return completedFinderResult(plan, forcedFinderOutput(plan));
        }
        return completedFinderResult(
          plan,
          finderOrdinal === 1
            ? {
                kind: "finder-output",
                schemaVersion: 2,
                leaseId: plan.assignment.leaseId,
                hypotheses: [],
                routeFragments: [fragmentProposal],
                frontierGaps: [],
              }
            : undefined,
        );
      },
    };
    let legacyMaterializerCalls = 0;
    let verifierCalls = 0;
    let labCalls = 0;
    const research = openResearch({
      databasePath: join(directory, "research.sqlite"),
      campaignExecution: {
        artifactStore: artifacts,
        attemptPlanMaterializer: {
          materialize: async () => {
            legacyMaterializerCalls += 1;
            throw new Error("Legacy Map materializer must not run");
          },
        },
        modelExecution,
        independentVerifier: {
          rederive: async () => {
            verifierCalls += 1;
            throw new Error("Verifier must not run before the Wave barrier");
          },
        },
        labControl: {
          execute: async () => {
            labCalls += 1;
            throw new Error("Lab must not run before the Wave barrier");
          },
        },
      },
    });

    try {
      const prepared = await research.runner.prepare(input);
      if (prepared.targetFileManifest === undefined) {
        throw new Error("Expected a prepared Target File Manifest");
      }
      const wave = workWave(input.targetSnapshot, prepared.targetFileManifest);
      const waveArtifactDigest = await artifacts.putJson(wave);
      const plan = {
        kind: "campaign-run-plan" as const,
        schemaVersion: 2 as const,
        runId: "semantic-wave-1",
        campaignId: input.campaignId,
        preparationDigest: prepared.inputDigest,
        target: input.targetSnapshot,
        manifest: prepared.targetFileManifest,
        workWave: {
          ref: wave.ref,
          artifactDigest: waveArtifactDigest,
        },
        finder: {
          modelProfile: {
            ref: {
              kind: "model-profile" as const,
              schemaVersion: 1 as const,
              id: input.modelProfiles[0]!.id,
              family: "claude",
              digest: input.modelProfiles[0]!.digest,
            },
            execution: {
              provider: "anthropic",
              model: "claude-opus-5",
              transport: "claude-code-process",
              executableVersion: "2.1.258",
              effort: "high",
              eligibilityReceiptDigest: digest("0"),
            },
          },
          promptSet: {
            kind: "prompt-set" as const,
            schemaVersion: 1 as const,
            id: input.promptSet.id,
            digest: input.promptSet.digest,
          },
          selectedKnowledge: input.knowledgeCapsules,
          sourceToolPolicy: {
            kind: "source-tool-policy" as const,
            schemaVersion: 1 as const,
            id: "semantic-source-tools-v1",
            digest: digest("a"),
          },
        },
      };

      const ref = await research.runner.run(plan);
      const inspected = await research.reader.inspect(input.campaignId, {
        kind: "run",
        runId: plan.runId,
      });

      expect({ ref, inspected }).toMatchObject({
        ref: {
          kind: "campaign-run-record",
          schemaVersion: 2,
          decision: "finder-wave-completed",
        },
        inspected: {
          kind: "run",
          value: {
            kind: "campaign-run-record",
            schemaVersion: 2,
            target: input.targetSnapshot,
            manifest: prepared.targetFileManifest,
            workWave: wave.ref,
            attempts: [
              { role: "finder" },
              { role: "finder" },
              { role: "finder" },
              { role: "finder" },
            ],
            waveTerminal: {
              kind: "semantic-wave-terminal",
              schemaVersion: 2,
              hypotheses: [],
              routeFragments: [
                {
                  kind: "route-fragment",
                  schemaVersion: 2,
                  targetSnapshotDigest: input.targetSnapshot.digest,
                  manifestDigest: prepared.targetFileManifest.digest,
                },
              ],
              frontierGaps: [],
              issues: [],
            },
            decision: { kind: "finder-wave-completed" },
          },
        },
      });
      expect(observedPlans).toHaveLength(4);
      expect(firstCheckpointAcks).toHaveLength(2);
      expect(firstCheckpointAcks[1]).toEqual(firstCheckpointAcks[0]);

      const checkpointReader = openSqliteResearchRecord({
        databasePath: join(directory, "research.sqlite"),
      });
      try {
        const checkpoints =
          await checkpointReader.listSemanticFinderCheckpoints(
            input.campaignId,
            plan.runId,
          );
        expect(checkpoints).toMatchObject([
          {
            checkpoint: {
              kind: "finder-checkpoint",
              schemaVersion: 1,
              ordinal: 1,
              subject: {
                kind: "route-fragment",
                leaseId: observedPlans[0]?.assignment.leaseId,
              },
            },
          },
        ]);
        const checkpoint = checkpoints[0];
        if (checkpoint === undefined) {
          throw new Error("Expected a durable Finder checkpoint");
        }
        await expect(
          artifacts.readJson(checkpoint.checkpoint.digest),
        ).resolves.toMatchObject({
          kind: "finder-checkpoint",
          subject: { kind: "route-fragment" },
        });
      } finally {
        checkpointReader.close();
      }

      const replayed = await research.runner.run(plan);
      expect(replayed).toEqual(ref);
      expect(observedPlans).toHaveLength(4);

      checkpointBeforeFailure = true;
      const checkpointFailurePlan = {
        ...plan,
        runId: "semantic-wave-checkpoint-failure",
      };
      const checkpointFailureRef = await research.runner.run(
        checkpointFailurePlan,
      );
      checkpointBeforeFailure = false;
      expect(checkpointFailureRef).toMatchObject({ decision: "incomplete" });
      const failedCheckpointReader = openSqliteResearchRecord({
        databasePath: join(directory, "research.sqlite"),
      });
      try {
        const checkpoints =
          await failedCheckpointReader.listSemanticFinderCheckpoints(
            input.campaignId,
            checkpointFailurePlan.runId,
          );
        expect(checkpoints).toHaveLength(4);
        expect(checkpoints).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              checkpoint: expect.objectContaining({
                kind: "finder-checkpoint",
                subject: expect.objectContaining({ kind: "route-fragment" }),
              }),
            }),
          ]),
        );
      } finally {
        failedCheckpointReader.close();
      }
      expect(observedPlans).toHaveLength(8);

      for (const observed of observedPlans) {
        if (observed.assignment.kind !== "research-thesis") {
          throw new Error("Initial Wave produced a non-thesis assignment");
        }
        const assignment = observed.assignment;
        const thesis = wave.theses.find(
          (candidate) => candidate.id === assignment.thesis.id,
        );
        if (thesis === undefined) throw new Error("Finder thesis not found");
        expect(observed.prompt).toContain(thesis.securityAssumption);
        for (const other of wave.theses.filter(
          (candidate) => candidate.id !== thesis.id,
        )) {
          expect(observed.prompt).not.toContain(other.securityAssumption);
        }
        expect(observed).not.toHaveProperty("map");
        expect(observed).not.toHaveProperty("analysisUnit");
        expect(observed.prompt).not.toContain("canonicalFileManifest");
        expect(observed.prompt).not.toContain("entries");
        expect(observed.outputJsonSchema).toMatchObject({
          properties: {
            leaseId: { const: observed.assignment.leaseId },
          },
        });
      }
      expect({ legacyMaterializerCalls, verifierCalls, labCalls }).toEqual({
        legacyMaterializerCalls: 0,
        verifierCalls: 0,
        labCalls: 0,
      });

      const mismatched = {
        ...plan,
        runId: "semantic-wave-mismatched",
        manifest: { ...plan.manifest, digest: digest("7") },
      };
      await expect(research.runner.run(mismatched)).rejects.toBeInstanceOf(
        CampaignRunConflictError,
      );
      await expect(
        research.reader.inspect(input.campaignId, {
          kind: "run",
          runId: mismatched.runId,
        }),
      ).rejects.toThrow("Campaign run not found");
      expect(observedPlans).toHaveLength(8);

      forcedFinderOutput = (finderPlan) => ({
        kind: "finder-output",
        schemaVersion: 2,
        leaseId: finderPlan.assignment.leaseId,
        hypotheses: [],
        routeFragments: [
          {
            kind: "route-fragment-proposal",
            schemaVersion: 1,
            attackerPremise: "unauthenticated",
            preconditions: ["A public request reaches the callback."],
            operation: "Read attacker-selected persistent state.",
            consumedValues: [
              {
                identity: "state-key",
                provenance: "attacker-controlled",
              },
            ],
            producedValues: [{ identity: "state-value", capability: "read" }],
            stateTransitions: [
              {
                stateIdentity: "plugin-state",
                operation: "read",
                effect: "The response reveals the persisted value.",
              },
            ],
            evidence: [
              {
                path: "not-in-manifest.php",
                fileDigest: digest("d"),
                startLine: 1,
                endLine: 1,
              },
            ],
            unknowns: [
              {
                claim: "Sensitive values may share this state.",
                requiredEvidence: "Trace all writers of the state.",
              },
            ],
            falsifier: "The callback only returns public constants.",
            nextInvestigation: "Trace writers and authorization guards.",
          },
        ],
        frontierGaps: [],
      });
      const invalidPlan = {
        ...plan,
        runId: "semantic-wave-foreign-anchor",
      };
      const invalidRef = await research.runner.run(invalidPlan);
      const invalidInspected = await research.reader.inspect(input.campaignId, {
        kind: "run",
        runId: invalidPlan.runId,
      });
      expect({ invalidRef, invalidInspected }).toMatchObject({
        invalidRef: { decision: "incomplete" },
        invalidInspected: {
          kind: "run",
          value: {
            waveTerminal: {
              hypotheses: [],
              routeFragments: [],
              frontierGaps: [],
              issues: [
                { reason: "foreign-source-anchor" },
                { reason: "foreign-source-anchor" },
                { reason: "foreign-source-anchor" },
                { reason: "foreign-source-anchor" },
              ],
            },
            decision: {
              kind: "incomplete",
              reason: "foreign-source-anchor",
            },
          },
        },
      });
      expect(observedPlans).toHaveLength(12);
    } finally {
      research.close();
      await rm(directory, { force: true, recursive: true });
    }
  });
});
