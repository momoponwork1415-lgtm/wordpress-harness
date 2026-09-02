# Capability-first roadmap

Status: accepted design sequence, 2026-09-01

North Starは、oracle-freeのprospective CampaignでRCEまたは同等のsite-wide compromiseへ至る未知routeを発見し、独立VerificationとHuman Confirmationまで到達する`Frontier Discovery Capability`である。各Milestoneはその能力へ至る段階であり、公開Caseの再発見だけを最終成果としない。

開発資源は探索、Source Mapping、Verificationへ優先配分する。Remote Control、UI、notification、multi-user、保守運用は、安全隔離とevidence integrityに必要な最小限だけ先に作り、それ以外は実戦投入で観測した故障をissue化して改善する。探索能力の完成前に周辺運用の網羅性を追わない。

## Milestone 1 — one closed loop

Transport Eligibilityを通過したOpus候補のModel ProfileとClaude process adapter一つを使い、gVisor上のBrizy 2.8.11/2.8.12 Boundary Pairをend-to-endで完走する。公式性またはcredential/tool隔離を確認できない場合は別transportへ逃げず、このMilestoneを停止して設計を再評価する。

- manual Target import and immutable Campaign Spec
- one primary plugin per Campaign、明示的な環境依存のみ、無制限な複数plugin組合せ探索は行わない
- PHPを骨格にJavaScript・template・SQL・configuration・bundled vendor assetを必要に応じて結ぶ、根拠状態付きimmutable Surface Map revisions
- observed factをmodelが変更せず、dynamic relationは根拠付きinferredまたは未解決gapとして保持するbounded Mapper synthesis
- Focus Areas、parallel Finder、Hypothesis deduplication
- 共通Finder schemaとraw-source Context Profileを通し、Approach Family、Hypothesis、Route Fragmentを版付きartifactにする
- evidence state付きEvidence Routeによるmulti-file・cross-request chain表現
- Frontier、Primitive、Coverageの三Exploration Laneを持つdeterministic Work Wave
- independent Verifier、browser Witness、sibling Causal Control、Skeptic
- SQLite Research Ledger、private CAS、deterministic Work Waves
- crash resume and budget enforcement
- vulnerable positiveだけをFindingへ昇格
- digest固定したHuman Review Packetと、最小のHuman OS decision record

これはresearch mechanicsの合格であり、RCE discovery capabilityの証明ではない。

実装順は次に固定する。

1. event schema、SQLite Research Ledger、replay/crash test、最小`prepare/read/inspect`
2. pinned PHP helperとPHP Program Index
3. Transport Eligibilityを通過したOpus候補のofficial native agent process transport
4. gVisor Lab Baseline Builder、Verification Lab、Brizy Witness/Causal Control
5. Human Review PacketとHuman Confirmationの記録

## Milestone 2 — early prospective operation

Milestone 1の一つのBoundary Pairでresearch loopと安全機構が閉じたら、手動対象投入した最新安定版pluginへ少数ずつ実戦Campaignを開始する。四Case×四model×全role×複数runの完了は開始条件にしない。

