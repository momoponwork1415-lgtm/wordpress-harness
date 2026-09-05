import {
  chmod,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  openClaudeModelExecution,
  type AttemptPlan,
  type AttemptPlanV2,
  type ModelProcessObservation,
} from "../../src/research/model-execution/index.js";
import { sha256Digest } from "../../src/research/research-record/canonical-json.js";
import {
  openSourceEvidenceFixture,
  type SourceEvidenceFixture,
} from "../fixtures/source-evidence.js";

const leaseId = `sha256:${"b".repeat(64)}`;

function attemptPlan(fixture: SourceEvidenceFixture): AttemptPlan {
  return {
    kind: "attempt-plan",
    schemaVersion: 1,
    attemptId: "attempt-claude-source-tools",
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
    prompt: "Trace the dispatcher through the admitted source tools.",
    sourceToolPolicy: fixture.gateway.policy,
    budget: {
      maxWallTimeMs: 60_000,
      maxOutputBytes: 1_000_000,
      maxHypotheses: 1,
      maxSourceQueries: 4,
    },
  };
}

function attemptPlanV2(
  fixture: SourceEvidenceFixture,
  assignmentKind: "research-thesis" | "frontier-gap" = "research-thesis",
): Extract<AttemptPlanV2, { role: "finder" }> {
  const manifestDigest = sha256Digest(fixture.manifest);
  return {
    kind: "attempt-plan",
    schemaVersion: 2,
    attemptId: "attempt-claude-source-tools-v2",
    owner: "exploration",
    role: "finder",
    target: {
      ...fixture.manifest.targetSnapshot,
      pluginSlug: "synthetic-plugin",
      version: "1.0.0",
    },
    manifest: {
      kind: "target-file-manifest",
      schemaVersion: 1,
      targetSnapshotId: fixture.manifest.targetSnapshot.id,
      targetSnapshotDigest: fixture.manifest.targetSnapshot.digest,
      digest: manifestDigest,
    },
    assignment:
      assignmentKind === "research-thesis"
        ? {
            kind: "research-thesis",
            schemaVersion: 1,
            workWaveId: `sha256:${"1".repeat(64)}`,
            leaseId,
            thesis: {
              kind: "research-thesis",
              schemaVersion: 1,
              id: `sha256:${"2".repeat(64)}`,
              digest: `sha256:${"3".repeat(64)}`,
              targetSnapshotDigest: fixture.manifest.targetSnapshot.digest,
              manifestDigest,
            },
          }
        : {
            kind: "frontier-gap",
            schemaVersion: 1,
            workWaveId: `sha256:${"1".repeat(64)}`,
            leaseId,
            gapId: `sha256:${"2".repeat(64)}`,
            predecessorDecisionDigest: `sha256:${"3".repeat(64)}`,
          },
    promptSet: {
      id: "research-prompts-v2",
      digest: `sha256:${"4".repeat(64)}`,
    },
    modelProfile: {
      provider: "anthropic",
      model: "claude-opus-5",
      transport: "claude-code-process",
      executableVersion: "2.1.258",
      effort: "high",
      eligibilityReceiptDigest: `sha256:${"d".repeat(64)}`,
    },
    prompt: "Trace the dispatcher through the admitted v2 source tools.",
    outputJsonSchema: {
      type: "object",
      properties: {
        kind: { const: "finder-output" },
        schemaVersion: { const: 2 },
        leaseId: { const: leaseId },
        hypotheses: { type: "array", items: { type: "object" } },
        routeFragments: { type: "array", items: { type: "object" } },
        frontierGaps: { type: "array", items: { type: "object" } },
      },
      required: [
        "kind",
        "schemaVersion",
        "leaseId",
        "hypotheses",
        "routeFragments",
        "frontierGaps",
      ],
      additionalProperties: false,
    },
    sourceToolPolicy: fixture.gateway.policy,
    budget: {
      maxWallTimeMs: 60_000,
      maxModelTokens: 100_000,
      maxModelTurns: 10,
      maxProviderCostUsd: 2.5,
      maxOutputBytes: 1_000_000,
      maxSourceQueries: 8,
    },
  };
}

