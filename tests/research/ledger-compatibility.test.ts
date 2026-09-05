import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";

import { openResearch } from "../../src/research/index.js";
import { sha256Digest } from "../../src/research/research-record/canonical-json.js";
import {
  openFileJsonArtifactStore,
  openSqliteResearchRecord,
} from "../../src/research/research-record/index.js";
import { createCampaignInput } from "../fixtures/campaign.js";
import { createCurrentValidationCampaignPlan } from "../fixtures/current-validation-campaign.js";

const fixedNow = "2026-09-01T12:00:00.000Z";

const campaignInput = createCampaignInput("campaign-integrity-check");
const digest = (character: string): string => `sha256:${character.repeat(64)}`;

function createFutureLedger(databasePath: string): void {
  const database = new Database(databasePath);
  try {
    database.exec(`
      CREATE TABLE research_events (
        global_sequence INTEGER PRIMARY KEY AUTOINCREMENT,
        campaign_id TEXT NOT NULL,
        campaign_sequence INTEGER NOT NULL,
        kind TEXT NOT NULL,
        schema_version INTEGER NOT NULL,
        occurred_at TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        UNIQUE (campaign_id, campaign_sequence)
      ) STRICT;

      INSERT INTO research_events (
        campaign_id,
        campaign_sequence,
        kind,
        schema_version,
        occurred_at,
        payload_json
      ) VALUES (
        'campaign-from-future',
        1,
        'campaign.prepared',
        4,
        '2030-01-01T00:00:00.000Z',
        '{}'
      );
    `);
  } finally {
    database.close();
  }
}

