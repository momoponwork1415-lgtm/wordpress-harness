import { describe, expect, it } from "vitest";

import { sha256Digest } from "../../src/research/research-record/canonical-json.js";
import {
  approachFamilyAdmissionRefSchema,
  approachFamilyAdmissionSchema,
  projectInitialApproachFamilyRegistryV3,
  projectSemanticDepthWorkQueue,
  projectSemanticDepthWorkQueueV2,
  type IterationDecisionV2,
  type IterationDecisionV3,
} from "../../src/research/exploration/index.js";

const digest = (character: string): string => `sha256:${character.repeat(64)}`;

const target = {
  id: "plugin-1.0.0",
  pluginSlug: "plugin",
  version: "1.0.0",
  digest: digest("1"),
};
const manifest = {
  kind: "target-file-manifest" as const,
  schemaVersion: 1 as const,
  targetSnapshotId: target.id,
  targetSnapshotDigest: target.digest,
  digest: digest("2"),
};
const wave = {
  kind: "work-wave" as const,
  schemaVersion: 2 as const,
  id: digest("3"),
  digest: digest("4"),
  targetSnapshotDigest: target.digest,
  manifestDigest: manifest.digest,
};
const subject = {
  kind: "frontier-gap" as const,
  schemaVersion: 2 as const,
  id: digest("5"),
  digest: digest("6"),
  attemptId: "finder-attempt-1",
  leaseId: digest("7"),
  workWaveDigest: wave.digest,
  targetSnapshotDigest: target.digest,
  manifestDigest: manifest.digest,
};

function decision(): IterationDecisionV2 {
  const actions: IterationDecisionV2["actions"] = [
    {
      kind: "admit-depth",
      subjects: [subject],
      admission: {
        kind: "depth-admission",
        schemaVersion: 1,
        id: digest("8"),
        target,
        manifest,
        wave,
        highImpactPotential: "A cross-actor state capability may compose.",
        composition: "Connect the producer and consumer across requests.",
        falsifier: "The state is scoped to the same actor.",
        nextAction: "Trace every consumer of the produced capability.",
      },
    },
    ...Array.from({ length: 5 }, (_, index) => ({
      kind: "schedule-work" as const,
      subjects: [subject],
      work: {
        kind: "next-work-request" as const,
        schemaVersion: 1 as const,
        id: digest(String.fromCharCode("a".charCodeAt(0) + index)),
        target,
        manifest,
        wave,
        requiredFact: `Resolve missing cross-feature fact ${index + 1}.`,
        falsifier: `The proposed connection ${index + 1} does not exist.`,
        nextAction: `Inspect the producer and consumer for fact ${index + 1}.`,
      },
    })),
    {
      kind: "retain",
      subjects: [subject],
      reason: "Keep the frontier active while next work runs.",
    },
  ];
  return {
    kind: "iteration-decision",
    schemaVersion: 2,
    target,
    manifest,
    wave,
    evaluationSubjects: [subject],
    context: {
      kind: "wave-evaluation",
      terminalDigest: digest("d"),
      workLeases: [
        {
          kind: "work-lease",
          schemaVersion: 2,
          id: digest("e"),
          digest: digest("f"),
          workWaveDigest: wave.digest,
          targetSnapshotDigest: target.digest,
          manifestDigest: manifest.digest,
        },
      ],
      attemptResults: [
        {
          kind: "attempt-execution-result",
          schemaVersion: 2,
          attemptId: "finder-attempt-1",
          owner: "exploration",
          role: "finder",
          planDigest: digest("0"),
          digest: digest("a"),
        },
      ],
      toolReceipts: [],
      rootEvaluatorAttempts: [
        {
          kind: "attempt-execution-result",
          schemaVersion: 2,
          attemptId: "root-evaluator-1",
          owner: "exploration",
          role: "root-evaluator",
          planDigest: digest("b"),
          digest: digest("c"),
        },
      ],
    },
    actions,
    campaignDisposition: "continue",
  };
}

