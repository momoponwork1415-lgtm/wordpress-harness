import type { TargetSnapshotRef } from "../contracts.js";
import type { OracleFreeTargetMetadata } from "../exploration/semantic-contracts.js";
import { sha256Digest } from "../research-record/canonical-json.js";
import type { JsonArtifactStore } from "../research-record/contracts.js";
import type { TargetFileManifestRef } from "../source-mapping/contracts.js";
import type {
  SourceToolPolicy,
  SourceToolPolicyRef,
} from "../source-mapping/source-evidence-contracts.js";
import {
  campaignDefaultSemanticRunPlanV3Schema,
  defineCurrentSemanticRootPlanningPolicy,
  type DefaultSemanticCampaignRunPlanV3,
} from "./contracts.js";
import {
  bindCurrentSemanticCampaignConfiguration,
  currentModelProfileFamily,
  currentSemanticCampaignConfigurationMatches,
  type CurrentSemanticModelFamily,
} from "./current-semantic-campaign-bindings.js";

const MEBIBYTE = 1024 * 1024;
const GIBIBYTE = 1024 * MEBIBYTE;

/**
 * Raised when the built plan does not satisfy
 * `currentSemanticCampaignConfigurationMatches`, or when a configuration
 * document does not store under the digest the plan names. Both are factory
 * defects rather than caller errors, so they are refused here instead of
 * surfacing from the middle of a run as an Attempt-level mismatch.
 */
export class CurrentSemanticCampaignPlanIntegrityError extends Error {
  readonly reason:
    "configuration-not-current" | "configuration-artifact-digest-mismatch";

  constructor(
    reason: CurrentSemanticCampaignPlanIntegrityError["reason"],
    family: CurrentSemanticModelFamily,
  ) {
    super(`Current Semantic Campaign plan is not admissible: ${reason}`);
    this.name = "CurrentSemanticCampaignPlanIntegrityError";
    this.reason = reason;
    this.family = family;
  }

  readonly family: CurrentSemanticModelFamily;
}

export interface CurrentSemanticCampaignPlanInput {
  readonly family: CurrentSemanticModelFamily;
  readonly campaignId: string;
  readonly runId: string;
  /** `inputDigest` of the Campaign Preparation this run is bound to. */
  readonly preparationDigest: string;
  readonly target: TargetSnapshotRef;
  readonly manifest: TargetFileManifestRef;
  readonly metadata: OracleFreeTargetMetadata;
}

export interface CurrentSemanticCampaignPlan {
  readonly plan: DefaultSemanticCampaignRunPlanV3;
  /**
   * The Source Tool Policy the plan names by digest. The Source Evidence
   * Gateway needs the value, not only the reference, so it is returned rather
   * than left for the caller to rebuild.
   */
  readonly sourceToolPolicy: SourceToolPolicy;
  readonly sourceToolPolicyRef: SourceToolPolicyRef;
}

function transportEligibilityReceipt(family: CurrentSemanticModelFamily) {
  const definition = currentModelProfileFamily(family);
  return {
    kind: "transport-eligibility-receipt",
    schemaVersion: 1,
    transport: definition.eligibility.transport,
    executableVersion: definition.execution.executableVersion,
    authMethod: definition.eligibility.authMethod,
    model: definition.execution.model,
    controls: [
      "restricted",
      "built-in-tools-empty",
      "attempt-local-source-evidence-mcp",
      "no-web",
      "no-subagents",
      "no-session-persistence",
      "strict-mcp",
      "attempt-provider-cost-ceiling",
      "reported-turn-token-telemetry",
    ],
  } as const;
}

function promptSetRef() {
  const identity = {
    kind: "prompt-set",
    schemaVersion: 1,
    id: "semantic-research-source-screen-v6r3",
    roles: [
      "root-planner",
      "finder",
      "root-evaluator",
      "root-synthesizer",
      "adversarial-critic",
      "validator",
    ],
  } as const;
  return {
    kind: "prompt-set",
    schemaVersion: 1,
    id: identity.id,
    digest: sha256Digest(identity),
  } as const;
}