function fakeClaudeSource(): string {
  return `#!/usr/bin/env node
const args = process.argv.slice(2);
if (args[0] === "--version") {
  require("node:fs").writeSync(1, "2.1.258 (Claude Code)\\n");
  process.exit(0);
}
if (args[0] === "auth" && args[1] === "status") {
  require("node:fs").writeSync(1, JSON.stringify({ loggedIn: true }));
  process.exit(0);
}

const configIndex = args.indexOf("--mcp-config");
if (configIndex < 0 || args[configIndex + 1] === undefined) {
  process.stderr.write("missing explicit MCP configuration");
  process.exit(20);
}
const configLocation = args[configIndex + 1];
const config = JSON.parse(
  configLocation.startsWith("{")
    ? configLocation
    : require("node:fs").readFileSync(configLocation, "utf8"),
);
const names = Object.keys(config.mcpServers ?? {});
if (names.length !== 1 || names[0] !== "source_evidence") {
  process.stderr.write("unexpected MCP server manifest");
  process.exit(21);
}
const endpoint = config.mcpServers.source_evidence.url;
const authorization = config.mcpServers.source_evidence.headers?.Authorization;
let protocolVersion;

async function rpc(message) {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...(authorization === undefined ? {} : { authorization }),
      ...(protocolVersion === undefined
        ? {}
        : { "mcp-protocol-version": protocolVersion }),
    },
    body: JSON.stringify(message),
  });
  const body = await response.text();
  if (!response.ok) throw new Error("MCP HTTP " + response.status + ": " + body);
  if (message.id === undefined) return undefined;
  const payload = response.headers.get("content-type")?.includes("text/event-stream")
    ? body.split(/\\r?\\n/).filter((line) => line.startsWith("data: ")).map((line) => line.slice(6)).at(-1)
    : body;
  if (payload === undefined || payload.length === 0) throw new Error("missing MCP response");
  return JSON.parse(payload);
}

async function runInference() {
try {
  for await (const _chunk of process.stdin) {
    // The fake provider only needs to consume the prompt before returning.
  }
  const initialized = await rpc({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "fake-claude", version: "1.0.0" },
    },
  });
  protocolVersion = initialized.result.protocolVersion;
  await rpc({ jsonrpc: "2.0", method: "notifications/initialized" });

  const listed = await rpc({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
  const toolNames = listed.result.tools.map((tool) => tool.name).sort();
  if (JSON.stringify(toolNames) !== JSON.stringify(["source_list", "source_read", "source_search"])) {
    throw new Error("unexpected tool list: " + JSON.stringify(toolNames));
  }

  const inventory = await rpc({
    jsonrpc: "2.0",
    id: 20,
    method: "tools/call",
    params: {
      name: "source_list",
      arguments: {
        prefix: "includes/",
        reason: "Find security-relevant components outside the initial map seed.",
      },
    },
  });
  const inventoryEvidence = JSON.parse(inventory.result.content[0].text);
  if (!inventoryEvidence.response.files.some((file) => file.path === "includes/wrapper.php")) {
    throw new Error("wrapper absent from source inventory");
  }

  const searched = await rpc({
    jsonrpc: "2.0",
    id: 3,
    method: "tools/call",
    params: {
      name: "source_search",
      arguments: {
        literal: "custom_db_query",
        desiredRelation: "definition",
        reason: "Find the wrapper definition referenced by the dispatcher.",
      },
    },
  });
  const searchEvidence = JSON.parse(searched.result.content[0].text);
  const wrapper = searchEvidence.response.matches.find(
    (match) => match.anchor.path === "includes/wrapper.php",
  );
  if (wrapper === undefined) throw new Error("wrapper not found");

  const read = await rpc({
    jsonrpc: "2.0",
    id: 4,
    method: "tools/call",
    params: {
      name: "source_read",
      arguments: {
        path: wrapper.anchor.path,
        fileDigest: wrapper.anchor.fileDigest,
        startLine: 1,
        endLine: 4,
        desiredRelation: "callee",
        reason: "Read the wrapper body and identify its database terminal.",
      },
    },
  });
  const readEvidence = JSON.parse(read.result.content[0].text);
  if (!readEvidence.response.content.includes("get_results")) {
    throw new Error("wrapper terminal was not returned");
  }

  require("node:fs").writeSync(1, JSON.stringify({
    type: "result",
    subtype: "success",
    is_error: false,
    terminal_reason: "completed",
    duration_ms: 50,
    num_turns: 4,
    structured_output: {
      kind: "finder-output",
      schemaVersion: 1,
      leaseId: "${leaseId}",
      hypotheses: [],
    },
    permission_denials: [],
    usage: { server_tool_use: { web_search_requests: 0, web_fetch_requests: 0 } },
    subagent_stats: { spawned: 0 },
    modelUsage: {
      "claude-opus-5": {
        canonicalModel: "claude-opus-5",
        inputTokens: 10,
        outputTokens: 10,
        cacheReadInputTokens: 10,
        cacheCreationInputTokens: 10,
      },
    },
  }));
} catch (error) {
  process.stderr.write(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exit(22);
}
}
void runInference();
`;
}

function fakeClaudeSourceV2(): string {
  return fakeClaudeSource()
    .replace(
      'prefix: "includes/",',
      'selector: { scope: { kind: "directory", path: "includes" }, traversal: "recursive" },',
    )
    .replace(
      "inventoryEvidence.response.files.some",
      "inventoryEvidence.response.entries.some",
    )
    .replace(
      `literal: "custom_db_query",
        desiredRelation: "definition",`,
      `selector: { literal: "custom_db_query", scope: { kind: "root" } },`,
    )
    .replace(
      `path: wrapper.anchor.path,
        fileDigest: wrapper.anchor.fileDigest,
        startLine: 1,
        endLine: 4,
        desiredRelation: "callee",`,
      `selector: {
          path: wrapper.anchor.path,
          fileDigest: wrapper.anchor.fileDigest,
          startLine: 1,
          endLine: 4,
        },`,
    );
}

