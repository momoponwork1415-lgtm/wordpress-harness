# アーキテクチャ概要

Status: accepted design overview, 2026-09-01

横長の一枚図ではGitHub上で縮小されるため、全体のcontext、Research内部、実行時の信頼境界を三枚に分ける。矢印は主なcommand、artifact、結果の流れであり、内部処理の厳密な時間順ではない。

## 1. System context

```mermaid
flowchart TB
    operator["人間<br/>対象投入・開始・停止・再認証・最終確認"]
    adapters["CLI / Remote Control / Web<br/>driving adapters"]
    feeds["WordPress.org / Wordfence /<br/>正規入手したpremium source"]

    ti["Target Intelligence<br/>対象選定・取得・受入"]
    intake[["Target Intake Packet<br/>versioned / oracle-free"]]
    research["Research<br/>自律探索・独立検証・記録・反復"]
    packet[["Human Review Packet<br/>digest-fixed evidence"]]
    human["Human OS<br/>人間の確認・programme判定・外部行動"]
    reports["Wordfence / vendor<br/>外部report・連絡"]

    models["公式Model Transport<br/>Opus / GPT / Grok / GLM候補"]
    dependencies["許可された外部service<br/>External Dependency Grant"]

    operator --> adapters
    feeds --> ti
    adapters --> ti
    ti --> intake --> research
    adapters --> research
    models --> research
    dependencies --> research
    research --> packet --> human
    adapters --> human
    human -->|"毎回authorization必須"| reports
    human -. "Evidence Request" .-> research

    classDef context fill:#edf4ff,stroke:#3767a6,color:#172b4d;
    classDef durable fill:#fff5d6,stroke:#a87800,color:#3f2d00;
    classDef human fill:#e9f7ed,stroke:#337a46,color:#173d22;
    class ti,research context;
    class intake,packet durable;
    class operator,human human;
```

正本は`Target Intelligence -> Research -> Human OS`の順に進む。Human OSからResearchへ戻るのは、過去のFindingを変更しない新しいEvidence Requestだけである。

## 2. Research and exploration loop

```mermaid
flowchart TB
    campaign["調査進行制御<br/>Campaign / budget / Work Wave"]

    subgraph understanding["対象理解（Source Understanding）"]
        workspace["Target Workspace<br/>read-only Target Snapshot"]
        baseline["Lab Baseline Builder<br/>typed Setup Plan / sealed baseline"]
        mapping["Source Mapping<br/>observed / inferred / unknown"]
        observation["Runtime Observation<br/>低影響・map evidence only"]
        workspace --> baseline --> mapping
        mapping -. "dynamic evidence need" .-> observation
        observation -->|"next map revision"| mapping
    end

    subgraph discovery["脆弱性仮説の探索（Exploration）"]
        focus["Focus Area<br/>Feature / Actor / Privilege / State"]
        strategy["Lane × Strategy Portfolio<br/>forward / backward / state / invariant / Wildcard"]
        finders["独立Finder<br/>typed outputs only"]
        barrier["Work Wave barrier<br/>stable Work ID fold"]
        chain["Chain Synthesis<br/>cross-Focus / minority route"]
        queue["Exploration / Verification Queue<br/>evidence・information gain・cost"]
        gaps["独立Gap Review<br/>closureまたはreopen"]
        focus --> strategy --> finders --> barrier --> chain --> queue
        gaps -->|"new gap / changed premise"| focus
    end

    subgraph proof["独立検証（Verification）"]
        preflight["決定的Preflight<br/>passed / disproved / inconclusive"]
        verifier["fresh Verifier / Skeptic"]
        labs["fresh sibling Labs<br/>Witness / Causal Control"]
        finding["Finding または negative evidence"]
        preflight --> verifier --> labs --> finding
    end

    record[("Research Record<br/>append-only Ledger + private CAS")]
    iteration["Iteration Review<br/>Lesson / Rule / next policy"]
    review[["Human Review Packet"]]

    campaign --> workspace
    mapping --> focus
    queue --> preflight
    finding --> record
    mapping --> record
    finders --> record
    chain --> record
    record --> gaps
    gaps -->|"Coverage Closure"| iteration
    iteration -->|"next finite Wave"| focus
    finding -->|"confirmed"| review

    classDef context fill:#edf4ff,stroke:#3767a6,color:#172b4d;
    classDef durable fill:#fff5d6,stroke:#a87800,color:#3f2d00;
    class campaign,workspace,baseline,mapping,observation,focus,strategy,finders,barrier,chain,queue,gaps,preflight,verifier,labs,finding,iteration context;
    class record,review durable;
```

- Surface Mapの全解析完了を待たず、stable anchorと明示gapを持つ最小revisionから探索を始める。
- Laneは探索目的、Strategyは探索方法であり、vulnerability class別agentを増やさない。
- Finder同士は会話せず、型付き成果物だけをWork Wave後のChain Synthesisへ渡す。
- 一つのmodelだけが示したsource-bound routeを多数決で捨てない。
- Runtime Observationはmapを補うだけで、Finding用のWitnessまたはCausal Controlには使わない。
- Coverage ClosureはFinderの自己申告ではなく、独立Gap Reviewを通す。

## 3. Execution and trust zones

```mermaid
flowchart TB
    control["trusted Campaign Control<br/>domain policy / budget / durable intent"]
    execution["Model Execution<br/>Attempt Plan / supervision / schema output"]
    credentials[("Provider Credential Store<br/>launcherだけが参照")]
    provider["eligible official transport"]
    sandbox["Agent Sandbox<br/>model process + harness tools"]
    tools["Harness Tool Gateway<br/>role別read / search / graph / scratch"]
    mapping["Source Mapping<br/>internal observation adapter"]
    target["read-only Target Snapshot"]
    lab["gVisor Lab clone<br/>typed Observation または Experiment"]
    record[("Research Record<br/>artifact first, digest event second")]

    control --> execution
    credentials -. "secret value非公開" .-> execution
    provider <--> execution
    execution --> sandbox --> tools
    tools -->|"Target限定"| target
    tools -->|"Verifier / Skepticだけ"| lab
    mapping -->|"typed Runtime Observation"| lab
    execution --> record
    lab --> record

    classDef context fill:#edf4ff,stroke:#3767a6,color:#172b4d;
    classDef security fill:#fce8e8,stroke:#a33a3a,color:#4a1717;
    classDef durable fill:#fff5d6,stroke:#a87800,color:#3f2d00;
    class control,execution,mapping context;
    class credentials,sandbox,tools,target,lab security;
    class record durable;
```

AI workerはHarness Tool Gateway以外を操作できず、provider credential、container socket、host path、Research Ledger writerへ到達できない。FinderはTargetのread/search/graphと隔離scratchだけを使い、runtime操作はできない。VerificationだけがHypothesisに拘束したtyped Experimentを使う。

詳細なmodule ownershipは[Module architecture](module-architecture.md)、探索は[Exploration seam](exploration-seam.md)、AI実行は[Model execution seam](model-execution-seam.md)、setupは[Campaign setup seam](campaign-setup-seam.md)、対象理解は[Source mapping seam](source-mapping-seam.md)を正本とする。
