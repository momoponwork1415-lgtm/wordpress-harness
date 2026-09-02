# Campaign execution seam

Status: accepted on 2026-09-02; one-Wave closed-loop behavior, production Finder materialization, crash recovery, and Calibration Review seam implemented

## Design target

Researchの`Campaign Control`が、一つの固定Target Snapshotについて、現行Map-first実装の有限Work Wave、Finder、独立Verification、Research Ledger、次のIteration Decisionまでを自律的に前進させる。callerへphase別command、provider session、Lab handle、Finder output、未記録の中間stateを公開しない。到達形のDepth Campaignではraw sourceから開始し、Surface Mapを開始条件または探索範囲の上限にしない。

既存の`Campaign`は一つの主対象Target Snapshotを所有するという不変条件を維持する。Brizyのvulnerable positiveとpatched negativeは別Campaignとして同じoracle-free production経路を通し、private Calibration Reviewだけが複数のterminal run refを比較する。二つのTarget Snapshotを一Campaignへ混ぜない。

patched negativeのFinderへ既知Hypothesisを渡して再発見を要求しない。oracle-free negative Campaignはfalse Findingがないことを示す。別にprivate graderがpositiveで確定したCausal Identityを、Finderを経由せず同じVerification seamからpatched Target Snapshotへ拘束してDisprovedとbenign functional controlを得る。Calibration Reviewはpositive Finding、patched Disproved、oracle-free negative Campaignの三つのterminal証拠を照合する。Case role、既知route、payloadはworker-visible inputへ戻さない。理由は[ADR 0109](../adr/0109-test-patched-snapshots-through-two-oracle-separated-paths.md)に固定する。

## Context-public Interface

既存`CampaignRunner`を次の二methodへ深くする。

```ts
interface CampaignRunner {
  prepare(input: NewCampaignInputV1): Promise<PreparedCampaign>;
  run(plan: CampaignRunPlanV1): Promise<CampaignRunRecordRef>;
}
```

`prepare`は既存のidempotentな受入・記録を維持する。`run`は準備済みCampaignをterminalなIteration Decisionまでreconcileする唯一の実行入口である。`advanceWave`、`runFinder`、`verifyHypothesis`、`recordOutcome`、`decideNext`を公開しない。

`run`はterminal recordをResearch Ledgerへappendした後、その不変refだけを返す。同じPlanを再実行した場合はLedgerから再構成し、完了済みなら同じrefを返す。途中で停止していた場合は古いprovider sessionまたはLabを再利用せず、記録済みintentとbudgetから安全なfresh workだけを再開する。

## Campaign Run Plan

`CampaignRunPlanV1`はversioned runtime schemaでdecodeし、canonical digestへ固定する。callerが渡すのは次の不変refと上限だけである。

- Campaign IDと既存Preparation digest
- 固定Target Snapshotに結び付いたSurface Map ref
- Exploration Policy ref
- FinderとVerifierのModel Profile、Transport Eligibility Receipt、Prompt Set refs
- FinderへSource Evidenceを許可する場合のSource Tool Policy refとAttempt query ceiling
- Lab Baseline、Verification Policy、Experiment Registry refs
- Campaign全体とVerification予約分を分けたBudget Envelope
- 最大3回以内の独立Finder Attempt上限
- Iteration Policy ref
- Development Boundary Pairでだけ使うopaqueなprivate Calibration Context ref

Planへtarget source、advisory、CVE、Case role、patch narrative、既知symbol、parameter、payload、provider credential、render済みtranscriptを入れない。Calibration Context refの内容はAttempt Plan、Verification Plan、prompt、worker toolへ渡さない。

PlanのTarget Snapshot、Surface Map、Lab Baseline、Preparationが同じTarget digestへ結び付かない場合、外部processまたはLabを起動する前に拒否する。

## Owned lifecycle

`Campaign Control.run`は次の順序を内部に隠す。

