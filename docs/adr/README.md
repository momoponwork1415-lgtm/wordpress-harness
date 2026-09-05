# Architecture Decision Records

現在のsystemで直接効いている、hard-to-reverseな判断だけを残す。過去の細粒度な判断やsuperseded designはGit履歴から参照する。

## Research policy

- [ADR 0001 — 10動詞をcontrol propertyにする](0001-ten-verbs-as-control-properties.md)
- [ADR 0003 — Discoveryへ脆弱性oracleを渡さない](0003-do-not-give-discovery-a-vulnerability-oracle.md)
- [ADR 0015 — Discoveryをhigh recallに保つ](0015-keep-discovery-high-recall.md)
- [ADR 0112 — Analysis Unitを探索境界にしない](0112-treat-analysis-units-as-seeds-for-bounded-source-retrieval.md)
- [ADR 0113 — Evidence Shell内でFinderの方法を自由にする](0113-keep-finder-methods-free-behind-an-evidence-shell.md)
- [ADR 0114 — BreadthとDepthのpolicyを分ける](0114-separate-breadth-and-depth-campaign-policies.md)
- [ADR 0116 — Depth Waveを最大4 Finderにする](0116-use-four-finder-slots-per-depth-wave.md)
- [ADR 0117 — high-impact semantic recallを優先する](0117-optimize-for-high-impact-semantic-recall.md)
- [ADR 0119 — Finder checkpointをWave Barrier前に公開する](0119-release-finder-checkpoints-before-the-wave-barrier.md)
- [ADR 0120 — source-aware Reconとwhole-target baselineを並行する](0120-run-source-aware-recon-alongside-a-whole-target-baseline.md)

## Evidence and isolation

- [ADR 0024 — append-only Research Ledgerを使う](0024-use-one-append-only-research-ledger.md)
- [ADR 0051 — budgetをmodel外で強制する](0051-enforce-campaign-budgets-outside-the-model.md)
- [ADR 0063 — orchestrator / agent / Targetを隔離する](0063-separate-the-orchestrator-agent-and-target-trust-zones.md)
- [ADR 0115 — 公開CVEの実験結果だけをGitへ置く](0115-publish-only-public-cve-experiment-results.md)
- [ADR 0118 — source provenanceをTargetFileManifestへbindする](0118-bind-source-provenance-to-the-target-file-manifest.md)
- [ADR 0122 — source ValidationとHuman Verificationを分ける](0122-separate-source-validation-from-human-verification.md)

## Technology and boundaries

- [ADR 0054 — CLIをthin adapterにする](0054-keep-the-cli-as-a-thin-adapter.md)
- [ADR 0055 — coreをstrict TypeScriptで実装する](0055-use-strict-typescript-for-the-core.md)
- [ADR 0056 — LedgerをSQLite、evidenceをCASへ置く](0056-store-the-ledger-in-sqlite-and-evidence-in-a-cas.md)
- [ADR 0061 — subscription modelは公式native processを使う](0061-use-native-agent-processes-for-subscription-models.md)
- [ADR 0074 — PHP解析はpinned parser helperを使う](0074-extract-php-through-a-pinned-parser-helper.md)
- [ADR 0084 — modular monolithを使う](0084-use-a-modular-monolith.md)
- [ADR 0104 — 公式Model Transportだけを受理する](0104-admit-only-official-model-transports.md)
- [ADR 0105 — Harness所有toolだけをworkerへ公開する](0105-expose-only-harness-owned-attempt-tools.md)

## Legacy-to-current traceability

- [ADR 0004 — legacy repositoryは移植せず設計意図だけ採る](0004-mine-the-legacy-repository-do-not-port-it.md)
- [ADR 0029 — Prompt Setをversioned artifactとして扱う](0029-render-one-versioned-prompt-set.md)

この2件は[wp2shell prompt decomposition](../research/wp2shell-prompt-decomposition.md)のtraceabilityに必要なため残す。

## Superseded evidence and ownership decisions

次のADRは[ADR 0122](0122-separate-source-validation-from-human-verification.md)以前のLedger replayとHuman Verification Assistantの安全要件を解釈するために残す。新しいCampaignのFinding gateまたはcontext ownershipには使わない。

- [ADR 0007 — Findingへ実行可能なWitnessを要求する](0007-require-an-executable-witness-for-every-finding.md)
- [ADR 0008 — Causal Controlを要求する](0008-require-a-causal-control.md)
- [ADR 0067 — production evidenceへgVisorを要求する](0067-require-gvisor-for-production-evidence.md)
- [ADR 0068 — WitnessとControlをfresh sibling Labで実行する](0068-run-witness-and-control-in-sibling-labs.md)
- [ADR 0085 — Target Intelligence / Research / Human OSを分ける](0085-separate-target-intelligence-research-and-human-os.md)
- [ADR 0119 — Finder checkpointをWave Barrier前に公開する](0119-release-finder-checkpoints-before-the-wave-barrier.md)
- [ADR 0121 — Verificationを観測可能なsecurity effectへbindする](0121-bind-verification-to-observable-security-effects.md)

新しいADRは、現在のPrinciplesまたはowning Seamだけでは判断理由を保持できない、hard-to-reverseなtrade-offに限って追加する。
