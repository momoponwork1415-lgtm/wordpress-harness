import { isAbsolute } from "node:path";

import { z } from "zod";

import { admitAgentRuntimeProfile } from "../infrastructure/agent-runtime-profile.js";
import {
  canonicalDigest,
  canonicalJson,
} from "../infrastructure/canonical-json.js";
import type {
  CampaignInput,
  ResearchCampaignView,
  ResearchCandidate,
} from "../research/index.js";
import { approvedTargetCampaignRequestSchema } from "../target-intelligence/approved-target-campaign/contracts.js";
import { admitApprovedTargetCampaign } from "../target-intelligence/approved-target-campaign/approved-target-campaigns.js";
import { deepSeekAccountReadinessObservationSchema } from "./deepseek-account-readiness.js";
import {
  defineIndependentResearchTrialBinding,
  defineIndependentResearchTrialComparisonRequest,
  type IndependentResearchTrialComparisonRequest,
} from "./independent-research-trial-comparison.js";

const digestSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/u);
const identifierSchema = z
  .string()
  .min(1)
  .max(160)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
const absolutePathSchema = z
  .string()
  .min(1)
  .refine((value) => isAbsolute(value), "Launch paths must be absolute");
const pinnedImageSchema = z
  .string()
  .regex(/^(?:[^\s@]+@)?sha256:[a-f0-9]{64}$/u);

const dependencySourceSchema = z.strictObject({
  mountName: z.string().regex(/^[a-z0-9][a-z0-9-]*$/u),
  directory: absolutePathSchema,
});

const independentResearchTrialLaunchPolicySchema = z.discriminatedUnion(
  "kind",
  [
    z.strictObject({ kind: z.literal("all-approved") }),
    z.strictObject({
      kind: z.literal("candidate-gated-followups"),
      initialTrialId: identifierSchema,
    }),
  ],
);

export const independentResearchTrialPlanSchema = z
  .strictObject({
    trialId: identifierSchema,
    approvedTargetCampaignRequest: approvedTargetCampaignRequestSchema,
    targetSourceDirectory: absolutePathSchema,
    dependencySources: z.array(dependencySourceSchema).max(16),
    databasePath: absolutePathSchema,
    scratchDirectory: absolutePathSchema,
    logPath: absolutePathSchema,
    image: pinnedImageSchema,
    providerConfigDirectory: absolutePathSchema,
    researchPromptPath: absolutePathSchema,
  })
  .superRefine((plan, context) => {
    let campaignInput: CampaignInput;
    try {
      campaignInput = admitApprovedTargetCampaign(
        plan.approvedTargetCampaignRequest,
      );
    } catch {
      context.addIssue({
        code: "custom",
        path: ["approvedTargetCampaignRequest"],
        message: "Independent Trial requires an admitted Target Campaign",
      });
      return;
    }
    if (
      campaignInput.agentRuntimeProfile.transportKind !==
      "deepseek-harness-native/v1"
    ) {
      context.addIssue({
        code: "custom",
        path: [
          "approvedTargetCampaignRequest",
          "campaignPolicy",
          "agentRuntimeProfile",
          "transportKind",
        ],
        message: "This launcher requires DeepSeek account readiness",
      });
    }
    if (
      admitAgentRuntimeProfile(campaignInput.agentRuntimeProfile, plan.image)
        .status !== "admitted"
    ) {
      context.addIssue({
        code: "custom",
        path: ["image"],
        message: "Trial image must match an admitted runtime profile",
      });
    }
    const expectedMounts = new Set(
      (campaignInput.dependencySnapshots ?? []).map(
        (dependency) => dependency.mountName,
      ),
    );
    const actualMounts = new Set(
      plan.dependencySources.map((dependency) => dependency.mountName),
    );
    if (
      actualMounts.size !== plan.dependencySources.length ||
      actualMounts.size !== expectedMounts.size ||
      [...actualMounts].some((mountName) => !expectedMounts.has(mountName))
    ) {
      context.addIssue({
        code: "custom",
        path: ["dependencySources"],
        message: "Trial dependency paths must match the Campaign input",
      });
    }
  });

export type IndependentResearchTrialPlan = z.infer<
  typeof independentResearchTrialPlanSchema
>;

export function campaignInputForIndependentResearchTrial(
  trial: IndependentResearchTrialPlan,
): CampaignInput {
  return admitApprovedTargetCampaign(trial.approvedTargetCampaignRequest);
}

