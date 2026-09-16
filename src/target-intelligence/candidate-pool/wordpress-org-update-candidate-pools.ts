import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { canonicalDigest } from "../../infrastructure/canonical-json.js";
import { canonicalJson } from "../acquisition/canonical-json.js";
import type { WordPressOrgAcquisitionResult } from "../acquisition/index.js";
import { defineTargetCandidatePool } from "./candidate-pools.js";
import type { WordPressOrgUpdateFrontier } from "../update-frontier/index.js";
import {
  targetCandidateSchema,
  type TargetCandidate,
  wordPressOrgCandidatePoolFreshnessPolicySchema,
  wordPressOrgUpdateCandidatePoolAssemblyRecordSchema,
  wordPressOrgUpdateCandidatePoolAssemblyRefSchema,
  wordPressOrgUpdateCandidatePoolAssemblyRequestSchema,
  type OpenWordPressOrgUpdateCandidatePoolsOptions,
  type WordPressOrgCandidatePoolFreshnessPolicy,
  type WordPressOrgCandidateSelectionContext,
  type WordPressOrgUpdateCandidatePoolAssemblyRecord,
  type WordPressOrgUpdateCandidatePoolAssemblyRef,
  type WordPressOrgUpdateCandidatePoolAssemblyRequest,
  type WordPressOrgUpdateCandidatePoolAssemblyResult,
  type WordPressOrgUpdateCandidatePools,
} from "./contracts.js";

function hasErrorCode(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === code
  );
}

function assemblyRef(
  record: WordPressOrgUpdateCandidatePoolAssemblyRecord,
): WordPressOrgUpdateCandidatePoolAssemblyRef {
  return wordPressOrgUpdateCandidatePoolAssemblyRefSchema.parse({
    kind: "wordpress-org-update-candidate-pool-assembly-ref",
    schemaVersion: 1,
    id: record.id,
    digest: record.digest,
    assemblyKey: record.assemblyKey,
    revision: record.revision,
    status: record.status,
    ...(record.status === "assembled"
      ? {
          candidatePoolRef: {
            id: record.candidatePool.id,
            digest: record.candidatePool.digest,
          },
        }
      : {}),
  });
}

function assemblyResult(
  ref: WordPressOrgUpdateCandidatePoolAssemblyRef,
): WordPressOrgUpdateCandidatePoolAssemblyResult {
  return ref.status === "assembled"
    ? { status: "assembled", assemblyRef: ref }
    : { status: "assembly-pending", assemblyRef: ref };
}

function decodeAssembly(
  value: unknown,
): WordPressOrgUpdateCandidatePoolAssemblyRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Candidate Pool Assembly artifact is malformed");
  }
  const record = value as Readonly<Record<string, unknown>>;
  const { id: _id, digest, ...body } = record;
  if (typeof digest !== "string" || digest !== canonicalDigest(body)) {
    throw new Error("Candidate Pool Assembly digest mismatch");
  }
  return wordPressOrgUpdateCandidatePoolAssemblyRecordSchema.parse(value);
}

function observationIsCurrent(
  context: WordPressOrgCandidateSelectionContext,
  now: number,
): boolean {
  return (
    Date.parse(context.disclosureRoute.currentUntil) >= now &&
    context.programmes.every(
      (programme) => Date.parse(programme.currentUntil) >= now,
    )
  );
}

function sourceFailureDetail(result: WordPressOrgAcquisitionResult): string {
  if (result.status === "failed") return result.reason;
  const reasons =
    "intake" in result
      ? result.intake.receipt.reasons
      : "reasons" in result
        ? result.reasons
        : [];
  return `${result.status}:${reasons.join(",")}`.slice(0, 256);
}

