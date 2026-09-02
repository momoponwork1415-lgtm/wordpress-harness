# 広域探索と深掘り調査（Breadth and Depth）

Status: accepted architecture view, 2026-09-02

この図はWordfenceが公開したPRISMとArgusの役割差を、現在のResearch architectureへ対応付ける。`PRISM`と`Argus`はWordfenceの名称であり、このrepositoryのModule名には使わない。実装では広域探索と深掘り調査を同じCampaign基盤上の異なる運行として扱う。

WordfenceはPRISMを多数の対象とbug classを短い経路で広く調べるbreadth-first側、Argusを一つのTargetに留まり、複数の弱点を長い依存順序へ接続するdepth-first側と説明している。公開されていないprompt、agent topology、retrieval、memoryを推測して模倣しない。[Wordfence, “Breadth and Depth”](https://www.wordfence.com/blog/2026/08/wordfence-argus-finds-complex-6-step-critical-rce-in-avada-theme-with-1-million-sales/#breadth-and-depth)

## 1. 深掘りを主探索にし、横展開をfeedback loopに置く

```mermaid
flowchart TB
    target["Target Snapshot"]
    deep["深掘り調査<br/>Depth"]
    reason["Raw-source<br/>free reasoning"]
    verify["End-to-end Verification"]
    finding["Verified Finding"]
    pattern["Pattern Extraction"]
    rule["Rule Validation"]
    broad["広域探索<br/>Breadth"]
    fragments[("Candidates / Fragments")]
    admission{"Depth Admission"}

    target --> deep --> reason --> verify --> finding
    finding --> pattern --> rule --> broad
    broad --> fragments --> admission --> deep
    target --> broad
```

現在の主探索は深掘り調査であり、すべてのTargetを先に広域探索へ通す必要はない。深掘りで独立検証されたFindingから、構文的に一般化できる部分だけをruleへ変換し、広域探索で横展開する。広域探索は単独Findingだけでなく、impactへ届いていないsource-boundな経路断片を残し、価値の高いものをDepth Admission経由で深掘りへ戻す。

## 2. Modeを混ぜない

```mermaid
flowchart TB
    intake["Target Intelligence"]
    breadth["Breadth Campaign<br/>多数Target・短いroute"]
    admission{"Depth Admission"}
    depth["Depth Campaign<br/>一Target・長いchain"]
    shared["Shared Runtime<br/>Snapshot・Sandbox・CAS・Verification"]

    intake --> breadth --> admission
    intake --> depth
    admission -->|"高impact frontier"| depth
    admission -->|"短いFindingで完結"| intake
    shared --> breadth
    shared --> depth
```

| 判断軸 | Breadth Campaign | Depth Campaign |
| --- | --- | --- |
| Target | 多数を短時間で回す | 一つへ留まる |
| 主探索 | static seed + model triage | raw-source free reasoning（本projectの主経路） |
| Static tool | Semgrep/CodeQL/Mapを積極利用 | 補助と後段pattern expansion |
| Model | cheap/medium中心 | frontier reasoning中心 |
| Loop | candidate→verify→次Target | family→synthesis→critic→missing link |
| 終了 | target単位budgetと短いcoverage | evidence-backed closureまたはhard ceiling |
| 指標 | targets/hour、precision、coverage、cost | chain closure、high-impact frontier、time-to-proof |

設計判断の正本は[ADR 0114](../../adr/0114-separate-breadth-and-depth-campaign-policies.md)とする。

## 3. Depth Campaignの構成

```mermaid
flowchart TB
    subgraph target["長いChain Campaign"]
        planner["Root Planner"]
        finder1["Finder A<br/>family 1"]
        finder2["Finder B<br/>family 2"]
        finder3["Finder C<br/>family 3"]
        finder4["Finder D<br/>family 4"]
        barrier["Wave Barrier"]
        chain["Root Synthesis + Critic"]
        nextwave["Evidence-driven Next Wave"]
        proof["End-to-end Proof"]

        planner --> finder1 --> barrier
        planner --> finder2 --> barrier
        planner --> finder3 --> barrier
        planner --> finder4 --> barrier
        barrier --> chain --> nextwave
        nextwave -->|"未解決"| planner
        nextwave -->|"経路成立"| proof
    end

```

4枠は固定されたroleではない。Root PlannerがそのTargetと過去Waveに応じて意味の異なるidea familyを毎回選び、各Finderは同じ出力schemaを使ってTarget全体へ自由にpivotする。現在の実装状態は[Codebase Guide](../../CODEBASE-GUIDE.md)を参照する。

`source-first`、`sink-first`、`state-chain`等は逐次checklistではなく、Approach Family Registryの観測labelまたは開始lensに限る。HarnessはTarget、tool、予算、artifact schema、隔離、barrier、証拠基準だけを強制する。

## 4. 深掘り調査の反復

```mermaid
sequenceDiagram
    participant C as Campaign Control
    participant F as Free-reasoning Finder
    participant R as Research Record
    participant S as Chain Synthesis
    participant V as Independent Verifier

    C->>F: Goal + lens + bounded tools
    F->>R: Hypothesis / Fragment / Unknown
    C->>S: terminal artifacts at barrier
    S->>R: Chain candidate + missing link
    alt linkが不足
        C->>F: fresh Frontier Attempt
        F->>R: new fragment or falsifier
    else chainがsource-bound
        C->>V: minimal chain hypothesis
        V->>R: Witness + Causal Control
    end
```

例えば匿名の値読出しと未認証の状態生成が別々に見つかった場合、単独severityで切り捨てない。各Fragmentの`attacker premise`、`precondition`、`consumed/produced value`、`state identity`、`effect/capability`、`unknown`、`falsifier`を保持し、Wave後に接続可能性を推論する。Findingへの昇格はChain Synthesisでは行わず、freshな独立Verificationだけが行う。

## Depth loop requirements

1. Finderは`Hypothesis`、`Route Fragment`、`Mapping Evidence Request`、`Closure Record`をterminal artifactとして返す。
2. raw-source Context ProfileはTarget inventoryへbounded Glob/Grep/Readで到達できる。
3. Root PlannerはApproach Family Registryから最大4個の独立familyを割り当てる。
4. Wave barrierはterminal artifactを安定順にfoldし、Root SynthesisとAdversarial Criticへ渡す。
5. missing linkはfresh Attemptへ、成立chainはIndependent VerificationとgVisor Labへ渡す。

設計根拠と公開実装の責務分担は[Free-reasoning Finder and evidence-shell harness references](../../research/free-reasoning-evidence-shell-harness-references.md)、既存の型付きchain判断は[ADR 0107](../../adr/0107-synthesize-cross-focus-chains-at-wave-barriers.md)、4 Finderの根拠は[ADR 0116](../../adr/0116-use-four-finder-slots-per-depth-wave.md)を参照する。
