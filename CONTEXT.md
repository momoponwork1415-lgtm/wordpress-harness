# Research

特定versionのWordPressプラグインを対象に、source semanticsからhigh-impactなsecurity-property破壊を探索し、独立したsource-only Validation、記録、学習の反復によって人間が検証すべき未知candidateを作る調査context。

## Language

**Target Snapshot**:
WordPress.org配布または正規入手したpremium WordPress pluginの名前空間付きidentity、canonicalなPlugin Basename、正規化source tree identity、照合済みversion、取得原本と由来を結び付けた不変の調査対象。themeとWordPress CoreはこのcontextのTargetに含まない。
_Avoid_: Target、Plugin copy、Theme Snapshot、Core Snapshot

**Campaign**:
一つのTarget Snapshotに対して、目的、許可範囲、予算、停止条件を固定した一連のsource-only研究活動。
_Avoid_: Scan、Run

**Budget Envelope**:
Campaignと各Attemptのquery、source scan / response bytes、turn、token、structured output、実行時間、Attempt数、Work Wave数、並列数のhard ceilingと、Validation専用予約を開始前に固定した制約。消費目標ではなく、ceiling到達をClosureまたはfalse positiveへ読み替えず、provider usage、token、推定金額をhigh-impact recall低下の自動最適化目標にしない。
_Avoid_: Cost estimate、Token quota、Open-ended budget

**Model Capacity Policy**:
複数CampaignのAttemptについて、provider別と全体のactive上限、role優先度、lease、backoffをversion固定した実行制約。初期baselineはOpus単一modelとし、利用可能なquotaを有限workへ使う一方、Validationやterminal処理を新規Finderで飢餓させない。Budget Envelope、model多数決または未観測token残量の推測ではない。
_Avoid_: Campaign budget、Token burn target、Model roster

**Follow-up Campaign**:
未完了CampaignのTarget identityと未解決gapを参照しつつ、新しい予算枠と構成版を独立に固定した新しいCampaign。元Campaignの予算延長または上書きではない。
_Avoid_: Resume、Budget extension、Retry run

**Model Profile**:
一つのworker roleに対して、model identity、effort、tool policy、context policy、予算をversion固定した実行条件。
_Avoid_: Model、Provider config

**Attempt Plan**:
一つのrole-specific assignmentを一つのModel Profileで実行するために、Target Snapshot、TargetFileManifest、role、assignment、Prompt Set、selected Knowledge、Source Tool Policy、出力schema、予算をdigestへ結び付けた不変の計画。FinderではWork WaveとWork Leaseをassignmentへ含め、判断roleでは評価対象のimmutable artifact refを含める。workerへ何を見せ、どの条件で実行するかの正本であり、別のFinder Context artifactを作らない。
_Avoid_: CLI command、Prompt、Mutable job

**Source Tool Policy**:
一つのTarget Snapshotに対してworkerへ公開できるsource queryの種類と、一回の走査・応答上限をversionとdigestへ固定した制約。Attempt全体のquery上限はAttempt Planが固定する。
_Avoid_: Provider tool setting、Shell permission、Prompt instruction

**Attempt Receipt**:
一つのAttemptについて、実行計画、全Segment、終了状態、usage、schema検査済みoutput、private transcript参照を結び付けた不変の記録。
_Avoid_: Process log、Model answer、Session file

**Transport Eligibility Receipt**:
一つのprovider transportについて、公式配布・認証根拠、固定version、安全性とtool制限のcapability probe、許可roleを結び付けた採用判定。
_Avoid_: Installed CLI、Login success、Provider assumption

**Provider Credential Store**:
公式provider transportの認証状態をproviderごとに隔離し、model、Target、tool、prompt、Ledger、CASへsecret値を公開せずにlaunchへ提供するtrusted control-plane storage。
_Avoid_: Agent home、Shared token file、Environment credential

**Prompt Set**:
Role Prompt、Campaign Policy、Work Assignment、selected Knowledgeを一つのworker入力へ決定的にrenderするversioned定義。
_Avoid_: Prompt file、Transcript

**Canary Revision**:
prompt、Model Profile、priority、Knowledge、誤検出基準の変更を固定し、少数の次期実戦Campaignだけで現行版と比較する候補版。進行中Campaignの構成を変更しない。
_Avoid_: Live patch、Experiment、Unversioned tweak

