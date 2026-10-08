import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { defineAgentRuntimeProfile } from "../../src/infrastructure/agent-runtime-profile.js";
import { canonicalDigest } from "../../src/infrastructure/canonical-json.js";
import type { CampaignInput } from "../../src/research/index.js";
import type { SealedNativeRun } from "../../src/research/agent-led/contracts.js";
import { openResearchCampaigns } from "../../src/research/agent-led/research-campaigns.js";
import { conductWithHumanAdvance } from "./support/candidate-review.js";
import { researchEvidenceSummaryFixture } from "./support/research-evidence-summary.js";

const temporaryDirectories: string[] = [];
const digest = (character: string): string => `sha256:${character.repeat(64)}`;

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

function inputFor(campaignId: string, withBoundary = true): CampaignInput {
  const boundaryBody = {
    kind: "programme-research-boundary" as const,
    schemaVersion: 1 as const,
    id: "wordfence-bounty-scope-v1",
    programmeIdentity: "programme:wordfence",
    checkedAt: "2026-09-09T00:00:00.000Z",
    eligibleAttackerPositions: [
      "Unauthenticated visitor, Subscriber, or Customer.",
    ],
    priorityImpacts: [
      "Arbitrary PHP File Upload, Read, or Deletion.",
      "Arbitrary Options Update.",
      "Remote Code Execution.",
      "Authentication Bypass or Privilege Escalation to Administrator.",
      "Stored Cross-Site Scripting or SQL Injection.",
      "Unauthorized data alteration or read with a critical programme-qualified effect.",
    ],
    candidateAdmission: {
      eligibleAttackerPositions: [
        "unauthenticated" as const,
        "subscriber" as const,
        "customer" as const,
      ],
      priorityImpacts: [
        "arbitrary-php-file-upload" as const,
        "arbitrary-php-file-read" as const,
        "arbitrary-php-file-deletion" as const,
        "arbitrary-options-update" as const,
        "remote-code-execution" as const,
        "authentication-bypass-to-administrator" as const,
        "privilege-escalation-to-administrator" as const,
        "stored-cross-site-scripting" as const,
        "sql-injection" as const,
        "critical-unauthorized-data-alteration" as const,
        "critical-unauthorized-data-read" as const,
      ],
    },
    explicitExclusions: [
      "A source primitive with no concrete path to an eligible impact.",
    ],
    excludedAssets: ["WordPress core."],
    sourceRefs: [{ id: "programme-scope-snapshot", digest: digest("7") }],
    uncertainties: [],
    handling: {
      sourceProvenExcluded: "park" as const,
      concreteEligibleEscalation: "continue" as const,
      scopeAmbiguity: "human-challenge" as const,
    },
  };
  return {
    kind: "agent-led-campaign",
    schemaVersion: 2,
    campaignId,
    targetSnapshot: {
      id: "target-course-suite-fixture-1.0.0",
      pluginSlug: "course-suite-fixture",
      version: "1.0.0",
      digest: digest("a"),
      sourceTree: { digest: digest("9"), entries: 10, bytes: 1_024 },
    },
    promptSet: { id: "research-v1", digest: digest("b") },
    agentRuntimeProfile: defineAgentRuntimeProfile({
      id: "runtime-v1",
      transportKind: "scripted-native-agent/v1",
      executableVersion: "1.0.0",
      sandboxImageDigest: digest("0"),
      promptProtocol: "stdin",
      reportProtocol: "prompted-json",
      model: "scripted-model",
      effort: "high",
    }),
    permissionProfile: { id: "source-only-v1", digest: digest("e") },
    budgetEnvelope: {
      id: "budget-v1",
      maxNativeRuns: 2,
      maxWallTimeMs: 600_000,
      digest: digest("f"),
    },
    ...(withBoundary
      ? {
          programmeBoundary: {
            ...boundaryBody,
            digest: canonicalDigest(boundaryBody),
          },
        }
      : {}),
  } as CampaignInput;
}

