import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  aiReproductionAttemptSchema,
  aiReproductionResultSchema,
  defineCurrentHumanReviewPolicy,
  defineHumanReproductionRecord,
  defineHumanVerificationEnvironmentPolicy,
  defineHumanVerificationRuntimeProfile,
  defineHumanVerificationSetupPlan,
  openCurrentHumanReview,
  setupStageNames,
  triageReproductionPacketSchema,
  type AIReproductionAttempt,
  type AIReproductionResult,
  type HumanReproductionPreparation,
  type HumanReviewAIReproductionReader,
} from "../../src/human-os/index.js";
import { humanOsDigest } from "../../src/human-os/canonical-json.js";
import {
  openFileHumanOsArtifactStore,
  openSqliteHumanOsRecord,
} from "../../src/human-os/human-os-record/index.js";

const fixedNow = "2026-09-05T10:00:00.000Z";
const digest = (character: string): string => `sha256:${character.repeat(64)}`;
const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

function attemptRef(attempt: AIReproductionAttempt) {
  return {
    kind: attempt.kind,
    schemaVersion: attempt.schemaVersion,
    id: attempt.id,
    digest: humanOsDigest(attempt),
    intakeId: attempt.intakeId,
    packetDigest: attempt.packet.digest,
    targetSnapshotDigest: attempt.target.snapshot.digest,
    runtimeProfileDigest: attempt.runtimeProfile.digest,
    setupPlanDigest: attempt.setupPlan.digest,
    toolPolicyDigest: humanOsDigest(attempt.toolPolicy),
  } as const;
}

function attemptFixture(input: {
  readonly character: string;
  readonly version: string;
  readonly impact:
    | "arbitrary-code-execution"
    | "site-wide-compromise"
    | "account-takeover"
    | "sql-injection"
    | "stored-xss"
    | "reflected-xss"
    | "dom-xss"
    | "authorization-bypass"
    | "file-write"
    | "path-traversal"
    | "other";
  readonly causalRoot?: string;
}): AIReproductionAttempt {
  const target = {
    id: `review-plugin-${input.version}`,
    pluginSlug: "review-plugin",
    version: input.version,
    digest: digest(input.character),
  };
  const manifest = {
    kind: "target-file-manifest" as const,
    schemaVersion: 1 as const,
    targetSnapshotId: target.id,
    targetSnapshotDigest: target.digest,
    digest: digest(input.character === "f" ? "e" : "f"),
  };
  const runtimeProfile = defineHumanVerificationRuntimeProfile({
    kind: "human-verification-runtime-profile",
    schemaVersion: 1,
    wordpressVersion: "6.8.2",
    phpVersion: "8.3.24",
    databaseVersion: "11.8.3",
    webServerVersion: "2.4.65",
    isolation: {
      backend: "gvisor",
      runtimeName: "runsc",
      runtimeVersion: "20260901.0",
    },
    images: {
      wordpress: `registry.invalid/wordpress@${digest("1")}`,
      wordpressCli: `registry.invalid/wordpress-cli@${digest("2")}`,
      database: `registry.invalid/mariadb@${digest("3")}`,
      browser: `registry.invalid/browser@${digest("4")}`,
    },
  });
  const setupCriteria = [
    "wordpress-installed",
    "target-files-match-manifest",
    "target-reports-active",
    "canonical-configuration-observed",
    "normal-target-function-observed",
  ] as const;
  const setupPlan = defineHumanVerificationSetupPlan({
    kind: "human-verification-setup-plan",
    schemaVersion: 1,
    pluginSlug: target.pluginSlug,
    mainPluginFile: "plugin.php",
    configuration: {
      siteMode: "single-site",
      locale: "en_US",
      timezone: "UTC",
      variantDigest: null,
    },
    stages: setupStageNames.map((stage, index) => ({
      ordinal: index + 1,
      stage,
      successCriterion: setupCriteria[index]!,
    })),
  });
  const environmentPolicy = defineHumanVerificationEnvironmentPolicy({
    kind: "human-verification-environment-policy",
    schemaVersion: 1,
    isolation: { requiredBackend: "gvisor", silentFallback: false },
    lifecycle: { fresh: true, disposable: true },
    container: {
      privileged: false,
      hostNetwork: false,
      engineSocketMounted: false,
    },
    credentials: {
      ambientCredentials: false,
      credentialBearingHostPaths: false,
      brokeredSecretRefsOnly: true,
    },
    egress: { mode: "deny-all" },
  });
  const identity = {
    kind: "ai-reproduction-attempt" as const,
    schemaVersion: 2 as const,
    intakeId: digest(input.character === "d" ? "c" : "d"),
    packet: {
      kind: "runtime-verification-packet" as const,
      schemaVersion: 2 as const,
      id: digest("8"),
      digest: digest("9"),
      candidateId: digest("a"),
      targetSnapshotDigest: target.digest,
      manifestDigest: manifest.digest,
    },
    target: {
      kind: "human-verification-target" as const,
      schemaVersion: 1 as const,
      snapshot: target,
      manifest,
      sourceArtifact: {
        kind: "content-addressed-target-source" as const,
        mediaType: "application/vnd.wordpress.source-tree+json" as const,
        digest: digest("b"),
      },
    },
    attackerPremise: "unauthenticated" as const,
    causalIdentity: {
      rootCause: input.causalRoot ?? "cross-actor-state",
      attackerControlledPrimitive: "public-state-transition",
      brokenSecurityProperty: "state-ownership",
    },
    securityEffect: {
      impact: input.impact,
      claimedPropertyChange: "state-ownership",
    },
    sourceRoute: [
      {
        ordinal: 1,
        claim: "Public input reaches an ownership-sensitive transition.",
        evidence: [
          {
            path: "plugin.php",
            fileDigest: digest("c"),
            startLine: 10,
            endLine: 20,
          },
        ],
      },
    ],
    runtimeProfile,
    setupPlan,
    environmentPolicy,
    grants: [],
    toolPolicy: {
      kind: "ai-reproduction-tool-policy" as const,
      schemaVersion: 2 as const,
      browser: "harness-mediated" as const,
      http: "harness-mediated" as const,
      runtimeObservation: "harness-mediated" as const,
      ambientHostShell: false as const,
      ambientCredentials: false as const,
      arbitraryNetwork: false as const,
    },
  };
  return aiReproductionAttemptSchema.parse({
    ...identity,
    id: humanOsDigest(identity),
  });
}

