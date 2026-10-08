#!/usr/bin/env node

import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import type {
  NativeAgentRuntime,
  ResearchCampaignView,
} from "../research/agent-led/contracts.js";
import { openResearchCampaigns } from "../research/agent-led/research-campaigns.js";
import { targetIntakePacketSchema } from "../target-intelligence/acquisition/index.js";
import {
  deriveCampaignExplorationVolume,
  type CampaignExplorationVolumeReport,
  type CampaignExplorationVolumeRow,
  type CampaignSourceManifest,
} from "./campaign-exploration-volume.js";

const usage =
  "Usage: wordpress-harness-exploration-volume --database-list <file> [--intake-list <file>] [--format csv|json]";

export interface CampaignExplorationVolumeCliIo {
  stdout(text: string): void;
  stderr(text: string): void;
}

const processIo: CampaignExplorationVolumeCliIo = {
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
};

function readOption(args: readonly string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index === -1) return undefined;
  const value = args[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`Missing value for option: ${name}`);
  }
  return value;
}

async function readPathList(listPath: string): Promise<readonly string[]> {
  const text = await readFile(resolve(listPath), "utf8");
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"))
    .map((line) => resolve(line));
}

function inspectionOnlyRuntime(): NativeAgentRuntime {
  return {
    execute: () =>
      Promise.reject(
        new Error("Exploration volume summary cannot execute a Native Run"),
      ),
  };
}

async function readCampaignViews(databasePaths: readonly string[]): Promise<{
  readonly views: readonly ResearchCampaignView[];
  readonly missing: number;
  readonly unreadable: number;
}> {
  const views: ResearchCampaignView[] = [];
  let missing = 0;
  let unreadable = 0;
  for (const databasePath of databasePaths) {
    const exists = await stat(databasePath).then(
      (info) => info.isFile(),
      () => false,
    );
    if (!exists) {
      missing += 1;
      continue;
    }
    let campaigns: ReturnType<typeof openResearchCampaigns> | undefined;
    try {
      campaigns = openResearchCampaigns({
        databasePath,
        runtime: inspectionOnlyRuntime(),
      });
      for (const outcome of await campaigns.listCampaigns()) {
        views.push(await campaigns.inspect({ campaignId: outcome.campaignId }));
      }
    } catch {
      unreadable += 1;
    } finally {
      campaigns?.close();
    }
  }
  return { views, missing, unreadable };
}

async function readSourceManifests(packetPaths: readonly string[]): Promise<{
  readonly manifests: readonly CampaignSourceManifest[];
  readonly skipped: number;
}> {
  const manifests: CampaignSourceManifest[] = [];
  let skipped = 0;
  for (const packetPath of packetPaths) {
    let value: unknown;
    try {
      value = JSON.parse(await readFile(packetPath, "utf8"));
    } catch {
      skipped += 1;
      continue;
    }
    const parsed = targetIntakePacketSchema.safeParse(value);
    if (!parsed.success) {
      skipped += 1;
      continue;
    }
    manifests.push({
      digest: parsed.data.sourceTree.digest,
      entries: parsed.data.sourceTree.manifest.entries,
    });
  }
  return { manifests, skipped };
}

const csvColumns: readonly {
  readonly header: string;
  readonly value: (row: CampaignExplorationVolumeRow) => string | number;
}[] = [
  { header: "campaignId", value: (row) => row.campaignId },
  { header: "status", value: (row) => row.status },
  { header: "pluginSlug", value: (row) => row.pluginSlug },
  { header: "version", value: (row) => row.version },
  { header: "sourceEntries", value: (row) => row.sourceTree.entries },
  { header: "sourceBytes", value: (row) => row.sourceTree.bytes },
  {
    header: "phpFiles",
    value: (row) =>
      row.phpSource === "unknown" ? "unknown" : row.phpSource.files,
  },
  {
    header: "phpBytes",
    value: (row) =>
      row.phpSource === "unknown" ? "unknown" : row.phpSource.bytes,
  },
  { header: "transportKind", value: (row) => row.runtime.transportKind },
  { header: "model", value: (row) => row.runtime.model },
  { header: "effort", value: (row) => row.runtime.effort },
  { header: "promptSetId", value: (row) => row.promptSetId },
  { header: "runsAttempted", value: (row) => row.nativeRuns.attempted },
  { header: "runsCompleted", value: (row) => row.nativeRuns.completed },
  { header: "runsFailed", value: (row) => row.nativeRuns.failed },
  { header: "runsOrphaned", value: (row) => row.nativeRuns.orphaned },
  { header: "wallTimeMs", value: (row) => row.wallTimeMs },
  { header: "inputTokens", value: (row) => row.inputTokens },
  { header: "outputTokens", value: (row) => row.outputTokens },
  { header: "estimatedCostUsd", value: (row) => row.estimatedCostUsd },
  { header: "toolCalls", value: (row) => row.toolCalls },
  { header: "subagentsMax", value: (row) => row.subagentsMax },
  { header: "candidates", value: (row) => row.candidates },
  { header: "parkedProgrammeLeads", value: (row) => row.parkedProgrammeLeads },
  { header: "finalDecision", value: (row) => row.finalDecision },
];

function csvCell(value: string | number): string {
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function renderCampaignExplorationVolumeCsv(
  report: CampaignExplorationVolumeReport,
): string {
  const lines = [csvColumns.map((column) => column.header).join(",")];
  for (const row of report.rows) {
    lines.push(
      csvColumns.map((column) => csvCell(column.value(row))).join(","),
    );
  }
  return `${lines.join("\n")}\n`;
}

export async function runCampaignExplorationVolumeCli(
  args: readonly string[],
  io: CampaignExplorationVolumeCliIo = processIo,
): Promise<number> {
  try {
    const databaseListPath = readOption(args, "--database-list");
    if (databaseListPath === undefined) throw new Error(usage);
    const format = readOption(args, "--format") ?? "json";
    if (format !== "csv" && format !== "json") throw new Error(usage);
    const intakeListPath = readOption(args, "--intake-list");

    const databasePaths = await readPathList(databaseListPath);
    const { views, missing, unreadable } =
      await readCampaignViews(databasePaths);
    const { manifests, skipped } =
      intakeListPath === undefined
        ? { manifests: [], skipped: 0 }
        : await readSourceManifests(await readPathList(intakeListPath));
    const report = deriveCampaignExplorationVolume(views, {
      sourceManifests: manifests,
    });

    io.stdout(
      format === "csv"
        ? renderCampaignExplorationVolumeCsv(report)
        : `${JSON.stringify(report)}\n`,
    );
    io.stderr(
      `campaign databases: ${databasePaths.length}, campaigns: ${views.length}, intake packets: ${manifests.length}, skipped intake files: ${skipped}, missing databases: ${missing}, unreadable databases: ${unreadable}\n`,
    );
    return 0;
  } catch (error: unknown) {
    io.stderr(`${error instanceof Error ? error.message : "Unknown error"}\n`);
    return 1;
  }
}

const entryPath = process.argv[1];
if (
  entryPath !== undefined &&
  import.meta.url === pathToFileURL(entryPath).href
) {
  process.exitCode = await runCampaignExplorationVolumeCli(
    process.argv.slice(2),
  );
}
