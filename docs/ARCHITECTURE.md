# Harness Architecture

Status: accepted whole-system view, 2026-09-07

WordPress TargetのAI選定からagent-led Research、独立Validation、fresh runtime verification、人間の外部提出判断までの所有関係を示す。実装状況、source pathとBehavior Testは[Codebase Guide](CODEBASE-GUIDE.md)を正本とする。

[Editable draw.io source](architecture.drawio) · [SVG view](architecture.svg) · [Detailed system walkthrough](SYSTEM-WALKTHROUGH.md)

図は採用した設計であり、実装完了を意味しない。

![WordPress Semantic Security Research Harnessの全体アーキテクチャ](architecture.svg)

## Architecture rule

**Harness owns authority, evidence and execution constraints; agents own research decisions; Independent Validation owns Findings; humans own external actions.**

Harnessが固定するのはTarget identity、source provenance、Permission、Budget、freshness、record、terminal semanticsと人間のauthorizationである。Targetの優先順位、探索方法、native subagent、継続、停止、candidateの検証方法はAIへ残す。AI判断を固定stage、role、rubric、ranking ruleまたはprovider-neutral orchestrationとして再実装しない。

## Contexts

`Target Intelligence -> Research -> Human OS`の三Contextを持つ。Context間はversioned handoffだけを渡す。

| Context | Owns | Output |
| --- | --- | --- |
| Target Intelligence | observation、AI Target Selection、Human Batch Approval、acquisition、dispatch、Research History | Target Intake Packet |
| Research | 一TargetのCampaign、Agent Runtime、Independent Validation、Finding、Coverage、Research Record | Finding / Campaign Coverage Receipt |
| Human OS | AI / human runtime verification、理解支援、report、submission staging | Verification Record / Approved Submission Draft |

Target IntelligenceはFinding、CVEまたは既知routeをResearchへ渡さない。ResearchはTarget選定policyを再評価しない。Human OSはResearch Recordを直接更新しない。

## Deep Modules and seams

### Target Selection

Target Selectionは固定Candidate PoolからAIがTarget Proposalを作るdeep Moduleである。Interfaceはproposal生成とinspectionに絞り、全候補ranking、固定diversity facet、Research Value Bandまたは列挙済みreason codeをcallerへ要求しない。

Programme Eligibility、Disclosure Route、利用規模、更新状況、integration、source scaleとResearch HistoryはAIの判断材料である。Harnessのhard gateはCandidate Pool membership、取得可能性、identity、provenance、実行直前freshnessとApproved Target Batchに限定する。

### Research Campaigns

Researchのexternal seamは次のdeep Moduleに置く。

```ts
interface ResearchCampaigns {
  conduct(input: CampaignInput): Promise<CampaignOutcomeRef>;
  inspect(query: CampaignQuery): Promise<CampaignView>;
}
```

`conduct`はCampaign inputのseal、Agent Sandbox、Claude Code Root、native subagent、AI判断による継続、fresh Independent Validation、Finding、Coverage、append-only recordとresumeを隠す。callerはPlanner、Finder、Wave、Lease、Depth、Approach Family、Critic、SynthesisまたはValidation Queueを知らない。

### Native Agent Runtime

Claude Codeはtrue external dependencyであり、Research内部のseamにproduction Adapterとdeterministic fake Adapterを置く。

```ts
interface NativeAgentRuntime {
  execute(run: SealedNativeRun): Promise<NativeRunReceipt>;
}
```

provider固有のnative subagent、session、event、usageとtool mechanicsはAdapter内へ局所化する。二つ目のproduction runtimeが実在するまで、汎用provider registry、tool DSL、role schemaまたはSubagent Managerを作らない。

### Independent Validation

ValidationはResearch内部のdeep Moduleである。freshなAgent Runtimeとread-only Target Snapshotから、candidateを`source-validated / needs-research / disproven / validation-pending`のいずれかへ理由とsource evidence付きで評価する。固定rubricまたはclass別AdapterをInterfaceへ出さない。`source-validated`だけがFindingを生成する。

### Research Record

Campaign definition、Native Run Receipt、usage、private transcript参照、Validation Candidate、Validation result、Finding、Coverageとfailureをappend-onlyに記録する。agent内部のthesis、role、round、family、queueまたはcall順はsystem of recordにしない。SQLiteとCASはlocal-substitutable dependencyとしてModule内部に置く。

## Operating flow

