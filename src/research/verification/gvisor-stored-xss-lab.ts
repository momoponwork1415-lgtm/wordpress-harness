import { readFile } from "node:fs/promises";

import { z } from "zod";

import type { JsonArtifactStore } from "../research-record/contracts.js";
import {
  canonicalJson,
  sha256Digest,
} from "../research-record/canonical-json.js";
import { targetFileManifestSchema } from "../source-mapping/contracts.js";
import {
  LabControlBlockedError,
  experimentExecutionRequestSchema,
  experimentObservationRefSchema,
  experimentObservationSchema,
  experimentPlanSchema,
  sourceRouteExperimentProtocolSchema,
  type ExperimentExecutionRequest,
  type ExperimentObservationRef,
  type ExperimentPlan,
  type LabControl,
} from "./contracts.js";
import {
  arePinnedLabImagesAvailable,
  isGvisorRuntimeAvailable,
  labAbsolutePathSchema,
  labDirectoryManifest,
  labPluginSlugSchema,
  pinnedLabImageSchema,
  rawLabFileDigest,
  runFreshGvisorWordPressLab,
  type LabProcessRunner,
} from "./gvisor-wordpress-lab.js";
import { sourceRouteProtocolSupports } from "./source-route-experiment-protocol.js";

export type {
  LabProcessRequest,
  LabProcessResult,
  LabProcessRunner,
} from "./gvisor-wordpress-lab.js";

export interface OpenGvisorStoredXssLabControlOptions {
  readonly artifactStore: JsonArtifactStore;
  readonly processRunner: LabProcessRunner;
  readonly definitionFile?: string;
}

const storedXssLabDefinitionSchema = z.strictObject({
  kind: z.literal("stored-xss-lab-definition"),
  schemaVersion: z.literal(1),
  bindings: experimentPlanSchema.shape.bindings,
  protocol: sourceRouteExperimentProtocolSchema,
  images: z.strictObject({
    database: pinnedLabImageSchema,
    wordpress: pinnedLabImageSchema,
    wordpressCli: pinnedLabImageSchema,
    browser: pinnedLabImageSchema,
  }),
  target: z.strictObject({
    sourceDirectory: labAbsolutePathSchema,
    pluginSlug: labPluginSlugSchema,
    manifestFile: labAbsolutePathSchema,
  }),
  fixture: z.strictObject({
    sourceDirectory: labAbsolutePathSchema,
    pluginSlug: labPluginSlugSchema,
  }),
  browser: z.strictObject({
    workerFile: labAbsolutePathSchema,
    inputFile: labAbsolutePathSchema,
  }),
});

const storedXssBrowserResultSchema = z.strictObject({
  kind: z.literal("stored-xss-browser-result"),
  schemaVersion: z.literal(1),
  normalFunction: z.enum(["preserved", "broken", "unknown"]),
  attackerRequestAccepted: z.boolean(),
  persistentStateObserved: z.boolean(),
  browserCanaryExecuted: z.boolean(),
});

const browserScriptExecutionResultSchema = z.strictObject({
  kind: z.literal("browser-script-execution-result"),
  schemaVersion: z.literal(1),
  normalFunction: z.enum(["preserved", "broken", "unknown"]),
  attackerSequenceExecuted: z.boolean(),
  victimContextEstablished: z.boolean(),
  browserCanaryExecuted: z.boolean(),
});

const browserWorkerResultSchema = z.discriminatedUnion("kind", [
  storedXssBrowserResultSchema,
  browserScriptExecutionResultSchema,
]);

type StoredXssLabDefinition = z.infer<typeof storedXssLabDefinitionSchema>;

class GvisorStoredXssLabControl implements LabControl {
  readonly #options: OpenGvisorStoredXssLabControlOptions;

  constructor(options: OpenGvisorStoredXssLabControlOptions) {
    this.#options = options;
  }

