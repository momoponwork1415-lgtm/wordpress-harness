import { z } from "zod";

import {
  attemptExecutionResultV2RefSchema,
  attemptPlanV2Schema,
  modelAttemptResultV2Schema,
  type AttemptExecutionResult,
  type AttemptExecutionResultV2,
  type AttemptPlanV2,
} from "../model-execution/contracts.js";
import {
  canonicalJson,
  sha256Digest,
} from "../research-record/canonical-json.js";
import {
  currentResearchAttackerScopePrompt,
  isWithinCurrentResearchAttackerScope,
} from "../current-research-attacker-scope.js";
import {
  sourceEvidenceReceiptRefV2Schema,
  type SourceEvidenceReceiptValueV2,
} from "../source-mapping/source-evidence-contracts.js";
import {
  approachFamilyAdmissionRefSchema,
  approachFamilyAdmissionSchema,
  explorationSubjectRefSchema,
  frontierGapArtifactRefSchema,
  iterationActionV2Schema,
  iterationActionV3Schema,
  iterationDecisionV2Schema,
  iterationDecisionV3Schema,
  researchThesisRefSchema,
  rootEvaluatorOutputV1Schema,
  rootEvaluatorOutputV2Schema,
  routeFragmentArtifactRefSchema,
  semanticExplorationDecisionSchema,
  semanticWaveEvaluationInputSchema,
  semanticWorkLeaseRefSchema,
  sourceBoundHypothesisArtifactRefSchema,
  type ExplorationSubjectRef,
  type IterationActionV2,
  type IterationActionV3,
  type OpenSemanticExplorationOptions,
  type RootEvaluatorOutput,
  type RootEvaluatorOutputV2,
  type SemanticExplorationDecision,
  type SemanticWaveEvaluationInput,
} from "./semantic-contracts.js";

type EvaluatorOptions = NonNullable<
  OpenSemanticExplorationOptions["evaluator"]
>;

type EvaluationFailureReason = Extract<
  SemanticExplorationDecision,
  { kind: "evaluation-incomplete" }
>["reason"];

