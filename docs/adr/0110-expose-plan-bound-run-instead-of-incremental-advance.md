---
status: accepted
---

# Expose plan-bound run instead of incremental advance

Keep ADR 0058's event-sourced reconciler, but replace its public `advance` and `requestStop` commands with `CampaignRunner.run(CampaignRunPlan) -> CampaignRunRecordRef`. One immutable Plan now binds the target, policies, budgets, and external dependencies, while `run` owns phase order, crash resume, and the terminal Iteration Decision; read-only state remains behind `CampaignReader`.

The incremental API made callers choose an advance boundary and understand lifecycle transitions, which weakened the intended fully autonomous Campaign and complicated deterministic replay. Explicit stop control may be added later as a separately accepted control-plane behavior, but it must not reopen phase-level orchestration or change a completed run record.
