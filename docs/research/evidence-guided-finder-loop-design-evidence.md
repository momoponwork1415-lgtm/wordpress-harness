# Evidence-guided Finder loop の設計根拠

Status: research note, 2026-09-02

## Scope

この文書は、[Evidence-guided Finder loop](../design/evidence-guided-finder-loop.md)で
harness固有とされている判断について、何を外部実装が直接行っており、何を本harness向けに
adaptationしたのか、何がまだ検証前のlocal choiceなのかを分ける。

ここで引用するOpenAnt、Codex Security、W3C、NIST、OASIS、in-toto、Bazel、LSPは、
[Design references](../REFERENCES.md)の3件と同列の第4以降の設計参照資料ではない。
個別のsecurity property、artifact、code-navigation operationを支える補助根拠としてだけ使う。
private benchmarkのTarget、identifier、route、Findingは記録しない。

## Conclusion

提案の中心にある次の判断には、公開された実装上の直接precedentがある。

- 固定contextを探索境界にせず、型付きsource toolでdefinition、usage、caller、callee、source rangeを追う
- Target sourceをread-onlyかつofflineの許可scopeへ閉じ込める
- model由来signalでdeterministic factをdemoteしない
- 不足情報を成功または安全判定へ丸めず、partial、deferred、incompleteとして残す
- 一つの局所分析内のtool loopと、分析結果を受けた次roundを分ける

一方、`SourceEvidenceGateway`という一つのInterface、`read / search / symbol / graph`という
四分類、全queryをprivate CASの`Tool Receipt`にすること、`observed / inferred / unknown`という
正確な3値、四種類のterminal Finder artifactは、一つの外部harnessからコピーした仕様ではない。
複数の実装precedentと、本projectのSnapshot confinement、provider independence、replay、
evidence integrityという既存要件を合成したadaptationである。採用には合理的根拠があるが、
具体的なschemaとbudgetはBehavior Testとoracle-separated benchmarkで決める必要がある。

## Evidence labels

| Label | Meaning |
| --- | --- |
| **Direct precedent** | 同じ種類のsecurity/code-analysis systemが、同じbehaviorを公開実装または公式methodとして持つ |
| **Adaptation** | 外部precedentが性質を支えるが、境界、名前、schemaを本harnessの要件へ合わせて合成したもの |
| **Still provisional** | 外部資料だけでは決まらず、Target横断の測定またはBehavior Testが必要なlocal choice |

`Direct precedent`は、その実装をそのまま移植して安全であるという意味ではない。
例えばOpenAntのtool loopは今回のContext Reachを直接支えるが、本harnessのcredential分離、
CAS、PHP Program Index、provider-neutral transportまで保証するものではない。

## Decision traceability matrix

