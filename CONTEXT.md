# Research

特定versionのWordPressプラグインを対象に、攻撃面の把握、脆弱性仮説の探索、独立検証、学習の反復を行い、未知の重大侵害routeを発見する調査context。

## Language

**Target Snapshot**:
WordPress.org配布または正規入手したpremium WordPress pluginの名前空間付きidentity、canonicalなPlugin Basename、正規化source tree identity、照合済みversion、取得原本と由来を結び付けた不変の調査対象。themeとWordPress CoreはこのcontextのTargetに含まない。
_Avoid_: Target、Plugin copy、Theme Snapshot、Core Snapshot

**Environment Dependency Snapshot**:
主対象pluginの通常動作または特定Configuration Variantに必要な追加pluginのsource、version、設定、由来を固定した環境条件。独立したTargetまたは組合せ探索の起点ではない。
_Avoid_: Secondary Target、Plugin bundle、Dependency Campaign

**Canonical Configuration**:
pluginをsingle-site WordPressへinstall・activateし、公式手順に沿って最小限の通常機能を利用可能にした再現可能な設定。基準localeは`en_US`、timezoneはUTCとし、異なる条件はConfiguration Variantとして扱う。
_Avoid_: Default state、Test setup

**Setup Plan**:
Canonical ConfigurationまたはConfiguration Variantを成立させるための、許可された操作、順序、客観的な成功条件を版とdigestへ固定した計画。自由形式のinstall scriptまたはmodelの成功判断ではない。
_Avoid_: Shell script、Setup prompt、Runbook

**Setup Receipt**:
一つのSetup Planについて、固定入力、各段階の結果、runtime identity、sanitized evidence、最終的なreadyまたはセットアップ阻害を結び付けた不変の記録。
_Avoid_: Install log、Container log

**Functional Smoke**:
対象pluginの代表的な通常利用操作と、その客観的な結果を確認する最小の試行。単なるHTTP health checkまたはmodelの主観判断ではない。
_Avoid_: Page ping、Security Experiment、Model verdict

**Configuration Variant**:
特定Hypothesisの成立に必要なoptional feature、Multisite、環境依存、install directory、またはstateを、Canonical Configurationとの差分と具体的根拠付きで固定した設定。
_Avoid_: Special setup、Hidden premise

**Campaign**:
一つの主対象Target Snapshotと、必要な場合のみ明示した環境依存スナップショットに対して、目的、許可範囲、予算、停止条件を固定した一連の研究活動。
_Avoid_: Scan、Run

**Setup Blocked**:
受入済みTarget Snapshotから隔離環境内でCanonical Configurationを成立させられず、Researchを開始できない未完了Campaign状態。受入拒否、脆弱性不在、誤検出を意味しない。
_Avoid_: Install error、Rejected Target、No findings

**Runtime Profile**:
Labを再現するWordPress、PHP、database、web server、OCI image、gVisor runtimeのidentityをdigest付きで固定した実行条件。Campaign中に`latest`を再解決しない。
_Avoid_: Environment name、Docker tag、Current stack

**Budget Envelope**:
Campaignの実行時間、Attempt数、Work Wave数、並列数の上限と、少なくとも一つの上位Hypothesisを完全検証できる検証予約を開始前に固定した制約。provider usage、token、推定金額は取得できる場合の観測値である。
_Avoid_: Cost estimate、Token quota、Open-ended budget

**Follow-up Campaign**:
未完了CampaignのTarget identityと未解決gapを参照しつつ、新しい予算枠と構成版を独立に固定した新しいCampaign。元Campaignの予算延長または上書きではない。
_Avoid_: Resume、Budget extension、Retry run

**Model Profile**:
一つのworker roleに対して、model identity、effort、tool policy、context policy、予算をversion固定した実行条件。
_Avoid_: Model、Provider config

**Attempt Plan**:
一つのWork Leaseを一つのModel Profileで実行するために、固定入力、role、Prompt Set、許可tool、出力schema、予算をdigestへ結び付けた不変の計画。
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
Focus Areaとworker roleに必要なWordPress core、PHP/language、framework/plugin family、vulnerability mechanismの知識だけを選び、versionと由来を固定した入力。
_Avoid_: Cheatsheet dump、Model memory

