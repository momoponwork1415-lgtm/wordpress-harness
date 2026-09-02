# 探索エージェント構成（Exploration Agent Architecture）

Status: living implementation view, 2026-09-02

この文書は、現在の探索処理をコードの詳細なしで追うための図である。設計上の正本は[Exploration seam](../exploration-seam.md)、実装場所とTestは[Codebase Guide](../../CODEBASE-GUIDE.md)とする。

図を横長にしないため、`対象理解 -> 作業分割 -> 並列Finder -> 仮説取込 -> 独立検証`を複数枚に分ける。緑は実装済み、黄は一部実装、灰は設計のみを表す。Module責任、実行時系列、現行と到達形の差、評価gate、主要fileを一画面ずつ確認する場合は[探索アーキテクチャ詳細ガイド](../../visuals/exploration-architecture.html)を開く。

## 1. Surface Mapから調査範囲を作る

```mermaid
flowchart TB
    snapshot["Target Snapshot"]
    index["PHP Program Index"]
    mapper["Static Source Mapping"]
    map[("Surface Map")]
    gate{"Minimum Map Gate"}
    revise["Mapping Evidence Request"]
    candidates["Focus Candidates"]
    portfolio["Category Round Robin"]
    focus[("Finite Focus Areas")]

    snapshot --> index --> mapper --> map --> gate
    gate -->|"不足"| revise
    gate -->|"通過"| candidates --> portfolio --> focus

    classDef done fill:#e9f7ed,stroke:#337a46,color:#173d22;
    classDef partial fill:#fff5d6,stroke:#a87800,color:#3f2d00;
    class snapshot,index,mapper,map,gate,candidates,portfolio,focus done;
    class revise partial;
```

Minimum Map Gateは全コードの完全理解を要求しない。ファイル一覧、実在するsource anchor、relationの結合、明示されたgapを検査し、根拠が足りなければ推測せず`Mapping Evidence Request`を返す。

Focus候補はREST entry、hook、source、state、guard、sink、未登録PHP、mapping gapから作る。同種のsurfaceだけで最初のWaveを埋めず、categoryをround-robinして有限件へ切る。

### 現行bootstrapの正確な選択規則

```text
candidates = every non-symbol Surface Map node
           + every PHP file without an entry in the same file
           + every mapping gap

category order = REST -> sink -> state -> source
               -> unregistered PHP -> gap -> guard -> hook

focus limit = min(maxFocusAreas, maxLeases - 1)
leases      = one primary Lease per selected Focus
            + one alternate Strategy on the first elevated Focus
```

したがって`maxLeases = 3`の現行閉路は、異なる二つのFocusと、そのうち最初のelevated Focusを重ねる一つのLeaseから成る。category内は意味的な到達可能性ではなくstable Focus ID順である。また、entry nodeと同じfileにないPHPはcallable libraryやbundled dependencyであっても最初は`unregistered-php-file`候補になる。

この規則は有限性と再現性を証明するbootstrapとしては機能するが、探索価値の順位としては粗い。private characterizationではbundled debug sinkへの重複割当、relationを持たない単独template、数KBの補助fileが上位になる例を観測した。次のcorrection sliceは公開Interfaceと三並列を変えず、Target固有entry/stateからの到達根拠、異なるroute seed、expected information gain、coverage debtを使って内部順位を置き換える。bundled dependencyは一律除外せず、Target固有codeから接続根拠がある場合に上位へ戻す。

実装は[bootstrap-exploration.ts](../../../src/research/exploration/bootstrap-exploration.ts)、外から観測する回帰仕様は[exploration-bootstrap.test.ts](../../../tests/research/exploration-bootstrap.test.ts)を参照する。

## 2. LaneとStrategyを別々に割り当てる

```mermaid
flowchart TB
    focus["Focus Area"]
    lane{"Lane<br/>何を得たいか"}
    strategy{"Strategy<br/>どう調べるか"}
    lease[("Work Lease")]

    focus --> lane
    focus --> strategy
    lane --> lease
    strategy --> lease

    classDef done fill:#e9f7ed,stroke:#337a46,color:#173d22;
    class focus,lane,strategy,lease done;
```

