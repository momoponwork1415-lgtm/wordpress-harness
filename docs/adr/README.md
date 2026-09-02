# Architecture Decision Records

ADRは現在の実装説明ではなく、hard-to-reverseな判断履歴である。全115件を順に読む必要はない。通常は[Documentation Guide](../README.md)から該当する設計書へ進み、理由が必要な判断だけlink先のADRを読む。

## 現在の探索に重要なADR

- [ADR 0001 — 10動詞をcontrol propertyにする](0001-ten-verbs-as-control-properties.md)
- [ADR 0003 — Discoveryへ脆弱性oracleを渡さない](0003-do-not-give-discovery-a-vulnerability-oracle.md)
- [ADR 0007 — Findingへ実行可能なWitnessを要求する](0007-require-an-executable-witness-for-every-finding.md)
- [ADR 0008 — Causal Controlを要求する](0008-require-a-causal-control.md)
- [ADR 0015 — Discoveryをhigh recallに保つ](0015-keep-discovery-high-recall.md)
- [ADR 0024 — 追記型Research Ledgerを使う](0024-use-one-append-only-research-ledger.md)
- [ADR 0031 — Discoveryをread-onlyかつtool-flexibleにする](0031-keep-discovery-read-only-and-tool-flexible.md)
- [ADR 0042 — Verifier、Skeptic、evidence gateを分離する](0042-use-verifier-skeptic-and-evidence-gate.md)
- [ADR 0051 — 予算をmodel外で強制する](0051-enforce-campaign-budgets-outside-the-model.md)
- [ADR 0061 — subscription modelは公式native processを使う](0061-use-native-agent-processes-for-subscription-models.md)
- [ADR 0063 — orchestrator、agent、Targetの信頼領域を分ける](0063-separate-the-orchestrator-agent-and-target-trust-zones.md)
- [ADR 0067 — production evidenceへgVisorを要求する](0067-require-gvisor-for-production-evidence.md)
- [ADR 0068 — WitnessとControlをfresh sibling Labで実行する](0068-run-witness-and-control-in-sibling-labs.md)
- [ADR 0075 — frontier compromise discoveryをNorth Starにする](0075-make-frontier-compromise-discovery-the-north-star.md)
- [ADR 0077 — Evidence RouteでHypothesisを表す](0077-represent-each-hypothesis-with-an-evidence-route.md)
- [ADR 0080 — Target-bound Route Fragmentだけを再利用する](0080-reuse-only-target-bound-verified-route-fragments.md)
- [ADR 0104 — 公式Model Transportだけを受理する](0104-admit-only-official-model-transports.md)
- [ADR 0105 — harness所有toolだけを公開する](0105-expose-only-harness-owned-attempt-tools.md)
- [ADR 0109 — patched Snapshotをoracle分離した二経路で検査する](0109-test-patched-snapshots-through-two-oracle-separated-paths.md)
- [ADR 0112 — Analysis Unitをscopeではなくseedにする](0112-treat-analysis-units-as-seeds-for-bounded-source-retrieval.md)
- [ADR 0113 — Evidence Shell内でFinderの方法を自由にする](0113-keep-finder-methods-free-behind-an-evidence-shell.md)
- [ADR 0114 — BreadthとDepthのCampaign policyを分ける](0114-separate-breadth-and-depth-campaign-policies.md)
- [ADR 0115 — 公開CVEの実験結果だけをGitへ置く](0115-publish-only-public-cve-experiment-results.md)

`status: superseded`のADRは現在の規則ではなく、判断が変わった理由を残す履歴である。
