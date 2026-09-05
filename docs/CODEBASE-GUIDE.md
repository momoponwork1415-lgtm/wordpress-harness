# Codebase Guide

Status: living module map, 2026-09-05

ModuleのPurpose、Interface、実装状況、source、Behavior Testを一か所で引くためのガイドである。whole-systemの関係とflowは[Architecture](ARCHITECTURE.md)、research policyは[Research Design](RESEARCH-DESIGN.md)を参照する。

## Current capability

| Product stage | Status | Remaining |
| --- | --- | --- |
| Manual Target Intake | local directoryは実装済み | archive acquisition、selection / ranking |
| Semantic Research | v6 initial Wave、Decision@3、Depth Work Queueまで実装済み | v6 conditional Depth実行 / Closure |
| Source-only Validation | v6へ接続済み | Frontier Gapの次Wave、Risk Assessment |
| Human Review Packet | 未実装 | packet生成とhandoff |
| Human Verification | 未実装 | environment、queue、human disposition |
| Finding | legacy automated Findingのみ | Human Verification gate |

現在のproduction sliceは`Target Intake -> initial Semantic Wave -> Decision@3 / Approach Family -> source-only Validation / Depth Work Queue -> durable replay`である。Depth実行 / Critic / Missing-link / Closureはlegacy v5に実装済みだがv6へ未接続。

完成度をpercentでは表さない。v0.1にはv6 Depth / Closure、Review Packet、Human Verification、Development Cohort再基準化、異なる3件のoracle-free Prospective Campaignが必要である。

