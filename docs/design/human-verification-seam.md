# Human Verification seam

Status: accepted, 2026-09-05

## Owner and purpose

Human OSが所有する。Researchのversioned Human Review Packetを人間の有限queueへ取り込み、freshな隔離環境でのHuman Verification、理由付きReview Disposition、Finding、Evidence Requestをappend-onlyに記録する。Research Validationを再実行せず、Research Ledgerまたは内部CASを直接読まない。

## Interface

```ts
interface HumanVerification {
  admit(packet: HumanReviewPacket): Promise<HumanReviewCaseRef>;
  record(input: HumanVerificationInput): Promise<ReviewDispositionRef>;
}
```

`admit`はPacket schema、digest、Target/Manifest binding、Validation Dispositionが`ready-for-human`であることを検査する。同じPacket digestは同じCaseへ収束する。callerはHuman OS storage identity、queue row、Finding IDを指定しない。

`record`はCase ref、人間identity、開始・終了時刻、環境identity、attacker role、実Target interface上の手順、sanitized observation、Security Effect、proof method、reasonを固定する。credential、cookie、private target source、unsafe payload、raw browser traceをFindingまたはpublic viewへ保存しない。

## Queue and scheduling

Human Verification Queueは一Campaign最大三つのunique mechanismをactiveにする初期policyを持つ。順位はimpact、より弱いattacker premise、source closure、novelty、human reproduction costで決める。severity scoreだけで並べず、同一mechanismの複数discoveryをactive枠へ重複計上しない。

枠を超えたCaseは`Human Deferred`として保持する。DeferredはReview Dispositionではなく、Research terminal、false positive、Rejected、Disprovedを意味しない。active Caseがterminalになるか人間が明示的にreprioritizeした時だけqueueを更新する。

## Human Verification

Human Verificationは次を必要とする。

- Packetと一致するTarget/version/snapshot
- freshで使い捨て可能な隔離環境
- production dataまたはcredentialを使わないLab principal
- claimed attacker premiseと実Target interface
- 再現手順と観測したSecurity Effect
- 実施者identityと時刻
- 不成立または不明の場合の理由と不足条件

proof methodはcaseごとに人間が決める。Causal Control、比較対象、browser canary、database observation等を使えるが、全caseを同一のtyped Experimentまたはsibling Labへ拘束しない。target codeをhost上で実行せず、production site、許可外egress、reverse shell、persistence、実data取得を使わない。

## Optional Human Verification Assistant

既存のgVisor Lab、typed Experiment、effect Adapterは`Human Verification Assistant`として任意に利用する。AssistantはRequestからruntime、database、browser、cleanupを隠し、sanitized Witness、Causal Control、normal-function observationを返せるがReview DispositionまたはFindingを生成しない。

Assistant evidenceを使う場合は、同じsealed baseline、fresh sibling、宣言したcausal factor、observable terminal effect、normal function、gVisor no-fallbackを要求する。gVisorまたは対応Adapterが利用不能ならAssistant結果を`assistant-unavailable`として記録し、人間が別の安全なproof methodを選べる。plain Dockerへevidentiary Assistantとしてsilent fallbackしない。

Human Verification Environment自体はgVisorに限定せず、専用VMまたは安全に構成したcontainerを選べる。いずれもTarget/version、runtime、configuration、network policyを記録し、host executionを禁止する。

## Review dispositions

```text
verified-finding | rejected | more-evidence-required | blocked
```

- `verified-finding`: 人間がattacker premise、broken security property、観測effectを実Target interfaceで確認した。Human OSがFindingを生成する。
- `rejected`: compensating control、到達不能、premise不成立、非security behavior等を人間が確認した。理由と観測を残す。
- `more-evidence-required`: Research source gapまたは追加runtime条件が具体的に必要である。versioned Evidence Requestを作る。
- `blocked`: 環境、credential grant、外部dependency等により人間が成立も不成立も判断できない。

Human rejectionは進行中または過去CampaignのValidation policyを変更しない。一般化可能な理由はRule Proposalとし、人間review、versioned policy、Development Cohort regressionを通過した後、次Campaignへだけ適用する。単発の人間判断または曖昧な違和感を自動FP ruleにしない。

## Finding and external action

Findingは`verified-finding` Disposition、Packet digest、Human Verification record、Target/version、attacker premise、broken security property、sanitized reproduction evidenceへbindする。Researchのlegacy automated Findingとはschemaとmetricを分ける。

Programme Disposition、Known Duplicate Disposition、CVSS、submission priorityはFinding後に付加できるが技術的真偽を変更しない。FindingまたはHuman Verification成功はvendor communication、report submission、issue、PR、公開を許可しない。各外部行動には別のExternal Action Authorizationが必要である。

## Failure semantics

- Packet schema、digestまたはbinding不正はCaseを作らずhandoff rejectionにする。
- environment/assistant failureをRejectedへ丸めない。
- human identity、Target identity、手順またはobservation不足ではFindingを作らず`more-evidence-required`または`blocked`にする。
- storage failure時はDispositionまたはFindingを返さず、partial recordをpublicにしない。
- Research artifactが追加で必要でも内部storageを直接読まずEvidence Requestを作る。

## Durable ordering and replay

Packet admission、queue state、Human Verification intent、environment receipt、sanitized observation、Review Disposition、Findingの順でdurableにする。Finding refはDispositionと全必須artifactのwrite成功後だけ返す。同じPacketと同じcompleted inputの再記録は同じrefへ収束し、異なる判断で既存recordを上書きしない。

Human OSのrecordはResearch Ledgerとは別のownershipを持つ。物理的に同じSQLite/CAS implementationを再利用しても、Research event/tableを直接更新せず、ResearchもHuman OSのqueueをCampaign terminal判断へ使わない。

## Behavior test surface

Testは`admit(packet)`、`record(input)`とHuman OS read modelだけを観測する。内部queue row、container command、database query、UI stateを固定しない。

最低限、valid Packet admission、digest/binding rejection、same-Packet idempotency、最大三active mechanism、duplicate mechanismの単一枠、Human Deferred保持、fresh environment receipt、verified-findingだけのFinding生成、rejected/more-evidence/blocked、assistant-unavailable時のhandoff継続、gVisor Assistant no-fallback、secret/transcript除外、append-only conflict、close/reopen replay、External Action Authorization分離を保護する。

Research側の入力contractは[Validation seam](validation-seam.md)、判断理由は[ADR 0122](../adr/0122-separate-source-validation-from-human-verification.md)、現在の実装状態は[Codebase Guide](../CODEBASE-GUIDE.md)を正本とする。
