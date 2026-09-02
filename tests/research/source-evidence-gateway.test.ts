import { describe, expect, it } from "vitest";

import { sha256Digest } from "../../src/research/research-record/canonical-json.js";
import {
  openSourceEvidenceFixture,
  sourceEvidenceTargetDigest,
  sourceFileDigest,
} from "../fixtures/source-evidence.js";

const leaseId = `sha256:${"b".repeat(64)}`;

describe("SourceEvidenceGateway.query", () => {
  it("returns an anchored source range and a durable receipt for the bound Snapshot", async () => {
    const source = [
      "<?php",
      "function dispatch_request() {",
      "  return custom_db_query();",
      "}",
      "",
    ].join("\n");
    const fixture = await openSourceEvidenceFixture({
      files: { "includes/dispatcher.php": source },
    });

    try {
      const receipt = await fixture.gateway.query({
        kind: "read-source-range",
        schemaVersion: 1,
        attemptId: "attempt-1",
        leaseId,
        targetSnapshot: fixture.manifest.targetSnapshot,
        policy: fixture.gateway.policy,
        subject: {
          path: "includes/dispatcher.php",
          fileDigest: fixture.fileDigest("includes/dispatcher.php"),
          startLine: 2,
          endLine: 4,
        },
        desiredRelation: "callee",
        reason:
          "Trace the dispatcher into the target-specific database wrapper.",
      });

      expect(receipt.response).toEqual({
        kind: "source-range-response",
        schemaVersion: 1,
        anchor: {
          kind: "source-anchor",
          targetSnapshotDigest: sourceEvidenceTargetDigest,
          path: "includes/dispatcher.php",
          fileDigest: fixture.fileDigest("includes/dispatcher.php"),
          startLine: 2,
          endLine: 4,
          startOffset: 6,
          endOffset: 65,
        },
        bytes: 59,
        content:
          "function dispatch_request() {\n  return custom_db_query();\n}",
      });
      expect(receipt.value).toMatchObject({
        kind: "source-evidence-receipt",
        schemaVersion: 1,
        attemptId: "attempt-1",
        leaseId,
        targetSnapshot: fixture.manifest.targetSnapshot,
        policyDecision: { outcome: "allowed", reason: "read-allowed" },
        result: {
          status: "completed",
          responseDigest: sha256Digest(receipt.response),
        },
      });
      await expect(
        fixture.artifacts.readJson(receipt.ref.digest),
      ).resolves.toEqual(receipt.value);
      if (
        receipt.value.result.status !== "completed" &&
        receipt.value.result.status !== "truncated"
      ) {
        throw new Error("Expected a source response digest");
      }
      await expect(
        fixture.artifacts.readJson(receipt.value.result.responseDigest),
      ).resolves.toEqual(receipt.response);
    } finally {
      await fixture.close();
    }
  });

  it("records a policy denial without reading a path outside the Snapshot", async () => {
    const fixture = await openSourceEvidenceFixture({
      files: { "inside.php": "<?php\nreturn 'inside';\n" },
    });
    const outsideSource = "PRIVATE_OUTSIDE_SOURCE";

    try {
      const receipt = await fixture.gateway.query({
        kind: "read-source-range",
        schemaVersion: 1,
        attemptId: "attempt-escape",
        leaseId,
        targetSnapshot: fixture.manifest.targetSnapshot,
        policy: fixture.gateway.policy,
        subject: {
          path: "../outside.php",
          fileDigest: sourceFileDigest(outsideSource),
          startLine: 1,
          endLine: 1,
        },
        desiredRelation: "source-range",
        reason: "Attempt to leave the admitted source tree.",
      });

      expect(receipt.response).toBeNull();
      expect(receipt.value).toMatchObject({
        attemptId: "attempt-escape",
        policyDecision: {
          outcome: "denied",
          reason: "path-outside-snapshot",
        },
        result: {
          status: "policy-denied",
          reason: "path-outside-snapshot",
        },
      });
      await expect(
        fixture.artifacts.readJson(receipt.ref.digest),
      ).resolves.toEqual(receipt.value);
      expect(JSON.stringify(receipt.value)).not.toContain(outsideSource);
    } finally {
      await fixture.close();
    }
  });

  it("marks a byte-limited source range as truncated and anchors only returned bytes", async () => {
    const fixture = await openSourceEvidenceFixture({
      files: { "long-line.php": "<?php\nABCDEFGHIJKLMNO\n" },
      maxReadBytes: 12,
    });

    try {
      const receipt = await fixture.gateway.query({
        kind: "read-source-range",
        schemaVersion: 1,
        attemptId: "attempt-truncated",
        leaseId,
        targetSnapshot: fixture.manifest.targetSnapshot,
        policy: fixture.gateway.policy,
        subject: {
          path: "long-line.php",
          fileDigest: fixture.fileDigest("long-line.php"),
          startLine: 2,
          endLine: 2,
        },
        desiredRelation: "source-range",
        reason: "Inspect the bounded line without exceeding the read policy.",
      });

      expect(receipt.value.result).toMatchObject({ status: "truncated" });
      expect(receipt.response).toMatchObject({
        bytes: 12,
        content: "ABCDEFGHIJKL",
        anchor: {
          startLine: 2,
          endLine: 2,
          startOffset: 6,
          endOffset: 18,
        },
      });
    } finally {
      await fixture.close();
    }
  });

  it("finds exact definition and usage candidates outside the initial source range", async () => {
    const dispatcher = [
      "<?php",
      "function dispatch_request() {",
      "  return custom_db_query($_POST['id']);",
      "}",
      "",
    ].join("\n");
    const wrapper = [
      "<?php",
      "function custom_db_query($id) {",
      "  return $GLOBALS['wpdb']->get_results('SELECT ' . $id);",
      "}",
      "",
    ].join("\n");
    const fixture = await openSourceEvidenceFixture({
      files: {
        "includes/wrapper.php": wrapper,
        "includes/dispatcher.php": dispatcher,
      },
      search: { maxScanBytes: 4096, maxResults: 8 },
    });

    try {
      const receipt = await fixture.gateway.query({
        kind: "search-snapshot",
        schemaVersion: 1,
        attemptId: "attempt-search",
        leaseId,
        targetSnapshot: fixture.manifest.targetSnapshot,
        policy: fixture.gateway.policy,
        subject: {
          literal: "custom_db_query",
          scope: { kind: "snapshot" },
        },
        desiredRelation: "definition",
        reason: "Locate the target-specific wrapper and all direct usages.",
      });

      expect(receipt.value.result).toMatchObject({ status: "completed" });
      expect(receipt.response).toMatchObject({
        kind: "source-search-response",
        schemaVersion: 1,
        literal: "custom_db_query",
        scanned: { files: 2 },
        matches: [
          {
            anchor: {
              path: "includes/dispatcher.php",
              fileDigest: fixture.fileDigest("includes/dispatcher.php"),
              startLine: 3,
              endLine: 3,
            },
          },
          {
            anchor: {
              path: "includes/wrapper.php",
              fileDigest: fixture.fileDigest("includes/wrapper.php"),
              startLine: 2,
              endLine: 2,
            },
          },
        ],
      });
    } finally {
      await fixture.close();
    }
  });
});
