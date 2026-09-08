# Target Intelligence Context

Target IntelligenceはWordPress ecosystemを観測し、oracle-freeなCandidate PoolからAI Target Proposalを作り、人間のBatch承認後にfresh sourceをResearchへ渡すBounded Contextである。

## Boundary

Target IntelligenceはResearch仮説、candidate、Finding、runtime verificationまたはsubmissionを所有しない。CVE、known route、patch narrativeをTarget Intake Packetへ含めない。

## Ubiquitous language

**Target Observation**
: plugin identity、version、acquisition、provenance、freshnessを持つ時点付きfact。

**Programme Observation**
: bounty / VDP programmeのidentity、eligibility、opportunity band、freshnessを持つfact。

**Disclosure Route**
: first-party、delegated、security contact等の観測済み提出経路。技術的Researchの可否そのものではない。

**Candidate Pool**
: 一つのSelection Runへ渡すoracle-free Target Candidateのdigest-bound集合。Candidateはsource identity、selection facts、Programme、Disclosure Route、公開脆弱性のaggregate、Research History Factを持ち得る。

**Research History Fact**
: Targetがnew、active、coverage-closed、incompleteのどれかを示す入力fact。再投入を決定的に拒否せず、AIの判断材料にする。

**Selection Run**
: Candidate Pool、guidance、Agent Runtime、Permission、BudgetをsealしてAI proposalを得る一回のversioned run。

**Target Proposal**
: AIが選んだCandidate ID、理由、不確実性とinput / receipt bindingを持つdurable artifact。全候補rankingではない。

**Approved Target Batch**
: 人間がProposalから選んだResearch対象範囲、順序、Budget、execution window。

**Dispatch Admission**
: Batchと現在のTarget Observationを照合し、実行直前のidentity、version、manifest digest、freshnessが一致するかを返す判断。

**Target Intake Packet**
: Researchへ渡すversioned handoff。Target identity、source manifest、provenanceを持ち、selection reasoningやknown vulnerabilityをResearch inputにしない。

**Campaign Coverage Receipt**
: Researchから戻るTarget-level lifecycle handoff。Finding内容とは別に、closed、incomplete、resume条件をTarget Intelligenceへ伝える。

## Invariants

- Candidate PoolとProposalのinputをdigest bindする。
- AIはpool外またはhard gate不合格のTargetをProposalへ入れられない。
- fixed rank、Research Value Band、reason code、diversity facetをAI判断の代用にしない。
- 人間のApproved Target BatchなしにResearchへdispatchしない。
- dispatch直前にsourceとversionのfreshnessを再確認する。
- Programme対象外、Disclosure Route不明、既探索だけを技術的Researchの決定的拒否条件にしない。
- Target package script、autoload、WordPress bootstrapをhost上で実行しない。

現在の実装と未接続箇所は[Codebase Guide](../../CODEBASE-GUIDE.md)、Context間の関係は[Context Map](../../../CONTEXT-MAP.md)を参照する。
