import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import type {
  ClaudeStructuredProcess,
  ClaudeStructuredProcessRequest,
} from "../../src/research/model-execution/index.js";
import { sha256Digest } from "../../src/research/research-record/canonical-json.js";
import type {
  SurfaceMap,
  SurfaceMapRef,
} from "../../src/research/source-mapping/index.js";
import {
  openClaudeIndependentVerifier,
  type VerificationPlan,
} from "../../src/research/verification/index.js";

const digest = (character: string): string => `sha256:${character.repeat(64)}`;

function fileDigest(content: string): string {
  return `sha256:${createHash("sha256").update(content).digest("hex")}`;
}

function mapFor(
  routeContent: string,
  excludedContent: string,
): {
  readonly ref: SurfaceMapRef;
  readonly value: SurfaceMap;
  readonly routeDigest: string;
} {
  const routeDigest = fileDigest(routeContent);
  const excludedDigest = fileDigest(excludedContent);
  const nodeId = sha256Digest("route-node");
  const value: SurfaceMap = {
    kind: "surface-map",
    schemaVersion: 1,
    revision: { kind: "initial", number: 1, predecessor: null },
    targetSnapshot: { id: "plugin-1.0.0", digest: digest("1") },
    mappingProfile: { id: "wordpress-static-v1", digest: digest("2") },
    sources: {
      manifestDigest: digest("3"),
      phpProgramIndexDigest: digest("4"),
    },
    inventory: [
      {
        path: "includes/route.php",
        digest: routeDigest,
        size: Buffer.byteLength(routeContent),
        classification: "php",
        coverage: { status: "indexed" },
      },
      {
        path: "includes/excluded.php",
        digest: excludedDigest,
        size: Buffer.byteLength(excludedContent),
        classification: "php",
        coverage: { status: "indexed" },
      },
    ],
    nodes: [
      {
        id: nodeId,
        kind: "entry",
        subject: {
          kind: "hook",
          hook: "wp_ajax_nopriv_example",
          callback: "handle_example",
        },
        evidence: {
          kind: "observed",
          evidence: [
            {
              kind: "source-anchor",
              targetSnapshotDigest: digest("1"),
              path: "includes/route.php",
              fileDigest: routeDigest,
              startLine: 2,
              endLine: 2,
              startOffset: 6,
              endOffset: 20,
            },
          ],
        },
      },
    ],
    relations: [],
    gaps: [],
    summary: { files: 2, nodes: 1, relations: 0, gaps: 0 },
  };
  return {
    value,
    routeDigest,
    ref: {
      kind: "surface-map",
      schemaVersion: 1,
      revisionKind: "initial",
      targetSnapshotId: value.targetSnapshot.id,
      mappingProfileId: value.mappingProfile.id,
      digest: sha256Digest(value),
      summary: value.summary,
    },
  };
}

