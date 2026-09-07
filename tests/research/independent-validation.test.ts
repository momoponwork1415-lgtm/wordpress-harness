import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  openResearchCampaigns,
  type CampaignInput,
  type NativeAgentReceipt,
  type SealedAgentRun,
} from "../../src/research/index.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

function campaignInput(campaignId: string, maxNativeRuns = 2): CampaignInput {
  return {
    kind: "agent-led-campaign",
    schemaVersion: 1,
    campaignId,
    targetSnapshot: {
      id: "target-public-form-1.0.0",
      pluginSlug: "public-form",
      version: "1.0.0",
      digest:
        "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    },
    promptSet: {
      id: "agent-led-research-v1",
      digest:
        "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    },
    validationPromptSet: {
      id: "independent-validation-v1",
      digest:
        "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
    },
    agentRuntimeProfile: {
      id: "scripted-agent-v1",
      kind: "scripted-native-agent/v1",
      executableVersion: "1.0.0",
      model: "scripted-model",
      effort: "high",
      digest:
        "sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
    },
    permissionProfile: {
      id: "source-only-v1",
      digest:
        "sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
    },
    budgetEnvelope: {
      id: "campaign-budget-v1",
      maxNativeRuns,
      maxWallTimeMs: 600_000,
      maxEstimatedCostUsd: 10,
      digest:
        "sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
    },
  };
}

function researchReceipt(
  run: Extract<SealedAgentRun, { readonly kind: "sealed-native-research-run" }>,
  decision: "stop" | "continue",
): NativeAgentReceipt {
  return {
    schemaVersion: 1,
    runId: run.runId,
    runtimeProfileDigest: run.agentRuntimeProfile.digest,
    terminal: "completed",
    startedAt: "2026-09-07T12:00:00.000Z",
    completedAt: "2026-09-07T12:01:00.000Z",
    usage: { wallTimeMs: 60_000 },
    activity: { subagents: 1, tools: ["source.read"] },
    report: {
      schemaVersion: 1,
      candidates: [
        {
          candidateId: "candidate-public-output-1",
          attackerPremise:
            "An unauthenticated visitor can submit the public form.",
          brokenSecurityProperty:
            "Persisted attacker input must be inert in privileged output.",
          claim:
            "A public request value is persisted and later rendered to an administrator without escaping.",
          evidence: [
            {
              path: "public/save.php",
              location: "save_value:44",
              observation: "Persists an unauthenticated request value.",
            },
          ],
        },
      ],
      decision:
        decision === "stop"
          ? {
              kind: "stop",
              basis: "No separate actionable frontier remains.",
            }
          : {
              kind: "continue",
              reason: "A separate authorization boundary remains unresolved.",
              nextActions: [
                {
                  question: "Can a subscriber reach the bulk action?",
                  sourcePointers: ["admin/bulk.php"],
                },
              ],
            },
    },
  };
}

describe("Independent Validation", () => {
  it("records a source contradiction as disproven without creating a Finding", async () => {
    const directory = await mkdtemp(join(tmpdir(), "validation-disproven-"));
    temporaryDirectories.push(directory);
    const input = campaignInput("campaign-disproven-1");
    const campaigns = openResearchCampaigns({
      databasePath: join(directory, "agent-led.sqlite"),
      runtime: {
        async execute(run) {
          if (run.kind === "sealed-native-research-run") {
            return researchReceipt(run, "stop");
          }
          return {
            schemaVersion: 1,
            runId: run.runId,
            runtimeProfileDigest: run.agentRuntimeProfile.digest,
            terminal: "completed",
            startedAt: "2026-09-07T12:01:00.000Z",
            completedAt: "2026-09-07T12:02:00.000Z",
            usage: { wallTimeMs: 60_000 },
            activity: { subagents: 0, tools: ["source.read"] },
            report: {
              schemaVersion: 1,
              candidateId: run.candidate.candidateId,
              disposition: "disproven",
              reason:
                "The registered renderer applies context-appropriate escaping to this exact value.",
              evidence: [
                {
                  path: "admin/view.php",
                  location: "render_value:88",
                  observation:
                    "The output is passed through esc_html immediately before emission.",
                },
              ],
            },
          };
        },
      },
    });

    await campaigns.conduct(input);
    await expect(
      campaigns.inspect({ campaignId: input.campaignId }),
    ).resolves.toMatchObject({
      coverage: { status: "closed" },
      validationRuns: [{ receipt: { report: { disposition: "disproven" } } }],
      findings: [],
    });
    campaigns.close();
  });

  it("keeps a Validation provider failure incomplete", async () => {
    const directory = await mkdtemp(join(tmpdir(), "validation-failed-"));
    temporaryDirectories.push(directory);
    const input = campaignInput("campaign-validation-failed-1");
    const campaigns = openResearchCampaigns({
      databasePath: join(directory, "agent-led.sqlite"),
      runtime: {
        async execute(run) {
          if (run.kind === "sealed-native-research-run") {
            return researchReceipt(run, "stop");
          }
          throw new Error("synthetic validator outage");
        },
      },
      clock: () => new Date("2026-09-07T13:00:00.000Z"),
    });

    await campaigns.conduct(input);
    await expect(
      campaigns.inspect({ campaignId: input.campaignId }),
    ).resolves.toMatchObject({
      status: "incomplete",
      coverage: { status: "incomplete" },
      validationRuns: [
        {
          receipt: {
            terminal: "provider-failed",
            failure: {
              summary:
                "Native Agent Runtime failed before returning a Validation receipt.",
            },
          },
        },
      ],
      findings: [],
    });
    campaigns.close();
  });

  it("preserves a Finding while separate Research work is incomplete", async () => {
    const directory = await mkdtemp(join(tmpdir(), "finding-open-coverage-"));
    temporaryDirectories.push(directory);
    const input = campaignInput("campaign-finding-open-coverage-1");
    const campaigns = openResearchCampaigns({
      databasePath: join(directory, "agent-led.sqlite"),
      runtime: {
        async execute(run) {
          if (run.kind === "sealed-native-research-run") {
            return researchReceipt(run, "continue");
          }
          return {
            schemaVersion: 1,
            runId: run.runId,
            runtimeProfileDigest: run.agentRuntimeProfile.digest,
            terminal: "completed",
            startedAt: "2026-09-07T12:01:00.000Z",
            completedAt: "2026-09-07T12:02:00.000Z",
            usage: { wallTimeMs: 60_000 },
            activity: { subagents: 1, tools: ["source.read"] },
            report: {
              schemaVersion: 1,
              candidateId: run.candidate.candidateId,
              disposition: "source-validated",
              reason:
                "The public write and unescaped privileged render are independently source-supported.",
              evidence: [
                {
                  path: "admin/view.php",
                  location: "render_value:88",
                  observation:
                    "The persisted public value is emitted without output escaping.",
                },
              ],
            },
          };
        },
      },
    });

    await campaigns.conduct(input);
    await expect(
      campaigns.inspect({ campaignId: input.campaignId }),
    ).resolves.toMatchObject({
      status: "incomplete",
      coverage: { status: "incomplete" },
      interruption: { reason: "budget-exhausted" },
      findings: [
        {
          candidateId: "candidate-public-output-1",
          assurance: "source-validated",
        },
      ],
    });
    campaigns.close();
  });

  it("records changed evidence under a reused Candidate identity as invalid output", async () => {
    const directory = await mkdtemp(join(tmpdir(), "candidate-reused-"));
    temporaryDirectories.push(directory);
    const input = campaignInput("campaign-candidate-reused-1", 3);
    let researchRuns = 0;
    const campaigns = openResearchCampaigns({
      databasePath: join(directory, "agent-led.sqlite"),
      runtime: {
        async execute(run) {
          if (run.kind === "sealed-native-validation-run") {
            return {
              schemaVersion: 1,
              runId: run.runId,
              runtimeProfileDigest: run.agentRuntimeProfile.digest,
              terminal: "completed",
              startedAt: "2026-09-07T14:01:00.000Z",
              completedAt: "2026-09-07T14:02:00.000Z",
              usage: { wallTimeMs: 60_000 },
              activity: { subagents: 0, tools: ["source.read"] },
              report: {
                schemaVersion: 1,
                candidateId: run.candidate.candidateId,
                disposition: "disproven",
                reason: "The claimed renderer escapes the persisted value.",
                evidence: [
                  {
                    path: "admin/view.php",
                    location: "render_value:88",
                    observation: "Applies esc_html immediately before output.",
                  },
                ],
              },
            };
          }
          researchRuns += 1;
          const receipt = researchReceipt(
            run,
            researchRuns === 1 ? "continue" : "stop",
          );
          if (
            researchRuns === 2 &&
            receipt.terminal === "completed" &&
            "candidates" in receipt.report
          ) {
            const candidate = receipt.report.candidates[0];
            if (candidate === undefined) throw new Error("missing candidate");
            return {
              ...receipt,
              report: {
                ...receipt.report,
                candidates: [
                  {
                    ...candidate,
                    claim:
                      "The same identity now names a materially different source claim.",
                  },
                ],
              },
            };
          }
          return receipt;
        },
      },
    });

    await expect(campaigns.conduct(input)).resolves.toMatchObject({
      status: "incomplete",
    });
    await expect(
      campaigns.inspect({ campaignId: input.campaignId }),
    ).resolves.toMatchObject({
      nativeRuns: [
        { terminal: "completed" },
        {
          terminal: "invalid-output",
          failure: {
            summary:
              "Native Agent Runtime reused a Candidate identity with different evidence.",
          },
        },
      ],
    });
    campaigns.close();
  });
});