function fakeClaudeEscapeV2(): string {
  return fakeClaudeSourceV2()
    .replace("path: wrapper.anchor.path,", 'path: "../outside.php",')
    .replace(
      'if (!readEvidence.response.content.includes("get_results")) {',
      'if (readEvidence.status !== "policy-denied") {',
    );
}

function fakeClaudeIdentityMismatchV2(): string {
  return fakeClaudeSourceV2()
    .replace(
      "fileDigest: wrapper.anchor.fileDigest,",
      `fileDigest: "sha256:${"f".repeat(64)}",`,
    )
    .replace(
      'if (!readEvidence.response.content.includes("get_results")) {',
      'if (readEvidence.status !== "identity-mismatch") {',
    );
}

function fakeClaudeInvalidQueryThenRecoversV2(): string {
  return fakeClaudeSourceV2().replace(
    "  const inventory = await rpc({",
    `  const invalidInventory = await rpc({
    jsonrpc: "2.0",
    id: 19,
    method: "tools/call",
    params: {
      name: "source_list",
      arguments: {
        selector: { scope: { kind: "directory", path: "includes" }, traversal: "recursive" },
        cursor: "stale-model-supplied-cursor",
        reason: "Mistakenly supplied both a fresh selector and a continuation cursor.",
      },
    },
  });
  const invalidInventoryEvidence = JSON.parse(invalidInventory.result.content[0].text);
  if (invalidInventoryEvidence.status !== "invalid-query") {
    throw new Error("expected a recoverable invalid query result");
  }

  const inventory = await rpc({`,
  );
}

function fakeClaudeCheckpointThenFailV2(): string {
  return fakeClaudeSourceV2()
    .replace(
      '["source_list", "source_read", "source_search"]',
      '["checkpoint_research", "source_list", "source_read", "source_search"]',
    )
    .replace(
      `  require("node:fs").writeSync(1, JSON.stringify({
    type: "result",`,
      `  const checkpoint = await rpc({
    jsonrpc: "2.0",
    id: 30,
    method: "tools/call",
    params: {
      name: "checkpoint_research",
      arguments: {
        subject: {
          kind: "frontier-gap-proposal",
          schemaVersion: 1,
          requiredFact: "Determine whether the public callback crosses an authorization boundary.",
          sourceEvidence: [{
            path: wrapper.anchor.path,
            fileDigest: wrapper.anchor.fileDigest,
            startLine: 1,
            endLine: 4,
          }],
          falsifier: "The callback is unreachable to the permitted attacker.",
          nextAction: "Independently re-derive callback registration and its guard.",
        },
      },
    },
  });
  const checkpointAck = JSON.parse(checkpoint.result.content[0].text);
  if (checkpointAck.checkpoint.kind !== "finder-checkpoint") {
    throw new Error("checkpoint was not durably acknowledged");
  }
  process.stderr.write("simulated transport loss after checkpoint");
  process.exit(23);
  require("node:fs").writeSync(1, JSON.stringify({
    type: "result",`,
    );
}

function fakeClaudeTransientResumeV2(auditPath: string): string {
  const audit = JSON.stringify(auditPath);
  const failureSource = `  require("node:fs").writeSync(1, JSON.stringify({
    type: "result",
    is_error: true,
    terminal_reason: "api_error",
    api_error_status: 500,
    result: "transient upstream failure",
    duration_ms: 25,
    num_turns: 4,
    total_cost_usd: 0.2,
    modelUsage: {
      "claude-opus-5": {
        canonicalModel: "claude-opus-5",
        inputTokens: 20,
        outputTokens: 5,
        cacheReadInputTokens: 10,
        cacheCreationInputTokens: 5,
      },
    },
  }));
  process.exit(1);`;
  return fakeClaudeCheckpointThenFailV2()
    .replace(
      `  const initialized = await rpc({`,
      `  const resumeIndex = args.indexOf("--resume");
  const sessionIndex = args.indexOf("--session-id");
  const budgetIndex = args.indexOf("--max-budget-usd");
  require("node:fs").appendFileSync(${audit}, JSON.stringify({
    resume: resumeIndex < 0 ? null : args[resumeIndex + 1],
    session: sessionIndex < 0 ? null : args[sessionIndex + 1],
    budget: budgetIndex < 0 ? null : Number(args[budgetIndex + 1]),
    configDirectory: process.env.CLAUDE_CONFIG_DIR ?? null,
  }) + "\\n");
  if (resumeIndex >= 0) {
    require("node:fs").writeSync(1, JSON.stringify({
      type: "result",
      subtype: "success",
      is_error: false,
      terminal_reason: "completed",
      duration_ms: 30,
      num_turns: 2,
      total_cost_usd: 0.3,
      structured_output: {
        kind: "finder-output",
        schemaVersion: 2,
        leaseId: "${leaseId}",
        hypotheses: [],
        routeFragments: [],
        frontierGaps: [],
      },
      permission_denials: [],
      usage: { server_tool_use: { web_search_requests: 0, web_fetch_requests: 0 } },
      subagent_stats: { spawned: 0 },
      modelUsage: {
        "claude-opus-5": {
          canonicalModel: "claude-opus-5",
          inputTokens: 30,
          outputTokens: 10,
          cacheReadInputTokens: 20,
          cacheCreationInputTokens: 5,
        },
      },
    }));
    return;
  }
  if (sessionIndex < 0) throw new Error("initial session id missing");
  const initialized = await rpc({`,
    )
    .replace(
      `  process.stderr.write("simulated transport loss after checkpoint");
  process.exit(23);`,
      failureSource,
    );
}

