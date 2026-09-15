# System Walkthrough

一件のTargetが通る経路を、現在のpublic seamに沿って示す。実装済みと未接続の境界は[Codebase Guide](CODEBASE-GUIDE.md)を正本とする。

診断coreはStep 2と3で完結する。Step 1と4は前後に接続できるsupporting workflowであり、診断coreの実行またはpromotionに必須ではない。

## 1. Select and approve

Target Intelligenceが取得可能性、identity、provenance、freshnessを検査したCandidate Poolを作る。候補の入口には通常のecosystem observationに加え、callerが有限cursorを与えるWordPress.org Update Frontierを使える。後者は`trunk` PHP変更をcurrent metadataへ結び付け、同じversionのsourceを再取得してからCandidate Poolへ組み立てる。Proposalへ渡すのは更新量とhigh-level navigation signal familyまでで、exact path、added source、既知advisory、patch、PoCまたはaffected functionはprivate evidenceに留める。欠損、staleまたはsource binding failureはassembly gapとして残る。

AIは固定rankやreason codeなしにTarget Proposalを返す。人間はProposalの一部または全部をApproved Target Batchとして承認する。

Targetごとにordinary configuration、attacker position、security objective、trust boundary、high-value transition、必要なWordPress core / companion sourceと不確実性をCampaign Threat Contextへまとめる。この段階でもCVE、known file、known route、patch narrativeまたは固定探索手順をResearchへ渡さない。

Programme指定のCampaignでは、公式scopeからeligible attacker position、priority impact、短い除外category、excluded assetと不確実性だけをProgramme Research Boundaryへまとめる。researcher tier、install threshold等のTarget eligibilityはTarget Intelligenceのadmissionで消費し、Researchへ渡さない。公開既知脆弱性のPoC、patch、affected file / functionも含めない。

## 2. Seal and conduct

### 探索Agentへ渡す情報

Research Rootは次のsource worldとplanning dataだけを受け取る。

- exact versionへbindしたread-only Target Snapshotとplugin全source
- WordPress core、required / active companion、runtime library、protocol reference等のread-only Dependency Snapshots
- ordinary configuration、attacker position、security objective、trust boundary、high-value transition、不確実性を持つCampaign Threat Context
- eligible attacker position、priority impact、明示的除外とscope uncertaintyを持つProgramme Research Boundary
- Research Prompt、Agent Runtime Profile、Permission Profile、そのGrantのwall-time allowance
- 二回目以降のGrantだけ、同じbindingのprivate Agent Checkpointと人間が承認したsource-bound next action

CVE、advisory、changelog、Git history、patch diff、既知のaffected file / function、既知route、payloadまたは正解のValidation verdictは渡さない。Target / Dependency内のinstruction-like fileもuntrusted dataとして扱う。Agentはread-only sourceと隔離scratchだけを使い、internet、ambient shell、credential、host pathまたは外部送信権限を持たない。

公開可能な具体例は次にある。

- 探索方針本文: [`prompts/wordpress-plugin-research-v2.md`](../prompts/wordpress-plugin-research-v2.md)
- Agentへ最終的に組み立てるprompt: [`agentResearchPrompt`](../src/research/agent-led/gvisor-agent-sandbox.ts)
- `CampaignInput`、Threat Context、Programme Boundary、Checkpointのschema: [`contracts.ts`](../src/research/agent-led/contracts.ts)
- Target / WordPress sourceとplanning dataを含む完全なtest example: [`campaign-threat-context.test.ts`](../tests/research/campaign-threat-context.test.ts)
- 最小の`CampaignInput` example: [`research-campaigns.test.ts`](../tests/research/research-campaigns.test.ts)
- Human-approved Targetから`CampaignInput`を組み立てる例: [`approved-target-campaigns.test.ts`](../tests/target-intelligence/approved-target-campaigns.test.ts)

実Target source、provider conversation、Checkpoint本文、credential、payloadと未公開Findingは`.private`等のGit外へ置くため、repositoryに実Campaignの完全なprivate input bundleは置かない。

