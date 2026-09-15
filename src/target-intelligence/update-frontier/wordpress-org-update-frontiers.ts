import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { canonicalDigest } from "../../infrastructure/canonical-json.js";
import { canonicalJson } from "../acquisition/canonical-json.js";
import type { ObservedWordPressOrgTarget } from "../acquisition/index.js";
import {
  WordPressOrgChangesetSourceError,
  wordPressOrgChangesetSourceResponseSchema,
  wordPressOrgUpdateFrontierPolicySchema,
  wordPressOrgUpdateFrontierRefSchema,
  wordPressOrgUpdateFrontierRefreshRequestSchema,
  wordPressOrgUpdateFrontierSchema,
  type OpenWordPressOrgUpdateFrontiersOptions,
  type WordPressOrgUpdateFrontier,
  type WordPressOrgUpdateFrontierFailureReason,
  type WordPressOrgUpdateFrontierPolicy,
  type WordPressOrgUpdateFrontierRefreshRequest,
  type WordPressOrgUpdateFrontierRefreshResult,
  type WordPressOrgUpdateFrontierRef,
  type WordPressOrgUpdateFrontiers,
  type WordPressOrgUpdateNavigationSignal,
} from "./contracts.js";

interface ParsedTargetChange {
  readonly pluginSlug: string;
  readonly changedPhpFiles: number;
}

interface ParsedRevision {
  readonly revision: number;
  readonly committedAt: string;
  readonly targets: readonly ParsedTargetChange[];
}

interface EvidenceRef {
  readonly id: string;
  readonly digest: string;
  readonly byteLength: number;
}

interface ChangesetSummary {
  readonly revision: number;
  readonly committedAt: string;
  readonly changedPhpFiles: number;
  readonly addedPhpLines: number;
  readonly navigationSignals: readonly WordPressOrgUpdateNavigationSignal[];
  readonly evidenceRef: EvidenceRef;
}

const SIGNAL_PATTERNS: ReadonlyArray<
  readonly [WordPressOrgUpdateNavigationSignal, RegExp]
> = [
  [
    "authorization-boundary",
    /\b(?:current_user_can|user_can|check_ajax_referer|wp_verify_nonce|permission_callback)\b/,
  ],
  [
    "database-effect",
    /(?:\$wpdb\b|->(?:query|get_results|get_row|get_var|prepare)\s*\()/,
  ],
  [
    "dynamic-execution",
    /\b(?:eval|assert|include|include_once|require|require_once|call_user_func)\b/,
  ],
  [
    "filesystem-effect",
    /\b(?:file_get_contents|file_put_contents|fopen|rename|unlink|copy|move_uploaded_file|wp_handle_upload)\b/,
  ],
  ["object-deserialization", /\b(?:unserialize|maybe_unserialize)\b/],
  ["output-boundary", /\b(?:echo|print|wp_send_json|wp_die)\b/],
  [
    "request-input",
    /(?:\$_(?:GET|POST|REQUEST|FILES|COOKIE)\b|\b(?:register_rest_route|add_shortcode)\b|wp_ajax_|admin_post_)/,
  ],
];

function hasErrorCode(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === code
  );
}

function rawDigest(bytes: Uint8Array): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function decodeXml(value: string): string {
  return value.replace(
    /&(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-f]+);/gi,
    (entity) => {
      switch (entity.toLowerCase()) {
        case "&amp;":
          return "&";
        case "&lt;":
          return "<";
        case "&gt;":
          return ">";
        case "&quot;":
          return '"';
        case "&apos;":
          return "'";
        default: {
          const hexadecimal = entity.toLowerCase().startsWith("&#x");
          const digits = entity.slice(hexadecimal ? 3 : 2, -1);
          const point = Number.parseInt(digits, hexadecimal ? 16 : 10);
          if (
            !Number.isInteger(point) ||
            point < 0 ||
            point > 0x10ffff ||
            (point >= 0xd800 && point <= 0xdfff)
          ) {
            throw new Error("Invalid XML character reference");
          }
          return String.fromCodePoint(point);
        }
      }
    },
  );
}

function attribute(tag: string, name: string): string | undefined {
  const match = new RegExp(`(?:^|\\s)${name}="([^"]*)"`).exec(tag);
  return match === null ? undefined : decodeXml(match[1] ?? "");
}

