/** Token counts, summed or declared. */
export interface ModelTokenCounts {
  readonly input: number;
  readonly cacheCreation: number;
  readonly cacheRead: number;
  readonly output: number;
  readonly total: number;
}

/** Source-tool counts summed across attempts. */
export interface RolledSourceUsage {
  readonly queries: number;
  readonly scanBytes: number;
  readonly responseBytes: number;
}

/**
 * What one Model Attempt reports about itself.
 *
 * Declared structurally rather than imported, so the usage contract can state
 * its own aggregate invariant in terms of this module without depending back
 * on it. `ModelAttemptUsageV2` satisfies this shape.
 */
export interface ModelAttemptUsageFacts {
  readonly measurement: "reported" | "partial";
  readonly estimatedCostUsd?: number | undefined;
  readonly wallTimeMs: number;
  readonly modelTurns: number;
  readonly modelTokens: ModelTokenCounts;
  readonly structuredOutputBytes: number;
  readonly source: RolledSourceUsage;
}

/**
 * What a set of Model Attempts cost, summed across every dimension the Attempt
 * usage records.
 *
 * The coverage questions are answered but not decided: `attempts`,
 * `reportedAttempts`, `everyAttemptReported` and `everyCostReported` are the
 * facts a caller needs to reach its own `measurement`, and different callers
 * legitimately reach different ones. The campaign's own usage calls itself
 * reported when every planned Attempt reported; the progress projection of a
 * run still in flight additionally refuses to, because a campaign that has not
 * finished cannot have complete usage. Deciding here would force one of those
 * to be wrong.
 */
export interface RolledModelUsage {
  /** How many Attempts were rolled up, not how many were planned. */
  readonly attempts: number;
  readonly reportedAttempts: number;
  /** Whether every rolled-up Attempt reported its usage rather than estimating. */
  readonly everyAttemptReported: boolean;
  /** Whether every rolled-up Attempt carried a cost. Independent of the above. */
  readonly everyCostReported: boolean;
  readonly modelWallTimeMs: number;
  readonly modelTurns: number;
  readonly modelTokens: ModelTokenCounts;
  readonly structuredOutputBytes: number;
  readonly estimatedCostUsd: number;
  readonly source: RolledSourceUsage;
}

/**
 * Sums token counts, deriving the total from the categories.
 *
 * Summing the totals alongside the categories agrees for any counts that
 * already satisfy the contract, so the two only differ when something upstream
 * is wrong — which is exactly when the sum must not launder it. Deriving makes
 * a total that does not add up impossible to produce here, so the usage
 * contract's aggregate check can be stated against this function rather than
 * against a second copy of the arithmetic.
 */
export function sumModelTokens(
  counts: Iterable<ModelTokenCounts>,
): ModelTokenCounts {
  let input = 0;
  let cacheCreation = 0;
  let cacheRead = 0;
  let output = 0;

  for (const count of counts) {
    input += count.input;
    cacheCreation += count.cacheCreation;
    cacheRead += count.cacheRead;
    output += count.output;
  }

  return {
    input,
    cacheCreation,
    cacheRead,
    output,
    total: input + cacheCreation + cacheRead + output,
  };
}

/**
 * Sums Model Attempt usage across attempts.
 *
 * Every consumer of Attempt usage needs the same nine sums, and each one used
 * to write them out: the campaign's own usage record, each of its two owner
 * roll-ups, and the record layer's progress projection. Written by hand the
 * sums agree by coincidence, and a dimension added to the usage contract is
 * silently dropped by whichever copy is not updated.
 *
 * An empty roll-up is an explicit zero, never absent. A campaign that spent
 * nothing spent zero, and a caller must not have to tell that apart from a
 * campaign whose usage was not measured — that distinction is carried by
 * `everyAttemptReported`, where it can be reported rather than inferred.
 */
export function rollUpModelAttemptUsage(
  usages: Iterable<ModelAttemptUsageFacts>,
): RolledModelUsage {
  const tokens: ModelTokenCounts[] = [];
  let attempts = 0;
  let reportedAttempts = 0;
  let everyCostReported = true;
  let modelWallTimeMs = 0;
  let modelTurns = 0;
  let structuredOutputBytes = 0;
  let estimatedCostUsd = 0;
  let queries = 0;
  let scanBytes = 0;
  let responseBytes = 0;

  for (const usage of usages) {
    attempts += 1;
    if (usage.measurement === "reported") reportedAttempts += 1;
    if (usage.estimatedCostUsd === undefined) everyCostReported = false;
    modelWallTimeMs += usage.wallTimeMs;
    modelTurns += usage.modelTurns;
    structuredOutputBytes += usage.structuredOutputBytes;
    estimatedCostUsd += usage.estimatedCostUsd ?? 0;
    queries += usage.source.queries;
    scanBytes += usage.source.scanBytes;
    responseBytes += usage.source.responseBytes;
    tokens.push(usage.modelTokens);
  }

  return {
    attempts,
    reportedAttempts,
    everyAttemptReported: reportedAttempts === attempts,
    everyCostReported,
    modelWallTimeMs,
    modelTurns,
    modelTokens: sumModelTokens(tokens),
    structuredOutputBytes,
    estimatedCostUsd,
    source: { queries, scanBytes, responseBytes },
  };
}
