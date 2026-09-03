import { describe, expect, it } from "vitest";

import {
  openModelExecution,
  type AttemptPlan,
  type ModelProcess,
} from "../../src/research/model-execution/index.js";
import type { SourceEvidenceReceipt } from "../../src/research/source-mapping/index.js";
import {
  openSourceEvidenceFixture,
  type SourceEvidenceFixture,
} from "../fixtures/source-evidence.js";

const leaseId = `sha256:${"b".repeat(64)}`;
const anchorFileDigest = `sha256:${"c".repeat(64)}`;

function providerEnvelope(output: unknown): string {
  return JSON.stringify({
    type: "result",
    subtype: "success",
    is_error: false,
    terminal_reason: "completed",
    structured_output: output,
    permission_denials: [],
    usage: {
      server_tool_use: { web_search_requests: 0, web_fetch_requests: 0 },
    },
    subagent_stats: { spawned: 0 },
    modelUsage: {
      "claude-opus-5": { canonicalModel: "claude-opus-5" },
    },
  });
}

function attemptPlan(
  fixture: SourceEvidenceFixture,
  attemptId: string,
  maxSourceQueries: number,
): AttemptPlan {
  return {
    kind: "attempt-plan",
    schemaVersion: 1,
    attemptId,
    leaseId,
    role: "finder",
    target: fixture.manifest.targetSnapshot,
    modelProfile: {
      provider: "anthropic",
      model: "claude-opus-5",
      transport: "claude-code-process",
      executableVersion: "2.1.258",
      effort: "high",
      eligibilityReceiptDigest: `sha256:${"d".repeat(64)}`,
    },
    prompt: "The initial context contains the dispatcher but not its wrapper.",
    sourceToolPolicy: fixture.gateway.policy,
    budget: {
      maxWallTimeMs: 60_000,
      maxOutputBytes: 1_000_000,
      maxHypotheses: 1,
      maxSourceQueries,
    },
  };
}

function emptyFinderOutput(): object {
  return {
    kind: "finder-output",
    schemaVersion: 1,
    leaseId,
    hypotheses: [],
  };
}

