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
