# Model execution seam

Status: accepted; tool-free Finder and provider-neutral structured role bridge implemented, 2026-09-02

## Owner and purpose

ResearchのModel Executionが所有する。一つの不変な実行計画（Attempt Plan）を、provider、transport、認証、tool protocol、process lifecycleの差から隔離して実行し、呼出元へprovider非依存の実行結果（Attempt Execution Result）だけを返すdeep moduleである。

Model Executionは特定modelの性能をdomain contractへ埋め込まない。roleを実行できる最低能力とTransport Eligibilityを満たすmodelはversioned Model Profileとして差し替えられ、Exploration、Verification、Research Recordはprovider名、effort名、CLI/APIの違いを知らない。安価なProfileが不足contextを自力で推測することを期待せず、必要な探索能力はAttempt Planとharness-owned toolへ寄せる。

## Interface

```ts
interface ModelExecution {
  run(plan: AttemptPlan): Promise<AttemptExecutionResult>;
}

interface StructuredModelExecution {
  run(request: StructuredModelRequest): Promise<StructuredModelResult>;
}

type AttemptExecutionResult =
  {
    status:
      | "completed"
      | "invalid-output"
      | "policy-denied"
      | "auth-required"
      | "provider-failed"
      | "budget-exhausted"
      | "cancelled"
      | "orphaned";
    ref: AttemptExecutionResultRef;
    value: FinderAttemptResult;
  };
```

公開`ModelExecution`の最初の実装はFinderだけにspecializeしているため`value`は`FinderAttemptResult`である。`StructuredModelExecution`はSource Mapping等のowner Moduleが自分のschemaとdomain取込を所有したまま、同じ制限付きprovider transportを使うための内部bridgeである。Model Profile型はprovider非依存で、Claude adapterだけがAnthropic transportとの適合を検査する。これは統一role hierarchyまたは完全なAttempt Receiptではない。将来、複数roleのdurable receiptを公開境界で扱う必要が生じた時だけversioned `RoleOutputRef`へ拡張する。

callerはprovider executable、argv、session ID、credential path、process ID、retry timing、transcript pathを渡さない。`start`、`resume`、`kill`、`readStdout`等を別methodとして公開せず、Segment lifecycleを`run`の背後へ隠す。

## Implemented first slice

現行実装はFinder roleと、owner Module向けのstructured role bridgeを公式Claude Code process `2.1.258`へ接続する細いadapterである。productionで実測済みのProfileは`claude-opus-5`である。`Attempt Plan`はTarget、Work Lease、model/effort、Eligibility Receipt digest、render済みprompt、wall/output budgetを固定する。Campaign Controlのproduction materializerが固定Surface Map、PHP Program Index、Focus Area、Work Leaseからoracle-free source contextを決定的に選択し、実ファイルdigestを再検査してpromptをrenderする。実Opusを伴う`CampaignRunner.run`へcomposition済みであり、private Brizy Stored XSSとAppointment Booking Calendar SQLi Campaignで各3 Finderの並列実行から独立Verificationまで到達した。

native adapterは推論前にexecutable versionと公式`auth status`を検査する。認証切れは`auth-required`として終了し、別modelへfallbackしない。provider built-in tool、Web、subagent、ambient MCP、slash command、session persistence、Chromeを無効化し、promptはargvではなくstdinへ渡す。親processだけでなくdetached process groupをwall ceiling時に終了し、`SIGTERM`後または親終了時に残った子へ`SIGKILL`を送る。wall budgetにはversion/auth probeも含める。

Claude Codeの通常起動が成功しても、呼出元のcommand sandboxがoutbound networkを禁止していれば子processはproviderへ接続できない。この場合の`api_error`はDirect API credentialの要求ではなく、Claude CLI内部のtransport error分類である。production Campaignは公式CLIと`claude.ai` subscription認証をそのまま使い、consumer OAuth tokenを独自HTTP APIへ転用しない。全Finderが`provider-failed`でterminalになった場合、Iteration Reviewは探索結果0件へ丸めず`provider-unavailable`を記録する。

