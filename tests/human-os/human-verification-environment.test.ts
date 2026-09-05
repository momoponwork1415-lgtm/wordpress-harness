import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  defineHumanVerificationEnvironmentPolicy,
  defineHumanVerificationEnvironmentRequest,
  defineHumanVerificationRuntimeProfile,
  defineHumanVerificationSetupPlan,
  openHumanVerificationEnvironmentBuilder,
  setupStageNames,
  type HumanVerificationEnvironmentProvisioner,
  type HumanVerificationEnvironmentRequest,
} from "../../src/human-os/index.js";
import {
  openFileHumanOsArtifactStore,
  openSqliteHumanOsRecord,
} from "../../src/human-os/human-os-record/index.js";
import { sha256Digest } from "../../src/research/research-record/canonical-json.js";
import { humanReviewPacketSchema } from "../../src/research/validation/human-review-packet.js";

const fixedNow = "2026-09-05T03:00:00.000Z";
const digest = (character: string): string => `sha256:${character.repeat(64)}`;

function reviewPacket() {
  const target = {
    id: "environment-plugin-1.2.3",
    pluginSlug: "environment-plugin",
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
  const anchor = {
    path: "plugin.php",
    fileDigest: digest("3"),
    startLine: 10,
    endLine: 20,
  };
  const candidate = {
    kind: "validation-candidate" as const,
    schemaVersion: 1 as const,
    id: digest("4"),
    digest: digest("5"),
    targetSnapshotDigest: target.digest,
    manifestDigest: manifest.digest,
    origins: 1,
  };
  const riskAssessment = {
    kind: "risk-assessment" as const,
    schemaVersion: 1 as const,
    id: digest("6"),
    digest: digest("7"),
    candidateId: candidate.id,
    validationId: candidate.id,
  };
  const counterevidence = [
    {
      criterion: "counterevidence-and-proof-gap" as const,
      reason: "Independent source review found no effective ownership control.",
      evidence: [anchor],
    },
  ];
  const humanReproductionSketch = {
    attackerRole: "unauthenticated" as const,
    preconditions: ["Use a fresh isolated environment."],
    steps: [
      {
        ordinal: 1,
        action:
          "Exercise the public state transition through the Target interface.",
        sourceEvidence: [anchor],
      },
    ],
    expectedSecurityEffect: "A state owned by another actor changes.",
    stopConditions: ["Stop if the Target identity differs from this Packet."],
  };
  const identity = {
    kind: "human-review-packet" as const,
    schemaVersion: 1 as const,
    target,
    manifest,
    candidate,
    riskAssessment,
    causalIdentity: {
      rootCause: "cross-actor-state",
      attackerControlledPrimitive: "public-state-transition",
      brokenSecurityProperty: "state-ownership",
    },
    attackerPremise: "unauthenticated" as const,
    orderedRoute: [
      {
        ordinal: 1,
        claim: "Public input reaches an ownership-sensitive state transition.",
        evidence: [anchor],
      },
    ],
    sourceEvidence: [anchor],
    counterevidence,
    runtimeUncertainties: ["Runtime behavior remains unobserved."],
    humanReproductionSketch,
    reviewBoundary: {
      validity: "source-validated-not-human-verified" as const,
      findingEligible: false as const,
    },
  };
  return humanReviewPacketSchema.parse({
    ...identity,
    id: sha256Digest(identity),
  });
}

function environmentRequest(): HumanVerificationEnvironmentRequest {
  const packet = reviewPacket();
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
      wordpress: `registry.invalid/wordpress@${digest("8")}`,
      wordpressCli: `registry.invalid/wordpress-cli@${digest("9")}`,
      database: `registry.invalid/mariadb@${digest("a")}`,
      browser: `registry.invalid/browser@${digest("b")}`,
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
  const policy = defineHumanVerificationEnvironmentPolicy({
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
  return defineHumanVerificationEnvironmentRequest({
    packet,
    target: {
      kind: "human-verification-target",
      schemaVersion: 1,
      snapshot: packet.target,
      manifest: packet.manifest,
      sourceArtifact: {
        kind: "content-addressed-target-source",
        mediaType: "application/zip",
        digest: digest("c"),
      },
    },
    runtimeProfile,
    setupPlan,
    policy,
    grants: [],
  });
}

function availableInspection(request: HumanVerificationEnvironmentRequest) {
  return {
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
  };
}

function completedStages() {
  return setupStageNames.map((stage, index) => ({
    ordinal: index + 1,
    stage,
    status: "completed" as const,
    observationDigest: digest(String(index + 1)),
  }));
}

function readyProvisioner() {
  const inspectIsolation = vi.fn(
    async (request: HumanVerificationEnvironmentRequest) =>
      availableInspection(request),
  );
  const setup = vi.fn(async (request: HumanVerificationEnvironmentRequest) => ({
    status: "ready" as const,
    handle: { environmentId: "human-lab-1" },
    stages: completedStages(),
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
  }));
  const cleanup = vi.fn(async () => "completed" as const);
  return {
    provisioner: { inspectIsolation, setup, cleanup },
    inspectIsolation,
    setup,
    cleanup,
  };
}

async function withRecord<T>(
  run: (input: {
    readonly directory: string;
    readonly request: HumanVerificationEnvironmentRequest;
    readonly record: ReturnType<typeof openSqliteHumanOsRecord>;
  }) => Promise<T>,
): Promise<T> {
  const directory = await mkdtemp(join(tmpdir(), "human-os-environment-"));
  const artifacts = openFileHumanOsArtifactStore(join(directory, "artifacts"));
  const record = openSqliteHumanOsRecord({
    databasePath: join(directory, "human-os.sqlite"),
    artifactStore: artifacts,
    clock: () => new Date(fixedNow),
  });
  try {
    return await run({ directory, request: environmentRequest(), record });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

describe("HumanVerificationEnvironmentBuilder.establish", () => {
  it("durably records a Packet-bound ready environment before exposing it and replays it", async () => {
    await withRecord(async ({ directory, request, record }) => {
      const first = readyProvisioner();
      const builder = openHumanVerificationEnvironmentBuilder({
        record,
        provisioner: first.provisioner,
        clock: () => new Date(fixedNow),
      });

      const established = await builder.establish(request);
      expect(established).toMatchObject({
        status: "ready",
        requestDigest: request.digest,
        gate: {
          status: "passed",
          observedBackend: "gvisor",
          fallbackUsed: false,
          hostTargetExecution: false,
        },
        setupReceipt: {
          status: "ready",
          setupPlanDigest: request.setupPlan.digest,
        },
        effectiveConfiguration: {
          runtimeProfileDigest: request.runtimeProfile.digest,
          privileged: false,
          hostNetwork: false,
          engineSocketMounted: false,
          credentialBearingHostPathMounted: false,
          egressDestinations: [],
        },
        targetRuntimeIdentity: {
          targetSnapshot: request.target.snapshot,
          manifest: request.target.manifest,
          sourceArtifactDigest: request.target.sourceArtifact.digest,
        },
      });
      const persisted = await record.readEnvironmentDisposition(request.digest);
      expect(persisted?.disposition).toEqual(established);

      const replayRecord = openSqliteHumanOsRecord({
        databasePath: join(directory, "human-os.sqlite"),
        artifactStore: openFileHumanOsArtifactStore(
          join(directory, "artifacts"),
        ),
      });
      const replayProvisioner: HumanVerificationEnvironmentProvisioner = {
        inspectIsolation: vi.fn(() => {
          throw new Error("Replay must not inspect the runtime");
        }),
        setup: vi.fn(() => {
          throw new Error("Replay must not provision another environment");
        }),
        cleanup: vi.fn(() => {
          throw new Error("Replay must not clean the retained environment");
        }),
      };
      const replayed = await openHumanVerificationEnvironmentBuilder({
        record: replayRecord,
        provisioner: replayProvisioner,
      }).establish(request);

      expect(replayed).toEqual(established);
      expect(replayProvisioner.inspectIsolation).not.toHaveBeenCalled();
      expect(first.cleanup).not.toHaveBeenCalled();
    });
  });

  it("records gVisor capability absence without setup or silent fallback", async () => {
    await withRecord(async ({ request, record }) => {
      const setup = vi.fn();
      const provisioner: HumanVerificationEnvironmentProvisioner = {
        inspectIsolation: vi.fn(async () => ({
          ...availableInspection(request),
          status: "unavailable" as const,
          observedBackend: null,
          observedRuntimeName: null,
          observedRuntimeVersion: null,
        })),
        setup,
        cleanup: vi.fn(async () => "completed" as const),
      };
      const disposition = await openHumanVerificationEnvironmentBuilder({
        record,
        provisioner,
        clock: () => new Date(fixedNow),
      }).establish(request);

      expect(disposition).toMatchObject({
        status: "setup-blocked",
        phase: "isolation-gate",
        reason: "isolation-capability-unavailable",
        gate: { status: "blocked", fallbackUsed: false },
        setupReceipt: { cleanup: "not-required" },
      });
      expect(disposition).not.toHaveProperty("environment");
      expect(setup).not.toHaveBeenCalled();
    });
  });

  it("blocks an observed plain-Docker fallback before setup", async () => {
    await withRecord(async ({ request, record }) => {
      const setup = vi.fn();
      const provisioner: HumanVerificationEnvironmentProvisioner = {
        inspectIsolation: vi.fn(async () => ({
          ...availableInspection(request),
          observedBackend: "docker",
          observedRuntimeName: "runc",
          fallbackUsed: true,
        })),
        setup,
        cleanup: vi.fn(async () => "completed" as const),
      };
      const disposition = await openHumanVerificationEnvironmentBuilder({
        record,
        provisioner,
        clock: () => new Date(fixedNow),
      }).establish(request);

      expect(disposition).toMatchObject({
        status: "setup-blocked",
        phase: "isolation-gate",
        reason: "policy-violation",
        gate: {
          status: "blocked",
          observedBackend: "docker",
          observedRuntimeName: "runc",
          fallbackUsed: true,
        },
      });
      expect(setup).not.toHaveBeenCalled();
    });
  });

  it.each([
    ["setup", "setup-failed"],
    ["activation", "activation-failed"],
    ["health", "health-failed"],
  ] as const)(
    "preserves a %s failure as Setup Blocked and cleans the partial environment",
    async (phase, reason) => {
      await withRecord(async ({ request, record }) => {
        const cleanup = vi.fn(async () => "completed" as const);
        const provisioner: HumanVerificationEnvironmentProvisioner = {
          inspectIsolation: vi.fn(async () => availableInspection(request)),
          setup: vi.fn(async () => ({
            status: "setup-blocked" as const,
            phase,
            reason,
            partialEnvironment: { environmentId: "partial-lab-1" },
            stages: completedStages().map((stage) =>
              stage.stage ===
              (phase === "setup"
                ? "install-target"
                : phase === "activation"
                  ? "activate-target"
                  : "functional-smoke")
                ? { ...stage, status: "failed" as const }
                : stage,
            ),
          })),
          cleanup,
        };
        const disposition = await openHumanVerificationEnvironmentBuilder({
          record,
          provisioner,
          clock: () => new Date(fixedNow),
        }).establish(request);

        expect(disposition).toMatchObject({
          status: "setup-blocked",
          phase,
          reason,
          setupReceipt: { status: "setup-blocked", cleanup: "completed" },
        });
        expect(disposition).not.toHaveProperty("environment");
        expect(cleanup).toHaveBeenCalledExactlyOnceWith({
          environmentId: "partial-lab-1",
        });
      });
    },
  );

  it("cleans a ready backend result whose effective configuration differs from policy", async () => {
    await withRecord(async ({ request, record }) => {
      const ready = readyProvisioner();
      ready.setup.mockImplementationOnce(async (setupRequest) => {
        const correct =
          await readyProvisioner().provisioner.setup(setupRequest);
        if (correct.status !== "ready")
          throw new Error("Expected ready fixture");
        return {
          ...correct,
          effectiveConfiguration: {
            ...correct.effectiveConfiguration,
            pluginSlug: "foreign-plugin",
          },
        };
      });
      const disposition = await openHumanVerificationEnvironmentBuilder({
        record,
        provisioner: ready.provisioner,
        clock: () => new Date(fixedNow),
      }).establish(request);

      expect(disposition).toMatchObject({
        status: "setup-blocked",
        phase: "setup",
        reason: "effective-configuration-mismatch",
        setupReceipt: { cleanup: "completed" },
      });
      expect(ready.cleanup).toHaveBeenCalledExactlyOnceWith({
        environmentId: "human-lab-1",
      });
    });
  });
});
