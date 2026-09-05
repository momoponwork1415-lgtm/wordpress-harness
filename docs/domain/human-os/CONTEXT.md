# Human OS

Researchから受け取ったsource-validated candidateを人間がfreshに再現し、Finding、不足証拠、棄却、外部行動を明示的に判断するcontext。web画面の名称ではなく、人間のwork queue、隔離Verification、decision systemを指す。

## Language

**Human Review Packet**:
一つのReady-for-human candidateについて、固定Target/version、Manifest、deduped Hypothesis、attacker premise、Evidence Route、source引用、調べたcontrol、Validation AttemptとSynthesis、runtime uncertainty、Risk Assessment、reproduction sketchをdigest固定したResearchからの自己完結handoff。
_Avoid_: Finding、Report、Transcript

**Human Review Case**:
一つのHuman Review Packetと、それに対するHuman Verification、Evidence Request、Review Dispositionの履歴を結び付けるappend-only review単位。
_Avoid_: Ticket、Finding、Research Run

**Human Verification Queue**:
Human Review Packetをimpact、弱いattacker premise、source closure、novelty、人間のreproduction costで並べるHuman OS所有の待機集合。初期policyでは一Campaign最大三つのunique mechanismをactiveにする。
_Avoid_: Research Validation Queue、Global severity heap、Dropped candidates

**Human Deferred**:
Ready-for-humanだがactive枠または人間の容量によりHuman Verificationを開始していないHuman Review Caseのscheduling状態。false positive、Rejected、Research incompleteを意味しない。
_Avoid_: Rejected、Disproved、Validation Pending

**Human Verification**:
人間が固定Target/versionと実Target interfaceをfreshな使い捨て隔離環境で操作し、attacker role、手順、観測したSecurity Effect、実施者、時刻を記録して主張の成立または不成立を判断する一回のreview行為。旧Human Confirmationを別gateとして重ねない。
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

**Human Verification Assistant**:
Human Verificationを支援する任意のgVisor-based typed Experiment実行機構。機械生成したWitness、Causal Control、normal-function observationをReview Caseへ添付できるが、Findingを自動生成せず、未対応または利用不能でも人間の別proof methodを禁止しない。
_Avoid_: Automatic Finding gate、Required backend、Research Verification Module

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
Human Review Caseに対する`verified-finding`、`rejected`、`more-evidence-required`、`blocked`のいずれかの理由付き人間判断。Human Deferredはscheduling状態でありDispositionではない。
_Avoid_: Model verdict、Queue status、External approval

**Finding**:
固定Target/versionに対し、Human Verificationが実Target interfaceでbroken security propertyとattacker premiseを確認し、再現記録へ結び付けた脆弱性。Research Validation、static ruleまたはmodel verdictだけでは生成しない。
_Avoid_: Ready-for-human、Hypothesis、Legacy Automated Finding

**Evidence Request**:
人間がReview Dispositionを決めるために不足しているsourceまたはruntime観測、acceptance criterion、元Packet digestを明示し、既存PacketまたはResearch Ledgerを書き換えずResearchへ返す不変な要求。
_Avoid_: Comment、Retry、Finding edit

**Programme Disposition**:
Findingを特定のWordfence適格性スナップショットに照らし、`eligible`、`ineligible`、`needs-current-policy`のいずれかと根拠へ固定した外部行動用の判定。Findingの技術的真偽を変更しない。
_Avoid_: Human Verification outcome、False positive、Submission receipt

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
