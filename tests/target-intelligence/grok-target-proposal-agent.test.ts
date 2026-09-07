import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { canonicalDigest } from "../../src/infrastructure/canonical-json.js";
import { promptTextDigest } from "../../src/infrastructure/prompt-text.js";
import {
  defineTargetCandidatePool,
  openGrokTargetProposalAgent,
  openTargetProposals,
  type TargetCandidate,
  type TargetSelectionRunInput,
} from "../../src/target-intelligence/index.js";

const digest = (character: string): string => `sha256:${character.repeat(64)}`;

function candidate(): TargetCandidate {
  return {
    candidateId: "candidate-public-form",
    target: {
      pluginIdentity: "wporg:public-form",
      verifiedVersion: "1.0.0",
      canonicalFileManifestDigest: digest("a"),
    },
    targetObservation: {
      ref: { id: "target-observation", digest: digest("b") },
      retrievedAt: "2026-09-07T00:00:00.000Z",
      currentUntil: "2026-09-14T00:00:00.000Z",
      acquisition: "available",
      provenance: "verified",
      identity: "verified",
    },
    selectionFacts: {
      activeInstallCount: 10_000,
      lastUpdatedAt: "2026-09-01T00:00:00.000Z",
      integrations: ["contact-form"],
    },
    programmes: [],
    disclosureRoute: {
      observationRef: {
        id: "route-observation",
        digest: digest("c"),
        routeDigest: digest("d"),
      },
      kind: "none-found",
      currentUntil: "2026-09-14T00:00:00.000Z",
    },
    researchHistory: { status: "new" },
  };
}