**Knowledge Capsule**:
一つのworker assignmentに必要なWordPress core、PHP/language、framework/plugin family、vulnerability mechanismの知識だけを選び、versionと由来を固定した入力。特定Targetの答えまたは探索範囲を固定するものではない。
_Avoid_: Cheatsheet dump、Model memory、Target oracle

**Oracle Leakage Gate**:
公開Finding由来の知識からtarget identity、affected version、固有symbol、payload、patch情報を除き、由来Case以外での有効性を確かめる昇格条件。
_Avoid_: Redaction only、Prompt secrecy、Benchmark tuning

**False-positive Rejection Policy**:
実在するsource route、attacker premise、既存防御、因果関係、実害を反証するための、版付きで検証可能な技術基準。Wordfenceの公式な共通誤検出例を主な入力とするが、programmeのinstall数、researcher tier、報奨条件は含めない。
_Avoid_: Programme scope、Blocklist、Model confidence

**Source Evidence Query**:
一つのFinderまたはCritic Attemptが同じTarget Snapshot内のdefinition、usage、caller、callee、wrapper、guard、stateまたはsource rangeを追うために行う、TargetFileManifestとSource Tool Policyへ拘束された一時的な読み取り。Surface Mapを変更しない。
_Avoid_: Context Request、Mapping Evidence Request、Provider filesystem tool

**Tool Receipt**:
一つのSource Evidence Queryについて、Attempt、role-specific assignment、Target Snapshot、TargetFileManifest、Source Tool Policy、request、許可判断、走査量、partial / terminal result、responseとcontinuationのdigestを結び付けた不変の記録。
_Avoid_: Model transcript、Source Map relation、Finding evidence

**Context Request**:
workerがHypothesis、Route Fragment、mapping gapまたはresearch thesisを進めるために必要と判断した追加source slice、dependency sourceまたはartifactを、根拠anchor、理由、用途付きで要求する記録。
_Avoid_: Unrecorded file read、Network fetch、Wishlist without reason

**Context Response**:
一つのContext Requestに対して返した固定source sliceまたはartifactと、そのdigest、由来、適用範囲を結び付けた不変の応答。
_Avoid_: Prompt append、Untracked context、File path only

**Mapping Evidence Request**:
探索中に見つかった未解決relationについて、攻撃面マップの次revisionでsourceから決める問い、根拠anchor、期待する情報利得をSource Mappingへ返す要求。runtime actionを要求しない。
_Avoid_: Context Request、Runtime command、Finder tool call

**Development Cohort**:
prompt、rule、Model Profile、harnessの安全性と回帰を軽く確認するための、小さく明示的に有限なoracle既知Case集合。
_Avoid_: Main workload、Proof of capability、Large benchmark suite

**Boundary Pair**:
同じCausal Identityについて、vulnerable Snapshotのpositive、actual patched Snapshotのnegative、通常機能が保たれるbenign controlを人間再現したbenchmark Case。
_Avoid_: Version pair、Synthetic negative

**Calibration Context**:
Boundary PairのCase role、期待条件、評価対象をResearch workerから隔離して固定したprivate評価条件。
_Avoid_: Finder hint、Campaign Policy、Known-vulnerability prompt

**Calibration Review**:
同じCausal Identityのpositive `ready-for-runtime`、patched Disproved、正常機能維持、oracle-free negativeの非昇格が揃ったかを判定するprivate評価。脆弱性の探索、ValidationまたはHuman Verificationではない。
_Avoid_: Validation、Human Verification、Finder review、Model judge

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
既知脆弱性のoracleなしに、Permitted Attackerからhigh-impactなsecurity-property破壊へ至る未知routeをsource semanticsから発見し、独立Validation、Runtime Verification Packet、AI Reproduction、人間のfresh再実行まで到達できる能力。RCEまたは同等のsite-wide compromiseは最上位impactだが唯一の成功条件ではなく、ATO、PrivEsc、unauthenticated SQLi、強いStored XSS、arbitrary file operation、object injection等を含む。
_Avoid_: RCE detector、Sink coverage、CWE recall、Static rule coverage

**Researcher Reference**:
公開Findingのportfolioから、目指す成果水準、mechanism coverage、benchmark gapを定める参照。研究者の非公開method、worker persona、prospective Campaignのoracleは含まない。
_Avoid_: Design reference、Expert prompt、Vulnerability oracle