function plan(routeDigest: string): VerificationPlan {
  const hypothesis = {
    kind: "source-bound-hypothesis" as const,
    schemaVersion: 1 as const,
    causalIdentity: {
      rootCause: "unescaped-persistent-output",
      attackerControlledPrimitive: "unauthenticated-form-value",
      brokenSecurityProperty: "administrator-browser-integrity",
    },
    attackerPremise: "unauthenticated" as const,
    impact: "stored-xss" as const,
    route: {
      anchors: [
        {
          path: "includes/route.php",
          fileDigest: routeDigest,
          startLine: 2,
          endLine: 2,
        },
      ],
    },
    unknowns: [
      {
        claim: "the stored value reaches an administrator browser",
        requiredEvidence: "fresh browser witness and sibling control",
      },
    ],
    falsifier: "the value is escaped before privileged rendering",
    nextExperiment: "compare execution with the causal value removed",
  };
  return {
    kind: "verification-plan",
    schemaVersion: 1,
    verificationId: "verification:test",
    campaignId: "campaign:test",
    targetSnapshot: {
      id: "plugin-1.0.0",
      pluginSlug: "plugin",
      version: "1.0.0",
      digest: digest("1"),
    },
    scope: { permittedAttacker: "unauthenticated" },
    hypothesis,
    hypothesisDigest: sha256Digest(hypothesis),
    labBaseline: {
      kind: "lab-baseline",
      schemaVersion: 1,
      id: "lab-v1",
      digest: digest("5"),
      targetSnapshotDigest: digest("1"),
      runtimeProfileDigest: digest("6"),
      setupPlanDigest: digest("7"),
      configurationDigest: digest("8"),
    },
    verifierModelProfile: {
      kind: "model-profile",
      schemaVersion: 1,
      id: "claude-opus-verifier-v1",
      digest: digest("9"),
      family: "claude",
    },
    promptSet: {
      kind: "prompt-set",
      schemaVersion: 1,
      id: "independent-verifier-v1",
      digest: digest("a"),
    },
    verificationPolicy: {
      kind: "verification-policy",
      schemaVersion: 1,
      id: "stored-xss-verification-v1",
      digest: digest("b"),
    },
    experimentRegistry: {
      kind: "experiment-registry",
      schemaVersion: 1,
      id: "stored-xss-experiments-v1",
      digest: digest("c"),
    },
    budget: {
      maxVerifierAttempts: 1,
      maxExperiments: 2,
      maxWallTimeMs: 120_000,
    },
  };
}

function sqlInjectionPlan(routeDigest: string): VerificationPlan {
  const base = plan(routeDigest);
  const hypothesis = {
    ...base.hypothesis,
    causalIdentity: {
      rootCause: "request-controlled-identifiers-enter-query-structure",
      attackerControlledPrimitive: "unauthenticated-fields-array",
      brokenSecurityProperty: "sql-query-structure-integrity",
    },
    impact: "sql-injection" as const,
    unknowns: [
      {
        claim: "the database-only canary is returned to the attacker",
        requiredEvidence: "fresh database readback and sibling control",
      },
    ],
    falsifier: "the requested identifiers are restricted to known fields",
    nextExperiment:
      "compare database canary readback with the structure-changing value removed",
  };
  return {
    ...base,
    hypothesis,
    hypothesisDigest: sha256Digest(hypothesis),
  };
}

function providerEnvelope(output: unknown, model = "claude-opus-5"): string {
  return JSON.stringify({
    type: "result",
    subtype: "success",
    is_error: false,
    terminal_reason: "completed",
    structured_output: { decision: output },
    permission_denials: [],
    usage: {
      server_tool_use: { web_search_requests: 0, web_fetch_requests: 0 },
    },
    subagent_stats: { spawned: 0 },
    modelUsage: { [model]: { canonicalModel: model } },
  });
}

interface FixtureContext {
  readonly plan: VerificationPlan;
  readonly routeContent: string;
}

async function createFixture(
  execute: (
    request: ClaudeStructuredProcessRequest,
    context: FixtureContext,
  ) => ReturnType<ClaudeStructuredProcess["execute"]>,
  makePlan: (routeDigest: string) => VerificationPlan = plan,
): Promise<{
  readonly cleanup: () => Promise<void>;
  readonly context: FixtureContext;
  readonly sourceDirectory: string;
  readonly verifier: ReturnType<typeof openClaudeIndependentVerifier>;
}> {
  const directory = await mkdtemp(join(tmpdir(), "claude-verifier-"));
  const routeContent = "<?php\nhandle_example();\necho $stored;\n";
  const excludedContent = "<?php // EXCLUDED_SECRET_MARKER\n";
  const surfaceMap = mapFor(routeContent, excludedContent);
  await writeFile(join(directory, "includes-route.php"), routeContent);
  await writeFile(join(directory, "includes-excluded.php"), excludedContent);
  const sourceDirectory = join(directory, "target");
  await mkdir(join(sourceDirectory, "includes"), { recursive: true });
  await rename(
    join(directory, "includes-route.php"),
    join(sourceDirectory, "includes", "route.php"),
  );
  await rename(
    join(directory, "includes-excluded.php"),
    join(sourceDirectory, "includes", "excluded.php"),
  );
  const inputPlan = makePlan(surfaceMap.routeDigest);
  const context = { plan: inputPlan, routeContent };
  const process: ClaudeStructuredProcess = {
    execute: (request) => execute(request, context),
  };
  return {
    context,
    cleanup: () => rm(directory, { recursive: true, force: true }),
    sourceDirectory,
    verifier: openClaudeIndependentVerifier({
      sourceDirectory,
      surfaceMap,
      process,
      verifierModelProfile: {
        ref: inputPlan.verifierModelProfile,
        execution: {
          provider: "anthropic",
          model: "claude-opus-5",
          transport: "claude-code-process",
          executableVersion: "2.1.251",
          effort: "high",
          eligibilityReceiptDigest: digest("d"),
        },
      },
      promptSet: inputPlan.promptSet,
      maxSourceBytes: 64 * 1024,
      maxOutputBytes: 256 * 1024,
    }),
  };
}

