# Research Design

Status: accepted research policy, 2026-09-07

## Goal

既知脆弱性のoracleなしに、high-impactなbroken security semanticsを高recallで発見する。freshなIndependent ValidationからFindingを生成し、fresh runtime verificationと人間の外部提出判断まで閉じる。

**Do not optimize for sinks. Optimize for broken security semantics.**

RCEとsite-wide compromiseは最上位impactだが唯一の成功条件ではない。Unauthenticated SQLi、Stored XSS、ATO、PrivEsc、arbitrary file operation、object injection、authorization、business-logic failureも単独で重大なFindingになり得る。

## Decision ownership

Harnessは判断内容ではなく、判断できる安全な条件と証拠を所有する。

| Concern | Harness owns | AI owns |
| --- | --- | --- |
| Target Selection | oracle-free Candidate Pool、source identity、freshness、Budget、人間のBatch承認 | 優先Target、理由、不確実性、再調査価値 |
| Research | Target Snapshot、Prompt、Permission、Budget、record、terminal semantics | 仮説、native subagent、読む順序、継続、停止、candidate |
| Validation | fresh独立runtime、source-only権限、candidate binding、Finding生成条件 | 検証方法、counterevidence、proof gap、disposition提案 |
| Human OS | fresh runtime、Private Evidence、external authorization | reproduction、理解支援、Draft作成 |

固定のrank、diversity cap、reason code、worker role、Finder数、Wave、Lease、Depth、Approach Family、Validation RubricをAI判断の代わりにしない。schemaはidentity、authority、evidence、failure semanticsとcontext handoffに使う。

## Target Selection

Target Intelligenceはoracle-freeなSelection Factから、AIがResearch価値を比較してTarget Proposalを作る。利用規模、更新状況、integration、source scale、Programme Eligibility、Disclosure Route、Research Historyは判断材料にできるが、全候補のrank、固定Band、固定facetのdiversityまたは列挙済み理由を要求しない。

Harnessのhard gateは次に限定する。

- sourceを正規に取得できる。
- Plugin Identity、version、provenanceとCanonical File Manifestを固定できる。
- 実行直前のsourceとversionがfreshである。
- 選択結果が入力Candidate Poolへ含まれる。
- 人間がApproved Target BatchとしてResearch対象範囲を承認する。

Programme対象外、Disclosure Route不明、既探索またはAIの低評価だけを技術的Researchの拒否条件にしない。既探索Targetの再投入理由と重複active Campaignは記録するが、再調査価値はAIが判断する。

## Agent-led Research

通常運転はwp2shell / Cycle Double Cover Promptを直接の系譜とする、raw-source-firstの一つの連続loopである。Provider-native Root agentはTarget Snapshot全体を読み、必要に応じてnative subagentを起動し、互いに異なるroute、反証、synthesisまたは追加調査を進める。Harnessはagent数、role、round、探索classまたは読むfileを指定しない。探索評価ではGrokを先に使い、利用不能を別providerへのsilent fallbackで隠さない。

Research Rootのprovider-native conversationとscratchはprivate Agent Checkpointとして継続できる。Harnessは固定checkpoint cadenceや内部tool eventをdomain modelにせず、bindingとintegrityを持つopaque refだけを記録する。budgetまたはprovider interruptionでもCheckpointを保存できなければ`incomplete`であり、resume可能とは扱わない。Independent ValidationへResearch Checkpointを渡さない。

判断は単純である。

```text
source-boundで具体的な次の調査がある -> continue
重大なcandidateがある                 -> Independent Validationへ渡し、必要ならResearchも続ける
有望なactionable frontierがない       -> evidence-backed stopを提案
外部制約で続行できない                -> incomplete
```

一つのcandidateを得ただけで停止せず、RCEへ伸びないことだけを理由に重大なSQLiやStored XSSを未完成扱いしない。支持数、model confidence、到着順、static rule non-match、Surface Map外であることをcandidateの棄却またはsafe判定に使わない。

Surface Map、AST、Semgrep、CodeQL等の派生解析を将来使う場合もnavigationとevidenceの補助に限り、探索空間またはcompletion proofにしない。現行agent pathはraw sourceを直接読む。

