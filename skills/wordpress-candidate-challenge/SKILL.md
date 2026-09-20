---
name: wordpress-candidate-challenge
description: "Candidate Verificationの前にHuman Candidate Reviewとして、WordPressのResearch Candidateを人間と対話しながら反証する。攻撃者位置、通常構成、source closure、影響上限、プログラム除外、反証証拠を確認する。探索、検証、再現、修正、外部開示は行わない。"
---

# WordPress候補への反証質問

sourceに結び付いた一つのResearch Candidateについて、人間がCandidate Verificationへ進めるか、Researchへ戻すか、保留するかを判断できるようにする。これは監督付きのworkflow gateであり、技術的な最終判定でも外部行動の承認でもない。

`wordpress-harness`では、`AGENTS.md`と`docs/CODEBASE-GUIDE.md`のResearch Campaigns節を読む。Human Candidate Reviewで採用されたCandidateだけをfreshなCandidate Verificationへ渡し、`runtime-confirmed`だけがVerified Vulnerabilityを作れるという規則を維持する。

## 入力

候補に結び付いた最小限の情報だけを使う。

- 正確なTarget identity、version、digest
- Candidateの攻撃者前提、壊れたsecurity property、claim、source evidence
- 短いCampaign Threat ContextとProgramme Research Boundary
- 正確なWordPress coreと連携source closureの参照
- Candidateに既に記録された重要な不確実性

Target Selection Record、既知脆弱性名、PoC、patch、過去開示の影響ファイル・関数、advisory本文など、答えを先に与える履歴を要求・使用しない。研究者tierとactive installs条件はTarget Intelligenceが扱う。

claimを理解するためのsource closureまたは証拠が欠けていれば、その不足を示す。記憶やadvisoryで補わない。

## Claimを反証する

最短で完全なattack claimを言い直し、それが誤りまたは対象外になり得る最も強い理由を探す。

- 実際にはContributor、Author、Editor、Shop Manager、Administrator、`unfiltered_html`など通常でない権限が必要
- 通常でない、または安全でない設定が必要
- WordPress coreまたは必須の連携製品が、壊れているとされたpropertyを保証する
- 攻撃者の制御、到達可能性、永続性、セキュリティ上の効果がclaimより弱い
- sourceが支持する最大効果が明示的な対象外、対象外資産だけに属する、または機密性・完全性・可用性への直接影響を欠く
- 連携sourceまたはcomponent間の前提が欠けている

利用側が管理者画面だからという理由だけで棄却しない。公開入力や低権限入力が権限の高いworkflowへ届くこと自体が重要なtrust boundaryになり得る。完全な高影響結果へRCE escalationを要求しない。

残る決定的な不確実性について、人間へ短く具体的な質問を1〜3件だけ行う。回答がdispositionを変える場合だけ反復する。一般的な自信ではなく、最も強い反証を示す。

## Disposition

次の一つだけを推奨し、人間の明示判断を待つ。

- `advance-to-candidate-verification`: 明白な反証仮説が解消され、Candidate-bound recipeとfresh runtimeで検証する価値がある。
- `return-to-research`: sourceに結び付いた具体的な質問とsource pointerを示す。脆弱性種類や全面再scanは指定しない。

Programme scopeをこのReviewで先取りしない。技術的に検証する価値があるCandidateは、全programmeで対象外の可能性があってもCandidate Verificationへ進める。scopeは`runtime-confirmed`後にHuman OSが全configured programmeについて評価する。

どのdispositionでもCandidateと理由を保持する。`runtime-confirmed`、`contradicted`、`incomplete`を出さない。それらはCandidate Verificationが所有する。対応する後続workflowと承認なしに、実行時検証、修正、vendor連絡、外部提出を開始しない。

## 人間向けの結果

次を簡潔に示す。

- Candidateと最短で完全なclaim
- 最も強い反証
- source evidenceで既に解決したこと
- 決定的な未解決質問
- 推奨dispositionと理由
- 人間への明示判断の依頼
