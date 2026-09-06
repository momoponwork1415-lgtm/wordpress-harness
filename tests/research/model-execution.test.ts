import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { sha256Digest } from "../../src/research/research-record/canonical-json.js";
import {
  openClaudeModelExecution,
  openGlmModelExecution,
  openGrokModelExecution,
  openModelExecution,
  openPrivateModelTranscript,
  type AttemptPlan,
  type AttemptPlanV2,
  type ModelProcess,
} from "../../src/research/model-execution/index.js";
import { decodeGlmEnvelope } from "../../src/research/model-execution/glm-envelope.js";
import { openSourceEvidenceFixture } from "../fixtures/source-evidence.js";

const leaseId = sha256Digest("finder-lease");
const anchorFileDigest = sha256Digest("entry-file");

function candidateHypothesis() {
  return {
    kind: "source-bound-hypothesis" as const,
    schemaVersion: 1 as const,
    causalIdentity: {
      rootCause: "missing-authorization",
      attackerControlledPrimitive: "unauthenticated-request",
      brokenSecurityProperty: "authorization",
    },
    attackerPremise: "unauthenticated" as const,
    impact: "account-takeover" as const,
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
        claim: "the callback discloses a reset link",
        requiredEvidence: "trace the callback response",
      },
    ],
    falsifier: "the callback requires an administrator capability",
    nextExperiment: "reproduce as an unauthenticated principal",
  };
}

function candidateRouteFragment() {
  return {
    kind: "route-fragment-proposal" as const,
    schemaVersion: 1 as const,
    attackerPremise: "unauthenticated" as const,
    preconditions: ["the public request handler is registered"],
    operation: "read a persisted dictionary row by attacker-selected id",
    consumedValues: [
      {
        identity: "dictionary-row-id",
        provenance: "attacker-controlled" as const,
      },
    ],
    producedValues: [
      {
        identity: "dictionary-row-value",
        capability: "read" as const,
      },
    ],
    stateTransitions: [
      {
        stateIdentity: "translation-dictionary-row",
        operation: "read" as const,
        effect: "the anonymous caller learns the stored row value",
      },
    ],
    evidence: [
      {
        path: "includes/public-handler.php",
        fileDigest: `sha256:${"c".repeat(64)}`,
        startLine: 20,
        endLine: 48,
      },
    ],
    unknowns: [
      {
        claim: "a security token can be persisted in the same dictionary",
        requiredEvidence: "trace token generation into dictionary writes",
      },
    ],
    falsifier: "the handler restricts every requested row to public content",
    nextInvestigation: "find values written to the same dictionary identity",
  };
}

function attemptPlan(): AttemptPlan {
  return {
    kind: "attempt-plan",
    schemaVersion: 1,
    attemptId: "attempt-1",
    leaseId,
    role: "finder",
    target: {
      id: "synthetic-plugin-1.0.0",
      digest: `sha256:${"a".repeat(64)}`,
    },
    modelProfile: {
      provider: "anthropic",
      model: "claude-opus-5",
      transport: "claude-code-process",
      executableVersion: "2.1.251",
      effort: "high",
      eligibilityReceiptDigest: `sha256:${"b".repeat(64)}`,
    },
    prompt: "Inspect the supplied synthetic source and return Finder output.",
    budget: {
      maxWallTimeMs: 60_000,
      maxOutputBytes: 1_000_000,
      maxHypotheses: 1,
    },
  };
}

function rootPlannerAttemptPlan(): Extract<
  AttemptPlanV2,
  { role: "root-planner" }
> {
  return {
    kind: "attempt-plan",
    schemaVersion: 2,
    attemptId: "root-planner-attempt-1",
    owner: "exploration",
    role: "root-planner",
    target: {
      id: "synthetic-plugin-1.0.0",
      pluginSlug: "synthetic-plugin",
      version: "1.0.0",
      digest: `sha256:${"a".repeat(64)}`,
    },
    manifest: {
      kind: "target-file-manifest",
      schemaVersion: 1,
      targetSnapshotId: "synthetic-plugin-1.0.0",
      targetSnapshotDigest: `sha256:${"a".repeat(64)}`,
      digest: `sha256:${"c".repeat(64)}`,
    },
    assignment: {
      kind: "initial-research-planning",
      schemaVersion: 1,
      metadata: {
        kind: "oracle-free-target-metadata",
        schemaVersion: 1,
        pluginIdentity: "wporg:synthetic-plugin",
        mainPluginFile: "synthetic-plugin.php",
        canonicalInstallDirectory: "synthetic-plugin",
      },
      maxTargetSpecificTheses: 3,
      minWildcardTheses: 0,
      maxLeases: 3,
    },
    promptSet: {
      id: "semantic-root-planner-v1",
      digest: `sha256:${"d".repeat(64)}`,
    },
    modelProfile: {
      provider: "anthropic",
      model: "claude-opus-5",
      transport: "claude-code-process",
      executableVersion: "2.1.251",
      effort: "high",
      eligibilityReceiptDigest: `sha256:${"b".repeat(64)}`,
    },
    prompt: "Plan independent oracle-free research theses.",
    outputJsonSchema: {
      type: "object",
      required: ["kind", "schemaVersion", "theses"],
    },
    sourceToolPolicy: {
      kind: "source-tool-policy",
      schemaVersion: 1,
      id: "semantic-source-tools-v1",
      digest: `sha256:${"e".repeat(64)}`,
    },
    budget: {
      maxWallTimeMs: 300_000,
      maxModelTokens: 100_000,
      maxModelTurns: 4,
      maxProviderCostUsd: 2.5,
      maxOutputBytes: 512 * 1_024,
      maxSourceQueries: 32,
    },
  };
}

function rootEvaluatorAttemptPlan(): Extract<
  AttemptPlanV2,
  { role: "root-evaluator" }
> {
  const original = rootPlannerAttemptPlan();
  const { sourceToolPolicy: _sourceToolPolicy, ...common } = original;
  const { maxSourceQueries: _maxSourceQueries, ...budget } = original.budget;
  return {
    ...common,
    role: "root-evaluator",
    assignment: {
      kind: "wave-evaluation",
      schemaVersion: 1,
      wave: {
        kind: "work-wave",
        schemaVersion: 2,
        id: `sha256:${"1".repeat(64)}`,
        digest: `sha256:${"2".repeat(64)}`,
        targetSnapshotDigest: original.target.digest,
        manifestDigest: original.manifest.digest,
      },
      terminalDigest: `sha256:${"3".repeat(64)}`,
      subjectDigests: [`sha256:${"4".repeat(64)}`],
    },
    budget,
  };
}

function adversarialCriticAttemptPlan(): Extract<
  AttemptPlanV2,
  { role: "adversarial-critic" }
> {
  const original = rootPlannerAttemptPlan();
  return {
    ...original,
    attemptId: "adversarial-critic-attempt-1",
    role: "adversarial-critic",
    assignment: {
      kind: "chain-critique",
      schemaVersion: 1,
      synthesisDigest: `sha256:${"1".repeat(64)}`,
      proposalIds: [`sha256:${"2".repeat(64)}`],
    },
    prompt: "Challenge every Chain Proposal against fresh source.",
  };
}

function validatorAttemptPlan(): Extract<AttemptPlanV2, { role: "validator" }> {
  const original = rootPlannerAttemptPlan();
  return {
    ...original,
    attemptId: "validator-attempt-1",
    owner: "validation",
    role: "validator",
    assignment: {
      kind: "candidate-validation",
      schemaVersion: 1,
      candidateId: `sha256:${"6".repeat(64)}`,
      threatContextId: `sha256:${"7".repeat(64)}`,
      attemptOrdinal: 1,
    },
    prompt: "Validate the candidate against fresh source.",
  };
}

function validationSynthesisAttemptPlan(): Extract<
  AttemptPlanV2,
  { role: "validation-synthesizer" }
> {
  const original = rootEvaluatorAttemptPlan();
  return {
    ...original,
    attemptId: "validation-synthesizer-attempt-1",
    owner: "validation",
    role: "validation-synthesizer",
    assignment: {
      kind: "validation-synthesis",
      schemaVersion: 1,
      candidateId: `sha256:${"6".repeat(64)}`,
      validatorAttemptDigests: [
        `sha256:${"7".repeat(64)}`,
        `sha256:${"8".repeat(64)}`,
      ],
    },
    prompt: "Synthesize only the supplied Validation Attempts.",
  };
}

