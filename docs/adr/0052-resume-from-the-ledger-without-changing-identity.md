---
status: accepted
---

# Resume from the Ledger without changing Campaign identity

crashまたはprocess restart後は同じResearch Ledgerをreplayし、completed Work Leaseを再実行せず、in-flight leaseだけを新しいAttempt IDで再割当する。Target Snapshot、Prompt Set、Model Profile、Knowledge Capsule、Campaign budget envelopeをresume中に変更せず、different modelへのsilent fallbackを行わない。入力またはpolicy変更が必要なら新Campaignまたはversioned iterationとして開始する。
