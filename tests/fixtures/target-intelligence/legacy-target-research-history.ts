const digest = (character: string): string => `sha256:${character.repeat(64)}`;

export function createLegacyTargetResearchHistoryFixture() {
  return {
    artifact: {
      kind: "target-research-legacy-history-artifact" as const,
      schemaVersion: 1 as const,
      entries: [
        {
          kind: "campaign-selected" as const,
          campaignKey: "legacy-campaign",
          occurredAt: "2029-01-01T00:00:00.000Z",
          request: {
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
              purpose: "Investigate CVE-2029-0001 and its known route",
            },
          },
        },
        {
          kind: "campaign-recorded" as const,
          campaignKey: "legacy-campaign",
          occurredAt: "2029-01-01T00:01:00.000Z",
          event: { kind: "campaign-started" as const },
        },
        {
          kind: "campaign-recorded" as const,
          campaignKey: "legacy-campaign",
          occurredAt: "2029-01-01T01:00:00.000Z",
          event: {
            kind: "campaign-completed" as const,
            terminalStatus: "incomplete" as const,
            reason: "Known advisory confirms the existing Finding",
          },
        },
      ],
    },
  };
}