| 軸 | 現在の値 | 意味 |
| --- | --- | --- |
| Lane | Frontier / Primitive / Coverage | chain候補、単独primitive、未調査領域のどれを進めるか |
| Strategy | Entry Forward | 入力からguard、state、sinkへ進む |
| Strategy | Sink Backward | 危険なsinkから到達可能な入力へ戻る |
| Strategy | State Chain | 保存と読出し、actor交代、request間の順序を追う |
| Strategy | Invariant Review | 正常機能が守るべき権限・完全性を起点にする |
| Strategy | Wildcard | 既知classやsink catalogへ開始点を固定しない |

FinderをSQLi用、XSS用、RCE用という別interfaceへ分けない。全Finderは同じoutput schemaを使い、Focus AreaとStrategyだけを変える。高リスクFocusには可能なら異なるStrategyとmodel familyを重ねる。現在eligibleなのはClaude Opusだけなので、二系統目には`single-eligible-family`例外を明記して同じfamilyを使う。

## 3. 現在のFinder並列構成

```mermaid
flowchart TB
    wave[("Finite Work Wave")]
    budget{"Campaign Budget<br/>最大3実行"}

    subgraph independent["Fresh Contexts — 会話・共有scratchなし"]
        f1["Finder A<br/>Focus + Strategy"]
        f2["Finder B<br/>Focus + Strategy"]
        f3["Finder C<br/>Focus + Strategy"]
    end

    r1[("Typed Result A")]
    r2[("Typed Result B")]
    r3[("Typed Result C")]
    barrier{"Work Wave Barrier"}

    wave --> budget
    budget --> f1
    budget --> f2
    budget --> f3
    f1 --> r1 --> barrier
    f2 --> r2 --> barrier
    f3 --> r3 --> barrier

    classDef done fill:#e9f7ed,stroke:#337a46,color:#173d22;
    classDef boundary fill:#fff5d6,stroke:#a87800,color:#3f2d00;
    class wave,budget,f1,f2,f3,r1,r2,r3 done;
    class barrier boundary;
```

現在のproduction pathは一つのWaveから安定順で最大3 Attemptを選び、`Promise.allSettled`で並列実行する。各Finderは次だけを受け取る。

- 自分のFocus Area、Lane、Strategy、上限
- Surface MapとPHP Program Indexから決定的に選んだsource slice
- source-bound Hypothesisを返すためのversioned schema

現行のtool-free materializerは、Focus ownerのobserved anchorをseedにし、`seed -> 希少な共有hook一件 -> seed内のliteral PHP参照 -> 残りの共有hook -> Map relation二段 -> call neighbor二段`の順でpathを追加する。private closed sliceの上限は8 files、source全体650 KB、単一file 220 KBである。各fileはTarget manifestのsizeとSHA-256を再検査し、上限を越えるfileはobserved anchor周辺だけをrenderする。実装は[finder-attempt-materializer.ts](../../../src/research/campaign-control/finder-attempt-materializer.ts)を参照する。

この順序は再現可能だが、動的property call、service locator、組立てcallback、fileをまたぐstate identityを静的call neighborだけで接続できない。Finderが不足producerやentryを特定しても追加取得できないため、acceptedな到達形では固定seedを小さくし、path・Lease・byte・turn budgetをharnessが検査する`read / search / symbol / graph` toolへ置き換える。shell、web、runtime、Target writeは追加しない。

Finderへ既知CVE、advisory、patched narrative、期待payload、別Finderの結果を渡さない。provider組込みのweb、shell、subagent、ambient MCPも無効にする。結果の到着順は判断に使わず、全Leaseが成功・失敗・取消のterminal resultになってから安定順へ戻す。

## 4. Finder出力から独立検証まで

