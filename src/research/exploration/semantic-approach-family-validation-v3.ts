import { z } from "zod";

import {
  approachFamilyRegistryV3Schema,
  approachFamilyV3Schema,
  projectApproachFamilyRegistryV3,
} from "./semantic-approach-family-registry-v3.js";

const digestSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);

const validationIntentFamilyBindingSchema = z.strictObject({
  validationId: digestSchema,
  approachFamilyIds: z.array(digestSchema).min(1).max(64),
});

const validationResolutionSchema = z.strictObject({
  validationId: digestSchema,
  recordDigest: digestSchema,
  disposition: z.enum([
    "ready-for-runtime",
    "ready-for-human",
    "needs-research",
    "disproven",
    "rejected",
    "validation-pending",
  ]),
  approachFamilyIds: z.array(digestSchema).min(1).max(64),
});

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function attachApproachFamilyValidationIntentsV3(input: {
  readonly registry: unknown;
  readonly intents: readonly {
    readonly validationId: string;
    readonly approachFamilyIds: readonly string[];
  }[];
}): ReturnType<typeof projectApproachFamilyRegistryV3> {
  const registry = approachFamilyRegistryV3Schema.parse(input.registry);
  const intents = input.intents.map((intent) =>
    validationIntentFamilyBindingSchema.parse({
      validationId: intent.validationId,
      approachFamilyIds: intent.approachFamilyIds,
    }),
  );
  if (
    new Set(intents.map((intent) => intent.validationId)).size !==
      intents.length ||
    intents.some(
      (intent) =>
        new Set(intent.approachFamilyIds).size !==
        intent.approachFamilyIds.length,
    )
  ) {
    throw new Error("Approach Family Validation intent is duplicated");
  }

  const validationsByFamily = new Map<string, Set<string>>();
  for (const intent of intents) {
    for (const familyId of intent.approachFamilyIds) {
      if (!registry.families.some((family) => family.id === familyId)) {
        throw new Error("Validation intent references a foreign Family");
      }
      const validationIds = validationsByFamily.get(familyId) ?? new Set();
      validationIds.add(intent.validationId);
      validationsByFamily.set(familyId, validationIds);
    }
  }

  const families = registry.families.map((family) => {
    const validationIds = [...(validationsByFamily.get(family.id) ?? [])]
      .filter(
        (validationId) => !family.pendingValidations.includes(validationId),
      )
      .sort(compareText);
    if (validationIds.length === 0) return family;
    const updated = approachFamilyV3Schema.parse({
      ...family,
      pendingValidations: [...family.pendingValidations, ...validationIds].sort(
        compareText,
      ),
    });
    return updated;
  });

  return projectApproachFamilyRegistryV3({
    campaignId: registry.campaignId,
    runId: registry.runId,
    target: registry.target,
    manifest: registry.manifest,
    decisions: registry.decisions,
    depthDecisions: registry.depthDecisions,
    families,
  });
}

export function resolveApproachFamilyValidationV3(input: {
  readonly registry: unknown;
  readonly resolution: {
    readonly validationId: string;
    readonly recordDigest: string;
    readonly disposition:
      | "ready-for-runtime"
      | "ready-for-human"
      | "needs-research"
      | "disproven"
      | "rejected"
      | "validation-pending";
    readonly approachFamilyIds: readonly string[];
  };
}): ReturnType<typeof projectApproachFamilyRegistryV3> {
  const registry = approachFamilyRegistryV3Schema.parse(input.registry);
  const resolution = validationResolutionSchema.parse(input.resolution);
  if (
    new Set(resolution.approachFamilyIds).size !==
    resolution.approachFamilyIds.length
  ) {
    throw new Error("Approach Family Validation resolution is duplicated");
  }
  const resolvedFamilies = new Set(resolution.approachFamilyIds);
  const families = registry.families.map((family) => {
    if (!resolvedFamilies.has(family.id)) return family;
    resolvedFamilies.delete(family.id);
    if (
      !family.pendingValidations.includes(resolution.validationId) ||
      family.validationOutcomes.some(
        (outcome) => outcome.validationId === resolution.validationId,
      )
    ) {
      throw new Error("Approach Family has no matching pending Validation");
    }
    return approachFamilyV3Schema.parse({
      ...family,
      pendingValidations:
        resolution.disposition === "validation-pending"
          ? family.pendingValidations
          : family.pendingValidations.filter(
              (validationId) => validationId !== resolution.validationId,
            ),
      validationOutcomes: [
        ...family.validationOutcomes,
        {
          validationId: resolution.validationId,
          recordDigest: resolution.recordDigest,
          disposition: resolution.disposition,
        },
      ].sort((left, right) =>
        compareText(left.validationId, right.validationId),
      ),
    });
  });
  if (resolvedFamilies.size > 0) {
    throw new Error("Validation resolution references a foreign Family");
  }
  return projectApproachFamilyRegistryV3({
    campaignId: registry.campaignId,
    runId: registry.runId,
    target: registry.target,
    manifest: registry.manifest,
    decisions: registry.decisions,
    depthDecisions: registry.depthDecisions,
    families,
  });
}
