---
status: accepted; role-specific orchestration schemas superseded by ADR 0125
---

# Use strict TypeScript for the core

Campaign orchestration、Research Ledgerのreplay、scheduler、provider adapters、typed Verification、CLIはstrict TypeScriptで実装する。Research Ledger event、Hypothesis outcome、Experiment plan/evidenceはversioned discriminated unionとし、serializer、reducer、projection、evidence gateの更新漏れをexhaustive checkingで検出する。

`strict`に加えて`noUncheckedIndexedAccess`、`exactOptionalPropertyTypes`、`useUnknownInCatchVariables`を有効にする。CLI、設定、Ledger、model/provider responseなど外部境界は`unknown`として受け、一つのruntime schema方式でdecodeする。`any`または型assertionをvalidationの代用にしない。

browser Verificationは公式PlaywrightをTypeScriptから利用し、coreとExperiment evidence型を共有する。Pythonはread-only解析、fixture生成、短命な研究用child toolとして利用できるが、Campaign stateの正本とlifecycleを所有しない。Goはprocess supervisionまたはCPU-bound処理が実測上の支配要因になった場合に再評価し、初期構成を二言語化しない。