/**
 * Binds the Source Tool Policy to one Target Snapshot. The Source Evidence
 * Gateway compares this digest against the snapshot an Attempt names, so a
 * policy minted for one Target cannot be replayed against another. Derived
 * from the plan's own target rather than taken as a separate argument -- the
 * source tree digest is a different digest of the same Target, and passing it
 * here produces a policy the Gateway refuses.
 */
function sourceToolPolicyFor(targetSnapshotDigest: string): SourceToolPolicy {
  return {
    kind: "source-tool-policy",
    schemaVersion: 1,
    id: "prospective-source-only-v1",
    targetSnapshotDigest,
    operations: {
      read: { maxResponseBytes: 128 * 1024 },
      inventory: { maxResults: 4_096 },
      search: { maxScanBytes: 512 * MEBIBYTE, maxResults: 512 },
    },
  };
}

function validationPolicyRef() {
  const identity = {
    kind: "source-validation-policy",
    schemaVersion: 2,
    id: "single-source-validation-v2",
    independentAttempt: true,
    validators: 1,
    findingPromotion: "source-validated",
  } as const;
  return { id: identity.id, digest: sha256Digest(identity) } as const;
}

function runtimeProfileRef() {
  const identity = {
    kind: "runtime-profile-intent",
    schemaVersion: 1,
    wordpress: "latest-compatible-pinned-at-runtime",
    php: "plugin-supported",
    database: "mariadb",
    isolation: "gvisor-runsc-required",
  } as const;
  return {
    id: "wordpress-php-mariadb-gvisor-prospective-v1",
    digest: sha256Digest(identity),
  } as const;
}

function experimentRegistryRef() {
  const identity = {
    kind: "experiment-registry",
    schemaVersion: 2,
    owner: "human-os",
    admission: "all-ready-for-runtime",
  } as const;
  return {
    id: "human-os-runtime-reproduction-v2",
    digest: sha256Digest(identity),
  } as const;
}

/**
 * The execution identity one family runs under: the transport receipt its
 * Attempts name, the prompt set, and the four role Model Profiles.
 *
 * Preparation and run must agree on every one of these -- a Campaign Run is
 * refused when its plan names a prompt set, profile or budget the recorded
 * Preparation did not. Both halves therefore derive from this one function
 * rather than being stated twice.
 */
function familyConfiguration(family: CurrentSemanticModelFamily) {
  const definition = currentModelProfileFamily(family);
  const eligibilityReceipt = transportEligibilityReceipt(family);
  const execution = {
    provider: definition.execution.provider,
    model: definition.execution.model,
    transport: definition.execution.transport,
    executableVersion: definition.execution.executableVersion,
    effort: definition.execution.effort,
    eligibilityReceiptDigest: sha256Digest(eligibilityReceipt),
  };
  const modelProfile = (
    role: "root-planner" | "finder" | "root-evaluator" | "validator",
    id: string,
  ) => ({
    ref: {
      kind: "model-profile" as const,
      schemaVersion: 1 as const,
      id,
      family: definition.family,
      digest: sha256Digest({
        kind: `${definition.family}-model-profile`,
        schemaVersion: 1,
        role,
        execution,
      }),
    },
    execution,
  });
  return {
    definition,
    eligibilityReceipt,
    execution,
    promptSet: promptSetRef(),
    profiles: {
      planner: modelProfile("root-planner", definition.profileIds.planner),
      finder: modelProfile("finder", definition.profileIds.finder),
      evaluator: modelProfile(
        "root-evaluator",
        definition.profileIds.evaluator,
      ),
      validator: modelProfile("validator", definition.profileIds.validator),
    },
  };
}

export interface CurrentSemanticCampaignPreparationConfiguration {
  readonly promptSet: { readonly id: string; readonly digest: string };
  /** Mutable arrays: the prepare seam's decoder takes them by value. */
  readonly modelProfiles: { id: string; digest: string }[];
  readonly runtimeProfile: { readonly id: string; readonly digest: string };
  readonly experimentRegistry: {
    readonly id: string;
    readonly digest: string;
  };
  readonly knowledgeCapsules: { id: string; digest: string }[];
  readonly budget: {
    readonly maxAttempts: number;
    readonly maxWallTimeMs: number;
    readonly maxModelTokens: number;
  };
}

