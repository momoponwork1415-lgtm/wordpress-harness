---
status: accepted
---

# Gate Milestone 1 on one complete Boundary Pair

Milestone 1は、Claude process adapterの一つのOpus Model Profileを使い、gVisor上でBrizy 2.8.11/2.8.12 Boundary PairをCampaign開始から判定まで完走した時だけ合格とする。

合格には次をすべて要求する。

- Brizy 2.8.11 vulnerable positiveだけが、独立source re-derivation、browser Witness、sibling Causal Control、Skeptic、deterministic evidence gateを通ってFindingへ昇格する
- Brizy 2.8.12 patched negativeは同じCausal Identityを再現せず、Findingへ昇格しない
- benign fileUpload/form controlは期待する正常機能を維持する
- Target Snapshot、Prompt Set、Model Profile、Lab Baseline、Experiment、evidence、decision、usageをSQLite Research Ledgerとprivate CASから追跡できる
- Work Wave途中のprocess kill後にLedger replayで再開し、完了済みWork Leaseを重複実行しない
- 同じLedger headとfrozen inputsから同じ次Work WaveとCampaign projectionを再構築できる
- sandbox、egress、budget、tool policy違反がFindingを生成せず、理由付きoutcomeになる

GLM、Codex、Grok adapter、複数model比較、SQLi、ATO、RCE、全Development Cohort、Sealed Evaluation Cohort、web UI、submissionはMilestone 1へ含めない。これらの未実装を隠すstubまたはsilent successを作らない。
