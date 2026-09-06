#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
  decodeNewCampaignInput,
  openResearch,
  prepareCurrentSemanticCampaignPlan,
  projectTargetFileManifest,
  type CurrentSemanticModelFamily,
} from "./research/index.js";
import { openCurrentSemanticModelExecution } from "./research/model-execution/index.js";
import { openFileJsonArtifactStore } from "./research/research-record/index.js";
import { openSourceEvidenceGateway } from "./research/source-mapping/index.js";

const usage =
  "Usage: wordpress-harness campaign <prepare|inspect|run> --database <path> --artifacts <directory> ...";

const runUsage =
  "Usage: wordpress-harness campaign run --database <path> --artifacts <directory> " +
  "--campaign <id> --run <id> --family <claude|glm|grok> --source <directory> " +
  "--executable <path> [--work <directory>] [--claude-config <directory>] " +
  "[--glm-token <path>] [--grok-home <directory>]";

const admittedFamilies: readonly CurrentSemanticModelFamily[] = [
  "claude",
  "glm",
  "grok",
];

function readFamily(args: readonly string[]): CurrentSemanticModelFamily {
  const value = readOption(args, "--family");
  const family = admittedFamilies.find((candidate) => candidate === value);
  if (family === undefined) {
    throw new Error(
      `Unknown model family: ${value}. Admitted: ${admittedFamilies.join(", ")}`,
    );
  }
  return family;
}

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
      throw new Error(usage);
    }

    const databasePath = readOption(args, "--database");
    // Every generation since the retired v1 input needs the content-addressed
    // store: v2 to persist the Target File Manifest, v3 to also read back the
    // Intake Packet and Receipt its input names. Required rather than
    // optional, so a missing directory is refused by name here instead of
    // surfacing from the middle of prepare as artifact-store-unavailable.
    const artifactDirectory = readOption(args, "--artifacts");
    const artifactStore = openFileJsonArtifactStore(artifactDirectory);
    const research = openResearch({ databasePath, artifactStore });
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

    if (command === "run") {
      const campaignId = readOption(args, "--campaign");
      const runId = readOption(args, "--run");
      const family = readFamily(args);
      const sourceDirectory = readOption(args, "--source");
      const executablePath = readOption(args, "--executable");

      // Everything the plan binds is read back from the Campaign Preparation
      // rather than retyped on the command line: retyping a Target identity
      // that the record already fixed is how a run ends up bound to a
      // different snapshot than the one it reads.
      const preparation = await research.reader.inspect(campaignId, {
        kind: "preparation",
      });
      if (preparation.kind !== "preparation") {
        throw new Error(`Campaign is not prepared: ${campaignId}`);
      }
      const input = preparation.input;
      if (!("targetIntake" in input) || input.schemaVersion !== 3) {
        throw new Error(
          "Current Semantic Research requires a v3 Target Intake preparation",
        );
      }
      const manifestRef = preparation.targetFileManifest;
      if (manifestRef === undefined) {
        throw new Error("Campaign Preparation has no Target File Manifest");
      }

      const { plan, sourceToolPolicy, sourceToolPolicyRef } =
        await prepareCurrentSemanticCampaignPlan(artifactStore, {
          family,
          campaignId,
          runId,
          preparationDigest: preparation.inputDigest,
          target: input.targetSnapshot,
          manifest: manifestRef,
          metadata: {
            kind: "oracle-free-target-metadata",
            schemaVersion: 1,
            pluginIdentity: input.targetIntake.pluginIdentity,
            mainPluginFile: input.targetIntake.mainPluginFile,
            canonicalInstallDirectory:
              input.targetIntake.canonicalInstallDirectory,
          },
        });

      const sourceEvidenceGateway = openSourceEvidenceGateway({
        sourceDirectory: resolve(sourceDirectory),
        artifactStore,
        manifest: {
          ref: manifestRef,
          value: projectTargetFileManifest(
            input.targetSnapshot,
            input.canonicalFileManifest,
          ),
        },
        policy: { ref: sourceToolPolicyRef, value: sourceToolPolicy },
      });

      const modelExecution = openCurrentSemanticModelExecution({
        artifactDirectory: resolve(artifactDirectory),
        executablePath,
        sourceEvidenceGateway,
        ...(family === "grok"
          ? {
              family,
              grokHomeDirectory: readOption(args, "--grok-home"),
            }
          : family === "glm"
            ? {
                family,
                workingDirectory: resolve(readOption(args, "--work")),
                tokenFilePath: readOption(args, "--glm-token"),
              }
            : {
                family,
                workingDirectory: resolve(readOption(args, "--work")),
                ...(args.includes("--claude-config")
                  ? {
                      claudeConfigDirectory: readOption(
                        args,
                        "--claude-config",
                      ),
                    }
                  : {}),
                // Capacity is an operator concern across concurrent Campaigns,
                // not a property of one run: a single-run invocation opts out
                // by name rather than inheriting an unstated policy.
                capacityPolicy: "disabled" as const,
              }),
      });

      research.close();
      close = undefined;
      const executing = openResearch({
        databasePath,
        artifactStore,
        campaignExecution: { artifactStore, modelExecution },
      });
      close = () => executing.close();
      const record = await executing.runner.run(plan);
      io.stdout(`${JSON.stringify(record)}\n`);
      return 0;
    }

    throw new Error(command === undefined ? usage : `${usage}\n${runUsage}`);
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
