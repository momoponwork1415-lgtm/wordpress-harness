# System Walkthrough

一件のTargetが通る経路を、現在のpublic seamに沿って示す。実装済みと未接続の境界は[Codebase Guide](CODEBASE-GUIDE.md)を正本とする。

## 1. Select and approve

Target Intelligenceが取得可能性、identity、provenance、freshnessを検査したCandidate Poolを作る。AIは固定rankやreason codeなしにTarget Proposalを返す。人間はProposalの一部または全部をApproved Target Batchとして承認する。

この段階ではCVE、known file、known routeまたはpatch narrativeをResearchへ渡さない。

## 2. Seal and conduct

ResearchはTarget Snapshot、Research Prompt、Validation Prompt、Agent Runtime Profile、Permission Profile、Budget Envelopeをdigest bindする。CLIの`campaign conduct`はprofileが指定するGrok BuildまたはClaude Code Adapterだけを使う。

native agentはrunsc container内でread-only sourceとwriteable scratchを使う。AIが具体的な次手を返せば、そのhistoryとValidation feedbackを次のrunへ渡す。固定WaveやDepthはない。

## 3. Validate independently

Research reportにcandidateがあれば、別provider home、別scratch、fresh sessionのIndependent Validationを一度行う。Validatorはcandidateの主張をsourceから再導出する。

- `source-validated`: immutable Findingを作る。
- `needs-research`: concrete next actionをResearchへ返す。
- `disproven`: source evidenceによる反証を残す。
- `validation-pending`: providerやBudget等で判断不能として残す。

FindingとCoverageは別artifactである。Findingがあっても探索が続けばCoverageはopenであり、FindingがなくてもAIにnext actionがなければ固定条件内でclosedになり得る。

## 4. Verify and prepare submission

Human OSはFindingを受け取り、fresh gVisor environmentでのAI reproduction recordを追記する。人間のverificationは別のfresh environment identityを要求する。反証されてもFindingを削除せず、観測をappendする。

AIはSubmission Draftを作れる。外部行動はhuman-confirmed verificationに加え、exact Draft digestとdestinationへbindしたauthorizationが必要である。Harnessは最後のSubmitを実行しない。

## 5. Resume and failure

同じCampaign inputで`conduct`を再実行するとappend-only recordから再開する。入力digestが違えばconflictにする。Budget exhaustion、provider failure、policy denialまたはinvalid outputは`incomplete`として観測でき、no-findingへ変換しない。

旧v7へ戻す時は現行databaseを混ぜず、tag `research-v7-before-native-agent-loop`と旧storageを組にする。
