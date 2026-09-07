# Research

特定versionのWordPressプラグインを対象に、source semanticsからhigh-impactなsecurity-property破壊を探索し、独立したsource-only Validation、Finding、Coverage、記録を所有する調査context。

## Language

**Target Snapshot**:
WordPress.org配布または正規入手したpremium WordPress pluginの名前空間付きidentity、canonicalなPlugin Basename、正規化source tree identity、照合済みversion、取得原本と由来を結び付けた不変の調査対象。themeとWordPress CoreはこのcontextのTargetに含まない。
_Avoid_: Target、Plugin copy、Theme Snapshot、Core Snapshot

**Campaign**:
一つのTarget Snapshotに対して、目的、許可範囲、予算、停止条件を固定した一連のsource-only研究活動。
_Avoid_: Scan、Run

**Budget Envelope**:
Campaignのwall time、provider run数、同時agent数、provider cost等の強制可能なhard ceilingと、Independent Validation用の容量を開始前に固定した制約。providerが返すtokenとturnは信頼できるpreconditionを提供する場合を除きtelemetryとして記録する。ceiling到達をCoverage Closure、no-findingまたはfalse positiveへ読み替えない。
_Avoid_: Cost estimate、Token quota、Open-ended budget

**Model Capacity Policy**:
複数CampaignのNative Agent Runについて、provider別と全体のactive上限、backoffとIndependent Validation用capacityをversion固定した実行制約。Budget Envelope、model多数決または未観測token残量の推測ではない。
_Avoid_: Campaign budget、Token burn target、Model roster

**Follow-up Campaign**:
未完了CampaignのTarget identityと未解決gapを参照しつつ、新しい予算枠と構成版を独立に固定した新しいCampaign。元Campaignの予算延長または上書きではない。
_Avoid_: Resume、Budget extension、Retry run

**Agent Runtime Profile**:
一つのnative Agent Runtimeについて、provider、実行binary version、model identity、effort、session policyとcapability probeをversion固定した実行条件。agent topologyまたは研究方法を固定しない。
_Avoid_: Model、Provider config

**Sealed Native Run**:
一つのnative Agent Runtimeを起動するため、purpose、Target Snapshot、TargetFileManifest、Prompt Set、Agent Runtime Profile、Permission Profile、Budget Envelope、先行sessionまたはValidation Candidate、出力schemaをdigestへ結び付けた不変の実行入力。native subagentの数、role、順序または探索方法を固定しない。
_Avoid_: CLI command、Prompt、Agent plan、Mutable job

**Permission Profile**:
Rootとnative subagentが利用できるsource read、search、隔離scratch writeと、禁止するshell、network、credential、host path、plugin、hook、memory、ambient MCPをversionとdigestへ固定した権限制約。prompt instructionだけに依存せずOS-level Agent Sandboxで強制する。
_Avoid_: Provider default、Prompt instruction、Role manifest

**Native Run Receipt**:
一つのSealed Native Runについて、runtime identity、session、終了状態、usage、toolとsubagent activity、schema検査済みoutput、private transcript参照を結び付けた不変の記録。agent内部のcall順をsystem of recordにしない。
_Avoid_: Process log、Model answer、Session file、Agent replay

**Transport Eligibility Receipt**:
一つのprovider transportについて、公式配布・認証根拠、固定version、安全性とtool制限のcapability probe、許可roleを結び付けた採用判定。
_Avoid_: Installed CLI、Login success、Provider assumption

**Provider Credential Store**:
公式provider transportの認証状態をproviderごとに隔離し、model、Target、tool、prompt、Ledger、CASへsecret値を公開せずにlaunchへ提供するtrusted control-plane storage。
_Avoid_: Agent home、Shared token file、Environment credential

**Prompt Set**:
Research Root Prompt、Independent Validation Prompt、Campaign Policy、selected Knowledgeとterminal output instructionをpurposeごとに決定的にrenderするversioned定義。固定agent roleまたは探索手順を意味しない。
_Avoid_: Prompt file、Transcript