1. Planを検査し、`campaign.run-started` intentをResearch Ledgerへappendする。
2. CASからSurface Map、Policy、Profileを読み、各refとcontent digestを照合する。
3. Explorationの`bootstrap` decisionから一つの有限Work Waveを得る。
4. 全Work LeaseのAttempt intentと予算を開始前に固定する。
5. eligible Claude Opus Finderをbounded parallelismで実行し、terminal resultを到着順ではなくWork Lease ID順へ正規化する。
6. Work Wave barrier後にExplorationへterminal result refsを渡し、Source-bound Hypothesis refsだけを受け取る。
7. Hypothesis refのstable orderで、Finder sessionやpayloadを渡さずVerification Planを作り、`Verification.verify`を実行する。
8. Verification records、未解決work、残budget、Calibration Context refをIteration Reviewへ渡す。
9. Iteration Decisionとrun recordを同じCampaign streamへappendし、terminal refを返す。

Campaign ControlはFocus Area分割、Finder出力の真偽、provider retry分類、Finding promotion、browser操作を所有しない。各判断はExploration、Model Execution、Verificationへ委譲し、Research Recordだけがevent sequenceを確定する。

## Internal dependencies

許可する依存は次だけである。

- Research Record: intent、result、Iteration Decisionのappendとreplay
- private content-addressed artifact store: versioned Plan、Map、Attempt result、Verification recordのread/write
- Exploration: pureな次work decision
- Model Execution: 一つのAttempt Planの実行
- Verification: 一つのVerification Planの独立検証
- Iteration Review: terminal evidenceのpure fold
- clockとconcurrency executor: system seamとして注入する

禁止する依存は次である。

- Target IntelligenceまたはHuman OSのstorage
- provider-specific object、session、OAuth token、CLI stdout
- Docker socket、Lab handle、browser handle
- private graderのCase roleまたは期待Findingをworker inputへ展開する経路
- WordPress plugin slug、version、既知routeによるproduction分岐
- arrival order、model confidence、多数決によるHypothesis採否

## Attempt Plan materialization

Work LeaseからAttempt Planを作る処理はCampaign Control implementation内部へ置く。Target Snapshot、Surface Map、PHP Program Indexから、Leaseが所有するFocus Areaに必要なsource range、observed relation、unknown、Strategy、budgetを`Analysis Unit@v1`として決定的にrenderする。`sink-backward`は同じsink familyのsourceをbounded比較し、directed Strategyが二次sourceを読めた場合は、そこで参照されたclass-like symbol、低頻度literal、共有hook登録元を各最大1件、一段だけ同じfile/byte上限内へ昇格する。昇格sourceから再帰展開せず、`wildcard`には適用しない。Unitは実際に渡すpath、file digest、range、byte量、選択理由を持つが、選択理由をreachability evidenceとして扱わない。

Finderへprovider組込みweb、shell、filesystem、subagent、ambient MCPを渡さない。固定Analysis Unitを初期seedとして残し、`Campaign Run Plan`でSource Tool Policyとquery ceilingを固定したAttemptだけへharness-owned `read/search`を公開する。MaterializerはPlanのrefに対応するPolicy本文、digest、Target bindingを検査し、Campaign Controlは個別tool protocolを知らず同じ`Attempt Plan`へ写す。Policyがない明示的ablationは引き続きtool-freeである。

render済みAttempt Planはprivate CASへ保存し、policy auditでCase role、advisory、patch、既知payloadが含まれないことを確認する。Attempt Plan materializerへもCampaign Run Plan全体を渡さず、Finder ref、対象、有限Work Lease、Finder予算だけを渡す。これによりopaque Calibration Contextへ到達する経路自体を作らない。raw promptはResearch public viewまたはGitへ出さない。

## Iteration Review

Iteration ReviewはResearch内部のpure Moduleとし、clock、provider、Lab、filesystemへ依存しない。入力はstable orderへ正規化したVerification Record refs、terminal Attempt receipts、残budget、未解決work、opaque Calibration Review receiptである。

