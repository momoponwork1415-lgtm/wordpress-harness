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
