export type ResearchMethod = "wp2shell" | "cloudflare";

export interface ResearchMethodPromptSet {
  readonly id: string;
  readonly digest: string;
}

const wp2shellPromptDigest =
  "sha256:555b260f9b846ae97d69c72863ac1099292cb403657ab6e3ef10218619547f00";

const promptSetByMethod = {
  wp2shell: {
    id: "wordpress-plugin-research-wp2shell-v1",
    digest: wp2shellPromptDigest,
  },
  cloudflare: {
    id: "wordpress-plugin-research-cloudflare-v1",
    digest:
      "sha256:ad97b51be4cbe8e10e147bbed779a2db05c419fc8bbc78cdc26c1dbfedfe0113",
  },
} as const satisfies Record<ResearchMethod, ResearchMethodPromptSet>;

const canonicalPromptSets = new Map<
  string,
  { readonly method: ResearchMethod; readonly digest: string }
>([
  [
    promptSetByMethod.wp2shell.id,
    { method: "wp2shell", digest: promptSetByMethod.wp2shell.digest },
  ],
  [
    "wordpress-plugin-research-v3",
    { method: "wp2shell", digest: wp2shellPromptDigest },
  ],
  [
    promptSetByMethod.cloudflare.id,
    { method: "cloudflare", digest: promptSetByMethod.cloudflare.digest },
  ],
]);

export function researchPromptSetForMethod(
  method: ResearchMethod,
): ResearchMethodPromptSet {
  return promptSetByMethod[method];
}

export function canonicalResearchPromptDigest(
  promptSetId: string,
): string | undefined {
  return canonicalPromptSets.get(promptSetId)?.digest;
}

export function researchMethodForPromptSet(
  promptSet: ResearchMethodPromptSet,
): ResearchMethod | undefined {
  const canonical = canonicalPromptSets.get(promptSet.id);
  return canonical?.digest === promptSet.digest ? canonical.method : undefined;
}