最初のversionは少なくとも次を返す。

```ts
type IterationDecisionV1 =
  | { kind: "await-calibration"; terminalVerifications: VerificationRecordRef[] }
  | { kind: "stop-boundary-pair-complete"; evidence: BoundaryPairEvidenceRef }
  | { kind: "continue-unresolved-work"; next: FiniteWorkRef }
  | { kind: "blocked-capability"; reasons: readonly BlockReason[] };
```

- `await-calibration`: 一つのTarget Snapshotのconclusive FindingまたはDisprovedを記録済みだが、private Boundary Pairの比較はまだ完了していない。単一Campaignをpair全体の成功として扱わないためのterminal decisionである。
- `stop-boundary-pair-complete`: private Calibration Reviewが固定positive Finding、同じCausal Identityのpatched Disproved、benign functional control、no false promotion、およびactive oracle-free FindingのCalibration Fingerprint一致をすべてdigest固定している。
- `continue-unresolved-work`: budget内に、情報利得と停止条件を持つ次の有限workが残る。
- `blocked-capability`: gVisor、baseline、provider、browser、evidence等の不足により、固定Plan内で支持も反証も安全に進められない。

`stop-boundary-pair-complete`は単一CampaignのFindingだけでは返さない。Calibration Reviewはproduction Campaignのterminal run ref、固定positive、private graderが同じVerification seamで作ったpatched terminal ref、oracle-free negative Campaignを比較し、advisoryや期待payloadをResearch判断へ持ち込まない。異なるAttemptのmodel生成文言はidentityにせず、active FindingはTarget Snapshot、重なるsource anchor、Experiment protocol、Witness/Control観測から成るprivate Calibration Fingerprintで固定positiveへ照合する。

## Durability and crash recovery

外部副作用より先にintentをappendする。少なくともCampaign run、Work Wave、Attempt、Verification、Iteration Decisionにversioned eventを持つ。大きなartifactは先にprivate CASへ置き、digestだけをeventへ記録する。

replay時はcampaign sequence、event version、Plan digest、artifact digest、phase orderingを検査する。unknown version、欠落artifact、digest mismatch、同じIDへの異なるPlanは推測せずread rejectionにする。

Attempt intent後・terminal receipt前のprocessは`orphaned`としてfresh Attemptへ置き換える。Verification start後・terminal record前はfresh verifierとfresh sibling Labsでだけ再開する。古いstdout、session、writable Labを正本にしない。

## Failure semantics

- schema、digest、event order、Target binding不一致: Interface errorまたはread rejection
- provider auth、policy denial、budget exhaustion: typed Attempt resultとしてWave barrierまで保持
- 全Finderのprovider failure: `provider-unavailable`として停止し、`no-source-bound-hypothesis`へ丸めない
- Hypothesisなし: Findingゼロではなく、未解決surfaceと残budgetに応じて`continue-unresolved-work`または`blocked-capability`
- gVisor、baseline、browser、sibling不成立: Verificationのtyped Blockedを保持し、plain Dockerへfallbackしない
- 一つのAttempt失敗: 他のterminal resultと少数Hypothesisを破棄しない
- run record append後・response前のcrash: 同じPlanの再実行で同じterminal refを返す

## Test surface

Behavior Testは`CampaignRunner.run(plan)`と`CampaignReader.read/inspect`から得るdurable viewだけを観測する。内部Moduleのcall順、helper call count、SQL row、process argv、concurrency timingをassertしない。SQLiteとfile CASはreal local substituteを使い、provider、Lab、clockだけをsystem-seam adapterで置き換える。

最初のred-green順序は次とする。

