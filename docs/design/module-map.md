# Module Map

Status: living visual index, 2026-09-01

この文書は、コードの詳細を知らなくても「どのModuleが何を行い、何を受け取り、何を作るか」を把握するための機能図である。設計判断の正本は[Module architecture](module-architecture.md)、現在のsource・Testとの対応は[Codebase Guide](../CODEBASE-GUIDE.md)とする。

## 1. 製品が行うこと

```mermaid
flowchart TB
    target["Target<br/>Intelligence"]
    intake(["Intake Packet"])

    subgraph research["Research"]
        understand["Source<br/>Understanding"]
        surface(["Surface Map"])
        explore["Exploration"]
        hypothesis(["Hypothesis"])
        verify["Verification"]
        outcome{"Outcome"}
        finding(["Finding"])
        negative(["Negative / Blocked"])

        understand --> surface
        surface --> explore
        explore --> hypothesis
        hypothesis --> verify
        verify --> outcome
        outcome --> finding
        outcome --> negative
    end

    review(["Review Packet"])
    human["Human OS"]

    target --> intake
    intake --> understand
    finding --> review
    review --> human

    classDef module fill:#edf4ff,stroke:#3767a6,color:#172b4d;
    classDef artifact fill:#fff5d6,stroke:#a87800,color:#3f2d00;
    class target,understand,explore,verify,human module;
    class intake,surface,hypothesis,outcome,finding,negative,review artifact;
```

- `Target Intelligence`は調査するpluginを選定・取得し、既知脆弱性のoracleを除いた受入情報を作る。
- `Source Understanding`はsourceと必要最小限の観測から攻撃面を構造化する。
- `Exploration`は独立した複数の探索から、反証可能な脆弱性仮説を作る。
- `Verification`は仮説をcleanな環境で再導出し、成立証拠と因果対照実験で真偽を決める。
- `Human OS`は固定された証拠を確認し、追加証拠または外部行動を判断する。

## 2. Researchを支える6 Module

色は2026-09-01時点のproduction実装状況を表す。黄は一部実装、灰は設計のみである。

```mermaid
flowchart TB
    campaign["Campaign<br/>Control"]
    understand["Source<br/>Understanding"]
    explore["Exploration"]
    verify["Verification"]
    execution["Model<br/>Execution"]
    record[("Research<br/>Record")]

    campaign --> understand
    understand --> explore
    explore --> verify

    campaign -. "attempt" .-> execution

    campaign --> record
    understand --> record
    explore --> record
    verify --> record
    execution --> record

    classDef partial fill:#fff5d6,stroke:#a87800,color:#3f2d00;
    classDef planned fill:#f2f3f5,stroke:#777,color:#333;
    class campaign,understand,record partial;
    class explore,verify,execution planned;
```

`Campaign Control`が進行と予算を決める。`Source Understanding -> Exploration -> Verification`が証拠を強くする主経路である。`Model Execution`はAIを実行するが研究上の判断を所有しない。全Moduleの事実と判断は`Research Record`へ追記され、workerが過去の記録を書き換えることはできない。

## 3. Moduleごとの機能

| Module | 主な機能 | 受け取るもの | 作るもの | 所有しないもの |
| --- | --- | --- | --- | --- |
| [Campaign Control](module-architecture.md#campaign-control) | Campaignを準備・前進・停止・再開し、有限のWork Waveと予算を管理する | Target Snapshot、Campaign Spec、operator command | Work Lease、停止理由、現在状態 | 脆弱性の真偽、provider固有処理 |
| [Source Understanding](source-mapping-seam.md) | pluginの攻撃面、guard、data flow、未解決gapを構造化する | Target Snapshot、PHP Program Index、許可されたRuntime Observation | versioned Surface Map、Lab Baseline | Finding、探索の多数決 |
| [Exploration](exploration-seam.md) | Focus Areaへ多様なStrategyを適用し、routeを組み立て、coverage gapを閉じる | Surface Map、Work Lease、Strategy Portfolio | Hypothesis、Route Fragment、Gap Review | Findingへの昇格、runtimeの直接操作 |
| [Verification](module-architecture.md#verification) | 仮説を独立再導出し、cleanなLabで成立・不成立・未検証を確定する | Target Snapshot、最小Hypothesis、typed Experiment | Finding、Negative Result、Blocked Result、Review Packet | Finderの自己評価、raw transcriptによる証明 |
| [Model Execution](model-execution-seam.md) | 公式provider processを隔離実行し、timeout、retry、session、usageを管理する | Model Profile、Assignment、外部budget | normalized events、result、transcript reference | Campaign priority、Verification verdict |
| [Research Record](module-architecture.md#research-record) | eventとartifactをappend-onlyに保存し、再現可能なviewを構築する | versioned event、artifact、provenance | Research Ledger、CAS reference、replayed view | domain判断、provider選択 |

## 4. 一つの調査が通る道

```mermaid
sequenceDiagram
    participant TI as Target Intel
    participant CC as Campaign
    participant SU as Understanding
    participant EX as Exploration
    participant VE as Verification
    participant RR as Record
    participant HO as Human OS

    TI->>CC: Intake Packet
    CC->>SU: 固定Targetを理解
    SU->>RR: Surface Map
    CC->>EX: Work Wave
    EX->>RR: Hypothesis
    CC->>VE: 検証候補
    VE->>RR: Finding / Negative
    opt Finding only
        VE->>HO: Review Packet
    end
```

この図は概念上の主経路であり、厳密なcall順ではない。実行中は`Campaign Control`が各段階をreconcileし、`Model Execution`が必要なAI Attemptを動かす。すべての重要な遷移は先に`Research Record`へ固定してから外部副作用を進める。

## 5. 詳細を読むとき

- 現在どこまで動くか、どのsourceとTestか: [Codebase Guide](../CODEBASE-GUIDE.md)
- Surface MapのInterface、根拠状態、AIとの責任分担: [Surface Map visual guide](../visuals/surface-map.html)
- 全体のcontextと信頼領域: [Architecture overview](architecture-overview.md)
- Module ownershipと依存方向: [Module architecture](module-architecture.md)
- 探索の分割と合流: [Exploration seam](exploration-seam.md)
- 独立Verificationを含むResearch全体: [Architecture](architecture.md)
- 日本語で分からない正式語: [日本語用語早見表](../JAPANESE-GLOSSARY.md)
