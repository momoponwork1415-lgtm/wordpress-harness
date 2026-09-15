# Codebase Guide

Status: current implementation map, 2026-09-15

現在動くproduction seam、owner、failure semantics、Behavior Testを示す。設計理由は[ADR 0125](adr/0125-put-agent-decisions-behind-thin-evidence-shells.md)、[ADR 0127](adr/0127-make-validated-findings-the-product-success-criterion.md)、[ADR 0131](adr/0131-place-human-reviews-between-research-and-validation.md)、[ADR 0132](adr/0132-treat-provider-cost-as-observational-telemetry.md)、research policyは[Research Design](RESEARCH-DESIGN.md)を参照する。

診断coreは`Target Snapshot -> Research Grant -> Human Research Review -> Human Candidate Review -> Independent Source Validation -> Finding`である。Source Validationは明白なsource矛盾を落とすsanity gateで、実質的なtrue-positive assuranceはHuman OSのfresh Dynamic Reproductionが所有する。Target Selectionと隔離方式の高度化はsupporting workflowまたはAdapter内部の関心であり、診断coreのpromotion blockerではない。

## Current capability

| Capability | State | Important gap |
| --- | --- | --- |
| local / WordPress.org source acquisition | implemented | update外の一般Candidate Pool resolverは未実装 |
| WordPress.org Update Frontier | caller-boundedなofficial SVN revision windowから`trunk` PHP変更を収集し、current metadataとdigest-boundなoracle-free frontierを作成・inspect可能 | recurring triggerは未実装 |
| Update Candidate Pool assembly | Frontierへbindした同一version sourceを再取得し、caller-supplied Selection Contextとfreshnessを検査して既存Candidate Poolへ接続 | Selection Contextの自動resolverとCLIは未実装 |
| Programme / disclosure observations | implemented | 全Programmeを一つのCandidate Poolへ組み立てるapplication serviceは未実装 |
| Target Research History | 二つのlegacy research workspaceの既探索plugin/versionを最小のimmutable Snapshotへ正規化し、same version / prior versionをinspect可能 | 現行Campaign履歴の自動取込とCandidate Pool組立serviceへの接続は未実装 |
| AI Target Proposal | exact Grok transportをadmitするproduction Adapterまでimplemented。Update Frontier由来Candidate Poolをそのまま入力可能 | CLIと一般Candidate Pool resolverは未実装 |
| human Approved Target Batch | implemented | Target Selection全体のCLIは未実装 |
| approved Target Campaign dispatch | fresh observation、Target Intake、Campaign Policy、WordPress core、Threat Contextをsealして一Campaignを`conduct`まで接続 | 複数Targetの中央schedulerは意図的に持たない |
| wp2shell-derived Research Prompt v2 | positive oracle、RCE / `/flag`到達の強制と最低6時間を除く全研究要素をPromptへ反映 | 反復roundとadversarial double-checkの実Target再評価は未実施 |
| agent-led Research loop | 最大1時間のResearch Grant、人間の継続review、pinned Dependency Snapshot、private Agent Checkpoint resume、parked Programme Leadまでimplemented。known-positive corpusは4/4でcandidateを回収 | prospectiveなlatest-version Campaignは未評価 |
| Grok native runtime | exact image / CLI versionをadmitし、structurally tested | real Brizy runはproviderのHTTP 402で未完了 |
| Claude Code native runtime | exact imageをreal boundary-probed | admitted image以外は再probeが必要 |
| GLM native runtime | exact Claude Code imageからZ.AI GLM 5.3へ接続し、runscでreal research / native subagent / fresh Validationを実行済み | Grokとの同条件比較は未実施 |
| Codex Daybreak native runtime | exact image / CLI version、managed configuration、read-only source readerとnative subagent上限をimplemented | prospective Campaignの評価結果はResearch History / Candidate Poolへ未接続 |
| Human Candidate Review + fresh Independent Validation | exact Candidate setのhuman admissionとfresh Validationをimplemented。known-positive corpusは4/4で`source-validated` | GLM malformed-output補正のsecond model executionがsingle-fresh-run policyと未整合（#144） |
| Finding / Coverage / failure record | implemented | cross-context Coverage Receipt adapterは未実装 |
| Human OS Dynamic Reproduction / append-only records / external gate | Finding-bound Recipeのsingle replay、pinned-image runsc lab、Private Evidence CASまでimplemented。TranslatePress ATOをfresh labでruntime-confirmed | Runtimeはcompanion pluginとordinary configurationを受け取れるが、それを供給するresolverとResearchからPrivate Recipe保存への自動handoffは未実装 |
| actual external submission | intentionally absent | 人間が最後のSubmitを行う |