- 取得時点の最新安定版、single-site Canonical Configuration、oracle-freeで開始する
- operatorがsource、version、正規入手provenance、必要な構成と環境依存だけを手動投入し、`ready`なTarget Intake PacketからCampaignを明示的に開始する
- 対象固有のCVE、advisory、疑わしいfile・symbol・parameter、期待class・routeを手動入力として受理しない
- 受入preflightは`ready | deferred | rejected`を理由付きで記録し、解消可能なdependency・runtime・設定不足はdeferred、scope・provenance・integrity・oracle-free policy違反はrejectedとする
- 取得原本と正規化ファイル一覧を別々にdigest固定し、path traversal、link、special file、path衝突、展開quota超過を拒否する。host上でtarget package scriptを実行しない
- 正規化ファイル一覧のdigestをsource treeの主identityにし、file bytesを変換せず、archive timestamp・owner・compression・local pathをidentityから除く。一つのplugin rootを決められない外側bundleはdeferredとする
- plugin identityを`wporg:<slug>`または`premium:<vendor>/<product>`として名前空間化し、main plugin fileを明示または一意なheader候補から確定する。version evidence不足はdeferred、不一致はrejectedとする
- WordPress.org版はofficial slug、premium版はvendor provenanceまたはmanual requestからcanonical install directoryを固定し、main plugin fileと結合したPlugin BasenameをTarget Snapshotへ保持する
- readyはinstall可能性を保証せず、install・activateとCanonical ConfigurationのsmokeはCampaign setupのgVisor内で行う。失敗はセットアップ阻害の未完了Campaignとして残す
- Runtime ProfileはWordPress、PHP、database、web serverのartifact/image digestとgVisor `runsc` identityを固定し、Campaign中に`latest`を解決しない
- Lab Baseline Builderは版付き・型付きSetup Planだけを実行し、fresh stateでdigest固定dependency、主対象、分離したLab principal、Canonical Configuration、frontend・admin・REST health、客観的な正常機能確認を成立させる。任意shell、任意PHP、未固定download、model自己判定を許可せず、immutable baselineだけをVerificationへ渡す
- Canonical ConfigurationはUTC・en_USを基準とし、別localeや設定は根拠付きConfiguration Variantの別Setup Plan・別baselineとして扱う
- 外部serviceはlocal emulator、record/replay、live External Dependency Grantの順で選び、live接続はCampaign専用の非production research accountだけを使う
- Campaign開始後は自律実行するが、候補の自動選定と次Campaignの自動開始はMilestone 3まで行わない
- 全source解析完了またはSurface Map完成を待たず、Snapshot-boundなsource inventoryと`list/search/read`から探索を開始する。Surface Map revisionは任意のcoverage/enrichmentとして反復する
- Focus AreaごとにFeature、Actor、Privilege、State Transition、security invariantを型付きbriefへ固定する
- Frontier・Primitive・CoverageというLaneと、entry順方向・sink逆方向・state-chain・権限/invariant・WildcardというStrategyを別軸で組み合わせる
- eligibleなWork Waveには非ゼロのWildcard枠を置き、高リスクsurfaceとFrontier候補だけを異なるmodel family・Strategyで独立に重ねる
- Finder同士を会話させず、terminalなWork WaveのRoute Fragment、Hypothesis、state transitionだけをstable orderでChain Synthesisへ渡す
- 一つのmodelだけが提示したsource-bound routeを多数決で捨てず、相反するrouteは決定的PreflightまたはVerificationまで別artifactとして保持する
- dynamic registration等はSource Mappingの低影響Runtime Observationでfresh Lab cloneから観測し、Finderへruntime権限を渡さず、ObservationをWitnessに使わない
- Closure Record後に独立Gap Reviewerが未所有surface、unknown relation、未追跡state、未解析assetを確認し、二回のgap passを通るまでCoverage Closureにしない
- 初期はactive Campaignを1件に限定し、Campaign内の重複しないWork Leaseだけを並列実行する
- 予算枠はwall time、Attempt数、Work Wave数、concurrencyを強制し、少なくとも1件の完全検証予約をDiscoveryから保護する
- provider usage、token、subscriptionの推定金額は比較telemetryとして保存し、取得できない金額をhard ceilingにしない
- 公式transport、用途、version固定、credential isolation、built-in tool無効化を確認したTransport Eligibility Receiptがある候補だけを有効化する。consumer subscription認証を独自APIへ転用しない
- 全workerはharness所有のrole別read/search/graph/scratch toolだけを使い、provider組込みshell・web・plugin・hookを無効にする。ExperimentはVerifierと必要なSkepticだけへ渡す
- Semgrep等のmatchはHypothesis Seedとして同じsource bindingとVerificationを通し、source-bound routeのない全面fuzzing、embedding/vector database、vulnerability class別agentは実測gapが出るまで導入しない
- Opus候補から開始し、GPT、Grok、GLM候補はTransport Eligibility、共通contract test、一つの小さなBoundary Pair smoke testを通過したものから実戦roleへ追加する
- モデル比較は実戦Campaignの既知重複を除いたverified unique Findings、誤昇格、coverage closure、cost、wall time、varianceを安定した条件で記録する
- Stored XSS、SQL injection、account takeover、RCE等のtyped Experiment adapterは実戦Hypothesisとcoverage gapの優先度に応じて一つずつ追加する
- 対応ExperimentがないHypothesisはFindingにせず、不足capability付き`Blocked`として次の改善候補にする
- 高価な隔離検証前にsymbol実在、entry到達性、権限・nonce防御、sink接続を三値で事前検査し、`inconclusive`を誤検出扱いしない
- 検証待ち行列の上位Hypothesisから隔離検証し、未選択項目はqueueへ保持する
- 予算またはcapability不足で未検証項目を残して停止したCampaignは未完了とし、zero Findingを「脆弱性なし」にしない
- 予算を自動延長せず、未解決gapの継続は他Targetと再比較して選定された新しい後続Campaignで行う
- RCE Findingを昇格する前に、対応mechanismのprivate Boundary PairとLab内の無害なcanaryでadapterを校正する
- Verified FindingからSemgrep Rule ProposalまたはNot Codifiable Recordを作り、static matchはHypothesisだけを生成する
- PHPにCodeQLを使わず、必要になった公式対応言語だけを将来capability-gatedで扱う
- Frontier Hypothesisは二回のIndependent Reproductionと、可能な限り異なるmodel familyでreviewする
- Corpus由来Knowledge CapsuleはOracle Leakage Gateを通し、由来Caseの再発見を能力向上に数えない
- 大きなpolicyまたはKnowledge昇格だけ、小さなDevelopment/Sealed Cohortで回帰とoracle leakageを確認する
- 通常のprompt・priority変更はDevelopment smokeと次の少数Campaignへの試験投入、static rule・誤検出基準・global Knowledgeは追加で小さなSealed Evaluationを要求する

