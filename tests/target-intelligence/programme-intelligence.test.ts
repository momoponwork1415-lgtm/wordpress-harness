import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  openProgrammeIntelligence,
  type ProgrammePolicySourceAdapter,
} from "../../src/target-intelligence/index.js";

const digest = (character: string): string => `sha256:${character.repeat(64)}`;
const fixtureDirectory = join(
  import.meta.dirname,
  "..",
  "fixtures",
  "target-intelligence",
  "programme-eligibility",
);

const programmes = [
  {
    name: "Patchstack",
    identity: "programme:patchstack",
    fixture: "patchstack.json",
    sourceUrl: "https://fixtures.invalid/patchstack/policy",
    parserVersion: "patchstack-sanitized-fixture-v1",
    contentDigest:
      "sha256:13f642c523589454b26fc91f28f5c48a8e2671d6a0802ca15330ee6fd1ef4bd1",
    opportunityBand: "broad",
  },
  {
    name: "Wordfence",
    identity: "programme:wordfence",
    fixture: "wordfence.json",
    sourceUrl: "https://fixtures.invalid/wordfence/policy",
    parserVersion: "wordfence-sanitized-fixture-v1",
    contentDigest:
      "sha256:e17841e1340ceac121efb522a4307403e7b9700a3cacb38904f9e4c9c8f12210",
    opportunityBand: "high-impact-only",
  },
] as const;

function fixtureAdapter(
  programme: (typeof programmes)[number],
): ProgrammePolicySourceAdapter {
  return {
    sourceId: `${programme.identity}:eligibility-policy`,
    programmeIdentity: programme.identity,
    sourceUrl: programme.sourceUrl,
    parserVersion: programme.parserVersion,
    retrieve: () => readFile(join(fixtureDirectory, programme.fixture)),
    parse: (bytes) => JSON.parse(Buffer.from(bytes).toString("utf8")),
  };
}

