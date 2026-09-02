# Codebase Guide

Status: living implementation map, 2026-09-03

コードを一行ずつ覚えず、現在の実装、owner、Interface、Testへ15分以内に戻るための唯一のliving documentである。安定した設計はSeam、実測はexperiments、日付時点の評価はauditsへ分ける。

## Five things to remember

```mermaid
flowchart TB
    north["North Star<br/>frontier discovery"]
    verbs["Ten control verbs"]
    contexts["Intelligence → Research → Human OS"]
    modules["Six Research modules"]
    entry["Public entry<br/>openResearch"]

    north --> verbs --> contexts --> modules --> entry
```

1. 未知のRCEまたは同等のsite-wide compromiseをoracle-freeに発見・実証する。
2. `confine -> constrain -> focus -> motivate -> parallelize -> hypothesize -> verify -> record -> prioritize -> iterate`をcontrol propertyとして実装する。
3. Target Intelligence、Research、Human OSのcontext間はversioned handoffだけを渡す。
4. ResearchはCampaign Control、Source Understanding、Exploration、Verification、Model Execution、Research Recordの6 Moduleで構成する。
5. context外のpublic入口は`openResearch`である。

schema field、SQLite table、provider argv、全ADR、内部helperは暗記しない。

## Current completion map

```mermaid
flowchart TB
    ti["Target Intelligence<br/>planned"]
    campaign["Campaign Control<br/>partial"]
    source["Source Understanding<br/>partial"]
    explore["Exploration<br/>partial"]
    verify["Verification<br/>partial"]
    model["Model Execution<br/>partial"]
    record["Research Record<br/>partial"]
    human["Human OS<br/>planned"]

    ti --> campaign --> source --> explore --> verify --> human
    campaign --> model
    source --> model
    explore --> model
    verify --> model
    campaign --> record
    source --> record
    explore --> record
    verify --> record
    model --> record

    classDef partial fill:#fff3cd,stroke:#8a6d00,color:#332700;
    classDef planned fill:#eeeeee,stroke:#777777,color:#333333;
    class campaign,source,explore,verify,model,record partial;
    class ti,human planned;
```

`partial`は一部のproduction pathとBehavior Testが存在するが、到達設計を満たしていない状態である。完成度の詳しい日付snapshotは[2026-09-03 audit](audits/harness-completeness-2026-09-03.md)を参照する。

## Current vertical slice

```mermaid
flowchart TB
    map["Fixed Surface Map"]
    plan["Deterministic planning"]
    leases["Up to 4 Work Leases"]
    finder["Claude Finder<br/>read and search"]
    outputs["Hypotheses and Fragments"]
    ingest["Hypothesis ingestion"]
    verifier["Independent Verifier"]
    labs["gVisor Labs<br/>XSS or SQLi"]
    outcome["Finding / Disproved / Blocked"]
    record[("Iteration record and replay")]

    map --> plan --> leases --> finder --> outputs --> ingest
    ingest --> verifier --> labs --> outcome --> record
```

これは現在動くMap-firstのinner sliceであり、到達設計ではない。target-specificな成否、Waveの時系列、所要時間は[公開CVEのE2E実験記録](experiments/e2e-campaign-results-2026-09-02.md)にだけ置く。

## Main capability gap

```mermaid
flowchart TB
    current["Current<br/>Map-first one-wave slice"]
    raw["Raw-source first"]
    families["Approach Family Registry"]
    synthesis["Root Synthesis and Critic"]
    waves["Missing-link multi-wave loop"]
    proof["More proof mechanisms"]
    prospective["Prospective operation"]

    current --> raw --> families --> synthesis --> waves --> proof --> prospective
```

最重要gapは、Surface Mapで先に選んだ範囲に探索を寄せる現在経路を、raw sourceから自由にpivotできるDepth Campaignへ置き換えることである。Map、AST、Semgrep、CodeQLは補助に残し、Map外candidateを拒否しない。`Route Fragment`はschema出力まで存在するが、Registry、Chain Synthesis、Adversarial Critic、missing-link再投入は未接続である。

## Implementation index

