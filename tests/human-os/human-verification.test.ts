import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  defineHumanVerificationEnvironmentPolicy,
  defineHumanVerificationEnvironmentRequest,
  defineHumanVerificationRuntimeProfile,
  defineHumanVerificationSetupPlan,
  openLegacyHumanVerificationReplay,
  openHumanVerificationEnvironmentBuilder,
  setupStageNames,
  type HumanVerificationEnvironmentProvisioner,
  type HumanVerificationEnvironmentRequest,
  type HumanVerificationRecordIdentity,
} from "../../src/human-os/index.js";
import { defineHumanVerificationRecord } from "../../src/human-os/human-verification-contracts.js";
import { openHumanVerification } from "../../src/human-os/human-verification.js";
import {
  openFileHumanOsArtifactStore,
  openSqliteHumanOsRecord,
  type HumanOsRecord,
} from "../../src/human-os/human-os-record/index.js";
import { sha256Digest } from "../../src/research/research-record/canonical-json.js";
import {
  defineHumanReviewPacketDeliveryRequest,
  humanReviewPacketSchema,
  type HumanReviewPacket,
} from "../../src/research/validation/human-review-packet.js";

const fixedNow = "2026-09-05T04:00:00.000Z";
const digest = (value: string): string => sha256Digest(value);

function reviewPacket(input: {
  readonly seed: string;
  readonly rootCause: string;
  readonly runtimeUncertainty?: string;
}): HumanReviewPacket {
  const target = {
    id: `review-plugin-${input.seed}`,
    pluginSlug: "review-plugin",
    version: "1.2.3",
    digest: digest(`target-${input.seed}`),
  };
  const manifest = {
    kind: "target-file-manifest" as const,
    schemaVersion: 1 as const,
    targetSnapshotId: target.id,
    targetSnapshotDigest: target.digest,
    digest: digest(`manifest-${input.seed}`),
  };
  const anchor = {
    path: "plugin.php",
    fileDigest: digest(`file-${input.seed}`),
    startLine: 10,
    endLine: 20,
  };
  const candidate = {
    kind: "validation-candidate" as const,
    schemaVersion: 1 as const,
    id: digest(`candidate-${input.seed}`),
    digest: digest(`candidate-artifact-${input.seed}`),
    targetSnapshotDigest: target.digest,
    manifestDigest: manifest.digest,
    origins: 1,
  };
  const riskAssessment = {
    kind: "risk-assessment" as const,
    schemaVersion: 1 as const,
    id: digest(`risk-${input.seed}`),
    digest: digest(`risk-artifact-${input.seed}`),
    candidateId: candidate.id,
    validationId: candidate.id,
  };
  const counterevidence = [
    {
      criterion: "counterevidence-and-proof-gap" as const,
      reason: "Independent review did not locate an effective control.",
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
          "Use the public Target interface to request the state transition.",
        sourceEvidence: [anchor],
      },
    ],
    expectedSecurityEffect: "Another actor's protected state changes.",
    stopConditions: ["Stop if the Target identity differs from the Packet."],
  };
  const identity = {
    kind: "human-review-packet" as const,
    schemaVersion: 1 as const,
    target,
    manifest,
    candidate,
    riskAssessment,
    causalIdentity: {
      rootCause: input.rootCause,
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
    runtimeUncertainties: [
      input.runtimeUncertainty ?? "Runtime behavior remains unobserved.",
    ],
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

function deliveryRequest(packet: HumanReviewPacket, runId: string) {
  return defineHumanReviewPacketDeliveryRequest({
    campaignId: "campaign-human-review",
    runId,
    packet,
  });
}

function environmentRequest(
  packet: HumanReviewPacket,
): HumanVerificationEnvironmentRequest {
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
      wordpress: `registry.invalid/wordpress@${digest("wordpress-image")}`,
      wordpressCli: `registry.invalid/wordpress-cli@${digest("cli-image")}`,
      database: `registry.invalid/mariadb@${digest("database-image")}`,
      browser: `registry.invalid/browser@${digest("browser-image")}`,
    },
  });
  const criteria = [
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
      successCriterion: criteria[index]!,
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
        digest: digest(`source-${packet.id}`),
      },
    },
    runtimeProfile,
    setupPlan,
    policy,
    grants: [],
  });
}

