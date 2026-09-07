---
status: accepted; Work Lease and Work Wave dimensions superseded by ADR 0125
---

# Enforce Campaign budgets outside the model

Campaign Specはwall time、concurrent worker数、Attempt数、Work Wave数のhard ceilingを必須とし、orchestratorがResearch Ledgerの実測消費から各Work Leaseへ残量を割り当てる。provider usage、token、subscriptionの推定金額は取得できる場合のtelemetryとし、providerが信頼できるusage ceilingを公開する場合だけ追加のhard ceilingにできる。workerの自己申告またはprompt instructionを強制手段にせず、ceiling到達時は新規leaseを停止してCampaignをIncompleteにする。具体値はboundedなinstrumented pilotからcalibrateする。

現在はcost最小化よりhigh-impact recallを優先し、budgetは暴走防止のhard ceilingとして扱う。通常WaveとDepthの停止・追加投資policyは[ADR 0117](0117-optimize-for-high-impact-semantic-recall.md)を参照する。
