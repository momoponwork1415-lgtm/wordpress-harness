import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import type {
  ContainerProcessRequest,
  ContainerProcessResult,
  ContainerProcessRunner,
} from "../../src/infrastructure/gvisor-wordpress-session.js";
import {
  defineFindingVerificationEnvironmentRequest,
  defineHumanVerificationEnvironmentPolicy,
  defineHumanVerificationEnvironmentRequest,
  defineHumanVerificationRuntimeProfile,
  defineHumanVerificationSetupPlan,
  humanVerificationSourceTreeDigest,
  openGvisorWordPressEnvironmentProvisioner,
  openHumanVerificationEnvironmentBuilder,
  setupStageNames,
} from "../../src/human-os/index.js";
import { defineFindingAIReproductionAttempt } from "../../src/human-os/ai-reproduction-contracts.js";
import type {
  GvisorAIReproductionBroker,
  GvisorWordPressAssistantBroker,
} from "../../src/human-os/gvisor-wordpress-environment-provisioner.js";
import {
  openFileHumanOsArtifactStore,
  openSqliteHumanOsRecord,
} from "../../src/human-os/human-os-record/index.js";
import { sha256Digest } from "../../src/research/research-record/canonical-json.js";
import {
  findingId,
  findingSchema,
} from "../../src/research/validation/finding.js";
import { humanReviewPacketSchema } from "../../src/research/validation/human-review-packet.js";

const fixedNow = "2026-09-05T05:00:00.000Z";
const digest = (value: string): string => sha256Digest(value);
const rawDigest = (value: Buffer): string =>
  `sha256:${createHash("sha256").update(value).digest("hex")}`;

function packet(input: {
  readonly targetDigest: string;
  readonly manifestDigest: string;
}) {
  const target = {
    id: "concrete-plugin-1.2.3",
    pluginSlug: "concrete-plugin",
    version: "1.2.3",
    digest: input.targetDigest,
  };
  const manifest = {
    kind: "target-file-manifest" as const,
    schemaVersion: 1 as const,
    targetSnapshotId: target.id,
    targetSnapshotDigest: target.digest,
    digest: input.manifestDigest,
  };
  const anchor = {
    path: "plugin.php",
    fileDigest: digest("plugin-file"),
    startLine: 1,
    endLine: 1,
  };
  const candidate = {
    kind: "validation-candidate" as const,
    schemaVersion: 1 as const,
    id: digest("candidate"),
    digest: digest("candidate-artifact"),
    targetSnapshotDigest: target.digest,
    manifestDigest: manifest.digest,
    origins: 1,
  };
  const riskAssessment = {
    kind: "risk-assessment" as const,
    schemaVersion: 1 as const,
    id: digest("risk"),
    digest: digest("risk-artifact"),
    candidateId: candidate.id,
    validationId: candidate.id,
  };
  const evidence = [
    {
      criterion: "counterevidence-and-proof-gap" as const,
      reason: "The control remains unobserved at runtime.",
      evidence: [anchor],
    },
  ];
  const sketch = {
    attackerRole: "unauthenticated" as const,
    preconditions: ["Use a fresh isolated environment."],
    steps: [
      {
        ordinal: 1,
        action: "Exercise the public Target interface.",
        sourceEvidence: [anchor],
      },
    ],
    expectedSecurityEffect: "Protected state changes.",
    stopConditions: ["Stop on Target identity mismatch."],
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
        claim: "Public input reaches protected state.",
        evidence: [anchor],
      },
    ],
    sourceEvidence: [anchor],
    counterevidence: evidence,
    runtimeUncertainties: ["Runtime effect is not yet observed."],
    humanReproductionSketch: sketch,
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

function finding(input: {
  readonly target: ReturnType<typeof packet>["target"];
  readonly manifest: ReturnType<typeof packet>["manifest"];
  readonly candidateSeed: string;
}) {
  const candidateId = digest(input.candidateSeed);
  const anchor = {
    path: "plugin.php",
    fileDigest: digest(`file-${input.candidateSeed}`),
    startLine: 1,
    endLine: 1,
  };
  return findingSchema.parse({
    kind: "finding",
    schemaVersion: 1,
    id: findingId(candidateId),
    target: input.target,
    manifest: input.manifest,
    candidate: {
      kind: "validation-candidate",
      schemaVersion: 2,
      id: candidateId,
      digest: digest(`candidate-${input.candidateSeed}`),
      targetSnapshotDigest: input.target.digest,
      manifestDigest: input.manifest.digest,
      origins: 1,
    },
    validation: {
      kind: "validation-record",
      schemaVersion: 3,
      validationId: candidateId,
      candidateId,
      digest: digest(`validation-${input.candidateSeed}`),
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
      reason: "Independent source review found no effective boundary.",
      evidence: [anchor],
    },
  });
}

