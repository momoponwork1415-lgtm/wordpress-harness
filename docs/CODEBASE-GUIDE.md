# Codebase Guide

Status: current implementation map, 2026-09-07

現在動くproduction seam、owner、failure semantics、Behavior Testを示す。設計理由は[ADR 0125](adr/0125-put-agent-decisions-behind-thin-evidence-shells.md)と[ADR 0127](adr/0127-make-validated-findings-the-product-success-criterion.md)、research policyは[Research Design](RESEARCH-DESIGN.md)を参照する。

診断coreは`Target Snapshot -> agent-led Research -> Independent Source Validation -> Finding`である。Source Validationは明白なsource矛盾を落とすsanity gateで、実質的なtrue-positive assuranceはHuman OSのfresh Dynamic AI Reproductionが所有する。Target Selectionと隔離方式の高度化はsupporting workflowまたはAdapter内部の関心であり、診断coreのpromotion blockerではない。

## Current capability

| Capability | State | Important gap |
| --- | --- | --- |
| local / WordPress.org source acquisition | implemented | Approved Batchからの自動dispatchは未接続 |
| Programme / disclosure observations | implemented | 全Programmeを一つのCandidate Poolへ組み立てるapplication serviceは未実装 |
| AI Target Proposal | exact Grok transportをadmitするproduction Adapterまでimplemented | CLIとCandidate Pool組立serviceが未実装 |
| human Approved Target Batch | implemented | Research `CampaignInput`への変換が未接続 |
| agent-led Research loop | pinned Dependency Snapshotとprivate Agent Checkpointからのresumeまでimplemented、Claude benign smoke / resume probe完走 | GLM 5.3がknown-positive Brizyを再発見しfresh Validation済み。Dependency付きknown-positive corpusは再評価中 |
| Grok native runtime | exact image / CLI versionをadmitし、structurally tested | real Brizy runはproviderのHTTP 402で未完了 |
| Claude Code native runtime | exact imageをreal boundary-probed | admitted image以外は再probeが必要 |
| GLM native runtime | exact Claude Code imageからZ.AI GLM 5.3へ接続し、runscでreal research / native subagent / fresh Validationを実行済み | Brizy boundary pair全体は未完了 |
| fresh Independent Validation | implemented | Brizy positiveで実測済み。残るknown-positive corpusは未完了 |
| Finding / Coverage / failure record | implemented | cross-context Coverage Receipt adapterは未実装 |
| Human OS append-only records and external gate | implemented | fresh WordPress / MySQL Dynamic AI Reproductionのprovision / executionは未接続 |
| actual external submission | intentionally absent | 人間が最後のSubmitを行う |

`implemented`はpublic seamからdeterministic Behavior Testを通る意味である。実provider、実Target、prospective recallの実証とは区別する。

## Target acquisition

**Purpose:** Target sourceを実行せず、identity、version、provenance、canonical manifestとdigestを固定する。

**Interface:** `TargetIntake.intake`、`WordPressOrgTargetSource.observe / acquire`。

**Invariants:** archive path traversal、symlink、duplicate path、size / count limitを拒否する。canonical manifestはpathのglobal orderingを使い、Researchの起動直前source integrityと同じdigestを作る。Target package script、autoload、WordPress bootstrapを実行しない。

**Failure semantics:** acquisition、identity、provenance、archive policy failureをready packetへ丸めない。

**Code / Tests:** [`src/target-intelligence/acquisition`](../src/target-intelligence/acquisition) · [`local-directory-target-intake.test.ts`](../tests/target-intelligence/local-directory-target-intake.test.ts) · [`wordpress-org-target-source.test.ts`](../tests/target-intelligence/wordpress-org-target-source.test.ts)

## Target observations

**Purpose:** Programme eligibility、opportunity band、disclosure route、Wordfenceのpublic observationをTarget Selection factとして固定する。

