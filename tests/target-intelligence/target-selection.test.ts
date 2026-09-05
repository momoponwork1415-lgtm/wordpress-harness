import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  TargetSelectionModelError,
  openTargetSelection,
  targetSelectionAttemptSchema,
  type TargetSelectionCandidate,
  type TargetSelectionModel,
  type TargetSelectionRequest,
} from "../../src/target-intelligence/index.js";
import { sha256Digest } from "../../src/target-intelligence/acquisition/canonical-json.js";
import { createLegacyTargetSelectionFixture } from "../fixtures/target-intelligence/legacy-target-selection.js";

const digest = (character: string): string => `sha256:${character.repeat(64)}`;

const policy = {
  kind: "target-selection-policy" as const,
  schemaVersion: 1 as const,
  id: "selection-policy-v1",
  digest: digest("a"),
  batchSize: 3,
  diversity: { maximumPerFacetValue: 2 },
};

const modelProfile = {
  kind: "target-selection-model-profile" as const,
  schemaVersion: 1 as const,
  id: "opus-selection-v1",
  digest: digest("b"),
  family: "opus" as const,
};

function candidate(
  id: string,
  overrides: Partial<TargetSelectionCandidate> = {},
): TargetSelectionCandidate {
  const suffix = id.replaceAll(/[^a-z0-9]/g, "-");
  return {
    candidateId: id,
    origin: { kind: "autonomous-observation" },
    target: {
      pluginIdentity: `wporg:${suffix}`,
      verifiedVersion: "1.0.0",
      canonicalFileManifestDigest: digest("c"),
    },
    targetObservation: {
      ref: { id: `target-observation:${suffix}`, digest: digest("d") },
      retrievedAt: "2030-08-31T00:00:00.000Z",
      currentUntil: "2030-09-02T00:00:00.000Z",
      acquisition: "available",
      provenance: "verified",
      identity: "verified",
    },
    selectionFacts: {
      activeInstallCount: 10000,
      lastUpdatedAt: "2030-08-01T00:00:00.000Z",
      integrations: ["wordpress-rest-api"],
      sourceScale: {
        fileCount: 120,
        byteCount: 500000,
        languages: ["php", "javascript"],
      },
    },
    programmes: [
      {
        programmeIdentity: "programme:patchstack",
        snapshotRef: {
          id: "programme-snapshot:patchstack",
          digest: digest("e"),
        },
        opportunityBand: "broad",
        eligibility: "eligible",
        currentUntil: "2030-09-02T00:00:00.000Z",
      },
      {
        programmeIdentity: "programme:wordfence",
        snapshotRef: {
          id: "programme-snapshot:wordfence",
          digest: digest("f"),
        },
        opportunityBand: "high-impact-only",
        eligibility: "eligible",
        currentUntil: "2030-09-02T00:00:00.000Z",
      },
    ],
    disclosureRoute: {
      observationRef: {
        id: `disclosure-route:${suffix}`,
        digest: digest("1"),
        routeDigest: digest("2"),
      },
      kind: "first-party-bounty",
      currentUntil: "2030-09-02T00:00:00.000Z",
    },
    vulnerabilityHistoryAggregate: {
      snapshotRef: {
        id: "wordfence-intelligence:fixture",
        digest: digest("3"),
      },
      publishedRecordCount: 4,
      densityBand: "low",
      lastPublishedAt: "2029-12-01T00:00:00.000Z",
    },
    researchHistory: { status: "new" },
    diversity: {
      vendor: `vendor-${suffix}`,
      pluginFamily: `family-${suffix}`,
      useCase: `use-${suffix}`,
      sizeBand: "medium",
      authorityModel: "mixed",
      integrations: ["wordpress-rest-api"],
    },
    ...overrides,
  };
}

function request(
  candidates: readonly TargetSelectionCandidate[],
): TargetSelectionRequest {
  return {
    kind: "target-selection-request",
    schemaVersion: 2,
    selectionKey: "september-selection",
    revision: 1,
    policy,
    modelProfile,
    candidates: [...candidates],
  };
}

