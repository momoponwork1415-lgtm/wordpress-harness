# Codebase Guide

Status: living module map, 2026-09-05

ModuleのPurpose、Interface、実装状況、source、Behavior Testを一か所で引くためのガイドである。whole-systemの関係とflowは[Architecture](ARCHITECTURE.md)、research policyは[Research Design](RESEARCH-DESIGN.md)を参照する。

## Current capability

| Product stage | Status | Remaining |
| --- | --- | --- |
| Target Acquisition / Intake | local directory、WordPress.org archive、selection / rankingを実装済み | premium acquisition |
| Vulnerability Intelligence | Wordfence Intelligence v3のlocal indexとoracle-separated projectionを実装済み | Patchstack source取得方式の決定 |
| Semantic Research | v6 initial Wave、Decision@3、conditional Depth実行まで実装済み | Missing-link / Closure |
| Source-only Validation | v6 single fresh Attemptと4 dispositionを実装済み | Frontier Gapの次Wave |
| Runtime handoff | Runtime Verification Packet v2とCAS-first handoffを実装済み | AI Reproduction intake |
| AI Reproduction | class固定のlegacy Labは実装済み | generic Recipe、private evidence、Triage Packet |
| Human Verification | Environment、有限queue、human disposition、known-plugin smokeを完走 | mandatory fresh再実行、二車線Queue |
| Finding | Human Verification gateとknown-pluginでの成立を実測済み | Prospective Campaignでの成立実測 |

現在のproduction sliceは`Target Intake -> initial Semantic Wave -> Decision@3 / Approach Family -> conditional Depth / single source Validation -> Risk Assessment / Runtime Verification Packet`である。既存Human OSのv1 Human Review Packet flowは#110移行前のcompatibility implementationとして残る。v6 Depthはtool-free Synthesis、Manifest-bound Critic、fresh Root EvaluationをCAS / Ledger境界で分離する。Packet delivery failureはPacketを保持したままResearch failureと分ける。Missing-link / Closureはlegacy v5に実装済みだがv6へ未接続。

採用済みだが未実装のtarget flowは`single source screen -> Runtime Verification Packet -> AI Reproduction -> Triage Reproduction Packet -> mandatory fresh Human reproduction -> Finding`である。完成度をpercentでは表さない。まず実plugin一件を早期に完走し、その実測後にCoverage policy、Development Cohort、三件のProspectiveへ広げる。

