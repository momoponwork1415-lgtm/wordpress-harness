# Harness Architecture

Status: accepted whole-system view, 2026-09-10

WordPress Targetの選定からagent-led Research、Independent Validation、fresh verification、人間の外部提出判断までのownershipを示す。実装状態は[Codebase Guide](CODEBASE-GUIDE.md)を正本とする。

初見向けの共有資料は[一枚でわかる全体像](visuals/wordpress-security-research-overview.svg)を使う。

![一枚でわかるWordPress脆弱性探索システム](visuals/wordpress-security-research-overview.svg)

以下はContext境界とhandoffを詳しくした図である。

![全体アーキテクチャ](visuals/system-architecture.svg)

## Architecture rule

**Diagnostic core owns evidence and limits; agents propose Discovery decisions; humans gate Research continuation and Validation admission; Independent Validation owns Findings; humans own external actions.**

診断coreの必須flowは`Target Snapshot + Dependency Snapshots -> Research Grant -> Human Research Review -> Human Candidate Review -> Source Validation -> Finding`である。Source Validationは明白なsource矛盾を落とす独立sanity gateに留め、実質的なtrue-positive assuranceは`Finding -> fresh Dynamic Reproduction`で得る。Target Intelligenceは前段、Human OSはruntime / human assuranceと外部提出判断を所有する。隔離は各Runtime Adapterの内部安全条件であり、診断結果やpromotionの目的にしない。

短い診断coreだけを見る場合は[診断core図](visuals/diagnosis-architecture.svg)を参照する。

Harnessが固定するのはTarget identity、source provenance、Prompt、Permission、Budget、freshness、record、failure semanticsと人間のauthorizationである。AIはTargetの優先順位、探索方法、native subagent、読む順序、candidate、next actionと技術的Validationを判断し、継続と停止を提案する。人間は次のResearch GrantとCandidate admissionを決める。

## Contexts

Context間は図に示したversioned handoffだけを渡す。Target Intelligenceはadmit済みCampaign InputへTarget / Dependency Snapshots、compactなCampaign Threat ContextとProgramme Research Boundaryをbindするが、Finding、既知脆弱性、patch、既知のaffected file / function、固定routeまたは探索手順をResearchへ渡さない。Researchはselection policyを再評価しない。Human OSはResearch storageを直接更新しない。用語と関係の正本は[Context Map](../CONTEXT-MAP.md)に置く。

## Deep modules

### Update Candidate Pools

`WordPressOrgUpdateCandidatePools.assemble / inspect`は、Update Frontierを既存のCandidate Poolへ接続する。frontierの観測にbindした同一versionのsourceをWordPress.orgから再取得し、identity、provenance、Canonical File Manifest、Target / Selection Observationのfreshnessを検査する。Candidateへ渡す更新factはrevision範囲、changeset数、PHP変更file occurrence数、added line数とhigh-level navigation signal familyだけである。private SVN evidenceのpath、added source、既知advisory、patch、PoCまたはaffected functionをSelection Run / Researchへ渡さない。取得不能、stale、binding不一致はunresolved assembly gapとして残し、未探索またはeligibleへ補完しない。

### Target Proposals

`TargetProposals.propose / inspect`は、oracle-freeなCandidate PoolからAI提案を作り、入力、usage、failure、理由と不確実性をdurableにする。Harnessのhard gateはCandidate Pool membership、source acquisition、identity、provenance、freshnessである。全候補rank、固定Bandまたは固定reason codeを要求しない。

### Approved Target Campaigns

```ts
interface ApprovedTargetCampaigns {
  conduct(request: ApprovedTargetCampaignRequest): Promise<CampaignOutcomeRef>;
}
```

`conduct`は人間のApproved Target Batch、fresh Target Observation、Target Intake、Campaign Policy、Dependency Snapshots、Campaign Threat ContextとProgramme Research Boundaryの一致を検査し、admit済みCampaign Inputを既存Researchへ渡す。Campaign Threat Contextはordinary configuration、attacker position、security objective、trust boundary、high-value transitionと不確実性をRootのplanning dataとして渡す。Programme Research Boundaryは公式Programme sourceへbindしたeligible attacker position、priority impact、短い除外category、excluded assetと不確実性だけでResearchのeffortとCandidate preservationを制約する。researcher tier、install threshold等のTarget eligibilityはTarget Intelligenceのadmissionに閉じ、Researchへ渡さない。いずれも脆弱性class、読む順序、agent role、停止quotaまたは網羅的仮説を命令しない。中央schedulerや別のResearch Ledgerを作らない。

### Research Campaigns

```ts
interface ResearchCampaigns {
  conduct(command: CampaignCommand): Promise<CampaignOutcomeRef>;
  inspect(query: CampaignQuery): Promise<ResearchCampaignView>;
}
```

