import { canonicalDigest } from "../../../src/infrastructure/canonical-json.js";
import type {
  CampaignInput,
  CampaignOutcomeRef,
  ResearchCampaigns,
} from "../../../src/research/agent-led/contracts.js";

export async function conductWithHumanAdvance(
  campaigns: ResearchCampaigns,
  input: CampaignInput,
): Promise<CampaignOutcomeRef> {
  let outcome = await campaigns.conduct(input);
  while (outcome.status === "candidate-review-pending") {
    const view = await campaigns.inspect({ campaignId: input.campaignId });
    const request = view.pendingCandidateReview;
    if (request === undefined)
      throw new Error("missing Candidate review request");
    const reviewBody = {
      kind: "human-candidate-review" as const,
      schemaVersion: 1 as const,
      reviewId: `review:${request.terminalResearchRunId}`,
      campaignId: input.campaignId,
      campaignInputDigest: request.campaignInputDigest,
      terminalResearchRunId: request.terminalResearchRunId,
      candidateSetDigest: request.candidateSetDigest,
      candidateReviewRequestDigest: request.digest,
      operator: {
        identity: "test-human-reviewer",
        decidedAt: "2026-09-09T00:00:00.000Z",
      },
      decisions: request.candidates.map((candidate) => ({
        candidateId: candidate.candidateId,
        disposition: "advance-to-candidate-verification" as const,
        reason: "The Candidate warrants fresh runtime verification.",
      })),
    };
    outcome = await campaigns.conduct({
      ...reviewBody,
      digest: canonicalDigest(reviewBody),
    });
  }
  return outcome;
}
