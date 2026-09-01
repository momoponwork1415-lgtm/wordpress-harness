# Development Harness

Status: proposed, 2026-09-01

## Purpose

Development Harnessは、productionのResearch Harnessを作る人間とcoding agentが、同じ規則、同じcommand、同じ観測可能な合格条件で変更を検査するための開発用仕組みである。製品のCampaign、Model Execution、Verification Lab、Research Ledgerには含めない。

この設計では、`openai/codex-security`を製品architectureの第4設計参照にせず、TypeScript security toolを継続開発するためのリファレンス実装としてだけ比較する。調査結果は[Codex Security development-harness reference](../research/codex-security-development-harness-reference.md)に分けて記録する。人間がAI開発のcodebaseを把握し続ける方法と、他repositoryのHarness比較は[AI-navigable codebase specification reference](../research/ai-navigable-codebase-specification-reference.md)に記録する。

## One small interface

日常的な合格判定のinterfaceは次の二つに限定する。

```text
pnpm check                 # commit可能かを決める、offlineで決定的な全体gate
pnpm test -- <test-path>   # red-green中のfocused test
```

`pnpm check`の内部順序、formatter、link checker、test runner、compilerはimplementation detailとする。GitHub Actionsは独自の判定を再実装せず、fresh checkoutで同じ`pnpm check`を呼ぶCI Adapterである。

依存脆弱性databaseの取得、live credential、model login、container registry、WordPress.org、Wordfence API等のnetwork依存checkを`pnpm check`へ入れない。offline gateを外部障害で不安定にせず、networkを必要とするsecurity checkは別の明示commandまたはscheduled CIが必要になった時点で設計する。

## Five parts

### 1. Developer Contract

`AGENTS.md`がrepository全体の長期規則を所有する。次を規則として維持する。

- 一変更につき一つの観測可能なbehaviorまたは文書判断
- public CLIのcommand、argument、flag、accepted value、environment variable、defaultは互換性を持つinterface
- testはinterfaceから結果、failure、cancellation、cleanupを観測する
- fixtureは合成データを使い、private target、未公開Finding、credentialをGitHub Issue、PR、testへ入れない
- concrete failureのないsanitization、fallback、limit、abstractionを追加しない
- optionalなlog、progress、telemetry failureで主処理を失敗させない

Contributor向けに別文書が必要になるまでは、`CONTRIBUTING.md`へ同じ規則を複製しない。実際に外部contributorまたは複数の定常workflowが生じた時に追加する。

### 2. Local Quality Gate

`pnpm check`は次を一つの順序で実行する。

1. `format:check`: authored TypeScript、JavaScript、JSON、YAMLの決定的なformat検査
2. `typecheck`: strict TypeScript検査
3. `test`: interfaceから観測するbehavior test
4. `build`: distribution buildがsource/test設定から独立して成功すること
5. `docs:check`: repository-owned Markdownの相対linkと、Context termの日本語早見表対応を検査する

最初のformatterはPrettier一つとし、同じ役割のESLint、Biome、dprintを重ねない。TypeScript compilerで表現できない、実在する繰り返しfailureが出るまでESLintを追加しない。大量の既存ADRを機械的に再formatすることを最初の導入条件にせず、初期format scopeはauthored codeと機械可読設定に限定する。

`docs:check`はtarget plugin、dependency vendor、generated outputを走査しない。repository自身が所有する文書だけを対象とし、外部vendor文書の壊れたlinkをこちらのfailureにしない。

### 3. Test Harness

Vitestを継続し、production abstractionをtestのためだけに増やさない。

- pure decisionは同じinputから同じoutputとstable orderingを検査する
- SQLiteのreopen、locking、migration、crash境界は実file-backed temporary databaseで検査する
- filesystemとprocess境界は実temporary directoryと制御したtest subprocessで検査する
- Model Transportはlive credentialを使わず、成功、invalid schema、timeout、crash、auth-required、process-tree cleanupをscripted process fixtureで再現する
- example-based regression testを読みやすい正本とし、意味のある不変条件が見つかった場合だけproperty testを追加する
- test終了時にprocess、timer、environment、cwd、file、database handleを元へ戻す

coverage percentageは当初gateにしない。重要なinterface scenarioの欠落をcoverage数値で置き換えない。

### 4. CI Adapter

最初のGitHub Actions workflowはUbuntu上の一jobだけとする。

1. 最小のread-only permissionでcheckoutする
2. repositoryの`packageManager`へ固定したpnpmとNode 22を使う
3. `pnpm install --frozen-lockfile`を実行する
4. `pnpm check`を実行する