```mermaid
flowchart TB
    barrier["Wave Barrier"]
    bind{"Lease / Map / Source<br/>Binding"}
    dedupe["Causal Identity +<br/>Route Shape Dedup"]
    hypotheses[("Source-bound Hypotheses")]
    premise{"Attacker Premise<br/>Resolved?"}
    verifier["Independent Verifier<br/>現在: Opus"]
    source{"Source Re-derivation"}
    witness["Fresh gVisor Witness Lab"]
    control["Fresh gVisor Control Lab"]
    outcome[("Finding / Disproved / Blocked")]

    barrier --> bind
    bind -->|"不一致"| outcome
    bind -->|"一致"| dedupe --> hypotheses --> premise
    premise -->|"未解決"| outcome
    premise -->|"確定"| verifier --> source --> witness --> control --> outcome

    classDef done fill:#e9f7ed,stroke:#337a46,color:#173d22;
    class barrier,bind,dedupe,hypotheses,premise,verifier,source,witness,control,outcome done;
```

多数決は使わない。一つのFinderだけが出した候補でも、Surface Mapのobserved anchorとrouteへ拘束でき、反証可能なら残す。重複は支持数ではなくCausal Identityとroute shapeでまとめる。

VerifierはFinderのsession、scratch、自己評価を読まず、固定Targetと最小Hypothesisからsourceを再導出する。現在のStored XSS経路では、Verifierが支持またはsource上の反証根拠とtyped Experimentを作り、Verification ModuleがfreshなgVisor sibling LabでWitnessとCausal Controlを順に実行する。

## 5. 実装済みの閉路と次の拡張

```mermaid
flowchart TB
    current["現在: 1 Work Wave"]
    finders["最大3 Finders<br/>現在: Opus"]
    ingest["Source-bound Ingestion"]
    verify["Independent Verification"]
    record[("Research Record")]
    calibration["Private Calibration<br/>Review"]
    decision{"Iteration Decision"}

    await["await-calibration"]
    stop["stop-boundary-pair-complete"]
    continue["continue-unresolved-work"]
    blocked["blocked-capability"]

    nextwave["Next Wave Reconcile"]
    synthesis["Chain Synthesis"]
    gaps["Independent Gap Review"]
    closure["Coverage Closure"]
    multimodel["GLM / Grok / GPT /<br/>将来のModel Profiles"]

    current --> finders --> ingest --> verify --> record
    record -. "Boundary Pairのみ" .-> calibration --> decision
    record --> decision
    decision --> await
    decision --> stop
    decision --> continue
    decision --> blocked
    continue -. "自動消費は次slice" .-> nextwave
    ingest -. "未実装" .-> synthesis
    synthesis -. "未実装" .-> gaps
    gaps -. "未実装" .-> closure
    finders -. "transport未審査" .-> multimodel

    classDef done fill:#e9f7ed,stroke:#337a46,color:#173d22;
    classDef partial fill:#fff5d6,stroke:#a87800,color:#3f2d00;
    classDef planned fill:#f2f3f5,stroke:#777,color:#333;
    class current,finders,ingest,verify,record,decision,await,continue,blocked done;
    class calibration,stop partial;
    class nextwave,synthesis,gaps,closure,multimodel planned;
```

2026-09-02時点で、Brizy 2.8.11のoracle-free Campaignは最大3 Finderから`Finding`まで到達した。2.8.12の過去の手動較正経路は`Disproved`を記録したが、正例とCausal Identity表現が一致しないためprivate Calibration Reviewは`pending`に保つ。同一Identityへ拘束した再検証はprovider unavailableで`Blocked`となり、誤って`Disproved`またはBoundary Pair完了へ昇格していない。合成Behavior Testではopaque receiptから`stop-boundary-pair-complete`まで動作する。実Targetで残るのはprovider復旧後の同一Identity negativeと完了receiptである。

旧whitebox-harnessと同じく、到達形ではCampaign投入後に人間の追加指示なしで反復する。新設計はその自律性を削らず、進行、上限、resume、停止判定をroot agentの巨大Promptから`Campaign Control`と型付きrecordへ移す。現行sliceは一つの有限Waveと次Decisionまでを自律実行するが、`continue-unresolved-work`を次Waveへ自動消費する部分はまだ未実装である。

