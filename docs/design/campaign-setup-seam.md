# Human Verification setup seam

Status: accepted, 2026-09-05

## Owner and purpose

Human OSの`Human Verification Environment Builder`が所有する。Researchから受け取ったHuman Review Packetの固定Target/versionを、host上でtarget codeを実行せず、人間が実Target interfaceをfreshに再現できる使い捨て環境へ変換する複雑性を一つのInterfaceの背後へ隠す。

Research Campaignの開始条件ではなく、source-only Validationはこの環境を要求しない。setup failureをValidation negativeまたはfalse positiveへ逆流させない。

## Interface

```ts
interface HumanVerificationEnvironmentBuilder {
  establish(request: EnvironmentRequest): Promise<SetupDisposition>;
}

type SetupDisposition =
  | { status: "ready"; receipt: SetupReceiptRef; environment: EnvironmentRef }
  | { status: "setup-blocked"; receipt: SetupReceiptRef; reasons: readonly SetupReason[] };
```

`EnvironmentRequest`はHuman Review Packet ref、Target Snapshot、環境依存スナップショットrefs、Runtime Profile、Canonical ConfigurationまたはConfiguration Variantを表すSetup Plan、Setup Policy、必要なExternal Dependency Grant refsを固定する。backendはgVisor Assistant、専用VM、安全に構成したcontainerのversioned profileから選び、callerは任意container argv、network、database command、browser command、host pathまたはstep orderingを渡さない。

## Interface invariants

- 同じrequest digestは同じSetup Dispositionへ収束し、成功済みenvironmentを暗黙に再構築しない。
- `ready`前にSetup Receipt、全gate observation、effective configuration、Target/runtime identityをdurableにする。
- `setup-blocked`は最後に成功したstep、安定reason code、runtime receipt、sanitized log refsを持ち、ready environmentを返さない。
- Human Review Packet、Target Snapshot、Runtime Profile、Setup Planを遡って変更しない。
- target-controlled codeをhost上で実行せず、privileged container、host network、container engine socket、credential-bearing host path、許可外egressを使わない。
- mutable image tag、wall clock、host path、random instance nameをenvironment identityへ含めない。
- BuilderはFindingまたはReview Dispositionを決めず、setup failureを脆弱性または誤検出と判断しない。

## Runtime and isolation profiles

Runtime ProfileはWordPress core artifact digest、PHP・database・web server等のimage digest、CPU architecture、backend identity、必須runtime capabilityを持つ。tagやdisplay versionは診断metadataにできるが、digestに代えて実行対象を選ばない。

gVisor Human Verification Assistantを選ぶprofileは`runsc`を必須にし、利用不能時にrunc、plain Dockerまたはhostへevidentiary fallbackしない。専用VMまたはcontainerを人間の別proof methodとして選ぶ場合は、その選択をrequestに明示し、filesystem、network、credential、cleanupのisolation capabilityを事前検査する。Assistant失敗から別backendへsilentに切り替えない。

## Setup Plan

Setup Planはschema version、content digest、configuration kind、locale・timezone、主対象と環境依存スナップショット、宣言順、Lab principals、typed setup actions、各actionの事前success criterion、正常機能確認を持つ。Canonical Configurationの基準はUTCと`en_US`とし、異なる条件は根拠を持つConfiguration Variantの別Planにする。

Plan全体を実行前にdecodeし、参照digest、操作種別、引数scope、順序制約、credential scope、network grantを検査する。不許可操作を削って続行せず`setup-blocked: invalid-or-unsafe-plan`にする。

使用できるのはharnessがversion固定したplugin配置・activation、WordPress option、Lab principal作成、trusted database seed、HTTP、browser、外部依存fixture、観測、snapshot等のtyped actionだけとする。任意shell、任意PHP/eval、target Composer/npm script、未固定dependency download、汎用network requestを許可しない。

各principalはpurposeとWordPress roleを持ち、認証情報を環境ごとに生成してSecretRefで参照する。setup administratorをattackerとして再利用せず、raw credentialをPlan、record、prompt、CASへ保存しない。

## Establishment gates

Builderはfresh filesystemとdatabaseから次を決定順に実行する。

1. backend profileとisolation capabilityを確認する。
2. 固定WordPress core、database、web serverを起動する。
3. 環境依存pluginを宣言順に配置・activateする。
4. 主対象をcanonical Plugin Basenameどおりに配置・activateする。
5. 検証済みSetup Planのtyped actionだけでConfigurationを適用する。
6. frontend、admin、RESTの基本healthとfatal error不在を確認する。
7. 対象pluginのFunctional Smokeを客観的postconditionで確認する。
8. Target/runtime/configuration/seed/observationをreceiptへsealする。

HTTP 200一件またはmodel judgementだけでreadyにしない。状態変更型の正常機能確認は通常操作後のeffectを別観測で読み戻す。

外部serviceはlocal emulator、固定record/replay、live External Dependency Grantの順で選ぶ。live接続はCampaign専用・非production・使い捨てaccountをSecretRefで参照し、grant scope外へ接続しない。障害をcandidateの反証にせずdependency reason付き`setup-blocked`にする。

## Environment use

ready environmentは一つのHuman Review Caseだけに使い、Case後に破棄する。別Packetまたは別Configuration Variantへstateを引き継がない。Human Verification AssistantがWitness/Control pairを作る場合は同じsealed baselineからfresh siblingを作り、従来のgVisor no-fallbackとcausal evidence条件を適用する。

人間がVMまたはcontainerで別proof methodを使う場合も、Target/version、runtime、configuration、attacker role、手順、観測、cleanupをHuman Verification recordへ残す。BuilderまたはenvironmentはFindingを自動生成しない。

## Failure semantics

- invalid/unsafe Planは何も実行せず`setup-blocked`にする。
- activation、dependency、health、Functional Smoke failureをRejectedまたはDisprovedへ丸めない。
- isolation capability不足時はhost executionへfallbackしない。
- partial environmentはpublicにせずcleanupし、同じrequestのretryはreceiptから安全に収束する。
- Assistant unavailableは人間が別backendを明示選択することを妨げないが、既存requestをsilent変更しない。

## Behavior test surface

Testは`establish(request)`のSetup Dispositionとimmutable receipt/environment viewだけを観測する。process、instance count、step helper、database queryを固定しない。

最低限、valid requestのready、mutable tag非依存、dependency/activation/health/Functional Smokeのsetup-blocked、host execution拒否、gVisor Assistant no-fallback、VM/container profileのcapability検査、same-request idempotency、unsafe Plan拒否、principal分離、secret除外、Configuration Variant分離、external grant enforcement、partial cleanupを保護する。

Human Verificationの判断contractは[Human Verification seam](human-verification-seam.md)、Research側のhandoffは[Validation seam](validation-seam.md)を正本とする。
