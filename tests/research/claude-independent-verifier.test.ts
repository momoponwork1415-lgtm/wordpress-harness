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
  TargetFileManifest,
  TargetFileManifestRef,
} from "../../src/research/source-mapping/index.js";
import {
  openClaudeIndependentVerifier,
  type VerificationPlan,
} from "../../src/research/verification/index.js";

const digest = (character: string): string => `sha256:${character.repeat(64)}`;

function fileDigest(content: string): string {
  return `sha256:${createHash("sha256").update(content).digest("hex")}`;
}

function manifestFor(
  routeContent: string,
  excludedContent: string,
): {
  readonly ref: TargetFileManifestRef;
  readonly value: TargetFileManifest;
  readonly routeDigest: string;
} {
  const routeDigest = fileDigest(routeContent);
  const excludedDigest = fileDigest(excludedContent);
  const value: TargetFileManifest = {
    kind: "target-file-manifest",
    schemaVersion: 1,
    targetSnapshot: { id: "plugin-1.0.0", digest: digest("1") },
    entries: [
      {
        path: "includes/excluded.php",
        digest: excludedDigest,
        size: Buffer.byteLength(excludedContent),
      },
      {
        path: "includes/route.php",
        digest: routeDigest,
        size: Buffer.byteLength(routeContent),
      },
    ],
  };
  return {
    value,
    routeDigest,
    ref: {
      kind: "target-file-manifest",
      schemaVersion: 1,
      targetSnapshotId: value.targetSnapshot.id,
      targetSnapshotDigest: value.targetSnapshot.digest,
      digest: sha256Digest(value),
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

function reflectedXssPlan(routeDigest: string): VerificationPlan {
  const base = plan(routeDigest);
  const hypothesis = {
    ...base.hypothesis,
    causalIdentity: {
      rootCause: "unescaped-reflected-output",
      attackerControlledPrimitive: "unauthenticated-query-value",
      brokenSecurityProperty: "privileged-browser-execution-integrity",
    },
    impact: "reflected-xss" as const,
    unknowns: [
      {
        claim: "the reflected value executes in the expected victim context",
        requiredEvidence: "fresh browser execution canary and sibling control",
      },
    ],
    falsifier: "the value is escaped before browser interpretation",
    nextExperiment:
      "compare browser execution with the reflected causal value removed",
  };
  return {
    ...base,
    hypothesis,
    hypothesisDigest: sha256Digest(hypothesis),
  };
}

function accountTakeoverPlan(routeDigest: string): VerificationPlan {
  const base = plan(routeDigest);
  const hypothesis = {
    ...base.hypothesis,
    causalIdentity: {
      rootCause: "public-translation-discloses-password-reset-link",
      attackerControlledPrimitive: "unauthenticated-translation-row-reader",
      brokenSecurityProperty: "target-account-authentication-integrity",
    },
    impact: "account-takeover" as const,
    unknowns: [
      {
        claim: "the disclosed reset capability authenticates as the target",
        requiredEvidence:
          "fresh reset-capability redemption and target-account authentication",
      },
    ],
    falsifier: "the attacker cannot obtain or redeem the reset capability",
    nextExperiment:
      "compare target-account authentication with disclosure present and removed",
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

function reportedProviderEnvelope(
  output: unknown,
  usage: {
    readonly turns: number;
    readonly input: number;
    readonly cacheCreation: number;
    readonly cacheRead: number;
    readonly output: number;
  },
): string {
  const value = JSON.parse(providerEnvelope(output)) as Record<string, unknown>;
  value.duration_ms = 1_000;
  value.num_turns = usage.turns;
  value.total_cost_usd = 0.75;
  value.modelUsage = {
    "claude-opus-5": {
      canonicalModel: "claude-opus-5",
      inputTokens: usage.input,
      cacheCreationInputTokens: usage.cacheCreation,
      cacheReadInputTokens: usage.cacheRead,
      outputTokens: usage.output,
    },
  };
  return JSON.stringify(value);
}

function budgetedPlan(
  routeDigest: string,
  manifest: TargetFileManifestRef,
): VerificationPlan {
  const base = plan(routeDigest);
  return {
    ...base,
    schemaVersion: 2,
    manifest,
    budget: {
      schemaVersion: 2,
      maxVerifierAttempts: 1,
      maxExperiments: 2,
      maxWallTimeMs: 120_000,
      maxModelTokens: 100,
      maxModelTurns: 4,
      maxProviderCostUsd: 1.25,
      maxOutputBytes: 32 * 1024,
    },
  };
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
  makePlan: (
    routeDigest: string,
    manifest: TargetFileManifestRef,
  ) => VerificationPlan = plan,
): Promise<{
  readonly cleanup: () => Promise<void>;
  readonly context: FixtureContext;
  readonly sourceDirectory: string;
  readonly verifier: ReturnType<typeof openClaudeIndependentVerifier>;
}> {
  const directory = await mkdtemp(join(tmpdir(), "claude-verifier-"));
  const routeContent = "<?php\nhandle_example();\necho $stored;\n";
  const excludedContent = "<?php // EXCLUDED_SECRET_MARKER\n";
  const manifest = manifestFor(routeContent, excludedContent);
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
  const inputPlan = makePlan(manifest.routeDigest, manifest.ref);
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
      manifest,
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
  it("passes the Verifier cost ceiling to Claude and blocks reported token overrun", async () => {
    let observedRequest: ClaudeStructuredProcessRequest | undefined;
    const fixture = await createFixture(async (request, context) => {
      observedRequest = request;
      return {
        kind: "exited",
        exitCode: 0,
        stderr: "",
        stdout: reportedProviderEnvelope(
          {
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
          },
          {
            turns: 2,
            input: 25,
            cacheCreation: 25,
            cacheRead: 50,
            output: 1,
          },
        ),
      };
    }, budgetedPlan);

    try {
      await expect(
        fixture.verifier.rederive(fixture.context.plan),
      ).rejects.toMatchObject({
        name: "IndependentVerifierBlockedError",
        reason: "budget-exhausted",
        usage: {
          measurement: "reported",
          modelTurns: 2,
          modelTokens: { total: 101 },
        },
      });
      expect(observedRequest?.budget).toMatchObject({
        maxProviderCostUsd: 1.25,
        maxOutputBytes: 32 * 1024,
      });
    } finally {
      await fixture.cleanup();
    }
  });

  it("returns v3 Verifier output when reported token and turn values are telemetry-only", async () => {
    const fixture = await createFixture(
      async (_request, context) => ({
        kind: "exited",
        exitCode: 0,
        stderr: "",
        stdout: reportedProviderEnvelope(
          {
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
          },
          {
            turns: 2,
            input: 25,
            cacheCreation: 25,
            cacheRead: 50,
            output: 1,
          },
        ),
      }),
      (routeDigest, manifest) => {
        const base = budgetedPlan(routeDigest, manifest);
        if (base.schemaVersion !== 2) throw new Error("Expected a v2 Plan");
        return {
          ...base,
          budget: {
            ...base.budget,
            maxModelTokens: 1,
            maxModelTurns: 1,
            reportedUsageEnforcement: "telemetry-only",
          },
        };
      },
    );

    try {
      await expect(
        fixture.verifier.rederive(fixture.context.plan),
      ).resolves.toMatchObject({
        kind: "independent-verifier-result",
        usage: { modelTurns: 2, modelTokens: { total: 101 } },
      });
    } finally {
      await fixture.cleanup();
    }
  });

  it("preserves reported cost and tokens when Claude stops at its provider budget", async () => {
    const fixture = await createFixture(
      async () => ({
        kind: "exited",
        exitCode: 1,
        stderr: "",
        stdout: JSON.stringify({
          type: "result",
          is_error: true,
          terminal_reason: "error_max_budget_usd",
          api_error_status: null,
          result: "Provider budget reached",
          duration_ms: 1_500,
          num_turns: 3,
          total_cost_usd: 1.26,
          modelUsage: {
            "claude-opus-5": {
              canonicalModel: "claude-opus-5",
              inputTokens: 20,
              cacheCreationInputTokens: 30,
              cacheReadInputTokens: 40,
              outputTokens: 10,
            },
          },
        }),
      }),
      budgetedPlan,
    );

    try {
      await expect(
        fixture.verifier.rederive(fixture.context.plan),
      ).rejects.toMatchObject({
        name: "IndependentVerifierBlockedError",
        reason: "budget-exhausted",
        usage: {
          measurement: "reported",
          estimatedCostUsd: 1.26,
          modelTurns: 3,
          modelTokens: { total: 100 },
        },
      });
    } finally {
      await fixture.cleanup();
    }
  });

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

  it("adds only Manifest-bound PHP paths explicitly requested as missing evidence", async () => {
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
                "Inspect includes/excluded.php from the admitted Target File Manifest",
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

  it("lets the verifier select a SQLi state-change effect without requiring database readback", async () => {
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
            kind: "sql-query-semantic-effect",
            schemaVersion: 1,
            adapterVersion: "sql-query-semantic-effect@v1",
            causalFactor: "request-controlled-query-structure",
            successCriterion: "security-effect",
            effect: { kind: "database-state-change-canary" },
          },
        }),
      };
    }, sqlInjectionPlan);
    const inputPlan = fixture.context.plan;

    try {
      await expect(fixture.verifier.rederive(inputPlan)).resolves.toMatchObject(
        {
          status: "supported",
          experiment: {
            kind: "sql-query-semantic-effect",
            effect: { kind: "database-state-change-canary" },
          },
        },
      );
      expect(observedPrompt).toContain(
        "strongest safely observable security effect",
      );
      expect(observedPrompt).toContain("do not require readback");
      expect(observedPrompt).not.toContain("stored-XSS browser experiment");
    } finally {
      await fixture.cleanup();
    }
  });

  it("re-derives reflected XSS as browser execution without requiring persistence or alert(1)", async () => {
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
            kind: "browser-script-execution",
            schemaVersion: 1,
            adapterVersion: "browser-script-execution@v1",
            causalFactor: "attacker-controlled-rendered-value",
            successCriterion: "browser-execution-canary",
            victimContext: "privileged",
          },
        }),
      };
    }, reflectedXssPlan);

    try {
      await expect(
        fixture.verifier.rederive(fixture.context.plan),
      ).resolves.toMatchObject({
        status: "supported",
        experiment: {
          kind: "browser-script-execution",
          victimContext: "privileged",
        },
      });
      expect(observedPrompt).toContain("Do not require persistence");
      expect(observedPrompt).toContain("browser-script-execution@v1");
      expect(observedPrompt).not.toContain("alert(1)");
    } finally {
      await fixture.cleanup();
    }
  });

  it("independently re-derives a method-neutral account-takeover experiment from bound source", async () => {
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
            kind: "authentication-state-transition",
            schemaVersion: 1,
            adapterVersion: "authentication-state-transition@v1",
            causalFactor: "public-reset-capability-disclosure",
            successCriterion: "target-account-authentication-canary",
          },
        }),
      };
    }, accountTakeoverPlan);

    try {
      await expect(
        fixture.verifier.rederive(fixture.context.plan),
      ).resolves.toMatchObject({
        status: "supported",
        experiment: { kind: "authentication-state-transition" },
      });
      expect(observedPrompt).toContain("target-account authentication");
      expect(observedPrompt).toContain("authentication-state-transition@v1");
      expect(observedPrompt).toContain("session theft");
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

  it("rejects a v2 Plan bound to another Manifest before starting the model", async () => {
    let processCalls = 0;
    const fixture = await createFixture(async () => {
      processCalls += 1;
      return { kind: "auth-required", reason: "must-not-run" };
    }, budgetedPlan);
    if (fixture.context.plan.schemaVersion !== 2) {
      throw new Error("Expected a v2 Verification Plan");
    }
    const mismatchedPlan: VerificationPlan = {
      ...fixture.context.plan,
      manifest: {
        ...fixture.context.plan.manifest,
        digest: digest("0"),
      },
    };

    try {
      await expect(fixture.verifier.rederive(mismatchedPlan)).rejects.toThrow(
        "Verifier Plan does not match bound Target File Manifest",
      );
      expect(processCalls).toBe(0);
    } finally {
      await fixture.cleanup();
    }
  });
});
