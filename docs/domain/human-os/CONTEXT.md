# Human OS Context

Human OSはsource-validated Findingへfresh runtime / human assuranceを追記し、提出Draftと外部行動の人間承認を管理するBounded Contextである。

## Boundary

Human OSはTarget選定、Research探索、source ValidationまたはFinding生成を所有しない。Research storageを直接更新せず、Finding handoffだけを受け取る。外部Submitは実行しない。

## Ubiquitous language

**Finding Handoff**
: Researchのfresh Independent Validationが生成したimmutable `source-validated-finding`。

**Isolated Environment**
: FindingのTarget Snapshotとruntime profile digestへbindしたfresh、disposable、runsc-backed environment identity。host Target execution、ambient credential、arbitrary network、fallbackを許さない。

**AI Reproduction Record**
: AIが一つのIsolated Environmentで行ったruntime observationとPrivate Evidence reference。source Findingを上書きしない。

**Human Verification Record**
: 人間がAI reproductionとは別のfresh environmentで確認した`human-confirmed / human-disproved / human-incomplete`のobservation。

**Private Evidence Reference**
: exact request、payload、screenshot、runtime log等をGit外のbundleへ結ぶdigest reference。

**Submission Draft**
: Findingに対するAIまたは人間作成のversioned report text。revisionは1から連続し、内容digestを持つ。

**External Action Authorization**
: 人間がexact Draft digestとdestinationへbindして与える許可。一般的な「提出してよい」許可ではない。

**External Action Admission**
: human-confirmed verification、Draft存在、exact authorizationの三条件を検査するread decision。実送信ではない。

**Evidence Request**
: runtime / human確認で見つかった具体的proof gapを要求するhandoff。外部serviceならservice名、sandbox-onlyの最小権限、人間が判断するsetup、検証目標を持つ。既存Findingを変更しない。

## Invariants

- source-validated Findingだけを受け取る。
- AIとhuman verificationは異なるfresh environment identityを使う。
- human disprovalまたはruntime failureでもFindingを削除しない。
- provider、setup、Budget、ambiguous observationをdisprovedへ丸めない。
- AIが次の実験と停止を決め、Harnessはclass別recipeや固定Depthを持たない。
- Private EvidenceをGit、Finding、Draftへ展開しない。
- external actionはhuman-confirmed verificationとexact Draft / destination authorizationを要求する。
- AIは理解とDraftを支援できるが、authorizationと最後のSubmitを代行しない。

現在の実装と未接続箇所は[Codebase Guide](../../CODEBASE-GUIDE.md)、Context間の関係は[Context Map](../../../CONTEXT-MAP.md)を参照する。
