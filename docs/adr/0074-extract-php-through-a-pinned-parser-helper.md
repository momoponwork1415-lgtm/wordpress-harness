---
status: accepted
---

# Extract PHP through a pinned parser helper

deterministic WordPress surface extractionは、strict TypeScript coreからComposer lockした`nikic/PHP-Parser` helperをchild processとして呼び、versioned JSONの`PHP Program Index`を受け取る方式で始める。

helperはTarget Snapshotをuntrusted inputとして読むだけで、pluginのPHP fileを`include`、`require`、autoload、eval、またはWordPress bootstrapしない。target自身のComposer scriptやdependency installationも実行しない。helper dependencyはharness build時に取得してlockし、parser version、helper version、analysis schema version、Target Snapshot digestを出力identityへ含める。

helper processはread-only Target Snapshot、専用scratch、network deny、CPU・memory・wall-time・output-size上限の下で実行する。stdoutは一つのmachine-readable resultだけに使い、diagnosticは構造化する。TypeScript側はruntime schemaで全outputをdecodeし、未知schema、source range不整合、digest不一致、output truncationをfail closedにする。parse不能fileを黙って除外せず、Surface MapのgapまたはCampaignのBlocked理由として残す。

外部interfaceは次の一操作に保つ。

```text
PhpSourceAnalysis.analyze(TargetSnapshotRef, AnalysisProfile)
  -> PhpProgramIndexRef | AnalysisFailure
```

process起動、Composer autoload、parser node traversal、name resolution、WordPress固有fact extraction、canonical ordering、CAS保存はmodule implementationへ隠す。callerへparser object、visitor lifecycle、temporary file、subprocess protocolを公開しない。

初期実装は一つだけなので、汎用`Parser` portやadapter hierarchyは作らない。実Target corpusで、PHP-Parserが処理できない構文、error recovery、別言語との統合により実害のあるcoverage gapが観測された場合に限り、tree-sitter等を第二実装として評価し、その時点で共通seamを抽出する。自動fallbackは解析結果の意味を不透明にするため許可しない。

Milestone 1の`PHP Program Index`は、genericなsymbol・call relationと、WordPress固有のregistration、callback、guard、source、storage、sink factまでに限定する。汎用taint engine、完全なcall graph、脆弱性verdictを実装せず、cross-file reasoningはsourceを直接参照できるMapperとDiscoveryに残す。実測したmissを根拠に後からdeterministic analysisを深める。