**Researcher Reference Corpus**:
Researcher Referenceの公開Findingをattacker premise、surface、root cause、route shape、security propertyへ正規化したversioned集合。evaluation coverageに使い、prospective workerへは渡さない。
_Avoid_: Development Cohort、Knowledge Capsule、Discovery oracle

**Surface Map**:
Target Snapshotのentry point、trust transition、guard、state、sink、関連asset、および関係を根拠状態付きで列挙した不変revisionの攻撃面地図。脆弱性の主張は含まず、Map nodeの存在または完成度はFinderが読めるsource、candidate受理、Campaign closureの境界にならない。
_Avoid_: Threat model、Scan result、Exploration scope

**Evidence State**:
Surface Mapのnodeまたはrelationを固定sourceから直接確認した`observed`、source根拠から導いた`inferred`、接続を確定できない未解決（`unknown`）のいずれかとして表す区分。不明を観測事実へ昇格させない。
_Avoid_: Confidence score、Model certainty、Boolean known

**Map Delta Proposal**:
一つのSurface Map revisionとMapping Profileに対してAI Mapperが返す、追加node、relation、gap、Conflict、Context Requestの型付き候補。完成したSurface Mapでも訂正命令でもなく、決定論的検査を通るまで次revisionへ入らない。
_Avoid_: Corrected Map、Model patch、Mapper verdict

**Map Delta Receipt**:
一つのMap Delta Proposalについて、固定入力、Model Profile、各claimの受理または拒否と理由、Context使用量、生成したSurface Map revisionを結び付けた不変の検査記録。
_Avoid_: Mapper output、Confidence report、Validation log

**PHP Program Index**:
固定Target Snapshotを実行せずに構文解析して得た、file digest、source range、symbol、call relation、WordPress registration、guard、source、storage、sink、parse diagnosticを持つcanonicalでversionedなJSON artifact。Finderのnavigationまたはevidenceを補助できるが、探索空間を定義しない。
_Avoid_: Parser object、Raw AST dump、Surface Map、Exploration scope

**Analysis Unit**:
optionalなmap-assisted coverageの一つのWork Leaseに対し、Target Snapshot、Surface Map、PHP Program Index等から決定的に選び、最初に渡すsource range、関連artifact、選択理由、上限をTarget digestへ結び付けた版付きの有限context。初期seedであって探索scopeではなく、Default raw-sourceまたはmissing-link Work Waveの必須artifactではない。
_Avoid_: Prompt chunk、Complete call graph、Exploration scope

**Research Thesis**:
Target Snapshot、oracle-freeなmetadata、TargetFileManifestの観測、または明示的に許可された同一Snapshotの先行artifactからRoot Plannerが作る、調べるべきsecurity assumptionまたは機能間interactionを表した未検証の研究方向。Hypothesis、file scope、脆弱性class、Finderが従う固定手順ではない。
_Avoid_: Hypothesis、Focus Area、Finder procedure、File scope

**Focus Area**:
optionalなmap-assisted coverageのためにTargetから切り出した観測上の研究領域。FinderがTarget全体へpivotする権利を制限せず、Map外candidateを拒否するscopeではない。
_Avoid_: Agent task、Vulnerability class、Exploration boundary

**Work Lease**:
一つのResearch Thesis、Frontier GapまたはFocus Areaを一つのworkerへ期限・予算付きで割り当てた記録。探索手順またはfile scopeを固定しない。
_Avoid_: Prompt、Agent procedure

**Work Wave**:
開始前にWork Leaseと予算を固定した有限の並列作業集合。全Attemptがterminalになった後、結果を安定順で次の判断へ反映する。
_Avoid_: Open-ended swarm、Arrival-order batch

**Semantic Research Wave**:
Target Snapshot全体へraw-source-firstで到達できる最大4個の独立free-reasoning Finder Attemptを持ち、high-impact Hypothesis、Route Fragment、source-boundなunknownを集める通常運転のWork Wave。unknownは独立した自由文artifactにせず、必要fact、source evidence、falsifier、次の決定的actionを持つFrontier Gapへ正規化する。長いchainまたは特定CWEを必須成果にせず、Surface Mapを探索境界にしない。
_Avoid_: Breadth scan、Depth Campaign、Sink sweep

