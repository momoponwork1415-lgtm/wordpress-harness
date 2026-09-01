---
status: accepted
---

# Keep Campaign artifacts outside Git

Git repositoryにはharness code、generic prompt、rule、docs、synthetic fixtureだけを置く。Target Snapshot、Hypothesis、transcript、Experiment input、Witness、Causal Control、Findingは外部のprivate Campaign workspaceへ保存し、未公開研究artifactをcommit対象pathへ作らない。現在rootにあるplugin archive、source、metadataはbootstrap staging inputとして後続のsafe import設計で移行する。
