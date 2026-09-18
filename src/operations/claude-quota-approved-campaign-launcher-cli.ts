#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
  approvedCampaignLaunchManifestSchema,
  normalizeClaudeStatusLineRateLimits,
} from "./claude-quota-approved-campaign-launcher.js";
import {
  dispatchApprovedCampaignLaunches,
  readRateLimitObservation,
  writeRateLimitObservation,
} from "./claude-quota-approved-campaign-launcher-runtime.js";

const usage =
  "Usage: claude-quota-approved-campaign-launcher <record-status-line|dispatch> ...";

export interface LauncherCliIo {
  stdin(): Promise<string>;
  stdout(text: string): void;
  stderr(text: string): void;
}

const processIo: LauncherCliIo = {
  stdin: async () => {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks).toString("utf8");
  },
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
};

function readOption(args: readonly string[], name: string): string {
  const index = args.indexOf(name);
  const value = index === -1 ? undefined : args[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`Missing required option: ${name}`);
  }
  return value;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}

async function readManifest(path: string) {
  const value: unknown = JSON.parse(await readFile(path, "utf8"));
  return approvedCampaignLaunchManifestSchema.parse(value);
}

export async function runClaudeQuotaLauncherCli(
  args: readonly string[],
  io: LauncherCliIo = processIo,
): Promise<number> {
  try {
    const [command] = args;
    if (command !== "record-status-line" && command !== "dispatch") {
      throw new Error(usage);
    }
    const now = new Date().toISOString();
    const observationPath = resolve(readOption(args, "--observation"));
    if (command === "record-status-line") {
      const value: unknown = JSON.parse(await io.stdin());
      const observation = normalizeClaudeStatusLineRateLimits(value, now);
      await writeRateLimitObservation(observationPath, observation);
      io.stdout(`${JSON.stringify(observation)}\n`);
      return 0;
    }

    const manifest = await readManifest(
      resolve(readOption(args, "--manifest")),
    );
    const receiptRoot = resolve(readOption(args, "--receipts"));
    const result = await dispatchApprovedCampaignLaunches({
      manifest,
      observation: await readRateLimitObservation(observationPath),
      receiptRoot,
      workingDirectory: resolve(readOption(args, "--working-directory")),
      now,
      dryRun: args.includes("--dry-run"),
    });
    io.stdout(`${JSON.stringify(result)}\n`);
    return 0;
  } catch (error: unknown) {
    io.stderr(`${errorMessage(error)}\n`);
    return 1;
  }
}

const entryPath = process.argv[1];
if (
  entryPath !== undefined &&
  import.meta.url === pathToFileURL(entryPath).href
) {
  process.exitCode = await runClaudeQuotaLauncherCli(process.argv.slice(2));
}
