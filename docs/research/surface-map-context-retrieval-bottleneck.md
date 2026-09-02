# Surface Map context retrieval bottleneck

Status: research note, 2026-09-02

## Scope and conclusion

private custom-wrapper benchmarkで、同じdeterministic Surface Map、固定Top-N Focus、事前梱包した最大8 fileの`Analysis Unit@v1`を使うoracle-free Finderを18回実行したが、既知routeへ到達しなかった。Target固有のpath、identifier、payload、Findingは公開repositoryへ記録しない。失敗の共通点は、custom wrapperの定義と、そのwrapperからsensitive operationまでのsourceがAnalysis Unitへ入らなかったことである。

これは現時点では「Opusの推論能力が頭打ち」という証拠ではない。同じ固定contextを再試行して得られるのはmodel出力の分散であり、context外のsourceを新しく観測する経路にはならない。次に実装すべきvertical sliceは、Surface Mapを完全化することでもfile上限を一律に増やすことでもなく、`Analysis Unit`をseedにしたharness-ownedのbounded source retrieval loopである。

## Primary-source facts

### OpenAI Codex Security

Codex Securityはauthorized inventoryとoffline search commandを各workerへ渡し、source-backedなInvestigation Packetを開始点にする。Focused Investigatorには、packetをrepository探索の境界とみなさず、caller、dataflow、control、concrete implementation、sibling routeまで実sourceを追うよう要求する。coverageはsearch hitではなく、workerがfully reviewedと申告しparentがinventoryと照合したfileだけで数える。[`core-scan.md`, Core Workflow / Focused Investigator](https://github.com/openai/codex-security/blob/69c500398c5a4565290cbb609ff5f254f2d1acc5/plugins/codex-security/references/core-scan.md#L9-L24) [`core-scan.md`, Investigator Prompt](https://github.com/openai/codex-security/blob/69c500398c5a4565290cbb609ff5f254f2d1acc5/plugins/codex-security/references/core-scan.md#L65-L84)

Finding Discoveryは`entrypoint/wrapper`、`root_control`、`sink`、`concrete_implementation`を別location roleとして保持し、shared wrapperを見つけた時はsibling callsiteへ展開する。[`finding-discovery/SKILL.md`](https://github.com/openai/codex-security/blob/69c500398c5a4565290cbb609ff5f254f2d1acc5/plugins/codex-security/skills/finding-discovery/SKILL.md#L44-L60) これはwrapper callだけを最終sinkへ潰さず、両端のsource evidenceを残す直接的な先例である。

ここから直接支持されるのは、Map/Packetは探索開始点であり、関連implementationへのsource retrievalを閉じてはならないことと、取得・reviewした範囲をcoverageとして別に記録することである。Codex Securityの公開core scanはPHP AST graphやcustom wrapper modelの実装を提供しない。

### Anthropic reference harness and Semgrep downstream

AnthropicのBest Practicesは、全contextをpromptへ詰めずtoolから取得可能にすること、Sourcegraph等でdefinition/call siteを辿れるようにすること、partial chainで不足primitiveを特定した後にfresh sessionでそのprimitiveを探すことを勧める。また初回coverageが薄い時はworker数の追加ではなくreconとpartitionをやり直すとしている。[Best Practices: map, scope, equip](https://github.com/anthropics/defending-code-reference-harness/blob/d3bea6b5793b5f3d59a75ebe69a58efa88383145/docs/best-practices.md#L26-L41) [Best Practices: iteration and large codebases](https://github.com/anthropics/defending-code-reference-harness/blob/d3bea6b5793b5f3d59a75ebe69a58efa88383145/docs/best-practices.md#L114-L183)

公開pipelineのReconは5〜15のinput-processing subsystemを作るが、Find workerは固定file bundleだけを読むのではない。sandbox内のsource treeを`grep`/readし、focus areaから開始して行き詰まれば範囲を広げる。[`recon_prompt.py`](https://github.com/anthropics/defending-code-reference-harness/blob/d3bea6b5793b5f3d59a75ebe69a58efa88383145/harness/prompts/recon_prompt.py) [`find_prompt.py`](https://github.com/anthropics/defending-code-reference-harness/blob/d3bea6b5793b5f3d59a75ebe69a58efa88383145/harness/prompts/find_prompt.py#L238-L245) Semgrep downstreamもReconで異なる開始点を作り、各Find agent自身がsourceを読み探索経路を選ぶ構造を維持している。[Semgrep pipeline, Recon and Find](https://github.com/semgrep/defending-code-harness/blob/9fe924b2a9acc320e6eec80becce338175e96ba6/docs/pipeline.md#what-each-stage-does) 名前に反して、この公開forkにSemgrep/CodeQL scannerをSource Mappingへfeedbackするproduction実装は確認できない。

このrepositoryではprovider組込みshellをFinderへ渡せないため、同じ自由度をshellで移植してはならない。移植可能なのは「Focusは開始点でありfile境界ではない」「不足contextをworkerが追加取得できる」というbehaviorである。

### OpenAnt

OpenAntはdeterministic reachabilityを先に計算し、LLMがframework/plugin固有registration等の追加entry pointをtyped signalとして提案した後にBFSを再実行する。structural entry pointはdemoteせず、AI signalはpromote-only overlayになる。[`llm_reachability.py`](https://github.com/knostic/OpenAnt/blob/bf8385c197c3eeaed172392b09221bc9871ea9f5/libs/openant-core/core/llm_reachability.py#L1-L28) [`llm_reachability.py`, overlay and rerun](https://github.com/knostic/OpenAnt/blob/bf8385c197c3eeaed172392b09221bc9871ea9f5/libs/openant-core/core/llm_reachability.py#L487-L611)

OpenAntはparserのfunction inventoryとbidirectional call graphからdepth-bounded unitを作るが、その固定unitだけで完結しない。Context Enhancerが最大20 iterationのtool loopでstatic dependency、definition、usage、full function、file内function、file rangeを追加取得する。上限到達やfinishなしは`neutral`ではなく`incomplete`として残す。[`agent.py`](https://github.com/knostic/OpenAnt/blob/bf8385c197c3eeaed172392b09221bc9871ea9f5/libs/openant-core/utilities/agentic_enhancer/agent.py) [`tools.py`](https://github.com/knostic/OpenAnt/blob/bf8385c197c3eeaed172392b09221bc9871ea9f5/libs/openant-core/utilities/agentic_enhancer/tools.py#L1-L159) [`repository_index.py`](https://github.com/knostic/OpenAnt/blob/bf8385c197c3eeaed172392b09221bc9871ea9f5/libs/openant-core/utilities/agentic_enhancer/repository_index.py)

今回のbottleneckへ最も直接対応する公開実装はこの二段構成である。ただしOpenAntのusage searchにはname-basedな近似があり、modelが選んだ`include_functions`もそれ自体はreachability factではない。またPHP call graphのmember resolutionは単純なreceiver variableを主対象にし、nested property receiverを一意に解決する保証はない。[PHP `call_graph_builder.py`](https://github.com/knostic/OpenAnt/blob/bf8385c197c3eeaed172392b09221bc9871ea9f5/libs/openant-core/parsers/php/call_graph_builder.py#L488-L520) 本harnessでは取得候補とsource anchorを記録し、ambiguous relationを`observed`へ昇格させない必要がある。

### Semgrep and CodeQL feedback

Semgrepのtaint ruleはsource、sink、sanitizer、propagatorを明示できる。公式Glossaryは、engineがcallのtaint propagationを推測できない場合、custom propagatorを明記する必要があると説明する。一方、Semgrep CEはper-file analysisに限定され、interfile analysisはproprietary engineだけが行う。[Semgrep static-analysis glossary](https://docs.semgrep.dev/writing-rules/glossary)

AnthropicはVerified Findingの構文的shapeをSemgrep/CodeQL ruleへして安価なfloorにする一方、ruleはcross-file reasoningを置き換えないと明記する。[Best Practices: codify findings](https://github.com/anthropics/defending-code-reference-harness/blob/d3bea6b5793b5f3d59a75ebe69a58efa88383145/docs/best-practices.md#L121-L129) CodeQLはsupported languageでcustom source、sink、summary、barrier modelを追加できるが、GitHubの公式一覧はPHPを非対応と明記する。[CodeQL custom library models](https://codeql.github.com/docs/codeql-language-guides/customizing-library-models-for-cpp/) [GitHub: CodeQL supported languages](https://docs.github.com/en/code-security/concepts/code-scanning/codeql/codeql-code-scanning#about-codeql)

したがって現在のPHP/WordPress sliceでは、CodeQL導入はbottleneckの解決にならない。Semgrep ruleも未知wrapperを自動理解するものではなく、独立Verification済みのwrapper/flow shapeを再利用するfeedback artifactとして評価する。

### Aikido

Aikidoのfirst-party materialは、AI Code Analysisがfile/moduleをまたいでreferenceを追い、単一lineでは成立しないrouteを扱うと説明する。[Aikido AI Code Analysis](https://www.aikido.dev/blog/introducing-code-audit-find-complex-vulnerabilities-hidden-in-your-codebase) ただし公開記事からは、source retrieval protocol、graph schema、wrapper model、context budget、prompt、regression corpusを確認できない。よって目標像の補助情報にはなるが、今回の実装判断のreference implementationにはしない。

## Recommendation for this harness

以下は上記sourceと今回の失敗から導くharness固有の提案であり、外部projectの仕様ではない。

1. **`Analysis Unit@v1`を廃止せずseedへ位置付ける。** Initial promptにはFocus、高信号Map subgraph、source slice、known gapを入れるが、その8 fileを探索可能範囲の上限にしない。
2. **harness-owned Source Retrievalを追加する。** 最小tool setは`search symbols/usages`、`read symbol`、`read anchored range`、`graph neighbors`とする。path confinement、Target digest、file digest、byte/turn/hop budgetをharnessが検査し、provider shell、network、ambient MCPは公開しない。
3. **取得をtyped artifactにする。** Finderは`Context Request`へsubject、reason、期待relationを出し、resolverはstable orderの`Context Response`として`resolved | ambiguous | not-found | budget-exhausted`を返す。continuation Attemptは取得したdigestへ結び付け、同じrequestの反復またはno-progressで`unknown`として終了する。具体的なbudget値は複数benchmarkの実測から決め、一つのCaseへ固定しない。
4. **wrapper semanticsをAI proposalとdeterministic factへ分ける。** PHP Indexはcall expression、receiver/property chain、argument、assignment、return、definition candidateを観測する。AI Mapper/Finderは`argument -> return`、`argument -> sensitive operation`等の`Wrapper Model Proposal`をsource anchor付きで提案できるが、compilerはanchorと候補definitionを検査し、model由来relationを`inferred`として保存する。実行時成立はVerificationへ残す。
5. **Top-Nをpriorityに限定する。** rank外をcoverage済みまたはsafeにしない。Context Request、unreached sink family、unresolved wrapper、untouched inventoryを次Waveのrepartition入力にし、同じ固定contextへの追加並列よりcoverage frontierを動かす。
6. **Verified Findingからだけstatic feedbackを昇格する。** `Finding -> Wrapper/Rule Candidate -> positive/negative/control fixture -> original replay -> held-out plugin family`の順でSemgrepまたはPHP Knowledge ruleを評価する。rule hitはMap enrichmentまたはHypothesis seedであり、Findingではない。PHPの間はCodeQLを保留する。

## Next acceptance scenario

次のproduction behaviorは一つに絞る。固定Analysis Unitに未知custom wrapperのimplementationが含まれない合成Boundary Pairで、Finderがwrapper definitionとusageをtyped requestし、上限内のContext Responseを受け、source-bound security Hypothesisを返せることをred-greenで示す。negative/controlでは同じretrieval routeを通してHypothesisが棄却され、取得不能時はfalse negativeを`safe`へ丸めず`unknown`または`budget-exhausted`として残す。

このsliceが通るまで、同一Map・同一Focus・同一Analysis UnitでOpus試行数だけを増やす実験は止める。次に測るべき値はtoken消費ではなく、`Context Reach`、新規source anchor数、wrapper resolution、Hypothesis Recall、取得budgetである。

この調査を反映した当時のdesignと最初の実装sliceは、[Evidence-guided Finder loopの旧設計snapshot](../history/evidence-guided-finder-loop-2026-09-02.md)に凍結している。現在の判断は[ADR 0113](../adr/0113-keep-finder-methods-free-behind-an-evidence-shell.md)を優先する。
