import { describe, expect, it } from "vitest";

import type {
  AttemptPlanV2,
  ModelAttemptPlan,
  ModelExecution,
} from "../../src/research/model-execution/index.js";
import { sha256Digest } from "../../src/research/research-record/canonical-json.js";
import type { JsonArtifactStore } from "../../src/research/research-record/index.js";
import {
  openValidation,
  validationCandidateId,
  validationRecordSchema,
  type SingleValidationAttemptOutput,
  type CurrentValidationPlan,
} from "../../src/research/validation/index.js";

const digest = (character: string): string => `sha256:${character.repeat(64)}`;
const criteria = [
  "source-integrity",
  "reachability-and-premise",
  "broken-control",
  "causal-route-and-security-effect",
  "counterevidence-and-proof-gap",
] as const;
const target = {
  id: "plugin-1.0.0",
  pluginSlug: "plugin",
  version: "1.0.0",
  digest: digest("1"),
};
const manifestValue = {
  kind: "target-file-manifest" as const,
  schemaVersion: 1 as const,
  targetSnapshot: { id: target.id, digest: target.digest },
  entries: [
    { path: "entry.php", digest: digest("2"), size: 100 },
    { path: "control.php", digest: digest("3"), size: 100 },
  ],
};
const manifestRef = {
  kind: "target-file-manifest" as const,
  schemaVersion: 1 as const,
  targetSnapshotId: target.id,
  targetSnapshotDigest: target.digest,
  digest: sha256Digest(manifestValue),
};
const anchor = {
  path: "entry.php",
  fileDigest: digest("2"),
  startLine: 10,
  endLine: 12,
};
const candidateIdentity = {
  target,
  manifest: manifestRef,
  attackerPremise: "unauthenticated" as const,
  brokenSecurityProperty: "admin-only-option-update",
  causalIdentity: {
    rootCause: "missing-authorization",
    attackerControlledPrimitive: "public-option-write",
    brokenSecurityProperty: "admin-only-option-update",
  },
  causalRoute: [
    {
      ordinal: 1,
      claim:
        "A public request reaches the option update without authorization.",
      evidence: [anchor],
    },
  ],
};
const candidate = {
  kind: "validation-candidate" as const,
  schemaVersion: 2 as const,
  id: validationCandidateId(candidateIdentity),
  ...candidateIdentity,
  origins: [
    {
      subjectDigest: digest("4"),
      rootEvaluationDigest: digest("5"),
      approachFamilyId: digest("6"),
    },
  ],
};
const threatContextIdentity = {
  kind: "validation-threat-context" as const,
  schemaVersion: 1 as const,
  targetSnapshotDigest: target.digest,
  candidateId: candidate.id,
  wordpressBaseline: {
    id: "wordpress-threat-baseline-v1",
    digest: digest("7"),
  },
  permittedAttacker: "unauthenticated" as const,
  publicSurface: ["Public REST route"],
  technicalExclusions: [],
};
const threatContext = {
  ...threatContextIdentity,
  id: sha256Digest(threatContextIdentity),
};
const modelProfile = {
  provider: "anthropic",
  model: "claude-opus-5",
  transport: "claude-code-process",
  executableVersion: "2.1.251",
  effort: "high",
  eligibilityReceiptDigest: digest("8"),
};
const modelBudget = {
  maxWallTimeMs: 60_000,
  maxModelTokens: 10_000,
  maxModelTurns: 32,
  maxProviderCostUsd: 3,
  maxOutputBytes: 1_000_000,
};
const validatorBudget = {
  ...modelBudget,
  maxSourceQueries: 64,
  maxSourceScanBytes: 16_000_000,
  maxSourceResponseBytes: 4_000_000,
};
const plan: CurrentValidationPlan = {
  kind: "validation-plan",
  schemaVersion: 2,
  validationId: candidate.id,
  campaignId: "campaign-1",
  candidate,
  threatContext,
  manifest: { ref: manifestRef, value: manifestValue },
  validationPolicy: { id: "source-validation-v2", digest: digest("9") },
  promptSet: { id: "source-validation-prompts-v1", digest: digest("a") },
  validatorModelProfile: modelProfile,
  sourceToolPolicy: {
    kind: "source-tool-policy",
    schemaVersion: 1,
    id: "validation-source-v1",
    digest: digest("b"),
  },
  budget: { validator: validatorBudget },
};

