# アーキテクチャ概要

Status: accepted design overview, 2026-09-01

横長の一枚図ではGitHub上で縮小されるため、全体のcontext、Research内部、実行時の信頼境界を三枚に分ける。矢印は主なcommand、artifact、結果の流れであり、内部処理の厳密な時間順ではない。

箱の中はコードと一致する正式語を優先し、見切れを避けるため説明を短くしている。日本語の対応は[日本語用語早見表](../../JAPANESE-GLOSSARY.md)を参照する。

## 1. システム全体（System Context）

```mermaid
flowchart TB
    operator["Human Operator"]
    adapters["CLI / Remote / Web"]
    feeds["Target Sources"]

    ti["Target Intelligence"]
    intake[["Target Intake<br/>Packet"]]
    research["Research"]
    packet[["Human Review<br/>Packet"]]
    human["Human OS"]
    reports["External Reports"]

    models["Model Transport"]
    dependencies["External Dependency<br/>Grant"]

    operator --> adapters
    feeds --> ti
    adapters --> ti
    ti --> intake --> research
    adapters --> research
    models --> research
    dependencies --> research
    research --> packet --> human
    adapters --> human
    human -->|"authorize"| reports
    human -. "Evidence Request" .-> research

    classDef context fill:#edf4ff,stroke:#3767a6,color:#172b4d;
    classDef durable fill:#fff5d6,stroke:#a87800,color:#3f2d00;
    classDef human fill:#e9f7ed,stroke:#337a46,color:#173d22;
    class ti,research context;
    class intake,packet durable;
    class operator,human human;
```

`Target Intelligence`（対象情報）は対象を選定・取得し、既知脆弱性情報を除いた`Target Intake Packet`を`Research`（調査）へ渡す。`Research`は自律探索・独立検証・記録・反復を行い、`Human Review Packet`を`Human OS`（人間確認基盤）へ渡す。Human OSからResearchへ戻るのは、過去のFindingを変更しない新しい`Evidence Request`だけである。

## 2. 調査・探索ループ（Research and Exploration Loop）

広いsurfaceから短いprimitiveを得る運行と、一Targetで複数primitiveを最終impactまで接続する運行は同じResearch基盤を使うが目的が異なる。現在地と到達形は[広域探索と深掘り調査](breadth-depth-research-loop.md)を参照する。

```mermaid
flowchart TB
    campaign["Campaign Control"]

    subgraph understanding["Source Understanding"]
        workspace["Target Workspace"]
        baseline["Lab Baseline Builder"]
        mapping["Source Mapping"]
        observation["Runtime Observation"]
        workspace --> baseline --> mapping
        mapping -. "dynamic gap" .-> observation
        observation -->|"map revision"| mapping
    end

    subgraph discovery["Exploration"]
        planner["Root Planner"]
        finders["Independent Free-reasoning<br/>Finders × 3"]
        barrier["Work Wave<br/>Barrier"]
        chain["Root Synthesis +<br/>Adversarial Critic"]
        queue["Exploration /<br/>Verification Queue"]
        gaps["Gap Review"]
        planner --> finders --> barrier --> chain --> queue
        gaps -->|"missing-link wave"| planner
    end

    subgraph proof["Verification"]
        preflight["Preflight"]
        verifier["Verifier / Skeptic"]
        labs["Verification Labs"]
        finding["Finding / Negative"]
        preflight --> verifier --> labs --> finding
    end

    record[("Research Record")]
    iteration["Iteration Review"]
    review[["Human Review<br/>Packet"]]

    campaign --> workspace
    mapping -. "optional hint / coverage" .-> planner
    workspace --> planner
    queue --> preflight
    finding --> record
    mapping --> record
    finders --> record
    chain --> record
    record --> gaps
    gaps -->|"closure"| iteration
    iteration -->|"next wave"| planner
    finding -->|"confirmed"| review

    classDef context fill:#edf4ff,stroke:#3767a6,color:#172b4d;
    classDef durable fill:#fff5d6,stroke:#a87800,color:#3f2d00;
    class campaign,workspace,baseline,mapping,observation,planner,finders,barrier,chain,queue,gaps,preflight,verifier,labs,finding,iteration context;
    class record,review durable;
```

- Surface Mapを待たず、Target manifestとbounded Source Toolsだけで探索を始められる。Mapはhintとcoverageへ使う。
- 固定Strategyを逐次手順にしない。Root Plannerは独立idea familyを分け、Finderは全Targetへ自由にpivotできる。
- Raw sourceへのbounded Glob/Grep/Readを主経路とし、Surface Map、Semgrep、CodeQLはseed、coverage、発見済みpatternの横展開へ限定する。
- Finder同士は会話せず、型付き成果物だけをWork Wave後のChain Synthesisへ渡す。
- 一つのmodelだけが示したsource-bound routeを多数決で捨てない。
- Runtime Observationはmapを補うだけで、Finding用のWitnessまたはCausal Controlには使わない。
- Coverage ClosureはFinderの自己申告ではなく、独立Gap Reviewを通す。

## 3. 実行・信頼領域（Execution and Trust Zones）

```mermaid
flowchart TB
    control["Campaign Control"]
    execution["Model Execution"]
    credentials[("Provider Credential<br/>Store")]
    provider["Model Transport"]
    sandbox["Agent Sandbox"]
    tools["Harness Tool<br/>Gateway"]
    mapping["Source Mapping"]
    target["Target Snapshot"]
    lab["Verification Lab"]
    record[("Research Record")]

    control --> execution
    credentials -. "secret-isolated" .-> execution
    provider <--> execution
    execution --> sandbox --> tools
    tools -->|"read-only"| target
    tools -->|"Verifier only"| lab
    mapping -->|"observation"| lab
    execution --> record
    lab --> record

    classDef context fill:#edf4ff,stroke:#3767a6,color:#172b4d;
    classDef security fill:#fce8e8,stroke:#a33a3a,color:#4a1717;
    classDef durable fill:#fff5d6,stroke:#a87800,color:#3f2d00;
    class control,execution,mapping context;
    class credentials,sandbox,tools,target,lab security;
    class record durable;
```

`Campaign Control`（調査進行制御）はdomain policy、予算、永続化した意図を所有する。AI workerは`Tool Gateway`（ハーネス用ツール窓口）以外を操作できず、provider credential、container socket、host path、Research Ledger writerへ到達できない。FinderはTargetのread/search/graphと隔離scratchだけを使い、runtime操作はできない。VerificationだけがHypothesisに拘束したtyped Experimentを使う。

コード詳細なしで各Moduleの機能を確認する場合は[Module Map](module-map.md)を入口にする。詳細なmodule ownershipは[Module architecture](../module-architecture.md)、探索は[Exploration seam](../exploration-seam.md)、AI実行は[Model execution seam](../model-execution-seam.md)、setupは[Campaign setup seam](../campaign-setup-seam.md)、対象理解は[Source mapping seam](../source-mapping-seam.md)を正本とする。

Finderの分割、最大3並列、Work Wave Barrier、独立Verifier、gVisor実験、Model Profile差替えまでの現在の構成は、横長化を避けて複数枚に分けた[探索エージェント構成](exploration-agent-architecture.md)を参照する。
