# Campaign setup seam

Status: accepted, 2026-09-01

## Owner and purpose

ResearchのSource Understanding内部にあるLab Baseline Builderが所有する。受入済みTarget Snapshotをtarget code未実行の状態から、探索と独立Verificationが共通に参照できるsealed Lab Baselineへ変換する複雑性を一つのinterfaceの背後へ隠す。

## Interface

```ts
interface LabBaselineBuilder {
  establish(request: BaselineRequest): Promise<SetupDisposition>;
}

type SetupDisposition =
  | { status: "ready"; receipt: SetupReceiptRef; baseline: LabBaselineRef }
  | { status: "setup-blocked"; receipt: SetupReceiptRef; reasons: readonly SetupReason[] };
```

`BaselineRequest`はTarget Snapshot ref、環境依存スナップショットrefs、Runtime Profile ref、Canonical ConfigurationまたはConfiguration Variantを表すSetup Plan ref、Setup Policy ref、必要なExternal Dependency Grant refsを固定する。callerはcontainer、network、database、browser、host pathまたはstep orderingを渡さない。

## Interface invariants

- 同じrequest digestは同じSetup Dispositionへ収束し、成功済みbaselineを暗黙に再構築しない。
- `ready`を返す前にSetup Receipt、全gate observation、filesystem/database snapshot、effective configuration、Lab Baseline manifestをdurableにする。
- `setup-blocked`は最後に成功したstep、安定したreason code、runtime receipt、sanitized log refsを持ち、Lab Baselineを返さない。
- Intake Disposition、Target Snapshot、Runtime Profile、Setup Planを遡って変更しない。
- target-controlled codeはgVisor `runsc`内だけで実行し、hostまたはplain Dockerへfallbackしない。
- mutable image tag、wall clock、host path、random container nameをbaseline identityへ含めない。
- BuilderはHypothesisまたはFindingを知らず、setup failureを脆弱性または誤検出と判断しない。Setup Planのmodel proposalを受け取る場合も、untrusted inputとしてdecodeする。

## Runtime Profile

Runtime ProfileはWordPress core artifact digest、PHP・database・web server等のOCI image digest、gVisor `runsc` build identity、CPU architecture、必須runtime capabilityを持つ。tagやdisplay versionは診断metadataにできるが、digestに代えて実行対象を選ばない。Campaign preparation後に同じprofile idの内容を変えない。

## Setup Plan

Setup Planはschema version、content digest、configuration kind、固定locale・timezone、主対象と環境依存スナップショット、宣言順、Lab principals、typed setup actions、各actionの事前に定義したpostcondition、正常機能確認を持つ。Canonical Configurationの基準はUTCと`en_US`とし、locale、timezoneその他の条件を変える場合は根拠を持つConfiguration Variantの別Planにする。

Lab Baseline Builder内部のvalidatorはPlan全体を実行前にdecodeし、参照digest、操作種別、引数scope、順序制約、credential scope、network grantを検査する。LLMはSetup Plan Proposalを作れるが、その自由文または自己評価は権限にも成功証拠にもならない。schemaとpolicyを通過したPlanだけを実行し、不許可操作を削って続行せず`setup-blocked: invalid-or-unsafe-plan`にする。

Planが使用できるのは、harnessがversion固定したplugin配置・activation、WordPress option、Lab principal作成、trusted database seed、HTTP、browser、外部依存fixture、観測とsnapshot等のtyped actionだけとする。adapter内部でWP-CLI等を使えてもPlanから任意argvを渡さない。任意shell、任意PHPまたはeval、target Composer/npm script、未固定dependencyのdownload・install、汎用network requestを許可しない。

環境依存pluginはEnvironment Dependency Snapshotのidentityとdigestを指定し、宣言順にだけ配置する。activation中に新たな依存要求を検出しても自動取得せず、理由付き`setup-blocked`とする。

各Lab principalはpurposeとWordPress roleを持ち、認証情報をLabごとに生成してSecretRefで参照する。setup administratorをPermitted Attackerとして再利用しない。成立証拠にprivileged victimが必要な場合も、setup administratorとは別principalをExperiment Planで指定する。raw credentialをPlan、Ledger、prompt、CASへ保存しない。

