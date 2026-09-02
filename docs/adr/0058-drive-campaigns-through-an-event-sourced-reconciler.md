---
status: superseded by ADR-0110
---

# Drive Campaigns through an event-sourced reconciler

Campaign lifecycleは、Research Ledgerをreplayして現在stateを導出し、次の有限workだけを決めるevent-sourced reconcilerとして実装する。外部のcommand interfaceは`prepare`、`advance`、`requestStop`に限定し、queryはread-only `CampaignReader`へ分離する。

```ts
interface CampaignRunner {
  prepare(input: NewCampaignInput): Promise<PreparedCampaign>;
  advance(campaignId: CampaignId, until?: AdvanceUntil): Promise<CampaignView>;
  requestStop(campaignId: CampaignId, reason: string): Promise<StopReceipt>;
}

interface CampaignReader {
  read(campaignId: CampaignId, atLedgerHead?: number): Promise<CampaignView>;
  inspect(campaignId: CampaignId, subject: SubjectRef): Promise<SubjectView>;
}
```

`prepare`はSetupだけを行い、Target Snapshot、runtime、Prompt Set、Model Profile、Knowledge、Experiment registry、budgetをhash固定してからResearchを開始せず返す。`advance`は新規開始、通常反復、process crash後のresumeを区別せず、Ledger stateから次の行動を決める。CLIの`start`は`prepare`後に`advance`を呼び、`resume`は既存Campaignへ同じ`advance`を呼ぶ。

`requestStop`は停止要求eventを追記するだけであり、直接Campaign stateを書き換えない。schedulerが要求を観測して新規leaseを止め、実行中Attemptをsettleし、terminal eventを記録する。worker、CLI、readerはlifecycle transition、lease、budget、priorityを所有しない。
