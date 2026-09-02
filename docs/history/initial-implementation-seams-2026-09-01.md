# Initial implementation seams

Status: confirmed, 2026-09-01

最初のtest surfaceは、既に合意した`CampaignRunner` command interfaceと`CampaignReader` query interfaceである。testはreal temporary SQLite databaseを使い、このinterfaceから観測できるbehaviorだけを検証する。

```ts
interface CampaignRunner {
  prepare(input: NewCampaignInput): Promise<PreparedCampaign>;
}

interface CampaignReader {
  read(campaignId: CampaignId): Promise<CampaignView>;
  inspect(campaignId: CampaignId, subject: SubjectRef): Promise<SubjectView>;
}
```

## First behavior slices

1. validなNewCampaignInputをprepareすると、Researchを開始せず`prepared` Campaignとしてreadできる
2. process相当のclose/reopen後も、同じLedgerから同じCampaignViewをreplayできる
3. caller-supplied CampaignIdへ同一inputを再prepareすると、eventを重複させず同じ結果を返す
4. 同じCampaignIdへ異なるinputをprepareするとconflictとして拒否し、元のCampaignを変えない
5. unsupported event kindまたはschema versionを含むLedgerは推測せず、安全側にreadを拒否する
6. inspectは指定したsubjectだけをread-onlyに返し、Campaign stateを変えない

## Interface invariants

- CampaignIdはcallerが生成してprepare前に保持する。commit後・response前のcrashでも同じrequestを安全に再試行できる。
- accepted inputはruntime schemaで検証し、canonical encodingのdigestをCampaign identityへ固定する。
- successful prepareは一つのSQLite transactionで一つのversioned eventだけをappendする。
- viewはResearch Ledgerのreplayから導出し、別のmutable正本を持たない。
- SQL schema、transaction、event encoding、canonical hashing、upcasterはimplementation detailである。
- testはdatabase row、private method、internal call countを直接観測しない。

`advance`と`requestStop`はこの増分のtest surfaceに含めない。`inspect`はprepare/read/replayがgreenになった後の別sliceで追加する。

## Thin CLI adapter

最初のadapter surfaceは次の二commandだけとする。

```text
wordpress-harness campaign prepare --database <path> --input <json-path>
wordpress-harness campaign inspect --database <path> --campaign <id>
```

CLIはargvとJSON fileをdecodeしてCampaign interfaceを呼び、resultをJSONとしてstdoutへ出す。validation、idempotency、replay、SQL、Campaign lifecycleを再実装しない。testは`runCli(argv, io)`のexit code、stdout、stderrだけを観測する。

## Known boundary gap before prospective Campaigns

現在の`NewCampaignInput`は、callerが既に作成した`TargetSnapshotRef`を直接受け取る最初のResearch Ledger sliceである。source、version、provenance、archive integrity、oracle-free inputを検査してTarget Intake Packetを作る受入境界はまだ実装していないため、このinterfaceだけでMilestone 2の実戦Campaignを開始してはならない。

Milestone 2へ進む前に、手動対象投入が`ready | deferred | rejected`を返してreadyな`TargetIntakePacket@v1`だけを生成し、Researchの`prepare`がそこから固定Target Snapshotを作るseamへversioned migrationする。既存のprepare/replay behaviorは移行時も互換fixtureで保護し、caller提供のdigestを検証なしに信頼する経路を残さない。Target Intakeは取得原本と正規化ファイル一覧を別々に固定し、hostでtarget codeを実行しない。acceptedなinterfaceは[Target intake seam](../design/target-intake-seam.md)に固定する。詳細な判断は[ADR 0096](../adr/0096-bootstrap-prospective-research-with-manual-intake.md)、[ADR 0097](../adr/0097-separate-source-admission-from-runtime-setup.md)、[ADR 0098](../adr/0098-identify-target-source-by-canonical-file-manifest.md)に記録する。

現行`TargetSnapshotRef`の`pluginSlug`はWordPress.org slug、premium identity、main plugin file、canonical install directoryを分離できない。Milestone 2のcontract migrationでは、名前空間付きplugin identity、main plugin file relative path、canonical Plugin Basename、照合済みversion、source tree digest、Target Intake Packet refを持つ次versionへ置き換える。既存eventはupcasterで読み、過去の`pluginSlug`を新しいpremium identityまたはmain fileへ推測変換しない。詳細は[ADR 0099](../adr/0099-bind-plugin-identity-main-file-and-version.md)と[ADR 0100](../adr/0100-fix-the-canonical-plugin-basename.md)に記録する。

現行実装はCampaignを`prepared`までしか進めず、Lab Baseline Builderを持たない。次のsetup behaviorを実装する前に、[Campaign setup seam](../design/campaign-setup-seam.md)の`establish`を唯一のtest surfaceとし、Runtime Profile、Setup Receipt、Lab Baselineのversioned schemaとResearch Ledger eventをred-greenで追加する。詳細は[ADR 0101](../adr/0101-build-a-sealed-lab-baseline-before-research.md)に記録する。

現行Source Mappingは`build`だけをtest surfaceとし、PHP Program Indexと固定manifestから静的なinitial mapとsource-only revisionを生成する。observed fact、未解決callback relation、非PHP asset、parse diagnosticを根拠状態またはcoverage gapとして保持し、stable identityをCASへ固定する。Context Responseの解釈、Mapper model、非PHP relation、`runtime-revision`とRuntime Observationはまだ実装しない。既存PHP Program Index testは抽出behavior、Source Mapping testはmapへの取込と根拠状態をそれぞれ保護する。

現行Model Executionは[Model execution seam](../design/model-execution-seam.md)の`run(AttemptPlan)`だけをtest surfaceとし、Finder schema output、typed termination、version/auth probe、wall/output budget、process-tree cleanup、crash、secret redactionを実装した。公式Claude process/Opus候補はbuilt-in tool、Web、subagentを無効化したprivate development benchmarkで、実Targetの一Work LeaseからExplorationの`verify` decisionまで到達した。resume、orchestrator crash recovery、完全なusage/transcript receipt、gVisorとharness-owned toolは未実装であり、Campaign Profileとして完成したとは扱わない。Remote ControlはCampaignRunner/Readerのadapterとして別sliceにし、Model Executionへ直接接続しない。

現行Explorationは移行元のMap-first pathとして、`bootstrap`に加えて最初の`wave-completed`を実装した。固定Surface Mapから非重複ownerを持つFocus Area、有限Work Lease、LaneとStrategyの別軸割当、model-family constraint、Wildcard枠をpureかつ決定的に計画し、完了Finder ResultからMap上にsource-boundなHypothesisだけを少数意見と相反routeを失わず`verify`へ渡す。provider process、Research Ledger、Labは直接呼ばない。次のsliceではraw-source Context Profile、Route Fragment取込、Approach Family Registry、Root Synthesis、Adversarial Criticを追加し、Surface Mapを探索開始条件から外す。UIや運用自動化は先行させない。