現行のtool-free source sliceは、structured output、process supervision、3並列、Verification接続を最短で通すためのtracer implementationであり、acceptedなAttempt tool planeの完成形ではない。単一Focusから先回りして選ぶ固定file集合は、必要routeを含まない場合と不要な大contextを含む場合があるため、その結果だけでModel Profileの探索能力を判定しない。次の探索sliceでは公開`ModelExecution.run(plan)`を変えず、内部adapterを予算付きのharness-owned read、search、symbol、graph toolへ置き換える。

Claude JSON envelope、実model identity、permission denial、Web request数、subagent数は一つのdecoderでruntime decodeする。FinderはさらにFinder schema、Work Lease binding、Lease固有の`maxHypotheses`を、Source MappingはMap Delta schemaとpredecessor/context bindingを、Independent Verifierは検証identityとsource evidence bindingを各owner Moduleで検査する。Finderの成功outputまたは型付きterminal resultはprivate CASへ保存し、呼出元へdigest付きrefを返す。provider errorのstderrはcredential値をredactし、非ゼロ終了時のstdoutがClaude error envelopeならterminal reason、bounded message、API statusだけを抽出してprivate error artifactへ置く。raw stdoutとcredentialは保存せず、公開resultにはartifact digestだけを残す。

2026-09-02のprivate development benchmarkでは、oracle情報を与えず、実在するTranslatePress 3.2.5のSurface Mapから一つのWork Leaseを選び、約414 KBのsource contextをOpus 5へ渡した。独立した二回の成功実行はそれぞれ二件と一件のschema-valid Source-bound Hypothesisを返し、どちらもExplorationの`verify` decisionまで到達した。この差は候補生成の分散であり、単発runを能力評価に使わない。これはtransportと取込経路の成立確認であって、Hypothesisの正しさ、脆弱性発見、Milestone 1完了を意味しない。target source、prompt、provider outputはGitへ置かない。

同日のSource Mapping接続smokeでは、全Surface Mapを渡した最初のrequestがproviderのcontext上限を超えたため、owner Module側でContext pathと1-hop subgraphへ投影する欠陥修正につながった。修正後のOpus 5 `high` structured callは約6分20秒で完了し、Map Delta compilerまで到達した。Model Executionはこの結果の意味を判定せず、今後もroleごとのcontext選択とschema検査はowner Moduleへ残す。

未実装なのは、raw provider eventとusageを含む完全なSegment durability、MapperのAttempt Receiptとrepair、classified retry/resume、orchestrator crash recovery、cgroup/resource ceiling、Agent SandboxのgVisor化、harness-owned read/search/symbol/graph tool、Finder以外の統一durable role execution、第二providerである。CampaignRunnerのlaunch intent/completionと3 Finderのcomposition、Mapperのbounded structured callは実装済みだが、それを完全なAttempt Receiptまたは安全なcrash resumeと読み替えない。

## Attempt Plan

Attempt PlanはWork Lease、worker role、Target Snapshot、Prompt Set、selected Knowledge、Model Profile、Sandbox Policy、role-specific Output Schema、tool manifest、reserved budgetをdigest固定する。Model Profileはprovider/model identity、transport kind、eligible transport receipt、provider固有effort、context policyを持つ。

model、role、effort、tool、retry、transportをworkerまたはprovider adapterが選択しない。effort名をprovider間の共通尺度へ変換せず、初期値は`provider-default`として明示する。特定roleのquality、cost、latencyが実戦上のbottleneckになった場合だけ、同じproviderの隣接設定を小さなsmokeで比較して次のversioned Profileへ反映する。

### 開発時の努力量ポリシー（Development Effort Policy、提案）

Claude Opus Finderの現在の開発baselineは`high`とする。これはClaude固有Profileの比較値であり、Model Executionまたは他providerのdefaultではない。Mapまたはsource contextが不足したAttempt、relationを持たない孤立file、translation/generated asset、到達根拠のないbundled dependencyを`xhigh`で再実行しない。これらはModel ProfileではなくTarget identity、Map、Focus、Context gateのfailureとして直す。

