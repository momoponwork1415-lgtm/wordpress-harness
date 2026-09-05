import { createHash } from "node:crypto";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { openFileJsonArtifactStore } from "../../src/research/research-record/index.js";
import { sha256Digest } from "../../src/research/research-record/canonical-json.js";
import {
  LabControlBlockedError,
  openGvisorAccountTakeoverLabControl,
  type ExperimentExecutionRequest,
  type ExperimentPlan,
  type LabProcessRunner,
} from "../../src/research/verification/index.js";

const digest = (character: string): string => `sha256:${character.repeat(64)}`;
const images = {
  database: `docker.io/library/mariadb@${digest("9")}`,
  wordpress: `docker.io/library/wordpress@${digest("a")}`,
  wordpressCli: `docker.io/library/wordpress-cli@${digest("b")}`,
  worker: `docker.io/microsoft/playwright@${digest("c")}`,
};
const workerContent = "// private account-takeover worker fixture\n";
const setupFixtureContent = "<?php // reviewed account setup fixture\n";
const inputContent = '{"private":"fixture"}\n';
const targetContent = "<?php // admitted account-takeover target fixture\n";

function rawDigest(content: string): string {
  return `sha256:${createHash("sha256").update(content).digest("hex")}`;
}

const runtimeProfileDigest = sha256Digest({
  kind: "gvisor-wordpress-runtime-profile",
  schemaVersion: 1,
  runtime: "runsc-systrap",
  images,
});
const setupPlanDigest = sha256Digest({
  kind: "authentication-state-transition-setup-plan",
  schemaVersion: 1,
  operations: [
    "install-wordpress",
    "activate-target",
    "activate-reviewed-fixture",
  ],
});
const targetManifest = {
  kind: "target-file-manifest",
  schemaVersion: 1,
  targetSnapshot: {
    id: "fixture-plugin-1.0.0",
    digest: digest("4"),
  },
  entries: [
    {
      path: "plugin.php",
      digest: rawDigest(targetContent),
      size: Buffer.byteLength(targetContent),
    },
  ],
};
const protocol = {
  kind: "source-route-experiment-protocol" as const,
  schemaVersion: 1 as const,
  adapterVersion: "authentication-state-transition@v1" as const,
  requiredSourceEvidence: [
    {
      path: "plugin.php",
      fileDigest: rawDigest(targetContent),
      startLine: 1,
      endLine: 1,
    },
  ],
};
const configurationDigest = sha256Digest({
  kind: "authentication-state-transition-lab-configuration",
  schemaVersion: 1,
  targetPluginSlug: "fixture-plugin",
  targetManifestDigest: sha256Digest(targetManifest),
  setupFixturePluginSlug: "account-takeover-setup-fixture",
  setupFixtureManifestDigest: sha256Digest({
    kind: "trusted-fixture-manifest",
    schemaVersion: 1,
    entries: [
      {
        path: "fixture.php",
        digest: rawDigest(setupFixtureContent),
        size: Buffer.byteLength(setupFixtureContent),
      },
    ],
  }),
  workerDigest: rawDigest(workerContent),
  workerInputDigest: rawDigest(inputContent),
  protocolDigest: sha256Digest(protocol),
});
const baselineDigest = sha256Digest({
  kind: "lab-baseline-definition",
  schemaVersion: 1,
  targetSnapshotDigest: digest("4"),
  runtimeProfileDigest,
  setupPlanDigest,
  configurationDigest,
});

function accountTakeoverExperimentPlan(): ExperimentPlan {
  return {
    kind: "experiment-plan",
    schemaVersion: 1,
    experimentId: digest("1"),
    verificationId: "verification-gvisor-ato",
    role: "witness",
    siblingGroupId: digest("2"),
    hypothesisDigest: digest("3"),
    bindings: {
      targetSnapshotDigest: digest("4"),
      labBaselineDigest: baselineDigest,
      runtimeProfileDigest,
      setupPlanDigest,
      configurationDigest,
      adapterVersion: "authentication-state-transition@v1",
    },
    mechanism: {
      kind: "authentication-state-transition",
      schemaVersion: 1,
      adapterVersion: "authentication-state-transition@v1",
      causalFactor: "public-reset-capability-disclosure",
      successCriterion: "target-account-authentication-canary",
      causalFactorState: "present",
    },
  };
}

