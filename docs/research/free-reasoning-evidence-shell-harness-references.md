# Free-reasoning Finder and evidence-shell harness references

Status: supporting research note, 2026-09-02

## Question

複数機能をまたぐATOやRCEでは、固定した三つの探索手順だけでは足りず、frontier modelへ自由な仮説形成を
任せる必要があるのか。その場合、どこまでをharnessが所有し、公開されているどのharnessを参照すべきかを
一次資料だけで比較する。

この文書は[Design references](../REFERENCES.md)の3件を追加または置換しない。Wordfenceの追加事例、
OpenAI、Semgrep、OpenAnt、Aikido、wp2shellは、公開behaviorまたは実装mechanismを比較するsupporting
evidenceとして扱う。

## Conclusion

**Finderの内側は自由にし、外側は強く固定する。** これが公開資料間で最も一貫した構成である。

```text
Deterministic evidence shell
  Target Snapshot / scope / Work Lease / tool policy / budget
                         |
                         v
  Free-reasoning Finder: sourceを追う -> 仮説を立てる -> 不足primitiveを探す
                         |
                         v
  Typed Route Fragment / Hypothesis / Unknown / Closure
                         |
                         v
  Wave barrier -> Chain Synthesis -> fresh independent Verification
                         |
                         v
  Witness + Causal Control -> Ledger/CAS -> next Wave
```

ここでStrategyは手順書ではなく、探索開始時の**lens**である。`entry-forward`、`sink-backward`、
`state-chain`等を割り当てても、Finderがその順番だけを実行するよう縛らない。ModelにはTarget、goal、
Focus ownership、利用可能なsource tool、停止条件を渡し、sourceをどの順序で読み、どの機能を接続し、
どの攻撃仮説を試すかは任せる。

一方、Target外access、並列数、budget、source provenance、artifact schema、fresh Verification、成立証拠、
記録と再開はmodelへ任せない。自由推論は安全境界や証拠基準を自由にすることではない。

## Comparison at a glance

| Source | Free hypothesis / reasoning | Surface / retrieval | Orchestration / parallelism | Verification / sandbox | Record / iteration | Role in this repository |
| --- | --- | --- | --- | --- | --- | --- |
| Wordfence Argus | depth-firstで長いchainを保持。prompt等は非公開 | breadthを捨て一Targetへ集中。取得mechanismは非公開 | model-agnosticと10原則だけ公開 | unattended PoCとisolated targetでの確認。隔離方式は非公開 | `record`、`prioritize`、`iterate`のみ公開 | North Starと10 control properties。実装を推測しない |
| Anthropic reference | 高水準goalを与え、方法をmodelに任せる | threat model、partition、code-search tool、dependency wishlist | distinct slice、varianceのunion、fresh missing-primitive hunt | clean sandbox、executable witness、adversarial verifier | transcript、cheatsheet、find-fix-find | Finder promptと内外境界の第一参照 |
| Semgrep harness | autonomous Finderだが公開pipelineはC/C++ crash探索 | Reconがinput subsystemでpartition | isolated parallel runs | gVisor、egress allowlist、fresh grader、PoC bytesだけhandoff | JSONL/results、dedupe、outer waves | isolationとexecution Verificationを参照。PHP探索logicは移植しない |
| Google/Mandiant AVDH | Hypothesis phaseはminimal self-validationとexpansive brainstorming | 全file entry discovery後、entryごとにmulti-hop enrichment | deterministic sequential stages + stage内fan-out | multiple Validators + Synthesis、最後にhuman PoC | threat model、findings、synthetic benchmark | Surface/Enrichmentとstage separationを参照。human gateはそのまま移植しない |
| OpenAI Codex Security | source-backed independent discovery/validation phases | repository inventory、component split、knowledge inputs | bounded workers、Deep scanの反復 | source validationとcustom validation。gVisor相当は保証しない | sealed manifest/findings/coverage、history、partial retention | artifact、coverage、durable workflowを参照。Lab isolationの根拠にはしない |
| OpenAnt | analyze/verifyへ強いmodel、agentic context loop | language parser、function index、definition/usage/dependency tools | phase pipeline。多providerはAPI adapter | model verification + generated Docker test | run outputとphase data | typed bounded source retrievalの実装参照。proof gateは移植しない |
| wp2shell lineage | broad autonomous reasoningとmissing-link pursuit | source/dependencyをmodelが追う | independent approach familiesとroot synthesis | 実際の成功過程にはhuman reproductionが入った | partial resultを次の探索へ渡す | motivationとgap huntを継承。oracleと巨大promptは継承しない |
| Aikido public articles | multi-step、intent-dependent reasoningを主張 | source、architecture、API、cloud contextを統合すると説明 | parallel specialized agentsを説明 | control/execution分離、network enforcement、per-agent sandbox | findingが次loopへ戻ると説明 | corroborating architectureのみ。closed implementationを参照実装と呼ばない |