`implemented`はpublic seamからdeterministic Behavior Testを通る意味である。実provider、実Target、prospective recallの実証とは区別する。

known-positive実測のstage別内訳は[2026-09-08 Native Agent evaluation](knowledge/public-known-positive-native-agent-evaluation-2026-09-08.md)に置く。4/4は既知identityのsource-level recoveryであり、未知脆弱性のrecallまたは現行Human OS runtime接続を証明しない。

## Target acquisition

**Purpose:** Target sourceを実行せず、identity、version、provenance、canonical manifestとdigestを固定する。

**Interface:** `TargetIntake.intake`、`WordPressOrgTargetSource.observe / acquire`。

**Invariants:** archive path traversal、symlink、duplicate path、size / count limitを拒否する。canonical manifestはpathのglobal orderingを使い、Researchの起動直前source integrityと同じdigestを作る。Target package script、autoload、WordPress bootstrapを実行しない。

**Failure semantics:** acquisition、identity、provenance、archive policy failureをready packetへ丸めない。

**Code / Tests:** [`src/target-intelligence/acquisition`](../src/target-intelligence/acquisition) · [`local-directory-target-intake.test.ts`](../tests/target-intelligence/local-directory-target-intake.test.ts) · [`wordpress-org-target-source.test.ts`](../tests/target-intelligence/wordpress-org-target-source.test.ts)

## WordPress.org Update Frontier

**Purpose:** WordPress.org全pluginを同じ深さで読む前に、recent source changeをoracle-freeなTarget選定frontierへ変換する。これはTarget Selectionの入口であり、別Research modeまたは脆弱性verdictではない。

**Interface:** `WordPressOrgUpdateFrontiers.refresh / inspect`、`WordPressOrgChangesetSource.retrieve`。production Adapterはofficial read-only SVNへexact argumentで接続し、caller指定cursorから有限revision数だけを読む。schedulerはこのModuleの外に置く。

**Owned state:** content-addressedなprivate SVN log / diff evidenceと、revision cursor、current WordPress.org observation、active install / version fact、変更PHP file数、added line数、high-level navigation signalだけを持つdigest-bound Update Frontier。

**Invariants:** `trunk`のPHP変更は明示active-install policyを満たせばnavigation signalが空でもfrontierへ残す。dangerous function一致を探索空間またはFindingにせず、exact pathとadded lineをTarget Proposal / Researchへ渡さない。Target package script、autoload、WordPress bootstrapを実行しない。

**Failure semantics:** source command failure、timeout、byte ceiling、malformed log / diff、revision binding、artifact digest mismatchを空frontierへ丸めない。個別pluginのmetadata failureはplugin identity、revision、reasonをunresolved observationとして残す。同じfrontier revisionへの異なるinputはconflictにする。

**Code / Tests:** [`update-frontier`](../src/target-intelligence/update-frontier) · [`wordpress-org-update-frontier.test.ts`](../tests/target-intelligence/wordpress-org-update-frontier.test.ts)

## Update Candidate Pool assembly

**Purpose:** WordPress.org Update Frontierを、既存Target Proposalが受け取るoracle-free Candidate Poolへ変換する。これはTarget供給経路であり、別Research modeまたは差分だけを読む探索命令ではない。