**Canary Revision**:
prompt、Agent Runtime Profile、Permission Profile、Knowledge、誤検出基準の変更を固定し、少数の次期実戦Campaignだけで現行版と比較する候補版。進行中Campaignの構成を変更しない。
_Avoid_: Live patch、Experiment、Unversioned tweak

**Knowledge Capsule**:
Research RootまたはIndependent Validationに必要なWordPress core、PHP/language、framework/plugin family、vulnerability mechanismの知識だけを選び、versionと由来を固定した入力。特定Targetの答えまたは探索範囲を固定するものではない。
_Avoid_: Cheatsheet dump、Model memory、Target oracle

**Oracle Leakage Gate**:
公開Finding由来の知識からtarget identity、affected version、固有symbol、payload、patch情報を除き、由来Case以外での有効性を確かめる昇格条件。
_Avoid_: Redaction only、Prompt secrecy、Benchmark tuning

**False-positive Rejection Policy**:
実在するsource route、attacker premise、既存防御、因果関係、実害を反証するための、版付きで検証可能な技術基準。Wordfenceの公式な共通誤検出例を主な入力とするが、programmeのinstall数、researcher tier、報奨条件は含めない。
_Avoid_: Programme scope、Blocklist、Model confidence

**Source Evidence Query**:
Research Root、native subagentまたはValidatorが同じTarget Snapshot内のdefinition、usage、caller、callee、wrapper、guard、stateまたはsource rangeを追うために行う、TargetFileManifestとPermission Profileへ拘束された一時的な読み取り。Surface Mapを変更しない。
_Avoid_: Context Request、Mapping Evidence Request、Provider filesystem tool

**Tool Receipt**:
一つのSource Evidence Queryについて、Native Run、Target Snapshot、TargetFileManifest、Permission Profile、request、許可判断、走査量とresponse digestを結び付けた不変の記録。
_Avoid_: Model transcript、Source Map relation、Finding evidence

**Context Request**:
workerがHypothesis、Route Fragment、mapping gapまたはresearch thesisを進めるために必要と判断した追加source slice、dependency sourceまたはartifactを、根拠anchor、理由、用途付きで要求する記録。
_Avoid_: Unrecorded file read、Network fetch、Wishlist without reason

**Context Response**:
一つのContext Requestに対して返した固定source sliceまたはartifactと、そのdigest、由来、適用範囲を結び付けた不変の応答。
_Avoid_: Prompt append、Untracked context、File path only

**Mapping Evidence Request**:
探索中に見つかった未解決relationについて、攻撃面マップの次revisionでsourceから決める問い、根拠anchor、期待する情報利得をSource Mappingへ返す要求。runtime actionを要求しない。
_Avoid_: Context Request、Runtime command、Agent source read

**Development Cohort**:
prompt、rule、Agent Runtime Profile、harnessの安全性と回帰を軽く確認するための、小さく明示的に有限なoracle既知Case集合。
_Avoid_: Main workload、Proof of capability、Large benchmark suite

**Boundary Pair**:
同じCausal Identityについて、vulnerable Snapshotのpositive、actual patched Snapshotのnegative、通常機能が保たれるbenign controlを人間再現したbenchmark Case。
_Avoid_: Version pair、Synthetic negative

**Calibration Context**:
Boundary PairのCase role、期待条件、評価対象をResearch workerから隔離して固定したprivate評価条件。
_Avoid_: Research hint、Campaign Policy、Known-vulnerability prompt

**Calibration Review**:
同じCausal Identityのpositive source-validated Finding、patched Disproved、正常機能維持、oracle-free negativeの非昇格が揃ったかを判定するprivate評価。脆弱性の探索、ValidationまたはHuman Verificationではない。
_Avoid_: Validation、Human Verification、Research review、Model judge