**Oracle Leakage Gate**:
公開Finding由来の知識からtarget identity、affected version、固有symbol、payload、patch情報を除き、由来Case以外での有効性を確かめる昇格条件。
_Avoid_: Redaction only、Prompt secrecy、Benchmark tuning

**False-positive Rejection Policy**:
実在するsource route、attacker premise、既存防御、因果関係、実害を反証するための、版付きで検証可能な技術基準。Wordfenceの公式な共通誤検出例を主な入力とするが、programmeのinstall数、researcher tier、報奨条件は含めない。
_Avoid_: Programme scope、Blocklist、Model confidence

**Wordfence Eligibility Snapshot**:
取得時点のWordfence Bug Bounty Programの対象asset、vulnerability class、attacker role、active installation threshold、researcher tier、除外条件をsource URLとcontent digestへ固定した外部programme規則。Target選定とFinding後の提出適格性に使い、技術的真偽を決めない。
_Avoid_: Finding policy、Current web page、Research scope

**Source Evidence Query**:
一つのFinder Attemptが同じTarget Snapshot内のdefinition、usage、caller、callee、wrapper、guard、stateまたはsource rangeを追うために行う、Source Tool Policyへ拘束された一時的な読み取り。Surface Mapを変更しない。
_Avoid_: Context Request、Mapping Evidence Request、Provider filesystem tool

**Tool Receipt**:
一つのSource Evidence Queryについて、Attempt、Work Lease、Target Snapshot、Source Tool Policy、request、許可判断、走査量、truncation、result digestを結び付けた不変の記録。
_Avoid_: Model transcript、Source Map relation、Finding evidence

**Context Request**:
workerがSurface Map、HypothesisまたはFocus Areaを閉じるために必要と判断した追加source slice、dependency sourceまたはartifactを、根拠anchor、理由、用途付きで要求する記録。
_Avoid_: Unrecorded file read、Network fetch、Wishlist without reason

**Context Response**:
一つのContext Requestに対して返した固定source sliceまたはartifactと、そのdigest、由来、適用範囲を結び付けた不変の応答。
_Avoid_: Prompt append、Untracked context、File path only

**Mapping Evidence Request**:
探索中に見つかった未解決relationについて、攻撃面マップの次revisionで決める問い、根拠anchor、期待する情報利得をSource Mappingへ返す要求。source追加または実行時観測のどちらを使うかは指定しない。
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
同じCausal Identityのpositive Finding、patched Disproved、正常機能維持、oracle-free negativeの非昇格が揃ったかを判定するprivate評価。脆弱性の探索またはFindingのVerificationではない。
_Avoid_: Verification、Finder review、Model judge

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
既知脆弱性のoracleなしに、Permitted Attackerから任意code executionまたは同等のsite-wide compromiseへ至る未知routeを発見し、独立した実証とHuman Confirmationまで到達できる能力。
_Avoid_: RCE detector、Benchmark recall、Static rule coverage

**Researcher Reference**:
公開Findingのportfolioから、目指す成果水準、mechanism coverage、benchmark gapを定める参照。研究者の非公開method、worker persona、prospective Campaignのoracleは含まない。
_Avoid_: Design reference、Expert prompt、Vulnerability oracle

**Researcher Reference Corpus**:
Researcher Referenceの公開Findingをattacker premise、surface、root cause、route shape、security propertyへ正規化したversioned集合。evaluation coverageに使い、prospective workerへは渡さない。
_Avoid_: Development Cohort、Knowledge Capsule、Discovery oracle

**Surface Map**:
Target Snapshotのentry point、trust transition、guard、state、sink、関連asset、および関係を根拠状態付きで列挙した不変revisionの攻撃面地図。脆弱性の主張は含まない。
_Avoid_: Threat model、Scan result

**Evidence State**:
Surface Mapのnodeまたはrelationを、固定sourceまたは型付き実行時観測から直接確認した`observed`、根拠から導いた`inferred`、接続を確定できない未解決（`unknown`）のいずれかとして表す区分。不明を観測事実へ昇格させない。
_Avoid_: Confidence score、Model certainty、Boolean known

**Map Delta Proposal**:
一つのSurface Map revisionとMapping Profileに対してAI Mapperが返す、追加node、relation、gap、Conflict、Context Requestの型付き候補。完成したSurface Mapでも訂正命令でもなく、決定論的検査を通るまで次revisionへ入らない。
_Avoid_: Corrected Map、Model patch、Mapper verdict

