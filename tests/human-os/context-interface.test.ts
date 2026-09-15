import { describe, expect, it } from "vitest";

import * as humanOsContext from "../../src/human-os/index.js";

describe("Human OS context Interface", () => {
  it("exposes only Candidate Verification and the exact external-action gate", () => {
    expect(humanOsContext).toHaveProperty("openHumanOs");
    expect(humanOsContext).toHaveProperty(
      "openGvisorWordPressCandidateVerificationRuntime",
    );
    expect(humanOsContext).toHaveProperty("openRecipeDynamicReproductionAgent");
    expect(humanOsContext).toHaveProperty("defineCandidateVerificationRecord");
    expect(humanOsContext).toHaveProperty("defineProgrammeScopeAssessment");
    expect(humanOsContext).toHaveProperty("defineSubmissionCandidate");
    expect(humanOsContext).toHaveProperty("defineSubmissionDraft");
    expect(humanOsContext).toHaveProperty("defineExternalActionAuthorization");
    expect(humanOsContext).not.toHaveProperty("openAIReproduction");
    expect(humanOsContext).not.toHaveProperty("openCurrentHumanReview");
    expect(humanOsContext).not.toHaveProperty(
      "openLegacyHumanVerificationReplay",
    );
  });
});
