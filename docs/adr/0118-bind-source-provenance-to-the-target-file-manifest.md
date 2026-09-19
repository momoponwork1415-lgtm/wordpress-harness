---
status: accepted
---

# source provenanceをTarget File Manifestへ結び付ける

Researchのsource identityはTarget Intelligenceが取得時に作るCanonical File Manifestを正本とする。CampaignはTarget Snapshotとsource tree digestをsealし、Agent Runtimeはcontainer起動前に実際のread-only source treeを同じcanonical manifestとして再計算して一致を確認する。

Surface Map、AST、Semgrep、CodeQLまたはagentの観測をsource identityの代理にしない。manifest mismatch、link、path collision、read failureまたはmutationをMapなし、best effort、no-findingへfallbackせず、TargetをAgentへ渡す前に`policy-denied`として停止する。

Target Intelligenceは取得と受入policyを所有し、Researchは取得を再実行しない。Researchが行うのは固定manifestとのintegrity comparisonだけである。進行中Campaignのsourceを更新せず、新versionは新しいTarget SnapshotとCampaignにする。