function aiRuntimeIdentity(attempt: AIReproductionAttempt) {
  return {
    kind: "ai-reproduction-runtime-identity" as const,
    schemaVersion: 2 as const,
    environmentId: `ai-${attempt.target.snapshot.version.replaceAll(".", "-")}`,
    targetSnapshotDigest: attempt.target.snapshot.digest,
    manifestDigest: attempt.target.manifest.digest,
    runtimeProfileDigest: attempt.runtimeProfile.digest,
    setupPlanDigest: attempt.setupPlan.digest,
    toolPolicyDigest: humanOsDigest(attempt.toolPolicy),
    observedWordpressVersion: attempt.runtimeProfile.wordpressVersion,
    observedPhpVersion: attempt.runtimeProfile.phpVersion,
    observedDatabaseVersion: attempt.runtimeProfile.databaseVersion,
    observedWebServerVersion: attempt.runtimeProfile.webServerVersion,
    observedImages: attempt.runtimeProfile.images,
    isolation: {
      backend: "gvisor" as const,
      runtimeName: "runsc" as const,
      runtimeVersion: attempt.runtimeProfile.isolation.runtimeVersion,
      fallbackUsed: false as const,
    },
    fresh: true as const,
    disposable: true as const,
    hostTargetExecution: false as const,
    ambientHostShell: false as const,
    ambientCredentials: false as const,
    arbitraryNetwork: false as const,
  };
}

