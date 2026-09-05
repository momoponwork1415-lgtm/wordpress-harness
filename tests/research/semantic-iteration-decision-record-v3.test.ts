import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  approachFamilyAdmissionRefSchema,
  approachFamilyAdmissionSchema,
  iterationDecisionV3Schema,
} from "../../src/research/exploration/index.js";
import { sha256Digest } from "../../src/research/research-record/canonical-json.js";
import {
  openFileJsonArtifactStore,
  openSqliteResearchRecord,
} from "../../src/research/research-record/index.js";
import {
  validationCandidateId,
  validationCandidateSchema,
  validationRecordRefSchema,
  validationRecordSchema,
} from "../../src/research/validation/index.js";
import { createCampaignInput } from "../fixtures/campaign.js";

const digest = (value: string): string => sha256Digest(value);

describe("Research Record Iteration Decision v3", () => {
  it("persists the Decision and projected Family Registry before one replayable Ledger event", async () => {
    const directory = await mkdtemp(join(tmpdir(), "iteration-decision-v3-"));
    const databasePath = join(directory, "research.sqlite");
    const artifactStore = openFileJsonArtifactStore(
      join(directory, "artifacts"),
    );
    const record = openSqliteResearchRecord({ databasePath, artifactStore });

    try {
      const input = {
        ...createCampaignInput("campaign-decision-v3"),
        schemaVersion: 2 as const,
        canonicalFileManifest: {
          kind: "canonical-file-manifest" as const,
          schemaVersion: 1 as const,
          entries: [
            { path: "plugin.php", digest: digest("plugin.php"), size: 100 },
          ],
        },
      };
      const manifest = {
        kind: "target-file-manifest" as const,
        schemaVersion: 1 as const,
        targetSnapshotId: input.targetSnapshot.id,
        targetSnapshotDigest: input.targetSnapshot.digest,
        digest: sha256Digest({
          kind: "target-file-manifest",
          schemaVersion: 1,
          targetSnapshot: {
            id: input.targetSnapshot.id,
            digest: input.targetSnapshot.digest,
          },
          entries: input.canonicalFileManifest.entries,
        }),
      };
      const prepared = await record.recordPreparation(input, manifest);
      const wave = {
        kind: "work-wave" as const,
        schemaVersion: 2 as const,
        id: digest("wave-id"),
        digest: digest("wave"),
        targetSnapshotDigest: input.targetSnapshot.digest,
        manifestDigest: manifest.digest,
      };
      const plan = {
        kind: "campaign-run-plan" as const,
        schemaVersion: 2 as const,
        runId: "run-decision-v3",
        campaignId: input.campaignId,
        preparationDigest: prepared.requestedInputDigest,
        target: input.targetSnapshot,
        manifest,
        workWave: { ref: wave, artifactDigest: digest("wave-artifact") },
        finder: {
          modelProfile: {
            ref: {
              kind: "model-profile" as const,
              schemaVersion: 1 as const,
              id: input.modelProfiles[0]!.id,
              family: "claude" as const,
              digest: input.modelProfiles[0]!.digest,
            },
            execution: {
              provider: "anthropic" as const,
              model: "claude-opus-5",
              transport: "claude-code-process" as const,
              executableVersion: "2.1.258",
              effort: "high" as const,
              eligibilityReceiptDigest: digest("eligibility"),
            },
          },
          promptSet: {
            kind: "prompt-set" as const,
            schemaVersion: 1 as const,
            id: input.promptSet.id,
            digest: input.promptSet.digest,
          },
          selectedKnowledge: [],
          sourceToolPolicy: {
            kind: "source-tool-policy" as const,
            schemaVersion: 1 as const,
            id: "semantic-source-tools-v1",
            digest: digest("source-policy"),
          },
        },
      };
      await record.recordSemanticCampaignRunStart(plan);

      const evaluatorRef = {
        kind: "attempt-execution-result" as const,
        schemaVersion: 2 as const,
        attemptId: "root-evaluator-v3",
        owner: "exploration" as const,
        role: "root-evaluator" as const,
        planDigest: digest("evaluator-plan"),
        digest: digest("evaluator-result"),
      };
      await record.recordSemanticCampaignAttemptStart({
        kind: "campaign-attempt-intent",
        schemaVersion: 2,
        campaignId: input.campaignId,
        runId: plan.runId,
        attemptId: evaluatorRef.attemptId,
        ordinal: 1,
        mode: "execute",
        role: "root-evaluator",
        attemptPlanDigest: evaluatorRef.planDigest,
        workWaveDigest: wave.digest,
        terminalDigest: digest("terminal"),
      });
      const completed = await record.recordSemanticCampaignAttemptCompletion({
        kind: "campaign-attempt-completion",
        schemaVersion: 2,
        campaignId: input.campaignId,
        runId: plan.runId,
        attemptId: evaluatorRef.attemptId,
        ordinal: 1,
        role: "root-evaluator",
        workWaveDigest: wave.digest,
        terminalDigest: digest("terminal"),
        result: evaluatorRef,
      });

      const subject = {
        kind: "source-bound-hypothesis" as const,
        schemaVersion: 2 as const,
        id: digest("hypothesis-id"),
        digest: digest("hypothesis"),
        attemptId: "finder-1",
        leaseId: digest("lease-id"),
        workWaveDigest: wave.digest,
        targetSnapshotDigest: input.targetSnapshot.digest,
        manifestDigest: manifest.digest,
      };
      const familyIdentity = {
        kind: "approach-family-admission" as const,
        schemaVersion: 1 as const,
        key: "cross-actor-state",
        target: input.targetSnapshot,
        manifest,
        wave,
        subjects: [subject],
        thesis: "Attacker-controlled state crosses an actor boundary.",
        mechanism: "A public writer feeds a privileged state consumer.",
        falsifier: "Every consumer enforces actor ownership.",
        nextAction: "Trace all privileged consumers.",
      };
      const family = approachFamilyAdmissionSchema.parse({
        ...familyIdentity,
        id: sha256Digest(familyIdentity),
      });
      const familyRef = approachFamilyAdmissionRefSchema.parse({
        kind: family.kind,
        schemaVersion: family.schemaVersion,
        id: family.id,
        digest: sha256Digest(family),
        key: family.key,
        targetSnapshotDigest: input.targetSnapshot.digest,
        manifestDigest: manifest.digest,
        workWaveDigest: wave.digest,
      });
      const decision = iterationDecisionV3Schema.parse({
        kind: "iteration-decision",
        schemaVersion: 3,
        target: input.targetSnapshot,
        manifest,
        wave,
        evaluationSubjects: [subject],
        context: {
          kind: "wave-evaluation",
          terminalDigest: digest("terminal"),
          workLeases: [
            {
              kind: "work-lease",
              schemaVersion: 2,
              id: digest("lease-id"),
              digest: digest("lease"),
              workWaveDigest: wave.digest,
              targetSnapshotDigest: input.targetSnapshot.digest,
              manifestDigest: manifest.digest,
            },
          ],
          attemptResults: [],
          toolReceipts: [],
          rootEvaluatorAttempts: [evaluatorRef],
        },
        approachFamilies: [family],
        actions: [
          {
            kind: "admit-validation",
            approachFamily: familyRef,
            subjects: [subject],
            admission: {
              kind: "validation-admission",
              schemaVersion: 1,
              id: digest("validation-admission"),
              target: input.targetSnapshot,
              manifest,
              wave,
              hypothesis: subject,
              brokenSecurityProperty: "state-ownership",
              causalRoute: [
                {
                  ordinal: 1,
                  claim: "A public writer feeds a privileged state consumer.",
                  evidence: [
                    {
                      path: "plugin.php",
                      fileDigest: digest("plugin.php"),
                      startLine: 1,
                      endLine: 4,
                    },
                  ],
                },
              ],
              reason: "The complete source route warrants fresh validation.",
            },
          },
        ],
        campaignDisposition: "continue",
      });

      const first = await record.recordSemanticIterationDecisionV3(
        input.campaignId,
        plan.runId,
        decision,
      );
      const replay = await record.recordSemanticIterationDecisionV3(
        input.campaignId,
        plan.runId,
        decision,
      );

      expect(replay).toEqual(first);
      expect(first.ledgerHead).toBe(completed.completion!.ledgerHead + 1);
      const registry = await record.readApproachFamilyRegistryV3(
        input.campaignId,
        plan.runId,
      );
      expect(registry).toBeDefined();
      await expect(
        artifactStore.readJson(first.decision.digest),
      ).resolves.toEqual(decision);
      await expect(
        artifactStore.readJson(first.registry.digest),
      ).resolves.toEqual(registry!.value);

      const candidateIdentity = {
        target: input.targetSnapshot,
        manifest,
        attackerPremise: "unauthenticated" as const,
        brokenSecurityProperty: "state-ownership",
        causalRoute: [
          {
            ordinal: 1,
            claim: "A public writer feeds a privileged state consumer.",
            evidence: [
              {
                path: "plugin.php",
                fileDigest: digest("plugin.php"),
                startLine: 1,
                endLine: 4,
              },
            ],
          },
        ],
      };
      const candidate = validationCandidateSchema.parse({
        kind: "validation-candidate",
        schemaVersion: 1,
        id: validationCandidateId(candidateIdentity),
        ...candidateIdentity,
        origins: [
          {
            subjectDigest: subject.digest,
            rootEvaluationDigest: first.decision.digest,
            approachFamilyId: registry!.value.families[0]!.id,
          },
        ],
      });
      const intended = await record.recordValidationIntents(
        input.campaignId,
        plan.runId,
        [candidate],
      );
      const intendedReplay = await record.recordValidationIntents(
        input.campaignId,
        plan.runId,
        [candidate],
      );
      expect(intendedReplay).toEqual(intended);
      expect(intended).toHaveLength(1);
      expect(intended[0]).toMatchObject({
        ledgerHead: first.ledgerHead + 1,
        intent: {
          validationId: candidate.id,
          candidate: { id: candidate.id },
          approachFamilyIds: [registry!.value.families[0]!.id],
        },
      });
      await expect(
        artifactStore.readJson(intended[0]!.intent.candidate.digest),
      ).resolves.toEqual(candidate);
      const pendingRegistry = await record.readApproachFamilyRegistryV3(
        input.campaignId,
        plan.runId,
      );
      expect(pendingRegistry?.value.families[0]?.pendingValidations).toEqual([
        candidate.id,
      ]);
      await expect(
        artifactStore.readJson(pendingRegistry!.ref.digest),
      ).resolves.toEqual(pendingRegistry!.value);

      const validationRecord = validationRecordSchema.parse({
        kind: "validation-record",
        schemaVersion: 1,
        validationId: candidate.id,
        candidateId: candidate.id,
        planDigest: digest("validation-plan"),
        status: "validation-pending",
        reason: "validator-attempt-failed",
        materialConflictAfterTwo: false,
        validatorAttempts: [
          {
            status: "failed",
            ordinal: 1,
            execution: {
              kind: "attempt-execution-result",
              schemaVersion: 2,
              attemptId: "validator-1",
              owner: "validation",
              role: "validator",
              planDigest: digest("validator-plan"),
              digest: digest("validator-result"),
            },
            terminalStatus: "provider-failed",
            reason: "Provider failed before a valid rubric was returned.",
          },
        ],
      });
      const validationRecordDigest =
        await artifactStore.putJson(validationRecord);
      const validationRecordRef = validationRecordRefSchema.parse({
        kind: validationRecord.kind,
        schemaVersion: validationRecord.schemaVersion,
        validationId: validationRecord.validationId,
        candidateId: validationRecord.candidateId,
        digest: validationRecordDigest,
      });
      const completion = await record.recordValidationCompletion(
        input.campaignId,
        plan.runId,
        validationRecordRef,
      );
      const completionReplay = await record.recordValidationCompletion(
        input.campaignId,
        plan.runId,
        validationRecordRef,
      );
      expect(completionReplay).toEqual(completion);
      expect(completion).toMatchObject({
        ledgerHead: intended[0]!.ledgerHead + 1,
        completion: {
          validation: validationRecordRef,
          disposition: "validation-pending",
          approachFamilyIds: [registry!.value.families[0]!.id],
        },
      });
      const unresolvedRegistry = await record.readApproachFamilyRegistryV3(
        input.campaignId,
        plan.runId,
      );
      expect(unresolvedRegistry?.value.families[0]).toMatchObject({
        pendingValidations: [candidate.id],
        validationOutcomes: [
          {
            validationId: candidate.id,
            recordDigest: validationRecordDigest,
            disposition: "validation-pending",
          },
        ],
      });
      await expect(
        artifactStore.readJson(unresolvedRegistry!.ref.digest),
      ).resolves.toEqual(unresolvedRegistry!.value);

      record.close();
      const reopened = openSqliteResearchRecord({ databasePath });
      try {
        await expect(
          reopened.readApproachFamilyRegistryV3(input.campaignId, plan.runId),
        ).resolves.toEqual(unresolvedRegistry);
        await expect(
          reopened.listValidationIntents(input.campaignId, plan.runId),
        ).resolves.toEqual(intended);
        await expect(
          reopened.listValidationCompletions(input.campaignId, plan.runId),
        ).resolves.toEqual([completion]);
      } finally {
        reopened.close();
      }
    } finally {
      try {
        record.close();
      } catch {
        // The record was already closed before replay.
      }
      await rm(directory, { recursive: true, force: true });
    }
  });
});