  async #loadDefinition(
    plan: ExperimentPlan,
  ): Promise<{ value: StoredXssLabDefinition; path: string }> {
    if (
      plan.mechanism.kind !== "stored-xss-browser" &&
      plan.mechanism.kind !== "browser-script-execution"
    ) {
      throw new LabControlBlockedError("unsupported-experiment");
    }
    const path = this.#options.definitionFile;
    if (path === undefined) {
      throw new LabControlBlockedError("unsupported-experiment");
    }
    const value = storedXssLabDefinitionSchema.parse(
      JSON.parse(await readFile(path, "utf8")),
    );
    if (canonicalJson(value.bindings) !== canonicalJson(plan.bindings)) {
      throw new Error("Stored XSS Lab definition binding mismatch");
    }
    const runtimeProfileDigest = sha256Digest({
      kind: "gvisor-wordpress-runtime-profile",
      schemaVersion: 1,
      runtime: "runsc-systrap",
      images: value.images,
    });
    if (runtimeProfileDigest !== plan.bindings.runtimeProfileDigest) {
      throw new Error("Stored XSS Lab runtime profile binding mismatch");
    }
    const setupPlanDigest = sha256Digest({
      kind: "stored-xss-setup-plan",
      schemaVersion: 1,
      operations: [
        "install-wordpress",
        "activate-target",
        "activate-reviewed-fixture",
      ],
    });
    if (setupPlanDigest !== plan.bindings.setupPlanDigest) {
      throw new Error("Stored XSS Lab setup plan binding mismatch");
    }
    const fixtureManifestDigest = sha256Digest({
      kind: "trusted-fixture-manifest",
      schemaVersion: 1,
      entries: await labDirectoryManifest(value.fixture.sourceDirectory),
    });
    const targetManifest = targetFileManifestSchema.parse(
      JSON.parse(await readFile(value.target.manifestFile, "utf8")),
    );
    const actualTargetEntries = await labDirectoryManifest(
      value.target.sourceDirectory,
    );
    if (
      targetManifest.targetSnapshot.digest !==
        plan.bindings.targetSnapshotDigest ||
      canonicalJson(targetManifest.entries) !==
        canonicalJson(actualTargetEntries)
    ) {
      throw new Error("Stored XSS Lab Target source binding mismatch");
    }
    const targetManifestDigest = sha256Digest(targetManifest);
    const configurationDigest = sha256Digest({
      kind: "stored-xss-lab-configuration",
      schemaVersion: 1,
      targetPluginSlug: value.target.pluginSlug,
      targetManifestDigest,
      fixturePluginSlug: value.fixture.pluginSlug,
      fixtureManifestDigest,
      browserWorkerDigest: rawLabFileDigest(
        await readFile(value.browser.workerFile),
      ),
      browserInputDigest: rawLabFileDigest(
        await readFile(value.browser.inputFile),
      ),
      protocolDigest: sha256Digest(value.protocol),
    });
    if (configurationDigest !== plan.bindings.configurationDigest) {
      throw new Error("Stored XSS Lab configuration binding mismatch");
    }
    const labBaselineDigest = sha256Digest({
      kind: "lab-baseline-definition",
      schemaVersion: 1,
      targetSnapshotDigest: plan.bindings.targetSnapshotDigest,
      runtimeProfileDigest,
      setupPlanDigest,
      configurationDigest,
    });
    if (labBaselineDigest !== plan.bindings.labBaselineDigest) {
      throw new Error("Stored XSS Lab baseline binding mismatch");
    }
    return { value, path };
  }

  async execute(
    value: ExperimentExecutionRequest,
  ): Promise<ExperimentObservationRef> {
    const request = experimentExecutionRequestSchema.parse(value);
    const plan = request.plan;
    const definition = await this.#loadDefinition(plan);
    if (!sourceRouteProtocolSupports(definition.value.protocol, request)) {
      throw new LabControlBlockedError("unsupported-experiment");
    }
    if (!(await isGvisorRuntimeAvailable(this.#options.processRunner))) {
      throw new LabControlBlockedError("gvisor-unavailable");
    }
    const labImages = {
      database: definition.value.images.database,
      wordpress: definition.value.images.wordpress,
      wordpressCli: definition.value.images.wordpressCli,
      worker: definition.value.images.browser,
    };
    if (
      !(await arePinnedLabImagesAvailable(
        this.#options.processRunner,
        labImages,
      ))
    ) {
      throw new LabControlBlockedError("baseline-unavailable");
    }
    let execution;
    try {
      const lab = await runFreshGvisorWordPressLab({
        processRunner: this.#options.processRunner,
        images: labImages,
        plugins: [definition.value.target, definition.value.fixture],
        worker: {
          mounts: [
            {
              sourcePath: definition.value.browser.workerFile,
              containerPath: "/harness/browser-worker.mjs",
            },
            {
              sourcePath: definition.path,
              containerPath: "/harness/experiment.private.json",
            },
            {
              sourcePath: definition.value.browser.inputFile,
              containerPath: "/harness/browser-input.private.json",
            },
          ],
          environment: [
            `HARNESS_ROLE=${plan.role}`,
            `HARNESS_CAUSAL_FACTOR_STATE=${plan.mechanism.causalFactorState}`,
          ],
          command: ["node", "/harness/browser-worker.mjs"],
          timeoutMs: 120_000,
        },
      });
      execution = {
        labId: lab.labId,
        result: browserWorkerResultSchema.parse(JSON.parse(lab.stdout)),
      };
    } catch {
      throw new LabControlBlockedError("experiment-failed");
    }

    let observationResult;
    if (plan.mechanism.kind === "stored-xss-browser") {
      if (execution.result.kind !== "stored-xss-browser-result") {
        throw new Error("Stored XSS Lab worker result mismatch");
      }
      observationResult = {
        kind: "stored-xss-browser" as const,
        schemaVersion: 1 as const,
        attackerRequestAccepted: execution.result.attackerRequestAccepted,
        persistentStateObserved: execution.result.persistentStateObserved,
        browserCanaryExecuted: execution.result.browserCanaryExecuted,
      };
    } else if (plan.mechanism.kind === "browser-script-execution") {
      if (execution.result.kind !== "browser-script-execution-result") {
        throw new Error("Browser Script Execution Lab worker result mismatch");
      }
      observationResult = {
        kind: "browser-script-execution" as const,
        schemaVersion: 1 as const,
        attackerSequenceExecuted: execution.result.attackerSequenceExecuted,
        victimContextEstablished: execution.result.victimContextEstablished,
        browserCanaryExecuted: execution.result.browserCanaryExecuted,
      };
    } else {
      throw new LabControlBlockedError("unsupported-experiment");
    }
    const observation = experimentObservationSchema.parse({
      kind: "experiment-observation",
      schemaVersion: 1,
      experimentId: plan.experimentId,
      verificationId: plan.verificationId,
      role: plan.role,
      hypothesisDigest: plan.hypothesisDigest,
      bindings: plan.bindings,
      isolation: {
        runtime: "gvisor",
        runtimeDigest: plan.bindings.runtimeProfileDigest,
        siblingGroupId: plan.siblingGroupId,
        labId: execution.labId,
        fresh: true,
        fallbackUsed: false,
      },
      causalFactor: {
        id: plan.mechanism.causalFactor,
        state: plan.mechanism.causalFactorState,
      },
      normalFunction: execution.result.normalFunction,
      result: observationResult,
      artifactRefs: [],
    });
    const observationDigest =
      await this.#options.artifactStore.putJson(observation);
    return experimentObservationRefSchema.parse({
      kind: "experiment-observation",
      schemaVersion: 1,
      experimentId: plan.experimentId,
      digest: observationDigest,
    });
  }
}

export function openGvisorStoredXssLabControl(
  options: OpenGvisorStoredXssLabControlOptions,
): LabControl {
  return new GvisorStoredXssLabControl(options);
}

export const openGvisorBrowserScriptExecutionLabControl =
  openGvisorStoredXssLabControl;