**Root Evaluation**:
Work Waveの全Attemptがterminalになった時、またはDepthのAdversarial Critiqueがdurableになった時に、boundedなtyped artifactをstable orderで評価してIteration Decisionを作るExploration所有のmodel判断。fresh contextで実行し、Harnessはartifact completeness、source provenance、参照、policyだけを決定論的に検査する。raw transcript、confidence、model identity、到着順、private oracleを入力または採否根拠にしない。
_Avoid_: Deterministic severity filter、Majority vote、Finder self-review、Verification

**Depth Admission**:
Semantic Research Waveまたは他の探索artifactから、少なくとも一つのsource-boundなstrong read/write/file/auth/state capabilityまたはsecurity-semantic mechanismと、Permitted Attackerからhigh-impactへ伸びるplausibleなcompositionまたは具体的Frontier Gapを根拠に、同じTargetへmulti-waveの追加推論予算を投資すると確定した研究判断。persistent state、cross-request/cross-actor flow、parser/transform mismatch、producer/consumer mismatch、security assumption mismatch等は独立した十分条件候補であり、全項目の一致や既知の最終RCE/ATO/PrivEscを要求しない。
_Avoid_: Severity threshold、RCE sink match、Model confidence

**Approach Family**:
一つのCampaignとTarget Snapshot内で、同じcore security assumptionとstateまたはcapability transition mechanismを追うresearch lineage。複数のRoute Fragment、Hypothesis、Frontier Gapを参照でき、一つのFragmentも複数Familyから参照できるが、file、surface、表現、想定impactの違いだけでは分けず、独立に反証できるmechanismだけを別Familyにする。
_Avoid_: Prompt variant、Vulnerability class、File scope、Worker role

**Approach Family Admission**:
Wave Barrier後のRoot Evaluationが、一つのcore security assumptionとmechanism、根拠subject、falsifier、次actionをまとめ、同じIteration DecisionのValidation / Depth actionから参照可能にした不変のFamily開始宣言。local keyは同じDecision内のgroupingにだけ使い、Campaign-localなFamily identityまたは状態をmodelに決めさせない。
_Avoid_: Free-form tag、Global family ID、Validation verdict、Mutable registry entry

**Approach Family Registry**:
一つのCampaignに属するApproach Familyのidentity、evidence、round、`active / blocked / exhausted`状態、blocked理由、Reopen Conditionを表す再構築可能な現在view。Familyの意味と状態判断はExplorationに属し、永続事実とreplayはResearch Recordに属する。
_Avoid_: Mutable source of truth、Global memory、Exploration Queue

**Reopen Condition**:
`blocked`または`exhausted`のApproach Familyを再び`active`にできる、新しい必要fact、evidence種別、比較対象となる先行evidence、次の決定的actionを固定した条件。時間経過、retry回数、言い換えだけでは成立しない。
_Avoid_: Retry trigger、Free-form reminder、Timeout

**Depth Campaign**:
Depth AdmissionされたTarget frontierに対し、Approach Family Registry、Root Synthesis、Adversarial Critic、fresh missing-link Work Waveを反復し、高impact routeのclosureまたはevidence-backed stopまで追うCampaign運行。
_Avoid_: Default Campaign、Long single session、RCE-only scan

**Depth Work Queue**:
Iteration Decisionの`admit-depth`と`schedule-work`を、Target、TargetFileManifest、元Wave、全subject ref、falsifier、次actionへbindしたversioned待機集合。最大4件のstable batchへ分けるが、枠を超えたitemを削除せず後続batchへ保持する。
_Avoid_: Priority heap、Dropped overflow、Unrecorded next prompt

**Iteration Decision**:
一つのWork Waveのterminal evidence、またはそのDepth SynthesisとCritiqueから、Validation candidate、Depth Admission、有限の次作業、retain、Closure Record、能力阻害を非排他的なtyped actionとして確定し、Campaignを`continue`、`coverage-closed`、`incomplete`のいずれに置くかを示す研究判断。同じHypothesisまたはfrontierをValidationとDepthの両方へ送れる。全semantic inputに一つ以上の明示的処遇を要求し、黙示的なcandidate破棄を許さない。
_Avoid_: Agent suggestion、Next prompt、Unrecorded scheduler state

**Exploration Lane**:
探索portfolioの偏りを観測するためWork Leaseへ付けられる目的区分。worker role、model identity、Validation Queue、固定手順ではない。
_Avoid_: Agent type、Model specialization、Queue

