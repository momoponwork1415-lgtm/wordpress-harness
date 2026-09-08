---
status: accepted
---

# Use strict TypeScript for the core

Target Intelligence、Research、Human OS、provider AdapterとCLIのproduction coreはstrict TypeScriptで実装する。永続event、context handoffとnative agent outputはversioned discriminated unionとruntime schemaを使い、record、projectionとgateの更新漏れをexhaustive checkingで検出する。

`strict`に加えて`noUncheckedIndexedAccess`、`exactOptionalPropertyTypes`、`useUnknownInCatchVariables`を有効にする。CLI、設定、Ledger、model/provider responseなど外部境界は`unknown`として受け、一つのruntime schema方式でdecodeする。`any`または型assertionをvalidationの代用にしない。

別言語の研究用toolを使っても、Campaign stateの正本とlifecycleは所有させない。一つの型systemでcontext handoffとfailure semanticsを検査し、大規模な変更で旧schemaや旧orchestrationを残さないためである。
