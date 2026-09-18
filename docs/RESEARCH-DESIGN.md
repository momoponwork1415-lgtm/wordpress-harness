# Research Design

Status: accepted research policy, 2026-09-18

## Goal

既知脆弱性のoracleなしに、high-impactなbroken security semanticsを高recallで発見し、人間がadmitしたCandidateをfreshな実環境で確認する。`runtime-confirmed`からだけVerified Vulnerabilityを生成し、programme別scopeと分離したまま提出判断まで閉じる。

**Do not optimize for sinks. Optimize for broken security semantics.**

Researchが深く追うProgramme対象は、unauthenticatedまたはSubscriber / Customerから到達できるArbitrary PHP File Upload / Read / Deletion、Arbitrary Options Update、RCE、Authentication Bypass / Privilege Escalation to Administrator、Stored XSS、SQL Injection、およびProgramme上criticalなunauthorized data alteration / readである。active installation、WordPress.org掲載とpremium eligibilityはTarget Intelligenceがadmission時に判断し、Researchへ再計算させない。RCEは最上位impactだが、別の列挙impactをRCEまで伸ばす必要はない。

## Decision ownership

Harnessは判断内容ではなく、判断できる安全な条件と証拠を所有する。

| Concern | Harness owns | AI owns |
| --- | --- | --- |
| Target Selection | oracle-free Candidate Pool、source identity、freshness、Budget、人間のBatch承認 | 優先Target、理由、不確実性、再調査価値 |
| Research | Target / Dependency Snapshots、Prompt、Permission、Grant wall time、両Human Review、record、terminal semantics | 仮説、native subagent、読む順序、継続提案、停止提案、Candidate、parked Programme Lead |
| Candidate Verification | Candidate / recipe binding、fresh WordPress / MySQL runtime、Private Evidence、Verified Vulnerability生成条件 | bounded reproduction、実効性の判定 |
| Programme Scope / Human OS | configured programme集合、scope snapshot、Submission Candidate、external authorization | programme別適合性、理解支援、Draft作成 |

固定のrank、diversity cap、reason code、worker role、Finder数、Wave、Lease、Depth、Approach Family、Validation RubricをAI判断の代わりにしない。schemaはidentity、authority、evidence、failure semanticsとcontext handoffに使う。

## Design lineage