describe("CampaignReader Ledger compatibility", () => {
  it("replays a pre-result-event Validator completion through the public reader", async () => {
    const directory = await mkdtemp(join(tmpdir(), "legacy-validator-ledger-"));
    const databasePath = join(directory, "research.sqlite");
    const artifactStore = openFileJsonArtifactStore(
      join(directory, "artifacts"),
    );
    const input = {
      ...createCampaignInput("campaign-legacy-validator-result"),
      schemaVersion: 2 as const,
      modelProfiles: [
        { id: "opus-planner-v6", digest: digest("5") },
        { id: "opus-finder-v6", digest: digest("6") },
        { id: "opus-evaluator-v6", digest: digest("7") },
        { id: "opus-validator-v6", digest: digest("8") },
      ],
      canonicalFileManifest: {
        kind: "canonical-file-manifest" as const,
        schemaVersion: 1 as const,
        entries: [{ path: "plugin.php", digest: digest("a"), size: 1_000 }],
      },
      budget: {
        maxAttempts: 128,
        maxWallTimeMs: 43_200_000,
        maxModelTokens: 4_000_000,
      },
    };
    const preparationWriter = openResearch({ databasePath, artifactStore });
    const preparation = await preparationWriter.runner.prepare(input);
    preparationWriter.close();
    const plan = createCurrentValidationCampaignPlan({
      preparation,
      campaign: input,
      runId: "legacy-validator-result-run",
      pluginSlug: "legacy-validator-result",
    });
    const attemptId = "validator:1:legacy-completion-only";
    const attemptPlanDigest = digest("9");
    const result = {
      kind: "model-attempt-result" as const,
      schemaVersion: 2 as const,
      attemptId,
      owner: "validation" as const,
      role: "validator" as const,
      planDigest: attemptPlanDigest,
      status: "completed" as const,
      output: {},
      usage: {
        kind: "model-attempt-usage" as const,
        schemaVersion: 1 as const,
        measurement: "reported" as const,
        estimatedCostUsd: 0.25,
        wallTimeMs: 10,
        providerDurationMs: 8,
        modelTurns: 1,
        modelTokens: {
          input: 10,
          cacheCreation: 0,
          cacheRead: 0,
          output: 10,
          total: 20,
        },
        structuredOutputBytes: 2,
        source: { queries: 1, scanBytes: 100, responseBytes: 50 },
        models: [
          {
            id: "claude-opus-5",
            canonicalModel: "claude-opus-5",
            tokens: {
              input: 10,
              cacheCreation: 0,
              cacheRead: 0,
              output: 10,
              total: 20,
            },
          },
        ],
      },
    };
    const resultDigest = await artifactStore.putJson(result);
    const resultRef = {
      kind: "attempt-execution-result" as const,
      schemaVersion: 2 as const,
      attemptId,
      owner: "validation" as const,
      role: "validator" as const,
      planDigest: attemptPlanDigest,
      digest: resultDigest,
    };
    const intent = {
      kind: "campaign-attempt-intent" as const,
      schemaVersion: 2 as const,
      campaignId: input.campaignId,
      runId: plan.runId,
      attemptId,
      ordinal: 1,
      mode: "execute" as const,
      attemptPlanDigest,
      role: "validator" as const,
      candidateId: digest("b"),
      validationAttemptOrdinal: 1,
    };
    const completion = {
      kind: "campaign-attempt-completion" as const,
      schemaVersion: 2 as const,
      campaignId: input.campaignId,
      runId: plan.runId,
      attemptId,
      ordinal: 1,
      role: "validator" as const,
      candidateId: intent.candidateId,
      validationAttemptOrdinal: 1,
      result: resultRef,
    };
    const ledger = new Database(databasePath);
    try {
      const insert = ledger.prepare(`
        INSERT INTO research_events (
          campaign_id,
          campaign_sequence,
          kind,
          schema_version,
          occurred_at,
          payload_json
        ) VALUES (?, ?, ?, ?, ?, ?)
      `);
      insert.run(
        input.campaignId,
        2,
        "campaign.run-started",
        3,
        fixedNow,
        JSON.stringify({ plan, planDigest: sha256Digest(plan) }),
      );
      insert.run(
        input.campaignId,
        3,
        "campaign.attempt-started",
        2,
        fixedNow,
        JSON.stringify({ intent }),
      );
      insert.run(
        input.campaignId,
        4,
        "campaign.attempt-completed",
        2,
        fixedNow,
        JSON.stringify({ completion }),
      );
    } finally {
      ledger.close();
    }

    const research = openResearch({ databasePath, artifactStore });
    try {
      const replayed = await research.reader.inspect(input.campaignId, {
        kind: "progress",
      });
      expect(replayed).toMatchObject({
        kind: "progress",
        counts: {
          attempts: { started: 1, completed: 1, active: 0 },
        },
        activeAttempts: [],
        usage: {
          measurement: "reported",
          modelAttempts: 1,
          reportedModelAttempts: 1,
          modelTokens: { total: 20 },
          estimatedCostUsd: 0.25,
        },
      });
      await expect(
        research.reader.inspect(input.campaignId, { kind: "progress" }),
      ).resolves.toEqual(replayed);
    } finally {
      research.close();
      await rm(directory, { force: true, recursive: true });
    }
  });

  it("rejects an unsupported event version instead of guessing", async () => {
    const directory = await mkdtemp(join(tmpdir(), "wordpress-harness-"));
    const databasePath = join(directory, "future.sqlite");
    createFutureLedger(databasePath);
    const research = openResearch({ databasePath });

    try {
      let rejection: unknown;
      try {
        await research.reader.read("campaign-from-future");
      } catch (error: unknown) {
        rejection = error;
      }

      expect(rejection).toMatchObject({
        name: "UnsupportedLedgerSchemaError",
        eventKind: "campaign.prepared",
        schemaVersion: 4,
      });
    } finally {
      research.close();
      await rm(directory, { force: true, recursive: true });
    }
  });

  it("rejects an event whose input no longer matches its digest", async () => {
    const directory = await mkdtemp(join(tmpdir(), "wordpress-harness-"));
    const databasePath = join(directory, "tampered.sqlite");
    const writer = openResearch({
      databasePath,
      clock: () => new Date(fixedNow),
    });
    await writer.runner.prepare(campaignInput);
    writer.close();

    const tamperer = new Database(databasePath);
    try {
      tamperer
        .prepare(
          `UPDATE research_events
           SET payload_json = replace(
             payload_json,
             '"version":"2.8.11"',
             '"version":"2.8.12"'
           )
           WHERE campaign_id = ?`,
        )
        .run(campaignInput.campaignId);
    } finally {
      tamperer.close();
    }

    const reader = openResearch({ databasePath });
    try {
      let rejection: unknown;
      try {
        await reader.reader.read(campaignInput.campaignId);
      } catch (error: unknown) {
        rejection = error;
      }

      expect(rejection).toMatchObject({
        name: "LedgerIntegrityError",
        campaignId: "campaign-integrity-check",
        reason: "input-digest-mismatch",
      });
    } finally {
      reader.close();
      await rm(directory, { force: true, recursive: true });
    }
  });

  it("rejects an unsupported event after a valid preparation event", async () => {
    const directory = await mkdtemp(join(tmpdir(), "wordpress-harness-"));
    const databasePath = join(directory, "future-tail.sqlite");
    const writer = openResearch({
      databasePath,
      clock: () => new Date(fixedNow),
    });
    await writer.runner.prepare(campaignInput);
    writer.close();

    const futureWriter = new Database(databasePath);
    try {
      futureWriter
        .prepare(
          `INSERT INTO research_events (
            campaign_id,
            campaign_sequence,
            kind,
            schema_version,
            occurred_at,
            payload_json
          ) VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(
          campaignInput.campaignId,
          2,
          "campaign.advanced-in-the-future",
          1,
          "2030-01-01T00:00:00.000Z",
          "{}",
        );
    } finally {
      futureWriter.close();
    }

    const reader = openResearch({ databasePath });
    try {
      let rejection: unknown;
      try {
        await reader.reader.read(campaignInput.campaignId);
      } catch (error: unknown) {
        rejection = error;
      }

      expect(rejection).toMatchObject({
        name: "UnsupportedLedgerSchemaError",
        eventKind: "campaign.advanced-in-the-future",
        schemaVersion: 1,
      });
    } finally {
      reader.close();
      await rm(directory, { force: true, recursive: true });
    }
  });

  it("rejects a Ledger with a non-contiguous Campaign sequence", async () => {
    const directory = await mkdtemp(join(tmpdir(), "wordpress-harness-"));
    const databasePath = join(directory, "sequence-gap.sqlite");
    const writer = openResearch({
      databasePath,
      clock: () => new Date(fixedNow),
    });
    await writer.runner.prepare(campaignInput);
    writer.close();

    const gapWriter = new Database(databasePath);
    try {
      gapWriter.exec(`
        INSERT INTO research_events (
          campaign_id,
          campaign_sequence,
          kind,
          schema_version,
          occurred_at,
          payload_json
        )
        SELECT
          campaign_id,
          3,
          kind,
          schema_version,
          occurred_at,
          payload_json
        FROM research_events
        WHERE campaign_id = 'campaign-integrity-check';
      `);
    } finally {
      gapWriter.close();
    }

    const reader = openResearch({ databasePath });
    try {
      let rejection: unknown;
      try {
        await reader.reader.read(campaignInput.campaignId);
      } catch (error: unknown) {
        rejection = error;
      }

      expect(rejection).toMatchObject({
        name: "LedgerIntegrityError",
        campaignId: "campaign-integrity-check",
        reason: "non-contiguous-sequence",
      });
    } finally {
      reader.close();
      await rm(directory, { force: true, recursive: true });
    }
  });

  it("rejects a second preparation event in the current state model", async () => {
    const directory = await mkdtemp(join(tmpdir(), "wordpress-harness-"));
    const databasePath = join(directory, "duplicate-preparation.sqlite");
    const writer = openResearch({
      databasePath,
      clock: () => new Date(fixedNow),
    });
    await writer.runner.prepare(campaignInput);
    writer.close();

    const duplicateWriter = new Database(databasePath);
    try {
      duplicateWriter.exec(`
        INSERT INTO research_events (
          campaign_id,
          campaign_sequence,
          kind,
          schema_version,
          occurred_at,
          payload_json
        )
        SELECT
          campaign_id,
          2,
          kind,
          schema_version,
          occurred_at,
          payload_json
        FROM research_events
        WHERE campaign_id = 'campaign-integrity-check';
      `);
    } finally {
      duplicateWriter.close();
    }

    const reader = openResearch({ databasePath });
    try {
      let rejection: unknown;
      try {
        await reader.reader.read(campaignInput.campaignId);
      } catch (error: unknown) {
        rejection = error;
      }

      expect(rejection).toMatchObject({
        name: "LedgerIntegrityError",
        campaignId: "campaign-integrity-check",
        reason: "invalid-event-order",
      });
    } finally {
      reader.close();
      await rm(directory, { force: true, recursive: true });
    }
  });

  it("rejects an event moved under a different CampaignId", async () => {
    const directory = await mkdtemp(join(tmpdir(), "wordpress-harness-"));
    const databasePath = join(directory, "campaign-id-mismatch.sqlite");
    const writer = openResearch({
      databasePath,
      clock: () => new Date(fixedNow),
    });
    await writer.runner.prepare(campaignInput);
    writer.close();

    const mover = new Database(databasePath);
    try {
      mover
        .prepare(
          `UPDATE research_events
           SET campaign_id = ?
           WHERE campaign_id = ?`,
        )
        .run("moved-campaign", campaignInput.campaignId);
    } finally {
      mover.close();
    }

    const reader = openResearch({ databasePath });
    try {
      let rejection: unknown;
      try {
        await reader.reader.read("moved-campaign");
      } catch (error: unknown) {
        rejection = error;
      }

      expect(rejection).toMatchObject({
        name: "LedgerIntegrityError",
        campaignId: "moved-campaign",
        reason: "campaign-id-mismatch",
      });
    } finally {
      reader.close();
      await rm(directory, { force: true, recursive: true });
    }
  });

  it("replays a completed Verification whose v1 Hypothesis uses the historical node route", async () => {
    const directory = await mkdtemp(join(tmpdir(), "wordpress-harness-"));
    const databasePath = join(directory, "historical-verification.sqlite");
    const campaignId = "campaign-historical-verification";
    const verificationId = "verification-historical-node-route";
    const input = createCampaignInput(campaignId);
    const writer = openResearch({
      databasePath,
      clock: () => new Date(fixedNow),
    });
    await writer.runner.prepare(input);
    writer.close();

    const hypothesis = {
      kind: "source-bound-hypothesis",
      schemaVersion: 1,
      causalIdentity: {
        rootCause: "stored-value-output-without-context-escaping",
        attackerControlledPrimitive: "unauthenticated-persistent-form-value",
        brokenSecurityProperty: "admin-browser-script-integrity",
      },
      attackerPremise: "unauthenticated",
      impact: "stored-xss",
      route: {
        anchorNodeId: digest("a"),
        nodeIds: [digest("a"), digest("b")],
        relationIds: [digest("c")],
      },
      unknowns: [
        {
          claim: "the value reaches an administrator browser",
          requiredEvidence: "a fresh browser execution canary observation",
        },
      ],
      falsifier: "the value is context-escaped before privileged rendering",
      nextExperiment: "submit a canary and open the privileged view",
    };
    const plan = {
      kind: "verification-plan",
      schemaVersion: 1,
      verificationId,
      campaignId,
      targetSnapshot: input.targetSnapshot,
      scope: { permittedAttacker: "unauthenticated" },
      hypothesis,
      hypothesisDigest: sha256Digest(hypothesis),
      labBaseline: {
        kind: "lab-baseline",
        schemaVersion: 1,
        id: "historical-baseline",
        digest: digest("d"),
        targetSnapshotDigest: input.targetSnapshot.digest,
        runtimeProfileDigest: input.runtimeProfile.digest,
        setupPlanDigest: digest("e"),
        configurationDigest: digest("f"),
      },
      verifierModelProfile: {
        kind: "model-profile",
        schemaVersion: 1,
        id: "historical-verifier",
        family: "claude",
        digest: input.modelProfiles[0]?.digest,
      },
      promptSet: {
        kind: "prompt-set",
        schemaVersion: 1,
        id: input.promptSet.id,
        digest: input.promptSet.digest,
      },
      verificationPolicy: {
        kind: "verification-policy",
        schemaVersion: 1,
        id: "historical-verification-policy",
        digest: digest("1"),
      },
      experimentRegistry: {
        kind: "experiment-registry",
        schemaVersion: 1,
        id: input.experimentRegistry.id,
        digest: input.experimentRegistry.digest,
      },
      budget: {
        maxVerifierAttempts: 1,
        maxExperiments: 2,
        maxWallTimeMs: 300_000,
      },
    };
    const planDigest = sha256Digest(plan);
    const completedAt = "2026-09-01T12:01:00.000Z";
    const record = {
      kind: "verification-record",
      schemaVersion: 1,
      verificationId,
      campaignId,
      planDigest,
      targetSnapshotDigest: input.targetSnapshot.digest,
      hypothesisDigest: plan.hypothesisDigest,
      evidence: {
        kind: "experiment-pair",
        sourceRederivation: {
          kind: "source-rederivation",
          schemaVersion: 1,
          digest: digest("2"),
        },
        witness: {
          kind: "experiment-observation",
          schemaVersion: 1,
          experimentId: digest("3"),
          digest: digest("4"),
        },
        control: {
          kind: "experiment-observation",
          schemaVersion: 1,
          experimentId: digest("5"),
          digest: digest("6"),
        },
      },
      outcome: {
        kind: "finding",
        causalIdentity: hypothesis.causalIdentity,
      },
      completedAt,
    };
    const ledger = new Database(databasePath);
    try {
      const insert = ledger.prepare(`
        INSERT INTO research_events (
          campaign_id,
          campaign_sequence,
          kind,
          schema_version,
          occurred_at,
          payload_json
        ) VALUES (?, ?, ?, 1, ?, ?)
      `);
      insert.run(
        campaignId,
        2,
        "verification.started",
        fixedNow,
        JSON.stringify({ plan, planDigest }),
      );
      insert.run(
        campaignId,
        3,
        "verification.completed",
        completedAt,
        JSON.stringify({
          completionInputDigest: digest("7"),
          record,
          recordDigest: sha256Digest(record),
        }),
      );
    } finally {
      ledger.close();
    }

    const reader = openSqliteResearchRecord({ databasePath });
    try {
      await expect(
        reader.readVerification(campaignId, verificationId),
      ).resolves.toMatchObject({
        ref: { outcome: "finding", verificationId },
        value: { planDigest, hypothesisDigest: plan.hypothesisDigest },
      });
    } finally {
      reader.close();
      await rm(directory, { force: true, recursive: true });
    }
  });
});