通常経路のCLI `campaign conduct-approved`は、Approved Target Batch、fresh Target Observation、Target Intake、Campaign Policy、Dependency Snapshots、Campaign Threat ContextとProgramme Research Boundaryを検査してResearch `CampaignInput`を作る。ResearchはTarget Snapshot、WordPress core等のDependency Snapshots、Campaign Threat Context、Programme Research Boundary、Research Prompt、Validation Prompt、Agent Runtime Profile、Permission Profile、Budget Envelopeをdigest bindする。profileが指定するGrok Build、Claude Code、Claude Code process上のGLM 5.3、またはmanaged read-only source readerを持つCodex Daybreak Adapterだけを使う。低水準の`campaign conduct`は、既にsealした`CampaignInput`を直接実行する。

native agentはrunsc container内でread-only Target / Dependency sourceとwriteable scratchを使う。Dependencyからframework挙動を確認するが、Dependency自体はaudit Targetにしない。Campaign Threat ContextはRootのplanning dataであり、off-model Findingを妨げない。Programme Research BoundaryはResearch effortを絞る。eligible impactへの具体的なsource edgeがないOOS primitiveは最小限のParked Programme Leadとして保存し、subagent adversarial reviewやValidationへ流さない。ATO、Admin昇格、RCE等への具体的なedgeが出た時だけactive routeへ戻す。scopeが曖昧なCandidateは人間とのchallenge用に残す。固定WaveやDepthはない。

一回のResearch Native Runは最大1時間のResearch Grantである。AIが具体的な次手と`continue`を返すと`research-review-pending`で止まり、`campaign inspect`にexact run、Checkpoint、Candidate、parked Leadとnext actionへbindしたreview requestが出る。人間はCodex / Claude Code等から`campaign review-research`を実行し、`continue-research`なら同じCheckpointから一Grantだけ再開する。Candidateがあれば`proceed-to-candidate-review`で探索を区切れる。provider報告costは記録するが停止条件にしない。

## 3. Validate independently

Researchを区切ってCandidateがあれば`candidate-review-pending`で止まる。`campaign inspect`のexact Candidate setを人間が概要、実際のvulnerabilityか、現実的impact、Programme適合性の観点で確認し、`campaign review-candidates`でdispositionを返す。`return-to-research`が一件でもあれば全Validationより先にResearchへ戻す。programme OOSとscope ambiguityは記録するがValidationしない。

`advance-to-independent-validation`されたCandidateだけを、別provider home、別scratch、fresh sessionのIndependent Validationで一度検証する。Validatorは同じTarget / Dependency sourceからCandidateの主張を再導出する。Programme Research Boundary、Research conversation、CheckpointまたはHuman Review reasonはValidatorへ渡さず、Programme eligibilityと技術的なsource verdictを分離する。認証切れ等で技術的結論が出なければ`incomplete`のままReceiptを残す。人間が`campaign retry-validation`でexact current failed run集合を承認した場合だけ、別fresh attemptを追記する。

- `source-validated`: immutable Findingを作る。
- `needs-research`: concrete next actionをResearchへ返す。
- `disproven`: source evidenceによる反証を残す。
- `validation-pending`: providerやBudget等で判断不能として残す。

FindingとCoverageは別artifactである。Findingがあっても探索が続けばCoverageはopenであり、FindingがなくてもAIにnext actionがなければ固定条件内でclosedになり得る。

## 4. Verify and prepare submission

Human OSはFindingを受け取り、fresh gVisor environmentでのAI reproduction recordを追記する。人間のverificationは別のfresh environment identityを要求する。反証されてもFindingを削除せず、観測をappendする。

AIはSubmission Draftを作れる。外部行動はhuman-confirmed verificationに加え、exact Draft digestとdestinationへbindしたauthorizationが必要である。Harnessは最後のSubmitを実行しない。

## 5. Resume and failure

同じCampaign inputで`conduct`を再実行するとappend-only recordから再開する。入力digestが違えばconflictにする。Human Review待ちはpendingのままrunを開始せず、stale / partial reviewはatomicに拒否する。run数 / wall-time exhaustion、provider failure、policy denialまたはinvalid outputは`incomplete`として観測でき、既に回収したCandidate、Parked Programme Lead、ReceiptまたはCheckpointをno-findingへ変換しない。有効なAgent Checkpointがあれば、同じTarget、Dependency、Prompt、Runtime、Permissionのreview済みResearchだけが再開できる。Validationの再試行もcurrent latest failed runの完全な集合、Campaign input、operator、時刻、理由へdigest-bindし、過去Receiptを残す。Checkpoint本文はSQLiteやValidationへ渡さない。

現行binaryは旧schemaを読み込まず、legacy replayや旧writerを併載しない。