| Proposed decision | Direct precedent | Adaptation for this harness | Still provisional | Assessment |
| --- | --- | --- | --- | --- |
| harness-ownedなtyped/read-only source tools | OpenAntはJSON schema付きのdefinition、usage、function、file range、static dependency toolを実装し、最大20 iterationで利用する。Codex Securityはauthorized scope内のsourceをread-only、offlineで調査する。Anthropicは全sourceをpromptへ詰めずcode-search toolからdefinition/call siteを得る | provider組込みshellではなく、全Model Profileが同じpolicyを通る`SourceEvidenceGateway`へ閉じる。NISTのleast privilegeをprocessにも適用する | process境界、provider tool protocolへの変換、call/byte/hop上限 | **Direct behavior + security adaptation** |
| source queryとdurable Map revisionを分ける | OpenAntはContext Enhancerのread/search tool loopと、別段のLLM reachability signal適用を分け、後者だけがdatasetへsignalを追加する。MicrosoftのCQRS guidanceはread modelとwrite modelを分ける | `Source Evidence Query`はAttempt-localなread、`Mapping Evidence Request`は次のMap revisionを要求するdurable artifactとする | requestの自動承認条件、revision compilerとのreconcile順 | **Direct two-stage precedent; seam is adaptation** |
| request、policy decision、responseをTool Receiptとして記録する | Codex Securityはworker resultを統合前にdurable checkpointし、stable candidate ID、deferred reason、counterevidence、source evidenceを保持する。NIST AU-3はevent type、time、place、source、outcome、associated identityをaudit recordに求める | source queryを監査可能なeventとみなし、Snapshot、Lease、policy、request、outcome、truncation、result digestを一つのReceiptへ束ねる | fieldの正確な集合、retention、raw excerptをCASへ置く境界 | **Strong adaptation; no exact external Tool Receipt schema** |
| Tool Receipt payloadをcontent-addressedにする | Bazel Remote Execution APIはinput/output blobをdigestでCASへ置き、Action digestからActionResultを引く。in-toto Statementはimmutable subjectをdigestで同定する。Codex Securityのcanonical artifactもSHA-256をmanifestへ持つ | 同じsource responseの重複保存を避け、Attemptが実際に見たbyte列へdigestで結び付ける。query semanticsはCAS keyだけでなくversioned Receipt schemaで表す | canonical serialization、request digestに含めるpolicy/budget、garbage collection | **Cross-domain adaptation, not a copied security-harness feature** |
| provenanceをrequestからresultまで保持する | W3C PROVはEntity、Activity、usage、generation、derivationを分離する。SLSA Provenanceは`buildDefinition`と`runDetails`を分ける | Snapshot/sourceをEntity、query executionをActivity、Receipt/resultをgenerated Entityとして参照する。PROVをそのまま実装せず、必要なrelationだけdomain schemaへ写す | producer identityの粒度、どこまでのintermediateを残すか | **Standards-grounded adaptation** |
| `observed / inferred / unknown`を潰さない | OpenAntはstructural `is_entry_point`と`llm_reachability_signals`を別に保持し、AI signalはpromote-onlyでstructural factをdemoteしない。SARIFは`pass`、`fail`に加え、情報不足の`open`を明示する | parser/index由来を`observed`、model提案を`inferred`、解けないrelationを`unknown`とし、AI overlayからobserved factの削除を許さない | inferred relationの採用threshold、knowledge由来relationの位置、unknownの解消規則 | **Direct monotonic-overlay precedent; exact three grades are adaptation** |
| Hypothesis以外のterminal artifactを保持する | Anthropicはpartial chainから不足primitiveを明示しfresh sessionへ渡す。Codex Securityはdeferred、rejected、unresolved proof gapを保持する。OpenAntは上限到達等を`neutral`でなく`incomplete`にする。SARIFは情報不足を`open`にする | `SourceBoundHypothesis`、`RouteFragmentProposal`、`MappingEvidenceRequest`、`ClosureRecord`へdomain上の意味を分割し、空配列へ圧縮しない | 各schemaの必須field、複数artifact同時出力、Closureの十分条件 | **Direct need for non-success states; four-way schema is adaptation** |
| Attempt-local loopとWave-to-wave loopを分ける | OpenAntは一unit内でbounded tool loopを回す。Anthropicはpartial chainのgapを次のfresh sessionへ渡し、同じparallel passの追加よりfind-fix-findやre-partitionを勧める。Mandiant AVDHはEnrichment、Hypothesis、Validationをstageで分ける | sourceを追う局所loopはAttempt identityとbudget内、Map revision、dedupe、verification、次work選定はWave barrier後とする | session continuation方法、最大iteration、net-new evidenceの停止threshold | **Direct two-scale behavior; exact boundary is adaptation** |
| `read / search / symbol / graph`の四操作 | OpenAntの`read_file_section`/`read_function`、`search_definitions`/`search_usages`、`get_static_dependencies`が相当する。LSPにもdefinition、references、incoming/outgoing call hierarchyという安定したcode-navigation requestがある | providerへ多数のindex実装を漏らさず、PHP Program Indexを背後に置く四つのcapability familyへ畳む | literal/regex grammar、symbol ambiguity、graph relation vocabulary、pagination | **Operations are direct; four-name facade is provisional adaptation** |

## Primary implementation precedents

### OpenAnt: typed context tool loop

OpenAntの`agentic_enhancer`は、次のmodel-visible toolをJSON input schema付きで定義する。

- `search_usages`
- `search_definitions`
- `read_function`
- `list_functions`
- `read_file_section`
- `get_static_dependencies`
- `finish`