1. 合成Mapから一つの有限Wave、Finder Hypothesis、Verification Finding、Iteration Decisionまでを一回の`run`で記録し、close/reopen後に同じviewを返す。
2. Attempt resultの到着順を変えてもWork Lease、Hypothesis、Verification、Iteration Decisionの順序とdigestが同じになる。
3. gVisor Blockedを`blocked-capability`へfoldし、Modelまたはplain Dockerへfallbackしない。
4. 未解決workと残budgetがある場合だけ`continue-unresolved-work`を返し、次workは有限Planを持つ。
5. positive、patched negative、benign controlのterminal refsとprivate Calibration Review receiptが揃った時だけ`stop-boundary-pair-complete`を返す。
6. crash境界ごとに同じPlanを再実行し、完了済み副作用を重複させず、未完了provider/Lab stateを再利用しない。
7. Attempt Planのpolicy auditでCalibration Context、CVE、advisory、patch、known payloadがworker-visible inputにないことを確認する。
8. private Brizy 2.8.11と2.8.12をCase固有production分岐なしで同じ`run`へ通す。
9. 全Finderが`provider-failed`なら、Hypothesis 0件と区別して`provider-unavailable`をdurableに記録する。

## Rejected alternatives

| Alternative | Rejection reason |
| --- | --- |
| phase別のpublic methods | callerへ順序、budget、記録、freshnessを漏らし、再開時に安全性が分散する |
| `prepare`が暗黙に全Campaignを開始 | 既存の受入だけ行うidempotent behaviorを壊し、読み取り用途でもprovider/Labを起動し得る |
| Boundary Pairを一Campaignへ格納 | 一Target SnapshotというCampaign identityを壊し、benchmark roleを実戦Campaignへ混ぜる |
| private graderをFinder promptへ渡す | oracle leakageとなり、探索能力を測れない |
| in-memory workflowを最後に一括保存 | crash後に外部副作用とResearch Ledgerを対応付けられない |

## First-slice limits

- active Campaignは一つ
- Work Waveは一つずつbarrierまで完了し、最大3 Finder Attempts
- providerはeligible Claude Opus process一つ
- Verification mechanismは`stored-xss-browser@v1`と`sql-injection-database@v1`
- private Calibration ReviewはBrizy Stored XSSの完全なBoundary Pairで実測済み。Appointment Booking Calendar SQLiはroot mechanism Findingまでで、同一Identityのpatched Disprovedは要再実行
- UI、Remote Control、Target Intelligence automation、multi-provider、general workflow engineは追加しない

## Implementation status

最初のbehavior sliceは実装済みである。`CampaignRunner.run`はCASに固定されたSurface MapとExploration Policyを検査し、有限Work Waveを作り、最大3 Attemptの上限内でFinderを実行し、source-bound Hypothesisだけを独立Verificationへ渡す。Attempt PlanはCampaign ControlがTarget、Lease、予算へ結び付け、private CAS保存、Ledger intent、外部process、terminal receiptの順で進む。production Finder materializerは固定Surface Map、PHP Program Index、Focus Area、Work Leaseから`Analysis Unit@v1`を決定的に作り、実ファイルのregular-file/realpath/size/SHA-256を再検査する。Unitは採用source rangeと選択理由を持つ。directed StrategyはMap/call近傍を優先し、読めた二次sourceから低頻度literalと共有hook登録元を一段だけ昇格する。`wildcard`はdirected候補から除いたnode-kind別Surface Map標本を共有hook、literal参照より先にしてcontext相関を下げる。Source Evidence設定がある場合はCampaign Run PlanがPolicy refとquery ceilingを固定し、Materializerが対応するPolicy artifactとTargetを検査してAttempt Planへ結合する。workerへadvisory、CVE、patch、Case role、期待結果を渡さない。Leaseの`maxHypotheses`はprompt上の依頼だけでなくrole output schemaの配列上限として強制し、超過outputを`completed`にしない。中断後のin-progress processは`orphaned`へ確定し、残予算がある場合だけfresh Attempt IDで置き換える。FindingまたはDisprovedは`await-calibration`を伴うterminal Campaign RunとしてResearch Ledgerへ記録され、close/reopen後の再実行はproviderやLabを再起動せず同じrefを返す。

