import type { CurrentSemanticModelFamily } from "../campaign-control/current-semantic-campaign-bindings.js";
import type { SourceEvidenceGateway } from "../source-mapping/source-evidence-contracts.js";
import {
  openClaudeModelExecution,
  openGlmModelExecution,
} from "./claude-process.js";
import type { ModelExecution } from "./contracts.js";
import { openGrokModelExecution } from "./grok-process.js";
import type { ModelCapacityPolicy } from "./model-capacity.js";
import type { ModelProcessObserver } from "./model-process-observability.js";

interface CurrentSemanticModelExecutionCommon {
  readonly artifactDirectory: string;
  readonly executablePath: string;
  readonly sourceEvidenceGateway?: SourceEvidenceGateway;
  readonly processObserver?: ModelProcessObserver;
  readonly processHeartbeatIntervalMs?: number;
}

/**
 * Per-family launch input. A union rather than one widened record, so the GLM
 * token file cannot be handed to the Grok lane and the Grok home cannot be
 * handed to Claude: the transport each family is admitted under is fixed by
 * the model profile catalog, and the credential each one reads differs.
 */
export type CurrentSemanticModelExecutionOptions =
  | (CurrentSemanticModelExecutionCommon & {
      readonly family: "claude";
      readonly workingDirectory: string;
      readonly claudeConfigDirectory?: string;
      readonly capacityPolicy: ModelCapacityPolicy | "disabled";
    })
  | (CurrentSemanticModelExecutionCommon & {
      readonly family: "glm";
      readonly workingDirectory: string;
      readonly tokenFilePath: string;
    })
  | (CurrentSemanticModelExecutionCommon & {
      readonly family: "grok";
      readonly grokHomeDirectory: string;
    });

/**
 * The executable version each family is admitted under. Bound here rather than
 * taken from the caller: the version is half of the Transport Eligibility
 * Receipt the plan names, so a launch against a different binary would produce
 * Attempts whose receipt does not describe what actually ran.
 */
const admittedExecutableVersions: Record<CurrentSemanticModelFamily, string> = {
  claude: "2.1.260",
  glm: "2.1.260",
  grok: "1.0.13",
};

export function currentSemanticExecutableVersion(
  family: CurrentSemanticModelFamily,
): string {
  return admittedExecutableVersions[family];
}

export function openCurrentSemanticModelExecution(
  options: CurrentSemanticModelExecutionOptions,
): ModelExecution {
  const common = {
    artifactDirectory: options.artifactDirectory,
    executablePath: options.executablePath,
    executableVersion: admittedExecutableVersions[options.family],
    ...(options.sourceEvidenceGateway === undefined
      ? {}
      : { sourceEvidenceGateway: options.sourceEvidenceGateway }),
    ...(options.processObserver === undefined
      ? {}
      : { processObserver: options.processObserver }),
    ...(options.processHeartbeatIntervalMs === undefined
      ? {}
      : { processHeartbeatIntervalMs: options.processHeartbeatIntervalMs }),
  };

  if (options.family === "claude") {
    return openClaudeModelExecution({
      ...common,
      workingDirectory: options.workingDirectory,
      ...(options.claudeConfigDirectory === undefined
        ? {}
        : { claudeConfigDirectory: options.claudeConfigDirectory }),
      capacityPolicy: options.capacityPolicy,
    });
  }

  if (options.family === "glm") {
    return openGlmModelExecution({
      ...common,
      workingDirectory: options.workingDirectory,
      tokenFilePath: options.tokenFilePath,
    });
  }

  return openGrokModelExecution({
    ...common,
    grokHomeDirectory: options.grokHomeDirectory,
  });
}