async function establishEnvironment(
  record: HumanOsRecord,
  packet: HumanReviewPacket,
  status: "ready" | "setup-blocked" = "ready",
) {
  const request = environmentRequest(packet);
  const provisioner: HumanVerificationEnvironmentProvisioner = {
    inspectIsolation: vi.fn(async () =>
      status === "ready"
        ? {
            status: "available" as const,
            observedBackend: "gvisor",
            observedRuntimeName: "runsc",
            observedRuntimeVersion:
              request.runtimeProfile.isolation.runtimeVersion,
            privileged: false,
            hostNetwork: false,
            engineSocketMounted: false,
            credentialBearingHostPathMounted: false,
            unauthorizedEgress: false,
            hostTargetExecution: false,
            fallbackUsed: false,
          }
        : {
            status: "unavailable" as const,
            observedBackend: null,
            observedRuntimeName: null,
            observedRuntimeVersion: null,
            privileged: false,
            hostNetwork: false,
            engineSocketMounted: false,
            credentialBearingHostPathMounted: false,
            unauthorizedEgress: false,
            hostTargetExecution: false,
            fallbackUsed: false,
          },
    ),
    setup: vi.fn(async (setupRequest: HumanVerificationEnvironmentRequest) => ({
      status: "ready" as const,
      handle: { environmentId: `lab-${packet.target.id}` },
      stages: setupStageNames.map((stage, index) => ({
        ordinal: index + 1,
        stage,
        status: "completed" as const,
        observationDigest: digest(`stage-${index}-${packet.id}`),
      })),
      effectiveConfiguration: {
        pluginSlug: setupRequest.setupPlan.pluginSlug,
        siteMode: "single-site" as const,
        locale: "en_US" as const,
        timezone: "UTC" as const,
        isolationBackend: "gvisor" as const,
        privileged: false as const,
        hostNetwork: false as const,
        engineSocketMounted: false as const,
        credentialBearingHostPathMounted: false as const,
        egressDestinations: [],
        images: setupRequest.runtimeProfile.images,
      },
      targetRuntimeIdentity: {
        targetSnapshot: setupRequest.target.snapshot,
        manifest: setupRequest.target.manifest,
        sourceArtifactDigest: setupRequest.target.sourceArtifact.digest,
        observedWordpressVersion: setupRequest.runtimeProfile.wordpressVersion,
        observedPhpVersion: setupRequest.runtimeProfile.phpVersion,
        observedDatabaseVersion: setupRequest.runtimeProfile.databaseVersion,
        observedWebServerVersion: setupRequest.runtimeProfile.webServerVersion,
        observedImages: setupRequest.runtimeProfile.images,
      },
    })),
    cleanup: vi.fn(async () => "completed" as const),
  };
  const disposition = await openHumanVerificationEnvironmentBuilder({
    record,
    provisioner,
    clock: () => new Date(fixedNow),
  }).establish(request);
  return { request, disposition };
}

