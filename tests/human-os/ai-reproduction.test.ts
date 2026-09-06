import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  aiReproductionHarnessExecutionSchema,
  defineHumanVerificationEnvironmentPolicy,
  defineHumanVerificationRuntimeProfile,
  defineHumanVerificationSetupPlan,
  openAIReproduction,
  setupStageNames,
  type AIReproductionAttempt,
  type AIReproductionClass,
  type AIReproductionHarness,
} from "../../src/human-os/index.js";
import { humanOsDigest } from "../../src/human-os/canonical-json.js";
import {
  openFileHumanOsArtifactStore,
  openFileHumanOsPrivateArtifactStore,
  openSqliteHumanOsRecord,
} from "../../src/human-os/human-os-record/index.js";
import { sha256Digest } from "../../src/research/research-record/canonical-json.js";
import {
  defineRuntimeVerificationPacketDeliveryRequest,
  prepareRuntimeVerificationPacket,
  type RuntimeVerificationPacket,
} from "../../src/research/validation/runtime-verification-packet.js";
import {
  currentValidationRecordSchema,
  legacyValidationCandidateId,
  legacyValidationCandidateSchema,
  validationCriteria,
} from "../../src/research/validation/contracts.js";

const fixedNow = "2026-09-05T08:00:00.000Z";
const digest = (character: string): string => `sha256:${character.repeat(64)}`;
const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