`conduct`はsealed input、最大1時間のResearch Grant、AIのcontinue / stop提案、両Human Review、fresh Validation、Finding、Coverage、append-only recordとresumeを隠す。AIの`continue`はexact run / Checkpoint / resultへbindしたHuman Research Continuation Reviewなしに次のGrantを開始しない。terminal Candidateもexact setへbindしたHuman Candidate ReviewでadvanceされるまでValidationしない。Validationが外部制約で結論前に失敗した時は、exact current failed run集合へbindしたHuman Validation Retryだけが別fresh attemptを許可し、過去Receiptを置換しない。ResearchはProgramme Research Boundaryにより、eligible impactへの具体的なsource edgeがないOOS primitiveを軽量なParked Programme Leadとして保存し、adversarial reviewやValidationへ流さない。具体的なeligible escalationが出た経路だけを継続し、Programme scopeが実質的に曖昧なCandidateを人間とのchallenge用に保存する。callerはPlanner、Finder、Wave、Depth、role、rubricまたはValidation Queueを知らない。

### Native Agent Runtime

```ts
interface NativeAgentRuntime {
  execute(run: SealedAgentRun): Promise<NativeAgentReceipt>;
}
```

Grok BuildとClaude Codeのprovider固有CLIはAdapter内へ局所化する。GLM 5.3はZ.AI endpointへ固定したClaude Code process Adapterを使い、Codex Daybreakはmanaged configurationとharness-owned read-only source readerを使う。provider自身のmodel loop、context管理、session resume、native subagent scheduling、message routingとtool orchestrationをHarnessで再実装しない。Adapterはnative機能を設定・制限し、sealed bindingとReceiptへ変換する。各runはimmutable imageをrunscで起動し、read-only Target、read-only Dependency Snapshots、isolated scratch / provider homeだけをmountする。Dependencyはframework behaviorのauthoritative referenceでありaudit Targetにしない。Research continuationはprovider-native conversationとscratchをprivate Agent Checkpointから再開し、append-only recordにはopaque refだけを置く。ValidationはCheckpointを共有しない。runtime profileで指定したproviderからsilent fallbackしない。

### Independent Validation

Researchと別のfresh native runがcandidateを同じread-only sourceから再導出し、`source-validated / needs-research / disproven / validation-pending`を返す。Programme Research BoundaryはValidationへ渡さず、Programme都合と独立した技術的再導出を維持する。固定rubricやclass Adapterをpublic seamへ出さない。最適payloadやruntime reproductionを要求せず、必要条件がsourceで直接反証された時だけ`disproven`にする。`source-validated`だけがFindingを生成する。

複数Targetは独立したCampaign processを同時起動する。Target間を調整するproduction schedulerは持たず、一CampaignのDiscoveryとValidationはそのCampaignだけで完結する。

### Human OS

`HumanOs`はFindingを受け取り、freshなWordPress / MySQL環境でのDynamic Reproduction、別fresh environmentでのhuman verification、Submission Draft、exact Draft digestとdestinationへbindしたauthorizationをappend-onlyに記録する。Dynamic ReproductionはFinding ID、Target Snapshot digestとbody digestへbindしたprivate Recipeをinternal-networkのrunsc workerで一度だけ実行する。動的検証内でsource再探索、AI review、追加experimentまたはpatched controlを行わない。matched preconditions、completed recipe、observed effectが揃った時だけ`runtime-confirmed`にし、失敗、効果未観測またはfixture不足は`incomplete`として元Findingを残す。実際の外部送信は所有しない。

## Research flow

![探索・検証の詳細アーキテクチャ](visuals/discovery-validation-architecture.svg)

一Targetの文章によるwalkthroughは[System Walkthrough](SYSTEM-WALKTHROUGH.md)に分離する。

UnauthenticatedまたはSubscriber / Customerから到達できるArbitrary PHP File Upload / Read / Deletion、Arbitrary Options Update、RCE、Authentication Bypass / Privilege Escalation to Administrator、Stored XSS、SQL InjectionとProgramme上criticalなunauthorized data alteration / readをeligible impactとして追う。別のeligible impactをRCEへ昇格させる必要はない。

## Invariants

- Target sourceをhost上で実行しない。
- TargetとDependency mountはread-only、scratchだけをwriteableにする。
- Rootとnative subagentへ同じPermission Profileを適用する。
- ambient shell、network、credential、container socket、host path、plugin、hook、memory、未承認MCPを渡さない。
- runsc capabilityを確認できないruntimeへfallbackしない。
- Independent ValidationはResearchのconversation、scratch、verdictを共有しない。
- Human Research Continuation Reviewなしに次のGrantを開始せず、Human Candidate ReviewなしにValidationを開始しない。
- provider報告costは記録するがCampaign停止条件にしない。
- Findingの有無とCoverage completionを分離する。
- provider、budget、tool、source、permission、schema、storage failureをno-findingまたは`disproven`へ丸めない。
- Dynamic Reproductionは実WordPress / MySQLをfresh gVisor environment内だけで動かし、失敗をsource Findingの削除へ読み替えない。
- exact payload、HTTP request、screenshot、runtime logはPrivate Evidenceへ置く。
- external actionはhuman-confirmed verificationとexact authorizationを要求する。

現行binaryへlegacy reader、feature flagまたは旧writerを残さない。判断根拠は[ADR 0125](adr/0125-put-agent-decisions-behind-thin-evidence-shells.md)、[ADR 0127](adr/0127-make-validated-findings-the-product-success-criterion.md)、[ADR 0131](adr/0131-place-human-reviews-between-research-and-validation.md)、[ADR 0132](adr/0132-treat-provider-cost-as-observational-telemetry.md)、[ADR 0130](adr/0130-replay-finding-bound-recipes-for-dynamic-reproduction.md)を参照する。
