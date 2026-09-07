---
status: accepted
---

# Put agent decisions behind thin evidence shells

Target Selection、Research、Independent Validationでは、HarnessがAIの判断手順を固定のstage、role、rubricまたはranking ruleとして再実装しない。Harnessは入力と権限を固定し、Agent Runtimeを隔離して実行し、evidenceとterminal stateを検査して記録する。AIは与えられた事実とsourceから、Targetの優先順位、探索方法、native subagentの使用、継続または停止、candidateの検証方法を決める。

## Interfaces

Researchのexternal seamは、一Campaignを最後まで所有するdeep Moduleへ置く。

```ts
interface ResearchCampaigns {
  conduct(input: CampaignInput): Promise<CampaignOutcomeRef>;
  inspect(query: CampaignQuery): Promise<CampaignView>;
}
```

`conduct`はTarget Snapshot、Prompt Set、Agent Runtime Profile、Permission Profile、Budget Envelopeのseal、agent-led research、fresh Independent Validation、FindingとCoverageの記録、resumeを隠す。callerはPlanner、Finder、Wave、Lease、Depth、Critic、SynthesisまたはValidation Queueを指定しない。

Target Selectionのexternal seamは、固定Candidate PoolからAIが提案を作る一操作へ置く。AIは全候補のrank、固定diversity facet、Research Value Bandまたは列挙済みreason codeを返す必要がない。Harnessは選ばれたTargetが入力poolに存在すること、source acquisition、provenance、identity、実行直前freshnessと人間のBatch承認だけを強制する。Programme EligibilityとDisclosure Routeは判断材料であり、技術的Researchのhard gateではない。

Agent Runtimeはtrue external dependencyなので、Research内部に一つのseamを置く。

```ts
interface NativeAgentRuntime {
  execute(run: SealedNativeRun): Promise<NativeRunReceipt>;
}
```

最初のproduction AdapterはClaude Code native Agent Runtimeとする。Root agentはnative subagent、custom agent、調査順序、synthesis、critique、再投入を自身で選べる。Harnessはprovider内部のagent topologyを共通Interfaceへ写さない。別runtimeをproduction採用するまでprovider-neutralなtool DSL、role schema、strategy pluginまたはSubagent Managerを作らない。Testではdeterministicなfake Adapterを使う。

## Research and Validation

Researchは一つの連続loopである。具体的でsource-boundな次の調査がある場合はAIが継続し、有望なactionable frontierがない場合は根拠を示して停止する。`Depth`はmode、admission、queueまたはbudget phaseとして存在しない。SQLi、Stored XSS、authorization failure等は単独でValidation Candidateになり、RCEまたは長いchainへの昇格を要求しない。

Independent Validationはcandidateごとにfresh process、fresh conversation、fresh scratchで行い、Research Rootのtranscript、scratchまたはverdictを共有しない。Validatorは固定rubricを埋めるのではなく、attacker premise、reachability、broken control、security effectとcounterevidenceをsourceから自由に再導出する。Harnessが要求するoutputは理由とsource evidenceを持つ`source-validated`、`disproven`、`needs-research`または`validation-pending`だけである。`source-validated`だけがFindingを生成する。

Findingの有無とCampaign completionは独立する。AIがactionable frontierを残さず、pending Validationがなく、固定入力とterminal outputのintegrityを検査できた時だけCoverageを閉じる。Budget、provider、tool、source、session、schemaまたはstorage failureは`incomplete`であり、no-finding、safeまたは`disproven`へ変換しない。

## Trust and records

Rootとnative subagentは同じPermission Profileを継承する。Target Snapshotはread-only、隔離scratchだけをwriteableとし、ambient shell、network、credential、container socket、host path、plugin、hook、memory、未承認MCPを与えない。providerの設定だけを信用せず、gVisor相当以上のOS-level sandboxとTransport Eligibility capability probeで継承を確認する。gVisorからhost processまたはplain Dockerへfallbackせず、確認できないruntime versionはproduction不適格とする。

HarnessはCampaign definition、Native Run Receipt、provider usage、private transcript参照、Validation Candidate、Validation result、Finding、Coverageとfailureをappend-onlyに記録する。agent内部のthesis、role、round、family、queueまたはcall順をreplay対象にしない。Target Snapshot、Prompt Set、Agent Runtime version/profile、Permission ProfileとBudget EnvelopeはCampaignへdigest bindする。

人間のApproved Target BatchはResearch対象範囲のauthorizationとして維持する。External Action Authorizationと最後のSubmitも人間だけが行う。AIによるTarget選定、Finding生成、runtime verificationまたはDraft作成を人間専用gateにしない。

## Replacement and rollback

現行v7はannotated tag `research-v7-before-native-agent-loop`で固定する。新設計は別schema familyと別SQLite/CAS rootで実装し、新binaryへ旧writer、旧reader、legacy replay、feature flagまたは未使用Adapterを残さない。rollbackは旧tagのbinaryと旧storageを組にして行う。

promotionにはwhitebox Brizy Boundary Pairを使い、vulnerable cellのLead/Finding recovery、patched cellとbare controlの非昇格、fresh Independent Validationを確認する。これは一般recallの証明ではなく、既に動いたPrompt-led baselineを失わないための回帰gateである。

## Supersession

このADRは次の判断だけを置き換える。

- ADR 0105のprovider-native subagent禁止。credential、network、Target write、ambient tool禁止は維持する。
- ADR 0114、0116、0117のBreadth/Depth分離、固定Finder slot、Depth Admission、Approach Family、Synthesis/Critic/Missing-link Wave。high-impact recall優先とsink非依存は維持する。
- ADR 0120の固定Recon＋Finder構成。raw-source-firstとMapを補助に限定する判断は維持する。
- ADR 0123由来の固定Validation Rubric。single fresh source-only Validationと不確実性をnegativeへ丸めない判断は維持する。
- ADR 0124の「新しいpublic orchestration Interfaceはまだ導入しない」という延期。Independent ValidationがFindingを作るlifecycleは維持する。

append-only record、Target provenance、external Budget enforcement、context separation、runtime isolation、人間の外部行動gateに関する既存ADRは維持する。
