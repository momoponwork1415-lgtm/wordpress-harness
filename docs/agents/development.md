# 開発手順

この案内は[開発規則](../../AGENTS.md)の運用手順である。有限な作業と受入条件は[GitHub Issues](issue-tracker.md)、現在の担当Module・Interface・振る舞いテストは[コードベース案内](../CODEBASE-GUIDE.md)を正本にする。

## 一件の変更を進める

1. Issueの受入条件と最新commentを読み、作業中の差分と`origin/main`から到達できる変更を分ける。設計が未確定なら担当、公開Interface、所有する状態・成果物、失敗時の意味、受入シナリオを先に決める。
2. コードベース案内から担当Moduleと公開Interfaceを選び、関係する用語集とADRだけを読む。既存設計との不一致があれば、機能追加より先に差分と小さなリファクタリング単位を示す。
3. 新しい振る舞いは公開Interfaceから観測する一つの縦断シナリオを可能な限りred → greenで実装する。テストは内部呼び出し順や保存行を固定しない。
4. `pnpm check`を通し、Issueの受入条件と[開発規則](../../AGENTS.md)に対して差分を確認する。公開CLI、契約、所有権、用語、安全不変条件を変えた場合は、対応するテストと正本文書を同じ変更に含める。
5. PRの`Check / check`を確認する。Issueをcloseするのは受入条件を満たす変更が統合された後とし、localの変更やCI成功だけを実対象での動的検証と扱わない。

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

[Check workflow](../../.github/workflows/check.yml)はPRと`main`へのpushで`pnpm install --frozen-lockfile`と`pnpm check`を実行する。`pnpm check`は書式、型、テスト、build、文書リンクなどを確認する。実対象での探索再現率、使い捨てLabでの発火、プログラム対象範囲、外部提出の承認はCIの成功からは導けない。
