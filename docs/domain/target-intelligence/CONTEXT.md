# Target Intelligence Context

Target IntelligenceはWordPress ecosystemを観測し、oracle-freeなCandidate PoolからAI Target Proposalを作り、人間のBatch承認後にfresh sourceをResearchへ渡すBounded Contextである。

## Boundary

Target IntelligenceはResearch仮説、candidate、Finding、runtime verificationまたはsubmissionを所有しない。CVE、known route、patch narrative、known affected file / functionをTarget Intake Packet、Campaign Threat ContextまたはProgramme Research Boundaryへ含めない。

## Ubiquitous language

**Target Observation**
: plugin identity、version、acquisition、provenance、freshnessを持つ時点付きfact。

**WordPress.org Update Frontier**
: callerが指定したexclusive SVN cursorからbounded revision windowを観測し、`trunk`のPHP変更をcurrent Target Observationへ結び付けたoracle-freeな選定artifact。exact pathとadded lineはprivate evidenceに留め、frontierは変更file数、added line数とoptionalなnavigation signal familyだけを持つ。signal一致はmembership条件にしない。

**Update Candidate Pool Assembly**
: Update Frontier、Target Intake Policy、freshness policyとcaller-supplied Selection Contextをbindし、各leadの同一version sourceを再取得してCandidate Poolへ変換したprivate record。source-readyなCandidateと、欠損、stale、acquisition failureまたはbinding mismatchのunresolved gapを分離する。

**Programme Observation**
: bounty / VDP programmeのidentity、eligibility、opportunity band、freshnessを持つfact。

**Disclosure Route**
: first-party、delegated、security contact等の観測済み提出経路。技術的Researchの可否そのものではない。

**Candidate Pool**
: 一つのSelection Runへ渡すoracle-free Target Candidateのdigest-bound集合。Candidateはsource identity、selection facts、Programme、Disclosure Route、公開脆弱性のaggregate、Research History Factを持ち得る。

**Research History Fact**
: same versionまたはprior versionの既探索有無を示す入力fact。再投入を決定的に拒否せず、AIの判断材料にする。

**Research History Snapshot**
: same versionとprior versionを区別するため、既探索のplugin identityとversionの組だけを保持するdigest-boundなprivate artifact。legacy importerは元workspaceのsource identity、旧設計、探索結果、提出結果または脆弱性本文を再利用しない。

**Selection Run**
: Candidate Pool、guidance、Agent Runtime、Permission、BudgetをsealしてAI proposalを得る一回のversioned run。

**Target Proposal**
: AIが選んだCandidate ID、理由、不確実性とinput / receipt bindingを持つdurable artifact。全候補rankingではない。

**Approved Target Batch**
: 人間がProposalから選んだResearch対象範囲、順序、Budget、execution window。

**Dispatch Admission**
: Batchと現在のTarget Observationを照合し、実行直前のidentity、version、manifest digest、freshnessが一致するかを返す判断。

**Target Intake Packet**
: Approved Target Campaignのadmissionに使うversioned source artifact。Target identity、source manifest、provenanceを持ち、known vulnerabilityや探索手順を含めない。

**Campaign Threat Context**
: Target ProposalからResearch価値に関係するordinary configuration、attacker position、security objective、trust boundary、high-value transition、Dependency roleと不確実性だけを抽出したversioned planning artifact。Rootへfocusとmotivationを渡すが、既知脆弱性、固定route、脆弱性class、読む順序、agent roleまたは停止quotaを命令しない。

**Programme Research Boundary**
: 公式Programme source、eligible attacker position、priority impact、短い除外category、excluded asset、scope uncertaintyとhandlingをexact bodyへdigest-bindしたversioned artifact。Research effortとCandidate preservationを制約するが、researcher tier、install threshold等のTarget eligibility、脆弱性仮説または既知脆弱性oracleを与えず、Independent Validationへは渡さない。

**Approved Target Campaign Request**
: Approved Target Batchの一Target、fresh Target Observation、Target Intake Packet、Campaign Policy、Dependency Snapshots、Campaign Threat Context、Programme Research Boundaryをbindし、一Campaignのadmissionと開始を要求するversioned command。

**Campaign Coverage Receipt**
: Researchから戻るTarget-level lifecycle handoff。Finding内容とは別に、closed、incomplete、resume条件をTarget Intelligenceへ伝える。

## Invariants

- Candidate PoolとProposalのinputをdigest bindする。
- WordPress.org Update Frontierはrevision cursor、明示policy、official SVN log / diff evidenceとcurrent Target Observationをdigest bindする。source failure、timeout、quota超過、malformed outputを空の成功artifactへ丸めない。
- `trunk`のPHP変更はactive-install policyを満たす限りnavigation signalの有無にかかわらずUpdate Frontierへ残す。exact added lineとpathをTarget ProposalまたはResearchへ渡さない。
- Update Candidate Pool AssemblyはfrontierへbindしたPlugin Identity、version、observation ref、Target Intake Policy、Canonical File Manifestとfreshnessを検査する。source-readyでないleadをCandidateへ補完せず、frontier外のSelection Contextを受理しない。
- Candidateへ渡すupdate activityはfrontier ref、revision範囲、changeset数、PHP変更file occurrence数、added line数とnavigation signal familyに限定する。private evidence ref、path、added source、既知advisory、patch、PoCまたはaffected functionを渡さない。
- AIはpool外またはhard gate不合格のTargetをProposalへ入れられない。
- fixed rank、Research Value Band、reason code、diversity facetをAI判断の代用にしない。
- Research History Snapshotへsource identity、source receipt、Campaign coverage、Finding、Case status、submission、outcome、CVE、脆弱性class、claim、route、affected file / function、PoC、patchまたはreport本文を保存せず、Researchへ渡さない。履歴取得不能を未探索へ丸めない。
- 人間のApproved Target BatchなしにResearchへdispatchしない。
- dispatch直前にsourceとversionのfreshnessを再確認する。
- exactly oneのWordPress coreを含むDependency source closureとCampaign Threat Contextの全roleを一致させる。
- Campaign Threat Contextからoff-model Findingを禁止しない。
- Programme Research Boundaryのsource refとexact body digestを検証し、Campaign input、sealed Research run、Checkpointを同じdigestへbindする。
- sourceで最大効果まで明確にProgramme対象外と示された経路だけをparkし、eligible impactへの具体的なsource-bound escalationが残る経路は継続する。scopeが実質的に曖昧なCandidateは人間とのchallenge用に保存する。
- Target-levelのProgramme対象外、Disclosure Route不明、既探索だけを汎用的な技術Researchの決定的拒否条件にしない。Programme指定CampaignではProgramme Research BoundaryがResearch effortを制約する。
- Target package script、autoload、WordPress bootstrapをhost上で実行しない。

現在の実装と未接続箇所は[Codebase Guide](../../CODEBASE-GUIDE.md)、Context間の関係は[Context Map](../../../CONTEXT-MAP.md)を参照する。