function checkpointFor(run: SealedNativeRun) {
  return {
    kind: "agent-checkpoint" as const,
    schemaVersion: 1 as const,
    checkpointId: `${run.runId}:checkpoint`,
    stateDigest: digest("1"),
    stateEntries: 1,
    stateBytes: 64,
    sessionId: "12121212-1212-4121-8121-121212121212",
    targetSnapshotDigest: run.targetSnapshot.digest,
    promptSetDigest: run.promptSet.digest,
    runtimeProfileDigest: run.agentRuntimeProfile.digest,
    permissionProfileDigest: run.permissionProfile.digest,
    ...(run.programmeBoundary === undefined
      ? {}
      : { programmeBoundaryDigest: run.programmeBoundary.digest }),
  };
}

function parkedLeadReceipt(run: SealedNativeRun) {
  return {
    schemaVersion: 2 as const,
    runId: run.runId,
    runtimeProfileDigest: run.agentRuntimeProfile.digest,
    terminal: "completed" as const,
    startedAt: "2026-09-09T05:00:00.000Z",
    completedAt: "2026-09-09T05:00:50.000Z",
    usage: { wallTimeMs: 50_000 },
    activity: { subagents: 0, tools: ["source.read"] },
    isolation: {
      backend: "gvisor" as const,
      runtime: "runsc" as const,
      fallbackUsed: false as const,
    },
    checkpoint: checkpointFor(run),
    report: {
      schemaVersion: 2 as const,
      assessments: [],
      evidenceSummary: researchEvidenceSummaryFixture(),
      candidates: [],
      parkedProgrammeLeads: [
        {
          leadId: "lead-profile-label-read",
          attackerPremise: "A basic member can call the profile endpoint.",
          primitive:
            "The endpoint returns another user's internal profile label.",
          maximumSourceSupportedEffect:
            "Disclosure of one synthetic profile label; no credential, reset token, executable file, or administrator session is exposed.",
          eligibleEscalationAssessment:
            "no-concrete-source-bound-path" as const,
          evidence: [
            {
              path: "src/api/profile-controller.ts",
              location: "get_profile:88",
              observation:
                "The response includes the selected profile label but no authentication material.",
            },
          ],
        },
      ],
      decision: {
        kind: "stop" as const,
        basis: "No active frontier to a programme-eligible impact remains.",
      },
    },
  };
}

function candidateReceipt(
  run: SealedNativeRun,
  classification?: Readonly<{
    attackerPosition: "unauthenticated" | "subscriber" | "customer";
    priorityImpact: "stored-cross-site-scripting" | "remote-code-execution";
  }>,
) {
  const receipt = parkedLeadReceipt(run);
  return {
    ...receipt,
    report: {
      ...receipt.report,
      candidates: [
        {
          candidateId: "candidate-stored-xss",
          attackerPremise:
            classification === undefined
              ? "A Contributor can save markup through the block editor."
              : "The declared lower-trust actor can save markup through the public interface.",
          ...(classification ?? {}),
          brokenSecurityProperty:
            "Stored attacker markup must remain inert in administrator output.",
          claim:
            "Attacker-controlled markup is stored and rendered to an administrator without output escaping.",
          evidence: [
            {
              path: "src/render/block.php",
              location: "render_block:41",
              observation:
                "The stored attacker value is emitted without contextual escaping.",
            },
          ],
          sourceTrace: [
            {
              role: "entrypoint" as const,
              path: "src/api/save-block.php",
              location: "save_block:19",
              observation:
                "The endpoint accepts the attacker-controlled value.",
            },
            {
              role: "effect" as const,
              path: "src/render/block.php",
              location: "render_block:41",
              observation:
                "The stored value is emitted in administrator output.",
            },
          ],
          controlAssessments: [
            {
              control: "Output escaping",
              evidence: [
                {
                  path: "src/render/block.php",
                  location: "render_block:41",
                  observation:
                    "No contextual escaping is applied at the output boundary.",
                },
              ],
              conclusion:
                "No source-visible control makes the stored markup inert.",
            },
          ],
          unresolvedFacts: [],
        },
      ],
      parkedProgrammeLeads: [],
    },
  };
}

