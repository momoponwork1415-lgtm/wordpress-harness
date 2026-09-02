# Exploration correction traceability

Status: supporting research note, 2026-09-02

## Purpose

実装済みのExploration correctionについて、外部referenceから直接採ったpatternと、このharnessで加えた判断を区別する。設計の正本は[Design references](../REFERENCES.md)の3件のままとし、OpenAnt、Vulnhuntr、Codex Securityは公開実装を確認する補助資料としてのみ使う。

判断の由来を次の4種類で表す。

- **A — Direct reference pattern**: 一次資料または公開source codeが同じpatternを明示する。
- **B — Synthesis / adaptation**: 複数のAをWordPress harness向けに組み合わせ、境界または強度を変えた。
- **C — Local empirical correction**: private characterization、実Target、Boundary Pair、または現行実装の観測から修正した。外部projectのpatternとは主張しない。
- **D — Original proposal**: 外部資料が具体的に規定せず、このharnessの評価可能性、安全性、保守性のために提案した。

一つの設計判断が複数種類を持つ場合がある。たとえば「独立Verifier」はAだが、「sibling Causal ControlをFinding必須条件にする」はDである。

## Evidence matrix

| Current correction | Classification | Directly evidenced basis | Boundary of the claim |
| --- | --- | --- | --- |
| Provider/model-neutral Model Profiles | **A + B** | WordfenceはArgusをmodel agnosticとしてcapabilityとpriceを継続比較する。OpenAntはphaseごとにprovider/modelを設定する。Mandiantはentry discoveryへlightweight modelを割り当てる | versioned Profile schema、transport admission、domain contractからprovider名を排除する具体形はB |
| Cheap eligible model can traverse the full path | **D**, with A precedent | Mandiantのcheap entry-discovery roleとOpenAntのstrong/light phase別割当はcost-aware specializationを支持する | 安価なProfileで`Target -> Map -> Focus -> Context -> Hypothesis -> Verification`を再現することをharness品質目標にするのは本提案。まだCの実証はない |
| Deterministic Surface Map skeleton + bounded model retrieval | **A + B + C + D** | Anthropicのmap-first、code-search、dependency wishlist、OpenAntのparser/index/tool loop、Vulnhuntrのbounded context request | `observed/inferred/unknown`、immutable revision、typed Context Request/Responseの正確なcontractはB/D。必要性は5 plugin familyのCで補強 |
| Reachability / information gain / coverage debt Focus ranking | **A + B + C + D** | Mandiantのentry enrichment、Anthropicのrisk rankingとcoverage-driven repartition、OpenAntのreachability seed | route-shaped priorityはB。`expected information gain -> coverage debt -> stable identity` tupleはD。粗いround-robinの失敗はC |
| Stage gates and gate-local diagnosis | **A + B + C + D** | Mandiantのsequential stage completion、AnthropicのDiscovery/Verification分離とcheap programmatic gate、Codex Securityのexact inventoryとtyped scan artifacts | 現在の6 gate名と、失敗をmodel能力へ一括帰属しない診断法はD。Target bytes不一致の観測はC |
| Independent Verification, Witness, Causal Control | **A + B + C + D** | Anthropicのclean independent graderとexecutable witness、Mandiantの別Validation agentsとdynamic PoC reproduction | WitnessをWordPress category別に型付けするのはB。sibling Causal Controlとpromotion contractはD。Brizy Boundary PairはC |
| Translation / bundled / generated asset classification | **A + B + C + D** | Mandiantのasset inventory/SBOM、Anthropicのgenerated-code rankingとdependency wishlist | translationの独立分類、bundled provenance、generated/minifiedをgapへ送る具体policyはD。bundled debug sink等への誤FocusはC |

## Trace by correction

### 1. Model Profiles and the cheap-model goal

