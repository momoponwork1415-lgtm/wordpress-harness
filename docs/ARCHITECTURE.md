# Harness Architecture

Status: accepted whole-system view, 2026-09-05

WordPress Targetの自律選定から無人Research、人間のfresh再実行、report承認、Submit直前のstagingまでの全体像を示す。実装状況とModule契約は[Codebase Guide](CODEBASE-GUIDE.md)を正本とする。

[Editable draw.io source](architecture.drawio) · [SVG view](architecture.svg)

![WordPress Semantic Security Research Harnessの全体アーキテクチャ](architecture.svg)

## Contexts

`Target Intelligence -> Research -> Human OS`の三Contextで構成する。Context間はversioned handoffだけを渡す。

| Context | Owns | Output |
| --- | --- | --- |
| Target Intelligence | observation、自律選定、Human Batch Approval、acquisition、dispatch、Research History | Target Intake Packet |
| Research | 一TargetのCampaign、conditional Depth、source Validation、Opus capacity、Research Record | Runtime Verification Packet / Campaign Coverage Receipt |
| Human OS | AI Reproduction、理解支援、mandatory Human Verification、Finding、report、submission staging | Human OS Record / Approved Submission Draft |

ResearchはFindingを作らない。Human OSはResearch Ledgerを変更しない。Model Providerはdecision workerでありsystem of recordではない。

## Research Modules

