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

import { afterEach, describe, expect, it } from "vitest";

import {
  openGvisorWordPressCandidateVerificationRuntime,
  type ContainerProcessRequest,
  type ContainerProcessResult,
  type DynamicReproductionAgent,
} from "../../src/human-os/index.js";
import { measureCanonicalSourceTree } from "../../src/infrastructure/canonical-source-tree.js";
import { canonicalDigest } from "../../src/infrastructure/canonical-json.js";
import { candidateVerificationRequestSchema } from "../../src/research/index.js";

const directories: string[] = [];
const digest = (character: string): string => `sha256:${character.repeat(64)}`;

afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("gVisor WordPress Candidate Verification", () => {
  it("runs one Candidate-bound experiment in a fresh lab and exposes only evidence refs", async () => {
    const directory = await mkdtemp(join(tmpdir(), "gvisor-verification-"));
    directories.push(directory);
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
    const requestBody = {
      kind: "candidate-verification-request" as const,
      schemaVersion: 1 as const,
      requestId: "campaign-runtime:verification:candidate-1",
      campaignId: "campaign-runtime",
      campaignInputDigest: digest("8"),
      candidateReviewDigest: digest("9"),
      targetSnapshot: {
        id: "example-1.0.0",
        pluginSlug: "example",
        version: "1.0.0",
        digest: digest("a"),
        sourceTree,
      },
      candidate: {
        candidateId: "candidate-1",
        attackerPremise: "An unauthenticated visitor controls a public value.",
        brokenSecurityProperty: "The public value must remain inert.",
        claim: "The public value reaches an executable browser context.",
        evidence: [
          {
            path: "example.php",
            location: "save:44",
            observation: "Stores the visitor-controlled value.",
          },
        ],
        reproductionRecipe: {
          kind: "candidate-verification-recipe-ref" as const,
          schemaVersion: 1 as const,
          recipeId: "candidate-1-recipe",
          digest: digest("b"),
          bytes: 512,
        },
      },
    };
    const candidateRequest = candidateVerificationRequestSchema.parse({
      ...requestBody,
      digest: canonicalDigest(requestBody),
    });
    const processRequests: ContainerProcessRequest[] = [];
    const processRunner = {
      run: async (
        processRequest: ContainerProcessRequest,
      ): Promise<ContainerProcessResult> => {
        processRequests.push(processRequest);
        if (processRequest.args[0] === "info") {
          return { exitCode: 0, stdout: '{"runsc":{}}', stderr: "" };
        }
        if (processRequest.args[0] === "inspect") {
          return {
            exitCode: 0,
            stdout: processRequest.args.at(-1)?.endsWith("-database")
              ? "172.18.0.2"
              : "172.18.0.3",
            stderr: "",
          };
        }
        if (
          processRequest.args[0] === "run" &&
          processRequest.args.includes(
            "worker.invalid/reproduction@" + digest("4"),
          )
        ) {
          const evidenceMount = processRequest.args.find((argument) =>
            argument.endsWith(":/evidence:rw"),
          );
          if (evidenceMount === undefined)
            throw new Error("missing evidence mount");
          await writeFile(
            join(evidenceMount.slice(0, -":/evidence:rw".length), "canary.txt"),
            "nonce-canary-observed",
            "utf8",
          );
          return { exitCode: 0, stdout: "effect-observed", stderr: "" };
        }
        return { exitCode: 0, stdout: "ok", stderr: "" };
      },
    };
    const agent: DynamicReproductionAgent = {
      execute: async ({ request, experiment }) => {
        expect(request.requestId).toBe(candidateRequest.requestId);
        const observation = await experiment.run({
          script: "exercise candidate",
          timeoutMs: 30_000,
        });
        expect(observation.stdout).toBe("effect-observed");
        return {
          status: "runtime-confirmed",
          summary: "The isolated nonce canary was observed.",
          preconditionsMatched: true,
          recipeCompleted: true,
          effectObserved: true,
        };
      },
    };
    const images = {
      database: "database.invalid/mariadb@" + digest("1"),
      wordpress: "wordpress.invalid/core@" + digest("2"),
      wordpressCli: "wordpress.invalid/cli@" + digest("3"),
      worker: "worker.invalid/reproduction@" + digest("4"),
    };
    const runtime = openGvisorWordPressCandidateVerificationRuntime({
      dockerExecutablePath: "/usr/bin/docker",
      images,
      sourceResolver: { resolve: async () => ({ sourceDirectory }) },
      processRunner,
      agent,
      scratchRootDirectory,
      privateEvidenceDirectory,
      clock: () => new Date("2026-09-16T00:00:00.000Z"),
    });

    const record = await runtime.execute({ request: candidateRequest });

    expect(record).toMatchObject({
      requestId: candidateRequest.requestId,
      candidateId: candidateRequest.candidate.candidateId,
      status: "runtime-confirmed",
      environment: {
        targetSnapshotDigest: candidateRequest.targetSnapshot.digest,
        runtimeProfileDigest: canonicalDigest({
          kind: "dynamic-reproduction-runtime-profile",
          schemaVersion: 1,
          images,
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
      recordedAt: "2026-09-16T00:00:00.000Z",
    });
    expect(record.privateEvidence.length).toBeGreaterThanOrEqual(2);
    expect(JSON.stringify(record)).not.toContain("effect-observed");
    expect(JSON.stringify(record)).not.toContain("nonce-canary-observed");
    const storedEvidence = await Promise.all(
      (await readdir(privateEvidenceDirectory)).map((name) =>
        readFile(join(privateEvidenceDirectory, name), "utf8"),
      ),
    );
    expect(storedEvidence.join("\n")).toContain("effect-observed");
    expect(storedEvidence.join("\n")).toContain("nonce-canary-observed");
    expect(
      processRequests.some(
        (item) =>
          item.args[0] === "network" &&
          item.args[1] === "create" &&
          item.args.includes("--internal"),
      ),
    ).toBe(true);
    expect(
      processRequests
        .filter((item) => item.args[0] === "run")
        .every((item) => item.args.includes("--runtime=runsc")),
    ).toBe(true);
    expect(
      processRequests.some(
        (item) => item.args[0] === "rm" && item.args.includes("--force"),
      ),
    ).toBe(true);
  });
});