**Map Delta Receipt**:
一つのMap Delta Proposalについて、固定入力、Model Profile、各claimの受理または拒否と理由、Context使用量、生成したSurface Map revisionを結び付けた不変の検査記録。
_Avoid_: Mapper output、Confidence report、Validation log

**PHP Program Index**:
固定Target Snapshotを実行せずに構文解析して得た、file digest、source range、symbol、call relation、WordPress registration、guard、source、storage、sink、parse diagnosticを持つcanonicalでversionedなJSON artifact。
_Avoid_: Parser object、Raw AST dump、Surface Map

**Analysis Unit**:
一つのFocus AreaとWork Leaseに対し、固定Surface MapとPHP Program Indexから決定的に選び、実際に渡すsource range、関連node、選択理由、上限をTarget digestへ結び付けた版付きの有限context。call graphの完全性、到達可能性、脆弱性を主張しない。
_Avoid_: Prompt chunk、Complete call graph、Focus Area

**Focus Area**:
Surface Mapから切り出した、所有範囲と完了条件が重複しない探索領域。
_Avoid_: Agent task、Vulnerability class

**Work Lease**:
一つのFocus AreaまたはHypothesisを一つのworkerへ期限・予算付きで排他的に割り当てた記録。
_Avoid_: Prompt、Agent assignment

**Work Wave**:
開始前にWork Leaseと予算を固定した有限の並列作業集合。全Attemptがterminalになった後、結果を安定順で次の判断へ反映する。
_Avoid_: Open-ended swarm、Arrival-order batch

**Iteration Decision**:
一つのWork Waveのterminal evidenceから、有限の次作業、能力阻害、評価待ち、またはCampaign停止のいずれかを確定した研究判断。
_Avoid_: Agent suggestion、Next prompt、Unrecorded scheduler state

**Exploration Lane**:
探索portfolioの偏りを防ぐためFocus AreaまたはWork Leaseへ付ける目的区分。worker role、model identity、Verification Queueではない。
_Avoid_: Agent type、Model specialization、Queue

**Frontier Lane**:
複数のroute primitiveをつなぎ、RCEまたは同等のsite-wide compromiseへ至る可能性を探索するExploration Lane。
_Avoid_: RCE-only worker、Critical verdict

**Primitive Lane**:
SQL injection、Stored XSS、authorization、identity、file、path、deserialization等、単独でもchainの一部でも価値を持つsecurity-property破壊を探索するExploration Lane。
_Avoid_: Low-severity lane、Static rule lane

**Coverage Lane**:
未所有surface、未追跡relation、parse diagnostic、動的dispatch等のgapを調べ、Coverage Closureへ必要な証拠を作るExploration Lane。
_Avoid_: Filler work、Zero-finding lane

**Exploration Strategy**:
一つのFocus Areaをentry順方向、sink逆方向、state-chain、権限・security invariant、またはWildcardの観点で調べる版付きの方法。worker role、model identity、vulnerability classではない。
_Avoid_: Finder type、Vulnerability agent、Prompt variant

**Strategy Portfolio**:
Work Wave内で異なる探索戦略とmodel familyを意図的に組み合わせ、既知パターンへの収束と探索重複を抑える割当集合。
_Avoid_: Same-prompt voting、Model ensemble、Vulnerability checklist

**Wildcard Strategy**:
既知のsink、vulnerability class、Researcher Referenceのroute shapeへ開始点を固定せず、source-boundで反証可能な未知routeを探すための探索戦略。
_Avoid_: Unbounded brainstorming、Random prompt、Oracle hint

**Chain Synthesis**:
terminalなWork Waveの型付きRoute Fragment、Hypothesis、state transitionを安定順で照合し、Focus Areaをまたぐ新しいchain候補またはFrontier Gapを作る探索判断。
_Avoid_: Worker chat、Transcript merge、Finding composition

**Runtime Observation**:
静的に確定できないregistration、dispatch、state transition等をfresh Lab cloneで低影響に観測し、Surface Map revisionへ根拠を返す型付き試行。security propertyの破壊を示す成立証拠ではない。
_Avoid_: Experiment、Witness、Discovery shell

**Gap Review**:
Closure Recordとは独立に、未所有surface、未解決relation、未追跡state、探索重複を調べるcoverage review。新しい根拠が既存closureの前提を変えた場合はFocus Areaを再開する。
_Avoid_: Finder self-review、Done check、Finding review

