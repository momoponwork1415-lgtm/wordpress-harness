---
name: wordpress-candidate-challenge
description: "Independent Validationの前、または実行時検証の前に、WordPressのResearch Candidateを人間と対話しながら反証する。攻撃者位置、通常構成、source closure、影響上限、プログラム除外、反証証拠を確認する。探索、検証、再現、修正、外部開示は行わない。"
---

# WordPress候補への反証質問

sourceに結び付いた一つのResearch Candidateについて、人間がIndependent Validationへ進めるか、Researchへ戻すか、保留するかを判断できるようにする。これは監督付きのworkflow gateであり、技術的な最終判定でも外部行動の承認でもない。

`wordpress-harness`では、`AGENTS.md`と`docs/CODEBASE-GUIDE.md`のResearch Campaigns節を読む。新しいIndependent Validationだけがsource-validated Findingを作れるという規則を維持する。

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

- `advance-to-independent-validation`: 明白な反証仮説が解消され、新しいvalidatorに十分なsource closureがある。
- `return-to-research`: sourceに結び付いた具体的な質問とsource pointerを示す。脆弱性種類や全面再scanは指定しない。
- `park-programme-oos`: sourceが支持する最大効果が対象外で、対象内へつながる具体的な経路が残らない。
- `hold-scope-ambiguous`: プログラム上の意味または必要な外部事実が未解決。

どのdispositionでもCandidateと理由を保持する。`source-validated`や`disproven`を出さない。それらはIndependent Validationが所有する。対応する後続workflowと承認なしに、Validation、実行時再現、修正、vendor連絡、外部提出を開始しない。

既にvalidation済みのCandidateへ適用する場合は`retrospective`と表示し、validation recordを書き換えない。`advance-to-independent-validation`を`advance-to-runtime-verification`へ置き換え、他のdispositionは維持する。

## 人間向けの結果

次を簡潔に示す。

- Candidateと最短で完全なclaim
- 最も強い反証
- source evidenceで既に解決したこと
- 決定的な未解決質問
- 推奨dispositionと理由
- 人間への明示判断の依頼
