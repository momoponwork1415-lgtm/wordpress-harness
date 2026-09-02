# Verification seam

Status: accepted, 2026-09-02

Implementation status: partial. Stored XSSとSQL injectionについて、同じ公開`verify` Interface、Finding gate、同じCausal Identityに限定したDisproved、typed Blocked、artifact digest検査、private CAS、Verification event、close/reopen replayまで実装済みである。production Claude Independent Verifierは、固定Target、Surface Map、Hypothesis routeに加え、Hypothesisの`requiredEvidence`が明示したinventory内PHP pathだけをbounded Context Responseとして追加できる。path tokenの両端とinventory identityを完全一致させ、分類、size、SHA-256も再検査し、Finderの主張自体は証拠にしない。Stored XSSとSQLiのLab adapterは、共通のWordPress/gVisor lifecycle Moduleを利用し、`runsc` preflight、content-addressed image、internal network、fresh volume、digest検査済みreviewed fixture pluginのactivation、private worker/input、sanitized Observation、cleanupを行う。自由なsetup argvまたは`eval-file`は受け取らない。private Brizy 2.8.11/2.8.12とAppointment Booking Calendar 1.6.9.29/1.6.10.0では、実Opus再導出とfresh gVisor Witness/Controlにより各Causal IdentityのFinding/Disproved境界を確認した。`runsc` unavailable時はplain Dockerへfallbackしない。未実装なのはaccount takeover、file、code/process execution等のproduction Experiment mechanismである。

## Design target

VerificationはResearch contextが所有するload-bearing deep Moduleである。Source-bound Hypothesisを固定Target Snapshotに対して独立に再導出し、必要なExperimentを隔離実行し、成立証拠と因果対照実験を一つの型付きoutcomeへ閉じる。

Campaign ControlとBehavior Testが使う公開Interfaceは一つにする。

```ts
interface Verification {
  verify(plan: VerificationPlanV1): Promise<VerificationRecordRef>;
}
```

Campaign Controlへ`preflight`、`planExperiment`、`runWitness`、`runControl`、`askSkeptic`、`promoteFinding`を個別公開しない。これらを呼ぶ順序、freshness、budget reservation、evidence gate、記録順はVerification implementationへ隠す。

## Design it twice

三つのInterface案を比較した。

| 案 | Interface | 判断 |
| --- | --- | --- |
| lifecycle公開 | `preflight`、`runWitness`、`runControl`、`decide` | callerが安全な順序と全invariantを知るshallow Moduleになるため却下 |
| outcome直接返却 | `verify(plan) -> VerificationOutcome` | 呼びやすいが、evidence durable writeとLedger commit前にoutcomeが外へ出るため却下 |
| record ref返却 | `verify(plan) -> VerificationRecordRef` | 小さいInterfaceの背後にlifecycle、artifact durability、promotion gateを隠せるため採用 |

採用案では、返却されたrefはResearch Recordへdurableに記録済みのrecordだけを指す。callerはrefから型付きread modelを取得し、private artifact storageを直接読まない。

## Owner and dependencies

Owner contextは`Research`、owner Moduleは`Verification`である。

許可する依存:

- Target Snapshotとsource artifactのread-only resolver
- Model Executionの`run(AttemptPlan)`
- Verification専用のLab Control `execute(ExperimentPlan)`
- private CASのtyped artifact read/write
- Research Recordのappend/read
- harness-owned clockとID source

禁止する依存:

- Finder session、transcript、scratch、provider object、worker identity
- Exploration priority、model confidence、known advisory、Wordfence duplicate data
- Human OS storageまたはprogramme eligibility
- container socket、host target process、plain Docker fallback
- VerificationからSource Map、Hypothesis、Campaign policyを書き換える逆向き依存

Model Execution、Lab Control、artifact store、clock、ID sourceはconstructorで受け取るinternal system seamとする。二つ目のproduction adapterを想定した汎用repository層は作らない。

## Verification Plan

`VerificationPlanV1`はversioned runtime schemaでdecodeし、canonical digestを持つ不変入力とする。callerが渡す情報は次に限定する。

