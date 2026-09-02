# Codebase Guide

Status: living map, 2026-09-02

この文書は、コードを一行ずつ記憶せずに、現在の実装と設計上の置き場所を15分程度で再構成するための索引である。詳細仕様を複製せず、正本となる設計、公開Interface、実装、Testを結び付ける。

## 頭に残すもの

次の5点だけを長期記憶の対象にする。

1. North Starは、oracle-freeな実戦Campaignで未知のRCEまたは同等のsite-wide compromiseを発見し、独立Verificationで実証すること。
2. 設計原則は`confine -> constrain -> focus -> motivate -> parallelize -> hypothesize -> verify -> record -> prioritize -> iterate`である。
3. 結果の流れは`Target Intelligence -> Research -> Human OS`であり、context間ではversioned handoffだけを渡す。
4. Researchの第一階層は`Campaign Control`、`Source Understanding`、`Exploration`、`Verification`、`Model Execution`、`Research Record`の6 Moduleである。
5. Research contextの公開入口は`openResearch`だけであり、`openPhpSourceAnalysis`はSource Mapping内部のInterfaceである。

個別のschema field、SQLite table、provider command、108件のADR、内部関数は暗記しない。変更対象から必要な正本へ辿る。

## 15分で現在地を戻す

1. [Module Map](design/architecture/module-map.md)で各Moduleの機能、入出力、現在の実装状況を確認する。
2. この文書の「現在の実装」と「設計上の現在地」を読む。
3. [アーキテクチャ概要](design/architecture/architecture-overview.md)の3枚の図で全体と信頼領域を確認し、探索を変更する場合は[探索エージェント構成](design/architecture/exploration-agent-architecture.md)の図を読む。実装との対応まで確認する場合は[探索アーキテクチャ詳細ガイド](visuals/exploration-architecture.html)を開く。
4. 作業中のGitHub Issueから、変更するModuleのSeam文書とTestを一つずつ開く。

Source Mappingを変更する場合は、先に[Surface Map visual guide](visuals/surface-map.html)で「小さなInterface」「根拠状態」「AI Mapperとの責任分担」を確認する。

通常の実装変更で[Module architecture](design/module-architecture.md)全体や全ADRを通読する必要はない。新しいModule ownershipを決める場合だけ該当節へ進み、意外な判断の理由が必要な場合だけSeamから直接linkされたADRを読む。

## 現在の実装

| Capability | Status | Public Interface | Implementation | Behavior Test | Canonical Design |
| --- | --- | --- | --- | --- | --- |
| Campaign preparation and read-only inspection | implemented | `openResearch` -> `ResearchModule.runner` / `reader` | [`src/research/index.ts`](../src/research/index.ts), [`open-research.ts`](../src/research/open-research.ts), [`campaign-control`](../src/research/campaign-control/index.ts), [`research-record`](../src/research/research-record/index.ts) | [`campaign-prepare.test.ts`](../tests/research/campaign-prepare.test.ts), [`ledger-compatibility.test.ts`](../tests/research/ledger-compatibility.test.ts), [`context-interface.test.ts`](../tests/research/context-interface.test.ts) | [Initial implementation seams](design/initial-implementation-seams.md) |
| Content-addressed PHP Program Index | implemented, internal | `openPhpSourceAnalysis` -> `PhpSourceAnalysis.analyze` | [`source-mapping/php-program-index`](../src/research/source-mapping/php-program-index/index.ts), [`file-json-artifact-store.ts`](../src/research/research-record/file-json-artifact-store.ts), [`tools/php-program-index`](../tools/php-program-index) | [`php-program-index.test.ts`](../tests/research/php-program-index.test.ts) | [PHP Program Index seam](design/php-program-index-seam.md) |
| Evidence-graded static Surface Map | partial, internal | `openSourceMapping` -> `SourceMapping.build` | [`source-mapping/index.ts`](../src/research/source-mapping/index.ts), [`static-source-mapping.ts`](../src/research/source-mapping/static-source-mapping.ts), [`contracts.ts`](../src/research/source-mapping/contracts.ts) | [`source-mapping.test.ts`](../tests/research/source-mapping.test.ts) | [Source mapping seam](design/source-mapping-seam.md) |
| Deterministic Exploration planning and Hypothesis ingestion | partial, internal | `openExploration` -> `Exploration.decide(bootstrap \| wave-completed)` | [`exploration/index.ts`](../src/research/exploration/index.ts), [`bootstrap-exploration.ts`](../src/research/exploration/bootstrap-exploration.ts), [`contracts.ts`](../src/research/exploration/contracts.ts) | [`exploration-bootstrap.test.ts`](../tests/research/exploration-bootstrap.test.ts) | [Exploration seam](design/exploration-seam.md) |
| Tool-free Claude Finder execution | partial, internal | `openModelExecution` / `openClaudeModelExecution` -> `ModelExecution.run` | [`model-execution/index.ts`](../src/research/model-execution/index.ts), [`model-execution.ts`](../src/research/model-execution/model-execution.ts), [`claude-process.ts`](../src/research/model-execution/claude-process.ts) | [`model-execution.test.ts`](../tests/research/model-execution.test.ts) | [Model execution seam](design/model-execution-seam.md) |
| Command-line adapter | implemented | `runCli` and `wordpress-harness` executable | [`src/cli.ts`](../src/cli.ts) | [`campaign-cli.test.ts`](../tests/cli/campaign-cli.test.ts) | [ADR 0053](adr/0053-start-with-a-cli-interface.md), [ADR 0054](adr/0054-keep-the-cli-as-a-thin-adapter.md) |

