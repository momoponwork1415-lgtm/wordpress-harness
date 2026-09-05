import Database from "better-sqlite3";

import {
  canonicalJson,
  sha256Digest,
} from "../../../src/target-intelligence/acquisition/canonical-json.js";

const digest = (character: string): string => `sha256:${character.repeat(64)}`;

function shortId(prefix: string, value: string): string {
  return `${prefix}:${value.slice("sha256:".length, "sha256:".length + 24)}`;
}

export function createLegacyTargetResearchHistoryFixture(
  databasePath: string,
): { readonly campaignId: string } {
  const request = {
    kind: "target-research-admission",
    schemaVersion: 1,
    target: {
      pluginIdentity: "wporg:example-security",
      verifiedVersion: "2.4.1",
      canonicalFileManifestDigest: digest("1"),
    },
    campaign: {
      kind: "prospective",
      runOrdinal: 1,
      policy: { id: "selection-policy-v1", digest: digest("2") },
      profile: { id: "semantic-research-v6", digest: digest("3") },
      purpose: "Investigate CVE-2029-0001 and its known route",
    },
  };
  const targetDigest = sha256Digest({
    kind: "target-research-identity",
    schemaVersion: 1,
    ...request.target,
  });
  const campaignDigest = sha256Digest({
    kind: "target-research-campaign-identity",
    schemaVersion: 1,
    target: request.target,
    definition: request.campaign,
  });
  const campaignId = shortId("campaign", campaignDigest);
  const events = [
    {
      occurredAt: "2029-01-01T00:00:00.000Z",
      payload: {
        kind: "target-research-campaign-selected",
        schemaVersion: 1,
        targetId: shortId("target", targetDigest),
        campaignId,
        campaignDigest,
        request,
      },
    },
    {
      occurredAt: "2029-01-01T00:01:00.000Z",
      payload: {
        kind: "target-research-campaign-recorded",
        schemaVersion: 1,
        input: {
          kind: "target-research-history-record",
          schemaVersion: 1,
          campaignId,
          event: { kind: "campaign-started" },
        },
      },
    },
    {
      occurredAt: "2029-01-01T01:00:00.000Z",
      payload: {
        kind: "target-research-campaign-recorded",
        schemaVersion: 1,
        input: {
          kind: "target-research-history-record",
          schemaVersion: 1,
          campaignId,
          event: {
            kind: "campaign-completed",
            terminalStatus: "incomplete",
            reason: "Known advisory confirms the existing Finding",
          },
        },
      },
    },
  ];

  const database = new Database(databasePath);
  database.exec(`
    CREATE TABLE target_research_history_events (
      global_sequence INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id TEXT NOT NULL UNIQUE,
      event_digest TEXT NOT NULL UNIQUE,
      occurred_at TEXT NOT NULL,
      payload_json TEXT NOT NULL
    ) STRICT;
  `);
  const insert = database.prepare(
    `INSERT INTO target_research_history_events (
       event_id, event_digest, occurred_at, payload_json
     ) VALUES (?, ?, ?, ?)`,
  );
  for (const event of events) {
    const eventDigest = sha256Digest(event.payload);
    insert.run(
      shortId("history", eventDigest),
      eventDigest,
      event.occurredAt,
      canonicalJson(event.payload),
    );
  }
  database.close();
  return { campaignId };
}
