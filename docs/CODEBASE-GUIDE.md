# Codebase Guide

Status: living module map, 2026-09-06

ModuleのPurpose、Interface、実装状況、source、Behavior Testを一か所で引くためのガイドである。whole-systemの関係とflowは[Architecture](ARCHITECTURE.md)、research policyは[Research Design](RESEARCH-DESIGN.md)を参照する。

## Current capability

| Product stage | Status | Remaining |
| --- | --- | --- |
| Target Acquisition / Intake | local directory、WordPress.org archiveを実装済み | premium acquisition |
| Target selection / approval | Research History、programme / route観測、自律選定、人間のBatch承認を実装済み | Campaign Coverage Receipt、unattended dispatch |
| Vulnerability Intelligence | Wordfence Intelligence v3のlocal indexとoracle-separated projectionを実装済み | なし（Wordfence-only方針を#102で確定済み） |
| Semantic Research | v6 initial Wave、Decision@3、conditional Depth実行まで実装済み | Missing-link / Closure |
| Source-only Validation | v6 single fresh Attempt、4 disposition、source-validated Findingを実装済み | Frontier Gapの次Wave |
| Runtime handoff | Runtime Verification Packet v2はread-only replay、AI Reproduction intakeは実装済み | Finding handoff（#126 / #129） |
| AI Reproduction | typed attempt、class別・generic Recipe、private evidence、Triage Packetを実装済み | Finding Verification Recordへ移行（#126） |
| Human Verification | mandatory fresh再実行、二車線Queue、Current Version Review、human-only Finding gateを実装済み | Finding gateをsubmission gateへ移す（#126） |
| Finding | fresh Independent Validationからimmutable source-validated Findingを生成 | runtime / human Verification Record（#126） |
| Understanding / report | 設計とIssue分割まで完了 | grounded explanation、template draft、人間承認、form staging |

現在のResearch production sliceは`Target Intake -> initial Semantic Wave -> Decision@3 / Approach Family -> conditional Depth / single source Validation -> source-validated Finding + Coverage`である。Findingの存在とCoverage状態は別々にterminal viewへ返す。旧Runtime Verification Packet、Human Review Packet、human-only Findingは元の意味でread-only replay境界に残す。v6 Depthはtool-free Synthesis、Manifest-bound Critic、fresh Root EvaluationをCAS / Ledger境界で分離する。Missing-link / Closureはlegacy v5に実装済みだがv6へ未接続。