async function selectedAttemptFixture(
  directory: string,
  candidates: readonly TargetSelectionCandidate[],
) {
  const input = request(candidates);
  const selection = openTargetSelection({
    storageDirectory: directory,
    model: {
      rank: async (modelInput) => ({
        kind: "target-selection-model-result",
        schemaVersion: 1,
        rankedCandidateIds: modelInput.candidates.map(
          ({ candidateId }) => candidateId,
        ),
        assessments: modelInput.candidates.map(({ candidateId }) => ({
          candidateId,
          researchValueBand: "high",
          uncertaintyBand: "medium",
          reasonCodes: ["recently-updated"],
        })),
      }),
    },
    clock: () => new Date("2030-09-01T00:00:00.000Z"),
  });
  const selected = await selection.select(input);
  if (selected.status !== "selected") {
    throw new Error("Expected a selected Attempt fixture");
  }
  const path = join(
    directory,
    "target-selection-attempts",
    "september-selection.revision-1.json",
  );
  const stored = targetSelectionAttemptSchema.parse(
    JSON.parse(await readFile(path, "utf8")),
  );
  if (stored.status !== "selected") {
    throw new Error("Expected a durable selected Attempt fixture");
  }
  return { input, path, selected, stored };
}

describe("TargetSelection", () => {
  it("creates a durable model-free nomination-only Attempt through the public seam", async () => {
    const directory = await mkdtemp(
      join(tmpdir(), "target-selection-nomination-only-"),
    );
    let modelCalls = 0;
    const input = request([]);
    try {
      const selection = openTargetSelection({
        storageDirectory: directory,
        model: {
          rank: async () => {
            modelCalls += 1;
            throw new Error("nomination-only must not rank");
          },
        },
        clock: () => new Date("2030-09-01T00:00:00.000Z"),
      });
      const selected = await selection.select(input);

      expect(selected).toMatchObject({ status: "selected", receipts: [] });
      expect(modelCalls).toBe(0);
      const restarted = openTargetSelection({
        storageDirectory: directory,
        model: {
          rank: () => Promise.reject(new Error("must not rank on restart")),
        },
      });
      await expect(restarted.select(input)).resolves.toEqual(selected);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("rejects duplicate Target identities through the public selection seam before ranking", async () => {
    const directory = await mkdtemp(
      join(tmpdir(), "target-selection-duplicate-target-"),
    );
    let modelCalls = 0;
    try {
      const first = candidate("candidate-first");
      const second = candidate("candidate-second", { target: first.target });
      const selection = openTargetSelection({
        storageDirectory: directory,
        model: {
          rank: async () => {
            modelCalls += 1;
            throw new Error("duplicate Target must not reach ranking");
          },
        },
      });

      await expect(selection.select(request([first, second]))).rejects.toThrow(
        "A Target may occur only once in the Candidate Pool",
      );
      expect(modelCalls).toBe(0);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("selects one stable finite batch from a programme-neutral Candidate Pool", async () => {
    const directory = await mkdtemp(join(tmpdir(), "target-selection-"));
    let modelCalls = 0;
    const model: TargetSelectionModel = {
      rank: async (input) => {
        modelCalls += 1;
        return {
          kind: "target-selection-model-result",
          schemaVersion: 1,
          rankedCandidateIds: input.candidates.map(
            ({ candidateId }) => candidateId,
          ),
          assessments: input.candidates.map(({ candidateId }) => ({
            candidateId,
            researchValueBand: "high",
            uncertaintyBand: "medium",
            reasonCodes: ["large-active-install-base", "public-integrations"],
          })),
        };
      },
    };
    try {
      const selection = openTargetSelection({
        storageDirectory: directory,
        model,
        clock: () => new Date("2030-09-01T00:00:00.000Z"),
      });
      const result = await selection.select(
        request([candidate("candidate-one"), candidate("candidate-two")]),
      );

      expect(result).toMatchObject({
        status: "selected",
        attemptRef: {
          kind: "target-selection-attempt-ref",
          schemaVersion: 2,
          digest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
        },
        receipts: [
          {
            candidateId: "candidate-one",
            decision: "selected",
            candidateKind: "programme-eligible",
          },
          {
            candidateId: "candidate-two",
            decision: "selected",
            candidateKind: "programme-eligible",
          },
        ],
      });
      expect(result.status === "selected" && result.receipts).toHaveLength(2);
      await expect(
        selection.select(
          request([candidate("candidate-two"), candidate("candidate-one")]),
        ),
      ).resolves.toEqual(result);
      expect(modelCalls).toBe(1);

      const revised = await selection.select({
        ...request([candidate("candidate-one"), candidate("candidate-two")]),
        revision: 2,
      });
      expect(revised.attemptRef.digest).not.toBe(result.attemptRef.digest);
      expect(modelCalls).toBe(2);

      const restarted = openTargetSelection({
        storageDirectory: directory,
        model: {
          rank: () => Promise.reject(new Error("must not run during replay")),
        },
      });
      await expect(
        restarted.select(
          request([candidate("candidate-one"), candidate("candidate-two")]),
        ),
      ).resolves.toEqual(result);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("rejects a durable selected Attempt that omits an autonomous Candidate receipt", async () => {
    const directory = await mkdtemp(
      join(tmpdir(), "target-selection-missing-receipt-"),
    );
    try {
      const { input, path, selected, stored } = await selectedAttemptFixture(
        directory,
        [candidate("candidate-one"), candidate("candidate-two")],
      );
      await writeFile(
        path,
        JSON.stringify({ ...stored, receipts: stored.receipts.slice(0, 1) }),
      );

      const restarted = openTargetSelection({
        storageDirectory: directory,
        model: {
          rank: () => Promise.reject(new Error("must not rank on restart")),
        },
      });
      await expect(restarted.select(input)).rejects.toThrow(
        "Selected Attempt receipts must exactly cover input Candidate IDs",
      );
      await expect(
        restarted.resolveForApproval({
          kind: "target-selection-approval-verification-request",
          schemaVersion: 1,
          attempt: {
            ref: selected.attemptRef,
            selectionKey: input.selectionKey,
            revision: input.revision,
          },
          selectionPolicy: input.policy,
          modelProfile: input.modelProfile,
          operatorIdentity: "human:fixture-operator",
          nominations: [],
          verifiedAt: "2030-09-01T00:01:00.000Z",
        }),
      ).rejects.toThrow(
        "Selected Attempt receipts must exactly cover input Candidate IDs",
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it.each([
    {
      fact: "verified version",
      substitute: (value: TargetSelectionCandidate) => ({
        ...value,
        target: { ...value.target, verifiedVersion: "9.9.9" },
      }),
    },
    {
      fact: "source manifest digest",
      substitute: (value: TargetSelectionCandidate) => ({
        ...value,
        target: {
          ...value.target,
          canonicalFileManifestDigest: digest("9"),
        },
      }),
    },
    {
      fact: "nested provenance fact",
      substitute: (value: TargetSelectionCandidate) => ({
        ...value,
        targetObservation: {
          ...value.targetObservation,
          provenance: "conflicting" as const,
        },
      }),
    },
  ])(
    "rejects a content-addressed Receipt that substitutes the Candidate $fact under the same ID",
    async ({ substitute }) => {
      const directory = await mkdtemp(
        join(tmpdir(), "target-selection-candidate-binding-"),
      );
      try {
        const { input, path, stored } = await selectedAttemptFixture(
          directory,
          [candidate("candidate-one")],
        );
        const originalReceipt = stored.receipts[0];
        if (originalReceipt === undefined) {
          throw new Error("Expected a receipt fixture");
        }
        const { id: _id, digest: _digest, ...receiptBody } = originalReceipt;
        const substitutedReceiptBody = {
          ...receiptBody,
          candidate: substitute(originalReceipt.candidate),
        };
        const substitutedReceiptDigest = sha256Digest(substitutedReceiptBody);
        const substitutedReceipt = {
          ...substitutedReceiptBody,
          id: `selection-receipt:${substitutedReceiptDigest.slice(7, 31)}`,
          digest: substitutedReceiptDigest,
        };
        const substitutedAttempt = {
          ...stored,
          receipts: [substitutedReceipt],
        };
        const substitutedAttemptDigest = sha256Digest(substitutedAttempt);
        const substitutedAttemptRef = {
          kind: "target-selection-attempt-ref" as const,
          schemaVersion: 2 as const,
          id: `selection-attempt:${substitutedAttemptDigest.slice(7, 31)}`,
          digest: substitutedAttemptDigest,
        };
        await writeFile(path, JSON.stringify(substitutedAttempt));

        const restarted = openTargetSelection({
          storageDirectory: directory,
          model: {
            rank: () => Promise.reject(new Error("must not rank on restart")),
          },
        });
        await expect(restarted.select(input)).rejects.toThrow(
          "Selected Attempt receipt Candidate must match input Candidate",
        );
        await expect(
          restarted.resolveForApproval({
            kind: "target-selection-approval-verification-request",
            schemaVersion: 1,
            attempt: {
              ref: substitutedAttemptRef,
              selectionKey: input.selectionKey,
              revision: input.revision,
            },
            selectionPolicy: input.policy,
            modelProfile: input.modelProfile,
            operatorIdentity: "human:fixture-operator",
            nominations: [],
            verifiedAt: "2030-09-01T00:01:00.000Z",
          }),
        ).rejects.toThrow(
          "Selected Attempt receipt Candidate must match input Candidate",
        );
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    },
  );

  it("rejects a durable nomination-only Attempt with a model result", async () => {
    const directory = await mkdtemp(
      join(tmpdir(), "target-selection-empty-model-result-"),
    );
    try {
      const { input, path, stored } = await selectedAttemptFixture(
        directory,
        [],
      );
      await writeFile(
        path,
        JSON.stringify({
          ...stored,
          modelResult: {
            kind: "target-selection-model-result",
            schemaVersion: 1,
            rankedCandidateIds: ["invented-candidate"],
            assessments: [
              {
                candidateId: "invented-candidate",
                researchValueBand: "high",
                uncertaintyBand: "high",
                reasonCodes: ["uncertain-surface"],
              },
            ],
          },
        }),
      );

      const restarted = openTargetSelection({
        storageDirectory: directory,
        model: {
          rank: () => Promise.reject(new Error("must not rank on restart")),
        },
      });
      await expect(restarted.select(input)).rejects.toThrow(
        "Nomination-only Attempt must not contain a model result",
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("rejects selected Attempt receipt sets that do not exactly cover input Candidate IDs", async () => {
    const directory = await mkdtemp(
      join(tmpdir(), "target-selection-receipt-coverage-"),
    );
    try {
      const { stored } = await selectedAttemptFixture(directory, [
        candidate("candidate-one"),
        candidate("candidate-two"),
      ]);
      const firstReceipt = stored.receipts[0];
      if (firstReceipt === undefined) {
        throw new Error("Expected a receipt fixture");
      }
      const extraReceipt = {
        ...firstReceipt,
        candidateId: "candidate-extra",
        candidate: {
          ...firstReceipt.candidate,
          candidateId: "candidate-extra",
        },
      };
      const cases = [
        {
          name: "empty input with a receipt",
          value: {
            ...stored,
            input: { ...stored.input, candidates: [] },
            modelResult: undefined,
            receipts: [firstReceipt],
          },
        },
        { name: "non-empty input with zero receipts", receipts: [] },
        {
          name: "non-empty input with a missing receipt",
          receipts: [firstReceipt],
        },
        {
          name: "non-empty input with an extra receipt",
          receipts: [...stored.receipts, extraReceipt],
        },
        {
          name: "non-empty input with duplicate receipts",
          receipts: [firstReceipt, firstReceipt],
        },
      ];

      for (const scenario of cases) {
        const value =
          "value" in scenario
            ? scenario.value
            : { ...stored, receipts: scenario.receipts };
        const parsed = targetSelectionAttemptSchema.safeParse(value);
        expect(parsed.success, scenario.name).toBe(false);
        if (!parsed.success) {
          expect(parsed.error.issues).toEqual(
            expect.arrayContaining([
              expect.objectContaining({
                path: ["receipts"],
                message:
                  "Selected Attempt receipts must exactly cover input Candidate IDs",
              }),
            ]),
          );
        }
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("resolves a legacy v1 Attempt through an Oracle-free read-only approval projection", async () => {
    const directory = await mkdtemp(join(tmpdir(), "target-selection-legacy-"));
    try {
      const fixture = await createLegacyTargetSelectionFixture();
      const selection = openTargetSelection({
        storageDirectory: directory,
        model: {
          rank: () => Promise.reject(new Error("legacy replay must not rank")),
        },
      });
      await selection.migrateLegacyAttempt(fixture.attempt);
      const verificationRequest = {
        kind: "target-selection-approval-verification-request" as const,
        schemaVersion: 1 as const,
        attempt: {
          ref: fixture.attemptRef,
          selectionKey: fixture.selectionKey,
          revision: fixture.revision,
        },
        selectionPolicy: fixture.policy,
        modelProfile: fixture.modelProfile,
        operatorIdentity: "human:fixture-operator",
        nominations: [],
        verifiedAt: "2030-09-01T00:00:00.000Z",
      };

      const verification =
        await selection.resolveForApproval(verificationRequest);
      expect(verification).toMatchObject({
        attemptRef: fixture.attemptRef,
        receipts: [
          {
            schemaVersion: 2,
            receiptSource: "selection-attempt",
            candidate: {
              origin: { kind: "autonomous-observation" },
              researchHistory: {
                followUpReason: "incomplete-source-frontier-follow-up",
              },
            },
          },
        ],
      });
      expect(JSON.stringify(verification)).not.toMatch(/CVE|advisory|Finding/);

      const restarted = openTargetSelection({
        storageDirectory: directory,
        model: {
          rank: () => Promise.reject(new Error("legacy replay must not rank")),
        },
      });
      await expect(
        restarted.resolveForApproval(verificationRequest),
      ).resolves.toEqual(verification);
      await expect(
        restarted.select({
          ...request([candidate("legacy-writer")]),
          selectionKey: fixture.selectionKey,
          revision: fixture.revision,
        }),
      ).rejects.toThrow("v1 and v2 writers cannot mix");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("accepts operator nominations only at the approval verification seam", async () => {
    const directory = await mkdtemp(
      join(tmpdir(), "target-selection-nomination-"),
    );
    try {
      const selection = openTargetSelection({
        storageDirectory: directory,
        model: {
          rank: () => Promise.reject(new Error("must reject before ranking")),
        },
      });
      await expect(
        selection.select(
          request([
            candidate("candidate-nominated", {
              origin: {
                kind: "operator-nomination",
                nominatedBy: "human:fixture-operator",
                nominatedAt: "2030-08-31T23:55:00.000Z",
                reason: "coverage-balance",
              },
            }),
          ]),
        ),
      ).rejects.toThrow("origin");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it.each(["existing-receipt", "another-nomination"] as const)(
    "rejects a nomination whose Target identity duplicates %s",
    async (duplicateSource) => {
      const directory = await mkdtemp(
        join(tmpdir(), "target-selection-identity-"),
      );
      try {
        const selection = openTargetSelection({
          storageDirectory: directory,
          model: {
            rank: async (input) => ({
              kind: "target-selection-model-result",
              schemaVersion: 1,
              rankedCandidateIds: input.candidates.map(
                ({ candidateId }) => candidateId,
              ),
              assessments: input.candidates.map(({ candidateId }) => ({
                candidateId,
                researchValueBand: "high",
                uncertaintyBand: "medium",
                reasonCodes: ["recently-updated"],
              })),
            }),
          },
          clock: () => new Date("2030-09-01T00:00:00.000Z"),
        });
        const selected = await selection.select(
          request([candidate("candidate-existing")]),
        );
        if (selected.status !== "selected") {
          throw new Error("Expected a selected Attempt fixture");
        }
        const { origin: _existingOrigin, ...existingCandidate } =
          candidate("candidate-existing");
        const { origin: _otherOrigin, ...otherCandidate } =
          candidate("candidate-other");
        const firstNomination =
          duplicateSource === "existing-receipt"
            ? { ...existingCandidate, candidateId: "candidate-alias" }
            : otherCandidate;
        const nominations = [
          {
            candidate: firstNomination,
            nominatedBy: "human:fixture-operator",
            nominatedAt: "2030-09-01T00:01:00.000Z",
            reason: "coverage-balance" as const,
          },
          ...(duplicateSource === "another-nomination"
            ? [
                {
                  candidate: {
                    ...otherCandidate,
                    candidateId: "candidate-other-alias",
                  },
                  nominatedBy: "human:fixture-operator",
                  nominatedAt: "2030-09-01T00:02:00.000Z",
                  reason: "operator-priority" as const,
                },
              ]
            : []),
        ];

        await expect(
          selection.resolveForApproval({
            kind: "target-selection-approval-verification-request",
            schemaVersion: 1,
            attempt: {
              ref: selected.attemptRef,
              selectionKey: "september-selection",
              revision: 1,
            },
            selectionPolicy: policy,
            modelProfile,
            operatorIdentity: "human:fixture-operator",
            nominations,
            verifiedAt: "2030-09-01T01:00:00.000Z",
          }),
        ).rejects.toThrow("Target identity");
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    },
  );

  it("applies history, research-only, freshness, and diversity without programme queues", async () => {
    const directory = await mkdtemp(join(tmpdir(), "target-selection-policy-"));
    let capturedInput: unknown;
    const candidates = [
      candidate("candidate-active", {
        researchHistory: { status: "active", campaignId: "campaign-active" },
      }),
      candidate("candidate-new"),
      candidate("candidate-follow-up", {
        programmes: [
          {
            programmeIdentity: "programme:patchstack",
            snapshotRef: {
              id: "programme-snapshot:research-only",
              digest: digest("4"),
            },
            opportunityBand: "research-only",
            eligibility: "ineligible",
            currentUntil: "2030-09-02T00:00:00.000Z",
          },
        ],
        disclosureRoute: {
          observationRef: {
            id: "disclosure-route:research-only",
            digest: digest("5"),
            routeDigest: digest("6"),
          },
          kind: "conflicting",
          currentUntil: "2030-09-02T00:00:00.000Z",
        },
        researchHistory: {
          status: "incomplete",
          campaignId: "campaign-incomplete",
          followUpReason: "incomplete-source-frontier-follow-up",
        },
        diversity: {
          vendor: "different-vendor",
          pluginFamily: "different-family",
          useCase: "different-use",
          sizeBand: "large",
          authorityModel: "unauthenticated",
          integrations: ["woocommerce"],
        },
      }),
      candidate("candidate-diversity-limited"),
      candidate("candidate-covered", {
        researchHistory: {
          status: "coverage-closed",
          campaignId: "campaign-covered",
        },
      }),
      candidate("candidate-incomplete-unreasoned", {
        researchHistory: {
          status: "incomplete",
          campaignId: "campaign-incomplete-unreasoned",
        },
      }),
      candidate("candidate-stale", {
        targetObservation: {
          ...candidate("candidate-stale-base").targetObservation,
          currentUntil: "2030-08-31T23:59:59.000Z",
        },
      }),
    ];
    try {
      const selection = openTargetSelection({
        storageDirectory: directory,
        model: {
          rank: async (input) => {
            capturedInput = input;
            return {
              kind: "target-selection-model-result",
              schemaVersion: 1,
              rankedCandidateIds: input.candidates.map(
                ({ candidateId }) => candidateId,
              ),
              assessments: input.candidates.map(({ candidateId }) => ({
                candidateId,
                researchValueBand: "high",
                uncertaintyBand: "medium",
                reasonCodes: ["recently-updated"],
              })),
            };
          },
        },
        clock: () => new Date("2030-09-01T00:00:00.000Z"),
      });
      const result = await selection.select(request(candidates));
      expect(result.status).toBe("selected");
      if (result.status !== "selected") {
        throw new Error("Expected selected Target receipts");
      }
      expect(result.receipts).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            candidateId: "candidate-active",
            decision: "selected",
            researchTreatment: "resume",
          }),
          expect.objectContaining({
            candidateId: "candidate-follow-up",
            decision: "selected",
            candidateKind: "research-only",
            researchTreatment: "follow-up",
          }),
          expect.objectContaining({
            candidateId: "candidate-new",
            decision: "not-selected",
            reasonCodes: ["diversity-cap-reached"],
          }),
          expect.objectContaining({
            candidateId: "candidate-covered",
            decision: "not-selected",
            researchTreatment: "already-covered",
            hardGate: {
              status: "failed",
              reasons: ["already-covered"],
            },
          }),
          expect.objectContaining({
            candidateId: "candidate-stale",
            decision: "not-selected",
            hardGate: {
              status: "failed",
              reasons: ["target-observation-stale"],
            },
          }),
          expect.objectContaining({
            candidateId: "candidate-incomplete-unreasoned",
            decision: "not-selected",
            researchTreatment: "follow-up-required",
            hardGate: {
              status: "failed",
              reasons: ["follow-up-reason-required"],
            },
          }),
        ]),
      );
      expect(
        result.receipts.filter(({ decision }) => decision === "selected"),
      ).toHaveLength(3);
      expect(JSON.stringify(capturedInput)).not.toMatch(
        /programme-snapshot|reward|XP|CVE-|advisory|affected|CWE|known-route|publishedRecordCount|lastPublishedAt/i,
      );
      expect(JSON.stringify(result)).not.toMatch(
        /reward|XP|CVE-|advisory|affected-version|known-route|CWE/i,
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("uses Opportunity Band only after the model Research Value Band", async () => {
    const directory = await mkdtemp(join(tmpdir(), "target-selection-order-"));
    const highResearchOnly = candidate("candidate-high-research-only", {
      programmes: [
        {
          programmeIdentity: "programme:patchstack",
          snapshotRef: {
            id: "programme-snapshot:research-only",
            digest: digest("7"),
          },
          opportunityBand: "research-only",
          eligibility: "ineligible",
          currentUntil: "2030-09-02T00:00:00.000Z",
        },
      ],
      disclosureRoute: {
        observationRef: {
          id: "disclosure-route:research-only-order",
          digest: digest("8"),
          routeDigest: digest("9"),
        },
        kind: "none-found",
        currentUntil: "2030-09-02T00:00:00.000Z",
      },
    });
    const mediumBroad = candidate("candidate-medium-broad");
    const highBroad = candidate("candidate-high-broad");
    try {
      const selection = openTargetSelection({
        storageDirectory: directory,
        model: {
          rank: async () => ({
            kind: "target-selection-model-result",
            schemaVersion: 1,
            rankedCandidateIds: [
              "candidate-medium-broad",
              "candidate-high-research-only",
              "candidate-high-broad",
            ],
            assessments: [
              {
                candidateId: "candidate-medium-broad",
                researchValueBand: "medium",
                uncertaintyBand: "medium",
                reasonCodes: ["recently-updated"],
              },
              {
                candidateId: "candidate-high-research-only",
                researchValueBand: "high",
                uncertaintyBand: "high",
                reasonCodes: ["uncertain-surface"],
              },
              {
                candidateId: "candidate-high-broad",
                researchValueBand: "high",
                uncertaintyBand: "medium",
                reasonCodes: ["public-integrations"],
              },
            ],
          }),
        },
        clock: () => new Date("2030-09-01T00:00:00.000Z"),
      });
      const result = await selection.select({
        ...request([highResearchOnly, mediumBroad, highBroad]),
        selectionKey: "selection-order",
        policy: { ...policy, batchSize: 2 },
      });
      expect(result.status).toBe("selected");
      if (result.status !== "selected") {
        throw new Error("Expected ordered Target receipts");
      }
      expect(
        result.receipts
          .filter(({ decision }) => decision === "selected")
          .map(({ candidateId }) => candidateId),
      ).toEqual(["candidate-high-broad", "candidate-high-research-only"]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("deterministically applies provenance, acquisition, and source freshness hard gates", async () => {
    const directory = await mkdtemp(join(tmpdir(), "target-selection-gates-"));
    let modelCalls = 0;
    const unavailable = candidate("candidate-unavailable");
    const staleProgramme = candidate("candidate-stale-programme");
    const staleDisclosure = candidate("candidate-stale-disclosure");
    try {
      const selection = openTargetSelection({
        storageDirectory: directory,
        model: {
          rank: () => {
            modelCalls += 1;
            return Promise.resolve({});
          },
        },
        clock: () => new Date("2030-09-01T00:00:00.000Z"),
      });
      const result = await selection.select({
        ...request([
          {
            ...unavailable,
            targetObservation: {
              ...unavailable.targetObservation,
              acquisition: "unavailable",
              provenance: "conflicting",
              identity: "unverified",
            },
          },
          {
            ...staleProgramme,
            programmes: staleProgramme.programmes.map((programme) => ({
              ...programme,
              currentUntil: "2030-08-31T23:59:59.000Z",
            })),
          },
          {
            ...staleDisclosure,
            disclosureRoute: {
              ...staleDisclosure.disclosureRoute,
              currentUntil: "2030-08-31T23:59:59.000Z",
            },
          },
        ]),
        selectionKey: "selection-hard-gates",
      });
      expect(result.status).toBe("selected");
      if (result.status !== "selected") {
        throw new Error("Expected hard-gate receipts");
      }
      expect(result.receipts).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            candidateId: "candidate-unavailable",
            hardGate: {
              status: "failed",
              reasons: [
                "acquisition-unavailable",
                "provenance-unverified",
                "identity-unverified",
              ],
            },
          }),
          expect.objectContaining({
            candidateId: "candidate-stale-programme",
            hardGate: {
              status: "failed",
              reasons: ["programme-eligibility-stale"],
            },
          }),
          expect.objectContaining({
            candidateId: "candidate-stale-disclosure",
            hardGate: {
              status: "failed",
              reasons: ["disclosure-route-stale"],
            },
          }),
        ]),
      );
      expect(modelCalls).toBe(0);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("rejects fields outside the oracle-free Candidate contract before model execution", async () => {
    const directory = await mkdtemp(join(tmpdir(), "target-selection-oracle-"));
    let modelCalls = 0;
    const base = candidate("candidate-oracle");
    const tainted = {
      ...request([base]),
      candidates: [
        {
          ...base,
          knownCve: "CVE-2099-9999",
          advisory: "must not reach selection",
          affectedSymbol: "private_fixture_function",
          expectedReward: 1000,
        },
      ],
    };
    try {
      const selection = openTargetSelection({
        storageDirectory: directory,
        model: {
          rank: () => {
            modelCalls += 1;
            return Promise.resolve({});
          },
        },
      });
      await expect(
        selection.select(tainted as TargetSelectionRequest),
      ).rejects.toThrow();
      expect(modelCalls).toBe(0);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it.each([
    {
      failure: "provider",
      expectedReason: "provider-failure",
      rank: () => Promise.reject(new Error("provider unavailable")),
    },
    {
      failure: "budget",
      expectedReason: "budget-exhausted",
      rank: () =>
        Promise.reject(new TargetSelectionModelError("budget-exhausted")),
    },
    {
      failure: "invalid model result",
      expectedReason: "model-invalid",
      rank: () => Promise.resolve({ rankedCandidateIds: [] }),
    },
  ])("durably retains $failure as selection-pending", async (scenario) => {
    const directory = await mkdtemp(
      join(tmpdir(), "target-selection-pending-"),
    );
    let modelCalls = 0;
    const input = request([candidate("candidate-pending")]);
    try {
      const selection = openTargetSelection({
        storageDirectory: directory,
        model: {
          rank: () => {
            modelCalls += 1;
            return scenario.rank();
          },
        },
        clock: () => new Date("2030-09-01T00:00:00.000Z"),
      });
      const pending = await selection.select(input);
      expect(pending).toMatchObject({
        status: "selection-pending",
        reason: scenario.expectedReason,
        pendingCandidateIds: ["candidate-pending"],
      });

      const replayed = openTargetSelection({
        storageDirectory: directory,
        model: {
          rank: () => {
            modelCalls += 1;
            return Promise.reject(new Error("must not run on replay"));
          },
        },
      });
      await expect(replayed.select(input)).resolves.toEqual(pending);
      expect(modelCalls).toBe(1);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