## Primary design references

### Wordfence Argus

1. **Free hypothesis / reasoning**

   WordfenceはArgusをdepth-first側と説明し、危険操作から後方、またはuntrusted inputから前方へ追い、
   一つのTargetで長い依存chainを保持するとしている。Avada事例では、単独ではRCEにならない六つの弱点を
   正確な順序で接続し、約二時間のunattended runでPoCまで生成したと報告する。
   [Wordfence, Breadth and Depth](https://www.wordfence.com/blog/2026/08/wordfence-argus-finds-complex-6-step-critical-rce-in-avada-theme-with-1-million-sales/#breadth-and-depth)

2. **Surface / retrieval**

   公開されているのは、PRISMがbreadth、Argusが一Targetのdepthへ資源を寄せるという役割分担までである。
   parser、index、context selection、source query、memoryの構造は公開されていない。

3. **Orchestration / parallelism**

   Argus記事は`confine, constrain, focus, motivate, parallelize, hypothesize, verify, record,
   prioritize, iterate`を列挙し、model-agnosticでtask-specific model selectionとdeterministic
   programmingを組み合わせると説明する。一方、model、prompt、agent topology、並列数、harness designは
   意図的に非公開としている。
   [Wordfence, Argus design overview](https://www.wordfence.com/blog/2026/08/wordfence-argus-moving-beyond-human-research-capability/)

4. **Verification / sandbox**

   Avada事例ではArgusがend-to-end PoCを作り、Wordfenceがisolated targetで確認した。fresh verifier、
   gVisor、egress、credential isolation、Causal Controlの有無は公開されていない。

5. **Record / iteration**

   10原則の三語と継続的model評価は公開されているが、Ledger、artifact、priority function、replay、
   feedback更新方式は公開されていない。

6. **Adopt / do not adopt**

   North Star、depthとbreadthの分離、10語のcontrol propertyは採用する。公開されていない内部構造を
   「Argus方式」と呼んで正当化しない。特にArgus記事は「三つの固定Strategy」も「自由な巨大Prompt」も
   裏付けていない。

### Anthropic Defending Code Reference Harness

1. **Free hypothesis / reasoning**

   Prompting Guideは、高水準taskを与えてmodelへ方法を任せ、長いinstruction、staged checklist、資料の
   過積載を避けるよう明記する。bug classのAPI checklistではなくvulnerability shapeを説明し、Target、
   goal、toolsを渡してpathを選ばせる。
   [Anthropic, Prompting Guide](https://github.com/anthropics/defending-code-reference-harness/blob/d3bea6b5793b5f3d59a75ebe69a58efa88383145/docs/prompting.md#give-the-model-room-to-work)

2. **Surface / retrieval**

   先にsystem mapとthreat modelを作り、単一fileへ閉じず、Focus areaまたはinput-processing subsystemで
   分割する。全contextを詰め込まず、definition/call siteを追えるcode-search toolを提供し、必要な
   dependencyはwishlistで追加する。
   [Anthropic, map, scope, equip](https://github.com/anthropics/defending-code-reference-harness/blob/d3bea6b5793b5f3d59a75ebe69a58efa88383145/docs/best-practices.md#before-you-scan-map-scope-equip)

3. **Orchestration / parallelism**

   同一Promptの並列複製は浅いbugへ収束しやすいため、Reconでdistinct sliceを割り当てる。varianceは
   複数runのunionで扱う。partial chainがあれば一Agentに不足primitiveを言語化させ、fresh sessionへ
   そのprimitiveの探索を任せる。raw parallelismよりre-partitionとfind-fix-findを重視する。
   [Anthropic, scale and convergence](https://github.com/anthropics/defending-code-reference-harness/blob/d3bea6b5793b5f3d59a75ebe69a58efa88383145/docs/best-practices.md#iterating-scale-and-convergence)

4. **Verification / sandbox**

   Discoveryはhigh recall、Verificationはhigh precisionとして分離する。clean sandboxでFinderと
   filesystem、environment、conversationを共有せず、artifactだけを渡す。文章よりcrashやleaked value等の
   executable witnessを優先し、programmatic gateの後でadversarial graderを使う。
   [Anthropic, Verification](https://github.com/anthropics/defending-code-reference-harness/blob/d3bea6b5793b5f3d59a75ebe69a58efa88383145/docs/best-practices.md#verification-the-load-bearing-component)

5. **Record / iteration**

   Transcriptを次runの改善材料にし、validated primitiveとdead endをCHEATSHEET/LESSONSへ戻す。
   Hypothesis、query、result、next pivotを記録するledgerも推奨する。ただし公開autonomous pipelineの
   canonical verifierはC/C++ sanitizer crash向けである。

6. **Adopt / do not adopt**

   Finder promptの抽象度、distinct Focus、missing-primitive continuation、clean Verificationを採用する。
   公開pipelineのASAN-specific success gateやClaude固有processをPHP/WordPressの正本にしない。

### Google Cloud / Mandiant AVDH

1. **Free hypothesis / reasoning**

   Access Control agentとData Flow Analysis agentは、Hypothesis Generationでminimal self-validationと
   expansive brainstormingを行い、consultant-configured Confidence Filterで量を制御する。
   [Mandiant, Hypothesis Generation](https://cloud.google.com/blog/topics/threat-intelligence/staying-ahead-of-adversarial-ai-through-agentic-source-code-review#hypothesis-generation)

2. **Surface / retrieval**

   ExplorerとSpecialist Explorerがdomain、documentation、exclusion、auth、routingを調べる。その後、
   parallel Discoveryが全in-scope fileからentry pointとuser inputを抽出し、entryごとのEnrichmentが
   nested callと複数fileを追ってsanitizer、permission、routing contextを集める。
   [Mandiant, Threat Modeling through Context Enrichment](https://cloud.google.com/blog/topics/threat-intelligence/staying-ahead-of-adversarial-ai-through-agentic-source-code-review#threat-modeling)

3. **Orchestration / parallelism**

   ADKを使うdeterministic sequential stage pipelineで、Explorer、per-file Discovery、Validation等を
   stage内でfan-outする。Validationではhigh-temperature agentを複数動かし、一つのSynthesis agentが
   confirmed、disproven、rejectedへ整理する。

4. **Verification / sandbox**

   Model Validationの後にhuman expertがdynamic reproductionとPoCを行い、失敗を捨てる。sandbox技術、
   network policy、fresh state、credential境界、実行quotaは公開されていない。
   [Mandiant, Expert Validation](https://cloud.google.com/blog/topics/threat-intelligence/staying-ahead-of-adversarial-ai-through-agentic-source-code-review#expert-validation)

5. **Record / iteration**

   textual/visual threat model、deduplicated/risk-rated findings、synthetic benchmark、manually verified ground
   truth、exact-match graderを説明する。Ledger schema、query provenance、replayは公開されていない。
   [Mandiant, Measuring Success](https://cloud.google.com/blog/topics/threat-intelligence/staying-ahead-of-adversarial-ai-through-agentic-source-code-review#measuring-success)

6. **Adopt / do not adopt**

   exhaustive entry inventoryからmulti-hop Enrichmentへ進む分業、HypothesisとValidationのstage分離を
   採用する。Confidence Filterを成立判定に使わず、minority routeを捨てない。human threat-model approvalを
   完全自律Campaignの必須gateとして移植せず、versioned policyと後段Human Confirmationへ分ける。

## Public reference implementations for the evidence shell

### Semgrep Defending Code Harness

1. **Free hypothesis / reasoning**

   Finderはsourceを読み、inputを作り、明確なsuccess signalまで自律探索する。ただし公開pipelineは
   C/C++ memory bugとASAN crashに特化しており、ATO等のlogic chain用Finderではない。

2. **Surface / retrieval**

   Recon agentがdistinct input-processing subsystemを提案し、各Finderの開始点を分ける。汎用AST graphや
   PHP callback mappingの参照実装ではない。

3. **Orchestration / parallelism**

   `--runs N --parallel --auto-focus`で、個別isolated containerへFinderを置く。outer waveでは既知bugを
   記録し、次runをnet-new workへ寄せる。

4. **Verification / sandbox**

   各agentをgVisorへ置き、egressを選択model APIへ制限する。fresh grader containerへPoC bytesだけを渡し、
   Finder reasoningを渡さない。公開実装の最も強い参照点である。
   [Semgrep, pipeline stages](https://github.com/semgrep/defending-code-harness/blob/9fe924b2a9acc320e6eec80becce338175e96ba6/docs/pipeline.md#what-each-stage-does)
   [Semgrep, security considerations](https://github.com/semgrep/defending-code-harness/blob/9fe924b2a9acc320e6eec80becce338175e96ba6/docs/security.md)

5. **Record / iteration**

   transcript、per-run result、shared known-bug record、reportを保存し、複数waveのdedupeと再探索を行う。

6. **Adopt / do not adopt**

   gVisor mandatory gate、default-deny egress、fresh sibling Verification、artifact-only handoffを採用する。
   `3/3 ASAN crash`、plain Docker override、shared mutable known-bug logを本repositoryのFinding contractへ
   移植しない。

### OpenAI Codex Security

1. **Free hypothesis / reasoning**

   Scan workflowはThreat Model、Finding Discovery、Validation、Attack Path Analysisを分離し、workerへ
   source-backed investigationを任せる。Deep scanは独立runを繰り返すが、同じ候補の再出現をreportability
   proofにしない。
   [Codex Security, Deep Security Scan](https://github.com/openai/codex-security/blob/main/sdk/typescript/_bundled_plugin/skills/deep-security-scan/SKILL.md)

2. **Surface / retrieval**

   repository/path/diff inventory、component plan、knowledge-base input、coverage worklistを持つ。これは
   auditable coverageには強いが、PHP AST relation engineの参照実装ではない。

3. **Orchestration / parallelism**

   Deep modeはworker、subagent、max discovery run、no-new stop、time/cost limitを外から設定し、partial resultを
   保持する。component scanとbulk scanもworker上限を持つ。
   [Codex Security TypeScript SDK, Deep scans](https://github.com/openai/codex-security/blob/main/sdk/typescript/README.md#configure-deep-scans)

4. **Verification / sandbox**

   独立Validation phaseとcustom validationを持つが、repositoryの公開Security Policyはlocal accountと
   selected filesystem profileを境界として説明し、gVisor相当のruntime target isolationを保証しない。
   [Codex Security Security Policy](https://github.com/openai/codex-security/security/policy)

5. **Record / iteration**

   canonical `scan-manifest.json`、`findings.json`、`coverage.json`を検査してsealし、incomplete coverageを
   成功にしない。history、rerun、finding matching、false-positive reason、new/persisting/resolved/unknownを
   durableに扱う。
   [Codex Security TypeScript SDK, Scan history and reruns](https://github.com/openai/codex-security/blob/main/sdk/typescript/README.md#scan-history-and-reruns)

6. **Adopt / do not adopt**

   phase separation、canonical artifact、coverage reconciliation、partial preservation、model recurrenceとproofの
   分離を採用する。Codex Securityのlocal sandboxを、untrusted WordPress targetを実行するVerification Labの
   代替にしない。

## Supporting implementations and case lineage

### OpenAnt

1. **Free hypothesis / reasoning**: detection、reachability、verificationへstronger reasoning modelを割り当て、
   context/report/test generationへ軽量modelを選べる。
2. **Surface / retrieval**: language parser、function index、definition、usage、file range、static dependencyの
   typed tool loopを実装する。
3. **Orchestration / parallelism**: parse、enhance、analyze、verify、dynamic test、reportをphaseとして分ける。
4. **Verification / sandbox**: attacker-simulation modelとgenerated Docker testを持つが、test自身のstatus申告や
   plain Dockerは本repositoryのevidence gateより弱い。
5. **Record / iteration**: phase outputとtoken usageを保存するが、Target-bound append-only Ledgerの参照ではない。
6. **Adopt / do not adopt**: bounded typed retrieval、incomplete state、strong/cheap modelのrole別選択を参照する。
   verification verdict、credential/API transport、Docker isolationは移植しない。
   [OpenAnt README](https://github.com/knostic/OpenAnt)
   [OpenAnt context tools](https://github.com/knostic/OpenAnt/blob/bf8385c197c3eeaed172392b09221bc9871ea9f5/libs/openant-core/utilities/agentic_enhancer/tools.py)

### wp2shell prompt lineage

wp2shellは「自由に考えさせれば十分」という証拠ではなく、**partial primitiveを保存し、不足linkを次の
高推論runへ渡す**必要性を示すcase lineageである。公開記事によれば、最初にSQLi候補が得られ、人間が
実データreadを再現した後、そのprimitiveをRCEへ伸ばす別のmodel workを依頼し、長いchainを得た。
[Discoverer write-up](https://www.slcyber.io/research/exploit-brokers-pay-500000-for-a-wordpress-rce-i-found-one-with-gpt5-6)

この系譜からmotivation、independent approach、missing-link hunt、root synthesisを残す。一方、既知の
肯定解を保証するoracle、最低実行時間、巨大な一枚Prompt、model自身によるspawn/budget/record管理は
productionへ持ち込まない。詳細は[wp2shell由来Promptの責務分解](wp2shell-prompt-decomposition.md)を正本とする。

### Semgrep-first WordPress huntingの実務上の境界

DutafiはWordPress向けcustom Semgrep、rule-based triage、段階的AI review、local verificationを組み合わせ、
二か月で31件をPatchstackへ提出したと報告している。これはSemgrep-first方式が、既知fingerprintを持つSQLi、
XSS、object injection、access control、file/path系の広域候補生成とnoise削減に実務上有効であることを示す。

同時に著者自身が、business logic、ownership/state依存、second-order、multi-step chain、wrapper、storage layer、
framework abstractionを跨ぐflowを弱点として挙げ、高影響のdeserializationとSQLiを実際に取りこぼしたと記す。
したがって本harnessではSemgrepを否定せず、Target選別、候補seed、modelが発見したpatternの横展開、coverage、
regressionへ使う。Argus型depthの主Finderまたは`safe`判定には使わない。
[Dutafi, How I Structure My WordPress Vulnerability Hunting Workflow](https://medium.com/@ductai126/how-i-structure-my-wordpress-vulnerability-hunting-workflow-0a236760096f)

### Aikido public architecture articles

Aikidoは、static sourceを複数file/moduleにまたがって推論するCode Analysisと、source、architecture、API、
cloud configurationからattack surfaceを作り、specialized agentsがparallelにmulti-step pathを追ってlive
exploitationで確認するInfiniteを説明する。
[Aikido AI Code Analysis](https://www.aikido.dev/blog/introducing-code-audit-find-complex-vulnerabilities-hidden-in-your-codebase)
[Aikido Infinite](https://www.aikido.dev/blog/introducing-aikido-infinite)

また、reasoning/orchestrationのcontrol planeとtool/browser/networkのisolated executionを分け、domain
allowlist、HTTP/DNS enforcement、per-agent sandboxを使うと説明する。
[Aikido agent security architecture](https://www.aikido.dev/blog/ai-pentesting-agent-security)

これらは本repositoryの内外分離を補強するfirst-party descriptionである。ただしsource code、prompt、
artifact contract、reproducible benchmarkは公開されていないため、Aikidoをpublic reference implementationとは
数えず、製品側の性能主張を独立検証済みevidenceとして扱わない。

## Worked implication: dictionary-row disclosure plus password reset

匿名AJAXによるdictionary row readと、未認証password reset triggerを別々に見つけても、各Finderが
「単独impactが弱い」と捨てればATOは失われる。必要なのは、三Strategyを増やすことより次のartifactと
loopである。

```text
Route Fragment A
  attacker: unauthenticated
  action: anonymous AJAX read
  effect: attacker learns row value V
  state identity: dictionary[key]

Route Fragment B
  attacker: unauthenticated
  action: initiate password reset(account)
  effect: reset state/token becomes available through identity K

Chain Synthesis
  Does B write a value/identifier that A can read?
  Does the leaked value authorize password replacement?
  Which account and lifecycle constraints bind both fragments?

Fresh Verification
  witness: exact unauthorized account transition
  controls: no disclosure / no reset trigger / wrong identity / expired state
```

必要なmodel workは、二つのfeatureを同じ語彙で検索することではなく、`action -> capability -> state -> next
capability`として意味を接続することである。したがってFinder outputはsink名だけでなく、少なくとも
attacker premise、state identity、precondition、effect/capability、consumed value、unknown、falsifierを
保持する必要がある。

三つのparallel Attemptはこのchainを直接完成させなくてもよい。一つがread primitive、別の一つがreset
primitiveを返し、Wave barrier後のChain Synthesisが接続候補とmissing edgeを作り、次のhigh-reasoning
Frontier Attemptへ「この二つは同一state identityで接続するか」を渡せればよい。逆に、Attempt outputを
最終Findingだけへ圧縮する現状では自由なmodelでもchain材料が失われる。

## Recommended reference allocation

| Harness responsibility | Primary precedent | Adaptation here |
| --- | --- | --- |
| Finder promptの自由度 | Anthropic Prompting Guide | high-level goal + Focus lens + tools + typed terminal。固定checklistを避ける |
| depth-first compromise goal | Wordfence Argus case | Frontier Laneで長いcapability chainを保持する |
| surface coverage / enrichment | Mandiant AVDH | deterministic inventoryをseedに、bounded source retrievalでmulti-hop contextを取る |
| missing primitive continuation | Anthropic + wp2shell lineage | Route FragmentとUnknownを次のfresh Attemptへ渡す |
| typed source retrieval | OpenAnt | snapshot-bound `read/search/symbol/graph`としてharness-ownedにする |
| process isolation / fresh proof | Semgrep harness + Anthropic | gVisor、default-deny egress、fresh sibling Lab、artifact-only handoff |
| durable artifacts / coverage | Codex Security | CAS/Ledger、sealed typed artifacts、incompleteを成功にしない |
| model choice | Argus + OpenAnt | provider非依存Profile、role別benchmark、Frontier workへ高推論を優先 |

## What the harness must and must not do

Harnessが必須なのは、modelより賢い探索手順を実装するためではない。次を保証するためである。

- modelが見るTargetとsourceを固定し、必要な箇所へ安全に到達させる
- 独立Attemptが同じ浅い場所へ重複しないようFocus ownershipを分ける
- partial primitive、unknown、negative evidenceを失わず、次の推論へ渡す
- stochasticな仮説を、fresh runtime evidenceとCausal Controlで事実へ変える
- crash、timeout、provider変更があっても同じidentityから再開できる
- 自由なagentがcredential、host、許可外networkへ出られないよう物理的に制限する

Harnessがすべきでないのは、次である。

- 全脆弱性を決定論的Surface Mapへ事前列挙する
- 三つのStrategyを逐次checklistにしてFinderの推論pathを固定する
- model confidence、複数modelの多数決、同じ候補の再出現をFinding proofにする
- primitiveをRCEでないという理由で捨てる
- Finderのsource argumentやPoCを同じenvironmentで自己承認させる
- Argusの非公開実装を推測し、その推測を設計根拠にする

## Falsifiable next experiment

同一Target Snapshot、Model Profile、tool budgetで次のA/Bを行う。

- **A: strategy-scripted** — 現行Strategy wordingを手順として強く要求する
- **B: free-reasoning shell** — Focus lens、goal、tools、typed terminalだけを渡し、調査方法を任せる

測るのはFinding数だけではない。`source range reached`、`distinct Route Fragment`、`state identityを持つ
fragment`、`missing primitive request`、`cross-fragment connection`、`independent Verification outcome`、
token、wall timeを記録する。Bがchain材料またはverified routeを増やさずnoiseだけを増やすなら、自由度を
戻す。BがATO/RCEの接続を増やすなら、三Strategyをinstructionではなくlensとして固定する。