`high`がsource-boundなFrontier Hypothesis、具体的なfalsifier、追加取得可能なessential gapを作った場合だけ、同じTarget Snapshot、Focus Area、Strategy、source context、output schema、tool budgetを固定して`xhigh`のfresh Attemptと比較できる。`xhigh`は結果への追加信頼を与えず、通常のsource binding、独立Verification、Witness、Causal Controlを省略しない。複数の有望FocusでHypothesisの完全性または必要証拠の決定性が再現して改善した時だけdefault変更を検討し、それまでは有望routeのescalation Profileとする。

## Transport admission

production transportは次を全て満たすTransport Eligibility Receiptがある場合だけModel Profileへ採用できる。

1. providerが公式配布または公式に指定したclient、SDK、endpointである。
2. 利用するsubscription、OAuth、Coding Planまたはservice credentialについて、対象clientと自動化用途が公式に許可されている。
3. executable、package、effective config、model slug、output protocolをversion固定できる。
4. ambient setting、auto-update、subagent、built-in shell/web/plugin/hook/MCPを無効化できる。
5. harness所有toolだけを公開し、tool subprocessからprovider credentialとhost control planeを隔離できる。
6. structured output、session、termination、usage、errorを共通contractへ正規化できる。

consumer OAuth tokenまたはsubscription keyを抽出して独自HTTP clientや共通APIへ流用しない。公式なAPI/service credentialを別途導入した場合だけDirect API transportを別adapterとして追加できる。公式性、安全性、policy適合を確認できない候補は`ineligible`または`deferred`とし、似た非公式transportへ置換しない。

初期候補はOpus、GLM、GPT、Grokだが、candidate名はtransport eligibilityを保証しない。最初のproduction adapterは適格性probeを通過したClaude process/Opus Profileとし、通過しない場合はMilestoneを停止してtransport判断を見直す。後続providerを自動fallbackとして使わない。

## Provider authentication

Provider Credential StoreはResearch LedgerとCASの外に置き、providerごとに認証state、owner、scope、expiry、rotation/revocationを分離する。operatorはprovider公式のlogin flowだけを使い、Model Executionはopaque Credential Profile refを受ける。Ledgerへはcredential kind、profile identity、expiry class、auth receipt、redaction statusだけを記録し、token、cookie、refresh token、authorization headerを保存しない。

launcherだけが必要な認証stateへ到達し、model prompt、Target mount、harness tool、scratch compute、stdout/stderrへ値を公開しない。CLIがtool subprocessへcredential-bearing environmentまたはhomeを継承し、その分離を検証できない場合、そのtransportはproduction不適格とする。`auth-required`は人間の再認証が必要な可視状態としてCampaignを停止し、別credential、modelまたはtransportへ自動fallbackしない。

## Attempt tool plane

workerへ見せるtoolはharnessがversion固定したrole別manifestだけから構成する。

- Mapper、Finder、Verifier、Skepticへ、Target Snapshot内に限定したread、search、symbol/graph queryを提供する。
- bounded scratch computeはcredential、network、host path、Target write権限を持たない別sandboxで実行する。
- Discovery系roleへExperiment toolを渡さない。
- Verifierと必要なSkepticだけに、Work Leaseとmechanismへ拘束したtyped Experiment toolを渡す。
- unknown tool、schema mismatch、lease mismatch、path escape、budget超過を実行前に拒否し、request、response、policy decisionをprivate CASへ保存する。

provider組込みshell、filesystem tool、web search、plugin、hook、ambient MCP、memory、subagentは無効化する。providerが必要な機能を無効化できない場合はTransport Eligibility Receiptを発行しない。harness tool protocolとしてstdio MCP等をadapter内部で利用できるが、provider固有protocolをAttempt PlanまたはCampaign Controlへ漏らさない。

## Output and artifacts

Model Executionはprovider event stream、stderr、tool receipts、termination trace、usage、session ref、最終出力をprivate CASへ先にdurable writeし、成功したdigestだけをAttempt Receiptへ記録する。raw transcript、reasoning trace、provider sessionをExploration、Verification、Human OSへ渡さない。

