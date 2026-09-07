# Research Context

Researchは一つのimmutable Target Snapshotをagent-ledに調査し、fresh Independent ValidationだけからFindingを作り、FindingとCoverageを別々に記録するBounded Contextである。

## Boundary

ResearchはTarget選定、source acquisition policy、runtime exploit verification、提出先または外部送信を所有しない。Target Intelligenceからversioned Target Intake Packetを受け、Human OSへsource-validated Findingだけを渡す。

## Ubiquitous language

**Campaign**
: 一つのsealed Target、Prompt、Agent Runtime、Permission、Budgetを持つ継続可能な調査単位。

**Campaign Input**
: Campaign identityと五つのimmutable bindingを持つversioned command。同じCampaign IDへ異なるinputを使えない。

**Target Snapshot**
: plugin identity、version、canonical manifest digestで固定したread-only source。Research中に更新しない。

**Native Agent Runtime**
: sealed ResearchまたはValidation Runをprovider-native agentへ渡し、typed Receiptを返す外部dependency。AIの研究判断を所有しない。

**Root Agent**
: Target全体から仮説、読む順序、native subagent、candidate、継続と停止を決めるAI actor。固定Finder roleやDepth phaseではない。

**Research Report**
: Candidate群と`continue`または`stop`の判断を持つ一回のNative Run出力。

**Agent Checkpoint**
: Research Rootのprovider-native conversationとscratchを同じsealed bindingで再開するためのprivateなopaque ref。研究上の結論ではなく、Independent Validationやcontext間handoffへ渡さない。

**Next Action**
: 追加で確認する具体的なquestionとsource pointer。AIがResearch継続を選ぶ根拠であり、Harness-owned queueではない。

**Validation Candidate**
: attacker premise、broken security property、claim、初期source evidenceを持つ独立検証対象。RCE escalationや固定class Adapterを要求しない。

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
: Campaign Input、Native Receipt、Agent Checkpoint ref、Validation Receipt、Finding、Coverage、Interruptionのappend-only system of record。agent内部のrole、call順、transcript本文またはscratch本文はdomain stateにしない。

## Invariants

- Target sourceをhost上で実行しない。
- Prompt、Target、Runtime、Permission、BudgetとReceiptをdigest bindする。
- ResearchとValidationは異なるfresh sessionとscratchを使う。
- Agent Checkpointは同じTarget、Prompt、Runtime、PermissionへbindされたResearchだけが再開できる。
- `source-validated`だけがFindingを作る。
- Findingの有無とCoverage completionを分離する。
- supporting agent数、到着順、多数決またはconfidenceでcandidateを捨てない。
- SQLiやStored XSSをRCEへ伸ばさないことだけで未完成扱いしない。
- provider、Budget、tool、source、permission、schema failureをno-findingまたはsafeへ丸めない。

## Terms not used

Finder Wave、Depth Campaign、Depth Admission、Approach Family Registry、Work Lease、Root Synthesis、Validation Queue、fixed rubricは現行domain modelに含めない。過去記録を読む時だけhistorical termとして扱う。

Context間の関係は[Context Map](CONTEXT-MAP.md)、現在のcodeは[Codebase Guide](docs/CODEBASE-GUIDE.md)を参照する。
