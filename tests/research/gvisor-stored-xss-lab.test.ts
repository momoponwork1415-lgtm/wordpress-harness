import { createHash } from "node:crypto";
import {
  access,
  mkdtemp,
  mkdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  LabControlBlockedError,
  openNativeLabProcessRunner,
  openGvisorStoredXssLabControl,
  type ExperimentExecutionRequest,
  type ExperimentPlan,
  type LabProcessRunner,
} from "../../src/research/verification/index.js";
import {
  openFileJsonArtifactStore,
  type JsonArtifactStore,
} from "../../src/research/research-record/index.js";
import { sha256Digest } from "../../src/research/research-record/canonical-json.js";

const digest = (character: string): string => `sha256:${character.repeat(64)}`;
const testImages = {
  database: `docker.io/library/mariadb@${digest("9")}`,
  wordpress: `docker.io/library/wordpress@${digest("a")}`,
  wordpressCli: `docker.io/library/wordpress-cli@${digest("b")}`,
  browser: digest("c"),
};
const testWorkerContent = "// private browser worker fixture\n";
const testInputContent = '{"private":"fixture"}\n';
const testTargetReadmeContent = "admitted target fixture\n";
const testTargetPluginContent = "<?php // admitted target fixture\n";

function rawDigest(content: string): string {
  return `sha256:${createHash("sha256").update(content).digest("hex")}`;
}

const testRuntimeProfileDigest = sha256Digest({
  kind: "gvisor-wordpress-runtime-profile",
  schemaVersion: 1,
  runtime: "runsc-systrap",
  images: testImages,
});
const testSetupPlanDigest = sha256Digest({
  kind: "stored-xss-setup-plan",
  schemaVersion: 1,
  operations: [
    "install-wordpress",
    "activate-target",
    "activate-reviewed-fixture",
  ],
});
const testTargetManifest = {
  kind: "target-file-manifest",
  schemaVersion: 1,
  targetSnapshot: {
    id: "fixture-plugin-1.0.0",
    digest: digest("4"),
  },
  entries: [
    {
      path: "README.md",
      digest: rawDigest(testTargetReadmeContent),
      size: Buffer.byteLength(testTargetReadmeContent),
    },
    {
      path: "admin/plugin.php",
      digest: rawDigest(testTargetPluginContent),
      size: Buffer.byteLength(testTargetPluginContent),
    },
  ],
};
const testTargetManifestDigest = sha256Digest(testTargetManifest);
const testProtocol = {
  kind: "source-route-experiment-protocol" as const,
  schemaVersion: 1 as const,
  adapterVersion: "stored-xss-browser@v1" as const,
  requiredSourceEvidence: [
    {
      path: "admin/plugin.php",
      fileDigest: rawDigest(testTargetPluginContent),
      startLine: 1,
      endLine: 1,
    },
  ],
};
const browserEffectProtocol = {
  ...testProtocol,
  adapterVersion: "browser-script-execution@v1" as const,
};
const testConfigurationDigest = sha256Digest({
  kind: "stored-xss-lab-configuration",
  schemaVersion: 1,
  targetPluginSlug: "fixture-plugin",
  targetManifestDigest: testTargetManifestDigest,
  fixturePluginSlug: "harness-fixture",
  fixtureManifestDigest: sha256Digest({
    kind: "trusted-fixture-manifest",
    schemaVersion: 1,
    entries: [],
  }),
  browserWorkerDigest: rawDigest(testWorkerContent),
  browserInputDigest: rawDigest(testInputContent),
  protocolDigest: sha256Digest(testProtocol),
});
const testBaselineDigest = sha256Digest({
  kind: "lab-baseline-definition",
  schemaVersion: 1,
  targetSnapshotDigest: digest("4"),
  runtimeProfileDigest: testRuntimeProfileDigest,
  setupPlanDigest: testSetupPlanDigest,
  configurationDigest: testConfigurationDigest,
});
const browserEffectConfigurationDigest = sha256Digest({
  kind: "stored-xss-lab-configuration",
  schemaVersion: 1,
  targetPluginSlug: "fixture-plugin",
  targetManifestDigest: testTargetManifestDigest,
  fixturePluginSlug: "harness-fixture",
  fixtureManifestDigest: sha256Digest({
    kind: "trusted-fixture-manifest",
    schemaVersion: 1,
    entries: [],
  }),
  browserWorkerDigest: rawDigest(testWorkerContent),
  browserInputDigest: rawDigest(testInputContent),
  protocolDigest: sha256Digest(browserEffectProtocol),
});
const browserEffectBaselineDigest = sha256Digest({
  kind: "lab-baseline-definition",
  schemaVersion: 1,
  targetSnapshotDigest: digest("4"),
  runtimeProfileDigest: testRuntimeProfileDigest,
  setupPlanDigest: testSetupPlanDigest,
  configurationDigest: browserEffectConfigurationDigest,
});

