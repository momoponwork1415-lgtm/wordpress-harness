import { createServer, request as httpRequest, type Server } from "node:http";
import {
  chmod,
  mkdir,
  mkdtemp,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { canonicalDigest } from "../../src/infrastructure/canonical-json.js";
import { createDeepSeekCredentialEgressBroker } from "../../src/infrastructure/deepseek-credential-egress-broker.js";
import { openDeepSeekCredentialProxy } from "../../src/infrastructure/deepseek-credential-proxy.js";

const servers: Server[] = [];
const directories: string[] = [];
const resolveProviderAddresses = () =>
  Promise.resolve(["203.0.113.10"] as const);

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve, reject) => {
          server.close((error) => {
            if (error === undefined) resolve();
            else reject(error);
          });
        }),
    ),
  );
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function listen(server: Server): Promise<string> {
  servers.push(server);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("Expected an HTTP listener");
  }
  return `http://127.0.0.1:${address.port}`;
}

async function brokerFixture(
  prefix: string,
  credentialMode = 0o600,
): Promise<{
  scratchRootDirectory: string;
  credentialFilePath: string;
  proxyBundleDirectory: string;
}> {
  const root = await mkdtemp(join(tmpdir(), prefix));
  directories.push(root);
  const credentialFilePath = join(root, "deepseek-api-key");
  const proxyBundleDirectory = join(root, "proxy-bundle");
  await writeFile(credentialFilePath, "sk-host-private-test-key\n", {
    mode: credentialMode,
  });
  await chmod(credentialFilePath, credentialMode);
  await mkdir(proxyBundleDirectory, { mode: 0o700 });
  await writeFile(
    join(proxyBundleDirectory, "deepseek-credential-proxy-cli.js"),
    "// test fixture",
  );
  return {
    scratchRootDirectory: root,
    credentialFilePath,
    proxyBundleDirectory,
  };
}

function grantRequest() {
  return {
    schemaVersion: 1 as const,
    runtimeProfileDigest:
      "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    model: "deepseek-flash",
    protocol: "responses" as const,
    maxRequests: 1,
    maxRequestBytes: 4_096,
    maxResponseBytes: 4_096,
    expiresAt: "2026-09-18T07:30:00.000Z",
  };
}