**Interface:** context固有の`refresh / inspect`とProgramme Adapter。

**Invariants:** credentialはhost-private broker内に留め、observationへ混ぜない。外部factはretrieved timeとfreshnessを持つ。

**Failure semantics:** unavailable、stale、conflicting、unknownをeligibleへ補完しない。

**Code / Tests:** [`src/target-intelligence`](../src/target-intelligence) · [`programme-intelligence.test.ts`](../tests/target-intelligence/programme-intelligence.test.ts) · [`wordfence-intelligence.test.ts`](../tests/target-intelligence/wordfence-intelligence.test.ts) · [`disclosure-route.test.ts`](../tests/target-intelligence/disclosure-route.test.ts)

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

## Research Campaigns

**Purpose:** AI主導のresearch / validation loopを、authority、record、Budget、terminal semanticsのbehindに隠す。

**Interface:** `ResearchCampaigns.conduct / inspect`。

**Owned state:** Target / Dependency Snapshotsを含むCampaign input、Native Run Receipt、private Agent Checkpoint ref、Validation Receipt、Finding、Coverage、interruptionをSQLite append-only eventsへ記録する。provider conversationとscratch本文はprivate content-addressed stateに置く。

**Invariants:** candidateは到着順や支持数で捨てない。Research decisionが`continue`である間はcandidateを蓄積してRootの連続Researchを優先し、Rootが停止した後にだけ各candidateを一つのfresh Validationへ渡す。ResearchとValidationへ同じread-only Dependency Snapshotsを渡し、Agent CheckpointとFindingにもdependency digest / refsを残す。複数Targetは別Campaign processとして並列実行し、Campaign間でstateを共有しない。completed Research / Validation Receiptはrunsc上のgVisor実行とfallback不使用の証跡を必須とする。各runへ累積使用量を引いた残りのwall time / costだけを渡し、超過したterminal reportでCoverageを閉じない。`source-validated`だけがFindingを生成する。FindingとCoverageを分離する。

**Failure semantics:** provider、Budget、policy、invalid outputは`incomplete`または`validation-pending`にする。同じCampaign IDへの異なるinputはconflictにする。再実行はdurable stateからresumeする。

**Code / Tests:** [`research-campaigns.ts`](../src/research/agent-led/research-campaigns.ts) · [`research-campaigns.test.ts`](../tests/research/research-campaigns.test.ts) · [`independent-validation.test.ts`](../tests/research/independent-validation.test.ts)

## gVisor Native Agent Runtimes

**Purpose:** provider-native agentとsubagentをrunsc内で動かし、AI判断をproviderの既存機能へ任せる。

**Interface:** `NativeAgentRuntime.execute`、`openGrokNativeAgentRuntime`、`openClaudeCodeNativeAgentRuntime`、`openGlmNativeAgentRuntime`。

**Invariants:** immutable image、exact CLI version、non-root UID、read-only root / Target / Dependencies、dropped capabilities、no-new-privileges、Prompt / Target / Dependency / Permission binding、ResearchとValidationの別scratchを要求する。Researchのprovider-native conversationとscratchはcredentialを除外したprivate Checkpointとしてcontent-addressed保存し、同じbindingだけが再開できる。ValidationはCheckpointをmountしない。sanitized provider homeはworkspace mount外へ分離し、agentのRead / Grepをdenyする。Grokは`read_file / grep / list_dir / task`だけを公開する探索試験の優先runtimeで、別providerへsilent fallbackしない。GLM 5.3はZ.AI endpoint、固定model mapping、token等の必要なenvだけを持つstrictな一時`settings.json`をClaude Codeへ渡す。hook、plugin、追加設定はsandbox起動前に拒否し、settingsはCheckpoint確定前に除外する。Grokは共通のexact image digestと1.0.13、Claude / GLMは実測済みimage digestと2.1.220だけをadmitする。

