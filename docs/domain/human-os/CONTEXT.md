# Human OS

Researchから受け取ったsource-validated candidateをAIがfresh環境で再現し、人間がAIの理解支援を使いながら別fresh環境で必ず再実行して、Finding、report、外部行動を判断するcontext。web画面の名称ではなく、runtime evidence、triage queue、decision systemを指す。

## Language

**Runtime Verification Packet**:
一つのReady-for-runtime candidateについて、固定Target/version、Manifest、attacker premise、Evidence Route、Validation、Risk、runtime uncertainty、reproduction sketchを自己完結に固定したResearchからのhandoff。Human OSはResearch storageを直接参照せずこのPacketだけからAI Reproductionを開始する。人間向けの完成手順ではない。
_Avoid_: Human Review Packet、Triage Reproduction Packet、Finding

**AI Reproduction**:
Runtime Verification Packetをfreshな使い捨て環境と実Target interfaceで試し、Security Effectを観測できるか判断するHuman OSの実行段階。成功してもFindingまたはHuman Verificationにはならない。
_Avoid_: Research Validation、Human Verification、Automatic Finding

**Reproduction Recipe**:
固定Target/version、初期状態、attackerとvictim role、操作面、正確なpayload、手順、期待するSecurity Effect、判定方法を持つ人間再実行用の手順。SQLiやXSS等のclass固有criterionまたはgeneric criterionを持てるが、固定Adapterへの対応を要求しない。
_Avoid_: Exploration plan、Source route、Free-form note

**Private Evidence Bundle**:
AIまたは人間の一回の再現に属するexact payload、HTTP request、screenshot、runtime logを保持するHuman OS内の非公開artifact。credentialを含めず、Research LedgerまたはGitへ渡さない。
_Avoid_: Sanitized summary、Transcript、Submission Draft

**Triage Reproduction Packet**:
Runtime Verification Packet、runtime-confirmedなAI Reproduction、Reproduction Recipe、Private Evidence Bundle参照を結び付けた人間向けhandoff。人間が別fresh instanceで同じ主張を再実行するための入力であり、Findingではない。
_Avoid_: Runtime Verification Packet、Human Review Packet、Finding

**Vulnerability Understanding Response**:
Triage Reproduction Packet、Runtime Verification Packet、Private Evidence Bundle、manifest-bound sourceを根拠に、broken security semantics、source route、attacker premise、confirmed Security Effect、plausible abuse scenario、Recipeの意味を人間へ説明するAI応答。確認済み事実、artifactからの推論、仮説を分離し、人間のfresh再実行またはReview Dispositionを代替しない。
_Avoid_: Model verdict、Finding、Report approval

**Human Review Case**:
一つのRuntime Verification Packetと、それに対するAI Reproduction、Triage Reproduction Packet、Vulnerability Understanding Response、Human Verification、Evidence Request、Review Dispositionの履歴を結び付けるappend-only review単位。
_Avoid_: Ticket、Finding、Research Run

**Human Verification Queue**:
runtime-confirmedなTriage Reproduction Packetをimpact、attacker premise、novelty、人間のreproduction costで並べるHuman OS所有の待機集合。総件数は制限せず、設定可能なactive concurrencyを越えたCaseは完了後に繰り上げる。
_Avoid_: Research Validation Queue、Permanent defer、Dropped candidates

**Escalation Queue**:
high-impactだがAI Reproductionがruntime-inconclusiveとなったCaseを、人間が明示的に選べる状態で保持する待機集合。通常のHuman Verification Queueへ自動昇格しない。
_Avoid_: Human Verification Queue、Rejected、Automatic escalation

**Human Deferred**:
runtime-confirmedだがactive concurrencyまたは人間の容量によりHuman Verificationを開始していないHuman Review Caseのscheduling状態。完了したactive Caseの後に再評価され、false positiveまたはRejectedを意味しない。
_Avoid_: Rejected、Disproved、Validation Pending

**Human Verification**:
人間がAI instanceとは異なるfresh環境でTriage Reproduction PacketのRecipeを必ず再実行し、Security Effect、実施者、時刻、操作差分とDispositionを記録するreview行為。AI evidenceの閲覧だけでは成立しない。
_Avoid_: Research Validation、Model verdict、External Action Authorization

**Human Verification Environment**:
固定runtime上でWordPress、plugin、database、browserを実行し、case後に破棄できる隔離zone。gVisor、専用VMまたは安全に構成したcontainerを使えるが、host上でtarget codeを実行しない。
_Avoid_: Agent Sandbox、Development environment、Production site

