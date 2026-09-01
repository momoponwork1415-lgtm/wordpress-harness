---
status: accepted
---

# Start with one active Campaign and versioned canaries

早期の実戦運用はactive Campaignを全systemで1件に限定するが、同Campaign内の重複しないWork Leaseは並列実行する。Campaign evidenceから作る改善は進行中Campaignへ反映せず、versionを上げた試験投入版として次の少数Campaignだけに適用する。通常のprompt・priority変更は小さなDevelopment smokeを、static rule・誤検出除外policy・global Knowledgeは自己強化riskが高いため追加で小さなSealed Evaluationを通す。これにより、実戦投入を遅らせず、同時実行と無検証な自己書き換えが原因の因果不明を防ぐ。
