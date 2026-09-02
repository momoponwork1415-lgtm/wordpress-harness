---
status: accepted
---

# Treat Analysis Units as seeds for bounded source retrieval

`Analysis Unit`はFinderのFocus、Strategy、初期source context、coverage ownershipを固定するseedとし、読めるfileの境界にはしない。Finderは同じimmutable Target Snapshotの範囲内で、versioned Attempt Planとtool policyへ拘束されたharness-owned source retrievalを使い、因果routeに必要なdefinition、usage、caller、callee、wrapper、guard、state、source rangeを追加取得できる。provider組込みshell、filesystem、network、runtime、Target writeは引き続き許可しない。

Attempt-localなSource Evidence Queryはsourceを読むだけで、進行中のSurface Mapを暗黙に変更しない。永続化すべきwrapper、dispatch、state等のrelationはsource anchorとprovenanceを持つproposalまたは`Mapping Evidence Request`としてWave barrier後へ渡し、Source Mappingの次revisionだけが検査済みの変更を取り込む。model proposalは`inferred`までとし、既存の`observed` factを削除またはdowngradeできない。

Source Understandingはsource検索とsymbol解決の意味を所有し、Model Executionはrole別tool公開、Snapshot/Lease binding、budget、policy decision、Tool Receiptを所有する。`ModelExecution.run(AttemptPlan)`と`CampaignRunner.run(CampaignRunPlan)`の公開Interfaceは増やさず、Campaign Controlへ個別tool callやprovider protocolを漏らさない。

この判断は、固定contextを境界にしないOpenAnt、Codex Security、Anthropicのsource navigation、OpenAntのread pathとpromote-only reachability signalの分離、W3C PROVのusage/generation/derivation分離を本harnessへadaptationしたものである。private custom-wrapper benchmarkでも、同じ固定Top-N/Analysis Unitの反復がcontext外sourceを観測できない限界を示した。根拠と適用限界は[Evidence-guided Finder loopの設計根拠](../research/evidence-guided-finder-loop-design-evidence.md)に記録する。

model-visible operationの正確な分割、query grammar、call/byte/hop/wall上限、pagination、retention、default Model ProfileはADRへ固定しない。これらは合成Boundary Pairとoracle-separated private benchmarkで測り、versioned policyまたはProfileとして変更可能に保つ。queryの`not-found`、`ambiguous`、`truncated`、`budget-exhausted`、`policy-denied`を`safe`へ読み替えず、同一queryまたはresponseのno-progressは理由付きで有限終了する。
