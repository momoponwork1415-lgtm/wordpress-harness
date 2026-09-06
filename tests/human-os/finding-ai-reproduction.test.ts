import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  aiVerificationRecordSchema,
  defineHumanVerificationEnvironmentPolicy,
  defineHumanVerificationRuntimeProfile,
  defineHumanVerificationSetupPlan,
  openAIReproduction,
  openGvisorAIReproductionHarness,
  openHumanVerificationEnvironmentBuilder,
  setupStageNames,
  type FindingAIReproductionAttempt,
  type VerificationEnvironmentRequest,
} from "../../src/human-os/index.js";
import type { GvisorAIReproductionExperimentResult } from "../../src/human-os/gvisor-wordpress-environment-provisioner.js";
import { humanOsDigest } from "../../src/human-os/canonical-json.js";
import {
  openFileHumanOsArtifactStore,
  openFileHumanOsPrivateArtifactStore,
  openSqliteHumanOsRecord,
} from "../../src/human-os/human-os-record/index.js";
import {
  findingId,
  findingSchema,
} from "../../src/research/validation/finding.js";

const fixedNow = "2026-09-06T04:00:00.000Z";
const digest = (character: string): string => `sha256:${character.repeat(64)}`;
const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) =>
      rm(directory, {
        recursive: true,
        force: true,
      }),
    ),
  );
});

