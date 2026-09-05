# Legacy Verification compatibility seam

Status: superseded for new Campaigns by [ADR 0122](../adr/0122-separate-source-validation-from-human-verification.md)

## Purpose

ADR 0122以前のResearch Ledgerに保存された`VerificationPlan`、`VerificationRecord`、`Finding`、`Disproved`、`Blocked`と、そこから投影する`Finding Mechanism Group`を元の意味のままread/replayする互換境界である。新しいCampaignのcandidate処遇、Finding gate、Human OS handoffの正本ではない。

新しいResearch behaviorは[Validation seam](validation-seam.md)、fresh runtime reproductionとFindingは[Human Verification seam](human-verification-seam.md)を正本とする。

## Legacy interface

```ts
interface LegacyVerificationReader {
  read(ref: VerificationRecordRef): Promise<LegacyVerificationRecordView>;
  group(runId: string): Promise<readonly LegacyFindingMechanismGroup[]>;
}
```

既存実装の`Verification.verify(plan)`は移行期間だけ旧policy Campaignのreplay/compatibilityに残す。新policyから新しいVerification intentを生成せず、新しいFindingを返すpublic pathとして公開しない。

## Compatibility rules

- 既存Ledger、CAS artifact、digest、stable ordering、outcomeを変更しない。
- 旧`finding`を`ready-for-human`、Human Verification済みFindingまたは新Review Packetへ自動変換しない。
- 旧Findingは`legacy automated finding`として表示し、新policy cohortまたはprospective metricへ混ぜない。
- node-route形式を含む旧schemaはdecode専用に残し、新規Planとして受理しない。
- artifact欠落、digest不一致、Target/Manifest binding不正を脆弱性不存在またはDisprovedへ丸めない。
- 旧Findingを現行Findingへ昇格させる場合は、新しいHuman Review PacketとHuman Verificationを必要とする。

## Human Verification Assistant reuse

旧VerificationのgVisor Lab、typed Experiment、Source Rederivation、Witness、Causal Control、normal-function observation、Security Effect AdapterはHuman OSの任意`Human Verification Assistant` Adapterとして再利用できる。

Assistant利用時は従来の安全・証拠条件を維持する。

1. TargetとManifestへsource routeをbindする。
2. 同じsealed baselineからfresh siblingを作る。
3. WitnessとCausal Controlで宣言したcausal factorだけを変える。
4. terminal Security Effectとnormal functionをsanitized observationから計算する。
5. gVisor unavailable時にhost、runcまたはplain Dockerへevidentiary fallbackしない。
6. credential、cookie、raw trace、sensitive readbackをdurable public viewへ保存しない。

これらはAssistant evidenceの品質条件であり、AssistantがFindingを自動生成する権限ではない。unsupported mechanismまたは`assistant-unavailable`はHuman Review CaseをRejectedにせず、人間が別の安全なproof methodを選べる。

## Durable replay

完了済みPlanの再実行はproviderまたはLabを起動せず既存refへ収束する。terminal recordがない旧runを再開する場合も、partial verifier outputまたはLab stateを証拠として再利用しない。legacy read modelは旧policy versionを明示し、current Validation/Human OS read modelとdiscriminated unionで分離する。

## Behavior test surface

旧VerificationのFinding/Disproved/Blocked、Manifest binding、Witness/Control、gVisor no-fallback、Finding Mechanism Group、artifact digest、close/reopen replay、unsupported schema rejectionを互換testとして維持する。新しいbehavior testはこのlegacy Interfaceへ追加せず、[Validation seam](validation-seam.md)または[Human Verification seam](human-verification-seam.md)へ追加する。
