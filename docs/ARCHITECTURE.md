# Harness Architecture

Status: accepted whole-system view, 2026-09-07

WordPress Targetの選定からagent-led Research、Independent Validation、fresh verification、人間の外部提出判断までのownershipを示す。実装状態は[Codebase Guide](CODEBASE-GUIDE.md)を正本とする。

## Architecture rule

**Diagnostic core owns evidence and limits; agents own Discovery decisions; Independent Validation owns Findings; humans own external actions.**

Productの必須flowは`Target Snapshot -> Discovery -> Independent Validation -> Finding`である。Target IntelligenceとHuman OSは前後のsupporting workflowであり、未接続でも診断coreの失敗にしない。隔離はNative Agent Runtime Adapterの内部安全条件であり、診断結果やpromotionの目的にしない。

![スマホ向け診断core図](visuals/diagnosis-architecture.svg)

探索の仮説loop、candidate handoff、Independent Validationの詳細は[探索・検証アーキテクチャ図](visuals/discovery-validation-architecture.svg)に示す。

Harnessが固定するのはTarget identity、source provenance、Prompt、Permission、Budget、freshness、record、failure semanticsと人間のauthorizationである。AIがTargetの優先順位、探索方法、native subagent、読む順序、継続、停止、candidateと検証方法を決める。

## Contexts

```text
Target Intelligence -- Target Intake Packet --> Research -- Finding --> Human OS
        ^                                       |                      |
        +-- Campaign Coverage Receipt ----------+                      +-- human Submit
```

| Context | Owns | Stable output |
| --- | --- | --- |
| Target Intelligence | observation、AI Target Proposal、human Batch Approval、acquisition、dispatch | Target Intake Packet |
| Research | Campaign、native runtime、Independent Validation、Finding、Coverage、record | Finding / Campaign Coverage Receipt |
| Human OS | AI / human verification、Draft、external authorization | Verification Record / authorized exact Draft |

Context間はversioned handoffだけを渡す。Target IntelligenceはFindingやknown routeをResearchへ渡さない。Researchはselection policyを再評価しない。Human OSはResearch storageを直接更新しない。

## Deep modules

### Target Proposals

`TargetProposals.propose / inspect`は、oracle-freeなCandidate PoolからAI提案を作り、入力、usage、failure、理由と不確実性をdurableにする。Harnessのhard gateはCandidate Pool membership、source acquisition、identity、provenance、freshnessである。全候補rank、固定Bandまたは固定reason codeを要求しない。

### Research Campaigns

```ts
interface ResearchCampaigns {
  conduct(input: CampaignInput): Promise<CampaignOutcomeRef>;
  inspect(query: CampaignQuery): Promise<ResearchCampaignView>;
}
```

`conduct`はsealed input、agent-led research、AIのcontinue / stop、fresh Validation、Finding、Coverage、append-only recordとresumeを隠す。callerはPlanner、Finder、Wave、Depth、role、rubricまたはValidation Queueを知らない。

### Native Agent Runtime

```ts
interface NativeAgentRuntime {
  execute(run: SealedAgentRun): Promise<NativeAgentReceipt>;
}
```

Grok BuildとClaude Codeのprovider固有CLIはAdapter内へ局所化する。GLM 5.3はZ.AI endpointへ固定したClaude Code process Adapterを使い、Claude Code自身のagent、subagent、source tool運用を再実装しない。各runはimmutable imageをrunscで起動し、read-only Targetとisolated scratch / provider homeだけをmountする。Research continuationはprovider-native conversationとscratchをprivate Agent Checkpointから再開し、append-only recordにはopaque refだけを置く。ValidationはCheckpointを共有しない。runtime profileで指定したproviderからsilent fallbackしない。

### Independent Validation

Researchと別のfresh native runがcandidateを同じread-only sourceから再導出し、`source-validated / needs-research / disproven / validation-pending`を返す。固定rubricやclass Adapterをpublic seamへ出さない。`source-validated`だけがFindingを生成する。

複数Targetは独立したCampaign processを同時起動する。Target間を調整するproduction schedulerは持たず、一CampaignのDiscoveryとValidationはそのCampaignだけで完結する。

### Human OS

`HumanOs`はFindingを受け取り、AI reproduction、別fresh environmentでのhuman verification、Submission Draft、exact Draft digestとdestinationへbindしたauthorizationをappend-onlyに記録する。実際の外部送信は所有しない。

## Operating flow

1. Target Intelligenceがoracle-free Candidate Poolを固定する。
2. AIがTarget Proposalを作り、人間がApproved Target Batchを承認する。
3. 実行直前にversion、source、identity、provenanceを再確認する。
4. ResearchがTarget、Prompt、Runtime、Permission、Budgetをsealする。
5. Provider-native Root agentがsubagentを必要に応じて使い、具体的なsource-bound next actionがある間は続ける。
6. Candidateをfresh Independent Validationへ渡す。具体的なproof gapはRootが続行可否を決める。
7. AIにactionable frontierがなくpending ValidationもなければCoverageを閉じる。外部制約やBudgetで続行不能なら`incomplete`にする。
8. Human OSがfresh runtime / human evidenceを追記し、AIがDraftを支援する。
9. 人間がexact Draftとdestinationを承認し、最後のSubmitを行う。

Unauthenticated SQLi、Stored XSS、ATO、PrivEsc、arbitrary file operation、object injection、authorizationやbusiness-logic failureは、RCEへ昇格しなくてもFindingになり得る。

## Invariants

- Target sourceをhost上で実行しない。
- Target mountはread-only、scratchだけをwriteableにする。
- Rootとnative subagentへ同じPermission Profileを適用する。
- ambient shell、network、credential、container socket、host path、plugin、hook、memory、未承認MCPを渡さない。
- runsc capabilityを確認できないruntimeへfallbackしない。
- Independent ValidationはResearchのconversation、scratch、verdictを共有しない。
- Findingの有無とCoverage completionを分離する。
- provider、budget、tool、source、permission、schema、storage failureをno-findingまたは`disproven`へ丸めない。
- exact payload、HTTP request、screenshot、runtime logはPrivate Evidenceへ置く。
- external actionはhuman-confirmed verificationとexact authorizationを要求する。

旧v7はtag `research-v7-before-native-agent-loop`と旧storageで再現する。現行binaryへlegacy reader、feature flagまたは旧writerを残さない。判断根拠は[ADR 0125](adr/0125-put-agent-decisions-behind-thin-evidence-shells.md)と[ADR 0127](adr/0127-make-validated-findings-the-product-success-criterion.md)を参照する。
