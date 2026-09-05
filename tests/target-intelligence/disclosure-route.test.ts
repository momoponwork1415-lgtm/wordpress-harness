import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  DisclosureRouteError,
  openDisclosureRoute,
  type DisclosureRouteSourceAdapter,
} from "../../src/target-intelligence/index.js";

const fixtureDirectory = join(
  import.meta.dirname,
  "..",
  "fixtures",
  "target-intelligence",
  "disclosure-route",
);

function fixtureSource(
  options: Omit<DisclosureRouteSourceAdapter, "retrieve" | "parse"> & {
    readonly fixture: string;
    readonly finalUrl?: string;
  },
): DisclosureRouteSourceAdapter {
  return {
    sourceId: options.sourceId,
    sourceKind: options.sourceKind,
    sourceUrl: options.sourceUrl,
    sourceOwner: options.sourceOwner,
    parserVersion: options.parserVersion,
    allowedOrigins: options.allowedOrigins,
    retrieve: async () => ({
      bytes: await readFile(join(fixtureDirectory, options.fixture)),
      finalUrl: options.finalUrl ?? options.sourceUrl,
    }),
    parse: (bytes) => JSON.parse(Buffer.from(bytes).toString("utf8")),
  };
}

describe("DisclosureRoute", () => {
  it.each([
    {
      pattern: "Ultimate Member-like direct reward programme",
      pluginIdentity: "wporg:direct-reward-fixture",
      expectedRoute: "first-party-bounty",
      source: fixtureSource({
        sourceId: "vendor-security",
        sourceKind: "vendor-official",
        sourceUrl: "https://vendor.example/security",
        sourceOwner: "fixture-vendor",
        parserVersion: "fixture-vendor-security-v1",
        allowedOrigins: ["https://vendor.example"],
        fixture: "direct-reward-vendor.json",
      }),
    },
    {
      pattern: "GiveWP-like delegated Patchstack VDP",
      pluginIdentity: "wporg:delegated-vdp-fixture",
      expectedRoute: "delegated-vdp",
      source: fixtureSource({
        sourceId: "programme-directory",
        sourceKind: "programme-directory",
        sourceUrl: "https://patchstack.example/vdp/directory",
        sourceOwner: "fixture-programme",
        parserVersion: "fixture-programme-directory-v1",
        allowedOrigins: ["https://patchstack.example"],
        fixture: "delegated-vdp-directory.json",
      }),
    },
    {
      pattern: "first-party VDP",
      pluginIdentity: "wporg:first-party-vdp-fixture",
      expectedRoute: "first-party-vdp",
      source: fixtureSource({
        sourceId: "repository-security",
        sourceKind: "official-repository-security",
        sourceUrl: "https://vendor.example/repository/security",
        sourceOwner: "fixture-vendor",
        parserVersion: "fixture-repository-security-v1",
        allowedOrigins: ["https://vendor.example"],
        fixture: "first-party-vdp.json",
      }),
    },
    {
      pattern: "security contact only",
      pluginIdentity: "wporg:security-contact-fixture",
      expectedRoute: "security-contact-only",
      source: fixtureSource({
        sourceId: "wordpress-org-maintainer",
        sourceKind: "wordpress-org-maintainer",
        sourceUrl: "https://wordpress.example/plugin/contact",
        sourceOwner: "fixture-maintainer",
        parserVersion: "fixture-maintainer-v1",
        allowedOrigins: ["https://wordpress.example"],
        fixture: "security-contact.json",
      }),
    },
    {
      pattern: "checked sources with no published route",
      pluginIdentity: "wporg:none-found-fixture",
      expectedRoute: "none-found",
      source: fixtureSource({
        sourceId: "search-result",
        sourceKind: "search-result",
        sourceUrl: "https://search.example/result",
        sourceOwner: "fixture-search",
        parserVersion: "fixture-search-v1",
        allowedOrigins: ["https://search.example"],
        fixture: "none-found.json",
      }),
    },
  ])("distinguishes $pattern", async (scenario) => {
    const directory = await mkdtemp(join(tmpdir(), "disclosure-route-"));
    try {
      const disclosureRoute = openDisclosureRoute({
        storageDirectory: directory,
        sourceAdapters: [scenario.source],
        clock: () => new Date("2030-09-01T00:00:00.000Z"),
      });

      const ref = await disclosureRoute.observe({
        kind: "disclosure-route-observe",
        schemaVersion: 1,
        pluginIdentity: scenario.pluginIdentity,
        requiredFor: "target-selection-batch",
      });
      await expect(disclosureRoute.inspect(ref)).resolves.toMatchObject({
        kind: "disclosure-route-observation",
        schemaVersion: 1,
        pluginIdentity: scenario.pluginIdentity,
        retrievedAt: "2030-09-01T00:00:00.000Z",
        route: {
          kind: scenario.expectedRoute,
          checkedScopes: expect.arrayContaining([
            "wordpress-plugin",
            "public-release",
          ]),
          submissionRoutes: expect.any(Array),
          conditions: expect.any(Array),
        },
        sources: [
          {
            sourceId: scenario.source.sourceId,
            sourceUrl: scenario.source.sourceUrl,
            sourceOwner: scenario.source.sourceOwner,
            retrievedAt: "2030-09-01T00:00:00.000Z",
            contentDigest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
            parserVersion: scenario.source.parserVersion,
          },
        ],
      });
      if (scenario.expectedRoute === "none-found") {
        await expect(disclosureRoute.inspect(ref)).resolves.toMatchObject({
          route: {
            humanReviewRequired: true,
            residualUncertainty: "only-checked-sources",
          },
        });
      }
      expect(JSON.stringify(await disclosureRoute.inspect(ref))).not.toMatch(
        /CVE-|affected-version|known-route|research-eligible|excluded-from-research|programme-assignment/i,
      );
      await expect(
        disclosureRoute.observe({
          kind: "disclosure-route-observe",
          schemaVersion: 1,
          pluginIdentity: scenario.pluginIdentity,
          requiredFor: "target-selection-batch",
        }),
      ).resolves.toEqual(ref);

      const restarted = openDisclosureRoute({
        storageDirectory: directory,
        sourceAdapters: [],
      });
      await expect(restarted.inspect(ref)).resolves.toEqual(
        await disclosureRoute.inspect(ref),
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("keeps stronger first-party evidence but sends a directory contradiction to human review", async () => {
    const directory = await mkdtemp(join(tmpdir(), "disclosure-conflict-"));
    try {
      const disclosureRoute = openDisclosureRoute({
        storageDirectory: directory,
        sourceAdapters: [
          fixtureSource({
            sourceId: "vendor-security",
            sourceKind: "vendor-official",
            sourceUrl: "https://vendor.example/security",
            sourceOwner: "fixture-vendor",
            parserVersion: "fixture-vendor-security-v1",
            allowedOrigins: ["https://vendor.example"],
            fixture: "first-party-vdp.json",
          }),
          fixtureSource({
            sourceId: "programme-directory",
            sourceKind: "programme-directory",
            sourceUrl: "https://patchstack.example/vdp/directory",
            sourceOwner: "fixture-programme",
            parserVersion: "fixture-programme-directory-v1",
            allowedOrigins: ["https://patchstack.example"],
            fixture: "delegated-vdp-directory.json",
          }),
        ],
        clock: () => new Date("2030-09-01T00:00:00.000Z"),
      });

      const ref = await disclosureRoute.observe({
        kind: "disclosure-route-observe",
        schemaVersion: 1,
        pluginIdentity: "wporg:conflicting-route-fixture",
        requiredFor: "target-selection-batch",
      });
      await expect(disclosureRoute.inspect(ref)).resolves.toMatchObject({
        route: {
          kind: "conflicting",
          strongestEvidenceSourceId: "vendor-security",
          humanReviewRequired: true,
        },
        sources: [
          { sourceId: "vendor-security" },
          { sourceId: "programme-directory" },
        ],
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("changes the semantic digest only when a refreshed route changes", async () => {
    const directory = await mkdtemp(join(tmpdir(), "disclosure-refresh-"));
    try {
      const common = {
        storageDirectory: directory,
        sourceAdapters: [
          fixtureSource({
            sourceId: "vendor-security",
            sourceKind: "vendor-official",
            sourceUrl: "https://vendor.example/security",
            sourceOwner: "fixture-vendor",
            parserVersion: "fixture-vendor-security-v1",
            allowedOrigins: ["https://vendor.example"],
            fixture: "direct-reward-vendor.json",
          }),
        ],
      } as const;
      const selection = openDisclosureRoute({
        ...common,
        clock: () => new Date("2030-09-01T00:00:00.000Z"),
      });
      const selectionRef = await selection.observe({
        kind: "disclosure-route-observe",
        schemaVersion: 1,
        pluginIdentity: "wporg:route-refresh-fixture",
        requiredFor: "target-selection-batch",
      });
      const staging = openDisclosureRoute({
        ...common,
        clock: () => new Date("2030-09-02T00:00:00.000Z"),
      });
      const stagingRef = await staging.observe({
        kind: "disclosure-route-observe",
        schemaVersion: 1,
        pluginIdentity: "wporg:route-refresh-fixture",
        requiredFor: "submission-staging",
      });
      expect(stagingRef.digest).not.toBe(selectionRef.digest);
      expect(stagingRef.routeDigest).toBe(selectionRef.routeDigest);

      const changed = openDisclosureRoute({
        storageDirectory: directory,
        sourceAdapters: [
          fixtureSource({
            sourceId: "vendor-security",
            sourceKind: "vendor-official",
            sourceUrl: "https://vendor.example/security",
            sourceOwner: "fixture-vendor",
            parserVersion: "fixture-vendor-security-v2",
            allowedOrigins: ["https://vendor.example"],
            fixture: "first-party-vdp.json",
          }),
        ],
        clock: () => new Date("2030-09-03T00:00:00.000Z"),
      });
      const changedRef = await changed.observe({
        kind: "disclosure-route-observe",
        schemaVersion: 1,
        pluginIdentity: "wporg:route-refresh-fixture",
        requiredFor: "submission-staging",
      });
      expect(changedRef.routeDigest).not.toBe(selectionRef.routeDigest);

      const assignmentBinding = {
        kind: "programme-assignment-route-binding" as const,
        schemaVersion: 1 as const,
        programmeAssignmentRef: {
          id: "programme-assignment:fixture",
          digest: `sha256:${"a".repeat(64)}`,
        },
        pluginIdentity: "wporg:route-refresh-fixture",
        routeDigest: selectionRef.routeDigest,
      };
      await expect(
        changed.projectAssignmentStaleness({
          kind: "programme-assignment-route-staleness-request",
          schemaVersion: 1,
          assignmentBinding,
          currentObservationRef: stagingRef,
        }),
      ).resolves.toMatchObject({
        kind: "programme-assignment-route-staleness",
        schemaVersion: 1,
        id: expect.stringMatching(/^route-staleness:/),
        digest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
        programmeAssignmentRef: assignmentBinding.programmeAssignmentRef,
        pluginIdentity: assignmentBinding.pluginIdentity,
        status: "current",
        assignedRouteDigest: selectionRef.routeDigest,
        observedRouteDigest: stagingRef.routeDigest,
        observationRef: stagingRef,
      });
      await expect(
        changed.projectAssignmentStaleness({
          kind: "programme-assignment-route-staleness-request",
          schemaVersion: 1,
          assignmentBinding,
          currentObservationRef: changedRef,
        }),
      ).resolves.toMatchObject({
        status: "stale",
        assignedRouteDigest: selectionRef.routeDigest,
        observedRouteDigest: changedRef.routeDigest,
      });
      await expect(
        changed.projectAssignmentStaleness({
          kind: "programme-assignment-route-staleness-request",
          schemaVersion: 1,
          assignmentBinding: {
            ...assignmentBinding,
            pluginIdentity: "wporg:different-target",
          },
          currentObservationRef: changedRef,
        }),
      ).rejects.toMatchObject({ code: "binding-mismatch" });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("rejects redirect provenance and Oracle-tainted page drift", async () => {
    const directory = await mkdtemp(join(tmpdir(), "disclosure-untrusted-"));
    try {
      const redirected = openDisclosureRoute({
        storageDirectory: directory,
        sourceAdapters: [
          fixtureSource({
            sourceId: "vendor-security",
            sourceKind: "vendor-official",
            sourceUrl: "https://vendor.example/security",
            finalUrl: "https://untrusted.example/copied-security-page",
            sourceOwner: "fixture-vendor",
            parserVersion: "fixture-vendor-security-v1",
            allowedOrigins: ["https://vendor.example"],
            fixture: "direct-reward-vendor.json",
          }),
        ],
      });
      await expect(
        redirected.observe({
          kind: "disclosure-route-observe",
          schemaVersion: 1,
          pluginIdentity: "wporg:untrusted-route-fixture",
          requiredFor: "target-selection-batch",
        }),
      ).rejects.toMatchObject({
        name: "DisclosureRouteError",
        code: "untrusted-provenance",
        sourceId: "vendor-security",
      });

      const source = fixtureSource({
        sourceId: "vendor-security",
        sourceKind: "vendor-official",
        sourceUrl: "https://vendor.example/security",
        sourceOwner: "fixture-vendor",
        parserVersion: "fixture-vendor-security-v1",
        allowedOrigins: ["https://vendor.example"],
        fixture: "direct-reward-vendor.json",
      });
      const tainted = openDisclosureRoute({
        storageDirectory: directory,
        sourceAdapters: [
          {
            ...source,
            parse: async (bytes: Uint8Array) => ({
              ...(JSON.parse(Buffer.from(bytes).toString("utf8")) as object),
              oracleFacts: {
                cve: "CVE-2099-9999",
                affectedVersion: "1.2.3",
                knownRoute: "must-not-cross-observation",
              },
            }),
          },
        ],
      });
      await expect(
        tainted.observe({
          kind: "disclosure-route-observe",
          schemaVersion: 1,
          pluginIdentity: "wporg:oracle-route-fixture",
          requiredFor: "target-selection-batch",
        }),
      ).rejects.toEqual(
        expect.objectContaining<Partial<DisclosureRouteError>>({
          code: "parse-failed",
          sourceId: "vendor-security",
        }),
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