Action dependencyはtagだけでなくfull commit SHAへ固定し、対応するrelease versionをcommentに残す。job timeoutとconcurrency cancellationを設定する。CI専用のtest分岐、変更fileだけのskip、sharding、cache tuningは最初に入れない。

### 5. Human Comprehension Map

[Module Map](module-map.md)をコード詳細なしで機能を理解する視覚的な入口、[Codebase Guide](../CODEBASE-GUIDE.md)を現在の実装を短時間で再構成する索引とする。Guideは詳細仕様を再記述せず、次だけをModule単位で結び付ける。

- production status
- public Interface
- 主な実装場所
- Interfaceから観測するBehavior Test
- 正本となるSeam文書

読む順序は`Module Map -> Codebase Guide -> current Issue -> one Seam -> Behavior Test`とし、Module architecture全体と全ADRの通読を通常作業の前提にしない。ADRは理由を調べる索引の末端であり、記憶対象ではない。

Interface、ownership、status、主なpath、Testの対応が変わるproduction変更ではGuideも同じ変更で更新する。`docs:check`は少なくともGuide内のrepository pathとrelative linkが存在することを検査する。semanticなModule対応は自動生成せずreviewで確認する。file一覧から生成した巨大なwikiは、重要度を表現できず人間の入口を再び増やすため採用しない。

Issueは今回の変更範囲と受入条件を所有する一時的な仕様であり、長期的なdomain definitionやModule contractを複製しない。Issueで決まった長期事実は、codeへ入る同じ変更で`CONTEXT.md`、Seam、またはADRのうち一つの正本へ反映する。

## Current baseline

既に次が存在する。

- strict TypeScriptと`noUncheckedIndexedAccess`、`exactOptionalPropertyTypes`、`useUnknownInCatchVariables`
- `pnpm check`によるtypecheck、17 behavior tests、build
- real temporary SQLite、filesystem、PHP helperを使うtest
- architecture、TDD、security、Git運用を定めた`AGENTS.md`
- 現在のInterface、実装、Test、Seamを結ぶ`Codebase Guide`
- local hookによるgitleaks、test、Trivy

不足しているのは、format gate、repository-owned docs check、versioned GitHub CIである。Codebase Guideは現時点では人間が保守するliving mapであり、path/link driftの自動検査はdocs checkの実装後に有効になる。local hookは開発機固有であり、fresh cloneの合格条件には数えない。また現行Trivy hookは結果にかかわらずpushを継続するため、blocking security gateとは呼ばない。

## Deferred until observed need

- macOS、Windows、複数Node versionのmatrix
- test shardingとduration balancing
- mutation testing
- coverage floor
- devcontainerとcontainer release pipeline
- package archive、npm provenance、release automation
- PR title validatorとrelease label automation
- test専用database abstractionまたはin-memory repository layer
- security scannerを複数重ねること

Model ExecutionでOS固有のprocess cleanup failureが観測された場合は該当OS laneを追加する。test時間がCI budgetを超えた場合だけshardingを追加する。公開packageを配布する判断ができた場合だけpackage/release harnessを設計する。

## Acceptance scenarios

1. fresh checkoutで`corepack`、Node 22、lockfileだけからinstallし、`pnpm check`が成功する。
2. formatting差分、TypeScript error、behavior regression、build failure、repository-owned broken linkのいずれか一つで`pnpm check`がnon-zeroになる。
3. `pnpm check`はnetwork credential、model login、target code executionを要求しない。
4. GitHub Actionsとlocal shellが同じ`pnpm check`を呼び、CIだけの合格経路を持たない。
5. focused testは全suiteを動かさず、一つのred-green sliceを再現できる。
6. private source、未公開Finding、credentialをfixtureまたはCI artifactへ含めない。

## First implementation slices

1. Developer Contractへpublic CLI互換性、合成fixture、推測上の防御を増やさない規則を不足分だけ追記する。
2. Prettierとrepository-owned `docs:check`を追加し、`pnpm check`から実行する。Codebase Guide内のrepository linkも検査する。
3. 一つのUbuntu GitHub Actions jobを追加し、fresh checkoutで同じgateを実行する。
4. 実装Issue #1を開始し、Module treeとCodebase Guideの対応を同じ変更で更新する。
5. 実際に人間が迷った経路だけをGuideへ追加し、file単位の自動wikiへ拡張しない。

この順序はproduction moduleの設計gateを置き換えない。Development Harnessがgreenでも、未承認のproduction seamを実装してよいことにはならない。