残作業の実行順と完了条件は[Issue #86](https://github.com/momoponwork1415-lgtm/wordpress-harness/issues/86)を正本とする。

| Order | Work |
| --- | --- |
| 1 | [#106 current write Interface](https://github.com/momoponwork1415-lgtm/wordpress-harness/issues/106)（完了） |
| 2 | [#107 single Source Validation / Runtime Packet](https://github.com/momoponwork1415-lgtm/wordpress-harness/issues/107) -> [#108 AI Reproduction / Triage Packet](https://github.com/momoponwork1415-lgtm/wordpress-harness/issues/108) |
| 3 | [#110 mandatory Human reproduction](https://github.com/momoponwork1415-lgtm/wordpress-harness/issues/110) -> [#109 実plugin一件のearly Prospective](https://github.com/momoponwork1415-lgtm/wordpress-harness/issues/109) |
| 4 | [#81 Validation Gap loop](https://github.com/momoponwork1415-lgtm/wordpress-harness/issues/81)、[#82 Coverage policy](https://github.com/momoponwork1415-lgtm/wordpress-harness/issues/82)、[#33 Development Cohort](https://github.com/momoponwork1415-lgtm/wordpress-harness/issues/33) |
| 5 | [#111 measured budget defaults](https://github.com/momoponwork1415-lgtm/wordpress-harness/issues/111)、[#32 三件のProspective Campaign](https://github.com/momoponwork1415-lgtm/wordpress-harness/issues/32) |

## Target Intelligence

### Programme Intelligence

**Interface:** `ProgrammeIntelligence.refresh / inspect`

- **Purpose:** 外部programmeのscope、eligibility、reward policy、competition ruleを、Programme Identityとrequired source provenanceへ結び付けたProgramme Eligibility Snapshotにする。
- **Invariants:** source URL、retrievedAt、raw content digest、parser version、freshness policyを固定する。Programme Opportunity BandとFinding後専用のreward estimate inputを分離し、programme ruleでFindingのtechnical validityを変更しない。Oracle FactをResearchまたはTarget Intake Packetへ渡さない。
- **Failures:** required source間の不一致は`policy-conflict`、必須fieldまたはnormalized contract不成立は`parse-failed`、refresh失敗と期限切れsnapshotは`stale`。Target選定batchとSubmission Stagingはそれぞれcurrent freshnessを要求する。
- **Status:** versioned core contract、content-addressed snapshot、sanitized fixture Adapterの共通Behavior Testを実装。Patchstack / Wordfence固有Adapterを実装済み。
- **Code / Tests:** [programme-intelligence](../src/target-intelligence/programme-intelligence) · [Behavior Test](../tests/target-intelligence/programme-intelligence.test.ts)

### Patchstack Programme Adapter

- **Purpose:** Rules / Terms、report form、leaderboard、mVDP directory、marketing pageの5 Intelligence Sourceを優先順付きで取得・parseし、programme-neutralなProgramme Eligibility Snapshotへ統合する。
- **Interface:** `createPatchstackProgrammeAdapters -> ProgrammePolicySourceAdapter[]`
- **Invariants:** Rulesをeligibilityの正本とし、lower-precedence sourceで上書きしない。latest stable、3年以内更新、active-install threshold、attacker role、mVDP例外をeligibilityへ固定する。Monthly CompetitionとZerodayを別のFinding-only reward routeにし、XP factor、contribution share、rejection-rate reduction、monthly poolをsource digestへbindする。named plugin、CVE、affected version、researcher detailsをnormalized policyへ含めない。
- **Failure semantics:** required Intelligence Source取得失敗は`stale`、必須ruleまたはstrict page contract不成立は`parse-failed`、source間の実質的矛盾は`policy-conflict`。marketing表示だけでRulesを置き換えない。
- **Behavior Test:** [Patchstack Programme Adapter](../tests/target-intelligence/patchstack-programme-adapter.test.ts)
- **Status:** 5-source group parse、source provenance、reward-route分離、conflict / stale / driftのsanitized fixture Behavior Testを実装。
- **Code:** [patchstack-programme](../src/target-intelligence/patchstack-programme)

### Wordfence Programme Adapter

- **Purpose:** current programme、Terms、report form、payout page、promotion page、monthly reportの6 Intelligence Sourceを取得・parseし、programme-neutralなProgramme Eligibility Snapshotへ統合する。
- **Interface:** `createWordfenceProgrammeAdapters -> ProgrammePolicySourceAdapter[]`
- **Invariants:** asset、vulnerability class、attacker role、active-install threshold、researcher tier、pending cap、out-of-scope条件をeligibilityへ固定する。base / range、bonus、minimum、promotion期間はFinding-only reward routeに置き、保証額にしない。monthly reportはCWE category、authentication level、install帯、submission disposition、rewardのaggregateだけを保持し、named plugin、CVE、affected version、known route、researcher identityを含めない。
- **Failure semantics:** required Intelligence Source取得失敗は`stale`、必須rule、promotion、monthly aggregateまたはstrict page contract不成立は`parse-failed`、source間のscope / payout矛盾は`policy-conflict`。old defaultへfallbackしない。
- **Behavior Test:** [Wordfence Programme Adapter](../tests/target-intelligence/wordfence-programme-adapter.test.ts)
- **Status:** 6-source group parse、source provenance、Finding-only payout / promotion input、oracle-free monthly aggregate、conflict / stale / drift、restart replayのsanitized fixture Behavior Testを実装。
- **Code:** [wordfence-programme](../src/target-intelligence/wordfence-programme)

### Disclosure Route Observation

**Interface:** `DisclosureRoute.observe / inspect`

- **Purpose:** Targetごとの公開脆弱性報告routeを、`first-party-bounty / first-party-vdp / delegated-vdp / security-contact-only / none-found / conflicting`へsource付きで不変化する。
- **Invariants:** vendor公式、official repository `SECURITY.md`、WordPress.org maintainer記載、programme directory、検索結果の順で根拠を評価する。source URL / owner、validated final URL、retrievedAt、raw digest、parser version、checked scope、submission route、exclusivity / disclosure条件を固定する。`none-found`は確認sourceの範囲だけを意味する。route semantic digestは取得時刻に依存せずTargetへbindし、route変更時だけ既存Programme Assignmentをstaleにできる。Oracle FactまたはResearch eligibility判断を含めない。
- **Failures:** source取得失敗は`acquisition-failed`、HTTPS origin allowlist外へのredirectは`untrusted-provenance`、strict source document不成立は`parse-failed`。first-partyとlower-precedence sourceの矛盾はfirst-party根拠を保持した`conflicting`として人間確認を要求する。
- **Status:** content-addressed observation、6分類、Ultimate Member型direct reward / GiveWP型delegated VDPのsanitized fixture、conflict / none-found / redirect / Oracle separation、選定・staging再取得、restart replayを実装。
- **Code / Tests:** [disclosure-route](../src/target-intelligence/disclosure-route) · [Behavior Test](../tests/target-intelligence/disclosure-route.test.ts)

### Target Research History

- **Purpose:** Plugin Identity、verified version、Canonical File Manifest digestでTargetを固定し、Campaignの選定、進行、terminal statusをappend-onlyに記録して重複Researchを制御する。
- **Interface:** `TargetResearchHistory.admit / record`
- **Invariants:** activeは既存Campaignへresumeし、Coverage Closedは通常のprospective選定を`already-covered`にする。Incomplete後のprospective再実行は元Campaignと理由codeを固定したfollow-upだけを許可する。同じplugin/versionの異なるManifest digestはprovenance conflict、新しいverified versionは別Targetにする。Campaign purposeと理由は列挙済みcodeだけを受け付け、Oracle Factを自由記述として保存しない。Research Ledgerを参照せず、保存rowをruntime validationしてからpublic projectionをreplayする。
- **Failure semantics:** admission判断は`new / resume / already-covered / follow-up-required / provenance-conflict`。不正contract、保存row、Campaign bindingまたはlifecycle順序の不一致、durable write failureだけをerrorにする。
- **Behavior Test:** [Target Research History](../tests/target-intelligence/target-research-history.test.ts)
- **Status:** Target Intelligence専用SQLite eventからCampaign viewをreplayする。Development Cohort、calibration、意図的な独立反復はkind、run ordinal、理由を固定して許可する。
- **Code:** [research-history](../src/target-intelligence/research-history)

### Target Selection

**Interface:** `TargetSelection.select`

- **Purpose:** Target Observation、Programme Eligibility、Disclosure Route、弱いVulnerability History Aggregate、Target Research Historyを一つのprogramme-neutral Candidate Poolとして評価し、有限のSelection Receipt集合を作る。
- **Invariants:** provenance、取得可能性、Target identity、source freshness、Research Historyをdeterministic hard gateにする。Opus Model Profileへはactive installs、更新時刻、公開integration、粗いsource scale、Disclosure Route、diversityだけを渡す。Vulnerability History AggregateはAttempt / Receiptへbindするがmodel inputにせず、単独で採否を変えない。Research Value Bandを先に比較し、同BandでだけProgramme Opportunity Bandをtie-breakerに使い、vendor / family / use case / size / authority / integrationのversioned capで多様性を保つ。ReceiptはCampaignを開始しない。
- **Failures:** provider failure、budget exhaustion、invalid model result、model実行前にdurable化したAttemptの中断は、空Batchではなく`selection-pending`として保持する。同じselection key / revisionの異なるinputはconflict、同じinputはmodelを再実行せずreplayし、明示的な新revisionだけを再選定する。
- **Status:** content-bound Attempt / Receipt、Opus-only profile、stable projection、hard gate、active resume / already-covered / Incomplete follow-up、Research-only保持、diversity、restart / failure replayを実装。
- **Code / Tests:** [target-selection](../src/target-intelligence/target-selection) · [Behavior Test](../tests/target-intelligence/target-selection.test.ts)

### Target Batch Approval

**Interface:** `TargetBatchApproval.approve / inspect`

- **Purpose:** 一つのSelection Attemptの有限なSelection Receipt集合について、人間の承認、除外、順序変更、operator nominationを一回の判断へまとめ、versioned Approved Target Batchにする。
- **Invariants:** Selection Receipt digest、同一Attempt binding、Selection Policy、Opus Model Profile、Target Observation、programme / disclosure freshness、Campaign Policy、Batch Budget、execution window、human identity / decision time / reasonを固定する。operator-nominated TargetもSelection hard gate通過済みReceiptを必須とする。承認はResearch、Campaign、外部通信を開始しない。
- **Failures:** Receipt integrity、Attempt / policy / profile binding、decision集合、approved orderの不一致を拒否する。hard gate不通過は人間でもoverrideできず、Batch Budget超過を拒否する。同じbatch key / revisionの異なるinputは`revision-conflict`、変更は開始前の新revision + `supersedes`だけを許可し、開始後は`execution-started`にする。
- **Status:** content-addressed Batch、revision index、approval / exclusion / reorder / nomination、idempotency、restart replay、supersedeのBehavior Testを実装。
- **Code / Tests:** [target-batch-approval](../src/target-intelligence/target-batch-approval) · [Behavior Test](../tests/target-intelligence/target-batch-approval.test.ts)

### Wordfence Vulnerability Intelligence

**Interface:** `WordfenceIntelligence.refresh / inspect / aggregate / inspectKnownRecords`

- **Purpose:** Wordfence Intelligence v3 Production Feedを不変snapshotとlocal indexへ変換し、Target選定用の弱いVulnerability History AggregateとFinding後専用のknown-record projectionを分離する。
- **Invariants:** complete response、source URL、取得時刻、raw response digest、parser versionをsnapshotへ固定し、全recordとWordfence / MITRE attributionのvalidation成功後だけcurrent pointerをtransaction更新する。選定projectionはplugin単位の件数、公開年密度、最終公開時刻だけを返し、CVE、CWE、CVSS、affected / patched versionを含めない。exact recordはverified Finding refと`known-duplicate-disposition` purposeを必須にする。Bearer値はSecretRef resolverの内側だけで使用する。
- **Failures:** 404、auth failure、429、network failure、partial response、schema drift、copyright / license metadata欠落をtyped failureにする。失敗refreshは既存current pointerを変更しない。
- **Status:** bounded production fetch Adapter、sanitized fixture Adapter、Store / replay、affected-version interval query、oracle-separated aggregateを実装。
- **Code / Tests:** [wordfence-intelligence](../src/target-intelligence/wordfence-intelligence) · [Behavior Test](../tests/target-intelligence/wordfence-intelligence.test.ts)

### WordPress.org Target Source

**Interface:** `WordPressOrgTargetSource.observe / acquire`

- **Purpose:** official plugin slugから不変なTarget Observationを作り、観測したstable versionのarchive原本を既存Target Intakeへ安全に渡す。
- **Invariants:** Plugin Identityは`wporg:<slug>`とし、表示名、stable version、active installations、last updated、download provenance、取得時刻をmetadata digestとparser versionへ固定する。acquireは観測済みversionとMain Plugin File headerを照合し、archive bytesをcontent digestで不変化する。CVE、advisory、known vulnerable range、known routeをObservationまたはPacketへ保存しない。同じofficial bytesは取得時刻やrestartにかかわらず同じCanonical File ManifestとTarget Intake Packetへ収束する。
- **Failures:** metadata / archiveの404、rate limit、network failure、quota超過、invalid metadata、要求version不一致、metadata / archive不一致をtyped failureにする。ZIPのpath traversal、link、multiple plugin root、integrity不正、quota超過はTarget Intake公開前に`rejected`、Main Plugin Fileの不足・曖昧性は既存Intakeの`deferred`にする。別versionまたは別sourceへsilent fallbackしない。
- **Status:** bounded production fetch Adapter、sanitized fixture Adapterによるoffline Behavior Test、Deflate / Store ZIPの安全な展開、Acquisition Original保存、restart replayを実装。
- **Code / Tests:** [acquisition](../src/target-intelligence/acquisition) · [Behavior Test](../tests/target-intelligence/wordpress-org-target-source.test.ts)

### Target Intake

**Interface:** `TargetIntake.intake(request) -> ready | deferred | rejected`

- **Purpose:** untrustedなarchiveまたはdirectoryを、oracle-freeなTarget Intake Packetへ変換する。
- **Invariants:** identityとversionを照合し、sourceを実行せず、artifactをdurableにしてから`ready`を返す。同じrequestは同じ結果へ収束する。
- **Failures:** policy outcomeは`deferred / rejected`、durable化できないsystem failureだけをerrorにする。
- **Status:** local directoryとWordPress.org archive、manifest、quota / path / link検査、Campaign handoffを実装。premium archive acquisitionは未実装。
- **Code / Tests:** [acquisition](../src/target-intelligence/acquisition), [handoff](../src/research/campaign-control/target-intake-campaign-handoff.ts) · [intake](../tests/target-intelligence/local-directory-target-intake.test.ts), [handoff](../tests/research/target-intake-campaign-handoff.test.ts)

## Research

Context外の入口は`openResearch`。Researchは六Moduleで構成する。

### Campaign Control

**Interface:** `CampaignRunner.prepare / prepareFromTargetIntake / run`、`CampaignReader.inspect`

- **Purpose:** fixed Targetをfinite Wave、Validation、Runtime Verification Packet handoffまで進める。
- **Invariants:** PlanへTarget、Manifest、policy、profile、tool、budgetを固定する。artifactをCASへ置き、Ledger eventを記録してから次stageへ進む。
- **Failures:** integrity不正は起動前に拒否する。provider / policy / budget failureをnegativeやno-new-evidenceへ丸めない。
- **Status:** v6 initial Wave、single Validation、conditional Depth、Runtime Verification Packet v2 handoff、terminal replay、progressを実装。AI ReproductionとMissing-link / Closureは未接続。
- **Code / Tests:** [campaign-control](../src/research/campaign-control), [open-research](../src/research/open-research.ts) · [v6 run](../tests/research/campaign-validation-run.test.ts), [semantic E2E](../tests/research/campaign-semantic-e2e.test.ts), [replay](../tests/research/campaign-run.test.ts)

### Source Understanding

**Interface:** `SourceMapping.build`、`SourceEvidenceGateway.query`

- **Purpose:** TargetFileManifestをsource identityの正本とし、read-only `list / search / read`とoptional Surface Mapを提供する。
- **Invariants:** responseをTarget、Manifest、policy、query ordinalへbindする。Mapはnavigation用であり探索境界やsafe判定にしない。
- **Failures:** path escape、digest / binding不正、budget超過をtyped resultにし、partial sourceを成功へ丸めない。
- **Status:** v2 paginated query、Receipt、Map / deltaを実装。
- **Code / Tests:** [source-mapping](../src/research/source-mapping) · [gateway v2](../tests/research/source-evidence-gateway-v2.test.ts), [mapping](../tests/research/source-mapping.test.ts)

#### PHP Program Index

**Interface:** internal `PhpSourceAnalysis.analyze / read`

- pinned `nikic/PHP-Parser` helperからmanifest-bound indexを作る。
- Target PHP、autoload、Composer script、WordPressを実行しない。timeout、memory、output ceilingを適用する。
- **Status / Tests:** internal slice実装済み · [code](../src/research/source-mapping/php-program-index), [tests](../tests/research/php-program-index.test.ts)

### Exploration

**Interface:** `Exploration.decide`

- **Purpose:** raw sourceからHypothesis、Route Fragment、Frontier Gapを作り、Validation、Depth、次Wave、Closureへ処遇する。
- **Invariants:** ReconとBaselineを並行し、最大4個の独立Finderを保つ。file / CWE / 手順を固定せず、支持数や多数決でcandidateを捨てない。
- **Checkpoint:** subjectをTarget、Manifest、Attempt、Leaseへbindし、CAS / Ledgerへ保存してからackする。
- **Depth:** fresh tool-free Synthesis、source-enabled Critic、Root Evaluation、Missing-link Waveを分離する。Familyごと最大3 evidence generation、Campaign全体最大12 Wave。
- **Closure:** 最後のmaterial evidence後に二回連続のcomplete no-material-deltaを要求し、後者はfresh reviewを含む。
- **Failures:** invalid evaluation、budget exhaustion、active Family、unscheduled Gapを`Incomplete`として残す。
- **Status:** v6 initial Wave / Decision@3 / conditional Depthを実装。Missing-link / Closureはlegacy pathのみ。
- **Code / Tests:** [exploration](../src/research/exploration) · [planning](../tests/research/semantic-root-planning.test.ts), [evaluation](../tests/research/semantic-root-evaluation.test.ts), [Depth](../tests/research/semantic-depth-work-queue.test.ts), [E2E](../tests/research/campaign-semantic-e2e.test.ts)

### Validation

**Interface:** `Validation.validate(plan) -> ValidationRecordRef`

- **Purpose:** Root-evaluated candidateをfreshなsource reviewで反証し、Humanへ渡す明らかなfalse positiveを抑える。
- **Current implementation:** exact identityはTarget、Manifest、premise、property、ordered route、anchorで作る。一つのfresh Validatorから`ready-for-runtime / needs-research / disproven / validation-pending`を決定的に投影し、二つ目・第三AttemptとValidation Synthesisを起動しない。
- **Runtime handoff:** `ready-for-runtime`からsingle Validation、bind済みCandidate、Risk、source route / control / counterevidence、runtime sketchを自己完結のRuntime Verification Packet v2へ投影する。明白なsource contradictionだけを止め、Researchは`rejected`を作らない。[#107](https://github.com/momoponwork1415-lgtm/wordpress-harness/issues/107)
- **Boundary:** Findingやruntime reproductionを所有しない。`needs-research`は具体的Gapとして同じFamilyへ戻す。
- **Risk / Packet:** Riskはsingle Validationとbind済みCandidateから追加model judgeなしで投影する。exact payloadとraw requestをResearchへ保存せず、delivery failureでもPacketを失わない。
- **Status:** single fresh Attempt、Disposition、Risk / Runtime Packetをv6へ接続。multi-Attempt / Synthesis / Human Review Packet v1は元の意味でlegacy replayする。
- **Code / Tests:** [validation](../src/research/validation), [candidate admission](../src/research/campaign-control/validation-candidate-admission.ts) · [Validation](../tests/research/validation.test.ts), [Runtime Packet](../tests/research/runtime-verification-packet.test.ts), [legacy Packet](../tests/research/human-review-packet.test.ts), [v6 handoff](../tests/research/campaign-validation-run.test.ts)

### Model Execution

**Interface:** `ModelExecution.run(plan, observer?) -> AttemptExecutionResult`

- **Purpose:** immutable Attempt Planをprovider-neutral resultへ変換し、process、tool、credentialを隠す。
- **Invariants:** official transportだけを使い、model / effortを固定する。role間でsession、conversation、scratchを共有しない。
- **Tools:** manifest-bound read-only source toolだけを許可する。Finder checkpointはdurable write後にackする。Synthesis / Riskはtool-free。
- **Recovery:** transient failureだけを同じAttemptと残budgetでresumeする。Recoveryの正本はLedger、CAS、checkpoint。
- **Failures:** provider、auth、policy、invalid output、budget、cancelを区別する。observer / private transcript failureはoutcomeを変えない。
- **Status:** Claude Adapter、usage、Receipt、resume、private transcriptを実装。
- **Code / Tests:** [model-execution](../src/research/model-execution) · [execution](../tests/research/model-execution.test.ts), [bridge](../tests/research/claude-source-evidence-bridge.test.ts)

### Research Record

Internal Module。immutable CAS artifact、append-only Ledger event、checkpoint、replay projectionを所有する。

- **Interface:** current writeはprivate `CurrentCampaignStore`、全世代のread-only replayは`LegacyResearchReplay`。SQLiteとpublic `CampaignRunner / CampaignReader`は維持する。
- artifactを保存してから参照eventをappendする。
- cacheを削除しても同じLedgerから同じview digestを再構築できる。
- semantic identity、priority、Family groupingはowner Moduleが決める。
- **Status / Tests:** current v3 writeをlegacy `ResearchRecord`から分離し、v1 / v2は既存Ledgerのreplayだけをproductionで許可する。Decision@3、Family、single Validation、Frontier Gap、Depth Queue / Synthesis / Critique / Evaluation、Runtime Packet handoff、progress replayを実装 · [current store](../src/research/research-record/current-campaign-store.ts), [legacy replay](../src/research/research-record/legacy-research-replay.ts), [v3 behavior](../tests/research/campaign-validation-run.test.ts), [compatibility](../tests/research/ledger-compatibility.test.ts)

## Human OS

### AI Reproduction

**Accepted Interface:** `AIReproduction.run(RuntimeVerificationPacket) -> runtime-confirmed | runtime-inconclusive`

- **Purpose:** fresh environmentと実Target interfaceでsource routeを試し、人間が再実行できるRecipeとevidenceを作る。
- **Invariants:** SQLi、XSS等のclassはRecipeのcriterionに使うが、固定Adapter対応をadmission条件にしない。exact payload、request、screenshot、runtime logはPrivate Evidence Bundleへ置く。
- **Failures:** unsupported mechanism、setup、provider、budget failureをRejectedへ丸めない。runtime-confirmedだけがTriage Reproduction Packetを作る。
- **Status:** legacy Verificationに5種類のclass固定Labがある。generic AI Reproduction、Private Evidence Bundle、Triage Reproduction Packetは未実装。[#108](https://github.com/momoponwork1415-lgtm/wordpress-harness/issues/108)

### Human Verification Environment

**Interface:** `HumanVerificationEnvironmentBuilder.establish -> ready | setup-blocked`

- **Purpose:** Packetと一致するTargetをfresh disposable environmentへ構築する。
- **Invariants:** requestへPacket、Target、Runtime Profile、declarative Setup Plan、Policy、grantをdigest固定する。target codeをhost上で実行せず、privileged container、host network、engine socket、ambient credential、許可外egressを使わない。Setup Receipt、gate observation、effective config、Target/runtime identityをCAS-firstで保存した後だけ`ready`を公開する。
- **Failure semantics:** isolation不足、setup、activation、health failureは`setup-blocked`として保持する。partial environmentはcleanupし、plain Dockerまたはhost executionへfallbackしない。同じrequest digestは保存済みDispositionをreplayする。
- **Status / Tests:** Builder、versioned contract、Human OS Record、Packet-bound sourceを実runsc WordPress sessionへ構築するgVisor provisionerを実装。Researchのlegacy Assistantとはsession lifecycleだけを共有する · [builder](../src/human-os/human-verification-environment.ts), [provisioner](../src/human-os/gvisor-wordpress-environment-provisioner.ts), [isolation infrastructure](../src/infrastructure/gvisor-wordpress-session.ts) · [contract tests](../tests/human-os/human-verification-environment.test.ts), [gVisor adapter](../tests/human-os/gvisor-wordpress-environment-provisioner.test.ts)

### Human Verification

**Interface:** `HumanVerification.admit`、`HumanVerification.record`

- **Purpose:** Triage Reproduction Packetを人間がAIと別のfresh instanceで必ず再実行し、Findingまたは理由付きnegativeまで閉じる。
- **Current implementation:** Human Review Packet v1のadmission、最大3 active mechanism、manual record、Finding gateを実装。deferred Caseの自動繰り上げとAI evidence bindingはない。
- **Accepted target:** runtime-confirmedを通常Queue、high-impact runtime-inconclusiveを人間選択のEscalation Queueへ置く。総件数を制限せずactive concurrencyだけを設定し、完了後に繰り上げる。[#110](https://github.com/momoponwork1415-lgtm/wordpress-harness/issues/110)
- **Failure semantics:** 前提一致かつRecipe完走後のeffect非観測だけを`rejected`にする。環境不一致は`blocked`、曖昧な観測は`runtime-inconclusive`、不足証拠は`more-evidence-required`。
- **Finding gate:** `verified-finding`だけがFindingを生成する。生成時のexternal actionは`not-authorized`であり、report、vendor contact、公開は別承認を必要とする。
- **Status / Tests:** v1 queue、Human Review Case、Verification Record、Finding / Evidence Request、Human OS replayを実装。mandatory fresh再実行を含むv2 flowは未実装 · [code](../src/human-os/human-verification.ts), [tests](../tests/human-os/human-verification.test.ts)

### Legacy Verification

ADR 0122以前の`VerificationRecord / Finding / Disproved / Blocked`を元の意味でread/replayする互換境界。

- 旧Findingを`ready-for-runtime`や現行Findingへ自動変換しない。
- gVisor Lab、Witness、Causal Control、固定mechanism Adapterはlegacy replayと参考実装に限定する。
- **Status / Tests:** replay compatibility実装済み · [code](../src/research/verification), [tests](../tests/research/verification.test.ts), [gVisor](../tests/research/gvisor-account-takeover-lab.test.ts)

## Adapters and runtime policy

- CLIは`prepare / inspect`だけを持つthin adapter。[code](../src/cli.ts) · [tests](../tests/cli/campaign-cli.test.ts)
- current policyは`semantic-research-recall-baseline-v6`。
- current Campaign ceilingは12 Wave、USD 150、12 hours、Validation reserveはUSD 30。これらは[#111](https://github.com/momoponwork1415-lgtm/wordpress-harness/issues/111)でSchema literalからversioned baseline defaultへ移す。
- v1 Map-firstとv5 Verificationはread/replay互換として残す。
- ceiling到達はnegativeではなくtyped IncompleteまたはPending。

## Change path

1. この文書でowner、Interface、source、Behavior Testを特定する。
2. public behaviorをTestから観測する。
3. hard-to-reverseな理由が必要な時だけ`docs/adr/`を読む。
4. 次の有限workと受入条件はGitHub Issueで確認する。

Schema field、private helper、provider argv、内部call順はこのGuideへ複製しない。
