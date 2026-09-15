import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { persistImmutableFile } from "../../infrastructure/immutable-file.js";
import { canonicalJson, sha256Digest } from "../acquisition/canonical-json.js";
import {
  DisclosureRouteError,
  disclosureRouteObservationRefSchema,
  disclosureRouteObservationSchema,
  disclosureRouteObserveRequestSchema,
  disclosureRouteSourceDocumentSchema,
  disclosureRouteSourceKindSchema,
  disclosureRouteSourceSnapshotSchema,
  type DisclosureRoute,
  type DisclosureRouteObservation,
  type DisclosureRouteObservationRef,
  type DisclosureRouteObserveRequest,
  type DisclosureRouteSourceAdapter,
  type DisclosureRouteSourceSnapshot,
  type OpenDisclosureRouteOptions,
} from "./contracts.js";

const precedence = {
  "vendor-official": 1,
  "official-repository-security": 2,
  "wordpress-org-maintainer": 3,
  "programme-directory": 4,
  "search-result": 5,
} as const;

function rawDigest(bytes: Uint8Array): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function uniqueCanonical<T>(values: readonly T[]): T[] {
  const byCanonical = new Map<string, T>();
  for (const value of values) {
    byCanonical.set(canonicalJson(value), value);
  }
  return [...byCanonical.entries()]
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([, value]) => value);
}

function resolveRoute(sources: readonly DisclosureRouteSourceSnapshot[]) {
  const positive = sources.filter(
    (source) => source.claim.routeKind !== "none-found",
  );
  const checkedScopes = [
    ...new Set(sources.flatMap((source) => source.claim.checkedScopes)),
  ].sort();
  if (positive.length === 0) {
    return {
      kind: "none-found" as const,
      checkedScopes,
      submissionRoutes: [{ kind: "none" as const }],
      conditions: uniqueCanonical(
        sources.map((source) => source.claim.conditions),
      ),
      humanReviewRequired: true,
      residualUncertainty: "only-checked-sources" as const,
    };
  }

  const strongest = positive[0];
  if (strongest === undefined) {
    throw new Error("Disclosure Route lost its strongest source");
  }
  const routeKinds = new Set(positive.map((source) => source.claim.routeKind));
  const explicitExclusivity = new Set(
    positive
      .map((source) => source.claim.conditions.exclusivity)
      .filter((value) => value !== "unspecified"),
  );
  const explicitDisclosure = new Set(
    positive
      .map((source) => source.claim.conditions.disclosure)
      .filter((value) => value !== "unspecified"),
  );
  const conflicting =
    routeKinds.size > 1 ||
    explicitExclusivity.size > 1 ||
    explicitDisclosure.size > 1;
  return {
    kind: conflicting ? ("conflicting" as const) : strongest.claim.routeKind,
    checkedScopes,
    submissionRoutes: uniqueCanonical(
      positive.map((source) => source.claim.submissionRoute),
    ),
    conditions: uniqueCanonical(
      positive.map((source) => source.claim.conditions),
    ),
    strongestEvidenceSourceId: strongest.sourceId,
    humanReviewRequired: conflicting,
  };
}

function semanticRouteDigest(observation: DisclosureRouteObservation): string {
  return sha256Digest({
    pluginIdentity: observation.pluginIdentity,
    kind: observation.route.kind,
    checkedScopes: observation.route.checkedScopes,
    submissionRoutes: observation.route.submissionRoutes,
    conditions: observation.route.conditions,
    residualUncertainty: observation.route.residualUncertainty ?? null,
  });
}

function observationRef(
  observation: DisclosureRouteObservation,
): DisclosureRouteObservationRef {
  const digest = sha256Digest(observation);
  return disclosureRouteObservationRefSchema.parse({
    kind: "disclosure-route-observation-ref",
    schemaVersion: 1,
    id: `disclosure-route:${digest.slice(7, 31)}`,
    digest,
    routeDigest: semanticRouteDigest(observation),
  });
}

function validatedOrigin(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "https:") {
    throw new Error("Disclosure Route requires HTTPS provenance");
  }
  return url.origin;
}

class FileDisclosureRoute implements DisclosureRoute {
  readonly #storageDirectory: string;
  readonly #sourceAdapters: readonly DisclosureRouteSourceAdapter[];
  readonly #clock: () => Date;