最終出力はAttempt Planのrole-specific Output Schemaでruntime decodeする。schema不一致、自由文だけの回答、truncated output、unknown event、model substitution、silent effort fallbackは`completed`にしない。Model Executionはschema適合を保証するが、Hypothesisの採用、Finding昇格等のdomain意味は所有moduleが判断する。

## Supervision and resume

Model Executionの外側supervisorがwall time、Segment数、turn/tool数、output bytes、process count、memory/CPU、concurrency、利用可能なprovider usage ceilingを強制する。subscription推定金額や欠落usageは観測telemetryであり、信頼できるhard ceilingの代用にしない。

各Segmentはlaunch intentをResearch Recordへdurableにした後で起動し、終了receiptを追記する。上限、stop、policy違反時はprocess group/cgroup全体へ段階的terminationを行い、子processを残さない。

resumeは429、5xx、接続切断等の分類済み一時障害に限り、同じAttempt、provider session、Model Profile、Sandbox Policy、frozen input、残予算で行う。回数とwall ceilingを越えない。別Work Lease、Verifier、Skeptic、model familyへsessionを引き継がない。

orchestrator crash後に完全なlaunch intent、session ref、Segment receipt、安全なprovider resume capabilityが揃う場合だけ次Segmentとして再開する。それ以外は元Attemptを`orphaned`として閉じ、新しいAttempt IDでWork Leaseを再割当する。provider sessionをCampaign stateの正本にしない。

## Remote Control

Remote ControlはCampaignRunnerとCampaignReaderのcommand/queryだけを呼ぶdriving adapterである。開始、状態確認、停止要求、停止済みCampaignの`advance`、auth-required表示はできるが、provider CLIのPTY、session resume、process signal、OAuth token、Research Ledgerへ直接接続しない。remote切断は実行中Attemptを暗黙に停止せず、Campaign stateはResearch Ledgerから再構成する。

## Test surface

behavior testは`run(plan)`のAttempt Execution Resultと、Attempt Receiptから読めるprovider非依存viewだけを観測する。argv、PID、stdout chunk順、retry helper、credential file、内部timerを直接assertしない。

deterministic process adapterをtestに、公式native process adapterをproductionに使い、共通contract suiteでlaunch identity、schema failure、auth failure、budget termination、process-tree cleanup、transient resume、crash recovery、secret redactionを検査する。provider固有capability probeはnetworkを使う運用testとして分離し、fixture testの成功をTransport Eligibility Receiptへ読み替えない。

## Acceptance scenarios

1. callerは一つのAttempt Planを`run`へ渡すだけで、schema-valid outputまたはtyped terminal statusを受け取る。
2. 非公式client、用途不明なsubscription auth、version固定不能transportにはEligibility Receiptを発行しない。
3. official transportでもtool subprocessからcredentialを読める場合はproduction不適格になる。
4. provider built-in shell、webまたはambient pluginを無効化できなければAttemptを開始しない。
5. Finderはread/search/scratch toolだけを受け取り、Experimentまたはnetwork toolを呼べない。
6. providerが自由文だけを返した場合はraw artifactを保存して`invalid-output`になり、Hypothesisへ昇格しない。
7. wallまたはprocess ceiling超過時は全process treeを終了し、budget-exhausted receiptを残す。
8. 429後のresumeは同じAttemptとfrozen inputでだけ行われ、別modelへfallbackしない。
9. crash後に安全なresume条件が欠けるopen Attemptはorphanedになり、新しいAttemptとして再割当される。
10. Remote Control利用者はCampaignをinspect・stopできるが、provider PTY、session ref、credential値を取得できない。
11. 同じWork Leaseを別のeligible Model Profileへ割り当てても、ExplorationとVerificationの公開contractは変わらず、provider差はAttempt ReceiptのProfile identityとしてだけ観測される。
12. 安価なProfileがContext Reachで停止した場合、上位effortへの自動昇格ではなくMapping Evidence Requestまたはbounded tool requestとして不足を分類できる。
