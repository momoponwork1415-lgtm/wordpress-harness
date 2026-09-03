---
status: accepted
---

# Mine the legacy repository; do not port it

`whitebox-harness`はcodeまたはarchitectureの移植元にせず、domain intent、不変条件、失敗記録、実証済みCase、fixtureを抽出するlegacy evidenceとして扱う。旧repoはTarget Snapshot、異質な探索、独立再導出、clean Lab、causal negative control、private evidence、反復学習という目標を一貫して示す一方、それらを支えるcontractとlifecycleが先行して複雑化しているためである。旧assetは、新しいend-to-end vertical sliceに必要で、現在のinterfaceへ自然に適合し、独立testで価値を示せる場合だけ再実装またはfixture化する。
