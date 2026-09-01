# White-box Surface Mapping security reference

Status: supporting research note, 2026-09-02

## Position

この文書は、[Source mapping seam](../design/source-mapping-seam.md)の設計判断を、white-box security reviewの一次資料と照合した補助メモである。[Design references](../REFERENCES.md)に定めた3件へ第4のagentic-design referenceを追加するものではなく、個別のschemaや実装を外部資料の権威だけで正当化しない。

結論は次の通りである。

- `entry -> processing/guard -> state -> sink`をsource anchor付きで地図にする方向は、OWASP、NIST、OffSec、主要なstatic-analysis modelが共有するwhite-box reviewの実務と整合する。
- static analysisだけで実行時の到達可能性や脆弱性成立を断定せず、未解決箇所と未解析範囲を明示する方針も妥当である。
- `observed / inferred / unknown`、Content-addressed Storage（内容由来のdigestで保存する方式）、stable ordering、immutable revisionは外部methodologyそのものではない。LLMを含む反復探索を再現・監査できるようにする、このharness独自のevidence engineeringである。
- 現在の実装は安全な最初の骨格だが、まだ完全なsource-to-sink Surface Mapではない。現時点で「脆弱性探索ができる地図」や「coverage済み」と呼んではならない。

## Convergent security-review practice

### Map the attack surface before deep testing