/**
 * The half of the current configuration a Campaign Preparation records.
 *
 * `prepareFromTargetIntake` binds the prompt set, Model Profiles, runtime
 * profile, experiment registry and campaign budget; a later run whose plan
 * disagrees with any of them is refused as a run conflict. Callers of the
 * prepare seam take these values from here so the plan the factory later
 * builds is admissible against what they recorded.
 */
export function currentSemanticCampaignPreparationConfiguration(
  family: CurrentSemanticModelFamily,
): CurrentSemanticCampaignPreparationConfiguration {
  const configuration = familyConfiguration(family);
  const policy = budgetPolicyV7();
  return {
    promptSet: {
      id: configuration.promptSet.id,
      digest: configuration.promptSet.digest,
    },
    modelProfiles: Object.values(configuration.profiles).map(({ ref }) => ({
      id: ref.id,
      digest: ref.digest,
    })),
    runtimeProfile: runtimeProfileRef(),
    experimentRegistry: experimentRegistryRef(),
    knowledgeCapsules: [],
    budget: {
      maxAttempts: policy.maxModelAttempts,
      maxWallTimeMs: policy.maxWallTimeMs,
      maxModelTokens: policy.maxModelTokens,
    },
  };
}

/**
 * Role budgets. `reportedUsageEnforcement: "telemetry-only"` says the token and
 * turn counts a provider reports are recorded but do not terminate an Attempt;
 * only the provider cost ceiling does. Overshoot against
 * `budgetPolicy.maxModelTokens` is therefore a reported postcondition of a run,
 * not a defect in it.
 */
function roleBudgets() {
  const model = {
    maxWallTimeMs: 3_600_000,
    maxModelTokens: 100_000,
    maxModelTurns: 128,
    maxProviderCostUsd: 10,
    maxOutputBytes: 2 * MEBIBYTE,
    reportedUsageEnforcement: "telemetry-only",
  } as const;
  const source = {
    ...model,
    maxSourceQueries: 256,
    maxSourceScanBytes: 16 * GIBIBYTE,
    maxSourceResponseBytes: 256 * MEBIBYTE,
    sourceLimitTerminalOutput: "preserve",
  } as const;
  return {
    model,
    planner: source,
    finder: {
      ...source,
      maxWallTimeMs: 10_800_000,
      maxModelTokens: 1_000_000,
      maxModelTurns: 256,
      maxProviderCostUsd: 20,
      maxHypotheses: 8,
      maxSourceQueries: 512,
    },
    validator: {
      ...source,
      maxWallTimeMs: 1_800_000,
      maxModelTokens: 100_000,
      maxModelTurns: 64,
      maxProviderCostUsd: 7.5,
      maxSourceQueries: 128,
    },
  } as const;
}

function budgetPolicyV7() {
  return {
    kind: "semantic-research-budget",
    schemaVersion: 3,
    id: "semantic-research-recall-baseline-v7",
    maxWorkWaves: 12,
    maxFinderAttempts: 48,
    maxConcurrentFinders: 4,
    maxModelAttempts: 128,
    maxModelTokens: 4_600_000,
    maxProviderCostUsd: 150,
    maxWallTimeMs: 43_200_000,
    reportedUsageEnforcement: "telemetry-only",
    exploration: {
      maxModelTokens: 4_200_000,
      maxProviderCostUsd: 120,
      maxWallTimeMs: 36_000_000,
      rootEvaluationReserve: {
        maxModelTokens: 100_000,
        owner: "exploration",
        role: "root-evaluator",
      },
    },
    validationReserve: {
      maxModelTokens: 400_000,
      maxProviderCostUsd: 30,
      maxWallTimeMs: 7_200_000,
    },
  } as const;
}

