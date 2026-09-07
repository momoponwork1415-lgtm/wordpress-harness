#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
  campaignInputSchema,
  openClaudeCodeNativeAgentRuntime,
  openGrokNativeAgentRuntime,
  openResearchCampaigns,
  type CampaignInput,
  type NativeAgentRuntime,
} from "./research/index.js";

const usage =
  "Usage: wordpress-harness campaign <conduct|inspect> --database <path> ...";

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

function unavailableInspectionRuntime(): NativeAgentRuntime {
  return {
    execute: () =>
      Promise.reject(new Error("Inspection cannot execute a Native Run")),
  };
}

function openNativeRuntime(
  args: readonly string[],
  input: CampaignInput,
  researchPrompt: string,
  validationPrompt: string,
): NativeAgentRuntime {
  const options = {
    dockerExecutablePath: resolve(readOption(args, "--docker")),
    image: readOption(args, "--image"),
    sourceDirectory: resolve(readOption(args, "--source")),
    targetSnapshotDigest: input.targetSnapshot.digest,
    providerConfigDirectory: resolve(readOption(args, "--provider-config")),
    scratchRootDirectory: resolve(readOption(args, "--scratch")),
    promptSet: {
      digest: input.promptSet.digest,
      text: researchPrompt,
    },
    validationPromptSet: {
      digest: input.validationPromptSet.digest,
      text: validationPrompt,
    },
    permissionProfileDigest: input.permissionProfile.digest,
    maxOutputBytes: 8 * 1024 * 1024,
  };

  if (input.agentRuntimeProfile.kind === "grok-build-native/v1") {
    return openGrokNativeAgentRuntime(options);
  }
  if (input.agentRuntimeProfile.kind === "claude-code-native/v1") {
    return openClaudeCodeNativeAgentRuntime(options);
  }
  throw new Error(
    `Unsupported Agent Runtime: ${input.agentRuntimeProfile.kind}`,
  );
}

export async function runCli(
  args: readonly string[],
  io: CliIo = processIo,
): Promise<number> {
  let close: (() => void) | undefined;
  try {
    const [context, command] = args;
    if (
      context !== "campaign" ||
      (command !== "conduct" && command !== "inspect")
    ) {
      throw new Error(usage);
    }
    const databasePath = resolve(readOption(args, "--database"));

    if (command === "conduct") {
      const inputValue: unknown = JSON.parse(
        await readFile(readOption(args, "--input"), "utf8"),
      );
      const input = campaignInputSchema.parse(inputValue);
      const [researchPrompt, validationPrompt] = await Promise.all([
        readFile(readOption(args, "--research-prompt"), "utf8"),
        readFile(readOption(args, "--validation-prompt"), "utf8"),
      ]);
      const campaigns = openResearchCampaigns({
        databasePath,
        runtime: openNativeRuntime(
          args,
          input,
          researchPrompt,
          validationPrompt,
        ),
      });
      close = () => campaigns.close();
      const outcome = await campaigns.conduct(input);
      io.stdout(`${JSON.stringify(outcome)}\n`);
      return 0;
    }

    const campaigns = openResearchCampaigns({
      databasePath,
      runtime: unavailableInspectionRuntime(),
    });
    close = () => campaigns.close();
    const view = await campaigns.inspect({
      campaignId: readOption(args, "--campaign"),
    });
    io.stdout(`${JSON.stringify(view)}\n`);
    return 0;
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