function currentDecision(): {
  readonly decision: IterationDecisionV3;
  readonly registry: ReturnType<
    typeof projectInitialApproachFamilyRegistryV3
  >["value"];
} {
  const currentSubject = {
    kind: "source-bound-hypothesis" as const,
    schemaVersion: 2 as const,
    id: sha256Digest("current-hypothesis-id"),
    digest: sha256Digest("current-hypothesis"),
    attemptId: "finder-attempt-1",
    leaseId: sha256Digest("current-lease"),
    workWaveDigest: wave.digest,
    targetSnapshotDigest: target.digest,
    manifestDigest: manifest.digest,
  };
  const familyIdentity = {
    kind: "approach-family-admission" as const,
    schemaVersion: 1 as const,
    key: "cross-actor-state",
    target,
    manifest,
    wave,
    subjects: [currentSubject],
    thesis: "Attacker-controlled state may cross an actor boundary.",
    mechanism: "A public writer feeds a privileged consumer.",
    falsifier: "Every consumer binds state to the originating actor.",
    nextAction: "Trace each privileged state consumer.",
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
    targetSnapshotDigest: target.digest,
    manifestDigest: manifest.digest,
    workWaveDigest: wave.digest,
  });
  const value: IterationDecisionV3 = {
    kind: "iteration-decision",
    schemaVersion: 3,
    target,
    manifest,
    wave,
    evaluationSubjects: [currentSubject],
    context: {
      kind: "wave-evaluation",
      terminalDigest: digest("d"),
      workLeases: [
        {
          kind: "work-lease",
          schemaVersion: 2,
          id: digest("e"),
          digest: digest("f"),
          workWaveDigest: wave.digest,
          targetSnapshotDigest: target.digest,
          manifestDigest: manifest.digest,
        },
      ],
      attemptResults: [],
      toolReceipts: [],
      rootEvaluatorAttempts: [
        {
          kind: "attempt-execution-result",
          schemaVersion: 2,
          attemptId: "root-evaluator-1",
          owner: "exploration",
          role: "root-evaluator",
          planDigest: digest("b"),
          digest: digest("c"),
        },
      ],
    },
    approachFamilies: [family],
    actions: [
      {
        kind: "admit-validation",
        approachFamily: familyRef,
        subjects: [currentSubject],
        admission: {
          kind: "validation-admission",
          schemaVersion: 1,
          id: sha256Digest("validation-admission"),
          target,
          manifest,
          wave,
          hypothesis: currentSubject,
          brokenSecurityProperty: "state-ownership",
          causalRoute: [
            {
              ordinal: 1,
              claim: "A public writer reaches a privileged state consumer.",
              evidence: [
                {
                  path: "plugin.php",
                  fileDigest: sha256Digest("plugin.php"),
                  startLine: 1,
                  endLine: 4,
                },
              ],
            },
          ],
          reason: "The route is ready for independent source review.",
        },
      },
      {
        kind: "admit-depth",
        approachFamily: familyRef,
        subjects: [currentSubject],
        admission: {
          kind: "depth-admission",
          schemaVersion: 2,
          id: sha256Digest("depth-admission"),
          target,
          manifest,
          wave,
          highImpactPotential: "Adjacent consumers may amplify the impact.",
          composition: "Connect the writer to every privileged consumer.",
          falsifier: "No additional consumer crosses an actor boundary.",
          nextAction: "Trace adjacent source-bound consumers.",
        },
      },
      ...Array.from({ length: 5 }, (_, index) => ({
        kind: "schedule-work" as const,
        subjects: [currentSubject],
        work: {
          kind: "next-work-request" as const,
          schemaVersion: 1 as const,
          id: sha256Digest(`current-work-${index + 1}`),
          target,
          manifest,
          wave,
          requiredFact: `Resolve adjacent consumer ${index + 1}.`,
          falsifier: `Consumer ${index + 1} is actor-bound.`,
          nextAction: `Inspect consumer ${index + 1}.`,
        },
      })),
    ],
    campaignDisposition: "continue",
  };
  return {
    decision: value,
    registry: projectInitialApproachFamilyRegistryV3(
      "campaign-depth-v2",
      "run-depth-v2",
      value,
    ).value,
  };
}

function collisionSubject(name: string) {
  return {
    kind: "source-bound-hypothesis" as const,
    schemaVersion: 2 as const,
    id: sha256Digest(`${name}-hypothesis-id`),
    digest: sha256Digest(`${name}-hypothesis`),
    attemptId: "finder-attempt-1",
    leaseId: sha256Digest("collision-lease"),
    workWaveDigest: wave.digest,
    targetSnapshotDigest: target.digest,
    manifestDigest: manifest.digest,
  };
}

const alphaSubject = collisionSubject("alpha");
const betaSubject = collisionSubject("beta");

