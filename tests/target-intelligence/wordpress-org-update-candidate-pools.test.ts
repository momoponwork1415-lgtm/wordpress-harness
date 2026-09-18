import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  defineAgentRuntimeProfile,
  grokBuildNativeTransport,
} from "../../src/infrastructure/agent-runtime-profile.js";
import type {
  TargetIntakePolicy,
  WordPressOrgAcquisitionResult,
  WordPressOrgTargetSource,
} from "../../src/target-intelligence/acquisition/index.js";
import {
  defineWordPressOrgCandidatePoolFreshnessPolicy,
  openWordPressOrgUpdateCandidatePools,
  type WordPressOrgCandidateSelectionContext,
} from "../../src/target-intelligence/candidate-pool/index.js";
import {
  openTargetProposals,
  type TargetProposalAgent,
} from "../../src/target-intelligence/target-proposal/index.js";
import type {
  WordPressOrgUpdateFrontier,
  WordPressOrgUpdateFrontierRef,
  WordPressOrgUpdateFrontiers,
} from "../../src/target-intelligence/update-frontier/index.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

const digest = (character: string): string => `sha256:${character.repeat(64)}`;

const intakePolicy: TargetIntakePolicy = {
  kind: "target-intake-policy",
  schemaVersion: 1,
  id: "wporg-update-intake-v1",
  digest: digest("1"),
  limits: {
    maxEntries: 1_000,
    maxFileBytes: 2_000_000,
    maxTotalBytes: 20_000_000,
    maxPathBytes: 512,
    maxDepth: 20,
  },
};

const freshnessPolicy = defineWordPressOrgCandidatePoolFreshnessPolicy({
  id: "wporg-candidate-freshness-v1",
  maximumAgeMs: 86_400_000,
});

function updateFrontier(slugs: readonly string[]): {
  readonly frontier: WordPressOrgUpdateFrontier;
  readonly ref: WordPressOrgUpdateFrontierRef;
} {
  const leads = slugs.map((slug, index) => ({
    pluginIdentity: `wporg:${slug}`,
    officialSlug: slug,
    stableVersion: "2.4.1",
    activeInstallations: 20_000 + index,
    lastUpdated: "2026-09-14T09:00:00Z",
    observedAt: "2026-09-14T10:00:00.000Z",
    observationRef: {
      kind: "wordpress-org-target-observation-ref" as const,
      schemaVersion: 1 as const,
      id: `wporg-observation:${slug}`,
      digest: digest("2"),
    },
    changesets: [
      {
        revision: 5_001 + index,
        committedAt: `2026-09-14T09:0${index + 1}:00.000Z`,
        changedPhpFiles: 2,
        addedPhpLines: 7,
        navigationSignals: [
          "authorization-boundary" as const,
          "request-input" as const,
        ],
        evidenceRef: {
          id: `wporg-update-evidence:${slug}`,
          digest: digest("3"),
          byteLength: 300,
        },
      },
    ],
  }));
  const frontier: WordPressOrgUpdateFrontier = {
    kind: "wordpress-org-update-frontier",
    schemaVersion: 1,
    id: "wporg-update-frontier:fixture",
    digest: digest("4"),
    inputDigest: digest("5"),
    frontierKey: "hourly-updates",
    revision: 1,
    generatedAt: "2026-09-14T10:00:00.000Z",
    source: {
      kind: "wordpress-org-svn",
      repositoryUrl: "https://plugins.svn.wordpress.org",
      parserVersion: "wordpress-org-svn-update-frontier-v1",
      logEvidenceRef: {
        id: "wporg-update-evidence:log",
        digest: digest("6"),
        byteLength: 500,
      },
    },
    cursor: {
      fromRevisionExclusive: 5_000,
      toRevisionInclusive: 5_000 + slugs.length,
    },
    policy: { id: "update-frontier-v1", digest: digest("7") },
    leads,
    unresolved: [],
    filtered: {
      belowMinimumActiveInstallations: 0,
      revisionsWithoutTrunkPhpChanges: 0,
    },
  };
  return {
    frontier,
    ref: {
      kind: "wordpress-org-update-frontier-ref",
      schemaVersion: 1,
      id: frontier.id,
      digest: frontier.digest,
      frontierKey: frontier.frontierKey,
      revision: frontier.revision,
      toRevisionInclusive: frontier.cursor.toRevisionInclusive,
    },
  };
}