class MemoryArtifactStore implements JsonArtifactStore {
  readonly values = new Map<string, unknown>();

  async putJson(value: unknown): Promise<string> {
    const valueDigest = sha256Digest(value);
    this.values.set(valueDigest, value);
    return valueDigest;
  }

  async readJson(valueDigest: string): Promise<unknown> {
    const value = this.values.get(valueDigest);
    if (value === undefined)
      throw new Error(`Missing artifact: ${valueDigest}`);
    return value;
  }
}

function attemptOutput(
  attemptId: string,
  disposition: SingleValidationAttemptOutput["proposedDisposition"] = "source-validated",
  overrides: Partial<
    Record<(typeof criteria)[number], "pass" | "fail" | "unknown">
  > = {},
): SingleValidationAttemptOutput {
  return {
    kind: "validation-attempt-output",
    schemaVersion: 3,
    candidateId: candidate.id,
    criteria: criteria.map((criterion) => ({
      criterion,
      status: overrides[criterion] ?? "pass",
      reason: `${attemptId} independently checked ${criterion}.`,
      evidence: [anchor],
    })),
    proposedDisposition: disposition,
    ...(disposition === "needs-research"
      ? {
          proofGap: {
            requiredFact: "Confirm the public registration path.",
            currentEvidence: [anchor],
            falsifier: "The route is always registered behind admin auth.",
            nextAction: "Trace every registration call in source.",
          },
        }
      : {}),
  };
}

function completedResult(planValue: AttemptPlanV2, output: unknown) {
  const planDigest = sha256Digest(planValue);
  const value = {
    kind: "model-attempt-result" as const,
    schemaVersion: 2 as const,
    attemptId: planValue.attemptId,
    owner: "validation" as const,
    role: planValue.role,
    planDigest,
    status: "completed" as const,
    output,
  };
  return {
    status: "completed" as const,
    ref: {
      kind: "attempt-execution-result" as const,
      schemaVersion: 2 as const,
      attemptId: planValue.attemptId,
      owner: "validation" as const,
      role: planValue.role,
      planDigest,
      digest: sha256Digest(value),
    },
    value,
  };
}

function failedResult(planValue: AttemptPlanV2) {
  const planDigest = sha256Digest(planValue);
  const value = {
    kind: "model-attempt-result" as const,
    schemaVersion: 2 as const,
    attemptId: planValue.attemptId,
    owner: "validation" as const,
    role: planValue.role,
    planDigest,
    status: "provider-failed" as const,
    reason: "provider-unavailable",
  };
  return {
    status: "provider-failed" as const,
    ref: {
      kind: "attempt-execution-result" as const,
      schemaVersion: 2 as const,
      attemptId: planValue.attemptId,
      owner: "validation" as const,
      role: planValue.role,
      planDigest,
      digest: sha256Digest(value),
    },
    value,
  };
}

function modelExecution(
  output: (
    planValue: AttemptPlanV2,
    calls: readonly AttemptPlanV2[],
  ) => unknown,
): { readonly execution: ModelExecution; readonly calls: AttemptPlanV2[] } {
  const calls: AttemptPlanV2[] = [];
  return {
    calls,
    execution: {
      run: async (planValue: ModelAttemptPlan) => {
        if (planValue.schemaVersion !== 2) {
          throw new Error("Validation must use AttemptPlanV2");
        }
        calls.push(planValue);
        return completedResult(planValue, output(planValue, calls));
      },
    },
  };
}

async function readRecord(store: MemoryArtifactStore, ref: { digest: string }) {
  return validationRecordSchema.parse(await store.readJson(ref.digest));
}