function collidingDecision(): {
  readonly decision: IterationDecisionV3;
  readonly registry: ReturnType<
    typeof projectInitialApproachFamilyRegistryV3
  >["value"];
} {
  const familyFor = (
    key: string,
    subjects: readonly [ReturnType<typeof collisionSubject>],
  ) => {
    const identity = {
      kind: "approach-family-admission" as const,
      schemaVersion: 1 as const,
      key,
      target,
      manifest,
      wave,
      subjects: [...subjects],
      thesis: "Attacker-controlled state may cross an actor boundary.",
      mechanism: "A public writer feeds a privileged consumer.",
      falsifier: "Every consumer binds state to the originating actor.",
      nextAction: "Trace each privileged state consumer.",
    };
    const family = approachFamilyAdmissionSchema.parse({
      ...identity,
      id: sha256Digest(identity),
    });
    return {
      family,
      ref: approachFamilyAdmissionRefSchema.parse({
        kind: family.kind,
        schemaVersion: family.schemaVersion,
        id: family.id,
        digest: sha256Digest(family),
        key: family.key,
        targetSnapshotDigest: target.digest,
        manifestDigest: manifest.digest,
        workWaveDigest: wave.digest,
      }),
    };
  };
  const alpha = familyFor("alpha-route", [alphaSubject]);
  const beta = familyFor("beta-route", [betaSubject]);
  // The identity the evaluator really mints: target, manifest, wave and the
  // three work texts. The action's subjects are deliberately absent, which is
  // what lets two work requests for different Families share one id.
  const collidingWorkIdentity = {
    kind: "next-work-request" as const,
    schemaVersion: 1 as const,
    target,
    manifest,
    wave,
    requiredFact: "Resolve the shared adjacent consumer.",
    falsifier: "The adjacent consumer is actor-bound.",
    nextAction: "Inspect the adjacent consumer.",
  };
  const collidingWork = {
    ...collidingWorkIdentity,
    id: sha256Digest({
      kind: "next-work-request" as const,
      target,
      manifest,
      wave,
      requiredFact: collidingWorkIdentity.requiredFact,
      falsifier: collidingWorkIdentity.falsifier,
      nextAction: collidingWorkIdentity.nextAction,
    }),
  };
  const depthAdmission = (name: string) => ({
    kind: "depth-admission" as const,
    schemaVersion: 2 as const,
    id: sha256Digest(`${name}-depth-admission`),
    target,
    manifest,
    wave,
    highImpactPotential: "Adjacent consumers may amplify the impact.",
    composition: "Connect the writer to every privileged consumer.",
    falsifier: "No additional consumer crosses an actor boundary.",
    nextAction: "Trace adjacent source-bound consumers.",
  });
  const value: IterationDecisionV3 = {
    kind: "iteration-decision",
    schemaVersion: 3,
    target,
    manifest,
    wave,
    evaluationSubjects: [alphaSubject, betaSubject],
    context: {
      kind: "wave-evaluation",
      terminalDigest: digest("d"),
      workLeases: [
        {
          kind: "work-lease",
          schemaVersion: 2,
          id: digest("e"),
          digest: digest("f"),
          workWaveDigest: wave.digest,
          targetSnapshotDigest: target.digest,
          manifestDigest: manifest.digest,
        },
      ],
      attemptResults: [],
      toolReceipts: [],
      rootEvaluatorAttempts: [
        {
          kind: "attempt-execution-result",
          schemaVersion: 2,
          attemptId: "root-evaluator-1",
          owner: "exploration",
          role: "root-evaluator",
          planDigest: digest("b"),
          digest: digest("c"),
        },
      ],
    },
    approachFamilies: [alpha.family, beta.family],
    actions: [
      {
        kind: "admit-depth",
        approachFamily: alpha.ref,
        subjects: [alphaSubject],
        admission: depthAdmission("alpha"),
      },
      {
        kind: "admit-depth",
        approachFamily: beta.ref,
        subjects: [betaSubject],
        admission: depthAdmission("beta"),
      },
      {
        kind: "schedule-work",
        subjects: [alphaSubject],
        work: collidingWork,
      },
      {
        kind: "schedule-work",
        subjects: [betaSubject],
        work: collidingWork,
      },
    ],
    campaignDisposition: "continue",
  };
  return {
    decision: value,
    registry: projectInitialApproachFamilyRegistryV3(
      "campaign-depth-collision",
      "run-depth-collision",
      value,
    ).value,
  };
}

