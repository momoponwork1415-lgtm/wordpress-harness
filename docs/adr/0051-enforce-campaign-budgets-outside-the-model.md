---
status: accepted
---

# Enforce Campaign budgets outside the model

Campaign Specはwall time、provider usage/cost、concurrent worker数、Attempt数のhard ceilingを必須とし、orchestratorがResearch Ledgerの実測消費から各Work Leaseへ残量を割り当てる。workerの自己申告またはprompt instructionを強制手段にせず、ceiling到達時は新規leaseを停止してCampaignをIncompleteにする。具体値はboundedなinstrumented pilotからcalibrateする。