**Boundary Pair Evidence**:
Calibration Reviewの全条件が成立したことをterminalなResearch evidenceへ結び付けた不変の評価記録。
_Avoid_: Benchmark score、Finding、Calibration log

**Sealed Evaluation Cohort**:
高リスクな研究policyまたはKnowledgeの昇格時だけ実行し、日常の調整loopからoracleを隔離する小さな未使用Case集合。
_Avoid_: Development Cohort、Demo cases

**Prospective Campaign**:
取得時点の最新安定版pluginを、対象固有の既知脆弱性情報やpatchなしで調べるCampaign。結果不明の実地研究であり、benchmarkまたはsubmissionを意味しない。
_Avoid_: Production scan、Live exploitation、Benchmark run

**Permitted Attacker**:
認証なしの外部者、または管理者の個別判断なしに通常登録で取得できる最弱権限の利用者。WordPressのSubscriberと、対象構成におけるCustomerなど同等以下のroleを含む。
_Avoid_: Low-privilege user、Normal user

**Frontier Discovery Capability**:
既知脆弱性のoracleなしに、Permitted Attackerからhigh-impactなsecurity-property破壊へ至る未知routeをsource semanticsから発見し、Independent ValidationからFindingを生成してfresh runtime verificationへ渡せる能力。RCEまたは同等のsite-wide compromiseは最上位impactだが唯一の成功条件ではなく、ATO、PrivEsc、unauthenticated SQLi、強いStored XSS、arbitrary file operation、object injection等を含む。
_Avoid_: RCE detector、Sink coverage、CWE recall、Static rule coverage

**Researcher Reference**:
公開Findingのportfolioから、目指す成果水準、mechanism coverage、benchmark gapを定める参照。研究者の非公開method、worker persona、prospective Campaignのoracleは含まない。
_Avoid_: Design reference、Expert prompt、Vulnerability oracle

**Researcher Reference Corpus**:
Researcher Referenceの公開Findingをattacker premise、surface、root cause、route shape、security propertyへ正規化したversioned集合。evaluation coverageに使い、prospective workerへは渡さない。
_Avoid_: Development Cohort、Knowledge Capsule、Discovery oracle

**Surface Map**:
Target Snapshotのentry point、trust transition、guard、state、sink、関連asset、および関係を根拠状態付きで列挙した不変revisionの攻撃面地図。脆弱性の主張は含まず、Map nodeの存在または完成度はagentが読めるsource、candidate受理、Campaign closureの境界にならない。
_Avoid_: Threat model、Scan result、Exploration scope

**Evidence State**:
Surface Mapのnodeまたはrelationを固定sourceから直接確認した`observed`、source根拠から導いた`inferred`、接続を確定できない未解決（`unknown`）のいずれかとして表す区分。不明を観測事実へ昇格させない。
_Avoid_: Confidence score、Model certainty、Boolean known

**Map Delta Proposal**:
一つのSurface Map revisionとMapping Profileに対してAI Mapperが返す、追加node、relation、gap、Conflict、Context Requestの型付き候補。完成したSurface Mapでも訂正命令でもなく、決定論的検査を通るまで次revisionへ入らない。
_Avoid_: Corrected Map、Model patch、Mapper verdict

**Map Delta Receipt**:
一つのMap Delta Proposalについて、固定入力、Agent Runtime Profile、各claimの受理または拒否と理由、Context使用量、生成したSurface Map revisionを結び付けた不変の検査記録。
_Avoid_: Mapper output、Confidence report、Validation log

**PHP Program Index**:
固定Target Snapshotを実行せずに構文解析して得た、file digest、source range、symbol、call relation、WordPress registration、guard、source、storage、sink、parse diagnosticを持つcanonicalでversionedなJSON artifact。agentのnavigationまたはevidenceを補助できるが、探索空間を定義しない。
_Avoid_: Parser object、Raw AST dump、Surface Map、Exploration scope