const independentResearchTrialApprovalBodySchema = z
  .strictObject({
    kind: z.literal("independent-research-trial-approval"),
    schemaVersion: z.literal(3),
    approvalId: identifierSchema,
    approvedAt: z.iso.datetime(),
    expiresAt: z.iso.datetime(),
    maxReadinessAgeSeconds: z.number().int().positive().max(3_600),
    maxConcurrentTrials: z.number().int().positive().max(3),
    launchPolicy: independentResearchTrialLaunchPolicySchema,
    runtime: z.strictObject({
      nodeExecutablePath: absolutePathSchema,
      harnessCliPath: absolutePathSchema,
      dockerExecutablePath: absolutePathSchema,
    }),
    aggregateAllowance: z.strictObject({
      maxNativeRuns: z.number().int().positive(),
      maxWallTimeMs: z.number().int().positive(),
    }),
    trials: z.array(independentResearchTrialPlanSchema).min(1).max(100),
  })
  .superRefine((approval, context) => {
    if (Date.parse(approval.expiresAt) <= Date.parse(approval.approvedAt)) {
      context.addIssue({
        code: "custom",
        path: ["expiresAt"],
        message: "Independent Trial approval must expire after approval",
      });
    }
    const uniqueFields = [
      ["trialId", approval.trials.map((trial) => trial.trialId)],
      [
        "approvedTargetCampaignRequest.campaignId",
        approval.trials.map(
          (trial) => trial.approvedTargetCampaignRequest.campaignId,
        ),
      ],
      ["databasePath", approval.trials.map((trial) => trial.databasePath)],
      [
        "scratchDirectory",
        approval.trials.map((trial) => trial.scratchDirectory),
      ],
      ["logPath", approval.trials.map((trial) => trial.logPath)],
    ] as const;
    for (const [field, values] of uniqueFields) {
      if (new Set(values).size !== values.length) {
        context.addIssue({
          code: "custom",
          path: ["trials"],
          message: `Independent Trial ${field} values must be unique`,
        });
      }
    }
    if (
      new Set(approval.trials.map((trial) => trial.providerConfigDirectory))
        .size !== 1
    ) {
      context.addIssue({
        code: "custom",
        path: ["trials"],
        message:
          "Independent Trials sharing one account observation must share one provider config",
      });
    }
    if (approval.launchPolicy.kind === "candidate-gated-followups") {
      const initialTrialId = approval.launchPolicy.initialTrialId;
      if (approval.trials.length !== 3) {
        context.addIssue({
          code: "custom",
          path: ["trials"],
          message:
            "Candidate-gated production launch requires exactly three Trials",
        });
      }
      if (!approval.trials.some((trial) => trial.trialId === initialTrialId)) {
        context.addIssue({
          code: "custom",
          path: ["launchPolicy", "initialTrialId"],
          message: "Initial Trial must be present in the approved Trial set",
        });
      }
    }
    let bindingDigests: ReadonlySet<string>;
    try {
      bindingDigests = new Set(
        approval.trials.map(
          (trial) =>
            defineIndependentResearchTrialBinding(
              campaignInputForIndependentResearchTrial(trial),
            ).digest,
        ),
      );
    } catch {
      context.addIssue({
        code: "custom",
        path: ["trials"],
        message: "Independent Trials require fresh comparison bindings",
      });
      return;
    }
    if (bindingDigests.size !== 1) {
      context.addIssue({
        code: "custom",
        path: ["trials"],
        message: "Independent Trials must share one exact comparison binding",
      });
    }
  });

export const independentResearchTrialApprovalSchema =
  independentResearchTrialApprovalBodySchema
    .extend({ digest: digestSchema })
    .superRefine((approval, context) => {
      const { digest, ...body } = approval;
      if (digest !== canonicalDigest(body)) {
        context.addIssue({
          code: "custom",
          path: ["digest"],
          message: "Independent Trial approval digest mismatch",
        });
      }
    });

export type IndependentResearchTrialApproval = z.infer<
  typeof independentResearchTrialApprovalSchema
>;

export type IndependentResearchTrialApprovalDefinition = Omit<
  z.input<typeof independentResearchTrialApprovalBodySchema>,
  "kind" | "schemaVersion"
>;

