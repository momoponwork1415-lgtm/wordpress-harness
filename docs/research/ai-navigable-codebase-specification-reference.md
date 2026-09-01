# AIが増やすcodebaseを人間が把握し続けるための調査

Status: research note, 2026-09-01

## Scope

この調査はDevelopment Harnessの参考資料であり、製品architectureを正当化する第4の設計参照資料ではない。目的は、AIが短時間に大量のcodeを生成しても、開発者が「どのModuleが何を所有し、どのInterfaceを公開し、どのstateとtestが仕様を固定しているか」を短時間で再構成できる仕組みを選ぶことである。

調査対象はsource ownerが公開する一次資料だけに限定した。Matt Pocock本人の資料は十分に存在し、`CONTEXT.md`、ADR、Spec、Ticket、Seam、TDD、reviewの役割分担まで確認できた。ただし`mattpocock/skills`は完成済みDevelopment Harnessではなく、複数のengineering practiceを配布するrepositoryである。

## 結論

このrepositoryに不足しているのは詳細な仕様書ではなく、詳細へ到達するための一枚のindexである。2026-09-01時点で、`src/`とTypeScript testは約2,000行なのに対し、`README.md`、`AGENTS.md`、Context文書、主要architecture、seam、ADRは合計約3,300行ある。したがって主問題は情報不足より入口過多であり、さらにModule別文書を大量追加すると悪化する。

人間が頭に入れる対象はcode全体ではなく、次の「mental index」に限定する。

1. North Starと三Context
2. Context間の三handoff
3. 各Moduleの一行の責務
4. 各Moduleの公開Interface
5. 所有stateまたはdurable artifact
6. implementation pathとbehavior test path
7. 現在のimplementation status

詳細なinvariant、failure semantics、受入scenarioは必要なModuleのseam文書から読む。ADRは判断理由を疑問に思った時だけ読む。内部関数やcall sequenceはsourceから読む。この順序にすると、常時読む文書を増やさずに仕様を再構成できる。

## 一次資料から得た原則

### 1. Mapを入口にし、manualを入口にしない