function parseSvnLog(
  bytes: Uint8Array,
  request: WordPressOrgUpdateFrontierRefreshRequest,
): readonly ParsedRevision[] {
  const xml = Buffer.from(bytes).toString("utf8");
  if (
    !/^\s*(?:<\?xml[\s\S]*?\?>\s*)?<log(?:\s[^>]*)?>[\s\S]*<\/log>\s*$/.test(
      xml,
    )
  ) {
    throw new Error("SVN log root is malformed");
  }
  const revisions: ParsedRevision[] = [];
  const seen = new Set<number>();
  const entryPattern = /<logentry\b([^>]*)>([\s\S]*?)<\/logentry>/g;
  for (const match of xml.matchAll(entryPattern)) {
    const revisionValue = attribute(match[1] ?? "", "revision");
    const revision = Number(revisionValue);
    const body = match[2] ?? "";
    const dateMatch = /<date>([\s\S]*?)<\/date>/.exec(body);
    const date = dateMatch === null ? undefined : decodeXml(dateMatch[1] ?? "");
    const committedAt = date === undefined ? Number.NaN : Date.parse(date);
    if (
      !Number.isSafeInteger(revision) ||
      revision <= request.fromRevisionExclusive ||
      seen.has(revision) ||
      !Number.isFinite(committedAt)
    ) {
      throw new Error("SVN log entry binding is malformed");
    }
    seen.add(revision);

    const pathsByPlugin = new Map<string, Set<string>>();
    const pathPattern = /<path\b([^>]*)>([\s\S]*?)<\/path>/g;
    let parsedPaths = 0;
    for (const pathMatch of body.matchAll(pathPattern)) {
      parsedPaths += 1;
      const tag = pathMatch[1] ?? "";
      if (attribute(tag, "kind") !== "file") continue;
      const path = decodeXml(pathMatch[2] ?? "");
      const relevant = /^\/([a-z0-9][a-z0-9-]*)\/trunk\/(.+\.php)$/i.exec(path);
      if (relevant === null) continue;
      const pluginSlug = (relevant[1] ?? "").toLowerCase();
      const relativePath = relevant[2] ?? "";
      const files = pathsByPlugin.get(pluginSlug) ?? new Set<string>();
      files.add(relativePath);
      pathsByPlugin.set(pluginSlug, files);
    }
    if (parsedPaths !== (body.match(/<path\b/g) ?? []).length) {
      throw new Error("SVN log path list is malformed");
    }
    revisions.push({
      revision,
      committedAt: new Date(committedAt).toISOString(),
      targets: [...pathsByPlugin.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([pluginSlug, paths]) => ({
          pluginSlug,
          changedPhpFiles: paths.size,
        })),
    });
  }
  if (revisions.length !== (xml.match(/<logentry\b/g) ?? []).length) {
    throw new Error("SVN log entry list is malformed");
  }
  if (revisions.length > request.policy.maximumRevisions) {
    throw new Error("SVN log exceeded its revision ceiling");
  }
  return revisions.sort((left, right) => left.revision - right.revision);
}

function parseSvnDiff(
  bytes: Uint8Array,
  expectedRevision: number,
): {
  readonly addedPhpLines: number;
  readonly navigationSignals: readonly WordPressOrgUpdateNavigationSignal[];
} {
  const diff = Buffer.from(bytes).toString("utf8");
  const revisionHeaders = [
    ...diff.matchAll(/^\+\+\+ .*\(revision (\d+)\)\s*$/gm),
  ];
  if (
    revisionHeaders.length === 0 ||
    revisionHeaders.some((match) => Number(match[1]) !== expectedRevision)
  ) {
    throw new Error("SVN diff revision binding is malformed");
  }
  const addedLines: string[] = [];
  let insideHunk = false;
  for (const line of diff.split(/\r?\n/)) {
    if (line.startsWith("@@")) {
      insideHunk = true;
      continue;
    }
    if (
      line.startsWith("Index: ") ||
      line.startsWith("Property changes on: ") ||
      line.startsWith("diff --git ")
    ) {
      insideHunk = false;
      continue;
    }
    if (insideHunk && line.startsWith("+")) {
      addedLines.push(line.slice(1));
    }
  }
  const addedSource = addedLines.join("\n");
  const navigationSignals = SIGNAL_PATTERNS.flatMap(([signal, pattern]) =>
    pattern.test(addedSource) ? [signal] : [],
  ).sort();
  return { addedPhpLines: addedLines.length, navigationSignals };
}

