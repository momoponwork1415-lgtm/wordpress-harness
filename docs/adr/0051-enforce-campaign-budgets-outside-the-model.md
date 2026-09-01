---
status: accepted
---

# Enforce Campaign budgets outside the model

Campaign Specはwall time、concurrent worker数、Attempt数、Work Wave数のhard ceilingを必須とし、orchestratorがResearch Ledgerの実測消費から各Work Leaseへ残量を割り当てる。provider usage、token、subscriptionの推定金額は取得できる場合のtelemetryとし、providerが信頼できるusage ceilingを公開する場合だけ追加のhard ceilingにできる。workerの自己申告またはprompt instructionを強制手段にせず、ceiling到達時は新規leaseを停止してCampaignをIncompleteにする。具体値はboundedなinstrumented pilotからcalibrateする。検証予約と後続Campaignの詳細は[ADR 0094](0094-reserve-verification-budget-and-never-extend-campaigns.md)に記録する。
