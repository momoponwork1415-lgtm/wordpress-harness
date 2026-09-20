import { describe, expect, it } from "vitest";

import {
  inspectPromptedJsonResearchReport,
  parsePromptedJsonResearchReport,
} from "../../src/research/agent-led/prompted-json-report.js";
import { researchEvidenceSummaryFixture } from "./support/research-evidence-summary.js";

function report() {
  return {
    schemaVersion: 2,
    evidenceSummary: researchEvidenceSummaryFixture(),
    candidates: [],
    assessments: [],
    decision: {
      kind: "stop",
      basis: "No actionable frontier remains, even after checking a,,b.",
    },
  };
}

function reportWithCandidate() {
  const evidence = {
    path: "plugin.php",
    location: "10",
    observation: "A public request reaches the sensitive operation.",
  };
  return {
    ...report(),
    candidates: [
      {
        candidateId: "candidate-1",
        attackerPremise: "Unauthenticated visitor",
        brokenSecurityProperty:
          "Only authorized users may perform the operation",
        claim: "A public request reaches the sensitive operation",
        evidence: [evidence],
        sourceTrace: [
          { ...evidence, role: "entrypoint" },
          { ...evidence, location: "20", role: "effect" },
        ],
        controlAssessments: [
          {
            control: "Nonce verification",
            evidence: [evidence],
            conclusion:
              "The nonce is public and does not authorize the caller.",
          },
        ],
        unresolvedFacts: [],
      },
    ],
  };
}

describe("prompted JSON Research Report parsing", () => {
  it("reports schema issue codes and paths without exposing provider content", () => {
    const { evidenceSummary: _evidenceSummary, ...withoutEvidenceSummary } =
      report();

    expect(
      inspectPromptedJsonResearchReport(JSON.stringify(withoutEvidenceSummary)),
    ).toEqual({
      status: "rejected",
      issueSummary: "invalid_type@evidenceSummary",
    });
  });

  it("normalizes an omitted empty Candidate delta", () => {
    const { candidates: _candidates, ...withoutCandidates } = report();

    expect(
      parsePromptedJsonResearchReport(JSON.stringify(withoutCandidates)),
    ).toEqual(report());
  });

  it.each([null, {}])(
    "rejects an invalid Candidate delta instead of normalizing %j",
    (candidates) => {
      expect(
        parsePromptedJsonResearchReport(
          JSON.stringify({ ...report(), candidates }),
        ),
      ).toBeUndefined();
    },
  );

  it("repairs one redundant comma between object members", () => {
    const malformed = JSON.stringify(report()).replace(
      ',"candidates"',
      ',,"candidates"',
    );

    expect(parsePromptedJsonResearchReport(malformed)).toEqual(report());
  });

  it("does not repair a missing array element", () => {
    const malformed = JSON.stringify(report()).replace(
      '"unexaminedAreas":[]',
      '"unexaminedAreas":[,,]',
    );

    expect(parsePromptedJsonResearchReport(malformed)).toBeUndefined();
  });

  it("repairs one known unquoted top-level report key", () => {
    const malformed = JSON.stringify(report()).replace(
      '"candidates":',
      "candidates:",
    );

    expect(parsePromptedJsonResearchReport(malformed)).toEqual(report());
  });

  it("does not repair an unquoted nested key", () => {
    const malformed = JSON.stringify(report()).replace(
      '"evidence":',
      "evidence:",
    );

    expect(parsePromptedJsonResearchReport(malformed)).toBeUndefined();
  });

  it("repairs one premature Candidate-array closure before control assessments", () => {
    const malformed = JSON.stringify(reportWithCandidate()).replace(
      '}],"controlAssessments":',
      '}]}],"controlAssessments":',
    );

    expect(parsePromptedJsonResearchReport(malformed)).toEqual(
      reportWithCandidate(),
    );
  });

  it("repairs the same premature closure repeated across Candidates", () => {
    const value = {
      ...reportWithCandidate(),
      candidates: [
        ...reportWithCandidate().candidates,
        {
          ...reportWithCandidate().candidates[0]!,
          candidateId: "candidate-2",
        },
      ],
    };
    const malformed = JSON.stringify(value).replaceAll(
      '}],"controlAssessments":',
      '}]}],"controlAssessments":',
    );

    expect(parsePromptedJsonResearchReport(malformed)).toEqual(value);
  });

  it("repairs one missing final object closure", () => {
    const encoded = JSON.stringify(report());

    expect(parsePromptedJsonResearchReport(encoded.slice(0, -1))).toEqual(
      report(),
    );
  });

  it("does not repair more than one missing final closure", () => {
    const encoded = JSON.stringify(report());

    expect(
      parsePromptedJsonResearchReport(encoded.slice(0, -2)),
    ).toBeUndefined();
  });

  it("repairs a missing evidence-summary closure before Candidates", () => {
    const malformed = JSON.stringify(report()).replace(
      ']},"candidates":',
      '],"candidates":',
    );

    expect(parsePromptedJsonResearchReport(malformed)).toEqual(report());
  });

  it("repairs one premature top-level closure before the decision", () => {
    const malformed = JSON.stringify(report()).replace(
      '],"decision":',
      ']},"decision":',
    );

    expect(parsePromptedJsonResearchReport(malformed)).toEqual(report());
  });

  it("does not repair repeated premature top-level closures", () => {
    const malformed = JSON.stringify(report()).replace(
      '],"decision":',
      ']},"decision":',
    );

    expect(
      parsePromptedJsonResearchReport(`${malformed}\n${malformed}`),
    ).toBeUndefined();
  });

  it("does not treat a nested decision boundary as a top-level closure", () => {
    const encoded = JSON.stringify({
      ...report(),
      evidenceSummary: {
        ...report().evidenceSummary,
        ignored: { inner: {}, decision: {} },
      },
    });

    expect(
      parsePromptedJsonResearchReport(encoded.slice(0, -2)),
    ).toBeUndefined();
  });
});
