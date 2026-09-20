---
name: wordpress-human-verification
description: "Human Candidate Reviewで採用されたWordPress Candidate Verification Requestについて、正確な人間向け再現URL、認証情報、payload、attack stepを表示する新しい使い捨てLab setup scriptを作る。直接実行できる手動再現に使い、探索、source-only再検証、修正、外部提出には使わない。"
---

# WordPress Human Verification

Candidate Verification Requestとそのprivate recipeに結び付いたreproductionを、人間が実行できる一つのshell scriptにする。使い捨てLabを準備し、実際のruntime値を持つ完全なattack guideを表示し、Labを維持し、EnterまたはCtrl-Cで破棄する。決定的な操作は人間が行う。

`wordpress-harness`では、`AGENTS.md`、`docs/CODEBASE-GUIDE.md`のHuman OS節、現在のCandidate Verification契約を読む。これらを正本とする。

## 必須入力

wizardを次へ結び付ける。

- Human Candidate Reviewで採用された一つのimmutable Candidate Verification Request
- Requestのdigestと一致するCandidate-bound private recipe
- recipeが使うtarget、WordPress、連携製品、imageの正確なversion
- recipeのprecondition、人間のaction、security effect、private evidenceの期待値
- Researchや過去の検証で使っていない新しい使い捨てenvironment identity

binding、recipe本文または正確な手順が欠けていれば`incomplete`で止める。Candidateをsourceから再探索したり、記憶からUI pathを作ったりしない。

## Modeを選ぶ

現在は`setup-and-guide`だけを使う。このmodeではquestionnaire、checkpointごとの案内、screenshot/HAR収集、verdict質問、Human OS record作成を行わない。人間の観測を受け付ける版付きHuman OS seamが実装されるまで、script-local JSONやMarkdownをformal verification recordとして扱わない。

## Lab Guideを作る

[verification wizard template](assets/verification-wizard-template.sh)を使う。RequestのGit除外済みprivate directoryへcopyし、markerより下のCandidate固有部分だけを作る。

生成scriptは次を満たす。

1. `--plan`で副作用のない短い概要を表示する。
2. 非対話の`--setup-check`でbrowser endpointとversion checkまで準備し、決定的な人間操作の前にLabを破棄する。
3. 通常実行は短い安全説明の後に準備を開始する。
4. 対象実行前にsourceとimage bindingを確認する。
5. fallbackなしの新しいgVisor/runsc Labを作る。対象をinternal networkに置き、container portを直接公開せず、upstream固定のloopback reverse proxyから接続する。
6. 通常のfixture stateと低権限accountを自動作成する。
7. reproductionにdefault以外の変更が必要な場合だけplugin設定手順を出す。defaultで足りる場合は`plugin設定変更なし`と表示し、settings page確認を追加しない。
8. setup後、実際のLab URL、直接役立つlogin/action URL、role名付きのLab username/password、正確なpayload、browser profile分離、negative control、決定的なaction、期待するsecurity effectを含む完全な番号付きguideを一度に表示する。
9. 人間がEnterまたはCtrl-Cを押すまで表示とLabを維持し、その後container、volume、network、loopback proxyを破棄する。
10. 決定的な人間操作を自動化しない。

installation、activation、account準備、version checkは自動化する。URLをscriptへ貼り戻させたり、進捗質問へ答えさせたりしない。

## EvidenceとVerdict

正確なpayload、credential、request、screenshot、HAR、logは制限付きpermissionで`.private/`へ置く。credentialを`.env`、shell history、Git、共有用stdout log、外部toolへ書かない。使い捨てLab accountは必要な人間へusername/passwordを直接表示し、private run directoryへ`0600`のcredential fileを一つ保存する。使い捨てでないcredentialは表示・保存しない。

固定された覚えやすいcredentialを人間が求めた場合、新しい使い捨てlocalhost Labだけで使い、Lab専用と表示する。production、共有、永続environmentへ再利用しない。

このskillは`runtime-confirmed`、`contradicted`、`incomplete`を記録しない。これらは版付きCandidate Verification Recordとprivate evidenceを受け付けるHuman OSだけが所有する。setup失敗、binding不一致、操作不足または観測不足を`contradicted`へ読み替えない。

Human confirmationは外部開示を許可しない。利用者が別途workflowを求め、正確な承認を与えない限り、外部報告を作成・承認・送信しない。

## 確認と引き渡し

`bash -n`、利用可能なら`shellcheck`、`--setup-check`を実行する。生成したcredential、payload、URL、cleanup targetを静的に追う。決定的なstepは実行しない。

実行commandを渡し、setup後にすべてのURLとpasswordが表示され、EnterまたはCtrl-CでLabが破棄されると説明する。
