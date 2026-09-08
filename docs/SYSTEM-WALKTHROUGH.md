# System Walkthrough

一件のTargetが通る経路を、現在のpublic seamに沿って示す。実装済みと未接続の境界は[Codebase Guide](CODEBASE-GUIDE.md)を正本とする。

診断coreはStep 2と3で完結する。Step 1と4は前後に接続できるsupporting workflowであり、診断coreの実行またはpromotionに必須ではない。

## 1. Select and approve

Target Intelligenceが取得可能性、identity、provenance、freshnessを検査したCandidate Poolを作る。AIは固定rankやreason codeなしにTarget Proposalを返す。人間はProposalの一部または全部をApproved Target Batchとして承認する。

Targetごとにordinary configuration、attacker position、security objective、trust boundary、high-value transition、必要なWordPress core / companion sourceと不確実性をCampaign Threat Contextへまとめる。この段階でもCVE、known file、known route、patch narrativeまたは固定探索手順をResearchへ渡さない。

## 2. Seal and conduct

通常経路のCLI `campaign conduct-approved`は、Approved Target Batch、fresh Target Observation、Target Intake、Campaign Policy、Dependency SnapshotsとCampaign Threat Contextを検査してResearch `CampaignInput`を作る。ResearchはTarget Snapshot、WordPress core等のDependency Snapshots、Campaign Threat Context、Research Prompt、Validation Prompt、Agent Runtime Profile、Permission Profile、Budget Envelopeをdigest bindする。profileが指定するGrok Build、Claude Code、またはClaude Code process上のGLM 5.3 Adapterだけを使う。低水準の`campaign conduct`は、既にsealした`CampaignInput`を直接実行する。

native agentはrunsc container内でread-only Target / Dependency sourceとwriteable scratchを使う。Dependencyからframework挙動を確認するが、Dependency自体はaudit Targetにしない。Campaign Threat ContextはRootのplanning dataであり、off-model Findingを妨げない。AIが具体的な次手を返せば、同じbindingのprivate Agent Checkpointからprovider-native conversationとscratchを再開し、Validation feedbackを次のrunへ渡す。固定WaveやDepthはない。

## 3. Validate independently

Research reportにcandidateがあれば、別provider home、別scratch、fresh sessionのIndependent Validationを一度行う。Validatorは同じTarget / Dependency sourceからcandidateの主張を再導出する。

- `source-validated`: immutable Findingを作る。
- `needs-research`: concrete next actionをResearchへ返す。
- `disproven`: source evidenceによる反証を残す。
- `validation-pending`: providerやBudget等で判断不能として残す。

FindingとCoverageは別artifactである。Findingがあっても探索が続けばCoverageはopenであり、FindingがなくてもAIにnext actionがなければ固定条件内でclosedになり得る。

## 4. Verify and prepare submission

Human OSはFindingを受け取り、fresh gVisor environmentでのAI reproduction recordを追記する。人間のverificationは別のfresh environment identityを要求する。反証されてもFindingを削除せず、観測をappendする。

AIはSubmission Draftを作れる。外部行動はhuman-confirmed verificationに加え、exact Draft digestとdestinationへbindしたauthorizationが必要である。Harnessは最後のSubmitを実行しない。

## 5. Resume and failure

同じCampaign inputで`conduct`を再実行するとappend-only recordから再開する。入力digestが違えばconflictにする。Budget exhaustion、provider failure、policy denialまたはinvalid outputは`incomplete`として観測でき、no-findingへ変換しない。有効なAgent Checkpointがあれば、同じTarget、Dependency、Prompt、Runtime、Permissionと明示した新BudgetのCampaignから再開できる。Checkpoint本文はSQLiteやValidationへ渡さない。

旧v7へ戻す時は現行databaseを混ぜず、tag `research-v7-before-native-agent-loop`と旧storageを組にする。