**Interface:** `WordPressOrgUpdateCandidatePools.assemble / inspect`。callerはimmutable Update Frontier ref、Target Intake Policy、freshness policyと各leadのSelection Contextを渡す。

**Owned state:** input digest、Frontier / Policy refs、assembly status、source-readyなCandidate Poolとunresolved gapを持つdigest-boundなprivate Assembly Record。Candidateのupdate activityはfrontier ref、revision範囲、changeset数、PHP変更file occurrence数、added line数とhigh-level navigation signal familyに限定する。

**Invariants:** frontier観測へbindした同一version sourceを`WordPressOrgTargetSource.acquire`で再取得し、Plugin Identity、version、observation ref、Target Intake Policy、Canonical File ManifestとTarget / Selection Observationのfreshnessを検査する。frontier外のSelection Contextを拒否する。private SVN evidence ref、exact path、added source、既知advisory、patch、PoCまたはaffected functionをCandidate Pool / Researchへ渡さない。

**Failure semantics:** missing / stale Selection Context、stale Target Observation、source acquisition failureとsource binding mismatchをunresolved gapとして残す。source-readyなCandidateが一件もなければ`assembly-pending`にし、空Candidate Poolまたは未探索へ丸めない。同じassembly revisionへの異なるinput、artifact digest mismatchまたはref mismatchを拒否する。

**Code / Tests:** [`candidate-pool`](../src/target-intelligence/candidate-pool) · [`wordpress-org-update-candidate-pools.test.ts`](../tests/target-intelligence/wordpress-org-update-candidate-pools.test.ts)

## Target observations

**Purpose:** Programme eligibility、opportunity band、disclosure route、Wordfenceのpublic observationをTarget Selection factとして固定する。

**Interface:** context固有の`refresh / inspect`とProgramme Adapter。

**Invariants:** credentialはhost-private broker内に留め、observationへ混ぜない。外部factはretrieved timeとfreshnessを持つ。

**Failure semantics:** unavailable、stale、conflicting、unknownをeligibleへ補完しない。

**Code / Tests:** [`src/target-intelligence`](../src/target-intelligence) · [`programme-intelligence.test.ts`](../tests/target-intelligence/programme-intelligence.test.ts) · [`wordfence-intelligence.test.ts`](../tests/target-intelligence/wordfence-intelligence.test.ts) · [`disclosure-route.test.ts`](../tests/target-intelligence/disclosure-route.test.ts)

## Target Research History

**Purpose:** 既探索Targetを新規Targetと誤認しないよう、旧harnessからplugin identityとversionだけを現行Target Intelligenceの語彙へ一方向に正規化する。旧設計と探索・提出結果は再利用しない。

**Interface:** `TargetResearchHistories.buildFromLegacyData / inspect`。

**Owned state:** plugin identityとversionの組だけを持つdigest-boundなprivate Research History Snapshot。same versionとprior versionを混同しない。正本はrepository配下の`.private/target-intelligence/research-history`に置く。二つのlegacy research workspaceは一度きりのimport sourceとし、元データ、source identityまたはsource receiptを複製しない。

**Invariants:** source identity、source receipt、Campaign coverage、Finding、Case status、submission、outcome、CVE、脆弱性class、claim、route、affected file / function、PoC、patch、report本文をSnapshotへ保存しない。同じplugin identityとversionは一件へ正規化する。入力欠損を未探索へ丸めない。

**Failure semantics:** source root欠落、symlink、unsupported schema、identity衝突、digest不一致または同じSnapshot IDへの異なるinputを拒否する。既存Snapshotは置換しない。

**Code / Tests:** [`research-history`](../src/target-intelligence/research-history) · [`research-history.test.ts`](../tests/target-intelligence/research-history.test.ts)

## Target Proposals

**Purpose:** oracle-free Candidate PoolからAIが調査Target、理由、不確実性を提案する。