## Establishment gates

Builderはfresh filesystemとdatabaseから次を決定順に実行する。

1. Runtime ProfileとgVisor capabilityを確認する。
2. 固定WordPress core、database、web serverを起動し、fresh installとmigrationを完了する。
3. 環境依存pluginを宣言順にcanonical locationへ配置・activateする。
4. 主対象をcanonical Plugin Basenameどおりに配置・activateする。
5. 検証済みSetup Planのtyped actionだけでCanonical Configurationを適用する。
6. fatal errorがないことと、frontend・admin・RESTの基本healthを確認する。
7. 対象pluginの正常機能確認を実行し、客観的postconditionを確認する。
8. filesystem、database、configuration、seed state、observationsをsealする。

各gateは開始前にtyped success criterionを持つ。post-hocなmodel judgementまたはHTTP 200一件だけでreadyにしない。通常機能がstateを変更する場合は通常利用者の操作後に別の観測でeffectを読み戻し、表示専用plugin等では決定的なread-only postconditionを使う。

外部serviceはsemanticに十分なlocal emulator、固定record/replay、live External Dependency Grantの順で選ぶ。live接続はCampaign専用・非production・使い捨て可能なresearch accountをSecretRefで参照し、grant scope外へ接続しない。live serviceが利用不能でもpluginの脆弱性を反証したことにはせず、dependency reason付き`setup-blocked`にする。

## Baseline use

VerificationはLab Baseline refからExperimentごとにfresh sibling Labを作り、setupを再実行またはbaselineを変更しない。Configuration Variantが必要なら、Target SnapshotとRuntime Profileを維持しつつ別Setup Planを使う別requestから別baselineを作る。Setup Plan、Runtime Profile、dependency digest、seedまたはpolicyを変える場合も新しいbaselineを作り、canonical baselineとvariant baselineは別digestで共存する。

## Test surface

behavior testは`establish(request)`のSetup Dispositionと、返されたreceiptまたはbaseline refから読めるimmutable viewだけを観測する。gVisor process、container count、step helper、database queryを直接assertしない。system seamにはproductionのgVisor adapterとcontrolled test adapterを置けるが、test adapterの結果をevidentiary baselineとしてCampaignへ昇格させない。gVisor integration suiteでproduction `ready` receiptのruntime identityとisolationを別途確認する。

## Acceptance scenarios

1. digest固定した完全なrequestは全gateを通過し、sealed Lab Baseline refを一つ返す。
2. mutable tagの参照先が変わっても、既存Runtime Profileの実行対象とbaseline identityは変わらない。
3. dependency activation failureはreason付きsetup-blockedになり、主対象をactivateしない。
4. 主対象がactiveでもfrontend、admin、RESTまたは正常機能確認が失敗すればreadyにしない。
5. gVisor unavailable時はhostまたはplain Dockerへfallbackせずsetup-blockedになる。
6. 同じrequestのcrash後retryはpartial baselineを公開せず、既存receiptから安全に収束する。
7. VerificationのWitnessとCausal Controlは同じsealed baselineから別々のfresh siblingを生成する。
8. 任意shell、任意PHP、未固定downloadを含むPlanは一部実行せず、invalid-or-unsafe-planとしてsetup-blockedになる。
9. modelがsetup成功と出力しても、typed postconditionが不成立ならreadyにならない。
10. 状態変更型pluginの正常機能確認は通常操作後のeffectを別観測で読み戻す。
11. setup administratorとPermitted Attackerは別principalとSecretRefを持ち、raw credentialはreceiptに残らない。
12. 基準PlanはUTC・en_USで成立し、別localeはcanonical baselineを変更せず別variant baselineになる。
13. 未固定dependencyをactivation中に要求しても自動取得せずsetup-blockedになる。
14. live serviceは有効なGrantと専用research accountがある場合だけ接続し、障害をpluginの反証にしない。
15. Setup PlanまたはRuntime Profileのdigestを変更した実行は既存baselineを変更せず、新しいbaseline refを返す。
