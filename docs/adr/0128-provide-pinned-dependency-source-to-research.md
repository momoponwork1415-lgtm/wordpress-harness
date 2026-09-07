---
status: accepted
---

# Provide pinned dependency source to Research

ResearchとIndependent Validationへ、Target pluginに加えてWordPress core等のauthoritative Dependency Snapshotをread-only referenceとして渡す。framework APIの呼び出しからsecurity effectまでをmemoryで補完すると、plugin内のprimitiveを見つけてもcore側のconsumer、filter、escape、capability semanticsへ到達できず、source-onlyのchainを閉じられないためである。

Dependency Snapshotはidentity、version、snapshot digest、canonical source-tree digestとmount nameを持つ。Campaign Input、sealed Research / Validation Run、Agent Checkpoint、Findingへ同じdependency bindingを残す。Runtimeは起動前に全source treeを検証し、`/workspace/dependencies/<mount>`へread-only mountする。Dependency変更後に古いCheckpointを再開しない。

Dependencyはsource worldを完成させるreferenceでありaudit Targetではない。agentはframework挙動をsourceから導出するが、FindingはTarget pluginのbroken security semanticsへ帰属させる。HarnessはDependency用の別解析pipeline、固定call graph、WordPress semantics databaseまたは探索roleを作らない。どのdependency pathを読み、仮説を継続するかはAIが決める。
