import { access, mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  LabControlBlockedError,
  openNativeLabProcessRunner,
  openGvisorStoredXssLabControl,
  type ExperimentPlan,
  type LabProcessRunner,
} from "../../src/research/verification/index.js";
import {
  openFileJsonArtifactStore,
  type JsonArtifactStore,
} from "../../src/research/research-record/index.js";

const digest = (character: string): string => `sha256:${character.repeat(64)}`;

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
      labBaselineDigest: digest("5"),
      runtimeProfileDigest: digest("6"),
      setupPlanDigest: digest("7"),
      configurationDigest: digest("8"),
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

async function writeLabDefinition(
  directory: string,
  plan: ExperimentPlan,
): Promise<{
  readonly browserImage: string;
  readonly definitionFile: string;
  readonly fixtureDirectory: string;
  readonly targetDirectory: string;
  readonly workerFile: string;
}> {
  const targetDirectory = join(directory, "target-plugin");
  const fixtureDirectory = join(directory, "fixture-plugin");
  const workerFile = join(directory, "browser-worker.mjs");
  const definitionFile = join(directory, "experiment.private.json");
  const browserImage = `docker.io/microsoft/playwright@${digest("c")}`;
  await mkdir(targetDirectory);
  await mkdir(fixtureDirectory);
  await writeFile(workerFile, "// private browser worker fixture\n");
  await writeFile(
    definitionFile,
    JSON.stringify({
      kind: "stored-xss-lab-definition",
      schemaVersion: 1,
      bindings: plan.bindings,
      images: {
        database: `docker.io/library/mariadb@${digest("9")}`,
        wordpress: `docker.io/library/wordpress@${digest("a")}`,
        wordpressCli: `docker.io/library/wordpress-cli@${digest("b")}`,
        browser: browserImage,
      },
      target: {
        sourceDirectory: targetDirectory,
        pluginSlug: "fixture-plugin",
      },
      fixture: {
        sourceDirectory: fixtureDirectory,
        pluginSlug: "harness-fixture",
      },
      browser: { workerFile },
    }),
  );
  return {
    browserImage,
    definitionFile,
    fixtureDirectory,
    targetDirectory,
    workerFile,
  };
}

describe("gVisor Stored XSS Lab Control", () => {
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

    await expect(labControl.execute(storedXssExperimentPlan())).rejects.toEqual(
      new LabControlBlockedError("gvisor-unavailable"),
    );
    expect(targetLaunchAttempted).toBe(false);
  });

  it("records only a sanitized browser observation from a fresh runsc Lab", async () => {
    const directory = await mkdtemp(join(tmpdir(), "gvisor-stored-xss-lab-"));
    const artifactStore = openFileJsonArtifactStore(join(directory, "cas"));
    const plan = storedXssExperimentPlan();

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
          if (request.args.includes(definition.browserImage)) {
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

      const ref = await labControl.execute(plan);
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

      await expect(labControl.execute(plan)).rejects.toEqual(
        new LabControlBlockedError("baseline-unavailable"),
      );
      expect(labCreationAttempted).toBe(false);
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });
});