export function defineIndependentResearchTrialApproval(
  definition: unknown,
): IndependentResearchTrialApproval {
  const fields = z.record(z.string(), z.unknown()).parse(definition);
  if (
    Object.hasOwn(fields, "kind") ||
    Object.hasOwn(fields, "schemaVersion") ||
    Object.hasOwn(fields, "digest")
  ) {
    throw new Error(
      "Independent Trial approval definition is not a sealed artifact",
    );
  }
  const body = independentResearchTrialApprovalBodySchema.parse({
    ...fields,
    kind: "independent-research-trial-approval",
    schemaVersion: 3,
  });
  return independentResearchTrialApprovalSchema.parse({
    ...body,
    digest: canonicalDigest(body),
  });
}

export function comparisonRequestForIndependentResearchTrialApproval(
  candidateApproval: IndependentResearchTrialApproval,
): IndependentResearchTrialComparisonRequest {
  const approval =
    independentResearchTrialApprovalSchema.parse(candidateApproval);
  const first = approval.trials[0];
  if (first === undefined) {
    throw new Error("Independent Trial approval has no Trials");
  }
  return defineIndependentResearchTrialComparisonRequest({
    comparisonId: approval.approvalId,
    trialCampaignIds: approval.trials.map(
      (trial) => trial.approvedTargetCampaignRequest.campaignId,
    ),
    expectedBinding: defineIndependentResearchTrialBinding(
      campaignInputForIndependentResearchTrial(first),
    ),
  });
}

const independentResearchTrialGateObservationBodySchema = z
  .strictObject({
    kind: z.literal("independent-research-trial-gate-observation"),
    schemaVersion: z.literal(1),
    approvalId: identifierSchema,
    approvalDigest: digestSchema,
    initialTrialId: identifierSchema,
    campaignId: identifierSchema,
    campaignInputDigest: digestSchema,
    state: z.enum([
      "model-completed-with-candidates",
      "model-completed-without-candidates",
      "incomplete",
    ]),
    candidateRecordCount: z.number().int().nonnegative(),
    campaignViewDigest: digestSchema,
  })
  .superRefine((observation, context) => {
    const hasCandidates = observation.candidateRecordCount > 0;
    if (
      observation.state !== "incomplete" &&
      (observation.state === "model-completed-with-candidates") !==
        hasCandidates
    ) {
      context.addIssue({
        code: "custom",
        path: ["candidateRecordCount"],
        message: "Gate state must match Candidate presence",
      });
    }
  });

export const independentResearchTrialGateObservationSchema =
  independentResearchTrialGateObservationBodySchema
    .extend({ digest: digestSchema })
    .superRefine((observation, context) => {
      const { digest, ...body } = observation;
      if (digest !== canonicalDigest(body)) {
        context.addIssue({
          code: "custom",
          path: ["digest"],
          message: "Independent Trial gate observation digest mismatch",
        });
      }
    });

export type IndependentResearchTrialGateObservation = z.infer<
  typeof independentResearchTrialGateObservationSchema
>;

export function defineIndependentResearchTrialGateObservation(
  definition: Omit<
    z.input<typeof independentResearchTrialGateObservationBodySchema>,
    "kind" | "schemaVersion"
  >,
): IndependentResearchTrialGateObservation {
  const body = independentResearchTrialGateObservationBodySchema.parse({
    kind: "independent-research-trial-gate-observation",
    schemaVersion: 1,
    ...definition,
  });
  return independentResearchTrialGateObservationSchema.parse({
    ...body,
    digest: canonicalDigest(body),
  });
}

function candidateRecordCount(view: ResearchCampaignView): number {
  const candidates = new Map<string, ResearchCandidate>();
  for (const receipt of view.nativeRuns) {
    if (receipt.terminal !== "completed") continue;
    for (const candidate of receipt.report.candidates) {
      const prior = candidates.get(candidate.candidateId);
      if (
        prior !== undefined &&
        canonicalJson(prior) !== canonicalJson(candidate)
      ) {
        throw new Error(
          `Research Candidate identity conflict in gate observation: ${candidate.candidateId}`,
        );
      }
      candidates.set(candidate.candidateId, candidate);
    }
  }
  return candidates.size;
}

function initialTrialModelCompleted(view: ResearchCampaignView): boolean {
  return (
    view.status !== "research-continues" &&
    view.status !== "incomplete" &&
    view.nativeRuns.length > 0 &&
    view.nativeRuns.every((receipt) => receipt.terminal === "completed") &&
    view.nativeRunAttempts.every((attempt) => attempt.status === "terminal")
  );
}