OWASP WSTGは、深いtestingより前にapplicationとattack surfaceを列挙し、request parameter、authentication state、multi-step processを含むentry pointを記録するよう求める。[WSTG v4.2: Identify Application Entry Points](https://owasp.org/www-project-web-security-testing-guide/v42/4-Web_Application_Security_Testing/01-Information_Gathering/06-Identify_Application_Entry_Points)

同じWSTGは、application構造と主要workflowを把握し、発見・testしたcode pathを記録することを推奨する。また全decision pathの列挙は分岐とともに急増するため、path、data flow、race等から目的に合う方法を選ぶ必要がある。[WSTG v4.2: Map Execution Paths Through Application](https://owasp.org/www-project-web-security-testing-guide/v42/4-Web_Application_Security_Testing/01-Information_Gathering/07-Map_Execution_Paths_Through_Application)

ここから支持されるのは、Surface Mapを先に作り、Explorationを根拠のあるsurfaceへfocusすることである。全pathを初回から完全列挙できる、またはentryの存在だけで脆弱性が分かる、という主張は支持されない。

### Represent sources, transformations, guards, stores, sinks, and trust changes

OWASP Secure Code Review Cheat Sheetは、source、processing/transformation、sinkを追跡し、trust boundaryごとのvalidation、encoding、security controlを確認するdata-flow reviewを示す。[OWASP Secure Code Review Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Secure_Code_Review_Cheat_Sheet.html#data-flow-analysis)

OWASP Attack Surface Analysisは、attack surfaceにentry/exit pathだけでなく、それらを守るauthentication、authorization、validation、encoding等のcode、価値あるdataとdata store、role/privilegeを含める。さらにcontrolとdataのflow、保存場所、接続先を追い、最初は粗く不完全なmapを分析に伴って埋めるとしている。[OWASP Attack Surface Analysis Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Attack_Surface_Analysis_Cheat_Sheet.html)

したがって`entry`、`source`、`guard`、`state`、`sink`を別nodeとして持つことは妥当である。ただしnodeが同じfileに存在するだけでは、guardがsinkを支配していることや、sourceがsinkへ到達することの証明にはならない。security reviewに必要なのはnode inventoryの次にある、根拠付きrelationである。

### Preserve cross-request and persistent-state routes

OWASPはStored XSSを、入力が保存され、後続requestで別利用者へrender・実行される少なくとも二requestのrouteとして説明する。[WSTG v4.2: Testing for Stored Cross Site Scripting](https://owasp.org/www-project-web-security-testing-guide/v42/4-Web_Application_Security_Testing/07-Input_Validation_Testing/02-Testing_for_Stored_Cross_Site_Scripting)

これは`request source -> storage write -> later storage read -> output sink`を一request内のtaint flowへ潰さず、stateと時間順序をSurface Mapに残す根拠になる。Stored XSSだけでなく、option更新後のprivileged consumer、password-reset state、upload後のinclude等にも同じroute shapeを適用するのは本設計の推論であり、各mechanismは別途検証が必要である。

### Combine static understanding with runtime verification

NIST SP 800-115は、white-box techniqueをsource codeの直接分析、black-box techniqueを実装されたapplicationと環境の検査として区別する。white-boxはcustom applicationの欠陥発見に効率的だが、component間interface、build/configuration、runtime interactionを捉えられない場合があり、両者の併用を説明する。[NIST SP 800-115, Appendix C](https://doi.org/10.6028/NIST.SP.800-115)

OffSec WEB-300も、source codeとapplication logicを解析する反復可能なwhite-box approachに、manual review、static analysis、dynamic analysis、exploit developmentを組み合わせる。[WEB-300 course](https://www.offsec.com/courses/web-300/) [WEB-300 syllabus](https://manage.offsec.com/app/uploads/2026/03/WEB-300_Syllabus.pdf)

これらが支持するのは、static mapをruntime verificationで補うことである。OSWEという資格名はschemaや自動化方式の根拠ではない。またOSWE examには自動source-code analyzer等の利用制限があるため、試験規則をこのharnessのtool選定根拠にしてはならない。[OSWE Exam Guide](https://help.offsec.com/hc/en-us/articles/360046869951-WEB-300-Advanced-Web-Attacks-and-Exploitation-OSWE-Exam-Guide)

### Separate a map from a verified finding

WSTGはsecurity testをcontrolの有効性をmethodically validate/verifyする行為とし、reportは別のtesterが結果を再現できる内容を持つべきだとしている。[WSTG v4.2 Introduction](https://owasp.org/www-project-web-security-testing-guide/v42/2-Introduction/) OffSecのexam guideも、attackの全step、command、output、custom exploitを含み、技術者が再現できるdocumentationを要求する。[OSWE Exam Guide: Documentation Requirements](https://help.offsec.com/hc/en-us/articles/360046869951-WEB-300-Advanced-Web-Attacks-and-Exploitation-OSWE-Exam-Guide#documentation-requirements)

したがってSurface Mapはcandidate routeを構造化するartifactであり、Findingではない。map relation、static rule、model verdictだけで成立を宣言せず、別のVerificationで固定snapshot、実行結果、negative/controlを持つことは妥当である。ただし独立VerifierやCausal Controlという具体的構造はこのharnessの強化策であり、上記資料がそのまま規定するものではない。

## Why the ten implementation decisions are reasonable

| Decision | Assessment and rationale | External support boundary |
| --- | --- | --- |
| 1. Initial `observed` comes only from the parser | 初期static sliceでは妥当。ただし`observed`は「source上に構文・literal・callが存在する」であって、runtime reachabilityやsecurity effectではない。将来のpolicy適合Runtime Observationも別provenanceの`observed`になり得るため、system全体をparser-onlyにはしない。model outputは`inferred`のままにする。 | CodeQLもASTのsyntax nodeとruntime valueを表すdata-flow nodeを区別し、runtime call targetの決定が難しいと説明する。[About data flow analysis](https://codeql.github.com/docs/writing-codeql-queries/about-data-flow-analysis/) `observed / inferred / unknown`の分類自体は本設計。 |
| 2. An unresolved callback stays `unknown` | 妥当。解決できないedgeを存在または不存在へ丸めると、偽のreachabilityまたはcoverage closureになる。候補、理由、必要証拠を残すことで次のstatic modelまたはRuntime Observationへ接続できる。 | CodeQLは期待したflowが出ない場合にsource/sink定義、missing flow step、partial flowを調べる手順を持つ。[Debugging data-flow queries using partial flow](https://codeql.github.com/docs/writing-codeql-queries/debugging-data-flow-queries-using-partial-flow/) `unknown` schemaは本設計。 |
| 3. Unsupported non-PHP assets become gaps | 妥当。JavaScript、template、configuration、bundled dependencyもentry、transformation、sinkになり得る。解析器がないことと安全であることは同義ではない。 | OWASP Attack Surface Analysisはfiles、database、messages、API等を含め、不完全な初期mapの穴を後から埋める。具体的classificationは本設計。 |
| 4. Set-like arrays use stable ordering | 妥当。`nodes`、`relations`、`gaps`等が意味上setなら、arrival orderでartifactやpromptが変わるべきではない。順序自体が意味を持つroute stepやevent streamはsortしてはならない。 | RFC 8785はobject propertyを決定的にするがarray orderは保持する。したがってset-like arrayのsortはapplication schema側の責任であり、本設計上の判断。[RFC 8785](https://www.rfc-editor.org/rfc/rfc8785.html) |
| 5. The complete map is canonical JSON before hashing | 妥当。同じlogical valueから同じdigestを得てCASで再読・照合するために必要。 | RFC 8785はhash/signatureに不変なJSON表現が必要という原則を与える。ただし現在のcustom encoderがRFC 8785へ完全準拠することまでは、この資料から主張しない。 |
| 6. A revision does not delete prior claims | 条件付きで妥当。過去に何を根拠として探索したかを再現できる。一方、誤ったclaimを永遠にactive扱いしてはならず、将来は`superseded`、`contradicted`、`retracted`等の明示relationが必要。 | OWASPは初期mapを反復して補うがappend-only data modelまでは規定しない。これはauditabilityのための本設計。 |
| 7. Mismatched input references reject the build | 妥当。Target、manifest、Program Index、profileが異なるままmapを発行すると、source anchorと解析条件のprovenanceが偽になる。partial mapを成功扱いせずfail closedにする。 | 再現可能なreportというOWASP/OffSec要件と整合するが、digest-binding protocol自体は本設計。 |
| 8. No model synthesis in the initial slice | 妥当。まずdeterministic backboneを固定すると、後でmodelが加えた価値、誤り、varianceを比較できる。modelを永久に排除する判断ではない。 | OWASP/NISTはmanual、static、dynamicの補完関係を支持するが、LLM導入順は規定しない。これは評価可能性のための実装順。 |
| 9. `Context Response` integration is deferred | 妥当なscope control。現在のsource-only behaviorを小さく検証してから、要求・応答・ceilingを別sliceで追加する。security上必須の永久制約ではない。 | 外部methodologyではなくvertical-slice/TDD上の判断。 |
| 10. Permutation-resistance is a behavior test | 妥当。stable orderingはcode styleではなく、同じclaim setが同じordered viewになるというpublic invariantである。入力artifactの配列順が変わればprovenance digestは変わり得る一方、claim identityとMap projectionは安定させる。 | RFC 8785のrepeatable hashing原則と整合する。具体的test oracleは本設計。 |

## Stable identity precedent and limit

OASIS SARIF 2.1.0は、論理的に同じanalysis resultをrun間で関連付けるstable fingerprintを定義し、repository rootやabsolute line number等、logical identityを変えない差へ不用意に依存しないよう求める。[SARIF 2.1.0 §3.27.2, §3.27.16 and Appendix B](https://docs.oasis-open.org/sarif/sarif/v2.1.0/os/sarif-v2.1.0-os.html)

これはhost path、表示用line、生成順をnode IDから外す判断のよいprecedentである。ただしSurface Map IDは固定Target Snapshot内のsource anchorを識別するもので、複数version間のFinding fingerprintではない。Target digest、file digest、byte rangeを含む現在のidentityをSARIF準拠と呼んではならない。

## Static-analysis tool precedent and limit

CodeQL path queryはsource、sink、それらを結ぶdata-flow stepを明示してpathを可視化し、多くのsecurity queryはこの形を使う。[CodeQL: Creating path queries](https://codeql.github.com/docs/writing-codeql-queries/creating-path-queries/) Semgrepのtaint ruleもsource、sink、propagator、sanitizerを明示し、Community Editionのcross-file analysisには制約がある。[Semgrep static-analysis glossary](https://semgrep.dev/docs/writing-rules/glossary)

この共通modelは、将来Surface Mapから検証済みpatternをSemgrep/CodeQL ruleへ変換する考えを支持する。しかし次を意味しない。

- tool alertだけでFindingになる
- framework callback、WordPress hook、persistent state、cross-request routeを既定modelが完全に解ける
- CodeQLを現在のPHP analyzerとして直接採用できる
- Semgrep Community Editionのper-file結果でcross-file coverageを宣言できる

ruleは既知patternの再探索とvariant discoveryに有効だが、Surface Map、model exploration、独立Verificationを置き換えない。

## Real-target characterization

2026-09-02にWordPress.org公式配布物の[Brizy 2.8.11](https://downloads.wordpress.org/plugin/brizy.2.8.11.zip)と[2.8.12](https://downloads.wordpress.org/plugin/brizy.2.8.12.zip)をGit外へ取得し、同じ`php-static-8.3-v1` profileでtarget PHP、autoload、WordPressを実行せず解析した。ZIPのSHA-256は2.8.11が`e358ec349bc9bdd48c67cc6d47f388e9c872a084bdef7e9d27e9602ef0407010`、2.8.12が`97cd7fad5254900671459aba43bd9b3dd99f97d9b9d4403e54b49e8c2eb6a014`である。

両versionとも8,183 files中352 PHP filesをparseし、2,458 symbols、708 WordPress facts、0 parse diagnosticsを得た。修正後のSurface Mapは3,166 nodesと405 registration relationsを持ち、relationの内訳は9件の`inferred: deterministic`と396件の`unknown`である。非PHPを中心に7,831 filesが初期sliceのcoverage gapとして明示された。

最初のrunでは、callback式がliteralでないregistrationがnodeだけを作り、relationを黙って落としていた。実Targetで発見したこの欠陥を、`callback-not-literal`と必要証拠を持つ`unknown` relationへ修正し、合成fixtureの回帰testを追加した。これは実プラグインと合成fixtureを併用する価値の具体例である。

Map生成後に2.8.11と2.8.12の公開patchを照合すると、`editor/forms/api.php`のFileUpload処理と`admin/views/form-data.php`の出力encodingが変更されていた。現行Mapは後者の8個の`echo` sinkと前者の関連methodをobserved nodeとして持つが、request input、type-specific branch、persistent field value、後続admin renderingをrouteとして接続しない。したがって既知Stored XSSを発見済みとは言えない。

この結果は全relationを決定論的解析で作る必要性を示さない。逆に、固定したsource factを骨格にして、AI Mapperがcross-file relation、persistent state、dynamic callback候補と追加source requestを根拠付きで補完する必要性を示す。AI出力は`inferred`または`unknown`であり、`observed` factの訂正として扱わない。

## Assessment of the current static slice

現在の実装は、全manifest entryのinventory、PHP Program Index由来node、source anchor、literal callback relation、coverage gap、canonical CAS、revisionを一つのdeterministic artifactにする。この範囲は上記methodologyと整合し、次の探索機能を積む土台として妥当である。

一方で、現時点には次の限界がある。

1. relationはほぼ`dispatches-to`だけで、sourceからguard、state、sinkへ至るdata/control-flow edgeはまだない。
2. callback文字列とsymbol名が一件だけ一致することは、namespace、class method、conditional definition、WordPress callback form、runtime registrationを考慮した解決と同義ではない。現行実装は一意な名前対応を`inferred: deterministic`、未解決または曖昧な対応を`unknown`に留める。
3. `guard` nodeの存在は、そのguardが特定operationを保護する証拠ではない。
4. predecessor claimを保持できるが、訂正・反証されたclaimをactive setから外すsupersession表現はまだない。
5. 非PHP assetは正しくgapになるが、そのrouteを探索できるわけではない。

したがって現段階の正確な呼び方は「evidence-graded static Surface Mapの最初のslice」である。設計方向は正しいが、RCE、SQLi、Stored XSSを発見する能力は、今後のflow relation、WordPress semantics、state chain、gap-driven context、Exploration、Verificationで初めて成立する。
