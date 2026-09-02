# Evidence-guided Finder loop

Status: accepted, 2026-09-02

## Decision summary

Finderを、最初に渡された固定source断片だけで結論を出す一回完結処理から、固定Target Snapshotの中を予算付きで追跡できる有限loopへ変更する。

```text
Work Lease
    |
    v
Initial Context -----> Finder Attempt
                         |       |
                         |       +----> Terminal Research Output
                         |
                         +----> Source Evidence Query
                                   |
                                   v
                              Tool Receipt
                                   |
                                   +------> Finder Attempt
```

`Initial Context`はSurface Map、PHP Program Index、Focus Areaから決定的に作る。Finderは不足したsourceをharness-ownedなread、search、symbol、graph操作で取得できる。全操作はTarget Snapshot、Work Lease、tool budgetへ拘束し、request、policy decision、responseをprivate CASへ記録する。

公開seamは既存の`ModelExecution.run(AttemptPlan)`から増やさない。provider固有tool protocol、複数tool call、context ceiling、receipt保存、停止処理はModel Execution implementationの背後へ隠す。Campaign Controlは個々のsource queryを知ってはならない。

この設計はSurface Mapを廃止しない。Surface Mapを**探索開始点とcoverage記録**、source toolを**Attempt内の局所追跡**、Mapping Evidence Requestを**Attemptを越えるMap revision要求**として分ける。

## Why now

最初のvertical sliceは、固定`Analysis Unit@v1`とtool-free FinderでCampaignからVerificationまでを早く閉じる目的を達成した。公開済みの二つの脆弱classでは、決定的に選んだ最大8 fileのcontextからsource-bound Hypothesisへ到達できた。

一方、Git外のoracle-freeなprivate benchmarkでは、同じ高能力Model Profileを独立に繰り返しても、custom wrapperを跨ぐ既知routeへ到達しなかった。Focus数を増やす実験と関連fileを先に追加する診断でも改善しなかった。これはモデルの推論時間より前に、次の構造的制限が働いたことを示す。

1. Surface Mapが直接WordPress APIや直接sinkを強く表す一方、Target固有wrapperの意味relationを初期revisionで持たない。
2. Analysis Unitは選択時点で一段だけ広げ、その後Finderがcaller、callee、symbol definitionを追加取得できない。
3. Finder outputはSource-bound Hypothesisまたは空配列だけで、不足sourceを具体的な次workとして返せない。
4. Campaignの`continue-unresolved-work`は次の有限workを記録するが、異なる根拠に基づく新しいWaveへまだ自動reconcileしない。

したがって同一Promptと同一固定contextをさらに並列実行するより、wp2shell由来Promptが持っていた「必要なsourceを自分で追い、missing gapを次roundへ返す」能力を、安全なharness-owned controlとして復元する。

## Ten-verb audit

| Principle | Current state | Correction in this slice |
| --- | --- | --- |
| `confine` | Target digest、read-only source、no web/shell、credential分離は強い | source toolを同じSnapshotとrealpath gateへ閉じ込める |
| `constrain` | schema、file/byte、Attempt、wall budgetは強いが、固定contextが過剰制約になった | context内容ではなくquery能力をcall、byte、depth、result上限で制約する |
| `focus` | Focus AreaとStrategyはあるが、seedがcontext境界にもなっている | Focus ownershipを維持しつつ、因果routeに必要なcross-file追跡を許す |
| `motivate` | sink patternだけで主張しない規則はあるが、空回答を強く促す | security property、terminal artifact、停止条件、次の不足証拠を同時に要求する |
| `parallelize` | 最大3並列はあるが、同じ不足contextを複製し得る | 異なるFocus/Strategy/coverage ownershipを優先し、同じWaveを再実行しない |
| `hypothesize` | source-bound schemaとfalsifierは強いが、証拠不足時の出口が空配列だけ | Hypothesis、Route Fragment、Mapping Evidence Request、Closure Recordを型付きで保持する |
| `verify` | fresh independent Verifier、Witness、Causal Controlは強い | 変更しない。Finder tool receiptをFinding evidenceへ流用しない |
| `record` | CAS/Ledgerとdigest bindingは強い | query scope、走査量、truncation、result digestをTool Receiptへ追加する |
| `prioritize` | 初回Focus順位はあるが、失敗後も同じpriorを使う | 未解決edge、情報利得、coverage debtから次queryと次Waveを選ぶ |
| `iterate` | 一Wave後のdecisionはあるが、探索中の証拠取得loopと次Wave消費がない | Attempt内tool loopと、Map revisionを伴うWave間loopを別々に実装する |

