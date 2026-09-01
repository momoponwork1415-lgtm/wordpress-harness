---
status: accepted
---

# Store transcripts but do not use them as handoffs

すべてのworkerについてraw provider transcript、tool call、usage、runtime receiptをprivate content-addressed storageへ保存し、Research Ledgerから参照する。ただしmodule、stage、Attempt、Work Wave間の受け渡しにはResearch Ledgerの正規化projection、Evidence Route、Target-bound Route Fragment等の型付きartifactだけを使い、transcriptを入力contextまたはVerification evidenceとして渡さない。次Waveのworkerも過去workerのconversationまたはscratchを読まない。transcriptはfailure analysis、Lesson Proposal、cost auditの資料でありCampaign stateの正本ではない。
