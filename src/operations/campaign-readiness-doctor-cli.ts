#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
  campaignReadinessInputSchema,
  formatCampaignReadinessReport,
  openCampaignReadinessDoctor,
  type CampaignReadinessDoctor,
} from "./campaign-readiness-doctor.js";

const usage =
  "Usage: wordpress-harness-doctor inspect --input <campaign-readiness-input.json> [--human]";

export interface CampaignReadinessDoctorCliIo {
  stdout(text: string): void;
  stderr(text: string): void;
}

const processIo: CampaignReadinessDoctorCliIo = {
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

export async function runCampaignReadinessDoctorCli(
  args: readonly string[],
  io: CampaignReadinessDoctorCliIo = processIo,
  doctor: CampaignReadinessDoctor = openCampaignReadinessDoctor(),
): Promise<number> {
  try {
    if (args[0] !== "inspect") throw new Error(usage);
    const value: unknown = JSON.parse(
      await readFile(resolve(readOption(args, "--input")), "utf8"),
    );
    const report = await doctor.inspect(
      campaignReadinessInputSchema.parse(value),
    );
    io.stdout(
      args.includes("--human")
        ? formatCampaignReadinessReport(report)
        : `${JSON.stringify(report)}\n`,
    );
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
  process.exitCode = await runCampaignReadinessDoctorCli(process.argv.slice(2));
}