function frontierRef(
  frontier: WordPressOrgUpdateFrontier,
): WordPressOrgUpdateFrontierRef {
  return wordPressOrgUpdateFrontierRefSchema.parse({
    kind: "wordpress-org-update-frontier-ref",
    schemaVersion: 1,
    id: frontier.id,
    digest: frontier.digest,
    frontierKey: frontier.frontierKey,
    revision: frontier.revision,
    toRevisionInclusive: frontier.cursor.toRevisionInclusive,
  });
}

function decodeFrontier(value: unknown): WordPressOrgUpdateFrontier {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Update Frontier artifact is malformed");
  }
  const record = value as Readonly<Record<string, unknown>>;
  const { id: _id, digest, ...body } = record;
  if (typeof digest !== "string" || digest !== canonicalDigest(body)) {
    throw new Error("Update Frontier digest mismatch");
  }
  return wordPressOrgUpdateFrontierSchema.parse(value);
}

function mapSourceFailure(
  error: WordPressOrgChangesetSourceError,
): WordPressOrgUpdateFrontierFailureReason {
  switch (error.code) {
    case "timed-out":
      return "source-timeout";
    case "quota-exceeded":
      return "source-quota-exceeded";
    case "source-failed":
      return "source-failed";
  }
}

class FileWordPressOrgUpdateFrontiers implements WordPressOrgUpdateFrontiers {
  readonly #options: OpenWordPressOrgUpdateFrontiersOptions;
  readonly #clock: () => Date;

  constructor(options: OpenWordPressOrgUpdateFrontiersOptions) {
    this.#options = options;
    this.#clock = options.clock ?? (() => new Date());
  }