`src/research/index.ts`はcontext外へCampaign contractと`openResearch`だけを公開する。`open-research.ts`がcomposition rootとなり、Campaign lifecycleは`campaign-control/`、append/replay/CASは`research-record/`、PHP Program Indexは`source-mapping/`の内部に置く。ExplorationとModel ExecutionはResearch内部のseamであり、`CampaignRunner.run(plan)`のclosed pathからcomposition済みである。operator CLIはまだ`run`を公開していない。未実装Moduleのfolderを先回りで作らず、behaviorを追加するIssueで一つずつ増やす。

## 現在動く縦の経路

2026-09-02時点では、次のinner vertical sliceをprivate development benchmarkで実Targetに通している。

```text
Surface Map
  -> Exploration.bootstrap
  -> one Work Lease
  -> ModelExecution.run (Claude Opus 5, tool-free)
  -> schema-valid Finder Attempt Result
  -> Exploration.wave-completed
  -> source-bound Hypothesis refs
  -> verify decision
```

`CampaignRunner.run`の最初のbehavior sliceは、CAS固定のSurface Mapから有限Work Wave、Finder、独立Verification、Finding、Iteration Decision、Research Ledger replayまでを一つのpublic入口で接続している。Finderの外部実行より前にAttempt intentを記録し、中断したprocessを`orphaned`へ確定して残予算内のfresh Attemptへ置き換える。production Finder materializerはFocus Areaから希少な共有hook、PHP template参照、Map relation、call neighborを上限内で選び、実source digestを再検査したoracle-free promptを作る。仮説なしで予算が残る場合はpure Iteration Reviewが停止条件付きの有限next workをCASへ固定する。opaqueなprivate Calibration Reviewはterminal Verification refsだけを比較し、context digest付きreceiptが揃った場合だけ`stop-boundary-pair-complete`を記録する。閉路system testに加え、privateなBrizy Boundary Pairへproduction adapterを接続した。2.8.11のoracle-free Campaignは3 Opus Finderからsource-bound Hypothesis、独立Verifier、gVisor/browser experiment pair、Findingへ到達し、private Calibration Fingerprintによる照合後に`stop-boundary-pair-complete`とLedger replayを記録した。

Verification内部の最初のtracerは、Stored XSSのgVisor/no-fallback binding、fresh sibling、browser Witness、Causal Control、normal-function条件を検査し、Finding、同じCausal Identityに限定したDisproved、またはVerifier/gVisor unavailable・sibling configuration mismatch・non-hermetic fallback・evidence incompleteのBlockedをprivate CASとResearch Ledgerへdurable writeしてclose/reopen後にreplayできる。production Claude Independent VerifierはEvidence Routeに結び付く実sourceだけをdigest再検査してtool-free Opusへ渡し、model identityと返却source evidenceを再検査する。支持できない場合も、必要条件の不成立をsource evidenceへ拘束できれば`source-falsified`として同じExperimentへ進み、単なる不明はBlockedに保つ。Stored XSS専用のproduction Lab Controlは、shellなしのDocker process adapter、`runsc`とlocal content-addressed imageの事前gate、Target manifestとruntime/setup/private fixture/worker/input/baselineのdigest再計算、fresh internal WordPress Lab、sanitized Observationまで実装済みである。gVisor netstackがuser-defined bridgeのDocker DNSを提供しないため、検査したcontainer IPだけを同一internal networkへ注入し、host networkやplain Dockerへfallbackしない。2.8.11は実OpusとgVisorでFinding、2.8.12は同じ固定Causal IdentityでDisprovedとなり、両方にfresh experiment pairとnormal-function evidenceを記録した。process crash後は未完成のsource再導出と実験を再利用せずfresh pairをやり直し、完成済みrecordだけを副作用なしにreplayする。[Verification Behavior Test](../tests/research/verification.test.ts)、[Independent Verifier Test](../tests/research/claude-independent-verifier.test.ts)、[Lab Control Test](../tests/research/gvisor-stored-xss-lab.test.ts)で保護する。

