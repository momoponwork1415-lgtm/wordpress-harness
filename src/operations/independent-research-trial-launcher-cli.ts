#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { probeDeepSeekAccountReadiness } from "./deepseek-account-readiness.js";
import {
  defineIndependentResearchTrialApproval,
  independentResearchTrialApprovalSchema,
} from "./independent-research-trial-launcher.js";
import {
  dispatchIndependentResearchTrials,
  inspectIndependentResearchTrialClaims,
} from "./independent-research-trial-launcher-runtime.js";

const usage =
  "Usage: wordpress-harness-trials <seal-approval --definition <definition.json>|dispatch --approval <approval.json> --receipts <directory> --working-directory <directory> [--dry-run]|inspect --receipts <directory>>";

export interface IndependentResearchTrialLauncherCliIo {
  stdout(text: string): void;
  stderr(text: string): void;
}

const processIo: IndependentResearchTrialLauncherCliIo = {
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

export async function runIndependentResearchTrialLauncherCli(
  args: readonly string[],
  io: IndependentResearchTrialLauncherCliIo = processIo,
): Promise<number> {
  try {
    const command = args[0];
    if (command === "seal-approval") {
      const definition: unknown = JSON.parse(
        await readFile(resolve(readOption(args, "--definition")), "utf8"),
      );
      const approval = defineIndependentResearchTrialApproval(definition);
      io.stdout(`${JSON.stringify(approval)}\n`);
      return 0;
    }
    if (command === "inspect") {
      const view = await inspectIndependentResearchTrialClaims(
        resolve(readOption(args, "--receipts")),
      );
      io.stdout(`${JSON.stringify(view)}\n`);
      return 0;
    }
    if (command !== "dispatch") throw new Error(usage);
    const approvalValue: unknown = JSON.parse(
      await readFile(resolve(readOption(args, "--approval")), "utf8"),
    );
    const approval =
      independentResearchTrialApprovalSchema.parse(approvalValue);
    const first = approval.trials[0];
    if (first === undefined) throw new Error("Approval has no Trials");
    const accountReadiness = await probeDeepSeekAccountReadiness({
      credentialFilePath: join(
        first.providerConfigDirectory,
        "deepseek-api-key",
      ),
    });
    const result = await dispatchIndependentResearchTrials({
      approval,
      accountReadiness,
      receiptRoot: resolve(readOption(args, "--receipts")),
      workingDirectory: resolve(readOption(args, "--working-directory")),
      dryRun: args.includes("--dry-run"),
    });
    io.stdout(`${JSON.stringify({ accountReadiness, ...result })}\n`);
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
  process.exitCode = await runIndependentResearchTrialLauncherCli(
    process.argv.slice(2),
  );
}