**Frontier Lane**:
複数のroute primitiveをつなぎ、RCE、ATO、PrivEscまたは同等のhigh-impact security-property破壊へ至る可能性を探索するExploration Lane。
_Avoid_: RCE-only worker、Critical verdict

**Primitive Lane**:
SQL injection、Stored XSS、authorization、identity、file、path、deserialization等、単独でもchainの一部でも価値を持つsecurity-property破壊を探索するExploration Lane。
_Avoid_: Low-severity lane、Static rule lane

**Coverage Lane**:
未観測surface、未追跡relation、parse diagnostic、動的dispatch等のgapを調べ、coverage evidenceを作るExploration Lane。coverage不足だけでraw-source candidateを無効化しない。
_Avoid_: Filler work、Zero-finding lane

**Exploration Strategy**:
一つのWork Leaseへ付けるentry-forward、sink-backward、state-chain、security invariant、Wildcard等の開始lensまたは観測label。Finderが従う逐次手順、worker role、model identity、vulnerability classではない。
_Avoid_: Finder type、Vulnerability agent、Fixed procedure

**Strategy Portfolio**:
Work Wave内で異なる開始lensとresearch thesisを組み合わせ、既知パターンへの収束と探索重複を抑える割当集合。Model Profileはpolicyで固定し、初期Opus-only baselineでも各Finderのsession、conversation、scratch、thesisを分離する。各Finderの自由なpivotを制限しない。
_Avoid_: Same-prompt voting、Model ensemble、Vulnerability checklist

**Wildcard Strategy**:
既知のsink、vulnerability class、Researcher Referenceのroute shapeへ開始点を固定せず、source-boundで反証可能な未知routeを探すための開始lens。
_Avoid_: Unbounded brainstorming、Random prompt、Oracle hint

**Chain Synthesis**:
durableなApproach Family Registryにある型付きRoute Fragment、Hypothesis、Frontier Gap、state transitionを照合し、semanticなChain Proposalを作るmodel-owned探索判断。Harnessのdeterministic scriptまたはFinding昇格ではない。
_Avoid_: Worker chat、Transcript merge、Finding composition

**Chain Proposal**:
Root SynthesisがFamily、Fragment、Hypothesis、Frontier Gapをsemanticに接続して提案する未検証artifact。順序付きroute step、actor、request、state identity、値の受渡し、sourceで観測したrelationと提案connectionの区別、attacker premise、security property、unknown、falsifier、次actionを持つが、Evidence Route、Source-bound Hypothesis、Validation Candidate、Findingではない。
_Avoid_: Proven route、Deterministic graph path、Finding

**Adversarial Critique**:
fresh Adversarial Criticが全Chain Proposalについてattacker premise、actor、state identity、request ordering、defense、causal hop、source bindingを独立に攻撃し、`survives / needs-evidence / contradicted`、falsifier、具体的Frontier Gapとして残すtyped artifact。Verification verdict、work scheduling、Family transition、Finding昇格ではない。
_Avoid_: Finder self-review、Disproved、Severity score

**Gap Review**:
Closure Recordとは独立に、未観測surface、未解決relation、未追跡state、探索重複を調べるcoverage review。新しい根拠が既存closureの前提を変えた場合は研究workを再開する。
_Avoid_: Finder self-review、Done check、Finding review

**Hypothesis Seed**:
static rule matchまたは決定的解析が示した、出自付きの未確認探索起点。Source-bound HypothesisでもFindingでもなく、通常の探索と検証を省略しない。
_Avoid_: Scanner finding、Verified route、Automatic verdict

**Attempt**:
一つのrole-specific assignmentを、一つの固定Model Profileとfresh contextで完了させようとする実行単位。Finderは一つのWork Leaseを、判断roleは一つのboundedなartifact集合をassignmentとし、独立性、予算、outcomeの境界となる。
_Avoid_: CLI process、Session、Retry

**Independent Validation Attempt**:
同じValidation Candidateを、Finder、Criticまたは別Validatorのconversation、scratch、verdictを使わず、fresh contextとread-only source toolで共通Validation Rubricへ照らす試行。Target code、build、testまたはruntime attackを実行しない。
_Avoid_: Finder self-review、Runtime Verification、Vote