- verification ID、Campaign ID、Target Snapshot ref
- Campaignの技術的scopeとPermitted Attacker
- 正規化したSource-bound Hypothesisとそのdigest
- sealed Lab Baseline refとRuntime Profile ref
-固定Verifier Model Profile、Prompt Set、Verification Policy、Experiment Registryのrefs
- Verification用に予約済みのAttempt、wall time、Experiment回数の予算

Hypothesisはattacker premise、破壊されるsecurity property、source-bound Evidence Route、unknown、falsifier、Causal Identityを含む。Case role、expected result、advisory、CVE、patch、Discovery conversation、known payload、confidence、priorityを含めない。

VerificationはPlan digest、Target Snapshot digest、Hypothesis digest、Lab Baseline digestが一致しない場合、Labやmodelを起動する前にintegrity errorとして拒否する。

## Owned lifecycle

一回の`verify`は次を順に所有する。

1. Planと参照artifactをruntime decodeし、digestとbudget reservationを検査する。
2. 固定sourceでsymbol、source range、entry registration、attacker reachability、capability、nonce、sink relationを事前検査する。
3. fresh Verifier Attemptを起動し、提示routeを権威とせずsourceから到達性、原因、反証可能なExperimentを再導出する。
4. registryに存在するmechanism固有のtyped Experiment Planだけを受理する。adapterは実Targetのvertical sliceごとに`stored-xss-browser@v1`、`sql-injection-database@v1`、`account-takeover-password-reset@v1`の順で追加する。
5. sealed Lab Baselineからfresh siblingを二つ作り、一方でWitness、他方でCausal Controlを実行する。
6. baseline、runtime、setup、configuration、adapter versionが一致し、宣言したcausal factorだけが異なることを検査する。
7. attacker premise、security property、Witness、Causal Control、normal-function observationを反証側から検査する。
8. evidence artifactをprivate CASへdurable writeし、そのdigest refsとtyped outcomeをResearch Ledgerへ一つのterminal recordとしてappendする。
9. append済み`VerificationRecordRef`だけを返す。

FinderとVerifierが同じmodel familyを使う最初のsliceでも、Attempt ID、provider session、conversation、scratch、writable Lab、payloadを共有しない。model familyの同一性を独立性の証拠へ読み替えず、recordへ明示する。

## Lab Control internal seam

Verification implementationだけが次のdriven Interfaceを使う。

```ts
interface LabControl {
  execute(plan: ExperimentPlanV1): Promise<ExperimentObservationRef>;
}
```

Lab ControlはgVisor、WordPress、database、browser、lab cleanupを隠すが、Hypothesisの真偽またはFinding promotionを判断しない。Observationはmechanism固有のversioned discriminated unionを持つ。全Experimentが共通して次を記録する。

- Target Snapshot、Lab Baseline、Runtime Profile、Setup Plan、Configuration Variant、adapter versionのdigests
- fresh sibling identityとno-fallback gVisor runtime identity
- normal-function observation
- causal factor identityと、WitnessまたはControlのrole
- sanitized artifact refsとterminal execution status

さらにmechanism固有に次を記録する。

- `stored-xss-browser@v1`: attacker request、persistent-state、victim-browser execution canary
- `sql-injection-database@v1`: attacker request、Lab生成のdatabase-only readback canary、database observation
- `account-takeover-password-reset@v1`: attacker-obtainable reset capability、専用Lab principalのcredential transition、authentication observation

SQL injectionのWitnessはLab生成の固定canaryだけを読み出し、WordPress accountや実dataを証拠へ含めない。account takeoverのWitnessは使い捨てLab principal以外を操作しない。

payload、cookie、credential、raw browser trace、target sourceをLedgerへ保存しない。gVisor unavailable、baseline clone不能、browser failure、non-hermetic external stateではevidentiary observationを返さない。

## Typed outcome

`VerificationRecordV1`はPlan digest、provenance、terminal time、evidence refsと次のdiscriminated unionを持つ。

```ts
type VerificationOutcomeV1 =
  | FindingOutcomeV1
  | DisprovedOutcomeV1
  | BlockedOutcomeV1;
```

### Finding

次をすべて満たした場合だけ`finding`にする。

- source re-derivationがattacker premiseからsecurity-relevant sinkまでを支持する
- fresh Labでmechanism固有のsecurity-property破壊を客観的に観測する
- fresh sibling Causal Controlで宣言した原因要素を除くと破壊が消える
- normal-function observationが成立する
- Target、baseline、configuration、adapter、canary、artifactのintegrityが成立する