class FakeDockerRunner implements ContainerProcessRunner {
  readonly requests: ContainerProcessRequest[] = [];
  daemonReachable = true;

  async run(request: ContainerProcessRequest): Promise<ContainerProcessResult> {
    this.requests.push(request);
    const args = request.args;
    if (!this.daemonReachable) {
      return {
        exitCode: -1,
        stdout: "",
        stderr: "Cannot connect to the Docker daemon",
      };
    }
    if (args[0] === "info") {
      return this.#result(
        JSON.stringify({ runsc: { path: "/usr/bin/runsc" } }),
      );
    }
    if (args[0] === "inspect") {
      const container = args.at(-1) ?? "";
      return this.#result(
        container.includes("database") ? "10.0.0.2\n" : "10.0.0.3\n",
      );
    }
    if (args[0] === "exec" && args.includes("php")) {
      return this.#result("8.3.24");
    }
    if (args[0] === "exec" && args.includes("mariadb")) {
      return this.#result("mariadb Ver 11.8.3");
    }
    if (args[0] === "exec" && args.includes("apache2")) {
      return this.#result("Server version: Apache/2.4.65");
    }
    if (args.includes("core") && args.includes("version")) {
      return this.#result("6.8.2\n");
    }
    if (args[0] === "run" && args.includes("--eval")) {
      return this.#result(
        JSON.stringify({
          kind: "gvisor-ai-reproduction-http-observation",
          schemaVersion: 1,
          status: 200,
          mediaType: "application/json",
          body: '{"bounded":true}',
        }),
      );
    }
    return this.#result("");
  }

  #result(stdout: string): ContainerProcessResult {
    return { exitCode: 0, stdout, stderr: "" };
  }
}

