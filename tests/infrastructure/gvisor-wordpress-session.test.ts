import { describe, expect, it } from "vitest";

import {
  establishGvisorWordPressSession,
  type ContainerProcessResult,
  type ContainerProcessRunner,
} from "../../src/infrastructure/gvisor-wordpress-session.js";

const images = {
  database: "mariadb@sha256:aaaa",
  wordpress: "wordpress@sha256:bbbb",
  wordpressCli: "wordpress:cli@sha256:cccc",
};

function dockerStub(
  teardown: (
    args: readonly string[],
  ) => ContainerProcessResult | undefined = () => undefined,
) {
  const calls: string[][] = [];
  let established = false;
  const runner: ContainerProcessRunner = {
    run: async (request) => {
      calls.push([...request.args]);
      if (established) {
        const answer = teardown(request.args);
        if (answer !== undefined) return answer;
      }
      if (request.args[0] === "inspect") {
        return { exitCode: 0, stdout: "172.20.0.2\n", stderr: "" };
      }
      return { exitCode: 0, stdout: "", stderr: "" };
    },
  };
  return {
    runner,
    calls,
    established: () => {
      established = true;
      calls.length = 0;
    },
  };
}

async function establish(runner: ContainerProcessRunner) {
  return establishGvisorWordPressSession({
    processRunner: runner,
    images,
    plugins: [],
  });
}

describe("gVisor WordPress lab teardown", () => {
  it("reports an unobservable teardown when Docker cannot be reached", async () => {
    // A daemon that cannot answer says nothing about what is left running.
    // Reading absence out of a failed probe leaves the target plugin, its
    // database and the lab network alive while the record calls the lab
    // disposed.
    const docker = dockerStub(() => ({
      exitCode: -1,
      stdout: "",
      stderr: "spawn /usr/bin/docker ENOENT",
    }));
    const session = await establish(docker.runner);
    docker.established();

    await expect(session.dispose()).resolves.toEqual({
      status: "unobservable",
      reason: "probe-terminated",
    });
  });

  it("reports the resources a reachable daemon still lists", async () => {
    const docker = dockerStub((args) => {
      if (args[0] === "network" && args[1] === "rm") {
        return {
          exitCode: 1,
          stdout: "",
          stderr: "network has active endpoints",
        };
      }
      if (args[0] === "network" && args[1] === "ls") {
        const name = args
          .find((value) => value.startsWith("name="))
          ?.slice("name=".length);
        return { exitCode: 0, stdout: `${name ?? ""}\n`, stderr: "" };
      }
      if (args[1] === "ls") return { exitCode: 0, stdout: "", stderr: "" };
      return undefined;
    });
    const session = await establish(docker.runner);
    docker.established();

    await expect(session.dispose()).resolves.toEqual({
      status: "leaked",
      remaining: ["network"],
    });
  });

  it("treats an empty listing from a reachable daemon as cleaned", async () => {
    const docker = dockerStub((args) => {
      if (args[1] === "rm" || args[0] === "rm") {
        return { exitCode: 1, stdout: "", stderr: "No such object" };
      }
      if (args[1] === "ls") return { exitCode: 0, stdout: "", stderr: "" };
      return undefined;
    });
    const session = await establish(docker.runner);
    docker.established();

    await expect(session.dispose()).resolves.toEqual({ status: "cleaned" });
  });

  it("does not remember a teardown it could not observe", async () => {
    const docker = dockerStub(() => ({
      exitCode: -1,
      stdout: "",
      stderr: "spawn /usr/bin/docker ENOENT",
    }));
    const session = await establish(docker.runner);
    docker.established();
    await session.dispose();
    const afterFirst = docker.calls.length;

    await expect(session.dispose()).resolves.toEqual({
      status: "unobservable",
      reason: "probe-terminated",
    });
    expect(
      docker.calls.slice(afterFirst).some((args) => args[0] === "rm"),
    ).toBe(true);
  });
});