### Disproved

`disproved`はこのHypothesisとCausal Identityに限定したtyped negative outcomeである。sourceが必要条件の不成立を決定的に示すか、validなWitness/Control pairがsecurity-property破壊または因果関係の不成立を示す場合だけ返す。plugin全体に脆弱性がないという意味ではない。

### Blocked

支持も反証もできる証拠が揃わない場合は`blocked`にする。少なくとも次をtyped reasonとして区別する。

- `unsupported-experiment`
- `verifier-unavailable`
- `budget-exhausted`
- `gvisor-unavailable`
- `baseline-unavailable`
- `sibling-isolation-failed`
- `experiment-failed`
- `non-hermetic`
- `evidence-incomplete`

schema不一致、参照digest不一致、unknown record version、Ledger corruptionは研究上のBlockedへ丸めず、Interface errorまたはread rejectionとして安全側に停止する。

## Durability and replay

Verification開始前にlaunch intentをResearch Recordへappendし、terminal recordは同じverification IDへ一度だけappendする。同じPlanの再実行は既存terminal refを返し、異なるPlan digestによる同一ID再利用はconflictにする。

crash後にterminal recordがなければ、古いLabまたはprovider sessionを証拠として再利用しない。予算とPlanを再検査し、fresh Attemptとfresh sibling Labsで再開するか、再開不能理由をBlockedとして閉じる。Research viewはLedger eventとcontent-addressed artifactだけから再構成し、running processを正本にしない。

## Test surface

Behavior Testはaccepted後、`Verification.verify(plan)`と返却refから得るResearch read modelだけを観測する。内部phase、helper call count、SQL row、process argv、Lab command順をassertしない。

system seamだけにdeterministic adapterを使う。owned internal Moduleはmockしない。

最初のred-green順序:

1. 合成stored-XSS observation pairが全gateを満たすとFindingをdurableに返す。
2. 同じCausal Identityでsecurity-property破壊が消えるとDisprovedを返し、Findingにしない。
3. gVisor unavailableではBlockedになり、Lab Controlはplain Dockerへfallbackしない。
4. sibling baselineまたはeffective configuration不一致ではBlockedになる。
5. close/reopen後に同じVerification outcomeをreplayする。
6. unsupported record versionまたはartifact digest不一致を推測せず拒否する。
7. private Boundary Pairで2.8.11 Finding、2.8.12 Disproved、benign functional controlを同じInterfaceから確認する。
8. 同じInterfaceでSQL injectionのpositive、mechanism修正済みnegative、benign functional controlを確認する。
9. account takeoverのtyped observationを追加し、同じ三条件を確認する。
10. daroo holdoutのStored XSSとSQL injectionをCase固有分岐なしで確認する。

## Acceptance scenarios

1. callerは一つのPlanを`verify`へ渡すだけで、durableなFinding、Disproved、Blockedのrefを得る。
2. Finder transcriptまたはknown payloadを渡そうとするとPlan schemaが拒否する。
3. modelがFindingと主張しても、WitnessまたはCausal Controlが欠ければFindingにならない。
4. WitnessとControlを同じmutable Labで実行したrecordは受理しない。
5. gVisorが使えない時はBlockedとなり、hostまたはplain Dockerでtargetを実行しない。
6. patched negativeは同一Hypothesisに限定したDisprovedとなり、「脆弱性なし」へ拡張されない。
7. event append後・response前のcrashでも、同じPlanを安全に再試行して同じterminal refを得る。
8. private artifactまたはcredential値なしに、Research Readerからdecision provenanceとoutcomeをreplayできる。

## First-slice limits

- production Experiment adapterは現在`stored-xss-browser@v1`と`sql-injection-database@v1`。次は`account-takeover-password-reset@v1`
- production provider transportはeligible Claude process一つだけ
- 一つのcanonical Runtime Profileと、根拠があるConfiguration Variantだけ
- Case固有情報はprivate setup/graderへ限定し、production branchingへ入れない
- UI、Remote Control、Target Intelligence、multiple provider、RCE/file/deserialization adapterは含めない