describe("projectSemanticDepthWorkQueue", () => {
  it("retains every depth and scheduled-work action in stable batches of at most four", () => {
    const input = decision();
    const first = projectSemanticDepthWorkQueue(input);
    const replayed = projectSemanticDepthWorkQueue(input);

    expect(replayed).toEqual(first);
    expect(first.ref.digest).toBe(sha256Digest(first.value));
    expect(first.value.predecessorDecisionDigest).toBe(sha256Digest(input));
    expect(first.value.items).toHaveLength(6);
    expect(first.value.items.map((item) => item.sourceAction).sort()).toEqual([
      "admit-depth",
      "schedule-work",
      "schedule-work",
      "schedule-work",
      "schedule-work",
      "schedule-work",
    ]);
    expect(first.value.batches.map((batch) => batch.itemIds.length)).toEqual([
      4, 2,
    ]);
    expect(
      first.value.batches.flatMap((batch) => batch.itemIds).sort(),
    ).toEqual(first.value.items.map((item) => item.id).sort());
    expect(JSON.stringify(first.value)).not.toContain("retain");
  });

  it("rejects a foreign Target binding inside a depth action", () => {
    const input = decision();
    const firstAction = input.actions[0];
    if (firstAction?.kind !== "admit-depth") {
      throw new Error("Expected the first action to admit Depth");
    }
    const tampered = {
      ...input,
      actions: [
        {
          ...firstAction,
          admission: {
            ...firstAction.admission,
            target: { ...target, digest: digest("9") },
          },
        },
        ...input.actions.slice(1),
      ],
    } as IterationDecisionV2;

    expect(() => projectSemanticDepthWorkQueue(tampered)).toThrow(
      "Depth work action binding mismatch",
    );
  });
});

describe("projectSemanticDepthWorkQueueV2", () => {
  it("binds shared Validation and Depth work to one current Family without dropping overflow", () => {
    const input = currentDecision();
    const first = projectSemanticDepthWorkQueueV2({
      campaignId: "campaign-depth-v2",
      runId: "run-depth-v2",
      ...input,
    });
    const replayed = projectSemanticDepthWorkQueueV2({
      campaignId: "campaign-depth-v2",
      runId: "run-depth-v2",
      ...input,
    });

    expect(replayed).toEqual(first);
    expect(first.value).toMatchObject({
      schemaVersion: 2,
      campaignId: "campaign-depth-v2",
      runId: "run-depth-v2",
      predecessorDecisionDigest: sha256Digest(input.decision),
    });
    expect(first.value.items).toHaveLength(6);
    expect(first.value.batches.map((batch) => batch.itemIds.length)).toEqual([
      4, 2,
    ]);
    expect(first.value.items.every((item) => item.families.length === 1)).toBe(
      true,
    );
    expect(
      new Set(first.value.items.map((item) => item.families[0]!.id)).size,
    ).toBe(1);
    expect(
      first.value.items.every(
        (item) =>
          item.families[0]!.openingDecisionDigest ===
          sha256Digest(input.decision),
      ),
    ).toBe(true);
    expect(first.ref).toMatchObject({
      campaignId: "campaign-depth-v2",
      runId: "run-depth-v2",
      items: 6,
      batches: 2,
      familyBindings: 6,
    });
  });

  it("binds each scheduled work action to the Family that owns its own subjects when two work requests share one id", () => {
    // The work identity digest covers the three work texts but not the
    // action's subjects, so two requests worded alike collide. Resolving the
    // Family through that id lets the later action's Family overwrite the
    // earlier one's, and the wrong Family is then transitioned by work it does
    // not own.
    const input = collidingDecision();
    const projected = projectSemanticDepthWorkQueueV2({
      campaignId: "campaign-depth-collision",
      runId: "run-depth-collision",
      ...input,
    });
    const familyIdByKey = new Map(
      input.registry.families.map((family) => [
        family.openingAdmission.key,
        family.id,
      ]),
    );
    const scheduled = new Map(
      projected.value.items
        .filter((item) => item.sourceAction === "schedule-work")
        .map((item) => [
          item.subjects[0]?.digest,
          item.families.map((family) => family.id),
        ]),
    );

    expect(scheduled.size).toBe(2);
    expect(scheduled.get(alphaSubject.digest)).toEqual([
      familyIdByKey.get("alpha-route"),
    ]);
    expect(scheduled.get(betaSubject.digest)).toEqual([
      familyIdByKey.get("beta-route"),
    ]);
  });

  it("rejects a Registry from another Campaign and Run", () => {
    const input = currentDecision();
    const foreign = projectInitialApproachFamilyRegistryV3(
      "foreign-campaign",
      "foreign-run",
      input.decision,
    );

    expect(() =>
      projectSemanticDepthWorkQueueV2({
        campaignId: "campaign-depth-v2",
        runId: "run-depth-v2",
        decision: input.decision,
        registry: foreign.value,
      }),
    ).toThrow("Depth work queue Family Registry v3 binding mismatch");
  });
});