**Environment Dependency Snapshot**:
主対象pluginの通常動作または特定Configuration Variantに必要な追加pluginのsource、version、設定、由来を固定した環境条件。独立したTargetまたはResearch探索の起点ではない。
_Avoid_: Secondary Target、Plugin bundle、Dependency Campaign

**Canonical Configuration**:
pluginをsingle-site WordPressへinstall・activateし、公式手順に沿って最小限の通常機能を利用可能にした再現可能な設定。基準localeは`en_US`、timezoneはUTCとし、異なる条件はConfiguration Variantとして扱う。
_Avoid_: Default state、Test setup

**Configuration Variant**:
特定Packetの再現に必要なoptional feature、Multisite、環境依存、install directoryまたはstateを、Canonical Configurationとの差分とPacket根拠付きで固定した設定。
_Avoid_: Special setup、Hidden premise

**Runtime Profile**:
Human Verification Environmentを再現するWordPress、PHP、database、web server、image、isolation backendのidentityをdigest付きで固定した実行条件。Case中に`latest`を再解決しない。
_Avoid_: Environment name、Docker tag、Current stack

**Setup Plan**:
Canonical ConfigurationまたはConfiguration Variantを成立させるための許可操作、順序、客観的success criterionをversionとdigestへ固定した計画。自由形式のinstall scriptまたはmodelの成功判断ではない。
_Avoid_: Shell script、Setup prompt、Runbook

**Setup Receipt**:
一つのSetup Planについて、固定入力、各段階の結果、runtime identity、sanitized evidence、最終的なreadyまたはSetup Blockedを結び付けた不変の記録。
_Avoid_: Install log、Container log

**Functional Smoke**:
対象pluginの代表的な通常利用操作と、その客観的な結果を確認する最小の試行。単なるHTTP health checkまたはmodelの主観判断ではない。
_Avoid_: Page ping、Security Experiment、Model verdict

**Setup Blocked**:
受入済みTarget SnapshotからHuman Verification Environment内でConfigurationを成立させられず、Caseを再現できないReview状態。ResearchのValidation、脆弱性不在または誤検出を意味しない。
_Avoid_: Install error、Rejected Target、Disproved

**Lab Baseline**:
必要な場合にHuman Verification EnvironmentまたはHuman Verification Assistantのfresh instanceを生成する、Runtime Profile、Target Snapshot、Setup Plan、seed state、正常機能確認をhash固定した変更不能な起点。
_Avoid_: Running Lab、Docker image only

**Runtime-confirmed**:
AI Reproductionがfresh環境でRecipeのattacker sequenceを実行し、定義済みSecurity Effectを観測した状態。通常のHuman Verification Queueへ進められるが、Findingではない。
_Avoid_: Human-verified、Finding、Source-confirmed

**Runtime-inconclusive**:
AIまたは人間の再現が、環境不一致、unsupported mechanismまたは曖昧な観測によりSecurity Effectの成立も不成立も閉じられない状態。Rejectedまたは脆弱性不在を意味しない。
_Avoid_: Disproved、Rejected、Failed Finding

**Experiment**:
一つのHuman Review Caseを支持または反証するために、事前にsuccess criterionを定めて行う再現可能な試行。
_Avoid_: Test、Probe、Model argument

**Witness**:
Experimentまたは人間の再現がsecurity propertyの破壊を客観的に示した結果。
_Avoid_: Argument、Model verdict、Finding

**Security Effect**:
固定Targetのfresh環境でattacker sequence後に観測できるsecurity propertyのterminalな変化。脆弱性名、payload文字列または中間状態だけをeffectと呼ばない。
_Avoid_: Vulnerability category、Exploit recipe、Intermediate state

**Causal Control**:
成立証拠と同じsurfaceおよび環境を使い、仮定した原因要素だけを除くことでSecurity Effectが消えることを示す比較結果。Human Verificationで有用なproof methodだが、全caseへ同じ形式を強制しない。
_Avoid_: Benign sample、Unrelated negative test、Mandatory Finding field

**Execution Canary**:
使い捨ての隔離環境内だけでcodeまたはcommand executionを示す、一回限りのnonce付き無害effect。interactive access、外部egress、実data取得、永続backdoorを含まない。
_Avoid_: Reverse shell、Persistent payload、Host command

**Review Disposition**:
Human Review Caseに対する`verified-finding`、`rejected`、`runtime-inconclusive`、`more-evidence-required`、`blocked`のいずれかの理由付き人間判断。`rejected`は前提一致かつRecipe完走後のeffect非観測だけに使う。
_Avoid_: Model verdict、Queue status、External approval

