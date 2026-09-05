import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";

import { openTargetResearchHistory } from "../../src/target-intelligence/index.js";
import type {
  TargetResearchAdmissionRequest,
  TargetResearchHistory,
} from "../../src/target-intelligence/index.js";

const digest = (character: string): string => `sha256:${character.repeat(64)}`;

const prospectiveAdmission = {
  kind: "target-research-admission" as const,
  schemaVersion: 1 as const,
  target: {
    pluginIdentity: "wporg:example-security",
    verifiedVersion: "2.4.1",
    canonicalFileManifestDigest: digest("1"),
  },
  campaign: {
    kind: "prospective" as const,
    runOrdinal: 1,
    policy: { id: "selection-policy-v1", digest: digest("2") },
    profile: { id: "semantic-research-v6", digest: digest("3") },
    purpose: "Prospective security research",
  },
};

const intentionalCampaignKinds = [
  "development-cohort",
  "calibration",
  "independent-repeat",
] as const;

async function admitNew(
  history: TargetResearchHistory,
  request: TargetResearchAdmissionRequest,
) {
  const admission = await history.admit(request);
  expect(admission.status).toBe("new");
  if (admission.status !== "new") {
    throw new Error("Expected a new Target Research Campaign");
  }
  return admission;
}

describe("TargetResearchHistory", () => {
  it("resumes an active Campaign and idempotently records its lifecycle", async () => {
    const directory = await mkdtemp(join(tmpdir(), "target-history-active-"));
    const databasePath = join(directory, "target-intelligence.sqlite");
    let currentTime = "2030-01-01T00:00:00.000Z";
    try {
      const history = openTargetResearchHistory({
        databasePath,
        clock: () => new Date(currentTime),
      });

      const admitted = await admitNew(history, prospectiveAdmission);
      expect(admitted).toMatchObject({
        status: "new",
        campaign: {
          target: prospectiveAdmission.target,
          definition: prospectiveAdmission.campaign,
          status: "selected",
          selectedAt: "2030-01-01T00:00:00.000Z",
        },
      });

      currentTime = "2030-01-01T00:05:00.000Z";
      const startedInput = {
        kind: "target-research-history-record" as const,
        schemaVersion: 1 as const,
        campaignId: admitted.campaign.id,
        event: { kind: "campaign-started" as const },
      };
      const started = await history.record(startedInput);
      expect(started).toMatchObject({
        status: "appended",
        historyRecord: {
          campaignId: admitted.campaign.id,
          occurredAt: "2030-01-01T00:05:00.000Z",
          event: startedInput.event,
        },
        campaign: {
          status: "active",
          startedAt: "2030-01-01T00:05:00.000Z",
          lastProgressAt: "2030-01-01T00:05:00.000Z",
        },
      });

      currentTime = "2030-01-01T00:10:00.000Z";
      const replayed = await history.record(startedInput);
      expect(replayed).toEqual({ ...started, status: "replayed" });

      const restarted = openTargetResearchHistory({
        databasePath,
        clock: () => new Date(currentTime),
      });
      const resumed = await restarted.admit(prospectiveAdmission);
      expect(resumed).toEqual({ status: "resume", campaign: started.campaign });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("replays Coverage Closed as already-covered after restart", async () => {
    const directory = await mkdtemp(join(tmpdir(), "target-history-closed-"));
    const databasePath = join(directory, "target-intelligence.sqlite");
    let currentTime = "2030-02-01T00:00:00.000Z";
    try {
      const history = openTargetResearchHistory({
        databasePath,
        clock: () => new Date(currentTime),
      });
      const admitted = await admitNew(history, prospectiveAdmission);
      await history.record({
        kind: "target-research-history-record",
        schemaVersion: 1,
        campaignId: admitted.campaign.id,
        event: { kind: "campaign-started" },
      });

      currentTime = "2030-02-01T01:00:00.000Z";
      await expect(
        history.record({
          kind: "target-research-history-record",
          schemaVersion: 1,
          campaignId: admitted.campaign.id,
          event: { kind: "campaign-progressed", progressId: "wave-1" },
        }),
      ).resolves.toMatchObject({
        status: "appended",
        campaign: {
          lastProgressAt: "2030-02-01T01:00:00.000Z",
        },
      });

      currentTime = "2030-02-01T02:00:00.000Z";
      const completedInput = {
        kind: "target-research-history-record" as const,
        schemaVersion: 1 as const,
        campaignId: admitted.campaign.id,
        event: {
          kind: "campaign-completed" as const,
          terminalStatus: "coverage-closed" as const,
        },
      };
      const completed = await history.record(completedInput);
      expect(completed).toMatchObject({
        status: "appended",
        campaign: {
          status: "coverage-closed",
          selectedAt: "2030-02-01T00:00:00.000Z",
          startedAt: "2030-02-01T00:00:00.000Z",
          lastProgressAt: "2030-02-01T01:00:00.000Z",
          completedAt: "2030-02-01T02:00:00.000Z",
          terminalStatus: "coverage-closed",
        },
      });

      currentTime = "2031-01-01T00:00:00.000Z";
      const restarted = openTargetResearchHistory({
        databasePath,
        clock: () => new Date(currentTime),
      });
      await expect(restarted.admit(prospectiveAdmission)).resolves.toEqual({
        status: "already-covered",
        campaign: completed.campaign,
      });
      await expect(restarted.record(completedInput)).resolves.toEqual({
        ...completed,
        status: "replayed",
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("rejects an invalid stored row before replaying its public projection", async () => {
    const directory = await mkdtemp(join(tmpdir(), "target-history-row-"));
    const databasePath = join(directory, "target-intelligence.sqlite");
    try {
      const history = openTargetResearchHistory({
        databasePath,
        clock: () => new Date("2030-02-01T00:00:00.000Z"),
      });
      await admitNew(history, prospectiveAdmission);

      const database = new Database(databasePath);
      database
        .prepare(
          `UPDATE target_research_history_events
              SET occurred_at = ?
            WHERE global_sequence = 1`,
        )
        .run("not-a-timestamp");
      database.close();

      const restarted = openTargetResearchHistory({ databasePath });
      await expect(restarted.admit(prospectiveAdmission)).rejects.toThrow(
        "occurred_at",
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("requires a reasoned follow-up after an Incomplete Campaign", async () => {
    const directory = await mkdtemp(
      join(tmpdir(), "target-history-incomplete-"),
    );
    try {
      const history = openTargetResearchHistory({
        databasePath: join(directory, "target-intelligence.sqlite"),
        clock: () => new Date("2030-03-01T00:00:00.000Z"),
      });
      const admitted = await admitNew(history, prospectiveAdmission);
      await history.record({
        kind: "target-research-history-record",
        schemaVersion: 1,
        campaignId: admitted.campaign.id,
        event: { kind: "campaign-started" },
      });
      const incomplete = await history.record({
        kind: "target-research-history-record",
        schemaVersion: 1,
        campaignId: admitted.campaign.id,
        event: {
          kind: "campaign-completed",
          terminalStatus: "incomplete",
          reason: "Unresolved source frontier remains",
        },
      });

      await expect(history.admit(prospectiveAdmission)).resolves.toEqual({
        status: "follow-up-required",
        campaign: incomplete.campaign,
      });

      const followUpRequest = {
        ...prospectiveAdmission,
        campaign: {
          ...prospectiveAdmission.campaign,
          runOrdinal: 2,
          reason: "Resolve the recorded source frontier",
          followUp: { campaignId: admitted.campaign.id },
        },
      };
      const followUp = await admitNew(history, followUpRequest);
      expect(followUp).toMatchObject({
        status: "new",
        campaign: {
          target: prospectiveAdmission.target,
          definition: followUpRequest.campaign,
          status: "selected",
        },
      });
      await history.record({
        kind: "target-research-history-record",
        schemaVersion: 1,
        campaignId: followUp.campaign.id,
        event: { kind: "campaign-started" },
      });
      const covered = await history.record({
        kind: "target-research-history-record",
        schemaVersion: 1,
        campaignId: followUp.campaign.id,
        event: {
          kind: "campaign-completed",
          terminalStatus: "coverage-closed",
        },
      });
      await expect(history.admit(prospectiveAdmission)).resolves.toEqual({
        status: "already-covered",
        campaign: covered.campaign,
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("reports same-version byte conflicts while admitting a new verified version", async () => {
    const directory = await mkdtemp(join(tmpdir(), "target-history-identity-"));
    try {
      const history = openTargetResearchHistory({
        databasePath: join(directory, "target-intelligence.sqlite"),
        clock: () => new Date("2030-04-01T00:00:00.000Z"),
      });
      const admitted = await admitNew(history, prospectiveAdmission);
      const conflicting = {
        ...prospectiveAdmission,
        target: {
          ...prospectiveAdmission.target,
          canonicalFileManifestDigest: digest("4"),
        },
      };

      await expect(history.admit(conflicting)).resolves.toEqual({
        status: "provenance-conflict",
        recordedTarget: admitted.campaign.target,
        observedTarget: conflicting.target,
      });

      const newVersion = {
        ...prospectiveAdmission,
        target: {
          ...prospectiveAdmission.target,
          verifiedVersion: "2.5.0",
          canonicalFileManifestDigest: digest("5"),
        },
      };
      await expect(history.admit(newVersion)).resolves.toMatchObject({
        status: "new",
        campaign: {
          target: newVersion.target,
          status: "selected",
        },
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it.each(intentionalCampaignKinds)(
    "admits a reasoned %s run after Coverage Closed",
    async (campaignKind) => {
      const directory = await mkdtemp(
        join(tmpdir(), "target-history-intentional-"),
      );
      try {
        const history = openTargetResearchHistory({
          databasePath: join(directory, "target-intelligence.sqlite"),
          clock: () => new Date("2030-05-01T00:00:00.000Z"),
        });
        const original = await admitNew(history, prospectiveAdmission);
        await history.record({
          kind: "target-research-history-record",
          schemaVersion: 1,
          campaignId: original.campaign.id,
          event: { kind: "campaign-started" },
        });
        await history.record({
          kind: "target-research-history-record",
          schemaVersion: 1,
          campaignId: original.campaign.id,
          event: {
            kind: "campaign-completed",
            terminalStatus: "coverage-closed",
          },
        });

        const withoutReason = {
          ...prospectiveAdmission,
          campaign: {
            ...prospectiveAdmission.campaign,
            kind: campaignKind,
            runOrdinal: 2,
          },
        };
        await expect(history.admit(withoutReason)).rejects.toThrow("reason");

        const intentional = {
          ...withoutReason,
          campaign: {
            ...withoutReason.campaign,
            reason: `Approved ${campaignKind} run`,
          },
        };
        await expect(history.admit(intentional)).resolves.toMatchObject({
          status: "new",
          campaign: {
            definition: intentional.campaign,
            status: "selected",
          },
        });
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    },
  );

  it("rejects Oracle Facts instead of storing or returning them", async () => {
    const directory = await mkdtemp(join(tmpdir(), "target-history-oracle-"));
    try {
      const history = openTargetResearchHistory({
        databasePath: join(directory, "target-intelligence.sqlite"),
        clock: () => new Date("2030-06-01T00:00:00.000Z"),
      });
      const taintedAdmission = {
        ...prospectiveAdmission,
        campaign: {
          ...prospectiveAdmission.campaign,
          oracleFacts: {
            cve: "CVE-2030-0001",
            advisory: "Known advisory narrative",
            finding: "Known Finding",
            hypothesis: "Known Hypothesis",
            knownRoute: "Known vulnerable route",
            knownVulnerableRange: "<= 2.4.1",
          },
        },
      };

      await expect(
        Reflect.apply(history.admit, history, [taintedAdmission]),
      ).rejects.toThrow("oracleFacts");
      await expect(history.admit(prospectiveAdmission)).resolves.toMatchObject({
        status: "new",
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
