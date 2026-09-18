# Codebase Guide

**変更したいことから担当Moduleを選び、必要な節だけ読む。** 各節にはInterface、所有する記録、不変条件、失敗時の扱い、sourceとBehavior Testを置く。正確なfield・定数はリンク先のcode、設計方針は[Research Design](RESEARCH-DESIGN.md)が正本。

## どこまでコードを読むか

最初から全ファイルを追う必要はない。下の表で読み終える地点を決め、次の索引で担当Moduleへ進む。

| 目的 | 読む範囲・読み終える地点 |
| --- | --- |
| 全体の役割を理解する | [Architecture](ARCHITECTURE.md)と下のModule索引まで |
| Moduleを使う・仕様を確認する | その節のInterface・不変条件・失敗時の扱いと、該当する成功・失敗のBehavior Test。入力、結果、失敗時に呼び出し側がすべきことを説明できれば止める |
| 振る舞いを変更する | 該当する公開methodから、変更する判断を所有するImplementationまで。関係しないAdapterや保存helperは追わない |
| 外部接続や保存の障害を調べる | 失敗分類から担当Adapterまたは保存処理へ進む。そこで前提と失敗条件を確認する |

Interfaceとテストだけでは使い方が分からず内部を横断する必要があるなら、Interfaceの説明不足か責務の漏れを疑う。実装が長いことだけでは、呼び出し側にとって複雑とは限らない。

## Moduleを選ぶ