  constructor(options: OpenDisclosureRouteOptions) {
    this.#storageDirectory = options.storageDirectory;
    this.#sourceAdapters = [...options.sourceAdapters].sort((left, right) => {
      const sourceOrder =
        precedence[left.sourceKind] - precedence[right.sourceKind];
      return sourceOrder !== 0
        ? sourceOrder
        : left.sourceId < right.sourceId
          ? -1
          : left.sourceId > right.sourceId
            ? 1
            : 0;
    });
    this.#clock = options.clock ?? (() => new Date());
  }

  async observe(
    requestValue: DisclosureRouteObserveRequest,
  ): Promise<DisclosureRouteObservationRef> {
    const request = disclosureRouteObserveRequestSchema.parse(requestValue);
    if (this.#sourceAdapters.length === 0) {
      throw new Error("Disclosure Route requires at least one source Adapter");
    }
    const retrievedAt = this.#clock().toISOString();
    const sources: DisclosureRouteSourceSnapshot[] = [];
    for (const adapter of this.#sourceAdapters) {
      disclosureRouteSourceKindSchema.parse(adapter.sourceKind);
      let retrieved: Awaited<ReturnType<typeof adapter.retrieve>>;
      try {
        retrieved = await adapter.retrieve();
      } catch {
        throw new DisclosureRouteError("acquisition-failed", adapter.sourceId);
      }
      try {
        const allowedOrigins = new Set(
          adapter.allowedOrigins.map(validatedOrigin),
        );
        if (
          allowedOrigins.size === 0 ||
          !allowedOrigins.has(validatedOrigin(adapter.sourceUrl)) ||
          !allowedOrigins.has(validatedOrigin(retrieved.finalUrl))
        ) {
          throw new Error("Disclosure Route redirect left the allowed origins");
        }
      } catch {
        throw new DisclosureRouteError(
          "untrusted-provenance",
          adapter.sourceId,
        );
      }
      let document;
      try {
        document = disclosureRouteSourceDocumentSchema.parse(
          await adapter.parse(retrieved.bytes),
        );
      } catch {
        throw new DisclosureRouteError("parse-failed", adapter.sourceId);
      }
      sources.push(
        disclosureRouteSourceSnapshotSchema.parse({
          sourceId: adapter.sourceId,
          sourceKind: adapter.sourceKind,
          sourceUrl: adapter.sourceUrl,
          finalUrl: retrieved.finalUrl,
          sourceOwner: adapter.sourceOwner,
          retrievedAt,
          contentDigest: rawDigest(retrieved.bytes),
          parserVersion: adapter.parserVersion,
          claim: document.claim,
        }),
      );
    }

    const observation = disclosureRouteObservationSchema.parse({
      kind: "disclosure-route-observation",
      schemaVersion: 1,
      pluginIdentity: request.pluginIdentity,
      requiredFor: request.requiredFor,
      retrievedAt,
      route: resolveRoute(sources),
      sources,
    });
    return this.#persist(observation);
  }

  async inspect(
    refValue: DisclosureRouteObservationRef,
  ): Promise<DisclosureRouteObservation> {
    const ref = disclosureRouteObservationRefSchema.parse(refValue);
    const path = join(
      this.#storageDirectory,
      "disclosure-route-observations",
      `${ref.digest.slice(7)}.json`,
    );
    const bytes = await readFile(path);
    const observation = disclosureRouteObservationSchema.parse(
      JSON.parse(bytes.toString("utf8")),
    );
    const actualRef = observationRef(observation);
    if (
      actualRef.id !== ref.id ||
      actualRef.digest !== ref.digest ||
      actualRef.routeDigest !== ref.routeDigest
    ) {
      throw new Error("Disclosure Route Observation integrity mismatch");
    }
    return observation;
  }

  async #persist(
    observation: DisclosureRouteObservation,
  ): Promise<DisclosureRouteObservationRef> {
    const ref = observationRef(observation);
    const bytes = Buffer.from(canonicalJson(observation), "utf8");
    const directory = join(
      this.#storageDirectory,
      "disclosure-route-observations",
    );
    const path = join(directory, `${ref.digest.slice(7)}.json`);
    if ((await persistImmutableFile(path, bytes)) === "conflict") {
      throw new Error("Disclosure Route Observation artifact conflict");
    }
    return ref;
  }
}

export function openDisclosureRoute(
  options: OpenDisclosureRouteOptions,
): DisclosureRoute {
  return new FileDisclosureRoute(options);
}
