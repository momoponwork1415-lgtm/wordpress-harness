---
status: accepted
---

# Do not stop at the first Finding

一件目のFindingをCampaignのterminal conditionにしない。確定したCausal Identityを既知としてExploration Queueで降格し、Verification Queueではduplicateとして除外し、未探索surface、別cause、variantへ資源を移してCoverage Closureまたはresource exhaustionまで続ける。Target Snapshotをpatchまたは変更せず、既知causeのmaskとdedupはorchestratorが所有する。
