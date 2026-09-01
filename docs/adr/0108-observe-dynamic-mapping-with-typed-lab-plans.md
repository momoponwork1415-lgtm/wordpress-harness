---
status: accepted
supersedes: 0031
---

# Observe dynamic mapping with typed Lab plans

Finderは引き続きTarget Snapshotをread-onlyに扱い、WordPress runtime、HTTP、browser、任意shellを直接操作しない。一方、静的解析でregistration、dynamic dispatch、state transitionを確定できない場合、Source Mappingは許可された低影響操作と成功条件を固定したRuntime Observation Planをfresh Lab Baseline cloneで実行し、その記録を次のSurface Map revisionへ`observed` evidenceとして取り込める。

Runtime Observationは攻撃payload、security propertyの破壊、Finding promotionを扱わず、WitnessまたはCausal Controlとして再利用しない。Source Mappingの内部seamだけがdeterministic test adapterまたはgVisor production adapterへplanを渡し、Finder、Campaign Control、modelへLab handleを公開しない。これによりDiscoveryへ実行権限を渡さず、静的推測のまま残る重要なmap gapだけを制御された観測で閉じる。