**Segment**:
一つのAttempt内で起動した一回のprovider CLI process。分類済み一時障害から同じsessionをresumeするたびに新しいSegmentを追加する。
_Avoid_: Attempt、Campaign resume

**Agent Sandbox**:
一つのAttemptのnative agent processと許可toolだけを実行し、Target Snapshotをread-only、scratchをwriteableにした隔離zone。
_Avoid_: 隔離検証環境、Host process

**Exploration Queue**:
novelty、expected information gain、high-impact potential、未解決frontier、探索費用から、次に調べるresearch thesisまたはgapを並べた作業列。
_Avoid_: Validation Queue、Global priority

**Hypothesis**:
特定のattacker premiseからsecurity impactへ至る可能性を、反証可能なrouteと不足証拠で表した未確認の主張。
_Avoid_: Lead、Candidate、Finding

**Evidence Route**:
一つのattacker premiseから一つのsecurity impactまでを、source evidence付きの因果関係で結ぶ最小subgraph。Target全体のcall graphや自由文の攻撃物語ではない。
_Avoid_: Call graph、Transcript、Exploit narrative

**Route Fragment**:
同じTarget Snapshot内で複数HypothesisまたはApproach Familyが参照できる、immutableで連続したobserved Evidence Routeの一部。特定Familyには所属せず、新しい接続関係やterminal impactを証明せず、Targetを越えてobserved stateを継承しない。単独severityが低くてもhigh-impact compositionに必要なsemantic mechanismなら保持できる。
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
Wave BarrierとRoot Evaluationを通過し、exact duplicateをまとめた一つのSource-bound Hypothesisまたはsource-bound Chain Proposal。Validationの開始単位であり、FindingまたはRuntime Verification Packetではない。
_Avoid_: Finder checkpoint、Finding、Scanner alert

**Validation Intent**:
Root Evaluationがadmitしたexact Validation CandidateをCASへ固定し、起動前にCampaign、Run、全origin Approach Familyへbindした追記型の実行意思。重複起動を防ぎ、Familyのpending ValidationをLedgerから再構築する。
_Avoid_: Validator output、Validation Disposition、Mutable queue row

**Validation Threat Context**:
versioned WordPress threat baseline、Permitted Attacker、Target Snapshot metadata、公開surface、主張するbroken security property、明示的なtechnical exclusionをValidation Candidateへbindした入力。programme eligibilityまたは既知Findingを含めない。
_Avoid_: Programme scope、Target oracle、Unversioned threat model

**Validation Rubric**:
`source integrity`、`reachability and premise`、`broken control`、`causal route and security effect`、`counterevidence and proof gap`を各`pass / fail / unknown`とsource evidenceで評価する共通contract。severity、model confidence、支持数をcriterionにしない。
_Avoid_: Score threshold、CWE checklist、Majority vote

**Validation Queue**:
Root Evaluation後のValidation Candidateをstable identityとBudget Envelopeへbindした待機集合。exact duplicateをまとめた後、一つのIndependent Validation Attemptを開始する。予算内で実行されないことは却下または削除を意味しない。
_Avoid_: Finder checkpoint queue、Finding Queue、FIFO

**Validation Disposition**:
一つのIndependent Validation Attemptから決定的に投影する`ready-for-runtime`、`needs-research`、`disproven`または`validation-pending`の理由付きterminalまたは保留判断。決定的なsource contradictionだけを`disproven`とし、不確実性をnegativeへ丸めず、severityとRisk Assessmentを含めない。
_Avoid_: Finding、Human decision、Confidence label

**Validation Frontier Gap**:
`needs-research`のValidation Attemptが示した具体的proof gapを、元のValidation Candidateと全origin Approach Familyへ結び付けた不変artifact。Finder Attempt、Work Lease、Work Waveのprovenanceを持たず、新しいApproach Familyを開始しない。
_Avoid_: New Family、Finder checkpoint、Free-form research request

**Ready-for-runtime**:
決定的なsource反証がなく、attacker premise、Security Effect、runtimeで試せるrouteがあるValidation Disposition。全rubric pass、runtime成立またはHuman Verification成功を意味しない。
_Avoid_: Ready-for-human、Confirmed、Verified Finding

