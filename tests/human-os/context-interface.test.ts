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
    expect(humanOsContext).toHaveProperty("openHumanVerification");
    expect(humanOsContext).toHaveProperty("humanReviewCaseSchema");
    expect(humanOsContext).not.toHaveProperty("openSqliteHumanOsRecord");
    expect(humanOsContext).not.toHaveProperty("openFileHumanOsArtifactStore");
  });
});
