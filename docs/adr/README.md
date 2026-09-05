# Architecture Decision Records

現在のsystemで直接効いているhard-to-reverseな判断だけを置く。superseded decisionは現役一覧に残さずGit履歴から読む。現在のInterfaceとfailure semanticsは[Module Design Index](../design/README.md)からowning Seamを参照する。

## Research policy

- [ADR 0001 — 10動詞をcontrol propertyにする](0001-ten-verbs-as-control-properties.md)
- [ADR 0003 — Discoveryへ脆弱性oracleを渡さない](0003-do-not-give-discovery-a-vulnerability-oracle.md)
- [ADR 0112 — Analysis Unitを探索境界にしない](0112-treat-analysis-units-as-seeds-for-bounded-source-retrieval.md)
- [ADR 0113 — Evidence Shell内でFinderの方法を自由にする](0113-keep-finder-methods-free-behind-an-evidence-shell.md)
- [ADR 0114 — BreadthとDepthのpolicyを分ける](0114-separate-breadth-and-depth-campaign-policies.md)
- [ADR 0116 — Depth Waveを最大4 Finderにする](0116-use-four-finder-slots-per-depth-wave.md)
- [ADR 0117 — high-impact semantic recallを優先する](0117-optimize-for-high-impact-semantic-recall.md)
- [ADR 0120 — source-aware Reconとwhole-target baselineを並行する](0120-run-source-aware-recon-alongside-a-whole-target-baseline.md)

## Evidence, ownership, and isolation

- [ADR 0024 — append-only Research Ledgerを使う](0024-use-one-append-only-research-ledger.md)
- [ADR 0051 — budgetをmodel外で強制する](0051-enforce-campaign-budgets-outside-the-model.md)
- [ADR 0063 — orchestrator / agent / Targetを隔離する](0063-separate-the-orchestrator-agent-and-target-trust-zones.md)
- [ADR 0115 — 公開CVEの実験結果だけをGitへ置く](0115-publish-only-public-cve-experiment-results.md)
- [ADR 0118 — source provenanceをTargetFileManifestへbindする](0118-bind-source-provenance-to-the-target-file-manifest.md)
- [ADR 0122 — source ValidationとHuman Verificationを分ける](0122-separate-source-validation-from-human-verification.md)

## Technology and system shape

- [ADR 0029 — Prompt Setをversioned artifactとして扱う](0029-render-one-versioned-prompt-set.md)
- [ADR 0054 — CLIをthin adapterにする](0054-keep-the-cli-as-a-thin-adapter.md)
- [ADR 0055 — coreをstrict TypeScriptで実装する](0055-use-strict-typescript-for-the-core.md)
- [ADR 0056 — LedgerをSQLite、evidenceをCASへ置く](0056-store-the-ledger-in-sqlite-and-evidence-in-a-cas.md)
- [ADR 0074 — PHP解析はpinned parser helperを使う](0074-extract-php-through-a-pinned-parser-helper.md)
- [ADR 0084 — modular monolithを使う](0084-use-a-modular-monolith.md)
- [ADR 0104 — 公式Model Transportだけを受理する](0104-admit-only-official-model-transports.md)
- [ADR 0105 — Harness所有toolだけをworkerへ公開する](0105-expose-only-harness-owned-attempt-tools.md)

旧Verification artifactのread-only replayと任意Human Verification Assistantの現行contractは[Legacy Verification compatibility Seam](../design/verification-seam.md)を正本とする。旧Finding gateや過去のisolation decisionを個別ADRとして現役docsへ残さない。
