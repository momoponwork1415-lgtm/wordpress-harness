---
status: accepted
---

# Retain known duplicates and incomplete work

既知脆弱性との重複は、対象plugin、affected versionの重なり、root cause、attacker-controlled primitive、破壊されるsecurity propertyで判定し、class名、file、sink、CVE titleだけで判定しない。重複したFindingも独立実証と共に保持するが、`known-duplicate`として外部提出候補とprospective novelty metricから除外する。また、事前検査が判定不能、予算不足、tool・runtime・provider不足で未検証のHypothesisを残したCampaignは未完了とし、未選択項目を失効または「脆弱性なし」に読み替えない。
