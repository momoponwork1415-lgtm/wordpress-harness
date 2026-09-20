import { describe, expect, it } from "vitest";

import {
  openGvisorRuntimePreflight,
  type GvisorRuntimePreflightReport,
} from "../../src/infrastructure/gvisor-runtime-preflight.js";

const imageDigest = `sha256:${"a".repeat(64)}`;

function check(report: GvisorRuntimePreflightReport, id: string) {
  const found = report.checks.find((candidate) => candidate.id === id);
  if (found === undefined) throw new Error(`Missing preflight check: ${id}`);
  return found;
}

describe("gVisor Runtime preflight", () => {
  it("hides Docker probing behind one read-only inspection", async () => {
    const calls: string[][] = [];
    const preflight = openGvisorRuntimePreflight({
      runProcess: async (options) => {
        calls.push([...options.args]);
        if (options.args[0] === "version") {
          return {
            kind: "exited",
            exitCode: 0,
            stdout: "27.0.0\n",
            stderr: "",
          };
        }
        if (options.args[0] === "info") {
          return {
            kind: "exited",
            exitCode: 0,
            stdout: JSON.stringify({ runc: {}, runsc: {} }),
            stderr: "",
          };
        }
        if (options.args[0] === "image") {
          return {
            kind: "exited",
            exitCode: 0,
            stdout: JSON.stringify({
              Id: imageDigest,
              RepoDigests: [`agent@${imageDigest}`],
            }),
            stderr: "",
          };
        }
        return {
          kind: "exited",
          exitCode: 0,
          stdout: "0.146.0\n",
          stderr: "",
        };
      },
    });

    const report = await preflight.inspect({
      dockerExecutablePath: "/usr/bin/docker",
      workingDirectory: "/private/scratch",
      image: `agent@${imageDigest}`,
      provider: {
        executable: "codex",
        versionTokenIndex: 0,
        expectedVersion: "0.146.0",
      },
    });

    expect(report.status).toBe("ready");
    expect(report.checks.map((item) => item.id)).toEqual([
      "docker",
      "runsc",
      "image",
      "provider-version",
    ]);
    expect(report.checks.every((item) => item.status === "ready")).toBe(true);
    expect(calls).toHaveLength(4);
    expect(calls[3]).toEqual(
      expect.arrayContaining([
        "--pull=never",
        "--runtime=runsc",
        "--network=none",
        "--read-only",
        "--entrypoint=codex",
        "--version",
      ]),
    );
    expect(calls[3]?.some((argument) => argument.includes("/private"))).toBe(
      false,
    );
  });

  it("does not run dependent probes when Docker is unavailable", async () => {
    const calls: string[][] = [];
    const report = await openGvisorRuntimePreflight({
      runProcess: async (options) => {
        calls.push([...options.args]);
        return { kind: "exited", exitCode: 1, stdout: "", stderr: "" };
      },
    }).inspect({
      dockerExecutablePath: "/usr/bin/docker",
      workingDirectory: "/private/scratch",
      image: `agent@${imageDigest}`,
      provider: {
        executable: "codex",
        versionTokenIndex: 0,
        expectedVersion: "0.146.0",
      },
    });

    expect(report.status).toBe("blocked");
    expect(check(report, "docker")).toMatchObject({
      status: "blocked",
      reason: "docker-unavailable",
    });
    expect(check(report, "runsc")).toMatchObject({
      status: "unknown",
      reason: "docker-required",
    });
    expect(check(report, "image")).toMatchObject({
      status: "unknown",
      reason: "docker-required",
    });
    expect(check(report, "provider-version")).toMatchObject({
      status: "unknown",
      reason: "sandbox-required",
    });
    expect(calls).toHaveLength(1);
  });

  it("rejects an image observation that does not contain the pinned digest", async () => {
    const report = await openGvisorRuntimePreflight({
      runProcess: async (options) => {
        if (options.args[0] === "version") {
          return {
            kind: "exited",
            exitCode: 0,
            stdout: "27.0.0\n",
            stderr: "",
          };
        }
        if (options.args[0] === "info") {
          return {
            kind: "exited",
            exitCode: 0,
            stdout: JSON.stringify({ runsc: {} }),
            stderr: "",
          };
        }
        return {
          kind: "exited",
          exitCode: 0,
          stdout: JSON.stringify({ Id: `sha256:${"b".repeat(64)}` }),
          stderr: "",
        };
      },
    }).inspect({
      dockerExecutablePath: "/usr/bin/docker",
      workingDirectory: "/private/scratch",
      image: `agent@${imageDigest}`,
      provider: {
        executable: "codex",
        versionTokenIndex: 0,
        expectedVersion: "0.146.0",
      },
    });

    expect(report.status).toBe("blocked");
    expect(check(report, "image")).toMatchObject({
      status: "blocked",
      reason: "image-digest-mismatch",
    });
    expect(check(report, "provider-version")).toMatchObject({
      status: "unknown",
      reason: "sandbox-required",
    });
  });
});
