import { describe, expect, it } from "vitest";

import * as humanOsContext from "../../src/human-os/index.js";

describe("Human OS context Interface", () => {
  it("exposes the Environment Builder contract without persistence implementations", () => {
    expect(humanOsContext).toHaveProperty(
      "openHumanVerificationEnvironmentBuilder",
    );
    expect(humanOsContext).toHaveProperty(
      "humanVerificationEnvironmentRequestSchema",
    );
    expect(humanOsContext).toHaveProperty("openAIReproduction");
    expect(humanOsContext).toHaveProperty("findingAIReproductionAttemptSchema");
    expect(humanOsContext).toHaveProperty("aiVerificationRecordSchema");
    expect(humanOsContext).toHaveProperty("openGvisorAIReproductionHarness");
    expect(humanOsContext).not.toHaveProperty("aiReproductionAttemptSchema");
    expect(humanOsContext).not.toHaveProperty("triageReproductionPacketSchema");
    expect(humanOsContext).not.toHaveProperty("openLegacyPacketAIReproduction");
    expect(humanOsContext).toHaveProperty("openCurrentHumanReview");
    expect(humanOsContext).toHaveProperty("openLegacyHumanVerificationReplay");
    expect(humanOsContext).toHaveProperty("humanReviewCaseSchema");
    expect(humanOsContext).not.toHaveProperty("openSqliteHumanOsRecord");
    expect(humanOsContext).not.toHaveProperty("openFileHumanOsArtifactStore");
    expect(humanOsContext).not.toHaveProperty("openHumanVerification");
    expect(humanOsContext).not.toHaveProperty("defineHumanVerificationRecord");
  });
});