export function observeIndependentResearchTrialGate(input: {
  readonly approval: IndependentResearchTrialApproval;
  readonly campaignView: ResearchCampaignView;
}): IndependentResearchTrialGateObservation {
  const approval = independentResearchTrialApprovalSchema.parse(input.approval);
  if (approval.launchPolicy.kind !== "candidate-gated-followups") {
    throw new Error("All-at-once Trial approvals do not have a stage gate");
  }
  const initialTrialId = approval.launchPolicy.initialTrialId;
  const initialTrial = approval.trials.find(
    (trial) => trial.trialId === initialTrialId,
  );
  if (initialTrial === undefined) {
    throw new Error("Initial Trial is absent from the approval");
  }
  const expectedInput = campaignInputForIndependentResearchTrial(initialTrial);
  const view = input.campaignView;
  if (
    view.campaignId !== expectedInput.campaignId ||
    view.inputDigest !== canonicalDigest(view.input) ||
    canonicalJson(view.input) !== canonicalJson(expectedInput)
  ) {
    throw new Error("Initial Trial Campaign view does not match approval");
  }
  const count = candidateRecordCount(view);
  const state = !initialTrialModelCompleted(view)
    ? "incomplete"
    : count > 0
      ? "model-completed-with-candidates"
      : "model-completed-without-candidates";
  return defineIndependentResearchTrialGateObservation({
    approvalId: approval.approvalId,
    approvalDigest: approval.digest,
    initialTrialId: initialTrial.trialId,
    campaignId: expectedInput.campaignId,
    campaignInputDigest: canonicalDigest(expectedInput),
    state,
    candidateRecordCount: count,
    campaignViewDigest: canonicalDigest(view),
  });
}

const independentResearchTrialReadinessBodySchema = z.strictObject({
  kind: z.literal("independent-research-trial-readiness"),
  schemaVersion: z.literal(1),
  approvalId: identifierSchema,
  approvalDigest: digestSchema,
  trialId: identifierSchema,
  campaignId: identifierSchema,
  campaignInputDigest: digestSchema,
  checkedAt: z.iso.datetime(),
  status: z.enum(["ready", "blocked", "unknown"]),
  reason: z.string().min(1).max(256),
});

export const independentResearchTrialReadinessSchema =
  independentResearchTrialReadinessBodySchema
    .extend({ digest: digestSchema })
    .superRefine((readiness, context) => {
      const { digest, ...body } = readiness;
      if (digest !== canonicalDigest(body)) {
        context.addIssue({
          code: "custom",
          path: ["digest"],
          message: "Independent Trial readiness digest mismatch",
        });
      }
    });

export type IndependentResearchTrialReadiness = z.infer<
  typeof independentResearchTrialReadinessSchema
>;

export function defineIndependentResearchTrialReadiness(
  definition: Omit<
    z.input<typeof independentResearchTrialReadinessBodySchema>,
    "kind" | "schemaVersion"
  >,
): IndependentResearchTrialReadiness {
  const body = independentResearchTrialReadinessBodySchema.parse({
    kind: "independent-research-trial-readiness",
    schemaVersion: 1,
    ...definition,
  });
  return independentResearchTrialReadinessSchema.parse({
    ...body,
    digest: canonicalDigest(body),
  });
}

const independentResearchTrialClaimBodySchema = z.strictObject({
  kind: z.literal("independent-research-trial-claim"),
  schemaVersion: z.literal(2),
  approvalId: identifierSchema,
  approvalDigest: digestSchema,
  trialId: identifierSchema,
  campaignId: identifierSchema,
  campaignInputDigest: digestSchema,
  accountReadinessDigest: digestSchema,
  trialReadinessDigest: digestSchema,
  gateObservationDigest: digestSchema.nullable(),
  reservedNativeRuns: z.number().int().positive(),
  reservedWallTimeMs: z.number().int().positive(),
  claimedAt: z.iso.datetime(),
});

export const independentResearchTrialClaimSchema =
  independentResearchTrialClaimBodySchema
    .extend({ digest: digestSchema })
    .superRefine((claim, context) => {
      const { digest, ...body } = claim;
      if (digest !== canonicalDigest(body)) {
        context.addIssue({
          code: "custom",
          path: ["digest"],
          message: "Independent Trial claim digest mismatch",
        });
      }
    });