function frontierStore(
  fixture: ReturnType<typeof updateFrontier>,
): WordPressOrgUpdateFrontiers {
  return {
    refresh: async () => ({ status: "current", frontierRef: fixture.ref }),
    inspect: async (ref) => {
      expect(ref).toEqual(fixture.ref);
      return fixture.frontier;
    },
  };
}

function readyAcquisition(
  pluginIdentity: string,
  version = "2.4.1",
): WordPressOrgAcquisitionResult {
  const slug = pluginIdentity.slice("wporg:".length);
  const packetRef = { id: `artifact:${slug}`, digest: digest("8") };
  const receiptRef = { id: `receipt:${slug}`, digest: digest("9") };
  return {
    status: "ready",
    acquisitionOriginal: {
      kind: "wordpress-org-acquisition-original",
      schemaVersion: 1,
      pluginIdentity,
      version,
      sourceUrl: `https://downloads.wordpress.org/plugin/${slug}.${version}.zip`,
      retrievedAt: "2026-09-15T00:00:00.000Z",
      contentDigest: digest("a"),
      size: 10_000,
      observationRef: {
        kind: "wordpress-org-target-observation-ref",
        schemaVersion: 1,
        id: `wporg-observation:${slug}`,
        digest: digest("2"),
      },
    },
    acquisitionOriginalRef: {
      id: `wporg-archive:${slug}`,
      digest: digest("a"),
    },
    intake: {
      status: "ready",
      packet: {
        kind: "target-intake-packet",
        schemaVersion: 1,
        id: `packet:${slug}`,
        pluginIdentity,
        version,
        canonicalInstallDirectory: slug,
        mainPluginFile: `${slug}.php`,
        pluginBasename: `${slug}/${slug}.php`,
        targetSnapshot: {
          id: `target:${slug}`,
          pluginSlug: slug,
          version,
          digest: digest("b"),
        },
        sourceTree: {
          digest: digest("c"),
          entries: 2,
          manifest: {
            kind: "canonical-file-manifest",
            schemaVersion: 1,
            entries: [
              { path: `${slug}.php`, digest: digest("d"), size: 500 },
              {
                path: "includes/feature.php",
                digest: digest("e"),
                size: 900,
              },
            ],
          },
        },
        sourceCapture: {
          kind: "captured-wordpress-org-archive",
          digest: digest("c"),
          files: [
            { path: `${slug}.php`, digest: digest("d"), size: 500 },
            {
              path: "includes/feature.php",
              digest: digest("e"),
              size: 900,
            },
          ],
        },
        versionEvidence: {
          requestedVersion: version,
          mainHeaderVersion: version,
          mainFileDigest: digest("d"),
        },
        provenance: {
          kind: "wordpress-org",
          sourceUrl: `https://downloads.wordpress.org/plugin/${slug}.${version}.zip`,
          acquisitionRef: {
            id: `wporg-archive:${slug}`,
            digest: digest("a"),
          },
        },
        policy: { id: intakePolicy.id, digest: intakePolicy.digest },
      },
      packetRef,
      receipt: {
        kind: "target-intake-receipt",
        schemaVersion: 1,
        id: `receipt:${slug}`,
        requestDigest: digest("f"),
        policy: { id: intakePolicy.id, digest: intakePolicy.digest },
        status: "ready",
        reasons: [],
        packetRef,
      },
      receiptRef,
    },
  };
}

