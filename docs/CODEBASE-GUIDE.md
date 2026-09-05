# Codebase Guide

Status: living module map, 2026-09-05

ModuleのPurpose、Interface、実装状況、source、Behavior Testを一か所で引くためのガイドである。whole-systemの関係とflowは[Architecture](ARCHITECTURE.md)、research policyは[Research Design](RESEARCH-DESIGN.md)を参照する。

## Current capability

| Product stage | Status | Remaining |
| --- | --- | --- |
| Manual Target Intake | local directoryは実装済み | archive acquisition、selection / ranking |
| Semantic Research | v6 initial Wave、Decision@3、conditional Depth実行まで実装済み | Missing-link / Closure |
| Source-only Validation | v6 single fresh Attemptと4 dispositionを実装済み | Frontier Gapの次Wave |
| Runtime handoff | Runtime Verification Packet v2とAI Reproduction intakeを実装済み | 実Targetでのhandoff実測 |
| AI Reproduction | typed attempt、class別・generic Recipe、private evidence、Triage Packetを実装済み | 実Targetでのruntime実測 |
| Human Verification | mandatory fresh再実行、二車線Queue、Current Version Review、human-only Finding gateを実装済み | 実Targetでの再現実測 |
| Finding | Human Verification gateとknown-pluginでの成立を実測済み | Prospective Campaignでの成立実測 |

現在のproduction sliceは`Target Intake -> initial Semantic Wave -> Decision@3 / Approach Family -> conditional Depth / single source Validation -> Risk Assessment / Runtime Verification Packet -> AI Reproduction / Triage Reproduction Packet -> mandatory fresh Human reproduction -> Finding`である。Human OSのv1 Human Review Packet flowはread-only replay境界に残す。v6 Depthはtool-free Synthesis、Manifest-bound Critic、fresh Root EvaluationをCAS / Ledger境界で分離する。Packet delivery failureはPacketを保持したままResearch failureと分ける。Missing-link / Closureはlegacy v5に実装済みだがv6へ未接続。

採用済みtarget flowをversioned contractとpublic seamで接続済みである。次に実plugin一件を早期に完走し、その実測後にCoverage policy、Development Cohort、三件のProspectiveへ広げる。完成度をpercentでは表さない。

