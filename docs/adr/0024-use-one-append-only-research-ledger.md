---
status: accepted
---

# 追記専用Research Ledgerを一つだけ使う

Campaignの状態、判断、usage、failureの正本を一つのappend-only Research Recordとする。Campaign status、Finding、Coverageとinspection viewはrecordから再構築可能なprojectionであり、同じ状態を持つ第二の正本にしない。private transcriptとruntime evidenceはResearch Recordへ展開せず、Git外のcontext-owned storageへ置く。