describe("ModelExecution.run Claude source evidence bridge", () => {
  it("resumes a usage-reported transient failure in the same ephemeral session", async () => {
    const fixture = await openSourceEvidenceFixture({
      files: {
        "includes/dispatcher.php": "<?php\ncustom_db_query();\n",
        "includes/wrapper.php":
          "<?php\nfunction custom_db_query($id) {\n  return $GLOBALS['wpdb']->get_results('SELECT ' . $id);\n}\n",
      },
      search: { maxScanBytes: 4096, maxResults: 8 },
      inventoryMaxResults: 64,
    });
    const directory = await mkdtemp(join(tmpdir(), "claude-resume-v2-"));
    const executablePath = join(directory, "fake-claude");
    const auditPath = join(directory, "resume-audit.jsonl");
    const configSource = join(directory, "claude-config-source");
    await mkdir(configSource, { recursive: true });
    await writeFile(
      join(configSource, ".credentials.json"),
      JSON.stringify({ synthetic: true }),
      { encoding: "utf8", mode: 0o600 },
    );
    await writeFile(
      executablePath,
      fakeClaudeTransientResumeV2(auditPath),
      "utf8",
    );
    await chmod(executablePath, 0o700);
    const execution = openClaudeModelExecution({
      artifactDirectory: fixture.attemptArtifactDirectory,
      executablePath,
      executableVersion: "2.1.258",
      workingDirectory: directory,
      sourceEvidenceGateway: fixture.gateway,
      maxTransientResumeAttempts: 1,
      claudeConfigDirectory: configSource,
    });
    const checkpoints: unknown[] = [];

    try {
      const result = await execution.run(attemptPlanV2(fixture), {
        checkpoint: async (subject) => {
          checkpoints.push(subject);
          return {
            kind: "finder-checkpoint",
            schemaVersion: 1,
            id: `sha256:${"7".repeat(64)}`,
            digest: `sha256:${"6".repeat(64)}`,
          };
        },
      });
      const audit = (await readFile(auditPath, "utf8"))
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line) as Record<string, unknown>);

      expect(result).toMatchObject({
        status: "completed",
        value: {
          status: "completed",
          usage: {
            measurement: "reported",
            estimatedCostUsd: 0.5,
            modelTurns: 6,
            modelTokens: { total: 105 },
          },
        },
      });
      expect(checkpoints).toHaveLength(1);
      expect(audit).toHaveLength(2);
      expect(audit[0]).toMatchObject({ resume: null, budget: 2.5 });
      expect(audit[1]).toMatchObject({ session: null, budget: 2.3 });
      expect(audit[1]?.resume).toBe(audit[0]?.session);
      expect(audit[0]?.configDirectory).toBe(audit[1]?.configDirectory);
      await expect(
        stat(String(audit[0]?.configDirectory)),
      ).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await Promise.all([
        fixture.close(),
        rm(directory, { force: true, recursive: true }),
      ]);
    }
  });

  it("does not resume a transient failure whose provider cost is unknown", async () => {
    const fixture = await openSourceEvidenceFixture({
      files: {
        "includes/dispatcher.php": "<?php\ncustom_db_query();\n",
        "includes/wrapper.php":
          "<?php\nfunction custom_db_query($id) {\n  return $GLOBALS['wpdb']->get_results('SELECT ' . $id);\n}\n",
      },
      search: { maxScanBytes: 4096, maxResults: 8 },
      inventoryMaxResults: 64,
    });
    const directory = await mkdtemp(join(tmpdir(), "claude-resume-v2-"));
    const executablePath = join(directory, "fake-claude");
    const auditPath = join(directory, "resume-audit.jsonl");
    const configSource = join(directory, "claude-config-source");
    await mkdir(configSource, { recursive: true });
    await writeFile(
      join(configSource, ".credentials.json"),
      JSON.stringify({ synthetic: true }),
      { encoding: "utf8", mode: 0o600 },
    );
    await writeFile(
      executablePath,
      fakeClaudeTransientResumeV2(auditPath).replace(
        "    total_cost_usd: 0.2,\n",
        "",
      ),
      "utf8",
    );
    await chmod(executablePath, 0o700);
    const execution = openClaudeModelExecution({
      artifactDirectory: fixture.attemptArtifactDirectory,
      executablePath,
      executableVersion: "2.1.258",
      workingDirectory: directory,
      sourceEvidenceGateway: fixture.gateway,
      maxTransientResumeAttempts: 1,
      claudeConfigDirectory: configSource,
    });
    const checkpoints: unknown[] = [];

    try {
      const result = await execution.run(attemptPlanV2(fixture), {
        checkpoint: async (subject) => {
          checkpoints.push(subject);
          return {
            kind: "finder-checkpoint",
            schemaVersion: 1,
            id: `sha256:${"7".repeat(64)}`,
            digest: `sha256:${"6".repeat(64)}`,
          };
        },
      });
      const audit = (await readFile(auditPath, "utf8"))
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line) as Record<string, unknown>);

      expect(result).toMatchObject({
        status: "provider-failed",
        value: { status: "provider-failed" },
      });
      expect(checkpoints).toHaveLength(1);
      expect(audit).toHaveLength(1);
      await expect(
        stat(String(audit[0]?.configDirectory)),
      ).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await Promise.all([
        fixture.close(),
        rm(directory, { force: true, recursive: true }),
      ]);
    }
  });

  it("keeps a Finder checkpoint observable when the provider fails before terminal output", async () => {
    const fixture = await openSourceEvidenceFixture({
      files: {
        "includes/dispatcher.php": "<?php\ncustom_db_query();\n",
        "includes/wrapper.php":
          "<?php\nfunction custom_db_query($id) {\n  return $GLOBALS['wpdb']->get_results('SELECT ' . $id);\n}\n",
      },
      search: { maxScanBytes: 4096, maxResults: 8 },
      inventoryMaxResults: 64,
    });
    const directory = await mkdtemp(join(tmpdir(), "claude-checkpoint-v2-"));
    const executablePath = join(directory, "fake-claude");
    await writeFile(executablePath, fakeClaudeCheckpointThenFailV2(), "utf8");
    await chmod(executablePath, 0o700);
    const execution = openClaudeModelExecution({
      artifactDirectory: fixture.attemptArtifactDirectory,
      executablePath,
      executableVersion: "2.1.258",
      workingDirectory: directory,
      sourceEvidenceGateway: fixture.gateway,
    });
    const checkpoints: unknown[] = [];

    try {
      const result = await execution.run(attemptPlanV2(fixture), {
        checkpoint: async (subject) => {
          checkpoints.push(subject);
          return {
            kind: "finder-checkpoint",
            schemaVersion: 1,
            id: `sha256:${"9".repeat(64)}`,
            digest: `sha256:${"8".repeat(64)}`,
          };
        },
      });
      expect(result).toMatchObject({
        status: "provider-failed",
        value: {
          status: "provider-failed",
          reason: expect.stringContaining("provider-exit-23"),
        },
      });
      expect(checkpoints).toMatchObject([
        {
          kind: "frontier-gap-proposal",
          schemaVersion: 1,
          sourceEvidence: [{ path: "includes/wrapper.php" }],
        },
      ]);
    } finally {
      await Promise.all([
        fixture.close(),
        rm(directory, { force: true, recursive: true }),
      ]);
    }
  });

  it.each(["research-thesis", "frontier-gap"] as const)(
    "runs a %s Finder AttemptPlanV2 through only the v2 List, Search, and Read tools",
    async (assignmentKind) => {
      const fixture = await openSourceEvidenceFixture({
        files: {
          "includes/dispatcher.php":
            "<?php\nreturn custom_db_query($_POST['id']);\n",
          "includes/wrapper.php":
            "<?php\nfunction custom_db_query($id) {\n  return $GLOBALS['wpdb']->get_results('SELECT ' . $id);\n}\n",
        },
        search: { maxScanBytes: 4096, maxResults: 8 },
        inventoryMaxResults: 64,
      });
      const directory = await mkdtemp(join(tmpdir(), "claude-source-v2-"));
      const executablePath = join(directory, "fake-claude");
      await writeFile(executablePath, fakeClaudeSourceV2(), "utf8");
      await chmod(executablePath, 0o700);
      const observations: ModelProcessObservation[] = [];
      const execution = openClaudeModelExecution({
        artifactDirectory: fixture.attemptArtifactDirectory,
        executablePath,
        executableVersion: "2.1.258",
        workingDirectory: directory,
        sourceEvidenceGateway: fixture.gateway,
        processObserver: {
          observe: (event) => observations.push(event),
        },
      });
      const plan = attemptPlanV2(fixture, assignmentKind);

      try {
        const result = await execution.run(plan);
        expect(result).toMatchObject({
          status: "completed",
          ref: {
            schemaVersion: 2,
            attemptId: plan.attemptId,
            role: "finder",
            planDigest: sha256Digest(plan),
          },
          value: {
            status: "completed",
            output: { kind: "finder-output", leaseId, hypotheses: [] },
          },
        });
        expect(
          result.value.schemaVersion === 2
            ? result.value.sourceEvidenceReceipts
            : undefined,
        ).toHaveLength(3);
        expect(result.value.schemaVersion).toBe(2);
        if (result.value.schemaVersion !== 2) {
          throw new Error("Expected a v2 Model Attempt result");
        }
        expect(result.value.usage).toMatchObject({
          measurement: "reported",
          source: { queries: 3 },
        });
        expect(result.value.usage?.source.scanBytes).toBeGreaterThan(0);
        expect(result.value.usage?.source.responseBytes).toBeGreaterThan(0);
        expect(
          observations
            .filter(
              (event) =>
                event.kind === "model-tool-started" ||
                event.kind === "model-tool-completed",
            )
            .map((event) => [event.kind, event.toolName, event.toolOrdinal]),
        ).toEqual([
          ["model-tool-started", "source_list", 1],
          ["model-tool-completed", "source_list", 1],
          ["model-tool-started", "source_search", 2],
          ["model-tool-completed", "source_search", 2],
          ["model-tool-started", "source_read", 3],
          ["model-tool-completed", "source_read", 3],
        ]);
        expect(observations).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              kind: "model-tool-completed",
              operationId: plan.attemptId,
              phase: "inference",
              toolName: "source_read",
              resultStatus: "completed",
              receiptDigest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
            }),
          ]),
        );
      } finally {
        await Promise.all([
          fixture.close(),
          rm(directory, { force: true, recursive: true }),
        ]);
      }
    },
  );

  it("turns a v2 path escape into a distinct policy terminal with a durable Tool Receipt", async () => {
    const fixture = await openSourceEvidenceFixture({
      files: {
        "includes/dispatcher.php": "<?php\ncustom_db_query();\n",
        "includes/wrapper.php":
          "<?php\nfunction custom_db_query() { return true; }\n",
      },
      search: { maxScanBytes: 4096, maxResults: 8 },
      inventoryMaxResults: 64,
    });
    const directory = await mkdtemp(join(tmpdir(), "claude-source-deny-v2-"));
    const executablePath = join(directory, "fake-claude");
    await writeFile(executablePath, fakeClaudeEscapeV2(), "utf8");
    await chmod(executablePath, 0o700);
    const execution = openClaudeModelExecution({
      artifactDirectory: fixture.attemptArtifactDirectory,
      executablePath,
      executableVersion: "2.1.258",
      workingDirectory: directory,
      sourceEvidenceGateway: fixture.gateway,
    });

    try {
      const result = await execution.run(attemptPlanV2(fixture));
      expect(result).toMatchObject({
        status: "policy-denied",
        value: {
          status: "policy-denied",
          reason: "source-tool-policy-denied:path-outside-snapshot",
        },
      });
      expect(
        result.value.schemaVersion === 2
          ? result.value.sourceEvidenceReceipts
          : undefined,
      ).toHaveLength(3);
      expect(result.value.schemaVersion).toBe(2);
      if (result.value.schemaVersion !== 2) {
        throw new Error("Expected a v2 Model Attempt result");
      }
      expect(result.value.usage).toMatchObject({
        measurement: "reported",
        source: { queries: 3 },
      });
      expect(result.value.usage?.source.scanBytes).toBeGreaterThan(0);
      expect(result.value.usage?.source.responseBytes).toBeGreaterThan(0);
      const artifacts = await Promise.all(
        (await readdir(fixture.artifactDirectory)).map(async (name) =>
          JSON.parse(
            await readFile(join(fixture.artifactDirectory, name), "utf8"),
          ),
        ),
      );
      expect(artifacts).toContainEqual(
        expect.objectContaining({
          kind: "source-evidence-receipt",
          schemaVersion: 2,
          attemptId: "attempt-claude-source-tools-v2",
          assignment: expect.objectContaining({
            leaseId,
            thesis: expect.objectContaining({
              manifestDigest: sha256Digest(fixture.manifest),
            }),
          }),
          targetSnapshot: fixture.manifest.targetSnapshot,
          manifest: expect.objectContaining({
            digest: sha256Digest(fixture.manifest),
          }),
          policy: fixture.gateway.policy,
          queryOrdinal: 3,
          result: {
            status: "policy-denied",
            reason: "path-outside-snapshot",
          },
        }),
      );
    } finally {
      await Promise.all([
        fixture.close(),
        rm(directory, { force: true, recursive: true }),
      ]);
    }
  });

  it("keeps a recoverable v2 file identity mismatch as evidence without discarding the Finder output", async () => {
    const fixture = await openSourceEvidenceFixture({
      files: {
        "includes/dispatcher.php":
          "<?php\nreturn custom_db_query($_POST['id']);\n",
        "includes/wrapper.php":
          "<?php\nfunction custom_db_query($id) {\n  return $GLOBALS['wpdb']->get_results('SELECT ' . $id);\n}\n",
      },
      search: { maxScanBytes: 4096, maxResults: 8 },
      inventoryMaxResults: 64,
    });
    const directory = await mkdtemp(join(tmpdir(), "claude-identity-v2-"));
    const executablePath = join(directory, "fake-claude");
    await writeFile(executablePath, fakeClaudeIdentityMismatchV2(), "utf8");
    await chmod(executablePath, 0o700);
    const execution = openClaudeModelExecution({
      artifactDirectory: fixture.attemptArtifactDirectory,
      executablePath,
      executableVersion: "2.1.258",
      workingDirectory: directory,
      sourceEvidenceGateway: fixture.gateway,
    });

    try {
      const result = await execution.run(attemptPlanV2(fixture));
      expect(result).toMatchObject({
        status: "completed",
        value: {
          status: "completed",
          output: { kind: "finder-output", leaseId, hypotheses: [] },
          sourceEvidenceReceipts: [{}, {}, {}],
        },
      });
    } finally {
      await fixture.close();
      await rm(directory, { force: true, recursive: true });
    }
  });

  it("keeps a recoverable v2 invalid query as evidence and lets the Finder correct it", async () => {
    const fixture = await openSourceEvidenceFixture({
      files: {
        "includes/dispatcher.php":
          "<?php\nreturn custom_db_query($_POST['id']);\n",
        "includes/wrapper.php":
          "<?php\nfunction custom_db_query($id) {\n  return $GLOBALS['wpdb']->get_results('SELECT ' . $id);\n}\n",
      },
      search: { maxScanBytes: 4096, maxResults: 8 },
      inventoryMaxResults: 64,
    });
    const directory = await mkdtemp(join(tmpdir(), "claude-invalid-v2-"));
    const executablePath = join(directory, "fake-claude");
    await writeFile(
      executablePath,
      fakeClaudeInvalidQueryThenRecoversV2(),
      "utf8",
    );
    await chmod(executablePath, 0o700);
    const execution = openClaudeModelExecution({
      artifactDirectory: fixture.attemptArtifactDirectory,
      executablePath,
      executableVersion: "2.1.258",
      workingDirectory: directory,
      sourceEvidenceGateway: fixture.gateway,
    });

    try {
      const result = await execution.run(attemptPlanV2(fixture));
      expect(result).toMatchObject({
        status: "completed",
        value: {
          status: "completed",
          output: { kind: "finder-output", leaseId, hypotheses: [] },
          sourceEvidenceReceipts: [{}, {}, {}, {}],
          usage: { source: { queries: 4 } },
        },
      });
      const receipts = (
        await Promise.all(
          (await readdir(fixture.artifactDirectory)).map(async (name) =>
            JSON.parse(
              await readFile(join(fixture.artifactDirectory, name), "utf8"),
            ),
          ),
        )
      )
        .filter(
          (artifact) =>
            artifact.kind === "source-evidence-receipt" &&
            artifact.schemaVersion === 2 &&
            artifact.attemptId === "attempt-claude-source-tools-v2",
        )
        .sort((left, right) => left.queryOrdinal - right.queryOrdinal);
      expect(receipts.map((receipt) => receipt.result)).toEqual([
        { status: "invalid-query", reason: "selector-cursor-conflict" },
        expect.objectContaining({ status: "completed" }),
        expect.objectContaining({ status: "completed" }),
        expect.objectContaining({ status: "completed" }),
      ]);
    } finally {
      await Promise.all([
        fixture.close(),
        rm(directory, { force: true, recursive: true }),
      ]);
    }
  });

  it("lets the native Claude adapter discover and call only bounded source tools", async () => {
    const fixture = await openSourceEvidenceFixture({
      files: {
        "includes/dispatcher.php": [
          "<?php",
          "function dispatch_request() {",
          "  return custom_db_query($_POST['id']);",
          "}",
          "",
        ].join("\n"),
        "includes/wrapper.php": [
          "<?php",
          "function custom_db_query($id) {",
          "  return $GLOBALS['wpdb']->get_results('SELECT ' . $id);",
          "}",
          "",
        ].join("\n"),
      },
      search: { maxScanBytes: 4096, maxResults: 8 },
      inventoryMaxResults: 64,
    });
    const directory = await mkdtemp(join(tmpdir(), "claude-source-bridge-"));
    const executablePath = join(directory, "fake-claude");
    await writeFile(executablePath, fakeClaudeSource(), "utf8");
    await chmod(executablePath, 0o700);
    const execution = openClaudeModelExecution({
      artifactDirectory: fixture.attemptArtifactDirectory,
      executablePath,
      executableVersion: "2.1.258",
      workingDirectory: directory,
      sourceEvidenceGateway: fixture.gateway,
    });

    try {
      const result = await execution.run(attemptPlan(fixture));
      if (result.status !== "completed") {
        throw new Error(JSON.stringify(result.value));
      }
      expect(result).toMatchObject({
        status: "completed",
        value: {
          status: "completed",
          output: { kind: "finder-output", hypotheses: [] },
          usage: {
            measurement: "reported",
            source: { queries: 3 },
          },
        },
      });
      expect(result.value.usage?.source.scanBytes).toBeGreaterThan(0);
      expect(result.value.usage?.source.responseBytes).toBeGreaterThan(0);
    } finally {
      await Promise.all([
        fixture.close(),
        rm(directory, { force: true, recursive: true }),
      ]);
    }
  });

  it("fails closed when Claude returns without connecting the required source bridge", async () => {
    const fixture = await openSourceEvidenceFixture({
      files: { "entry.php": "<?php\nreturn custom_db_query();\n" },
      search: { maxScanBytes: 4096, maxResults: 8 },
    });
    const directory = await mkdtemp(join(tmpdir(), "claude-source-missing-"));
    const executablePath = join(directory, "fake-claude");
    const envelope = {
      type: "result",
      subtype: "success",
      is_error: false,
      terminal_reason: "completed",
      structured_output: {
        kind: "finder-output",
        schemaVersion: 1,
        leaseId,
        hypotheses: [],
      },
      permission_denials: [],
      usage: {
        server_tool_use: { web_search_requests: 0, web_fetch_requests: 0 },
      },
      subagent_stats: { spawned: 0 },
      modelUsage: {
        "claude-opus-5": { canonicalModel: "claude-opus-5" },
      },
    };
    await writeFile(
      executablePath,
      `#!/bin/sh
if [ "$1" = "--version" ]; then
  printf '%s\\n' '2.1.258 (Claude Code)'
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
      artifactDirectory: fixture.attemptArtifactDirectory,
      executablePath,
      executableVersion: "2.1.258",
      workingDirectory: directory,
      sourceEvidenceGateway: fixture.gateway,
    });

    try {
      await expect(execution.run(attemptPlan(fixture))).resolves.toMatchObject({
        status: "policy-denied",
        value: {
          status: "policy-denied",
          reason: "source-evidence-bridge-not-connected",
        },
      });
      await expect(
        execution.run(attemptPlanV2(fixture)),
      ).resolves.toMatchObject({
        status: "policy-denied",
        value: {
          status: "policy-denied",
          reason: "source-evidence-bridge-not-connected",
        },
      });
    } finally {
      await Promise.all([
        fixture.close(),
        rm(directory, { force: true, recursive: true }),
      ]);
    }
  });

  it.skipIf(process.env.RUN_CLAUDE_SOURCE_BRIDGE_LIVE !== "1")(
    "connects the installed subscription-authenticated Claude CLI",
    async () => {
      const executablePath = process.env.CLAUDE_LIVE_EXECUTABLE;
      const executableVersion = process.env.CLAUDE_LIVE_VERSION;
      if (executablePath === undefined || executableVersion === undefined) {
        throw new Error(
          "CLAUDE_LIVE_EXECUTABLE and CLAUDE_LIVE_VERSION are required for the live probe",
        );
      }
      const fixture = await openSourceEvidenceFixture({
        files: {
          "includes/dispatcher.php":
            "<?php\nreturn custom_db_query($_POST['id']);\n",
          "includes/wrapper.php":
            "<?php\nfunction custom_db_query($id) {\n  return $GLOBALS['wpdb']->get_results('SELECT ' . $id);\n}\n",
        },
        search: { maxScanBytes: 4096, maxResults: 8 },
      });
      const directory = await mkdtemp(join(tmpdir(), "claude-source-live-"));
      const basePlan = attemptPlanV2(fixture);
      const plan = {
        ...basePlan,
        modelProfile: {
          ...basePlan.modelProfile,
          executableVersion,
        },
        prompt: [
          "This is a synthetic transport capability probe, not a vulnerability assessment.",
          "Use source_search for the exact literal custom_db_query.",
          "Use source_read with the returned path and digest to read the wrapper body.",
          `Then return a finder-output with schemaVersion 2, leaseId ${leaseId}, and empty hypotheses, routeFragments, and frontierGaps arrays.`,
        ].join("\n"),
        budget: {
          maxWallTimeMs: 300_000,
          maxModelTokens: 100_000,
          maxModelTurns: 6,
          maxProviderCostUsd: 2.5,
          maxOutputBytes: 1_000_000,
          maxSourceQueries: 4,
        },
      } satisfies Extract<AttemptPlanV2, { role: "finder" }>;
      const execution = openClaudeModelExecution({
        artifactDirectory: fixture.attemptArtifactDirectory,
        executablePath,
        executableVersion,
        workingDirectory: directory,
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
            output: {
              kind: "finder-output",
              schemaVersion: 2,
              hypotheses: [],
              routeFragments: [],
              frontierGaps: [],
            },
            sourceEvidenceReceipts: [{}, {}],
          },
        });
      } finally {
        await Promise.all([
          fixture.close(),
          rm(directory, { force: true, recursive: true }),
        ]);
      }
    },
    330_000,
  );
});