| 変更したいこと | Owner | Module |
| --- | --- | --- |
| sourceを取得して固定する | Target Intelligence | [Target acquisition](#target-acquisition) |
| 更新の観測を保存する | Target Intelligence | [WordPress.org Update Frontier](#wordpressorg-update-frontier) |
| 候補集合を定義・組立する | Target Intelligence | [Candidate Pools](#candidate-pools) |
| Programmeと公開情報を観測する | Target Intelligence | [Target observations](#target-observations) |
| 既探索pluginとversionを照合する | Target Intelligence | [Target Research History](#target-research-history) |
| AIによるTarget提案を記録する | Target Intelligence | [Target Proposals](#target-proposals) |
| 人間の対象承認を記録する | Target Intelligence | [Approved Target Batches](#approved-target-batches) |
| 承認済みTargetをResearchへ渡す | Target Intelligence | [Approved Target Campaigns](#approved-target-campaigns) |
| Campaignの判断点と記録を扱う | Research | [Research Campaigns](#research-campaigns) |
| providerと隔離実行を接続する | Research | [gVisor Native Agent Runtimes](#gvisor-native-agent-runtimes) |
| Candidateを動的検証しscopeと提出承認を扱う | Human OS | [Human OS](#human-os) |
| コマンドと実行依存を接続する | Composition root | [CLI](#cli) |
| 独立Research Trialを保存済み記録から比較する | Operations | [Independent Research Trial Comparison](#independent-research-trial-comparison) |
| Agentへ渡る入力の所在を確認する | Research / Runtime Adapter | [Agent input](#agent-input) |
| 共通のJSON・source digestを調べる | Infrastructure | [Shared infrastructure](#shared-infrastructure) |

## Current capability

`implemented`はdeterministic Behavior Testで観測できる意味。実providerや未知Targetでの効果を証明する意味ではない。実測は[Knowledge](knowledge/)に置く。

skillが必要なModuleを呼び、データを取得して手順を進める使い方を認める。専用CLI・定期起動・自動handoffがないことだけを実装不足としない。確認すべきなのは、必要なデータを公開Interfaceから取得・保存できるかである。

| 範囲 | 利用できる機能 | データの供給・保存上の制約 |
| --- | --- | --- |
| Target供給 | local / WordPress.org acquisition、Update Frontier → Candidate Pool、Programme / disclosure observations | 候補集合の組立には呼び出し側がSelection Contextを渡す。同種の既知脆弱性の履歴照会は未実装 |
| 履歴・提案・承認 | 保存済みplugin/version履歴の照会、AI Proposal、Approved Batch、単一Campaignへのdispatch | 調査履歴は読み取り専用。現行Campaignの実績を追加する入口はない |
| Research | Grant、両Human Review、Checkpoint再開、Candidate Verification Request / Coverage記録 | `inspect`でRequestとrecipe準備不足を取得できる。領域間のCampaign Coverage Receipt形式への変換は未実装 |
| Native Runtime | Grok / Claude / GLM / Codex / DeepSeek HarnessのResearch Adapter、固定runtime binding、private recipe materialization | 実providerでのCandidateとrecipeの品質は別途評価が必要 |
| Human OS | Candidate-bound dynamic verification、Verified Vulnerability、programme scope、提出草案と承認の記録・照会 | 呼び出し側がsource・Lab・private recipe store・全programmeを列挙するscope evaluatorを供給する。外部送信は行わない |
| Trial比較 | exact Campaign集合のbinding照合、planned / model-completed / incomplete、Candidate / Assessment provenance、usage / cost、Verification / programme scopeのread-only projection | CampaignとCandidate Verificationの保存済みviewを呼び出し側が供給する。比較からResearch、Review、Verification、外部行動は起動しない |

外部送信と複数Targetの中央schedulerは意図的に持たない。次の有限workと受入条件は[GitHub Issues](https://github.com/momoponwork1415-lgtm/wordpress-harness/issues)を参照する。

各Moduleの節を開くと、sourceとBehavior Testへ進める。

## Target acquisition

<details>
<summary>Target Intelligence — sourceを取得して固定する</summary>

- **目的:** sourceを実行せず、identity、version、provenance、canonical manifestを固定する。
- **Interface:** `TargetIntake.intake`、`WordPressOrgTargetSource.observe / acquire`。
- **所有する記録・不変条件:** Target Intake PacketとSnapshot。archiveの不正path・symlink・重複・size超過を拒否し、起動前検査と同じcanonical digestを使う。
- **失敗時:** acquisition・identity・provenance・archive policy failureをready packetにしない。

**Source / Behavior Test:** [`src/target-intelligence/acquisition`](../src/target-intelligence/acquisition) · [`local-directory-target-intake.test.ts`](../tests/target-intelligence/local-directory-target-intake.test.ts) · [`wordpress-org-target-source.test.ts`](../tests/target-intelligence/wordpress-org-target-source.test.ts)

</details>

## WordPress.org Update Frontier

<details>
<summary>Target Intelligence — 更新の観測を保存する</summary>

- **目的:** 有限のWordPress.org SVN revision windowをTarget選定用の観測へ変換する。
- **Interface:** `WordPressOrgUpdateFrontiers.refresh / inspect`、`WordPressOrgChangesetSource.retrieve`。
- **所有する記録・不変条件:** private SVN evidence、cursor、metadata、digest-bound Frontier。更新量とhigh-level signalだけを後段へ渡し、exact path・source・advisoryを渡さない。signalが空でもpolicy適合のPHP変更を残す。
- **失敗時:** command・timeout・byte ceiling・parse・binding failureを空Frontierにしない。metadata欠損はunresolved observation、同じrevisionへの異なるinputはconflict。

**Source / Behavior Test:** [`update-frontier`](../src/target-intelligence/update-frontier) · [`wordpress-org-update-frontier.test.ts`](../tests/target-intelligence/wordpress-org-update-frontier.test.ts)

</details>

## Candidate Pools

<details>
<summary>Target Intelligence — 候補集合を定義して組み立てる</summary>

- **目的:** 対象候補と候補集合の定義を所有し、Update FrontierからCandidate Poolを作る。
- **Interface:** `defineTargetCandidatePool`、`isCurrentTargetCandidate`、`WordPressOrgUpdateCandidatePools.assemble / inspect`。定義の正本は[`candidate-pool/contracts.ts`](../src/target-intelligence/candidate-pool/contracts.ts)。提案・承認も同じ定義と鮮度判定を使う。
- **所有する記録・不変条件:** 内容をハッシュで固定したCandidate Pool、private Assembly Recordとunresolved gap。同一versionのsourceを再取得し、Intake・Observation・Selection Contextのbindingとfreshnessを検査する。Frontier外のContextやprivate SVN詳細を後段へ渡さない。
- **失敗時:** missing・stale・acquisition failureをgapとして残す。有効Candidateがなければ`assembly-pending`。inputやartifactの不一致は拒否する。

**Source / Behavior Test:** [`candidate-pool`](../src/target-intelligence/candidate-pool) · [`wordpress-org-update-candidate-pools.test.ts`](../tests/target-intelligence/wordpress-org-update-candidate-pools.test.ts) · [`target-proposals.test.ts`](../tests/target-intelligence/target-proposals.test.ts)

</details>

## Target observations

<details>
<summary>Target Intelligence — Programmeと公開情報を観測する</summary>

- **目的:** Programme eligibility、disclosure route、Wordfenceの公開観測を固定する。
- **Interface:** `ProgrammeIntelligence.refresh / inspect`、`DisclosureRoute.observe / inspect`、Wordfenceのinspection / refresh Interface。
- **所有する記録・不変条件:** 取得時刻とfreshnessを持つSnapshot。credentialはhost-private brokerに閉じる。既知脆弱性の詳細へのアクセスとoracle-freeな選定情報を分離する。
- **失敗時:** unavailable・stale・conflicting・unknownをeligibleにしない。

報告先のModuleは`observe / inspect`で観測の保存と照会を所有する。呼び出し側は取得Adapterと保存先を設定し、観測要求または保存済み参照を渡す。取得失敗・不正な資料・許可外の出所は`DisclosureRouteError`で区別し、保存済み観測と参照の不一致は拒否する。保存形式と`routeDigest`の意味は維持し、観測時刻だけの変化と報告先の内容の変化を区別する。

制度情報は対象条件・機会の目安・出所・鮮度を保持し、報奨金の見積もり用データと月次統計は持たない。制度情報Snapshotと両Programme Adapterの入力文書はv2だけを受け付け、非対応の保存形式は`ZodError`、入力文書は`parse-failed`として拒否する。旧Snapshotが必要なら再取得し、既存ファイルを上書きしない。

Wordfenceの必要資料は制度・規約・報告フォームの3種類。Patchstackは規則・報告フォーム・mVDP directory・制度紹介の4種類で、順位と内容を照合する。報奨金表・増額キャンペーン・月次報告・順位表を必須取得にしない。契約は[Wordfence](../tests/target-intelligence/wordfence-programme-adapter.test.ts)・[Patchstack](../tests/target-intelligence/patchstack-programme-adapter.test.ts)のBehavior Testで確認する。

Wordfenceを使うときは[`contracts.ts`](../src/target-intelligence/wordfence-intelligence/contracts.ts)の`WordfenceIntelligence`と`WordfenceIntelligenceRefresh`まで読む。内部を変更するときだけ次へ進む。

現行実装はfeed全体を保存し、プラグイン単位の件数・公開時期を集計する。対象プラグインに限定した保存と、同種の脆弱性の過去報告を確認する分類別の履歴照会は未実装。`inspectKnownRecords`は検証済みFindingの重複確認用で、承認と対象versionへの該当を要求するため、過去全versionの履歴照会には相当しない。

| 変更する責務 | Implementation |
| --- | --- |
| HTTP取得・credential解決・応答上限・Retry-After | [`fetch-adapter.ts`](../src/target-intelligence/wordfence-intelligence/fetch-adapter.ts) |
| feedの検査・正規化・記録の順序・version照合 | [`plugin-records.ts`](../src/target-intelligence/wordfence-intelligence/plugin-records.ts) |
| 現行の保存形式・schema検査・新規初期化 | [`storage-format.ts`](../src/target-intelligence/wordfence-intelligence/storage-format.ts) |
| 保存先の所有者・権限・ファイル同一性の検査、raw artifact保存 | [`host-private-storage.ts`](../src/target-intelligence/wordfence-intelligence/host-private-storage.ts) |
| SQLite接続・Snapshot保存と公開・更新順序・照会 | [`snapshot-store.ts`](../src/target-intelligence/wordfence-intelligence/snapshot-store.ts) |
| 取得と保存の組立・アクセス認可・公開Interface | [`wordfence-intelligence.ts`](../src/target-intelligence/wordfence-intelligence/wordfence-intelligence.ts) |

内部の`WordfenceSnapshotStore`がDB接続と更新状態を所有し、Snapshot公開と更新順序の判定を同じトランザクション内で行う。公開Interfaceから使う際にSQLや保存状態を知る必要はない。保存形式は現行の一種類だけを受け付け、記録集合の件数とハッシュを必須にする。旧形式の読み取り・自動移行・取り込み設定は持たない。非対応形式は`SnapshotConflictError`で拒否し、記録や権限を修復しない。既存データの移行が必要な場合は、通常実行の外でバックアップと照合を行う。

**Source / Behavior Test:** [Programme](../src/target-intelligence/programme-intelligence/index.ts)・[Disclosure Route](../src/target-intelligence/disclosure-route/index.ts)・[Wordfence](../src/target-intelligence/wordfence-intelligence/index.ts) · [`programme-intelligence.test.ts`](../tests/target-intelligence/programme-intelligence.test.ts) · [`wordfence-intelligence.test.ts`](../tests/target-intelligence/wordfence-intelligence.test.ts) · [`disclosure-route.test.ts`](../tests/target-intelligence/disclosure-route.test.ts)

Wordfenceのproduction storage、認証、途中で切れた応答、並行更新は[`wordfence-intelligence-refresh.test.ts`](../tests/target-intelligence/wordfence-intelligence-refresh.test.ts)で確認する。

</details>

## Target Research History

<details>
<summary>Target Intelligence — 既探索pluginとversionを照合する</summary>

- **目的:** 保存済みのplugin identityとversionの履歴を読み、同じ版と別の版の調査実績を照合する。
- **Interface:** `TargetResearchHistories.inspect`。旧workspaceの取り込みとSnapshot生成は持たない。
- **所有する記録・不変条件:** `.private/target-intelligence/research-history`のimmutable Snapshotを読み取る。同じ版の有無と別の版の一覧を返す。source identity、Finding、結果、CVE、claim等は保持しない。
- **失敗時:** 欠落・非対応schema・digest不一致を拒否する。欠損を未探索にせず、既存Snapshotを書き換えない。

**Source / Behavior Test:** [`research-history`](../src/target-intelligence/research-history) · [`research-history.test.ts`](../tests/target-intelligence/research-history.test.ts)

</details>

## Target Proposals

<details>
<summary>Target Intelligence — AIによるTarget提案を記録する</summary>

- **目的:** oracle-freeなCandidate PoolからTarget・理由・不確実性の提案を得る。
- **Interface:** `TargetProposals.propose / inspect`、`resolveTargetProposal(view, reference)`、`TargetProposalAgent.execute`。
- **所有する記録・不変条件:** file-backed Selection Run、Native Receipt、Proposal。`resolveTargetProposal`が記録と参照を照合し、承認側へProposalと元のCandidate Poolを返す。承認側はSelection Runの内部を検査しない。pool外・取得不能・identity未確認・staleなTargetを選べない。固定rankやreason codeを要求しない。
- **失敗時:** provider・Budget・policy・invalid outputは`selection-pending`。同じrevisionへの異なるinputはconflict。提案記録の照合は`unavailable / conflict / resolved`を区別する。

**Source / Behavior Test:** [`target-proposal`](../src/target-intelligence/target-proposal) · [`target-proposals.test.ts`](../tests/target-intelligence/target-proposals.test.ts) · [`grok-target-proposal-agent.test.ts`](../tests/target-intelligence/grok-target-proposal-agent.test.ts)

</details>

## Approved Target Batches

<details>
<summary>Target Intelligence — 人間の対象承認を記録する</summary>

- **目的:** 対象範囲・順序・Budget・execution windowの人間承認を固定する。
- **Interface:** `ApprovedTargetBatches.approve / inspect / admitDispatch`、`approvedTargetBatchReference`。承認側と受け渡し側は同じ入口でBatchの参照を作る。
- **所有する記録・不変条件:** digest-bound Approved Target Batch。候補集合外のTargetを追加せず、dispatch直前にidentity・version・manifestを再確認する。
- **失敗時:** expired window・stale source・identity mismatchをdispatch許可にしない。

**Source / Behavior Test:** [`approved-target-batch`](../src/target-intelligence/approved-target-batch) · [`target-proposals.test.ts`](../tests/target-intelligence/target-proposals.test.ts)

</details>

## Approved Target Campaigns

<details>
<summary>Target Intelligence — 承認済みTargetをResearchへ渡す</summary>

- **目的:** Batchの一Targetをadmitし、ResearchへCampaign Inputを渡す。
- **Interface:** `ApprovedTargetCampaigns.conduct`。
- **所有する記録・不変条件:** 新しいQueue・Ledgerは持たない。Batch・fresh observation・Intake・Policy・Target・Dependency・Threat Context・Programme Boundaryを照合する。WordPress coreはexactly one、Dependency mountとContextのroleは一対一。oracleや選定専用のeligibilityをResearchへ複製しない。
- **失敗時:** approval・freshness・source closure・digest不一致ではResearchを開始しない。同じCampaignの再開はResearchの契約へ委ねる。

**Source / Behavior Test:** [`approved-target-campaign`](../src/target-intelligence/approved-target-campaign) · [`approved-target-campaigns.test.ts`](../tests/target-intelligence/approved-target-campaigns.test.ts) · [`campaign-threat-context.test.ts`](../tests/research/campaign-threat-context.test.ts)

</details>

## Research Campaigns

<details>
<summary>Research — Campaignの判断点と検証handoffを扱う</summary>

- **目的:** Research、両Human Review、Candidate Verification Request、Coverageと再開を一つのModuleに隠す。
- **Interface:** `ResearchCampaigns.conduct / inspect`。versioned handoffは[`research/index.ts`](../src/research/index.ts)、入力とcommandのfieldは[`contracts.ts`](../src/research/agent-led/contracts.ts)。
- **所有する記録・不変条件:** SQLiteのappend-only Campaign eventsとprivate Checkpoint / Diagnostic / Candidate Recipeへのopaque ref。Campaign outcome view v3はprovider呼び出し前にexact Sealed Native RunへbindしたNative Run Attemptを公開し、private Receipt artifactのatomic確定後だけterminal eventを記録する。Research Report v2はGrant内のexamined / unexamined領域を示すsource-backed evidence summary、Grant-localなResearch Assessmentと、ordered source trace・control assessment・未解決事実を持つCandidateを記録する。completed Native Run Receiptと、その結果をCampaignへ採用できないResearch Admission Failureは別eventとして同じtransactionで記録する。最大1時間のGrant、exact bindingの両Human Review、Parked Programme LeadのCandidate Review除外、admitされたCandidateだけのRequest生成、Research Coverageとの分離を維持する。evidence summaryやAssessmentをwork queue、探索完了またはCoverage proofにせず、Candidate VerificationへCheckpointやProgramme Boundaryを渡さない。run数とwall timeがhard limit、provider costは観測値。
- **失敗時:** review待ちはrunを開始しない。異なるinput、stale/partial reviewはatomic conflict。started eventだけが残ったattemptは`orphaned`かつCampaign `incomplete`として再構築し、自動再実行しない。同じrun、runtime profile、Receipt digestへ一致するprivate artifactだけをterminal eventとして回復し、欠落・破損・binding不一致ならorphanedのままにする。provider・Budget・policy・invalid outputは`incomplete`として残す。completed runのCandidate / Parked Programme Lead identity conflictまたはProgramme Boundary違反ではReceipt、report、Checkpoint、usageを改変せず、digest-boundな`admissionFailure`で`incomplete`にし、そのrunだけをCandidate / Lead集約から除外する。自動retryやCandidate promotionは行わない。Researchの有効Checkpointによるresumeと実行前availability / 未認証の一度のretryを区別する。source / Checkpoint integrity failureはretry不可。admit済みCandidateにrecipeがなければRequestを捏造せず`verification-preparation-needed`にする。

入力例は[`campaign-threat-context.test.ts`](../tests/research/campaign-threat-context.test.ts)。入力の組立箇所は[Agent input](#agent-input)へ進む。

**Source / Behavior Test:** [`research-campaigns.ts`](../src/research/agent-led/research-campaigns.ts) · [`native-run-receipts.ts`](../src/research/agent-led/native-run-receipts.ts) · [`research-campaigns.test.ts`](../tests/research/research-campaigns.test.ts) · [`human-research-continuation-review.test.ts`](../tests/research/human-research-continuation-review.test.ts) · [`candidate-verification-handoff.test.ts`](../tests/research/candidate-verification-handoff.test.ts) · [`parked-programme-leads.test.ts`](../tests/research/parked-programme-leads.test.ts) · [`agent-led-campaign-cli.test.ts`](../tests/cli/agent-led-campaign-cli.test.ts)

</details>

## Private Research Artifact Store

<details>
<summary>Shared infrastructure — private artifactのfilesystem規律を共有する</summary>

- **目的:** Checkpoint、Agent Run Diagnostic、Native Run Receipt、Candidate Recipeの異なるdomain意味を保ったまま、private filesystemの保存・解決規則を一つのdeep Moduleへ隠す。
- **Interface:** infrastructureの`PrivateArtifactStore.stage / commit / resolve / readFile / inspectOrphans`。domain間handoffは既存のCheckpoint、Diagnostic、Receipt、Recipe refだけを使い、このstoreのmanifestやpathを渡さない。
- **所有する記録・不変条件:** artifactごとの`manifest.json`とboundedなcanonical content tree。stagingはstore root内、promotionは同一filesystem上のrename、root・manifest・contentはno-follow、regular-file、hard-link、path collision、entry / byte ceilingを検査する。Domain Adapterは既存refのdigest、byte count、run / Candidate bindingを引き続き所有する。
- **失敗時:** missing、integrity mismatch、size limit、unsafe pathをtyped resolutionとして返し、invalid identity、unsafe staging / rootはtyped error、同じidentityへの異なるcontentはconflictにする。orphaned stagingはread-onlyに列挙し、自動repair、削除、garbage collectionを行わない。unsafeなCheckpoint stateをDiagnosticへ取り込めない場合も、redacted process evidenceだけを`statePreserved: false`で保存する。

**Source / Behavior Test:** [`private-artifact-store.ts`](../src/infrastructure/private-artifact-store.ts) · [`private-artifact-store.test.ts`](../tests/infrastructure/private-artifact-store.test.ts) · [`research-checkpoints.ts`](../src/research/agent-led/research-checkpoints.ts) · [`agent-run-diagnostics.ts`](../src/research/agent-led/agent-run-diagnostics.ts) · [`native-run-receipts.ts`](../src/research/agent-led/native-run-receipts.ts) · [`provider-research-report.ts`](../src/research/agent-led/provider-research-report.ts)

</details>

## gVisor Native Agent Runtimes

<details>
<summary>Research — providerと隔離実行を接続する</summary>

- **目的:** provider-nativeな実行・session・subagentを隔離し、bindingとReceiptを扱う。
- **Interface:** `NativeAgentRuntime.execute`。Grok、Claude Code、GLM、Codex、DeepSeek Harnessのtransport Adapterを持つ。`Agent Runtime Profile`はversioned schemaとcentral catalogで定義する。
- **所有する記録・不変条件:** Agent Runtime Profileはtransport kind、exact model / effort、executable version、sandbox image digest、prompt / report protocolを自己digestへbindする。compositionはtransport kindだけでAdapterを選び、catalogが未対応の組合せをprovider起動前に拒否する。Adapterはnative command、opaqueなprovider session identifier、provider outputとfailure変換を所有し、model catalogを重複して持たない。shared Private Research Artifact Store上のprivate provider home / Checkpoint、Diagnostic、content-addressed Candidate Recipeを使う。exact image / CLI、non-root、read-only source、writeable scratch、Root込み最大4 active agentsを要求する。ambient権限やprovider fallbackを与えない。provider report内のrecipe本文はprivate storeへ移し、公開Research Reportにはdigest-bound参照だけを残す。
- **DeepSeek Harness transport:** `deepseek-harness-native/v1`はofficial DSH `0.1.6-alpha.2`のheadless profileを使い、`deepseek-flash / max`、Chat Completions、NDJSON outputを固定する。DSHがmodel loop、session resumeとnative subagentを所有し、Harnessはtrusted overlayでdynamic settings、Web、telemetry、one-shot fork / workflowを止め、continuable childを最大3体に制限する。gVisorの`/tmp`は`noexec`のまま維持し、DSHのnative cacheを止めてpinned image内のbindingを直接loadする。image recipeと全transitive integrityは[`containers/deepseek-harness-agent`](../containers/deepseek-harness-agent/)に置き、repository rootから`docker build --pull=false --provenance=false --tag wordpress-harness-deepseek-agent:0.1.6-alpha.2 containers/deepseek-harness-agent`でprofile固定digestを再現する。
- **Credential egress:** raw API keyを必要とするDeepSeek transportは`ProviderCredentialEgressBroker.withGrant`の内側でだけ実行する。CLIはhost-privateな`<provider-config>/deepseek-api-key`を読むBrokerを構成する。Brokerはrunごとのinternal network上にpinned `runsc` sidecarを作り、Agentへscoped endpointだけを渡す。raw keyはsidecarだけへ一時mountし、fixed DeepSeek upstream、exact model / protocol、deadlineとrequest / byte ceilingを強制する。self-digesting grant receiptはDeepSeekのNative Run Receiptへ含め、setup、cleanupとinternal-network isolationをCampaign recordに残す。Agentをprovider-facing networkへ接続せず、理由は[ADR 0142](adr/0142-route-provider-credentials-through-a-bounded-egress-broker.md)に置く。
- **失敗時:** availability・binding・policy・provider・schemaの失敗をtyped receiptへ変換する。timeoutは`budget-exhausted`、対応するaccount envelopeは`provider-unauthenticated` / `provider-quota-exhausted`。元の分類・usageをcleanupで失わず、拒否したoutputもprivate Diagnosticへ保存する。Diagnostic保存不能は`provider-failed`。診断用stateはresumeに使わない。

通常は[`NativeAgentRuntime.execute`](../src/research/agent-led/contracts.ts)、[`Agent Runtime Profile catalog`](../src/infrastructure/agent-runtime-profile.ts)と対象providerのBehavior Testまで読む。`grok`・`claude-code`・`codex`というファイル名は、固有のCLI設定・応答変換を所有するAdapterを示す。同じtransportへmodelを追加する変更はcatalogだけで行い、transport semanticsが変わる場合だけAdapterを変更する。model bindingはproviderがReceiptで返すcanonical modelと一致させるため、Claudeの可変な`opus` aliasではなくcatalogでadmitしたexact model（現在は`claude-opus-5`）をCLIへそのまま渡す。理由は[ADR 0141](adr/0141-separate-model-profiles-from-native-transport-adapters.md)を参照する。

内部を変更するときは、次の担当へ進む。外部のInterfaceは`NativeAgentRuntime.execute`のままとする。

| 変更する責務 | Implementation |
| --- | --- |
| model / effortのadmission、transport capability、profile digest | [`agent-runtime-profile.ts`](../src/infrastructure/agent-runtime-profile.ts) |
| 隔離起動・実行終了・失敗分類の組立 | [`gvisor-agent-sandbox.ts`](../src/research/agent-led/gvisor-agent-sandbox.ts) |
| 認証ファイルの検査・コピー・削除・ログ秘匿 | [`ProviderCredentialFiles.copyTo / removeFrom / redact`](../src/research/agent-led/provider-files.ts) |
| raw API keyをAgent外に保つDeepSeek egress grant | [`ProviderCredentialEgressBroker.withGrant`](../src/infrastructure/deepseek-credential-egress-broker.ts) |
| Checkpointの照合・作業用コピー・確定 | [`prepareResearchState / finalizeResearchState`](../src/research/agent-led/research-checkpoints.ts) |
| 非公開Diagnosticの保存 | [`preserveAgentRunDiagnostic`](../src/research/agent-led/agent-run-diagnostics.ts) |
| Candidate Recipe本文の検査・非公開保存 | [`materializeResearchReport`](../src/research/agent-led/provider-research-report.ts) |
| Agent入力の組立 | [Agent input](#agent-input) |

認証情報を削除できない状態はCheckpointや診断用stateへ保存しない。削除後もログ秘匿を使える。契約は[`provider-files.test.ts`](../tests/research/provider-files.test.ts)、再開・診断・Runtimeとの接続は下記AdapterのBehavior Testsで確認する。

認証障害を調べる場合は、認証Moduleと各Adapterのmount設定を読む。この実装だけで障害の原因は確定しない。隔離を要求する理由は[ADR 0063](adr/0063-separate-the-orchestrator-agent-and-target-trust-zones.md)を参照する。

**Source / Behavior Test:** [`agent-runtime-profile.ts`](../src/infrastructure/agent-runtime-profile.ts) · [`gvisor-agent-sandbox.ts`](../src/research/agent-led/gvisor-agent-sandbox.ts) · [`provider-private-credential.ts`](../src/infrastructure/provider-private-credential.ts) · [`deepseek-credential-egress-broker.ts`](../src/infrastructure/deepseek-credential-egress-broker.ts) · [`deepseek-credential-proxy.ts`](../src/infrastructure/deepseek-credential-proxy.ts) · [`provider-research-report.ts`](../src/research/agent-led/provider-research-report.ts) · [`prompted-json-report.ts`](../src/research/agent-led/prompted-json-report.ts) · [`grok-native-agent-runtime.ts`](../src/research/agent-led/grok-native-agent-runtime.ts) · [`claude-code-native-agent-runtime.ts`](../src/research/agent-led/claude-code-native-agent-runtime.ts) · [`codex-native-agent-runtime.ts`](../src/research/agent-led/codex-native-agent-runtime.ts) · [`deepseek-harness-native-agent-runtime.ts`](../src/research/agent-led/deepseek-harness-native-agent-runtime.ts) · [`codex-source-reader.ts`](../src/research/agent-led/codex-source-reader.ts) · [`agent-runtime-profile.test.ts`](../tests/infrastructure/agent-runtime-profile.test.ts) · [`deepseek-credential-egress-broker.test.ts`](../tests/infrastructure/deepseek-credential-egress-broker.test.ts) · [`deepseek-credential-egress-broker.integration.test.ts`](../tests/infrastructure/deepseek-credential-egress-broker.integration.test.ts) · [`provider-research-report.test.ts`](../tests/research/provider-research-report.test.ts) · [`grok-native-agent-runtime.test.ts`](../tests/research/grok-native-agent-runtime.test.ts) · [`claude-code-native-agent-runtime.test.ts`](../tests/research/claude-code-native-agent-runtime.test.ts) · [`glm-native-agent-runtime.test.ts`](../tests/research/glm-native-agent-runtime.test.ts) · [`codex-native-agent-runtime.test.ts`](../tests/research/codex-native-agent-runtime.test.ts) · [`deepseek-harness-native-agent-runtime.test.ts`](../tests/research/deepseek-harness-native-agent-runtime.test.ts) · [`deepseek-harness-native-agent-runtime.integration.test.ts`](../tests/research/deepseek-harness-native-agent-runtime.integration.test.ts)

</details>

## Human OS

<details>
<summary>Human OS — Candidateを動的検証しscopeと提出承認を扱う</summary>

- **目的:** Candidateをfreshな実環境で検証し、技術的な脆弱性、programme適格性、提出前の人間承認を別々に扱う。
- **Interface:** `HumanOs.receiveCandidateVerification / verifyCandidate / saveSubmissionDraft / authorizeExternalAction / admitExternalAction / inspect`。公開入口は[`human-os/index.ts`](../src/human-os/index.ts)。
- **所有する記録・不変条件:** SQLite v3のVerification・Verified Vulnerability・Programme Scope・Submission Candidate・Draft・Authorization eventsとcontent-addressed Private Evidence。Request・Recipe・Lab Setup・Target・Dependencyのbinding、freshな隔離環境、全configured programmeのexactly-once評価、Draft revisionとdestinationへのexact authorizationを要求する。`runtime-confirmed`だけがVerified Vulnerabilityを作り、`in-scope`だけがSubmission Candidateを作る。外部送信は行わない。
- **失敗時:** source / image / runsc不一致ではlabを開始しない。provision・Recipe・観測・cleanup・evidence failureは`incomplete`。scope evaluatorのfailureや不完全なprogramme集合はscopeだけを`incomplete`にし、Verified Vulnerabilityを失わない。必要なVerified Vulnerability・Submission Candidate・Draft・authorizationがなければexternal action admissionを拒否する。

**Source / Behavior Test:** [`src/human-os`](../src/human-os) · [`candidate-verification.test.ts`](../tests/human-os/candidate-verification.test.ts) · [`gvisor-candidate-verification.test.ts`](../tests/human-os/gvisor-candidate-verification.test.ts) · [`recipe-dynamic-reproduction-agent.test.ts`](../tests/human-os/recipe-dynamic-reproduction-agent.test.ts)

</details>

## CLI

<details>
<summary>Composition root — コマンドと実行依存を接続する</summary>

- **目的:** AIが既存のCampaign操作と照会を呼ぶための薄い入口を提供する。
- **Interface:** `wordpress-harness campaign conduct | conduct-approved | review-research | review-candidates | inspect`。
- **所有する記録・不変条件:** CLI独自のCampaign stateは持たない。sealed profileの`transportKind`からAdapterを選び、prompt digestとDependency mount集合を検査する。model / effortのadmissionはRuntime Profile catalogとAdapterがprovider起動前に行う。`inspect`はrunを起動しない。Review前の一時照会も、例外時を含めDB接続を閉じる。
- **失敗時:** unsupported runtime・missing option・invalid inputはnon-zero。buildは古いdistを消し、現行sourceにないartifactを拒否する。

**Source / Behavior Test:** [`src/cli.ts`](../src/cli.ts) · [`agent-led-campaign-cli.test.ts`](../tests/cli/agent-led-campaign-cli.test.ts) · [`database-lifecycle.test.ts`](../tests/cli/database-lifecycle.test.ts)

</details>

## Independent Research Trial Comparison

<details>
<summary>Operations — 保存済みCampaignを独立Trialとして読み取り専用で比較する</summary>

- **目的:** exactなCampaign ID集合を一つの評価条件へ照合し、Campaign内の継続Grantやprovider retryを独立Trialへ数えずに、完了・未完了・不一致と後段結果を表示する。
- **Interface:** `defineIndependentResearchTrialBinding`、`defineIndependentResearchTrialComparisonRequest`、`deriveIndependentResearchTrialComparison`。RequestはTarget / Dependency、Threat Context、Programme Boundary、Prompt、Runtime、Permission、Budgetとfresh startを自己digestへbindする。導出関数は`ResearchCampaignView`と任意の`CandidateVerificationView`だけを受け取る。
- **所有する記録・不変条件:** mutable stateを持たない。Request順をTrial順として決定論的な自己digest付きviewを返す。CandidateはCampaign内のimmutableな同一IDだけを一recordへまとめて全run IDを保持し、別Campaign間では同じrecord digestでも統合しない。AssessmentはGrant-local occurrenceのまま保持する。costまたはtoken欠損は`unknown`、未起動は`not-observed`であり0へ丸めない。technical verification、programme scope、Campaign statusとCoverageを別fieldにする。
- **失敗時:** missing Campaignは`planned`、binding不一致またはresume開始は`incompatible`、失敗・orphan・administrative incompleteは`incomplete`として表示する。計画外Campaign、重複・改変されたview、Campaign Requestと一致しないHuman OS viewは例外で拒否する。比較はResearch Grant、Human Review、Candidate Verificationまたは外部行動を起動しない。

**Source / Behavior Test:** [`independent-research-trial-comparison.ts`](../src/operations/independent-research-trial-comparison.ts) · [`independent-research-trial-comparison.test.ts`](../tests/operations/independent-research-trial-comparison.test.ts)

</details>

## DeepSeek Account Readiness

<details>
<summary>Operations — Trial起動前に認証とAPI残量をhost側で観測する</summary>

- **目的:** Independent Trialの起動前に、host-privateなDeepSeek API keyで公式balance endpointだけを照会し、認証切れと利用可能残量をCampaignから独立した観測として確定する。
- **Interface:** `probeDeepSeekAccountReadiness`とversioned `DeepSeekAccountReadinessObservation`。originは`https://api.deepseek.com`、pathは`GET /user/balance`へ固定し、自己digest、観測時刻、providerの`is_available`と通貨別decimal文字列を返す。後続Launcherがdigestとfreshnessを検査する。
- **所有する記録・不変条件:** mutable stateを持たない。API keyはowner-only、single-link、regularなhost fileから`O_NOFOLLOW`で読み、requestのAuthorization以外へ渡さない。key、provider error body、例外文をObservationへ保持しない。残量の欠損を0へ変換しない。
- **失敗時:** unsafeまたはmissing credential、401 / 403、402または`is_available: false`、429、timeout、transport / provider failure、malformed responseを別statusへfail closedで写像する。login、key refresh、top-up、retry、Campaign起動、model invocationは行わない。

**Source / Behavior Test:** [`deepseek-account-readiness.ts`](../src/operations/deepseek-account-readiness.ts) · [`provider-private-credential.ts`](../src/infrastructure/provider-private-credential.ts) · [`deepseek-account-readiness.test.ts`](../tests/operations/deepseek-account-readiness.test.ts)

</details>

## Independent Research Trial Launcher

<details>
<summary>Operations — 人間が承認したfresh Campaign集合だけをatomicに起動する</summary>

- **目的:** pass@Nの各試行を以前の結果やCheckpointを持たない通常のResearch Campaignとして起動し、同一条件の独立Trialだけをread-only comparisonへ渡す。
- **Interface:** `defineIndependentResearchTrialApproval`、`decideIndependentResearchTrialLaunches`、`dispatchIndependentResearchTrials`、`inspectIndependentResearchTrialClaims`、installed CLI `wordpress-harness-trials`の`seal-approval / dispatch / inspect`。Approval v2はexactなTrial順、`approved-target-campaign-request`、source path、prompt、runtime profile / model、permission、各Trial予算、aggregate native-run / wall-time allowance、最大同時Trial数と期限を自己digestへbindする。Target Intelligenceのadmissionから比較bindingとCampaign Inputを導出し、起動は既存`campaign conduct-approved`だけを使う。
- **所有する記録・不変条件:** private receipt rootのimmutable claimとlaunch receiptだけを所有し、Campaign stateは所有しない。全Trialは同じcomparison bindingを持ち、Campaign ID、database、scratch、logはTrialごとに一意、`resumeFrom`は禁止する。一つのprovider configに対するfreshなbalance observationと、Target / Dependency source、prompt、credential file、Docker、runsc、pinned image、sandbox内`dsh --version`のread-only preflightを要求する。global dispatch lock内でclaimを再読込し、各Trialの全予算をaggregate allowanceへ予約してからfresh database / scratch / logを排他的に確保する。Approvalから作るcomparison requestは承認順のCampaign IDをそのまま使う。
- **失敗時:** raw Campaign Input、旧Approval v1、Target Intelligenceでadmitできないrequest、改変・期限切れApproval、stale / unauthenticated / exhausted / rate-limited account observation、binding不一致、blocked / unknown preflight、同時実行上限、aggregate allowance不足をfail closedにする。lock競合時は起動せず、claim後のspawnまたはreceipt保存失敗はclaimをactive-unknownのまま残す。中断claimを自動削除・再実行せず、新しい人間判断なしにCampaign継続、Candidate admission、Verificationを行わない。

**Source / Behavior Test:** [`independent-research-trial-launcher.ts`](../src/operations/independent-research-trial-launcher.ts) · [`independent-research-trial-launcher-runtime.ts`](../src/operations/independent-research-trial-launcher-runtime.ts) · [`independent-research-trial-readiness.ts`](../src/operations/independent-research-trial-readiness.ts) · [`independent-research-trial-launcher-cli.ts`](../src/operations/independent-research-trial-launcher-cli.ts) · [`independent-research-trial-launcher.test.ts`](../tests/operations/independent-research-trial-launcher.test.ts)

</details>

## Quota-aware Approved Campaign Launcher

<details>
<summary>Operator control — 承認済みClaude Campaignの起動量を調整する</summary>

- **目的:** Claude accountのready状態を確認し、5時間枠と7日枠の両方にreserveを残しながら、既に承認済みの独立Campaignだけをcronから起動する。
- **Interface:** `decideApprovedCampaignLaunches`、`dispatchApprovedCampaignLaunches`、installed operator CLI `wordpress-harness-claude-launcher`の`record-account-readiness / record-status-line / dispatch`。trustedなoperator入力とClaudeのsupported status-line JSONを別々のprivate observationへ正規化してからdispatchする。Launcher自身はprovider credentialを読まず、provider process、usage probe、loginまたはtoken refreshを起動しない。
- **所有する記録・不変条件:** privateなaccount-readiness observation、rate-limit observationとimmutable launch receiptだけを扱う。Campaign state、Target順序の判断、継続Review、Candidate admission、Verification、提出は所有しない。起動commandは`campaign conduct-approved`に固定し、active Campaignは最大3、同一planのclaimはatomicにする。Receiptは使用した両observation digestと5時間・7日の見積消費量をbindし、同じquota observationに対する既存reservationを両方の残量から控除する。Checkpoint再開を前提に人間が`allowQuotaExhaustion`を明示したBatchだけは、両方の残量が1%以上あれば見積消費量未満でも起動できる。理由は[ADR 0139](adr/0139-gate-claude-launches-on-readiness-and-both-quota-windows.md)を参照する。
- **失敗時:** readinessの欠落・stale・unauthenticated・unavailableと、quota観測の欠落・stale・各window reset・各windowのreserve不足を別のtyped reasonでfail closedにする。loginまたはreset後もfresh observationがなければ一件も起動しない。active runが返すprovider account failureはNative Runtime Receiptのまま扱い、Operationsから書き換えない。中断されたclaimはactiveとして扱い、重複起動より手動確認を優先する。process spawnまたはprivate artifact保存の失敗はnon-zeroで返す。

**Source / Behavior Test:** [`claude-quota-approved-campaign-launcher.ts`](../src/operations/claude-quota-approved-campaign-launcher.ts) · [`claude-quota-approved-campaign-launcher-runtime.ts`](../src/operations/claude-quota-approved-campaign-launcher-runtime.ts) · [`claude-quota-approved-campaign-launcher-cli.ts`](../src/operations/claude-quota-approved-campaign-launcher-cli.ts) · [`claude-quota-approved-campaign-launcher.test.ts`](../tests/operations/claude-quota-approved-campaign-launcher.test.ts)

</details>

## Campaign Readiness Doctor

<details>
<summary>Composition / Operations — model quotaを使う前にread-only preflightを説明する</summary>

- **目的:** 承認済みCampaignについて、起動前のinfrastructure、subscription、binding、storageとprivate artifactの状態を一つのread-only reportで確認する。
- **Interface:** `CampaignReadinessDoctor.inspect`、versioned `CampaignReadinessInput / CampaignReadinessReport`、installed CLI `wordpress-harness-doctor inspect --input ... [--human]`。machine reportはDocker、runsc、image、provider version、account、quota、launch capacity、Target、Dependency、prompt、database、scratch、disk、private artifactの各checkをexactly once返す。human表示は同じreportから導く。
- **所有する記録・不変条件:** stateを所有しない。全checkが`ready / blocked / unknown`のいずれかを返し、overallは`blocked`を優先し、次に`unknown`、全件readyの場合だけ`ready`とする。TargetとDependencyはsealed canonical tree、promptはdigest、resume Checkpointはshared Private Artifact Storeで照合する。Agent Runtime Profileはlaunch imageと同じcentral catalogで照合し、未対応model / effort / capabilityはprovider probe前にblockedにする。provider version確認はlocal pinned imageを`runsc`、`network=none`、`pull=never`、read-onlyで`--version`実行するだけで、Target、provider config、credential、promptをmountしない。理由は[ADR 0140](adr/0140-keep-campaign-readiness-doctor-read-only.md)を参照する。
- **失敗時:** 明確な不一致・不足・unauthenticatedは`blocked`、観測欠落・stale・unavailable・依存check未成立は`unknown`にする。missingなdatabaseはparentがwrite可能ならreadyだが作成せず、missingなscratchはblockedにする。Doctorはlogin、repair、directory / database / receipt作成、Campaign mutation、Target実行、model invocationを行わない。input schema不正またはCLI I/O失敗だけをnon-zeroにする。

**Source / Behavior Test:** [`campaign-readiness-doctor.ts`](../src/operations/campaign-readiness-doctor.ts) · [`campaign-readiness-doctor-cli.ts`](../src/operations/campaign-readiness-doctor-cli.ts) · [`campaign-readiness-doctor.test.ts`](../tests/operations/campaign-readiness-doctor.test.ts)

</details>

## Agent input

情報の種類ごとに更新先を決める。同じ入力値の表示とJSON化は派生表現として扱い、別の正本にしない。

| 内容 | Source | 現在の関係 |
| --- | --- | --- |
| base Prompt | [Research Prompt v3](../prompts/wordpress-plugin-research-v3.md) | CLIから本文を渡し、sealed digestを検査する |
| run固有のcontextと追加指示 | [`agent-prompts.ts`](../src/research/agent-led/agent-prompts.ts) | `agentResearchPrompt`がsealed runからTarget・Dependency・Threat Context・Programme Boundary・継続next actionの表示とJSON化したcontextを組み立て、Candidate-bound recipe、Candidate evidence、Grant-local Research Assessmentとevidence summaryの出力を要求する |
| 入出力schema | [contracts.ts](../src/research/agent-led/contracts.ts) | Research Report v2を含むversioned Zod schemaを所有する |
| provider向け表現 | [Grok](../src/research/agent-led/grok-native-agent-runtime.ts)・[Claude / GLM](../src/research/agent-led/claude-code-native-agent-runtime.ts)・[Codex](../src/research/agent-led/codex-native-agent-runtime.ts)・[DeepSeek Harness](../src/research/agent-led/deepseek-harness-native-agent-runtime.ts) | schemaからJSON Schemaを生成し、provider別のprompt / structured-output形式へ変換する。GrokとDeepSeekは同じprompted JSON parserを使い、Codex transportのnullable placeholderは受信時にdomain schemaへ戻す |
| Candidate recipeのprivate保存 | [`provider-research-report.ts`](../src/research/agent-led/provider-research-report.ts) | provider outputの本文を検査し、private CASへ保存して公開Reportをopaque refへ変換する |

JSON Schemaの元はZod。Codex等のAdapterは項目名・必須項目・選択肢をprovider向けに変換するため、schema変更時には対応するBehavior Testも確認する。入力の組立を移動する変更では文字列を維持する。base Promptと追加文章に重なる指示を削除・並べ替える場合は、Agentへ届く入力を変える仕様変更として扱う。対応する観測は[Campaign input例](../tests/research/campaign-threat-context.test.ts)と各Runtime AdapterのBehavior Testsにある。

## Shared infrastructure

| 関心 | Source | 現在の責務 |
| --- | --- | --- |
| JSON検査・正規化・digest | [Infrastructure](../src/infrastructure/canonical-json.ts) | 2つの既存契約を所有する。`canonicalJson / canonicalDigest`はZodで検査した値、末尾が`PreservingProperties`の入口は取得側の従来契約で処理する。encoderとhash処理は共通 |
| 取得側の公開名 | [acquisition exports](../src/target-intelligence/acquisition/canonical-json.ts) | `PreservingProperties`の入口を従来の名前で公開する。独自の検査・保存処理は持たない |
| source tree integrity | [canonical-source-tree.ts](../src/infrastructure/canonical-source-tree.ts) | sourceの列挙とcanonical manifest検査 |
| host process | [native-model-process.ts](../src/infrastructure/native-model-process.ts) | 外部processの実行Seam |
| 同一内容のファイル保存 | [immutable-file.ts](../src/infrastructure/immutable-file.ts) | `persistImmutableFile`が制度情報・報告先情報の保存処理を共有する。同じ内容は再利用し、異なる内容は`conflict`、ファイル操作の失敗は呼び出し側へ返す。契約は[テスト](../tests/infrastructure/immutable-file.test.ts)で確認する |

Infrastructureはcontextの業務判断や記録の保存形式を所有しない。JSON処理は状態を持たず、不正入力を既定の入口では`ZodError`、取得側の契約では`TypeError`で拒否する。既に検査済みの値を扱う`encodeCanonicalJson`も同じModuleにある。契約を一本化すると受理する値や保存digestが変わるため、保存形式の移行判断が必要になる。

[Canonical JSON tests](../tests/infrastructure/canonical-json.test.ts)で保存文字列・ハッシュ値・配列順序・不正入力の拒否と2契約の違いを確認する。各contextでの保存と読み戻しは上記ModuleのBehavior Tests、取得側の接続は[Target Intake tests](../tests/target-intelligence/local-directory-target-intake.test.ts)と[Target Proposal tests](../tests/target-intelligence/target-proposals.test.ts)で確認する。

## Repository gate

`pnpm check`はformat、strict typecheck、Behavior Tests、build、documentation link checkを行う。テストはpublic Interfaceから観測し、private helperや内部call順を固定しない。
