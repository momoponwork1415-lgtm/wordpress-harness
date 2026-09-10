# Research Context

Researchは一つのimmutable Target Snapshotをagent-ledに調査し、fresh Independent ValidationだけからFindingを作り、FindingとCoverageを別々に記録するBounded Contextである。

## Boundary

ResearchはTarget選定、source acquisition policy、runtime exploit verification、提出先または外部送信を所有しない。Target Intelligenceがadmitしたversioned Campaign Inputを受け、Human OSへsource-validated Findingだけを渡す。

## Ubiquitous language

**Campaign**
: 一つのsealed Target、Dependency群、Prompt、Agent Runtime、Permission、Budgetを持つ継続可能な調査単位。

**Campaign Input**
: Campaign identity、Target / Dependency Snapshots、Prompt、Agent Runtime、Permission、Budgetと任意のCampaign Threat Contextを持つversioned command。同じCampaign IDへ異なるinputを使えない。

**Campaign Threat Context**
: Target選定で観測したordinary configuration、attacker position、security objective、trust boundary、high-value transition、Dependency roleと不確実性をRootへ渡すdigest-bound planning data。既知脆弱性、固定routeまたは探索手順ではなく、off-model Findingを許す。

**Target Snapshot**
: plugin identity、version、canonical manifest digestで固定したread-only source。Research中に更新しない。

**Dependency Snapshot**
: WordPress core等のauthoritative behaviorをmemoryではなくsourceから解決するため、identity、version、canonical manifest digestで固定したread-only reference source。audit Targetではない。

**Native Agent Runtime**
: sealed ResearchまたはValidation Runをprovider-native agentへ渡し、typed Receiptを返す外部dependency。AIの研究判断を所有しない。

**Root Agent**
: Target全体から仮説、読む順序、native subagent、candidateを決め、継続と停止を提案するAI actor。固定Finder roleやDepth phaseではない。

**Discovery**
: Root Agentがsource-boundな仮説、Candidateとparked Programme Leadを更新するResearchの探索部分。AIの`continue`は次のGrantの提案であり、自動実行ではない。Independent Validationを割り込ませない。

**Research Grant**
: 一つのwall-time allowanceで区切った一回のResearch Native Run。allowanceは最大1時間で、終了時に必ずResearch ReportとCheckpointを回収する。

**Research Report**
: Candidate群、parked Programme Lead群と`continue`または`stop`の判断を持つ一回のNative Run出力。

**Human Research Continuation Review**
: `continue`を返したGrantのCampaign input、run、Checkpoint、Candidate、parked Programme Leadとnext actionへdigest-bindした人間の判断。`continue-research`だけが次のGrantを開始し、Candidateがある時だけ`proceed-to-candidate-review`を選べる。

**Agent Checkpoint**
: Research Rootのprovider-native conversationとscratchを同じsealed bindingで再開するためのprivateなopaque ref。研究上の結論ではなく、Independent Validationやcontext間handoffへ渡さない。

**Agent Run Diagnostic**
: Native Run失敗時のstage、credential-redacted process observationと、Checkpointとしてadmitできなかった隔離stateを保持するprivate capsuleへのintegrity-bound opaque ref。Researchの結論ではなく、自動resumeには使わない。

**Next Action**
: 追加で確認する具体的なquestionとsource pointer。AIがResearch継続を選ぶ根拠であり、Harness-owned queueではない。

**Validation Candidate**
: unauthenticatedまたはSubscriber / Customerからprogramme-eligible impactへ至るattacker premise、broken security property、claim、初期source evidenceを持つ独立検証対象。eligible impactにはArbitrary PHP File Upload / Read / Deletion、Arbitrary Options Update、RCE、Authentication Bypass / Privilege Escalation to Administrator、Stored XSS、SQL Injectionとprogramme上criticalなunauthorized data alteration / readを含む。