残作業の実行順と完了条件は[Issue #86](https://github.com/momoponwork1415-lgtm/wordpress-harness/issues/86)を正本とする。

| Order | Work |
| --- | --- |
| 1 | [#106 current write Interface](https://github.com/momoponwork1415-lgtm/wordpress-harness/issues/106)（完了） |
| 2 | [#107 single Source Validation / Runtime Packet](https://github.com/momoponwork1415-lgtm/wordpress-harness/issues/107) -> [#108 AI Reproduction / Triage Packet](https://github.com/momoponwork1415-lgtm/wordpress-harness/issues/108)（完了） |
| 3 | [#110 mandatory Human reproduction](https://github.com/momoponwork1415-lgtm/wordpress-harness/issues/110)（完了） -> [#109 実plugin一件のearly Prospective](https://github.com/momoponwork1415-lgtm/wordpress-harness/issues/109) |
| 4 | [#81 Validation Gap loop](https://github.com/momoponwork1415-lgtm/wordpress-harness/issues/81)、[#82 Coverage policy](https://github.com/momoponwork1415-lgtm/wordpress-harness/issues/82)、[#33 Development Cohort](https://github.com/momoponwork1415-lgtm/wordpress-harness/issues/33) |
| 5 | [#111 measured budget defaults](https://github.com/momoponwork1415-lgtm/wordpress-harness/issues/111)、[#32 三件のProspective Campaign](https://github.com/momoponwork1415-lgtm/wordpress-harness/issues/32) |

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

- **Purpose:** fixed Targetをfinite Wave、Validation、Runtime Verification Packet handoffまで進める。
- **Invariants:** PlanへTarget、Manifest、policy、profile、tool、budgetを固定する。artifactをCASへ置き、Ledger eventを記録してから次stageへ進む。
- **Failures:** integrity不正は起動前に拒否する。provider / policy / budget failureをnegativeやno-new-evidenceへ丸めない。
- **Status:** v6 initial Wave、single Validation、conditional Depth、Runtime Verification Packet v2 handoff、terminal replay、progressを実装。AI ReproductionとMissing-link / Closureは未接続。
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
- **Status:** v6 initial Wave / Decision@3 / conditional Depthを実装。Missing-link / Closureはlegacy pathのみ。
- **Code / Tests:** [exploration](../src/research/exploration) · [planning](../tests/research/semantic-root-planning.test.ts), [evaluation](../tests/research/semantic-root-evaluation.test.ts), [Depth](../tests/research/semantic-depth-work-queue.test.ts), [E2E](../tests/research/campaign-semantic-e2e.test.ts)

### Validation

**Interface:** `Validation.validate(plan) -> ValidationRecordRef`

- **Purpose:** Root-evaluated candidateをfreshなsource reviewで反証し、Humanへ渡す明らかなfalse positiveを抑える。
- **Current implementation:** exact identityはTarget、Manifest、premise、property、ordered route、anchorで作る。一つのfresh Validatorから`ready-for-runtime / needs-research / disproven / validation-pending`を決定的に投影し、二つ目・第三AttemptとValidation Synthesisを起動しない。
- **Runtime handoff:** `ready-for-runtime`からsingle Validation、bind済みCandidate、Risk、source route / control / counterevidence、runtime sketchを自己完結のRuntime Verification Packet v2へ投影する。明白なsource contradictionだけを止め、Researchは`rejected`を作らない。[#107](https://github.com/momoponwork1415-lgtm/wordpress-harness/issues/107)
- **Boundary:** Findingやruntime reproductionを所有しない。`needs-research`は具体的Gapとして同じFamilyへ戻す。
- **Risk / Packet:** Riskはsingle Validationとbind済みCandidateから追加model judgeなしで投影する。exact payloadとraw requestをResearchへ保存せず、delivery failureでもPacketを失わない。
- **Status:** single fresh Attempt、Disposition、Risk / Runtime Packetをv6へ接続。multi-Attempt / Synthesis / Human Review Packet v1は元の意味でlegacy replayする。
- **Code / Tests:** [validation](../src/research/validation), [candidate admission](../src/research/campaign-control/validation-candidate-admission.ts) · [Validation](../tests/research/validation.test.ts), [Runtime Packet](../tests/research/runtime-verification-packet.test.ts), [legacy Packet](../tests/research/human-review-packet.test.ts), [v6 handoff](../tests/research/campaign-validation-run.test.ts)

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

- **Interface:** current writeはprivate `CurrentCampaignStore`、全世代のread-only replayは`LegacyResearchReplay`。SQLiteとpublic `CampaignRunner / CampaignReader`は維持する。
- artifactを保存してから参照eventをappendする。
- cacheを削除しても同じLedgerから同じview digestを再構築できる。
- semantic identity、priority、Family groupingはowner Moduleが決める。
- **Status / Tests:** current v3 writeをlegacy `ResearchRecord`から分離し、v1 / v2は既存Ledgerのreplayだけをproductionで許可する。Decision@3、Family、single Validation、Frontier Gap、Depth Queue / Synthesis / Critique / Evaluation、Runtime Packet handoff、progress replayを実装 · [current store](../src/research/research-record/current-campaign-store.ts), [legacy replay](../src/research/research-record/legacy-research-replay.ts), [v3 behavior](../tests/research/campaign-validation-run.test.ts), [compatibility](../tests/research/ledger-compatibility.test.ts)

## Human OS

### AI Reproduction

**Interface:** `AIReproduction.deliver(RuntimeVerificationPacketDeliveryRequest)`、`AIReproduction.run(Packet + Target source + Runtime Profile + Setup Plan + Policy) -> runtime-confirmed | runtime-inconclusive | setup-blocked | execution-failed`

- **Purpose:** fresh environmentと実Target interfaceでsource routeを試し、人間が再実行できるRecipeとevidenceを作る。
- **Owned artifacts:** shareableなIntake、typed Attempt、sanitized Result、Triage Reproduction PacketはHuman OS RecordへCAS-firstで保存する。exact Reproduction RecipeとPrivate Evidence Bundleは専用private storeへ保存し、shareable artifactにはopaque refだけを残す。
- **Invariants:** AttemptへTarget/version、Manifest、attacker premise、Security Effect、source route、Runtime Profile、Setup Plan、no-ambient-tool policyをbindする。SQLi、XSS等のclassはRecipeのcriterionに使うが、固定Adapter対応をadmission条件にしない。exact payload、request、screenshot、runtime logはPrivate Evidence Bundleへ置く。AI outputはFinding、Human disposition、programme eligibilityを作らない。
- **Failures:** unsupported mechanism、setup、provider、budget failureをRejectedへ丸めない。runtime-confirmedだけがTriage Reproduction Packetを作る。
- **Status / Tests:** v2 contract、idempotent intake / execution record、class別・generic Recipe、private file store、Triage gateを実装。Harness seamはfresh gVisor identity、cleanup、harness-mediated browser / HTTP / runtime observation attestationを要求する · [code](../src/human-os/ai-reproduction.ts), [contracts](../src/human-os/ai-reproduction-contracts.ts), [behavior](../tests/human-os/ai-reproduction.test.ts) · [#108](https://github.com/momoponwork1415-lgtm/wordpress-harness/issues/108)

### Human Verification Environment

**Interface:** `HumanVerificationEnvironmentBuilder.establish -> ready | setup-blocked`

- **Purpose:** Packetと一致するTargetをfresh disposable environmentへ構築する。
- **Invariants:** requestへPacket、Target、Runtime Profile、declarative Setup Plan、Policy、grantをdigest固定する。target codeをhost上で実行せず、privileged container、host network、engine socket、ambient credential、許可外egressを使わない。Setup Receipt、gate observation、effective config、Target/runtime identityをCAS-firstで保存した後だけ`ready`を公開する。
- **Failure semantics:** isolation不足、setup、activation、health failureは`setup-blocked`として保持する。partial environmentはcleanupし、plain Dockerまたはhost executionへfallbackしない。同じrequest digestは保存済みDispositionをreplayする。
- **Status / Tests:** Builder、versioned contract、Human OS Record、Packet-bound sourceを実runsc WordPress sessionへ構築するgVisor provisionerを実装。Researchのlegacy Assistantとはsession lifecycleだけを共有する · [builder](../src/human-os/human-verification-environment.ts), [provisioner](../src/human-os/gvisor-wordpress-environment-provisioner.ts), [isolation infrastructure](../src/infrastructure/gvisor-wordpress-session.ts) · [contract tests](../tests/human-os/human-verification-environment.test.ts), [gVisor adapter](../tests/human-os/gvisor-wordpress-environment-provisioner.test.ts)

### Human Verification

**Interface:** `CurrentHumanReviewRunner.admit`、`prepare`、`record`、`readQueue`

- **Purpose:** Triage Reproduction Packetを人間がAIと別のfresh instanceで必ず再実行し、Findingまたは理由付きnegativeまで閉じる。
- **Queue:** runtime-confirmedを通常Queue、policy指定のhigh-impact runtime-inconclusiveを人間選択のEscalation Queueへ置く。総件数を制限せずactive concurrencyだけを設定し、完了後はimpact、attacker premise、Recipe cost、Case IDのstable priorityで繰り上げる。
- **Preparation:** 人間の直前にCurrent Version Reviewを実行する。新stableは同じCampaign、plugin、Causal Identity、Security Effect、attacker premiseにbindされた新しいruntime-confirmed Attemptだけを選べる。Human environmentは選択Target、Runtime Profile、Setup Planと一致し、AI environmentとは異なるfresh IDを要求する。
- **Failure semantics:** 前提一致かつRecipe完走後のeffect非観測だけを`rejected`にする。環境不一致は`blocked`、曖昧な観測は`runtime-inconclusive`、不足証拠は`more-evidence-required`。
- **Finding gate:** 全Recipe stepとexact payloadの人間によるfresh再実行を記録した`verified-finding`だけがFindingを生成する。Findingは元Campaign Target、検証Target、Triage Packet、Recipe / Private Evidence refs、人間のRecordへbindする。external actionは`not-authorized`であり、report、vendor contact、公開は別承認を必要とする。
- **Status / Tests:** v2 append-only Case stream、二車線Queue、promotion、version refresh、fresh environment gate、Disposition、Finding、reopen replayを実装 · [runner](../src/human-os/current-human-review.ts), [contracts](../src/human-os/current-human-review-contracts.ts), [behavior](../tests/human-os/current-human-review.test.ts) · [#110](https://github.com/momoponwork1415-lgtm/wordpress-harness/issues/110)

### Legacy Verification

ADR 0122以前のHuman Review Packet v1、Human Verification、Findingを元の意味でread/replayする互換境界。現行Human OS contextは`openLegacyHumanVerificationReplay`だけを公開し、v1 writerを公開しない。[replay](../src/human-os/legacy-human-verification-replay.ts)

- 旧Findingを`ready-for-runtime`や現行Findingへ自動変換しない。
- gVisor Lab、Witness、Causal Control、固定mechanism Adapterはlegacy replayと参考実装に限定する。
- **Status / Tests:** replay compatibility実装済み · [code](../src/research/verification), [tests](../tests/research/verification.test.ts), [gVisor](../tests/research/gvisor-account-takeover-lab.test.ts)

## Adapters and runtime policy

- CLIは`prepare / inspect`だけを持つthin adapter。[code](../src/cli.ts) · [tests](../tests/cli/campaign-cli.test.ts)
- current policyは`semantic-research-recall-baseline-v6`。
- current Campaign ceilingは12 Wave、USD 150、12 hours、Validation reserveはUSD 30。これらは[#111](https://github.com/momoponwork1415-lgtm/wordpress-harness/issues/111)でSchema literalからversioned baseline defaultへ移す。
- v1 Map-firstとv5 Verificationはread/replay互換として残す。
- ceiling到達はnegativeではなくtyped IncompleteまたはPending。

## Change path

1. この文書でowner、Interface、source、Behavior Testを特定する。
2. public behaviorをTestから観測する。
3. hard-to-reverseな理由が必要な時だけ`docs/adr/`を読む。
4. 次の有限workと受入条件はGitHub Issueで確認する。

Schema field、private helper、provider argv、内部call順はこのGuideへ複製しない。