**Hypothesis Seed**:
static rule matchまたは決定的解析が示した、出自付きの未確認探索起点。Source-bound HypothesisでもFindingでもなく、通常の探索と検証を省略しない。
_Avoid_: Scanner finding、Verified route、Automatic verdict

**Attempt**:
一つのWork Leaseを、一つの固定Model Profileとfresh contextで完了させようとする実行単位。独立性、予算、outcomeの境界となる。
_Avoid_: CLI process、Session、Retry

**Independent Reproduction**:
同じFrontier Hypothesisを、過去Attemptのconversation、scratch、payload、writable stateを使わず、freshなVerifierとLabで再導出して成立証拠と因果対照実験を再現する試行。
_Avoid_: Retry、Session resume、Replay of prior payload

**Model Separation Exception**:
Frontier reviewで異なるmodel familyを割り当てられず、同じfamilyを再利用した理由と影響を残す記録。
_Avoid_: Silent fallback、Equivalent independence

**Segment**:
一つのAttempt内で起動した一回のprovider CLI process。分類済み一時障害から同じsessionをresumeするたびに新しいSegmentを追加する。
_Avoid_: Attempt、Campaign resume

**Agent Sandbox**:
一つのAttemptのnative agent processと許可toolだけを実行し、Target Snapshotをread-only、scratchをwriteableにした隔離zone。
_Avoid_: 隔離検証環境、Host process

**Verification Lab**:
固定runtime上でWordPress、plugin、database、browserを実行し、typed Experimentごとに破棄または既知stateへ戻す隔離zone。
_Avoid_: Agent Sandbox、Development environment

**Lab Baseline**:
成立証拠と因果対照実験のfresh sibling Labを生成する、Runtime Profile、Target Snapshot、Setup Plan、seed state、正常機能確認をhash固定した変更不能な起点。
_Avoid_: Running Lab、Docker image only

**External Dependency Grant**:
隔離検証環境が特定の外部serviceへ接続する必要性、最小接続範囲、test account、credential、記録、上限をCampaign開始前に固定したnetwork capability。
_Avoid_: Internet access、Domain allowlist only

**SecretRef**:
Credential Brokerが保持するsecretを値を露出せず参照するopaque identity。Ledgerにはscope、期限、receiptだけを残す。
_Avoid_: Token、Environment variable

**Credential Broker**:
External Dependency Grantに従い、専用test credentialを最終利用境界で注入し、rotation、revocation、redactionを記録するtrusted control-plane component。
_Avoid_: Secret file mount、Shared account

**Exploration Queue**:
coverage gap、novelty、expected information gain、探索費用から、次に調べるFocus Areaまたはgapを並べた作業列。
_Avoid_: Verification Queue、Global priority

**Hypothesis**:
特定のattacker premiseからsecurity impactへ至る可能性を、反証可能なrouteと不足証拠で表した未確認の主張。
_Avoid_: Lead、Candidate、Finding

**Evidence Route**:
一つのattacker premiseから一つのsecurity impactまでを、sourceまたはExperiment evidence付きの因果関係で結ぶ最小subgraph。Target全体のcall graphや自由文の攻撃物語ではない。
_Avoid_: Call graph、Transcript、Exploit narrative

**Route Fragment**:
同じTarget Snapshot内で複数Hypothesisが参照できる、連続したobserved Evidence Routeの一部。新しい接続関係やterminal impactを証明せず、Targetを越えてobserved stateを継承しない。
_Avoid_: Finding、Exploit primitive library、Global fact

**Frontier Gap**:
現在のEvidence RouteまたはRoute FragmentからFrontier Discovery Capabilityのimpactへ至るために必要な、未確認のessential causal relation。必要fact、falsifier、次の決定的Experimentを伴う。
_Avoid_: Confidence score、Missing-edge count、Speculation

**Source-bound Hypothesis**:
少なくとも一つの実在するentryまたはsecurity-relevant nodeをEvidence Route内でsource evidenceへ結び、unknown、falsifier、次のExperimentを明示したHypothesis。
_Avoid_: Suspicion、Idea

