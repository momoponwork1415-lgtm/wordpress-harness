import { describe, expect, it } from "vitest";

import { canonicalDigest } from "../../src/infrastructure/canonical-json.js";
import {
  admitAgentRuntimeProfile,
  claudeCodeNativeTransport,
  deepSeekHarnessNativeTransport,
  defineAgentRuntimeProfile,
} from "../../src/infrastructure/agent-runtime-profile.js";

describe("Agent Runtime Profile catalog", () => {
  it("admits multiple models on one compatible transport without an Adapter change", () => {
    const first = defineAgentRuntimeProfile({
      id: "claude-opus-4-1-high",
      ...claudeCodeNativeTransport,
      model: "claude-opus-4-1",
      effort: "high",
    });
    const second = defineAgentRuntimeProfile({
      id: "claude-opus-high",
      ...claudeCodeNativeTransport,
      model: "claude-opus",
      effort: "high",
    });

    expect(first.digest).toBe(
      canonicalDigest({
        kind: first.kind,
        schemaVersion: first.schemaVersion,
        id: first.id,
        transportKind: first.transportKind,
        executableVersion: first.executableVersion,
        sandboxImageDigest: first.sandboxImageDigest,
        promptProtocol: first.promptProtocol,
        reportProtocol: first.reportProtocol,
        model: first.model,
        effort: first.effort,
      }),
    );
    expect(
      admitAgentRuntimeProfile(first, `research@${first.sandboxImageDigest}`),
    ).toEqual({ status: "admitted", profile: first });
    expect(
      admitAgentRuntimeProfile(second, `research@${second.sandboxImageDigest}`),
    ).toEqual({ status: "admitted", profile: second });
  });

  it("rejects unsupported effort, image, and protocol combinations", () => {
    const unsupportedEffort = defineAgentRuntimeProfile({
      id: "claude-opus-4-1-ultra",
      ...claudeCodeNativeTransport,
      model: "claude-opus-4-1",
      effort: "ultra",
    });
    const unsupportedProtocol = defineAgentRuntimeProfile({
      id: "claude-opus-4-1-wrong-protocol",
      ...claudeCodeNativeTransport,
      promptProtocol: "file",
      model: "claude-opus-4-1",
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
          id: "claude-opus-4-1-high",
          ...claudeCodeNativeTransport,
          model: "claude-opus-4-1",
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
