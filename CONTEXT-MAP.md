# Context Map

## Contexts

- [Target Intelligence](docs/domain/target-intelligence/CONTEXT.md) — ecosystemを観測し、Targetを自律選定して人間のBatch承認後にResearchへdispatchする
- [Research](CONTEXT.md) — 固定Target Snapshotを探索し、source-only Independent Validation、Finding、Coverage、記録を管理する
- [Human OS](docs/domain/human-os/CONTEXT.md) — FindingのAI / human runtime verification、理解支援、report承認、外部行動を管理する

## Relationships

```text
Target Intelligence -- admitted Campaign Input ----> Research
Target Intelligence <-- Campaign Coverage Receipt -- Research
Research            -- Finding ---------------------> Human OS
Research            <-- Evidence Request ----- Human OS
```

- **Target Intelligence -> Research**: Target IntelligenceはAIがoracle-freeなTarget Proposalを作り、人間のApproved Target Batchへまとめる。`ApprovedTargetCampaigns.conduct`は実行直前のfreshness、Target Intake、Campaign Policy、WordPress core等のDependency Snapshots、compactなCampaign Threat Contextを検査し、admit済み`CampaignInput`だけをResearchへ渡す。Threat ContextはRootのplanning dataであり、known vulnerabilityや固定探索手順を含めない。Researchは選定policyを再評価しない。
- **Research -> Target Intelligence**: ResearchはCampaign lifecycleをcandidate detailsやFindingから切り離した`Campaign Coverage Receipt`として返す。Target IntelligenceはResearch Ledgerを直接読まず、重複防止、resume、follow-upにだけ使う。
- **Research -> Human OS**: ResearchはIndependent Validationを通過したsource claimをimmutableな`Finding`として渡す。Human OSはResearch storageを直接読まず、Findingと公開Evidence参照だけからfresh AI / human verificationを行い、append-only Verification Recordを作る。raw model transcriptまたはwritable worker stateをcontext間handoffにしない。
- **Human OS -> Research**: 不足証拠は既存Review PacketまたはResearch Ledgerを書き換えず、具体的なproof gapを`Evidence Request`として新しいResearch workへ要求する。
- **Ownership**: Target IntelligenceはBatchとdispatch、Researchは一TargetのCampaign、Finding、Coverage、model capacity、Human OSはruntime / human Verification、理解、report、submission stagingを所有する。物理的に同じprocessまたはSQLite databaseを使っても、別contextのtable、event、内部Moduleを直接更新しない。
