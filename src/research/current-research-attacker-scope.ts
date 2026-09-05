import { z } from "zod";

export const currentResearchAttackerPremiseSchema = z.enum([
  "unauthenticated",
  "subscriber",
  "customer",
]);

export type CurrentResearchAttackerPremise = z.infer<
  typeof currentResearchAttackerPremiseSchema
>;

export const currentResearchAttackerScopePrompt =
  "Current research attacker scope permits only unauthenticated attackers and subscriber-equivalent low-privilege users. Treat customer as a known subscriber-equivalent role, and treat a custom role as subscriber-equivalent only when its effective capabilities do not exceed the built-in Subscriber baseline. Do not discover, retain, deepen, validate, or hand off a route whose minimum starting attacker is Contributor or higher or unresolved. A route may escalate privileges after starting within the permitted scope.";

export function isWithinCurrentResearchAttackerScope(
  value: unknown,
): value is CurrentResearchAttackerPremise {
  return currentResearchAttackerPremiseSchema.safeParse(value).success;
}
