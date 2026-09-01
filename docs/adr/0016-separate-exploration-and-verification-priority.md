---
status: accepted
---

# Separate exploration and verification priority

Prioritizationを一つのglobal scoreへ圧縮せず、Exploration QueueとVerification Queueに分ける。Exploration Queueはcoverage gap、novelty、expected information gain、費用から発散の配分を決め、Verification Queueはpotential impact、Permitted Attacker、route completeness、決定的Experimentの費用から証拠への収束順を決める。重大に見える一群へ探索資源が偏り、未探索surfaceが残ることを防ぐ。