function providerEnvelope(
  structuredOutput: unknown,
  webSearchRequests = 0,
): object {
  return {
    type: "result",
    subtype: "success",
    is_error: false,
    terminal_reason: "completed",
    duration_ms: 1_234,
    num_turns: 2,
    structured_output: structuredOutput,
    permission_denials: [],
    usage: {
      input_tokens: 10,
      cache_creation_input_tokens: 20,
      cache_read_input_tokens: 30,
      output_tokens: 7,
      server_tool_use: {
        web_search_requests: webSearchRequests,
        web_fetch_requests: 0,
      },
    },
    subagent_stats: { spawned: 0 },
    modelUsage: {
      "claude-haiku-4-5-20251001": {
        canonicalModel: "claude-haiku-4-5",
        inputTokens: 3,
        outputTokens: 2,
        cacheReadInputTokens: 4,
        cacheCreationInputTokens: 3,
      },
      "claude-opus-5": {
        canonicalModel: "claude-opus-5",
        inputTokens: 10,
        outputTokens: 7,
        cacheReadInputTokens: 30,
        cacheCreationInputTokens: 20,
      },
    },
  };
}

async function runWithProcess(process: ModelProcess) {
  const directory = await mkdtemp(join(tmpdir(), "model-execution-case-"));
  const execution = openModelExecution({
    artifactDirectory: directory,
    process,
  });
  try {
    return await execution.run(attemptPlan());
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
}

describe("ModelExecution.run", () => {
  it("returns auth-required without falling back to another model", async () => {
    await expect(
      runWithProcess({
        execute: async () => ({
          kind: "auth-required",
          reason: "provider-session-expired",
        }),
      }),
    ).resolves.toMatchObject({
      status: "auth-required",
      value: {
        status: "auth-required",
        reason: "provider-session-expired",
      },
    });
  });

  it.each([
    {
      name: "wall-time exhaustion",
      process: {
        execute: async () => ({ kind: "timed-out" as const, stderr: "" }),
      },
      status: "budget-exhausted",
      reason: "wall-time-exceeded",
    },
    {
      name: "output exhaustion",
      process: {
        execute: async () => ({
          kind: "output-limit-exceeded" as const,
          stderr: "",
        }),
      },
      status: "budget-exhausted",
      reason: "output-limit-exceeded",
    },
    {
      name: "process crash",
      process: {
        execute: async () => {
          throw new Error("provider process crashed");
        },
      },
      status: "provider-failed",
      reason: "provider process crashed",
    },
    {
      name: "invalid Finder schema",
      process: {
        execute: async () => ({
          kind: "exited" as const,
          exitCode: 0,
          stdout: JSON.stringify(providerEnvelope({ answer: "free text" })),
          stderr: "",
        }),
      },
      status: "invalid-output",
      reason: "invalid-finder-output",
    },
    {
      name: "built-in web use",
      process: {
        execute: async () => ({
          kind: "exited" as const,
          exitCode: 0,
          stdout: JSON.stringify(
            providerEnvelope(
              {
                kind: "finder-output",
                schemaVersion: 1,
                leaseId,
                hypotheses: [],
              },
              1,
            ),
          ),
          stderr: "",
        }),
      },
      status: "policy-denied",
      reason: "tool-free-policy-violated",
    },
  ])("normalizes $name as a typed terminal result", async (testCase) => {
    await expect(runWithProcess(testCase.process)).resolves.toMatchObject({
      status: testCase.status,
      value: { status: testCase.status, reason: testCase.reason },
    });
  });

  it("stores one schema-valid tool-free Finder output as an immutable result", async () => {
    const directory = await mkdtemp(join(tmpdir(), "model-execution-"));
    const output = {
      kind: "finder-output",
      schemaVersion: 1,
      leaseId,
      hypotheses: [candidateHypothesis()],
    };
    const execution = openModelExecution({
      artifactDirectory: directory,
      process: {
        execute: async () => ({
          kind: "exited",
          exitCode: 0,
          stdout: JSON.stringify(providerEnvelope(output)),
          stderr: "",
        }),
      },
    });

    try {
      const result = await execution.run(attemptPlan());

      expect(result).toMatchObject({
        status: "completed",
        ref: {
          kind: "attempt-execution-result",
          schemaVersion: 1,
          attemptId: "attempt-1",
          leaseId,
          digest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
        },
        value: {
          kind: "finder-attempt-result",
          schemaVersion: 1,
          attemptId: "attempt-1",
          leaseId,
          status: "completed",
          output,
          usage: {
            kind: "model-attempt-usage",
            schemaVersion: 1,
            measurement: "reported",
            providerDurationMs: 1_234,
            modelTurns: 2,
            modelTokens: {
              input: 13,
              cacheCreation: 23,
              cacheRead: 34,
              output: 9,
              total: 79,
            },
            source: {
              queries: 0,
              scanBytes: 0,
              responseBytes: 0,
            },
            models: [
              {
                id: "claude-haiku-4-5-20251001",
                canonicalModel: "claude-haiku-4-5",
                tokens: {
                  input: 3,
                  cacheCreation: 3,
                  cacheRead: 4,
                  output: 2,
                  total: 12,
                },
              },
              {
                id: "claude-opus-5",
                canonicalModel: "claude-opus-5",
                tokens: {
                  input: 10,
                  cacheCreation: 20,
                  cacheRead: 30,
                  output: 7,
                  total: 67,
                },
              },
            ],
          },
        },
      });
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it("stores a Root Planner AttemptPlanV2 output with role and plan identity", async () => {
    const fixture = await openSourceEvidenceFixture({
      files: { "synthetic-plugin.php": "<?php\nregister_rest_route();\n" },
      maxReadBytes: 4096,
    });
    const original = rootPlannerAttemptPlan();
    const plan = {
      ...original,
      target: {
        ...fixture.manifest.targetSnapshot,
        pluginSlug: "synthetic-plugin",
        version: "1.0.0",
      },
      manifest: {
        kind: "target-file-manifest" as const,
        schemaVersion: 1 as const,
        targetSnapshotId: fixture.manifest.targetSnapshot.id,
        targetSnapshotDigest: fixture.manifest.targetSnapshot.digest,
        digest: sha256Digest(fixture.manifest),
      },
      sourceToolPolicy: fixture.gateway.policy,
    };
    const output = {
      kind: "root-planner-output",
      schemaVersion: 1,
      theses: [
        {
          kind: "research-thesis-proposal",
          schemaVersion: 1,
          scope: "target-specific",
          securityAssumption:
            "A public REST transition preserves the initiating actor's authority.",
          question:
            "Can public request state be consumed later with greater authority?",
          motivation:
            "Cross-request state can turn an intended public capability into account takeover.",
          startingBasis: "The manifest-bound REST registration entry point.",
          startingEvidence: [
            {
              path: "synthetic-plugin.php",
              fileDigest: fixture.fileDigest("synthetic-plugin.php"),
              startLine: 1,
              endLine: 2,
            },
          ],
          independence:
            "This packet follows actor and state transitions without fixing a sink or file boundary.",
        },
      ],
    };
    let observedPlan: unknown;
    const execution = openModelExecution({
      artifactDirectory: fixture.attemptArtifactDirectory,
      sourceEvidenceGateway: fixture.gateway,
      process: {
        execute: async (request) => {
          observedPlan = request.plan;
          if (request.sourceEvidence === undefined) {
            throw new Error("Root Planner source tools are missing");
          }
          await request.sourceEvidence.query({
            kind: "source-read",
            selector: {
              path: "synthetic-plugin.php",
              fileDigest: fixture.fileDigest("synthetic-plugin.php"),
              startLine: 1,
              endLine: 2,
            },
            reason: "Read the real entry point before creating Focus Packets.",
          });
          return {
            kind: "exited",
            exitCode: 0,
            stdout: JSON.stringify(providerEnvelope(output)),
            stderr: "",
          };
        },
      },
    });

    try {
      const result = await execution.run(plan);

      expect(observedPlan).toEqual(plan);
      expect(result).toMatchObject({
        status: "completed",
        ref: {
          kind: "attempt-execution-result",
          schemaVersion: 2,
          attemptId: plan.attemptId,
          owner: "exploration",
          role: "root-planner",
          planDigest: sha256Digest(plan),
          digest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
        },
        value: {
          kind: "model-attempt-result",
          schemaVersion: 2,
          attemptId: plan.attemptId,
          owner: "exploration",
          role: "root-planner",
          planDigest: sha256Digest(plan),
          status: "completed",
          output,
          sourceEvidenceReceipts: [
            {
              kind: "source-evidence-receipt",
              schemaVersion: 2,
              attemptId: plan.attemptId,
            },
          ],
          usage: {
            kind: "model-attempt-usage",
            schemaVersion: 1,
            measurement: "reported",
            providerDurationMs: 1_234,
            modelTurns: 2,
            modelTokens: {
              input: 13,
              cacheCreation: 23,
              cacheRead: 34,
              output: 9,
              total: 79,
            },
            source: {
              queries: 1,
              scanBytes: 0,
              responseBytes: expect.any(Number),
            },
            models: [
              {
                id: "claude-haiku-4-5-20251001",
                canonicalModel: "claude-haiku-4-5",
                tokens: {
                  input: 3,
                  cacheCreation: 3,
                  cacheRead: 4,
                  output: 2,
                  total: 12,
                },
              },
              {
                id: "claude-opus-5",
                canonicalModel: "claude-opus-5",
                tokens: {
                  input: 10,
                  cacheCreation: 20,
                  cacheRead: 30,
                  output: 7,
                  total: 67,
                },
              },
            ],
          },
        },
      });
    } finally {
      await fixture.close();
    }
  });

  it("rejects a Recon result that did not read manifest-bound source", async () => {
    const fixture = await openSourceEvidenceFixture({
      files: { "synthetic-plugin.php": "<?php\nregister_rest_route();\n" },
      maxReadBytes: 4096,
    });
    const original = rootPlannerAttemptPlan();
    const plan = {
      ...original,
      target: {
        ...fixture.manifest.targetSnapshot,
        pluginSlug: "synthetic-plugin",
        version: "1.0.0",
      },
      manifest: {
        kind: "target-file-manifest" as const,
        schemaVersion: 1 as const,
        targetSnapshotId: fixture.manifest.targetSnapshot.id,
        targetSnapshotDigest: fixture.manifest.targetSnapshot.digest,
        digest: sha256Digest(fixture.manifest),
      },
      sourceToolPolicy: fixture.gateway.policy,
    };
    const execution = openModelExecution({
      artifactDirectory: fixture.attemptArtifactDirectory,
      sourceEvidenceGateway: fixture.gateway,
      process: {
        execute: async () => ({
          kind: "exited",
          exitCode: 0,
          stdout: JSON.stringify(
            providerEnvelope({
              kind: "root-planner-output",
              schemaVersion: 1,
              theses: [],
            }),
          ),
          stderr: "",
        }),
      },
    });

    try {
      await expect(execution.run(plan)).resolves.toMatchObject({
        status: "invalid-output",
        value: {
          status: "invalid-output",
          reason: "recon-source-read-required",
        },
      });
    } finally {
      await fixture.close();
    }
  });

  it("gives the Adversarial Critic source tools and records its fresh read", async () => {
    const fixture = await openSourceEvidenceFixture({
      files: { "synthetic-plugin.php": "<?php\nregister_rest_route();\n" },
      maxReadBytes: 4096,
    });
    const original = adversarialCriticAttemptPlan();
    const plan = {
      ...original,
      target: {
        ...fixture.manifest.targetSnapshot,
        pluginSlug: "synthetic-plugin",
        version: "1.0.0",
      },
      manifest: {
        kind: "target-file-manifest" as const,
        schemaVersion: 1 as const,
        targetSnapshotId: fixture.manifest.targetSnapshot.id,
        targetSnapshotDigest: fixture.manifest.targetSnapshot.digest,
        digest: sha256Digest(fixture.manifest),
      },
      sourceToolPolicy: fixture.gateway.policy,
    };
    const output = {
      kind: "adversarial-critic-output",
      schemaVersion: 1,
      dispositions: [],
    };
    const execution = openModelExecution({
      artifactDirectory: fixture.attemptArtifactDirectory,
      sourceEvidenceGateway: fixture.gateway,
      process: {
        execute: async (request) => {
          if (request.sourceEvidence === undefined) {
            throw new Error("Adversarial Critic source tools are missing");
          }
          await request.sourceEvidence.query({
            kind: "source-read",
            selector: {
              path: "synthetic-plugin.php",
              fileDigest: fixture.fileDigest("synthetic-plugin.php"),
              startLine: 1,
              endLine: 2,
            },
            reason: "Challenge the proposal against the current source.",
          });
          return {
            kind: "exited",
            exitCode: 0,
            stdout: JSON.stringify(providerEnvelope(output)),
            stderr: "",
          };
        },
      },
    });

    try {
      await expect(execution.run(plan)).resolves.toMatchObject({
        status: "completed",
        value: {
          role: "adversarial-critic",
          status: "completed",
          output,
          sourceEvidenceReceipts: [{ attemptId: plan.attemptId }],
          usage: { source: { queries: 1 } },
        },
      });
    } finally {
      await fixture.close();
    }
  });

  it("rejects a Critic result that did not read manifest-bound source", async () => {
    const fixture = await openSourceEvidenceFixture({
      files: { "synthetic-plugin.php": "<?php\nregister_rest_route();\n" },
      maxReadBytes: 4096,
    });
    const original = adversarialCriticAttemptPlan();
    const plan = {
      ...original,
      target: {
        ...fixture.manifest.targetSnapshot,
        pluginSlug: "synthetic-plugin",
        version: "1.0.0",
      },
      manifest: {
        kind: "target-file-manifest" as const,
        schemaVersion: 1 as const,
        targetSnapshotId: fixture.manifest.targetSnapshot.id,
        targetSnapshotDigest: fixture.manifest.targetSnapshot.digest,
        digest: sha256Digest(fixture.manifest),
      },
      sourceToolPolicy: fixture.gateway.policy,
    };
    const execution = openModelExecution({
      artifactDirectory: fixture.attemptArtifactDirectory,
      sourceEvidenceGateway: fixture.gateway,
      process: {
        execute: async (request) => {
          expect(request.sourceEvidence).toBeDefined();
          return {
            kind: "exited",
            exitCode: 0,
            stdout: JSON.stringify(
              providerEnvelope({
                kind: "adversarial-critic-output",
                schemaVersion: 1,
                dispositions: [],
              }),
            ),
            stderr: "",
          };
        },
      },
    });

    try {
      await expect(execution.run(plan)).resolves.toMatchObject({
        status: "invalid-output",
        value: {
          role: "adversarial-critic",
          status: "invalid-output",
          reason: "critic-source-read-required",
        },
      });
    } finally {
      await fixture.close();
    }
  });

  it("rejects a Validator result that did not read manifest-bound source", async () => {
    const fixture = await openSourceEvidenceFixture({
      files: { "synthetic-plugin.php": "<?php\nregister_rest_route();\n" },
      maxReadBytes: 4096,
    });
    const original = validatorAttemptPlan();
    const plan = {
      ...original,
      target: {
        ...fixture.manifest.targetSnapshot,
        pluginSlug: "synthetic-plugin",
        version: "1.0.0",
      },
      manifest: {
        kind: "target-file-manifest" as const,
        schemaVersion: 1 as const,
        targetSnapshotId: fixture.manifest.targetSnapshot.id,
        targetSnapshotDigest: fixture.manifest.targetSnapshot.digest,
        digest: sha256Digest(fixture.manifest),
      },
      sourceToolPolicy: fixture.gateway.policy,
    };
    const execution = openModelExecution({
      artifactDirectory: fixture.attemptArtifactDirectory,
      sourceEvidenceGateway: fixture.gateway,
      process: {
        execute: async (request) => {
          expect(request.sourceEvidence).toBeDefined();
          return {
            kind: "exited",
            exitCode: 0,
            stdout: JSON.stringify(providerEnvelope({ result: "unused" })),
            stderr: "",
          };
        },
      },
    });

    try {
      await expect(execution.run(plan)).resolves.toMatchObject({
        status: "invalid-output",
        value: {
          owner: "validation",
          role: "validator",
          status: "invalid-output",
          reason: "validator-source-read-required",
        },
      });
    } finally {
      await fixture.close();
    }
  });

  it("does not expose source tools to Validation Synthesis", async () => {
    const fixture = await openSourceEvidenceFixture({
      files: { "synthetic-plugin.php": "<?php\nregister_rest_route();\n" },
      maxReadBytes: 4096,
    });
    const plan = validationSynthesisAttemptPlan();
    const output = { result: "tool-free-synthesis" };
    const execution = openModelExecution({
      artifactDirectory: fixture.attemptArtifactDirectory,
      sourceEvidenceGateway: fixture.gateway,
      process: {
        execute: async (request) => {
          expect(request.sourceEvidence).toBeUndefined();
          return {
            kind: "exited",
            exitCode: 0,
            stdout: JSON.stringify(providerEnvelope(output)),
            stderr: "",
          };
        },
      },
    });

    try {
      await expect(execution.run(plan)).resolves.toMatchObject({
        status: "completed",
        value: {
          owner: "validation",
          role: "validation-synthesizer",
          output,
        },
      });
    } finally {
      await fixture.close();
    }
  });

  it("keeps cumulative source response bytes as a hard emergency guardrail", async () => {
    const fixture = await openSourceEvidenceFixture({
      files: { "synthetic-plugin.php": "<?php\nregister_rest_route();\n" },
      maxReadBytes: 4096,
    });
    const original = rootPlannerAttemptPlan();
    const plan = {
      ...original,
      target: {
        ...fixture.manifest.targetSnapshot,
        pluginSlug: "synthetic-plugin",
        version: "1.0.0",
      },
      manifest: {
        kind: "target-file-manifest" as const,
        schemaVersion: 1 as const,
        targetSnapshotId: fixture.manifest.targetSnapshot.id,
        targetSnapshotDigest: fixture.manifest.targetSnapshot.digest,
        digest: sha256Digest(fixture.manifest),
      },
      sourceToolPolicy: fixture.gateway.policy,
      budget: {
        ...original.budget,
        maxSourceResponseBytes: 1,
      },
    };
    const execution = openModelExecution({
      artifactDirectory: fixture.attemptArtifactDirectory,
      sourceEvidenceGateway: fixture.gateway,
      process: {
        execute: async (request) => {
          if (request.sourceEvidence === undefined) {
            throw new Error("Root Planner source tools are missing");
          }
          await request.sourceEvidence.query({
            kind: "source-read",
            selector: {
              path: "synthetic-plugin.php",
              fileDigest: fixture.fileDigest("synthetic-plugin.php"),
              startLine: 1,
              endLine: 2,
            },
            reason: "Exercise the cumulative source response guardrail.",
          });
          return {
            kind: "exited",
            exitCode: 0,
            stdout: JSON.stringify(
              providerEnvelope({
                kind: "root-planner-output",
                schemaVersion: 1,
                theses: [],
              }),
            ),
            stderr: "",
          };
        },
      },
    });

    try {
      await expect(execution.run(plan)).resolves.toMatchObject({
        status: "budget-exhausted",
        value: {
          status: "budget-exhausted",
          reason: "source-tool-budget-exhausted:source-response-limit-exceeded",
          sourceEvidenceReceipts: [{ attemptId: plan.attemptId }],
          usage: { source: { queries: 1 } },
        },
      });
    } finally {
      await fixture.close();
    }
  });

  it("preserves schema-valid v3 terminal output after the source query guardrail stops further reads", async () => {
    const fixture = await openSourceEvidenceFixture({
      files: { "synthetic-plugin.php": "<?php\nregister_rest_route();\n" },
      maxReadBytes: 4096,
      inventoryMaxResults: 8,
    });
    const original = rootPlannerAttemptPlan();
    const plan = {
      ...original,
      target: {
        ...fixture.manifest.targetSnapshot,
        pluginSlug: "synthetic-plugin",
        version: "1.0.0",
      },
      manifest: {
        kind: "target-file-manifest" as const,
        schemaVersion: 1 as const,
        targetSnapshotId: fixture.manifest.targetSnapshot.id,
        targetSnapshotDigest: fixture.manifest.targetSnapshot.digest,
        digest: sha256Digest(fixture.manifest),
      },
      sourceToolPolicy: fixture.gateway.policy,
      budget: {
        ...original.budget,
        maxSourceQueries: 1,
        sourceLimitTerminalOutput: "preserve" as const,
        reportedUsageEnforcement: "telemetry-only" as const,
      },
    };
    const output = {
      kind: "root-planner-output",
      schemaVersion: 1,
      theses: [],
    };
    const execution = openModelExecution({
      artifactDirectory: fixture.attemptArtifactDirectory,
      sourceEvidenceGateway: fixture.gateway,
      process: {
        execute: async (request) => {
          if (request.sourceEvidence === undefined) {
            throw new Error("Root Planner source tools are missing");
          }
          await request.sourceEvidence.query({
            kind: "source-read",
            selector: {
              path: "synthetic-plugin.php",
              fileDigest: fixture.fileDigest("synthetic-plugin.php"),
              startLine: 1,
              endLine: 2,
            },
            reason: "Read source before the emergency query guardrail.",
          });
          await request.sourceEvidence.query({
            kind: "source-list",
            selector: {
              scope: { kind: "root" },
              traversal: "recursive",
            },
            reason: "Exercise the emergency query guardrail.",
          });
          return {
            kind: "exited",
            exitCode: 0,
            stdout: JSON.stringify(providerEnvelope(output)),
            stderr: "",
          };
        },
      },
    });

    try {
      await expect(execution.run(plan)).resolves.toMatchObject({
        status: "completed",
        value: {
          status: "completed",
          output,
          sourceEvidenceReceipts: [
            { attemptId: plan.attemptId },
            { attemptId: plan.attemptId },
          ],
          usage: { source: { queries: 2 } },
        },
      });
    } finally {
      await fixture.close();
    }
  });

  it("records every source receipt allowed by the v3 Finder query budget", async () => {
    const fixture = await openSourceEvidenceFixture({
      files: { "synthetic-plugin.php": "<?php\nregister_rest_route();\n" },
      maxReadBytes: 4096,
      inventoryMaxResults: 8,
    });
    const original = rootPlannerAttemptPlan();
    const plan = {
      ...original,
      target: {
        ...fixture.manifest.targetSnapshot,
        pluginSlug: "synthetic-plugin",
        version: "1.0.0",
      },
      manifest: {
        kind: "target-file-manifest" as const,
        schemaVersion: 1 as const,
        targetSnapshotId: fixture.manifest.targetSnapshot.id,
        targetSnapshotDigest: fixture.manifest.targetSnapshot.digest,
        digest: sha256Digest(fixture.manifest),
      },
      sourceToolPolicy: fixture.gateway.policy,
      budget: {
        ...original.budget,
        maxSourceQueries: 512,
        sourceLimitTerminalOutput: "preserve" as const,
        reportedUsageEnforcement: "telemetry-only" as const,
      },
    };
    const output = {
      kind: "root-planner-output",
      schemaVersion: 1,
      theses: [],
    };
    const execution = openModelExecution({
      artifactDirectory: fixture.attemptArtifactDirectory,
      sourceEvidenceGateway: fixture.gateway,
      process: {
        execute: async (request) => {
          if (request.sourceEvidence === undefined) {
            throw new Error("Root Planner source tools are missing");
          }
          await request.sourceEvidence.query({
            kind: "source-read",
            selector: {
              path: "synthetic-plugin.php",
              fileDigest: fixture.fileDigest("synthetic-plugin.php"),
              startLine: 1,
              endLine: 2,
            },
            reason: "Establish source-bound Recon evidence.",
          });
          for (let query = 1; query < 512; query += 1) {
            await request.sourceEvidence.query({
              kind: "source-list",
              selector: {
                scope: { kind: "root" },
                traversal: "recursive",
              },
              reason: `Exercise v3 source receipt ${query}.`,
            });
          }
          return {
            kind: "exited",
            exitCode: 0,
            stdout: JSON.stringify(providerEnvelope(output)),
            stderr: "",
          };
        },
      },
    });

    try {
      const result = await execution.run(plan);
      expect(result).toMatchObject({
        status: "completed",
        value: {
          status: "completed",
          output,
          usage: { source: { queries: 512 } },
        },
      });
      expect(
        "sourceEvidenceReceipts" in result.value
          ? result.value.sourceEvidenceReceipts
          : undefined,
      ).toHaveLength(512);
    } finally {
      await fixture.close();
    }
  });

  it.each([
    {
      name: "reported model turns",
      maxModelTokens: 100_000,
      maxModelTurns: 1,
      reason: "model-turn-limit-exceeded",
    },
    {
      name: "reported model tokens",
      maxModelTokens: 78,
      maxModelTurns: 4,
      reason: "model-token-limit-exceeded",
    },
  ])("rejects completed v2 output exceeding $name", async (testCase) => {
    const directory = await mkdtemp(join(tmpdir(), "model-budget-v2-"));
    const original = rootEvaluatorAttemptPlan();
    const plan = {
      ...original,
      budget: {
        ...original.budget,
        maxModelTokens: testCase.maxModelTokens,
        maxModelTurns: testCase.maxModelTurns,
      },
    } as unknown as AttemptPlanV2;
    const execution = openModelExecution({
      artifactDirectory: directory,
      process: {
        execute: async () => ({
          kind: "exited",
          exitCode: 0,
          stdout: JSON.stringify(
            providerEnvelope({
              kind: "root-planner-output",
              schemaVersion: 1,
              theses: [],
            }),
          ),
          stderr: "",
        }),
      },
    });

    try {
      await expect(execution.run(plan)).resolves.toMatchObject({
        status: "budget-exhausted",
        value: {
          status: "budget-exhausted",
          reason: testCase.reason,
          usage: {
            modelTurns: 2,
            modelTokens: { total: 79 },
          },
        },
      });
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it("keeps completed v3 research when reported turn and token telemetry exceeds its advisory values", async () => {
    const directory = await mkdtemp(join(tmpdir(), "model-telemetry-v3-"));
    const original = rootEvaluatorAttemptPlan();
    const plan = {
      ...original,
      budget: {
        ...original.budget,
        maxModelTokens: 1,
        maxModelTurns: 1,
        reportedUsageEnforcement: "telemetry-only" as const,
      },
    };
    const execution = openModelExecution({
      artifactDirectory: directory,
      process: {
        execute: async () => ({
          kind: "exited",
          exitCode: 0,
          stdout: JSON.stringify(
            providerEnvelope({
              kind: "root-evaluator-output",
              schemaVersion: 1,
              actions: [],
              campaignDisposition: "continue",
            }),
          ),
          stderr: "",
        }),
      },
    });

    try {
      await expect(execution.run(plan)).resolves.toMatchObject({
        status: "completed",
        value: {
          status: "completed",
          usage: { modelTurns: 2, modelTokens: { total: 79 } },
        },
      });
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it("does not accept v2 output when provider usage is incomplete", async () => {
    const directory = await mkdtemp(join(tmpdir(), "model-usage-v2-"));
    const plan = rootEvaluatorAttemptPlan();
    const output = {
      kind: "root-planner-output",
      schemaVersion: 1,
      theses: [],
    };
    const execution = openModelExecution({
      artifactDirectory: directory,
      process: {
        execute: async () => ({
          kind: "exited",
          exitCode: 0,
          stdout: JSON.stringify({
            ...providerEnvelope(output),
            num_turns: undefined,
          }),
          stderr: "",
        }),
      },
    });

    try {
      await expect(execution.run(plan)).resolves.toMatchObject({
        status: "provider-failed",
        value: {
          status: "provider-failed",
          reason: "provider-usage-incomplete",
          usage: { measurement: "partial" },
        },
      });
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it("preserves a source-bound partial primitive when no complete hypothesis exists", async () => {
    const output = {
      kind: "finder-output",
      schemaVersion: 1,
      leaseId,
      hypotheses: [],
      routeFragments: [candidateRouteFragment()],
    };

    await expect(
      runWithProcess({
        execute: async () => ({
          kind: "exited",
          exitCode: 0,
          stdout: JSON.stringify(providerEnvelope(output)),
          stderr: "",
        }),
      }),
    ).resolves.toMatchObject({
      status: "completed",
      value: { status: "completed", output },
    });
  });

  it("rejects output exceeding the Work Lease hypothesis ceiling", async () => {
    const output = {
      kind: "finder-output",
      schemaVersion: 1,
      leaseId,
      hypotheses: [candidateHypothesis(), candidateHypothesis()],
    };

    await expect(
      runWithProcess({
        execute: async () => ({
          kind: "exited",
          exitCode: 0,
          stdout: JSON.stringify(providerEnvelope(output)),
          stderr: "",
        }),
      }),
    ).resolves.toMatchObject({
      status: "invalid-output",
      value: { reason: "invalid-finder-output" },
    });
  });

  it("applies the Work Lease ceiling to route fragments", async () => {
    const output = {
      kind: "finder-output",
      schemaVersion: 1,
      leaseId,
      hypotheses: [],
      routeFragments: [candidateRouteFragment(), candidateRouteFragment()],
    };

    await expect(
      runWithProcess({
        execute: async () => ({
          kind: "exited",
          exitCode: 0,
          stdout: JSON.stringify(providerEnvelope(output)),
          stderr: "",
        }),
      }),
    ).resolves.toMatchObject({
      status: "invalid-output",
      value: { reason: "invalid-finder-output" },
    });
  });

  it("runs the pinned native Claude process behind the same interface", async () => {
    const directory = await mkdtemp(join(tmpdir(), "claude-process-"));
    const executablePath = join(directory, "fake-claude");
    const output = {
      kind: "finder-output",
      schemaVersion: 1,
      leaseId,
      hypotheses: [],
    };
    const envelope = providerEnvelope(output);
    await writeFile(
      executablePath,
      `#!/bin/sh
if [ "$1" = "--version" ]; then
  printf '%s\\n' '2.1.251 (Claude Code)'
elif [ "$1" = "auth" ] && [ "$2" = "status" ]; then
  printf '%s' '{"loggedIn":true}'
else
  cat >/dev/null
  printf '%s' '${JSON.stringify(envelope)}'
fi
`,
      "utf8",
    );
    await chmod(executablePath, 0o700);
    const execution = openClaudeModelExecution({
      artifactDirectory: join(directory, "artifacts"),
      executablePath,
      executableVersion: "2.1.251",
      workingDirectory: directory,
      processObserver: {
        observe() {
          throw new Error("synthetic observer failure");
        },
      },
    });

    try {
      const result = await execution.run(attemptPlan());

      expect(result).toMatchObject({
        status: "completed",
        value: { status: "completed", output },
      });
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it("runs pinned GLM through the Claude-compatible transport without using Claude OAuth", async () => {
    const directory = await mkdtemp(join(tmpdir(), "glm-process-"));
    const executablePath = join(directory, "fake-claude");
    const tokenFilePath = join(directory, "zai-token");
    const argumentsPath = join(directory, "arguments");
    const promptPath = join(directory, "prompt");
    const output = {
      kind: "root-evaluator-output",
      schemaVersion: 1,
      dispositions: [],
    };
    const envelope = {
      ...providerEnvelope(output),
      result: JSON.stringify(output),
      structured_output: undefined,
      modelUsage: {
        "glm-5.1": {
          canonicalModel: "glm-5.1",
          inputTokens: 10,
          outputTokens: 7,
          cacheReadInputTokens: 30,
          cacheCreationInputTokens: 20,
        },
        "glm-4.5-air": {
          canonicalModel: "glm-4.5-air",
          inputTokens: 1,
          outputTokens: 1,
          cacheReadInputTokens: 0,
          cacheCreationInputTokens: 0,
        },
      },
    };
    await writeFile(tokenFilePath, "synthetic-zai-token\n", {
      encoding: "utf8",
      mode: 0o600,
    });
    await writeFile(
      executablePath,
      `#!/bin/sh
if [ "$1" = "--version" ]; then
  printf '%s\n' '2.1.260 (Claude Code)'
elif [ "$1" = "auth" ]; then
  printf '%s\n' 'Claude OAuth must not be queried for GLM' >&2
  exit 91
else
  [ "$ANTHROPIC_BASE_URL" = "https://api.z.ai/api/anthropic" ] || exit 92
  [ "$ANTHROPIC_AUTH_TOKEN" = "synthetic-zai-token" ] || exit 93
  [ -z "$CLAUDE_CODE_OAUTH_TOKEN" ] || exit 94
  [ -n "$CLAUDE_CONFIG_DIR" ] || exit 95
  [ "$CLAUDE_CONFIG_DIR" != "${process.env.CLAUDE_CONFIG_DIR ?? ""}" ] || exit 96
  [ "$HOME" != "${process.env.HOME ?? ""}" ] || exit 97
  [ "$USERPROFILE" = "$HOME" ] || exit 98
  printf '%s\n' "$@" > '${argumentsPath}'
  cat > '${promptPath}'
  printf '%s' '${JSON.stringify(envelope)}'
fi
`,
      "utf8",
    );
    await chmod(executablePath, 0o700);
    const original = rootEvaluatorAttemptPlan();
    const plan = {
      ...original,
      modelProfile: {
        provider: "zai",
        model: "glm-5.1",
        transport: "claude-code-process",
        executableVersion: "2.1.260",
        effort: "max",
        eligibilityReceiptDigest:
          original.modelProfile.eligibilityReceiptDigest,
      },
    } as Extract<AttemptPlanV2, { role: "root-evaluator" }>;
    const execution = openGlmModelExecution({
      artifactDirectory: join(directory, "artifacts"),
      executablePath,
      executableVersion: "2.1.260",
      workingDirectory: directory,
      tokenFilePath,
    });
    const priorClaudeOauthToken = process.env.CLAUDE_CODE_OAUTH_TOKEN;
    process.env.CLAUDE_CODE_OAUTH_TOKEN = "ambient-claude-token-must-not-leak";

    try {
      const result = await execution.run(plan);
      if (result.status !== "completed") {
        throw new Error(JSON.stringify(result.value));
      }
      expect(result).toMatchObject({
        status: "completed",
        value: { status: "completed", output },
      });
      const args = (await readFile(argumentsPath, "utf8")).split("\n");
      expect(args).toEqual(
        expect.arrayContaining(["--model", "glm-5.1", "--effort", "max"]),
      );
      expect(args).not.toContain("--json-schema");
      expect(await readFile(promptPath, "utf8")).toContain(
        "Return exactly one JSON value matching this schema.",
      );
      await writeFile(
        executablePath,
        `#!/bin/sh
if [ "$1" = "--version" ]; then
  printf '%s\n' '2.1.260 (Claude Code)'
else
  printf '%s' '${JSON.stringify({
    type: "result",
    subtype: "success",
    is_error: true,
    terminal_reason: "api_error",
    api_error_status: 404,
    result: "The pinned provider model is unavailable.",
    modelUsage: {},
  })}'
fi
`,
        "utf8",
      );
      await expect(
        execution.run({ ...plan, attemptId: "glm-provider-error-attempt" }),
      ).resolves.toMatchObject({
        status: "provider-failed",
        value: { status: "provider-failed" },
      });
    } finally {
      if (priorClaudeOauthToken === undefined) {
        delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
      } else {
        process.env.CLAUDE_CODE_OAUTH_TOKEN = priorClaudeOauthToken;
      }
      await rm(directory, { force: true, recursive: true });
    }
  });

  it("rejects a GLM envelope that reports an ambient Anthropic model", () => {
    const output = {
      kind: "root-evaluator-output",
      schemaVersion: 1,
      dispositions: [],
    };
    expect(
      decodeGlmEnvelope(
        JSON.stringify({
          ...providerEnvelope(output),
          modelUsage: {
            "glm-5.1": {
              canonicalModel: "glm-5.1",
              inputTokens: 10,
              outputTokens: 7,
              cacheReadInputTokens: 30,
              cacheCreationInputTokens: 20,
            },
            "claude-haiku-4-5-20251001": {
              canonicalModel: "claude-haiku-4-5",
              inputTokens: 1,
              outputTokens: 1,
              cacheReadInputTokens: 0,
              cacheCreationInputTokens: 0,
            },
          },
        }),
        "glm-5.1",
      ),
    ).toEqual({ kind: "policy-denied", reason: "model-substitution" });
  });

  it("stops GLM as auth-required when its bounded token file is unavailable", async () => {
    const directory = await mkdtemp(join(tmpdir(), "glm-auth-"));
    const executablePath = join(directory, "fake-claude");
    const launchedPath = join(directory, "launched");
    await writeFile(
      executablePath,
      `#!/bin/sh
printf '%s' launched > '${launchedPath}'
exit 99
`,
      "utf8",
    );
    await chmod(executablePath, 0o700);
    const original = rootEvaluatorAttemptPlan();
    const plan = {
      ...original,
      modelProfile: {
        provider: "zai",
        model: "glm-5.1",
        transport: "claude-code-process",
        executableVersion: "2.1.260",
        effort: "max",
        eligibilityReceiptDigest:
          original.modelProfile.eligibilityReceiptDigest,
      },
    } as Extract<AttemptPlanV2, { role: "root-evaluator" }>;
    const execution = openGlmModelExecution({
      artifactDirectory: join(directory, "artifacts"),
      executablePath,
      executableVersion: "2.1.260",
      workingDirectory: directory,
      tokenFilePath: join(directory, "missing-token"),
    });

    try {
      await expect(execution.run(plan)).resolves.toMatchObject({
        status: "auth-required",
        value: {
          status: "auth-required",
          reason: "provider-session-unavailable",
        },
      });
      await expect(readFile(launchedPath, "utf8")).rejects.toMatchObject({
        code: "ENOENT",
      });
      const unsafeTokenPath = join(directory, "unsafe-token");
      await writeFile(unsafeTokenPath, "synthetic-zai-token", "utf8");
      await chmod(unsafeTokenPath, 0o644);
      const unsafeExecution = openGlmModelExecution({
        artifactDirectory: join(directory, "unsafe-artifacts"),
        executablePath,
        executableVersion: "2.1.260",
        workingDirectory: directory,
        tokenFilePath: unsafeTokenPath,
      });
      await expect(unsafeExecution.run(plan)).resolves.toMatchObject({
        status: "auth-required",
        value: {
          status: "auth-required",
          reason: "provider-session-unavailable",
        },
      });
      await expect(readFile(launchedPath, "utf8")).rejects.toMatchObject({
        code: "ENOENT",
      });
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it("runs pinned Grok in isolated homes and normalizes its structured envelope", async () => {
    const directory = await mkdtemp(join(tmpdir(), "grok-process-"));
    const executablePath = join(directory, "fake-grok");
    const sourceHome = join(directory, "source-grok-home");
    const argumentsPath = join(directory, "arguments");
    await mkdir(sourceHome, { recursive: true, mode: 0o700 });
    await writeFile(join(sourceHome, "auth.json"), "synthetic-grok-auth", {
      encoding: "utf8",
      mode: 0o600,
    });
    await writeFile(join(sourceHome, "agent_id"), "synthetic-agent-id", {
      encoding: "utf8",
      mode: 0o600,
    });
    await writeFile(
      join(sourceHome, "config.toml"),
      "[mcp_servers.ambient_must_not_load]\ncommand = 'false'\n",
      "utf8",
    );
    const output = {
      kind: "root-evaluator-output",
      schemaVersion: 1,
      dispositions: [],
    };
    const envelope = {
      text: JSON.stringify(output),
      stopReason: "end_turn",
      sessionId: "synthetic-session",
      requestId: "synthetic-request",
      usage: {
        input_tokens: 100,
        cache_read_input_tokens: 20,
        cache_creation_input_tokens: 0,
        output_tokens: 30,
        reasoning_tokens: 10,
        total_tokens: 150,
      },
      num_turns: 2,
      total_cost_usd: 0.01,
      modelUsage: {
        "grok-4.6-build": {
          inputTokens: 100,
          outputTokens: 30,
          cacheReadInputTokens: 20,
          cacheCreationInputTokens: 0,
          modelCalls: 1,
          costUSD: 0.01,
        },
      },
      structuredOutput: output,
    };
    await writeFile(
      executablePath,
      `#!/bin/sh
if [ "$1" = "--version" ]; then
  printf '%s\n' 'grok 1.0.13 (synthetic)'
else
  [ "$GROK_HOME" != '${sourceHome}' ] || exit 91
  [ "$HOME" != '${process.env.HOME}' ] || exit 92
  [ -f "$GROK_HOME/auth.json" ] || exit 93
  [ ! -f "$GROK_HOME/config.toml" ] || exit 94
  printf '%s\n' "$@" > '${argumentsPath}'
  printf '%s' '${JSON.stringify(envelope)}'
fi
`,
      "utf8",
    );
    await chmod(executablePath, 0o700);
    const original = rootEvaluatorAttemptPlan();
    const plan = {
      ...original,
      modelProfile: {
        provider: "xai",
        model: "grok-4.6",
        transport: "grok-build-process",
        executableVersion: "1.0.13",
        effort: "xhigh",
        eligibilityReceiptDigest:
          original.modelProfile.eligibilityReceiptDigest,
      },
    } as Extract<AttemptPlanV2, { role: "root-evaluator" }>;
    const execution = openGrokModelExecution({
      artifactDirectory: join(directory, "artifacts"),
      executablePath,
      executableVersion: "1.0.13",
      grokHomeDirectory: sourceHome,
    });

    try {
      await expect(execution.run(plan)).resolves.toMatchObject({
        status: "completed",
        value: {
          status: "completed",
          output,
          usage: {
            measurement: "reported",
            modelTurns: 2,
            modelTokens: {
              input: 100,
              cacheRead: 20,
              output: 30,
              total: 150,
            },
          },
        },
      });
      const args = (await readFile(argumentsPath, "utf8")).split("\n");
      expect(args).toEqual(
        expect.arrayContaining([
          "--model",
          "grok-4.6",
          "--reasoning-effort",
          "xhigh",
          "--no-subagents",
          "--disable-web-search",
          "--tools",
          "",
        ]),
      );
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it("stops Grok before launch when its OAuth document is unavailable", async () => {
    const directory = await mkdtemp(join(tmpdir(), "grok-auth-"));
    const executablePath = join(directory, "fake-grok");
    const sourceHome = join(directory, "source-grok-home");
    const launchedPath = join(directory, "launched");
    await mkdir(sourceHome, { recursive: true, mode: 0o700 });
    await writeFile(
      executablePath,
      `#!/bin/sh
printf '%s' launched > '${launchedPath}'
exit 99
`,
      "utf8",
    );
    await chmod(executablePath, 0o700);
    const original = rootEvaluatorAttemptPlan();
    const plan = {
      ...original,
      modelProfile: {
        provider: "xai",
        model: "grok-4.6",
        transport: "grok-build-process",
        executableVersion: "1.0.13",
        effort: "xhigh",
        eligibilityReceiptDigest:
          original.modelProfile.eligibilityReceiptDigest,
      },
    } as Extract<AttemptPlanV2, { role: "root-evaluator" }>;
    const execution = openGrokModelExecution({
      artifactDirectory: join(directory, "artifacts"),
      executablePath,
      executableVersion: "1.0.13",
      grokHomeDirectory: sourceHome,
    });

    try {
      await expect(execution.run(plan)).resolves.toMatchObject({
        status: "auth-required",
        value: {
          status: "auth-required",
          reason: "provider-session-unavailable",
        },
      });
      await expect(readFile(launchedPath, "utf8")).rejects.toMatchObject({
        code: "ENOENT",
      });
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it("gives Grok only the ephemeral Manifest-bound Source Evidence MCP", async () => {
    const fixture = await openSourceEvidenceFixture({
      files: { "synthetic-plugin.php": "<?php\nregister_rest_route();\n" },
      maxReadBytes: 4096,
    });
    const directory = await mkdtemp(join(tmpdir(), "grok-source-bridge-"));
    const executablePath = join(directory, "fake-grok.mjs");
    const sourceHome = join(directory, "source-grok-home");
    await mkdir(sourceHome, { recursive: true, mode: 0o700 });
    await writeFile(join(sourceHome, "auth.json"), "synthetic-grok-auth", {
      encoding: "utf8",
      mode: 0o600,
    });
    const output = {
      kind: "root-planner-output",
      schemaVersion: 1,
      theses: [],
    };
    const envelope = {
      text: JSON.stringify(output),
      stopReason: "end_turn",
      sessionId: "synthetic-session",
      requestId: "synthetic-request",
      usage: {
        input_tokens: 100,
        cache_read_input_tokens: 20,
        cache_creation_input_tokens: 0,
        output_tokens: 30,
        reasoning_tokens: 10,
        total_tokens: 150,
      },
      num_turns: 2,
      total_cost_usd: 0.01,
      modelUsage: {
        "grok-4.6-build": {
          inputTokens: 100,
          outputTokens: 30,
          cacheReadInputTokens: 20,
          cacheCreationInputTokens: 0,
          modelCalls: 1,
          costUSD: 0.01,
        },
      },
      structuredOutput: output,
    };
    await writeFile(
      executablePath,
      `#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const args = process.argv.slice(2);
if (args[0] === "--version") {
  process.stdout.write("grok 1.0.13 (synthetic)\\n");
  process.exit(0);
}
const cwd = args[args.indexOf("--cwd") + 1];
const config = JSON.parse(await readFile(join(cwd, ".mcp.json"), "utf8"));
if (JSON.stringify(Object.keys(config.mcpServers)) !== '["source_evidence"]') {
  process.exit(91);
}
const server = config.mcpServers.source_evidence;
const baseHeaders = {
  ...server.headers,
  accept: "application/json, text/event-stream",
  "content-type": "application/json",
};
const initialized = await fetch(server.url, {
  method: "POST",
  headers: baseHeaders,
  body: JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "synthetic-grok", version: "1" },
    },
  }),
});
await initialized.text();
if (!initialized.ok) process.exit(92);
const called = await fetch(server.url, {
  method: "POST",
  headers: baseHeaders,
  body: JSON.stringify({
    jsonrpc: "2.0",
    id: 2,
    method: "tools/call",
    params: {
      name: "source_read",
      arguments: {
        selector: {
          path: "synthetic-plugin.php",
          fileDigest: "${fixture.fileDigest("synthetic-plugin.php")}",
          startLine: 1,
          endLine: 2
        },
        reason: "Bind the synthetic entry point before planning."
      }
    }
  }),
});
await called.text();
if (!called.ok) process.exit(93);
process.stdout.write(${JSON.stringify(JSON.stringify(envelope))});
`,
      "utf8",
    );
    await chmod(executablePath, 0o700);
    const original = rootPlannerAttemptPlan();
    const plan = {
      ...original,
      target: {
        ...fixture.manifest.targetSnapshot,
        pluginSlug: "synthetic-plugin",
        version: "1.0.0",
      },
      manifest: {
        kind: "target-file-manifest" as const,
        schemaVersion: 1 as const,
        targetSnapshotId: fixture.manifest.targetSnapshot.id,
        targetSnapshotDigest: fixture.manifest.targetSnapshot.digest,
        digest: sha256Digest(fixture.manifest),
      },
      sourceToolPolicy: fixture.gateway.policy,
      modelProfile: {
        provider: "xai",
        model: "grok-4.6",
        transport: "grok-build-process",
        executableVersion: "1.0.13",
        effort: "xhigh",
        eligibilityReceiptDigest:
          original.modelProfile.eligibilityReceiptDigest,
      },
    } as Extract<AttemptPlanV2, { role: "root-planner" }>;
    const execution = openGrokModelExecution({
      artifactDirectory: fixture.attemptArtifactDirectory,
      executablePath,
      executableVersion: "1.0.13",
      grokHomeDirectory: sourceHome,
      sourceEvidenceGateway: fixture.gateway,
    });

    try {
      const result = await execution.run(plan);
      if (result.status !== "completed") {
        throw new Error(JSON.stringify(result.value));
      }
      expect(result).toMatchObject({
        status: "completed",
        value: {
          status: "completed",
          output,
          sourceEvidenceReceipts: [
            expect.objectContaining({
              kind: "source-evidence-receipt",
              schemaVersion: 2,
            }),
          ],
        },
      });
    } finally {
      await Promise.all([
        fixture.close(),
        rm(directory, { force: true, recursive: true }),
      ]);
    }
  });

  it("flushes process lifecycle, heartbeat, and redacted raw segments to a private transcript", async () => {
    const directory = await mkdtemp(join(tmpdir(), "claude-transcript-"));
    const executablePath = join(directory, "fake-claude");
    const transcriptPath = join(directory, "model-transcript.private.jsonl");
    const output = {
      kind: "finder-output",
      schemaVersion: 1,
      leaseId,
      hypotheses: [],
    };
    const envelope = providerEnvelope(output);
    await writeFile(
      executablePath,
      `#!/bin/sh
if [ "$1" = "--version" ]; then
  printf '%s\\n' '2.1.251 (Claude Code)'
elif [ "$1" = "auth" ] && [ "$2" = "status" ]; then
  printf '%s' '{"loggedIn":true}'
else
  cat >/dev/null
  sleep 0.05
  printf '%s' 'provider diagnostic' >&2
  printf '%s' '${JSON.stringify(envelope)}'
fi
`,
      "utf8",
    );
    await chmod(executablePath, 0o700);
    const diagnostics: string[] = [];
    const transcript = openPrivateModelTranscript({
      filePath: transcriptPath,
      onDiagnostic: (message) => diagnostics.push(message),
    });
    const execution = openClaudeModelExecution({
      artifactDirectory: join(directory, "artifacts"),
      executablePath,
      executableVersion: "2.1.251",
      workingDirectory: directory,
      processObserver: transcript.observer,
      processHeartbeatIntervalMs: 10,
    });

    try {
      await expect(execution.run(attemptPlan())).resolves.toMatchObject({
        status: "completed",
      });
      await transcript.close();
      const events = (await readFile(transcriptPath, "utf8"))
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));

      expect(diagnostics).toEqual([]);
      expect(events).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            kind: "model-process-started",
            operationId: attemptPlan().attemptId,
            phase: "inference",
          }),
          expect.objectContaining({
            kind: "model-process-heartbeat",
            operationId: attemptPlan().attemptId,
            phase: "inference",
          }),
          expect.objectContaining({
            kind: "model-process-completed",
            operationId: attemptPlan().attemptId,
            phase: "inference",
            result: expect.objectContaining({
              kind: "exited",
              exitCode: 0,
              stderr: "provider diagnostic",
              stdout: JSON.stringify(envelope),
            }),
          }),
        ]),
      );
    } finally {
      await transcript.close();
      await rm(directory, { force: true, recursive: true });
    }
  });

  it("disables a failing private transcript without throwing into model execution", async () => {
    const directory = await mkdtemp(
      join(tmpdir(), "claude-transcript-failure-"),
    );
    const blockedParent = join(directory, "not-a-directory");
    await writeFile(blockedParent, "synthetic blocker", "utf8");
    const diagnostics: string[] = [];
    const transcript = openPrivateModelTranscript({
      filePath: join(blockedParent, "model-transcript.private.jsonl"),
      onDiagnostic: (message) => diagnostics.push(message),
    });

    try {
      expect(() =>
        transcript.observer.observe({
          kind: "model-process-started",
          schemaVersion: 1,
          operationId: "attempt-observability-failure",
          phase: "inference",
          segmentOrdinal: 2,
          occurredAt: new Date(0).toISOString(),
        }),
      ).not.toThrow();
      await expect(transcript.close()).resolves.toBeUndefined();
      expect(diagnostics).toEqual([
        expect.stringContaining("Private model transcript disabled"),
      ]);
    } finally {
      await transcript.close();
      await rm(directory, { force: true, recursive: true });
    }
  });

  it("passes the declared v2 provider cost ceiling to Claude", async () => {
    const directory = await mkdtemp(join(tmpdir(), "claude-cost-budget-"));
    const executablePath = join(directory, "fake-claude");
    const argumentsPath = join(directory, "arguments");
    const original = rootEvaluatorAttemptPlan();
    const plan = {
      ...original,
      budget: { ...original.budget, maxProviderCostUsd: 2.5 },
    } as unknown as AttemptPlanV2;
    const envelope = providerEnvelope({
      kind: "root-planner-output",
      schemaVersion: 1,
      theses: [],
    });
    await writeFile(
      executablePath,
      `#!/bin/sh
if [ "$1" = "--version" ]; then
  printf '%s\\n' '2.1.251 (Claude Code)'
elif [ "$1" = "auth" ] && [ "$2" = "status" ]; then
  printf '%s' '{"loggedIn":true}'
else
  printf '%s\\n' "$@" > '${argumentsPath}'
  cat >/dev/null
  printf '%s' '${JSON.stringify(envelope)}'
fi
`,
      "utf8",
    );
    await chmod(executablePath, 0o700);
    const execution = openClaudeModelExecution({
      artifactDirectory: join(directory, "artifacts"),
      executablePath,
      executableVersion: "2.1.251",
      workingDirectory: directory,
    });

    try {
      await expect(execution.run(plan)).resolves.toMatchObject({
        status: "completed",
      });
      const args = (await readFile(argumentsPath, "utf8")).split("\n");
      const budgetIndex = args.indexOf("--max-budget-usd");
      expect(args[budgetIndex + 1]).toBe("2.5");
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it("stops before inference when the native Claude session is logged out", async () => {
    const directory = await mkdtemp(join(tmpdir(), "claude-auth-"));
    const executablePath = join(directory, "fake-claude");
    await writeFile(
      executablePath,
      `#!/bin/sh
if [ "$1" = "--version" ]; then
  printf '%s\\n' '2.1.251 (Claude Code)'
elif [ "$1" = "auth" ] && [ "$2" = "status" ]; then
  printf '%s' '{"loggedIn":false}'
else
  printf '%s\\n' 'inference must not run' >&2
  exit 99
fi
`,
      "utf8",
    );
    await chmod(executablePath, 0o700);
    const execution = openClaudeModelExecution({
      artifactDirectory: join(directory, "artifacts"),
      executablePath,
      executableVersion: "2.1.251",
      workingDirectory: directory,
    });

    try {
      await expect(execution.run(attemptPlan())).resolves.toMatchObject({
        status: "auth-required",
        value: {
          status: "auth-required",
          reason: "provider-session-unavailable",
        },
      });
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it.skipIf(process.platform === "win32")(
    "kills the complete native process group when the wall budget expires",
    async () => {
      const directory = await mkdtemp(join(tmpdir(), "claude-timeout-"));
      const executablePath = join(directory, "fake-claude");
      const processIdsPath = join(directory, "process-ids");
      await writeFile(
        executablePath,
        `#!/bin/sh
if [ "$1" = "--version" ]; then
  printf '%s\\n' '2.1.251 (Claude Code)'
elif [ "$1" = "auth" ] && [ "$2" = "status" ]; then
  printf '%s' '{"loggedIn":true}'
else
  (trap '' TERM; sleep 30) >/dev/null 2>&1 &
  printf '%s %s' "$$" "$!" > '${processIdsPath}'
  wait
fi
`,
        "utf8",
      );
      await chmod(executablePath, 0o700);
      const execution = openClaudeModelExecution({
        artifactDirectory: join(directory, "artifacts"),
        executablePath,
        executableVersion: "2.1.251",
        workingDirectory: directory,
      });
      let processGroup = 0;
      let childProcess = 0;

      try {
        const plan = {
          ...attemptPlan(),
          budget: {
            maxWallTimeMs: 100,
            maxOutputBytes: 1_000_000,
            maxHypotheses: 1,
          },
        };
        const result = await execution.run(plan);
        const observedProcessIds = (await readFile(processIdsPath, "utf8"))
          .split(" ")
          .map(Number);
        const observedProcessGroup = observedProcessIds[0];
        const observedChildProcess = observedProcessIds[1];
        if (
          observedProcessIds.length !== 2 ||
          observedProcessGroup === undefined ||
          observedChildProcess === undefined ||
          !Number.isInteger(observedProcessGroup) ||
          !Number.isInteger(observedChildProcess)
        ) {
          throw new Error("Invalid process ID fixture output");
        }
        processGroup = observedProcessGroup;
        childProcess = observedChildProcess;

        expect(result).toMatchObject({ status: "budget-exhausted" });
        expect(() => process.kill(childProcess, 0)).toThrow(
          expect.objectContaining({ code: "ESRCH" }),
        );
      } finally {
        if (processGroup > 0) {
          try {
            process.kill(-processGroup, "SIGKILL");
          } catch {
            // The expected path has already removed the isolated process group.
          }
        }
        await rm(directory, { force: true, recursive: true });
      }
    },
  );

  it("redacts the provider credential before storing a private error artifact", async () => {
    const directory = await mkdtemp(join(tmpdir(), "claude-redaction-"));
    const artifactDirectory = join(directory, "artifacts");
    const executablePath = join(directory, "fake-claude");
    const syntheticCredential = "synthetic-credential-for-redaction-test";
    const originalCredential = process.env.CLAUDE_CODE_OAUTH_TOKEN;
    await writeFile(
      executablePath,
      `#!/bin/sh
if [ "$1" = "--version" ]; then
  printf '%s\\n' '2.1.251 (Claude Code)'
elif [ "$1" = "auth" ] && [ "$2" = "status" ]; then
  printf '%s' '{"loggedIn":true}'
else
  printf '%s' "$CLAUDE_CODE_OAUTH_TOKEN" >&2
  exit 23
fi
`,
      "utf8",
    );
    await chmod(executablePath, 0o700);
    process.env.CLAUDE_CODE_OAUTH_TOKEN = syntheticCredential;
    const execution = openClaudeModelExecution({
      artifactDirectory,
      executablePath,
      executableVersion: "2.1.251",
      workingDirectory: directory,
    });

    try {
      const result = await execution.run(attemptPlan());
      expect(result).toMatchObject({ status: "provider-failed" });
      if (result.value.status === "completed") {
        throw new Error("Expected a terminal provider result");
      }
      const errorArtifact = /sha256:([a-f0-9]{64})$/u.exec(result.value.reason);
      if (errorArtifact?.[1] === undefined) {
        throw new Error("Missing provider error artifact digest");
      }
      const stored = await readFile(
        join(artifactDirectory, `${errorArtifact[1]}.json`),
        "utf8",
      );
      expect(stored).not.toContain(syntheticCredential);
      expect(stored).toContain("[REDACTED]");
    } finally {
      if (originalCredential === undefined) {
        delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
      } else {
        process.env.CLAUDE_CODE_OAUTH_TOKEN = originalCredential;
      }
      await rm(directory, { force: true, recursive: true });
    }
  });

  it("records bounded Claude failure details returned on stdout", async () => {
    const directory = await mkdtemp(join(tmpdir(), "claude-api-error-"));
    const artifactDirectory = join(directory, "artifacts");
    const executablePath = join(directory, "fake-claude");
    const providerError = {
      type: "result",
      is_error: true,
      terminal_reason: "api_error",
      api_error_status: null,
      result: "Request timed out",
    };
    await writeFile(
      executablePath,
      `#!/bin/sh
if [ "$1" = "--version" ]; then
  printf '%s\\n' '2.1.251 (Claude Code)'
elif [ "$1" = "auth" ] && [ "$2" = "status" ]; then
  printf '%s' '{"loggedIn":true}'
else
  cat >/dev/null
  printf '%s' '${JSON.stringify(providerError)}'
  exit 1
fi
`,
      "utf8",
    );
    await chmod(executablePath, 0o700);
    const execution = openClaudeModelExecution({
      artifactDirectory,
      executablePath,
      executableVersion: "2.1.251",
      workingDirectory: directory,
    });

    try {
      const result = await execution.run(attemptPlan());
      expect(result).toMatchObject({ status: "provider-failed" });
      if (result.value.status === "completed") {
        throw new Error("Expected a terminal provider result");
      }
      const errorArtifact = /sha256:([a-f0-9]{64})$/u.exec(result.value.reason);
      if (errorArtifact?.[1] === undefined) {
        throw new Error("Missing provider error artifact digest");
      }
      const stored = JSON.parse(
        await readFile(
          join(artifactDirectory, `${errorArtifact[1]}.json`),
          "utf8",
        ),
      );
      expect(stored).toMatchObject({
        kind: "provider-error-artifact",
        schemaVersion: 1,
        exitCode: 1,
        providerError: {
          terminalReason: "api_error",
          message: "Request timed out",
          apiErrorStatus: null,
        },
      });
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });
});