function sourceMatchesLead(
  result: Extract<WordPressOrgAcquisitionResult, { readonly status: "ready" }>,
  lead: WordPressOrgUpdateFrontier["leads"][number],
  policy: WordPressOrgUpdateCandidatePoolAssemblyRequest["targetIntakePolicy"],
): boolean {
  const packet = result.intake.packet;
  const original = result.acquisitionOriginal;
  return (
    original.pluginIdentity === lead.pluginIdentity &&
    original.version === lead.stableVersion &&
    original.observationRef.id === lead.observationRef.id &&
    original.observationRef.digest === lead.observationRef.digest &&
    result.acquisitionOriginalRef.digest === original.contentDigest &&
    packet.pluginIdentity === lead.pluginIdentity &&
    packet.version === lead.stableVersion &&
    packet.targetSnapshot.pluginSlug === lead.officialSlug &&
    packet.targetSnapshot.version === lead.stableVersion &&
    packet.sourceCapture.digest === packet.sourceTree.digest &&
    packet.provenance.kind === "wordpress-org" &&
    packet.provenance.sourceUrl === original.sourceUrl &&
    packet.provenance.acquisitionRef.id === result.acquisitionOriginalRef.id &&
    packet.provenance.acquisitionRef.digest ===
      result.acquisitionOriginalRef.digest &&
    packet.policy.id === policy.id &&
    packet.policy.digest === policy.digest
  );
}

function updateActivity(
  frontier: WordPressOrgUpdateFrontier,
  lead: WordPressOrgUpdateFrontier["leads"][number],
) {
  const signals = new Set(
    lead.changesets.flatMap((changeset) => changeset.navigationSignals),
  );
  return {
    frontierRef: { id: frontier.id, digest: frontier.digest },
    fromRevisionExclusive: frontier.cursor.fromRevisionExclusive,
    toRevisionInclusive: Math.max(
      ...lead.changesets.map((changeset) => changeset.revision),
    ),
    changesetCount: lead.changesets.length,
    changedPhpFileOccurrences: lead.changesets.reduce(
      (total, changeset) => total + changeset.changedPhpFiles,
      0,
    ),
    addedPhpLines: lead.changesets.reduce(
      (total, changeset) => total + changeset.addedPhpLines,
      0,
    ),
    navigationSignals: [...signals].sort(),
  };
}

class FileWordPressOrgUpdateCandidatePools implements WordPressOrgUpdateCandidatePools {
  readonly #options: OpenWordPressOrgUpdateCandidatePoolsOptions;
  readonly #clock: () => Date;

  constructor(options: OpenWordPressOrgUpdateCandidatePoolsOptions) {
    this.#options = options;
    this.#clock = options.clock ?? (() => new Date());
  }

  async assemble(
    requestValue: WordPressOrgUpdateCandidatePoolAssemblyRequest,
  ): Promise<WordPressOrgUpdateCandidatePoolAssemblyResult> {
    const request =
      wordPressOrgUpdateCandidatePoolAssemblyRequestSchema.parse(requestValue);
    const inputDigest = canonicalDigest(request);
    const path = this.#assemblyPath(request);
    const existing = await this.#read(path);
    if (existing !== undefined) {
      if (existing.inputDigest !== inputDigest) {
        throw new Error("Candidate Pool Assembly revision input conflict");
      }
      const ref = assemblyRef(existing);
      return assemblyResult(ref);
    }

    const frontier = await this.#options.updateFrontiers.inspect(
      request.updateFrontierRef,
    );
    const frontierIdentities = new Set(
      frontier.leads.map((lead) => lead.pluginIdentity),
    );
    if (
      request.selectionContexts.some(
        (context) => !frontierIdentities.has(context.pluginIdentity),
      )
    ) {
      throw new Error("Selection Context is outside the Update Frontier");
    }

    const contextByIdentity = new Map(
      request.selectionContexts.map((context) => [
        context.pluginIdentity,
        context,
      ]),
    );
    const now = this.#clock();
    const unresolved: Array<{
      pluginIdentity: string;
      reason:
        | "selection-context-missing"
        | "selection-observation-expired"
        | "target-observation-expired"
        | "target-metadata-invalid"
        | "source-acquisition-failed"
        | "source-binding-mismatch";
      detail?: string;
    }> = [];
    const candidates: TargetCandidate[] = [];