**Analysis Unit**:
optionalなmap-assisted navigationのため、Target Snapshot、Surface Map、PHP Program Index等から決定的に選ぶsource rangeと関連artifact。Agent-led Researchの開始seedにできるが、探索scope、必須入力またはcompletion単位ではない。
_Avoid_: Prompt chunk、Complete call graph、Exploration scope

**Agent-led Research**:
一つのClaude Code RootがTarget Snapshot全体をraw-source-firstで調べ、必要に応じてnative subagent、異なるroute、synthesis、critiqueと再調査を自身で選ぶ継続的な研究活動。Harnessはagent数、role、round、strategy、脆弱性classまたは読むfileを固定しない。
_Avoid_: Finder Wave、Depth Campaign、Fixed pipeline、Sink sweep

**Source-bound Next Action**:
現在のsource evidenceから、追加で確認すべき具体的なfact、確認対象、期待する情報利得またはfalsifierを示した次の調査。AIがResearch継続を選ぶ根拠であり、Harness-owned queueまたはDepth Admissionではない。
_Avoid_: Speculation、Retry instruction、Work Lease

**Research Decision**:
Rootが現在のevidence、candidate、counterevidenceと未解決事項から、`continue`または`stop`を理由付きで提案する判断。`continue`は一つ以上のSource-bound Next Actionを持ち、`stop`は有望なactionable frontierが残らない根拠を持つ。Harnessはbinding、permission、budgetとterminal integrityだけを検査する。
_Avoid_: Deterministic scheduler、Depth Admission、Majority vote

**Research Report**:
一つのRoot sessionが示したValidation Candidate、Research Decision、source evidence、不確実性とusageをCampaign bindingへ結び付けたversioned output。agent内部のthesis、subagent topologyまたはcall順を再構築しない。
_Avoid_: Transcript、Approach Family Registry、Coverage proof

**Hypothesis Seed**:
static rule matchまたは決定的解析が示した、出自付きの未確認探索起点。Source-bound HypothesisでもFindingでもなく、通常の探索と検証を省略しない。
_Avoid_: Scanner finding、Verified route、Automatic verdict

**Independent Validation Attempt**:
同じValidation Candidateを、Research Rootまたは別Validatorのconversation、scratch、verdictを使わず、fresh process、fresh conversation、fresh scratchとread-only Target Snapshotから自由に再導出する試行。Target code、build、testまたはruntime attackを実行しない。
_Avoid_: Research self-review、Runtime Verification、Vote

**Agent Sandbox**:
一つのNative Agent Runとそのnative subagentを実行し、Target Snapshotをread-only、scratchをwriteableにしたgVisor相当以上の隔離zone。Permission ProfileをOS-levelで強制し、利用不能時にhost processまたはplain Dockerへfallbackしない。
_Avoid_: 隔離検証環境、Host process

**Hypothesis**:
特定のattacker premiseからsecurity impactへ至る可能性を、反証可能なrouteと不足証拠で表した未確認の主張。
_Avoid_: Lead、Candidate、Finding

**Evidence Route**:
一つのattacker premiseから一つのsecurity impactまでを、source evidence付きの因果関係で結ぶ最小subgraph。Target全体のcall graphや自由文の攻撃物語ではない。
_Avoid_: Call graph、Transcript、Exploit narrative

**Route Fragment**:
同じTarget Snapshot内で複数Hypothesisが参照できる、immutableで連続したobserved Evidence Routeの一部。新しい接続関係やterminal impactを証明せず、Targetを越えてobserved stateを継承しない。単独severityが低くてもhigh-impact compositionに必要なsemantic mechanismなら保持できる。
_Avoid_: Finding、Exploit primitive library、Global fact

