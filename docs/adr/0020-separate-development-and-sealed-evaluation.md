---
status: accepted
---

# Separate development and sealed evaluation cohorts

oracle既知Caseを小さなDevelopment CohortとSealed Evaluation Cohortに分ける。Developmentは安全性、contract、明白な回帰の日常smoke testに使い、Sealedはglobal Knowledge、static rule、重要なpolicyなど自己強化riskの高い変更のみに使う。そのoracle、vulnerable/patched role、期待routeはworkerと開発loopから隔離し、広範なbenchmark完了を実戦Campaign開始のgateにしない。
