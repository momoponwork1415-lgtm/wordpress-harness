# Codebase Guide

**変更したいことから担当Moduleを選び、必要な節だけ読む。** 各節にはInterface、所有する記録、不変条件、失敗時の扱い、sourceとBehavior Testを置く。正確なfield・定数はリンク先のcode、設計方針は[Research Design](RESEARCH-DESIGN.md)が正本。

## Moduleを選ぶ

| 変更したいこと | Owner | Module |
| --- | --- | --- |
| sourceを取得して固定する | Target Intelligence | [Target acquisition](#target-acquisition) |
| 更新の観測を保存する | Target Intelligence | [WordPress.org Update Frontier](#wordpressorg-update-frontier) |
| 観測からCandidate Poolを作る | Target Intelligence | [Update Candidate Pool assembly](#update-candidate-pool-assembly) |
| Programmeと公開情報を観測する | Target Intelligence | [Target observations](#target-observations) |
| 既探索pluginとversionを照合する | Target Intelligence | [Target Research History](#target-research-history) |
| AIによるTarget提案を記録する | Target Intelligence | [Target Proposals](#target-proposals) |
| 人間の対象承認を記録する | Target Intelligence | [Approved Target Batches](#approved-target-batches) |
| 承認済みTargetをResearchへ渡す | Target Intelligence | [Approved Target Campaigns](#approved-target-campaigns) |
| Campaignの判断点と記録を扱う | Research | [Research Campaigns](#research-campaigns) |
| providerと隔離実行を接続する | Research | [gVisor Native Agent Runtimes](#gvisor-native-agent-runtimes) |
| Findingへ検証記録と承認を追記する | Human OS | [Human OS](#human-os) |
| コマンドと実行依存を接続する | Composition root | [CLI](#cli) |
| Agentへ渡る入力の所在を確認する | Research / Runtime Adapter | [Agent input](#agent-input) |
| 共通のJSON・source digestを調べる | Infrastructure | [Shared infrastructure](#shared-infrastructure) |

## Current capability

`implemented`はdeterministic Behavior Testで観測できる意味。実providerや未知Targetでの効果を証明する意味ではない。実測は[Knowledge](knowledge/)に置く。

| 範囲 | 現在の接続 | 残るgap |
| --- | --- | --- |
| Target供給 | local / WordPress.org acquisition、Update Frontier → Candidate Pool、Programme / disclosure observations | 定期trigger、Selection Contextの自動resolver、update以外の一般Pool組立、選定全体のCLI |
| 履歴・提案・承認 | legacyのplugin/version取込、AI Proposal、Approved Batch、単一Campaignへのdispatch | 現行Campaign履歴の取込、History → Poolの接続 |
| Research | Grant、両Human Review、Checkpoint再開、Independent Validation、Finding / Coverage記録 | GLM Validationのsingle-fresh-run不整合は下記。cross-context Coverage Receipt Adapterも未接続 |
| Native Runtime | Grok / Claude / GLM / CodexのAdapterと固定runtime binding | admitted image以外のprobe、provider比較、prospective評価と履歴の接続 |
| Human OS | Finding-bound Recipe、companion / ordinary configuration対応、private evidence、append-only record、外部行動のgate | Dependency / Lab Setup供給resolver、ResearchからPrivate Recipe保存への自動handoff |

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

## Update Candidate Pool assembly

<details>
<summary>Target Intelligence — 観測からCandidate Poolを作る</summary>

- **目的:** Update Frontierから既存Target Proposal用のCandidate Poolを作る。
- **Interface:** `WordPressOrgUpdateCandidatePools.assemble / inspect`。
- **所有する記録・不変条件:** private Assembly Recordとunresolved gap。同一versionのsourceを再取得し、Intake・Observation・Selection Contextのbindingとfreshnessを検査する。Frontier外のContextやprivate SVN詳細を後段へ渡さない。
- **失敗時:** missing・stale・acquisition failureをgapとして残す。有効Candidateがなければ`assembly-pending`。inputやartifactの不一致は拒否する。

**Source / Behavior Test:** [`candidate-pool`](../src/target-intelligence/candidate-pool) · [`wordpress-org-update-candidate-pools.test.ts`](../tests/target-intelligence/wordpress-org-update-candidate-pools.test.ts)

</details>

## Target observations

<details>
<summary>Target Intelligence — Programmeと公開情報を観測する</summary>

- **目的:** Programme eligibility、disclosure route、Wordfenceの公開観測を固定する。
- **Interface:** `ProgrammeIntelligence.refresh / inspect`、`DisclosureRoute.observe / inspect`、Wordfenceのinspection / refresh Interface。
- **所有する記録・不変条件:** 取得時刻とfreshnessを持つSnapshot。credentialはhost-private brokerに閉じる。既知脆弱性の詳細へのアクセスとoracle-freeな選定情報を分離する。
- **失敗時:** unavailable・stale・conflicting・unknownをeligibleにしない。

**Source / Behavior Test:** [Programme](../src/target-intelligence/programme-intelligence/index.ts)・[Disclosure Route](../src/target-intelligence/disclosure-route/index.ts)・[Wordfence](../src/target-intelligence/wordfence-intelligence/index.ts) · [`programme-intelligence.test.ts`](../tests/target-intelligence/programme-intelligence.test.ts) · [`wordfence-intelligence.test.ts`](../tests/target-intelligence/wordfence-intelligence.test.ts) · [`disclosure-route.test.ts`](../tests/target-intelligence/disclosure-route.test.ts)

</details>

## Target Research History

<details>
<summary>Target Intelligence — 既探索pluginとversionを照合する</summary>

- **目的:** 旧workspaceから既探索のplugin identityとversionだけを一方向に取り込む。
- **Interface:** `TargetResearchHistories.buildFromLegacyData / inspect`。
- **所有する記録・不変条件:** `.private/target-intelligence/research-history`のimmutable Snapshot。同じidentity/versionを一件にし、same versionとprior versionを区別する。source identity、Finding、結果、CVE、claim等は持ち込まない。
- **失敗時:** 欠落・symlink・unsupported schema・identity衝突・digest不一致を拒否する。欠損を未探索にせず、既存Snapshotを置換しない。

**Source / Behavior Test:** [`research-history`](../src/target-intelligence/research-history) · [`research-history.test.ts`](../tests/target-intelligence/research-history.test.ts)

</details>

## Target Proposals

<details>
<summary>Target Intelligence — AIによるTarget提案を記録する</summary>

- **目的:** oracle-freeなCandidate PoolからTarget・理由・不確実性の提案を得る。
- **Interface:** `TargetProposals.propose / inspect`、`TargetProposalAgent.execute`。
- **所有する記録・不変条件:** file-backed Selection Run、Native Receipt、Proposal。pool外・取得不能・identity未確認・staleなTargetを選べない。固定rankやreason codeを要求しない。
- **失敗時:** provider・Budget・policy・invalid outputは`selection-pending`。同じrevisionへの異なるinputはconflict。

**Source / Behavior Test:** [`target-proposal`](../src/target-intelligence/target-proposal) · [`target-proposals.test.ts`](../tests/target-intelligence/target-proposals.test.ts) · [`grok-target-proposal-agent.test.ts`](../tests/target-intelligence/grok-target-proposal-agent.test.ts)

</details>

## Approved Target Batches

<details>
<summary>Target Intelligence — 人間の対象承認を記録する</summary>

- **目的:** 対象範囲・順序・Budget・execution windowの人間承認を固定する。
- **Interface:** `ApprovedTargetBatches.approve / inspect / admitDispatch`。
- **所有する記録・不変条件:** digest-bound Approved Target Batch。Proposal外のTargetを追加せず、dispatch直前にidentity・version・manifestを再確認する。
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
<summary>Research — Campaignの判断点と記録を扱う</summary>

- **目的:** Research、両Human Review、Independent Validation、Finding、Coverageと再開を一つのModuleに隠す。
- **Interface:** `ResearchCampaigns.conduct / inspect`。versioned handoffは[`research/index.ts`](../src/research/index.ts)、入力とcommandのfieldは[`contracts.ts`](../src/research/agent-led/contracts.ts)。
- **所有する記録・不変条件:** SQLiteのappend-only Campaign eventsとprivate Checkpoint / Diagnosticへのopaque ref。最大1時間のGrant、exact bindingの両Human Review、Parked Programme LeadのValidation除外、独立ValidationだけによるFinding生成、Finding/Coverage分離を維持する。ValidationへResearchのCheckpoint・Programme Boundaryを渡さない。run数とwall timeがhard limit、provider costは観測値。
- **失敗時:** review待ちはrunを開始しない。異なるinput、stale/partial reviewはatomic conflict。provider・Budget・policy・invalid outputは`incomplete` / `validation-pending`として残す。Researchの有効Checkpointによるresumeと実行前availability / 未認証の一度のretryを区別する。source / Checkpoint integrity failureはretry不可。Validationの再試行にはexact current failed run集合に対するHuman Validation Retryを要し、過去Receiptを置換しない。

入力例は[`campaign-threat-context.test.ts`](../tests/research/campaign-threat-context.test.ts)。入力の組立箇所は[Agent input](#agent-input)へ進む。

**Source / Behavior Test:** [`research-campaigns.ts`](../src/research/agent-led/research-campaigns.ts) · [`research-campaigns.test.ts`](../tests/research/research-campaigns.test.ts) · [`human-research-continuation-review.test.ts`](../tests/research/human-research-continuation-review.test.ts) · [`human-candidate-review.test.ts`](../tests/research/human-candidate-review.test.ts) · [`parked-programme-leads.test.ts`](../tests/research/parked-programme-leads.test.ts) · [`independent-validation.test.ts`](../tests/research/independent-validation.test.ts) · [`agent-led-campaign-cli.test.ts`](../tests/cli/agent-led-campaign-cli.test.ts)

</details>

## gVisor Native Agent Runtimes

<details>
<summary>Research — providerと隔離実行を接続する</summary>

- **目的:** provider-nativeな実行・session・subagentを隔離し、bindingとReceiptを扱う。
- **Interface:** `NativeAgentRuntime.execute`。Grok、Claude Code、GLM、CodexのAdapterを持つ。
- **所有する記録・不変条件:** private provider home、Checkpoint、Diagnostic。exact image / CLI、non-root、read-only source、ResearchとValidationの別scratch、Root込み最大4 active agentsを要求する。ambient権限やprovider fallbackを与えない。設定値は各Adapterのsourceを正本とする。
- **失敗時:** availability・binding・policy・provider・schemaの失敗をtyped receiptへ変換する。timeoutは`budget-exhausted`、対応するaccount envelopeは`provider-unauthenticated` / `provider-quota-exhausted`。元の分類・usageをcleanupで失わず、拒否したoutputもprivate Diagnosticへ保存する。Diagnostic保存不能は`provider-failed`。診断用stateはresumeに使わない。

**既知の設計不整合:** GLMのmalformed-output補正はValidationでもsecond model executionを行う。[#144](https://github.com/momoponwork1415-lgtm/wordpress-harness/issues/144)はIssue分割の見直しでclosedになっており、解消済みを意味しない。single-fresh-runの方針は[Research Design](RESEARCH-DESIGN.md#independent-validation)を参照。

**Source / Behavior Test:** [`gvisor-agent-sandbox.ts`](../src/research/agent-led/gvisor-agent-sandbox.ts) · [`grok-native-agent-runtime.ts`](../src/research/agent-led/grok-native-agent-runtime.ts) · [`claude-code-native-agent-runtime.ts`](../src/research/agent-led/claude-code-native-agent-runtime.ts) · [`codex-native-agent-runtime.ts`](../src/research/agent-led/codex-native-agent-runtime.ts) · [`codex-source-reader.ts`](../src/research/agent-led/codex-source-reader.ts) · [`grok-native-agent-runtime.test.ts`](../tests/research/grok-native-agent-runtime.test.ts) · [`claude-code-native-agent-runtime.test.ts`](../tests/research/claude-code-native-agent-runtime.test.ts) · [`glm-native-agent-runtime.test.ts`](../tests/research/glm-native-agent-runtime.test.ts) · [`codex-native-agent-runtime.test.ts`](../tests/research/codex-native-agent-runtime.test.ts)

</details>

## Human OS

<details>
<summary>Human OS — Findingへ検証記録と承認を追記する</summary>

- **目的:** Findingへruntime / human verificationを追記し、提出前の人間承認を扱う。
- **Interface:** `HumanOs.receiveFinding / reproduceFinding / recordAIReproduction / recordHumanVerification / saveSubmissionDraft / authorizeExternalAction / admitExternalAction / inspect`。公開入口は[`human-os/index.ts`](../src/human-os/index.ts)。
- **所有する記録・不変条件:** SQLite v3のFinding・Verification・Draft・Authorization eventsとcontent-addressed Private Evidence。Recipe・Lab Setup・Target・Dependencyのbinding、freshな隔離環境、AI/humanで別environment identity、Draft revisionとdestinationへのexact authorizationを要求する。runtime確認はpreconditions・recipe completion・observed effectとevidence・cleanupが揃った場合だけ。Findingは削除せず、外部送信は行わない。
- **失敗時:** source / image / runsc不一致ではlabを開始しない。provision・Recipe・観測・cleanup・evidence failureは`incomplete`。外部identityが必要なら`external-dependency-required`。必要なFinding・Draft・human confirmation・authorizationがなければexternal action admissionを拒否する。

**Source / Behavior Test:** [`src/human-os`](../src/human-os) · [`dynamic-ai-reproduction.test.ts`](../tests/human-os/dynamic-ai-reproduction.test.ts) · [`gvisor-wordpress-dynamic-reproduction.test.ts`](../tests/human-os/gvisor-wordpress-dynamic-reproduction.test.ts) · [`recipe-dynamic-reproduction-agent.test.ts`](../tests/human-os/recipe-dynamic-reproduction-agent.test.ts) · [`agent-led-human-os.test.ts`](../tests/human-os/agent-led-human-os.test.ts)

</details>

## CLI

<details>
<summary>Composition root — コマンドと実行依存を接続する</summary>

- **目的:** local Campaign操作とread-only inspectionを対話control planeへ公開する。
- **Interface:** `wordpress-harness campaign conduct | conduct-approved | review-research | review-candidates | retry-validation | inspect`。
- **所有する記録・不変条件:** CLI独自のCampaign stateは持たない。sealed profileからAdapterを選び、prompt digestとDependency mount集合を検査する。`inspect`はrunを起動しない。
- **失敗時:** unsupported runtime・missing option・invalid inputはnon-zero。buildは古いdistを消し、現行sourceにないartifactを拒否する。

**Source / Behavior Test:** [`src/cli.ts`](../src/cli.ts) · [`agent-led-campaign-cli.test.ts`](../tests/cli/agent-led-campaign-cli.test.ts)

</details>

## Agent input

現在の入力は次の場所で組み立てる。この表は所在の案内であり、Prompt本文やschemaを複製しない。

| 内容 | Source | 現在の関係 |
| --- | --- | --- |
| base Prompt | [Research Prompt v2](../prompts/wordpress-plugin-research-v2.md) | CLIから本文を渡し、sealed digestを検査する |
| run固有のcontextと追加指示 | [agentResearchPrompt / agentValidationPrompt](../src/research/agent-led/gvisor-agent-sandbox.ts) | base本文へTarget / Dependencyの表示、JSON化したcontext等を追加する。一般指示の一部もbaseと重なる |
| 入出力schema | [contracts.ts](../src/research/agent-led/contracts.ts) | versioned Zod schemaを所有する |
| provider向け表現 | [Grok](../src/research/agent-led/grok-native-agent-runtime.ts)・[Claude / GLM](../src/research/agent-led/claude-code-native-agent-runtime.ts)・[Codex](../src/research/agent-led/codex-native-agent-runtime.ts) | schemaからJSON Schemaを生成し、provider別のprompt / structured-output形式へ変換する |

JSON Schemaの元はZod。ただしCodex等は項目名・必須項目・選択肢の表現をAdapter内でも指定するため、派生処理にも追随が必要。一方、base Promptとsandbox内の追加文章は別々に保守される。情報の反復と正本の分散を区別して扱う。対応する観測は[Campaign input例](../tests/research/campaign-threat-context.test.ts)と各Runtime AdapterのBehavior Testsにある。

## Shared infrastructure

| 関心 | Source | 現在の責務 |
| --- | --- | --- |
| canonical JSON / digest | [Infrastructure](../src/infrastructure/canonical-json.ts)・[acquisition helper](../src/target-intelligence/acquisition/canonical-json.ts) | encodingは共通。入力検査とdigestの入口は二系統あり、同一契約とは限らない |
| source tree integrity | [canonical-source-tree.ts](../src/infrastructure/canonical-source-tree.ts) | sourceの列挙とcanonical manifest検査 |
| host process | [native-model-process.ts](../src/infrastructure/native-model-process.ts) | 外部processの実行Seam |

Infrastructureはcontextの業務判断やstorageを所有しない。JSONの変更は[Target Intake tests](../tests/target-intelligence/local-directory-target-intake.test.ts)と[Target Proposal tests](../tests/target-intelligence/target-proposals.test.ts)を入口に、保存済みbyte列・digestと不正入力の契約を確認する。

## Repository gate

`pnpm check`はformat、strict typecheck、Behavior Tests、build、documentation link checkを行う。テストはpublic Interfaceから観測し、private helperや内部call順を固定しない。
