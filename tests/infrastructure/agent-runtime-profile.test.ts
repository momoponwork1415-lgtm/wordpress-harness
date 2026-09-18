import { describe, expect, it } from "vitest";

import { canonicalDigest } from "../../src/infrastructure/canonical-json.js";
import {
  admitAgentRuntimeProfile,
  claudeCodeNativeTransport,
  deepSeekHarnessNativeTransport,
  defineAgentRuntimeProfile,
} from "../../src/infrastructure/agent-runtime-profile.js";

describe("Agent Runtime Profile catalog", () => {
  it("admits the provider-reported canonical Opus model without an Adapter change", () => {
    const profile = defineAgentRuntimeProfile({
      id: "claude-opus-high",
      ...claudeCodeNativeTransport,
      model: "claude-opus-5",
      effort: "high",
    });
    const unsupportedLegacyAlias = defineAgentRuntimeProfile({
      id: "claude-opus-legacy-alias-high",
      ...claudeCodeNativeTransport,
      model: "claude-opus",
      effort: "high",
    });

    expect(profile.digest).toBe(
      canonicalDigest({
        kind: profile.kind,
        schemaVersion: profile.schemaVersion,
        id: profile.id,
        transportKind: profile.transportKind,
        executableVersion: profile.executableVersion,
        sandboxImageDigest: profile.sandboxImageDigest,
        promptProtocol: profile.promptProtocol,
        reportProtocol: profile.reportProtocol,
        model: profile.model,
        effort: profile.effort,
      }),
    );
    expect(
      admitAgentRuntimeProfile(
        profile,
        `research@${profile.sandboxImageDigest}`,
      ),
    ).toEqual({ status: "admitted", profile });
    expect(
      admitAgentRuntimeProfile(
        unsupportedLegacyAlias,
        `research@${unsupportedLegacyAlias.sandboxImageDigest}`,
      ),
    ).toEqual({ status: "unsupported-profile" });
  });

  it("rejects unsupported effort, image, and protocol combinations", () => {
    const unsupportedEffort = defineAgentRuntimeProfile({
      id: "claude-opus-ultra",
      ...claudeCodeNativeTransport,
      model: "claude-opus-5",
      effort: "ultra",
    });
    const unsupportedProtocol = defineAgentRuntimeProfile({
      id: "claude-opus-wrong-protocol",
      ...claudeCodeNativeTransport,
      promptProtocol: "file",
      model: "claude-opus-5",
      effort: "high",
    });

    expect(
      admitAgentRuntimeProfile(
        unsupportedEffort,
        unsupportedEffort.sandboxImageDigest,
      ),
    ).toEqual({ status: "unsupported-profile" });
    expect(
      admitAgentRuntimeProfile(
        unsupportedProtocol,
        unsupportedProtocol.sandboxImageDigest,
      ),
    ).toEqual({ status: "transport-requirement-mismatch" });
    expect(
      admitAgentRuntimeProfile(
        defineAgentRuntimeProfile({
          id: "claude-opus-high",
          ...claudeCodeNativeTransport,
          model: "claude-opus-5",
          effort: "high",
        }),
        `sha256:${"0".repeat(64)}`,
      ),
    ).toEqual({ status: "image-mismatch" });
  });

  it("admits the pinned first-party DeepSeek Harness transport", () => {
    const profile = defineAgentRuntimeProfile({
      id: "deepseek-flash-max",
      ...deepSeekHarnessNativeTransport,
      model: "deepseek-flash",
      effort: "max",
    });

    expect(
      admitAgentRuntimeProfile(profile, profile.sandboxImageDigest),
    ).toEqual({ status: "admitted", profile });
  });
});
