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
  while (
    outcome.status === "research-review-pending" ||
    outcome.status === "candidate-review-pending"
  ) {
    const view = await campaigns.inspect({ campaignId: input.campaignId });
    if (outcome.status === "research-review-pending") {
      const request = view.pendingResearchContinuationReview;
      if (request === undefined) {
        throw new Error("missing Research continuation review request");
      }
      const reviewBody = {
        kind: "human-research-continuation-review" as const,
        schemaVersion: 1 as const,
        reviewId: `research-review:${request.researchRunId}`,
        campaignId: input.campaignId,
        campaignInputDigest: request.campaignInputDigest,
        researchRunId: request.researchRunId,
        checkpointId: request.checkpoint.checkpointId,
        checkpointStateDigest: request.checkpoint.stateDigest,
        candidateSetDigest: request.candidateSetDigest,
        parkedProgrammeLeadSetDigest: request.parkedProgrammeLeadSetDigest,
        researchContinuationReviewRequestDigest: request.digest,
        operator: {
          identity: "test-human-reviewer",
          decidedAt: "2026-09-09T00:00:00.000Z",
        },
        decision: "continue-research" as const,
        reason: "The source-bound next actions warrant another Research Grant.",
      };
      outcome = await campaigns.conduct({
        ...reviewBody,
        digest: canonicalDigest(reviewBody),
      });
      continue;
    }
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
        disposition: "advance-to-independent-validation" as const,
        reason: "The Candidate warrants fresh independent source validation.",
      })),
    };
    outcome = await campaigns.conduct({
      ...reviewBody,
      digest: canonicalDigest(reviewBody),
    });
  }
  return outcome;
}