**Frontier Gap**:
現在のEvidence RouteまたはRoute Fragmentからhigh-impactなsecurity-property破壊へ至るために必要な、未確認のessential causal relation。必要fact、source evidence、falsifier、次の決定的research actionを伴う。根拠または決定可能な次actionを持たない自由文のunknownはFrontier Gapにしない。
_Avoid_: Confidence score、Missing-edge count、Speculation

**Source-bound Hypothesis**:
causal routeをTarget Snapshot内の実在するsource range（path、file digest、line range）へ結び、unknown、falsifier、次の決定的なsource investigationまたはHuman Verification uncertaintyを明示したHypothesis。Surface Map nodeの存在を成立条件にしない。
_Avoid_: Suspicion、Idea

**Preflight Disposition**:
Hypothesisのsymbol実在、entry到達性、権限・nonce等の防御、security-relevant effectへのrouteを固定sourceで検査した`passed`、`conclusively-disproved`、`inconclusive`の三値判定。不明は反証ではない。
_Avoid_: Heuristic score、Model confidence、Finding

**Validation Candidate**:
Research RootがIndependent Validationへ渡す、Target Snapshot、attacker premise、broken security property、主張、初期source anchorとcounterevidenceを持つsource-bound candidate。固定rubric、順番付き完全route、vulnerability classまたはRCE escalationを要求しない。
_Avoid_: Finding、Scanner alert、Model confidence

**Validation Intent**:
exact Validation CandidateをCASへ固定し、起動前にCampaign、Target SnapshotとSealed Native Runへbindした追記型の実行意思。重複起動を防ぎ、pending ValidationをResearch Recordから再構築する。
_Avoid_: Validator output、Validation Disposition、Mutable queue row

**Validation Threat Context**:
versioned WordPress threat baseline、Permitted Attacker、Target Snapshot metadata、公開surface、主張するbroken security property、明示的なtechnical exclusionをValidation Candidateへbindした入力。programme eligibilityまたは既知Findingを含めない。
_Avoid_: Programme scope、Target oracle、Unversioned threat model

**Validation Disposition**:
一つのIndependent Validation Attemptが理由とsource evidence付きで返す`source-validated`、`needs-research`、`disproven`または`validation-pending`の判断。決定的なsource contradictionだけを`disproven`とし、不確実性をnegativeへ丸めない。`source-validated`だけがFindingを生成する。
_Avoid_: Finding、Human decision、Confidence label

**Validation Frontier Gap**:
`needs-research`のIndependent Validation Attemptが示した具体的でsource-boundなproof gapを、元のValidation Candidateへ結び付けた不変artifact。RootはこれをSource-bound Next ActionとしてResearchへ戻すかを判断する。
_Avoid_: Work Queue、Free-form research request、Automatic retry

**Finding**:
固定Target Snapshotの一つのCausal Identityについて、freshなIndependent Validationがattacker premise、broken security property、source route、counterevidenceを固定して生成したimmutableな技術的脆弱性claim。Findingの存在はruntime confirmation、Human Verification、Coverage Closure、programme eligibilityまたは外部提出承認を意味しない。
_Avoid_: Validation Candidate、Scanner alert、Human-confirmed Finding

**Risk Assessment**:
一つのValidation recordと、それにbindされたValidation Candidate / Threat Contextからattacker role、prerequisite、exposed surface、security effect、configuration、blast radiusを追加model callなしで決定的に投影したartifact。Validityを変更せず、programme eligibilityまたは外部行動を判断しない。
_Avoid_: Validation verdict、CVSS-only ranking、Programme Disposition

**Legacy Runtime Verification Packet**:
ADR 0124より前のcurrent writerがReady-for-runtime candidateをHuman OSへ渡したread-only handoff。元の意味でreplayするが、Findingへ暗黙変換せず、新Campaignのhandoffには使わない。
_Avoid_: Finding、Verification Record、Migrated Finding

**Skeptic Review**:
成立主張を崩す観点から、attacker premise、到達可能性、既存防御、因果関係、scopeを独立に再確認するreview。
_Avoid_: Model self-review、Approval