describe("source-only Validation", () => {
  it("keeps distinct Causal Identities as distinct Validation Candidates", () => {
    const first = {
      ...candidateIdentity,
      causalIdentity: {
        ...candidateIdentity.causalIdentity,
      },
    };
    const second = {
      ...candidateIdentity,
      causalIdentity: {
        ...first.causalIdentity,
        rootCause: "cross-actor-state-reuse",
      },
    };

    expect(validationCandidateId(first)).not.toBe(
      validationCandidateId(second),
    );
  });

  it("runs one fresh manifest-bound Validator and no Synthesis", async () => {
    const store = new MemoryArtifactStore();
    const model = modelExecution((attempt) => attemptOutput(attempt.attemptId));
    const validation = openValidation({
      artifactStore: store,
      modelExecution: model.execution,
    });

    const ref = await validation.validate(plan);
    const record = await readRecord(store, ref);

    expect(model.calls.map((call) => call.role)).toEqual(["validator"]);
    expect(model.calls[0]).toMatchObject({
      owner: "validation",
      role: "validator",
      assignment: { attemptOrdinal: 1 },
      sourceToolPolicy: plan.sourceToolPolicy,
    });
    expect(model.calls[0]?.prompt).toContain(
      "Include proofGap only for needs-research; omit proofGap for source-validated and disproven.",
    );
    expect(record).toMatchObject({
      schemaVersion: 3,
      status: "source-validated",
      validatorAttempt: { status: "completed" },
    });
  });

  it("requires an attacker-closed enforcement effect instead of a writable catalog", async () => {
    const store = new MemoryArtifactStore();
    const model = modelExecution((attempt) => attemptOutput(attempt.attemptId));
    const validation = openValidation({
      artifactStore: store,
      modelExecution: model.execution,
    });

    await validation.validate(plan);

    const prompt = model.calls[0]?.prompt;
    expect(prompt).toContain(
      "A writable catalog, capture, discovery, recommendation, or proposed configuration is not by itself an enforcement state or a concrete Security Effect.",
    );
    expect(prompt).toContain(
      "The permitted attacker must close the causal route to the concrete Security Effect without a later discretionary action by a privileged actor.",
    );
    expect(prompt).toContain(
      "If the source leaves the enforcement consumer or privileged follow-up undecidable, use unknown and needs-research with a source-decidable proofGap.",
    );
  });

  it("persists the Attempt result before the single Validation Record", async () => {
    const store = new MemoryArtifactStore();
    let attemptResultDigest: string | undefined;
    const execution: ModelExecution = {
      run: async (planValue) => {
        if (planValue.schemaVersion !== 2) {
          throw new Error("Validation must use AttemptPlanV2");
        }
        const result = completedResult(
          planValue,
          attemptOutput(planValue.attemptId),
        );
        attemptResultDigest = result.ref.digest;
        return result;
      },
    };
    const validation = openValidation({
      artifactStore: store,
      modelExecution: execution,
    });

    const ref = await validation.validate(plan);

    const storedDigests = [...store.values.keys()];
    expect(attemptResultDigest).toBeDefined();
    expect(storedDigests.indexOf(attemptResultDigest!)).toBeLessThan(
      storedDigests.indexOf(ref.digest),
    );
  });

  it("preserves a concrete source-decidable proof gap as needs-research", async () => {
    const store = new MemoryArtifactStore();
    const model = modelExecution((attempt) =>
      attemptOutput(attempt.attemptId, "needs-research", {
        "reachability-and-premise": "unknown",
      }),
    );
    const validation = openValidation({
      artifactStore: store,
      modelExecution: model.execution,
    });

    const record = await readRecord(store, await validation.validate(plan));

    expect(model.calls.map((call) => call.role)).toEqual(["validator"]);
    expect(record).toMatchObject({
      schemaVersion: 3,
      status: "needs-research",
      validatorAttempt: {
        status: "completed",
        output: {
          proofGap: { nextAction: "Trace every registration call in source." },
        },
      },
    });
  });

  it("keeps a runtime-only unknown source-validated instead of rejecting it", async () => {
    const store = new MemoryArtifactStore();
    const model = modelExecution((attempt) =>
      attemptOutput(attempt.attemptId, "source-validated", {
        "counterevidence-and-proof-gap": "unknown",
      }),
    );
    const validation = openValidation({
      artifactStore: store,
      modelExecution: model.execution,
    });

    const record = await readRecord(store, await validation.validate(plan));

    expect(model.calls).toHaveLength(1);
    expect(record.status).toBe("source-validated");
  });

  it("closes only a decisive source contradiction as disproven", async () => {
    const store = new MemoryArtifactStore();
    const model = modelExecution((attempt) =>
      attemptOutput(attempt.attemptId, "disproven", {
        "broken-control": "fail",
      }),
    );
    const validation = openValidation({
      artifactStore: store,
      modelExecution: model.execution,
    });

    const record = await readRecord(store, await validation.validate(plan));

    expect(model.calls).toHaveLength(1);
    expect(record.status).toBe("disproven");
  });

  it("keeps rejected or otherwise invalid output pending", async () => {
    const store = new MemoryArtifactStore();
    const model = modelExecution((attempt) => ({
      ...attemptOutput(attempt.attemptId),
      proposedDisposition: "rejected",
    }));
    const validation = openValidation({
      artifactStore: store,
      modelExecution: model.execution,
    });

    const record = await readRecord(store, await validation.validate(plan));

    expect(model.calls).toHaveLength(1);
    expect(record).toMatchObject({
      schemaVersion: 3,
      status: "validation-pending",
      reason: "invalid-validator-output",
    });
  });

  it("keeps provider failure pending instead of converting it to a negative", async () => {
    const store = new MemoryArtifactStore();
    const calls: AttemptPlanV2[] = [];
    const execution: ModelExecution = {
      run: async (planValue) => {
        if (planValue.schemaVersion !== 2) {
          throw new Error("Validation must use AttemptPlanV2");
        }
        calls.push(planValue);
        return failedResult(planValue);
      },
    };
    const validation = openValidation({
      artifactStore: store,
      modelExecution: execution,
    });

    const record = await readRecord(store, await validation.validate(plan));

    expect(calls.map((call) => call.role)).toEqual(["validator"]);
    expect(record).toMatchObject({
      status: "validation-pending",
      reason: "validator-attempt-failed",
    });
  });

  it("does not spend a Validator attempt on a Contributor-or-higher candidate", async () => {
    const contributorIdentity = {
      ...candidateIdentity,
      attackerPremise: "contributor" as const,
    };
    const contributorCandidate = {
      ...candidate,
      ...contributorIdentity,
      id: validationCandidateId(contributorIdentity),
    };
    const contributorThreatContextIdentity = {
      ...threatContextIdentity,
      candidateId: contributorCandidate.id,
      permittedAttacker: "contributor" as const,
    };
    const contributorPlan: CurrentValidationPlan = {
      ...plan,
      validationId: contributorCandidate.id,
      candidate: contributorCandidate,
      threatContext: {
        ...contributorThreatContextIdentity,
        id: sha256Digest(contributorThreatContextIdentity),
      },
    };
    const store = new MemoryArtifactStore();
    const model = modelExecution((attempt) => attemptOutput(attempt.attemptId));
    const validation = openValidation({
      artifactStore: store,
      modelExecution: model.execution,
    });

    await expect(validation.validate(contributorPlan)).rejects.toThrow(
      "Validation candidate exceeds the current research attacker scope",
    );
    expect(model.calls).toEqual([]);
  });

  it("uses exact semantic identity rather than discovery provenance", () => {
    expect(
      validationCandidateId({
        ...candidateIdentity,
        origins: [
          {
            subjectDigest: digest("c"),
            rootEvaluationDigest: digest("d"),
            approachFamilyId: digest("e"),
          },
        ],
      }),
    ).toBe(candidate.id);
    expect(
      validationCandidateId({
        ...candidateIdentity,
        causalRoute: [
          {
            ...candidateIdentity.causalRoute[0]!,
            claim: "A different causal route.",
          },
        ],
      }),
    ).not.toBe(candidate.id);
  });
});
