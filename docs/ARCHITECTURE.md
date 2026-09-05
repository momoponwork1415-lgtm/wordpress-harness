# Harness Architecture

Status: accepted whole-system view, 2026-09-05

WordPress Targetの選定からAI Reproduction、人間のfresh再実行、Findingまでの全体像を示す。実装状況とModule契約は[Codebase Guide](CODEBASE-GUIDE.md)を正本とする。

[Editable draw.io source](architecture.drawio) · [SVG view](architecture.svg)

![WordPress Semantic Security Research Harnessの全体アーキテクチャ](architecture.svg)

## Contexts

`Target Intelligence -> Research -> Human OS`の三Contextで構成する。Context間はversioned handoffだけを渡す。

| Context | Owns | Output |
| --- | --- | --- |
| Target Intelligence | eligibility、ranking、acquisition、canonical identity | Target Intake Packet |
| Research | discovery、conditional Depth、source-only Validation、Research Record | Runtime Verification Packet |
| Human OS | AI Reproduction、Triage Reproduction Packet、mandatory Human Verification、Finding、外部承認 | Human OS Record |

ResearchはFindingを作らない。Human OSはResearch Ledgerを変更しない。Model Providerはdecision workerでありsystem of recordではない。

## Research Modules

| Module | Owns | Interface |
| --- | --- | --- |
| [Campaign Control](CODEBASE-GUIDE.md#campaign-control) | lifecycle、budget、wave、replay | Campaign Plan -> terminal decision |
| [Source Understanding](CODEBASE-GUIDE.md#source-understanding) | source inventory、query、optional Map | Target Snapshot -> source evidence |
| [Exploration](CODEBASE-GUIDE.md#exploration) | thesis、Hypothesis、frontier、Depth、closure | source evidence -> research decision |
| [Validation](CODEBASE-GUIDE.md#validation) | single fresh source screen、risk、runtime packet | candidate -> disposition / packet |
| [Model Execution](CODEBASE-GUIDE.md#model-execution) | provider isolation、tool binding、process lifecycle | Attempt Plan -> normalized result |
| Research Record | immutable artifact、append-only event、replay projection | event -> durable read model |

**Harness owns the research process; agents own research decisions; humans own Findings and external actions.**

## Primary flow

```mermaid
flowchart LR
    target["Target Snapshot"] --> wave["Semantic Research Wave"]
    wave --> eval{"Root Evaluation"}
    eval -->|"candidate"| validation["Source-only Validation"]
    eval -->|"strong frontier"| depth["Synthesis / Critic / Missing-link"]
    depth --> wave
    eval -->|"no material work"| close["Evidence-backed Stop"]
    validation --> packet["Runtime Verification Packet"]
    packet --> assistant["AI Reproduction"]
    assistant -->|"runtime-confirmed"| triage["Triage Reproduction Packet"]
    assistant -->|"high-impact inconclusive"| escalation["Escalation Queue"]
    triage --> normal["Human Verification Queue"]
    normal --> human["Mandatory fresh Human reproduction"]
    escalation -.->|"human selects"| human
    human --> finding["Finding"]
```

- 通常運転はraw-source-first。Reconとwhole-target Baselineを並行し、最大4個の独立thesisを保つ。
- Candidateを支持数、多数決、到着順で捨てない。
- strong semantic frontierだけをconditional Depthへ送る。
- Validationは一つのfreshなsource screenで決定的な反証だけを除き、`ready-for-runtime`を作る。
- AI Reproduction成功だけを通常のHuman Queueへ送り、人間が別fresh instanceで同じRecipeを必ず再実行する。
- Findingへの昇格は人間のmandatory fresh reproductionだけが行う。

| Mode | Start condition | Goal |
| --- | --- | --- |
| Semantic Research Wave | 全Campaignの通常運転 | candidate、frontier、または根拠付きstop |
| Conditional Depth | high-impactへ伸びる具体的frontier | source-bound routeまたは根拠付きstop |
| Breadth | recall baseline確立後 | recallを維持したcost / throughput改善 |

Surface Map、AST、PHP Program Index、Semgrep、CodeQLは補助toolであり探索境界ではない。

## Stable handoffs

| Artifact | Producer -> Consumer | Meaning |
| --- | --- | --- |
| Target Intake Packet | Target Intelligence -> Research | oracle-free identityとsource manifest |
| Immutable Target Snapshot | Target Intelligence -> Research tools | 実行しないmanifest-bound source |
| Research Record / CAS | Research Modules間 | event、artifact、checkpoint、replay source |
| Runtime Verification Packet | Research -> Human OS | source route、control、single Validation、risk、runtime uncertainty |
| Triage Reproduction Packet | Human OS内 | Recipe、AI observation、Private Evidence Bundle参照 |
| Evidence Request | Human OS -> finite Research work | 不足証拠を新しいworkとして要求 |

## Completion boundaries

| Boundary | Complete when |
| --- | --- |
| Research work | decision、typed failure、または次workがdurable |
| Research Campaign | Explorationとsingle Validationが閉じ、Runtime Packet、未解決事項、再開条件がdurable |
| AI Reproduction | runtime-confirmedまたは理由付きruntime-inconclusiveがdurable |
| Human Verification | 人間が別fresh instanceでRecipeを実行し、結果を記録 |
| Product goal | Human Verification済みFindingまで閉じる |

`validation-pending`やbudget exhaustionをnegativeへ読み替えない。外部報告・公開はFindingとは別の承認を要する。

## Trust rules

- Target sourceをhost上で実行しない。
- FinderとValidatorにはmanifest-boundなread-only source toolだけを渡す。
- Agentへambient shell、network、credential、container socket、MCPを渡さない。
- AIと人間のruntime確認は互いに異なるfreshな使い捨て隔離環境だけで行う。
- exact payload、HTTP request、screenshot、runtime logはHuman OSのPrivate Evidence Bundleへ置き、Gitへ入れない。
- credential、private Target、transcript、PoC、未公開FindingをGitやResearch artifactへ含めない。

## Capability order

1. current write Interfaceをlegacy replayから分離する。
2. single Validation、Runtime Packet、AI Reproduction、Triage Packet、mandatory Human Verificationを閉じる。
3. 一件のoracle-free Prospective Campaignを早期に完走する。
4. Missing-linkとCoverage policyを実測で改善する。
5. Target Intelligenceを自動化し、三件のProspectiveへ広げる。
6. recall-preserving ablationでbreadthとcostを改善する。

現在動く範囲は[Codebase Guide](CODEBASE-GUIDE.md)、research policyは[Research Design](RESEARCH-DESIGN.md)、次の有限workは[GitHub Issues](https://github.com/momoponwork1415-lgtm/wordpress-harness/issues)を参照する。