**Interface:** `TargetProposals.propose / inspect`、`TargetProposalAgent.execute`。

**Owned state:** Candidate Pool digest、sealed Selection Run、Native Receipt、Target Proposalをfile-backed revisionとして保存する。

**Invariants:** AIはpool外、source unavailable、unverified identity / provenance、stale candidateを選べない。全候補ranking、固定Bandまたはreason codeを要求しない。Grok AdapterはResearch runtimeと同じexact image digestとCLI versionだけをadmitする。

**Failure semantics:** provider、Budget、policy、invalid outputは`selection-pending`にする。同じselection revisionへの異なるinputはconflictにする。

**Code / Tests:** [`target-proposal`](../src/target-intelligence/target-proposal) · [`target-proposals.test.ts`](../tests/target-intelligence/target-proposals.test.ts) · [`grok-target-proposal-agent.test.ts`](../tests/target-intelligence/grok-target-proposal-agent.test.ts)

## Approved Target Batches

**Purpose:** 人間がProposalからResearch対象範囲、順序、Budget、execution windowを明示承認する。

**Interface:** `ApprovedTargetBatches.approve / inspect / admitDispatch`。

**Invariants:** ProposalにないTargetを追加せず、dispatch直前のidentity、version、manifest digestを再確認する。

**Failure semantics:** expired window、stale source、identity mismatchをdispatch許可へ丸めない。

**Code / Tests:** [`approved-target-batch`](../src/target-intelligence/approved-target-batch) · [`target-proposals.test.ts`](../tests/target-intelligence/target-proposals.test.ts)

## Approved Target Campaigns

**Purpose:** Approved Target Batchの一Targetを実行直前にadmitし、Target Intake、Campaign Policy、WordPress coreを含むDependency Snapshots、compactなCampaign Threat Context、source-boundなProgramme Research BoundaryからResearch `CampaignInput`を作って、そのまま一Campaignを開始する。

**Interface:** `ApprovedTargetCampaigns.conduct`。CLIは`wordpress-harness campaign conduct-approved`で同じInterfaceを使う。

**Owned state:** 新しいQueueやLedgerを持たない。Approved BatchとResearch Campaignの既存durable stateを使い、同じCampaign ID / inputの再実行はResearch側のresume semanticsへ委ねる。

**Invariants:** Batch digest、human-approved Target、execution window、fresh observation、Plugin Identity、version、Canonical File Manifest、Target Snapshot、Campaign Policy digestを一致させる。source closureはexactly oneのWordPress coreを必須とし、Dependency mountとThreat Contextのroleを一対一にする。Threat ContextはTarget選定理由、ordinary configuration、attacker position、security objective、trust boundary、high-value transition、不確実性だけを持つplanning dataであり、脆弱性class、file順、role、Waveまたは停止quotaをResearchへ命令しない。Programme Research Boundaryは公式source ref、eligible attacker position、priority impact、短い除外category、excluded asset、scope uncertaintyとhandlingをexact bodyへdigest-bindする。researcher tierとinstall threshold等のTarget eligibilityはTarget Intelligenceのadmissionに閉じ、Research inputへ複製しない。既知脆弱性、PoC、patch、affected file / functionをoracleとして含めない。Research Rootはoff-model Findingを報告できる。

**Failure semantics:** approval、freshness、Intake manifest、Campaign Policy、source closureまたはProgramme Research Boundaryの欠落・不正・digest不一致ではResearchを開始しない。Target versionをsilentに差し替えず、中央scheduler、固定並列数、Target自動補充またはprovider fallbackを行わない。

**Code / Tests:** [`approved-target-campaign`](../src/target-intelligence/approved-target-campaign) · [`approved-target-campaigns.test.ts`](../tests/target-intelligence/approved-target-campaigns.test.ts) · [`campaign-threat-context.test.ts`](../tests/research/campaign-threat-context.test.ts)

## Research Campaigns