function finding() {
  const target = {
    id: "finding-plugin-1.2.3",
    pluginSlug: "finding-plugin",
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
  const candidateId = digest("3");
  const anchor = {
    path: "plugin.php",
    fileDigest: digest("4"),
    startLine: 10,
    endLine: 20,
  };
  return findingSchema.parse({
    kind: "finding",
    schemaVersion: 1,
    id: findingId(candidateId),
    target,
    manifest,
    candidate: {
      kind: "validation-candidate",
      schemaVersion: 2,
      id: candidateId,
      digest: digest("5"),
      targetSnapshotDigest: target.digest,
      manifestDigest: manifest.digest,
      origins: 1,
    },
    validation: {
      kind: "validation-record",
      schemaVersion: 3,
      validationId: candidateId,
      candidateId,
      digest: digest("6"),
    },
    causalIdentity: {
      rootCause: "public-input-enters-query",
      attackerControlledPrimitive: "public-request-value",
      brokenSecurityProperty: "query-data-boundary",
    },
    attackerPremise: "unauthenticated",
    brokenSecurityProperty: "query-data-boundary",
    sourceRoute: [
      {
        ordinal: 1,
        claim: "Public request data reaches a query structure.",
        evidence: [anchor],
      },
    ],
    sourceEvidence: [anchor],
    counterevidence: {
      status: "pass",
      reason: "Independent source review found no effective data boundary.",
      evidence: [anchor],
    },
  });
}

function runRequest() {
  const value = finding();
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
      wordpress: `registry.invalid/wordpress@${digest("7")}`,
      wordpressCli: `registry.invalid/wordpress-cli@${digest("8")}`,
      database: `registry.invalid/mariadb@${digest("9")}`,
      browser: `registry.invalid/browser@${digest("a")}`,
    },
  });
  const setupPlan = defineHumanVerificationSetupPlan({
    kind: "human-verification-setup-plan",
    schemaVersion: 1,
    pluginSlug: value.target.pluginSlug,
    mainPluginFile: "plugin.php",
    configuration: {
      siteMode: "single-site",
      locale: "en_US",
      timezone: "UTC",
      variantDigest: null,
    },
    stages: setupStageNames
      .map((stage, index) => ({
        ordinal: index + 1,
        stage,
        successCriterion: [
          "wordpress-installed",
          "target-files-match-manifest",
          "target-reports-active",
          "canonical-configuration-observed",
          "normal-target-function-observed",
        ] as const,
      }))
      .map((item, index) => ({
        ordinal: item.ordinal,
        stage: item.stage,
        successCriterion: item.successCriterion[index]!,
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
    finding: value,
    target: {
      kind: "human-verification-target" as const,
      schemaVersion: 1 as const,
      snapshot: value.target,
      manifest: value.manifest,
      sourceArtifact: {
        kind: "content-addressed-target-source" as const,
        mediaType: "application/zip" as const,
        digest: digest("b"),
      },
    },
    runtimeProfile,
    setupPlan,
    environmentPolicy,
    grants: [],
  };
}

function runtimeIdentity(attempt: FindingAIReproductionAttempt) {
  return {
    kind: "ai-reproduction-runtime-identity" as const,
    schemaVersion: 2 as const,
    environmentId: "gvisor-ai-lab-1",
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

function experiment(
  attempt: FindingAIReproductionAttempt,
  screenshotDigest: string,
) {
  const payload = {
    id: "payload-1",
    mediaType: "application/x-www-form-urlencoded" as const,
    exactValue: "item=1 OR 1=1",
  };
  return {
    kind: "finding-ai-reproduction-harness-execution" as const,
    schemaVersion: 1 as const,
    status: "runtime-confirmed" as const,
    completedAt: fixedNow,
    runtimeIdentity: runtimeIdentity(attempt),
    observation: {
      securityEffect: "observed" as const,
      description: "A bounded database effect was observed.",
    },
    recipe: {
      class: "sql-injection" as const,
      initialState: ["Use the canonical fresh WordPress state."],
      actors: { attackerRole: attempt.attackerPremise, victimRole: null },
      surface: "Use the public Target request interface.",
      payloads: [payload],
      steps: [
        {
          ordinal: 1,
          interface: "wordpress-rest-api" as const,
          actor: "attacker" as const,
          action: "Submit the bounded request using payload-1.",
          payloadId: payload.id,
          expectedObservation: "Observe a bounded database effect.",
        },
      ],
      criterion: {
        class: "sql-injection" as const,
        proof: "database-security-effect" as const,
        expectedDatabaseEffect: "A bounded database effect is observed.",
      },
    },
    privateEvidence: {
      exactPayloads: [payload],
      rawHttpRequests: [
        "POST /wp-json/finding-plugin/v1/items HTTP/1.1\nContent-Type: application/x-www-form-urlencoded\n\nitem=1 OR 1=1",
      ],
      screenshots: [
        {
          id: "screenshot-1",
          digest: screenshotDigest,
          mediaType: "image/png" as const,
        },
      ],
      runtimeLogs: [],
      redaction: {
        credentialsIncluded: false as const,
        cookiesIncluded: false as const,
        privateTranscriptIncluded: false as const,
        hostInformationIncluded: false as const,
      },
    },
    cleanup: "completed" as const,
  };
}

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "finding-ai-reproduction-"));
  directories.push(directory);
  const publicDirectory = join(directory, "public");
  const privateStore = openFileHumanOsPrivateArtifactStore(
    join(directory, "private"),
  );
  const record = openSqliteHumanOsRecord({
    databasePath: join(directory, "human-os.sqlite"),
    artifactStore: openFileHumanOsArtifactStore(publicDirectory),
    clock: () => new Date(fixedNow),
  });
  return { directory, publicDirectory, privateStore, record };
}

function readyProvisioner(input: {
  readonly active: boolean;
  readonly runExperiment?: (
    attempt: FindingAIReproductionAttempt,
  ) => Promise<GvisorAIReproductionExperimentResult>;
}) {
  return {
    inspectIsolation: vi.fn(
      async (request: VerificationEnvironmentRequest) => ({
        status: "available" as const,
        observedBackend: "gvisor",
        observedRuntimeName: "runsc",
        observedRuntimeVersion: request.runtimeProfile.isolation.runtimeVersion,
        privileged: false,
        hostNetwork: false,
        engineSocketMounted: false,
        credentialBearingHostPathMounted: false,
        unauthorizedEgress: false,
        hostTargetExecution: false,
        fallbackUsed: false,
      }),
    ),
    setup: vi.fn(async (request: VerificationEnvironmentRequest) => ({
      status: "ready" as const,
      handle: { environmentId: "gvisor-ai-lab-1" },
      stages: setupStageNames.map((stage, index) => ({
        ordinal: index + 1,
        stage,
        status: "completed" as const,
        observationDigest: digest(String(index + 1)),
      })),
      effectiveConfiguration: {
        pluginSlug: request.setupPlan.pluginSlug,
        siteMode: "single-site" as const,
        locale: "en_US" as const,
        timezone: "UTC" as const,
        isolationBackend: "gvisor" as const,
        privileged: false as const,
        hostNetwork: false as const,
        engineSocketMounted: false as const,
        credentialBearingHostPathMounted: false as const,
        egressDestinations: [],
        images: request.runtimeProfile.images,
      },
      targetRuntimeIdentity: {
        targetSnapshot: request.target.snapshot,
        manifest: request.target.manifest,
        sourceArtifactDigest: request.target.sourceArtifact.digest,
        observedWordpressVersion: request.runtimeProfile.wordpressVersion,
        observedPhpVersion: request.runtimeProfile.phpVersion,
        observedDatabaseVersion: request.runtimeProfile.databaseVersion,
        observedWebServerVersion: request.runtimeProfile.webServerVersion,
        observedImages: request.runtimeProfile.images,
      },
    })),
    cleanup: vi.fn(async () => "completed" as const),
    hasActiveEnvironment: vi.fn(() => input.active),
    runExperiment: vi.fn(
      async (_environmentId: string, attempt: FindingAIReproductionAttempt) => {
        if (input.runExperiment === undefined) {
          throw new Error("experiment should not run");
        }
        return input.runExperiment(attempt);
      },
    ),
    runAssistant: vi.fn(),
  };
}

describe("AIReproduction.run/read", () => {
  it("records one Finding-bound runtime confirmation and replays it after reopen", async () => {
    const state = await fixture();
    const screenshotDigest = await state.privateStore.putPrivateBytes(
      new TextEncoder().encode("private screenshot bytes"),
    );
    const harness = {
      run: vi.fn(
        async ({ attempt }: { attempt: FindingAIReproductionAttempt }) =>
          experiment(attempt, screenshotDigest),
      ),
    };
    const request = runRequest();
    const service = openAIReproduction({
      record: state.record,
      privateArtifactStore: state.privateStore,
      harness,
      clock: () => new Date(fixedNow),
    });

    const first = await service.run(request);
    const duplicate = await service.run(request);
    expect(first.outcome.status).toBe("runtime-confirmed");
    expect(duplicate.id).toBe(first.id);
    expect(harness.run).toHaveBeenCalledTimes(1);
    if (first.environment === null) throw new Error("Expected environment");
    const { id: _id, ...confirmedIdentity } = first;
    const foreignEnvironment = {
      ...confirmedIdentity,
      environment: {
        ...first.environment,
        targetSnapshotDigest: digest("f"),
      },
    };
    expect(
      aiVerificationRecordSchema.safeParse({
        ...foreignEnvironment,
        id: humanOsDigest(foreignEnvironment),
      }).success,
    ).toBe(false);
    await expect(
      service.run({
        ...request,
        target: {
          ...request.target,
          snapshot: { ...request.target.snapshot, id: "foreign-target" },
          manifest: {
            ...request.target.manifest,
            targetSnapshotId: "foreign-target",
          },
        },
      }),
    ).rejects.toThrow("Target identity mismatch");

    const reopened = openAIReproduction({
      record: openSqliteHumanOsRecord({
        databasePath: join(state.directory, "human-os.sqlite"),
        artifactStore: openFileHumanOsArtifactStore(state.publicDirectory),
      }),
      privateArtifactStore: state.privateStore,
      harness: { run: vi.fn() },
    });
    const view = await reopened.read(request.finding.id);
    expect(view?.finding).toEqual(request.finding);
    expect(view?.assurance).toEqual({
      source: "source-validated",
      runtime: ["runtime-confirmed"],
    });

    const publicText = (
      await Promise.all(
        (await readdir(state.publicDirectory)).map((name) =>
          readFile(join(state.publicDirectory, name), "utf8"),
        ),
      )
    ).join("\n");
    expect(publicText).not.toContain("item=1 OR 1=1");
    expect(publicText).not.toContain("rawHttpRequests");
  });

  it("turns setup, provider, cleanup, and private evidence failures into reasoned non-negative records", async () => {
    const setupState = await fixture();
    const request = runRequest();
    const blocked = await openAIReproduction({
      record: setupState.record,
      privateArtifactStore: setupState.privateStore,
      harness: {
        run: async () => ({
          kind: "finding-ai-reproduction-harness-execution",
          schemaVersion: 1,
          status: "setup-blocked",
          completedAt: fixedNow,
          reason: "setup-failed",
          description: "Target activation failed in the disposable lab.",
          cleanup: "completed",
        }),
      },
    }).run(request);
    expect(blocked.outcome.status).toBe("setup-blocked");
    const { id: _blockedId, ...blockedIdentity } = blocked;
    const fabricatedExperiment = {
      ...blockedIdentity,
      outcome: {
        ...blocked.outcome,
        preconditionsMatched: true,
        recipeCompleted: true,
      },
    };
    expect(
      aiVerificationRecordSchema.safeParse({
        ...fabricatedExperiment,
        id: humanOsDigest(fabricatedExperiment),
      }).success,
    ).toBe(false);

    const providerState = await fixture();
    const providerFailure = await openAIReproduction({
      record: providerState.record,
      privateArtifactStore: providerState.privateStore,
      harness: { run: async () => Promise.reject(new Error("provider")) },
    }).run(request);
    expect(providerFailure.outcome.status).toBe("inconclusive");
    expect(providerFailure.outcome.reason).toContain("harness failed");

    const cleanupState = await fixture();
    const cleanupFailure = await openAIReproduction({
      record: cleanupState.record,
      privateArtifactStore: cleanupState.privateStore,
      harness: {
        run: async ({ attempt }) => ({
          ...experiment(attempt, digest("e")),
          cleanup: "failed" as const,
        }),
      },
    }).run(request);
    expect(cleanupFailure.outcome.status).toBe("inconclusive");
    expect(cleanupFailure.outcome.reason).toContain("could not be cleaned up");

    const missingState = await fixture();
    const inconclusive = await openAIReproduction({
      record: missingState.record,
      privateArtifactStore: missingState.privateStore,
      harness: {
        run: async ({ attempt }) => experiment(attempt, digest("f")),
      },
    }).run(request);
    expect(inconclusive.outcome.status).toBe("inconclusive");
    expect(inconclusive.outcome.reason).toContain("unavailable");

    const mismatchState = await fixture();
    const mismatch = await openAIReproduction({
      record: mismatchState.record,
      privateArtifactStore: mismatchState.privateStore,
      harness: {
        run: async ({ attempt }) => {
          const confirmed = experiment(attempt, digest("d"));
          return {
            ...confirmed,
            privateEvidence: {
              ...confirmed.privateEvidence,
              exactPayloads: [],
              screenshots: [],
            },
          };
        },
      },
    }).run(request);
    expect(mismatch.outcome.status).toBe("inconclusive");
    expect(mismatch.outcome.reason).toContain("did not match the Attempt");
  });

  it("runs a Finding-bound experiment through the ready gVisor Adapter", async () => {
    const state = await fixture();
    const screenshotDigest = await state.privateStore.putPrivateBytes(
      new TextEncoder().encode("adapter screenshot bytes"),
    );
    const provisioner = readyProvisioner({
      active: true,
      runExperiment: async (attempt) => {
        const {
          kind: _kind,
          schemaVersion: _schemaVersion,
          completedAt: _completedAt,
          cleanup: _cleanup,
          ...result
        } = experiment(attempt, screenshotDigest);
        return result;
      },
    });
    const harness = openGvisorAIReproductionHarness({
      environmentBuilder: openHumanVerificationEnvironmentBuilder({
        record: state.record,
        provisioner,
        clock: () => new Date(fixedNow),
      }),
      provisioner,
      clock: () => new Date(fixedNow),
    });

    const record = await openAIReproduction({
      record: state.record,
      privateArtifactStore: state.privateStore,
      harness,
    }).run(runRequest());

    expect(record.outcome.status).toBe("runtime-confirmed");
    expect(provisioner.runExperiment).toHaveBeenCalledOnce();
    expect(provisioner.cleanup).toHaveBeenCalledOnce();
  });

  it("treats a durable ready disposition without its live gVisor session as inconclusive", async () => {
    const state = await fixture();
    const provisioner = readyProvisioner({ active: false });
    const environmentBuilder = openHumanVerificationEnvironmentBuilder({
      record: state.record,
      provisioner,
      clock: () => new Date(fixedNow),
    });
    const harness = openGvisorAIReproductionHarness({
      environmentBuilder,
      provisioner,
      clock: () => new Date(fixedNow),
    });
    const record = await openAIReproduction({
      record: state.record,
      privateArtifactStore: state.privateStore,
      harness,
    }).run(runRequest());

    expect(record.outcome.status).toBe("inconclusive");
    expect(record.outcome.reason).toContain("no matching live gVisor session");
    expect(provisioner.runExperiment).not.toHaveBeenCalled();
    expect(provisioner.cleanup).toHaveBeenCalledOnce();
  });

  it("rejects a broker identity from a different environment", async () => {
    const state = await fixture();
    const provisioner = readyProvisioner({
      active: true,
      runExperiment: async (attempt) => {
        const {
          kind: _kind,
          schemaVersion: _schemaVersion,
          completedAt: _completedAt,
          cleanup: _cleanup,
          ...result
        } = experiment(attempt, digest("d"));
        return {
          ...result,
          runtimeIdentity: {
            ...result.runtimeIdentity,
            environmentId: "foreign-gvisor-lab",
          },
        };
      },
    });
    const harness = openGvisorAIReproductionHarness({
      environmentBuilder: openHumanVerificationEnvironmentBuilder({
        record: state.record,
        provisioner,
        clock: () => new Date(fixedNow),
      }),
      provisioner,
      clock: () => new Date(fixedNow),
    });
    const record = await openAIReproduction({
      record: state.record,
      privateArtifactStore: state.privateStore,
      harness,
    }).run(runRequest());

    expect(record.outcome.status).toBe("inconclusive");
    expect(record.outcome.reason).toContain("live gVisor session");
    expect(provisioner.cleanup).toHaveBeenCalledOnce();
  });
});