図中のOpusは現在接続済みのModel Profileを表し、FinderまたはVerifierの型を意味しない。Target固定、Focus、tool manifest、出力schema、仮説取込、独立検証はprovider非依存である。Claude固有`high`は現在の開発baselineに限り、安価なeligible Profileで各gateを再現できることをハーネス能力として評価する。

## 6. Model Profileを差し替えても探索契約を変えない

```mermaid
flowchart TB
    lease["Work Lease<br/>Focus + Strategy + Budget"]
    registry["Eligible Model Profile Registry"]
    plan[("Provider非依存<br/>Attempt Plan")]
    execution["Model Execution"]

    subgraph adapters["Provider Adapter — transport差だけを吸収"]
        claude["Claude<br/>実装済み"]
        gpt["GPT<br/>計画"]
        grok["Grok<br/>計画"]
        glm["GLM<br/>計画"]
        future["将来Model<br/>計画"]
    end

    result[("共通の型付き<br/>Attempt Result")]
    ingest["Hypothesis Ingestion"]
    verify["Independent Verification"]

    lease --> plan
    registry --> plan
    plan --> execution
    execution --> claude
    execution -.-> gpt
    execution -.-> grok
    execution -.-> glm
    execution -.-> future
    claude --> result
    gpt -.-> result
    grok -.-> result
    glm -.-> result
    future -.-> result
    result --> ingest --> verify

    classDef done fill:#e9f7ed,stroke:#337a46,color:#173d22;
    classDef partial fill:#fff5d6,stroke:#a87800,color:#3f2d00;
    classDef planned fill:#f2f3f5,stroke:#777,color:#333;
    class lease,registry,plan,execution,claude,result,ingest,verify done;
    class gpt,grok,glm,future planned;
```

`Attempt Plan`と`Attempt Result`が防火壁である。adapterは認証、CLI/API、model identity、provider固有effort、event形式、process lifecycleだけを変換し、Focus選定、tool権限、Hypothesisの意味、Findingへの昇格条件を変えない。したがってClaudeの`high`と別providerの設定を共通尺度へ変換せず、各Profileを同じrole contractとgateで評価する。

安価なProfileでContext Reachが不足した時は、上位modelへ即時fallbackせず、Surface Mapまたはbounded toolで不足sourceを供給する。source-boundな有望仮説まで進み、残りが推論上の曖昧さである場合だけ、同じTarget、Focus、context、schema、予算を固定した上位Profileと比較する。

## 実行主体と権限

| 実行主体 | 読めるもの | 作るもの | 禁止するもの |
| --- | --- | --- | --- |
| Mapper | Target Snapshot、静的解析結果 | Surface Map revision | Finding判定、攻撃実験 |
| Finder | 自分の有限source slice、Focus、Strategy | 型付きHypothesis等 | runtime、browser、network、他Finderの会話 |
| Chain Synthesizer（設計のみ） | barrier後の型付きroute | chain Hypothesis、Frontier Gap | raw transcript、多数決による破棄 |
| Independent Verifier | 固定Target、最小Hypothesis | source再導出、Experiment | Finder sessionの再利用 |
| Lab Control | 型付きExperiment、固定baseline | sanitized observation | Hypothesis/Findingの判断、plain Docker fallback |
| Campaign Control | 不変ref、budget、terminal result | intent、Work Wave、Iteration Decision | provider固有処理、browser操作 |

## コードを追う入口

```text
src/research/
├── source-mapping/       # Surface MapとPHP Program Index
├── exploration/          # Focus、Lane、Strategy、Wave、仮説取込
├── campaign-control/     # source slice、並列Attempt、Verification接続
├── model-execution/      # Claude processとFinder schema
├── verification/         # 独立再導出、gVisor Witness/Control
└── research-record/      # append-only Ledgerとprivate CAS ref
```