interface ValidatedEvaluationContext {
  readonly subjects: readonly ExplorationSubjectRef[];
  readonly workLeases: readonly ReturnType<
    typeof semanticWorkLeaseRefSchema.parse
  >[];
  readonly attemptResults: readonly (ReturnType<
    typeof attemptExecutionResultV2RefSchema.parse
  > & { readonly role: "finder" })[];
  readonly toolReceipts: readonly ReturnType<
    typeof sourceEvidenceReceiptRefV2Schema.parse
  >[];
  readonly promptContext: unknown;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function same(left: unknown, right: unknown): boolean {
  return canonicalJson(left) === canonicalJson(right);
}

function sortByDigest<T extends { readonly digest: string }>(
  values: readonly T[],
): T[] {
  return [...values].sort((left, right) =>
    compareText(left.digest, right.digest),
  );
}

function subjectKindRank(kind: ExplorationSubjectRef["kind"]): number {
  switch (kind) {
    case "research-thesis":
      return 0;
    case "source-bound-hypothesis":
      return 1;
    case "route-fragment":
      return 2;
    case "frontier-gap":
      return 3;
  }
}

function sortSubjects(values: readonly ExplorationSubjectRef[]) {
  return [...values].sort(
    (left, right) =>
      subjectKindRank(left.kind) - subjectKindRank(right.kind) ||
      compareText(left.id, right.id) ||
      compareText(left.digest, right.digest),
  );
}

function finderAttemptRef(
  value: SemanticWaveEvaluationInput["attemptResults"][number],
) {
  if (value.role !== "finder") {
    throw new Error("Wave evaluation received a non-Finder Attempt result");
  }
  return attemptExecutionResultV2RefSchema
    .extend({ role: z.literal("finder") })
    .parse({
      kind: "attempt-execution-result",
      schemaVersion: 2,
      attemptId: value.attemptId,
      owner: value.owner,
      role: value.role,
      planDigest: value.planDigest,
      digest: sha256Digest(value),
    });
}

function receiptRef(value: SourceEvidenceReceiptValueV2) {
  return sourceEvidenceReceiptRefV2Schema.parse({
    kind: "source-evidence-receipt",
    schemaVersion: 2,
    attemptId: value.attemptId,
    assignmentDigest: sha256Digest(value.assignment),
    manifestDigest: value.manifest.digest,
    queryDigest: value.queryDigest,
    digest: sha256Digest(value),
  });
}

function compactReceipt(value: SourceEvidenceReceiptValueV2) {
  return {
    ref: receiptRef(value),
    queryOrdinal: value.queryOrdinal,
    operation: value.operation,
    result: value.result,
  };
}

function summarizeReceipts(values: readonly SourceEvidenceReceiptValueV2[]) {
  const byAttempt = new Map<
    string,
    {
      attemptId: string;
      queries: number;
      operations: Record<SourceEvidenceReceiptValueV2["operation"], number>;
      results: Record<string, number>;
      usage: { files: number; bytes: number; matches: number };
    }
  >();
  for (const value of values) {
    const summary = byAttempt.get(value.attemptId) ?? {
      attemptId: value.attemptId,
      queries: 0,
      operations: { list: 0, search: 0, read: 0 },
      results: {},
      usage: { files: 0, bytes: 0, matches: 0 },
    };
    summary.queries += 1;
    summary.operations[value.operation] += 1;
    summary.results[value.result.status] =
      (summary.results[value.result.status] ?? 0) + 1;
    summary.usage.files += value.usage.files;
    summary.usage.bytes += value.usage.bytes;
    summary.usage.matches += value.usage.matches;
    byAttempt.set(value.attemptId, summary);
  }
  return [...byAttempt.values()].sort((left, right) =>
    compareText(left.attemptId, right.attemptId),
  );
}

function validateEvaluationInput(
  inputValue: SemanticWaveEvaluationInput,
): ValidatedEvaluationContext {
  const input = semanticWaveEvaluationInputSchema.parse(inputValue);
  const { wave, terminal } = input;
  if (
    !same(input.target, wave.target) ||
    !same(input.manifest, wave.manifest) ||
    !same(input.target, terminal.value.target) ||
    !same(input.manifest, terminal.value.manifest) ||
    !same(wave.ref, terminal.value.wave) ||
    terminal.ref.waveId !== wave.id ||
    terminal.ref.targetSnapshotDigest !== input.target.digest ||
    terminal.ref.manifestDigest !== input.manifest.digest ||
    terminal.ref.digest !== sha256Digest(terminal.value) ||
    !same(terminal.ref.hypotheses, terminal.value.hypotheses) ||
    !same(terminal.ref.routeFragments, terminal.value.routeFragments) ||
    !same(terminal.ref.frontierGaps, terminal.value.frontierGaps) ||
    !same(terminal.ref.attemptOutcomes, terminal.value.attemptOutcomes) ||
    !same(terminal.ref.issues, terminal.value.issues)
  ) {
    throw new Error("Wave evaluation terminal binding mismatch");
  }

  const candidateRefs: ExplorationSubjectRef[] = [];
  const candidateDetails: {
    readonly ref: ExplorationSubjectRef;
    readonly value: unknown;
  }[] = [];
  for (const artifact of input.artifacts.hypotheses) {
    const expectedId = sha256Digest({
      kind: artifact.kind,
      targetSnapshotDigest: input.target.digest,
      manifestDigest: input.manifest.digest,
      value: artifact.value,
    });
    if (
      artifact.id !== expectedId ||
      !same(artifact.target, input.target) ||
      !same(artifact.manifest, input.manifest) ||
      !same(artifact.workWave, wave.ref)
    ) {
      throw new Error("Wave evaluation Hypothesis binding mismatch");
    }
    const ref = sourceBoundHypothesisArtifactRefSchema.parse({
      kind: artifact.kind,
      schemaVersion: 2,
      id: artifact.id,
      digest: sha256Digest(artifact),
      attemptId: artifact.attemptId,
      leaseId: artifact.leaseId,
      workWaveDigest: wave.ref.digest,
      targetSnapshotDigest: input.target.digest,
      manifestDigest: input.manifest.digest,
    });
    candidateRefs.push(ref);
    candidateDetails.push({ ref, value: artifact.value });
  }
  for (const artifact of input.artifacts.routeFragments) {
    const expectedId = sha256Digest({
      kind: artifact.kind,
      targetSnapshotDigest: input.target.digest,
      manifestDigest: input.manifest.digest,
      value: artifact.value,
    });
    if (
      artifact.id !== expectedId ||
      !same(artifact.target, input.target) ||
      !same(artifact.manifest, input.manifest) ||
      !same(artifact.workWave, wave.ref)
    ) {
      throw new Error("Wave evaluation Fragment binding mismatch");
    }
    const ref = routeFragmentArtifactRefSchema.parse({
      kind: artifact.kind,
      schemaVersion: 2,
      id: artifact.id,
      digest: sha256Digest(artifact),
      attemptId: artifact.attemptId,
      leaseId: artifact.leaseId,
      workWaveDigest: wave.ref.digest,
      targetSnapshotDigest: input.target.digest,
      manifestDigest: input.manifest.digest,
    });
    candidateRefs.push(ref);
    candidateDetails.push({ ref, value: artifact.value });
  }
  for (const artifact of input.artifacts.frontierGaps) {
    const expectedId = sha256Digest({
      kind: artifact.kind,
      targetSnapshotDigest: input.target.digest,
      manifestDigest: input.manifest.digest,
      value: artifact.value,
    });
    if (
      artifact.id !== expectedId ||
      !same(artifact.target, input.target) ||
      !same(artifact.manifest, input.manifest) ||
      !same(artifact.workWave, wave.ref)
    ) {
      throw new Error("Wave evaluation Gap binding mismatch");
    }
    const ref = frontierGapArtifactRefSchema.parse({
      kind: artifact.kind,
      schemaVersion: 2,
      id: artifact.id,
      digest: sha256Digest(artifact),
      attemptId: artifact.attemptId,
      leaseId: artifact.leaseId,
      workWaveDigest: wave.ref.digest,
      targetSnapshotDigest: input.target.digest,
      manifestDigest: input.manifest.digest,
    });
    candidateRefs.push(ref);
    candidateDetails.push({ ref, value: artifact.value });
  }

  const terminalCandidateRefs = [
    ...terminal.value.hypotheses,
    ...terminal.value.routeFragments,
    ...terminal.value.frontierGaps,
  ];
  if (!same(sortByDigest(candidateRefs), sortByDigest(terminalCandidateRefs))) {
    throw new Error("Wave evaluation candidate artifact set mismatch");
  }

  const thesisRefs = wave.theses.map((value) =>
    researchThesisRefSchema.parse({
      kind: "research-thesis",
      schemaVersion: 1,
      id: value.id,
      digest: sha256Digest(value),
      targetSnapshotDigest: input.target.digest,
      manifestDigest: input.manifest.digest,
    }),
  );
  const subjects = sortSubjects([...thesisRefs, ...candidateRefs]);
  if (
    new Set(subjects.map((subject) => subject.digest)).size !== subjects.length
  ) {
    throw new Error("Wave evaluation contains duplicate subject refs");
  }

  const attemptResults = input.attemptResults.map(finderAttemptRef);
  if (
    !same(sortByDigest(attemptResults), sortByDigest(terminal.value.attempts))
  ) {
    throw new Error("Wave evaluation Attempt result set mismatch");
  }
  const attemptIds = new Set(
    attemptResults.map((attempt) => attempt.attemptId),
  );
  const leases = new Map(wave.leases.map((item) => [item.id, item]));
  const toolReceiptValues = [...input.toolReceipts].sort(
    (left, right) =>
      compareText(left.attemptId, right.attemptId) ||
      left.queryOrdinal - right.queryOrdinal,
  );
  for (const receipt of toolReceiptValues) {
    if (receipt.assignment.kind !== "research-thesis") {
      throw new Error("Wave evaluation received a non-Finder Tool Receipt");
    }
    const assignedLease = leases.get(receipt.assignment.leaseId);
    if (
      !attemptIds.has(receipt.attemptId) ||
      assignedLease === undefined ||
      receipt.assignment.workWaveId !== wave.id ||
      receipt.assignment.thesis.id !== assignedLease.assignment.thesisId ||
      receipt.targetSnapshot.id !== input.target.id ||
      receipt.targetSnapshot.digest !== input.target.digest ||
      !same(receipt.manifest, input.manifest)
    ) {
      throw new Error("Wave evaluation Tool Receipt binding mismatch");
    }
  }
  const toolReceipts = toolReceiptValues.map(receiptRef);
  const workLeases = wave.leases
    .map((value) =>
      semanticWorkLeaseRefSchema.parse({
        kind: "work-lease",
        schemaVersion: 2,
        id: value.id,
        digest: sha256Digest(value),
        workWaveDigest: wave.ref.digest,
        targetSnapshotDigest: input.target.digest,
        manifestDigest: input.manifest.digest,
      }),
    )
    .sort((left, right) => compareText(left.id, right.id));
  const attemptOutcomes = input.attemptResults
    .map((value) => ({
      ref: finderAttemptRef(value),
      status: value.status,
      ...(value.status === "completed" ? {} : { reason: value.reason }),
    }))
    .sort((left, right) =>
      compareText(left.ref.attemptId, right.ref.attemptId),
    );
  const thesisDetails = wave.theses.map((value) => ({
    ref: researchThesisRefSchema.parse({
      kind: "research-thesis",
      schemaVersion: 1,
      id: value.id,
      digest: sha256Digest(value),
      targetSnapshotDigest: input.target.digest,
      manifestDigest: input.manifest.digest,
    }),
    value,
  }));

  return {
    subjects,
    workLeases,
    attemptResults,
    toolReceipts,
    promptContext: {
      target: input.target,
      manifest: input.manifest,
      wave: {
        ref: wave.ref,
        purpose: wave.purpose,
        theses: thesisDetails,
        leases: wave.leases,
      },
      evaluationSubjects: [...thesisDetails, ...candidateDetails].sort(
        (left, right) =>
          subjectKindRank(left.ref.kind) - subjectKindRank(right.ref.kind) ||
          compareText(left.ref.id, right.ref.id) ||
          compareText(left.ref.digest, right.ref.digest),
      ),
      attemptOutcomes,
      toolReceipts: toolReceiptValues.map(compactReceipt),
      toolReceiptSummary: summarizeReceipts(toolReceiptValues),
      terminalIssues: terminal.value.issues,
      ...(input.closureReview === undefined
        ? {}
        : { closureReview: input.closureReview }),
    },
  };
}

function rootEvaluatorJsonSchema(
  schemaVersion: SemanticWaveEvaluationInput["schemaVersion"],
): Record<string, unknown> {
  const schema = z.toJSONSchema(
    schemaVersion === 3
      ? rootEvaluatorOutputV2Schema
      : rootEvaluatorOutputV1Schema,
  );
  delete schema.$schema;
  return schema;
}

function rootEvaluatorAttempt(
  input: SemanticWaveEvaluationInput,
  context: ValidatedEvaluationContext,
  evaluator: EvaluatorOptions,
  ordinal: number,
  attemptNamespace?: string,
): Extract<AttemptPlanV2, { role: "root-evaluator" }> {
  const attemptId = `root-evaluator:${sha256Digest({
    target: input.target,
    manifest: input.manifest,
    wave: input.wave.ref,
    terminalDigest: input.terminal.ref.digest,
    evaluationSchemaVersion: input.schemaVersion,
    ordinal,
    ...(attemptNamespace === undefined ? {} : { namespace: attemptNamespace }),
  }).slice("sha256:".length)}`;
  const plan = attemptPlanV2Schema.parse({
    kind: "attempt-plan",
    schemaVersion: 2,
    attemptId,
    owner: "exploration",
    role: "root-evaluator",
    target: input.target,
    manifest: input.manifest,
    assignment: {
      kind: "wave-evaluation",
      schemaVersion: 1,
      wave: input.wave.ref,
      terminalDigest: input.terminal.ref.digest,
      subjectDigests: context.subjects.map((subject) => subject.digest),
    },
    promptSet: evaluator.promptSet,
    modelProfile: evaluator.modelProfile,
    prompt: [
      "Evaluate every semantic research subject and assign each at least one explicit action.",
      ...(input.schemaVersion === 3
        ? [currentResearchAttackerScopePrompt]
        : []),
      input.schemaVersion === 3
        ? [
            "Validation admission, Depth Admission, next work, and retain are nonexclusive.",
            "Cover every supplied subject digest with at least one action; do not omit any subject.",
            "Declare every Validation or Depth admission under one explicit Approach Family; reuse its key when both actions pursue the same mechanism.",
            "Do not declare an Approach Family unless at least one admit-validation or admit-depth action references its key.",
            "Every admission action must use only subjects owned by its referenced Family; admit-validation must include its hypothesisDigest among those action subjects.",
            "For admit-validation, copy brokenSecurityProperty exactly from the selected Hypothesis causalIdentity and use every, and only, that Hypothesis route anchor as causalRoute evidence.",
            "Every schedule-work action must include at least one subject owned by a declared Family.",
          ].join(" ")
        : "Verification, Depth Admission, next work, and retain are nonexclusive.",
      "Do not use support count, confidence, arrival order, vulnerability class, or sink names as acceptance filters.",
      "Do not produce a Finding or Disproved verdict.",
      "Use coverage-closed only for an explicit Coverage Closure evaluation when this complete Wave has no unresolved subject; the Harness still requires two consecutive no-material-delta observations and a fresh Wildcard review.",
      `Wave evaluation context: ${canonicalJson(context.promptContext)}`,
    ].join("\n"),
    outputJsonSchema: rootEvaluatorJsonSchema(input.schemaVersion),
    budget: evaluator.budget,
  });
  if (plan.role !== "root-evaluator") {
    throw new Error("Root Evaluator attempt materialized with another role");
  }
  return plan;
}

function resolveSubjects(
  digests: readonly string[],
  subjectsByDigest: ReadonlyMap<string, ExplorationSubjectRef>,
):
  | { readonly kind: "resolved"; readonly subjects: ExplorationSubjectRef[] }
  | { readonly kind: "failed"; readonly reason: EvaluationFailureReason } {
  if (new Set(digests).size !== digests.length) {
    return { kind: "failed", reason: "invalid-action-binding" };
  }
  const subjects: ExplorationSubjectRef[] = [];
  for (const digest of digests) {
    const subject = subjectsByDigest.get(digest);
    if (subject === undefined) {
      return { kind: "failed", reason: "foreign-subject" };
    }
    subjects.push(subject);
  }
  return { kind: "resolved", subjects };
}

function referenceApproachFamilyAdmission(
  value: ReturnType<typeof approachFamilyAdmissionSchema.parse>,
) {
  return approachFamilyAdmissionRefSchema.parse({
    kind: value.kind,
    schemaVersion: value.schemaVersion,
    id: value.id,
    digest: sha256Digest(value),
    key: value.key,
    targetSnapshotDigest: value.target.digest,
    manifestDigest: value.manifest.digest,
    workWaveDigest: value.wave.digest,
  });
}

// The Depth Work Queue derives an Item identity from the action's kind,
// families, sorted subjects and directive, so two actions that differ only in
// subject order still collide there. Normalizing subject order here compares
// actions the way the projection will.
function iterationActionIdentity(action: IterationActionV3): string {
  return canonicalJson({ ...action, subjects: sortSubjects(action.subjects) });
}

function resolveCurrentEvaluatorOutput(
  input: SemanticWaveEvaluationInput & { readonly schemaVersion: 3 },
  context: ValidatedEvaluationContext,
  output: RootEvaluatorOutputV2,
  evaluatorAttempts: readonly (AttemptExecutionResultV2["ref"] & {
    readonly role: "root-evaluator";
  })[],
):
  | {
      readonly kind: "completed";
      readonly decision: SemanticExplorationDecision;
    }
  | { readonly kind: "failed"; readonly reason: EvaluationFailureReason } {
  if (
    output.campaignDisposition === "coverage-closed" &&
    (output.approachFamilies.length > 0 ||
      output.actions.some((action) => action.kind !== "close") ||
      input.closureReview === undefined ||
      input.terminal.value.issues.length > 0 ||
      input.attemptResults.length !== input.wave.leases.length ||
      input.attemptResults.some((attempt) => attempt.status !== "completed") ||
      input.toolReceipts.some(
        (receipt) => receipt.result.status === "budget-exhausted",
      ))
  ) {
    return { kind: "failed", reason: "unsafe-closure" };
  }

  const subjectsByDigest = new Map(
    context.subjects.map((subject) => [subject.digest, subject]),
  );
  const hypothesisArtifactsByDigest = new Map(
    input.artifacts.hypotheses.map((hypothesis) => [
      sha256Digest(hypothesis),
      hypothesis,
    ]),
  );
  const outOfScopeSubjectDigests = new Set([
    ...input.artifacts.hypotheses
      .filter(
        (hypothesis) =>
          !isWithinCurrentResearchAttackerScope(
            hypothesis.value.attackerPremise,
          ),
      )
      .map((hypothesis) => sha256Digest(hypothesis)),
    ...input.artifacts.routeFragments
      .filter(
        (fragment) =>
          !isWithinCurrentResearchAttackerScope(fragment.value.attackerPremise),
      )
      .map((fragment) => sha256Digest(fragment)),
  ]);
  const common = {
    target: input.target,
    manifest: input.manifest,
    wave: input.wave.ref,
  };
  const familyKeys = output.approachFamilies.map((family) => family.key);
  if (new Set(familyKeys).size !== familyKeys.length) {
    return { kind: "failed", reason: "invalid-action-binding" };
  }

  const approachFamilies = [];
  const familiesByKey = new Map<
    string,
    {
      readonly value: ReturnType<typeof approachFamilyAdmissionSchema.parse>;
      readonly ref: ReturnType<typeof approachFamilyAdmissionRefSchema.parse>;
    }
  >();
  for (const proposal of [...output.approachFamilies].sort((left, right) =>
    compareText(left.key, right.key),
  )) {
    const resolved = resolveSubjects(proposal.subjectDigests, subjectsByDigest);
    if (resolved.kind === "failed") return resolved;
    if (
      proposal.subjectDigests.some((digest) =>
        outOfScopeSubjectDigests.has(digest),
      )
    ) {
      return { kind: "failed", reason: "invalid-action-binding" };
    }
    const familySubjects = sortSubjects(resolved.subjects);
    const identity = {
      kind: "approach-family-admission" as const,
      schemaVersion: 1 as const,
      key: proposal.key,
      ...common,
      subjects: familySubjects,
      thesis: proposal.thesis,
      mechanism: proposal.mechanism,
      falsifier: proposal.falsifier,
      nextAction: proposal.nextAction,
    };
    const value = approachFamilyAdmissionSchema.parse({
      ...identity,
      id: sha256Digest(identity),
    });
    const ref = referenceApproachFamilyAdmission(value);
    approachFamilies.push(value);
    familiesByKey.set(proposal.key, { value, ref });
  }

  const covered = new Set<string>();
  const referencedFamilies = new Set<string>();
  const actions: IterationActionV3[] = [];
  for (const proposal of output.actions) {
    const resolved = resolveSubjects(proposal.subjectDigests, subjectsByDigest);
    if (resolved.kind === "failed") return resolved;
    if (
      proposal.kind !== "close" &&
      proposal.subjectDigests.some((digest) =>
        outOfScopeSubjectDigests.has(digest),
      )
    ) {
      return { kind: "failed", reason: "invalid-action-binding" };
    }
    for (const subject of resolved.subjects) covered.add(subject.digest);

    if (
      proposal.kind === "admit-validation" ||
      proposal.kind === "admit-depth"
    ) {
      const family = familiesByKey.get(proposal.approachFamilyKey);
      const familySubjectDigests = new Set(
        family?.value.subjects.map((subject) => subject.digest) ?? [],
      );
      if (
        family === undefined ||
        resolved.subjects.some(
          (subject) => !familySubjectDigests.has(subject.digest),
        )
      ) {
        return { kind: "failed", reason: "invalid-action-binding" };
      }
      referencedFamilies.add(family.value.key);

      if (proposal.kind === "admit-validation") {
        const hypothesis = subjectsByDigest.get(
          proposal.admission.hypothesisDigest,
        );
        const hypothesisArtifact = hypothesisArtifactsByDigest.get(
          proposal.admission.hypothesisDigest,
        );
        const availableAnchors = new Set(
          hypothesisArtifact?.value.route.anchors.map((anchor) =>
            canonicalJson(anchor),
          ) ?? [],
        );
        const usedAnchors = proposal.admission.causalRoute.flatMap((step) =>
          step.evidence.map((anchor) => canonicalJson(anchor)),
        );
        if (
          hypothesis?.kind !== "source-bound-hypothesis" ||
          hypothesisArtifact === undefined ||
          !proposal.subjectDigests.includes(hypothesis.digest) ||
          proposal.admission.brokenSecurityProperty !==
            hypothesisArtifact.value.causalIdentity.brokenSecurityProperty ||
          usedAnchors.some((anchor) => !availableAnchors.has(anchor)) ||
          [...availableAnchors].some((anchor) => !usedAnchors.includes(anchor))
        ) {
          return { kind: "failed", reason: "invalid-action-binding" };
        }
        const identity = {
          kind: "validation-admission" as const,
          ...common,
          approachFamily: family.ref,
          hypothesis,
          brokenSecurityProperty: proposal.admission.brokenSecurityProperty,
          causalRoute: proposal.admission.causalRoute,
          reason: proposal.admission.reason,
        };
        actions.push(
          iterationActionV3Schema.parse({
            kind: proposal.kind,
            approachFamily: family.ref,
            subjects: resolved.subjects,
            admission: {
              kind: "validation-admission",
              schemaVersion: 1,
              id: sha256Digest(identity),
              ...common,
              hypothesis,
              brokenSecurityProperty: proposal.admission.brokenSecurityProperty,
              causalRoute: proposal.admission.causalRoute,
              reason: proposal.admission.reason,
            },
          }),
        );
        continue;
      }

      actions.push(
        iterationActionV3Schema.parse({
          kind: proposal.kind,
          approachFamily: family.ref,
          subjects: resolved.subjects,
          admission: {
            kind: "depth-admission",
            schemaVersion: 2,
            id: sha256Digest({
              kind: "depth-admission",
              ...common,
              approachFamily: family.ref,
              ...proposal.admission,
            }),
            ...common,
            ...proposal.admission,
          },
        }),
      );
      continue;
    }

    if (proposal.kind === "schedule-work") {
      const familyBound = approachFamilies.some((family) =>
        resolved.subjects.some((subject) =>
          family.subjects.some(
            (evidence) => evidence.digest === subject.digest,
          ),
        ),
      );
      if (!familyBound) {
        return { kind: "failed", reason: "invalid-action-binding" };
      }
      actions.push(
        iterationActionV3Schema.parse({
          kind: proposal.kind,
          subjects: resolved.subjects,
          work: {
            kind: "next-work-request",
            schemaVersion: 1,
            id: sha256Digest({
              kind: "next-work-request",
              ...common,
              ...proposal.work,
            }),
            ...common,
            ...proposal.work,
          },
        }),
      );
      continue;
    }
    if (proposal.kind === "retain") {
      actions.push(
        iterationActionV3Schema.parse({
          kind: proposal.kind,
          subjects: resolved.subjects,
          reason: proposal.reason,
        }),
      );
      continue;
    }
    if (proposal.kind === "close") {
      actions.push(
        iterationActionV3Schema.parse({
          kind: proposal.kind,
          subjects: resolved.subjects,
          record: {
            kind: "closure-record",
            schemaVersion: 1,
            id: sha256Digest({
              kind: "closure-record",
              ...common,
              ...proposal.record,
            }),
            ...common,
            ...proposal.record,
          },
        }),
      );
      continue;
    }
    actions.push(
      iterationActionV3Schema.parse({
        kind: proposal.kind,
        subjects: resolved.subjects,
        blocker: {
          kind: "exploration-blocker",
          schemaVersion: 1,
          id: sha256Digest({
            kind: "exploration-blocker",
            ...common,
            ...proposal.blocker,
          }),
          ...common,
          ...proposal.blocker,
        },
      }),
    );
  }

  // Checked once over the built actions rather than inside the loop, which has
  // six continue branches, and before the Decision is parsed — a duplicate
  // must never become a durable Decision, because the queue projection it
  // wedges is recomputed identically on every resume.
  const actionIdentities = new Set(actions.map(iterationActionIdentity));
  if (
    covered.size !== context.subjects.length ||
    referencedFamilies.size !== approachFamilies.length ||
    actionIdentities.size !== actions.length
  ) {
    return {
      kind: "failed",
      reason:
        covered.size !== context.subjects.length
          ? "subject-omission"
          : "invalid-action-binding",
    };
  }

  return {
    kind: "completed",
    decision: iterationDecisionV3Schema.parse({
      kind: "iteration-decision",
      schemaVersion: 3,
      target: input.target,
      manifest: input.manifest,
      wave: input.wave.ref,
      evaluationSubjects: context.subjects,
      context: {
        kind: "wave-evaluation",
        terminalDigest: input.terminal.ref.digest,
        workLeases: context.workLeases,
        attemptResults: context.attemptResults,
        toolReceipts: context.toolReceipts,
        rootEvaluatorAttempts: evaluatorAttempts,
      },
      approachFamilies,
      actions,
      campaignDisposition: output.campaignDisposition,
    }),
  };
}

function resolveEvaluatorOutput(
  input: SemanticWaveEvaluationInput,
  context: ValidatedEvaluationContext,
  output: RootEvaluatorOutput,
  evaluatorAttempts: readonly (AttemptExecutionResultV2["ref"] & {
    readonly role: "root-evaluator";
  })[],
):
  | {
      readonly kind: "completed";
      readonly decision: SemanticExplorationDecision;
    }
  | { readonly kind: "failed"; readonly reason: EvaluationFailureReason } {
  if (input.schemaVersion === 3) {
    if (output.schemaVersion !== 2) {
      return { kind: "failed", reason: "invalid-root-evaluator-output" };
    }
    return resolveCurrentEvaluatorOutput(
      input,
      context,
      output,
      evaluatorAttempts,
    );
  }
  if (output.schemaVersion !== 1) {
    return { kind: "failed", reason: "invalid-root-evaluator-output" };
  }
  if (
    output.campaignDisposition === "coverage-closed" &&
    (input.closureReview === undefined ||
      output.actions.some((action) => action.kind !== "close") ||
      input.terminal.value.issues.length > 0 ||
      input.attemptResults.length !== input.wave.leases.length ||
      input.attemptResults.some((attempt) => attempt.status !== "completed") ||
      input.toolReceipts.some(
        (receipt) => receipt.result.status === "budget-exhausted",
      ))
  ) {
    return { kind: "failed", reason: "unsafe-closure" };
  }
  const subjectsByDigest = new Map(
    context.subjects.map((subject) => [subject.digest, subject]),
  );
  const covered = new Set<string>();
  const actions: IterationActionV2[] = [];
  const common = {
    target: input.target,
    manifest: input.manifest,
    wave: input.wave.ref,
  };

  for (const proposal of output.actions) {
    const resolved = resolveSubjects(proposal.subjectDigests, subjectsByDigest);
    if (resolved.kind === "failed") return resolved;
    for (const subject of resolved.subjects) covered.add(subject.digest);
    if (proposal.kind === "request-verification") {
      const hypothesis = subjectsByDigest.get(
        proposal.request.hypothesisDigest,
      );
      if (
        hypothesis?.kind !== "source-bound-hypothesis" ||
        !proposal.subjectDigests.includes(hypothesis.digest)
      ) {
        return { kind: "failed", reason: "invalid-action-binding" };
      }
      const identity = {
        kind: "verification-request",
        ...common,
        ...proposal.request,
      };
      actions.push(
        iterationActionV2Schema.parse({
          kind: proposal.kind,
          subjects: resolved.subjects,
          request: {
            kind: "verification-request",
            schemaVersion: 1,
            id: sha256Digest(identity),
            ...common,
            hypothesis,
            reason: proposal.request.reason,
          },
        }),
      );
      continue;
    }
    if (proposal.kind === "admit-depth") {
      actions.push(
        iterationActionV2Schema.parse({
          kind: proposal.kind,
          subjects: resolved.subjects,
          admission: {
            kind: "depth-admission",
            schemaVersion: 1,
            id: sha256Digest({
              kind: "depth-admission",
              ...common,
              ...proposal.admission,
            }),
            ...common,
            ...proposal.admission,
          },
        }),
      );
      continue;
    }
    if (proposal.kind === "schedule-work") {
      actions.push(
        iterationActionV2Schema.parse({
          kind: proposal.kind,
          subjects: resolved.subjects,
          work: {
            kind: "next-work-request",
            schemaVersion: 1,
            id: sha256Digest({
              kind: "next-work-request",
              ...common,
              ...proposal.work,
            }),
            ...common,
            ...proposal.work,
          },
        }),
      );
      continue;
    }
    if (proposal.kind === "retain") {
      actions.push(
        iterationActionV2Schema.parse({
          kind: proposal.kind,
          subjects: resolved.subjects,
          reason: proposal.reason,
        }),
      );
      continue;
    }
    if (proposal.kind === "close") {
      actions.push(
        iterationActionV2Schema.parse({
          kind: proposal.kind,
          subjects: resolved.subjects,
          record: {
            kind: "closure-record",
            schemaVersion: 1,
            id: sha256Digest({
              kind: "closure-record",
              ...common,
              ...proposal.record,
            }),
            ...common,
            ...proposal.record,
          },
        }),
      );
      continue;
    }
    actions.push(
      iterationActionV2Schema.parse({
        kind: proposal.kind,
        subjects: resolved.subjects,
        blocker: {
          kind: "exploration-blocker",
          schemaVersion: 1,
          id: sha256Digest({
            kind: "exploration-blocker",
            ...common,
            ...proposal.blocker,
          }),
          ...common,
          ...proposal.blocker,
        },
      }),
    );
  }

  if (covered.size !== context.subjects.length) {
    return { kind: "failed", reason: "subject-omission" };
  }
  return {
    kind: "completed",
    decision: iterationDecisionV2Schema.parse({
      kind: "iteration-decision",
      schemaVersion: 2,
      target: input.target,
      manifest: input.manifest,
      wave: input.wave.ref,
      evaluationSubjects: context.subjects,
      context: {
        kind: "wave-evaluation",
        terminalDigest: input.terminal.ref.digest,
        workLeases: context.workLeases,
        attemptResults: context.attemptResults,
        toolReceipts: context.toolReceipts,
        rootEvaluatorAttempts: evaluatorAttempts,
      },
      actions,
      campaignDisposition: output.campaignDisposition,
    }),
  };
}

function validateEvaluatorResult(
  input: SemanticWaveEvaluationInput,
  context: ValidatedEvaluationContext,
  plan: Extract<AttemptPlanV2, { role: "root-evaluator" }>,
  result: AttemptExecutionResult,
  priorAttempts: readonly (AttemptExecutionResultV2["ref"] & {
    readonly role: "root-evaluator";
  })[],
):
  | {
      readonly kind: "completed";
      readonly decision: SemanticExplorationDecision;
    }
  | {
      readonly kind: "failed";
      readonly reason: EvaluationFailureReason;
      readonly ref?: AttemptExecutionResultV2["ref"] & {
        readonly role: "root-evaluator";
      };
    } {
  if (result.ref.schemaVersion !== 2 || result.value.schemaVersion !== 2) {
    return { kind: "failed", reason: "root-evaluator-result-mismatch" };
  }
  const ref = attemptExecutionResultV2RefSchema.safeParse(result.ref);
  const value = modelAttemptResultV2Schema.safeParse(result.value);
  const planDigest = sha256Digest(plan);
  if (
    !ref.success ||
    !value.success ||
    ref.data.owner !== "exploration" ||
    value.data.owner !== "exploration" ||
    ref.data.role !== "root-evaluator" ||
    value.data.role !== "root-evaluator" ||
    ref.data.attemptId !== plan.attemptId ||
    value.data.attemptId !== plan.attemptId ||
    ref.data.planDigest !== planDigest ||
    value.data.planDigest !== planDigest ||
    ref.data.digest !== sha256Digest(value.data) ||
    result.status !== value.data.status
  ) {
    return { kind: "failed", reason: "root-evaluator-result-mismatch" };
  }
  const evaluatorRef = { ...ref.data, role: "root-evaluator" as const };
  if (value.data.status !== "completed") {
    return { kind: "failed", reason: "evaluator-failed", ref: evaluatorRef };
  }
  const output = (
    input.schemaVersion === 3
      ? rootEvaluatorOutputV2Schema
      : rootEvaluatorOutputV1Schema
  ).safeParse(value.data.output);
  if (!output.success) {
    return {
      kind: "failed",
      reason: "invalid-root-evaluator-output",
      ref: evaluatorRef,
    };
  }
  const resolved = resolveEvaluatorOutput(input, context, output.data, [
    ...priorAttempts,
    evaluatorRef,
  ]);
  return resolved.kind === "completed"
    ? resolved
    : { ...resolved, ref: evaluatorRef };
}

export async function evaluateSemanticWave(
  inputValue: SemanticWaveEvaluationInput,
  evaluator: EvaluatorOptions,
  attemptNamespace?: string,
): Promise<SemanticExplorationDecision> {
  const input = semanticWaveEvaluationInputSchema.parse(inputValue);
  const context = validateEvaluationInput(input);
  const attempts: (AttemptExecutionResultV2["ref"] & {
    readonly role: "root-evaluator";
  })[] = [];
  let failure: EvaluationFailureReason = "invalid-root-evaluator-output";
  for (let ordinal = 1; ordinal <= 2; ordinal += 1) {
    const plan = rootEvaluatorAttempt(
      input,
      context,
      evaluator,
      ordinal,
      attemptNamespace,
    );
    const result = await evaluator.modelExecution.run(plan);
    const validated = validateEvaluatorResult(
      input,
      context,
      plan,
      result,
      attempts,
    );
    if (validated.kind === "completed") return validated.decision;
    failure = validated.reason;
    if (validated.ref !== undefined) attempts.push(validated.ref);
    if (failure === "evaluator-failed") break;
  }
  return semanticExplorationDecisionSchema.parse({
    kind: "evaluation-incomplete",
    schemaVersion: input.schemaVersion,
    target: input.target,
    manifest: input.manifest,
    wave: input.wave.ref,
    terminalDigest: input.terminal.ref.digest,
    evaluationSubjects: context.subjects,
    attempts,
    reason: failure,
  });
}