describe("Grok Target Proposal Agent", () => {
  it("creates an AI Target Proposal through the public Module in runsc", async () => {
    const directory = await mkdtemp(join(tmpdir(), "grok-target-proposal-"));
    const provider = join(directory, "provider");
    const scratch = join(directory, "scratch");
    await Promise.all([mkdir(provider), mkdir(scratch)]);
    await Promise.all([
      writeFile(join(provider, "auth.json"), "{}", { mode: 0o600 }),
      writeFile(join(provider, "agent_id"), "agent-1", { mode: 0o600 }),
      writeFile(join(provider, "config.toml"), "forbidden = true", "utf8"),
    ]);
    const docker = join(directory, "fake-docker");
    await writeFile(
      docker,
      `#!/bin/sh
set -eu
if [ "\${1:-}" = "info" ]; then
  printf '%s' '{"runsc":{"path":"/usr/bin/runsc"}}'
  exit 0
fi
if [ "\${1:-}" = "image" ]; then
  exit 0
fi
has_runsc=0
has_isolated_provider_home=0
has_memory_disabled=0
has_subagents_disabled=0
has_empty_tools=0
volume_count=0
is_version=0
scratch=''
provider_mount=''
previous=''
for argument in "$@"; do
  [ "$argument" != "--runtime=runsc" ] || has_runsc=1
  [ "$argument" != "--env=GROK_HOME=/provider" ] || has_isolated_provider_home=1
  [ "$argument" != "--no-memory" ] || has_memory_disabled=1
  [ "$argument" != "--no-subagents" ] || has_subagents_disabled=1
  if [ "$previous" = "--tools" ] && [ -z "$argument" ]; then
    has_empty_tools=1
  fi
  [ "$argument" != "--volume" ] || volume_count=$((volume_count + 1))
  [ "$argument" != "--version" ] || is_version=1
  case "$argument" in
    *:/workspace/research:rw) scratch="\${argument%:/workspace/research:rw}" ;;
    *:/provider:rw) provider_mount="\${argument%:/provider:rw}" ;;
  esac
  previous="$argument"
done
[ "$has_runsc" -eq 1 ] || exit 90
[ "$volume_count" -eq 2 ] || exit 91
if [ "$is_version" -eq 1 ]; then
  printf '%s\n' 'grok 1.0.13 (Grok Build)'
  exit 0
fi
[ "$has_isolated_provider_home" -eq 1 ] || exit 98
[ "$has_memory_disabled" -eq 1 ] || exit 99
[ "$has_subagents_disabled" -eq 1 ] || exit 100
[ "$has_empty_tools" -eq 1 ] || exit 101
[ -n "$provider_mount" ] || exit 102
case "$provider_mount" in
  "$scratch"/*) exit 103 ;;
esac
[ -f "$provider_mount/auth.json" ] || exit 95
[ -f "$provider_mount/agent_id" ] || exit 96
[ ! -e "$provider_mount/config.toml" ] || exit 97
grep -F 'Select an arbitrary subset' "$scratch/prompt.txt" >/dev/null
grep -F 'candidate-public-form' "$scratch/prompt.txt" >/dev/null
printf '%s' '{"text":"","stopReason":"end_turn","sessionId":"selection-session","requestId":"selection-request","usage":{"input_tokens":1200,"cache_read_input_tokens":100,"cache_creation_input_tokens":50,"output_tokens":200,"reasoning_tokens":40,"total_tokens":1550},"num_turns":2,"total_cost_usd":0.1,"modelUsage":{"grok-4.6-build":{"inputTokens":1200,"outputTokens":200,"cacheReadInputTokens":100,"cacheCreationInputTokens":50,"modelCalls":2,"costUSD":0.1}},"structuredOutput":{"schemaVersion":1,"basis":"The public form integration warrants prospective research.","targets":[{"candidateId":"candidate-public-form","reason":"A public write boundary may create cross-actor security semantics.","uncertainty":"No vulnerability or reachable route is known before Research."}]}}'
`,
      { mode: 0o700 },
    );
    await chmod(docker, 0o700);

    const guidance =
      "Select an arbitrary subset for prospective research and explain uncertainty.";
    const permissionProfileDigest = canonicalDigest({
      backend: "gvisor",
      network: "provider-only",
      shell: false,
      web: false,
      ambientConfig: false,
    });
    const agent = openGrokTargetProposalAgent({
      dockerExecutablePath: docker,
      image: digest("f"),
      providerConfigDirectory: provider,
      scratchRootDirectory: scratch,
      selectionGuidance: {
        digest: promptTextDigest(guidance),
        text: guidance,
      },
      permissionProfileDigest,
      maxOutputBytes: 1_000_000,
    });
    const proposals = openTargetProposals({
      storageDirectory: join(directory, "records"),
      agent,
      clock: () => new Date("2026-09-07T00:02:00.000Z"),
    });
    const pool = defineTargetCandidatePool({
      id: "candidate-pool",
      candidates: [candidate()],
    });
    const input: TargetSelectionRunInput = {
      kind: "target-selection-run-input",
      schemaVersion: 1,
      selectionKey: "prospective-selection",
      revision: 1,
      candidatePool: pool,
      selectionGuidance: {
        id: "selection-guidance-v1",
        digest: promptTextDigest(guidance),
      },
      agentRuntimeProfile: {
        id: "grok-selection-v1",
        kind: "grok-build-native/v1",
        executableVersion: "1.0.13",
        model: "grok-4.6",
        effort: "xhigh",
        digest: digest("1"),
      },
      permissionProfile: {
        id: "oracle-free-selection-v1",
        digest: permissionProfileDigest,
      },
      budgetEnvelope: {
        id: "selection-budget-v1",
        maxWallTimeMs: 300_000,
        maxEstimatedCostUsd: 5,
        digest: digest("2"),
      },
    };

    try {
      await expect(proposals.propose(input)).resolves.toMatchObject({
        status: "proposed",
      });
      await expect(
        proposals.inspect({ selectionKey: input.selectionKey, revision: 1 }),
      ).resolves.toMatchObject({
        status: "proposed",
        proposal: {
          targets: [
            {
              candidateId: "candidate-public-form",
              reason:
                "A public write boundary may create cross-actor security semantics.",
            },
          ],
        },
        run: {
          receipt: {
            terminal: "completed",
            usage: {
              inputTokens: 1350,
              outputTokens: 200,
              estimatedCostUsd: 0.1,
            },
          },
        },
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
