---
status: accepted
---

# Make validated Findings the product success criterion

Productの成功条件を、oracle-freeなDiscoveryが脆弱性candidateを発見し、別のIndependent Validationが主張をsource evidenceから支持してFindingを生成できることに置く。

Target Selection、runtime reproduction、Human OS、external submission支援と隔離方式の高度化は、この診断coreのpromotion条件にしない。これらが未接続または不完全でも、DiscoveryからValidationまでの診断結果を失敗扱いしない。

## Diagnostic core

外から見える必須flowは次だけである。

```text
Target Snapshot -> agent-led Discovery -> Validation Candidate
                -> fresh Independent Validation -> Finding / Disproved / Incomplete
```

HarnessはTargetとPromptのbinding、探索状態、usage、failure、candidate、Validation resultとFindingを記録する。AIは調査順序、subagent、継続、停止、candidateと検証方法を決める。

合否は既知positiveのoracle-free再発見、Independent Validation成立、patched negative controlの同一causal identity非昇格で測る。LOC、sandbox機能数、Target Selection自動化、Human OS接続またはCampaign Coverage closureを診断精度の代理指標にしない。

## Safety envelope

隔離は診断domainではなく、untrusted sourceとprovider processを扱う実行Adapterの安全条件である。既存gVisor Adapterを再利用し、Target sourceをhost上で実行せず、plain Dockerやhost processへsilent fallbackしない。ただし隔離receipt、capability taxonomyまたはnetwork policyをResearchのpublic Interfaceへ広げず、実CVEの発見・検証を改善しない隔離機能へ先行投資しない。

## Supporting workflows

Target Proposal、Approved Target Batch、Human OS、Submission Draftは診断coreの前後に接続できるsupporting workflowである。診断coreはこれらから直接呼べることを必須にせず、一Target Snapshotを明示して単独実行できる。外部提出は引き続き人間だけが行う。

## Consequences

- 実装とTestの中心を`ResearchCampaigns.conduct / inspect`から観測できるDiscovery、Validation、Finding、failureへ絞る。
- 隔離、選定、提出支援の未接続を診断coreのblockerとして扱わない。
- 既知CVE corpusの再発見が完了するまで、周辺workflowの追加実装や抽象化を止める。
- 周辺codeを削除する場合は、診断coreが利用するAdapterと記録まで巻き込まないことをBehavior Testで確認する。

## Supersession

ADR 0125のagent-led Discovery、fresh Independent Validation、thin evidence shellは維持する。同ADRのTarget Selection、Human OS、隔離方式をResearch promotionの一体的な完成条件として扱う読み方だけを置き換える。
