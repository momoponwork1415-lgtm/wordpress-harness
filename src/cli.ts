#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

import { decodeNewCampaignInput, openResearch } from "./research/index.js";

export interface CliIo {
  stdout(text: string): void;
  stderr(text: string): void;
}

const processIo: CliIo = {
  stdout: (text) => {
    process.stdout.write(text);
  },
  stderr: (text) => {
    process.stderr.write(text);
  },
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

export async function runCli(
  args: readonly string[],
  io: CliIo = processIo,
): Promise<number> {
  let close: (() => void) | undefined;

  try {
    const [context, command] = args;
    if (context !== "campaign") {
      throw new Error("Usage: wordpress-harness campaign <prepare|inspect>");
    }

    const databasePath = readOption(args, "--database");
    const research = openResearch({ databasePath });
    close = () => research.close();

    if (command === "prepare") {
      const inputPath = readOption(args, "--input");
      const inputText = await readFile(inputPath, "utf8");
      const inputValue: unknown = JSON.parse(inputText);
      const result = await research.runner.prepare(
        decodeNewCampaignInput(inputValue),
      );
      io.stdout(`${JSON.stringify(result)}\n`);
      return 0;
    }

    if (command === "inspect") {
      const campaignId = readOption(args, "--campaign");
      const result = await research.reader.inspect(campaignId, {
        kind: "preparation",
      });
      io.stdout(`${JSON.stringify(result)}\n`);
      return 0;
    }

    throw new Error("Usage: wordpress-harness campaign <prepare|inspect>");
  } catch (error: unknown) {
    io.stderr(`${errorMessage(error)}\n`);
    return 1;
  } finally {
    close?.();
  }
}

const entryPath = process.argv[1];
if (
  entryPath !== undefined &&
  import.meta.url === pathToFileURL(entryPath).href
) {
  process.exitCode = await runCli(process.argv.slice(2));
}