| Module | Owns | Interface |
| --- | --- | --- |
| [Campaign Control](CODEBASE-GUIDE.md#campaign-control) | lifecycle、budget、wave、replay | Campaign Plan -> terminal decision |
| [Source Understanding](CODEBASE-GUIDE.md#source-understanding) | source inventory、query、optional Map | Target Snapshot -> source evidence |
| [Exploration](CODEBASE-GUIDE.md#exploration) | thesis、Hypothesis、frontier、Depth、closure | source evidence -> research decision |
| [Validation](CODEBASE-GUIDE.md#validation) | single fresh source screen、risk、runtime packet | candidate -> disposition / packet |
| [Model Execution](CODEBASE-GUIDE.md#model-execution) | provider isolation、tool binding、process lifecycle、Campaign横断capacity | Attempt Plan -> normalized result |
| Research Record | immutable artifact、append-only event、replay projection | event -> durable read model |

**Harness owns the research process; agents own research decisions; humans own Findings and external actions.**

## Operating flow

1. Target Intelligenceがecosystemとprogrammeを観測し、oracle-freeなCandidate Batchを自律選定する。
2. 人間が理由、欠損、freshness、Research Historyを確認し、Approved Target Batchを一括承認する。
3. durable queueが実行直前のversionとsourceを確認し、異なるTargetを複数Campaignへdispatchする。
4. ResearchがSemantic Wave、conditional Depth、single source screenを行い、Runtime Verification PacketをHuman OSへ渡す。
5. AI Reproduction後、人間が説明を確認しながら別fresh environmentでRecipeを必ず再実行する。
6. verified FindingだけからAIがtemplate reportを作り、人間がPoCとDescriptionを承認する。Programme Adapterは承認済みrevisionをSubmit直前まで入力し、最後のSubmitは人間だけが行う。

- 通常運転はraw-source-first。Reconとwhole-target Baselineを並行し、最大4個の独立thesisを保つ。
- Candidateを支持数、多数決、到着順で捨てない。
- strong semantic frontierだけをconditional Depthへ送る。
- Validationは一つのfreshなsource screenで決定的な反証だけを除き、`ready-for-runtime`を作る。
- AI Reproduction成功だけを通常のHuman Queueへ送り、人間が別fresh instanceで同じRecipeを必ず再実行する。
- Findingへの昇格は人間のmandatory fresh reproductionだけが行う。
- source-to-sinkは人間への説明に使うが、Target選定や探索をsink中心へ変えない。
- confirmed impactとplausible abuse scenarioを分け、AIの推測をFindingの事実へ昇格しない。

| Mode | Start condition | Goal |
| --- | --- | --- |
| Semantic Research Wave | 全Campaignの通常運転 | candidate、frontier、または根拠付きstop |
| Conditional Depth | high-impactへ伸びる具体的frontier | source-bound routeまたは根拠付きstop |
| Breadth | recall baseline確立後 | recallを維持したcost / throughput改善 |

Surface Map、AST、PHP Program Index、Semgrep、CodeQLは補助toolであり探索境界ではない。

## Stable handoffs

| Artifact | Producer -> Consumer | Meaning |
| --- | --- | --- |
| Selection Receipt | Target Selection -> Human Batch Approval | oracle-freeな候補、理由、不確実性 |
| Approved Target Batch | Human -> Target Campaign Dispatch | Target順、policy、Opus profile、budget、execution window |
| Target Intake Packet | Target Intelligence -> Research | oracle-free identityとsource manifest |
| Immutable Target Snapshot | Target Intelligence -> Research tools | 実行しないmanifest-bound source |
| Campaign Coverage Receipt | Research -> Target Intelligence | candidate detailsを除いたlifecycle、resume、terminal state |
| Research Record / CAS | Research Modules間 | event、artifact、checkpoint、replay source |
| Runtime Verification Packet | Research -> Human OS | source route、control、single Validation、risk、runtime uncertainty |
| Triage Reproduction Packet | Human OS内 | Recipe、AI observation、Private Evidence Bundle参照 |
| Vulnerability Understanding Response | Human OS内 | fact、inference、scenarioを分けた人間向け説明 |
| Approved Submission Draft | Human -> Form Stager | 人間確認済みPoC、Description、report revision |
| Evidence Request | Human OS -> finite Research work | 不足証拠を新しいworkとして要求 |

## Completion boundaries

| Boundary | Complete when |
| --- | --- |
| Target selection | Selection Receiptと理由がdurable |
| Batch approval | 人間判断、policy、budget、execution windowがdurable |
| Batch dispatch | 全Targetがterminal、paused、staleまたは理由付きfailure |
| Research work | decision、typed failure、または次workがdurable |
| Research Campaign | Explorationとsingle Validationが閉じ、Runtime Packet、未解決事項、再開条件がdurable |
| AI Reproduction | runtime-confirmedまたは理由付きruntime-inconclusiveがdurable |
| Human Verification | 人間が別fresh instanceでRecipeを実行し、結果を記録 |
| Report preparation | 人間がPoCとDescriptionを確認したApproved Submission Draftがdurable |
| Research product goal | Human Verification済みFindingまで閉じる |
| Operating loop | Approved Submission Draftとhuman-ready stagingまで閉じ、提出は人間が行う |

`validation-pending`やbudget exhaustionをnegativeへ読み替えない。外部報告・公開はFindingとは別の承認を要する。

## Scheduling and model policy

- 初期baselineはOpus単一modelとする。Finder間はmodelが同じでもsession、conversation、scratch、thesisを共有しない。
- Target Campaignのactive目安は5件とする。待機Target数、active Campaign数、active Model Attempt数を別policyで制御する。
- Validation、Synthesis、terminal処理を新規Finderより優先し、探索だけでcapacityを使い切らない。
- rate limit、provider unavailable、capacity timeoutをno-findingへ丸めず、Opus以外へsilent fallbackしない。
- GLM、Grok、Daybreak等のmulti-model化はOpus baselineとのrecall、unique candidate、runtime成立率、cost比較後に判断する。

## Trust rules

- Target sourceをhost上で実行しない。
- FinderとValidatorにはmanifest-boundなread-only source toolだけを渡す。
- Agentへambient shell、network、credential、container socket、MCPを渡さない。
- AIと人間のruntime確認は互いに異なるfreshな使い捨て隔離環境だけで行う。
- exact payload、HTTP request、screenshot、runtime logはHuman OSのPrivate Evidence Bundleへ置き、Gitへ入れない。
- credential、private Target、transcript、PoC、未公開FindingをGitやResearch artifactへ含めない。
- AIはTarget選定、理解支援、report作成を行えるが、人間のBatch承認、fresh reproduction、Draft承認、Submitを代行しない。

## Capability order

1. current write Interfaceをlegacy replayから分離する。
2. single Validation、Runtime Packet、AI Reproduction、Triage Packet、mandatory Human Verificationを閉じる。
3. Validation crash recoveryとCampaign remaining budgetを固め、一件のoracle-free Prospective Campaignを完走する。
4. Target Intelligenceの選定、Batch承認、Opus capacity、無人dispatchを接続する。
5. 三件のparallel pilot後、多数Targetと約5 active Campaignへ広げる。
6. 人間の理解支援、template report、Draft承認、form stagingを閉じる。
7. Missing-linkとCoverage policyを実測で改善し、recall-preserving ablationを行う。

現在動く範囲は[Codebase Guide](CODEBASE-GUIDE.md)、research policyは[Research Design](RESEARCH-DESIGN.md)、次の有限workは[GitHub Issues](https://github.com/momoponwork1415-lgtm/wordpress-harness/issues)を参照する。