  async refresh(
    requestValue: WordPressOrgUpdateFrontierRefreshRequest,
  ): Promise<WordPressOrgUpdateFrontierRefreshResult> {
    const request =
      wordPressOrgUpdateFrontierRefreshRequestSchema.parse(requestValue);
    const inputDigest = canonicalDigest(request);
    const existing = await this.#read(this.#frontierPath(request));
    if (existing !== undefined) {
      if (existing.inputDigest !== inputDigest) {
        throw new Error("Update Frontier revision input conflict");
      }
      return { status: "current", frontierRef: frontierRef(existing) };
    }

    let logResponse;
    try {
      logResponse = wordPressOrgChangesetSourceResponseSchema.parse(
        await this.#options.changesetSource.retrieve({
          kind: "log",
          fromRevisionExclusive: request.fromRevisionExclusive,
          maximumRevisions: request.policy.maximumRevisions,
          maximumBytes: request.policy.maximumLogBytes,
        }),
      );
      if (logResponse.bytes.byteLength > request.policy.maximumLogBytes) {
        throw new WordPressOrgChangesetSourceError("quota-exceeded", "log");
      }
    } catch (error) {
      return this.#failure(
        request,
        inputDigest,
        error instanceof WordPressOrgChangesetSourceError
          ? mapSourceFailure(error)
          : "source-failed",
      );
    }

    const logEvidenceRef = await this.#persistEvidence(logResponse.bytes);
    let revisions: readonly ParsedRevision[];
    try {
      revisions = parseSvnLog(logResponse.bytes, request);
    } catch {
      return this.#failure(request, inputDigest, "invalid-log");
    }

    const revisionsByPlugin = new Map<string, number[]>();
    for (const entry of revisions) {
      for (const target of entry.targets) {
        const pluginRevisions = revisionsByPlugin.get(target.pluginSlug) ?? [];
        pluginRevisions.push(entry.revision);
        revisionsByPlugin.set(target.pluginSlug, pluginRevisions);
      }
    }

    const eligibleObservations = new Map<string, ObservedWordPressOrgTarget>();
    const unresolved: WordPressOrgUpdateFrontier["unresolved"] = [];
    let belowMinimumActiveInstallations = 0;
    for (const [pluginSlug, pluginRevisions] of [
      ...revisionsByPlugin.entries(),
    ].sort(([left], [right]) => left.localeCompare(right))) {
      let observationResult;
      try {
        observationResult = await this.#options.targetSource.observe({
          kind: "wordpress-org-target-observe",
          schemaVersion: 1,
          slug: pluginSlug,
        });
      } catch {
        unresolved.push({
          pluginIdentity: `wporg:${pluginSlug}`,
          revisions: pluginRevisions,
          reason: "network-failure",
        });
        continue;
      }
      if (observationResult.status === "failed") {
        unresolved.push({
          pluginIdentity: observationResult.pluginIdentity,
          revisions: pluginRevisions,
          reason: observationResult.reason,
        });
        continue;
      }
      if (
        observationResult.observation.pluginIdentity !==
          `wporg:${pluginSlug}` ||
        observationResult.observation.officialSlug !== pluginSlug
      ) {
        unresolved.push({
          pluginIdentity: `wporg:${pluginSlug}`,
          revisions: pluginRevisions,
          reason: "invalid-metadata",
        });
        continue;
      }
      if (
        observationResult.observation.activeInstallations <
        request.policy.minimumActiveInstallations
      ) {
        belowMinimumActiveInstallations += 1;
        continue;
      }
      eligibleObservations.set(pluginSlug, observationResult);
    }

    const summariesByPlugin = new Map<string, ChangesetSummary[]>();
    for (const entry of revisions) {
      for (const target of entry.targets) {
        if (!eligibleObservations.has(target.pluginSlug)) continue;
        let diffResponse;
        try {
          diffResponse = wordPressOrgChangesetSourceResponseSchema.parse(
            await this.#options.changesetSource.retrieve({
              kind: "diff",
              revision: entry.revision,
              pluginSlug: target.pluginSlug,
              maximumBytes: request.policy.maximumDiffBytes,
            }),
          );
          if (diffResponse.bytes.byteLength > request.policy.maximumDiffBytes) {
            throw new WordPressOrgChangesetSourceError(
              "quota-exceeded",
              "diff",
            );
          }
        } catch (error) {
          return this.#failure(
            request,
            inputDigest,
            error instanceof WordPressOrgChangesetSourceError
              ? mapSourceFailure(error)
              : "source-failed",
          );
        }
        const evidenceRef = await this.#persistEvidence(diffResponse.bytes);
        let diffSummary;
        try {
          diffSummary = parseSvnDiff(diffResponse.bytes, entry.revision);
        } catch {
          return this.#failure(request, inputDigest, "invalid-diff");
        }
        const summaries = summariesByPlugin.get(target.pluginSlug) ?? [];
        summaries.push({
          revision: entry.revision,
          committedAt: entry.committedAt,
          changedPhpFiles: target.changedPhpFiles,
          ...diffSummary,
          evidenceRef,
        });
        summariesByPlugin.set(target.pluginSlug, summaries);
      }
    }

    const leads: WordPressOrgUpdateFrontier["leads"] = [];
    for (const [pluginSlug, observationResult] of [
      ...eligibleObservations.entries(),
    ].sort(([left], [right]) => left.localeCompare(right))) {
      const changesets = summariesByPlugin.get(pluginSlug);
      if (changesets === undefined || changesets.length === 0) {
        throw new Error("Eligible Update Frontier Target has no changeset");
      }
      leads.push({
        pluginIdentity: observationResult.observation.pluginIdentity,
        officialSlug: observationResult.observation.officialSlug,
        stableVersion: observationResult.observation.stableVersion,
        activeInstallations: observationResult.observation.activeInstallations,
        lastUpdated: observationResult.observation.lastUpdated,
        observedAt: observationResult.observation.observedAt,
        observationRef: observationResult.observationRef,
        changesets: [...changesets]
          .sort((left, right) => left.revision - right.revision)
          .map((changeset) => ({
            ...changeset,
            navigationSignals: [...changeset.navigationSignals],
          })),
      });
    }

    const toRevisionInclusive = revisions.reduce(
      (latest, entry) => Math.max(latest, entry.revision),
      request.fromRevisionExclusive,
    );
    const body = {
      kind: "wordpress-org-update-frontier" as const,
      schemaVersion: 1 as const,
      inputDigest,
      frontierKey: request.frontierKey,
      revision: request.revision,
      generatedAt: this.#clock().toISOString(),
      source: {
        kind: "wordpress-org-svn" as const,
        repositoryUrl: logResponse.repositoryUrl,
        parserVersion: "wordpress-org-svn-update-frontier-v1" as const,
        logEvidenceRef,
      },
      cursor: {
        fromRevisionExclusive: request.fromRevisionExclusive,
        toRevisionInclusive,
      },
      policy: { id: request.policy.id, digest: request.policy.digest },
      leads,
      unresolved,
      filtered: {
        belowMinimumActiveInstallations,
        revisionsWithoutTrunkPhpChanges: revisions.filter(
          ({ targets }) => targets.length === 0,
        ).length,
      },
    };
    const digest = canonicalDigest(body);
    const frontier = wordPressOrgUpdateFrontierSchema.parse({
      ...body,
      id: `wporg-update-frontier:${digest.slice(7, 31)}`,
      digest,
    });
    await this.#createFrontier(this.#frontierPath(request), frontier);
    return { status: "current", frontierRef: frontierRef(frontier) };
  }

  async inspect(
    refValue: WordPressOrgUpdateFrontierRef,
  ): Promise<WordPressOrgUpdateFrontier> {
    const ref = wordPressOrgUpdateFrontierRefSchema.parse(refValue);
    const frontier = await this.#read(this.#frontierPath(ref));
    if (frontier === undefined) {
      throw new Error(
        `Update Frontier not found: ${ref.frontierKey} revision ${ref.revision}`,
      );
    }
    if (
      frontier.id !== ref.id ||
      frontier.digest !== ref.digest ||
      frontier.cursor.toRevisionInclusive !== ref.toRevisionInclusive
    ) {
      throw new Error("Update Frontier reference mismatch");
    }
    return frontier;
  }

  #failure(
    request: WordPressOrgUpdateFrontierRefreshRequest,
    inputDigest: string,
    reason: WordPressOrgUpdateFrontierFailureReason,
  ): WordPressOrgUpdateFrontierRefreshResult {
    return {
      status: "failed",
      frontierKey: request.frontierKey,
      revision: request.revision,
      inputDigest,
      reason,
    };
  }

  #frontierPath(query: {
    readonly frontierKey: string;
    readonly revision: number;
  }): string {
    return join(
      this.#options.storageDirectory,
      "wordpress-org-update-frontiers-v1",
      `${query.frontierKey}.revision-${query.revision}.json`,
    );
  }

  async #persistEvidence(bytes: Uint8Array): Promise<EvidenceRef> {
    const digest = rawDigest(bytes);
    const directory = join(
      this.#options.storageDirectory,
      "private-wordpress-org-update-evidence-v1",
    );
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const path = join(directory, digest.slice(7));
    try {
      await writeFile(path, bytes, { flag: "wx", mode: 0o600 });
    } catch (error) {
      if (!hasErrorCode(error, "EEXIST")) throw error;
      const existing = await readFile(path);
      if (!existing.equals(bytes)) {
        throw new Error("Update Frontier evidence digest conflict");
      }
    }
    return {
      id: `wporg-update-evidence:${digest.slice(7, 31)}`,
      digest,
      byteLength: bytes.byteLength,
    };
  }

  async #read(path: string): Promise<WordPressOrgUpdateFrontier | undefined> {
    try {
      return decodeFrontier(JSON.parse(await readFile(path, "utf8")));
    } catch (error) {
      if (hasErrorCode(error, "ENOENT")) return undefined;
      throw error;
    }
  }

  async #createFrontier(
    path: string,
    frontier: WordPressOrgUpdateFrontier,
  ): Promise<void> {
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    try {
      await writeFile(path, canonicalJson(frontier), {
        flag: "wx",
        mode: 0o600,
      });
    } catch (error) {
      if (!hasErrorCode(error, "EEXIST")) throw error;
      const raced = await this.#read(path);
      if (
        raced === undefined ||
        raced.inputDigest !== frontier.inputDigest ||
        raced.digest !== frontier.digest
      ) {
        throw new Error("Update Frontier revision input conflict");
      }
    }
  }
}

export function defineWordPressOrgUpdateFrontierPolicy(input: {
  readonly id: string;
  readonly minimumActiveInstallations: number;
  readonly maximumRevisions: number;
  readonly maximumLogBytes: number;
  readonly maximumDiffBytes: number;
}): WordPressOrgUpdateFrontierPolicy {
  const body = {
    kind: "wordpress-org-update-frontier-policy" as const,
    schemaVersion: 1 as const,
    ...input,
  };
  return wordPressOrgUpdateFrontierPolicySchema.parse({
    ...body,
    digest: canonicalDigest(body),
  });
}

export function openWordPressOrgUpdateFrontiers(
  options: OpenWordPressOrgUpdateFrontiersOptions,
): WordPressOrgUpdateFrontiers {
  return new FileWordPressOrgUpdateFrontiers(options);
}