**Parked Programme Lead**
: Programme Research Boundary上で、現時点のsourceがeligible impactへの具体的なedgeを支持しないprimitiveの軽量記録。attacker premise、primitive、最大source-supported effectとevidenceを残すが、subagentによる敵対的検証、Human Candidate Review、Independent ValidationまたはFindingへ進めない。

**Human Candidate Review**
: terminal Researchのexact Candidate setへdigest-bindした人間の判断。`advance-to-independent-validation`、`return-to-research`、`park-programme-oos`、`hold-scope-ambiguous`をCandidateごとに一度だけ指定する。

**Independent Validation**
: Research conversation、scratch、verdictを共有しないfresh source-only Native Run。candidateを自身で再導出する。

**Validation Disposition**
: `source-validated`、`needs-research`、`disproven`、`validation-pending`のいずれか。外部制約は`disproven`にしない。

**Finding**
: `source-validated`だけから生成されるimmutable source claim。runtime / human observationは後段でappendされる。

**Coverage**
: 固定Campaign条件内でactionable frontierが残るかを表す独立artifact。Findingの数やTargetの安全性を意味しない。

**Interruption**
: Budget、provider、policyまたはinvalid outputによりCampaignが判断を完了できなかった記録。

**Research Record**
: Campaign Input、Native Receipt、Agent Checkpoint ref、Agent Run Diagnostic ref、parked Programme Lead、両Human Review、Validation Receipt、Finding、Coverage、Interruptionのappend-only system of record。agent内部のrole、call順、transcript本文、scratch本文またはabsolute pathはdomain stateにしない。

## Invariants

- Target sourceをhost上で実行しない。
- Prompt、Target、Dependency、Runtime、Permission、BudgetとReceiptをdigest bindする。
- ResearchとValidationは異なるfresh sessionとscratchを使う。
- 一つのResearch Grantは`researchGrantWallTimeMs`を超えず、AIの`continue`だけで次のGrantを開始しない。
- terminal ResearchのCandidateはHuman Candidate Reviewで明示的にadvanceされるまでValidationしない。
- Parked Programme Leadはexact evidenceを保持するがCandidate、ValidationまたはFindingへ暗黙昇格しない。
- Agent Checkpointは同じTarget、Dependency、Prompt、Runtime、PermissionへbindされたResearchだけが再開できる。
- timeout後も元のterminal分類を維持し、有効なAgent Checkpointだけをresumeに使う。Checkpoint化できないstateはcredentialを除外してAgent Run Diagnosticへ隔離する。
- `source-validated`だけがFindingを作る。
- Findingの有無とCoverage completionを分離する。
- supporting agent数、到着順、多数決またはconfidenceでcandidateを捨てない。
- Native Agent RuntimeはRootを含む同時active agentを最大4体に制限し、Rootだけが最大3体のsubagentを起動する。実数、役割、再投入とwaveはRootが決める。
- SQLiやStored XSSをRCEへ伸ばさないことだけで未完成扱いしない。
- provider、Budget、tool、source、permission、schema failureをno-findingまたはsafeへ丸めない。
- Agent実行前に固定runscまたはimageが一時的に利用不能だったReceiptだけは、runtimeの明示したretryable markerに基づき同じsealed Grantを通常の再実行で一回ずつ再試行できる。Target / Dependency integrity failure等のpolicy denialは再試行しない。
- provider報告costはReceiptへ保存するがHarnessの停止条件にしない。

## Terms not used

Finder Wave、Depth Campaign、Depth Admission、Harness-owned Approach Family Registry、Work Lease、Root Synthesis、Validation Queue、fixed rubricは現行domain modelに含めない。RootはResearch中のscratchとしてApproach Family Registryを使うが、versioned handoffやHarness stateにはしない。他の語は過去記録を読む時だけhistorical termとして扱う。

Context間の関係は[Context Map](CONTEXT-MAP.md)、現在のcodeは[Codebase Guide](docs/CODEBASE-GUIDE.md)を参照する。
