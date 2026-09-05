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
| Source-only Validation | v6 single fresh Attemptと4 dispositionを実装済み | Frontier Gapの次Wave |
| Runtime handoff | Runtime Verification Packet v2とAI Reproduction intakeを実装済み | 実Targetでのhandoff実測 |
| AI Reproduction | typed attempt、class別・generic Recipe、private evidence、Triage Packetを実装済み | 実Targetでのruntime実測 |
| Human Verification | mandatory fresh再実行、二車線Queue、Current Version Review、human-only Finding gateを実装済み | 実Targetでの再現実測 |
| Finding | Human Verification gateとknown-pluginでの成立を実測済み | Prospective Campaignでの成立実測 |
| Understanding / report | 設計とIssue分割まで完了 | grounded explanation、template draft、人間承認、form staging |

現在のproduction sliceは`Target Intake -> initial Semantic Wave -> Decision@3 / Approach Family -> conditional Depth / single source Validation -> Risk Assessment / Runtime Verification Packet -> AI Reproduction / Triage Reproduction Packet -> mandatory fresh Human reproduction -> Finding`である。Human OSのv1 Human Review Packet flowはread-only replay境界に残す。v6 Depthはtool-free Synthesis、Manifest-bound Critic、fresh Root EvaluationをCAS / Ledger境界で分離する。Packet delivery failureはPacketを保持したままResearch failureと分ける。Missing-link / Closureはlegacy v5に実装済みだがv6へ未接続。

手動Target IntakeからFindingまでのflowをversioned contractとpublic seamで接続済みである。次に実plugin一件を早期に完走し、その実測後にCoverage policy、Development Cohort、三件のProspectiveへ広げる。Target Intelligence内の自律選定とBatch承認は実装済みだが、Approved Target BatchからTarget Acquisition / Researchへのdispatchは未接続であり、完成度をpercentでは表さない。

