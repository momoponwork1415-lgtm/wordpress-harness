import { z } from "zod";

import { canonicalDigest } from "../infrastructure/canonical-json.js";
import { DEEPSEEK_UPSTREAM_ORIGIN } from "../infrastructure/deepseek-credential-proxy.js";
import { readPrivateProviderCredential } from "../infrastructure/provider-private-credential.js";

const digestSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/u);
const decimalSchema = z.string().regex(/^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/u);

const deepSeekBalanceSchema = z.strictObject({
  currency: z.string().regex(/^[A-Z]{3}$/u),
  totalBalance: decimalSchema,
  grantedBalance: decimalSchema,
  toppedUpBalance: decimalSchema,
});

const deepSeekAccountReadinessObservationBodySchema = z.strictObject({
  kind: z.literal("deepseek-account-readiness-observation"),
  schemaVersion: z.literal(1),
  observedAt: z.iso.datetime(),
  providerOrigin: z.literal(DEEPSEEK_UPSTREAM_ORIGIN),
  status: z.enum([
    "ready",
    "credential-unavailable",
    "unauthenticated",
    "quota-exhausted",
    "rate-limited",
    "timeout",
    "unavailable",
    "invalid-response",
  ]),
  httpStatus: z.number().int().min(100).max(599).nullable(),
  isAvailable: z.boolean().nullable(),
  balances: z.array(deepSeekBalanceSchema).max(16),
});

export const deepSeekAccountReadinessObservationSchema =
  deepSeekAccountReadinessObservationBodySchema
    .extend({ digest: digestSchema })
    .superRefine((observation, context) => {
      const { digest, ...body } = observation;
      if (digest !== canonicalDigest(body)) {
        context.addIssue({
          code: "custom",
          path: ["digest"],
          message: "DeepSeek account readiness digest mismatch",
        });
      }
      const currencies = new Set(
        observation.balances.map((balance) => balance.currency),
      );
      if (currencies.size !== observation.balances.length) {
        context.addIssue({
          code: "custom",
          path: ["balances"],
          message: "DeepSeek balance currencies must be unique",
        });
      }
      const isReady =
        observation.status === "ready" &&
        observation.httpStatus === 200 &&
        observation.isAvailable === true &&
        observation.balances.length > 0;
      const isProviderReportedExhaustion =
        observation.status === "quota-exhausted" &&
        observation.httpStatus === 200 &&
        observation.isAvailable === false &&
        observation.balances.length > 0;
      const isHttpExhaustion =
        observation.status === "quota-exhausted" &&
        observation.httpStatus === 402 &&
        observation.isAvailable === null &&
        observation.balances.length === 0;
      const hasNoProviderBalance =
        observation.isAvailable === null && observation.balances.length === 0;
      const isCredentialUnavailable =
        observation.status === "credential-unavailable" &&
        observation.httpStatus === null &&
        hasNoProviderBalance;
      const isUnauthenticated =
        observation.status === "unauthenticated" &&
        (observation.httpStatus === 401 || observation.httpStatus === 403) &&
        hasNoProviderBalance;
      const isRateLimited =
        observation.status === "rate-limited" &&
        observation.httpStatus === 429 &&
        hasNoProviderBalance;
      const isTimeout =
        observation.status === "timeout" &&
        observation.httpStatus === null &&
        hasNoProviderBalance;
      const isInvalidResponse =
        observation.status === "invalid-response" &&
        observation.httpStatus === 200 &&
        hasNoProviderBalance;
      const isUnavailable =
        observation.status === "unavailable" &&
        (observation.httpStatus === null ||
          ![200, 401, 402, 403, 429].includes(observation.httpStatus)) &&
        hasNoProviderBalance;
      if (
        !isReady &&
        !isProviderReportedExhaustion &&
        !isHttpExhaustion &&
        !isCredentialUnavailable &&
        !isUnauthenticated &&
        !isRateLimited &&
        !isTimeout &&
        !isInvalidResponse &&
        !isUnavailable
      ) {
        context.addIssue({
          code: "custom",
          message: "DeepSeek readiness status fields are inconsistent",
        });
      }
    });

export type DeepSeekAccountReadinessObservation = z.infer<
  typeof deepSeekAccountReadinessObservationSchema
>;

const providerBalanceResponseSchema = z
  .strictObject({
    is_available: z.boolean(),
    balance_infos: z
      .array(
        z.strictObject({
          currency: z.string().regex(/^[A-Z]{3}$/u),
          total_balance: decimalSchema,
          granted_balance: decimalSchema,
          topped_up_balance: decimalSchema,
        }),
      )
      .min(1)
      .max(16),
  })
  .superRefine((value, context) => {
    if (
      new Set(value.balance_infos.map((balance) => balance.currency)).size !==
      value.balance_infos.length
    ) {
      context.addIssue({
        code: "custom",
        path: ["balance_infos"],
        message: "Provider balance currencies must be unique",
      });
    }
  });