function runtimePacket(): RuntimeVerificationPacket {
  const target = {
    id: "ai-runtime-plugin-1.2.3",
    pluginSlug: "ai-runtime-plugin",
    version: "1.2.3",
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
  const anchor = {
    path: "plugin.php",
    fileDigest: digest("5"),
    startLine: 10,
    endLine: 20,
  };
  const hypothesisIdentity = {
    kind: "source-bound-hypothesis" as const,
    targetSnapshotDigest: target.digest,
    manifestDigest: manifest.digest,
    value: {
      kind: "source-bound-hypothesis" as const,
      schemaVersion: 1 as const,
      causalIdentity: {
        rootCause: "request-data-enters-query-structure",
        attackerControlledPrimitive: "public-query-parameter",
        brokenSecurityProperty: "query-data-boundary",
      },
      attackerPremise: "unauthenticated" as const,
      impact: "sql-injection" as const,
      route: { anchors: [anchor] },
      unknowns: [
        {
          claim: "Runtime database effect remains unobserved.",
          requiredEvidence: "Observe a bounded database effect in a fresh lab.",
        },
      ],
      falsifier: "The query structure is independent of public input.",
      nextExperiment: "Exercise the real public Target interface.",
    },
  };
  const hypothesis = {
    kind: "source-bound-hypothesis" as const,
    schemaVersion: 2 as const,
    id: sha256Digest(hypothesisIdentity),
    target,
    manifest,
    workWave: wave,
    attemptId: "finder-ai-reproduction",
    leaseId: digest("6"),
    value: hypothesisIdentity.value,
  };
  const candidateIdentity = {
    target,
    manifest,
    attackerPremise: "unauthenticated" as const,
    brokenSecurityProperty: "query-data-boundary",
    causalRoute: [
      {
        ordinal: 1,
        claim: "Public input reaches database query structure.",
        evidence: [anchor],
      },
    ],
  };
  const candidate = legacyValidationCandidateSchema.parse({
    kind: "validation-candidate",
    schemaVersion: 1,
    id: legacyValidationCandidateId(candidateIdentity),
    ...candidateIdentity,
    origins: [
      {
        subjectDigest: sha256Digest(hypothesis),
        rootEvaluationDigest: digest("7"),
        approachFamilyId: digest("8"),
      },
    ],
  });
  const criteria = validationCriteria.map((criterion) => ({
    criterion,
    status:
      criterion === "counterevidence-and-proof-gap"
        ? ("unknown" as const)
        : ("pass" as const),
    reason: `Independent source review resolved ${criterion}.`,
    evidence: [anchor],
  }));
  const validation = currentValidationRecordSchema.parse({
    kind: "validation-record",
    schemaVersion: 2,
    validationId: candidate.id,
    candidateId: candidate.id,
    planDigest: digest("9"),
    validatorAttempt: {
      status: "completed",
      execution: {
        kind: "attempt-execution-result",
        schemaVersion: 2,
        attemptId: "validator-ai-runtime-1",
        owner: "validation",
        role: "validator",
        planDigest: digest("a"),
        digest: digest("b"),
      },
      output: {
        kind: "validation-attempt-output",
        schemaVersion: 2,
        candidateId: candidate.id,
        criteria,
        proposedDisposition: "ready-for-runtime",
      },
    },
    status: "ready-for-runtime",
  });
  const threatContextIdentity = {
    kind: "validation-threat-context" as const,
    schemaVersion: 1 as const,
    targetSnapshotDigest: target.digest,
    candidateId: candidate.id,
    wordpressBaseline: {
      id: "wordpress-threat-baseline-v1",
      digest: digest("c"),
    },
    permittedAttacker: "unauthenticated" as const,
    publicSurface: ["Public WordPress request handler"],
    technicalExclusions: [],
  };
  const result = prepareRuntimeVerificationPacket({
    candidate,
    hypothesis,
    validation,
    threatContext: {
      ...threatContextIdentity,
      id: sha256Digest(threatContextIdentity),
    },
  });
  if (result.kind !== "prepared") throw new Error("Expected Runtime Packet");
  return result.packet;
}

function environmentInputs(packet: RuntimeVerificationPacket) {
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
      wordpress: `registry.invalid/wordpress@${digest("d")}`,
      wordpressCli: `registry.invalid/wordpress-cli@${digest("e")}`,
      database: `registry.invalid/mariadb@${digest("f")}`,
      browser: `registry.invalid/browser@${digest("0")}`,
    },
  });
  const successCriteria = [
    "wordpress-installed",
    "target-files-match-manifest",
    "target-reports-active",
    "canonical-configuration-observed",
    "normal-target-function-observed",
  ] as const;
  const setupPlan = defineHumanVerificationSetupPlan({
    kind: "human-verification-setup-plan",
    schemaVersion: 1,
    pluginSlug: packet.target.pluginSlug,
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
      successCriterion: successCriteria[index]!,
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
  return {
    target: {
      kind: "human-verification-target" as const,
      schemaVersion: 1 as const,
      snapshot: packet.target,
      manifest: packet.manifest,
      sourceArtifact: {
        kind: "content-addressed-target-source" as const,
        mediaType: "application/vnd.wordpress.source-tree+json" as const,
        digest: digest("a"),
      },
    },
    runtimeProfile,
    setupPlan,
    environmentPolicy,
    grants: [],
  };
}

function runtimeIdentity(attempt: AIReproductionAttempt) {
  return {
    kind: "ai-reproduction-runtime-identity" as const,
    schemaVersion: 2 as const,
    environmentId: "fresh-ai-lab-1",
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

function criterionFor(reproductionClass: AIReproductionClass) {
  switch (reproductionClass) {
    case "sql-injection":
      return {
        class: reproductionClass,
        proof: "database-security-effect" as const,
        expectedDatabaseEffect:
          "The bounded database effect used item=1 OR 1=1.",
      };
    case "cross-site-scripting":
      return {
        class: reproductionClass,
        proof: "browser-execution-canary" as const,
        expectedBrowserEffect: "A nonce browser canary is observed.",
      };
    case "authorization":
      return {
        class: reproductionClass,
        proof: "cross-role-security-effect" as const,
        expectedOwnershipEffect: "Another actor owned state changes.",
      };
    case "file-operation":
      return {
        class: reproductionClass,
        proof: "filesystem-security-effect" as const,
        expectedFilesystemEffect: "A bounded plugin file state changes.",
      };
    case "code-execution":
      return {
        class: reproductionClass,
        proof: "execution-canary" as const,
        canaryDigest: digest("1"),
        expectedCanaryEffect: "A disposable nonce canary is observed.",
      };
    case "generic":
      return {
        class: reproductionClass,
        proof: "security-effect-observation" as const,
        expectedSecurityEffect: "The Packet claimed property changes.",
      };
  }
}

function confirmedExecution(
  attempt: AIReproductionAttempt,
  reproductionClass: AIReproductionClass = "sql-injection",
) {
  const payload = {
    id: "payload-1",
    mediaType: "application/x-www-form-urlencoded" as const,
    exactValue: "item=1 OR 1=1",
  };
  return {
    kind: "ai-reproduction-harness-execution" as const,
    schemaVersion: 2 as const,
    status: "runtime-confirmed" as const,
    completedAt: fixedNow,
    runtimeIdentity: runtimeIdentity(attempt),
    observation: {
      securityEffect: "observed" as const,
      description: "The bounded effect used item=1 OR 1=1.",
    },
    recipe: {
      class: reproductionClass,
      initialState: ["Use the canonical fresh WordPress state."],
      actors: {
        attackerRole: attempt.attackerPremise,
        victimRole: null,
      },
      surface: "Use the public Target request interface.",
      payloads: [payload],
      steps: [
        {
          ordinal: 1,
          interface: "wordpress-rest-api" as const,
          actor: "attacker" as const,
          action: "Submit the bounded request using payload-1.",
          payloadId: payload.id,
          expectedObservation: "Observe the bounded database result set.",
        },
      ],
      criterion: criterionFor(reproductionClass),
    },
    privateEvidence: {
      exactPayloads: [payload],
      rawHttpRequests: [
        "POST /wp-json/ai-runtime-plugin/v1/items HTTP/1.1\nContent-Type: application/x-www-form-urlencoded\n\nitem=1 OR 1=1",
      ],
      screenshots: [
        {
          id: "screenshot-1",
          digest: digest("2"),
          mediaType: "image/png" as const,
        },
      ],
      runtimeLogs: [
        {
          id: "runtime-log-1",
          digest: digest("3"),
          mediaType: "text/plain" as const,
        },
      ],
      redaction: {
        credentialsIncluded: false as const,
        cookiesIncluded: false as const,
        privateTranscriptIncluded: false as const,
        hostInformationIncluded: false as const,
      },
    },
    proof: {
      witness: {
        observationDigest: digest("4"),
        description:
          "The bounded witness used item=1 OR 1=1 to produce the Security Effect.",
      },
      causalControl: null,
    },
    cleanup: "completed" as const,
  };
}

async function serviceFixture(harness: AIReproductionHarness) {
  const directory = await mkdtemp(join(tmpdir(), "ai-reproduction-"));
  directories.push(directory);
  const publicArtifactsDirectory = join(directory, "public-artifacts");
  const privateArtifactsDirectory = join(directory, "private-artifacts");
  const record = openSqliteHumanOsRecord({
    databasePath: join(directory, "human-os.sqlite"),
    artifactStore: openFileHumanOsArtifactStore(publicArtifactsDirectory),
    clock: () => new Date(fixedNow),
  });
  const privateArtifactStore = openFileHumanOsPrivateArtifactStore(
    privateArtifactsDirectory,
  );
  const service = openAIReproduction({
    record,
    privateArtifactStore,
    harness,
    clock: () => new Date(fixedNow),
  });
  const packet = runtimePacket();
  const deliveryRequest = defineRuntimeVerificationPacketDeliveryRequest({
    campaignId: "campaign-ai-reproduction",
    runId: "run-ai-reproduction",
    packet,
  });
  return {
    service,
    packet,
    deliveryRequest,
    privateArtifactStore,
    privateArtifactsDirectory,
    publicArtifactsDirectory,
    runRequest: {
      deliveryRequest,
      ...environmentInputs(packet),
    },
  };
}

describe("AI Reproduction", () => {
  it("creates a private exact Recipe and a shareable Triage Packet only after runtime confirmation", async () => {
    const run = vi.fn(async ({ attempt }: { attempt: AIReproductionAttempt }) =>
      confirmedExecution(attempt),
    );
    const fixture = await serviceFixture({ run });

    const receipt = await fixture.service.deliver(fixture.deliveryRequest);
    expect(receipt).toMatchObject({
      admission: "accepted-for-ai-reproduction",
      packetDigest: sha256Digest(fixture.packet),
    });
    const first = await fixture.service.run(fixture.runRequest);
    const replay = await fixture.service.run(fixture.runRequest);

    expect(replay).toEqual(first);
    expect(run).toHaveBeenCalledTimes(1);
    expect(run.mock.calls[0]?.[0].attempt).toMatchObject({
      packet: { digest: sha256Digest(fixture.packet) },
      target: { snapshot: fixture.packet.target },
      attackerPremise: fixture.packet.attackerPremise,
      causalIdentity: fixture.packet.causalIdentity,
      securityEffect: fixture.packet.securityEffect,
      sourceRoute: fixture.packet.sourceRoute,
      toolPolicy: {
        browser: "harness-mediated",
        http: "harness-mediated",
        runtimeObservation: "harness-mediated",
        ambientHostShell: false,
        ambientCredentials: false,
        arbitraryNetwork: false,
      },
    });
    expect(first).toMatchObject({
      status: "runtime-confirmed",
      triagePacket: {
        kind: "triage-reproduction-packet",
        recipeMetadata: {
          class: "sql-injection",
          criterion: { proof: "database-security-effect" },
          stepCount: 1,
        },
        boundary: {
          runtimeConfirmed: true,
          humanVerified: false,
          findingEligible: false,
          humanDisposition: false,
          programmeEligibility: false,
        },
      },
    });
    if (first.status !== "runtime-confirmed") {
      throw new Error("Expected runtime-confirmed result");
    }
    expect(await readdir(fixture.privateArtifactsDirectory)).toHaveLength(2);
    expect(
      JSON.stringify(
        await fixture.privateArtifactStore.readPrivateJson(first.recipe.digest),
      ),
    ).toContain("item=1 OR 1=1");
    expect(
      JSON.stringify(
        await fixture.privateArtifactStore.readPrivateJson(
          first.privateEvidence.digest,
        ),
      ),
    ).toContain("POST /wp-json/ai-runtime-plugin/v1/items HTTP/1.1");

    const publicArtifacts = await Promise.all(
      (await readdir(fixture.publicArtifactsDirectory)).map((name) =>
        readFile(join(fixture.publicArtifactsDirectory, name), "utf8"),
      ),
    );
    expect(publicArtifacts.join("\n")).not.toContain("item=1 OR 1=1");
    expect(publicArtifacts.join("\n")).not.toContain(
      "POST /wp-json/ai-runtime-plugin/v1/items HTTP/1.1",
    );
    expect(publicArtifacts.join("\n")).not.toContain('"finding"');
  });

  it.each([
    "sql-injection",
    "cross-site-scripting",
    "authorization",
    "file-operation",
    "code-execution",
    "generic",
  ] as const)(
    "accepts the %s Recipe criterion without adapter admission",
    async (reproductionClass) => {
      const fixture = await serviceFixture({
        run: async ({ attempt }) =>
          aiReproductionHarnessExecutionSchema.parse(
            confirmedExecution(attempt, reproductionClass),
          ),
      });

      const result = await fixture.service.run(fixture.runRequest);

      expect(result).toMatchObject({
        status: "runtime-confirmed",
        triagePacket: {
          recipeMetadata: {
            class: reproductionClass,
            criterion: { class: reproductionClass },
          },
        },
      });
    },
  );

  it.each([
    {
      status: "runtime-inconclusive" as const,
      reason: "unsupported-mechanism" as const,
      description:
        "The generic harness cannot yet close this runtime mechanism.",
      runtimeIdentity: null,
      cleanup: "not-required" as const,
    },
    {
      status: "setup-blocked" as const,
      reason: "isolation-unavailable" as const,
      description: "The required gVisor runtime is unavailable.",
      cleanup: "not-required" as const,
    },
    {
      status: "execution-failed" as const,
      reason: "provider-failed" as const,
      description: "The model provider did not complete the attempt.",
      cleanup: "completed" as const,
    },
    {
      status: "execution-failed" as const,
      reason: "budget-exhausted" as const,
      description: "The bounded model budget was exhausted.",
      cleanup: "completed" as const,
    },
  ])(
    "preserves $status/$reason without Triage or rejection",
    async (outcome) => {
      const fixture = await serviceFixture({
        run: async () => ({
          kind: "ai-reproduction-harness-execution",
          schemaVersion: 2,
          completedAt: fixedNow,
          ...outcome,
        }),
      });

      const result = await fixture.service.run(fixture.runRequest);

      expect(result).toMatchObject({
        status: outcome.status,
        reason: outcome.reason,
        triagePacket: null,
      });
      expect(JSON.stringify(result)).not.toContain("rejected");
      await expect(
        readdir(fixture.privateArtifactsDirectory),
      ).rejects.toThrow();
    },
  );

  it("does not confirm a mismatched runtime identity", async () => {
    const fixture = await serviceFixture({
      run: async ({ attempt }) => {
        const confirmed = confirmedExecution(attempt);
        return {
          ...confirmed,
          runtimeIdentity: {
            ...confirmed.runtimeIdentity,
            targetSnapshotDigest: digest("9"),
          },
        };
      },
    });

    const result = await fixture.service.run(fixture.runRequest);

    expect(result).toMatchObject({
      status: "runtime-inconclusive",
      reason: "environment-identity-mismatch",
      triagePacket: null,
    });
    await expect(readdir(fixture.privateArtifactsDirectory)).rejects.toThrow();
  });

  it("withholds Triage when disposable runtime cleanup fails", async () => {
    const fixture = await serviceFixture({
      run: async ({ attempt }) => ({
        ...confirmedExecution(attempt),
        cleanup: "failed" as const,
      }),
    });

    const result = await fixture.service.run(fixture.runRequest);

    expect(result).toMatchObject({
      status: "execution-failed",
      reason: "cleanup-failed",
      cleanup: "failed",
      triagePacket: null,
    });
    await expect(readdir(fixture.privateArtifactsDirectory)).rejects.toThrow();
  });

  it("rejects credential-bearing private evidence before persistence", async () => {
    const fixture = await serviceFixture({
      run: async ({ attempt }) => {
        const confirmed = confirmedExecution(attempt);
        return {
          ...confirmed,
          privateEvidence: {
            ...confirmed.privateEvidence,
            rawHttpRequests: [
              "POST /wp-json/ai-runtime-plugin/v1/items HTTP/1.1\nCookie: wordpress_session=private\n\nitem=1 OR 1=1",
            ],
          },
        };
      },
    });

    const result = await fixture.service.run(fixture.runRequest);

    expect(result).toMatchObject({
      status: "execution-failed",
      reason: "invalid-harness-output",
      triagePacket: null,
    });
    await expect(readdir(fixture.privateArtifactsDirectory)).rejects.toThrow();
  });
});
