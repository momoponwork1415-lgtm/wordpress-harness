import { createHash } from "node:crypto";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { runCli } from "../../src/cli.js";
import { canonicalDigest } from "../../src/infrastructure/canonical-json.js";
import {
  defineAgentRuntimeProfile,
  glmClaudeCodeNativeTransport,
} from "../../src/infrastructure/agent-runtime-profile.js";
import { promptTextDigest } from "../../src/infrastructure/prompt-text.js";
import type { CampaignInput } from "../../src/research/index.js";
import { openResearchCampaigns } from "../../src/research/agent-led/research-campaigns.js";
import { researchEvidenceSummaryFixture } from "../research/support/research-evidence-summary.js";

const digest = (character: string): string => `sha256:${character.repeat(64)}`;

function glmProfile() {
  return defineAgentRuntimeProfile({
    id: "glm-5.3-claude-code-native-v1",
    ...glmClaudeCodeNativeTransport,
    model: "glm-5.3",
    effort: "max",
  });
}

describe("agent-led campaign CLI", () => {
  it("conducts and inspects only the agent-led Campaign interface", async () => {
    const directory = await mkdtemp(join(tmpdir(), "agent-led-cli-"));
    const sourceDirectory = join(directory, "source");
    const dependencyDirectory = join(directory, "wordpress-core");
    const providerConfigDirectory = join(directory, "provider");
    const scratchRootDirectory = join(directory, "scratch");
    await Promise.all([
      mkdir(sourceDirectory),
      mkdir(dependencyDirectory),
      mkdir(providerConfigDirectory),
      mkdir(scratchRootDirectory),
    ]);
    await writeFile(join(sourceDirectory, "plugin.php"), "<?php\n", "utf8");
    await writeFile(
      join(dependencyDirectory, "wp-load.php"),
      "<?php // core\n",
      "utf8",
    );
    const sourceTreeDigest = canonicalDigest({
      kind: "canonical-file-manifest",
      schemaVersion: 1,
      entries: [
        {
          path: "plugin.php",
          digest: `sha256:${createHash("sha256").update("<?php\n").digest("hex")}`,
          size: 6,
        },
      ],
    });
    const dependencyTreeDigest = canonicalDigest({
      kind: "canonical-file-manifest",
      schemaVersion: 1,
      entries: [
        {
          path: "wp-load.php",
          digest: `sha256:${createHash("sha256").update("<?php // core\n").digest("hex")}`,
          size: 14,
        },
      ],
    });
    const researchPrompt = "Research broken security semantics from source.";
    const researchPromptPath = join(directory, "research-prompt.txt");
    await writeFile(researchPromptPath, researchPrompt, "utf8");
    const input: CampaignInput = {
      kind: "agent-led-campaign",
      schemaVersion: 2,
      campaignId: "campaign-cli-agent-led",
      targetSnapshot: {
        id: "example-1.0.0",
        pluginSlug: "example",
        version: "1.0.0",
        digest: digest("a"),
        sourceTree: { digest: sourceTreeDigest, entries: 1, bytes: 6 },
      },
      dependencySnapshots: [
        {
          id: "wordpress-core-7.1",
          mountName: "wordpress",
          version: "7.1",
          digest: digest("9"),
          sourceTree: {
            digest: dependencyTreeDigest,
            entries: 1,
            bytes: 14,
          },
        },
      ],
      promptSet: {
        id: "agent-led-research-v1",
        digest: promptTextDigest(researchPrompt),
      },
      agentRuntimeProfile: glmProfile(),
      permissionProfile: {
        id: "gvisor-source-research-v1",
        digest: digest("c"),
      },
      budgetEnvelope: {
        id: "agent-led-budget-v1",
        maxNativeRuns: 2,
        maxWallTimeMs: 600_000,
        digest: digest("d"),
      },
    };
    const inputPath = join(directory, "campaign.json");
    await writeFile(inputPath, JSON.stringify(input), "utf8");
    const dockerExecutablePath = join(directory, "fake-docker");
    await writeFile(
      dockerExecutablePath,
      `#!/bin/sh
set -eu
if [ "\${1:-}" = "info" ]; then
  printf '%s' '{}'
  exit 0
fi
if [ "\${1:-}" = "image" ]; then
  exit 0
fi
exit 90
`,
      { encoding: "utf8", mode: 0o700 },
    );
    await chmod(dockerExecutablePath, 0o700);
    const databasePath = join(directory, "research.sqlite");
    const output: string[] = [];
    const errors: string[] = [];
    const io = {
      stdout: (text: string) => output.push(text),
      stderr: (text: string) => errors.push(text),
    };

    try {
      const conductExit = await runCli(
        [
          "campaign",
          "conduct",
          "--database",
          databasePath,
          "--input",
          inputPath,
          "--docker",
          dockerExecutablePath,
          "--image",
          digest("f"),
          "--source",
          sourceDirectory,
          "--dependency-source",
          `wordpress=${dependencyDirectory}`,
          "--provider-config",
          providerConfigDirectory,
          "--scratch",
          scratchRootDirectory,
          "--research-prompt",
          researchPromptPath,
        ],
        io,
      );
      const inspectExit = await runCli(
        [
          "campaign",
          "inspect",
          "--database",
          databasePath,
          "--campaign",
          input.campaignId,
        ],
        io,
      );

      expect({ conductExit, inspectExit, errors }).toEqual({
        conductExit: 0,
        inspectExit: 0,
        errors: [],
      });
      expect(JSON.parse(output[0] ?? "null")).toMatchObject({
        kind: "agent-led-campaign-outcome",
        campaignId: input.campaignId,
        status: "incomplete",
      });
      expect(JSON.parse(output[1] ?? "null")).toMatchObject({
        kind: "agent-led-campaign-outcome",
        campaignId: input.campaignId,
        status: "incomplete",
        nativeRuns: [{ terminal: "policy-denied" }],
        coverage: { status: "incomplete" },
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("does not retain the legacy prepare command", async () => {
    const errors: string[] = [];
    const exit = await runCli(["campaign", "prepare"], {
      stdout: () => undefined,
      stderr: (text: string) => errors.push(text),
    });

    expect(exit).toBe(1);
    expect(errors.join("")).toContain(
      "Usage: wordpress-harness campaign <conduct|conduct-approved|review-candidates|inspect>",
    );
  });

  it("submits a digest-bound Human Candidate Review through conduct", async () => {
    const directory = await mkdtemp(join(tmpdir(), "candidate-review-cli-"));
    const sourceDirectory = join(directory, "source");
    const providerConfigDirectory = join(directory, "provider");
    const scratchRootDirectory = join(directory, "scratch");
    await Promise.all([
      mkdir(sourceDirectory),
      mkdir(providerConfigDirectory),
      mkdir(scratchRootDirectory),
    ]);
    await writeFile(join(sourceDirectory, "plugin.php"), "<?php\n", "utf8");
    const sourceTreeDigest = canonicalDigest({
      kind: "canonical-file-manifest",
      schemaVersion: 1,
      entries: [
        {
          path: "plugin.php",
          digest: `sha256:${createHash("sha256").update("<?php\n").digest("hex")}`,
          size: 6,
        },
      ],
    });
    const researchPrompt = "Research broken security semantics from source.";
    const researchPromptPath = join(directory, "research-prompt.txt");
    await writeFile(researchPromptPath, researchPrompt, "utf8");
    const input: CampaignInput = {
      kind: "agent-led-campaign",
      schemaVersion: 2,
      campaignId: "campaign-cli-candidate-review",
      targetSnapshot: {
        id: "example-1.0.0",
        pluginSlug: "example",
        version: "1.0.0",
        digest: digest("a"),
        sourceTree: { digest: sourceTreeDigest, entries: 1, bytes: 6 },
      },
      promptSet: {
        id: "agent-led-research-v1",
        digest: promptTextDigest(researchPrompt),
      },
      agentRuntimeProfile: glmProfile(),
      permissionProfile: { id: "source-only-v1", digest: digest("c") },
      budgetEnvelope: {
        id: "agent-led-budget-v1",
        maxNativeRuns: 3,
        maxWallTimeMs: 600_000,
        digest: digest("d"),
      },
    };
    const databasePath = join(directory, "research.sqlite");
    const campaigns = openResearchCampaigns({
      databasePath,
      runtime: {
        async execute(run) {
          if (run.kind !== "sealed-native-research-run") {
            throw new Error("initial setup only runs Research");
          }
          return {
            schemaVersion: 2,
            runId: run.runId,
            runtimeProfileDigest: run.agentRuntimeProfile.digest,
            terminal: "completed",
            startedAt: "2026-09-09T01:00:00.000Z",
            completedAt: "2026-09-09T01:01:00.000Z",
            usage: { wallTimeMs: 60_000 },
            activity: { subagents: 1, tools: ["source.read"] },
            isolation: {
              backend: "gvisor",
              runtime: "runsc",
              fallbackUsed: false,
            },
            checkpoint: {
              kind: "agent-checkpoint",
              schemaVersion: 1,
              checkpointId: `${run.runId}:checkpoint`,
              stateDigest: digest("1"),
              stateEntries: 1,
              stateBytes: 1,
              sessionId: "12121212-1212-4121-8121-121212121212",
              targetSnapshotDigest: run.targetSnapshot.digest,
              promptSetDigest: run.promptSet.digest,
              runtimeProfileDigest: run.agentRuntimeProfile.digest,
              permissionProfileDigest: run.permissionProfile.digest,
            },
            report: {
              schemaVersion: 2,
              assessments: [],
              evidenceSummary: researchEvidenceSummaryFixture(),
              candidates: [
                {
                  candidateId: "candidate-cli-review-1",
                  attackerPremise:
                    "An unauthenticated visitor controls a request value.",
                  brokenSecurityProperty:
                    "Public input must not cross an admin trust boundary.",
                  claim:
                    "A public value reaches privileged output without escaping.",
                  evidence: [
                    {
                      path: "plugin.php",
                      location: "render:10",
                      observation: "Outputs the request value.",
                    },
                  ],
                  sourceTrace: [
                    {
                      role: "entrypoint",
                      path: "plugin.php",
                      location: "render:10",
                      observation:
                        "A public request supplies the rendered value.",
                    },
                    {
                      role: "effect",
                      path: "plugin.php",
                      location: "render:10",
                      observation:
                        "The request value reaches privileged output.",
                    },
                  ],
                  controlAssessments: [
                    {
                      control: "Output escaping",
                      evidence: [
                        {
                          path: "plugin.php",
                          location: "render:10",
                          observation:
                            "The value is output without an escaping operation.",
                        },
                      ],
                      conclusion:
                        "No source-visible escaping prevents the claimed output effect.",
                    },
                  ],
                  unresolvedFacts: [],
                },
              ],
              decision: {
                kind: "stop",
                basis: "No separate frontier remains.",
              },
            },
          };
        },
      },
    });
    await campaigns.conduct(input);
    const request = (await campaigns.inspect({ campaignId: input.campaignId }))
      .pendingCandidateReview;
    campaigns.close();
    if (request === undefined) throw new Error("missing review request");
    const reviewBody = {
      kind: "human-candidate-review" as const,
      schemaVersion: 1 as const,
      reviewId: "review-cli-1",
      campaignId: input.campaignId,
      campaignInputDigest: request.campaignInputDigest,
      terminalResearchRunId: request.terminalResearchRunId,
      candidateSetDigest: request.candidateSetDigest,
      candidateReviewRequestDigest: request.digest,
      operator: {
        identity: "human-operator-1",
        decidedAt: "2026-09-09T01:02:00.000Z",
      },
      decisions: [
        {
          candidateId: "candidate-cli-review-1",
          disposition: "advance-to-candidate-verification" as const,
          reason: "The trust-boundary impact warrants runtime verification.",
        },
      ],
    };
    const reviewPath = join(directory, "candidate-review.json");
    await writeFile(
      reviewPath,
      JSON.stringify({ ...reviewBody, digest: canonicalDigest(reviewBody) }),
      "utf8",
    );
    const dockerExecutablePath = join(directory, "fake-docker");
    await writeFile(
      dockerExecutablePath,
      `#!/bin/sh
set -eu
if [ "\${1:-}" = "info" ]; then
  printf '%s' '{}'
  exit 0
fi
if [ "\${1:-}" = "image" ]; then
  exit 0
fi
exit 90
`,
      { encoding: "utf8", mode: 0o700 },
    );
    await chmod(dockerExecutablePath, 0o700);
    const output: string[] = [];
    const errors: string[] = [];
    const io = {
      stdout: (text: string) => output.push(text),
      stderr: (text: string) => errors.push(text),
    };

    try {
      const exit = await runCli(
        [
          "campaign",
          "review-candidates",
          "--database",
          databasePath,
          "--review",
          reviewPath,
          "--docker",
          dockerExecutablePath,
          "--image",
          digest("f"),
          "--source",
          sourceDirectory,
          "--provider-config",
          providerConfigDirectory,
          "--scratch",
          scratchRootDirectory,
          "--research-prompt",
          researchPromptPath,
        ],
        io,
      );
      expect({ exit, errors }).toEqual({ exit: 0, errors: [] });
      expect(JSON.parse(output[0] ?? "null")).toMatchObject({
        campaignId: input.campaignId,
        status: "verification-preparation-needed",
      });
      const recorded = openResearchCampaigns({
        databasePath,
        runtime: { execute: () => Promise.reject(new Error("inspect only")) },
      });
      const failedView = await recorded.inspect({
        campaignId: input.campaignId,
      });
      expect(failedView).toMatchObject({
        candidateReviews: [{ reviewId: "review-cli-1" }],
      });
      recorded.close();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