`confine`、`constrain`、`verify`、`record`を弱めず、過剰に固定した`focus`と`hypothesize`を修正し、`prioritize`と`iterate`を実行可能にするのが要点である。

## Evidence strength of this design

この設計に含まれる判断を、すべて「外部harnessが採用しているから必要」とは扱わない。根拠の強さと反証条件を分ける。

各判断の一次資料、直接precedent、本harnessへのadaptation、未検証部分は、[Evidence-guided Finder loopの設計根拠](../research/evidence-guided-finder-loop-design-evidence.md)のtraceability matrixを正本とする。要約すると、bounded source retrievalはOpenAnt、Codex Security、Anthropic、code-navigation操作はOpenAntとLSP、AI overlayとdeterministic factの分離はOpenAnt、provenanceとdigest-bound receiptはW3C PROV、NIST、in-toto、Bazel、情報不足を陰性へ丸めない状態はOpenAnt、Codex Security、SARIFを先例にする。正確なGateway interface、schema、budgetは本harnessのadaptationまたは未検証の選択として残す。

| Decision | Evidence | Current confidence | What could change it |
| --- | --- | --- | --- |
| 固定Analysis Unitを探索境界にしない | private benchmarkの反復失敗と、Codex Security、Anthropic、OpenAntの局所source展開 | high | toolなし固定contextが複数のunseen Targetでも同等以上のContext Reachを示す |
| bounded source retrievalを持つ | context外sourceは同じprompt再試行では観測不能、成功sliceではroute source到達が必要だった | high | より単純な決定的retrievalだけで同じrecallとcostを再現できる |
| retrievalをharness-ownedにする | untrusted source、credential隔離、provider非依存、replayというproject invariant | high | provider toolが全eligible transportで同じpolicy、receipt、credential分離を証明する |
| source queryとMap revisionを分ける | sourceを読んだ事実とrelation成立は異なり、model proposalをobserved factにできない | high | 同じartifactへ統合してもevidence stateとrevision identityを失わない小さなInterfaceが示される |
| Tool ReceiptをCASへ残す | crash replay、search failureとzero matchの区別、model比較に実際のcontextが必要 | high | 同じ監査性をより少ない永続artifactで満たす設計が示される |
| `read / search / symbol / graph`の四操作 | 調査した実装の共通機能を本projectの既存Indexへ写した最小候補 | provisional | 合成fixtureとprivate benchmarkで冗長、曖昧、または不足と判明する |
| terminal artifactの具体的schema | 現行の空配列がnegative evidenceと不足contextを失う | medium | 複数artifactを失わず、より小さなschemaで同じiterationを表せる |
| call、byte、hop上限の具体値 | まだTarget横断の測定がない | unknown | 複数plugin familyのContext Reach、cost、truncation測定から設定する |

high confidenceの判断も絶対条件ではなく、Behavior Testとoracle-separated benchmarkで反証可能にする。provisionalまたはunknownの判断をADR、public Interface、Target固有heuristicとして固定しない。

## Three different kinds of understanding

### Initial Surface Map

Target全体のinventory、observed source fact、直接API、source anchor、unresolved relation、coverage gapを安定したrevisionとして持つ。完全なsemantic graphをDiscovery開始条件にしない。

### Source Evidence Query

一つのFinder Attemptが現在の因果routeを追うための一時的な読み取りである。sourceを読んだだけではMap relationまたはFindingを追加しない。tool responseはuntrusted target dataであり、引用するsource rangeとdigestを伴う。

### Mapping Evidence Request

Attempt内のsource取得では決められないdynamic dispatch、cross-request state、dependency semantics、runtime observation等を、理由と必要証拠付きで次のMap revisionへ要求する永続artifactである。同じ要求を繰り返さず、受理、拒否、budget exhaustionを記録する。

この三つを一つの「AI補正Map」へまとめない。modelが読んだsource、modelが推論したrelation、harnessが観測したfactの証拠強度が失われるためである。

## Deep seam

context-public interfaceは変えない。

```ts
interface ModelExecution {
  run(plan: AttemptPlan): Promise<AttemptExecutionResult>;
}
```

`AttemptPlan`はrender済みの初期contextに加え、digest固定した`SourceToolPolicyRef`と残budgetを持つ。implementation内部のsource tool seamは一つにする。