**Purpose:** AI主導のresearch / validation loopを、authority、最大1時間のResearch Grant、両Human Review、record、Budget、terminal semanticsのbehindに隠す。

**Interface:** `ResearchCampaigns.conduct / inspect`。CLIは`campaign conduct | conduct-approved | review-research | review-candidates | retry-validation | inspect`を公開し、`retry-validation`はexact failed Validation run集合へbindしたHuman Validation Retryを受ける。

**Owned state:** Target / Dependency Snapshotsを含むCampaign input、Native Run Receipt、private Agent Checkpoint / Agent Run Diagnostic ref、parked Programme Lead、Human Research Continuation Review、Human Candidate Review、Human Validation Retry、Validation Receipt、Finding、Coverage、interruptionをSQLite append-only eventsへ記録する。provider conversation、scratch本文とcredential-redacted診断本文はprivate content-addressed stateに置く。

**Invariants:** Candidateは到着順や支持数で捨てない。[WordPress Plugin Research v2](../prompts/wordpress-plugin-research-v2.md)はwp2shell promptの研究手法を保持し、positive oracle、RCE / `/flag`到達の強制と最低6時間だけを除外する。一つのResearch Native RunへCampaign残wall timeと最大1時間の小さい方だけを与える。AIが`continue`を返すと`research-review-pending`で停止し、exact input、run、Checkpoint、Candidate、parked Programme Leadとnext actionへbindした`continue-research` reviewだけが、承認済みnext actionを同じCheckpointからの次Grantへ渡して開始する。Researchを区切ってCandidateがあれば`candidate-review-pending`で停止し、exact Candidate setで`advance-to-independent-validation`されたCandidateだけを一つのfresh Validationへ渡す。`return-to-research`があればValidationより先にResearchへ戻す。外部制約でValidationが判断前に失敗または`validation-pending`になった場合だけ、人間はcurrent latest failed runの完全な集合へbindしたHuman Validation Retryでfresh attemptを追記できる。成功済み、`source-validated`、`disproven`または`needs-research`のValidationは再試行できず、過去Receiptを置換しない。Research RootへCampaign Threat Contextがある場合はCampaign inputとCheckpointへdigest-bindしてplanning dataとして渡し、探索手順にはしない。Programme Research BoundaryもCampaign input、sealed Research runとCheckpointへdigest-bindする。eligible impactへの具体的なsource edgeがないOOS primitiveは最小限のParked Programme Leadとして保存し、subagent adversarial review、Candidate Review、ValidationまたはFindingへ流さない。Programme Research BoundaryをIndependent Validationへ渡さない。ResearchとValidationへ同じread-only Dependency Snapshotsを渡し、Agent CheckpointとFindingにもdependency digest / refsを残す。completed Research / Validation Receiptはrunsc上のgVisor実行とfallback不使用の証跡を必須とする。推定costはReceiptへ保存するが停止条件にせず、Campaign run数とwall timeだけをhard limitにする。`source-validated`だけがFindingを生成し、FindingとCoverageを分離する。

**Failure semantics:** review未提出はpendingのままNative Runを開始しない。stale input / run / Checkpoint / Candidate / parked Lead digest、partial Candidate Review、Candidateなしのproceed、stale / partial Validation Retryはatomic conflictにする。provider、run数 / wall-time Budget、policy、invalid outputは`incomplete`または`validation-pending`にする。同じCampaign IDへの異なるinputはconflictにする。Researchの`provider-failed`が有効なCheckpointを残した場合、通常の再実行は失敗Receiptを置換せずにそのdurable stateから一度だけresumeする。Agent実行前の固定runsc / image availability failureと、model workが発生しないままproviderへ認証できなかった`provider-unauthenticated`はReceiptに`retryable: true`を記録し、通常の再実行で同じsealed Grantを一度だけ再試行できる。連続failureは通常実行を繰り返さない。`provider-quota-exhausted`はretryableにせず、有効なCheckpointを残した場合だけそのdurable stateから一度だけresumeする。Target / Dependency source integrity、Checkpoint integrityその他のpolicy denialはretryableにせず、terminalなValidation infrastructure failureも新しいHuman Validation Retryなしに再実行しない。

