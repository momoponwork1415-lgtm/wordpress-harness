# 開発手順

この案内は[開発規則](../../AGENTS.md)の運用手順である。有限な作業と受入条件は[GitHub Issues](issue-tracker.md)、現在の担当Module・Interface・振る舞いテストは[コードベース案内](../CODEBASE-GUIDE.md)を正本にする。

## 一件の変更を進める

1. Issueの受入条件と最新commentを読み、作業中の差分と`origin/main`から到達できる変更を分ける。コードベース案内から担当Moduleと公開Interfaceを選び、関係する用語集とADRだけを読む。
2. 人間が決める必要のある論点を対話でグリルする。AIが調査できる事実を先に調べ、選択肢と実物を見なければ判断できない事項を示す。人間のレビューと決定をIssueへ記録し、担当、Interface、所有する状態・成果物、失敗時の意味、受入シナリオを固める。
3. 合意した受入シナリオから、公開Interfaceで観測するテスト観点を作る。正常系、反例、失敗時の意味、安全上の不変条件、必要な実環境確認を区別する。実装の内部呼び出し順や保存行を期待値にしない。
4. 実装前に、別セッションのAIまたは別モデルへIssueの決定とテスト観点を渡す。独立レビューで不足・矛盾・実装への過度な結合を指摘させ、観点を修正する。レビューの結果と残る限界をIssueへ記録する。
5. レビューを通したら、クラウドのセッションまたは監視できるローカルのセッションで一つの縦断的な変更を実装する。ローカルでは各変更単位の進捗、差分、テスト結果と失敗を定期的に確認する。新しい振る舞いは可能な限りred → greenで進める。
6. `pnpm check`を通し、Issueの受入条件と[開発規則](../../AGENTS.md)に対して差分を確認する。PRのCIと人間による最終差分レビューを経て統合する。Issueをcloseするのは受入条件を満たす変更が統合された後とし、CI成功だけを実対象での動的検証と扱わない。

## Matt Pocockスキルの使い分け

スキルは作業に必要なものだけ使う。外部スキルの更新はリポジトリの規則や受入条件を変更しない。用語集のファイル名は[ドメイン文書](domain.md)の対応に従う。

| 状況 | 使うスキル | このリポジトリでの成果物 |
| --- | --- | --- |
| 新しいIssueを評価する | `/triage` | [既定の役割](triage-labels.md)を付けたGitHub Issue |
| 論点が大きく、複数回の判断が必要 | `/wayfinder`、必要に応じて`/grilling` | GitHubのmap Issueと決定ticket |
| 仕様をまとめる、または実装単位へ分ける | `/to-spec`、`/to-tickets` | 受入条件を持つGitHub Issueとnative dependency |
| 用語や取り消しにくい判断を確定する | `/domain-modeling` | 担当`CONTEXT.md`、必要な場合だけADR |
| ModuleのInterfaceやseamを見直す | `/codebase-design` | 設計判断と対応するIssue・Codebase Guide |
| 受入条件が決まった振る舞いを実装する | `/implement`、必要に応じて`/tdd` | 公開Interfaceの振る舞いテストと実装 |
| 難しい不具合を診断する | `/diagnosing-bugs` | 再現条件、原因、回帰テスト、修正 |
| 固定した差分をレビューする | `/code-review` | 規則とIssue受入条件の二軸の指摘 |

`/setup-matt-pocock-skills`の初期設定は完了している。Issue tracker、triage label、ドメイン文書の配置を変更するときだけ設定を見直す。通常の変更で再実行して`CONTEXT.md`を別名の用語集へ置き換えない。

## CIが確認する範囲

[Check workflow](../../.github/workflows/check.yml)はPRと`main`へのpushでNode 22・24それぞれに`pnpm install --frozen-lockfile`と`pnpm check`を実行する。書式、型、振る舞いテスト、build、文書リンクを確認する。

[Security workflow](../../.github/workflows/security.yml)はPRの依存差分、ルートのpnpm lockfileとDeepSeekイメージのnpm lockfileに含まれるhigh以上の既知脆弱性、TypeScriptとGitHub Actions workflowのCodeQL解析を確認する。依存監査とCodeQLは週次でも実行する。検出結果は人間がトリアージし、無検出を安全性の証明と扱わない。

Docker・gVisorの実統合テストは専用環境の前提が必要で、通常CIでは2件がskipされる。`HARNESS_RUN_DOCKER_INTEGRATION=1`を通常runnerへ単に設定しない。実対象での探索再現率、使い捨てLabでの発火、プログラム対象範囲、外部提出の承認もCIの成功からは導けない。