describe("gVisor WordPress Environment provisioner", () => {
  it("establishes a digest-bound runsc session without forbidden container capabilities and disposes it", async () => {
    const directory = await mkdtemp(join(tmpdir(), "gvisor-human-os-"));
    const sourceDirectory = join(directory, "target");
    const source = Buffer.from("<?php /* fixed public fixture */\n", "utf8");
    await mkdir(sourceDirectory);
    await writeFile(join(sourceDirectory, "plugin.php"), source);
    const targetDigest = digest("target-tree");
    const entries = [
      {
        path: "plugin.php",
        digest: rawDigest(source),
        size: source.byteLength,
      },
    ];
    const targetManifest = {
      kind: "target-file-manifest" as const,
      schemaVersion: 1 as const,
      targetSnapshot: { id: "concrete-plugin-1.2.3", digest: targetDigest },
      entries,
    };
    const manifestDigest = sha256Digest(targetManifest);
    const reviewPacket = packet({ targetDigest, manifestDigest });
    const sourceTreeDigest = humanVerificationSourceTreeDigest({
      targetSnapshotDigest: targetDigest,
      manifestDigest,
      entries,
    });
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
        runtimeVersion: "release-20260817.0",
      },
      images: {
        wordpress: `registry.invalid/wordpress@${digest("wordpress")}`,
        wordpressCli: `registry.invalid/wordpress-cli@${digest("cli")}`,
        database: `registry.invalid/database@${digest("database")}`,
        browser: `registry.invalid/browser@${digest("browser")}`,
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
      pluginSlug: reviewPacket.target.pluginSlug,
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
    const request = defineHumanVerificationEnvironmentRequest({
      packet: reviewPacket,
      target: {
        kind: "human-verification-target",
        schemaVersion: 1,
        snapshot: reviewPacket.target,
        manifest: reviewPacket.manifest,
        sourceArtifact: {
          kind: "content-addressed-target-source",
          mediaType: "application/vnd.wordpress.source-tree+json",
          digest: sourceTreeDigest,
        },
      },
      runtimeProfile,
      setupPlan,
      policy,
      grants: [],
    });
    const runner = new FakeDockerRunner();
    const assistantBroker = {
      run: vi.fn<GvisorWordPressAssistantBroker<string>["run"]>(
        async (_session, observedRequest, role) =>
          `${observedRequest.kind}:${role}`,
      ),
    };
    const provisioner = openGvisorWordPressEnvironmentProvisioner({
      processRunner: runner,
      readRunscVersion: async () => "release-20260817.0",
      targetSourceResolver: {
        resolve: async () => ({ sourceDirectory }),
      },
      setupBroker: {
        resolve: async () => ({
          dependencies: [],
          configure: async () => digest("canonical-configuration"),
          functionalSmoke: async (session) => {
            await session.runWordPressCli([
              "plugin",
              "is-active",
              reviewPacket.target.pluginSlug,
            ]);
            return digest("functional-smoke");
          },
        }),
      },
      assistantBroker,
    });
    const record = openSqliteHumanOsRecord({
      databasePath: join(directory, "human-os.sqlite"),
      artifactStore: openFileHumanOsArtifactStore(join(directory, "artifacts")),
      clock: () => new Date(fixedNow),
    });

    try {
      const disposition = await openHumanVerificationEnvironmentBuilder({
        record,
        provisioner,
        clock: () => new Date(fixedNow),
      }).establish(request);
      expect(disposition.status).toBe("ready");
      if (disposition.status !== "ready") return;

      const runRequests = runner.requests.filter(
        (item) => item.args[0] === "run",
      );
      expect(runRequests.length).toBeGreaterThan(0);
      expect(
        runRequests.every((item) => item.args.includes("--runtime=runsc")),
      ).toBe(true);
      expect(
        runner.requests.some(
          (item) =>
            item.args[0] === "network" && item.args.includes("--internal"),
        ),
      ).toBe(true);
      expect(
        runner.requests
          .flatMap((item) => item.args)
          .some(
            (argument) =>
              argument === "--privileged" ||
              argument === "--network=host" ||
              argument.includes("docker.sock"),
          ),
      ).toBe(false);

      await expect(
        provisioner.runAssistant(disposition.environment.id, "witness"),
      ).resolves.toBe("human-verification-environment-request:witness");
      expect(assistantBroker.run).toHaveBeenCalledOnce();

      // A teardown nobody could observe is not a teardown. The environment
      // stays active so a later attempt still owns it, and the disposition is
      // its own literal rather than a borrowed "completed".
      runner.daemonReachable = false;
      await expect(
        provisioner.cleanup({ environmentId: disposition.environment.id }),
      ).resolves.toBe("unverified");
      expect(provisioner.hasActiveEnvironment(disposition.environment.id)).toBe(
        true,
      );

      runner.daemonReachable = true;
      await expect(
        provisioner.cleanup({ environmentId: disposition.environment.id }),
      ).resolves.toBe("completed");
      expect(provisioner.hasActiveEnvironment(disposition.environment.id)).toBe(
        false,
      );
      expect(
        runner.requests.some(
          (item) => item.args[0] === "rm" && item.args.includes("--force"),
        ),
      ).toBe(true);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("binds a Finding Attempt to a bounded HTTP experiment and excludes current sessions from the legacy Assistant", async () => {
    const directory = await mkdtemp(join(tmpdir(), "gvisor-finding-os-"));
    const sourceDirectory = join(directory, "target");
    const source = Buffer.from("<?php /* fixed public fixture */\n", "utf8");
    await mkdir(sourceDirectory);
    await writeFile(join(sourceDirectory, "plugin.php"), source);
    const targetDigest = digest("finding-target-tree");
    const entries = [
      {
        path: "plugin.php",
        digest: rawDigest(source),
        size: source.byteLength,
      },
    ];
    const targetManifest = {
      kind: "target-file-manifest" as const,
      schemaVersion: 1 as const,
      targetSnapshot: { id: "concrete-plugin-1.2.3", digest: targetDigest },
      entries,
    };
    const manifestDigest = sha256Digest(targetManifest);
    const reviewPacket = packet({ targetDigest, manifestDigest });
    const sourceTreeDigest = humanVerificationSourceTreeDigest({
      targetSnapshotDigest: targetDigest,
      manifestDigest,
      entries,
    });
    const currentFinding = finding({
      target: reviewPacket.target,
      manifest: reviewPacket.manifest,
      candidateSeed: "current-candidate",
    });
    const foreignFinding = finding({
      target: reviewPacket.target,
      manifest: reviewPacket.manifest,
      candidateSeed: "foreign-candidate",
    });
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
        runtimeVersion: "release-20260817.0",
      },
      images: {
        wordpress: `registry.invalid/wordpress@${digest("wordpress")}`,
        wordpressCli: `registry.invalid/wordpress-cli@${digest("cli")}`,
        database: `registry.invalid/database@${digest("database")}`,
        browser: `registry.invalid/browser@${digest("browser")}`,
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
      pluginSlug: currentFinding.target.pluginSlug,
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
    const target = {
      kind: "human-verification-target" as const,
      schemaVersion: 1 as const,
      snapshot: currentFinding.target,
      manifest: currentFinding.manifest,
      sourceArtifact: {
        kind: "content-addressed-target-source" as const,
        mediaType: "application/vnd.wordpress.source-tree+json" as const,
        digest: sourceTreeDigest,
      },
    };
    const request = defineFindingVerificationEnvironmentRequest({
      finding: currentFinding,
      target,
      runtimeProfile,
      setupPlan,
      policy,
      grants: [],
    });
    const attempt = defineFindingAIReproductionAttempt({
      finding: currentFinding,
      target,
      runtimeProfile,
      setupPlan,
      environmentPolicy: policy,
      grants: [],
    });
    const foreignAttempt = defineFindingAIReproductionAttempt({
      finding: foreignFinding,
      target,
      runtimeProfile,
      setupPlan,
      environmentPolicy: policy,
      grants: [],
    });
    const runner = new FakeDockerRunner();
    const aiReproductionBroker = {
      run: vi.fn<GvisorAIReproductionBroker["run"]>(
        async (experiment, observedRequest, observedAttempt) => {
          expect(Object.keys(experiment).sort()).toEqual([
            "environmentId",
            "exchange",
          ]);
          expect("runWorker" in experiment).toBe(false);
          expect("runWordPressCli" in experiment).toBe(false);
          expect("dispose" in experiment).toBe(false);
          expect(observedRequest.digest).toBe(request.digest);
          expect(observedAttempt.id).toBe(attempt.id);
          Reflect.set(
            observedRequest.runtimeProfile.images,
            "browser",
            `registry.invalid/foreign@${digest("foreign-browser")}`,
          );
          await expect(
            experiment.exchange({
              kind: "gvisor-ai-reproduction-http-exchange",
              schemaVersion: 1,
              method: "GET",
              path: "//outside.example.invalid/",
              mediaType: null,
              body: null,
            }),
          ).rejects.toThrow("relative to the isolated WordPress origin");
          const observation = await experiment.exchange({
            kind: "gvisor-ai-reproduction-http-exchange",
            schemaVersion: 1,
            method: "POST",
            path: "/wp-json/concrete-plugin/v1/check",
            mediaType: "application/json",
            body: '{"probe":"bounded"}',
          });
          expect(observation).toMatchObject({
            status: 200,
            body: '{"bounded":true}',
          });
          return {
            status: "inconclusive" as const,
            reason: "effect-unclear" as const,
            description: "The bounded HTTP observation was not decisive.",
          };
        },
      ),
    } satisfies GvisorAIReproductionBroker;
    const assistantBroker = {
      run: vi.fn(async () => "legacy-only"),
    } satisfies GvisorWordPressAssistantBroker<string>;
    const provisioner = openGvisorWordPressEnvironmentProvisioner({
      processRunner: runner,
      readRunscVersion: async () => "release-20260817.0",
      targetSourceResolver: {
        resolve: async () => ({ sourceDirectory }),
      },
      setupBroker: {
        resolve: async () => ({
          dependencies: [],
          configure: async () => digest("canonical-configuration"),
          functionalSmoke: async (session) => {
            await session.runWordPressCli([
              "plugin",
              "is-active",
              currentFinding.target.pluginSlug,
            ]);
            return digest("functional-smoke");
          },
        }),
      },
      aiReproductionBroker,
      assistantBroker,
    });

    try {
      const setup = await provisioner.setup(request);
      expect(setup.status).toBe("ready");
      if (setup.status !== "ready") return;

      await expect(
        provisioner.runExperiment(setup.handle.environmentId, attempt),
      ).resolves.toMatchObject({
        status: "inconclusive",
        reason: "effect-unclear",
      });
      expect(aiReproductionBroker.run).toHaveBeenCalledOnce();

      const workerRequest = runner.requests.find(
        ({ args }) => args[0] === "run" && args.includes("--eval"),
      );
      expect(workerRequest).toBeDefined();
      expect(workerRequest?.args).toContain(runtimeProfile.images.browser);
      expect(workerRequest?.args).not.toContain(
        `registry.invalid/foreign@${digest("foreign-browser")}`,
      );
      expect(workerRequest?.args).toContain("--runtime=runsc");
      expect(workerRequest?.args).toContain("wordpress:10.0.0.3");
      expect(workerRequest?.args).not.toContain("--volume");
      const browserImageIndex =
        workerRequest?.args.indexOf(runtimeProfile.images.browser) ?? -1;
      expect(
        workerRequest?.args.slice(browserImageIndex + 1, browserImageIndex + 5),
      ).toEqual(["node", "--input-type=module", "--eval", expect.any(String)]);

      await expect(
        provisioner.runExperiment(setup.handle.environmentId, foreignAttempt),
      ).rejects.toThrow("does not own the live session");
      await expect(
        provisioner.runExperiment("foreign-session", attempt),
      ).rejects.toThrow("Environment is not active");
      await expect(
        provisioner.runAssistant(setup.handle.environmentId, "witness"),
      ).rejects.toThrow();
      expect(aiReproductionBroker.run).toHaveBeenCalledOnce();
      expect(assistantBroker.run).not.toHaveBeenCalled();

      await expect(provisioner.cleanup(setup.handle)).resolves.toBe(
        "completed",
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
