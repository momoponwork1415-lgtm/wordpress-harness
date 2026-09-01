# Context Map

## Contexts

- [Target Intelligence](docs/domain/target-intelligence/CONTEXT.md) — ecosystemの観測から調査対象を選定・取得し、oracleを除いた受入情報を作る
- [Research](CONTEXT.md) — 固定Target Snapshotを探索、独立検証、記録、優先順位付け、反復する
- [Human OS](docs/domain/human-os/CONTEXT.md) — 人間が証拠を独立確認し、追加証拠または外部行動を判断する

## Relationships

```text
Target Intelligence -- Target Intake Packet --> Research
Research            -- Human Review Packet --> Human OS
Research            <-- Evidence Request ----- Human OS
```

- **Target Intelligence -> Research**: Target Intelligenceは正規化source tree、取得原本、採用結論、policy version、oracle-freeな選定理由と取得provenanceを`Target Intake Packet`へ固定する。Researchは正規化ファイル一覧をsource tree identityとして`Target Snapshot`を作り、選定policyを再評価しない。
- **Research -> Human OS**: ResearchはFindingと再現に必要な最小証拠を`Human Review Packet`へ固定する。raw model transcriptまたはwritable worker stateをhandoffにしない。
- **Human OS -> Research**: 不足証拠は既存FindingまたはResearch Ledgerを書き換えず、`Evidence Request`として新しいResearch workを要求する。
- **Ownership**: 各contextは自分の判断記録を所有する。物理的に同じprocessまたはSQLite databaseを使っても、別contextのtable、event、内部moduleを直接更新しない。
