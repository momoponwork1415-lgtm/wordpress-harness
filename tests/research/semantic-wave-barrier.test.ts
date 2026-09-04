import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  closeSemanticWaveBarrier,
  type SemanticWaveTerminalAttempt,
} from "../../src/research/campaign-control/semantic-wave-barrier.js";
import type { SemanticWorkWavePlan } from "../../src/research/exploration/semantic-contracts.js";
import { sha256Digest } from "../../src/research/research-record/canonical-json.js";
import { openFileJsonArtifactStore } from "../../src/research/research-record/file-json-artifact-store.js";

const digest = (character: string): string => `sha256:${character.repeat(64)}`;

const target = {
  id: "snapshot:barrier",
  pluginSlug: "barrier-fixture",
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

function wave(): SemanticWorkWavePlan {
  const thesis = {
    kind: "research-thesis" as const,
    schemaVersion: 1 as const,
    id: digest("3"),
    target,
    manifest,
    scope: "wildcard" as const,
    securityAssumption:
      "A security-sensitive state transition may be unguarded.",
    question: "Which security meaning is broken?",
    motivation: "Test the semantic barrier.",
    startingBasis: "Raw source only.",
    independence: "This thesis is independently derived.",
  };
  return {
    kind: "work-wave-plan",
    schemaVersion: 2,
    id: digest("4"),
    ref: {
      kind: "work-wave",
      schemaVersion: 2,
      id: digest("4"),
      digest: digest("5"),
      targetSnapshotDigest: target.digest,
      manifestDigest: manifest.digest,
    },
    purpose: { kind: "raw-source" },
    target,
    manifest,
    policy: {
      kind: "semantic-root-planning-policy",
      schemaVersion: 1,
      id: "barrier-policy",
      digest: digest("6"),
    },
    plannerAttempt: {
      kind: "attempt-execution-result",
      schemaVersion: 2,
      attemptId: "planner-attempt",
      owner: "exploration",
      role: "root-planner",
      planDigest: digest("7"),
      digest: digest("8"),
    },
    theses: [thesis],
    leases: [
      {
        kind: "work-lease",
        schemaVersion: 2,
        id: digest("9"),
        role: "finder",
        target,
        manifest,
        assignment: {
          kind: "research-thesis",
          schemaVersion: 1,
          thesisId: thesis.id,
        },
        budget: {
          maxWallTimeMs: 1_000,
          maxModelTokens: 1_000,
          maxModelTurns: 6,
          maxProviderCostUsd: 0.025,
          maxHypotheses: 4,
          maxOutputBytes: 10_000,
          maxSourceQueries: 4,
        },
      },
    ],
  };
}

const anchor = {
  path: "plugin.php",
  fileDigest: digest("a"),
  startLine: 10,
  endLine: 12,
};

const fragment = {
  kind: "route-fragment-proposal" as const,
  schemaVersion: 1 as const,
  attackerPremise: "unauthenticated" as const,
  preconditions: ["A public callback reaches this operation."],
  operation: "Read security-sensitive persistent state.",
  consumedValues: [
    { identity: "state-key", provenance: "attacker-controlled" as const },
  ],
  producedValues: [{ identity: "state-value", capability: "read" as const }],
  stateTransitions: [
    {
      stateIdentity: "plugin-state",
      operation: "read" as const,
      effect: "The persisted value crosses the response boundary.",
    },
  ],
  evidence: [anchor],
  unknowns: [
    {
      claim: "The state may contain sensitive values.",
      requiredEvidence: "Trace every writer of the state.",
    },
  ],
  falsifier: "The state only contains public constants.",
  nextInvestigation: "Trace writers and authorization guards.",
};

const hypothesis = {
  kind: "source-bound-hypothesis" as const,
  schemaVersion: 1 as const,
  causalIdentity: {
    rootCause: "missing-authorization",
    attackerControlledPrimitive: "public-request",
    brokenSecurityProperty: "state-confidentiality",
  },
  attackerPremise: "unauthenticated" as const,
  impact: "authorization-bypass" as const,
  route: { anchors: [anchor] },
  unknowns: [
    {
      claim: "The callback is public.",
      requiredEvidence: "Inspect route registration.",
    },
  ],
  falsifier: "A mandatory authorization guard dominates the read.",
  nextExperiment: "Verify the callback from a fresh unauthenticated Lab.",
};

const gap = {
  kind: "frontier-gap-proposal" as const,
  schemaVersion: 1 as const,
  requiredFact: "Whether every state writer enforces ownership.",
  sourceEvidence: [anchor],
  falsifier: "All writers derive the owner from the authenticated principal.",
  nextAction: "Trace the complete writer set.",
};

function completedAttempt(
  attemptId: string,
  leaseId: string,
  output: unknown,
): SemanticWaveTerminalAttempt {
  const planDigest = sha256Digest({ attemptId, leaseId });
  const value = {
    kind: "model-attempt-result" as const,
    schemaVersion: 2 as const,
    attemptId,
    owner: "exploration" as const,
    role: "finder" as const,
    planDigest,
    status: "completed" as const,
    output,
  };
  return {
    ref: {
      kind: "attempt-execution-result",
      schemaVersion: 2,
      attemptId,
      owner: "exploration",
      role: "finder",
      planDigest,
      digest: sha256Digest(value),
    },
    value,
    expectedLeaseId: leaseId,
    maxCandidates: 4,
  };
}

describe("semantic Wave barrier", () => {
  it("preserves every candidate and converges regardless of arrival order", async () => {
    const firstDirectory = await mkdtemp(join(tmpdir(), "wave-barrier-first-"));
    const secondDirectory = await mkdtemp(
      join(tmpdir(), "wave-barrier-second-"),
    );
    const firstStore = openFileJsonArtifactStore(firstDirectory);
    const secondStore = openFileJsonArtifactStore(secondDirectory);
    const workWave = wave();
    const first = completedAttempt("finder-a", digest("9"), {
      kind: "finder-output",
      schemaVersion: 2,
      leaseId: digest("9"),
      hypotheses: [hypothesis],
      routeFragments: [fragment],
      frontierGaps: [gap],
    });
    const second = completedAttempt("finder-b", digest("b"), {
      kind: "finder-output",
      schemaVersion: 2,
      leaseId: digest("b"),
      hypotheses: [],
      routeFragments: [fragment],
      frontierGaps: [],
    });

    try {
      const forward = await closeSemanticWaveBarrier(
        firstStore,
        workWave,
        [{ path: anchor.path, digest: anchor.fileDigest, size: 100 }],
        [first, second],
      );
      const reverse = await closeSemanticWaveBarrier(
        secondStore,
        workWave,
        [{ path: anchor.path, digest: anchor.fileDigest, size: 100 }],
        [second, first],
      );

      expect(reverse).toEqual(forward);
      expect(forward).toMatchObject({
        hypotheses: [{ attemptId: "finder-a" }],
        frontierGaps: [{ attemptId: "finder-a" }],
        issues: [],
      });
      expect(
        forward.routeFragments.map((candidate) => candidate.attemptId).sort(),
      ).toEqual(["finder-a", "finder-b"]);
      expect(forward.routeFragments[0]!.id).toBe(forward.routeFragments[1]!.id);
      expect(forward.routeFragments[0]!.digest).not.toBe(
        forward.routeFragments[1]!.digest,
      );
      const storedFragment = await firstStore.readJson(
        forward.routeFragments[0]!.digest,
      );
      expect(storedFragment).toMatchObject({
        kind: "route-fragment",
        workWave: workWave.ref,
        target,
        manifest,
        value: fragment,
      });
    } finally {
      await Promise.all([
        rm(firstDirectory, { force: true, recursive: true }),
        rm(secondDirectory, { force: true, recursive: true }),
      ]);
    }
  });

  it("reports partial, malformed, and foreign-anchor Attempts without candidates", async () => {
    const directory = await mkdtemp(join(tmpdir(), "wave-barrier-invalid-"));
    const store = openFileJsonArtifactStore(directory);
    const workWave = wave();
    const foreign = completedAttempt("finder-c", digest("c"), {
      kind: "finder-output",
      schemaVersion: 2,
      leaseId: digest("c"),
      hypotheses: [],
      routeFragments: [
        {
          ...fragment,
          evidence: [{ ...anchor, path: "foreign.php" }],
        },
      ],
      frontierGaps: [],
    });
    const malformed = completedAttempt("finder-b", digest("b"), {
      kind: "finder-output",
      schemaVersion: 2,
      leaseId: digest("b"),
      hypotheses: [],
      routeFragments: [],
    });
    const partialPlanDigest = sha256Digest({ attemptId: "finder-a" });
    const partial: SemanticWaveTerminalAttempt = {
      ref: {
        kind: "attempt-execution-result",
        schemaVersion: 2,
        attemptId: "finder-a",
        owner: "exploration",
        role: "finder",
        planDigest: partialPlanDigest,
        digest: digest("d"),
      },
      value: {
        kind: "model-attempt-result",
        schemaVersion: 2,
        attemptId: "finder-a",
        owner: "exploration",
        role: "finder",
        planDigest: partialPlanDigest,
        status: "provider-failed",
        reason: "Provider exited before a complete result.",
      },
      expectedLeaseId: digest("a"),
      maxCandidates: 4,
    };

    try {
      const terminal = await closeSemanticWaveBarrier(
        store,
        workWave,
        [{ path: anchor.path, digest: anchor.fileDigest, size: 100 }],
        [foreign, malformed, partial],
      );

      expect(terminal).toMatchObject({
        hypotheses: [],
        routeFragments: [],
        frontierGaps: [],
        issues: [
          { attemptId: "finder-a", reason: "partial-finder-output" },
          { attemptId: "finder-b", reason: "invalid-finder-output" },
          { attemptId: "finder-c", reason: "foreign-source-anchor" },
        ],
      });
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });
});
