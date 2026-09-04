---
status: accepted
---

# Run source-aware Recon alongside a whole-target baseline

最初のSemantic Research Waveは、sourceを読まない抽象Plannerの完了を全Finderの開始条件にしない。一つのwhole-target Baseline Finderと、manifest-boundな`list / search / read`を持つsource-aware Reconを同時に開始する。Baseline FinderはTarget全体を自由に探索し、Reconの成功、Focus Packet、Surface Mapを必要としない。

Reconは実sourceから5--15個程度のinput-processing subsystem、security assumption、trust transition、機能間interactionをinventoryし、その中から初期Waveで最も強く独立した最大3個のsource-backed Research Focus Packetを返す。Focus Packetは研究上の問い、starting evidence、独立性の根拠を持つ開始点であり、CWE、sink、file allowlist、固定手順またはcandidate受理条件ではない。通常profileの最大4 Finder枠のうち一つをBaselineへ、残り最大3枠をFocus PacketまたはWildcardへ使い、各Finderはpacket外を含むTarget全体へpivotできる。Recon自身はFinder枠に数えないが、独立したAttempt、Profile、Budget Envelope、Receiptを持つ。

この構成は、source-blindな多様性だけに依存する危険と、Reconの分類漏れをそのまま探索漏れにする危険の両方を避ける。追加のmodel workは増えるが、初期recall baselineではcostよりbroken security semanticsの発見を優先し、削減はProspective Campaign後のablationで判断する。初期baselineはrole間で同じ強いmodel familyを使ってよく、multi-model合議は要求しない。

本ADRはADR 0117のraw-source-firstと最大4 Finderを具体化する。Surface Mapを任意の補助toolにする判断、Finderの自由なpivot、minority candidate保持は変更しない。