function storedXssExperimentPlan(): ExperimentPlan {
  return {
    kind: "experiment-plan",
    schemaVersion: 1,
    experimentId: digest("1"),
    verificationId: "verification-gvisor-preflight",
    role: "witness",
    siblingGroupId: digest("2"),
    hypothesisDigest: digest("3"),
    bindings: {
      targetSnapshotDigest: digest("4"),
      labBaselineDigest: testBaselineDigest,
      runtimeProfileDigest: testRuntimeProfileDigest,
      setupPlanDigest: testSetupPlanDigest,
      configurationDigest: testConfigurationDigest,
      adapterVersion: "stored-xss-browser@v1",
    },
    mechanism: {
      kind: "stored-xss-browser",
      schemaVersion: 1,
      adapterVersion: "stored-xss-browser@v1",
      causalFactor: "attacker-controlled-stored-value",
      successCriterion: "privileged-browser-execution-canary",
      causalFactorState: "present",
    },
  };
}

function browserScriptExecutionPlan(): ExperimentPlan {
  return {
    ...storedXssExperimentPlan(),
    bindings: {
      targetSnapshotDigest: digest("4"),
      labBaselineDigest: browserEffectBaselineDigest,
      runtimeProfileDigest: testRuntimeProfileDigest,
      setupPlanDigest: testSetupPlanDigest,
      configurationDigest: browserEffectConfigurationDigest,
      adapterVersion: "browser-script-execution@v1",
    },
    mechanism: {
      kind: "browser-script-execution",
      schemaVersion: 1,
      adapterVersion: "browser-script-execution@v1",
      causalFactor: "attacker-controlled-rendered-value",
      successCriterion: "browser-execution-canary",
      victimContext: "privileged",
      causalFactorState: "present",
    },
  };
}