**Risk Assessment**:
一つのValidation recordと、それにbindされたValidation Candidate / Threat Contextからattacker role、prerequisite、exposed surface、security effect、configuration、blast radiusを追加model callなしで決定的に投影したartifact。Validityを変更せず、programme eligibilityまたは外部行動を判断しない。
_Avoid_: Validation verdict、CVSS-only ranking、Programme Disposition

**Runtime Verification Packet**:
一つのReady-for-runtime candidateについてTarget/version、Manifest、attacker premise、source route、調べたcontrol、一つのValidation Attempt、runtime uncertainty、Risk Assessment、reproduction sketchを自己完結にdigest固定したHuman OSへのversioned handoff。Human OSはResearch storageを直接参照せずこのPacketだけからAI Reproductionを開始できる。Findingまたは人間向け再現手順ではない。
_Avoid_: Triage Reproduction Packet、Finding、Transcript

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
同じBoundary Pairのterminal candidateを異なるAttemptやModel Profileの間で照合するため、Target Snapshot、Evidence Routeのsource anchorとHuman Verification結果を固定した構造的identity。modelが生成したCausal Identityの文言または既知答えを探索へ渡すものではない。
_Avoid_: Normalized Causal Identity、Model string match、Finder hint

**Blocked**:
必要なsource、tool、providerまたは前提を取得できず、Validation Candidateを支持も反証もできないlegacy表現。新policyでは原因付き`validation-pending`を使う。
_Avoid_: Failed、Disproved、Rejected

**Disproved**:
独立Validationが、必要なroute、premise、controlまたはsecurity propertyの不成立をsource evidence付きで示したValidation Disposition。
_Avoid_: Blocked、Rejected

**Coverage Closure**:
主要なresearch thesis、high-impact frontier、未解決gap、Validation Queueが理由付きterminalとなり、独立したgap passを繰り返しても新しいsource anchor、state transition、capability、causal relation、Hypothesis、Route Fragment、attacker premiseまたはpriority変化が生じないResearch状態。Human DeferredまたはHuman Verificationの完了をResearch closure条件にしない。支持model数、confidence、同じtool hit、Map coverageの完成、Finder自己申告、一Waveの空振りだけでは成立しない。
_Avoid_: Timeout、Zero findings、Agent done、Map complete

**Incomplete Campaign**:
予算、tool、provider、Root Evaluation不成立、または証拠不足により、active research thesis、strong frontier、未解決gap、Validation Candidateのいずれかを残して停止したResearch状態。Runtime Verification Packetが存在していても残workがあればIncompleteになり得る。脆弱性がないという結論ではない。
_Avoid_: Completed、No vulnerabilities、Failed run

**Closure Record**:
一つのresearch thesisまたはfrontierについて、調べたsource evidence、Hypothesis、Route Fragment、source根拠付きruled-out、Blocked、reopen条件を固定した完了証拠。
_Avoid_: Worker summary、Done flag

**Research Ledger**:
Hypothesis、Validation、source evidence、判断、費用、次の行動を因果関係ごと追跡できる追記型の研究記録。
_Avoid_: Transcript、Log

**Lesson**:
複数のHypothesisまたはCampaignで再利用できる、成功パターン、失敗パターン、探索上の判断規則。
_Avoid_: Prompt tweak、Anecdote

**Lesson Proposal**:
Campaign evidenceから導いた未昇格のLesson。進行中Campaignを変更せず、通常変更は小さなsmokeと実戦canary、自己強化riskの高い変更はDevelopmentとSealed Evaluationを通してから他Campaignへ昇格させる。
_Avoid_: Lesson、Automatic rule

**Rule Proposal**:
Verified FindingのCausal Identityを近い構文variantへ一般化した、未昇格のversioned static-analysis rule。Boundary Pair、benign corpus、人間reviewを通るまで他Campaignの実行結果へ影響させない。
_Avoid_: Finding、Accepted rule、LLM-generated answer

**Not Codifiable Record**:
Findingを現在のstatic-analysis capabilityでは意味のある精度のruleへ落とせないことを、失われるreasoningと必要capability付きで記録した成果物。
_Avoid_: Failed rule、Skipped work

**Accepted Static Rule**:
由来Finding、Causal Identity、engine/version、scope、limitを固定し、positive、patched negative、benign functional control、benign corpus、人間reviewのpromotion gateを通過したrule。matchはHypothesisだけを生成する。
_Avoid_: Finding、Automatic verdict、Rule Proposal