async function withHumanOs<T>(
  run: (input: {
    readonly directory: string;
    readonly artifactsDirectory: string;
    readonly databasePath: string;
    readonly record: HumanOsRecord;
  }) => Promise<T>,
): Promise<T> {
  const directory = await mkdtemp(join(tmpdir(), "human-verification-"));
  const artifactsDirectory = join(directory, "artifacts");
  const databasePath = join(directory, "human-os.sqlite");
  const record = openSqliteHumanOsRecord({
    databasePath,
    artifactStore: openFileHumanOsArtifactStore(artifactsDirectory),
    clock: () => new Date(fixedNow),
  });
  try {
    return await run({ directory, artifactsDirectory, databasePath, record });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function verificationIdentity(input: {
  readonly caseId: string;
  readonly packet: HumanReviewPacket;
  readonly environment:
    | Extract<
        Awaited<ReturnType<typeof establishEnvironment>>["disposition"],
        { status: "ready" }
      >["environment"]
    | {
        readonly kind: "human-verification-environment-unavailable";
        readonly schemaVersion: 1;
        readonly requestDigest: string;
      };
  readonly effect: "observed" | "not-observed" | "uncertain";
  readonly disposition:
    | { status: "verified-finding"; reason: string }
    | { status: "rejected"; reason: string }
    | {
        status: "more-evidence-required";
        reason: string;
        requestedEvidence: {
          kind: "source" | "runtime";
          question: string;
          acceptanceCriterion: string;
        }[];
      }
    | {
        status: "blocked";
        reason: string;
        blocker: "environment-unavailable";
      };
}): HumanVerificationRecordIdentity {
  return {
    kind: "human-verification-record" as const,
    schemaVersion: 1 as const,
    caseId: input.caseId,
    packetDigest: sha256Digest(input.packet),
    environment: input.environment,
    reviewer: { kind: "human-reviewer" as const, id: "reviewer-alice" },
    performedAt: fixedNow,
    attackerRole: "unauthenticated" as const,
    targetInterfaceSteps:
      input.environment.kind === "human-verification-environment"
        ? [
            {
              ordinal: 1,
              interface: "wordpress-public-site" as const,
              action: "Request the Packet-bound public state transition.",
              observation:
                "The protected state transition was objectively observed.",
            },
          ]
        : [],
    securityEffect: {
      status: input.effect,
      description:
        input.effect === "observed"
          ? "Another actor's protected state changed."
          : input.effect === "not-observed"
            ? "The protected state remained unchanged."
            : "The Security Effect could not be determined.",
    },
    disposition: input.disposition,
  };
}

describe("HumanVerification", () => {
  it("admits at most three unique active mechanisms and retains the remainder as Human Deferred", async () => {
    await withHumanOs(async ({ record }) => {
      const verification = openHumanVerification({
        record,
        clock: () => new Date(fixedNow),
      });
      const packets = [1, 2, 3, 4].map((ordinal) =>
        reviewPacket({ seed: String(ordinal), rootCause: `root-${ordinal}` }),
      );
      const receipts = [];
      for (const [index, packet] of packets.entries()) {
        receipts.push(
          await verification.admit(deliveryRequest(packet, `run-${index + 1}`)),
        );
      }

      expect(receipts.map((receipt) => receipt.admission)).toEqual([
        "active",
        "active",
        "active",
        "human-deferred",
      ]);
      const repeat = await verification.admit(
        deliveryRequest(packets[3]!, "run-repeat"),
      );
      expect(repeat.caseId).toBe(receipts[3]?.caseId);
      expect(repeat.admission).toBe("human-deferred");

      const sameMechanism = reviewPacket({
        seed: "same-mechanism",
        rootCause: "root-1",
        runtimeUncertainty: "A different runtime premise remains unresolved.",
      });
      const sameMechanismReceipt = await verification.admit(
        deliveryRequest(sameMechanism, "run-same-mechanism"),
      );
      expect(sameMechanismReceipt.admission).toBe("active");

      const queue = await verification.readQueue("campaign-human-review");
      expect(queue.active).toHaveLength(4);
      expect(queue.humanDeferred).toHaveLength(1);
      expect(
        new Set(queue.active.map((item) => item.reviewCase.mechanismDigest))
          .size,
      ).toBe(3);
    });
  });

  it("creates a Finding only from a durable verified Human Verification and replays it", async () => {
    await withHumanOs(async ({ artifactsDirectory, databasePath, record }) => {
      const packet = reviewPacket({ seed: "verified", rootCause: "root-v" });
      const verification = openHumanVerification({
        record,
        clock: () => new Date(fixedNow),
      });
      const receipt = await verification.admit(
        deliveryRequest(packet, "run-verified"),
      );
      const established = await establishEnvironment(record, packet);
      if (established.disposition.status !== "ready") {
        throw new Error("Expected a ready environment");
      }
      const humanRecord = defineHumanVerificationRecord(
        verificationIdentity({
          caseId: receipt.caseId,
          packet,
          environment: established.disposition.environment,
          effect: "observed",
          disposition: {
            status: "verified-finding",
            reason:
              "The broken state-ownership property was independently observed.",
          },
        }),
      );

      const result = await verification.record(humanRecord);
      expect(result).toMatchObject({
        verification: {
          reviewer: { id: "reviewer-alice" },
          performedAt: fixedNow,
          disposition: { status: "verified-finding" },
        },
        finding: {
          caseId: receipt.caseId,
          target: packet.target,
          externalAction: { status: "not-authorized" },
        },
        evidenceRequest: null,
      });

      const replayRecord = openSqliteHumanOsRecord({
        databasePath,
        artifactStore: openFileHumanOsArtifactStore(artifactsDirectory),
      });
      const replay = await openLegacyHumanVerificationReplay({
        record: replayRecord,
      }).readCase(receipt.caseId);
      expect(replay?.verifications).toHaveLength(1);
      expect(replay?.verifications[0]?.result).toEqual(result);
      expect(await verification.record(humanRecord)).toEqual(result);
    });
  });

  it("creates Evidence Request for more evidence and no Finding for a reasoned rejection", async () => {
    await withHumanOs(async ({ record }) => {
      const verification = openHumanVerification({
        record,
        clock: () => new Date(fixedNow),
      });
      const evidencePacket = reviewPacket({
        seed: "evidence",
        rootCause: "root-evidence",
      });
      const evidenceReceipt = await verification.admit(
        deliveryRequest(evidencePacket, "run-evidence"),
      );
      const evidenceEnvironment = await establishEnvironment(
        record,
        evidencePacket,
      );
      if (evidenceEnvironment.disposition.status !== "ready") {
        throw new Error("Expected a ready environment");
      }
      const evidenceResult = await verification.record(
        defineHumanVerificationRecord(
          verificationIdentity({
            caseId: evidenceReceipt.caseId,
            packet: evidencePacket,
            environment: evidenceEnvironment.disposition.environment,
            effect: "uncertain",
            disposition: {
              status: "more-evidence-required",
              reason: "The runtime ownership boundary remains ambiguous.",
              requestedEvidence: [
                {
                  kind: "runtime",
                  question: "Which actor owns the terminal state transition?",
                  acceptanceCriterion:
                    "Observe the owner identity before and after the transition.",
                },
              ],
            },
          }),
        ),
      );
      expect(evidenceResult.finding).toBeNull();
      expect(evidenceResult.evidenceRequest).toMatchObject({
        caseId: evidenceReceipt.caseId,
        requestedEvidence: [{ kind: "runtime" }],
      });

      const rejectedPacket = reviewPacket({
        seed: "rejected",
        rootCause: "root-rejected",
      });
      const rejectedReceipt = await verification.admit(
        deliveryRequest(rejectedPacket, "run-rejected"),
      );
      const rejectedEnvironment = await establishEnvironment(
        record,
        rejectedPacket,
      );
      if (rejectedEnvironment.disposition.status !== "ready") {
        throw new Error("Expected a ready environment");
      }
      const rejectedResult = await verification.record(
        defineHumanVerificationRecord(
          verificationIdentity({
            caseId: rejectedReceipt.caseId,
            packet: rejectedPacket,
            environment: rejectedEnvironment.disposition.environment,
            effect: "not-observed",
            disposition: {
              status: "rejected",
              reason:
                "The protected state remained owned by the original actor.",
            },
          }),
        ),
      );
      expect(rejectedResult.finding).toBeNull();
      expect(rejectedResult.evidenceRequest).toBeNull();
    });
  });

  it("records environment failure as blocked and refuses to round it into Rejected", async () => {
    await withHumanOs(async ({ record }) => {
      const packet = reviewPacket({
        seed: "blocked",
        rootCause: "root-blocked",
      });
      const verification = openHumanVerification({
        record,
        clock: () => new Date(fixedNow),
      });
      const receipt = await verification.admit(
        deliveryRequest(packet, "run-blocked"),
      );
      const established = await establishEnvironment(
        record,
        packet,
        "setup-blocked",
      );
      if (established.disposition.status !== "setup-blocked") {
        throw new Error("Expected Setup Blocked");
      }
      const unavailable = {
        kind: "human-verification-environment-unavailable" as const,
        schemaVersion: 1 as const,
        requestDigest: established.request.digest,
      };

      expect(() =>
        defineHumanVerificationRecord(
          verificationIdentity({
            caseId: receipt.caseId,
            packet,
            environment: unavailable,
            effect: "not-observed",
            disposition: {
              status: "rejected",
              reason: "The environment did not become available.",
            },
          }),
        ),
      ).toThrow();

      const blocked = await verification.record(
        defineHumanVerificationRecord(
          verificationIdentity({
            caseId: receipt.caseId,
            packet,
            environment: unavailable,
            effect: "uncertain",
            disposition: {
              status: "blocked",
              reason: "The required gVisor runtime was unavailable.",
              blocker: "environment-unavailable",
            },
          }),
        ),
      );
      expect(blocked).toMatchObject({
        verification: { disposition: { status: "blocked" } },
        finding: null,
        evidenceRequest: null,
      });
    });
  });
});
