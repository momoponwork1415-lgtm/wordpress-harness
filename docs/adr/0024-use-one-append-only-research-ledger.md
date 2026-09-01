---
status: accepted
---

# Use one append-only Research Ledger

Campaignの状態、判断、因果、費用の正本を一つのappend-only Research Ledgerとする。Exploration Queue、Verification Queue、Campaign status、coverage、summary、metricsはLedgerから再構築可能なprojectionであり、同じ状態を持つ第二の正本にしない。大きなsource、transcript、runtime receipt、Witnessはcontent-addressed storageへ置き、Ledger eventはimmutable referenceを保持する。
