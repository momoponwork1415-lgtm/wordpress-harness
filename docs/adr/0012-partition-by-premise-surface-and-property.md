---
status: accepted
---

# Partition by attacker premise, surface, and security property

Focus Areaはfileまたはvulnerability classで均等分割せず、`Permitted Attacker × WordPress surface × security property`の組で定義する。workerはrouteを閉じるためにFocus Area外のcallee、guard、storage、reader、dependencyを追えるが、Hypothesisとcoverage claimの所有権は一つのFocus Areaに残す。これによりcross-file reasoningを妨げず、同一の浅いbugへ並列workerが収束する重複を減らす。