function confirmedResult(attempt: AIReproductionAttempt): AIReproductionResult {
  const ref = attemptRef(attempt);
  const privateBase = {
    kind: "human-os-private-artifact" as const,
    schemaVersion: 2 as const,
    attemptId: attempt.id,
    targetSnapshotDigest: attempt.target.snapshot.digest,
    storage: "human-os-private-store" as const,
  };
  const recipe = {
    ...privateBase,
    artifactKind: "reproduction-recipe" as const,
    id: digest("5"),
    digest: digest("6"),
  };
  const privateEvidence = {
    ...privateBase,
    artifactKind: "private-evidence-bundle" as const,
    id: digest("7"),
    digest: digest("8"),
  };
  const runtimeIdentity = aiRuntimeIdentity(attempt);
  const triageIdentity = {
    kind: "triage-reproduction-packet" as const,
    schemaVersion: 2 as const,
    runtimePacket: attempt.packet,
    attempt: ref,
    runtimeIdentity,
    recipe,
    privateEvidence,
    recipeMetadata: {
      class: "generic" as const,
      criterion: {
        class: "generic" as const,
        proof: "security-effect-observation" as const,
        expectedSecurityEffect: "Observe the Packet-bound Security Effect.",
      },
      stepCount: 2,
      expectedSecurityEffect: attempt.securityEffect.claimedPropertyChange,
    },
    observation: {
      securityEffect: "observed" as const,
      description: "The Packet-bound Security Effect was observed.",
    },
    proof: { witness: null, causalControl: null },
    confirmedAt: fixedNow,
    boundary: {
      runtimeConfirmed: true as const,
      humanVerified: false as const,
      findingEligible: false as const,
      humanDisposition: false as const,
      programmeEligibility: false as const,
    },
  };
  const triagePacket = triageReproductionPacketSchema.parse({
    ...triageIdentity,
    id: humanOsDigest(triageIdentity),
  });
  return aiReproductionResultSchema.parse({
    kind: "ai-reproduction-result",
    schemaVersion: 2,
    attempt: ref,
    runtimePacket: attempt.packet,
    completedAt: fixedNow,
    cleanup: "completed",
    status: "runtime-confirmed",
    runtimeIdentity,
    observation: triagePacket.observation,
    recipe,
    privateEvidence,
    triagePacket,
  });
}

function inconclusiveResult(
  attempt: AIReproductionAttempt,
): AIReproductionResult {
  return aiReproductionResultSchema.parse({
    kind: "ai-reproduction-result",
    schemaVersion: 2,
    attempt: attemptRef(attempt),
    runtimePacket: attempt.packet,
    completedAt: fixedNow,
    cleanup: "completed",
    status: "runtime-inconclusive",
    reason: "effect-unclear",
    description: "The runtime effect remained unclear.",
    triagePacket: null,
  });
}

class FixtureAIReader implements HumanReviewAIReproductionReader {
  readonly #campaignId: string;
  readonly #views = new Map<
    string,
    {
      readonly attempt: AIReproductionAttempt;
      readonly result: AIReproductionResult;
    }
  >();

  constructor(campaignId: string) {
    this.#campaignId = campaignId;
  }

  add(attempt: AIReproductionAttempt, result: AIReproductionResult): void {
    this.#views.set(attempt.id, { attempt, result });
  }

  async readAIReproductionResult(attemptId: string) {
    return this.#views.get(attemptId);
  }