```ts
interface SourceEvidenceGateway {
  query(request: SourceEvidenceQuery): Promise<SourceEvidenceReceipt>;
}

type SourceEvidenceQuery =
  | ReadSourceRange
  | SearchSnapshot
  | ResolveSymbol
  | TraverseCodeGraph;
```

これはModel Executionの内部seamである。production adapterは固定Target SnapshotとPHP Program Indexを読み、test adapterは合成Snapshotに対して同じcontractを満たす。Campaign Control、Exploration、provider adapterへfilesystem path解決、search実装、index schemaを漏らさない。

model-visibleなoperationは個別の短いtoolとしてrenderしてよいが、すべてGatewayの同じpolicy、receipt、budget accountingを通す。

### Minimum operations

| Operation | Purpose | Required constraints |
| --- | --- | --- |
| `read` | 指定fileの必要rangeを読む | normalized relative path、line/byte ceiling、file digest |
| `search` | literal、symbol-like token、限定regexをSnapshot内で探す | explicit scope、scan ceiling、result ceiling、truncation |
| `symbol` | definitionとsource-bound reference候補を得る | Program Index revision、ambiguityを保持、推測で一意化しない |
| `graph` | caller、callee、registration、known relationを一段追う | depth ceiling、evidence stateを保持、`unknown`を既知edgeとして辿らない |

arbitrary shell、target runtime、HTTP/browser、network、write、dependency downloadは追加しない。scratch computeが必要になった場合もcredential、network、Target writeを持たない別のaccepted sliceとする。

## Two iteration loops

### Attempt-local loop

```text
initial context
    -> reason about one route
    -> bounded source query
    -> anchored response + receipt
    -> hypothesis, fragment, request, or closure
```

同じAttempt、Target、Lease、Profile、Prompt Set、残budgetの中だけで進む。provider sessionをResearch stateの正本にせず、すべてのtool receiptを先にdurable writeする。tool budgetまたはcontext ceilingに達したら、モデルの自由文で続行せず型付きterminal outputへ移る。

### Wave-to-wave loop

```text
terminal Finder outputs
    -> barrier and deterministic fold
    -> verify hypotheses
    -> synthesize route fragments
    -> revise map when evidence was requested
    -> prioritize net-new finite work
    -> next wave or evidence-bearing closure
```

同じWork Waveを追加回数だけ複製しない。次Waveは、新しいMap revision、新しいRoute Fragment、未所有surface、相反するroute、または具体的なessential gapのいずれかにより前Waveと異なる必要がある。差分がない場合はresource exhaustionをCoverage Closureへ読み替えず、理由付きBlockedにする。

## Terminal Finder artifacts

現行`finder-output.hypotheses: []`を最終形にしない。Finder Attemptのterminal artifactは、少なくとも次を失わず保持する。

- `SourceBoundHypothesis`: 独立Verificationへ渡せる反証可能な候補
- `RouteFragmentProposal`: impactまで未到達でもsource-boundな再利用可能primitive
- `MappingEvidenceRequest`: Attempt外のMap revisionに必要な不足証拠
- `ClosureRecord`: 所有surfaceを列挙した根拠付き局所終了

一つのAttemptがHypothesisとMapping Evidence Requestの両方を生成し得るため、単一の排他的なstatusへ圧縮しない。model confidence、重大度自己申告、長文summary、raw transcriptは正本artifactにしない。

## Prompt correction

wp2shellの文章を巨大Promptとして戻さず、次の性質だけをRole PromptとWork Assignmentへ戻す。

1. 一つのseed fileを説明することではなく、割当security propertyに対する因果routeを閉じることを目標にする。
2. caller、callee、wrapper、guard、persistent stateを必要な範囲で追う。
3. 成立するFindingがあると保証せず、SQLi、Stored XSS、ATO、file primitive等をRCE未満という理由で捨てない。
4. 不足証拠を推測で埋めず、具体的なqueryまたはMapping Evidence Requestへ変える。
5. Hypothesisが作れない時も空配列だけで終わらず、所有surfaceとnegative evidenceをClosure Recordへ残す。

parallelism、budget、tool permission、persistence、resumeはPromptへ戻さない。これらはharness-owned controlのままにする。

## First implementation slice

最初のproduction behaviorは、Surface Map全体のAI synthesisでもCampaignの完全反復でもなく、Finder用Source Evidence GatewayとAttempt-local loopに限定する。

