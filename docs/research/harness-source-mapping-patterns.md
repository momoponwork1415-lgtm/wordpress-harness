# Harness source-mapping patterns

Status: supporting research note, 2026-09-02

## Position

この文書は、WordPress white-box vulnerability research harnessで、source codeのどこまでを決定論的に事前計算し、どこからをAIへ任せ、何を独立Verificationへ残すかを定めるための実装調査である。[Design references](../REFERENCES.md)の3件を設計上の正本とし、OpenAnt、OpenAI Codex Security、Protect AI Vulnhuntr、IRIS等は実装patternを比較する補助資料としてのみ扱う。

調査したrevisionは次の通りである。branch上の将来変更と混同しないため、実装についてのlinkは可能な限りcommitへ固定した。

- Anthropic `defending-code-reference-harness`: [`d3bea6b`](https://github.com/anthropics/defending-code-reference-harness/tree/d3bea6b5793b5f3d59a75ebe69a58efa88383145)
- Knostic `OpenAnt`: [`8bdc942`](https://github.com/knostic/OpenAnt/tree/8bdc94251e4c50e5027db8829358ed3d3f8de87f)
- OpenAI `codex-security`: [`cfde3f4`](https://github.com/openai/codex-security/tree/cfde3f4c0922656caa625c1fad42aa1f7ba1df71)
- Protect AI `vulnhuntr`: [`ead88c5`](https://github.com/protectai/vulnhuntr/tree/ead88c5adba4279dae5c56d65124c530a9a1c5ae)
- IRIS: [`3a12f45`](https://github.com/iris-sast/iris/tree/3a12f45750f58135bcc58c7fdf4c20786b600e31)
- Visa `visa-vulnerability-agentic-harness`: [`3d972f6`](https://github.com/visa/visa-vulnerability-agentic-harness/tree/3d972f679d8f5e3838b394edee0b5ea9c626b0fb)
- Capital One `VulnHunter`: [`4042d34`](https://github.com/capitalone/VulnHunter/tree/4042d34609ff85e0029dd55743b9c3f677cc984a)
- Semgrep `defending-code-harness`: [`9fe924b`](https://github.com/semgrep/defending-code-harness/tree/9fe924b2a9acc320e6eec80becce338175e96ba6)

結論は次の通りである。

- `Source Mapping`は、完全なcall graphや脆弱性判定器ではない。固定Target Snapshotから、完全なfile inventory、構文上のsource fact、source anchor、未解決edge、coverage gapを再現可能に生成するbackboneである。
- `AI Mapper`は、feature/surfaceの意味付け、cross-file・cross-request relation、dynamic callback候補、controlの役割を、型付き`Context Request`で必要なsourceだけ追加取得しながら推論する。parserの`observed` factを上書きせず、`inferred`または`unknown`を追加する。
- `Finder`はMapを使ってHypothesisを作る別phaseである。AI Mapperが脆弱性成立まで宣言すると、mapping coverageとfinding confidenceが混ざる。
- runtime reachability、実際のattacker capability、WordPress configuration、control effectiveness、exploit outcomeは`Verification`へ残す。static rule hit、model confidence、agent consensusだけで`Finding`へ昇格させない。
- Semgrep/CodeQL ruleは、独立Verification済みpatternを低costで再探索する派生物にする。モデルが初見で生成したruleを正本へ直ちに昇格させない。

## Comparison at a glance

| Source | Inventory / deterministic layer | Context selection | Hypothesis / roles | Verification | Rule promotion | Public limit |
| --- | --- | --- | --- | --- | --- | --- |
| Mandiant AVDH | in-scopeの全fileからentry pointとuser inputをDiscovery agentが抽出 | Explorerがdomain、documentation、exclusion、specialistを決め、entry point単位でEnrichment | Access ControlとData Flowへrouteし、複数Validatorを使う | high-temperature Validation群、synthesis、人間のdynamic reproduction | expert rule hierarchyは説明されるが、Semgrep/CodeQL promotionは公開されない | source code、artifact schema、prompt、具体的harnessは非公開 |
| Anthropic reference harness | agentによるReconと`Read`/`Glob`/`Grep`; AST indexはない | focus areaまたはinput-processing subsystemに分割し、source searchで追加取得 | distinct surfaceごとのFinder; static candidateは未検証 | clean sandbox、programmatic gate、separate grader | verified findingのrecognizable shapeをSemgrep/CodeQL ruleへする設計指針 | 公開実装はC/C++ sanitizer crashへ特化 |
| Wordfence Argus | deterministic programmingとLLMを組み合わせることだけ公開 | 非公開 | 10原則とmodel-agnostic orchestrationのみ公開 | 非公開 | 非公開 | harness、prompt、model、設計詳細を意図的に非公開 |
| OpenAnt | PHPを含むlanguage別scanner、tree-sitter extractor、bidirectional call graph、depth-bounded analysis unit | function indexを20-turn tool loopで探索し、dependency contextを追加 | Stage 1 detectionとStage 2 attacker simulationを分離 | model verifierに加えgenerated Docker testがあるが、出力statusをtest自身が宣言 | CodeQLはpre/inverse filter; verified findingからruleへ昇格する実装は確認できない | PHP CodeQL pathは非対応言語を要求し、plain Docker/build egressとself-asserted verdictはevidence gateに不十分 |
| OpenAI Codex Security | exact sorted inventoryとoffline search; AST relation indexはない | architectureからsource-backed investigation packetを作る | independent baselineとsurface別investigator | parentがsource evidenceとcounterevidenceを再検証 | 自動promotionは確認できない | source-only validationを許容し、runtime reproductionを必須にしない |
| Protect AI Vulnhuntr | regexでnetwork-related Python fileを選ぶ | AIの`name/reason/code_line`要求をJedi resolverが最大7回補う | vulnerability class別の反復分析 | 同一pipelineのPoC/confidence出力のみ | なし | Python・限定vulnerability class; independent verifierなし |
| IRIS | CodeQLでexternal APIとinternal parameterを列挙 | LLMがsource/sink/propagator仕様を分類 | CWE別にproject-specific dataflow queryを生成 | CodeQL実行、決定論的post-process、LLM filter | generated queryはあるが、検証済み汎用ruleへのpromotionではない | Java/CWE benchmark中心; runtime exploit verificationなし |
| Visa VVAH | local AST engineがtyped `FileIndex`とsource/sink/call factsを作る | deterministic inventoryからContext Packageとbounded decompositionを作る | multi-lens discovery後にS6 adversarial reviewer | detectionとは別stageだがLLMのTRUE/FALSE_POSITIVE verdictで、runtime exploitではない | observed call fingerprintからAIがstatic source/sink specを提案可能 | PHP parserなし、公開precision/recallなし |

表の各cellの根拠と、公開されていないものを推測しないための境界を以下で詳述する。

## Repository candidates and deep-dive priority

### OpenAntの同定

`OpenAnt`という同名候補のうち、本調査の対象は[`knostic/OpenAnt`](https://github.com/knostic/OpenAnt)である。一次論文の題名がvulnerability discovery、code decomposition、adversarial verification、dynamic testingを明記し、公開実装としてこのrepositoryへ直接linkしているためである。[OpenAnt paper](https://arxiv.org/abs/2606.19149) repository側も同じ研究者をcreditし、PHPを含むsupported languageと`parse -> enhance -> analyze -> verify`のpipelineを公開する。[OpenAnt README](https://github.com/knostic/OpenAnt/blob/8bdc94251e4c50e5027db8829358ed3d3f8de87f/README.md) 単なる同名forkや別用途のprojectは対象にしていない。

### 評価結果

順位はstar数やREADMEの強い表現ではなく、`source実体`、`test/CIと修正履歴`、`公開Finding/CVEまたは再現dataset`、`detection/verificationのcode上の分離`、`PHP/WordPress移植性`で決めた。`強`は採用を意味せず、該当する公開証拠が相対的に充実しているという意味である。

| Priority | Repository | Source実体 | Test / CI | 公開結果証拠 | Detection / Verification | PHP / WordPress | 深掘り判断 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | [Knostic OpenAnt](https://github.com/knostic/OpenAnt) | **強**: PHP parser、index、agent loop、dynamic testerが実装済み | **強**: inspected revisionの[test tree](https://github.com/knostic/OpenAnt/tree/8bdc94251e4c50e5027db8829358ed3d3f8de87f/libs/openant-core/tests)にtest file 396、PHP parser関連26、[CI](https://github.com/knostic/OpenAnt/blob/8bdc94251e4c50e5027db8829358ed3d3f8de87f/.github/workflows/test.yaml)あり | **中以下**: self-authored paperの評価はあるが、repository treeに対応するpublic disclosure/CVE/dataset artifactを確認できない | **中**: stageは分離、しかしstatic verifierとself-asserted dynamic status | **強**: betaでもPHP/WordPress固有callbackが実装済み | **最優先で実装まで深掘り**。採用はparser/index patternに限定 |
| 2 | [Protect AI Vulnhuntr](https://github.com/protectai/vulnhuntr) | **中**: bounded context resolverは具体的、全体は小さい | **弱**: inspected revisionに独立した厚いtest suite/CIを確認できない | **強**: READMEの公開CVE表はRagflow RCE等のpublic CVE recordへlink | **弱**: independent verifierなし | **弱**: Python/Jedi専用 | **深掘り済み**。実績は重視するが、context request loopだけ移植 |
| 3 | [Anthropic reference / Semgrep downstream](https://github.com/semgrep/defending-code-harness) | **強**: full recon/find/verify harness | **中**: downstreamにsandbox testはあるが、Source Mapper testではない | **中**: Anthropic/partnerのfield experienceは一次記事にあるが、reproducible finding datasetではない | **強**: clean independent verifierとgVisor enforcement | **中以下**: methodは移植可能、公開graderはC/C++ ASAN | **Verification設計を深掘り**。Source Mapping実装としては使わない |
| 4 | [Visa VVAH](https://github.com/visa/visa-vulnerability-agentic-harness) | **強**: typed static engine、decomposition、phase artifact | **中**: 約100 test file、inspected treeにGitHub Actions workflowなし | **弱**: README自身がprecision/recall未公開とする | **中**: S4/S6は別code、S6はmodel verdict | **弱**: PHPなし | **限定深掘り**。typed fact schemaとAI-generated specだけ保留採用 |
| 5 | [IRIS](https://github.com/iris-sast/iris) | **強**: CodeQL query generationとpost-processが公開 | **中**: paper用pipelineとevaluation artifactあり | **強**: 公開paper/benchmark評価 | **中**: static executionとLLM filter、dynamic proofなし | **弱**: Java/CodeQL、PHP非対応 | **深掘り済み**。AI specification patternだけ将来候補 |
| 6 | [OpenAI Codex Security](https://github.com/openai/codex-security) | **強**: artifact contractとscan phaseが具体的 | **強**: typed implementation/example/tests | **中以下**: artifact exampleはあるが、公開CVE corpusとしては扱えない | **中**: independent investigationとparent validation、runtime必須ではない | **中**: language-neutralだがPHP ASTなし | **深掘り済み**。evidence/coverage disciplineを採用 |
| 7 | [Capital One VulnHunter](https://github.com/capitalone/VulnHunter) | **中**: phase prompts、schema、runnerは具体的だがAST mapperなし | **強**: 70超のtest fileと[CI](https://github.com/capitalone/VulnHunter/blob/4042d34609ff85e0029dd55743b9c3f677cc984a/.github/workflows/tests.yml) | **弱**: benchmarkはillustrative placeholderで、公開Finding corpusを確認できない | **中以下**: adversarial phaseは分離するがstatic trace/mental executionもproofになり得る | **中**: language-neutral search中心 | **候補確認まで**。phase artifact以外は優先しない |

VulnhuntrのCVE表は、[`CVE-2024-10131` Ragflow RCE、`CVE-2024-10099` ComfyUI XSS等](https://github.com/protectai/vulnhuntr/blob/ead88c5adba4279dae5c56d65124c530a9a1c5ae/README.md#vulnerabilities-found)をpublic recordへ結び付けている。これは他候補より強いfield resultである。一方、tool自身の寄与の記述はproject側の自己申告であり、精度datasetや独立比較実験と同一視しない。

OpenAnt論文はWordPress等でpreviously unknown vulnerabilityを発見したと報告する。[OpenAnt paper abstract](https://arxiv.org/abs/2606.19149) しかしinspected revisionの[`experiment.py`](https://github.com/knostic/OpenAnt/blob/8bdc94251e4c50e5027db8829358ed3d3f8de87f/libs/openant-core/experiment.py)やhunting protocolが参照するdataset pathに対応するdataset/disclosure artifactは公開treeに存在せず、READMEもdisclosure process中としている。[OpenAnt README](https://github.com/knostic/OpenAnt/blob/8bdc94251e4c50e5027db8829358ed3d3f8de87f/README.md) よって「実装は強い」と「公開CVE実績を独立検証できる」は分け、後者を未確認とした。

候補一覧には、static scannerとLLM triageを組み合わせる[`antonellof/s0-cli`](https://github.com/antonellof/s0-cli)、agentがsource/sink ruleを作る[`seqra/opentaint`](https://github.com/seqra/opentaint)、static/binary/dynamic workflowを持つ[`gadievron/raptor`](https://github.com/gadievron/raptor)、file-based white-box workflowの[`hadriansecurity/openhack`](https://github.com/hadriansecurity/openhack)も残す。いずれも方向性は近いが、今回の責務境界を決めるにはOpenAnt、Vulnhuntr、IRIS、Visaで異なるpatternを十分比較できたため、READMEの主張だけで採用判断を増やさず候補確認に留めた。

## Canonical design references

### Google / Mandiant AVDH

Mandiantの公開記事では、AVDHをGoogle Agent Development Kitでprogrammaticかつdeterministicにorchestrateするsequential pipelineと説明する。Explorerはasset inventory、SBOM、documentation、threat intelligence等からdomain、追加資料、除外範囲、auth・routing等のspecialistを決め、脅威modelを人間が承認する。その後、parallel Discovery agentがin-scopeの全fileを処理してentry pointとuser inputを抽出する。[Mandiant: Staying Ahead of Adversarial AI Through Agentic Source Code Review](https://cloud.google.com/blog/topics/threat-intelligence/staying-ahead-of-adversarial-ai-through-agentic-source-code-review)

entry pointごとのEnrichment agentはdistributed codeを辿り、Access Control agentとData Flow agentの一方または両方へrouteする。これらはhypothesisを広く作り、複数のValidation agentが異なる試行で確認し、最後にsynthesisする。人間はPoCをdynamicに再現できないcandidateを捨てる。同じ記事は、domain、language/framework、vulnerabilityの階層化されたexpert ruleを各stageへ注入することも説明する。[同記事](https://cloud.google.com/blog/topics/threat-intelligence/staying-ahead-of-adversarial-ai-through-agentic-source-code-review)

ここから採用するのは、`inventory -> entry enrichment -> security concern別route -> independent validation`という責務分離である。ただし公開記事はAVDHのsource code、prompt、artifact schema、static analyzer実装を提供していない。記事から「entry point抽出がASTで決定論的に行われる」「CodeQL/Semgrep ruleへ自動昇格する」とは推測しない。リンクされる[Google Agent Development Kit](https://google.github.io/adk-docs/)は汎用frameworkであり、AVDHのreference implementationではない。

### Anthropic defending-code reference harness

Best Practicesは、最初にsystemとtrust boundaryをmapし、componentまたはinput-processing subsystemで探索を分割し、最後にcomponent間のchainを探すことを勧める。大規模sourceでは、全sourceをpromptへ詰めず、component summary、file risk ranking、SourcegraphやSemgrep等の検索手段を用いて必要なcontextへ移動する。また、単一fileへ閉じ込めず、依存sourceはwishlistで必要な分だけ追加する。[Anthropic Best Practices: map, scope, equip](https://github.com/anthropics/defending-code-reference-harness/blob/d3bea6b5793b5f3d59a75ebe69a58efa88383145/docs/best-practices.md#before-you-scan-map-scope-equip) [同: Large codebases](https://github.com/anthropics/defending-code-reference-harness/blob/d3bea6b5793b5f3d59a75ebe69a58efa88383145/docs/best-practices.md#large-codebases)

公開実装のReconはAST mapを事前生成しない。agentへsource tree、entry point、dispatch mechanismを読ませ、5から15程度のdistinct input-processing subsystemを返させる軽量passである。[`harness/recon.py`](https://github.com/anthropics/defending-code-reference-harness/blob/d3bea6b5793b5f3d59a75ebe69a58efa88383145/harness/recon.py) [`harness/prompts/recon_prompt.py`](https://github.com/anthropics/defending-code-reference-harness/blob/d3bea6b5793b5f3d59a75ebe69a58efa88383145/harness/prompts/recon_prompt.py) 対話skillも`Read`、`Glob`、`Grep`とlocal searchを使い、focus areaごとのtaskからfile、line、category、confidence、exploit scenario等を持つstatic candidateを返す。skill自身がこれを未検証candidateと位置付ける。[`.claude/skills/vuln-scan/SKILL.md`](https://github.com/anthropics/defending-code-reference-harness/blob/d3bea6b5793b5f3d59a75ebe69a58efa88383145/.claude/skills/vuln-scan/SKILL.md)

VerificationはDiscoveryと分離し、cheap programmatic gateを先に置き、Finderが触れていないclean sandboxで、Target Snapshotとartifactだけを使うという設計である。[Anthropic Best Practices: Verification](https://github.com/anthropics/defending-code-reference-harness/blob/d3bea6b5793b5f3d59a75ebe69a58efa88383145/docs/best-practices.md#verification-the-load-bearing-component) 公開graderはC/C++ sanitizer crashに特化し、PoCのみをfresh containerへ渡し、複数回の再現性とproject code内のfailureを確認する。[`harness/grade.py`](https://github.com/anthropics/defending-code-reference-harness/blob/d3bea6b5793b5f3d59a75ebe69a58efa88383145/harness/grade.py) [`harness/prompts/grade_prompt.py`](https://github.com/anthropics/defending-code-reference-harness/blob/d3bea6b5793b5f3d59a75ebe69a58efa88383145/harness/prompts/grade_prompt.py)

Best Practicesは、確認済みfindingのうち構文として認識できるshapeをSemgrepまたはCodeQL ruleへし、別repositoryやCIを安価に掃くことを勧める。同時に、ruleはsyntax上の近縁例を拾うfloorであって、cross-file reasoningや次回のmodel探索を置き換えないと制限する。[Anthropic Best Practices: Codify findings as static-analysis rules](https://github.com/anthropics/defending-code-reference-harness/blob/d3bea6b5793b5f3d59a75ebe69a58efa88383145/docs/best-practices.md#codify-rules)

採用するのは、全sourceを要約して固定promptへ入れる方式ではなく、MapをindexとしてFinderへ検索toolを与えること、surfaceを再分割すること、DiscoveryとVerificationを物理的にも分離することである。公開実装そのものはC/C++ crash harnessであり、WordPress向けPHP Source Mappingの実装templateとして移植しない。[repository README](https://github.com/anthropics/defending-code-reference-harness/blob/d3bea6b5793b5f3d59a75ebe69a58efa88383145/README.md)

### Wordfence Argus

WordfenceはArgusの設計approachを、`confine -> constrain -> focus -> motivate -> parallelize -> hypothesize -> verify -> record -> prioritize -> iterate`の10原則で説明し、LLMとtraditional deterministic programmingを組み合わせるmodel-agnosticなharnessだとする。一方、threat actorとの競争を理由に、model、prompt structure、harness designの詳細を公開しない。[Wordfence Argus](https://www.wordfence.com/blog/2026/08/wordfence-argus-moving-beyond-human-research-capability/)

したがって10原則は本harnessの最上位設計原則として採用できるが、ArgusがどのAST factを抽出するか、agentへ何を渡すか、どのようにfalse positiveを落とすかは公開根拠がない。Argusを実装比較表の空欄を埋めるauthorityとして使わない。

## Supporting implementations

### Knostic OpenAnt

#### Source decomposition and deterministic context

OpenAntのlanguage parser contractは`repository scanner -> AST function extractor -> bidirectional call graph -> unit generator`で、共通の`dataset.json`へanalysis unitを出す。[`adding-a-parser.md`](https://github.com/knostic/OpenAnt/blob/8bdc94251e4c50e5027db8829358ed3d3f8de87f/adding-a-parser.md) PHP実装はtree-sitterからfunction/method/class、source range、code、namespace等を抽出し、callbackを含むcall relationを構築し、既定depth 3でcallee dependencyとcaller contextをunitへまとめる。[PHP `function_extractor.py`](https://github.com/knostic/OpenAnt/blob/8bdc94251e4c50e5027db8829358ed3d3f8de87f/libs/openant-core/parsers/php/function_extractor.py) [PHP `call_graph_builder.py`](https://github.com/knostic/OpenAnt/blob/8bdc94251e4c50e5027db8829358ed3d3f8de87f/libs/openant-core/parsers/php/call_graph_builder.py) [PHP `unit_generator.py`](https://github.com/knostic/OpenAnt/blob/8bdc94251e4c50e5027db8829358ed3d3f8de87f/libs/openant-core/parsers/php/unit_generator.py)

WordPressに直接使える実装として、call graph builderは`add_action`と`add_filter`のcallback argumentをdispatcher edgeとして扱い、entry-point detectorはPHP superglobalとfile-scopeのWordPress hook registration/dispatchをseed候補にする。[PHP callback mapping](https://github.com/knostic/OpenAnt/blob/8bdc94251e4c50e5027db8829358ed3d3f8de87f/libs/openant-core/parsers/php/call_graph_builder.py#L91-L110) [`entry_point_detector.py`](https://github.com/knostic/OpenAnt/blob/8bdc94251e4c50e5027db8829358ed3d3f8de87f/libs/openant-core/utilities/agentic_enhancer/entry_point_detector.py) この点と、PHP parser用を含む多数のregression testがある点は、今回調べた中でSource Mappingへ最も直接移植しやすい。[OpenAnt tests](https://github.com/knostic/OpenAnt/tree/8bdc94251e4c50e5027db8829358ed3d3f8de87f/libs/openant-core/tests)

ただしreachability analyzer自身が、結果はcall graph reachabilityであってtaint analysisではなく、missing edgeと真のdead codeを区別できないと明記する。[`reachability_analyzer.py`](https://github.com/knostic/OpenAnt/blob/8bdc94251e4c50e5027db8829358ed3d3f8de87f/libs/openant-core/utilities/agentic_enhancer/reachability_analyzer.py) したがってcall graphを候補contextの優先順位付けには使うが、到達不能と断定してunitをcoverageから消す使い方は採用しない。OpenAntがPHP entry point不在時に全unitを保持するfail-open behaviorと、LLM追加seedはstructural entry pointをdemoteせずpromoteにだけ使うbehaviorは、この制限を踏まえた安全側の例である。[PHP `test_pipeline.py`](https://github.com/knostic/OpenAnt/blob/8bdc94251e4c50e5027db8829358ed3d3f8de87f/libs/openant-core/parsers/php/test_pipeline.py) [`parser_adapter.py`](https://github.com/knostic/OpenAnt/blob/8bdc94251e4c50e5027db8829358ed3d3f8de87f/libs/openant-core/core/parser_adapter.py)

#### Context retrieval and agent loop

`RepositoryIndex`はfunction ID/name/file、definition、usage、full function readを提供し、context enhancerは最大20 iterationのtyped tool loopで追加functionを選ぶ。prompt本文、各tool result、iterationへ上限があり、`finish`しなかった時は`neutral`ではなく`incomplete`を保存する。[`repository_index.py`](https://github.com/knostic/OpenAnt/blob/8bdc94251e4c50e5027db8829358ed3d3f8de87f/libs/openant-core/utilities/agentic_enhancer/repository_index.py) [`agent.py`](https://github.com/knostic/OpenAnt/blob/8bdc94251e4c50e5027db8829358ed3d3f8de87f/libs/openant-core/utilities/agentic_enhancer/agent.py) [`tools.py`](https://github.com/knostic/OpenAnt/blob/8bdc94251e4c50e5027db8829358ed3d3f8de87f/libs/openant-core/utilities/agentic_enhancer/tools.py)

このtool loop、明示的な`incomplete`、definition/usageの双方向探索は採用する。ただしAIの`include_functions`や`confidence`をdeterministic relationへ昇格させず、本harnessでは`Context Request/Response`としてresolver候補、ambiguity、budget exhaustionを保存する。またOpenAntの別経路`context_corrector.py`は、context不足時にsource file全文を大きなbatchで再投入する。[`context_corrector.py`](https://github.com/knostic/OpenAnt/blob/8bdc94251e4c50e5027db8829358ed3d3f8de87f/libs/openant-core/utilities/context_corrector.py) これはsymbol/range単位の取得よりbudgetとprovenanceが粗いため採用しない。

#### Detection, attacker simulation, and dynamic test

Stage 1はanalysis unitごとに`safe/protected/vulnerable/inconclusive`、attack vector、severity、CWE等を出し、analyzerはunitをparallelに処理しつつcheckpointと入力順を維持する。[`vulnerability_analysis.py`](https://github.com/knostic/OpenAnt/blob/8bdc94251e4c50e5027db8829358ed3d3f8de87f/libs/openant-core/prompts/vulnerability_analysis.py) [`core/analyzer.py`](https://github.com/knostic/OpenAnt/blob/8bdc94251e4c50e5027db8829358ed3d3f8de87f/libs/openant-core/core/analyzer.py) Stage 2は別の20-iteration tool loopでentry point、data flow、sink到達、attacker control、path breakを持つexploit pathを作り、未完了を明示する。[`finding_verifier.py`](https://github.com/knostic/OpenAnt/blob/8bdc94251e4c50e5027db8829358ed3d3f8de87f/libs/openant-core/utilities/finding_verifier.py) phase分離とtyped exploit pathは参考になるが、同じstatic repository index上のmodel attacker simulationであり、本harnessの独立した成立証拠にはしない。またStage 1 promptの「具体的なattack pathがなければSAFEを既定にする」方針はDiscoveryのrecallを落とし得るため採用しない。

dynamic testerはLLMがDockerfile、dependency、test script、composeを生成し、executorはcompose key allowlist、read-only root、all capability drop、no-new-privileges、resource limit、runtime egress遮断を適用する。一方、実装はbuild-time `RUN` egressを未解決のresidualとして明記する。[`test_generator.py`](https://github.com/knostic/OpenAnt/blob/8bdc94251e4c50e5027db8829358ed3d3f8de87f/libs/openant-core/utilities/dynamic_tester/test_generator.py) [`docker_executor.py`](https://github.com/knostic/OpenAnt/blob/8bdc94251e4c50e5027db8829358ed3d3f8de87f/libs/openant-core/utilities/dynamic_tester/docker_executor.py) さらにcollectorはgenerated testが標準出力へ書いた`CONFIRMED`等のstatusをschema確認して採用する構造で、harness側の独立oracleやCausal Controlではない。[`result_collector.py`](https://github.com/knostic/OpenAnt/blob/8bdc94251e4c50e5027db8829358ed3d3f8de87f/libs/openant-core/utilities/dynamic_tester/result_collector.py)

よってtest生成の発想はVerification LabのExperiment proposalへ限定し、plain Docker、unpinned dependency、generated scriptのself-verdict、Causal Controlなしの`CONFIRMED`は採用しない。本harnessでは固定Target Snapshot、typed Witness、harness-owned oracle、gVisor、対照実験がFinding gateを所有する。

#### Static tool and rule lifecycle

OpenAntはCodeQL findingでunitをpre-filterするpathや、CodeQLが拾わなかったunitを調べるinverse filterを持つが、検証済みFindingからSemgrep/CodeQL rule candidateを作り、fixtureとheld-out targetで昇格させるimplementationは確認できない。[Go CodeQL filter](https://github.com/knostic/OpenAnt/blob/8bdc94251e4c50e5027db8829358ed3d3f8de87f/libs/openant-core/parsers/go/test_pipeline.py) [`VULNERABILITY_HUNTING_PROTOCOL.md`](https://github.com/knostic/OpenAnt/blob/8bdc94251e4c50e5027db8829358ed3d3f8de87f/libs/openant-core/VULNERABILITY_HUNTING_PROTOCOL.md) さらにPHP pipelineは`codeql database create --language=php`相当とPHP query suiteを組み立てるが、official CodeQL supported languagesにPHPはない。[PHP `test_pipeline.py`](https://github.com/knostic/OpenAnt/blob/8bdc94251e4c50e5027db8829358ed3d3f8de87f/libs/openant-core/parsers/php/test_pipeline.py) [GitHub CodeQL supported languages](https://docs.github.com/en/code-security/concepts/code-scanning/codeql/codeql-code-scanning#about-codeql-code-scanning) このPHP CodeQL経路は実行可能なreferenceとして採用しない。

### OpenAI Codex Security

Codex Securityのinventory generatorは、authorized scopeをrepository root内へ固定し、`rg --files`とGit上のtracked ignored filesを統合し、C locale相当でsortしたexact inventoryをatomicに保存する。これはsource理解ではなく、coverage母集団を決める決定論的artifactである。[`generate_in_scope_files.py`](https://github.com/openai/codex-security/blob/cfde3f4c0922656caa625c1fad42aa1f7ba1df71/plugins/codex-security/scripts/generate_in_scope_files.py)

Core scanは、architectureと実source anchorからattacker、asset、entry point、expected control、sensitive operation、component relationを持つinvestigation packetを組み、independent baselineとpacket別investigatorへ分配する。mappingやsearch hitをfile review済みとは数えず、各workerが実際に全面reviewしたfileのunionをinventoryと突き合わせる。[`core-scan.md`, steps 1–6](https://github.com/openai/codex-security/blob/cfde3f4c0922656caa625c1fad42aa1f7ba1df71/plugins/codex-security/references/core-scan.md#core-workflow)

candidate schemaはstable ID、CWE、entrypoint/source/root-control/sink等のroleを持つlocation、summary、evidenceをstrictに要求する。[`artifact-contracts.ts`](https://github.com/openai/codex-security/blob/cfde3f4c0922656caa625c1fad42aa1f7ba1df71/plugins/codex-security/mcp-app/src/deep-scan/artifact-contracts.ts) 最終Findingはattacker-controlled dataflow、transform、broken control、sensitive operation、prerequisite、mitigation、counterevidence、impactをparentがsource上で再検証し、path・line・code・explanationを持つ`codeEvidence`へ記録する。[`core-scan.md`, steps 7–8](https://github.com/openai/codex-security/blob/cfde3f4c0922656caa625c1fad42aa1f7ba1df71/plugins/codex-security/references/core-scan.md#core-workflow) versioned manifest、coverage、findingsとartifact digestを分けるcompleted exampleもある。[`examples/completed-scan`](https://github.com/openai/codex-security/tree/cfde3f4c0922656caa625c1fad42aa1f7ba1df71/plugins/codex-security/examples/completed-scan)

採用するのは、exact inventory、source-backed packet、typed candidate、stable identity、counterevidence、coverage honestyである。ただしreviewしたcore implementationは、Source Mapping前段でPHP AST relation indexを作らず、agentがoffline searchでsourceを辿る構造である。またsourceだけで十分なFindingを許し、runtime reproductionを必須にしない。[`core-scan.md`, validation rule](https://github.com/openai/codex-security/blob/cfde3f4c0922656caa625c1fad42aa1f7ba1df71/plugins/codex-security/references/core-scan.md#core-workflow) 本harnessではNorth Star Findingにfresh VerificationとCausal Controlを要求するため、Codex Securityのschema disciplineは採用するが、このvalidation thresholdは採用しない。自動Semgrep/CodeQL promotionもreview対象のcore scanには確認できなかったため、存在を推測しない。

### Protect AI Vulnhuntr

VulnhuntrはPython repositoryからnetwork-related fileをregexで選び、README summaryとfile sourceを初期analysisへ渡す。その後、modelが`name`、`reason`、`code_line`を持つ追加contextを要求し、Jedi-based resolverがsymbol definitionを返す。[`vulnhuntr/__main__.py`](https://github.com/protectai/vulnhuntr/blob/ead88c5adba4279dae5c56d65124c530a9a1c5ae/vulnhuntr/__main__.py) [`vulnhuntr/symbol_finder.py`](https://github.com/protectai/vulnhuntr/blob/ead88c5adba4279dae5c56d65124c530a9a1c5ae/vulnhuntr/symbol_finder.py)

追加contextは名前でdeduplicateされ、vulnerability typeごとに最大7 iterationで、要求がないか新しいdefinitionが増えなくなると止まる。このbounded request/response loopは、全sourceを最初から渡さず必要な定義だけ補う具体例である。[secondary analysis loop](https://github.com/protectai/vulnhuntr/blob/ead88c5adba4279dae5c56d65124c530a9a1c5ae/vulnhuntr/__main__.py#L401-L486) 一方、resolverは複数候補のambiguityをartifactとして返さず最初のmatchを選ぶpathがあり、model出力のPoCとconfidenceを独立Verifierが再現するphaseはない。[`symbol_finder.py`](https://github.com/protectai/vulnhuntr/blob/ead88c5adba4279dae5c56d65124c530a9a1c5ae/vulnhuntr/symbol_finder.py) [project logic flow](https://github.com/protectai/vulnhuntr/blob/ead88c5adba4279dae5c56d65124c530a9a1c5ae/README.md#logic-flow)

採用するのは、型付き理由を伴う追加context要求、deduplication、hard iteration ceiling、no-progress stopである。Python向けregex inventory、7種類のvulnerability classへの固定、model confidenceによるgate、単一matchを真とするresolverは採用しない。

### IRIS

IRISはCodeQLでprojectのexternal APIとinternal parameterを列挙し、LLMにsource、sink、taint-propagatorと関係parameterを分類させる。その仕様からproject・CWE固有のCodeQL queryを生成してdataflow analysisを実行し、deterministic post-processingとLLMによるcontextual filterを順に適用する。[IRIS workflow](https://iris-sast.github.io/iris/architecture/workflow.html) 実装でもAPI collection、LLM classification、`.qll`生成、CodeQL実行、posthoc filteringが別stepになっている。[`src/iris.py`](https://github.com/iris-sast/iris/blob/3a12f45750f58135bcc58c7fdf4c20786b600e31/src/iris.py)

これは「AIがFindingを直接宣言する」のではなく、「AIがproject-specific static-analysis specificationを作り、machine engineがflowを計算する」patternとして参考になる。ただし公開workflowはCWEを先に選ぶ構造で、runtime exploitを独立環境で検証するphaseではない。[IRIS workflow](https://iris-sast.github.io/iris/architecture/workflow.html) またGitHub CodeQLのofficial supported-language listにPHPは含まれない。[GitHub CodeQL supported languages](https://docs.github.com/en/code-security/concepts/code-scanning/codeql/codeql-code-scanning#about-codeql-code-scanning)

したがってAI MapperがWordPress固有のsource/sink/propagator/control候補を型付き仕様として提案し、PHP ParserまたはSemgrep側が決定論的に実行するpatternは保留付きで採用する。現在のPHP harnessへCodeQLを入れること、CWE別agentをprimary partitionにすること、generated queryのhitをVerificationとみなすことは採用しない。

### Visa Vulnerability Agentic Harness

Visa VVAHのS0 engineは、imports、functions、source/sink hit、call edge、assignment、return、call argument、field/container read/write等をtyped `FileIndex`へ抽出し、ruleからbounded dataflow/reachability seedを作る。[`_scan.py`](https://github.com/visa/visa-vulnerability-agentic-harness/blob/3d972f679d8f5e3838b394edee0b5ea9c626b0fb/vvaharness/pipeline/stages/callgraph_engine/_scan.py) [`_graph.py`](https://github.com/visa/visa-vulnerability-agentic-harness/blob/3d972f679d8f5e3838b394edee0b5ea9c626b0fb/vvaharness/pipeline/stages/callgraph_engine/_graph.py) ただしcall graphはbare callを同名definition候補へ結ぶ保守的近似を含み、edge budget/depthで打ち切る。これは`observed call expression`と`resolved target`を分ける必要を示す実例であって、完全call graphの根拠ではない。

`_annotator.py`はrepositoryで観測したcall fingerprintをLLMに分類させ、source/sink specを生成した後、local static engineがflowを計算する。[`_annotator.py`](https://github.com/visa/visa-vulnerability-agentic-harness/blob/3d972f679d8f5e3838b394edee0b5ea9c626b0fb/vvaharness/pipeline/stages/callgraph_engine/_annotator.py) この「AIがstatic specification候補を作り、machineが実行する」patternはIRISと同方向であり、将来のWordPress Knowledge/rule candidateに有望である。一方、S6はDiscoveryと別file・別phaseでも、結果はadversarial LLMによるTRUE/FALSE_POSITIVE判定で、fresh runtime exploitではない。[`s6_verify.py`](https://github.com/visa/visa-vulnerability-agentic-harness/blob/3d972f679d8f5e3838b394edee0b5ea9c626b0fb/vvaharness/pipeline/stages/s6_verify.py) project自身も出力をhuman reviewが必要なcandidateとし、precision/recallを未公開と明記する。[VVAH limitations](https://github.com/visa/visa-vulnerability-agentic-harness/blob/3d972f679d8f5e3838b394edee0b5ea9c626b0fb/README.md#limitations-read-before-you-trust-output) PHP supportがないため、schemaとrule-proposal patternだけを保留採用する。

### Capital One VulnHunter

VulnHunterはReconでinput inventoryとpartitionを作り、parallel Hunt、adversarial Disprove、reproductionへ進むphase disciplineをpromptとartifactで具体化する。[`vulnhunt/SKILL.md`](https://github.com/capitalone/VulnHunter/blob/4042d34609ff85e0029dd55743b9c3f677cc984a/vulnhunt/SKILL.md) [`phase1_recon.md`](https://github.com/capitalone/VulnHunter/blob/4042d34609ff85e0029dd55743b9c3f677cc984a/vulnhunt/phases/phase1_recon.md) [`phase2b_verify.md`](https://github.com/capitalone/VulnHunter/blob/4042d34609ff85e0029dd55743b9c3f677cc984a/vulnhunt/phases/phase2b_verify.md) しかしSource MappingはagentのGlob/Grep/Read中心で、AST inventoryやtyped unresolved edgeを事前計算しない。

reproduction phaseは実行testを推奨する一方、runnableでなければstatic traceを許し、各testを「run or mentally execute」するpathも残す。[`phase3_reproduce_test.md`](https://github.com/capitalone/VulnHunter/blob/4042d34609ff85e0029dd55743b9c3f677cc984a/vulnhunt/phases/phase3_reproduce_test.md) また公開benchmark frameworkは存在するが、同梱ground-truth commitはillustrative placeholderである。[benchmark ground truth README](https://github.com/capitalone/VulnHunter/blob/4042d34609ff85e0029dd55743b9c3f677cc984a/harness/local_harness/benchmark/ground_truth/README.md) したがってphase artifactとfalsification questionは参考にするが、公開Finding実績やevidence-grade Verificationのreferenceにはしない。

### Semgrep defending-code-harness

Semgrep版はAnthropic referenceと同じ`recon -> find -> verify -> report -> patch`の形を保ちつつ、autonomous pipelineをgVisor外では既定拒否し、agent/targetをgVisor kernel、egress allowlist、限定mountで隔離する実装と検査手順を加えている。[Semgrep harness README](https://github.com/semgrep/defending-code-harness/blob/9fe924b2a9acc320e6eec80becce338175e96ba6/README.md) [`docs/agent-sandbox.md`](https://github.com/semgrep/defending-code-harness/blob/9fe924b2a9acc320e6eec80becce338175e96ba6/docs/agent-sandbox.md) これはVerification Labの隔離参考として有用だが、公開pipelineはC/C++ memory vulnerabilityとASAN crash向けで、PHP Source Mapperではない。

同梱されたAnthropic/partnerのfield noteは、DiscoveryにVerificationも同時要求するとtrue positiveをself-censorし、fresh independent verifierとPoC実行でnon-exploitable findingを減らしたと報告する。[`docs/blog-post.md`, Verification](https://github.com/semgrep/defending-code-harness/blob/9fe924b2a9acc320e6eec80becce338175e96ba6/docs/blog-post.md#4-verification-filter-out-non-exploitable-findings) これは実運用由来の一次経験だが、公開CVE corpusや再現可能なprecision datasetではない。Source Mappingの順位を上げる根拠ではなく、DiscoveryとVerificationを分ける根拠として使う。

## Responsibility boundary for whitebox-harness

以下は外部projectの仕様ではなく、上記比較をSource Mapping seamへ適用する本設計の提案である。

### 今すぐ AST extractor へ追加

ここでの`observed`は「固定snapshotのsourceに、その構文、literal、call、参照が存在する」という意味に限る。到達可能性、security effect、WordPress runtimeでの有効性は含めない。

1. **Exact source inventory and coverage denominator**
   - normalized relative path、file digest、language/type、size、解析対象・除外理由をstable orderingで保持する。
   - parser未対応fileを安全とみなさず、`coverage gap`にする。
   - Codex Securityのexact inventoryと、Anthropicの「unmapped surfaceはrecon不足」という考えを採用する。

2. **PHP declaration and source anchors**
   - namespace、class/trait/interface、method/function、parameter、property、constant、import/aliasをbyte rangeとfile digestへ固定する。
   - call、argument、assignment、return、property read/write、array access、include/requireをsyntax factとして持つ。
   - resolverが一意に決められないtargetは全candidateまたは`unknown`を返し、最初の候補を真としない。
   - OpenAntのPHP tree-sitter extractorとanalysis-unit schemaを実装fixtureの比較対象にするが、OpenAntのedgeをそのまま正本とはしない。

3. **WordPress registration and request-entry facts**
   - `add_action`、`add_filter`、`register_rest_route`、AJAX hooks、shortcode、cron、admin-post等のregistration callとliteral/dynamic argumentを分離して記録する。
   - direct PHP request候補、bootstrap/include relation、hook name、callback expression、REST methods、permission callbackの存在を記録する。
   - dynamic callbackやcomputed hookは解決不能理由と必要な次証拠を残す。
   - 最初のvertical sliceではOpenAntが既に扱う`add_action`/`add_filter`、superglobal、file-scope registrationをpositive/negative fixtureで再実装し、REST/AJAX等は実plugin観測に従って追加する。

4. **Security-relevant local operations**
   - superglobal、REST/request accessor、upload/file input、header/cookie、database fetch等のinput readを候補factにする。
   - capability/nonce/auth check、validation、sanitization、escaping callを「controlらしいcall」として記録する。効いているとは判定しない。
   - SQL、filesystem、include/eval/process、deserialization、HTTP、mail、response/output、WordPress option/meta/user等のread/writeをoperation factにする。
   - operation taxonomyはversioned Knowledgeで管理し、parserのsyntax observationと分離する。

5. **Local deterministic relations and gaps**
   - lexical containment、direct symbol reference、literal callback、local def-use等、再現可能なedgeだけを`observed` relationにする。
   - dynamic dispatch、variable function、magic method、hook construction、cross-file state consumer、unsupported JS/templateは`unknown`またはgapにする。
   - search hit、node共存、同一fileだけでsource-to-sink reachabilityやguard dominanceを宣言しない。

この層の目的はAIを減らすことではない。AIが「何がsourceに本当にあったか」を読み直すtokenを減らし、誤ったidentifierやlineを出した時に機械的にrejectできるようにすることである。

### AI Mapper へ渡す

AI Mapperはdeterministic mapを変更せず、意味的relationを追加する。最初から全fileを渡さず、Map summaryと関係source excerptを起点に、次の型付きrequestを使う。

```text
Context Request
  subject: symbol | path | source anchor | unresolved edge
  reason: 判断したいrelationまたは不足証拠
  expected_relation: caller | callee | registration | guard | state | transform | sink
  budget: files / bytes / hops
```

resolverはversioned `Context Response`として、該当候補をstable orderingで返す。`resolved`だけでなく、`ambiguous`、`not_found`、`budget_exhausted`を区別し、query、candidate anchor、除外理由を記録する。VulnhuntrとOpenAntのbounded loopを採りつつ、single-matchやmodel-selected dependencyをdeterministic factにする問題を避ける。

AI Mapperの担当は次である。

- file/symbolをfeature、entry surface、trust boundaryへgroup化する。
- dynamic hook/callback、factory、dependency injection、wrapper等の候補relationをsource anchor付きで推論する。
- request inputからtransform、control、state write、後続requestのstate read、sinkまでのcross-file・cross-request route候補を作る。
- capability/nonce/sanitizer/escapingが何を守ろうとしているか、別layerのcontrol確認が必要かを記述する。
- routeを`Access Control`、`Data Flow`、`Persistent State`、`File/Code Execution`等のsecurity concernへ複数routeできるようにする。これはvulnerability class別Finder固定ではなく、Enrichmentの出力先である。
- 各relationへsupporting anchor、strongest counterevidence、unresolved gap、confidenceではなくprovenance statusを付ける。
- no-progress、context ceiling、hop ceilingで停止し、残りを`unknown`として保存する。

AI Mapperは次をしてはならない。

- parserが出したsymbol、literal、source rangeを訂正済みfactとして上書きする。
- source anchorなしでcall edgeやsecurity controlを`observed`へ上げる。
- Map relationから脆弱性severityまたはFindingを確定する。
- 一つのmodel responseや多数決でambiguityを消す。

### Verification へ残す

次はstatic Source Mappingの完了条件ではなく、fresh Verification Labで確かめる。

- WordPress/plugin boot条件、hook priority、runtime callback target、configuration、role/capability、nonce lifecycle。
- attackerが実際のinterfaceからinputまたはstateへ影響できること。
- parser・sanitizer・escaping・authorization controlが具体的payloadとcontextで有効か。
- SQL、file write/include、code execution、stored output等のsensitive operationへrouteが到達すること。
- prerequisiteを一つだけ変えたCausal Controlで、同じoutcomeが消えること。
- RCEではdisposable Lab内のnonce付きExecution Canary、SQLi/XSS等ではclassに合うtyped Witnessが得られること。
- candidate source anchor、Target Snapshot digest、experiment、result、counterevidenceが独立Verifierから再現できること。

Mandiantのhuman dynamic reproductionとAnthropicのfresh graderはこの分離を支持するが、具体的なCausal Control、Execution Canary、Finding promotion gateは本harness独自の強化である。Codex Securityのsource-only validationより意図的に高いthresholdを採る。

### 採用しない

- modelが選んだfile集合をcoverage母集団にする。
- entire source treeまたは大量の全文summaryを各worker promptへ常時詰める。
- file risk scoreをcoverage代用にする。scoreはprioritizationにだけ使える。
- vulnerability class別agentだけを探索多様性とみなす。
- model confidence、self-critique、agent多数決、synthesisを独立Verificationの代用にする。
- generated Semgrep/CodeQL hitをそのままFindingへ昇格する。
- PHP analysisのためにCodeQLを導入する。
- OpenAntのPHP CodeQL pathを、動作検証なしに移植する。
- call-graph reachabilityで落ちたunitをsafeまたはcoverage済みとする。
- generated testが出力した`CONFIRMED`をharness-owned Witnessとして受理する。
- evidentiary Verificationをplain Dockerへfallbackし、build-time egressまたはunpinned dependencyを許す。
- first matchを返すsymbol resolver、silent unresolved edge、search hitをreview済みと数えるcoverage。
- 初期milestoneでcomplete interprocedural call graph、完全なWordPress runtime model、任意PHP実行を作る。
- AIに`observed` factを修正させ、deterministic factと推論を一つのbooleanへ潰す。

## Semgrep and CodeQL promotion policy

Semgrepはsource、sink、propagator、sanitizerを持つtaint modelを提供するが、Community Editionのanalysisは基本的にfile内へ制約される。[Semgrep static-analysis glossary](https://semgrep.dev/docs/writing-rules/glossary) Semgrep自身もCommunity Editionをdeterministic、offline、single-file orientedなengineとして説明する。[Semgrep philosophy](https://semgrep.dev/docs/contributing/semgrep-philosophy) そのため、WordPress固有のlocal syntax patternや同一file flowには使えるが、dynamic hook、cross-file callback、persistent cross-request routeの完全性を任せない。

CodeQLはpath queryによりsource、sink、data-flow stepを構造化できるが、official language supportにPHPがない。[GitHub CodeQL supported languages](https://docs.github.com/en/code-security/concepts/code-scanning/codeql/codeql-code-scanning#about-codeql-code-scanning) 現在は採用せず、将来WordPress以外のsupported-language white-box bug bountyへscopeを広げる時に再評価する。

rule lifecycleは次のgateにする。

```text
Verified Finding
  -> Rule Candidate
  -> positive / negative / causal-control fixtures
  -> affected target replay
  -> held-out plugin-family evaluation
  -> independent review
  -> versioned Accepted Rule
```

各段階の意味は次の通りである。

1. **Rule Candidate**: Verification済みFindingから、再利用できる局所syntax、WordPress API semantics、dataflow stepを抽出する。modelはrule案と適用限界を提案できる。
2. **Fixture gate**: vulnerable positiveだけでなく、safe sibling、correct control、似ているが無関係なnegativeを固定する。
3. **Replay gate**: 元Findingを拾い、修正版またはCausal Controlを拾わないことを確認する。
4. **Held-out gate**: rule作成に使っていないplugin familyでprecisionと新規candidateを測る。ゼロfalse positiveを装わず、用途をMap enrichment、candidate generation、coverage assistのどれかへ明記する。
5. **Independent review**: accepted ruleはversion、provenance、supported languages/framework versions、known blind spotsを持つ。hitは`observed rule match`であってVerified Findingではない。

Anthropicは確認済みfindingからruleを作り、構文的な近縁例を安価に拾う方針を示す。[Anthropic Best Practices: Codify findings](https://github.com/anthropics/defending-code-reference-harness/blob/d3bea6b5793b5f3d59a75ebe69a58efa88383145/docs/best-practices.md#codify-rules) Semgrepの公式methodologyもpositive/negative exampleでruleを作り、まず一つのrepository、次に複数repositoryで試してから統合する反復を勧める。[Semgrep: Writing Semgrep rules — a methodology](https://semgrep.dev/blog/2020/writing-semgrep-rules-a-methodology/) 上記のCausal Controlとindependent reviewは本harnessが追加するpromotion gateである。

## Worked route shapes

以下は、特定の公開脆弱性を再現したという主張ではなく、責務境界を示す設計例である。

### Stored XSS candidate

- AST extractor: `$_POST`またはrequest accessor、sanitization call、comment/option/meta write、後続read、`echo`/template output、escaping callを別factとして記録する。
- AI Mapper: `request A input -> persistent write -> request B read -> admin/editor output`の候補routeを作り、保存keyやconsumerが一致するanchorを要求する。
- Finder: output context、attacker privilege、victim role、bypass可能性をHypothesisにする。
- Verification: 実際に保存し、fresh privileged sessionでnonce付きmarkerが危険contextへ到達することと、encoding/controlを変えた対照で成立しないことを確認する。

### SQL injection candidate

- AST extractor: request source、concatenation/interpolation、`$wpdb` call、`prepare` call、format argumentを構文factにする。
- AI Mapper: wrapper、branch、identifier/value context、prepareのparameter binding関係を辿る。
- Finder: attacker-controlled tokenがSQL grammarを変え得るrouteをHypothesisにする。
- Verification: harmless boolean/time/error observation等の許可済みExperimentとCausal Controlで、static string共存ではなく実際のquery behaviorを確認する。

### File write to code execution candidate

- AST extractor: upload/request bytes、path construction、file write/move、extension/MIME/path control、include/require/eval/process call、direct-request candidateを記録する。
- AI Mapper: write primitiveと後続execution primitiveを、同一requestに限定せずpersistent routeとして接続し、不足primitiveを明示する。
- Finder: unauthenticatedまたはlow-privilege attackerからsite-wide compromiseへ至るHypothesisを作る。
- Verification: disposable Lab内で許可pathへnonce付きcanaryを書き、対象pluginの実interfaceだけを通してExecution Canaryが観測され、control条件で消えることを確認する。

この分割なら、AST extractorを「すべてを理解する巨大static analyzer」へ膨張させず、AIを「根拠のない自由推論」にもせず、North StarであるRCEまたは同等のsite-wide compromiseへ必要なchain reasoningを残せる。

## Adoption decision

| Decision | Status | Reason |
| --- | --- | --- |
| Exact inventory、syntax facts、anchors、unknown、coverage gaps | **adopt now** | AIの前に再現可能なground truthとcoverage母集団が必要 |
| PHP tree-sitter inventoryとdepth-bounded Analysis Unit | **adopt selectively now** | OpenAntは最も近い実装とtestを持つ。unitはcontext containerにし、完全reachability判定にはしない |
| Bounded typed Context Request/Response | **adopt next** | Vulnhuntrの有効なcontext loopをambiguity-preservingに強化できる |
| Enrichment後のmulti-concern routing | **adopt next** | AVDH型のAccess Control/Data Flow分担を、WordPressのstate/file executionにも拡張できる |
| Source-backed packetとtyped candidate/evidence schema | **adopt next** | Codex Securityのevidence disciplineをHypothesisへ適用できる |
| Fresh independent VerificationとCausal Control | **adopt** | static/model由来false positiveをFindingから排除するNorth Star gate |
| Verified findingからSemgrep Rule Candidate | **defer until first verified patterns** | 初見ruleを増やすより、実戦で成立したpatternからfixture付きで昇格する方が評価可能 |
| AI-generated project-specific static specification | **defer** | IRIS patternは有望だが、まずMap・Context loop・Verificationを実戦で安定させる |
| CodeQL for current PHP scope | **reject** | official PHP supportがなく、現在のNorth Starへ直接寄与しない |
| OpenAnt static attacker simulation as Verification | **reject as final gate** | phase分離とexploit-path schemaは有用だが、fresh runtime evidenceではない |
| LLM-generated Docker test self-verdict | **reject** | test proposalとharness-owned oracleを分け、gVisorとCausal Controlを必須にする |
| Model-only inventory、confidence gate、agent vote as proof | **reject** | coverage、fact、Verificationの責務を混ぜる |
| Complete deterministic semantic mapping | **reject as a milestone goal** | dynamic WordPress behaviorとcross-request logicはunknown/AI/Verificationへ分ける方がhonestで保守可能 |

最初の実戦sliceは、AST extractorを上記の`adopt now`まで深めた後、AI Mapperのtyped context loopを一つのroute shapeで追加し、同じplugin familyでVerificationまで通すものにする。Semgrep rule promotionは、そのsliceから最初のVerified Findingが得られた時に始める。先に汎用rule frameworkを作らない。