OpenAIのagent-firstな大規模開発事例は、巨大な`AGENTS.md`がcontextを圧迫し、重要度を平坦化し、急速に陳腐化したため、短い`AGENTS.md`をtable of contentsとして使い、version管理された`docs/`をsystem of recordにしたと報告している。Design、product spec、active/completed plan、generated referenceを分け、link、構造、freshnessをCIと定期的なdoc gardeningで検査している。[OpenAI, Harness engineering](https://openai.com/index/harness-engineering/)

Matt Pocockの`writing-for-agents`も、always-loaded documentのcontext loadと、人間が「どの文書をいつ読むか」を覚えるcognitive loadを分ける。必要な情報をpointerの背後へ置くprogressive disclosure、single source of truth、重複・堆積・no-opの削除を勧めている。[writing-for-agents](https://github.com/mattpocock/skills/blob/6654f6b60cd9d5be8b54c6fafe44346dabeb3b76/docs/productivity/writing-for-agents.md)

調査開始時点で`AGENTS.md`は80行であり、長さは適切だった。一方、当時の`README.md`のStart hereは同じ粒度のlinkが多く、読む順序と「何を知るための文書か」が弱かった。新しい百科事典を作るのではなく、一枚のCodebase Guideを入口にするのが妥当である。

### 2. Durable specificationとTransient workを分ける

Matt Pocockの`to-spec`は、Specを「context windowをまたぐ決定のsnapshot」と位置付け、Ticketを一つのfresh contextで完了できる使い捨ての実行単位とする。実装で得た長期的知識はSpecを更新し続けるのではなく、`CONTEXT.md`またはADRへ昇格させるとしている。Specはmulti-session workの時だけ作り、single-session changeでは省略する。[to-spec](https://github.com/mattpocock/skills/blob/6654f6b60cd9d5be8b54c6fafe44346dabeb3b76/docs/engineering/to-spec.md)

`to-tickets`はTicketをlayer別作業ではなく、単独で観測できるvertical sliceにし、一つのfresh context windowに収める。各Ticketにはblocking edgeとdemo可能なbehaviorが必要で、広い機械的refactorだけをexpand–migrate–contractの例外としている。[to-tickets](https://github.com/mattpocock/skills/blob/6654f6b60cd9d5be8b54c6fafe44346dabeb3b76/docs/engineering/to-tickets.md)

OpenAIのExecPlanは別の選択肢で、長時間作業を単一文書だけから再開できるself-containedなliving documentとして扱い、progress、discovery、decision logを更新する。[OpenAI Cookbook, ExecPlans](https://github.com/openai/openai-cookbook/blob/main/articles/codex_exec_plans.md) ただしこのrepositoryでは既にGitHub Issueを実装単位にしており、全Ticketに重いExecPlanを追加すると二重管理になる。ExecPlan相当は、複数Ticketにまたがる移行や数時間以上の自律作業でのみ使うべきである。

このrepositoryでdurableにするものとtransientにするものは次のように分ける。

| Artifact | Lifecycle | 正本にする内容 |
| --- | --- | --- |
| `AGENTS.md` | Durable | 全変更へ適用する規則と詳細文書へのpointer |
| `CONTEXT-MAP.md` / `CONTEXT.md` | Durable | Context関係とUbiquitous Language |
| architecture / module architecture | Durable | Context、Module、依存方向、ownership |
| accepted seam文書 | Durable while Interface exists | Interface、invariant、failure、test surface、acceptance scenario |
| behavior test | Durable while behavior exists | 外から観測できる実行可能な仕様 |
| ADR | Durable history | hard-to-reverseで意外なtrade-offの理由 |
| Spec / parent Issue | Transient snapshot | multi-session changeで合意済みのdestinationとout-of-scope |
| implementation Ticket | Transient | 一つのvertical slice、demo、blocker、完了条件 |
| agent plan / scratch | Ephemeral | そのsessionの順序と途中メモ |

### 3. Moduleの仕様はInterfaceとtestへ圧縮する

Matt Pocockの`codebase-design`はInterfaceをtype signatureだけでなく、callerが正しく使うために必要なinvariant、ordering、error、configuration、performanceまで含むものとして定義する。Interfaceをtest surfaceとし、callerとtestが同じSeamを通ること、小さなInterfaceの背後へ複雑さを隠すこと、一つしか実装がない仮想的なAdapter seamを増やさないことを勧める。[codebase-design](https://github.com/mattpocock/skills/blob/6654f6b60cd9d5be8b54c6fafe44346dabeb3b76/docs/engineering/codebase-design.md)

`tdd`はpre-agreed seamで一つのbehaviorをredからgreenへ進め、test名を内部callではなくcapabilityとして書き、expected valueをSpecやworked example等の独立した根拠から得る。内部Moduleのmock、call count、直接database queryへtestを結合しない。[tdd](https://github.com/mattpocock/skills/blob/6654f6b60cd9d5be8b54c6fafe44346dabeb3b76/docs/engineering/tdd.md)

`code-review`はStandardsとSpecを別の軸で確認し、片方の合格で他方の失敗を隠さない。Spec findingはSpecの行、Standards findingはrepository規則またはdiffへ根拠を結び付ける。[code-review](https://github.com/mattpocock/skills/blob/6654f6b60cd9d5be8b54c6fafe44346dabeb3b76/docs/engineering/code-review.md)

Anthropicのreference harnessもsecurity patchについて、文章上の主張よりexecutable witness、既存test、PoCの停止、fresh re-attackを段階的なoracleとして優先する。確認済み脆弱性はregression testへ変換し、CIに残すとしている。[best practices](https://github.com/anthropics/defending-code-reference-harness/blob/d3bea6b5793b5f3d59a75ebe69a58efa88383145/docs/best-practices.md) [patching](https://github.com/anthropics/defending-code-reference-harness/blob/d3bea6b5793b5f3d59a75ebe69a58efa88383145/docs/patching.md)

したがってModuleごとに長い説明を暗記する必要はない。Codebase Guideから公開Interfaceとtestへ到達でき、seam文書とtestが同じbehaviorを指していればよい。

### 4. Architectureは文章だけでなく機械的に守る

OpenAIの大規模agent-first事例では、各domainのlayerと許可されるdependency directionを固定し、custom lintとstructural testで検査している。schema naming、structured logging、file size等も機械化し、lint error自体に修正方法を入れる。[OpenAI, Harness engineering](https://openai.com/index/harness-engineering/)

`openai/codex`の現行`AGENTS.md`は、private Moduleと明示的なpublic crate APIを優先し、通常Moduleを500 LoC未満、800 LoC付近を超えたfileへ新機能を足さない目安としている。また非機械的diffは800 changed lines以下、複雑なlogicは500 lines以下を目安に、超える場合は最小のcoherent stageへ分割する。testは対象crateから始め、shared codeを変えた時だけ全体へ広げる。[openai/codex AGENTS.md](https://github.com/openai/codex/blob/3a04482645b695085f4daf7c6310ab8592653fea/AGENTS.md)

ただしline countはModule設計の代用ではない。無理なfile分割はInterfaceを増やし、逆に人間の把握を難しくする。このrepositoryでは500/800を品質判定ではなく「Module ownershipとTicket分割を再確認するtrigger」として使うのがよい。

import directionとpublic exportは、Issue #1でphysical Module境界がaccepted designへ整列した後なら機械検査できる。それ以前にdependency-cruiser等を入れると、まだ存在しない構造をtoolへ二重定義することになる。

### 5. Single source of truthは「同じ説明を同期する」ことではない

同じ事実をREADME、AGENTS、architecture、seam、Issueへ複製すると、同期checkを増やしても意味が分岐する。各事実のownerを一つにする。

| Fact | Owner |
| --- | --- |
| Missionと現在の開始点 | `README.md` |
| 開発規則 | `AGENTS.md` |
| Domain term | 該当`CONTEXT.md` |
| Context関係 | `CONTEXT-MAP.md` |
| Module ownershipと許可依存 | `module-architecture.md` |
| 一つの公開Seamの詳細 | 対応する`*-seam.md` |
| 判断理由 | 一つのADR |
| 現在のcode/test/statusへのnavigation | Codebase Guide |
| 実装するchangeのscope | GitHub Issue |
| 実行behavior | public Interfaceからのtest |

他の文書はownerの内容を要約し直さずlinkする。Codebase Guideも仕様本文を複製せず、各ownerへのindexだけを持つ。

## 推奨するCodebase Guide

適用先は[Codebase Guide](../CODEBASE-GUIDE.md)一枚とし、目標は「15分で現在のcodebaseを再構成できること」にする。長さは固定しないが、全体を一画面数回のscrollで読める範囲へ保つ。

最初に次の最小flowを置く。

```text
README
  -> Codebase Guide
       -> relevant CONTEXT
       -> relevant seam
       -> public source index
       -> behavior test
       -> ADR only when asking why
```

中心はModule inventory一表でよい。

| Module | Owns | Public Interface | State / Artifact | Source path | Behavior test | Status |
| --- | --- | --- | --- | --- | --- | --- |
| 例: Research Record | append/replay | accepted seamへのlink | Research Ledger | 実在path | 実在test path | planned / partial / implemented |

表の規則は次だけにする。

- `Owns`は一文。手順一覧を書かない。
- `Public Interface`は正本seamまたは実際のexportへlinkする。
- `State / Artifact`はそのModuleだけが変更できるものを書く。
- pathは実在するものだけを書く。未実装は`—`にする。
- `Status`は設計statusではなく実装の現在地を示す。
- 行から一つのbehavior testへ到達できない実装済みModuleはgapとして見えるようにする。
- 詳細な型、内部class、helper、call graphを転記しない。

この表は新しい仕様のownerではない。architectureとsource/testの間を結ぶindexである。最初は手で維持し、`docs:check`はlink先とpathの存在だけを検査する。表の意味まで自動生成しようとすると、別schemaとgeneratorが新しい維持対象になる。

## Adopt now / Defer / Reject

### Adopt now

1. 一枚のCodebase Guideを作り、Module responsibility、Interface、owned state/artifact、source、test、implementation statusを結ぶ。
2. `README.md`のStart hereを読む順序のある短いrouteへし、詳細linkのcatalogはCodebase Guideへ移す。
3. `AGENTS.md`は現在程度の短さを維持し、常時必要でない説明をpointerの背後へ置く。
4. Issueは一つのdemo可能なvertical sliceにし、parent Specまたはaccepted seam、out-of-scope、observable acceptanceをlinkする。
5. behavior変更は公開Seamからredになるtestを先に置き、test名をcapabilityで書く。
6. non-mechanical diffが約800 changed lines、complex logicが約500 linesを超えそうなら、自動拒否ではなくTicketまたはModuleの分割reviewを要求する。
7. `pnpm check`にrepository-owned Markdown link/path検査を入れ、Codebase Guideの参照切れを防ぐ。

### Defer until observed need

1. Issue #1でModule layoutがaccepted architectureへ整列した後、context間import direction、Module root以外からのimport、public exportをstructural checkで検査する。
2. Codebase Guideのstatus自動生成は、手動更新漏れが繰り返し観測された時だけ行う。
3. recurring doc-gardening agentは、文書の陳腐化Issueが複数回発生してから追加する。最初はIssue完了時のSpec delta確認で十分である。
4. ExecPlanは、単一Ticketを越えるmigration、長時間の自律作業、途中状態からの再開が実際に必要な時だけ使う。
5. CODEOWNERSは複数maintainer間のreview routingが必要になった時だけ導入する。solo developmentの知識整理には効かない。
6. hardなcoverage floor、mutation testing、call graph portal、Sourcegraph等は、test gapまたはnavigation failureが測定されてから評価する。

### Reject

1. 別repositoryのDevelopment Harnessを丸ごとcopyまたはsubmodule化する。
2. `AGENTS.md`を全architecture、全Module仕様、全commandの百科事典にする。
3. 関数、class、内部call順、database tableをMarkdownへ全転記する。
4. 各source fileに対応する手書きsummary fileを作る。
5. 同じModule説明をREADME、Context、architecture、seam、Issueへ複製する。
6. file lengthをModule品質そのものとしてhard failにする。
7. 全changeへSpec、ExecPlan、ADRを必須化する。

## 他repositoryのDevelopment Harness比較

結論は、三repositoryともpatternの参照には有効だが、どれもこのrepositoryへそのまま導入するDevelopment Harnessではない。既存の`pnpm check`、Vitest、strict TypeScript、AGENTS、Context/ADR、accepted seamを中心に不足分だけ足す方が、toolと正本を増やさない。

| Repository | Agent entry | One command check | Change scope / growth | Spec / test linkage | CI | 判断 |
| --- | --- | --- | --- | --- | --- | --- |
| [`openai/codex`](https://github.com/openai/codex/tree/3a04482645b695085f4daf7c6310ab8592653fea) | 詳細なroot `AGENTS.md`とsubtree guidance | `just fmt`、`just test -p ...`、`just fix -p ...`をscope別に使用。単一の小さなall-checkではない | Module 500/800 LoC、diff 500/800 lines、private Module、small public API | agent logicはintegration test必須。API変更はdocs/schema/testを同時更新 | 大規模なpath-aware GitHub Actions | 数値trigger、public API、targeted checkだけ採用。Rust/Bazel/大規模CIは移植しない |
| [`anthropics/defending-code-reference-harness`](https://github.com/anthropics/defending-code-reference-harness/tree/d3bea6b5793b5f3d59a75ebe69a58efa88383145) | 約300行の`CLAUDE.md` operator guide | `pytest tests/`。canaryがfast integration path | 一般的なcode growth controlはない | Finding -> regression test、patch -> build/reproduce/regress/re-attack | versioned workflowは確認できず、READMEはrepositoryをunmaintained referenceと明記 | Research Verificationの参考として維持。Development Harnessは移植しない |
| [`mattpocock/skills`](https://github.com/mattpocock/skills/tree/6654f6b60cd9d5be8b54c6fafe44346dabeb3b76) | 各Skill文書とsetup-generated pointer。repository自身のroot instructionsは実質的な入口ではない | package scriptはrelease version整合程度で、一般的なtest/check harnessではない | one Ticket / one context、vertical slice、deep Moduleをpracticeとして指導 | SpecでSeamを合意し、TDDとSpec/Standards reviewへ渡す | release workflow中心 | workflow vocabularyを選択採用。repository全体または全SkillをDevelopment Harnessとして扱わない |

`openai/codex`の規模とCIはこの小さなTypeScript repositoryに過剰である。Anthropic harnessは製品研究loopのreferenceであり、しかもmaintained frameworkではない。Matt Pocockのrepositoryには、Spec同期、Ticket過分割、review再帰等の既知のrough edgeが本人の文書に明記されている。したがって外部frameworkを増やす根拠にはならず、必要な規則を既存Harnessへ取り込む根拠になる。

## 何を文書化しないか

- type systemとpublic exportから直接読めるsignatureの写し
- sourceを読めば分かる内部algorithmとprivate helperの一覧
- line number依存のnavigation
- 実装前の予想file path
- 将来あり得るAdapter、provider、UIの仮想仕様
- Ticketだけに必要な作業順をdurable architectureへ移したもの
- 「clean codeにする」「best practiceに従う」のようにbehaviorを変えない一般論
- testが実行可能に固定しているexpected behaviorの長い言い換え
- 既存ADRと同じ結論を繰り返す新しいADR

文書化対象は、sourceだけから復元しにくく、今後の変更を実際に制約する事実に限る。具体的にはownership、Interfaceの非自明なinvariant、failure semantics、禁止依存、accepted trade-off、out-of-scopeである。

## Repositoryへの具体的な適用順

1. 現行文書を増やす前に、一枚のCodebase Guideで既存Moduleと実装の現在地を結ぶ。
2. `README.md`からCodebase Guideへ一本化し、`AGENTS.md`からは作業前に読む入口として指す。
3. Issue #1のrefactorで`src/research/index.ts`等のpublic Module rootとaccepted ownershipを整列する。
4. その構造が一度動いた後に、import directionとpublic exportのstructural checkを追加する。
5. 各Issueの完了時に「durable learningはあるか」を確認し、ある時だけContext、seam、ADRの正本一箇所を更新する。
6. 数回の実戦投入後、Codebase Guideから実装・testへ辿れなかった事例だけをDevelopment Harnessの新しいgateにする。

## Sources

取得日はいずれも2026-09-01。

- Matt Pocock, [`mattpocock/skills` pinned source](https://github.com/mattpocock/skills/tree/6654f6b60cd9d5be8b54c6fafe44346dabeb3b76)
  - [`writing-for-agents`](https://github.com/mattpocock/skills/blob/6654f6b60cd9d5be8b54c6fafe44346dabeb3b76/docs/productivity/writing-for-agents.md)
  - [`to-spec`](https://github.com/mattpocock/skills/blob/6654f6b60cd9d5be8b54c6fafe44346dabeb3b76/docs/engineering/to-spec.md)
  - [`to-tickets`](https://github.com/mattpocock/skills/blob/6654f6b60cd9d5be8b54c6fafe44346dabeb3b76/docs/engineering/to-tickets.md)
  - [`codebase-design`](https://github.com/mattpocock/skills/blob/6654f6b60cd9d5be8b54c6fafe44346dabeb3b76/docs/engineering/codebase-design.md)
  - [`tdd`](https://github.com/mattpocock/skills/blob/6654f6b60cd9d5be8b54c6fafe44346dabeb3b76/docs/engineering/tdd.md)
  - [`code-review`](https://github.com/mattpocock/skills/blob/6654f6b60cd9d5be8b54c6fafe44346dabeb3b76/docs/engineering/code-review.md)
- OpenAI, [Harness engineering: leveraging Codex in an agent-first world](https://openai.com/index/harness-engineering/)
- OpenAI, [`openai/codex` pinned source](https://github.com/openai/codex/tree/3a04482645b695085f4daf7c6310ab8592653fea)
  - [`AGENTS.md`](https://github.com/openai/codex/blob/3a04482645b695085f4daf7c6310ab8592653fea/AGENTS.md)
  - [`justfile`](https://github.com/openai/codex/blob/3a04482645b695085f4daf7c6310ab8592653fea/justfile)
  - [`rust-ci.yml`](https://github.com/openai/codex/blob/3a04482645b695085f4daf7c6310ab8592653fea/.github/workflows/rust-ci.yml)
- OpenAI Cookbook, [Using PLANS.md for multi-hour problem solving](https://github.com/openai/openai-cookbook/blob/main/articles/codex_exec_plans.md)
- Anthropic, [`defending-code-reference-harness` pinned source](https://github.com/anthropics/defending-code-reference-harness/tree/d3bea6b5793b5f3d59a75ebe69a58efa88383145)
  - [`README.md`](https://github.com/anthropics/defending-code-reference-harness/blob/d3bea6b5793b5f3d59a75ebe69a58efa88383145/README.md)
  - [`CLAUDE.md`](https://github.com/anthropics/defending-code-reference-harness/blob/d3bea6b5793b5f3d59a75ebe69a58efa88383145/CLAUDE.md)
  - [`best-practices.md`](https://github.com/anthropics/defending-code-reference-harness/blob/d3bea6b5793b5f3d59a75ebe69a58efa88383145/docs/best-practices.md)
  - [`patching.md`](https://github.com/anthropics/defending-code-reference-harness/blob/d3bea6b5793b5f3d59a75ebe69a58efa88383145/docs/patching.md)
  - [`pyproject.toml`](https://github.com/anthropics/defending-code-reference-harness/blob/d3bea6b5793b5f3d59a75ebe69a58efa88383145/pyproject.toml)
