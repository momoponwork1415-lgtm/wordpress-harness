import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  deepSeekAccountReadinessObservationSchema,
  probeDeepSeekAccountReadiness,
} from "../../src/operations/deepseek-account-readiness.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function credentialFixture(mode = 0o600) {
  const root = await mkdtemp(join(tmpdir(), "deepseek-readiness-"));
  roots.push(root);
  const credentialFilePath = join(root, "deepseek-api-key");
  await writeFile(credentialFilePath, "sk-host-private-readiness-key\n", {
    mode,
  });
  await chmod(credentialFilePath, mode);
  return credentialFilePath;
}

function response(status: number, body: unknown): Response {
  return new Response(typeof body === "string" ? body : JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("DeepSeek account readiness", () => {
  it("observes official balance readiness without returning the host key", async () => {
    const credentialFilePath = await credentialFixture();
    const request = vi.fn<typeof fetch>((url, init) => {
      expect(url).toBe("https://api.deepseek.com/user/balance");
      expect(new Headers(init?.headers).get("authorization")).toBe(
        "Bearer sk-host-private-readiness-key",
      );
      expect(init?.method).toBe("GET");
      return Promise.resolve(
        response(200, {
          is_available: true,
          balance_infos: [
            {
              currency: "USD",
              total_balance: "12.34000000",
              granted_balance: "2.34000000",
              topped_up_balance: "10.00000000",
            },
          ],
        }),
      );
    });

    const observation = await probeDeepSeekAccountReadiness({
      credentialFilePath,
      request,
      clock: () => new Date("2026-09-18T02:00:00.000Z"),
      timeoutMs: 5_000,
    });

    expect(observation).toMatchObject({
      kind: "deepseek-account-readiness-observation",
      schemaVersion: 1,
      observedAt: "2026-09-18T02:00:00.000Z",
      providerOrigin: "https://api.deepseek.com",
      status: "ready",
      isAvailable: true,
      balances: [
        {
          currency: "USD",
          totalBalance: "12.34000000",
          grantedBalance: "2.34000000",
          toppedUpBalance: "10.00000000",
        },
      ],
      digest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/u),
    });
    expect(
      deepSeekAccountReadinessObservationSchema.parse(observation),
    ).toEqual(observation);
    expect(() =>
      deepSeekAccountReadinessObservationSchema.parse({
        ...observation,
        balances: observation.balances.map((balance) => ({
          ...balance,
          totalBalance: "999.00000000",
        })),
      }),
    ).toThrow(/digest mismatch/u);
    expect(JSON.stringify(observation)).not.toContain(
      "sk-host-private-readiness-key",
    );
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("refuses an unsafe credential before making a request", async () => {
    const credentialFilePath = await credentialFixture(0o644);
    const request = vi.fn<typeof fetch>();

    const observation = await probeDeepSeekAccountReadiness({
      credentialFilePath,
      request,
      clock: () => new Date("2026-09-18T02:00:00.000Z"),
    });

    expect(observation).toMatchObject({
      status: "credential-unavailable",
      isAvailable: null,
      balances: [],
    });
    expect(request).not.toHaveBeenCalled();
  });

  it.each([
    { httpStatus: 401, expected: "unauthenticated" },
    { httpStatus: 403, expected: "unauthenticated" },
    { httpStatus: 402, expected: "quota-exhausted" },
    { httpStatus: 429, expected: "rate-limited" },
    { httpStatus: 503, expected: "unavailable" },
  ] as const)(
    "maps HTTP $httpStatus to $expected without retaining the response body",
    async ({ httpStatus, expected }) => {
      const credentialFilePath = await credentialFixture();
      const request = vi.fn<typeof fetch>(() =>
        Promise.resolve(
          response(
            httpStatus,
            "provider detail sk-host-private-readiness-key must be dropped",
          ),
        ),
      );

      const observation = await probeDeepSeekAccountReadiness({
        credentialFilePath,
        request,
        clock: () => new Date("2026-09-18T02:00:00.000Z"),
      });

      expect(observation).toMatchObject({
        status: expected,
        httpStatus,
        isAvailable: null,
        balances: [],
      });
      expect(JSON.stringify(observation)).not.toContain("provider detail");
      expect(JSON.stringify(observation)).not.toContain(
        "sk-host-private-readiness-key",
      );
    },
  );

  it("keeps an unavailable provider balance distinct from malformed output", async () => {
    const credentialFilePath = await credentialFixture();
    const unavailable = await probeDeepSeekAccountReadiness({
      credentialFilePath,
      request: () =>
        Promise.resolve(
          response(200, {
            is_available: false,
            balance_infos: [
              {
                currency: "USD",
                total_balance: "0.00000000",
                granted_balance: "0.00000000",
                topped_up_balance: "0.00000000",
              },
            ],
          }),
        ),
      clock: () => new Date("2026-09-18T02:00:00.000Z"),
    });
    const malformed = await probeDeepSeekAccountReadiness({
      credentialFilePath,
      request: () => Promise.resolve(response(200, { is_available: true })),
      clock: () => new Date("2026-09-18T02:00:00.000Z"),
    });

    expect(unavailable).toMatchObject({
      status: "quota-exhausted",
      isAvailable: false,
      balances: [{ totalBalance: "0.00000000" }],
    });
    expect(malformed).toMatchObject({
      status: "invalid-response",
      isAvailable: null,
      balances: [],
    });
  });

  it("distinguishes timeout from transport unavailability", async () => {
    const credentialFilePath = await credentialFixture();
    const timeout = await probeDeepSeekAccountReadiness({
      credentialFilePath,
      request: () => {
        const error = new Error("request timed out");
        error.name = "TimeoutError";
        return Promise.reject(error);
      },
      clock: () => new Date("2026-09-18T02:00:00.000Z"),
    });
    const unavailable = await probeDeepSeekAccountReadiness({
      credentialFilePath,
      request: () => Promise.reject(new Error("network unavailable")),
      clock: () => new Date("2026-09-18T02:00:00.000Z"),
    });

    expect(timeout.status).toBe("timeout");
    expect(unavailable.status).toBe("unavailable");
  });
});
