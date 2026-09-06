import { readFile } from "node:fs/promises";

import { z } from "zod";

import type { JsonArtifactStore } from "../research-record/contracts.js";
import {
  canonicalJson,
  sha256Digest,
} from "../research-record/canonical-json.js";
import {
  openVerifiedArtifacts,
  type VerifiedArtifacts,
} from "../../infrastructure/verified-artifacts.js";
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
  labAbsolutePathSchema,
  labDirectoryManifest,
  labPluginSlugSchema,
  pinnedLabImageSchema,
  preflightGvisorWordPressLab,
  rawLabFileDigest,
  runFreshGvisorWordPressLab,
  type LabProcessRunner,
} from "./gvisor-wordpress-lab.js";
import { sourceRouteProtocolSupports } from "./source-route-experiment-protocol.js";

export interface OpenGvisorAccountTakeoverLabControlOptions {
  readonly artifactStore: JsonArtifactStore;
  readonly processRunner: LabProcessRunner;
  readonly definitionFile?: string;
}

const accountTakeoverLabDefinitionSchema = z.strictObject({
  kind: z.literal("authentication-state-transition-lab-definition"),
  schemaVersion: z.literal(1),
  bindings: experimentPlanSchema.shape.bindings,
  protocol: sourceRouteExperimentProtocolSchema,
  images: z.strictObject({
    database: pinnedLabImageSchema,
    wordpress: pinnedLabImageSchema,
    wordpressCli: pinnedLabImageSchema,
    worker: pinnedLabImageSchema,
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
  worker: z.strictObject({
    workerFile: labAbsolutePathSchema,
    inputFile: labAbsolutePathSchema,
  }),
});

const authenticationStateTransitionResultSchema = z.strictObject({
  kind: z.literal("authentication-state-transition-result"),
  schemaVersion: z.literal(1),
  normalFunction: z.enum(["preserved", "broken", "unknown"]),
  attackerContextInitiallyAuthenticated: z.boolean(),
  attackerSequenceExecuted: z.boolean(),
  targetAccountAuthenticationObserved: z.boolean(),
});

type AccountTakeoverLabDefinition = z.infer<
  typeof accountTakeoverLabDefinitionSchema
>;

class GvisorAccountTakeoverLabControl implements LabControl {
  readonly #options: OpenGvisorAccountTakeoverLabControlOptions;
  readonly #artifacts: VerifiedArtifacts;

  constructor(options: OpenGvisorAccountTakeoverLabControlOptions) {
    this.#options = options;
    this.#artifacts = openVerifiedArtifacts(options.artifactStore);
  }

  async #loadDefinition(plan: ExperimentPlan): Promise<{
    value: AccountTakeoverLabDefinition;
    path: string;
  }> {
    if (plan.mechanism.kind !== "authentication-state-transition") {
      throw new LabControlBlockedError("unsupported-experiment");
    }
    const path = this.#options.definitionFile;
    if (path === undefined) {
      throw new LabControlBlockedError("unsupported-experiment");
    }
    const value = accountTakeoverLabDefinitionSchema.parse(
      JSON.parse(await readFile(path, "utf8")),
    );
    if (canonicalJson(value.bindings) !== canonicalJson(plan.bindings)) {
      throw new Error("Account Takeover Lab definition binding mismatch");
    }
    const runtimeProfileDigest = sha256Digest({
      kind: "gvisor-wordpress-runtime-profile",
      schemaVersion: 1,
      runtime: "runsc-systrap",
      images: value.images,
    });
    if (runtimeProfileDigest !== plan.bindings.runtimeProfileDigest) {
      throw new Error("Account Takeover Lab runtime profile binding mismatch");
    }
    const setupPlanDigest = sha256Digest({
      kind: "authentication-state-transition-setup-plan",
      schemaVersion: 1,
      operations: [
        "install-wordpress",
        "activate-target",
        "activate-reviewed-fixture",
      ],
    });
    if (setupPlanDigest !== plan.bindings.setupPlanDigest) {
      throw new Error("Account Takeover Lab setup plan binding mismatch");
    }
    const targetManifest = targetFileManifestSchema.parse(
      JSON.parse(await readFile(value.target.manifestFile, "utf8")),
    );
    const setupFixtureManifestDigest = sha256Digest({
      kind: "trusted-fixture-manifest",
      schemaVersion: 1,
      entries: await labDirectoryManifest(value.fixture.sourceDirectory),
    });
    if (
      targetManifest.targetSnapshot.digest !==
        plan.bindings.targetSnapshotDigest ||
      canonicalJson(targetManifest.entries) !==
        canonicalJson(await labDirectoryManifest(value.target.sourceDirectory))
    ) {
      throw new Error("Account Takeover Lab Target source binding mismatch");
    }
    const configurationDigest = sha256Digest({
      kind: "authentication-state-transition-lab-configuration",
      schemaVersion: 1,
      targetPluginSlug: value.target.pluginSlug,
      targetManifestDigest: sha256Digest(targetManifest),
      setupFixturePluginSlug: value.fixture.pluginSlug,
      setupFixtureManifestDigest,
      workerDigest: rawLabFileDigest(await readFile(value.worker.workerFile)),
      workerInputDigest: rawLabFileDigest(
        await readFile(value.worker.inputFile),
      ),
      protocolDigest: sha256Digest(value.protocol),
    });
    if (configurationDigest !== plan.bindings.configurationDigest) {
      throw new Error("Account Takeover Lab configuration binding mismatch");
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
      throw new Error("Account Takeover Lab baseline binding mismatch");
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
    const preflight = await preflightGvisorWordPressLab(
      this.#options.processRunner,
      definition.value.images,
    );
    if (preflight !== "ready") {
      throw new LabControlBlockedError(preflight);
    }
    let execution;
    try {
      execution = await runFreshGvisorWordPressLab({
        processRunner: this.#options.processRunner,
        images: definition.value.images,
        plugins: [definition.value.target, definition.value.fixture],
        worker: {
          mounts: [
            {
              sourcePath: definition.value.worker.workerFile,
              containerPath: "/harness/account-takeover-worker.mjs",
            },
            {
              sourcePath: definition.path,
              containerPath: "/harness/experiment.private.json",
            },
            {
              sourcePath: definition.value.worker.inputFile,
              containerPath: "/harness/account-takeover-input.private.json",
            },
          ],
          environment: [
            `HARNESS_ROLE=${plan.role}`,
            `HARNESS_CAUSAL_FACTOR_STATE=${plan.mechanism.causalFactorState}`,
          ],
          command: ["node", "/harness/account-takeover-worker.mjs"],
          timeoutMs: 120_000,
        },
      });
    } catch {
      throw new LabControlBlockedError("experiment-failed");
    }
    const result = authenticationStateTransitionResultSchema.parse(
      JSON.parse(execution.stdout),
    );
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
      normalFunction: result.normalFunction,
      result: {
        kind: "authentication-state-transition",
        schemaVersion: 1,
        attackerContextInitiallyAuthenticated:
          result.attackerContextInitiallyAuthenticated,
        attackerSequenceExecuted: result.attackerSequenceExecuted,
        targetAccountAuthenticationObserved:
          result.targetAccountAuthenticationObserved,
      },
      artifactRefs: [],
    });
    const observationDigest = await this.#artifacts.put(
      "Experiment Observation",
      observation,
    );
    return experimentObservationRefSchema.parse({
      kind: "experiment-observation",
      schemaVersion: 1,
      experimentId: plan.experimentId,
      digest: observationDigest,
    });
  }
}

export function openGvisorAccountTakeoverLabControl(
  options: OpenGvisorAccountTakeoverLabControlOptions,
): LabControl {
  return new GvisorAccountTakeoverLabControl(options);
}