  async readAIReproductionIntakeById(intakeId: string) {
    return [...this.#views.values()].some(
      (view) => view.attempt.intakeId === intakeId,
    )
      ? { intake: { campaignId: this.#campaignId, runId: "run-human-v2" } }
      : undefined;
  }
}

function humanEnvironment(
  attempt: AIReproductionAttempt,
  environmentId?: string,
) {
  return {
    status: "ready" as const,
    runtimeIdentity: {
      kind: "human-reproduction-runtime-identity" as const,
      schemaVersion: 2 as const,
      environmentId:
        environmentId ??
        `human-${attempt.target.snapshot.version.replaceAll(".", "-")}`,
      targetSnapshotDigest: attempt.target.snapshot.digest,
      manifestDigest: attempt.target.manifest.digest,
      runtimeProfileDigest: attempt.runtimeProfile.digest,
      setupPlanDigest: attempt.setupPlan.digest,
      observedWordpressVersion: attempt.runtimeProfile.wordpressVersion,
      observedPhpVersion: attempt.runtimeProfile.phpVersion,
      observedDatabaseVersion: attempt.runtimeProfile.databaseVersion,
      observedWebServerVersion: attempt.runtimeProfile.webServerVersion,
      observedImages: attempt.runtimeProfile.images,
      isolation: {
        backend: "gvisor" as const,
        runtimeName: "runsc" as const,
        runtimeVersion: attempt.runtimeProfile.isolation.runtimeVersion,
        fallbackUsed: false as const,
      },
      fresh: true as const,
      disposable: true as const,
      hostTargetExecution: false as const,
      ambientHostShell: false as const,
      ambientCredentials: false as const,
      arbitraryNetwork: false as const,
    },
  };
}

async function fixture(input?: {
  readonly activeConcurrency?: number;
  readonly reader?: FixtureAIReader;
  readonly versionReview?: (attempt: AIReproductionAttempt) => unknown;
  readonly environmentId?: (attempt: AIReproductionAttempt) => string;
}) {
  const directory = await mkdtemp(join(tmpdir(), "current-human-review-"));
  directories.push(directory);
  const databasePath = join(directory, "human-os.sqlite");
  const artifactDirectory = join(directory, "artifacts");
  const store = openSqliteHumanOsRecord({
    databasePath,
    artifactStore: openFileHumanOsArtifactStore(artifactDirectory),
    clock: () => new Date(fixedNow),
  });
  const reader = input?.reader ?? new FixtureAIReader("campaign-human-v2");
  const policy = defineCurrentHumanReviewPolicy({
    kind: "current-human-review-policy",
    schemaVersion: 2,
    activeConcurrency: input?.activeConcurrency ?? 1,
    highImpactEscalation: [
      "arbitrary-code-execution",
      "site-wide-compromise",
      "account-takeover",
      "sql-injection",
    ],
  });
  const service = openCurrentHumanReview({
    store,
    aiReproductionReader: reader,
    policy,
    versionReviewer: {
      review: async ({ attempt }) =>
        input?.versionReview?.(attempt) ?? { status: "current" },
    },
    environment: {
      establish: async ({ attempt }) =>
        humanEnvironment(attempt, input?.environmentId?.(attempt)),
    },
    clock: () => new Date(fixedNow),
  });
  return { service, reader, policy, databasePath, artifactDirectory };
}

function verifiedRecord(input: {
  readonly preparation: HumanReproductionPreparation;
  readonly caseId: string;
  readonly status?: "verified-finding" | "rejected";
}) {
  if (input.preparation.status !== "ready") {
    throw new Error("Expected ready preparation");
  }
  const status = input.status ?? "verified-finding";
  return defineHumanReproductionRecord({
    kind: "human-reproduction-record",
    schemaVersion: 2,
    caseId: input.caseId,
    preparationId: input.preparation.id,
    attempt: input.preparation.selectedAttempt,
    triagePacketId: input.preparation.triagePacket.id,
    environment: input.preparation.environment,
    environmentCleanup: "completed",
    reviewer: { kind: "human-reviewer", id: "reviewer-1" },
    performedAt: fixedNow,
    attackerRole: "unauthenticated",
    recipeExecution: {
      recipe: input.preparation.triagePacket.recipe,
      startedAt: fixedNow,
      completedAt: fixedNow,
      completedStepOrdinals: [1, 2],
      exactPayloadAndStepsUsed: true,
      deviation: { kind: "none" },
    },
    securityEffect: {
      status: status === "verified-finding" ? "observed" : "not-observed",
      description:
        status === "verified-finding"
          ? "The human reproduced the Packet-bound Security Effect."
          : "The exact Recipe completed without the Security Effect.",
    },
    disposition: {
      status,
      reason:
        status === "verified-finding"
          ? "A fresh human reproduction observed the Security Effect."
          : "A matching fresh reproduction did not observe the Security Effect.",
    },
  });
}

describe("Current Human Review", () => {
  it("keeps an unlimited deferred queue and promotes the stable highest-priority Case", async () => {
    const { service, reader, policy, databasePath, artifactDirectory } =
      await fixture();
    const active = attemptFixture({
      character: "1",
      version: "1.0.0",
      impact: "stored-xss",
    });
    const lowerDeferred = attemptFixture({
      character: "2",
      version: "1.0.1",
      impact: "other",
    });
    const higherDeferred = attemptFixture({
      character: "3",
      version: "1.0.2",
      impact: "site-wide-compromise",
    });
    for (const attempt of [active, lowerDeferred, higherDeferred]) {
      reader.add(attempt, confirmedResult(attempt));
      await service.admit(attempt.id);
    }

    const before = await service.readQueue("campaign-human-v2");
    expect(
      before.active.map((item) => item.reviewCase.originAttempt.id),
    ).toEqual([active.id]);
    expect(
      before.deferred.map((item) => item.reviewCase.originAttempt.id),
    ).toEqual([higherDeferred.id, lowerDeferred.id]);

    const activeCase = before.active[0]!;
    const preparation = await service.prepare(activeCase.reviewCase.id);
    const result = await service.record(
      verifiedRecord({ preparation, caseId: activeCase.reviewCase.id }),
    );

    expect(result.finding).toMatchObject({
      originalTarget: active.target.snapshot,
      verifiedTarget: active.target.snapshot,
      aiAttempt: { id: active.id },
      triagePacketId:
        preparation.status === "ready" ? preparation.triagePacket.id : "",
      externalAction: { status: "not-authorized" },
    });
    const after = await service.readQueue("campaign-human-v2");
    expect(after.active[0]?.reviewCase.originAttempt.id).toBe(
      higherDeferred.id,
    );
    expect(after.deferred[0]?.reviewCase.originAttempt.id).toBe(
      lowerDeferred.id,
    );
    expect(after.completed[0]?.result?.result.finding?.id).toBe(
      result.finding?.id,
    );

    const reopened = openCurrentHumanReview({
      store: openSqliteHumanOsRecord({
        databasePath,
        artifactStore: openFileHumanOsArtifactStore(artifactDirectory),
        clock: () => new Date(fixedNow),
      }),
      aiReproductionReader: reader,
      policy,
      versionReviewer: { review: async () => ({ status: "current" }) },
      environment: {
        establish: async ({ attempt }) => humanEnvironment(attempt),
      },
      clock: () => new Date(fixedNow),
    });
    expect(await reopened.readQueue("campaign-human-v2")).toEqual(after);
  });

  it("keeps high-impact inconclusive work in a manually selected Escalation Queue", async () => {
    const { service, reader } = await fixture();
    const high = attemptFixture({
      character: "4",
      version: "2.0.0",
      impact: "sql-injection",
    });
    const low = attemptFixture({
      character: "5",
      version: "2.0.1",
      impact: "other",
    });
    reader.add(high, inconclusiveResult(high));
    reader.add(low, inconclusiveResult(low));

    const admitted = await service.admit(high.id);
    expect(admitted.status).toBe("admitted");
    expect(await service.admit(low.id)).toEqual({
      status: "not-admitted",
      reason: "not-runtime-confirmed-or-high-impact-inconclusive",
    });
    const queue = await service.readQueue("campaign-human-v2");
    expect(queue.active).toHaveLength(0);
    expect(queue.escalation).toHaveLength(1);

    const selected = await service.selectEscalation(
      queue.escalation[0]!.reviewCase.id,
      "reviewer-1",
    );
    expect(selected).toMatchObject({
      queueStatus: "escalation",
      escalationSelected: true,
    });
    await expect(service.prepare(selected.reviewCase.id)).rejects.toThrow(
      "Only an active Case",
    );
  });

  it("refreshes AI reproduction for a new stable version while preserving the Campaign origin", async () => {
    const reader = new FixtureAIReader("campaign-human-v2");
    const original = attemptFixture({
      character: "6",
      version: "3.0.0",
      impact: "account-takeover",
    });
    const refreshed = attemptFixture({
      character: "7",
      version: "3.1.0",
      impact: "account-takeover",
    });
    reader.add(original, confirmedResult(original));
    reader.add(refreshed, confirmedResult(refreshed));
    const { service } = await fixture({
      reader,
      versionReview: () => ({
        status: "refreshed",
        refreshedAttemptId: refreshed.id,
      }),
    });
    const admission = await service.admit(original.id);
    if (admission.status === "not-admitted") throw new Error("Expected Case");

    const preparation = await service.prepare(admission.view.reviewCase.id);

    expect(preparation).toMatchObject({
      status: "ready",
      versionReview: {
        status: "refreshed",
        originalTarget: original.target.snapshot,
        selectedTarget: refreshed.target.snapshot,
      },
      selectedAttempt: { id: refreshed.id },
      environment: { targetSnapshotDigest: refreshed.target.snapshot.digest },
    });
    const result = await service.record(
      verifiedRecord({ preparation, caseId: admission.view.reviewCase.id }),
    );
    expect(result.finding).toMatchObject({
      originalTarget: original.target.snapshot,
      verifiedTarget: refreshed.target.snapshot,
      aiAttempt: { id: refreshed.id },
    });
  });

  it("blocks a refreshed version that changes the causal claim", async () => {
    const reader = new FixtureAIReader("campaign-human-v2");
    const original = attemptFixture({
      character: "8",
      version: "4.0.0",
      impact: "site-wide-compromise",
    });
    const changed = attemptFixture({
      character: "9",
      version: "4.1.0",
      impact: "site-wide-compromise",
      causalRoot: "different-root-cause",
    });
    reader.add(original, confirmedResult(original));
    reader.add(changed, confirmedResult(changed));
    const { service } = await fixture({
      reader,
      versionReview: () => ({
        status: "refreshed",
        refreshedAttemptId: changed.id,
      }),
    });
    const admission = await service.admit(original.id);
    if (admission.status === "not-admitted") throw new Error("Expected Case");

    expect(await service.prepare(admission.view.reviewCase.id)).toMatchObject({
      status: "blocked",
      reason: "causal-identity-changed",
      selectedAttempt: null,
    });
  });

  it("requires a different fresh environment and the complete exact Recipe before a terminal disposition", async () => {
    const sameEnvironmentAttempt = attemptFixture({
      character: "a",
      version: "5.0.0",
      impact: "authorization-bypass",
    });
    const sameReader = new FixtureAIReader("campaign-human-v2");
    sameReader.add(
      sameEnvironmentAttempt,
      confirmedResult(sameEnvironmentAttempt),
    );
    const { service: sameEnvironmentService } = await fixture({
      reader: sameReader,
      environmentId: (attempt) => aiRuntimeIdentity(attempt).environmentId,
    });
    const sameAdmission = await sameEnvironmentService.admit(
      sameEnvironmentAttempt.id,
    );
    if (sameAdmission.status === "not-admitted")
      throw new Error("Expected Case");
    expect(
      await sameEnvironmentService.prepare(sameAdmission.view.reviewCase.id),
    ).toMatchObject({
      status: "blocked",
      reason: "environment-not-fresh",
    });

    const { service, reader } = await fixture();
    const attempt = attemptFixture({
      character: "b",
      version: "5.1.0",
      impact: "authorization-bypass",
    });
    reader.add(attempt, confirmedResult(attempt));
    const admission = await service.admit(attempt.id);
    if (admission.status === "not-admitted") throw new Error("Expected Case");
    const preparation = await service.prepare(admission.view.reviewCase.id);
    if (preparation.status !== "ready") throw new Error("Expected ready");

    const validRejection = verifiedRecord({
      preparation,
      caseId: admission.view.reviewCase.id,
      status: "rejected",
    });
    const recipeExecution = validRejection.recipeExecution;
    if (recipeExecution === null) {
      throw new Error("Expected Recipe execution");
    }
    const { id: _id, ...rejectionIdentity } = validRejection;
    expect(() =>
      defineHumanReproductionRecord({
        ...rejectionIdentity,
        recipeExecution: {
          ...recipeExecution,
          exactPayloadAndStepsUsed: false,
        },
      }),
    ).toThrow();

    const rejected = await service.record(
      verifiedRecord({
        preparation,
        caseId: admission.view.reviewCase.id,
        status: "rejected",
      }),
    );
    expect(rejected).toMatchObject({
      verification: { disposition: { status: "rejected" } },
      finding: null,
    });
  });

  it("records ambiguous runtime evidence and role mismatch without creating a Finding", async () => {
    const { service, reader } = await fixture({ activeConcurrency: 2 });
    const ambiguousAttempt = attemptFixture({
      character: "c",
      version: "6.0.0",
      impact: "file-write",
    });
    const roleAttempt = attemptFixture({
      character: "d",
      version: "6.0.1",
      impact: "file-write",
    });
    reader.add(ambiguousAttempt, confirmedResult(ambiguousAttempt));
    reader.add(roleAttempt, confirmedResult(roleAttempt));
    const ambiguousAdmission = await service.admit(ambiguousAttempt.id);
    const roleAdmission = await service.admit(roleAttempt.id);
    if (
      ambiguousAdmission.status === "not-admitted" ||
      roleAdmission.status === "not-admitted"
    ) {
      throw new Error("Expected active Cases");
    }
    const ambiguousPreparation = await service.prepare(
      ambiguousAdmission.view.reviewCase.id,
    );
    const rolePreparation = await service.prepare(
      roleAdmission.view.reviewCase.id,
    );
    if (
      ambiguousPreparation.status !== "ready" ||
      rolePreparation.status !== "ready"
    ) {
      throw new Error("Expected ready Preparations");
    }

    const ambiguous = await service.record(
      defineHumanReproductionRecord({
        kind: "human-reproduction-record",
        schemaVersion: 2,
        caseId: ambiguousAdmission.view.reviewCase.id,
        preparationId: ambiguousPreparation.id,
        attempt: ambiguousPreparation.selectedAttempt,
        triagePacketId: ambiguousPreparation.triagePacket.id,
        environment: ambiguousPreparation.environment,
        environmentCleanup: "completed",
        reviewer: { kind: "human-reviewer", id: "reviewer-1" },
        performedAt: fixedNow,
        attackerRole: "unauthenticated",
        recipeExecution: {
          recipe: ambiguousPreparation.triagePacket.recipe,
          startedAt: fixedNow,
          completedAt: fixedNow,
          completedStepOrdinals: [1],
          exactPayloadAndStepsUsed: false,
          deviation: {
            kind: "minor",
            description: "The final observation remained ambiguous.",
          },
        },
        securityEffect: {
          status: "uncertain",
          description: "The terminal Security Effect remained ambiguous.",
        },
        disposition: {
          status: "runtime-inconclusive",
          reason: "The human could not close the terminal observation.",
        },
      }),
    );
    expect(ambiguous).toMatchObject({
      verification: { disposition: { status: "runtime-inconclusive" } },
      finding: null,
    });

    const blocked = await service.record(
      defineHumanReproductionRecord({
        kind: "human-reproduction-record",
        schemaVersion: 2,
        caseId: roleAdmission.view.reviewCase.id,
        preparationId: rolePreparation.id,
        attempt: rolePreparation.selectedAttempt,
        triagePacketId: rolePreparation.triagePacket.id,
        environment: rolePreparation.environment,
        environmentCleanup: "completed",
        reviewer: { kind: "human-reviewer", id: "reviewer-1" },
        performedAt: fixedNow,
        attackerRole: "subscriber",
        recipeExecution: null,
        securityEffect: {
          status: "uncertain",
          description: "The required attacker role could not be reproduced.",
        },
        disposition: {
          status: "blocked",
          reason: "The prepared attacker role did not match the Recipe.",
          blocker: "role-mismatch",
        },
      }),
    );
    expect(blocked).toMatchObject({
      verification: { disposition: { status: "blocked" } },
      finding: null,
    });
  });
});