| Capability | Status | Public or owner Interface | Source | Behavior Tests | Design |
| --- | --- | --- | --- | --- | --- |
| Campaign prepare、run、replay | partial | `openResearch` / `CampaignRunner` | [`campaign-control/`](../src/research/campaign-control), [`open-research.ts`](../src/research/open-research.ts) | [`campaign-prepare`](../tests/research/campaign-prepare.test.ts), [`campaign-run`](../tests/research/campaign-run.test.ts) | [Campaign seam](design/campaign-execution-seam.md) |
| Research Ledger and CAS | partial | internal `ResearchRecord` | [`research-record/`](../src/research/research-record) | [`ledger compatibility`](../tests/research/ledger-compatibility.test.ts) | [Module architecture](design/module-architecture.md#research-record) |
| PHP Program Index | implemented internal slice | `PhpSourceAnalysis` | [`php-program-index/`](../src/research/source-mapping/php-program-index) | [`php-program-index`](../tests/research/php-program-index.test.ts) | [Index seam](design/php-program-index-seam.md) |
| Surface Map and AI delta | partial | `SourceMapping.build` | [`source-mapping/`](../src/research/source-mapping) | [`source-mapping`](../tests/research/source-mapping.test.ts), [`map-delta`](../tests/research/map-delta-synthesizer.test.ts) | [Source Mapping seam](design/source-mapping-seam.md) |
| Target-bound source queries | partial; `read/search` | `SourceEvidenceGateway.query` | [`source-evidence-gateway.ts`](../src/research/source-mapping/source-evidence-gateway.ts) | [`gateway`](../tests/research/source-evidence-gateway.test.ts), [`Attempt loop`](../tests/research/source-evidence-attempt-loop.test.ts) | [ADR 0112](adr/0112-treat-analysis-units-as-seeds-for-bounded-source-retrieval.md) |
| Planning and Hypothesis intake | partial | `Exploration.decide` | [`exploration/`](../src/research/exploration) | [`exploration-bootstrap`](../tests/research/exploration-bootstrap.test.ts) | [Exploration seam](design/exploration-seam.md) |
| Provider execution | partial; Claude process only | `ModelExecution.run` | [`model-execution/`](../src/research/model-execution) | [`model-execution`](../tests/research/model-execution.test.ts), [`Claude bridge`](../tests/research/claude-source-evidence-bridge.test.ts) | [Model seam](design/model-execution-seam.md) |
| Independent proof | partial; Stored XSS and SQLi | `Verification.verify` | [`verification/`](../src/research/verification) | [`verification`](../tests/research/verification.test.ts), [`XSS Lab`](../tests/research/gvisor-stored-xss-lab.test.ts), [`SQLi Lab`](../tests/research/gvisor-sql-injection-lab.test.ts) | [Verification seam](design/verification-seam.md) |
| Operator CLI | partial; prepare/inspect only | `runCli` | [`cli.ts`](../src/cli.ts) | [`campaign-cli`](../tests/cli/campaign-cli.test.ts) | [ADR 0054](adr/0054-keep-the-cli-as-a-thin-adapter.md) |
| Target Intelligence / Human OS | planned | not implemented | — | — | [Module architecture](design/module-architecture.md) |

Provider identity、generator version、CLI command、support済みmechanism等が変わった時は、この表だけを更新する。Seamへ現在地をコピーしない。

## Fifteen-minute reading path

```mermaid
flowchart LR
    docs["Documentation Guide"] --> map["Module Map"]
    map --> guide["This Guide"]
    guide --> seam["Owning Seam"]
    seam --> test["Behavior Test"]
    test --> source["Implementation"]
```

1. [Documentation Guide](README.md)で文書の種類を確認する。
2. [Module Map](design/architecture/module-map.md)でownerとartifact flowを確認する。
3. 上のImplementation indexからSeam、Test、sourceへ進む。
4. 理由が意外な時だけSeamからlinkされたADRを読む。
5. 次の作業はGitHub Issueで確認する。

通常の変更で[Module architecture](design/module-architecture.md)全体や全ADRを通読しない。Source Mappingを変更する場合は先に[攻撃面マップ構成](design/architecture/surface-map-architecture.md)、探索を変更する場合は[自由探索エージェント・ループ](design/architecture/autonomous-research-loop.md)を読む。

## Source of truth

| Question | Canonical source |
| --- | --- |
| 用語と所有関係 | `CONTEXT.md`、`docs/domain/` |
| 安定したModule関係 | [Module Map](design/architecture/module-map.md) |
| Interface、不変条件、failure | owning Seam |
| 現在のstatus、path、Test | このCodebase Guide |
| 実行可能なbehavior | Behavior Test |
| 判断理由 | ADR |
| 次の有限work | GitHub Issue |
| 対象別の実測 | dated experiment |
| 日付時点の全体評価 | dated audit |

同じ事実を複数文書で保守しない。内部helper追加だけなら、このGuideも設計書も更新しない。