function accountTakeoverExecutionRequest(
  plan: ExperimentPlan,
): ExperimentExecutionRequest {
  const sourceRederivation = {
    kind: "source-rederivation" as const,
    schemaVersion: 1 as const,
    verificationId: plan.verificationId,
    targetSnapshotDigest: plan.bindings.targetSnapshotDigest,
    hypothesisDigest: plan.hypothesisDigest,
    status: "supported" as const,
    sourceEvidence: protocol.requiredSourceEvidence,
    experiment: {
      kind: "authentication-state-transition" as const,
      schemaVersion: 1 as const,
      adapterVersion: "authentication-state-transition@v1" as const,
      causalFactor: plan.mechanism.causalFactor,
      successCriterion: "target-account-authentication-canary" as const,
    },
  };
  return {
    kind: "experiment-execution-request",
    schemaVersion: 1,
    plan,
    sourceRederivation,
    sourceRederivationDigest: sha256Digest(sourceRederivation),
  };
}

describe("gVisor Account Takeover Lab Control", () => {
  it("records only a method-neutral authentication-state observation from a fresh runsc Lab", async () => {
    const directory = await mkdtemp(join(tmpdir(), "gvisor-ato-lab-"));
    const targetDirectory = join(directory, "target-plugin");
    const setupFixtureDirectory = join(directory, "setup-fixture");
    const workerFile = join(directory, "account-takeover-worker.mjs");
    const inputFile = join(directory, "account-takeover-input.private.json");
    const manifestFile = join(directory, "target-manifest.json");
    const definitionFile = join(directory, "experiment.private.json");
    const artifactStore = openFileJsonArtifactStore(join(directory, "cas"));
    const plan = accountTakeoverExperimentPlan();
    const databaseAddress = "172.31.0.2";
    const wordpressAddress = "172.31.0.3";
    let workerRequest: readonly string[] | undefined;
    const processRequests: (readonly string[])[] = [];

    try {
      await mkdir(targetDirectory);
      await mkdir(setupFixtureDirectory);
      await writeFile(join(targetDirectory, "plugin.php"), targetContent);
      await writeFile(
        join(setupFixtureDirectory, "fixture.php"),
        setupFixtureContent,
      );
      await writeFile(workerFile, workerContent);
      await writeFile(inputFile, inputContent);
      await writeFile(manifestFile, JSON.stringify(targetManifest));
      await writeFile(
        definitionFile,
        JSON.stringify({
          kind: "authentication-state-transition-lab-definition",
          schemaVersion: 1,
          bindings: plan.bindings,
          protocol,
          images,
          target: {
            sourceDirectory: targetDirectory,
            pluginSlug: "fixture-plugin",
            manifestFile,
          },
          fixture: {
            sourceDirectory: setupFixtureDirectory,
            pluginSlug: "account-takeover-setup-fixture",
          },
          worker: { workerFile, inputFile },
        }),
      );
      const processRunner: LabProcessRunner = {
        run: async (request) => {
          processRequests.push(request.args);
          if (request.args[0] === "info") {
            return {
              exitCode: 0,
              stdout: JSON.stringify({ runsc: { path: "runsc" } }),
              stderr: "",
            };
          }
          if (request.args[0] === "inspect") {
            return {
              exitCode: 0,
              stdout: request.args.at(-1)?.endsWith("-database")
                ? `${databaseAddress}\n`
                : `${wordpressAddress}\n`,
              stderr: "",
            };
          }
          if (request.args.includes(images.worker)) {
            workerRequest = request.args;
            return {
              exitCode: 0,
              stdout: JSON.stringify({
                kind: "authentication-state-transition-result",
                schemaVersion: 1,
                normalFunction: "preserved",
                attackerContextInitiallyAuthenticated: false,
                attackerSequenceExecuted: true,
                targetAccountAuthenticationObserved: true,
              }),
              stderr: "",
            };
          }
          return { exitCode: 0, stdout: "", stderr: "" };
        },
      };
      const labControl = openGvisorAccountTakeoverLabControl({
        artifactStore,
        processRunner,
        definitionFile,
      });

      const ref = await labControl.execute(
        accountTakeoverExecutionRequest(plan),
      );
      const observation = await artifactStore.readJson(ref.digest);

      expect(observation).toMatchObject({
        kind: "experiment-observation",
        experimentId: plan.experimentId,
        verificationId: plan.verificationId,
        bindings: plan.bindings,
        isolation: {
          runtime: "gvisor",
          runtimeDigest: plan.bindings.runtimeProfileDigest,
          siblingGroupId: plan.siblingGroupId,
          fresh: true,
          fallbackUsed: false,
        },
        normalFunction: "preserved",
        result: {
          kind: "authentication-state-transition",
          attackerContextInitiallyAuthenticated: false,
          attackerSequenceExecuted: true,
          targetAccountAuthenticationObserved: true,
        },
      });
      expect(workerRequest).toEqual(
        expect.arrayContaining([
          "--runtime=runsc",
          "--add-host",
          `wordpress:${wordpressAddress}`,
          `HARNESS_ROLE=${plan.role}`,
          `HARNESS_CAUSAL_FACTOR_STATE=${plan.mechanism.causalFactorState}`,
        ]),
      );
      expect(processRequests.flat()).not.toContain("eval-file");
      expect(
        processRequests.some(
          (request) =>
            request.includes("activate") &&
            request.includes("account-takeover-setup-fixture"),
        ),
      ).toBe(true);
      expect(JSON.stringify(observation)).not.toContain(targetDirectory);
      expect(JSON.stringify(observation)).not.toContain(workerFile);
      expect(JSON.stringify(observation)).not.toContain(setupFixtureDirectory);
      expect(JSON.stringify(observation)).not.toContain(inputFile);
      expect(JSON.stringify(observation)).not.toContain("reset-token");
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it("rejects a different source route before starting gVisor preflight", async () => {
    const directory = await mkdtemp(join(tmpdir(), "gvisor-ato-protocol-"));
    const targetDirectory = join(directory, "target-plugin");
    const setupFixtureDirectory = join(directory, "setup-fixture");
    const workerFile = join(directory, "account-takeover-worker.mjs");
    const inputFile = join(directory, "account-takeover-input.private.json");
    const manifestFile = join(directory, "target-manifest.json");
    const definitionFile = join(directory, "experiment.private.json");
    const artifactStore = openFileJsonArtifactStore(join(directory, "cas"));
    const plan = accountTakeoverExperimentPlan();
    let processStarted = false;

    try {
      await mkdir(targetDirectory);
      await mkdir(setupFixtureDirectory);
      await writeFile(join(targetDirectory, "plugin.php"), targetContent);
      await writeFile(
        join(setupFixtureDirectory, "fixture.php"),
        setupFixtureContent,
      );
      await writeFile(workerFile, workerContent);
      await writeFile(inputFile, inputContent);
      await writeFile(manifestFile, JSON.stringify(targetManifest));
      await writeFile(
        definitionFile,
        JSON.stringify({
          kind: "authentication-state-transition-lab-definition",
          schemaVersion: 1,
          bindings: plan.bindings,
          protocol,
          images,
          target: {
            sourceDirectory: targetDirectory,
            pluginSlug: "fixture-plugin",
            manifestFile,
          },
          fixture: {
            sourceDirectory: setupFixtureDirectory,
            pluginSlug: "account-takeover-setup-fixture",
          },
          worker: { workerFile, inputFile },
        }),
      );
      const labControl = openGvisorAccountTakeoverLabControl({
        artifactStore,
        processRunner: {
          run: async () => {
            processStarted = true;
            throw new Error("a mismatched route must not start preflight");
          },
        },
        definitionFile,
      });
      const request = accountTakeoverExecutionRequest(plan);
      const sourceRederivation = {
        ...request.sourceRederivation,
        sourceEvidence: [
          {
            path: "different-route.php",
            fileDigest: rawDigest(targetContent),
            startLine: 1,
            endLine: 1,
          },
        ],
      };

      await expect(
        labControl.execute({
          ...request,
          sourceRederivation,
          sourceRederivationDigest: sha256Digest(sourceRederivation),
        }),
      ).rejects.toEqual(new LabControlBlockedError("unsupported-experiment"));
      expect(processStarted).toBe(false);
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });
});