**Finding**:
固定Target/versionに対し、人間がAIとは別のfresh環境でReproduction Recipeを完走し、broken security propertyとattacker premiseを確認した脆弱性。Research Validation、AI Reproductionまたはmodel verdictだけでは生成しない。
_Avoid_: Ready-for-runtime、Runtime-confirmed、Legacy Automated Finding

**Evidence Request**:
人間がReview Dispositionを決めるために不足しているsourceまたはruntime観測、acceptance criterion、元Packet digestを明示し、既存PacketまたはResearch Ledgerを書き換えずResearchへ返す不変な要求。
_Avoid_: Comment、Retry、Finding edit

**Programme Disposition**:
Findingを特定のProgramme Eligibility Snapshotに照らし、`eligible`、`ineligible`、`needs-current-policy`のいずれかと根拠へ固定した外部行動用の判定。Findingの技術的真偽を変更しない。同じFindingについてProgrammeごとに独立して作る。
_Avoid_: Human Verification outcome、False positive、Submission receipt

**Programme Assignment**:
一つのverified Findingを、提出候補となる一つのProgramme Identityへ割り当てた人間判断。複数ProgrammeのProgramme Dispositionを比較できるが、一つのFindingを複数提出先へ同時に割り当てない。人間がSubmission Stagingを開始するまではsupersedeでき、開始後は別Programmeへ自動転送しない。
_Avoid_: Programme Disposition、Automatic routing、Multi-programme submission

**Current Version Review**:
固定Target SnapshotのResearch結果について、Human Verification直前に現在の最新安定版を再取得し、同じCausal IdentityとSecurity Effectが残るか確認するreview。更新があれば元Campaignを付け替えず、最新versionでAI Reproductionを更新してから同じversionをHuman Verification対象にする。
_Avoid_: Campaign upgrade、Patch diff oracle、Mutable Target Snapshot

**Submission Timeline**:
一つのFindingについて`candidate-observed-at`、`human-verified-at`、`programme-assigned-at`、`staged-at`、`submitted-at`と、適用Programme規則から導いた期限を結ぶ外部行動用の時系列。期限は最も保守的な既知起点から表示するが、自動Submitを許可しない。
_Avoid_: Campaign timeline、Auto-submit timer、Research deadline

**Submission Draft Packet**:
一つのverified Finding、Triage Reproduction Packet、Human Verification、Vulnerability Understanding Response、Programme Assignment、対象version、root cause、source route、confirmed impact、plausible abuse scenario、exact reproduction、sanitized evidenceをversioned templateへ固定したAI生成draft。Human Verification後に作り、人間の承認、External Action Authorizationまたは送信を意味しない。
_Avoid_: Approved Submission Draft、Submitted Report、Form State

**Approved Submission Draft**:
人間がSubmission Draft PacketのPoC、Description、前提、version、impactを確認し、必要な修正とrevisionを記録して承認した提出準備artifact。承認済みrevisionだけをProgramme固有Form Stagerへ渡し、承認後の変更は再承認を要求する。SubmitまたはProgramme受理を意味しない。
_Avoid_: Submission Draft Packet、External Action Authorization、Submitted Report

**Known Duplicate Disposition**:
Findingを対象plugin、affected versionの重なり、Causal Identityによって既知脆弱性と照合し、新規、重複または判定不能と根拠へ固定した外部行動用の判定。Researchの探索またはValidationへ逆流させない。
_Avoid_: Hypothesis deduplication、Oracle hint、Rejected

**External Dependency Grant**:
Human Verification Environmentが特定の外部serviceへ接続する必要性、最小接続範囲、test account、credential、記録、上限を実行前に固定したnetwork capability。
_Avoid_: Internet access、Domain allowlist only

**SecretRef**:
Credential Brokerが保持するsecretを値を露出せず参照するopaque identity。Review recordにはscope、期限、receiptだけを残す。
_Avoid_: Token、Environment variable

**Credential Broker**:
External Dependency Grantに従い、専用test credentialを最終利用境界で注入し、rotation、revocation、redactionを記録するtrusted component。
_Avoid_: Secret file mount、Shared account

**External Action Authorization**:
特定のreport、vendor communication、issue、PRまたは公開行為を明示的に許可する人間の判断。Human Verification成功から暗黙に導かない。
_Avoid_: Human Verification、Programme eligibility、Implicit consent