## Independent Validation

Validation Candidateは、Target Snapshot、attacker premise、broken security property、主張と初期source anchorを持つ。固定rubric、順番付き完全route、vulnerability class、RCE escalationまたは特定mechanism Adapterへの対応をadmission条件にしない。

Independent Validationはcandidateごとに一回のfresh source-only runを行う。Research Rootのconversation、scratch、verdictを共有せず、Validator自身がreachability、attacker control、既存防御、security effectとcounterevidenceを再導出する。Target code、build、testまたはruntime attackを実行しない。

| Disposition | Meaning |
| --- | --- |
| `source-validated` | source evidenceから主張を独立に支持でき、Findingを生成する |
| `needs-research` | 具体的で調査可能なproof gapがあり、Rootが継続を判断する |
| `disproven` | 必要なpremise、route、controlまたはeffectがsource evidenceで反証された |
| `validation-pending` | Budget、provider、tool、sourceまたはoutput failureで判断できない |

Findingの存在とCampaign completionは独立する。runtimeとhuman verificationはFindingへassuranceを追記し、元Findingを暗黙に削除または書き換えない。

## Completion and failure

AIが有望なsource-bound next actionを残さず、全Validationがterminalで、Harnessが固定入力、source integrityとterminal outputを検査できた時だけCampaignを`coverage-closed`にする。これは脆弱性が存在しない証明ではなく、固定条件内でactionable frontierがなくなったという記録である。

具体的な次手を残したままBudgetへ達した場合、provider / tool / source / permission / schema / storage failure、またはpending Validationがある場合は`incomplete`とする。Finding 0、agentの一回のno-finding、timeout、Map coverageまたはtool hit数をclosureへ読み替えない。Findingが存在してもResearch workが残れば`incomplete`になり得る。

## Trust and versioning

- Target sourceをhost上で実行しない。
- Target Snapshotはread-only、隔離scratchだけをwriteableにする。
- Rootとnative subagentへ同じPermission Profileを適用する。
- ambient shell、network、credential、container socket、host path、plugin、hook、memory、未承認MCPを与えない。
- gVisor相当以上のOS-level sandboxとTransport Eligibility capability probeを通らないruntimeを使わず、host processまたはplain Dockerへfallbackしない。
- Target Snapshot、Prompt Set、Agent Runtime Profile、Permission Profile、Budget Envelope、outputをCampaignへdigest bindする。
- providerまたはmodelをsilent fallbackしない。
- 人間の必須gateはApproved Target BatchとExternal Action Authorization、最後のSubmitに置く。

Prompt、runtime、permissionまたはresearch policyの変更は進行中Campaignへ適用せず、新しいversioned Campaignで比較する。旧implementationはGit tagと旧storageで再現し、新binaryへlegacy reader、feature flagまたは未使用Adapterを残さない。

## Change gate

変更は次を説明できる場合だけ採用する。

- whitebox Brizy Boundary PairのLead/Finding recoveryとnegative controlを保てるか。
- prospective Campaignでhigh-impact recallを悪化させないか。
- Rootとsubagentのpermission継承を実測したか。
- DiscoveryとIndependent Validationのfreshnessを保てるか。
- source、provider、budgetまたはschema failureをnegativeへ丸めないか。
- public Interfaceからbehaviorを観測でき、旧内部Testを削除できるか。

Cost削減はrecall baseline確立後に一変数ずつablationする。LOCは設計の証明または目標値にしない。未使用code、二つ目の実装がない汎用abstraction、AI判断を再実装するorchestrationを残さず、実測LOCの増加はpublic behaviorで説明する。

## References

- [ADR 0125](adr/0125-put-agent-decisions-behind-thin-evidence-shells.md)
- [wp2shell exact prompt](https://www.slcyber.io/research/exploit-brokers-pay-500000-for-a-wordpress-rce-i-found-one-with-gpt5-6#the-story-of-wp2shell)
- [Cycle Double Cover Prompt](https://cdn.openai.com/pdf/04d1d1e4-bc75-476a-97cf-49055cd98d31/cdc_prompt.pdf)
- [Reference harness comparison](knowledge/reference-harness-observability.md)