Research designの出発点は、Wordfence Argusが公開した「**confine, constrain, focus, motivate, parallelize, hypothesize, verify, record, prioritize, and then iterate hard and fast**」という10動詞のapproachと、[wp2shellのexact prompt](https://www.slcyber.io/research/exploit-brokers-pay-500000-for-a-wordpress-rce-i-found-one-with-gpt5-6#the-story-of-wp2shell)、その元になったOpenAIの[Cycle Double Cover Prompt](https://cdn.openai.com/pdf/04d1d1e4-bc75-476a-97cf-49055cd98d31/cdc_prompt.pdf)である。[Argusの記事](https://www.wordfence.com/blog/2026/08/wordfence-argus-moving-beyond-human-research-capability/)は詳細を公開していないため、10動詞をこのrepositoryでは次のように具体化する。

| Principle | Repository interpretation |
| --- | --- |
| confine / constrain | gVisor、read-only source、Permission、Budget、versioned bindingで権限と実行境界を固定する |
| focus / motivate / prioritize | Target approval、Threat Context、Programme BoundaryとPromptで目的を明確にし、優先順位と想定外CandidateはAIに残す |
| parallelize / hypothesize | provider-native Root / subagentが独立したrouteと反証可能なsource-bound claimを作る |
| verify / record | 探索内のadversarial review、fresh dynamic verification、Verified Vulnerability、programme scope、append-only Receiptを分離する |
| iterate hard and fast | Rootがsynthesize、challenge、redirectを繰り返し、各Grantのhuman review後だけ同じCheckpointから次へ進む |

wp2shell promptの研究手法は[WP2Shell-derived Prompt](../prompts/wordpress-plugin-research-v3.md)へすべて取り入れる。具体的にはfirst-principlesのraw-source analysis、native multi-agentの積極的で動的な利用、固定assignmentの禁止、genuinely diverseなportfolio、明示的なApproach Family Registry、収束時のunderexplored familyへのredirect、見込みだけで一routeを支配させないこと、blocked routeの新機構による再開、incompatible routeの複数round維持と遅いcross-pollination、concrete bugのadversarial double-check、Rootによる反復的なsynthesis / challenge / redirect / new round、first waveや現在のapproachの失敗だけで停止しないこと、dependency sourceを読んだmissing linkとintermediate bugのchain探索である。

WP2Shell-derived PromptはCloudflareの公開security-audit skillからも、concrete security invariant、最強のsource-visible controlの再構成、sibling / legacy / lifecycle / failure pathの比較とsad-state testingを採る。さらに[Cloudflare-derived Prompt](../prompts/wordpress-plugin-research-cloudflare-v1.md)は、公開skillのReconnaissance、coverage-directed Hunt、adversarial Validate、GapfillをRoot所有の一つの連続loopへ適応する。固定Hunter、Wave、deterministic coverage ledger、finding countによる完了判定はこの適応方式とwp2shellには採らない。比較実験用の[Cloudflare upstream-derived Prompt](../prompts/wordpress-plugin-research-cloudflare-upstream-v1.md)だけは、固定した公開skillのfull-audit workflow、private coverage ledger、hunter / critic waveとfresh verificationをResearch Method内部で維持する。そのscratch artifactをHarness state、Research Coverageまたは安全性の証明へ昇格させない。

持ち込まないのは、wp2shell task固有の「脆弱性が存在してpre-auth RCE / `/flag`へ必ず到達する」というpositive oracleと最低6時間の指定だけである。元のCDC promptの肯定解と最低8時間も同じ理由で持ち込まない。最大4体は現在のresource ceilingとして使い、Approach Family RegistryはRootのscratchに置く。dependencyのrun中cloneは事前pinしたread-only Dependency Snapshotへ置き換える。これらは研究要素の省略ではなく、prospective mission、再現性、isolation、Human Research Reviewへ適応した実行境界である。tempoはevidence、isolation、Human Research ReviewまたはCandidate admissionを省略する理由にしない。

Claude Code、Codex、Grok等が既に提供するmodel loop、context管理、session resume、native subagentの起動・message・wait、tool routingをHarness内で再実装しない。Provider Adapterは公式native機能を設定・制限し、Target / Prompt / Runtime / Permission / Budget bindingとReceiptへ変換する。Agent Runtime Profileはexact model、reasoning effort、native transport、executable version、sandbox image、prompt / report capabilityを一つのdigestへbindする。既存transportで実行できるmodelはprofile catalogへ追加し、modelごとのAdapterを作らない。新しいAdapterはnative command、sessionまたはoutput protocolが異なる場合だけ追加する。安全上必要な最小read-only source seamやintegrity checkはHarnessが所有するが、provider-neutralなagent framework、conversation engine、schedulerまたはtool DSLは作らない。native機能が利用不能またはadmit不能ならsilent fallbackせず、typed `incomplete`として残す。

## Target Selection

Target Intelligenceはoracle-freeなSelection Factから、AIがResearch価値を比較してTarget Proposalを作る。利用規模、更新状況、integration、source scale、Programme Eligibility、Disclosure Route、Research Historyは判断材料にできるが、全候補のrank、固定Band、固定facetのdiversityまたは列挙済み理由を要求しない。

Target供給は一種類のheuristicへ寄せない。通常のCandidate Poolに加え、caller-boundedなWordPress.org更新windowから`trunk` PHP変更をUpdate Frontierとして観測し、同じversionのsourceを再取得してCandidate Poolへ組み立てられる。更新差分は「どこを読めば脆弱性があるか」というoracleではなく、Targetを今読む価値を示すprospective factである。exact path、added source、既知advisory、patch、PoCまたはaffected functionはprivate evidenceに留める。signalがないPHP変更もfrontier membershipから落とさず、source取得不能、stale observation、selection fact欠損またはbinding不一致を未探索やeligibleへ補完しない。

Harnessのhard gateは次に限定する。

- sourceを正規に取得できる。
- Plugin Identity、version、provenanceとCanonical File Manifestを固定できる。
- 実行直前のsourceとversionがfreshである。
- 選択結果が入力Candidate Poolへ含まれる。
- 人間がApproved Target BatchとしてResearch対象範囲を承認する。

Programme対象外、Disclosure Route不明、既探索またはAIの低評価だけを技術的Researchの拒否条件にしない。既探索Targetの再投入理由と重複active Campaignは記録するが、再調査価値はAIが判断する。

## Agent-led Research

Research MethodはPrompt SetとしてCampaign開始前に選び、model / provider transportとは独立にbindする。現在のcanonicalな方式は次の二つである。

| Research Method | Canonical Prompt Set | Rootが所有する探索loop |
| --- | --- | --- |
| `wp2shell` | `wordpress-plugin-research-wp2shell-v1` / [Prompt](../prompts/wordpress-plugin-research-v3.md) | diverse approach portfolio、複数round、遅いcross-pollination、反復synthesis / redirect |
| `cloudflare` | `wordpress-plugin-research-cloudflare-v1` / [Prompt](../prompts/wordpress-plugin-research-cloudflare-v1.md) | source Reconnaissance、coverage-directed Hunt、adversarial Validate、source-bound Gapfill |
| `cloudflare-upstream` | `wordpress-plugin-research-cloudflare-upstream-c1c8a8c-v1` / [Prompt](../prompts/wordpress-plugin-research-cloudflare-upstream-v1.md) | pinned upstream full-audit workflow、deterministic private ledger、hunter / critic wave、fresh source verification |

既存記録の`wordpress-plugin-research-v3`は同じWP2Shell-derived Promptへbindしたlegacy idとして認識する。canonical idとPrompt digestの対応は[`research-methods.ts`](../src/research/agent-led/research-methods.ts)で固定し、別方式の本文を同じ名前で実行する誤設定を拒否する。方式固有の探索判断はPromptとprovider-native Rootの内側に置き、`ResearchCampaigns.conduct / inspect`、Research Report、Human Reviewまたはprovider AdapterのInterfaceを方式ごとに分岐させない。

Provider-native Root agentはTarget Snapshot全体を読み、pluginが依存するWordPress core等の挙動をpinned Dependency Snapshotから解決する。どちらの方式でもnative subagentを積極的かつ動的に使い、Dependencyを別のaudit Targetにしない。HarnessはRootを含む同時active agent最大4体のresource ceilingだけをprovider runtimeで強制し、agentの実数、role、round、探索classまたは読むfileを指定しない。Rootだけが最大3体のsubagentを起動し、役割、終了後の再投入とwaveを決める。探索評価ではGrokを先に使う。利用不能時に同じCampaignを暗黙fallbackせず、GLM 5.3等の別Runtime Profileをbindした新しいCampaignとして明示的に比較する。

一回のResearch Native RunをResearch Grantとし、wall-time allowanceは最大1時間とする。Harnessはproviderを呼ぶ前にexactなSealed Native Run、digestと開始時刻をNative Run Attemptとしてappendする。Receiptはprivateなrecovery artifactへatomicに確定した後でだけterminal eventへappendする。started eventだけが残ったattemptはorphanedであり、自動再実行しない。同じrun、runtime profile、Receipt digestへ一致するartifactだけを回復し、欠落・破損・不一致なら`incomplete`のままにする。

Research Rootのprovider-native conversationとscratchはprivate Agent Checkpointとして継続できる。Harnessは固定checkpoint cadenceや内部tool eventをdomain modelにせず、bindingとintegrityを持つopaque refだけを記録する。timeoutまたはprovider interruptionでもCheckpointを保存できなければ`incomplete`であり、resume可能とは扱わない。Candidate VerificationへResearch Checkpointを渡さない。

Checkpoint、Agent Run Diagnostic、Native Run ReceiptとCandidate Recipeは同じprivate artifact storage規律を使うが、domain objectやrefの意味は統合しない。各Adapterがrun、Candidate、session等のbindingを所有し、共通storeはbounded write/read、atomic promotion、content-tree integrity、path/link safety、conflictとorphan inspectionだけを所有する。storeはorphanを自動repairまたは削除しない。

判断は単純である。

```text
eligible impactへの具体的な次手がある -> continueを提案し、人間のGrant reviewを待つ
eligible Candidateがある              -> scratchへ記録し、探索内で敵対的に反証する
OOS primitiveだけがある               -> lightweight parked Programme Leadとして保存する
active frontierがない                 -> evidence-backed stopを提案
外部制約で続行できない                -> incomplete
```

AIが`continue`を返すとCampaignは`research-review-pending`で止まる。Human Research Continuation Reviewはexact input、run、Checkpoint、Candidate set、parked Programme Lead setとnext actionへbindし、`continue-research`だけが次のGrantを開始する。Candidateが存在する場合、人間は`proceed-to-candidate-review`で現在の探索を区切れる。人間の自由記述reasonはResearchへ渡さず、source-bound next actionだけを渡す。

一つのCandidateを得ただけで停止せず、Rootはactive routeに限ってnative subagentによる敵対的レビュー、合成、リダイレクトを行う。Programme Boundary上で現在の最大source-supported effectが対象外で、eligible impactへの具体的なedgeがないprimitiveはParked Programme Leadとして最小限のevidenceを残す。Parked Leadをsubagentへ委譲せず、Candidate adversarial review、Human Candidate ReviewまたはCandidate Verificationへ流さない。新しいsource evidenceがATO、Admin昇格、RCE等のeligible impactへ具体的に接続した時だけactive routeまたは新Candidateへ昇格する。RCEへ伸びないことだけを理由に重大なSQLiやStored XSSを未完成扱いしない。支持数、model confidence、到着順、static rule non-match、Surface Map外であることをCandidateの棄却またはsafe判定に使わない。

staticまたは派生解析の出力があってもnavigationとevidenceの補助に限り、探索空間またはcompletion proofにしない。現行agent pathはraw sourceを直接読む。

Research Report v2では、Candidateにlower-trust entrypointからsecurity-relevant effectまでのordered source trace、最強のsource-visible controlへのassessmentとexactな未解決事実を要求する。Grant内で具体的に調査した重要routeがCandidateにならなかった場合は、sourceで反証できた`refuted`または決定的事実が不足する`blocked`のResearch Assessmentを残す。さらに、Candidateの有無にかかわらず、Grant内で調べた領域をsource evidence付きで、未調査領域を明示したevidence summaryを要求する。Assessmentとevidence summaryはどちらもGrant-localであり、次Grantへ再掲するqueue、Coverage unit、探索完了または安全性の証明にしない。

## Independent trial evaluation

一つのIndependent Research Trialは、以前の結果やCheckpointを入力せず、freshなCampaignとして開始する。Campaign内で同じCheckpointから続けるResearch Grant、provider通信のretry、認証の再試行、出力形式の補正は同じTrialの一部であり、独立試行数を増やさない。固定した評価対象集合の各Targetへ一Trialずつ行う単位をEvaluation Sweepとする。外部資料の`pass@3`を参照する場合は、単一Targetの3 Trialなのか、評価対象全体の3 Sweepなのかを明記し、保存形式、InterfaceまたはResearch Methodの名前にはしない。

同じ条件の反復を比較するときは、`campaignId`だけを変え、Target / Dependency Snapshots、Prompt Set、Threat Context、Programme Boundary、Agent Runtime Profile、Permission Profile、Budget Envelopeとtool / network条件を固定する。各Trialは`resumeFrom`を持たず、freshなprovider session、homeとscratchを使い、別TrialのCandidate、Checkpoint、reportまたは人間の判断を入力しない。modelやprovider harnessのbuildを固定または実行時に確認できなければ、そのidentityをunknownのまま表示し、異なる可能性がある結果を同一条件として集計しない。異なるPromptやApproach Familyを割り当てる比較はportfolio ablationであり、同一条件の反復とは別に扱う。

比較表示は既存のCampaign view、Native Receipt、Candidate Verificationとprogramme scopeの記録から読み取り専用で導出する。第二のmutable ledger、`ResearchStrategy.execute`、Campaign内部の反復loopまたは比較のための自動Research起動を追加しない。自動起動が後で必要になった場合も、exact Trial集合とaggregate wall-time / run allowanceへの人間の承認を先に要求し、比較処理がResearch Grant、Candidate admission、Verificationまたは外部行動を代行しない。

比較ではplanned / model-completed / incompleteなTrialを分け、Candidateを`campaignId / runId / candidateId`の出所付きで保持する。同じ主張の複数出現、model confidence、schema適合または多数決を技術的確実性へ変換せず、root causeの同一性が不明なCandidateを自動統合しない。`runtime-confirmed`、programme scope、administrative completionとCoverageは別々に表示する。cost欠損はunknownであり0にしない。既知正解を固定したcorpusだけがprecision / recallを主張でき、prospective Campaignではunique runtime-confirmed vulnerability、duplicate、incomplete、in-scope outcomeとTrialごとの増分を観測する。

## Candidate Verification

Research CandidateはTarget Snapshot、attacker premise、broken security property、主張、ordered source trace、control assessment、未解決事実とprivate reproduction recipeへの参照を持つ。Rootはsourceを理解した同じrunで最小の動的手順を作り、Runtime Adapterが本文をGit外のcontent-addressed storeへ退避する。Campaign recordへはdigest、sizeとrecipe idだけを残す。recipeを作れなかったCandidateは棄却せず`verification-preparation-needed`に留める。

Researchを区切ってCandidateがあれば、Campaignは`candidate-review-pending`で止まる。Human Candidate Reviewはexact Candidate setへbindし、`advance-to-candidate-verification`だけをCandidate Verification Requestへ変換する。`return-to-research`が一件でもあればVerificationより先にResearchへ戻す。

Human OSはRequestごとにfreshな使い捨てWordPress / MySQL環境を作り、Candidate-bound recipeを一度だけ実行する。ソースから脆弱性を再導出する別AI runは行わない。

| Result | Meaning |
| --- | --- |
| `runtime-confirmed` | 前提、recipe完了、security effectとprivate evidenceが揃い、Verified Vulnerabilityを作る |
| `contradicted` | 通常前提とrecipeが完了したが、主張したeffectを観測しなかった |
| `incomplete` | 環境、依存、recipe、観測、cleanupまたはevidenceが不足し、否定へ丸めない |

Verified Vulnerabilityの技術的な真偽とprogramme eligibilityは別artifactである。runtime確認後に全configured programmeを各scope snapshotへ照らして`in-scope`、`out-of-scope`、`ambiguous`または`stale`と評価する。全programmeでOOSでもVerified Vulnerabilityは保持する。Submission Candidateは`in-scope`のprogrammeにだけ生成し、人間が一つのdestinationとexact Draftを選んで外部行動を承認する。

複数Targetは互いに独立したCampaignとprocessとして並列実行する。Harness内へ中央schedulerやcross-Target verification queueを作らず、providerまたはoperatorの既存process並列性を使う。

## Completion and failure

AIが有望なsource-bound next actionを残さず、Harnessが固定入力、source integrityとterminal outputを検査できた時だけResearch Coverageを`closed`にする。Candidate Verificationの成否とは独立し、脆弱性が存在しない証明でもない。

具体的な次手を残したままCampaignのrun数またはwall timeへ達した場合、provider / tool / source / permission / schema / storage failureは`incomplete`とする。動的検証の準備不足は`verification-preparation-needed`として区別する。Providerが報告する推定costはReceiptへ保存するがHarnessの停止条件にしない。Candidate 0、agentの一回のno-finding、timeout、Map coverageまたはtool hit数をclosureへ読み替えない。

## Trust and versioning

- Target sourceをhost上で実行しない。
- Target / Dependency Snapshotsはread-only、隔離scratchだけをwriteableにする。
- Rootとnative subagentへ同じPermission Profileを適用する。
- ambient shell、network、credential、container socket、host path、plugin、hook、memory、未承認MCPを与えない。
- raw provider credentialはAgentへ渡さず、必要なtransportではfixed upstreamとrun bindingを持つ短命なcredential egress grantだけを渡す。
- gVisor相当以上のOS-level sandboxとTransport Eligibility capability probeを通らないruntimeを使わず、host processまたはplain Dockerへfallbackしない。
- Target / Dependency Snapshots、Prompt Set、Agent Runtime Profile、Permission Profile、Budget Envelope、outputをCampaignへdigest bindする。
- providerまたはmodelをsilent fallbackしない。GrokからGLM 5.3へ切り替える場合も別Runtime Profileと新しいCampaign inputを使う。
- 人間の必須gateはApproved Target Batch、各Research Grantの継続、Candidate Verification admission、External Action Authorizationと最後のSubmitに置く。

Prompt、runtime、permissionまたはresearch policyの変更は進行中Campaignへ適用せず、新しいversioned Campaignで比較する。現行binaryへlegacy reader、feature flagまたは未使用Adapterを残さない。

## Change gate

変更は次を説明できる場合だけ採用する。

- public known-positive corpusでCandidateとruntime-confirmed Verified Vulnerabilityのstage別recoveryを悪化させないか。
- prospective Campaignでhigh-impact recallを悪化させないか。
- Rootとsubagentのpermission継承を実測したか。
- Candidate Verificationのfreshnessを保てるか。
- source、provider、budgetまたはschema failureをnegativeへ丸めないか。
- public Interfaceからbehaviorを観測でき、旧内部Testを削除できるか。

診断coreの合否は既知positiveのoracle-free再発見とfresh dynamic verification成立で測る。patched版やbare controlは必要な比較実験でだけ使い、通常のpromotionに要求しない。隔離方式、Target Selection、Coverage closureまたはLOCを診断精度の代理指標にしない。

Costは観測するがhard ceilingにしない。Cost削減はrecall baseline確立後に一変数ずつablationする。LOCは設計の証明または目標値にしない。未使用code、二つ目の実装がない汎用abstraction、AI判断を再実装するorchestrationを残さず、実測LOCの増加はpublic behaviorで説明する。

## References

- [ADR 0125](adr/0125-put-agent-decisions-behind-thin-evidence-shells.md)
- [ADR 0127](adr/0127-make-validated-findings-the-product-success-criterion.md)
- [ADR 0128](adr/0128-provide-pinned-dependency-source-to-research.md)
- [ADR 0131](adr/0131-place-human-reviews-between-research-and-validation.md)
- [ADR 0132](adr/0132-treat-provider-cost-as-observational-telemetry.md)
- [ADR 0135](adr/0135-promote-candidates-through-runtime-verification.md)
- [ADR 0136](adr/0136-require-control-challenged-research-evidence.md)
- [ADR 0142](adr/0142-route-provider-credentials-through-a-bounded-egress-broker.md)
- [wp2shell exact prompt](https://www.slcyber.io/research/exploit-brokers-pay-500000-for-a-wordpress-rce-i-found-one-with-gpt5-6#the-story-of-wp2shell)
- [Cycle Double Cover Prompt](https://cdn.openai.com/pdf/04d1d1e4-bc75-476a-97cf-49055cd98d31/cdc_prompt.pdf)
- [Reference harness comparison](knowledge/reference-harness-observability.md)