    for (const lead of [...frontier.leads].sort((left, right) =>
      left.pluginIdentity.localeCompare(right.pluginIdentity),
    )) {
      const context = contextByIdentity.get(lead.pluginIdentity);
      if (context === undefined) {
        unresolved.push({
          pluginIdentity: lead.pluginIdentity,
          reason: "selection-context-missing",
        });
        continue;
      }
      const observedAt = Date.parse(lead.observedAt);
      const lastUpdatedAt = Date.parse(lead.lastUpdated);
      if (!Number.isFinite(observedAt) || !Number.isFinite(lastUpdatedAt)) {
        unresolved.push({
          pluginIdentity: lead.pluginIdentity,
          reason: "target-metadata-invalid",
        });
        continue;
      }
      const currentUntil = observedAt + request.freshnessPolicy.maximumAgeMs;
      if (currentUntil < now.getTime()) {
        unresolved.push({
          pluginIdentity: lead.pluginIdentity,
          reason: "target-observation-expired",
        });
        continue;
      }
      if (!observationIsCurrent(context, now.getTime())) {
        unresolved.push({
          pluginIdentity: lead.pluginIdentity,
          reason: "selection-observation-expired",
        });
        continue;
      }

      let acquisition: WordPressOrgAcquisitionResult;
      try {
        acquisition = await this.#options.targetSource.acquire({
          kind: "wordpress-org-target-acquire",
          schemaVersion: 1,
          observationRef: lead.observationRef,
          requestedVersion: lead.stableVersion,
          policy: request.targetIntakePolicy,
        });
      } catch {
        unresolved.push({
          pluginIdentity: lead.pluginIdentity,
          reason: "source-acquisition-failed",
          detail: "source-error",
        });
        continue;
      }
      if (acquisition.status !== "ready") {
        unresolved.push({
          pluginIdentity: lead.pluginIdentity,
          reason: "source-acquisition-failed",
          detail: sourceFailureDetail(acquisition),
        });
        continue;
      }
      if (!sourceMatchesLead(acquisition, lead, request.targetIntakePolicy)) {
        unresolved.push({
          pluginIdentity: lead.pluginIdentity,
          reason: "source-binding-mismatch",
        });
        continue;
      }

      const packet = acquisition.intake.packet;
      const candidateSeed = {
        frontier: { id: frontier.id, digest: frontier.digest },
        pluginIdentity: lead.pluginIdentity,
        version: packet.version,
        sourceDigest: packet.sourceTree.digest,
      };
      candidates.push(
        targetCandidateSchema.parse({
          candidateId: `update-candidate:${canonicalDigest(candidateSeed).slice(7, 31)}`,
          target: {
            pluginIdentity: lead.pluginIdentity,
            verifiedVersion: packet.version,
            canonicalFileManifestDigest: packet.sourceTree.digest,
          },
          targetObservation: {
            ref: {
              id: lead.observationRef.id,
              digest: lead.observationRef.digest,
            },
            retrievedAt: lead.observedAt,
            currentUntil: new Date(currentUntil).toISOString(),
            acquisition: "available",
            provenance: "verified",
            identity: "verified",
          },
          selectionFacts: {
            activeInstallCount: lead.activeInstallations,
            lastUpdatedAt: new Date(lastUpdatedAt).toISOString(),
            integrations: context.integrations,
            updateActivity: updateActivity(frontier, lead),
          },
          programmes: context.programmes,
          disclosureRoute: context.disclosureRoute,
          ...(context.vulnerabilityHistoryAggregate === undefined
            ? {}
            : {
                vulnerabilityHistoryAggregate:
                  context.vulnerabilityHistoryAggregate,
              }),
          researchHistory: context.researchHistory,
        }),
      );
    }

    unresolved.sort((left, right) =>
      left.pluginIdentity.localeCompare(right.pluginIdentity),
    );
    const candidatePool =
      candidates.length === 0
        ? undefined
        : defineTargetCandidatePool({
            id: request.candidatePoolId,
            candidates,
          });
    const body = {
      kind: "wordpress-org-update-candidate-pool-assembly-record" as const,
      schemaVersion: 1 as const,
      inputDigest,
      assemblyKey: request.assemblyKey,
      revision: request.revision,
      candidatePoolId: request.candidatePoolId,
      updateFrontierRef: request.updateFrontierRef,
      targetIntakePolicy: {
        id: request.targetIntakePolicy.id,
        digest: request.targetIntakePolicy.digest,
      },
      freshnessPolicy: {
        id: request.freshnessPolicy.id,
        digest: request.freshnessPolicy.digest,
      },
      assembledAt: now.toISOString(),
      upstreamUnresolved: frontier.unresolved.length,
      unresolved,
      ...(candidatePool === undefined
        ? { status: "assembly-pending" as const }
        : { status: "assembled" as const, candidatePool }),
    };
    const digest = canonicalDigest(body);
    const record = wordPressOrgUpdateCandidatePoolAssemblyRecordSchema.parse({
      ...body,
      id: `update-candidate-pool-assembly:${digest.slice(7, 31)}`,
      digest,
    });
    await this.#create(path, record);
    const ref = assemblyRef(record);
    return assemblyResult(ref);
  }

  async inspect(
    refValue: WordPressOrgUpdateCandidatePoolAssemblyRef,
  ): Promise<WordPressOrgUpdateCandidatePoolAssemblyRecord> {
    const ref =
      wordPressOrgUpdateCandidatePoolAssemblyRefSchema.parse(refValue);
    const record = await this.#read(this.#assemblyPath(ref));
    if (record === undefined) {
      throw new Error(
        `Candidate Pool Assembly not found: ${ref.assemblyKey} revision ${ref.revision}`,
      );
    }
    if (
      record.id !== ref.id ||
      record.digest !== ref.digest ||
      record.status !== ref.status ||
      (record.status === "assembled" &&
        (ref.status !== "assembled" ||
          record.candidatePool.id !== ref.candidatePoolRef.id ||
          record.candidatePool.digest !== ref.candidatePoolRef.digest))
    ) {
      throw new Error("Candidate Pool Assembly reference mismatch");
    }
    return record;
  }

  #assemblyPath(query: {
    readonly assemblyKey: string;
    readonly revision: number;
  }): string {
    return join(
      this.#options.storageDirectory,
      "wordpress-org-update-candidate-pools-v1",
      `${query.assemblyKey}.revision-${query.revision}.json`,
    );
  }

  async #read(
    path: string,
  ): Promise<WordPressOrgUpdateCandidatePoolAssemblyRecord | undefined> {
    try {
      return decodeAssembly(JSON.parse(await readFile(path, "utf8")));
    } catch (error) {
      if (hasErrorCode(error, "ENOENT")) return undefined;
      throw error;
    }
  }

  async #create(
    path: string,
    record: WordPressOrgUpdateCandidatePoolAssemblyRecord,
  ): Promise<void> {
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    try {
      await writeFile(path, canonicalJson(record), {
        flag: "wx",
        mode: 0o600,
      });
    } catch (error) {
      if (!hasErrorCode(error, "EEXIST")) throw error;
      const raced = await this.#read(path);
      if (
        raced === undefined ||
        raced.inputDigest !== record.inputDigest ||
        raced.digest !== record.digest
      ) {
        throw new Error("Candidate Pool Assembly revision input conflict");
      }
    }
  }
}

export function defineWordPressOrgCandidatePoolFreshnessPolicy(input: {
  readonly id: string;
  readonly maximumAgeMs: number;
}): WordPressOrgCandidatePoolFreshnessPolicy {
  const body = {
    kind: "wordpress-org-candidate-pool-freshness-policy" as const,
    schemaVersion: 1 as const,
    ...input,
  };
  return wordPressOrgCandidatePoolFreshnessPolicySchema.parse({
    ...body,
    digest: canonicalDigest(body),
  });
}

export function openWordPressOrgUpdateCandidatePools(
  options: OpenWordPressOrgUpdateCandidatePoolsOptions,
): WordPressOrgUpdateCandidatePools {
  return new FileWordPressOrgUpdateCandidatePools(options);
}