**A.** Wordfenceが公開しているのは、Argusがmodel agnosticであり、新modelをcapabilityとpriceの均衡で継続評価し、task-specific model selectionとdeterministic programmingを組み合わせるという範囲である。[Wordfence Argus](https://www.wordfence.com/blog/2026/08/wordfence-argus-moving-beyond-human-research-capability/) Mandiantはin-scope fileからentry pointとuser inputを抽出する大量処理に`Gemini Flash Lite`を使い、後続のEnrichment、Access Control、Data Flow、Validationへ別agentを置く。[Mandiant AVDH, Entry Point Discovery–Hypothesis Validation](https://cloud.google.com/blog/topics/threat-intelligence/staying-ahead-of-adversarial-ai-through-agentic-source-code-review) OpenAntもphaseごとのprovider/model bindingを型として持ち、context enhancementへcost重視のmodel、detection/verificationへ強いmodelを割り当てる既定を実装する。[OpenAnt `config.py`](https://github.com/knostic/OpenAnt/blob/8bdc94251e4c50e5027db8829358ed3d3f8de87f/libs/openant-core/utilities/llm/config.py#L7-L36) [`builtins.py`](https://github.com/knostic/OpenAnt/blob/8bdc94251e4c50e5027db8829358ed3d3f8de87f/libs/openant-core/utilities/llm/builtins.py#L37-L58)

**B.** これらから、Finder/VerifierをOpusという型にせず、role contractを満たすModel Profileをorchestratorが選ぶ形へ適応する。ただし各projectのprovider設定をそのまま共通API化するのではなく、provider固有effort、transport、認証、tool capabilityをProfileとReceiptへ閉じ込める。[Model Execution seam](../design/model-execution-seam.md)

**C/D.** 現在実証済みなのは`claude-opus-5 / high`のvertical sliceであり、安価なProfileの同等経路は未実証である。したがってcheap-model compatibilityを既存実績とは書かない。「強いmodelが不足contextを推測できた」ことではなく、安価なeligible Profileでも全gateを通せるほどMap、Focus、tool、schemaを深くすることは、比較可能なharness quality goalとしてのDである。[Model candidates](../design/model-candidates.md#モデル可搬性の要件model-portability-requirement) 外部根拠に忠実な上位目標は「最安model」ではなく`capability/cost fit`であり、cheap Profileでの再現はharness寄与を測る下位評価目標とする。

### 2. Surface Map skeleton and bounded context retrieval

**A.** Anthropicはscan前にsystem/trust boundaryをmapし、全sourceをpromptへ詰めず、toolからcontextへアクセスさせる。またlarge codebaseにはdefinition/call-siteを辿るcode-search indexと、必要dependencyだけを再投入するwishlistを勧める。[Anthropic Best Practices, Map/Scope/Equip](https://github.com/anthropics/defending-code-reference-harness/blob/d3bea6b5793b5f3d59a75ebe69a58efa88383145/docs/best-practices.md#before-you-scan-map-scope-equip) [同, Large codebases](https://github.com/anthropics/defending-code-reference-harness/blob/d3bea6b5793b5f3d59a75ebe69a58efa88383145/docs/best-practices.md#large-codebases) Codex Securityのinventory generatorはin-scope file母集団をexactかつstable orderで保存する。[`generate_in_scope_files.py`](https://github.com/openai/codex-security/blob/cfde3f4c0922656caa625c1fad42aa1f7ba1df71/plugins/codex-security/scripts/generate_in_scope_files.py)

OpenAntは`repository scanner -> AST extractor -> call graph -> unit generator`のdeterministic skeletonと、function indexを検索する最大20 iterationのagent loopを実装する。[OpenAnt parser contract](https://github.com/knostic/OpenAnt/blob/8bdc94251e4c50e5027db8829358ed3d3f8de87f/adding-a-parser.md) [`agent.py`](https://github.com/knostic/OpenAnt/blob/8bdc94251e4c50e5027db8829358ed3d3f8de87f/libs/openant-core/utilities/agentic_enhancer/agent.py) [`repository_index.py`](https://github.com/knostic/OpenAnt/blob/8bdc94251e4c50e5027db8829358ed3d3f8de87f/libs/openant-core/utilities/agentic_enhancer/repository_index.py) Vulnhuntrもmodelの`name/reason/code_line`要求をJedi resolverで補い、追加contextが増えないか最大7 iterationで停止する。[Vulnhuntr secondary analysis loop](https://github.com/protectai/vulnhuntr/blob/ead88c5adba4279dae5c56d65124c530a9a1c5ae/vulnhuntr/__main__.py#L401-L486)

**B/D.** 本設計は、完全call graphを作るのではなく、deterministic inventory/anchorを`observed`として固定し、model relationを`inferred`、不足を`unknown`にする。typed request、ambiguity、budget exhaustion、次revisionだけへの反映というcontractは外部実装の直接コピーではなくB/Dである。[Source Mapping seam](../design/source-mapping-seam.md)

**C.** 5 plugin familyの実測で、局所構文抽出が安定してもsuperglobal、直接request候補、cross-file/cross-request relation等が現行Mapから欠けることを確認した。これはdeterministic skeletonを捨てる理由ではなく、bounded AI Mapperと追加relationを導入するローカル根拠である。[Five-plugin-family sample](white-box-surface-mapping-security-reference.md#five-plugin-family-sample)

### 3. Focus ranking

**A.** Mandiantはthreat model後にentry pointを列挙し、entryごとのEnrichment agentがdistributed sanitizer、permission、routing、nested callを集めて後続analysisへrouteする。[Mandiant AVDH, Context Enrichment](https://cloud.google.com/blog/topics/threat-intelligence/staying-ahead-of-adversarial-ai-through-agentic-source-code-review) Anthropicはentry point、parser、auth、untrusted inputを上げ、test/header/generated codeを下げるfile rankingと、未到達surfaceが多い時はagent数でなくre-partitionすることを勧める。[Anthropic Best Practices, Large codebases](https://github.com/anthropics/defending-code-reference-harness/blob/d3bea6b5793b5f3d59a75ebe69a58efa88383145/docs/best-practices.md#large-codebases) OpenAntはentry-point reachabilityを絞り込みへ使う一方、call graphのmissing edgeを認め、LLM seedでstructural entryをdemoteせずpromoteだけする。[`reachability_analyzer.py`](https://github.com/knostic/OpenAnt/blob/8bdc94251e4c50e5027db8829358ed3d3f8de87f/libs/openant-core/utilities/agentic_enhancer/reachability_analyzer.py) [`parser_adapter.py`](https://github.com/knostic/OpenAnt/blob/8bdc94251e4c50e5027db8829358ed3d3f8de87f/libs/openant-core/core/parser_adapter.py)

**B.** Target固有entry、trust transition、state、dangerous sinkを単一node kindより先に比較し、到達根拠のないbundled codeを削除せず初回重複割当だけ避けるのは、上記のreachability/risk/coverage patternをfalse-negative-safeに適応したものだ。

**C.** 旧実装のstable-ID category round-robinがbundled debug sink、relationのないtemplate、小さな補助PHPを上位へ置く一方、外部REST entryをseedにしたAttemptはsource-bound Hypothesisを作った。このprivate characterizationがFocus correctionの直接原因である。[当時のExploration agent architecture](../history/exploration-agent-architecture-2026-09-02.md#1-現行map-first実装移行元) private artifactはGitへ置かないため、公開benchmark結果とは主張しない。

**D.** 同順位を`expected information gain -> coverage debt -> stable identity`で決め、model confidenceを使わない正確なtupleは本harnessの提案である。外部資料はrisk rankingとcoverage測定を支持するが、この順序や計算式を規定しない。[Exploration seam](../design/exploration-seam.md#focus-correction-sliceaccepted--implemented)

### 4. Stage gates

**A.** Mandiantはspecialized agentをsequential pipelineへ接続し、各phaseを完了してから次へ進め、threat modelには明示的approval gateを置く。[Mandiant AVDH, Architecting the Pipeline–Threat Modeling](https://cloud.google.com/blog/topics/threat-intelligence/staying-ahead-of-adversarial-ai-through-agentic-source-code-review) AnthropicはDiscoveryとVerificationを別目的にし、agentic gradingより前にcheap programmatic gateを置く。[Anthropic Best Practices, Verification](https://github.com/anthropics/defending-code-reference-harness/blob/d3bea6b5793b5f3d59a75ebe69a58efa88383145/docs/best-practices.md#verification-the-load-bearing-component) Codex Securityもexact inventory、source-backed investigation packet、typed candidate、parent validationを別artifact/stepで扱う。[Codex Security core scan](https://github.com/openai/codex-security/blob/cfde3f4c0922656caa625c1fad42aa1f7ba1df71/plugins/codex-security/references/core-scan.md#core-workflow)

**B/D.** これを`Target Identity -> Map Coverage -> Focus Rank -> Context Reach -> Hypothesis Recall -> Verification`へした6 gateは本harnessの診断用adaptationである。最終Finding数だけを見ず、「対象が違う」「Mapが欠ける」「重要Focusを選べない」「必要sourceへ届かない」「仮説を作れない」「実証できない」を分ける命名と観測contractはDである。[当時の探索エージェント構成](../history/exploration-agent-architecture-2026-09-02.md)

**C.** Simply Schedule Appointmentsの校正では、同じ表示versionでも取得bytesが想定したvulnerable snapshotではなく、Gate 1で比較を止めるべき事例を観測した。これはmodel effortを上げる前にTarget digestを確認するcorrectionのローカル根拠であり、一般benchmark結果ではない。[当時の探索エージェント構成](../history/exploration-agent-architecture-2026-09-02.md)

### 5. Independent Verification, Witness, and Causal Control

**A.** AnthropicはDiscoveryとVerificationを分け、Finderが触れていないclean sandboxへartifactだけを渡し、文章よりcrash/leaked value等のexecutable witnessを優先し、固定snapshot上のprogrammatic success criterionで判定する。[Anthropic Best Practices, Verification](https://github.com/anthropics/defending-code-reference-harness/blob/d3bea6b5793b5f3d59a75ebe69a58efa88383145/docs/best-practices.md#verification-the-load-bearing-component) Mandiantも仮説生成後に新しいValidation agentsを使い、最終的には別のexpertがPoCをdynamicに再現し、失敗したcandidateを破棄する。[Mandiant AVDH, Hypothesis Validation–Expert Validation](https://cloud.google.com/blog/topics/threat-intelligence/staying-ahead-of-adversarial-ai-through-agentic-source-code-review)

Wordfenceの公開記事が明かすのは10原則中の`verify`だけであり、Verifier数、sandbox、Witness、controlの具体設計は非公開である。[Wordfence Argus](https://www.wordfence.com/blog/2026/08/wordfence-argus-moving-beyond-human-research-capability/) それらをArgus由来と推測しない。

**B/D.** WordPressのRCE、SQLi、Stored XSS等へcategory-specific Witnessを作るのはAの適応である。positiveと同じbaselineから必要条件だけを変えたsibling Causal Control、同じCausal Identityへのbinding、両方を要求するFinding promotionは外部三資料が具体的に規定しないDである。

**C.** 現行Brizy Boundary Pairでは2.8.11をbrowser Witness付きFinding、2.8.12を同じcauseが消えるDisprovedとしてfresh gVisor experiment pairで記録した。これはこのpromotion contractのlocal evidenceであり、全vulnerability classへの一般化はまだしていない。[Codebase Guide, current vertical path](../CODEBASE-GUIDE.md#現在動く縦の経路) [`verification.test.ts`](../../tests/research/verification.test.ts) [`gvisor-stored-xss-lab.test.ts`](../../tests/research/gvisor-stored-xss-lab.test.ts)

### 6. Translation, bundled, and generated assets

**A.** Mandiantはasset inventoryとSBOMをenvironmental inputにし、Explorerがdocumentationを読み、除外directoryを判断する。[Mandiant AVDH, Architecting the Pipeline–Threat Modeling](https://cloud.google.com/blog/topics/threat-intelligence/staying-ahead-of-adversarial-ai-through-agentic-source-code-review) Anthropicはgenerated codeを初期risk rankingで下げるが一律に安全とはせず、dependencyはfull mountではなくwishlistで必要なmoduleだけ追加する。[Anthropic Best Practices, Large codebases](https://github.com/anthropics/defending-code-reference-harness/blob/d3bea6b5793b5f3d59a75ebe69a58efa88383145/docs/best-practices.md#large-codebases)

**B.** したがってnon-PHP assetを一律除外せず、Target固有routeへの関係とprovenanceで扱いを変える。ただしOpenAntのPHP extractorとContext Correctorは`vendor`、`node_modules`、generated code等を除外するため、この部分をWordPress pluginへそのまま採用しない。[OpenAnt PHP extractor exclusions](https://github.com/knostic/OpenAnt/blob/8bdc94251e4c50e5027db8829358ed3d3f8de87f/libs/openant-core/parsers/php/function_extractor.py#L977-L995) [`context_corrector.py`](https://github.com/knostic/OpenAnt/blob/8bdc94251e4c50e5027db8829358ed3d3f8de87f/libs/openant-core/utilities/context_corrector.py#L28-L49)

**C.** private Focus characterizationでbundled libraryのdebug sinkやrelationのないtemplateへ初回の希少Leaseを使う例があり、5 plugin family実測では大量のnon-PHP gapと、PHPだけでは閉じない公開routeを確認した。[Exploration seam, Focus correction](../design/exploration-seam.md#focus-correction-sliceaccepted--implemented) [Five-plugin-family sample](white-box-surface-mapping-security-reference.md#five-plugin-family-sample)

**D.** `translation`、`bundled-vendor`、`generated`、`minified`、`binary`、`unsupported`を別classificationにし、translation/generatedをeffort escalation理由にせず、bundled codeをprovenance付きで保持し、generated/minified/binaryをmetadataとgapから必要時だけ取得する具体policyは本harnessの提案である。[Source Mapping seam, Source and asset coverage](../design/source-mapping-seam.md#source-and-asset-coverage)

## Argus disclosure boundary

Argusから直接採用できるのは、10動詞、model-agnosticなcapability/price評価、task-specific model selection、LLMとtraditional deterministic programmingの併用という公開記述までである。[Wordfence Argus](https://www.wordfence.com/blog/2026/08/wordfence-argus-moving-beyond-human-research-capability/) Surface Map schema、Focus rank、Context Request、stage gate、Verifier topology、Witness、Causal Control、asset classificationの具体形は公開されていない。これらを「Argusと同じ」とは記述せず、上のB/C/Dへ分類する。

## Resulting design claim

現在のcorrectionを最も正確に表すと、次のようになる。

> 参照実装から、model-neutral specialization、map-first、bounded source navigation、entry/reachability focus、separate verification、executable evidenceというpatternを直接採る。その上で、WordPress実Targetの失敗観測を使い、evidence-graded Map、route-shaped Focus、6段階診断、typed Witnessとsibling Causal Control、asset provenanceを本harness向けに合成・追加する。

したがって、cheap model対応、information-gain/coverage-debt tuple、6 gate、translation分類、Causal Controlを外部referenceの既成best practiceとして正当化しない。これらは今後、固定Target、同一Profile/Focus/budget、Boundary Pair、実戦Campaignのartifactで検証する提案である。
