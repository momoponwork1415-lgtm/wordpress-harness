---
status: accepted
---

# Prioritize frontier work by observed route gaps

Frontier Laneの優先度をmodel confidenceまたは「RCEらしさ」の単一scoreで決めず、Permitted Attacker、terminal security impact、再利用できるobserved Route Fragment、残るFrontier Gapの決定可能性、最小Experimentの費用、novelty、coverage debtから決定的なpriority tupleを作る。

`Frontier Gap`は単純な未確認edge数ではなく、現在のEvidence RouteからRCEまたは同等のsite-wide compromiseへ到達するために必要な、明示された未確認のessential causal relationである。各Gapは必要fact、falsifier、次の決定的Experiment、cost classを持つ。LLMはGapとExperimentを提案できるが、confidence numberをpriority factへ入れず、CampaignRunnerが観測済みfieldだけから順序を計算する。

Frontier優先度が高くてもPrimitive LaneとCoverage Laneの最低枠を奪わない。重大impactへの近さは探索順を変えるが、Hypothesisの昇格条件またはFindingの証拠水準を下げない。