describe("DeepSeek credential egress broker", () => {
  it("forwards only the bound model and injects the raw key upstream", async () => {
    const rawApiKey = "sk-deepseek-host-private-credential";
    const scopedToken = "scoped-run-token";
    const upstreamRequests: {
      authorization?: string;
      path?: string;
      body?: string;
    }[] = [];
    const upstreamOrigin = await listen(
      createServer((request, response) => {
        const chunks: Buffer[] = [];
        request.on("data", (chunk: Buffer) => chunks.push(chunk));
        request.on("end", () => {
          upstreamRequests.push({
            ...(request.headers.authorization === undefined
              ? {}
              : { authorization: request.headers.authorization }),
            ...(request.url === undefined ? {} : { path: request.url }),
            body: Buffer.concat(chunks).toString("utf8"),
          });
          response.writeHead(201, { "content-type": "application/json" });
          response.end('{"id":"response-1","status":"completed"}');
        });
      }),
    );
    const proxy = await openDeepSeekCredentialProxy({
      listenHost: "127.0.0.1",
      port: 0,
      upstreamOrigin,
      apiKey: rawApiKey,
      grantToken: scopedToken,
      model: "deepseek-flash",
      protocol: "responses",
      maxRequests: 2,
      maxRequestBytes: 4_096,
      maxResponseBytes: 4_096,
      expiresAt: "2026-09-18T07:30:00.000Z",
      clock: () => new Date("2026-09-18T07:00:00.000Z"),
    });
    servers.push(proxy.server);

    const health = await fetch(`${proxy.origin}/healthz`);
    const unauthorized = await fetch(`${proxy.origin}/responses`, {
      method: "POST",
      headers: {
        authorization: "Bearer another-run-token",
        "content-type": "application/json",
      },
      body: JSON.stringify({ model: "deepseek-flash", input: "research" }),
    });
    const wrongProtocol = await fetch(`${proxy.origin}/chat/completions`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${scopedToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ model: "deepseek-flash", messages: [] }),
    });
    const wrongOrigin = await new Promise<number>((resolve, reject) => {
      const request = httpRequest(
        proxy.origin,
        {
          method: "POST",
          path: "https://another-provider.example/responses",
          headers: {
            authorization: `Bearer ${scopedToken}`,
            "content-type": "application/json",
          },
        },
        (response) => {
          response.resume();
          resolve(response.statusCode ?? 0);
        },
      );
      request.once("error", reject);
      request.end(
        JSON.stringify({ model: "deepseek-flash", input: "research" }),
      );
    });
    const admitted = await fetch(`${proxy.origin}/responses`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${scopedToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ model: "deepseek-flash", input: "research" }),
    });
    const refused = await fetch(`${proxy.origin}/responses`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${scopedToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ model: "another-model", input: "research" }),
    });
    const secondAdmitted = await fetch(`${proxy.origin}/responses`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${scopedToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ model: "deepseek-flash", input: "research-2" }),
    });
    const overLimit = await fetch(`${proxy.origin}/responses`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${scopedToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ model: "deepseek-flash", input: "research-3" }),
    });

    expect(health.status).toBe(200);
    expect(unauthorized.status).toBe(401);
    expect(wrongProtocol.status).toBe(404);
    expect(wrongOrigin).toBe(404);
    expect(admitted.status).toBe(201);
    await expect(admitted.json()).resolves.toEqual({
      id: "response-1",
      status: "completed",
    });
    expect(refused.status).toBe(403);
    expect(secondAdmitted.status).toBe(201);
    expect(overLimit.status).toBe(429);
    expect(upstreamRequests).toEqual([
      {
        authorization: `Bearer ${rawApiKey}`,
        path: "/responses",
        body: '{"model":"deepseek-flash","input":"research"}',
      },
      {
        authorization: `Bearer ${rawApiKey}`,
        path: "/responses",
        body: '{"model":"deepseek-flash","input":"research-2"}',
      },
    ]);
    expect(proxy.origin).not.toContain(rawApiKey);
    expect(scopedToken).not.toContain(rawApiKey);
  });

  it("fails closed on expiry and byte ceilings", async () => {
    let upstreamCalls = 0;
    const upstreamOrigin = await listen(
      createServer((_request, response) => {
        upstreamCalls += 1;
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ output: "x".repeat(64) }));
      }),
    );
    const baseOptions = {
      listenHost: "127.0.0.1",
      port: 0,
      upstreamOrigin,
      apiKey: "sk-private-limit-test",
      grantToken: "scoped-limit-test",
      model: "deepseek-flash",
      protocol: "responses" as const,
      maxRequests: 1,
      maxRequestBytes: 4_096,
      maxResponseBytes: 4_096,
      expiresAt: "2026-09-18T07:30:00.000Z",
      clock: () => new Date("2026-09-18T07:00:00.000Z"),
    };
    const expiredProxy = await openDeepSeekCredentialProxy({
      ...baseOptions,
      clock: () => new Date("2026-09-18T07:30:00.000Z"),
    });
    const requestLimitedProxy = await openDeepSeekCredentialProxy({
      ...baseOptions,
      maxRequestBytes: 16,
    });
    const responseLimitedProxy = await openDeepSeekCredentialProxy({
      ...baseOptions,
      maxResponseBytes: 16,
    });
    servers.push(
      expiredProxy.server,
      requestLimitedProxy.server,
      responseLimitedProxy.server,
    );
    const send = (origin: string): Promise<Response> =>
      fetch(`${origin}/responses`, {
        method: "POST",
        headers: {
          authorization: "Bearer scoped-limit-test",
          "content-type": "application/json",
        },
        body: JSON.stringify({ model: "deepseek-flash", input: "research" }),
      });

    const expired = await send(expiredProxy.origin);
    const requestLimited = await send(requestLimitedProxy.origin);
    const responseLimited = await send(responseLimitedProxy.origin);

    expect(expired.status).toBe(401);
    expect(requestLimited.status).toBe(413);
    expect(responseLimited.status).toBe(502);
    expect(upstreamCalls).toBe(1);
    await expect(responseLimited.json()).resolves.toEqual({
      error: { reason: "response-limit-exceeded" },
    });
  });

  it("preserves provider failure classes while redacting the raw key", async () => {
    const rawApiKey = "sk-provider-error-secret";
    const providerResponses = [
      { status: 401, body: `invalid credential ${rawApiKey}` },
      { status: 429, body: "quota exhausted" },
      { status: 503, body: "provider unavailable" },
    ];
    const upstreamOrigin = await listen(
      createServer((_request, response) => {
        const next = providerResponses.shift();
        if (next === undefined) throw new Error("Unexpected provider call");
        response.writeHead(next.status, { "content-type": "text/plain" });
        response.end(next.body);
      }),
    );
    const proxy = await openDeepSeekCredentialProxy({
      listenHost: "127.0.0.1",
      port: 0,
      upstreamOrigin,
      apiKey: rawApiKey,
      grantToken: "scoped-provider-failure-token",
      model: "deepseek-flash",
      protocol: "responses",
      maxRequests: 3,
      maxRequestBytes: 4_096,
      maxResponseBytes: 4_096,
      expiresAt: "2026-09-18T07:30:00.000Z",
      clock: () => new Date("2026-09-18T07:00:00.000Z"),
    });
    const unavailableProxy = await openDeepSeekCredentialProxy({
      listenHost: "127.0.0.1",
      port: 0,
      upstreamOrigin: "http://127.0.0.1:1",
      apiKey: rawApiKey,
      grantToken: "scoped-provider-failure-token",
      model: "deepseek-flash",
      protocol: "responses",
      maxRequests: 1,
      maxRequestBytes: 4_096,
      maxResponseBytes: 4_096,
      expiresAt: "2026-09-18T07:30:00.000Z",
      clock: () => new Date("2026-09-18T07:00:00.000Z"),
    });
    servers.push(proxy.server, unavailableProxy.server);
    const send = (origin: string): Promise<Response> =>
      fetch(`${origin}/responses`, {
        method: "POST",
        headers: {
          authorization: "Bearer scoped-provider-failure-token",
          "content-type": "application/json",
        },
        body: JSON.stringify({ model: "deepseek-flash", input: "research" }),
      });

    const unauthenticated = await send(proxy.origin);
    const quotaExhausted = await send(proxy.origin);
    const providerFailed = await send(proxy.origin);
    const unreachable = await send(unavailableProxy.origin);

    expect([
      unauthenticated.status,
      quotaExhausted.status,
      providerFailed.status,
    ]).toEqual([401, 429, 503]);
    await expect(unauthenticated.text()).resolves.toBe(
      "invalid credential [REDACTED]",
    );
    await expect(quotaExhausted.text()).resolves.toBe("quota exhausted");
    await expect(providerFailed.text()).resolves.toBe("provider unavailable");
    expect(unreachable.status).toBe(502);
    await expect(unreachable.json()).resolves.toEqual({
      error: { reason: "provider-unavailable" },
    });
  });

  it("gives the Agent only a scoped endpoint on an isolated network", async () => {
    const root = await mkdtemp(join(tmpdir(), "deepseek-egress-broker-"));
    directories.push(root);
    const credentialFilePath = join(root, "deepseek-api-key");
    const proxyBundleDirectory = join(root, "proxy-bundle");
    const rawApiKey = "sk-deepseek-host-private-credential";
    await writeFile(credentialFilePath, `${rawApiKey}\n`, { mode: 0o600 });
    await chmod(credentialFilePath, 0o600);
    await mkdir(proxyBundleDirectory, { mode: 0o700 });
    await writeFile(
      join(proxyBundleDirectory, "deepseek-credential-proxy-cli.js"),
      "// test fixture",
    );
    const dockerCommands: string[][] = [];
    const broker = createDeepSeekCredentialEgressBroker({
      dockerExecutablePath: "/usr/bin/docker",
      brokerImage:
        "node@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      credentialFilePath,
      scratchRootDirectory: root,
      proxyBundleDirectory,
      clock: () => new Date("2026-09-18T07:00:00.000Z"),
      randomUuid: () => "11111111-2222-4333-8444-555555555555",
      resolveProviderAddresses,
      runDocker: async (args) => {
        dockerCommands.push([...args]);
        return {
          exitCode: 0,
          stdout: args[0] === "inspect" ? "172.28.0.2\n" : "",
          stderr: "",
        };
      },
    });

    let agentGrant: unknown;
    const result = await broker.withGrant(
      {
        schemaVersion: 1,
        runtimeProfileDigest:
          "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        model: "deepseek-flash",
        protocol: "responses",
        maxRequests: 7,
        maxRequestBytes: 32_768,
        maxResponseBytes: 1_048_576,
        expiresAt: "2026-09-18T07:30:00.000Z",
      },
      (grant) => {
        agentGrant = grant;
        return Promise.resolve("provider-completed");
      },
    );

    expect(agentGrant).toMatchObject({
      baseUrl: "http://172.28.0.2:8080",
      authorization: expect.stringMatching(/^Bearer [A-Za-z0-9_-]+$/u),
      dockerNetworkName: "deepseek-egress-11111111-2222-4333-8444-555555555555",
      model: "deepseek-flash",
      protocol: "responses",
      expiresAt: "2026-09-18T07:30:00.000Z",
    });
    expect(result.operation).toEqual({
      status: "completed",
      value: "provider-completed",
    });
    expect(result.receipt).toMatchObject({
      schemaVersion: 1,
      grantId: "11111111-2222-4333-8444-555555555555",
      runtimeProfileDigest:
        "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      brokerImage:
        "node@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      upstreamOrigin: "https://api.deepseek.com",
      model: "deepseek-flash",
      protocol: "responses",
      setup: { status: "ready" },
      cleanup: { status: "completed" },
      isolation: {
        backend: "gvisor",
        runtime: "runsc",
        fallbackUsed: false,
        agentNetworkInternal: true,
      },
      digest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/u),
    });
    const { digest, ...receiptBody } = result.receipt;
    expect(digest).toBe(canonicalDigest(receiptBody));
    expect(JSON.stringify({ agentGrant, result })).not.toContain(rawApiKey);
    expect(JSON.stringify(dockerCommands)).not.toContain(rawApiKey);
    expect(dockerCommands).toContainEqual([
      "network",
      "create",
      "--internal",
      "deepseek-egress-11111111-2222-4333-8444-555555555555",
    ]);
    const create = dockerCommands.find((command) => command[0] === "create");
    expect(create).toEqual(
      expect.arrayContaining([
        "--runtime=runsc",
        "--read-only",
        "--cap-drop=ALL",
        "--security-opt=no-new-privileges",
        "--network",
        "deepseek-egress-11111111-2222-4333-8444-555555555555",
        "--network-alias=deepseek-egress",
        "--add-host=api.deepseek.com=203.0.113.10",
      ]),
    );
    expect(dockerCommands).toContainEqual([
      "network",
      "connect",
      "bridge",
      "deepseek-egress-broker-11111111-2222-4333-8444-555555555555",
    ]);
    expect(dockerCommands).toContainEqual([
      "start",
      "deepseek-egress-broker-11111111-2222-4333-8444-555555555555",
    ]);
    expect(dockerCommands).toContainEqual([
      "rm",
      "--force",
      "deepseek-egress-broker-11111111-2222-4333-8444-555555555555",
    ]);
    expect(dockerCommands).toContainEqual([
      "network",
      "rm",
      "deepseek-egress-11111111-2222-4333-8444-555555555555",
    ]);
    expect((await readdir(root)).sort()).toEqual([
      "deepseek-api-key",
      "proxy-bundle",
    ]);
  });

  it("refuses an unsafe host credential before creating Docker state", async () => {
    const files = await brokerFixture("deepseek-unsafe-credential-", 0o644);
    const runDocker = vi.fn(() =>
      Promise.resolve({ exitCode: 0, stdout: "", stderr: "" }),
    );
    const operation = vi.fn<() => Promise<void>>();
    const broker = createDeepSeekCredentialEgressBroker({
      dockerExecutablePath: "/usr/bin/docker",
      brokerImage:
        "node@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      ...files,
      clock: () => new Date("2026-09-18T07:00:00.000Z"),
      randomUuid: () => "12121212-3434-4567-89ab-cdcdcdcdcdcd",
      resolveProviderAddresses,
      runDocker,
    });

    const result = await broker.withGrant(grantRequest(), operation);

    expect(operation).not.toHaveBeenCalled();
    expect(runDocker).not.toHaveBeenCalled();
    expect(result.receipt.setup).toEqual({
      status: "failed",
      stage: "credential",
      reason: "credential-unavailable",
    });
    expect(result.receipt.cleanup).toEqual({ status: "not-required" });
  });

  it("fails closed before Docker when the fixed provider origin cannot resolve", async () => {
    const files = await brokerFixture("deepseek-provider-resolution-");
    const runDocker = vi.fn(() =>
      Promise.resolve({ exitCode: 0, stdout: "", stderr: "" }),
    );
    const operation = vi.fn<() => Promise<void>>();
    const broker = createDeepSeekCredentialEgressBroker({
      dockerExecutablePath: "/usr/bin/docker",
      brokerImage:
        "node@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      ...files,
      clock: () => new Date("2026-09-18T07:00:00.000Z"),
      randomUuid: () => "13131313-3434-4567-89ab-cdcdcdcdcdcd",
      resolveProviderAddresses: () => Promise.resolve([]),
      runDocker,
    });

    const result = await broker.withGrant(grantRequest(), operation);

    expect(operation).not.toHaveBeenCalled();
    expect(runDocker).not.toHaveBeenCalled();
    expect(result.receipt.setup).toEqual({
      status: "failed",
      stage: "provider-network-connect",
      reason: "provider-network-unavailable",
    });
    expect(result.receipt.cleanup).toEqual({ status: "completed" });
  });

  it("distinguishes internal-network and runsc broker startup failures", async () => {
    const networkFiles = await brokerFixture("deepseek-network-failure-");
    const runscFiles = await brokerFixture("deepseek-runsc-failure-");
    const operation = vi.fn<() => Promise<void>>();
    const networkBroker = createDeepSeekCredentialEgressBroker({
      dockerExecutablePath: "/usr/bin/docker",
      brokerImage:
        "node@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      ...networkFiles,
      clock: () => new Date("2026-09-18T07:00:00.000Z"),
      randomUuid: () => "23232323-4545-4678-8abc-dededededede",
      resolveProviderAddresses,
      runDocker: (args) =>
        Promise.resolve({
          exitCode: args[0] === "network" && args[1] === "create" ? 1 : 0,
          stdout: "",
          stderr: "",
        }),
    });
    const runscBroker = createDeepSeekCredentialEgressBroker({
      dockerExecutablePath: "/usr/bin/docker",
      brokerImage:
        "node@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      ...runscFiles,
      clock: () => new Date("2026-09-18T07:00:00.000Z"),
      randomUuid: () => "34343434-5656-4789-8bcd-efefefefefef",
      resolveProviderAddresses,
      runDocker: (args) =>
        Promise.resolve({
          exitCode: args[0] === "create" ? 1 : 0,
          stdout: "",
          stderr: "",
        }),
    });

    const networkResult = await networkBroker.withGrant(
      grantRequest(),
      operation,
    );
    const runscResult = await runscBroker.withGrant(grantRequest(), operation);

    expect(operation).not.toHaveBeenCalled();
    expect(networkResult.receipt.setup).toEqual({
      status: "failed",
      stage: "network-create",
      reason: "docker-network-unavailable",
    });
    expect(networkResult.receipt.cleanup).toEqual({ status: "completed" });
    expect(runscResult.receipt.setup).toEqual({
      status: "failed",
      stage: "broker-start",
      reason: "broker-container-unavailable",
    });
    expect(runscResult.receipt.cleanup).toEqual({ status: "completed" });
  });

  it("does not invoke the Agent when broker health fails", async () => {
    const files = await brokerFixture("deepseek-health-failure-");
    const operation = vi.fn<() => Promise<void>>();
    const broker = createDeepSeekCredentialEgressBroker({
      dockerExecutablePath: "/usr/bin/docker",
      brokerImage:
        "node@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      ...files,
      clock: () => new Date("2026-09-18T07:00:00.000Z"),
      randomUuid: () => "45454545-6767-489a-8cde-f0f0f0f0f0f0",
      resolveProviderAddresses,
      runDocker: (args) =>
        Promise.resolve({
          exitCode: args[0] === "exec" ? 1 : 0,
          stdout: args[0] === "inspect" ? "172.28.0.2\n" : "",
          stderr: args[0] === "exec" ? "container is not running" : "",
        }),
    });

    const result = await broker.withGrant(grantRequest(), operation);

    expect(operation).not.toHaveBeenCalled();
    expect(result.receipt.setup).toEqual({
      status: "failed",
      stage: "broker-health",
      reason: "broker-not-ready",
    });
    expect(result.receipt.cleanup).toEqual({ status: "completed" });
  });

  it("does not invoke the Agent when the provider-facing network is unavailable", async () => {
    const root = await mkdtemp(join(tmpdir(), "deepseek-egress-failure-"));
    directories.push(root);
    const credentialFilePath = join(root, "deepseek-api-key");
    const proxyBundleDirectory = join(root, "proxy-bundle");
    await writeFile(credentialFilePath, "sk-host-private-test-key\n", {
      mode: 0o600,
    });
    await mkdir(proxyBundleDirectory, { mode: 0o700 });
    await writeFile(
      join(proxyBundleDirectory, "deepseek-credential-proxy-cli.js"),
      "// test fixture",
    );
    const dockerCommands: string[][] = [];
    const operation = vi.fn<() => Promise<void>>();
    const broker = createDeepSeekCredentialEgressBroker({
      dockerExecutablePath: "/usr/bin/docker",
      brokerImage:
        "node@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      credentialFilePath,
      scratchRootDirectory: root,
      proxyBundleDirectory,
      clock: () => new Date("2026-09-18T07:00:00.000Z"),
      randomUuid: () => "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
      resolveProviderAddresses,
      runDocker: async (args) => {
        dockerCommands.push([...args]);
        const providerConnect = args[0] === "network" && args[1] === "connect";
        return {
          exitCode: providerConnect ? 1 : 0,
          stdout: "",
          stderr: providerConnect ? "network unavailable" : "",
        };
      },
    });

    const result = await broker.withGrant(
      {
        schemaVersion: 1,
        runtimeProfileDigest:
          "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        model: "deepseek-flash",
        protocol: "responses",
        maxRequests: 1,
        maxRequestBytes: 4_096,
        maxResponseBytes: 4_096,
        expiresAt: "2026-09-18T07:30:00.000Z",
      },
      operation,
    );

    expect(operation).not.toHaveBeenCalled();
    expect(result.operation).toEqual({ status: "not-started" });
    expect(result.receipt.setup).toEqual({
      status: "failed",
      stage: "provider-network-connect",
      reason: "provider-network-unavailable",
    });
    expect(result.receipt.cleanup).toEqual({ status: "completed" });
    expect(dockerCommands.map((command) => command.slice(0, 2))).toEqual([
      ["network", "create"],
      ["create", "--pull=never"],
      ["network", "connect"],
      ["rm", "--force"],
      ["network", "rm"],
    ]);
  });

  it("preserves the operation failure when broker cleanup also fails", async () => {
    const root = await mkdtemp(join(tmpdir(), "deepseek-egress-cleanup-"));
    directories.push(root);
    const credentialFilePath = join(root, "deepseek-api-key");
    const proxyBundleDirectory = join(root, "proxy-bundle");
    await writeFile(credentialFilePath, "sk-host-private-test-key\n", {
      mode: 0o600,
    });
    await mkdir(proxyBundleDirectory, { mode: 0o700 });
    await writeFile(
      join(proxyBundleDirectory, "deepseek-credential-proxy-cli.js"),
      "// test fixture",
    );
    const operationError = new Error("provider process failed");
    const broker = createDeepSeekCredentialEgressBroker({
      dockerExecutablePath: "/usr/bin/docker",
      brokerImage:
        "node@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      credentialFilePath,
      scratchRootDirectory: root,
      proxyBundleDirectory,
      clock: () => new Date("2026-09-18T07:00:00.000Z"),
      randomUuid: () => "ffffffff-eeee-4ddd-8ccc-bbbbbbbbbbbb",
      resolveProviderAddresses,
      runDocker: (args) =>
        Promise.resolve({
          exitCode: args[0] === "rm" ? 1 : 0,
          stdout: args[0] === "inspect" ? "172.28.0.2\n" : "",
          stderr: "",
        }),
    });

    const result = await broker.withGrant(
      {
        schemaVersion: 1,
        runtimeProfileDigest:
          "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        model: "deepseek-flash",
        protocol: "responses",
        maxRequests: 1,
        maxRequestBytes: 4_096,
        maxResponseBytes: 4_096,
        expiresAt: "2026-09-18T07:30:00.000Z",
      },
      () => Promise.reject(operationError),
    );

    expect(result.operation).toEqual({
      status: "failed",
      error: operationError,
    });
    expect(result.receipt.setup).toEqual({ status: "ready" });
    expect(result.receipt.cleanup).toEqual({
      status: "failed",
      failedSteps: ["broker-remove"],
    });
  });
});