describe("ProgrammeIntelligence", () => {
  it.each(programmes)(
    "normalizes the $name fixture into the common eligibility contract",
    async (programme) => {
      const directory = await mkdtemp(
        join(tmpdir(), "programme-intelligence-"),
      );
      try {
        const intelligence = openProgrammeIntelligence({
          storageDirectory: directory,
          sourceAdapters: [fixtureAdapter(programme)],
          freshnessPolicy: {
            kind: "programme-eligibility-freshness-policy",
            schemaVersion: 1,
            id: "programme-freshness-v1",
            digest: digest("f"),
            maximumAgeMs: {
              targetSelectionBatch: 86_400_000,
              submissionStaging: 3_600_000,
            },
          },
          clock: () => new Date("2030-07-01T00:00:00.000Z"),
        });
        const request = {
          kind: "programme-intelligence-refresh" as const,
          schemaVersion: 1 as const,
          programmeIdentity: programme.identity,
        };

        const refreshed = await intelligence.refresh(request);
        expect(refreshed).toMatchObject({
          status: "current",
          snapshot: {
            kind: "programme-eligibility-snapshot",
            schemaVersion: 1,
            programmeIdentity: programme.identity,
            retrievedAt: "2030-07-01T00:00:00.000Z",
            sources: [
              {
                sourceId: `${programme.identity}:eligibility-policy`,
                sourceUrl: programme.sourceUrl,
                retrievedAt: "2030-07-01T00:00:00.000Z",
                contentDigest: programme.contentDigest,
                parserVersion: programme.parserVersion,
              },
            ],
            policy: {
              eligibility: {
                assets: expect.any(Array),
                vulnerabilityClasses: expect.any(Array),
                attackerRoles: expect.any(Array),
                activeInstallThreshold: expect.any(Object),
                researcherTiers: expect.any(Array),
                exclusions: expect.any(Array),
              },
              programmeOpportunityBand: programme.opportunityBand,
              rewardEstimateInput: {
                kind: "finding-only-reward-estimate-input",
              },
            },
          },
          snapshotRef: {
            kind: "programme-eligibility-snapshot-ref",
            schemaVersion: 1,
            id: expect.stringMatching(/^programme-snapshot:/),
            digest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
          },
        });
        if (refreshed.status !== "current") {
          throw new Error("Expected a current Programme Eligibility Snapshot");
        }

        await expect(intelligence.refresh(request)).resolves.toEqual(refreshed);
        for (const requiredFor of [
          "target-selection-batch",
          "submission-staging",
        ] as const) {
          await expect(
            intelligence.inspect({
              kind: "programme-eligibility-inspection",
              schemaVersion: 1,
              snapshotRef: refreshed.snapshotRef,
              requiredFor,
            }),
          ).resolves.toEqual(refreshed);
        }
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    },
  );

  it("returns policy-conflict when required sources disagree", async () => {
    const directory = await mkdtemp(
      join(tmpdir(), "programme-intelligence-conflict-"),
    );
    try {
      const programme = programmes[0];
      const primary = fixtureAdapter(programme);
      const conflicting: ProgrammePolicySourceAdapter = {
        ...primary,
        sourceId: "programme:patchstack:programme-directory",
        sourceUrl: "https://fixtures.invalid/patchstack/directory",
        retrieve: () =>
          readFile(join(fixtureDirectory, "patchstack-conflict.json")),
      };
      const intelligence = openProgrammeIntelligence({
        storageDirectory: directory,
        sourceAdapters: [primary, conflicting],
        freshnessPolicy: {
          kind: "programme-eligibility-freshness-policy",
          schemaVersion: 1,
          id: "programme-freshness-v1",
          digest: digest("f"),
          maximumAgeMs: {
            targetSelectionBatch: 86_400_000,
            submissionStaging: 3_600_000,
          },
        },
        clock: () => new Date("2030-07-01T00:00:00.000Z"),
      });

      await expect(
        intelligence.refresh({
          kind: "programme-intelligence-refresh",
          schemaVersion: 1,
          programmeIdentity: programme.identity,
        }),
      ).resolves.toMatchObject({
        status: "policy-conflict",
        programmeIdentity: programme.identity,
        sources: [
          {
            sourceId: "programme:patchstack:eligibility-policy",
            sourceUrl: programme.sourceUrl,
          },
          {
            sourceId: "programme:patchstack:programme-directory",
            sourceUrl: "https://fixtures.invalid/patchstack/directory",
          },
        ],
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("returns parse-failed when a required policy field is missing", async () => {
    const directory = await mkdtemp(
      join(tmpdir(), "programme-intelligence-parse-"),
    );
    try {
      const programme = programmes[0];
      const incomplete: ProgrammePolicySourceAdapter = {
        ...fixtureAdapter(programme),
        retrieve: () =>
          readFile(join(fixtureDirectory, "patchstack-missing-field.json")),
      };
      const intelligence = openProgrammeIntelligence({
        storageDirectory: directory,
        sourceAdapters: [incomplete],
        freshnessPolicy: {
          kind: "programme-eligibility-freshness-policy",
          schemaVersion: 1,
          id: "programme-freshness-v1",
          digest: digest("f"),
          maximumAgeMs: {
            targetSelectionBatch: 86_400_000,
            submissionStaging: 3_600_000,
          },
        },
        clock: () => new Date("2030-07-01T00:00:00.000Z"),
      });

      await expect(
        intelligence.refresh({
          kind: "programme-intelligence-refresh",
          schemaVersion: 1,
          programmeIdentity: programme.identity,
        }),
      ).resolves.toMatchObject({
        status: "parse-failed",
        programmeIdentity: programme.identity,
        source: {
          sourceId: "programme:patchstack:eligibility-policy",
          sourceUrl: programme.sourceUrl,
          retrievedAt: "2030-07-01T00:00:00.000Z",
          contentDigest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
          parserVersion: programme.parserVersion,
        },
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("rejects technical-validity claims and Oracle Facts from normalized policy", async () => {
    const directory = await mkdtemp(
      join(tmpdir(), "programme-intelligence-oracle-"),
    );
    try {
      const programme = programmes[0];
      const tainted: ProgrammePolicySourceAdapter = {
        ...fixtureAdapter(programme),
        retrieve: () =>
          readFile(join(fixtureDirectory, "patchstack-oracle-tainted.json")),
      };
      const intelligence = openProgrammeIntelligence({
        storageDirectory: directory,
        sourceAdapters: [tainted],
        freshnessPolicy: {
          kind: "programme-eligibility-freshness-policy",
          schemaVersion: 1,
          id: "programme-freshness-v1",
          digest: digest("f"),
          maximumAgeMs: {
            targetSelectionBatch: 86_400_000,
            submissionStaging: 3_600_000,
          },
        },
        clock: () => new Date("2030-07-01T00:00:00.000Z"),
      });

      await expect(
        intelligence.refresh({
          kind: "programme-intelligence-refresh",
          schemaVersion: 1,
          programmeIdentity: programme.identity,
        }),
      ).resolves.toMatchObject({
        status: "parse-failed",
        programmeIdentity: programme.identity,
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("returns stale when a required source refresh fails", async () => {
    const directory = await mkdtemp(
      join(tmpdir(), "programme-intelligence-refresh-failure-"),
    );
    try {
      const programme = programmes[1];
      const unavailable: ProgrammePolicySourceAdapter = {
        ...fixtureAdapter(programme),
        retrieve: () => Promise.reject(new Error("fixture source unavailable")),
      };
      const intelligence = openProgrammeIntelligence({
        storageDirectory: directory,
        sourceAdapters: [unavailable],
        freshnessPolicy: {
          kind: "programme-eligibility-freshness-policy",
          schemaVersion: 1,
          id: "programme-freshness-v1",
          digest: digest("f"),
          maximumAgeMs: {
            targetSelectionBatch: 86_400_000,
            submissionStaging: 3_600_000,
          },
        },
        clock: () => new Date("2030-07-01T00:00:00.000Z"),
      });

      await expect(
        intelligence.refresh({
          kind: "programme-intelligence-refresh",
          schemaVersion: 1,
          programmeIdentity: programme.identity,
        }),
      ).resolves.toEqual({
        status: "stale",
        programmeIdentity: programme.identity,
        reason: "refresh-failed",
        requiredSources: [
          {
            sourceId: "programme:wordfence:eligibility-policy",
            sourceUrl: programme.sourceUrl,
            parserVersion: programme.parserVersion,
          },
        ],
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("requires refresh at both freshness gates without treating stale policy as current", async () => {
    const directory = await mkdtemp(
      join(tmpdir(), "programme-intelligence-freshness-"),
    );
    let currentTime = "2030-07-01T00:00:00.000Z";
    try {
      const programme = programmes[0];
      const intelligence = openProgrammeIntelligence({
        storageDirectory: directory,
        sourceAdapters: [fixtureAdapter(programme)],
        freshnessPolicy: {
          kind: "programme-eligibility-freshness-policy",
          schemaVersion: 1,
          id: "programme-freshness-v1",
          digest: digest("f"),
          maximumAgeMs: {
            targetSelectionBatch: 86_400_000,
            submissionStaging: 3_600_000,
          },
        },
        clock: () => new Date(currentTime),
      });
      const refreshed = await intelligence.refresh({
        kind: "programme-intelligence-refresh",
        schemaVersion: 1,
        programmeIdentity: programme.identity,
      });
      if (refreshed.status !== "current") {
        throw new Error("Expected a current Programme Eligibility Snapshot");
      }

      currentTime = "2030-07-01T02:00:00.000Z";
      await expect(
        intelligence.inspect({
          kind: "programme-eligibility-inspection",
          schemaVersion: 1,
          snapshotRef: refreshed.snapshotRef,
          requiredFor: "submission-staging",
        }),
      ).resolves.toEqual({
        status: "stale",
        programmeIdentity: programme.identity,
        reason: "snapshot-expired",
        requiredFor: "submission-staging",
        snapshotRef: refreshed.snapshotRef,
        retrievedAt: "2030-07-01T00:00:00.000Z",
        maximumAgeMs: 3_600_000,
        refreshRequired: true,
      });

      currentTime = "2030-07-02T01:00:00.000Z";
      await expect(
        intelligence.inspect({
          kind: "programme-eligibility-inspection",
          schemaVersion: 1,
          snapshotRef: refreshed.snapshotRef,
          requiredFor: "target-selection-batch",
        }),
      ).resolves.toEqual({
        status: "stale",
        programmeIdentity: programme.identity,
        reason: "snapshot-expired",
        requiredFor: "target-selection-batch",
        snapshotRef: refreshed.snapshotRef,
        retrievedAt: "2030-07-01T00:00:00.000Z",
        maximumAgeMs: 86_400_000,
        refreshRequired: true,
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
