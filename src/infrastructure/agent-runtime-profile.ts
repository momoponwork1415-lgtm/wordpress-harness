import { z } from "zod";

import { canonicalDigest } from "./canonical-json.js";

const digestSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const identifierSchema = z
  .string()
  .min(1)
  .max(160)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);

const agentRuntimeProfileBodySchema = z.strictObject({
  kind: z.literal("agent-runtime-profile"),
  schemaVersion: z.literal(1),
  id: identifierSchema,
  transportKind: z.string().min(1).max(128),
  executableVersion: z.string().min(1).max(128),
  sandboxImageDigest: digestSchema,
  promptProtocol: z.enum(["stdin", "file"]),
  reportProtocol: z.enum(["schema-constrained-json", "prompted-json"]),
  model: z.string().min(1).max(128),
  effort: z.string().min(1).max(64),
});

export const agentRuntimeProfileSchema = agentRuntimeProfileBodySchema
  .extend({ digest: digestSchema })
  .superRefine((profile, context) => {
    const { digest, ...body } = profile;
    if (digest !== canonicalDigest(body)) {
      context.addIssue({
        code: "custom",
        path: ["digest"],
        message: "Agent Runtime Profile digest must bind its exact body",
      });
    }
  });

export type AgentRuntimeProfile = z.infer<typeof agentRuntimeProfileSchema>;
export type AgentRuntimeProfileDefinition = Omit<
  AgentRuntimeProfile,
  "kind" | "schemaVersion" | "digest"
>;

export function defineAgentRuntimeProfile(
  definition: AgentRuntimeProfileDefinition,
): AgentRuntimeProfile {
  const body = agentRuntimeProfileBodySchema.parse({
    kind: "agent-runtime-profile",
    schemaVersion: 1,
    ...definition,
  });
  return agentRuntimeProfileSchema.parse({
    ...body,
    digest: canonicalDigest(body),
  });
}

export const grokBuildNativeTransport = {
  transportKind: "grok-build-native/v1",
  executableVersion: "1.0.13",
  sandboxImageDigest:
    "sha256:0390e43156357c08aab4ddc3f002ac11763789e90f0fac09f2fa2e73b8105267",
  promptProtocol: "file",
  reportProtocol: "prompted-json",
} as const;

export const claudeCodeNativeTransport = {
  transportKind: "claude-code-native/v1",
  executableVersion: "2.1.220",
  sandboxImageDigest:
    "sha256:b8bb6b8f8865dbabb70f03bb71639792fe1f5c4301a8cd874d212435e5cda355",
  promptProtocol: "stdin",
  reportProtocol: "schema-constrained-json",
} as const;

export const glmClaudeCodeNativeTransport = {
  transportKind: "glm-claude-code-native/v1",
  executableVersion: "2.1.220",
  sandboxImageDigest:
    "sha256:b8bb6b8f8865dbabb70f03bb71639792fe1f5c4301a8cd874d212435e5cda355",
  promptProtocol: "stdin",
  reportProtocol: "prompted-json",
} as const;

export const codexNativeTransport = {
  transportKind: "codex-native/v1",
  executableVersion: "0.146.0",
  sandboxImageDigest:
    "sha256:44342fc7bc7d6e6dd6c7445ebf23d0d6f414fc22c61fab69e158ab0fa7ba5a73",
  promptProtocol: "stdin",
  reportProtocol: "schema-constrained-json",
} as const;

export const deepSeekHarnessNativeTransport = {
  transportKind: "deepseek-harness-native/v1",
  executableVersion: "0.1.6-alpha.2",
  sandboxImageDigest:
    "sha256:e23300f3efa693d9f52c429ff05f443df0577ae3f3e4f9f26842a7dc685ace29",
  promptProtocol: "stdin",
  reportProtocol: "prompted-json",
} as const;

const transportRequirements = [
  grokBuildNativeTransport,
  claudeCodeNativeTransport,
  glmClaudeCodeNativeTransport,
  codexNativeTransport,
  deepSeekHarnessNativeTransport,
] as const;

const admittedModels = [
  {
    transportKind: grokBuildNativeTransport.transportKind,
    model: "grok-4.6",
    effort: "xhigh",
  },
  {
    transportKind: claudeCodeNativeTransport.transportKind,
    model: "claude-opus-4-1",
    effort: "high",
  },
  {
    transportKind: claudeCodeNativeTransport.transportKind,
    model: "claude-opus",
    effort: "high",
  },
  {
    transportKind: glmClaudeCodeNativeTransport.transportKind,
    model: "glm-5.3",
    effort: "max",
  },
  {
    transportKind: codexNativeTransport.transportKind,
    model: "gpt-daybreak-blue-latest",
    effort: "xhigh",
  },
  {
    transportKind: codexNativeTransport.transportKind,
    model: "gpt-daybreak-blue-latest",
    effort: "max",
  },
  {
    transportKind: deepSeekHarnessNativeTransport.transportKind,
    model: "deepseek-flash",
    effort: "max",
  },
] as const;

function imageDigest(reference: string): string {
  const marker = reference.lastIndexOf("sha256:");
  return marker === -1 ? reference : reference.slice(marker);
}

export type AgentRuntimeProfileAdmission =
  | { readonly status: "admitted"; readonly profile: AgentRuntimeProfile }
  | {
      readonly status:
        | "invalid-profile"
        | "unsupported-profile"
        | "transport-requirement-mismatch"
        | "image-mismatch";
    };

export function admitAgentRuntimeProfile(
  candidate: unknown,
  sandboxImage: string,
): AgentRuntimeProfileAdmission {
  const parsed = agentRuntimeProfileSchema.safeParse(candidate);
  if (!parsed.success) return { status: "invalid-profile" };
  const profile = parsed.data;
  const requirement = transportRequirements.find(
    (item) => item.transportKind === profile.transportKind,
  );
  if (requirement === undefined) return { status: "unsupported-profile" };
  if (
    requirement.executableVersion !== profile.executableVersion ||
    requirement.sandboxImageDigest !== profile.sandboxImageDigest ||
    requirement.promptProtocol !== profile.promptProtocol ||
    requirement.reportProtocol !== profile.reportProtocol
  ) {
    return { status: "transport-requirement-mismatch" };
  }
  if (imageDigest(sandboxImage) !== profile.sandboxImageDigest) {
    return { status: "image-mismatch" };
  }
  if (
    !admittedModels.some(
      (item) =>
        item.transportKind === profile.transportKind &&
        item.model === profile.model &&
        item.effort === profile.effort,
    )
  ) {
    return { status: "unsupported-profile" };
  }
  return { status: "admitted", profile };
}
