import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  defineAIReproductionRecord,
  openHumanOs,
  type DynamicReproductionRuntime,
} from "../../src/human-os/index.js";
import type { SourceValidatedFinding } from "../../src/research/index.js";

const digest = (character: string): string => `sha256:${character.repeat(64)}`;

const finding: SourceValidatedFinding = {
  kind: "source-validated-finding",
  schemaVersion: 1,
  findingId: "campaign-dynamic:finding:candidate-1",
  candidateId: "candidate-1",
  targetSnapshot: {
    id: "example-1.0.0",
    pluginSlug: "example",
    version: "1.0.0",
    digest: digest("a"),
    sourceTree: { digest: digest("9"), entries: 1, bytes: 6 },
  },
  attackerPremise: "An unauthenticated visitor controls a public value.",
  brokenSecurityProperty: "The public value must remain inert.",
  claim: "The public value reaches an executable browser context.",
  assurance: "source-validated",
  validation: {
    runId: "campaign-dynamic:validation:1",
    promptSet: { id: "validation-v1", digest: digest("b") },
    runtimeProfileDigest: digest("c"),
    permissionProfileDigest: digest("d"),
  },
  evidence: [
    {
      path: "public/save.php",
      location: "save:44",
      observation: "Stores the visitor-controlled value.",
    },
  ],
};

describe("Dynamic AI Reproduction", () => {
  it("runs a received Finding and appends the bound runtime result", async () => {
    const directory = await mkdtemp(join(tmpdir(), "dynamic-reproduction-"));
    const record = defineAIReproductionRecord({
      kind: "ai-reproduction-record",
      schemaVersion: 3,
      findingId: finding.findingId,
      environment: {
        environmentId: "dynamic-environment-1",
        targetSnapshotDigest: finding.targetSnapshot.digest,
        runtimeProfileDigest: digest("8"),
        backend: "gvisor",
        runtime: "runsc",
        fallbackUsed: false,
        fresh: true,
        disposable: true,
        hostTargetExecution: false,
        ambientCredentials: false,
        arbitraryNetwork: false,
      },
      status: "runtime-confirmed",
      summary: "A bounded browser canary executed in the fresh lab.",
      privateEvidence: [{ id: "evidence-1", digest: digest("e") }],
      recordedAt: "2026-09-08T07:00:00.000Z",
    });
    const execute = vi.fn(async () => record);
    const runtime: DynamicReproductionRuntime = { execute };
    const humanOs = openHumanOs({
      databasePath: join(directory, "human.sqlite"),
      dynamicReproductionRuntime: runtime,
    });

    try {
      await humanOs.receiveFinding({
        finding,
        receivedAt: "2026-09-08T06:55:00.000Z",
      });

      await expect(
        humanOs.reproduceFinding(finding.findingId),
      ).resolves.toEqual(record);
      expect(execute).toHaveBeenCalledWith({ finding });
      await expect(humanOs.inspect(finding.findingId)).resolves.toMatchObject({
        finding,
        aiReproductions: [record],
      });
    } finally {
      humanOs.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("records an incomplete result when the runtime fails before a lab exists", async () => {
    const directory = await mkdtemp(join(tmpdir(), "dynamic-incomplete-"));
    const runtime: DynamicReproductionRuntime = {
      execute: async () => {
        throw new Error("provider unavailable");
      },
    };
    const humanOs = openHumanOs({
      databasePath: join(directory, "human.sqlite"),
      dynamicReproductionRuntime: runtime,
      clock: () => new Date("2026-09-08T08:00:00.000Z"),
    });

    try {
      await humanOs.receiveFinding({
        finding,
        receivedAt: "2026-09-08T07:55:00.000Z",
      });

      await expect(
        humanOs.reproduceFinding(finding.findingId),
      ).resolves.toMatchObject({
        findingId: finding.findingId,
        environment: null,
        status: "incomplete",
        privateEvidence: [],
        recordedAt: "2026-09-08T08:00:00.000Z",
      });
      await expect(humanOs.inspect(finding.findingId)).resolves.toMatchObject({
        finding,
        aiReproductions: [{ status: "incomplete", environment: null }],
      });
    } finally {
      humanOs.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("keeps a public setup request when an external sandbox service needs human triage", async () => {
    const directory = await mkdtemp(
      join(tmpdir(), "dynamic-external-service-"),
    );
    const request = {
      kind: "external-dependency-evidence-request" as const,
      schemaVersion: 1 as const,
      reason: "external-dependency-required" as const,
      service: "PayPal Sandbox",
      humanAction:
        "Decide whether to provision a disposable merchant and buyer test account.",
      minimumAccess: "Sandbox-only credentials with no production permissions.",
      verificationGoal:
        "Observe whether the forged callback changes the order payment state.",
    };
    const record = defineAIReproductionRecord({
      kind: "ai-reproduction-record",
      schemaVersion: 3,
      findingId: finding.findingId,
      environment: null,
      status: "incomplete",
      summary: "A PayPal sandbox identity is required to test the callback.",
      evidenceRequest: request,
      privateEvidence: [],
      recordedAt: "2026-09-08T09:00:00.000Z",
    });
    const humanOs = openHumanOs({
      databasePath: join(directory, "human.sqlite"),
      dynamicReproductionRuntime: { execute: async () => record },
    });

    try {
      await humanOs.receiveFinding({
        finding,
        receivedAt: "2026-09-08T08:55:00.000Z",
      });

      await expect(
        humanOs.reproduceFinding(finding.findingId),
      ).resolves.toMatchObject({
        status: "incomplete",
        evidenceRequest: request,
      });
      await expect(humanOs.inspect(finding.findingId)).resolves.toMatchObject({
        aiReproductions: [{ evidenceRequest: request }],
      });
    } finally {
      humanOs.close();
      await rm(directory, { recursive: true, force: true });
    }
  });
});
