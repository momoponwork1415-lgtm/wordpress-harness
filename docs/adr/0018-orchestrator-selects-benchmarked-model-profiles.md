---
status: accepted
---

# Orchestrator selects evidence-backed Model Profiles

workerは自分が使うmodelまたはeffortを選ばず、orchestratorがroleごとのversioned Model Profileを選ぶ。Profileはmodel identity、effort、tool policy、context policy、予算を一体とし、provider capability、小さなBoundary Pair校正、実戦Campaignのprecision、coverage、variance、latency、costに基づいて昇格させる。初期実装は一つのproviderを直接利用し、二つ目の実装が必要になるまで汎用provider adapter frameworkを作らない。