実戦Campaign中に人間がroute、priority、Hypothesisを操作しない。実戦結果から改善候補を生成し、versionを上げた次Campaignで適用する。

## Milestone 3 — automated Target Intelligence

Milestone 2の手動対象投入を置き換えず、その上流にWordfence Intelligence APIの定期取得、immutable observation、eligibility、ranking、自動候補選定を追加する。

- Target CandidateはWordPress pluginに限定し、themeを取り込まない
- WordPress.org配布pluginはversion固定して自動取得し、premium pluginは正規入手したlocal sourceの手動importだけを受け付ける
- API ingestion failureは進行中Campaignへ影響させない
- selection factsとknown-vulnerability oracleを分離する
- Wordfence programme対象内を外部提出価値のため優先するが、対象外でも技術的価値が高いpluginを調査専用候補として扱える
- 潜在impact、Permitted Attackerから到達し得る攻撃面、利用規模、現行安定版、更新状況、取得可能性を主要な選定要素とし、報奨金額とmodel confidenceを使わない
- 既知脆弱性履歴は初期選定の主要因にせず、将来使う場合も低比重の件数・密度集計だけをTarget Intelligence内に隔離する
- prospective workerへadvisory、CVE、patch narrative、case roleを渡さない
- Wordfence既知脆弱性との重複照合はFinding成立後のHuman OSで行い、Researchへ逆流させない
- Target Candidateからmanual reviewまたはpolicy gateを経て、Oracle Factを除いたTarget Intake Packetを作る
- ResearchがTarget Intake Packetの正規化ファイル一覧をsource tree identityとして固定し、取得原本とprovenanceも参照するTarget Snapshotを作る

自動観測・rankingがなくてもMilestone 1と2は手動対象投入で運用する。Milestone 2の手動経路は同じoracle-freeなTarget Intake Packetを作り、Research内部へ別の抜け道を設けない。

## Milestone 4 — continuous frontier operation

Milestone 2で開始した実戦Campaignを、Target Intelligenceによる定期選定と継続改善へ接続する。

- RCEおよび同等のsite-wide compromiseを最上位security goalとしてFocusする
- SQL injection、Stored XSS、account takeoverを独立impactとchain primitiveの両方として探索する
- agentic discoveryとstatic rule-assisted discoveryを分離してprovenanceを記録する
- Findingにはfresh Verification、Witness、Causal Control、Skepticを要求する
- Frontier Discovery Capabilityの達成判定にはHuman Confirmation済みのprospective Findingを要求する
- 人間はCampaign開始・停止、外部依存Grant、auth failure、最終review、外部提出承認だけに関与する

## Later contexts and adapters

Programme eligibility、submission drafting、vendor communication、patch generationはresearch capabilityとTarget Intelligenceの外側に置き、Human OSの明示的なExternal Action Authorizationへ接続する。web dashboardとremote controlはHuman OSおよびResearchを操作するadapterであり、独立したdomain contextにしない。

ThemeとWordPress Coreはroadmapに入れない。これらの将来用拡張点も先行実装せず、WordPress pluginの調査能力に集中する。発展先を検討する場合は、WordPress外のホワイトボックス・バグバウンティ用の別productとし、このharnessのMilestoneに混ぜない。
