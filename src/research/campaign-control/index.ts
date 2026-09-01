import {
  CampaignPreparationConflictError,
  newCampaignInputSchema,
  type CampaignReader,
  type CampaignRunner,
  type CampaignView,
  type SubjectView,
} from "../contracts.js";
import {
  openExploration,
  type AttemptExecutionResultRef,
  type FinderAttemptResult,
  type SourceBoundHypothesis,
} from "../exploration/index.js";
import {
  attemptExecutionResultRefSchema,
  explorationBootstrapPolicySchema,
  finderAttemptResultSchema,
} from "../exploration/contracts.js";
import { attemptPlanSchema } from "../model-execution/contracts.js";
import { sha256Digest } from "../research-record/canonical-json.js";
import type {
  PreparationRecord,
  ResearchRecord,
} from "../research-record/index.js";
import { surfaceMapSchema } from "../source-mapping/contracts.js";
import { openVerification } from "../verification/index.js";
import {
  campaignRunPlanSchema,
  type CampaignExecutionDependencies,
  type CampaignRunPlan,
  type IterationDecision,
} from "./contracts.js";

export interface CampaignControl {
  readonly runner: CampaignRunner;
  readonly reader: CampaignReader;
}

function projectCampaign(preparation: PreparationRecord): CampaignView {
  return {
    campaignId: preparation.campaignId,
    status: "prepared",
    ledgerHead: preparation.ledgerHead,
    preparedAt: preparation.occurredAt,
    inputDigest: preparation.inputDigest,
    targetSnapshot: preparation.input.targetSnapshot,
  };
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function finderResultRef(
  value: FinderAttemptResult,
): AttemptExecutionResultRef {
  return {
    kind: "attempt-execution-result",
    schemaVersion: 1,
    attemptId: value.attemptId,
    leaseId: value.leaseId,
    digest: sha256Digest(value),
  };
}

function iterationDecision(
  verifications: readonly {
    readonly kind: "verification-record";
    readonly schemaVersion: 1;
    readonly verificationId: string;
    readonly digest: string;
    readonly outcome: "finding" | "disproved" | "blocked";
  }[],
  explorationKind: "verify" | "blocked",
): IterationDecision {
  if (
    verifications.some((verification) => verification.outcome !== "blocked")
  ) {
    return {
      kind: "await-calibration",
      terminalVerifications: [...verifications],
    };
  }
  return {
    kind: "blocked-capability",
    reasons: [
      explorationKind === "blocked"
        ? "no-source-bound-hypothesis"
        : "verification-blocked",
    ],
  };
}

async function executeRun(
  record: ResearchRecord,
  dependencies: CampaignExecutionDependencies,
  plan: CampaignRunPlan,
  planDigest: string,
) {
  const preparation = await record.readPreparation(plan.campaignId);
  if (preparation === undefined) {
    throw new Error(`Campaign not found: ${plan.campaignId}`);
  }
  const mapArtifact = await dependencies.artifactStore.readJson(
    plan.surfaceMap.digest,
  );
  if (sha256Digest(mapArtifact) !== plan.surfaceMap.digest) {
    throw new Error("Campaign Surface Map artifact digest mismatch");
  }
  const surfaceMap = surfaceMapSchema.parse(mapArtifact);
  const policyArtifact = await dependencies.artifactStore.readJson(
    plan.explorationPolicy.digest,
  );
  if (sha256Digest(policyArtifact) !== plan.explorationPolicy.digest) {
    throw new Error("Campaign Exploration Policy artifact digest mismatch");
  }
  const policy = explorationBootstrapPolicySchema.parse(policyArtifact);
  if (
    surfaceMap.targetSnapshot.id !== preparation.input.targetSnapshot.id ||
    surfaceMap.targetSnapshot.digest !== preparation.input.targetSnapshot.digest
  ) {
    throw new Error("Campaign Surface Map targets a different Snapshot");
  }
  if (
    policy.eligibleModelFamilies.length !== 1 ||
    policy.eligibleModelFamilies[0] !== plan.finder.modelProfile.family
  ) {
    throw new Error("Campaign Finder profile does not satisfy its Work Wave");
  }

  const bootstrap = openExploration({
    surfaceMap: { ref: plan.surfaceMap, value: surfaceMap },
    policy: { ref: plan.explorationPolicy, value: policy },
  }).decide({
    kind: "bootstrap",
    map: plan.surfaceMap,
    policy: plan.explorationPolicy,
  });
  if (bootstrap.kind !== "run-wave") {
    throw new Error(`Campaign cannot execute Surface Map: ${bootstrap.kind}`);
  }
  const wave = bootstrap.plan;
  const focusAreas = new Map(
    wave.focusAreas.map((focusArea) => [focusArea.id, focusArea]),
  );
  const selectedLeaseIds = new Set(
    wave.leases
      .slice(0, plan.budget.maxFinderAttempts)
      .map((lease) => lease.id),
  );
  const terminalResults = await Promise.all(
    wave.leases.map(async (lease, index) => {
      if (!selectedLeaseIds.has(lease.id)) {
        const value = finderAttemptResultSchema.parse({
          kind: "finder-attempt-result",
          schemaVersion: 1,
          attemptId: `${plan.runId}:cancelled:${index}`,
          leaseId: lease.id,
          status: "cancelled",
          reason: "campaign-finder-attempt-limit",
        });
        await dependencies.artifactStore.putJson(value);
        return { value, ref: finderResultRef(value) };
      }
      const focusArea = focusAreas.get(lease.focusAreaId);
      if (focusArea === undefined) {
        throw new Error(`Work Lease has no Focus Area: ${lease.id}`);
      }
      const attemptPlan = attemptPlanSchema.parse(
        await dependencies.attemptPlanMaterializer.materialize({
          run: {
            runId: plan.runId,
            finder: plan.finder,
            maxWallTimeMs: plan.budget.maxWallTimeMs,
            maxModelTokens: plan.budget.maxModelTokens,
          },
          targetSnapshot: preparation.input.targetSnapshot,
          surfaceMap,
          wave,
          focusArea,
          lease,
        }),
      );
      if (
        attemptPlan.leaseId !== lease.id ||
        attemptPlan.target.id !== preparation.input.targetSnapshot.id ||
        attemptPlan.target.digest !== preparation.input.targetSnapshot.digest ||
        attemptPlan.budget.maxWallTimeMs > lease.budget.maxWallTimeMs
      ) {
        throw new Error(`Attempt Plan is not bound to Work Lease: ${lease.id}`);
      }
      await dependencies.artifactStore.putJson(attemptPlan);
      const executed = await dependencies.modelExecution.run(attemptPlan);
      const value = finderAttemptResultSchema.parse(executed.value);
      const ref = attemptExecutionResultRefSchema.parse(executed.ref);
      const storedDigest = await dependencies.artifactStore.putJson(value);
      if (
        executed.status !== value.status ||
        ref.digest !== storedDigest ||
        ref.attemptId !== value.attemptId ||
        ref.leaseId !== value.leaseId ||
        value.leaseId !== lease.id
      ) {
        throw new Error(
          `Finder result is not bound to Work Lease: ${lease.id}`,
        );
      }
      return { value, ref };
    }),
  );
  terminalResults.sort((left, right) =>
    compareText(left.ref.leaseId, right.ref.leaseId),
  );

  const completedExploration = openExploration({
    surfaceMap: { ref: plan.surfaceMap, value: surfaceMap },
    policy: { ref: plan.explorationPolicy, value: policy },
    waveCompletion: {
      state: wave.state,
      wave: { ref: wave.ref, value: wave },
      results: terminalResults,
    },
  }).decide({
    kind: "wave-completed",
    map: plan.surfaceMap,
    state: wave.state,
    wave: wave.ref,
    results: terminalResults.map((result) => result.ref),
  });
  if (
    completedExploration.kind !== "verify" &&
    completedExploration.kind !== "blocked"
  ) {
    throw new Error(
      `Campaign Work Wave produced an invalid next phase: ${completedExploration.kind}`,
    );
  }

  const hypotheses = new Map<string, SourceBoundHypothesis>();
  for (const result of terminalResults) {
    if (result.value.status !== "completed") continue;
    for (const candidate of result.value.output.hypotheses) {
      hypotheses.set(sha256Digest(candidate), candidate);
    }
  }
  const verification = openVerification({
    record,
    artifactStore: dependencies.artifactStore,
    independentVerifier: dependencies.independentVerifier,
    labControl: dependencies.labControl,
  });
  const verificationRefs = [];
  if (completedExploration.kind === "verify") {
    for (const hypothesisRef of completedExploration.hypotheses) {
      const hypothesis = hypotheses.get(hypothesisRef.digest);
      if (hypothesis === undefined) {
        throw new Error(
          `Accepted Hypothesis artifact is missing: ${hypothesisRef.id}`,
        );
      }
      if (hypothesis.attackerPremise === "unresolved") continue;
      const verificationId = `verification:${hypothesisRef.id.slice("sha256:".length)}`;
      verificationRefs.push(
        await verification.verify({
          kind: "verification-plan",
          schemaVersion: 1,
          verificationId,
          campaignId: plan.campaignId,
          targetSnapshot: preparation.input.targetSnapshot,
          scope: { permittedAttacker: hypothesis.attackerPremise },
          hypothesis,
          hypothesisDigest: hypothesisRef.digest,
          labBaseline: plan.verification.labBaseline,
          verifierModelProfile: plan.verification.verifierModelProfile,
          promptSet: plan.verification.promptSet,
          verificationPolicy: plan.verification.verificationPolicy,
          experimentRegistry: plan.verification.experimentRegistry,
          budget: plan.budget.verification,
        }),
      );
    }
  }
  verificationRefs.sort((left, right) =>
    compareText(left.verificationId, right.verificationId),
  );
  const decision = iterationDecision(
    verificationRefs,
    completedExploration.kind,
  );
  return record.recordCampaignRunCompletion({
    kind: "campaign-run-completion",
    schemaVersion: 1,
    runId: plan.runId,
    campaignId: plan.campaignId,
    planDigest,
    workWave: wave.ref,
    attempts: terminalResults.map((result) => result.ref),
    verifications: verificationRefs,
    decision,
  });
}

export function openCampaignControl(
  record: ResearchRecord,
  dependencies?: CampaignExecutionDependencies,
): CampaignControl {
  return {
    runner: {
      prepare: async (input) => {
        const parsedInput = newCampaignInputSchema.parse(input);
        const result = await record.recordPreparation(parsedInput);
        if (
          result.disposition === "occupied" &&
          result.preparation.inputDigest !== result.requestedInputDigest
        ) {
          throw new CampaignPreparationConflictError(parsedInput.campaignId);
        }
        return projectCampaign(result.preparation);
      },
      run: async (value) => {
        const plan = campaignRunPlanSchema.parse(value);
        const start = await record.recordCampaignRunStart(plan);
        if (start.disposition === "completed") return start.run.ref;
        if (dependencies === undefined) {
          throw new Error("Campaign execution dependencies are unavailable");
        }
        return (await executeRun(record, dependencies, plan, start.planDigest))
          .ref;
      },
    },
    reader: {
      read: async (campaignId) => {
        const preparation = await record.readPreparation(campaignId);
        if (preparation === undefined) {
          throw new Error(`Campaign not found: ${campaignId}`);
        }
        return projectCampaign(preparation);
      },
      inspect: async (campaignId, subject): Promise<SubjectView> => {
        if (subject.kind === "run") {
          const run = await record.readCampaignRun(campaignId, subject.runId);
          if (run === undefined) {
            throw new Error(
              `Campaign run not found: ${campaignId}/${subject.runId}`,
            );
          }
          return {
            kind: "run",
            campaignId,
            runId: subject.runId,
            occurredAt: run.occurredAt,
            value: run.value,
          };
        }
        const preparation = await record.readPreparation(campaignId);
        if (preparation === undefined) {
          throw new Error(`Campaign not found: ${campaignId}`);
        }
        return {
          kind: subject.kind,
          campaignId,
          preparedAt: preparation.occurredAt,
          inputDigest: preparation.inputDigest,
          input: preparation.input,
        };
      },
    },
  };
}