**Code / Tests:** [`research-campaigns.ts`](../src/research/agent-led/research-campaigns.ts) · [`research-campaigns.test.ts`](../tests/research/research-campaigns.test.ts) · [`human-research-continuation-review.test.ts`](../tests/research/human-research-continuation-review.test.ts) · [`human-candidate-review.test.ts`](../tests/research/human-candidate-review.test.ts) · [`parked-programme-leads.test.ts`](../tests/research/parked-programme-leads.test.ts) · [`independent-validation.test.ts`](../tests/research/independent-validation.test.ts) · [`agent-led-campaign-cli.test.ts`](../tests/cli/agent-led-campaign-cli.test.ts)

## gVisor Native Agent Runtimes

**Purpose:** provider-native agentとsubagentをrunsc内で動かし、AI判断をproviderの既存機能へ任せる。

**Interface:** `NativeAgentRuntime.execute`、`openGrokNativeAgentRuntime`、`openClaudeCodeNativeAgentRuntime`、`openGlmNativeAgentRuntime`、`openCodexNativeAgentRuntime`。

**Invariants:** immutable image、exact CLI version、non-root UID、read-only root / Target / Dependencies、dropped capabilities、no-new-privileges、Prompt / Target / Dependency / Permission binding、ResearchとValidationの別scratchを要求する。全providerでRootを含む同時active agentを最大4体にし、Rootだけが最大3体のsubagentを起動する。Claude Code / GLMは同時上限3とspawn depth 1、Grokは同時上限3、spawn depth 1、超過時fail、Codexはprimaryを除く同時thread上限3を実行前に設定する。Grokはsealed Root profile、system-managed subagent pin、system requirementsのmodel allowlistでRootおよび全組み込みsubagent typeを`grok-4.6`へ固定する。providerが報告する`modelUsage`の実行後検査も維持し、Rootまたはsubagentが別modelを使ったrunを受理しない。Researchのprovider-native conversationとscratchはcredentialを除外したprivate Checkpointとしてcontent-addressed保存し、同じbindingだけが再開できる。ValidationはCheckpointをmountしない。sanitized provider homeはworkspace mount外へ分離し、agentのRead / Grepをdenyする。Grokはsource read用の`read_file / grep / list_dir`と、native subagent lifecycle用の`task / get_task_output / kill_task`だけを公開する探索試験の優先runtimeで、別providerへsilent fallbackしない。GrokのReport schemaはprompt本文へ渡し、providerのstructured-output制約でtool loopを抑止せず、最終response textをAdapterがschema検査する。GLM 5.3はZ.AI endpoint、固定model mapping、token等の必要なenvだけを持つstrictな一時`settings.json`をClaude Codeへ渡す。Codex Daybreakはshell、web、apps、pluginsを無効化したmanaged configurationとharness-ownedな`list_files / read_text / search_text`だけのread-only source readerを使い、providerが生成したthread identityをCheckpointへbindする。hook、plugin、追加設定はsandbox起動前に拒否し、settingsはCheckpoint確定前に除外する。新規Codex Daybreak Campaignは`xhigh`を使い、既存のimmutable Campaignを完走させるため`max` bindingも引き続きadmitする。runtimeはsealed profileのeffortをCodex CLIへそのままbindする。Grokは共通のexact image digestと1.0.13、Claude / GLMは実測済みimage digestと2.1.220、Codex Daybreakは実測済みimage digestと0.146.0だけをadmitする。

