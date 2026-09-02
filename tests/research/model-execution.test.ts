import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { sha256Digest } from "../../src/research/research-record/canonical-json.js";
import {
  openClaudeModelExecution,
  openModelExecution,
  type AttemptPlan,
  type ModelProcess,
} from "../../src/research/model-execution/index.js";

const leaseId = sha256Digest("finder-lease");
const anchorNodeId = sha256Digest("entry-node");

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
      anchorNodeId,
      nodeIds: [anchorNodeId],
      relationIds: [],
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

function providerEnvelope(
  structuredOutput: unknown,
  webSearchRequests = 0,
): object {
  return {
    type: "result",
    subtype: "success",
    is_error: false,
    terminal_reason: "completed",
    structured_output: structuredOutput,
    permission_denials: [],
    usage: {
      server_tool_use: {
        web_search_requests: webSearchRequests,
        web_fetch_requests: 0,
      },
    },
    subagent_stats: { spawned: 0 },
    modelUsage: {
      "claude-opus-5": { canonicalModel: "claude-opus-5" },
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
        },
      });
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
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
