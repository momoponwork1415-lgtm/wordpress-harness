---
status: accepted
---

# Start prospective Campaigns after minimal calibration

広範なbenchmark matrixを完了してから実戦投入するのではなく、一つのBoundary Pairで探索、独立Verification、誤検出除外、隔離、記録、再開をend-to-endで確認した後、取得時点の最新安定版pluginへoracle-freeな実戦Campaignを開始する。benchmarkは安全性と回帰の小さな校正集合とし、model×role×複数runの全組合せを実戦開始のgateにしない。実戦のpositiveとnegative evidence、coverage gap、cost、varianceを改善の主入力にし、外部提出は引き続き独立承認を要求する。この決定は[ADR 0072](0072-prove-research-capability-before-automating-target-selection.md)の広範なMilestone 2 benchmark順序を置き換えるが、Target Intelligence自動化より先にresearch loopを成立させる判断は維持する。
