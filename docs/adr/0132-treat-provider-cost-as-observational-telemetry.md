---
status: accepted
supersedes: 0051
---

# Treat provider cost as observational telemetry

Campaign Inputから推定US dollar cost ceilingを除去する。providerが返した`estimatedCostUsd`はNative Receiptへ観測値として保存するが、Harnessは`$25`等の閾値でResearch、Human ReviewまたはIndependent Validationを停止しない。停止の外部hard limitはNative Run数とwall timeだけとする。各Research Grantへ独立したwall-time allowanceを与える部分は、[ADR 0143](0143-continue-research-without-per-run-human-review.md)により、Campaign全体の残り時間を各Native Runへ与える方式へ置き換えられた。

Provider自身がbudget errorを返した場合は、そのterminal分類を失わず`budget-exhausted`として記録する。usage limitは[ADR 0133](0133-separate-provider-account-conditions-from-provider-defects.md)に従い`provider-quota-exhausted`として区別する。これはHarnessがcost ceilingを設定したことを意味しない。代償としてHarness単独では請求額の上限を保証しないため、costは運用telemetryとprovider側controlで監視する。high-impact recallを下げるcost最適化は、baseline後のablationでのみ採用する。
