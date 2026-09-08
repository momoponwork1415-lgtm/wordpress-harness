export const grokBuildTransportEligibility = {
  imageDigest:
    "sha256:0390e43156357c08aab4ddc3f002ac11763789e90f0fac09f2fa2e73b8105267",
  executableVersion: "1.0.13",
} as const;

export function grokImageDigest(reference: string): string {
  const separator = reference.lastIndexOf("@sha256:");
  return separator === -1 ? reference : reference.slice(separator + 1);
}