## 設計上の現在地

| Module | Production Status | 現在存在する土台 | 次に読む文書 |
| --- | --- | --- | --- |
| Campaign Control | partial | prepare、read、inspect、one-Wave closed-loop `run(plan)`、deterministic replay、route-adjacent production Finder materializer、opaque Calibration Review | [Campaign execution seam](design/campaign-execution-seam.md) |
| Source Understanding | partial | PHP Program Index、静的initial/source revision、asset inventory、根拠状態、coverage gap | [Source mapping seam](design/source-mapping-seam.md) |
| Exploration | partial | bootstrap Map gate、Focus Area、有限Work Wave、Lane/Strategy/model-family割当、Source-bound Hypothesis取込 | [Exploration seam](design/exploration-seam.md) |
| Verification | partial | `verify(plan)`、route-bound production Claude Independent Verifier、source-supported/source-falsified再導出、Stored XSS Finding/Disproved、Verifier/gVisor/sibling Blocked、typed Witness/Control、durable outcome replay、Brizy実TargetのgVisor実証 | [Verification seam](design/verification-seam.md) |
| Model Execution | partial | Finder schema、共有Claude structured process、tool-free version/auth probe、budget/process-group終了、provider envelope policy監査、bounded provider error detail、private Finder result CAS | [Model execution seam](design/model-execution-seam.md) |
| Research Record | partial | single-writer SQLite Ledger、canonical digest、Campaign preparation、Verification start/completion replay | [Initial implementation seams](design/initial-implementation-seams.md) |
| Target Intelligence | not implemented | manual intake設計のみ | [Target intake seam](design/target-intake-seam.md) |
| Human OS | not implemented | handoff ownershipのみ | [Module architecture](design/module-architecture.md#human-os-modules) |

Milestoneの順序と完了条件は[Roadmap](design/roadmap.md)、実装Issueの依存順は[Issue #8](https://github.com/momoponwork1415-lgtm/wordpress-harness/issues/8)を正本とする。

[First closed vertical slice goal](design/first-closed-slice-goal.md)は2026-09-02にClosure Gateを通過した。Brizy Boundary Pairでone-Wave実行、crash recovery、Finding/Disproved、Calibration Fingerprint、Iteration Decision、`stop-boundary-pair-complete`、close/reopen replayを実証済みである。次のdeliveryは、同文書のPost-goal Transfer Planから独立Goalとして開始し、現在のclosed pathを壊さずmechanismを一つずつ追加する。

## 情報の正本

| 知りたいこと | 正本 | ここへ置かないもの |
| --- | --- | --- |
| 用語の意味と関係 | 各contextの`CONTEXT.md`と[Context Map](../CONTEXT-MAP.md) | file path、class名、実装手順 |
| systemの制約と大きなflow | [Architecture](design/architecture.md) | 現在の実装進捗 |
| Module ownershipと許可依存 | [Module architecture](design/module-architecture.md) | Issueの作業手順 |
| 公開Interface、不変条件、failure、受入scenario | 各Seam文書 | 内部helperの一覧 |
| 現在の実装場所とstatus | このCodebase Guide | 詳細仕様の再記述 |
| 実行可能なbehavior | 公開Interfaceから観測するTest | private methodや内部call順 |
| hard-to-reverseな判断の理由 | ADR | 作業メモ、容易に変えられる選択 |
| 今回変更する範囲 | GitHub Issue | 長期domain definition |
| coding agentの開発規則 | [`AGENTS.md`](../AGENTS.md) | 製品architectureの再記述 |

同じ事実を複数文書で保守しない。概要文書は正本へlinkし、詳細をコピーしない。

## 変更するときの経路

1. GitHub Issueで一つの観測可能なbehaviorと対象Moduleを確認する。
2. この文書から該当Seamと既存Public Interfaceを開く。
3. Testを先に読み、外から観測できる現在のbehaviorを確認する。
4. Interface、Module ownership、実装status、主要pathのいずれかが変わる場合は、codeと同じ変更でこの表を更新する。
5. domain termが変わる場合だけ`CONTEXT.md`、hard-to-reverseな判断が生じる場合だけADRを更新する。

Module内部のhelper追加、局所的なrefactor、private file移動を一件ずつこの表へ記録しない。人間が追う単位はfileではなく、安定したInterfaceを持つModuleである。