残作業の実行順と完了条件は[Issue #86](https://github.com/momoponwork1415-lgtm/wordpress-harness/issues/86)を正本とする。

| Order | Work |
| --- | --- |
| 1 | [#75 v6 Depth Queue](https://github.com/momoponwork1415-lgtm/wordpress-harness/issues/75) -> [#80 Synthesis / Critic](https://github.com/momoponwork1415-lgtm/wordpress-harness/issues/80) |
| 2 | [#81 Validation Gap loop](https://github.com/momoponwork1415-lgtm/wordpress-harness/issues/81) -> [#82 Coverage Closure](https://github.com/momoponwork1415-lgtm/wordpress-harness/issues/82) |
| 3 | [#83 Review Packet](https://github.com/momoponwork1415-lgtm/wordpress-harness/issues/83) -> [#84 Environment](https://github.com/momoponwork1415-lgtm/wordpress-harness/issues/84) -> [#85 Human OS](https://github.com/momoponwork1415-lgtm/wordpress-harness/issues/85) |
| 4 | [#33 Development Cohort](https://github.com/momoponwork1415-lgtm/wordpress-harness/issues/33) -> [#32 Prospective Campaign](https://github.com/momoponwork1415-lgtm/wordpress-harness/issues/32) |

## Target Intelligence

### Target Intake

**Interface:** `TargetIntake.intake(request) -> ready | deferred | rejected`

- **Purpose:** untrustedなarchiveまたはdirectoryを、oracle-freeなTarget Intake Packetへ変換する。
- **Invariants:** identityとversionを照合し、sourceを実行せず、artifactをdurableにしてから`ready`を返す。同じrequestは同じ結果へ収束する。
- **Failures:** policy outcomeは`deferred / rejected`、durable化できないsystem failureだけをerrorにする。
- **Status:** local directory、manifest、quota / path / link検査、Campaign handoffを実装。archive acquisitionは未実装。
- **Code / Tests:** [acquisition](../src/target-intelligence/acquisition), [handoff](../src/research/campaign-control/target-intake-campaign-handoff.ts) · [intake](../tests/target-intelligence/local-directory-target-intake.test.ts), [handoff](../tests/research/target-intake-campaign-handoff.test.ts)

## Research

Context外の入口は`openResearch`。Researchは六Moduleで構成する。

### Campaign Control

**Interface:** `CampaignRunner.prepare / prepareFromTargetIntake / run`、`CampaignReader.inspect`

- **Purpose:** fixed Targetをfinite Wave、Validation、Review Packet handoffまで進める。
- **Invariants:** PlanへTarget、Manifest、policy、profile、tool、budgetを固定する。artifactをCASへ置き、Ledger eventを記録してから次stageへ進む。
- **Failures:** integrity不正は起動前に拒否する。provider / policy / budget failureをnegativeやno-new-evidenceへ丸めない。
- **Status:** v6 initial Wave、Validation、Depth Work Queue、terminal replay、progressを実装。v6 Depth実行 / Closure / Packetは未接続。
- **Code / Tests:** [campaign-control](../src/research/campaign-control), [open-research](../src/research/open-research.ts) · [v6 run](../tests/research/campaign-validation-run.test.ts), [semantic E2E](../tests/research/campaign-semantic-e2e.test.ts), [replay](../tests/research/campaign-run.test.ts)

### Source Understanding

**Interface:** `SourceMapping.build`、`SourceEvidenceGateway.query`

- **Purpose:** TargetFileManifestをsource identityの正本とし、read-only `list / search / read`とoptional Surface Mapを提供する。
- **Invariants:** responseをTarget、Manifest、policy、query ordinalへbindする。Mapはnavigation用であり探索境界やsafe判定にしない。
- **Failures:** path escape、digest / binding不正、budget超過をtyped resultにし、partial sourceを成功へ丸めない。
- **Status:** v2 paginated query、Receipt、Map / deltaを実装。
- **Code / Tests:** [source-mapping](../src/research/source-mapping) · [gateway v2](../tests/research/source-evidence-gateway-v2.test.ts), [mapping](../tests/research/source-mapping.test.ts)

#### PHP Program Index

**Interface:** internal `PhpSourceAnalysis.analyze / read`

- pinned `nikic/PHP-Parser` helperからmanifest-bound indexを作る。
- Target PHP、autoload、Composer script、WordPressを実行しない。timeout、memory、output ceilingを適用する。
- **Status / Tests:** internal slice実装済み · [code](../src/research/source-mapping/php-program-index), [tests](../tests/research/php-program-index.test.ts)

### Exploration

**Interface:** `Exploration.decide`

- **Purpose:** raw sourceからHypothesis、Route Fragment、Frontier Gapを作り、Validation、Depth、次Wave、Closureへ処遇する。
- **Invariants:** ReconとBaselineを並行し、最大4個の独立Finderを保つ。file / CWE / 手順を固定せず、支持数や多数決でcandidateを捨てない。
- **Checkpoint:** subjectをTarget、Manifest、Attempt、Leaseへbindし、CAS / Ledgerへ保存してからackする。
- **Depth:** fresh tool-free Synthesis、source-enabled Critic、Root Evaluation、Missing-link Waveを分離する。Familyごと最大3 evidence generation、Campaign全体最大12 Wave。
- **Closure:** 最後のmaterial evidence後に二回連続のcomplete no-material-deltaを要求し、後者はfresh reviewを含む。
- **Failures:** invalid evaluation、budget exhaustion、active Family、unscheduled Gapを`Incomplete`として残す。
- **Status:** v6 initial Wave / Decision@3 / Depth Work Queueを実装。Depth実行 / Closureはlegacy pathのみ。
- **Code / Tests:** [exploration](../src/research/exploration) · [planning](../tests/research/semantic-root-planning.test.ts), [evaluation](../tests/research/semantic-root-evaluation.test.ts), [Depth](../tests/research/semantic-depth-work-queue.test.ts), [E2E](../tests/research/campaign-semantic-e2e.test.ts)

### Validation

**Interface:** `Validation.validate(plan) -> ValidationRecordRef`

- **Purpose:** Root-evaluated candidateをfreshなsource reviewで反証し、Humanへ渡す明らかなfalse positiveを抑える。
- **Invariants:** exact identityはTarget、Manifest、premise、property、ordered route、anchorで作る。2 fresh Validatorを使い、material conflict時だけ第三Attemptを追加する。
- **Synthesis:** tool-freeで`ready-for-human / needs-research / disproven / rejected`を決める。Attempt不足やfailureは`validation-pending`。
- **Boundary:** Findingやruntime reproductionを所有しない。`needs-research`は具体的Gapとして同じFamilyへ戻す。
- **Status:** fresh Attempt、conditional third、Synthesis、Dispositionをv6へ接続。Risk / Review Packetは未接続。
- **Code / Tests:** [validation](../src/research/validation), [candidate admission](../src/research/campaign-control/validation-candidate-admission.ts) · [Validation](../tests/research/validation.test.ts), [admission](../tests/research/validation-candidate-admission.test.ts)

### Model Execution

**Interface:** `ModelExecution.run(plan, observer?) -> AttemptExecutionResult`

- **Purpose:** immutable Attempt Planをprovider-neutral resultへ変換し、process、tool、credentialを隠す。
- **Invariants:** official transportだけを使い、model / effortを固定する。role間でsession、conversation、scratchを共有しない。
- **Tools:** manifest-bound read-only source toolだけを許可する。Finder checkpointはdurable write後にackする。Synthesis / Riskはtool-free。
- **Recovery:** transient failureだけを同じAttemptと残budgetでresumeする。Recoveryの正本はLedger、CAS、checkpoint。
- **Failures:** provider、auth、policy、invalid output、budget、cancelを区別する。observer / private transcript failureはoutcomeを変えない。
- **Status:** Claude Adapter、usage、Receipt、resume、private transcriptを実装。
- **Code / Tests:** [model-execution](../src/research/model-execution) · [execution](../tests/research/model-execution.test.ts), [bridge](../tests/research/claude-source-evidence-bridge.test.ts)

### Research Record

Internal Module。immutable CAS artifact、append-only Ledger event、checkpoint、replay projectionを所有する。

- artifactを保存してから参照eventをappendする。
- cacheを削除しても同じLedgerから同じview digestを再構築できる。
- semantic identity、priority、Family groupingはowner Moduleが決める。
- **Status / Tests:** Decision@3、Family、Validation、Frontier Gap、Depth Work Queue、progress replayを実装 · [code](../src/research/research-record), [record](../tests/research/semantic-iteration-decision-record-v3.test.ts), [compatibility](../tests/research/ledger-compatibility.test.ts)

## Human OS

### Human Verification Environment

**Interface:** `HumanVerificationEnvironmentBuilder.establish -> ready | setup-blocked`

- Packetと一致するTargetをfresh disposable environmentへ構築する。
- target codeをhost上で実行せず、privileged container、host network、engine socket、ambient credential、許可外egressを使わない。
- setup failureをValidation negativeへ丸めず、plain Docker等へsilent fallbackしない。
- **Status:** 未実装。

### Human Verification

**Interface:** `HumanVerification.admit`、`HumanVerification.record`

- 一Campaign最大3 unique mechanismをactive queueへ入れる。超過はHuman Deferredとして保持する。
- 人間がfresh environment、実Target interface、attacker premise、Security Effectを確認する。
- dispositionは`verified-finding / rejected / more-evidence-required / blocked`。
- Findingを作れるのは`verified-finding`だけ。外部報告は別承認。
- **Status:** 未実装。

### Legacy Verification

ADR 0122以前の`VerificationRecord / Finding / Disproved / Blocked`を元の意味でread/replayする互換境界。

- 旧Findingを`ready-for-human`や現行Findingへ自動変換しない。
- gVisor Lab、Witness、Causal Controlは任意のHuman Verification Assistantとして再利用できる。
- **Status / Tests:** replay compatibility実装済み · [code](../src/research/verification), [tests](../tests/research/verification.test.ts), [gVisor](../tests/research/gvisor-account-takeover-lab.test.ts)

## Adapters and runtime policy

- CLIは`prepare / inspect`だけを持つthin adapter。[code](../src/cli.ts) · [tests](../tests/cli/campaign-cli.test.ts)
- current policyは`semantic-research-recall-baseline-v6`。
- Campaign ceilingは12 Wave、USD 150、12 hours。Validation reserveはUSD 30。
- v1 Map-firstとv5 Verificationはread/replay互換として残す。
- ceiling到達はnegativeではなくtyped IncompleteまたはPending。

## Change path

1. この文書でowner、Interface、source、Behavior Testを特定する。
2. public behaviorをTestから観測する。
3. hard-to-reverseな理由が必要な時だけ`docs/adr/`を読む。
4. 次の有限workと受入条件はGitHub Issueで確認する。

Schema field、private helper、provider argv、内部call順はこのGuideへ複製しない。