tool executorは`RepositoryIndex`だけを呼び、usage resultを10件、static dependencyとcallerを20件へ
制限する。[OpenAnt `tools.py`, tool schemas and executor](https://github.com/knostic/OpenAnt/blob/bf8385c197c3eeaed172392b09221bc9871ea9f5/libs/openant-core/utilities/agentic_enhancer/tools.py#L25-L214)
[OpenAnt `tools.py`, bounded results](https://github.com/knostic/OpenAnt/blob/bf8385c197c3eeaed172392b09221bc9871ea9f5/libs/openant-core/utilities/agentic_enhancer/tools.py#L216-L352)

Context Agentは初期codeとstatic dependenciesから開始し、最大20 iterationでtool callとresultを
conversationへ戻す。inputとtool resultにもchar ceilingを設け、正常な`finish`なし、token truncation、
上限到達を`neutral`でなく`incomplete`として保存する。
[OpenAnt `agent.py`, budgets and incomplete state](https://github.com/knostic/OpenAnt/blob/bf8385c197c3eeaed172392b09221bc9871ea9f5/libs/openant-core/utilities/agentic_enhancer/agent.py#L40-L70)
[OpenAnt `agent.py`, tool dispatch and terminal handling](https://github.com/knostic/OpenAnt/blob/bf8385c197c3eeaed172392b09221bc9871ea9f5/libs/openant-core/utilities/agentic_enhancer/agent.py#L352-L456)

さらに`read_file_section`はmodel入力のrelative pathをrepository rootへresolveし、`..`、absolute
path、symlinkによるroot外escapeを拒否する。
[OpenAnt `repository_index.py`, repository confinement](https://github.com/knostic/OpenAnt/blob/bf8385c197c3eeaed172392b09221bc9871ea9f5/libs/openant-core/utilities/agentic_enhancer/repository_index.py#L219-L255)

この実装は「bounded typed source retrievalが実在する」ことを直接支える。ただし、本harnessが
必要とするTarget Snapshot digest、全tool resultのdurable Receipt、credential isolation、
role別permission、provider-neutral replayはOpenAntのこの部分からは得られない。

### OpenAnt: read pathとMap-changing signalの分離

OpenAntのLLM reachability stageはmodel提案を`llm_reachability_signals`として別にappendする。
高confidenceのentry-point signalだけが`is_entry_point = true`へpromoteでき、structural passが
立てた`true`をmodelが`false`へ戻す経路はない。適用されたpromotion setもrun provenanceへ残す。
[OpenAnt `llm_reachability.py`, promote-only application](https://github.com/knostic/OpenAnt/blob/bf8385c197c3eeaed172392b09221bc9871ea9f5/libs/openant-core/core/llm_reachability.py#L486-L615)

一方、前節のcontext toolはsourceを取得するだけで、tool call自体がreachability factを追加しない。
これは「読んだこと」と「Mapへrelationを採用したこと」を別operationにする直接precedentである。
ただしOpenAntに`MappingEvidenceRequest`というartifactや、本harnessと同じMap revision compilerはない。

### Codex Security: authorized read-only exploration and durable uncertainty

Codex SecurityのCore ScanはTargetをread-only、authorized scope、current state、offline searchへ
制限する。Investigation Packetはsource-backedな開始点だが、Focused Investigatorは実sourceから
caller、dataflow、control、concrete implementation、sibling routeを追う。
[Codex Security `core-scan.md`, scope and offline source](https://github.com/openai/codex-security/blob/69c500398c5a4565290cbb609ff5f254f2d1acc5/plugins/codex-security/references/core-scan.md#L5-L20)
[Codex Security `core-scan.md`, focused investigator](https://github.com/openai/codex-security/blob/69c500398c5a4565290cbb609ff5f254f2d1acc5/plugins/codex-security/references/core-scan.md#L65-L84)

worker結果は統合前に`complete: false`でcheckpointされ、candidate ID、deferred reason、元candidate、
counterevidence、unresolved questionを保持する。validated、rejected、pendingを同じ成立Findingへ
丸めず、coverage completeも実際にreviewしたinventoryとの照合後だけ許す。
[Codex Security `core-scan.md`, checkpoint and coverage reconciliation](https://github.com/openai/codex-security/blob/69c500398c5a4565290cbb609ff5f254f2d1acc5/plugins/codex-security/references/core-scan.md#L10-L16)

Codex Securityのcompleted-scan contractはcanonical `scan-manifest.json`、`findings.json`、
`coverage.json`を持ち、manifestからartifactのSHA-256へ参照し、reportを決定的projectionとして
生成する。[Codex Security completed-scan example](https://github.com/openai/codex-security/tree/69c500398c5a4565290cbb609ff5f254f2d1acc5/plugins/codex-security/examples/completed-scan)

これはdurable intermediate state、source evidence、uncertainty、hashed canonical artifactのprecedentで
あって、「source queryごとにCAS Receiptを作る」precedentではない。Codex Security自身もCore Scanで
別のreceipt formatを増やさないよう明記している。本harnessでは既存Research Ledger/CASが正本であり、
model/provider比較とcrash replayにquery-level contextが必要なため、異なる境界でadaptationする。

### Anthropic and Mandiant: context reach and two-scale iteration

Anthropic Best Practicesは、Focusを単一file境界にせず、全contextをpromptへ詰め込まず、
definitionとcall siteへ移動できるcode-search toolを提供するよう勧める。
[Anthropic Best Practices, map/scope/equip](https://github.com/anthropics/defending-code-reference-harness/blob/d3bea6b5793b5f3d59a75ebe69a58efa88383145/docs/best-practices.md#L16-L43)
[Anthropic Best Practices, code-search tools](https://github.com/anthropics/defending-code-reference-harness/blob/d3bea6b5793b5f3d59a75ebe69a58efa88383145/docs/best-practices.md#L157-L183)

同資料はpartial chainで不足primitiveを明示し、同じTargetのfresh sessionへそのprimitive探索を
割り当てる。重複するparallel agentを増やすより、find-fix-findとre-partitionで次roundの探索面を
変えることを勧める。
[Anthropic Best Practices, scale and convergence](https://github.com/anthropics/defending-code-reference-harness/blob/d3bea6b5793b5f3d59a75ebe69a58efa88383145/docs/best-practices.md#L114-L153)

Mandiant AVDHもentry point単体では不十分として、Enrichment agentが複数hop/file先のsanitizer、
permission、routingを集めた後、Hypothesis GenerationとValidationへ進む。
[Mandiant AVDH, Context Enrichment through Validation](https://cloud.google.com/blog/topics/threat-intelligence/staying-ahead-of-adversarial-ai-through-agentic-source-code-review#context-enrichment)

これらは「contextを追う局所作業」と「partial結果を次の独立workへ変換する反復」の両方を直接支える。
ただし`Attempt-local loop`と`Wave-to-wave loop`という名前、どのartifactをbarrierでfoldするか、
provider sessionを継続するかは本harnessのadaptationである。

## Supporting standards and what they do not prove

### Least privilege and audit content

NISTはleast privilegeを、userまたはprocessへassigned taskに必要な最小権限だけを与える原則と
定義する。[NIST CSRC, least privilege](https://csrc.nist.gov/glossary/term/least_privilege)
SP 800-53 Rev. 5のAC-6もprocessに必要なauthorized accessだけを許すことを求める。
[NIST SP 800-53 Rev. 5, AC-6](https://csrc.nist.gov/pubs/sp/800/53/r5/upd1/final)

これによりFinderへread/search capabilityだけを渡し、shell、network、write、runtimeを渡さない
方向は支えられる。NISTは`read / search / symbol / graph`というAPIやTypeScript Interfaceを
規定しないため、その具体形はlocal designである。

同じくAU-3はaudit recordからevent type、time、place、source、outcome、関連identityを確定できる
ことを求め、AU-9はaudit informationとtoolをunauthorized access、modification、deletionから
保護することを求める。[NIST SP 800-53 Rev. 5, AU-3 and AU-9](https://doi.org/10.6028/NIST.SP.800-53r5)
Tool Receiptへrequest、policy outcome、result、Attempt/Lease identityを入れる根拠になるが、
CAS、append-only実装、field name、保持期間までは支持しない。

### Provenance and content addressing

W3C PROV-DMは固定aspectを持つEntityと、EntityをuseまたはgenerateするActivityを区別し、
`used`、`wasGeneratedBy`、`wasDerivedFrom`で由来を表す。
[W3C PROV-DM, Entities and Activities](https://www.w3.org/TR/prov-dm/#section-entity-activity)
[W3C PROV-DM, Derivation](https://www.w3.org/TR/prov-dm/#Derivation)
Source queryをActivity、Snapshot/source/resultをEntityとして考える根拠になるが、PROVをそのまま
Research Ledger schemaとして採用する必要はない。また、`used`と`wasGeneratedBy`を二つ記録した
だけで個々の入力から出力への`wasDerivedFrom`が自動的に証明されるわけではない。relationは実際に
観測または推論した粒度で記録する。

in-toto Statement v1はsubjectへdigestを必須とし、subject artifactをimmutableと仮定する。
[in-toto Statement v1.2](https://github.com/in-toto/attestation/blob/v1.2.0/spec/v1/statement.md)
Link predicateは入力`materials`、出力`products`、実行`command`、`byproducts`、`environment`を
型付きpredicateとして分ける。
[in-toto Link predicate v1.2](https://github.com/in-toto/attestation/blob/v1.2.0/spec/predicates/link.md)
SLSA Provenance v1は入力定義`buildDefinition`と実行固有`runDetails`を分離する。
[SLSA Build Provenance v1](https://slsa.dev/spec/v1.2/build-provenance)
これらはTarget Snapshotへのbinding、request definitionとexecution outcomeの分離を支えるが、
Source Evidence Queryをsupply-chain attestationとして署名せよという意味ではない。attestationが
存在しても記載内容の真実性はそれだけでは証明されず、SLSAも全intermediate artifactの保存を
要求しない。

Bazel Remote Execution APIはinput/output contentをdigestでCASへ置き、encoded `Action`のdigestから
`ActionResult`を取得する。timeoutもAction identityへ含め、異なるtimeoutの結果が誤ってcache hit
しないようにする。
[Bazel Remote Execution API v2.12.0, CAS and Action Cache](https://github.com/bazelbuild/remote-apis/blob/v2.12.0/build/bazel/remote/execution/v2/remote_execution.proto)
このprecedentはSnapshot、tool policy、budgetが異なるquery executionを同じreplay identityへ
混ぜない設計を支える。ただしBazelはLLM tool receiptを規定しておらず、CAS自体もappend-only、
retention、durabilityを保証しない。cache lifetimeとgarbage collectionは実装側のpolicyである。

### Explicit insufficient-information states

SARIF 2.1.0はanalysis resultの`kind`として、問題なしを証明した`pass`、問題を示す`fail`に加え、
情報不足で決定できない`open`を区別する。またhuman judgmentが必要な`review`も別にする。
[OASIS SARIF 2.1.0, result.kind](https://docs.oasis-open.org/sarif/sarif/v2.1.0/os/sarif-v2.1.0-os.html#_Toc34317648)

これはbudget exhaustionやmissing mappingを`safe`へ丸めない根拠になる。SARIFの`open`が本harnessの
`unknown`、`MappingEvidenceRequest`、`Blocked`すべてと同義なのではない。どのownerが次workを
作るかを区別するため、domain artifactは別に必要である。

### Read and graph operation vocabulary

Language Server Protocolはtyped request/responseとしてdefinition、references、incoming calls、
outgoing callsを標準化している。[Language Server Protocol 3.17](https://microsoft.github.io/language-server-protocol/specifications/lsp/3.17/specification/)
これは`symbol`と`graph`が一般的なcode-navigation capabilityであることを支える。
LSPはsecurity analysis、Snapshot confinement、literal search、evidence gradeを規定しないため、
LSP serverを導入すべきという結論にはならない。

### Command-query separation

MicrosoftのCQRS guidanceは、read operationとwrite operationを別modelへ分離し、query側を
data取得、command側をupdateとして扱う。
[Microsoft Azure Architecture Center, CQRS](https://learn.microsoft.com/en-us/azure/architecture/patterns/cqrs)

この原則はSource Evidence QueryとMap revision commandを同じoperationにしない説明を補強する。
本harnessでread/write storeを分離したり、CQRS frameworkを導入したりする根拠にはしない。
このsliceでは同じmodular monolithと既存CAS/Ledgerを使い、小さなInterfaceだけを分ける。

## Why the exact four operations are reasonable but not yet fixed

四分類は、次の実在operationを本projectの既存PHP Program Indexへ合わせてまとめた最小候補である。

| Proposed operation | Existing implementation behavior | Why it remains provisional |
| --- | --- | --- |
| `read` | OpenAntの`read_function`、`read_file_section` | line、byte、symbolのどれをprimary addressにするか未測定 |
| `search` | OpenAntのdefinition/usage search、Codex Securityのoffline ripgrep | literal、限定regex、structural queryの必要範囲が未測定 |
| `symbol` | OpenAntのdefinition/function ID、LSP definition/references | PHP dynamic dispatchでambiguityをどう返すか未確定 |
| `graph` | OpenAntのstatic dependency/caller、LSP call hierarchy | caller/callee以外のhook、registration、state edgeの最小語彙が未確定 |

したがってproduction public contractへ四つの別Interfaceを固定しない。一つの内部
`SourceEvidenceGateway.query`のversioned discriminated unionとして最初のBoundary Pairを試し、
operationの統合または分割を後から行えるようにする。この「一Gateway」はdeep seamとしてのlocal
designであり、外部sourceが唯一解として要求しているものではない。

## What still requires empirical evidence

次は資料を増やしても決まらない。合成fixtureと複数plugin familyのoracle-separated runで測る。

1. Attemptあたりのtool call、read byte、graph hop、wall time、context ceiling
2. literal searchへ限定regexを許すか、structural searchを別operationにするか
3. ambiguous symbol候補の最大件数とpagination
4. `inferred` relationを次Map revisionへ採用する最低条件
5. `RouteFragmentProposal`と`MappingEvidenceRequest`の必須fieldと重複identity
6. 一Attemptが複数terminal artifactを返す時のorderingとpartial failure
7. 次Waveを作るために必要な最低`net-new evidence`
8. Tool Receiptのretention、redaction、CAS garbage collection
9. provider session continuationとfresh continuationのrecall/cost差

これらへ「OpenAntが20回だから20回」「BazelがCASだから全raw transcriptをCAS」といった値の移植を
しない。最初のvertical sliceは、外部precedentが強いbehaviorだけをacceptance scenarioへする。

## Evidence-backed acceptance properties

production実装へ進む場合、少なくとも次を公開Seamから観測する。

- Finderは固定Initial Context外のdefinition/usage/source rangeへ、許可されたtyped queryで到達できる
- normalized Target Snapshot外のpath、write、network、runtime operationは拒否される
- source queryを実行してもSurface Map revisionは暗黙に変わらない
- AI由来overlayはsource anchorとprovenanceを持ち、既存`observed` factを削除またはdowngradeしない
- zero match、ambiguous、truncated、budget exhausted、policy rejectedを成功空配列へ潰さない
- ReceiptはSnapshot、Lease、request、policy outcome、result digestへ逆引きできる
- crash後のresumeは異なるSnapshot、policy、budgetのresponseを再利用しない
- terminal出力はHypothesisだけでなく、partial route、不足証拠、根拠付きclosureを失わない
- 次Waveは新しいMap revision、Route Fragment、coverage ownerまたは具体的gapのいずれかを根拠にする

この組合せは一つの外部harnessの模倣ではない。しかし各propertyは、公開実装の失敗対策、標準化された
provenance/audit原則、または本projectですでにacceptedなsecurity invariantのいずれかへ遡れる。
残る独自性はschemaとbudgetの具体化であり、それらはprovisionalとして測定対象に残す。

## Source inventory

- [Mandiant AVDH](https://cloud.google.com/blog/topics/threat-intelligence/staying-ahead-of-adversarial-ai-through-agentic-source-code-review)
- [Anthropic Defending Code Reference Harness, pinned commit](https://github.com/anthropics/defending-code-reference-harness/blob/d3bea6b5793b5f3d59a75ebe69a58efa88383145/docs/best-practices.md)
- [OpenAI Codex Security, pinned commit](https://github.com/openai/codex-security/tree/69c500398c5a4565290cbb609ff5f254f2d1acc5)
- [OpenAnt, pinned commit](https://github.com/knostic/OpenAnt/tree/bf8385c197c3eeaed172392b09221bc9871ea9f5)
- [NIST SP 800-53 Rev. 5](https://doi.org/10.6028/NIST.SP.800-53r5)
- [W3C PROV-DM](https://www.w3.org/TR/prov-dm/)
- [in-toto Attestation Framework, Statement v1.2](https://github.com/in-toto/attestation/blob/v1.2.0/spec/v1/statement.md)
- [in-toto Attestation Framework, Link predicate v1.2](https://github.com/in-toto/attestation/blob/v1.2.0/spec/predicates/link.md)
- [SLSA Build Provenance v1](https://slsa.dev/spec/v1.2/build-provenance)
- [Bazel Remote Execution API v2.12.0](https://github.com/bazelbuild/remote-apis/blob/v2.12.0/build/bazel/remote/execution/v2/remote_execution.proto)
- [OASIS SARIF 2.1.0](https://docs.oasis-open.org/sarif/sarif/v2.1.0/os/sarif-v2.1.0-os.html)
- [Language Server Protocol 3.17](https://microsoft.github.io/language-server-protocol/specifications/lsp/3.17/specification/)
- [Microsoft Azure Architecture Center — CQRS pattern](https://learn.microsoft.com/en-us/azure/architecture/patterns/cqrs)
