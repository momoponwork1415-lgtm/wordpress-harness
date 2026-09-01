---
status: accepted
---

# Centralize orchestration

単一のdeterministic orchestratorだけがCampaignの状態遷移、Focus AreaのWork Lease、worker数、予算、優先順位、停止判断を所有する。workerはleaseされた一つの目的を処理してartifactを返す短命な実行者とし、別workerへの直接委譲、子agent生成、Campaign状態の更新を許可しない。stage内の並列性を保ちながら、重複fan-outと予算逸脱を一か所で防ぐためである。
