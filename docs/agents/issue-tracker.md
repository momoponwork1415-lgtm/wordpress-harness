# Issue管理: GitHub

このrepositoryのIssueと仕様はGitHub Issuesを正本とし、すべて`gh` CLIで操作する。

## Repositoryで利用できる機能

2026-09-04の確認時点で、次の機能を利用できる。

- native sub-issue（`repos/:owner/:repo/issues/:n/sub_issues`）
- native issue dependency（`issue_dependencies_summary`）

そのため、task listによる子Issue表現や、Issue本文の`Blocked by:`による代替表現は通常使わない。

## 記述言語

- Issueのタイトル、目的、観測事実、必要な動作、受入条件、通常のcommentは日本語で書く。
- 契約名、schema field、状態値、CLI、コード識別子、path、provider固有機能など、実装や外部仕様と照合する語は英語のまま残す。
- 既存の英語Issueを更新するときは、意味・受入条件・label・依存関係を変えずに日本語化する。
- 外部から引用する英文は必要な範囲だけ残し、日本語で要点を説明する。

## 基本操作

- **作成:** `gh issue create --title "..." --body "..."`
- **参照:** `gh issue view <number> --comments`。commentとlabelも確認する。
- **一覧:** `gh issue list --state open --json number,title,body,labels,comments`へ、必要な`--label`と`--state`を指定する。
- **comment:** `gh issue comment <number> --body "..."`
- **labelの追加・削除:** `gh issue edit <number> --add-label "..."` / `--remove-label "..."`
- **close:** `gh issue close <number> --comment "..."`

repositoryは`git remote -v`から判断する。clone内で実行する`gh`は通常これを自動で解決する。

## Pull Requestを依頼受付として使うか

外部Pull Requestを依頼受付としては使わない。将来この方針を変える場合だけ、外部PRをIssueと同じtriage対象にする。

GitHubではIssueとPull Requestが同じ番号空間を使う。`#42`だけでは区別できない場合、`gh pr view 42`を試し、該当しなければ`gh issue view 42`を使う。

## SkillからIssue操作を求められた場合

- 「Issue trackerへ公開する」はGitHub Issueを作る。
- 「関連ticketを取得する」は`gh issue view <number> --comments`を実行する。

## 実装状態とIssue状態を一致させる

- 編集・close前に受入条件と最新commentを読み、現在の公開InterfaceとBehavior Testへ照合する。
- working treeの変更、local commit、GitHub default branchから到達できるcommitを区別する。localだけの作業を公開済み・merge済みと説明しない。
- 実装Issueは、受入条件を満たし統合証拠がある場合だけcloseする。支持commitを示し、どのrevisionを試験したかを正確に記録する。
- 一部だけ完了したIssueはopenのままにし、残る受入条件を本文へ記録する。子Issueの完了を親Issueの完了とみなさない。source-onlyの結果をruntime verification成立とみなさない。
- 実装状態はCodebase Guide、有限作業はIssueへ置く。重複roadmapや日付付きstatus文書を作らず、既存の対応表とnative relationshipを更新する。
- 過去commentは保持する。「未commit」など古くなった主張は書き換えず、現在の証拠を新しいcommentで補足する。

## Wayfinding操作

`/wayfinder`を使う場合、単一のmap Issueと、そのnative sub-issueを使う。

- **Map:** `wayfinder:map` labelを持つ単一Issue。Notes / Decisions-so-far / Fogを本文に置く。
- **子ticket:** mapへnative sub-issueとして接続し、`wayfinder:<type>`（`research` / `prototype` / `grilling` / `task`）labelを付ける。担当開始時に`gh issue edit <n> --add-assignee @me`でclaimする。
- **Blocking:** GitHubのnative issue dependencyを正本にする。`repos/<owner>/<repo>/issues/<child>/dependencies/blocked_by`へ、blockerのdatabase IDを送る。`#number`や`node_id`ではない。
- **次の作業:** mapのopenな子Issueから、open blockerまたはassigneeがあるものを除き、map順で最初のものを選ぶ。
- **完了:** Issueへ結果をcommentしてcloseし、mapのDecisions-so-farへcontext pointerを追記する。

native sub-issueまたはdependencyが利用できないrepositoryだけ、task listや`Blocked by:`を代替として使う。
