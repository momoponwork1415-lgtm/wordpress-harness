---
status: accepted
---

# Store the Ledger in SQLite and evidence in a CAS

Research Ledgerの正本は、single-writer SQLite database内のappend-only event tableとする。Campaignの状態変更、Work Lease、budget reservation、Attempt outcomeはtransactionで追記し、既存eventをUPDATEまたはDELETEしない。status、queue、reportなどのprojectionはLedgerから再構築できるcacheとして扱う。

大きなsource excerpt、model transcript、tool receipt、browser trace、runtime evidenceはdatabase payloadへ埋め込まず、Git外のprivate content-addressed artifact storeへ保存する。artifactをdurableかつ原子的に保存してdigestを確定した後、その参照をeventへ追記する。保存後かつevent追記前のcrashで生じた未参照artifactはCampaign stateではなく、後の安全なgarbage collection対象とする。

初期版はsingle-host、single Campaign writerを前提とする。multi-host database、message broker、汎用repository abstractionは実需要が生じるまで導入しない。TypeScriptから利用するSQLite driverは、transaction、busy handling、backup、Nodeの対応versionを満たす成熟した実装を選び、experimental APIへ設計を依存させない。
