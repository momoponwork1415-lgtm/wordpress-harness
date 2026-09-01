---
status: accepted
---

# Use a current production-like canonical runtime

canonical runtimeはCampaign開始時点のlatest stable WordPressと、対象pluginがsupportする一般的なproduction PHP/MySQL構成から選び、versionとimage digestを固定する。pluginのminimum WordPress/PHP versionを基準環境にはせず、version依存Hypothesisを検証する追加runtimeとしてだけ使う。初期scopeを現行productionで成立する重大経路へ集中させるためである。