**Failure semantics:** runsc、image、unprobed version、Target / Dependency bindingとsource tree、Checkpoint integrity、policy、providerまたはschema failureをtyped terminal receiptへする。固定runscまたは固定imageをAgent実行前に確認できない場合だけ`retryable: true`を付け、source / dependency / checkpoint integrity failureには付けない。timeoutとproviderのbudget error envelopeは`budget-exhausted`であり、Checkpoint finalizationやcleanupの失敗で元のterminal分類を上書きしない。Claude Code / GLMのadmit済みusage-limit envelopeは`provider-quota-exhausted`、model workが発生しないままの認証失敗は`provider-unauthenticated`として、provider defectの`provider-failed`と区別する。通常のrate-limitをusage-limitへ推測せず、Grok / Codexはprovider-native error envelopeをprobeするまでaccount terminalへ分類しない（[ADR 0133](adr/0133-separate-provider-account-conditions-from-provider-defects.md)）。失敗Receiptにはstageと、credential-redacted stdout / stderr / errorおよびCheckpointとしてadmitできない隔離stateを保持するprivate Agent Run Diagnosticへのintegrity-bound opaque refだけを記録する。Adapterが正常終了runをpolicy denialまたはinvalid outputとして退ける場合も同じcapsuleへprovider outputを残し、sealed session bindingの失敗はtool / model policy違反とは別のsummaryにする。Diagnosticを保存できなければ証跡のないdenialとして記録せず`provider-failed`へ倒す（[ADR 0134](adr/0134-preserve-refused-provider-output-as-a-private-diagnostic.md)）。絶対path、credential、transcript本文またはsource本文はResearch Recordへ入れない。有効なAgent Checkpointだけをresumeに使い、診断用の隔離stateを自動resumeしない。providerがnon-zero exitしても、対応するerror envelopeのusage、costと有効なCheckpoint refを失わず、wall timeはprovider値とhost観測値の大きい方を記録する。現実装はGLMのouter envelopeが正常でinner JSONまたはReport shapeだけ不正な場合、Researchでは同じCheckpoint、Validationでは新しい使い捨てscratchから同一Reportの再符号化を一度だけ要求し、両attemptのusageを合算する。Validation側のsecond model executionは「candidateごとに一つのfresh source-only run」というpolicyと未整合であり、#144の判断が必要である。補正後も不正なら`invalid-output`を維持する。

**Code / Tests:** [`gvisor-agent-sandbox.ts`](../src/research/agent-led/gvisor-agent-sandbox.ts) · [`grok-native-agent-runtime.ts`](../src/research/agent-led/grok-native-agent-runtime.ts) · [`claude-code-native-agent-runtime.ts`](../src/research/agent-led/claude-code-native-agent-runtime.ts) · [`codex-native-agent-runtime.ts`](../src/research/agent-led/codex-native-agent-runtime.ts) · [`codex-source-reader.ts`](../src/research/agent-led/codex-source-reader.ts) · [`grok-native-agent-runtime.test.ts`](../tests/research/grok-native-agent-runtime.test.ts) · [`claude-code-native-agent-runtime.test.ts`](../tests/research/claude-code-native-agent-runtime.test.ts) · [`glm-native-agent-runtime.test.ts`](../tests/research/glm-native-agent-runtime.test.ts) · [`codex-native-agent-runtime.test.ts`](../tests/research/codex-native-agent-runtime.test.ts)

## Human OS

**Purpose:** immutable Findingをfresh Dynamic Reproductionへ渡してruntime / human assuranceをappendし、外部行動を人間のexact authorizationでgateする。

**Interface:** `HumanOs.receiveFinding / reproduceFinding / recordAIReproduction / recordHumanVerification / saveSubmissionDraft / authorizeExternalAction / admitExternalAction / inspect`。production Adapterは`openGvisorWordPressDynamicReproductionRuntime`と`openRecipeDynamicReproductionAgent`。

**Owned state:** Finding、AI Reproduction Record、Human Verification Record、Draft、AuthorizationをSQLite v3 eventsへ保存する。exact experiment script、HTTP / browser output、screenshot、runtime logはGit外のcontent-addressed Private Evidenceへ保存し、public Recordにはdigest refだけを置く。