1. Target Intelligenceがoracle-freeなCandidate Poolを観測する。
2. AIがTarget Proposalを作り、理由と不確実性を示す。
3. 人間がResearch対象範囲をApproved Target Batchとして承認する。
4. Target Intelligenceが実行直前のversion、source、provenanceを再確認し、Target Intake Packetを渡す。
5. ResearchがTarget Snapshot、Prompt Set、Agent Runtime Profile、Permission ProfileとBudget Envelopeをsealする。
6. Claude Code Rootがnative subagentを必要に応じて使い、source-boundな次手がある間は探索を続ける。
7. Validation Candidateはfresh Independent Validationへ渡す。`needs-research`のproof gapはRootが継続可否を判断する。
8. AIに有望なactionable frontierがなく、pending Validationもない場合だけCoverageを閉じる。外部制約で続行できなければ`incomplete`にする。
9. Human OSがFindingをfresh環境でAI Reproductionし、Verification Recordを追記する。人間の別fresh環境での確認はassuranceを追加するがFinding生成条件ではない。
10. AIがDraftを作り、人間がexact revisionとdestinationを承認する。最後のSubmitは人間だけが行う。

SQLi、Stored XSS、ATO、PrivEsc、file operation、object injection、authorizationまたはbusiness-logic failureは、RCEへ昇格しなくても単独でFindingになり得る。Surface Map、PHP Program Index、AST、Semgrep、CodeQLは任意の補助toolであり探索境界ではない。

## Stable handoffs

| Artifact | Producer -> Consumer | Meaning |
| --- | --- | --- |
| Target Proposal | Target Selection -> Human Batch Approval | oracle-freeな選択、理由、不確実性 |
| Approved Target Batch | Human -> Target Campaign Dispatch | Research対象範囲、順序、Budget、execution window |
| Target Intake Packet | Target Intelligence -> Research | identity、source manifest、provenance |
| Immutable Target Snapshot | Target Intelligence -> Agent Sandbox | 実行しないmanifest-bound source |
| Campaign Coverage Receipt | Research -> Target Intelligence | lifecycle、completion、resume条件 |
| Finding | Research -> Human OS | source-validatedなclaim、premise、broken property、evidence、counterevidence |
| Verification Record | Human OS内 | fresh environment、Recipe、AI / human observation、Private Evidence参照 |
| Approved Submission Draft | Human -> Form Stager | 人間確認済みのexact Draft revision |
| Evidence Request | Human OS -> Research | 具体的proof gapを持つFollow-up Campaign要求 |

## Completion and failure

| Boundary | Complete when |
| --- | --- |
| Target Selection | AIのTarget Proposal、理由、不確実性と固定入力がdurable |
| Batch Approval | 人間の対象範囲、Budget、execution windowがdurable |
| Research Campaign | AIがactionable frontierなしと判断し、全Validationとrecordがterminal |
| Independent Validation | source-backed dispositionまたは理由付き`validation-pending`がdurable |
| AI Reproduction | runtime observationをVerification Recordへ追記 |
| External action | 人間がexact Draft revisionとdestinationを承認し、最後のSubmitを実行 |

Findingの有無とCampaign completionは独立する。Budget exhaustion、provider、tool、source、permission、schemaまたはstorage failureをno-finding、safeまたは`disproven`へ変換しない。

## Trust rules

- Target sourceをhost上で実行しない。
- Target Snapshotはread-only、隔離scratchだけをwriteableにする。
- Rootとnative subagentへ同じPermission Profileを継承させる。
- ambient shell、network、credential、container socket、host path、plugin、hook、memory、未承認MCPを渡さない。
- gVisor相当以上のOS-level sandboxとTransport Eligibility capability probeを通らないruntimeをproductionへ使わず、host processまたはplain Dockerへfallbackしない。
- Independent ValidationはRootのconversation、scratchまたはverdictを共有しない。
- exact payload、HTTP request、screenshot、runtime logはHuman OSのPrivate Evidence Bundleへ置く。
- credential、private Target、transcript、PoC、未公開FindingをGitへ含めない。

## Versioning and replacement

現行v7はtag `research-v7-before-native-agent-loop`で再現する。新設計は別schema familyと別SQLite/CAS rootで実装し、新binaryに旧writer、旧reader、legacy replay、feature flagまたは未使用Adapterを残さない。rollbackは旧tagのbinaryと旧storageを組にして行う。

判断根拠は[ADR 0125](adr/0125-put-agent-decisions-behind-thin-evidence-shells.md)、research policyは[Research Design](RESEARCH-DESIGN.md)、現在動くsourceとBehavior Testは[Codebase Guide](CODEBASE-GUIDE.md)、比較資料は[reference harness comparison](knowledge/reference-harness-observability.md)を参照する。
