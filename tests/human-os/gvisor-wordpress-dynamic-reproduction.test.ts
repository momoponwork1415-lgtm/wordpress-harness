import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  openGvisorWordPressDynamicReproductionRuntime,
  type ContainerProcessRequest,
  type ContainerProcessResult,
  type DynamicReproductionAgent,
} from "../../src/human-os/index.js";
import { measureCanonicalSourceTree } from "../../src/infrastructure/canonical-source-tree.js";
import { canonicalDigest } from "../../src/infrastructure/canonical-json.js";
import type { SourceValidatedFinding } from "../../src/research/index.js";

const digest = (character: string): string => `sha256:${character.repeat(64)}`;

describe("gVisor WordPress Dynamic Reproduction", () => {
  it("runs an AI-directed experiment in a fresh lab and stores only private evidence refs", async () => {
    const directory = await mkdtemp(join(tmpdir(), "gvisor-reproduction-"));
    const sourceDirectory = join(directory, "source");
    const scratchRootDirectory = join(directory, "scratch");
    const privateEvidenceDirectory = join(directory, "private-evidence");
    await Promise.all([
      mkdir(sourceDirectory),
      mkdir(scratchRootDirectory),
      mkdir(privateEvidenceDirectory),
    ]);
    await writeFile(join(sourceDirectory, "example.php"), "<?php\n", "utf8");
    const sourceTree = await measureCanonicalSourceTree(sourceDirectory, {
      maxEntries: 10,
      maxBytes: 1_000,
    });
    const finding: SourceValidatedFinding = {
      kind: "source-validated-finding",
      schemaVersion: 1,
      findingId: "campaign-runtime:finding:candidate-1",
      candidateId: "candidate-1",
      targetSnapshot: {
        id: "example-1.0.0",
        pluginSlug: "example",
        version: "1.0.0",
        digest: digest("a"),
        sourceTree,
      },
      attackerPremise: "An unauthenticated visitor controls a public value.",
      brokenSecurityProperty: "The public value must remain inert.",
      claim: "The public value reaches an executable browser context.",
      assurance: "source-validated",
      validation: {
        runId: "campaign-runtime:validation:1",
        promptSet: { id: "validation-v1", digest: digest("b") },
        runtimeProfileDigest: digest("c"),
        permissionProfileDigest: digest("d"),
      },
      evidence: [
        {
          path: "example.php",
          location: "save:44",
          observation: "Stores the visitor-controlled value.",
        },
      ],
    };
    const requests: ContainerProcessRequest[] = [];
    const processRunner = {
      run: async (
        request: ContainerProcessRequest,
      ): Promise<ContainerProcessResult> => {
        requests.push(request);
        if (request.args[0] === "info") {
          return {
            exitCode: 0,
            stdout: '{"runc":{},"runsc":{}}',
            stderr: "",
          };
        }
        if (request.args[0] === "inspect") {
          return {
            exitCode: 0,
            stdout: request.args.at(-1)?.endsWith("-database")
              ? "172.18.0.2"
              : "172.18.0.3",
            stderr: "",
          };
        }
        if (
          request.args[0] === "run" &&
          request.args.includes("worker.invalid/reproduction@" + digest("4"))
        ) {
          const evidenceMount = request.args.find((argument) =>
            argument.endsWith(":/evidence:rw"),
          );
          if (evidenceMount === undefined)
            throw new Error("missing evidence mount");
          await writeFile(
            join(
              evidenceMount.slice(0, -":/evidence:rw".length),
              "browser-canary.txt",
            ),
            "canary-executed",
            "utf8",
          );
          return { exitCode: 0, stdout: "effect-observed", stderr: "" };
        }
        return { exitCode: 0, stdout: "ok", stderr: "" };
      },
    };
    const agent: DynamicReproductionAgent = {
      execute: async ({ experiment }) => {
        const observation = await experiment.run({
          script:
            'const response = await fetch("http://wordpress/"); console.log(await response.text());',
          timeoutMs: 30_000,
        });
        expect(observation).toMatchObject({
          exitCode: 0,
          stdout: "effect-observed",
        });
        return {
          status: "runtime-confirmed",
          summary: "The isolated browser canary executed.",
          preconditionsMatched: true,
          recipeCompleted: true,
          effectObserved: true,
        };
      },
    };
    const runtime = openGvisorWordPressDynamicReproductionRuntime({
      dockerExecutablePath: "/usr/bin/docker",
      images: {
        database: "database.invalid/mariadb@" + digest("1"),
        wordpress: "wordpress.invalid/core@" + digest("2"),
        wordpressCli: "wordpress.invalid/cli@" + digest("3"),
        worker: "worker.invalid/reproduction@" + digest("4"),
      },
      sourceResolver: {
        resolve: async () => ({ sourceDirectory }),
      },
      processRunner,
      agent,
      scratchRootDirectory,
      privateEvidenceDirectory,
      clock: () => new Date("2026-09-08T10:00:00.000Z"),
    });

    try {
      const record = await runtime.execute({ finding });

      expect(record).toMatchObject({
        findingId: finding.findingId,
        status: "runtime-confirmed",
        summary: "The isolated browser canary executed.",
        environment: {
          targetSnapshotDigest: finding.targetSnapshot.digest,
          runtimeProfileDigest: canonicalDigest({
            kind: "dynamic-reproduction-runtime-profile",
            schemaVersion: 1,
            images: {
              database: "database.invalid/mariadb@" + digest("1"),
              wordpress: "wordpress.invalid/core@" + digest("2"),
              wordpressCli: "wordpress.invalid/cli@" + digest("3"),
              worker: "worker.invalid/reproduction@" + digest("4"),
            },
          }),
          backend: "gvisor",
          runtime: "runsc",
          fallbackUsed: false,
          fresh: true,
          disposable: true,
          hostTargetExecution: false,
          ambientCredentials: false,
          arbitraryNetwork: false,
        },
        recordedAt: "2026-09-08T10:00:00.000Z",
      });
      expect(record.privateEvidence.length).toBeGreaterThanOrEqual(2);
      expect(JSON.stringify(record)).not.toContain("effect-observed");
      expect(JSON.stringify(record)).not.toContain("canary-executed");

      const stored = await readdir(privateEvidenceDirectory);
      expect(stored).toHaveLength(record.privateEvidence.length);
      const privateBodies = await Promise.all(
        stored.map((name) =>
          readFile(join(privateEvidenceDirectory, name), "utf8"),
        ),
      );
      expect(privateBodies.join("\n")).toContain("effect-observed");
      expect(privateBodies.join("\n")).toContain("canary-executed");

      expect(
        requests.some(
          (request) =>
            request.args[0] === "network" &&
            request.args[1] === "create" &&
            request.args.includes("--internal"),
        ),
      ).toBe(true);
      const containerRuns = requests.filter(
        (request) => request.args[0] === "run",
      );
      expect(containerRuns.length).toBeGreaterThan(0);
      expect(
        containerRuns.every((request) =>
          request.args.includes("--runtime=runsc"),
        ),
      ).toBe(true);
      expect(
        requests.some(
          (request) =>
            request.args[0] === "rm" && request.args.includes("--force"),
        ),
      ).toBe(true);
      expect(
        requests.some(
          (request) =>
            request.args[0] === "exec" &&
            request.args.includes("mariadb-admin") &&
            request.args.includes("ping"),
        ),
      ).toBe(true);
      expect(
        requests.some(
          (request) =>
            request.args[0] === "run" &&
            request.args.includes("db") &&
            request.args.includes("check"),
        ),
      ).toBe(false);
      expect(
        requests.some(
          (request) =>
            request.args[0] === "run" &&
            request.args.includes("WORDPRESS_DB_HOST=172.18.0.2"),
        ),
      ).toBe(true);
      expect(
        requests.some(
          (request) =>
            request.args.includes("--add-host") &&
            request.args.includes("wordpress:172.18.0.3"),
        ),
      ).toBe(true);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("keeps the cleaned lab evidence and returns incomplete when the agent fails", async () => {
    const directory = await mkdtemp(join(tmpdir(), "gvisor-agent-failure-"));
    const sourceDirectory = join(directory, "source");
    const scratchRootDirectory = join(directory, "scratch");
    const privateEvidenceDirectory = join(directory, "private-evidence");
    await Promise.all([
      mkdir(sourceDirectory),
      mkdir(scratchRootDirectory),
      mkdir(privateEvidenceDirectory),
    ]);
    await writeFile(join(sourceDirectory, "example.php"), "<?php\n", "utf8");
    const sourceTree = await measureCanonicalSourceTree(sourceDirectory, {
      maxEntries: 10,
      maxBytes: 1_000,
    });
    const failureFinding: SourceValidatedFinding = {
      kind: "source-validated-finding",
      schemaVersion: 1,
      findingId: "campaign-runtime:finding:agent-failure",
      candidateId: "agent-failure",
      targetSnapshot: {
        id: "example-1.0.0",
        pluginSlug: "example",
        version: "1.0.0",
        digest: digest("a"),
        sourceTree,
      },
      attackerPremise: "An unauthenticated visitor controls a public value.",
      brokenSecurityProperty: "The public value must remain inert.",
      claim: "The public value reaches an executable browser context.",
      assurance: "source-validated",
      validation: {
        runId: "campaign-runtime:validation:failure",
        promptSet: { id: "validation-v1", digest: digest("b") },
        runtimeProfileDigest: digest("c"),
        permissionProfileDigest: digest("d"),
      },
      evidence: [
        {
          path: "example.php",
          location: "save:44",
          observation: "Stores the visitor-controlled value.",
        },
      ],
    };
    const processRunner = {
      run: async (
        request: ContainerProcessRequest,
      ): Promise<ContainerProcessResult> => {
        if (request.args[0] === "info") {
          return { exitCode: 0, stdout: '{"runsc":{}}', stderr: "" };
        }
        if (request.args[0] === "inspect") {
          return {
            exitCode: 0,
            stdout: request.args.at(-1)?.endsWith("-database")
              ? "172.18.0.2"
              : "172.18.0.3",
            stderr: "",
          };
        }
        if (
          request.args[0] === "run" &&
          request.args.includes("worker.invalid/reproduction@" + digest("4"))
        ) {
          return { exitCode: 0, stdout: "partial-observation", stderr: "" };
        }
        return { exitCode: 0, stdout: "ok", stderr: "" };
      },
    };
    const runtime = openGvisorWordPressDynamicReproductionRuntime({
      dockerExecutablePath: "/usr/bin/docker",
      images: {
        database: "database.invalid/mariadb@" + digest("1"),
        wordpress: "wordpress.invalid/core@" + digest("2"),
        wordpressCli: "wordpress.invalid/cli@" + digest("3"),
        worker: "worker.invalid/reproduction@" + digest("4"),
      },
      sourceResolver: { resolve: async () => ({ sourceDirectory }) },
      processRunner,
      agent: {
        execute: async ({ experiment }) => {
          await experiment.run({
            script: "console.log('partial')",
            timeoutMs: 1_000,
          });
          throw new Error("provider connection lost");
        },
      },
      scratchRootDirectory,
      privateEvidenceDirectory,
      clock: () => new Date("2026-09-08T10:30:00.000Z"),
    });

    try {
      await expect(
        runtime.execute({ finding: failureFinding }),
      ).resolves.toMatchObject({
        findingId: failureFinding.findingId,
        status: "incomplete",
        environment: {
          backend: "gvisor",
          runtime: "runsc",
          disposable: true,
        },
      });
      expect(await readdir(scratchRootDirectory)).toEqual([]);
      const stored = await readdir(privateEvidenceDirectory);
      expect(stored).toHaveLength(1);
      await expect(
        readFile(join(privateEvidenceDirectory, stored[0]!), "utf8"),
      ).resolves.toContain("partial-observation");

      const contradictoryRuntime =
        openGvisorWordPressDynamicReproductionRuntime({
          dockerExecutablePath: "/usr/bin/docker",
          images: {
            database: "database.invalid/mariadb@" + digest("1"),
            wordpress: "wordpress.invalid/core@" + digest("2"),
            wordpressCli: "wordpress.invalid/cli@" + digest("3"),
            worker: "worker.invalid/reproduction@" + digest("4"),
          },
          sourceResolver: { resolve: async () => ({ sourceDirectory }) },
          processRunner,
          agent: {
            execute: async ({ experiment }) => {
              await experiment.run({
                script: "console.log('contradiction')",
                timeoutMs: 1_000,
              });
              return {
                status: "runtime-confirmed",
                summary: "Contradictory adapter output.",
                preconditionsMatched: false,
                recipeCompleted: false,
                effectObserved: false,
              } as unknown as Awaited<
                ReturnType<DynamicReproductionAgent["execute"]>
              >;
            },
          },
          scratchRootDirectory,
          privateEvidenceDirectory,
          clock: () => new Date("2026-09-08T10:45:00.000Z"),
        });
      await expect(
        contradictoryRuntime.execute({ finding: failureFinding }),
      ).resolves.toMatchObject({ status: "incomplete" });

      const cleanupRequests: ContainerProcessRequest[] = [];
      const cleanupRuntime = openGvisorWordPressDynamicReproductionRuntime({
        dockerExecutablePath: "/usr/bin/docker",
        images: {
          database: "database.invalid/mariadb@" + digest("1"),
          wordpress: "wordpress.invalid/core@" + digest("2"),
          wordpressCli: "wordpress.invalid/cli@" + digest("3"),
          worker: "worker.invalid/reproduction@" + digest("4"),
        },
        sourceResolver: { resolve: async () => ({ sourceDirectory }) },
        processRunner: {
          run: async (request) => {
            cleanupRequests.push(request);
            if (request.args[0] === "info") {
              return { exitCode: 0, stdout: '{"runsc":{}}', stderr: "" };
            }
            if (request.args[0] === "inspect") {
              return {
                exitCode: 0,
                stdout: request.args.at(-1)?.endsWith("-database")
                  ? "172.18.0.2"
                  : "172.18.0.3",
                stderr: "",
              };
            }
            if (request.args[0] === "rm") {
              throw new Error("daemon interruption");
            }
            return { exitCode: 0, stdout: "ok", stderr: "" };
          },
        },
        agent: {
          execute: async () => ({
            status: "incomplete",
            summary: "No conclusive observation.",
            preconditionsMatched: false,
            recipeCompleted: false,
            effectObserved: null,
          }),
        },
        scratchRootDirectory,
        privateEvidenceDirectory,
      });
      await expect(
        cleanupRuntime.execute({ finding: failureFinding }),
      ).resolves.toMatchObject({ status: "incomplete", environment: null });
      expect(
        cleanupRequests.some(
          (request) => request.args[0] === "volume" && request.args[1] === "rm",
        ),
      ).toBe(true);
      expect(
        cleanupRequests.some(
          (request) =>
            request.args[0] === "network" && request.args[1] === "rm",
        ),
      ).toBe(true);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
