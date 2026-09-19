export type ResearchMethod = "wp2shell" | "cloudflare" | "cloudflare-upstream";

export interface ResearchMethodPromptSet {
  readonly id: string;
  readonly digest: string;
}

const wp2shellPromptDigest =
  "sha256:63d2269903ecf1941d52d4973c8e198ae1cefcf5dc6d8069d8559a4a0764b9d1";

const promptSetByMethod = {
  wp2shell: {
    id: "wordpress-plugin-research-wp2shell-v5",
    digest: wp2shellPromptDigest,
  },
  cloudflare: {
    id: "wordpress-plugin-research-cloudflare-v2",
    digest:
      "sha256:673bae0698edd385871c9e18b8c8a51254bf307f7f8a8b9be26c600dab40e399",
  },
  "cloudflare-upstream": {
    id: "wordpress-plugin-research-cloudflare-upstream-c1c8a8c-v2",
    digest:
      "sha256:3c922fafba2f58126748eb36663ec78d067192737d11bea9b569251a727cb400",
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
    promptSetByMethod.cloudflare.id,
    { method: "cloudflare", digest: promptSetByMethod.cloudflare.digest },
  ],
  [
    promptSetByMethod["cloudflare-upstream"].id,
    {
      method: "cloudflare-upstream",
      digest: promptSetByMethod["cloudflare-upstream"].digest,
    },
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