**Causal Identity**:
root cause、attacker-controlled primitive、破壊されるsecurity propertyの組で表すHypothesisまたはValidation Candidateの重複単位。
_Avoid_: File match、Vulnerability-class match

**Legacy Automated Finding**:
ADR 0122より前のVerification schemaで、source再導出、Witness、Causal Control、Lab bindingから自動生成されたread-only Finding record。元のLedger上の意味を維持するが、新policyのFinding、Ready-for-runtimeまたはHuman Verificationへ再解釈しない。
_Avoid_: Current Finding、Ready-for-runtime、Migrated Finding

**Calibration Fingerprint**:
同じBoundary Pairのterminal candidateを異なるNative Agent RunやAgent Runtime Profileの間で照合するため、Target Snapshot、Evidence Routeのsource anchorとHuman Verification結果を固定した構造的identity。modelが生成したCausal Identityの文言または既知答えを探索へ渡すものではない。
_Avoid_: Normalized Causal Identity、Model string match、Research hint

**Blocked**:
必要なsource、tool、providerまたは前提を取得できず、Validation Candidateを支持も反証もできないlegacy表現。新policyでは原因付き`validation-pending`を使う。
_Avoid_: Failed、Disproved、Rejected

**Disproved**:
独立Validationが、必要なroute、premise、controlまたはsecurity propertyの不成立をsource evidence付きで示したValidation Disposition。
_Avoid_: Blocked、Rejected

**Coverage Closure**:
Research Rootが有望なSource-bound Next Actionを残さず、全Validationがterminalで、HarnessがCampaign binding、source integrityとterminal outputを検査できたResearch状態。Human Verificationの完了を条件にしない。支持model数、confidence、tool hit、Map coverageまたは一回のno-findingだけでは成立しない。
_Avoid_: Timeout、Zero findings、Safe claim、Map complete

**Incomplete Campaign**:
Budget、tool、provider、permission、source、session、schema、storageまたは証拠不足により、Source-bound Next Actionまたはpending Validationを残して停止したResearch状態。Findingが存在していてもResearch workが残ればIncompleteになり得る。脆弱性がないという結論ではない。
_Avoid_: Completed、No vulnerabilities、Failed run

**Research Ledger**:
Campaign definition、Native Run Receipt、usage、private transcript参照、Validation Candidate、Validation result、Finding、Coverageとfailureを追跡する追記型の研究記録。agent内部のrole、round、family、queueまたはcall順を正本にしない。
_Avoid_: Transcript、Log

**Lesson**:
複数のHypothesisまたはCampaignで再利用できる、成功パターン、失敗パターン、探索上の判断規則。
_Avoid_: Prompt tweak、Anecdote

**Lesson Proposal**:
Campaign evidenceから導いた未昇格のLesson。進行中Campaignを変更せず、通常変更は小さなsmokeと実戦canary、自己強化riskの高い変更はDevelopmentとSealed Evaluationを通してから他Campaignへ昇格させる。
_Avoid_: Lesson、Automatic rule

**Rule Proposal**:
human-confirmed FindingのCausal Identityを近い構文variantへ一般化した、未昇格のversioned static-analysis rule。Boundary Pair、benign corpus、人間reviewを通るまで他Campaignの実行結果へ影響させない。
_Avoid_: Finding、Accepted rule、LLM-generated answer

**Not Codifiable Record**:
Findingを現在のstatic-analysis capabilityでは意味のある精度のruleへ落とせないことを、失われるreasoningと必要capability付きで記録した成果物。
_Avoid_: Failed rule、Skipped work

**Accepted Static Rule**:
由来Finding、Causal Identity、engine/version、scope、limitを固定し、positive、patched negative、benign functional control、benign corpus、人間reviewのpromotion gateを通過したrule。matchはHypothesisだけを生成する。
_Avoid_: Finding、Automatic verdict、Rule Proposal
