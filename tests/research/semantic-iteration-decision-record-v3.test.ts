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
      const needsResearchSubject = {
        ...subject,
        id: digest("needs-research-hypothesis-id"),
        digest: digest("needs-research-hypothesis"),
        attemptId: "finder-2",
        leaseId: digest("needs-research-lease-id"),
      };
      const familyIdentity = {
        kind: "approach-family-admission" as const,
        schemaVersion: 1 as const,
        key: "cross-actor-state",
        target: input.targetSnapshot,
        manifest,
        wave,
        subjects: [subject, needsResearchSubject],
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
        evaluationSubjects: [subject, needsResearchSubject],
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
          {
            kind: "admit-validation",
            approachFamily: familyRef,
            subjects: [needsResearchSubject],
            admission: {
              kind: "validation-admission",
              schemaVersion: 1,
              id: digest("needs-research-validation-admission"),
              target: input.targetSnapshot,
              manifest,
              wave,
              hypothesis: needsResearchSubject,
              brokenSecurityProperty: "identity-integrity",
              causalRoute: [
                {
                  ordinal: 1,
                  claim: "Public registration may reach identity mutation.",
                  evidence: [
                    {
                      path: "plugin.php",
                      fileDigest: digest("plugin.php"),
                      startLine: 5,
                      endLine: 8,
                    },
                  ],
                },
              ],
              reason: "Registration reachability needs fresh validation.",
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
      const needsResearchCandidateIdentity = {
        target: input.targetSnapshot,
        manifest,
        attackerPremise: "unresolved" as const,
        brokenSecurityProperty: "identity-integrity",
        causalRoute: [
          {
            ordinal: 1,
            claim: "Public registration may reach identity mutation.",
            evidence: [
              {
                path: "plugin.php",
                fileDigest: digest("plugin.php"),
                startLine: 5,
                endLine: 8,
              },
            ],
          },
        ],
      };
      const needsResearchCandidate = validationCandidateSchema.parse({
        kind: "validation-candidate",
        schemaVersion: 1,
        id: validationCandidateId(needsResearchCandidateIdentity),
        ...needsResearchCandidateIdentity,
        origins: [
          {
            subjectDigest: needsResearchSubject.digest,
            rootEvaluationDigest: first.decision.digest,
            approachFamilyId: registry!.value.families[0]!.id,
          },
        ],
      });
      const intended = await record.recordValidationIntents(
        input.campaignId,
        plan.runId,
        [candidate, needsResearchCandidate],
      );
      const intendedReplay = await record.recordValidationIntents(
        input.campaignId,
        plan.runId,
        [candidate, needsResearchCandidate],
      );
      expect(intendedReplay).toEqual(intended);
      expect(intended).toHaveLength(2);
      const pendingIntent = intended.find(
        (entry) => entry.intent.validationId === candidate.id,
      );
      const needsResearchIntent = intended.find(
        (entry) => entry.intent.validationId === needsResearchCandidate.id,
      );
      expect(pendingIntent).toMatchObject({
        ledgerHead: first.ledgerHead + 1,
        intent: {
          validationId: candidate.id,
          candidate: { id: candidate.id },
          approachFamilyIds: [registry!.value.families[0]!.id],
        },
      });
      await expect(
        artifactStore.readJson(pendingIntent!.intent.candidate.digest),
      ).resolves.toEqual(candidate);
      const pendingRegistry = await record.readApproachFamilyRegistryV3(
        input.campaignId,
        plan.runId,
      );
      expect(pendingRegistry?.value.families[0]?.pendingValidations).toEqual(
        [candidate.id, needsResearchCandidate.id].sort(),
      );
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
        ledgerHead: pendingIntent!.ledgerHead + 1,
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
        pendingValidations: [candidate.id, needsResearchCandidate.id].sort(),
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

      const validationCriteria = [
        "source-integrity",
        "reachability-and-premise",
        "broken-control",
        "causal-route-and-security-effect",
        "counterevidence-and-proof-gap",
      ] as const;
      const selectedProofGap = {
        requiredFact: "Confirm whether public registration reaches the hook.",
        currentEvidence: [
          {
            path: "plugin.php",
            fileDigest: digest("plugin.php"),
            startLine: 5,
            endLine: 8,
          },
        ],
        falsifier: "Every registration call is restricted to administrators.",
        nextAction: "Trace every registration call and its access guard.",
      };
      const validatorAttempt = (attemptId: string, ordinal: 1 | 2) => {
        const proofGap =
          attemptId === "needs-validator-2"
            ? selectedProofGap
            : {
                ...selectedProofGap,
                requiredFact: "Check whether only administrators can register.",
                nextAction: "Trace the administrator-only registration path.",
              };
        return {
          status: "completed" as const,
          ordinal,
          execution: {
            kind: "attempt-execution-result" as const,
            schemaVersion: 2 as const,
            attemptId,
            owner: "validation" as const,
            role: "validator" as const,
            planDigest: digest(`${attemptId}-plan`),
            digest: digest(`${attemptId}-result`),
          },
          output: {
            kind: "validation-attempt-output" as const,
            schemaVersion: 1 as const,
            candidateId: needsResearchCandidate.id,
            criteria: validationCriteria.map((criterion) => ({
              criterion,
              status:
                criterion === "reachability-and-premise"
                  ? ("unknown" as const)
                  : ("pass" as const),
              reason: `${attemptId} checked ${criterion}.`,
              evidence: proofGap.currentEvidence,
            })),
            proposedDisposition: "needs-research" as const,
            proofGap,
          },
        };
      };
      const needsResearchRecord = validationRecordSchema.parse({
        kind: "validation-record",
        schemaVersion: 1,
        validationId: needsResearchCandidate.id,
        candidateId: needsResearchCandidate.id,
        planDigest: digest("needs-research-validation-plan"),
        status: "needs-research",
        materialConflictAfterTwo: false,
        validatorAttempts: [
          validatorAttempt("needs-validator-1", 1),
          validatorAttempt("needs-validator-2", 2),
        ],
        synthesisAttempt: {
          status: "completed",
          execution: {
            kind: "attempt-execution-result",
            schemaVersion: 2,
            attemptId: "needs-synthesis",
            owner: "validation",
            role: "validation-synthesizer",
            planDigest: digest("needs-synthesis-plan"),
            digest: digest("needs-synthesis-result"),
          },
          output: {
            kind: "validation-synthesis-output",
            schemaVersion: 1,
            candidateId: needsResearchCandidate.id,
            criteria: validationCriteria.map((criterion) => ({
              criterion,
              status:
                criterion === "reachability-and-premise" ? "unknown" : "pass",
              reason: `The cited Attempts resolve ${criterion}.`,
              evidence: [
                {
                  attemptId: "needs-validator-2",
                  criterion,
                  evidenceIndexes: [0],
                },
              ],
            })),
            disposition: "needs-research",
            reason: "Public registration remains source-decidable.",
            proofGapAttemptId: "needs-validator-2",
          },
        },
      });
      const needsResearchRecordDigest =
        await artifactStore.putJson(needsResearchRecord);
      const needsResearchRecordRef = validationRecordRefSchema.parse({
        kind: needsResearchRecord.kind,
        schemaVersion: needsResearchRecord.schemaVersion,
        validationId: needsResearchRecord.validationId,
        candidateId: needsResearchRecord.candidateId,
        digest: needsResearchRecordDigest,
      });
      const needsResearchCompletion = await record.recordValidationCompletion(
        input.campaignId,
        plan.runId,
        needsResearchRecordRef,
      );
      const needsResearchCompletionReplay =
        await record.recordValidationCompletion(
          input.campaignId,
          plan.runId,
          needsResearchRecordRef,
        );
      expect(needsResearchCompletionReplay).toEqual(needsResearchCompletion);
      expect(needsResearchCompletion).toMatchObject({
        ledgerHead: completion.ledgerHead + 1,
        completion: {
          validation: needsResearchRecordRef,
          disposition: "needs-research",
          approachFamilyIds: [registry!.value.families[0]!.id],
          frontierGap: {
            kind: "validation-frontier-gap",
            validationId: needsResearchCandidate.id,
          },
        },
      });
      const frontierGap = needsResearchCompletion.completion.frontierGap;
      expect(frontierGap).toBeDefined();
      await expect(
        artifactStore.readJson(frontierGap!.digest),
      ).resolves.toMatchObject({
        kind: "validation-frontier-gap",
        schemaVersion: 1,
        validation: needsResearchRecordRef,
        candidate: needsResearchIntent!.intent.candidate,
        approachFamilyIds: [registry!.value.families[0]!.id],
        value: selectedProofGap,
      });
      const feedbackRegistry = await record.readApproachFamilyRegistryV3(
        input.campaignId,
        plan.runId,
      );
      expect(feedbackRegistry?.value.families[0]).toMatchObject({
        pendingValidations: [candidate.id],
        validationOutcomes: expect.arrayContaining([
          expect.objectContaining({
            validationId: needsResearchCandidate.id,
            disposition: "needs-research",
          }),
        ]),
      });

      record.close();
      const reopened = openSqliteResearchRecord({ databasePath });
      try {
        await expect(
          reopened.readApproachFamilyRegistryV3(input.campaignId, plan.runId),
        ).resolves.toEqual(feedbackRegistry);
        await expect(
          reopened.listValidationIntents(input.campaignId, plan.runId),
        ).resolves.toEqual(intended);
        const replayedValidations = await reopened.listValidationCompletions(
          input.campaignId,
          plan.runId,
        );
        expect(replayedValidations).toEqual(
          [completion, needsResearchCompletion].sort((left, right) =>
            left.completion.validation.validationId.localeCompare(
              right.completion.validation.validationId,
            ),
          ),
        );
        const replayedLegacyValidation = replayedValidations.find(
          (entry) =>
            entry.completion.validation.validationId ===
            needsResearchCandidate.id,
        );
        if (replayedLegacyValidation === undefined) {
          throw new Error("Legacy Validation completion was not replayed");
        }
        await expect(
          artifactStore.readJson(
            replayedLegacyValidation.completion.validation.digest,
          ),
        ).resolves.toMatchObject({
          schemaVersion: 1,
          validatorAttempts: [{ ordinal: 1 }, { ordinal: 2 }],
          synthesisAttempt: {
            status: "completed",
            output: { disposition: "needs-research" },
          },
        });
        await expect(
          reopened.listValidationFrontierGaps(input.campaignId, plan.runId),
        ).resolves.toMatchObject([
          {
            ledgerHead: needsResearchCompletion.ledgerHead,
            frontierGap,
          },
        ]);
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