function selectionContext(
  slug: string,
  currentUntil = "2026-09-16T00:00:00.000Z",
): WordPressOrgCandidateSelectionContext {
  return {
    pluginIdentity: `wporg:${slug}`,
    integrations: ["contact-form"],
    programmes: [
      {
        programmeIdentity: "programme:example",
        snapshotRef: {
          id: "programme-example",
          digest: digest("1"),
        },
        opportunityBand: "research-only",
        eligibility: "eligible",
        currentUntil,
      },
    ],
    disclosureRoute: {
      observationRef: {
        id: `route-${slug}`,
        digest: digest("2"),
        routeDigest: digest("3"),
      },
      kind: "delegated-vdp",
      currentUntil,
    },
    vulnerabilityHistoryAggregate: {
      snapshotRef: { id: "history-example", digest: digest("4") },
      publishedRecordCount: 3,
      densityBand: "low",
      lastPublishedAt: "2025-12-01T00:00:00.000Z",
    },
    researchHistory: { status: "new" },
  };
}

function assemblyRequest(
  frontierRef: WordPressOrgUpdateFrontierRef,
  selectionContexts: readonly WordPressOrgCandidateSelectionContext[],
) {
  return {
    kind: "wordpress-org-update-candidate-pool-assembly" as const,
    schemaVersion: 1 as const,
    assemblyKey: "hourly-update-candidates",
    revision: 1,
    candidatePoolId: "candidate-pool-hourly-updates",
    updateFrontierRef: frontierRef,
    targetIntakePolicy: intakePolicy,
    freshnessPolicy,
    selectionContexts: [...selectionContexts],
  };
}

