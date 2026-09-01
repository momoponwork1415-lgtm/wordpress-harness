---
status: accepted
---

# Schedule parallel work in deterministic waves

parallel workは、開始前にassignmentとbudget reservationをすべて確定する有限のWork Waveとしてscheduleする。Attemptは上限内で並列実行し、artifactとoutcomeは完了した順にdurable writeしてよいが、その到着順を次のpriorityまたはassignmentへ反映しない。

次Waveは、現在Waveの全Attemptが`completed`、`expired`、`cancelled`、`orphaned`のいずれかになり、`wave.closed`が追記された後にだけ計算する。結果集合をstable Work ID順にfoldし、同じLedger head、frozen policy、registry manifestから同じ次Work Lease集合を生成する。

このbarrierはstreaming schedulerより一部のslotを遊ばせる可能性があるが、provider responseの速度やprocess schedulingによって研究方針が変わることを防ぐ。実測上の利用率が問題になった場合も、Waveの最大範囲または同一priority bucket内の補充を検討し、arrival-order dependencyは導入しない。
