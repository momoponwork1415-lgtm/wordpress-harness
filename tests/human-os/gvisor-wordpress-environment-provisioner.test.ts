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
  defineHumanVerificationEnvironmentPolicy,
  defineHumanVerificationEnvironmentRequest,
  defineHumanVerificationRuntimeProfile,
  defineHumanVerificationSetupPlan,
  humanVerificationSourceTreeDigest,
  openGvisorWordPressEnvironmentProvisioner,
  openHumanVerificationEnvironmentBuilder,
  setupStageNames,
} from "../../src/human-os/index.js";
import {
  openFileHumanOsArtifactStore,
  openSqliteHumanOsRecord,
} from "../../src/human-os/human-os-record/index.js";
import { sha256Digest } from "../../src/research/research-record/canonical-json.js";
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

class FakeDockerRunner implements ContainerProcessRunner {
  readonly requests: ContainerProcessRequest[] = [];

  async run(request: ContainerProcessRequest): Promise<ContainerProcessResult> {
    this.requests.push(request);
    const args = request.args;
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
        provisioner.cleanup({ environmentId: disposition.environment.id }),
      ).resolves.toBe("completed");
      expect(
        runner.requests.some(
          (item) => item.args[0] === "rm" && item.args.includes("--force"),
        ),
      ).toBe(true);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
