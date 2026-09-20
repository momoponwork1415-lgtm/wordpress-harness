# 標準エージェントの既知陽性評価 — 2026-09-08

## 結果

2026-09-08時点の旧workflowでは、wp2shell型Prompt、pinned WordPress source、provider-native Root / subagentを使い、評価用known-positive 4件すべてでCandidateを回収し、当時のfresh source-only stageでも4件を支持した。これは当時の4/4 source-level recoveryであり、未知脆弱性のrecall、最新版での残存またはsubmission readinessを意味しない。このsource-only stageは[ADR 0135](../adr/0135-promote-candidates-through-runtime-verification.md)で廃止され、現行workflowの昇格条件はfresh Candidate Verificationの`runtime-confirmed`である。

![Known-positive 4件のstage別評価](../visuals/known-positive-evaluation.svg)

現行production Human OSにはFinding-bound Private Recipeのsingle replayとWordPress / MySQL labが接続されている。TranslatePress 3.3.1 ATOはfresh labでruntime-confirmedした。ResearchからRecipe保存への自動handoffと、companion plugin / site-content fixture解決は未接続であるため、全4件のE2E接続を示すものではない。

## 公開事例

| Target | 公開記録 | 当時のsource-only確認 | 動的観測 |
| --- | --- | --- | --- |
| Brizy 2.8.11 Stored XSS | [CVE-2026-5324](https://www.cve.org/CVERecord?id=CVE-2026-5324) | 成立 | browser canaryを観測 |
| Simply Schedule Appointments 1.6.9.29 SQLi | [CVE-2026-3658](https://www.cve.org/CVERecord?id=CVE-2026-3658) | 成立 | database readback canaryを観測 |
| TranslatePress 3.3.1 ATO | [CVE-2026-19632](https://www.cve.org/CVERecord?id=CVE-2026-19632) | 成立 | fresh Recipe実行でaccount controlを観測 |

残る一件は対応するpublic CVE recordを確認できていないため、[ADR 0115](../adr/0115-publish-only-public-cve-experiment-results.md)に従いTarget、version、mechanismをGitへ記録しない。探索中に得た既知identity以外のcandidateも、新規性、runtime effect、最新版での残存を確認するまでこの評価へ含めない。