手動Target Intakeから旧Findingまでのflowはversioned contractで接続済みである。[ADR 0124](adr/0124-align-campaign-and-finding-lifecycle-with-reference-harnesses.md)ではFinding lifecycleだけを変更し、現行のSemantic Research Waveとpublic seamは維持する。Target Intelligence内の自律選定とBatch承認は実装済みだが、Approved Target BatchからTarget Acquisition / Researchへのdispatchは未接続であり、完成度をpercentでは表さない。次の有限workと順序は[Issue #124](https://github.com/momoponwork1415-lgtm/wordpress-harness/issues/124)と[Issue #86](https://github.com/momoponwork1415-lgtm/wordpress-harness/issues/86)を正本とする。

## Target Intelligence

### Programme Intelligence

- **Purpose:** 外部programmeのscope、eligibility、reward policy、competition ruleを、Programme Identityとrequired source provenanceへ結び付けたProgramme Eligibility Snapshotにする。
- **Interface:** `ProgrammeIntelligence.refresh / inspect`
- **Invariants:** source URL、retrievedAt、raw content digest、parser version、freshness policyを固定する。Programme Opportunity BandとFinding後専用のreward estimate inputを分離し、programme ruleでFindingのtechnical validityを変更しない。Oracle FactをResearchまたはTarget Intake Packetへ渡さない。
- **Failure semantics:** required Intelligence Source間の不一致は`policy-conflict`、必須fieldまたはnormalized contract不成立は`parse-failed`、refresh失敗と期限切れsnapshotは`stale`。Target選定batchとSubmission Stagingはそれぞれcurrent freshnessを要求する。
- **Behavior Test:** [Programme Intelligence](../tests/target-intelligence/programme-intelligence.test.ts)
- **Status:** versioned core contract、content-addressed snapshot、sanitized fixture Adapterの共通Behavior Testを実装。Patchstack / Wordfence固有Adapterを実装済み。
- **Code:** [programme-intelligence](../src/target-intelligence/programme-intelligence)

### Patchstack Programme Adapter

- **Purpose:** Rules / Terms、report form、leaderboard、mVDP directory、marketing pageの5 Intelligence Sourceを優先順付きで取得・parseし、programme-neutralなProgramme Eligibility Snapshotへ統合する。
- **Interface:** `createPatchstackProgrammeAdapters -> ProgrammePolicySourceAdapter[]`
- **Invariants:** Rulesをeligibilityの正本とし、lower-precedence sourceで上書きしない。latest stable、3年以内更新、active-install threshold、attacker role、mVDP例外をeligibilityへ固定する。mVDP directoryはrequired sourceとし、directory membership条件と適用される例外をprogramme-neutralなeligibility ruleへ変換する。directory ruleはRulesのauthorization conditionが存在する場合だけ有効にする。Monthly CompetitionとZerodayを別のFinding-only reward routeにし、XP factor、contribution share、rejection-rate reduction、monthly poolをsource digestへbindする。named plugin、CVE、affected version、researcher detailsをnormalized policyへ含めない。
- **Failure semantics:** required Intelligence Source取得失敗は`stale`、必須rule、mVDP membership / exceptionまたはstrict page contract不成立は`parse-failed`、directory ruleがRulesにない例外を主張する場合を含むsource間の実質的矛盾は`policy-conflict`。marketing表示だけでRulesを置き換えない。
- **Behavior Test:** [Patchstack Programme Adapter](../tests/target-intelligence/patchstack-programme-adapter.test.ts)
- **Status:** 5-source group parse、mVDP membership / exception projection、source provenance、reward-route分離、conflict / stale / driftのsanitized fixture Behavior Testを実装。
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

- **Purpose:** Targetごとの公開脆弱性報告routeを、`first-party-bounty / first-party-vdp / delegated-vdp / security-contact-only / none-found / conflicting`へsource付きで不変化する。
- **Interface:** `DisclosureRoute.observe / inspect / projectAssignmentStaleness`、`ProgrammeAssignmentRouteBindingResolver`
- **Invariants:** vendor公式、official repository `SECURITY.md`、WordPress.org maintainer記載、programme directory、検索結果の順で根拠を評価する。source URL / owner、validated final URL、retrievedAt、raw digest、parser version、checked scope、submission route、exclusivity / disclosure条件を固定する。`none-found`は確認sourceの範囲だけを意味する。route semantic digestは取得時刻に依存せずTargetへbindする。callerが自己申告したAssignment ref / route digestをauthorityにせず、公開resolverが返したcontent-boundなversioned Programme Assignment route bindingとcurrent Observationからstaleness projectionだけを作る。Human OS storage、Programme Assignment作成、外部送信を所有しない。Oracle FactまたはResearch eligibility判断を含めない。
- **Failure semantics:** Intelligence Source取得失敗は`acquisition-failed`、HTTPS origin allowlist外へのredirectは`untrusted-provenance`、strict source document不成立は`parse-failed`。first-partyとlower-precedence sourceの矛盾はfirst-party根拠を保持した`conflicting`として人間確認を要求する。resolver不在、未知ref、artifact integrity不一致は`assignment-binding-unverified`、検証済みbindingとObservationのTarget不一致は`binding-mismatch`。
- **Behavior Test:** [Disclosure Route](../tests/target-intelligence/disclosure-route.test.ts)
- **Status:** content-addressed observation、6分類、Ultimate Member型direct reward / GiveWP型delegated VDPのsanitized fixture、conflict / none-found / redirect / Oracle separation、選定・staging再取得、restart replayを実装。
- **Code:** [disclosure-route](../src/target-intelligence/disclosure-route)

### Target Research History

- **Purpose:** Plugin Identity、verified version、Canonical File Manifest digestでTargetを固定し、Campaignの選定、進行、terminal statusをappend-onlyに記録して重複Researchを制御する。
- **Interface:** `TargetResearchHistory.migrateLegacyArtifact / admit / record`
- **Invariants:** activeは既存Campaignへresumeし、Coverage Closedは通常のprospective選定を`already-covered`にする。Incomplete後のprospective再実行は元Campaignと理由codeを固定したfollow-upだけを許可する。同じplugin/versionの異なるManifest digestはprovenance conflict、新しいverified versionは別Targetにする。v2 writerはCampaign purposeと理由を列挙code、progressを意味を持つIDのないversioned content digestだけで受け付け、Oracle Factを自由記述として保存しない。v1 eventはversioned public migration artifactから取込み、読取専用でreplayし、自由記述をpublic projectionへ出さず、v2 eventを追記しない。Research Ledgerを参照せず、保存rowをruntime validationしてからpublic projectionをreplayする。
- **Failure semantics:** admission判断は`new / resume / already-covered / follow-up-required / provenance-conflict`。不正contract、保存row、Campaign binding、lifecycle順序、v1 / v2 writer混在、durable write failureだけをerrorにする。
- **Behavior Test:** [Target Research History](../tests/target-intelligence/target-research-history.test.ts)
- **Status:** Target Intelligence専用SQLite eventからCampaign viewをreplayする。v1 replay migration projectionとv2-only writeを実装。Development Cohort、calibration、意図的な独立反復はkind、run ordinal、理由を固定して許可する。
- **Code:** [research-history](../src/target-intelligence/research-history)

### Target Selection

- **Purpose:** Target Observation、Programme Eligibility、Disclosure Route、弱いVulnerability History Aggregate、Target Research Historyを一つのprogramme-neutral Candidate Poolとして評価し、有限のSelection Receipt集合を作る。
- **Interface:** `TargetSelection.select / migrateLegacyAttempt / resolveForApproval`、`TargetSelectionApprovalResolver`
- **Invariants:** provenance、取得可能性、Target identity、source freshness、Research Historyをdeterministic hard gateにする。operator nominationはApproval verification requestだけから受け付け、operator identity、時刻、列挙理由をCandidateへ固定し、他Candidateと同じhard gateを再評価してSelection-owned verification artifactへdurable receiptとして保存する。nomination-only Batchの親には空の自律Candidate集合、model resultなし、Receipt 0件のdurable Attemptだけを許す。自律Candidateがあるselected AttemptではReceiptが全Candidate IDを重複なく過不足なく覆い、各Receiptのversioned Candidate全体が対応するinput Candidateとcanonicalに一致する。ApprovalはAttemptのprivate storageを読まずresolverだけを使う。callerが渡したAttempt refはdurable Attemptのdigest、policy、profileへ一致し、各Receiptのselection key、revision、request digest、policy、profileは親Attemptへ完全一致しなければならない。v1 Attemptは公開migration seamで一度だけ取込み、自由記述をreason codeへ縮退した読取専用projectionにし、v2 writerと混在させない。Opus Model Profileへはactive installs、更新時刻、公開integration、粗いsource scale、Disclosure Route、diversityだけを渡す。Vulnerability History AggregateはAttempt / Receiptへbindするがmodel inputにせず、単独で採否を変えない。Research Value Bandを先に比較し、同BandでだけProgramme Opportunity Bandをtie-breakerに使い、vendor / family / use case / size / authority / integrationのversioned capで多様性を保つ。ReceiptはCampaignを開始しない。
- **Failure semantics:** provider failure、budget exhaustion、invalid model result、model実行前にdurable化したAttemptの中断は、空Batchではなく`selection-pending`として保持する。同じselection key / revisionの異なるinput、v1 / v2 writer混在、Attempt ref / policy / profile / Receipt integrityまたは親binding不一致、nomination-only Attemptへのmodel resultまたはReceipt混入、自律Candidate Receiptの欠落・余分・重複または同じIDでのCandidate事実差し替え、nomination operator / 時刻不一致、Plugin Identity・version・Manifest digestが一致するTarget identity重複はerrorにする。同じinputはmodelを再実行せずreplayし、明示的な新revisionだけを再選定する。
- **Behavior Test:** [Target Selection（nomination-only Attempt / Receipt completeness）](../tests/target-intelligence/target-selection.test.ts)、[Target Batch Approval（nomination handoff）](../tests/target-intelligence/target-batch-approval.test.ts)
- **Status:** v2 content-bound Attempt / Receipt、nomination-only Batch用のmodel-free empty Attempt、v1 read-only migration projection、Approval resolver、Opus-only profile、stable projection、hard gate、active resume / already-covered / Incomplete follow-up、Research-only保持、diversity、restart / failure replayを実装。
- **Code:** [target-selection](../src/target-intelligence/target-selection)

### Target Batch Approval

- **Purpose:** 一つのSelection Attemptの有限なSelection Receipt集合について、人間の承認、除外、順序変更、operator nominationを一回の判断へまとめ、versioned Approved Target Batchにする。
- **Interface:** `TargetBatchApproval.migrateLegacyBatch / approve / inspect`（`TargetSelectionApprovalResolver` portを要求）
- **Invariants:** Target Selectionが検証したdurable Attempt、Selection-owned verification ref / Receipt、Selection Policy、Opus Model Profile、Target Observation、programme / disclosure freshness、Campaign Policy、Batch Budget、execution window、human identity / decision time / 列挙理由を固定する。手動追加はApproval requestのnominationとしてだけ表現し、Selection resolverのhard gateとdurable receiptを必須にする。caller生成Receiptや名称変更をauthorityにしない。v1 Batchは公開migration seamで一度だけ取込み、自由記述を列挙codeへ縮退した読取専用projectionにし、v2 writerと混在させない。承認はResearch、Campaign、外部通信を開始しない。
- **Failure semantics:** resolverがdurable Attemptを検証できない場合は`selection-attempt-unverified`。resolver結果とAttempt / policy / profile binding、decision集合、approved orderの不一致を拒否する。hard gate不通過は人間でもoverrideできず、Batch Budget超過を拒否する。同じbatch key / revisionの異なるinputは`revision-conflict`、変更は開始前の新revision + `supersedes`だけを許可し、開始後は`execution-started`にする。
- **Behavior Test:** [Target Batch Approval](../tests/target-intelligence/target-batch-approval.test.ts)
- **Status:** v2 content-addressed Batch、v1 read-only migration projection、revision index、approval / exclusion / reorder / approval-time nomination、idempotency、restart replay、supersedeのBehavior Testを実装。
- **Code:** [target-batch-approval](../src/target-intelligence/target-batch-approval)

### Wordfence Vulnerability Intelligence

- **Purpose:** Wordfence Intelligence v3 Production Intelligence Sourceを不変snapshotとlocal indexへ変換し、Target選定用の弱いVulnerability History AggregateとFinding後専用のknown-record projectionを分離する。
- **Interface:** production compositionは`WordfenceIntelligenceRefresh.run / inspect`。`openSqliteHostPrivateCredentialBroker({ databasePath })`を`credentialBroker`へ渡すと、host-private SQLite brokerから実行できる。`363ac35` fixed-mainのlegacy local indexを一度だけ移行する場合だけversioned `legacyStorageAdoption`を明示する。既存の`WordfenceIntelligence.inspect / aggregate / inspectKnownRecords`はvalidなmodern production storeへread-onlyでattachでき、`refresh`はproduction ownershipを拒否する。local indexと`KnownRecordAccessAuthorizationProvider`も同じInterfaceを維持する。
- **Invariants:**
  - **Credentials and storage identity:** production compositionは固定SecretRef `wordfence-v3-api-key`だけをhost-private brokerへ渡し、Bearer値をbroker callback内の最終HTTP利用より外へ出さない。brokerはabsolute path、realなowner-only parent、owner / mode `0600`のregular DB / WAL / SHM、固定provider / purposeをread前に検証する。current owner UIDを確立できなければbroker readまたはproduction storageのchmod / openより前にfail closedする。
  - **Index and raw artifacts:** production indexはDatabase constructorより前にowner-only parentとDB / WAL / SHMを`O_NOFOLLOW`で検証し、open前後のdevice / inodeをcached instanceへbindする。新規storeと明示したfixed-main legacy adoptionだけがowner-controlled pathをsecure化できる。adoption対象はexactなsnapshots / records / currentの3 table、整合するcanonical rowsとcurrent、WAL、digest一致する既存local CASであり、全てをreadonly検証してからDB / sidecarを`0600`、CASを`0400`へsecure化して移行する。任意SQLite、branch中間schema、marker-only DBは変更しない。marker schema、order、allocator、state、Attemptのいずれかがproduction ownershipを示すstoreはmarker欠損時もlocal DDL、取得、CAS、current更新へ移らない。
  - **Storage format:** 新規production storeとverified legacy migrationはschema version、固定5分Attempt leaseを持つv1 production-storage marker、order `0/0`、allocator `0`を同じtransactionで作る。normal reopenと同一instanceの各`run / inspect`はmarker、全table、正当なimplicit index、schema metadata、order、allocatorをreadonlyで再検証し、未知のtable / index / view / triggerまたは欠落をrepairしない。cold initializationはcomposition内で一つのPromiseへ直列化する。別compositionのtransactional initializerが先にcommitしたexact singleton conflictだけは一度modern validationから開き直し、不完全なwinnerは`storage-failure`、その他のintegrity errorは元の意味を保つ。
  - **Snapshots and records:** complete responseのsource URL、取得時刻、raw digest、parser versionをsnapshotへ固定し、全recordとWordfence / MITRE attributionのvalidation後だけ保存する。v1 record-set manifestはsnapshot digest、normalized row count、全row key / canonical JSON digestを持ち、Plugin slug / record IDをenvelopeとSQLite keyの両方へbindする。current / staleは返却またはrefresh開始前にmanifestと全recordを再検証する。manifest導入前のrecord-only snapshotはv1 `unbound-read-only`としてexplicit historical legacy replayだけを許可する。
  - **Refresh state and ordering:** success publication、failure state、current bindingはSQLite immediate transactionで直列化し、`inspect`は一つのread snapshotから投影する。modern orderは`publication <= latest-completed <= allocated`を満たし、`latest-completed + 1`から`allocated`までの全sequenceをexactly one active Attemptが占める。latest-completedと同じactiveは拒否し、それより古いout-of-order activeは許可する。`latest-completed > publication`なら同じsequenceのv2 failure stateを必須とする。
  - **Completion projection:** 未完了Attemptが一つでもあればcurrent projectionは再起動後も`stale`になる。publication high-water以上のsuccessだけがcurrentを進め、古いlate successはhistoricalに残ってもcurrentや新しいfailureを変えない。publicationより新しい最新failureだけをcurrentへbindし、全active解消後はlatest-completedとpublicationの差で適用を決める。completion transactionと`run`は同時点および再起動後の`inspect`と同じversioned projectionを返す。
  - **Research boundary:** 現行feedのbounded identifierと分割version intervalをlosslessに正規化する。aggregateはplugin件数、公開年密度、最終公開時刻だけを返す。exact recordはverified Finding、Plugin Identity、verified version、Canonical File Manifest digest、固定purposeへbindしたv2 authorizationをproviderが解決した場合だけ返し、Human OS storageやcaller自己申告をauthorizationにしない。
- **Failure semantics:**
  - **Source and backoff:** HTTP status、network、byte ceiling、partial response、source mismatch、schema drift、attribution欠落、credential / storageをtyped failureにする。malformed UTF-8は`schema-drift`、Response前のfetch failureは`network-failure`、Response後のbody / length failureは`partial-response`とする。`Content-Encoding: identity`はcaseとOWSを正規化する。429だけが最大24時間に正規化したv2 backoffを返し、自動retryしない。
  - **Storage and integrity:** production SQLiteのopen / I/O / fd / memory / path failureとpointer-bound raw artifact欠落は`storage-failure`を返す。request、owner / mode / type / path / content、schema、CAS、manifest、row binding、refresh orderの不整合はintegrity failureをthrowし、healまたは別contentへrebindしない。cleanup / close failureは先行failureやthrowを保持し、primary operationが成功した場合だけ結果を置き換える。
  - **Recovery and freshness:** 最新failureはsnapshot digestへbindしてdurable化し、snapshotがなければ再起動後も元のfailure、currentがあれば`stale`とfailureを返す。production `run`はfetch前にAttemptを保存する。lease中のactive Attemptがあれば新しいrunは取得せずdurable stale projectionを返す。全active lease expiry後は一つのtransactionでorphanを`storage-failure`としてterminalizeして次Attemptを開始するため、途中失敗は全変更をrollbackする。各await後と永続化直前にindex identityを再検証し、displaced DBへ完了状態を書かない。
  - **Historical, local, and authorization:** 明示したhistorical `snapshotRef`はglobal freshnessを適用せず、固有snapshot / manifest / raw artifactを検証して返す。production-backed既存readは毎回modern marker / schema、index identity、current / refresh binding、manifest、raw digestをreadonly検証し、feedまたはcredentialを解決しない。mode `0400`はproduction CASだけに要求し、local CASはcontent一致するfixed-main regular file / mode `0644`をreplayできる。provider denialまたはauthorization subject不一致は`known-record-access-denied`にする。
- **Behavior Test:** [production refresh](../tests/target-intelligence/wordfence-intelligence-refresh.test.ts)、[owner identity fail-closed](../tests/target-intelligence/wordfence-owner-identity.test.ts)、[local index / oracle separation](../tests/target-intelligence/wordfence-intelligence.test.ts)
- **Status:** owner-only SQLite broker Adapterを使うproduction composition、versioned current / stale / failed result schema、bounded fetch / backoff、39,455-record private cacheで確認したparser compatibility、sanitized structural fixture、atomic Store / replay、affected-version interval query、oracle-separated aggregateを実装。private cacheのexact recordはGit fixtureへ複製しない。
- **Code:** [wordfence-intelligence](../src/target-intelligence/wordfence-intelligence)

### WordPress.org Target Source

- **Purpose:** official plugin slugから不変なTarget Observationを作り、観測したstable versionのarchive原本を既存Target Intakeへ安全に渡す。
- **Interface:** `WordPressOrgTargetSource.observe / acquire`
- **Invariants:** Plugin Identityは`wporg:<slug>`とし、表示名、stable version、active installations、last updated、download provenance、取得時刻をmetadata digestとparser versionへ固定する。acquireは観測済みversionとMain Plugin File headerを照合し、archive bytesをcontent digestで不変化する。CVE、advisory、known vulnerable range、known routeをObservationまたはPacketへ保存しない。同じofficial bytesは取得時刻やrestartにかかわらず同じCanonical File ManifestとTarget Intake Packetへ収束する。
- **Failure semantics:** metadata / archiveの404、rate limit、network failure、quota超過、invalid metadata、要求version不一致、metadata / archive不一致をtyped failureにする。ZIPのpath traversal、link、multiple plugin root、integrity不正、quota超過はTarget Intake公開前に`rejected`、Main Plugin Fileの不足・曖昧性は既存Intakeの`deferred`にする。別versionまたは別sourceへsilent fallbackしない。
- **Behavior Test:** [WordPress.org Target Source](../tests/target-intelligence/wordpress-org-target-source.test.ts)
- **Status:** bounded production fetch Adapter、sanitized fixture Adapterによるoffline Behavior Test、Deflate / Store ZIPの安全な展開、Acquisition Original保存、restart replayを実装。
- **Code:** [acquisition](../src/target-intelligence/acquisition)

### Target Intake

- **Purpose:** untrustedなarchiveまたはdirectoryを、oracle-freeなTarget Intake Packetへ変換する。
- **Interface:** `TargetIntake.intake(request) -> ready | deferred | rejected`
- **Invariants:** identityとversionを照合し、sourceを実行せず、artifactをdurableにしてから`ready`を返す。同じrequestは同じ結果へ収束する。
- **Failure semantics:** policy outcomeは`deferred / rejected`、durable化できないsystem failureだけをerrorにする。
- **Behavior Test:** [Target Intake](../tests/target-intelligence/local-directory-target-intake.test.ts)、[Campaign handoff](../tests/research/target-intake-campaign-handoff.test.ts)
- **Status:** local directoryとWordPress.org archive、manifest、quota / path / link検査、Campaign handoffを実装。premium archive acquisitionは未実装。
- **Code:** [acquisition](../src/target-intelligence/acquisition)、[handoff](../src/research/campaign-control/target-intake-campaign-handoff.ts)

### Target Campaign Dispatch

- **Purpose:** Approved Target Batchから実行直前のfreshnessとTarget Intakeを確認し、複数CampaignをResearchへdispatchする。
- **Interface:** accepted `TargetCampaignDispatch.run / inspect`
- **Invariants:** 待機Queueとactive Campaignを分け、versionやsourceをsilentに差し替えない。Target固有failureで次Targetを失わせず、承認だけではCampaignを開始しない。
- **Failure semantics:** systemic failureはcircuit breaker、budget / execution window到達は破棄せずpauseにする。
- **Behavior Test:** 未実装（[#113](https://github.com/momoponwork1415-lgtm/wordpress-harness/issues/113)）
- **Status:** 未実装。Target SelectionとTarget Batch Approvalはそれぞれの公開Seamで実装済み。

## Research

Context外の入口は`openResearch`。Researchは六Moduleで構成する。

### Campaign Control

**Interface:** `CampaignRunner.prepare / prepareFromTargetIntake / run`、`CampaignReader.inspect`（`{ kind: "budget", runId }`を含む）

- **Purpose:** fixed Targetをfinite Wave、Independent Validation、source-validated Finding / Coverage terminalまで進める。
- **Invariants:** PlanへTarget、Manifest、policy、profile、tool、budgetを固定する。artifactをCASへ置き、Ledger eventを記録してから次stageへ進む。
- **Normal Wave policy:** current v7は3 Finder、target-specific thesisは最大2、whole-target wildcard thesisは最低1。`maxConcurrentFinders = 4`はschema上のhard ceilingとして維持する。legacy 4-Finder Plan / Ledgerはread-only replayする。
- **Attacker scope:** current Campaignは未認証、Subscriber、subscriber-equivalent custom role（`customer`を含む）だけを許可する。Contributor以上と`unresolved`はcheckpoint、Root Evaluation、Validation admission、Finding projectionでfail closedにする。legacy enumとLedgerはreplay互換を維持する。
- **Budget admission:** v7 PlanはSemantic Policy、全roleのmodel profile、prompt、source tool policy、Finder knowledge、Validation policy / baseline / public surface / exclusionをdigest固定してrun前に照合する。run startはRoot Evaluation用100,000 exploration tokenをFinder admission前にreserveし、initial Root Attemptだけがatomicにclaimできる。通常のAttemptはPlan最大使用量のreservationとintentを一transaction、terminal completionとreported usageのsettlementを一transactionで記録する。
- **Budget enforcement:** ExplorationとValidationのtoken、wall time、provider costをowner partitionでadmitし、Explorationのreported overshootでValidation reserveを減らさない。providerが返すtoken / turnはreported postconditionとしてovershootを残し、owner / Campaign remainingを0未満にしない。
- **Attempt observability:** ValidatorもCampaign Attempt Ledgerへstart / result-stored / completionを記録する。completion前の再起動ではidentityとCASを検証して同じresultを再利用する。
- **Failure semantics:** policy / profile / prompt / reservation ownerまたはclaim identityの不一致と、reservationを欠くv7 replayはfail closedにする。budget exhaustionをnegativeまたはCoverage Closureへ丸めず、Explorationは`Incomplete`、Validationは`validation-pending`にする。
- **Behavior Test:** [v7 public run / budget / binding / restart](../tests/research/campaign-validation-run.test.ts)、[v7 contract](../tests/research/semantic-recall-budget.test.ts)、[legacy replay](../tests/research/ledger-compatibility.test.ts)。
- **Status:** v7 initial Wave、durable Root Evaluation reservation、single Validation、conditional Depth、Finding / Coverage terminal、terminal replay、progressを実装。v6とlegacy Ledgerは元の意味でread-only replayする。Missing-link / Closureは未接続。
- **Code:** [campaign-control](../src/research/campaign-control)、[open-research](../src/research/open-research.ts)。

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
- **Invariants:** normal Waveは2個以下のtarget-specific Finderと1個以上のwhole-target wildcard Finderを独立して保つ。明示的overrideでも4 Finderを超えない。file / CWE / 手順を固定せず、支持数や多数決でcandidateを捨てない。
- **Attacker invariant:** provider outputはcurrent scopeへ絞り、Root Evaluationはscope外subjectを`close`以外へ処遇できない。Depth Synthesisとfresh Root Evaluationもscope外premiseをrejectする。
- **Checkpoint:** subjectをTarget、Manifest、Attempt、Leaseへbindし、CAS / Ledgerへ保存してからackする。
- **Depth:** fresh tool-free Synthesis、source-enabled Critic、Root Evaluation、Missing-link Waveを分離する。Familyごと最大3 evidence generation、Campaign全体最大12 Wave。
- **Closure:** 最後のmaterial evidence後に二回連続のcomplete no-material-deltaを要求し、後者はfresh reviewを含む。
- **Failures:** invalid evaluation、budget exhaustion、active Family、unscheduled Gapを`Incomplete`として残す。
- **Status:** v7 initial Wave / Decision@3 / conditional Depthを実装。Missing-link / Closureはlegacy pathのみ。
- **Code / Tests:** [exploration](../src/research/exploration) · [planning](../tests/research/semantic-root-planning.test.ts), [evaluation](../tests/research/semantic-root-evaluation.test.ts), [Depth](../tests/research/semantic-depth-work-queue.test.ts), [E2E](../tests/research/campaign-semantic-e2e.test.ts)

### Validation

**Interface:** `Validation.validate(plan) -> ValidationRecordRef`

- **Purpose:** Root-evaluated candidateをfreshなsource reviewで反証し、通過したtechnical claimをimmutable Findingにする。
- **Current implementation:** exact Candidate identityはTarget、Manifest、premise、property、ordered route、anchor、Causal Identityで作る。一つのfresh Validatorから`source-validated / needs-research / disproven / validation-pending`を決定的に投影し、二つ目・第三AttemptとValidation Synthesisを起動しない。
- **Attacker invariant:** Validator起動前にCandidateとThreat Contextをcurrent scopeへ照合し、scope外ならmodel tokenを使わない。Finding projectionはCandidateとValidationだけを再照合し、Causal Identityを含むCandidate identityから投影する。
- **Finding:** `source-validated`だけがTarget Snapshot、Causal Identity、attacker premise、broken security property、source route / evidence、counterevidence、Validation refを固定したFindingをCASへ保存する。Finding identityはexact Candidate duplicateから決定し、Coverage状態を入力にしない。
- **Boundary:** runtime / human verificationを所有しない。`needs-research`は具体的Gapとして同じFamilyへ戻し、`disproven`はsource contradictionだけ、provider / budget failureは`validation-pending`として残す。
- **Legacy Packet:** Runtime Verification Packet v2、Risk Assessment、Human Review Packet v1は元のartifactとLedger eventをread-only replayし、新Findingへ自動変換しない。
- **Status:** single fresh Attempt、durable intent / result recovery、4 Disposition、Finding / Coverage terminalをv7へ接続。multi-Attempt / Synthesisと旧Packet writerはlegacy replayに限定する。
- **Code / Tests:** [attacker scope](../src/research/current-research-attacker-scope.ts), [validation](../src/research/validation), [candidate admission](../src/research/campaign-control/validation-candidate-admission.ts) · [scope](../tests/research/current-research-attacker-scope.test.ts), [Validation](../tests/research/validation.test.ts), [Finding / Coverage](../tests/research/campaign-validation-run.test.ts), [legacy Runtime Packet](../tests/research/runtime-verification-packet.test.ts), [legacy Packet](../tests/research/human-review-packet.test.ts)

### Model Execution

**Interface:** `ModelExecution.run(plan, observer?) -> AttemptExecutionResult`

- **Purpose:** immutable Attempt Planをprovider-neutral resultへ変換し、process、tool、credentialを隠す。
- **Invariants:** official transportだけを使い、model / effortを固定する。role間でsession、conversation、scratchを共有しない。
- **Tools:** manifest-bound read-only source toolだけを許可する。Finder checkpointはdurable write後にackする。Synthesis / Riskはtool-free。
- **Recovery:** transient failureだけを同じAttemptと残budgetでresumeする。Recoveryの正本はLedger、CAS、checkpoint。
- **Failures:** provider、auth、policy、invalid output、budget、cancelを区別する。observer / private transcript failureはoutcomeを変えない。
- **Status:** Claude Adapter、usage、Receipt、resume、private transcriptを実装。複数Campaign横断のOpus capacityは未実装（[#114](https://github.com/momoponwork1415-lgtm/wordpress-harness/issues/114)）。
- **Code / Tests:** [model-execution](../src/research/model-execution) · [execution](../tests/research/model-execution.test.ts), [bridge](../tests/research/claude-source-evidence-bridge.test.ts)

### Research Record

- **Purpose:** immutable CAS artifact、append-only Ledger event、checkpoint、replay projectionを所有するInternal Module。
- **Interface:** current writeはprivate `CurrentCampaignStore`、全世代のread-only replayは`LegacyResearchReplay`。context外はpublic `CampaignRunner / CampaignReader`だけを使う。
- **Invariants:** artifactを保存してから参照eventをappendする。Attempt reservation / intentとcompletion / settlementはそれぞれ一transactionでappendする。v7 Root Evaluation reservationはrun startとatomicにappendし、initial Root Attemptのreservation / intent / claimを一transactionでappendする。Campaign budget projectionはprotected reservationを含めてLedgerから再構築する。cacheを削除しても同じview digestを再構築する。
- **Failure semantics:** event順序、artifact digest、Plan binding、reservation owner、claim identityの不一致はreplayまたはwrite admissionでfail closedにする。partial transactionを公開せず、unknown usageは保守的にreservation全量をchargeする。
- **Behavior Test:** [current public behavior](../tests/research/campaign-validation-run.test.ts)、[legacy compatibility](../tests/research/ledger-compatibility.test.ts)。
- **Status:** current writeをlegacy `ResearchRecord`から分離し、Finding / Coverageを持つCampaign Run Record v4だけを新規作成する。v1 / v2、Packetを持つv3、旧Runtime Packet eventは既存Ledgerのread-only replayだけを許可する。v7 Root Evaluation reservation、single Validation、Finding / Coverage terminal、Campaign budget、progress replayを実装。
- **Code:** [current store](../src/research/research-record/current-campaign-store.ts)、[legacy replay](../src/research/research-record/legacy-research-replay.ts)。

## Human OS

### AI Reproduction

**Interface:** `AIReproduction.deliver(RuntimeVerificationPacketDeliveryRequest)`、`AIReproduction.run(Packet + Target source + Runtime Profile + Setup Plan + Policy) -> runtime-confirmed | runtime-inconclusive | setup-blocked | execution-failed`

- **Purpose:** fresh environmentと実Target interfaceでsource routeを試し、人間が再実行できるRecipeとevidenceを作る。
- **Owned artifacts:** shareableなIntake、typed Attempt、sanitized Result、Triage Reproduction PacketはHuman OS RecordへCAS-firstで保存する。exact Reproduction RecipeとPrivate Evidence Bundleは専用private storeへ保存し、shareable artifactにはopaque refだけを残す。
- **Invariants:** AttemptへTarget/version、Manifest、attacker premise、Security Effect、source route、Runtime Profile、Setup Plan、no-ambient-tool policyをbindする。SQLi、XSS等のclassはRecipeのcriterionに使うが、固定Adapter対応をadmission条件にしない。exact payload、request、screenshot、runtime logはPrivate Evidence Bundleへ置く。AI outputはFinding、Human disposition、programme eligibilityを作らない。
- **Failures:** unsupported mechanism、setup、provider、budget failureをRejectedへ丸めない。runtime-confirmedだけがTriage Reproduction Packetを作る。
- **Status / Tests:** v2 contract、idempotent intake / execution record、class別・generic Recipe、private file store、Triage gateを実装。Harness seamはfresh gVisor identity、cleanup、harness-mediated browser / HTTP / runtime observation attestationを要求する · [code](../src/human-os/ai-reproduction.ts), [contracts](../src/human-os/ai-reproduction-contracts.ts), [behavior](../tests/human-os/ai-reproduction.test.ts) · [#108](https://github.com/momoponwork1415-lgtm/wordpress-harness/issues/108)
- **Accepted next:** Findingを直接受け取り、runtime outcomeをappend-only Verification Recordとして返す。Triage Packet current writerは移行後にlegacy replayへ閉じる（[#126](https://github.com/momoponwork1415-lgtm/wordpress-harness/issues/126)）。

### Human Verification Environment

**Interface:** `HumanVerificationEnvironmentBuilder.establish -> ready | setup-blocked`

- **Purpose:** Packetと一致するTargetをfresh disposable environmentへ構築する。
- **Invariants:** requestへPacket、Target、Runtime Profile、declarative Setup Plan、Policy、grantをdigest固定する。target codeをhost上で実行せず、privileged container、host network、engine socket、ambient credential、許可外egressを使わない。Setup Receipt、gate observation、effective config、Target/runtime identityをCAS-firstで保存した後だけ`ready`を公開する。
- **Failure semantics:** isolation不足、setup、activation、health failureは`setup-blocked`として保持する。partial environmentはcleanupし、plain Dockerまたはhost executionへfallbackしない。同じrequest digestは保存済みDispositionをreplayする。
- **Status / Tests:** Builder、versioned contract、Human OS Record、Packet-bound sourceを実runsc WordPress sessionへ構築するgVisor provisionerを実装。Researchのlegacy Assistantとはsession lifecycleだけを共有する · [builder](../src/human-os/human-verification-environment.ts), [provisioner](../src/human-os/gvisor-wordpress-environment-provisioner.ts), [isolation infrastructure](../src/infrastructure/gvisor-wordpress-session.ts) · [contract tests](../tests/human-os/human-verification-environment.test.ts), [gVisor adapter](../tests/human-os/gvisor-wordpress-environment-provisioner.test.ts)

### Human Verification

**Interface:** `CurrentHumanReviewRunner.admit`、`prepare`、`record`、`readQueue`

- **Purpose:** Triage Reproduction Packetを人間がAIと別のfresh instanceで必ず再実行し、Findingまたは理由付きnegativeまで閉じる。
- **Queue:** runtime-confirmedを通常Queue、policy指定のhigh-impact runtime-inconclusiveを人間選択のEscalation Queueへ置く。総件数を制限せずactive concurrencyだけを設定し、完了後はimpact、attacker premise、Recipe cost、Case IDのstable priorityで繰り上げる。
- **Preparation:** 人間の直前にCurrent Version Reviewを実行する。新stableは同じCampaign、plugin、Causal Identity、Security Effect、attacker premiseにbindされた新しいruntime-confirmed Attemptだけを選べる。Human environmentは選択Target、Runtime Profile、Setup Planと一致し、AI environmentとは異なるfresh IDを要求する。
- **Failure semantics:** 前提一致かつRecipe完走後のeffect非観測だけを`rejected`にする。環境不一致は`blocked`、曖昧な観測は`runtime-inconclusive`、不足証拠は`more-evidence-required`。
- **Finding gate:** 全Recipe stepとexact payloadの人間によるfresh再実行を記録した`verified-finding`だけがFindingを生成する。Findingは元Campaign Target、検証Target、Triage Packet、Recipe / Private Evidence refs、人間のRecordへbindする。external actionは`not-authorized`であり、report、vendor contact、公開は別承認を必要とする。
- **Status / Tests:** v2 append-only Case stream、二車線Queue、promotion、version refresh、fresh environment gate、Disposition、Finding、reopen replayを実装 · [runner](../src/human-os/current-human-review.ts), [contracts](../src/human-os/current-human-review-contracts.ts), [behavior](../tests/human-os/current-human-review.test.ts) · [#110](https://github.com/momoponwork1415-lgtm/wordpress-harness/issues/110)
- **Accepted next:** Human VerificationはFinding生成gateではなく`human-confirmed / disproved / inconclusive / blocked` Verification Recordを追加する。exact Draft revisionとdestinationに対するExternal Action Authorizationだけがform staging / submitを許可する（[#126](https://github.com/momoponwork1415-lgtm/wordpress-harness/issues/126)）。

### Understanding and submission preparation

**Accepted Interface:** `VulnerabilityUnderstanding.explain`、`SubmissionDraft.prepare`、`SubmissionDraftReview.revise / approve`、`SubmissionStager.stage`

- **Purpose:** 人間のfresh再実行をAIのgroundedな説明で支援し、Findingからtemplate reportを作り、人間が外部行動を承認したrevisionだけをformへ入力する。
- **Invariants:** confirmed fact、human observation、AI inference、plausible abuse scenarioを分離する。理解支援はHuman Verificationを代替せず、Draft生成はSubmitを意味しない。
- **Status:** 未実装。[#117](https://github.com/momoponwork1415-lgtm/wordpress-harness/issues/117) -> [#97](https://github.com/momoponwork1415-lgtm/wordpress-harness/issues/97) -> [#118](https://github.com/momoponwork1415-lgtm/wordpress-harness/issues/118) -> [#103](https://github.com/momoponwork1415-lgtm/wordpress-harness/issues/103) / [#104](https://github.com/momoponwork1415-lgtm/wordpress-harness/issues/104)。

### Legacy Verification

ADR 0122以前のHuman Review Packet v1、Human Verification、Findingを元の意味でread/replayする互換境界。ADR 0124移行後はRuntime Verification Packet v2、Triage Reproduction Packet、human-only Findingも同じくread-only replayへ閉じる。現行Human OS contextは`openLegacyHumanVerificationReplay`だけを公開し、v1 writerを公開しない。[replay](../src/human-os/legacy-human-verification-replay.ts)

- 旧Findingを`ready-for-runtime`や現行Findingへ自動変換しない。
- gVisor Lab、Witness、Causal Control、固定mechanism Adapterはlegacy replayと参考実装に限定する。
- **Status / Tests:** replay compatibility実装済み · [code](../src/research/verification), [tests](../tests/research/verification.test.ts), [gVisor](../tests/research/gvisor-account-takeover-lab.test.ts)

## Adapters and runtime policy

- CLIは`prepare / inspect`だけを持つthin adapter。[code](../src/cli.ts) · [tests](../tests/cli/campaign-cli.test.ts)
- current policyは`semantic-research-recall-baseline-v7`。Campaign token ceilingは4,600,000、Explorationは4,200,000、その内100,000をinitial Root Evaluationへdurableにreserveし、Validation 400,000へ再配分しない。
- current Campaign ceilingは12 Wave、USD 150、12 hours、Validation reserveはUSD 30。provider cost ceiling、Opus profile、prompt / policy、oracle exclusion、no-fallbackはv6から変更しない。これらをSchema literalからversioned baseline defaultへ移す作業は[#111](https://github.com/momoponwork1415-lgtm/wordpress-harness/issues/111)で扱う。
- v1 Map-firstとv5 Verificationはread/replay互換として残す。
- ceiling到達はnegativeではなくtyped IncompleteまたはPending。

## Change path

1. この文書でowner、Interface、source、Behavior Testを特定する。
2. public behaviorをTestから観測する。
3. hard-to-reverseな理由が必要な時だけ`docs/adr/`を読む。
4. 次の有限workと受入条件はGitHub Issueで確認する。

Schema field、private helper、provider argv、内部call順はこのGuideへ複製しない。
