import type {
  CampaignStatus,
  NativeRunReceipt,
  ResearchCampaignView,
} from "../research/agent-led/contracts.js";

export type UnknownOr<T> = T | "unknown";

export interface CampaignExplorationVolumeRow {
  readonly campaignId: string;
  readonly status: CampaignStatus;
  readonly pluginSlug: string;
  readonly version: string;
  readonly sourceTree: { readonly entries: number; readonly bytes: number };
  readonly phpSource: UnknownOr<{
    readonly files: number;
    readonly bytes: number;
  }>;
  readonly runtime: {
    readonly transportKind: string;
    readonly model: string;
    readonly effort: string;
  };
  readonly promptSetId: string;
  readonly nativeRuns: {
    readonly attempted: number;
    readonly completed: number;
    readonly failed: number;
    readonly orphaned: number;
  };
  readonly wallTimeMs: number;
  readonly inputTokens: UnknownOr<number>;
  readonly outputTokens: UnknownOr<number>;
  readonly estimatedCostUsd: UnknownOr<number>;
  readonly toolCalls: UnknownOr<number>;
  readonly subagentsMax: UnknownOr<number>;
  readonly candidates: number;
  readonly parkedProgrammeLeads: number;
  readonly finalDecision: UnknownOr<"continue" | "stop">;
}

export interface CampaignSourceManifest {
  readonly digest: string;
  readonly entries: readonly { readonly path: string; readonly size: number }[];
}

export interface CampaignExplorationVolumeOptions {
  readonly sourceManifests?: readonly CampaignSourceManifest[];
}

export interface CampaignExplorationVolumeReport {
  readonly kind: "campaign-exploration-volume";
  readonly schemaVersion: 1;
  readonly rows: readonly CampaignExplorationVolumeRow[];
}

function sumOrUnknown(
  values: readonly (number | undefined)[],
): UnknownOr<number> {
  let total = 0;
  for (const value of values) {
    if (value === undefined) return "unknown";
    total += value;
  }
  return total;
}

function maxOrUnknown(
  values: readonly (number | undefined)[],
): UnknownOr<number> {
  let max: number | undefined;
  for (const value of values) {
    if (value === undefined) return "unknown";
    max = max === undefined ? value : Math.max(max, value);
  }
  return max ?? "unknown";
}

function completedReceipts(
  receipts: readonly NativeRunReceipt[],
): readonly Extract<NativeRunReceipt, { terminal: "completed" }>[] {
  return receipts.flatMap((receipt) =>
    receipt.terminal === "completed" ? [receipt] : [],
  );
}

function phpSourceFor(
  manifest: CampaignSourceManifest | undefined,
): CampaignExplorationVolumeRow["phpSource"] {
  if (manifest === undefined) return "unknown";
  let files = 0;
  let bytes = 0;
  for (const entry of manifest.entries) {
    if (!entry.path.toLowerCase().endsWith(".php")) continue;
    files += 1;
    bytes += entry.size;
  }
  return { files, bytes };
}

function rowFor(
  view: ResearchCampaignView,
  manifests: ReadonlyMap<string, CampaignSourceManifest>,
): CampaignExplorationVolumeRow {
  const completed = completedReceipts(view.nativeRuns);
  const lastCompleted = completed.at(-1);
  const candidateIds = new Set(
    completed.flatMap((receipt) =>
      receipt.report.candidates.map((candidate) => candidate.candidateId),
    ),
  );
  const { transportKind, model, effort } = view.input.agentRuntimeProfile;
  return {
    campaignId: view.campaignId,
    status: view.status,
    pluginSlug: view.input.targetSnapshot.pluginSlug,
    version: view.input.targetSnapshot.version,
    sourceTree: {
      entries: view.input.targetSnapshot.sourceTree.entries,
      bytes: view.input.targetSnapshot.sourceTree.bytes,
    },
    phpSource: phpSourceFor(
      manifests.get(view.input.targetSnapshot.sourceTree.digest),
    ),
    runtime: { transportKind, model, effort },
    promptSetId: view.input.promptSet.id,
    nativeRuns: {
      attempted: view.nativeRunAttempts.length,
      completed: completed.length,
      failed: view.nativeRuns.length - completed.length,
      orphaned: view.nativeRunAttempts.length - view.nativeRuns.length,
    },
    wallTimeMs: view.nativeRuns.reduce(
      (total, receipt) => total + receipt.usage.wallTimeMs,
      0,
    ),
    inputTokens: sumOrUnknown(completed.map((r) => r.usage.inputTokens)),
    outputTokens: sumOrUnknown(completed.map((r) => r.usage.outputTokens)),
    estimatedCostUsd: sumOrUnknown(
      completed.map((r) => r.usage.estimatedCostUsd),
    ),
    toolCalls: sumOrUnknown(
      completed.map((r) => r.activity.tools?.length ?? undefined),
    ),
    subagentsMax: maxOrUnknown(
      completed.map((r) => r.activity.subagents ?? undefined),
    ),
    candidates: candidateIds.size,
    parkedProgrammeLeads: view.parkedProgrammeLeads.length,
    finalDecision: lastCompleted?.report.decision.kind ?? "unknown",
  };
}

export function deriveCampaignExplorationVolume(
  views: readonly ResearchCampaignView[],
  options: CampaignExplorationVolumeOptions = {},
): CampaignExplorationVolumeReport {
  const manifests = new Map(
    (options.sourceManifests ?? []).map((manifest) => [
      manifest.digest,
      manifest,
    ]),
  );
  return {
    kind: "campaign-exploration-volume",
    schemaVersion: 1,
    rows: views.map((view) => rowFor(view, manifests)),
  };
}