**Preflight Disposition**:
Hypothesisのsymbol実在、entry到達性、権限・nonce防御、sink接続を固定sourceで検査した`passed`、`conclusively-disproved`、`inconclusive`の三値判定。不明は反証ではない。
_Avoid_: Heuristic score、Model confidence、Finding

**Verification Queue**:
事前検査で反証されていないHypothesisを、impact、到達根拠、次の決定的Experiment、費用、coverageで並べた待機集合。予算内で選ばれないことは却下を意味しない。
_Avoid_: Finding Queue、Rejected hypotheses、FIFO

**Experiment**:
一つのHypothesisを支持または反証するために、事前にsuccess criterionを定めて行う再現可能な試行。
_Avoid_: Test、Probe

**Witness**:
Experimentがsecurity propertyの破壊を客観的に示した実行結果。
_Avoid_: Argument、Model verdict

**Execution Canary**:
使い捨ての隔離検証環境内だけでcodeまたはcommand executionを示す、一回限りのnonce付き無害effect。interactive access、外部egress、実data取得、永続backdoorを含まない。
_Avoid_: Reverse shell、Persistent payload、Host command

**Causal Control**:
成立証拠と同じsurfaceおよび環境を使い、仮定した原因要素だけを除くことでsecurity propertyの破壊が消えることを示す比較結果。
_Avoid_: Benign sample、Unrelated negative test

**Skeptic Review**:
成立主張を崩す観点から、attacker premise、到達可能性、既存防御、因果関係、scopeを独立に再確認するreview。
_Avoid_: Model self-review、Approval

**Finding**:
固定したTarget Snapshotに対し、独立Verificationがrouteを再導出し、cleanなlocal WordPress環境で成立証拠と因果対照実験を確認した脆弱性。
_Avoid_: Hypothesis、Report

**Programme Disposition**:
Findingを特定のWordfence適格性スナップショットに照らし、`eligible`、`ineligible`、`needs-current-policy`のいずれかと根拠へ固定した外部行動用の判定。Findingの技術的真偽を変更しない。
_Avoid_: Verification outcome、False positive、Submission receipt

**Known Duplicate Disposition**:
技術的に成立したFindingを、対象plugin、affected versionの重なり、Causal IdentityによってWordfence等の既知脆弱性と照合し、新規、重複、または判定不能と根拠へ固定した外部行動用の判定。Researchの探索、Verification、Findingの技術的真偽へ逆流させない。
_Avoid_: Hypothesis deduplication、Oracle hint、Disproved

**Causal Identity**:
root cause、attacker-controlled primitive、破壊されるsecurity propertyの組で表すHypothesisまたはFindingの重複単位。
_Avoid_: File match、Vulnerability-class match

**Calibration Fingerprint**:
同じBoundary Pairのterminal Findingを異なるAttemptやModel Profileの間で照合するため、Target Snapshot、Evidence Routeのsource anchor、Experiment protocol、WitnessとCausal Controlの観測を固定した構造的identity。modelが生成したCausal Identityの文言または既知答えを探索へ渡すものではない。
_Avoid_: Normalized Causal Identity、Model string match、Finder hint

**Blocked**:
必要なsource、runtime、tool、または前提を取得できず、Hypothesisを支持も反証もできないVerification結果。
_Avoid_: Failed、Disproved

**Disproved**:
独立Verificationが、必要なroute、premise、security property、または成立証拠条件の不成立を証拠付きで示したHypothesis結果。
_Avoid_: Blocked、Rejected

**Coverage Closure**:
すべてのin-scope Focus Areaが理由付きterminalとなり、独立したgap passを繰り返しても新しいsurface、Hypothesis、またはpriority変化が生じないCampaign状態。
_Avoid_: Timeout、Zero findings、Agent done

**Incomplete Campaign**:
予算、tool、runtime、provider、または証拠不足により、in-scope Focus Area、Blocked Hypothesis、検証待ち項目のいずれかを残して停止したCampaign。脆弱性がないという結論ではない。
_Avoid_: Completed、No vulnerabilities、Failed run

**Closure Record**:
一つのFocus Areaについて、所有surfaceを列挙し、それぞれをobserved、Hypothesis化、source根拠付きruled-out、または理由付きBlockedへ分類した完了証拠。
_Avoid_: Worker summary、Done flag

**Research Ledger**:
Hypothesis、Experiment、証拠、判断、費用、次の行動を因果関係ごと追跡できる追記型の研究記録。
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
