import { readFile } from "node:fs/promises";

import {
  DEEPSEEK_UPSTREAM_ORIGIN,
  openDeepSeekCredentialProxy,
  type DeepSeekApiProtocol,
} from "./deepseek-credential-proxy.js";

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.length === 0) {
    throw new Error("DeepSeek credential proxy configuration is incomplete");
  }
  return value;
}

function positiveInteger(name: string): number {
  const value = Number(requiredEnvironment(name));
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error("DeepSeek credential proxy configuration is invalid");
  }
  return value;
}

function protocol(): DeepSeekApiProtocol {
  const value = requiredEnvironment("DEEPSEEK_PROTOCOL");
  if (value !== "responses" && value !== "chat-completions") {
    throw new Error("DeepSeek credential proxy protocol is invalid");
  }
  return value;
}

async function main(): Promise<void> {
  const apiKey = (
    await readFile("/run/secrets/deepseek-api-key", "utf8")
  ).trim();
  const proxy = await openDeepSeekCredentialProxy({
    listenHost: "0.0.0.0",
    port: 8080,
    upstreamOrigin: DEEPSEEK_UPSTREAM_ORIGIN,
    apiKey,
    grantToken: requiredEnvironment("DEEPSEEK_GRANT_TOKEN"),
    model: requiredEnvironment("DEEPSEEK_MODEL"),
    protocol: protocol(),
    maxRequests: positiveInteger("DEEPSEEK_MAX_REQUESTS"),
    maxRequestBytes: positiveInteger("DEEPSEEK_MAX_REQUEST_BYTES"),
    maxResponseBytes: positiveInteger("DEEPSEEK_MAX_RESPONSE_BYTES"),
    expiresAt: requiredEnvironment("DEEPSEEK_GRANT_EXPIRES_AT"),
  });
  const shutdown = (): void => {
    proxy.server.close(() => {
      process.exitCode = 0;
    });
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

main().catch(() => {
  process.stderr.write("DeepSeek credential proxy failed\n");
  process.exitCode = 1;
});