並列Finderの完了順を逆転しても、Work Lease順に正規化されたterminal recordとdigestが同一になることをbehavior testで固定している。また、Verificationのtyped Blocked reasonはCampaignの`blocked-capability`まで失われない。全Finderが`provider-failed`の場合もterminal statusをIteration Reviewへ渡し、`provider-unavailable`を失わない。

仮説なしでFinder予算が残る場合、pure Iteration Reviewは前Wave、残Attempt数、目的、停止条件を持つ有限workを作り、private CASのdigestへ固定した`continue-unresolved-work`を返す。Verificationがtyped Blockedを返した場合は探索のやり直しに置き換えず、blockerを優先する。

Git外のBrizy 2.8.11/2.8.12 snapshotでは、同じproduction materializerで各3 Leaseを構築し、全Unitが8 files、650 KB以下へ収まることを確認した。Focus correction後は両版とも外部entryへ`entry-forward`と`wildcard`を重ね、別の危険primitiveを`sink-backward`へ置いた。Wildcardは広いSurface Map標本を先に選ぶため、directed Strategyとは別のsource集合になった。二次sourceを一段展開する修正後、2.8.11のdirected Unitは保存・submit・renderのsourceを同じ上限内に含み、oracle-free Finder、独立Verifier、fresh gVisor Witness/Controlを経てStored XSS Findingへ到達した。2.8.12のoracle-free対照も同じcontext規則を使い、Findingへ誤昇格しなかった。file-writeやauthorization-bypass等はVerification mechanism未実装として`unsupported-experiment`を維持した。

Git外のAppointment Booking Calendar `1.6.9.29@r3475885`と`1.6.10.0@r3480506`では、同じproduction入口から各3 Finderを実行した。脆弱Snapshotはsource-bound SQLi Hypothesis、独立再導出、fresh gVisor database Witness/ControlからFindingになった。ただしFindingのpremiseはcustomer tokenを持つ利用者で、別の完全未認証routeは証拠不足でBlockedだった。1.6.10.0のoracle-free CampaignはFindingを作らなかったが、保存済みDisprovedはpositiveの`fields` Causal Identityとは別candidateである。Lab setupは任意PHPを実行せず、manifest固定したreviewed fixture pluginのactivationへ限定した。これは完全な公開CVE再発見またはplugin全体のnegative判定ではない。

private Brizy 2.8.11では、実Opus Finder・Independent Verifier・gVisor/browserを同じ`CampaignRunner.run`へ連結し、oracle-freeな3 FinderからFindingまで到達した。2.8.12のoracle-free Campaignは別classのHypothesisを返したが、対応実験がないものをtyped Blockedに保ち、Stored XSS Findingへ誤昇格しなかった。private graderは固定positiveのCausal Identityを2.8.12へ拘束し、実Opus再導出とfresh gVisor Witness/Controlから同じIdentityのDisprovedを記録した。active CampaignのFindingはmodel生成文言ではなくCalibration Fingerprintで固定positiveへ照合し、Calibration Reviewは`complete`となった。

Calibration Reviewはopaque Contextとterminal Verification refsだけを受けるsystem seamとして実装し、context digestが違う完了証拠を拒否する。合成Behavior Testでは正しいprivate receiptだけが`stop-boundary-pair-complete`を記録する。Verificationは、再導出後・Witness前とWitness後・Control前のprocess crashからclose/reopenすると、古い途中成果を採用せずfresh verifierとfresh sibling pairを再実行する。完成済みVerificationは外部adapterを呼ばず同じrefをreplayする。

Closure Gateは2026-09-02に通過した。同じproduction入口は3 Finder Attempt、Finding、Boundary Pair Evidenceを経て`stop-boundary-pair-complete`を実レシートへ記録し、close/reopen replayも一致した。`continue-unresolved-work`を次の実Waveへ自動消費するreconcileは、完全自律の到達形には必要だが、一つの有限Waveと次Iteration Decisionまでを閉じる完了済みClosure Gateには含めず、次のvertical sliceへ送る。