function observation(
  body: z.input<typeof deepSeekAccountReadinessObservationBodySchema>,
): DeepSeekAccountReadinessObservation {
  const parsed = deepSeekAccountReadinessObservationBodySchema.parse(body);
  return deepSeekAccountReadinessObservationSchema.parse({
    ...parsed,
    digest: canonicalDigest(parsed),
  });
}

function failedObservation(input: {
  readonly observedAt: string;
  readonly status: Exclude<
    DeepSeekAccountReadinessObservation["status"],
    "ready"
  >;
  readonly httpStatus?: number;
}): DeepSeekAccountReadinessObservation {
  return observation({
    kind: "deepseek-account-readiness-observation",
    schemaVersion: 1,
    observedAt: input.observedAt,
    providerOrigin: DEEPSEEK_UPSTREAM_ORIGIN,
    status: input.status,
    httpStatus: input.httpStatus ?? null,
    isAvailable: null,
    balances: [],
  });
}

function statusForHttp(
  status: number,
): Exclude<
  DeepSeekAccountReadinessObservation["status"],
  "ready" | "credential-unavailable" | "timeout" | "invalid-response"
> {
  if (status === 401 || status === 403) return "unauthenticated";
  if (status === 402) return "quota-exhausted";
  if (status === 429) return "rate-limited";
  return "unavailable";
}

function isTimeout(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === "TimeoutError" || error.name === "AbortError")
  );
}

async function discardResponseBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // The typed HTTP status is primary; cleanup cannot change its meaning.
  }
}

async function boundedResponseText(
  response: Response,
  maximumBytes: number,
): Promise<string> {
  if (response.body === null) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let text = "";
  let bytes = 0;
  try {
    for (;;) {
      const item = await reader.read();
      if (item.done) break;
      bytes += item.value.byteLength;
      if (bytes > maximumBytes) {
        try {
          await reader.cancel();
        } catch {
          // The response ceiling is primary; cancellation is best effort.
        }
        throw new Error("balance response exceeds limit");
      }
      text += decoder.decode(item.value, { stream: true });
    }
    return text + decoder.decode();
  } finally {
    reader.releaseLock();
  }
}

export async function probeDeepSeekAccountReadiness(options: {
  readonly credentialFilePath: string;
  readonly request?: typeof fetch;
  readonly clock?: () => Date;
  readonly timeoutMs?: number;
}): Promise<DeepSeekAccountReadinessObservation> {
  const clock = options.clock ?? (() => new Date());
  const observedAt = clock().toISOString();
  const timeoutMs = options.timeoutMs ?? 10_000;
  if (
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs <= 0 ||
    timeoutMs > 60_000
  ) {
    throw new TypeError("DeepSeek readiness timeout is invalid");
  }
  let apiKey: string;
  try {
    apiKey = await readPrivateProviderCredential(options.credentialFilePath);
  } catch {
    return failedObservation({
      observedAt,
      status: "credential-unavailable",
    });
  }

  let providerResponse: Response;
  try {
    providerResponse = await (options.request ?? fetch)(
      `${DEEPSEEK_UPSTREAM_ORIGIN}/user/balance`,
      {
        method: "GET",
        headers: {
          accept: "application/json",
          authorization: `Bearer ${apiKey}`,
        },
        signal: AbortSignal.timeout(timeoutMs),
      },
    );
  } catch (error: unknown) {
    return failedObservation({
      observedAt,
      status: isTimeout(error) ? "timeout" : "unavailable",
    });
  }

  if (providerResponse.status !== 200) {
    await discardResponseBody(providerResponse);
    return failedObservation({
      observedAt,
      status: statusForHttp(providerResponse.status),
      httpStatus: providerResponse.status,
    });
  }

  let parsed: z.infer<typeof providerBalanceResponseSchema>;
  try {
    const text = await boundedResponseText(providerResponse, 64 * 1024);
    parsed = providerBalanceResponseSchema.parse(JSON.parse(text) as unknown);
  } catch {
    return failedObservation({
      observedAt,
      status: "invalid-response",
      httpStatus: 200,
    });
  }

  const balances = parsed.balance_infos
    .map((balance) => ({
      currency: balance.currency,
      totalBalance: balance.total_balance,
      grantedBalance: balance.granted_balance,
      toppedUpBalance: balance.topped_up_balance,
    }))
    .sort((left, right) => left.currency.localeCompare(right.currency));
  return observation({
    kind: "deepseek-account-readiness-observation",
    schemaVersion: 1,
    observedAt,
    providerOrigin: DEEPSEEK_UPSTREAM_ORIGIN,
    status: parsed.is_available ? "ready" : "quota-exhausted",
    httpStatus: 200,
    isAvailable: parsed.is_available,
    balances,
  });
}
