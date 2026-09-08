import { describe, expect, it } from "vitest";

import * as humanOsContext from "../../src/human-os/index.js";

describe("Human OS context Interface", () => {
  it("exposes only the Finding lifecycle and exact external-action gate", () => {
    expect(humanOsContext).toHaveProperty("openHumanOs");
    expect(humanOsContext).toHaveProperty(
      "openGvisorWordPressDynamicReproductionRuntime",
    );
    expect(humanOsContext).toHaveProperty("openRecipeDynamicReproductionAgent");
    expect(humanOsContext).toHaveProperty("defineAIReproductionRecord");
    expect(humanOsContext).toHaveProperty("defineHumanVerificationRecord");
    expect(humanOsContext).toHaveProperty("defineSubmissionDraft");
    expect(humanOsContext).toHaveProperty("defineExternalActionAuthorization");
    expect(humanOsContext).not.toHaveProperty("openAIReproduction");
    expect(humanOsContext).not.toHaveProperty("openCurrentHumanReview");
    expect(humanOsContext).not.toHaveProperty(
      "openLegacyHumanVerificationReplay",
    );
  });
});
