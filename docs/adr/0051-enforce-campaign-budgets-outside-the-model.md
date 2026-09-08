---
status: accepted
---

# Enforce Campaign budgets outside the model

Campaign Inputはnative run数、wall time、推定costのhard ceilingを持ち、Harnessがdurable Receiptの実測消費から残量を判定する。provider usageとtokenは取得できる場合にtelemetryとして保存する。agentの自己申告またはprompt instructionを強制手段にせず、ceiling到達時は新しいrunを開始せずCampaignを`incomplete`にする。具体値はboundedなinstrumented pilotからcalibrateする。

現在はcost最小化よりhigh-impact recallを優先し、Budgetは暴走防止のhard ceilingとして扱う。継続と停止はAIが判断し、Harnessはrun数やphaseを研究手順として固定しない。