残作業の実行順と完了条件は[Issue #86](https://github.com/momoponwork1415-lgtm/wordpress-harness/issues/86)を正本とする。

| Order | Work |
| --- | --- |
| 1 | [#106 current write Interface](https://github.com/momoponwork1415-lgtm/wordpress-harness/issues/106)（完了） |
| 2 | [#107 single Source Validation / Runtime Packet](https://github.com/momoponwork1415-lgtm/wordpress-harness/issues/107) -> [#108 AI Reproduction / Triage Packet](https://github.com/momoponwork1415-lgtm/wordpress-harness/issues/108)（完了） |
| 3 | [#110 mandatory Human reproduction](https://github.com/momoponwork1415-lgtm/wordpress-harness/issues/110)（完了） |
| 4 | [#115 Validation crash recovery](https://github.com/momoponwork1415-lgtm/wordpress-harness/issues/115)、[#116 Campaign remaining budget](https://github.com/momoponwork1415-lgtm/wordpress-harness/issues/116)（完了） -> [#109 実plugin一件](https://github.com/momoponwork1415-lgtm/wordpress-harness/issues/109) |
| 5 | [#81 Validation Gap loop](https://github.com/momoponwork1415-lgtm/wordpress-harness/issues/81)、[#82 Coverage policy](https://github.com/momoponwork1415-lgtm/wordpress-harness/issues/82)、[#33 Development Cohort](https://github.com/momoponwork1415-lgtm/wordpress-harness/issues/33) |
| 6 | [#89 Target Intelligence / unattended operation](https://github.com/momoponwork1415-lgtm/wordpress-harness/issues/89)、[#111 measured budget defaults](https://github.com/momoponwork1415-lgtm/wordpress-harness/issues/111)、[#32 三件pilot](https://github.com/momoponwork1415-lgtm/wordpress-harness/issues/32) |

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
- **Invariants:** provenance、取得可能性、Target identity、source freshness、Research Historyをdeterministic hard gateにする。operator nominationはApproval verification requestだけから受け付け、operator identity、時刻、列挙理由をCandidateへ固定し、他Candidateと同じhard gateを再評価してSelection-owned verification artifactへdurable receiptとして保存する。ApprovalはAttemptのprivate storageを読まずresolverだけを使う。callerが渡したAttempt refはdurable Attemptのdigest、policy、profileへ一致し、各Receiptのselection key、revision、request digest、policy、profileは親Attemptへ完全一致しなければならない。v1 Attemptは公開migration seamで一度だけ取込み、自由記述をreason codeへ縮退した読取専用projectionにし、v2 writerと混在させない。Opus Model Profileへはactive installs、更新時刻、公開integration、粗いsource scale、Disclosure Route、diversityだけを渡す。Vulnerability History AggregateはAttempt / Receiptへbindするがmodel inputにせず、単独で採否を変えない。Research Value Bandを先に比較し、同BandでだけProgramme Opportunity Bandをtie-breakerに使い、vendor / family / use case / size / authority / integrationのversioned capで多様性を保つ。ReceiptはCampaignを開始しない。
- **Failure semantics:** provider failure、budget exhaustion、invalid model result、model実行前にdurable化したAttemptの中断は、空Batchではなく`selection-pending`として保持する。同じselection key / revisionの異なるinput、v1 / v2 writer混在、Attempt ref / policy / profile / Receipt integrityまたは親binding不一致、nomination operator / 時刻不一致、Plugin Identity・version・Manifest digestが一致するTarget identity重複はerrorにする。同じinputはmodelを再実行せずreplayし、明示的な新revisionだけを再選定する。
- **Behavior Test:** [Target Selection](../tests/target-intelligence/target-selection.test.ts)
- **Status:** v2 content-bound Attempt / Receipt、v1 read-only migration projection、Approval resolver、Opus-only profile、stable projection、hard gate、active resume / already-covered / Incomplete follow-up、Research-only保持、diversity、restart / failure replayを実装。
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
- **Interface:** production compositionは`WordfenceIntelligenceRefresh.run / inspect`。`openSqliteHostPrivateCredentialBroker({ databasePath })`を`credentialBroker`へ渡すと、host-private SQLite brokerから実行できる。local indexは既存の`WordfenceIntelligence.refresh / inspect / aggregate / inspectKnownRecords`と`KnownRecordAccessAuthorizationProvider`を維持する。
- **Invariants:** production compositionは固定SecretRef `wordfence-v3-api-key`をhost-private credential brokerへ渡し、broker callback内の最終HTTP利用より外へBearer値を出さない。SQLite broker Adapterはabsolute path、realなowner-only parent directory、owner / mode `0600`のregularなDB / WAL / SHM、固定provider / purposeを要求し、全pathをDB read前に検証してreadonly queryで最終利用時だけ値を解決する。production indexはDatabase constructorより前にrealなowner-only parentと既存DB / WAL / SHMを`O_NOFOLLOW`で検証し、current ownerのregular fileだけを`0600`へsecureする。open前後のindex directoryと既存fileのdevice / inodeを照合し、接続後のDB / WAL / SHM identityをcached instanceへbindする。production `run / inspect`は毎回、index identityとraw CAS directoryのowner、mode、file type、real pathをcredential解決またはDB readより前に再検証し、permission driftまたはsecure-lookingなpath replacementを修復せず拒否する。complete response、source URL、取得時刻、raw response digest、parser versionをsnapshotへ固定し、全recordとWordfence / MITRE attributionのvalidation成功後だけcontent-addressed raw snapshotを保存する。raw CAS directoryはabsolute、real、owner-onlyとし、operation開始時のdevice / inodeをfile descriptorへpinする。raw snapshotはそのdescriptor配下の同期済みowned tempからatomic no-clobber installし、pathが同じdirectoryを指すことを書込み前後に再検証する。勝者finalは`O_NOFOLLOW`のfile descriptorからcurrent owner、regular file、mode `0400`、全bytesを検証し、tempを削除してpinned parent directoryをfsyncしてからSQLite参照をcommitする。新規snapshotはsnapshot digest、normalized row count、全row key / canonical JSONのdigestを持つv1 record-set manifestと、Plugin slug / record IDをJSON envelopeとSQLite keyの両方へbindしたrowを同じtransactionで保存する。software identifierはUnicode scalarだけを許可し、publication、再publication、projectionの全digest pathはSQLite collationへ依存せず一つのJS comparatorでvalidation後に整列する。aggregate / exact projectionと既存digest再publicationは全record setをmanifestへ照合してから進める。manifest導入前のrecord-only snapshotはv1 `unbound-read-only` markerへ一度だけ分類し、新しいintegrityを遡及主張せずread-only replayだけを許す。production successのsnapshot / current pointer更新とfreshness failure clear、およびproduction failureのcurrent snapshot binding / failure upsertは同じSQLite immediate transaction policyで直列化する。`inspect`はcurrent pointer、snapshot、freshness markerを一つのSQLite read snapshotから投影する。現行feedのboundedなsoftware identifierと、同一record / pluginに分割されたversion intervalをlosslessに正規化する。production refreshの最新失敗はsnapshot digestへbindして同じSQLite indexに保存し、再起動後の`inspect`もcached snapshotを`stale`とlatest failureの組で返す。local indexのlegacy replayは従来の`current` projectionを維持する。選定projectionはplugin単位の件数、公開年密度、最終公開時刻だけを返し、CVE、CWE、CVSS、affected / patched versionを含めない。exact recordはverified Finding、Plugin Identity、verified version、Canonical File Manifest digest、`known-duplicate-disposition` purposeへbindしたv2 authorizationを公開providerが`authorized`として解決できる場合だけ返す。caller自己申告のFinding refまたはartifactをauthorizationにせず、Human OS storageを参照しない。refresh結果はruntime検査するversioned `WordfenceIntelligenceResult` unionである。
- **Failure semantics:** 401 / 403、404、429、network failure、response byte ceiling、206 / `Content-Range` / byte-length mismatchを含むpartial response、redirect / source mismatch、schema drift、copyright / license metadata欠落、credential / storage failureを個別のtyped failureにする。production SQLiteのopen / I/O / file descriptor / memory / path availability（database pathがdirectoryの`EISDIR`を含む）は`run / inspect`から`storage-failure`を返し、request、stored artifact、schema conflict、CAS conflict、manifest / row key / content不一致等のintegrity failureはthrowする。publication directory fdのclose failureは、先行するfailureまたはthrowを保持し、成功相当の結果だけを`storage-failure`へ置き換える。`rate-limited`だけがbounded backoffを必須とし、他reasonではbackoffを禁止する。429は自動retryせず、`Retry-After`のdelay / absolute timeを取得時刻から最大24時間へ正規化したv2 backoff metadataとして返す。初回を含む最新failureはdurableに保存し、snapshotがなければ再起動後の`inspect`から元のfailureを返す。失敗refreshは既存current pointerを変更せず、失敗結果をcached snapshotのfresh成功へ丸めない。provider不在 / denial、authorization integrity不一致、Plugin Identity / version / Manifest digest不一致は`known-record-access-denied`にする。
- **Behavior Test:** [production refresh](../tests/target-intelligence/wordfence-intelligence-refresh.test.ts)、[local index / oracle separation](../tests/target-intelligence/wordfence-intelligence.test.ts)
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

- **Purpose:** fixed Targetをfinite Wave、Validation、Runtime Verification Packet handoffまで進める。
- **Invariants:** PlanへTarget、Manifest、policy、profile、tool、budgetを固定する。artifactをCASへ置き、Ledger eventを記録してから次stageへ進む。
- **Normal Wave policy:** current defaultは3 Finder、target-specific thesisは最大2、whole-target wildcard thesisは最低1。`maxConcurrentFinders = 4`はhard ceilingと明示的overrideとして維持し、`maxFinderAttempts`とCampaign全体budgetは増やさない。legacy 4-Finder Plan / Ledgerはread-only replayする。
- **Attacker scope:** current Campaignは未認証、Subscriber、subscriber-equivalent custom role（`customer`を含む）だけを許可する。Contributor以上と`unresolved`はcheckpoint、Root Evaluation、Validation admission、Runtime handoffでfail closedにする。legacy enumとLedgerはreplay互換を維持する。
- **Budget admission:** initial Wave、Depth、Validationの全Model Attemptは、一つのCampaign budgetとExploration / Validation owner budgetを共有する。Attempt Planの最大使用量をLedgerへreserveしてから、同じSQLite transactionでAttempt intentを記録する。terminal completionとreported usageのsettlementも同じtransactionへ置き、restart時は未settle reservation、既知usage、unknown usageの保守的chargeを一回だけreplayする。
- **Budget enforcement:** model Attempt数、wall time、provider costは次のprovider request前のadmissionで止める。providerが返すtoken / turnをgeneration前のhard ceilingにはできないため、reported postconditionとしてovershootを記録し、以後のadmissionを止める。turn、structured output、source usageはCampaign集計へ含めるが、現行policyにCampaign-wide limitはない。
- **Attempt observability:** ValidatorもCampaign Attempt Ledgerへstart / result-stored / completionを記録する。terminal resultはCAS保存後にresult-storedを追記し、completion前の再起動ではidentityとCASを検証して同じresultを再利用する。active progressとreported token / costはFinder、Root role、Critic、Validatorを同じAttempt projectionから一回だけ集計する。
- **Failures:** integrity不正は起動前に拒否する。provider送信後にresultを確認できないValidator Attemptは再送せず`validation-pending`へ保ち、exactly-once executionは主張しない。保存resultのCASまたはidentity不一致は再利用しない。unknown usageはreservation全量を消費したものとして残し、budget exhaustionを`disproven`、`rejected`、`no-material-delta`、`coverage-closed`へ丸めず、Explorationは`Incomplete`、Validationは`validation-pending`にする。
- **Status:** v6 initial Wave、single Validation、conditional Depth、Campaign-wide durable budget admission / settlement、Validator crash recovery、Runtime Verification Packet v2 handoff、Human OS intake、terminal replay、progressを実装。Missing-link / Closureは未接続。
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
- **Invariants:** normal Waveは2個以下のtarget-specific Finderと1個以上のwhole-target wildcard Finderを独立して保つ。明示的overrideでも4 Finderを超えない。file / CWE / 手順を固定せず、支持数や多数決でcandidateを捨てない。
- **Attacker invariant:** provider outputはcurrent scopeへ絞り、Root Evaluationはscope外subjectを`close`以外へ処遇できない。Depth Synthesisとfresh Root Evaluationもscope外premiseをrejectする。
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
- **Attacker invariant:** Validator起動前にCandidateとThreat Contextをcurrent scopeへ照合し、scope外ならmodel tokenを使わない。Runtime Packet準備でも独立に`attacker-out-of-scope`として止める。
- **Runtime handoff:** `ready-for-runtime`からsingle Validation、bind済みCandidate、Risk、source route / control / counterevidence、runtime sketchを自己完結のRuntime Verification Packet v2へ投影する。明白なsource contradictionだけを止め、Researchは`rejected`を作らない。[#107](https://github.com/momoponwork1415-lgtm/wordpress-harness/issues/107)
- **Boundary:** Findingやruntime reproductionを所有しない。`needs-research`は具体的Gapとして同じFamilyへ戻す。
- **Risk / Packet:** Riskはsingle Validationとbind済みCandidateから追加model judgeなしで投影する。exact payloadとraw requestをResearchへ保存せず、delivery failureでもPacketを失わない。
- **Status:** single fresh Attempt、durable intent / result recovery、Disposition、Risk / Runtime Packetをv6へ接続。multi-Attempt / Synthesis / Human Review Packet v1は元の意味でlegacy replayする。
- **Code / Tests:** [attacker scope](../src/research/current-research-attacker-scope.ts), [validation](../src/research/validation), [candidate admission](../src/research/campaign-control/validation-candidate-admission.ts) · [scope](../tests/research/current-research-attacker-scope.test.ts), [Validation](../tests/research/validation.test.ts), [Runtime Packet](../tests/research/runtime-verification-packet.test.ts), [legacy Packet](../tests/research/human-review-packet.test.ts), [v6 handoff / usage](../tests/research/campaign-validation-run.test.ts)

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

Internal Module。immutable CAS artifact、append-only Ledger event、checkpoint、replay projectionを所有する。

- **Interface:** current writeはprivate `CurrentCampaignStore`、全世代のread-only replayは`LegacyResearchReplay`。SQLiteとpublic `CampaignRunner / CampaignReader`は維持する。
- artifactを保存してから参照eventをappendする。
- current v3のAttempt reservation / intentとcompletion / settlementはそれぞれ一つのtransactionでappendし、Campaign budget projectionはrun / stage / candidateをまたいで同じCampaignのLedgerから再構築する。
- cacheを削除しても同じLedgerから同じview digestを再構築できる。
- semantic identity、priority、Family groupingはowner Moduleが決める。
- **Status / Tests:** current v3 writeをlegacy `ResearchRecord`から分離し、v1 / v2は既存Ledgerのreplayだけをproductionで許可する。Decision@3、Family、single Validation、Frontier Gap、Depth Queue / Synthesis / Critique / Evaluation、Runtime Packet handoff、Campaign budget、progress replayを実装 · [current store](../src/research/research-record/current-campaign-store.ts), [legacy replay](../src/research/research-record/legacy-research-replay.ts), [v3 behavior](../tests/research/campaign-validation-run.test.ts), [compatibility](../tests/research/ledger-compatibility.test.ts)

## Human OS

### AI Reproduction

**Interface:** `AIReproduction.deliver(RuntimeVerificationPacketDeliveryRequest)`、`AIReproduction.run(Packet + Target source + Runtime Profile + Setup Plan + Policy) -> runtime-confirmed | runtime-inconclusive | setup-blocked | execution-failed`

- **Purpose:** fresh environmentと実Target interfaceでsource routeを試し、人間が再実行できるRecipeとevidenceを作る。
- **Owned artifacts:** shareableなIntake、typed Attempt、sanitized Result、Triage Reproduction PacketはHuman OS RecordへCAS-firstで保存する。exact Reproduction RecipeとPrivate Evidence Bundleは専用private storeへ保存し、shareable artifactにはopaque refだけを残す。
- **Invariants:** AttemptへTarget/version、Manifest、attacker premise、Security Effect、source route、Runtime Profile、Setup Plan、no-ambient-tool policyをbindする。SQLi、XSS等のclassはRecipeのcriterionに使うが、固定Adapter対応をadmission条件にしない。exact payload、request、screenshot、runtime logはPrivate Evidence Bundleへ置く。AI outputはFinding、Human disposition、programme eligibilityを作らない。
- **Failures:** unsupported mechanism、setup、provider、budget failureをRejectedへ丸めない。runtime-confirmedだけがTriage Reproduction Packetを作る。
- **Status / Tests:** v2 contract、idempotent intake / execution record、class別・generic Recipe、private file store、Triage gateを実装。Harness seamはfresh gVisor identity、cleanup、harness-mediated browser / HTTP / runtime observation attestationを要求する · [code](../src/human-os/ai-reproduction.ts), [contracts](../src/human-os/ai-reproduction-contracts.ts), [behavior](../tests/human-os/ai-reproduction.test.ts) · [#108](https://github.com/momoponwork1415-lgtm/wordpress-harness/issues/108)

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

### Understanding and submission preparation

**Accepted Interface:** `VulnerabilityUnderstanding.explain`、`SubmissionDraft.prepare`、`SubmissionDraftReview.revise / approve`、`SubmissionStager.stage`

- **Purpose:** 人間のfresh再実行をAIのgroundedな説明で支援し、verified Findingからtemplate reportを作り、人間がPoCとDescriptionを承認したrevisionだけをformへ入力する。
- **Invariants:** confirmed fact、human observation、AI inference、plausible abuse scenarioを分離する。理解支援はHuman Verificationを代替せず、Draft承認はSubmitを意味しない。
- **Status:** 未実装。[#117](https://github.com/momoponwork1415-lgtm/wordpress-harness/issues/117) -> [#97](https://github.com/momoponwork1415-lgtm/wordpress-harness/issues/97) -> [#118](https://github.com/momoponwork1415-lgtm/wordpress-harness/issues/118) -> [#103](https://github.com/momoponwork1415-lgtm/wordpress-harness/issues/103) / [#104](https://github.com/momoponwork1415-lgtm/wordpress-harness/issues/104)。

### Legacy Verification

ADR 0122以前のHuman Review Packet v1、Human Verification、Findingを元の意味でread/replayする互換境界。現行Human OS contextは`openLegacyHumanVerificationReplay`だけを公開し、v1 writerを公開しない。[replay](../src/human-os/legacy-human-verification-replay.ts)

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