describe("ModelExecution.run source evidence loop", () => {
  it("binds search and read requests to one Attempt and returns Finder output", async () => {
    const dispatcher = [
      "<?php",
      "function dispatch_request() {",
      "  return custom_db_query($_POST['id']);",
      "}",
      "",
    ].join("\n");
    const wrapper = [
      "<?php",
      "function custom_db_query($id) {",
      "  return $GLOBALS['wpdb']->get_results('SELECT ' . $id);",
      "}",
      "",
    ].join("\n");
    const fixture = await openSourceEvidenceFixture({
      files: {
        "includes/dispatcher.php": dispatcher,
        "includes/wrapper.php": wrapper,
      },
      search: { maxScanBytes: 4096, maxResults: 8 },
    });
    const observedReceipts: SourceEvidenceReceipt[] = [];
    const process: ModelProcess = {
      execute: async (request) => {
        if (request.sourceEvidence === undefined) {
          throw new Error("Source Evidence tool was not exposed");
        }
        const search = await request.sourceEvidence.query({
          kind: "search-snapshot",
          schemaVersion: 1,
          subject: {
            literal: "custom_db_query",
            scope: { kind: "snapshot" },
          },
          desiredRelation: "definition",
          reason: "Find the wrapper definition referenced by the dispatcher.",
        });
        observedReceipts.push(search);
        const wrapperMatch =
          search.response?.kind === "source-search-response"
            ? search.response.matches.find(
                (match) => match.anchor.path === "includes/wrapper.php",
              )
            : undefined;
        if (wrapperMatch === undefined) {
          throw new Error("Wrapper definition was not found");
        }
        const read = await request.sourceEvidence.query({
          kind: "read-source-range",
          schemaVersion: 1,
          subject: {
            path: wrapperMatch.anchor.path,
            fileDigest: wrapperMatch.anchor.fileDigest,
            startLine: 1,
            endLine: 4,
          },
          desiredRelation: "callee",
          reason: "Read the wrapper body and identify its database terminal.",
        });
        observedReceipts.push(read);
        if (
          read.response?.kind !== "source-range-response" ||
          !read.response.content.includes("get_results")
        ) {
          throw new Error("Wrapper terminal was not returned");
        }
        return {
          kind: "exited",
          exitCode: 0,
          stderr: "",
          stdout: providerEnvelope({
            kind: "finder-output",
            schemaVersion: 1,
            leaseId,
            hypotheses: [
              {
                kind: "source-bound-hypothesis",
                schemaVersion: 1,
                causalIdentity: {
                  rootCause: "unprepared-database-query",
                  attackerControlledPrimitive: "request-parameter",
                  brokenSecurityProperty: "query-structure-integrity",
                },
                attackerPremise: "unauthenticated",
                impact: "sql-injection",
                route: {
                  anchors: [
                    {
                      path: "entry.php",
                      fileDigest: anchorFileDigest,
                      startLine: 4,
                      endLine: 12,
                    },
                  ],
                },
                unknowns: [
                  {
                    claim: "the dispatcher is reachable without authentication",
                    requiredEvidence:
                      "verify the registered entry and nonce flow",
                  },
                ],
                falsifier: "the value is bound as data before query execution",
                nextExperiment: "run a database Witness and Causal Control",
              },
            ],
          }),
        };
      },
    };
    const execution = openModelExecution({
      artifactDirectory: fixture.attemptArtifactDirectory,
      process,
      sourceEvidenceGateway: fixture.gateway,
    });
    const plan = attemptPlan(fixture, "attempt-source-loop", 8);

    try {
      await expect(execution.run(plan)).resolves.toMatchObject({
        status: "completed",
        value: {
          status: "completed",
          output: { hypotheses: [{ impact: "sql-injection" }] },
        },
      });
      expect(observedReceipts).toHaveLength(2);
      for (const receipt of observedReceipts) {
        expect(receipt.value).toMatchObject({
          attemptId: plan.attemptId,
          leaseId: plan.leaseId,
          targetSnapshot: plan.target,
          request: {
            attemptId: plan.attemptId,
            leaseId: plan.leaseId,
            targetSnapshot: plan.target,
            policy: plan.sourceToolPolicy,
          },
        });
      }
    } finally {
      await fixture.close();
    }
  });

  it("returns a durable budget-exhausted receipt after the Attempt query ceiling", async () => {
    const fixture = await openSourceEvidenceFixture({
      files: { "entry.php": "<?php\nreturn custom_db_query();\n" },
    });
    let secondReceipt: SourceEvidenceReceipt | undefined;
    const process: ModelProcess = {
      execute: async (request) => {
        if (request.sourceEvidence === undefined) {
          throw new Error("Source Evidence tool was not exposed");
        }
        const sourceRequest = {
          kind: "read-source-range" as const,
          schemaVersion: 1 as const,
          subject: {
            path: "entry.php",
            fileDigest: fixture.fileDigest("entry.php"),
            startLine: 1,
            endLine: 2,
          },
          desiredRelation: "source-range" as const,
          reason: "Read the only admitted source range.",
        };
        const first = await request.sourceEvidence.query(sourceRequest);
        if (first.value.result.status !== "completed") {
          throw new Error("The first source query must be allowed");
        }
        secondReceipt = await request.sourceEvidence.query(sourceRequest);
        return {
          kind: "exited",
          exitCode: 0,
          stderr: "",
          stdout: providerEnvelope(emptyFinderOutput()),
        };
      },
    };
    const execution = openModelExecution({
      artifactDirectory: fixture.attemptArtifactDirectory,
      process,
      sourceEvidenceGateway: fixture.gateway,
    });
    const plan = attemptPlan(fixture, "attempt-source-budget", 1);

    try {
      await expect(execution.run(plan)).resolves.toMatchObject({
        status: "completed",
      });
      expect(secondReceipt?.response).toBeNull();
      expect(secondReceipt?.value).toMatchObject({
        attemptId: plan.attemptId,
        policyDecision: {
          outcome: "denied",
          reason: "query-budget-exhausted",
        },
        result: {
          status: "budget-exhausted",
          reason: "source-query-limit-exceeded",
        },
      });
      if (secondReceipt === undefined) {
        throw new Error("Expected the second Source Evidence Receipt");
      }
      await expect(
        fixture.artifacts.readJson(secondReceipt.ref.digest),
      ).resolves.toEqual(secondReceipt.value);
    } finally {
      await fixture.close();
    }
  });
});