1. 合成plugin fixtureに、外部entry、dispatcher、Target固有database wrapper、query terminal、修正版guardを別fileとして置く。
2. 最初のAnalysis Unitにはroute全体を入れず、Finderがsymbolまたはgraph queryで必要fileへ到達しなければならない条件を作る。
3. deterministic model adapterでtool protocol、receipt、budget、path rejection、truncation、crash recoveryをBehavior Testする。
4. private oracle-free benchmarkで、Target固有名、parameter、known function、patch narrativeを与えず、同じModel Profileからsource-bound SQLi Hypothesisへ到達できるか測る。
5. 修正版Snapshotで同じquery能力がfalse Findingを増やさないことを、独立Verificationと因果対照実験で確認する。

private benchmarkの固有routeをproduction heuristic、fixture、Prompt、Git文書へ写さない。複数Targetに説明できるWordPress/PHP mechanismだけを一般化する。

### Implementation status

2026-09-02にprovider非依存のtracerを実装した。固定Target File Manifestに対するexact `search`とrange `read`、path/digest検査、response truncation、Attempt query ceiling、responseとTool Receiptのprivate CAS保存を、一つの`SourceEvidenceGateway.query`へ閉じた。`ModelExecution.run`はmodel-visible requestにAttempt、Lease、Target Snapshot、Source Tool Policy、query ordinalを付与し、deterministic provider adapterで`search -> read -> Finder output`を一つのAttemptとして通す。

Claude Code用native bridgeは、公式MCP TypeScript SDKのAttempt-local loopback HTTP server、private bearer config、exact tool allowlist、`dontAsk`、connection fail-closedとして同日に実装した。fake providerのexact tool inventoryと`search -> read` Behavior Test、およびsubscription認証済みClaude Code 2.1.258の合成live probeを通過した。現行の実Target Campaignは引き続きtool-freeであり、Attempt Plan materializer、`symbol`、`graph`、complete Attempt Receipt、Route Fragment等は後続sliceである。

## Evaluation vector

単純なFinding数だけで比較しない。同じTarget Snapshot、Map revision、Focus Area、Strategy、Model Profile、effort、Prompt Set、Attempt budgetを固定し、次を観測する。

- essential fileまたはsymbolへ到達した比率
- source queryあたりのnet-new anchored route edge
- repeated query率とtruncation率
- Source-bound Hypothesis、Route Fragment、Mapping Evidence Request、Closure Recordの内訳
- Verificationでのconfirmed、disproved、blocked
- wall time、model token、tool call、read byte
- 同じWaveを再実行した時のnet-new evidence

Source toolあり/なしのablationを先に行い、その後にPrompt wording、effort、model familyを一軸ずつ比較する。複数条件を同時に変えて「Opusが改善した」「Surface Mapが改善した」と結論しない。

## Rejected alternatives

| Alternative | Why rejected |
| --- | --- |
| Surface Map完成後までDiscoveryを待つ | dynamic dispatchとTarget固有wrapperの完全解析が際限なくなり、実戦投入を遅らせる |
| 固定Analysis Unitをさらに巨大化する | relevant contextの保証がなく、安価なmodelほどattentionとcontext costを失う |
| 同じ固定Waveを多数回実行する | model varianceは測れるが、全Attemptが共有するcontext blind spotを解消しない |
| provider組込みshell/filesystemを許可する | Snapshot confinement、credential分離、再現可能なreceiptを失う |
| source queryの結果を自動的にMap factへ昇格する | model retrievalとobserved relationを混同し、誤ったreachabilityを固定する |
| vulnerability class別Finderを増やす | exploration diversityをsurfaceとStrategyではなく既知classへ固定し、未知routeを狭める |

## Approval and implementation gate

この設計は2026-09-02にacceptedとなり、hard-to-reverseな判断を[ADR 0112](../adr/0112-treat-analysis-units-as-seeds-for-bounded-source-retrieval.md)へ固定した。`SourceEvidenceGateway`のsource queryとreceiptを一つずつred-greenで追加し、既存`ModelExecution.run(plan)`と`CampaignRunner.run(plan)`の公開seamを保つ。最初のsliceではRoute Fragment synthesis、Map revisionの自動消費、Gap Review、multi-providerを同時実装しない。

設計根拠は[wp2shell由来Promptの責務分解](../research/wp2shell-prompt-decomposition.md)、[10動詞による再設計メモ](../research/agentic-source-review-ten-verbs.md)、[外部実装とのcontext retrieval比較](../research/surface-map-context-retrieval-bottleneck.md)、[判断別の設計根拠](../research/evidence-guided-finder-loop-design-evidence.md)、[Model execution seam](model-execution-seam.md)、[Exploration seam](exploration-seam.md)に置く。
