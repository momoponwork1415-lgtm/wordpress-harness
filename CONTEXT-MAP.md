# Context Map

## Contexts

- [Target Intelligence](docs/domain/target-intelligence/CONTEXT.md) — ecosystemを観測し、Targetを自律選定して人間のBatch承認後にResearchへdispatchする
- [Research](CONTEXT.md) — 固定Target Snapshotを探索し、source-only Validation、記録、優先順位付け、Runtime Verification Packet handoffを行う
- [Human OS](docs/domain/human-os/CONTEXT.md) — AI Reproduction、人間のmandatory fresh reproduction、理解支援、Finding、report承認、外部行動を管理する

## Relationships

```text
Target Intelligence -- Target Intake Packet --> Research
Target Intelligence <-- Campaign Coverage Receipt -- Research
Research            -- Runtime Verification Packet --> Human OS
Research            <-- Evidence Request ----- Human OS
```

- **Target Intelligence -> Research**: Target Intelligenceはoracle-freeなSelection Receiptを人間のApproved Target Batchへまとめ、実行直前のfreshness確認と取得後に`Target Intake Packet`だけをdispatchする。Researchは選定policyを再評価しない。
- **Research -> Target Intelligence**: ResearchはCampaign lifecycleをcandidate detailsやFindingから切り離した`Campaign Coverage Receipt`として返す。Target IntelligenceはResearch Ledgerを直接読まず、重複防止、resume、follow-upにだけ使う。
- **Research -> Human OS**: Researchは一回のfresh source Validation結果とruntimeで試せるrouteを`Runtime Verification Packet`へ固定する。Human OSはAI ReproductionからTriage Reproduction Packetを作り、人間が別fresh instanceで必ず再実行する。Finding、raw model transcriptまたはwritable worker stateをcontext間handoffにしない。
- **Human OS -> Research**: 不足証拠は既存Review PacketまたはResearch Ledgerを書き換えず、具体的なproof gapを`Evidence Request`として新しいResearch workへ要求する。
- **Ownership**: Target IntelligenceはBatchとdispatch、Researchは一TargetのCampaignとOpus capacity、Human OSは人間の理解、Verification、report、submission stagingを所有する。物理的に同じprocessまたはSQLite databaseを使っても、別contextのtable、event、内部Moduleを直接更新しない。