/**
 * Build the plan a current-configuration Campaign runs, and store the two
 * configuration documents its digests name.
 *
 * The digests are the whole point of the store: an Attempt Plan carries the
 * Transport Eligibility Receipt digest and the Source Tool Policy digest, and
 * Model Execution refuses an Attempt whose documents it cannot read back. A
 * plan whose configuration is not in the store is therefore a plan that cannot
 * run, so building and storing are one operation rather than two the caller
 * must remember to order.
 */
export async function prepareCurrentSemanticCampaignPlan(
  artifactStore: JsonArtifactStore,
  input: CurrentSemanticCampaignPlanInput,
): Promise<CurrentSemanticCampaignPlan> {
  const { eligibilityReceipt, execution, promptSet, profiles } =
    familyConfiguration(input.family);
  const sourceToolPolicy = sourceToolPolicyFor(input.target.digest);
  const sourceToolPolicyRef: SourceToolPolicyRef = {
    kind: "source-tool-policy",
    schemaVersion: 1,
    id: sourceToolPolicy.id,
    digest: sha256Digest(sourceToolPolicy),
  };

  const budgets = roleBudgets();
  const bindingSource = {
    semanticPolicy: defineCurrentSemanticRootPlanningPolicy({
      plannerBudget: budgets.planner,
      finderLeaseBudget: budgets.finder,
    }),
    planner: {
      modelProfile: profiles.planner,
      promptSet,
      sourceToolPolicy: sourceToolPolicyRef,
    },
    finder: {
      modelProfile: profiles.finder,
      promptSet,
      selectedKnowledge: [],
      sourceToolPolicy: sourceToolPolicyRef,
    },
    evaluator: {
      modelProfile: profiles.evaluator,
      promptSet,
      budget: budgets.model,
    },
    validation: {
      wordpressBaseline: {
        id: "wordpress-plugin-security-semantics-v1",
        digest: sha256Digest({
          kind: "wordpress-security-baseline",
          schemaVersion: 1,
          trustBoundaries: "standard-wordpress-roles-and-public-requests",
        }),
      },
      validationPolicy: validationPolicyRef(),
      promptSet,
      validatorModelProfile: profiles.validator,
      sourceToolPolicy: sourceToolPolicyRef,
      publicSurface: [
        "Unauthenticated and low-privileged local WordPress plugin interactions",
      ],
      technicalExclusions: [
        "Remote vendor services not executed by the local plugin source",
      ],
      budget: { validator: budgets.validator },
    },
  };

  const plan = campaignDefaultSemanticRunPlanV3Schema.parse({
    kind: "campaign-run-plan",
    schemaVersion: 3,
    runId: input.runId,
    campaignId: input.campaignId,
    preparationDigest: input.preparationDigest,
    target: input.target,
    manifest: input.manifest,
    metadata: input.metadata,
    ...bindingSource,
    bindings: bindCurrentSemanticCampaignConfiguration(bindingSource),
    budgetPolicy: budgetPolicyV7(),
  });

  // Second opinion, deliberately kept independent: the admission check states
  // the same budgets and identities as literals rather than reading them from
  // here, so a factory that drifts is refused rather than admitted.
  if (!currentSemanticCampaignConfigurationMatches(plan)) {
    throw new CurrentSemanticCampaignPlanIntegrityError(
      "configuration-not-current",
      input.family,
    );
  }

  const [storedReceiptDigest, storedPolicyDigest] = await Promise.all([
    artifactStore.putJson(eligibilityReceipt),
    artifactStore.putJson(sourceToolPolicy),
  ]);
  if (
    storedReceiptDigest !== execution.eligibilityReceiptDigest ||
    storedPolicyDigest !== sourceToolPolicyRef.digest
  ) {
    throw new CurrentSemanticCampaignPlanIntegrityError(
      "configuration-artifact-digest-mismatch",
      input.family,
    );
  }

  return { plan, sourceToolPolicy, sourceToolPolicyRef };
}

export { runtimeProfileRef as currentSemanticRuntimeProfileRef };
