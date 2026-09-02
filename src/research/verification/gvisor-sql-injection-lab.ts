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
  experimentObservationRefSchema,
  experimentObservationSchema,
  experimentPlanSchema,
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

export interface OpenGvisorSqlInjectionLabControlOptions {
  readonly artifactStore: JsonArtifactStore;
  readonly processRunner: LabProcessRunner;
  readonly definitionFile?: string;
}

const sqlInjectionLabDefinitionSchema = z.strictObject({
  kind: z.literal("sql-injection-lab-definition"),
  schemaVersion: z.literal(1),
  bindings: experimentPlanSchema.shape.bindings,
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

const sqlInjectionDatabaseResultSchema = z.strictObject({
  kind: z.literal("sql-injection-database-result"),
  schemaVersion: z.literal(1),
  normalFunction: z.enum(["preserved", "broken", "unknown"]),
  attackerRequestAccepted: z.boolean(),
  databaseReadbackCanaryObserved: z.boolean(),
});

type SqlInjectionLabDefinition = z.infer<
  typeof sqlInjectionLabDefinitionSchema
>;

class GvisorSqlInjectionLabControl implements LabControl {
  readonly #options: OpenGvisorSqlInjectionLabControlOptions;

  constructor(options: OpenGvisorSqlInjectionLabControlOptions) {
    this.#options = options;
  }

  async #loadDefinition(
    plan: ExperimentPlan,
  ): Promise<{ value: SqlInjectionLabDefinition; path: string }> {
    if (plan.mechanism.kind !== "sql-injection-database") {
      throw new LabControlBlockedError("unsupported-experiment");
    }
    const path = this.#options.definitionFile;
    if (path === undefined) {
      throw new LabControlBlockedError("unsupported-experiment");
    }
    const value = sqlInjectionLabDefinitionSchema.parse(
      JSON.parse(await readFile(path, "utf8")),
    );
    if (canonicalJson(value.bindings) !== canonicalJson(plan.bindings)) {
      throw new Error("SQL Injection Lab definition binding mismatch");
    }
    const runtimeProfileDigest = sha256Digest({
      kind: "gvisor-wordpress-runtime-profile",
      schemaVersion: 1,
      runtime: "runsc-systrap",
      images: value.images,
    });
    if (runtimeProfileDigest !== plan.bindings.runtimeProfileDigest) {
      throw new Error("SQL Injection Lab runtime profile binding mismatch");
    }
    const setupPlanDigest = sha256Digest({
      kind: "sql-injection-setup-plan",
      schemaVersion: 1,
      operations: [
        "install-wordpress",
        "activate-target",
        "activate-reviewed-fixture",
      ],
    });
    if (setupPlanDigest !== plan.bindings.setupPlanDigest) {
      throw new Error("SQL Injection Lab setup plan binding mismatch");
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
      throw new Error("SQL Injection Lab Target source binding mismatch");
    }
    const configurationDigest = sha256Digest({
      kind: "sql-injection-lab-configuration",
      schemaVersion: 1,
      targetPluginSlug: value.target.pluginSlug,
      targetManifestDigest: sha256Digest(targetManifest),
      setupFixturePluginSlug: value.fixture.pluginSlug,
      setupFixtureManifestDigest,
      workerDigest: rawLabFileDigest(await readFile(value.worker.workerFile)),
      workerInputDigest: rawLabFileDigest(
        await readFile(value.worker.inputFile),
      ),
    });
    if (configurationDigest !== plan.bindings.configurationDigest) {
      throw new Error("SQL Injection Lab configuration binding mismatch");
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
      throw new Error("SQL Injection Lab baseline binding mismatch");
    }
    return { value, path };
  }

  async execute(value: ExperimentPlan): Promise<ExperimentObservationRef> {
    const plan = experimentPlanSchema.parse(value);
    const definition = await this.#loadDefinition(plan);
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
              containerPath: "/harness/sql-injection-worker.mjs",
            },
            {
              sourcePath: definition.path,
              containerPath: "/harness/experiment.private.json",
            },
            {
              sourcePath: definition.value.worker.inputFile,
              containerPath: "/harness/sql-injection-input.private.json",
            },
          ],
          environment: [
            `HARNESS_ROLE=${plan.role}`,
            `HARNESS_CAUSAL_FACTOR_STATE=${plan.mechanism.causalFactorState}`,
          ],
          command: ["node", "/harness/sql-injection-worker.mjs"],
          timeoutMs: 120_000,
        },
      });
    } catch {
      throw new LabControlBlockedError("experiment-failed");
    }
    const result = sqlInjectionDatabaseResultSchema.parse(
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
        kind: "sql-injection-database",
        schemaVersion: 1,
        attackerRequestAccepted: result.attackerRequestAccepted,
        databaseReadbackCanaryObserved: result.databaseReadbackCanaryObserved,
      },
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

export function openGvisorSqlInjectionLabControl(
  options: OpenGvisorSqlInjectionLabControlOptions,
): LabControl {
  return new GvisorSqlInjectionLabControl(options);
}
