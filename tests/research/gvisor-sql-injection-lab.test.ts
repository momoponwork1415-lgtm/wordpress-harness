import { createHash } from "node:crypto";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  openGvisorSqlInjectionLabControl,
  type ExperimentExecutionRequest,
  type ExperimentPlan,
  type LabProcessRunner,
} from "../../src/research/verification/index.js";
import { openFileJsonArtifactStore } from "../../src/research/research-record/index.js";
import { sha256Digest } from "../../src/research/research-record/canonical-json.js";

const digest = (character: string): string => `sha256:${character.repeat(64)}`;
const images = {
  database: `docker.io/library/mariadb@${digest("9")}`,
  wordpress: `docker.io/library/wordpress@${digest("a")}`,
  wordpressCli: `docker.io/library/wordpress-cli@${digest("b")}`,
  worker: `docker.io/microsoft/playwright@${digest("c")}`,
};
const workerContent = "// private SQLi worker fixture\n";
const setupFixtureContent = "<?php // reviewed SQLi setup plugin fixture\n";
const inputContent = '{"private":"fixture"}\n';
const targetContent = "<?php // admitted SQLi target fixture\n";

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
  kind: "sql-injection-setup-plan",
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
  adapterVersion: "sql-injection-database@v1" as const,
  requiredSourceEvidence: [
    {
      path: "plugin.php",
      fileDigest: rawDigest(targetContent),
      startLine: 1,
      endLine: 1,
    },
  ],
};
const queryEffectProtocol = {
  ...protocol,
  adapterVersion: "sql-query-semantic-effect@v1" as const,
};
const configurationDigest = sha256Digest({
  kind: "sql-injection-lab-configuration",
  schemaVersion: 1,
  targetPluginSlug: "fixture-plugin",
  targetManifestDigest: sha256Digest(targetManifest),
  setupFixturePluginSlug: "sql-injection-setup-fixture",
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
const queryEffectConfigurationDigest = sha256Digest({
  kind: "sql-injection-lab-configuration",
  schemaVersion: 1,
  targetPluginSlug: "fixture-plugin",
  targetManifestDigest: sha256Digest(targetManifest),
  setupFixturePluginSlug: "sql-injection-setup-fixture",
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
  protocolDigest: sha256Digest(queryEffectProtocol),
});
const queryEffectBaselineDigest = sha256Digest({
  kind: "lab-baseline-definition",
  schemaVersion: 1,
  targetSnapshotDigest: digest("4"),
  runtimeProfileDigest,
  setupPlanDigest,
  configurationDigest: queryEffectConfigurationDigest,
});

function sqlInjectionExperimentPlan(): ExperimentPlan {
  return {
    kind: "experiment-plan",
    schemaVersion: 1,
    experimentId: digest("1"),
    verificationId: "verification-gvisor-sqli",
    role: "witness",
    siblingGroupId: digest("2"),
    hypothesisDigest: digest("3"),
    bindings: {
      targetSnapshotDigest: digest("4"),
      labBaselineDigest: baselineDigest,
      runtimeProfileDigest,
      setupPlanDigest,
      configurationDigest,
      adapterVersion: "sql-injection-database@v1",
    },
    mechanism: {
      kind: "sql-injection-database",
      schemaVersion: 1,
      adapterVersion: "sql-injection-database@v1",
      causalFactor: "request-controlled-query-structure",
      successCriterion: "database-readback-canary",
      causalFactorState: "present",
    },
  };
}

function sqlQueryEffectExperimentPlan(): ExperimentPlan {
  return {
    ...sqlInjectionExperimentPlan(),
    bindings: {
      targetSnapshotDigest: digest("4"),
      labBaselineDigest: queryEffectBaselineDigest,
      runtimeProfileDigest,
      setupPlanDigest,
      configurationDigest: queryEffectConfigurationDigest,
      adapterVersion: "sql-query-semantic-effect@v1",
    },
    mechanism: {
      kind: "sql-query-semantic-effect",
      schemaVersion: 1,
      adapterVersion: "sql-query-semantic-effect@v1",
      causalFactor: "request-controlled-query-structure",
      successCriterion: "security-effect",
      effect: { kind: "database-state-change-canary" },
      causalFactorState: "present",
    },
  };
}

function sqlInjectionExecutionRequest(
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
      kind: "sql-injection-database" as const,
      schemaVersion: 1 as const,
      adapterVersion: "sql-injection-database@v1" as const,
      causalFactor: plan.mechanism.causalFactor,
      successCriterion: "database-readback-canary" as const,
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

function sqlQueryEffectExecutionRequest(
  plan: ExperimentPlan,
): ExperimentExecutionRequest {
  if (plan.mechanism.kind !== "sql-query-semantic-effect") {
    throw new Error("Expected SQL query semantic effect Plan");
  }
  const sourceRederivation = {
    kind: "source-rederivation" as const,
    schemaVersion: 1 as const,
    verificationId: plan.verificationId,
    targetSnapshotDigest: plan.bindings.targetSnapshotDigest,
    hypothesisDigest: plan.hypothesisDigest,
    status: "supported" as const,
    sourceEvidence: queryEffectProtocol.requiredSourceEvidence,
    experiment: {
      kind: "sql-query-semantic-effect" as const,
      schemaVersion: 1 as const,
      adapterVersion: "sql-query-semantic-effect@v1" as const,
      causalFactor: plan.mechanism.causalFactor,
      successCriterion: "security-effect" as const,
      effect: plan.mechanism.effect,
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

describe("gVisor SQL Injection Lab Control", () => {
  it("records a sanitized non-readback SQL security effect from a fresh runsc Lab", async () => {
    const directory = await mkdtemp(join(tmpdir(), "gvisor-sqli-effect-lab-"));
    const targetDirectory = join(directory, "target-plugin");
    const setupFixtureDirectory = join(directory, "setup-fixture");
    const workerFile = join(directory, "sql-injection-worker.mjs");
    const inputFile = join(directory, "sql-injection-input.private.json");
    const manifestFile = join(directory, "target-manifest.json");
    const definitionFile = join(directory, "experiment.private.json");
    const artifactStore = openFileJsonArtifactStore(join(directory, "cas"));
    const plan = sqlQueryEffectExperimentPlan();

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
          kind: "sql-injection-lab-definition",
          schemaVersion: 1,
          bindings: plan.bindings,
          protocol: queryEffectProtocol,
          images,
          target: {
            sourceDirectory: targetDirectory,
            pluginSlug: "fixture-plugin",
            manifestFile,
          },
          fixture: {
            sourceDirectory: setupFixtureDirectory,
            pluginSlug: "sql-injection-setup-fixture",
          },
          worker: { workerFile, inputFile },
        }),
      );
      const processRunner: LabProcessRunner = {
        run: async (request) => {
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
                ? "172.31.0.2\n"
                : "172.31.0.3\n",
              stderr: "",
            };
          }
          if (request.args.includes(images.worker)) {
            return {
              exitCode: 0,
              stdout: JSON.stringify({
                kind: "sql-query-semantic-effect-result",
                schemaVersion: 1,
                normalFunction: "preserved",
                attackerSequenceExecuted: true,
                effect: {
                  kind: "database-state-change-canary",
                  observed: true,
                },
              }),
              stderr: "",
            };
          }
          return { exitCode: 0, stdout: "", stderr: "" };
        },
      };
      const labControl = openGvisorSqlInjectionLabControl({
        artifactStore,
        processRunner,
        definitionFile,
      });

      const ref = await labControl.execute(
        sqlQueryEffectExecutionRequest(plan),
      );
      await expect(artifactStore.readJson(ref.digest)).resolves.toMatchObject({
        result: {
          kind: "sql-query-semantic-effect",
          attackerSequenceExecuted: true,
          effect: {
            kind: "database-state-change-canary",
            observed: true,
          },
        },
      });
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it("records only a sanitized database-readback observation from a fresh runsc Lab", async () => {
    const directory = await mkdtemp(join(tmpdir(), "gvisor-sqli-lab-"));
    const targetDirectory = join(directory, "target-plugin");
    const setupFixtureDirectory = join(directory, "setup-fixture");
    const workerFile = join(directory, "sql-injection-worker.mjs");
    const inputFile = join(directory, "sql-injection-input.private.json");
    const manifestFile = join(directory, "target-manifest.json");
    const definitionFile = join(directory, "experiment.private.json");
    const artifactStore = openFileJsonArtifactStore(join(directory, "cas"));
    const plan = sqlInjectionExperimentPlan();
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
          kind: "sql-injection-lab-definition",
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
            pluginSlug: "sql-injection-setup-fixture",
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
                kind: "sql-injection-database-result",
                schemaVersion: 1,
                normalFunction: "preserved",
                attackerRequestAccepted: true,
                databaseReadbackCanaryObserved: true,
              }),
              stderr: "",
            };
          }
          return { exitCode: 0, stdout: "", stderr: "" };
        },
      };
      const labControl = openGvisorSqlInjectionLabControl({
        artifactStore,
        processRunner,
        definitionFile,
      });

      const ref = await labControl.execute(sqlInjectionExecutionRequest(plan));
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
          kind: "sql-injection-database",
          attackerRequestAccepted: true,
          databaseReadbackCanaryObserved: true,
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
            request.includes("sql-injection-setup-fixture"),
        ),
      ).toBe(true);
      expect(JSON.stringify(observation)).not.toContain(targetDirectory);
      expect(JSON.stringify(observation)).not.toContain(workerFile);
      expect(JSON.stringify(observation)).not.toContain(setupFixtureDirectory);
      expect(JSON.stringify(observation)).not.toContain(inputFile);
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });
});