function storedXssExecutionRequest(
  plan: ExperimentPlan,
): ExperimentExecutionRequest {
  const sourceRederivation = {
    kind: "source-rederivation" as const,
    schemaVersion: 1 as const,
    verificationId: plan.verificationId,
    targetSnapshotDigest: plan.bindings.targetSnapshotDigest,
    hypothesisDigest: plan.hypothesisDigest,
    status: "supported" as const,
    sourceEvidence: testProtocol.requiredSourceEvidence,
    experiment: {
      kind: "stored-xss-browser" as const,
      schemaVersion: 1 as const,
      adapterVersion: "stored-xss-browser@v1" as const,
      causalFactor: plan.mechanism.causalFactor,
      successCriterion: "privileged-browser-execution-canary" as const,
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

function browserScriptExecutionRequest(
  plan: ExperimentPlan,
): ExperimentExecutionRequest {
  if (plan.mechanism.kind !== "browser-script-execution") {
    throw new Error("Expected browser script execution Plan");
  }
  const sourceRederivation = {
    kind: "source-rederivation" as const,
    schemaVersion: 1 as const,
    verificationId: plan.verificationId,
    targetSnapshotDigest: plan.bindings.targetSnapshotDigest,
    hypothesisDigest: plan.hypothesisDigest,
    status: "supported" as const,
    sourceEvidence: browserEffectProtocol.requiredSourceEvidence,
    experiment: {
      kind: "browser-script-execution" as const,
      schemaVersion: 1 as const,
      adapterVersion: "browser-script-execution@v1" as const,
      causalFactor: plan.mechanism.causalFactor,
      successCriterion: "browser-execution-canary" as const,
      victimContext: plan.mechanism.victimContext,
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

async function writeLabDefinition(
  directory: string,
  plan: ExperimentPlan,
): Promise<{
  readonly browserImage: string;
  readonly definitionFile: string;
  readonly fixtureDirectory: string;
  readonly inputFile: string;
  readonly targetDirectory: string;
  readonly workerFile: string;
}> {
  const targetDirectory = join(directory, "target-plugin");
  const fixtureDirectory = join(directory, "fixture-plugin");
  const workerFile = join(directory, "browser-worker.mjs");
  const inputFile = join(directory, "browser-input.private.json");
  const definitionFile = join(directory, "experiment.private.json");
  const targetManifestFile = join(directory, "target-manifest.json");
  const browserImage = testImages.browser;
  await mkdir(join(targetDirectory, "admin"), { recursive: true });
  await mkdir(fixtureDirectory);
  await writeFile(workerFile, testWorkerContent);
  await writeFile(inputFile, testInputContent);
  await writeFile(join(targetDirectory, "README.md"), testTargetReadmeContent);
  await writeFile(
    join(targetDirectory, "admin", "plugin.php"),
    testTargetPluginContent,
  );
  await writeFile(targetManifestFile, JSON.stringify(testTargetManifest));
  await writeFile(
    definitionFile,
    JSON.stringify({
      kind: "stored-xss-lab-definition",
      schemaVersion: 1,
      bindings: plan.bindings,
      protocol:
        plan.mechanism.kind === "browser-script-execution"
          ? browserEffectProtocol
          : testProtocol,
      images: testImages,
      target: {
        sourceDirectory: targetDirectory,
        pluginSlug: "fixture-plugin",
        manifestFile: targetManifestFile,
      },
      fixture: {
        sourceDirectory: fixtureDirectory,
        pluginSlug: "harness-fixture",
      },
      browser: { workerFile, inputFile },
    }),
  );
  return {
    browserImage,
    definitionFile,
    fixtureDirectory,
    inputFile,
    targetDirectory,
    workerFile,
  };
}

describe("gVisor Stored XSS Lab Control", () => {
  it("records browser execution without requiring a persistent-state claim", async () => {
    const directory = await mkdtemp(join(tmpdir(), "gvisor-browser-effect-"));
    const artifactStore = openFileJsonArtifactStore(join(directory, "cas"));
    const plan = browserScriptExecutionPlan();

    try {
      const definition = await writeLabDefinition(directory, plan);
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
                ? "172.30.0.2\n"
                : "172.30.0.3\n",
              stderr: "",
            };
          }
          if (request.args.includes(definition.browserImage)) {
            return {
              exitCode: 0,
              stdout: JSON.stringify({
                kind: "browser-script-execution-result",
                schemaVersion: 1,
                normalFunction: "preserved",
                attackerSequenceExecuted: true,
                victimContextEstablished: true,
                browserCanaryExecuted: true,
              }),
              stderr: "",
            };
          }
          return { exitCode: 0, stdout: "", stderr: "" };
        },
      };
      const labControl = openGvisorStoredXssLabControl({
        artifactStore,
        processRunner,
        definitionFile: definition.definitionFile,
      });

      const ref = await labControl.execute(browserScriptExecutionRequest(plan));
      await expect(artifactStore.readJson(ref.digest)).resolves.toMatchObject({
        result: {
          kind: "browser-script-execution",
          attackerSequenceExecuted: true,
          victimContextEstablished: true,
          browserCanaryExecuted: true,
        },
      });
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it("passes Docker arguments without shell interpretation", async () => {
    const directory = await mkdtemp(join(tmpdir(), "native-lab-process-"));
    const shellMarker = join(directory, "shell-marker");

    try {
      const runner = openNativeLabProcessRunner({
        dockerExecutablePath: "/bin/echo",
      });
      const literalArgument = `$(touch ${shellMarker})`;

      const result = await runner.run({
        executable: "docker",
        args: ["info", literalArgument],
        timeoutMs: 10_000,
      });

      expect(result.stderr).toBe("");
      expect(result).toMatchObject({
        exitCode: 0,
        stdout: `info ${literalArgument}\n`,
      });
      await expect(access(shellMarker)).rejects.toThrow();
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it("blocks before any Target launch when the runsc runtime is unavailable", async () => {
    let targetLaunchAttempted = false;
    const processRunner: LabProcessRunner = {
      run: async (request) => {
        if (request.args[0] === "info") {
          return {
            exitCode: 0,
            stdout: JSON.stringify({ runc: { path: "runc" } }),
            stderr: "",
          };
        }
        targetLaunchAttempted = true;
        throw new Error("Target execution must not be attempted");
      },
    };
    const artifactStore: JsonArtifactStore = {
      putJson: async () => {
        throw new Error("No evidence artifact may be written");
      },
      readJson: async () => {
        throw new Error("No evidence artifact may be read");
      },
    };
    const labControl = openGvisorStoredXssLabControl({
      artifactStore,
      processRunner,
    });

    await expect(
      labControl.execute(storedXssExecutionRequest(storedXssExperimentPlan())),
    ).rejects.toEqual(new LabControlBlockedError("unsupported-experiment"));
    expect(targetLaunchAttempted).toBe(false);
  });

  it("does not run a fixed Lab procedure for a different source route", async () => {
    const directory = await mkdtemp(join(tmpdir(), "gvisor-protocol-bind-"));
    const artifactStore = openFileJsonArtifactStore(join(directory, "cas"));
    const plan = storedXssExperimentPlan();
    let processCalls = 0;

    try {
      const definition = await writeLabDefinition(directory, plan);
      const sourceRederivation = {
        kind: "source-rederivation" as const,
        schemaVersion: 1 as const,
        verificationId: plan.verificationId,
        targetSnapshotDigest: plan.bindings.targetSnapshotDigest,
        hypothesisDigest: plan.hypothesisDigest,
        status: "supported" as const,
        sourceEvidence: [
          {
            path: "README.md",
            fileDigest: rawDigest(testTargetReadmeContent),
            startLine: 1,
            endLine: 1,
          },
        ],
        experiment: {
          kind: "stored-xss-browser" as const,
          schemaVersion: 1 as const,
          adapterVersion: "stored-xss-browser@v1" as const,
          causalFactor: plan.mechanism.causalFactor,
          successCriterion: "privileged-browser-execution-canary" as const,
        },
      };
      const sourceRederivationDigest =
        await artifactStore.putJson(sourceRederivation);
      const labControl = openGvisorStoredXssLabControl({
        artifactStore,
        processRunner: {
          run: async () => {
            processCalls += 1;
            throw new Error("A mismatched protocol must not start preflight");
          },
        },
        definitionFile: definition.definitionFile,
      });

      await expect(
        labControl.execute({
          kind: "experiment-execution-request",
          schemaVersion: 1,
          plan,
          sourceRederivation,
          sourceRederivationDigest,
        }),
      ).rejects.toEqual(new LabControlBlockedError("unsupported-experiment"));
      expect(processCalls).toBe(0);
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it("records only a sanitized browser observation from a fresh runsc Lab", async () => {
    const directory = await mkdtemp(join(tmpdir(), "gvisor-stored-xss-lab-"));
    const artifactStore = openFileJsonArtifactStore(join(directory, "cas"));
    const plan = storedXssExperimentPlan();
    const wordpressCliRequests: Array<readonly string[]> = [];
    const inspectedContainers: string[] = [];
    const databaseAddress = "172.30.0.2";
    const wordpressAddress = "172.30.0.3";
    let wordpressServerRequest: readonly string[] | undefined;
    let browserRequest: readonly string[] | undefined;

    try {
      const definition = await writeLabDefinition(directory, plan);
      const processRunner: LabProcessRunner = {
        run: async (request) => {
          if (
            request.args[0] === "run" &&
            request.args.includes(testImages.wordpressCli)
          ) {
            wordpressCliRequests.push(request.args);
          }
          if (
            request.args[0] === "run" &&
            request.args.includes(testImages.wordpress)
          ) {
            wordpressServerRequest = request.args;
          }
          if (request.args[0] === "inspect") {
            const container = request.args.at(-1) ?? "";
            inspectedContainers.push(container);
            return {
              exitCode: 0,
              stdout: container.endsWith("-database")
                ? `${databaseAddress}\n`
                : `${wordpressAddress}\n`,
              stderr: "",
            };
          }
          if (request.args[0] === "info") {
            return {
              exitCode: 0,
              stdout: JSON.stringify({ runsc: { path: "runsc" } }),
              stderr: "",
            };
          }
          if (request.args.includes(definition.browserImage)) {
            browserRequest = request.args;
            return {
              exitCode: 0,
              stdout: JSON.stringify({
                kind: "stored-xss-browser-result",
                schemaVersion: 1,
                normalFunction: "preserved",
                attackerRequestAccepted: true,
                persistentStateObserved: true,
                browserCanaryExecuted: true,
              }),
              stderr: "",
            };
          }
          return { exitCode: 0, stdout: "", stderr: "" };
        },
      };
      const labControl = openGvisorStoredXssLabControl({
        artifactStore,
        processRunner,
        definitionFile: definition.definitionFile,
      });

      const ref = await labControl.execute(storedXssExecutionRequest(plan));
      const observation = await artifactStore.readJson(ref.digest);

      expect(observation).toMatchObject({
        kind: "experiment-observation",
        schemaVersion: 1,
        experimentId: plan.experimentId,
        verificationId: plan.verificationId,
        role: "witness",
        hypothesisDigest: plan.hypothesisDigest,
        bindings: plan.bindings,
        isolation: {
          runtime: "gvisor",
          runtimeDigest: plan.bindings.runtimeProfileDigest,
          siblingGroupId: plan.siblingGroupId,
          fresh: true,
          fallbackUsed: false,
        },
        causalFactor: {
          id: plan.mechanism.causalFactor,
          state: "present",
        },
        normalFunction: "preserved",
        result: {
          kind: "stored-xss-browser",
          schemaVersion: 1,
          attackerRequestAccepted: true,
          persistentStateObserved: true,
          browserCanaryExecuted: true,
        },
        artifactRefs: [],
      });
      expect(JSON.stringify(observation)).not.toContain(
        definition.targetDirectory,
      );
      expect(JSON.stringify(observation)).not.toContain(
        definition.fixtureDirectory,
      );
      expect(JSON.stringify(observation)).not.toContain(definition.workerFile);
      expect(JSON.stringify(observation)).not.toContain(definition.inputFile);
      expect(wordpressCliRequests).not.toHaveLength(0);
      expect(inspectedContainers).toHaveLength(2);
      expect(wordpressServerRequest).toEqual(
        expect.arrayContaining([`WORDPRESS_DB_HOST=${databaseAddress}`]),
      );
      expect(browserRequest).toEqual(
        expect.arrayContaining(["--add-host", `wordpress:${wordpressAddress}`]),
      );
      const databasePasswords = new Set<string>();
      for (const args of wordpressCliRequests) {
        const imageIndex = args.indexOf(testImages.wordpressCli);
        expect(args[imageIndex + 1]).toBe("wp");
        expect(args).toEqual(
          expect.arrayContaining([
            `WORDPRESS_DB_HOST=${databaseAddress}`,
            "WORDPRESS_DB_NAME=wordpress",
            "WORDPRESS_DB_USER=root",
          ]),
        );
        const password = args.find((argument) =>
          argument.startsWith("WORDPRESS_DB_PASSWORD="),
        );
        expect(password).toBeDefined();
        if (password !== undefined) databasePasswords.add(password);
      }
      expect(databasePasswords).toHaveProperty("size", 1);
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it("blocks before Lab creation when a pinned image is not local", async () => {
    const directory = await mkdtemp(join(tmpdir(), "gvisor-missing-image-"));
    const artifactStore = openFileJsonArtifactStore(join(directory, "cas"));
    const plan = storedXssExperimentPlan();
    let labCreationAttempted = false;

    try {
      const definition = await writeLabDefinition(directory, plan);
      const processRunner: LabProcessRunner = {
        run: async (request) => {
          if (request.args[0] === "info") {
            return {
              exitCode: 0,
              stdout: JSON.stringify({ runsc: { path: "runsc" } }),
              stderr: "",
            };
          }
          if (request.args[0] === "image") {
            return { exitCode: 1, stdout: "", stderr: "image not found" };
          }
          labCreationAttempted = true;
          throw new Error("Lab resources must not be created");
        },
      };
      const labControl = openGvisorStoredXssLabControl({
        artifactStore,
        processRunner,
        definitionFile: definition.definitionFile,
      });

      await expect(
        labControl.execute(storedXssExecutionRequest(plan)),
      ).rejects.toEqual(new LabControlBlockedError("baseline-unavailable"));
      expect(labCreationAttempted).toBe(false);
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it("rejects a runtime image that differs from the bound Runtime Profile", async () => {
    const directory = await mkdtemp(join(tmpdir(), "gvisor-runtime-binding-"));
    const artifactStore = openFileJsonArtifactStore(join(directory, "cas"));
    const plan = storedXssExperimentPlan();
    let labCreationAttempted = false;

    try {
      const definition = await writeLabDefinition(directory, plan);
      const value = JSON.parse(
        await readFile(definition.definitionFile, "utf8"),
      );
      value.images.browser = `docker.io/microsoft/playwright@${digest("d")}`;
      await writeFile(definition.definitionFile, JSON.stringify(value));
      const processRunner: LabProcessRunner = {
        run: async (request) => {
          if (request.args[0] === "info") {
            return {
              exitCode: 0,
              stdout: JSON.stringify({ runsc: { path: "runsc" } }),
              stderr: "",
            };
          }
          if (request.args[0] === "image") {
            return { exitCode: 0, stdout: "", stderr: "" };
          }
          labCreationAttempted = true;
          throw new Error("Lab resources must not be created");
        },
      };
      const labControl = openGvisorStoredXssLabControl({
        artifactStore,
        processRunner,
        definitionFile: definition.definitionFile,
      });

      await expect(
        labControl.execute(storedXssExecutionRequest(plan)),
      ).rejects.toThrow("Stored XSS Lab runtime profile binding mismatch");
      expect(labCreationAttempted).toBe(false);
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it("rejects a private worker that differs from the bound Lab Configuration", async () => {
    const directory = await mkdtemp(join(tmpdir(), "gvisor-config-binding-"));
    const artifactStore = openFileJsonArtifactStore(join(directory, "cas"));
    const plan = storedXssExperimentPlan();
    let labCreationAttempted = false;

    try {
      const definition = await writeLabDefinition(directory, plan);
      await writeFile(definition.workerFile, "// changed worker\n");
      const processRunner: LabProcessRunner = {
        run: async (request) => {
          if (request.args[0] === "info") {
            return {
              exitCode: 0,
              stdout: JSON.stringify({ runsc: { path: "runsc" } }),
              stderr: "",
            };
          }
          if (request.args[0] === "image") {
            return { exitCode: 0, stdout: "", stderr: "" };
          }
          labCreationAttempted = true;
          throw new Error("Lab resources must not be created");
        },
      };
      const labControl = openGvisorStoredXssLabControl({
        artifactStore,
        processRunner,
        definitionFile: definition.definitionFile,
      });

      await expect(
        labControl.execute(storedXssExecutionRequest(plan)),
      ).rejects.toThrow("Stored XSS Lab configuration binding mismatch");
      expect(labCreationAttempted).toBe(false);
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it("rejects Target source that differs from its admitted file manifest", async () => {
    const directory = await mkdtemp(join(tmpdir(), "gvisor-target-binding-"));
    const artifactStore = openFileJsonArtifactStore(join(directory, "cas"));
    const plan = storedXssExperimentPlan();
    let labCreationAttempted = false;

    try {
      const definition = await writeLabDefinition(directory, plan);
      await writeFile(
        join(definition.targetDirectory, "admin", "plugin.php"),
        "<?php // changed target fixture\n",
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
          if (request.args[0] === "image") {
            return { exitCode: 0, stdout: "", stderr: "" };
          }
          labCreationAttempted = true;
          throw new Error("Lab resources must not be created");
        },
      };
      const labControl = openGvisorStoredXssLabControl({
        artifactStore,
        processRunner,
        definitionFile: definition.definitionFile,
      });

      await expect(
        labControl.execute(storedXssExecutionRequest(plan)),
      ).rejects.toThrow("Stored XSS Lab Target source binding mismatch");
      expect(labCreationAttempted).toBe(false);
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });
});
