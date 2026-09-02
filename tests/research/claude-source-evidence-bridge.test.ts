import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  openClaudeModelExecution,
  type AttemptPlan,
} from "../../src/research/model-execution/index.js";
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
    structured_output: {
      kind: "finder-output",
      schemaVersion: 1,
      leaseId: "${leaseId}",
      hypotheses: [],
    },
    permission_denials: [],
    usage: { server_tool_use: { web_search_requests: 0, web_fetch_requests: 0 } },
    subagent_stats: { spawned: 0 },
    modelUsage: { "claude-opus-5": { canonicalModel: "claude-opus-5" } },
  }));
} catch (error) {
  process.stderr.write(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exit(22);
}
}
void runInference();
`;
}

describe("ModelExecution.run Claude source evidence bridge", () => {
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
        },
      });
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
      if (executablePath === undefined) {
        throw new Error(
          "CLAUDE_LIVE_EXECUTABLE is required for the live probe",
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
      const plan = {
        ...attemptPlan(fixture),
        prompt: [
          "This is a synthetic transport capability probe, not a vulnerability assessment.",
          "Use source_search for the exact literal custom_db_query.",
          "Use source_read with the returned path and digest to read the wrapper body.",
          `Then return a finder-output with leaseId ${leaseId} and an empty hypotheses array.`,
        ].join("\n"),
        budget: {
          maxWallTimeMs: 300_000,
          maxOutputBytes: 1_000_000,
          maxHypotheses: 1,
          maxSourceQueries: 4,
        },
      } satisfies AttemptPlan;
      const execution = openClaudeModelExecution({
        artifactDirectory: fixture.attemptArtifactDirectory,
        executablePath,
        executableVersion: "2.1.258",
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
            output: { kind: "finder-output", hypotheses: [] },
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
