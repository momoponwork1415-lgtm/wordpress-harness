import { describe, expect, it } from "vitest";

import * as researchContext from "../../src/research/index.js";

describe("Research context Interface", () => {
  it("does not expose Source Mapping or persistence implementations", () => {
    expect(researchContext).not.toHaveProperty("openPhpSourceAnalysis");
    expect(researchContext).not.toHaveProperty("phpProgramIndexSchema");
    expect(researchContext).not.toHaveProperty("openSqliteResearch");
    expect(researchContext).not.toHaveProperty("openSqliteResearchRecord");
    expect(researchContext).not.toHaveProperty("openFileJsonArtifactStore");
  });
});