**Invariants:** Target source treeをFindingのcanonical digestへ再照合してから、immutable imageのWordPress / MariaDB / WP-CLI / experiment workerをinternal network上のfresh runsc labだけで動かす。Targetが単体で動かないplugin（WooCommerce前提のadd-on等）は、FindingにbindされたDependency Snapshotからcompanion pluginを解決し、そのcanonical source treeを必ず再照合してTargetより先にinstall / activateする。site ownerが管理画面で行う程度のordinary configurationはFinding ID、Target digest、Dependency Snapshot集合へbindしたversioned Dynamic Reproduction Lab Setupとして全plugin有効化後に一度`wp eval`で適用し、attackerへordinary構成が与えない権限を与えない。Dynamic Reproduction Recipeはversion、body digest、Finding ID、Target Snapshot digestへbindし、Private resolverからだけ取得する。Recipeを一度だけ実行し、attack script自身がmatched preconditions、completed recipe、observed effectを構造化して返した3条件がすべて真の時だけ`runtime-confirmed`にする。動的検証内でsource再探索、AI review、patched controlまたは追加experimentを行わず、効果未観測、Recipe / fixture不足、曖昧な出力または失敗は`disproved`でなく`incomplete`にする。conclusive outcomeはprivate runtime evidenceと観測済みcleanupも必須にする。runtimeとhuman verificationは異なるfresh environment identityを持つ。どの結果でもFindingは削除しない。Draft revisionは連続し、authorizationはexact Draft digestとdestinationへbindする。

**Failure semantics:** Target / Dependencyのsource / runsc / image mismatchはlabを起動しない。provision、Recipe解決、attack実行、ambiguous observation、cleanupまたはPrivate Evidence failureは`incomplete`としてappendし、途中のprivate transcriptを可能な範囲で残す。Facebook、PayPal等の外部sandbox identityが必要なら`external-dependency-required`のEvidence Requestとしてservice、human setup判断、最小権限、検証目標を残し、`disproved`にしない。Finding不在、Draft不在、human confirmation不在、exact authorization不在はexternal actionを拒否する。Harnessは送信しない。

**Code / Tests:** [`src/human-os`](../src/human-os) · [`dynamic-ai-reproduction.test.ts`](../tests/human-os/dynamic-ai-reproduction.test.ts) · [`gvisor-wordpress-dynamic-reproduction.test.ts`](../tests/human-os/gvisor-wordpress-dynamic-reproduction.test.ts) · [`recipe-dynamic-reproduction-agent.test.ts`](../tests/human-os/recipe-dynamic-reproduction-agent.test.ts) · [`agent-led-human-os.test.ts`](../tests/human-os/agent-led-human-os.test.ts)

## CLI

**Purpose:** Codex / Claude Code等の対話control planeからlocal Campaignのconduct、両Human Reviewとread-only inspectionを公開する。

**Interface:** `wordpress-harness campaign conduct | conduct-approved | review-research | review-candidates | retry-validation | inspect`。

**Invariants:** provider Adapterはsealed `agentRuntimeProfile.kind`から選び、Prompt本文のdigest一致をruntimeが検査する。`--dependency-source <mount>=<directory>`はCampaignにsealされた全Dependencyと過不足なく対応する。production buildは`dist`を先にcleanし、現行`src`に対応しないstale artifactをbuild verifierが拒否する。

**Failure semantics:** unsupported runtime、missing option、invalid inputはnon-zeroで終了する。`inspect`はNative Runを起動しない。

**Code / Tests:** [`src/cli.ts`](../src/cli.ts) · [`agent-led-campaign-cli.test.ts`](../tests/cli/agent-led-campaign-cli.test.ts)

## Repository gate

`pnpm check`はformat、strict typecheck、Behavior Tests、build、documentation link checkを行う。private helperやcall順ではなく、上記public seamからbehaviorを観測する。
