import type { ResearchEvidenceSummary } from "../../../src/research/agent-led/contracts.js";

export function researchEvidenceSummaryFixture(
  path = "plugin.php",
): ResearchEvidenceSummary {
  return {
    examinedAreas: [
      {
        area: "Public request handling and its security controls",
        evidence: [
          {
            path,
            location: "fixture",
            observation:
              "The fixture inspected the source path relevant to this Research result.",
          },
        ],
      },
    ],
    unexaminedAreas: [],
  };
}