export type IndependentResearchTrialClaim = z.infer<
  typeof independentResearchTrialClaimSchema
>;

export interface IndependentResearchTrialClaimState {
  readonly claim: IndependentResearchTrialClaim;
  readonly active: boolean;
}

export type IndependentResearchTrialLaunchDecisionReason =
  | "launch-approved"
  | "all-trials-claimed"
  | "approval-not-yet-valid"
  | "approval-expired"
  | "account-readiness-missing"
  | "account-readiness-stale"
  | "account-credential-unavailable"
  | "account-unauthenticated"
  | "account-quota-exhausted"
  | "account-rate-limited"
  | "account-readiness-unavailable"
  | "trial-readiness-blocked"
  | "dispatch-lock-unavailable"
  | "concurrency-ceiling-reached"
  | "aggregate-allowance-exhausted"
  | "initial-trial-running"
  | "initial-trial-result-unavailable"
  | "initial-trial-incomplete"
  | "initial-trial-no-candidates";

export interface IndependentResearchTrialLaunchDecision {
  readonly kind: "independent-research-trial-launch-decision";
  readonly approvalId: string;
  readonly approvalDigest: string;
  readonly accountReadinessDigest: string | null;
  readonly gateObservationDigest: string | null;
  readonly selectedTrialIds: readonly string[];
  readonly claimedTrialIds: readonly string[];
  readonly activeClaims: number;
  readonly remainingNativeRuns: number;
  readonly remainingWallTimeMs: number;
  readonly reason: IndependentResearchTrialLaunchDecisionReason;
}

function noLaunch(
  approval: IndependentResearchTrialApproval,
  state: {
    readonly readinessDigest: string | null;
    readonly gateObservationDigest: string | null;
    readonly claimedTrialIds: readonly string[];
    readonly activeClaims: number;
    readonly remainingNativeRuns: number;
    readonly remainingWallTimeMs: number;
  },
  reason: IndependentResearchTrialLaunchDecisionReason,
): IndependentResearchTrialLaunchDecision {
  return {
    kind: "independent-research-trial-launch-decision",
    approvalId: approval.approvalId,
    approvalDigest: approval.digest,
    accountReadinessDigest: state.readinessDigest,
    gateObservationDigest: state.gateObservationDigest,
    selectedTrialIds: [],
    claimedTrialIds: state.claimedTrialIds,
    activeClaims: state.activeClaims,
    remainingNativeRuns: state.remainingNativeRuns,
    remainingWallTimeMs: state.remainingWallTimeMs,
    reason,
  };
}

function accountFailureReason(
  status: Exclude<
    z.infer<typeof deepSeekAccountReadinessObservationSchema>["status"],
    "ready"
  >,
): IndependentResearchTrialLaunchDecisionReason {
  switch (status) {
    case "credential-unavailable":
      return "account-credential-unavailable";
    case "unauthenticated":
      return "account-unauthenticated";
    case "quota-exhausted":
      return "account-quota-exhausted";
    case "rate-limited":
      return "account-rate-limited";
    case "timeout":
    case "unavailable":
    case "invalid-response":
      return "account-readiness-unavailable";
  }
}

