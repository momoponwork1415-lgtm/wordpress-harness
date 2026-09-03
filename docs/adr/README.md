# Architecture Decision Records

ADRは現在の実装説明ではなく、**hard-to-reverseな判断履歴**です。全ADRを番号順に読みません。通常は[Documentation](../README.md)からowning designへ進み、「なぜこの制約があるか」が必要なときだけ該当ADRを読みます。

## Current cross-cutting decisions

### Research policy

- [ADR 0001 — 10動詞をcontrol propertyにする](0001-ten-verbs-as-control-properties.md)
- [ADR 0003 — Discoveryへ脆弱性oracleを渡さない](0003-do-not-give-discovery-a-vulnerability-oracle.md)
- [ADR 0015 — Discoveryをhigh recallに保つ](0015-keep-discovery-high-recall.md)
- [ADR 0113 — Evidence Shell内でFinderの方法を自由にする](0113-keep-finder-methods-free-behind-an-evidence-shell.md)
- [ADR 0114 — BreadthとDepthのCampaign policyを分ける](0114-separate-breadth-and-depth-campaign-policies.md)
- [ADR 0116 — Depth Waveを最大4 Finderにする](0116-use-four-finder-slots-per-depth-wave.md)
- [ADR 0117 — high-impact semantic recallを優先し、Depthを条件付き昇格にする](0117-optimize-for-high-impact-semantic-recall.md)

### Evidence and isolation

- [ADR 0007 — Findingへ実行可能なWitnessを要求する](0007-require-an-executable-witness-for-every-finding.md)
- [ADR 0008 — Causal Controlを要求する](0008-require-a-causal-control.md)
- [ADR 0024 — 追記型Research Ledgerを使う](0024-use-one-append-only-research-ledger.md)
- [ADR 0051 — 予算をmodel外で強制する](0051-enforce-campaign-budgets-outside-the-model.md)
- [ADR 0063 — orchestrator、agent、Targetの信頼領域を分ける](0063-separate-the-orchestrator-agent-and-target-trust-zones.md)
- [ADR 0067 — production evidenceへgVisorを要求する](0067-require-gvisor-for-production-evidence.md)
- [ADR 0068 — WitnessとControlをfresh sibling Labで実行する](0068-run-witness-and-control-in-sibling-labs.md)

### Provider and tool boundary

- [ADR 0061 — subscription modelは公式native processを使う](0061-use-native-agent-processes-for-subscription-models.md)
- [ADR 0104 — 公式Model Transportだけを受理する](0104-admit-only-official-model-transports.md)
- [ADR 0105 — Harness所有toolだけをworkerへ公開する](0105-expose-only-harness-owned-attempt-tools.md)

これ以外のADRは、該当Seamからlinkされたとき、または過去の判断経緯を調べるときだけ読みます。

## Superseded decisions

[ADR 0075 — frontier compromise discoveryを唯一のNorth Starにする](0075-make-frontier-compromise-discovery-the-north-star.md)は[ADR 0117](0117-optimize-for-high-impact-semantic-recall.md)でsupersedeされています。`status: superseded`のADRは削除せず、判断が変わった理由を残す履歴として保持します。

新しいADRは、**hard-to-reverse / 文脈なしでは意外 / 実在するtrade-off**の3条件を満たす判断だけに作ります。実装詳細、現在のstatus、作業予定、実験結果はADRへ置きません。