describe("ClaudeIndependentVerifier.rederive", () => {
  it("does not treat a suffix inside a different path as requested evidence", async () => {
    let observedPrompt = "";
    const fixture = await createFixture(
      async (request, context) => {
        observedPrompt = request.prompt;
        return {
          kind: "exited",
          exitCode: 0,
          stderr: "",
          stdout: providerEnvelope({
            kind: "source-rederivation",
            schemaVersion: 1,
            verificationId: context.plan.verificationId,
            targetSnapshotDigest: context.plan.targetSnapshot.digest,
            hypothesisDigest: context.plan.hypothesisDigest,
            status: "supported",
            sourceEvidence: [
              {
                path: "includes/route.php",
                fileDigest: fileDigest(context.routeContent),
                startLine: 1,
                endLine: 3,
              },
            ],
            experiment: {
              kind: "stored-xss-browser",
              schemaVersion: 1,
              adapterVersion: "stored-xss-browser@v1",
              causalFactor: "attacker-controlled-stored-value",
              successCriterion: "privileged-browser-execution-canary",
            },
          }),
        };
      },
      (routeDigest) => {
        const base = plan(routeDigest);
        const hypothesis = {
          ...base.hypothesis,
          unknowns: [
            {
              claim: "the route reaches its renderer",
              requiredEvidence:
                "Inspect shadow-includes/excluded.php if it exists",
            },
          ],
        };
        return {
          ...base,
          hypothesis,
          hypothesisDigest: sha256Digest(hypothesis),
        };
      },
    );

    try {
      await expect(
        fixture.verifier.rederive(fixture.context.plan),
      ).resolves.toMatchObject({ status: "supported" });
      expect(observedPrompt).not.toContain("EXCLUDED_SECRET_MARKER");
    } finally {
      await fixture.cleanup();
    }
  });

  it("adds only inventory-bound PHP paths explicitly requested as missing evidence", async () => {
    let observedPrompt = "";
    const fixture = await createFixture(
      async (request, context) => {
        observedPrompt = request.prompt;
        return {
          kind: "exited",
          exitCode: 0,
          stderr: "",
          stdout: providerEnvelope({
            kind: "source-rederivation",
            schemaVersion: 1,
            verificationId: context.plan.verificationId,
            targetSnapshotDigest: context.plan.targetSnapshot.digest,
            hypothesisDigest: context.plan.hypothesisDigest,
            status: "supported",
            sourceEvidence: [
              {
                path: "includes/route.php",
                fileDigest: fileDigest(context.routeContent),
                startLine: 1,
                endLine: 3,
              },
            ],
            experiment: {
              kind: "stored-xss-browser",
              schemaVersion: 1,
              adapterVersion: "stored-xss-browser@v1",
              causalFactor: "attacker-controlled-stored-value",
              successCriterion: "privileged-browser-execution-canary",
            },
          }),
        };
      },
      (routeDigest) => {
        const base = plan(routeDigest);
        const hypothesis = {
          ...base.hypothesis,
          unknowns: [
            {
              claim: "the route reaches its renderer",
              requiredEvidence:
                "Inspect includes/excluded.php from the admitted Target inventory",
            },
          ],
        };
        return {
          ...base,
          hypothesis,
          hypothesisDigest: sha256Digest(hypothesis),
        };
      },
    );

    try {
      await expect(
        fixture.verifier.rederive(fixture.context.plan),
      ).resolves.toMatchObject({ status: "supported" });
      expect(observedPrompt).toContain("includes/excluded.php");
      expect(observedPrompt).toContain("EXCLUDED_SECRET_MARKER");
    } finally {
      await fixture.cleanup();
    }
  });

  it("independently re-derives a SQLi database-readback experiment from bound source", async () => {
    let observedPrompt = "";
    const fixture = await createFixture(async (request, context) => {
      observedPrompt = request.prompt;
      return {
        kind: "exited",
        exitCode: 0,
        stderr: "",
        stdout: providerEnvelope({
          kind: "source-rederivation",
          schemaVersion: 1,
          verificationId: context.plan.verificationId,
          targetSnapshotDigest: context.plan.targetSnapshot.digest,
          hypothesisDigest: context.plan.hypothesisDigest,
          status: "supported",
          sourceEvidence: [
            {
              path: "includes/route.php",
              fileDigest: fileDigest(context.routeContent),
              startLine: 1,
              endLine: 3,
            },
          ],
          experiment: {
            kind: "sql-injection-database",
            schemaVersion: 1,
            adapterVersion: "sql-injection-database@v1",
            causalFactor: "request-controlled-query-structure",
            successCriterion: "database-readback-canary",
          },
        }),
      };
    }, sqlInjectionPlan);
    const inputPlan = fixture.context.plan;

    try {
      await expect(fixture.verifier.rederive(inputPlan)).resolves.toMatchObject(
        {
          status: "supported",
          experiment: { kind: "sql-injection-database" },
        },
      );
      expect(observedPrompt).toContain("database-readback");
      expect(observedPrompt).not.toContain("stored-XSS browser experiment");
    } finally {
      await fixture.cleanup();
    }
  });

  it("re-derives from only the source files bound to the hypothesis route", async () => {
    let observedRequest: ClaudeStructuredProcessRequest | undefined;
    const fixture = await createFixture(async (request, context) => {
      observedRequest = request;
      expect(request.outputJsonSchema).toMatchObject({ type: "object" });
      expect(request.outputJsonSchema).not.toHaveProperty("oneOf");
      expect(request.outputJsonSchema).not.toHaveProperty("allOf");
      expect(request.outputJsonSchema).not.toHaveProperty("anyOf");
      return {
        kind: "exited",
        exitCode: 0,
        stderr: "",
        stdout: providerEnvelope({
          kind: "source-rederivation",
          schemaVersion: 1,
          verificationId: context.plan.verificationId,
          targetSnapshotDigest: context.plan.targetSnapshot.digest,
          hypothesisDigest: context.plan.hypothesisDigest,
          status: "supported",
          sourceEvidence: [
            {
              path: "includes/route.php",
              fileDigest: fileDigest(context.routeContent),
              startLine: 1,
              endLine: 3,
            },
          ],
          experiment: {
            kind: "stored-xss-browser",
            schemaVersion: 1,
            adapterVersion: "stored-xss-browser@v1",
            causalFactor: "attacker-controlled-stored-value",
            successCriterion: "privileged-browser-execution-canary",
          },
        }),
      };
    });

    try {
      await expect(
        fixture.verifier.rederive(fixture.context.plan),
      ).resolves.toMatchObject({
        status: "supported",
        sourceEvidence: [{ path: "includes/route.php" }],
      });
      expect(observedRequest?.prompt).toContain("includes/route.php");
      expect(observedRequest?.prompt).toContain("handle_example");
      expect(observedRequest?.prompt).not.toContain("EXCLUDED_SECRET_MARKER");
    } finally {
      await fixture.cleanup();
    }
  });

  it("allows the model to reject an unsupported route without fabricating evidence", async () => {
    const fixture = await createFixture(async (request, context) => {
      expect(JSON.stringify(request.outputJsonSchema)).toContain("unsupported");
      return {
        kind: "exited",
        exitCode: 0,
        stderr: "",
        stdout: providerEnvelope({
          kind: "source-rederivation",
          schemaVersion: 1,
          verificationId: context.plan.verificationId,
          targetSnapshotDigest: context.plan.targetSnapshot.digest,
          hypothesisDigest: context.plan.hypothesisDigest,
          status: "unsupported",
          reason: "source-does-not-support-hypothesis",
        }),
      };
    });

    try {
      await expect(
        fixture.verifier.rederive(fixture.context.plan),
      ).rejects.toMatchObject({
        name: "IndependentVerifierBlockedError",
        reason: "evidence-incomplete",
      });
    } finally {
      await fixture.cleanup();
    }
  });

  it("returns an evidence-bearing source falsifier for paired Lab confirmation", async () => {
    const fixture = await createFixture(async (_request, context) => ({
      kind: "exited",
      exitCode: 0,
      stderr: "",
      stdout: providerEnvelope({
        kind: "source-rederivation",
        schemaVersion: 1,
        verificationId: context.plan.verificationId,
        targetSnapshotDigest: context.plan.targetSnapshot.digest,
        hypothesisDigest: context.plan.hypothesisDigest,
        status: "source-falsified",
        falsifiedCondition: context.plan.hypothesis.falsifier,
        sourceEvidence: [
          {
            path: "includes/route.php",
            fileDigest: fileDigest(context.routeContent),
            startLine: 1,
            endLine: 3,
          },
        ],
        experiment: {
          kind: "stored-xss-browser",
          schemaVersion: 1,
          adapterVersion: "stored-xss-browser@v1",
          causalFactor: "attacker-controlled-stored-value",
          successCriterion: "privileged-browser-execution-canary",
        },
      }),
    }));

    try {
      await expect(
        fixture.verifier.rederive(fixture.context.plan),
      ).resolves.toMatchObject({
        status: "source-falsified",
        falsifiedCondition: fixture.context.plan.hypothesis.falsifier,
        sourceEvidence: [{ path: "includes/route.php" }],
      });
    } finally {
      await fixture.cleanup();
    }
  });

  it.each([
    {
      name: "model substitution",
      envelope: () => providerEnvelope({}, "claude-sonnet-substitute"),
    },
    {
      name: "built-in web use",
      envelope: () => {
        const value = JSON.parse(providerEnvelope({})) as {
          usage: { server_tool_use: { web_search_requests: number } };
        };
        value.usage.server_tool_use.web_search_requests = 1;
        return JSON.stringify(value);
      },
    },
    {
      name: "permission denial",
      envelope: () => {
        const value = JSON.parse(providerEnvelope({})) as {
          permission_denials: unknown[];
        };
        value.permission_denials = [{ tool: "shell" }];
        return JSON.stringify(value);
      },
    },
  ])("never accepts $name as independent evidence", async ({ envelope }) => {
    const fixture = await createFixture(async () => ({
      kind: "exited",
      exitCode: 0,
      stderr: "",
      stdout: envelope(),
    }));

    try {
      await expect(
        fixture.verifier.rederive(fixture.context.plan),
      ).rejects.toMatchObject({
        name: "IndependentVerifierBlockedError",
        reason: "verifier-unavailable",
      });
    } finally {
      await fixture.cleanup();
    }
  });

  it("rejects changed target source before starting the model", async () => {
    let processCalls = 0;
    const fixture = await createFixture(async () => {
      processCalls += 1;
      return { kind: "auth-required", reason: "must-not-run" };
    });
    await writeFile(
      join(fixture.sourceDirectory, "includes", "route.php"),
      "<?php // changed after mapping\n",
    );

    try {
      await expect(
        fixture.verifier.rederive(fixture.context.plan),
      ).rejects.toThrow("Verifier source digest mismatch");
      expect(processCalls).toBe(0);
    } finally {
      await fixture.cleanup();
    }
  });
});