**Failure semantics:** runsc、image、unprobed version、Target / Dependency bindingとsource tree、Checkpoint integrity、policy、providerまたはschema failureをtyped terminal receiptへする。timeoutとproviderのbudget error envelopeは`budget-exhausted`である。providerがnon-zero exitしても、対応するerror envelopeのusage、costと有効なCheckpoint refを失わず、wall timeはprovider値とhost観測値の大きい方を記録する。GLMのouter envelopeが正常でinner JSONまたはReport shapeだけ不正な場合は、Researchは同じCheckpoint、Validationは新しい使い捨てscratchで同一Reportの再符号化を一度だけ要求し、両attemptのusageを合算する。補正後も不正なら`invalid-output`を維持する。

**Code / Tests:** [`gvisor-agent-sandbox.ts`](../src/research/agent-led/gvisor-agent-sandbox.ts) · [`grok-native-agent-runtime.ts`](../src/research/agent-led/grok-native-agent-runtime.ts) · [`claude-code-native-agent-runtime.ts`](../src/research/agent-led/claude-code-native-agent-runtime.ts) · [`grok-native-agent-runtime.test.ts`](../tests/research/grok-native-agent-runtime.test.ts) · [`claude-code-native-agent-runtime.test.ts`](../tests/research/claude-code-native-agent-runtime.test.ts) · [`glm-native-agent-runtime.test.ts`](../tests/research/glm-native-agent-runtime.test.ts)

## Human OS

**Purpose:** immutable Findingをfresh Dynamic AI Reproductionへ渡してruntime / human assuranceをappendし、外部行動を人間のexact authorizationでgateする。

**Interface:** `HumanOs.receiveFinding / recordAIReproduction / recordHumanVerification / saveSubmissionDraft / authorizeExternalAction / admitExternalAction / inspect`。

**Owned state:** Finding、AI Reproduction Record、Human Verification Record、Draft、AuthorizationをSQLite v3 eventsへ保存する。

**Invariants:** Dynamic AI Reproductionは実WordPress / MySQLをfresh gVisor environment内だけで動かす。AIとhuman verificationは異なるfresh environment identityを持つ。`runtime-confirmed / disproved / incomplete`のどの結果でもFindingは削除しない。環境、依存条件、手順またはBudgetで決着しない場合を`disproved`へ丸めない。Draft revisionは連続し、authorizationはexact Draft digestとdestinationへbindする。

**Failure semantics:** Dynamic runtimeのprovision、recipe、dependency、Budgetまたはevidence failureは`incomplete`として記録する。Finding不在、Draft不在、human confirmation不在、exact authorization不在はexternal actionを拒否する。Harnessは送信しない。

**Code / Tests:** [`src/human-os`](../src/human-os) · [`agent-led-human-os.test.ts`](../tests/human-os/agent-led-human-os.test.ts) · [`context-interface.test.ts`](../tests/human-os/context-interface.test.ts)

## CLI

**Purpose:** local Campaignのconductとread-only inspectionだけを公開する。

**Interface:** `wordpress-harness campaign conduct | inspect`。

**Invariants:** provider Adapterはsealed `agentRuntimeProfile.kind`から選び、Prompt本文のdigest一致をruntimeが検査する。`--dependency-source <mount>=<directory>`はCampaignにsealされた全Dependencyと過不足なく対応する。production buildは`dist`を先にcleanし、現行`src`に対応しないstale artifactをbuild verifierが拒否する。

**Failure semantics:** unsupported runtime、missing option、invalid inputはnon-zeroで終了する。`inspect`はNative Runを起動しない。

**Code / Tests:** [`src/cli.ts`](../src/cli.ts) · [`agent-led-campaign-cli.test.ts`](../tests/cli/agent-led-campaign-cli.test.ts)

## Repository gate

`pnpm check`はformat、strict typecheck、Behavior Tests、build、documentation link checkを行う。private helperやcall順ではなく、上記public seamからbehaviorを観測する。