describe("WordPressOrgUpdateCandidatePools", () => {
  it("reacquires exact source and feeds an oracle-free update Candidate Pool to Target Proposals", async () => {
    const directory = await mkdtemp(join(tmpdir(), "update-candidate-pool-"));
    temporaryDirectories.push(directory);
    const fixture = updateFrontier(["updated-plugin"]);
    const acquire = vi.fn<WordPressOrgTargetSource["acquire"]>();
    acquire.mockResolvedValue(readyAcquisition("wporg:updated-plugin"));
    const targetSource: WordPressOrgTargetSource = {
      observe: async () => {
        throw new Error("Candidate assembly must use the bound observation");
      },
      acquire,
    };
    const pools = openWordPressOrgUpdateCandidatePools({
      storageDirectory: directory,
      updateFrontiers: frontierStore(fixture),
      targetSource,
      clock: () => new Date("2026-09-15T00:00:00.000Z"),
    });

    const result = await pools.assemble(
      assemblyRequest(fixture.ref, [selectionContext("updated-plugin")]),
    );
    expect(result).toMatchObject({ status: "assembled" });
    if (result.status !== "assembled") {
      throw new Error("Expected an assembled Candidate Pool");
    }
    const record = await pools.inspect(result.assemblyRef);
    if (record.status !== "assembled") {
      throw new Error("Expected an assembled Candidate Pool record");
    }
    expect(record).toMatchObject({
      status: "assembled",
      unresolved: [],
      candidatePool: {
        id: "candidate-pool-hourly-updates",
        candidates: [
          {
            target: {
              pluginIdentity: "wporg:updated-plugin",
              verifiedVersion: "2.4.1",
              canonicalFileManifestDigest: digest("c"),
            },
            targetObservation: {
              retrievedAt: "2026-09-14T10:00:00.000Z",
              currentUntil: "2026-09-15T10:00:00.000Z",
              acquisition: "available",
              provenance: "verified",
              identity: "verified",
            },
            selectionFacts: {
              activeInstallCount: 20_000,
              lastUpdatedAt: "2026-09-14T09:00:00.000Z",
              integrations: ["contact-form"],
              updateActivity: {
                frontierRef: {
                  id: fixture.ref.id,
                  digest: fixture.ref.digest,
                },
                fromRevisionExclusive: 5_000,
                toRevisionInclusive: 5_001,
                changesetCount: 1,
                changedPhpFileOccurrences: 2,
                addedPhpLines: 7,
                navigationSignals: ["authorization-boundary", "request-input"],
              },
            },
            programmes: [{ eligibility: "eligible" }],
            disclosureRoute: { kind: "delegated-vdp" },
            vulnerabilityHistoryAggregate: { publishedRecordCount: 3 },
            researchHistory: { status: "new" },
          },
        ],
      },
    });
    expect(acquire).toHaveBeenCalledWith({
      kind: "wordpress-org-target-acquire",
      schemaVersion: 1,
      observationRef: fixture.frontier.leads[0]?.observationRef,
      requestedVersion: "2.4.1",
      policy: intakePolicy,
    });

    const serialized = JSON.stringify(record.candidatePool);
    expect(serialized).not.toMatch(
      /private-route\.php|private_value|file_put_contents|advisory|patch|proof.of.concept|affected.function/i,
    );

    const agent: TargetProposalAgent = {
      async execute(run) {
        expect(run.candidatePool).toEqual(record.candidatePool);
        const candidateId = run.candidatePool.candidates[0]?.candidateId;
        if (candidateId === undefined) throw new Error("Expected a candidate");
        return {
          schemaVersion: 1,
          runId: run.runId,
          runtimeProfileDigest: run.agentRuntimeProfile.digest,
          terminal: "completed",
          startedAt: "2026-09-15T00:01:00.000Z",
          completedAt: "2026-09-15T00:02:00.000Z",
          usage: { wallTimeMs: 60_000 },
          activity: { subagents: 0, tools: null },
          report: {
            schemaVersion: 1,
            basis: "A recent source change warrants prospective Research.",
            targets: [
              {
                candidateId,
                reason: "The changed security boundaries warrant review.",
                uncertainty: "No vulnerability is known before Research.",
              },
            ],
          },
        };
      },
    };
    const proposals = openTargetProposals({
      storageDirectory: directory,
      agent,
      clock: () => new Date("2026-09-15T00:03:00.000Z"),
    });
    await expect(
      proposals.propose({
        kind: "target-selection-run-input",
        schemaVersion: 1,
        selectionKey: "update-triggered-targets",
        revision: 1,
        candidatePool: record.candidatePool,
        selectionGuidance: {
          id: "selection-guidance-v1",
          digest: digest("5"),
        },
        agentRuntimeProfile: defineAgentRuntimeProfile({
          id: "grok-target-proposal-v1",
          ...grokBuildNativeTransport,
          model: "grok-4.6",
          effort: "xhigh",
        }),
        permissionProfile: {
          id: "oracle-free-selection-v1",
          digest: digest("7"),
        },
        budgetEnvelope: {
          id: "target-proposal-budget-v1",
          maxWallTimeMs: 300_000,
          digest: digest("8"),
        },
      }),
    ).resolves.toMatchObject({ status: "proposed" });
  });

  it("preserves missing, stale, and failed source facts as assembly gaps", async () => {
    const directory = await mkdtemp(join(tmpdir(), "update-pool-gaps-"));
    temporaryDirectories.push(directory);
    const fixture = updateFrontier([
      "binding-mismatch",
      "missing-context",
      "stale-context",
      "source-fails",
    ]);
    const targetSource: WordPressOrgTargetSource = {
      observe: async () => {
        throw new Error("Not used");
      },
      acquire: async (request) => {
        const pluginIdentity = request.observationRef.id.replace(
          "wporg-observation:",
          "wporg:",
        );
        return pluginIdentity === "wporg:binding-mismatch"
          ? readyAcquisition(pluginIdentity, "9.9.9")
          : {
              status: "failed",
              operation: "acquire",
              pluginIdentity,
              reason: "network-failure",
            };
      },
    };
    const pools = openWordPressOrgUpdateCandidatePools({
      storageDirectory: directory,
      updateFrontiers: frontierStore(fixture),
      targetSource,
      clock: () => new Date("2026-09-15T00:00:00.000Z"),
    });

    const result = await pools.assemble(
      assemblyRequest(fixture.ref, [
        selectionContext("binding-mismatch"),
        selectionContext("stale-context", "2026-09-14T23:00:00.000Z"),
        selectionContext("source-fails"),
      ]),
    );
    expect(result).toMatchObject({ status: "assembly-pending" });
    const record = await pools.inspect(result.assemblyRef);
    expect(record).toMatchObject({
      status: "assembly-pending",
      unresolved: [
        {
          pluginIdentity: "wporg:binding-mismatch",
          reason: "source-binding-mismatch",
        },
        {
          pluginIdentity: "wporg:missing-context",
          reason: "selection-context-missing",
        },
        {
          pluginIdentity: "wporg:source-fails",
          reason: "source-acquisition-failed",
          detail: "network-failure",
        },
        {
          pluginIdentity: "wporg:stale-context",
          reason: "selection-observation-expired",
        },
      ],
    });
    expect("candidatePool" in record).toBe(false);
  });

  it("is idempotent and fails closed on context outside the frontier, input conflict, or artifact tampering", async () => {
    const directory = await mkdtemp(join(tmpdir(), "update-pool-integrity-"));
    temporaryDirectories.push(directory);
    const fixture = updateFrontier(["integrity-plugin"]);
    let acquisitions = 0;
    const options = {
      storageDirectory: directory,
      updateFrontiers: frontierStore(fixture),
      targetSource: {
        observe: async () => {
          throw new Error("Not used");
        },
        acquire: async () => {
          acquisitions += 1;
          return readyAcquisition("wporg:integrity-plugin");
        },
      } satisfies WordPressOrgTargetSource,
      clock: () => new Date("2026-09-15T00:00:00.000Z"),
    };
    const pools = openWordPressOrgUpdateCandidatePools(options);
    const request = assemblyRequest(fixture.ref, [
      selectionContext("integrity-plugin"),
    ]);
    const first = await pools.assemble(request);
    await expect(
      openWordPressOrgUpdateCandidatePools(options).assemble(request),
    ).resolves.toEqual(first);
    expect(acquisitions).toBe(1);

    await expect(
      pools.assemble({
        ...request,
        freshnessPolicy: defineWordPressOrgCandidatePoolFreshnessPolicy({
          id: "different-freshness-v1",
          maximumAgeMs: 172_800_000,
        }),
      }),
    ).rejects.toThrow("Candidate Pool Assembly revision input conflict");

    const extraContextDirectory = await mkdtemp(
      join(tmpdir(), "update-pool-extra-context-"),
    );
    temporaryDirectories.push(extraContextDirectory);
    await expect(
      openWordPressOrgUpdateCandidatePools({
        ...options,
        storageDirectory: extraContextDirectory,
      }).assemble(
        assemblyRequest(fixture.ref, [
          selectionContext("integrity-plugin"),
          selectionContext("outside-frontier"),
        ]),
      ),
    ).rejects.toThrow("Selection Context is outside the Update Frontier");

    if (first.status !== "assembled") {
      throw new Error("Expected an assembled record");
    }
    const recordPath = join(
      directory,
      "wordpress-org-update-candidate-pools-v1",
      "hourly-update-candidates.revision-1.json",
    );
    const tampered = JSON.parse(await readFile(recordPath, "utf8")) as {
      digest: string;
    };
    tampered.digest = digest("0");
    await writeFile(recordPath, JSON.stringify(tampered));
    await expect(pools.inspect(first.assemblyRef)).rejects.toThrow(
      "Candidate Pool Assembly digest mismatch",
    );
  });
});
