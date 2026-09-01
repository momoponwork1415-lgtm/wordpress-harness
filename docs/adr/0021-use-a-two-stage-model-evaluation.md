---
status: superseded by ADR-0089
---

# Use a two-stage model evaluation

候補modelの評価は、role別benchmarkとend-to-end Campaignの二段階にする。第一段階でMapperのcoverage、FinderのHypothesis recall、Verifierの判定精度、Skepticの誤昇格阻止を個別に測り、各roleのfinalistを絞る。第二段階ではfinalistの組合せだけを実行し、verified Finding回収、false promotion、cost、wall time、run varianceを測る。