export function decideIndependentResearchTrialLaunches(input: {
  readonly approval: IndependentResearchTrialApproval;
  readonly accountReadiness:
    z.infer<typeof deepSeekAccountReadinessObservationSchema> | undefined;
  readonly claims: readonly IndependentResearchTrialClaimState[];
  readonly gateObservation?: IndependentResearchTrialGateObservation;
  readonly unlaunchableTrialIds?: ReadonlySet<string>;
  readonly now: string;
}): IndependentResearchTrialLaunchDecision {
  const approval = independentResearchTrialApprovalSchema.parse(input.approval);
  const now = z.iso.datetime().parse(input.now);
  const trialsById = new Map(
    approval.trials.map((trial) => [trial.trialId, trial]),
  );
  const claims = input.claims.map((state) => ({
    claim: independentResearchTrialClaimSchema.parse(state.claim),
    active: state.active,
  }));
  const claimedIds = new Set<string>();
  let reservedNativeRuns = 0;
  let reservedWallTimeMs = 0;
  for (const state of claims) {
    const claim = state.claim;
    const trial = trialsById.get(claim.trialId);
    if (
      claimedIds.has(claim.trialId) ||
      claim.approvalId !== approval.approvalId ||
      claim.approvalDigest !== approval.digest ||
      trial === undefined ||
      claim.campaignId !== trial.approvedTargetCampaignRequest.campaignId ||
      claim.campaignInputDigest !==
        canonicalDigest(campaignInputForIndependentResearchTrial(trial)) ||
      claim.reservedNativeRuns !==
        trial.approvedTargetCampaignRequest.campaignPolicy.budgetEnvelope
          .maxNativeRuns ||
      claim.reservedWallTimeMs !==
        trial.approvedTargetCampaignRequest.campaignPolicy.budgetEnvelope
          .maxWallTimeMs
    ) {
      throw new Error("Independent Trial claim does not match approval");
    }
    claimedIds.add(claim.trialId);
    reservedNativeRuns += claim.reservedNativeRuns;
    reservedWallTimeMs += claim.reservedWallTimeMs;
  }
  const claimedTrialIds = approval.trials
    .filter((trial) => claimedIds.has(trial.trialId))
    .map((trial) => trial.trialId);
  const activeClaims = claims.filter((state) => state.active).length;
  const remainingNativeRuns =
    approval.aggregateAllowance.maxNativeRuns - reservedNativeRuns;
  const remainingWallTimeMs =
    approval.aggregateAllowance.maxWallTimeMs - reservedWallTimeMs;
  if (remainingNativeRuns < 0 || remainingWallTimeMs < 0) {
    throw new Error("Independent Trial claims exceed aggregate allowance");
  }
  const readiness =
    input.accountReadiness === undefined
      ? undefined
      : deepSeekAccountReadinessObservationSchema.parse(input.accountReadiness);
  const gateObservation =
    input.gateObservation === undefined
      ? undefined
      : independentResearchTrialGateObservationSchema.parse(
          input.gateObservation,
        );
  if (approval.launchPolicy.kind === "all-approved") {
    if (
      gateObservation !== undefined ||
      claims.some(
        (claimState) => claimState.claim.gateObservationDigest !== null,
      )
    ) {
      throw new Error("All-at-once Trials must not bind a stage gate");
    }
  } else {
    const initialTrialId = approval.launchPolicy.initialTrialId;
    const initialClaim = claims.find(
      (claimState) => claimState.claim.trialId === initialTrialId,
    );
    const followUpClaims = claims.filter(
      (claimState) => claimState.claim.trialId !== initialTrialId,
    );
    if (initialClaim === undefined && followUpClaims.length > 0) {
      throw new Error("Follow-up Trial was claimed before the initial Trial");
    }
    if (
      initialClaim !== undefined &&
      initialClaim.claim.gateObservationDigest !== null
    ) {
      throw new Error("Initial Trial claim must not bind a stage gate");
    }
    if (
      followUpClaims.some(
        (claimState) => claimState.claim.gateObservationDigest === null,
      ) ||
      new Set(
        followUpClaims.map(
          (claimState) => claimState.claim.gateObservationDigest,
        ),
      ).size > 1
    ) {
      throw new Error("Follow-up Trial claims must bind one stage gate");
    }
  }
  const state = {
    readinessDigest: readiness?.digest ?? null,
    gateObservationDigest: gateObservation?.digest ?? null,
    claimedTrialIds,
    activeClaims,
    remainingNativeRuns,
    remainingWallTimeMs,
  };
  if (claimedIds.size === approval.trials.length) {
    return noLaunch(approval, state, "all-trials-claimed");
  }
  const nowMs = Date.parse(now);
  if (nowMs < Date.parse(approval.approvedAt)) {
    return noLaunch(approval, state, "approval-not-yet-valid");
  }
  if (nowMs >= Date.parse(approval.expiresAt)) {
    return noLaunch(approval, state, "approval-expired");
  }
  if (readiness === undefined) {
    return noLaunch(approval, state, "account-readiness-missing");
  }
  const readinessAgeMs = nowMs - Date.parse(readiness.observedAt);
  if (
    readinessAgeMs < 0 ||
    readinessAgeMs > approval.maxReadinessAgeSeconds * 1_000
  ) {
    return noLaunch(approval, state, "account-readiness-stale");
  }
  if (readiness.status !== "ready") {
    return noLaunch(approval, state, accountFailureReason(readiness.status));
  }

  let stageEligibleTrialIds: ReadonlySet<string> | undefined;
  if (approval.launchPolicy.kind === "candidate-gated-followups") {
    const initialTrialId = approval.launchPolicy.initialTrialId;
    const initialClaim = claims.find(
      (claimState) => claimState.claim.trialId === initialTrialId,
    );
    if (initialClaim === undefined) {
      if (claims.length > 0) {
        throw new Error("Follow-up Trial was claimed before the initial Trial");
      }
      stageEligibleTrialIds = new Set([initialTrialId]);
    } else {
      if (initialClaim.claim.gateObservationDigest !== null) {
        throw new Error("Initial Trial claim must not bind a gate observation");
      }
      if (initialClaim.active) {
        return noLaunch(approval, state, "initial-trial-running");
      }
      if (gateObservation === undefined) {
        return noLaunch(approval, state, "initial-trial-result-unavailable");
      }
      const initialTrial = trialsById.get(initialTrialId);
      if (
        initialTrial === undefined ||
        gateObservation.approvalId !== approval.approvalId ||
        gateObservation.approvalDigest !== approval.digest ||
        gateObservation.initialTrialId !== initialTrialId ||
        gateObservation.campaignId !==
          initialTrial.approvedTargetCampaignRequest.campaignId ||
        gateObservation.campaignInputDigest !==
          canonicalDigest(
            campaignInputForIndependentResearchTrial(initialTrial),
          )
      ) {
        throw new Error(
          "Initial Trial gate observation does not match approval",
        );
      }
      for (const claimState of claims) {
        if (
          claimState.claim.trialId !== initialTrialId &&
          claimState.claim.gateObservationDigest !== gateObservation.digest
        ) {
          throw new Error(
            "Follow-up Trial claim does not match the stage gate",
          );
        }
      }
      if (gateObservation.state === "incomplete") {
        return noLaunch(approval, state, "initial-trial-incomplete");
      }
      if (gateObservation.state === "model-completed-without-candidates") {
        return noLaunch(approval, state, "initial-trial-no-candidates");
      }
      stageEligibleTrialIds = new Set(
        approval.trials
          .filter((trial) => trial.trialId !== initialTrialId)
          .map((trial) => trial.trialId),
      );
    }
  }
  const processSlots = approval.maxConcurrentTrials - activeClaims;
  if (processSlots <= 0) {
    return noLaunch(approval, state, "concurrency-ceiling-reached");
  }
  let availableNativeRuns = remainingNativeRuns;
  let availableWallTimeMs = remainingWallTimeMs;
  const selectedTrialIds: string[] = [];
  for (const trial of approval.trials) {
    if (
      claimedIds.has(trial.trialId) ||
      (stageEligibleTrialIds !== undefined &&
        !stageEligibleTrialIds.has(trial.trialId)) ||
      input.unlaunchableTrialIds?.has(trial.trialId) === true
    ) {
      continue;
    }
    const budget =
      trial.approvedTargetCampaignRequest.campaignPolicy.budgetEnvelope;
    if (
      budget.maxNativeRuns > availableNativeRuns ||
      budget.maxWallTimeMs > availableWallTimeMs
    ) {
      continue;
    }
    selectedTrialIds.push(trial.trialId);
    availableNativeRuns -= budget.maxNativeRuns;
    availableWallTimeMs -= budget.maxWallTimeMs;
    if (selectedTrialIds.length === processSlots) break;
  }
  if (selectedTrialIds.length === 0) {
    const hasReadinessEligibleTrial = approval.trials.some(
      (trial) =>
        !claimedIds.has(trial.trialId) &&
        (stageEligibleTrialIds === undefined ||
          stageEligibleTrialIds.has(trial.trialId)) &&
        input.unlaunchableTrialIds?.has(trial.trialId) !== true,
    );
    if (!hasReadinessEligibleTrial) {
      return noLaunch(approval, state, "trial-readiness-blocked");
    }
    return noLaunch(approval, state, "aggregate-allowance-exhausted");
  }
  return {
    kind: "independent-research-trial-launch-decision",
    approvalId: approval.approvalId,
    approvalDigest: approval.digest,
    accountReadinessDigest: readiness.digest,
    gateObservationDigest: gateObservation?.digest ?? null,
    selectedTrialIds,
    claimedTrialIds,
    activeClaims,
    remainingNativeRuns,
    remainingWallTimeMs,
    reason: "launch-approved",
  };
}
