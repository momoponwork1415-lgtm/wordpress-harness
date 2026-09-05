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
  type ValidationAttemptOutput,
  type ValidationPlan,
  type ValidationSynthesisOutput,
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
  brokenSecurityProperty: "Only an administrator may change the target option.",
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
  schemaVersion: 1 as const,
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
const plan: ValidationPlan = {
  kind: "validation-plan",
  schemaVersion: 1,
  validationId: candidate.id,
  campaignId: "campaign-1",
  candidate,
  threatContext,
  manifest: { ref: manifestRef, value: manifestValue },
  validationPolicy: { id: "source-validation-v1", digest: digest("9") },
  promptSet: { id: "source-validation-prompts-v1", digest: digest("a") },
  validatorModelProfile: modelProfile,
  synthesisModelProfile: modelProfile,
  sourceToolPolicy: {
    kind: "source-tool-policy",
    schemaVersion: 1,
    id: "validation-source-v1",
    digest: digest("b"),
  },
  budget: { validator: validatorBudget, synthesis: modelBudget },
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
  disposition: ValidationAttemptOutput["proposedDisposition"] = "ready-for-human",
  overrides: Partial<
    Record<(typeof criteria)[number], "pass" | "fail" | "unknown">
  > = {},
): ValidationAttemptOutput {
  return {
    kind: "validation-attempt-output",
    schemaVersion: 1,
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

function synthesisOutput(
  attemptIds: readonly string[],
  disposition: ValidationSynthesisOutput["disposition"] = "ready-for-human",
): ValidationSynthesisOutput {
  return {
    kind: "validation-synthesis-output",
    schemaVersion: 1,
    candidateId: candidate.id,
    criteria: criteria.map((criterion) => ({
      criterion,
      status:
        disposition === "needs-research" &&
        criterion === "reachability-and-premise"
          ? "unknown"
          : "pass",
      reason: `The cited attempts resolve ${criterion}.`,
      evidence: [
        {
          attemptId:
            disposition === "needs-research" &&
            criterion === "reachability-and-premise"
              ? attemptIds[1]!
              : attemptIds[0]!,
          criterion,
          evidenceIndexes: [0],
        },
      ],
    })),
    disposition,
    reason: "The disposition follows only from cited attempt evidence.",
    ...(disposition === "needs-research"
      ? { proofGapAttemptId: attemptIds[1]! }
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
  it("runs two fresh Validators followed by one tool-free Synthesis", async () => {
    const store = new MemoryArtifactStore();
    const model = modelExecution((attempt, calls) =>
      attempt.role === "validator"
        ? attemptOutput(attempt.attemptId)
        : synthesisOutput(
            calls
              .filter((call) => call.role === "validator")
              .map((call) => call.attemptId),
          ),
    );
    const validation = openValidation({
      artifactStore: store,
      modelExecution: model.execution,
    });

    const ref = await validation.validate(plan);
    const record = await readRecord(store, ref);

    expect(model.calls.map((call) => call.role)).toEqual([
      "validator",
      "validator",
      "validation-synthesizer",
    ]);
    expect(new Set(model.calls.map((call) => call.attemptId))).toHaveLength(3);
    expect(model.calls.slice(0, 2)).toSatisfy((calls: AttemptPlanV2[]) =>
      calls.every((call) => "sourceToolPolicy" in call),
    );
    expect(model.calls[2]).not.toHaveProperty("sourceToolPolicy");
    expect(record.status).toBe("ready-for-human");
    expect(record.validatorAttempts).toHaveLength(2);
  });

  it("persists every model Attempt result before the next Validation stage starts", async () => {
    const store = new MemoryArtifactStore();
    const validatorAttemptIds: string[] = [];
    let synthesisResultDigest: string | undefined;
    const execution: ModelExecution = {
      run: async (planValue) => {
        if (planValue.schemaVersion !== 2) {
          throw new Error("Validation must use AttemptPlanV2");
        }
        if (planValue.role === "validator") {
          validatorAttemptIds.push(planValue.attemptId);
          return completedResult(planValue, attemptOutput(planValue.attemptId));
        }
        const validatorDigests = [...store.values.values()]
          .filter(
            (value): value is { attemptId: string; role: string } =>
              typeof value === "object" &&
              value !== null &&
              "attemptId" in value &&
              "role" in value &&
              typeof value.attemptId === "string" &&
              typeof value.role === "string",
          )
          .filter((value) => value.role === "validator")
          .map((value) => value.attemptId)
          .sort();
        expect(validatorDigests).toEqual([...validatorAttemptIds].sort());
        const result = completedResult(
          planValue,
          synthesisOutput(validatorAttemptIds),
        );
        synthesisResultDigest = result.ref.digest;
        return result;
      },
    };
    const validation = openValidation({
      artifactStore: store,
      modelExecution: execution,
    });

    await validation.validate(plan);

    expect(synthesisResultDigest).toBeDefined();
    expect(store.values.has(synthesisResultDigest!)).toBe(true);
  });

  it("runs a third Validator only for a material rubric conflict", async () => {
    const store = new MemoryArtifactStore();
    const model = modelExecution((attempt, calls) => {
      if (attempt.role === "validator") {
        const ordinal = calls.filter(
          (call) => call.role === "validator",
        ).length;
        return ordinal === 2
          ? attemptOutput(attempt.attemptId, "needs-research", {
              "reachability-and-premise": "unknown",
            })
          : attemptOutput(attempt.attemptId);
      }
      return synthesisOutput(
        calls
          .filter((call) => call.role === "validator")
          .map((call) => call.attemptId),
        "needs-research",
      );
    });
    const validation = openValidation({
      artifactStore: store,
      modelExecution: model.execution,
    });

    const record = await readRecord(store, await validation.validate(plan));

    expect(model.calls.map((call) => call.role)).toEqual([
      "validator",
      "validator",
      "validator",
      "validation-synthesizer",
    ]);
    expect(record.materialConflictAfterTwo).toBe(true);
    expect(record.status).toBe("needs-research");
  });

  it("does not spend a third Attempt on wording differences", async () => {
    const store = new MemoryArtifactStore();
    const model = modelExecution((attempt, calls) =>
      attempt.role === "validator"
        ? attemptOutput(attempt.attemptId)
        : synthesisOutput(
            calls
              .filter((call) => call.role === "validator")
              .map((call) => call.attemptId),
          ),
    );
    const validation = openValidation({
      artifactStore: store,
      modelExecution: model.execution,
    });

    await validation.validate(plan);

    expect(
      model.calls.filter((call) => call.role === "validator"),
    ).toHaveLength(2);
  });

  it("turns an invalid Synthesis evidence reference into validation-pending", async () => {
    const store = new MemoryArtifactStore();
    const model = modelExecution((attempt, calls) => {
      if (attempt.role === "validator") return attemptOutput(attempt.attemptId);
      const output = synthesisOutput(
        calls
          .filter((call) => call.role === "validator")
          .map((call) => call.attemptId),
      );
      return {
        ...output,
        criteria: output.criteria.map((criterion, index) =>
          index === 0
            ? {
                ...criterion,
                evidence: [
                  {
                    ...criterion.evidence[0]!,
                    attemptId: "foreign-validator-attempt",
                  },
                ],
              }
            : criterion,
        ),
      };
    });
    const validation = openValidation({
      artifactStore: store,
      modelExecution: model.execution,
    });

    const record = await readRecord(store, await validation.validate(plan));

    expect(record).toMatchObject({
      status: "validation-pending",
      reason: "invalid-synthesis",
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
        return planValue.role === "validator" &&
          planValue.assignment.attemptOrdinal === 1
          ? failedResult(planValue)
          : completedResult(planValue, attemptOutput(planValue.attemptId));
      },
    };
    const validation = openValidation({
      artifactStore: store,
      modelExecution: execution,
    });

    const record = await readRecord(store, await validation.validate(plan));

    expect(calls.map((call) => call.role)).toEqual(["validator", "validator"]);
    expect(record).toMatchObject({
      status: "validation-pending",
      reason: "validator-attempt-failed",
    });
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