describe("parked Programme Leads", () => {
  it("carries the wp2shell research method without its time and forced-RCE task", async () => {
    const prompt = await readFile(
      join(process.cwd(), "prompts/wordpress-plugin-research-v9.md"),
      "utf8",
    );

    expect(prompt).toContain("from first principles");
    expect(prompt).toContain("Do not assume that a vulnerability exists");
    expect(prompt).toContain("Do not use vulnerability advisories");
    expect(prompt).toContain("ordinary production deployment");
    expect(prompt).toContain("Use native subagents aggressively");
    expect(prompt).toContain("Do not use a fixed assignment");
    expect(prompt).toContain("explicit scratch registry of approach families");
    expect(prompt).toContain("rather than superficial wording");
    expect(prompt).toContain("redirect some toward underexplored families");
    expect(prompt).toContain("Do not let one route dominate");
    expect(prompt).toContain("materially new mechanism");
    expect(prompt).toContain("Keep several incompatible routes alive");
    expect(prompt).toContain("before cross-pollinating their ideas");
    expect(prompt).toContain("Use adversarial subagents throughout");
    expect(prompt).toContain("Double-check every concrete bug");
    expect(prompt).toContain("launches new rounds");
    expect(prompt).toContain(
      "Failure of the current approaches or the first wave is not a reason to stop",
    );
    expect(prompt).toContain("chain intermediate bugs");
    expect(prompt).toContain("pinned dependency source");
    expect(prompt).toContain(
      "Do not merely return because current approaches failed or agents reported no findings",
    );
    expect(prompt).toContain(
      "Every report must include a run-local `evidenceSummary`",
    );
    expect(prompt).toContain(
      "It is not a Harness work queue, a coverage ledger",
    );
    expect(prompt).not.toContain("/flag");
    expect(prompt).not.toContain("at least 6 hours");
  });

  it("spends deep exploration only on the programme-eligible vulnerability scope", async () => {
    const prompt = await readFile(
      join(process.cwd(), "prompts/wordpress-plugin-research-v9.md"),
      "utf8",
    );

    expect(prompt).toContain("Arbitrary PHP File Upload, Read, or Deletion");
    expect(prompt).toContain("Arbitrary Options Update");
    expect(prompt).toContain("Authentication Bypass to Administrator");
    expect(prompt).toContain("Privilege Escalation to Administrator");
    expect(prompt).toContain("Stored Cross-Site Scripting");
    expect(prompt).toContain("SQL Injection");
    expect(prompt).toContain(
      "Do not delegate a parked Programme Lead to a subagent or adversarially validate it",
    );
    expect(prompt).toContain(
      "Promote it only when a concrete source-bound edge reaches an eligible impact",
    );
    expect(prompt).toContain(
      "Before parking a read, inspect every material producer of its store",
    );
    expect(prompt).toContain("for a write, inspect its privileged consumers");
  });

  it("preserves an OOS primitive without Candidate review or verification handoff", async () => {
    const directory = await mkdtemp(join(tmpdir(), "parked-lead-"));
    temporaryDirectories.push(directory);
    const input = inputFor("campaign-parked-lead-1");
    let invocations = 0;
    const campaigns = openResearchCampaigns({
      databasePath: join(directory, "research.sqlite"),
      runtime: {
        async execute(run) {
          invocations += 1;
          if (run.kind !== "sealed-native-research-run") {
            throw new Error(
              "A parked Programme Lead must not enter Candidate Verification",
            );
          }
          return parkedLeadReceipt(run);
        },
      },
    });

    await expect(campaigns.conduct(input)).resolves.toMatchObject({
      status: "coverage-closed",
    });
    const view = await campaigns.inspect({ campaignId: input.campaignId });
    expect(view).toMatchObject({
      status: "coverage-closed",
      parkedProgrammeLeads: [
        {
          leadId: "lead-profile-label-read",
          eligibleEscalationAssessment: "no-concrete-source-bound-path",
        },
      ],
      candidateReviews: [],
    });
    expect(view.pendingCandidateReview).toBeUndefined();
    expect(invocations).toBe(1);
    campaigns.close();
  });

  it("rejects a Candidate whose attacker position is outside the Programme Boundary", async () => {
    const directory = await mkdtemp(
      join(tmpdir(), "candidate-outside-programme-boundary-"),
    );
    temporaryDirectories.push(directory);
    const input = inputFor("campaign-candidate-outside-boundary-1");
    const campaigns = openResearchCampaigns({
      databasePath: join(directory, "research.sqlite"),
      runtime: {
        async execute(run) {
          return candidateReceipt(run);
        },
      },
    });

    await expect(campaigns.conduct(input)).resolves.toMatchObject({
      status: "incomplete",
    });
    const view = await campaigns.inspect({ campaignId: input.campaignId });
    expect(view).toMatchObject({
      status: "incomplete",
      admissionFailure: {
        reason: "candidate-outside-programme-boundary",
        runId: "campaign-candidate-outside-boundary-1:native:1",
      },
      candidateVerificationRequests: [],
    });
    expect(view.pendingCandidateReview).toBeUndefined();
    campaigns.close();
  });

  it("admits a classified Candidate inside the Programme Boundary", async () => {
    const directory = await mkdtemp(
      join(tmpdir(), "candidate-inside-programme-boundary-"),
    );
    temporaryDirectories.push(directory);
    const input = inputFor("campaign-candidate-inside-boundary-1");
    const campaigns = openResearchCampaigns({
      databasePath: join(directory, "research.sqlite"),
      runtime: {
        async execute(run) {
          return candidateReceipt(run, {
            attackerPosition: "unauthenticated",
            priorityImpact: "stored-cross-site-scripting",
          });
        },
      },
    });

    await expect(campaigns.conduct(input)).resolves.toMatchObject({
      status: "candidate-review-pending",
    });
    const view = await campaigns.inspect({ campaignId: input.campaignId });
    expect(view.admissionFailure).toBeUndefined();
    expect(view.pendingCandidateReview?.candidates).toMatchObject([
      {
        attackerPosition: "unauthenticated",
        priorityImpact: "stored-cross-site-scripting",
      },
    ]);
    campaigns.close();
  });

  it("rejects a Candidate whose impact is outside the Programme Boundary", async () => {
    const directory = await mkdtemp(
      join(tmpdir(), "candidate-impact-outside-programme-boundary-"),
    );
    temporaryDirectories.push(directory);
    const baseInput = inputFor("campaign-candidate-impact-outside-boundary-1");
    const boundary = baseInput.programmeBoundary;
    if (boundary === undefined) throw new Error("missing boundary fixture");
    const { digest: _digest, ...boundaryBody } = boundary;
    const restrictedBoundaryBody = {
      ...boundaryBody,
      candidateAdmission: {
        eligibleAttackerPositions: ["unauthenticated" as const],
        priorityImpacts: ["stored-cross-site-scripting" as const],
      },
    };
    const input: CampaignInput = {
      ...baseInput,
      programmeBoundary: {
        ...restrictedBoundaryBody,
        digest: canonicalDigest(restrictedBoundaryBody),
      },
    };
    const campaigns = openResearchCampaigns({
      databasePath: join(directory, "research.sqlite"),
      runtime: {
        async execute(run) {
          return candidateReceipt(run, {
            attackerPosition: "unauthenticated",
            priorityImpact: "remote-code-execution",
          });
        },
      },
    });

    await expect(campaigns.conduct(input)).resolves.toMatchObject({
      status: "incomplete",
    });
    await expect(
      campaigns.inspect({ campaignId: input.campaignId }),
    ).resolves.toMatchObject({
      admissionFailure: {
        reason: "candidate-outside-programme-boundary",
      },
      candidateVerificationRequests: [],
    });
    campaigns.close();
  });

  it("rejects a programme disposition when no Programme Boundary is bound", async () => {
    const directory = await mkdtemp(join(tmpdir(), "unbound-parked-lead-"));
    temporaryDirectories.push(directory);
    const input = inputFor("campaign-unbound-parked-lead-1", false);
    const campaigns = openResearchCampaigns({
      databasePath: join(directory, "research.sqlite"),
      runtime: {
        async execute(run: SealedNativeRun) {
          if (run.kind !== "sealed-native-research-run") {
            throw new Error(
              "A parked Programme Lead must not enter Candidate Verification",
            );
          }
          return parkedLeadReceipt(run);
        },
      },
    });

    await expect(campaigns.conduct(input)).resolves.toMatchObject({
      status: "incomplete",
    });
    await expect(
      campaigns.inspect({ campaignId: input.campaignId }),
    ).resolves.toMatchObject({
      status: "incomplete",
      admissionFailure: {
        reason: "parked-programme-lead-without-boundary",
        runId: "campaign-unbound-parked-lead-1:native:1",
      },
      parkedProgrammeLeads: [],
      nativeRuns: [
        {
          terminal: "completed",
          usage: { wallTimeMs: 50_000 },
          checkpoint: {
            checkpointId: "campaign-unbound-parked-lead-1:native:1:checkpoint",
          },
          report: {
            parkedProgrammeLeads: [{ leadId: "lead-profile-label-read" }],
          },
        },
      ],
    });
    campaigns.close();
  });

  it("keeps the first parked Lead when a later run reuses its identity", async () => {
    const directory = await mkdtemp(
      join(tmpdir(), "parked-lead-admission-conflict-"),
    );
    temporaryDirectories.push(directory);
    const input = inputFor("campaign-parked-lead-admission-conflict-1");
    let invocations = 0;
    const campaigns = openResearchCampaigns({
      databasePath: join(directory, "research.sqlite"),
      runtime: {
        async execute(run) {
          invocations += 1;
          const receipt = parkedLeadReceipt(run);
          const lead = receipt.report.parkedProgrammeLeads[0];
          if (lead === undefined)
            throw new Error("missing parked lead fixture");
          return {
            ...receipt,
            report: {
              ...receipt.report,
              parkedProgrammeLeads: [
                invocations === 1
                  ? lead
                  : {
                      ...lead,
                      primitive:
                        "The same identity now claims disclosure of authentication material.",
                    },
              ],
              decision:
                invocations === 1
                  ? {
                      kind: "continue" as const,
                      reason: "A concrete eligible route remains unresolved.",
                      nextActions: [
                        {
                          question:
                            "Does the adjacent endpoint expose authentication material?",
                          sourcePointers: ["src/api/profile-controller.ts"],
                        },
                      ],
                    }
                  : receipt.report.decision,
            },
          };
        },
      },
    });

    await expect(
      conductWithHumanAdvance(campaigns, input),
    ).resolves.toMatchObject({ status: "coverage-closed" });
    await expect(
      campaigns.inspect({ campaignId: input.campaignId }),
    ).resolves.toMatchObject({
      status: "coverage-closed",
      parkedProgrammeLeads: [
        {
          leadId: "lead-profile-label-read",
          primitive:
            "The endpoint returns another user's internal profile label.",
        },
      ],
      nativeRuns: [
        { terminal: "completed" },
        {
          terminal: "completed",
          report: {
            parkedProgrammeLeads: [
              {
                leadId: "lead-profile-label-read",
                primitive:
                  "The same identity now claims disclosure of authentication material.",
              },
            ],
          },
        },
      ],
    });
    campaigns.close();
  });

  it("keeps parked leads when autonomous continuation loses the provider", async () => {
    const directory = await mkdtemp(join(tmpdir(), "parked-lead-recovery-"));
    temporaryDirectories.push(directory);
    const input = inputFor("campaign-parked-lead-recovery-1");
    let invocations = 0;
    const campaigns = openResearchCampaigns({
      databasePath: join(directory, "research.sqlite"),
      runtime: {
        async execute(run) {
          if (run.kind !== "sealed-native-research-run") {
            throw new Error(
              "A parked Programme Lead must not enter Candidate Verification",
            );
          }
          invocations += 1;
          if (invocations === 2)
            throw new Error("provider authentication expired");
          const receipt = parkedLeadReceipt(run);
          return {
            ...receipt,
            report: {
              ...receipt.report,
              decision: {
                kind: "continue" as const,
                reason: "A separate eligible authorization route remains open.",
                nextActions: [
                  {
                    question:
                      "Can the adjacent callback update an administrator option?",
                    sourcePointers: ["src/api/profile-controller.ts"],
                  },
                ],
              },
            },
          };
        },
      },
    });

    await expect(campaigns.conduct(input)).resolves.toMatchObject({
      status: "incomplete",
    });
    await expect(
      campaigns.inspect({ campaignId: input.campaignId }),
    ).resolves.toMatchObject({
      parkedProgrammeLeads: [{ leadId: "lead-profile-label-read" }],
      nativeRuns: [{ terminal: "completed" }, { terminal: "provider-failed" }],
      candidateReviews: [],
    });
    campaigns.close();
  });
});
