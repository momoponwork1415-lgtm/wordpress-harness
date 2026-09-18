#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { createDeepSeekCredentialEgressBroker } from "./infrastructure/deepseek-credential-egress-broker.js";

import {
  campaignInputSchema,
  humanCandidateReviewSchema,
  humanResearchContinuationReviewSchema,
  type CampaignInput,
} from "./research/index.js";
import {
  openClaudeCodeNativeAgentRuntime,
  openGlmNativeAgentRuntime,
} from "./research/agent-led/claude-code-native-agent-runtime.js";
import { openCodexNativeAgentRuntime } from "./research/agent-led/codex-native-agent-runtime.js";
import { openDeepSeekHarnessNativeAgentRuntime } from "./research/agent-led/deepseek-harness-native-agent-runtime.js";
import { openGrokNativeAgentRuntime } from "./research/agent-led/grok-native-agent-runtime.js";
import type { NativeAgentRuntime } from "./research/agent-led/contracts.js";
import { openResearchCampaigns } from "./research/agent-led/research-campaigns.js";
import {
  approvedTargetCampaignRequestSchema,
  openApprovedTargetCampaigns,
} from "./target-intelligence/approved-target-campaign/index.js";
import { admitApprovedTargetCampaign } from "./target-intelligence/approved-target-campaign/approved-target-campaigns.js";

const usage =
  "Usage: wordpress-harness campaign <conduct|conduct-approved|review-research|review-candidates|inspect> --database <path> ...";

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

function readOptions(args: readonly string[], name: string): readonly string[] {
  const values: string[] = [];
  for (const [index, argument] of args.entries()) {
    if (argument !== name) continue;
    const value = args[index + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`Missing value for option: ${name}`);
    }
    values.push(value);
  }
  return values;
}

function dependencySources(
  args: readonly string[],
  input: CampaignInput,
): readonly {
  readonly snapshot: NonNullable<CampaignInput["dependencySnapshots"]>[number];
  readonly sourceDirectory: string;
}[] {
  const paths = new Map<string, string>();
  for (const binding of readOptions(args, "--dependency-source")) {
    const separator = binding.indexOf("=");
    if (separator <= 0 || separator === binding.length - 1) {
      throw new Error("Dependency source must use <mount-name>=<directory>");
    }
    const mountName = binding.slice(0, separator);
    if (paths.has(mountName)) {
      throw new Error(`Duplicate Dependency source: ${mountName}`);
    }
    paths.set(mountName, binding.slice(separator + 1));
  }
  const snapshots = input.dependencySnapshots ?? [];
  const expectedMounts = new Set(
    snapshots.map((snapshot) => snapshot.mountName),
  );
  for (const mountName of paths.keys()) {
    if (!expectedMounts.has(mountName)) {
      throw new Error(`Unbound Dependency source: ${mountName}`);
    }
  }
  return snapshots.map((snapshot) => {
    const sourceDirectory = paths.get(snapshot.mountName);
    if (sourceDirectory === undefined) {
      throw new Error(`Missing Dependency source: ${snapshot.mountName}`);
    }
    return { snapshot, sourceDirectory: resolve(sourceDirectory) };
  });
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
): NativeAgentRuntime {
  const options = {
    dockerExecutablePath: resolve(readOption(args, "--docker")),
    image: readOption(args, "--image"),
    sourceDirectory: resolve(readOption(args, "--source")),
    targetSnapshotDigest: input.targetSnapshot.digest,
    sourceTree: input.targetSnapshot.sourceTree,
    dependencySources: dependencySources(args, input),
    providerConfigDirectory: resolve(readOption(args, "--provider-config")),
    scratchRootDirectory: resolve(readOption(args, "--scratch")),
    promptSet: {
      digest: input.promptSet.digest,
      text: researchPrompt,
    },
    permissionProfileDigest: input.permissionProfile.digest,
    maxOutputBytes: 8 * 1024 * 1024,
  };

  if (input.agentRuntimeProfile.transportKind === "grok-build-native/v1") {
    return openGrokNativeAgentRuntime(options);
  }
  if (input.agentRuntimeProfile.transportKind === "claude-code-native/v1") {
    return openClaudeCodeNativeAgentRuntime(options);
  }
  if (input.agentRuntimeProfile.transportKind === "glm-claude-code-native/v1") {
    return openGlmNativeAgentRuntime(options);
  }
  if (input.agentRuntimeProfile.transportKind === "codex-native/v1") {
    return openCodexNativeAgentRuntime(options);
  }
  if (
    input.agentRuntimeProfile.transportKind === "deepseek-harness-native/v1"
  ) {
    return openDeepSeekHarnessNativeAgentRuntime({
      sandbox: options,
      credentialEgressBroker: createDeepSeekCredentialEgressBroker({
        dockerExecutablePath: options.dockerExecutablePath,
        brokerImage: options.image,
        credentialFilePath: join(
          options.providerConfigDirectory,
          "deepseek-api-key",
        ),
        scratchRootDirectory: options.scratchRootDirectory,
        proxyBundleDirectory: fileURLToPath(
          new URL("./infrastructure/", import.meta.url),
        ),
      }),
    });
  }
  throw new Error(
    `Unsupported Agent Runtime: ${input.agentRuntimeProfile.transportKind}`,
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
      (command !== "conduct" &&
        command !== "conduct-approved" &&
        command !== "review-research" &&
        command !== "review-candidates" &&
        command !== "inspect")
    ) {
      throw new Error(usage);
    }
    const databasePath = resolve(readOption(args, "--database"));

    if (command === "review-research" || command === "review-candidates") {
      const reviewValue = JSON.parse(
        await readFile(readOption(args, "--review"), "utf8"),
      ) as unknown;
      const review =
        command === "review-research"
          ? humanResearchContinuationReviewSchema.parse(reviewValue)
          : humanCandidateReviewSchema.parse(reviewValue);
      const inspection = openResearchCampaigns({
        databasePath,
        runtime: unavailableInspectionRuntime(),
      });
      let input: CampaignInput;
      try {
        input = (await inspection.inspect({ campaignId: review.campaignId }))
          .input;
      } finally {
        inspection.close();
      }
      const researchPrompt = await readFile(
        readOption(args, "--research-prompt"),
        "utf8",
      );
      const campaigns = openResearchCampaigns({
        databasePath,
        runtime: openNativeRuntime(args, input, researchPrompt),
      });
      close = () => campaigns.close();
      const outcome = await campaigns.conduct(review);
      io.stdout(`${JSON.stringify(outcome)}\n`);
      return 0;
    }

    if (command === "conduct" || command === "conduct-approved") {
      const inputValue: unknown = JSON.parse(
        await readFile(readOption(args, "--input"), "utf8"),
      );
      const approvedRequest =
        command === "conduct-approved"
          ? approvedTargetCampaignRequestSchema.parse(inputValue)
          : undefined;
      const input =
        approvedRequest === undefined
          ? campaignInputSchema.parse(inputValue)
          : admitApprovedTargetCampaign(approvedRequest);
      const researchPrompt = await readFile(
        readOption(args, "--research-prompt"),
        "utf8",
      );
      const campaigns = openResearchCampaigns({
        databasePath,
        runtime: openNativeRuntime(args, input, researchPrompt),
      });
      close = () => campaigns.close();
      const outcome =
        approvedRequest === undefined
          ? await campaigns.conduct(input)
          : await openApprovedTargetCampaigns({ campaigns }).conduct(
              approvedRequest,
            );
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
